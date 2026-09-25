"""Warm an old HTML cache, then reuse that WebView2 profile after an update."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import traceback
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runtime as app_runtime
import webview


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--phase', choices=['warm', 'upgrade'])
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    if not args.phase:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        for phase in ['warm', 'upgrade']:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), '--data-dir', str(args.data_dir.resolve()),
                            '--phase', phase, '--port', str(port)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        print((args.data_dir/'upgrade-result.json').read_text(encoding='utf-8'))
        return 0

    if args.phase == 'warm':
        class CachedHandler(app_runtime.SoloHandler):
            def is_interface_resource(self):
                return False  # Model a release predating the no-store policy.

            def do_GET(self):
                if urlparse(self.path).path != '/':
                    return super().do_GET()
                body = b'<html lang="de"><body><span>SHIP TIME / UTC</span><time id="flightClock">12:00:00</time><div id="oldClockPage">old</div></body></html>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'max-age=86400')
                self.end_headers()
                self.wfile.write(body)
        app_runtime.SoloHandler = CachedHandler

    runtime = app_runtime.SoloRuntime(args.data_dir, port=args.port, lan=False)
    runtime.start(capture_enabled=False)
    old_url = runtime.url + '/?desktop=1'
    window = webview.create_window('Clock update verification', old_url, width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        def until(script, timeout=25):
            end = time.monotonic()+timeout
            while time.monotonic() < end:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        try:
            until("document.querySelector('#flightClock')")
            if args.phase == 'warm':
                expect("document.querySelector('#oldClockPage') && !document.querySelector('#flightLocalClock')", 'old-utc-only-page-loaded')
                window.evaluate_js("localStorage.setItem('clock-update-test','keep-this-setting')")
            else:
                expect("Boolean(document.querySelector('#oldClockPage'))", 'old-page-reproduced-from-persistent-cache')
                window.load_url(runtime.desktop_url)
                until("window.soloStartup?.phase === 'ready' && soloHydrated && remoteHydrationComplete && !soloSaving && soloConnection.phase==='online'")
                expect("localStorage.getItem('clock-update-test')==='keep-this-setting'", 'update-keeps-browser-settings')
                expect("flightClockLabel.textContent==='Schiffszeit / UTC' && flightLocalClockLabel.textContent==='Ortszeit'", 'german-clock-labels')
                expect("flightLocalClock.dateTime===flightClock.dateTime && /^\\d{2}:\\d{2}:\\d{2}$/.test(flightLocalClock.textContent)", 'both-clocks-running')
                for width, height in [(1280,720),(768,1024),(390,844)]:
                    window.resize(width, height)
                    until(f'innerWidth <= {width}')
                    expect("(() => {const a=flightClock.getBoundingClientRect(),b=flightLocalClock.getBoundingClientRect(),h=document.querySelector('.brand-lockup');return a.width>0&&b.width>0&&Math.abs(a.top-b.top)<2&&b.left>=a.right&&b.right<=innerWidth&&h.scrollWidth<=h.clientWidth+1;})()", f'labels-and-clocks-fit-{width}')
                window.resize(1280,720)
                window.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
                expect("flightClockLabel.textContent==='Ship time / UTC' && flightLocalClockLabel.textContent==='Local time'", 'english-clock-labels')
                until('!soloPending && !soloSaving && !remoteSaveTimer')
                result['beforeReload'] = window.evaluate_js("({language:state.uiLanguage,base:soloBaseState?.uiLanguage,hydrated:remoteHydrationComplete,labels:[flightClockLabel.textContent,flightLocalClockLabel.textContent]})")
                # Setting WebView2.Source to the identical URI does not navigate.
                window.evaluate_js('window.__clockReloadMarker=true; setTimeout(()=>location.reload(),0)')
                until("!window.__clockReloadMarker && window.soloStartup?.phase==='ready' && soloHydrated")
                expect("flightClockLabel.textContent==='Ship time / UTC' && flightLocalClockLabel.textContent==='Local time'", 'language-and-new-interface-survive-reload')
                errors = window.evaluate_js('window.soloErrors')
                assert not errors, errors
                result['errors'] = errors
            result['ok'] = True
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc())
            try:
                result['diagnostic'] = window.evaluate_js("({url:location.href,phase:window.soloStartup,errors:window.soloErrors,loadErrors:window.soloLoadErrors,status:document.querySelector('#soloStartupStatus')?.textContent,hydrated:typeof soloHydrated!=='undefined'?soloHydrated:null,language:typeof state!=='undefined'?state.uiLanguage:null,labels:[document.querySelector('#flightClockLabel')?.textContent,document.querySelector('#flightLocalClockLabel')?.textContent]})")
            except Exception as diagnostic_error:
                result['diagnosticError'] = str(diagnostic_error)
        finally:
            (args.data_dir/f'{args.phase}-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=False, storage_path=str((args.data_dir/'WebView').resolve()))
    finally:
        runtime.stop()
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
