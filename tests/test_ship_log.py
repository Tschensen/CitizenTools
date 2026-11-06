import unittest
from shared.game_log import GameLogParser


def line(text, second=0):
    return f'<2026-11-05T12:00:{second:02d}.000Z> [Notice] {text}'


def board(parser, owner='Pilot', model='Origin 400i'):
    return parser.feed(line(f'<SHUDEvent_OnNotification> Added notification "Du bist Kanal [ {model} : {owner} ] beigetreten'))


def navigation(entity='ORIG_400i_123'):
    entity_id = entity.rsplit('_', 1)[1]
    return f'<Player Selected Quantum Target - Local> [ItemNavigation][CL][1] | NOT AUTH | {entity}[{entity_id}]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point Orison'


def collision(entity='ORIG_400i_123'):
    return f'<FatalCollision> Fatal Collision occured for vehicle {entity} [Part: geo_body, Pos: x: 1, Zone: Wala, PlayerPilot: 1] after hitting entity: UNKNOWN'


class ShipLogTests(unittest.TestCase):
    def parser(self):
        parser = GameLogParser()
        parser.feed(line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42'))
        return parser

    def test_boarding_has_owner_but_needs_local_entity_evidence(self):
        p = self.parser()
        event = board(p)[0]
        self.assertEqual(event['owner'], 'Pilot')
        self.assertNotIn('entityId', event)
        self.assertEqual(p.feed(line('<Local Route Guard - Server Rerouted> | NOT AUTH | ORIG_400i_999[999]|')), [])
        self.assertEqual(p.feed(line(navigation('ORIG_315p_321'))), [])
        event = p.feed(line(navigation(), 1))[0]
        self.assertEqual(event['entityId'], '123')
        self.assertEqual(event['className'], 'ORIG_400i')
        self.assertEqual(p.feed(line(navigation('ORIG_400i_999'), 2)), [])

    def test_only_known_owned_instance_can_produce_loss_and_duplicates_are_ignored(self):
        p = self.parser();board(p);p.feed(line(navigation(), 1))
        self.assertEqual(p.feed(line(collision('ORIG_400i_999'), 2)), [])
        loss = p.feed(line(collision(), 3))[0]
        self.assertEqual(loss['kind'], 'ship_loss');self.assertEqual(loss['entityId'], '123')
        self.assertEqual(p.feed(line(collision(), 4)), [])
        p = self.parser();board(p, 'Other');p.feed(line(navigation(), 1))
        self.assertEqual(p.feed(line(collision(), 2)), [])

    def test_actual_collision_control_death_sequence_can_bind_and_propose_once(self):
        p = self.parser();board(p, model='RSI Hermes')
        self.assertEqual(p.feed(line(collision('RSI_Hermes_123'), 1)), [])
        control = "<Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [42] releasing control token for 'RSI_Hermes_123' [123]"
        events = p.feed(line(control, 2))
        self.assertEqual([event['kind'] for event in events], ['ship', 'ship_loss'])
        dead = "<[ActorState] Dead> Actor 'Pilot' [42] ejected from zone 'RSI_Hermes_123' [123] to zone 'Wala' [321] due to previous zone being in a destroyed vehicle with detached interior."
        self.assertEqual([event['kind'] for event in p.feed(line(dead, 3))], ['ship_exit'])
        self.assertIsNone(p.ship)
        self.assertEqual(p.ship_presence, 'outside')

    def test_other_player_control_and_death_do_not_bind(self):
        p = self.parser();board(p)
        self.assertEqual(p.feed(line("<Vehicle Control Flow> Local client node [99] releasing control token for 'ORIG_400i_123' [123]")), [])
        self.assertEqual(p.feed(line("<[ActorState] Dead> Actor 'Other' [99] ejected from zone 'ORIG_400i_123' [123] due to previous zone being in a destroyed vehicle")), [])

    def test_reconnect_and_new_boarding_reset_instance_context(self):
        p=self.parser();board(p);p.feed(line(navigation(), 1))
        board(p);self.assertEqual(p.feed(line(navigation('ORIG_400i_456'), 2))[0]['entityId'], '456')
        p.feed(line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42', 3))
        self.assertEqual(p.feed(line(collision(), 4)), [])

    def test_other_owner_leaving_same_model_does_not_clear_current_ship(self):
        p=self.parser();board(p)
        p.feed(line('<SHUDEvent_OnNotification> Added notification "Du hast Kanal [ Origin 400i : Other ] verlassen'))
        self.assertIsNotNone(p.ship)

    def test_exit_notifications_clear_presence_and_an_old_control_event_cannot_reboard(self):
        for notice in ['Du hast Kanal [ Origin 400i : Pilot ] verlassen',
                       "You have left the channel 'Origin 400i : Pilot'"]:
            p=self.parser();board(p);p.feed(line(navigation(), 1))
            result=p.feed(line(f'<SHUDEvent_OnNotification> Added notification "{notice}', 2))
            self.assertEqual(result[0]['kind'],'ship_exit')
            self.assertEqual(p.ship_presence,'outside');self.assertIsNone(p.ship)
            self.assertEqual(p.feed(line(navigation(), 3)), [])
            p.feed(line('<Channel Connection Complete> remoteAddr=server nickname="Pilot" playerGEID=42',4))
            self.assertEqual(p.ship_presence,'unknown')


if __name__ == '__main__':
    unittest.main()
