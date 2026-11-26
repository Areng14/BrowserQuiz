// The list of questions: a row for each, saying what it asks and what the answer is, and the open one
// in its place. Selecting, opening and closing, adding, duplicating, removing and moving them.

import { ICONS, h, icon, plural } from '../dash/core.js';
import { ed } from './state.js';
import { TYPES } from './formats.js';
import { blank, readCode, readTrace } from './model.js';
import { FORM_WORDS, M, answersOf, graphShapes, nextId, problemsOf, touch } from './core.js';
import { assetSrc } from './choices.js';
import { renderPane } from './pane.js';

// ---------- a question's row ----------
const md = () => window.BQ && window.BQ.md;
const mdOpts = () => ({ lang: ed.quiz.language, assetUrl: assetSrc });
// The first paragraph of some Markdown, on one line: no code, graphs or pictures
const firstPara = (src) => String(src || '').split(/\n\s*\n|```/)[0].replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
const inline = (src) => { const m = md(); return m ? m.renderInline(src, mdOpts()) : document.createTextNode(src); };
const joined = (nodes, sep) => nodes.flatMap((n, k) => (k ? [sep, n] : [n]));
const mono = (s) => h('code', { class: 'qe-row-code', text: s });
const mathOf = (src) => {
  const t = M ? M.toTex(src) : null;
  const m = md();
  return t != null && m ? h('span', { class: 'qe-math' }, m.renderInline(`$${t}$`)) : document.createTextNode(src);
};

// What the answer is, in a few words: [label, nodes], or null when there's nothing to show yet
function answerOf(q) {
  if (q.type === 'single' || q.type === 'multi') {
    const ks = q.type === 'single' ? (q.answer == null ? [] : [q.answer]) : q.answer;
    const picked = ks.map((k) => firstPara(q.choices[k])).filter(Boolean);
    return picked.length ? ['Answer', joined(picked.map(inline), '; ')] : null;
  }
  if (q.type === 'text') {
    const list = q.answer.map((a) => a.trim()).filter(Boolean);
    return list.length ? ['Answer', joined(list.map((a) => h('span', { text: a })), ', ')] : null;
  }
  if (q.type === 'math' || q.type === 'graph') {
    const list = answersOf(q);
    if (!list.length) return null;
    return ['Answer', [...joined(list.map(mathOf), ', '), q.type === 'math' && q.form ? `, ${FORM_WORDS[q.form]}` : null]];
  }
  if (q.type === 'output') {
    const out = String(q.answer || '').replace(/\s+$/, '');
    if (!out) return null;
    const lines = out.split('\n');
    return ['Prints', [mono(lines[0] + (lines.length > 1 ? ' …' : ''))]];
  }
  if (q.type === 'trace') {
    const t = readTrace(q);
    return t.columns.some(Boolean) ? ['Table', [joined(t.columns.filter(Boolean).map(mono), ', '), `, ${plural(t.rows.length, 'row')}`]] : null;
  }
  if (q.type === 'fill') {
    const list = q._ui.blanks.map((b) => b.trim()).filter(Boolean);
    return list.length ? ['Blanks', joined(list.map(mono), ', ')] : null;
  }
  if (q.type === 'code') {
    let n = 0;
    try { n = readCode(q).hidden.tests.length; } catch (e) { /* a test that doesn't read yet: its problem says so */ }
    return n ? ['Tests', [plural(n, 'hidden test')]] : null;
  }
  if (q.type === 'essay') {
    const items = (q.rubric || []).filter((x) => x.text.trim());
    return items.length ? ['Rubric', [plural(items.length, 'item')]] : null;
  }
  return null;
}
// A graph question's answer, small, next to its row
function thumbOf(q) {
  if (q.type !== 'graph' || !window.BQGraph || !M) return null;
  const g = graphShapes(q);
  if (g.problem || !g.shapes || !g.shapes.length) return null;
  try {
    const v = window.BQGraph.view({ window: q.window, step: q.step, shapes: g.shapes, label: 'Answer' });
    v.classList.add('answer');
    return h('span', { class: 'qe-gthumb', 'aria-hidden': 'true' }, v);
  } catch (e) { return null; }
}
// The row's insides, drawn again as the quiz changes (the row itself stays, so dragging keeps working)
function rowBody(i) {
  const q = ed.quiz.questions[i];
  const probs = ed.problems[i] || [];
  const shout = probs.length && (ed.tried || ed.fromServer.has(q));
  const text = q.name || firstPara(q.prompt);
  const ans = answerOf(q);
  // What's left to do shows in place of the answer, as plain words: red once Save has asked for it
  const second = probs.length && (shout || !ans)
    ? h('span', { class: `qe-row-sub ${shout ? 't-error' : 'qe-todo'}`, text: probs[0] })
    : ans ? h('span', { class: 'qe-row-sub' }, h('span', { class: 'qe-row-k', text: ans[0] }), ' ', ...ans[1].flat().filter((x) => x != null)) : null;
  return [
    h('span', { class: 'qe-grip', 'aria-hidden': 'true' }, icon(ICONS.grip, 16)),
    h('span', { class: 'qe-row-n', text: String(i + 1) }),
    h('span', { class: 'qe-row-main' },
      h('span', { class: `qe-row-text${text ? '' : ' t-muted'}` }, ...(q.name ? [q.name] : text ? [inline(text)] : ['No prompt yet'])),
      second),
    thumbOf(q),
    h('span', { class: 'qe-row-end' },
      q.pool ? h('span', { class: 'qe-row-pool', text: q.pool, title: `Question pool: ${q.pool}` }) : null,
      h('span', { class: 'qe-row-pts', text: plural(Number(q.points) || 0, 'pt') })),
  ];
}
function rowOf(i) {
  const btn = h('button', { class: 'qe-row-btn', type: 'button', onclick: () => select(i, true) }, ...rowBody(i));
  return h('li', { class: `qe-row${i === ed.sel && ed.selDiv == null ? ' sel' : ''}`, 'data-q': String(i) }, btn);
}

// ---------- after each edit: rows, totals, Undo ----------
// The open question isn't redrawn here (it's being typed in): only the rows, part totals and the bar.
function renderOutline() {
  ed.problems = ed.quiz.questions.map(problemsOf);
  for (const li of ed.outline.querySelectorAll('li.qe-row')) {
    const i = Number(li.dataset.q);
    if (!ed.quiz.questions[i] || li.contains(document.activeElement)) continue;
    li.firstChild.replaceChildren(...rowBody(i).filter(Boolean));
  }
  for (const p of ed.parts || []) p.pts.textContent = plural(Math.round(ed.quiz.questions.slice(p.from, p.to).reduce((s, x) => s + (Number(x.points) || 0), 0) * 100) / 100, 'point');
  // What each student gets: with pools, that's fewer questions than are written
  const each = { n: 0, pts: 0 };
  const pooled = new Map();
  for (const x of ed.quiz.questions) {
    if (!x.pool) { each.n++; each.pts += Number(x.points) || 0; continue; }
    const p = pooled.get(x.pool) || { n: 0, pts: Number(x.points) || 0 };
    p.n++;
    pooled.set(x.pool, p);
  }
  for (const [name, p] of pooled) { const k = Math.min(p.n, (ed.quiz.pools || {})[name] || 1); each.n += k; each.pts += k * p.pts; }
  const pts = Math.round(each.pts * 100) / 100;
  ed.total.textContent = !ed.quiz.questions.length ? '' : pooled.size
    ? `${plural(ed.quiz.questions.length, 'question')}, ${each.n} each, ${plural(pts, 'point')}`
    : `${plural(ed.quiz.questions.length, 'question')}, ${plural(pts, 'point')}`;
  ed.settingsBtn.setAttribute('aria-expanded', String(settingsOpen()));
  ed.undoRow.replaceChildren(...(ed.removed ? [`Deleted question ${ed.removed.at + 1}. `, h('button', { class: 't-link', type: 'button', text: 'Undo', onclick: () => {
    const r = ed.removed;
    ed.removed = null;
    for (const d of ed.quiz.sections) if (r.wasStart ? d.at > r.at : d.at >= r.at) d.at++;
    ed.quiz.questions.splice(Math.min(r.at, ed.quiz.questions.length), 0, r.q);
    touch();
    select(ed.quiz.questions.indexOf(r.q));
  } })] : []));
}

// ---------- open and close ----------
// One thing is open at a time: a question, a section, or Settings (ed.sel -1). Done closes it.
const settingsOpen = () => !ed.closed && ed.selDiv == null && ed.sel < 0 && (ed.quiz.questions.length > 0 || ed.wantSettings);
// Brings what's open into view, its top under the sticky bar, unless all of it is in view already
function reveal() {
  const el = ed.pane.querySelector('.qe-open');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const top = getComputedStyle(ed.bar).position === 'sticky' ? ed.bar.getBoundingClientRect().bottom : 0;
  if (r.top < top || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'start' });
}
function select(i, focus) {
  ed.selDiv = null;
  ed.aiOpen = false;
  ed.closed = false;
  ed.sel = Math.max(-1, Math.min(ed.quiz.questions.length - 1, i));
  renderPane();
  reveal();
  if (focus) { const p = ed.pane.querySelector('#qe-prompt'); if (p) p.focus({ preventScroll: true }); }
}
// Done: the open thing goes back to a row, which keeps the focus
function closeOpen() {
  const ai = ed.aiOpen;
  ed.closed = true;
  ed.aiOpen = false;
  const div = ed.selDiv;
  renderPane();
  const back = ai ? ed.pane.querySelector('.qe-add-btn, .qe-tile[data-add="ai"]') : div != null ? ed.pane.querySelector(`li.qe-divider[data-k="${div}"] button`) : ed.sel >= 0 ? ed.pane.querySelector(`li.qe-row[data-q="${ed.sel}"] button`) : ed.settingsBtn;
  if (back) back.focus({ preventScroll: true });
  const row = back && back.closest('li');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

// ---------- adding, copying, removing, moving ----------
// New questions go next to their own kind, so each type stays one part of the quiz: after the selected
// question if it's the same kind, else after the last of its kind, or where its part belongs (multiple
// choice first, written answers last).
function placeFor(type) {
  const cur = ed.quiz.questions[ed.sel];
  if (cur && cur.type === type) return ed.sel + 1;
  const order = Object.keys(TYPES);
  let at = 0;
  ed.quiz.questions.forEach((q, i) => { if (order.indexOf(q.type) <= order.indexOf(type)) at = i + 1; });
  return at;
}
function insertAt(q, at) {
  for (const d of ed.quiz.sections) if (d.at >= at) d.at++; // a new question joins the section of the one before it
  ed.quiz.questions.splice(at, 0, q);
}
function addQuestion(type) {
  const cur = ed.quiz.questions[ed.sel];
  const like = cur && cur.type === type ? cur : null;
  const at = placeFor(type);
  const q = blank(type, like ? { id: nextId(), points: like.points, mode: type === 'code' ? like.mode : null, languages: like.languagesAny ? 'any' : like.languages && like.languages.slice(), language: like.language } : { id: nextId() });
  if (like && like.shuffleChoices === false) q.shuffleChoices = false;
  insertAt(q, at);
  ed.removed = null;
  touch();
  select(at, true);
}
// Questions written somewhere else (an AI chat), each put where its kind goes; the first one opens
function insertQuestions(list) {
  for (const q of list) {
    q.id = nextId();
    const at = placeFor(q.type);
    insertAt(q, at);
    ed.sel = at;
  }
  ed.removed = null;
  touch();
  select(ed.quiz.questions.indexOf(list[0]));
}
function duplicate(i) {
  const q = JSON.parse(JSON.stringify(ed.quiz.questions[i]));
  q.id = nextId();
  for (const d of ed.quiz.sections) if (d.at >= i + 1) d.at++;
  ed.quiz.questions.splice(i + 1, 0, q);
  ed.removed = null;
  touch();
  select(i + 1, true);
}
function remove(i) {
  // A section left with no questions goes too; later dividers move up one.
  if (ed.quiz.sections.some((d) => d.at === i + 1)) ed.quiz.sections = ed.quiz.sections.filter((d) => d.at !== i);
  const wasStart = ed.quiz.sections.some((d) => d.at === i);
  for (const d of ed.quiz.sections) if (d.at > i) d.at--;
  ed.removed = { q: ed.quiz.questions.splice(i, 1)[0], at: i, wasStart };
  ed.quiz.sections = ed.quiz.sections.filter((d) => d.at < ed.quiz.questions.length);
  touch();
  ed.sel = ed.quiz.questions.length ? Math.min(i, ed.quiz.questions.length - 1) : -1;
  ed.closed = true;
  renderPane();
}
function moveQuestion(from, to) {
  if (to < 0 || to >= ed.quiz.questions.length || from === to) return;
  const cur = ed.quiz.questions[ed.sel];
  const active = document.activeElement;
  const keep = ed.pane.contains(active) && active.id ? active.id : null;
  const moved = ed.quiz.questions[from];
  // One step at the edge of a section crosses the divider: the question changes section and stays put,
  // instead of jumping over its neighbor. (Not when it's a section's only question.)
  const at = (i) => ed.quiz.sections.find((d) => d.at === i);
  const crossUp = to === from - 1 && at(from) && !at(from + 1) && from + 1 < ed.quiz.questions.length;
  const crossDown = to === from + 1 && at(to) && !at(from);
  if (crossUp) at(from).at = from + 1;
  else if (crossDown) at(to).at = from;
  else ed.quiz.questions.splice(to, 0, ed.quiz.questions.splice(from, 1)[0]);
  ed.sel = cur ? ed.quiz.questions.indexOf(cur) : ed.sel;
  ed.removed = null;
  touch();
  renderPane();
  if (keep) { const el = ed.pane.querySelector(`#${keep}`); if (el) el.focus({ preventScroll: true }); } else if (ed.closed || moved !== cur) {
    const row = ed.pane.querySelector(`li.qe-row[data-q="${ed.quiz.questions.indexOf(moved)}"] button`);
    if (row) row.focus({ preventScroll: true });
  }
}

export { addQuestion, closeOpen, duplicate, insertQuestions, moveQuestion, remove, renderOutline, reveal, rowOf, select, settingsOpen };
