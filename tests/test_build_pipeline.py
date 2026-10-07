import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from tools.build_cache import cached_bundle, native_key
from tools.build_packages import assemble_program, package_variants, write_installation, write_release
from tools.build_pipeline import parse_args
from tools.build_publish import publish_release
from update_contract import FULL_ASSETS, UPDATE_ASSETS
from update_helper import extract_portable


def put(root, name, content='fixture'):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    return path


class CacheTests(unittest.TestCase):
    def test_only_native_inputs_invalidate_each_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['app.py', 'runtime.py', 'update_helper.py', 'update_contract.py', 'server/app.py',
                         'shared/mission_import/parser.py', 'web/scripts/example.js', 'docs/BUILD.md',
                         'tools/build_cache.py', 'requirements-build.txt', 'companion/assets/citizen-tools.ico']:
                put(root, name)
            environment = {'python': 'example', 'packages': ['example==1']}
            keys = lambda: tuple(native_key(root, kind, environment) for kind in ['app', 'helper'])
            original = keys()
            for name in ['web/scripts/example.js', 'docs/BUILD.md', 'release-notes.json']:
                put(root, name, 'changed')
            self.assertEqual(keys(), original)
            put(root, 'shared/mission_import/parser.py', 'changed')
            changed = keys()
            self.assertNotEqual(changed[0], original[0])
            self.assertEqual(changed[1], original[1])
            (root / 'shared/mission_import/parser.py').unlink()
            self.assertNotEqual(keys()[0], changed[0])
            changed = keys()
            put(root, 'update_contract.py', 'changed')
            self.assertTrue(all(a != b for a, b in zip(keys(), changed)))
            changed = keys()
            environment['packages'] = ['example==2']
            self.assertTrue(all(a != b for a, b in zip(keys(), changed)))

    def test_cache_hits_corruption_and_forced_rebuild(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            def compile(work):
                put(work, 'output/app.exe', 'compiled')
                return work / 'output'
            build = Mock(side_effect=compile)
            first, reused = cached_bundle(cache, 'key', build)
            self.assertFalse(reused)
            self.assertEqual(cached_bundle(cache, 'key', build), (first, True))
            build.assert_called_once()
            (first / 'app.exe').write_text('corrupt')
            second, reused = cached_bundle(cache, 'key', build)
            self.assertFalse(reused)
            self.assertEqual((second / 'app.exe').read_text(), 'compiled')
            third, reused = cached_bundle(cache, 'key', build, force=True)
            self.assertFalse(reused)
            self.assertNotEqual(second, third)
            self.assertEqual(build.call_count, 3)

    def test_failed_build_does_not_poison_previous_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            def compile(work):
                put(work, 'output/app.exe')
                return work / 'output'
            first, _ = cached_bundle(cache, 'key', compile)
            with self.assertRaises(RuntimeError):
                cached_bundle(cache, 'key', Mock(side_effect=RuntimeError('failed')), force=True)
            self.assertEqual(cached_bundle(cache, 'key', Mock(side_effect=AssertionError('must reuse'))), (first, True))


class PackageTests(unittest.TestCase):
    def test_fresh_resources_and_removed_files_with_reused_native_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['web/scripts/current.js', 'web/scripts/removed.js', 'companion/assets/logo.svg',
                         'companion/scripts/capture-screen.ps1',
                         'shared/mission_import/prepare-ocr-image.ps1', 'release-notes.json', 'project.json',
                         'packaging/ocr-lock.json', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'README.md', 'docs/BUILD.md']:
                put(root, name)
            native = root / 'native'
            put(native, 'CitizenTools-Solo.exe')
            put(native, '_internal/python.dll')
            helper = root / 'helper'; put(helper, 'CitizenTools-Updater.exe')
            ocr = root / 'ocr'; put(ocr, 'tesseract.exe')
            legal = root / 'legal'; put(legal, 'catalog.json', '[]')
            source = put(root, 'source.zip')
            args = (native, helper, ocr, legal, source, '1.0.0', 'notes')
            assemble_program(root, root / 'first', *args)
            (root / 'web/scripts/removed.js').unlink()
            put(root, 'web/scripts/current.js', 'fresh')
            put(root, 'companion/scripts/capture-screen.ps1', 'fresh capture script')
            assemble_program(root, root / 'second', *args)
            self.assertEqual((root / 'second/_internal/web/scripts/current.js').read_text(), 'fresh')
            self.assertFalse((root / 'second/_internal/web/scripts/removed.js').exists())
            capture = 'companion/scripts/capture-screen.ps1'
            self.assertEqual((root / 'second/_internal' / capture).read_text(), 'fresh capture script')
            manifest = json.loads((root / 'second/installation.json').read_text())
            self.assertIn('_internal/' + capture, manifest['files'])
            (root / capture).unlink()
            with self.assertRaises(FileNotFoundError):
                assemble_program(root, root / 'missing-capture', *args)
            self.assertFalse((native / '_internal/web').exists())
            self.assertEqual((root / 'first/CitizenTools-Solo.exe').read_bytes(), (root / 'second/CitizenTools-Solo.exe').read_bytes())

    def test_full_and_update_archives_have_accurate_independent_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); package = root / 'CitizenTools-Solo'
            for name in ['CitizenTools-Solo.exe', 'CitizenTools-Updater.exe', '_internal/ocr/tesseract.exe',
                         '_internal/web/index.html', '_internal/source/CitizenTools-Solo-Source.zip']:
                put(package, name)
            write_installation(package, '1.0.0')
            webview = put(root, 'webview.exe', 'prerequisite')
            observed = []
            def compile(root, package, stage, version, *, update=False, **kwargs):
                manifest = json.loads((package / 'installation.json').read_text())
                observed.append((update, any(name.startswith('prerequisites/') for name in manifest['files'])))
                put(stage, (UPDATE_ASSETS if update else FULL_ASSETS)['installer'])
            with patch('tools.build_packages.compile_installer', side_effect=compile):
                artifacts, modes = package_variants(root, package, root, '1.0.0', profile='release', installer=True, webview=webview)
            self.assertEqual(observed, [(True, False), (False, True)])
            self.assertEqual(set(modes), {'portable', 'installer'})
            for names, has_prerequisite in [(FULL_ASSETS, True), (UPDATE_ASSETS, False)]:
                dest = root / ('extracted-full' if has_prerequisite else 'extracted-update')
                extract_portable(root / names['portable'], dest, '1.0.0')
                self.assertEqual((dest / 'prerequisites').exists(), has_prerequisite)
                self.assertTrue((dest / '_internal/ocr/tesseract.exe').is_file())
            write_release(root, artifacts, '1.0.0', [], modes)
            manifest = json.loads((root / 'release.json').read_text())
            self.assertEqual(manifest['updates']['assets'], UPDATE_ASSETS)
            self.assertEqual({entry['name'] for entry in manifest['files']}, {*FULL_ASSETS.values(), *UPDATE_ASSETS.values()})

    def test_update_profile_needs_no_webview_and_app_needs_no_archives(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); package = root / 'CitizenTools-Solo'
            put(package, 'CitizenTools-Solo.exe')
            write_installation(package, '1.0.0')
            self.assertEqual(package_variants(root, package, root, '1.0.0', profile='app'), ([], []))
            artifacts, modes = package_variants(root, package, root, '1.0.0', profile='updates')
            self.assertEqual([path.name for path in artifacts], [UPDATE_ASSETS['portable']])
            self.assertEqual(modes, ['portable'])
            self.assertFalse((root / FULL_ASSETS['portable']).exists())

    def test_profile_change_retires_stale_artifacts_and_rollback_restores_them(self):
        for fail in [False, True]:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); output = root / 'dist'; stage = root / 'stage'
                put(output, 'app', 'old'); put(output, 'old.zip', 'old package')
                put(stage, 'app', 'new')
                rename = Path.rename
                def move(source, target):
                    if fail and source == stage / 'app':
                        raise PermissionError('locked')
                    return rename(source, target)
                with patch.object(Path, 'rename', move):
                    if fail:
                        with self.assertRaises(RuntimeError):
                            publish_release(stage, output, ['app'], obsolete=['old.zip'])
                        self.assertEqual((output / 'old.zip').read_text(), 'old package')
                    else:
                        publish_release(stage, output, ['app'], obsolete=['old.zip'])
                        self.assertFalse((output / 'old.zip').exists())
                        self.assertEqual((stage / 'previous/old.zip').read_text(), 'old package')

    def test_release_requires_offline_prerequisite_but_updates_do_not(self):
        base = ['--tesseract-dir', 'ocr', '--ocr-sources', 'sources.zip']
        self.assertEqual(parse_args([*base, '--profile', 'updates']).profile, 'updates')
        with patch('sys.stderr'), self.assertRaises(SystemExit):
            parse_args(base)
        with patch('sys.stderr'), self.assertRaises(SystemExit):
            parse_args([*base, '--profile', 'app', '--installer'])


if __name__ == '__main__':
    unittest.main()
