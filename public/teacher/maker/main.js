// The quiz maker: build a quiz question by question, with a live preview of what students see. It saves the
// same quiz.json format as an upload. Each part is a module in this folder; this one opens it.

import { ICONS, api, bar, h, icon, mount } from '../dash/core.js';
import { guard } from '../dash/home.js';
import { ed } from './state.js';
import { TYPES } from './formats.js';
import { withUi } from './model.js';
import { ALT, MOD } from './editing.js';
import { touch } from './core.js';
import { addDivider, renderPane } from './pane.js';
import { addQuestion, select } from './outline.js';
import { closeAdd, items, leave, leaveOk, onKey, onUnload, save } from './save.js';

async function showQuizEditor(id, preset) {
  ed.id = id; ed.preset = preset;
  ed.quiz = undefined;
  ed.currentId = ed.id;
  ed.existingAssets = new Set(); // images already stored with the quiz being edited
  ed.assetQuizId = ed.id;
  ed.newAssets = {}; // assets/<name> -> base64, added here and sent on save
  if (ed.id) {
    let src;
    try { src = await api(`/api/t/quizzes/${encodeURIComponent(ed.id)}/source`); } catch (e) { return; }
    ed.quiz = src.quiz;
    ed.existingAssets = new Set(src.assets);
  }
  if (ed.preset) ed.quiz = ed.preset.quiz;
  if (!ed.quiz) ed.quiz = { format: 1, title: '', timeLimitMin: 20, language: 'java', shuffleQuestions: true, shuffleChoices: true, questions: [] };
  ed.quiz.questions.forEach(withUi);
  // Section dividers: here each sits at a place in the list (before question number at+1), so moving a question
  // across one moves it into that section. Saved as the id of the question each starts at (collect).
  ed.quiz.sections = (ed.quiz.sections || []).map((sec) => Object.assign({ at: ed.quiz.questions.findIndex((q) => q.id === sec.before), title: sec.title || '', directions: sec.directions || '', timeLimitMin: sec.timeLimitMin || 0 }, sec.calculator ? { calculator: sec.calculator } : {}))
    .filter((d) => d.at >= 0).sort((a, b) => a.at - b.at);

  ed.sel = ed.quiz.questions.length ? 0 : -1; // -1 is Settings
  ed.selDiv = null; // the section divider that's open, if any
  ed.dirty = !!ed.preset;
  ed.edits = 0;
  ed.saving = false;
  ed.tried = false; // Save was pressed with problems left: show them
  ed.removed = null; // the last deleted question, for Undo
  ed.paneTick = null; // repaints the live parts of the open question
  ed.problems = [];
  ed.fromServer = new WeakMap(); // question -> what the server said about it

  ed.status = h('span', { class: 't-small qe-status', role: 'status' });
  ed.globalMsg = h('pre', { class: 't-error t-problems', role: 'alert' });
  ed.total = h('p', { class: 't-small t-muted qe-total' });
  ed.outline = h('ol', { class: 'qe-outline' });
  ed.undoRow = h('p', { class: 't-small qe-undo' });
  ed.pane = h('main', { class: 'qe-pane' });
  ed.wantSettings = false; // Settings asked for, on a quiz with no questions yet
  ed.settingsBtn = h('button', { class: 'qe-settings', type: 'button', text: 'Settings', onclick: () => { ed.wantSettings = true; select(-1); } });
  ed.queued = false;
  ed.saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Save', title: `${MOD}S`, onclick: () => save() });
  ed.previewBtn = h('button', { class: 'btn', type: 'button', text: 'Preview' });
  ed.previewBtn.addEventListener('click', async () => {
    const w = window.open('about:blank', '_blank'); // open now: after the save, a popup blocker would stop it
    const saved = ed.dirty || !ed.currentId ? await save() : ed.currentId;
    if (saved && w) w.location = `/teacher/preview.html?quiz=${encodeURIComponent(saved)}`;
    else if (w) w.close();
  });

  ed.title = h('input', { class: 'input qe-title', value: ed.quiz.title || '', placeholder: 'Quiz title', 'aria-label': 'Title', maxlength: '120' });
  ed.title.addEventListener('input', () => { ed.quiz.title = ed.title.value; touch(); });
  ed.keys = [[`${MOD}Enter`, 'New question'], [`${ALT}↑ ↓`, 'Previous, next question'], [`${ALT}Shift+↑ ↓`, 'Move question'], ['Enter', 'Next choice'], ['Esc, then Tab', 'Leave a code box'], [`${MOD}S`, 'Save']];
  // Adding: one button, and the kinds of question in a menu under it
  ed.addBtn = h('button', { class: 'btn qe-add-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon(ICONS.plus, 16), 'Add question');
  ed.addMenu = h('div', { class: 'qe-add-menu', role: 'menu', 'aria-label': 'Add question', hidden: true },
    Object.keys(TYPES).map((t) => h('button', { class: 'qe-add-item', type: 'button', role: 'menuitem', 'data-add': t, onclick: () => { closeAdd(); addQuestion(t); } }, icon(ICONS[t], 16), h('span', { text: TYPES[t] }))),
    h('button', { class: 'qe-add-item qe-add-section', type: 'button', role: 'menuitem', 'data-add': 'section', title: 'Starts a section at the open question', disabled: !ed.quiz.questions.length,
      onclick: () => { closeAdd(); addDivider(); } }, icon(ICONS.section, 16), h('span', { text: 'Section divider' })));
  ed.addBtn.addEventListener('click', () => {
    const open = ed.addMenu.hidden;
    ed.addMenu.hidden = !open;
    ed.addBtn.setAttribute('aria-expanded', String(open));
    ed.addMenu.querySelector('.qe-add-section').disabled = !ed.quiz.questions.length;
    if (open) items()[0].focus();
  });
  ed.addMenu.addEventListener('keydown', (e) => {
    const list = items();
    const k = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeAdd(true); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(k + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1].focus(); }
  });
  document.addEventListener('click', function outside(e) {
    if (!ed.root.isConnected) { document.removeEventListener('click', outside); return; }
    if (!ed.addMenu.hidden && !ed.addMenu.contains(e.target) && !ed.addBtn.contains(e.target)) closeAdd();
  });
  // On a phone the list folds up over the open question: a bar says how many there are
  ed.sideBody = h('div', { class: 'qe-side-body' }, ed.settingsBtn, ed.total, ed.outline, ed.undoRow,
    h('div', { class: 'qe-add' }, ed.addBtn, ed.addMenu),
    h('details', { class: 'qe-keys t-small' }, h('summary', { text: 'Shortcuts' }),
      h('dl', {}, ed.keys.map(([k, what]) => [h('dt', { text: k }), h('dd', { text: what })]))));
  ed.sideToggle = h('button', { class: 'qe-side-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'qe-side-body' },
    h('span', { class: 'qe-side-toggle-text', text: 'Questions' }), icon(ICONS.chevron, 18));
  ed.sideBody.id = 'qe-side-body';
  ed.side = h('nav', { class: 'qe-side', 'aria-label': 'Questions' }, ed.sideToggle, ed.sideBody);
  ed.sideToggle.addEventListener('click', () => { const open = !ed.side.classList.contains('open'); ed.side.classList.toggle('open', open); ed.sideToggle.setAttribute('aria-expanded', String(open)); });
  ed.root = h('div', { class: 'qe' },
    h('div', { class: 'qe-bar' }, ed.title, h('span', { class: 'qe-grow' }), ed.status, ed.previewBtn, ed.saveBtn),
    ed.globalMsg,
    h('div', { class: 'qe-body' }, ed.side, ed.pane));
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  mount(bar(h('button', { class: 't-link t-back', type: 'button', onclick: leave }, icon(ICONS.back, 16), 'Quizzes')), ed.root);
  // The browser's Back button asks too.
  guard(leaveOk);
  renderPane();
  if (!ed.id && !ed.preset) ed.title.focus();
}

export { showQuizEditor };
