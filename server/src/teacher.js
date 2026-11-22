'use strict';
// Teacher API: sign in, upload quizzes and rosters, run quizzes, watch them live, act on attempts.
const crypto = require('node:crypto');
const { q, tx } = require('./db');
const store = require('./store');
const fs = require('node:fs');
const path = require('node:path');
const { loadQuizFile, normalizeQuiz, markdownImages, QuizError, ASSET_TYPES } = require('./quizfile');
const { writeZip } = require('./zip');
const { checkReferences, checkOutputs, runnerConfigured, runnerHealthy, runSamples, gradeCode } = require('./coderun');
const { totals, questionScore, gradeAttempt, answerReport, cleanAnswers, gradeAuto, studentReport, reportQuiz, isRun } = require('./grade');
const { fillTemplate } = require('./quizfile');
const { submit, hashSid, publicQuiz } = require('./student');
const W = require('./watch');
const { similarCode } = require('./similar');
const C = require('./corrections');
const AI = require('./aigrade');
const AICSV = require('./aicsv');
const G = require('./grade');
const { fillTemplate: fillT } = require('./quizfile');
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
const { HttpError, clientIp, isHttps, cookies, setCookie, json, readJson, readBody, send, sha256, newToken, sleep } = require('./http');
const { makeConfig: makeSebConfig } = require('./seb');
const A = require('./accounts');
const V = require('./vault');

const TCH = 'tch';
const SESSION_MS = 12 * 3600 * 1000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LET_IN_MS = 10 * 60000; // how long "Let back in" stays open

// The signed-in teacher, or 401. Someone on a temporary password can only set their own (opts.setup).
function requireTeacher(req, opts = {}) {
  const tok = cookies(req)[TCH];
  if (!tok) throw new HttpError(401, 'login');
  const row = q(`SELECT s.created_at, t.id, t.username, t.name, t.role, t.disabled, t.must_change FROM sessions s
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

function liveRow(student, a, quiz, run) {
  if (!a) return { rosterId: student.id, name: student.name, attempt: null };
  const t = totals(a.result, quiz, a.answers, a.layout);
  const answered = a.answers ? Object.keys(a.answers).filter((k) => !k.includes('~')).length : 0; // not corrections' notes
  // Where they are right now (watch.js has their last heartbeat's screen): question 4 in their own order,
  // the review page, or a part's directions.
  const v = a.status === 'active' ? W.where(a.id) : null;
  const order = a.layout && Array.isArray(a.layout.order) ? a.layout.order : [];
  const on = !v ? null : v.review ? 'review' : v.dir ? 'directions' : order.indexOf(v.q) + 1 || null;
  return {
    rosterId: student.id,
    name: student.name,
    attempt: {
      id: a.id, status: a.status, integrity: a.integrity, strikes: a.strikes, warnings: a.warnings,
      awayMs: (a.awayMs || 0) + store.awayNow(a, Date.now()), awayNow: store.awayNow(a, Date.now()) || null,
      leftAgain: a.integrity === 'restored' && a.restoreStrikes != null ? Math.max(0, a.strikes - a.restoreStrikes) : 0,
      reason: a.reason, invalidatedAt: a.invalidatedAt, lastBeatAgo: a.status === 'active' && a.lastBeat ? Date.now() - a.lastBeat : null,
      answered, total: a.layout ? store.quizFor(quiz, a.layout).questions.length : store.perStudent(quiz).count, on, deadline: a.deadline,
      timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - Date.now()) : null,
      letIn: !!(a.letIn && Date.now() - a.letIn < LET_IN_MS),
      score: t ? (a.integrity === 'invalidated' ? 0 : t.score) : null, rawScore: t ? t.score : null, max: t ? t.max : null,
      pending: t ? t.pending : 0, failed: t ? t.failed : 0, review: t ? t.review : 0,
      // corrections: the exam score, what corrections add, and the total (the teacher's view only)
      corrections: run && run.corrects && a.status === 'submitted' ? C.standing(quiz, run, a) : undefined,
    },
  };
}


// ---------- quizzes: shared by upload, the quiz maker and preview ----------
async function checkQuiz(quiz) {
  const hasRefs = quiz.questions.some((qq) => isRun(qq) && Object.keys(qq.reference || {}).length);
  const outputs = quiz.questions.filter((qq) => qq.type === 'output');
  if (!hasRefs && !outputs.length) return;
  if (!runnerConfigured()) {
    if (hasRefs || outputs.some((qq) => qq.answer == null)) throw new QuizError('This quiz has code to run, but the code runner is not set up.');
    return;
  }
  if (outputs.length) await checkOutputs(quiz);
  if (hasRefs) await checkReferences(quiz);
}
function quizError(res, e) {
  if (e instanceof QuizError) return json(res, 400, { error: 'bad_quiz', message: e.message });
  if (e.code === 'runner_offline') return json(res, 503, { error: 'runner_offline', message: "Couldn't check the reference solutions: the code runner is offline." });
  throw e;
}
// A quiz that a past run used is hidden instead of deleted, so old results keep working.
function retireQuiz(id) {
  if (q('SELECT 1 FROM runs WHERE quiz_id = ? LIMIT 1').get(id)) q('UPDATE quizzes SET archived = 1 WHERE id = ?').run(id);
  else q('DELETE FROM quizzes WHERE id = ?').run(id);
  store.quizCache.delete(id);
}
// Sealed with the teacher's key (vault.js). The title stays readable: it's on the join screen and in lists.
function saveQuiz(me, quiz, assets, replaces) {
  const id = crypto.randomUUID();
  const key = V.needKey(me.id);
  tx(() => {
    q('INSERT INTO quizzes (id, title, json, created_at, owner_id, enc) VALUES (?, ?, ?, ?, ?, 1)').run(id, quiz.title, V.sealText(key, JSON.stringify(quiz), V.quizAad(id)), Date.now(), me.id);
    for (const a of assets) q('INSERT INTO assets (quiz_id, path, mime, bytes, enc) VALUES (?, ?, ?, ?, 1)').run(id, a.path, a.mime, V.seal(key, Buffer.from(a.bytes), V.assetAad(id, a.path)));
    if (replaces) retireQuiz(replaces);
  });
  return id;
}
function getQuizRow(me, id) {
  const row = q('SELECT id, title FROM quizzes WHERE id = ? AND owner_id = ?').get(String(id || ''), me.id);
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
// The stored (normalized) quiz back in the shape people write, for the quiz maker and downloads.
function quizSource(quiz) {
  const out = { format: 1, title: quiz.title, timeLimitMin: quiz.timeLimitMin, language: quiz.language,
    shuffleQuestions: quiz.shuffleQuestions, shuffleChoices: quiz.shuffleChoices, integrity: quiz.integrity };
  if (Object.keys(quiz.directions || {}).length) out.directions = quiz.directions;
  if (quiz.shared && quiz.shared.length) out.shared = quiz.shared;
  if (quiz.sections && quiz.sections.length) out.sections = quiz.sections;
  if (quiz.pools) out.pools = quiz.pools;
  out.questions = quiz.questions.map((qq) => {
    const o = { id: qq.id, type: qq.type, prompt: qq.prompt, points: qq.points };
    if (qq.name) o.name = qq.name;
    if (qq.pool) o.pool = qq.pool;
    if (qq.explanation) o.explanation = qq.explanation;
    if (qq.shared) o.shared = qq.shared;
    if (qq.image) { o.image = qq.image; if (qq.imageAlt) o.imageAlt = qq.imageAlt; }
    if (qq.type === 'text') { o.answer = qq.answer; if (qq.caseSensitive) o.caseSensitive = true; }
    if (qq.type === 'single' || qq.type === 'multi') { o.choices = qq.choices; o.answer = qq.answer; if (qq.shuffleChoices === false) o.shuffleChoices = false; if (qq.partialCredit) o.partialCredit = true; }
    if (qq.type === 'output') Object.assign(o, { code: qq.code, language: qq.language, answer: qq.answer });
    if (qq.type === 'trace') {
      if (qq.code) o.code = qq.code;
      Object.assign(o, { language: qq.language, columns: qq.columns, rows: qq.rows });
      if (qq.given.length) o.given = qq.given;
    }
    if (qq.type === 'fill') {
      Object.assign(o, { code: qq.code, language: qq.language, answer: qq.answer.map((a) => (a.length === 1 ? a[0] : a)) });
      if (qq.run) {
        o.mode = qq.mode;
        if (qq.mode === 'method') o.signature = qq.signature; else o.class = qq.class;
        o.tests = qq.tests;
        if (qq.compare === 'unordered') o.compare = 'unordered';
        if (qq.noRun) o.noRun = true;
        if (qq.rubric && qq.rubric.length) o.rubric = qq.rubric;
      }
    }
    if (qq.type === 'essay') {
      if (qq.language) o.language = qq.language;
      if (qq.rubric.length) o.rubric = qq.rubric;
    }
    if (qq.type === 'code') {
      o.mode = qq.mode;
      o.languages = qq.languages;
      if (qq.types) o.types = Object.fromEntries(Object.entries(qq.types).map(([n, fs]) => [n, Object.fromEntries(fs.map((f) => [f.name, f.type]))]));
      if (qq.mode === 'method') o.signature = qq.signature; else o.class = qq.class;
      o.tests = qq.tests;
      if (qq.ban) o.ban = qq.ban;
      if (Object.keys(qq.reference || {}).length) o.reference = qq.reference;
      if (qq.compare === 'unordered') o.compare = 'unordered';
      if (qq.noRun) o.noRun = true;
      if (qq.limits && (qq.limits.timeMs !== 2000 || qq.limits.memoryMb !== 256)) o.limits = qq.limits;
      if (qq.rubric && qq.rubric.length) o.rubric = qq.rubric;
      const custom = Object.fromEntries(Object.entries(qq.starter || {}).filter(([, v]) => typeof v === 'string'));
      if (Object.keys(custom).length) o.starter = custom;
      else if (qq.starterStyle === 'empty') o.starter = 'empty';
      if (Object.keys(qq.support || {}).length) o.support = qq.support;
    }
    return o;
  });
  return out;
}

// The prompt teachers paste into an AI chat to get a quiz: the template, the format spec and an example.
function quizPrompt() {
  const root = path.join(__dirname, '..', '..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const format = read('docs/quiz-format.md')
    .replace(/<!-- not-in-prompt -->[\s\S]*?<!-- \/not-in-prompt -->\n?/g, '')
    .replace(/^# .*\n+/, '')
    .replace(/^### /gm, '#### ')
    .replace(/^## /gm, '### ')
    .trim();
  const example = read('examples/ap-csa-unit4/quiz.json').trim();
  return read('server/prompt/quiz-prompt.md').replace('{{FORMAT}}', () => format).replace('{{EXAMPLE}}', () => example);
}
// A pasted or uploaded quiz.json (no zip). Images it names must come from somewhere else.
function parseQuizJson(buf) {
  try { return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new QuizError('quiz.json is not valid JSON: ' + e.message); }
}
const imagePaths = (raw) => new Set([...[...(Array.isArray(raw && raw.questions) ? raw.questions : []), ...(Array.isArray(raw && raw.shared) ? raw.shared : [])]
  .map((qq) => (qq && qq.image != null ? String(qq.image).replace(/^\.?\//, '') : null)).filter(Boolean), ...markdownImages(raw)]);

// ---------- rosters ----------
// One student per line, pasted from anywhere: "Name, ID", a spreadsheet (tabs), or a CSV with a header
// row and extra columns ("name, student_id, period" or "first name, last name, id"). Without a header,
// the ID is the field with the most digits; "Martinez, Ava, 204511" keeps "Martinez, Ava" as the name.
function parseRosterText(text) {
  const students = [];
  const problems = [];
  const lines = String(text || '').split(/\r?\n/).map((l, i) => [l, i]).filter(([l]) => l.trim());
  const rows = lines.map(([l, i]) => [(l.includes('\t') ? l.split('\t') : parseCsv(l)[0] || []).map((c) => c.trim().replace(/^"|"$/g, '')), i]);
  let cols = null;
  if (rows.length) {
    const head = rows[0][0].map((c) => c.toLowerCase());
    if (head.some((c) => /name/.test(c)) && !head.some((c) => /\d/.test(c))) {
      cols = {
        name: head.findIndex((c) => /name/.test(c) && !/first|last|given|family|sur/.test(c)),
        first: head.findIndex((c) => /first|given/.test(c)),
        last: head.findIndex((c) => /last|family|sur/.test(c)),
        id: head.findIndex((c) => /(^|[^a-z])id$|^id|student.?(id|number|no)|number|#/.test(c)),
      };
      rows.shift();
    }
  }
  const digits = (c) => (c.match(/\d/g) || []).length;
  for (const [cells, i] of rows) {
    let name;
    let sid;
    if (cols) {
      name = cols.name >= 0 ? cells[cols.name] : [cells[cols.first], cells[cols.last]].filter(Boolean).join(' ');
      sid = cols.id >= 0 ? cells[cols.id] : '';
    } else {
      let idIdx = -1;
      cells.forEach((c, k) => { if (digits(c) && (idIdx < 0 || digits(c) >= digits(cells[idIdx]))) idIdx = k; });
      sid = idIdx >= 0 ? cells[idIdx] : '';
      name = cells.filter((c, k) => k !== idIdx && c && !/^\d+$/.test(c)).join(', ');
    }
    name = String(name || '').trim().slice(0, 80);
    sid = String(sid || '').trim().slice(0, 40);
    if (!name || !sid) problems.push(`Line ${i + 1} needs a name and a student ID.`);
    else students.push({ name, sid });
  }
  return { students, problems };
}
function retireRoster(id) {
  if (q('SELECT 1 FROM runs WHERE roster_id = ? LIMIT 1').get(id)) q('UPDATE rosters SET archived = 1 WHERE id = ?').run(id);
  else q('DELETE FROM rosters WHERE id = ?').run(id);
}
const rosterStudentsForRun = (run) => q(`SELECT id, name FROM roster_students WHERE roster_id = ?
  AND (removed = 0 OR id IN (SELECT student_id FROM attempts WHERE run_id = ?)) ORDER BY name`).all(run.roster_id, run.id);

// Password guesses: each address gets 10 a minute and everyone together 60, counted before the check so
// firing them all at once doesn't help. A spent budget only blocks new sign-ins for a minute; teachers already
// signed in keep working, and the right password refunds its try.
const loginBuckets = new Map();
function loginBucket(key, cap, refillMs) {
  const now = Date.now();
  if (loginBuckets.size > 5000) for (const [k, b] of loginBuckets) if (now - b.at > 600000) loginBuckets.delete(k);
  const b = loginBuckets.get(key) || { n: cap, at: now, cap };
  b.n = Math.min(cap, b.n + (now - b.at) / refillMs);
  b.at = now;
  loginBuckets.set(key, b);
  return b;
}

module.exports = function teacherRoutes(r) {
  // Username + password. No username means admin, the account from .env.
  r.post('/api/t/login', async (req, res) => {
    const body = await readJson(req, 4096);
    const mine = loginBucket('ip:' + clientIp(req), 10, 6000);
    const all = loginBucket('all', 60, 1000);
    if (mine.n < 1 || all.n < 1) throw new HttpError(429, 'too_many');
    mine.n--;
    all.n--;
    await sleep(250);
    const teacher = A.byUsername(String(body.username || '').trim() || 'admin');
    const ok = await A.checkPassword(String(body.password || ''), teacher && !teacher.disabled ? teacher.pw_hash : null);
    if (!ok) {
      await sleep(1000);
      throw new HttpError(401, 'bad_password');
    }
    mine.n = Math.min(mine.cap, mine.n + 1);
    all.n = Math.min(all.cap, all.n + 1);
    // Unlock their quiz key. A teacher from before encryption gets one now, with a recovery code to keep.
    let recoveryCode = null;
    if (!(teacher.role === 'admin' && V.adminPasswordFromEnv()) && !teacher.must_change) {
      if (teacher.key_wrap) {
        const key = await V.unwrapKey(teacher.key_wrap, body.password);
        if (key) V.keyring.set(teacher.id, key);
        else q('UPDATE teachers SET must_change = 1 WHERE id = ?').run(teacher.id); // can't unlock: recovery code needed
      } else recoveryCode = await A.createKey(teacher.id, String(body.password));
    }
    const token = newToken();
    q('INSERT INTO sessions (token_hash, created_at, teacher_id) VALUES (?, ?, ?)').run(sha256(token), Date.now(), teacher.id);
    q('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_MS);
    setCookie(req, res, TCH, token, SESSION_MS / 1000);
    json(res, 200, { ok: true, recoveryCode });
  });

  r.post('/api/t/logout', async (req, res) => {
    const t = cookies(req)[TCH];
    if (t) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(t));
    setCookie(req, res, TCH, '', 0);
    json(res, 200, { ok: true });
  });

  r.get('/api/t/me', async (req, res) => {
    const me = requireTeacher(req, { setup: true });
    json(res, 200, {
      ok: true, runner: runnerConfigured(), runnerOk: runnerConfigured() ? await runnerHealthy() : false,
      teacher: {
        username: me.username, name: me.name, role: me.role, mustChange: !!me.must_change,
        passwordFromEnv: me.role === 'admin' && V.adminPasswordFromEnv(),
        // After a reset: their recovery code keeps their quizzes (the key in memory doesn't count, or the
        // temporary password alone would open them).
        needsRecovery: !!me.must_change && !!A.byId(me.id).key_wrap,
      },
    });
  });

  // A teacher sets their own password (the first time, from the temporary one). Admin's is in .env.
  r.post('/api/t/me/password', async (req, res) => {
    const me = requireTeacher(req, { setup: true });
    const body = await readJson(req, 4096);
    if (me.role === 'admin' && V.adminPasswordFromEnv()) throw new HttpError(400, 'admin_env', 'The admin password is ADMIN_PASSWORD in .env. Change it there and restart.');
    const next = String(body.next || '');
    if (next.length < A.MIN_PASSWORD) throw new HttpError(400, 'weak', `Use at least ${A.MIN_PASSWORD} characters.`);
    const t = A.byId(me.id);
    if (!(await A.checkPassword(String(body.current || ''), t.pw_hash))) throw new HttpError(400, 'bad_password', 'The current password is wrong.');
    // The quiz key moves to the new password. It's in memory, or the old password or the recovery code
    // opens it; "start over" drops quizzes nobody can open any more. After an admin reset (must_change),
    // the key in memory doesn't count: whoever has the temporary password needs the recovery code too.
    let key = t.must_change ? null : V.keyFor(me.id);
    if (!key && t.key_wrap) key = await V.unwrapKey(t.key_wrap, String(body.current || ''));
    if (!key && t.key_wrap && body.recoveryCode) key = await V.unwrapKey(t.rec_wrap, V.normCode(body.recoveryCode));
    if (!key && t.key_wrap && !body.startOver) {
      throw new HttpError(400, 'needs_recovery', body.recoveryCode ? "That recovery code doesn't match." : 'Enter your recovery code to keep your quizzes.');
    }
    if (!key && t.key_wrap) dropQuizzes(me);
    q('UPDATE teachers SET pw_hash = ?, must_change = 0 WHERE id = ?').run(await A.hashPassword(next), me.id);
    let recoveryCode = null;
    if (key) {
      q('UPDATE teachers SET key_wrap = ? WHERE id = ?').run(await V.wrapKey(key, next), me.id);
      V.keyring.set(me.id, key);
    } else recoveryCode = await A.createKey(me.id, next);
    // Signed out everywhere else.
    q('DELETE FROM sessions WHERE teacher_id = ? AND token_hash != ?').run(me.id, sha256(cookies(req)[TCH]));
    audit(me, 'change-password', null, null);
    json(res, 200, { ok: true, recoveryCode });
  });

  // ---------- teacher accounts (admin) ----------
  r.get('/api/t/teachers', (req, res) => {
    requireAdmin(req);
    const rows = q(`SELECT t.id, t.username, t.name, t.role, t.disabled, t.must_change, t.created_at,
        (SELECT COUNT(*) FROM quizzes WHERE owner_id = t.id AND archived = 0) AS quizzes,
        (SELECT COUNT(*) FROM rosters WHERE owner_id = t.id AND archived = 0) AS classes
      FROM teachers t ORDER BY t.role = 'admin' DESC, t.name COLLATE NOCASE`).all();
    json(res, 200, { teachers: rows.map((x) => ({ id: x.id, username: x.username, name: x.name, role: x.role, disabled: !!x.disabled, pending: !!x.must_change, quizzes: x.quizzes, classes: x.classes, createdAt: x.created_at })) });
  });

  // New teacher: they get a temporary password to give them, and pick their own when they sign in.
  r.post('/api/t/teachers', async (req, res) => {
    const me = requireAdmin(req);
    const body = await readJson(req, 4096);
    const username = String(body.username || '').trim();
    const name = String(body.name || '').trim().slice(0, 80);
    if (!A.USERNAME.test(username)) throw new HttpError(400, 'bad_username', 'Usernames are 2 to 32 letters, digits, dots, dashes or underscores.');
    if (!name) throw new HttpError(400, 'bad_name', 'Add their name.');
    if (A.byUsername(username)) throw new HttpError(400, 'taken', `${username} is taken.`);
    const temp = A.tempPassword();
    const id = crypto.randomUUID();
    q("INSERT INTO teachers (id, username, name, pw_hash, role, must_change, created_at) VALUES (?, ?, ?, ?, 'teacher', 1, ?)").run(id, username, name, await A.hashPassword(temp), Date.now());
    audit(me, 'add-teacher', null, username);
    json(res, 200, { id, username, tempPassword: temp });
  });

  r.post('/api/t/teachers/:id/:action', async (req, res, p) => {
    const me = requireAdmin(req);
    const t = A.byId(p.id);
    if (!t) throw new HttpError(404, 'not_found');
    if (t.role === 'admin') throw new HttpError(400, 'admin_env', 'Admin is reset from the server settings (ADMIN_RESET or ADMIN_PASSWORD).');
    let out = { ok: true };
    if (p.action === 'reset') {
      const temp = A.tempPassword();
      q('UPDATE teachers SET pw_hash = ?, must_change = 1 WHERE id = ?').run(await A.hashPassword(temp), t.id);
      q('DELETE FROM sessions WHERE teacher_id = ?').run(t.id);
      out = { ok: true, tempPassword: temp };
    } else if (p.action === 'disable') {
      q('UPDATE teachers SET disabled = 1 WHERE id = ?').run(t.id);
      q('DELETE FROM sessions WHERE teacher_id = ?').run(t.id);
    } else if (p.action === 'enable') {
      q('UPDATE teachers SET disabled = 0 WHERE id = ?').run(t.id);
    } else throw new HttpError(404, 'not_found');
    audit(me, `${p.action}-teacher`, null, t.username);
    json(res, 200, out);
  });

  r.get('/api/t/overview', (req, res) => {
    const me = requireTeacher(req);
    // practiced: a student has turned it in as practice, so they've seen its answers
    const quizzes = q(`SELECT id, title, created_at, EXISTS(SELECT 1 FROM runs JOIN attempts ON attempts.run_id = runs.id
        WHERE runs.quiz_id = quizzes.id AND runs.mode = 'practice' AND attempts.status = 'submitted') AS practiced
      FROM quizzes WHERE archived = 0 AND owner_id = ? ORDER BY created_at DESC`).all(me.id).map((x) => {
      const quiz = store.getQuiz(x.id);
      return { id: x.id, title: x.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin, createdAt: x.created_at, practiced: !!x.practiced };
    });
    const rosters = q('SELECT r.id, r.name, r.created_at, COUNT(s.id) AS n FROM rosters r LEFT JOIN roster_students s ON s.roster_id = r.id AND s.removed = 0 WHERE r.archived = 0 AND r.owner_id = ? GROUP BY r.id ORDER BY r.created_at DESC').all(me.id)
      .map((x) => ({ id: x.id, name: x.name, students: x.n, createdAt: x.created_at }));
    const runs = q(`SELECT runs.*, quizzes.title AS quiz_title, rosters.name AS roster_name,
        (SELECT COUNT(*) FROM attempts WHERE attempts.run_id = runs.id AND archived = 0) AS joined
      FROM runs JOIN quizzes ON quizzes.id = runs.quiz_id JOIN rosters ON rosters.id = runs.roster_id WHERE runs.owner_id = ? ORDER BY runs.created_at DESC LIMIT 50`).all(me.id)
      .map((x) => ({ id: x.id, code: x.code, status: x.status, quiz: x.quiz_title, roster: x.roster_name, joined: x.joined, ipLock: !!x.ip_lock, practice: x.mode === 'practice', corrections: !!x.corrects, seb: !!x.seb_key, createdAt: x.created_at }));
    json(res, 200, { quizzes, rosters, runs });
  });

  r.post('/api/t/quizzes', async (req, res) => {
    const me = requireTeacher(req);
    const buf = await readBody(req, 26 * 1024 * 1024);
    let parsed;
    try {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 64)).replace(/^\uFEFF/, '').trimStart();
      parsed = head.startsWith('{') ? { quiz: normalizeQuiz(parseQuizJson(buf), new Set()), assets: new Map() } : loadQuizFile(buf);
      await checkQuiz(parsed.quiz);
    } catch (e) { return quizError(res, e); }
    const id = saveQuiz(me, parsed.quiz, [...parsed.assets].map(([path, a]) => ({ path, mime: a.mime, bytes: a.bytes })), null);
    audit(me, 'upload-quiz', null, parsed.quiz.title);
    json(res, 200, { id, title: parsed.quiz.title, questions: parsed.quiz.questions.length });
  });

  // Quiz maker: save quiz.json from the editor. Editing saves a new copy and retires the old one
  // (images carry over), so runs that used the old version keep grading the same way.
  r.post('/api/t/quizzes/json', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 32 * 1024 * 1024);
    const old = body.replaces ? getQuizRow(me, body.replaces) : null;
    const assets = old ? store.listAssets(old.id) : [];
    let quiz;
    try {
      // Images added in the quiz maker arrive as base64, keyed by their assets/ path.
      for (const [p2, b64] of Object.entries(body.assets && typeof body.assets === 'object' ? body.assets : {})) {
        const ext = (p2.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
        if (!/^assets\/[A-Za-z0-9 _.-]{1,100}$/.test(p2) || p2.includes('..') || !ASSET_TYPES[ext]) throw new QuizError(`${p2}: images must be png, jpg, gif or webp.`);
        const bytes = Buffer.from(String(b64), 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new QuizError(`${p2}: images can be up to 5 MB.`);
        const i = assets.findIndex((a) => a.path === p2);
        if (i >= 0) assets.splice(i, 1);
        assets.push({ path: p2, mime: ASSET_TYPES[ext], bytes });
      }
      quiz = normalizeQuiz(body.quiz, new Set(assets.map((a) => a.path)));
      await checkQuiz(quiz);
    } catch (e) { return quizError(res, e); }
    const id = saveQuiz(me, quiz, assets, old && old.id);
    audit(me, old ? 'edit-quiz' : 'create-quiz', null, quiz.title);
    json(res, 200, { id, title: quiz.title });
  });

  // Pasted quiz.json -> the quiz maker. Validates without checking references or saving; images it
  // names come back as missing so they can be added in the editor.
  r.post('/api/t/quizzes/normalize', async (req, res) => {
    requireTeacher(req);
    const body = await readJson(req, 4 * 1024 * 1024);
    try {
      const raw = typeof body.json === 'string' ? parseQuizJson(Buffer.from(body.json)) : body.quiz;
      const images = imagePaths(raw);
      const quiz = normalizeQuiz(raw, images);
      json(res, 200, { quiz: quizSource(quiz), missingImages: [...images] });
    } catch (e) { return quizError(res, e); }
  });

  r.get('/api/t/quiz-prompt', (req, res) => {
    requireTeacher(req);
    send(res, 200, quizPrompt(), {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="BrowserQuiz quiz prompt.txt"',
    });
  });

  r.get('/api/t/quizzes/:id/source', (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const assets = q('SELECT path FROM assets WHERE quiz_id = ?').all(row.id).map((a) => a.path);
    json(res, 200, { id: row.id, quiz: quizSource(store.getQuiz(row.id)), assets });
  });

  r.get('/api/t/quizzes/:id/download', (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const entries = [{ name: 'quiz.json', data: Buffer.from(JSON.stringify(quizSource(store.getQuiz(row.id)), null, 2)) }];
    for (const a of store.listAssets(row.id)) entries.push({ name: a.path, data: a.bytes });
    send(res, 200, writeZip(entries), {
      // A .quiz is a zip, but sent as one Safari may unzip it into a folder or add ".zip" to the name.
      'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${row.title.replace(/[^\w -]/g, '').slice(0, 60) || 'quiz'}.quiz"`,
    });
  });

  r.post('/api/t/quizzes/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    retireQuiz(row.id);
    audit(me, 'delete-quiz', null, row.title);
    json(res, 200, { ok: true });
  });

  // Preview: the quiz exactly as students see it (unshuffled), with Run and a score, nothing saved.
  r.get('/api/t/quizzes/:id/preview', (req, res, p) => {
    const me = requireTeacher(req);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    const layout = { order: quiz.questions.map((qq) => qq.id), perms: Object.fromEntries(quiz.questions.filter((qq) => qq.choices).map((qq) => [qq.id, qq.choices.map((_, i) => i)])) };
    json(res, 200, { quiz: publicQuiz(quiz, layout), deadline: null, now: Date.now(), saved: {} });
  });

  r.post('/api/t/quizzes/:id/run', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 128 * 1024);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    const qq = quiz.questions.find((x) => x.id === body.questionId && isRun(x));
    const code = qq && qq.type === 'fill' ? (Array.isArray(body.blanks) ? fillTemplate(qq.code, body.blanks.map((b) => String(b || '').slice(0, 500))) : null) : body.code;
    if (!qq || !qq.languages.includes(body.language) || typeof code !== 'string') throw new HttpError(400, 'bad_request');
    try {
      json(res, 200, await runSamples(qq, body.language, code.slice(0, 50000)));
    } catch (e) {
      json(res, 200, { status: 'error', message: 'Code runner offline.' });
    }
  });

  r.post('/api/t/quizzes/:id/grade', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 1024 * 1024);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    const answers = cleanAnswers(quiz, null, body.answers);
    const auto = gradeAuto(quiz, null, answers);
    const questions = await Promise.all(quiz.questions.map(async (qq, i) => {
      if (qq.type === 'essay') return { n: i + 1, id: qq.id, points: null, max: qq.points, manual: true };
      if (!isRun(qq)) return { n: i + 1, id: qq.id, points: auto.detail[qq.id].points, max: qq.points };
      // rubric: points only the teacher can give (items the server can't check)
      let rubric = qq.rubric.reduce((sum, r2) => sum + r2.points, 0);
      try {
        const ans = qq.type === 'fill' ? { language: qq.language, code: fillTemplate(qq.code, answers[qq.id] || []) } : answers[qq.id];
        const c = await gradeCode(qq, ans);
        const auto = c.rubric || {};
        const checked = qq.rubric.filter((r2) => r2.id in auto);
        rubric -= checked.reduce((sum, r2) => sum + r2.points, 0);
        const points = c.status === 'done' ? c.score + checked.reduce((sum, r2) => sum + (auto[r2.id] ? r2.points : 0), 0) : null;
        return { n: i + 1, id: qq.id, points: points == null ? null : Math.round(points * 100) / 100, max: qq.points, rubric };
      } catch (e) {
        return { n: i + 1, id: qq.id, points: null, max: qq.points, rubric };
      }
    }));
    const score = Math.round(questions.reduce((sum, x) => sum + (x.points || 0), 0) * 100) / 100;
    json(res, 200, { ok: true, score, max: quiz.questions.reduce((sum, qq) => sum + qq.points, 0), questions });
  });

  // New class from a CSV file ({ csv }) or the roster maker's pasted list ({ text }).
  r.post('/api/t/rosters', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 2 * 1024 * 1024);
    const name = String(body.name || '').trim().slice(0, 80) || 'Class';
    let students = [];
    let problems = [];
    if (typeof body.text === 'string') {
      ({ students, problems } = parseRosterText(body.text));
      if (!students.length && !problems.length) problems.push('Add at least one student.');
    } else {
      const rows = parseCsv(body.csv || '');
      if (rows.length < 2) return json(res, 400, { error: 'bad_roster', message: 'The CSV needs a header row and at least one student.' });
      const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const ni = header.indexOf('name');
      const si = header.findIndex((h) => h === 'student_id' || h === 'id' || h === 'studentid');
      if (ni < 0 || si < 0) return json(res, 400, { error: 'bad_roster', message: 'The header row needs "name" and "student_id" columns.' });
      rows.slice(1).forEach((r2, i) => {
        const n = String(r2[ni] || '').trim().slice(0, 80);
        const sid = String(r2[si] || '').trim().slice(0, 40);
        if (!n || !sid) problems.push(`Row ${i + 2} is missing a name or student ID.`);
        else students.push({ name: n, sid });
      });
    }
    if (problems.length) return json(res, 400, { error: 'bad_roster', message: problems.slice(0, 5).join(' ') });
    if (students.length > 500) return json(res, 400, { error: 'bad_roster', message: 'A class can have at most 500 students.' });
    const id = crypto.randomUUID();
    tx(() => {
      q('INSERT INTO rosters (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)').run(id, name, Date.now(), me.id);
      for (const s of students) q('INSERT INTO roster_students (id, roster_id, name, sid_hash) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), id, s.name, hashSid(s.sid));
    });
    audit(me, 'create-roster', null, `${name} (${students.length})`);
    json(res, 200, { id, name, students: students.length });
  });

  // Roster maker: IDs are stored hashed, so a class can be renamed and students added or removed,
  // but an existing ID can't be shown.
  r.get('/api/t/rosters/:id', (req, res, p) => {
    const me = requireTeacher(req);
    const roster = getRoster(me, p.id);
    const students = q(`SELECT s.id, s.name, EXISTS(SELECT 1 FROM attempts a WHERE a.student_id = s.id) AS results
      FROM roster_students s WHERE s.roster_id = ? AND s.removed = 0 ORDER BY s.name`).all(roster.id)
      .map((x) => ({ id: x.id, name: x.name, results: !!x.results }));
    json(res, 200, { id: roster.id, name: roster.name, students });
  });

  r.post('/api/t/rosters/:id/edit', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 2 * 1024 * 1024);
    const roster = getRoster(me, p.id);
    const { students, problems } = parseRosterText(body.add || '');
    if (problems.length) return json(res, 400, { error: 'bad_roster', message: problems.slice(0, 5).join(' ') });
    const remove = Array.isArray(body.remove) ? body.remove.map(String) : [];
    tx(() => {
      const name = String(body.name || '').trim().slice(0, 80);
      if (name) q('UPDATE rosters SET name = ? WHERE id = ?').run(name, roster.id);
      for (const s of students) q('INSERT INTO roster_students (id, roster_id, name, sid_hash) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), roster.id, s.name, hashSid(s.sid));
      for (const sid of remove) {
        // Students with quiz results stay in the database (hidden) so old results keep their names.
        if (q('SELECT 1 FROM attempts WHERE student_id = ? LIMIT 1').get(sid)) q('UPDATE roster_students SET removed = 1 WHERE id = ? AND roster_id = ?').run(sid, roster.id);
        else q('DELETE FROM roster_students WHERE id = ? AND roster_id = ?').run(sid, roster.id);
      }
    });
    audit(me, 'edit-roster', null, `${roster.name}: +${students.length} -${remove.length}`);
    json(res, 200, { ok: true });
  });

  r.post('/api/t/rosters/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const roster = getRoster(me, p.id, true);
    retireRoster(roster.id);
    audit(me, 'delete-roster', null, roster.name);
    json(res, 200, { ok: true });
  });

  r.post('/api/t/runs', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    if (!q('SELECT 1 FROM quizzes WHERE id = ? AND owner_id = ? AND archived = 0').get(String(body.quizId || ''), me.id)) throw new HttpError(400, 'bad_quiz');
    if (!q('SELECT 1 FROM rosters WHERE id = ? AND owner_id = ? AND archived = 0').get(String(body.rosterId || ''), me.id)) throw new HttpError(400, 'bad_roster');
    // Safe Exam Browser: settings BrowserQuiz makes (seb), or the Config Key of the teacher's own .seb
    // file from SEB Config Tool (sebKey, 64 hex digits).
    let sebKey = body.sebKey ? String(body.sebKey).trim().toLowerCase() : null;
    if (sebKey && !/^[0-9a-f]{64}$/.test(sebKey)) throw new HttpError(400, 'bad_seb_key', "The Config Key is 64 letters and digits. Copy it from SEB Config Tool's Exam tab.");
    const id = crypto.randomUUID();
    const code = newJoinCode();
    let sebConfig = null;
    let sebQuit = null;
    if (body.seb && !sebKey) {
      // SEB opens the quiz at the address the teacher is using now, which students use too.
      const host = String(req.headers.host || '');
      if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/.test(host)) throw new HttpError(400, 'bad_host', "Open the dashboard at the address students use, then start the quiz again.");
      const made = makeSebConfig(`${isHttps(req) ? 'https' : 'http'}://${host}`, code);
      sebKey = made.key;
      sebConfig = made.xml;
      sebQuit = made.quitPassword;
    }
    q("INSERT INTO runs (id, quiz_id, roster_id, code, status, ip_lock, mode, created_at, owner_id, seb_key, seb_config, seb_quit) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)")
      .run(id, body.quizId, body.rosterId, code, body.ipLock ? clientIp(req) : null, body.practice ? 'practice' : 'exam', Date.now(), me.id, sebKey, sebConfig, sebQuit);
    audit(me, 'open-run', null, code);
    json(res, 200, { id, code });
  });

  // Deletes a run and everything in it: attempts, events, mouse trails, typing replays. A deleted quiz
  // or class that was only kept for this run's results goes too. Anyone still taking it is signed out.
  r.post('/api/t/runs/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    for (const x of q('SELECT id FROM attempts WHERE run_id = ?').all(run.id)) store.forget(x.id);
    tx(() => {
      q('DELETE FROM failed_ids WHERE run_id = ?').run(run.id);
      q('DELETE FROM runs WHERE id = ?').run(run.id);
      if (!q('SELECT 1 FROM runs WHERE quiz_id = ? LIMIT 1').get(run.quiz_id)) q('DELETE FROM quizzes WHERE id = ? AND archived = 1').run(run.quiz_id);
      if (!q('SELECT 1 FROM runs WHERE roster_id = ? LIMIT 1').get(run.roster_id)) q('DELETE FROM rosters WHERE id = ? AND archived = 1').run(run.roster_id);
    });
    store.quizCache.delete(run.quiz_id);
    audit(me, 'delete-run', null, `${run.code} ${quiz ? quiz.title : ''}`);
    json(res, 200, { ok: true });
  });

  // AI grading (aigrade.js): every answer that waits for the teacher in this run, or in one attempt.
  // Runs in the background; the live page shows how far it's got.
  function startAi(me, run, quiz, attempts) {
    const k = aiKeyOf(me);
    if (!k) throw new HttpError(409, 'ai_off', 'Grading here needs an API key: add yours in Grade with AI, or copy and paste instead.');
    const was = aiJobs.get(run.id);
    if (was && was.running) throw new HttpError(409, 'ai_busy', 'AI grading is already running for this quiz.');
    const job = { total: 0, graded: 0, failed: 0, errors: [], running: true, started: Date.now() };
    aiJobs.set(run.id, job);
    const sub = attempts.filter((x) => x && x.status === 'submitted' && x.result);
    AI.gradeAttempts(quiz, sub, { questionScore: G.questionScore, autoMarks: G.autoMarks, isRun: G.isRun, fillTemplate: fillT }, store, (o) => Object.assign(job, o, { running: true }), k)
      .then((o) => Object.assign(job, o, { running: false, ended: Date.now() }))
      .catch((e) => Object.assign(job, { running: false, ended: Date.now(), errors: [String(e.message || e)] }));
    return job;
  }
  // A teacher's own key for grading here (Anthropic, OpenAI or Google): whether there is one (its last four
  // characters, never the key), saving one (checked with its provider first), and removing it.
  r.get('/api/t/ai-key', (req, res) => {
    const me = requireTeacher(req);
    json(res, 200, keyState(me));
  });
  r.post('/api/t/ai-key', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 8 * 1024);
    if (body.key === null) {
      q('UPDATE teachers SET ai_key = NULL WHERE id = ?').run(me.id);
      audit(me, 'ai-key-removed', null, null);
      return json(res, 200, keyState(me));
    }
    const key = String(body.key || '').trim();
    const provider = AI.providerOf(key);
    if (!provider) throw new HttpError(400, 'bad_key', "That doesn't look like an API key from Anthropic (sk-ant-…), OpenAI (sk-…) or Google (AIza…).");
    // ten checks per teacher per 10 minutes, so this isn't a way to test keys against the providers
    const now = Date.now();
    const tries = (keyChecks.get(me.id) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (tries.length >= 10) throw new HttpError(429, 'slow_down', 'Too many keys tried. Wait a few minutes.');
    keyChecks.set(me.id, [...tries, now]);
    const company = AI.PROVIDERS[provider].company;
    const ok = await AI.checkKey({ provider, key });
    if (ok === false) throw new HttpError(400, 'bad_key', `${company} refused that key. Check it where you made it.`);
    if (ok === null) throw new HttpError(502, 'unreachable', `Couldn't check the key with ${company}. Try again in a moment.`);
    q('UPDATE teachers SET ai_key = ? WHERE id = ?').run(V.sealText(V.needKey(me.id), key, aiKeyAad(me.id)), me.id);
    audit(me, 'ai-key-saved', null, company);
    json(res, 200, keyState(me));
  });

  // Grading with any AI chat (aicsv.js): the prompt to copy, and the CSV it answers with, pasted back.
  // ?attempt= narrows both to one student.
  function pasteWork(run, quiz, attemptId) {
    const ids = attemptId ? [attemptId] : q('SELECT id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => x.id);
    const work = [];
    const Gx = { questionScore: G.questionScore, autoMarks: G.autoMarks, isRun: G.isRun, fillTemplate: fillT };
    for (const id of ids) {
      const a = store.getAttempt(id);
      if (!a || a.runId !== run.id || a.status !== 'submitted' || !a.result) continue;
      const tok = AICSV.token(run.id, a.id);
      for (const w of AI.jobsFor(quiz, a, Gx)) work.push({ tok, a, qq: w.qq, job: w.job });
    }
    return work;
  }
  r.get('/api/t/runs/:id/ai-prompt', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const work = pasteWork(run, quiz, new URL(req.url, 'http://x').searchParams.get('attempt'));
    json(res, 200, { answers: work.length, students: new Set(work.map((w) => w.tok)).size, prompt: work.length ? AICSV.buildPrompt(work) : '' });
  });
  r.post('/api/t/runs/:id/ai-csv', async (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const body = await readJson(req, 2 * 1024 * 1024);
    const quiz = store.getQuiz(run.quiz_id);
    const work = pasteWork(run, quiz, typeof body.attempt === 'string' ? body.attempt : null);
    const answers = new Map(work.map((w) => [`${w.tok}.${w.qq.id}`, w]));
    const { grades, skipped, rows } = AICSV.readCsv(typeof body.csv === 'string' ? body.csv : '', answers);
    let applied = 0;
    if (body.apply === true) {
      const touched = new Set();
      for (const [id, g] of grades) {
        const { a, qq, job } = answers.get(id);
        a.result.manual = Object.assign({}, a.result.manual, { [qq.id]: AICSV.toManual(qq, job, g, job.auto) });
        store.logEvent(a, 'ai-grade', 'info', `${qq.id} (pasted)`);
        touched.add(a);
        applied++;
      }
      for (const a of touched) store.save(a);
      audit(me, 'ai-paste', run.id, `${applied} answers`);
    }
    // Before applying: what each grade would be, by student and question (names are for the teacher only).
    let preview;
    if (body.apply !== true) {
      const names = new Map();
      const nameOf = (a) => {
        if (!names.has(a.studentId)) { const st = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId); names.set(a.studentId, st ? st.name : '?'); }
        return names.get(a.studentId);
      };
      preview = [...grades].slice(0, 300).map(([id, g]) => {
        const { a, qq, job } = answers.get(id);
        const n = quiz.questions.indexOf(qq) + 1;
        if (!job.items.length) return { name: nameOf(a), n, qname: qq.name || '', got: g.points, of: qq.points, items: [] };
        const of = job.items.reduce((t, r) => t + r.points, 0);
        const got = job.items.reduce((t, r) => t + (g.items[r.id].met ? r.points : 0), 0);
        return { name: nameOf(a), n, qname: qq.name || '', got, of, items: job.items.map((r) => ({ text: r.text, met: g.items[r.id].met })) };
      }).sort((x, y) => x.name.localeCompare(y.name) || x.n - y.n);
    }
    json(res, 200, { rows, found: grades.size, waiting: work.length, skipped: skipped.slice(0, 20), applied, preview });
  });

  r.post('/api/t/runs/:id/ai-grade', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const attempts = q('SELECT id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => store.getAttempt(x.id));
    const job = startAi(me, run, quiz, attempts);
    audit(me, 'ai-grade', run.id, null);
    json(res, 200, { ok: true, job });
  });
  r.post('/api/t/attempts/:id/ai-grade', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const job = startAi(me, run, quiz, [a]);
    audit(me, 'ai-grade', a.id, null);
    json(res, 200, { ok: true, job });
  });

  // Corrections for an exam: a new practice run (no lockdown) where each student redoes what they missed.
  r.post('/api/t/runs/:id/corrections', async (req, res, p) => {
    const me = requireTeacher(req);
    const exam = getRun(me, p.id);
    if (exam.mode === 'practice' || exam.corrects) throw new HttpError(400, 'not_an_exam', 'Corrections are for a quiz given as an exam.');
    const body = await readJson(req, 4096);
    const earnBack = [0, 0.5, 1].includes(Number(body.earnBack)) ? Number(body.earnBack) : 0.5;
    const id = crypto.randomUUID();
    const code = newJoinCode();
    q("INSERT INTO runs (id, quiz_id, roster_id, code, status, ip_lock, mode, created_at, owner_id, corrects, earn_back, ask_why) VALUES (?, ?, ?, ?, 'open', NULL, 'practice', ?, ?, ?, ?, ?)")
      .run(id, exam.quiz_id, exam.roster_id, code, Date.now(), me.id, exam.id, earnBack, body.why ? 1 : 0);
    audit(me, 'open-corrections', exam.id, code);
    json(res, 200, { id, code });
  });

  r.post('/api/t/runs/:id/:action', async (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    if (p.action === 'close') {
      q("UPDATE runs SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), run.id);
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'active'").all(run.id)) {
        submit(store.getAttempt(row.id), quiz, null, 'quiz closed');
      }
    } else if (p.action === 'open') {
      q("UPDATE runs SET status = 'open', closed_at = NULL WHERE id = ?").run(run.id);
    } else if (p.action === 'admit-all') {
      // The dashboard sends the students it showed when the teacher checked them in; anyone who joined
      // after that keeps waiting. Without a list (an API caller), everyone waiting.
      const body = await readJson(req, 64 * 1024);
      const only = Array.isArray(body.ids) ? new Set(body.ids.filter((x) => typeof x === 'string').slice(0, 2000)) : null;
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'waiting'").all(run.id)) {
        if (only && !only.has(row.id)) continue;
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
        const t = totals(a.result, quiz, a.answers, a.layout);
        if (!a.result || (t && t.failed)) gradeAttempt(a, quiz).catch(() => {});
      }
    } else throw new HttpError(404, 'not_found');
    audit(me, p.action + '-run', null, run.code);
    json(res, 200, { ok: true });
  });

  r.get('/api/t/runs/:id/live', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const roster = rosterStudentsForRun(run);
    const byStudent = new Map(q('SELECT id, student_id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => [x.student_id, store.getAttempt(x.id)]));
    json(res, 200, {
      run: { id: run.id, code: run.code, status: run.status, ipLock: !!run.ip_lock, released: !!run.released, practice: run.mode === 'practice', seb: !!run.seb_key, sebFile: !!run.seb_config, sebQuit: run.seb_quit || null, title: quiz.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin,
        corrections: run.corrects ? { earnBack: run.earn_back, why: !!run.ask_why } : null,
        // an exam's answers still waiting for the teacher: corrections leave those out
        waiting: !run.corrects && run.mode !== 'practice' ? roster.reduce((n, s) => { const a = byStudent.get(s.id); const t = a && a.status === 'submitted' ? totals(a.result, quiz, a.answers, a.layout) : null; return n + (t ? t.pending + t.review : 0); }, 0) : 0 },
      students: roster.map((s) => liveRow(s, byStudent.get(s.id), quiz, run)),
      ai: { on: !!aiKeyOf(me), job: aiJobs.get(run.id) || null },
    });
  });


  r.get('/api/t/runs/:id/export.csv', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const head = ['name', 'status', 'integrity', 'reason', 'strikes', 'warnings', 'away_seconds', 'raw_score', 'final_score', 'max',
      'grading_pending', 'grading_failed', 'needs_review', 'started_at', 'submitted_at', ...quiz.questions.map((qq, i) => `q${i + 1}_${qq.id}`),
      ...(run.corrects ? ['exam_score', 'earned_back', 'with_corrections'] : [])];
    const lines = [head.join(',')];
    for (const s of rosterStudentsForRun(run)) {
      const row = q('SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, s.id);
      const a = row ? store.getAttempt(row.id) : null;
      const t = a ? totals(a.result, quiz, a.answers, a.layout) : null;
      const given = a && a.layout ? new Set(store.quizFor(quiz, a.layout).questions.map((qq) => qq.id)) : null;
      const perQ = quiz.questions.map((qq) => {
        if (!a || !a.result || (given && !given.has(qq.id))) return ''; // a pool left it out of their quiz
        const sc = questionScore(qq, a.result, a.answers);
        return sc.state === 'done' ? sc.points : sc.state;
      });
      lines.push([s.name, a ? a.status : 'not started', a ? a.integrity : '', a ? a.reason : '', a ? a.strikes : '', a ? a.warnings : '', a ? Math.round((a.awayMs || 0) / 1000) : '',
        t ? t.score : '', t ? (a.integrity === 'invalidated' ? 0 : t.score) : '', t ? t.max : '', t ? t.pending : '', t ? t.failed : '', t ? t.review : '',
        a ? iso(a.startedAt) : '', a ? iso(a.submittedAt) : '', ...perQ,
        ...(run.corrects ? (() => { const c = a && a.status === 'submitted' ? C.standing(quiz, run, a) : null; return c ? [c.exam, c.bonus, c.final] : ['', '', '']; })() : [])].map(esc).join(','));
    }
    send(res, 200, lines.join('\n') + '\n', {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${quiz.title.replace(/[^\w -]/g, '').slice(0, 60) || 'results'} ${run.code}.csv"`,
    });
  });

  r.get('/api/t/attempts/:id', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    const events = q('SELECT t, type, severity, detail FROM events WHERE attempt_id = ? ORDER BY id DESC LIMIT 400').all(a.id);
    const mouse = [];
    for (const m of q('SELECT points FROM mouse WHERE attempt_id = ? ORDER BY rowid DESC LIMIT 60').all(a.id).reverse()) mouse.push(...JSON.parse(m.points));
    json(res, 200, {
      id: a.id, name: student ? student.name : '?', status: a.status, integrity: a.integrity, reason: a.reason,
      invalidatedAt: a.invalidatedAt, strikes: a.strikes, warnings: a.warnings,
      awayMs: (a.awayMs || 0) + store.awayNow(a, Date.now()), awayMax: Math.max(a.awayMax || 0, store.awayNow(a, Date.now())), startedAt: a.startedAt, submittedAt: a.submittedAt,
      deadline: a.deadline, timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - Date.now()) : null,
      totals: totals(a.result, quiz, a.answers, a.layout), answers: answerReport(quiz, a), events,
      quiz: reportQuiz(quiz, run.quiz_id), report: studentReport(quiz, a, student ? student.name : ''), mouse: mouse.slice(-3000), ip: a.ip, userAgent: a.userAgent,
    });
  });

  // Watch a student live (watch.js): their quiz as they see it, then their screen, answers and mouse.
  r.get('/api/t/attempts/:id/watch-start', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    if (!a.layout) throw new HttpError(409, 'not_started');
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    // their clock, as of the watch page's playback (watch.js DELAY)
    json(res, 200, { quiz: publicQuiz(quiz, a.layout), quizId: run.quiz_id, answers: a.answers || {}, name: student ? student.name : '', deadline: a.deadline || null, now: Date.now(), delay: 2500, practice: run.mode === 'practice' });
  });
  r.get('/api/t/attempts/:id/watch', (req, res, p) => {
    const me = requireTeacher(req);
    const { a } = getAttemptRun(me, p.id);
    const url = new URL(req.url, 'http://x');
    const now = Date.now();
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    // The answers only when they've changed since the version the page has.
    const text = JSON.stringify(a.answers || {});
    const ver = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
    // How it was turned in, for the same "done" screen the student got (app.js DONE)
    let ended = null;
    if (a.status === 'submitted') {
      const ev = q("SELECT detail FROM events WHERE attempt_id = ? AND type = 'submit' ORDER BY id DESC LIMIT 1").get(a.id);
      const why = ev ? ev.detail : null;
      ended = why === 'time ran out' ? 'time' : why === 'quiz closed' ? 'ended' : why === 'ended by teacher' ? 'mine'
        : a.deadline && a.submittedAt >= a.deadline - 1500 ? 'time' : 'submitted';
    }
    json(res, 200, {
      name: student ? student.name : '?', runId: a.runId, status: a.status, integrity: a.integrity, now, ver, ended, submittedAt: a.submittedAt || null, deadline: a.deadline || null,
      timeLeft: a.status === 'active' && a.deadline ? Math.max(0, a.deadline - now) : null,
      away: !!store.awayNow(a, now) || !!a.away,
      answers: url.searchParams.get('ver') === ver ? undefined : (a.answers || {}),
      ...W.look(a, url.searchParams.get('since'), now, url.searchParams.get('xver')),
    });
  });

  r.get('/api/t/attempts/:id/report', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { quiz: reportQuiz(quiz, run.quiz_id), students: [studentReport(quiz, a, student ? student.name : '')] });
  });

  r.get('/api/t/runs/:id/report', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const rows = q(`SELECT attempts.id, roster_students.name FROM attempts JOIN roster_students ON roster_students.id = attempts.student_id
      WHERE attempts.run_id = ? AND attempts.archived = 0 AND attempts.status = 'submitted' ORDER BY roster_students.name`).all(run.id);
    const attempts = rows.map((x) => store.getAttempt(x.id));
    json(res, 200, {
      quiz: reportQuiz(quiz, run.quiz_id), students: rows.map((x, i) => studentReport(quiz, attempts[i], x.name)),
      similar: similarCode(quiz, attempts.map((attempt, who) => ({ who, attempt }))), // who: a place in students
    });
  });

  // Quiz images for the report page (students get theirs through /asset/ with their own cookie).
  r.get('/api/t/quizzes/:id/asset', (req, res, p) => {
    const me = requireTeacher(req);
    const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
    const quizId = q('SELECT id FROM quizzes WHERE id = ? AND owner_id = ?').get(String(p.id || ''), me.id);
    const row = quizId && store.getAsset(quizId.id, rel);
    if (!row) throw new HttpError(404, 'not_found');
    send(res, 200, Buffer.from(row.bytes), { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  });

  r.post('/api/t/attempts/:id/:action', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    const { a, run } = getAttemptRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const note = String(body.note || '').slice(0, 300);
    if (p.action === 'admit') {
      if (a.status === 'waiting') { a.status = 'admitted'; store.logEvent(a, 'admit', 'info', null); store.save(a); }
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
      a.result.manual = Object.assign({}, a.result.manual, { [qq.id]: Object.assign({ rubric, override, reviewed: true }, ai ? { ai } : {}) });
      store.logEvent(a, 'grade', 'info', `${qq.id}: ${override != null ? override + ' pts (override)' : Object.keys(rubric).length + ' rubric item(s)'}`);
      store.save(a);
    } else throw new HttpError(404, 'not_found');
    audit(me, p.action, a.id, note);
    json(res, 200, { ok: true });
  });
};
