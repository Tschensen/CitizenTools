"""Read-only, language-aware parsing of Star Citizen's observed Game.log events.

Only explicit local-player events count. Rendering notifications, nearby ships,
selected quantum targets and transaction requests are not confirmations.
"""
from __future__ import annotations

import hashlib
import re
import uuid

STAMP = re.compile(r'^<([^>]+)>')
UUID = r'[0-9a-fA-F-]{36}'


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
        self.session = uuid.uuid4().hex

    def event(self, kind, at, **data):
        identity = f'{kind}|{at}|{data}'
        return {'id': hashlib.sha256(identity.encode()).hexdigest(), 'kind': kind,
                'at': at, 'player': self.player, 'session': self.session, 'location': self.location or '', **data}

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
        if '<Channel Disconnected>' in line and 'remoteAddr=<local>' not in line:
            self.connected = False
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
            self.notification = line
        elif self.notification and 'MissionId: [' in line:
            line = self.notification + ' ' + line
            self.notification = ''
        else:
            self.notification = ''
        if '<SHUDEvent_OnNotification> Added notification ' in line:
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
                return [self.event('completed', at, missionId=mission_id)]
        return []
