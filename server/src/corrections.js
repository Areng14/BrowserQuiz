'use strict';
// Corrections: after an exam, each student redoes the questions they lost points on, in a practice run of
// its own (no lockdown, no flags: students can ask around). Their answers from the exam are filled in. A
// missed question from a pool swaps for one from the same pool they haven't seen, when there is one, so
// they have to know it rather than remember what came back. Getting it right earns back a share of the
// points they lost (the run's earn_back, 0 to 1: the teacher's percentage), on top of the exam score. Only the teacher sees the
// exam score and the total: an invalidated exam stays at 0, and the student can't tell.

const crypto = require('node:crypto');
const { q } = require('./db');
const store = require('./store');
const { questionScore, totals } = require('./grade');

// The exam attempt a student's corrections are for: theirs in the exam run, turned in.
function examAttemptFor(run, studentId) {
  if (!run.corrects) return null;
  const row = q("SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0 AND status = 'submitted'").get(run.corrects, studentId);
  return row ? store.getAttempt(row.id) : null;
}

// What a student corrects: the questions they lost points on (graded ones; anything still waiting for the
// teacher is left out), in quiz order. Returns { layout, answers } or null when there's nothing to correct.
function plan(quiz, exam, askWhy) {
  if (!exam || !exam.result || !exam.layout) return null;
  const mine = store.quizFor(quiz, exam.layout).questions;
  const seen = new Set(exam.layout.order);
  const used = new Set();
  const fresh = store.makeLayout(quiz).perms; // choice orders for questions they haven't seen
  const order = [];
  const perms = {};
  const fix = {};
  const answers = {};
  for (const qq of mine) {
    const sc = questionScore(qq, exam.result, exam.answers);
    if (sc.state !== 'done' || sc.review || sc.points >= qq.points) continue; // still waiting for the teacher, or full marks
    let id = qq.id;
    let isNew = false;
    if (qq.pool) {
      const others = quiz.questions.filter((x) => x.pool === qq.pool && !seen.has(x.id) && !used.has(x.id));
      if (others.length) { id = others[crypto.randomInt(others.length)].id; isNew = true; }
    }
    used.add(id);
    order.push(id);
    if (isNew) { if (fresh[id]) perms[id] = fresh[id]; } else {
      // the same question, as they had it: same choice order, their answer filled in
      if (exam.layout.perms && exam.layout.perms[id]) perms[id] = exam.layout.perms[id];
      if (exam.answers && exam.answers[id] != null) answers[id] = exam.answers[id];
    }
    fix[id] = { from: qq.id, old: sc.points, max: qq.points, fresh: isNew };
  }
  if (!order.length) return null;
  return { layout: { order, perms, subset: true, fix, why: !!askWhy, exam: exam.id }, answers };
}

// For the start screen: how many questions and points a student has to correct.
function preview(run, quiz, studentId) {
  const p = plan(quiz, examAttemptFor(run, studentId), false);
  if (!p) return { questionCount: 0, points: 0 };
  const pts = p.layout.order.reduce((t, id) => t + quiz.questions.find((x) => x.id === id).points, 0);
  return { questionCount: p.layout.order.length, points: Math.round(pts * 100) / 100 };
}

// Points a corrections attempt earns back: the share of what each question gained over the exam.
function earned(quiz, corr, earnBack) {
  if (!corr || !corr.result || !corr.layout || !corr.layout.fix || !earnBack) return 0;
  let gain = 0;
  for (const [id, f] of Object.entries(corr.layout.fix)) {
    const qq = quiz.questions.find((x) => x.id === id);
    if (!qq) continue;
    const sc = questionScore(qq, corr.result, corr.answers);
    if (sc.state !== 'done') continue;
    gain += Math.max(0, (sc.points / qq.points) * f.max - f.old);
  }
  return Math.round(earnBack * gain * 100) / 100;
}

// The teacher's view of a corrections attempt: the exam score, what corrections add, and the total.
function standing(quiz, run, corr) {
  const exam = corr && corr.layout && corr.layout.exam ? store.getAttempt(corr.layout.exam) : null;
  const t = exam ? totals(exam.result, quiz, exam.answers, exam.layout) : null;
  if (!t) return null;
  const invalid = exam.integrity === 'invalidated';
  const base = invalid ? 0 : t.score;
  const bonus = invalid ? 0 : earned(quiz, corr, run.earn_back);
  return { exam: base, bonus, final: Math.min(t.max, Math.round((base + bonus) * 100) / 100), max: t.max };
}

module.exports = { examAttemptFor, plan, preview, earned, standing };
