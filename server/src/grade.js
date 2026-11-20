'use strict';
// Grading: multiple choice and text right away, code questions through the runner in the background.
const store = require('./store');
const { gradeCode } = require('./coderun');
const H = require('./harness');

const norm = (s, cs) => { const t = String(s).trim().replace(/\s+/g, ' '); return cs ? t : t.toLowerCase(); };

// Answers arrive in the student's positional order; map them back to the quiz's original indexes.
function cleanAnswers(quiz, layout, answers) {
  const out = {};
  if (!answers || typeof answers !== 'object') return out;
  for (const qq of quiz.questions) {
    const v = answers[qq.id];
    if (v == null) continue;
    const n = qq.choices ? qq.choices.length : 0;
    if (qq.type === 'single' && Number.isInteger(v) && v >= 0 && v < n) out[qq.id] = v;
    else if (qq.type === 'multi' && Array.isArray(v)) out[qq.id] = [...new Set(v.filter((x) => Number.isInteger(x) && x >= 0 && x < n))].sort((a, b) => a - b);
    else if (qq.type === 'text' && typeof v === 'string') out[qq.id] = v.slice(0, 500);
    else if (qq.type === 'code' && v && typeof v === 'object' && qq.languages.includes(v.language) && typeof v.code === 'string') {
      out[qq.id] = { language: v.language, code: v.code.slice(0, 50000) };
    }
  }
  return out;
}

function gradeAuto(quiz, layout, answers) {
  let score = 0;
  let max = 0;
  const detail = {};
  for (const qq of quiz.questions) {
    if (qq.type === 'code') continue;
    max += qq.points;
    const a = answers[qq.id];
    const perm = layout && layout.perms ? layout.perms[qq.id] : null;
    const orig = (i) => (perm ? perm[i] : i);
    let ok = false;
    if (qq.type === 'single') ok = Number.isInteger(a) && orig(a) === qq.answer;
    else if (qq.type === 'multi') {
      const got = new Set((Array.isArray(a) ? a : []).map(orig));
      ok = got.size === qq.answer.length && qq.answer.every((x) => got.has(x));
    } else if (qq.type === 'text') ok = typeof a === 'string' && qq.answer.some((x) => norm(x, qq.caseSensitive) === norm(a, qq.caseSensitive));
    if (ok) score += qq.points;
    detail[qq.id] = { correct: ok, points: ok ? qq.points : 0, max: qq.points };
  }
  return { score, max, detail };
}

function totals(result) {
  if (!result) return null;
  let score = result.auto.score;
  let max = result.auto.max;
  let pending = 0;
  for (const c of Object.values(result.code || {})) {
    max += c.max;
    if (c.status === 'done') score += c.score;
    else pending++;
  }
  return { score: Math.round(score * 100) / 100, max, pending };
}

const running = new Set();
async function gradeAttempt(a, quiz) {
  if (running.has(a.id)) return;
  running.add(a.id);
  try {
    const auto = gradeAuto(quiz, a.layout, a.answers);
    const prev = a.result && a.result.code ? a.result.code : {};
    a.result = { auto, code: {} };
    const codeQs = quiz.questions.filter((qq) => qq.type === 'code');
    for (const qq of codeQs) {
      a.result.code[qq.id] = prev[qq.id] && prev[qq.id].status === 'done' ? prev[qq.id] : { status: 'pending', max: qq.points - qq.rubric.reduce((s, r) => s + r.points, 0) };
    }
    store.save(a);
    for (const qq of codeQs) {
      if (a.result.code[qq.id].status === 'done') continue;
      try {
        a.result.code[qq.id] = await gradeCode(qq, a.answers[qq.id]);
      } catch (e) {
        a.result.code[qq.id] = { status: 'error', score: 0, max: a.result.code[qq.id].max, message: e.message };
      }
      store.save(a);
    }
  } finally {
    running.delete(a.id);
  }
}

// What the teacher sees for each answer.
function answerReport(quiz, a) {
  const res = a.result || {};
  return quiz.questions.map((qq) => {
    const ans = a.answers ? a.answers[qq.id] : undefined;
    const perm = a.layout && a.layout.perms ? a.layout.perms[qq.id] : null;
    const row = { id: qq.id, type: qq.type, prompt: qq.prompt.slice(0, 200), points: null, max: qq.points };
    if (qq.type === 'single' || qq.type === 'multi') {
      const picked = ans == null ? [] : [].concat(ans).map((i) => (perm ? perm[i] : i));
      row.answer = picked.map((i) => qq.choices[i]).join(' | ') || null;
      row.correctAnswer = [].concat(qq.answer).map((i) => qq.choices[i]).join(' | ');
    } else if (qq.type === 'text') {
      row.answer = ans == null ? null : ans;
      row.correctAnswer = qq.answer.join(' | ');
    } else {
      row.answer = ans ? ans.code : null;
      row.language = ans ? ans.language : null;
      row.code = res.code ? res.code[qq.id] : null;
      row.samples = qq.tests.hidden.length;
      row.starter = ans ? H.starterCode(qq, ans.language) : null;
    }
    if (res.auto && res.auto.detail[qq.id]) Object.assign(row, res.auto.detail[qq.id]);
    if (row.code && row.code.status === 'done') { row.points = row.code.score; row.max = row.code.max; }
    return row;
  });
}

module.exports = { cleanAnswers, gradeAuto, gradeAttempt, totals, answerReport };
