'use strict';
// Builds the wrapper that calls the student's code for each test, and reads the results back.
// The sandbox only ever gets code + inputs; expected values stay here and are compared here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { elementType } = require('./quizfile');

const BQJ_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'BQJ.java'), 'utf8');
const BQH_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqh.py'), 'utf8');

const JAVA_TYPE = {
  int: 'int', long: 'long', double: 'double', boolean: 'boolean', string: 'String', void: 'void',
  'int[]': 'int[]', 'long[]': 'long[]', 'double[]': 'double[]', 'boolean[]': 'boolean[]', 'string[]': 'String[]',
  'int[][]': 'int[][]', 'list<int>': 'ArrayList<Integer>', 'list<string>': 'ArrayList<String>',
};
const PY_TYPE = {
  int: 'int', long: 'int', double: 'float', boolean: 'bool', string: 'str', void: 'None',
  'int[]': 'list[int]', 'long[]': 'list[int]', 'double[]': 'list[float]', 'boolean[]': 'list[bool]', 'string[]': 'list[str]',
  'int[][]': 'list[list[int]]', 'list<int>': 'list[int]', 'list<string>': 'list[str]',
};

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
function javaLit(type, v) {
  if (v === null) return 'null';
  switch (type) {
    case 'int': return String(v);
    case 'long': return v + 'L';
    case 'double': return Number.isInteger(v) ? v.toFixed(1) : String(v);
    case 'boolean': return String(v);
    case 'string': return javaStr(v);
    default: break;
  }
  const e = elementType(type);
  if (type === 'int[][]') return 'new int[][]{' + v.map((r) => (r === null ? 'null' : '{' + r.join(', ') + '}')).join(', ') + '}';
  if (type.endsWith('[]')) return `new ${JAVA_TYPE[type]}{${v.map((x) => javaLit(e, x)).join(', ')}}`;
  const box = e === 'int' ? 'Integer' : 'String';
  return v.length ? `new ArrayList<${box}>(Arrays.asList(${v.map((x) => javaLit(e, x)).join(', ')}))` : `new ArrayList<${box}>()`;
}

// ---------- what students see ----------
function show(type, v, lang) {
  if (v === null || v === undefined) return lang === 'python' ? 'None' : 'null';
  switch (type) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return lang === 'python' ? (v ? 'True' : 'False') : String(v);
    case 'double': return Number.isInteger(v) ? v.toFixed(1) : String(v);
    case 'int': case 'long': return String(v);
    default: break;
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
    const m = C.methods.find((x) => x.name === s.call);
    const args = s.args.map((a, i) => show(m.params[i].type, a, lang)).join(', ');
    return lang === 'java' ? `${s.on}.${s.call}(${args});` : `${s.on}.${s.call}(${args})`;
  }).join('\n');
}
function expectedText(q, test, lang) {
  if (q.mode === 'method') return show(q.signature.returns, test.expected, lang);
  return test.steps.filter((s) => s.expect !== undefined)
    .map((s) => show(q.class.methods.find((m) => m.name === s.call).returns, s.expect, lang)).join(', ');
}

// ---------- starter code ----------
function starterCode(q, lang) {
  if (q.starter && q.starter[lang]) return q.starter[lang];
  const jp = (ps) => ps.map((p) => `${JAVA_TYPE[p.type]} ${p.name}`).join(', ');
  const pp = (ps) => ps.map((p) => `, ${p.name}: ${PY_TYPE[p.type]}`).join('');
  if (q.mode === 'method') {
    const s = q.signature;
    if (lang === 'java') return `class Solution {\n    public ${JAVA_TYPE[s.returns]} ${s.name}(${jp(s.params)}) {\n        \n    }\n}\n`;
    return `class Solution:\n    def ${s.name}(self${pp(s.params)}) -> ${PY_TYPE[s.returns]}:\n        pass\n`;
  }
  const C = q.class;
  if (q.starterStyle === 'empty') return lang === 'java' ? `public class ${C.name} {\n    \n}\n` : `class ${C.name}:\n    pass\n`;
  if (lang === 'java') {
    const body = [`    public ${C.name}(${jp(C.constructor)}) {\n    }`]
      .concat(C.methods.map((m) => `    public ${JAVA_TYPE[m.returns]} ${m.name}(${jp(m.params)}) {\n    }`));
    return `public class ${C.name} {\n${body.join('\n\n')}\n}\n`;
  }
  const body = [`    def __init__(self${pp(C.constructor)}):\n        pass`]
    .concat(C.methods.map((m) => `    def ${m.name}(self${pp(m.params)}) -> ${PY_TYPE[m.returns]}:\n        pass`));
  return `class ${C.name}:\n${body.join('\n\n')}\n`;
}

// ---------- job building ----------
function javaMain(q, tests, marker) {
  const L = ['import java.util.*;', '', 'public class BQMain {'];
  tests.forEach((t, i) => {
    L.push(`    static void t${i}() throws Throwable {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(`        BQJ.ok(${i}, new Solution().${s.name}(${t.args.map((a, k) => javaLit(s.params[k].type, a)).join(', ')}));`);
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
        const m = C.methods.find((x) => x.name === st.call);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => javaLit(m.params[j].type, a)).join(', ')})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        BQJ.step(${i}, ${k}, ${call});`);
        else L.push(`        ${call};`);
      });
      L.push(`        BQJ.done(${i});`);
    }
    L.push('    }');
  });
  L.push('', '    public static void main(String[] args) {', `        BQJ.M = ${javaStr(marker)};`);
  tests.forEach((_, i) => L.push(`        try { t${i}(); } catch (Throwable e) { BQJ.fail(${i}, e); }`));
  L.push('        System.out.flush();', '    }', '}', '');
  return L.join('\n');
}

function pyMain(q, tests, marker) {
  const a = (v) => `bqh.args(${JSON.stringify(JSON.stringify(v))})`;
  const L = ['import sys', 'sys.setrecursionlimit(10000)', 'import bqh', `bqh.M = ${JSON.stringify(marker)}`];
  if (q.support && q.support.python) {
    L.push('import builtins, support', 'for _k in dir(support):', '    if not _k.startswith("_"):', '        setattr(builtins, _k, getattr(support, _k))');
  }
  L.push('try:', '    import solution', 'except BaseException as _e:', '    import traceback',
    '    bqh._out({"compile": True, "err": "".join(traceback.format_exception_only(type(_e), _e))[-2000:]})',
    '    raise SystemExit(0)');
  tests.forEach((t, i) => {
    L.push(`def t${i}():`);
    if (q.mode === 'method') {
      L.push(`    bqh.ok(${i}, solution.Solution().${q.signature.name}(*${a(t.args)}))`);
    } else {
      const C = q.class;
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`    o_${st.as} = solution.${C.name}(*${a(st.new)})`); return; }
        const m = C.methods.find((x) => x.name === st.call);
        const call = `o_${st.on}.${st.call}(*${a(st.args)})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`    bqh.step(${i}, ${k}, ${call})`);
        else L.push(`    ${call}`);
      });
      L.push(`    bqh.done(${i})`);
    }
  });
  L.push(`for _i, _t in enumerate([${tests.map((_, i) => 't' + i).join(', ')}]):`, '    try:', '        _t()', '    except BaseException as _e:', '        bqh.fail(_i, _e)', '');
  return L.join('\n');
}

function buildJob(q, lang, code, tests) {
  const marker = `@@BQ@@${crypto.randomBytes(12).toString('hex')}@@`;
  const files = {};
  if (lang === 'java') {
    // The directions promise common imports. Same line as the student's first line, so compile errors
    // still point at the line numbers they see. (Duplicate imports are legal Java; a package line isn't.)
    const imports = /^\s*package\s/m.test(code) ? '' : 'import java.util.*; import java.util.function.*; import java.util.stream.*; ';
    files[q.mode === 'class' ? `${q.class.name}.java` : 'Solution.java'] = imports + code;
    files['BQJ.java'] = BQJ_SRC;
    if (q.support && q.support.java) files['Support.java'] = q.support.java;
    files['BQMain.java'] = javaMain(q, tests, marker);
    return { marker, job: { language: 'java', files, main: 'BQMain' } };
  }
  files['solution.py'] = code;
  files['bqh.py'] = BQH_SRC;
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
    case 'int': case 'long': case 'boolean': case 'string': return got === exp;
    default: break;
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

const cleanJava = (s) => String(s || '').replace(/\/jobs\/[^/\s]+\//g, '').replace(/\r/g, '').trim().slice(0, 4000);
const cleanPy = (s) => String(s || '').replace(/File "\/jobs\/[^"]+\/(\w+\.py)"/g, 'File "$1"').trim().slice(0, 4000);

// res = runner response. Returns { status, message?, tests: [{ pass, got?, gotSteps?, error? }], printed }
function readResults(q, lang, tests, res, marker) {
  if (res.status === 'compile_error') return { status: 'compile_error', message: cleanJava(res.stderr || res.stdout) };
  if (res.status === 'error') return { status: 'error', message: 'The code runner had a problem. Try again in a moment.' };
  const { records, printed } = splitOutput(res.stdout, marker);
  const compile = records.find((r) => r.compile);
  if (compile) return { status: 'compile_error', message: cleanPy(compile.err) };
  const stopped = res.status === 'timeout' ? 'Ran out of time' : res.status === 'output_limit' ? 'Printed too much output' : 'Stopped before finishing';
  const results = tests.map((t, i) => {
    const mine = records.filter((r) => r.i === i);
    const final = mine.find((r) => r.s === undefined && r.ok !== undefined);
    if (!final) return { pass: false, error: stopped };
    if (!final.ok) return { pass: false, error: final.err || 'Crashed' };
    if (q.mode === 'method') return { pass: t.expected === undefined ? null : same(q.signature.returns, t.expected, final.v, q.compare === 'unordered'), got: final.v };
    let pass = true;
    const gotSteps = {};
    t.steps.forEach((st, k) => {
      if (st.expect === undefined && !st.check) return;
      const rec = mine.find((r) => r.s === k);
      gotSteps[k] = rec ? rec.v : undefined;
      if (st.expect === undefined) return;
      const m = q.class.methods.find((x) => x.name === st.call);
      if (!rec || !same(m.returns, st.expect, rec.v, q.compare === 'unordered')) pass = false;
    });
    return { pass, gotSteps };
  });
  return { status: 'ok', tests: results, printed: printed.slice(0, 4000), stderr: (res.stderr || '').slice(0, 2000) };
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
        got = t.steps.map((st, k) => (st.expect === undefined ? null : showGot(q.class.methods.find((m) => m.name === st.call).returns, res.gotSteps[k], lang)))
          .filter((x) => x !== null).join(', ');
      }
      return { call: callText(q, t, lang), expected: expectedText(q, t, lang), got, pass: !!res.pass };
    }),
    stdout: r.printed || (anyCrash ? '' : ''),
  };
}

module.exports = { buildJob, readResults, studentView, starterCode, callText, expectedText, same, show, JAVA_TYPE, PY_TYPE };
