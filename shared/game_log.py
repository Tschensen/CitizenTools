"""Read-only, language-aware parsing of Star Citizen's observed Game.log events.

Only explicit local-player events count. Rendering notifications, nearby ships,
selected quantum targets and transaction requests are not confirmations.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime

STAMP = re.compile(r'^<([^>]+)>')
UUID = r'[0-9a-fA-F-]{36}'
AMOUNT = r'(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{1,12})'
PAYMENT_WINDOW = 2


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
        self.ship = None
        self.location = None
        self.connected = False
        self.last_at = ''
        self.contracts = {}
        self.locations = {}
        self.location_id = ''
        self.notification = ''
        self.completions = {}
        self.payment_candidate = None
        self.session = uuid.uuid4().hex

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
        identity = re.search(r'nickname="([^"]+)"\s+playerGEID=\d+', line)
        if identity and '<Channel ' in line:
            self.player = identity[1]
        if '<Channel Connection Complete>' in line and 'remoteAddr=<local>' not in line:
            self.session = uuid.uuid4().hex
            self.ship = self.location = None
            self.location_id = ''
            self.connected = True
            self.contracts.clear()
            self.locations.clear()
            self.completions.clear()
            self.payment_candidate = None
            self.notification = ''
        if '<Channel Disconnected>' in line and 'remoteAddr=<local>' not in line:
            self.connected = False
            self.completions.clear()
            self.payment_candidate = None
            self.notification = ''
            return [self.event('disconnected', at)]
        found = re.search(r'<RequestLocationInventory> Player\[([^]]+)\] requested inventory for Location\[([^]]+)\]', line)
        if found and (not self.player or found[1] == self.player):
            self.player = found[1]
            self.location = found[2]
            self.connected = True
            if self.location_id:
                self.locations[self.location_id] = self.location
            return [self.event('location', at, value=self.location)]
        moved = re.search(r'<Update Inventory Location> Player \[([^]]+)\].*?Location \[\d+\] -> \[(\d+)\]', line)
        if moved and (not self.player or moved[1] == self.player):
            self.location_id = moved[2]
            location = self.locations.get(self.location_id)
            if location != self.location:
                self.location = location
                return [self.event('location', at, value=location or '')]
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
                    self.ship = {'name': name.strip(), 'owner': owner.strip()}
                    return [self.event('ship', at, **self.ship)]
            left = re.search(r"(?:You have left the channel '([^']+)'|Du hast (?:den )?Kanal \[\s*([^]]+)\]\s*verlassen)", line)
            if left and self.ship and self.ship['name'] in (left[1] or left[2]):
                self.ship = None
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
