'use strict';
// Teacher accounts. "admin" signs in with ADMIN_PASSWORD from .env, so .env stays the way back in, and
// adds the other teachers. Each teacher sees only their own quizzes, classes and runs.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { q } = require('./db');

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
  return admin.id;
}

module.exports = { hashPassword, checkPassword, tempPassword, byUsername, byId, ensureAdmin, USERNAME, MIN_PASSWORD };
