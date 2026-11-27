// Random values, made friendly. A table of them, a column per value and a row per student, and {{name}}
// in the question's text shown as a tag; typing {{ (or Value in the prompt's toolbar) offers the values,
// and Preview shows the question as each row makes it. quiz.json still holds {{name}} and a list of rows
// (server: quizfile.js checkVars), so quizzes an AI writes don't change.

import { ICONS, h, icon, tip } from '../dash/core.js';
import { ed } from './state.js';
import { grow, insert } from './editing.js';

const REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g; // to find them all
const HAS = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/; // to ask if there's one (a /g regex remembers where it got to)
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;
const MAX_ROWS = 30;
const MAX_VALUES = 10;
const namesOf = (q) => (Array.isArray(q.vars) && q.vars[0] ? Object.keys(q.vars[0]) : []);
const listOf = (q, n) => (q.vars || []).map((r) => r[n]).filter((v) => v !== '' && v != null).join(', ');
// every {{name}} the question's text uses (its rows and the editor's own state aside)
function usedNames(q) {
  const used = new Set();
  const scan = (v) => {
    if (typeof v === 'string') for (const m of v.matchAll(REF)) used.add(m[1]);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'vars' && k !== '_ui') scan(x);
  };
  scan(q);
  return used;
}
// What's wrong with a question's random values (core.js problemsOf)
function valueProblems(q) {
  const names = namesOf(q);
  const used = usedNames(q);
  const out = [];
  if (names.length) {
    if (q.vars.length < 2) out.push('Random values need at least 2 rows.');
    if (!used.size) out.push('Nothing uses the random values yet. Type {{ in the question to put one in.');
  }
  for (const n of used) if (!names.includes(n)) out.push(names.length ? `{{${n}}} isn't one of the random values.` : `{{${n}}} needs a column of that name under Random values.`);
  return out;
}

// Everything showing values repaints when the table changes (a name, a row).
const changed = () => document.dispatchEvent(new Event('qe-values'));
const onChange = (el, fn) => {
  const run = () => { if (!el.isConnected) { document.removeEventListener('qe-values', run); return; } fn(); };
  document.addEventListener('qe-values', run);
};

// ---------- a tag: a value's name, its values on hover ----------
function tagEl(q, name, big) {
  const known = namesOf(q).includes(name);
  return h('span', { class: `qe-tag${big ? ' big' : ''}${known ? '' : ' bad'}`, title: known ? `${name}: ${listOf(q, name)}` : `${name} isn't one of the random values`, text: name });
}
// {{name}} in rendered text (the prompt's read view, Preview) as tags; text inside math is left alone
function tagsIn(root, q) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (HAS.test(n.data) && !n.parentElement.closest('.katex')) hits.push(n);
  for (const n of hits) {
    const parts = [];
    let at = 0;
    for (const m of n.data.matchAll(REF)) {
      if (m.index > at) parts.push(n.data.slice(at, m.index));
      parts.push(tagEl(q, m[1]));
      at = m.index + m[0].length;
    }
    parts.push(n.data.slice(at));
    n.replaceWith(...parts);
  }
  return root;
}

// ---------- a text box that shows its values as tags ----------
// A layer over the box draws its text: each {{name}} a tag when the box isn't being edited, and while it
// is, the same text with the braces faded and the name marked (no change in width, so the cursor stays
// where it is). Typing {{ opens a list of the values.
function withValues(ta, q) {
  const layer = h('div', { class: 'qe-vlayer', 'aria-hidden': 'true' });
  const wrapEl = h('div', { class: 'qe-vwrap' }, ta, layer);
  const pieces = (editing) => {
    const names = namesOf(q);
    const v = ta.value;
    const out = [];
    let at = 0;
    for (const m of v.matchAll(REF)) {
      if (m.index > at) out.push(v.slice(at, m.index));
      if (editing) {
        const i = m[0].indexOf(m[1]);
        out.push(h('span', { class: `qe-vref${names.includes(m[1]) ? '' : ' bad'}` },
          h('span', { class: 'qe-vbrace', text: m[0].slice(0, i) }), m[1], h('span', { class: 'qe-vbrace', text: m[0].slice(i + m[1].length) })));
      } else out.push(tagEl(q, m[1]));
      at = m.index + m[0].length;
    }
    out.push(v.slice(at) + '\n'); // a last empty line keeps its height
    return out;
  };
  const paint = () => {
    const has = HAS.test(ta.value);
    wrapEl.classList.toggle('has-values', has);
    if (!has) { layer.replaceChildren(); return; }
    const cs = getComputedStyle(ta);
    layer.style.padding = cs.padding;
    layer.style.borderWidth = cs.borderWidth;
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle']) layer.style[k] = cs[k];
    layer.style.lineHeight = cs.lineHeight;
    layer.style.letterSpacing = cs.letterSpacing;
    layer.replaceChildren(...pieces(document.activeElement === ta));
  };
  // where the cursor is on screen: the text before it, then a mark, measured in the layer
  const caretAt = () => {
    const mark = h('span', { text: '​' });
    const keep = [...layer.childNodes];
    const cls = layer.className;
    layer.className = 'qe-vlayer qe-vmeasure';
    layer.replaceChildren(ta.value.slice(0, ta.selectionStart), mark);
    const r = mark.getBoundingClientRect();
    layer.replaceChildren(...keep);
    layer.className = cls;
    return r;
  };
  ['input', 'focus', 'blur'].forEach((e) => ta.addEventListener(e, paint));
  onChange(wrapEl, paint);
  requestAnimationFrame(paint);
  offerValues(ta, q, caretAt);
  return wrapEl;
}

// ---------- the list of values: typing {{, or Value in the toolbar ----------
let openMenu = null; // the one list open, closed by the next
function valueMenu(q, at, onPick, filter) {
  if (openMenu) openMenu.close();
  const names = namesOf(q).filter((n) => !filter || n.toLowerCase().startsWith(filter.toLowerCase()));
  if (!names.length) return null;
  let active = 0;
  const id = `qe-vmenu-${Date.now()}`;
  const opts = names.map((n, i) => {
    const li = h('li', { class: 'qe-vopt', role: 'option', id: `${id}-${i}` }, tagEl(q, n), h('span', { class: 'qe-vsample', text: listOf(q, n) }));
    li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
    li.addEventListener('mousemove', () => setActive(i));
    return li;
  });
  const list = h('ul', { class: 'qe-vmenu', role: 'listbox', id, 'aria-label': 'Random values' }, opts);
  document.body.append(list);
  // under the cursor (or the button), kept on screen
  const m = list.getBoundingClientRect();
  list.style.left = `${Math.max(8, Math.min(at.left, innerWidth - m.width - 8))}px`;
  list.style.top = `${at.bottom + 6 + m.height > innerHeight ? Math.max(8, at.top - m.height - 6) : at.bottom + 6}px`;
  function setActive(i) {
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === active)));
  }
  function pick(i) { const n = names[i]; close(); onPick(n); }
  function close() { list.remove(); if (openMenu === api) openMenu = null; removeEventListener('scroll', close, true); removeEventListener('resize', close); }
  // keys from the box (or the button) that opened it
  const key = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(active + (e.key === 'ArrowDown' ? 1 : -1)); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); return true; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
    return false;
  };
  addEventListener('scroll', close, true);
  addEventListener('resize', close);
  setActive(0);
  const api = { close, key, id, activeId: () => opts[active].id };
  openMenu = api;
  return api;
}
function offerValues(ta, q, caretAt) {
  let menu = null;
  const shut = () => { if (menu) menu.close(); menu = null; ta.removeAttribute('aria-activedescendant'); ta.setAttribute('aria-expanded', 'false'); };
  ta.setAttribute('aria-autocomplete', 'list');
  ta.setAttribute('aria-expanded', 'false');
  const look = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
    if (!m || ta.selectionStart !== ta.selectionEnd || !namesOf(q).length) { shut(); return; }
    const start = m.index;
    menu = valueMenu(q, caretAt(), (n) => {
      const after = ta.value.slice(ta.selectionStart);
      const close = /^\s*\}\}/.exec(after);
      ta.setSelectionRange(start, ta.selectionStart + (close ? close[0].length : 0));
      insert(ta, `{{${n}}}`);
      shut();
    }, m[1]);
    if (!menu) { shut(); return; }
    ta.setAttribute('aria-expanded', 'true');
    ta.setAttribute('aria-controls', menu.id);
    ta.setAttribute('aria-activedescendant', menu.activeId());
  };
  ta.addEventListener('input', look);
  ta.addEventListener('keydown', (e) => {
    if (menu && menu.key(e)) { e.stopImmediatePropagation(); if (menu) ta.setAttribute('aria-activedescendant', menu.activeId()); }
  }, true);
  ta.addEventListener('blur', shut);
}
// Value, in the prompt's toolbar: the list under the button, the pick put in where the cursor was. With
// no values yet, it opens Random values with a first one to name.
function valueButton(q, ta) {
  const btn = h('button', { class: 'qe-tool qe-vtool', type: 'button', title: 'Put a random value where the cursor is' }, icon(ICONS.braces, 14), 'Value');
  let where = null;
  btn.addEventListener('mousedown', (e) => { if (document.activeElement === ta) { where = [ta.selectionStart, ta.selectionEnd]; e.preventDefault(); } });
  btn.addEventListener('click', () => {
    if (!namesOf(q).length) {
      const more = ed.pane && ed.pane.querySelector('.qe-more');
      if (more) more.open = true;
      const add = ed.pane && ed.pane.querySelector('.qe-vadd-value');
      if (add) add.click();
      return;
    }
    const sel = where || [ta.value.length, ta.value.length];
    where = null;
    const menu = valueMenu(q, btn.getBoundingClientRect(), (n) => { ta.focus(); ta.setSelectionRange(sel[0], sel[1]); insert(ta, `{{${n}}}`); });
    if (!menu) return;
    const keys = (e) => { if (!menu.key(e)) return; e.stopPropagation(); };
    btn.addEventListener('keydown', keys);
    const done = () => { btn.removeEventListener('keydown', keys); };
    setTimeout(() => addEventListener('mousedown', () => { menu.close(); done(); }, { once: true }));
  });
  return btn;
}

// ---------- the table ----------
// Renaming a value renames it in the question too: every box showing it, and the question itself.
function renameRefs(q, from, to) {
  const re = new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, 'g');
  const fix = (v) => (typeof v === 'string' ? v.replace(re, `{{${to}}}`) : Array.isArray(v) ? v.map(fix)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'vars' || k === '_ui' ? x : fix(x)])) : v);
  for (const [k, v] of Object.entries(q)) if (k !== 'vars' && k !== '_ui') q[k] = fix(v);
  // the boxes on screen, each through its own input handler, so it saves where it belongs
  if (ed.pane) for (const box of ed.pane.querySelectorAll('textarea')) {
    const next = box.value.replace(re, `{{${to}}}`);
    if (next !== box.value) { box.value = next; box.dispatchEvent(new Event('input', { bubbles: true })); }
  }
}
function valuesEditor(q, touch, md) {
  const root = h('div', { class: 'field qe-values' });
  const title = h('span', { class: 'field-label qe-term', tabindex: '0', text: 'Random values' });
  const count = h('span', { class: 't-small t-muted' });
  const head = h('div', { class: 'qe-line qe-values-head' }, tip(h('span', { class: 't-tip-host' }, title), title,
    'Each student gets one row, picked at random. Type {{ in the question, or press Value above the prompt, to put a value in.'), h('span', { class: 'qe-grow' }), count);
  const body = h('div', { class: 'qe-values-body' });
  const preview = previewOf(q, md);
  const edit = (fn, focus) => { fn(); touch(q); draw(); changed(); preview.draw(); if (focus) { const el = root.querySelector(focus); if (el) { el.focus(); if (el.select) el.select(); } } };
  const freeName = () => { const used = new Set(namesOf(q)); return 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !used.has(c)) || `v${used.size + 1}`; };
  const addValue = () => edit(() => {
    const n = freeName();
    if (!namesOf(q).length) q.vars = [{ [n]: '' }, { [n]: '' }]; // the server wants 2 rows at least
    else q.vars.forEach((r) => { r[n] = ''; });
  }, `.qe-vname[data-name="${namesOf(q).length}"]`);
  function draw() {
    const names = namesOf(q);
    count.textContent = names.length ? `${q.vars.length} row${q.vars.length === 1 ? '' : 's'}` : '';
    const addV = h('button', { class: 'btn small t-ib qe-vadd-value', type: 'button', disabled: names.length >= MAX_VALUES, onclick: addValue }, icon(ICONS.plus, 14), 'Value');
    if (!names.length) { body.replaceChildren(addV); preview.el.hidden = true; return; }
    preview.el.hidden = false;
    // each column as wide as its longest value (within reason); the table scrolls sideways past that
    const width = (n) => Math.max(5, Math.min(28, Math.max(n.length + 2, ...q.vars.map((r) => String(r[n] == null ? '' : r[n]).length + 2))));
    const nameCell = (n, c) => {
      const el = h('input', { class: 'input qe-vname', value: n, size: '1', 'data-name': String(c), 'aria-label': `Name of value ${c + 1}`, spellcheck: 'false', autocomplete: 'off', maxlength: '20' });
      el.addEventListener('input', () => { el.value = el.value.replace(/[^A-Za-z0-9_]/g, '_'); el.setCustomValidity(''); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } else if (e.key === 'Escape') { el.value = n; el.blur(); } });
      el.addEventListener('change', () => {
        const to = el.value.trim();
        if (to === n) return;
        if (!NAME.test(to) || names.includes(to)) {
          el.setCustomValidity(names.includes(to) ? `There's already a value called ${to}.` : 'A name starts with a letter, then letters, digits or _.');
          el.reportValidity();
          el.value = n;
          return;
        }
        edit(() => {
          q.vars = q.vars.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k === n ? to : k, v])));
          renameRefs(q, n, to);
        });
      });
      const del = h('button', { class: 'qe-vdel', type: 'button', 'aria-label': `Remove value ${n}`, title: `Remove ${n}`,
        onclick: () => edit(() => { q.vars.forEach((r) => { delete r[n]; }); if (!namesOf(q).length) delete q.vars; }) }, icon(ICONS.x, 14));
      return h('th', { scope: 'col', style: `min-width: calc(${width(n)}ch + 46px)` }, h('div', { class: 'qe-vhead-cell' }, el, del));
    };
    const rows = q.vars.map((r, i) => h('tr', {},
      h('td', { class: 'qe-vrow num t-muted', text: String(i + 1) }),
      names.map((n, c) => {
        const el = h('input', { class: 'input qe-vcell', value: r[n] == null ? '' : String(r[n]), size: '1', 'aria-label': `${n}, row ${i + 1}`, 'data-cell': `${i},${c}`, maxlength: '200' });
        el.addEventListener('input', () => { r[n] = el.value; touch(q); changed(); preview.draw(); });
        el.addEventListener('keydown', (e) => {
          // Enter goes down a row, adding one at the bottom, as in a spreadsheet
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (i + 1 < q.vars.length) root.querySelector(`[data-cell="${i + 1},${c}"]`).focus();
          else if (q.vars.length < MAX_ROWS) edit(() => q.vars.push(Object.fromEntries(names.map((x) => [x, '']))), `[data-cell="${i + 1},${c}"]`);
        });
        return h('td', {}, el);
      }),
      h('td', { class: 'qe-vend' }, h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': `Remove row ${i + 1}`, title: 'Remove row',
        onclick: () => edit(() => { q.vars.splice(i, 1); if (!q.vars.length) delete q.vars; }) }, icon(ICONS.x, 14)))));
    const addRow = h('button', { class: 'btn small t-ib', type: 'button', disabled: q.vars.length >= MAX_ROWS,
      onclick: () => edit(() => q.vars.push(Object.fromEntries(names.map((x) => [x, '']))), `[data-cell="${q.vars.length},0"]`) }, icon(ICONS.plus, 14), 'Add row');
    body.replaceChildren(
      h('div', { class: 'qe-vtable-wrap' }, h('table', { class: 'qe-vtable' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'qe-vrow' }, h('span', { class: 'sr-only', text: 'Row' })), names.map(nameCell), h('th', { scope: 'col', class: 'qe-vend' }, addV))),
        h('tbody', {}, rows))),
      h('div', {}, addRow));
  }
  draw();
  root.append(head, body, preview.el);
  return root;
}

// ---------- Preview: the question as one row makes it ----------
const MARK_A = '';
const MARK_B = '';
function previewOf(q, md) {
  let row = 0;
  const label = h('span', { class: 'qe-vstep t-small', 'aria-live': 'polite' });
  const prev = h('button', { class: 'btn small t-icon-only t-ib', type: 'button', 'aria-label': 'Previous row', onclick: () => { row--; draw(); } }, icon(ICONS.prev, 16));
  const next = h('button', { class: 'btn small t-icon-only t-ib', type: 'button', 'aria-label': 'Next row', onclick: () => { row++; draw(); } }, icon(ICONS.next, 16));
  const out = h('div', { class: 'qe-vpreview' });
  const el = h('div', { class: 'qe-vpreview-wrap' }, h('div', { class: 'qe-line' }, h('span', { class: 'field-label qe-grow', text: 'Preview' }), prev, label, next), out);
  // the values marked (outside math, where a mark would break the formula), then drawn as Markdown
  const fill = (text, r) => String(text || '').replace(REF, (m, n) => (Object.hasOwn(r, n) ? `${MARK_A}${r[n]}${MARK_B}` : m))
    .replace(/\$[^$]*\$/g, (s) => s.replace(/[]/g, ''));
  const marked = (node) => {
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[]/.test(n.data)) hits.push(n);
    for (const n of hits) {
      const parts = n.data.split(/([^]*)/).map((p) => (p[0] === MARK_A && p.endsWith(MARK_B) ? h('span', { class: 'qe-filled', text: p.slice(1, -1) }) : p.replace(/[]/g, '')));
      n.replaceWith(...parts);
    }
    return node;
  };
  const render = (text, r, cls) => marked(h('div', { class: cls }, md(fill(text, r))));
  function draw() {
    const rows = Array.isArray(q.vars) ? q.vars : [];
    if (!rows.length) { out.replaceChildren(); return; }
    row = (row + rows.length) % rows.length;
    const r = rows[row];
    label.textContent = `Row ${row + 1} of ${rows.length}`;
    const parts = [render(q.prompt, r, 'prompt qe-vprompt')];
    if (Array.isArray(q.choices) && (q.type === 'single' || q.type === 'multi')) {
      const right = new Set([].concat(q.answer == null ? [] : q.answer));
      parts.push(h('ul', { class: 'qe-vchoices' }, q.choices.map((c, k) => h('li', { class: right.has(k) ? 'right' : '' },
        render(c, r, 'qe-vchoice'), right.has(k) ? h('span', { class: 'qe-vright', text: 'Correct' }) : null))));
    } else if (Array.isArray(q.answer) && q.answer.some((a) => String(a).trim())) {
      parts.push(h('p', { class: 'qe-vanswer' }, h('span', { class: 't-muted', text: 'Answer: ' }), marked(h('span', { text: fill(q.answer.filter((a) => String(a).trim()).join(' · '), r) }))));
    }
    if (q.explanation) parts.push(render(q.explanation, r, 'qe-vexplain'));
    out.replaceChildren(...parts);
  }
  // the question changes as it's written: redraw a moment after
  let timer = 0;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (el.isConnected) draw(); else document.removeEventListener('input', soon); }, 200); };
  document.addEventListener('input', soon);
  draw();
  return { el, draw };
}

export { tagsIn, usedNames, valueButton, valueProblems, valuesEditor, withValues };
