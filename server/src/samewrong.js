'use strict';
// Same wrong answers: pairs of students who gave the very same wrong answers on choice, short answer and
// output questions. Matching right answers proves nothing; matching wrong ones is the classic sign of
// copying, more so the rarer the wrong answer. A wrong answer half the class gave (a common
// misconception) counts for little; one only these two gave counts for a lot. It only points the
// teacher at pairs to look at, like similar.js.
const store = require('./store');
const { textMatches, mathMatches } = require('./grade');
const { normOutput } = require('./quizfile');

const MIN_SHARED = 3; // same wrong answers a pair needs
const MIN_BITS = 7; // and how unlikely, all together (each answer adds -log2 of the share who gave it)
const MAX_PAIRS = 20;
const TYPES = new Set(['single', 'multi', 'text', 'math', 'output']);
const normText = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// A student's wrong answer to a question, as something comparable across shuffled choices (and across
// students who got the same values), plus what to show; null when right or blank.
function wrongAnswer(qq, a, perm, variant) {
  const orig = (i) => (perm ? perm[i] : i);
  const v = variant == null ? '' : `v${variant}:`; // random values: only the same version compares
  if (qq.type === 'single') {
    if (!Number.isInteger(a) || orig(a) === qq.answer) return null;
    return { key: `${v}c${orig(a)}`, shown: [qq.choices[orig(a)]] };
  }
  if (qq.type === 'multi') {
    if (!Array.isArray(a) || !a.length) return null;
    const got = [...new Set(a.map(orig))].sort((x, y) => x - y);
    if (got.length === qq.answer.length && qq.answer.every((x) => got.includes(x))) return null;
    return { key: `${v}m${got.join(',')}`, shown: got.map((i) => qq.choices[i]) };
  }
  if (typeof a !== 'string' || !a.trim()) return null;
  if (qq.type === 'text') return textMatches(qq, a) ? null : { key: `${v}t${normText(a)}`, text: a.slice(0, 200) };
  if (qq.type === 'output') return normOutput(a) === qq.answer ? null : { key: `${v}o${normText(a)}`, text: a.slice(0, 200) };
  // math: as typed (LaTeX), without the spacing and \left \right the math box adds
  if (qq.type === 'math') return mathMatches(qq, a) ? null : { key: `${v}x${a.replace(/\\(left|right)\b|\s+/g, '')}`, text: a.slice(0, 200), math: true };
  return null;
}

// attempts: [{ who, attempt }] (who: the student's place in the report). Returns the flagged pairs:
// { a, b, bits, same: [{ id, n, choices | text }] }, most telling first.
function sameWrong(quiz, attempts) {
  if (!quiz.questions.some((qq) => TYPES.has(qq.type))) return null; // nothing to compare
  const number = new Map(quiz.questions.map((qq, i) => [qq.id, i + 1]));
  const answered = new Map(); // question id -> how many answered it
  const groups = new Map(); // question id + key -> [{ who, shown }]
  for (const { who, attempt } of attempts) {
    const layout = attempt.layout;
    for (const qq of store.quizFor(quiz, layout).questions) {
      if (!TYPES.has(qq.type)) continue;
      const a = attempt.answers ? attempt.answers[qq.id] : undefined;
      if (a == null || a === '' || (Array.isArray(a) && !a.length)) continue;
      answered.set(qq.id, (answered.get(qq.id) || 0) + 1);
      const perm = layout && layout.perms ? layout.perms[qq.id] : null;
      const variant = layout && layout.vars ? layout.vars[qq.id] : null;
      const w = wrongAnswer(qq, a, perm, variant);
      if (!w) continue;
      const k = `${qq.id}\n${w.key}`;
      if (!groups.has(k)) groups.set(k, { id: qq.id, list: [] });
      groups.get(k).list.push({ who, shown: w.shown, text: w.text, math: w.math });
    }
  }
  const pairs = new Map(); // "a b" -> pair
  for (const { id, list } of groups.values()) {
    if (list.length < 2) continue;
    const bits = -Math.log2(list.length / Math.max(answered.get(id) || 1, list.length));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = list[i].who < list[j].who ? [list[i], list[j]] : [list[j], list[i]];
        const k = `${x.who} ${y.who}`;
        if (!pairs.has(k)) pairs.set(k, { a: x.who, b: y.who, bits: 0, same: [] });
        const p = pairs.get(k);
        p.bits += bits;
        p.same.push({ id, n: number.get(id), choices: x.shown, text: x.text, math: x.math || undefined, of: list.length });
      }
    }
  }
  return [...pairs.values()]
    .filter((p) => p.same.length >= MIN_SHARED && p.bits >= MIN_BITS)
    .sort((p, r) => r.bits - p.bits)
    .slice(0, MAX_PAIRS)
    .map((p) => Object.assign(p, { bits: Math.round(p.bits * 10) / 10, same: p.same.sort((x, y) => x.n - y.n) }));
}

module.exports = { sameWrong, wrongAnswer };
