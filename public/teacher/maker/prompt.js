// The prompt (shown as students read it until you click in to edit it), and rubrics.

import { h } from '../dash/core.js';
import { ed } from './state.js';
import { LANGS } from './formats.js';
import { MOD, grow, insert, wrap } from './editing.js';
import { area, input, touch, xBtn } from './core.js';
import { addImage, addInlineImage, assetSrc, imageEditor } from './choices.js';
import { renderPane } from './pane.js';

// ---------- prompt ----------
// Whether a mouse button or finger is down: leaving the prompt that way waits for the click to finish
// before the prompt changes size, or what was clicked would move out from under it.
let pressing = false;
addEventListener('pointerdown', () => { pressing = true; }, true);
addEventListener('pointerup', () => { pressing = false; }, true);
addEventListener('pointercancel', () => { pressing = false; }, true);
function promptEditor(q) {
  const ta = area(q, q.prompt, (v) => { q.prompt = v; }, { id: 'qe-prompt', rows: 4, spellcheck: 'true' });
  const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  file.addEventListener('change', () => addImage(q, file.files[0]));
  const fence = () => { const s = ta.value.slice(0, ta.selectionStart); wrap(ta, `${s && !s.endsWith('\n') ? '\n' : ''}\`\`\`${ed.quiz.language === 'none' ? '' : ed.quiz.language}\n`, '\n```\n'); };
  // a mousedown that keeps the focus in the prompt, so it doesn't flip to the read view and back
  const tool = (text, title, fn, cls) => h('button', { class: `qe-tool ${cls || ''}`, type: 'button', text, title, onclick: fn, onmousedown: (e) => { if (document.activeElement === ta) e.preventDefault(); } });
  const view = h('div', { class: 'qe-pview prompt', 'aria-hidden': 'true' });
  const box = h('div', { class: 'qe-pbox' }, view, ta);
  const paint = () => {
    const editing = document.activeElement === ta || !ta.value.trim();
    box.classList.toggle('editing', editing);
    if (editing) { grow(ta); return; }
    const md = window.BQ && window.BQ.md;
    view.replaceChildren(md ? md.render(ta.value, { lang: ed.quiz.language, assetUrl: assetSrc }) : ta.value);
  };
  ta.addEventListener('focus', paint);
  ta.addEventListener('blur', () => { if (pressing) addEventListener('pointerup', () => setTimeout(paint), { once: true, capture: true }); else paint(); });
  view.addEventListener('mousedown', (e) => { e.preventDefault(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  paint();
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && !e.shiftKey && 'bie'.includes(k) && k.length === 1) {
      e.preventDefault();
      if (k === 'b') wrap(ta, '**', '**'); else if (k === 'i') wrap(ta, '*', '*'); else wrap(ta, '`', '`');
    } else if (e.key === '`' && !mod && ta.selectionStart !== ta.selectionEnd) {
      e.preventDefault();
      wrap(ta, '`', '`');
    } else if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey && (ta.value.slice(0, ta.selectionStart).match(/^```/gm) || []).length % 2) {
      e.preventDefault(); // inside a code block
      insert(ta, '    ');
    }
  });
  const takeImage = (files, e) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); if (q.image) addInlineImage(ta, f); else addImage(q, f); } };
  ta.addEventListener('paste', (e) => takeImage(e.clipboardData && e.clipboardData.files, e));
  ta.addEventListener('drop', (e) => takeImage(e.dataTransfer && e.dataTransfer.files, e));
  const moreFile = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  moreFile.addEventListener('change', () => { addInlineImage(ta, moreFile.files[0]); moreFile.value = ''; });
  return [h('div', { class: 'field' },
    h('div', { class: 'qe-tools' },
      h('label', { class: 'field-label', for: 'qe-prompt', text: 'Prompt' }),
      h('span', { class: 'qe-grow' }),
      tool('B', `Bold (${MOD}B)`, () => wrap(ta, '**', '**'), 'b'),
      tool('I', `Italic (${MOD}I)`, () => wrap(ta, '*', '*'), 'i'),
      tool('Code', `Inline code (${MOD}E)`, () => wrap(ta, '`', '`')),
      tool('Code block', 'A block of code on its own lines', fence),
      tool('Math', 'LaTeX math: $x^2$ in a line, $$...$$ on its own lines', () => wrap(ta, '$', '$')),
      tool('Table', 'A table: | cells | split | by bars |, with a --- line under the header', () => {
        const s = ta.value.slice(0, ta.selectionStart);
        insert(ta, `${s && !s.endsWith('\n') ? '\n\n' : s && !s.endsWith('\n\n') ? '\n' : ''}| Column | Column |\n| --- | --- |\n|  |  |\n`);
      }),
      tool('Image', q.image ? 'Add another image where the cursor is. You can also paste or drop one' : 'Add an image. You can also paste or drop one into the prompt', () => (q.image ? moreFile : file).click())),
    box, file, moreFile), imageEditor(q, file)];
}

// With random values, the first row's values in place of {{name}}
const firstRow = (v, row) => (typeof v === 'string' ? v.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (m, n) => (Object.hasOwn(row, n) ? String(row[n]) : m))
  : Array.isArray(v) ? v.map((x) => firstRow(x, row)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'vars' && k !== '_ui').map(([k, x]) => [k, firstRow(x, row)])) : v);

// ---------- rubric, for code and written answers ----------
// On code questions (langs given) an item can grade itself: a regex the code must have, or must not
// have, one per language. Comments and strings don't count. Otherwise the teacher ticks it.
const BAN_HINT = { java: 'Arrays.sort, Collections.sort, stream', python: 'sorted, sort', javascript: 'sort, Math.max', typescript: 'sort, Math.max',
  c: 'qsort', cpp: 'std::sort, max_element', csharp: 'Array.Sort, OrderBy', go: 'sort, slices.Sort', rust: 'sort, BinaryHeap' };
const PATTERN_HINT = {
  require: { java: 'private\\s+\\w+\\s+\\w+\\s*;', python: 'self\\._\\w+\\s*=', javascript: '\\bconst\\b', typescript: ':\\s*number\\b', c: '\\bfree\\(', cpp: 'private:', go: '\\bfor\\b', rust: '\\bmatch\\b', csharp: 'private\\s+\\w+\\s+\\w+\\s*;' },
  forbid: { java: 'Arrays\\.sort', python: 'sorted\\(', javascript: '\\.sort\\(', typescript: '\\.sort\\(', c: 'qsort\\(', cpp: '\\bsort\\(', go: 'sort\\.', rust: '\\.sort', csharp: '\\.Sort\\(|OrderBy' },
};
function rubricEditor(q, placeholder, langs) {
  q.rubric = q.rubric || [];
  const worth = h('span', { class: 't-small t-muted' });
  const add = () => { q.rubric.push({ text: '', points: 1 }); touch(q); renderPane(); const all = ed.pane.querySelectorAll('.qe-rubric .qe-choice input[type=text]'); all[all.length - 1].focus(); };
  const rows = q.rubric.map((r, k) => {
    const text = input(q, r.text, (v) => { r.text = v; }, { type: 'text', placeholder });
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); add(); } });
    const line = h('div', { class: 'qe-choice' }, text,
      input(q, r.points, (v) => { r.points = v; }, { type: 'number', min: '0', step: '0.5', class: 'input t-points', 'aria-label': 'Points' }),
      xBtn('Remove rubric item', () => { q.rubric.splice(k, 1); touch(q); renderPane(); }));
    if (!langs) return line;
    if (r.require || r.forbid) r._auto = true;
    const by = h('select', { class: 'input qe-narrow', 'aria-label': 'Who grades it' },
      [['', 'You grade it'], ['auto', 'Auto']].map(([v, t]) => h('option', { value: v, text: t, selected: (r._auto ? 'auto' : '') === v })));
    by.addEventListener('change', () => {
      r._auto = by.value === 'auto';
      if (!r._auto) { delete r.require; delete r.forbid; }
      touch(q);
      renderPane();
      if (r._auto) { const el = ed.pane.querySelectorAll('.qe-rubric-item')[k]; if (el) el.querySelector('.qe-pattern input').focus(); }
    });
    // One regex per language; either row can be left empty.
    const patternRow = (key, label) => h('div', { class: 'qe-pattern-group' }, h('span', { class: 't-small qe-pattern-label', text: label }), langs.map((l) => {
      const cur = r[key];
      const el = input(q, typeof cur === 'string' ? cur : (cur && cur[l]) || '', (v) => {
        const all = typeof r[key] === 'string' ? Object.fromEntries(langs.map((x) => [x, r[key]])) : Object.assign({}, r[key]);
        all[l] = v;
        r[key] = all;
      }, { type: 'text', class: 'input qe-mono', spellcheck: 'false', autocomplete: 'off', placeholder: PATTERN_HINT[key][l], 'aria-label': `${label} (${LANGS[l]} regex)` });
      return h('label', { class: 'qe-pattern' }, langs.length > 1 ? h('span', { class: 't-small', text: LANGS[l] }) : null, el);
    }));
    return h('div', { class: 'qe-rubric-item' }, line, h('div', { class: 'qe-rubric-auto' }, by),
      r._auto ? patternRow('require', 'Code has') : null, r._auto ? patternRow('forbid', "Code doesn't have") : null);
  });
  return { worth, node: h('div', { class: 'field qe-rubric' }, h('span', { class: 'field-label', text: 'Rubric' }), rows,
    h('div', { class: 'qe-line' }, h('button', { class: 'btn small', type: 'button', text: 'Add rubric item', onclick: add }), worth)) };
}

export { BAN_HINT, firstRow, promptEditor, rubricEditor };
