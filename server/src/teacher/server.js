'use strict';
// The admin's Server page: this server's version and whether there's a newer one, its code runner, its data
// and disk, and its backups (backups.js): make one, download one, restore one (from the list or a file).
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, json, readJson, SECURITY } = require('../http');
const { DATA_DIR } = require('../db');
const B = require('../backups');
const { runnerConfigured, runnerHealthy, runnerLanguages } = require('../coderun');
const { audit, requireAdmin } = require('./common');
const { revision, version } = require('../version');

const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;
// A restore from a file being uploaded: one at a time, as they'd share the temporary file (a second one wrote
// into the first after it was checked and put in place).
let receiving = false;

// How many newer versions GitHub has that change the app, asked when the admin opens the page and kept 6
// hours. Only this commit's id goes to GitHub. Only the app image's own files count (images.yml builds it
// from these): its version is the commit it was built at, so a change elsewhere (the runner, setup, docs)
// would leave an update showing after updating.
let latest = { at: 0, sha: '', val: null };
const APP = /^(server\/|public\/|scripts\/|package(-lock)?\.json$|docs\/quiz-format\.md$|examples\/sample-exam\/quiz\.json$)/;
async function updates(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  if (latest.sha === sha && Date.now() - latest.at < 6 * 3600e3) return latest.val;
  const repo = process.env.BQ_REPO || 'Areng14/BrowserQuiz';
  let val;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/compare/${sha}...main`, {
      headers: { 'User-Agent': 'BrowserQuiz', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const app = (j.files || []).some((f) => APP.test(f.filename));
    const commits = j.commits || [];
    val = { behind: j.status === 'ahead' && app ? j.ahead_by : 0, newest: commits.length ? Date.parse(commits[commits.length - 1].commit.committer.date) : null };
  } catch (e) {
    val = { failed: true };
  }
  latest = { at: Date.now(), sha, val };
  return val;
}
const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
function freeDisk() {
  try { const s = fs.statfsSync(DATA_DIR); return s.bavail * s.bsize; } catch (e) { return null; }
}
// After a restore is in place: answer, then stop. Docker and Railway start it again (exit code 3: Railway
// restarts only after a failure), and db.js puts the backup in place first.
function restart(res) {
  json(res, 200, { ok: true, restarting: true });
  console.log('Restarting to restore a backup.');
  setTimeout(() => process.exit(3), 500);
}

module.exports = function serverRoutes(r) {
  r.get('/api/t/server', async (req, res) => {
    requireAdmin(req);
    const [update, languages, healthy] = await Promise.all([updates(revision), runnerLanguages(), runnerConfigured() ? runnerHealthy() : false]);
    const main = path.join(DATA_DIR, 'browserquiz.db');
    json(res, 200, {
      version: version || null,
      update,
      runner: { configured: runnerConfigured(), healthy, languages },
      dataBytes: size(main) + size(main + '-wal'),
      freeBytes: freeDisk(),
      backups: B.list(),
    });
  });

  r.post('/api/t/server/backups', (req, res) => {
    const me = requireAdmin(req);
    const name = B.make('manual');
    audit(me, 'backup', null, name);
    json(res, 200, { backups: B.list() });
  });

  r.get('/api/t/server/backups/:name', (req, res, p) => {
    requireAdmin(req);
    const file = B.fileOf(p.name);
    if (!file) throw new HttpError(404, 'not_found');
    res.writeHead(200, Object.assign({}, SECURITY, {
      'Content-Type': 'application/vnd.sqlite3', 'Content-Length': String(size(file)), 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
    }));
    fs.createReadStream(file).pipe(res);
  });

  // Restore one of the list's
  r.post('/api/t/server/restore', async (req, res) => {
    const me = requireAdmin(req);
    const body = await readJson(req);
    const file = B.fileOf(body.name);
    if (!file) throw new HttpError(404, 'not_found');
    if (B.quizInProgress(true)) throw new HttpError(409, 'busy', 'Students are in a quiz. Restore once it ends.');
    try { B.stage(file, false); } catch (e) { throw new HttpError(400, 'bad_backup', e.message); }
    audit(me, 'restore', null, path.basename(file));
    restart(res);
  });

  // Restore a downloaded backup: the file is the request's body
  r.post('/api/t/server/restore-upload', async (req, res) => {
    const me = requireAdmin(req);
    if (B.quizInProgress(true)) throw new HttpError(409, 'busy', 'Students are in a quiz. Restore once it ends.');
    if (receiving) throw new HttpError(409, 'busy', 'Another restore is uploading.');
    receiving = true;
    try {
      // A backup can take minutes to upload (index.js gives other requests one): only a stalled one stops
      req.longUpload = true;
      req.setTimeout(60000, () => req.destroy(new Error('upload stalled')));
      const tmp = path.join(DATA_DIR, 'restore-upload.tmp');
      await new Promise((resolve, reject) => {
        let n = 0;
        const out = fs.createWriteStream(tmp, { mode: 0o600 });
        req.on('data', (c) => { n += c.length; if (n > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(new HttpError(413, 'too_large')); } });
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
      }).catch((e) => { fs.rmSync(tmp, { force: true }); throw e; });
      // and again once it's here: a quiz may have started while it uploaded
      if (B.quizInProgress(true)) { fs.rmSync(tmp, { force: true }); throw new HttpError(409, 'busy', 'Students are in a quiz. Restore once it ends.'); }
      try { B.stage(tmp, true); } catch (e) { fs.rmSync(tmp, { force: true }); throw new HttpError(400, 'bad_backup', e.message); }
    } finally { receiving = false; }
    audit(me, 'restore', null, 'uploaded file');
    restart(res);
  });
};
