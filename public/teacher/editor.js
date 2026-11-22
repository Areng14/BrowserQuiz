// Quiz maker: build or edit a quiz in the dashboard. Saves the same quiz.json an uploaded .quiz has.
// Left: every question in order, grouped into the parts students get. Right: the one being edited,
// next to what the student will see. Code questions use short text formats instead of piles of fields:
//   signature  countVowels(s: string): int
//   method test  ("hello") -> 2        class test  a = new BankAccount("Ava", 100.0) / a.getBalance() -> 100.0
(function () {
  'use strict';
  // In the order the parts usually come in a quiz.
  const TYPES = {
    single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', output: 'Predict the output',
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
  let curD = null;
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
    curD = D; // a class's fields can be any of them, itself included
    try {
      lines.forEach((l, i) => {
        if (!names[i] || !BT.CLASS.test(names[i])) throw new Error(`line ${i + 1}: write it like Point(x: int, y: int), the name starting with a capital letter`);
        let s;
        try { s = parseSig(l); } catch (e) { throw new Error(`line ${i + 1}: ${e.message.replace('countVowels(s: string): int', 'Point(x: int, y: int)')}`); }
        if (s.returns) throw new Error(`line ${i + 1}: a class has fields, not a return type`);
        D[s.name] = s.params;
      });
    } finally { curD = was; }
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

  // ---------- what students start with (types.js, as the server) ----------
  const starterCode = (shape, lang, emptyClass) => BT.starter(shape, lang, emptyClass);

  // ---------- questions ----------
  function blank(type, keep) {
    const points = { multi: 2, trace: 3, fill: 2, code: 6, essay: 3 };
    const q = { id: keep.id, type, prompt: keep.prompt || '', points: keep.points || points[type] || 1 };
    if (keep.image) { q.image = keep.image; if (keep.imageAlt) q.imageAlt = keep.imageAlt; }
    if (keep.shared) q.shared = keep.shared;
    if (type === 'single') Object.assign(q, { choices: ['', '', '', ''], answer: null });
    if (type === 'multi') Object.assign(q, { choices: ['', '', '', ''], answer: [] });
    if (type === 'text') q.answer = [''];
    if (type === 'output' || type === 'trace' || type === 'fill') {
      q.code = typeof keep.code === 'string' ? keep.code : '';
      if (keep.language) q.language = keep.language;
    }
    if (type === 'trace') Object.assign(q, { columns: ['', ''], rows: [['', ''], ['', ''], ['', '']], given: [] });
    if (type === 'fill') q.answer = Array(countBlanks(q.code)).fill('');
    if (type === 'essay') q.rubric = [];
    if (type === 'code') {
      Object.assign(q, { mode: keep.mode || 'method', languages: keep.languages || ['java'], tests: { sample: [], hidden: [] }, reference: {} });
      if (q.mode === 'class') q.class = { name: '', constructor: [], methods: [] };
    }
    return withUi(q);
  }
  // The languages a question gets reference boxes and rubric patterns for: its languages, or with "any",
  // the ones it has a reference in, or was given a box for (Java to start with).
  function refLangsOf(q) {
    if (!q.languagesAny) return q.languages;
    const want = new Set([...(q._ui && q._ui.refLangs) || [], ...Object.keys(q.reference || {}).filter((l) => (q.reference[l] || '').trim())]);
    if (!want.size) want.add('java');
    return Object.keys(LANGS).filter((l) => want.has(l));
  }
  // Fields that are edited as text, or in a shape of their own, live in q._ui and are read back on save.
  function withUi(q) {
    const u = {};
    if (q.languages === 'any') { q.languagesAny = true; q.languages = Object.keys(LANGS); }
    if (q.type === 'code' || q.type === 'fill') {
      const C = q.class || { name: '', constructor: [], methods: [] };
      const S = q.signature;
      const T = q.tests || { sample: [], hidden: [] };
      // From quiz.json ({ Point: { x: 'int' } }) or the server ({ Point: [{ name, type }] }).
      curD = q.types ? Object.fromEntries(Object.entries(q.types).map(([n, fs]) => [n, Array.isArray(fs) ? fs : Object.entries(fs).map(([name, type]) => ({ name, type }))])) : null;
      u.types = classesText(curD);
      Object.assign(u, {
        sig: S ? sigText(S.name, S.params, S.returns) : '',
        className: C.name,
        ctor: C.constructor && C.constructor.length ? sigText('', C.constructor, '') : '',
        methods: (C.methods || []).map((m) => sigText(m.name, m.params, m.returns)).join('\n'),
        sample: q.mode === 'class' ? classTestsText(T.sample, C) : S ? methodTestsText(T.sample, S) : '',
        hidden: q.mode === 'class' ? classTestsText(T.hidden, C) : S ? methodTestsText(T.hidden, S) : '',
      });
    }
    if (q.type === 'fill') {
      u.run = !!q.tests; // graded by running the tests
      u.blanks = (q.answer || []).map((a) => [].concat(a).join('\n')); // accepted answers, one per line
    }
    if (q.type === 'output') u.auto = q.answer; // the output the server worked out, as opposed to one typed here
    if (q.type === 'trace') {
      const given = new Set((q.given || []).map((g) => g.join(',')));
      u.cols = (q.columns || []).map(String);
      u.cells = (q.rows || []).map((row, r) => row.map((v, c) => ({ v: String(v), given: given.has(`${r},${c}`) })));
    }
    if (q.type === 'code' || q.type === 'fill' || q.type === 'output' || q.type === 'trace') q._ui = u;
    return q;
  }
  // Keeps each blank's answers with its blank when the code around them is edited.
  function realign(oldCode, newCode, old) {
    const n = countBlanks(newCode);
    const max = Math.min(oldCode.length, newCode.length);
    let p = 0;
    while (p < max && oldCode[p] === newCode[p]) p++;
    let e = 0;
    while (e < max - p && oldCode[oldCode.length - 1 - e] === newCode[newCode.length - 1 - e]) e++;
    const head = Math.min(countBlanks(newCode.slice(0, p)), n, old.length);
    const tail = Math.min(countBlanks(newCode.slice(newCode.length - e)), n - head, old.length - head);
    const was = old.slice(head, old.length - tail);
    const mid = Array.from({ length: n - head - tail }, (_, i) => (was.length === n - head - tail ? was[i] : ''));
    return [...old.slice(0, head), ...mid, ...old.slice(old.length - tail, tail ? undefined : old.length - tail)];
  }
  // A trace table as it will be saved: empty rows left out.
  function readTrace(q) {
    const u = q._ui;
    const rows = u.cells.filter((row) => row.some((c) => c.v.trim()));
    const given = [];
    rows.forEach((row, r) => row.forEach((c, k) => { if (c.given) given.push([r, k]); }));
    return { columns: u.cols.map((c) => c.trim()), rows: rows.map((row) => row.map((c) => c.v.trim())), given };
  }

  // Everything the text fields of a code question say, with what's wrong in them.
  function readCode(q) {
    const u = q._ui;
    const isClass = q.mode === 'class';
    const hasRef = q.type === 'fill' || q.languages.some((l) => ((q.reference || {})[l] || '').trim()); // a fill question's answers are its reference
    const r = { shape: null, shapeErrors: [], sample: null, hidden: null, problems: [], types: null };
    curD = null;
    try { r.types = parseClasses(u.types); curD = r.types; } catch (e) { r.shapeErrors.push(`Classes: ${e.message}`); }
    try {
      if (isClass) {
        const name = u.className.trim();
        if (!/^[A-Z]\w*$/.test(name)) throw new Error('Class name: one word that starts with a capital letter');
        let ctor;
        try { ctor = parseSig(u.ctor.trim() ? u.ctor : '()').params; } catch (e) { throw new Error(`Constructor: ${e.message.replace('countVowels(s: string): int', '(owner: string, balance: double)')}`); }
        // Two methods can share a name (overloads) only in Java and C++.
        const seen = new Set();
        const noOverloads = q.languagesAny ? [] : q.languages.filter((l) => ['python', 'go', 'rust'].includes(l) || BT.isJs(l));
        const methods = u.methods.split('\n').filter((l) => l.trim()).map((l, i) => {
          let m;
          try { m = fullSig(l, true); } catch (e) { throw new Error(`Methods, line ${i + 1}: ${e.message}`); }
          const key = `${m.name}(${m.params.map((x) => x.type).join(',')})`;
          if (seen.has(key)) throw new Error(`Methods: ${key} is listed twice`);
          if ([...seen].some((k) => k.startsWith(m.name + '(')) && noOverloads.length) throw new Error(`Methods: two methods are named ${m.name}. ${noOverloads.map((l) => LANGS[l]).join(' and ')} can't have that`);
          seen.add(key);
          return m;
        });
        r.shape = { class: { name, constructor: ctor, methods } };
      } else {
        try { r.shape = { signature: fullSig(u.sig, false) }; } catch (e) { throw new Error(`Signature: ${e.message}`); }
      }
    } catch (e) { r.shapeErrors.push(e.message); }
    for (const kind of ['sample', 'hidden']) {
      const p = isClass ? parseClassTests(u[kind]) : parseMethodTests(u[kind]);
      if (r.shape) { if (isClass) checkClassTests(p, r.shape.class, hasRef); else checkMethodTests(p, r.shape.signature, hasRef); }
      const n = (e) => Number(/\d+/.exec(e)[0]);
      p.errors.sort((a, b) => n(a) - n(b)); // in the order they're written
      r[kind] = p;
    }
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    r.problems.push(...r.shapeErrors,
      ...r.sample.errors.map((e) => `Sample tests, ${e}`), ...r.hidden.errors.map((e) => `Hidden tests, ${e}`));
    if (!r.hidden.tests.length && !r.hidden.errors.length) r.problems.push('Add a hidden test.');
    if (r.sample.tests.length > 10) r.problems.push('At most 10 sample tests.');
    if (r.hidden.tests.length > 100) r.problems.push('At most 100 hidden tests.');
    const rubric = (q.rubric || []).filter((x) => x.text.trim()).reduce((s, x) => s + (Number(x.points) || 0), 0);
    if (rubric >= Number(q.points)) r.problems.push('Rubric points must add up to less than the question\'s points.');
    (q.rubric || []).forEach((x, k) => {
      for (const v of [x.require, x.forbid]) {
        for (const p of typeof v === 'string' ? [v] : Object.values(v || {})) {
          try { new RegExp(p, 'm'); } catch (e) { r.problems.push(`Rubric item ${k + 1}: the regex isn't valid (${e.message}).`); return; }
        }
      }
    });
    r.rubric = rubric;
    r.problems = r.problems.map(cap);
    return r;
  }

  // quiz.json from the editor. Call it once every question is free of problems.
  function collect(quiz) {
    const out = Object.assign({}, quiz, { questions: [] });
    out.sections = (quiz.sections || []).filter((d) => quiz.questions[d.at])
      .map((d) => ({ before: quiz.questions[d.at].id, title: (d.title || '').trim(), directions: (d.directions || '').trim() }));
    if (!out.sections.length) delete out.sections;
    // Shared material that no question uses is left out.
    const used = new Set(quiz.questions.flatMap((q) => [].concat(q.shared || [])));
    out.shared = (quiz.shared || []).filter((m) => used.has(m.id)).map((m) => {
      const o = { id: m.id, title: (m.title || '').trim(), text: m.text || '' };
      if (m.image) { o.image = m.image; if (m.imageAlt) o.imageAlt = m.imageAlt; }
      return o;
    });
    if (!out.shared.length) delete out.shared;
    for (const q of quiz.questions) {
      const o = Object.assign({}, q);
      delete o._ui;
      delete o.languagesAny;
      if (q.languagesAny) o.languages = 'any';
      if (q.type === 'text') o.answer = q.answer.map((a) => a.trim()).filter(Boolean);
      if (q.type === 'single' || q.type === 'multi') { // empty rows are left out
        const keep = q.choices.map((c, k) => k).filter((k) => q.choices[k].trim());
        o.choices = keep.map((k) => q.choices[k].trim());
        o.answer = q.type === 'multi' ? q.answer.map((x) => keep.indexOf(x)).filter((x) => x >= 0).sort((x, y) => x - y) : keep.indexOf(q.answer);
      }
      // A pattern is one string when every language uses the same one, else { java, python }.
      const pattern = (v) => {
        if (typeof v === 'string') return v.trim() || undefined;
        if (!v || typeof v !== 'object') return undefined;
        const langs = refLangsOf(q);
        const e = langs.map((l) => [l, String(v[l] || '').trim()]).filter(([, p]) => p);
        if (!e.length) return undefined;
        return !q.languagesAny && e.length === langs.length && new Set(e.map(([, p]) => p)).size === 1 ? e[0][1] : Object.fromEntries(e);
      };
      const rubric = (checks) => (q.rubric || []).filter((x) => x.text.trim()).map((x, k) => {
        const item = { id: x.id || `r${k + 1}`, text: x.text.trim(), points: Number(x.points) || 0 };
        if (checks) {
          const require = pattern(x.require);
          const forbid = pattern(x.forbid);
          if (require) item.require = require;
          if (forbid) item.forbid = forbid;
        }
        return item;
      });
      if (q.type === 'output' && !(q.answer || '').trim()) delete o.answer; // worked out by running the code
      if (q.type === 'trace') {
        Object.assign(o, readTrace(q));
        if (!(q.code || '').trim()) delete o.code;
      }
      if (q.type === 'fill') {
        o.answer = q._ui.blanks.map((b) => { const list = b.split('\n').map((x) => x.trim()).filter(Boolean); return list.length === 1 ? list[0] : list; });
        for (const k of ['signature', 'class', 'tests', 'mode', 'languages', 'reference']) delete o[k];
        if (!q._ui.run) { delete o.compare; delete o.rubric; }
      }
      if (q.type === 'essay') {
        if (!q.language) delete o.language;
        o.rubric = rubric(false);
      }
      if (q.type === 'code' || (q.type === 'fill' && q._ui.run)) {
        const r = readCode(q);
        delete o.signature;
        delete o.class;
        Object.assign(o, r.shape);
        delete o.types;
        if (r.types) o.types = classesJson(r.types);
        o.mode = q.mode === 'class' ? 'class' : 'method';
        o.tests = { sample: r.sample.tests, hidden: r.hidden.tests };
      }
      if (q.type === 'code') {
        o.reference = Object.fromEntries(Object.entries(q.reference || {}).filter(([l, v]) => q.languages.includes(l) && v.trim()));
        o.rubric = rubric(true);
      }
      out.questions.push(o);
    }
    return out;
  }

  // "Question 4.tests.hidden[1]: …" from the server, in plainer words.
  function plainer(msg) {
    return msg
      .replace(/^\.?tests\.(sample|hidden)\[(\d+)\](?:\.steps\[(\d+)\])?/, (m, kind, i, k) => `${kind} test ${Number(i) + 1}${k ? `, step ${Number(k) + 1}` : ''}`)
      .replace(/^\.(signature|class)\b[\w.[\]]*/, (m, w) => w)
      .replace(/^./, (c) => c.toUpperCase());
  }

  // ---------- small text-editing helpers ----------
  // Typed through the browser so Ctrl+Z still works.
  function insert(el, text) {
    el.focus();
    if (document.execCommand && document.execCommand('insertText', false, text)) return;
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function wrap(el, before, after) {
    const s = el.selectionStart;
    const text = el.value.slice(s, el.selectionEnd);
    insert(el, before + text + after);
    el.setSelectionRange(s + before.length, s + before.length + text.length);
  }
  function grow(el) {
    if (!el.isConnected) return;
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2 + (el.scrollWidth > el.clientWidth ? 16 : 0)}px`; // room for a sideways scrollbar
    if (window.scrollY !== y) window.scrollTo(0, y);
  }
  // Tab indents, Shift+Tab outdents, Enter keeps the indent. Esc, then Tab (or Shift+Tab), moves on.
  function codeKeys(el) {
    let leave = false;
    el.setAttribute('aria-description', 'Tab indents. Esc, then Tab, moves on.');
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { leave = true; return; }
      if (e.key === 'Tab' && leave) { leave = false; return; } // the browser moves focus as usual
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) leave = false;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const v = el.value;
      const s = el.selectionStart;
      const end = el.selectionEnd;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (s === end && !e.shiftKey) { insert(el, '    '); return; }
        const block = v.slice(ls, end);
        const out = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
        if (out === block) return;
        el.setSelectionRange(ls, end);
        insert(el, out);
        if (s === end) { const at = Math.max(ls, s - (block.length - out.length)); el.setSelectionRange(at, at); } else el.setSelectionRange(ls, ls + out.length);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const line = v.slice(ls, s);
        const indent = /^ */.exec(line)[0] + (/[{:]\s*$/.test(line) ? '    ' : '');
        if (!indent) return;
        e.preventDefault();
        insert(el, '\n' + indent);
      }
    });
  }
  // Drag rows to reorder. With handleOf, a row only drags by its handle, so text in it still selects.
  function sortable(rows, onMove, handleOf) {
    let from = -1;
    const clear = () => rows.forEach((r) => r.classList.remove('qe-drop-before', 'qe-drop-after', 'qe-dragging'));
    const after = (row, e) => { const r = row.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
    rows.forEach((row, i) => {
      const handle = handleOf && handleOf(row);
      if (handle) handle.addEventListener('mousedown', () => { row.draggable = true; }); else row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        from = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i + 1));
        row.classList.add('qe-dragging');
      });
      row.addEventListener('dragend', () => { from = -1; clear(); if (handle) row.draggable = false; });
      row.addEventListener('dragover', (e) => {
        if (from < 0) return;
        e.preventDefault();
        const a = after(row, e);
        rows.forEach((r) => r.classList.remove('qe-drop-before', 'qe-drop-after'));
        row.classList.add(a ? 'qe-drop-after' : 'qe-drop-before');
      });
      row.addEventListener('drop', (e) => {
        if (from < 0) return;
        e.preventDefault();
        let to = i + (after(row, e) ? 1 : 0);
        if (from < to) to--;
        const f = from;
        from = -1;
        clear();
        if (to !== f) onMove(f, to);
      });
    });
  }
  const snippet = (md) => String(md || '').replace(/```[\w+#-]*/g, ' ').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

  // ---------- the editor ----------
  const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  const extOf = (p) => (String(p).match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  const MOD = /Mac|iP(hone|ad)/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
  const ALT = MOD === '⌘' ? '⌥' : 'Alt+';

  // preset: { quiz, missing } from a pasted quiz.json, loaded into this editor unsaved.
  async function showQuizEditor(id, preset) {
    const { h, api, post, mount, bar, showHome, plural, icon, ICONS } = window.BQT;
    let quiz;
    let currentId = id;
    let existingAssets = new Set(); // images already stored with the quiz being edited
    let assetQuizId = id;
    let newAssets = {}; // assets/<name> -> base64, added here and sent on save
    if (id) {
      let src;
      try { src = await api(`/api/t/quizzes/${encodeURIComponent(id)}/source`); } catch (e) { return; }
      quiz = src.quiz;
      existingAssets = new Set(src.assets);
    }
    if (preset) quiz = preset.quiz;
    if (!quiz) quiz = { format: 1, title: '', timeLimitMin: 20, language: 'java', shuffleQuestions: true, shuffleChoices: true, integrity: { graceStrikes: 1 }, questions: [] };
    quiz.questions.forEach(withUi);
    // Section dividers: here each sits at a place in the list (before question number at+1), so moving a question
    // across one moves it into that section. Saved as the id of the question each starts at (collect).
    quiz.sections = (quiz.sections || []).map((sec) => ({ at: quiz.questions.findIndex((q) => q.id === sec.before), title: sec.title || '', directions: sec.directions || '' }))
      .filter((d) => d.at >= 0).sort((a, b) => a.at - b.at);

    let sel = quiz.questions.length ? 0 : -1; // -1 is Settings
    let selDiv = null; // the section divider that's open, if any
    let dirty = !!preset;
    let edits = 0;
    let saving = false;
    let tried = false; // Save was pressed with problems left: show them
    let removed = null; // the last deleted question, for Undo
    let paneTick = null; // repaints the live parts of the open question
    let problems = [];
    const fromServer = new WeakMap(); // question -> what the server said about it
    const imageMissing = (p) => !newAssets[p] && !existingAssets.has(p);
    // The images written into text as Markdown: prompts, choices, shared material and directions.
    const markdownImages = (qz) => {
      const texts = [];
      for (const q of qz.questions || []) texts.push(q.prompt, q.explanation, ...(Array.isArray(q.choices) ? q.choices : []));
      for (const m of qz.shared || []) texts.push(m.text);
      if (qz.directions && typeof qz.directions === 'object') texts.push(...Object.values(qz.directions));
      for (const sec of qz.sections || []) texts.push(sec.directions);
      const out = new Set();
      for (const t of texts) if (typeof t === 'string') for (const m of t.matchAll(/!\[[^\]]*\]\((?:\.\/)?(assets\/[A-Za-z0-9_.-]+)\)/g)) out.add(m[1]);
      return [...out];
    };

    const status = h('span', { class: 't-small qe-status', role: 'status' });
    const globalMsg = h('pre', { class: 't-error t-problems', role: 'alert' });
    const total = h('p', { class: 't-small t-muted qe-total' });
    const outline = h('ol', { class: 'qe-outline' });
    const undoRow = h('p', { class: 't-small qe-undo' });
    const pane = h('main', { class: 'qe-pane' });
    const settingsBtn = h('button', { class: 'qe-settings', type: 'button', text: 'Settings', onclick: () => select(-1) });

    function setStatus(text, bad) { status.textContent = text; status.classList.toggle('t-error', !!bad); }
    let queued = false;
    function refreshSoon() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; renderOutline(); if (paneTick) paneTick(); });
    }
    function touch(q) {
      dirty = true;
      edits++;
      if (status.textContent) setStatus('');
      if (q) fromServer.delete(q);
      refreshSoon();
    }
    const nextId = () => { let n = quiz.questions.length + 1; while (quiz.questions.some((q) => q.id === `q${n}`)) n++; return `q${n}`; };

    function problemsOf(q) {
      const out = [];
      if (!q.prompt.trim()) out.push('Write the prompt.');
      if (!(Number(q.points) > 0)) out.push('Points must be more than 0.');
      if (q.pool) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(q.pool)) out.push('A pool name can only use letters, digits, - and _.');
        const first = quiz.questions.find((x) => x.pool === q.pool);
        if (first && Number(first.points) !== Number(q.points)) out.push(`Make it worth ${Number(first.points) || 0}, like the rest of pool "${q.pool}", so every student's quiz is out of the same points.`);
      }
      if (q.image && imageMissing(q.image)) out.push(`Add the image file for ${q.image}.`);
      const sharedOf = [].concat(q.shared || []).map((id) => (quiz.shared || []).find((x) => x.id === id)).filter(Boolean);
      for (const p of markdownImages({ questions: [q], shared: sharedOf })) if (imageMissing(p)) out.push(`Add the image file for ${p}, or take it out of the text.`);
      for (const sid of [].concat(q.shared || [])) {
        const m = (quiz.shared || []).find((x) => x.id === sid);
        if (!m || (!(m.text || '').trim() && !m.image)) out.push('Write the shared material, or pick None.');
        else if (m.image && imageMissing(m.image)) out.push(`Add the image file for ${m.image}.`);
      }
      if (q.type === 'single' || q.type === 'multi') {
        const marked = q.type === 'single' ? (q.answer == null ? [] : [q.answer]) : q.answer;
        if (q.choices.filter((c) => c.trim()).length < 2) out.push('Write at least 2 choices.');
        if (!marked.length) out.push(q.type === 'single' ? 'Mark the correct choice.' : 'Mark at least one correct choice.');
        else if (marked.some((k) => !(q.choices[k] || '').trim())) out.push('A choice marked correct is empty.');
      }
      if (q.type === 'text' && !q.answer.some((a) => a.trim())) out.push('Add an accepted answer.');
      if (q.type === 'code') out.push(...readCode(q).problems);
      if (q.type === 'output' && !(q.code || '').trim()) out.push('Write the code.');
      if (q.type === 'trace') {
        const t = readTrace(q);
        if (t.columns.some((c) => !c)) out.push('Name every column.');
        if (!t.rows.length) out.push('Fill in the table.');
        else if (t.rows.some((row) => row.some((v) => !v))) out.push('Fill in every cell, or clear the whole row.');
        else if (t.given.length >= t.rows.length * t.columns.length) out.push('Leave at least one cell for students.');
      }
      if (q.type === 'fill') {
        const n = countBlanks(q.code);
        if (!(q.code || '').trim()) out.push('Write the code.');
        else if (!n) out.push('Mark a blank in the code with ___.');
        else if (n > 30) out.push('At most 30 blanks.');
        q._ui.blanks.forEach((b, k) => { if (!b.trim()) out.push(`Blank ${k + 1} needs an answer.`); });
        if (q._ui.run) out.push(...readCode(q).problems);
      }
      if (q.type === 'essay' && (q.rubric || []).filter((x) => x.text.trim()).reduce((sum, x) => sum + (Number(x.points) || 0), 0) > Number(q.points)) {
        out.push('Rubric points add up to more than the question\'s points.');
      }
      return out.concat(fromServer.get(q) || []);
    }

    // ---------- fields ----------
    const input = (q, value, on, attrs) => {
      const el = h('input', Object.assign({ class: 'input', value: value == null ? '' : String(value) }, attrs || {}));
      el.addEventListener('input', () => { on(el.value); touch(q); });
      return el;
    };
    const area = (q, value, on, attrs) => {
      const el = h('textarea', Object.assign({ class: 'input qe-area', spellcheck: 'false', rows: 2 }, attrs || {}));
      el.value = value || '';
      el.addEventListener('input', () => { on(el.value); grow(el); touch(q); });
      return el;
    };
    const check = (q, checked, label, on) => {
      const cb = h('input', { type: 'checkbox', checked: !!checked });
      cb.addEventListener('change', () => { on(cb.checked); touch(q); });
      return h('label', { class: 't-check' }, cb, h('span', { text: label }));
    };
    const field = (label, el, ...more) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el, ...more);
    // Settings: how many of each pool's questions a student gets
    const poolSettings = (q) => {
      const sizes = new Map();
      for (const x of quiz.questions) if (x.pool) sizes.set(x.pool, (sizes.get(x.pool) || 0) + 1);
      if (!sizes.size) return null;
      return h('div', { class: 'qe-settings-grid' }, [...sizes].map(([name, count]) => field(`Pool "${name}": questions each student gets`,
        h('span', { class: 'qe-line' },
          (() => {
            const el = input(q, Math.min(count, (quiz.pools || {})[name] || 1), (v) => {
              quiz.pools = Object.assign({}, quiz.pools, { [name]: Math.max(1, Math.min(count, Math.round(Number(v)) || 1)) });
              renderOutline(); // the total under the outline: what each student gets
            }, { type: 'number', min: '1', max: String(count), class: 'input t-points' });
            el.addEventListener('change', () => { el.value = String((quiz.pools || {})[name] || 1); }); // 9 of 3 shows as 3
            return el;
          })(),
          h('span', { class: 't-muted', text: `of ${count}` })))));
    };
    const xBtn = (label, onclick, disabled) => h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': label, title: label, disabled, onclick }, icon(ICONS.x, 16));

    // ---------- choices ----------
    // Marks travel with their choices when rows are added, removed or moved.
    function editChoices(q, fn) {
      const multi = q.type === 'multi';
      const rows = q.choices.map((text, k) => ({ text, on: multi ? q.answer.includes(k) : q.answer === k }));
      fn(rows);
      q.choices = rows.map((r) => r.text);
      const marked = rows.map((r, k) => (r.on ? k : -1)).filter((k) => k >= 0);
      q.answer = multi ? marked : marked.length ? marked[0] : null;
      touch(q);
      renderPane();
    }
    const focusChoice = (k) => { const el = pane.querySelectorAll('.qe-choice textarea.input')[k]; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };

    function choicesEditor(q) {
      const multi = q.type === 'multi';
      const full = q.choices.length >= 8;
      const rows = q.choices.map((c, k) => {
        const mark = h('input', { type: multi ? 'checkbox' : 'radio', name: 'qe-answer', checked: multi ? q.answer.includes(k) : q.answer === k, 'aria-label': `Choice ${k + 1} is correct`, title: 'Correct' });
        mark.addEventListener('change', () => {
          if (multi) q.answer = mark.checked ? [...new Set([...q.answer, k])].sort((a, b) => a - b) : q.answer.filter((x) => x !== k);
          else q.answer = k;
          touch(q);
        });
        // A text box, so a choice can hold more than one line (code, a table): Shift+Enter for a new line.
        const text = area(q, c, (v) => { q.choices[k] = v; }, { rows: 1, class: 'input qe-area qe-choice-text', placeholder: `Choice ${k + 1}`, 'aria-label': `Choice ${k + 1}`, spellcheck: 'true' });
        text.addEventListener('keydown', (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const atTop = !text.value.slice(0, text.selectionStart).includes('\n');
          const atEnd = !text.value.slice(text.selectionEnd).includes('\n');
          if (e.key === 'Enter' && e.shiftKey) return; // a new line in this choice
          if (e.key === 'Enter') {
            e.preventDefault();
            if (k + 1 < q.choices.length && !q.choices[k + 1].trim()) focusChoice(k + 1);
            else if (!full) { editChoices(q, (r) => r.splice(k + 1, 0, { text: '', on: false })); focusChoice(k + 1); }
          } else if (e.key === 'Backspace' && !text.value && q.choices.length > 2) {
            e.preventDefault();
            editChoices(q, (r) => r.splice(k, 1));
            focusChoice(Math.max(0, k - 1));
          } else if (e.key === 'ArrowDown' && atEnd && k + 1 < q.choices.length) { e.preventDefault(); focusChoice(k + 1); } else if (e.key === 'ArrowUp' && atTop && k > 0) { e.preventDefault(); focusChoice(k - 1); }
        });
        // A pasted list becomes one choice per line; pasted code or a table stays in this choice. A pasted
        // image goes in as Markdown.
        text.addEventListener('paste', (e) => {
          const img = [...(e.clipboardData.files || [])].find((x) => /^image\//.test(x.type));
          if (img) { e.preventDefault(); addInlineImage(text, img); return; }
          const raw = e.clipboardData.getData('text') || '';
          if (/```|^\s*\|.*\|\s*$|^(\t| {2,})\S/m.test(raw)) return;
          const lines = raw.split(/\r?\n/).map((l) => l.trim().replace(/^(?:[-*•]|\(?[A-Ha-h1-8][.)])\s+/, '')).filter(Boolean);
          if (lines.length < 2) return;
          e.preventDefault();
          editChoices(q, (r) => {
            const fresh = lines.map((t) => ({ text: t, on: false }));
            const empty = !text.value.trim();
            const at = empty ? k : k + 1;
            r.splice(at, empty ? 1 : 0, ...fresh);
            // the new rows take the place of the empty ones below
            for (let spare = fresh.length - (empty ? 1 : 0), j = at + fresh.length; spare > 0 && r[j] && !r[j].text.trim(); spare--) r.splice(j, 1);
            for (let i = r.length - 1; i >= 0 && r.length > 8; i--) if (!r[i].text.trim()) r.splice(i, 1);
            r.length = Math.min(r.length, 8);
          });
          focusChoice(Math.min(k + lines.length, q.choices.length - 1));
        });
        // Drag the grip, or focus it and use the arrow keys.
        const grip = h('button', { class: 'qe-grip', type: 'button', title: 'Drag, or use ↑ ↓, to move', 'aria-label': `Move choice ${k + 1}` }, icon(ICONS.grip, 18));
        grip.addEventListener('keydown', (e) => {
          const to = e.key === 'ArrowUp' ? k - 1 : e.key === 'ArrowDown' ? k + 1 : -1;
          if (to < 0 || to >= q.choices.length || e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          e.stopPropagation();
          editChoices(q, (r) => r.splice(to, 0, r.splice(k, 1)[0]));
          const g = pane.querySelectorAll('.qe-choice .qe-grip')[to];
          if (g) g.focus();
        });
        return h('div', { class: 'qe-choice qe-choice-row' }, grip, mark, text,
          xBtn('Remove choice', () => editChoices(q, (r) => r.splice(k, 1)), q.choices.length <= 2));
      });
      sortable(rows, (from, to) => editChoices(q, (r) => r.splice(to, 0, r.splice(from, 1)[0])), (row) => row.firstChild);
      const add = h('button', { class: 'btn small', type: 'button', text: 'Add choice', disabled: full, onclick: () => { editChoices(q, (r) => r.push({ text: '', on: false })); focusChoice(q.choices.length - 1); } });
      const label = h('span', { class: 'field-label', id: `qe-choices-${q._ui ? q._ui.id || 'q' : 'q'}`, text: multi ? 'Choices, with the correct ones ticked' : 'Choices, with the correct one marked' });
      return h('div', { class: 'field' }, label,
        h('div', { class: 'qe-choices', role: 'group', 'aria-labelledby': label.id }, rows),
        h('div', { class: 'qe-line' }, add, check(q, q.shuffleChoices === false, 'Keep choices in this order', (v) => { if (v) q.shuffleChoices = false; else delete q.shuffleChoices; }),
          q.type === 'multi' ? check(q, !!q.partialCredit, 'Partial credit', (v) => { if (v) q.partialCredit = true; else delete q.partialCredit; }) : null));
    }

    // ---------- images ----------
    function addImage(q, f) {
      if (!f) return;
      if (!IMAGE_MIME[extOf(f.name)]) { alert('Images must be png, jpg, gif or webp.'); return; }
      if (f.size > 5 * 1024 * 1024) { alert('Images can be up to 5 MB.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base = f.name.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(-80);
        // The file for a missing image takes that image's name, so the pasted quiz.json still points at it.
        let p2 = q.image && imageMissing(q.image) && extOf(q.image) === extOf(base) ? q.image : `assets/${base}`;
        for (let n = 2; p2 !== q.image && (existingAssets.has(p2) || newAssets[p2]); n++) p2 = `assets/${base.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
        newAssets[p2] = String(reader.result).split(',')[1];
        q.image = p2;
        touch(q);
        renderPane();
      };
      reader.readAsDataURL(f);
    }
    const assetSrc = (p) => (newAssets[p] ? `data:${IMAGE_MIME[extOf(p)]};base64,${newAssets[p]}`
      : existingAssets.has(p) && assetQuizId ? `/api/t/quizzes/${encodeURIComponent(assetQuizId)}/asset?path=${encodeURIComponent(p)}` : null);
    const imageSrc = (q) => assetSrc(q.image);
    // More images go into the text as Markdown, ![](assets/name.png), at the cursor.
    function addInlineImage(ta, f) {
      if (!f) return;
      if (!IMAGE_MIME[extOf(f.name)]) { alert('Images must be png, jpg, gif or webp.'); return; }
      if (f.size > 5 * 1024 * 1024) { alert('Images can be up to 5 MB.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base = f.name.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.-]/g, '_').slice(-80);
        let p2 = `assets/${base}`;
        for (let n = 2; existingAssets.has(p2) || newAssets[p2]; n++) p2 = `assets/${base.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
        newAssets[p2] = String(reader.result).split(',')[1];
        insert(ta, `![](${p2})`);
      };
      reader.readAsDataURL(f);
    }
    function imageEditor(q, file) {
      if (!q.image) return null;
      const src = imageSrc(q);
      const pick = h('button', { class: 'btn small', type: 'button', text: src ? 'Replace' : 'Add the file', onclick: () => file.click() });
      return h('div', { class: 'qe-image' },
        src ? h('img', { class: 'qe-thumb', src, alt: q.imageAlt || '' }) : h('p', { class: 't-error t-small', text: `${q.image} is missing.` }),
        h('div', { class: 'qe-image-side' },
          field('Image description', input(q, q.imageAlt, (v) => { q.imageAlt = v; }, { placeholder: 'For students who can\'t see the image' })),
          h('div', { class: 'qe-line' }, pick, h('button', { class: 'btn small', type: 'button', text: 'Remove image', onclick: () => { delete q.image; delete q.imageAlt; touch(q); renderPane(); } }))));
    }

    // ---------- prompt ----------
    function promptEditor(q) {
      const ta = area(q, q.prompt, (v) => { q.prompt = v; }, { id: 'qe-prompt', rows: 4, spellcheck: 'true' });
      const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp' });
      file.addEventListener('change', () => addImage(q, file.files[0]));
      const fence = () => { const s = ta.value.slice(0, ta.selectionStart); wrap(ta, `${s && !s.endsWith('\n') ? '\n' : ''}\`\`\`${quiz.language === 'none' ? '' : quiz.language}\n`, '\n```\n'); };
      const tool = (text, title, fn, cls) => h('button', { class: `qe-tool ${cls || ''}`, type: 'button', text, title, onclick: fn });
      ta.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (mod && !e.altKey && !e.shiftKey && 'bie'.includes(k) && k.length === 1) {
          e.preventDefault();
          if (k === 'b') wrap(ta, '**', '**'); else if (k === 'i') wrap(ta, '*', '*'); else wrap(ta, '`', '`');
        } else if (e.key === '`' && !mod && ta.selectionStart !== ta.selectionEnd) {
          e.preventDefault();
          wrap(ta, '`', '`');
        } else if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey && (ta.value.slice(0, ta.selectionStart).match(/^```/gm) || []).length % 2) {
          e.preventDefault(); // inside a code block
          insert(ta, '    ');
        }
      });
      const takeImage = (files, e) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); if (q.image) addInlineImage(ta, f); else addImage(q, f); } };
      ta.addEventListener('paste', (e) => takeImage(e.clipboardData && e.clipboardData.files, e));
      ta.addEventListener('drop', (e) => takeImage(e.dataTransfer && e.dataTransfer.files, e));
      const moreFile = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp' });
      moreFile.addEventListener('change', () => { addInlineImage(ta, moreFile.files[0]); moreFile.value = ''; });
      return [h('div', { class: 'field' },
        h('div', { class: 'qe-tools' },
          h('label', { class: 'field-label', for: 'qe-prompt', text: 'Prompt' }),
          h('span', { class: 'qe-grow' }),
          tool('B', `Bold (${MOD}B)`, () => wrap(ta, '**', '**'), 'b'),
          tool('I', `Italic (${MOD}I)`, () => wrap(ta, '*', '*'), 'i'),
          tool('Code', `Inline code (${MOD}E)`, () => wrap(ta, '`', '`')),
          tool('Code block', 'A block of code on its own lines', fence),
          tool('Math', 'LaTeX math: $x^2$ in a line, $$...$$ on its own lines', () => wrap(ta, '$', '$')),
          tool('Table', 'A table: | cells | split | by bars |, with a --- line under the header', () => {
            const s = ta.value.slice(0, ta.selectionStart);
            insert(ta, `${s && !s.endsWith('\n') ? '\n\n' : s && !s.endsWith('\n\n') ? '\n' : ''}| Column | Column |\n| --- | --- |\n|  |  |\n`);
          }),
          tool('Image', q.image ? 'Add another image where the cursor is. You can also paste or drop one' : 'Add an image. You can also paste or drop one into the prompt', () => (q.image ? moreFile : file).click())),
        ta, file, moreFile), imageEditor(q, file)];
    }

    // What the student gets, redrawn as you type.
    function studentView(q) {
      const md = window.BQ && window.BQ.md;
      const out = [];
      const opts = { lang: quiz.language, assetUrl: assetSrc };
      for (const sid of [].concat(q.shared || [])) {
        const sm = (quiz.shared || []).find((x) => x.id === sid);
        if (!sm || !((sm.text || '').trim() || sm.title || sm.image)) continue;
        const body = h('div', { class: 'prompt' });
        if (md) body.append(md.render(sm.text || '', opts)); else body.textContent = sm.text || '';
        out.push(h('section', { class: 'shared' }, sm.title ? h('p', { class: 'shared-title', text: sm.title }) : null, body,
          sm.image && imageSrc(sm) ? h('img', { class: 'qimg', src: imageSrc(sm), alt: sm.imageAlt || '' }) : null));
      }
      const prompt = h('div', { class: 'prompt' });
      if (md) prompt.append(md.render(q.prompt, opts)); else prompt.textContent = q.prompt;
      out.push(prompt);
      if (q.image && imageSrc(q)) out.push(h('img', { class: 'qimg', src: imageSrc(q), alt: q.imageAlt || '' }));
      if (q.type === 'single' || q.type === 'multi') {
        out.push(h('div', { class: 'choices' }, q.choices.filter((c) => c.trim()).map((c) => {
          const rich = /\n/.test(c);
          const text = h(rich ? 'div' : 'span', { class: 'choice-text' + (rich ? ' choice-rich' : '') });
          if (md) text.append(rich ? md.render(c, opts) : md.renderInline(c, opts)); else text.textContent = c;
          return h('div', { class: 'choice' }, h('input', { type: q.type === 'multi' ? 'checkbox' : 'radio', tabindex: '-1' }), text);
        })));
      }
      if (q.type === 'text') out.push(h('input', { class: 'input text-answer', tabindex: '-1', 'aria-hidden': 'true' }));
      const codeBlock = () => ((q.code || '').trim() ? h('pre', { class: 'md-code' }, h('code', { text: q.code.trimEnd() })) : null);
      const box = (label, rows, mono) => h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }),
        h('textarea', { class: `input long-answer${mono ? ' mono' : ''}`, rows, tabindex: '-1', 'aria-hidden': 'true' }));
      if (q.type === 'output') out.push(codeBlock(), box('Output', 4, true));
      if (q.type === 'trace') {
        const t = readTrace(q);
        const given = new Set(t.given.map((g) => g.join(',')));
        out.push(codeBlock(), h('div', { class: 'trace-wrap' }, h('table', { class: 'trace' },
          h('thead', {}, h('tr', {}, t.columns.map((c) => h('th', { text: c || ' ' })))),
          h('tbody', {}, t.rows.map((row, r) => h('tr', {}, row.map((v, c) => (given.has(`${r},${c}`)
            ? h('td', { class: 'given', text: v }) : h('td', {}, h('input', { class: 'trace-cell', tabindex: '-1', 'aria-hidden': 'true' }))))))))));
      }
      if (q.type === 'fill') {
        const pre = h('pre', { class: 'md-code fill-code' });
        const pieces = (q.code || '').trimEnd().split(BLANK);
        pieces.forEach((seg, i) => {
          if (seg) pre.append(h('code', { text: seg }));
          if (i < pieces.length - 1) pre.append(h('input', { class: 'blank', tabindex: '-1', 'aria-hidden': 'true', style: 'width: 6ch' }));
        });
        if ((q.code || '').trim()) out.push(pre);
        if (q._ui.run) out.push(h('div', {}, h('button', { class: 'btn small primary', type: 'button', tabindex: '-1', text: 'Run examples' })));
      }
      if (q.type === 'essay') out.push(box('Your answer', 6, !!q.language));
      if (q.type === 'code') {
        const lang = q.languages[0];
        const custom = q.starter && typeof q.starter === 'object' ? q.starter[lang] : null;
        const rc = readCode(q);
        const shape = rc.shape;
        if (rc.types) out.push(h('p', { class: 'sub', text: 'Classes you can use' }), h('pre', { class: 'md-code' }, h('code', { text: BT.classSource(rc.types, lang, true).trimEnd() })));
        const code = custom || (shape ? starterCode(shape, lang, q.starter === 'empty') : '');
        if (code) out.push(h('pre', { class: 'md-code' }, h('code', { text: code.trimEnd() })));
      }
      return out.filter(Boolean);
    }

    // ---------- rubric, for code and written answers ----------
    // On code questions (langs given) an item can grade itself: a regex the code must have, or must not
    // have, one per language. Comments and strings don't count. Otherwise the teacher ticks it.
    const BAN_HINT = { java: 'Arrays.sort, Collections.sort, stream', python: 'sorted, sort', c: 'qsort', cpp: 'std::sort, max_element',
      csharp: 'Array.Sort, OrderBy', go: 'sort, slices.Sort' };
    const PATTERN_HINT = {
      require: { java: 'private\\s+\\w+\\s+\\w+\\s*;', python: 'self\\._\\w+\\s*=', javascript: '\\bconst\\b', typescript: ':\\s*number\\b', c: '\\bfree\\(', cpp: 'private:', go: '\\bfor\\b', rust: '\\bmatch\\b', csharp: 'private\\s+\\w+\\s+\\w+\\s*;' },
      forbid: { java: 'Arrays\\.sort', python: 'sorted\\(', javascript: '\\.sort\\(', typescript: '\\.sort\\(', c: 'qsort\\(', cpp: '\\bsort\\(', go: 'sort\\.', rust: '\\.sort', csharp: '\\.Sort\\(|OrderBy' },
    };
    function rubricEditor(q, placeholder, langs) {
      q.rubric = q.rubric || [];
      const worth = h('span', { class: 't-small t-muted' });
      const add = () => { q.rubric.push({ text: '', points: 1 }); touch(q); renderPane(); const all = pane.querySelectorAll('.qe-rubric .qe-choice input[type=text]'); all[all.length - 1].focus(); };
      const rows = q.rubric.map((r, k) => {
        const text = input(q, r.text, (v) => { r.text = v; }, { type: 'text', placeholder });
        text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); add(); } });
        const line = h('div', { class: 'qe-choice' }, text,
          input(q, r.points, (v) => { r.points = v; }, { type: 'number', min: '0', step: '0.5', class: 'input t-points', 'aria-label': 'Points' }),
          xBtn('Remove rubric item', () => { q.rubric.splice(k, 1); touch(q); renderPane(); }));
        if (!langs) return line;
        if (r.require || r.forbid) r._auto = true;
        const by = h('select', { class: 'input qe-narrow', 'aria-label': 'Who grades it' },
          [['', 'You grade it'], ['auto', 'Auto']].map(([v, t]) => h('option', { value: v, text: t, selected: (r._auto ? 'auto' : '') === v })));
        by.addEventListener('change', () => {
          r._auto = by.value === 'auto';
          if (!r._auto) { delete r.require; delete r.forbid; }
          touch(q);
          renderPane();
          if (r._auto) { const el = pane.querySelectorAll('.qe-rubric-item')[k]; if (el) el.querySelector('.qe-pattern input').focus(); }
        });
        // One regex per language; either row can be left empty.
        const patternRow = (key, label) => h('div', { class: 'qe-pattern-group' }, h('span', { class: 't-small qe-pattern-label', text: label }), langs.map((l) => {
          const cur = r[key];
          const el = input(q, typeof cur === 'string' ? cur : (cur && cur[l]) || '', (v) => {
            const all = typeof r[key] === 'string' ? Object.fromEntries(langs.map((x) => [x, r[key]])) : Object.assign({}, r[key]);
            all[l] = v;
            r[key] = all;
          }, { type: 'text', class: 'input qe-mono', spellcheck: 'false', autocomplete: 'off', placeholder: PATTERN_HINT[key][l], 'aria-label': `${label} (${LANGS[l]} regex)` });
          return h('label', { class: 'qe-pattern' }, langs.length > 1 ? h('span', { class: 't-small', text: LANGS[l] }) : null, el);
        }));
        return h('div', { class: 'qe-rubric-item' }, line, h('div', { class: 'qe-rubric-auto' }, by),
          r._auto ? patternRow('require', 'Code has') : null, r._auto ? patternRow('forbid', "Code doesn't have") : null);
      });
      return { worth, node: h('div', { class: 'field qe-rubric' }, h('span', { class: 'field-label', text: 'Rubric' }), rows,
        h('div', { class: 'qe-line' }, h('button', { class: 'btn small', type: 'button', text: 'Add rubric item', onclick: add }), worth)) };
    }

    // ---------- the code students read: output, trace and fill questions ----------
    const codeAttrs = (rows, more) => Object.assign({ rows, class: 'input qe-area qe-mono qe-code', autocomplete: 'off' }, more || {});
    function langSelect(q, onChange) {
      const sel = h('select', { class: 'input qe-narrow', 'aria-label': 'Language' }, Object.entries(LANGS).map(([v, t]) => h('option', { value: v, text: t, selected: (q.language || (quiz.language === 'none' ? 'java' : quiz.language)) === v })));
      sel.addEventListener('change', () => { q.language = sel.value; if (onChange) onChange(); touch(q); });
      return sel;
    }
    const codeHead = (q, label, onLang, ...tools) => h('div', { class: 'qe-tools' },
      h('label', { class: 'field-label', for: 'qe-code', text: label }), h('span', { class: 'qe-grow' }), ...tools, langSelect(q, onLang));

    function outputEditor(q) {
      const u = q._ui;
      const out = area(q, q.answer, (v) => { if (v.trim()) q.answer = v; else delete q.answer; },
        codeAttrs(2, { 'data-out': '', placeholder: 'Leave empty. Saving runs the code and fills this in' }));
      // An output the server worked out goes stale when the code changes; one typed here stays, as a check.
      const stale = () => { if (q.answer != null && q.answer === u.auto) { delete q.answer; out.value = ''; grow(out); } };
      const code = area(q, q.code, (v) => { q.code = v; stale(); }, codeAttrs(5, { id: 'qe-code', placeholder: OUTPUT_HINT[q.language || quiz.language] || OUTPUT_HINT.java }));
      codeKeys(code);
      return [h('div', { class: 'field' }, codeHead(q, 'Code', stale), code), field('Output', out)];
    }

    const OUTPUT_HINT = {
      java: 'int x = 7;\nSystem.out.println(x / 2);', python: 'x = 7\nprint(x // 2)', javascript: 'const x = 7;\nconsole.log(Math.floor(x / 2));',
      typescript: 'const x: number = 7;\nconsole.log(Math.floor(x / 2));', c: 'int x = 7;\nprintf("%d\\n", x / 2);', cpp: 'int x = 7;\ncout << x / 2 << endl;',
      go: 'x := 7\nfmt.Println(x / 2)', rust: 'let x = 7;\nprintln!("{}", x / 2);', csharp: 'int x = 7;\nConsole.WriteLine(x / 2);',
    };
    function traceEditor(q) {
      const u = q._ui;
      const code = area(q, q.code, (v) => { q.code = v; }, codeAttrs(4, { id: 'qe-code' }));
      codeKeys(code);
      const cell = (r, c) => pane.querySelector(`.qe-grid input[data-r="${r}"][data-c="${c}"]`);
      const edit = (fn, r, c) => { fn(); touch(q); renderPane(); const el = cell(r, c); if (el) el.focus(); };
      const addRow = (r, c) => edit(() => u.cells.push(u.cols.map(() => ({ v: '', given: false }))), r, c);
      const wide = u.cols.length >= 8;
      const tall = u.cells.length >= 40;
      const head = h('tr', {}, u.cols.map((name, c) => {
        const el = input(q, name, (v) => { u.cols[c] = v; }, { type: 'text', class: 'qe-gridcell', placeholder: 'Name', 'aria-label': `Column ${c + 1}`, 'data-r': '-1', 'data-c': c, maxlength: '40', autocomplete: 'off', spellcheck: 'false' });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const next = cell(0, c); if (next) next.focus(); } });
        return h('th', {}, h('div', { class: 'qe-cell' }, el,
          h('button', { class: 'qe-tool', type: 'button', title: 'Remove column', 'aria-label': `Remove column ${c + 1}`, disabled: u.cols.length <= 1,
            onclick: () => edit(() => { u.cols.splice(c, 1); u.cells.forEach((row) => row.splice(c, 1)); }) }, icon(ICONS.x, 14))));
      }), h('td', { class: 'qe-grid-side' }, h('button', { class: 'btn small', type: 'button', text: 'Add column', disabled: wide,
        onclick: () => edit(() => { u.cols.push(''); u.cells.forEach((row) => row.push({ v: '', given: false })); }, -1, u.cols.length) })));
      const body = u.cells.map((row, r) => h('tr', {}, row.map((cl, c) => {
        const td = h('td', { class: cl.given ? 'given' : '' });
        const el = input(q, cl.v, (v) => { cl.v = v; }, { type: 'text', class: 'qe-gridcell', 'aria-label': `${u.cols[c] || `Column ${c + 1}`}, row ${r + 1}`, 'data-r': r, 'data-c': c, autocomplete: 'off', spellcheck: 'false' });
        // Enter goes down the column, like a spreadsheet, and adds a row at the bottom.
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          if (cell(r + 1, c)) cell(r + 1, c).focus(); else if (!tall) addRow(r + 1, c);
        });
        // A block copied from a spreadsheet fills the cells from here.
        el.addEventListener('paste', (e) => {
          const text = (e.clipboardData.getData('text') || '').replace(/\r/g, '').replace(/\n+$/, '');
          if (!/[\t\n]/.test(text)) return;
          e.preventDefault();
          edit(() => text.split('\n').forEach((line, i) => {
            if (r + i >= 40) return;
            while (u.cells.length <= r + i) u.cells.push(u.cols.map(() => ({ v: '', given: false })));
            line.split('\t').forEach((v, k) => { if (u.cells[r + i][c + k]) u.cells[r + i][c + k].v = v.trim(); });
          }), r, c);
        });
        const given = h('input', { type: 'checkbox', checked: cl.given, title: 'Given to students', 'aria-label': `Given to students: ${u.cols[c] || `column ${c + 1}`}, row ${r + 1}` });
        given.addEventListener('change', () => { cl.given = given.checked; td.classList.toggle('given', cl.given); touch(q); });
        td.append(h('div', { class: 'qe-cell' }, el, given));
        return td;
      }), h('td', { class: 'qe-grid-side' }, h('button', { class: 'qe-tool', type: 'button', title: 'Remove row', 'aria-label': `Remove row ${r + 1}`, disabled: u.cells.length <= 1,
        onclick: () => edit(() => u.cells.splice(r, 1)) }, icon(ICONS.x, 14)))));
      return [h('div', { class: 'field' }, codeHead(q, 'Code (optional)'), code),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Table, with the correct values' }),
          h('div', { class: 'qe-grid-wrap' }, h('table', { class: 'qe-grid' }, h('thead', {}, head), h('tbody', {}, body))),
          h('div', { class: 'qe-line' },
            h('button', { class: 'btn small', type: 'button', text: 'Add row', disabled: tall, onclick: () => addRow(u.cells.length, 0) })))];
    }

    function fillEditor(q) {
      const u = q._ui;
      const list = h('div', { class: 'qe-blanks' });
      const label = h('span', { class: 'field-label', text: 'Accepted answers for each blank, one per line' });
      function renderBlanks() {
        const lines = [];
        (q.code || '').split('\n').forEach((line) => { for (let k = countBlanks(line); k > 0; k--) lines.push(line.trim()); });
        list.replaceChildren(...u.blanks.map((text, k) => {
          const ta = area(q, text, (v) => { u.blanks[k] = v; }, { rows: 1, class: 'input qe-area qe-mono', 'aria-label': `Accepted answers for blank ${k + 1}`, autocomplete: 'off' });
          return h('div', { class: 'qe-blank' }, h('span', { class: 'qe-row-n', text: String(k + 1) }), h('div', { class: 'qe-stack qe-tight' }, h('code', { class: 't-small t-muted qe-blank-line', text: lines[k] || '' }), ta));
        }));
        list.querySelectorAll('textarea').forEach(grow);
        label.hidden = !u.blanks.length;
      }
      const code = area(q, q.code, (v) => { u.blanks = realign(q.code || '', v, u.blanks); q.code = v; renderBlanks(); },
        codeAttrs(6, { id: 'qe-code', placeholder: 'int total = ___;\nfor (int n : nums) {\n    total ___ n;\n}' }));
      codeKeys(code);
      // Write working code, then turn pieces of it into blanks: the piece becomes the blank's answer.
      const makeBlank = () => {
        const start = code.selectionStart;
        const text = code.value.slice(start, code.selectionEnd).trim();
        const k = countBlanks(code.value.slice(0, start));
        insert(code, '___');
        if (text && u.blanks[k] === '') { u.blanks[k] = text; renderBlanks(); touch(q); }
      };
      const run = check(q, u.run, 'Grade by running tests', (v) => { u.run = v; if (v && !q.mode) q.mode = 'method'; renderPane(); });
      return {
        after: renderBlanks,
        nodes: [
          h('div', { class: 'field' }, codeHead(q, 'Code', null, h('button', { class: 'qe-tool', type: 'button', text: 'Blank', title: 'Turn the selected code into a blank', onclick: makeBlank })), code),
          h('div', { class: 'field' }, label, list),
          run,
          u.run ? h('p', { class: 't-small t-muted', text: 'The code has to be the whole class.' }) : null],
      };
    }

    // ---------- code questions, and fill questions graded by running ----------
    function codeEditor(q) {
      const u = q._ui;
      const fill = q.type === 'fill';
      const from = fill ? 'your answers for the blanks' : 'the reference solution';
      const isClass = q.mode === 'class';
      // "Any language": every language that can run the question (the server leaves out the ones that can't)
      const anyBox = check(q, !!q.languagesAny, 'Any language', (v) => {
        q.languages = v ? Object.keys(LANGS) : refLangsOf(q);
        q.languagesAny = v;
        renderPane();
      });
      const langs = fill ? null : h('div', { class: 'qe-line' }, anyBox, q.languagesAny ? null : Object.entries(LANGS).map(([l, name]) => check(q, q.languages.includes(l), name, (v) => {
        q.languages = Object.keys(LANGS).filter((x) => (x === l ? v : q.languages.includes(x)));
        if (!q.languages.length) q.languages = [l === 'java' ? 'python' : 'java'];
        renderPane();
      })));
      const mode = h('select', { class: 'input qe-narrow', 'aria-label': 'What students write' },
        h('option', { value: 'method', text: 'Write a method', selected: !isClass }),
        h('option', { value: 'class', text: 'Write a class', selected: isClass }));
      mode.addEventListener('change', () => {
        q.mode = mode.value;
        u.sample = '';
        u.hidden = '';
        touch(q);
        renderPane();
      });
      const mono = { class: 'input qe-mono', spellcheck: 'false', autocomplete: 'off' };
      const shapeNote = h('p', { class: 't-small qe-note' });
      const notes = { sample: h('p', { class: 't-small qe-note' }), hidden: h('p', { class: 't-small qe-note' }) };
      const tests = (kind, rows, placeholder) => area(q, u[kind], (v) => { u[kind] = v; }, { rows, placeholder, class: 'input qe-area qe-mono qe-code', 'data-tests': kind });
      const starters = [];
      const refLangs = fill ? [] : refLangsOf(q);
      const refs = refLangs.map((l) => {
        const ta = area(q, (q.reference || {})[l], (v) => { q.reference = Object.assign({}, q.reference, { [l]: v }); }, { rows: 8, class: 'input qe-area qe-mono qe-code' });
        codeKeys(ta);
        const btn = h('button', { class: 'btn small', type: 'button', text: 'Insert the starter code', onclick: () => {
          const shape = readCode(q).shape;
          if (!shape) return;
          ta.select();
          insert(ta, starterCode(shape, l, false));
        } });
        starters.push({ ta, btn });
        return h('div', { class: 'qe-ref' }, field(`Reference solution (${LANGS[l]})`, ta), h('div', {}, btn));
      });
      // With "any", a reference in another language is one pick away
      const more = q.languagesAny ? Object.keys(LANGS).filter((l) => !refLangs.includes(l)) : [];
      if (more.length) {
        const add = h('select', { class: 'input qe-narrow', 'aria-label': 'Add a reference solution' },
          h('option', { value: '', text: 'Add a reference in…' }), more.map((l) => h('option', { value: l, text: LANGS[l] })));
        add.addEventListener('change', () => { if (add.value) { u.refLangs = [...(u.refLangs || refLangs), add.value]; renderPane(); } });
        refs.push(h('div', { class: 'qe-line' }, add));
      }
      const rubric = fill ? null : rubricEditor(q, 'Uses private instance variables', refLangs);
      // Methods students may not use: comma separated, one list for every language or one per language (a
      // Class.method entry names one language's class). Using one scores 0 (server/src/bans.js).
      const banLangs = q.languages.filter(BT.hasBans);
      const parse = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const cppOnly = (l) => l === 'cpp' || (!l && banLangs.length === 1 && banLangs[0] === 'cpp');
      const banField = (label, list, set, hint, l) => field(label, input(q, list.map((b) => (cppOnly(l) ? b.replace('.', '::') : b)).join(', '), (v) => set(parse(v)),
        { class: 'input qe-mono', placeholder: hint, spellcheck: 'false' }));
      let bans = null;
      if (!fill) {
        const perLang = !!q.ban && !Array.isArray(q.ban);
        const fields = perLang
          ? banLangs.map((l) => banField(`Not allowed in ${LANGS[l]}`, q.ban[l] || [], (list) => {
            if (list.length) q.ban[l] = list; else delete q.ban[l];
          }, BAN_HINT[l], l))
          : [banField('Not allowed (methods students may not use)', q.ban || [], (list) => { if (list.length) q.ban = list; else delete q.ban; },
            banLangs.length === 1 ? BAN_HINT[banLangs[0]] : banLangs.every((l) => l === 'java' || l === 'python') ? BAN_HINT.java + ', sorted' : 'sort')];
        const split = banLangs.length > 1 && !q.languagesAny ? check(q, perLang, 'Per language', (v) => {
          const all = [...new Set(Array.isArray(q.ban) ? q.ban : Object.values(q.ban || {}).flat())];
          if (v) q.ban = Object.fromEntries(banLangs.map((l) => [l, all.slice()]));
          else if (all.length) q.ban = all; else delete q.ban;
          renderPane();
        }) : null;
        bans = h('div', { class: 'qe-stack' }, ...fields, split);
      }

      const tick = () => {
        const r = readCode(q);
        const hasRef = fill || q.languages.some((l) => ((q.reference || {})[l] || '').trim());
        shapeNote.textContent = r.shapeErrors.join('\n') || `Types: ${BT.HELP}${isClass ? ', void' : ''}`;
        shapeNote.classList.toggle('t-error', !!r.shapeErrors.length);
        for (const kind of ['sample', 'hidden']) {
          const p = r[kind];
          const open = isClass ? 0 : p.tests.filter((t) => t.expected === undefined).length;
          notes[kind].textContent = p.errors.map((e) => e[0].toUpperCase() + e.slice(1)).join('\n')
            || (p.tests.length ? `${plural(p.tests.length, 'test')}${p.tests.some((t) => t.speed) ? `, ${plural(p.tests.filter((t) => t.speed).length, 'speed test')}` : ''}${open && hasRef ? `, ${open} filled in from ${from} when you save` : ''}` : '');
          notes[kind].classList.toggle('t-error', !!p.errors.length);
        }
        for (const s of starters) { s.btn.hidden = !!s.ta.value.trim(); s.btn.disabled = !r.shape; }
        if (rubric) rubric.worth.textContent = q.rubric.some((x) => x.text.trim()) && r.rubric < Number(q.points) ? `Tests are worth ${Number(q.points) - r.rubric} of ${q.points}` : '';
      };

      const shape = [
        h('div', { class: 'qe-line' }, mode, langs),
        isClass
          ? [h('div', { class: 'qe-pair' },
            field('Class name', input(q, u.className, (v) => { u.className = v; }, Object.assign({}, mono, { placeholder: 'BankAccount' }))),
            field('Constructor', input(q, u.ctor, (v) => { u.ctor = v; }, Object.assign({}, mono, { placeholder: '(owner: string, balance: double)' })))),
          field('Methods, one per line', area(q, u.methods, (v) => { u.methods = v; }, { rows: 3, class: 'input qe-area qe-mono', placeholder: 'deposit(amount: double): void\ngetBalance(): double' }))]
          : field('Signature', input(q, u.sig, (v) => { u.sig = v; }, Object.assign({}, mono, { placeholder: 'countVowels(s: string): int' }))),
        fill ? null : field('Classes (optional, one per line)', area(q, u.types, (v) => { u.types = v; }, { rows: 1, class: 'input qe-area qe-mono', placeholder: 'Point(x: int, y: int)' })),
        shapeNote];
      const testFields = [
        field('Sample tests (students can run these)', tests('sample', 2, isClass ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2'), notes.sample),
        field('Hidden tests (used for grading)', tests('hidden', 4, isClass ? 'a = new BankAccount("Jo", 20.0)\na.withdraw(50.0) -> false\na.getBalance() -> ?\n*2' : '("AEIOU") -> 5\n("rhythm") -> 0\n("Programming is fun") *2'), notes.hidden),
        h('p', { class: 't-muted t-small', text: isClass
          ? `A blank line starts the next test. -> ? takes the value from ${from}. A line with *2 makes the test count double.`
          : `One test per line. Leave out -> to take the value from ${from}. *2 at the end counts double.` })];
      const unordered = check(q, q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; });
      const noRun = check(q, !!q.noRun, "Students can't run their code (like on paper)", (v) => { if (v) q.noRun = true; else delete q.noRun; });
      const stack = (...kids) => h('div', { class: 'qe-stack' }, ...kids);
      // A fill question has no reference field: what students are to write, then the tests.
      if (fill) return { node: h('div', { class: 'qe-codegrid' }, stack(shape, unordered, noRun), stack(testFields)), tick };
      return { tick, node: h('div', { class: 'qe-codegrid' }, stack(shape, testFields), stack(refs, bans, rubric.node, h('div', { class: 'qe-line' }, unordered, noRun,
        isClass ? check(q, q.starter === 'empty', 'Start with an empty class', (v) => { if (v) q.starter = 'empty'; else delete q.starter; }) : null))) };
    }

    // ---------- the open question ----------
    function questionPane(q, i) {
      const n = quiz.questions.length;
      const type = h('select', { class: 'input qe-narrow', 'aria-label': 'Type' }, Object.entries(TYPES).map(([v, t]) => h('option', { value: v, text: t, selected: q.type === v })));
      type.addEventListener('change', () => {
        const to = type.value;
        if ((q.type === 'single' || q.type === 'multi') && (to === 'single' || to === 'multi')) { // choices stay
          q.answer = to === 'multi' ? (q.answer == null ? [] : [q.answer]) : q.answer.length === 1 ? q.answer[0] : null;
          q.type = to;
        } else quiz.questions[i] = blank(to, Object.assign({}, q, { language: to === 'essay' || q.type === 'essay' ? null : q.language }));
        touch(quiz.questions[i]);
        renderPane();
      });
      const head = h('div', { class: 'qe-head' },
        h('h1', { class: 'qe-n', text: `Question ${i + 1}` }), type,
        h('label', { class: 'qe-pts' }, 'Points', input(q, q.points, (v) => { q.points = Number(v); }, { type: 'number', min: '0.5', step: '0.5', class: 'input t-points' })),
        h('span', { class: 'qe-grow' }),
        h('button', { class: 'btn small qe-icon', type: 'button', 'aria-label': 'Move up', title: `Move up (${ALT}Shift+↑)`, disabled: i === 0, onclick: () => moveQuestion(i, i - 1) }, icon(ICONS.up, 16)),
        h('button', { class: 'btn small qe-icon', type: 'button', 'aria-label': 'Move down', title: `Move down (${ALT}Shift+↓)`, disabled: i === n - 1, onclick: () => moveQuestion(i, i + 1) }, icon(ICONS.down, 16)),
        h('button', { class: 'btn small', type: 'button', text: 'Duplicate', onclick: () => duplicate(i) }),
        h('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => remove(i) }));
      const probs = h('ul', { class: 't-error qe-problems', role: 'alert' });
      const view = h('div', { class: 'qe-view', inert: true }); // a picture of the student's screen, not something to use
      // Optional. Students see names, types and points before they start, so a name shouldn't give the answer away.
      const name = field('Name', input(q, q.name || '', (v) => { const t = v.replace(/\s+/g, ' ').trim(); if (t) q.name = t; else delete q.name; renderOutline(); }, { class: 'input qe-name', maxlength: '80', placeholder: 'Optional' }));
      // A question pool: each student gets some of a pool's questions, picked at random (how many: Settings).
      const poolNames = [...new Set(quiz.questions.map((x) => x.pool).filter(Boolean))];
      const pool = field('Question pool', input(q, q.pool || '', (v) => { const t = v.trim(); if (t) q.pool = t; else delete q.pool; renderOutline(); },
        { class: 'input qe-pool', maxlength: '40', placeholder: 'Optional', list: 'qe-pool-names', autocomplete: 'off', spellcheck: 'false' }),
      h('datalist', { id: 'qe-pool-names' }, poolNames.map((p) => h('option', { value: p }))));
      const fields = h('div', { class: 'qe-stack' }, h('div', { class: 'qe-line qe-name-row' }, name, pool), sharedEditor(q, i), promptEditor(q));
      if (q.type === 'single' || q.type === 'multi') fields.append(choicesEditor(q));
      if (q.type === 'text') {
        fields.append(field('Accepted answers, one per line', area(q, q.answer.join('\n'), (v) => { q.answer = v.split('\n'); }, { rows: 2, placeholder: '3.5\n/^(binary|bin) search$/' })),
          check(q, q.caseSensitive, 'Capital letters count', (v) => { if (v) q.caseSensitive = true; else delete q.caseSensitive; }));
      }
      const add = (nodes) => fields.append(...nodes.filter(Boolean));
      let fillParts = null;
      if (q.type === 'output') add(outputEditor(q));
      if (q.type === 'trace') add(traceEditor(q));
      if (q.type === 'fill') { fillParts = fillEditor(q); add(fillParts.nodes); fillParts.after(); }
      if (q.type === 'essay') {
        const kind = h('select', { class: 'input qe-narrow' }, [['', 'Text'], ...Object.entries(LANGS).map(([l, n]) => [l, `${n} code`])].map(([v, t]) => h('option', { value: v, text: t, selected: (q.language || '') === v })));
        kind.addEventListener('change', () => { if (kind.value) q.language = kind.value; else delete q.language; touch(q); });
        add([h('div', { class: 'qe-line' }, field('Students write', kind)), rubricEditor(q, 'Says == compares references').node]);
      }
      // Why the answer is right: with the answer in a practice quiz's review, in reports, and for AI grading
      fields.append(field('Explanation', area(q, q.explanation || '', (v) => { if (v.trim()) q.explanation = v; else delete q.explanation; },
        { rows: 2, spellcheck: 'true', placeholder: 'Optional. Shown with the answer after a practice quiz.' })));
      const code = q.type === 'code' || (q.type === 'fill' && q._ui.run) ? codeEditor(q) : null;
      paneTick = () => {
        view.replaceChildren(...studentView(q));
        const list = tried || fromServer.has(q) ? problemsOf(q) : [];
        probs.replaceChildren(...list.map((p) => h('li', { text: p })));
        probs.hidden = !list.length;
        if (code) code.tick();
      };
      return [head, probs,
        h('div', { class: 'qe-cols' }, fields, h('div', { class: 'qe-viewcol' }, h('span', { class: 'field-label', text: 'Students see' }), view)),
        code && code.node];
    }

    // ---------- shared material: a case or passage written once, used by several questions ----------
    // Shared material: a question can use up to 3. Each in use gets its own picker and fields; "Also uses"
    // adds another. One is saved as an id, more as a list.
    function sharedEditor(q, i) {
      quiz.shared = quiz.shared || [];
      const ids = [].concat(q.shared || []);
      const setIds = (next) => { const list = [...new Set(next.filter(Boolean))]; if (!list.length) delete q.shared; else q.shared = list.length === 1 ? list[0] : list; };
      const newShared = () => {
        let n = quiz.shared.length + 1;
        while (quiz.shared.some((m) => m.id === `s${n}`)) n++;
        quiz.shared.push({ id: `s${n}`, title: '', text: '' });
        return `s${n}`;
      };
      // slot k: the k-th material it uses, or (k === ids.length) a picker to add one
      const picker = (k) => {
        const cur = ids[k] || '';
        const pick = h('select', { class: 'input qe-narrow', id: `qe-shared-${k}`, 'aria-label': k ? 'Also uses' : 'Shared material' },
          h('option', { value: '', text: 'None', selected: !cur }),
          quiz.shared.filter((m) => m.id === cur || !ids.includes(m.id)).map((m) => h('option', { value: m.id, text: m.title.trim() || `Shared material ${quiz.shared.indexOf(m) + 1}`, selected: cur === m.id })),
          h('option', { value: '+', text: 'New shared material' }));
        pick.addEventListener('change', () => {
          const v = pick.value === '+' ? newShared() : pick.value;
          const next = ids.slice();
          if (v) next[k] = v; else next.splice(k, 1);
          setIds(next);
          touch(q);
          renderPane();
          if (pick.value === '+') { const t = pane.querySelector(`#qe-shared-${k}`)?.closest('.qe-shared')?.querySelector('input[type=text]'); if (t) t.focus(); }
        });
        return pick;
      };
      const block = (k) => {
        const m = quiz.shared.find((x) => x.id === ids[k]);
        const others = m ? quiz.questions.map((x, j) => ([].concat(x.shared || []).includes(m.id) && j !== i ? j + 1 : null)).filter(Boolean) : [];
        // Images work like a question's: the button, or paste or drop one into the text.
        const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp' });
        file.addEventListener('change', () => addImage(m, file.files[0]));
        const text = m ? area(q, m.text, (v) => { m.text = v; }, { rows: 6, placeholder: 'The case, passage or code every question in the set uses. Markdown works.', 'aria-label': 'Shared material' }) : null;
        const takeImage = (files, e) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); if (m.image) addInlineImage(text, f); else addImage(m, f); } };
        if (text) {
          text.addEventListener('paste', (e) => takeImage(e.clipboardData && e.clipboardData.files, e));
          text.addEventListener('drop', (e) => takeImage(e.dataTransfer && e.dataTransfer.files, e));
        }
        return h('div', { class: 'qe-shared' + (m ? ' on' : '') },
          h('div', { class: 'qe-line' }, h('label', { class: 'field-label', for: `qe-shared-${k}`, text: k ? 'Also uses' : 'Shared material' }), picker(k),
            others.length ? h('span', { class: 't-small t-muted', text: `Also on question${others.length > 1 ? 's' : ''} ${others.join(', ')}` }) : null),
          m ? [
            input(q, m.title, (v) => { m.title = v; }, { type: 'text', placeholder: 'Title, like Case A', 'aria-label': 'Shared material title', maxlength: '120' }),
            text, file,
            m.image ? imageEditor(m, file) : h('div', {}, h('button', { class: 'btn small', type: 'button', text: 'Add image', onclick: () => file.click() })),
          ] : null);
      };
      const blocks = ids.map((_, k) => block(k));
      if (!ids.length) return block(0);
      return h('div', { class: 'qe-stack' }, blocks, ids.length < 3 ? h('div', { class: 'qe-line' }, h('label', { class: 'field-label', for: `qe-shared-${ids.length}`, text: 'Also uses' }), picker(ids.length)) : null);
    }

    // The student app's built-in directions for each part (student/app.js PARTS), shown as placeholders.
    const PART_DIRECTIONS = {
      single: 'Pick the one best answer. Blank answers earn no credit.',
      multi: 'Credit only if you select every correct answer and no wrong ones.',
      text: "Spelling counts. Capital letters and extra spaces don't.",
      code: 'Assume needed imports are there and inputs match the question. Partial credit is possible.',
      output: 'Type exactly what the code prints, one line per line of output.',
      trace: 'Fill in each value as the code runs. Each correct cell earns credit.',
      fill: 'Fill in each blank so the code works. Partial credit is possible.',
      essay: 'Your teacher grades these.',
    };
    function settingsPane() {
      const q = null;
      // Directions: one box for the whole quiz, and one for each kind of question the quiz has. Empty keeps the default.
      const setDir = (k, v) => { quiz.directions = quiz.directions || {}; if (v.trim()) quiz.directions[k] = v; else delete quiz.directions[k]; };
      const dirs = quiz.directions || {};
      const used = [...new Set(quiz.questions.map((x) => x.type))];
      const prose = { spellcheck: 'true' };
      const pasteArea = h('textarea', { class: 'input t-textarea', rows: 8, spellcheck: 'false', id: 'paste-json', placeholder: '{ "title": "...", "questions": [ ... ] }' });
      const pasteMsg = h('p', { class: 't-error', role: 'alert' });
      const pasteBtn = h('button', { class: 'btn small', type: 'button', text: 'Load' });
      pasteBtn.addEventListener('click', async () => {
        pasteMsg.textContent = '';
        if (dirty && quiz.questions.length && !confirm('Replace what\'s here with the pasted quiz?')) return;
        try {
          const r = await post('/api/t/quizzes/normalize', { json: pasteArea.value });
          showQuizEditor(currentId, { quiz: r.quiz, missing: r.missingImages });
        } catch (e) { pasteMsg.textContent = e.message; }
      });
      const langSel = h('select', { class: 'input' }, Object.entries(Object.assign({}, LANGS, { none: 'None' })).map(([v, t]) => h('option', { value: v, text: t, selected: quiz.language === v })));
      langSel.addEventListener('change', () => { quiz.language = langSel.value; touch(); });
      paneTick = null;
      return [h('div', { class: 'qe-head' }, h('h1', { class: 'qe-n', text: 'Settings' })),
        h('div', { class: 'qe-settings-grid' },
          field('Time limit (minutes, 0 = none)', input(q, quiz.timeLimitMin, (v) => { quiz.timeLimitMin = Number(v) || 0; }, { type: 'number', min: '0', max: '600' })),
          field('Window exits allowed before invalidating', input(q, (quiz.integrity || {}).graceStrikes ?? 1, (v) => { quiz.integrity = { graceStrikes: Number(v) || 0 }; }, { type: 'number', min: '0', max: '10' })),
          field('Code highlighting', langSel)),
        h('div', { class: 'qe-line' },
          check(q, quiz.shuffleQuestions !== false, 'Shuffle question order', (v) => { quiz.shuffleQuestions = v; }),
          check(q, quiz.shuffleChoices !== false, 'Shuffle choices', (v) => { quiz.shuffleChoices = v; })),
        poolSettings(q),
        field('Directions for the whole quiz', area(q, dirs.quiz, (v) => setDir('quiz', v), Object.assign({ rows: 3, placeholder: 'Optional' }, prose))),
        used.length ? h('details', { class: 'qe-paste', open: used.some((t) => dirs[t]) },
          h('summary', { text: 'Directions for each part' }),
          used.map((t) => field(TYPES[t], area(q, dirs[t], (v) => setDir(t, v), Object.assign({ rows: 2, placeholder: PART_DIRECTIONS[t] }, prose))))) : null,
        h('details', { class: 'qe-paste' }, h('summary', { text: 'Paste a quiz.json (from an AI)' }),
          h('label', { class: 'field', for: 'paste-json' }, h('span', { class: 'field-label', text: 'quiz.json' }), pasteArea),
          h('div', {}, pasteBtn), pasteMsg)];
    }

    function selectDivider(k) {
      selDiv = k;
      renderPane();
      const t = pane.querySelector('#qe-div-title');
      if (t) t.focus({ preventScroll: true });
      if (matchMedia('(max-width: 1000px)').matches) pane.scrollIntoView({ block: 'start' }); // as select does
    }
    // A divider goes before the open question (the first one from Settings).
    function addDivider() {
      if (!quiz.questions.length) return;
      const at = Math.max(0, sel);
      if (!quiz.sections.some((d) => d.at === at)) {
        quiz.sections.push({ at, title: '', directions: '' });
        quiz.sections.sort((a, b) => a.at - b.at);
        touch();
      }
      selectDivider(quiz.sections.findIndex((d) => d.at === at));
    }
    function dividerPane(k) {
      const d = quiz.sections[k];
      const title = input(null, d.title, (v) => { d.title = v; renderOutline(); }, { id: 'qe-div-title', maxlength: '120', placeholder: `Section ${k + 1}` });
      const dirs = area(null, d.directions, (v) => { d.directions = v; }, { rows: 4, spellcheck: 'true', placeholder: 'Optional' });
      const del = h('button', { class: 'btn small', type: 'button', text: 'Remove section', onclick: () => { quiz.sections.splice(k, 1); touch(); select(d.at); } });
      paneTick = null;
      return [h('div', { class: 'qe-head' }, h('h1', { class: 'qe-n', text: 'Section' }), h('span', { class: 'qe-grow' }), del),
        h('div', { class: 'qe-stack' }, field('Title', title), field('Directions', dirs))];
    }

    function renderPane() {
      const q = quiz.questions[sel];
      const div = selDiv != null ? quiz.sections[selDiv] : null;
      pane.replaceChildren(...(div ? dividerPane(selDiv) : q ? questionPane(q, sel) : settingsPane()).flat(Infinity).filter(Boolean));
      pane.querySelectorAll('textarea.qe-area').forEach(grow);
      if (paneTick) paneTick();
      renderOutline();
    }

    // ---------- the outline ----------
    function renderOutline() {
      problems = quiz.questions.map(problemsOf);
      const kids = [];
      const rows = [];
      quiz.questions.forEach((q, i) => {
        const k = quiz.sections.findIndex((d) => d.at === i);
        if (k >= 0) {
          const d = quiz.sections[k];
          kids.push(h('li', { class: `qe-divider${selDiv === k ? ' sel' : ''}` },
            h('button', { class: 'qe-row-btn', type: 'button', 'aria-current': selDiv === k ? 'true' : null, onclick: () => selectDivider(k) },
              h('span', { class: 'qe-row-text', text: d.title || `Section ${k + 1}` }))));
        }
        if (i === 0 || k >= 0 || quiz.questions[i - 1].type !== q.type) kids.push(h('li', { class: 'qe-part', text: TYPES[q.type] }));
        const text = q.name || snippet(q.prompt);
        const bad = problems[i].length && (tried || fromServer.has(q));
        const here = i === sel && selDiv == null;
        const row = h('li', { class: `qe-row${here ? ' sel' : ''}${bad ? ' bad' : ''}` },
          h('button', { class: 'qe-row-btn', type: 'button', 'aria-current': here ? 'true' : null, onclick: () => select(i, true) },
            h('span', { class: 'qe-row-n', text: String(i + 1) }),
            h('span', { class: `qe-row-text${text ? '' : ' t-muted'}`, text: text || 'No prompt yet' }),
            q.pool ? h('span', { class: 'qe-row-pool', text: q.pool, title: `Question pool: ${q.pool}` }) : null,
            problems[i].length ? h('span', { class: 'qe-dot', title: problems[i].join('\n'), role: 'img', 'aria-label': bad ? 'Has problems' : 'Not finished' }) : null,
            h('span', { class: 'qe-row-pts', text: String(Number(q.points) || 0), title: 'Points' })));
        rows.push(row);
        kids.push(row);
      });
      sortable(rows, moveQuestion);
      outline.replaceChildren(...kids);
      settingsBtn.classList.toggle('sel', sel < 0 && selDiv == null);
      // What each student gets: with pools, that's fewer questions than are written
      const each = { n: 0, pts: 0 };
      const pooled = new Map();
      for (const x of quiz.questions) {
        if (!x.pool) { each.n++; each.pts += Number(x.points) || 0; continue; }
        const p = pooled.get(x.pool) || { n: 0, pts: Number(x.points) || 0 };
        p.n++;
        pooled.set(x.pool, p);
      }
      for (const [name, p] of pooled) { const k = Math.min(p.n, (quiz.pools || {})[name] || 1); each.n += k; each.pts += k * p.pts; }
      const pts = Math.round(each.pts * 100) / 100;
      total.textContent = !quiz.questions.length ? '' : pooled.size
        ? `${plural(quiz.questions.length, 'question')}, ${each.n} each, ${plural(pts, 'point')}`
        : `${plural(quiz.questions.length, 'question')}, ${plural(pts, 'point')}`;
      undoRow.replaceChildren(...(removed ? [`Deleted question ${removed.at + 1}. `, h('button', { class: 't-link', type: 'button', text: 'Undo', onclick: () => {
        const r = removed;
        removed = null;
        for (const d of quiz.sections) if (r.wasStart ? d.at > r.at : d.at >= r.at) d.at++;
        quiz.questions.splice(Math.min(r.at, quiz.questions.length), 0, r.q);
        touch();
        select(quiz.questions.indexOf(r.q));
      } })] : []));
    }

    function select(i, focus) {
      selDiv = null;
      sel = Math.max(-1, Math.min(quiz.questions.length - 1, i));
      renderPane();
      const top = root.getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top) window.scrollTo(0, top);
      const row = outline.querySelector('.sel');
      if (row) row.scrollIntoView({ block: 'nearest' });
      if (focus) { const p = pane.querySelector('#qe-prompt'); if (p) p.focus({ preventScroll: true }); }
      // Narrow screens put the question under the list: go to it.
      if (focus && matchMedia('(max-width: 1000px)').matches) pane.scrollIntoView({ block: 'start' });
    }
    // New questions go next to their own kind, so each type stays one part of the quiz.
    function addQuestion(type) {
      const cur = quiz.questions[sel];
      const like = cur && cur.type === type ? cur : null;
      // After the last of its kind, or else where its part belongs: multiple choice first, written answers last.
      const order = Object.keys(TYPES);
      const rank = order.indexOf(type);
      let at = sel + 1;
      if (!like) { at = 0; quiz.questions.forEach((q, i) => { if (order.indexOf(q.type) <= rank) at = i + 1; }); }
      const q = blank(type, like ? { id: nextId(), points: like.points, mode: type === 'code' ? like.mode : null, languages: like.languagesAny ? 'any' : like.languages && like.languages.slice(), language: like.language } : { id: nextId() });
      if (like && like.shuffleChoices === false) q.shuffleChoices = false;
      for (const d of quiz.sections) if (d.at >= at) d.at++; // a new question joins the section of the one before it
      quiz.questions.splice(at, 0, q);
      removed = null;
      touch();
      select(at, true);
    }
    function duplicate(i) {
      const q = JSON.parse(JSON.stringify(quiz.questions[i]));
      q.id = nextId();
      for (const d of quiz.sections) if (d.at >= i + 1) d.at++;
      quiz.questions.splice(i + 1, 0, q);
      removed = null;
      touch();
      select(i + 1, true);
    }
    function remove(i) {
      // A section left with no questions goes too; later dividers move up one.
      if (quiz.sections.some((d) => d.at === i + 1)) quiz.sections = quiz.sections.filter((d) => d.at !== i);
      const wasStart = quiz.sections.some((d) => d.at === i);
      for (const d of quiz.sections) if (d.at > i) d.at--;
      removed = { q: quiz.questions.splice(i, 1)[0], at: i, wasStart };
      quiz.sections = quiz.sections.filter((d) => d.at < quiz.questions.length);
      touch();
      select(quiz.questions.length ? Math.min(i, quiz.questions.length - 1) : -1);
    }
    function moveQuestion(from, to) {
      if (to < 0 || to >= quiz.questions.length || from === to) return;
      const cur = quiz.questions[sel];
      const active = document.activeElement;
      const keep = pane.contains(active) && active.id ? active.id : null;
      // One step at the edge of a section crosses the divider: the question changes section and stays put,
      // instead of jumping over its neighbor. (Not when it's a section's only question.)
      const at = (i) => quiz.sections.find((d) => d.at === i);
      const crossUp = to === from - 1 && at(from) && !at(from + 1) && from + 1 < quiz.questions.length;
      const crossDown = to === from + 1 && at(to) && !at(from);
      if (crossUp) at(from).at = from + 1;
      else if (crossDown) at(to).at = from;
      else quiz.questions.splice(to, 0, quiz.questions.splice(from, 1)[0]);
      sel = quiz.questions.indexOf(cur);
      removed = null;
      touch();
      renderPane();
      if (keep) { const el = pane.querySelector(`#${keep}`); if (el) el.focus({ preventScroll: true }); }
    }

    // ---------- save ----------
    // Puts what the server said on the questions it's about; returns the lines that fit nowhere.
    function placeServerError(message) {
      const head = /^The (reference solution|output) check failed:\n- /.exec(message);
      const items = head ? message.slice(head[0].length).split('\n- ') : [message];
      const rest = [];
      for (const item of items) {
        let q = null;
        let text = item;
        const m = /^Question (\d+)\b:?\s*/.exec(item);
        if (m) { q = quiz.questions[Number(m[1]) - 1]; text = item.slice(m[0].length); } else {
          q = quiz.questions.find((x) => item.startsWith(`${x.id} `));
          if (q) text = item.slice(q.id.length + 1);
        }
        if (q) fromServer.set(q, (fromServer.get(q) || []).concat(plainer(text))); else rest.push(item);
      }
      return rest.join('\n');
    }
    function showFirstProblem() {
      const i = problems.findIndex((p) => p.length);
      if (i >= 0) select(i);
    }
    async function save() {
      if (saving) return null;
      globalMsg.textContent = '';
      if (!quiz.questions.length) { setStatus('Add a question first.', true); return null; }
      renderOutline();
      const left = problems.filter((p) => p.length).length;
      if (left) {
        tried = true;
        if (!problems[sel] || !problems[sel].length) showFirstProblem(); else renderPane();
        setStatus(`Not saved. ${plural(left, 'question')} to fix`, true);
        return null;
      }
      const out = collect(quiz);
      saving = true;
      saveBtn.disabled = true;
      setStatus('Checking…');
      const at = edits;
      try {
        const used = new Set([...[...out.questions, ...(out.shared || [])].map((q) => q.image).filter(Boolean), ...markdownImages(out)]);
        const assets = Object.fromEntries(Object.entries(newAssets).filter(([p2]) => used.has(p2)));
        const r = await post('/api/t/quizzes/json', { quiz: out, replaces: currentId, assets });
        currentId = r.id;
        if (root.isConnected) window.BQT.setHash('#quiz/' + encodeURIComponent(r.id), true);
        assetQuizId = r.id;
        for (const p2 of Object.keys(assets)) existingAssets.add(p2);
        newAssets = {};
        tried = false;
        removed = null;
        // Show the expected values the reference solutions filled in.
        if (at === edits) {
          dirty = false;
          const src = await api(`/api/t/quizzes/${encodeURIComponent(r.id)}/source`).catch(() => null);
          if (src && at === edits && src.quiz.questions.length === quiz.questions.length) {
            quiz.questions.forEach((q, i) => {
              const s = src.quiz.questions[i];
              if (q.type !== s.type) return;
              if (q.type === 'output') { // what the code printed
                q.answer = s.answer;
                q._ui.auto = s.answer;
                if (i === sel) pane.querySelectorAll('textarea[data-out]').forEach((ta) => { ta.value = s.answer || ''; grow(ta); });
              }
              if (q.type !== 'code' && !(q.type === 'fill' && q._ui.run && s.tests)) return;
              const fresh = withUi(s)._ui;
              q._ui.sample = fresh.sample;
              q._ui.hidden = fresh.hidden;
              if (i === sel) pane.querySelectorAll('textarea[data-tests]').forEach((ta) => { ta.value = q._ui[ta.dataset.tests]; grow(ta); });
            });
          }
        }
        const shown = quiz.questions[sel];
        if (shown && shown.image) pane.querySelectorAll('img.qe-thumb, img.qimg').forEach((img) => { img.src = imageSrc(shown); });
        refreshSoon();
        setStatus(dirty ? '' : 'Saved');
        return r.id;
      } catch (e) {
        if (e.message === 'login') return null;
        globalMsg.textContent = placeServerError(e.message);
        renderOutline();
        showFirstProblem();
        setStatus('Not saved', true);
        return null;
      } finally { saving = false; saveBtn.disabled = false; }
    }
    const saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Save', title: `${MOD}S`, onclick: () => save() });
    const previewBtn = h('button', { class: 'btn', type: 'button', text: 'Preview' });
    previewBtn.addEventListener('click', async () => {
      const w = window.open('about:blank', '_blank'); // open now: after the save, a popup blocker would stop it
      const saved = dirty || !currentId ? await save() : currentId;
      if (saved && w) w.location = `/teacher/preview.html?quiz=${encodeURIComponent(saved)}`;
      else if (w) w.close();
    });
    const leave = () => { if (!dirty || confirm('Leave without saving?')) showHome('quizzes'); };

    const title = h('input', { class: 'input qe-title', value: quiz.title || '', placeholder: 'Quiz title', 'aria-label': 'Title', maxlength: '120' });
    title.addEventListener('input', () => { quiz.title = title.value; touch(); });
    const short = { single: 'Multiple choice', multi: 'Select all', text: 'Short answer', output: 'Output', trace: 'Trace table', fill: 'Fill in blanks', code: 'Code', essay: 'Written' };
    const keys = [[`${MOD}Enter`, 'New question'], [`${ALT}↑ ↓`, 'Previous, next question'], [`${ALT}Shift+↑ ↓`, 'Move question'], ['Enter', 'Next choice'], ['Esc, then Tab', 'Leave a code box'], [`${MOD}S`, 'Save']];
    const root = h('div', { class: 'qe' },
      h('div', { class: 'qe-bar' }, title, h('span', { class: 'qe-grow' }), status, previewBtn, saveBtn),
      globalMsg,
      h('div', { class: 'qe-body' },
        h('nav', { class: 'qe-side', 'aria-label': 'Questions' },
          settingsBtn, total, outline, undoRow,
          h('div', { class: 'qe-add' }, h('span', { class: 'field-label', text: 'Add' }),
            h('div', { class: 'qe-add-btns' }, Object.keys(TYPES).map((t) => h('button', { class: 'btn small', type: 'button', text: short[t], 'data-add': t, onclick: () => addQuestion(t) })),
              h('button', { class: 'btn small qe-add-section', type: 'button', text: 'Section divider', title: 'Starts a section at the open question', onclick: addDivider }))),
          h('details', { class: 'qe-keys t-small' }, h('summary', { text: 'Shortcuts' }),
            h('dl', {}, keys.map(([k, what]) => [h('dt', { text: k }), h('dd', { text: what })])))),
        pane));

    function onKey(e) {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        addQuestion(quiz.questions[sel] ? quiz.questions[sel].type : quiz.questions.length ? quiz.questions[quiz.questions.length - 1].type : 'single');
      } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const d = e.key === 'ArrowUp' ? -1 : 1;
        if (e.shiftKey) { if (sel >= 0) moveQuestion(sel, sel + d); } else select(sel + d, true);
      }
    }
    function onUnload(e) {
      if (!root.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);

    mount(bar(h('button', { class: 't-link t-back', type: 'button', onclick: leave }, icon(ICONS.back, 16), 'Quizzes')), root);
    // The browser's Back button asks too.
    window.BQT.guard(() => !dirty || confirm('Leave without saving?'));
    renderPane();
    if (!id && !preset) title.focus();
  }

  window.BQT.showQuizEditor = showQuizEditor;
})();
