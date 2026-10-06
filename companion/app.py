#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

from companion import capture as companion_capture
from companion.version import USER_AGENT
from shared.mission_import import ocr, service
from shared.mission_import.parser import PARSER_VERSION


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ONLINE_COMPANION_TOKEN_PREFIX = "ctc_"
MAX_PROCESSED_SIGNATURES = 5000
MAX_CAPTURE_QUEUE = 20


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_signature(path: Path) -> str:
    stats = path.stat()
    source = f"{path.resolve()}|{stats.st_size}|{stats.st_mtime_ns}".encode("utf-8")
    return hashlib.sha256(source).hexdigest()


def default_state_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return base / "CitizenToolsSolo" / "companion-state.json"


class CompanionState:
    def __init__(self, path: Path):
        self.path = path
        self.existed = path.is_file()
        self.processed: list[str] = []
        if self.existed:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                stored_version = int(payload.get("parserVersion") or 0)
                if stored_version >= PARSER_VERSION:
                    self.processed = [str(value) for value in payload.get("processed", [])][-MAX_PROCESSED_SIGNATURES:]
            except (OSError, json.JSONDecodeError, AttributeError, TypeError, ValueError):
                self.processed = []
        self._processed_set = set(self.processed)

    def contains(self, signature: str) -> bool:
        return signature in self._processed_set

    def mark(self, signature: str) -> None:
        if signature in self._processed_set:
            return
        self.processed.append(signature)
        self._processed_set.add(signature)
        if len(self.processed) > MAX_PROCESSED_SIGNATURES:
            removed = self.processed[:-MAX_PROCESSED_SIGNATURES]
            self.processed = self.processed[-MAX_PROCESSED_SIGNATURES:]
            self._processed_set.difference_update(removed)
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"parserVersion": PARSER_VERSION, "processed": self.processed}, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def clear(self) -> None:
        self.processed = []
        self._processed_set.clear()
        self.save()


def list_screenshots(folder: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ),
        key=lambda path: path.stat().st_mtime_ns,
    )


def list_screenshots_from_folders(folders: list[Path]) -> list[Path]:
    screenshots = []
    for folder in folders:
        screenshots.extend(list_screenshots(folder))
    return sorted(screenshots, key=lambda path: path.stat().st_mtime_ns)


def online_application_base_url(server_url: str) -> str:
    """Return the PHP application root for a web-app or operations-preview URL."""
    parsed = parse.urlsplit(str(server_url or "").strip())
    path = parsed.path.rstrip("/")
    for suffix in ("/operations-preview/index.php", "/operations-preview"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    return parse.urlunsplit((parsed.scheme, parsed.netloc, path.rstrip("/"), "", ""))


def parse_release_version(value: object) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"\s*(\d+)\.(\d+)\.(\d+)\s*", str(value or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def companion_release_url(server_url: str) -> str:
    return f"{online_application_base_url(server_url)}/downloads/companion-release.json"


def check_companion_update(server_url: str, current_version: str) -> dict | None:
    """Return a newer same-origin Companion release, or None when none is available."""
    installed = parse_release_version(current_version)
    if installed is None:
        return None
    manifest_url = companion_release_url(server_url)
    release_request = request.Request(
        manifest_url,
        headers={"Accept": "application/json", "Cache-Control": "no-cache", "User-Agent": USER_AGENT},
    )
    try:
        with request.urlopen(release_request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (error.HTTPError, error.URLError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None

    available = parse_release_version(payload.get("version") if isinstance(payload, dict) else None)
    installer = payload.get("installer") if isinstance(payload, dict) else None
    if available is None or available <= installed or not isinstance(installer, dict):
        return None
    download_value = str(installer.get("url") or "").strip()
    download_url = parse.urljoin(manifest_url, download_value)
    manifest_parts = parse.urlsplit(manifest_url)
    download_parts = parse.urlsplit(download_url)
    if (
        download_parts.scheme not in {"http", "https"}
        or download_parts.scheme != manifest_parts.scheme
        or download_parts.netloc != manifest_parts.netloc
    ):
        return None
    return {
        "version": ".".join(str(part) for part in available),
        "downloadUrl": download_url,
        "publishedAt": str(payload.get("publishedAt") or ""),
    }


def online_api_urls(server_url: str, endpoint: str) -> list[str]:
    """Use the short API URL first, then the PHP query-route fallback."""
    base_url = online_application_base_url(server_url)
    endpoint_parts = parse.urlsplit(endpoint)
    direct_url = f"{base_url}{endpoint}"
    route = parse.quote(endpoint_parts.path or "/", safe="")
    query = f"&{endpoint_parts.query}" if endpoint_parts.query else ""
    fallback_url = f"{base_url}/index.php?route={route}{query}"
    return [direct_url, fallback_url]


def open_online_api_request(
    server_url: str,
    endpoint: str,
    *,
    data: bytes | None = None,
    headers: dict | None = None,
    method: str = "GET",
    timeout: int = 15,
) -> dict:
    """Read a JSON API response, retrying through index.php when rewrites are unavailable."""
    urls = online_api_urls(server_url, endpoint)
    for index, api_url in enumerate(urls):
        api_request = request.Request(api_url, data=data, headers=headers or {}, method=method)
        try:
            with request.urlopen(api_request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as http_error:
            if http_error.code == 404 and index + 1 < len(urls):
                continue
            raise
    raise RuntimeError("Companion-API konnte nicht erreicht werden.")


def add_online_companion_authorization(headers: dict, token: str) -> None:
    """Send the browser-paired token through a hoster-safe fallback header too."""
    headers["Authorization"] = f"Bearer {token}"
    headers["X-Citizen-Companion-Token"] = token


def submit_import(server_url: str, token: str, payload: dict, user_token: str = "") -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    online_token = str(token or "").startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    request_payload = dict(payload)
    if online_token:
        add_online_companion_authorization(headers, token)
        # Browser-paired servers receive personal imports. Sharing happens in the web app.
        request_payload["scope"] = "solo"
    elif token:
        headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    try:
        return open_online_api_request(
            server_url,
            "/api/imports",
            data=body,
            headers=headers,
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError(
                "Companion-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        if http_error.code == 401:
            raise RuntimeError("Der Server hat den Companion-Zugang abgelehnt. Bitte die Verbindung erneut herstellen.") from http_error
        response_body = http_error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(response_body).get("message") or response_body
        except json.JSONDecodeError:
            message = response_body
        raise RuntimeError(f"Server rejected import ({http_error.code}): {message}") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def submit_import_progress(
    server_url: str,
    token: str,
    user_token: str = "",
    *,
    job_id: str,
    scope: str,
    device_id: str,
    device_name: str,
    status: str,
    source_file: str = "",
    message: str = "",
    queue_position: int = 0,
    import_id: str = "",
) -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    online_token = str(token or "").startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    if online_token:
        add_online_companion_authorization(headers, token)
        scope = "solo"
    elif token:
        headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    body = json.dumps(
        {
            "jobId": job_id,
            "scope": scope,
            "deviceId": device_id,
            "deviceName": device_name,
            "status": status,
            "sourceFile": source_file,
            "message": message,
            "queuePosition": queue_position,
            "importId": import_id,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    try:
        return open_online_api_request(
            server_url,
            "/api/imports/progress",
            data=body,
            headers=headers,
            method="POST",
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 401:
            raise RuntimeError("Der Server hat den Companion-Zugang abgelehnt. Bitte die Verbindung erneut herstellen.") from http_error
        if http_error.code == 404:
            raise RuntimeError("Die Fortschrittsanzeige benötigt einen aktualisierten Server.") from http_error
        raise RuntimeError(f"Server rejected import progress ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def reset_server_imports(server_url: str, token: str, scope: str, device_id: str) -> dict:
    body = json.dumps({"scope": scope, "deviceId": device_id}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["X-Import-Token"] = token
    try:
        return open_online_api_request(
            server_url,
            "/api/imports/reset",
            data=body,
            headers=headers,
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError(
                "Reset-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        if http_error.code == 401:
            raise RuntimeError("Der Server hat das Import-Token abgelehnt.") from http_error
        response_body = http_error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(response_body).get("message") or response_body
        except json.JSONDecodeError:
            message = response_body
        raise RuntimeError(f"Server rejected reset ({http_error.code}): {message}") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def start_online_companion_pairing(server_url: str, device_name: str) -> dict:
    body = json.dumps({"deviceName": str(device_name or "Companion").strip() or "Companion"}).encode("utf-8")
    try:
        payload = open_online_api_request(
            server_url,
            "/api/companion/pairings",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError("Dieser Server unterstützt noch keine Companion-Kopplung.") from http_error
        raise RuntimeError(f"Kopplung konnte nicht gestartet werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error

    pairing_id = str(payload.get("pairingId") or "").strip()
    poll_token = str(payload.get("pollToken") or "").strip()
    authorize_path = str(payload.get("authorizePath") or "").strip()
    if not pairing_id or not poll_token or not authorize_path.startswith("/"):
        raise RuntimeError("Der Server hat eine unvollständige Kopplungsanfrage geliefert.")
    return {
        "pairing_id": pairing_id,
        "poll_token": poll_token,
        "authorize_url": f"{online_application_base_url(server_url)}{authorize_path}",
        "expires_at": str(payload.get("expiresAt") or ""),
    }


def get_companion_capabilities(server_url: str) -> dict:
    try:
        payload = open_online_api_request(
            server_url,
            "/api/companion/capabilities",
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError("Dieser Citizen-Tools-Server unterstützt die automatische Companion-Erkennung noch nicht.") from http_error
        raise RuntimeError(f"Serverfähigkeiten konnten nicht gelesen werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    authentication = str(payload.get("authentication") or "").strip().lower()
    if not payload.get("ok") or authentication not in {"none", "token", "browser_pairing"}:
        raise RuntimeError("Der Server hat ungültige Companion-Fähigkeiten geliefert.")
    return payload


def get_online_companion_pairing(server_url: str, pairing_id: str, poll_token: str) -> dict:
    query = parse.urlencode({"pollToken": poll_token})
    try:
        return open_online_api_request(
            server_url,
            f"/api/companion/pairings/{parse.quote(pairing_id, safe='')}?{query}",
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 410:
            raise RuntimeError("Die Kopplungsanfrage ist abgelaufen. Bitte erneut starten.") from http_error
        raise RuntimeError(f"Kopplungsstatus konnte nicht geprüft werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def exchange_online_companion_pairing(server_url: str, pairing_id: str, poll_token: str) -> dict:
    try:
        payload = open_online_api_request(
            server_url,
            f"/api/companion/pairings/{parse.quote(pairing_id, safe='')}/exchange",
            data=json.dumps({"pollToken": poll_token}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 409:
            raise RuntimeError("Die Kopplung wurde noch nicht freigegeben oder bereits verwendet.") from http_error
        raise RuntimeError(f"Kopplung konnte nicht abgeschlossen werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    token = str(payload.get("token") or "").strip()
    if not token.startswith(ONLINE_COMPANION_TOKEN_PREFIX):
        raise RuntimeError("Der Server hat keinen gültigen Companion-Token geliefert.")
    return payload


def check_server_connection(
    server_url: str,
    token: str,
    *,
    scope: str = "solo",
    user_token: str = "",
) -> dict:
    headers = {"User-Agent": USER_AGENT}
    online_connection = token.startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    # A browser-paired server is reachable before the Companion owns a token.
    # Detect that path first so the UI can offer pairing instead of a legacy ping error.
    if not online_connection and scope != "dispatcher":
        try:
            capabilities = get_companion_capabilities(server_url)
        except RuntimeError:
            capabilities = {}
        authentication = str(capabilities.get("authentication") or "").strip().lower()
        if authentication in {"none", "browser_pairing"}:
            return capabilities
    if online_connection:
        add_online_companion_authorization(headers, token)
    if token:
        if not online_connection:
            headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    organization_scope = scope == "dispatcher"
    endpoint = "/api/companion/status" if online_connection else (
        "/api/auth/dispatcher/status" if organization_scope else "/api/imports/ping"
    )
    try:
        payload = open_online_api_request(
            server_url,
            endpoint,
            headers=headers,
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 401:
            if online_connection:
                raise RuntimeError("Der Online-Companion-Token wurde abgelehnt oder widerrufen.") from http_error
            raise RuntimeError(
                "Der Server hat den Organisations-Token abgelehnt."
                if organization_scope
                else "Der Server hat das Import-Token abgelehnt."
            ) from http_error
        if http_error.code == 404:
            raise RuntimeError(
                "Companion-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        raise RuntimeError(f"Server check failed ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    if not payload.get("ok"):
        raise RuntimeError("Server check failed.")
    if organization_scope and payload.get("enabled") and not payload.get("identity"):
        raise RuntimeError("Der persönliche Organisations-Token ist ungültig oder wurde gesperrt.")
    return payload


def build_import_payload(args: argparse.Namespace, image_path: Path, draft: dict) -> dict:
    captured_at = datetime.fromtimestamp(image_path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {
        "scope": args.scope,
        "deviceId": args.device_id,
        "deviceName": args.device_name,
        "pilotName": str(getattr(args, "pilot_name", "") or "").strip(),
        "imageHash": hash_file(image_path),
        "capturedAt": captured_at,
        "sourceFile": image_path.name,
        "draft": draft,
    }


def process_screenshot(
    args: argparse.Namespace,
    state: CompanionState,
    tesseract_path: str,
    image_path: Path,
    emit,
    job_id: str = "",
    report_progress=None,
) -> None:
    signature = file_signature(image_path)
    if state.contains(signature):
        return
    if time.time() - image_path.stat().st_mtime < args.settle_seconds:
        return

    emit(f"Reading {image_path.name} ...")
    if job_id and report_progress:
        report_progress(
            job_id,
            "processing",
            source_file=image_path.name,
            message="Texterkennung läuft",
        )
    draft, last_ocr_error = service.read_mission_screenshot(tesseract_path, image_path, emit)

    if not draft:
        if last_ocr_error:
            emit(f"OCR error: {last_ocr_error}", True)
        emit("No supported contract recognized.")
        if job_id and report_progress:
            report_progress(
                job_id,
                "failed",
                source_file=image_path.name,
                message="Kein unterstützter Auftrag erkannt",
            )
        state.mark(signature)
        return

    payload = build_import_payload(args, image_path, draft)
    try:
        result = submit_import(args.server, args.token, payload, user_token=getattr(args, "user_token", ""))
    except RuntimeError as submit_error:
        emit(str(submit_error), True)
        if job_id and report_progress:
            report_progress(
                job_id,
                "failed",
                source_file=image_path.name,
                message="Übertragung zum Server fehlgeschlagen",
            )
        return

    duplicate_note = " (already known)" if result.get("duplicate") else ""
    target_scope = str(result.get("scope") or args.scope)
    emit(f"Sent to {target_scope} import inbox{duplicate_note}.")
    if job_id and report_progress:
        report_progress(
            job_id,
            "completed",
            source_file=image_path.name,
            message="Auftrag erkannt und übertragen",
            import_id=str(result.get("id") or ""),
        )
    state.mark(signature)


def console_emit(message: str, is_error: bool = False) -> None:
    print(message, file=sys.stderr if is_error else sys.stdout, flush=True)


def run_companion(args: argparse.Namespace, stop_event=None, emit=console_emit) -> int:
    screenshots_value = getattr(args, "screenshots", None)
    args.screenshots = Path(screenshots_value).expanduser().resolve() if screenshots_value else None
    capture_folder_value = getattr(args, "capture_folder", None) or companion_capture.default_capture_folder()
    args.capture_folder = Path(capture_folder_value).expanduser().resolve()
    args.capture_retention = companion_capture.normalize_capture_retention(
        getattr(args, "capture_retention", companion_capture.DEFAULT_CAPTURE_RETENTION)
    )
    args.state_file = Path(args.state_file).expanduser().resolve()
    if not str(args.server).startswith(("http://", "https://")):
        raise ValueError("Server URL must start with http:// or https://")
    args.capture_folder.mkdir(parents=True, exist_ok=True)
    if args.screenshots and not args.screenshots.is_dir():
        raise ValueError(f"Screenshot folder not found: {args.screenshots}")
    watch_folders = []
    for folder in (args.screenshots, args.capture_folder):
        if folder and folder not in watch_folders:
            watch_folders.append(folder)

    tesseract_path = ocr.resolve_tesseract(args.tesseract)
    if not tesseract_path:
        raise ValueError("Tesseract OCR was not found. Install it locally or choose its executable.")

    emit("Checking server connection ...")
    check_server_connection(
        args.server,
        args.token,
        scope=args.scope,
        user_token=getattr(args, "user_token", ""),
    )
    emit("Server connection ready.")

    capture_requests: queue.Queue = queue.Queue(maxsize=MAX_CAPTURE_QUEUE)
    progress_requests: queue.Queue = queue.Queue(maxsize=MAX_CAPTURE_QUEUE * 8)
    capture_jobs_by_path: dict[str, str] = {}
    capture_jobs_lock = threading.Lock()
    capture_worker_stop = threading.Event()
    progress_worker_stop = threading.Event()
    progress_warning_emitted = False
    progress_queue_warning_emitted = False

    def report_capture_progress(job_id: str, status: str, **details) -> None:
        nonlocal progress_queue_warning_emitted
        update = {
            "job_id": job_id,
            "status": status,
            "details": details,
        }
        try:
            progress_requests.put_nowait(update)
        except queue.Full:
            if not progress_queue_warning_emitted:
                progress_queue_warning_emitted = True
                emit("Fortschrittswarteschlange voll · Statusanzeige kann verzögert sein", True)

    def run_progress_worker() -> None:
        nonlocal progress_warning_emitted
        while not progress_worker_stop.is_set() or not progress_requests.empty():
            try:
                update = progress_requests.get(timeout=0.25)
            except queue.Empty:
                continue
            details = update["details"]
            try:
                submit_import_progress(
                    args.server,
                    args.token,
                    user_token=getattr(args, "user_token", ""),
                    job_id=update["job_id"],
                    scope=args.scope,
                    device_id=args.device_id,
                    device_name=args.device_name,
                    status=update["status"],
                    source_file=str(details.get("source_file") or ""),
                    message=str(details.get("message") or ""),
                    queue_position=int(details.get("queue_position") or 0),
                    import_id=str(details.get("import_id") or ""),
                )
            except RuntimeError as progress_error:
                if not progress_warning_emitted:
                    progress_warning_emitted = True
                    emit(f"Fortschrittsanzeige nicht erreichbar: {progress_error}")
            finally:
                progress_requests.task_done()

    def capture_from_hotkey() -> None:
        job = {"id": str(uuid.uuid4()), "requestedAt": time.time()}
        try:
            capture_requests.put_nowait(job)
            report_capture_progress(
                job["id"],
                "queued",
                message="Aufnahme angefordert · Screenshot wird erstellt",
                queue_position=capture_requests.qsize(),
            )
            emit(f"Screenshot eingereiht · {capture_requests.qsize()} Aufnahme(n) warten")
        except queue.Full:
            emit(f"Aufnahmewarteschlange voll · maximal {MAX_CAPTURE_QUEUE} Screenshots", True)

    def run_capture_worker() -> None:
        while not capture_worker_stop.is_set():
            try:
                job = capture_requests.get(timeout=0.25)
            except queue.Empty:
                continue
            job_id = str(job.get("id") or "")
            try:
                output_path = companion_capture.capture_screen(
                    args.capture_folder,
                    getattr(args, "capture_mode", "active-monitor"),
                )
                with capture_jobs_lock:
                    capture_jobs_by_path[str(output_path.resolve())] = job_id
                report_capture_progress(
                    job_id,
                    "queued",
                    source_file=output_path.name,
                    message="Screenshot eingegangen · wartet auf Texterkennung",
                    queue_position=capture_requests.qsize() + 1,
                )
                emit(f"Screenshot erstellt: {output_path.name}")
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as capture_error:
                report_capture_progress(job_id, "failed", message="Screenshot konnte nicht erstellt werden")
                emit(str(capture_error), True)
            finally:
                capture_requests.task_done()

    progress_thread = threading.Thread(
        target=run_progress_worker,
        name="CitizenToolsProgressQueue",
        daemon=True,
    )
    capture_thread = threading.Thread(
        target=run_capture_worker,
        name="CitizenToolsCaptureQueue",
        daemon=True,
    )
    progress_thread.start()
    capture_thread.start()

    hotkey_listener = companion_capture.GlobalHotkeyListener(
        getattr(args, "capture_hotkey", companion_capture.DEFAULT_HOTKEY),
        capture_from_hotkey,
        getattr(args, "hotkey_recording_gate", None),
    )
    hotkey_started = False
    try:
        hotkey_listener.start()
        hotkey_started = True
        if hotkey_listener.registration_warning:
            emit(hotkey_listener.registration_warning)

        state = CompanionState(args.state_file)

        def capture_was_processed(path: Path) -> bool:
            try:
                return state.contains(file_signature(path))
            except OSError:
                return False

        existing = list_screenshots_from_folders(watch_folders)
        if not state.existed and not args.include_existing and not args.once:
            for image_path in existing:
                state.mark(file_signature(image_path))
            emit(f"Watching for new screenshots. Ignored {len(existing)} existing file(s).")
        for folder in watch_folders:
            emit(f"Watching {folder}")
        emit(f"Capture hotkey: {hotkey_listener.hotkey} | Target: {args.capture_folder}")
        pilot_note = f" | Pilot: {args.pilot_name}" if getattr(args, "pilot_name", "") else ""
        emit(f"Server: {args.server.rstrip('/')} | Inbox: {args.scope} | Device: {args.device_name}{pilot_note}")

        while stop_event is None or not stop_event.is_set():
            for image_path in list_screenshots_from_folders(watch_folders):
                if stop_event is not None and stop_event.is_set():
                    break
                path_key = str(image_path.resolve())
                with capture_jobs_lock:
                    job_id = capture_jobs_by_path.get(path_key, "")
                process_screenshot(
                    args,
                    state,
                    tesseract_path,
                    image_path,
                    emit,
                    job_id=job_id,
                    report_progress=report_capture_progress,
                )
                try:
                    processed = state.contains(file_signature(image_path))
                except OSError:
                    processed = False
                if processed and job_id:
                    with capture_jobs_lock:
                        capture_jobs_by_path.pop(path_key, None)
            deleted_captures = companion_capture.prune_managed_captures(
                args.capture_folder,
                args.capture_retention,
                can_delete=capture_was_processed,
            )
            if deleted_captures:
                emit(f"Removed {len(deleted_captures)} old Companion screenshot(s).")
            if args.once:
                break
            delay = max(0.5, args.interval)
            if stop_event is None:
                time.sleep(delay)
            elif stop_event.wait(delay):
                break
    finally:
        if hotkey_started:
            hotkey_listener.stop()
        capture_worker_stop.set()
        capture_thread.join(timeout=5)
        progress_worker_stop.set()
        progress_thread.join(timeout=5)
    emit("Companion stopped.")
    return 0


def create_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Citizen Tools local Star Citizen screenshot companion")
    parser.add_argument("--server", default=os.environ.get("CITIZEN_TOOLS_SERVER", "http://127.0.0.1:4173"))
    parser.add_argument("--token", default=os.environ.get("CARGO_PLANNER_IMPORT_TOKEN", ""))
    parser.add_argument("--user-token", default=os.environ.get("CITIZEN_TOOLS_USER_TOKEN", ""))
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--capture-folder", type=Path, default=companion_capture.default_capture_folder())
    parser.add_argument("--capture-hotkey", default=companion_capture.DEFAULT_HOTKEY)
    parser.add_argument("--capture-mode", choices=("active-monitor", "virtual-desktop"), default="active-monitor")
    parser.add_argument("--capture-retention", type=int, default=companion_capture.DEFAULT_CAPTURE_RETENTION)
    parser.add_argument("--scope", choices=("solo", "dispatcher"), default="solo")
    parser.add_argument("--pilot-name", default=os.environ.get("CITIZEN_TOOLS_PILOT", ""))
    parser.add_argument("--device-id", default=socket.gethostname())
    parser.add_argument("--device-name", default=socket.gethostname())
    parser.add_argument("--tesseract", default=os.environ.get("TESSERACT_CMD"))
    parser.add_argument("--state-file", type=Path, default=default_state_path())
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--settle-seconds", type=float, default=2.0)
    parser.add_argument("--include-existing", action="store_true")
    parser.add_argument("--once", action="store_true")
    return parser


def main() -> int:
    parser = create_argument_parser()
    args = parser.parse_args()
    try:
        return run_companion(args)
    except ValueError as configuration_error:
        parser.error(str(configuration_error))
    except KeyboardInterrupt:
        console_emit("Companion stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
