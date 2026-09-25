"""Stop/restart a real isolated server while its WebView remains open."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime, SoloHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    port = runtime.httpd.server_port
    url = runtime.url
    state_unavailable = False
    original_get = SoloHandler.do_GET

    def test_get(handler):
        if state_unavailable and handler.path.startswith('/api/state'):
            return handler.send_json(503, {'error': 'test_state_unavailable'})
        return original_get(handler)

    SoloHandler.do_GET = test_get
    window = webview.create_window('Connection and clock verification', url+'/?desktop=1', width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        nonlocal runtime, state_unavailable

        def until(script, timeout=25):
            deadline = time.monotonic()+timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script):
                        return
                except Exception:
                    pass
                time.sleep(.15)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        def restart():
            nonlocal runtime
            runtime = SoloRuntime(args.data_dir, port=port, lan=False)
            runtime.start(capture_enabled=False)

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated && soloConnection.phase === 'online'")
            expect("soloConnectionBanner.hidden && serverStatusLinkLabel.textContent === 'LINK ACTIVE'", 'connected-without-banner')
            window.evaluate_js("window.originalDate=Date; window.Date=class extends originalDate {constructor(...args){super(...(args.length?args:[originalDate.now()-240000]));}static now(){return originalDate.now()-240000;}}; window.clockProbeDone=false; soloConnection.probe().then(()=>clockProbeDone=true);")
            until('window.clockProbeDone')
            expect("Math.abs(Date.parse(flightClock.dateTime)-originalDate.now())<2000", 'four-minute-device-error-corrected-from-pc')
            expect("flightLocalClock.dateTime===flightClock.dateTime && flightLocalClock.textContent===new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new originalDate(flightClock.dateTime))", 'local-clock-uses-aligned-time-and-device-zone')
            for width, height in [(1280,720),(768,1024),(390,844)]:
                window.resize(width, height)
                until(f'innerWidth <= {width}')
                expect("(() => {const utc=flightClock.getBoundingClientRect(),local=flightLocalClock.getBoundingClientRect(),header=document.querySelector('.brand-lockup').getBoundingClientRect();return utc.width>0&&local.width>0&&Math.abs(utc.top-local.top)<2&&local.left>=utc.right&&local.right<=header.right&&header.right<=innerWidth&&header.height<(innerWidth>600?100:150);})()", f'both-clocks-fit-header-{width}')
            window.resize(1280,720)

            window.evaluate_js("setActivePage('create'); missionForm.elements.title.value='Diese Eingabe bleibt erhalten'; missionForm.elements.title.focus(); window.beforeDisconnectClock=flightClock.dateTime;")
            runtime.stop()
            until("soloConnection.phase === 'offline' && !soloConnectionBanner.hidden", timeout=12)
            expect("serverStatusLinkLabel.textContent === 'LINK OFFLINE' && soloConnectionMessage.textContent.includes('nicht erreichbar')", 'stopped-suite-detected-while-editing')
            until('flightClock.dateTime !== beforeDisconnectClock')
            expect("Math.abs(Date.parse(flightClock.dateTime)-originalDate.now())<2000", 'clock-continues-offline-with-last-alignment')
            expect("flightLocalClock.dateTime===flightClock.dateTime", 'local-clock-continues-offline-with-utc')
            expect("missionForm.elements.title.value === 'Diese Eingabe bleibt erhalten' && document.activeElement === missionForm.elements.title", 'disconnect-keeps-form-and-focus')
            restart()
            until("soloConnection.phase === 'online' && soloConnectionBanner.hidden", timeout=12)
            expect("missionForm.elements.title.value === 'Diese Eingabe bleibt erhalten' && document.activeElement === missionForm.elements.title", 'automatic-reconnect-keeps-form')
            window.evaluate_js("document.activeElement.blur(); setActivePage('hub');")
            until('!soloPolling && !soloSaving && !missionAutoImportBusy')
            runtime.stop()
            until("soloConnection.phase === 'offline'", timeout=12)
            window.evaluate_js("state.currentLocation='Lorville'; persist();")
            until('soloPending && !soloSaving')
            expect("localStorage.getItem(getStateStorageKey()).includes('Lorville')", 'offline-edit-kept-locally')
            restart()
            until("soloConnection.phase === 'online' && !soloPending && !soloSaving")
            with urlopen(url+'/api/state') as response:
                assert json.load(response)['state']['currentLocation'] == 'Lorville'
            result['checks'].append('offline-edit-saved-after-restart')
            # A live server with an unavailable state API exercises startup
            # recovery separately from the independent connectivity probe.
            state_unavailable = True
            window.load_url(url+'/?desktop=1&verify=initial-failure')
            until("location.search.includes('initial-failure') && window.soloStartup?.phase === 'ready' && remoteHydrationComplete && !soloHydrated")
            expect("soloConnection.phase === 'online'", 'heartbeat-independent-of-failed-initial-data-read')
            state_unavailable = False
            until('soloHydrated && remoteStatus.connected')
            result['checks'].append('failed-initial-read-recovers-without-reload')
            # Browser resume events request a fresh check and refresh the clock.
            window.evaluate_js("window.nativeFetch=fetch;window.heartbeatRequests=0;window.fetch=(url,options)=>{if(String(url).includes('/heartbeat'))heartbeatRequests++;return nativeFetch(url,options);};window.beforeResumeChecks=heartbeatRequests;window.dispatchEvent(new Event('pageshow'));")
            until('heartbeatRequests > beforeResumeChecks')
            result['checks'].append('page-resume-checks-immediately')
            window.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
            runtime.stop()
            until("soloConnection.phase === 'offline'", timeout=12)
            expect("soloConnectionMessage.textContent.includes('unavailable') && soloConnectionRetry.textContent === 'Check now'", 'connection-message-translates')
            restart()
            window.evaluate_js('soloConnectionRetry.click()')
            until("soloConnection.phase === 'online'")
            result['checks'].append('manual-check-reconnects')
            expect("flightLocalClock.title.includes('Local time')", 'local-clock-tooltip-translates')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc(), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'connection-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
        SoloHandler.do_GET = original_get
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
