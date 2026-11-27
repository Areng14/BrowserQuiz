'use strict';
// Do a question's tests catch wrong answers? The quiz maker's second check, once every test passes: small
// changes to the solution (< for <=, 1 for 0, || for &&), each run against the tests. A change the tests
// don't catch is only reported with an input that shows it, one where the changed code and the solution
// disagree, so a change that does the same thing (> for >= where they can't be equal) is never reported.
// On a fill question only the blanks change: the rest of the code isn't the student's.

const H = require('./harness');
const T = require('../../public/teacher/types.js');

// The language to change, of those with a solution: the quickest to build and run first.
const QUICK = ['python', 'javascript', 'typescript', 'java', 'go', 'c', 'cpp', 'csharp', 'rust'];
// (fewer where each one is a compile: a search should cost a few seconds of the runner, not a minute)
const HOW_MANY = { python: 12, javascript: 12, typescript: 8, java: 8, go: 6, c: 6, cpp: 5, csharp: 5, rust: 4 };
const MAX_PROBES = 80;

// ---------- where the code can change ----------
// The code with strings and comments blanked out (same length, lines kept), so changes only land on code
function mask(code, lang) {
  const out = code.split('');
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n') out[i] = ' '; };
  const py = lang === 'python';
  const toEol = (i) => { const e = code.indexOf('\n', i); return e < 0 ? code.length : e; };
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if ((py && c === '#') || (!py && c === '/' && n === '/')) { const e = toEol(i); blank(i, e); i = e; continue; }
    if (!py && c === '/' && n === '*') { const e = code.indexOf('*/', i + 2); const end = e < 0 ? code.length : e + 2; blank(i, end); i = end; continue; }
    if (py && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const e = code.indexOf(code.slice(i, i + 3), i + 3);
      const end = e < 0 ? code.length : e + 3;
      blank(i, end); i = end; continue;
    }
    // (a Rust ' is a char only when it closes right away: 'a is a lifetime)
    const quote = c === '"' || c === '`' || (c === "'" && (lang !== 'rust' || /^'(?:\\.|[^'\\])'/.test(code.slice(i, i + 4))));
    if (quote) {
      let j = i + 1;
      while (j < code.length && code[j] !== c && (c === '`' || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1;
      const end = Math.min(code.length, j + 1);
      blank(i, end); i = end; continue;
    }
    i++;
  }
  return out.join('');
}

const SWAP = {
  '<': '<=', '<=': '<', '>': '>=', '>=': '>', '==': '!=', '!=': '==', '===': '!==', '!==': '===',
  '&&': '||', '||': '&&', '+=': '-=', '-=': '+=', '++': '--', '--': '++', '+': '-', '-': '+',
};
const KIND = { '<': 'compare', '<=': 'compare', '>': 'compare', '>=': 'compare', '==': 'compare', '!=': 'compare', '===': 'compare', '!==': 'compare', '&&': 'logic', '||': 'logic', '+=': 'math', '-=': 'math', '+': 'math', '-': 'math', '++': 'step', '--': 'step' };
const COMPARE = ['<', '<=', '>', '>=', '==', '!='];
const ORDER = ['compare', 'logic', 'number', 'math', 'step', 'bool', 'not'];
const OPS = /===|!==|>>>=?|<<=|>>=|<<|>>|->|=>|::|\+\+|--|\+=|-=|<=|>=|==|!=|&&|\|\||<|>|\+|-/g;
const SKIP_LINE = /^\s*(?:import\b|#|package\b|using\b|use\b|from\s+\S+\s+import\b)/;

// Every small change that could be made: { at, from, to, kind }. within: [start, end] ranges it has to be in.
function sites(code, lang, within) {
  const m = mask(code, lang);
  const out = [];
  const lineOf = (at) => code.slice(code.lastIndexOf('\n', at - 1) + 1, code.indexOf('\n', at) < 0 ? code.length : code.indexOf('\n', at));
  const prevChar = (s, at) => { let k = at - 1; while (k >= 0 && /[ \t]/.test(s[k])) k--; return s[k] || ''; };
  const nextChar = (s, at) => { let k = at; while (k < s.length && /[ \t]/.test(s[k])) k++; return s[k] || ''; };
  const add = (at, from, to, kind) => {
    if (within && !within.some(([a, b]) => at >= a && at + from.length <= b)) return;
    if (SKIP_LINE.test(lineOf(at))) return;
    out.push({ at, from, to, kind });
  };
  for (const x of m.matchAll(OPS)) {
    const op = x[0];
    const at = x.index;
    if (!(op in SWAP)) continue;
    const before = m[at - 1] || ' ';
    const after = m[at + op.length] || ' ';
    // A lone < or > with space on both sides: i < n, but not List<Integer>
    if ((op === '<' || op === '>') && !(/\s/.test(before) && /\s/.test(after))) continue;
    // + and - between two values (not -1, not "a" + b, where the other side's a string)
    if (op === '+' || op === '-') {
      if (!/\s/.test(before) || !/\s/.test(after) || !/[\w)\]]/.test(prevChar(m, at))) continue;
      if (/["'`]/.test(prevChar(code, at)) || /["'`]/.test(nextChar(code, at + 1))) continue;
    }
    // In a blank there are only a few places to change, so every other comparison is tried
    const to = within && COMPARE.includes(op) ? COMPARE.filter((x) => x !== op) : [SWAP[op]];
    for (const t of to) add(at, op, t, KIND[op]);
  }
  const words = lang === 'python' ? { and: 'or', or: 'and', True: 'False', False: 'True' } : { true: 'false', false: 'true' };
  for (const x of m.matchAll(/\b(and|or|true|false|True|False)\b/g)) if (words[x[1]]) add(x.index, x[1], words[x[1]], /rue|alse/.test(x[1]) ? 'bool' : 'logic');
  if (lang === 'python') for (const x of m.matchAll(/\bnot\s+/g)) add(x.index, x[0], '', 'not');
  else for (const x of m.matchAll(/!(?=[\w(])/g)) if (!/[\w!]/.test(m[x.index - 1] || '')) add(x.index, '!', '', 'not');
  for (const x of m.matchAll(/(?<![\w.$])\d+(?![\w.])/g)) {
    const n = Number(x[0]);
    if (!Number.isSafeInteger(n)) continue;
    add(x.index, x[0], String(n + 1), 'number');
    if (n > 0) add(x.index, x[0], String(n - 1), 'number');
  }
  return out.sort((a, b) => a.at - b.at);
}
// A few changes, spread over the kinds (the likeliest mistakes first) and through the code
function pick(all, n) {
  const by = ORDER.map((k) => all.filter((s) => s.kind === k));
  const out = [];
  for (let r = 0; out.length < n && by.some((l) => l.length > r); r++) for (const l of by) if (l[r] && out.length < n) out.push(l[r]);
  return out;
}
const change = (code, s) => code.slice(0, s.at) + s.to + code.slice(s.at + s.from.length);

// A fill question's blanks in its code with the answers put in: [start, end] each
function blankRanges(q) {
  const ranges = [];
  let pos = 0;
  let last = 0;
  let k = 0;
  for (const x of q.code.matchAll(/_{3,}/g)) {
    pos += x.index - last;
    const a = String((q.answer[k] || [''])[0]);
    ranges.push([pos, pos + a.length]);
    pos += a.length;
    last = x.index + x[0].length;
    k++;
  }
  return ranges;
}

// ---------- inputs to try ----------
const SMALL = {
  int: [0, 1, -1, 2, 3, -4, 10, 7], long: [0, 1, -1, 2, 3, -4, 10, 7], double: [0, 1.5, -2.5, 0.5, 10],
  boolean: [false, true], string: ['', 'a', 'A', 'ab', 'ba', 'aba', 'Hello World', 'aaa', 'xyz'], char: ['a', 'Z', '0', ' ', 'e'],
};
const LISTS = {
  int: [[], [0], [5], [-3, -1], [2, 2], [1, 2, 3], [3, 1, 2], [-2, 7, -9, 4], [4, 4, 1, 1], [1, 2, 3, 4, 5, 6]],
  double: [[], [0.5], [-1.5, -0.5], [2.5, 2.5], [1, 2, 3], [3.5, -1, 2]],
  string: [[], ['a'], ['b', 'a'], ['', 'x'], ['hi', 'hi'], ['apple', 'Banana', 'cherry']],
  boolean: [[], [true], [false, false], [true, false, true]],
  char: [[], ['a'], ['b', 'a'], ['x', 'x'], ['a', 'b', 'c']],
};
LISTS.long = LISTS.int;
function candidates(t, D) {
  t = T.canon(t);
  if (SMALL[t]) return SMALL[t];
  const kv = T.mapTypes(t);
  if (kv) {
    const keys = kv[0] === 'int' ? ['1', '2', '-3'] : ['a', 'b', 'c'];
    const vs = candidates(kv[1], D).filter((v) => v !== '' && !(Array.isArray(v) && !v.length));
    if (vs.length < 3) return [{}];
    return [{}, { [keys[0]]: vs[1] }, { [keys[0]]: vs[1], [keys[1]]: vs[2] }, { [keys[0]]: vs[2], [keys[1]]: vs[2], [keys[2]]: vs[1] }];
  }
  const e = T.elementType(t);
  if (!e) return []; // an object of one of the question's classes: only what the tests give
  if (LISTS[T.canon(e)]) return LISTS[T.canon(e)];
  const inner = candidates(e, D).filter((v) => Array.isArray(v) && v.length);
  return [[], ...inner.slice(0, 4).map((v) => [v]), ...(inner.length > 3 ? [[inner[1], inner[2]], [inner[3], inner[3]]] : [])];
}
// The tests' own values, a little different
function variants(t, v, D) {
  t = T.canon(t);
  if (typeof v === 'number') return [-v, v + 1, v - 1];
  if (typeof v === 'boolean') return [!v];
  if (typeof v === 'string' && t !== 'char') return [v.toUpperCase(), v.toLowerCase(), [...v].reverse().join(''), v + v, v.slice(1), v.slice(0, -1), ` ${v} `];
  if (Array.isArray(v) && v.length) {
    const num = v.every((x) => typeof x === 'number');
    const sorted = num ? v.slice().sort((a, b) => a - b) : null;
    return [v.slice().reverse(), sorted, sorted && sorted.slice().reverse(), v.slice(0, -1), v.slice(1), [...v, v[v.length - 1]], num ? v.map((x) => -x) : null, [v[0]]].filter(Boolean);
  }
  if (v && typeof v === 'object' && T.mapTypes(t)) { const ks = Object.keys(v); return ks.length ? [{}, Object.fromEntries(ks.slice(1).map((k) => [k, v[k]]))] : []; }
  return [];
}
const plain = (v) => !(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.range)); // not a { range } of values
function methodProbes(q, tests) {
  const ps = q.signature.params;
  const D = q.types;
  const seen = new Set(tests.map((t) => JSON.stringify(t.args)));
  const out = [];
  const push = (args) => {
    const key = JSON.stringify(args);
    if (out.length >= MAX_PROBES || seen.has(key) || !args.every((a, j) => T.checkValue(ps[j].type, a, D))) return;
    seen.add(key);
    out.push({ args, weight: 1 });
  };
  const cands = ps.map((p) => candidates(p.type, D));
  const bases = tests.filter((t) => !t.speed && t.args.every(plain)).map((t) => t.args).slice(0, 6);
  if (!bases.length) { if (cands.some((c) => !c.length)) return []; bases.push(cands.map((c) => c[Math.min(1, c.length - 1)])); }
  // one argument at a time, the small values first
  const most = Math.max(0, ...cands.map((c) => c.length));
  for (let k = 0; k < most; k++) for (const base of bases.slice(0, 3)) ps.forEach((p, j) => { if (cands[j][k] !== undefined) push(Object.assign(base.slice(), { [j]: cands[j][k] })); });
  for (const base of bases) ps.forEach((p, j) => { for (const v of variants(p.type, base[j], D)) push(Object.assign(base.slice(), { [j]: v })); });
  // all of them at once, for arguments that go together
  if (cands.every((c) => c.length)) for (let k = 0; k < most; k++) push(cands.map((c) => c[k % c.length]));
  return out;
}
// A class: the tests' steps with every value checked, then the getters called at the end, then each
// step's arguments changed
function classProbes(q, tests) {
  const C = q.class;
  const D = q.types;
  const methodOf = (st) => (st.m != null ? C.methods[st.m] : C.methods.find((x) => x.name === st.call));
  const checked = (st) => {
    if (st.new) return { new: st.new, as: st.as };
    const m = methodOf(st);
    const s = { call: st.call, args: st.args, on: st.on };
    if (st.m != null) s.m = st.m;
    if (m && m.returns !== 'void') s.check = true;
    return s;
  };
  const getters = C.methods.map((m, k) => [m, k]).filter(([m]) => !m.params.length && m.returns !== 'void');
  const seen = new Set();
  const out = [];
  const push = (steps) => {
    const key = JSON.stringify(steps);
    if (out.length >= MAX_PROBES || seen.has(key)) return;
    seen.add(key);
    out.push({ steps, weight: 1 });
  };
  const ending = (steps) => {
    const on = [...steps].reverse().find((s) => s.new);
    return on ? getters.map(([m, k]) => Object.assign({ call: m.name, args: [], on: on.as, check: true }, C.methods.filter((x) => x.name === m.name).length > 1 ? { m: k } : {})) : [];
  };
  const bases = tests.filter((t) => t.steps.every((s) => (s.new || s.args || []).every(plain))).slice(0, 6).map((t) => t.steps.map(checked));
  for (const steps of bases) { push(steps); push([...steps, ...ending(steps)]); }
  for (let k = 0; k < 8; k++) {
    for (const steps of bases) {
      steps.forEach((st, s) => {
        const params = st.new ? C.constructor : (methodOf(st) || {}).params || [];
        params.forEach((p, j) => {
          const c = candidates(p.type, D)[k];
          if (c === undefined || !T.checkValue(p.type, c, D)) return;
          const args = Object.assign((st.new || st.args).slice(), { [j]: c });
          const next = steps.map((x, i) => (i !== s ? x : st.new ? Object.assign({}, x, { new: args }) : Object.assign({}, x, { args })));
          push([...next, ...ending(next)]);
        });
      });
    }
  }
  return out;
}

// ---------- running ----------
const passedAll = (r) => r && r.status === 'ok' && r.tests.every((t) => t.pass === true);
// The tests with the solution's values where none were typed
function settle(q, tests, ref) {
  return tests.map((t, i) => {
    const res = ref.tests[i];
    if (q.mode === 'method') return t.expected !== undefined ? t : Object.assign({}, t, { expected: H.clean(q.signature.returns, res.got, q.types) });
    return Object.assign({}, t, {
      steps: t.steps.map((st, k) => {
        if (!st.check || st.expect !== undefined) return st;
        const m = (st.m != null && q.class.methods[st.m]) || q.class.methods.find((x) => x.name === st.call);
        const s = Object.assign({}, st, { expect: H.clean(m.returns, res.gotSteps[k], q.types) });
        delete s.check;
        return s;
      }),
    });
  });
}
// The first input the changed code gets wrong, as a test that catches it (quiz.json's form), or null
function catching(q, probes, ref, mine) {
  const D = q.types;
  const unordered = q.compare === 'unordered';
  for (let i = 0; i < probes.length; i++) {
    const want = ref.tests[i];
    const got = mine.tests[i];
    if (!want || want.error || !got) continue;
    if (q.mode === 'method') {
      if (!got.error && H.same(q.signature.returns, H.clean(q.signature.returns, want.got, D), got.got, unordered, D)) continue;
      return { args: probes[i].args, expected: H.clean(q.signature.returns, want.got, D) };
    }
    const steps = probes[i].steps;
    const at = steps.findIndex((st, k) => {
      if (!(k in want.gotSteps)) return false;
      const m = (st.m != null && q.class.methods[st.m]) || q.class.methods.find((x) => x.name === st.call);
      return got.error || !(k in got.gotSteps) || !H.same(m.returns, H.clean(m.returns, want.gotSteps[k], D), got.gotSteps[k], unordered, D);
    });
    if (at < 0) continue;
    const m = (steps[at].m != null && q.class.methods[steps[at].m]) || q.class.methods.find((x) => x.name === steps[at].call);
    return {
      steps: steps.slice(0, at + 1).map((st, k) => {
        if (st.new) return { new: st.new, as: st.as };
        const s = { call: st.call, args: st.args, on: st.on };
        if (k === at) s.expect = H.clean(m.returns, want.gotSteps[k], D);
        return s;
      }),
    };
  }
  return null;
}
// Where the change is, as the teacher sees it: the changed line (or blank), and which part of it changed
function where(code, s, blanks) {
  const changed = change(code, s);
  if (blanks) {
    const k = blanks.findIndex(([a, b]) => s.at >= a && s.at + s.from.length <= b);
    const [a, b] = blanks[k];
    return { blank: k + 1, text: changed.slice(a, b + s.to.length - s.from.length), mark: [s.at - a, s.at - a + s.to.length] };
  }
  const start = code.lastIndexOf('\n', s.at - 1) + 1;
  const end = changed.indexOf('\n', start);
  const line = changed.slice(start, end < 0 ? changed.length : end);
  const lead = line.length - line.trimStart().length;
  return { line: code.slice(0, s.at).split('\n').length, text: line.trim(), mark: [s.at - start - lead, s.at - start - lead + s.to.length] };
}

// -> up to 3 { lang, line | blank, text, mark, test }, each a change the tests miss and a test that catches it.
// runJob(q, lang, code, tests, timeMs, stale) as coderun.js's; stale(): the teacher has moved on.
async function findGaps(q, runJob, stale) {
  const lang = QUICK.find((l) => ((q.reference || {})[l] || '').trim());
  if (!lang) return [];
  const code = q.reference[lang];
  const run = Object.assign({}, q, { ban: null }); // what's banned is the other check's
  const tests = q.tests.hidden; // the maker sends every test as hidden
  const blanks = q.type === 'fill' ? blankRanges(q) : null;
  const changes = pick(sites(code, lang, blanks), HOW_MANY[lang] || 8);
  if (!changes.length) return [];
  const probes = q.mode === 'method' ? methodProbes(q, tests) : classProbes(q, tests);
  const time = (n) => Math.min(6000, Math.max(2000, q.limits.timeMs * n));
  const safe = (p) => p.catch(() => null);
  const job = (code2, list, ms) => safe(runJob(run, lang, code2, list, ms, stale));
  const [ref, refProbes] = await Promise.all([job(code, tests, time(tests.length)), probes.length ? job(code, probes, 6000) : null]);
  if (!ref || ref.status !== 'ok' || ref.tests.some((t) => t.error || t.pass === false) || !refProbes || refProbes.status !== 'ok') return [];
  const settled = settle(q, tests, ref);
  const runs = await Promise.all(changes.map((s) => job(change(code, s), settled, time(settled.length))));
  const missed = changes.filter((s, i) => passedAll(runs[i])).slice(0, 4);
  const tried = await Promise.all(missed.map((s) => job(change(code, s), probes, 6000)));
  const gaps = [];
  const found = new Set();
  missed.forEach((s, i) => {
    const mine = tried[i];
    if (!mine || mine.status !== 'ok') return;
    const test = catching(q, probes, refProbes, mine);
    if (!test || found.has(JSON.stringify(test))) return;
    found.add(JSON.stringify(test));
    gaps.push(Object.assign({ lang }, where(code, s, blanks), { test }));
  });
  return gaps.slice(0, 3);
}

module.exports = { findGaps, sites, mask, methodProbes, classProbes, blankRanges };
