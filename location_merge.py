"""Merge location records and their references in one database transaction."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from server import app as backend


class MergeError(ValueError):
    pass


def remap_references(value, names, target):
    """Change location fields, never matching titles, IDs, notes or raw OCR text."""
    keys = {backend.normalize_location_key(name) for name in names}
    fields = {'pickup', 'dropoff', 'destination', 'location', 'searchArea',
              'currentLocation', 'selectedStopDropoff', 'runPriorityRouteLocation',
              'homeLocation', 'routeHomeLocation'}

    def label(item):
        return target if isinstance(item, str) and backend.normalize_location_key(item) in keys else item

    def point(item):
        if not isinstance(item, str):
            return item
        parts = item.split('|')
        if len(parts) == 4 and backend.normalize_location_key(parts[2]) in keys:
            parts[2] = target.strip().lower()
            return '|'.join(parts)
        return item

    def visit(item, field='', parent=''):
        if isinstance(item, dict):
            if field == 'runHomeDestinations' or (field == 'locations' and parent == 'telemetryLinks'):
                return {key: label(entry) for key, entry in item.items()}
            return {key: visit(entry, key, field) for key, entry in item.items()}
        if isinstance(item, list):
            if field == 'pickups':
                return [label(entry) for entry in item]
            if field == 'runCompletedRoutePoints':
                return list(dict.fromkeys(point(entry) for entry in item))
            return [visit(entry, field, parent) for entry in item]
        if field == 'selectedRunRoutePointKey':
            return point(item)
        return label(item) if field in fields else item

    return visit(value)


def resolve_home_location(connection, name):
    """Stored PC preferences can keep their alias after a database merge."""
    key = backend.normalize_location_key(name)
    records = backend.load_location_match_candidates(connection)
    matches = {entry['name'] for entry in records
               if any(backend.normalize_location_key(term) == key
                      for term in [entry['name'], *entry['aliases']])}
    return next(iter(matches)) if len(matches) == 1 else name


def merge(connection, payload):
    if not isinstance(payload, dict):
        raise MergeError('merge_invalid')
    source_id, target_id = payload.get('sourceId'), payload.get('targetId')
    if not isinstance(source_id, str) or not isinstance(target_id, str) or not source_id or source_id == target_id:
        raise MergeError('merge_invalid')
    source = connection.execute('SELECT * FROM locations WHERE location_id=?', (source_id,)).fetchone()
    target = connection.execute('SELECT * FROM locations WHERE location_id=?', (target_id,)).fetchone()
    if not source or not target:
        raise MergeError('merge_missing')
    if target['status'] != 'active':
        raise MergeError('merge_target_archived')
    if source['updated_at'] != payload.get('sourceUpdatedAt') or target['updated_at'] != payload.get('targetUpdatedAt'):
        raise MergeError('merge_conflict')
    state_row = connection.execute('SELECT value, updated_at FROM app_state WHERE state_key=?', (backend.STATE_KEY,)).fetchone()
    if 'baseUpdatedAt' not in payload or payload['baseUpdatedAt'] != (state_row['updated_at'] if state_row else None):
        raise MergeError('merge_conflict')
    aliases = connection.execute('SELECT location_id, alias FROM location_aliases WHERE location_id IN (?,?)', (source_id, target_id)).fetchall()
    source_names = [source['name'], *[row['alias'] for row in aliases if row['location_id'] == source_id]]
    source_keys = {backend.normalize_location_key(name) for name in source_names}
    # Name references do not contain hierarchy IDs. Refuse an ambiguous merge.
    protected_keys = source_keys | {backend.normalize_location_key(target['name'])}
    for entry in backend.load_location_records(connection):
        if entry['id'] in (source_id, target_id) or entry['status'] != 'active':
            continue
        if protected_keys.intersection(backend.normalize_location_key(name) for name in [entry['name'], *entry['aliases']]):
            raise MergeError('merge_alias_conflict')
    target_name = target['name']
    combined = {}
    for name in [*[row['alias'] for row in aliases if row['location_id'] == target_id], *source_names]:
        key = backend.normalize_location_key(name)
        if key and key != backend.normalize_location_key(target_name):
            combined.setdefault(key, name)
    if len(combined) > 50:
        raise MergeError('merge_alias_limit')
    now = datetime.now(timezone.utc).isoformat()
    backend.replace_location_aliases(connection, target_id, list(combined.values()))
    connection.execute('DELETE FROM location_aliases WHERE location_id=?', (source_id,))
    connection.execute("UPDATE locations SET status='archived', updated_at=? WHERE location_id=?", (now, source_id))
    connection.execute('UPDATE locations SET updated_at=? WHERE location_id=?', (now, target_id))
    # Preserve the source metadata in the archived record; keep the target's
    # classification, except that it must not become its own parent.
    for row in connection.execute('SELECT location_id, parent_location FROM locations').fetchall():
        if row['location_id'] == source_id or backend.normalize_location_key(row['parent_location']) not in source_keys:
            continue
        parent = target_name
        if row['location_id'] == target_id:
            parent = source['parent_location']
            if backend.normalize_location_key(parent) in source_keys | {backend.normalize_location_key(target_name)}:
                parent = ''
        connection.execute('UPDATE locations SET parent_location=?, normalized_parent=?, updated_at=? WHERE location_id=?',
                           (parent, backend.normalize_location_key(parent), now, row['location_id']))
    for row in connection.execute('SELECT state_key, value FROM app_state').fetchall():
        original = json.loads(row['value'])
        updated = remap_references(original, source_names, target_name)
        if updated != original or row['state_key'] == backend.STATE_KEY:
            connection.execute('UPDATE app_state SET value=?, updated_at=? WHERE state_key=?',
                               (json.dumps(updated, ensure_ascii=False), now, row['state_key']))
    for row in connection.execute('SELECT import_id, payload FROM mission_imports').fetchall():
        original = json.loads(row['payload'])
        updated = dict(original)
        if isinstance(original.get('draft'), dict):
            updated['draft'] = remap_references(original['draft'], source_names, target_name)
        if updated != original:
            connection.execute('UPDATE mission_imports SET payload=?, updated_at=? WHERE import_id=?',
                               (json.dumps(updated, ensure_ascii=False), now, row['import_id']))
    backend.write_meta(connection, 'last_state_write_at_solo', now)
    return {'ok': True, 'source': source['name'], 'target': target_name}
