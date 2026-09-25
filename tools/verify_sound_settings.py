"""Exercise per-cue WAV upload, default selection, gain and restart in WebView2."""
import argparse
import base64
import json
from pathlib import Path
import sys
import time
from urllib import request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    window = webview.create_window('Sound settings verification', runtime.url, width=1250, height=920)
    result = {'ok': False}
    prefix = 'document.querySelector(\'.solo-cue-row[data-sound="navigation"]\')'

    def check():
        def until(script):
            end = time.monotonic() + 25
            while time.monotonic() < end:
                try:
                    if window.evaluate_js(script): return
                except Exception:
                    pass  # A reload briefly destroys the document.
                time.sleep(.1)
            raise AssertionError(script)

        def choose(body, filename):
            encoded = base64.b64encode(body).decode()
            window.evaluate_js(f"""(() => {{
                const row = {prefix}, data = new DataTransfer();
                data.items.add(new File([Uint8Array.from(atob({json.dumps(encoded)}), char => char.charCodeAt(0))], {json.dumps(filename)}, {{type:'audio/wav'}}));
                const input = row.querySelector('[data-cue-file]'); input.files = data.files;
                input.dispatchEvent(new Event('change', {{bubbles:true}}));
            }})()""")

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated && window.soloSound.catalog().navigation")
            window.evaluate_js("document.querySelector('#settingsMenuButton').click(); document.querySelector('[data-settings-view-target=profile]').click()")
            assert window.evaluate_js("document.querySelectorAll('.solo-cue-row').length") == 9
            assert not window.evaluate_js("document.querySelector('#soloSoundPanel').textContent.includes('LCARS')")
            window.evaluate_js(f"const gainInput = {prefix}.querySelector('[data-cue-volume]'); gainInput.value=35; gainInput.dispatchEvent(new Event('input'))")
            clip = (ROOT/'web/assets/sounds/import-success.wav').read_bytes()
            choose(clip, 'Personal signal.wav')
            until(f"{prefix}.querySelector('[data-cue-source]').value === 'custom' && !{prefix}.querySelector('[data-cue-choose]').disabled")
            with request.urlopen(runtime.url + '/api/solo/sounds/navigation.wav') as response:
                assert response.read() == clip
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-source]').selectedOptions[0].textContent") == 'Personal signal.wav'
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-volume]').value") == '35'
            window.evaluate_js(f"const sourceInput={prefix}.querySelector('[data-cue-source]'); sourceInput.value='standard'; sourceInput.dispatchEvent(new Event('change'))")
            choose(b'not a valid audio file', 'Invalid.wav')
            until(f"!{prefix}.querySelector('.solo-cue-message').hidden && !{prefix}.querySelector('[data-cue-choose]').disabled")
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-source]').value") == 'standard'
            with request.urlopen(runtime.url + '/api/solo/sounds/navigation.wav') as response:
                assert response.read() == clip
            window.evaluate_js('window.location.reload()')
            until("window.soloStartup?.phase === 'ready' && window.soloSound.catalog().navigation")
            window.evaluate_js("document.querySelector('#settingsMenuButton').click(); document.querySelector('[data-settings-view-target=profile]').click()")
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-source]').value") == 'standard'
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-volume]').value") == '35'
            assert window.evaluate_js(f"{prefix}.querySelector('[data-cue-source]').options[1].textContent") == 'Personal signal.wav'
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, checks=['nine-cues', 'format-text', 'per-cue-volume', 'file-upload', 'filename', 'default', 'invalid-file-preserves-selection', 'reload'], errors=errors)
        except Exception as error:
            result.update(error=str(error), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'sound-settings-window-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
