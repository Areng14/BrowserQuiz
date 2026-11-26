'use strict';
// Running a quiz: starting one, AI grading, and what a teacher does to a run.

const { readJson, HttpError, clientIp, json } = require('../http');
const { q, tx } = require('../db');
const crypto = require('node:crypto');
const { makeConfig: makeSebConfig } = require('../seb');
const store = require('../store');
const AI = require('../aigrade');
const G = require('../grade');
const { totals, gradeAttempt } = require('../grade');
const { fillTemplate: fillT } = require('../quizfile');
const V = require('../vault');
const AICSV = require('../aicsv');
const { submit } = require('../student');
const P = require('../people');
const Pause = require('../pause');
const { addTime, aiJobs, aiKeyAad, aiKeyOf, audit, getAttemptRun, getRun, joinOrigin, keyChecks, keyState, newJoinCode, notWhileOpen, requireTeacher } = require('./common');

module.exports = function runRoutes(r) {
  r.post('/api/t/runs', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    if (!q('SELECT 1 FROM quizzes WHERE id = ? AND owner_id = ? AND archived = 0').get(String(body.quizId || ''), me.id)) throw new HttpError(400, 'bad_quiz');
    if (!q('SELECT 1 FROM rosters WHERE id = ? AND owner_id = ? AND archived = 0').get(String(body.rosterId || ''), me.id)) throw new HttpError(400, 'bad_roster');
    // corrections show the right answers when turned in: no exam of the same quiz while they're open
    if (!body.practice && q("SELECT 1 FROM runs WHERE quiz_id = ? AND owner_id = ? AND corrects IS NOT NULL AND status = 'open'").get(String(body.quizId), me.id)) {
      throw new HttpError(409, 'corrections_open', 'Corrections for this quiz are open. Close them first.');
    }
    // Safe Exam Browser: settings BrowserQuiz makes (seb), or the Config Key of the teacher's own .seb
    // file from SEB Config Tool (sebKey, 64 hex digits).
    let sebKey = body.sebKey ? String(body.sebKey).trim().toLowerCase() : null;
    if (sebKey && !/^[0-9a-f]{64}$/.test(sebKey)) throw new HttpError(400, 'bad_seb_key', "The Config Key is 64 letters and digits. Copy it from SEB Config Tool's Exam tab.");
    const id = crypto.randomUUID();
    const code = newJoinCode();
    let sebConfig = null;
    let sebQuit = null;
    if (body.seb && !sebKey) {
      // SEB opens the quiz where students join (on localhost: this computer's network address).
      const origin = joinOrigin(req);
      if (!origin) throw new HttpError(400, 'bad_host', "Students can't reach localhost. Start BrowserQuiz with the setup script, or open the dashboard at this computer's network address, then start the quiz again.");
      const made = makeSebConfig(origin, code, undefined, { mute: body.sebMute !== false });
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
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const work = pasteWork(run, quiz, new URL(req.url, 'http://x').searchParams.get('attempt'));
    json(res, 200, { answers: work.length, students: new Set(work.map((w) => w.tok)).size, prompt: work.length ? AICSV.buildPrompt(work) : '' });
  });
  r.post('/api/t/runs/:id/ai-csv', async (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    notWhileOpen(run);
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
        if (!names.has(a.studentId)) { const st = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId); names.set(a.studentId, st ? st.name : '?'); }
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
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const attempts = q('SELECT id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => store.getAttempt(x.id));
    const job = startAi(me, run, quiz, attempts);
    audit(me, 'ai-grade', run.id, null);
    json(res, 200, { ok: true, job });
  });
  r.post('/api/t/attempts/:id/ai-grade', (req, res, p) => {
    const me = requireTeacher(req);
    const { a, run } = getAttemptRun(me, p.id);
    notWhileOpen(run);
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
    // students doing corrections see the right answers afterwards: never while anyone can still take the exam
    if (exam.status === 'open') throw new HttpError(409, 'quiz_open', 'Close the quiz first.');
    const body = await readJson(req, 4096);
    // the share of lost points a fixed answer earns back, 0 to 1, in whole percents
    const eb = Number(body.earnBack);
    if (body.earnBack != null && body.earnBack !== '' && !(Number.isFinite(eb) && eb >= 0 && eb <= 1)) throw new HttpError(400, 'bad_earn_back', 'Earn back is a percentage from 0 to 100.');
    const earnBack = body.earnBack == null || body.earnBack === '' ? 0.5 : Math.round(eb * 100) / 100;
    const id = crypto.randomUUID();
    const code = newJoinCode();
    q("INSERT INTO runs (id, quiz_id, roster_id, code, status, ip_lock, mode, created_at, owner_id, corrects, earn_back, ask_why) VALUES (?, ?, ?, ?, 'open', NULL, 'practice', ?, ?, ?, ?, ?)")
      .run(id, exam.quiz_id, exam.roster_id, code, Date.now(), me.id, exam.id, earnBack, body.why ? 1 : 0);
    q('UPDATE runs SET had_corrections = 1 WHERE id = ?').run(exam.id); // for good, even if they're deleted
    audit(me, 'open-corrections', exam.id, code);
    json(res, 200, { id, code });
  });

  r.post('/api/t/runs/:id/:action', async (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    if (p.action === 'close') {
      q("UPDATE runs SET status = 'closed', closed_at = ?, paused_at = NULL WHERE id = ?").run(Date.now(), run.id);
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'active'").all(run.id)) {
        submit(store.getAttempt(row.id), quiz, null, 'quiz closed');
      }
    } else if (p.action === 'open') {
      // its corrections have shown the right answers: reopened, the exam could be taken with them
      if (run.had_corrections || q('SELECT 1 FROM runs WHERE corrects = ? AND owner_id = ?').get(run.id, me.id)) throw new HttpError(409, 'has_corrections', "This quiz has corrections, so it can't reopen.");
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
        a.admittedAt = Date.now(); // the moment the teacher started them (student.js /api/start)
        store.logEvent(a, 'admit', 'info', null);
        store.save(a);
      }
    } else if (p.action === 'message') {
      const body = await readJson(req, 8192);
      const text = String(body.text || '').trim().slice(0, 500);
      if (text) store.notices.set(run.id, { id: Date.now(), text }); else store.notices.delete(run.id);
      audit(me, 'message', run.id, text.slice(0, 100));
    } else if (p.action === 'lock') {
      // Your network, and every network your students are already on (the teacher's laptop can be on staff
      // wifi or a hotspot while the class is on the student network): locking never kicks the class out.
      const nets = new Set([clientIp(req)]);
      for (const row of q('SELECT id, ip, pin_ip FROM attempts WHERE run_id = ? AND archived = 0').all(run.id)) {
        for (const f of ['ip', 'pin_ip']) { const x = P.tryField(run.id, row.id, f, row[f]); if (x) nets.add(String(x)); }
      }
      q('UPDATE runs SET ip_lock = ? WHERE id = ?').run([...nets].filter(Boolean).slice(0, 50).join(','), run.id);
    } else if (p.action === 'unlock') {
      q('UPDATE runs SET ip_lock = NULL WHERE id = ?').run(run.id);
    } else if (p.action === 'pause' || p.action === 'resume') {
      // A fire drill, a question for the whole class: every clock stops, and the questions are hidden
      // (pause.js). Resumed, everyone has the time they had left.
      const now = Date.now();
      if (p.action === 'pause' && run.status !== 'open') throw new HttpError(409, 'run_closed');
      if ((p.action === 'pause') === !!run.paused_at) return json(res, 200, { ok: true }); // already so
      tx(() => {
        q('UPDATE runs SET paused_at = ? WHERE id = ?').run(p.action === 'pause' ? now : null, run.id);
        for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'active'").all(run.id)) {
          const a = store.getAttempt(row.id);
          if (p.action === 'pause') {
            a.pausedAt = now;
            store.logEvent(a, 'pause', 'info', null);
          } else {
            const d = Pause.shift(a, run.paused_at, now);
            a.pausedAt = 0;
            store.logEvent(a, 'unpause', 'info', d ? `paused ${Math.floor(d / 60000)}:${String(Math.floor(d / 1000) % 60).padStart(2, '0')}` : null);
            store.save(a);
          }
        }
      });
      // waiting and turned-in attempts in memory pick it up too (student.js current sets it on each request)
      for (const a of store.attempts.values()) if (a.runId === run.id) a.pausedAt = p.action === 'pause' ? now : 0;
    } else if (p.action === 'extend') {
      // a fire drill, the wifi down, a late start: more time for everyone still working
      const body = await readJson(req, 1024);
      const mins = Math.round(Number(body.minutes));
      if (!(mins >= 1 && mins <= 120)) throw new HttpError(400, 'bad_request');
      for (const row of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'active'").all(run.id)) addTime(store.getAttempt(row.id), mins, run);
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
};
