'use strict';
// One student's attempt: its report, events, typing replay, the watch page, and what a teacher does to it.

const store = require('../store');
const { q } = require('../db');
const P = require('../people');
const { json, HttpError, send, readJson } = require('../http');
const Pause = require('../pause');
const { totals, answerReport, reportQuiz, studentReport, gradeAttempt } = require('../grade');
const { publicQuiz, submit } = require('../student');
const Parts = require('../parts');
const crypto = require('node:crypto');
const W = require('../watch');
const { similarCode } = require('../similar');
const { sameWrong } = require('../samewrong');
const { fastRight } = require('../fast');
const { addTime, audit, getAttemptRun, getRun, notWhileOpen, partEnd, requireTeacher, sealed } = require('./common');

module.exports = function attemptRoutes(r) {
  r.get('/api/t/attempts/:id', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT bq_name(name, id, roster_id) AS name, time_x FROM roster_students WHERE id = ?').get(a.studentId);
    const events = q('SELECT t, type, severity, detail FROM events WHERE attempt_id = ? ORDER BY id DESC LIMIT 400').all(a.id)
      .map((e) => ({ t: e.t, type: e.type, severity: e.severity, detail: P.openEvent(a.runId, a.id, e.detail) }));
    const mouse = [];
    for (const m of q('SELECT points FROM mouse WHERE attempt_id = ? ORDER BY rowid DESC LIMIT 60').all(a.id).reverse()) mouse.push(...JSON.parse(m.points));
    json(res, 200, {
      id: a.id, name: student ? student.name : '?', status: a.status, integrity: a.integrity, reason: a.reason,
      invalidatedAt: a.invalidatedAt, strikes: a.strikes, warnings: a.warnings,
      awayMs: (a.awayMs || 0) + store.awayNow(a, Date.now()), awayMax: Math.max(a.awayMax || 0, store.awayNow(a, Date.now())), startedAt: a.startedAt, submittedAt: a.submittedAt,
      deadline: a.deadline, timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - Pause.clock(a, run.paused_at)) : null,
      paused: a.status === 'active' && !!run.paused_at,
      timeX: student && student.time_x && student.time_x !== 1 ? student.time_x : undefined,
      sealed: sealed(run) || undefined,
      totals: sealed(run) ? null : totals(a.result, quiz, a.answers, a.layout), answers: sealed(run) ? [] : answerReport(quiz, a), events,
      quiz: sealed(run) ? null : reportQuiz(quiz, run.quiz_id), report: sealed(run) ? null : studentReport(quiz, a, student ? student.name : ''), mouse: mouse.slice(-3000), ip: a.ip, userAgent: a.userAgent,
    });
  });

  // Watch a student live (watch.js): their quiz as they see it, then their screen, answers and mouse.
  r.get('/api/t/attempts/:id/watch-start', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    if (!a.layout) throw new HttpError(409, 'not_started');
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId);
    // their clock, as of the watch page's playback (watch.js DELAY)
    json(res, 200, { quiz: publicQuiz(quiz, a.layout), quizId: run.quiz_id, answers: a.answers || {}, name: student ? student.name : '', deadline: a.deadline || null, turnInAt: a.deadline ? Math.min(a.deadline, (a.layout && a.layout.turnInAt) || a.deadline) : null, partEnds: Parts.timed(quiz, a.layout) ? a.layout.partEnds : undefined, now: Date.now(), delay: 2500, practice: run.mode === 'practice', paused: a.status === 'active' ? Pause.since(a, run.paused_at) || undefined : undefined });
  });
  r.get('/api/t/attempts/:id/watch', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    const url = new URL(req.url, 'http://x');
    const now = Date.now();
    const student = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId);
    // The answers only when they've changed since the version the page has.
    const text = JSON.stringify(a.answers || {});
    const ver = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
    // How it was turned in, for the same "done" screen the student got (app/done.js DONE)
    let ended = null;
    if (a.status === 'submitted') {
      const ev = q("SELECT detail FROM events WHERE attempt_id = ? AND type = 'submit' ORDER BY id DESC LIMIT 1").get(a.id);
      const why = ev ? P.openEvent(a.runId, a.id, ev.detail) : null;
      ended = why === 'time ran out' ? 'time' : why === 'quiz closed' ? 'ended' : why === 'ended by teacher' ? 'mine'
        : a.deadline && a.submittedAt >= a.deadline - 1500 ? 'time' : 'submitted';
    }
    json(res, 200, {
      name: student ? student.name : '?', runId: a.runId, status: a.status, integrity: a.integrity, now, ver, ended, submittedAt: a.submittedAt || null, deadline: a.deadline || null,
      partEnds: a.layout && Array.isArray(a.layout.partEnds) ? a.layout.partEnds : undefined,
      paused: a.status === 'active' ? Pause.since(a, run.paused_at) || undefined : undefined, // when their clock stopped
      timeLeft: a.status === 'active' && a.deadline ? Math.max(0, partEnd(a, Pause.clock(a, run.paused_at, now)) - Pause.clock(a, run.paused_at, now)) : null, // timed parts: the part's
      away: !!store.awayNow(a, now) || !!a.away,
      // Watch is their screen as they see it, answers and all (proctoring needs to see what they do)
      answers: url.searchParams.get('ver') === ver ? undefined : (a.answers || {}),
      ...W.look(a, url.searchParams.get('since'), now, url.searchParams.get('xver')),
    });
  });

  // Typing replay (monitor.js trackEditor): each code question's edits, in order, as the student typed
  // them. { question id: [{ t, l, init } | { t, l, ch: [[offset, removed, text]] }] }. Edits from before
  // replays had a starting point (no init) can't be rebuilt, so the page says so.
  r.get('/api/t/attempts/:id/replay', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    notWhileOpen(run);
    const out = {};
    for (const row of q('SELECT deltas FROM code_edits WHERE attempt_id = ? ORDER BY rowid').all(a.id)) {
      let list;
      try { list = JSON.parse(P.openEdits(a.runId, a.id, row.deltas)); } catch (e) { continue; }
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        if (!e || typeof e.q !== 'string' || !Number.isFinite(e.t)) continue;
        const l = typeof e.l === 'string' ? e.l.slice(0, 20) : null;
        const item = typeof e.init === 'string' ? { t: e.t, l, init: e.init }
          : Array.isArray(e.ch) ? { t: e.t, l, ch: e.ch.filter((c) => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) && typeof c[2] === 'string') } : null;
        if (!item) continue;
        (out[e.q] = out[e.q] || []).push(item);
      }
    }
    json(res, 200, { edits: out });
  });

  const tzOf = (me) => (q('SELECT tz FROM teachers WHERE id = ?').get(me.id) || {}).tz || null;
  r.get('/api/t/attempts/:id/report', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { quiz: reportQuiz(quiz, run.quiz_id), students: [studentReport(quiz, a, student ? student.name : '')], tz: tzOf(me) });
  });

  r.get('/api/t/runs/:id/report', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const rows = q(`SELECT attempts.id, bq_name(roster_students.name, roster_students.id, roster_students.roster_id) AS name FROM attempts
      JOIN roster_students ON roster_students.id = attempts.student_id
      WHERE attempts.run_id = ? AND attempts.archived = 0 AND attempts.status = 'submitted' ORDER BY name`).all(run.id);
    const attempts = rows.map((x) => store.getAttempt(x.id));
    json(res, 200, {
      quiz: reportQuiz(quiz, run.quiz_id), students: rows.map((x, i) => studentReport(quiz, attempts[i], x.name)),
      similar: similarCode(quiz, attempts.map((attempt, who) => ({ who, attempt }))), // who: a place in students
      sameWrong: sameWrong(quiz, attempts.map((attempt, who) => ({ who, attempt }))),
      fast: fastRight(quiz, attempts.map((attempt, who) => ({ who, attempt }))),
      tz: tzOf(me), // the time zone from Settings, for when each one submitted
    });
  });

  // Quiz images for the report page (students get theirs through /asset/ with their own cookie).
  r.get('/api/t/quizzes/:id/asset', (req, res, p) => {
    const me = requireTeacher(req);
    const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
    const quizId = q('SELECT id FROM quizzes WHERE id = ? AND owner_id = ?').get(String(p.id || ''), me.id);
    const row = quizId && store.getAsset(quizId.id, rel);
    if (!row) throw new HttpError(404, 'not_found');
    // asked for again each time: after signing out, the browser can't show it from its cache
    send(res, 200, Buffer.from(row.bytes), { 'Content-Type': row.mime, 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  });

  r.post('/api/t/attempts/:id/:action', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 16 * 1024); // feedback is up to 2000 characters, up to 4 bytes each
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const note = String(body.note || '').slice(0, 300);
    if (p.action === 'message') { // pops up on this student's screen at their next heartbeat
      const text = String(body.text || '').trim().slice(0, 500);
      if (text) store.notes.set(a.id, { id: Date.now(), text });
      audit(me, 'message', a.id, text.slice(0, 100));
    } else if (p.action === 'admit') {
      if (a.status === 'waiting') { a.status = 'admitted'; a.admittedAt = Date.now(); store.logEvent(a, 'admit', 'info', null); store.save(a); }
    } else if (p.action === 'restore') {
      if (a.integrity === 'invalidated') { a.integrity = 'restored'; a.restoreStrikes = a.strikes; store.logEvent(a, 'restore', 'info', note || null); store.save(a); }
    } else if (p.action === 'invalidate') {
      if (a.integrity !== 'invalidated') { a.integrity = 'invalidated'; a.reason = 'teacher'; a.invalidatedAt = Date.now(); store.logEvent(a, 'invalidate', 'info', note || null); store.save(a); }
    } else if (p.action === 'end') {
      // One student's quiz ends now and their answers are turned in, like Close quiz does for everyone.
      if (a.status === 'active') submit(a, quiz, null, 'ended by teacher');
    } else if (p.action === 'let-in') {
      // A crashed PC or a seat change: the next sign-in with this name and ID picks up the same attempt.
      if (a.status === 'active' || a.status === 'admitted') { a.letIn = Date.now(); store.logEvent(a, 'let-in', 'info', null); }
    } else if (p.action === 'extend') {
      const mins = Math.round(Number(body.minutes));
      if (!(mins >= 1 && mins <= 120)) throw new HttpError(400, 'bad_request');
      addTime(a, mins, run);
    } else if (p.action === 'reset') {
      a.archived = true;
      store.save(a);
      store.forget(a.id);
    } else if (p.action === 'regrade') {
      if (a.status === 'submitted') {
        const manual = a.result && a.result.manual;
        a.result = manual ? { manual } : null; // keep the teacher's rubric marks and overrides
        store.save(a);
        gradeAttempt(a, quiz, true).catch(() => {});
      }
    } else if (p.action === 'grade') {
      // Rubric checkboxes and a points override for one question.
      const qq = store.quizFor(quiz, a.layout).questions.find((x) => x.id === body.questionId); // one they were given
      if (!qq || a.status !== 'submitted' || !a.result) throw new HttpError(400, 'bad_request');
      const rubric = {};
      for (const r of qq.rubric || []) if (body.rubric && body.rubric[r.id] === true) rubric[r.id] = true;
      let override = null;
      if (body.override !== null && body.override !== undefined && body.override !== '') {
        override = Number(body.override);
        if (!Number.isFinite(override) || override < 0 || override > qq.points) throw new HttpError(400, 'bad_points', `Points must be between 0 and ${qq.points}.`);
        override = Math.round(override * 100) / 100;
      }
      // The AI's reasons stay to read, marked as changed by the teacher.
      const prev = (a.result.manual || {})[qq.id];
      const ai = prev && prev.ai ? Object.assign({}, prev.ai, { changed: true }) : undefined;
      // Feedback for the student (grading by question), on their report; a save without it keeps what's there
      const feedback = body.feedback === undefined ? (prev && prev.feedback) || '' : String(body.feedback || '').trim().slice(0, 2000);
      a.result.manual = Object.assign({}, a.result.manual, { [qq.id]: Object.assign({ rubric, override, reviewed: true }, ai ? { ai } : {}, feedback ? { feedback } : {}) });
      const ticked = Object.keys(rubric).length;
      store.logEvent(a, 'grade', 'info', `${store.qNumber(quiz, qq)}: ${override != null ? override + ' pts (override)' : `${ticked} rubric item${ticked === 1 ? '' : 's'}`}`);
      store.save(a);
    } else throw new HttpError(404, 'not_found');
    audit(me, p.action, a.id, note);
    json(res, 200, { ok: true });
  });
};
