// Draws a student's quiz: each question with their answer next to the correct one. Used by the printable
// report (one student, or a whole class with an overview first), the practice review, and the teacher's
// student panel. Needs BQ.md (md.js). Code gets syntax colors from Monaco's tokenizer, drawn with our own
// CSS classes so they follow light/dark and print correctly.
(function () {
  'use strict';
  const KIND = {
    single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', math: 'Math', graph: 'Graph', method: 'Write a method', class: 'Write a class',
    output: 'Predict the output', trace: 'Trace table', fill: 'Fill in the blanks', essay: 'Written answer',
  };
  // Math, typeset: a student's answer is LaTeX from the math box, a teacher's is plain math (mathexpr.js)
  const texOf = (src, latex) => {
    if (latex) return String(src).replace(/\$/g, '');
    const t = window.BQMath ? window.BQMath.toTex(src) : null;
    return t == null ? null : t;
  };
  const mathEl = (src, latex) => {
    const t = texOf(src, latex);
    return t == null ? h('code', { text: src }) : h('div', { class: 'r-math' }, window.BQ.md.render(`$$${t}$$`));
  };
  const FORM_NOTE = { expanded: 'Has to be expanded.', factored: 'Has to be factored.', exact: 'Has to be exact, without decimals.', lowest: 'Has to be in lowest terms.' };
  const LANG = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust' };

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
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  // assetUrl: where the quiz's images are, for images written in Markdown.
  const md = (src, lang, assetUrl) => h('div', { class: 'r-prompt' }, window.BQ.md.render(src, { lang, assetUrl }));
  const inlineMath = (src) => { const t = window.BQMath ? window.BQMath.toTex(src) : null; return t == null ? h('code', { text: src }) : window.BQ.md.renderInline(`$${t}$`); };
  const inline = (src, lang, assetUrl) => (/\n/.test(src) // a choice with more than one line is set as blocks
    ? h('div', { class: 'r-choice-rich' }, window.BQ.md.render(src, { lang, assetUrl }))
    : h('span', {}, window.BQ.md.renderInline(src, { lang, assetUrl })));
  const imagesOf = (quiz, o) => (p) => (o && o.assetUrl ? o.assetUrl(p) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(p)}`);
  const codeBox = (text, lang) => h('pre', { class: 'r-code' }, h('code', { 'data-lang': lang || null, text }));
  const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function answered(q) {
    if (q.type === 'single' || q.type === 'multi') return q.picked.length > 0;
    if (q.type === 'trace') return q.cells.some((r) => r.some((c) => !c.given && c.value));
    if (q.type === 'fill') return q.blanks.some((b) => b.value);
    if (q.type === 'graph') return !!(q.drawn && q.drawn.length);
    return q.answer != null;
  }
  // Marks as thin line icons: the text ✓ and ✗ look hand-drawn in most fonts.
  const MARKS = { yes: 'M5 12.5l4.5 4.5L19 7.5', no: 'M7 7l10 10M17 7L7 17', dash: 'M7 12h10' };
  function mark(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', MARKS[kind]);
    s.append(p);
    return s;
  }
  // a mark with words for screen readers
  const markSpan = (kind, label) => h('span', { class: 'r-mark', role: 'img', 'aria-label': label }, mark(kind));
  const ICON = { full: 'yes', partial: 'yes', zero: 'no', pending: 'dash' };
  // full | partial | zero | pending, and the words for it. A rubric still to grade keeps the color the
  // auto-graded part earned; written answers have nothing until the teacher grades them.
  function status(q) {
    if (q.points == null || (q.review && q.type === 'essay')) return ['pending', 'Not graded yet'];
    const st = q.points >= q.max ? 'full' : q.points > 0 ? 'partial' : 'zero';
    if (q.review) return [st, 'Rubric not graded'];
    return [st, st === 'full' ? 'Correct' : st === 'partial' ? 'Partly right' : answered(q) ? 'Incorrect' : 'No answer'];
  }

  // "Your answer" beside "Correct answer". ok: true/false tints the student's side; null leaves it plain.
  function compare(o, mine, ok, right, rightLabel, stacked) {
    return h('div', { class: 'r-compare' + (stacked ? ' stacked' : '') },
      h('div', { class: 'r-side' + (ok === true ? ' good' : ok === false ? ' bad' : '') },
        h('p', { class: 'r-label', text: o.teacher ? 'Their answer' : 'Your answer' }), mine),
      right ? h('div', { class: 'r-side' }, h('p', { class: 'r-label', text: rightLabel || 'Correct answer' }), right) : null);
  }
  const none = () => h('p', { class: 'r-none', text: 'No answer' });

  function rubricList(q) {
    const unit = (n) => `${fmtPts(n)} ${n === 1 ? 'point' : 'points'}`;
    // Each item is graded on its own: some are checked by the server, the rest wait for the teacher.
    const graded = (r) => (r.graded != null ? r.graded : !!q.rubricGraded);
    return [h('p', { class: 'r-label', text: q.rubric.some(graded) ? 'Rubric' : 'Rubric (not graded yet)' }),
      h('ul', { class: 'r-rubric' }, q.rubric.map((r) => h('li', { class: !graded(r) ? '' : r.met ? 'met' : 'unmet' },
        !graded(r) ? markSpan('dash', 'Not graded') : r.met ? markSpan('yes', 'Met') : markSpan('no', 'Not met'), `${r.text} (${unit(r.points)})`)))];
  }

  function body(quiz, q, o) {
    const ok = q.points != null && !q.review ? q.points >= q.max : null;
    if (q.type === 'single' || q.type === 'multi') {
      return h('ul', { class: 'r-choices' }, q.choices.map((c, ci) => {
        const picked = q.picked.includes(ci);
        const correct = q.correct.includes(ci);
        // picked and right: filled green. Picked and wrong: filled red. Right but not picked: outlined.
        const cls = picked ? (correct ? 'is-correct' : 'is-wrong') : correct ? 'is-missed' : '';
        const mine = o.teacher ? 'Their answer' : 'Your answer';
        return h('li', { class: cls },
          correct ? markSpan('yes', 'Correct') : picked ? markSpan('no', 'Wrong') : h('span', { class: 'r-mark' }),
          h('span', { class: 'r-choice' }, inline(c, quiz.language, imagesOf(quiz, o))),
          picked ? h('span', { class: 'r-tag', text: mine }) : null,
          correct && !picked ? h('span', { class: 'r-tag', text: q.type === 'multi' && q.picked.length ? 'Missed' : 'Correct answer' }) : null);
      }));
    }
    if (q.type === 'text') {
      const right = h('div', {}, h('p', { class: 'r-text', text: q.accepted[0] }),
        q.accepted.length > 1 ? h('p', { class: 'r-also', text: `Also accepted: ${q.accepted.slice(1).join(', ')}` }) : null);
      return compare(o, q.answer == null ? none() : h('p', { class: 'r-text', text: q.answer }), q.answer == null ? false : ok, right);
    }
    if (q.type === 'math') {
      const notes = [q.form ? FORM_NOTE[q.form] : null, q.tolerance ? `Within ${q.tolerance}.` : null].filter(Boolean).join(' ');
      const right = h('div', {}, mathEl(q.accepted[0]),
        q.accepted.length > 1 ? h('div', { class: 'r-also' }, 'Also accepted: ', q.accepted.slice(1).map((x, k) => [k ? ', ' : '', inlineMath(x)])) : null,
        notes ? h('p', { class: 'r-also', text: notes }) : null);
      return compare(o, q.answer == null ? none() : mathEl(q.answer, true), q.answer == null ? false : ok, right);
    }
    if (q.type === 'graph') {
      if (!window.BQGraph) return null;
      const mine = q.drawn.length ? window.BQGraph.view({ window: q.window, step: q.step, drawn: q.drawn, label: o.teacher ? 'Their graph' : 'Your graph' }) : none();
      const right = h('div', {}, window.BQGraph.view({ window: q.window, step: q.step, shapes: q.shapes, label: 'Correct graph' }),
        h('div', { class: 'r-also' }, q.accepted.map((x, k) => [k ? ', ' : '', inlineMath(x)])));
      right.firstChild.classList.add('answer');
      return compare(o, mine, q.drawn.length ? ok : false, right, 'Correct graph');
    }
    if (q.type === 'output') {
      return [codeBox(q.code, q.codeLang),
        compare(o, q.answer == null ? none() : h('pre', { class: 'r-out', text: q.answer }), q.answer == null ? false : ok, h('pre', { class: 'r-out', text: q.correct }), 'Correct output')];
    }
    if (q.type === 'trace') {
      return [q.code ? codeBox(q.code, q.codeLang) : null,
        h('div', { class: 'r-trace-wrap' }, h('table', { class: 'r-trace' },
          h('thead', {}, h('tr', {}, q.columns.map((c) => h('th', { text: c })))),
          h('tbody', {}, q.cells.map((row) => h('tr', {}, row.map((cell) => {
            if (cell.given) return h('td', { class: 'given', text: cell.value });
            if (cell.ok) return h('td', { class: 'ok' }, cell.value);
            return h('td', { class: 'no' }, cell.value ? h('s', { text: cell.value }) : null, h('b', { text: cell.correct }));
          }))))))];
    }
    if (q.type === 'fill') {
      const pieces = q.code.split(/_{3,}/);
      return [
        h('pre', { class: 'r-code r-fill' }, pieces.map((seg, i) => [
          seg ? h('code', { 'data-lang': q.codeLang, text: seg }) : null,
          i < pieces.length - 1 ? h('span', { class: 'r-blank ' + (q.blanks[i].ok ? 'ok' : 'no') }, q.blanks[i].value || `(${i + 1})`) : null])),
        h('ul', { class: 'r-blanks' }, q.blanks.map((b, i) => h('li', { class: b.ok ? 'met' : 'unmet' },
          b.ok ? markSpan('yes', 'Right') : markSpan('no', 'Wrong'),
          h('span', { class: 'r-blank-n', text: `Blank ${i + 1}` }),
          b.value ? h('code', { text: b.value }) : h('span', { class: 'r-none', text: 'no answer' }),
          b.ok ? null : h('span', { class: 'r-also' }, ' Correct: ', b.accepted.map((x, k) => [k ? ' or ' : '', h('code', { text: x })]))))),
        q.compileError ? [h('p', { class: 'r-label', text: "Didn't compile" }), h('pre', { class: 'r-err', text: q.compileError })] : null,
        testTable(q),
      ];
    }
    if (q.type === 'essay') {
      return [
        h('div', { class: 'r-side' }, h('p', { class: 'r-label', text: o.teacher ? 'Their answer' : 'Your answer' }),
          q.answer == null ? none() : q.codeLang ? codeBox(q.answer, q.codeLang) : h('p', { class: 'r-essay', text: q.answer })),
        q.rubric.length && !o.teacher ? rubricList(q) : null,
      ];
    }
    // code
    return [
      codeCompare(q, o),
      q.banned ? [h('p', { class: 'r-label', text: 'Not allowed' }), h('p', { class: 'r-err-line' }, 'Uses ', q.banned.map((b, i) => [i ? ', ' : '', h('code', { text: b })]), ', so it scores 0.')] : null,
      q.compileError ? [h('p', { class: 'r-label', text: "Didn't compile" }), h('pre', { class: 'r-err', text: q.compileError })] : null,
      testTable(q),
      q.rubric.length && !o.teacher ? rubricList(q) : null,
    ];
  }

  // The hidden tests, for the teacher (the server only sends them to teachers): each call, what it
  // should return and what it did. Open when any failed.
  function testTable(q) {
    if (!q.tests || !q.tests.length) return null;
    const passed = q.tests.filter((t) => t.pass).length;
    const d = h('details', { class: 'r-tests' },
      h('summary', { text: `Hidden tests: ${passed} of ${q.tests.length} passed` }),
      h('div', { class: 'r-tests-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { 'aria-label': 'Result' }), h('th', { text: 'Call' }), h('th', { text: 'Expected' }), h('th', { text: 'Got' }))),
        h('tbody', {}, q.tests.map((t) => h('tr', { class: t.pass ? 'ok' : 'no' },
          h('td', { class: 'r-mark-cell' }, t.pass ? markSpan('yes', 'Passed') : markSpan('no', 'Failed')),
          h('td', {}, h('code', { text: t.call }), t.speed ? h('span', { class: 'r-speed', text: 'speed' }) : null),
          h('td', {}, t.expected ? h('code', { text: t.expected }) : null),
          h('td', {}, t.got == null ? null : h('code', { text: t.got }))))))));
    if (passed < q.tests.length) d.open = true;
    return d;
  }

  // ---------- code answer vs the reference ----------
  // Same code (ignoring blank lines, and indentation outside Python): shown once. Otherwise "Show differences"
  // swaps the two blocks for one diff, with the changed words marked inside lines that were edited.
  const norm = (lines) => lines.map((line) => line.trim());
  // Python's indentation is its structure, so it counts: as levels, so 2 spaces and 4 spaces still match.
  const normPy = (lines) => {
    const lead = lines.map((l) => l.replace(/\t/g, '    ').match(/^ */)[0].length);
    const unit = Math.min(...lead.filter((n) => n > 0), Infinity);
    return lines.map((l, i) => `${lead[i] && unit < Infinity ? Math.round(lead[i] / unit) : 0}|${l.trim()}`);
  };
  // Word-level changes between an edited line and its counterpart: [start, end] ranges in each line.
  // Lines that share too little get no marks, since everything would light up.
  function wordRanges(a, b) {
    const tok = (s) => { const out = []; const re = /\w+|\s+|[^\w\s]/g; let m; while ((m = re.exec(s))) out.push([m[0], m.index]); return out; };
    const A = tok(a);
    const B = tok(b);
    if (A.length * B.length > 40000) return null;
    const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i][0] === B[j][0] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const keepA = new Set();
    const keepB = new Set();
    for (let i = 0, j = 0; i < A.length && j < B.length;) {
      if (A[i][0] === B[j][0]) { keepA.add(i++); keepB.add(j++); } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    const words = (T) => T.filter((t) => /\S/.test(t[0])).length || 1;
    const sharedWords = [...keepA].filter((i) => /\S/.test(A[i][0])).length;
    if (sharedWords / Math.max(words(A), words(B)) < 0.3) return null;
    const ranges = (T, keep) => T.map((t, i) => (keep.has(i) || !/\S/.test(t[0]) ? null : [t[1], t[1] + t[0].length])).filter(Boolean);
    return [ranges(A, keepA), ranges(B, keepB)];
  }
  // Wraps character ranges of el's text in <mark>, across the spans syntax highlighting made.
  function markRanges(el, ranges) {
    if (!ranges || !ranges.length) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    let at = 0;
    for (const node of nodes) {
      const start = at;
      const end = at + node.data.length;
      at = end;
      const cuts = ranges.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => a < b);
      for (const [a, b] of cuts.reverse()) { // from the right, so earlier offsets stay valid
        const mid = node.splitText(a - start);
        mid.splitText(b - a);
        const mark = document.createElement('mark');
        mark.className = 'd-word';
        mid.replaceWith(mark);
        mark.append(mid);
      }
    }
  }
  function diffLines(a, b, py) {
    const A = (py ? normPy : norm)(a);
    const B = (py ? normPy : norm)(b);
    const n = A.length;
    const m = B.length;
    if (n * m > 4e6) return null;
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push(['same', a[i]]); i++; j++; }
      else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) { out.push(['del', a[i]]); i++; }
      else { out.push(['add', b[j]]); j++; }
    }
    return { lines: out, common: lcs[0][0] };
  }
  function codeCompare(q, o) {
    const refLabel = `Correct answer (${LANG[q.referenceLanguage] || q.referenceLanguage})`;
    if (q.answer == null || !q.reference) {
      return compare(o, q.answer == null ? none() : codeBox(q.answer, q.language), q.answer == null ? false : null,
        q.reference ? codeBox(q.reference, q.referenceLanguage) : null, refLabel, true);
    }
    const strip = (s) => s.split('\n').filter((l) => l.trim());
    const mine = strip(q.answer);
    const ref = strip(q.reference);
    const sameLang = q.language === q.referenceLanguage;
    const d = sameLang ? diffLines(mine, ref, q.language === 'python') : null;
    if (d && d.common === mine.length && d.common === ref.length) {
      return h('div', { class: 'r-side' }, h('p', { class: 'r-label', text: o.teacher ? 'Their answer' : 'Your answer' }),
        codeBox(q.answer, q.language), h('p', { class: 'r-also', text: 'Same as the correct answer.' }));
    }
    const both = compare(o, codeBox(q.answer, q.language), null, codeBox(q.reference, q.referenceLanguage), refLabel, true);
    if (!d) return both; // different languages, or too long to compare
    // Edited lines: a run of removed lines right before a run of added ones pairs up, line by line.
    const marks = new Map();
    for (let k = 0; k < d.lines.length;) {
      if (d.lines[k][0] !== 'del') { k++; continue; }
      let e = k;
      while (e < d.lines.length && d.lines[e][0] === 'del') e++;
      let f = e;
      while (f < d.lines.length && d.lines[f][0] === 'add') f++;
      for (let x = 0; x < Math.min(e - k, f - e); x++) {
        const r = wordRanges(d.lines[k + x][1], d.lines[e + x][1]);
        if (r) { marks.set(k + x, r[0]); marks.set(e + x, r[1]); }
      }
      k = f;
    }
    const wrap = h('div', {}, both);
    let diffView = null;
    const btn = h('button', { class: 'r-diff-btn', type: 'button', text: 'Show differences' });
    btn.addEventListener('click', () => {
      if (!diffView) {
        diffView = h('div', { class: 'r-side' },
          h('p', { class: 'r-label', text: 'Differences' }),
          h('pre', { class: 'r-code r-diff' }, d.lines.map(([kind, line], k) => h('span', { class: `d-line d-${kind}`, 'data-k': k },
            h('span', { class: 'd-sign', 'aria-hidden': 'true', text: kind === 'add' ? '+' : kind === 'del' ? '−' : ' ' }),
            h('code', { 'data-lang': q.language, text: line || ' ' })))),
          h('p', { class: 'r-also', text: `Red: only in ${o.teacher ? 'their' : 'your'} answer. Green: only in the correct answer.` }));
        // colors first, then the changed words on top of them
        highlight(diffView).then(() => {
          diffView.querySelectorAll('.d-line').forEach((el) => markRanges(el.querySelector('code'), marks.get(Number(el.dataset.k))));
        });
      }
      const showing = wrap.firstChild === diffView;
      wrap.replaceChildren(showing ? both : diffView);
      btn.textContent = showing ? 'Show differences' : 'Show both';
    });
    return [wrap, h('div', { class: 'r-diff-row' }, btn)];
  }

  function replayButton(attemptId, q, n) {
    const b = h('button', { class: 'r-diff-btn r-replay', type: 'button', text: 'Replay typing', 'aria-label': `Replay typing, question ${n}` });
    b.addEventListener('click', () => window.BQReplay.open(attemptId, q.id, n, q.answer));
    return b;
  }

  // opts.teacher: the dashboard's student panel (no rubric list: it shows editable checkboxes instead).
  // opts.assetUrl(path): where images load from (teacher API, or /asset/ for a student).
  // opts.anchor: id for jumping to this question.
  function question(quiz, q, i, opts) {
    const o = opts || {};
    const kind = q.type === 'code' ? KIND[q.mode] || KIND.method : KIND[q.type];
    const [st, words] = status(q);
    const pts = q.points == null || st === 'pending' ? `– / ${fmtPts(q.max)}` : `${fmtPts(q.points)} / ${fmtPts(q.max)}`; // an essay waiting for the teacher isn't 0 yet
    const img = (p) => (o.assetUrl ? o.assetUrl(p) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(p)}`);
    // Shared material shows once, on the first question that uses it (opts.sharedSeen tracks that).
    const sharedEl = [].concat(q.shared || []).map((sid) => {
      const m = quiz.shared ? quiz.shared[sid] : null;
      if (!m) return null;
      const first = !o.sharedSeen || !o.sharedSeen.has(sid);
      if (first && o.sharedSeen) o.sharedSeen.add(sid);
      return first
        ? h('div', { class: 'r-shared' }, m.title ? h('p', { class: 'r-shared-title', text: m.title }) : null,
          m.text ? md(m.text, quiz.language, img) : null, m.image ? h('img', { class: 'r-img', src: img(m.image), alt: m.imageAlt || '' }) : null)
        : h('p', { class: 'r-also', text: m.title ? `Uses ${m.title}` : 'Uses the shared material above' });
    });
    return h('section', { class: `r-q st-${st}` + (q.type === 'code' || q.type === 'fill' ? ' code' : ''), id: o.anchor || null },
      h('div', { class: 'r-qhead' },
        h('span', { class: 'n', text: String(i + 1) }), h('span', { class: 'kind', text: kind }),
        h('span', { class: 'r-status', role: 'img', 'aria-label': words, title: words }, mark(ICON[st])),
        q.review || st === 'pending' ? h('span', { class: 'r-waiting', text: words }) : null,
        // the teacher's: time on the question (fast.js), and how a code answer was typed (replay.js)
        q.time ? h('span', { class: 'r-qtime', title: 'Time on this question', text: clock(q.time) }) : null,
        q.type === 'code' && o.attemptId && window.BQReplay ? replayButton(o.attemptId, q, q.qn || i + 1) : null,
        h('span', { class: 'pts', text: pts })),
      sharedEl,
      q.was ? h('p', { class: 'r-was', text: q.was.fresh ? 'A new question like the one missed' : `On the quiz: ${fmtPts(q.was.points)} / ${fmtPts(q.was.max)}` }) : null, // corrections
      md(q.prompt, quiz.language, img),
      q.image ? h('img', { class: 'r-img', src: o.assetUrl ? o.assetUrl(q.image) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(q.image)}`, alt: q.imageAlt || '' }) : null,
      body(quiz, q, o),
      q.why ? h('div', { class: 'r-side' }, h('p', { class: 'r-label', text: 'What went wrong' }), h('p', { class: 'r-essay', text: q.why })) : null,
      q.explanation ? h('div', { class: 'r-explain' }, h('p', { class: 'r-label', text: 'Explanation' }), md(q.explanation, quiz.language, img)) : null,
      // the teacher's feedback on this answer (left out where it's being written: grading by question)
      q.feedback && !o.noFeedback ? h('div', { class: 'r-explain r-feedback' }, h('p', { class: 'r-label', text: 'Feedback' }), h('p', { class: 'r-essay', text: q.feedback })) : null);
  }

  function student(quiz, s, opts) {
    const o = opts || {};
    const key = o.key || 's0';
    const done = s.score != null;
    const sharedSeen = new Set();
    const scoreBox = h('div', { class: 'r-score' },
      h('div', { class: 'r-score-big' }, done ? fmtPts(s.score) : '–', h('span', { text: ` / ${fmtPts(s.max)}` })),
      h('div', { class: 'r-score-pct', text: done ? `${pct(s.score, s.max)}%${s.unfinished ? ' so far' : ''}` : 'Not graded' }));
    return h('article', { class: 'r-student', id: key },
      h('header', { class: 'r-head' },
        h('div', { class: 'r-head-main' },
          h('p', { class: 'r-eyebrow', text: quiz.title }),
          h('h1', { text: s.name }),
          s.submittedAt ? h('p', { class: 'r-sub', text: new Date(s.submittedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }) : null),
        scoreBox),
      h('nav', { class: 'r-chips', 'aria-label': 'Questions' }, s.questions.map((q, i) => {
        const [st, words] = status(q);
        return h('a', { class: `r-chip st-${st}`, href: `#${key}-q${i + 1}`, title: `Question ${i + 1}: ${words}`, 'aria-label': `Question ${i + 1}: ${words}`, text: String(i + 1) });
      })),
      s.questions.map((q, i) => question(quiz, q, i, Object.assign({}, o, { anchor: `${key}-q${i + 1}`, sharedSeen, attemptId: s.attemptId }))));
  }

  // First page of a class report: how everyone did, and how each question went.
  function classOverview(quiz, students) {
    const graded = students.filter((s) => s.score != null);
    const scores = graded.map((s) => s.score);
    const max = students.length ? students[0].max : 0;
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const stat = (label, value) => h('div', { class: 'r-stat' }, h('div', { class: 'r-stat-v', text: value }), h('div', { class: 'r-stat-l', text: label }));
    const bar = (p) => h('span', { class: 'r-bar-track' }, h('span', { class: 'r-bar-fill' + (p < 50 ? ' low' : ''), style: `width:${Math.max(0, Math.min(100, p))}%` }));
    // By question, over everyone who got it: with question pools, students have different questions.
    const byId = new Map();
    for (const s of students) {
      s.questions.forEach((q, i) => {
        let e = byId.get(q.id || i);
        if (!e) {
          e = { n: q.qn || i + 1, kind: q.type === 'code' ? KIND[q.mode] || KIND.method : KIND[q.type], prompt: q.prompt, max: q.max, pool: q.pool || null, given: 0, pts: [] };
          byId.set(q.id || i, e);
        }
        e.given++;
        if (q.points != null && !(q.review && q.type === 'essay')) e.pts.push(q.points);
      });
    }
    const questions = [...byId.values()].sort((a, b) => a.n - b.n)
      .map((e) => Object.assign(e, { avg: e.pts.length ? e.pts.reduce((a, x) => a + x, 0) / e.pts.length : null }));
    const snippet = (p) => {
      const t = String(p).replace(/```[\s\S]*?```/g, ' ').replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '').replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim();
      return t.length > 90 ? t.slice(0, t.lastIndexOf(' ', 88) > 40 ? t.lastIndexOf(' ', 88) : 88) + '…' : t;
    };
    return h('section', { class: 'r-class' },
      h('p', { class: 'r-eyebrow', text: 'Class report' }),
      h('h1', { text: quiz.title }),
      h('div', { class: 'r-stats' },
        stat('Students', String(students.length)),
        stat('Average', scores.length ? `${fmtPts(avg)} / ${fmtPts(max)} (${pct(avg, max)}%)` : '–'),
        stat('Highest', scores.length ? fmtPts(Math.max(...scores)) : '–'),
        stat('Lowest', scores.length ? fmtPts(Math.min(...scores)) : '–')),
      h('h2', { text: 'Students' }),
      h('table', { class: 'r-table' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { class: 'num', text: 'Score' }), h('th', { text: '' }))),
        h('tbody', {}, students.map((s, si) => {
          const p = s.score == null ? 0 : pct(s.score, s.max);
          return h('tr', {},
            h('td', {}, h('a', { href: `#s${si}`, text: s.name })),
            h('td', { class: 'num', text: s.score == null ? '–' : `${fmtPts(s.score)} / ${fmtPts(s.max)}` }),
            h('td', { class: 'r-bar-cell' }, bar(p), h('span', { class: 'r-bar-pct', text: s.score == null ? '' : `${p}%` })));
        }))),
      h('h2', { text: 'Questions' }),
      h('table', { class: 'r-table' },
        h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Question' }), h('th', { class: 'num', text: 'Average' }), h('th', { text: '' }))),
        h('tbody', {}, questions.map((q) => {
          const p = q.avg == null ? 0 : pct(q.avg, q.max);
          return h('tr', {},
            h('td', { class: 'num', text: String(q.n) }),
            h('td', {}, h('span', { class: 'r-qkind', text: q.kind }), ' ', snippet(q.prompt),
              q.pool ? h('span', { class: 'r-qpool', text: ` ${q.given} of ${students.length} students` }) : null),
            h('td', { class: 'num', text: q.avg == null ? 'Not graded' : `${fmtPts(q.avg)} / ${fmtPts(q.max)}` }),
            h('td', { class: 'r-bar-cell' }, bar(p), h('span', { class: 'r-bar-pct', text: q.avg == null ? '' : `${p}%` })));
        }))));
  }

  // ---------- syntax colors ----------
  let monacoP = null;
  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (!monacoP) {
      monacoP = new Promise((resolve, reject) => {
        window.MonacoEnvironment = window.MonacoEnvironment || { getWorkerUrl: () => '/vendor/monaco/editor.worker.js?v=2' };
        const s = document.createElement('script');
        s.src = '/vendor/monaco/monaco.js?v=2'; // the same address as the quiz page's (app/state.js MONACO_V), so it's fetched once
        s.onload = () => (window.monaco ? resolve(window.monaco) : reject(new Error('monaco missing')));
        s.onerror = () => reject(new Error('monaco failed to load'));
        document.head.append(s);
      });
      monacoP.catch(() => { monacoP = null; });
    }
    return monacoP;
  }
  const CONTROL = /^keyword\.(if|else|for|while|do|switch|case|default|break|continue|return|try|catch|finally|throw)\b/;
  function tokenClass(type) {
    if (type.startsWith('keyword')) return CONTROL.test(type) ? 'tk-control' : 'tk-keyword';
    if (type.startsWith('string')) return 'tk-string';
    if (type.startsWith('number')) return 'tk-number';
    if (type.startsWith('comment')) return 'tk-comment';
    if (type.startsWith('type')) return 'tk-type';
    if (type.startsWith('function') || type.startsWith('annotation')) return 'tk-fn';
    if (type.startsWith('identifier')) return 'tk-ident';
    return '';
  }
  // Colors every code[data-lang] under root. Text goes in through textContent only.
  function highlight(root) {
    const els = [...root.querySelectorAll('code[data-lang]:not([data-hl])')];
    if (!els.length) return Promise.resolve();
    return loadMonaco().then((m) => {
      for (const el of els) {
        el.setAttribute('data-hl', '');
        const text = el.textContent;
        const lines = text.split('\n');
        let tokens;
        try { tokens = m.editor.tokenize(text, el.dataset.lang); } catch (e) { continue; }
        const frag = document.createDocumentFragment();
        lines.forEach((line, li) => {
          const lt = tokens[li] || [];
          if (!lt.length) frag.append(line);
          lt.forEach((t, k) => {
            const piece = line.slice(t.offset, k + 1 < lt.length ? lt[k + 1].offset : line.length);
            if (!piece) return;
            const cls = tokenClass(t.type);
            if (cls) { const sp = document.createElement('span'); sp.className = cls; sp.textContent = piece; frag.append(sp); } else frag.append(piece);
          });
          if (li < lines.length - 1) frag.append('\n');
        });
        el.replaceChildren(frag);
      }
    }).catch(() => {});
  }

  // ---------- code that looks copied (server: similar.js) ----------
  // Each flagged pair: how alike, whether names and comments match too, and both answers side by side
  // on demand, with the lines they share marked.
  const KW = new Set(('abstract boolean break byte case catch char class continue default do double else extends final finally float for if implements import instanceof int interface long new private protected public return short static super switch this throw throws try void while var true false null and as def elif except from in is lambda not or pass raise with yield None True False').split(' '));
  const lineShape = (line) => line.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, 'S').replace(/\/\/.*$|#.*$/, '')
    .replace(/[A-Za-z_$][\w$]*/g, (w) => (KW.has(w) ? w : 'I')).replace(/\d[\w.]*/g, 'N').replace(/\s+/g, '');
  // A line is marked when its shape is anywhere in the other answer, line breaks and all left out, so a
  // copy squeezed onto fewer lines still lines up.
  function sideBySide(codeA, codeB, lang) {
    const whole = (code) => code.split('\n').map(lineShape).join('');
    const box = (code, other) => h('pre', { class: 'r-code r-sim-code' }, code.split('\n').map((line) => {
      const shape = lineShape(line);
      return h('span', { class: `r-sim-line${shape.length > 3 && other.includes(shape) ? ' same' : ''}` }, h('code', { 'data-lang': lang, text: line || ' ' }));
    }));
    return [box(codeA, whole(codeB)), box(codeB, whole(codeA))];
  }
  // A pair of students and what they share, as one row of a list: names, what matches, and Show, which
  // opens the details under it. "Similar code" and "Same wrong answers" both use it, so they line up.
  function pairRow(students, a, b, note, details) {
    const name = (i) => h('a', { href: `#s${i}`, text: students[i].name });
    const box = h('div', { class: 'r-pair-detail', hidden: true });
    const btn = h('button', { class: 'r-diff-btn', type: 'button', text: 'Show', 'aria-expanded': 'false', 'aria-label': `Show what ${students[a].name} and ${students[b].name} share` });
    btn.addEventListener('click', () => {
      const open = box.hidden;
      if (open && !box.childElementCount) { box.append(...details()); highlight(box); }
      box.hidden = !open;
      btn.textContent = open ? 'Hide' : 'Show';
      btn.setAttribute('aria-expanded', String(open));
    });
    return h('li', { class: 'r-pair' },
      h('div', { class: 'r-sim-row r-pair-row' }, h('span', { class: 'r-pair-names' }, name(a), ' and ', name(b)), h('span', { class: 'r-sim-note', text: note }), btn),
      box);
  }
  const pairSection = (cls, title, rows) => h('section', { class: `r-similar ${cls}` }, h('h2', { text: title }),
    rows.length ? h('ul', { class: 'r-pairs' }, rows) : h('p', { class: 'r-sim-none', text: 'None found.' }));

  function similarCode(students, similar) {
    if (!similar || !similar.length) return null; // no code questions
    const rows = similar.flatMap((qs) => qs.pairs.map((p) => {
      const codeOf = (i) => { const q = students[i].questions.find((x) => x.id === qs.id); return (q && q.answer) || ''; };
      const note = [`Question ${qs.n}`, `${Math.round(p.score * 100)}% alike`, p.names >= 0.6 ? 'same names' : null,
        p.comments ? `${p.comments} same ${p.comments === 1 ? 'comment' : 'comments'}` : null].filter(Boolean).join(' · ');
      return pairRow(students, p.a, p.b, note, () => {
        const [left, right] = sideBySide(codeOf(p.a), codeOf(p.b), p.language);
        const col = (i, box) => h('div', { class: 'r-sim-col' }, h('p', { class: 'r-pair-who', text: students[i].name }), box);
        return [h('div', { class: 'r-sim-views' }, col(p.a, left), col(p.b, right))];
      });
    }));
    return pairSection('r-sim-code-section', 'Similar code', rows);
  }

  // ---------- the same wrong answers (server: samewrong.js) ----------
  function sameWrong(students, pairs, quiz) {
    if (!pairs) return null; // no choice, short answer or output questions
    const rows = pairs.map((p) => pairRow(students, p.a, p.b, `${p.same.length} the same: ${p.same.map((x) => x.n).join(', ')}`, () => [
      h('table', { class: 'r-table r-same-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'num', text: 'Question' }), h('th', { text: 'Their answer' }), h('th', { class: 'num', text: 'Gave it' }))),
        h('tbody', {}, p.same.map((x) => h('tr', {},
          h('td', { class: 'num', text: String(x.n) }),
          h('td', {}, x.choices ? x.choices.map((c, i) => [i ? ', ' : '', inline(c, quiz.language)]) : x.math ? mathEl(x.text, true) : h('code', { text: x.text })),
          h('td', { class: 'num', text: x.of > 2 ? `${x.of} students` : 'Only these two' }))))),
    ]));
    return pairSection('r-same-wrong', 'Same wrong answers', rows);
  }

  // ---------- right answers given much faster than the class (server: fast.js) ----------
  function fastRight(students, rows) {
    if (!rows) return null; // no times yet (quizzes from before they were kept)
    const items = rows.map((x) => h('li', { class: 'r-pair' },
      h('div', { class: 'r-sim-row r-pair-row' },
        h('span', { class: 'r-pair-names' }, h('a', { href: `#s${x.who}`, text: students[x.who].name })),
        h('span', { class: 'r-sim-note', text: `Question ${x.n}: right in ${clock(x.ms)}, the class took ${clock(x.median)}` }))));
    return pairSection('r-fast', 'Fast right answers', items);
  }

  window.BQReport = { question, student, classOverview, similarCode, sameWrong, fastRight, highlight, h, loadMonaco, tokenClass };
})();
