// The scratchpad: pen, text and eraser beside the question.

import { BQ, S, cfg } from './state.js';
import { h } from './dom.js';
import { icon, isDark } from './theme.js';
import { overview, quizDirections, summaryLine } from './entry.js';
import { lockIcon, rangeOf } from './answers.js';
import { closeDirections } from './quiz.js';
import { mdOpts } from './marks.js';

// ---------- scratchpad ----------
// The student's own working space: one board a question, where they draw and drop typed notes
// anywhere. It's kept in this browser (per run and student), isn't graded, and is cleared when the
// quiz is turned in. A teacher watching live sees the page on screen (the server keeps it in memory).
const scratchKey = () => 'bq-scratch:' + [S.run && (S.run.id || S.run.code || S.run.title), S.me && S.me.name, S.tag || ''].join(':');
function loadScratch() {
  S.scratch = { tool: 'pen', pages: {} };
  try {
    const v = JSON.parse(localStorage.getItem(scratchKey()) || 'null');
    if (v && v.pages && typeof v.pages === 'object') Object.assign(S.scratch, v);
  } catch (e) { /* nothing saved */ }
}
let scratchTimer = 0;
function writeScratch() {
  scratchTimer = 0;
  try { localStorage.setItem(scratchKey(), JSON.stringify(S.scratch)); } catch (e) { /* kept for this page */ }
}
function saveScratch() {
  S.scratchVer = (S.scratchVer || 0) + 1;
  if (cfg.watch) return; // the student's, shown to a teacher: not theirs to keep
  clearTimeout(scratchTimer);
  scratchTimer = setTimeout(writeScratch, 400);
}
// Reloaded or closed before that: kept now, as the page goes (as answers.js keeps unsent answers).
window.addEventListener('pagehide', () => { if (scratchTimer) { clearTimeout(scratchTimer); writeScratch(); } });
function clearScratch() {
  clearTimeout(scratchTimer);
  scratchTimer = 0;
  try { localStorage.removeItem(scratchKey()); } catch (e) { /* nothing to clear */ }
}
// The scratchpad's left edge drags (or arrow keys) to make it wider or narrower; this browser remembers it.
const SCRATCH_W = 'bq-scratch-w';
function scratchGrip(wrap, scratch) {
  const grip = h('div', { class: 'scratch-grip', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Scratchpad width', 'aria-controls': 'scratch' });
  const setW = (w, keep) => {
    const max = Math.max(280, wrap.clientWidth - 360); // the question keeps at least 360px
    const v = Math.round(Math.min(max, Math.max(260, w)));
    wrap.style.setProperty('--scratch-w', v + 'px');
    grip.setAttribute('aria-valuenow', String(v));
    if (S.editor) S.editor.layout();
    if (keep) { try { localStorage.setItem(SCRATCH_W, String(v)); } catch (e) { /* this page only */ } }
  };
  try { const w = Number(localStorage.getItem(SCRATCH_W)); if (w > 0) wrap.style.setProperty('--scratch-w', w + 'px'); } catch (e) { /* the default */ }
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    const move = (ev) => setW(wrap.getBoundingClientRect().right - ev.clientX, false);
    const up = (ev) => {
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setW(wrap.getBoundingClientRect().right - ev.clientX, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setW(scratch.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 32 : -32), true);
  });
  return grip;
}
function toggleScratch(force) {
  if (!S.el || !S.el.scratch) return;
  const open = force != null ? force : S.el.scratch.hidden;
  S.el.scratch.hidden = !open;
  S.el.wrap.classList.toggle('with-scratch', open);
  S.el.scratchBtn.setAttribute('aria-pressed', String(open));
  if (open) renderScratch();
  if (S.editor) S.editor.layout();
  if (open) { const first = S.el.scratch.querySelector('.scratch-tool'); if (first) first.focus(); } else S.el.scratchBtn.focus();
}
// The pad's buttons, by what they do: the icon each one shows
const PAD_ICONS = { pen: 'pencil', text: 'text', eraser: 'eraser', undo: 'undo', clear: 'trash', close: 'x' };
const padIcon = (name) => icon(PAD_ICONS[name], 18);
function renderScratch() {
  const el = S.el && S.el.scratch;
  if (!el || el.hidden || !S.quiz || !S.scratch) return;
  el.replaceChildren(...[S.el.scratchGrip].filter(Boolean), ...scratchBoard(S.quiz.questions[S.idx]));
}
// Items on a page, oldest first: strokes { p: [x, y, ...], e: true for the eraser } and notes
// { x, y, s }. Positions are scaled to the board's width, so a page redraws after a resize. Strokes
// and notes take the page's text color, so they follow the theme.
// Pen and note colors (by name, so they follow the theme: [light, dark]) and pen sizes.
const PAD_COLORS = { ink: null, blue: ['#2257d6', '#7ea3ff'], red: ['#c92a2a', '#ff8787'], green: ['#1b7f45', '#5ccb8a'], orange: ['#d9480f', '#ffa94d'], purple: ['#7048e8', '#b197fc'] };
const PAD_SIZES = { s: 1.5, m: 2.5, l: 5 };
const padColor = (c, el) => (PAD_COLORS[c] ? PAD_COLORS[c][isDark() ? 1 : 0] : getComputedStyle(el).color);
function scratchBoard(q) {
  let repainting = false; // paint() is swapping the note boxes for new ones
  const pages = S.scratch.pages;
  if (!Object.hasOwn(PAD_COLORS, S.scratch.color)) S.scratch.color = 'ink';
  if (!Object.hasOwn(PAD_SIZES, S.scratch.size)) S.scratch.size = 'm';
  if (!S.scratch.fmt || typeof S.scratch.fmt !== 'object') S.scratch.fmt = {};
  const items = pages[q.id] || [];
  let tool = ['pen', 'text', 'eraser'].includes(S.scratch.tool) ? S.scratch.tool : 'pen';
  let ctx = null;
  let w = 0;
  let cur = null;
  let cleared = null; // what Clear took away, until something new goes on the page
  const canvas = h('canvas', { class: 'scratch-canvas', 'aria-hidden': 'true' });
  const notes = h('div', { class: 'scratch-notes' });
  const board = h('div', { class: 'scratch-board' }, canvas, notes);
  const save = () => { if (items.length) pages[q.id] = items; else delete pages[q.id]; saveScratch(); };
  const btn = (name, label, on) => {
    const b = h('button', { class: 'scratch-tool', type: 'button', title: label, 'aria-label': label, onclick: on });
    b.append(padIcon(name));
    return b;
  };
  // Text from the keyboard (Enter or Space on the tool) starts a note below the others, since there's
  // no pointer to place it.
  const tools = {
    pen: btn('pen', 'Pen', () => pick('pen')),
    text: btn('text', 'Text', (e) => { pick('text'); if (e && e.detail === 0) keyboardNote(); }),
    eraser: btn('eraser', 'Eraser', () => pick('eraser')),
  };
  function keyboardNote() {
    if (!ctx && !size()) return;
    let y = 0.03;
    for (const ta of notes.querySelectorAll('.scratch-note')) y = Math.max(y, (ta.offsetTop + ta.offsetHeight + 8) / w);
    const n = withStyle({ x: 0.03, y: +y.toFixed(4), s: '' });
    add(n);
    const ta = noteEl(n);
    notes.append(ta);
    ta.focus();
  }
  function pick(t) {
    tool = t;
    S.scratch.tool = t;
    for (const [k, b] of Object.entries(tools)) b.setAttribute('aria-pressed', String(k === t));
    board.dataset.tool = t;
    styleBtn.hidden = t === 'eraser';
    if (t === 'eraser') setPop(false);
    sizes.hidden = t !== 'pen';
    fmts.hidden = t !== 'text';
    saveScratch();
  }
  // Color for the pen and notes; size for the pen; bold, italic, underline for notes. With a note being
  // typed in, they change that note (the row keeps the focus in it); otherwise the next one.
  const typingNote = () => { const a = document.activeElement; return a && notes.contains(a) && a._note ? a : null; };
  const colorBtns = Object.keys(PAD_COLORS).map((c) => {
    const b = h('button', { class: 'pad-swatch', type: 'button', title: c === 'ink' ? 'Black' : c[0].toUpperCase() + c.slice(1), 'aria-label': c === 'ink' ? 'Black' : c[0].toUpperCase() + c.slice(1) });
    b.addEventListener('click', () => {
      S.scratch.color = c;
      const ta = typingNote();
      if (ta) { if (c === 'ink') delete ta._note.c; else ta._note.c = c; noteLook(ta, ta._note); save(); }
      paintStyle(); saveScratch();
    });
    b._c = c;
    return b;
  });
  const sizeBtns = Object.keys(PAD_SIZES).map((z) => {
    const b = h('button', { class: 'scratch-tool pad-size', type: 'button', title: { s: 'Thin', m: 'Medium', l: 'Thick' }[z], 'aria-label': { s: 'Thin', m: 'Medium', l: 'Thick' }[z] }, h('span', { class: 'pad-dot', style: `width:${PAD_SIZES[z] + 3}px;height:${PAD_SIZES[z] + 3}px` }));
    b.addEventListener('click', () => { S.scratch.size = z; paintStyle(); saveScratch(); });
    b._z = z;
    return b;
  });
  const fmtBtns = [['b', 'Bold', 'B'], ['i', 'Italic', 'I'], ['u', 'Underline', 'U']].map(([k, label, letter]) => {
    const b = h('button', { class: `scratch-tool pad-fmt pad-fmt-${k}`, type: 'button', title: label, 'aria-label': label, text: letter });
    b.addEventListener('click', () => {
      const ta = typingNote();
      if (ta) { if (ta._note[k]) delete ta._note[k]; else ta._note[k] = true; noteLook(ta, ta._note); fit(ta, ta._note); save(); }
      else S.scratch.fmt[k] = !S.scratch.fmt[k];
      paintStyle(); saveScratch();
    });
    b._k = k;
    return b;
  });
  function paintStyle() {
    const ta = typingNote();
    const color = ta ? ta._note.c || 'ink' : S.scratch.color;
    for (const b of colorBtns) {
      b.setAttribute('aria-pressed', String(b._c === color));
      b.style.setProperty('--sw', b._c === 'ink' ? 'var(--ink)' : padColor(b._c, board)); // follows the theme
    }
    for (const b of sizeBtns) b.setAttribute('aria-pressed', String(b._z === S.scratch.size));
    for (const b of fmtBtns) b.setAttribute('aria-pressed', String(!!(ta ? ta._note[b._k] : S.scratch.fmt[b._k])));
    // the button shows the color (and, for the pen, the size)
    styleDot.style.background = color === 'ink' ? 'var(--ink)' : padColor(color, board);
    const d = tool === 'pen' ? PAD_SIZES[S.scratch.size] * 2 + 6 : 14;
    styleDot.style.width = styleDot.style.height = `${d}px`;
  }
  const sizes = h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Size' }, sizeBtns);
  const fmts = h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Text style' }, fmtBtns);
  // All of it sits under one button that shows the current color, so the toolbar stays small.
  const stylePop = h('div', { class: 'scratch-style', role: 'group', 'aria-label': 'Color and style', hidden: true },
    h('div', { class: 'pad-colors', role: 'group', 'aria-label': 'Color' }, colorBtns), sizes, fmts);
  const styleDot = h('span', { class: 'pad-cur' });
  const styleBtn = h('button', { class: 'scratch-tool pad-style-btn', type: 'button', title: 'Color and style', 'aria-label': 'Color and style', 'aria-expanded': 'false' }, styleDot);
  const setPop = (open) => {
    stylePop.hidden = !open;
    styleBtn.setAttribute('aria-expanded', String(open));
    if (open) stylePop.style.top = `${styleBtn.offsetTop + styleBtn.offsetHeight + 8}px`;
  };
  styleBtn.addEventListener('click', () => setPop(stylePop.hidden));
  for (const el of [stylePop, styleBtn]) el.addEventListener('mousedown', (e) => e.preventDefault()); // keep typing in the note
  stylePop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPop(false); styleBtn.focus(); } });
  const onOut = (e) => {
    if (!stylePop.isConnected) { document.removeEventListener('pointerdown', onOut, true); return; }
    if (!stylePop.hidden && !stylePop.contains(e.target) && !styleBtn.contains(e.target)) setPop(false);
  };
  document.addEventListener('pointerdown', onOut, true);
  notes.addEventListener('focusin', paintStyle);
  notes.addEventListener('focusout', () => setTimeout(paintStyle, 0));
  pick(tool);
  const undo = btn('undo', 'Undo', () => {
    if (!items.length && cleared) { items.push(...cleared); cleared = null; }
    else {
      const it = items.pop();
      if (it && it.rm) for (const [i, n] of it.rm.slice().reverse()) items.splice(i, 0, n);
    }
    paint();
    save();
  });
  const clear = btn('clear', 'Clear page', () => {
    if (!items.length) return;
    cleared = items.splice(0);
    paint();
    save();
  });
  const add = (it) => { items.push(it); cleared = null; };
  // a new note in the chosen color and text style
  const withStyle = (n) => {
    if (S.scratch.color !== 'ink') n.c = S.scratch.color;
    for (const k of ['b', 'i', 'u']) if (S.scratch.fmt[k]) n[k] = true;
    return n;
  };

  function size() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = r.width;
    return true;
  }
  function style(st) {
    ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
    ctx.lineWidth = st.e ? 22 : PAD_SIZES[st.sz] || PAD_SIZES.m;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = padColor(st.c, canvas);
  }
  function path(p, from) {
    ctx.beginPath();
    ctx.moveTo(p[from] * w, p[from + 1] * w);
    if (p.length - from === 2) ctx.lineTo(p[from] * w + 0.01, p[from + 1] * w); // a dot
    for (let i = from + 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * w);
    ctx.stroke();
  }
  function paint() {
    if (!ctx && !size()) return;
    ctx.clearRect(0, 0, w, canvas.height);
    for (const it of items) if (it.p) { style(it); path(it.p, 0); }
    // Redrawing makes new note boxes: keep the one being typed in focused, cursor and all.
    const a = document.activeElement;
    const typing = a && notes.contains(a) && a._note ? { n: a._note, from: a.selectionStart, to: a.selectionEnd } : null;
    repainting = true; // the old boxes blur as they go: that isn't the student leaving an empty note
    try { notes.replaceChildren(...items.filter((it) => it.s != null).map(noteEl)); } finally { repainting = false; }
    const again = typing && [...notes.children].find((t) => t._note === typing.n);
    if (again) { again.focus({ preventScroll: true }); again.setSelectionRange(typing.from, typing.to); }
  }
  // A note is a borderless text box that grows with what's typed, up to the board's right edge.
  let measure = null;
  function fit(ta, n) {
    measure = measure || document.createElement('canvas').getContext('2d');
    measure.font = getComputedStyle(ta).font;
    const widest = Math.max(0, ...ta.value.split('\n').map((l) => measure.measureText(l).width));
    ta.style.width = Math.max(28, Math.min(widest + 14, w - n.x * w - 4)) + 'px';
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
  function noteLook(ta, n) {
    ta.style.color = n.c ? padColor(n.c, board) : '';
    ta.style.fontWeight = n.b ? '700' : '';
    ta.style.fontStyle = n.i ? 'italic' : '';
    ta.style.textDecoration = n.u ? 'underline' : '';
  }
  function noteEl(n) {
    const ta = h('textarea', { class: 'scratch-note', rows: '1', spellcheck: 'false', 'aria-label': 'Note' });
    ta.value = n.s;
    noteLook(ta, n);
    ta.style.left = n.x * w + 'px';
    ta.style.top = n.y * w + 'px';
    ta.addEventListener('input', () => { n.s = ta.value; fit(ta, n); save(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPop(false); ta.blur(); } });
    ta.addEventListener('blur', () => {
      if (repainting || n.s.trim() || !ta.isConnected) return;
      const i = items.indexOf(n);
      if (i >= 0) items.splice(i, 1);
      ta.remove();
      save();
    });
    requestAnimationFrame(() => fit(ta, n));
    ta._note = n;
    return ta;
  }
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [+((e.clientX - r.left) / w).toFixed(4), +((e.clientY - r.top) / w).toFixed(4)]; };
  // The eraser takes out any note it passes over; Undo puts it back.
  function eraseNotes(x, y) {
    for (const ta of notes.querySelectorAll('.scratch-note')) {
      const l = ta.offsetLeft - 11; const t = ta.offsetTop - 11;
      if (x * w < l || y * w < t || x * w > l + ta.offsetWidth + 22 || y * w > t + ta.offsetHeight + 22) continue;
      const i = items.indexOf(ta._note);
      if (i < 0) continue;
      (cur.rm = cur.rm || []).push([i, ta._note]);
      items.splice(i, 1);
      ta.remove();
    }
  }
  board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.scratch-note') || (!ctx && !size())) return;
    e.preventDefault();
    if (tool === 'text') {
      const [x, y] = at(e);
      const n = withStyle({ x: Math.min(x, +((w - 80) / w).toFixed(4)), y: Math.max(0, +(y - 11 / w).toFixed(4)), s: '' });
      add(n);
      const ta = noteEl(n);
      notes.append(ta);
      ta.focus();
      return;
    }
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.scratch-note')) document.activeElement.blur();
    canvas.setPointerCapture(e.pointerId);
    cur = { p: at(e) };
    if (tool === 'eraser' || e.button === 5) cur.e = true; // button 5: a pen's eraser end
    else {
      if (S.scratch.color !== 'ink') cur.c = S.scratch.color;
      if (S.scratch.size !== 'm') cur.sz = S.scratch.size;
    }
    add(cur);
    style(cur);
    path(cur.p, 0);
    if (cur.e) eraseNotes(cur.p[0], cur.p[1]);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const from = cur.p.length - 2;
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const [x, y] = at(ev);
      const lx = cur.p[cur.p.length - 2];
      const ly = cur.p[cur.p.length - 1];
      if (Math.hypot(x - lx, y - ly) * w >= 1.5) { cur.p.push(x, y); if (cur.e) eraseNotes(x, y); } // skip points closer than 1.5px
    }
    if (cur.p.length - 2 > from) { style(cur); path(cur.p, from); }
  });
  const end = () => { if (cur) { cur = null; save(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(() => { size(); paint(); });
  // redraw at the board's size: the window changed, or the student dragged the scratchpad wider
  const ro = new ResizeObserver(() => { if (!canvas.isConnected) { ro.disconnect(); return; } size(); paint(); });
  ro.observe(board);

  const close = btn('close', 'Close scratchpad', () => toggleScratch(false));
  close.classList.add('scratch-close');
  const head = h('div', { class: 'scratch-head' },
    h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Tool' }, tools.pen, tools.text, tools.eraser, styleBtn),
    h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Edit' }, undo, clear),
    h('span', { class: 'scratch-q', text: `Question ${S.idx + 1}` }),
    close);
  paintStyle();
  return [head, stylePop, board];
}

function directionsView(part) {
  const seen = S.partsSeen.has(part.n);
  const range = rangeOf(part);
  // Right after Start: the quiz's own directions and what's on it, above the first part's.
  const intro = S.introOpen && part.n === 1;
  const qs = S.quiz.questions;
  const run = { questionCount: qs.length, timeLimitMin: S.quiz.timeLimitMin, sections: S.quiz.sections,
    outline: qs.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })) }; // the student's own order, so numbers are right
  return h('div', { class: 'qview' + (intro ? ' intro' : '') },
    intro ? [
      h('div', { class: 'meta-row' }, h('span', { text: 'Before you begin' }), h('span', { text: summaryLine(run) })),
      h('h1', { id: 'q-heading', text: S.quiz.title }),
      quizDirections(S.quiz.directions && S.quiz.directions.quiz, 'Directions'),
      h('section', { class: 'intro-ov', 'aria-labelledby': 'ov-head' }, h('h2', { id: 'ov-head', text: "What's on the quiz" }), overview(run)),
      h('hr', { class: 'intro-rule' }),
    ] : null,
    // a timed part that started because the last one's time was up
    S.timeUpFor && S.timeUpFor === part.n - 1 ? [h('p', { class: 'time-up' }, lockIcon(16), `Time's up for Part ${part.n - 1}.`), h('hr', { class: 'intro-rule' })] : null,
    h('div', { class: 'meta-row' }, h('span', { text: `Part ${part.n} of ${S.parts.length}` }), h('span', { text: range })),
    h(intro ? 'h2' : 'h1', { id: intro ? 'part-heading' : 'q-heading', class: 'part-title', text: part.title }),
    part.md ? h('div', { class: 'directions prompt' }, BQ.md.render(part.md, mdOpts()))
      : part.list ? h('div', { class: 'directions' }, h('strong', { text: 'Directions' }), h('ul', {}, part.list.map(([t, text]) => h('li', {}, h('b', { text: `${t}: ` }), text))))
        : h('p', { class: 'directions' }, h('strong', { text: 'Directions: ' }), part.text),
    // shown once, before the first part; after that only when they open Directions again
    intro || !seen ? null : quizDirections(S.quiz.directions && S.quiz.directions.quiz, 'For the whole quiz'),
    h('div', {}, h('button', { class: 'btn primary', type: 'button', text: seen ? 'Back to the question' : 'Start this part', onclick: closeDirections })));
}

export { clearScratch, directionsView, loadScratch, renderScratch, scratchGrip, toggleScratch };
