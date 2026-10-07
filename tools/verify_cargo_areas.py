"""Verify editable ship cargo areas in isolated native WebView2 windows."""
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
    pc = webview.create_window('Cargo area verification', runtime.desktop_url, width=1280, height=900)
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
            until(pc, 'window.testSaved && !soloSync.status.pending && !soloSync.status.saving && !soloSync.status.busy')

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
                until(window, "window.soloStartup?.phase==='ready' && soloSync.status.hydrated && soloSync.status.initialized && !soloSync.status.saving && !soloSync.status.pending")
            expect("findShipLibraryEntryById('ship:hermes').cargoAreas.length===2 && findShipLibraryEntryById('ship:origin_315p').cargoAreas.map(a=>a.name).join(',')==='Vorne,Hinten' && findShipLibraryEntryById('ship:starlancer_max').cargoAreas.length===3", 'existing-profiles-receive-appropriate-areas')
            pc.evaluate_js("setActivePage('ships');document.querySelector('[data-shipdb-id=\"ship:starlancer_max\"] .shipdb-edit').click();window.areaHeights=JSON.stringify(shipBuilderState.heights)")
            expect("document.querySelectorAll('#cargoAreaList [data-area-id]').length===3 && document.querySelectorAll('#cargoAreaGrid button:not(:disabled)').length===96", 'starlancer-editor-shows-three-areas-and-96-floor-cells')
            pc.evaluate_js("document.querySelector('[data-area-id=\"hold-rear\"] [data-area-step=\"-1\"]').click();document.querySelector('[data-area-id=\"hold-rear\"] [data-area-step=\"-1\"]').click();")
            expect("shipBuilderState.cargoAreas[0].id==='hold-rear'", 'fill-order-changed-with-chevrons')
            pc.evaluate_js("cargoAreaAdd.click();window.reserveAreaId=selectedCargoAreaId;const card=document.querySelector('[data-area-id=\"'+reserveAreaId+'\"]');const name=card.querySelector('.cargo-area-name');name.value='Reserve';name.dispatchEvent(new Event('input'));name.dispatchEvent(new Event('change'));const color=document.querySelector('[data-area-id=\"'+reserveAreaId+'\"] .cargo-area-color');color.value='#ff8844';color.dispatchEvent(new Event('input'));")
            pc.evaluate_js("document.querySelector('[data-area-slot=\"A1\"]').click();document.querySelector('[data-area-slot=\"A2\"]').click()")
            expect("document.querySelector('[data-area-id=\"'+reserveAreaId+'\"] small').textContent==='2 Zellen · 4 SCU'", 'keyboard-paint-updates-area-capacity')
            expect("shipBuilderState.cargoAreas.find(a=>a.id===reserveAreaId).slots.length===2 && !shipBuilderState.cargoAreas.find(a=>a.id==='hold-left').slots.includes('A1') && JSON.stringify(shipBuilderState.heights)===areaHeights", 'painting-reassigns-cells-without-changing-grid-capacity')
            pc.evaluate_js("document.getElementById('cargoAreaErase').checked=true;document.getElementById('cargoAreaErase').dispatchEvent(new Event('change'));document.querySelector('[data-area-slot=\"A1\"]').click()")
            expect("!CargoAreas.slotOwners(shipBuilderState.cargoAreas).has('A1') && cargoAreaRemainder.textContent.includes('1 Zellen')", 'erase-returns-cell-to-remaining-space')
            pc.evaluate_js("document.getElementById('cargoAreaErase').checked=false;document.getElementById('cargoAreaErase').dispatchEvent(new Event('change'));cargoAreaGrid.scrollIntoView({block:'start'});window.scrollBy(0,-280)")
            from System import Action
            pc.native.Invoke(Action(lambda: pc.native.Activate()))
            time.sleep(.4)
            bounds=pc.evaluate_js("['A1','A2'].map(slot=>{const r=document.querySelector('[data-area-slot=\"'+slot+'\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})")
            report['paintBounds']=bounds
            expect("['A1','A2'].every(slot=>{const r=document.querySelector('[data-area-slot=\"'+slot+'\"]').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.dataset.areaSlot===slot})", 'mouse-targets-visible-grid-cells')
            pc.evaluate_js("window.areaPointerTrace=[];window.areaTraceAbort=new AbortController();['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture'].forEach(type=>document.addEventListener(type,e=>areaPointerTrace.push({type,target:e.target.id||e.target.className,slot:e.target.dataset?.areaSlot,y:e.clientY}),{capture:true,signal:areaTraceAbort.signal}))")
            control=pc.native.webview
            for kind,point,buttons in [('mouseMoved',bounds[0],0),('mousePressed',bounds[0],1),('mouseMoved',bounds[1],1),('mouseReleased',bounds[1],0)]:
                params=dict(type=kind,x=point['x'],y=point['y'],button='left' if buttons or kind=='mouseReleased' else 'none',buttons=buttons,clickCount=1)
                holder={}
                control.Invoke(Action(lambda params=params: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Input.dispatchMouseEvent',json.dumps(params)))))
                deadline=time.monotonic()+10
                while not holder['task'].IsCompleted and time.monotonic()<deadline: time.sleep(.05)
                if not holder['task'].IsCompleted: raise TimeoutError('Pointer input timeout')
                str(holder['task'].Result)
                time.sleep(.15)
            report['paintTrace']=pc.evaluate_js('areaPointerTrace')
            report['paintState']=pc.evaluate_js("({selected:selectedCargoAreaId,erase:cargoAreaErase,slots:shipBuilderState.cargoAreas.find(a=>a.id===reserveAreaId).slots,classes:cargoAreaGrid.className})")
            pc.evaluate_js('areaTraceAbort.abort()')
            screenshot('cargo-areas-before-save','#cargoAreaEditor')
            expect("shipBuilderState.cargoAreas.find(a=>a.id===reserveAreaId).slots.length===2 && !cargoAreaGrid.classList.contains('is-painting')", 'mouse-paints-cells-and-releases-capture')
            screenshot('cargo-areas-desktop-de','#cargoAreaEditor')
            pc.evaluate_js("shipDbForm.requestSubmit()")
            until(pc,"activeShipDbView==='database' && findShipLibraryEntryById('ship:starlancer_max').cargoAreas.some(a=>a.name==='Reserve')")
            save()
            device.load_url(runtime.url.replace('127.0.0.1','localhost')+'/?area-test=shared')
            until(device,"location.search.includes('area-test=shared') && soloSync.status.hydrated && findShipLibraryEntryById('ship:starlancer_max').cargoAreas.some(a=>a.name==='Reserve')")
            assert device.evaluate_js("findShipLibraryEntryById('ship:starlancer_max').cargoAreas[0].id==='hold-rear'")
            report['checks'].append('saved-profile-and-order-shared-with-another-device')
            pc.load_url(runtime.desktop_url+'&area-test=reload')
            until(pc,"location.search.includes('area-test=reload') && window.soloStartup?.phase==='ready' && soloSync.status.hydrated && !soloSync.status.pending && !soloSync.status.saving && !soloSync.status.busy")
            expect("findShipLibraryEntryById('ship:starlancer_max').cargoAreas.some(a=>a.name==='Reserve' && a.color==='#ff8844' && a.slots.length===2)", 'custom-name-color-and-cells-survive-restart')
            pc.evaluate_js("""window.areaMission=(id,region='',ship='ship:starlancer_max',width=2)=>({id,type:'cargo',title:'Fracht '+id,status:'active',assignedFleetEntryId:'area-fleet',pickup:'Area18',dropoff:'Lorville',autoloadArea:'all',autoloadAreaId:region,autoloadAreaShipId:region?ship:'',segments:[{id:'s-'+id,pickup:'Area18',dropoff:'Lorville',width,depth:1,height:1,quantity:1}],loads:[{id:'l-'+id,segmentId:'s-'+id,label:'Fracht',width,depth:1,height:1,scu:width,pickup:'Area18',dropoff:'Lorville',placement:null}]});
              state=sanitizeState({...state,fleet:[{id:'area-fleet',shipId:'ship:starlancer_max',manufacturer:'MISC',model:'Starlancer MAX',status:'active',acquiredOn:'2026-09-01'}],activeFleetEntryId:'area-fleet',missions:[areaMission('auto')],autoload:{fillOrder:'areas'},runRouteProgress:{},runRouteOrder:{},currentLocation:'Area18'});
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:starlancer_max')),'area-fleet','ship:starlancer_max');render();setActivePage('load');autoLoadMission(state.missions[0]);""")
            expect("state.missions[0].loads[0].placement.row>=18 && loadAutoloadOptions.textContent.includes('Heck → Links → Rechts → Reserve')", 'automatic-loading-follows-saved-rear-first-order')
            expect("cargoAreaLegend.textContent.includes('Reserve') && shipGrid.querySelector('.cargo-area-dot')", 'loading-grid-shows-area-colors-and-legend')
            save()
            pc.evaluate_js("state.missions.push(sanitizeState({...state,missions:[areaMission('fixed','hold-right')]}).missions[0]);render();autoLoadMission(state.missions[1]);")
            expect("state.missions[1].loads[0].placement.col>=3 && state.missions[1].loads[0].placement.row<16", 'fixed-contract-uses-named-right-hold')
            save()
            pc.evaluate_js("window.beforePlaced=JSON.stringify(state.missions[1].loads[0].placement);const select=document.querySelector('[data-autoload-mission=fixed]');select.value='region:hold-rear';select.dispatchEvent(new Event('change'))")
            expect("JSON.stringify(state.missions[1].loads[0].placement)===beforePlaced && state.missions[1].autoloadAreaId==='hold-rear'", 'changing-area-keeps-existing-container-placement')
            save()
            pc.evaluate_js("state.missions.push(sanitizeState({...state,missions:[areaMission('missing','deleted-area')]}).missions[0]);render();window.missingResult=autoLoadMission(state.missions.at(-1));")
            expect("missingResult.placedCount===0 && missingResult.skippedCount===1 && document.querySelector('[data-autoload-mission=missing]').selectedOptions[0].textContent==='Bereich neu wählen'", 'deleted-area-does-not-silently-fall-back')
            save()
            pc.evaluate_js("state.missions.at(-1).autoloadAreaId='hold-right';state.missions.at(-1).autoloadAreaShipId='ship:hermes';render();window.wrongShip=autoLoadMission(state.missions.at(-1))")
            expect("wrongShip.placedCount===0 && document.querySelector('[data-autoload-mission=missing]').parentElement.querySelector('.cargo-area-warning')", 'same-area-id-on-different-ship-requires-new-selection')
            save()
            pc.evaluate_js("""state.fleet[0].shipId='ship:origin_315p';state.fleet[0].model='315p';state.fleet[0].manufacturer='Origin';state.missions=sanitizeState({...state,missions:[areaMission('315','hold-rear','ship:origin_315p')]}).missions;
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:origin_315p')),'area-fleet','ship:origin_315p');render();setActivePage('run');""")
            expect("Array.from(document.querySelector('#runAutoloadAreas select').options).map(o=>o.textContent).join(',')==='Automatisch,Vorne,Hinten'", 'cockpit-options-follow-315p-profile')
            pc.evaluate_js("runAutoLoadButton.click()")
            expect("state.missions[0].loads[0].placement.row>=6", '315p-contract-loads-in-rear-hold')
            save()
            pc.evaluate_js("""state.shipLibrary.push(createShipLibraryEntry({id:'custom-areas',manufacturer:'Test',model:'Area boundary',gridRows:2,gridCols:4,gridHeights:{A1:1,A2:1,A3:1,A4:1},cargoAreas:[{id:'one',name:'First',slots:['A1','A2']},{id:'two',name:'Second',slots:['A3','A4']}]}));state.fleet[0].shipId='custom-areas';state.missions=sanitizeState({...state,missions:[areaMission('wide','','custom-areas',4)]}).missions;applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('custom-areas')),'area-fleet','custom-areas');window.crossing=autoLoadMission(state.missions[0]);""")
            expect("crossing.placedCount===0 && state.missions[0].loads[0].rotated===false", 'container-cannot-cross-custom-area-boundary-or-change-rotation-on-failure')
            save()
            pc.evaluate_js("state.missions=sanitizeState({...state,missions:[areaMission('free'),areaMission('reserved','one','custom-areas')]}).missions;window.fixedFirst=autoLoadEntries(state.missions.map(m=>({mission:m,load:m.loads[0]})))")
            expect("fixedFirst.placedCount===2 && state.missions[1].loads[0].placement.col===0 && state.missions[0].loads[0].placement.col===2", 'fixed-area-is-filled-before-unrestricted-contract')
            save()
            pc.evaluate_js("state.shipLibrary.find(p=>p.id==='custom-areas').cargoAreas.pop();state.missions=sanitizeState({...state,missions:[areaMission('remaining','__remaining__','custom-areas')]}).missions;autoLoadMission(state.missions[0]);")
            expect("state.missions[0].loads[0].placement.col===2", 'unassigned-space-is-explicitly-selectable')
            save()
            pc.evaluate_js("populateShipDbForm(findShipLibraryEntryById('ship:starlancer_max'));setShipDbView('create');setActivePage('ships');cargoAreaAdd.click();shipDbCancelButton.click()")
            expect("findShipLibraryEntryById('ship:starlancer_max').cargoAreas.length===4", 'cancel-does-not-save-draft-area')
            pc.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change'));populateShipDbForm(findShipLibraryEntryById('ship:origin_315p'));setShipDbView('create');setActivePage('ships')")
            expect("document.querySelector('.cargo-area-name').value==='Front' && cargoAreaAdd.textContent==='Add area'", 'english-default-area-names-and-controls')
            pc.resize(390,844);time.sleep(.5)
            expect("document.documentElement.scrollWidth<=innerWidth+1 && cargoAreaEditor.getBoundingClientRect().width<=innerWidth", 'phone-editor-fits-viewport')
            screenshot('cargo-areas-phone-en','#cargoAreaEditor')
            pc.evaluate_js("setShipBuilderState({...shipBuilderState,heights:{A2:1},overloadHeights:{}})")
            expect("shipBuilderState.cargoAreas.every(a=>a.slots.every(s=>s==='A2'))", 'grid-edit-prunes-area-cells-that-no-longer-exist')
            errors=pc.evaluate_js('window.soloErrors');assert not errors,errors
            report.update(ok=True,errors=errors)
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc(), errors=pc.evaluate_js('window.soloErrors'), diagnostic=pc.evaluate_js('({points:buildRunRouteState().openPoints,missions:state.missions.map(m=>({id:m.id,type:m.type,readiness:getRunMissionReadiness(m),loads:m.loads.length})),controls:document.querySelectorAll(".route-order-handle").length})'))
        finally:
            (args.data_dir / 'cargo-areas-result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            for window in [pc,device]: window.destroy()
    try:
        webview.start(check,gui='edgechromium',private_mode=False,storage_path=str(args.data_dir/'WebView'))
    finally: runtime.stop()
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
