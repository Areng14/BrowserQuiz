'use strict';
// Loads and validates a .quiz upload: a zip with quiz.json at the root and images under assets/.
// Everything that reaches the database has passed through here.
const { readZip } = require('./zip');
const R = require('./rubric');
const B = require('./bans');
const T = require('../../public/teacher/types.js');

const LIMITS = { uploadBytes: 25 * 1024 * 1024, files: 500, questions: 300, arrayLen: 1000 };
const ASSET_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const LANGS = T.LANGS;
const langName = (l) => T.LANG_NAMES[l] || l;
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
  try { files = readZip(buf); } catch (e) { fail("That isn't a .quiz file. Pick a .quiz from BrowserQuiz, or a quiz.json."); }
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
// Types and their values live in public/teacher/types.js, shared with the quiz maker.
const { checkValue, elementType } = T;
function checkType(where, t, allowVoid, D) {
  const c = T.canon(t);
  if (allowVoid && c === 'void') return c;
  if (!T.isValueType(c, D)) fail(`${where}: "${t}" isn't a type. Use ${T.HELP}${allowVoid ? ', or void' : ''}.`);
  return c;
}

function checkIdent(where, name) {
  if (typeof name !== 'string' || !IDENT.test(name) || RESERVED.has(name)) fail(`${where}: "${name}" isn't a usable name.`);
  return name;
}
function checkParams(where, params, D) {
  if (!Array.isArray(params)) fail(`${where}: params must be a list.`);
  const seen = new Set();
  return params.map((p, i) => {
    const name = checkIdent(`${where}.params[${i}]`, p && p.name);
    if (seen.has(name)) fail(`${where}: duplicate parameter "${name}".`);
    seen.add(name);
    return { name, type: checkType(`${where}.params[${i}]`, p.type, false, D) };
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
function checkArgs(where, params, args, D) {
  if (!Array.isArray(args) || args.length !== params.length) fail(`${where}: needs ${params.length} argument(s).`);
  return args.map((a, i) => {
    if (isRange(a) && RANGE_TYPES.includes(params[i].type)) return checkRange(`${where}: argument ${i + 1}`, params[i].type, a);
    if (!checkValue(params[i].type, a, D)) fail(`${where}: argument ${i + 1} isn't a valid ${params[i].type}.`);
    return a;
  });
}

// ---------- random values ----------
// A question's `vars`: rows of values ({ "x": 7, "out": "1" }). Each student gets one row, put in for
// {{x}} everywhere in the question's text, answers included, so different students see different numbers.
// Not on code, fill or essay questions: their hidden tests, runs and grading don't change per student.
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;
const VAR_REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VAR_TYPES = new Set(['single', 'multi', 'text', 'output', 'trace']);
function putVars(v, row) {
  if (typeof v === 'string') return v.replace(VAR_REF, (m, name) => (Object.hasOwn(row, name) ? row[name] : m));
  if (Array.isArray(v)) return v.map((x) => putVars(x, row));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'vars') out[k] = putVars(x, row);
    return out;
  }
  return v;
}
function checkVars(where, q, type) {
  if (!VAR_TYPES.has(type)) fail(`${where}: random values (vars) work on single, multi, text, output and trace questions.`);
  const rows = q.vars;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 30) fail(`${where}: vars must be a list of 2 to 30 rows, like [{ "x": 3 }, { "x": 5 }].`);
  let names = null;
  const out = rows.map((row, r) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${where}: vars row ${r + 1} must be an object, like { "x": 3 }.`);
    const keys = Object.keys(row);
    if (!keys.length || keys.length > 10) fail(`${where}: each vars row needs 1 to 10 values.`);
    for (const k of keys) if (!VAR_NAME.test(k)) fail(`${where}: "${k}" in vars isn't a name (letters, digits and _, starting with a letter).`);
    if (names && (keys.length !== names.length || keys.some((k) => !names.includes(k)))) fail(`${where}: every vars row needs the same names (${names.join(', ')}).`);
    names = names || keys;
    const clean = {};
    for (const k of keys) {
      const v = row[k];
      if (!['string', 'number', 'boolean'].includes(typeof v)) fail(`${where}: vars row ${r + 1}: "${k}" must be text or a number.`);
      clean[k] = String(v).slice(0, 200);
    }
    return clean;
  });
  const used = new Set();
  const scan = (v) => {
    if (typeof v === 'string') for (const m of v.matchAll(VAR_REF)) used.add(m[1]);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'vars') scan(x);
  };
  scan(q);
  if (!used.size) fail(`${where}: it has vars, but nothing uses them. Write {{${names[0]}}} where a value goes.`);
  for (const n of used) if (!names.includes(n)) fail(`${where}: {{${n}}} isn't one of its vars (${names.join(', ')}).`);
  return out;
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
    // Once a student moves on from a part, its answers are final (student.js keepLocked).
    lockParts: raw.lockParts === true,
    // A timed exam turns in when time is up; with this, students can also turn it in before that.
    turnInEarly: raw.turnInEarly === true,
    // How inline code is highlighted; "none" leaves it plain (say, networking or math quizzes).
    language: LANGS.includes(raw.language) || raw.language === 'none' ? raw.language : 'java',
    // One free slip by default: the student gets the "You left the quiz" warning, and the second time counts.
    integrity: { graceStrikes: g.graceStrikes == null || g.graceStrikes === '' ? 1 : Math.max(0, Math.min(10, Math.floor(Number(g.graceStrikes) || 0))) },
    directions: {},
    questions: [],
  };
  if (raw.directions && typeof raw.directions === 'object') {
    for (const t of PART_TYPES) {
      if (typeof raw.directions[t] === 'string' && raw.directions[t].trim()) quiz.directions[t] = raw.directions[t].trim().slice(0, 2000);
    }
    // The teacher's own directions for the whole quiz (Markdown): on the start screen and with each part's.
    if (typeof raw.directions.quiz === 'string' && raw.directions.quiz.trim()) quiz.directions.quiz = raw.directions.quiz.trim().slice(0, 4000);
  }
  // An image on a question or a shared material: a file in assets/, with alt text.
  const imageOf = (where, src, out) => {
    if (src.image == null) return;
    const img = String(src.image).replace(/^\.?\//, '');
    if (!assetNames.has(img)) fail(`${where}: image "${img}" isn't in the assets folder.`);
    out.image = img;
    if (typeof src.imageAlt === 'string') out.imageAlt = src.imageAlt.slice(0, 300);
  };
  // Shared material: a passage, case or code listing that several questions use, written once.
  if (raw.shared != null) {
    if (!Array.isArray(raw.shared)) fail('"shared" must be a list.');
    if (raw.shared.length > 50) fail('A quiz can have at most 50 shared materials.');
    const sids = new Set();
    quiz.shared = raw.shared.map((m, i) => {
      const where = `Shared material ${i + 1}`;
      if (!m || typeof m !== 'object') fail(`${where} must be an object.`);
      const id = m.id == null ? `s${i + 1}` : String(m.id);
      if (!QID.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail(`${where}: id "${id}" can only use letters, digits, - and _.`);
      if (sids.has(id)) fail(`${where}: duplicate id "${id}".`);
      sids.add(id);
      const out = { id, title: typeof m.title === 'string' ? m.title.trim().slice(0, 120) : '', text: typeof m.text === 'string' ? m.text.slice(0, 20000) : '' };
      imageOf(where, m, out);
      if (!out.text.trim() && !out.image) fail(`${where}: needs text or an image.`);
      return out;
    });
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
    // The question from its raw form. Run once as written, and once per row of random values to check them.
    const build = (q) => {
      if (typeof q.prompt !== 'string' || !q.prompt.trim()) fail(`${where}: prompt is required.`);
      const out = { id, type, prompt: q.prompt.slice(0, 10000), points: Number(q.points) > 0 ? Math.min(1000, Number(q.points)) : 1 };
      // An optional short name. Students see it once the quiz has started.
      const name = typeof q.name === 'string' ? q.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      if (name) out.name = name;
      // The shared material it uses: one id, or a list of up to 3 (shown in that order).
      if (q.shared != null && q.shared !== '') {
        const sids = [...new Set((Array.isArray(q.shared) ? q.shared : [q.shared]).map(String).filter(Boolean))];
        if (sids.length > 3) fail(`${where}: a question can use up to 3 shared materials.`);
        for (const sid of sids) if (!(quiz.shared || []).some((m) => m.id === sid)) fail(`${where}: shared "${sid}" isn't one of the quiz's shared materials.`);
        if (sids.length) out.shared = sids.length === 1 ? sids[0] : sids;
      }
      imageOf(where, q, out);
      // Why the answer is right (Markdown): in the practice review after turning in, and in reports.
      if (q.explanation != null && typeof q.explanation !== 'string') fail(`${where}: explanation must be text.`);
      if (typeof q.explanation === 'string' && q.explanation.trim()) out.explanation = q.explanation.trim().slice(0, 4000);
      // A question pool: each student gets some of its questions, picked at random (quiz.pools says how many).
      if (q.pool != null && q.pool !== '') {
        const pool = String(q.pool);
        if (!QID.test(pool) || ['__proto__', 'constructor', 'prototype'].includes(pool)) fail(`${where}: pool "${pool}" can only use letters, digits, - and _.`);
        out.pool = pool;
      }
      if (type === 'text') {
        const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
        if (!ans.length || ans.some((a) => typeof a !== 'string' || !a.trim())) fail(`${where}: answer must be a string or a list of strings.`);
        out.answer = ans.map((a) => String(a).slice(0, 500));
        // /like this/ is a pattern: it has to be a working regex that doesn't accept a blank answer.
        for (const a of out.answer) {
          const t = a.trim();
          if (!/^\/.+\/$/s.test(t)) continue;
          let re;
          try { re = new RegExp(t.slice(1, -1), 'i'); } catch (e) { fail(`${where}: the pattern ${t} isn't a valid regex: ${e.message}`); }
          if (re.test('')) fail(`${where}: the pattern ${t} matches an empty answer. Make it need some text.`);
        }
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
        if (type === 'multi' && q.partialCredit === true) out.partialCredit = true; // right picks earn, wrong ones take back
      } else if (type === 'code') {
        Object.assign(out, normalizeCode(where, q));
      } else {
        Object.assign(out, normalizeNewType(where, type, q, quiz.language, out.points));
      }
      return out;
    };
    const rows = q.vars != null ? checkVars(where, q, type) : null;
    const out = build(q);
    if (rows) {
      out.vars = rows;
      rows.forEach((row, r) => {
        try { build(putVars(q, row)); } catch (e) {
          if (e instanceof QuizError) fail(`${where}, random values row ${r + 1}: ${e.message.replace(/^Question \d+: /, '')}`);
          throw e;
        }
      });
    }
    quiz.questions.push(out);
  });
  // Question pools: how many of each pool's questions a student gets (1 unless the quiz says), and every
  // question in a pool worth the same, so everyone's quiz is out of the same points.
  const poolQs = new Map();
  for (const qq of quiz.questions) if (qq.pool) { if (!poolQs.has(qq.pool)) poolQs.set(qq.pool, []); poolQs.get(qq.pool).push(qq); }
  if (raw.pools != null && (typeof raw.pools !== 'object' || Array.isArray(raw.pools))) fail('"pools" must be an object, like { "loops": 2 }.');
  if (poolQs.size) {
    quiz.pools = {};
    for (const [name, qs] of poolQs) {
      const want = raw.pools && raw.pools[name] != null ? Number(raw.pools[name]) : 1;
      if (!Number.isInteger(want) || want < 1) fail(`pools.${name} must be a whole number, 1 or more.`);
      if (qs.some((qq) => qq.points !== qs[0].points)) fail(`Pool "${name}": its questions must all be worth the same, so every student's quiz is out of the same points.`);
      quiz.pools[name] = Math.min(want, qs.length);
    }
  }
  // Section dividers the teacher put in: each starts at a question, with its own title and directions.
  // Questions before the first one are grouped by type, as without any.
  if (raw.sections != null) {
    if (!Array.isArray(raw.sections)) fail('sections should be a list.');
    const at = new Map(quiz.questions.map((qq, i) => [qq.id, i]));
    const seen = new Set();
    quiz.sections = raw.sections.slice(0, 50).map((sec, k) => {
      const where = `sections[${k}]`;
      if (!sec || typeof sec !== 'object') fail(`${where} should be an object.`);
      const before = String(sec.before || '');
      if (!at.has(before)) fail(`${where}.before: there's no question "${before}".`);
      if (seen.has(before)) fail(`${where}: two sections start at question "${before}".`);
      seen.add(before);
      return { before, title: typeof sec.title === 'string' ? sec.title.trim().slice(0, 120) : '', directions: typeof sec.directions === 'string' ? sec.directions.trim().slice(0, 4000) : '' };
    }).sort((a, b) => at.get(a.before) - at.get(b.before));
    if (!quiz.sections.length) delete quiz.sections;
  }
  // Images written into the text as Markdown, ![alt](assets/name.png), have to be in assets/ too.
  for (const img of markdownImages(quiz)) if (!assetNames.has(img)) fail(`The image "${img}" in the text isn't in the assets folder.`);
  return quiz;
}

// Every assets/ image a quiz's text shows as Markdown: prompts, choices, explanations, shared material
// and directions. Works on a raw quiz.json too.
const MD_IMAGE = /!\[[^\]\n]*\]\((?:\.\/)?(assets\/[A-Za-z0-9_.-]{1,100}\.(?:png|jpe?g|gif|webp))\)/gi;
function markdownImages(quiz) {
  const texts = [];
  const qs = quiz && Array.isArray(quiz.questions) ? quiz.questions : [];
  for (const q of qs) if (q && typeof q === 'object') texts.push(q.prompt, q.explanation, ...(Array.isArray(q.choices) ? q.choices : []));
  for (const m of quiz && Array.isArray(quiz.shared) ? quiz.shared : []) if (m) texts.push(m.text);
  if (quiz && quiz.directions && typeof quiz.directions === 'object') texts.push(...Object.values(quiz.directions));
  for (const sec of quiz && Array.isArray(quiz.sections) ? quiz.sections : []) if (sec) texts.push(sec.directions);
  const out = new Set();
  for (const t of texts) if (typeof t === 'string') for (const m of t.matchAll(MD_IMAGE)) out.add(m[1]);
  return out;
}

// output (predict what it prints), trace (trace table), fill (fill in the blanks), essay (teacher-graded).
function normalizeNewType(where, type, q, quizLang, points) {
  const out = {};
  const lang = LANGS.includes(q.language) ? q.language : LANGS.includes(quizLang) ? quizLang : 'java';
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

// Classes a code question declares for its parameters and results: { "Point": { "x": "int", "y": "int" } }.
// BrowserQuiz writes them in both languages (types.js classSource) and students get them as given code.
const TAKEN_CLASSES = new Set(('Solution BQMain BQJ Support Given String Object Integer Long Double Float Short Byte Boolean Character '
  + 'Number Math StrictMath System Thread Runtime Class Record Enum Iterable Comparable Exception RuntimeException Error '
  + 'List ArrayList LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet Queue Deque ArrayDeque '
  + 'PriorityQueue Stack Vector Arrays Collections Collection Iterator Comparator Scanner Random Optional Objects '
  + 'Function BiFunction Predicate Consumer Supplier Stream IntStream Collectors').split(' '));
function normalizeTypes(where, raw, taken) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`${where}.types should be an object, like { "Point": { "x": "int", "y": "int" } }.`);
  const names = Object.keys(raw);
  if (names.length > 10) fail(`${where}: at most 10 classes in types.`);
  const D = {};
  for (const n of names) {
    if (!T.CLASS.test(n) || RESERVED.has(n) || TAKEN_CLASSES.has(n) || n === taken) fail(`${where}.types: "${n}" can't be a class name here. Use a name that starts with a capital letter and isn't a Java or Python class already.`);
    const f = raw[n];
    if (!f || typeof f !== 'object' || Array.isArray(f)) fail(`${where}.types.${n} should list its fields, like { "x": "int", "y": "int" }.`);
    if (Object.keys(f).length > 20) fail(`${where}.types.${n}: at most 20 fields.`);
    D[n] = Object.keys(f).map((k) => {
      const name = checkIdent(`${where}.types.${n}`, k);
      if (name === 'self' || name === n) fail(`${where}.types.${n}: "${name}" can't be a field name.`);
      return { name, type: f[k] };
    });
  }
  for (const n of names) for (const fl of D[n]) fl.type = checkType(`${where}.types.${n}.${fl.name}`, fl.type, false, D);
  return names.length ? D : null;
}

// Names each language can't use for a function, parameter, class or field (its keywords, and names the
// harness or the language's standard library already has where students' code lives).
const words = (t) => new Set(t.split(/\s+/));
const C_WORDS = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL main';
const LANG_RESERVED = {
  javascript: words('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity module exports require globalThis process console'),
  c: words(C_WORDS + ' abs labs printf scanf puts malloc calloc realloc free exit strlen strcmp strcpy strcat memcpy memset index rindex time pow sqrt floor ceil round log exp sin cos tan fabs rand srand qsort bsearch atoi atof y0 y1 j0 j1'),
  cpp: words(C_WORDS + ' alignas alignof and and_eq asm bitand bitor catch char8_t char16_t char32_t class compl concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export friend mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw try typeid typename using virtual wchar_t xor xor_eq std'),
};
LANG_RESERVED.typescript = LANG_RESERVED.javascript;
LANG_RESERVED.go = words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var main init this nil true false iota');
LANG_RESERVED.rust = words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try union main new bq sol');
LANG_RESERVED.csharp = words('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var dynamic await async yield value Main BQ BQMain');
// Types a declared class would hide in C#.
const OTHER_TAKEN = {
  csharp: words('Console Exception Convert Tuple Array List Dictionary HashSet Queue Stack Math String Object Action Func Task Solution BQ BQMain'),
};
// Rust's own types, which a declared class would hide.
const RUST_TAKEN = words('Vec String Option Box Some None Ok Err Result HashMap HashSet BTreeMap BTreeSet VecDeque BinaryHeap Rc RefCell Self Solution');
// JavaScript's own classes, which a declared class would hide from the harness.
const JS_TAKEN = words('Array Map Set WeakMap WeakSet Object Function Promise Error Date JSON Math Number String Boolean Symbol RegExp BigInt Reflect Proxy Buffer Intl Atomics');

// Why one language can't run the question, or null: names it reserves, types or values it doesn't have
// (C has no classes to write or maps; C++, Go and Rust no null string; C, C++ and Go only ASCII chars),
// overloads, bans and speed tests where it has none, a speed test without its reference solution.
// ctx: { overloaded: a method name used twice, or null; reference: { lang: code } }.
function languageProblem(where, out, lang, D, ctx) {
  const name = langName(lang);
  const names = [];
  if (out.mode === 'method') names.push(out.signature.name, ...out.signature.params.map((p) => p.name));
  else names.push(out.class.name, ...out.class.constructor.map((p) => p.name), ...out.class.methods.flatMap((m) => [m.name, ...m.params.map((p) => p.name)]));
  const fields = [];
  for (const [n, fs] of Object.entries(D || {})) { names.push(n); fields.push(...fs.map((f) => f.name)); }
  const bad = [...names, ...fields].find((n) => LANG_RESERVED[lang] && LANG_RESERVED[lang].has(n));
  if (bad) return `${where}: "${bad}" can't be a name in ${name}. Pick another, or leave ${name} out.`;
  const classes = [...Object.keys(D || {}), ...(out.mode === 'class' ? [out.class.name] : [])];
  const taken = T.isJs(lang) ? JS_TAKEN : lang === 'rust' ? RUST_TAKEN : OTHER_TAKEN[lang];
  const t = taken && classes.find((n) => taken.has(n));
  if (t) return `${where}: "${t}" is already a ${T.isJs(lang) ? 'JavaScript' : name} class. Pick another name.`;
  if (ctx.overloaded && (['python', 'go', 'rust'].includes(lang) || T.isJs(lang))) {
    return `${where}: there are two methods named ${ctx.overloaded}. Overloads only work in Java, C++ and C# (${name} can't have two methods with one name).`;
  }
  if (out.ban && B.bansFor(out.ban, lang).length) {
    if (!B.BAN_LANGS.includes(lang)) return `${where}: "ban" doesn't work in ${name}. Give it per language, like { "java": [...] }, and leave ${name} out.`;
    // One list for several languages: "Arrays.sort" is Java's; in C++, Go or C# that class means something else.
    const qualified = Array.isArray(out.ban) && ctx.languages.length > 1 && !B.LIST_QUALIFIED.includes(lang) && out.ban.find((e) => e.includes('.'));
    if (qualified) return `${where}: "ban" lists "${qualified}", which doesn't name the same thing in ${name}. Give it per language, like { "java": ["${qualified}"], "${lang}": [...] }.`;
    // JavaScript's are tripwires on its builtins, so each has to be one (a list for several languages can
    // have other languages' names in it).
    if (T.isJs(lang) && (!Array.isArray(out.ban) || ctx.languages.length === 1)) {
      const unknown = B.bansFor(out.ban, lang).find((e) => !B.jsKnows(e));
      if (unknown) return `${where}: "${unknown}" isn't in ${name}'s library. Use a method ("sort"), a class ("Map") or Class.method ("Math.max", "Array.sort").`;
    }
  }
  const tests = [...out.tests.sample.map((x, i) => [`tests.sample[${i}]`, x]), ...out.tests.hidden.map((x, i) => [`tests.hidden[${i}]`, x])];
  if (tests.some(([, x]) => x.speed)) {
    if (!T.hasSpeed(lang)) return `${where}: speed tests only work in Java, Python, JavaScript and TypeScript, so take them out or leave ${name} out.`;
    if (!ctx.reference[lang]) return `${where}: speed tests are timed against the reference solution, so add one for ${name}.`;
  }
  if (lang === 'c') {
    if (out.mode === 'class') return `${where}: C has no classes, so a "write a class" question can't include C.`;
    for (const ty of [out.signature.returns, ...out.signature.params.map((p) => p.type)]) {
      const why = T.unsupported('c', ty, D);
      if (why) return `${where}: ${ty} doesn't work in C (${why}). Leave C out.`;
    }
    for (const [n, fs] of Object.entries(D || {})) {
      const f = fs.find((x) => T.elementType(x.type) || T.mapTypes(x.type));
      if (f) return `${where}.types.${n}: in C a class can only hold numbers, booleans, chars, strings and other classes, not ${f.type}. Leave C out.`;
    }
  }
  if (!T.isNative(lang)) return null;
  const check = (w, ty, v) => { const why = T.fits(lang, ty, v, D); return why ? `${where}.${w}: ${why}, so this test can't run in ${name}.` : null; };
  for (const [w, x] of tests) {
    if (out.mode === 'method') {
      for (let k = 0; k < x.args.length; k++) { const p = check(`${w} argument ${k + 1}`, out.signature.params[k].type, x.args[k]); if (p) return p; }
      if (x.expected !== undefined) { const p = check(`${w} expected`, out.signature.returns, x.expected); if (p) return p; }
      continue;
    }
    for (let k = 0; k < x.steps.length; k++) {
      const st = x.steps[k];
      if (st.new) { for (let j = 0; j < st.new.length; j++) { const p = check(`${w}.steps[${k}]`, out.class.constructor[j].type, st.new[j]); if (p) return p; } continue; }
      const m = (st.m != null && out.class.methods[st.m]) || out.class.methods.find((y) => y.name === st.call);
      for (let j = 0; j < st.args.length; j++) { const p = check(`${w}.steps[${k}]`, m.params[j].type, st.args[j]); if (p) return p; }
      if (st.expect !== undefined) { const p = check(`${w}.steps[${k}] expect`, m.returns, st.expect); if (p) return p; }
    }
  }
  return null;
}

function normalizeCode(where, q) {
  const mode = q.mode === 'class' ? 'class' : 'method';
  // "any": every language that can run the question (the others are left out, see languageProblem)
  const any = q.languages === 'any' || (Array.isArray(q.languages) && q.languages.length === 1 && q.languages[0] === 'any');
  const languages = any ? [...LANGS] : Array.isArray(q.languages) && q.languages.length ? [...new Set(q.languages)] : ['java'];
  if (languages.some((l) => !LANGS.includes(l))) fail(`${where}: languages can be "any", or some of ${LANGS.join(', ')}.`);
  let overloaded = null;
  const out = { mode, languages };
  const D = normalizeTypes(where, q.types, mode === 'class' && q.class ? q.class.name : null);
  if (D) out.types = D;
  if (mode === 'method') {
    const s = q.signature || {};
    out.signature = { name: checkIdent(`${where}.signature.name`, s.name), params: checkParams(`${where}.signature`, s.params || [], D), returns: checkType(`${where}.signature.returns`, s.returns, false, D) };
  } else {
    const c = q.class || {};
    const name = checkIdent(`${where}.class.name`, c.name);
    if (!/^[A-Z]/.test(name)) fail(`${where}.class.name should start with a capital letter.`);
    const methods = Array.isArray(c.methods) ? c.methods : [];
    // Overloads (two methods with one name) are Java only: Python has no overloading.
    const seen = new Set();
    out.class = {
      name,
      constructor: checkParams(`${where}.class.constructor`, c.constructor || [], D),
      methods: methods.map((m, i) => {
        const mn = checkIdent(`${where}.class.methods[${i}].name`, m && m.name);
        const params = checkParams(`${where}.class.methods[${i}]`, m.params || [], D);
        const key = `${mn}(${params.map((p) => p.type).join(',')})`;
        if (seen.has(key)) fail(`${where}: method ${key} is listed twice.`);
        if (!overloaded && [...seen].some((k) => k.startsWith(mn + '('))) overloaded = mn;
        seen.add(key);
        return { name: mn, params, returns: checkType(`${where}.class.methods[${i}].returns`, m.returns, true, D) };
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
      const args = checkArgs(w, out.signature.params, raw.args, D);
      // Speed test: the method is called `calls` times and must finish within 10x the reference's time.
      const speed = raw.speed === true ? { speed: true, calls: Math.max(1, Math.min(100000, Math.floor(Number(raw.calls) || 1))) } : {};
      if (raw.expected === undefined) {
        if (!hasRef) fail(`${w}: needs "expected", or add a reference solution to fill it in.`);
        return { args, weight, ...speed };
      }
      if (!checkValue(out.signature.returns, raw.expected, D)) fail(`${w}: expected isn't a valid ${out.signature.returns}.`);
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
        checkArgs(sw, out.class.constructor, s.new, D);
        objects.add(as);
        lastObj = as;
        return { new: s.new, as };
      }
      // With overloads, the first method of that name whose parameters fit the arguments.
      const named = out.class.methods.map((x, k) => [x, k]).filter(([x]) => x.name === (s && s.call));
      if (!named.length) fail(`${sw}: call must name one of the class's methods.`);
      const fits = (x) => Array.isArray(s.args || []) && (s.args || []).length === x.params.length
        && (s.args || []).every((a, j) => (isRange(a) && RANGE_TYPES.includes(x.params[j].type)) || checkValue(x.params[j].type, a, D));
      const [m, mi] = named.find(([x]) => fits(x)) || named[0];
      const on = s.on == null ? lastObj : String(s.on);
      if (!on || !objects.has(on)) fail(`${sw}: there's no object "${on}" to call ${m.name} on yet.`);
      if (named.length > 1 && !fits(m)) fail(`${sw}: no ${m.name} method takes these arguments.`);
      const args = checkArgs(sw, m.params, s.args || [], D);
      const step = { call: m.name, args, on };
      if (named.length > 1) step.m = mi;
      if (s.expect !== undefined) {
        if (m.returns === 'void') fail(`${sw}: ${m.name} returns nothing, so it can't have expect.`);
        if (!checkValue(m.returns, s.expect, D)) fail(`${sw}: expect isn't a valid ${m.returns}.`);
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
  // Written without running, like on paper: no Run examples. Grading still runs the hidden tests.
  if (q.noRun === true) out.noRun = true;
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
      const name = langName(lang);
      if (r.ok === null) fail(`${where}, rubric item ${i + 1}: the ${name} pattern takes too long to run. Make it simpler.`);
      if (!r.ok) fail(`${where}, rubric item ${i + 1}: the ${name} reference solution ${r.why === 'require' ? "doesn't match \"require\"" : 'matches "forbid"'}.`);
    }
  });
  // Methods the student may not use (bans.js).
  try { const ban = B.normalizeBans(q.ban, languages); if (ban) out.ban = ban; } catch (e) { fail(`${where}: ${e.message}`); }
  // (The reference solutions have to keep to them too: checked when they run, in coderun.checkReferences.)
  const problems = languages.map((l) => [l, languageProblem(where, out, l, D, { overloaded, reference, languages })]);
  if (!any) {
    const bad = problems.find(([, p]) => p);
    if (bad) fail(bad[1]);
  } else {
    const keep = problems.filter(([, p]) => !p).map(([l]) => l);
    if (!keep.length) fail(problems[0][1]);
    const only = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([l]) => keep.includes(l))) : o);
    out.languages = keep;
    out.languagesAny = true;
    out.reference = only(reference);
    if (out.ban && !Array.isArray(out.ban)) out.ban = only(out.ban);
    for (const item of out.rubric) { if (item.require) item.require = only(item.require); if (item.forbid) item.forbid = only(item.forbid); }
  }
  const rubricPoints = out.rubric.reduce((s, r) => s + r.points, 0);
  if (rubricPoints >= Number(q.points || 1)) fail(`${where}: rubric points must be less than the question's points, so the tests are worth something.`);
  // starter: "empty" | "stubs" (default) | { java: "...custom...", python: "..." }
  out.starterStyle = q.starter === 'empty' ? 'empty' : 'stubs';
  out.starter = {};
  out.support = {};
  for (const l of out.languages) {
    const s = q.starter && typeof q.starter === 'object' ? q.starter[l] : null;
    out.starter[l] = typeof s === 'string' ? s.slice(0, 50000) : null;
    if (q.support && typeof q.support[l] === 'string') out.support[l] = q.support[l].slice(0, 50000);
  }
  return out;
}

module.exports = { loadQuizFile, normalizeQuiz, putVars, markdownImages, checkValue, elementType, isRange, rangeLength, QuizError, LIMITS, ASSET_TYPES, normOutput, normBlank, normCell, fillTemplate };
