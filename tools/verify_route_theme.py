"""Exercise route completion and appearance in an isolated native WebView2."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--state-fixture', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    fixture = json.loads(args.state_fixture.read_text(encoding='utf-8'))
    with urlopen(Request(runtime.url+'/api/state', data=json.dumps({'state': fixture, 'baseUpdatedAt': None}).encode(), headers={'Content-Type': 'application/json'})) as response:
        assert response.status == 200
    window = webview.create_window('Route and appearance verification', runtime.url+'/?desktop=1', width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        def until(script):
            deadline = time.monotonic()+30
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script):
                        return
                except Exception:
                    # WebView2 recreates the JS bridge during a real reload.
                    pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated")
            window.evaluate_js("window.routeFixture=cloneData(state); setActivePage('run');")
            expect("buildRunRouteState().points.length === 4 && runProgressText.textContent === '0/4 Ziele · 0 %'", 'initial-route-has-four-stops')
            window.evaluate_js("runArriveButton.click()")
            expect("buildRunRouteState().arrived && buildRunRouteState().completedCount === 0 && document.querySelector('#runWaypoints [aria-current=step] small').textContent === 'Am Ziel'", 'arrival-does-not-complete-stop')
            window.evaluate_js("state.runCompletedRoutePoints=buildRunRouteState().selectedPoint.pickupTaskKeys; render();")
            expect("buildRunRouteState().completedCount === 1 && runProgressText.textContent === '1/4 Ziele · 25 %'", 'completed-pickup-advances-progress')
            window.evaluate_js("document.querySelector('[data-run-reopen-key]').click()")
            expect("buildRunRouteState().completedCount === 0", 'reopened-pickup-reduces-progress')
            window.evaluate_js("state.runCompletedRoutePoints=buildRunRouteState().selectedPoint.pickupTaskKeys; state.missions[0].loads.forEach(load=>{load.deliveredAt=new Date().toISOString();load.placement=null;}); markMissionCompleted(state.missions[0]); persist(); render();")
            expect("!isMissionActive(state.missions[0]) && runProgressText.textContent === '2/4 Ziele · 50 %'", 'completed-mission-remains-in-flight')
            expect("document.querySelector('[data-flight-meter=route]').dataset.value === '50' && document.querySelector('.run-progress-track').getAttribute('aria-valuenow') === '50'", 'home-and-route-agree')
            window.evaluate_js("window.routeSaved=false; flushSoloState().then(()=>{window.routeSaved=true;});")
            until('window.routeSaved && !soloPending && !soloSaving')
            window.load_url(runtime.url+'/?desktop=1&verify=reload')
            until("location.search.includes('verify=reload') && window.soloStartup?.phase === 'ready' && soloHydrated")
            expect("buildRunRouteState().completedCount === 2 && buildRunRouteState().points.length === 4", 'route-progress-survives-reload')
            window.evaluate_js("window.routeFixture=cloneData(state); state.missions.filter(isMissionActive).forEach(m=>{m.loads.forEach(l=>{l.deliveredAt=new Date().toISOString();l.placement=null;});markMissionCompleted(m);}); render(); setActivePage('run');")
            expect("runProgressText.textContent === '4/4 Ziele · 100 %' && !runFocusPanel.hidden && !runEmptyState.getClientRects().length", 'last-completion-stays-visible-at-one-hundred')
            window.evaluate_js("state.missions.forEach(m=>{m.status='paid'}); render();")
            expect("buildRunRouteState().completedCount === 4", 'payment-keeps-route-progress')
            window.evaluate_js("state.fleet.push({...currentActiveFleetEntry(),id:'route-other-ship'}); state.activeFleetEntryId='route-other-ship'; render();")
            expect("buildRunRouteState().points.length === 0", 'other-ship-does-not-inherit-flight')
            window.evaluate_js("state.activeFleetEntryId='hub-test-ship'; render();")
            expect("buildRunRouteState().completedCount === 4", 'returning-to-ship-restores-flight')
            window.evaluate_js("window.nextFlight=cloneData(routeFixture.missions.find(isMissionActive)); nextFlight.id='next-flight'; nextFlight.completedAt=''; nextFlight.paidAt=''; nextFlight.status='active'; nextFlight.loads.forEach(l=>{l.deliveredAt='';l.placement=null}); state.missions.push(nextFlight); render();")
            expect("buildRunRouteState().points.length === 2 && buildRunRouteState().completedCount === 0", 'new-flight-starts-without-old-completions')
            window.evaluate_js("nextFlight.status='cancelled'; render();")
            expect("buildRunRouteState().points.length === 0 && runFocusPanel.hidden", 'cancelled-flight-is-empty')
            window.evaluate_js("state=sanitizeState({...routeFixture,runRouteProgress:{'hub-test-ship':['missing','hub-mission-0','hub-mission-0'],removedShip:['hub-mission-0']}})")
            expect("JSON.stringify(state.runRouteProgress['hub-test-ship']) === '[\"hub-mission-0\"]' && !state.runRouteProgress.removedShip", 'stored-route-discards-deleted-missions-and-ships')
            window.evaluate_js("render();")
            window.evaluate_js("window.cargoRouteSnapshot=cloneData(state); state.missions=[{id:'route-courier',type:'courier',title:'Pakettest',status:'active',assignedFleetEntryId:state.activeFleetEntryId,serviceDetails:{packages:[{id:'p1',name:'A',quantity:1,pickup:'Area18',destination:'Lorville'},{id:'p2',name:'B',quantity:1,pickup:'Area18',destination:'Lorville'}]},loads:[]}]; state.runRouteProgress={}; state.runCompletedRoutePoints=[]; render();")
            expect("buildRunRouteState().progressTotal === 2 && buildRunRouteState().completedCount === 0", 'courier-route-counts-two-targets')
            window.evaluate_js("state.missions[0].serviceDetails.packages[0].pickedUpAt=new Date().toISOString(); render();")
            expect("buildRunRouteState().progressTotal === 2 && buildRunRouteState().completedCount === 0", 'partial-pickup-does-not-inflate-total-or-complete-target')
            window.evaluate_js("state.missions[0].serviceDetails.packages[1].pickedUpAt=new Date().toISOString(); render();")
            expect("buildRunRouteState().progressTotal === 2 && buildRunRouteState().completedCount === 1", 'all-packages-picked-up-complete-target')
            window.evaluate_js("markMissionCompleted(state.missions[0]); render();")
            expect("buildRunRouteState().completedCount === 2 && runProgressText.textContent === '2/2 Ziele · 100 %'", 'completed-courier-keeps-full-progress')
            window.evaluate_js("state.missions=[{id:'route-service',type:'other',title:'Servicetest',status:'active',assignedFleetEntryId:state.activeFleetEntryId,serviceDetails:{location:'Area18'},loads:[]}]; state.runRouteProgress={}; render(); markMissionCompleted(state.missions[0]); render();")
            expect("buildRunRouteState().progressTotal === 1 && buildRunRouteState().completedCount === 1", 'completed-service-keeps-full-progress')
            window.evaluate_js("state=cargoRouteSnapshot; render();")
            window.evaluate_js("window.themeBaseline={success:getComputedStyle(document.body).getPropertyValue('--success'),warning:getComputedStyle(document.body).getPropertyValue('--warning'),danger:getComputedStyle(document.body).getPropertyValue('--danger'),mission:state.missions[0].color}; document.querySelector('[data-accent-color=\"#efbd72\"]').click();")
            expect("document.body.dataset.soloAccent === '#efbd72' && soloTheme.color === '#efbd72' && soloAccentValue.textContent === '#EFBD72'", 'palette-applies-immediately')
            expect("getComputedStyle(document.body).getPropertyValue('--success') === themeBaseline.success && getComputedStyle(document.body).getPropertyValue('--warning') === themeBaseline.warning && getComputedStyle(document.body).getPropertyValue('--danger') === themeBaseline.danger && state.missions[0].color === themeBaseline.mission", 'semantic-and-mission-colours-unchanged')
            expect("document.querySelector('[data-accent-color=\"#efbd72\"]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('[data-accent-color][aria-pressed=true]').length === 1", 'palette-selection-is-accessible')
            window.load_url(runtime.url+'/?desktop=1&verify=theme')
            until("location.search.includes('verify=theme') && window.soloStartup?.phase === 'ready' && soloHydrated")
            expect("soloAccentColor.value === '#efbd72' && soloTheme.color === '#efbd72'", 'accent-survives-reload')
            window.evaluate_js("soloAccentColor.value='#000000'; soloAccentColor.dispatchEvent(new Event('input',{bubbles:true}));")
            expect("soloAccentColor.value === '#000000' && soloTheme.color !== '#000000' && !soloAccentReset.disabled", 'dark-custom-colour-keeps-readable-highlights')
            window.evaluate_js("soloAccentColor.value='#ffffff'; soloAccentColor.dispatchEvent(new Event('input',{bubbles:true}));")
            expect("soloTheme.color === '#ffffff' && getComputedStyle(document.querySelector('.primary-button')).color !== 'rgb(0, 0, 0)'", 'light-custom-colour-supported')
            window.evaluate_js("uiLanguageSelect.value='en'; uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
            expect("soloAccentReset.textContent === 'Default' && document.querySelector('[data-accent-color=\"#efbd72\"]').getAttribute('aria-label') === 'Amber'", 'appearance-translates-to-english')
            window.evaluate_js("soloAccentReset.click();")
            expect("!document.body.dataset.soloAccent && !document.body.style.getPropertyValue('--accent-rgb') && soloTheme.color === '#79dfed' && soloAccentReset.disabled && localStorage.getItem('citizen-tools:accent') === null", 'default-restores-original-palette')
            window.evaluate_js("uiLanguageSelect.value='de'; uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
            expect("document.querySelector('[data-accent-color=\"#efbd72\"]').getAttribute('aria-label') === 'Bernstein'", 'appearance-translates-back-to-german')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc(), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'route-theme-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
