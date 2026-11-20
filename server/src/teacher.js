'use strict';
// Teacher API: sign in, upload quizzes and rosters, run quizzes, watch them live, act on attempts.
const crypto = require('node:crypto');
const { q, tx } = require('./db');
const store = require('./store');
const { loadQuizFile, QuizError } = require('./quizfile');
const { checkReferences, runnerConfigured, runnerHealthy } = require('./coderun');
const { totals, questionScore, gradeAttempt, answerReport } = require('./grade');
const { submit, hashSid } = require('./student');
const { HttpError, clientIp, cookies, setCookie, json, readJson, readBody, send, sha256, newToken, sleep } = require('./http');

const TCH = 'tch';
const SESSION_MS = 12 * 3600 * 1000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LET_IN_MS = 10 * 60000; // how long "Let back in" stays open

function requireTeacher(req) {
  const t = cookies(req)[TCH];
  if (!t) throw new HttpError(401, 'login');
  const row = q('SELECT created_at FROM sessions WHERE token_hash = ?').get(sha256(t));
  if (!row || Date.now() - row.created_at > SESSION_MS) throw new HttpError(401, 'login');
}

function audit(action, attemptId, note) {
  q('INSERT INTO audit (t, action, attempt_id, note) VALUES (?, ?, ?, ?)').run(Date.now(), action, attemptId || null, note ? String(note).slice(0, 300) : null);
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
function parseCsv(text) {
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
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function liveRow(student, a, quiz) {
  if (!a) return { rosterId: student.id, name: student.name, attempt: null };
  const t = totals(a.result, quiz, a.answers);
  const answered = a.answers ? Object.keys(a.answers).length : 0;
  return {
    rosterId: student.id,
    name: student.name,
    attempt: {
      id: a.id, status: a.status, integrity: a.integrity, strikes: a.strikes, warnings: a.warnings,
      reason: a.reason, invalidatedAt: a.invalidatedAt, lastBeatAgo: a.status === 'active' && a.lastBeat ? Date.now() - a.lastBeat : null,
      answered, total: quiz.questions.length, deadline: a.deadline,
      timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - Date.now()) : null,
      letIn: !!(a.letIn && Date.now() - a.letIn < LET_IN_MS),
      score: t ? (a.integrity === 'invalidated' ? 0 : t.score) : null, rawScore: t ? t.score : null, max: t ? t.max : null,
      pending: t ? t.pending : 0, failed: t ? t.failed : 0, review: t ? t.review : 0,
    },
  };
}

module.exports = function teacherRoutes(r) {
  r.post('/api/t/login', async (req, res) => {
    const body = await readJson(req, 4096);
    const want = process.env.ADMIN_PASSWORD || '';
    await sleep(250);
    // A wrong password costs a second but never locks anyone out, so students on the same IP can't block the teacher.
    if (!want || !crypto.timingSafeEqual(Buffer.from(sha256(body.password || '')), Buffer.from(sha256(want)))) {
      await sleep(1000);
      throw new HttpError(401, 'bad_password');
    }
    const token = newToken();
    q('INSERT INTO sessions (token_hash, created_at) VALUES (?, ?)').run(sha256(token), Date.now());
    q('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_MS);
    setCookie(req, res, TCH, token, SESSION_MS / 1000);
    json(res, 200, { ok: true });
  });

  r.post('/api/t/logout', async (req, res) => {
    const t = cookies(req)[TCH];
    if (t) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(t));
    setCookie(req, res, TCH, '', 0);
    json(res, 200, { ok: true });
  });

  r.get('/api/t/me', async (req, res) => {
    requireTeacher(req);
    json(res, 200, { ok: true, runner: runnerConfigured(), runnerOk: runnerConfigured() ? await runnerHealthy() : false });
  });

  r.get('/api/t/overview', (req, res) => {
    requireTeacher(req);
    const quizzes = q('SELECT id, title, json, created_at FROM quizzes ORDER BY created_at DESC').all().map((x) => {
      const quiz = JSON.parse(x.json);
      return { id: x.id, title: x.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin, createdAt: x.created_at };
    });
    const rosters = q('SELECT r.id, r.name, r.created_at, COUNT(s.id) AS n FROM rosters r LEFT JOIN roster_students s ON s.roster_id = r.id GROUP BY r.id ORDER BY r.created_at DESC').all()
      .map((x) => ({ id: x.id, name: x.name, students: x.n, createdAt: x.created_at }));
    const runs = q(`SELECT runs.*, quizzes.title AS quiz_title, rosters.name AS roster_name,
        (SELECT COUNT(*) FROM attempts WHERE attempts.run_id = runs.id AND archived = 0) AS joined
      FROM runs JOIN quizzes ON quizzes.id = runs.quiz_id JOIN rosters ON rosters.id = runs.roster_id ORDER BY runs.created_at DESC LIMIT 50`).all()
      .map((x) => ({ id: x.id, code: x.code, status: x.status, quiz: x.quiz_title, roster: x.roster_name, joined: x.joined, ipLock: !!x.ip_lock, createdAt: x.created_at }));
    json(res, 200, { quizzes, rosters, runs });
  });

  r.post('/api/t/quizzes', async (req, res) => {
    requireTeacher(req);
    const buf = await readBody(req, 26 * 1024 * 1024);
    let parsed;
    try {
      parsed = loadQuizFile(buf);
      const hasRefs = parsed.quiz.questions.some((qq) => qq.type === 'code' && Object.keys(qq.reference || {}).length);
      if (hasRefs) {
        if (!runnerConfigured()) throw new QuizError('This quiz has reference solutions to check, but the code runner is not set up.');
        await checkReferences(parsed.quiz);
      }
    } catch (e) {
      if (e instanceof QuizError) return json(res, 400, { error: 'bad_quiz', message: e.message });
      if (e.code === 'runner_offline') return json(res, 503, { error: 'runner_offline', message: "Couldn't check the reference solutions: the code runner is offline." });
      throw e;
    }
    const id = crypto.randomUUID();
    tx(() => {
      q('INSERT INTO quizzes (id, title, json, created_at) VALUES (?, ?, ?, ?)').run(id, parsed.quiz.title, JSON.stringify(parsed.quiz), Date.now());
      for (const [p, asset] of parsed.assets) q('INSERT INTO assets (quiz_id, path, mime, bytes) VALUES (?, ?, ?, ?)').run(id, p, asset.mime, asset.bytes);
    });
    audit('upload-quiz', null, parsed.quiz.title);
    json(res, 200, { id, title: parsed.quiz.title, questions: parsed.quiz.questions.length });
  });

  r.post('/api/t/rosters', async (req, res) => {
    requireTeacher(req);
    const body = await readJson(req, 2 * 1024 * 1024);
    const name = String(body.name || '').trim().slice(0, 80) || 'Class';
    const rows = parseCsv(body.csv || '');
    if (rows.length < 2) return json(res, 400, { error: 'bad_roster', message: 'The CSV needs a header row and at least one student.' });
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const ni = header.indexOf('name');
    const si = header.findIndex((h) => h === 'student_id' || h === 'id' || h === 'studentid');
    if (ni < 0 || si < 0) return json(res, 400, { error: 'bad_roster', message: 'The header row needs "name" and "student_id" columns.' });
    const students = [];
    const problems = [];
    rows.slice(1).forEach((r2, i) => {
      const n = String(r2[ni] || '').trim().slice(0, 80);
      const sid = String(r2[si] || '').trim().slice(0, 40);
      if (!n || !sid) problems.push(`Row ${i + 2} is missing a name or student ID.`);
      else students.push({ name: n, sid });
    });
    if (problems.length) return json(res, 400, { error: 'bad_roster', message: problems.slice(0, 5).join(' ') });
    if (students.length > 500) return json(res, 400, { error: 'bad_roster', message: 'A roster can have at most 500 students.' });
    const id = crypto.randomUUID();
    tx(() => {
      q('INSERT INTO rosters (id, name, created_at) VALUES (?, ?, ?)').run(id, name, Date.now());
      for (const s of students) q('INSERT INTO roster_students (id, roster_id, name, sid_hash) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), id, s.name, hashSid(s.sid));
    });
    audit('upload-roster', null, `${name} (${students.length})`);
    json(res, 200, { id, name, students: students.length });
  });

  r.post('/api/t/runs', async (req, res) => {
    requireTeacher(req);
    const body = await readJson(req, 4096);
    if (!q('SELECT 1 FROM quizzes WHERE id = ?').get(String(body.quizId || ''))) throw new HttpError(400, 'bad_quiz');
    if (!q('SELECT 1 FROM rosters WHERE id = ?').get(String(body.rosterId || ''))) throw new HttpError(400, 'bad_roster');
    const id = crypto.randomUUID();
    const code = newJoinCode();
    q("INSERT INTO runs (id, quiz_id, roster_id, code, status, ip_lock, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)")
      .run(id, body.quizId, body.rosterId, code, body.ipLock ? clientIp(req) : null, Date.now());
    audit('open-run', null, code);
    json(res, 200, { id, code });
  });

  r.post('/api/t/runs/:id/:action', async (req, res, p) => {
    requireTeacher(req);
    const run = q('SELECT * FROM runs WHERE id = ?').get(p.id);
    if (!run) throw new HttpError(404, 'not_found');
    const quiz = store.getQuiz(run.quiz_id);
    if (p.action === 'close') {
      q("UPDATE runs SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), run.id);
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'active'").all(run.id)) {
        submit(store.getAttempt(row.id), quiz, null, 'quiz closed');
      }
    } else if (p.action === 'open') {
      q("UPDATE runs SET status = 'open', closed_at = NULL WHERE id = ?").run(run.id);
    } else if (p.action === 'admit-all') {
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'waiting'").all(run.id)) {
        const a = store.getAttempt(row.id);
        a.status = 'admitted';
        store.logEvent(a, 'admit', 'info', null);
        store.save(a);
      }
    } else if (p.action === 'lock') {
      q('UPDATE runs SET ip_lock = ? WHERE id = ?').run(clientIp(req), run.id);
    } else if (p.action === 'unlock') {
      q('UPDATE runs SET ip_lock = NULL WHERE id = ?').run(run.id);
    } else if (p.action === 'regrade-failed') {
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'submitted'").all(run.id)) {
        const a = store.getAttempt(row.id);
        const t = totals(a.result, quiz, a.answers);
        if (!a.result || (t && t.failed)) gradeAttempt(a, quiz).catch(() => {});
      }
    } else throw new HttpError(404, 'not_found');
    audit(p.action + '-run', null, run.code);
    json(res, 200, { ok: true });
  });

  r.get('/api/t/runs/:id/live', (req, res, p) => {
    requireTeacher(req);
    const run = q('SELECT * FROM runs WHERE id = ?').get(p.id);
    if (!run) throw new HttpError(404, 'not_found');
    const quiz = store.getQuiz(run.quiz_id);
    const roster = q('SELECT id, name FROM roster_students WHERE roster_id = ? ORDER BY name').all(run.roster_id);
    const byStudent = new Map(q('SELECT id, student_id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => [x.student_id, store.getAttempt(x.id)]));
    json(res, 200, {
      run: { id: run.id, code: run.code, status: run.status, ipLock: !!run.ip_lock, released: !!run.released, title: quiz.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin },
      students: roster.map((s) => liveRow(s, byStudent.get(s.id), quiz)),
    });
  });

  r.get('/api/t/runs/:id/export.csv', (req, res, p) => {
    requireTeacher(req);
    const run = q('SELECT * FROM runs WHERE id = ?').get(p.id);
    if (!run) throw new HttpError(404, 'not_found');
    const quiz = store.getQuiz(run.quiz_id);
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const head = ['name', 'status', 'integrity', 'reason', 'strikes', 'warnings', 'raw_score', 'final_score', 'max',
      'grading_pending', 'grading_failed', 'needs_review', 'started_at', 'submitted_at', ...quiz.questions.map((qq, i) => `q${i + 1}_${qq.id}`)];
    const lines = [head.join(',')];
    for (const s of q('SELECT id, name FROM roster_students WHERE roster_id = ? ORDER BY name').all(run.roster_id)) {
      const row = q('SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, s.id);
      const a = row ? store.getAttempt(row.id) : null;
      const t = a ? totals(a.result, quiz, a.answers) : null;
      const perQ = quiz.questions.map((qq) => {
        if (!a || !a.result) return '';
        const sc = questionScore(qq, a.result, a.answers);
        return sc.state === 'done' ? sc.points : sc.state;
      });
      lines.push([s.name, a ? a.status : 'not started', a ? a.integrity : '', a ? a.reason : '', a ? a.strikes : '', a ? a.warnings : '',
        t ? t.score : '', t ? (a.integrity === 'invalidated' ? 0 : t.score) : '', t ? t.max : '', t ? t.pending : '', t ? t.failed : '', t ? t.review : '',
        a ? iso(a.startedAt) : '', a ? iso(a.submittedAt) : '', ...perQ].map(esc).join(','));
    }
    send(res, 200, lines.join('\n') + '\n', {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${quiz.title.replace(/[^\w -]/g, '').slice(0, 60) || 'results'} ${run.code}.csv"`,
    });
  });

  r.get('/api/t/attempts/:id', (req, res, p) => {
    requireTeacher(req);
    const a = store.getAttempt(p.id);
    if (!a) throw new HttpError(404, 'not_found');
    const run = q('SELECT * FROM runs WHERE id = ?').get(a.runId);
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    const events = q('SELECT t, type, severity, detail FROM events WHERE attempt_id = ? ORDER BY id DESC LIMIT 400').all(a.id);
    const mouse = [];
    for (const m of q('SELECT points FROM mouse WHERE attempt_id = ? ORDER BY rowid DESC LIMIT 60').all(a.id).reverse()) mouse.push(...JSON.parse(m.points));
    json(res, 200, {
      id: a.id, name: student ? student.name : '?', status: a.status, integrity: a.integrity, reason: a.reason,
      invalidatedAt: a.invalidatedAt, strikes: a.strikes, warnings: a.warnings, startedAt: a.startedAt, submittedAt: a.submittedAt,
      deadline: a.deadline, timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - Date.now()) : null,
      totals: totals(a.result, quiz, a.answers), answers: answerReport(quiz, a), events, mouse: mouse.slice(-3000), ip: a.ip, userAgent: a.userAgent,
    });
  });

  r.post('/api/t/attempts/:id/:action', async (req, res, p) => {
    requireTeacher(req);
    const body = await readJson(req, 4096);
    const a = store.getAttempt(p.id);
    if (!a) throw new HttpError(404, 'not_found');
    const run = q('SELECT * FROM runs WHERE id = ?').get(a.runId);
    const quiz = store.getQuiz(run.quiz_id);
    const note = String(body.note || '').slice(0, 300);
    if (p.action === 'admit') {
      if (a.status === 'waiting') { a.status = 'admitted'; store.logEvent(a, 'admit', 'info', null); store.save(a); }
    } else if (p.action === 'restore') {
      if (a.integrity === 'invalidated') { a.integrity = 'restored'; store.logEvent(a, 'restore', 'info', note || null); store.save(a); }
    } else if (p.action === 'invalidate') {
      if (a.integrity !== 'invalidated') { a.integrity = 'invalidated'; a.reason = 'teacher'; a.invalidatedAt = Date.now(); store.logEvent(a, 'invalidate', 'info', note || null); store.save(a); }
    } else if (p.action === 'let-in') {
      // A crashed PC or a seat change: the next sign-in with this name and ID picks up the same attempt.
      if (a.status === 'active' || a.status === 'admitted') { a.letIn = Date.now(); store.logEvent(a, 'let-in', 'info', null); }
    } else if (p.action === 'extend') {
      const mins = Math.round(Number(body.minutes));
      if (!(mins >= 1 && mins <= 120)) throw new HttpError(400, 'bad_request');
      if (a.status === 'active' && a.deadline) {
        a.deadline = Math.max(a.deadline, Date.now()) + mins * 60000;
        store.logEvent(a, 'extend', 'info', `+${mins} min`);
        store.save(a);
      }
    } else if (p.action === 'reset') {
      a.archived = true;
      store.save(a);
      store.forget(a.id);
    } else if (p.action === 'regrade') {
      if (a.status === 'submitted') {
        const manual = a.result && a.result.manual;
        a.result = manual ? { manual } : null; // keep the teacher's rubric marks and overrides
        store.save(a);
        gradeAttempt(a, quiz).catch(() => {});
      }
    } else if (p.action === 'grade') {
      // Rubric checkboxes and a points override for one question.
      const qq = quiz.questions.find((x) => x.id === body.questionId);
      if (!qq || a.status !== 'submitted' || !a.result) throw new HttpError(400, 'bad_request');
      const rubric = {};
      for (const r of qq.rubric || []) if (body.rubric && body.rubric[r.id] === true) rubric[r.id] = true;
      let override = null;
      if (body.override !== null && body.override !== undefined && body.override !== '') {
        override = Number(body.override);
        if (!Number.isFinite(override) || override < 0 || override > qq.points) throw new HttpError(400, 'bad_points', `Points must be between 0 and ${qq.points}.`);
        override = Math.round(override * 100) / 100;
      }
      a.result.manual = Object.assign({}, a.result.manual, { [qq.id]: { rubric, override, reviewed: true } });
      store.logEvent(a, 'grade', 'info', `${qq.id}: ${override != null ? override + ' pts (override)' : Object.keys(rubric).length + ' rubric item(s)'}`);
      store.save(a);
    } else throw new HttpError(404, 'not_found');
    audit(p.action, a.id, note);
    json(res, 200, { ok: true });
  });
};
