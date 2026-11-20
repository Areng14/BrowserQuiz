'use strict';
// Teacher accounts. "admin" signs in with ADMIN_PASSWORD from .env, so .env stays the way back in, and
// adds the other teachers. Each teacher sees only their own quizzes, classes and runs.
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

// A teacher's first key: wrapped with their password and with a new recovery code, which goes back to
// them once. Anything they already had gets sealed with it.
async function createKey(teacherId, password) {
  const key = V.newKey();
  const code = V.recoveryCode();
  q('UPDATE teachers SET key_wrap = ?, rec_wrap = ? WHERE id = ?').run(await V.wrapKey(key, password), await V.wrapKey(key, V.normCode(code)), teacherId);
  V.keyring.set(teacherId, key);
  encryptOwned(teacherId, key);
  return code;
}

// At startup: the admin account follows ADMIN_PASSWORD, and anything made before accounts existed
// belongs to admin.
async function ensureAdmin() {
  const pw = process.env.ADMIN_PASSWORD || '';
  let admin = byUsername('admin');
  if (!admin) {
    const id = crypto.randomUUID();
    q("INSERT INTO teachers (id, username, name, pw_hash, role, created_at) VALUES (?, 'admin', 'Admin', ?, 'admin', ?)").run(id, await hashPassword(pw), Date.now());
    admin = byId(id);
  } else if (!(await checkPassword(pw, admin.pw_hash)) || admin.role !== 'admin' || admin.disabled) {
    q("UPDATE teachers SET pw_hash = ?, role = 'admin', disabled = 0, must_change = 0 WHERE id = ?").run(await hashPassword(pw), admin.id);
  }
  for (const t of ['quizzes', 'rosters', 'runs']) q(`UPDATE ${t} SET owner_id = ? WHERE owner_id IS NULL`).run(admin.id);
  q('DELETE FROM sessions WHERE teacher_id IS NULL').run(); // sessions from before accounts
  V.setAdmin(admin.id);
  encryptOwned(admin.id, V.keyFor(admin.id));
  return admin.id;
}

module.exports = { hashPassword, checkPassword, tempPassword, byUsername, byId, ensureAdmin, createKey, encryptOwned, USERNAME, MIN_PASSWORD };
