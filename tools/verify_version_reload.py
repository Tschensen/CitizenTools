"""Verify automatic external-view updates and protected drafts in native WebView2."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime, VERSION


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    port = runtime.httpd.server_port
    pc = webview.create_window('Update check: Windows app', runtime.desktop_url, width=1280, height=800)
    browser = webview.create_window('Update check: external view', runtime.url.replace('127.0.0.1', 'localhost'), width=800, height=720)
    report = {'ok': False, 'checks': []}

    def check():
        nonlocal runtime

        def until(window, expression):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(expression):
                        return
                except Exception:
                    pass
                time.sleep(.15)
            raise AssertionError(expression)

        def expect(window, expression, name):
            assert window.evaluate_js(expression), name
            report['checks'].append(name)

        def ready(window):
            until(window, "window.soloStartup?.phase==='ready' && soloSync.status.hydrated && !soloSync.status.pending && !soloSync.status.saving && !soloSync.status.busy && !missionAutoImportBusy")

        def probe(window):
            window.evaluate_js('window.updateProbeDone=false;soloConnection.probe().then(()=>window.updateProbeDone=true)')
            until(window, 'window.updateProbeDone')

        def refreshed():
            until(browser, "window.soloClientVersion===" + json.dumps(VERSION) + " && window.soloStartup?.phase==='ready' && soloSync.status.hydrated && soloConnection.phase==='online'")

        try:
            for window in [pc, browser]:
                ready(window)
            browser.evaluate_js("setActivePage('run')")
            runtime.stop()
            until(browser, "soloConnection.phase==='offline'")
            for window in [pc, browser]:
                window.evaluate_js("window.soloClientVersion='0.0.0'")
            runtime = SoloRuntime(args.data_dir, port=port, lan=False)
            runtime.start(capture_enabled=False)
            refreshed()
            expect(browser, "activePage==='run' && soloConnectionBanner.hidden", 'external-view-reloads-after-server-update-and-restores-flight-plan')
            until(pc, "soloConnection.phase==='update-required'")
            expect(pc, "window.soloClientVersion==='0.0.0' && !soloConnectionBanner.hidden", 'windows-app-does-not-auto-reload')

            ready(browser)
            browser.evaluate_js("""setActivePage('create');missionForm.elements.title.focus();
              missionForm.elements.title.value='Entwurf behalten';missionForm.elements.title.dispatchEvent(new Event('input',{bubbles:true}));
              missionForm.elements.title.blur();window.soloClientVersion='0.0.0';""")
            probe(browser)
            expect(browser, "window.soloClientVersion==='0.0.0' && soloConnection.phase==='update-required' && missionForm.elements.title.value==='Entwurf behalten'", 'blurred-unsaved-form-is-preserved')
            probe(browser)
            expect(browser, "missionForm.elements.title.value==='Entwurf behalten' && window.soloClientVersion==='0.0.0'", 'repeated-heartbeat-keeps-draft')
            browser.evaluate_js("missionForm.reset();setActivePage('run')")
            browser.evaluate_js('void soloConnection.probe()')
            refreshed()
            expect(browser, "activePage==='run'", 'resetting-draft-allows-automatic-update')

            ready(browser)
            browser.evaluate_js("sessionStorage.setItem('citizen-tools:version-reload',JSON.stringify({from:'0.0.0',to:window.soloClientVersion,page:'run'}));window.soloClientVersion='0.0.0'")
            probe(browser)
            probe(browser)
            expect(browser, "window.soloClientVersion==='0.0.0' && soloConnection.phase==='update-required'", 'stale-cache-reload-loop-is-blocked')
            browser.load_url(runtime.url.replace('127.0.0.1', 'localhost') + '/?verify=fresh')
            refreshed()

            # Last scenario: a pending edit intentionally prevents navigation.
            # Do not mutate the coordinator's private queue to bypass that guard.
            ready(browser)
            browser.evaluate_js("state.currentLocation='Area18';soloSync.schedule(state);window.soloClientVersion='0.0.0'")
            probe(browser)
            expect(browser, "window.soloClientVersion==='0.0.0' && soloSync.status.pending && localStorage.getItem(`${STORAGE_KEY}:conflict-recovery`)", 'pending-save-is-protected-and-recoverable')
            report['errors'] = [window.evaluate_js('window.soloErrors') for window in [pc, browser]]
            assert not any(report['errors']), report['errors']
            report['ok'] = True
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc())
        finally:
            (args.data_dir / 'version-reload-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            for window in [pc, browser]:
                window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=False, storage_path=str(args.data_dir / 'WebView'))
    finally:
        runtime.stop()
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
