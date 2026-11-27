'use strict';
// Backups of the database, in backups/ on the data volume: every night (around 2:00 in the admin's time zone,
// never while students are in a quiz), the newest 7 kept, and whenever the admin asks (their Server page). A
// backup is the whole database as one SQLite file, made with VACUUM INTO, which is consistent while the
// server runs. Everything in it is as sealed as in the database itself (vault.js, people.js); restoring one on
// another server also needs that server's ID_PEPPER (.env), or rosters don't match.
//
// Restoring: the backup is checked, the current state is backed up (before-restore), and the backup is put
// beside the database as restore.db. The server then stops, and Docker or Railway starts it again; db.js puts
// restore.db in place before it opens the database.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db, q, DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'backups');
const STAGED = path.join(DATA_DIR, 'restore.db');
const NAME = /^browserquiz-(\d{4}-\d{2}-\d{2}-\d{4})-(nightly|manual|before-restore)\.db$/;
const KEEP = { nightly: 7, manual: 3, 'before-restore': 3 };
const TABLES = ['quizzes', 'rosters', 'runs', 'attempts', 'teachers'];

// Students in a quiz right now: signed in and sending heartbeats, or in a quiz the teacher paused. (A deploy,
// a restore and a nightly backup all wait for this to be false.)
function quizInProgress() {
  return q(`SELECT COUNT(*) AS n FROM attempts a JOIN runs r ON r.id = a.run_id
    WHERE r.status = 'open' AND r.mode != 'practice' AND a.archived = 0 AND a.status IN ('waiting', 'admitted', 'active')
    AND (a.last_beat > ? OR (r.paused_at IS NOT NULL AND a.status = 'active'))`).get(Date.now() - 90000).n > 0;
}

// -> [{ name, kind, at, bytes }], newest first
function list() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return []; }
  return names.map((n) => {
    const m = NAME.exec(n);
    if (!m) return null;
    try { const st = fs.statSync(path.join(DIR, n)); return { name: n, kind: m[2], at: Math.round(st.mtimeMs), bytes: st.size }; } catch (e) { return null; }
  }).filter(Boolean).sort((a, b) => b.at - a.at);
}
// A backup's file, from its name as list() gives it (anything else: null)
function fileOf(name) {
  if (typeof name !== 'string' || !NAME.test(name)) return null;
  const f = path.join(DIR, name);
  return fs.existsSync(f) ? f : null;
}
function prune() {
  const seen = {};
  for (const b of list()) {
    seen[b.kind] = (seen[b.kind] || 0) + 1;
    if (seen[b.kind] > KEEP[b.kind]) fs.rmSync(path.join(DIR, b.name), { force: true });
  }
}
// kind: nightly, manual or before-restore -> its name
function make(kind) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const name = `browserquiz-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')}-${kind}.db`;
  const file = path.join(DIR, name);
  fs.rmSync(file, { force: true }); // two in the same minute: the newer one
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune();
  return name;
}

// Is this file a BrowserQuiz database? Throws with what's wrong.
function check(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1') !== 'SQLite format 3\u0000') throw new Error("That isn't a BrowserQuiz backup.");
  let other;
  try {
    other = new DatabaseSync(file, { readOnly: true });
    const have = new Set(other.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (TABLES.some((t) => !have.has(t))) throw new Error("That isn't a BrowserQuiz backup.");
    if (other.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('That backup is damaged.');
  } catch (e) {
    throw new Error(/backup/.test(e.message) ? e.message : "That isn't a BrowserQuiz backup.");
  } finally {
    if (other) other.close();
  }
}
// Put a checked backup file in place for the next start (moving it when it's a temporary upload). It's set
// aside before the before-restore backup is made, which can replace it (a before-restore one restored in the
// same minute has its name) or prune it (the oldest of its kind).
function stage(file, move) {
  check(file);
  const next = STAGED + '.part';
  try {
    if (move) fs.renameSync(file, next);
    else fs.copyFileSync(file, next);
    make('before-restore');
    fs.renameSync(next, STAGED);
  } catch (e) {
    fs.rmSync(next, { force: true });
    throw e;
  }
}

// Every 10 minutes: a nightly backup if one is due. Due: none yet, or the last is 20+ hours old and it's night
// (1:00 to 5:00) where the admin is, or it's 36+ hours old (a server that's off at night).
function nightly() {
  const tick = () => {
    try {
      const last = list().find((b) => b.kind === 'nightly');
      const age = last ? Date.now() - last.at : Infinity;
      const tz = (q("SELECT tz FROM teachers WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() || {}).tz;
      let hour;
      try { hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz || undefined }).format(new Date())); } catch (e) { hour = new Date().getHours(); }
      const due = !last || (age > 20 * 3600e3 && hour >= 1 && hour < 5) || age > 36 * 3600e3;
      if (due && !quizInProgress()) make('nightly');
    } catch (e) { console.error('Nightly backup failed:', e.message); }
  };
  setTimeout(tick, 60e3).unref();
  setInterval(tick, 10 * 60e3).unref();
}

module.exports = { DIR, STAGED, list, fileOf, make, check, stage, nightly, quizInProgress };
