"""Check actual WebView2 WAV playback and live Companion phases in isolation."""
import argparse
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
    window = webview.create_window('Import audio verification', runtime.url, width=1100, height=850)
    result = {'ok': False}

    def check():
        def until(script, timeout=10):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                if window.evaluate_js(script): return
                time.sleep(.1)
            raise AssertionError(script)

        def phase(job_id, state):
            body = json.dumps({'jobId':job_id, 'scope':'solo', 'status':state, 'deviceId':'sound-test'}).encode()
            with request.urlopen(request.Request(runtime.url + '/api/imports/progress', data=body, headers={'Content-Type':'application/json'})) as response:
                assert response.status == 200

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated", 30)
            window.evaluate_js("""(() => {
                window.testImportPlayed = []; window.testSourcesStarted = 0;
                const Native = window.AudioContext;
                window.AudioContext = class extends Native {
                    constructor(...args) { super(...args); window.testAudioContext = this; }
                    createBufferSource() {
                        const source = super.createBufferSource(), start = source.start.bind(source);
                        source.start = (...args) => { window.testSourcesStarted++; return start(...args); };
                        return source;
                    }
                };
                const play = window.soloSound.playImport;
                window.soloSound.playImport = async name => {
                    const duration = await play(name);
                    if (duration > 0) window.testImportPlayed.push(name);
                    return duration;
                };
                const enabled = document.querySelector('#soloSoundEnabled'); enabled.checked = true;
                enabled.dispatchEvent(new Event('change'));
                const volume = document.querySelector('#soloSoundVolume'); volume.value = 5;
                volume.dispatchEvent(new Event('input'));
            })()""")
            # Establish a baseline before posting new jobs. No real screenshots.
            window.evaluate_js('void pollMissionImportProgress()')
            until('!missionImportProgressBusy')
            for status, sound in [('queued','import-read'), ('processing','import-processing'), ('completed','import-success')]:
                phase('audio-test-1', status)
                until(f'window.testImportPlayed.includes({json.dumps(sound)})')
            count = window.evaluate_js('window.testImportPlayed.length')
            window.evaluate_js('void pollMissionImportProgress()')
            until('!missionImportProgressBusy')
            assert window.evaluate_js('window.testImportPlayed.length') == count
            window.minimize()
            until('document.hidden')
            phase('audio-test-2', 'failed')
            until("window.testImportPlayed.includes('import-failure')")
            assert window.evaluate_js('window.testSourcesStarted') == 4
            result.update(ok=True, played=window.evaluate_js('window.testImportPlayed'), background=True,
                          audioState=window.evaluate_js('window.testAudioContext.state'), errors=window.evaluate_js('window.soloErrors'))
        except Exception as error:
            result.update(error=str(error), audioState=window.evaluate_js('window.testAudioContext?.state'), played=window.evaluate_js('window.testImportPlayed'), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'import-sound-window-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
