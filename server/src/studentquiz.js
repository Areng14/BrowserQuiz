'use strict';
// The quiz as a student's page gets it: what each question needs to be shown and answered, never its answer.
// With locked parts, only the parts that are open (parts.js openIds): a later part's questions are just
// their place, type and points until it opens, and come with part-done or a heartbeat then. Without
// `open`, all of it (the teacher's preview and watch).
const store = require('./store');
const H = require('./harness');
const T = require('../../public/teacher/types.js');
const { studentLanguages } = require('./coderun');
const { calculatorOf } = require('./quizfile');
const { sectionStarts, locks } = require('./parts');

function publicQuiz(quiz, layout, open) {
  const shows = (id) => !open || open.has(id);
  const byId = new Map(store.quizFor(quiz, layout).questions.map((qq) => [qq.id, qq])); // with their random values
  const used = new Set(layout.order.filter(shows).flatMap((id) => [].concat(byId.get(id).shared || []))); // shared material their (open) questions use
  const calcs = calculatorOf(quiz); // the calculator each question has (its own, its part's or the quiz's)
  return {
    title: quiz.title,
    timeLimitMin: quiz.timeLimitMin,
    language: quiz.language,
    directions: quiz.directions,
    // a part not open yet: where it starts, its title and its time, not its directions
    sections: sectionStarts(quiz, layout).map((sec) => (shows(layout.order[sec.start]) ? sec : { start: sec.start, title: sec.title, timeLimitMin: sec.timeLimitMin })),
    lockParts: locks(quiz, layout) || undefined,
    turnInEarly: quiz.turnInEarly || undefined,
    calculator: quiz.calculator || undefined,
    // corrections: how each went on the exam (or that it's a new one from its pool), and the "What went wrong?" box
    corrections: layout.fix ? { why: !!layout.why, fix: Object.fromEntries(Object.entries(layout.fix).map(([id, f]) => [id, { points: f.old, max: f.max, fresh: !!f.fresh }])) } : undefined,
    shared: Object.fromEntries((quiz.shared || []).filter((m) => used.has(m.id)).map((m) => [m.id, { title: m.title, text: m.text, image: m.image || null, imageAlt: m.imageAlt || '' }])),
    questions: layout.order.map((id) => {
      const qq = byId.get(id);
      // its place until its part opens: the type and points lay the parts out, and its calculator's kind has
      // the page set the calculator up from the start; nothing else goes
      if (!shows(id)) return Object.assign({ id, type: qq.type, points: qq.points, later: true }, calcs.get(id) ? { calculator: calcs.get(id) } : {});
      const pub = { id, type: qq.type, prompt: qq.prompt, points: qq.points };
      if (calcs.get(id)) pub.calculator = calcs.get(id);
      if (qq.name) pub.name = qq.name;
      if (qq.partialCredit) pub.partialCredit = true;
      if (qq.shared) pub.shared = qq.shared;
      if (qq.image) { pub.image = qq.image; pub.imageAlt = qq.imageAlt || ''; }
      if (qq.choices) pub.choices = layout.perms[id].map((i) => qq.choices[i]); // positions only
      // New types: what's needed to show the question, never the answers.
      if (qq.type === 'output') Object.assign(pub, { code: qq.code, codeLang: qq.language });
      if (qq.type === 'trace') {
        Object.assign(pub, {
          code: qq.code, codeLang: qq.language, columns: qq.columns,
          cells: qq.rows.map((r, ri) => r.map((v, ci) => (qq.given.some((g) => g[0] === ri && g[1] === ci) ? v : null))),
        });
      }
      if (qq.type === 'fill') {
        Object.assign(pub, { code: qq.code, codeLang: qq.language, blanks: qq.answer.length, run: !!qq.run && !qq.noRun });
        if (qq.run) {
          pub.samples = qq.tests.sample.map((t) => ({ call: { [qq.language]: H.callText(qq, t, qq.language) }, expected: { [qq.language]: H.expectedText(qq, t, qq.language) } }));
        }
      }
      if (qq.type === 'essay') pub.codeLang = qq.language || null;
      // a graph: the grid and the drawing tools, and whether shading is one of them (never the answer)
      if (qq.type === 'graph') Object.assign(pub, { window: qq.window, step: qq.step, tools: qq.tools, shade: qq.shapes.some((sh) => sh.side) || undefined });
      if (qq.type === 'code') {
        pub.mode = qq.mode;
        pub.languages = studentLanguages(qq); // with "any language", the ones this server's runner has
        if (qq.ban) pub.ban = qq.ban; // a rule, so students see it
        if (qq.noRun) pub.noRun = true;
        // The question's own classes, written out in each language: theirs to use, not to write.
        if (qq.types) pub.given = Object.fromEntries(qq.languages.map((l) => [l, T.classSource(qq.types, l, true)]));
        pub.starter = Object.fromEntries(qq.languages.map((l) => [l, H.starterCode(qq, l)]));
        pub.samples = qq.tests.sample.map((t) => ({
          call: Object.fromEntries(qq.languages.map((l) => [l, H.callText(qq, t, l)])),
          expected: Object.fromEntries(qq.languages.map((l) => [l, H.expectedText(qq, t, l)])),
        }));
      }
      return pub;
    }),
  };
}

module.exports = { publicQuiz };
