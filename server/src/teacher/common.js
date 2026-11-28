'use strict';
// What every teacher route uses: who's asking (requireTeacher), finding their own runs, attempts and
// classes, join codes, and a student's row in the live table.

const { q, tx } = require('../db');
const V = require('../vault');
const AI = require('../aigrade');
const { cookies, HttpError, sha256, isHttps } = require('../http');
const store = require('../store');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const Pause = require('../pause');
const { totals } = require('../grade');
const W = require('../watch');
const Parts = require('../parts');
const C = require('../corrections');

// AI grading in progress, per run: { total, graded, failed, errors, running }. One at a time per run.
const aiJobs = new Map();
// The key AI grading uses for this teacher, and whose it is (Anthropic, OpenAI or Google): their own
// (sealed in the database with their quiz key, so it reads only while they're signed in), or else the
// server's. Never sent back to the browser.
const aiKeyAad = (id) => `aikey:${id}`;
function aiKeyOf(me) {
  const row = q('SELECT ai_key FROM teachers WHERE id = ?').get(me.id);
  if (row && row.ai_key) {
    try {
      const key = V.openText(V.needKey(me.id), row.ai_key, aiKeyAad(me.id));
      const provider = AI.providerOf(key);
      if (provider) return { key, provider, mine: true };
    } catch (e) { /* unreadable: treat as none */ }
  }
  const sk = AI.serverKey();
  return sk ? { ...sk, mine: false } : null;
}
const keyHint = (k) => `…${String(k).slice(-4)}`;
// What the dialog shows about the keys: whose, and the last four of the teacher's own.
function keyState(me) {
  const k = aiKeyOf(me);
  const sk = AI.serverKey();
  const P = (id) => AI.PROVIDERS[id];
  return {
    mine: !!(k && k.mine), hint: k && k.mine ? keyHint(k.key) : null,
    name: k ? P(k.provider).name : null, company: k ? P(k.provider).company : null,
    server: sk ? P(sk.provider).company : null,
  };
}
const keyChecks = new Map(); // teacher id -> times they had a key checked

const TCH = 'tch';
const SESSION_MS = 12 * 3600 * 1000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LET_IN_MS = 10 * 60000; // how long "Let back in" stays open

// The signed-in teacher, or 401. Someone on a temporary password can only set their own (opts.setup).
function requireTeacher(req, opts = {}) {
  const tok = cookies(req)[TCH];
  if (!tok) throw new HttpError(401, 'login');
  const row = q(`SELECT s.created_at, s.passkey, t.id, t.username, t.name, t.role, t.disabled, t.must_change FROM sessions s
    JOIN teachers t ON t.id = s.teacher_id WHERE s.token_hash = ?`).get(sha256(tok));
  if (!row || row.disabled || Date.now() - row.created_at > SESSION_MS) throw new HttpError(401, 'login');
  if (row.must_change && !opts.setup) throw new HttpError(403, 'must_change');
  // Signed in before the server restarted: their quiz key is gone from memory, so sign in again to unlock.
  if (!row.must_change && !V.keyFor(row.id)) throw new HttpError(401, 'login');
  return row;
}
function requireAdmin(req) {
  const me = requireTeacher(req);
  if (me.role !== 'admin') throw new HttpError(404, 'not_found');
  return me;
}

function audit(me, action, attemptId, note) {
  q('INSERT INTO audit (t, action, attempt_id, note, teacher_id) VALUES (?, ?, ?, ?, ?)').run(Date.now(), action, attemptId || null, note ? String(note).slice(0, 300) : null, me ? me.id : null);
}

// A teacher who lost both their password and recovery code starts over: their quizzes can't be opened
// by anyone, so they go, with the runs and results that used them.
function dropQuizzes(me) {
  for (const x of q('SELECT a.id FROM attempts a JOIN runs r ON r.id = a.run_id WHERE r.owner_id = ?').all(me.id)) store.forget(x.id);
  tx(() => {
    q('DELETE FROM failed_ids WHERE run_id IN (SELECT id FROM runs WHERE owner_id = ?)').run(me.id);
    q('DELETE FROM runs WHERE owner_id = ?').run(me.id);
    q('DELETE FROM quizzes WHERE owner_id = ?').run(me.id);
    q('DELETE FROM rosters WHERE owner_id = ?').run(me.id); // their students' names were sealed with it too
    q('UPDATE teachers SET ai_key = NULL WHERE id = ?').run(me.id); // sealed with the key that's gone
  });
  store.quizCache.clear();
}

// Everything below is looked up through its owner: another teacher's id is simply not found.
function getRun(me, id) {
  const run = q('SELECT * FROM runs WHERE id = ? AND owner_id = ?').get(String(id || ''), me.id);
  if (!run) throw new HttpError(404, 'not_found');
  return run;
}
function getAttemptRun(me, id) {
  const a = store.getAttempt(String(id || ''));
  const run = a && q('SELECT * FROM runs WHERE id = ? AND owner_id = ?').get(a.runId, me.id);
  if (!run) throw new HttpError(404, 'not_found');
  return { a, run };
}
function getRoster(me, id, includeArchived) {
  const roster = q(`SELECT id, name FROM rosters WHERE id = ? AND owner_id = ?${includeArchived ? '' : ' AND archived = 0'}`).get(String(id || ''), me.id);
  if (!roster) throw new HttpError(404, 'not_found');
  return roster;
}

function newJoinCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!q("SELECT 1 FROM runs WHERE code = ? AND status = 'open'").get(code)) return code;
  }
  throw new Error('could not make a join code');
}

// Minimal CSV: header row with name and student_id (any order, case-insensitive), quoted fields allowed.
// sep: what's between fields, a comma unless said.
function parseCsv(text, sep = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// Where students join: the teacher's own address, unless it only works on this computer (localhost). Then
// it's this computer's address on the network, with the same port: HOST_LAN_IP, which setup.sh and
// setup.ps1 pass in, or one found here when not in Docker (a container only knows its own addresses).
// STUDENT_URL overrides it all. null: on localhost with no network address known.
function joinOrigin(req) {
  const set = String(process.env.STUDENT_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/.test(set)) return set;
  const proto = isHttps(req) ? 'https' : 'http';
  const host = String(req.headers.host || '');
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::(\d{1,5}))?$/i.exec(host);
  if (!local) return /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/.test(host) ? `${proto}://${host}` : null;
  const ip = lanIp();
  return ip ? `${proto}://${ip}${local[2] ? ':' + local[2] : ''}` : null;
}
function lanIp() {
  const given = String(process.env.HOST_LAN_IP || '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(given) && !given.startsWith('127.')) return given;
  if (fs.existsSync('/.dockerenv')) return null;
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}


// What a working student is doing (student.js sets the times on each heartbeat): working, if they answered
// or typed code in the last 30 seconds; reading, if they moved the mouse or pressed a key in the last 2
// minutes; idle otherwise.
function activity(a, now) {
  if (now - (a.workedAt || 0) < 30000) return 'working';
  return now - (a.activeAt || a.startedAt || 0) < 120000 ? 'reading' : 'idle';
}
// More time for one student: their clock, and with timed parts the part they're on and every one after it.
function addTime(a, mins, run) {
  if (a.status !== 'active' || !a.deadline) return false;
  const now = Pause.clock(a, run.paused_at); // paused: their clock is held, so it's from where it stopped
  a.deadline = Math.max(a.deadline, now) + mins * 60000;
  const ends = a.layout && Array.isArray(a.layout.partEnds) ? a.layout.partEnds : null;
  if (ends) {
    // timed parts: the part they're on gets the time, and every part after it moves along
    let at = ends.findIndex((e) => e > now);
    if (at < 0) at = ends.length - 1; // all over (not turned in yet): the last one
    a.layout.partEnds = ends.map((e, k) => (k < at ? e : (k === at ? Math.max(e, now) : e) + mins * 60000));
    a.deadline = a.layout.partEnds[a.layout.partEnds.length - 1];
  }
  store.logEvent(a, 'extend', 'info', `+${mins} min`);
  store.save(a);
  return true;
}
// The end of the clock that's running: the current part's, with timed parts, or else the quiz's.
function partEnd(a, now) {
  const ends = a.layout && Array.isArray(a.layout.partEnds) ? a.layout.partEnds : null;
  return (ends && ends.find((e) => e > now)) || a.deadline;
}
function liveRow(student, a, quiz, run) {
  const clk = a ? Pause.clock(a, run.paused_at) : 0; // their clock: held while the quiz is paused
  const timeX = student.time_x && student.time_x !== 1 ? student.time_x : undefined; // extra time
  if (!a) return { rosterId: student.id, name: student.name, timeX, attempt: null };
  const t = totals(a.result, quiz, a.answers, a.layout);
  // Corrections start with the exam's answers filled in: there, a question counts once it's been changed.
  const start = a.layout && a.layout.startAnswers;
  const answered = a.answers ? Object.keys(a.answers).filter((k) => !k.includes('~') && (!start || JSON.stringify(a.answers[k]) !== start[k])).length : 0; // not corrections' notes
  // Where they are right now (watch.js has their last heartbeat's screen): question 4 in their own order,
  // the review page, or a part's directions.
  const v = a.status === 'active' ? W.where(a.id) : null;
  const order = a.layout && Array.isArray(a.layout.order) ? a.layout.order : [];
  const on = !v ? null : v.review ? 'review' : v.dir ? 'directions' : order.indexOf(v.q) + 1 || null;
  return {
    rosterId: student.id,
    name: student.name,
    timeX,
    attempt: {
      id: a.id, status: a.status, ready: !!a.readyAt, integrity: a.integrity, strikes: a.strikes, warnings: a.warnings,
      awayMs: (a.awayMs || 0) + store.awayNow(a, Date.now()), awayNow: store.awayNow(a, Date.now()) || null,
      leftAgain: a.integrity === 'restored' && a.restoreStrikes != null ? Math.max(0, a.strikes - a.restoreStrikes) : 0,
      reason: a.reason, invalidatedAt: a.invalidatedAt, lastBeatAgo: a.status === 'active' && a.lastBeat ? Date.now() - a.lastBeat : null,
      // Before the quiz: how long since their rules or waiting screen last checked in (closed the browser,
      // quit Safe Exam Browser). Unknown (null) until it has, say after a restart.
      seenAgo: (a.status === 'waiting' || a.status === 'admitted') && (a.seenAt || a.lastBeat) ? Date.now() - Math.max(a.seenAt || 0, a.lastBeat || 0) : null,
      answered, total: a.layout ? store.quizFor(quiz, a.layout).questions.length : store.perStudent(quiz).count, on, deadline: a.deadline,
      activity: a.status === 'active' ? activity(a, Date.now()) : null,
      timeLeft: a.status === 'active' && a.deadline ? Math.max(0, partEnd(a, clk) - clk) : null,
      parts: Parts.liveParts(quiz, a, clk), // timed parts: each one's size and answered, and the one they're on
      letIn: !!(a.letIn && Date.now() - a.letIn < LET_IN_MS),
      score: t && !sealed(run) ? (a.integrity === 'invalidated' ? 0 : t.score) : null, rawScore: t && !sealed(run) ? t.score : null, max: t && !sealed(run) ? t.max : null,
      pending: t && !sealed(run) ? t.pending : 0, failed: t && !sealed(run) ? t.failed : 0, review: t && !sealed(run) ? t.review : 0,
      // corrections: the exam score, what corrections add, and the total (the teacher's view only)
      corrections: run && run.corrects && a.status === 'submitted' ? C.standing(quiz, run, a) : undefined,
    },
  };
}


// An exam still open is proctoring only: no answers, scores, replays or reports for the teacher until
// it's closed, so nothing on the teacher's screen can be read over their shoulder. Practice and
// corrections aren't sealed.
const sealed = (run) => !!run && run.mode !== 'practice' && run.status === 'open';
const notWhileOpen = (run) => { if (sealed(run)) throw new HttpError(409, 'quiz_open', 'Answers and results show once the quiz is closed.'); };

module.exports = { SESSION_MS, TCH, addTime, aiJobs, aiKeyAad, aiKeyOf, audit, dropQuizzes, getAttemptRun, getRoster, getRun, joinOrigin, keyChecks, keyState, liveRow, newJoinCode, notWhileOpen, parseCsv, partEnd, requireAdmin, requireTeacher, sealed };
