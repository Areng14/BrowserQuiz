'use strict';
// Fixing a quiz's answers after it was given (the quiz maker's "Update past scores?"). Editing saves a
// new version and every run keeps the version it was given with (teacher/library.js saveQuiz), so a fixed
// answer never reached the runs that had the wrong one. This carries over only what grades: the right
// choices, accepted answers, expected output, trace values, blanks, and a code question's hidden tests
// and reference. What students saw (prompts, choices, code, examples) stays as it was. Questions added,
// removed or changed to another type are left out, and so is a code question whose method or class
// changed (new tests wouldn't fit the code students wrote).

const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

// A choice in the new version, as its place in the old one: by its text, or by position when the
// choices were only reworded. -1: it can't be matched.
function choiceAt(oldQ, newQ, i) {
  const at = oldQ.choices.indexOf(newQ.choices[i]);
  if (at >= 0) return at;
  return oldQ.choices.length === newQ.choices.length ? i : -1;
}

// What grades this question in the new version, fitted to the old one; null when it can't carry over.
function keyOf(oldQ, newQ) {
  switch (oldQ.type) {
    case 'single': {
      const i = choiceAt(oldQ, newQ, newQ.answer);
      return i < 0 ? null : { answer: i };
    }
    case 'multi': {
      const picks = newQ.answer.map((i) => choiceAt(oldQ, newQ, i));
      if (picks.some((i) => i < 0)) return null;
      return { answer: [...new Set(picks)].sort((a, b) => a - b), partialCredit: newQ.partialCredit === true || undefined };
    }
    case 'text': return { answer: newQ.answer, caseSensitive: !!newQ.caseSensitive };
    case 'math': return { answer: newQ.answer, form: newQ.form, tolerance: newQ.tolerance };
    case 'graph': // the same grid and tools students drew with
      if (!same(newQ.window, oldQ.window) || newQ.step !== oldQ.step || !same(newQ.tools, oldQ.tools)) return null;
      return { answer: newQ.answer, shapes: newQ.shapes, partialCredit: newQ.partialCredit === true || undefined };
    case 'output': return newQ.answer != null ? { answer: newQ.answer } : null;
    case 'trace': {
      // the same table, with the cells shown filled in unchanged
      if (newQ.rows.length !== oldQ.rows.length || !same(newQ.columns.length, oldQ.columns.length) || !same(newQ.given, oldQ.given)) return null;
      if (oldQ.given.some(([r, c]) => oldQ.rows[r][c] !== newQ.rows[r][c])) return null;
      return { rows: newQ.rows };
    }
    case 'fill': {
      if (newQ.answer.length !== oldQ.answer.length || !!newQ.run !== !!oldQ.run) return null;
      return oldQ.run ? Object.assign({ answer: newQ.answer }, codeKey(oldQ, newQ) || {}) : { answer: newQ.answer };
    }
    case 'code': return codeKey(oldQ, newQ);
    default: return null; // written answers: the teacher grades them
  }
}
function codeKey(oldQ, newQ) {
  if (!same(oldQ.mode, newQ.mode) || !same(oldQ.signature, newQ.signature) || !same(oldQ.class, newQ.class) || !same(oldQ.types, newQ.types)) return null;
  if (!newQ.tests || !oldQ.tests) return null;
  return {
    tests: { sample: oldQ.tests.sample, hidden: newQ.tests.hidden }, // the examples were on their screen
    reference: Object.assign({}, oldQ.reference, newQ.reference),
    compare: newQ.compare,
  };
}

// The old version with the new version's answers: { quiz, changed: [question ids] }.
function merge(oldQuiz, newQuiz) {
  const byId = new Map(newQuiz.questions.map((qq) => [qq.id, qq]));
  const changed = [];
  const questions = oldQuiz.questions.map((oq) => {
    const nq = byId.get(oq.id);
    if (!nq || nq.type !== oq.type) return oq;
    const key = keyOf(oq, nq);
    if (!key || Object.keys(key).every((k) => same(oq[k], key[k]))) return oq;
    changed.push(oq.id);
    const out = Object.assign({}, oq, key);
    for (const k of Object.keys(key)) if (key[k] === undefined) delete out[k];
    return out;
  });
  return { quiz: Object.assign({}, oldQuiz, { questions }), changed };
}

module.exports = { merge, keyOf };
