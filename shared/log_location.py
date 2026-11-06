"""Local-player inventory areas, independent of route planning and ship selection.

The region IDs below were cross-checked against named arrivals/departures in
multiple 4.10.2 logs (builds 12881860/12913470). They describe a body's vicinity,
not touchdown or atmosphere. Unrecognised IDs never imply open space. Named
inventory IDs are learned only for the current connection.
"""
from __future__ import annotations

import re


REGIONS = {
    '467417103': ('body', 'Hurston', ''),
    '2493660041': ('body', 'Crusader', ''),
    '1041448922': ('body', 'ArcCorp', ''),
    '308027484': ('body', 'microTech', ''),
    '2610496815': ('body', 'Daymar', ''),
    '1988372641': ('body', 'Cellin', ''),
    '3846627315': ('body', 'Lyria', ''),
    '1902223495': ('space', '', ''),
    '3092374405': ('space', '', 'CRU-L4'),
    '2537229937': ('space', '', 'CRU-L1'),
    '3377612392': ('space', '', 'MIC-L1'),
    '1605649280': ('space', '', 'MIC-L5'),
}
SYSTEM = re.compile(r'^(Stanton|Pyro|Nyx)(?:\d|_|$)', re.I)
INVENTORY = re.compile(r'<RequestLocationInventory> Player\[([^]]+)\] requested inventory for Location\[([^]]+)\]')
MOVED = re.compile(r'<Update Inventory Location> Player \[([^]]+)\].*?Landing \[\d+\] -> \[(\d+)\]\. Location \[\d+\] -> \[(\d+)\]')
ENTITY = re.compile(r'\| ([A-Za-z0-9_]+)\[(\d+)\]\|')


def system_for(value):
    match = SYSTEM.match(value)
    if match:
        return match[1].capitalize()
    if re.match(r'^RR_(?:CRU|MIC|ARC|HUR)_', value):
        return 'Stanton'
    return ''


def target_name(value):
    """Translate only observed navigation codes; a target is never an arrival."""
    station = re.fullmatch(r'LOC_RR_S([1-4])_(L[1-5])', value)
    if station:
        return f"RR_{('HUR', 'CRU', 'ARC', 'MIC')[int(station[1]) - 1]}_{station[2]}"
    return value[:-4] if value.endswith('_LOC') else value


class LogLocation:
    def __init__(self):
        self.value = None
        self.previous = ''
        self.kind = 'unknown'
        self.system = ''
        self.near = ''
        self.destination = ''
        self.destination_ship = ''
        self.landing_id = ''
        self.location_id = ''
        self.names = {}
        self.at = ''

    def context(self):
        return {'kind': self.kind, 'system': self.system, 'near': self.near,
                'destination': self.destination, 'previous': self.previous, 'at': self.at}

    def observe(self, value, kind, at, *, system='', near=''):
        before = (self.value, self.kind, self.system, self.near)
        self.value, self.kind, self.near = value or None, kind, near
        if system:
            self.system = system
        if value and kind == 'place':
            self.previous = value
        changed = before != (self.value, self.kind, self.system, self.near)
        if changed:
            self.at = at
        return changed

    def feed(self, line, at, player, ship):
        inventory = INVENTORY.search(line)
        if inventory and (not player or inventory[1] == player):
            if self.landing_id == '0':
                return False  # A delayed inventory request cannot undo departure.
            name = inventory[2]
            # A nested location may be a shared region. Bind only the landing
            # ID when present, never turn that shared region into a station.
            binding = self.landing_id
            if binding and binding != '0':
                self.names[binding] = name
            self.observe(name, 'place', at, system=system_for(name))
            self.at = at
            return True
        moved = MOVED.search(line)
        if moved and (not player or moved[1] == player):
            self.landing_id, self.location_id = moved[2], moved[3]
            landing = self.names.get(self.landing_id) if self.landing_id != '0' else None
            if landing:
                return self.observe(landing, 'place', at, system=system_for(landing))
            region = REGIONS.get(self.location_id)
            if region and (region[0] != 'space' or self.landing_id == '0'):
                kind, value, near = region
                return self.observe(value, kind, at, system='Stanton', near=near)
            # An unrecognised landing ID cannot inherit the previous station.
            name = self.names.get(self.location_id) if self.landing_id != '0' else None
            return self.observe(name, 'place' if name else 'travel' if self.previous or self.system else 'unknown', at)
        entity = ENTITY.search(line) if '[QuantumTravel]' in line else None
        if not entity or not ship or ship.get('entityId') != entity[2]:
            return False
        if '<Player Selected Quantum Target - Local>' in line:
            target = re.search(r'Player has selected point (\S+) as their destination', line)
            if target:
                self.destination = target_name(target[1])
                self.destination_ship = entity[2]
        elif '<Quantum Drive Arrived - Arrived at Final Destination>' in line:
            if self.destination_ship == entity[2]:
                self.clear_destination()
        # Calculate Route / projected start / fuel requests are deliberately
        # excluded: they do not prove movement, quantum engagement or arrival.
        return False

    def clear_destination(self):
        self.destination = self.destination_ship = ''
