'use strict';
// SQLite via Node's built-in driver: one file on the data volume. Back it up by copying it.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const MAIN = path.join(DATA_DIR, 'browserquiz.db');
// A backup the admin restored (backups.js stage): it replaces the database before it's opened.
if (fs.existsSync(path.join(DATA_DIR, 'restore.db'))) {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(MAIN + ext, { force: true });
  fs.renameSync(path.join(DATA_DIR, 'restore.db'), MAIN);
  console.log('Restored a backup.');
}
const db = new DatabaseSync(MAIN);

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
addColumn('attempts', 'mark', 'TEXT'); // the code its screen shows, sealed (people.js)
// Extra time for one student (an accommodation): their time limit is multiplied by this on every quiz.
addColumn('roster_students', 'time_x', 'REAL NOT NULL DEFAULT 1');
// When the teacher paused the quiz (pause.js); null while it runs.
addColumn('runs', 'paused_at', 'INTEGER');
// The quiz's newest version, on the versions before it (editing saves a new copy, teacher/library.js saveQuiz):
// a fixed answer can then reach runs given with an older one (rekey.js).
addColumn('quizzes', 'replaced_by', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS quizzes_replaced_by ON quizzes(replaced_by)');
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
// Settings (teacher/settings.js): the time zone dates are shown in (an IANA name, null: the browser's), and
// what Give a quiz starts with (JSON: mode, ipLock, sebMute, sebKey).
addColumn('teachers', 'tz', 'TEXT');
addColumn('teachers', 'defaults', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes(owner_id);
CREATE INDEX IF NOT EXISTS rosters_owner ON rosters(owner_id);
CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner_id);`);
// Every student request finds its attempt by the cookie's hash (store.attemptByToken): without this, each
// heartbeat reads the whole attempts table, which grows with every quiz ever given.
db.exec('CREATE INDEX IF NOT EXISTS attempts_token ON attempts(token_hash)');
// A student's past attempts, by their student ID's hash: sign-in and start look for a new network there
// (student.js noteNewNetwork), and the class page asks which students have results.
db.exec(`CREATE INDEX IF NOT EXISTS attempts_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS roster_students_sid ON roster_students(sid_hash);`);
// An attempt's typing replay (teacher/attempts.js replay). Deleting a run deletes its attempts' replays too
// (ON DELETE CASCADE), which without this read the whole table once for every attempt.
db.exec('CREATE INDEX IF NOT EXISTS code_edits_attempt ON code_edits(attempt_id)');
// A quiz's runs: the home page asks of each quiz whether it was practiced (teacher/quizzes.js overview),
// which without this read the whole attempts table once per quiz, everyone's.
db.exec('CREATE INDEX IF NOT EXISTS runs_quiz ON runs(quiz_id)');

const cache = new Map();
function q(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
// Inside another transaction it joins that one: SQLite can't nest them. Directly inside txGroup's work it's a
// savepoint instead, so it still takes back only its own writes when it throws, as it does on its own.
let groupDepth = -1; // in txGroup's work: how many tx() calls deep (-1: not in it)
function tx(fn) {
  if (groupDepth === 0) {
    groupDepth++;
    db.exec('SAVEPOINT tx');
    try {
      const r = fn();
      db.exec('RELEASE tx');
      return r;
    } catch (e) {
      if (db.isTransaction) { db.exec('ROLLBACK TO tx'); db.exec('RELEASE tx'); }
      throw e;
    } finally {
      groupDepth--;
    }
  }
  if (db.isTransaction) return fn();
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

// Writes that come in together go to disk together. Every commit waits for the disk (synchronous = FULL), and
// with heartbeats from a thousand students that waiting was most of what the server did: each one's own
// commit. txGroup(fn) runs fn at the end of this turn of the event loop, in one transaction with every other
// fn that came in during it, and settles once that transaction is committed, so nobody hears back before
// their writes are on disk. Inside fn everything works as it does on its own: a tx() takes back only its own
// writes if it throws, and a write outside one is kept even when fn throws afterwards.
const grouped = [];
function txGroup(fn) {
  return new Promise((resolve, reject) => {
    if (!grouped.length) setImmediate(commitGroup);
    grouped.push({ fn, resolve, reject });
  });
}
// (if BEGIN itself fails, each write commits on its own, as without groups)
const begin = () => { try { db.exec('BEGIN'); return true; } catch (e) { return false; } };
const settle = (done) => { for (const d of done) if (d.failed) d.w.reject(d.error); else d.w.resolve(d.value); };
function commitGroup() {
  const work = grouped.splice(0);
  let done = []; // { w, value } or { w, failed, error }: what each caller hears once it's committed
  let open = begin();
  for (const w of work) {
    const d = { w };
    groupDepth = 0;
    try { d.value = w.fn(); } catch (e) { d.failed = true; d.error = e; } finally { groupDepth = -1; }
    done.push(d);
    // An error that ended the whole transaction (SQLite takes it all back on a full disk, say): what came
    // before it wasn't written either, so those callers hear so too; the rest go on in a new transaction.
    if (open && !db.isTransaction) {
      for (const p of done) if (!p.failed) Object.assign(p, { failed: true, error: new Error('The write to disk failed.') });
      settle(done);
      done = [];
      open = begin();
    }
  }
  if (open) {
    try {
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* already gone */ }
      for (const d of done) if (!d.failed) Object.assign(d, { failed: true, error: e });
    }
  }
  settle(done);
}

module.exports = { db, q, tx, txGroup, DATA_DIR };
