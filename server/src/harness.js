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
const BQJS_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqh.cjs'), 'utf8');
const BQRT_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqrt.c'), 'utf8');
const BQC_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bqc.h'), 'utf8');
const BQCPP_SRC = fs.readFileSync(path.join(__dirname, 'harness', 'bq.hpp'), 'utf8');
// What every C answer gets without asking (C++'s is in the runner image, precompiled: runner/bqpre.hpp).
const C_PRELUDE = ['stdio.h', 'stdlib.h', 'string.h', 'stdbool.h', 'math.h', 'limits.h', 'ctype.h', 'stdint.h'].map((x) => `#include <${x}>`).join('\n') + '\n';
const { isJs, isC } = T;
const NULL_WORD = { python: 'None', cpp: 'nullptr', c: 'NULL' };
const ZERO_VALUE = { int: 0, long: 0, double: 0, boolean: false, char: '\0' };
// A field left out of an object: null, or 0 / false for one that can't be null.
const fieldValue = (f, v) => (v[f.name] !== undefined ? v[f.name] : T.nullable(f.type) ? null : ZERO_VALUE[T.canon(f.type)]);

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
function javaLit(type, v, D) {
  if (v === null) return 'null';
  if (T.isClass(type, D)) { // new Point(1, 2): every field in order, left-out ones null
    return `new ${type}(${D[type].map((f) => (v[f.name] === undefined ? (T.JAVA_ZERO[f.type] || 'null') : javaLit(f.type, v[f.name], D))).join(', ')})`;
  }
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
    const pairs = Object.entries(v).map(([k, x]) => `${javaLit(kv[0], kv[0] === 'int' ? Number(k) : k, D)}, ${javaLit(kv[1], x, D)}`);
    return `BQJ.<${boxed(kv[0])}, ${boxed(kv[1])}>map(${pairs.join(', ')})`;
  }
  const e = elementType(type);
  if (type.endsWith('[][]')) {
    return `new ${javaType(type)}{${v.map((r) => (r === null ? 'null' : '{' + r.map((x) => javaLit(e.slice(0, -2), x, D)).join(', ') + '}')).join(', ')}}`;
  }
  if (type.endsWith('[]')) return `new ${javaType(type)}{${v.map((x) => javaLit(e, x, D)).join(', ')}}`;
  const box = boxed(e);
  return v.length ? `new ArrayList<${box}>(Arrays.asList(${v.map((x) => javaLit(e, x, D)).join(', ')}))` : `new ArrayList<${box}>()`;
}

// ---------- JavaScript, C++ and C literals ----------
function jsLit(type, v, D) {
  if (v === null || v === undefined) return 'null';
  if (T.isClass(type, D)) return `new ${type}(${D[type].map((f) => (v[f.name] === undefined ? 'undefined' : jsLit(f.type, v[f.name], D))).join(', ')})`;
  if (isRange(v) && !T.mapTypes(type)) return `range(${v.range.join(', ')})`;
  switch (type) {
    case 'int': case 'long': case 'double': case 'boolean': return String(v);
    case 'string': case 'char': return JSON.stringify(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) return `new Map([${Object.entries(v).map(([k, x]) => `[${kv[0] === 'int' ? Number(k) : JSON.stringify(k)}, ${jsLit(kv[1], x, D)}]`).join(', ')}])`;
  return `[${v.map((x) => jsLit(elementType(type), x, D)).join(', ')}]`;
}
// How bqh.cjs is told a type: { k: 's' } scalar, { k: 'a', e } array or list, { k: 'm', v } map, { k: 'c', n } class.
function jsDesc(type, D) {
  type = T.canon(type);
  if (T.isClass(type, D)) return `{k:"c",n:${JSON.stringify(type)}}`;
  const kv = T.mapTypes(type);
  if (kv) return `{k:"m",v:${jsDesc(kv[1], D)}}`;
  const e = elementType(type);
  return e ? `{k:"a",e:${jsDesc(e, D)}}` : '{k:"s"}';
}

// C and C++ text: printable ASCII as is, everything else (UTF-8 bytes) as octal escapes.
function cStr(s) {
  const bytes = Buffer.from(String(s), 'utf8');
  let o = '"';
  for (const b of bytes) {
    if (b === 0x22) o += '\\"';
    else if (b === 0x5c) o += '\\\\';
    else if (b === 0x3f) o += '\\?';
    else if (b >= 0x20 && b < 0x7f) o += String.fromCharCode(b);
    else o += '\\' + b.toString(8).padStart(3, '0');
  }
  return { lit: o + '"', n: bytes.length };
}
function cChar(c) {
  const b = String(c).charCodeAt(0);
  if (c === "'") return "'\\''";
  if (c === '\\') return "'\\\\'";
  return b >= 0x20 && b < 0x7f ? `'${c}'` : `'\\${(b & 0xff).toString(8).padStart(3, '0')}'`;
}
const cDouble = (v) => { const t = String(v); return /[.e]/.test(t) ? t : t + '.0'; };
function cppZero(type, D) {
  if (T.CPP_ZERO[type]) return T.CPP_ZERO[type];
  return T.isClass(type, D) ? 'nullptr' : `${T.cppType(type)}{}`;
}
function cppLit(type, v, D) {
  if (v === null || v === undefined) return T.isClass(type, D) ? 'nullptr' : cppZero(type, D);
  if (T.isClass(type, D)) return `new ${type}(${D[type].map((f) => (v[f.name] === undefined ? cppZero(T.canon(f.type), D) : cppLit(f.type, v[f.name], D))).join(', ')})`;
  if (isRange(v) && !T.mapTypes(type)) return `bq::${type === 'long[]' ? 'rangeL' : 'range'}(${v.range.map((x) => x + 'LL').join(', ')})`;
  switch (type) {
    case 'int': case 'boolean': return String(v);
    case 'long': return v + 'LL';
    case 'double': return cDouble(v);
    case 'char': return cChar(v);
    case 'string': { const c = cStr(v); return `string(${c.lit}, ${c.n})`; }
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) return `${T.cppType(type)}{${Object.entries(v).map(([k, x]) => `{${kv[0] === 'int' ? String(Number(k)) : cppLit('string', k, D)}, ${cppLit(kv[1], x, D)}}`).join(', ')}}`;
  return `${T.cppType(type)}{${v.map((x) => cppLit(elementType(type), x, D)).join(', ')}}`;
}
// C: numbers, chars, strings (copied to the heap) and objects (bq_new_Point) as expressions.
function cScalar(type, v, D) {
  type = T.canon(type);
  if (v === null || v === undefined) return 'NULL';
  if (T.isClass(type, D)) return `bq_new_${type}(${D[type].map((f) => cScalar(f.type, fieldValue(f, v), D)).join(', ')})`;
  switch (type) {
    case 'long': return v + 'LL';
    case 'double': return cDouble(v);
    case 'char': return cChar(v);
    case 'string': return `bq_str(${cStr(v).lit})`;
    default: return String(v);
  }
}
// C: an argument, declared into L when it's an array. Returns what goes in the call: [nums, numsSize, ...].
function cArg(type, v, name, D, L) {
  type = T.canon(type);
  const d = T.cDims(type);
  if (!d) return [cScalar(type, v, D)];
  const ct = T.cType(type);
  const e = elementType(type);
  if (v === null || v === undefined) { L.push(`    ${ct} ${name} = NULL;`); return d === 2 ? [name, '0', 'NULL'] : [name, '0']; }
  if (isRange(v)) {
    L.push(`    int ${name}n;`, `    ${ct} ${name} = bq_range${type === 'long[]' ? 'L' : ''}(${v.range.map((x) => x + 'LL').join(', ')}, &${name}n);`);
    return [name, name + 'n'];
  }
  const arr = (et, xs) => (xs.length ? `(${T.cType(et)}[]){${xs.map((x) => cScalar(et, x, D)).join(', ')}}` : 'NULL');
  const dup = (et, xs) => `(${T.cType(et)}*)bq_dup(${arr(et, xs)}, ${xs.length} * sizeof(${T.cType(et)}))`;
  if (d === 1) { L.push(`    ${ct} ${name} = ${dup(e, v)};`); return [name, String(v.length)]; }
  const inner = elementType(e);
  const rows = v.map((r) => (r === null ? 'NULL' : dup(inner, r)));
  L.push(`    ${ct} ${name} = (${ct})bq_dup(${v.length ? `(${T.cType(e)}[]){${rows.join(', ')}}` : 'NULL'}, ${v.length} * sizeof(${T.cType(e)}));`,
    `    int* ${name}c = ${dup('int', v.map((r) => (r ? r.length : 0)))};`);
  return [name, String(v.length), name + 'c'];
}
const C_WRITE = { int: 'bq_w_int', long: 'bq_w_ll', double: 'bq_w_dbl', boolean: 'bq_w_bool', char: 'bq_w_chr', string: 'bq_w_str' };
const cWriter = (t, D) => C_WRITE[T.canon(t)] || `bq_w_${T.canon(t)}`;

// ---------- what students see ----------
// A range shows its first few numbers and its last: {0, 1, 2, ..., 9999999}.
// Java arrays and everything in C and C++ are written in braces; lists and the rest in brackets.
const braces = (type, lang) => (lang === 'java' && type.endsWith('[]')) || isC(lang);
function showRange(type, v, lang) {
  const [a, , s] = v.range;
  const n = rangeLength(v.range);
  const items = n <= 6 ? Array.from({ length: n }, (_, k) => a + k * s) : [a, a + s, a + 2 * s, '...', a + (n - 1) * s];
  const inner = items.join(', ');
  return braces(type, lang) ? `{${inner}}` : `[${inner}]`;
}
function show(type, v, lang, D) {
  if (v === null || v === undefined) return NULL_WORD[lang] || 'null';
  if (T.isClass(type, D) && v && typeof v === 'object') {
    const args = D[type].map((f) => show(f.type, fieldValue(f, v), lang, D)).join(', ');
    return lang === 'python' ? `${type}(${args})` : lang === 'c' ? `&(${type}){${args}}` : `new ${type}(${args})`;
  }
  if (isRange(v) && !T.mapTypes(type)) return showRange(type, v, lang);
  switch (type) {
    case 'string': return JSON.stringify(v);
    case 'char': return typeof v === 'string' && !isJs(lang) ? charLit(v) : JSON.stringify(v);
    case 'boolean': return lang === 'python' ? (v ? 'True' : 'False') : String(v);
    case 'double': return Number.isInteger(v) && !isJs(lang) ? v.toFixed(1) : String(v);
    case 'int': case 'long': return String(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv && v && typeof v === 'object' && !Array.isArray(v)) {
    const items = Object.entries(v).map(([k, x]) => [show(kv[0], kv[0] === 'int' ? Number(k) : k, lang, D), show(kv[1], x, lang, D)]);
    if (lang === 'python') return `{${items.map(([a, b]) => `${a}: ${b}`).join(', ')}}`;
    if (isJs(lang)) return `new Map([${items.map(([a, b]) => `[${a}, ${b}]`).join(', ')}])`;
    if (isC(lang)) return `{${items.map(([a, b]) => `{${a}, ${b}}`).join(', ')}}`;
    return `Map.of(${items.map(([a, b]) => `${a}, ${b}`).join(', ')})`;
  }
  if (!Array.isArray(v)) return JSON.stringify(v);
  const inner = v.map((x) => show(elementType(type), x, lang, D)).join(', ');
  return braces(type, lang) ? `{${inner}}` : `[${inner}]`;
}
function showGot(type, v, lang, D) {
  if (v === undefined) return '(nothing)';
  try { return show(type, v, lang, D); } catch (e) { return JSON.stringify(v); }
}

// In C an array comes with its length (and a 2D one with its rows' lengths): sum({1, 2, 3}, 3)
function cSizes(type, v) {
  const d = T.cDims(type);
  if (!d) return '';
  if (v === null || v === undefined) return d === 2 ? ', 0, NULL' : ', 0';
  if (isRange(v)) return `, ${rangeLength(v.range)}`;
  return d === 2 ? `, ${v.length}, {${v.map((r) => (r ? r.length : 0)).join(', ')}}` : `, ${v.length}`;
}
function callText(q, test, lang) {
  if (q.mode === 'method') {
    return `${q.signature.name}(${test.args.map((a, i) => show(q.signature.params[i].type, a, lang, q.types) + (lang === 'c' ? cSizes(q.signature.params[i].type, a) : '')).join(', ')})`;
  }
  const C = q.class;
  return test.steps.map((s) => {
    if (s.new) {
      const args = s.new.map((a, i) => show(C.constructor[i].type, a, lang, q.types)).join(', ');
      if (lang === 'java') return `${C.name} ${s.as} = new ${C.name}(${args});`;
      if (isJs(lang)) return `const ${s.as} = new ${C.name}(${args});`;
      if (lang === 'cpp') return `${C.name}* ${s.as} = new ${C.name}(${args});`;
      return `${s.as} = ${C.name}(${args})`;
    }
    const m = stepMethod(C, s);
    const args = s.args.map((a, i) => show(m.params[i].type, a, lang, q.types)).join(', ');
    return lang === 'python' ? `${s.on}.${s.call}(${args})` : `${s.on}${lang === 'cpp' ? '->' : '.'}${s.call}(${args});`;
  }).join('\n');
}
function expectedText(q, test, lang) {
  if (q.mode === 'method') return show(q.signature.returns, test.expected, lang, q.types);
  return test.steps.filter((s) => s.expect !== undefined)
    .map((s) => show(stepMethod(q.class, s).returns, s.expect, lang, q.types)).join(', ');
}

// ---------- starter code ----------
function starterCode(q, lang) {
  if (q.starter && q.starter[lang]) return q.starter[lang];
  return T.starter(q.mode === 'method' ? { signature: q.signature } : { class: q.class }, lang, q.starterStyle === 'empty');
}

// ---------- job building ----------
function javaMain(q, tests, marker, scanFile, givenFile) {
  const L = ['import java.util.*;', '', 'public class BQMain {'];
  tests.forEach((t, i) => {
    L.push(`    static void t${i}(String m) throws Throwable {`);
    if (q.mode === 'method' && t.speed) {
      // Speed test: the arguments are made first, then only the calls are timed.
      const s = q.signature;
      t.args.forEach((a, k) => L.push(`        ${javaType(s.params[k].type)} a${k} = ${javaLit(s.params[k].type, a, q.types)};`));
      L.push('        Solution sol = new Solution();', '        Object r = null;', '        long t0 = System.nanoTime();',
        `        for (int c = 0; c < ${t.calls || 1}; c++) r = sol.${s.name}(${t.args.map((_, k) => 'a' + k).join(', ')});`,
        `        BQJ.timed(m, ${i}, r, (System.nanoTime() - t0) / 1e6);`);
    } else if (q.mode === 'method') {
      const s = q.signature;
      L.push(`        BQJ.ok(m, ${i}, new Solution().${s.name}(${t.args.map((a, k) => javaLit(s.params[k].type, a, q.types)).join(', ')}));`);
    } else {
      const C = q.class;
      const declared = new Set();
      t.steps.forEach((st, k) => {
        if (st.new) {
          const decl = declared.has(st.as) ? '' : `${C.name} `;
          declared.add(st.as);
          L.push(`        ${decl}o_${st.as} = new ${C.name}(${st.new.map((a, j) => javaLit(C.constructor[j].type, a, q.types)).join(', ')});`);
          return;
        }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => javaLit(m.params[j].type, a, q.types)).join(', ')})`;
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
  if (scanFile) L.push(`        BQJ.scan(m, ${javaStr(scanFile)}, ${givenFile ? javaStr(givenFile) : 'null'});`);
  tests.forEach((_, i) => L.push(`        try { t${i}(m); } catch (Throwable e) { BQJ.fail(m, ${i}, e); }`));
  L.push('        System.out.flush();', '    }', '}', '');
  return L.join('\n');
}

function pyMain(q, tests, marker) {
  const a = (params, v) => `bqh.args(${JSON.stringify(JSON.stringify(v.map((x, j) => pyArg(params[j] ? params[j].type : '', x, q.types))))})`;
  // Everything lives inside _bq(): the marker and the helpers are locals, taken before the student's code
  // is imported, and main.py deletes itself first. The facts for the ban check come before any of it runs.
  const L = ['import sys', 'import time', 'sys.setrecursionlimit(10000)', '', 'def _bq():', `    M = ${JSON.stringify(marker)}`,
    '    import os', '    try:', '        os.remove(__file__)', '    except OSError:', '        pass',
    '    import bqh', '    out = bqh.writer(M, sys.stdout)', '    del M',
    '    ok, timed, step, done, fail, args, clock = bqh.ok, bqh.timed, bqh.step, bqh.done, bqh.fail, bqh.args, time.perf_counter',
    '    import bqscan', '    out({"scan": bqscan.scan("solution.py")})'];
  // The question's classes (types.js classSource), usable without an import like Python's own.
  if (q.types) {
    L.push('    import builtins, bqtypes', `    bqh.TYPES = ${JSON.stringify(Object.fromEntries(Object.entries(q.types).map(([n, fs]) => [n, fs.map((f) => f.name)])))}`,
      '    bqh.CLASSES = {_n: getattr(bqtypes, _n) for _n in bqh.TYPES}', '    for _n, _c in bqh.CLASSES.items():', '        setattr(builtins, _n, _c)');
  }
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

// JavaScript and TypeScript: main.cjs loads the question's classes and support code as plain scripts (so they're
// globals, like Python's builtins), then the student's file, which ends with a line handing back what the
// question asks for. Everything with the marker is in a closure made before their code loads (bqh.cjs).
function jsMain(q, tests, marker, lang) {
  const D = q.types;
  const L = ["'use strict';", '(function () {', `  const M = ${JSON.stringify(marker)};`, "  const fs = require('fs');",
    '  try { fs.unlinkSync(__filename); } catch (e) {}', "  const H = require('./bqh.cjs');", '  const out = H.writer(M);',
    '  const { ok, timed, step, done, fail, broken, missing, range, enc, now } = H;'];
  if (D) L.push(`  H.classes({ ${Object.entries(D).map(([n, fs]) => `${JSON.stringify(n)}: [${fs.map((f) => `[${JSON.stringify(f.name)}, ${jsDesc(f.type, D)}]`).join(', ')}]`).join(', ')} });`);
  const scripts = [];
  if (D) scripts.push(['bqtypes.js', false]);
  if (q.support && q.support[lang]) scripts.push([lang === 'typescript' ? 'support.ts' : 'support.js', lang === 'typescript']);
  if (scripts.length) {
    L.push("  const vm = require('vm');", "  const strip = require('module').stripTypeScriptTypes;");
    for (const [f, ts] of scripts) {
      L.push(`  { let src = fs.readFileSync(${JSON.stringify(f)}, 'utf8');${ts ? " if (strip) src = strip(src, { mode: 'transform' });" : ''} vm.runInThisContext(src, { filename: ${JSON.stringify(f)} }); }`);
    }
  }
  L.push('  let S;', `  try { S = require('./solution.${lang === 'typescript' ? 'cts' : 'cjs'}'); S = (S && S.__bq) || {}; } catch (e) { broken(out, e); return; }`);
  if (q.mode === 'method') {
    const s = q.signature;
    L.push(`  if (missing(out, S, [["f", ${JSON.stringify(s.name)}, ${JSON.stringify(`${s.name}(${s.params.map((p) => p.name).join(', ')})`)}]])) return;`, `  const F = S[${JSON.stringify(s.name)}];`);
  } else {
    L.push(`  if (missing(out, S, [["c", ${JSON.stringify(q.class.name)}, ${JSON.stringify([...new Set(q.class.methods.map((m) => m.name))])}]])) return;`, `  const C = S[${JSON.stringify(q.class.name)}];`);
  }
  L.push('  const tests = [');
  tests.forEach((t, i) => {
    L.push('    () => {');
    if (q.mode === 'method') {
      const s = q.signature;
      const R = jsDesc(s.returns, D);
      if (t.speed) {
        // The arguments are made first; the calls and writing out what came back are timed.
        t.args.forEach((a, k) => L.push(`      const a${k} = ${jsLit(s.params[k].type, a, D)};`));
        L.push('      let r;', '      const t0 = now();', `      for (let c = 0; c < ${t.calls || 1}; c++) r = F(${t.args.map((_, k) => 'a' + k).join(', ')});`,
          `      const v = enc(${R}, r);`, `      timed(out, ${i}, v, now() - t0);`);
      } else {
        L.push(`      ok(out, ${i}, ${R}, F(${t.args.map((a, k) => jsLit(s.params[k].type, a, D)).join(', ')}));`);
      }
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      if (names.length) L.push(`      let ${names.map((n) => 'o_' + n).join(', ')};`);
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`      o_${st.as} = new C(${st.new.map((a, j) => jsLit(C.constructor[j].type, a, D)).join(', ')});`); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => jsLit(m.params[j].type, a, D)).join(', ')})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`      step(out, ${i}, ${k}, ${jsDesc(m.returns, D)}, ${call});`);
        else L.push(`      ${call};`);
      });
      L.push(`      done(out, ${i});`);
    }
    L.push('    },');
  });
  L.push('  ];', '  for (let i = 0; i < tests.length; i++) {', '    try { tests[i](); } catch (e) { fail(out, i, e); }', '  }', '})();', '');
  return L.join('\n');
}
// The last line of the student's file: what the question asks for, handed back to main.cjs.
function jsExport(q) {
  const n = q.mode === 'method' ? q.signature.name : q.class.name;
  return `\n;module.exports.__bq = { ${n}: typeof ${n} === "undefined" ? undefined : ${n} };\n`;
}

// C++: one file that has the standard headers (precompiled), the question's classes and support code, then
// the student's file, then the harness. Each test runs in its own process (bqrt.c), so a crash is only that
// test's. Arguments are locals of the exact types, so vector<int>& and by-value parameters both take them.
const ALARM = (q) => Math.max(1, Math.ceil(q.limits.timeMs / 1000) * 2);
function cppMain(q, tests, marker) {
  const D = q.types;
  const L = ['#include "bqpre.hpp"'];
  if (D) L.push(T.classSource(D, 'cpp'));
  if (q.support && q.support.cpp) L.push(q.support.cpp);
  // Their own main() can stay; a "#define int long long" doesn't reach the harness.
  L.push('#define main bq_student_main', '#include "solution.cpp"', '#undef main', '#ifdef int', '#undef int', '#endif', '#include "bq.hpp"');
  if (D) {
    const names = Object.keys(D);
    L.push('namespace bq {', ...names.map((n) => `void j(W& w, const ${n}* p);`));
    for (const n of names) {
      L.push(`void j(W& w, const ${n}* p) {`, '    if (!p) { w.s += "null"; return; }', '    if (w.d > 400) { w.s += "\\"...\\""; return; }', '    w.d++;');
      D[n].forEach((f, k) => L.push(`    w.s += ${JSON.stringify((k ? ',' : '{') + JSON.stringify(f.name) + ':')};`, `    j(w, p->${f.name});`));
      L.push(`    w.s += "${D[n].length ? '}' : '{}'}";`, '    w.d--;', '}');
    }
    L.push('}  // namespace bq');
  }
  const locals = (params, args, ind) => params.map((p, k) => `${ind}${T.cppType(p.type)} a${k} = ${cppLit(T.canon(p.type), args[k], D)};`);
  const argNames = (n) => Array.from({ length: n }, (_, k) => 'a' + k).join(', ');
  tests.forEach((t, i) => {
    L.push(`static void t${i}(int i) {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(...locals(s.params, t.args, '    '), '    Solution sol;', `    ${T.cppType(s.returns)} r = sol.${s.name}(${argNames(s.params.length)});`,
        '    bq::W w;', '    bq::j(w, r);', '    bq::ok(i, w);');
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      if (names.length) L.push(`    ${names.map((n) => `${C.name}* o_${n} = nullptr;`).join(' ')}`);
      t.steps.forEach((st, k) => {
        if (st.new) { L.push('    {', ...locals(C.constructor, st.new, '        '), `        o_${st.as} = new ${C.name}(${argNames(C.constructor.length)});`, '    }'); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}->${st.call}(${argNames(m.params.length)})`;
        L.push('    {', ...locals(m.params, st.args, '        '));
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        ${T.cppType(m.returns)} r = ${call};`, '        bq::W w;', '        bq::j(w, r);', `        bq::step(i, ${k}, w);`);
        else L.push(`        ${call};`);
        L.push('    }');
      });
      L.push('    bq::done(i);');
    }
    L.push('}');
  });
  L.push(`static void (*const bq_tests[])(int) = {${tests.map((_, i) => 't' + i).join(', ') || 'nullptr'}};`, 'int main() {',
    `    bq_begin(${cStr(marker).lit});`, '    std::remove("bqmain.cpp");', `    for (int i = 0; i < ${tests.length}; i++) {`, '        std::cout.flush();',
    `        if (!bq_test_begin(i, ${ALARM(q)})) continue;`, '        try {', '            bq_tests[i](i);', '        } catch (const std::exception& e) {', '            bq::fail(i, e);',
    '        } catch (const char* e) {', '            bq::fail(i, std::string("Threw ") + e);', '        } catch (const std::string& e) {', '            bq::fail(i, "Threw " + e);',
    '        } catch (...) {', '            bq::fail(i, "Threw something that isn\'t an exception");', '        }', '        bq_test_end();', '    }', '    return 0;', '}', '');
  return L.join('\n');
}

// C: functions only. The question's function is declared first, so a definition that doesn't match it is a
// compile error in their file ("conflicting types"), not a wrong call.
function cMain(q, tests, marker) {
  const D = q.types;
  const s = q.signature;
  const L = ['#include "bqpre.h"'];
  if (q.support && q.support.c) L.push(q.support.c);
  L.push(T.cSignature(s) + ';', '#define main bq_student_main', '#include "solution.c"', '#undef main', '#include "bqc.h"');
  if (D) {
    const names = Object.keys(D);
    L.push(...names.map((n) => `static void bq_w_${n}(bq_w* w, const ${n}* p);`));
    for (const n of names) {
      const fs = D[n];
      L.push(`static ${n}* bq_new_${n}(${fs.map((f) => `${T.cType(f.type)} ${f.name}`).join(', ') || 'void'}) {`, `    ${n}* p = (${n}*)calloc(1, sizeof(${n}));`,
        ...fs.map((f) => `    p->${f.name} = ${f.name};`), '    return p;', '}');
      L.push(`static void bq_w_${n}(bq_w* w, const ${n}* p) {`, '    if (!p) { bq_w_raw(w, "null"); return; }', '    if (w->d > 400) { bq_w_raw(w, "\\"...\\""); return; }', '    w->d++;');
      fs.forEach((f, k) => L.push(`    bq_w_raw(w, ${JSON.stringify((k ? ',' : '{') + JSON.stringify(f.name) + ':')});`, `    ${cWriter(f.type, D)}(w, p->${f.name});`));
      L.push(`    bq_w_raw(w, "${fs.length ? '}' : '{}'}");`, '    w->d--;', '}');
    }
  }
  const ret = T.canon(s.returns);
  const d = T.cDims(ret);
  tests.forEach((t, i) => {
    L.push(`static void t${i}(int i) {`);
    const args = [];
    s.params.forEach((p, k) => args.push(...cArg(p.type, t.args[k], 'a' + k, D, L)));
    if (d) args.push('&rs');
    if (d === 2) args.push('&rcs');
    if (d) L.push('    int rs = -1;');
    if (d === 2) L.push('    int* rcs = NULL;');
    L.push(`    ${T.cType(ret)} r = ${s.name}(${args.join(', ')});`);
    if (d) L.push('    if (!bq_size(i, r, rs)) return;');
    if (d === 2) L.push('    if (rs > 0 && !rcs) { bq_fail(i, "Set *returnColumnSizes to an array of the rows\' lengths"); return; }');
    L.push('    bq_w w = {0};');
    if (!d) L.push(`    ${cWriter(ret, D)}(&w, r);`);
    else if (d === 1) {
      L.push('    bq_w_raw(&w, "[");', `    for (int k = 0; k < rs; k++) { if (k) bq_w_raw(&w, ","); ${cWriter(elementType(ret), D)}(&w, r[k]); }`, '    bq_w_raw(&w, "]");');
    } else {
      L.push('    bq_w_raw(&w, "[");', '    for (int k = 0; k < rs; k++) {', '        if (k) bq_w_raw(&w, ",");',
        '        if (rcs[k] < 0 || (!r[k] && rcs[k] > 0)) { bq_fail(i, "A row\'s length in *returnColumnSizes doesn\'t fit the row"); return; }',
        '        bq_w_raw(&w, "[");', `        for (int c = 0; c < rcs[k]; c++) { if (c) bq_w_raw(&w, ","); ${cWriter(elementType(elementType(ret)), D)}(&w, r[k][c]); }`,
        '        bq_w_raw(&w, "]");', '    }', '    bq_w_raw(&w, "]");');
    }
    L.push('    bq_ok(i, &w);', '}');
  });
  L.push(`static void (*const bq_tests[])(int) = {${tests.map((_, i) => 't' + i).join(', ') || '0'}};`, 'int main(void) {',
    `    bq_begin(${cStr(marker).lit});`, '    remove("bqmain.c");', `    for (int i = 0; i < ${tests.length}; i++) {`,
    `        if (bq_test_begin(i, ${ALARM(q)})) { bq_tests[i](i); bq_test_end(); }`, '    }', '    return 0;', '}', '');
  return L.join('\n');
}

// An argument as JSON for bqh.args: maps carry their keys' types, and objects of declared classes say which
// class they are ({"__obj__": "Point", "f": [1, 2]}). Lists only get wrapped when they hold objects.
const hasClass = (type, D) => !!D && Object.keys(D).some((n) => new RegExp(`\\b${n}\\b`).test(type));
function pyArg(type, x, D) {
  if (x === null || x === undefined || typeof x !== 'object') return x === undefined ? null : x;
  if (isRange(x) && !T.isClass(type, D) && !T.mapTypes(type)) return x;
  if (T.isClass(type, D)) return { __obj__: type, f: D[type].map((f) => pyArg(f.type, x[f.name], D)) };
  const kv = T.mapTypes(type);
  if (kv) return { __map__: Object.entries(x).map(([k, val]) => [kv[0] === 'int' ? Number(k) : k, pyArg(kv[1], val, D)]) };
  if (Array.isArray(x) && hasClass(type, D)) return { __list__: x.map((y) => pyArg(elementType(type), y, D)) };
  return x;
}

// A snippet for "predict the output": Java statements get wrapped in a main method unless the code
// already has one (then the class around main is the program). C and C++ the same, in int main(), with the
// usual headers. Python, JavaScript and TypeScript run as is.
function buildSnippetJob(lang, code) {
  if (lang === 'python') return { language: 'python', files: { 'main.py': code }, main: 'main.py' };
  if (isJs(lang)) { const f = lang === 'typescript' ? 'main.ts' : 'main.js'; return { language: lang, files: { [f]: code }, main: f }; }
  if (isC(lang)) {
    const f = lang === 'cpp' ? 'main.cpp' : 'main.c';
    const body = /\bmain\s*\(/.test(code) ? code : `int main(${lang === 'c' ? 'void' : ''}) {\n${code}\n    return 0;\n}\n`;
    const files = { [f]: body };
    if (lang === 'c') files['bqpre.h'] = C_PRELUDE;
    return { language: lang, files, main: 'main', sources: [f], include: lang === 'c' ? 'bqpre.h' : 'bqpre.hpp' };
  }
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
    if (q.types) files['Given.java'] = T.classSource(q.types, 'java');
    if (q.support && q.support.java) files['Support.java'] = q.support.java;
    // The ban check reads the compiled classes, so only when there's something to check.
    files['BQMain.java'] = javaMain(q, tests, marker, B.bansFor(q.ban, 'java').length ? mine : null, q.types ? 'Given.java' : null);
    return { marker, job: { language: 'java', files, main: 'BQMain' } };
  }
  if (isJs(lang)) {
    const ts = lang === 'typescript';
    files[ts ? 'solution.cts' : 'solution.cjs'] = code + jsExport(q);
    files['bqh.cjs'] = BQJS_SRC;
    if (q.types) files['bqtypes.js'] = T.classSource(q.types, 'javascript');
    if (q.support && q.support[lang]) files[ts ? 'support.ts' : 'support.js'] = q.support[lang];
    files['main.cjs'] = jsMain(q, tests, marker, lang);
    return { marker, job: { language: lang, files, main: 'main.cjs' } };
  }
  if (lang === 'cpp') {
    Object.assign(files, { 'solution.cpp': code, 'bq.hpp': BQCPP_SRC, 'bqrt.c': BQRT_SRC, 'bqmain.cpp': cppMain(q, tests, marker) });
    return { marker, job: { language: 'cpp', files, main: 'main', sources: ['bqmain.cpp', 'bqrt.c'] } };
  }
  if (lang === 'c') {
    Object.assign(files, { 'solution.c': code, 'bqpre.h': C_PRELUDE + (q.types ? '\n' + T.classSource(q.types, 'c') : ''), 'bqc.h': BQC_SRC, 'bqrt.c': BQRT_SRC, 'bqmain.c': cMain(q, tests, marker) });
    return { marker, job: { language: 'c', files, main: 'main', sources: ['bqmain.c', 'bqrt.c'] } };
  }
  files['solution.py'] = code;
  files['bqh.py'] = BQH_SRC;
  files['bqscan.py'] = BQSCAN_SRC;
  if (q.types) files['bqtypes.py'] = T.classSource(q.types, 'python');
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
  const text = String(s || '').replace(/\/jobs\/[^/\s]+\//g, '').replace(/\r/g, '').trim();
  if (!/^BQMain\.java:/m.test(text)) return text.slice(0, 4000);
  const own = text.split(/(?=^\w+\.java:\d+: error: )/m).filter((b) => /^\w+\.java/.test(b) && !b.startsWith('BQMain.java')).join('').trim();
  return [own, explainHarnessErrors(text)].filter(Boolean).join('\n').slice(0, 4000);
}
const cleanPy = (s) => String(s || '').replace(/File "\/jobs\/[^"]+\/(\w+\.py)"/g, 'File "$1"').trim().slice(0, 4000);
const cleanJs = (s) => String(s || '').replace(/(?:file:\/\/)?\/jobs\/[^/\s]+\//g, '').replace(/\bsolution\.cjs\b/g, 'solution.js').replace(/\bsolution\.cts\b/g, 'solution.ts').trim().slice(0, 4000);

// gcc's errors, cut to the ones in the student's file. Errors in the generated test file mean their code
// doesn't have what the question asks for; those are said in plain words, like Java's (explainHarnessErrors).
function cleanCc(text, lang, q) {
  const own = lang === 'cpp' ? 'solution.cpp' : 'solution.c';
  // (gcc quotes with ‘ ’ in a UTF-8 locale)
  const lines = String(text || '').replace(/\/jobs\/[^/\s]+\//g, '').replace(/[\u2018\u2019]/g, "'").replace(/\r/g, '').split('\n');
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

// res = runner response. Returns { status, message?, tests: [{ pass, got?, gotSteps?, error? }], printed }
function readResults(q, lang, tests, res, marker) {
  if (res.status === 'compile_error') return { status: 'compile_error', message: isC(lang) ? cleanCc(res.stderr || res.stdout, lang, q) : cleanJava(res.stderr || res.stdout) };
  if (res.status === 'error') return { status: 'error', message: 'The code runner had a problem. Try again in a moment.' };
  const { records, printed } = splitOutput(res.stdout, marker);
  // The ban check's facts come first, written before any student code ran.
  const scan = records.length && records[0].scan ? records[0].scan : null;
  const compile = records.find((r) => r.compile);
  if (compile) return { status: 'compile_error', message: isJs(lang) ? cleanJs(compile.err) : cleanPy(compile.err), scan };
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

module.exports = { buildJob, readResults, studentView, starterCode, callText, expectedText, same, show, clean, javaType, pyType, buildSnippetJob, cleanCc, cleanJs };
