'use strict';
// Student API. Every response looks the same whatever the integrity state: the server never tells
// a student about strikes or invalidation.
const crypto = require('node:crypto');
const { q } = require('./db');
const store = require('./store');
const H = require('./harness');
const { runSamples } = require('./coderun');
const { cleanAnswers, gradeAttempt, totals, studentReport, reportQuiz, isRun } = require('./grade');
const { fillTemplate } = require('./quizfile');
const { HttpError, clientIp, sameNetwork, isHttps, cookies, setCookie, json, readJson, limiter, send, sha256, newToken, sleep } = require('./http');

const PEPPER = process.env.ID_PEPPER || '';
const joinFails = limiter(20, 60000);
const nameLookups = limiter(2000, 60000); // per run and IP: a whole class can share one school IP
const runLimit = limiter(1, 3000);
const ATT = 'att';

// Wrong student IDs lock a name for 30s after 5 tries, to slow down guessing. The lock only holds back
// browsers that typed a wrong ID for that name (or have no device cookie), so a classmate can't lock
// someone out of their own sign-in. A new browser gets one try past a lock, and new device cookies are
// rationed per address, which keeps guessing about as slow as before.
const DEV = 'dev';
const devIssues = limiter(60, 10 * 60000); // per address: a class behind one school IP, plus some retries
const devBad = new Map(); // "run student device" -> { n, t }: wrong IDs this browser typed for this name
function deviceOf(req) {
  const d = cookies(req)[DEV];
  return d && /^[A-Za-z0-9_-]{43}$/.test(d) ? d : null;
}
function issueDevice(req, res) {
  if (deviceOf(req) || !devIssues(clientIp(req))) return;
  setCookie(req, res, DEV, newToken(), 12 * 3600);
}
function badTries(key) {
  const e = key && devBad.get(key);
  return e && Date.now() - e.t < 30 * 60000 ? e.n : 0;
}
function noteBadTry(key) {
  if (!key) return;
  const now = Date.now();
  devBad.set(key, { n: badTries(key) + 1, t: now });
  if (devBad.size > 20000) for (const [k, v] of devBad) if (now - v.t > 30 * 60000) devBad.delete(k);
}

const hashSid = (sid) => crypto.createHmac('sha256', PEPPER).update(String(sid).trim()).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Safe Exam Browser: a run with a Config Key only answers SEB running that exam's settings. SEB sends
// X-SafeExamBrowser-ConfigKeyHash on every request: SHA-256 of the request's full URL followed by the
// Config Key. A normal browser doesn't have it, and can't make it without the key.
const sameHash = (got, want) => got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));

// Only Safe Exam Browser running the quiz's settings gets in. Two ways it proves that, each SHA-256 of an
// address followed by the Config Key:
// - the X-SafeExamBrowser-ConfigKeyHash header, for this request's address (SEB for Windows, older Macs)
// - the hash SEB's newer engine (SEB for iPad, newer Macs) gives the page through its JavaScript API, for
//   the page's own address. The page sends both along (api.js); the address has to be one of ours.
function requireSeb(req, run) {
  if (!run.seb_key) return;
  const origin = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
  const header = String(req.headers['x-safeexambrowser-configkeyhash'] || '').toLowerCase();
  if (header && sameHash(header, sha256(origin + req.url + run.seb_key))) return;
  let pages = [req.headers['x-bq-seb-page'], req.headers['x-bq-seb-first']];
  let key = req.headers['x-bq-seb-key'];
  if (!key && req.url.includes('sebkey=')) { // pictures: <img> can't send headers, so they come in the address
    const u = new URL(req.url, origin);
    pages = [u.searchParams.get('seb'), u.searchParams.get('sebfirst')];
    key = u.searchParams.get('sebkey');
  }
  key = String(key || '').toLowerCase();
  // the address the hash was made for: the page now, or as it first loaded (before the app dropped ?code=)
  const ours = (page) => { try { const u = new URL(String(page || '')); return u.origin === origin && (u.pathname === '/' || u.pathname === '/index.html'); } catch (e) { return false; } };
  if (/^[0-9a-f]{64}$/.test(key) && pages.some((page) => ours(page) && sameHash(key, sha256(page + run.seb_key)))) return;
  // seb_launch: BrowserQuiz made the settings, so the join page can start SEB with them.
  throw new HttpError(403, run.seb_config ? 'seb_launch' : 'seb_required');
}

function openRun(runId, req) {
  const run = q('SELECT * FROM runs WHERE id = ?').get(String(runId || ''));
  if (!run) throw new HttpError(404, 'bad_code');
  if (run.status !== 'open') throw new HttpError(403, 'run_closed');
  if (run.ip_lock && !sameNetwork(clientIp(req), run.ip_lock)) throw new HttpError(403, 'wrong_network');
  requireSeb(req, run);
  return run;
}

// The attempt behind this browser's cookie, plus its run and quiz.
function current(req, { mustBeOpen = true } = {}) {
  const a = store.attemptByToken(cookies(req)[ATT]);
  if (!a || a.archived) throw new HttpError(401, 'no_attempt');
  const run = q('SELECT * FROM runs WHERE id = ?').get(a.runId);
  if (!run) throw new HttpError(401, 'no_attempt');
  a.practice = run.mode === 'practice';
  requireSeb(req, run);
  if (mustBeOpen && run.status !== 'open' && a.status !== 'active') throw new HttpError(403, 'run_closed');
  const ip = clientIp(req);
  if (run.ip_lock && !sameNetwork(ip, run.ip_lock)) {
    if (a.status === 'active' && !a.flagged.has('net')) { a.flagged.add('net'); store.record(a, 'other-network', ip, store.getQuiz(run.quiz_id)); }
    throw new HttpError(403, 'wrong_network');
  }
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  if (a.status === 'active' && a.userAgent && ua !== a.userAgent && !a.flagged.has('ua')) {
    a.flagged.add('ua');
    store.record(a, 'other-device', ua.slice(0, 120), store.getQuiz(run.quiz_id));
  }
  return { a, run, quiz: store.getQuiz(run.quiz_id) };
}

function publicQuiz(quiz, layout) {
  const byId = new Map(quiz.questions.map((qq) => [qq.id, qq]));
  const used = new Set(quiz.questions.map((qq) => qq.shared).filter(Boolean));
  return {
    title: quiz.title,
    timeLimitMin: quiz.timeLimitMin,
    language: quiz.language,
    directions: quiz.directions,
    shared: Object.fromEntries((quiz.shared || []).filter((m) => used.has(m.id)).map((m) => [m.id, { title: m.title, text: m.text, image: m.image || null, imageAlt: m.imageAlt || '' }])),
    questions: layout.order.map((id) => {
      const qq = byId.get(id);
      const pub = { id, type: qq.type, prompt: qq.prompt, points: qq.points };
      if (qq.name) pub.name = qq.name;
      if (qq.shared) pub.shared = qq.shared;
      if (qq.image) { pub.image = qq.image; pub.imageAlt = qq.imageAlt || ''; }
      if (qq.choices) pub.choices = layout.perms[id].map((i) => qq.choices[i]); // positions only
      // New types: what's needed to show the question, never the answers.
      if (qq.type === 'output') Object.assign(pub, { code: qq.code, codeLang: qq.language });
      if (qq.type === 'trace') {
        Object.assign(pub, {
          code: qq.code, codeLang: qq.language, columns: qq.columns,
          cells: qq.rows.map((r, ri) => r.map((v, ci) => (qq.given.some((g) => g[0] === ri && g[1] === ci) ? v : null))),
        });
      }
      if (qq.type === 'fill') {
        Object.assign(pub, { code: qq.code, codeLang: qq.language, blanks: qq.answer.length, run: !!qq.run });
        if (qq.run) {
          pub.samples = qq.tests.sample.map((t) => ({ call: { [qq.language]: H.callText(qq, t, qq.language) }, expected: { [qq.language]: H.expectedText(qq, t, qq.language) } }));
        }
      }
      if (qq.type === 'essay') pub.codeLang = qq.language || null;
      if (qq.type === 'code') {
        pub.mode = qq.mode;
        pub.languages = qq.languages;
        pub.starter = Object.fromEntries(qq.languages.map((l) => [l, H.starterCode(qq, l)]));
        pub.samples = qq.tests.sample.map((t) => ({
          call: Object.fromEntries(qq.languages.map((l) => [l, H.callText(qq, t, l)])),
          expected: Object.fromEntries(qq.languages.map((l) => [l, H.expectedText(qq, t, l)])),
        }));
      }
      return pub;
    }),
  };
}

function runInfo(run, quiz) {
  return {
    runId: run.id, title: quiz.title, timeLimitMin: quiz.timeLimitMin,
    questionCount: quiz.questions.length,
    // What's on the quiz, for the start screen: types, points and names, never prompts. Numbers only when
    // every student gets the same order.
    outline: quiz.questions.map((qq, i) => Object.assign({ type: qq.type, points: qq.points }, qq.name ? { name: qq.name } : {}, quiz.shuffleQuestions ? {} : { n: i + 1 })),
    hasCode: quiz.questions.some((qq) => qq.type !== 'single' && qq.type !== 'multi' && qq.type !== 'text'),
    practice: run.mode === 'practice',
    seb: !!run.seb_key, // SEB keeps the window locked full screen itself
    sebQuit: !!run.seb_config, // our settings: opening seb-quit.html closes SEB
  };
}

// Answers stop saving a little after time runs out (slow networks get a few seconds). The attempt itself
// stays open until the sweeper turns it in, so a late student still gets a normal "submitted" screen.
const ANSWER_GRACE_MS = 10000;
const pastDeadline = (a, now) => !!a.deadline && now > a.deadline + ANSWER_GRACE_MS;

function submit(a, quiz, answers, why) {
  if (a.status !== 'active') return;
  const now = Date.now();
  if (answers && !pastDeadline(a, now)) a.answers = cleanAnswers(quiz, a.layout, answers);
  if (a.deadline && now > a.deadline + 30000 && why === 'student') store.record(a, 'late-submit', Math.round((now - a.deadline) / 1000) + 's late', quiz);
  store.back(a, now); // turned in while out of the window: the time away stops here
  a.status = 'submitted';
  a.submittedAt = now;
  store.logEvent(a, 'submit', 'info', why === 'student' ? null : why);
  store.save(a);
  gradeAttempt(a, quiz).catch((e) => console.error('grading failed', a.id, e));
}

module.exports = function studentRoutes(r) {
  r.post('/api/join', async (req, res) => {
    const ip = clientIp(req);
    const body = await readJson(req, 4096);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const run = code.length === 6 ? q("SELECT * FROM runs WHERE code = ? AND status = 'open'").get(code) : null;
    if (!run) {
      if (!joinFails(ip)) throw new HttpError(429, 'too_many');
      throw new HttpError(404, 'bad_code');
    }
    if (run.ip_lock && !sameNetwork(ip, run.ip_lock)) throw new HttpError(403, 'wrong_network');
    requireSeb(req, run);
    issueDevice(req, res);
    json(res, 200, runInfo(run, store.getQuiz(run.quiz_id)));
  });

  // The .seb file for a quiz BrowserQuiz made SEB settings for. Opening it (or the seb:// / sebs:// link
  // to it) starts SEB on the join page. It holds no secrets: the same settings are on every student's
  // computer anyway.
  r.get('/api/seb/:file', (req, res, p) => {
    const m = /^([A-Za-z0-9]{6})\.seb$/.exec(String(p.file || ''));
    const run = m ? q("SELECT code, seb_config FROM runs WHERE code = ? AND status = 'open'").get(m[1].toUpperCase()) : null;
    if (!run || !run.seb_config) {
      if (!joinFails(clientIp(req))) throw new HttpError(429, 'too_many');
      throw new HttpError(404, 'bad_code');
    }
    send(res, 200, run.seb_config, {
      'Content-Type': 'application/seb', 'Content-Disposition': `attachment; filename="${run.code}.seb"`, 'Cache-Control': 'no-store',
    });
  });

  // Page load: is this browser already signed in? Lets a reloaded page skip the join screens.
  r.post('/api/resume', async (req, res) => {
    let ctx;
    try { ctx = current(req, { mustBeOpen: false }); } catch (e) { return json(res, 200, { status: null }); }
    const { a, run, quiz } = ctx;
    if (run.status !== 'open' && a.status !== 'active' && a.status !== 'submitted') return json(res, 200, { status: null });
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { status: a.status, run: runInfo(run, quiz), name: student ? student.name : '' });
  });

  // Typeahead: only names matching what was typed come back, never the whole roster.
  r.post('/api/names', async (req, res) => {
    const body = await readJson(req, 4096);
    const run = openRun(body.runId, req);
    if (!nameLookups(run.id + ' ' + clientIp(req))) throw new HttpError(429, 'too_many');
    const term = String(body.q || '').trim().slice(0, 60);
    if (term.length < 2) return json(res, 200, { matches: [] });
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const rows = q("SELECT id, name FROM roster_students WHERE roster_id = ? AND removed = 0 AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5").all(run.roster_id, like);
    json(res, 200, { matches: rows.map((x) => ({ id: x.id, name: x.name })) });
  });

  r.post('/api/attempt', async (req, res) => {
    const body = await readJson(req, 4096);
    const run = openRun(body.runId, req);
    const student = q('SELECT * FROM roster_students WHERE id = ? AND roster_id = ? AND removed = 0').get(String(body.rosterId || ''), run.roster_id);
    if (!student) throw new HttpError(400, 'bad_id');
    const now = Date.now();
    const ft = q('SELECT * FROM failed_ids WHERE run_id = ? AND student_id = ?').get(run.id, student.id);
    const dev = deviceOf(req);
    const devKey = dev && `${run.id} ${student.id} ${dev}`;
    if (ft && ft.until > now && (!dev || badTries(devKey) > 0)) throw new HttpError(429, 'name_locked');
    if (!safeEqual(hashSid(body.studentId), student.sid_hash)) {
      noteBadTry(devKey);
      const n = (ft ? ft.n : 0) + 1;
      const until = n >= 5 ? now + 30000 : ft && ft.until > now ? ft.until : 0; // a wrong try never shortens a lock
      q('INSERT INTO failed_ids (run_id, student_id, n, until) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, student_id) DO UPDATE SET n = excluded.n, until = excluded.until')
        .run(run.id, student.id, n >= 5 ? 0 : n, until);
      throw new HttpError(400, 'bad_id');
    }
    if (!(ft && ft.until > now)) q('DELETE FROM failed_ids WHERE run_id = ? AND student_id = ?').run(run.id, student.id);
    if (devKey) devBad.delete(devKey);

    const mine = store.attemptByToken(cookies(req)[ATT]);
    const existingRow = q('SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, student.id);
    const existing = existingRow ? store.getAttempt(existingRow.id) : null;
    const token = newToken();
    if (existing) {
      if (mine && mine.id === existing.id) return json(res, 200, { ok: true });
      // A student who lost their cookie before starting can sign in again. After that, only if the teacher
      // pressed "Let back in" (crashed PC, new seat): they pick up the same attempt, answers and clock.
      // Practice runs aren't monitored, so signing in again anywhere is fine.
      const letIn = run.mode === 'practice' || (existing.letIn && now - existing.letIn < 10 * 60000);
      if (existing.status !== 'waiting' && existing.status !== 'admitted' && !letIn) throw new HttpError(409, 'already_started');
      if (letIn) { existing.letIn = 0; existing.resumeOk = true; }
      if (run.mode === 'practice' && existing.status === 'waiting') { existing.status = 'admitted'; store.save(existing); }
      existing.tokenHash = sha256(token);
      q('UPDATE attempts SET token_hash = ?, ip = ?, user_agent = ? WHERE id = ?').run(existing.tokenHash, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300), existing.id);
      existing.userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
      store.logEvent(existing, 'join', 'info', 'signed in again');
    } else {
      const id = crypto.randomUUID();
      // Practice runs skip the waiting room.
      q(`INSERT INTO attempts (id, run_id, student_id, token_hash, status, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, run.id, student.id, sha256(token), run.mode === 'practice' ? 'admitted' : 'waiting',
        clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300), now);
      store.logEvent(store.getAttempt(id), 'join', 'info', student.name);
    }
    setCookie(req, res, ATT, token, 12 * 3600);
    json(res, 200, { ok: true });
  });

  r.post('/api/admit-status', async (req, res) => {
    const { a } = current(req);
    json(res, 200, { admitted: a.status !== 'waiting' });
  });

  r.post('/api/start', async (req, res) => {
    const { a, run, quiz } = current(req);
    if (a.status === 'waiting') throw new HttpError(403, 'not_admitted');
    if (a.status === 'submitted') throw new HttpError(403, 'run_closed');
    const now = Date.now();
    if (a.status === 'admitted') {
      a.layout = store.makeLayout(quiz);
      a.status = 'active';
      a.startedAt = now;
      a.deadline = quiz.timeLimitMin ? now + quiz.timeLimitMin * 60000 : null;
      a.lastBeat = now;
      store.logEvent(a, 'start', 'info', null);
      store.save(a);
    } else if (a.resumeOk) {
      a.resumeOk = false;
      store.logEvent(a, 'resume', 'info', 'let back in by teacher');
      a.lastBeat = now;
      a.beatLost = false;
    } else {
      store.record(a, 'reload', 'reopened the quiz', quiz);
      a.lastBeat = now;
      a.beatLost = false;
    }
    void run;
    // Saved answers go back in the student's own positional order.
    json(res, 200, { quiz: publicQuiz(quiz, a.layout), deadline: a.deadline, now, saved: a.answers || {} });
  });

  r.post('/api/event', async (req, res) => {
    const body = await readJson(req, 8192);
    let ctx;
    // A locked quiz (its teacher hasn't signed in since a restart) answers 503, so the app queues the
    // event and sends it once the quiz unlocks, instead of it being dropped.
    try { ctx = current(req); } catch (e) { if (e.code === 'locked') throw e; return json(res, 200, { ok: true }); }
    const { a, quiz } = ctx;
    if (a.status === 'active' && store.CLIENT_EVENTS[body.type]) store.record(a, body.type, body.detail, quiz);
    json(res, 200, { ok: true });
  });

  r.post('/api/beat', async (req, res) => {
    const body = await readJson(req, 1024 * 1024);
    const { a, quiz } = current(req);
    const now = Date.now();
    if (a.status === 'active') {
      // Events the client couldn't send while offline arrive here, oldest first.
      // Each keeps the time it happened (after the last good heartbeat, in order), so leaving five times
      // while offline is five strikes, not one burst.
      if (Array.isArray(body.late)) {
        let at = Math.min(now, a.lastBeat || 0);
        for (const e of body.late.slice(0, 50)) {
          if (!Array.isArray(e) || !store.CLIENT_EVENTS[e[0]]) continue;
          const agoMs = Math.max(0, Number(e[2]) || 0);
          at = Math.min(now, Math.max(at, now - agoMs));
          const ago = Math.round(agoMs / 1000);
          store.record(a, e[0], [e[1] ? String(e[1]).slice(0, 120) : null, `sent ${ago}s late`].filter(Boolean).join(', '), quiz, at);
        }
      }
      if (a.beatLost) store.logEvent(a, 'reconnect', 'info', Math.round((now - a.lastBeat) / 1000) + 's offline');
      a.lastBeat = now;
      a.beatLost = false;
      if (body.focused === false || body.visible === false) {
        if (!a.away) store.record(a, 'unfocused-beat', body.visible === false ? 'tab hidden' : 'window not focused', quiz);
      } else {
        store.back(a, now);
      }
      if (Array.isArray(body.mouse) && body.mouse.length) {
        const pts = body.mouse.slice(0, 400).filter((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
          .map((p) => [Math.max(0, Math.min(1000, p[0] | 0)), Math.max(0, Math.min(1000, p[1] | 0)), Math.max(0, p[2] | 0)]);
        if (pts.length) q('INSERT INTO mouse (attempt_id, t, points) VALUES (?, ?, ?)').run(a.id, now, JSON.stringify(pts));
      }
      if (Array.isArray(body.edits) && body.edits.length && a.edits < 20000) {
        const edits = body.edits.slice(0, 300);
        q('INSERT INTO code_edits (attempt_id, t, deltas) VALUES (?, ?, ?)').run(a.id, now, JSON.stringify(edits).slice(0, 400000));
        a.edits += edits.length;
      }
      if (body.answers && !pastDeadline(a, now)) a.answers = cleanAnswers(quiz, a.layout, body.answers);
      store.save(a);
    }
    // done: the attempt was turned in elsewhere (the teacher ended it). Integrity never shows here.
    json(res, 200, { ok: true, now, deadline: a.deadline || null, done: a.status === 'submitted' });
  });

  r.post('/api/run', async (req, res) => {
    const body = await readJson(req, 128 * 1024);
    const { a, quiz } = current(req);
    if (a.status !== 'active') throw new HttpError(403, 'run_closed');
    if (!runLimit(a.id)) throw new HttpError(429, 'too_many');
    const qq = quiz.questions.find((x) => x.id === body.questionId && isRun(x));
    // Fill-in-the-blank: the server fills its own template; students only send the blanks.
    if (qq && qq.type === 'fill') body.code = Array.isArray(body.blanks) ? fillTemplate(qq.code, body.blanks.map((b) => String(b || '').slice(0, 500))) : null;
    if (!qq || !qq.languages.includes(body.language) || typeof body.code !== 'string') throw new HttpError(400, 'bad_request');
    store.logEvent(a, 'run', 'info', `${qq.id} (${body.language === 'python' ? 'Python' : 'Java'})`);
    try {
      json(res, 200, await runSamples(qq, body.language, body.code.slice(0, 50000)));
    } catch (e) {
      json(res, 200, { status: 'error', message: 'Code runner offline. Tell your teacher.' });
    }
  });

  // Practice only: the student's own answers next to the correct ones, once grading is done.
  r.get('/api/practice-review', async (req, res) => {
    const { a, run, quiz } = current(req, { mustBeOpen: false });
    if (!a.practice) throw new HttpError(404, 'not_found');
    if (a.status !== 'submitted') throw new HttpError(409, 'not_submitted');
    const until = Date.now() + 30000;
    while (Date.now() < until && (!a.result || totals(a.result, quiz, a.answers).pending)) await sleep(500);
    const student = q('SELECT name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { quiz: reportQuiz(quiz, run.quiz_id), students: [studentReport(quiz, a, student ? student.name : '', { forStudent: true })] });
  });

  // Practice only: start over with a fresh attempt.
  r.post('/api/practice-retry', async (req, res) => {
    const { a, run } = current(req);
    if (!a.practice) throw new HttpError(404, 'not_found');
    a.archived = true;
    store.save(a);
    store.forget(a.id);
    const id = crypto.randomUUID();
    const token = newToken();
    q(`INSERT INTO attempts (id, run_id, student_id, token_hash, status, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?)`).run(id, run.id, a.studentId, sha256(token), clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300), Date.now());
    store.logEvent(store.getAttempt(id), 'join', 'info', 'practice again');
    setCookie(req, res, ATT, token, 12 * 3600);
    json(res, 200, { ok: true });
  });

  r.post('/api/submit', async (req, res) => {
    const body = await readJson(req, 1024 * 1024);
    const { a, quiz } = current(req, { mustBeOpen: false });
    submit(a, quiz, body.answers, 'student');
    json(res, 200, { ok: true });
  });
};

module.exports.submit = submit;
module.exports.publicQuiz = publicQuiz;
module.exports.current = current;
module.exports.hashSid = hashSid;
module.exports.serveAsset = function serveAsset(req, res, rel) {
  const { run } = current(req, { mustBeOpen: false });
  const row = store.getAsset(run.quiz_id, rel);
  if (!row) throw new HttpError(404, 'not_found');
  send(res, 200, Buffer.from(row.bytes), {
    'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
};
