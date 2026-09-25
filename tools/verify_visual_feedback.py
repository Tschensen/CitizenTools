"""Verify native animations, import transitions and reduced motion in isolated data."""
import argparse
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--state-fixture', type=Path)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    if args.state_fixture:
        fixture = json.loads(args.state_fixture.read_text(encoding='utf-8'))
        with urlopen(Request(runtime.url+'/api/state', data=json.dumps({'state':fixture, 'baseUpdatedAt':None}).encode(), headers={'Content-Type':'application/json'})) as response:
            assert response.status == 200
    window = webview.create_window('Visual feedback verification', runtime.url+'/?desktop=1', width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        def until(script):
            deadline = time.monotonic()+30
            while time.monotonic()<deadline:
                if window.evaluate_js(script): return
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        def media(value):
            from System import Action
            control = window.native.webview
            payload = json.dumps({'features':[{'name':'prefers-reduced-motion','value':value}]})
            control.Invoke(Action(lambda: control.CoreWebView2.CallDevToolsProtocolMethodAsync('Emulation.setEmulatedMedia', payload)))
            until(f"matchMedia('(prefers-reduced-motion: {value})').matches")

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated")
            media('no-preference')
            window.evaluate_js("""window.testPulses=[];
                const originalAnimate=Element.prototype.animate;
                Element.prototype.animate=function(...args) {testPulses.push(this.dataset.flightStat || (this.dataset.flightMeter && 'meter-'+this.dataset.flightMeter) || this.id || this.tagName); return originalAnimate.apply(this,args);};
                render(); render();""")
            expect('testPulses.length === 0', 'unchanged-renders-stay-quiet')
            window.evaluate_js("state.ledgerEntries.push({id:'visual-income',flow:'income',amountAuec:1200,bookedOn:'2026-09-23',category:'other'}); render();")
            expect("JSON.stringify(testPulses) === '[\"balance\"]'", 'only-changed-value-pulses')
            window.evaluate_js("render(); setActivePage('finance'); state.ledgerEntries[0].amountAuec=1300; render(); setActivePage('hub');")
            expect('testPulses.length === 1', 'hidden-page-and-repeat-stay-quiet')
            window.evaluate_js("""soloImportSounds.observe([]);
                window.testJob={id:'visual-job',createdAt:new Date(Date.now()+1).toISOString(),updatedAt:new Date().toISOString(),status:'processing'};
                soloImportSounds.observe([testJob]); renderMissionImportProgress([testJob]);""")
            expect("getComputedStyle(document.querySelector('#companionImportActivity'),'::after').animationName === 'flight-import-track'", 'companion-processing-animation')
            window.evaluate_js("testJob.status='completed'; soloImportSounds.observe([testJob]); renderMissionImportProgress([testJob]);")
            until("testPulses.includes('companionImportActivityTitle')")
            window.evaluate_js("soloImportSounds.observe([testJob]); renderMissionImportProgress([testJob]);")
            expect("testPulses.filter(id=>id==='companionImportActivityTitle').length === 1", 'completion-once-with-muted-audio')
            window.evaluate_js("openMissionImportDialog(); window.testOperation=missionImportSound=soloImportSounds.begin({isTrusted:true}); testOperation.processing(); setMissionImportStatus('Processing','Test');")
            expect("document.querySelector('#missionImportDialog').dataset.importPhase === 'processing' && getComputedStyle(document.querySelector('#missionImportImageWrap'),'::after').animationName === 'flight-import-scan'", 'manual-scan-animation')
            window.evaluate_js("testOperation.error(); setMissionImportStatus('Failed','Test','error');")
            until("testPulses.includes('STRONG')")
            expect("document.querySelector('#missionImportDialog').dataset.importPhase === 'failed' && getComputedStyle(document.querySelector('#missionImportImageWrap'),'::after').animationName === 'none'", 'failure-stops-scan')
            window.evaluate_js("closeMissionImportDialog(); testOperation.success();")
            expect("!document.querySelector('#missionImportDialog').dataset.importPhase", 'cancel-removes-feedback')
            window.minimize()
            until('document.hidden')
            window.evaluate_js("window.testBeforeHidden=testPulses.length; soloImportSounds.observe([{id:'background-result',status:'failed',createdAt:new Date(Date.now()+1).toISOString()}]);")
            window.restore()
            until('!document.hidden')
            window.evaluate_js("window.testFrame=false; requestAnimationFrame(()=>{window.testFrame=true;});")
            until('window.testFrame')
            expect('testPulses.length === testBeforeHidden', 'background-results-not-replayed')
            media('reduce')
            window.evaluate_js("window.testBeforeReduce=testPulses.length; state.ledgerEntries[0].amountAuec=1400; render(); testJob.status='processing'; renderMissionImportProgress([testJob]);")
            expect("testPulses.length === testBeforeReduce && getComputedStyle(document.querySelector('#companionImportActivity'),'::after').animationName === 'none' && getComputedStyle(document.querySelector('#companionImportActivity'),'::after').display === 'none'", 'reduced-motion-css-and-script')
            if args.state_fixture:
                media('no-preference')
                expect("!document.querySelector('.hub-ship-media img') && !!document.querySelector('.hub-ship-media svg')", 'ship-silhouette-without-image')
                window.evaluate_js("currentActiveShipProfile().imageUrl='/assets/brand/citizen-tools-mark.svg?library'; renderHub();")
                until("document.querySelector('.hub-ship-media img')?.naturalWidth > 0")
                expect("document.querySelector('.hub-ship-media img').getAttribute('src').endsWith('?library')", 'ship-database-image')
                window.evaluate_js("currentActiveFleetEntry().imageUrl='/assets/brand/citizen-tools-mark.svg?fleet'; renderHub();")
                until("document.querySelector('.hub-ship-media img')?.naturalWidth > 0")
                expect("document.querySelector('.hub-ship-media img').getAttribute('src').endsWith('?fleet') && getComputedStyle(document.querySelector('.hub-ship-media .ship-profile-media-fallback')).visibility === 'hidden'", 'fleet-image-priority-without-silhouette-overlap')
                window.evaluate_js("window.testShipMedia=document.querySelector('.hub-ship-media'); renderHub();")
                expect("testShipMedia === document.querySelector('.hub-ship-media')", 'ship-image-retained-on-rerender')
                window.evaluate_js("currentActiveFleetEntry().imageUrl='/missing-image-for-test.png'; renderHub();")
                until("document.querySelector('.hub-ship-media').classList.contains('is-image-error')")
                expect("getComputedStyle(document.querySelector('.hub-ship-media img')).display === 'none' && getComputedStyle(document.querySelector('.hub-ship-media .ship-profile-media-fallback')).visibility === 'visible'", 'broken-image-falls-back')
                window.evaluate_js("currentActiveFleetEntry().imageUrl=''; currentActiveShipProfile().imageUrl=''; testPulses.length=0; state.missions[0].loads[0].placement={row:0,col:1,level:0,fleetEntryId:currentActiveFleetEntry().id}; renderHub();")
                expect("Number(document.querySelector('[data-flight-meter=cargo]').dataset.value)>0 && testPulses.includes('meter-cargo')", 'cargo-meter-updates-and-animates')
                window.evaluate_js("testPulses.length=0; renderHub(); renderHub();")
                expect('testPulses.length === 0', 'unchanged-meters-stay-quiet')
                media('reduce')
                window.evaluate_js("state.missions[0].loads[0].placement=null; renderHub();")
                expect("Number(document.querySelector('[data-flight-meter=cargo]').dataset.value) === 0 && testPulses.length === 0", 'reduced-motion-meter-updates-without-animation')
                expect("document.querySelector('[data-flight-meter=route]').parentElement.getAttribute('aria-valuetext').includes('0 / 4') && document.querySelector('.hub-payment-signal').textContent === '◷'", 'route-progress-and-pending-payment')
                media('no-preference')
                window.evaluate_js("state.runCompletedRoutePoints=buildRunRouteState().selectedPoint.pickupTaskKeys; renderHub();")
                expect("Number(document.querySelector('[data-flight-meter=route]').dataset.value) === 25 && testPulses.includes('meter-route')", 'route-meter-advances-after-completed-pickup')
                window.evaluate_js("""currentActiveFleetEntry().imageUrl='/assets/brand/citizen-tools-mark.svg?fleet';
                    currentActiveShipProfile().imageUrl='/assets/brand/citizen-tools-mark.svg?model';
                    state.fleet.push({...currentActiveFleetEntry(),id:'other-ship',imageUrl:'/assets/brand/citizen-tools-mark.svg?other',registration:'CT-OTHER'});
                    state.missions[0].assignedFleetEntryId='other-ship'; render(); setActivePage('overview');""")
                expect("document.querySelector('[data-mission-id=hub-mission-0] .ship-card-media img').getAttribute('src').endsWith('?other')", 'mission-image-follows-assignment')
                expect("document.querySelector('[data-mission-id=hub-mission-1] .ship-card-media img').getAttribute('src').endsWith('?fleet') && document.querySelector('#summaryCards .ship-card-media img').getAttribute('src').endsWith('?fleet')", 'active-summary-and-other-mission-keep-their-ship')
                expect("document.querySelector('#statisticsHighlights .ship-card-media img').getAttribute('src').endsWith('?model') && document.querySelector('#statisticsShips .ship-card-media img').getAttribute('src').endsWith('?model')", 'model-statistics-use-model-image')
                expect("[...document.querySelectorAll('#statisticsFleetPerformanceGroups .ship-card-media img')].some(n=>n.getAttribute('src').endsWith('?other'))", 'fleet-statistics-use-individual-image')
                window.evaluate_js("currentActiveShipProfile().imageUrl=''; statisticsController.render(); setActivePage('statistics');")
                until("document.querySelector('#statisticsHighlights .ship-card-media img')?.naturalWidth > 0")
                expect("document.querySelector('#statisticsHighlights .ship-card-media img').getAttribute('src').endsWith('?fleet') && document.querySelector('#statisticsShips .ship-card-media img').getAttribute('src').endsWith('?fleet')", 'model-statistics-fall-back-to-loaded-fleet-image')
                window.evaluate_js("state.missions.reverse(); statisticsController.render(); state.missions.reverse();")
                expect("document.querySelector('#statisticsHighlights .ship-card-media img').getAttribute('src').endsWith('?fleet')", 'model-image-independent-of-mission-order')
                window.evaluate_js("currentActiveFleetEntry().imageUrl=''; statisticsController.render();")
                expect("document.querySelector('#statisticsHighlights .ship-card-media img').getAttribute('src').endsWith('?other')", 'model-image-uses-another-matching-fleet-entry')
                window.evaluate_js("state.fleet.find(n=>n.id==='other-ship').imageUrl=''; state.fleet.push({...currentActiveFleetEntry(),id:'unrelated-model',shipId:'ship:315p',imageUrl:'/assets/brand/citizen-tools-mark.svg?unrelated'}); statisticsController.render();")
                expect("!document.querySelector('#statisticsHighlights .ship-card-media img') && !document.querySelector('#statisticsShips .ship-card-media img')", 'model-image-never-borrows-a-different-model')
                window.evaluate_js("state.fleet=state.fleet.filter(n=>n.id!=='unrelated-model'); currentActiveFleetEntry().imageUrl='/assets/brand/citizen-tools-mark.svg?fleet'; state.fleet.find(n=>n.id==='other-ship').imageUrl='/assets/brand/citizen-tools-mark.svg?other'; render(); setActivePage('overview');")
                window.evaluate_js("state.missions[0].assignedFleetEntryId=''; renderMissions();")
                expect("!document.querySelector('[data-mission-id=hub-mission-0] .ship-card-art')", 'unassigned-mission-has-no-unrelated-image')
                window.evaluate_js("state.missions[0].assignedFleetEntryId='deleted-ship'; renderMissions();")
                expect("!document.querySelector('[data-mission-id=hub-mission-0] .ship-card-art')", 'missing-ship-has-no-unrelated-image')
                window.evaluate_js("window.testCard=document.querySelector('[data-mission-id=hub-mission-1]'); window.testCollapsed=testCard.classList.contains('is-collapsed'); testCard.querySelector('.toggle-mission').click();")
                expect("document.querySelector('[data-mission-id=hub-mission-1]').classList.contains('is-collapsed') !== testCollapsed", 'mission-collapse-with-image')
                window.evaluate_js("resetMissionForm(); setActivePage('create'); renderCreateShipIndicator();")
                expect("createShipIndicator.querySelector('img').getAttribute('src').endsWith('?fleet')", 'create-form-shows-active-ship-image')
                window.evaluate_js("window.testCreateImage=createShipIndicator.querySelector('img'); missionForm.elements.title.value='Testauftrag'; renderCreateDraftSummary();")
                expect("testCreateImage === createShipIndicator.querySelector('img') && createShipIndicator.querySelector(':scope > span').textContent === 'Aktuelles Schiff'", 'create-form-keeps-image-while-typing')
                window.evaluate_js("state.activeFleetEntryId='other-ship'; renderCreateShipIndicator();")
                expect("createShipIndicator.querySelector('img').getAttribute('src').endsWith('?other')", 'create-form-image-follows-active-ship')
                window.evaluate_js("state.activeFleetEntryId=''; renderCreateShipIndicator();")
                expect("!createShipIndicator.querySelector('.ship-card-art')", 'create-form-clears-image-without-active-ship')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'visual-feedback-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
