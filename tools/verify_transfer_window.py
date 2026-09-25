"""Exercise file selection, preview, cancellation, import and export in WebView2."""
import argparse
import json
from pathlib import Path
import sys
import time
from urllib import request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
import webview
from runtime import SoloRuntime
from test_personal_transfer import fixture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    window = webview.create_window('Transfer UI test', runtime.url, width=1200, height=920)
    result = {'ok': False}

    def check():
        def evaluate(script):
            return window.evaluate_js(script)

        def until(script):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    if evaluate(script): return
                except Exception:
                    pass  # Navigation briefly destroys the old JS context.
                time.sleep(.1)
            raise AssertionError(script + '\n' + str(evaluate("({errors:window.soloErrors,status:document.querySelector('#personalTransferStatus')?.textContent})")))

        def choose(document):
            evaluate("document.querySelector('#settingsMenuButton').click(); document.querySelector('[data-settings-view-target=transfer]').click();")
            evaluate(f"""(() => {{
                const file = new File([{json.dumps(json.dumps(document))}], 'transfer-test.json', {{type:'application/json'}});
                const data = new DataTransfer(); data.items.add(file);
                const input = document.querySelector('#personalTransferFile'); input.files = data.files;
                input.dispatchEvent(new Event('change', {{bubbles:true}}));
            }})()""")

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated")
            document = fixture()
            document['state']['missions'][0].update(type='other', client='Transfer client', futurePersonalField='preserved')
            document['state']['shipLibrary'][0]['futurePersonalField'] = 'preserved'
            choose(document)
            until("!document.querySelector('#personalTransferPreview').hidden && !window.personalTransferBusy")
            assert evaluate("document.querySelectorAll('#personalTransferRows tr').length") == 5
            evaluate("document.querySelector('#personalTransferApply').click()")
            until("!document.querySelector('#missionConfirmDialog').hidden")
            evaluate("document.querySelector('#missionConfirmDialogCancel').click()")
            until("!window.personalTransferBusy")
            assert evaluate("state.missions.length") == 0
            evaluate("document.querySelector('#personalTransferApply').click()")
            until("!document.querySelector('#missionConfirmDialog').hidden")
            evaluate("document.querySelector('#missionConfirmDialogConfirm').click()")
            until("window.soloStartup?.phase === 'ready' && soloHydrated && state.missions.length === 1 && !window.personalTransferBusy")
            # A regular subsequent save must retain contacts and online-only personal fields.
            evaluate("state.missions[0].notes='Edited offline'; persist();")
            until("!soloPending && !soloSaving && !remoteSaveTimer")
            with request.urlopen(runtime.url + '/api/transfer/personal') as response:
                exported = json.load(response)
            assert exported['state']['contacts'][0]['notes'] == 'Persönliche Notiz'
            assert exported['state']['missions'][0]['client'] == 'Transfer client'
            assert exported['state']['missions'][0]['futurePersonalField'] == 'preserved'
            assert next(ship for ship in exported['state']['shipLibrary'] if ship['id'] == 'ship-test')['futurePersonalField'] == 'preserved'
            assert len(exported['images']) == 1
            choose({})
            until("!window.personalTransferBusy")
            assert evaluate("document.querySelector('#personalTransferPreview').hidden")
            assert evaluate("state.missions.length") == 1
            # Capture the actual download Blob without opening a native save dialog.
            evaluate("HTMLAnchorElement.prototype.click = function() { if(this.download) fetch(this.href).then(r=>r.json()).then(x=>window.testDownloadedTransfer=x); };")
            evaluate("document.querySelector('#personalTransferExport').click()")
            until("!!window.testDownloadedTransfer")
            assert evaluate("window.testDownloadedTransfer.format") == 'citizen-tools-personal-transfer'
            result.update(ok=True, checks=['preview', 'cancel', 'import', 'reload', 'contacts-after-save', 'online-fields-after-save', 'embedded-image', 'invalid-file', 'export-download'], errors=evaluate('window.soloErrors'))
        except Exception as error:
            result['error'] = str(error)
        finally:
            (args.data_dir / 'transfer-window-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
