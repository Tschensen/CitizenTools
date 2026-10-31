import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import location_merge
from server import app as backend


class LocationMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.patches = [patch.object(backend, 'DATA_DIR', root), patch.object(backend, 'DB_PATH', root / 'test.sqlite3')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        backend.init_db()
        with backend.get_connection() as db:
            self.source = backend.insert_discovered_location(db, 'Merge Source', source='state')
            self.target = backend.insert_discovered_location(db, 'Merge Target', parent_location='Merge Source', source='state')
            backend.replace_location_aliases(db, self.source, ['Old spelling'])
            backend.replace_location_aliases(db, self.target, ['Destination alias'])
            self.state = {
                'currentLocation':'Merge Source', 'selectedStopDropoff':'Old spelling',
                'telemetryLinks':{'locations':{'Stanton2_Orison':'Merge Source'}, 'missions':{'game':'Merge Source'}},
                'runHomeDestinations':{'ship':'Merge Source'}, 'runPriorityRouteLocation':'Merge Source',
                'selectedRunRoutePointKey':'0|pickup|merge source|mission',
                'runCompletedRoutePoints':['0|pickup|merge source|mission', 'pickup:mission:segment'],
                'runRouteOrder':{'ship':['pickup:mission:segment']},
                'missions':[{'id':'mission', 'title':'Merge Source', 'notes':'Merge Source', 'status':'active',
                    'pickup':'Merge Source', 'dropoff':'Other Place',
                    'segments':[{'id':'segment','pickup':'Old spelling','dropoff':'Merge Source','quantity':9}],
                    'loads':[{'id':'load','pickup':'Merge Source','placement':{'row':1}}],
                    'serviceDetails':{'location':'Merge Source','searchArea':'Old spelling',
                        'packages':[{'pickup':'Merge Source','destination':'Old spelling','pickedUpAt':'yesterday'}],
                        'items':[{'destination':'Merge Source'}]}}],
                'stopHistory':[{'dropoff':'Merge Source','pickups':['Old spelling'],
                    'deliveryUndo':{'mission':{'pickup':'Merge Source'}}}],
                'ledgerEntries':[{'id':'income','amountAuec':123,'note':'Merge Source'}],
            }
            db.execute('INSERT INTO app_state(state_key,value,updated_at) VALUES (?,?,?)',
                       (backend.STATE_KEY, json.dumps(self.state), 'before'))
            draft = {'draft':{'pickup':'Merge Source','routes':[{'dropoff':'Old spelling'}]}, 'rawText':'Merge Source'}
            db.execute("INSERT INTO mission_imports(import_id,scope,source_device,source_label,status,image_hash,payload,created_at,updated_at) VALUES ('import','solo','test','Test','pending','hash',?,'before','before')", (json.dumps(draft),))
            db.commit()
            places = {item['id']:item for item in backend.load_location_records(db)}
            self.payload = {'sourceId':self.source, 'targetId':self.target, 'baseUpdatedAt':'before',
                            'sourceUpdatedAt':places[self.source]['updatedAt'], 'targetUpdatedAt':places[self.target]['updatedAt']}

    def merge(self, **overrides):
        with backend.get_connection() as db:
            db.execute('BEGIN IMMEDIATE')
            result = location_merge.merge(db, {**self.payload, **overrides})
            db.commit()
            return result

    def snapshot(self):
        with backend.get_connection() as db:
            return {table:[dict(row) for row in db.execute(f'SELECT * FROM {table}').fetchall()]
                    for table in ('locations','location_aliases','app_state','mission_imports','app_meta')}

    def test_merge_updates_references_and_keeps_cargo_progress_ids_and_text(self):
        before = copy.deepcopy(self.state)
        self.merge()
        with backend.get_connection() as db:
            places = {item['id']:item for item in backend.load_location_records(db)}
            self.assertEqual(places[self.source]['status'], 'archived')
            self.assertEqual(set(places[self.target]['aliases']), {'Merge Source','Old spelling','Destination alias'})
            self.assertEqual(places[self.target]['parentLocation'], '')
            self.assertEqual(location_merge.resolve_home_location(db, 'Merge Source'), 'Merge Target')
            self.assertEqual(backend.insert_discovered_location(db, 'Merge Source'), self.target)
            state = json.loads(db.execute('SELECT value FROM app_state WHERE state_key=?', (backend.STATE_KEY,)).fetchone()[0])
            self.assertEqual(state['currentLocation'], 'Merge Target')
            self.assertEqual(state['selectedStopDropoff'], 'Merge Target')
            self.assertEqual(state['telemetryLinks']['locations']['Stanton2_Orison'], 'Merge Target')
            self.assertEqual(state['telemetryLinks']['missions'], before['telemetryLinks']['missions'])
            self.assertEqual(state['runHomeDestinations']['ship'], 'Merge Target')
            self.assertEqual(state['selectedRunRoutePointKey'], '0|pickup|merge target|mission')
            self.assertEqual(state['runCompletedRoutePoints'], ['0|pickup|merge target|mission','pickup:mission:segment'])
            self.assertEqual(state['runRouteOrder'], before['runRouteOrder'])
            mission = state['missions'][0]
            for field in ('id','title','notes','status'):
                self.assertEqual(mission[field], before['missions'][0][field])
            self.assertEqual(mission['segments'][0], {'id':'segment','pickup':'Merge Target','dropoff':'Merge Target','quantity':9})
            self.assertEqual(mission['loads'][0]['placement'], {'row':1})
            self.assertEqual(mission['serviceDetails']['packages'][0], {'pickup':'Merge Target','destination':'Merge Target','pickedUpAt':'yesterday'})
            self.assertEqual(state['stopHistory'][0]['deliveryUndo']['mission']['pickup'], 'Merge Target')
            self.assertEqual(state['ledgerEntries'], before['ledgerEntries'])
            imported = json.loads(db.execute('SELECT payload FROM mission_imports').fetchone()[0])
            self.assertEqual(imported['draft'], {'pickup':'Merge Target','routes':[{'dropoff':'Merge Target'}]})
            self.assertEqual(imported['rawText'], 'Merge Source')

    def test_rejects_stale_state_or_location_and_self_merge_without_changes(self):
        for fields in ({'baseUpdatedAt':'old'}, {'sourceUpdatedAt':'old'}, {'targetUpdatedAt':'old'}, {'targetId':self.source}, {'targetId':'missing'}):
            with self.subTest(fields=fields):
                before = self.snapshot()
                with self.assertRaises(location_merge.MergeError):
                    self.merge(**fields)
                self.assertEqual(self.snapshot(), before)

    def test_archived_target_and_ambiguous_alias_are_rejected(self):
        with backend.get_connection() as db:
            db.execute("UPDATE locations SET status='archived' WHERE location_id=?", (self.target,))
            db.commit()
        with self.assertRaisesRegex(location_merge.MergeError, 'merge_target_archived'):
            self.merge()
        with backend.get_connection() as db:
            db.execute("UPDATE locations SET status='active' WHERE location_id=?", (self.target,))
            other = backend.insert_discovered_location(db, 'Third Location')
            backend.replace_location_aliases(db, other, ['Old spelling'])
            db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(location_merge.MergeError, 'merge_alias_conflict'):
            self.merge()
        self.assertEqual(self.snapshot(), before)

    def test_mid_merge_failure_rolls_back_archiving_aliases_and_state(self):
        with backend.get_connection() as db:
            db.execute("CREATE TRIGGER reject_state BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
            db.commit()
        before = self.snapshot()
        with self.assertRaises(backend.sqlite3.IntegrityError):
            self.merge()
        self.assertEqual(self.snapshot(), before)

    def test_merge_never_silently_truncates_aliases(self):
        with backend.get_connection() as db:
            backend.replace_location_aliases(db, self.target, [f'Target alias {number}' for number in range(50)])
            db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(location_merge.MergeError, 'merge_alias_limit'):
            self.merge()
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
