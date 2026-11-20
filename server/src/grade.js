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

const rubricMax = (qq) => (qq.rubric || []).reduce((sum, r) => sum + r.points, 0);

// One question's points: auto or runner score, plus rubric items the teacher ticked, unless the
// teacher typed an override. state: done | pending | failed.
// A code answer that's blank or untouched starter code has nothing for the teacher to review.
function codeAnswered(qq, ans) {
  if (!ans || typeof ans.code !== 'string' || !ans.code.trim()) return false;
  return ans.code.trim() !== String(H.starterCode(qq, ans.language) || '').trim();
}

function questionScore(qq, result, answers) {
  const m = (result.manual || {})[qq.id] || {};
  let points = 0;
  let state = 'done';
  if (qq.type === 'code') {
    const c = (result.code || {})[qq.id];
    if (!c || c.status === 'pending') state = 'pending';
    else if (c.status === 'error') state = 'failed';
    else points = c.score;
  } else {
    const d = result.auto && result.auto.detail[qq.id];
    points = d ? d.points : 0;
  }
  for (const r of qq.rubric || []) if (m.rubric && m.rubric[r.id]) points += r.points;
  const answered = qq.type === 'code' ? codeAnswered(qq, answers && answers[qq.id]) : answers ? answers[qq.id] != null : true;
  const review = rubricMax(qq) > 0 && answered && !m.reviewed && m.override == null;
  if (m.override != null) { points = m.override; state = 'done'; }
  return { points: Math.round(points * 100) / 100, max: qq.points, state, review, override: m.override != null };
}

function totals(result, quiz, answers) {
  if (!result) return null;
  let score = 0;
  let max = 0;
  let pending = 0;
  let failed = 0;
  let review = 0;
  for (const qq of quiz.questions) {
    const s = questionScore(qq, result, answers);
    score += s.points;
    max += s.max;
    if (s.state === 'pending') pending++;
    if (s.state === 'failed') failed++;
    if (s.review) review++;
  }
  return { score: Math.round(score * 100) / 100, max, pending, failed, review };
}

const running = new Set();
async function gradeAttempt(a, quiz) {
  if (running.has(a.id)) return;
  running.add(a.id);
  try {
    const auto = gradeAuto(quiz, a.layout, a.answers);
    const prev = a.result && a.result.code ? a.result.code : {};
    a.result = { auto, code: {}, manual: (a.result && a.result.manual) || {} };
    const codeQs = quiz.questions.filter((qq) => qq.type === 'code');
    for (const qq of codeQs) {
      a.result.code[qq.id] = prev[qq.id] && prev[qq.id].status === 'done' ? prev[qq.id] : { status: 'pending', max: qq.points - rubricMax(qq) };
    }
    store.save(a);
    for (const qq of codeQs) {
      if (a.result.code[qq.id].status === 'done') continue;
      try {
        // Blank or untouched starter code: nothing to run.
        if (!codeAnswered(qq, a.answers[qq.id])) a.result.code[qq.id] = { status: 'done', score: 0, max: a.result.code[qq.id].max, note: 'No answer', tests: [] };
        else a.result.code[qq.id] = await gradeCode(qq, a.answers[qq.id]);
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
    if (res.auto && res.auto.detail[qq.id]) row.correct = res.auto.detail[qq.id].correct;
    if (a.result) {
      const sc = questionScore(qq, res, a.answers);
      row.points = sc.state === 'done' ? sc.points : null;
      row.state = sc.state;
      row.override = sc.override;
      row.review = sc.review;
    }
    const m = (res.manual || {})[qq.id] || {};
    row.rubric = (qq.rubric || []).map((r) => ({ id: r.id, text: r.text, points: r.points, checked: !!(m.rubric && m.rubric[r.id]) }));
    row.overridePoints = m.override != null ? m.override : null;
    return row;
  });
}

// Printable report for one student: every question with their answer and the correct one.
// Nothing about integrity goes in here, so a teacher can hand it to the student. Code questions show
// the reference solution, not the hidden tests.
function studentReport(quiz, a, name) {
  const t = a.result ? totals(a.result, quiz, a.answers) : null;
  const res = a.result || {};
  return {
    name,
    submittedAt: a.submittedAt,
    score: t ? t.score : null,
    max: quiz.questions.reduce((sum, qq) => sum + qq.points, 0),
    unfinished: t ? t.pending + t.failed : quiz.questions.length,
    questions: quiz.questions.map((qq) => {
      const ans = a.answers ? a.answers[qq.id] : undefined;
      const sc = a.result ? questionScore(qq, res, a.answers) : null;
      const row = { id: qq.id, type: qq.type, mode: qq.mode || null, prompt: qq.prompt, image: qq.image || null, imageAlt: qq.imageAlt || '', points: sc && sc.state === 'done' ? sc.points : null, max: qq.points };
      if (qq.type === 'single' || qq.type === 'multi') {
        const perm = a.layout && a.layout.perms ? a.layout.perms[qq.id] : null;
        row.choices = qq.choices;
        row.picked = (ans == null ? [] : [].concat(ans)).map((i) => (perm ? perm[i] : i));
        row.correct = [].concat(qq.answer);
      } else if (qq.type === 'text') {
        row.answer = ans == null || String(ans).trim() === '' ? null : String(ans);
        row.accepted = qq.answer;
      } else {
        const lang = ans && qq.languages.includes(ans.language) ? ans.language : qq.languages[0];
        const c = (res.code || {})[qq.id];
        const m = (res.manual || {})[qq.id] || {};
        row.language = lang;
        row.answer = codeAnswered(qq, ans) ? ans.code : null;
        row.compileError = row.answer && c && c.compileError ? c.compileError : null;
        const refs = qq.reference || {};
        row.referenceLanguage = refs[lang] ? lang : Object.keys(refs)[0] || null;
        row.reference = row.referenceLanguage ? refs[row.referenceLanguage] : null;
        row.rubric = (qq.rubric || []).map((r) => ({ text: r.text, points: r.points, met: !!(m.rubric && m.rubric[r.id]) }));
        row.rubricGraded = !!m.reviewed;
      }
      return row;
    }),
  };
}
const reportQuiz = (quiz, quizId) => ({ id: quizId, title: quiz.title, language: quiz.language || null });

module.exports = { cleanAnswers, gradeAuto, gradeAttempt, totals, questionScore, codeAnswered, answerReport, studentReport, reportQuiz, grading: running };
