'use strict';
// Student API. Every response looks the same whatever the integrity state: the server never tells
// a student about strikes or invalidation.
const crypto = require('node:crypto');
const { q } = require('./db');
const store = require('./store');
const P = require('./people');
const H = require('./harness');
const T = require('../../public/teacher/types.js');
const W = require('./watch');
const { runSamples } = require('./coderun');
const { cleanAnswers, gradeAttempt, totals, studentReport, reportQuiz, isRun } = require('./grade');
const { fillTemplate, calculatorOf } = require('./quizfile');
const C = require('./corrections');
const Parts = require('./parts');
const Pause = require('./pause');
const { HttpError, addressKey, clientIp, trustedIp, sameNetwork, isHttps, cookies, setCookie, json, readJson, limiter, send, sha256, newToken, sleep } = require('./http');

const PEPPER = process.env.ID_PEPPER || '';
const joinFails = limiter(20, 60000); // wrong join codes, per address (an IPv6 /48)
const nameLookups = limiter(400, 5 * 60000); // per run and address: a whole class can share one school IP
const runLimit = limiter(1, 3000);
const runsGoing = new Set(); // students with a Run in progress: one at a time, so nobody can hog the runner
const practiceAgain = limiter(5, 10 * 60000); // practice tries per student: each one grades every hidden test
const ATT = 'att';

// Wrong student IDs lock a name for 30s after 5 tries, to slow down guessing. The lock only holds back
// browsers that typed a wrong ID for that name (or have no device cookie), so a classmate can't lock
// someone out of their own sign-in. A new browser gets one try past a lock, and new device cookies are
// rationed per address, which keeps guessing about as slow as before.
const DEV = 'dev';
const devIssues = limiter(60, 10 * 60000); // per address: a class behind one school IP, plus some retries
const devBad = new Map(); // "run student device" -> { n, t }: wrong IDs this browser typed for this name
// Signed, so a browser can't make up a fresh one for every guess: new ones only come from issueDevice. And
// dated, so a stash collected earlier stops working after 12 hours, like the cookie itself.
const DEV_MS = 12 * 3600 * 1000;
const devSig = (r, t) => crypto.createHmac('sha256', PEPPER).update(`dev:${r}:${t}`).digest('base64url').slice(0, 22);
function deviceOf(req) {
  const m = /^([A-Za-z0-9_-]{43})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(String(cookies(req)[DEV] || ''));
  if (!m || !sameHash(m[3], devSig(m[1], m[2]))) return null;
  const at = parseInt(m[2], 36);
  return Date.now() - at < DEV_MS && at <= Date.now() + 60000 ? m[1] : null;
}
const deviceHash = (dev) => sha256('device ' + dev).slice(0, 32);
function issueDevice(req, res) {
  if (deviceOf(req) || !devIssues(addressKey(clientIp(req)))) return;
  const r = newToken();
  const t = Date.now().toString(36);
  setCookie(req, res, DEV, `${r}.${t}.${devSig(r, t)}`, DEV_MS / 1000);
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

// The network lock: the teacher's network, plus (when it was turned on mid-quiz) the networks the class
// was already on, comma-separated, so locking never shuts out students already taking it.
const onLockedNetwork = (ip, lock) => String(lock).split(',').some((l) => sameNetwork(ip, l.trim()));

function openRun(runId, req) {
  const run = q('SELECT * FROM runs WHERE id = ?').get(String(runId || ''));
  if (!run) throw new HttpError(404, 'bad_code');
  if (run.status !== 'open') throw new HttpError(403, 'run_closed');
  if (run.ip_lock && !onLockedNetwork(clientIp(req), run.ip_lock)) throw new HttpError(403, 'wrong_network');
  requireSeb(req, run);
  return run;
}

// Pinned to the network they started on: no carrying on from home or a phone's hotspot, even in the
// same browser, until the teacher lets them back in (which moves the pin to where they sign in).
// ip: trustedIp, null when the address can't be told (then there's no pin to check).
function checkPin(a, run, ip) {
  if (a.status !== 'active' || run.mode === 'practice' || !a.pinIp || !ip || sameNetwork(ip, a.pinIp)) return;
  if (!a.flagged.has('pin')) { a.flagged.add('pin'); store.record(a, 'left-network', ip, store.getQuiz(run.quiz_id)); }
  throw new HttpError(403, 'other_network');
}

// The attempt behind this browser's cookie, plus its run and quiz.
// Extra time for this student (roster_students.time_x): their own time limit, in minutes.
function timeX(studentId) {
  const s = q('SELECT time_x FROM roster_students WHERE id = ?').get(studentId);
  const x = s ? Number(s.time_x) : 1;
  return Number.isFinite(x) && x >= 1 && x <= 3 ? x : 1;
}
const myLimit = (quiz, studentId) => (quiz.timeLimitMin ? Math.round(quiz.timeLimitMin * timeX(studentId)) : quiz.timeLimitMin);

// The same area of the internet, for comparing a student's quizzes: the same public /24 (schools often
// have a few addresses next to each other), the same IPv6 /48, or both on private networks.
function sameArea(x, y) {
  x = String(x || '').replace(/^::ffff:/i, '');
  y = String(y || '').replace(/^::ffff:/i, '');
  if (x === y) return true;
  if (sameNetwork(x, y)) return true;
  const a = x.split('.');
  const b = y.split('.');
  return a.length === 4 && b.length === 4 && a.slice(0, 3).join('.') === b.slice(0, 3).join('.');
}
// A network the student hasn't started a quiz from before (their earlier exams for this teacher, in any
// class, matched by student ID). Evidence only: a new school address or a phone hotspot explains it too.
// Checked when they sign in, so the teacher sees it before admitting them (teacher/common.js liveRow checks),
// and again at the start in case the address changed in between. Logged once per attempt.
function noteNewNetwork(a, run, quiz, ip) {
  if (!ip || run.mode === 'practice' || run.corrects) return;
  if (q("SELECT 1 FROM events WHERE attempt_id = ? AND type = 'new-network'").get(a.id)) return;
  const me = q('SELECT sid_hash FROM roster_students WHERE id = ?').get(a.studentId);
  if (!me) return;
  const before = q(`SELECT a.id, a.run_id, a.pin_ip FROM attempts a JOIN roster_students s ON s.id = a.student_id JOIN runs r ON r.id = a.run_id
    WHERE s.sid_hash = ? AND r.owner_id = ? AND a.run_id != ? AND a.pin_ip IS NOT NULL AND a.archived = 0
    ORDER BY a.started_at DESC LIMIT 50`).all(me.sid_hash, run.owner_id, run.id).map((x) => P.tryField(x.run_id, x.id, 'pin_ip', x.pin_ip)).filter(Boolean);
  if (!before.length || before.some((x) => sameArea(x, ip))) return;
  const seen = [...new Set(before)].slice(0, 2);
  store.record(a, 'new-network', `${ip}, before: ${seen.join(', ')}${new Set(before).size > 2 ? ', …' : ''}`, quiz);
}
// Two students signing in from the same browser in one quiz (one taking it for the other, or swapping
// seats): flagged on both, once per pair.
function noteSameBrowser(a, run, quiz, name) {
  if (!a.device || run.mode === 'practice') return;
  const others = q(`SELECT a.id, bq_name(s.name, s.id, s.roster_id) AS name FROM attempts a JOIN roster_students s ON s.id = a.student_id
    WHERE a.run_id = ? AND a.device = ? AND a.student_id != ? AND a.archived = 0`).all(run.id, a.device, a.studentId);
  const logged = (id, who) => q("SELECT detail FROM events WHERE attempt_id = ? AND type = 'same-browser'").all(id).some((e) => P.openEvent(run.id, id, e.detail) === who);
  for (const o of others) {
    const other = store.getAttempt(o.id);
    if (!logged(a.id, o.name)) store.record(a, 'same-browser', o.name, quiz); // "Same browser as" + the other's name
    if (other && !logged(other.id, name)) store.record(other, 'same-browser', name, quiz);
  }
}

// What a client event says, in the teacher's words. "answer-after-return" arrives as "question id|seconds
// after|seconds away", and names the question as the teacher's view numbers it (the quiz's order).
// The detail to log for an event, or null for one that doesn't check out (not "no detail": a blur has
// none, and must still count, also when it arrives late).
function eventDetail(a, quiz, type, detail) {
  if (type !== 'answer-after-return') return detail == null ? undefined : detail;
  const [id, after, away] = String(detail || '').split('|');
  const list = quiz && a.layout ? store.quizFor(quiz, a.layout).questions : [];
  const i = list.findIndex((qq) => qq.id === id);
  if (i < 0) return null;
  const n = Math.max(0, Math.min(3600, Number(after) | 0));
  const gone = Math.max(0, Math.min(86400, Number(away) | 0));
  const away2 = gone >= 60 ? `${Math.floor(gone / 60)}:${String(gone % 60).padStart(2, '0')}` : `${gone}s`;
  return `Question ${i + 1}${list[i].name ? ` (${String(list[i].name).slice(0, 40)})` : ''}, ${n}s after ${away2} away`;
}

// The typing replay (teacher/attempts.js replay): whole edits only, so a big paste can't cut the JSON short.
function storeEdits(a, list, now) {
  if (!Array.isArray(list) || !list.length || a.edits >= 20000) return;
  const edits = list.slice(0, 300);
  let text = JSON.stringify(edits);
  while (text.length > 400000 && edits.length > 1) { edits.pop(); text = JSON.stringify(edits); }
  if (text.length > 400000) return;
  q('INSERT INTO code_edits (attempt_id, t, deltas) VALUES (?, ?, ?)').run(a.id, now, P.sealEdits(a.runId, a.id, text));
  a.edits += edits.length;
}

function current(req, { mustBeOpen = true } = {}) {
  const a = store.attemptByToken(cookies(req)[ATT]);
  if (!a || a.archived) throw new HttpError(401, 'no_attempt');
  const run = q('SELECT * FROM runs WHERE id = ?').get(a.runId);
  if (!run) throw new HttpError(401, 'no_attempt');
  a.practice = run.mode === 'practice';
  a.pausedAt = run.paused_at || 0; // the teacher paused the quiz (pause.js)
  requireSeb(req, run);
  // Safe Exam Browser with our settings (seb.js), checked just above: no other app can be in front
  a.lockedSeb = !!run.seb_config;
  if (mustBeOpen && run.status !== 'open' && a.status !== 'active') throw new HttpError(403, 'run_closed');
  const ip = clientIp(req);
  if (run.ip_lock && !onLockedNetwork(ip, run.ip_lock)) {
    if (a.status === 'active' && !a.flagged.has('net')) { a.flagged.add('net'); store.record(a, 'other-network', ip, store.getQuiz(run.quiz_id)); }
    throw new HttpError(403, 'wrong_network');
  }
  checkPin(a, run, trustedIp(req));
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  if (a.status === 'active' && a.userAgent && ua !== a.userAgent && !a.flagged.has('ua')) {
    a.flagged.add('ua');
    store.record(a, 'other-device', ua.slice(0, 120), store.getQuiz(run.quiz_id));
  }
  return { a, run, quiz: store.getQuiz(run.quiz_id) };
}

function publicQuiz(quiz, layout) {
  const byId = new Map(store.quizFor(quiz, layout).questions.map((qq) => [qq.id, qq])); // with their random values
  const used = new Set(layout.order.flatMap((id) => [].concat(byId.get(id).shared || []))); // shared material their questions use
  const calcs = calculatorOf(quiz); // the calculator each question has (its own, its part's or the quiz's)
  return {
    title: quiz.title,
    timeLimitMin: quiz.timeLimitMin,
    language: quiz.language,
    directions: quiz.directions,
    sections: sectionStarts(quiz, layout),
    lockParts: locks(quiz, layout) || undefined,
    turnInEarly: quiz.turnInEarly || undefined,
    calculator: quiz.calculator || undefined,
    // corrections: how each went on the exam (or that it's a new one from its pool), and the "What went wrong?" box
    corrections: layout.fix ? { why: !!layout.why, fix: Object.fromEntries(Object.entries(layout.fix).map(([id, f]) => [id, { points: f.old, max: f.max, fresh: !!f.fresh }])) } : undefined,
    shared: Object.fromEntries((quiz.shared || []).filter((m) => used.has(m.id)).map((m) => [m.id, { title: m.title, text: m.text, image: m.image || null, imageAlt: m.imageAlt || '' }])),
    questions: layout.order.map((id) => {
      const qq = byId.get(id);
      const pub = { id, type: qq.type, prompt: qq.prompt, points: qq.points };
      if (calcs.get(id)) pub.calculator = calcs.get(id);
      if (qq.name) pub.name = qq.name;
      if (qq.partialCredit) pub.partialCredit = true;
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
        Object.assign(pub, { code: qq.code, codeLang: qq.language, blanks: qq.answer.length, run: !!qq.run && !qq.noRun });
        if (qq.run) {
          pub.samples = qq.tests.sample.map((t) => ({ call: { [qq.language]: H.callText(qq, t, qq.language) }, expected: { [qq.language]: H.expectedText(qq, t, qq.language) } }));
        }
      }
      if (qq.type === 'essay') pub.codeLang = qq.language || null;
      // a graph: the grid and the drawing tools, and whether shading is one of them (never the answer)
      if (qq.type === 'graph') Object.assign(pub, { window: qq.window, step: qq.step, tools: qq.tools, shade: qq.shapes.some((sh) => sh.side) || undefined });
      if (qq.type === 'code') {
        pub.mode = qq.mode;
        pub.languages = qq.languages;
        if (qq.ban) pub.ban = qq.ban; // a rule, so students see it
        if (qq.noRun) pub.noRun = true;
        // The question's own classes, written out in each language: theirs to use, not to write.
        if (qq.types) pub.given = Object.fromEntries(qq.languages.map((l) => [l, T.classSource(qq.types, l, true)]));
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

const { sectionStarts, locks, partsOf, keepLocked } = Parts;

function runInfo(run, quiz, studentId) {
  const corr = run.corrects ? Object.assign({ corrections: true, timeLimitMin: 0 }, studentId ? C.preview(run, quiz, studentId) : { questionCount: null, points: null }) : null;
  return Object.assign(runInfoBase(run, quiz), corr || {});
}
function runInfoBase(run, quiz) {
  return {
    runId: run.id, title: quiz.title, timeLimitMin: quiz.timeLimitMin,
    // Totals only, for the start screen. What's on the quiz (types, names, sections, directions) comes with
    // the questions once the quiz starts.
    questionCount: store.perStudent(quiz).count, // with pools, what each student gets
    points: store.perStudent(quiz).points,
    // the page loads the code editor ahead (3 MB) only when a question shows code: not for math or graphs
    hasCode: quiz.questions.some((qq) => !['single', 'multi', 'text', 'math', 'graph'].includes(qq.type)),
    practice: run.mode === 'practice',
    seb: !!run.seb_key, // SEB keeps the window locked full screen itself
    sebQuit: !!run.seb_config, // our settings: opening seb-quit.html closes SEB
  };
}

// Answers stop saving a little after time runs out (slow networks get a few seconds). The attempt itself
// stays open until the sweeper turns it in, so a late student still gets a normal "submitted" screen.
const ANSWER_GRACE_MS = 10000;
// Events the client couldn't send when they happened (offline, or the request was blocked) arrive with a
// heartbeat or the turn-in, oldest first. Each keeps the time it happened (after the last good heartbeat,
// in order), so leaving five times while offline is five strikes, not one burst.
function takeLate(a, quiz, late, now) {
  if (!Array.isArray(late)) return;
  let at = Math.min(now, a.lastBeat || 0);
  for (const e of late.slice(0, 50)) {
    if (!Array.isArray(e) || !Object.hasOwn(store.CLIENT_EVENTS, e[0])) continue;
    const agoMs = Math.max(0, Number(e[2]) || 0);
    at = Math.min(now, Math.max(at, now - agoMs));
    const ago = Math.round(agoMs / 1000);
    const d = eventDetail(a, quiz, e[0], e[1]);
    if (d === null) continue;
    store.record(a, e[0], [d ? String(d).slice(0, 120) : null, `sent ${ago}s late`].filter(Boolean).join(', '), quiz, at);
  }
}
// Timed parts' ends for the page (its clock and when it moves on), or nothing.
const partEndsOut = (quiz, a) => (Parts.timed(quiz, a.layout) && Array.isArray(a.layout.partEnds) ? a.layout.partEnds : undefined);
const pastDeadline = (a, now) => !!a.deadline && now > a.deadline + ANSWER_GRACE_MS;
// when a timed exam can be turned in: the class's normal time, or their own deadline if that's sooner
const turnInAt = (a) => (a.deadline ? Math.min(a.deadline, (a.layout && a.layout.turnInAt) || a.deadline) : 0);

function submit(a, quiz, answers, why) {
  if (a.status !== 'active') return;
  const now = Date.now();
  const clk = Pause.clock(a, a.pausedAt, now); // held while the quiz is paused
  if (answers && !pastDeadline(a, clk) && Pause.taking(a.pausedAt, now)) a.answers = keepLocked(quiz, a, cleanAnswers(quiz, a.layout, answers), clk);
  if (a.deadline && clk > a.deadline + 30000 && why === 'student') store.record(a, 'late-submit', Math.round((now - a.deadline) / 1000) + 's late', quiz);
  store.back(a, now); // turned in while out of the window: the time away stops here
  a.status = 'submitted';
  a.submittedAt = now;
  store.logEvent(a, 'submit', 'info', why === 'student' ? null : why);
  store.save(a);
  gradeAttempt(a, quiz).catch((e) => console.error('grading failed', a.id, e));
}

// Heartbeats and events draw on one budget per attempt: 20 at once, 4 more a second. The quiz page
// sends a heartbeat every 1 to 15 seconds and a few events; past the budget a request still answers the
// same but nothing is stored, so a script can't fill the disk. Idle budgets are swept.
const BUDGET = 20;
const REFILL_PER_SEC = 4;
const MOUSE_ROWS = 200;
const budgets = new Map(); // attempt id -> { n, t }
const mouseRows = new Map(); // attempt id -> rows written since start (for pruning)
function allow(id, now) {
  let b = budgets.get(id);
  if (!b) budgets.set(id, b = { n: BUDGET, t: now });
  b.n = Math.min(BUDGET, b.n + ((now - b.t) * REFILL_PER_SEC) / 1000);
  b.t = now;
  if (b.n < 1) return false;
  b.n -= 1;
  return true;
}
setInterval(() => {
  const old = Date.now() - 10 * 60 * 1000;
  for (const [id, b] of budgets) if (b.t < old) { budgets.delete(id); mouseRows.delete(id); }
}, 60 * 1000).unref();

module.exports = function studentRoutes(r) {
  r.post('/api/join', async (req, res) => {
    const ip = clientIp(req);
    const body = await readJson(req, 4096);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const run = code.length === 6 ? q("SELECT * FROM runs WHERE code = ? AND status = 'open'").get(code) : null;
    if (!run) {
      if (!joinFails(addressKey(ip, 48))) throw new HttpError(429, 'too_many');
      throw new HttpError(404, 'bad_code');
    }
    if (run.ip_lock && !onLockedNetwork(ip, run.ip_lock)) throw new HttpError(403, 'wrong_network');
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
      if (!joinFails(addressKey(clientIp(req), 48))) throw new HttpError(429, 'too_many');
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
    const student = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { status: a.status, run: runInfo(run, quiz, a.studentId), name: student ? student.name : '' });
  });

  // Typeahead: only names matching what was typed come back, never the whole roster.
  r.post('/api/names', async (req, res) => {
    const body = await readJson(req, 4096);
    const run = openRun(body.runId, req);
    if (!nameLookups(run.id + ' ' + addressKey(clientIp(req)))) throw new HttpError(429, 'too_many');
    // The start of a first or last name, 3 letters or more (or a whole short one, like "Bo"): enough to find
    // your own name, while someone with the code can't list the class two letters at a time.
    const term = String(body.q || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 60);
    if (!term) return json(res, 200, { matches: [] });
    const fits = (name) => {
      const n = ' ' + String(name).toLowerCase().replace(/\s+/g, ' ') + ' ';
      return term.length >= 3 ? n.includes(' ' + term) : n.includes(' ' + term + ' ');
    };
    const rows = q('SELECT id, bq_name(name, id, roster_id) AS name FROM roster_students WHERE roster_id = ? AND removed = 0 ORDER BY name').all(run.roster_id).filter((x) => fits(x.name)).slice(0, 5);
    json(res, 200, { matches: rows.map((x) => ({ id: x.id, name: x.name })) });
  });

  r.post('/api/attempt', async (req, res) => {
    const body = await readJson(req, 4096);
    const run = openRun(body.runId, req);
    const student = q(`SELECT id, roster_id, sid_hash, time_x, bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ? AND roster_id = ? AND removed = 0`).get(String(body.rosterId || ''), run.roster_id);
    if (!student) throw new HttpError(400, 'bad_id');
    const now = Date.now();
    const ft = q('SELECT * FROM failed_ids WHERE run_id = ? AND student_id = ?').get(run.id, student.id);
    const dev = deviceOf(req);
    const devKey = dev && `${run.id} ${student.id} ${dev}`;
    if (ft && ft.until > now && (!dev || badTries(devKey) > 0)) throw new HttpError(429, 'name_locked');
    // 15 wrong IDs for one name, from anywhere: then a lock holds every browser back (someone is guessing),
    // except the one already taking this student's quiz. The teacher sees the count on the student's row.
    if (ft && ft.until > now && ft.n >= 15) {
      const mineNow = q('SELECT device FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, student.id);
      if (!(dev && mineNow && mineNow.device === deviceHash(dev))) throw new HttpError(429, 'name_locked');
    }
    if (!safeEqual(hashSid(body.studentId), student.sid_hash)) {
      noteBadTry(devKey);
      const n = (ft ? ft.n : 0) + 1;
      // every 5th wrong ID locks the name (in this browser) for longer: 30 s, 1 min, 2 min, ... up to 10 min
      const until = n % 5 === 0 ? now + Math.min(600000, 30000 * 2 ** (n / 5 - 1)) : ft && ft.until > now ? ft.until : 0; // a wrong try never shortens a lock
      q('INSERT INTO failed_ids (run_id, student_id, n, until) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, student_id) DO UPDATE SET n = excluded.n, until = excluded.until')
        .run(run.id, student.id, n, until);
      throw new HttpError(400, 'bad_id');
    }
    if (!(ft && ft.until > now)) q('DELETE FROM failed_ids WHERE run_id = ? AND student_id = ?').run(run.id, student.id);
    if (devKey) devBad.delete(devKey);

    const mine = store.attemptByToken(cookies(req)[ATT]);
    const existingRow = q('SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, student.id);
    const existing = existingRow ? store.getAttempt(existingRow.id) : null;
    const token = newToken();
    if (existing) {
      if (mine && mine.id === existing.id) {
        // Same browser. Let back in moves the pin here; otherwise it has to be on the pinned network.
        if (existing.letIn && now - existing.letIn < 10 * 60000) {
          existing.letIn = 0;
          existing.resumeOk = true;
          if (existing.status === 'active' && run.mode !== 'practice') { existing.pinIp = trustedIp(req); existing.flagged.delete('pin'); store.save(existing); }
        } else checkPin(existing, run, trustedIp(req));
        return json(res, 200, { ok: true, run: run.corrects ? runInfo(run, store.getQuiz(run.quiz_id), student.id) : undefined, timeLimitMin: run.corrects ? undefined : myLimit(store.getQuiz(run.quiz_id), student.id) });
      }
      // A student who lost their cookie before starting can sign in again. After that, only if the teacher
      // pressed "Let back in" (crashed PC, new seat): they pick up the same attempt, answers and clock.
      // Practice runs aren't monitored, so signing in again anywhere is fine.
      const letIn = run.mode === 'practice' || (existing.letIn && now - existing.letIn < 10 * 60000);
      if (existing.status !== 'waiting' && existing.status !== 'admitted' && !letIn) throw new HttpError(409, 'already_started');
      if (letIn) {
        existing.letIn = 0;
        existing.resumeOk = true;
        if (existing.status === 'active' && run.mode !== 'practice') { existing.pinIp = trustedIp(req); existing.flagged.delete('pin'); store.save(existing); }
      }
      if (run.mode === 'practice' && existing.status === 'waiting') { existing.status = 'admitted'; store.save(existing); }
      existing.tokenHash = sha256(token);
      q('UPDATE attempts SET token_hash = ?, ip = ?, user_agent = ? WHERE id = ?').run(existing.tokenHash, P.sealField(run.id, existing.id, 'ip', clientIp(req)),
        P.sealField(run.id, existing.id, 'user_agent', String(req.headers['user-agent'] || '').slice(0, 300)), existing.id);
      existing.userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
      store.logEvent(existing, 'join', 'info', 'signed in again');
      if (dev) { existing.device = deviceHash(dev); q('UPDATE attempts SET device = ? WHERE id = ?').run(existing.device, existing.id); }
      noteSameBrowser(existing, run, store.getQuiz(run.quiz_id), student.name);
      noteNewNetwork(existing, run, store.getQuiz(run.quiz_id), trustedIp(req));
    } else {
      const id = crypto.randomUUID();
      // Practice runs skip the waiting room.
      q(`INSERT INTO attempts (id, run_id, student_id, token_hash, status, ip, user_agent, created_at, device)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, run.id, student.id, sha256(token), run.mode === 'practice' ? 'admitted' : 'waiting',
        P.sealField(run.id, id, 'ip', clientIp(req)), P.sealField(run.id, id, 'user_agent', String(req.headers['user-agent'] || '').slice(0, 300)), now, dev ? deviceHash(dev) : null);
      const fresh = store.getAttempt(id);
      store.logEvent(fresh, 'join', 'info', student.name);
      noteSameBrowser(fresh, run, store.getQuiz(run.quiz_id), student.name);
      noteNewNetwork(fresh, run, store.getQuiz(run.quiz_id), trustedIp(req));
    }
    setCookie(req, res, ATT, token, 12 * 3600);
    json(res, 200, { ok: true, run: run.corrects ? runInfo(run, store.getQuiz(run.quiz_id), student.id) : undefined, timeLimitMin: run.corrects ? undefined : myLimit(store.getQuiz(run.quiz_id), student.id) });
  });

  // An exam's student agreed to the rules: the page is full screen and monitored, and waits for the
  // teacher to start the quiz (the teacher's Start admits them, and the page then calls /api/start).
  // admitted: already started, so the page goes straight in. Opening the waiting screen again (a
  // reload) counts as leaving, like reopening the quiz.
  r.post('/api/ready', async (req, res) => {
    const { a, run, quiz } = current(req);
    if (a.status === 'submitted') throw new HttpError(403, 'run_closed');
    if (a.status === 'active') return json(res, 200, { admitted: true });
    if (run.mode !== 'practice' && !run.corrects) {
      const now = Date.now();
      if (a.readyAt) store.record(a, 'reload', 'reopened the waiting screen', quiz);
      else store.logEvent(a, 'ready', 'info', null);
      a.readyAt = now;
      a.lastBeat = now;
      a.beatLost = false;
      store.save(a);
    }
    json(res, 200, { admitted: a.status === 'admitted' });
  });

  r.post('/api/admit-status', async (req, res) => {
    const { a } = current(req);
    a.seenAt = Date.now(); // their rules or waiting screen is still open (teacher/common.js liveRow: No signal)
    json(res, 200, { admitted: a.status !== 'waiting' });
  });

  r.post('/api/start', async (req, res) => {
    const { a, run, quiz } = current(req);
    const seenAt = a.answersAt || 0; // when their answers last reached the server: the page keeps newer ones (app/answers.js takeUnsent)
    if (a.status === 'waiting') throw new HttpError(403, 'not_admitted');
    if (a.status === 'submitted') throw new HttpError(403, 'run_closed');
    const now = Date.now();
    if (a.status === 'admitted') {
      if (run.corrects) {
        const p = C.plan(quiz, C.examAttemptFor(run, a.studentId), !!run.ask_why);
        if (!p) throw new HttpError(409, 'nothing_to_correct');
        a.layout = p.layout;
        a.answers = p.answers;
        // what was filled in from the exam, so progress counts what they've changed (teacher/common.js liveRow)
        a.layout.startAnswers = Object.fromEntries(Object.entries(p.answers || {}).map(([k, v]) => [k, JSON.stringify(v)]));
      } else a.layout = store.makeLayout(quiz);
      a.status = 'active';
      a.startedAt = now;
      if (!a.practice) a.pinIp = trustedIp(req); // the network it's pinned to (current); none when it can't be told
      const x = timeX(a.studentId); // extra time for this student
      // Ready when the teacher pressed Start: everyone's clock starts then, not when each page noticed
      // (a poll later). Anyone who agreed after that starts their own clock now.
      const from = a.admittedAt && a.readyAt && a.readyAt <= a.admittedAt && now - a.admittedAt < 15000 ? a.admittedAt : now;
      a.deadline = quiz.timeLimitMin && !run.corrects ? from + Math.round(quiz.timeLimitMin * x * 60000) : null;
      // the class's normal time: extra time (theirs or the teacher's) can be turned in any time after it
      if (a.deadline) a.layout.turnInAt = from + Math.round(quiz.timeLimitMin * 60000);
      // Timed parts: each part's own end, one after another; the last one is the quiz's
      if (a.deadline && Parts.timed(quiz, a.layout)) {
        a.layout.partEnds = Parts.partEnds(quiz, a.layout, from, x);
        a.deadline = a.layout.partEnds[a.layout.partEnds.length - 1];
      }
      a.lastBeat = now;
      store.logEvent(a, 'start', 'info', x !== 1 && a.deadline ? `${x}× time` : null);
      noteNewNetwork(a, run, quiz, a.pinIp);
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
    // Saved answers go back in the student's own positional order.
    const pq = publicQuiz(quiz, a.layout);
    if (pq.timeLimitMin && !run.corrects) pq.timeLimitMin = myLimit(quiz, a.studentId); // their own, with extra time
    // tag: tells this attempt from an earlier one (a reset, practice again), for what the browser keeps
    if (Parts.timed(quiz, a.layout)) keepLocked(quiz, a, {}, Pause.clock(a, a.pausedAt, now)); // parts whose time ran out while they were away
    json(res, 200, { quiz: pq, deadline: a.deadline, turnInAt: turnInAt(a) || null, partEnds: partEndsOut(quiz, a), savedAt: seenAt, now, paused: Pause.since(a, a.pausedAt) || undefined, saved: a.answers || {}, locked: locks(quiz, a.layout) ? a.layout.locked || 0 : 0, tag: sha256(a.id).slice(0, 12) });
  });

  r.post('/api/event', async (req, res) => {
    const body = await readJson(req, 8192);
    let ctx;
    // A locked quiz (its teacher hasn't signed in since a restart) answers 503, so the app queues the
    // event and sends it once the quiz unlocks, instead of it being dropped.
    try { ctx = current(req); } catch (e) { if (e.code === 'locked') throw e; return json(res, 200, { ok: true }); }
    const { a, quiz } = ctx;
    // Violations always count (spending the budget first mustn't hide one); the rest draw on it.
    if (store.watched(a) && Object.hasOwn(store.CLIENT_EVENTS, body.type)
      && (store.CLIENT_EVENTS[body.type] === 'violation' || allow(a.id, Date.now()))) {
      const detail = eventDetail(a, quiz, body.type, body.detail);
      if (detail !== null) store.record(a, body.type, detail, quiz);
    }
    json(res, 200, { ok: true });
  });

  r.post('/api/beat', async (req, res) => {
    const body = await readJson(req, 1024 * 1024);
    const { a, run, quiz } = current(req);
    const now = Date.now();
    let live = {};
    let held = false; // answers that came while the quiz is paused: the page keeps them for after
    const inQuiz = a.status === 'active';
    if (inQuiz && !allow(a.id, now)) {
      // Over the budget: answered the same, nothing stored.
      live = W.isWatched(a.runId, now) ? { beatMs: W.FAST_BEAT_MS } : {};
    } else if (store.watched(a)) { // in the quiz, or waiting for its start in lockdown
      takeLate(a, quiz, body.late, now);
      if (a.beatLost) store.logEvent(a, 'reconnect', 'info', Math.round((now - a.lastBeat) / 1000) + 's offline');
      a.lastBeat = now;
      a.beatLost = false;
      if (body.focused === false || body.visible === false) {
        if (!a.away) store.record(a, 'unfocused-beat', body.visible === false ? 'tab hidden' : 'window not focused', quiz);
      } else {
        store.back(a, now);
      }
      if (inQuiz) {
      // Mouse samples: [x, y, ms since the last one], and a 4th 1 for a click.
      const pts = (Array.isArray(body.mouse) ? body.mouse.slice(0, 400) : []).filter((p) => Array.isArray(p) && (p.length === 3 || p.length === 4) && p.every(Number.isFinite))
        .map((p) => [Math.max(0, Math.min(1000, p[0] | 0)), Math.max(0, Math.min(1000, p[1] | 0)), Math.max(0, Math.min(60000, p[2] | 0)), p[3] ? 1 : 0]);
      // Stored for exams' reports; practice isn't monitored (watching it uses memory, watch.js).
      if (pts.length && !a.practice) {
        q('INSERT INTO mouse (attempt_id, t, points) VALUES (?, ?, ?)').run(a.id, now, JSON.stringify(pts.map((p) => p.slice(0, 3))));
        // Keep the newest MOUSE_ROWS per attempt (the report shows the last 60), pruned every 50 rows.
        const n = (mouseRows.get(a.id) || 0) + 1;
        mouseRows.set(a.id, n);
        if (n % 50 === 0) q('DELETE FROM mouse WHERE attempt_id = ? AND rowid NOT IN (SELECT rowid FROM mouse WHERE attempt_id = ? ORDER BY rowid DESC LIMIT ?)').run(a.id, a.id, MOUSE_ROWS);
      }
      live = W.beat(a, body, pts, now); // for a teacher watching live (watch.js)
      // What they're doing, for the live table (teacher/common.js activity): an answer changed or code was typed,
      // or just any mouse or key at all. In memory only.
      if (body.answers || (Array.isArray(body.edits) && body.edits.length)) a.workedAt = now;
      const idle = Number(body.idleMs);
      if (Number.isFinite(idle)) a.activeAt = now - Math.min(Math.max(0, idle), 3600000);
      storeEdits(a, body.edits, now);
      // Time on each question: the stretch since the last heartbeat goes to the question that was on
      // screen then, if the quiz had focus. Gaps (offline, asleep) count 30s at most.
      const order = a.layout && Array.isArray(a.layout.order) ? a.layout.order : [];
      const v = body.view && typeof body.view === 'object' ? body.view : null;
      const onQ = v && typeof v.q === 'string' && !v.review && !v.dir && !v.intro && !v.paused && order.includes(v.q) ? v.q : null;
      if (a.viewQ && a.viewAt && body.focused !== false && body.visible !== false) {
        if (!a.qTime) a.qTime = {};
        a.qTime[a.viewQ] = (a.qTime[a.viewQ] || 0) + Math.min(Math.max(0, now - a.viewAt), 30000);
      }
      a.viewQ = onQ;
      a.viewAt = now;
      // autosave stops at time's up (only the final submit gets the grace, for its trip over the network),
      // and while the quiz is paused, once answers already on their way have come in
      const clk = Pause.clock(a, a.pausedAt, now);
      if (body.answers && !Pause.taking(a.pausedAt, now)) held = true;
      else if (body.answers && !(a.deadline && clk > a.deadline)) { a.answers = keepLocked(quiz, a, cleanAnswers(quiz, a.layout, body.answers), clk); a.answersAt = now; }
      }
      store.save(a);
    }
    // done: the attempt was turned in elsewhere (the teacher ended it). Integrity never shows here.
    const notice = a.status !== 'submitted' ? store.notices.get(run.id) : null; // the teacher's message to everyone
    const note = a.status !== 'submitted' ? store.notes.get(a.id) : null; // and to this student
    // paused: when their clock stopped (the page shows the time left then, and hides the questions)
    const paused = a.status === 'active' ? Pause.since(a, a.pausedAt) : 0;
    json(res, 200, { ok: true, now, deadline: a.deadline || null, partEnds: partEndsOut(quiz, a), done: a.status === 'submitted', ...(paused ? { paused } : {}), ...(held ? { held } : {}), ...(notice ? { notice } : {}), ...(note ? { note } : {}), ...live });
  });

  r.post('/api/run', async (req, res) => {
    const body = await readJson(req, 128 * 1024);
    const { a, quiz } = current(req);
    if (a.status !== 'active') throw new HttpError(403, 'run_closed');
    if (!runLimit(`${a.runId}:${a.studentId}`)) throw new HttpError(429, 'too_many'); // per student, so practice retries don't reset it
    const qq = store.quizFor(quiz, a.layout).questions.find((x) => x.id === body.questionId && isRun(x)); // one of theirs
    // Fill-in-the-blank: the server fills its own template; students only send the blanks.
    if (qq && qq.type === 'fill') body.code = Array.isArray(body.blanks) ? fillTemplate(qq.code, body.blanks.map((b) => String(b || '').slice(0, 500))) : null;
    if (!qq || !qq.languages.includes(body.language) || typeof body.code !== 'string') throw new HttpError(400, 'bad_request');
    if (qq.noRun) throw new HttpError(403, 'run_off'); // this question is written without running
    const who = `${a.runId}:${a.studentId}`;
    if (runsGoing.has(who)) throw new HttpError(429, 'too_many');
    store.logEvent(a, 'run', 'info', `${qq.id} (${T.LANG_NAMES[body.language] || body.language})`);
    let out;
    runsGoing.add(who);
    try {
      out = await runSamples(qq, body.language, body.code.slice(0, 50000));
    } catch (e) {
      out = { status: 'error', message: 'Code runner offline. Tell your teacher.' };
    } finally {
      runsGoing.delete(who);
    }
    W.ran(a.id, `${qq.id}:${body.language}`, out); // what a teacher watching sees under the editor
    json(res, 200, out);
  });

  // Practice only: the student's own answers next to the correct ones, once grading is done.
  r.get('/api/practice-review', async (req, res) => {
    const { a, run, quiz } = current(req, { mustBeOpen: false });
    if (!a.practice) throw new HttpError(404, 'not_found');
    if (a.status !== 'submitted') throw new HttpError(409, 'not_submitted');
    const until = Date.now() + 30000;
    while (Date.now() < until && (!a.result || totals(a.result, quiz, a.answers, a.layout).pending)) await sleep(500);
    const student = q('SELECT bq_name(name, id, roster_id) AS name FROM roster_students WHERE id = ?').get(a.studentId);
    json(res, 200, { quiz: reportQuiz(quiz, run.quiz_id, a.layout), students: [studentReport(quiz, a, student ? student.name : '', { forStudent: true })] });
  });

  // Practice only: start over with a fresh attempt.
  r.post('/api/practice-retry', async (req, res) => {
    const { a, run } = current(req);
    if (!a.practice || run.corrects) throw new HttpError(404, 'not_found'); // corrections: once, then the answers
    if (!practiceAgain(`${run.id}:${a.studentId}`)) throw new HttpError(429, 'too_many');
    a.archived = true;
    store.save(a);
    store.forget(a.id);
    const id = crypto.randomUUID();
    const token = newToken();
    q(`INSERT INTO attempts (id, run_id, student_id, token_hash, status, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?)`).run(id, run.id, a.studentId, sha256(token), P.sealField(run.id, id, 'ip', clientIp(req)),
      P.sealField(run.id, id, 'user_agent', String(req.headers['user-agent'] || '').slice(0, 300)), Date.now());
    store.logEvent(store.getAttempt(id), 'join', 'info', 'practice again');
    setCookie(req, res, ATT, token, 12 * 3600);
    json(res, 200, { ok: true });
  });

  // Done with a part, in a quiz with locked parts: it (and every part before it) is final. Their latest
  // answers come along, so nothing typed just before moving on is lost.
  r.post('/api/part-done', async (req, res) => {
    const body = await readJson(req, 1024 * 1024);
    const { a, quiz } = current(req);
    if (a.status !== 'active') throw new HttpError(403, 'run_closed');
    if (!locks(quiz, a.layout)) throw new HttpError(400, 'not_locked');
    const n = Number(body.part);
    if (!Number.isInteger(n) || n < 1 || n > partsOf(quiz, a.layout).count) throw new HttpError(400, 'bad_part');
    // Timed parts move on when their time is up, not before (a page's clock can run a few seconds ahead)
    const clk = Pause.clock(a, a.pausedAt);
    if (Parts.timed(quiz, a.layout) && n > Parts.over(a, clk + 5000)) throw new HttpError(403, 'not_yet');
    if (body.answers && !pastDeadline(a, clk) && Pause.taking(a.pausedAt)) { a.answers = keepLocked(quiz, a, cleanAnswers(quiz, a.layout, body.answers), clk); a.answersAt = Date.now(); }
    a.layout.locked = Math.max(a.layout.locked || 0, n);
    store.save(a);
    json(res, 200, { locked: a.layout.locked });
  });

  r.post('/api/submit', async (req, res) => {
    const body = await readJson(req, 1024 * 1024);
    const { a, run, quiz } = current(req, { mustBeOpen: false });
    // Not while the teacher has it paused (a turn-in already on its way still goes through)
    if (a.status === 'active' && !Pause.taking(a.pausedAt)) throw new HttpError(409, 'paused');
    const clk = Pause.clock(a, a.pausedAt);
    // A timed exam turns in when time is up, not before (the teacher can still end it early)
    if (a.status === 'active' && run.mode !== 'practice' && !quiz.turnInEarly && a.deadline && clk < turnInAt(a) - 15000) throw new HttpError(403, 'not_yet');
    // Timed parts: turning in early (turnInEarly) is for the last part, so no part is skipped
    if (a.status === 'active' && run.mode !== 'practice' && Parts.timed(quiz, a.layout) && Array.isArray(a.layout.partEnds)
      && Parts.over(a, clk + 15000) < a.layout.partEnds.length - 1 && clk < turnInAt(a) - 15000) throw new HttpError(403, 'not_yet');
    if (a.status === 'active') {
      const now = Date.now();
      // events the page couldn't send (offline, or its requests blocked) come with the turn-in
      if (store.watched(a)) takeLate(a, quiz, body.late, now);
      storeEdits(a, body.edits, now); // the last few seconds of typing, for the replay
      // and the time since the last heartbeat, on the question that was on screen then
      if (a.viewQ && a.viewAt) { if (!a.qTime) a.qTime = {}; a.qTime[a.viewQ] = (a.qTime[a.viewQ] || 0) + Math.min(Math.max(0, now - a.viewAt), 30000); a.viewQ = null; }
    }
    submit(a, quiz, body.answers, 'student');
    json(res, 200, { ok: true });
  });
};

module.exports.submit = submit;
module.exports.publicQuiz = publicQuiz;
module.exports.current = current;
module.exports.hashSid = hashSid;
// Only once the quiz has started, and only images this student's quiz shows (or, after a practice
// submit, its review shows), so an image used only in an answer key or a hidden part stays put.
const shownAssets = new WeakMap();
function seesAsset(a, run, quiz, rel) {
  if (a.status !== 'active' && a.status !== 'submitted') return false;
  let shown = shownAssets.get(a);
  if (!shown) { shown = JSON.stringify(publicQuiz(quiz, a.layout)); shownAssets.set(a, shown); }
  if (shown.includes(rel)) return true;
  if (!a.practice || a.status !== 'submitted') return false;
  return JSON.stringify([reportQuiz(quiz, run.quiz_id, a.layout), studentReport(quiz, a, '', { forStudent: true })]).includes(rel);
}
module.exports.serveAsset = function serveAsset(req, res, rel) {
  const { a, run, quiz } = current(req, { mustBeOpen: false });
  if (!seesAsset(a, run, quiz, rel)) throw new HttpError(404, 'not_found');
  const row = store.getAsset(run.quiz_id, rel);
  if (!row) throw new HttpError(404, 'not_found');
  send(res, 200, Buffer.from(row.bytes), {
    'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
};
