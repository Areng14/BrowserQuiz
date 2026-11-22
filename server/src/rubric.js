'use strict';
// Rubric items the server can check by itself. A code question's rubric item may have
//   "require": a regex the student's code must match
//   "forbid":  a regex it must not match
// each either one pattern for every language or { "java": "...", "python": "..." }. Comments and
// string literals are taken out first, so a comment saying "private" doesn't count. Items with no
// pattern for the student's language are left to the teacher.

const vm = require('node:vm');

const MAX_PATTERN = 500;
const TIMEOUT_MS = 100;

// Code with comments and the inside of string literals removed. Line breaks stay where they were.
function stripCode(code, lang) {
  const s = String(code || '');
  const py = lang === 'python';
  const js = lang === 'javascript' || lang === 'typescript';
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (py ? c === '#' : c === '/' && d === '/') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (!py && c === '/' && d === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += ' ' + s.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || (js && c === '`')) {
      // Python: '''...''' and """...""". Java: """ text blocks. JavaScript: `template strings` (several lines).
      const triple = (py || (c === '"' && lang === 'java')) && s.startsWith(c + c + c, i);
      const q = triple ? c + c + c : c;
      const multi = triple || c === '`';
      let j = i + q.length;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s.startsWith(q, j)) { j += q.length; break; }
        if (!multi && s[j] === '\n') break;
        j++;
      }
      out += c + c + s.slice(i, Math.min(j, n)).replace(/[^\n]/g, '');
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const ctx = vm.createContext({});
const script = new vm.Script('re.test(s)');
// A pattern that backtracks forever is stopped instead of freezing the server.
function test(pattern, text) {
  ctx.re = new RegExp(pattern, 'm');
  ctx.s = text;
  try {
    return script.runInContext(ctx, { timeout: TIMEOUT_MS }) === true;
  } finally {
    ctx.re = null;
    ctx.s = null;
  }
}

// A teacher's pattern against one short answer, with flags ('i' for any case). null if it ran too long.
const flagged = new vm.Script('new RegExp(p, f).test(s)');
function matches(pattern, text, flags) {
  ctx.p = pattern; ctx.f = flags || ''; ctx.s = text;
  try {
    return flagged.runInContext(ctx, { timeout: TIMEOUT_MS }) === true;
  } catch (e) {
    return null;
  } finally {
    ctx.p = null; ctx.f = null; ctx.s = null;
  }
}

// The patterns for one language, or null when the teacher grades this item.
function ruleFor(item, lang) {
  const pick = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof x[lang] === 'string' ? x[lang] : '') || null;
  const require = pick(item.require);
  const forbid = pick(item.forbid);
  return require || forbid ? { require, forbid } : null;
}

// true or false, or null if a pattern ran too long. `why` says which part failed.
function check(rule, stripped) {
  try {
    if (rule.require && !test(rule.require, stripped)) return { ok: false, why: 'require' };
    if (rule.forbid && test(rule.forbid, stripped)) return { ok: false, why: 'forbid' };
    return { ok: true };
  } catch (e) {
    return { ok: null, why: 'timeout' };
  }
}

// { itemId: true|false } for the items checked automatically. Rubric points need code that works at
// least a little: it compiles and passes a hidden test (`works`). Otherwise a student could earn
// "doesn't use Arrays.sort" with an empty class.
function autoRubric(q, lang, code, works) {
  const out = {};
  let stripped = null;
  for (const item of q.rubric || []) {
    const rule = ruleFor(item, lang);
    if (!rule) continue;
    if (!works) { out[item.id] = false; continue; }
    if (stripped == null) stripped = stripCode(code, lang);
    const r = check(rule, stripped);
    if (r.ok != null) out[item.id] = r.ok; // too slow: the teacher grades it
  }
  return out;
}

// Quiz upload: a pattern or { lang: pattern }, every pattern a valid regex. Throws a message.
function normalizePattern(v, languages, key) {
  if (v == null || v === '') return undefined;
  const one = (p, label) => {
    if (typeof p !== 'string') throw new Error(`"${label}" must be a regex in a string.`);
    if (p.length > MAX_PATTERN) throw new Error(`"${label}" is longer than ${MAX_PATTERN} characters.`);
    try { new RegExp(p, 'm'); } catch (e) { throw new Error(`"${label}" isn't a valid regex: ${e.message}`); }
    return p;
  };
  if (typeof v === 'string') return one(v, key);
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`"${key}" must be a regex or { "java": ..., "python": ... }.`);
  const out = {};
  for (const [lang, p] of Object.entries(v)) {
    if (!languages.includes(lang)) throw new Error(`"${key}" has "${lang}", which this question doesn't use.`);
    if (p === '' || p == null) continue;
    out[lang] = one(p, `${key}.${lang}`);
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = { stripCode, ruleFor, check, autoRubric, normalizePattern, matches };
