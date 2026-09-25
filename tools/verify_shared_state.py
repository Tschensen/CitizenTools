"""Exercise PC + tablet views against one isolated SQLite database."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback
from datetime import datetime, timezone
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime
from server import app as backend


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--state-fixture', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    fixture = json.loads(args.state_fixture.read_text(encoding='utf-8'))
    with urlopen(Request(runtime.url+'/api/state', data=json.dumps({'state': fixture, 'baseUpdatedAt': None}).encode(), headers={'Content-Type':'application/json'})) as reply:
        assert reply.status == 200
    pc = webview.create_window('PC verification', runtime.url+'/?desktop=1', width=1280, height=800)
    tablet = webview.create_window('Tablet verification', runtime.url.replace('127.0.0.1', 'localhost')+'/', width=1280, height=720)
    result = {'ok': False, 'checks': []}

    def check():
        def until(window, script, timeout=25):
            deadline = time.monotonic()+timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(window, script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        def add_import(number):
            stamp = datetime.now(timezone.utc).isoformat()
            payload = {'draft': {'type':'investigation', 'title':f'Shared OCR {number}', 'payout':15000,
                                 'serviceDetails':{'location':'Area18', 'customer':'Shared test'}}}
            if number == 2:
                payload['draft'] = {'type':'cargo', 'title':'Shared cargo OCR', 'payout':15000, 'maxContainerScu':8,
                                    'consignments':[{'title':'Titanium', 'totalScu':8, 'routes':[{'pickup':'HUR-L5 High Course Station', 'dropoff':'Area18', 'targetScu':8}]}]}
            with backend.get_connection() as connection:
                connection.execute("INSERT INTO mission_imports VALUES (?, 'solo', 'pc', 'PC', ?, ?, 'pending', ?, ?)",
                                   (f'shared-{number}', f'hash-{number}', json.dumps(payload), stamp, stamp))
                connection.commit()

        def start_import(window):
            window.evaluate_js("document.activeElement?.blur();")
            until(window, "(() => {if(soloPolling || soloSaving || soloPending || remoteSaveTimer || missionAutoImportBusy || soloEditing())return false;window.importDone=false;autoImportPendingMissions().then(()=>window.importDone=true);return true;})()")

        def shared():
            with urlopen(runtime.url+'/api/state') as response: return json.load(response)

        try:
            for window in [pc, tablet]:
                until(window, "window.soloStartup?.phase === 'ready' && soloHydrated && !soloSaving && !soloPending && !missionAutoImportBusy")
                window.evaluate_js("clearInterval(missionAutoImportTimer);missionAutoImportTimer=null;window.originalMerge=soloMergeStates;soloMergeStates=(b,l,r)=>{const result=originalMerge(b,l,r);if(!result.ok)window.failedMerge={base:b,local:l,remote:r};return result;};window.originalFetch=fetch;window.fetch=async(url,options)=>{if(window.holdImports&&options?.method==='POST'&&JSON.parse(options.body||'{}').importIds){window.importWaiting=true;await new Promise(resolve=>window.releaseImport=resolve);}return originalFetch(url,options);};")
            expect(pc, "location.search.includes('desktop=1')", 'pc-app-view')
            expect(tablet, "!location.search.includes('desktop=1')", 'tablet-web-view')
            for number in range(1, 4):
                add_import(number)
                for window in [pc, tablet]:
                    window.evaluate_js('window.holdImports=true;window.importWaiting=false;')
                    start_import(window)
                for window in [pc, tablet]:
                    until(window, "(() => {if(window.importWaiting)return true;if(window.importDone&&!soloPending&&!soloSaving&&!soloPolling&&!remoteSaveTimer&&!missionAutoImportBusy){window.importDone=false;autoImportPendingMissions().then(()=>window.importDone=true);}return false;})()")
                pc.evaluate_js('window.holdImports=false;releaseImport()')
                until(pc, 'window.importDone')
                tablet.evaluate_js('window.holdImports=false;releaseImport()')
                until(tablet, 'window.importDone')
                for window in [pc, tablet]:
                    until(window, f"state.missions.filter(m=>m.sourceImportId==='shared-{number}').length===1 && !soloSaving && !soloPending")
                    expect(window, "!document.querySelector('.solo-conflict')", f'import-{number}-without-conflict-{window.uid}')
                assert len([m for m in shared()['state']['missions'] if m.get('sourceImportId') == f'shared-{number}']) == 1
                result['checks'].append(f'import-{number}-stored-once')

            # Keep a real edit form open on the tablet while the PC imports.
            tablet.evaluate_js("setActivePage('missions');window.editId=state.missions.find(m=>m.type==='cargo'&&!m.sourceImportId&&isMissionActive(m)).id;document.querySelector('[data-mission-id=\"'+editId+'\"] .edit-mission').click();missionForm.elements.title.value='Vom Tablet bearbeitet';missionForm.elements.title.focus();")
            add_import(4)
            start_import(pc)
            until(pc, "window.importDone && state.missions.some(m=>m.sourceImportId==='shared-4')")
            expect(tablet, "missionForm.elements.title.value==='Vom Tablet bearbeitet' && getMissionEditId()===editId", 'pc-import-preserves-tablet-edit-form')
            tablet.evaluate_js('document.activeElement.blur();missionSubmitButton.click()')
            for window in [pc, tablet]:
                until(window, "state.missions.some(m=>m.title==='Vom Tablet bearbeitet') && state.missions.some(m=>m.sourceImportId==='shared-4') && !soloPending && !soloSaving")
                expect(window, "!document.querySelector('.solo-conflict')", f'tablet-edit-and-pc-import-retained-{window.uid}')

            # Delete confirmation blocks polling; a new import must survive
            # the stale tablet's deletion and the removed mission stays gone.
            tablet.evaluate_js("setActivePage('missions');window.deleteId=state.missions.find(m=>m.sourceImportId==='shared-2').id;document.querySelector('[data-mission-id=\"'+deleteId+'\"] .delete-mission').click();")
            until(tablet, '!missionConfirmDialog.hidden')
            tablet.evaluate_js('missionConfirmDialogCancel.click()')
            expect(tablet, "state.missions.some(m=>m.id===deleteId)", 'cancel-delete-keeps-mission')
            tablet.evaluate_js("document.querySelector('[data-mission-id=\"'+deleteId+'\"] .delete-mission').click();")
            until(tablet, '!missionConfirmDialog.hidden')
            add_import(5)
            start_import(pc)
            until(pc, "window.importDone && state.missions.some(m=>m.sourceImportId==='shared-5')")
            tablet.evaluate_js('missionConfirmDialogConfirm.click()')
            for window in [pc, tablet]:
                until(window, "!state.missions.some(m=>m.sourceImportId==='shared-2') && state.missions.some(m=>m.sourceImportId==='shared-5') && !soloPending && !soloSaving")
                expect(window, "!document.querySelector('.solo-conflict')", f'tablet-delete-and-pc-import-retained-{window.uid}')

            # Completion uses the real card action and confirmation dialog.
            tablet.evaluate_js("setActivePage('missions');window.completeId=state.missions.find(m=>m.sourceImportId==='shared-3').id;document.querySelector('[data-mission-id=\"'+completeId+'\"] .complete-mission').click();")
            until(tablet, '!missionConfirmDialog.hidden')
            tablet.evaluate_js('missionConfirmDialogConfirm.click()')
            for window in [pc, tablet]:
                until(window, "isMissionCompleted(state.missions.find(m=>m.sourceImportId==='shared-3')) && !soloPending && !soloSaving")
            result['checks'].append('tablet-completion-visible-on-pc')
            for window in [pc, tablet]:
                window.evaluate_js('document.activeElement?.blur();startMissionAutoImportPolling();')
            revision = shared()['updatedAt']
            time.sleep(9)
            assert shared()['updatedAt'] == revision, 'Idle views keep rewriting the state'
            result['checks'].append('idle-clients-do-not-rewrite-state')
            for window in [pc, tablet]:
                expect(window, "!document.querySelector('.solo-conflict') && !localStorage.getItem(STORAGE_KEY+':conflict-recovery')", f'no-spurious-recovery-copy-{window.uid}')
            # Both persisted edits survive a fresh tablet navigation.
            tablet.load_url(runtime.url.replace('127.0.0.1', 'localhost')+'/?verify=reload')
            until(tablet, "location.search.includes('reload') && window.soloStartup?.phase==='ready' && soloHydrated")
            expect(tablet, "state.missions.some(m=>m.title==='Vom Tablet bearbeitet') && !state.missions.some(m=>m.sourceImportId==='shared-2')", 'tablet-reload-uses-shared-pc-state')
            errors = {window.uid:window.evaluate_js('window.soloErrors') for window in [pc, tablet]}
            assert not any(errors.values()), errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc())
            result['diagnostics'] = {window.uid:window.evaluate_js("({errors:window.soloErrors,phase:window.soloStartup?.phase,conflict:document.querySelector('.solo-conflict')?.textContent,pending:soloPending,revision:soloRevision,importDone:window.importDone,importWaiting:window.importWaiting,autoBusy:missionAutoImportBusy,polling:soloPolling,saving:!!soloSaving,timer:remoteSaveTimer,editing:soloEditing(),failedMerge:window.failedMerge})") for window in [pc, tablet]}
        finally:
            (args.data_dir/'shared-state-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            tablet.destroy()
            pc.destroy()

    try: webview.start(check, gui='edgechromium', private_mode=True)
    finally: runtime.stop()
    print(json.dumps({key:value for key,value in result.items() if key != 'diagnostics'}))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
