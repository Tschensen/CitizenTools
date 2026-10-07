"""Exercise route persistence with a passive peer and delayed background reads."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--legacy-source', type=Path, help='Older release source ZIP for a stale-browser regression')
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    pc = webview.create_window('Route sync: PC', runtime.desktop_url, width=1280, height=900)
    peer = webview.create_window('Route sync: passive device', runtime.url.replace('127.0.0.1', 'localhost'), width=800, height=720)
    report = {'ok': False, 'checks': [], 'failures': []}

    def check():
        def until(window, expression):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(expression):
                        return
                except Exception:
                    pass
                time.sleep(.1)
            raise AssertionError(expression)

        def expect(window, expression, name):
            report['checks' if window.evaluate_js(expression) else 'failures'].append(name)

        def saved(window):
            window.evaluate_js('window.syncTestSaved=false;flushSoloState().then(()=>window.syncTestSaved=true)')
            until(window, 'syncTestSaved && !soloSync.status.pending && !soloSync.status.saving && !soloSync.status.scheduled')

        try:
            for window in [pc, peer]:
                until(window, "window.soloStartup?.phase==='ready' && soloSync.status.hydrated && !soloSync.status.pending && !soloSync.status.saving && !missionAutoImportBusy")
                window.evaluate_js("""window.syncTrace=[];window.syncFetch=window.fetch.bind(window);
                  window.fetch=async(url,options={})=>{const response=await syncFetch(url,options);if(options.method==='POST' && String(url).includes('/api/state')) syncTrace.push({status:response.status,body:JSON.parse(options.body)});return response;};
                  window.syncMerge=soloMergeStates;soloMergeStates=(base,local,remote)=>{const result=syncMerge(base,local,remote);if(!result.ok) syncTrace.push({conflict:Object.keys(local).filter(key=>!soloEqual(base[key],local[key])&&!soloEqual(base[key],remote[key])&&!soloEqual(local[key],remote[key]))});return result;};""")
            pc.evaluate_js("""window.routeMission=(id,pickup,dropoff)=>({id,type:'cargo',title:'Fracht '+id,status:'active',assignedFleetEntryId:'route-ship',pickup,dropoff,segments:[{id:'segment-'+id,title:'Titanium',pickup,dropoff,width:2,depth:2,height:2,quantity:1,order:0}],loads:[{id:'load-'+id,segmentId:'segment-'+id,label:'Titanium',width:2,depth:2,height:2,scu:8,pickup,dropoff,placement:null}]});
              state=sanitizeState({...state,fleet:[{id:'route-ship',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-09-01'}],activeFleetEntryId:'route-ship',missions:[routeMission('a','Area18','Lorville'),routeMission('b','New Babbage','Orison')],runRouteProgress:{},runRouteOrder:{},currentLocation:'',runCompletedRoutePoints:[]});
              applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')),'route-ship','ship:hermes');render();setActivePage('run');persist();""")
            saved(pc)
            until(peer, "state.missions.length===2 && !soloSync.status.pending && !soloSync.status.saving && !missionAutoImportBusy")
            peer.evaluate_js("window.passivePostsBefore=syncTrace.length;window.passiveDone=false;soloSync.refresh().then(()=>{window.passiveDone=true;})")
            until(peer, 'passiveDone && !soloSync.status.pending && !soloSync.status.saving && !soloSync.status.scheduled')
            expect(peer, 'syncTrace.length===passivePostsBefore', 'refresh-on-passive-device-does-not-write-state')
            pc.evaluate_js("moveRunRouteStop(2,0);window.expectedRoute=JSON.stringify(state.runRouteOrder['route-ship']);")
            saved(pc)
            order = pc.evaluate_js('expectedRoute')
            until(peer, "JSON.stringify(state.runRouteOrder['route-ship'])===" + json.dumps(order))
            expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===expectedRoute && !document.querySelector('.solo-conflict')", 'pc-route-survives-live-peer-refresh')
            for _ in range(3):
                for window in [pc, peer]:
                    window.evaluate_js('window.syncPolled=false;pollSoloState().then(()=>window.syncPolled=true)')
                    until(window, 'syncPolled && !soloSync.status.pending && !soloSync.status.saving')
            expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===expectedRoute && !document.querySelector('.solo-conflict')", 'route-stays-saved-after-repeated-live-polls')
            until(pc, '!missionAutoImportBusy && !soloSync.status.busy && !soloSync.status.saving && !soloSync.status.pending && !soloSync.status.scheduled')
            pc.evaluate_js("""window.originalRouteFetch=fetchRemoteState;window.delayedReadReady=false;window.delayedReadDone=false;
              fetchRemoteState=async()=>{const payload=await originalRouteFetch();window.delayedReadReady=true;await new Promise(resolve=>window.releaseDelayedRead=resolve);return payload;};
              autoImportPendingMissions().finally(()=>window.delayedReadDone=true);""")
            until(pc, 'delayedReadReady')
            pc.evaluate_js("moveRunRouteStop(1,0);window.expectedRoute=JSON.stringify(state.runRouteOrder['route-ship']);")
            saved(pc)
            pc.evaluate_js('window.savedRevision=soloSync.status.revision;releaseDelayedRead()')
            until(pc, 'delayedReadDone')
            expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===expectedRoute && soloSync.status.revision===savedRevision", 'late-background-read-cannot-undo-committed-route')
            pc.evaluate_js('fetchRemoteState=originalRouteFetch')
            pc.evaluate_js("moveRunRouteStop(2,3);window.expectedRoute=JSON.stringify(state.runRouteOrder['route-ship']);")
            saved(pc)
            expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===expectedRoute && !document.querySelector('.solo-conflict')", 'late-background-read-does-not-create-false-conflict')
            order = pc.evaluate_js('expectedRoute')
            until(peer, "JSON.stringify(state.runRouteOrder['route-ship'])===" + json.dumps(order))
            peer.evaluate_js("setActivePage('run');moveRunRouteStop(2,3);window.peerRoute=JSON.stringify(state.runRouteOrder['route-ship']);")
            saved(peer)
            peer_order = peer.evaluate_js('peerRoute')
            until(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===" + json.dumps(peer_order))
            expect(peer, "peerRoute!==" + json.dumps(order) + " && !document.querySelector('.solo-conflict')", 'intentional-route-edit-on-additional-device-still-saves')
            report['pcTrace'] = pc.evaluate_js('syncTrace')
            report['peerTrace'] = peer.evaluate_js('syncTrace')
            pc.load_url(runtime.desktop_url + '&route-sync=reload')
            until(pc, "location.search.includes('route-sync=reload') && window.soloStartup?.phase==='ready' && soloSync.status.hydrated")
            expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===" + json.dumps(peer_order), 'shared-route-survives-reload')
            if args.legacy_source:
                # Run the shipped legacy normalizer and display selection code.
                # The older browser drops fields it does not know, then writes
                # the resulting state even though nobody edited on that device.
                with zipfile.ZipFile(args.legacy_source) as archive:
                    persistence = archive.read('CitizenTools-Source/web/scripts/state-persistence.js').decode('utf-8')
                    cargo = archive.read('CitizenTools-Source/web/scripts/cargo-ui.js').decode('utf-8')
                sanitizer = 'function sanitizeState(' + persistence.split('function sanitizeState(', 1)[1].split('function sanitizePlacement(', 1)[0]
                selection = 'function ensureSelectedLoad(' + cargo.split('function ensureSelectedLoad(', 1)[1].split('\nfunction ', 1)[0]
                peer.evaluate_js(sanitizer + '\n' + selection)
                peer.evaluate_js("""window.beforeLegacyPosts=syncTrace.length;window.currentVersionFetch=fetch;
                  window.fetch=(url,options={})=>{if(options.method==='POST' && String(url).includes('/api/state')){const body=JSON.parse(options.body);delete body.clientVersion;options={...options,body:JSON.stringify(body)};}return currentVersionFetch(url,options);};
                  soloSync.refresh();""")
                until(peer, 'syncTrace.length>beforeLegacyPosts')
                expect(peer, 'syncTrace.at(-1).status===428', 'legacy-view-cannot-save-an-outdated-state-format')
                pc.evaluate_js('window.legacyPolled=false;pollSoloState().then(()=>window.legacyPolled=true)')
                until(pc, 'legacyPolled && !soloSync.status.busy')
                expect(pc, "JSON.stringify(state.runRouteOrder['route-ship'])===" + json.dumps(peer_order), 'saved-route-survives-an-old-passive-browser')
                report['legacyPostStatuses'] = peer.evaluate_js('syncTrace.slice(beforeLegacyPosts).map(item=>item.status)')
            report['errors'] = [window.evaluate_js('window.soloErrors') for window in [pc, peer]]
            report['ok'] = not report['failures'] and not any(report['errors'])
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc())
        finally:
            (args.data_dir / 'route-sync-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            for window in [pc, peer]:
                window.destroy()
    try:
        webview.start(check, gui='edgechromium', private_mode=False, storage_path=str(args.data_dir/'WebView'))
    finally:
        runtime.stop()
    print(json.dumps({key: value for key,value in report.items() if key not in {'pcTrace','peerTrace'}}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
