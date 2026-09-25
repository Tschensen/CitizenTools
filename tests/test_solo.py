import concurrent.futures
import io
import json
import socket
import sqlite3
import sys
import tempfile
import threading
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import SoloRuntime, VERSION
import solo_about
from server import app as backend


class SoloIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = SoloRuntime(self.root, port=0, lan=False)
        self.runtime.start(capture_enabled=False)

    def tearDown(self):
        self.runtime.stop()
        self.temp.cleanup()

    def api(self, path, payload=None, *, method=None, headers=None, raw=False):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode() if payload is not None else None
        hdr = {"Content-Type": "application/json"} if body else {}
        hdr.update(headers or {})
        req = request.Request(self.runtime.url + path, data=body, method=method, headers=hdr)
        try: response = request.urlopen(req, timeout=5)
        except error.HTTPError as exception: response = exception
        with response:
            data = response.read()
            return response.status, data if raw else json.loads(data)

    def test_empty_database_has_no_accounts_or_organization(self):
        code, result = self.api('/api/state')
        self.assertEqual((code, result['state']), (200, None))
        with backend.get_connection() as connection:
            tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        self.assertFalse(any('identity' in name or 'auth' in name or 'user' in name for name in tables))
        for path in ['/api/organization/missions', '/api/auth/dispatcher/status', '/scripts/organization.js', '/scripts/pilot-groups.js', '/data/cargo_planner.sqlite3', '/../runtime.py']:
            self.assertEqual(self.api(path, raw=True)[0], 404, path)
        self.assertEqual(self.api('/api/state?scope=dispatcher')[0], 400)

    def test_interface_ignores_old_cache_validators_and_native_url_changes_with_version(self):
        self.assertEqual(self.runtime.desktop_url, self.runtime.url + '/?desktop=1&v=' + VERSION)
        for route in ['/?desktop=1', '/index.html', '/solo.css', '/scripts/solo-connection.js']:
            req = request.Request(self.runtime.url + route, headers={'If-Modified-Since': 'Thu, 31 Dec 2099 23:59:59 GMT', 'If-None-Match': 'old-interface'})
            with request.urlopen(req, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_all('Cache-Control'), ['no-store'])
                body = response.read()
                if route in ['/?desktop=1', '/index.html']:
                    self.assertIn(b'flightLocalClock', body)
                    self.assertIn(b'Schiffszeit / UTC', body)
                    self.assertIn(b'Ortszeit', body)

    def test_heartbeat_returns_current_server_utc_without_cache(self):
        before = datetime.now(timezone.utc)
        with request.urlopen(self.runtime.url + '/api/solo/heartbeat', timeout=5) as response:
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            result = json.load(response)
        self.assertTrue(result['ok'])
        self.assertEqual(result['edition'], 'solo')
        measured = datetime.fromisoformat(result['serverTime'])
        self.assertGreaterEqual(measured, before)
        self.assertLessEqual(measured, datetime.now(timezone.utc))
        self.assertEqual(self.api('/api/state')[1]['state'], None)

    def test_about_documents_and_full_release_history_are_local(self):
        code, result = self.api('/api/solo/about')
        self.assertEqual(code, 200)
        self.assertEqual(result['version'], VERSION)
        versions = [item['version'] for item in result['releases']]
        self.assertEqual(versions, [f'0.1.{number}' for number in range(int(VERSION.rsplit('.', 1)[1]), -1, -1)])
        for item in result['releases']:
            for language in ['de', 'en']:
                self.assertTrue(item[language]['title'])
                self.assertTrue(item[language]['changes'])
        documents = {item['file']: item for item in result['documents']}
        self.assertEqual(documents['CITIZEN-TOOLS-GPL.txt']['text'], (Path(__file__).resolve().parents[1]/'LICENSE').read_text(encoding='utf-8'))
        self.assertEqual(result['project']['license'], 'GPL-3.0-or-later')
        self.assertEqual(result['project']['author'], 'Tschensen')
        self.assertEqual(documents['CITIZEN-TOOLS-GPL.txt']['license'], result['project']['license'])
        self.assertFalse(any('MIT' in name for name in documents if name.startswith('CITIZEN-TOOLS-')))
        self.assertIn('MICROSOFT SOFTWARE LICENSE TERMS', documents['WEBVIEW2-RUNTIME.txt']['text'])
        self.assertIn('Armin Ronacher', documents['proxy_tools-LICENSE.txt']['text'])
        self.assertNotIn('EULA-de.txt', documents)
        self.assertTrue(all(item['text'].strip() for item in documents.values()))
        self.assertEqual(self.api('/api/state')[1]['state'], None)

    def test_license_zip_and_release_downloads_match_displayed_documents(self):
        code, body = self.api('/api/solo/licenses.zip', raw=True)
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertEqual(len(archive.namelist()), len(solo_about.documents()))
            for item in solo_about.documents():
                self.assertEqual(archive.read(item['file']).decode('utf-8'), item['text'])
        for language in ['de', 'en']:
            code, body = self.api('/api/solo/release-notes.txt?language='+language, raw=True)
            self.assertEqual(code, 200)
            self.assertEqual(body.decode('utf-8'), solo_about.release_markdown(language))
        self.assertEqual(self.api('/api/solo/source.zip')[0], 404)
        self.assertEqual(self.api('/api/solo/licenses/../../settings.json', raw=True)[0], 404)

    def test_concurrent_cold_start_assets_all_load(self):
        # WebView loads scripts and styles concurrently, alongside Companion
        # status requests and other devices. A small socket backlog loses files.
        paths = ['/scripts/mission-import-ui.js', '/scripts/autoload.js',
                 '/scripts/unload-guidance.js', '/app.js', '/styles.css',
                 '/scripts/solo-sync.js', '/api/solo/status', '/scripts/config.js'] * 3
        barrier = threading.Barrier(len(paths))
        def fetch(path):
            barrier.wait(timeout=5)
            return self.api(path, raw=True)[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(paths)) as pool:
            self.assertEqual(list(pool.map(fetch, paths)), [200] * len(paths))

    def test_save_restart_and_conflict_preserve_newer_state(self):
        body = {'missions': [], 'organization': {'name': 'excluded'}, 'pilotGroups': ['excluded'], 'marker': 'PC'}
        code, first = self.api('/api/state', {'state': body, 'baseUpdatedAt': None})
        self.assertEqual(code, 200)
        code, conflict = self.api('/api/state', {'state': {'marker': 'tablet'}, 'baseUpdatedAt': None})
        self.assertEqual(code, 409)
        self.assertEqual(conflict['state']['marker'], 'PC')
        self.assertNotIn('organization', conflict['state'])
        self.assertNotIn('pilotGroups', conflict['state'])
        self.assertEqual(self.api('/api/state', {'state': {}})[0], 428)
        self.runtime.stop()
        self.runtime = SoloRuntime(self.root, port=0, lan=False)
        self.runtime.start(capture_enabled=False)
        self.assertEqual(self.api('/api/state')[1]['updatedAt'], first['updatedAt'])

    def test_simultaneous_clients_cannot_overwrite_each_other(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda marker: self.api('/api/state', {'state': {'marker': marker}, 'baseUpdatedAt': None})[0], ['PC', 'tablet']))
        self.assertEqual(sorted(replies), [200, 409])

    def test_import_commit_is_atomic_across_clients_and_cannot_resurrect_deleted_mission(self):
        with backend.get_connection() as connection:
            connection.execute("INSERT INTO mission_imports VALUES (?, 'solo', 'pc', 'PC', ?, '{}', 'pending', ?, ?)", ('ocr-test', 'hash-test', 'now', 'now'))
            connection.commit()
        barrier = threading.Barrier(2)
        def commit(device):
            barrier.wait(timeout=5)
            return self.api('/api/state', {'state': {'missions': [{'id': device, 'sourceImportId': 'ocr-test'}]},
                                         'baseUpdatedAt': None, 'importIds': ['ocr-test']})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(commit, ['PC', 'tablet']))
        self.assertEqual(sorted(code for code, _ in replies), [200, 409])
        current = self.api('/api/state')[1]
        self.assertEqual(len(current['state']['missions']), 1)
        with backend.get_connection() as connection:
            self.assertEqual(connection.execute("SELECT status FROM mission_imports WHERE import_id = 'ocr-test'").fetchone()[0], 'imported')
        self.assertEqual(self.api('/api/imports?scope=solo&status=pending')[1]['imports'], [])
        code, deleted = self.api('/api/state', {'state': {'missions': []}, 'baseUpdatedAt': current['updatedAt']})
        self.assertEqual(code, 200)
        code, rejected = self.api('/api/state', {'state': current['state'], 'baseUpdatedAt': deleted['updatedAt'], 'importIds': ['ocr-test']})
        self.assertEqual(code, 409)
        self.assertEqual(rejected['state']['missions'], [])
        self.assertEqual(self.api('/api/state')[1]['state']['missions'], [])

    def test_unchanged_state_keeps_revision_and_invalid_import_batch_is_not_saved(self):
        data = {'missions': []}
        _, first = self.api('/api/state', {'state': data, 'baseUpdatedAt': None})
        code, second = self.api('/api/state', {'state': data, 'baseUpdatedAt': first['updatedAt']})
        self.assertEqual((code, second['updatedAt']), (200, first['updatedAt']))
        for imports in ['bad', [None], ['missing']]:
            code, _ = self.api('/api/state', {'state': {'missions': [{'id': 'bad'}]}, 'baseUpdatedAt': first['updatedAt'], 'importIds': imports})
            self.assertIn(code, [400, 409])
        self.assertEqual(self.api('/api/state')[1]['state'], data)

    def test_foreign_sites_and_bad_payloads_are_rejected(self):
        self.assertEqual(self.api('/api/state', headers={'Host': 'evil.example:4174'})[0], 403)
        self.assertEqual(self.api('/api/state', {'state': {}, 'baseUpdatedAt': None}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.api('/api/state', {'state': []})[0], 400)
        self.assertEqual(self.api('/api/state', b'\xff')[0], 400)
        self.assertEqual(self.api('/api/state', b'{}', headers={'Content-Type':'text/plain'})[0], 415)

    def test_settings_validation_and_separate_data(self):
        self.assertEqual(self.api('/api/solo/settings', {'captureHotkey': 'not-a-real-key'})[0], 400)
        self.assertEqual(self.api('/api/solo/settings', {'captureRetention': 0})[0], 400)
        code, result = self.api('/api/solo/settings', {'captureEnabled': False, 'captureHotkey': 'Ctrl+Shift+F11', 'pilotName':'Solo Test'})
        self.assertEqual(code, 200)
        self.assertFalse(result['captureRunning'])
        settings = json.loads((self.root / 'settings.json').read_text(encoding='utf-8'))
        self.assertEqual(settings['pilotName'], 'Solo Test')
        self.assertTrue((self.root / 'data/cargo_planner.sqlite3').is_file())

    def test_hotkey_recording_does_not_change_capture_settings(self):
        before = dict(self.runtime.settings)
        self.assertEqual(self.api('/api/solo/hotkey-recording', {'session': 'test-session', 'enabled': True})[0], 200)
        self.assertTrue(self.runtime.hotkey_recording_gate.active())
        self.assertEqual(self.runtime.settings, before)
        self.assertFalse(self.runtime.config_path.exists())
        for payload in ([], {}, {'session': 'test-session', 'enabled': 'yes'}, {'session': '../../x', 'enabled': True}):
            self.assertEqual(self.api('/api/solo/hotkey-recording', payload)[0], 400)
        self.assertEqual(self.api('/api/solo/hotkey-recording', {'session': 'test-session', 'enabled': False})[0], 200)
        self.assertFalse(self.runtime.hotkey_recording_gate.active())

    def test_port_change_applies_on_restart_and_preserves_state(self):
        self.api('/api/state', {'state': {'missions': [], 'marker':'same captain'}, 'baseUpdatedAt': None})
        old_url = self.runtime.url
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            new_port = probe.getsockname()[1]
        code, result = self.api('/api/solo/settings', {'port': new_port, 'captureEnabled': False})
        self.assertEqual(code, 200)
        self.assertTrue(result['restartRequired'])
        self.assertEqual(result['url'], old_url)
        self.assertEqual(result['settings']['port'], new_port)
        self.runtime.stop()
        self.runtime = SoloRuntime(self.root)
        self.runtime.start(capture_enabled=False)
        self.assertTrue(self.runtime.url.endswith(f':{new_port}'))
        self.assertFalse(self.runtime.status()['restartRequired'])
        self.assertEqual(self.api('/api/state')[1]['state']['marker'], 'same captain')

    def test_invalid_or_busy_port_does_not_change_settings(self):
        for port in [0, 1023, 65536, 4174.5, True, '4174']:
            self.assertEqual(self.api('/api/solo/settings', {'port': port})[0], 400, port)
        previous = dict(self.runtime.settings)
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            code, result = self.api('/api/solo/settings', {'port': occupied.getsockname()[1]})
        self.assertEqual(code, 400)
        self.assertIn('belegt', result['error'])
        self.assertEqual(self.runtime.settings, previous)
        self.assertFalse(self.runtime.config_path.exists())

    def test_backup_restore_keeps_pre_restore_copy(self):
        self.api('/api/state', {'state': {'missions': [], 'marker':'saved'}, 'baseUpdatedAt': None})
        code, backup = self.api('/api/backup', raw=True)
        self.assertEqual(code, 200)
        current = self.api('/api/state')[1]
        self.api('/api/state', {'state': {'marker':'changed'}, 'baseUpdatedAt': current['updatedAt']})
        code, result = self.api('/api/restore/preview', backup, headers={'Content-Type':'application/octet-stream'})
        self.assertEqual(code, 200, result)
        code, result = self.api('/api/restore', backup, headers={'Content-Type':'application/octet-stream'})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.api('/api/state')[1]['state']['marker'], 'saved')
        self.assertTrue(list((self.root/'data').glob('*pre-restore*')))

    def test_locations_and_capture_progress(self):
        code, result = self.api('/api/locations')
        self.assertEqual(code, 200)
        self.assertTrue(result['locations'])
        code, result = self.api('/api/imports/progress', {'jobId':'solo-job', 'scope':'solo', 'sourceDevice':'test-pc', 'status':'queued'})
        self.assertEqual(code, 200, result)
        code, result = self.api('/api/imports/progress')
        self.assertEqual(code, 200)
        self.assertEqual(result['jobs'][0]['id'], 'solo-job')

    def test_custom_sounds_are_served_and_survive_restart(self):
        import wave
        folder = self.runtime.sound_dir
        self.assertTrue((folder/'README.txt').is_file())
        for name in ['navigation', 'import-read', 'import-processing', 'import-success', 'import-failure']:
            code, body = self.api(f'/api/solo/sounds/{name}.wav', raw=True)
            self.assertEqual(code, 200)
            with wave.open(io.BytesIO(body)) as sound:
                self.assertGreater(sound.getnframes(), 0)
                self.assertLess(sound.getnframes()/sound.getframerate(), 3)
        custom = (folder/'import-success.wav').read_bytes()
        (folder/'navigation.wav').write_bytes(custom)
        self.runtime.stop()
        self.runtime = SoloRuntime(self.root, port=0, lan=False)
        self.runtime.start(capture_enabled=False)
        self.assertEqual(self.api('/api/solo/sounds/navigation.wav', raw=True), (200, custom))
        self.assertEqual(self.api('/api/solo/sounds')[1]['directory'], str(folder))
        for path in ['/api/solo/sounds/settings.json', '/api/solo/sounds/../settings.json', '/api/solo/sounds/%2e%2e/settings.json']:
            self.assertEqual(self.api(path, raw=True)[0], 404)
        (folder/'navigation.wav').write_bytes(b'x' * (2 * 1024 * 1024 + 1))
        self.assertEqual(self.api('/api/solo/sounds/navigation.wav', raw=True)[0], 413)

    def test_upload_sound_validation_and_immutable_defaults(self):
        import base64
        import wave
        original = self.api('/assets/sounds/navigation.wav', raw=True)[1]
        custom = self.api('/assets/sounds/import-success.wav', raw=True)[1]
        payload = {'filename': 'My signal.wav', 'data': base64.b64encode(custom).decode()}
        code, result = self.api('/api/solo/sounds/navigation', payload)
        self.assertEqual(code, 200)
        self.assertTrue(result['sound']['available'])
        self.assertEqual(result['sound']['filename'], 'My signal.wav')
        self.assertEqual(self.api('/api/solo/sounds/navigation.wav', raw=True)[1], custom)
        self.assertEqual(self.api('/assets/sounds/navigation.wav', raw=True)[1], original)
        for invalid in [{'filename':'bad.mp3', 'data':payload['data']}, {'filename':'fake.wav', 'data':base64.b64encode(b'not WAV').decode()}, {'filename':'bad.wav', 'data':'broken'}]:
            self.assertEqual(self.api('/api/solo/sounds/navigation', invalid)[0], 400)
            self.assertEqual(self.api('/api/solo/sounds/navigation.wav', raw=True)[1], custom)
        long = io.BytesIO()
        with wave.open(long, 'wb') as sound:
            sound.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            sound.writeframes(b'\0\0' * 32000)
        code, result = self.api('/api/solo/sounds/navigation', {'filename':'long.wav', 'data':base64.b64encode(long.getvalue()).decode()})
        self.assertEqual((code, result['error']), (400, 'sound_too_long'))
        self.assertEqual(self.api('/api/solo/sounds/not-a-sound', payload)[0], 404)
        self.runtime.stop()
        self.runtime = SoloRuntime(self.root, port=0, lan=False)
        self.runtime.start(capture_enabled=False)
        self.assertEqual(self.api('/api/solo/sounds/navigation.wav', raw=True)[1], custom)
        self.assertEqual(self.api('/api/solo/sounds')[1]['sounds']['navigation']['filename'], 'My signal.wav')

    def test_companion_import_duplicate_and_acknowledgement(self):
        body = {'scope':'solo', 'deviceId':'test-pc', 'imageHash':'a'*64, 'pilotName':'Solo', 'draft':{'type':'cargo','title':'Testauftrag','pickup':'Lorville','routes':[{'dropoff':'Orison','targetScu':8}]}}
        code, created = self.api('/api/imports', body)
        self.assertEqual(code, 201, created)
        code, duplicate = self.api('/api/imports', body)
        self.assertEqual(code, 200, duplicate)
        self.assertEqual(created['id'], duplicate['id'])
        code, inbox = self.api('/api/imports?scope=solo&status=pending')
        self.assertEqual(code, 200)
        self.assertEqual(len(inbox['imports']), 1)
        self.assertEqual(self.api('/api/imports/' + created['id'] + '/status?scope=solo', {'status':'imported'})[0], 200)
        self.assertEqual(len(self.api('/api/imports?scope=solo&status=pending')[1]['imports']), 0)
        body['scope'] = 'dispatcher'
        self.assertEqual(self.api('/api/imports', body)[0], 400)


if __name__ == '__main__': unittest.main()
