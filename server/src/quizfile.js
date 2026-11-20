'use strict';
// Loads and validates a .quiz upload: a zip with quiz.json at the root and images under assets/.
// Everything that reaches the database has passed through here.
const { readZip } = require('./zip');

const LIMITS = { uploadBytes: 25 * 1024 * 1024, files: 500, questions: 300, arrayLen: 1000 };
const ASSET_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const VALUE_TYPES = ['int', 'long', 'double', 'boolean', 'string', 'int[]', 'long[]', 'double[]', 'boolean[]', 'string[]', 'int[][]', 'list<int>', 'list<string>'];
const LANGS = ['java', 'python'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const QID = /^[A-Za-z0-9_-]{1,40}$/;
const RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits '
  + 'and as async await def del elif except from global in is lambda nonlocal not or pass raise with None True False print '
  + '__proto__ constructor prototype Main BQJ bqh solution support').split(/\s+/));
const PART_TYPES = ['single', 'multi', 'text', 'code'];

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
function checkArgs(where, params, args) {
  if (!Array.isArray(args) || args.length !== params.length) fail(`${where}: needs ${params.length} argument(s).`);
  args.forEach((a, i) => { if (!checkValue(params[i].type, a)) fail(`${where}: argument ${i + 1} isn't a valid ${params[i].type}.`); });
  return args;
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
    if (!PART_TYPES.includes(type)) fail(`${where}: type must be single, multi, text or code.`);
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
    } else {
      Object.assign(out, normalizeCode(where, q));
    }
    quiz.questions.push(out);
  });
  return quiz;
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
      if (raw.expected === undefined) {
        if (!hasRef) fail(`${w}: needs "expected", or add a reference solution to fill it in.`);
        return { args, weight };
      }
      if (!checkValue(out.signature.returns, raw.expected)) fail(`${w}: expected isn't a valid ${out.signature.returns}.`);
      return { args, expected: raw.expected, weight };
    }
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
  out.reference = reference;
  out.compare = q.compare === 'unordered' ? 'unordered' : 'ordered';
  const lim = q.limits || {};
  out.limits = {
    timeMs: Math.max(200, Math.min(5000, Number(lim.timeMs) || 2000)),
    memoryMb: Math.max(64, Math.min(512, Number(lim.memoryMb) || 256)),
  };
  out.rubric = [];
  if (Array.isArray(q.rubric)) {
    out.rubric = q.rubric.slice(0, 20).map((r, i) => ({
      id: String(r.id || `r${i + 1}`).slice(0, 40), text: String(r.text || '').slice(0, 500), points: Math.max(0, Number(r.points) || 0),
    }));
  }
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

module.exports = { loadQuizFile, normalizeQuiz, checkValue, elementType, QuizError, VALUE_TYPES, LIMITS };
