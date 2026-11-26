// The quiz maker's text formats: values, types, signatures and tests, written and read back as text.

// In the order the parts usually come in a quiz.
const TYPES = {
  single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', math: 'Math', graph: 'Graph', output: 'Predict the output',
  trace: 'Trace table', fill: 'Fill in the blanks', code: 'Code', essay: 'Written answer',
};
const BLANK = /_{3,}/g;
const countBlanks = (code) => (String(code || '').match(BLANK) || []).length;
const BT = window.BQTypes; // value types, shared with the server (types.js)
const LANGS = BT.LANG_NAMES;

// ---------- text formats ----------
const fmt = (v) => JSON.stringify(v);
// The classes the code question being read declares ({ Point: [{ name, type }] }): set by readCode and
// withUi, which read one question at a time, so the helpers below know Point when they see it.
let curD = null; // the classes of the question being read (model.js sets them with setD while it reads one)
function setD(D) { curD = D; }
// Python spellings outside strings become JSON ones, so True/False/None work too. A declared class
// written as a call, Point(1, 2), becomes {"__new": "Point", "a": [1, 2]} (made an object by build()).
function jsonish(src) {
  let out = '';
  let inStr = false;
  const parens = [];
  const lastSig = () => out.trimEnd().slice(-1);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[++i] || ''; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    // map keys that are numbers: {1: "one"} -> {"1": "one"}
    const key = /^(-?\d+)\s*:/.exec(src.slice(i));
    if (key && (lastSig() === '{' || lastSig() === ',') && /[{,]/.test(lastSig())) {
      out += `"${key[1]}":`;
      i += key[0].length - 1;
      continue;
    }
    // range(0, 1000000) or range(0, 1000000, 2): a big array made when the test runs
    const rng = /^range\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)/.exec(src.slice(i));
    if (rng && !/\w/.test(src[i - 1] || '')) {
      out += JSON.stringify({ range: [Number(rng[1]), Number(rng[2]), Number(rng[3] || 1)] });
      i += rng[0].length - 1;
      continue;
    }
    const ctor = /^([A-Z]\w*)\s*\(/.exec(src.slice(i));
    if (ctor && !/\w/.test(src[i - 1] || '')) {
      out += `{"__new":${JSON.stringify(ctor[1])},"a":[`;
      parens.push(true);
      i += ctor[0].length - 1;
      continue;
    }
    if (c === '(') { parens.push(false); out += c; continue; }
    if (c === ')' && parens.length) { out += parens.pop() ? ']}' : c; continue; }
    const word = /^(True|False|None)\b/.exec(src.slice(i));
    if (word && !/\w/.test(src[i - 1] || '')) {
      out += { True: 'true', False: 'false', None: 'null' }[word[1]];
      i += word[1].length - 1;
      continue;
    }
    out += c;
  }
  return out;
}
// {"__new": "Point", "a": [1, 2]} -> {"x": 1, "y": 2}, by the class's fields in order.
function build(v) {
  if (Array.isArray(v)) return v.map(build);
  if (!v || typeof v !== 'object') return v;
  if (typeof v.__new === 'string' && Array.isArray(v.a)) {
    const fields = curD && curD[v.__new];
    if (!fields) throw new Error(`there's no class ${v.__new} under Classes`);
    if (v.a.length > fields.length) throw new Error(`${v.__new} has ${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.map((f) => f.name).join(', ')}`);
    return Object.fromEntries(fields.map((f, k) => [f.name, k < v.a.length ? build(v.a[k]) : null]).filter(([, x], k) => k < v.a.length || x !== null));
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, build(x)]));
}
function parseValues(inner) {
  let v;
  try { v = JSON.parse('[' + jsonish(inner) + ']'); } catch (e) {
    throw new Error(`can't read (${inner}). Write values like "text", 3, 2.5, true, [1, 2]`);
  }
  return build(v);
}
function parseValue(src) {
  let v;
  try { v = JSON.parse(jsonish(src)); } catch (e) {
    throw new Error(`can't read ${src}. Write values like "text", 3, 2.5, true, [1, 2]`);
  }
  return build(v);
}
// "head(inner) rest": finds the ")" that closes the first "(", skipping strings and brackets.
function splitCall(line) {
  const open = line.indexOf('(');
  if (open < 0) throw new Error('needs (…)');
  let depth = 0;
  let inStr = false;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) {
        if (c !== ')') break;
        return { head: line.slice(0, open).trim(), inner: line.slice(open + 1, i), rest: line.slice(i + 1).trim() };
      }
    }
  }
  throw new Error('the ( … ) doesn\'t close');
}
// "-> value" and "*2" after a call.
function parseRest(rest) {
  const out = { weight: 1 };
  // "speed" or "speed x1000": timed against the reference, calling the method that many times
  const sp = /(?:^|\s)speed(?:\s+x\s*(\d+))?(?=\s|$)/.exec(rest);
  if (sp) {
    out.speed = true;
    out.calls = sp[1] ? Number(sp[1]) : 1;
    rest = (rest.slice(0, sp.index) + rest.slice(sp.index + sp[0].length)).trim();
  }
  const w = /\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(rest);
  if (w) { out.weight = Number(w[1]); rest = rest.slice(0, w.index).trim(); }
  if (!rest) return out;
  if (!rest.startsWith('->')) throw new Error('after the call, write -> and the expected value');
  const v = rest.slice(2).trim();
  if (v === '?') out.check = true;
  else out.expected = parseValue(v);
  return out;
}

// ---------- types ----------
const checkValue = (t, v) => BT.checkValue(t, v, curD);
const elementType = BT.elementType;
// Values written back as text. Doubles keep their ".0" so 100.0 doesn't turn into 100.
const isRange = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.range);
const RANGE_TYPES = ['int[]', 'long[]', 'list<int>'];
function show(type, v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && BT.isClass(type, curD)) {
    const fs = curD[type];
    let n = fs.length; // trailing nulls left off: Node(3) for Node(3, None)
    while (n > 0 && (v[fs[n - 1].name] === undefined || v[fs[n - 1].name] === null)) n--;
    return `${type}(${fs.slice(0, n).map((f) => show(f.type, v[f.name] === undefined ? null : v[f.name])).join(', ')})`;
  }
  const kv = type ? BT.mapTypes(type) : null;
  if (isRange(v) && !kv) return `range(${v.range[0]}, ${v.range[1]}${v.range[2] && v.range[2] !== 1 ? ', ' + v.range[2] : ''})`;
  if (type === 'double' && Number.isInteger(v)) return v.toFixed(1);
  if (kv && v && typeof v === 'object' && !Array.isArray(v)) {
    return `{${Object.entries(v).map(([k, x]) => `${kv[0] === 'int' ? k : fmt(k)}: ${show(kv[1], x)}`).join(', ')}}`;
  }
  if (Array.isArray(v) && type && BT.isValueType(type, curD) && elementType(type)) return `[${v.map((x) => show(elementType(type), x)).join(', ')}]`;
  return fmt(v);
}
// A range only stands in for int[], long[] and list<int>; anything else must be a real value.
const argOk = (type, a) => (isRange(a) && RANGE_TYPES.includes(type)) || checkValue(type, a);
const argProblem = (type, a) => (isRange(a) && !BT.mapTypes(type) ? `range only works for ${RANGE_TYPES.join(', ')}` : `${fmt(a)} isn't ${an(type)}`);
const showArgs = (params, args) => (args || []).map((a, i) => show(params && params[i] ? params[i].type : '', a)).join(', ');

// ---------- signatures ----------
function parseSig(text) {
  const m = /^\s*([A-Za-z_]\w*)?\s*\(([^)]*)\)\s*(?::\s*(\S.*?))?\s*$/.exec(text || '');
  if (!m) throw new Error('write it like countVowels(s: string): int');
  const seen = new Set();
  // commas inside map<string, int> don't separate parameters
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of m[2]) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim() || parts.length) parts.push(cur);
  const params = parts.map((p) => {
    const pm = /^\s*([A-Za-z_]\w*)\s*:\s*(\S.*?)\s*$/.exec(p);
    if (!pm) throw new Error(`"${p.trim()}" should be name: type`);
    const type = BT.canon(pm[2]);
    if (!BT.isValueType(type, curD)) throw new Error(`${pm[2]} isn't a type. Use ${BT.HELP}`);
    if (seen.has(pm[1])) throw new Error(`two parameters are named ${pm[1]}`);
    seen.add(pm[1]);
    return { name: pm[1], type };
  });
  return { name: m[1] || '', params, returns: m[3] ? BT.canon(m[3]) : '' };
}
// Classes, one per line: Node(val: int, next: Node). -> { Node: [{ name, type }] }, or null for none.
function parseClasses(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const names = lines.map((l) => (/^([A-Za-z_]\w*)\s*\(/.exec(l) || [])[1]);
  const D = Object.fromEntries(names.filter(Boolean).map((n) => [n, []]));
  const was = curD;
  setD(D); // a class's fields can be any of them, itself included
  try {
    lines.forEach((l, i) => {
      if (!names[i] || !BT.CLASS.test(names[i])) throw new Error(`line ${i + 1}: write it like Point(x: int, y: int), the name starting with a capital letter`);
      let s;
      try { s = parseSig(l); } catch (e) { throw new Error(`line ${i + 1}: ${e.message.replace('countVowels(s: string): int', 'Point(x: int, y: int)')}`); }
      if (s.returns) throw new Error(`line ${i + 1}: a class has fields, not a return type`);
      D[s.name] = s.params;
    });
  } finally { setD(was); }
  if (names.length !== new Set(names).size) throw new Error('two classes have the same name');
  return D;
}
const classesText = (D) => Object.entries(D || {}).map(([n, fs]) => sigText(n, fs, '')).join('\n');
const classesJson = (D) => Object.fromEntries(Object.entries(D).map(([n, fs]) => [n, Object.fromEntries(fs.map((f) => [f.name, f.type]))]));
const sigText = (name, params, returns) => `${name || ''}(${(params || []).map((p) => `${p.name}: ${p.type}`).join(', ')})${returns ? `: ${returns}` : ''}`;
function fullSig(text, allowVoid) {
  const s = parseSig(text);
  if (!s.name || !s.returns) throw new Error(`write it like ${allowVoid ? 'deposit(amount: double): void' : 'countVowels(s: string): int'}`);
  if (!BT.isValueType(s.returns, curD) && !(allowVoid && s.returns === 'void')) throw new Error(`${s.returns} isn't a type. Use ${BT.HELP}${allowVoid ? ', or void' : ''}`);
  return s;
}

// ---------- tests as text ----------
function methodTestsText(tests, sig) {
  return (tests || []).map((t) => `(${showArgs(sig.params, t.args)})${t.expected !== undefined ? ' -> ' + show(sig.returns, t.expected) : ''}${t.speed ? ' speed' + (t.calls > 1 ? ' x' + t.calls : '') : ''}${t.weight && t.weight !== 1 ? ' *' + t.weight : ''}`).join('\n');
}
// -> { tests, at: where each test is, errors }
function parseMethodTests(text) {
  const out = { tests: [], at: [], errors: [] };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const c = splitCall(line);
      const t = { args: parseValues(c.inner) };
      const r = parseRest(c.rest);
      if (r.expected !== undefined) t.expected = r.expected;
      if (r.weight !== 1) t.weight = r.weight;
      if (r.speed) { t.speed = true; if (r.calls > 1) t.calls = r.calls; }
      out.tests.push(t);
      out.at.push(`line ${i + 1}`);
    } catch (e) { out.errors.push(`line ${i + 1}: ${e.message}`); }
  });
  return out;
}
const an = (type) => `${/^int/.test(type) ? 'an' : 'a'} ${type}`;
function checkMethodTests(p, sig, hasRef) {
  const need = sig.params.length;
  p.tests.forEach((t, i) => {
    const bad = (msg) => p.errors.push(`${p.at[i]}: ${msg}`);
    if (t.args.length !== need) return bad(`needs ${need} value${need === 1 ? '' : 's'} in the ( ), one for each parameter`);
    const k = t.args.findIndex((a, j) => !argOk(sig.params[j].type, a));
    if (k >= 0) return bad(argProblem(sig.params[k].type, t.args[k]));
    if (t.speed && !hasRef) return bad('speed tests are timed against the reference solution, so write one');
    if (t.expected === undefined) { if (!hasRef) bad('add -> and the expected value, or write a reference solution'); return undefined; }
    if (!checkValue(sig.returns, t.expected)) bad(`${fmt(t.expected)} isn't ${an(sig.returns)}`);
    return undefined;
  });
}

function classTestsText(tests, C) {
  return (tests || []).map((t) => {
    const objs = new Set(t.steps.filter((s) => s.new).map((s) => s.as));
    const many = objs.size > 1 || [...objs].some((o) => o !== 'a');
    const lines = t.steps.map((s) => {
      if (s.new) return `${many ? s.as + ' = ' : ''}new ${C.name}(${showArgs(C.constructor, s.new)})`;
      const m = (C.methods || []).find((x) => x.name === s.call) || {};
      return `${many ? s.on + '.' : ''}${s.call}(${showArgs(m.params, s.args)})${s.expect !== undefined ? ' -> ' + show(m.returns, s.expect) : s.check ? ' -> ?' : ''}`;
    });
    if (t.weight && t.weight !== 1) lines.push('*' + t.weight);
    return lines.join('\n');
  }).join('\n\n');
}
function parseClassTests(text) {
  const out = { tests: [], at: [], errors: [] };
  text.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean).forEach((block, bi) => {
    const t = { steps: [] };
    const lines = [];
    let ok = true;
    block.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      try {
        const w = /^\*\s*(\d+(?:\.\d+)?)$/.exec(line);
        if (w) { t.weight = Number(w[1]); return; }
        const nw = /^(?:([A-Za-z_]\w*)\s*=\s*)?new\s+[A-Za-z_]\w*\s*\(/.exec(line);
        const c = splitCall(line);
        if (nw) {
          if (c.rest) throw new Error('nothing goes after new …(…)');
          const step = { new: parseValues(c.inner) };
          if (nw[1]) step.as = nw[1];
          t.steps.push(step);
          lines.push(line);
          return;
        }
        const hm = /^(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)$/.exec(c.head);
        if (!hm) throw new Error('write a method call like getBalance() or a.getBalance()');
        const step = { call: hm[2], args: parseValues(c.inner) };
        if (hm[1]) step.on = hm[1];
        const r = parseRest(c.rest);
        if (r.weight !== 1) throw new Error('put *' + r.weight + ' on its own line');
        if (r.speed) throw new Error('speed tests only work when students write a method');
        if (r.check) step.check = true;
        else if (r.expected !== undefined) step.expect = r.expected;
        t.steps.push(step);
        lines.push(line);
      } catch (e) { ok = false; out.errors.push(`test ${bi + 1}, ${line}: ${e.message}`); }
    });
    if (!ok) return;
    if (!t.steps.length) { out.errors.push(`test ${bi + 1}: needs steps`); return; }
    out.tests.push(t);
    out.at.push(lines.map((l) => `test ${bi + 1}, ${l}`));
  });
  return out;
}
function checkClassTests(p, C, hasRef) {
  const argsOk = (params, args, bad) => {
    if (args.length !== params.length) { bad(`needs ${params.length} value${params.length === 1 ? '' : 's'} in the ( )`); return; }
    const k = args.findIndex((a, j) => !argOk(params[j].type, a));
    if (k >= 0) bad(argProblem(params[k].type, args[k]));
  };
  const fits = (params, args) => args.length === params.length && args.every((a, j) => argOk(params[j].type, a));
  p.tests.forEach((t, i) => {
    const objects = new Set();
    let last = null;
    t.steps.forEach((s, k) => {
      const bad = (msg) => p.errors.push(`${p.at[i][k]}: ${msg}`);
      if (s.new) { last = s.as || 'a'; objects.add(last); argsOk(C.constructor, s.new, bad); return; }
      // overloads: the first method of that name whose parameters fit
      const named = C.methods.filter((x) => x.name === s.call);
      if (!named.length) { bad(`${s.call} isn't one of the methods`); return; }
      const m = named.find((x) => fits(x.params, s.args)) || named[0];
      if (named.length > 1 && !fits(m.params, s.args)) { bad(`no ${s.call} method takes these values`); return; }
      const on = s.on || last;
      if (!on) { bad(`start the test with new ${C.name}(…)`); return; }
      if (!objects.has(on)) { bad(`there's no object named ${on}`); return; }
      argsOk(m.params, s.args, bad);
      if (m.returns === 'void') { if (s.expect !== undefined || s.check) bad(`${m.name} returns nothing, so it can't have ->`); return; }
      if (s.expect !== undefined && !checkValue(m.returns, s.expect)) bad(`${fmt(s.expect)} isn't ${an(m.returns)}`);
      if (s.check && !hasRef) bad('-> ? needs a reference solution');
    });
  });
}

export { BLANK, BT, LANGS, TYPES, checkClassTests, checkMethodTests, classTestsText, classesJson, classesText, countBlanks, curD, fullSig, methodTestsText, parseClassTests, parseClasses, parseMethodTests, parseSig, setD, sigText };
