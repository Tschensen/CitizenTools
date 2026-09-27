"""Verify manual routes and side-aware autoload in isolated native WebView2 windows."""
import argparse
import base64
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
    runtime.start(capture_enabled=False)
    pc = webview.create_window('Route and cargo verification', runtime.desktop_url, width=1280, height=900)
    device = webview.create_window('Additional device verification', runtime.url.replace('127.0.0.1', 'localhost'), width=800, height=720)
    report = {'ok': False, 'checks': []}

    def check():
        def until(window, script):
            deadline = time.monotonic() + 25
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
            pc.evaluate_js('window.testSaved=false; flushSoloState().then(()=>window.testSaved=true)')
            until(pc, 'window.testSaved && !soloPending && !soloSaving && !soloPolling')

        def screenshot(name, selector):
            from System import Action
            pc.native.Invoke(Action(lambda: pc.native.Activate()))
            time.sleep(.3)
            options = {'format': 'png', 'captureBeyondViewport': True, 'clip': pc.evaluate_js("(() => {const r=document.querySelector("+json.dumps(selector)+").getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()")}
            holder = {}
            control = pc.native.webview
            control.Invoke(Action(lambda: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', json.dumps(options)))))
            deadline = time.monotonic() + 10
            while not holder['task'].IsCompleted and time.monotonic() < deadline: time.sleep(.05)
            if not holder['task'].IsCompleted: raise TimeoutError('Screenshot timeout')
            payload = json.loads(str(holder['task'].Result))
            (args.data_dir / (name + '.png')).write_bytes(base64.b64decode(payload['data']))

        try:
            for window in [pc, device]:
                until(window, "window.soloStartup?.phase==='ready' && soloHydrated && remoteHydrationComplete && !soloSaving && !soloPending")
            pc.evaluate_js("""window.makeCargoTestMission=(id,pickup,dropoff,quantity=4,area='all')=>({id,type:'cargo',title:'Fracht '+id,status:'active',assignedFleetEntryId:'test-hermes',pickup,dropoff,autoloadArea:area,segments:[{id:'segment-'+id,title:'Titanium',pickup,dropoff,width:2,depth:2,height:2,quantity,order:0}],loads:Array.from({length:quantity},(_,i)=>({id:id+'-'+i,segmentId:'segment-'+id,label:'Titanium '+i,width:2,depth:2,height:2,scu:8,pickup,dropoff,placement:null}))});
              state=sanitizeState({...state, fleet:[{id:'test-hermes',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-09-01'}],activeFleetEntryId:'test-hermes',missions:[makeCargoTestMission('a','Area18','Lorville'),makeCargoTestMission('b','New Babbage','Orison')],runRouteProgress:{},runRouteOrder:{},currentLocation:'',runCompletedRoutePoints:[]});
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')), 'test-hermes','ship:hermes');
              render();setActivePage('run');document.querySelector('[data-collapse-target=runRouteBody]').click();
              window.routeFixture=cloneData(state);window.beforeRoute=buildRunRouteState().openPoints.map(p=>p.dropoff);
              persist();""")
            expect("buildRunRouteState().openPoints.length===4 && document.querySelectorAll('.route-order-handle').length===4", 'four-numbered-stops-have-controls')
            expect("document.querySelector('[data-route-order-index=\"0\"] [data-route-move=\"-1\"]').disabled", 'first-stop-cannot-move-up')
            pc.evaluate_js("document.querySelector('[data-route-order-index=\"2\"] [data-route-move=\"-1\"]').click()")
            expect("state.runRouteOrder['test-hermes'].length===4 && buildRunRouteState().openPoints[1].dropoff===beforeRoute[2]", 'chevron-saves-manual-order')
            pc.evaluate_js("document.querySelector('[data-route-order-index=\"1\"] .route-order-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))")
            expect("buildRunRouteState().openPoints[0].dropoff===beforeRoute[2]", 'keyboard-reorders-stop')
            expect("moveRunRouteStop(3,0)===false && runRouteOrderStatus.textContent.includes('Abholung')", 'delivery-before-pickup-rejected')
            save()
            device.load_url(runtime.url.replace('127.0.0.1', 'localhost')+'/?test=shared')
            until(device, "location.search.includes('test=shared') && soloHydrated && state.runRouteOrder?.['test-hermes']?.length===4")
            assert device.evaluate_js("buildRunRouteState().openPoints[0].dropoff==='New Babbage'")
            report['checks'].append('another-device-shares-order')
            pc.evaluate_js("window.savedFirst=buildRunRouteState().openPoints[0].dropoff;state.fleet.push({...state.fleet[0],id:'other'});state.activeFleetEntryId='other';render()")
            expect("buildRunRouteState().openPoints.length===0 && !state.runRouteOrder.other", 'route-order-is-per-ship')
            pc.evaluate_js("state.activeFleetEntryId='test-hermes';render()")
            expect("buildRunRouteState().openPoints[0].dropoff===savedFirst", 'return-to-ship-keeps-order')
            screenshot('route-desktop-de', '#runRoutePanel')
            pc.evaluate_js("runRouteOrderReset.click()")
            expect("!state.runRouteOrder['test-hermes'] && JSON.stringify(buildRunRouteState().openPoints.map(p=>p.dropoff))===JSON.stringify(beforeRoute)", 'automatic-order-restored')
            # Real pointer input through WebView2 DevTools exercises the drag handle.
            save()
            pc.evaluate_js("runRoutePanel.scrollIntoView({block:'center'});window.pointerTrace=[];window.pointerTraceAbort=new AbortController();['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture'].forEach(type=>document.addEventListener(type,e=>pointerTrace.push({type,target:e.target.closest?.('button')?.className,button:e.button,y:e.clientY}),{capture:true,signal:pointerTraceAbort.signal}))")
            time.sleep(.3)
            bounds = pc.evaluate_js("[document.querySelector('[data-route-order-index=\"2\"] .route-order-handle'),document.querySelector('[data-route-order-index=\"0\"]')].map((el,i)=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.top+(i===0?r.height/2:4)}})")
            report['dragBounds'] = bounds
            from System import Action
            control = pc.native.webview
            for kind, point, buttons in [('mouseMoved',bounds[0],0),('mousePressed',bounds[0],1),('mouseMoved',bounds[1],1),('mouseReleased',bounds[1],0)]:
                params = dict(type=kind, x=point['x'], y=point['y'], button='left' if buttons or kind=='mouseReleased' else 'none', buttons=buttons, clickCount=1)
                holder = {}
                control.Invoke(Action(lambda params=params: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Input.dispatchMouseEvent',json.dumps(params)))))
                deadline = time.monotonic()+10
                while not holder['task'].IsCompleted and time.monotonic()<deadline: time.sleep(.05)
                if not holder['task'].IsCompleted: raise TimeoutError('Pointer input timeout')
                str(holder['task'].Result)
                time.sleep(.2)
            report['pointerTrace'] = pc.evaluate_js('window.pointerTrace')
            pc.evaluate_js('pointerTraceAbort.abort()')
            drag_ok = pc.evaluate_js("buildRunRouteState().openPoints[0].dropoff===beforeRoute[2]")
            if drag_ok: report['checks'].append('mouse-drag-reorders-stop')
            save()
            pc.evaluate_js("state=sanitizeState({...routeFixture,missions:[makeCargoTestMission('a','Area18','Lorville',20,'left')]});render();setActivePage('load');window.strictResult=autoLoadMission(state.missions[0]);")
            expect("strictResult.placedCount===18 && strictResult.skippedCount===2 && state.missions[0].loads.filter(l=>l.placement).every(l=>l.placement.col<4)", 'strict-left-stops-at-144-scu')
            save()
            pc.evaluate_js("window.leftPlacements=JSON.stringify(state.missions[0].loads.slice(0,18).map(l=>l.placement));const select=document.querySelector('[data-autoload-mission=\"a\"]');select.value='right';select.dispatchEvent(new Event('change'));autoLoadMission(state.missions[0]);")
            expect("JSON.stringify(state.missions[0].loads.slice(0,18).map(l=>l.placement))===leftPlacements && state.missions[0].loads.slice(18).every(l=>l.placement.col>=5)", 'changed-side-only-affects-unloaded-containers')
            save()
            pc.evaluate_js("state=sanitizeState({...routeFixture,missions:[makeCargoTestMission('a','Area18','Lorville',20)]});state.autoload.fillOrder='left';window.leftResult=autoLoadMission(state.missions[0]);")
            expect("leftResult.placedCount===20 && state.missions[0].loads.slice(0,18).every(l=>l.placement.col<4) && state.missions[0].loads.slice(18).every(l=>l.placement.col>=5)", 'left-first-fills-left-before-right')
            save()
            pc.evaluate_js("state=sanitizeState({...routeFixture,missions:[makeCargoTestMission('a','Area18','Lorville',20)]});state.autoload.fillOrder='right';autoLoadMission(state.missions[0]);")
            expect("state.missions[0].loads.slice(0,18).every(l=>l.placement.col>=5) && state.missions[0].loads.slice(18).every(l=>l.placement.col<4)", 'right-first-fills-right-before-left')
            save()
            pc.evaluate_js("state=sanitizeState({...routeFixture,missions:[makeCargoTestMission('a','Area18','Lorville',4,'left'),makeCargoTestMission('b','Area18','Orison',4,'right')],currentLocation:'Area18'});render();setActivePage('run');")
            expect("document.querySelectorAll('#runAutoloadAreas select').length===2 && !runAutoloadOptions.hidden", 'cockpit-offers-area-for-each-contract')
            pc.evaluate_js("runAutoLoadButton.click()")
            expect("state.missions[0].loads.every(l=>l.placement?.col<4) && state.missions[1].loads.every(l=>l.placement?.col>=5)", 'cockpit-autoload-keeps-contracts-on-assigned-sides')
            pc.evaluate_js("setActivePage('load');const fill=document.querySelector('#loadAutoloadOptions [data-autoload-fill]');fill.value='left';fill.dispatchEvent(new Event('change'));persist()")
            expect("Array.from(document.querySelectorAll('[data-autoload-fill]')).every(s=>s.value==='left')", 'fill-controls-stay-in-sync')
            save()
            pc.load_url(runtime.desktop_url+'&test=reload')
            until(pc, "location.search.includes('test=reload') && window.soloStartup?.phase==='ready' && soloHydrated && remoteHydrationComplete")
            expect("state.autoload.fillOrder==='left' && state.missions[0].autoloadArea==='left' && state.missions[1].autoloadArea==='right'", 'cargo-settings-survive-restart')
            pc.evaluate_js("setActivePage('load')")
            screenshot('cargo-desktop-de', '#loadAutoloadOptions')
            pc.resize(390,844)
            time.sleep(.6)
            pc.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change'));setActivePage('run');state.missions.forEach(m=>m.loads.forEach(l=>l.placement=null));state.currentLocation='Area18';render();runFocusPanel.scrollIntoView()")
            expect("document.querySelector('[data-autoload-fill] option[value=left]').textContent==='Left first' && document.querySelector('[data-autoload-mission=\"a\"]').selectedOptions[0].textContent==='Left only'", 'english-area-and-fill-labels')
            expect("document.documentElement.scrollWidth<=innerWidth+1", 'phone-without-horizontal-overflow')
            screenshot('cargo-phone-en', '#runAutoloadOptions')
            pc.evaluate_js("if(runRouteBody.hidden) document.querySelector('[data-collapse-target=runRouteBody]').click()")
            screenshot('route-phone-en', '#runRoutePanel')
            expect("document.querySelector('.route-order-handle').getAttribute('aria-label').includes('drag or use arrow keys')", 'accessible-english-route-controls')
            errors = pc.evaluate_js('window.soloErrors')
            assert not errors, errors
            assert drag_ok, 'mouse-drag-reorders-stop'
            report.update(ok=True, errors=errors)
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc(), errors=pc.evaluate_js('window.soloErrors'), diagnostic=pc.evaluate_js('({points:buildRunRouteState().openPoints,missions:state.missions.map(m=>({id:m.id,type:m.type,readiness:getRunMissionReadiness(m),loads:m.loads.length})),controls:document.querySelectorAll(".route-order-handle").length})'))
        finally:
            (args.data_dir / 'route-cargo-result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            for window in [pc,device]: window.destroy()
    try:
        webview.start(check,gui='edgechromium',private_mode=False,storage_path=str(args.data_dir/'WebView'))
    finally: runtime.stop()
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
