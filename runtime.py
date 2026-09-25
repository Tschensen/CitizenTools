"""Local-only application lifecycle, screenshot worker and solo HTTP API."""
from __future__ import annotations

import argparse
import copy
import ipaddress
import json
import logging
import os
import re
import socket
import shutil
import threading
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from companion import app as capture_app
from companion import capture
from server import app as backend
import transfer
import solo_sounds
import solo_about

VERSION = "0.1.23"
DEFAULT_PORT = 4174
SOUND_NAMES = set(solo_sounds.NAMES)
SOUND_MAX_BYTES = solo_sounds.MAX_BYTES


def default_data_root() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local/share") / "CitizenToolsSolo"


def lan_addresses() -> list[str]:
    try:
        addresses = {record[4][0] for record in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    except OSError:
        return []
    return sorted(address for address in addresses if not (
        ipaddress.ip_address(address).is_loopback or ipaddress.ip_address(address).is_link_local
        or ipaddress.ip_address(address).is_unspecified
    ))


def solo_state(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Der Spielstand muss ein JSON-Objekt sein.")
    state = copy.deepcopy(value)
    for key in ("organization", "pilotGroups"):
        state.pop(key, None)
    for mission in state.get("missions", []) if isinstance(state.get("missions"), list) else []:
        if isinstance(mission, dict):
            for key in ("organizationLink", "organizationOrigin", "organizationProgress", "participantAllocations", "participants"):
                mission.pop(key, None)
    return state


class SoloHTTPServer(ThreadingHTTPServer):
    # Chromium opens several connections at once while the Companion and LAN
    # clients are also connecting. TCPServer's default backlog of five can
    # reject a script request before an HTTP handler can even log it.
    request_queue_size = 128
    daemon_threads = True


class SoloRuntime:
    def __init__(self, data_root: Path | None = None, *, port: int | None = None, lan: bool | None = None):
        self.root = (data_root or default_data_root()).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.config_path = self.root / "settings.json"
        self.settings = {
            "lanEnabled": True, "port": DEFAULT_PORT, "captureEnabled": True,
            "captureHotkey": capture.DEFAULT_HOTKEY, "captureMode": "active-monitor",
            "captureRetention": capture.DEFAULT_CAPTURE_RETENTION, "pilotName": "",
        }
        if self.config_path.is_file():
            # A damaged config is reported instead of silently overwritten.
            self.settings.update(self.validate_settings(json.loads(self.config_path.read_text(encoding="utf-8"))))
        if port is not None: self.settings["port"] = port
        if lan is not None: self.settings["lanEnabled"] = lan
        self.lock = threading.RLock()
        self.capture_lock = threading.Lock()
        self.worker: threading.Thread | None = None
        self.worker_stop = threading.Event()
        self.last_message = "Screenshot-Erfassung ausgeschaltet"
        self.capture_error = ""
        self.capture_ready = False
        self.hotkey_recording_gate = capture.HotkeyRecordingGate()
        self.httpd: ThreadingHTTPServer | None = None
        self.http_thread: threading.Thread | None = None
        self.window = None
        self.closing = False
        self.active_lan = bool(self.settings["lanEnabled"])
        self.addresses = lan_addresses()
        self.url = ""
        self.on_status = lambda: None

    @staticmethod
    def validate_settings(payload: object) -> dict:
        if not isinstance(payload, dict): raise ValueError("Ungültige Einstellungen.")
        result = {}
        for key in ("lanEnabled", "captureEnabled"):
            if key in payload:
                if not isinstance(payload[key], bool): raise ValueError(f"Ungültiger Wert: {key}")
                result[key] = payload[key]
        if "port" in payload:
            port = payload["port"]
            if type(port) is not int or not 1024 <= port <= 65535: raise ValueError("Port muss zwischen 1024 und 65535 liegen.")
            result["port"] = port
        if "captureHotkey" in payload:
            result["captureHotkey"] = capture.normalize_hotkey(payload["captureHotkey"])
        if "captureMode" in payload:
            if payload["captureMode"] not in ("active-monitor", "virtual-desktop"): raise ValueError("Ungültiger Aufnahmebereich.")
            result["captureMode"] = payload["captureMode"]
        if "captureRetention" in payload:
            value = payload["captureRetention"]
            if type(value) is not int or not 1 <= value <= 1000: raise ValueError("Aufbewahrung: 1 bis 1000 Bilder.")
            result["captureRetention"] = value
        if "pilotName" in payload: result["pilotName"] = str(payload["pilotName"]).strip()[:80]
        return result

    def start(self, *, capture_enabled=True):
        self.sound_dir = self.root / 'Sounds'
        self.sounds = solo_sounds.SoundLibrary(self.sound_dir, backend.WEB_DIR / 'assets/sounds')
        try:
            self.sound_dir.mkdir(exist_ok=True)
            for name in [*(f'{name}.wav' for name in SOUND_NAMES), 'README.txt']:
                source = backend.WEB_DIR / 'assets/sounds' / name
                try:
                    with source.open('rb') as original, (self.sound_dir / name).open('xb') as output:
                        shutil.copyfileobj(original, output)
                except FileExistsError:
                    pass  # Personal files survive every update.
        except OSError:
            logging.exception('Could not prepare custom sounds; built-in synthesis remains available')
        backend.DATA_DIR = self.root / "data"
        backend.DB_PATH = backend.DATA_DIR / "cargo_planner.sqlite3"
        backend.SHIP_IMAGE_DIR = backend.DATA_DIR / "ship-images"
        backend.init_db()
        self.httpd = SoloHTTPServer(("0.0.0.0" if self.active_lan else "127.0.0.1", self.settings["port"]), SoloHandler)
        self.httpd.runtime = self
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, name="SoloServer", daemon=True)
        self.http_thread.start()
        if capture_enabled and self.settings["captureEnabled"]: self.start_capture()

    @property
    def desktop_url(self):
        # Bypass HTML cached by older releases without discarding browser data.
        return f"{self.url}/?desktop=1&v={VERSION}"

    def status(self):
        with self.lock:
            return {
                "ok": True, "edition": "solo", "version": VERSION,
                "url": self.url,
                "lanUrls": [f"http://{address}:{self.httpd.server_port}" for address in self.addresses] if self.httpd and self.active_lan else [],
                "settings": dict(self.settings),
                "restartRequired": bool(self.httpd and (self.settings["lanEnabled"] != self.active_lan or self.settings["port"] != self.httpd.server_port)),
                "captureRunning": bool(self.worker and self.worker.is_alive()),
                "captureReady": self.capture_ready, "captureError": self.capture_error,
                "message": self.last_message, "ocrAvailable": bool(capture_app.resolve_tesseract(None)),
            }

    def save_settings(self, payload):
        updates = self.validate_settings(payload)
        with self.lock:
            settings = {**self.settings, **updates}
            if "port" in updates and self.httpd and settings["port"] != self.httpd.server_port:
                try:
                    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                        probe.bind(("0.0.0.0" if settings["lanEnabled"] else "127.0.0.1", settings["port"]))
                except OSError as error:
                    raise ValueError(f"Port {settings['port']} ist belegt oder nicht verfügbar. Bitte einen anderen Port wählen.") from error
            capture_changed = any(settings[key] != self.settings[key] for key in (
                "captureEnabled", "captureHotkey", "captureMode", "captureRetention", "pilotName"
            ))
            temporary = self.config_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(self.config_path)
            self.settings = settings
        if capture_changed:
            self.stop_capture()
            if settings["captureEnabled"]: self.start_capture()
        return self.status()

    def emit(self, message, error=False):
        logging.info("Capture: %s", message)
        with self.lock:
            self.last_message = str(message)
            if error: self.capture_error = str(message)
            if str(message).startswith("Capture hotkey:"): self.capture_ready = True
        self.on_status()

    def start_capture(self):
        with self.capture_lock:
            if self.closing or (self.worker and self.worker.is_alive()): return
            with self.lock:
                self.capture_error = ""
                self.capture_ready = False
                settings = dict(self.settings)
            if not capture_app.resolve_tesseract(None):
                self.emit("OCR-Laufzeit fehlt. Bitte das vollständige Solo-Paket verwenden.", True)
                return
            self.worker_stop = threading.Event()
            args = capture_app.create_argument_parser().parse_args([])
            args.server, args.scope, args.token, args.user_token = self.url, "solo", "", ""
            args.capture_folder = self.root / "Captures"
            args.screenshots = None
            args.state_file = self.root / "capture-state.json"
            args.capture_hotkey = settings["captureHotkey"]
            args.hotkey_recording_gate = self.hotkey_recording_gate
            args.capture_mode = settings["captureMode"]
            args.capture_retention = settings["captureRetention"]
            args.pilot_name = settings["pilotName"]
            def work():
                try: capture_app.run_companion(args, self.worker_stop, self.emit)
                except Exception as error:
                    logging.exception("Screenshot worker stopped")
                    self.emit(str(error), True)
                finally:
                    self.capture_ready = False
                    self.on_status()
            self.worker = threading.Thread(target=work, name="SoloCapture", daemon=True)
            self.worker.start()

    def stop_capture(self):
        with self.capture_lock:
            self.worker_stop.set()
            if self.worker and self.worker.is_alive():
                self.worker.join(timeout=30)
                if self.worker.is_alive(): raise RuntimeError("Die laufende Texterkennung wird noch beendet. Bitte kurz warten.")
            self.worker = None
            self.capture_ready = False
            self.on_status()

    def stop(self):
        self.closing = True
        try: self.stop_capture()
        finally:
            if self.httpd:
                self.httpd.shutdown()
                self.httpd.server_close()
            if self.http_thread: self.http_thread.join(timeout=3)


class SoloHandler(backend.CargoPlannerHandler):
    @property
    def runtime(self) -> SoloRuntime:
        return self.server.runtime

    def parse_request(self):
        if not super().parse_request(): return False
        self.connection.settimeout(30)
        host = self.headers.get("Host", "")
        parsed_host = urlparse("http://" + host)
        allowed = {"127.0.0.1", "localhost", *self.runtime.addresses}
        try:
            valid_host = parsed_host.hostname in allowed and parsed_host.port == self.server.server_port
        except ValueError: valid_host = False
        origin = self.headers.get("Origin")
        if not valid_host or (origin and origin != "http://" + host):
            self.send_json(403, {"error": "Fremde Webseiten dürfen nicht auf die Solo-App zugreifen."})
            return False
        scope = parse_qs(urlparse(self.path).query).get("scope", ["solo"])
        if scope != ["solo"]:
            self.send_json(400, {"error": "Diese Ausgabe unterstützt ausschließlich Solo-Spielstände."})
            return False
        length = self.headers.get("Content-Length", "0")
        if self.headers.get("Transfer-Encoding") or not length.isdecimal() or int(length) > backend.BACKUP_UPLOAD_MAX_BYTES:
            self.send_json(413, {"error": "Ungültige oder zu große Anfrage."})
            return False
        if self.command in {"POST", "PUT", "DELETE"}:
            content_type = self.headers.get("Content-Type", "").split(";")[0]
            if content_type in {"text/plain", "application/x-www-form-urlencoded", "multipart/form-data"}:
                self.send_json(415, {"error": "Nicht unterstütztes Anfrageformat."})
                return False
        return True

    def log_message(self, format, *args): logging.info("HTTP %s: %s", self.client_address[0], format % args)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def is_interface_resource(self):
        path = urlparse(self.path).path
        return path == "/" or path.endswith((".html", ".js", ".css"))

    def send_head(self):
        if self.is_interface_resource():
            # Always send the current interface, even if an old package's
            # cache validators would otherwise produce a 304 response.
            for header in ("If-Modified-Since", "If-None-Match"):
                if header in self.headers:
                    del self.headers[header]
        return super().send_head()

    def end_headers(self):
        if self.is_interface_resource():
            self.send_header("Cache-Control", "no-store")
        return super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/solo/about':
            try:
                return self.send_json(200, solo_about.information(VERSION))
            except (OSError, ValueError):
                logging.exception('Bundled product information unavailable')
                return self.send_json(503, {'error': 'about_unavailable'})
        if path in {'/api/solo/licenses.zip', '/api/solo/release-notes.txt', '/api/solo/source.zip'}:
            try:
                licenses = path.endswith('.zip')
                language = parse_qs(urlparse(self.path).query).get('language', ['de'])[0]
                if path.endswith('/source.zip'):
                    if not solo_about.SOURCE_ARCHIVE.is_file():
                        return self.send_json(404, {'error': 'source_archive_not_bundled'})
                    body = solo_about.SOURCE_ARCHIVE.read_bytes()
                    filename = 'CitizenTools-Source.zip'
                else:
                    body = solo_about.license_archive() if licenses else solo_about.release_markdown('en' if language == 'en' else 'de').encode('utf-8')
                    filename = 'CitizenTools-Licenses.zip' if licenses else 'CitizenTools-Release-Notes.txt'
                self.send_response(200)
                self.send_header('Content-Type', 'application/zip' if licenses else 'text/plain; charset=utf-8')
                self.send_header('Content-Disposition', 'attachment; filename="' + filename + '"')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
            except (OSError, ValueError):
                logging.exception('Bundled document download unavailable')
                self.send_json(503, {'error': 'about_unavailable'})
            return
        if path == '/api/solo/heartbeat':
            return self.send_json(200, {
                'ok': True, 'edition': 'solo', 'version': VERSION,
                'serverTime': datetime.now(timezone.utc).isoformat(),
            })
        if path == '/api/solo/sounds':
            return self.send_json(200, {'directory': str(self.runtime.sound_dir) if ipaddress.ip_address(self.client_address[0]).is_loopback else None,
                                        'names': sorted(SOUND_NAMES), 'sounds': self.runtime.sounds.catalog()})
        if path.startswith('/api/solo/sounds/'):
            name = path.removeprefix('/api/solo/sounds/')
            if name not in {f'{value}.wav' for value in SOUND_NAMES}:
                return self.send_json(404, {'error': 'sound_not_found'})
            try:
                source = self.runtime.sounds.path(name.removesuffix('.wav'))
                with source.open('rb') as stream:
                    body = stream.read(SOUND_MAX_BYTES + 1)
                if len(body) > SOUND_MAX_BYTES:
                    return self.send_json(413, {'error': 'sound_too_large'})
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, OSError):
                return self.send_json(404, {'error': 'sound_not_found'})
            return
        if path in {"/api/transfer/personal", "/api/transfer/personal/recovery"}:
            try:
                with backend.get_connection() as connection:
                    if path.endswith("/recovery"):
                        saved = backend.read_meta(connection, "personal_transfer_recovery")
                        if not saved:
                            return self.send_json(404, {"error": "transfer_no_recovery"})
                        return self.send_json(200, json.loads(saved))
                    row = connection.execute("SELECT value FROM app_state WHERE state_key = ?", (backend.STATE_KEY,)).fetchone()
                    document = transfer.export(json.loads(row[0]) if row else {}, backend.SHIP_IMAGE_DIR)
                return self.send_json(200, document)
            except (ValueError, OSError) as error:
                return self.send_json(400, {"error": str(error)})
        if path == "/api/solo/status":
            return self.send_json(200, self.runtime.status())
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith('/api/solo/sounds/'):
            name = path.removeprefix('/api/solo/sounds/')
            if name not in SOUND_NAMES:
                return self.send_json(404, {'error': 'sound_not_found'})
            try:
                payload = self.read_json_body(solo_sounds.MAX_REQUEST)
                sound = self.runtime.sounds.upload(name, payload)
                return self.send_json(200, {'ok': True, 'sound': sound})
            except ValueError as error:
                reason = str(error)
                return self.send_json(400, {'error': reason if reason.startswith('sound_') else 'sound_invalid_wav'})
            except OSError:
                logging.exception('Could not save personal WAV')
                return self.send_json(500, {'error': 'sound_save_failed'})
        if path in {"/api/transfer/personal/preview", "/api/transfer/personal/import"}:
            return self.handle_personal_transfer(path.endswith("/import"))
        if path in {"/api/solo/settings", "/api/solo/capture", "/api/solo/show", "/api/solo/hotkey-recording"}:
            if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                return self.send_json(403, {"error": "Die PC-Erfassung bitte direkt am PC einstellen."})
            try:
                payload = self.read_json_body(8192)
                if path.endswith("/hotkey-recording"):
                    if not isinstance(payload, dict) or type(payload.get("enabled")) is not bool or not re.fullmatch(r"[a-zA-Z0-9-]{8,80}", str(payload.get("session", ""))):
                        raise ValueError("Ungültige Tastenkürzel-Aufnahme.")
                    gate = self.runtime.hotkey_recording_gate
                    gate.update(payload["session"], payload["enabled"])
                    if payload["enabled"] and self.runtime.worker and self.runtime.worker.is_alive() and not gate.released.wait(1):
                        gate.update(payload["session"], False)
                        raise RuntimeError("Tastenkürzel noch belegt. Bitte erneut versuchen.")
                    return self.send_json(200, {"ok": True})
                if path.endswith("/settings"):
                    return self.send_json(200, self.runtime.save_settings(payload))
                if path.endswith("/show"):
                    if self.runtime.window:
                        self.runtime.window.show()
                        self.runtime.window.restore()
                elif payload.get("enabled") is True: self.runtime.start_capture()
                elif payload.get("enabled") is False: self.runtime.stop_capture()
                else: raise ValueError("enabled muss true oder false sein.")
                return self.send_json(200, self.runtime.status())
            except (ValueError, RuntimeError) as error:
                return self.send_json(400, {"error": str(error)})
        return super().do_POST()

    def handle_personal_transfer(self, apply):
        try:
            payload = self.read_json_body(transfer.MAX_BYTES)
            incoming, assets = transfer.parse(payload.get("document"))
            files = transfer.prepare_images(incoming, assets)
            mode = payload.get("mode", "merge")
            if mode not in {"merge", "replace"}:
                raise ValueError("transfer_invalid_file")
            with backend.get_connection() as connection:
                # get_connection holds DB_FILE_LOCK for this entire operation.
                row = connection.execute("SELECT value, updated_at FROM app_state WHERE state_key = ?", (backend.STATE_KEY,)).fetchone()
                current, revision = (json.loads(row[0]), row[1]) if row else ({}, None)
                target = transfer.merge(current, incoming, mode)
                if not apply:
                    return self.send_json(200, {"rows": transfer.preview(current, incoming), "revision": revision, "images": len(files)})
                if "baseRevision" not in payload or payload["baseRevision"] != revision:
                    return self.send_json(409, {"error": "transfer_conflict"})
                recovery = transfer.export(current, backend.SHIP_IMAGE_DIR)
                backend.SHIP_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
                for name, body in files.items():
                    destination = backend.SHIP_IMAGE_DIR / name
                    if not destination.exists():
                        temporary = destination.with_suffix(".tmp")
                        temporary.write_bytes(body)
                        temporary.replace(destination)
                updated = datetime.now(timezone.utc).isoformat()
                backend.write_meta(connection, "personal_transfer_recovery", json.dumps(recovery, ensure_ascii=False))
                connection.execute("INSERT INTO app_state (state_key,value,updated_at) VALUES (?,?,?) ON CONFLICT(state_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", (backend.STATE_KEY, json.dumps(solo_state(target), ensure_ascii=False), updated))
                backend.write_meta(connection, "last_state_write_at_solo", updated)
                backend.discover_state_locations(connection, target)
                connection.commit()
            return self.send_json(200, {"ok": True, "updatedAt": updated})
        except (ValueError, OSError) as error:
            return self.send_json(400, {"error": str(error)})

    def handle_post_state(self):
        try:
            payload = self.read_json_body(16 * 1024 * 1024)
            state = solo_state(payload.get("state"))
            import_ids = payload.get("importIds", [])
            if not isinstance(import_ids, list) or len(import_ids) > 500 or any(not isinstance(item, str) or not item or len(item) > 200 for item in import_ids):
                raise ValueError("Ungültige Auftragsimporte.")
        except ValueError as error: return self.send_json(400, {"error": str(error)})
        if "baseUpdatedAt" not in payload:
            return self.send_json(428, {"error": "Versionsstand fehlt. Bitte die Oberfläche neu laden."})
        with backend.get_connection() as connection:
            row = connection.execute("SELECT value, updated_at FROM app_state WHERE state_key = ?", (backend.STATE_KEY,)).fetchone()
            current = row["updated_at"] if row else None
            if payload["baseUpdatedAt"] != current:
                return self.send_json(409, {"error": "state_conflict", "updatedAt": current, "state": json.loads(row["value"]) if row else None, "scope": "solo"})
            # Importing and acknowledging are indivisible. Other windows may
            # have read the same pending OCR job, but only one can commit it.
            mission_imports = {str(item.get("sourceImportId", "")) for item in (state.get("missions") if isinstance(state.get("missions"), list) else []) if isinstance(item, dict)}
            for import_id in set(import_ids):
                pending = connection.execute("SELECT status FROM mission_imports WHERE import_id = ? AND scope = 'solo'", (import_id,)).fetchone()
                if not pending or pending["status"] != "pending" or import_id not in mission_imports:
                    return self.send_json(409, {"error": "import_already_handled", "updatedAt": current, "state": json.loads(row["value"]) if row else None, "scope": "solo"})
            if row and json.loads(row["value"]) == state and not import_ids:
                return self.send_json(200, {"ok": True, "scope": "solo", "updatedAt": current})
            updated = datetime.now(timezone.utc).isoformat()
            connection.execute("INSERT INTO app_state (state_key,value,updated_at) VALUES (?,?,?) ON CONFLICT(state_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", (backend.STATE_KEY, json.dumps(state, ensure_ascii=False), updated))
            backend.write_meta(connection, "last_state_write_at_solo", updated)
            backend.discover_state_locations(connection, state)
            for import_id in set(import_ids):
                connection.execute("UPDATE mission_imports SET status = 'imported', updated_at = ? WHERE import_id = ? AND scope = 'solo'", (updated, import_id))
            connection.commit()
        self.send_json(200, {"ok": True, "scope": "solo", "updatedAt": updated})
