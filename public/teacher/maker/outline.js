// The list of questions on the left: selecting, adding, duplicating, removing and moving them.

import { h, plural } from '../dash/core.js';
import { ed } from './state.js';
import { TYPES } from './formats.js';
import { blank } from './model.js';
import { snippet, sortable } from './editing.js';
import { nextId, problemsOf, touch } from './core.js';
import { renderPane, selectDivider } from './pane.js';

// ---------- the outline ----------
function renderOutline() {
  ed.problems = ed.quiz.questions.map(problemsOf);
  const kids = [];
  const rows = [];
  ed.quiz.questions.forEach((q, i) => {
    const k = ed.quiz.sections.findIndex((d) => d.at === i);
    if (k >= 0) {
      const d = ed.quiz.sections[k];
      kids.push(h('li', { class: `qe-divider${ed.selDiv === k ? ' sel' : ''}` },
        h('button', { class: 'qe-row-btn', type: 'button', 'aria-current': ed.selDiv === k ? 'true' : null, onclick: () => selectDivider(k) },
          h('span', { class: 'qe-row-text', text: d.title || `Section ${k + 1}` }))));
    }
    if (i === 0 || k >= 0 || ed.quiz.questions[i - 1].type !== q.type) kids.push(h('li', { class: 'qe-part', text: TYPES[q.type] }));
    const text = q.name || snippet(q.prompt);
    const bad = ed.problems[i].length && (ed.tried || ed.fromServer.has(q));
    const here = i === ed.sel && ed.selDiv == null;
    const row = h('li', { class: `qe-row${here ? ' sel' : ''}${bad ? ' bad' : ''}` },
      h('button', { class: 'qe-row-btn', type: 'button', 'aria-current': here ? 'true' : null, onclick: () => select(i, true) },
        h('span', { class: 'qe-row-n', text: String(i + 1) }),
        h('span', { class: `qe-row-text${text ? '' : ' t-muted'}`, text: text || 'No prompt yet' }),
        q.pool ? h('span', { class: 'qe-row-pool', text: q.pool, title: `Question pool: ${q.pool}` }) : null,
        ed.problems[i].length ? h('span', { class: 'qe-dot', title: ed.problems[i].join('\n'), role: 'img', 'aria-label': bad ? 'Has problems' : 'Not finished' }) : null,
        h('span', { class: 'qe-row-pts', text: String(Number(q.points) || 0), title: 'Points' })));
    rows.push(row);
    kids.push(row);
  });
  sortable(rows, moveQuestion);
  ed.outline.replaceChildren(...kids);
  ed.settingsBtn.classList.toggle('sel', ed.sel < 0 && ed.selDiv == null);
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
  const here = ed.selDiv != null ? (ed.quiz.sections[ed.selDiv].title || 'Section') : ed.sel >= 0 ? `Question ${ed.sel + 1} of ${ed.quiz.questions.length}` : 'Settings';
  ed.sideToggle.firstChild.textContent = here;
  ed.undoRow.replaceChildren(...(ed.removed ? [`Deleted question ${ed.removed.at + 1}. `, h('button', { class: 't-link', type: 'button', text: 'Undo', onclick: () => {
    const r = ed.removed;
    ed.removed = null;
    for (const d of ed.quiz.sections) if (r.wasStart ? d.at > r.at : d.at >= r.at) d.at++;
    ed.quiz.questions.splice(Math.min(r.at, ed.quiz.questions.length), 0, r.q);
    touch();
    select(ed.quiz.questions.indexOf(r.q));
  } })] : []));
}

function select(i, focus) {
  ed.selDiv = null;
  ed.sel = Math.max(-1, Math.min(ed.quiz.questions.length - 1, i));
  renderPane();
  const top = ed.root.getBoundingClientRect().top + window.scrollY;
  if (window.scrollY > top) window.scrollTo(0, top);
  const row = ed.outline.querySelector('.sel');
  if (row) row.scrollIntoView({ block: 'nearest' });
  if (focus) { const p = ed.pane.querySelector('#qe-prompt'); if (p) p.focus({ preventScroll: true }); }
  // Narrow screens fold the list up over the question
  if (matchMedia('(max-width: 1000px)').matches) { ed.side.classList.remove('open'); ed.sideToggle.setAttribute('aria-expanded', 'false'); }
}
// New questions go next to their own kind, so each type stays one part of the quiz.
function addQuestion(type) {
  const cur = ed.quiz.questions[ed.sel];
  const like = cur && cur.type === type ? cur : null;
  // After the last of its kind, or else where its part belongs: multiple choice first, written answers last.
  const order = Object.keys(TYPES);
  const rank = order.indexOf(type);
  let at = ed.sel + 1;
  if (!like) { at = 0; ed.quiz.questions.forEach((q, i) => { if (order.indexOf(q.type) <= rank) at = i + 1; }); }
  const q = blank(type, like ? { id: nextId(), points: like.points, mode: type === 'code' ? like.mode : null, languages: like.languagesAny ? 'any' : like.languages && like.languages.slice(), language: like.language } : { id: nextId() });
  if (like && like.shuffleChoices === false) q.shuffleChoices = false;
  for (const d of ed.quiz.sections) if (d.at >= at) d.at++; // a new question joins the section of the one before it
  ed.quiz.questions.splice(at, 0, q);
  ed.removed = null;
  touch();
  select(at, true);
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
  select(ed.quiz.questions.length ? Math.min(i, ed.quiz.questions.length - 1) : -1);
}
function moveQuestion(from, to) {
  if (to < 0 || to >= ed.quiz.questions.length || from === to) return;
  const cur = ed.quiz.questions[ed.sel];
  const active = document.activeElement;
  const keep = ed.pane.contains(active) && active.id ? active.id : null;
  // One step at the edge of a section crosses the divider: the question changes section and stays put,
  // instead of jumping over its neighbor. (Not when it's a section's only question.)
  const at = (i) => ed.quiz.sections.find((d) => d.at === i);
  const crossUp = to === from - 1 && at(from) && !at(from + 1) && from + 1 < ed.quiz.questions.length;
  const crossDown = to === from + 1 && at(to) && !at(from);
  if (crossUp) at(from).at = from + 1;
  else if (crossDown) at(to).at = from;
  else ed.quiz.questions.splice(to, 0, ed.quiz.questions.splice(from, 1)[0]);
  ed.sel = ed.quiz.questions.indexOf(cur);
  ed.removed = null;
  touch();
  renderPane();
  if (keep) { const el = ed.pane.querySelector(`#${keep}`); if (el) el.focus({ preventScroll: true }); }
}

export { addQuestion, duplicate, moveQuestion, remove, renderOutline, select };
