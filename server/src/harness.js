'use strict';
// Builds the wrapper that calls the student's code for each test, and reads the results back.
// The sandbox only ever gets code + inputs; expected values stay here and are compared here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { elementType, isRange, rangeLength } = require('./quizfile');
const T = require('../../public/teacher/types.js');
const B = require('./bans');

const BQJ_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'BQJ.java'), 'utf8');
const BQH_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqh.py'), 'utf8');
const BQSCAN_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqscan.py'), 'utf8');

const javaType = T.javaType;
const pyType = T.pyType;
// Boxed Java type, for generics: int -> Integer, list<int> -> ArrayList<Integer>.
const boxed = (t) => (T.SCALARS.includes(t) ? javaType(`list<${t}>`).slice('ArrayList<'.length, -1) : javaType(t));
// With overloads, a step names its method by position; older quizzes only by name.
const stepMethod = (C, st) => (st.m != null && C.methods[st.m]) || C.methods.find((x) => x.name === st.call);

// ---------- Java literals ----------
function javaStr(s) {
  let o = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (ch === '"') o += '\\"';
    else if (ch === '\\') o += '\\\\';
    else if (ch === '\n') o += '\\n';
    else if (ch === '\r') o += '\\r';
    else if (ch === '\t') o += '\\t';
    else if (c >= 0x20 && c < 0x7f) o += ch;
    else o += '\\u' + c.toString(16).padStart(4, '0');
  }
  return o + '"';
}
const charLit = (c) => "'" + String(c).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\t/g, '\\t') + "'";
function javaLit(type, v) {
  if (v === null) return 'null';
  if (isRange(v) && !T.mapTypes(type)) { // built in the sandbox, so a 10-million-number array isn't written out in the code
    const [a, b, s] = v.range;
    return `BQJ.${type === 'long[]' ? 'rangeL' : type === 'list<int>' ? 'rangeList' : 'range'}(${a}L, ${b}L, ${s}L)`;
  }
  switch (type) {
    case 'int': return String(v);
    case 'long': return v + 'L';
    case 'double': return Number.isInteger(v) ? v.toFixed(1) : String(v);
    case 'boolean': return String(v);
    case 'string': return javaStr(v);
    case 'char': return charLit(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) {
    const pairs = Object.entries(v).map(([k, x]) => `${javaLit(kv[0], kv[0] === 'int' ? Number(k) : k)}, ${javaLit(kv[1], x)}`);
    return `BQJ.<${boxed(kv[0])}, ${boxed(kv[1])}>map(${pairs.join(', ')})`;
  }
  const e = elementType(type);
  if (type.endsWith('[][]')) {
    return `new ${javaType(type)}{${v.map((r) => (r === null ? 'null' : '{' + r.map((x) => javaLit(e.slice(0, -2), x)).join(', ') + '}')).join(', ')}}`;
  }
  if (type.endsWith('[]')) return `new ${javaType(type)}{${v.map((x) => javaLit(e, x)).join(', ')}}`;
  const box = boxed(e);
  return v.length ? `new ArrayList<${box}>(Arrays.asList(${v.map((x) => javaLit(e, x)).join(', ')}))` : `new ArrayList<${box}>()`;
}

// ---------- what students see ----------
// A range shows its first few numbers and its last: {0, 1, 2, ..., 9999999}.
function showRange(type, v, lang) {
  const [a, , s] = v.range;
  const n = rangeLength(v.range);
  const items = n <= 6 ? Array.from({ length: n }, (_, k) => a + k * s) : [a, a + s, a + 2 * s, '...', a + (n - 1) * s];
  const inner = items.join(', ');
  return lang === 'java' && type.endsWith('[]') ? `{${inner}}` : `[${inner}]`;
}
function show(type, v, lang) {
  if (v === null || v === undefined) return lang === 'python' ? 'None' : 'null';
  if (isRange(v) && !T.mapTypes(type)) return showRange(type, v, lang);
  switch (type) {
    case 'string': return JSON.stringify(v);
    case 'char': return typeof v === 'string' ? charLit(v) : JSON.stringify(v);
    case 'boolean': return lang === 'python' ? (v ? 'True' : 'False') : String(v);
    case 'double': return Number.isInteger(v) ? v.toFixed(1) : String(v);
    case 'int': case 'long': return String(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv && v && typeof v === 'object' && !Array.isArray(v)) {
    const items = Object.entries(v).map(([k, x]) => [show(kv[0], kv[0] === 'int' ? Number(k) : k, lang), show(kv[1], x, lang)]);
    return lang === 'python' ? `{${items.map(([a, b]) => `${a}: ${b}`).join(', ')}}` : `Map.of(${items.map(([a, b]) => `${a}, ${b}`).join(', ')})`;
  }
  if (!Array.isArray(v)) return JSON.stringify(v);
  const inner = v.map((x) => show(elementType(type), x, lang)).join(', ');
  return lang === 'java' && type.endsWith('[]') ? `{${inner}}` : `[${inner}]`;
}
function showGot(type, v, lang) {
  if (v === undefined) return '(nothing)';
  try { return show(type, v, lang); } catch (e) { return JSON.stringify(v); }
}

function callText(q, test, lang) {
  if (q.mode === 'method') {
    return `${q.signature.name}(${test.args.map((a, i) => show(q.signature.params[i].type, a, lang)).join(', ')})`;
  }
  const C = q.class;
  return test.steps.map((s) => {
    if (s.new) {
      const args = s.new.map((a, i) => show(C.constructor[i].type, a, lang)).join(', ');
      return lang === 'java' ? `${C.name} ${s.as} = new ${C.name}(${args});` : `${s.as} = ${C.name}(${args})`;
    }
    const m = stepMethod(C, s);
    const args = s.args.map((a, i) => show(m.params[i].type, a, lang)).join(', ');
    return lang === 'java' ? `${s.on}.${s.call}(${args});` : `${s.on}.${s.call}(${args})`;
  }).join('\n');
}
function expectedText(q, test, lang) {
  if (q.mode === 'method') return show(q.signature.returns, test.expected, lang);
  return test.steps.filter((s) => s.expect !== undefined)
    .map((s) => show(stepMethod(q.class, s).returns, s.expect, lang)).join(', ');
}

// ---------- starter code ----------
function starterCode(q, lang) {
  if (q.starter && q.starter[lang]) return q.starter[lang];
  const jp = (ps) => ps.map((p) => `${javaType(p.type)} ${p.name}`).join(', ');
  const pp = (ps) => ps.map((p) => `, ${p.name}: ${pyType(p.type)}`).join('');
  if (q.mode === 'method') {
    const s = q.signature;
    if (lang === 'java') return `class Solution {\n    public ${javaType(s.returns)} ${s.name}(${jp(s.params)}) {\n        \n    }\n}\n`;
    return `class Solution:\n    def ${s.name}(self${pp(s.params)}) -> ${pyType(s.returns)}:\n        pass\n`;
  }
  const C = q.class;
  if (q.starterStyle === 'empty') return lang === 'java' ? `public class ${C.name} {\n    \n}\n` : `class ${C.name}:\n    pass\n`;
  if (lang === 'java') {
    const body = [`    public ${C.name}(${jp(C.constructor)}) {\n    }`]
      .concat(C.methods.map((m) => `    public ${javaType(m.returns)} ${m.name}(${jp(m.params)}) {\n    }`));
    return `public class ${C.name} {\n${body.join('\n\n')}\n}\n`;
  }
  const body = [`    def __init__(self${pp(C.constructor)}):\n        pass`]
    .concat(C.methods.map((m) => `    def ${m.name}(self${pp(m.params)}) -> ${pyType(m.returns)}:\n        pass`));
  return `class ${C.name}:\n${body.join('\n\n')}\n`;
}

// ---------- job building ----------
function javaMain(q, tests, marker, scanFile) {
  const L = ['import java.util.*;', '', 'public class BQMain {'];
  tests.forEach((t, i) => {
    L.push(`    static void t${i}(String m) throws Throwable {`);
    if (q.mode === 'method' && t.speed) {
      // Speed test: the arguments are made first, then only the calls are timed.
      const s = q.signature;
      t.args.forEach((a, k) => L.push(`        ${javaType(s.params[k].type)} a${k} = ${javaLit(s.params[k].type, a)};`));
      L.push('        Solution sol = new Solution();', '        Object r = null;', '        long t0 = System.nanoTime();',
        `        for (int c = 0; c < ${t.calls || 1}; c++) r = sol.${s.name}(${t.args.map((_, k) => 'a' + k).join(', ')});`,
        `        BQJ.timed(m, ${i}, r, (System.nanoTime() - t0) / 1e6);`);
    } else if (q.mode === 'method') {
      const s = q.signature;
      L.push(`        BQJ.ok(m, ${i}, new Solution().${s.name}(${t.args.map((a, k) => javaLit(s.params[k].type, a)).join(', ')}));`);
    } else {
      const C = q.class;
      const declared = new Set();
      t.steps.forEach((st, k) => {
        if (st.new) {
          const decl = declared.has(st.as) ? '' : `${C.name} `;
          declared.add(st.as);
          L.push(`        ${decl}o_${st.as} = new ${C.name}(${st.new.map((a, j) => javaLit(C.constructor[j].type, a)).join(', ')});`);
          return;
        }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => javaLit(m.params[j].type, a)).join(', ')})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        BQJ.step(m, ${i}, ${k}, ${call});`);
        else L.push(`        ${call};`);
      });
      L.push(`        BQJ.done(m, ${i});`);
    }
    L.push('    }');
  });
  // The marker stays a local, and this file (source and class) is gone before student code runs.
  L.push('', '    public static void main(String[] args) {', `        String m = ${javaStr(marker)};`, '        BQJ.begin();',
    '        new java.io.File("BQMain.java").delete();', '        new java.io.File("BQMain.class").delete();');
  if (scanFile) L.push(`        BQJ.scan(m, ${javaStr(scanFile)});`);
  tests.forEach((_, i) => L.push(`        try { t${i}(m); } catch (Throwable e) { BQJ.fail(m, ${i}, e); }`));
  L.push('        System.out.flush();', '    }', '}', '');
  return L.join('\n');
}

function pyMain(q, tests, marker) {
  const a = (params, v) => `bqh.args(${JSON.stringify(JSON.stringify(v.map((x, j) => {
    const kv = params[j] && T.mapTypes(params[j].type);
    return kv && x && typeof x === 'object' ? { __map__: Object.entries(x).map(([k, val]) => [kv[0] === 'int' ? Number(k) : k, val]) } : x;
  })))})`;
  // Everything lives inside _bq(): the marker and the helpers are locals, taken before the student's code
  // is imported, and main.py deletes itself first. The facts for the ban check come before any of it runs.
  const L = ['import sys', 'import time', 'sys.setrecursionlimit(10000)', '', 'def _bq():', `    M = ${JSON.stringify(marker)}`,
    '    import os', '    try:', '        os.remove(__file__)', '    except OSError:', '        pass',
    '    import bqh', '    out = bqh.writer(M, sys.stdout)', '    del M',
    '    ok, timed, step, done, fail, args, clock = bqh.ok, bqh.timed, bqh.step, bqh.done, bqh.fail, bqh.args, time.perf_counter',
    '    import bqscan', '    out({"scan": bqscan.scan("solution.py")})'];
  if (q.support && q.support.python) {
    L.push('    import builtins, support', '    for _k in dir(support):', '        if not _k.startswith("_"):', '            setattr(builtins, _k, getattr(support, _k))');
  }
  L.push('    try:', '        import solution', '    except BaseException as _e:', '        import traceback',
    '        out({"compile": True, "err": "".join(traceback.format_exception_only(type(_e), _e))[-2000:]})',
    '        return');
  const A = (params, v) => a(params, v).replace(/^bqh\.args/, 'args');
  tests.forEach((t, i) => {
    L.push(`    def t${i}():`);
    if (q.mode === 'method' && t.speed) {
      L.push(`        _a = ${A(q.signature.params, t.args)}`, '        _s = solution.Solution()', '        _r = None', '        _t0 = clock()',
        `        for _c in range(${t.calls || 1}):`, `            _r = _s.${q.signature.name}(*_a)`, `        timed(out, ${i}, _r, (clock() - _t0) * 1000)`);
    } else if (q.mode === 'method') {
      L.push(`        ok(out, ${i}, solution.Solution().${q.signature.name}(*${A(q.signature.params, t.args)}))`);
    } else {
      const C = q.class;
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`        o_${st.as} = solution.${C.name}(*${A(C.constructor, st.new)})`); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(*${A(m.params, st.args)})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        step(out, ${i}, ${k}, ${call})`);
        else L.push(`        ${call}`);
      });
      L.push(`        done(out, ${i})`);
    }
  });
  L.push(`    for _i, _t in enumerate([${tests.map((_, i) => 't' + i).join(', ')}]):`, '        try:', '            _t()', '        except BaseException as _e:', '            fail(out, _i, _e)',
    '', '', '_bq()', '');
  return L.join('\n');
}

// A snippet for "predict the output": Java statements get wrapped in a main method unless the code
// already has one (then the class around main is the program). Python runs as is.
function buildSnippetJob(lang, code) {
  if (lang === 'python') return { language: 'python', files: { 'main.py': code }, main: 'main.py' };
  const imports = 'import java.util.*; import java.util.function.*; import java.util.stream.*; ';
  const at = code.search(/\bstatic\s+void\s+main\s*\(/);
  if (at >= 0) {
    const classes = [...code.slice(0, at).matchAll(/\bclass\s+(\w+)/g)];
    const name = classes.length ? classes[classes.length - 1][1] : 'Main';
    return { language: 'java', files: { [name + '.java']: imports + code }, main: name };
  }
  return { language: 'java', files: { 'Main.java': imports + 'public class Main { public static void main(String[] args) throws Exception {\n' + code + '\n} }' }, main: 'Main' };
}

function buildJob(q, lang, code, tests) {
  // Random through and through, so there's no fixed part to search memory or output for.
  const marker = crypto.randomBytes(16).toString('hex');
  const files = {};
  if (lang === 'java') {
    // The directions promise common imports. Same line as the student's first line, so compile errors
    // still point at the line numbers they see. (Duplicate imports are legal Java; a package line isn't.)
    const imports = /^\s*package\s/m.test(code) ? '' : 'import java.util.*; import java.util.function.*; import java.util.stream.*; ';
    const mine = q.mode === 'class' ? `${q.class.name}.java` : 'Solution.java';
    files[mine] = imports + code;
    files['BQJ.java'] = BQJ_SRC;
    if (q.support && q.support.java) files['Support.java'] = q.support.java;
    // The ban check reads the compiled classes, so only when there's something to check.
    files['BQMain.java'] = javaMain(q, tests, marker, B.bansFor(q.ban, 'java').length ? mine : null);
    return { marker, job: { language: 'java', files, main: 'BQMain' } };
  }
  files['solution.py'] = code;
  files['bqh.py'] = BQH_SRC;
  files['bqscan.py'] = BQSCAN_SRC;
  if (q.support && q.support.python) files['support.py'] = q.support.python;
  files['main.py'] = pyMain(q, tests, marker);
  return { marker, job: { language: 'python', files, main: 'main.py' } };
}

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

function same(type, exp, got, unordered) {
  if (exp === null || got === null || got === undefined) return exp === got;
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
    return a.size === b.size && [...a].every(([k, x]) => b.has(k) && same(kv[1], x, b.get(k), false));
  }
  if (!Array.isArray(got) || got.length !== exp.length) return false;
  const e = elementType(type);
  let a = exp;
  let b = got;
  if (unordered) {
    const key = (x) => JSON.stringify(x);
    a = [...exp].sort((x, y) => (key(x) < key(y) ? -1 : 1));
    b = [...got].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  }
  return a.every((x, i) => same(e, x, b[i], false));
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
  const text = String(s || '').replace(/\/jobs\/[^/\s]+\//g, '').replace(/\r/g, '').trim();
  if (!/^BQMain\.java:/m.test(text)) return text.slice(0, 4000);
  const own = text.split(/(?=^\w+\.java:\d+: error: )/m).filter((b) => /^\w+\.java/.test(b) && !b.startsWith('BQMain.java')).join('').trim();
  return [own, explainHarnessErrors(text)].filter(Boolean).join('\n').slice(0, 4000);
}
const cleanPy = (s) => String(s || '').replace(/File "\/jobs\/[^"]+\/(\w+\.py)"/g, 'File "$1"').trim().slice(0, 4000);

// res = runner response. Returns { status, message?, tests: [{ pass, got?, gotSteps?, error? }], printed }
function readResults(q, lang, tests, res, marker) {
  if (res.status === 'compile_error') return { status: 'compile_error', message: cleanJava(res.stderr || res.stdout) };
  if (res.status === 'error') return { status: 'error', message: 'The code runner had a problem. Try again in a moment.' };
  const { records, printed } = splitOutput(res.stdout, marker);
  // The ban check's facts come first, written before any student code ran.
  const scan = records.length && records[0].scan ? records[0].scan : null;
  const compile = records.find((r) => r.compile);
  if (compile) return { status: 'compile_error', message: cleanPy(compile.err), scan };
  // A Python speed test only counts when the code keeps out of the harness that times it (bans.js).
  const intrudes = tests.some((t) => t.speed) ? B.timingIntrusions(lang, scan) : [];
  const stopped = res.status === 'timeout' ? 'Ran out of time' : res.status === 'output_limit' ? 'Printed too much output' : 'Stopped before finishing';
  const results = tests.map((t, i) => {
    const mine = records.filter((r) => r.i === i);
    const final = mine.find((r) => r.s === undefined && r.ok !== undefined);
    if (!final) return { pass: false, error: t.speed && res.status === 'timeout' ? 'Too slow: ran out of time' : stopped };
    if (!final.ok) return { pass: false, error: final.err || 'Crashed' };
    if (t.speed && intrudes.length) return { pass: false, got: final.v, error: `Can't time code that uses ${intrudes.slice(0, 3).join(', ')}` };
    if (q.mode === 'method') {
      const pass = t.expected === undefined ? null : same(q.signature.returns, t.expected, final.v, q.compare === 'unordered');
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
      if (!rec || !same(m.returns, st.expect, rec.v, q.compare === 'unordered')) pass = false;
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
      else if (q.mode === 'method') got = showGot(q.signature.returns, res.got, lang);
      else {
        got = t.steps.map((st, k) => (st.expect === undefined ? null : showGot(stepMethod(q.class, st).returns, res.gotSteps[k], lang)))
          .filter((x) => x !== null).join(', ');
      }
      return { call: callText(q, t, lang), expected: expectedText(q, t, lang), got, pass: !!res.pass };
    }),
    stdout: r.printed || (anyCrash ? '' : ''),
  };
}

module.exports = { buildJob, readResults, studentView, starterCode, callText, expectedText, same, show, javaType, pyType, buildSnippetJob };
