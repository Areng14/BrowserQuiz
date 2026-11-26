'use strict';
// Signing in: passwords, passkeys, and teacher accounts (the admin's).

const { readJson, cookies, addressKey, clientIp, HttpError, sleep, setCookie, json, sha256 } = require('../http');
const A = require('../accounts');
const crypto = require('node:crypto');
const V = require('../vault');
const { q } = require('../db');
const { runnerConfigured, runnerHealthy } = require('../coderun');
const PK = require('../passkeys');
const { TCH, audit, dropQuizzes, requireAdmin, requireTeacher } = require('./common');
const { TDEV, acctFails, devMisses, devSig, knownDevice, loginBucket, startSession } = require('./library');
const { quizDefaults } = require('./settings');

module.exports = function authRoutes(r) {
  // Username + password. No username means admin, the account from .env.
  r.post('/api/t/login', async (req, res) => {
    const body = await readJson(req, 4096);
    const uname = (String(body.username || '').trim() || 'admin').toLowerCase().slice(0, 100);
    const teacher = A.byUsername(String(body.username || '').trim() || 'admin');
    // A browser the teacher signed in from before has a budget of its own, so a classmate guessing from the
    // same school address (or from everywhere at once) can't keep the teacher out.
    const known = !!teacher && knownDevice(req, teacher);
    const devRand = known ? String(cookies(req)[TDEV]).split('.')[1] : null;
    const mine = known ? loginBucket('dev:' + devRand, 10, 6000) : loginBucket('ip:' + addressKey(clientIp(req), 48), 10, 6000);
    // the whole server: a backstop against guessing spread over many addresses (each account also locks)
    const all = known ? mine : loginBucket('all', 300, 200);
    if (mine.n < 1 || all.n < 1) throw new HttpError(429, 'too_many');
    mine.n--;
    if (all !== mine) all.n--;
    await sleep(250);
    const fail = acctFails.get(uname);
    if (fail && fail.until > Date.now() && !known) {
      throw new HttpError(429, 'locked', `Too many wrong passwords. Try again in ${Math.ceil((fail.until - Date.now()) / 1000)} seconds.`);
    }
    const ok = await A.checkPassword(String(body.password || ''), teacher && !teacher.disabled ? teacher.pw_hash : null);
    if (!ok) {
      if (devRand) devMisses.set(devRand, (devMisses.get(devRand) || 0) + 1);
      if (devMisses.size > 5000) devMisses.delete(devMisses.keys().next().value);
      const f = acctFails.get(uname) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (f.n - 5));
      acctFails.delete(uname);
      acctFails.set(uname, f); // newest last, so the oldest go first when it's full
      if (acctFails.size > 5000) {
        for (const [k, v] of acctFails) if (v.until < Date.now()) acctFails.delete(k);
        while (acctFails.size > 5000) acctFails.delete(acctFails.keys().next().value);
      }
      await sleep(1000);
      throw new HttpError(401, 'bad_password');
    }
    acctFails.delete(uname);
    const r = crypto.randomBytes(12).toString('base64url');
    setCookie(req, res, TDEV, `${teacher.id}.${r}.${devSig(teacher, r)}`, 180 * 86400); // this browser is theirs
    mine.n = Math.min(mine.cap, mine.n + 1);
    if (all !== mine) all.n = Math.min(all.cap, all.n + 1);
    // Unlock their quiz key. A teacher from before encryption gets one now, with a recovery code to keep.
    let recoveryCode = null;
    if (!(teacher.role === 'admin' && V.adminPasswordFromEnv()) && !teacher.must_change) {
      if (teacher.key_wrap) {
        const key = await V.unwrapKey(teacher.key_wrap, body.password);
        if (key) V.unlock(teacher.id, key);
        else q('UPDATE teachers SET must_change = 1 WHERE id = ?').run(teacher.id); // can't unlock: recovery code needed
      } else recoveryCode = await A.createKey(teacher.id, String(body.password));
    }
    startSession(req, res, teacher.id, false);
    json(res, 200, { ok: true, recoveryCode });
  });

  r.post('/api/t/logout', async (req, res) => {
    const t = cookies(req)[TCH];
    if (t) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(t));
    setCookie(req, res, TCH, '', 0);
    setCookie(req, res, TDEV, '', 0); // and this browser isn't "theirs" any more (a shared classroom computer)
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
        // A passkey sign-in unlocked it, though: only the teacher has that.
        needsRecovery: !!me.must_change && !!A.byId(me.id).key_wrap && !(me.passkey && V.keyFor(me.id)),
        tz: A.byId(me.id).tz || null, defaults: quizDefaults(A.byId(me.id)),
      },
    });
  });

  // A teacher sets their own password (the first time, from the temporary one). Admin's is in .env.
  r.post('/api/t/me/password', async (req, res) => {
    const me = requireTeacher(req, { setup: true });
    const body = await readJson(req, 4096);
    if (me.role === 'admin' && V.adminPasswordFromEnv() && !me.must_change) throw new HttpError(400, 'admin_env', 'The admin password is ADMIN_PASSWORD in .env. Change it there and restart.');
    const next = String(body.next || '');
    if (next.length < A.MIN_PASSWORD) throw new HttpError(400, 'weak', `Use at least ${A.MIN_PASSWORD} characters.`);
    const t = A.byId(me.id);
    // Admin still called "admin" (anyone could guess it) picks a username of their own with the password.
    let rename = null;
    if (me.role === 'admin' && t.username.toLowerCase() === 'admin') {
      rename = String(body.username || '').trim();
      if (!A.USERNAME.test(rename)) throw new HttpError(400, 'bad_username', 'Pick a username: 2 to 32 letters, digits, dots, dashes or underscores.');
      if (rename.toLowerCase() === 'admin') throw new HttpError(400, 'bad_username', 'Pick a username other than admin.');
      if (A.byUsername(rename)) throw new HttpError(400, 'taken', `${rename} is taken.`);
    }
    const tries = loginBucket('pw-check:' + me.id, 5, 60000);
    if (tries.n < 1) throw new HttpError(429, 'too_many', 'Too many tries. Wait a minute.');
    if (!(await A.checkPassword(String(body.current || ''), t.pw_hash))) {
      tries.n--;
      await sleep(1000);
      throw new HttpError(400, 'bad_password', 'The current password is wrong.');
    }
    // The quiz key moves to the new password. It's in memory, or the old password or the recovery code
    // opens it; "start over" drops quizzes nobody can open any more. After an admin reset (must_change),
    // the key in memory doesn't count: whoever has the temporary password needs the recovery code too,
    // unless this session's passkey unlocked it.
    let key = t.must_change && !me.passkey ? null : V.keyFor(me.id);
    if (!key && t.key_wrap) key = await V.unwrapKey(t.key_wrap, String(body.current || ''));
    if (!key && t.key_wrap && body.recoveryCode) key = await V.unwrapKey(t.rec_wrap, V.normCode(body.recoveryCode));
    if (!key && t.key_wrap && !body.startOver) {
      throw new HttpError(400, 'needs_recovery', body.recoveryCode ? "That recovery code doesn't match." : 'Enter your recovery code to keep your quizzes.');
    }
    if (!key && t.key_wrap) dropQuizzes(me);
    q('UPDATE teachers SET pw_hash = ?, must_change = 0 WHERE id = ?').run(await A.hashPassword(next), me.id);
    if (rename) { q('UPDATE teachers SET username = ? WHERE id = ?').run(rename, me.id); audit(me, 'rename-admin', null, rename); }
    let recoveryCode = null;
    if (key) {
      q('UPDATE teachers SET key_wrap = ? WHERE id = ?').run(await V.wrapKey(key, next), me.id);
      V.unlock(me.id, key);
    } else recoveryCode = await A.createKey(me.id, next);
    // Signed out everywhere else.
    q('DELETE FROM sessions WHERE teacher_id = ? AND token_hash != ?').run(me.id, sha256(cookies(req)[TCH]));
    audit(me, 'change-password', null, null);
    json(res, 200, { ok: true, recoveryCode });
  });

  // ---------- passkeys (passkeys.js) ----------
  // Each one holds the teacher's quiz key sealed with its PRF output, so signing in with it unlocks
  // their quizzes like a password does. Admin's key comes from .env while its password does: nothing
  // to seal there, so no PRF needed.
  const envAdmin = (t) => t.role === 'admin' && V.adminPasswordFromEnv();
  const passkeyList = (me) => q('SELECT id, name, created_at, last_used_at FROM passkeys WHERE teacher_id = ? ORDER BY created_at').all(me.id)
    .map((x) => ({ id: x.id, name: x.name, createdAt: x.created_at, lastUsedAt: x.last_used_at }));
  const MAX_PASSKEYS = 20;
  const pkBad = () => new HttpError(400, 'bad_passkey', "That passkey didn't work.");

  r.get('/api/t/passkeys', (req, res) => {
    const me = requireTeacher(req);
    json(res, 200, { passkeys: passkeyList(me) });
  });

  // Adding one: create() with these, then, if create() gave no PRF output, get() on the new passkey with
  // getChallenge. Both go to /add in one request.
  r.post('/api/t/passkeys/add-options', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 4096);
    // The password first: a passkey unlocks the quizzes for good, so someone at the teacher's unlocked
    // computer mustn't be able to add their own.
    const tries = loginBucket('pk-add:' + me.id, 5, 60000);
    if (tries.n < 1) throw new HttpError(429, 'too_many', 'Too many tries. Wait a minute.');
    if (!(await A.checkPassword(String(body.password || ''), A.byId(me.id).pw_hash))) {
      tries.n--;
      await sleep(1000);
      throw new HttpError(400, 'bad_password', 'That password is wrong.');
    }
    const { rpId } = PK.site(req);
    // The user handle passkeys carry: random, the same for all of a teacher's passkeys.
    if (!A.byId(me.id).pk_user) q('UPDATE teachers SET pk_user = ? WHERE id = ? AND pk_user IS NULL').run(crypto.randomBytes(16).toString('base64url'), me.id);
    json(res, 200, {
      rpId, user: { id: A.byId(me.id).pk_user, name: me.username, displayName: me.name },
      challenge: PK.newChallenge('add', me.id), getChallenge: PK.newChallenge('add-get', me.id),
      exclude: q('SELECT id FROM passkeys WHERE teacher_id = ?').all(me.id).map((x) => x.id),
      prfSalt: PK.PRF_SALT.toString('base64url'), needPrf: !envAdmin(me),
    });
  });

  r.post('/api/t/passkeys/add', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 96 * 1024);
    const ctx = { ...PK.site(req), teacherId: me.id };
    const cred = PK.readCreate(body.create, ctx, 'add');
    let signCount = cred.signCount;
    if (body.get != null) {
      const g = typeof body.get === 'object' ? body.get : {};
      const raw = PK.clientData(g.clientDataJSON, 'webauthn.get', 'add-get', me.id, ctx.origin);
      if (g.id !== cred.id) throw pkBad();
      signCount = Math.max(signCount, PK.checkAssertion(g, raw, cred.publicKey, ctx.rpId));
    }
    const prf = PK.prfOf(body.prf);
    if (!prf && !envAdmin(me)) throw new HttpError(400, 'no_prf', "This passkey can't unlock your quizzes. Try another.");
    if (q('SELECT 1 FROM passkeys WHERE id = ?').get(cred.id)) throw new HttpError(400, 'taken', 'That passkey is already added.');
    if (q('SELECT COUNT(*) AS n FROM passkeys WHERE teacher_id = ?').get(me.id).n >= MAX_PASSKEYS) throw new HttpError(400, 'too_many_passkeys', `That's ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const keyWrap = envAdmin(me) ? null : V.wrapKeyPrf(V.needKey(me.id), prf, V.passkeyAad(me.id, cred.id));
    const name = PK.passkeyName(cred.aaguid, body.attachment, req.headers['user-agent']);
    q('INSERT INTO passkeys (id, teacher_id, public_key, sign_count, name, created_at, key_wrap) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(cred.id, me.id, cred.publicKey, signCount, name, Date.now(), keyWrap);
    audit(me, 'add-passkey', null, name);
    json(res, 200, { ok: true, passkeys: passkeyList(me) });
  });

  r.post('/api/t/passkeys/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const row = PK.credIdOk(p.id) ? q('SELECT id, name FROM passkeys WHERE id = ? AND teacher_id = ?').get(p.id, me.id) : null;
    if (!row) throw new HttpError(404, 'not_found');
    q('DELETE FROM passkeys WHERE id = ? AND teacher_id = ?').run(row.id, me.id);
    audit(me, 'remove-passkey', null, row.name);
    json(res, 200, { ok: true, passkeys: passkeyList(me) });
  });

  // Sign-in: any passkey for this site (they're discoverable), so no username first.
  r.post('/api/t/passkeys/login-options', async (req, res) => {
    const mine = loginBucket('pk:' + addressKey(clientIp(req), 48), 20, 3000);
    if (mine.n < 1) throw new HttpError(429, 'too_many');
    mine.n--;
    const { rpId } = PK.site(req);
    json(res, 200, { rpId, challenge: PK.newChallenge('login', null), prfSalt: PK.PRF_SALT.toString('base64url') });
  });

  // Counted against the same budgets as password sign-in. Then like it: their quiz key is unlocked (with
  // the PRF output instead of the password) and they get the same session.
  r.post('/api/t/passkeys/login', async (req, res) => {
    const body = await readJson(req, 16 * 1024);
    // A passkey can't be guessed: this only caps the work, apart from the password limits a student can use up.
    const mine = loginBucket('pk:' + addressKey(clientIp(req), 48), 30, 2000);
    const all = mine;
    if (mine.n < 1) throw new HttpError(429, 'too_many');
    mine.n--;
    const { origin, rpId } = PK.site(req);
    const raw = PK.clientData(body.clientDataJSON, 'webauthn.get', 'login', null, origin);
    const pk = PK.credIdOk(body.id) ? q('SELECT * FROM passkeys WHERE id = ?').get(body.id) : null;
    if (!pk) throw new HttpError(400, 'unknown_passkey', "That passkey isn't set up here. Sign in with your password.");
    const teacher = A.byId(pk.teacher_id);
    if (!teacher || teacher.disabled) throw pkBad();
    if (body.userHandle != null && body.userHandle !== teacher.pk_user) throw pkBad();
    const count = PK.checkAssertion(body, raw, Buffer.from(pk.public_key), rpId);
    if (!PK.countOk(pk.sign_count, count)) throw pkBad();
    if (!envAdmin(teacher)) {
      const key = V.unwrapKeyPrf(pk.key_wrap, PK.prfOf(body.prf), V.passkeyAad(teacher.id, pk.id));
      if (!key) throw new HttpError(400, 'needs_password', "This passkey can't unlock your quizzes. Sign in with your password.");
      V.unlock(teacher.id, key);
    }
    q('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?').run(count, Date.now(), pk.id);
    mine.n = Math.min(mine.cap, mine.n + 1);
    if (all !== mine) all.n = Math.min(all.cap, all.n + 1);
    startSession(req, res, teacher.id, true);
    json(res, 200, { ok: true, recoveryCode: null });
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
    if (username.toLowerCase() === 'admin') throw new HttpError(400, 'bad_username', 'admin is kept for the first account. Pick another.');
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
      q("UPDATE runs SET status = 'closed', closed_at = ? WHERE owner_id = ? AND status = 'open'").run(Date.now(), t.id); // no new joins or name lookups
    } else if (p.action === 'enable') {
      q('UPDATE teachers SET disabled = 0 WHERE id = ?').run(t.id);
    } else throw new HttpError(404, 'not_found');
    audit(me, `${p.action}-teacher`, null, t.username);
    json(res, 200, out);
  });
};
