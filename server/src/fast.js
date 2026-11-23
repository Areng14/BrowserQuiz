'use strict';
// Too fast: right answers given in a small fraction of the time the class needed for the same question.
// A student who saw the answer somewhere (a phone, a friend's screen, last period's quiz) doesn't need to
// work it out. Time on a question is what the heartbeats saw on screen while the quiz had focus
// (student.js), so a quick answer after a long first look still counts the first look. Like
// samewrong.js, it only points the teacher at answers to ask about.
const store = require('./store');
const { questionScore } = require('./grade');

const MIN_TIMED = 5; // students with a time on the question, for its median to mean anything
const MIN_MEDIAN_MS = 30000; // questions the class took at least this long on (a quick one is quick for all)
const SHARE = 0.25; // flagged under a quarter of the median
const MAX_ROWS = 30;

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// attempts: [{ who, attempt }] (who: the student's place in the report). Returns
// [{ who, id, n, ms, median }], fastest compared with the class first; null when no one has times yet.
function fastRight(quiz, attempts) {
  const number = new Map(quiz.questions.map((qq, i) => [qq.id, i + 1]));
  const times = new Map(); // question id -> [ms]
  for (const { attempt } of attempts) {
    for (const [id, ms] of Object.entries(attempt.qTime || {})) {
      if (!number.has(id) || !(ms > 0)) continue;
      if (!times.has(id)) times.set(id, []);
      times.get(id).push(ms);
    }
  }
  if (!times.size) return null;
  const rows = [];
  for (const [id, list] of times) {
    if (list.length < MIN_TIMED) continue;
    const m = median(list);
    if (m < MIN_MEDIAN_MS) continue;
    for (const { who, attempt } of attempts) {
      const ms = attempt.qTime && attempt.qTime[id];
      if (!(ms > 0) || ms >= m * SHARE || !attempt.result) continue;
      const qq = store.quizFor(quiz, attempt.layout).questions.find((x) => x.id === id);
      if (!qq) continue;
      const s = questionScore(qq, attempt.result, attempt.answers);
      if (s.state !== 'done' || !(s.max > 0) || s.points < s.max) continue; // right answers only
      rows.push({ who, id, n: number.get(id), ms: Math.round(ms), median: Math.round(m) });
    }
  }
  rows.sort((x, y) => x.ms / x.median - y.ms / y.median);
  return rows.slice(0, MAX_ROWS);
}

module.exports = { fastRight, MIN_TIMED, MIN_MEDIAN_MS, SHARE };
