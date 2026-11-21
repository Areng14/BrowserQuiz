'use strict';
// Methods and names a code question doesn't allow: "ban": ["Arrays.sort", "stream", "sorted"], or
// { "java": [...], "python": [...] }. Code that uses one scores 0 on the question.
//
// Each entry is one of:
//   Class.method   that method of that class: "Arrays.sort", "Math.max", "math.sqrt"
//   method         a method or function of that name, on anything: "sort", "stream", "sorted", "max"
//   Name           (Java, capitalized) a class or interface, anywhere: "HashMap", "Stream"
//
// The check runs on the code with comments and the inside of strings taken out (rubric.stripCode), and
// is hard to get around: it catches full names (java.util.Arrays.sort), spacing and line breaks, static
// imports and method references in Java, and aliases and imports in Python. A question with any ban
// also bans the usual ways around one: reflection in Java; eval, exec, getattr, __import__, importlib
// and friends in Python.

const { stripCode } = require('./rubric');

const ENTRY = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ban list from a question, checked and tidied. Throws a message for the quiz file's error.
function normalizeBans(raw, languages) {
  if (raw == null) return null;
  const clean = (list, label) => {
    if (!Array.isArray(list)) throw new Error(`${label} should be a list of names, like ["Arrays.sort", "stream"].`);
    const out = [];
    for (const v of list.slice(0, 30)) {
      const name = String(v == null ? '' : v).trim();
      if (!name) continue;
      if (!ENTRY.test(name)) throw new Error(`${label}: "${name.slice(0, 60)}" isn't a name. Use a method ("sort"), Class.method ("Arrays.sort") or a class ("HashMap").`);
      if (!out.includes(name)) out.push(name);
    }
    return out;
  };
  if (Array.isArray(raw)) { const list = clean(raw, '"ban"'); return list.length ? list : null; }
  if (typeof raw === 'object') {
    const out = {};
    for (const lang of languages) if (raw[lang] != null) { const list = clean(raw[lang], `"ban".${lang}`); if (list.length) out[lang] = list; }
    return Object.keys(out).length ? out : null;
  }
  throw new Error('"ban" should be a list of names, like ["Arrays.sort", "stream"].');
}

// The entries that apply to one language.
function bansFor(ban, lang) {
  if (!ban) return [];
  return Array.isArray(ban) ? ban : ban[lang] || [];
}

// How each kind of entry shows up in code, per language.
function javaRules(entry, code) {
  const [a, b] = entry.split('.');
  if (b) {
    return [
      new RegExp(`\\b${esc(a)}\\s*\\.\\s*${esc(b)}\\b`), // Arrays.sort(...), java.util.Arrays.sort, a reference
      new RegExp(`\\b${esc(a)}\\s*::\\s*${esc(b)}\\b`), // Arrays::sort
      new RegExp(`\\bimport\\s+static\\s+[\\w.\\s]*\\b${esc(a)}\\s*\\.\\s*(${esc(b)}|\\*)\\s*;`), // import static ...Arrays.sort; or Arrays.*;
    ];
  }
  if (/^[A-Z]/.test(a)) return [new RegExp(`\\b${esc(a)}\\b`)]; // a class: any use
  const rules = [
    new RegExp(`\\.\\s*${esc(a)}\\s*\\(`), // x.sort(...)
    new RegExp(`::\\s*${esc(a)}\\b`), // List::sort
    new RegExp(`\\bimport\\s+static\\s+[\\w.\\s]*\\.\\s*${esc(a)}\\s*;`), // import static java.util.Arrays.sort;
  ];
  // After "import static Something.*;" a bare call could be the library's.
  if (/\bimport\s+static\s+[\w.\s]*\.\s*\*\s*;/.test(code)) rules.push(new RegExp(`(^|[^\\w.])${esc(a)}\\s*\\(`));
  return rules;
}

function pythonRules(entry, code) {
  const [a, b] = entry.split('.');
  if (b) {
    return [
      new RegExp(`\\b${esc(a)}\\s*\\.\\s*${esc(b)}\\b`), // math.sqrt, a reference too
      new RegExp(`\\bfrom\\s+[\\w.]*\\b${esc(a)}\\s+import\\s+[^\\n]*(\\b${esc(b)}\\b|\\*)`), // from math import sqrt / *
    ];
  }
  // Their own function of that name is theirs to call.
  const own = new RegExp(`\\bdef\\s+${esc(a)}\\s*\\(`).test(code);
  const rules = [
    new RegExp(`\\.\\s*${esc(a)}\\b`), // nums.sort(), a reference like nums.sort
    new RegExp(`\\bimport\\s+[^\\n]*\\b${esc(a)}\\b`), // import itertools, from x import sorted as s
    new RegExp(`\\bfrom\\s+${esc(a)}\\b`), // from collections import ...
  ];
  if (!own) {
    rules.push(new RegExp(`(^|[^\\w.])${esc(a)}\\s*\\(`)); // sorted(...)
    rules.push(new RegExp(`(^|[=(,\\[{:]|\\breturn|\\blambda[^:\\n]*:)\\s*${esc(a)}\\s*($|[)\\]},;\\n])`, 'm')); // s = sorted, key=max, [min, max]
  }
  return rules;
}

// The ways around any ban, when a question has one.
const JAVA_ESCAPES = [
  ['reflection', /\b(java\s*\.\s*lang\s*\.\s*reflect|MethodHandles?|forName|getDeclaredMethods?|getMethods?|getDeclaredConstructors?|getConstructors?|invoke|invokeExact)\b/],
  ['scripting', /\b(ScriptEngine|ScriptEngineManager)\b/],
];
const PYTHON_ESCAPES = [
  ['eval', /(^|[^\w.])eval\s*\(/],
  ['exec', /(^|[^\w.])exec\s*\(/],
  ['getattr', /\b(getattr|setattr|hasattr)\b/],
  ['__import__', /\b__import__\b/],
  ['importlib', /\bimportlib\b/],
  ['builtins', /\b(__builtins__|builtins)\b/],
  ['globals', /\b(globals|locals|vars)\s*\(/],
  ['compile', /(^|[^\w.])compile\s*\(/],
  ['methodcaller', /\b(methodcaller|attrgetter)\b/],
  ['__dict__', /\b__dict__\b/],
];

// The banned names this code uses (or the way around a ban it uses), in the question's order.
function bannedUse(ban, lang, code) {
  const entries = bansFor(ban, lang);
  if (!entries.length) return [];
  const py = lang === 'python';
  const src = stripCode(code, lang);
  const hits = [];
  for (const entry of entries) {
    const rules = py ? pythonRules(entry, src) : javaRules(entry, src);
    if (rules.some((re) => re.test(src))) hits.push(entry);
  }
  for (const [name, re] of py ? PYTHON_ESCAPES : JAVA_ESCAPES) if (re.test(src)) hits.push(name);
  return hits;
}

module.exports = { normalizeBans, bansFor, bannedUse };
