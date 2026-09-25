"""Cockpit and setup integration with two browser origins and isolated data."""
import argparse
import base64
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
    parser.add_argument('--screenshots', action='store_true')
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    # Keep the capture worker off even when the wizard saves the pilot name.
    runtime.settings['captureEnabled'] = False
    pc = webview.create_window('Cockpit verification', runtime.desktop_url, width=1280, height=720)
    tablet = webview.create_window('Independent layout verification', runtime.url.replace('127.0.0.1','localhost'), width=1024, height=768)
    original_post = SoloHandler.do_POST
    fail_settings = False
    def post(handler):
        nonlocal fail_settings
        if fail_settings and handler.path == '/api/solo/settings':
            fail_settings = False
            return handler.send_json(503, {'error':'Simulated save failure; retry'})
        return original_post(handler)
    SoloHandler.do_POST = post
    result = {'ok':False, 'checks':[]}

    def check():
        nonlocal fail_settings
        def until(window, script, timeout=20):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)
        def expect(window, script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)
        def reload(window):
            window.evaluate_js('window.__oldPage=true;setTimeout(()=>location.reload(),0)')
            until(window,"!window.__oldPage && window.soloStartup?.phase==='ready' && soloHydrated && remoteHydrationComplete && !soloSaving && !soloPending")
        def screenshot(name):
            if not args.screenshots: return
            from System import Action
            time.sleep(.3)
            holder = {}
            control = pc.native.webview
            control.Invoke(Action(lambda: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', '{"format":"png"}'))))
            payload = json.loads(str(holder['task'].Result))
            (args.data_dir/(name+'.png')).write_bytes(base64.b64decode(payload['data']))
        try:
            for window in [pc,tablet]:
                until(window,"window.soloStartup?.phase==='ready' && soloHydrated && remoteHydrationComplete && !soloSaving && !soloPending")
            until(pc,"!document.getElementById('soloSetupWelcome').hidden")
            result['checks'].append('fresh-profile-offers-setup')
            for window in [pc,tablet]:
                expect(window,"!document.querySelector('.solo-conflict')",'fresh-clients-without-conflict-'+window.uid)
            with urlopen(runtime.url+'/api/state') as response:
                assert json.load(response)['state'] is None
            result['checks'].append('fresh-clients-leave-server-state-empty')
            pc.evaluate_js("document.querySelector('[data-cockpit-open]').click()")
            until(pc,"!soloCockpitDialog.hidden")
            screenshot('cockpit-editor')
            pc.evaluate_js("document.querySelector('[data-cockpit-toggle=balance]').click();document.querySelector('[data-cockpit-move=mission-up]').click();soloCockpitCancel.click()")
            expect(pc,"!document.querySelector('[data-cockpit-card=balance]').hidden && hubSummary.firstElementChild.dataset.cockpitCard==='ship'",'cancel-keeps-layout')
            pc.evaluate_js("document.querySelector('[data-cockpit-open]').click();document.querySelector('[data-cockpit-toggle=balance]').click();document.querySelector('[data-cockpit-move=mission-up]').click();soloCockpitSave.click();renderHub()")
            expect(pc,"document.querySelector('[data-cockpit-card=balance]').hidden && hubSummary.firstElementChild.dataset.cockpitCard==='mission'",'layout-survives-data-render')
            expect(tablet,"!document.querySelector('[data-cockpit-card=balance]').hidden && hubSummary.firstElementChild.dataset.cockpitCard==='ship'",'other-device-layout-unchanged')
            reload(pc)
            expect(pc,"document.querySelector('[data-cockpit-card=balance]').hidden && hubSummary.firstElementChild.dataset.cockpitCard==='mission'",'layout-survives-reload')
            pc.evaluate_js("document.querySelector('[data-cockpit-open]').click();document.querySelectorAll('[data-cockpit-toggle]').forEach(e=>{if(e.checked)e.click()});soloCockpitSave.click()")
            expect(pc,"hubSummary.hidden && hubTodayList.hidden && !soloCockpitEmpty.hidden && !!document.querySelector('[data-cockpit-open]').getClientRects().length",'all-hidden-layout-remains-recoverable')
            pc.evaluate_js("document.querySelector('[data-cockpit-open]').click();soloCockpitReset.click();soloCockpitSave.click()")
            expect(pc,"!hubSummary.hidden && !document.querySelector('[data-cockpit-card=balance]').hidden",'restore-default-layout')
            pc.evaluate_js("document.querySelector('[data-setup-open=welcome]').click()")
            until(pc,"!soloSetupDialog.hidden")
            pc.evaluate_js("soloSetupNext.click()")
            expect(pc,"!soloSetupError.hidden && !document.querySelector('[data-setup-step=\"0\"]').hidden",'pilot-validation')
            pc.evaluate_js("soloSetupForm.elements.pilot.value='Verification Pilot';soloSetupNext.click();soloSetupForm.elements.ship.selectedIndex=1;soloSetupForm.elements.registration.value='TEST-024';soloSetupNext.click()")
            expect(pc,"!document.querySelector('[data-setup-step=\"2\"]').hidden",'ship-selection-advances')
            pc.evaluate_js("soloSetupRecord.click()")
            until(pc,"soloSetupHotkey.dataset.recording==='listening'")
            pc.evaluate_js("soloSetupHotkey.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',ctrlKey:true,shiftKey:true,bubbles:true}));soloSetupNext.click();soloSetupForm.elements.port.value='80';soloSetupNext.click()")
            expect(pc,"!soloSetupError.hidden && !soloSetupDialog.hidden",'port-validation')
            pc.evaluate_js(f"soloSetupForm.elements.port.value='{runtime.httpd.server_port}'")
            pc.evaluate_js("soloSetupError.hidden=true")
            screenshot('setup-network')
            fail_settings = True
            pc.evaluate_js("soloSetupNext.click()")
            until(pc,"!soloSetupError.hidden && soloSetupError.textContent.includes('Simulated') && !soloSetupNext.disabled")
            expect(pc,"state.fleet.length===1 && !soloSetupForm.elements.port.disabled",'failed-settings-save-is-retryable')
            pc.evaluate_js("soloSetupNext.click()")
            until(pc,"soloSetupDialog.hidden && !soloSaving && !soloPending")
            expect(pc,"state.fleet.length===1 && state.fleet[0].registration==='TEST-024' && state.activeFleetEntryId===state.fleet[0].id",'retry-does-not-duplicate-ship')
            expect(pc,"getSoloPilotProfile().name==='Verification Pilot' && soloSettingsForm.elements.captureHotkey.value==='Ctrl+Shift+F10'",'pilot-and-hotkey-saved')
            assert runtime.settings['setupCompleted'] and runtime.settings['captureHotkey']=='Ctrl+Shift+F10'
            result['checks'].append('setup-status-stored-on-pc')
            until(tablet,"state.fleet.length===1 && getSoloPilotProfile().name==='Verification Pilot'")
            expect(tablet,"!document.querySelector('[data-cockpit-card=balance]').hidden",'shared-data-with-independent-layout')
            reload(pc)
            time.sleep(1.2)
            expect(pc,"soloSetupWelcome.hidden",'completed-setup-not-offered-again')
            pc.evaluate_js("settingsMenuButton.click();document.querySelector('[data-settings-view-target=profile]').click();document.querySelector('[data-setup-open=\"\"]').click()")
            until(pc,"!soloSetupDialog.hidden")
            pc.evaluate_js("soloSetupNext.click()")
            expect(pc,"!soloSetupFleetReady.hidden && soloSetupShipFields.hidden",'existing-fleet-preserved-on-reopen')
            pc.evaluate_js("soloSetupCancel.click();uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}))")
            until(pc,"!soloSaving && !soloPending")
            pc.evaluate_js("document.querySelector('[data-cockpit-open]').click()")
            expect(pc,"soloCockpitTitle.textContent==='Customize cockpit'",'english-layout-editor')
            pc.resize(768,1024)
            expect(pc,"soloCockpitDialog.querySelector('section').scrollWidth<=soloCockpitDialog.querySelector('section').clientWidth+1",'portrait-editor-fits')
            pc.evaluate_js("soloCockpitCancel.click();soloSetup.open()")
            until(pc,"!soloSetupDialog.hidden")
            expect(pc,"soloSetupTitle.textContent==='Welcome aboard'",'english-setup')
            pc.resize(1280,720)
            expect(pc,"soloSetupDialog.querySelector('section').getBoundingClientRect().bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth",'hd-ready-setup-fits')
            pc.evaluate_js("soloSetupCancel.click();setActivePage('hub')")
            time.sleep(.3)
            screenshot('cockpit')
            expect(pc,"!document.body.querySelector('.app-shell')?.inert",'background-restored-after-dialog')
            for window in [pc,tablet]:
                assert not window.evaluate_js('window.soloErrors'), window.evaluate_js('window.soloErrors')
            result['ok'] = True
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc(), errors=pc.evaluate_js('window.soloErrors'), setup=pc.evaluate_js("({hidden:soloSetupDialog.hidden,message:soloSetupError.textContent,pending:Boolean(soloPending),saving:Boolean(soloSaving)})"))
        finally:
            (args.data_dir/'personalize-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
            for window in [pc,tablet]: window.destroy()
    try:
        webview.start(check,gui='edgechromium',private_mode=False,storage_path=str(args.data_dir/'WebView'))
    finally:
        SoloHandler.do_POST = original_post
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
