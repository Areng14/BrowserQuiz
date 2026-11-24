'use strict';
// Pausing a quiz (teacher.js run actions pause and resume): every student's clock stops where it was.
// While it's paused nothing runs out, answers aren't taken (after a short grace for ones already on their
// way), and leaving doesn't count (store.record). On resume each clock moves on by how long it was stopped.
// runs.paused_at holds when the teacher paused (null: running); a.pausedAt is a copy on the attempt in
// memory, set by student.js current and the sweep in index.js.

// Answers sent just before the page heard about the pause still count this long after it.
const GRACE_MS = 10000;

// When this student's clock stopped: the pause, or their start if they started during it. 0: running.
const since = (a, pausedAt) => (pausedAt ? Math.max(pausedAt, a.startedAt || 0) : 0);
// "Now" on this student's clock: held where it stopped while the quiz is paused.
const clock = (a, pausedAt, now = Date.now()) => (pausedAt ? Math.min(now, since(a, pausedAt)) : now);
// Answers can still come in: running, or paused only a moment ago.
const taking = (pausedAt, now = Date.now()) => !pausedAt || now - pausedAt <= GRACE_MS;

// Resumed at `now`: the deadline, timed parts' ends and the class's normal time move on by how long this
// student's clock was stopped. Ones already past when it stopped stay put.
function shift(a, pausedAt, now) {
  if (a.status !== 'active') return 0;
  const from = since(a, pausedAt);
  const d = Math.max(0, now - from);
  if (!d) return 0;
  const later = (t) => (t && t > from ? t + d : t);
  a.deadline = later(a.deadline);
  if (a.layout && Array.isArray(a.layout.partEnds)) a.layout.partEnds = a.layout.partEnds.map(later);
  if (a.layout && a.layout.turnInAt) a.layout.turnInAt = later(a.layout.turnInAt);
  return d;
}

module.exports = { GRACE_MS, since, clock, taking, shift };
