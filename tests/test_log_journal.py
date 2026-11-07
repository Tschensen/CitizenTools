import json
from pathlib import Path
import sqlite3
import unittest

from companion import journal
from shared.game_log import GameLogParser
from shared.log_journal import LogJournal


FIXTURE = Path(__file__).parent / 'fixtures/logs/stanton-roundtrip.txt'


def line(text, second):
    return f'<2026-11-07T12:{second // 60:02d}:{second % 60:02d}.000Z> [Notice] {text}'


def start():
    return [line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42',0),
            line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Stanton2_Orison]',1),
            line('<SHUDEvent_OnNotification> Added notification "Du bist Kanal [ Origin 315p : Pilot ] beigetreten',2)]


def select(target='LOC_RR_S2_L4', entity='300000001'):
    return f'<Player Selected Quantum Target - Local> | ORIG_315p_{entity}[{entity}]|Player has selected point {target} as their destination [QuantumTravel]'


def fuel(value='95762.351562', target='LOC_RR_S2_L4', entity='300000001'):
    return f'<Calculate Route> | ORIG_315p_{entity}[{entity}]|Successfully calculated route to {target} fuel estimate {value} [QuantumTravel]'


def depart(second=10):
    return line('<Update Inventory Location> Player [Pilot] Landing [12] -> [0]. Location [12] -> [1902223495].',second)


def arrive(second=130, destination='RR_CRU_L4'):
    return [line('<Update Inventory Location> Player [Pilot] Landing [0] -> [44]. Location [1902223495] -> [44].',second),
            line(f'<RequestLocationInventory> Player[Pilot] requested inventory for Location[{destination}]',second+1)]


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        journal.init_store(self.db)

    def tearDown(self):
        self.db.close()

    def read_lines(self, lines, channel='LIVE', chunk=1):
        parser, log = GameLogParser(), LogJournal(channel)
        for index, value in enumerate(lines):
            log.feed(value, parser, parser.feed(value))
            if index % chunk == 0:
                journal.save(self.db, *log.drain())
        journal.save(self.db, *log.drain())
        return journal.read(self.db)

    def test_real_roundtrip_has_three_area_to_area_durations_and_survives_replay(self):
        lines = FIXTURE.read_text(encoding='utf-8').splitlines()
        result = self.read_lines(lines)
        trips = [e for e in result['entries'] if e['kind']=='trip']
        self.assertEqual([(t['from'],t['to']) for t in trips],
                         [('Stanton2_Orison','RR_CRU_L4'),('RR_CRU_L4','RR_CRU_L1'),('RR_CRU_L1','Stanton2_Orison')])
        self.assertTrue(all(t['status']=='arrived' and t['durationSeconds']>0 for t in trips))
        self.assertTrue(all('fuelEstimate' not in t for t in trips))
        replay = self.read_lines(lines, chunk=100)
        self.assertEqual(replay, result)
        self.assertEqual(len(replay['sessions']),1)

    def test_estimate_requires_local_selected_target_and_is_not_summed_or_consumption(self):
        lines = start()+[line(select(),3),line(fuel(),3),line(fuel('95000'),4),depart(),*arrive()]
        result = self.read_lines(lines)
        trip = next(e for e in result['entries'] if e['kind']=='trip')
        self.assertEqual(trip['fuelEstimate'],95000)
        self.assertEqual(trip['durationSeconds'],121)
        self.assertNotIn('candidateEstimate',trip)
        self.assertEqual(len([e for e in result['entries'] if e['kind']=='route']),2)
        for bad in [fuel(entity='999'),fuel(target='LOC_RR_S2_L1'),fuel('NaN'),fuel('-1'),fuel('1e9')]:
            with self.subTest(bad=bad):
                self.db.execute('DELETE FROM log_journal')
                result=self.read_lines(start()+[line(select(),3),line(bad,4)])
                self.assertFalse(any(e['kind']=='route' for e in result['entries']))

    def test_estimate_does_not_prove_departure_and_wrong_target_or_inflight_estimate_is_not_a_trip_total(self):
        result=self.read_lines(start()+[line(select(),3),line(fuel(),3)])
        self.assertFalse(any(e['kind']=='trip' for e in result['entries']))
        for lines in [start()+[line(select(),3),line(fuel(),3),depart(),*arrive(destination='RR_CRU_L1')],
                      start()+[line(select(),3),depart(),line(fuel(),11),*arrive()]]:
            self.db.execute('DELETE FROM log_journal')
            result=self.read_lines(lines)
            self.assertNotIn('fuelEstimate',next(e for e in result['entries'] if e['kind']=='trip'))

    def test_disconnect_ship_exit_and_loss_do_not_finish_a_trip_or_fail_a_contract(self):
        mid='11111111-2222-3333-4444-555555555555'
        accepted=line(f'<SHUDEvent_OnNotification> Added notification "Auftrag angenommen: Courier" [1] MissionId: [{mid}]',3)
        ending=[('<Channel Disconnected> remoteAddr=server','disconnect'),
                ('<SHUDEvent_OnNotification> Added notification "Du hast Kanal [ Origin 315p : Pilot ] verlassen','ship_exit'),
                ('<FatalCollision> Fatal Collision occured for vehicle ORIG_315p_300000001 [Part: hull, Zone: Space, PlayerPilot: 1]','ship_loss')]
        for event,reason in ending:
            self.db.execute('DELETE FROM log_journal')
            result=self.read_lines(start()+[accepted,accepted,line(select(),4),depart(),line(event,20)])
            trip=next(e for e in result['entries'] if e['kind']=='trip')
            self.assertEqual((trip['status'],trip['reason']),('interrupted',reason))
            self.assertEqual(len([e for e in result['entries'] if e['kind']=='accepted']),1)
            self.assertFalse(any(e['kind']=='failed' for e in result['entries']))

    def test_sessions_channels_and_partial_logs_are_separate(self):
        self.read_lines(start()+[depart(),line('<Channel Disconnected> remoteAddr=server',20)])
        self.read_lines(start(),channel='PTU')
        result=self.read_lines([line('<RequestLocationInventory> Player[Pilot] requested inventory for Location[Orison]',30)])
        self.assertEqual(len(result['sessions']),3)
        self.assertTrue(result['session']['partial'])
        self.assertFalse(any(e['kind']=='trip' for e in result['entries']))

    def test_only_owned_player_events_and_not_navigation_from_other_entities(self):
        result=self.read_lines(start()+[line(fuel(),3),
            line('<RequestLocationInventory> Player[SomeoneElse] requested inventory for Location[Elsewhere]',4),
            line('<Update Inventory Location> Player [SomeoneElse] Landing [12] -> [0]. Location [12] -> [1902223495].',5)])
        self.assertEqual([e['kind'] for e in result['entries']],['location','ship'])

    def test_paged_session_list_keeps_selected_session_and_bounds_entries(self):
        sessions=[{'id':str(i),'startedAt':f'2026-10-{i:02d}T12:00:00Z'} for i in range(1,32)]
        journal.save(self.db,sessions,[])
        first=journal.read(self.db)
        self.assertEqual(len(first['sessions']),30)
        self.assertTrue(first['nextBefore'])
        second=journal.read(self.db,'31',first['nextBefore'])
        self.assertEqual(len(second['sessions']),1)
        self.assertEqual(second['session']['id'],'31')
        self.assertEqual(second['nextBefore'],'')


if __name__ == '__main__':
    unittest.main()
