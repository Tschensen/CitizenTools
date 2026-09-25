"""License/release viewer integration checks with isolated native WebView2 data."""
import argparse
import json
from pathlib import Path
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime, SoloHandler, VERSION
import solo_about


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    unavailable = True
    original_get = SoloHandler.do_GET

    def test_get(handler):
        if unavailable and handler.path == '/api/solo/about':
            return handler.send_json(503, {'error': 'test_unavailable'})
        return original_get(handler)

    SoloHandler.do_GET = test_get
    window = webview.create_window('Licenses and release notes verification', runtime.url+'/?desktop=1', width=1280, height=800)
    result = {'ok': False, 'checks': []}

    def check():
        nonlocal unavailable
        def until(script, timeout=20):
            deadline = time.monotonic()+timeout
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert window.evaluate_js(script), name
            result['checks'].append(name)

        try:
            until("window.soloStartup?.phase === 'ready' && soloHydrated")
            window.evaluate_js("settingsMenuButton.click(); document.querySelector('[data-settings-view-target=about]').click()")
            until("soloAboutContent.textContent.includes('Erneut versuchen')")
            result['checks'].append('unavailable-documents-have-retry')
            unavailable = False
            window.evaluate_js('soloAboutContent.querySelector("button").click()')
            until(f"soloAboutContent.querySelectorAll('[data-release]').length === {len(solo_about.releases())}")
            expect("soloAboutContent.textContent.includes('Tschensen') && soloAboutContent.querySelector('a[href=\"https://github.com/Tschensen/CitizenTools\"]')", 'original-author-and-repository-visible')
            expect(f"soloAboutVersion.textContent === 'v{VERSION}'", 'actual-app-version')
            expect(f"document.querySelector('[data-release]').dataset.release==='{VERSION}' && document.querySelector('[data-release]').open", 'latest-release-open-first')
            expect("document.querySelector('[data-release=\"0.1.0\"]') && !document.querySelector('[data-release=\"0.1.0\"]').open", 'history-back-to-first-release')
            window.evaluate_js("document.querySelector('[data-release=\"0.1.4\"] summary').click()")
            expect("document.querySelector('[data-release=\"0.1.4\"]').open && document.querySelector('[data-release=\"0.1.4\"]').textContent.includes('Datentransfer')", 'older-release-expands')
            window.evaluate_js("document.querySelector('[data-about-section=licenses]').click()")
            expect(f"document.querySelectorAll('[data-document]').length === {len(solo_about.documents())}", 'all-bundled-licenses-listed')
            window.evaluate_js("document.querySelector('[data-document=\"CITIZEN-TOOLS-GPL.txt\"] summary').click()")
            expect("document.querySelector('[data-document=\"CITIZEN-TOOLS-GPL.txt\"]').open && document.querySelector('[data-document=\"CITIZEN-TOOLS-GPL.txt\"] pre').textContent.includes('GNU GENERAL PUBLIC LICENSE')", 'full-gpl-license-readable')
            expect("document.querySelector('[data-document=\"CITIZEN-TOOLS-NOTICE.txt\"] pre').textContent.includes('nicht dokumentiert')", 'third-party-scope-and-ocr-gap-disclosed')
            window.evaluate_js("soloLicenseSearch.value='WebView2'; soloLicenseSearch.dispatchEvent(new Event('input',{bubbles:true}))")
            expect("[...document.querySelectorAll('.solo-license-list details')].filter(e=>!e.hidden).length === 4", 'component-search')
            window.evaluate_js("soloLicenseSearch.value='no-such-license'; soloLicenseSearch.dispatchEvent(new Event('input',{bubbles:true}))")
            expect("[...document.querySelectorAll('.solo-license-list details')].every(e=>e.hidden) && soloAboutContent.textContent.includes('Keine passenden')", 'empty-search-result')
            window.evaluate_js("soloLicenseSearch.value=''; soloLicenseSearch.dispatchEvent(new Event('input',{bubbles:true}))")
            expect("[...document.querySelectorAll('.solo-license-text')].every(e=>!e.children.length)", 'license-text-rendered-without-html')
            expect("!!soloAboutContent.querySelector('a[download][href=\"./api/solo/licenses.zip\"]')", 'license-download-available')
            window.evaluate_js("uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}))")
            expect("document.querySelector('[data-settings-view-target=about]').textContent === 'About Citizen Tools' && soloAboutContent.textContent.includes('Free to use')", 'english-about-interface')
            window.evaluate_js("document.querySelector('[data-about-section=history]').click()")
            expect("document.querySelector('[data-release]').textContent.includes('GPL license & fresh interface') && soloAboutContent.textContent.includes('This version')", 'english-release-notes')
            expect("!!soloAboutContent.querySelector('a[href$=\"language=en\"]')", 'download-follows-language')
            window.resize(768, 1024)
            expect("soloAboutPanel.scrollWidth <= soloAboutPanel.clientWidth+1", 'tablet-panel-has-no-horizontal-overflow')
            window.evaluate_js("document.querySelector('[data-about-section=licenses]').click(); document.querySelector('[data-document=\"WEBVIEW2-RUNTIME.txt\"] summary').click()")
            expect("[...document.querySelectorAll('.solo-license-text')].filter(e=>e.getClientRects().length).every(e=>e.scrollWidth<=e.clientWidth+1)", 'long-license-wraps-on-tablet')
            errors = window.evaluate_js('window.soloErrors')
            assert not errors, errors
            result.update(ok=True, errors=errors)
        except Exception as error:
            result.update(error=str(error), traceback=traceback.format_exc(), errors=window.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir/'about-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            window.destroy()

    try:
        webview.start(check, gui='edgechromium', private_mode=True)
    finally:
        runtime.stop()
        SoloHandler.do_GET = original_get
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
