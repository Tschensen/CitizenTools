"""Read-only, language-aware parsing of Star Citizen's observed Game.log events.

Only explicit local-player events count. Rendering notifications, nearby ships,
selected quantum targets and transaction requests are not confirmations.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime

from shared.log_location import LogLocation

STAMP = re.compile(r'^<([^>]+)>')
UUID = r'[0-9a-fA-F-]{36}'
AMOUNT = r'(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{1,12})'
PAYMENT_WINDOW = 2

# These are entity-class prefixes, not persistent ownership identifiers.
SHIP_MAKERS = {'ORIG': 'Origin', 'RSI': 'RSI', 'MISC': 'MISC', 'DRAK': 'Drake',
               'ANVL': 'Anvil', 'AEGS': 'Aegis', 'CRUS': 'Crusader', 'ARGO': 'Argo',
               'CNOU': 'Consolidated Outland', 'GRIN': 'Greycat'}


def ship_class_matches(name, class_name):
    maker, _, model = class_name.partition('_')
    if maker not in SHIP_MAKERS or not model:
        return False
    normalize = lambda value: re.sub(r'[^a-z0-9]', '', value.lower())
    return normalize(name) in {normalize(SHIP_MAKERS[maker] + model), normalize(maker + model)}


def elapsed(later, earlier):
    try:
        return (datetime.fromisoformat(later) - datetime.fromisoformat(earlier)).total_seconds()
    except (ValueError, TypeError):
        return float('inf')


def clean(value):
    return re.sub(r'<[^>]+>', '', value).strip().rstrip(':').strip()


class GameLogParser:
    def __init__(self):
        self.player = ''
        self.player_id = ''
        self.ship = None
        self.ship_presence = 'unknown'
        self.ship_at = ''
        self.position = LogLocation()
        self.connected = False
        self.last_at = ''
        self.contracts = {}
        self.notification = ''
        self.completions = {}
        self.payment_candidate = None
        self.session = uuid.uuid4().hex
        self.ship_entities = {}
        self.ship_collisions = {}
        self.ship_losses = set()

    @property
    def location(self):
        return self.position.value

    @property
    def last_location(self):
        return self.position.previous

    def location_event(self, at):
        return self.event('location', at, value=self.location or '', locationContext=self.position.context())

    def bind_ship_entity(self, entity, entity_id, at):
        """Only bind a locally controlled ship to the current boarding notice."""
        class_name, _, suffix = entity.rpartition('_')
        if not self.ship or suffix != entity_id or not ship_class_matches(self.ship['name'], class_name):
            return []
        if self.ship.get('entityId') and self.ship['entityId'] != entity_id:
            return []  # A different instance requires a new boarding notice.
        changed = self.ship.get('entityId') != entity_id
        self.ship.update(entityId=entity_id, className=class_name)
        self.ship_entities[entity_id] = dict(self.ship)
        if len(self.ship_entities) > 100:
            self.ship_entities.pop(next(iter(self.ship_entities)))
        events = [self.event('ship', at, **self.ship)] if changed else []
        collision = self.ship_collisions.get(entity_id)
        if collision and 0 <= elapsed(at, collision['at']) <= 5:
            events += self.ship_loss(entity_id, at, 'fatal_collision', collision['zone'])
        return events

    def ship_loss(self, entity_id, at, evidence, zone=''):
        ship = self.ship_entities.get(entity_id)
        if not ship or not self.player or ship['owner'].casefold() != self.player.casefold() or entity_id in self.ship_losses:
            return []
        self.ship_losses.add(entity_id)
        return [self.event('ship_loss', at, **ship, evidence=evidence, zone=zone)]

    def ship_entity_events(self, line, at):
        # Generic route updates, spawn lists and nearby entities are NOT local
        # player evidence. Only explicit local input/control events qualify.
        navigation = re.search(r'<Player Selected Quantum Target - Local>.*?\| ([A-Za-z0-9_]+)\[(\d+)\]\|', line)
        if navigation:
            return self.bind_ship_entity(navigation[1], navigation[2], at)
        control = re.search(r"<Vehicle Control Flow>.*?Local client node \[(\d+)\] releasing control token for '([^']+)' \[(\d+)\]", line)
        if control and self.player_id and control[1] == self.player_id:
            return self.bind_ship_entity(control[2], control[3], at)
        collision = re.search(r'<FatalCollision> Fatal Collision occu(?:r|rr)ed for vehicle ([A-Za-z0-9_]+) \[.*?Zone: ([^,\]]+), PlayerPilot: [01]\]', line)
        if collision:
            entity_id = collision[1].rpartition('_')[2]
            if entity_id.isdigit():
                self.ship_collisions[entity_id] = {'at': at, 'zone': collision[2]}
                if len(self.ship_collisions) > 100:
                    self.ship_collisions.pop(next(iter(self.ship_collisions)))
                return self.ship_loss(entity_id, at, 'fatal_collision', collision[2])
        dead = re.search(r"<\[ActorState\] Dead>.*?Actor '([^']+)' \[(\d+)\] ejected from zone '([^']+)' \[(\d+)\].*?due to previous zone being in a destroyed vehicle", line)
        if dead and self.player and self.player_id and dead[1] == self.player and dead[2] == self.player_id:
            events = self.bind_ship_entity(dead[3], dead[4], at)
            events += self.ship_loss(dead[4], at, 'destroyed_vehicle')
            if self.ship and self.ship.get('entityId') == dead[4]:
                self.ship = None
                self.position.clear_destination()
                self.ship_presence, self.ship_at = 'outside', at
                events.append(self.event('ship_exit', at))
            return events
        return []

    def event(self, kind, at, **data):
        identity = f'{kind}|{at}|{data}'
        return {'id': hashlib.sha256(identity.encode()).hexdigest(), 'kind': kind,
                'at': at, 'player': self.player, 'session': self.session, 'location': self.location or '', **data}

    def payment_notification(self, line, at):
        """Correlate adjacent HUD notifications, never an arbitrary money message."""
        notice = re.search(r'<SHUDEvent_OnNotification> Added notification "([^"]*)" \[(\d+)\].*?MissionId: \[(' + UUID + r')\]', line)
        if not notice:
            if 'MissionId: [' in line:
                self.payment_candidate = None
            return []
        candidate = self.payment_candidate
        self.payment_candidate = None
        message, notification_id, mission_id = clean(notice[1]), int(notice[2]), notice[3].lower()
        recent = {key:stamp for key, stamp in self.completions.items() if 0 <= elapsed(at, stamp) <= PAYMENT_WINDOW}
        if re.match(r'^(?:Auftrag abgeschlossen|Contract completed|Contract complete):', message, re.I):
            if len(recent) == 1 and mission_id in recent:
                self.payment_candidate = {'missionId':mission_id, 'completedAt':recent[mission_id],
                                          'notificationAt':at, 'notificationId':notification_id}
            return []
        reward = re.fullmatch(r'(' + AMOUNT + r') aUEC (?:erhalten|received)|Received (' + AMOUNT + r') aUEC', message, re.I)
        if not reward or not candidate or notification_id != candidate['notificationId'] + 1:
            return []
        if mission_id not in ('00000000-0000-0000-0000-000000000000', candidate['missionId']):
            return []
        if set(recent) != {candidate['missionId']} or not 0 <= elapsed(at, candidate['notificationAt']) <= PAYMENT_WINDOW:
            return []
        amount = int((reward[1] or reward[2]).replace(',', '').replace('.', ''))
        if not 0 < amount <= 999_999_999_999:
            return []
        return [self.event('payment', at, missionId=candidate['missionId'], amount=amount,
                           completedAt=candidate['completedAt'], match='adjacent_notifications')]

    def feed(self, line):
        line = line.rstrip('\r\n')
        timestamp = STAMP.match(line)
        if not timestamp:
            return []
        at = timestamp[1]
        self.last_at = at
        identity = re.search(r'nickname="([^"]+)"\s+playerGEID=(\d+)', line)
        if identity and '<Channel ' in line:
            self.player = identity[1]
            self.player_id = identity[2]
        if '<Channel Connection Complete>' in line and 'remoteAddr=<local>' not in line:
            self.session = uuid.uuid4().hex
            self.ship = None
            self.position = LogLocation()
            self.ship_presence, self.ship_at = 'unknown', ''
            self.connected = True
            self.contracts.clear()
            self.completions.clear()
            self.payment_candidate = None
            self.notification = ''
            self.ship_entities.clear()
            self.ship_collisions.clear()
            self.ship_losses.clear()
            return [self.location_event(at)]
        if '<Channel Disconnected>' in line and 'remoteAddr=<local>' not in line:
            self.connected = False
            self.ship = None
            self.position.clear_destination()
            self.ship_presence, self.ship_at = 'unknown', ''
            self.ship_entities.clear()
            self.ship_collisions.clear()
            self.completions.clear()
            self.payment_candidate = None
            self.notification = ''
            return [self.event('disconnected', at)]
        ship_events = self.ship_entity_events(line, at)
        location_changed = self.position.feed(line, at, self.player, self.ship)
        if location_changed:
            if not self.player:
                identity = re.search(r'Player\[([^]]+)\]', line)
                if identity:
                    self.player = identity[1]
            self.connected = True
            ship_events.append(self.location_event(at))
        if ship_events:
            return ship_events
        # Some localized notifications span two timestamped lines. Keep the
        # header until its MissionId/ObjectiveId footer arrives.
        if '<SHUDEvent_OnNotification> Added notification ' in line:
            if self.notification:
                self.payment_candidate = None
            self.notification = '' if 'MissionId: [' in line else line
        elif self.notification and 'MissionId: [' in line:
            line = self.notification + ' ' + re.sub(r'^<[^>]+>\s*(?:\[(?:Notice|Info|Warning)\]\s*)?', '', line)
            self.notification = ''
        else:
            if self.notification:
                self.payment_candidate = None
            self.notification = ''
        if '<SHUDEvent_OnNotification> Added notification ' in line:
            payment = self.payment_notification(line, at)
            if payment:
                return payment
            ship = re.search(r"(?:You have joined channel '([^']+)'|Du bist Kanal \[\s*([^]]+)\]\s*beigetreten)", line)
            if ship:
                channel = (ship[1] or ship[2]).strip()
                if ' : ' in channel:
                    name, owner = channel.rsplit(' : ', 1)
                    self.position.clear_destination()
                    self.ship = {'name': name.strip(), 'owner': owner.strip()}
                    self.ship_presence, self.ship_at = 'aboard', at
                    return [self.event('ship', at, **self.ship)]
            left = re.search(r"(?:You have left the channel '([^']+)'|Du hast (?:den )?Kanal \[\s*([^]]+)\]\s*verlassen)", line)
            if left and self.ship and (left[1] or left[2]).strip() == f"{self.ship['name']} : {self.ship['owner']}":
                self.ship = None
                self.position.clear_destination()
                self.ship_presence, self.ship_at = 'outside', at
                return [self.event('ship_exit', at)]
            accepted = re.search(r'(?:Auftrag angenommen|Contract Accepted):\s*(.*?)".*?MissionId: \[(' + UUID + r')\]', line)
            if accepted:
                record = {'id': accepted[2].lower(), 'title': clean(accepted[1]), 'at': at, 'status': 'active'}
                self.contracts[record['id']] = record
                return [self.event('accepted', at, missionId=record['id'], title=record['title'])]
            objective_text = re.search(r'(?:Abgeschlossen|Completed):\s*(.*?)".*?MissionId: \[(' + UUID + r')\], ObjectiveId: \[([^]]+)\]', line)
            if objective_text:
                return [self.event('objective_text', at, missionId=objective_text[2].lower(),
                                   objectiveId=objective_text[3], text=clean(objective_text[1]))]
        objective = re.search(r'<(?:ObjectiveUpserted|ObjectiveComplete)>.*?mission_id (' + UUID + r') - objective_id (\S+) - state MISSION_OBJECTIVE_STATE_COMPLETED\b', line)
        if objective:
            return [self.event('objective', at, missionId=objective[1].lower(), objectiveId=objective[2])]
        ended = re.search(r'<MissionEnded>.*?mission_id (' + UUID + r') - mission_state (MISSION_STATE_\w+)', line)
        if ended:
            mission_id = ended[1].lower()
            if mission_id in self.contracts:
                self.contracts[mission_id]['status'] = ended[2]
            if ended[2] == 'MISSION_STATE_COMPLETED':
                self.completions = {key:stamp for key, stamp in self.completions.items()
                                    if 0 <= elapsed(at, stamp) <= PAYMENT_WINDOW}
                self.completions[mission_id] = at
                return [self.event('completed', at, missionId=mission_id)]
            self.completions.pop(mission_id, None)
            self.payment_candidate = None
        return []
