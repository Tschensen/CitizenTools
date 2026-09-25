"""Real HTTP round trips against isolated Python + PHP/SQLite installations."""
import base64
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib import request, error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from runtime import SoloRuntime
from server import app as backend
import transfer

PHP = os.environ.get('CITIZEN_TEST_PHP') or shutil.which('php') or ''
ONLINE_SOURCE = Path(os.environ.get('CITIZEN_TEST_ONLINE_SOURCE', ROOT.parent / 'dev/php'))
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
MID = '54c86cfa-aa2a-4209-9a4a-7dcba37c3180'


def fixture():
    return {'format': transfer.FORMAT, 'version': 1, 'state': {
        'shipLibrary': [{'id': 'ship-test', 'manufacturer': 'Drake', 'model': 'Caterpillar', 'imageUrl': '/source/image.png'}],
        'fleet': [{'id': 'fleet-test', 'shipId': 'ship-test', 'manufacturer': 'Drake', 'model': 'Caterpillar', 'acquiredOn': '2026-09-23', 'status': 'active'}],
        'missions': [{'id': MID, 'title': 'Testfahrt', 'type': 'cargo', 'payout': 25000, 'status': 'active', 'assignedFleetEntryId': 'fleet-test', 'loads': [{'id': 'load-1', 'placement': {'fleetEntryId': 'fleet-test', 'row': 0, 'col': 0, 'z': 0}}], 'organizationLink': {'secret': 'omit'}, '_onlineMeta': {'secret': 'omit'}}],
        'ledgerEntries': [{'id': 'ledger-test', 'bookedOn': '2026-09-23', 'category': 'other', 'flow': 'income', 'amountAuec': 25000, 'missionId': MID, 'fleetEntryId': 'fleet-test'}],
        'contacts': [{'id': 'ba65a1de-3bfb-4b16-9e77-1e3b2870f151', 'name': 'Testkontakt', 'contactType': 'client', 'status': 'active', 'notes': 'Persönliche Notiz'}],
        'activeFleetEntryId': 'fleet-test', 'stopHistory': [{'id': 'stop-1', 'missionIds': [MID]}],
        'organization': {'secret': 'omit'}, 'pilotGroups': [{'secret': 'omit'}], 'apiToken': 'omit',
    }, 'images': {'/source/image.png': base64.b64encode(PNG).decode()}}


class TransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not Path(PHP).is_file():
            raise unittest.SkipTest('Set CITIZEN_TEST_PHP to a PHP executable with PDO SQLite')
        if not (ONLINE_SOURCE / 'src').is_dir() or not (ONLINE_SOURCE / 'public/index.php').is_file():
            raise unittest.SkipTest('Set CITIZEN_TEST_ONLINE_SOURCE to the separate PHP online-suite source')
        cls.temp = tempfile.TemporaryDirectory(prefix='citizen-transfer-test-')
        cls.root = Path(cls.temp.name)
        site = cls.root / 'online'
        (site / 'public').mkdir(parents=True)
        source = ONLINE_SOURCE
        shutil.copytree(source / 'src', site / 'src')
        shutil.copy2(source / 'public/index.php', site / 'public/index.php')
        shutil.copy2(source / 'public/operations.php', site / 'public/operations.php')
        (site / 'config.php').write_text("<?php return ['db'=>['dsn'=>'sqlite:'.__DIR__.'/test.sqlite'], 'mode'=>'normal', 'mode_override'=>'normal', 'admin_emails'=>[]];", encoding='utf-8')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        cls.online = f'http://127.0.0.1:{port}/index.php?route='
        cls.log = (cls.root / 'php.log').open('wb')
        cls.php = subprocess.Popen([PHP, '-S', f'127.0.0.1:{port}', '-t', str(site / 'public')], stdout=cls.log, stderr=cls.log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        for _ in range(60):
            try:
                request.urlopen(cls.online + '/api/health', timeout=1).close()
                break
            except OSError:
                time.sleep(.1)
        cls.runtime = SoloRuntime(cls.root / 'offline', port=0, lan=False)
        cls.runtime.start(capture_enabled=False)

    @classmethod
    def tearDownClass(cls):
        cls.runtime.stop()
        cls.php.terminate()
        cls.php.wait(timeout=10)
        cls.log.close()
        cls.temp.cleanup()

    def setUp(self):
        self.client = request.build_opener(request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        code, self.account = self.api(True, '/api/auth/register', {'email': f'test-{time.time_ns()}@example.test', 'displayName': 'Transfer Test', 'password': 'Only-test-2026'})
        self.assertEqual(code, 201, self.account)
        with backend.get_connection() as db:
            db.execute('DELETE FROM app_state')
            db.commit()

    def api(self, online, path='/api/transfer/personal', payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        url = self.online + path if online else self.runtime.url + path
        req = request.Request(url, data=body, headers={'Content-Type': 'application/json'} if body else {})
        try:
            response = self.client.open(req, timeout=15)
        except error.HTTPError as failure:
            response = failure
        with response:
            data = response.read()
            try: result = json.loads(data)
            except ValueError: self.fail(data.decode(errors='replace') + '\n' + (self.root / 'php.log').read_text(errors='replace')[-3000:])
            return response.status, result

    def import_file(self, online, document, mode='merge'):
        code, preview = self.api(online, '/api/transfer/personal/preview', {'document': document, 'mode': mode})
        self.assertEqual(code, 200, preview)
        code, result = self.api(online, '/api/transfer/personal/import', {'document': document, 'mode': mode, 'baseRevision': preview['revision']})
        self.assertEqual(code, 200, result)
        return self.api(online)[1]

    def test_bidirectional_roundtrip_images_references_and_repeat_import(self):
        self.assertFalse(self.account['permissions']['serverAdministration'])
        online = self.import_file(True, fixture())
        offline = self.import_file(False, online)
        self.assertEqual(offline['state']['missions'][0]['loads'][0]['placement']['fleetEntryId'], 'fleet-test')
        self.assertEqual(offline['state']['ledgerEntries'][0]['missionId'], MID)
        self.assertEqual(offline['state']['contacts'][0]['notes'], 'Persönliche Notiz')
        self.assertEqual(len(offline['images']), 1)
        self.assertEqual(base64.b64decode(next(iter(offline['images'].values()))), PNG)
        self.assertNotIn('omit', json.dumps(offline))
        offline['state']['missions'][0]['payout'] = 35000
        for _ in range(2):
            returned = self.import_file(True, offline)
            self.assertEqual(len(returned['state']['missions']), 1)
            self.assertEqual(returned['state']['missions'][0]['payout'], 35000)
            self.assertEqual(returned['state']['ledgerEntries'][0]['missionId'], MID)
            self.assertEqual(len(returned['images']), 1)

    def test_incomplete_transfer_upload_keeps_online_suite_available(self):
        module = self.root / 'online/src/PersonalTransfer.php'
        unavailable = module.with_suffix('.unavailable')
        module.rename(unavailable)
        try:
            self.assertEqual(self.api(True, '/api/health')[0], 200)
            with self.client.open(self.online.split('?')[0], timeout=15) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b'Citizen Tools', response.read())
            code, result = self.api(True)
            self.assertEqual((code, result['error']), (503, 'personal_transfer_unavailable'))
            self.assertIn('src/PersonalTransfer.php', result['detail'])
        finally:
            unavailable.rename(module)
        self.assertEqual(self.api(True)[0], 200)

    def test_merge_replace_and_recovery(self):
        for online in (True, False):
            if online:
                self.api(True, '/api/operations/personal-state', {'state': {'uiLanguage': 'en', 'backupReminderDays': 14}})
            before = self.import_file(online, fixture())
            second = fixture()
            second['state']['missions'][0]['id'] = '61c86cfa-aa2a-4209-9a4a-7dcba37c3180'
            merged = self.import_file(online, second)
            self.assertEqual(len(merged['state']['missions']), 2)
            empty = {'format': transfer.FORMAT, 'version': 1, 'state': {key: [] for key in transfer.COLLECTIONS}}
            replaced = self.import_file(online, empty, 'replace')
            self.assertEqual(replaced['state']['missions'], [])
            code, recovery = self.api(online, '/api/transfer/personal/recovery')
            self.assertEqual(code, 200, recovery)
            self.assertEqual(len(recovery['state']['missions']), 2)
            self.assertEqual(len(self.import_file(online, recovery, 'replace')['state']['missions']), 2)
            if online:
                preferences = self.api(True, '/api/operations/personal-state')[1]['state']
                self.assertEqual(preferences['uiLanguage'], 'en')
                self.assertEqual(preferences['backupReminderDays'], 14)

    def test_tablet_fallback_ids_return_to_original_offline_records(self):
        document = fixture()
        document['state']['missions'][0]['id'] = 'id-tablet-123'
        document['state']['ledgerEntries'][0]['missionId'] = 'id-tablet-123'
        document['state']['stopHistory'][0]['missionIds'] = ['id-tablet-123']
        document['state']['contacts'][0]['id'] = 'id-contact-123'
        # Seed through the regular state API, as a non-secure LAN browser does.
        self.assertEqual(self.api(False, '/api/state', {'state': document['state'], 'baseUpdatedAt': None})[0], 200)
        exported = self.api(False)[1]
        self.assertNotEqual(exported['state']['missions'][0]['id'], 'id-tablet-123')
        returned = self.import_file(True, exported)
        returned['state']['missions'][0]['notes'] = 'Edited online'
        for _ in range(2):
            result = self.import_file(False, returned)
            self.assertEqual(len(result['state']['missions']), 1)
            self.assertEqual(len(result['state']['contacts']), 1)
            mission_id = result['state']['missions'][0]['id']
            self.assertEqual(result['state']['ledgerEntries'][0]['missionId'], mission_id)
            self.assertEqual(result['state']['stopHistory'][0]['missionIds'], [mission_id])
            self.assertEqual(result['state']['missions'][0]['notes'], 'Edited online')

    def test_invalid_file_stale_preview_and_bad_images_do_not_write(self):
        for online in (True, False):
            self.import_file(online, fixture())
            code, preview = self.api(online, '/api/transfer/personal/preview', {'document': fixture()})
            changed = fixture()
            changed['state']['missions'][0]['title'] = 'Neuer Stand'
            self.import_file(online, changed)
            code, result = self.api(online, '/api/transfer/personal/import', {'document': fixture(), 'baseRevision': preview['revision']})
            self.assertEqual((code, result.get('error')), (409, 'transfer_conflict'))
            before = self.api(online)[1]['state']
            for bad in ({}, {'format': transfer.FORMAT, 'version': 999, 'state': before}, {**fixture(), 'images': {'x': 'not-an-image'}}, {**fixture(), 'state': {**before, 'missions': [before['missions'][0], before['missions'][0]]}}):
                self.assertEqual(self.api(online, '/api/transfer/personal/preview', {'document': bad})[0], 400)
                self.assertEqual(self.api(online)[1]['state'], before)

    def test_personal_scope_and_legacy_ids(self):
        document = fixture()
        document['state']['missions'][0]['id'] = 'legacy-mission'
        document['state']['ledgerEntries'][0]['missionId'] = 'legacy-mission'
        document['state']['stopHistory'][0]['missionIds'] = ['legacy-mission']
        document['state']['contacts'][0]['id'] = 'legacy-contact'
        for _ in range(2):
            result = self.import_file(True, document)
            self.assertEqual(len(result['state']['missions']), 1)
            self.assertEqual(len(result['state']['contacts']), 1)
            mission_id = result['state']['missions'][0]['id']
            self.assertEqual(result['state']['ledgerEntries'][0]['missionId'], mission_id)
        self.assertEqual(self.api(True, '/api/transfer/personal&workspaceId=foreign')[0], 400)
        self.assertEqual(self.api(True, '/api/transfer/personal&groupId=foreign')[0], 400)
        other_client = request.build_opener(request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.client = other_client
        self.assertEqual(self.api(True)[0], 401)
        self.api(True, '/api/auth/register', {'email': f'other-{time.time_ns()}@example.test', 'displayName': 'Other', 'password': 'Only-test-2026'})
        self.assertEqual(self.api(True)[1]['state']['missions'], [])
        self.assertEqual(self.api(True, '/api/transfer/personal/recovery')[0], 404)
        # Same file in a different account cannot take ownership of the source mission.
        self.assertEqual(len(self.import_file(True, result)['state']['missions']), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
