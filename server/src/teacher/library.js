'use strict';
// Quizzes and classes as stored (saving a quiz, the quiz.json it came from, reading a class list), and
// signing in (sessions, sign-in limits, known devices).

const { isRun } = require('../grade');
const { runnerConfigured, checkOutputs, checkReferences, runnerLanguages, missingLanguages } = require('../coderun');
const T = require('../../../public/teacher/types.js');
const { QuizError, markdownImages } = require('../quizfile');
const { json, HttpError, newToken, sha256, setCookie, cookies } = require('../http');
const { q, tx } = require('../db');
const store = require('../store');
const crypto = require('node:crypto');
const V = require('../vault');
const Rekey = require('../rekey');
const path = require('node:path');
const fs = require('node:fs');
const { SESSION_MS, TCH, parseCsv } = require('./common');

// ---------- quizzes: shared by upload, the quiz maker and preview ----------
async function checkQuiz(quiz) {
  const hasRefs = quiz.questions.some((qq) => isRun(qq) && Object.keys(qq.reference || {}).length);
  const outputs = quiz.questions.filter((qq) => qq.type === 'output');
  if (!quiz.questions.some((qq) => isRun(qq) || qq.type === 'output')) return;
  if (!runnerConfigured()) {
    if (hasRefs || outputs.some((qq) => qq.answer == null)) throw new QuizError('This quiz has code to run, but the code runner is not set up.');
    return;
  }
  // The standard runner has Java, Python, JavaScript and TypeScript: a question in another language says so
  const have = await runnerLanguages();
  const short = quiz.questions.map((qq, i) => [i, missingLanguages(have, qq)]).filter(([, m]) => m.length);
  if (short.length) {
    const names = (ls) => ls.map((l) => T.LANG_NAMES[l]).join(', ');
    throw new QuizError(`This server's code runner has ${names(have)}. ${short.slice(0, 5).map(([i, m]) => `Question ${i + 1} needs ${names(m)}.`).join(' ')}`
      + ' To run the others, switch to the full runner (docs/setup.md, "Languages").');
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
    // every earlier version now points at this one (rekey.js)
    if (replaces) q('UPDATE quizzes SET replaced_by = ? WHERE owner_id = ? AND (id = ? OR replaced_by = ?)').run(id, me.id, replaces, replaces);
    if (replaces) retireQuiz(replaces);
  });
  return id;
}
// Runs given with an earlier version of this quiz whose answers differ from this one's: what the quiz
// maker offers to update after a save ("Update past scores?").
function staleRuns(me, quizId) {
  const head = store.getQuiz(quizId);
  const out = [];
  for (const row of q(`SELECT runs.id, runs.quiz_id, rosters.name AS roster FROM runs JOIN rosters ON rosters.id = runs.roster_id
      WHERE runs.owner_id = ? AND runs.quiz_id IN (SELECT id FROM quizzes WHERE replaced_by = ? AND owner_id = ?) ORDER BY runs.created_at`).all(me.id, quizId, me.id)) {
    const m = Rekey.merge(store.getQuiz(row.quiz_id), head);
    if (m.changed.length) out.push({ id: row.id, quizId: row.quiz_id, roster: row.roster, changed: m.changed });
  }
  return out;
}
// Graded by the teacher: written answers, and rubric items the server can't check (no require/forbid)
const handGraded = (qq) => qq.type === 'essay' || (qq.rubric || []).some((r) => r.points > 0 && !r.require && !r.forbid);
function getQuizRow(me, id) {
  const row = q('SELECT id, title FROM quizzes WHERE id = ? AND owner_id = ?').get(String(id || ''), me.id);
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
// The stored (normalized) quiz back in the shape people write, for the quiz maker and downloads.
function quizSource(quiz) {
  const out = { format: 1, title: quiz.title, timeLimitMin: quiz.timeLimitMin, language: quiz.language,
    shuffleQuestions: quiz.shuffleQuestions, shuffleChoices: quiz.shuffleChoices, integrity: quiz.integrity };
  if (quiz.lockParts && !quiz.timedParts) out.lockParts = true; // timed sections lock their parts anyway
  if (quiz.turnInEarly) out.turnInEarly = true;
  if (quiz.calculator) out.calculator = quiz.calculator;
  if (Object.keys(quiz.directions || {}).length) out.directions = quiz.directions;
  if (quiz.shared && quiz.shared.length) out.shared = quiz.shared;
  if (quiz.sections && quiz.sections.length) out.sections = quiz.sections;
  if (quiz.pools) out.pools = quiz.pools;
  out.questions = quiz.questions.map((qq) => {
    const o = { id: qq.id, type: qq.type, prompt: qq.prompt, points: qq.points };
    if (qq.name) o.name = qq.name;
    if (qq.calculator) o.calculator = qq.calculator;
    if (qq.pool) o.pool = qq.pool;
    if (qq.vars) o.vars = qq.vars;
    if (qq.explanation) o.explanation = qq.explanation;
    if (qq.shared) o.shared = qq.shared;
    if (qq.image) { o.image = qq.image; if (qq.imageAlt) o.imageAlt = qq.imageAlt; }
    if (qq.type === 'text') { o.answer = qq.answer; if (qq.caseSensitive) o.caseSensitive = true; }
    if (qq.type === 'math') { o.answer = qq.answer; if (qq.form) o.form = qq.form; if (qq.tolerance) o.tolerance = qq.tolerance; }
    if (qq.type === 'graph') {
      Object.assign(o, { answer: qq.answer, window: qq.window, step: qq.step });
      const need = new Set((qq.rowShapes ? qq.rowShapes.flat() : qq.shapes).map((sh) => sh.kind));
      if (qq.tools.some((k) => !need.has(k))) o.tools = qq.tools; // tools beyond what the answer needs
      if (qq.partialCredit) o.partialCredit = true;
    }
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
      o.languages = qq.languagesAny ? 'any' : qq.languages;
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
const promptRoot = path.join(__dirname, '..', '..', '..');
const readRel = (rel) => fs.readFileSync(path.join(promptRoot, rel), 'utf8');
const promptFormat = () => readRel('docs/quiz-format.md')
  .replace(/<!-- not-in-prompt -->[\s\S]*?<!-- \/not-in-prompt -->\n?/g, '')
  .replace(/^# .*\n+/, '')
  .replace(/^### /gm, '#### ')
  .replace(/^## /gm, '### ')
  .trim();
function quizPrompt() {
  const example = readRel('examples/sample-exam/quiz.json').trim();
  return readRel('server/prompt/quiz-prompt.md').replace('{{FORMAT}}', promptFormat).replace('{{EXAMPLE}}', () => example);
}
// The prompt for one question, to add to the quiz being made: the quiz prompt's rules for writing
// questions (difficulty, length, fairness, checking), so both write questions the same way.
function questionPrompt() {
  const quiz = readRel('server/prompt/quiz-prompt.md');
  const part = (from, to) => quiz.slice(quiz.indexOf(from), quiz.indexOf(to)).trim();
  let n = 1;
  // not the quiz-wide settings (pools, sections, turning in early): one question has none of them
  const section = (text, from, to) => text.slice(0, text.indexOf(from)) + text.slice(text.indexOf(to));
  const rules = [section(part('## 3. Difficulty', '## 7. Images'), '**The whole quiz**', '**Every question**'), part('## 8. Check your work', '## 9. Your answer')].join('\n\n')
    .replace(/^## \d+\. /gm, () => `## ${++n}. `);
  const { pool, ...sample } = JSON.parse(readRel('examples/sample-exam/quiz.json')).questions.find((x) => x.type === 'single'); // one question has no pool
  return readRel('server/prompt/question-prompt.md').replace('{{RULES}}', () => rules).replace('{{FORMAT}}', promptFormat)
    .replace('{{EXAMPLE}}', () => JSON.stringify(sample, null, 2));
}
// A pasted or uploaded quiz.json (no zip). Images it names must come from somewhere else.
function parseQuizJson(text) {
  try { return JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { throw new QuizError('quiz.json is not valid JSON: ' + e.message); }
}
const imagePaths = (raw) => new Set([...[...(Array.isArray(raw && raw.questions) ? raw.questions : []), ...(Array.isArray(raw && raw.shared) ? raw.shared : [])]
  .map((qq) => (qq && qq.image != null ? String(qq.image).replace(/^\.?\//, '') : null)).filter(Boolean), ...markdownImages(raw)]);

// ---------- rosters ----------
// One student per line, pasted from anywhere: "Name, ID", a spreadsheet (tabs), or a CSV with a header
// row and extra columns ("name, student_id, period" or "first name, last name, id"). Without a header,
// the ID is the field with the most digits; "Martinez, Ava, 204511" keeps "Martinez, Ava" as the name.
// Extra time a student gets on every timed quiz (an accommodation): 1 (standard), 1.25, 1.5 or 2.
const TIME_X = [1, 1.25, 1.5, 2];
const TIME_CELL = /^(1|1\.25|1\.5|2)\s*[x×]$/i;
const parseTimeX = (v) => { const x = Number(String(v).replace(/[x×\s]/gi, '')); return TIME_X.includes(x) ? x : 1; };
function parseRosterText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l, i) => [l, i]).filter(([l]) => l.trim());
  return parseRosterRows(lines.map(([l, i]) => [(l.includes('\t') ? l.split('\t') : parseCsv(l)[0] || []).map((c) => c.trim().replace(/^"|"$/g, '')), i]));
}
// A class from rows of cells ([cells, line index]), pasted or from a CSV file: a header row, if there is one,
// says which column is which (a name, or first and last; an ID), and without one each row's number is its ID.
function parseRosterRows(rows) {
  const students = [];
  const problems = [];
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
    // extra time, as a cell of its own: "1.5x", "2x"
    const tk = cells.findIndex((c) => TIME_CELL.test(c));
    const timeX = tk >= 0 ? parseTimeX(cells[tk]) : 1;
    if (tk >= 0) cells[tk] = '';
    // A row that doesn't line up with the header ("Lee, Jordan, 1003" under "Name, ID": its ID column has no
    // number in it, another one does) is read as if there were no header.
    if (cols && (cols.id < 0 || digits(cells[cols.id] || '') || !cells.some((c) => digits(c)))) {
      name = cols.name >= 0 ? cells[cols.name] : [cells[cols.first], cells[cols.last]].filter(Boolean).join(' ');
      sid = cols.id >= 0 ? cells[cols.id] : '';
    } else {
      // One cell with the ID at an end and no comma ("Ava Martinez 204511", "204511 Ava Martinez")
      const filled = cells.filter(Boolean);
      const split = filled.length === 1 && (/^(.*\D)\s+(\S*\d\S*)$/.exec(filled[0]) || /^(\S*\d\S*)\s+(\D.*)$/.exec(filled[0]));
      if (split) cells.splice(0, cells.length, split[1], split[2]);
      let idIdx = -1;
      cells.forEach((c, k) => { if (digits(c) && (idIdx < 0 || digits(c) >= digits(cells[idIdx]))) idIdx = k; });
      sid = idIdx >= 0 ? cells[idIdx] : '';
      name = cells.filter((c, k) => k !== idIdx && c && !/^\d+$/.test(c)).join(', ');
    }
    name = String(name || '').trim().slice(0, 80);
    sid = String(sid || '').trim().slice(0, 40);
    if (!name || !sid) problems.push(`Line ${i + 1} needs a name and a student ID.`);
    else students.push({ name, sid, timeX });
  }
  return { students, problems };
}
function retireRoster(id) {
  if (q('SELECT 1 FROM runs WHERE roster_id = ? LIMIT 1').get(id)) q('UPDATE rosters SET archived = 1 WHERE id = ?').run(id);
  else q('DELETE FROM rosters WHERE id = ?').run(id);
}
const rosterStudentsForRun = (run) => q(`SELECT id, bq_name(name, id, roster_id) AS name, time_x FROM roster_students WHERE roster_id = ?
  AND (removed = 0 OR id IN (SELECT student_id FROM attempts WHERE run_id = ?)) ORDER BY name`).all(run.roster_id, run.id);

// Signed in, by password or passkey: the session cookie.
function startSession(req, res, teacherId, passkey) {
  // Signing in again in the same browser replaces its session, so Settings counts browsers, not sign-ins.
  const before = cookies(req)[TCH];
  if (before) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(before));
  const token = newToken();
  q('INSERT INTO sessions (token_hash, created_at, teacher_id, passkey) VALUES (?, ?, ?, ?)').run(sha256(token), Date.now(), teacherId, passkey ? 1 : 0);
  q('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_MS);
  setCookie(req, res, TCH, token, SESSION_MS / 1000);
}

// Password guesses: each address gets 10 a minute and everyone together 60, counted before the check so
// firing them all at once doesn't help. A spent budget only blocks new sign-ins for a minute; teachers already
// signed in keep working, and the right password refunds its try.
const loginBuckets = new Map();
// Wrong passwords for one account, from anywhere: after 5 in a row it waits 30 seconds, doubling with each
// further miss up to 15 minutes. A browser the teacher has signed in from before skips the wait, so a
// student can't lock the teacher out by guessing on purpose (the device cookie, signed with ID_PEPPER).
const acctFails = new Map(); // username -> { n, until }
const TDEV = 'tdev';
// Signed with the password's hash too: changing the password (or an admin reset) forgets every browser.
const devSig = (t, r) => crypto.createHmac('sha256', String(process.env.ID_PEPPER || '')).update(`tdev:${t.id}:${r}:${t.pw_hash || ''}`).digest('base64url');
const devMisses = new Map(); // device -> wrong passwords typed in it: 5 and it's no longer known
function knownDevice(req, t) {
  const [id, r, sig] = String(cookies(req)[TDEV] || '').split('.');
  if (!id || !r || !sig || id !== String(t.id) || (devMisses.get(r) || 0) >= 5) return false;
  const want = Buffer.from(devSig(t, r));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
function loginBucket(key, cap, refillMs) {
  const now = Date.now();
  if (loginBuckets.size > 5000) for (const [k, b] of loginBuckets) if (now - b.at > 600000) loginBuckets.delete(k);
  const b = loginBuckets.get(key) || { n: cap, at: now, cap };
  b.n = Math.min(cap, b.n + (now - b.at) / refillMs);
  b.at = now;
  loginBuckets.set(key, b);
  return b;
}

// The preview's layout: the quiz as written, choices unshuffled, the first row of any random values.
function previewLayout(quiz) {
  return { order: quiz.questions.map((qq) => qq.id), perms: Object.fromEntries(quiz.questions.filter((qq) => qq.choices).map((qq) => [qq.id, qq.choices.map((_, i) => i)])), vars: {} };
}

module.exports = { TDEV, acctFails, checkQuiz, devMisses, devSig, getQuizRow, handGraded, imagePaths, knownDevice, loginBucket, parseQuizJson, parseRosterRows, parseRosterText, parseTimeX, previewLayout, questionPrompt, quizError, quizPrompt, quizSource, retireQuiz, retireRoster, rosterStudentsForRun, saveQuiz, staleRuns, startSession };
