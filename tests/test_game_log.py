import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import contextmanager
import sqlite3

from shared.game_log import GameLogParser
from companion.telemetry import Telemetry, init_store, validate_settings, configured_log
from shared.mission_import.balance import parse_amount, read_balance

MISSION = '11111111-2222-3333-4444-555555555555'


def line(text, at=None):
    return '<' + (at or datetime.now(timezone.utc).isoformat()) + '> [Notice] ' + text + '\n'


class ParserTests(unittest.TestCase):
    def test_localized_ship_notifications_ignore_render_repeats_and_other_channels(self):
        p = GameLogParser()
        events = p.feed(line('<SHUDEvent_OnNotification> Added notification "Du bist Kanal [ RSI Hermes : Pilot ] beigetreten'))
        self.assertEqual(events[0]['name'], 'RSI Hermes')
        self.assertEqual(p.feed(line('<UpdateNotificationItem> Notification "Du bist Kanal [ RSI Hermes : Pilot ] beigetreten')), [])
        self.assertEqual(p.feed(line('<SHUDEvent_OnNotification> Added notification "You have joined channel \'Global\'')), [])
        self.assertEqual(p.feed(line('<SHUDEvent_OnNotification> Added notification "You have joined channel \'RSI Hermes : Pilot\''))[0]['kind'], 'ship')

    def test_location_inventory_departure_and_return_are_player_scoped(self):
        p = GameLogParser(); p.player = 'Pilot'
        p.feed(line('<Update Inventory Location> Player [Pilot] is changing location. Landing [0] -> [12]. Location [0] -> [12].'))
        p.feed(line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Stanton2_Orison]'))
        self.assertEqual(p.location, 'Stanton2_Orison')
        self.assertEqual(p.feed(line('<RequestLocationInventory> Player[Other] requested inventory for Location[Elsewhere]')), [])
        self.assertEqual(p.feed(line('<Update Inventory Location> Player [Pilot] is changing location. Landing [12] -> [0]. Location [12] -> [99].'))[0]['value'], '')
        self.assertEqual(p.feed(line('<Update Inventory Location> Player [Pilot] is changing location. Landing [0] -> [12]. Location [99] -> [12].'))[0]['value'], 'Stanton2_Orison')
        self.assertEqual(p.feed(line('Player has selected point MicroTech as their destination')), [])

    def test_mission_ids_objectives_and_failed_missions(self):
        p = GameLogParser()
        accepted = p.feed(line(f'<SHUDEvent_OnNotification> Added notification "Auftrag angenommen: Courier <EM4>[BP]</EM4>: " [5] to queue, MissionId: [{MISSION}], ObjectiveId: []'))
        self.assertEqual(accepted[0]['title'], 'Courier [BP]')
        objective = p.feed(line(f'<ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id {MISSION} - objective_id pickup_box_0 - state MISSION_OBJECTIVE_STATE_COMPLETED - created 0'))
        self.assertEqual(objective[0]['missionId'], MISSION)
        self.assertEqual(p.feed(line(f'<MissionEnded> mission_id {MISSION} - mission_state MISSION_STATE_FAILED')), [])
        self.assertEqual(p.feed(line(f'<MissionEnded> mission_id {MISSION} - mission_state MISSION_STATE_COMPLETED'))[0]['kind'], 'completed')

    def test_multiline_objective_message(self):
        p = GameLogParser()
        p.feed(line('<SHUDEvent_OnNotification> Added notification "Abgeschlossen: Vorräte bei Bountiful Harvest abholen'))
        result = p.feed(line(f': " [14] to queue, MissionId: [{MISSION}], ObjectiveId: [pickup_box_0]'))
        self.assertEqual(result[0]['kind'], 'objective_text')
        self.assertIn('Bountiful Harvest', result[0]['text'])


class TailerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / 'LIVE').mkdir()
        self.path = self.root / 'LIVE' / 'Game.log'; self.database = self.root / 'events.sqlite'
        @contextmanager
        def connect():
            db = sqlite3.connect(self.database)
            try: yield db
            finally: db.close()
        self.connect = connect
        with connect() as db:
            init_store(db); db.commit()
        self.runtime = SimpleNamespace(settings={'logEnabled':True, 'gameDirectory':str(self.root), 'gameChannel':'LIVE'})
        self.reader = Telemetry(self.runtime, connect)

    def tearDown(self):
        self.temp.cleanup()

    def test_no_directory_means_no_filesystem_search_or_read(self):
        self.runtime.settings['gameDirectory'] = ''
        with patch.object(Path, 'open', side_effect=AssertionError('Unexpected file read')), \
             patch.object(Path, 'iterdir', side_effect=AssertionError('Unexpected directory search')), \
             patch.object(Path, 'stat', side_effect=AssertionError('Unexpected file probe')):
            self.reader.tick()
        data = self.reader.snapshot()
        self.assertEqual(data['error'], 'directory_required')
        self.assertEqual(data['path'], '')
        self.assertFalse(data['live'])

    def test_only_configured_channel_is_read_even_if_another_is_newer(self):
        self.path.write_text(line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]'))
        other = self.root / 'PTU' / 'Game.log'; other.parent.mkdir()
        other.write_text(line('<RequestLocationInventory> Player[Other] requested inventory for Location[MicroTech]'))
        os.utime(other, (self.path.stat().st_mtime + 10,) * 2)
        original_open = Path.open
        with patch.object(Path, 'open', autospec=True, side_effect=original_open) as opened:
            self.reader.tick()
        opened.assert_called_once_with(self.path, 'rb')
        self.assertEqual(self.reader.snapshot()['location'], 'Orison')
        self.path.unlink()
        self.reader.tick()
        self.assertEqual(self.reader.snapshot()['error'], 'not_found')
        self.assertEqual(self.reader.snapshot()['path'], str(self.path))
        self.assertEqual(self.reader.snapshot()['player'], 'Pilot')
        self.runtime.settings['gameChannel'] = 'PTU'
        self.reader.tick()
        self.assertEqual(self.reader.snapshot()['player'], 'Other')

    def test_switching_to_missing_folder_clears_previous_detection(self):
        self.path.write_text(line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]'))
        self.reader.tick()
        self.runtime.settings['gameDirectory'] = str(self.root / 'another-installation')
        self.reader.tick()
        data = self.reader.snapshot()
        self.assertFalse(data['live'])
        self.assertEqual(data['location'], '')
        self.assertEqual(data['path'], str(self.root / 'another-installation' / 'LIVE' / 'Game.log'))

    def test_historical_completions_never_replay_but_live_ship_restores(self):
        text = line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Stanton2_Orison]')
        text += line('<SHUDEvent_OnNotification> Added notification "Du bist Kanal [ RSI Hermes : Pilot ] beigetreten')
        text += line(f'<MissionEnded> mission_id {MISSION} - mission_state MISSION_STATE_COMPLETED')
        self.path.write_text(text, encoding='utf-8'); self.reader.tick()
        data = self.reader.snapshot()
        self.assertTrue(data['live'])
        self.assertEqual({event['kind'] for event in data['events']}, {'ship', 'location'})

    def test_partial_lines_duplicates_and_rotation(self):
        self.path.write_text(line('initial')); self.reader.tick()
        text = line(f'<MissionEnded> mission_id {MISSION} - mission_state MISSION_STATE_COMPLETED')
        with self.path.open('a') as target: target.write(text[:-5])
        self.reader.tick(); self.assertEqual(self.reader.snapshot()['events'], [])
        with self.path.open('a') as target: target.write(text[-5:] + text)
        self.reader.tick(); self.assertEqual(len(self.reader.snapshot()['events']), 1)
        self.path.write_text(line('new session')); self.reader.tick()
        self.assertIsNone(self.reader.parser.ship)
        self.assertFalse(self.reader.snapshot()['live'])
        self.assertEqual(len(self.reader.snapshot()['events']), 1)

    def test_stale_log_and_missing_file_have_no_live_state(self):
        at = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        self.path.write_text(line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]', at))
        self.reader.tick()
        self.assertFalse(self.reader.snapshot()['live']); self.assertEqual(self.reader.snapshot()['events'], [])
        self.path.unlink(); self.reader.tick(); self.assertEqual(self.reader.snapshot()['error'], 'not_found')

    def test_timestamped_disconnect_invalidates_ship_location(self):
        self.path.write_text(line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]'))
        self.reader.tick()
        with self.path.open('a') as target: target.write(line('<Channel Disconnected> remoteAddr=server reason="disconnect"'))
        self.reader.tick(); self.assertFalse(self.reader.snapshot()['live'])

    def test_in_place_rotation_with_same_prefix_invalidates_the_session(self):
        prefix = line('shared header ' + 'x' * 300)
        self.path.write_text(prefix + line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]'))
        self.reader.tick(); session = self.reader.snapshot()['session']
        self.path.write_text(prefix + line('replacement ' + 'x' * 500))
        self.reader.tick()
        self.assertNotEqual(self.reader.snapshot()['session'], session)
        self.assertFalse(self.reader.snapshot()['live'])


class BalanceTests(unittest.TestCase):
    def test_personal_transfer_keeps_balance_and_relinks_canonical_mission_ids(self):
        import transfer
        original={'missions':[{'id':'browser-fallback','title':'Contract'}],
                  'telemetryLinks':{'missions':{'game':'browser-fallback'}},
                  'telemetryBalance':{'amount':2853872,'at':'2026-10-31T12:00:00Z'}}
        copied=transfer.personal_state(original)
        self.assertEqual(copied['telemetryLinks']['missions']['game'],copied['missions'][0]['id'])
        self.assertEqual(copied['telemetryBalance'],original['telemetryBalance'])

    def test_amount_formats_reject_rewards_labels_and_ambiguous_separators(self):
        for value in ['2,853,872', '2.853.872', '2853872']:
            self.assertEqual(parse_amount(value), 2853872)
        self.assertEqual(parse_amount('0'), 0)
        for value in ['2,85,872', 'Belohnung 50250', '2853.87', '2 853 872', '4 2,853,872', '-1', '']:
            self.assertIsNone(parse_amount(value))

    def test_all_reads_and_player_identity_must_agree(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crop.png'; path.touch()
            with patch('shared.mission_import.balance.ocr.prepare_ocr_crop', return_value=path), \
                 patch('shared.mission_import.balance.ocr.run_ocr', return_value='Pilot'), \
                 patch('shared.mission_import.balance.read_number', side_effect=[2853872,2959872,2853872]):
                self.assertIsNone(read_balance('tesseract', path, 'Pilot'))
            with patch('shared.mission_import.balance.ocr.prepare_ocr_crop', return_value=path), \
                 patch('shared.mission_import.balance.ocr.run_ocr', return_value='Other'), \
                 patch('shared.mission_import.balance.read_number') as number:
                self.assertIsNone(read_balance('tesseract', path, 'Pilot')); number.assert_not_called()

    def test_settings_accept_only_local_directories_and_explicit_channels(self):
        for payload in [{'logEnabled':'true'}, {'gameDirectory':'relative/StarCitizen'},
                        {'gameDirectory':r'\\server\StarCitizen'}, {'gameDirectory':r'C:\StarCitizen\LIVE\Game.log'},
                        {'gameDirectory':r'C:\StarCitizen\LIVE'}, {'gameDirectory':r'C:\StarCitizen.exe'},
                        {'gameChannel':'../other'}, {'gameChannel':None}]:
            with self.assertRaises(ValueError): validate_settings(payload)
        directory = str(Path.cwd() / 'StarCitizen')
        result = validate_settings({'gameDirectory': f' "{directory}" ', 'gameChannel': 'PTU'})
        self.assertEqual(configured_log(result), Path(directory) / 'PTU' / 'Game.log')
        self.assertIsNone(configured_log({'gameDirectory':''}))

    def test_two_confident_reads_are_required_and_a_third_conflict_vetoes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crop.png'
            for readings, expected in [([2853872,2853872,None],2853872), ([2853872,None,2853872],None), ([2853872,2853872,2959872],None)]:
                with patch('shared.mission_import.balance.ocr.prepare_ocr_crop', return_value=path), \
                     patch('shared.mission_import.balance.ocr.run_ocr', return_value='Pilot'), \
                     patch('shared.mission_import.balance.read_number', side_effect=readings):
                    self.assertEqual(read_balance('tesseract',path,'Pilot'),expected)


if __name__ == '__main__': unittest.main()
