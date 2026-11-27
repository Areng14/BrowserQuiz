// Choices, and images.

import { ICONS, h, icon, tip } from '../dash/core.js';
import { ed } from './state.js';
import { IMAGE_MIME, extOf, insert, sortable } from './editing.js';
import { VAR_TYPES, area, check, field, imageMissing, input, touch, xBtn } from './core.js';
import { withValues } from './values.js';
import { renderPane } from './pane.js';

// ---------- choices ----------
// Marks travel with their choices when rows are added, removed or moved.
function editChoices(q, fn) {
  const multi = q.type === 'multi';
  const rows = q.choices.map((text, k) => ({ text, on: multi ? q.answer.includes(k) : q.answer === k }));
  fn(rows);
  q.choices = rows.map((r) => r.text);
  const marked = rows.map((r, k) => (r.on ? k : -1)).filter((k) => k >= 0);
  q.answer = multi ? marked : marked.length ? marked[0] : null;
  touch(q);
  renderPane();
}
const focusChoice = (k) => { const el = ed.pane.querySelectorAll('.qe-choice textarea.input')[k]; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };

function choicesEditor(q) {
  const multi = q.type === 'multi';
  const full = q.choices.length >= 8;
  const rows = q.choices.map((c, k) => {
    const mark = h('input', { type: multi ? 'checkbox' : 'radio', name: 'qe-answer', checked: multi ? q.answer.includes(k) : q.answer === k, 'aria-label': `Choice ${k + 1} is correct`, title: 'Correct' });
    mark.addEventListener('change', () => {
      if (multi) q.answer = mark.checked ? [...new Set([...q.answer, k])].sort((a, b) => a - b) : q.answer.filter((x) => x !== k);
      else q.answer = k;
      paint();
      touch(q);
    });
    // A text box, so a choice can hold more than one line (code, a table): Shift+Enter for a new line.
    const text = area(q, c, (v) => { q.choices[k] = v; }, { rows: 1, class: 'input qe-area qe-choice-text', placeholder: `Choice ${k + 1}`, 'aria-label': `Choice ${k + 1}`, spellcheck: 'true' });
    text.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const atTop = !text.value.slice(0, text.selectionStart).includes('\n');
      const atEnd = !text.value.slice(text.selectionEnd).includes('\n');
      if (e.key === 'Enter' && e.shiftKey) return; // a new line in this choice
      if (e.key === 'Enter') {
        e.preventDefault();
        if (k + 1 < q.choices.length && !q.choices[k + 1].trim()) focusChoice(k + 1);
        else if (!full) { editChoices(q, (r) => r.splice(k + 1, 0, { text: '', on: false })); focusChoice(k + 1); }
      } else if (e.key === 'Backspace' && !text.value && q.choices.length > 2) {
        e.preventDefault();
        editChoices(q, (r) => r.splice(k, 1));
        focusChoice(Math.max(0, k - 1));
      } else if (e.key === 'ArrowDown' && atEnd && k + 1 < q.choices.length) { e.preventDefault(); focusChoice(k + 1); } else if (e.key === 'ArrowUp' && atTop && k > 0) { e.preventDefault(); focusChoice(k - 1); }
    });
    // A pasted list becomes one choice per line; pasted code or a table stays in this choice. A pasted
    // image goes in as Markdown.
    text.addEventListener('paste', (e) => {
      const img = [...(e.clipboardData.files || [])].find((x) => /^image\//.test(x.type));
      if (img) { e.preventDefault(); addInlineImage(text, img); return; }
      const raw = e.clipboardData.getData('text') || '';
      if (/```|^\s*\|.*\|\s*$|^(\t| {2,})\S/m.test(raw)) return;
      const lines = raw.split(/\r?\n/).map((l) => l.trim().replace(/^(?:[-*•]|\(?[A-Ha-h1-8][.)])\s+/, '')).filter(Boolean);
      if (lines.length < 2) return;
      e.preventDefault();
      editChoices(q, (r) => {
        const fresh = lines.map((t) => ({ text: t, on: false }));
        const empty = !text.value.trim();
        const at = empty ? k : k + 1;
        r.splice(at, empty ? 1 : 0, ...fresh);
        // the new rows take the place of the empty ones below
        for (let spare = fresh.length - (empty ? 1 : 0), j = at + fresh.length; spare > 0 && r[j] && !r[j].text.trim(); spare--) r.splice(j, 1);
        for (let i = r.length - 1; i >= 0 && r.length > 8; i--) if (!r[i].text.trim()) r.splice(i, 1);
        r.length = Math.min(r.length, 8);
      });
      focusChoice(Math.min(k + lines.length, q.choices.length - 1));
    });
    // Drag the grip, or focus it and use the arrow keys.
    const grip = h('button', { class: 'qe-grip', type: 'button', title: 'Drag, or use ↑ ↓, to move', 'aria-label': `Move choice ${k + 1}` }, icon(ICONS.grip, 18));
    grip.addEventListener('keydown', (e) => {
      const to = e.key === 'ArrowUp' ? k - 1 : e.key === 'ArrowDown' ? k + 1 : -1;
      if (to < 0 || to >= q.choices.length || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      editChoices(q, (r) => r.splice(to, 0, r.splice(k, 1)[0]));
      const g = ed.pane.querySelectorAll('.qe-choice .qe-grip')[to];
      if (g) g.focus();
    });
    return h('div', { class: 'qe-choice qe-choice-row' }, grip, h('label', { class: 'qe-mark', title: 'Correct' }, mark, h('span', { class: 'qe-mark-text', text: 'Correct' })), VAR_TYPES.has(q.type) ? withValues(text, q) : text,
      xBtn('Remove choice', () => editChoices(q, (r) => r.splice(k, 1)), q.choices.length <= 2));
  });
  // The right answer stands out: its row is marked, and says so
  const paint = () => rows.forEach((row, k) => row.classList.toggle('right', multi ? q.answer.includes(k) : q.answer === k));
  paint();
  sortable(rows, (from, to) => editChoices(q, (r) => r.splice(to, 0, r.splice(from, 1)[0])), (row) => row.firstChild);
  const add = h('button', { class: 'btn small', type: 'button', text: 'Add choice', disabled: full, onclick: () => { editChoices(q, (r) => r.push({ text: '', on: false })); focusChoice(q.choices.length - 1); } });
  const label = h('h2', { class: 'qe-card-title', id: `qe-choices-${q._ui ? q._ui.id || 'q' : 'q'}`, text: 'Choices' });
  return h('div', { class: 'qe-stack qe-tight' }, label,
    h('div', { class: 'qe-choices', role: 'group', 'aria-labelledby': label.id }, rows),
    h('div', { class: 'qe-line' }, add, check(q, q.shuffleChoices === false, 'Keep choices in this order', (v) => { if (v) q.shuffleChoices = false; else delete q.shuffleChoices; }),
      q.type === 'multi' ? (() => {
        const pc = check(q, !!q.partialCredit, 'Partial credit', (v) => { if (v) q.partialCredit = true; else delete q.partialCredit; });
        return tip(pc, pc.querySelector('input'), "Each correct choice a student picks earns its share of the points, and each wrong choice takes a share away.");
      })() : null));
}

// ---------- images ----------
// A diagram that can't be used says why (svg.js), here rather than on save.
function svgRefused(f, dataUrl) {
  if (extOf(f.name) !== '.svg') return false;
  let why;
  try { why = window.BQSvg.problem(decodeURIComponent(escape(atob(String(dataUrl).split(',')[1])))); } catch (e) { why = "can't be read."; }
  if (why) window.BQAsk.notice({ title: "That diagram can't be used", text: `It ${why}` });
  return !!why;
}
function addImage(q, f) {
  if (!f) return;
  if (!IMAGE_MIME[extOf(f.name)]) { window.BQAsk.notice({ title: "That image can't be used", text: 'Images must be png, jpg, gif, webp or svg.' }); return; }
  if (f.size > 5 * 1024 * 1024) { window.BQAsk.notice({ title: 'That image is too big', text: 'Images can be up to 5 MB.' }); return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (svgRefused(f, reader.result)) return;
    const base = f.name.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(-80);
    // The file for a missing image takes that image's name, so the pasted quiz.json still points at it.
    let p2 = q.image && imageMissing(q.image) && extOf(q.image) === extOf(base) ? q.image : `assets/${base}`;
    for (let n = 2; p2 !== q.image && (ed.existingAssets.has(p2) || ed.newAssets[p2]); n++) p2 = `assets/${base.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
    ed.newAssets[p2] = String(reader.result).split(',')[1];
    q.image = p2;
    touch(q);
    renderPane();
  };
  reader.readAsDataURL(f);
}
const assetSrc = (p) => (ed.newAssets[p] ? `data:${IMAGE_MIME[extOf(p)]};base64,${ed.newAssets[p]}`
  : ed.existingAssets.has(p) && ed.assetQuizId ? `/api/t/quizzes/${encodeURIComponent(ed.assetQuizId)}/asset?path=${encodeURIComponent(p)}` : null);
const imageSrc = (q) => assetSrc(q.image);
// More images go into the text as Markdown, ![](assets/name.png), at the cursor.
function addInlineImage(ta, f) {
  if (!f) return;
  if (!IMAGE_MIME[extOf(f.name)]) { window.BQAsk.notice({ title: "That image can't be used", text: 'Images must be png, jpg, gif, webp or svg.' }); return; }
  if (f.size > 5 * 1024 * 1024) { window.BQAsk.notice({ title: 'That image is too big', text: 'Images can be up to 5 MB.' }); return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (svgRefused(f, reader.result)) return;
    const base = f.name.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.-]/g, '_').slice(-80);
    let p2 = `assets/${base}`;
    for (let n = 2; ed.existingAssets.has(p2) || ed.newAssets[p2]; n++) p2 = `assets/${base.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
    ed.newAssets[p2] = String(reader.result).split(',')[1];
    insert(ta, `![](${p2})`);
  };
  reader.readAsDataURL(f);
}
function imageEditor(q, file) {
  if (!q.image) return null;
  const src = imageSrc(q);
  const pick = h('button', { class: 'btn small', type: 'button', text: src ? 'Replace' : 'Add the file', onclick: () => file.click() });
  return h('div', { class: 'qe-image' },
    src ? h('img', { class: 'qe-thumb', src, alt: q.imageAlt || '' }) : h('p', { class: 't-error t-small', text: `${q.image} is missing.` }),
    h('div', { class: 'qe-image-side' },
      field('Image description', input(q, q.imageAlt, (v) => { q.imageAlt = v; }, { placeholder: 'For students who can\'t see the image' })),
      h('div', { class: 'qe-line' }, pick, h('button', { class: 'btn small', type: 'button', text: 'Remove image', onclick: () => { delete q.image; delete q.imageAlt; touch(q); renderPane(); } }))));
}

export { addImage, addInlineImage, assetSrc, choicesEditor, imageEditor, imageSrc };
