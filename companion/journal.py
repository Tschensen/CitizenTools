"""Durable, paged session journal. Never acknowledges or applies planner events."""
import json
import hashlib


def init_store(connection):
    connection.execute('CREATE TABLE IF NOT EXISTS log_sessions (id TEXT PRIMARY KEY, started TEXT NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS log_journal (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE INDEX IF NOT EXISTS log_sessions_started ON log_sessions(started DESC)')
    connection.execute('CREATE INDEX IF NOT EXISTS log_journal_session_at ON log_journal(session_id, at)')
    connection.execute('CREATE TABLE IF NOT EXISTS log_blueprints (id TEXT PRIMARY KEY, channel TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, at TEXT NOT NULL)')


def save(connection, sessions, entries):
    connection.executemany('INSERT INTO log_sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [(s['id'], s['startedAt'], json.dumps(s, ensure_ascii=False)) for s in sessions])
    connection.executemany('INSERT INTO log_journal VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [(e['id'], e['sessionId'], e['at'], json.dumps({k:v for k,v in e.items() if k != 'candidateEstimate'}, ensure_ascii=False)) for e in entries])
    for entry in entries:
        if entry['kind'] != 'blueprint':
            continue
        channel, player, name, at = entry['channel'], entry['player'], entry['name'], entry['at']
        identity = hashlib.sha256(json.dumps([channel, player.casefold(), name.casefold(), at]).encode()).hexdigest()
        connection.execute('INSERT OR IGNORE INTO log_blueprints VALUES(?,?,?,?,?,?)',
                           (identity, channel, player, name, name.casefold(), at))


def blueprints(connection):
    rows = connection.execute('SELECT channel, player, MAX(name), MIN(at), MAX(at), COUNT(*) FROM log_blueprints GROUP BY channel, lower(player), name_key ORDER BY MAX(at) DESC LIMIT 1001').fetchall()
    return {'ok':True, 'blueprints':[dict(zip(('channel','player','name','firstAt','lastAt','observations'), row)) for row in rows[:1000]],
            'truncated':len(rows)>1000}


def read(connection, session_id='', before=''):
    rows = connection.execute('SELECT payload FROM log_sessions WHERE (? = \'\' OR started < ?) ORDER BY started DESC LIMIT 31', (before,before)).fetchall()
    sessions = [json.loads(row[0]) for row in rows[:30]]
    selected = session_id or (sessions[0]['id'] if sessions else '')
    session = connection.execute('SELECT payload FROM log_sessions WHERE id=?', (selected,)).fetchone()
    entries = connection.execute('SELECT payload FROM log_journal WHERE session_id=? ORDER BY at,id LIMIT 2001', (selected,)).fetchall()
    return {'ok':True, 'sessions':sessions, 'session':json.loads(session[0]) if session else None,
            'entries':[json.loads(row[0]) for row in entries[:2000]], 'truncated':len(entries)>2000,
            'nextBefore':sessions[-1]['startedAt'] if len(rows)>30 else ''}
