'use strict';
// Quiz encryption, so whoever hosts BrowserQuiz can't read a teacher's quizzes from the database or a
// backup. Each teacher's quizzes and images are sealed with their own key (AES-256-GCM). The key is
// stored only wrapped: once with their password and once with a recovery code they keep. It's unwrapped
// when they sign in and held in memory until the server restarts; until they sign in again, their quizzes
// stay locked (students are asked to wait).
//
// The server still has to read a quiz to grade it, so a host who changes the server's code can get at a
// quiz while it's unlocked. Admin's key comes from ID_PEPPER in .env: admin's quizzes are only as private
// as .env, which the host has anyway.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./http');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const keyring = new Map(); // teacher id -> their quiz key, while unlocked
// Signing in puts a teacher's key in memory; what's waiting on it (people.js, index.js) hears about it.
const unlockHooks = [];
function unlock(teacherId, key) {
  keyring.set(teacherId, key);
  for (const fn of unlockHooks) {
    try { fn(teacherId); } catch (e) { console.error('after unlock:', e.message); }
  }
}
const onUnlock = (fn) => unlockHooks.push(fn);
let adminId = null;
let adminKey = null;

// iv (12) | tag (16) | ciphertext. The AAD ties a blob to where it belongs, so blobs can't be swapped.
function seal(key, data, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function open(key, blob, aad) {
  const b = Buffer.from(blob);
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
const sealText = (key, text, aad) => 'v1:' + seal(key, Buffer.from(String(text), 'utf8'), aad).toString('base64');
const openText = (key, s, aad) => open(key, Buffer.from(String(s).slice(3), 'base64'), aad).toString('utf8');
const quizAad = (quizId) => `quiz:${quizId}`;
const assetAad = (quizId, path) => `asset:${quizId}:${path}`;

// A key wrapped with a password or recovery code: salt:sealed. Its own salt, so the sign-in hash says
// nothing about it.
async function wrapKey(key, secret) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('base64')}:${seal(await scrypt(String(secret), salt, 32, SCRYPT), key, 'quiz key').toString('base64')}`;
}
async function unwrapKey(wrapped, secret) {
  const [salt, blob] = String(wrapped || '').split(':');
  if (!salt || !blob) return null;
  try {
    return open(await scrypt(String(secret), Buffer.from(salt, 'base64'), 32, SCRYPT), Buffer.from(blob, 'base64'), 'quiz key');
  } catch (e) {
    return null;
  }
}
const newKey = () => crypto.randomBytes(32);

// A key wrapped for a passkey (passkeys.js): sealed with a key derived from what the passkey's PRF gives
// (32 bytes the authenticator only hands over after a fingerprint, face or PIN). The AAD names the
// passkey and its teacher, so a wrap can't be moved to another passkey or account.
const prfKey = (prf) => Buffer.from(crypto.hkdfSync('sha256', prf, Buffer.alloc(0), 'browserquiz passkey quiz key', 32));
const passkeyAad = (teacherId, credId) => `passkey:${teacherId}:${credId}`;
const wrapKeyPrf = (key, prf, aad) => 'v1:' + seal(prfKey(prf), key, aad).toString('base64');
function unwrapKeyPrf(wrapped, prf, aad) {
  if (!wrapped || !Buffer.isBuffer(prf) || prf.length !== 32) return null;
  try { return open(prfKey(prf), Buffer.from(String(wrapped).slice(3), 'base64'), aad); } catch (e) { return null; }
}

// 20 letters and digits (100 bits) in groups of 4. Dashes, spaces and case don't matter when typed back.
function recoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('')).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Admin's quiz key comes from ID_PEPPER while admin's password comes from .env (fromEnv). Otherwise
// admin is like any teacher: a key only their own password or recovery code opens.
const pepperKey = () => Buffer.from(crypto.hkdfSync('sha256', String(process.env.ID_PEPPER || ''), 'browserquiz', 'admin quiz key', 32));
let adminFromEnv = false;
function setAdmin(id, fromEnv) {
  adminId = id;
  adminFromEnv = !!fromEnv;
  adminKey = adminFromEnv ? pepperKey() : null;
}
// The key admin's quizzes had while it came from .env, to move them to admin's own key once.
const legacyAdminKey = (id) => (id && id === adminId ? pepperKey() : null);
function keyFor(ownerId) {
  if (ownerId && ownerId === adminId && adminKey) return adminKey;
  return keyring.get(ownerId) || null;
}
// The owner's key, or "locked": students see a wait message, and the teacher signing in unlocks it.
function needKey(ownerId) {
  const k = keyFor(ownerId);
  if (!k) throw new HttpError(503, 'locked', "This quiz's teacher needs to sign in to BrowserQuiz first.");
  return k;
}
const isAdmin = (id) => id === adminId;
const adminPasswordFromEnv = () => adminFromEnv;

module.exports = {
  keyring, unlock, onUnlock, seal, open, sealText, openText, quizAad, assetAad, wrapKey, unwrapKey, newKey,
  passkeyAad, wrapKeyPrf, unwrapKeyPrf, recoveryCode, normCode, setAdmin, keyFor, needKey, isAdmin, legacyAdminKey, adminPasswordFromEnv,
};
