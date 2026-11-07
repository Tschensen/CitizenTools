"""Read-only session history built from local-player observations, not planner state."""
from __future__ import annotations

import copy
import hashlib
import math
import re
from datetime import datetime

from shared.log_location import ENTITY, target_name


def seconds(end, start):
    try:
        value = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
        return value if value >= 0 else None
    except (TypeError, ValueError):
        return None


def place_key(value):
    value = re.sub(r'^Stanton\d+_', '', target_name(value), flags=re.I)
    return re.sub(r'[^a-z0-9]', '', value.casefold())


class LogJournal:
    def __init__(self, channel):
        self.channel = channel
        self.session = None
        self.sessions = {}
        self.entries = {}
        self.reset_trip()

    def reset_trip(self):
        self.place = ''
        self.trip = None
        self.estimate = None
        self.selection = None
        self.boarding = None
        self.seen = set()

    def identifier(self, *parts):
        return hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()

    def entry(self, kind, at, key=None, **data):
        value = {'id': self.identifier(self.session['id'], kind, key or at),
                 'sessionId': self.session['id'], 'kind': kind, 'at': at, **data}
        self.entries[value['id']] = value
        return value

    def finish_trip(self, at, destination='', reason=''):
        if not self.trip:
            return
        self.trip.update(endedAt=at, to=destination, status='arrived' if destination else 'interrupted',
                         durationSeconds=seconds(at, self.trip['at']), reason=reason)
        estimate = self.trip.pop('candidateEstimate', None)
        if destination and estimate and place_key(estimate['to']) == place_key(destination):
            self.trip['fuelEstimate'] = estimate['fuelEstimate']
        self.entries[self.trip['id']] = copy.deepcopy(self.trip)
        self.trip = None
        self.estimate = None

    def feed(self, line, parser, events):
        stamp = re.match(r'^<([^>]+)>', line)
        if not stamp or seconds(stamp[1], stamp[1]) is None:
            return
        at = stamp[1]
        connection = '<Channel Connection Complete>' in line and 'remoteAddr=<local>' not in line
        if connection:
            self.finish_trip(at, reason='connection')
            if self.session and not self.session.get('endedAt'):
                self.session.update(endedAt=at, endReason='connection')
                self.sessions[self.session['id']] = copy.deepcopy(self.session)
            self.session = None
            self.reset_trip()
        # Do not turn pre-login engine output into a play session.
        if not self.session and (connection or (events and parser.connected)):
            self.session = {'id':self.identifier(self.channel, at, 'session'), 'channel':self.channel,
                            'startedAt':at, 'lastAt':at, 'endedAt':'', 'player':parser.player,
                            'partial':not connection}
        if not self.session or self.session.get('endedAt'):
            return
        self.session.update(lastAt=at, player=parser.player or self.session['player'])
        self.sessions[self.session['id']] = copy.deepcopy(self.session)
        for event in events:
            kind = event['kind']
            if kind == 'disconnected':
                self.finish_trip(at, reason='disconnect')
                self.session.update(endedAt=at, endReason='disconnect')
                self.sessions[self.session['id']] = copy.deepcopy(self.session)
                self.reset_trip()
            elif kind == 'location':
                context = event.get('locationContext', {})
                destination = event.get('value', '') if context.get('kind') == 'place' else ''
                if destination:
                    arriving = bool(self.trip)
                    self.finish_trip(at, destination)
                    if destination != self.place or arriving:
                        self.entry('location', at, place=destination)
                    self.place = destination
                elif self.place:
                    if not self.trip and parser.ship and parser.ship_presence == 'aboard':
                        self.trip = self.entry('trip', at, **{'from':self.place, 'to':'',
                            'status':'open', 'ship':copy.deepcopy(parser.ship)})
                        if self.estimate and seconds(at, self.estimate['at']) is not None \
                                and seconds(at, self.estimate['at']) <= 1800 \
                                and self.estimate['ship'].get('entityId') == parser.ship.get('entityId'):
                            self.trip['candidateEstimate'] = copy.deepcopy(self.estimate)
                    self.place = ''
            elif kind == 'ship':
                ship = {key:event[key] for key in ('name','owner','entityId','className') if key in event}
                if self.boarding and self.boarding['ship'].get('name') == ship.get('name') \
                        and self.boarding['ship'].get('owner') == ship.get('owner') \
                        and not self.boarding['ship'].get('entityId'):
                    self.boarding['ship'] = ship
                    self.entries[self.boarding['id']] = copy.deepcopy(self.boarding)
                    if self.trip and not self.trip['ship'].get('entityId'):
                        self.trip['ship'] = copy.deepcopy(ship)
                else:
                    if self.boarding:
                        self.finish_trip(at, reason='ship_change')
                    self.boarding = self.entry('ship', at, ship=ship)
                    self.estimate = self.selection = None
            elif kind in ('ship_exit', 'ship_loss'):
                self.finish_trip(at, reason=kind)
                if kind == 'ship_loss':
                    self.entry(kind, at, key=event.get('entityId'), ship={'name':event.get('name',''), 'owner':event.get('owner','')})
                elif self.boarding:
                    self.entry(kind, at, ship=copy.deepcopy(self.boarding['ship']))
                self.boarding = self.estimate = self.selection = None
            elif kind in ('accepted', 'completed', 'payment'):
                key = (kind, event.get('missionId'))
                if key in self.seen:
                    continue
                self.seen.add(key)
                contract = parser.contracts.get(event.get('missionId'), {})
                self.entry(kind, at, key=event.get('missionId'), missionId=event.get('missionId',''),
                           title=event.get('title') or contract.get('title',''), amount=event.get('amount'))
        entity = ENTITY.search(line) if '[QuantumTravel]' in line else None
        ship = parser.ship
        if not entity or not ship or ship.get('entityId') != entity[2] or parser.ship_presence != 'aboard':
            return
        if '<Player Selected Quantum Target - Local>' in line:
            target = re.search(r'Player has selected point (\S+) as their destination', line)
            if target:
                self.selection = {'at':at, 'target':target_name(target[1]), 'entityId':entity[2]}
                self.estimate = None
        if '<Calculate Route>' not in line or not self.selection:
            return
        route = re.search(r'Successfully calculated route to (\S+) fuel estimate ([0-9]+(?:\.[0-9]+)?)\s', line)
        age = seconds(at, self.selection['at'])
        if not route or age is None or age > 10 or self.selection['entityId'] != entity[2] \
                or target_name(route[1]) != self.selection['target']:
            return
        fuel = float(route[2])
        if not math.isfinite(fuel) or not 0 <= fuel < 1e15:
            return
        self.estimate = self.entry('route', at, **{'from':self.place, 'to':target_name(route[1]),
            'ship':copy.deepcopy(ship), 'fuelEstimate':fuel})

    def drain(self):
        # Bounded by the tailer's 1 MiB read; history itself lives in SQLite.
        result = (list(self.sessions.values()), [copy.deepcopy(e) for e in self.entries.values()])
        self.sessions.clear()
        self.entries.clear()
        return result
