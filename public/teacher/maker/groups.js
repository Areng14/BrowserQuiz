// Question pools and shared material as boxes in the question list. A pool's questions sit in one box
// whose heading says everything about it (its name, how many each student gets, the points each is worth);
// shared material shows in a box with the questions that use it. A question joins from its ⋯ menu or by
// being dragged between two of a box's questions, and leaves the same way. The quiz.json is unchanged:
// questions keep "pool" and "shared", and "pools" says how many (server: quizfile.js).

import { ICONS, h, icon, plural } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { ed } from './state.js';
import { grow } from './editing.js';
import { area, touch } from './core.js';
import { addImage, addInlineImage, assetSrc, imageEditor } from './choices.js';
import { colorIn } from './colors.js';

const POOL_NAME = /[^A-Za-z0-9_-]/g; // what a pool's name can't have (quizfile.js QID)
const firstShared = (q) => [].concat(q.shared || [])[0] || null;
const materialOf = (id) => (ed.quiz.shared || []).find((m) => m.id === id);
const titleOf = (m) => (m.title || '').trim() || `Shared material ${(ed.quiz.shared || []).indexOf(m) + 1}`;
const membersOf = (pool) => ed.quiz.questions.filter((x) => x.pool === pool);
const poolNames = () => [...new Set(ed.quiz.questions.map((x) => x.pool).filter(Boolean))];

// ---------- moving a question to its box ----------
// Takes the question at `from` out and puts it at `to` (an index once it's out), keeping sections right:
// it joins the section of the question before it.
function relocate(from, to) {
  const qs = ed.quiz.questions;
  if (ed.quiz.sections.some((d) => d.at === from + 1)) ed.quiz.sections = ed.quiz.sections.filter((d) => d.at !== from); // its section had only it
  for (const d of ed.quiz.sections) if (d.at > from) d.at--;
  const q = qs.splice(from, 1)[0];
  for (const d of ed.quiz.sections) if (d.at >= to && to > 0) d.at++;
  qs.splice(to, 0, q);
  ed.quiz.sections = ed.quiz.sections.filter((d) => d.at < qs.length);
}
// Moves questions (in order) after the last of the others that share their key: a pool's, or a material's
function gather(list, keyOf) {
  const qs = ed.quiz.questions;
  const key = keyOf(list[0]);
  if (!key) return;
  for (const q of list) {
    let last = -1;
    qs.forEach((x, k) => { if (x !== q && keyOf(x) === key && (!list.includes(x) || list.indexOf(x) < list.indexOf(q))) last = k; });
    if (last < 0) continue;
    const from = qs.indexOf(q);
    relocate(from, from < last ? last : last + 1);
  }
}
const poolKey = (q) => q.pool || null;
const done = (q) => { touch(q); ed.sel = ed.quiz.questions.indexOf(q); };

// ---------- pools ----------
function joinPool(q, name) {
  const others = membersOf(name);
  q.pool = name;
  if (others.length) q.points = others[0].points;
  ed.quiz.pools = Object.assign({}, ed.quiz.pools);
  if (ed.quiz.pools[name] == null) ed.quiz.pools[name] = 1;
  // a pool's questions use the same shared material, so the pool stays in one box
  const like = others[0];
  if (like) { const ids = [].concat(like.shared || []); if (ids.length) q.shared = ids.length === 1 ? ids[0] : ids.slice(); else delete q.shared; }
  gather([q], poolKey);
  done(q);
}
function newPool(q) {
  const used = new Set(poolNames());
  const name = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || `P${used.size + 1}`;
  joinPool(q, name);
  ed.focusPool = name;
}
function leavePool(q) {
  const name = q.pool;
  delete q.pool;
  if (!membersOf(name).length && ed.quiz.pools) delete ed.quiz.pools[name];
  else if (ed.quiz.pools && ed.quiz.pools[name] > membersOf(name).length) ed.quiz.pools[name] = membersOf(name).length;
  // out of the box: after its last question
  const qs = ed.quiz.questions;
  let last = -1;
  qs.forEach((x, k) => { if (x.pool === name) last = k; });
  const from = qs.indexOf(q);
  if (last > from) relocate(from, last);
  done(q);
}
function breakUp(name) {
  for (const x of membersOf(name)) delete x.pool;
  if (ed.quiz.pools) delete ed.quiz.pools[name];
  touch();
}

// ---------- shared material ----------
const withPool = (q) => (q.pool ? membersOf(q.pool) : [q]);
function useMaterial(q, id) {
  const group = withPool(q);
  const first = ![].concat(q.shared || []).length;
  for (const x of group) { const list = [].concat(x.shared || []); x.shared = list.length ? [...new Set([...list, id])] : id; }
  if (first) gather(group, firstShared);
  done(q);
}
function newMaterial(q) {
  ed.quiz.shared = ed.quiz.shared || [];
  let n = ed.quiz.shared.length + 1;
  while (ed.quiz.shared.some((m) => m.id === `s${n}`)) n++;
  ed.quiz.shared.push({ id: `s${n}`, title: '', text: '' });
  ed.editMaterial = `s${n}`;
  useMaterial(q, `s${n}`);
}
function dropMaterial(x, id) {
  const list = [].concat(x.shared || []).filter((y) => y !== id);
  if (!list.length) delete x.shared; else x.shared = list.length === 1 ? list[0] : list;
}
function stopMaterial(q, id) {
  for (const x of withPool(q)) dropMaterial(x, id);
  done(q);
}
async function removeMaterial(m) {
  const users = ed.quiz.questions.filter((x) => [].concat(x.shared || []).includes(m.id));
  if (!(await window.BQAsk.confirm({ title: `Remove ${titleOf(m)}?`, text: users.length ? `Its ${plural(users.length, 'question')} stay, without it.` : null, ok: 'Remove', danger: true }))) return;
  for (const x of users) { const list = [].concat(x.shared).filter((y) => y !== m.id); if (!list.length) delete x.shared; else x.shared = list.length === 1 ? list[0] : list; }
  ed.quiz.shared = ed.quiz.shared.filter((x) => x !== m);
  touch();
  ed.rerender();
}

// ---------- a question's ⋯ menu: into and out of boxes ----------
function menuItems(q, then) {
  const go = (fn) => () => { fn(); then(); };
  const items = [];
  if (q.pool) items.push({ text: `Take out of pool ${q.pool}`, onclick: go(() => leavePool(q)) });
  else {
    for (const p of poolNames()) items.push({ text: `Add to pool ${p}`, onclick: go(() => joinPool(q, p)) });
    items.push({ text: 'New pool', onclick: go(() => newPool(q)) });
  }
  const using = [].concat(q.shared || []);
  for (const id of using) { const m = materialOf(id); if (m) items.push({ text: `Stop using ${titleOf(m)}`, onclick: go(() => stopMaterial(q, id)) }); }
  if (using.length < 3) {
    for (const m of ed.quiz.shared || []) if (!using.includes(m.id)) items.push({ text: `${using.length ? 'Also use' : 'Use'} ${titleOf(m)}`, onclick: go(() => useMaterial(q, m.id)) });
    items.push({ text: 'New shared material', onclick: go(() => newMaterial(q)) });
  }
  return items;
}
// One step up or down at a box's edge crosses it, as at a section's: the question leaves its box (a pool's
// first, then its material's), or joins the box it's next to, and stays where it is. True when it did.
function crossEdge(q, from, to) {
  if (Math.abs(to - from) !== 1) return false;
  const other = ed.quiz.questions[to];
  if (!other) return false;
  const pools = ed.quiz.pools || {};
  if (q.pool && other.pool !== q.pool) {
    const name = q.pool;
    delete q.pool;
    if (pools[name] > membersOf(name).length) pools[name] = Math.max(1, membersOf(name).length);
    if (!membersOf(name).length) delete pools[name];
    return true;
  }
  if (!q.pool && firstShared(q) && firstShared(other) !== firstShared(q)) { dropMaterial(q, firstShared(q)); return true; }
  if (!q.pool && firstShared(other) && firstShared(q) !== firstShared(other)) { q.shared = firstShared(other); return true; }
  if (!q.pool && other.pool && firstShared(q) === firstShared(other)) {
    q.pool = other.pool;
    q.points = other.points;
    return true;
  }
  return false;
}
// After a question is dragged: between two of a box's questions it joins that box; away from the rest of
// its own, it leaves.
function settle(q) {
  const qs = ed.quiz.questions;
  const i = qs.indexOf(q);
  const prev = qs[i - 1];
  const next = qs[i + 1];
  const pools = ed.quiz.pools || {};
  if (q.pool && (!prev || prev.pool !== q.pool) && (!next || next.pool !== q.pool) && membersOf(q.pool).length > 1) {
    const name = q.pool;
    delete q.pool;
    if (pools[name] > membersOf(name).length) pools[name] = membersOf(name).length;
  } else if (!q.pool && prev && next && prev.pool && prev.pool === next.pool) {
    q.pool = prev.pool;
    q.points = prev.points;
  }
  const s = firstShared(q);
  const users = (id) => qs.filter((x) => firstShared(x) === id).length;
  if (s && !q.pool && (!prev || firstShared(prev) !== s) && (!next || firstShared(next) !== s) && users(s) > 1) dropMaterial(q, s);
  else if (!s && prev && next && firstShared(prev) && firstShared(prev) === firstShared(next)) q.shared = firstShared(prev);
}

// ---------- the boxes ----------
const kindLabel = (kind) => h('span', { class: 'qe-group-kind' }, icon(kind === 'pool' ? ICONS.pool : ICONS.material, 18), kind === 'pool' ? 'Pool' : 'Shared material');
const numBox = (value, label, attrs, on) => {
  const el = h('input', Object.assign({ class: 'input t-points qe-group-num', type: 'number', value: String(value), 'aria-label': label }, attrs));
  el.addEventListener('input', () => { on(el.value); touch(); });
  return el;
};
// A pool's box: its heading, then its questions (the list the caller fills)
function poolBox(name, list) {
  const members = membersOf(name);
  const nameBox = h('input', { class: 'input qe-group-name', value: name, 'aria-label': 'Pool name', maxlength: '40', spellcheck: 'false', autocomplete: 'off' });
  nameBox.addEventListener('input', () => { nameBox.value = nameBox.value.replace(POOL_NAME, '-'); nameBox.setCustomValidity(''); });
  nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameBox.blur(); } else if (e.key === 'Escape') { nameBox.value = name; nameBox.blur(); } });
  nameBox.addEventListener('change', () => {
    const to = nameBox.value.replace(/^-+|-+$/g, '');
    if (!to || to === name) { nameBox.value = name; return; }
    if (poolNames().includes(to)) { nameBox.setCustomValidity(`There's already a pool called ${to}.`); nameBox.reportValidity(); nameBox.value = name; return; }
    for (const x of members) x.pool = to;
    const pools = Object.assign({}, ed.quiz.pools);
    if (pools[name] != null) { pools[to] = pools[name]; delete pools[name]; }
    ed.quiz.pools = pools;
    touch();
    ed.rerender();
  });
  const each = Math.min(members.length, (ed.quiz.pools || {})[name] || 1);
  const count = numBox(each, 'Questions each student gets', { min: '1', max: String(members.length), step: '1' }, (v) => {
    ed.quiz.pools = Object.assign({}, ed.quiz.pools, { [name]: Math.max(1, Math.min(members.length, Math.round(Number(v)) || 1)) });
  });
  count.addEventListener('change', () => { count.value = String((ed.quiz.pools || {})[name] || 1); });
  const pts = numBox(members[0] ? members[0].points : 1, 'Points for each question in the pool', { min: '0.5', step: '0.5' }, (v) => { for (const x of members) x.points = Number(v); });
  const head = h('div', { class: 'qe-group-head' }, kindLabel('pool'), nameBox, h('span', { class: 'qe-grow' }),
    h('label', { class: 'qe-group-set' }, 'Each student gets', count, `of ${members.length}`),
    h('label', { class: 'qe-group-set' }, pts, 'pt each'),
    moreMenu(`More for pool ${name}`, `qe-pool-${name}`, [{ text: 'Break up pool', onclick: () => { breakUp(name); ed.rerender(); } }]));
  if (ed.focusPool === name) { ed.focusPool = null; requestAnimationFrame(() => { nameBox.focus(); nameBox.select(); }); }
  return h('li', { class: 'qe-group qe-pool-box', 'data-pool': name, 'aria-label': `Pool ${name}` }, head, list);
}
// Shared material's box: its heading, the material as students read it (a click edits it), its questions
function materialBox(id, list) {
  const m = materialOf(id);
  if (!m) return h('li', { class: 'qe-group' }, list);
  const users = ed.quiz.questions.filter((x) => firstShared(x) === id).length;
  const title = h('input', { class: 'input qe-group-name qe-group-title', value: m.title || '', placeholder: `Shared material ${(ed.quiz.shared || []).indexOf(m) + 1}`, 'aria-label': 'Shared material title', maxlength: '120' });
  title.addEventListener('input', () => { m.title = title.value; touch(); });
  const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  file.addEventListener('change', () => addImage(m, file.files[0]));
  const editing = ed.editMaterial === id || (!(m.text || '').trim() && !m.image);
  let body;
  if (editing) {
    const text = area(null, m.text, (v) => { m.text = v; }, { rows: 5, placeholder: 'The case, passage or code these questions use. Markdown works.', 'aria-label': `${titleOf(m)}: text` });
    const takeImage = (files, e) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); if (m.image) addInlineImage(text, f); else addImage(m, f); } };
    text.addEventListener('paste', (e) => takeImage(e.clipboardData && e.clipboardData.files, e));
    text.addEventListener('drop', (e) => takeImage(e.dataTransfer && e.dataTransfer.files, e));
    const doneBtn = h('button', { class: 'btn small', type: 'button', text: 'Done', onclick: () => { ed.editMaterial = null; ed.rerender(); } });
    body = h('div', { class: 'qe-group-material qe-stack' }, text,
      m.image ? imageEditor(m, file) : null,
      h('div', { class: 'qe-line' }, m.image ? null : h('button', { class: 'btn small', type: 'button', text: 'Add image', onclick: () => file.click() }), doneBtn), file);
    if (ed.editMaterial === id) requestAnimationFrame(() => { grow(text); if (!(m.text || '').trim()) text.focus(); });
  } else {
    const view = h('button', { class: 'qe-group-material qe-pview prompt', type: 'button', 'aria-label': `Edit ${titleOf(m)}`, onclick: () => { ed.editMaterial = id; ed.rerender(); const t = ed.pane.querySelector(`.qe-group[data-material="${id}"] textarea`); if (t) t.focus(); } });
    const md = window.BQ && window.BQ.md;
    if (m.image) view.append(h('img', { class: 'qe-group-img', src: assetSrc(m.image), alt: m.imageAlt || '' }));
    view.append(md ? md.render(m.text || '', { lang: ed.quiz.language, assetUrl: assetSrc }) : m.text || '');
    colorIn(view);
    body = view;
  }
  const head = h('div', { class: 'qe-group-head' }, kindLabel('material'), title, h('span', { class: 'qe-grow' }),
    h('span', { class: 'qe-group-count', text: plural(users, 'question') }),
    moreMenu(`More for ${titleOf(m)}`, `qe-material-${id}`, [{ text: 'Remove from quiz', danger: true, onclick: () => removeMaterial(m) }]));
  return h('li', { class: 'qe-group qe-material-box', 'data-material': id, 'aria-label': titleOf(m) }, head, body, list);
}

// On a row: the other materials a question uses (its box shows the first)
function rowNote(q) {
  const ids = [].concat(q.shared || []);
  const rest = ids.slice(1).map(materialOf).filter(Boolean);
  if (!rest.length) return null;
  return h('span', { class: 'qe-row-note', text: `Also uses ${rest.map(titleOf).join(', ')}` });
}

export { crossEdge, firstShared, materialBox, menuItems, poolBox, rowNote, settle };
