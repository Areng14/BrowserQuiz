'use strict';
// BrowserQuiz server: student app + teacher dashboard + API. Zero dependencies, Node 22+.
const http = require('node:http');
const path = require('node:path');
const { q } = require('./db');
const store = require('./store');
const { gradeAttempt, totals } = require('./grade');
const { HttpError, router, json, serveStatic, send, SECURITY } = require('./http');
const studentRoutes = require('./student');
const teacherRoutes = require('./teacher');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, '..', '..', 'public');

// Config problems: say so once. In a container (node is PID 1) stay parked instead of exiting, or Docker
// restarts the app forever and repeats the same error. The health check reports it as unhealthy.
const problems = [];
for (const k of ['ADMIN_PASSWORD', 'ID_PEPPER']) {
  if (!process.env[k] || process.env[k].length < 12) problems.push(`${k} must be 12+ characters`);
}
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
// minute retry grading that failed (usually the runner was down).
let sweeps = 0;
setInterval(() => {
  const now = Date.now();
  if (++sweeps % 30 === 0) {
    for (const a of store.attempts.values()) {
      if (a.status !== 'submitted' || a.archived || !a.result) continue;
      const run = q('SELECT quiz_id FROM runs WHERE id = ?').get(a.runId);
      const quiz = run && store.getQuiz(run.quiz_id);
      const t = quiz && totals(a.result, quiz, a.answers);
      if (t && t.failed) gradeAttempt(a, quiz).catch(() => {});
    }
  }
  for (const a of store.attempts.values()) {
    if (a.status !== 'active' || a.archived) continue;
    const run = q('SELECT quiz_id FROM runs WHERE id = ?').get(a.runId);
    if (!run) continue;
    const quiz = store.getQuiz(run.quiz_id);
    if (a.lastBeat && now - a.lastBeat > 10000 && !a.beatLost) {
      a.beatLost = true;
      store.record(a, 'heartbeat-lost', Math.round((now - a.lastBeat) / 1000) + 's silent', quiz);
    }
    if (a.deadline && now > a.deadline + 30000) studentRoutes.submit(a, quiz, null, 'time ran out');
  }
}, 2000).unref();

// After a restart: load active attempts back into memory and finish any grading that was cut off.
for (const row of q("SELECT id FROM attempts WHERE archived = 0 AND status = 'active'").all()) {
  const a = store.getAttempt(row.id);
  a.lastBeat = Date.now(); // give clients a moment to reconnect before calling their heartbeat lost
}
for (const row of q("SELECT id, run_id FROM attempts WHERE archived = 0 AND status = 'submitted' AND (result IS NULL OR result LIKE '%\"pending\"%' OR result LIKE '%\"error\"%')").all()) {
  const a = store.getAttempt(row.id);
  const run = q('SELECT quiz_id FROM runs WHERE id = ?').get(row.run_id);
  if (run) gradeAttempt(a, store.getQuiz(run.quiz_id)).catch((e) => console.error('regrade failed', a.id, e.message));
}

server.listen(PORT, () => console.log(`BrowserQuiz listening on :${PORT}`));
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
