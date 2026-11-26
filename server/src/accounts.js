'use strict';
// Teacher accounts. "admin" adds the other teachers. Admin either signs in with ADMIN_PASSWORD from .env,
// or (with no ADMIN_PASSWORD) gets a one-time code in the server log and picks their own password. Each teacher sees only their own quizzes, classes and runs.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { db, q, tx } = require('./db');
const V = require('./vault');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;
const DUMMY = `scrypt$${crypto.randomBytes(16).toString('base64')}$${crypto.randomBytes(KEYLEN).toString('base64')}`;
const USERNAME = /^[A-Za-z0-9._-]{2,32}$/;
const MIN_PASSWORD = 10;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
// Always does the full hash, even for an unknown user, so timing doesn't show which usernames exist.
async function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || DUMMY).split('$');
  const want = Buffer.from(hash || '', 'base64');
  const got = await scrypt(String(pw), Buffer.from(salt || '', 'base64'), KEYLEN, SCRYPT);
  return kind === 'scrypt' && !!stored && want.length === got.length && crypto.timingSafeEqual(want, got);
}

// A temporary password that's easy to read out loud: xxxx-xxxx-xxxx, no 0/O or 1/l.
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}

const byUsername = (u) => q('SELECT * FROM teachers WHERE username = ?').get(String(u || ''));
const byId = (id) => q('SELECT * FROM teachers WHERE id = ?').get(String(id || ''));

// Seals a teacher's quizzes and images that are still plain (made before encryption), then flushes the
// write-ahead log so the plain copies are gone from the database files too (secure_delete zeroes them).
function encryptOwned(ownerId, key) {
  let n = 0;
  tx(() => {
    for (const row of q('SELECT id, json FROM quizzes WHERE owner_id = ? AND enc = 0').all(ownerId)) {
      q('UPDATE quizzes SET json = ?, enc = 1 WHERE id = ?').run(V.sealText(key, row.json, V.quizAad(row.id)), row.id);
      for (const a of q('SELECT path, bytes FROM assets WHERE quiz_id = ? AND enc = 0').all(row.id)) {
        q('UPDATE assets SET bytes = ?, enc = 1 WHERE quiz_id = ? AND path = ?').run(V.seal(key, Buffer.from(a.bytes), V.assetAad(row.id, a.path)), row.id, a.path);
      }
      n++;
    }
  });
  if (n) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return n;
}

// Moves a teacher's sealed quizzes and images from one key to another, then flushes the old copies.
function rekeyOwned(ownerId, oldKey, newKey) {
  let n = 0;
  tx(() => {
    for (const row of q('SELECT id, json FROM quizzes WHERE owner_id = ? AND enc = 1').all(ownerId)) {
      let text;
      try { text = V.openText(oldKey, row.json, V.quizAad(row.id)); } catch (e) { continue; } // not under the old key
      q('UPDATE quizzes SET json = ? WHERE id = ?').run(V.sealText(newKey, text, V.quizAad(row.id)), row.id);
      for (const a of q('SELECT path, bytes FROM assets WHERE quiz_id = ? AND enc = 1').all(row.id)) {
        const bytes = V.open(oldKey, Buffer.from(a.bytes), V.assetAad(row.id, a.path));
        q('UPDATE assets SET bytes = ? WHERE quiz_id = ? AND path = ?').run(V.seal(newKey, bytes, V.assetAad(row.id, a.path)), row.id, a.path);
      }
      n++;
    }
    // their own Anthropic key for AI grading (teacher/common.js aiKeyOf)
    const t = q('SELECT ai_key FROM teachers WHERE id = ?').get(ownerId);
    if (t && t.ai_key) {
      const aad = `aikey:${ownerId}`;
      try { q('UPDATE teachers SET ai_key = ? WHERE id = ?').run(V.sealText(newKey, V.openText(oldKey, t.ai_key, aad), aad), ownerId); n++; } catch (e) { /* not under the old key */ }
    }
  });
  if (n) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return n;
}

// A teacher's first key: wrapped with their password and with a new recovery code, which goes back to
// them once. Anything they already had gets sealed with it. (Admin's quizzes from when its key came
// from .env move to the new key, so .env no longer opens them.) Their passkeys go: they hold the old key
// (or none, for admin from .env), so they'd sign in to quizzes they can't open.
async function createKey(teacherId, password) {
  const key = V.newKey();
  const code = V.recoveryCode();
  const keyWrap = await V.wrapKey(key, password);
  const recWrap = await V.wrapKey(key, V.normCode(code));
  tx(() => {
    q('UPDATE teachers SET key_wrap = ?, rec_wrap = ? WHERE id = ?').run(keyWrap, recWrap, teacherId);
    q('DELETE FROM passkeys WHERE teacher_id = ?').run(teacherId);
  });
  if (V.isAdmin(teacherId)) V.setAdmin(teacherId, false); // .env no longer keys anything of theirs
  V.unlock(teacherId, key);
  const old = V.legacyAdminKey(teacherId);
  if (old) { rekeyOwned(teacherId, old, key); require('./people').sealPeople(teacherId, old, key); }
  encryptOwned(teacherId, key);
  return code;
}

const getSetting = (k) => { const r = q('SELECT v FROM settings WHERE k = ?').get(k); return r ? r.v : null; };
const setSetting = (k, v) => q('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);

// At startup, and anything made before accounts existed belongs to admin.
// - ADMIN_PASSWORD set: admin signs in with it (and admin's quiz key comes from ID_PEPPER), until admin
//   has picked a password of its own.
// - No ADMIN_PASSWORD: admin is like any teacher. The log shows a one-time code to sign in with, and
//   admin picks their own password and gets a recovery code. A new code is printed while the old one
//   is unused, and once each time ADMIN_RESET is set to a new value (forgot the password).
async function ensureAdmin() {
  const pw = process.env.ADMIN_PASSWORD || '';
  // Admin is found by role: they pick their own username at the first sign-in (teacher/auth.js me/password)
  let admin = q("SELECT * FROM teachers WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() || byUsername('admin');
  let code = null;
  if (!admin) {
    const id = crypto.randomUUID();
    if (!pw) code = tempPassword();
    q("INSERT INTO teachers (id, username, name, pw_hash, role, created_at, must_change) VALUES (?, 'admin', 'Admin', ?, 'admin', ?, ?)")
      .run(id, await hashPassword(pw || code), Date.now(), pw ? 0 : 1);
    admin = byId(id);
  }
  if (admin.role !== 'admin' || admin.disabled) q("UPDATE teachers SET role = 'admin', disabled = 0 WHERE id = ?").run(admin.id);
  const fromEnv = !!pw && !admin.key_wrap;
  if (pw && admin.key_wrap) console.log('BrowserQuiz: admin has its own password, so ADMIN_PASSWORD is not used. Locked out? Set ADMIN_RESET.');
  // ADMIN_PASSWORD is only for the first sign-in: then admin picks their own password (it can be the same)
  // and gets their own key and a recovery code, so .env no longer opens admin's quizzes or students.
  if (fromEnv && (!admin.must_change || !(await checkPassword(pw, admin.pw_hash)))) {
    q('UPDATE teachers SET pw_hash = ?, must_change = 1 WHERE id = ?').run(await hashPassword(pw), admin.id);
  }
  if (!fromEnv && !code) {
    const reset = process.env.ADMIN_RESET || '';
    const fresh = !!reset && reset !== getSetting('admin_reset');
    const unused = admin.must_change && !admin.key_wrap; // set up, but the code was never used
    if (fresh || unused) {
      code = tempPassword();
      q('UPDATE teachers SET pw_hash = ?, must_change = 1 WHERE id = ?').run(await hashPassword(code), admin.id);
      q('DELETE FROM sessions WHERE teacher_id = ?').run(admin.id);
      if (fresh) setSetting('admin_reset', reset);
    }
  }
  for (const t of ['quizzes', 'rosters', 'runs']) q(`UPDATE ${t} SET owner_id = ? WHERE owner_id IS NULL`).run(admin.id);
  q('DELETE FROM sessions WHERE teacher_id IS NULL').run(); // sessions from before accounts
  V.setAdmin(admin.id, fromEnv);
  if (fromEnv) { encryptOwned(admin.id, V.keyFor(admin.id)); require('./people').sealPeople(admin.id); }
  if (code) console.log(`\nBrowserQuiz: sign in at /teacher as "${admin.username}" with this one-time code: ${code}\nYou'll pick your own password right after.\n`);
  return admin.id;
}

module.exports = { hashPassword, checkPassword, tempPassword, byUsername, byId, ensureAdmin, createKey, encryptOwned, rekeyOwned, USERNAME, MIN_PASSWORD };
