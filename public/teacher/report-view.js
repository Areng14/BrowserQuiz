// Draws questions with a student's answer next to the correct one. Used by the printable report, the
// practice review, and the teacher's student panel. Needs BQ.md (md.js).
(function () {
  'use strict';
  const KIND = {
    single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', method: 'Write a method', class: 'Write a class',
    output: 'Predict the output', trace: 'Trace table', fill: 'Fill in the blanks', essay: 'Written answer',
  };
  const LANG = { java: 'Java', python: 'Python' };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const fmtPts = (n) => String(Math.round(n * 100) / 100);
  const md = (src, lang) => h('div', { class: 'r-prompt' }, window.BQ.md.render(src, { lang }));
  const inline = (src, lang) => h('span', {}, window.BQ.md.renderInline(src, { lang }));

  // opts.teacher: leave out the rubric list (the dashboard shows editable checkboxes instead).
  // opts.assetUrl(path): where images load from (teacher API, or /asset/ for a student).
  function question(quiz, q, i, opts) {
    const o = opts || {};
    const kind = q.type === 'code' ? KIND[q.mode] || KIND.method : KIND[q.type];
    const pts = q.points == null ? `– / ${fmtPts(q.max)}` : `${fmtPts(q.points)} / ${fmtPts(q.max)}`;
    const body = [];
    if (q.type === 'single' || q.type === 'multi') {
      if (!q.picked.length) body.push(h('p', { class: 'r-none', text: 'No answer' }));
      body.push(h('ul', { class: 'r-choices' }, q.choices.map((c, ci) => {
        const picked = q.picked.includes(ci);
        const correct = q.correct.includes(ci);
        const tag = picked && correct ? 'Your answer (correct)' : picked ? 'Your answer' : correct ? 'Correct answer' : '';
        return h('li', { class: correct ? 'correct' : picked ? 'wrong' : null },
          h('span', { class: 'r-mark', text: correct ? '✓' : picked ? '✗' : '' }),
          inline(c, quiz.language),
          tag ? h('span', { class: 'r-tag', text: tag }) : null);
      })));
    } else if (q.type === 'text') {
      body.push(h('p', { class: 'r-label', text: 'Your answer' }),
        q.answer == null ? h('p', { class: 'r-none', text: 'No answer' }) : h('p', { class: 'r-text', text: q.answer }));
      body.push(h('p', { class: 'r-label', text: 'Correct answer' }), h('p', { class: 'r-text', text: q.accepted[0] }));
      if (q.accepted.length > 1) body.push(h('p', { class: 'r-label', text: 'Also accepted' }), h('p', { class: 'r-text', text: q.accepted.slice(1).join(', ') }));
    } else if (q.type === 'output') {
      body.push(h('pre', {}, h('code', { text: q.code })),
        h('p', { class: 'r-label', text: 'Your answer' }),
        q.answer == null ? h('p', { class: 'r-none', text: 'No answer' }) : h('pre', { class: q.points === q.max ? 'r-good' : 'r-bad' }, q.answer),
        h('p', { class: 'r-label', text: 'Correct answer' }), h('pre', {}, q.correct));
    } else if (q.type === 'trace') {
      if (q.code) body.push(h('pre', {}, h('code', { text: q.code })));
      body.push(h('table', { class: 'r-trace' },
        h('thead', {}, h('tr', {}, q.columns.map((c) => h('th', { text: c })))),
        h('tbody', {}, q.cells.map((row) => h('tr', {}, row.map((cell) => {
          if (cell.given) return h('td', { class: 'given', text: cell.value });
          if (cell.ok) return h('td', { class: 'ok' }, h('span', { class: 'r-mark', text: '✓' }), cell.value);
          return h('td', { class: 'no' }, h('span', { class: 'r-mark', text: '✗' }), cell.value ? h('s', { text: cell.value }) : '', ' ', h('b', { text: cell.correct }));
        }))))));
    } else if (q.type === 'fill') {
      // The code with each blank showing what was typed, then the blanks one by one.
      const pieces = q.code.split(/_{3,}/);
      body.push(h('pre', {}, pieces.map((seg, i) => [seg, i < pieces.length - 1
        ? h('span', { class: 'r-blank ' + (q.blanks[i].ok ? 'ok' : 'no') }, q.blanks[i].value || `(${i + 1})`) : null])));
      body.push(h('ul', { class: 'r-blanks' }, q.blanks.map((b, i) => h('li', {},
        h('span', { class: b.ok ? 'r-ok' : 'r-no', text: b.ok ? '✓ ' : '✗ ' }),
        `Blank ${i + 1}: `, b.value ? h('code', { text: b.value }) : h('span', { class: 'r-none', text: 'no answer' }),
        b.ok ? null : [' (correct: ', b.accepted.map((x, k) => [k ? ' or ' : '', h('code', { text: x })]), ')']))));
      if (q.run) body.push(h('p', { class: 'r-label', text: 'Any answer that makes the code work counts.' }));
      if (q.compileError) body.push(h('p', { class: 'r-label', text: "Didn't compile" }), h('pre', { class: 'r-err', text: q.compileError }));
    } else if (q.type === 'essay') {
      body.push(h('p', { class: 'r-label', text: 'Your answer' }),
        q.answer == null ? h('p', { class: 'r-none', text: 'No answer' }) : q.codeLang ? h('pre', {}, h('code', { text: q.answer })) : h('p', { class: 'r-essay', text: q.answer }));
      if (q.rubric.length && !o.teacher) {
        const unit = (n) => `${fmtPts(n)} ${n === 1 ? 'point' : 'points'}`;
        body.push(h('p', { class: 'r-label', text: q.rubricGraded ? 'Rubric' : 'Rubric (not graded yet)' }), h('ul', { class: 'r-rubric' }, q.rubric.map((r) => h('li', {},
          !q.rubricGraded ? h('span', { class: 'r-empty', text: '– ' }) : h('span', { class: r.met ? 'r-ok' : 'r-no', text: r.met ? '✓ ' : '✗ ' }),
          `${r.text} (${unit(r.points)})`))));
      }
    } else {
      body.push(h('p', { class: 'r-label', text: `Your answer (${LANG[q.language] || q.language})` }),
        q.answer == null ? h('p', { class: 'r-none', text: 'No answer' }) : h('pre', {}, h('code', { text: q.answer })));
      if (q.compileError) body.push(h('p', { class: 'r-label', text: "Didn't compile" }), h('pre', { class: 'r-err', text: q.compileError }));
      if (q.rubric.length && !o.teacher) {
        const unit = (n) => `${fmtPts(n)} ${n === 1 ? 'point' : 'points'}`;
        body.push(h('p', { class: 'r-label', text: q.rubricGraded ? 'Rubric' : 'Rubric (not graded yet)' }), h('ul', { class: 'r-rubric' }, q.rubric.map((r) => h('li', {},
          !q.rubricGraded ? h('span', { class: 'r-empty', text: '– ' }) : h('span', { class: r.met ? 'r-ok' : 'r-no', text: r.met ? '✓ ' : '✗ ' }),
          `${r.text} (${unit(r.points)})`))));
      }
      if (q.reference) body.push(h('p', { class: 'r-label', text: `Correct answer (${LANG[q.referenceLanguage] || q.referenceLanguage})` }), h('pre', {}, h('code', { text: q.reference })));
    }
    return h('section', { class: 'r-q' + (q.type === 'code' ? ' code' : '') },
      h('div', { class: 'r-qhead' }, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: kind }), h('span', { class: 'pts', text: pts })),
      md(q.prompt, quiz.language),
      q.image ? h('img', { class: 'r-img', src: o.assetUrl ? o.assetUrl(q.image) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(q.image)}`, alt: q.imageAlt || '' }) : null,
      body);
  }

  function student(quiz, s, opts) {
    const score = s.score == null ? 'Not graded' : `${fmtPts(s.score)} / ${fmtPts(s.max)}${s.unfinished ? ' (grading not finished)' : ''}`;
    return h('article', { class: 'r-student' },
      h('header', { class: 'r-head' },
        h('h1', { text: quiz.title }),
        h('div', { class: 'r-meta' },
          h('span', {}, h('b', { text: s.name })),
          s.submittedAt ? h('span', { text: new Date(s.submittedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }) : null,
          h('span', {}, 'Score: ', h('b', { text: score })))),
      s.questions.map((q, i) => question(quiz, q, i, opts)));
  }

  window.BQReport = { question, student, h };
})();
