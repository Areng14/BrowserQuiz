'use strict';
// A run's live table, grading by question, and the CSV of results.

const store = require('../store');
const { q } = require('../db');
const P = require('../people');
const { json, send } = require('../http');
const { totals, questionScore, studentReport, answerReport, reportQuiz } = require('../grade');
const C = require('../corrections');
const { aiJobs, aiKeyOf, getRun, joinOrigin, liveRow, notWhileOpen, requireTeacher } = require('./common');
const { handGraded, rosterStudentsForRun } = require('./library');

module.exports = function liveRoutes(r) {
  r.get('/api/t/runs/:id/live', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    const quiz = store.getQuiz(run.quiz_id);
    const roster = rosterStudentsForRun(run);
    const byStudent = new Map(q('SELECT id, student_id FROM attempts WHERE run_id = ? AND archived = 0').all(run.id).map((x) => [x.student_id, store.getAttempt(x.id)]));
    // Sign-ins to look at before admitting (the checklist asks about these): a network the student hasn't
    // used before, or a browser another student signed in from.
    const checks = new Map();
    for (const e of q(`SELECT e.attempt_id, e.type, e.detail FROM events e JOIN attempts a ON a.id = e.attempt_id
      WHERE a.run_id = ? AND a.archived = 0 AND e.type IN ('new-network', 'same-browser') ORDER BY e.id`).all(run.id)) {
      if (!checks.has(e.attempt_id)) checks.set(e.attempt_id, []);
      checks.get(e.attempt_id).push({ type: e.type, detail: P.openEvent(run.id, e.attempt_id, e.detail) });
    }
    // wrong student IDs typed for a name: a few are typos, many mean someone is guessing
    const wrongIds = new Map(q('SELECT student_id, n FROM failed_ids WHERE run_id = ? AND n > 0').all(run.id).map((x) => [x.student_id, x.n]));
    // what each student's latest strike was, for the teacher's notifications (dash/run.js notice)
    const lastStrike = new Map();
    for (const e of q(`SELECT e.attempt_id, e.type FROM events e JOIN attempts a ON a.id = e.attempt_id
      WHERE a.run_id = ? AND a.archived = 0 AND e.severity = 'violation' ORDER BY e.id`).all(run.id)) lastStrike.set(e.attempt_id, e.type);
    json(res, 200, {
      run: { id: run.id, code: run.code, status: run.status, pausedMs: run.paused_at ? Math.max(0, Date.now() - run.paused_at) : null, ipLock: !!run.ip_lock, released: !!run.released, practice: run.mode === 'practice', seb: !!run.seb_key, sebFile: !!run.seb_config, sebQuit: run.seb_quit || null, title: quiz.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin,
        timedParts: quiz.timedParts && !run.corrects ? quiz.sections.length : undefined, // how many timed parts
        byHand: quiz.questions.filter(handGraded).length, // questions graded by hand (grading by question)
        corrections: run.corrects ? { earnBack: run.earn_back, why: !!run.ask_why } : null,
        joinUrl: joinOrigin(req), // where students go (not localhost)
        // an exam's answers still waiting for the teacher: corrections leave those out
        waiting: !run.corrects && run.mode !== 'practice' ? roster.reduce((n, s) => { const a = byStudent.get(s.id); const t = a && a.status === 'submitted' ? totals(a.result, quiz, a.answers, a.layout) : null; return n + (t ? t.pending + t.review : 0); }, 0) : 0 },
      students: roster.map((s) => {
        const row = liveRow(s, byStudent.get(s.id), quiz, run);
        if (wrongIds.has(s.id)) row.wrongIds = wrongIds.get(s.id);
        if (row.attempt && checks.has(row.attempt.id)) row.attempt.checks = checks.get(row.attempt.id);
        if (row.attempt && lastStrike.has(row.attempt.id)) row.attempt.lastStrike = lastStrike.get(row.attempt.id);
        return row;
      }),
      ai: { on: !!aiKeyOf(me), job: aiJobs.get(run.id) || null },
    });
  });


  // Grading by question: the questions a teacher grades by hand (written answers, rubric items the server
  // can't check), how many answers each still needs, and one question's answers from everyone who got it.
  r.get('/api/t/runs/:id/grade', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const rows = q(`SELECT attempts.id, bq_name(roster_students.name, roster_students.id, roster_students.roster_id) AS name FROM attempts
      JOIN roster_students ON roster_students.id = attempts.student_id
      WHERE attempts.run_id = ? AND attempts.archived = 0 AND attempts.status = 'submitted' ORDER BY name`).all(run.id);
    const attempts = rows.map((x) => store.getAttempt(x.id));
    const questions = [];
    quiz.questions.forEach((qq, i) => {
      let total = 0;
      let toGrade = 0;
      for (const a of attempts) {
        if (!a.result || !store.quizFor(quiz, a.layout).questions.some((x) => x.id === qq.id)) continue;
        total++;
        if (questionScore(qq, a.result, a.answers).review) toGrade++;
      }
      if (total && (handGraded(qq) || toGrade)) questions.push({ id: qq.id, n: i + 1, type: qq.type, title: qq.name || '', toGrade, total });
    });
    const url = new URL(req.url, 'http://x');
    const pick = questions.find((x) => x.id === url.searchParams.get('q')) || questions.find((x) => x.toGrade) || questions[0];
    const students = [];
    if (pick) {
      rows.forEach((row, k) => {
        const a = attempts[k];
        if (!a.result) return;
        const report = studentReport(quiz, a, row.name);
        const at = report.questions.findIndex((x) => x.id === pick.id);
        if (at < 0) return; // a pool gave them other questions
        students.push({ attemptId: a.id, name: row.name, rq: report.questions[at], x: answerReport(quiz, a)[at], feedback: ((a.result.manual || {})[pick.id] || {}).feedback || '' });
      });
    }
    json(res, 200, { run: { id: run.id, code: run.code, title: quiz.title }, questions, q: pick ? pick.id : null, quiz: pick ? reportQuiz(quiz, run.quiz_id) : null, students });
  });

  // The grades for a gradebook: who, their score, out of what and the percent first, then how it went,
  // then each question. Times in the teacher's own time zone (the page sends it).
  r.get('/api/t/runs/:id/export.csv', (req, res, p) => {
    const me = requireTeacher(req);
    const run = getRun(me, p.id);
    notWhileOpen(run);
    const quiz = store.getQuiz(run.quiz_id);
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    let timeZone = new URL(req.url, 'http://x').searchParams.get('tz') || 'UTC';
    try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch (e) { timeZone = 'UTC'; }
    // 2026-11-26 14:05: what spreadsheets read as a date and time
    const when = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const at = (t) => {
      if (!t) return '';
      const d = Object.fromEntries(when.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return `${d.year}-${d.month}-${d.day} ${d.hour}:${d.minute}`;
    };
    const mmss = (ms) => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    const STATUS = { submitted: 'Turned in', active: 'Working', waiting: 'Waiting', admitted: 'Waiting' };
    const STATE = { pending: 'Grading', failed: 'Grading failed' };
    const head = ['Student', 'Score', 'Out of', 'Percent', 'Status', 'Integrity', 'Strikes', 'Time away', 'Needs grading', 'Started', 'Turned in',
      ...quiz.questions.map((qq, i) => `Q${i + 1}${qq.name ? ' ' + qq.name : ''}`),
      ...(run.corrects ? ['Exam score', 'Earned back', 'With corrections'] : [])];
    const lines = [head.map(esc).join(',')];
    for (const s of rosterStudentsForRun(run)) {
      const row = q('SELECT id FROM attempts WHERE run_id = ? AND student_id = ? AND archived = 0').get(run.id, s.id);
      const a = row ? store.getAttempt(row.id) : null;
      const t = a ? totals(a.result, quiz, a.answers, a.layout) : null;
      const given = a && a.layout ? new Set(store.quizFor(quiz, a.layout).questions.map((qq) => qq.id)) : null;
      const perQ = quiz.questions.map((qq) => {
        if (!a || !a.result || (given && !given.has(qq.id))) return ''; // a pool left it out of their quiz
        const sc = questionScore(qq, a.result, a.answers);
        return sc.state !== 'done' ? STATE[sc.state] || sc.state : sc.review ? 'Needs grading' : sc.points;
      });
      const score = t ? (a.integrity === 'invalidated' ? 0 : t.score) : null;
      lines.push([s.name, score, t ? t.max : '', t && t.max ? Math.round((score / t.max) * 1000) / 10 : '',
        a ? STATUS[a.status] || a.status : 'Not started', a ? (a.integrity === 'invalidated' ? 'Invalidated' : 'Clean') : '',
        a ? a.strikes : '', a && a.awayMs ? mmss(a.awayMs) : '', t ? t.pending + t.review + t.failed || '' : '',
        a ? at(a.startedAt) : '', a ? at(a.submittedAt) : '', ...perQ,
        ...(run.corrects ? (() => { const c = a && a.status === 'submitted' ? C.standing(quiz, run, a) : null; return c ? [c.exam, c.bonus, c.final] : ['', '', '']; })() : [])].map(esc).join(','));
    }
    send(res, 200, lines.join('\n') + '\n', {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${quiz.title.replace(/[^\w -]/g, '').slice(0, 60) || 'results'} ${run.code}.csv"`,
    });
  });
};
