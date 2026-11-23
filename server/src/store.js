'use strict';
// Quizzes, runs and attempts. Active attempts live in memory and write through to SQLite.
// The strike rules live here too, so every path (events, heartbeats, the sweeper) scores the same way.
const crypto = require('node:crypto');
const { q } = require('./db');
const V = require('./vault');
const { putVars, normOutput } = require('./quizfile');

// ---------- quizzes ----------
// Quizzes and their images are sealed with their teacher's key (vault.js). Reading one needs that key:
// without it this throws "locked" (503), and the teacher signing in unlocks it.
const quizCache = new Map();
function getQuiz(id) {
  if (quizCache.has(id)) return quizCache.get(id);
  const row = q('SELECT json, enc, owner_id FROM quizzes WHERE id = ?').get(id);
  if (!row) return null;
  const quiz = JSON.parse(row.enc ? V.openText(V.needKey(row.owner_id), row.json, V.quizAad(id)) : row.json);
  quizCache.set(id, quiz);
  return quiz;
}
function plainAsset(quizId, row, ownerId) {
  return { path: row.path, mime: row.mime, bytes: row.enc ? V.open(V.needKey(ownerId), row.bytes, V.assetAad(quizId, row.path)) : Buffer.from(row.bytes) };
}
function getAsset(quizId, path) {
  const row = q('SELECT a.path, a.mime, a.bytes, a.enc, z.owner_id FROM assets a JOIN quizzes z ON z.id = a.quiz_id WHERE a.quiz_id = ? AND a.path = ?').get(quizId, path);
  return row ? plainAsset(quizId, row, row.owner_id) : null;
}
function listAssets(quizId) {
  return q('SELECT a.path, a.mime, a.bytes, a.enc, z.owner_id FROM assets a JOIN quizzes z ON z.id = a.quiz_id WHERE a.quiz_id = ?').all(quizId)
    .map((row) => plainAsset(quizId, row, row.owner_id));
}
// Stored results keep pass/fail and what the student's code returned, not the hidden tests' inputs and
// expected values: those are part of the quiz, which is encrypted.
function storedResult(result) {
  if (!result || !result.code) return result;
  const code = {};
  for (const [id, c] of Object.entries(result.code)) {
    code[id] = Array.isArray(c.tests) ? Object.assign({}, c, { tests: c.tests.map((t) => ({ pass: t.pass, got: t.got, error: t.error })) }) : c;
  }
  return Object.assign({}, result, { code });
}

// ---------- integrity ----------
// Client-reportable event types and how bad they are. Anything else from a client is ignored.
const CLIENT_EVENTS = {
  'blur': 'violation', 'hidden': 'violation', 'fullscreen-exit': 'violation', 'extended-display': 'violation',
  'mouse-left': 'warning', 'copy': 'warning', 'paste': 'warning', 'contextmenu': 'warning', 'blocked-key': 'warning',
  'print-screen': 'warning', 'resize': 'warning', 'bulk-insert': 'warning', 'inhuman-typing': 'warning',
  'return': 'info', 'exit': 'violation',
  // Evidence only, never strikes: each has an honest explanation often enough (a spelling helper, a
  // read-aloud toolbar), and the teacher is the one who can ask.
  'extension': 'warning', 'spoofed-checks': 'warning', 'no-frames': 'warning', 'scripted-input': 'warning', 'viewport': 'warning',
  'setup': 'info',
  // also evidence only: a scripted browser, or the quiz running in a virtual machine or remote desktop
  'automation': 'warning', 'virtual-machine': 'warning', 'software-graphics': 'info',
  // evidence: an answer changed within seconds of coming back from somewhere else
  'answer-after-return': 'warning',
};
// Events only the server records.
// A lost heartbeat is only a warning: school wifi drops, and actually leaving the window is caught by
// blur/hidden, which the client queues while offline and delivers when it reconnects.
const SERVER_EVENTS = {
  'reload': 'violation', 'unfocused-beat': 'violation',
  'heartbeat-lost': 'warning', 'late-submit': 'warning', 'other-network': 'warning', 'other-device': 'warning', 'left-network': 'warning',
  // evidence: another student signed in from this browser; a network this student hasn't used before
  'same-browser': 'warning', 'new-network': 'warning',
  'join': 'info', 'admit': 'info', 'start': 'info', 'submit': 'info', 'run': 'info', 'reconnect': 'info', 'resume': 'info',
  'restore': 'info', 'invalidate': 'info', 'let-in': 'info', 'extend': 'info', 'grade': 'info',
};
// In Safe Exam Browser with BrowserQuiz's own settings, SEB blocks every other app, so the page losing focus
// is SEB's own doing (its toolbar, a system dialog, an iPad keyboard) and can't be the student leaving:
// logged, never a strike. Quitting SEB to leave still counts, as the reload when they come back.
const SEB_QUIET = new Set(['blur', 'hidden', 'fullscreen-exit', 'mouse-left', 'resize', 'extended-display', 'answer-after-return']);
const MERGE_MS = 2000;
const MAX_EVENTS = 3000;
const WARN_PER_TYPE_PER_MIN = 20;

const attempts = new Map(); // id -> live attempt

function fromRow(r) {
  return {
    id: r.id, runId: r.run_id, studentId: r.student_id, tokenHash: r.token_hash, status: r.status,
    integrity: r.integrity, strikes: r.strikes, warnings: r.warnings, reason: r.reason, invalidatedAt: r.invalidated_at,
    startedAt: r.started_at, deadline: r.deadline, submittedAt: r.submitted_at, lastBeat: r.last_beat,
    layout: r.layout ? JSON.parse(r.layout) : null, answers: r.answers ? JSON.parse(r.answers) : {},
    result: r.result ? JSON.parse(r.result) : null, ip: r.ip, userAgent: r.user_agent, edits: r.edits,
    archived: !!r.archived, createdAt: r.created_at,
    awayMs: r.away_ms || 0, awayMax: r.away_max || 0, restoreStrikes: r.restore_strikes, pinIp: r.pin_ip || null,
    qTime: r.q_time ? JSON.parse(r.q_time) : {}, device: r.device || null, readyAt: r.ready_at || null,
    // runtime only
    awaySince: 0, away: false, burstStart: 0, beatLost: false, eventCount: null, warnWindow: new Map(), flagged: new Set(), viewQ: null, viewAt: 0,
  };
}
function getAttempt(id) {
  if (!id) return null;
  if (attempts.has(id)) return attempts.get(id);
  const row = q('SELECT * FROM attempts WHERE id = ?').get(id);
  if (!row) return null;
  const a = fromRow(row);
  attempts.set(id, a);
  return a;
}
function attemptByToken(token) {
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = q('SELECT id FROM attempts WHERE token_hash = ? AND archived = 0').get(hash);
  return row ? getAttempt(row.id) : null;
}
function save(a) {
  q(`UPDATE attempts SET status = ?, integrity = ?, strikes = ?, warnings = ?, reason = ?, invalidated_at = ?, started_at = ?,
     deadline = ?, submitted_at = ?, last_beat = ?, layout = ?, answers = ?, result = ?, edits = ?, archived = ?,
     away_ms = ?, away_max = ?, restore_strikes = ?, pin_ip = ?, q_time = ?, ready_at = ? WHERE id = ?`).run(
    a.status, a.integrity, a.strikes, a.warnings, a.reason, a.invalidatedAt, a.startedAt, a.deadline, a.submittedAt,
    a.lastBeat, a.layout ? JSON.stringify(a.layout) : null, JSON.stringify(a.answers || {}), a.result ? JSON.stringify(storedResult(a.result)) : null,
    a.edits || 0, a.archived ? 1 : 0, a.awayMs || 0, a.awayMax || 0, a.restoreStrikes == null ? null : a.restoreStrikes, a.pinIp || null,
    a.qTime && Object.keys(a.qTime).length ? JSON.stringify(a.qTime) : null, a.readyAt || null, a.id,
  );
}
function forget(id) { attempts.delete(id); }

function logEvent(a, type, severity, detail) {
  if (a.eventCount === null) a.eventCount = q('SELECT COUNT(*) AS n FROM events WHERE attempt_id = ?').get(a.id).n;
  // Violations are kept past the cap (spam can't push evidence out), up to a much higher one for disk.
  if (a.eventCount >= (severity === 'violation' ? MAX_EVENTS * 5 : MAX_EVENTS)) return false;
  q('INSERT INTO events (attempt_id, t, type, severity, detail) VALUES (?, ?, ?, ?, ?)').run(
    a.id, Date.now(), type, severity, detail == null ? null : String(detail).slice(0, 200),
  );
  a.eventCount++;
  return true;
}

// The student is back (they said so, or a heartbeat came in focused): add up how long they were gone.
// A strike says that they left; this says for how long, which is what tells a stray popup from a search.
function back(a, t) {
  if (a.away && a.awaySince) {
    const ms = Math.max(0, t - a.awaySince);
    a.awayMs = (a.awayMs || 0) + ms;
    a.awayMax = Math.max(a.awayMax || 0, ms);
  }
  a.away = false;
  a.awaySince = 0;
}
// Time away so far, counting an absence that is still going on.
const awayNow = (a, now) => (a.status === 'active' && a.away && a.awaySince ? Math.max(0, now - a.awaySince) : 0);

// A strike is a move from "present" to "away". Everything that fires while already away (blur + hidden +
// fullscreen-exit together, unfocused heartbeats) is logged but doesn't stack. The merge window is anchored
// to the first event of a burst, so leaving every 1.9s still counts every time. `at` is when it happened, for
// events the client queued while offline: they arrive together but still count one strike per departure.
// Monitored: taking the quiz, or agreed and waiting in lockdown for the teacher to start it.
const watched = (a) => a.status === 'active' || (!!a.readyAt && (a.status === 'waiting' || a.status === 'admitted'));

function record(a, type, detail, quiz, at) {
  let severity = (Object.hasOwn(CLIENT_EVENTS, type) && CLIENT_EVENTS[type]) || (Object.hasOwn(SERVER_EVENTS, type) && SERVER_EVENTS[type]);
  if (!severity) return;
  if (a.lockedSeb && SEB_QUIET.has(type)) {
    severity = 'info';
    detail = [detail, 'in Safe Exam Browser'].filter(Boolean).join(', ');
  }
  if (a.practice && severity !== 'info') return; // practice runs aren't monitored
  const now = Date.now();
  const t = at == null ? now : at;
  if (severity === 'warning') {
    const n = (a.warnWindow.get(type) || []).filter((t) => now - t < 60000);
    if (n.length >= WARN_PER_TYPE_PER_MIN) return;
    n.push(now);
    a.warnWindow.set(type, n);
  }
  logEvent(a, type, severity, detail);
  if (type === 'return') back(a, t);
  if (severity === 'warning') a.warnings++;
  if (severity === 'violation' && watched(a)) {
    const merged = a.away || (a.burstStart && Math.abs(t - a.burstStart) < MERGE_MS);
    if (!a.away) a.awaySince = t;
    a.away = true;
    if (!merged) {
      a.burstStart = t;
      a.strikes++;
      const grace = quiz && quiz.integrity && quiz.integrity.graceStrikes != null ? quiz.integrity.graceStrikes : 1;
      if (a.integrity === 'clean' && a.strikes > grace) {
        a.integrity = 'invalidated';
        a.reason = type;
        a.invalidatedAt = now;
      }
    }
  }
  save(a);
}

// ---------- layout (per-student order) ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Shuffle questions only within each part (same-type run) so the directions still line up. Questions
// next to each other that use the same shared material move together, in their order. With question
// pools, each pool's picks are made first: the questions left out aren't in this student's quiz at all.
function makeLayout(quiz) {
  const skip = new Set();
  if (quiz.pools) {
    const byPool = new Map();
    for (const qq of quiz.questions) if (qq.pool) { if (!byPool.has(qq.pool)) byPool.set(qq.pool, []); byPool.get(qq.pool).push(qq.id); }
    for (const [name, ids] of byPool) {
      const keep = new Set(shuffle(ids).slice(0, quiz.pools[name] || 1));
      for (const id of ids) if (!keep.has(id)) skip.add(id);
    }
  }
  const order = [];
  let run = [];
  // Questions that use the same shared material (all of it, in order) stay together when shuffled.
  const sharedOf = new Map(quiz.questions.map((qq) => [qq.id, [].concat(qq.shared || []).join('+') || null]));
  const flush = () => {
    const blocks = [];
    for (const id of run) {
      const last = blocks[blocks.length - 1];
      if (sharedOf.get(id) && last && last.shared === sharedOf.get(id)) last.ids.push(id);
      else blocks.push({ shared: sharedOf.get(id), ids: [id] });
    }
    order.push(...(quiz.shuffleQuestions ? shuffle(blocks) : blocks).flatMap((b) => b.ids));
    run = [];
  };
  const sectionStart = new Set((quiz.sections || []).map((sec) => sec.before));
  let prev = null; // the last question this student has
  let newSection = false; // a section started since it (maybe on a question a pool left out)
  for (const qq of quiz.questions) {
    if (sectionStart.has(qq.id)) newSection = true;
    if (skip.has(qq.id)) continue;
    if (run.length && (prev.type !== qq.type || newSection)) flush(); // shuffling stays inside a section
    run.push(qq.id);
    prev = qq;
    newSection = false;
  }
  flush();
  const perms = {};
  for (const qq of quiz.questions) {
    if (!qq.choices) continue;
    const idx = qq.choices.map((_, i) => i);
    perms[qq.id] = quiz.shuffleChoices && qq.shuffleChoices !== false ? shuffle(idx) : idx;
  }
  // Random values: which row of each question's vars this student gets.
  const vars = {};
  for (const qq of quiz.questions) if (qq.vars) vars[qq.id] = crypto.randomInt(qq.vars.length);
  return Object.keys(vars).length ? { order, perms, vars } : { order, perms };
}
// A question with random values, as the student with row `r` of them sees it (the first row without one).
function withVars(qq, r) {
  const out = putVars(qq, qq.vars[r] || qq.vars[0]);
  if (out.type === 'output') out.answer = normOutput(out.answer);
  return out;
}

// What one student was given. With question pools their layout picks some of each pool's questions, and
// the rest aren't theirs to answer, grade or report; corrections give them only what they missed.
// Otherwise (or before they start): the whole quiz.
function quizFor(quiz, layout) {
  if (!quiz || !layout || !Array.isArray(layout.order)) return quiz;
  const vars = quiz.questions.some((qq) => qq.vars);
  if (!quiz.pools && !layout.subset && !vars) return quiz; // subset: corrections
  const mine = quiz.pools || layout.subset ? new Set(layout.order) : null;
  const rows = layout.vars || {};
  const questions = [];
  for (const qq of quiz.questions) {
    if (mine && !mine.has(qq.id)) continue;
    questions.push(qq.vars ? withVars(qq, rows[qq.id]) : qq);
  }
  return Object.assign({}, quiz, { questions });
}
// How many questions, and points, each student gets: all of them, less what the pools leave out.
function perStudent(quiz) {
  let count = 0;
  let points = 0;
  const pools = new Map();
  for (const qq of quiz.questions) {
    if (!qq.pool || !quiz.pools) { count++; points += qq.points; continue; }
    const p = pools.get(qq.pool) || { n: 0, points: qq.points };
    p.n++;
    pools.set(qq.pool, p);
  }
  for (const [name, p] of pools) { const k = Math.min(p.n, quiz.pools[name] || 1); count += k; points += k * p.points; }
  return { count, points: Math.round(points * 100) / 100 };
}

module.exports = {
  watched,
  getQuiz, getAsset, listAssets, storedResult, getAttempt, attemptByToken, save, forget, record, back, awayNow, logEvent, makeLayout, quizFor, perStudent, attempts,
  CLIENT_EVENTS, SERVER_EVENTS, quizCache,
};
