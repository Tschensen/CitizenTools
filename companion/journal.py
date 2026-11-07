"""Durable, paged session journal. Never acknowledges or applies planner events."""
import json


def init_store(connection):
    connection.execute('CREATE TABLE IF NOT EXISTS log_sessions (id TEXT PRIMARY KEY, started TEXT NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS log_journal (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE INDEX IF NOT EXISTS log_sessions_started ON log_sessions(started DESC)')
    connection.execute('CREATE INDEX IF NOT EXISTS log_journal_session_at ON log_journal(session_id, at)')


def save(connection, sessions, entries):
    connection.executemany('INSERT INTO log_sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [(s['id'], s['startedAt'], json.dumps(s, ensure_ascii=False)) for s in sessions])
    connection.executemany('INSERT INTO log_journal VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [(e['id'], e['sessionId'], e['at'], json.dumps({k:v for k,v in e.items() if k != 'candidateEstimate'}, ensure_ascii=False)) for e in entries])


def read(connection, session_id='', before=''):
    rows = connection.execute('SELECT payload FROM log_sessions WHERE (? = \'\' OR started < ?) ORDER BY started DESC LIMIT 31', (before,before)).fetchall()
    sessions = [json.loads(row[0]) for row in rows[:30]]
    selected = session_id or (sessions[0]['id'] if sessions else '')
    session = connection.execute('SELECT payload FROM log_sessions WHERE id=?', (selected,)).fetchone()
    entries = connection.execute('SELECT payload FROM log_journal WHERE session_id=? ORDER BY at,id LIMIT 2001', (selected,)).fetchall()
    return {'ok':True, 'sessions':sessions, 'session':json.loads(session[0]) if session else None,
            'entries':[json.loads(row[0]) for row in entries[:2000]], 'truncated':len(entries)>2000,
            'nextBefore':sessions[-1]['startedAt'] if len(rows)>30 else ''}
