"""Exercise real global Windows keys against an isolated, minimized WebView2 app."""
import argparse
import base64
import ctypes
import json
from pathlib import Path
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.settings.update(setupCompleted=True, captureEnabled=False, routeHomeLocation='Orison',
                            routeArriveHotkey='Ctrl+Shift+F20', routeLoadHotkey='Ctrl+Shift+F21',
                            routeUnloadHotkey='Ctrl+Shift+F22', routeHomeHotkey='Ctrl+Shift+F23', routePickupHotkey='Ctrl+Shift+F19')
    runtime.start(capture_enabled=False)
    runtime.settings['port'] = runtime.httpd.server_port
    pc = webview.create_window('Citizen Tools · Shortcut test', runtime.desktop_url, width=1280, height=900)
    runtime.window = pc
    pc.events.loaded += runtime.shortcuts.configure
    device = webview.create_window('Shortcut test · foreground window / second device', runtime.url.replace('127.0.0.1','localhost'), width=800, height=700)
    report = {'ok':False, 'checks':[]}

    def check():
        def until(script, window=pc, timeout=20):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert pc.evaluate_js(script), name
            report['checks'].append(name)

        def save():
            pc.evaluate_js('window.testSaved=false;flushSoloState().then(ok=>window.testSaved=ok)')
            until('window.testSaved && !soloSync.status.hasUnsaved && !soloSync.status.busy')

        def press(number, hold=.08):
            # The other test window stays in front; the owning app is minimized.
            from System import Action
            pc.minimize()
            device.native.Invoke(Action(lambda: device.native.Activate()))
            time.sleep(.15)
            user32 = ctypes.WinDLL('user32', use_last_error=True)
            keys = [0x11, 0x10, 0x70 + number - 1]
            try:
                for key in keys: user32.keybd_event(key, 0, 0, 0)
                time.sleep(hold)
            finally:
                for key in reversed(keys): user32.keybd_event(key, 0, 2, 0)

        def screenshot(name):
            from System import Action
            holder = {}
            control = pc.native.webview
            control.Invoke(Action(lambda: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', json.dumps({'format':'png','captureBeyondViewport':False})))))
            deadline = time.monotonic() + 10
            while not holder['task'].IsCompleted and time.monotonic() < deadline: time.sleep(.05)
            if not holder['task'].IsCompleted: raise TimeoutError('Screenshot timeout')
            payload = json.loads(str(holder['task'].Result))
            (args.data_dir / name).write_bytes(base64.b64decode(payload['data']))

        try:
            for window in [pc,device]:
                until("window.soloStartup?.phase==='ready' && soloSync.status.hydrated && !soloSync.status.hasUnsaved && !soloSync.status.busy", window)
            assert all(item['active'] for item in runtime.shortcuts.status()['keys'].values()), runtime.shortcuts.status()
            pc.evaluate_js("""window.keyCalls=[];window.actualRun=soloRouteShortcuts.run;soloRouteShortcuts.run=async action=>{const ok=await actualRun(action);keyCalls.push({action,ok});return ok};
              window.makeShortcutMission=()=>({id:'shortcut-cargo',type:'cargo',title:'Shortcut cargo',status:'active',assignedFleetEntryId:'shortcut-ship',pickup:'Area18',dropoff:'Lorville',segments:[{id:'segment-shortcut',title:'Titanium',pickup:'Area18',dropoff:'Lorville',width:2,depth:2,height:2,quantity:2,order:0}],loads:[0,1].map(i=>({id:'shortcut-load-'+i,segmentId:'segment-shortcut',label:'Titanium '+i,width:2,depth:2,height:2,scu:8,pickup:'Area18',dropoff:'Lorville',placement:null}))});
              state=sanitizeState({...state,fleet:[{id:'shortcut-ship',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-09-01'}],activeFleetEntryId:'shortcut-ship',missions:[makeShortcutMission()],runRouteProgress:{},runRouteOrder:{},runHomeDestinations:{},currentLocation:'',runCompletedRoutePoints:[]});
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')),'shortcut-ship','ship:hermes');render();setActivePage('run');persist();""")
            save()
            press(21)
            until('keyCalls.length===1')
            expect('keyCalls[0].ok===false && state.missions[0].loads.every(l=>!l.placement)', 'load-before-arrival-does-nothing')
            press(20, hold=1.1)
            until("state.currentLocation==='Area18' && !soloSync.status.hasUnsaved")
            expect("keyCalls.filter(k=>k.action==='arrive').length===1", 'minimized-global-arrival-held-key-executes-once')
            press(21)
            until('state.missions[0].loads.every(l=>l.placement) && !soloSync.status.hasUnsaved')
            report['checks'].append('global-auto-load-with-capture-paused')
            press(19)
            until("buildRunRouteState().selectedPoint?.dropoff==='Lorville' && !soloSync.status.hasUnsaved")
            report['checks'].append('pickup-completion-advances-to-delivery')
            press(23)
            until("buildRunRouteState().selectedPoint?.isHome && !soloSync.status.hasUnsaved")
            expect("buildRunRouteState().selectedPoint.dropoff==='Orison' && state.missions[0].loads.every(l=>l.placement)", 'home-detour-keeps-cargo-and-contract')
            until("buildRunRouteState().selectedPoint?.isHome", device)
            report['checks'].append('home-detour-shared-with-second-device')
            press(20)
            until("state.currentLocation==='Orison' && !soloSync.status.hasUnsaved")
            expect("!buildRunRouteState().selectedPoint.isHome && buildRunRouteState().selectedPoint.dropoff==='Lorville'", 'arrival-home-restores-pending-delivery')
            time.sleep(.8)
            press(20)
            until("state.currentLocation==='Lorville' && !soloSync.status.hasUnsaved")
            press(22)
            until("isMissionCompleted(state.missions[0]) && !soloSync.status.hasUnsaved")
            expect("state.missions[0].loads.every(l=>l.deliveredAt && !l.placement) && !document.querySelector('.app-dialog-backdrop:not([hidden])')", 'auto-unload-completes-only-ready-cargo-without-dialog')
            until("isMissionCompleted(state.missions[0])", device)
            report['checks'].append('shortcut-result-shared-with-second-device')
            press(23)
            until('buildRunRouteState().selectedPoint?.isHome && !soloSync.status.hasUnsaved')
            report['checks'].append('return-home-also-works-after-route-completed')
            pc.restore()
            pc.evaluate_js("setSettingsView('companion');routeHomeHotkey.click()")
            until("routeHomeHotkey.dataset.recording==='listening'")
            assert all(not item['active'] for item in runtime.shortcuts.status()['keys'].values())
            report['checks'].append('recording-releases-every-global-route-key')
            pc.evaluate_js("routeHomeHotkey.dispatchEvent(new KeyboardEvent('keydown',{key:'F24',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));soloSettingsForm.requestSubmit()")
            until("soloSettingsMessage.textContent.includes('gespeichert')")
            assert runtime.settings['routeHomeHotkey'] == 'Ctrl+Shift+F24'
            report['checks'].append('recorded-route-key-persists')
            pc.evaluate_js("routeLoadHotkey.value='Ctrl+Shift+F20';soloSettingsForm.requestSubmit()")
            until("soloSettingsMessage.textContent.includes('mehrfach')")
            assert runtime.settings['routeLoadHotkey'] == 'Ctrl+Shift+F21'
            report['checks'].append('duplicate-binding-rejected-without-changing-settings')
            pc.load_url(runtime.desktop_url+'&verification=reload')
            until("window.soloStartup?.phase==='ready' && routeHomeHotkey.value==='Ctrl+Shift+F24'")
            expect("routeHomeLocation.value==='Orison'", 'home-location-persists-after-reload')
            until('soloSync.status.hydrated && buildRunRouteState().selectedPoint?.isHome')
            report['checks'].append('active-home-detour-survives-reload')
            pc.evaluate_js("setSettingsView('companion');document.querySelector('.solo-route-shortcuts').scrollIntoView()")
            pc.evaluate_js('window.scrollBy(0,-250)')
            time.sleep(.3)
            screenshot('route-shortcuts-de.png')
            pc.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
            expect("document.querySelector('[data-solo-text=homeLocation]').textContent==='Home location'", 'english-settings')
            pc.resize(430,900)
            time.sleep(.5)
            expect('document.documentElement.scrollWidth<=innerWidth+1', 'narrow-settings-have-no-horizontal-overflow')
            screenshot('route-shortcuts-en-narrow.png')
            errors = pc.evaluate_js('window.soloErrors')
            assert not errors, errors
            report.update(ok=True, errors=errors)
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc(), errors=pc.evaluate_js('window.soloErrors'),
                          diagnostic=pc.evaluate_js('({keys:window.keyCalls,route:buildRunRouteState(),sync:soloSync.status})'))
        finally:
            (args.data_dir/'route-shortcuts-result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            for window in [pc,device]: window.destroy()

    try: webview.start(check,gui='edgechromium',private_mode=False,storage_path=str(args.data_dir/'WebView'))
    finally: runtime.stop()
    print(json.dumps({key:value for key,value in report.items() if key != 'diagnostic'}))
    return 0 if report['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
