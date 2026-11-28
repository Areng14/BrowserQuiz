// The quiz maker: the whole quiz as one list, a row a question with its answer, the one being edited open in
// its place. It saves the same quiz.json format as an upload. Each part is a module in this folder; this one
// opens it.

import { ICONS, api, bar, h, icon, iconButton, labeled, mount } from '../dash/core.js';
import { guard, shell } from '../dash/home.js';
import { ed } from './state.js';
import { dash } from '../dash/state.js';
import { TYPES } from './formats.js';
import { withUi } from './model.js';
import { ALT, MOD } from './editing.js';
import { touch } from './core.js';
import { addDivider, openAi, renderPane } from './pane.js';
import { addQuestion, closeOpen, select, settingsOpen } from './outline.js';
import { closeAdd, items, leave, leaveOk, onKey, onUnload, save } from './save.js';

async function showQuizEditor(id, preset) {
  const seq = ++dash.navSeq; // a page still loading doesn't land on top of the maker, nor the maker on a newer page
  ed.id = id; ed.preset = preset;
  ed.quiz = undefined;
  ed.currentId = ed.id;
  ed.existingAssets = new Set(); // images already stored with the quiz being edited
  ed.assetQuizId = ed.id;
  ed.newAssets = {}; // assets/<name> -> base64, added here and sent on save
  if (ed.id) {
    let src;
    try { src = await api(`/api/t/quizzes/${encodeURIComponent(ed.id)}/source`); } catch (e) {
      // deleted, or an old link: say so in Quizzes instead of a blank page (unless another page was asked for since)
      if (e.message !== 'login' && seq === dash.navSeq) mount(shell('quizzes', h('section', { class: 't-section' }, h('p', { class: 't-error', text: e.message }))));
      return;
    }
    if (seq !== dash.navSeq) return;
    ed.quiz = src.quiz;
    ed.existingAssets = new Set(src.assets);
  }
  if (ed.preset) ed.quiz = ed.preset.quiz;
  if (!ed.quiz) ed.quiz = { format: 1, title: '', timeLimitMin: 20, language: 'java', shuffleQuestions: true, shuffleChoices: true, questions: [] };
  ed.quiz.questions.forEach(withUi);
  // The languages this server's code runner has (null: not known), for the code questions' language menu
  ed.runnerLangs = null;
  api('/api/t/runner').then((r) => { ed.runnerLangs = r.languages; }).catch(() => {});
  // Section dividers: here each sits at a place in the list (before question number at+1), so moving a question
  // across one moves it into that section. Saved as the id of the question each starts at (collect).
  ed.quiz.sections = (ed.quiz.sections || []).map((sec) => Object.assign({ at: ed.quiz.questions.findIndex((q) => q.id === sec.before), title: sec.title || '', directions: sec.directions || '', timeLimitMin: sec.timeLimitMin || 0 }, sec.calculator ? { calculator: sec.calculator } : {}))
    .filter((d) => d.at >= 0).sort((a, b) => a.at - b.at);

  ed.sel = -1; // the selected question; -1 is Settings
  ed.selDiv = null; // the section divider that's open, if any
  ed.closed = true; // nothing open: the quiz opens as its list of rows
  ed.aiOpen = false; // the "From an AI" card belongs to the quiz it was opened in
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
  ed.total = h('span', { class: 't-small t-muted qe-total' });
  ed.outline = h('ol', { class: 'qe-outline', 'aria-label': 'Questions' });
  ed.undoRow = h('span', { class: 't-small qe-undo' });
  ed.pane = h('main', { class: 'qe-list tk-scope' });
  ed.wantSettings = false; // Settings asked for, on a quiz with no questions yet
  ed.settingsBtn = iconButton(h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', onclick: () => {
    if (settingsOpen()) { closeOpen(); return; }
    ed.wantSettings = true;
    select(-1);
  } }), 'sliders', 'Quiz settings'); // "Settings" alone is the teacher's own (dash/settings.js)
  ed.queued = false;
  ed.saveBtn = labeled(h('button', { class: 'btn primary', type: 'button', title: `${MOD}S`, onclick: () => save() }), 'check', 'Save');
  ed.previewBtn = iconButton(h('button', { class: 'btn', type: 'button' }), 'eye', 'Preview');
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
  ed.addBtn = h('button', { class: 'qe-add-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon(ICONS.plus, 16), 'Add question', icon(ICONS.chevron, 16));
  ed.addMenu = h('div', { class: 'qe-add-menu', role: 'menu', 'aria-label': 'Add question', hidden: true },
    Object.keys(TYPES).map((t) => h('button', { class: 'qe-add-item', type: 'button', role: 'menuitem', 'data-add': t, onclick: () => { closeAdd(); addQuestion(t); } }, icon(ICONS[t], 16), h('span', { text: TYPES[t] }))),
    h('hr', { class: 'qe-add-sep', role: 'separator' }),
    h('button', { class: 'qe-add-item', type: 'button', role: 'menuitem', 'data-add': 'ai', onclick: () => { closeAdd(); openAi(); } }, icon(ICONS.spark, 16), h('span', { text: 'From an AI' })),
    h('button', { class: 'qe-add-item qe-add-section', type: 'button', role: 'menuitem', 'data-add': 'section', title: 'Starts a section at the open question', disabled: !ed.quiz.questions.length,
      onclick: () => { closeAdd(); addDivider(); } }, icon(ICONS.section, 16), h('span', { text: 'Section divider' })),
    h('button', { class: 'qe-add-item', type: 'button', role: 'menuitem', 'data-add': 'paste', onclick: () => {
      closeAdd();
      ed.wantSettings = true;
      select(-1);
      const d = ed.settingsDlg && ed.settingsDlg.querySelector('.qe-paste-json');
      if (d) { d.open = true; d.querySelector('textarea').focus(); }
    } }, icon(ICONS.copy, 16), h('span', { text: 'Paste a quiz.json' })));
  ed.addBtn.addEventListener('click', () => {
    const open = ed.addMenu.hidden;
    ed.addMenu.hidden = !open;
    ed.addBtn.setAttribute('aria-expanded', String(open));
    ed.addMenu.querySelector('.qe-add-section').disabled = !ed.quiz.questions.length;
    if (open) { ed.addMenu.scrollIntoView({ block: 'nearest' }); items()[0].focus(); }
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
  ed.addWrap = h('div', { class: 'qe-add' }, ed.addBtn, ed.addMenu);
  ed.keysEl = h('details', { class: 'qe-keys t-small' }, h('summary', { text: 'Shortcuts' }),
    h('dl', {}, ed.keys.map(([k, what]) => [h('dt', { text: k }), h('dd', { text: what })])));
  ed.bar = h('div', { class: 'qe-bar' }, ed.title, ed.total, h('span', { class: 'qe-grow' }), ed.undoRow, ed.status, ed.settingsBtn, ed.previewBtn, ed.saveBtn);
  ed.root = h('div', { class: 'qe' }, ed.bar, ed.globalMsg, ed.pane);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  mount(bar(h('button', { class: 't-link t-back', type: 'button', onclick: leave }, icon(ICONS.back, 16), 'Quizzes')), ed.root);
  // The browser's Back button asks too.
  guard(leaveOk);
  renderPane();
  if (!ed.id && !ed.preset) ed.title.focus();
}

export { showQuizEditor };
