"""Local log tailer and durable event inbox, shared by all connected views."""
from __future__ import annotations

import copy
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from shared.game_log import GameLogParser

CHANNELS = ('LIVE', 'PTU', 'EPTU', 'HOTFIX')
DEFAULTS = {'logEnabled': False, 'gameDirectory': '', 'gameChannel': 'LIVE', 'logAutoShip': True,
            'logAutoLocation': True, 'logAutoRoute': True, 'logAutoComplete': False,
            'balanceOcrEnabled': False}


def seconds_since(value):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(value.replace('Z', '+00:00'))).total_seconds()
    except (ValueError, TypeError, AttributeError):
        return float('inf')


def validate_settings(payload):
    result = {}
    for key, default in DEFAULTS.items():
        if key not in payload:
            continue
        value = payload[key]
        if isinstance(default, bool):
            if type(value) is not bool:
                raise ValueError(f'Ungültiger Wert: {key}')
        elif key == 'gameChannel':
            if value not in CHANNELS:
                raise ValueError('Bitte LIVE, PTU, EPTU oder HOTFIX als Spielkanal wählen.')
        else:
            if not isinstance(value, str) or len(value) > 1000:
                raise ValueError('Ungültiger Star-Citizen-Programmordner.')
            value = value.strip().strip('"')
            if value:
                directory = Path(value)
                if not directory.is_absolute() or value.startswith(('\\\\', '//')) or '..' in directory.parts \
                        or directory.suffix.lower() in ('.exe', '.log'):
                    raise ValueError('Bitte den vollständigen lokalen Pfad zum Star-Citizen-Programmordner angeben.')
                if directory.name.upper() in CHANNELS:
                    raise ValueError('Bitte den Programmordner oberhalb von LIVE/PTU wählen und den Spielkanal separat einstellen.')
        result[key] = value
    return result


def configured_log(settings):
    directory = settings.get('gameDirectory', '')
    return Path(directory) / settings.get('gameChannel', 'LIVE') / 'Game.log' if directory else None


def init_store(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')''')


class Telemetry:
    def __init__(self, runtime, connect):
        self.runtime, self.connect = runtime, connect
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.path = None
        self.identity = None
        self.offset = 0
        self.prefix = b''
        self.anchor = b''
        self.fragment = b''
        self.parser = GameLogParser()
        self.error = ''
        self.loading = True
        self.file_mtime = 0.0

    def start(self):
        with self.connect() as connection:
            init_store(connection)
            connection.commit()
        self.thread = threading.Thread(target=self.run, name='GameLog', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception:
                logging.exception('Game.log reader failed')
                with self.lock:
                    self.error = 'read_failed'
            self.stop_event.wait(1)

    def enqueue(self, event):
        with self.connect() as connection:
            connection.execute('INSERT OR IGNORE INTO telemetry_events(id,at,kind,payload) VALUES(?,?,?,?)',
                               (event['id'], event['at'], event['kind'], json.dumps(event, ensure_ascii=False)))
            connection.commit()

    def tick(self):
        settings = dict(self.runtime.settings)
        with self.lock:
            selected = configured_log(settings) if settings.get('logEnabled') else None
            if selected != self.path:
                self.path = selected
                self.identity = None
                self.offset = 0
                self.prefix = self.anchor = self.fragment = b''
                self.parser = GameLogParser()
                self.loading = True
                self.file_mtime = 0.0
            if not settings.get('logEnabled'):
                self.error = ''
                return
            if selected is None:
                self.error = 'directory_required'
                return
            try:
                with selected.open('rb') as source:
                    stat = os.fstat(source.fileno())
                    identity = (str(selected), stat.st_dev, stat.st_ino)
                    prefix = source.read(min(256, self.offset or stat.st_size))
                    source.seek(max(0, self.offset - len(self.anchor)))
                    anchor = source.read(len(self.anchor))
                    replaced = identity != self.identity or stat.st_size < self.offset or (self.prefix and not prefix.startswith(self.prefix)) or anchor != self.anchor
                    if replaced:
                        self.parser = GameLogParser()
                        self.offset = 0
                        self.fragment = b''
                        self.loading = True
                        self.identity = identity
                        self.prefix = prefix
                    self.path = selected
                    self.file_mtime = stat.st_mtime
                    source.seek(self.offset)
                    data = source.read(1024 * 1024)
                    self.offset = source.tell()
                    source.seek(max(0, self.offset - 128))
                    self.anchor = source.read(self.offset - source.tell())
                self.error = ''
            except OSError:
                self.error = 'not_found'
                return
            lines = (self.fragment + data).split(b'\n')
            self.fragment = lines.pop()
            # Discard malformed huge lines without growing memory indefinitely.
            if len(self.fragment) > 65536:
                self.fragment = b''
            new_events = []
            for line in lines:
                for event in self.parser.feed(line.decode('utf-8', errors='replace').rstrip('\r')):
                    if not self.loading and -5 <= seconds_since(event['at']) <= 300:
                        new_events.append(event)
            caught_up = self.offset >= stat.st_size
            if self.loading and caught_up:
                self.loading = False
                # Restore only present ship/location, never historical deliveries.
                if self.parser.connected and -5 <= seconds_since(self.parser.last_at) < 120:
                    if self.parser.ship:
                        new_events.append(self.parser.event('ship', self.parser.last_at, **self.parser.ship))
                    if self.parser.location:
                        new_events.append(self.parser.event('location', self.parser.last_at, value=self.parser.location))
            for event in new_events:
                if event['kind'] in ('accepted', 'objective_text', 'ship_exit', 'disconnected'):
                    continue
                # Semantic objective IDs are stable even when the game repeats
                # the same completed objective with a different timestamp.
                if event['kind'] in ('objective', 'completed'):
                    event['id'] = event['kind'] + ':' + event['missionId'] + ':' + event.get('objectiveId', '')
                self.enqueue(event)

    def snapshot(self):
        with self.lock:
            enabled = self.runtime.settings.get('logEnabled', False)
            fresh = enabled and not self.error and not self.loading and self.parser.connected \
                and -5 <= seconds_since(self.parser.last_at) <= 120 \
                and datetime.now(timezone.utc).timestamp() - self.file_mtime <= 120
            result = {'enabled': enabled, 'live': fresh, 'error': self.error,
                      'path': str(self.path or ''),
                      'player': self.parser.player, 'ship': copy.deepcopy(self.parser.ship),
                      'session': self.parser.session,
                      'location': self.parser.location or '', 'at': self.parser.last_at,
                      'contracts': list(copy.deepcopy(self.parser.contracts).values())[-100:]}
        with self.connect() as connection:
            rows = connection.execute("SELECT payload FROM telemetry_events WHERE status='pending' AND julianday(at) >= julianday('now','-15 minutes') ORDER BY at,id LIMIT 100").fetchall()
            result['events'] = [json.loads(row[0]) for row in rows]
        return result

    def capture_balance(self, tesseract, image_path):
        if not self.runtime.settings.get('balanceOcrEnabled'):
            return False
        from shared.mission_import.balance import read_balance
        from companion.app import hash_file
        captured = datetime.fromtimestamp(image_path.stat().st_mtime, timezone.utc).isoformat()
        if not -5 <= seconds_since(captured) <= 120:
            return False
        handle = self.runtime.settings.get('pilotName') or self.parser.player
        if not handle:
            return False
        result = read_balance(tesseract, image_path, handle)
        if result is None:
            return False
        self.enqueue({'id': 'balance:' + hash_file(image_path), 'kind': 'balance', 'at': captured,
                      'amount': result, 'player': handle, 'sourceFile': image_path.name})
        return True
