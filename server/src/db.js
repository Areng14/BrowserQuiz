'use strict';
// SQLite via Node's built-in driver: one file on the data volume. Back it up by copying it.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'browserquiz.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, path TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL,
  PRIMARY KEY (quiz_id, path)
);
CREATE TABLE IF NOT EXISTS rosters (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS roster_students (
  id TEXT PRIMARY KEY, roster_id TEXT NOT NULL REFERENCES rosters(id) ON DELETE CASCADE, name TEXT NOT NULL, sid_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS roster_students_roster ON roster_students(roster_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id), roster_id TEXT NOT NULL REFERENCES rosters(id),
  code TEXT NOT NULL, status TEXT NOT NULL, ip_lock TEXT, released INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_code ON runs(code);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, student_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, status TEXT NOT NULL, integrity TEXT NOT NULL DEFAULT 'clean',
  strikes INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0, reason TEXT, invalidated_at INTEGER,
  started_at INTEGER, deadline INTEGER, submitted_at INTEGER, last_beat INTEGER,
  layout TEXT, answers TEXT, result TEXT, ip TEXT, user_agent TEXT, edits INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_run ON attempts(run_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  t INTEGER NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS events_attempt ON events(attempt_id);
CREATE TABLE IF NOT EXISTS mouse (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, t INTEGER NOT NULL, points TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mouse_attempt ON mouse(attempt_id);
CREATE TABLE IF NOT EXISTS code_edits (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, t INTEGER NOT NULL, deltas TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS failed_ids (
  run_id TEXT NOT NULL, student_id TEXT NOT NULL, n INTEGER NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (run_id, student_id)
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, action TEXT NOT NULL, attempt_id TEXT, note TEXT
);
`);

const cache = new Map();
function q(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, q, tx, DATA_DIR };
