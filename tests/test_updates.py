import copy
from contextlib import closing
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solo_updates as updates
import update_helper as helper
from app import NativeUpdates
from update_contract import UPDATE_ASSETS, update_manifest


def fixture(version='0.4.0'):
    body = b'example verified package'
    checksum = hashlib.sha256(body).hexdigest()
    manifest = {'version': version, 'files': [{'name': name, 'bytes': len(body), 'sha256': checksum} for name in updates.ASSETS.values()],
                'releases': [{'version': version, 'de': {'title': 'Neu', 'changes': ['Funktion']}, 'en': {'title': 'New', 'changes': ['Feature']}}]}
    release = {'tag_name': 'v' + version, 'draft': False, 'prerelease': False, 'body': 'Release notes', 'assets': []}
    for name in ['release.json', *updates.ASSETS.values()]:
        release['assets'].append({'name': name, 'state': 'uploaded', 'size': len(body),
            'digest': 'sha256:' + checksum,
            'browser_download_url': f'https://github.com/{updates.REPOSITORY}/releases/download/v{version}/{name}'})
    client = Mock()
    client.json.side_effect = lambda url, **kwargs: copy.deepcopy(release if url == updates.LATEST_URL else manifest)
    return client, release, manifest, body


def program(path, version):
    path.mkdir(parents=True)
    (path / helper.EXE).write_text(version)
    (path / 'old-library.txt').write_text('managed')
    (path / helper.MANIFEST).write_text(json.dumps({'product': helper.PRODUCT, 'version': version, 'files': [helper.EXE, 'old-library.txt']}))


def portable(path, version='0.4.0', extra=None):
    contents = {helper.EXE: version, 'new-library.txt': 'new'}
    contents[helper.MANIFEST] = json.dumps({'product': helper.PRODUCT, 'version': version, 'files': list(contents)})
    contents.update(extra or {})
    with zipfile.ZipFile(path, 'w') as archive:
        for name, value in contents.items():
            archive.writestr('CitizenTools-Solo/' + name, value)


class ReleaseTests(unittest.TestCase):
    def add_update_packages(self, release, manifest):
        manifest['updates'] = update_manifest(['portable', 'installer'])
        for mode, name in UPDATE_ASSETS.items():
            file = next(item for item in manifest['files'] if item['name'] == updates.ASSETS[mode])
            manifest['files'].append({**file, 'name': name})
            asset = next(item for item in release['assets'] if item['name'] == updates.ASSETS[mode])
            release['assets'].append({**asset, 'name': name,
                'browser_download_url': asset['browser_download_url'].replace(updates.ASSETS[mode], name)})

    def test_compatible_lean_packages_preferred_for_both_editions(self):
        for mode, name in UPDATE_ASSETS.items():
            client, release, manifest, _ = fixture()
            self.add_update_packages(release, manifest)
            candidate, _ = updates.read_candidate(client, '0.3.0', mode)
            self.assertEqual(candidate['asset']['name'], name)
            self.assertEqual(candidate['notes'][0]['de']['title'], 'Neu')

    def test_unknown_format_platform_or_mode_falls_back_to_full_package(self):
        for change in ['format', 'platform', 'mode']:
            client, release, manifest, _ = fixture()
            self.add_update_packages(release, manifest)
            if change == 'format': manifest['updates']['format'] = 2
            elif change == 'platform': manifest['updates']['platform'] = 'windows-arm64'
            else: del manifest['updates']['assets']['portable']
            candidate, _ = updates.read_candidate(client, '0.3.0', 'portable')
            self.assertEqual(candidate['asset']['name'], updates.ASSETS['portable'])

    def test_advertised_update_must_be_complete_and_verified(self):
        for change in ['name', 'missing', 'digest', 'size']:
            client, release, manifest, _ = fixture()
            self.add_update_packages(release, manifest)
            file = next(item for item in manifest['files'] if item['name'] == UPDATE_ASSETS['portable'])
            if change == 'name': manifest['updates']['assets']['portable'] = 'arbitrary.exe'
            elif change == 'missing': release['assets'] = [item for item in release['assets'] if item['name'] != file['name']]
            elif change == 'digest': file['sha256'] = 'a' * 64
            else: file['bytes'] += 1
            with self.subTest(change=change), self.assertRaises(updates.UpdateError):
                updates.read_candidate(client, '0.3.0', 'portable')

    def test_numeric_versions_and_cumulative_bilingual_notes(self):
        client, _, manifest, _ = fixture('0.2.10')
        manifest['releases'] += [{'version': '0.2.9', 'de': {'title': 'Alt', 'changes': ['alt']}, 'en': {'title': 'Old', 'changes': ['old']}}]
        candidate, latest = updates.read_candidate(client, '0.2.8', 'portable')
        self.assertEqual(latest, '0.2.10')
        self.assertEqual([item['version'] for item in candidate['notes']], ['0.2.10', '0.2.9'])
        self.assertEqual(candidate['notes'][0]['en']['changes'], ['Feature'])

    def test_same_or_older_release_is_not_an_update(self):
        for current in ['0.4.0', '0.5.0']:
            client, _, _, _ = fixture()
            self.assertIsNone(updates.read_candidate(client, current, 'portable')[0])
            self.assertEqual(client.json.call_count, 1)

    def test_prerelease_draft_malformed_tag_and_foreign_asset_rejected(self):
        for change in ['draft', 'prerelease', 'tag', 'asset']:
            client, release, _, _ = fixture()
            if change in {'draft', 'prerelease'}: release[change] = True
            elif change == 'tag': release['tag_name'] = 'v0.4.0-rc1'
            else: release['assets'][0]['browser_download_url'] = 'https://example.com/release.json'
            with self.subTest(change=change), self.assertRaises(updates.UpdateError):
                updates.read_candidate(client, '0.3.0', 'portable')

    def test_manifest_mismatch_missing_file_digest_and_size_rejected(self):
        for change in ['version', 'missing', 'digest', 'size']:
            client, _, manifest, _ = fixture()
            if change == 'version': manifest['version'] = '0.3.9'
            elif change == 'missing': manifest['files'] = []
            elif change == 'digest': manifest['files'][0]['sha256'] = 'a' * 64
            else: manifest['files'][0]['bytes'] += 1
            with self.subTest(change=change), self.assertRaises(updates.UpdateError):
                updates.read_candidate(client, '0.3.0', 'portable')

    def test_installed_edition_selects_setup_and_legacy_notes_work(self):
        client, _, manifest, _ = fixture()
        manifest.pop('releases')
        candidate, _ = updates.read_candidate(client, '0.3.0', 'installer')
        self.assertEqual(candidate['asset']['name'], updates.ASSETS['installer'])
        self.assertEqual(candidate['body'], 'Release notes')

    def test_verified_download_and_no_partial_on_failure_or_cancel(self):
        body = b'example verified package'
        asset = {'url': 'unused', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
        for outcome in ['ok', 'truncated', 'checksum', 'cancel']:
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as root:
                client = updates.GitHubClient()
                client.open = lambda _: io.BytesIO(body[:-1] if outcome == 'truncated' else b'x' * len(body) if outcome == 'checksum' else body)
                destination = Path(root) / 'package.zip'
                cancelled = threading.Event()
                if outcome == 'cancel': cancelled.set()
                if outcome == 'ok':
                    client.download(asset, destination, lambda *args: None, cancelled)
                    self.assertEqual(destination.read_bytes(), body)
                else:
                    with self.assertRaises(updates.UpdateError):
                        client.download(asset, destination, lambda *args: None, cancelled)
                    self.assertFalse(destination.exists())
                self.assertFalse(destination.with_suffix('.zip.part').exists())

    def test_preferences_persist_and_failures_do_not_download(self):
        with tempfile.TemporaryDirectory() as root:
            manager = updates.UpdateManager('0.3.0', root, client=Mock())
            manager.set_automatic(False)
            self.assertFalse(updates.UpdateManager('0.3.0', root).automatic)
            for failure, code in [(URLError('offline'), 'update_network'), (HTTPError('url', 429, '', {}, None), 'update_rate_limit'), (HTTPError('url', 404, '', {}, None), 'update_no_release')]:
                manager.client.json.side_effect = failure
                manager.check(); manager.worker.join(5)
                self.assertEqual(manager.status()['error'], code)
                self.assertIsNone(manager.candidate)
            manager.client.download.assert_not_called()

    def test_automatic_check_runs_immediately_even_on_fresh_pc_boot(self):
        with tempfile.TemporaryDirectory() as root:
            manager = updates.UpdateManager('0.3.0', root)
            called = threading.Event()
            manager.check = lambda: called.set()
            with patch.object(updates.time, 'monotonic', return_value=20):
                manager.start_automatic()
                self.assertTrue(called.wait(2))
                manager.stop()

    def test_busy_download_cannot_reset_cancellation(self):
        with tempfile.TemporaryDirectory() as root:
            manager = updates.UpdateManager('0.3.0', root, mode='portable')
            manager.worker = Mock(is_alive=lambda: True)
            manager.cancel_event.set()
            with self.assertRaises(updates.UpdateError): manager.download('0.4.0')
            self.assertTrue(manager.cancel_event.is_set())

    def test_completed_download_cleanup_preserves_backups_and_incomplete_jobs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for complete, name in [(True, 'a' * 32), (False, 'b' * 32)]:
                folder = root / 'Updates' / name; folder.mkdir(parents=True)
                (folder / 'job.json').write_text(json.dumps({'dataRoot': str(root)}))
                (folder / 'result.json').write_text(json.dumps({'ok': complete}))
                (folder / updates.ASSETS['portable']).write_bytes(b'package')
                (folder / UPDATE_ASSETS['portable']).write_bytes(b'lean package')
                (folder / 'data-backup').mkdir(); (folder / 'data-backup/settings.json').write_text('personal')
            manager = updates.UpdateManager('0.4.0', root)
            self.assertFalse((root / 'Updates' / ('a' * 32) / updates.ASSETS['portable']).exists())
            self.assertFalse((root / 'Updates' / ('a' * 32) / UPDATE_ASSETS['portable']).exists())
            self.assertTrue((root / 'Updates' / ('b' * 32) / UPDATE_ASSETS['portable']).exists())
            self.assertTrue((root / 'Updates' / ('b' * 32) / updates.ASSETS['portable']).exists())
            self.assertEqual((root / 'Updates' / ('a' * 32) / 'data-backup/settings.json').read_text(), 'personal')
            (manager.root / 'preferences.json').write_text('[]')
            self.assertTrue(updates.UpdateManager('0.4.0', root).automatic)


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.program = self.root / 'program'
        program(self.program, '0.3.0')
        self.folder = self.root / ('a' * 32); self.folder.mkdir()
        self.package = self.folder / updates.ASSETS['portable']
        portable(self.package)
        self.job = {'currentVersion': '0.3.0', 'version': '0.4.0', 'kind': 'portable'}

    def tearDown(self): self.temp.cleanup()

    def test_lean_update_removes_managed_prerequisite_and_retains_rollback_copy(self):
        prerequisite = self.program / 'prerequisites/webview.exe'
        prerequisite.parent.mkdir(); prerequisite.write_text('large installer')
        path = self.program / helper.MANIFEST
        manifest = json.loads(path.read_text())
        manifest['files'].append('prerequisites/webview.exe')
        path.write_text(json.dumps(manifest))
        backup = helper.apply_update(self.job, self.program, self.package, self.folder)
        self.assertFalse((self.program / 'prerequisites').exists())
        self.assertEqual((backup / 'prerequisites/webview.exe').read_text(), 'large installer')

    def test_job_accepts_both_package_families_but_rejects_wrong_kind(self):
        data = self.root / 'user-data'
        folder = data / 'Updates' / ('b' * 32); folder.mkdir(parents=True)
        for assets in [updates.ASSETS, UPDATE_ASSETS]:
            for kind, name in assets.items():
                package = folder / name; package.write_bytes(b'package')
                job = {**self.job, 'format': 1, 'kind': kind, 'program': str(self.program),
                       'dataRoot': str(data), 'package': str(package), 'sha256': helper.digest(package),
                       'oldExeSha256': helper.digest(self.program / helper.EXE), 'restartArgs': ['--data-dir', str(data)]}
                path = folder / 'job.json'; path.write_text(json.dumps(job))
                self.assertEqual(helper.validate_job(path)[3], package)
                job['kind'] = 'installer' if kind == 'portable' else 'portable'
                path.write_text(json.dumps(job))
                with self.assertRaises(ValueError): helper.validate_job(path)

    def test_incompatible_platform_rejected_before_replacement(self):
        with zipfile.ZipFile(self.package, 'r') as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        path = 'CitizenTools-Solo/' + helper.MANIFEST
        manifest = json.loads(files[path]); manifest['platform'] = 'windows-arm64'
        files[path] = json.dumps(manifest).encode()
        with zipfile.ZipFile(self.package, 'w') as archive:
            for name, body in files.items(): archive.writestr(name, body)
        with self.assertRaises(ValueError):
            helper.apply_update(self.job, self.program, self.package, self.folder)
        self.assertEqual((self.program / helper.EXE).read_text(), '0.3.0')

    def test_portable_keeps_path_unknown_files_and_previous_version(self):
        (self.program / 'personal.txt').write_text('keep')
        backup = helper.apply_update(self.job, self.program, self.package, self.folder)
        self.assertEqual((self.program / helper.EXE).read_text(), '0.4.0')
        self.assertEqual((backup / helper.EXE).read_text(), '0.3.0')
        self.assertEqual((self.program / 'personal.txt').read_text(), 'keep')
        self.assertFalse((self.program / 'old-library.txt').exists())
        self.assertEqual(backup.parent, self.program / helper.UPDATE_WORK)
        self.assertFalse(list(self.root.glob('.program.*')))
        self.assertFalse(list(backup.parent.glob('update-*')))
        self.assertFalse((backup / helper.UPDATE_WORK).exists())

    def test_failed_rename_rolls_back_complete_old_program(self):
        original = Path.rename
        def rename(source, destination):
            if source.parent.name == 'new': raise PermissionError('locked')
            return original(source, destination)
        with patch.object(Path, 'rename', rename), self.assertRaises(PermissionError):
            helper.apply_update(self.job, self.program, self.package, self.folder)
        self.assertEqual((self.program / helper.EXE).read_text(), '0.3.0')
        self.assertTrue((self.program / 'old-library.txt').exists())

    def test_partial_backup_move_rolls_back(self):
        original = Path.rename
        calls = []
        def rename(source, destination):
            if Path(destination).parent.name.startswith('previous-'):
                calls.append(source)
                if len(calls) == 2:
                    raise PermissionError('locked old file')
            return original(source, destination)
        with patch.object(Path, 'rename', rename), self.assertRaises(PermissionError):
            helper.apply_update(self.job, self.program, self.package, self.folder)
        helper.validate_program(self.program, '0.3.0')
        self.assertTrue((self.program / 'old-library.txt').exists())

    def test_partial_install_rolls_back(self):
        original = Path.rename
        calls = []
        def rename(source, destination):
            if source.parent.name == 'new':
                calls.append(source)
                if len(calls) == 2:
                    raise PermissionError('locked new file')
            return original(source, destination)
        with patch.object(Path, 'rename', rename), self.assertRaises(PermissionError):
            helper.apply_update(self.job, self.program, self.package, self.folder)
        helper.validate_program(self.program, '0.3.0')
        self.assertEqual((self.program / helper.EXE).read_text(), '0.3.0')
        self.assertTrue((self.program / 'old-library.txt').exists())

    def test_legacy_backup_and_empty_stage_are_cleaned(self):
        old = self.root / ('.program.previous-' + 'c' * 32)
        program(old, '0.3.0')
        (old / 'update-backup.json').write_text(json.dumps({'program': str(self.program), 'version': '0.3.0'}))
        stage = self.root / ('.program.update-' + 'c' * 32); stage.mkdir()
        data = self.root / 'data'; (data / 'Updates').mkdir(parents=True)
        (data / 'Updates/last-result.json').write_text(json.dumps({'backup': str(old)}))
        helper.clean_previous_backup(data, self.program, self.program / helper.UPDATE_WORK / 'keep')
        self.assertFalse(old.exists())
        self.assertFalse(stage.exists())

    def test_second_update_does_not_copy_update_workspace(self):
        first = helper.apply_update(self.job, self.program, self.package, self.folder)
        data = self.root / 'data'; (data / 'Updates').mkdir(parents=True)
        (data / 'Updates/last-result.json').write_text(json.dumps({'backup': str(first)}))
        second_job = self.root / ('b' * 32); second_job.mkdir()
        second = helper.apply_update({**self.job, 'currentVersion': '0.4.0'}, self.program, self.package, second_job)
        self.assertFalse((second / helper.UPDATE_WORK).exists())
        helper.clean_previous_backup(data, self.program, second)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())

    def test_unowned_workspace_is_not_overwritten(self):
        workspace = self.program / helper.UPDATE_WORK; workspace.mkdir()
        (workspace / 'personal.txt').write_text('keep')
        with self.assertRaises(OSError):
            helper.apply_update(self.job, self.program, self.package, self.folder)
        self.assertEqual((workspace / 'personal.txt').read_text(), 'keep')
        helper.validate_program(self.program, '0.3.0')

    def test_installer_failure_restores_program_without_touching_user_data(self):
        data = self.root / 'personal-data'; data.mkdir()
        (data / 'settings.json').write_text('personal')
        self.job['kind'] = 'installer'
        def installer(command, **kwargs):
            self.assertIn('/NOCLOSEAPPLICATIONS', command)
            self.assertIn('/NORESTART', command)
            (self.program / helper.EXE).write_text('partially changed')
            return Mock(returncode=1)
        with self.assertRaises(RuntimeError):
            helper.apply_update(self.job, self.program, self.package, self.folder, run_installer=installer)
        self.assertEqual((self.program / helper.EXE).read_text(), '0.3.0')
        self.assertEqual((data / 'settings.json').read_text(), 'personal')

    def test_installer_success_validates_target_version(self):
        self.job['kind'] = 'installer'
        def installer(command, **kwargs):
            (self.program / helper.EXE).write_text('0.4.0')
            manifest = json.loads((self.program / helper.MANIFEST).read_text())
            manifest['version'] = '0.4.0'
            (self.program / helper.MANIFEST).write_text(json.dumps(manifest))
            return Mock(returncode=0)
        backup = helper.apply_update(self.job, self.program, self.package, self.folder, run_installer=installer)
        self.assertEqual((backup / helper.EXE).read_text(), '0.3.0')
        helper.validate_program(self.program, '0.4.0')

    def test_unsafe_archive_names_and_undeclared_files_rejected(self):
        for i, name in enumerate(['../escape', 'C:/escape', 'a\\b', 'CON.txt', 'a/./b', 'undeclared.txt', 'citizentools-solo.EXE']):
            portable(self.package, extra={name: 'unsafe'})
            with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                helper.extract_portable(self.package, self.root / f'extracted-{i}', '0.4.0')
        self.assertFalse((self.root / 'escape').exists())

    def test_zip_symlink_rejected(self):
        with zipfile.ZipFile(self.package, 'a') as archive:
            item = zipfile.ZipInfo('CitizenTools-Solo/link'); item.create_system = 3
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(item, '../outside')
        with self.assertRaises(ValueError): helper.extract_portable(self.package, self.root / 'extract', '0.4.0')

    def test_sqlite_backup_is_consistent_and_original_sounds_untouched(self):
        data = self.root / 'data-root'; (data / 'data').mkdir(parents=True)
        (data / 'Sounds').mkdir(); (data / 'Sounds/click.wav').write_bytes(b'personal')
        with closing(sqlite3.connect(data / 'data/cargo_planner.sqlite3')) as connection:
            connection.execute('create table example(value text)')
            connection.execute("insert into example values ('my contract')")
            connection.commit()
        helper.make_data_backup(data, self.folder / 'backup')
        with closing(sqlite3.connect(self.folder / 'backup/cargo_planner.sqlite3')) as connection:
            self.assertEqual(connection.execute('select value from example').fetchone()[0], 'my contract')
        self.assertEqual((data / 'Sounds/click.wav').read_bytes(), b'personal')


class NativeBridgeTests(unittest.TestCase):
    def test_only_reviewed_saved_native_window_can_install(self):
        runtime = Mock(); runtime.desktop_url = 'http://127.0.0.1:4174/?desktop=1&v=0.3.0'
        runtime.window.get_current_url.return_value = runtime.desktop_url
        runtime.window.evaluate_js.return_value = False
        api = NativeUpdates(runtime, [], Mock())
        self.assertEqual(api.install_update('0.4.0')['error'], 'update_unsaved')
        runtime.updates.launch_installer.assert_not_called()
        runtime.window.evaluate_js.return_value = True
        runtime.window.get_current_url.return_value = 'https://example.com'
        self.assertEqual(api.install_update('0.4.0')['error'], 'update_native_only')
        runtime.updates.launch_installer.assert_not_called()
        runtime.window.get_current_url.return_value = runtime.desktop_url
        with patch('app.threading.Timer'):
            self.assertTrue(api.install_update('0.4.0')['ok'])
        runtime.updates.launch_installer.assert_called_once_with('0.4.0', [])


if __name__ == '__main__': unittest.main()
