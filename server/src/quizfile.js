'use strict';
// Loads and validates a .quiz upload: a zip with quiz.json at the root and images under assets/.
// Everything that reaches the database has passed through here.
const { readZip } = require('./zip');
const R = require('./rubric');

const LIMITS = { uploadBytes: 25 * 1024 * 1024, files: 500, questions: 300, arrayLen: 1000 };
const ASSET_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const VALUE_TYPES = ['int', 'long', 'double', 'boolean', 'string', 'int[]', 'long[]', 'double[]', 'boolean[]', 'string[]', 'int[][]', 'list<int>', 'list<string>'];
const LANGS = ['java', 'python'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const QID = /^[A-Za-z0-9_-]{1,40}$/;
const RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits '
  + 'and as async await def del elif except from global in is lambda nonlocal not or pass raise with None True False print '
  + '__proto__ constructor prototype Main BQJ bqh solution support').split(/\s+/));
const PART_TYPES = ['single', 'multi', 'text', 'code', 'output', 'trace', 'fill', 'essay'];
const BLANK = /_{3,}/g;

// Program output, compared ignoring trailing spaces on each line and blank lines at the start and end.
const normOutput = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
// A fill-in blank or a trace cell: spacing doesn't matter. Cells also accept "abc" for abc.
const normBlank = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
const normCell = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').replace(/^"(.*)"$/, '$1');
const fillTemplate = (code, blanks) => { let i = 0; return code.replace(BLANK, () => String(blanks[i++] == null ? '' : blanks[i - 1])); };

class QuizError extends Error {}
const fail = (msg) => { throw new QuizError(msg); };

function loadQuizFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) fail('The upload was empty.');
  if (buf.length > LIMITS.uploadBytes) fail('The .quiz file is bigger than 25 MB.');
  let files;
  try { files = readZip(buf); } catch (e) { fail("That file isn't a valid .quiz file (it should be a zip): " + e.message); }
  for (const name of [...files.keys()]) {
    if (name.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name)) files.delete(name);
    else if (name.startsWith('/') || name.split('/').some((s) => s === '..' || s === '')) fail(`Bad file name in the zip: ${name}`);
  }
  if (files.size > LIMITS.files) fail(`The .quiz has more than ${LIMITS.files} files.`);

  let prefix = '';
  if (!files.has('quiz.json')) {
    const hits = [...files.keys()].filter((n) => /^[^/]+\/quiz\.json$/.test(n));
    if (hits.length !== 1) fail('quiz.json must be at the root of the .quiz file.');
    prefix = hits[0].slice(0, -'quiz.json'.length);
  }
  let raw;
  try { raw = JSON.parse(files.get(prefix + 'quiz.json').toString('utf8').replace(/^﻿/, '')); } catch (e) { fail('quiz.json is not valid JSON: ' + e.message); }

  const assets = new Map();
  for (const [name, data] of files) {
    if (!name.startsWith(prefix + 'assets/')) continue;
    const rel = name.slice(prefix.length);
    const ext = (rel.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
    if (!ASSET_TYPES[ext]) fail(`${rel}: only png, jpg, gif and webp images are allowed in assets/.`);
    assets.set(rel, { mime: ASSET_TYPES[ext], bytes: data });
  }
  return { quiz: normalizeQuiz(raw, new Set(assets.keys())), assets };
}

// ---------- values ----------
function checkValue(type, v) {
  if (v === null) return type === 'string' || type.endsWith('[]') || type.startsWith('list<');
  switch (type) {
    case 'int': return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
    case 'long': return Number.isSafeInteger(v);
    case 'double': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string' && v.length <= 10000;
    default: break;
  }
  if (!Array.isArray(v) || v.length > LIMITS.arrayLen) return false;
  return v.every((x) => checkValue(elementType(type), x));
}
function elementType(type) {
  if (type === 'int[][]') return 'int[]';
  if (type.endsWith('[]')) return type.slice(0, -2);
  if (type.startsWith('list<')) return type.slice(5, -1);
  return null;
}

function checkIdent(where, name) {
  if (typeof name !== 'string' || !IDENT.test(name) || RESERVED.has(name)) fail(`${where}: "${name}" isn't a usable name.`);
  return name;
}
function checkParams(where, params) {
  if (!Array.isArray(params)) fail(`${where}: params must be a list.`);
  const seen = new Set();
  return params.map((p, i) => {
    const name = checkIdent(`${where}.params[${i}]`, p && p.name);
    if (seen.has(name)) fail(`${where}: duplicate parameter "${name}".`);
    seen.add(name);
    if (!VALUE_TYPES.includes(p.type)) fail(`${where}.params[${i}]: type must be one of ${VALUE_TYPES.join(', ')}.`);
    return { name, type: p.type };
  });
}
// A big argument made in the sandbox instead of written out: { "range": [start, stop, step?] } is
// start, start+step, ... up to (not including) stop, like Python's range. For int[], long[] and list<int>.
const RANGE_TYPES = ['int[]', 'long[]', 'list<int>'];
const MAX_RANGE = 10000000;
const isRange = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.range);
function rangeLength([start, stop, step]) {
  return step > 0 ? Math.max(0, Math.ceil((stop - start) / step)) : Math.max(0, Math.ceil((start - stop) / -step));
}
function checkRange(where, type, v) {
  const r = v.range;
  if (!RANGE_TYPES.includes(type)) fail(`${where}: range only works for ${RANGE_TYPES.join(', ')}.`);
  if (r.length < 2 || r.length > 3 || !r.every(Number.isSafeInteger)) fail(`${where}: range needs [start, stop] or [start, stop, step], all whole numbers.`);
  const [start, stop, step = 1] = r;
  if (step === 0) fail(`${where}: a range's step can't be 0.`);
  const n = rangeLength([start, stop, step]);
  if (n > MAX_RANGE) fail(`${where}: a range can have at most ${MAX_RANGE.toLocaleString('en-US')} numbers.`);
  const last = start + (n - 1) * step;
  if (type !== 'long[]' && n && [start, last].some((x) => x < -2147483648 || x > 2147483647)) fail(`${where}: range goes past the int limits.`);
  return { range: [start, stop, step] };
}
function checkArgs(where, params, args) {
  if (!Array.isArray(args) || args.length !== params.length) fail(`${where}: needs ${params.length} argument(s).`);
  return args.map((a, i) => {
    if (isRange(a)) return checkRange(`${where}: argument ${i + 1}`, params[i].type, a);
    if (!checkValue(params[i].type, a)) fail(`${where}: argument ${i + 1} isn't a valid ${params[i].type}.`);
    return a;
  });
}

// ---------- quiz ----------
function normalizeQuiz(raw, assetNames) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('quiz.json must be an object.');
  const g = raw.integrity || {};
  const quiz = {
    format: 1,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : 'Untitled quiz',
    timeLimitMin: Number(raw.timeLimitMin) > 0 ? Math.min(600, Math.round(Number(raw.timeLimitMin))) : 0,
    shuffleQuestions: raw.shuffleQuestions !== false,
    shuffleChoices: raw.shuffleChoices !== false,
    language: LANGS.includes(raw.language) ? raw.language : 'java',
    integrity: { graceStrikes: Math.max(0, Math.min(10, Math.floor(Number(g.graceStrikes) || 0))) },
    directions: {},
    questions: [],
  };
  if (raw.directions && typeof raw.directions === 'object') {
    for (const t of PART_TYPES) {
      if (typeof raw.directions[t] === 'string' && raw.directions[t].trim()) quiz.directions[t] = raw.directions[t].trim().slice(0, 2000);
    }
  }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) fail('quiz.json needs a non-empty "questions" list.');
  if (raw.questions.length > LIMITS.questions) fail(`A quiz can have at most ${LIMITS.questions} questions.`);
  const ids = new Set();
  raw.questions.forEach((q, i) => {
    const where = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') fail(`${where} must be an object.`);
    const id = q.id == null ? `q${i + 1}` : String(q.id);
    if (!QID.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail(`${where}: id "${id}" can only use letters, digits, - and _.`);
    if (ids.has(id)) fail(`${where}: duplicate id "${id}".`);
    ids.add(id);
    const type = q.type || 'single';
    if (!PART_TYPES.includes(type)) fail(`${where}: type must be single, multi, text, code, output, trace, fill or essay.`);
    if (typeof q.prompt !== 'string' || !q.prompt.trim()) fail(`${where}: prompt is required.`);
    const out = { id, type, prompt: q.prompt.slice(0, 10000), points: Number(q.points) > 0 ? Math.min(1000, Number(q.points)) : 1 };
    if (q.image != null) {
      const img = String(q.image).replace(/^\.?\//, '');
      if (!assetNames.has(img)) fail(`${where}: image "${img}" isn't in the assets folder.`);
      out.image = img;
      if (typeof q.imageAlt === 'string') out.imageAlt = q.imageAlt.slice(0, 300);
    }
    if (type === 'text') {
      const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
      if (!ans.length || ans.some((a) => typeof a !== 'string' || !a.trim())) fail(`${where}: answer must be a string or a list of strings.`);
      out.answer = ans.map(String);
      out.caseSensitive = !!q.caseSensitive;
    } else if (type === 'single' || type === 'multi') {
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 8) fail(`${where}: needs 2 to 8 choices.`);
      out.choices = q.choices.map((c) => String(c).slice(0, 2000));
      const ans = type === 'single' ? [q.answer] : q.answer;
      if (!Array.isArray(ans) || !ans.length || ans.some((a) => !Number.isInteger(a) || a < 0 || a >= out.choices.length)) {
        fail(`${where}: answer must be ${type === 'single' ? 'one choice index' : 'a list of choice indexes'}, counting from 0.`);
      }
      out.answer = type === 'single' ? q.answer : [...new Set(q.answer)].sort((a, b) => a - b);
      if (q.shuffleChoices === false) out.shuffleChoices = false; // e.g. "I only", "I and II", ... in order
    } else if (type === 'code') {
      Object.assign(out, normalizeCode(where, q));
    } else {
      Object.assign(out, normalizeNewType(where, type, q, quiz.language, out.points));
    }
    quiz.questions.push(out);
  });
  return quiz;
}

// output (predict what it prints), trace (trace table), fill (fill in the blanks), essay (teacher-graded).
function normalizeNewType(where, type, q, quizLang, points) {
  const out = {};
  const lang = LANGS.includes(q.language) ? q.language : quizLang;
  const code = (need) => {
    if (typeof q.code !== 'string' || !q.code.trim()) {
      if (need) fail(`${where}: needs "code".`);
      return null;
    }
    return q.code.replace(/\r\n?/g, '\n').slice(0, 20000);
  };
  if (type === 'output') {
    out.code = code(true);
    out.language = lang;
    // Optional: worked out by running the code at upload.
    if (q.answer != null) {
      if (typeof q.answer !== 'string') fail(`${where}: answer must be the exact output, as a string.`);
      out.answer = normOutput(q.answer).slice(0, 5000);
    }
  } else if (type === 'trace') {
    out.code = code(false);
    out.language = lang;
    if (!Array.isArray(q.columns) || q.columns.length < 1 || q.columns.length > 8) fail(`${where}: needs 1 to 8 columns.`);
    out.columns = q.columns.map((c, i) => {
      if (typeof c !== 'string' || !c.trim()) fail(`${where}: column ${i + 1} needs a name.`);
      return c.trim().slice(0, 40);
    });
    if (!Array.isArray(q.rows) || q.rows.length < 1 || q.rows.length > 40) fail(`${where}: needs 1 to 40 rows.`);
    out.rows = q.rows.map((r, ri) => {
      if (!Array.isArray(r) || r.length !== out.columns.length) fail(`${where}: row ${ri + 1} needs ${out.columns.length} values, one per column.`);
      return r.map((v, ci) => {
        if (v == null || (typeof v === 'object')) fail(`${where}: row ${ri + 1}, column ${ci + 1} needs a value.`);
        return String(v).trim().slice(0, 200);
      });
    });
    // Cells shown filled in (not graded), as [row, column] counting from 0.
    const given = new Set();
    for (const g of Array.isArray(q.given) ? q.given : []) {
      if (!Array.isArray(g) || !Number.isInteger(g[0]) || !Number.isInteger(g[1]) || g[0] < 0 || g[1] < 0 || g[0] >= out.rows.length || g[1] >= out.columns.length) {
        fail(`${where}: each "given" cell is [row, column], counting from 0.`);
      }
      given.add(g[0] + ',' + g[1]);
    }
    out.given = [...given].map((k) => k.split(',').map(Number));
    if (given.size >= out.rows.length * out.columns.length) fail(`${where}: at least one cell has to be left for the student.`);
  } else if (type === 'fill') {
    out.code = code(true);
    out.language = lang;
    const blanks = (out.code.match(BLANK) || []).length;
    if (blanks < 1 || blanks > 30) fail(`${where}: mark 1 to 30 blanks in the code with ___ (three or more underscores).`);
    if (!Array.isArray(q.answer) || q.answer.length !== blanks) fail(`${where}: answer needs ${blanks} entries, one per blank.`);
    out.answer = q.answer.map((a, i) => {
      const list = (Array.isArray(a) ? a : [a]).map((x) => (x == null ? '' : String(x)));
      if (!list.length || list.some((x) => !x.trim())) fail(`${where}: blank ${i + 1} needs an answer (a string, or a list of accepted ones).`);
      return list.map((x) => x.slice(0, 500));
    });
    // With tests, the filled-in code is run and any blanks that work earn credit.
    if (q.tests) {
      const c = normalizeCode(where, Object.assign({}, q, {
        languages: [lang], reference: { [lang]: fillTemplate(out.code, out.answer.map((a) => a[0])) }, starter: null, support: q.support,
      }));
      Object.assign(out, c, { run: true, language: lang, code: out.code, answer: out.answer });
    }
  } else if (type === 'essay') {
    // Graded by the teacher. With a language, students get a code box instead of a text box.
    out.language = LANGS.includes(q.language) ? q.language : null;
    out.rubric = (Array.isArray(q.rubric) ? q.rubric : []).slice(0, 20).map((r, i) => {
      if (r && (r.require || r.forbid)) fail(`${where}, rubric item ${i + 1}: "require" and "forbid" only work on code questions. The teacher grades written answers.`);
      return { id: String(r.id || `r${i + 1}`).slice(0, 40), text: String(r.text || '').slice(0, 500), points: Math.max(0, Number(r.points) || 0) };
    });
    if (out.rubric.reduce((s, r) => s + r.points, 0) > points) fail(`${where}: rubric points add up to more than the question is worth.`);
  }
  return out;
}

function normalizeCode(where, q) {
  const mode = q.mode === 'class' ? 'class' : 'method';
  const languages = Array.isArray(q.languages) && q.languages.length ? [...new Set(q.languages)] : ['java'];
  if (languages.some((l) => !LANGS.includes(l))) fail(`${where}: languages can only be java and/or python.`);
  const out = { mode, languages };
  if (mode === 'method') {
    const s = q.signature || {};
    out.signature = { name: checkIdent(`${where}.signature.name`, s.name), params: checkParams(`${where}.signature`, s.params || []), returns: s.returns };
    if (!VALUE_TYPES.includes(s.returns)) fail(`${where}.signature.returns must be one of ${VALUE_TYPES.join(', ')}.`);
  } else {
    const c = q.class || {};
    const name = checkIdent(`${where}.class.name`, c.name);
    if (!/^[A-Z]/.test(name)) fail(`${where}.class.name should start with a capital letter.`);
    const methods = Array.isArray(c.methods) ? c.methods : [];
    const seen = new Set();
    out.class = {
      name,
      constructor: checkParams(`${where}.class.constructor`, c.constructor || []),
      methods: methods.map((m, i) => {
        const mn = checkIdent(`${where}.class.methods[${i}].name`, m && m.name);
        if (seen.has(mn)) fail(`${where}: method "${mn}" is listed twice (overloads aren't supported).`);
        seen.add(mn);
        if (m.returns !== 'void' && !VALUE_TYPES.includes(m.returns)) fail(`${where}.class.methods[${i}].returns must be void or one of ${VALUE_TYPES.join(', ')}.`);
        return { name: mn, params: checkParams(`${where}.class.methods[${i}]`, m.params || []), returns: m.returns };
      }),
    };
  }
  const t = q.tests || {};
  const hidden = Array.isArray(t.hidden) ? t.hidden : [];
  const sample = Array.isArray(t.sample) ? t.sample : [];
  if (!hidden.length) fail(`${where}: needs at least one hidden test.`);
  if (hidden.length > 100 || sample.length > 10) fail(`${where}: at most 100 hidden and 10 sample tests.`);
  const reference = {};
  if (q.reference && typeof q.reference === 'object') {
    for (const l of languages) if (typeof q.reference[l] === 'string') reference[l] = q.reference[l].slice(0, 50000);
  }
  const hasRef = Object.keys(reference).length > 0;
  const normTest = (kind, raw, i) => {
    const w = `${where}.tests.${kind}[${i}]`;
    if (!raw || typeof raw !== 'object') fail(`${w} must be an object.`);
    const weight = Number(raw.weight) > 0 ? Math.min(100, Number(raw.weight)) : 1;
    if (mode === 'method') {
      const args = checkArgs(w, out.signature.params, raw.args);
      // Speed test: the method is called `calls` times and must finish within 10x the reference's time.
      const speed = raw.speed === true ? { speed: true, calls: Math.max(1, Math.min(100000, Math.floor(Number(raw.calls) || 1))) } : {};
      if (raw.expected === undefined) {
        if (!hasRef) fail(`${w}: needs "expected", or add a reference solution to fill it in.`);
        return { args, weight, ...speed };
      }
      if (!checkValue(out.signature.returns, raw.expected)) fail(`${w}: expected isn't a valid ${out.signature.returns}.`);
      return { args, expected: raw.expected, weight, ...speed };
    }
    if (raw.speed) fail(`${w}: speed tests only work on "write a method" questions.`);
    if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 200) fail(`${w}: needs 1 to 200 steps.`);
    const objects = new Set();
    let lastObj = null;
    const steps = raw.steps.map((s, k) => {
      const sw = `${w}.steps[${k}]`;
      if (s && Array.isArray(s.new)) {
        const as = s.as == null ? 'a' : checkIdent(`${sw}.as`, s.as);
        checkArgs(sw, out.class.constructor, s.new);
        objects.add(as);
        lastObj = as;
        return { new: s.new, as };
      }
      const m = out.class.methods.find((x) => x.name === (s && s.call));
      if (!m) fail(`${sw}: call must name one of the class's methods.`);
      const on = s.on == null ? lastObj : String(s.on);
      if (!on || !objects.has(on)) fail(`${sw}: there's no object "${on}" to call ${m.name} on yet.`);
      const args = checkArgs(sw, m.params, s.args || []);
      const step = { call: m.name, args, on };
      if (s.expect !== undefined) {
        if (m.returns === 'void') fail(`${sw}: ${m.name} returns nothing, so it can't have expect.`);
        if (!checkValue(m.returns, s.expect)) fail(`${sw}: expect isn't a valid ${m.returns}.`);
        step.expect = s.expect;
      } else if (s.check === true && m.returns !== 'void') {
        if (!hasRef) fail(`${sw}: "check": true needs a reference solution to fill in the value.`);
        step.check = true;
      }
      return step;
    });
    return { steps, weight };
  };
  out.tests = { sample: sample.map((x, i) => normTest('sample', x, i)), hidden: hidden.map((x, i) => normTest('hidden', x, i)) };
  const noRef = languages.filter((l) => !reference[l]);
  if (noRef.length && [...out.tests.sample, ...out.tests.hidden].some((t) => t.speed)) {
    fail(`${where}: speed tests are timed against the reference solution, so add one for ${noRef.map((l) => (l === 'python' ? 'Python' : 'Java')).join(' and ')}.`);
  }
  out.reference = reference;
  out.compare = q.compare === 'unordered' ? 'unordered' : 'ordered';
  const lim = q.limits || {};
  out.limits = {
    timeMs: Math.max(200, Math.min(5000, Number(lim.timeMs) || 2000)),
    memoryMb: Math.max(64, Math.min(512, Number(lim.memoryMb) || 256)),
  };
  out.rubric = [];
  if (Array.isArray(q.rubric)) {
    out.rubric = q.rubric.slice(0, 20).map((r, i) => {
      const item = { id: String(r.id || `r${i + 1}`).slice(0, 40), text: String(r.text || '').slice(0, 500), points: Math.max(0, Number(r.points) || 0) };
      try {
        const require = R.normalizePattern(r.require, languages, 'require');
        const forbid = R.normalizePattern(r.forbid, languages, 'forbid');
        if (require) item.require = require;
        if (forbid) item.forbid = forbid;
      } catch (e) {
        fail(`${where}, rubric item ${i + 1}: ${e.message}`);
      }
      return item;
    });
  }
  // Checked rubric items must give the reference solution its points, the same way the tests must.
  out.rubric.forEach((item, i) => {
    for (const lang of languages) {
      const rule = R.ruleFor(item, lang);
      if (!rule || !reference[lang]) continue;
      const r = R.check(rule, R.stripCode(reference[lang], lang));
      const name = lang === 'python' ? 'Python' : 'Java';
      if (r.ok === null) fail(`${where}, rubric item ${i + 1}: the ${name} pattern takes too long to run. Make it simpler.`);
      if (!r.ok) fail(`${where}, rubric item ${i + 1}: the ${name} reference solution ${r.why === 'require' ? "doesn't match \"require\"" : 'matches "forbid"'}.`);
    }
  });
  const rubricPoints = out.rubric.reduce((s, r) => s + r.points, 0);
  if (rubricPoints >= Number(q.points || 1)) fail(`${where}: rubric points must be less than the question's points, so the tests are worth something.`);
  // starter: "empty" | "stubs" (default) | { java: "...custom...", python: "..." }
  out.starterStyle = q.starter === 'empty' ? 'empty' : 'stubs';
  out.starter = {};
  out.support = {};
  for (const l of languages) {
    const s = q.starter && typeof q.starter === 'object' ? q.starter[l] : null;
    out.starter[l] = typeof s === 'string' ? s.slice(0, 50000) : null;
    if (q.support && typeof q.support[l] === 'string') out.support[l] = q.support[l].slice(0, 50000);
  }
  return out;
}

module.exports = { loadQuizFile, normalizeQuiz, checkValue, elementType, isRange, rangeLength, QuizError, VALUE_TYPES, LIMITS, ASSET_TYPES, normOutput, normBlank, normCell, fillTemplate };
