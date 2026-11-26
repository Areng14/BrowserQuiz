// The teacher's Watch page: the student's screen, followed as it changes.

import { S } from './state.js';
import { h } from './dom.js';
import { isDark, onThemeChange } from './theme.js';
import { partOf, restoreAnswers } from './answers.js';
import { disposeEditor, renderQuestion } from './quiz.js';
import { renderScratch } from './scratch.js';
import { addHighlight, marksIn, rangeAt } from './marks.js';
import { openNavigator } from './nav.js';
import { hideFsOverlay, openExit, openSubmit, showFsOverlay, showLeftWarning, submittingOverlay } from './overlays.js';
import { DONE, screenDone } from './done.js';

function watchView(v, answers, extra) {
  if (!S || !S.el || !S.quiz) return false;
  // Turned in: the screen they got, confetti and all
  if (v && v.done) {
    S.done = true;
    clearInterval(S.timer);
    disposeEditor();
    screenDone(DONE[v.done] ? v.done : 'submitted');
    return { where: 'Turned in' };
  }
  let redraw = false;
  let padDraw = false;
  const q = S.quiz.questions[S.idx];
  // Their sample runs' results, and their scratchpad pages
  if (extra && extra.runs && JSON.stringify(extra.runs) !== S.watchRuns) {
    S.watchRuns = JSON.stringify(extra.runs);
    S.results = JSON.parse(S.watchRuns);
    if (q && (q.type === 'code' || q.type === 'fill')) redraw = true;
  }
  if (extra && extra.pages) { S.scratch.pages = extra.pages; padDraw = true; }
  if (answers) {
    const text = JSON.stringify(answers);
    if (text !== S.watchAnswers) {
      const before = S.answers;
      S.watchAnswers = text;
      S.answers = restoreAnswers(answers);
      // Code goes into the editor's model as it is; anything else is redrawn.
      for (const x of S.quiz.questions) {
        if (x.type !== 'code') { if (x === q && JSON.stringify(before[x.id]) !== JSON.stringify(S.answers[x.id])) redraw = true; continue; }
        const a = S.answers[x.id];
        if (!a) continue;
        for (const l of x.languages) {
          const m = S.models[x.id + ':' + l];
          if (m && !m.isDisposed() && m.getValue() !== a.code[l]) m.setValue(a.code[l]);
        }
      }
      if (q && q.type === 'code' && !S.editor) redraw = true; // the plain box
    }
  }
  if (v && v.marks && JSON.stringify(v.marks) !== JSON.stringify(S.marks)) { S.marks = v.marks; redraw = true; }
  if (v) {
    const i = v.q ? S.quiz.questions.findIndex((x) => x.id === v.q) : -1;
    if (v.review) {
      if (!S.reviewOpen) { S.reviewOpen = true; S.dirOpen = false; redraw = true; }
    } else if (i >= 0 && (S.reviewOpen || S.idx !== i || S.dirOpen !== v.dir || S.introOpen !== v.intro)) {
      Object.assign(S, { reviewOpen: false, idx: i, dirOpen: v.dir, introOpen: v.intro });
      redraw = true;
    }
    const cq = S.quiz.questions[S.idx];
    if (v.lang && cq && cq.type === 'code' && S.answers[cq.id] && S.answers[cq.id].language !== v.lang && cq.languages.includes(v.lang)) {
      S.answers[cq.id].language = v.lang;
      redraw = true;
    }
  }
  if (v && typeof v.dark === 'boolean' && v.dark !== isDark()) { // their light or dark
    document.documentElement.dataset.theme = v.dark ? 'dark' : 'light';
    onThemeChange();
  }
  if (v && v.deadline !== undefined) S.deadline = v.deadline || 0; // extra time
  if (v && v.paused !== undefined && (v.paused || 0) !== (S.pausedAt || 0)) { // the teacher paused the quiz, or went on
    if (!!v.paused !== !!S.pausedAt) redraw = true;
    S.pausedAt = v.paused || 0;
  }
  if (v && v.partEnds) S.partEnds = v.partEnds;
  if (v && typeof v.phone === 'boolean' && v.phone !== !!S.watchPhone) { S.watchPhone = v.phone; redraw = true; } // their plain code box
  if (v && S.scratch && typeof v.tool === 'string' && v.tool !== S.scratch.tool) { S.scratch.tool = v.tool; padDraw = true; }
  if (v && S.el.scratch && S.el.scratch.hidden === !!v.pad) { // the scratchpad opened or closed
    S.el.scratch.hidden = !v.pad;
    S.el.wrap.classList.toggle('with-scratch', !!v.pad);
    S.el.scratchBtn.setAttribute('aria-pressed', String(!!v.pad));
    if (S.editor) S.editor.layout();
    padDraw = true;
  }
  if (v && S.el.save && v.save !== undefined && v.save !== S.watchSave) { // Saved / Saving… / Not saved yet
    S.watchSave = v.save;
    S.el.save.textContent = v.save === 'saved' ? 'Saved' : v.save === 'saving' ? 'Saving…' : v.save === 'offline' ? 'Not saved yet' : '';
    S.el.save.classList.toggle('bad', v.save === 'offline');
  }
  if (redraw) renderQuestion();
  else if (padDraw) renderScratch();
  if (v && v.hl) watchHighlights(v.hl);
  if (v) watchModal(v.modal);
  if (v && v.fs && !S.el.fsOverlay) showFsOverlay();
  else if (v && !v.fs && S.el.fsOverlay) hideFsOverlay();
  if (v) watchToast(v.toast);
  if (v && v.ed) watchEditor(v.ed);
  if (v) {
    S.el.main.scrollTop = v.scroll || 0;
    S.el.wrap.scrollTop = v.wscroll || 0;
    const open = S.el.wrap.querySelector('.nav-pop');
    if (v.nav && !open) openNavigator();
    else if (!v.nav && open) open.remove();
  }
  const total = S.quiz.questions.length;
  return { where: S.pausedAt ? 'Paused' : S.reviewOpen ? 'Check your work' : S.dirOpen ? (S.introOpen ? 'Directions' : partOf(S.idx).title) : `Question ${S.idx + 1} of ${total}` };
}
// Their highlights, put on the same text here
function watchHighlights(hl) {
  for (const [key, node] of S.kept) {
    const want = hl[key] || [];
    if (JSON.stringify(marksIn(node)) === JSON.stringify(want)) continue;
    for (const m of [...node.querySelectorAll('mark.hl')]) { const parent = m.parentNode; m.replaceWith(...m.childNodes); parent.normalize(); }
    for (const [a, b, st] of want) {
      const r = rangeAt(node, a, b);
      if (!r.collapsed && node.contains(r.startContainer) && node.contains(r.endContainer)) addHighlight(r, true, st);
    }
  }
}
function watchToast(text) {
  let t = S.el.wrap.querySelector('.toast');
  if (!text) { if (t) t.remove(); return; }
  if (!t) { t = h('div', { class: 'toast' }); S.el.wrap.append(t); }
  if (t.textContent !== text) t.textContent = text;
}
// Their code editor: scrolled where theirs is, with their cursor and selection drawn in
function watchEditor(ed) {
  if (!S.editor || !window.monaco) return;
  S.editor.setScrollTop(ed.top || 0);
  S.editor.setScrollLeft(ed.left || 0);
  const m = window.monaco;
  const model = S.editor.getModel();
  const marks = [];
  if (ed.sel) {
    const [al, ac, pl, pc] = ed.sel;
    if (al !== pl || ac !== pc) marks.push({ range: new m.Range(al, ac, pl, pc), options: { className: 'watch-sel' } });
    marks.push({ range: new m.Range(pl, pc, pl, pc), options: { beforeContentClassName: 'watch-caret' } });
  }
  if (S.watchDecs && S.watchDecs.model !== model && !S.watchDecs.model.isDisposed()) S.watchDecs.model.deltaDecorations(S.watchDecs.ids, []);
  const ids = model.deltaDecorations(S.watchDecs && S.watchDecs.model === model ? S.watchDecs.ids : [], marks);
  S.watchDecs = { model, ids };
}
// The dialog they have open, if it's one of these
function watchModal(id) {
  const show = { 'submit-title': openSubmit, 'turnin-title': submittingOverlay, 'exit-title': openExit, 'left-title': showLeftWarning };
  const want = typeof id === 'string' && show[id] ? id : null;
  const open = S.el.wrap.querySelector('.modal-backdrop:not(.nav-pop)');
  const title = open && open.querySelector('[aria-labelledby]');
  const now = title ? title.getAttribute('aria-labelledby') : null;
  if (now === want) return;
  if (open) { open.remove(); for (const el of S.el.wrap.children) el.inert = false; }
  if (want && !S.el.wrap.querySelector('.modal-backdrop')) show[want]();
}

export { watchView };
