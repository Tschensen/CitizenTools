"""Location regressions using a reduced, anonymised real flight from 2026-11-01."""
from pathlib import Path
import unittest

from shared.game_log import GameLogParser


def line(text, at='2026-11-01T15:00:00Z'):
    return f'<{at}> [Notice] {text}'


def move(landing, location, player='Pilot'):
    return line(f'<Update Inventory Location> Player [{player}] is changing location. '
                f'Landing [12] -> [{landing}]. Location [12] -> [{location}].')


def inventory(name):
    return line(f'<RequestLocationInventory> Player[Pilot] requested inventory for Location[{name}]')


class LocationTests(unittest.TestCase):
    def parser(self):
        parser = GameLogParser()
        parser.feed(line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42'))
        return parser

    def test_recorded_roundtrip_preserves_the_station_and_distinguishes_body_and_space(self):
        parser = self.parser()
        expected = {
            '15:09:48': ('place', 'Stanton2_Orison'),
            '15:17:42': ('place', 'Stanton2_Orison'),  # selected target only
            '15:18:49': ('body', 'Crusader'),
            '15:19:15': ('space', None),
            '15:20:55': ('space', None),  # quantum arrival outside the station
            '15:22:54': ('place', 'RR_CRU_L4'),
            '15:41:02': ('place', 'RR_CRU_L4'),
            '15:41:36': ('space', None),
            '15:43:12': ('space', None),
            '15:44:18': ('place', 'RR_CRU_L1'),
            '16:04:32': ('place', 'RR_CRU_L1'),  # nested volume, same landing
            '16:04:36': ('place', 'RR_CRU_L1'),
            '16:21:47': ('place', 'RR_CRU_L1'),
            '16:22:18': ('space', None),
            '16:22:41': ('body', 'Crusader'),
            '16:24:24': ('place', 'Stanton2_Orison'),
        }
        states = {}
        source = Path(__file__).parent / 'fixtures/logs/stanton-roundtrip.txt'
        for row in source.read_text(encoding='utf-8').splitlines():
            parser.feed(row)
            states[row[12:20]] = (parser.position.kind, parser.location)
        for time, state in expected.items():
            with self.subTest(time=time):
                self.assertEqual(states[time], state)
        self.assertFalse(parser.connected)
        self.assertEqual(parser.last_location, 'Stanton2_Orison')

    def test_landing_has_priority_over_even_a_known_body_or_space_region(self):
        parser = self.parser()
        parser.feed(move('12', '12'))
        parser.feed(inventory('RR_HUR_LEO'))
        for region in ('1409305106', '467417103', '1902223495'):
            self.assertEqual(parser.feed(move('12', region)), [])
            self.assertEqual(parser.location, 'RR_HUR_LEO')
        parser.feed(inventory('RR_HUR_LEO'))
        parser.feed(move('0', '1902223495'))
        self.assertIsNone(parser.location)
        self.assertEqual(parser.position.kind, 'space')

    def test_unknown_regions_are_travel_not_space_and_delayed_inventory_cannot_restore_station(self):
        parser = self.parser()
        parser.feed(move('12', '12')); parser.feed(inventory('Stanton2_Orison'))
        parser.feed(move('0', '999'))
        self.assertEqual(parser.position.kind, 'travel')
        self.assertEqual(parser.last_location, 'Stanton2_Orison')
        self.assertIsNone(parser.location)
        self.assertEqual(parser.feed(inventory('Stanton2_Orison')), [])
        self.assertIsNone(parser.location)
        parser.feed(move('12', '999'))
        self.assertEqual(parser.location, 'Stanton2_Orison')

    def test_other_players_and_new_sessions_do_not_reuse_local_station_bindings(self):
        parser = self.parser()
        parser.feed(move('12', '12')); parser.feed(inventory('RR_CRU_L1'))
        self.assertEqual(parser.feed(move('0', '1902223495', 'Other')), [])
        self.assertEqual(parser.location, 'RR_CRU_L1')
        parser.feed(line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42'))
        parser.feed(move('12', '12'))
        self.assertIsNone(parser.location)
        self.assertEqual(parser.position.kind, 'unknown')
        self.assertEqual(parser.last_location, '')
        parser.feed(move('555', '1902223495'))
        self.assertNotEqual(parser.position.kind, 'space')  # positive, not yet named landing area

    def test_destination_is_separate_from_position_and_only_belongs_to_current_ship(self):
        parser = self.parser()
        parser.feed(move('12', '12')); parser.feed(inventory('Stanton2_Orison'))
        parser.feed(line('<SHUDEvent_OnNotification> Added notification "Du bist Kanal [ Origin 315p : Pilot ] beigetreten'))
        selected = '<Player Selected Quantum Target - Local> | ORIG_315p_123[123]| Player has selected point LOC_RR_S2_L4 as their destination [QuantumTravel]'
        parser.feed(line(selected))
        self.assertEqual(parser.location, 'Stanton2_Orison')
        self.assertEqual(parser.position.destination, 'RR_CRU_L4')
        parser.feed(line('<Calculate Route> | ORIG_315p_123[123]| Projected Start Location is Nowhere for route to destination MicroTech [QuantumTravel]'))
        self.assertEqual(parser.location, 'Stanton2_Orison')
        parser.feed(line(selected.replace('123', '456').replace('S2_L4', 'S2_L1')))
        self.assertEqual(parser.position.destination, 'RR_CRU_L4')
        arrival = '<Quantum Drive Arrived - Arrived at Final Destination> | ORIG_315p_123[123]| [QuantumTravel]'
        parser.feed(line(arrival.replace('123', '456')))
        self.assertEqual(parser.position.destination, 'RR_CRU_L4')
        parser.feed(line(arrival))
        self.assertEqual(parser.position.destination, '')
        parser.feed(line(selected))
        parser.feed(line('<SHUDEvent_OnNotification> Added notification "Du hast Kanal [ Origin 315p : Pilot ] verlassen'))
        self.assertEqual(parser.position.destination, '')

    def test_body_regions_do_not_invent_a_specific_facility(self):
        parser = self.parser()
        for region, name in [('467417103', 'Hurston'), ('1041448922', 'ArcCorp'),
                             ('308027484', 'microTech'), ('2610496815', 'Daymar'),
                             ('1988372641', 'Cellin'), ('3846627315', 'Lyria')]:
            with self.subTest(name=name):
                events = parser.feed(move('0', region))
                self.assertEqual(parser.location, name)
                self.assertEqual(events[-1]['locationContext']['kind'], 'body')
                self.assertEqual(events[-1]['locationContext']['system'], 'Stanton')


if __name__ == '__main__':
    unittest.main()
