"""Native update UI with local release fixtures. Never downloads or installs software."""
import argparse
import json
from pathlib import Path
import sys
import threading
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
import webview
from app import NativeUpdates
from runtime import SoloRuntime
from solo_updates import UpdateError
from test_updates import fixture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):
        parser.error('Use a new empty test directory')
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    client, _, _, body = fixture('99.0.0')
    release_download = threading.Event()
    def download(asset, destination, progress, cancelled):
        progress(5, len(body))
        while not release_download.wait(.05):
            if cancelled.is_set(): raise UpdateError('update_cancelled')
        destination.write_bytes(body)
        progress(len(body), len(body))
    client.download.side_effect = download
    runtime.updates.client, runtime.updates.mode = client, 'portable'
    runtime.updates.program = args.data_dir / 'fixture-program'
    runtime.updates.program.mkdir()
    (runtime.updates.program / 'CitizenTools-Updater.exe').write_text('not executable; UI test only')
    installed = []
    runtime.updates.launch_installer = lambda version, restart_args: installed.append(version)
    completed = threading.Event()
    api = NativeUpdates(runtime, [], completed.set)
    window = webview.create_window('Citizen Tools update UI verification', runtime.desktop_url, width=1366, height=768, js_api=api)
    runtime.window = window
    result = {'ok': False, 'checks': []}
    def check():
        def until(script, timeout=20):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)
        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)
        try:
            until("window.soloStartup?.phase==='ready' && soloSync.status.hydrated && typeof window.pywebview?.api?.install_update==='function'")
            window.evaluate_js("settingsMenuButton.click();document.querySelector('[data-settings-view-target=about]').click()")
            until('!soloUpdateCheck.disabled')
            window.evaluate_js('soloUpdateCheck.click()')
            until('!soloUpdateBanner.hidden')
            expect('soloUpdateBackdrop.hidden && !soloUpdateReview.hidden', 'quiet-available-notice-without-forced-dialog')
            assert client.download.call_count == 0
            window.evaluate_js('soloUpdateReview.click()')
            until('!soloUpdateBackdrop.hidden')
            expect("soloUpdateNotes.textContent.includes('Funktion') && !soloUpdateDownload.hidden && soloUpdateInstall.hidden", 'german-whats-new-before-download')
            expect("document.querySelector('.app-shell').inert && document.activeElement===soloUpdateNotes", 'dialog-focus-and-background-protection')
            expect("document.querySelector('.solo-update-dialog').scrollWidth <= document.querySelector('.solo-update-dialog').clientWidth+1", 'hd-ready-dialog-no-horizontal-overflow')
            window.evaluate_js('soloUpdateDownload.click()')
            until('!soloUpdateProgress.hidden && soloUpdateProgress.value>0')
            expect('soloUpdateInstall.hidden && soloUpdateDownload.disabled', 'download-progress-without-premature-install')
            window.evaluate_js('soloUpdateCancel.click()')
            until("soloUpdateDialogStatus.textContent.includes('abgebrochen')")
            expect('soloUpdateInstall.hidden', 'cancel-does-not-install')
            release_download.set()
            window.evaluate_js('soloUpdateDownload.click()')
            until('!soloUpdateInstall.hidden')
            window.evaluate_js('soloUpdateClose.click()')
            expect("!document.querySelector('.app-shell').inert", 'closing-dialog-restores-background')
            window.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));soloUpdateReview.click()")
            expect("soloUpdateNotes.textContent.includes('Feature') && soloUpdateInstall.textContent==='Install and restart'", 'english-whats-new-and-actions')
            if window.evaluate_js('!soloUpdateDrafts.hidden'):
                expect('soloUpdateInstall.disabled', 'unsaved-forms-require-explicit-decision')
                window.evaluate_js("soloUpdateDraftConfirm.checked=true;soloUpdateDraftConfirm.dispatchEvent(new Event('change',{bubbles:true}))")
            window.evaluate_js('missionAutoImportBusy=true;soloUpdateInstall.click()')
            until("soloUpdateDialogStatus.textContent.includes('import is running')")
            assert not installed
            result['checks'].append('active-import-blocks-native-handoff')
            window.evaluate_js('missionAutoImportBusy=false;soloUpdateClose.click();window.savedUpdateBridge=window.pywebview.api.install_update;window.pywebview.api.install_update=undefined;window.soloUpdates.render()')
            expect('soloUpdateCheck.disabled && soloUpdateAutomatic.disabled', 'browser-cannot-control-pc-updater')
            window.evaluate_js('soloUpdateReview.click()')
            expect('soloUpdateDownload.hidden && soloUpdateInstall.hidden', 'additional-devices-see-notes-without-install')
            window.evaluate_js('soloUpdateClose.click();window.pywebview.api.install_update=window.savedUpdateBridge;window.soloUpdates.render();soloUpdateReview.click();soloUpdateDraftConfirm.checked=true;window.soloUpdates.render();soloUpdateInstall.click()')
            assert completed.wait(15), 'Native bridge did not complete'
            assert installed == ['99.0.0'], installed
            result['checks'].append('reviewed-update-handoff-through-native-bridge')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as exc:
            result.update(error=str(exc), traceback=traceback.format_exc(), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir / 'updates-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()
    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
