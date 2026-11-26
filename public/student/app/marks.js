// Mark for review, crossed-out choices and highlighting in the question.

import { BQ, S, api } from './state.js';
import { h, plural } from './dom.js';
import { openDirections } from './quiz.js';
import { renderSheet } from './nav.js';

// ---------- mark for review, crossed-out choices ----------
// Study aids only: they never change an answer, so they stay in this browser (per run and student)
// and are cleared once the quiz is turned in.
const marksKey = () => 'bq-marks:' + [S.run && (S.run.id || S.run.code || S.run.title), S.me && S.me.name, S.tag || ''].join(':');
function loadMarks() {
  S.marks = { review: [], out: {} };
  try {
    const m = JSON.parse(localStorage.getItem(marksKey()) || 'null');
    if (m && Array.isArray(m.review) && m.out && typeof m.out === 'object') S.marks = m;
  } catch (e) { /* nothing saved */ }
}
function saveMarks() {
  try { localStorage.setItem(marksKey(), JSON.stringify(S.marks)); } catch (e) { /* kept for this page only */ }
}
function clearMarks() {
  try { localStorage.removeItem(marksKey()); } catch (e) { /* nothing to clear */ }
}
const isMarked = (q) => !!S.marks && S.marks.review.includes(q.id);
const isCrossed = (q, i) => !!S.marks && (S.marks.out[q.id] || []).includes(i);
function setCrossed(q, i, on) {
  if (!S.marks) S.marks = { review: [], out: {} };
  const list = (S.marks.out[q.id] || []).filter((x) => x !== i);
  if (on) list.push(i);
  if (list.length) S.marks.out[q.id] = list; else delete S.marks.out[q.id];
  saveMarks();
}
function bookmarkIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'mark-icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M4 1.75h8v12.5l-4-3.25-4 3.25z');
  svg.append(p);
  return svg;
}
function markButton(q) {
  const b = h('button', { class: 'mark-btn', type: 'button', 'aria-pressed': String(isMarked(q)) }, bookmarkIcon(), h('span', { text: 'Mark for review' }));
  b.addEventListener('click', () => {
    if (!S.marks) S.marks = { review: [], out: {} };
    S.marks.review = isMarked(q) ? S.marks.review.filter((x) => x !== q.id) : [...S.marks.review, q.id];
    saveMarks();
    b.setAttribute('aria-pressed', String(isMarked(q)));
    renderSheet();
  });
  return b;
}

function metaRow(q, kind) {
  return h('div', { class: 'meta-row' },
    h('span', {}, q.name ? h('b', { class: 'q-name', text: q.name }) : null, kind, ' ', h('button', { class: 'link-btn', type: 'button', text: 'Directions', onclick: openDirections })),
    h('span', { class: 'meta-right' }, markButton(q), h('span', { text: plural(q.points, 'point') + (q.partialCredit ? ' (partial credit)' : '') })));
}

// Question text is made once and kept for the whole quiz, so highlights (and colored code, and math)
// are still there when a student comes back to the question.
function kept(key, make) {
  let n = S.kept.get(key);
  if (!n) { n = make(); S.kept.set(key, n); }
  return n;
}

// A passage, case or listing that several questions use, written once in the quiz. Highlights in it
// show on every question that uses it.
// Markdown options: the quiz's language for code, and where its images are.
const mdOpts = () => ({ lang: S.quiz && S.quiz.language, assetUrl: api.assetUrl });
// A choice with more than one line (code, a table, a list) is set as blocks; a one-line choice stays inline.
const choiceText = (c) => (/\n/.test(c)
  ? h('div', { class: 'choice-text choice-rich hl-root' }, BQ.md.render(c, mdOpts()))
  : h('span', { class: 'choice-text hl-root' }, BQ.md.renderInline(c, mdOpts())));

// The material's card is kept between questions; it's only a tab stop where it scrolls on its own.
const notTabbable = (el) => { if (el) el.removeAttribute('tabindex'); return el; };
// A question can use more than one: they stack, in the quiz's order.
function sharedBlock(q) {
  const blocks = [].concat(q.shared || []).map((sid) => {
    const m = S.quiz.shared ? S.quiz.shared[sid] : null;
    return m && kept('shared:' + sid, () => h('section', { class: 'shared', 'aria-label': m.title || 'Shared material' },
      m.title ? h('p', { class: 'shared-title', text: m.title }) : null,
      m.text ? h('div', { class: 'prompt hl-root' }, BQ.md.render(m.text, mdOpts())) : null,
      m.image ? h('img', { class: 'qimg', src: api.assetUrl(m.image), alt: m.imageAlt || '' }) : null));
  }).filter(Boolean);
  if (!blocks.length) return null;
  return blocks.length === 1 ? blocks[0] : h('div', { class: 'shared-stack', role: 'group', 'aria-label': 'Shared material' }, blocks);
}

function prompt(q) {
  const fix = S.quiz.corrections && S.quiz.corrections.fix[q.id];
  return [
    fix ? h('p', { class: 'fix-note', text: fix.fresh ? 'A new question like the one you missed' : `On the quiz: ${fix.points} / ${plural(fix.max, 'point')}` }) : null,
    kept('prompt:' + q.id, () => h('div', { class: 'prompt hl-root' }, BQ.md.render(q.prompt, mdOpts()))),
    q.image ? h('img', { class: 'qimg', src: api.assetUrl(q.image), alt: q.imageAlt || '' }) : null,
  ];
}

// ---------- highlighting ----------
// Students select question text and highlight it, like on paper. Copying or dragging it out stays
// blocked by the monitor. A small bar over the selection offers Highlight, and Remove when the
// selection (or a click) touches a highlight.
function highlightBar() {
  let range = null;
  const apply = (st) => { if (range) addHighlight(range, false, st); hide(); };
  const swatches = [['y', 'Yellow'], ['g', 'Green'], ['b', 'Blue'], ['p', 'Pink']].map(([c, name]) =>
    h('button', { class: `hl-swatch hl-sw-${c}`, type: 'button', title: `${name} highlight`, 'aria-label': `${name} highlight`, onclick: () => apply(c) }));
  const ul = h('button', { class: 'btn small hl-ul', type: 'button', title: 'Underline', 'aria-label': 'Underline', text: 'U', onclick: () => apply('u') });
  const un = h('button', { class: 'btn small', type: 'button', text: 'Remove', 'aria-label': 'Remove highlight', onclick: () => { if (range) removeHighlight(range); hide(); } });
  const bar = h('div', { class: 'hl-bar', role: 'toolbar', 'aria-label': 'Highlight', hidden: true }, ...swatches, ul, un);
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
  function hide() { bar.hidden = true; range = null; }
  const rootOf = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('.hl-root'); };
  function update() {
    const sel = window.getSelection();
    if (!S.el || !sel || !sel.rangeCount) return hide();
    const r = sel.getRangeAt(0);
    const root = rootOf(r.startContainer);
    if (!root || root !== rootOf(r.endContainer) || !S.el.main.contains(root)) return hide();
    const marks = [...root.querySelectorAll('mark.hl')].filter((m) => r.intersectsNode(m));
    // A click (no selection) on a highlight offers to remove it; not on a choice, where a click picks it.
    if (sel.isCollapsed && (!marks.length || root.closest('.choice'))) return hide();
    if (sel.isCollapsed) { range = document.createRange(); range.selectNodeContents(marks[0]); } else range = r.cloneRange();
    un.hidden = !marks.length; // a click on a highlight: recolor it, or take it off
    bar.hidden = false;
    const at = (sel.isCollapsed ? marks[0] : r).getBoundingClientRect();
    const box = S.el.wrap.getBoundingClientRect();
    const y = S.el.wrap.scrollTop; // a short window scrolls the whole quiz
    const top = at.top - box.top - bar.offsetHeight - 8;
    // On touch screens the phone's own Copy menu sits above the selection, so go below it.
    bar.style.top = `${top > 4 && !coarse() ? top + y : at.bottom - box.top + 8 + y}px`;
    bar.style.left = `${Math.max(8, Math.min(box.width - bar.offsetWidth - 8, at.left - box.left + at.width / 2 - bar.offsetWidth / 2))}px`;
  }
  return { bar, update, hide };
}
const coarse = () => matchMedia('(pointer: coarse)').matches;
// A touch selection never sends mouseup or keyup: follow the selection itself.
let selTimer = 0;
document.addEventListener('selectionchange', () => {
  if (!coarse()) return;
  clearTimeout(selTimer);
  selTimer = setTimeout(() => { if (S.el && S.el.hlBar && S.el.main.isConnected) S.el.hlBar.update(); }, 250);
});
function textNodesIn(range) {
  const top = range.commonAncestorContainer;
  const root = top.nodeType === 1 ? top : top.parentNode;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // math keeps its own layout, so it isn't split up
    acceptNode: (n) => (n.nodeValue && range.intersectsNode(n) && !n.parentElement.closest('.katex') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const out = [];
  if (top.nodeType === 3) { if (!top.parentElement.closest('.katex')) out.push(top); return out; }
  while (walk.nextNode()) out.push(walk.currentNode);
  return out;
}
// Highlights in el as [start, end) character offsets, counting a line break element as one character,
// so they survive el being rewritten with the same text.
function marksIn(el) {
  const out = [];
  let pos = 0;
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const len = c.nodeValue.length;
        const m = c.parentElement.closest('mark.hl');
        if (m) { // [start, end], and the style when it isn't yellow: g, b, p (colors) or u (underline)
          const st = m.dataset.c || 'y';
          const last = out[out.length - 1];
          if (last && last[1] === pos && (last[2] || 'y') === st) last[1] += len; else out.push(st === 'y' ? [pos, pos + len] : [pos, pos + len, st]);
        }
        pos += len;
      } else if (c.nodeName === 'BR') pos += 1;
      else if (c.nodeType === 1) walk(c);
    }
  }(el));
  return out;
}
function rangeAt(el, a, b) {
  const r = document.createRange();
  let pos = 0;
  let started = false;
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const len = c.nodeValue.length;
        if (!started && a <= pos + len) { r.setStart(c, a - pos); started = true; }
        if (started && b <= pos + len) { r.setEnd(c, b - pos); return true; }
        pos += len;
      } else if (c.nodeName === 'BR') pos += 1;
      else if (c.nodeType === 1 && walk(c)) return true;
    }
    return false;
  }(el));
  return r;
}
// st: y (yellow), g, b, p (green, blue, pink) or u (underline). Already highlighted text takes the new style.
const HL_STYLES = ['y', 'g', 'b', 'p', 'u'];
function addHighlight(range, keepSelection, st) {
  st = HL_STYLES.includes(st) ? st : 'y';
  for (let node of textNodesIn(range)) {
    const old = node.parentElement.closest('mark.hl');
    if (old) { if (st === 'y') delete old.dataset.c; else old.dataset.c = st; continue; }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end) continue;
    if (end < node.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    if (!node.nodeValue.trim() && node.nodeValue.includes('\n')) continue; // the gap between two paragraphs
    const mark = h('mark', { class: 'hl', 'data-c': st === 'y' ? null : st });
    node.replaceWith(mark);
    mark.append(node);
  }
  if (!keepSelection) window.getSelection().removeAllRanges();
}
function removeHighlight(range) {
  for (const m of [...S.el.main.querySelectorAll('mark.hl')]) {
    if (!range.intersectsNode(m)) continue;
    const parent = m.parentNode;
    m.replaceWith(...m.childNodes);
    parent.normalize();
  }
  window.getSelection().removeAllRanges();
}

export { addHighlight, choiceText, clearMarks, highlightBar, isCrossed, isMarked, kept, loadMarks, marksIn, mdOpts, metaRow, notTabbable, prompt, rangeAt, setCrossed, sharedBlock };
