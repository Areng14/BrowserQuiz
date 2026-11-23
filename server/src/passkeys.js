'use strict';
// Passkeys (WebAuthn) for teacher sign-in, with no libraries: a small CBOR reader, COSE keys to Node
// keys, and the checks on what the browser sends back. Attestation is "none": the credential's key is
// read out of it, and nobody's hardware is vouched for.
//
// A passkey also unlocks the teacher's quiz key (vault.js) through the PRF extension: the authenticator
// turns a fixed salt into 32 secret bytes that only that passkey gives, after a fingerprint, face or PIN.
// The quiz key is stored sealed with them, so the database alone can't open it, as with a password.
const crypto = require('node:crypto');
const { HttpError, siteOrigin } = require('./http');

const bad = () => new HttpError(400, 'bad_passkey', "That passkey didn't work.");

// ---------- CBOR (RFC 8949), only what WebAuthn uses ----------
// Maps, arrays, byte and text strings, integers, true, false and null. Anything else (tags, floats,
// indefinite lengths) is refused, and so are deep nesting, too many items and duplicate map keys.
const utf8 = new TextDecoder('utf-8', { fatal: true });
function decodeCbor(buf, start = 0) {
  let pos = start;
  let items = 0;
  const need = (n) => { if (n > buf.length - pos) throw bad(); };
  function uint(ai) {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return buf[pos++]; }
    if (ai === 25) { need(2); pos += 2; return buf.readUInt16BE(pos - 2); }
    if (ai === 26) { need(4); pos += 4; return buf.readUInt32BE(pos - 4); }
    if (ai === 27) {
      need(8); pos += 8;
      const v = buf.readBigUInt64BE(pos - 8);
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw bad();
      return Number(v);
    }
    throw bad(); // 28-30 reserved, 31 indefinite length
  }
  function item(depth) {
    if (depth > 8 || ++items > 256) throw bad();
    need(1);
    const b = buf[pos++];
    const ai = b & 31;
    switch (b >> 5) {
      case 0: return uint(ai);
      case 1: return -1 - uint(ai);
      case 2: { const n = uint(ai); need(n); pos += n; return Buffer.from(buf.subarray(pos - n, pos)); }
      case 3: {
        const n = uint(ai); need(n); pos += n;
        try { return utf8.decode(buf.subarray(pos - n, pos)); } catch (e) { throw bad(); }
      }
      case 4: { const n = uint(ai); const a = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
      case 5: {
        const n = uint(ai);
        const m = new Map();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          if ((typeof k !== 'number' && typeof k !== 'string') || m.has(k)) throw bad();
          m.set(k, item(depth + 1));
        }
        return m;
      }
      case 7:
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        throw bad();
      default: throw bad(); // 6: tags
    }
  }
  return { value: item(0), end: pos };
}
function decodeAll(buf) {
  const { value, end } = decodeCbor(buf);
  if (end !== buf.length) throw bad();
  return value;
}

// ---------- authenticator data ----------
const UP = 0x01; // user present
const UV = 0x04; // user verified: fingerprint, face or PIN
const AT = 0x40; // a new credential follows
const ED = 0x80; // extensions follow
function parseAuthData(buf) {
  if (buf.length < 37) throw bad();
  const out = { rpIdHash: buf.subarray(0, 32), flags: buf[32], signCount: buf.readUInt32BE(33) };
  let pos = 37;
  if (out.flags & AT) {
    if (buf.length < pos + 18) throw bad();
    out.aaguid = buf.subarray(pos, pos + 16);
    const n = buf.readUInt16BE(pos + 16);
    pos += 18;
    if (n < 16 || n > 1023 || buf.length < pos + n) throw bad();
    out.credId = Buffer.from(buf.subarray(pos, pos + n));
    pos += n;
    const k = decodeCbor(buf, pos);
    out.coseKey = k.value;
    pos = k.end;
  }
  if (out.flags & ED) {
    const e = decodeCbor(buf, pos);
    if (!(e.value instanceof Map)) throw bad();
    pos = e.end;
  }
  if (pos !== buf.length) throw bad();
  return out;
}
function checkAuthData(ad, rpId) {
  if (!ad.rpIdHash.equals(crypto.createHash('sha256').update(rpId).digest())) throw bad();
  if ((ad.flags & (UP | UV)) !== (UP | UV)) throw bad();
}

// ---------- COSE keys: ES256 (-7, P-256), EdDSA (-8, Ed25519), RS256 (-257) ----------
function coseKey(m) {
  if (!(m instanceof Map)) throw bad();
  const kty = m.get(1);
  const alg = m.get(3);
  const b64 = (v, min, max) => {
    if (!Buffer.isBuffer(v) || v.length < min || v.length > max) throw bad();
    return v.toString('base64url');
  };
  let jwk;
  if (alg === -7 && kty === 2 && m.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b64(m.get(-2), 32, 32), y: b64(m.get(-3), 32, 32) };
  else if (alg === -8 && kty === 1 && m.get(-1) === 6) jwk = { kty: 'OKP', crv: 'Ed25519', x: b64(m.get(-2), 32, 32) };
  else if (alg === -257 && kty === 3) jwk = { kty: 'RSA', n: b64(m.get(-1), 256, 512), e: b64(m.get(-2), 1, 4) };
  else throw new HttpError(400, 'bad_passkey', "This kind of passkey isn't supported. Try another.");
  try { return crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch (e) { throw bad(); }
}
// ES256 signatures come DER-encoded; RS256 is PKCS#1 v1.5.
function verifySig(spki, data, sig) {
  try {
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const t = key.asymmetricKeyType;
    if (t === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1') return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
    if (t === 'ed25519') return crypto.verify(null, data, key, sig);
    if (t === 'rsa') return crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
  } catch (e) { /* bad key or signature */ }
  return false;
}

// ---------- challenges: random, single use, 2 minutes, kept here ----------
const CHALLENGE_MS = 2 * 60000;
const challenges = new Map(); // challenge -> { kind, teacherId, at }
function newChallenge(kind, teacherId) {
  const now = Date.now();
  if (challenges.size >= 5000) for (const [k, v] of challenges) if (now - v.at > CHALLENGE_MS) challenges.delete(k);
  while (challenges.size >= 5000) challenges.delete(challenges.keys().next().value); // the oldest go first
  const c = crypto.randomBytes(32).toString('base64url');
  challenges.set(c, { kind, teacherId: teacherId || null, at: now });
  return c;
}
function takeChallenge(c, kind, teacherId) {
  const e = typeof c === 'string' ? challenges.get(c) : null;
  if (e) challenges.delete(c);
  if (!e || e.kind !== kind || e.teacherId !== (teacherId || null)) throw bad();
  if (Date.now() - e.at > CHALLENGE_MS) throw new HttpError(400, 'expired', 'That took too long. Try again.');
}

// ---------- what the browser sends ----------
// base64url, with a size limit.
function bytes(s, max) {
  if (typeof s !== 'string' || !s || s.length > Math.ceil((max * 4) / 3) || !/^[A-Za-z0-9_-]+$/.test(s)) throw bad();
  const b = Buffer.from(s, 'base64url');
  if (!b.length || b.length > max) throw bad();
  return b;
}
const credIdOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22,1364}$/.test(s);

// Where passkeys belong: this site's host name (no port), and its origin. Plain names only.
function site(req) {
  const origin = siteOrigin(req);
  const rpId = origin && new URL(origin).hostname;
  if (!rpId || /^[\d.]+$/.test(rpId)) throw new HttpError(400, 'no_passkeys', "Passkeys need this site's name, not its address.");
  return { origin, rpId };
}

// clientDataJSON: its challenge is used up first (whatever else is wrong), then its type and origin.
function clientData(b64, type, kind, teacherId, origin) {
  const raw = bytes(b64, 4096);
  let c;
  try { c = JSON.parse(raw.toString('utf8')); } catch (e) { throw bad(); }
  if (!c || typeof c !== 'object') throw bad();
  takeChallenge(c.challenge, kind, teacherId);
  if (c.type !== type || c.origin !== origin || c.crossOrigin === true) throw bad();
  return raw;
}

// A new passkey from navigator.credentials.create(): its id, public key (SPKI DER), count and maker.
function readCreate(body, ctx, kind) {
  const b = body && typeof body === 'object' ? body : {};
  clientData(b.clientDataJSON, 'webauthn.create', kind, ctx.teacherId, ctx.origin);
  const att = decodeAll(bytes(b.attestationObject, 32 * 1024));
  if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !Buffer.isBuffer(att.get('authData'))) throw bad();
  const ad = parseAuthData(att.get('authData'));
  checkAuthData(ad, ctx.rpId);
  if (!ad.credId || ad.coseKey === undefined) throw bad();
  const id = ad.credId.toString('base64url');
  if (b.id !== id) throw bad();
  const key = coseKey(ad.coseKey);
  const hex = ad.aaguid.toString('hex');
  return {
    id, publicKey: key.export({ type: 'spki', format: 'der' }), signCount: ad.signCount,
    aaguid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}
// A signature from navigator.credentials.get(), over authenticatorData || sha256(clientDataJSON), by the
// stored key. clientDataJSON was already checked (clientData). Returns the new signature count.
function checkAssertion(body, clientRaw, spki, rpId) {
  const authData = bytes(body.authenticatorData, 2048);
  const sig = bytes(body.signature, 1024);
  const ad = parseAuthData(authData);
  if (ad.flags & AT) throw bad();
  checkAuthData(ad, rpId);
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientRaw).digest()]);
  if (!verifySig(spki, signed, sig)) throw bad();
  return ad.signCount;
}
// signCount only goes up, when the authenticator keeps one (synced passkeys stay at 0).
function countOk(stored, next) {
  return !(stored && next && next <= stored);
}

// What the PRF extension is given: the same for every passkey (each gives its own output from it), so
// sign-in can ask without knowing which passkey will answer.
const PRF_SALT = crypto.createHash('sha256').update('BrowserQuiz quiz key v1').digest();
// The PRF output the browser passes on: 32 bytes, or none.
function prfOf(s) {
  if (s == null) return null;
  const b = bytes(s, 32);
  if (b.length !== 32) throw bad();
  return b;
}

// A name for the list: who keeps the passkey, from its AAGUID, or else the browser it was added in.
const MAKERS = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain', 'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager', 'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  '771b48fd-d3d4-4f74-9232-fc157ab0507a': 'Edge on Mac', '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello', '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password', 'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane', '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': 'NordPass', '0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6': 'Keeper',
};
function passkeyName(aaguid, attachment, ua) {
  if (MAKERS[aaguid]) return MAKERS[aaguid];
  if (attachment === 'cross-platform') return 'Security key';
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /CrOS/.test(s) ? 'Chromebook'
    : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : null;
  return browser && os ? `${browser} on ${os}` : browser || os || 'Passkey';
}

module.exports = {
  decodeCbor, decodeAll, parseAuthData, coseKey, verifySig, newChallenge, takeChallenge, site, clientData,
  readCreate, checkAssertion, countOk, bytes, credIdOk, prfOf, passkeyName, PRF_SALT, CHALLENGE_MS,
};
