// Syntax colors in the maker, as you type. A code box keeps its own textarea (caret, selection, undo and
// the editing keys stay the browser's) with its text see-through, and a layer over it draws the same text
// in colors from Monaco's tokenizer, the way report-view.js colors answers. Previews of Markdown color
// their code blocks the same way.

import { h } from '../dash/core.js';

let mono = null; // Monaco, once it's loaded
let asked = null;
const loaded = new Set(); // languages whose tokenizer is ready
const live = new WeakMap(); // a box's wrapper -> its redraw

const report = () => window.BQReport;
function monaco() {
  if (!asked && report() && report().loadMonaco) {
    asked = report().loadMonaco().then((m) => { mono = m; return m; }).catch(() => null);
  }
  return asked || Promise.resolve(null);
}
// Monaco loads a language's tokenizer the first time it's asked to color it.
function ready(lang) {
  if (!mono || loaded.has(lang)) return Promise.resolve();
  loaded.add(lang);
  return Promise.resolve(mono.editor.colorize('', lang, {})).catch(() => {});
}

// The text in colored spans, each ___ in a fill question's code marked as a blank.
function pieces(text, lang, blanks) {
  const out = [];
  const put = (s, cls) => {
    if (!s) return;
    if (blanks && s.includes('___')) {
      s.split(/(_{3,})/).forEach((p, k) => { if (p) out.push(k % 2 ? h('span', { class: 'qe-hl-blank', text: p }) : cls ? h('span', { class: cls, text: p }) : p); });
      return;
    }
    out.push(cls ? h('span', { class: cls, text: s }) : s);
  };
  let tokens = null;
  if (mono && lang) { try { tokens = mono.editor.tokenize(text, lang); } catch (e) { tokens = null; } }
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    const lt = (tokens && tokens[li]) || [];
    if (!lt.length) put(line);
    lt.forEach((t, k) => put(line.slice(t.offset, k + 1 < lt.length ? lt[k + 1].offset : line.length), report().tokenClass(t.type)));
    if (li < lines.length - 1) out.push('\n');
  });
  out.push('\n'); // so a last empty line still has its height
  return out;
}

// Wraps a code box so its text is drawn in colors. langOf() is read each time, so a language change shows
// at the next redraw (recolor). Returns the wrapper, to put where the box would go.
function colored(ta, langOf, opts) {
  const inner = h('div', { class: 'qe-hl-in' });
  const layer = h('div', { class: 'qe-hl-layer', 'aria-hidden': 'true' }, inner);
  const wrapEl = h('div', { class: 'qe-hl' }, ta, layer);
  ta.classList.add('qe-hl-text');
  const blanks = !!(opts && opts.blanks);
  // the box's measures, once it's on the page (a box not yet placed has none to read)
  const fit = () => {
    if (!ta.isConnected) return false;
    const cs = getComputedStyle(ta);
    for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'fontFeatureSettings', 'fontVariantLigatures']) layer.style[k] = cs[k];
    return true;
  };
  const scroll = () => { inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; };
  let queued = false;
  let fitted = false;
  const draw = () => {
    queued = false;
    const lang = langOf();
    fitted = fit();
    inner.replaceChildren(...pieces(ta.value, lang, blanks));
    scroll();
    if (mono && lang && !loaded.has(lang)) ready(lang).then(later);
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  live.set(wrapEl, later);
  ta.addEventListener('input', later);
  ta.addEventListener('scroll', scroll);
  draw(); // the text at once, so it never shows blank
  requestAnimationFrame(() => { if (!fitted) draw(); }); // and its measures as soon as it's placed
  if (!mono) monaco().then((m) => { if (m) later(); });
  return wrapEl;
}
// Redraws every colored box under root, after something they read (the language) changed.
function recolor(root) { for (const el of root.querySelectorAll('.qe-hl')) { const f = live.get(el); if (f) f(); } }

// Code blocks in a Markdown preview. A block with {{name}} values in it stays plain, so their tags show.
function colorIn(root) {
  if (!report() || !report().highlight) return;
  for (const c of root.querySelectorAll('code[data-lang]')) if (c.textContent.includes('{{')) c.setAttribute('data-hl', '');
  report().highlight(root);
}

export { colorIn, colored, recolor };
