'use strict';
// Grades: every quiz a class took, a column each, oldest first, with each student's percent, their
// average, and the class's. Only closed exams count: practice isn't graded, and an open exam's scores stay
// sealed until it closes. Corrections fold into the exam they correct.

const store = require('../store');
const { q } = require('../db');
const { json, send } = require('../http');
const { totals } = require('../grade');
const C = require('../corrections');
const { getRoster, requireTeacher } = require('./common');

const pct = (score, max) => Math.round((score / max) * 1000) / 10;
const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

// One student's cell for one quiz. k: 'score' (p, and was: before corrections), 'invalid' (counts as 0),
// 'review' (waiting for the teacher), 'grading' (code still running), 'none' (didn't take it).
function cell(quiz, a, corr) {
  if (!a || a.status !== 'submitted') return { k: 'none' };
  const t = totals(a.result, quiz, a.answers, a.layout);
  if (!t) return { k: 'grading' };
  if (!t.max) return { k: 'none' }; // a quiz with no points: nothing to grade
  if (a.integrity === 'invalidated') return { k: 'invalid', p: 0, a: a.id };
  if (t.review || t.failed) return { k: 'review' };
  if (t.pending) return { k: 'grading' };
  const p = pct(t.score, t.max);
  const st = corr && C.standing(quiz, corr.run, corr.a);
  if (st && st.bonus > 0) return { k: 'score', p: pct(st.final, st.max), was: p, a: a.id };
  return { k: 'score', p, a: a.id };
}

function gradebook(me, rosterId) {
  const roster = getRoster(me, rosterId);
  const students = q(`SELECT id, bq_name(name, id, roster_id) AS name FROM roster_students WHERE roster_id = ? AND removed = 0
    ORDER BY name COLLATE NOCASE`).all(roster.id);
  // one nobody turned in (started by mistake, say) has nothing to show
  const runs = q(`SELECT * FROM runs WHERE roster_id = ? AND owner_id = ? AND mode != 'practice' AND corrects IS NULL AND status = 'closed'
    AND EXISTS (SELECT 1 FROM attempts WHERE attempts.run_id = runs.id AND archived = 0 AND status = 'submitted')
    ORDER BY created_at`).all(roster.id, me.id);
  const rows = students.map((s) => ({ id: s.id, name: s.name, cells: [] }));
  const quizzes = runs.map((run) => {
    const quiz = store.getQuiz(run.quiz_id);
    const mine = new Map(q('SELECT id, student_id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => [x.student_id, x.id]));
    // the latest corrections each student turned in for this exam
    const corr = new Map();
    for (const c of q(`SELECT a.id, a.student_id, r.id AS run_id FROM attempts a JOIN runs r ON r.id = a.run_id
      WHERE r.corrects = ? AND r.owner_id = ? AND a.archived = 0 AND a.status = 'submitted' ORDER BY r.created_at`).all(run.id, me.id)) corr.set(c.student_id, c);
    const corrRuns = new Map();
    const got = [];
    rows.forEach((row) => {
      const id = mine.get(row.id);
      const c = corr.get(row.id);
      if (c && !corrRuns.has(c.run_id)) corrRuns.set(c.run_id, q('SELECT * FROM runs WHERE id = ?').get(c.run_id));
      const x = cell(quiz, id ? store.getAttempt(id) : null, c ? { run: corrRuns.get(c.run_id), a: store.getAttempt(c.id) } : null);
      if (x.p != null) got.push(x.p);
      row.cells.push(x);
    });
    return { runId: run.id, code: run.code, title: quiz.title, at: run.created_at, avg: mean(got) };
  });
  // each quiz counts the same; one a student didn't take is left out, an invalidated one counts as 0
  for (const row of rows) row.avg = mean(row.cells.filter((x) => x.p != null).map((x) => x.p));
  return { roster: { id: roster.id, name: roster.name }, quizzes, students: rows, avg: mean(rows.filter((r) => r.avg != null).map((r) => r.avg)) };
}

module.exports = function gradeRoutes(r) {
  r.get('/api/t/rosters/:id/grades', (req, res, p) => {
    const me = requireTeacher(req);
    json(res, 200, gradebook(me, p.id));
  });

  // The same table for a spreadsheet: a percent in each cell, 0 for an invalidated quiz, blank for one a
  // student didn't take. Each quiz's heading has its date (in the teacher's time zone), as a quiz can be
  // given twice.
  r.get('/api/t/rosters/:id/grades.csv', (req, res, p) => {
    const me = requireTeacher(req);
    const g = gradebook(me, p.id);
    let timeZone = (q('SELECT tz FROM teachers WHERE id = ?').get(me.id) || {}).tz || new URL(req.url, 'http://x').searchParams.get('tz') || 'UTC';
    try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch (e) { timeZone = 'UTC'; }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    // a name or title starting with = + - or @ would be a formula in a spreadsheet: a ' keeps it text
    const esc = (v) => { let s = v == null ? '' : String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const TEXT = { review: 'Needs grading', grading: 'Grading' };
    const lines = [['Student', ...g.quizzes.map((x) => `${x.title} (${day.format(new Date(x.at))})`), 'Average'].map(esc).join(',')];
    for (const s of g.students) lines.push([s.name, ...s.cells.map((x) => (x.p != null ? x.p : TEXT[x.k] || '')), s.avg].map(esc).join(','));
    lines.push(['Class average', ...g.quizzes.map((x) => x.avg), g.avg].map(esc).join(','));
    send(res, 200, lines.join('\n') + '\n', {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${g.roster.name.replace(/[^\w -]/g, '').slice(0, 60) || 'class'} grades.csv"`,
    });
  });
};
