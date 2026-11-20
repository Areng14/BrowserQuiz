// Shared quiz logic. Runs in Node (server.js) and in the browser (demo page),
// so grading + the anti-cheat rules behave the same everywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INTEGRITY_DEFAULTS = {
    onViolation: 'invalidate', // 'invalidate' | 'flag' (flag = log it, teacher decides)
    graceStrikes: 0,           // violations forgiven before invalidating. 0 = first one kills it
    requireFullscreen: true,
    blockExtendedDisplay: true // refuse to start / violate if a 2nd screen is detected
  };

  // Server decides how bad an event is. The client only reports what happened.
  const SEVERITY = {
    'blur': 'violation',             // window lost focus (alt-tab, clicked a notification, another app popped up)
    'hidden': 'violation',           // tab switched / minimized
    'fullscreen-exit': 'violation',
    'extended-display': 'violation', // second monitor / TV plugged in
    'reload': 'violation',           // page reloaded or reopened mid-quiz
    'unfocused-beat': 'violation',   // heartbeat says we're not focused (backup for patched listeners)
    'mouse-left': 'warning',         // cursor left the page. In fullscreen on 1 monitor this shouldn't happen
    'copy': 'warning',
    'paste': 'warning',
    'contextmenu': 'warning',
    'blocked-key': 'warning',
    'print-screen': 'warning',
    'resize': 'warning',             // window resized mid-quiz (snapping, devtools)
    'heartbeat-lost': 'warning',     // client went silent (JS killed, network, sleep)
    'late-submit': 'warning',
    'return': 'info',                // came back after leaving, with seconds away
    'start': 'info',
    'submit': 'info'
  };
  const VIOLATION_MERGE_MS = 2000; // alt-tab fires blur+hidden+fullscreen-exit together: count once

  function findRootPrefix(names) {
    if (names.includes('quiz.json')) return '';
    // people zip the folder instead of its contents. allow exactly one wrapper folder.
    const hits = names.filter(n => /^[^/]+\/quiz\.json$/.test(n));
    if (hits.length === 1) return hits[0].slice(0, -'quiz.json'.length);
    throw new Error('quiz.json must be at the root of the .quiz file');
  }

  function isJunk(name) {
    return name.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name);
  }

  function normalizeQuiz(raw, assetNames) {
    const errs = [];
    const fail = m => errs.push(m);
    if (!raw || typeof raw !== 'object') throw new Error('quiz.json must be an object');
    const quiz = {
      format: raw.format ?? 1,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled quiz',
      timeLimitMin: Number(raw.timeLimitMin) > 0 ? Number(raw.timeLimitMin) : 0,
      shuffleQuestions: raw.shuffleQuestions !== false,
      shuffleChoices: raw.shuffleChoices !== false,
      showScore: raw.showScore !== false,
      integrity: Object.assign({}, INTEGRITY_DEFAULTS, raw.integrity || {}),
      questions: []
    };
    if (quiz.format !== 1) fail(`unknown format ${quiz.format}`);
    if (!['invalidate', 'flag'].includes(quiz.integrity.onViolation)) fail('integrity.onViolation must be "invalidate" or "flag"');
    quiz.integrity.graceStrikes = Math.max(0, Math.floor(Number(quiz.integrity.graceStrikes) || 0));

    if (!Array.isArray(raw.questions) || raw.questions.length === 0) fail('questions must be a non-empty array');
    const seen = new Set();
    (raw.questions || []).forEach((q, i) => {
      const where = `questions[${i}]`;
      const id = String(q.id ?? `q${i + 1}`);
      if (seen.has(id)) fail(`${where}: duplicate id "${id}"`);
      seen.add(id);
      const type = q.type || 'single';
      if (!['single', 'multi', 'text'].includes(type)) return fail(`${where}: type must be single, multi or text`);
      if (typeof q.prompt !== 'string' || !q.prompt.trim()) fail(`${where}: prompt is required`);
      const out = { id, type, prompt: String(q.prompt || ''), points: Number(q.points) > 0 ? Number(q.points) : 1 };
      if (q.image != null) {
        const img = String(q.image).replace(/^\.?\//, '');
        if (!img.startsWith('assets/') || img.includes('..')) fail(`${where}: image must live in assets/`);
        else if (!assetNames.has(img)) fail(`${where}: image "${img}" is not in the .quiz`);
        out.image = img;
      }
      if (type === 'text') {
        const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
        if (!ans.length || ans.some(a => typeof a !== 'string' || !a.trim())) fail(`${where}: text answer must be a string or list of strings`);
        out.answer = ans.map(String);
        out.caseSensitive = !!q.caseSensitive;
      } else {
        if (!Array.isArray(q.choices) || q.choices.length < 2) return fail(`${where}: needs at least 2 choices`);
        out.choices = q.choices.map(String);
        const ans = type === 'single' ? [q.answer] : q.answer;
        if (!Array.isArray(ans) || !ans.length || ans.some(a => !Number.isInteger(a) || a < 0 || a >= out.choices.length)) {
          fail(`${where}: answer must be ${type === 'single' ? 'a choice index' : 'a list of choice indexes'} (0-based)`);
        }
        out.answer = type === 'single' ? q.answer : [...new Set(q.answer)];
      }
      quiz.questions.push(out);
    });
    if (errs.length) throw new Error('quiz.json problems:\n  - ' + errs.join('\n  - '));
    return quiz;
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Per-student question + choice order, so neighbors don't see the same layout.
  function makeOrder(quiz, rand) {
    const ids = quiz.questions.map(q => q.id);
    const order = quiz.shuffleQuestions ? shuffle(ids, rand) : ids;
    const choiceOrder = {};
    for (const q of quiz.questions) {
      if (!q.choices) continue;
      const idx = q.choices.map((_, i) => i);
      choiceOrder[q.id] = quiz.shuffleChoices ? shuffle(idx, rand) : idx;
    }
    return { order, choiceOrder };
  }

  // What the student's browser gets. No answers, ever.
  function publicQuiz(quiz, session) {
    const byId = new Map(quiz.questions.map(q => [q.id, q]));
    return {
      title: quiz.title,
      timeLimitMin: quiz.timeLimitMin,
      integrity: quiz.integrity,
      questions: session.order.map(id => {
        const q = byId.get(id);
        const pub = { id: q.id, type: q.type, prompt: q.prompt, points: q.points };
        if (q.image) pub.image = q.image;
        if (q.choices) pub.choices = session.choiceOrder[q.id].map(i => ({ i, text: q.choices[i] }));
        return pub;
      })
    };
  }

  function quizInfo(quiz) {
    return {
      title: quiz.title,
      questionCount: quiz.questions.length,
      timeLimitMin: quiz.timeLimitMin,
      integrity: quiz.integrity
    };
  }

  function norm(s, caseSensitive) {
    s = String(s).trim().replace(/\s+/g, ' ');
    return caseSensitive ? s : s.toLowerCase();
  }

  function gradeOne(q, resp) {
    if (resp == null) return false;
    if (q.type === 'single') return Number.isInteger(resp) && resp === q.answer;
    if (q.type === 'multi') {
      if (!Array.isArray(resp)) return false;
      const got = new Set(resp);
      return got.size === q.answer.length && q.answer.every(a => got.has(a));
    }
    if (typeof resp !== 'string') return false;
    return q.answer.some(a => norm(a, q.caseSensitive) === norm(resp, q.caseSensitive));
  }

  function grade(quiz, answers) {
    let score = 0, max = 0;
    const detail = quiz.questions.map(q => {
      const correct = gradeOne(q, answers ? answers[q.id] : null);
      max += q.points;
      if (correct) score += q.points;
      return { id: q.id, correct, points: q.points };
    });
    return { score, max, detail };
  }

  function newSession(quiz, { id, name, now, rand }) {
    const { order, choiceOrder } = makeOrder(quiz, rand);
    return {
      id, name,
      status: 'active', // active | submitted | invalidated
      startedAt: now,
      deadline: quiz.timeLimitMin ? now + quiz.timeLimitMin * 60000 : 0,
      order, choiceOrder,
      strikes: 0,
      lastViolationAt: 0,
      lastBeat: now,
      events: [{ t: now, type: 'start', severity: 'info' }],
      mouse: [],
      answers: {},
      result: null,
      reason: null,
      finishedAt: 0
    };
  }

  const MAX_EVENTS = 1500;
  const MAX_MOUSE = 6000;

  // Returns the severity it recorded, or null if ignored.
  function recordEvent(quiz, s, type, detail, now) {
    const severity = SEVERITY[type];
    if (!severity) return null;
    if (s.events.length < MAX_EVENTS) {
      const ev = { t: now, type, severity };
      if (detail != null && detail !== '') ev.detail = String(detail).slice(0, 200);
      s.events.push(ev);
    }
    if (severity !== 'violation' || s.status !== 'active') return severity;
    if (now - s.lastViolationAt < VIOLATION_MERGE_MS) { s.lastViolationAt = now; return severity; }
    s.lastViolationAt = now;
    s.strikes++;
    const g = quiz.integrity;
    if (g.onViolation === 'invalidate' && s.strikes > g.graceStrikes) {
      s.status = 'invalidated';
      s.reason = type;
      s.finishedAt = now;
      s.result = Object.assign(grade(quiz, s.answers), { invalidated: true });
    }
    return severity;
  }

  function addMouse(s, pts) {
    if (!Array.isArray(pts)) return;
    for (const p of pts) {
      if (s.mouse.length >= MAX_MOUSE) break;
      if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) {
        s.mouse.push([Math.max(0, Math.min(1000, p[0] | 0)), Math.max(0, Math.min(1000, p[1] | 0)), p[2] | 0]);
      }
    }
  }

  function cleanAnswers(quiz, answers) {
    const out = {};
    if (!answers || typeof answers !== 'object') return out;
    for (const q of quiz.questions) {
      const a = answers[q.id];
      if (a == null) continue;
      if (q.type === 'single' && Number.isInteger(a)) out[q.id] = a;
      else if (q.type === 'multi' && Array.isArray(a)) out[q.id] = a.filter(Number.isInteger).slice(0, q.choices.length);
      else if (q.type === 'text' && typeof a === 'string') out[q.id] = a.slice(0, 500);
    }
    return out;
  }

  function submit(quiz, s, answers, now) {
    if (s.status !== 'active') return;
    s.answers = cleanAnswers(quiz, answers);
    if (s.deadline && now > s.deadline + 30000) recordEvent(quiz, s, 'late-submit', Math.round((now - s.deadline) / 1000) + 's late', now);
    recordEvent(quiz, s, 'submit', null, now);
    if (s.status !== 'active') return; // (late-submit is only a warning, but be safe)
    s.status = 'submitted';
    s.finishedAt = now;
    s.result = grade(quiz, s.answers);
  }

  function studentView(quiz, s) {
    const v = { status: s.status, strikes: s.strikes, graceLeft: Math.max(0, quiz.integrity.graceStrikes - s.strikes) };
    if (s.status === 'invalidated') v.reason = s.reason;
    if (s.status === 'submitted' && quiz.showScore && s.result) { v.score = s.result.score; v.max = s.result.max; }
    return v;
  }

  return {
    INTEGRITY_DEFAULTS, SEVERITY, findRootPrefix, isJunk, normalizeQuiz, makeOrder, publicQuiz, quizInfo,
    grade, newSession, recordEvent, addMouse, cleanAnswers, submit, studentView
  };
});
