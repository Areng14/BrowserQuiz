'use strict';
// A quiz's parts, as the student's page splits it (app/answers.js partsFor): each section the teacher made, or else
// each run of questions of one type, in the student's own order.
//
// Locked parts (quiz.lockParts): once a student moves on from a part, its answers are final.
// Timed parts (sections with their own timeLimitMin): each part has its own clock, one after another. The
// student can't move on before a part's time is up, and when it is, the part locks and the next one starts.
const store = require('./store');

// Where each section the teacher made starts, by position in this student's order. Shuffling stays inside
// sections (store.makeLayout). A pool can leave out the question a section starts on: it then starts on
// the student's first question after that point.
function sectionStarts(quiz, layout) {
  const at = new Map(quiz.questions.map((qq, i) => [qq.id, i]));
  const order = layout ? layout.order : quiz.questions.map((qq) => qq.id);
  const out = [];
  for (const sec of quiz.sections || []) {
    if (!at.has(sec.before)) continue;
    const start = order.findIndex((id) => at.get(id) >= at.get(sec.before));
    if (start < 0) continue;
    if (out.length && out[out.length - 1].start === start) out.pop(); // a section this student has nothing in
    out.push({ start, title: sec.title, directions: sec.directions, timeLimitMin: sec.timeLimitMin });
  }
  return out;
}

// Not in corrections, which are their own few questions.
const locks = (quiz, layout) => !!(quiz.lockParts && layout && !layout.subset && !layout.fix);
const timed = (quiz, layout) => !!(quiz.timedParts && locks(quiz, layout));

function partsOf(quiz, layout) {
  const qs = store.quizFor(quiz, layout).questions;
  const typeOf = new Map(qs.map((qq) => [qq.id, qq.type]));
  const starts = new Set(sectionStarts(quiz, layout).map((s) => s.start));
  const part = new Map(); // question id -> part number (from 1)
  let n = 0;
  let type = null;
  let section = false;
  layout.order.forEach((id, i) => {
    const t = typeOf.get(id);
    if (starts.has(i)) { n++; section = true; type = t; } else if (!n || (!section && t !== type)) { n++; section = false; type = t; }
    part.set(id, n);
  });
  return { part, count: n };
}

// When each part's time is up, from the moment the quiz started, with this student's extra time (x).
function partEnds(quiz, layout, from, x) {
  let at = from;
  return sectionStarts(quiz, layout).map((s) => (at += Math.round((s.timeLimitMin || 0) * x * 60000)));
}
// How many parts' time is up at `now`.
const over = (a, now) => (a.layout && Array.isArray(a.layout.partEnds) ? a.layout.partEnds.filter((e) => e <= now).length : 0);
// The part whose clock is running (from 1), or null when the parts aren't timed.
const running = (a, now) => (a.layout && Array.isArray(a.layout.partEnds) ? Math.min(Math.max(over(a, now), a.layout.locked || 0) + 1, a.layout.partEnds.length) : null);

// Answers to a part that just closed still count this long after: they were typed in time and were on
// their way (a slow network, the last heartbeat).
const GRACE_MS = 10000;

// Answers coming in, with the finished parts' kept as they were (and, with timed parts, the ones not
// open yet). Timed parts lock here as their time runs out.
function keepLocked(quiz, a, next, now = Date.now()) {
  if (!locks(quiz, a.layout)) return next;
  const clock = timed(quiz, a.layout) && Array.isArray(a.layout.partEnds);
  if (clock) a.layout.locked = Math.max(a.layout.locked || 0, over(a, now - GRACE_MS));
  if (!a.layout.locked && !clock) return next;
  const { part } = partsOf(quiz, a.layout);
  const open = clock ? running(a, now) : Infinity;
  for (const [id, n] of part) {
    if (n > (a.layout.locked || 0) && n <= open) continue;
    if (a.answers && Object.hasOwn(a.answers, id)) next[id] = a.answers[id];
    else delete next[id];
  }
  return next;
}

// With locked parts, the questions whose part is open: the one being worked on (by its clock, or the one after
// the last finished) and those before it. A later part's questions only go to the page as it opens
// (studentquiz.js). null: all of them.
function openIds(quiz, a, now) {
  if (!locks(quiz, a.layout)) return null;
  const { part, count } = partsOf(quiz, a.layout);
  const upTo = Math.min(count, timed(quiz, a.layout) && Array.isArray(a.layout.partEnds) ? running(a, now) : (a.layout.locked || 0) + 1);
  return new Set([...part].filter(([, n]) => n <= upTo).map(([id]) => id));
}

// For the teacher's live table: each part's size and how many are answered, and the one they're on.
function liveParts(quiz, a, now) {
  if (!timed(quiz, a.layout) || !Array.isArray(a.layout.partEnds)) return undefined;
  const { part, count } = partsOf(quiz, a.layout);
  const sizes = Array(count).fill(0);
  const answered = Array(count).fill(0);
  for (const [id, n] of part) {
    sizes[n - 1]++;
    if (a.answers && Object.hasOwn(a.answers, id)) answered[n - 1]++;
  }
  const on = a.status === 'active' ? running(a, now) : null;
  return { sizes, answered, on, ends: a.layout.partEnds };
}

module.exports = { sectionStarts, locks, timed, partsOf, partEnds, over, running, keepLocked, openIds, liveParts, GRACE_MS };
