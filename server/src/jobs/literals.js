'use strict';
// Values written as code in each language: what a test passes to the student's method, and what it expects.

const T = require('../../../public/teacher/types.js');
const { isRange, elementType } = require('../quizfile');

// What every C answer gets without asking (C++'s is in the runner image, precompiled: runner/bqpre.hpp).
const C_PRELUDE = ['stdio.h', 'stdlib.h', 'string.h', 'stdbool.h', 'math.h', 'limits.h', 'ctype.h', 'stdint.h'].map((x) => `#include <${x}>`).join('\n') + '\n';
const { isJs, isC } = T;
const NULL_WORD = { python: 'None', cpp: 'nullptr', c: 'NULL', go: 'nil', rust: 'None' };
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
  if (kv) return `map([${Object.entries(v).map(([k, x]) => `[${kv[0] === 'int' ? Number(k) : JSON.stringify(k)}, ${jsLit(kv[1], x, D)}]`).join(', ')}])`;
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
// Go: a composite literal, typed all the way down. Fields left out of an object are Go's zero values.
function goLit(type, v, D) {
  type = T.canon(type);
  if (v === null || v === undefined) return 'nil';
  if (T.isClass(type, D)) return `&${type}{${D[type].filter((f) => v[f.name] !== undefined && v[f.name] !== null).map((f) => `${f.name}: ${goLit(f.type, v[f.name], D)}`).join(', ')}}`;
  if (isRange(v) && !T.mapTypes(type)) return `${type === 'long[]' ? 'bqRangeL' : 'bqRange'}(${v.range.join(', ')})`;
  switch (type) {
    case 'int': case 'long': case 'boolean': return String(v);
    case 'double': return cDouble(v);
    case 'char': return cChar(v);
    case 'string': return JSON.stringify(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) return `${T.goType(type)}{${Object.entries(v).map(([k, x]) => `${kv[0] === 'int' ? Number(k) : JSON.stringify(k)}: ${goLit(kv[1], x, D)}`).join(', ')}}`;
  return `${T.goType(type)}{${v.map((x) => goLit(elementType(type), x, D)).join(', ')}}`;
}
// Rust: String::from, vec!, HashMap::from, Some(Box::new(Point { ... })); every field written out.
const rsChar = (c) => (c === "'" ? "'\\''" : c === '\\' ? "'\\\\'" : /^[\x20-\x7e]$/.test(c) ? `'${c}'` : `'\\u{${c.codePointAt(0).toString(16)}}'`);
function rsStr(s) {
  let o = '"';
  for (const ch of String(s)) {
    if (ch === '"') o += '\\"';
    else if (ch === '\\') o += '\\\\';
    else if (/^[\x20-\x7e]$/.test(ch)) o += ch;
    else o += `\\u{${ch.codePointAt(0).toString(16)}}`;
  }
  return o + '"';
}
function rsLit(type, v, D) {
  type = T.canon(type);
  if (v === null || v === undefined) return 'None';
  if (T.isClass(type, D)) return `Some(Box::new(${type} { ${D[type].map((f) => `${f.name}: ${rsLit(f.type, fieldValue(f, v), D)}`).join(', ')} }))`;
  if (isRange(v) && !T.mapTypes(type)) return `crate::bq::${type === 'long[]' ? 'range_l' : 'range'}(${v.range.join(', ')})`;
  switch (type) {
    case 'int': case 'boolean': return String(v);
    case 'long': return v + 'i64';
    case 'double': return cDouble(v) + '_f64';
    case 'char': return rsChar(v);
    case 'string': return `String::from(${rsStr(v)})`;
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) {
    const items = Object.entries(v).map(([k, x]) => `(${kv[0] === 'int' ? Number(k) : `String::from(${rsStr(k)})`}, ${rsLit(kv[1], x, D)})`);
    return items.length ? `HashMap::from([${items.join(', ')}])` : 'HashMap::new()';
  }
  return `vec![${v.map((x) => rsLit(elementType(type), x, D)).join(', ')}]`;
}

// C#: new int[] {...}, new List<int> {...}, new Dictionary<string, int> { {"a", 1} }, new Point(1, 2).
const csChar = (c) => (c === "'" ? "'\\''" : c === '\\' ? "'\\\\'" : /^[\x20-\x7e]$/.test(c) ? `'${c}'` : `'\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}'`);
function csLit(type, v, D) {
  type = T.canon(type);
  if (v === null || v === undefined) return 'null';
  if (T.isClass(type, D)) return `new ${type}(${D[type].map((f) => csLit(f.type, fieldValue(f, v), D)).join(', ')})`;
  if (isRange(v) && !T.mapTypes(type)) return `BQ.${type === 'long[]' ? 'RangeL' : type === 'list<int>' ? 'RangeList' : 'Range'}(${v.range.map((x) => x + 'L').join(', ')})`;
  switch (type) {
    case 'int': case 'boolean': return String(v);
    case 'long': return v + 'L';
    case 'double': return cDouble(v);
    case 'char': return csChar(v);
    case 'string': return JSON.stringify(v);
    default: break;
  }
  const kv = T.mapTypes(type);
  if (kv) return `new ${T.csType(type)} {${Object.entries(v).map(([k, x]) => ` {${kv[0] === 'int' ? Number(k) : JSON.stringify(k)}, ${csLit(kv[1], x, D)}}`).join(',')} }`;
  return `new ${T.csType(type)} {${v.map((x) => csLit(elementType(type), x, D)).join(', ')}}`;
}
const C_WRITE = { int: 'bq_w_int', long: 'bq_w_ll', double: 'bq_w_dbl', boolean: 'bq_w_bool', char: 'bq_w_chr', string: 'bq_w_str' };
const cWriter = (t, D) => C_WRITE[T.canon(t)] || `bq_w_${T.canon(t)}`;

module.exports = { C_PRELUDE, NULL_WORD, cArg, cStr, cWriter, charLit, cppLit, csLit, fieldValue, goLit, isC, isJs, javaLit, javaStr, javaType, jsDesc, jsLit, pyType, rsLit, stepMethod };
