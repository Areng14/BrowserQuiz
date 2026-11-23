'use strict';
// Safe Exam Browser (SEB) settings that BrowserQuiz makes for a quiz, as a .seb file, plus the Config
// Key SEB works out from them. SEB sends X-SafeExamBrowser-ConfigKeyHash (SHA-256 of the request URL
// followed by the Config Key) on every request, which is how the server knows it's SEB running these
// settings (student.js requireSeb). SEB's newer engine (SEB for iPad, newer Macs) can't add headers: it
// gives the page the same hash for the page's own address instead, and the page sends that along.
const crypto = require('crypto');

// The settings for one quiz. SEB starts on the join page with the code filled in, and quits when the
// student opens quitURL from the "turned in" screen. Everything else is SEB's default: full screen,
// no other apps, no address bar, one display, no screenshots.
// A quit password is what makes SEB lock the device: without one, SEB on an iPad opens the quiz without
// Assessment Mode. The teacher sees it on the live run page.
// mute: SEB mutes the computer's sound when it starts (music or a video left playing in another app),
// unless the teacher turns it off, say for a student who uses a screen reader.
function settingsFor(origin, code, quitPassword, { mute = true } = {}) {
  return {
    allowPreferencesWindow: false, // students can't open SEB's settings
    ...(mute ? { audioMute: true } : {}),
    allowQuit: true, // a stuck student can still get out, with the teacher's quit password (logged as leaving the quiz)
    browserWindowWebView: 3, // macOS: the modern WebKit, which the code editor needs
    ...(quitPassword ? { hashedQuitPassword: crypto.createHash('sha256').update(quitPassword).digest('hex') } : {}),
    quitURL: `${origin}/seb-quit.html`,
    sendBrowserExamKey: true, // sends the Config Key hash header
    startURL: `${origin}/?code=${code}`,
  };
}

// The .seb file: an unencrypted XML property list, which SEB opens as is.
function plist(settings) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const value = (v) => {
    if (typeof v === 'boolean') return v ? '<true/>' : '<false/>';
    if (Number.isInteger(v)) return `<integer>${v}</integer>`;
    if (typeof v === 'string') return `<string>${esc(v)}</string>`;
    throw new Error('unsupported SEB setting value');
  };
  const rows = Object.keys(settings).sort(byKey).map((k) => `\t<key>${esc(k)}</key>\n\t${value(settings[k])}`);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0">\n<dict>\n${rows.join('\n')}\n</dict>\n</plist>\n`;
}

// SEB orders keys case-insensitively, and a lowercase letter before the same uppercase one
// (allowWlan, then allowWLAN).
function byKey(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a === b ? 0 : a > b ? -1 : 1;
}

// "SEB-JSON", the text the Config Key hashes (as SEB and Moodle make it): no whitespace; dictionary
// keys sorted with byKey at every level; empty dictionaries left out; originatorVersion
// left out; data as Base64 and dates as ISO 8601 strings; strings escape quotes and control characters
// but not backslashes, slashes or non-ASCII.
function sebJson(v) {
  if (v === true || v === false) return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return quote(v);
  if (Buffer.isBuffer(v)) return quote(v.toString('base64'));
  if (v instanceof Date) return quote(v.toISOString().replace(/\.\d{3}Z$/, '+00:00'));
  if (Array.isArray(v)) return `[${v.filter((x) => !isEmpty(x)).map(sebJson).join(',')}]`;
  const keys = Object.keys(v).filter((k) => !isEmpty(v[k])).sort(byKey);
  return `{${keys.map((k) => `${quote(k)}:${sebJson(v[k])}`).join(',')}}`;
}
// An empty dictionary, or one holding only empty dictionaries. (Empty arrays stay, as [].)
function isEmpty(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Date) && Object.values(v).every(isEmpty);
}
const ESC = { '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
function quote(s) {
  return `"${s.replace(/["\u0000-\u001f]/g, (c) => ESC[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

function configKey(settings) {
  const s = Object.assign({}, settings);
  delete s.originatorVersion;
  return crypto.createHash('sha256').update(sebJson(s), 'utf8').digest('hex');
}

// A run's SEB file and key. origin: the address students use (scheme and host, no path).
// A quit password the teacher can type on a student's screen: 10 letters and digits, none that look alike.
function newQuitPassword() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join('');
}

function makeConfig(origin, code, quitPassword = newQuitPassword(), opts = {}) {
  const settings = settingsFor(origin, code, quitPassword, opts);
  return { xml: plist(settings), key: configKey(settings), quitPassword };
}

module.exports = { makeConfig, configKey, sebJson, plist, settingsFor, newQuitPassword };
