'use strict';
// A teacher's own settings (the dashboard's Settings page): their name and time zone, what Give a quiz
// starts with, a new recovery code, and signing out their other browsers. The password and passkeys are
// in auth.js, the AI key in runs.js.

const { readJson, cookies, HttpError, json, sleep, sha256 } = require('../http');
const A = require('../accounts');
const V = require('../vault');
const { q } = require('../db');
const { TCH, audit, requireTeacher } = require('./common');
const { loginBucket } = require('./library');

const MODES = ['exam', 'seb', 'practice'];
const SEB_KEY = /^[0-9a-f]{64}$/;
// What Give a quiz starts with. The form still shows every option, so these only fill it in.
function quizDefaults(t) {
  let d = {};
  try { d = JSON.parse((t && t.defaults) || '{}') || {}; } catch (e) { d = {}; }
  return {
    mode: MODES.includes(d.mode) ? d.mode : 'exam',
    ipLock: d.ipLock === true,
    sebMute: d.sebMute !== false,
    sebKey: typeof d.sebKey === 'string' && SEB_KEY.test(d.sebKey) ? d.sebKey : '',
  };
}
// An IANA time zone the server's Intl knows ("America/New_York"), or null for the browser's own.
function timeZoneOk(tz) {
  if (!tz || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}
const otherSessions = (req, me) => q('SELECT COUNT(*) AS n FROM sessions WHERE teacher_id = ? AND token_hash != ?').get(me.id, sha256(cookies(req)[TCH] || '')).n;
// The password again, for what someone at the teacher's unlocked computer mustn't do on their own.
async function passwordAgain(me, password) {
  const tries = loginBucket('pw-check:' + me.id, 5, 60000);
  if (tries.n < 1) throw new HttpError(429, 'too_many', 'Too many tries. Wait a minute.');
  const t = A.byId(me.id);
  if (!(await A.checkPassword(String(password || ''), t.pw_hash))) {
    tries.n--;
    await sleep(1000);
    throw new HttpError(400, 'bad_password', 'That password is wrong.');
  }
  return t;
}

function settingsRoutes(r) {
  r.get('/api/t/settings', (req, res) => {
    const me = requireTeacher(req);
    const t = A.byId(me.id);
    json(res, 200, {
      name: t.name, tz: t.tz || null, defaults: quizDefaults(t), otherSessions: otherSessions(req, me),
      // admin with ADMIN_PASSWORD in .env has no quiz key of their own yet, so no recovery code either
      recovery: !!t.key_wrap && !(t.role === 'admin' && V.adminPasswordFromEnv()),
    });
  });

  r.post('/api/t/settings/you', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!name) throw new HttpError(400, 'bad_name', 'Add your name.');
    if (name.length > 80) throw new HttpError(400, 'bad_name', 'Use 80 characters or fewer.');
    const tz = body.tz == null || body.tz === '' ? null : String(body.tz);
    if (tz !== null && !timeZoneOk(tz)) throw new HttpError(400, 'bad_tz', "That time zone isn't one this server knows.");
    q('UPDATE teachers SET name = ?, tz = ? WHERE id = ?').run(name, tz, me.id);
    if (name !== me.name) audit(me, 'rename', null, name);
    json(res, 200, { ok: true, name, tz });
  });

  r.post('/api/t/settings/defaults', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    const mode = String(body.mode || '');
    if (!MODES.includes(mode)) throw new HttpError(400, 'bad_mode', 'Pick a mode.');
    const sebKey = body.sebKey ? String(body.sebKey).trim().toLowerCase() : '';
    if (sebKey && !SEB_KEY.test(sebKey)) throw new HttpError(400, 'bad_seb_key', "The Config Key is 64 letters and digits. Copy it from SEB Config Tool's Exam tab.");
    const d = { mode, ipLock: body.ipLock === true, sebMute: body.sebMute !== false, sebKey };
    q('UPDATE teachers SET defaults = ? WHERE id = ?').run(JSON.stringify(d), me.id);
    json(res, 200, { ok: true, defaults: quizDefaults({ defaults: JSON.stringify(d) }) });
  });

  // A new recovery code, and the old one stops working. The quiz key stays the same: it's wrapped again
  // with the new code (not accounts.js createKey, which makes a new key and drops the passkeys).
  r.post('/api/t/settings/recovery-code', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    if (me.role === 'admin' && V.adminPasswordFromEnv()) throw new HttpError(400, 'admin_env', "Admin's quizzes are opened with ADMIN_PASSWORD in .env, so there's no recovery code.");
    const t = await passwordAgain(me, body.password);
    // the key the password opens, so the code always matches what's stored
    const key = t.key_wrap ? await V.unwrapKey(t.key_wrap, String(body.password)) : null;
    if (!key) throw new HttpError(400, 'no_key', "Your quizzes can't be opened with this password. Sign out and in again.");
    const code = V.recoveryCode();
    q('UPDATE teachers SET rec_wrap = ? WHERE id = ?').run(await V.wrapKey(key, V.normCode(code)), me.id);
    audit(me, 'new-recovery-code', null, null);
    json(res, 200, { ok: true, recoveryCode: code });
  });

  // Every other browser this teacher is signed in on is signed out (this one stays).
  r.post('/api/t/settings/sign-out-others', (req, res) => {
    const me = requireTeacher(req);
    const n = q('DELETE FROM sessions WHERE teacher_id = ? AND token_hash != ?').run(me.id, sha256(cookies(req)[TCH] || '')).changes;
    audit(me, 'sign-out-others', null, String(n));
    json(res, 200, { ok: true, otherSessions: 0 });
  });
}

module.exports = settingsRoutes;
module.exports.quizDefaults = quizDefaults;
