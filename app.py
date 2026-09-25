"""Citizen Tools Solo: one Windows window, server and capture process."""
from __future__ import annotations

import argparse
import ctypes
import json
import logging
import os
import sys
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib import request

from runtime import SoloRuntime, VERSION, default_data_root


def main():
    parser = argparse.ArgumentParser(description="Citizen Tools Solo")
    parser.add_argument("--headless", action="store_true", help="Server ohne App-Fenster (Diagnose)")
    parser.add_argument("--no-capture", action="store_true")
    parser.add_argument("--localhost", action="store_true")
    parser.add_argument("--port", type=int)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--smoke-test", action="store_true", help="Gebündelten Server prüfen und beenden")
    parser.add_argument("--smoke-window", action="store_true", help="App-Fenster laden, Ergebnis speichern und beenden")
    args = parser.parse_args()
    if args.smoke_window and not args.data_dir:
        parser.error("--smoke-window benötigt einen separaten --data-dir für Testdaten.")
    root = args.data_dir or default_data_root()
    root.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, handlers=[RotatingFileHandler(root / "solo.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")])
    runtime = SoloRuntime(root, port=args.port, lan=False if args.localhost else None)
    tray = None
    try:
        try:
            runtime.start(capture_enabled=not (args.no_capture or args.smoke_test or args.smoke_window))
        except OSError:
            # Reopening the installed app brings its existing window forward.
            # Explicit test/data-directory invocations keep reporting collisions.
            if not args.data_dir and not args.headless:
                existing = f"http://127.0.0.1:{runtime.settings['port']}"
                try:
                    with request.urlopen(existing + "/api/solo/status", timeout=2) as response:
                        payload = json.load(response)
                    if payload.get("edition") == "solo":
                        req = request.Request(existing + "/api/solo/show", data=b"{}", headers={"Content-Type":"application/json"})
                        with request.urlopen(req, timeout=2): pass
                        return 0
                except Exception: pass
            raise
        if args.smoke_test:
            with request.urlopen(runtime.url + "/api/solo/status", timeout=5) as response:
                status = json.load(response)
            with request.urlopen(runtime.url + "/", timeout=5) as response:
                assert b"Solo" in response.read()
            assert status["edition"] == "solo" and status["ocrAvailable"]
            (root / "smoke-result.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
            return 0
        if args.headless:
            print(runtime.url, flush=True)
            while True: time.sleep(0.5)
        import webview
        from companion.tray import WindowsTrayIcon
        webview.settings["ALLOW_DOWNLOADS"] = True
        # Only the native window gets this presentation hint. Browser clients,
        # including browsers on the same PC, retain their fullscreen controls.
        window = webview.create_window(f"Citizen Tools · Flight Deck · {VERSION}", runtime.desktop_url, width=1440, height=960, min_size=(800, 600), background_color="#08111b")
        runtime.window = window
        close_state = {"checking": False, "confirmed": False}
        def can_close():
            if close_state["confirmed"]: return True
            if close_state["checking"]: return False
            close_state["checking"] = True
            def check_pending():
                # WebView evaluation marshals to the UI thread. Never wait for
                # it inside the synchronous Windows closing event itself.
                try:
                    if window.evaluate_js("Boolean(soloPending || soloSaving || remoteSaveTimer)"):
                        window.evaluate_js("void flushSoloState(); void showAppNotice(currentUiLanguage()==='en'?'Changes are still being saved. Please close again after saving.':'Änderungen werden noch gespeichert. Bitte nach dem Speichern erneut schließen.')")
                        return
                    close_state["confirmed"] = True
                    window.destroy()
                except Exception:
                    logging.exception("Could not check pending UI state on close")
                    close_state["confirmed"] = True
                    window.destroy()
                finally: close_state["checking"] = False
            threading.Thread(target=check_pending, name="SoloClose", daemon=True).start()
            return False
        window.events.closing += can_close
        def action(name):
            if name == "exit": window.destroy()
            elif name == "start": runtime.start_capture()
            elif name == "stop": runtime.stop_capture()
            else:
                window.show()
                window.restore()
        tray = WindowsTrayIcon(action)
        tray.start()
        runtime.on_status = lambda: tray.update_state(runtime.capture_ready, "Fehler" if runtime.capture_error else "Lokal verbunden")
        runtime.on_status()
        if args.smoke_window:
            def check_window():
                result = {}
                try:
                    deadline = time.monotonic() + 30
                    while time.monotonic() < deadline:
                        result = window.evaluate_js("({errors:window.soloErrors||[],startup:window.soloStartup?.phase})")
                        if result.get("startup") in {"ready", "failed"}: break
                        time.sleep(0.1)
                    if result["errors"] or result.get("startup") != "ready":
                        raise RuntimeError("Die Oberfläche wurde nicht vollständig geladen.")
                    if not window.evaluate_js("Boolean(document.querySelector('#flightLocalClock')?.getClientRects().length)"):
                        raise RuntimeError("Die aktuelle Oberfläche mit Ortszeit wurde nicht geladen.")
                    def click(selector, expected_page):
                        # Exercise registered handlers, not setActivePage().
                        actual = window.evaluate_js(f"""(() => {{
                            const button = document.querySelector({json.dumps(selector)});
                            if (!button || button.disabled || !button.getClientRects().length) throw new Error('Schaltfläche fehlt: ' + {json.dumps(selector)});
                            button.click();
                            return document.querySelector('.page-section.is-active')?.dataset.page;
                        }})()""")
                        if actual != expected_page: raise RuntimeError(f"Klick auf {selector}: {actual!r} statt {expected_page!r}")
                    clicks = 0
                    for target in ["create", "fleet"]:
                        click(f'.flight-quick-actions [data-go-page="{target}"]', target)
                        click('[data-module-target="hub"]', 'hub')
                        clicks += 2
                    for module, page in [("finance", "finance"), ("fleet", "fleet"), ("statistics", "statistics"), ("hub", "hub"), ("cargo", "create")]:
                        click(f'[data-module-target="{module}"]', page)
                        clicks += 1
                    for page in ["create", "run", "overview"]:
                        click(f'[data-page-target="{page}"]', page)
                        clicks += 1
                    click('#settingsMenuButton', 'settings')
                    clicks += 1
                    for view in ["profile", "companion", "transfer", "about", "database"]:
                        click(f'[data-settings-view-target="{view}"]', 'settings')
                        if window.evaluate_js("document.querySelector('[data-settings-view].is-active')?.dataset.settingsView") != view:
                            raise RuntimeError(f"Einstellungsbereich {view} wurde nicht geöffnet.")
                        if view == 'about':
                            about_deadline = time.monotonic() + 15
                            while time.monotonic() < about_deadline:
                                if window.evaluate_js("document.querySelectorAll('#soloAboutContent [data-release]').length > 0"):
                                    break
                                time.sleep(.1)
                            if window.evaluate_js("document.querySelector('#soloAboutVersion')?.textContent") != 'v' + VERSION:
                                raise RuntimeError('Die verpackten Lizenz-/Versionsinformationen fehlen.')
                        clicks += 1
                    for page in ["ships", "systems"]:
                        click(f'[data-settings-go="{page}"]', page)
                        clicks += 1
                        click('#settingsMenuButton', 'settings')
                        clicks += 1
                    window.evaluate_js("state.backupReminderDays=14; persist();")
                    time.sleep(2)
                    result = window.evaluate_js("({title:document.title,ready:window.soloAppReady,errors:window.soloErrors||[],loadErrors:window.soloLoadErrors||[],saved:remoteStatus.connected,revision:soloRevision,settings:!!document.querySelector('#soloSettingsForm')})")
                    result['clicks'] = clicks
                    (root / "window-result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
                except Exception as error:
                    result.setdefault("errors", []).append(str(error))
                    (root / "window-result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
                finally:
                    # Tests use an explicit separate data directory. A failed
                    # assertion must not leave a test window/server running.
                    close_state["confirmed"] = True
                    window.destroy()
            webview.start(check_window, gui="edgechromium", private_mode=False, storage_path=str(root / "WebView"))
            report = json.loads((root / "window-result.json").read_text(encoding="utf-8"))
            return 0 if not report.get("errors") and report.get("saved") else 1
        else:
            webview.start(gui="edgechromium", private_mode=False, storage_path=str(root / "WebView"))
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        logging.exception("Solo application failed")
        if not args.headless and not args.smoke_test and os.name == "nt":
            ctypes.windll.user32.MessageBoxW(None, f"Citizen Tools Solo konnte nicht gestartet werden.\n\n{error}\n\nDiagnose: {root / 'solo.log'}", "Citizen Tools Solo", 0x10)
        else:
            raise
        return 1
    finally:
        if tray: tray.stop()
        runtime.stop()


if __name__ == "__main__":
    raise SystemExit(main())
