'use strict';
// What students see of a test: its call and expected value, written the way their language writes them, and
// the code they start with.

const { rangeLength, isRange, elementType } = require('../quizfile');
const T = require('../../../public/teacher/types.js');
const { NULL_WORD, charLit, fieldValue, isC, isJs, stepMethod } = require('./literals');

// ---------- what students see ----------
// A range shows its first few numbers and its last: {0, 1, 2, ..., 9999999}.
// Java arrays and everything in C and C++ are written in braces; lists and the rest in brackets.
const braces = (type, lang) => (lang === 'java' && type.endsWith('[]')) || isC(lang);
function showRange(type, v, lang) {
  const [a, , s] = v.range;
  const n = rangeLength(v.range);
  const items = n <= 6 ? Array.from({ length: n }, (_, k) => a + k * s) : [a, a + s, a + 2 * s, '...', a + (n - 1) * s];
  const inner = items.join(', ');
  if (lang === 'go') return `${T.goType(type)}{${inner}}`;
  if (lang === 'rust') return `vec![${inner}]`;
  return braces(type, lang) ? `{${inner}}` : `[${inner}]`;
}
function show(type, v, lang, D) {
  if (v === null || v === undefined) return NULL_WORD[lang] || 'null';
  if (T.isClass(type, D) && v && typeof v === 'object') {
    const args = D[type].map((f) => show(f.type, fieldValue(f, v), lang, D)).join(', ');
    if (lang === 'go') return `&${type}{${D[type].map((f) => `${f.name}: ${show(f.type, fieldValue(f, v), lang, D)}`).join(', ')}}`;
    if (lang === 'rust') return `Some(${type} { ${D[type].map((f) => `${f.name}: ${show(f.type, fieldValue(f, v), lang, D)}`).join(', ')} })`;
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
    if (lang === 'go') return `${T.goType(type)}{${items.map(([a, b]) => `${a}: ${b}`).join(', ')}}`;
    if (lang === 'rust') return `HashMap::from([${items.map(([a, b]) => `(${a}, ${b})`).join(', ')}])`;
    if (lang === 'csharp') return `{ ${items.map(([a, b]) => `[${a}] = ${b}`).join(', ')} }`;
    return `Map.of(${items.map(([a, b]) => `${a}, ${b}`).join(', ')})`;
  }
  if (!Array.isArray(v)) return JSON.stringify(v);
  const inner = v.map((x) => show(elementType(type), x, lang, D)).join(', ');
  if (lang === 'go') return `${T.goType(type)}{${inner}}`;
  if (lang === 'rust') return `vec![${inner}]`;
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
      if (lang === 'go') return `${s.as} := New${C.name}(${args})`;
      if (lang === 'csharp') return `var ${s.as} = new ${C.name}(${args});`;
      if (lang === 'rust') return `let mut ${s.as} = ${C.name}::new(${args});`;
      return `${s.as} = ${C.name}(${args})`;
    }
    const m = stepMethod(C, s);
    const args = s.args.map((a, i) => show(m.params[i].type, a, lang, q.types)).join(', ');
    return lang === 'python' || lang === 'go' ? `${s.on}.${s.call}(${args})` : `${s.on}${lang === 'cpp' ? '->' : '.'}${s.call}(${args});`;
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

module.exports = { callText, expectedText, show, showGot, starterCode };
