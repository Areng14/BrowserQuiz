// The editor's plumbing (status, redraws, what's wrong with a question) and its form fields.

import { ICONS, h, icon } from '../dash/core.js';
import { ed } from './state.js';
import { countBlanks } from './formats.js';
import { readCode, readTrace } from './model.js';
import { grow } from './editing.js';
import { renderOutline } from './outline.js';

const imageMissing = (p) => !ed.newAssets[p] && !ed.existingAssets.has(p);
// The images written into text as Markdown: prompts, choices, shared material and directions.
const markdownImages = (qz) => {
  const texts = [];
  for (const q of qz.questions || []) texts.push(q.prompt, q.explanation, ...(Array.isArray(q.choices) ? q.choices : []));
  for (const m of qz.shared || []) texts.push(m.text);
  if (qz.directions && typeof qz.directions === 'object') texts.push(...Object.values(qz.directions));
  for (const sec of qz.sections || []) texts.push(sec.directions);
  const out = new Set();
  for (const t of texts) if (typeof t === 'string') for (const m of t.matchAll(/!\[[^\]]*\]\((?:\.\/)?(assets\/[A-Za-z0-9_.-]+)\)/g)) out.add(m[1]);
  return [...out];
};

function setStatus(text, bad) { ed.status.textContent = text; ed.status.classList.toggle('t-error', !!bad); }
function refreshSoon() {
  if (ed.queued) return;
  ed.queued = true;
  requestAnimationFrame(() => { ed.queued = false; renderOutline(); if (ed.paneTick) ed.paneTick(); });
}
function touch(q) {
  ed.dirty = true;
  ed.edits++;
  if (ed.status.textContent) setStatus('');
  if (q) ed.fromServer.delete(q);
  refreshSoon();
}
const nextId = () => { let n = ed.quiz.questions.length + 1; while (ed.quiz.questions.some((q) => q.id === `q${n}`)) n++; return `q${n}`; };

function problemsOf(q) {
  const out = [];
  if (!q.prompt.trim()) out.push('Write the prompt.');
  if (!(Number(q.points) > 0)) out.push('Points must be more than 0.');
  if (q.pool) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(q.pool)) out.push('A pool name can only use letters, digits, - and _.');
    const first = ed.quiz.questions.find((x) => x.pool === q.pool);
    if (first && Number(first.points) !== Number(q.points)) out.push(`Make it worth ${Number(first.points) || 0}, like the rest of pool "${q.pool}", so every student's quiz is out of the same points.`);
  }
  if (q.image && imageMissing(q.image)) out.push(`Add the image file for ${q.image}.`);
  const sharedOf = [].concat(q.shared || []).map((id) => (ed.quiz.shared || []).find((x) => x.id === id)).filter(Boolean);
  for (const p of markdownImages({ questions: [q], shared: sharedOf })) if (imageMissing(p)) out.push(`Add the image file for ${p}, or take it out of the text.`);
  for (const sid of [].concat(q.shared || [])) {
    const m = (ed.quiz.shared || []).find((x) => x.id === sid);
    if (!m || (!(m.text || '').trim() && !m.image)) out.push('Write the shared material, or pick None.');
    else if (m.image && imageMissing(m.image)) out.push(`Add the image file for ${m.image}.`);
  }
  if (q.type === 'single' || q.type === 'multi') {
    const marked = q.type === 'single' ? (q.answer == null ? [] : [q.answer]) : q.answer;
    if (q.choices.filter((c) => c.trim()).length < 2) out.push('Write at least 2 choices.');
    if (!marked.length) out.push(q.type === 'single' ? 'Mark the correct choice.' : 'Mark at least one correct choice.');
    else if (marked.some((k) => !(q.choices[k] || '').trim())) out.push('A choice marked correct is empty.');
  }
  if (q.type === 'text' && !q.answer.some((a) => a.trim())) out.push('Add an accepted answer.');
  if (q.type === 'code') out.push(...readCode(q).problems);
  if (q.type === 'output' && !(q.code || '').trim()) out.push('Write the code.');
  if (q.type === 'trace') {
    const t = readTrace(q);
    if (t.columns.some((c) => !c)) out.push('Name every column.');
    if (!t.rows.length) out.push('Fill in the table.');
    else if (t.rows.some((row) => row.some((v) => !v))) out.push('Fill in every cell, or clear the whole row.');
    else if (t.given.length >= t.rows.length * t.columns.length) out.push('Leave at least one cell for students.');
  }
  if (q.type === 'fill') {
    const n = countBlanks(q.code);
    if (!(q.code || '').trim()) out.push('Write the code.');
    else if (!n) out.push('Mark a blank in the code with ___.');
    else if (n > 30) out.push('At most 30 blanks.');
    q._ui.blanks.forEach((b, k) => { if (!b.trim()) out.push(`Blank ${k + 1} needs an answer.`); });
    if (q._ui.run) out.push(...readCode(q).problems);
  }
  if (q.type === 'essay' && (q.rubric || []).filter((x) => x.text.trim()).reduce((sum, x) => sum + (Number(x.points) || 0), 0) > Number(q.points)) {
    out.push('Rubric points add up to more than the question\'s points.');
  }
  return out.concat(ed.fromServer.get(q) || []);
}

// ---------- fields ----------
const input = (q, value, on, attrs) => {
  const el = h('input', Object.assign({ class: 'input', value: value == null ? '' : String(value) }, attrs || {}));
  el.addEventListener('input', () => { on(el.value); touch(q); });
  return el;
};
// Random values: a little table, names on the first line, then a row of values per line. Each student
// gets one row, put in for {{name}} in the question (server: quizfile.js checkVars).
const VAR_TYPES = new Set(['single', 'multi', 'text', 'output', 'trace']);
const cells = (line) => [...line.matchAll(/\s*("(?:[^"]|"")*"|[^,]*)\s*(?:,|$)/g)].map((m) => m[1]).slice(0, -1)
  .map((c) => (/^".*"$/.test(c) ? c.slice(1, -1).replace(/""/g, '"') : c.trim()));
const varsText = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return '';
  const names = Object.keys(rows[0]);
  const cell = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [names.join(', '), ...rows.map((r) => names.map((n) => cell(r[n] ?? '')).join(', '))].join('\n');
};
const varsEditor = (q) => field('Random values: names, then one row per line. Each student gets a row; write {{name}} where it goes',
  area(q, varsText(q.vars), (v) => {
    const lines = v.split('\n').filter((l) => l.trim());
    if (lines.length < 2) { delete q.vars; return; }
    const names = cells(lines[0]);
    q.vars = lines.slice(1).map((l) => { const vals = cells(l); return Object.fromEntries(names.map((n, k) => [n, vals[k] ?? ''])); });
  }, { rows: 3, placeholder: 'x, y, out\n7, 2, 1\n9, 4, 1' }));
const area = (q, value, on, attrs) => {
  const el = h('textarea', Object.assign({ class: 'input qe-area', spellcheck: 'false', rows: 2 }, attrs || {}));
  el.value = value || '';
  el.addEventListener('input', () => { on(el.value); grow(el); touch(q); });
  return el;
};
const check = (q, checked, label, on) => {
  const cb = h('input', { type: 'checkbox', checked: !!checked });
  cb.addEventListener('change', () => { on(cb.checked); touch(q); });
  return h('label', { class: 't-check' }, cb, h('span', { text: label }));
};
const field = (label, el, ...more) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el, ...more);
// A part of the open question or settings, in a box of its own
const card = (title, ...kids) => h('section', { class: 'qe-card' }, title ? h('h2', { class: 'qe-card-title', text: title }) : null, ...kids.flat(Infinity).filter(Boolean));
// Settings: how many of each pool's questions a student gets
const poolSettings = (q) => {
  const sizes = new Map();
  for (const x of ed.quiz.questions) if (x.pool) sizes.set(x.pool, (sizes.get(x.pool) || 0) + 1);
  if (!sizes.size) return null;
  return h('div', { class: 'qe-settings-grid' }, [...sizes].map(([name, count]) => field(`Pool "${name}": questions each student gets`,
    h('span', { class: 'qe-line' },
      (() => {
        const el = input(q, Math.min(count, (ed.quiz.pools || {})[name] || 1), (v) => {
          ed.quiz.pools = Object.assign({}, ed.quiz.pools, { [name]: Math.max(1, Math.min(count, Math.round(Number(v)) || 1)) });
          renderOutline(); // the total under the outline: what each student gets
        }, { type: 'number', min: '1', max: String(count), class: 'input t-points' });
        el.addEventListener('change', () => { el.value = String((ed.quiz.pools || {})[name] || 1); }); // 9 of 3 shows as 3
        return el;
      })(),
      h('span', { class: 't-muted', text: `of ${count}` })))));
};
const xBtn = (label, onclick, disabled) => h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': label, title: label, disabled, onclick }, icon(ICONS.x, 16));

export { VAR_TYPES, area, card, check, field, imageMissing, input, markdownImages, nextId, poolSettings, problemsOf, refreshSoon, setStatus, touch, varsEditor, xBtn };
