// The prompt, what students see (redrawn as you type), and rubrics.

import { h } from '../dash/core.js';
import { ed } from './state.js';
import { BLANK, BT, LANGS } from './formats.js';
import { readCode, readTrace, starterCode } from './model.js';
import { MOD, insert, wrap } from './editing.js';
import { area, input, touch, xBtn } from './core.js';
import { addImage, addInlineImage, assetSrc, imageEditor, imageSrc } from './choices.js';
import { renderPane } from './pane.js';

// ---------- prompt ----------
function promptEditor(q) {
  const ta = area(q, q.prompt, (v) => { q.prompt = v; }, { id: 'qe-prompt', rows: 4, spellcheck: 'true' });
  const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  file.addEventListener('change', () => addImage(q, file.files[0]));
  const fence = () => { const s = ta.value.slice(0, ta.selectionStart); wrap(ta, `${s && !s.endsWith('\n') ? '\n' : ''}\`\`\`${ed.quiz.language === 'none' ? '' : ed.quiz.language}\n`, '\n```\n'); };
  const tool = (text, title, fn, cls) => h('button', { class: `qe-tool ${cls || ''}`, type: 'button', text, title, onclick: fn });
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
    ta, file, moreFile), imageEditor(q, file)];
}

// What the student gets, redrawn as you type.
// With random values, the preview shows the first row's.
const firstRow = (v, row) => (typeof v === 'string' ? v.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (m, n) => (Object.hasOwn(row, n) ? String(row[n]) : m))
  : Array.isArray(v) ? v.map((x) => firstRow(x, row)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'vars' && k !== '_ui').map(([k, x]) => [k, firstRow(x, row)])) : v);
function studentView(q0) {
  const q = Array.isArray(q0.vars) && q0.vars[0] ? Object.assign(firstRow(q0, q0.vars[0]), { _ui: q0._ui }) : q0;
  const md = window.BQ && window.BQ.md;
  const out = [];
  const opts = { lang: ed.quiz.language, assetUrl: assetSrc };
  for (const sid of [].concat(q.shared || [])) {
    const sm = (ed.quiz.shared || []).find((x) => x.id === sid);
    if (!sm || !((sm.text || '').trim() || sm.title || sm.image)) continue;
    const body = h('div', { class: 'prompt' });
    if (md) body.append(md.render(sm.text || '', opts)); else body.textContent = sm.text || '';
    out.push(h('section', { class: 'shared' }, sm.title ? h('p', { class: 'shared-title', text: sm.title }) : null, body,
      sm.image && imageSrc(sm) ? h('img', { class: 'qimg', src: imageSrc(sm), alt: sm.imageAlt || '' }) : null));
  }
  const prompt = h('div', { class: 'prompt' });
  if (md) prompt.append(md.render(q.prompt, opts)); else prompt.textContent = q.prompt;
  out.push(prompt);
  if (q.image && imageSrc(q)) out.push(h('img', { class: 'qimg', src: imageSrc(q), alt: q.imageAlt || '' }));
  if (q.type === 'single' || q.type === 'multi') {
    out.push(h('div', { class: 'choices' }, q.choices.filter((c) => c.trim()).map((c) => {
      const rich = /\n/.test(c);
      const text = h(rich ? 'div' : 'span', { class: 'choice-text' + (rich ? ' choice-rich' : '') });
      if (md) text.append(rich ? md.render(c, opts) : md.renderInline(c, opts)); else text.textContent = c;
      return h('div', { class: 'choice' }, h('input', { type: q.type === 'multi' ? 'checkbox' : 'radio', tabindex: '-1' }), text);
    })));
  }
  if (q.type === 'text') out.push(h('input', { class: 'input text-answer', tabindex: '-1', 'aria-hidden': 'true' }));
  const codeBlock = () => ((q.code || '').trim() ? h('pre', { class: 'md-code' }, h('code', { text: q.code.trimEnd() })) : null);
  const box = (label, rows, mono) => h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }),
    h('textarea', { class: `input long-answer${mono ? ' mono' : ''}`, rows, tabindex: '-1', 'aria-hidden': 'true' }));
  if (q.type === 'output') out.push(codeBlock(), box('Output', 4, true));
  if (q.type === 'trace') {
    const t = readTrace(q);
    const given = new Set(t.given.map((g) => g.join(',')));
    out.push(codeBlock(), h('div', { class: 'trace-wrap' }, h('table', { class: 'trace' },
      h('thead', {}, h('tr', {}, t.columns.map((c) => h('th', { text: c || ' ' })))),
      h('tbody', {}, t.rows.map((row, r) => h('tr', {}, row.map((v, c) => (given.has(`${r},${c}`)
        ? h('td', { class: 'given', text: v }) : h('td', {}, h('input', { class: 'trace-cell', tabindex: '-1', 'aria-hidden': 'true' }))))))))));
  }
  if (q.type === 'fill') {
    const pre = h('pre', { class: 'md-code fill-code' });
    const pieces = (q.code || '').trimEnd().split(BLANK);
    pieces.forEach((seg, i) => {
      if (seg) pre.append(h('code', { text: seg }));
      if (i < pieces.length - 1) pre.append(h('input', { class: 'blank', tabindex: '-1', 'aria-hidden': 'true', style: 'width: 6ch' }));
    });
    if ((q.code || '').trim()) out.push(pre);
    if (q._ui.run) out.push(h('div', {}, h('button', { class: 'btn small primary', type: 'button', tabindex: '-1', text: 'Run examples' })));
  }
  if (q.type === 'essay') out.push(box('Your answer', 6, !!q.language));
  if (q.type === 'code') {
    const lang = q.languages[0];
    const custom = q.starter && typeof q.starter === 'object' ? q.starter[lang] : null;
    const rc = readCode(q);
    const shape = rc.shape;
    if (rc.types) out.push(h('p', { class: 'sub', text: 'Classes you can use' }), h('pre', { class: 'md-code' }, h('code', { text: BT.classSource(rc.types, lang, true).trimEnd() })));
    const code = custom || (shape ? starterCode(shape, lang, q.starter === 'empty') : '');
    if (code) out.push(h('pre', { class: 'md-code' }, h('code', { text: code.trimEnd() })));
  }
  return out.filter(Boolean);
}

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

export { BAN_HINT, promptEditor, rubricEditor, studentView };
