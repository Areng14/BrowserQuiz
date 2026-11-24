'use strict';
// Small HTTP toolkit: routing, bodies, cookies, static files and security headers. No dependencies.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const TRUST_PROXY = process.env.TRUST_PROXY === '1';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// Only trust X-Forwarded-For when we sit behind our own proxy (Caddy). Then the last hop is the client,
// because Caddy appends the address it actually saw. Anything earlier in the header is client-supplied.
function clientIp(req) {
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// The address an attempt is pinned to. Without TRUST_PROXY an X-Forwarded-For header is ignored: anyone can
// send one, so it mustn't switch the pin off. (Behind a proxy we don't trust, that's the proxy's address for
// everyone, which pins nothing but breaks nothing.)
function trustedIp(req) {
  return clientIp(req);
}
// The key for per-address limits. IPv6 hands every device its own address (and a student can pick new ones
// within their network), so one network's /64 counts as one address, like a school's shared IPv4.
function addressKey(ip) {
  ip = String(ip || '').replace(/^::ffff:(?=\d+\.)/i, '');
  if (net.isIP(ip) !== 6) return ip;
  return ipv6Groups(ip).slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}
// "Only this network" check. The lock holds the teacher's address from when they started the quiz.
// - Same address: hosted off campus, the whole school shares one public IP.
// - Both private (10.x, 192.168.x, fd00::...): self-hosted on the school LAN, which is itself the boundary.
// - IPv6: every device has its own address, so match the site prefix (/48) instead.
function ipv6Groups(ip) {
  let s = ip.split('%')[0];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) s = s.slice(0, v4.index) + ((+v4[1] << 8) | +v4[2]).toString(16) + ':' + ((+v4[3] << 8) | +v4[4]).toString(16);
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}
function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) {
    const g = ipv6Groups(ip);
    return (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) || (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
  }
  return false;
}
function sameNetwork(ip, lock) {
  ip = String(ip).replace(/^::ffff:/i, '');
  lock = String(lock || '').replace(/^::ffff:/i, '');
  if (!lock || ip === lock) return true;
  const kind = net.isIP(ip);
  if (!kind || kind !== net.isIP(lock)) return false;
  if (isPrivateIp(ip) && isPrivateIp(lock)) return true;
  if (kind === 6) return ipv6Groups(ip).slice(0, 3).join(':') === ipv6Groups(lock).slice(0, 3).join(':');
  return false;
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// This site's own origin as the browser names it (https://quiz.example.org), from the Host header. null
// for a Host that isn't a plain name[:port].
function siteOrigin(req) {
  const host = String(req.headers.host || '');
  if (!/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) return null;
  try { return new URL(`${isHttps(req) ? 'https' : 'http'}://${host}`).origin; } catch (e) { return null; }
}

function cookies(req) {
  const out = Object.create(null);
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* bad cookie: ignore */ }
  }
  return out;
}
function setCookie(req, res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : parts.join('; '));
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
  + "worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SECURITY, headers || {}));
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(new HttpError(413, 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const b = await readBody(req, limit || 256 * 1024);
  if (!b.length) return {};
  let v;
  try { v = JSON.parse(b.toString('utf8')); } catch (e) { throw new HttpError(400, 'bad_json'); }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function router() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(res, rootDir, rel, longCache) {
  const root = path.resolve(rootDir);
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) return false;
  const headers = { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache' };
  if (ext === '.html') headers['Content-Security-Policy'] = PAGE_CSP;
  // The one page that goes in a frame: the student's screen inside the teacher's Watch page, same origin only.
  if (file.endsWith(path.join(path.sep, 'teacher', 'watch-frame.html'))) {
    headers['Content-Security-Policy'] = PAGE_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    headers['X-Frame-Options'] = 'SAMEORIGIN';
  }
  res.writeHead(200, Object.assign({}, SECURITY, headers));
  fs.createReadStream(file).pipe(res);
  return true;
}

// Fixed-window counter. Returns false once a key goes over the limit inside the window.
function limiter(max, windowMs) {
  const m = new Map();
  return (key) => {
    const now = Date.now();
    let e = m.get(key);
    if (!e || now - e.t > windowMs) { e = { t: now, n: 0 }; m.set(key, e); }
    e.n++;
    if (m.size > 20000) for (const [k, v] of m) if (now - v.t > windowMs) m.delete(k);
    return e.n <= max;
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  addressKey,
  HttpError, clientIp, trustedIp, sameNetwork, isHttps, siteOrigin, cookies, setCookie, send, json, readBody, readJson, router, serveStatic, limiter,
  sha256, newToken, sleep, SECURITY, PAGE_CSP,
};
