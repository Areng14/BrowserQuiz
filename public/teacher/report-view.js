// Draws a student's quiz: each question with their answer next to the correct one. Used by the printable
// report (one student, or a whole class with an overview first), the practice review, and the teacher's
// student panel. Needs BQ.md (md.js). Code gets syntax colors from Monaco's tokenizer, drawn with our own
// CSS classes so they follow light/dark and print correctly.
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
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  // assetUrl: where the quiz's images are, for images written in Markdown.
  const md = (src, lang, assetUrl) => h('div', { class: 'r-prompt' }, window.BQ.md.render(src, { lang, assetUrl }));
  const inline = (src, lang, assetUrl) => (/\n/.test(src) // a choice with more than one line is set as blocks
    ? h('div', { class: 'r-choice-rich' }, window.BQ.md.render(src, { lang, assetUrl }))
    : h('span', {}, window.BQ.md.renderInline(src, { lang, assetUrl })));
  const imagesOf = (quiz, o) => (p) => (o && o.assetUrl ? o.assetUrl(p) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(p)}`);
  const codeBox = (text, lang) => h('pre', { class: 'r-code' }, h('code', { 'data-lang': lang || null, text }));

  function answered(q) {
    if (q.type === 'single' || q.type === 'multi') return q.picked.length > 0;
    if (q.type === 'trace') return q.cells.some((r) => r.some((c) => !c.given && c.value));
    if (q.type === 'fill') return q.blanks.some((b) => b.value);
    return q.answer != null;
  }
  const ICON = { full: '✓', partial: '✓', zero: '✗', pending: '–' };
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
        h('span', { class: 'r-mark', text: !graded(r) ? '–' : r.met ? '✓' : '✗' }), `${r.text} (${unit(r.points)})`)))];
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
          h('span', { class: 'r-mark', text: correct ? '✓' : picked ? '✗' : '' }),
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
          h('span', { class: 'r-mark', text: b.ok ? '✓' : '✗' }),
          h('span', { class: 'r-blank-n', text: `Blank ${i + 1}` }),
          b.value ? h('code', { text: b.value }) : h('span', { class: 'r-none', text: 'no answer' }),
          b.ok ? null : h('span', { class: 'r-also' }, ' Correct: ', b.accepted.map((x, k) => [k ? ' or ' : '', h('code', { text: x })]))))),
        q.compileError ? [h('p', { class: 'r-label', text: "Didn't compile" }), h('pre', { class: 'r-err', text: q.compileError })] : null,
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
      q.rubric.length && !o.teacher ? rubricList(q) : null,
    ];
  }

  // ---------- code answer vs the reference ----------
  // Same code (ignoring indentation and blank lines): shown once. Otherwise "Show differences" swaps the
  // two blocks for one diff, with the changed words marked inside lines that were edited.
  const norm = (line) => line.trim();
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
  function diffLines(a, b) {
    const A = a.map(norm);
    const B = b.map(norm);
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
    const d = sameLang ? diffLines(mine, ref) : null;
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

  // opts.teacher: the dashboard's student panel (no rubric list: it shows editable checkboxes instead).
  // opts.assetUrl(path): where images load from (teacher API, or /asset/ for a student).
  // opts.anchor: id for jumping to this question.
  function question(quiz, q, i, opts) {
    const o = opts || {};
    const kind = q.type === 'code' ? KIND[q.mode] || KIND.method : KIND[q.type];
    const [st, words] = status(q);
    const pts = q.points == null ? `– / ${fmtPts(q.max)}` : `${fmtPts(q.points)} / ${fmtPts(q.max)}`;
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
        h('span', { class: 'r-status', role: 'img', 'aria-label': words, title: words, text: ICON[st] }),
        q.review || st === 'pending' ? h('span', { class: 'r-waiting', text: words }) : null,
        h('span', { class: 'pts', text: pts })),
      sharedEl,
      md(q.prompt, quiz.language, img),
      q.image ? h('img', { class: 'r-img', src: o.assetUrl ? o.assetUrl(q.image) : `/api/t/quizzes/${encodeURIComponent(quiz.id)}/asset?path=${encodeURIComponent(q.image)}`, alt: q.imageAlt || '' }) : null,
      body(quiz, q, o));
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
      s.questions.map((q, i) => question(quiz, q, i, Object.assign({}, o, { anchor: `${key}-q${i + 1}`, sharedSeen }))));
  }

  // First page of a class report: how everyone did, and how each question went.
  function classOverview(quiz, students) {
    const graded = students.filter((s) => s.score != null);
    const scores = graded.map((s) => s.score);
    const max = students.length ? students[0].max : 0;
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const stat = (label, value) => h('div', { class: 'r-stat' }, h('div', { class: 'r-stat-v', text: value }), h('div', { class: 'r-stat-l', text: label }));
    const bar = (p) => h('span', { class: 'r-bar-track' }, h('span', { class: 'r-bar-fill' + (p < 50 ? ' low' : ''), style: `width:${Math.max(0, Math.min(100, p))}%` }));
    const questions = (students[0] ? students[0].questions : []).map((q0, i) => {
      const pts = students.map((s) => s.questions[i]).filter((q) => q.points != null && !(q.review && q.type === 'essay'));
      const avgQ = pts.length ? pts.reduce((a, q) => a + q.points, 0) / pts.length : null;
      return { n: i + 1, kind: q0.type === 'code' ? KIND[q0.mode] || KIND.method : KIND[q0.type], prompt: q0.prompt, max: q0.max, avg: avgQ };
    });
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
            h('td', {}, h('span', { class: 'r-qkind', text: q.kind }), ' ', snippet(q.prompt)),
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
        window.MonacoEnvironment = window.MonacoEnvironment || { getWorkerUrl: () => '/vendor/monaco/editor.worker.js' };
        const s = document.createElement('script');
        s.src = '/vendor/monaco/monaco.js';
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

  window.BQReport = { question, student, classOverview, highlight, h };
})();
