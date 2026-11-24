'use strict';
// BrowserQuiz server: student app + teacher dashboard + API. Zero dependencies, Node 22+.
const http = require('node:http');
const path = require('node:path');
const { q } = require('./db');
const store = require('./store');
const V = require('./vault');
const P = require('./people');
const { gradeAttempt, totals } = require('./grade');
const { HttpError, router, json, serveStatic, send, SECURITY, isHttps } = require('./http');
const studentRoutes = require('./student');
const teacherRoutes = require('./teacher');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, '..', '..', 'public');

// Config problems: say so once. In a container (node is PID 1) stay parked instead of exiting, or Docker
// restarts the app forever and repeats the same error. The health check reports it as unhealthy.
const problems = [];
if (!process.env.ID_PEPPER || process.env.ID_PEPPER.length < 12) problems.push('ID_PEPPER must be 12+ characters');
// ADMIN_PASSWORD is optional: without it, admin signs in with a one-time code from the log.
// Same minimum as teachers' own passwords (accounts.MIN_PASSWORD). It also guards admin's quiz key.
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 10) problems.push('ADMIN_PASSWORD must be 10+ characters (or leave it out)');
if (process.env.RUNNER_URL && (process.env.RUNNER_TOKEN || '').length < 16) problems.push('RUNNER_TOKEN must be 16+ characters');
if (problems.length) {
  console.error(['BrowserQuiz did not start. Fix .env, then run: docker compose up -d', ...problems.map((x) => '  - ' + x)].join('\n'));
  if (process.pid !== 1) process.exit(1);
  process.on('SIGTERM', () => process.exit(1));
  process.on('SIGINT', () => process.exit(1));
  setInterval(() => {}, 1 << 30);
  return; // eslint-disable-line no-unreachable -- CommonJS: stop here
}

const api = router();
studentRoutes(api);
teacherRoutes(api);

async function handle(req, res) {
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000'); // HTTPS only from now on
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'POST') {
    // Same-origin check: browsers always send Origin on cross-site POSTs.
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* bad origin */ }
      if (host !== req.headers.host) throw new HttpError(403, 'bad_origin');
    }
  }
  if (p.startsWith('/api/')) {
    const m = api.match(req.method, p);
    if (!m) throw new HttpError(404, 'not_found');
    return m.handler(req, res, m.params);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method');
  if (p === '/healthz') return json(res, 200, { ok: true });
  // Whether students are in a quiz right now (signed in, sent a heartbeat in the last 90 seconds, or in a
  // quiz the teacher paused: a fire drill leaves the laptops closed). A deploy restarts the server, so the
  // deploy check (.github/workflows/deploy-gate.yml) waits for this to say false. Just yes or no: nothing
  // about who or which quiz.
  if (p === '/healthz/busy') {
    const n = q(`SELECT COUNT(*) AS n FROM attempts a JOIN runs r ON r.id = a.run_id
      WHERE r.status = 'open' AND r.mode != 'practice' AND a.archived = 0 AND a.status IN ('waiting', 'admitted', 'active')
      AND (a.last_beat > ? OR (r.paused_at IS NOT NULL AND a.status = 'active'))`).get(Date.now() - 90000).n;
    return json(res, 200, { busy: n > 0 });
  }
  if (p.startsWith('/asset/')) {
    const rel = decodeURIComponent(p.slice('/asset/'.length));
    if (!/^assets\/[A-Za-z0-9 _.\-/]+$/.test(rel) || rel.includes('..')) throw new HttpError(404, 'not_found');
    return studentRoutes.serveAsset(req, res, rel);
  }
  if (p.startsWith('/vendor/') && serveStatic(res, path.join(PUBLIC, 'vendor'), p.slice('/vendor/'.length), true)) return;
  if (p === '/teacher') { res.writeHead(302, Object.assign({}, SECURITY, { Location: '/teacher/' })); return res.end(); }
  if (p.startsWith('/teacher/')) {
    const rel = p.slice('/teacher/'.length) || 'index.html';
    if (serveStatic(res, path.join(PUBLIC, 'teacher'), rel)) return;
    throw new HttpError(404, 'not_found');
  }
  if (serveStatic(res, path.join(PUBLIC, 'student'), p === '/' ? 'index.html' : p.slice(1))) return;
  throw new HttpError(404, 'not_found');
}

const server = http.createServer((req, res) => {
  Promise.resolve().then(() => handle(req, res)).catch((e) => {
    if (res.headersSent) { res.destroy(); return; }
    if (e instanceof HttpError) {
      if (req.url.startsWith('/api/')) return json(res, e.status, { error: e.code, message: e.message !== e.code ? e.message : undefined });
      return send(res, e.status, e.status === 404 ? 'Not found' : 'Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    console.error(e);
    json(res, 500, { error: 'server_error' });
  });
});
server.headersTimeout = 20000;
server.requestTimeout = 60000;

// Sweeper: flag lost heartbeats, submit time-up attempts with their autosaved answers, and every
// minute retry grading that failed (usually the runner was down) or never started (the quiz was locked
// until its teacher signed in after a restart). Locked quizzes are skipped until then.
const quizOf = (run) => { try { return run && store.getQuiz(run.quiz_id); } catch (e) { return null; } };
let sweeps = 0;
setInterval(() => {
  const now = Date.now();
  if (++sweeps % 30 === 0) {
    for (const a of store.attempts.values()) {
      if (a.status !== 'submitted' || a.archived) continue;
      const quiz = quizOf(q('SELECT quiz_id FROM runs WHERE id = ?').get(a.runId));
      const t = quiz && a.result && totals(a.result, quiz, a.answers, a.layout);
      if (quiz && (!a.result || t.failed || t.pending)) gradeAttempt(a, quiz).catch(() => {});
    }
  }
  for (const a of store.attempts.values()) {
    if (a.status !== 'active' || a.archived) continue;
    const run = q('SELECT quiz_id, mode, paused_at FROM runs WHERE id = ?').get(a.runId);
    if (!run) continue;
    const quiz = quizOf(run);
    if (!quiz) continue;
    a.practice = run.mode === 'practice';
    a.pausedAt = run.paused_at || 0; // paused: nothing runs out (pause.js), and a lost connection doesn't count (store.record)
    if (a.lastBeat && now - a.lastBeat > 10000 && !a.beatLost && !a.practice) {
      a.beatLost = true;
      store.record(a, 'heartbeat-lost', Math.round((now - a.lastBeat) / 1000) + 's silent', quiz);
    }
    if (a.deadline && !a.pausedAt && now > a.deadline + 30000) studentRoutes.submit(a, quiz, null, 'time ran out');
  }
}, 2000).unref();

// Results stored before quiz encryption kept the hidden tests' inputs and expected values: drop them.
for (const row of q(`SELECT id, result FROM attempts WHERE result LIKE '%"expected"%'`).all()) {
  try { q('UPDATE attempts SET result = ? WHERE id = ?').run(JSON.stringify(store.storedResult(JSON.parse(row.result))), row.id); } catch (e) { /* leave it */ }
}

// After a restart: load active attempts back into memory and finish any grading that was cut off. Their
// answers and results are sealed with their teacher's key (people.js), so a teacher's own come back when
// they sign in (resume(theirId)); admin's .env key is there from the start.
function resume(ownerId) {
  const mine = ownerId ? ' AND run_id IN (SELECT id FROM runs WHERE owner_id = ?)' : '';
  const args = ownerId ? [ownerId] : [];
  const load = (id) => { try { return store.getAttempt(id); } catch (e) { return null; } }; // locked: later
  for (const row of q(`SELECT id FROM attempts WHERE archived = 0 AND status = 'active'${mine}`).all(...args)) {
    const fresh = !store.attempts.has(row.id);
    const a = load(row.id);
    if (a && fresh) a.lastBeat = Date.now(); // give clients a moment to reconnect before calling their heartbeat lost
  }
  for (const row of q(`SELECT id, run_id FROM attempts WHERE archived = 0 AND status = 'submitted' AND (result IS NULL OR grading IN ('pending', 'error')
    OR (grading IS NULL AND (result LIKE '%"pending"%' OR result LIKE '%"error"%')))${mine}`).all(...args)) {
    const a = load(row.id);
    const quiz = a && quizOf(q('SELECT quiz_id FROM runs WHERE id = ?').get(row.run_id)); // a locked one waits for its teacher
    if (quiz) gradeAttempt(a, quiz).catch((e) => console.error('regrade failed', a.id, e.message));
  }
}
resume(null);
// A teacher signing in: whatever of theirs is still in the clear gets sealed, and their quizzes carry on.
V.onUnlock((id) => {
  P.sealPeople(id);
  resume(id);
});

// The admin account is set up (ADMIN_PASSWORD, or a one-time code); start taking requests once it's in place.
require('./accounts').ensureAdmin()
  .then(() => server.listen(PORT, () => console.log(`BrowserQuiz listening on :${PORT}`)))
  .catch((e) => { console.error('Could not set up the admin account:', e); process.exit(1); });
// docker stop sends SIGTERM to PID 1. Finish in-flight requests briefly, then fold the WAL into the database.
function shutdown() {
  server.close();
  server.closeIdleConnections();
  setTimeout(() => {
    try { const { db } = require('./db'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { console.error(e); }
    process.exit(0);
  }, 1000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
