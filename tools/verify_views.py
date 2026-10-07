"""Verify deferred views and real mission form actions using synthetic data only."""
import argparse
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
    window = webview.create_window('View separation verification', runtime.desktop_url, width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        def until(expression):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(expression):
                        return
                except Exception:
                    pass
                time.sleep(.1)
            raise AssertionError(expression)

        def expect(expression, name):
            assert window.evaluate_js(expression), name
            result['checks'].append(name)

        try:
            until("window.soloStartup?.phase==='ready' && soloSync.status.hydrated && !missionAutoImportBusy && !soloSync.status.busy")
            window.evaluate_js("""state=sanitizeState({...state,
              fleet:[{id:'view-ship',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-10-01'}],
              activeFleetEntryId:'view-ship',missions:[{id:'view-cargo',type:'cargo',title:'View cargo original',status:'active',
                assignedFleetEntryId:'view-ship',pickup:'Area18',dropoff:'Lorville',payout:15000,
                segments:[{id:'view-segment',title:'Titanium',pickup:'Area18',dropoff:'Lorville',width:2,depth:2,height:2,
                  containerSize:'8',quantity:1,order:0,cargoIndex:0,cargoRouteIndex:0,cargoGroupIndex:0,
                  isPlaceable:true,scuPerLoad:8,totalScu:8,routeTargetScu:8,expectedCargoScu:8}],
                loads:[{id:'view-load',segmentId:'view-segment',label:'Titanium',width:2,depth:2,height:2,scu:8,pickup:'Area18',dropoff:'Lorville',placement:null}]}]});
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')),'view-ship','ship:hermes');
              setActivePage('hub');render();persist();window.initialSaved=false;flushSoloState().then(()=>window.initialSaved=true);
              window.viewCalls={};
              for(const name of ['renderHub','renderRunMode','renderMissions','renderShipGrid','renderIsometricView','renderFleet','renderShipDatabase']){
                const original=window[name];window[name]=(...args)=>{viewCalls[name]=(viewCalls[name]||0)+1;return original(...args);};
              }
              for(const [name,controller] of [['finance',financeController],['statistics',statisticsController],['systems',systemDatabaseController]]){
                const original=controller.render;controller.render=(...args)=>{viewCalls[name]=(viewCalls[name]||0)+1;return original(...args);};
              }""")
            until('initialSaved && !soloSync.status.hasUnsaved')
            window.evaluate_js("window.viewCalls={};for(let i=0;i<4;i++)render();")
            expect("viewCalls.renderHub===4 && !viewCalls.renderShipGrid && !viewCalls.renderIsometricView && !viewCalls.renderMissions && !viewCalls.renderFleet && !viewCalls.finance && !viewCalls.statistics && !viewCalls.systems", 'hidden-expensive-views-are-not-redrawn-on-hub-updates')
            result['fourHubUpdates'] = window.evaluate_js('viewCalls')
            window.evaluate_js("state.missions[0].title='View cargo updated';render();setActivePage('overview')")
            expect("missionsList.textContent.includes('View cargo updated') && viewCalls.renderShipGrid===1 && viewCalls.renderMissions===1", 'opening-a-dirty-page-renders-current-data')
            window.evaluate_js("setActivePage('home');setActivePage('load')")
            expect("viewCalls.renderShipGrid===1 && selectionShipGrid.children.length>0 && isoView.children.length>0 && selectionIsoView.children.length>0 && homeLoadList.textContent.includes('Titanium')", 'shared-grid-previews-and-load-list-are-current-without-duplicate-grid-rendering')
            window.evaluate_js("state.selectedLoadId=null;state.selectionCleared=true;persist();setActivePage('home')")
            expect("viewCalls.renderShipGrid===2", 'persist-without-render-invalidates-the-next-visible-grid')
            window.evaluate_js("setActivePage('overview');document.querySelector('[data-mission-id=\"view-cargo\"] .edit-mission').click();missionForm.elements.title.value='Draft survives navigation';setActivePage('statistics');setActivePage('create')")
            expect("getMissionEditId()==='view-cargo' && missionForm.elements.title.value==='Draft survives navigation'", 'navigation-preserves-an-open-mission-draft')
            window.evaluate_js('missionSubmitButton.click()')
            until("state.missions[0].title==='Draft survives navigation' && !soloSync.status.hasUnsaved")
            expect("state.missions[0].loads[0].id==='view-load' && state.missions[0].segments[0].id==='view-segment'", 'editing-through-the-real-form-preserves-cargo-identity')
            # Re-registering the public entry point must never duplicate handlers.
            window.evaluate_js("""registerCargoUiEvents();setActivePage('create');resetMissionForm();
              missionTypeSelect.value='other';missionTypeSelect.dispatchEvent(new Event('change'));
              missionForm.elements.title.value='Single service submission';missionForm.elements.miscLocation.value='Orison';
              window.missionsBefore=state.missions.length;missionSubmitButton.click();""")
            until("state.missions.some(m=>m.title==='Single service submission') && !soloSync.status.hasUnsaved")
            expect("state.missions.length===missionsBefore+1 && state.missions.filter(m=>m.title==='Single service submission').length===1", 'event-registration-is-idempotent-and-form-submission-commits-once')
            for page in ['hub', 'run', 'home', 'create', 'overview', 'load', 'fleet', 'finance', 'statistics', 'settings', 'ships', 'systems']:
                window.evaluate_js('setActivePage(' + json.dumps(page) + ')')
                expect('activePage===' + json.dumps(page) + " && document.querySelector('[data-page=\"'+activePage+'\"]').hidden===false", 'page-visible-' + page)
            window.evaluate_js("setActivePage('statistics');window.statisticsBefore=viewCalls.statistics;state.missions[0].payout=27000;persist();render();")
            expect('viewCalls.statistics===statisticsBefore+1', 'visible-statistics-refresh-after-state-changes')
            until('!soloSync.status.hasUnsaved')
            window.evaluate_js("setActivePage('overview')")
            expect("missionsList.textContent.includes('Single service submission') && missionsList.textContent.includes('Draft survives navigation')", 'reopened-mission-list-includes-all-latest-changes')
            result['errors'] = window.evaluate_js('window.soloErrors')
            assert not result['errors'], result['errors']
            result['ok'] = True
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc())
            result['diagnostics'] = window.evaluate_js("({errors:window.soloErrors,page:activePage,status:soloSync.status,calls:window.viewCalls})")
        finally:
            (args.data_dir/'views-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
