'use strict';
// Student data at rest is sealed with its teacher's key, like quizzes (vault.js): names, answers, results,
// network addresses and browsers, event details and typing replays. A copy of the database (or a backup)
// shows ids, times and counts, not who anyone is or what they wrote.
//
// A value without the v1: prefix is from before this (or was saved while its teacher's key was locked):
// it reads as it is, and the teacher's next sign-in seals it (sealPeople).
const V = require('./vault');
const { db, q, tx } = require('./db');

// Whose key: a class (roster) or a quiz run belongs to one teacher, for good.
const rosterOwners = new Map();
const runOwners = new Map();
function ownerOf(map, table, id) {
  id = String(id || '');
  if (!map.has(id)) {
    const r = q(`SELECT owner_id FROM ${table} WHERE id = ?`).get(id);
    if (!r) return null;
    if (map.size > 20000) map.clear();
    map.set(id, r.owner_id);
  }
  return map.get(id);
}
const ownerOfRoster = (id) => ownerOf(rosterOwners, 'rosters', id);
const ownerOfRun = (id) => ownerOf(runOwners, 'runs', id);

const isSealed = (s) => typeof s === 'string' && s.startsWith('v1:');
// What each sealed value belongs to, so one can't be swapped for another.
const nameAad = (studentId) => `name:${studentId}`;
const attAad = (attemptId, field) => `attempt:${attemptId}:${field}`;
const eventAad = (attemptId) => `event:${attemptId}`;
const editAad = (attemptId) => `edit:${attemptId}`;

// Sealed when the owner's key is in memory; otherwise kept as it is, for their next sign-in to seal.
function seal(owner, aad, text) {
  if (text == null) return null;
  const k = V.keyFor(owner);
  return k ? V.sealText(k, String(text), aad) : String(text);
}
// Opened with the owner's key: "locked" when it isn't in memory (their teacher signs in to unlock it).
function open(owner, aad, s) {
  if (!isSealed(s)) return s;
  return V.openText(V.needKey(owner), s, aad);
}
// The same, but nothing rather than an error (a list can still show the rest).
function tryOpen(owner, aad, s) {
  try { return open(owner, aad, s); } catch (e) { return null; }
}

// In SQL, bq_name(name, id, roster_id) is the student's name (null while their teacher's key is locked),
// so lookups can still sort and filter by it.
db.function('bq_name', (name, id, rosterId) => (isSealed(name) ? tryOpen(ownerOfRoster(rosterId), nameAad(id), name) : name));

const sealName = (owner, studentId, name) => seal(owner, nameAad(studentId), name);
const sealField = (runId, attemptId, field, text) => seal(ownerOfRun(runId), attAad(attemptId, field), text);
const openField = (runId, attemptId, field, s) => open(ownerOfRun(runId), attAad(attemptId, field), s);
const tryField = (runId, attemptId, field, s) => tryOpen(ownerOfRun(runId), attAad(attemptId, field), s);
const sealEvent = (runId, attemptId, detail) => seal(ownerOfRun(runId), eventAad(attemptId), detail);
const openEvent = (runId, attemptId, s) => tryOpen(ownerOfRun(runId), eventAad(attemptId), s);
const sealEdits = (runId, attemptId, text) => seal(ownerOfRun(runId), editAad(attemptId), text);
const openEdits = (runId, attemptId, s) => tryOpen(ownerOfRun(runId), editAad(attemptId), s);

const ATTEMPT_FIELDS = ['answers', 'result', 'ip', 'user_agent', 'pin_ip'];

// Everything of a teacher's still in the clear gets sealed: data from before this, or saved while their
// key was locked. Then the write-ahead log is flushed, so the plain copies leave the database files too.
// With from/to keys (admin leaving the .env key), what's sealed moves from one key to the other instead.
function sealPeople(owner, from, to) {
  const k = to || V.keyFor(owner);
  if (!k) return 0;
  const redo = (s, aad) => {
    if (s == null) return null;
    if (!isSealed(s)) return V.sealText(k, s, aad);
    if (!from) return null; // sealed already
    try { return V.sealText(k, V.openText(from, s, aad), aad); } catch (e) { return null; } // not under the old key
  };
  const plain = (col) => (from ? `${col} IS NOT NULL` : `${col} NOT LIKE 'v1:%'`);
  let n = 0;
  tx(() => {
    for (const s of q(`SELECT s.id, s.name FROM roster_students s JOIN rosters r ON r.id = s.roster_id WHERE r.owner_id = ? AND ${plain('s.name')}`).all(owner)) {
      const v = redo(s.name, nameAad(s.id));
      if (v) { q('UPDATE roster_students SET name = ? WHERE id = ?').run(v, s.id); n++; }
    }
    const any = ATTEMPT_FIELDS.map((f) => plain(`a.${f}`)).join(' OR ');
    for (const a of q(`SELECT a.id, ${ATTEMPT_FIELDS.map((f) => 'a.' + f).join(', ')} FROM attempts a JOIN runs r ON r.id = a.run_id WHERE r.owner_id = ? AND (${any})`).all(owner)) {
      const set = [];
      for (const f of ATTEMPT_FIELDS) { const v = redo(a[f], attAad(a.id, f)); if (v) set.push([f, v]); }
      if (set.length) { q(`UPDATE attempts SET ${set.map(([f]) => f + ' = ?').join(', ')} WHERE id = ?`).run(...set.map(([, v]) => v), a.id); n++; }
    }
    for (const e of q(`SELECT e.id, e.attempt_id, e.detail FROM events e JOIN attempts a ON a.id = e.attempt_id JOIN runs r ON r.id = a.run_id
      WHERE r.owner_id = ? AND e.detail IS NOT NULL AND ${plain('e.detail')}`).all(owner)) {
      const v = redo(e.detail, eventAad(e.attempt_id));
      if (v) { q('UPDATE events SET detail = ? WHERE id = ?').run(v, e.id); n++; }
    }
    for (const c of q(`SELECT c.rowid AS rid, c.attempt_id, c.deltas FROM code_edits c JOIN attempts a ON a.id = c.attempt_id JOIN runs r ON r.id = a.run_id
      WHERE r.owner_id = ? AND ${plain('c.deltas')}`).all(owner)) {
      const v = redo(c.deltas, editAad(c.attempt_id));
      if (v) { q('UPDATE code_edits SET deltas = ? WHERE rowid = ?').run(v, c.rid); n++; }
    }
  });
  if (n) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return n;
}

module.exports = {
  isSealed, ownerOfRun, ownerOfRoster, sealName, sealField, openField, tryField, sealEvent, openEvent, sealEdits, openEdits, sealPeople,
};
