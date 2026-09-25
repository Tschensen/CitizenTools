"""Exercise shortcut recording in WebView2 with a real Windows hotkey listener.

The listener uses a counter instead of screenshot capture; all data is isolated.
"""
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
from companion.capture import GlobalHotkeyListener


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.settings['captureEnabled'] = False
    runtime.start(capture_enabled=False)
    runtime.settings['port'] = runtime.httpd.server_port
    calls = []
    listener = GlobalHotkeyListener('Ctrl+Shift+F23', lambda: calls.append(True), runtime.hotkey_recording_gate)
    listener.start()
    # The HTTP handler waits until the real listener releases its registration.
    runtime.worker = listener.thread
    window = webview.create_window('Hotkey recording verification', runtime.url+'/?desktop=1', width=1100, height=800)
    result = {'ok': False, 'checks': []}

    def check():
        def until(script, timeout=15):
            deadline = time.monotonic()+timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script):
                        return
                except Exception:
                    pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        def begin():
            window.evaluate_js('soloHotkey.click()')
            until("soloHotkey.dataset.recording === 'listening'")

        def key(key, **options):
            window.evaluate_js(f"soloHotkey.dispatchEvent(new KeyboardEvent('keydown', {json.dumps(dict(key=key, bubbles=True, cancelable=True, **options))}));")

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated && soloStatus.textContent !== ''")
            window.evaluate_js("setSettingsView('companion')")
            begin()
            assert runtime.hotkey_recording_gate.active()
            assert runtime.hotkey_recording_gate.released.is_set()
            listener._invoke_callback()
            assert not calls
            result['checks'].append('windows-hotkey-released-and-capture-suppressed')
            key('Control', ctrlKey=True)
            expect("soloHotkey.dataset.recording === 'listening' && soloHotkey.value === 'Ctrl+Shift+F12'", 'modifier-alone-does-not-replace-shortcut')
            key('F11')
            expect("soloHotkey.dataset.recording === 'listening' && soloHotkeyHint.textContent.includes('verwenden')", 'main-key-requires-modifier')
            key('Delete', ctrlKey=True)
            expect("soloHotkey.dataset.recording === 'listening'", 'unsupported-key-rejected')
            key('F11', ctrlKey=True, shiftKey=True)
            expect("soloHotkey.value === 'Ctrl+Shift+F11' && soloHotkey.dataset.recording === 'idle'", 'combination-recorded')
            assert runtime.settings['captureHotkey'] == 'Ctrl+Shift+F12'
            result['checks'].append('recording-needs-explicit-save')
            until("soloHotkeyHint.textContent.includes('speichern')")
            begin()
            key('Escape')
            expect("soloHotkey.value === 'Ctrl+Shift+F11' && soloHotkey.dataset.recording === 'idle'", 'escape-keeps-previous-value')
            begin()
            window.evaluate_js('soloHotkeyRecord.click()')
            expect("soloHotkey.dataset.recording === 'idle'", 'cancel-button')
            begin()
            window.evaluate_js('soloSettingsForm.elements.pilotName.focus()')
            expect("soloHotkey.dataset.recording === 'idle'", 'leaving-field-cancels')
            begin()
            key('%', code='Digit5', keyCode=53, ctrlKey=True, shiftKey=True)
            expect("soloHotkey.value === 'Ctrl+Shift+5'", 'shifted-digit-uses-windows-digit')
            begin()
            key('Z', code='KeyY', keyCode=90, ctrlKey=True, altKey=True)
            expect("soloHotkey.value === 'Ctrl+Alt+Z'", 'german-layout-uses-logical-letter')
            begin()
            window.evaluate_js("soloHotkey.dispatchEvent(new KeyboardEvent('keyup',{key:'PrintScreen',ctrlKey:true,bubbles:true,cancelable:true}))")
            expect("soloHotkey.value === 'Ctrl+PrintScreen'", 'printscreen-keyup-supported')
            begin()
            key('F11', ctrlKey=True, shiftKey=True)
            # No OCR worker is needed for persistence, and stopping the test
            # listener is independent of the runtime's normal worker lifecycle.
            runtime.worker = None
            window.evaluate_js('soloSettingsForm.requestSubmit()')
            until("soloSettingsMessage.textContent.includes('gespeichert')")
            assert json.loads(runtime.config_path.read_text(encoding='utf-8'))['captureHotkey'] == 'Ctrl+Shift+F11'
            result['checks'].append('recorded-hotkey-saved-to-settings')
            window.load_url(runtime.url+'/?desktop=1&verify=reload')
            until("location.search.includes('reload') && window.soloStartup?.phase === 'ready' && soloHotkey.value === 'Ctrl+Shift+F11'")
            result['checks'].append('saved-hotkey-restored-after-reload')
            window.evaluate_js("setSettingsView('companion'); uiLanguageSelect.value='en'; uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));")
            expect("soloHotkeyRecord.textContent === 'Record' && soloHotkeyHint.textContent.includes('Click')", 'english-recording-labels')
            begin()
            expect("soloHotkeyRecord.textContent === 'Cancel' && soloHotkeyHint.textContent.includes('Esc')", 'english-listening-labels')
            window.evaluate_js("window.dispatchEvent(new Event('blur'))")
            expect("soloHotkey.dataset.recording === 'idle'", 'window-blur-cancels')
            window.evaluate_js("window.normalFetch=fetch;window.fetch=(url,options)=>String(url).includes('/hotkey-recording')?Promise.reject(new Error('test disconnect')):normalFetch(url,options);soloHotkey.click();")
            until("soloHotkey.dataset.recording === 'idle' && soloHotkeyHint.textContent.includes('unavailable')")
            expect("soloHotkey.value === 'Ctrl+Shift+F11'", 'connection-failure-keeps-shortcut')
            window.evaluate_js('window.fetch=normalFetch')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc(), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'hotkey-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        listener.stop()
        runtime.worker = None
        runtime.stop()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
