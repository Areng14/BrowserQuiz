'use strict';
// Reading the sandbox's output back: each test's result compared with what it expects, and compiler and
// runtime errors cleaned up so they point at the student's own lines.

const T = require('../../../public/teacher/types.js');
const { elementType } = require('../quizfile');
const B = require('../bans');
const { isC, isJs, stepMethod } = require('./literals');
const { callText, expectedText, showGot } = require('./show');

// ---------- reading results ----------
function splitOutput(stdout, marker) {
  const records = [];
  const other = [];
  for (const line of String(stdout || '').split('\n')) {
    const k = line.indexOf(marker);
    if (k < 0) { other.push(line); continue; }
    if (k > 0) other.push(line.slice(0, k));
    try { records.push(JSON.parse(line.slice(k + marker.length))); } catch (e) { /* garbled line: ignore */ }
  }
  return { records, printed: other.join('\n').replace(/\s+$/, '') };
}

// A value that came back from code, cut down to what the question's types say: a declared class's
// own fields only (a subclass's extras go). For filling in expected values from a reference solution.
function clean(type, v, D, depth = 0) {
  if (v === null || v === undefined || typeof v !== 'object' || depth > T.MAX_DEPTH + 5) return v === undefined ? null : v;
  if (T.isClass(type, D)) return Object.fromEntries(D[type].map((f) => [f.name, clean(f.type, v[f.name], D, depth + 1)]));
  const kv = T.mapTypes(type);
  if (kv) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(kv[1], x, D, depth)]));
  return Array.isArray(v) ? v.map((x) => clean(elementType(type), x, D, depth)) : v;
}

// JSON with object keys sorted, so the same object always gives the same text (for sorting unordered lists).
const stableJson = (x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stableJson(x[k])).join(',') + '}'
  : Array.isArray(x) ? '[' + x.map(stableJson).join(',') + ']' : JSON.stringify(x));
function same(type, exp, got, unordered, D, depth) {
  if (exp === null || got === null || got === undefined) return exp === got;
  if (T.isClass(type, D)) { // field by field; extra fields on what came back don't matter
    if (!got || typeof got !== 'object' || Array.isArray(got) || (depth || 0) > T.MAX_DEPTH + 5) return false;
    return D[type].every((f) => same(f.type, exp[f.name] === undefined ? null : exp[f.name], got[f.name] === undefined ? null : got[f.name], false, D, (depth || 0) + 1));
  }
  switch (type) {
    case 'double': return typeof got === 'number' && Math.abs(exp - got) <= 1e-6 * Math.max(1, Math.abs(exp));
    case 'int': case 'long': case 'boolean': case 'string': case 'char': return got === exp;
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) { // same keys (int keys compared as numbers), same value for each
    if (!got || typeof got !== 'object' || Array.isArray(got)) return false;
    const norm = (o) => new Map(Object.entries(o).map(([k, x]) => [kv[0] === 'int' ? String(Number(k)) : k, x]));
    const a = norm(exp);
    const b = norm(got);
    return a.size === b.size && [...a].every(([k, x]) => b.has(k) && same(kv[1], x, b.get(k), false, D, depth));
  }
  if (!Array.isArray(got) || got.length !== exp.length) return false;
  const e = elementType(type);
  let a = exp;
  let b = got;
  if (unordered) {
    const key = (x) => stableJson(x);
    a = [...exp].sort((x, y) => (key(x) < key(y) ? -1 : 1));
    b = [...got].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  }
  return a.every((x, i) => same(e, x, b[i], false, D, depth));
}

// Errors inside the generated test file (BQMain.java) mean the student's code doesn't have what the question
// asks for. Say that in plain words instead of showing our harness code; errors in their own file stay as-is.
function explainHarnessErrors(text) {
  const blocks = text.split(/(?=^BQMain\.java:\d+: error: )/m).filter((b) => b.startsWith('BQMain.java'));
  const notes = blocks.map((b) => {
    const msg = (b.match(/error: (.*)/) || [])[1] || '';
    const sym = (b.match(/symbol:\s+(method|class|variable)\s+(.*)/) || []);
    if (/cannot find symbol/.test(msg) && sym[1] === 'method') return `Missing method ${sym[2].trim()}`;
    if (/cannot find symbol/.test(msg) && sym[1] === 'class') return `Missing class ${sym[2].trim()}`;
    const ctor = msg.match(/constructor (\w+) in class \w+ cannot be applied/);
    if (ctor) return `${ctor[1]} needs a constructor that takes (${((b.match(/found:\s+(.*)/) || [])[1] || '').trim()})`;
    const conv = msg.match(/incompatible types: (.*) cannot be converted to (.*)/);
    if (conv) return `A method returns ${conv[1]} but should return ${conv[2]}`;
    if (/is not public in/.test(msg)) return msg.replace(/ in .*/, '') + ' (make it public)';
    return msg;
  });
  return [...new Set(notes.filter(Boolean))].join('\n');
}
function cleanJava(s) {
  const text = String(s || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/\r/g, '').trim();
  if (!/^BQMain\.java:/m.test(text)) return text.slice(0, 4000);
  const own = text.split(/(?=^\w+\.java:\d+: error: )/m).filter((b) => /^\w+\.java/.test(b) && !b.startsWith('BQMain.java')).join('').trim();
  return [own, explainHarnessErrors(text)].filter(Boolean).join('\n').slice(0, 4000);
}
const cleanPy = (s) => String(s || '').replace(/File "\/jobs\/[^"]+\/(\w+\.py)"/g, 'File "$1"').trim().slice(0, 4000);
const cleanJs = (s) => String(s || '').replace(/(?:file:\/\/)?\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/\bsolution\.cjs\b/g, 'solution.js').replace(/\bsolution\.cts\b/g, 'solution.ts').trim().slice(0, 4000);

// gcc's errors, cut to the ones in the student's file. Errors in the generated test file mean their code
// doesn't have what the question asks for; those are said in plain words, like Java's (explainHarnessErrors).
function cleanCc(text, lang, q) {
  const own = lang === 'cpp' ? 'solution.cpp' : 'solution.c';
  // (gcc quotes with ‘ ’ in a UTF-8 locale)
  const lines = String(text || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/[\u2018\u2019]/g, "'").replace(/\r/g, '').split('\n');
  const blocks = []; // the student's own diagnostics, each with its source lines and carets
  const known = []; // what the generated file's errors mean
  const other = [];
  let cur = null;
  const plain = (t) => t.replace(/ \{aka [^}]*\}/g, '').replace(/\bstd::(?:__cxx11::)?/g, '');
  const sig = (name) => {
    if (lang === 'c') return `${name} should be: ${T.cSignature(q.signature)}`;
    const ms = q.mode === 'method' ? (q.signature.name === name ? [q.signature] : []) : q.class.methods.filter((m) => m.name === name);
    return ms.length ? ms.map((m) => `${name} should take (${m.params.map(T.cppParam).join(', ')})`).join('\n') : '';
  };
  const classes = new Set(['Solution', q.class && q.class.name, ...Object.keys(q.types || {})].filter(Boolean));
  for (const line of lines) {
    const m = /^([\w.-]+):(\d+)(?::\d+)?: (fatal error|error|warning|note): (.*)$/.exec(line);
    if (m) {
      cur = null;
      if (m[1] === own) {
        cur = [line];
        blocks.push(cur);
        const c = /conflicting types for '(\w+)'/.exec(m[4]);
        if (c && lang === 'c') known.push(sig(c[1]));
        continue;
      }
      if (!/error/.test(m[3])) continue;
      const msg = plain(m[4]);
      let x;
      if ((x = /'(?:class|struct) (\w+)' has no member named '(\w+)'/.exec(msg))) known.push(x[1] === 'Solution' ? `Missing method ${x[2]}` : `${x[1]} has no method ${x[2]}`);
      else if ((x = /'(\w+)' (?:was not declared in this scope|does not name a type|has not been declared)/.exec(msg))) { if (classes.has(x[1])) known.push(`Missing class ${x[1]}`); }
      else if ((x = /no matching function for call to '(\w+)::(\w+)\((.*)\)'/.exec(msg))) {
        known.push(x[1] === x[2] ? `${x[1]} needs a constructor that takes (${x[3].replace(/&/g, '')})` : sig(x[2]) || `${x[2]} doesn't take these arguments`);
      } else if ((x = /(?:conversion from|cannot convert) '(.+?)' to (?:non-scalar type )?'(.+?)'/.exec(msg))) known.push(`A method returns ${x[1]} but should return ${x[2]}`);
      else if (!/too (?:many|few) arguments to function/.test(msg)) other.push(msg);
      continue;
    }
    const u = /undefined reference to [`'](?:Solution::)?(\w+)/.exec(line);
    if (u) { known.push(`Missing ${lang === 'c' ? 'function' : 'method'} ${u[1]}`); cur = null; continue; }
    if (/^In file included from|^\s+from |: In (?:member |static member )?function|: At global scope|: In instantiation|: In constructor|: In lambda|^compilation terminated|^collect2|\bld\b.*:|ld returned/.test(line)) { cur = null; continue; }
    if (cur) cur.push(line);
  }
  const mine = [...new Set(blocks.map((b) => b.join('\n').trimEnd()))];
  // After an error in their own file, the test file's other complaints are usually knock-on ones.
  const said = [...new Set([...known, ...(mine.length ? [] : other)].filter(Boolean))];
  const out = [...mine, ...said].join('\n');
  return (out || lines.join('\n').trim()).slice(0, 4000);
}

// Go's errors: one line each ("solution.go:3:5: ..."), with indented details. Theirs as they are; the test file's
// in plain words.
function cleanGo(text, q) {
  const lines = String(text || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/\r/g, '').split('\n');
  const keep = [];
  const known = [];
  let mine = false;
  const sig = (name) => {
    if (q.mode === 'method') return name === q.signature.name ? `${name} should be: func ${name}(${q.signature.params.map((p) => `${p.name} ${T.goType(p.type)}`).join(', ')}) ${T.goType(q.signature.returns)}` : '';
    const C = q.class;
    if (name === 'New' + C.name) return `${name} should be: func ${name}(${C.constructor.map((p) => `${p.name} ${T.goType(p.type)}`).join(', ')}) *${C.name}`;
    const m = C.methods.find((x) => x.name === name);
    return m ? `${name} should be: func (this *${C.name}) ${name}(${m.params.map((p) => `${p.name} ${T.goType(p.type)}`).join(', ')})${m.returns === 'void' ? '' : ' ' + T.goType(m.returns)}` : '';
  };
  for (const line of lines) {
    const m = /^([\w.-]+):(\d+):(?:\d+:)? (.*)$/.exec(line);
    if (m) {
      mine = m[1] === 'solution.go';
      if (mine) { keep.push(line); if (/main redeclared/.test(m[3])) known.push('Take out func main: the tests call your code themselves'); continue; }
      const msg = m[3];
      let x;
      if ((x = /^undefined: (\w+)/.exec(msg))) known.push(sig(x[1]) ? `Missing ${sig(x[1]).replace(/ should be: /, ': ').replace(/^\w+: /, '')}` : `Missing ${x[1]}`);
      else if ((x = /\.(\w+) undefined \(type \*?(\w+) has no field or method/.exec(msg))) known.push(`${x[2]} has no method ${x[1]}`);
      else if ((x = /in (?:argument to|call to) (?:o_\w+\.)?(\w+)/.exec(msg)) || (x = /arguments in call to (?:o_\w+\.)?(\w+)/.exec(msg))) known.push(sig(x[1]) || msg);
      else if ((x = /cannot use (?:o_\w+\.)?(\w+)\(.*\) \(value of (?:struct |pointer )?type (.+?)\) as (.+?) value/.exec(msg))) known.push(`${x[1]} returns ${x[2]} but should return ${x[3]}`);
      else if (/main redeclared/.test(msg)) known.push('Take out func main: the tests call your code themselves');
      else known.push(msg);
      continue;
    }
    if (/^\t/.test(line) && mine && !/\bbq\w+\.go:/.test(line)) keep.push(line);
  }
  const out = [...new Set(keep)].join('\n').trim();
  return ([out, [...new Set(known.filter(Boolean))].join('\n')].filter(Boolean).join('\n') || lines.join('\n').trim()).slice(0, 4000);
}

// rustc's errors: blocks that start "error[E0308]: ..." and say where with " --> file:line:col".
function cleanRust(text, q) {
  const blocks = String(text || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/\r/g, '').split(/\n(?=(?:error|warning)(?:\[E\d+\])?: )/);
  const mine = [];
  const known = [];
  const sig = (name) => {
    const ms = q.mode === 'method' ? (q.signature.name === name ? [q.signature] : []) : q.class.methods.filter((m) => m.name === name);
    if (q.mode === 'class' && name === 'new') return `${q.class.name} needs: pub fn new(${q.class.constructor.map((p) => `${p.name}: ${T.rustType(p.type)}`).join(', ')}) -> Self`;
    return ms.map((m) => `${name} should be: pub fn ${name}(${q.mode === 'class' ? '&mut self' + (m.params.length ? ', ' : '') : ''}${m.params.map((p) => `${p.name}: ${T.rustType(p.type)}`).join(', ')})${m.returns === 'void' ? '' : ' -> ' + T.rustType(m.returns)}`).join('\n');
  };
  for (const raw of blocks) {
    const b = raw.replace(/\n*(?:error: aborting due to.*|For more information about (?:this|an) error.*|Some errors have detailed explanations.*)$/gm, '').trimEnd();
    if (!/^error/.test(b)) continue;
    const at = / --> ([\w.-]+):(\d+)/.exec(b);
    if (at && at[1] === 'solution.rs') { mine.push(b); continue; }
    const head = (/^error(?:\[E\d+\])?: (.*)/.exec(b) || [])[1] || '';
    const call = /(?:Solution::|o_\w+\.)(\w+)\(/.exec(b);
    let x;
    if ((x = /no (?:function or associated item|method) named `(\w+)` found for struct `(\w+)`/.exec(head))) known.push(x[1] === 'new' ? sig('new') : x[2] === 'Solution' ? `Missing pub fn ${x[1]} in impl Solution` : `${x[2]} has no method ${x[1]}`);
    else if ((x = /(?:undeclared type|cannot find (?:struct, variant or union type|type)) `(\w+)`/.exec(head))) known.push(`Missing struct ${x[1]}`);
    else if (/mismatched types|takes \d+ arguments? but|arguments to this (?:method|function) are incorrect/.test(head) && call) known.push(sig(call[1]) || head);
    else if (!/^aborting/.test(head)) known.push(head);
  }
  return ([...mine, [...new Set(known.filter(Boolean))].join('\n')].filter(Boolean).join('\n\n') || String(text || '').trim()).slice(0, 4000);
}

// csc's errors: "solution.cs(3,9): error CS1002: ; expected", one per line.
function cleanCs(text, q) {
  const lines = String(text || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').replace(/\r/g, '').split('\n');
  const mine = [];
  const known = [];
  const sig = (name) => {
    const ms = q.mode === 'method' ? (q.signature.name === name ? [q.signature] : []) : q.class.methods.filter((m) => m.name === name);
    return ms.map((m) => `${name} should be: public ${T.csType(m.returns)} ${name}(${m.params.map((p) => `${T.csType(p.type)} ${p.name}`).join(', ')})`).join('\n');
  };
  const any = () => (q.mode === 'method' ? sig(q.signature.name) : '');
  for (const line of lines) {
    const m = /^([\w.-]+)\((\d+),\d+\): error (CS\d+): (.*?)(?: \[.*\])?$/.exec(line);
    if (!m) continue;
    if (m[1] === 'solution.cs') { mine.push(line.replace(/ \[[^\]]*\]$/, '')); continue; }
    const msg = m[4].replace(/System\.Collections\.Generic\./g, '');
    let x;
    if ((x = /'(\w+)' does not contain a definition for '(\w+)'/.exec(msg))) known.push(x[1] === 'Solution' ? `Missing method ${x[2]}` : `${x[1]} has no method ${x[2]}`);
    else if ((x = /The type or namespace name '(\w+)' could not be found/.exec(msg))) known.push(`Missing class ${x[1]}`);
    else if ((x = /No overload for method '(\w+)'/.exec(msg))) known.push(sig(x[1]) || msg);
    else if ((x = /'(\w+)' does not contain a constructor that takes/.exec(msg))) known.push(`${x[1]} needs a constructor that takes (${q.class ? q.class.constructor.map((p) => T.csType(p.type)).join(', ') : ''})`);
    else if ((x = /Cannot implicitly convert type '(.+?)' to '(.+?)'/.exec(msg))) known.push(`A method returns ${x[1]} but should return ${x[2]}`);
    else if (/Argument \d+: cannot convert/.test(msg)) known.push(any() || msg);
    else if ((x = /'(.+?)' is inaccessible due to its protection level/.exec(msg))) known.push(`${x[1].replace(/\(.*/, '')} has to be public`);
    else known.push(msg);
  }
  const out = [...new Set(mine), [...new Set(known.filter(Boolean))].join('\n')].filter(Boolean).join('\n');
  return (out || lines.join('\n').trim()).slice(0, 4000);
}

// res = runner response. Returns { status, message?, tests: [{ pass, got?, gotSteps?, error? }], printed }
// at: the number the program gave tests[0] (one run of a job built with more tests: coderun.js, runEach).
function readResults(q, lang, tests, res, marker, at = 0) {
  if (res.status === 'compile_error') {
    const raw = res.stderr || res.stdout;
    const message = isC(lang) ? cleanCc(raw, lang, q) : lang === 'go' ? cleanGo(raw, q) : lang === 'rust' ? cleanRust(raw, q)
      : lang === 'csharp' ? cleanCs(raw, q) : cleanJava(raw);
    return { status: 'compile_error', message };
  }
  if (res.status === 'error') return { status: 'error', message: 'The code runner had a problem. Try again in a moment.' };
  if (res.status === 'unavailable') return { status: 'error', message: `This server's code runner doesn't have ${T.LANG_NAMES[lang] || lang}.` };
  const { records, printed } = splitOutput(res.stdout, marker);
  // The ban check's facts: the runner's, read from the compiled code (null: it couldn't read it), or in Java
  // and Python the harness's, written first, before any student code ran.
  const scan = res.scan !== undefined ? B.runnerFacts(res.scan, { lang, marker, D: q.types })
    : isJs(lang) ? (B.bansFor(q.ban, lang).length ? { hits: records.filter((r) => typeof r.ban === 'string').map((r) => r.ban) } : null)
    : records.length && records[0].scan ? records[0].scan : null;
  const compile = records.find((r) => r.compile);
  if (compile) return { status: 'compile_error', message: isJs(lang) ? cleanJs(compile.err) : cleanPy(compile.err), scan };
  // A Python speed test only counts when the code keeps out of the harness that times it (bans.js).
  const intrudes = tests.some((t) => t.speed) ? B.timingIntrusions(lang, scan) : [];
  // (.NET can't catch a stack overflow: the program stops, and says so on stderr)
  const stopped = res.status === 'timeout' ? 'Ran out of time' : res.status === 'output_limit' ? 'Printed too much output' : res.status === 'disk_limit' ? 'Wrote too much to disk'
    : lang === 'csharp' && /Stack overflow/.test(res.stderr || '') ? 'Stack overflow: recursion too deep' : 'Stopped before finishing';
  const results = tests.map((t, i) => {
    const mine = records.filter((r) => r.i === at + i);
    const final = mine.find((r) => r.s === undefined && r.ok !== undefined);
    if (!final) return { pass: false, error: t.speed && res.status === 'timeout' ? 'Too slow: ran out of time' : stopped };
    if (!final.ok) return { pass: false, error: final.err || 'Crashed' };
    if (t.speed && intrudes.length) return { pass: false, got: final.v, error: `Can't time code that uses ${intrudes.slice(0, 3).join(', ')}` };
    if (q.mode === 'method') {
      const pass = t.expected === undefined ? null : same(q.signature.returns, t.expected, final.v, q.compare === 'unordered', q.types);
      const limit = t.speed && t.maxMs ? t.maxMs[lang] : null;
      if (pass && limit && final.ms > limit) return { pass: false, got: final.v, ms: final.ms, error: `Too slow: ${Math.round(final.ms)} ms (limit ${limit} ms)` };
      return final.ms === undefined ? { pass, got: final.v } : { pass, got: final.v, ms: final.ms };
    }
    let pass = true;
    const gotSteps = {};
    t.steps.forEach((st, k) => {
      if (st.expect === undefined && !st.check) return;
      const rec = mine.find((r) => r.s === k);
      gotSteps[k] = rec ? rec.v : undefined;
      if (st.expect === undefined) return;
      const m = stepMethod(q.class, st);
      if (!rec || !same(m.returns, st.expect, rec.v, q.compare === 'unordered', q.types)) pass = false;
    });
    return { pass, gotSteps };
  });
  return { status: 'ok', tests: results, printed: printed.slice(0, 4000), stderr: (res.stderr || '').slice(0, 2000), scan };
}

// What a student sees after Run: one row per sample, in their language.
function studentView(q, lang, tests, r) {
  if (r.status !== 'ok') return { status: r.status, message: r.message };
  const anyCrash = r.tests.find((t) => t.error && t.error !== 'Ran out of time' && t.error !== 'Stopped before finishing');
  return {
    status: 'ok',
    tests: r.tests.map((res, i) => {
      const t = tests[i];
      let got;
      if (res.error) got = res.error;
      else if (q.mode === 'method') got = showGot(q.signature.returns, res.got, lang, q.types);
      else {
        got = t.steps.map((st, k) => (st.expect === undefined ? null : showGot(stepMethod(q.class, st).returns, res.gotSteps[k], lang, q.types)))
          .filter((x) => x !== null).join(', ');
      }
      return { call: callText(q, t, lang), expected: expectedText(q, t, lang), got, pass: !!res.pass };
    }),
    stdout: r.printed || (anyCrash ? '' : ''),
  };
}

module.exports = { clean, cleanCc, cleanCs, cleanGo, cleanJs, cleanRust, readResults, same, studentView };
