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
PRAGMA secure_delete = ON;
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

// Columns added after the first release. Old data is never deleted when a quiz or class is still used
// by a past run: it's archived (hidden) instead, so old results keep working.
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('quizzes', 'archived', 'INTEGER NOT NULL DEFAULT 0');
addColumn('rosters', 'archived', 'INTEGER NOT NULL DEFAULT 0');
addColumn('roster_students', 'removed', 'INTEGER NOT NULL DEFAULT 0');
addColumn('runs', 'mode', "TEXT NOT NULL DEFAULT 'exam'"); // exam | practice

// Teacher accounts (see accounts.js). Quizzes, classes and runs belong to the teacher who made them.
db.exec(`CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher', disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
addColumn('sessions', 'teacher_id', 'TEXT');
addColumn('quizzes', 'owner_id', 'TEXT');
addColumn('rosters', 'owner_id', 'TEXT');
addColumn('runs', 'owner_id', 'TEXT');
addColumn('audit', 'teacher_id', 'TEXT');
// Quiz encryption (vault.js): each teacher's key, wrapped by their password and by their recovery code.
// enc = 1 marks a quiz's json or an asset's bytes as sealed with the owner's key.
addColumn('teachers', 'key_wrap', 'TEXT');
addColumn('teachers', 'rec_wrap', 'TEXT');
// A teacher's own Anthropic API key for AI grading (aigrade.js), sealed with their quiz key.
addColumn('teachers', 'ai_key', 'TEXT');
addColumn('quizzes', 'enc', 'INTEGER NOT NULL DEFAULT 0');
// Corrections (corrections.js): a practice run for redoing an exam's missed questions. corrects: the exam
// run; earn_back: the share of lost points a right answer earns back (0 to 1); ask_why: a "What went wrong?" box.
addColumn('runs', 'corrects', 'TEXT');
addColumn('runs', 'earn_back', 'REAL NOT NULL DEFAULT 0');
addColumn('runs', 'ask_why', 'INTEGER NOT NULL DEFAULT 0');
addColumn('assets', 'enc', 'INTEGER NOT NULL DEFAULT 0');
addColumn('runs', 'seb_key', 'TEXT'); // Safe Exam Browser Config Key: only SEB with that config can take the quiz
addColumn('runs', 'seb_config', 'TEXT'); // the .seb file BrowserQuiz made for the run (null: the teacher's own)
addColumn('runs', 'seb_quit', 'TEXT'); // the quit password in seb_config, for the teacher
addColumn('runs', 'had_corrections', 'INTEGER'); // an exam that had corrections (answers shown): it can't reopen
addColumn('attempts', 'grading', 'TEXT'); // pending | error | done: where grading is (the result itself is sealed, people.js)
db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)'); // small server-wide facts, e.g. the last ADMIN_RESET used
// How long a student was out of the quiz window, for the teacher to weigh a strike: all together, and
// the longest single time. restore_strikes is the strike count when the teacher restored the attempt.
addColumn('attempts', 'away_ms', 'INTEGER NOT NULL DEFAULT 0');
addColumn('attempts', 'away_max', 'INTEGER NOT NULL DEFAULT 0');
addColumn('attempts', 'restore_strikes', 'INTEGER');
// The network the student started on: the attempt can't be continued from another (student.js current).
addColumn('attempts', 'pin_ip', 'TEXT');
// Time on each question ({ question id: ms }, from heartbeats: what was on screen while the quiz had
// focus), for the class report's too-fast check. device: a hash of the browser's dev cookie, to spot two
// students signing in from the same browser.
addColumn('attempts', 'q_time', 'TEXT');
addColumn('attempts', 'device', 'TEXT');
// When an exam's student agreed to the rules and went into lockdown, waiting for the teacher to start
// (student.js /api/ready). Leaving from then on counts, as in the quiz.
addColumn('attempts', 'ready_at', 'INTEGER');
// Extra time for one student (an accommodation): their time limit is multiplied by this on every quiz.
addColumn('roster_students', 'time_x', 'REAL NOT NULL DEFAULT 1');
// When the teacher paused the quiz (pause.js); null while it runs.
addColumn('runs', 'paused_at', 'INTEGER');
// Passkeys (passkeys.js): id is the credential id, public_key its SPKI DER. key_wrap is the teacher's quiz
// key sealed with what the passkey's PRF gives (vault.js); null for admin while its key comes from .env.
// pk_user is the random user handle a teacher's passkeys carry. A session's passkey flag: it was made
// by one, so its quiz key in memory counts after an admin reset (the temporary password alone doesn't).
db.exec(`CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, key_wrap TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_teacher ON passkeys(teacher_id);`);
addColumn('teachers', 'pk_user', 'TEXT');
addColumn('sessions', 'passkey', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes(owner_id);
CREATE INDEX IF NOT EXISTS rosters_owner ON rosters(owner_id);
CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner_id);`);

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
