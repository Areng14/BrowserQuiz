// Questions as the quiz maker holds them, and back to quiz.json (collect).

import { BT, LANGS, checkClassTests, checkMethodTests, classTestsText, classesJson, classesText, countBlanks, curD, fullSig, methodTestsText, parseClassTests, parseClasses, parseMethodTests, parseSig, setD, sigText } from './formats.js';

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
    setD(q.types ? Object.fromEntries(Object.entries(q.types).map(([n, fs]) => [n, Array.isArray(fs) ? fs : Object.entries(fs).map(([name, type]) => ({ name, type }))])) : null);
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
  setD(null);
  try { r.types = parseClasses(u.types); setD(r.types); } catch (e) { r.shapeErrors.push(`Classes: ${e.message}`); }
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
    .map((d) => Object.assign({ before: quiz.questions[d.at].id, title: (d.title || '').trim(), directions: (d.directions || '').trim() }, d.timeLimitMin > 0 ? { timeLimitMin: d.timeLimitMin } : {}, d.calculator ? { calculator: d.calculator } : {}));
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

export { blank, collect, plainer, readCode, readTrace, realign, refLangsOf, starterCode, withUi };
