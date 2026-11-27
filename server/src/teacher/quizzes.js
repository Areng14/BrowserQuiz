'use strict';
// Quizzes: the overview, uploads, the quiz maker's saves, downloads, previews and images.

const { q } = require('../db');
const store = require('../store');
const { json, readBody, readJson, send, HttpError } = require('../http');
const { normalizeQuiz, loadQuizFile, ASSET_TYPES, QuizError, fillTemplate, svgProblem } = require('../quizfile');
const Rekey = require('../rekey');
const { gradeAttempt, isRun, cleanAnswers, gradeAuto } = require('../grade');
const { writeZip } = require('../zip');
const { publicQuiz } = require('../student');
const { runSamples, gradeCode, checkSolutions, runnerConfigured } = require('../coderun');
const { audit, requireTeacher } = require('./common');
const { checkQuiz, getQuizRow, imagePaths, parseQuizJson, previewLayout, questionPrompt, quizError, quizPrompt, quizSource, retireQuiz, saveQuiz, staleRuns } = require('./library');

module.exports = function quizRoutes(r) {
  r.get('/api/t/overview', (req, res) => {
    const me = requireTeacher(req);
    // practiced: a student has turned it in as practice, so they've seen its answers
    const quizzes = q(`SELECT id, title, created_at, EXISTS(SELECT 1 FROM runs JOIN attempts ON attempts.run_id = runs.id
        WHERE runs.quiz_id = quizzes.id AND runs.mode = 'practice' AND attempts.status = 'submitted') AS practiced
      FROM quizzes WHERE archived = 0 AND owner_id = ? ORDER BY created_at DESC`).all(me.id).map((x) => {
      const quiz = store.getQuiz(x.id);
      return { id: x.id, title: x.title, questions: quiz.questions.length, timeLimitMin: quiz.timeLimitMin, createdAt: x.created_at, practiced: !!x.practiced };
    });
    const rosters = q('SELECT r.id, r.name, r.created_at, COUNT(s.id) AS n FROM rosters r LEFT JOIN roster_students s ON s.roster_id = r.id AND s.removed = 0 WHERE r.archived = 0 AND r.owner_id = ? GROUP BY r.id ORDER BY r.created_at DESC').all(me.id)
      .map((x) => ({ id: x.id, name: x.name, students: x.n, createdAt: x.created_at }));
    const runs = q(`SELECT runs.*, quizzes.title AS quiz_title, rosters.name AS roster_name,
        (SELECT COUNT(*) FROM attempts WHERE attempts.run_id = runs.id AND archived = 0) AS joined
      FROM runs JOIN quizzes ON quizzes.id = runs.quiz_id JOIN rosters ON rosters.id = runs.roster_id WHERE runs.owner_id = ? ORDER BY runs.created_at DESC LIMIT 50`).all(me.id)
      .map((x) => ({ id: x.id, code: x.code, status: x.status, quiz: x.quiz_title, roster: x.roster_name, rosterId: x.roster_id, joined: x.joined, ipLock: !!x.ip_lock, practice: x.mode === 'practice', corrections: !!x.corrects, seb: !!x.seb_key, createdAt: x.created_at }));
    json(res, 200, { quizzes, rosters, runs });
  });

  r.post('/api/t/quizzes', async (req, res) => {
    const me = requireTeacher(req);
    const buf = await readBody(req, 26 * 1024 * 1024);
    let parsed;
    try {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 64)).replace(/^\uFEFF/, '').trimStart();
      parsed = head.startsWith('{') ? { quiz: normalizeQuiz(parseQuizJson(buf), new Set()), assets: new Map() } : loadQuizFile(buf);
      await checkQuiz(parsed.quiz);
    } catch (e) { return quizError(res, e); }
    const id = saveQuiz(me, parsed.quiz, [...parsed.assets].map(([path, a]) => ({ path, mime: a.mime, bytes: a.bytes })), null);
    audit(me, 'upload-quiz', null, parsed.quiz.title);
    json(res, 200, { id, title: parsed.quiz.title, questions: parsed.quiz.questions.length });
  });

  // Quiz maker: save quiz.json from the editor. Editing saves a new copy and retires the old one
  // (images carry over), so runs that used the old version keep grading the same way.
  r.post('/api/t/quizzes/json', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 32 * 1024 * 1024);
    const old = body.replaces ? getQuizRow(me, body.replaces) : null;
    const assets = old ? store.listAssets(old.id) : [];
    let quiz;
    try {
      // Images added in the quiz maker arrive as base64, keyed by their assets/ path.
      for (const [p2, b64] of Object.entries(body.assets && typeof body.assets === 'object' ? body.assets : {})) {
        const ext = (p2.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
        if (!/^assets\/[A-Za-z0-9 _.-]{1,100}$/.test(p2) || p2.includes('..') || !ASSET_TYPES[ext]) throw new QuizError(`${p2}: images must be png, jpg, gif, webp or svg.`);
        const bytes = Buffer.from(String(b64), 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new QuizError(`${p2}: images can be up to 5 MB.`);
        const i = assets.findIndex((a) => a.path === p2);
        if (i >= 0) assets.splice(i, 1);
        const why = svgProblem(ext, bytes);
        if (why) throw new QuizError(`${p2} ${why}`);
        assets.push({ path: p2, mime: ASSET_TYPES[ext], bytes });
      }
      quiz = normalizeQuiz(body.quiz, new Set(assets.map((a) => a.path)));
      await checkQuiz(quiz);
    } catch (e) { return quizError(res, e); }
    const id = saveQuiz(me, quiz, assets, old && old.id);
    audit(me, old ? 'edit-quiz' : 'create-quiz', null, quiz.title);
    // answers changed on a quiz already given: the classes it was given to, and how many questions
    const stale = old ? staleRuns(me, id) : [];
    const past = stale.length ? { classes: [...new Set(stale.map((r) => r.roster))], questions: new Set(stale.flatMap((r) => r.changed)).size } : undefined;
    json(res, 200, { id, title: quiz.title, past });
  });

  // "Update past scores?": runs given with an earlier version get this version's answers (rekey.js), each
  // on a copy of the quiz it was given with, and are graded again. Grades the teacher gave by hand stay.
  r.post('/api/t/quizzes/:id/rekey', async (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const head = store.getQuiz(row.id);
    const stale = staleRuns(me, row.id);
    let regraded = 0;
    for (const oldId of [...new Set(stale.map((r) => r.quizId))]) {
      const m = Rekey.merge(store.getQuiz(oldId), head);
      if (!m.changed.length) continue;
      const fixed = saveQuiz(me, m.quiz, store.listAssets(oldId), null);
      q('UPDATE quizzes SET archived = 1, replaced_by = ? WHERE id = ?').run(row.id, fixed);
      q('UPDATE runs SET quiz_id = ? WHERE quiz_id = ? AND owner_id = ?').run(fixed, oldId, me.id);
      retireQuiz(oldId); // nothing uses it now
      const quiz = store.getQuiz(fixed);
      const runIds = q('SELECT id FROM runs WHERE quiz_id = ? AND owner_id = ?').all(fixed, me.id).map((x) => x.id);
      for (const runId of runIds) {
        for (const a of q("SELECT id FROM attempts WHERE run_id = ? AND archived = 0 AND status = 'submitted'").all(runId)) {
          const att = store.getAttempt(a.id);
          // code answers whose tests changed run again; the rest is scored from the new answers
          if (att.result && att.result.code) for (const qid of m.changed) delete att.result.code[qid];
          gradeAttempt(att, quiz).catch((e) => console.error('regrading failed', att.id, e));
          regraded++;
        }
      }
    }
    audit(me, 'rekey-quiz', null, row.title);
    json(res, 200, { ok: true, regraded });
  });

  // Pasted quiz.json -> the quiz maker. Validates without checking references or saving; images it
  // names come back as missing so they can be added in the editor.
  r.post('/api/t/quizzes/normalize', async (req, res) => {
    requireTeacher(req);
    const body = await readJson(req, 4 * 1024 * 1024);
    try {
      const raw = typeof body.json === 'string' ? parseQuizJson(Buffer.from(body.json)) : body.quiz;
      const images = imagePaths(raw);
      const quiz = normalizeQuiz(raw, images);
      json(res, 200, { quiz: quizSource(quiz), missingImages: [...images] });
    } catch (e) { return quizError(res, e); }
  });

  // A code question as it's being written, its solutions run against its tests: nothing is saved. One check
  // at a time per teacher (the maker sends the next when this one answers).
  const checking = new Set();
  r.post('/api/t/check-code', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 512 * 1024);
    if (!runnerConfigured()) return json(res, 200, { status: 'offline' });
    if (checking.has(me.id)) return json(res, 200, { status: 'busy' });
    let quiz;
    try {
      quiz = normalizeQuiz({ title: 'Check', questions: [body.question] }, new Set());
    } catch (e) {
      if (e instanceof QuizError) return json(res, 200, { status: 'invalid', message: e.message });
      throw e;
    }
    const qq = quiz.questions[0];
    if (qq.type !== 'code') throw new HttpError(400, 'bad_request');
    checking.add(me.id);
    try {
      json(res, 200, { status: 'ok', results: await checkSolutions(qq) });
    } catch (e) {
      json(res, 200, { status: 'offline' });
    } finally { checking.delete(me.id); }
  });

  r.get('/api/t/quiz-prompt', (req, res) => {
    requireTeacher(req);
    send(res, 200, quizPrompt(), {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="BrowserQuiz quiz prompt.txt"',
    });
  });
  // the same for one question, added to the quiz being made (the quiz maker's "From an AI")
  r.get('/api/t/question-prompt', (req, res) => {
    requireTeacher(req);
    send(res, 200, questionPrompt(), {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="BrowserQuiz question prompt.txt"',
    });
  });

  r.get('/api/t/quizzes/:id/source', (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const assets = q('SELECT path FROM assets WHERE quiz_id = ?').all(row.id).map((a) => a.path);
    json(res, 200, { id: row.id, quiz: quizSource(store.getQuiz(row.id)), assets });
  });

  r.get('/api/t/quizzes/:id/download', (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const entries = [{ name: 'quiz.json', data: Buffer.from(JSON.stringify(quizSource(store.getQuiz(row.id)), null, 2)) }];
    for (const a of store.listAssets(row.id)) entries.push({ name: a.path, data: a.bytes });
    send(res, 200, writeZip(entries), {
      // A .quiz is a zip, but sent as one Safari may unzip it into a folder or add ".zip" to the name.
      'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${row.title.replace(/[^\w -]/g, '').slice(0, 60) || 'quiz'}.quiz"`,
    });
  });

  // A copy to change (a version B, next year's): its own quiz, images and all, with no past runs.
  r.post('/api/t/quizzes/:id/duplicate', async (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    const quiz = Object.assign({}, store.getQuiz(row.id));
    quiz.title = `${quiz.title} (copy)`.slice(0, 120);
    const id = saveQuiz(me, quiz, store.listAssets(row.id), null);
    audit(me, 'duplicate-quiz', null, quiz.title);
    json(res, 200, { id, title: quiz.title });
  });

  r.post('/api/t/quizzes/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const row = getQuizRow(me, p.id);
    retireQuiz(row.id);
    audit(me, 'delete-quiz', null, row.title);
    json(res, 200, { ok: true });
  });

  // Preview: the quiz exactly as students see it (unshuffled), with Run and a score, nothing saved.
  r.get('/api/t/quizzes/:id/preview', (req, res, p) => {
    const me = requireTeacher(req);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    json(res, 200, { quiz: publicQuiz(quiz, previewLayout(quiz)), deadline: null, now: Date.now(), saved: {} });
  });

  r.post('/api/t/quizzes/:id/run', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 128 * 1024);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    const qq = quiz.questions.find((x) => x.id === body.questionId && isRun(x));
    const code = qq && qq.type === 'fill' ? (Array.isArray(body.blanks) ? fillTemplate(qq.code, body.blanks.map((b) => String(b || '').slice(0, 500))) : null) : body.code;
    if (!qq || !qq.languages.includes(body.language) || typeof code !== 'string') throw new HttpError(400, 'bad_request');
    try {
      json(res, 200, await runSamples(qq, body.language, code.slice(0, 50000)));
    } catch (e) {
      json(res, 200, { status: 'error', message: 'Code runner offline.' });
    }
  });

  r.post('/api/t/quizzes/:id/grade', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 1024 * 1024);
    const quiz = store.getQuiz(getQuizRow(me, p.id).id);
    const answers = cleanAnswers(quiz, null, body.answers);
    const auto = gradeAuto(quiz, previewLayout(quiz), answers); // random values: the first row, as the preview shows
    const questions = await Promise.all(quiz.questions.map(async (qq, i) => {
      if (qq.type === 'essay') return { n: i + 1, id: qq.id, points: null, max: qq.points, manual: true };
      if (!isRun(qq)) return { n: i + 1, id: qq.id, points: auto.detail[qq.id].points, max: qq.points };
      // rubric: points only the teacher can give (items the server can't check)
      let rubric = qq.rubric.reduce((sum, r2) => sum + r2.points, 0);
      try {
        const ans = qq.type === 'fill' ? { language: qq.language, code: fillTemplate(qq.code, answers[qq.id] || []) } : answers[qq.id];
        const c = await gradeCode(qq, ans);
        const auto = c.rubric || {};
        const checked = qq.rubric.filter((r2) => r2.id in auto);
        rubric -= checked.reduce((sum, r2) => sum + r2.points, 0);
        const points = c.status === 'done' ? c.score + checked.reduce((sum, r2) => sum + (auto[r2.id] ? r2.points : 0), 0) : null;
        return { n: i + 1, id: qq.id, points: points == null ? null : Math.round(points * 100) / 100, max: qq.points, rubric };
      } catch (e) {
        return { n: i + 1, id: qq.id, points: null, max: qq.points, rubric };
      }
    }));
    const score = Math.round(questions.reduce((sum, x) => sum + (x.points || 0), 0) * 100) / 100;
    json(res, 200, { ok: true, score, max: quiz.questions.reduce((sum, qq) => sum + qq.points, 0), questions });
  });
};
