// The quiz screen: its bars, and drawing the question that's open.

import { BQ, S, cfg, root } from './state.js';
import { h, mount, toast } from './dom.js';
import { icon, themeButton } from './theme.js';
import { colorize } from './syntax.js';
import { buildParts, isAnswered, lockIcon, mmss, partLeft, partNow, partOf, pausedView, timedNav } from './answers.js';
import { directionsView, renderScratch, scratchGrip, toggleScratch } from './scratch.js';
import { highlightBar, sharedBlock } from './marks.js';
import { basicView, essayView, fillView, outputView, traceView, whyBox } from './views.js';
import { codeView, confirmFinishParts } from './code.js';
import { gameIcon, openGame, openNavigator, renderSheet, reviewView, startTimer } from './nav.js';
import { openExit, openSubmit, quizKeys, timedExam } from './overlays.js';
import { graphView, mathView } from './mathq.js';

// ---------- quiz ----------
function screenQuiz() {
  S.parts = buildParts(S.quiz.questions);
  S.idx = 0;
  if (timedNav()) S.locked = Math.max(S.locked || 0, partNow() - 1); // parts whose time ran out meanwhile
  // back after a reload in a quiz with locked parts: start at the first part that isn't done
  const open = lockOn() && S.locked ? S.parts.find((p) => p.n > S.locked) : null;
  if (open) { S.idx = open.start; S.introOpen = false; for (const p of S.parts) if (p.n <= S.locked) S.partsSeen.add(p.n); }
  S.dirOpen = true;
  if (!open) S.introOpen = true; // the first page also shows what's on the quiz and its directions
  // back after a reload, or Exit then Continue, in this tab: the question they were on, if they still can
  const back = placeKept();
  if (back) { S.idx = back.idx; for (const n of back.seen) S.partsSeen.add(n); S.introOpen = false; S.dirOpen = !S.partsSeen.has(partOf(S.idx).n); }
  const timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
  const save = h('span', { class: 'save-state' }); // not a live region: it flips with every keystroke
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const conn = h('div', { class: 'conn-banner', role: 'alert', hidden: true },
    'Offline. Keep working, answers save when you reconnect.');
  const main = h('main', { class: 'qmain', tabindex: '-1', 'aria-labelledby': 'q-heading' });
  // "Question 3 of 20" opens every question; the review page lists them all before turning in.
  const jump = h('button', { class: 'btn q-jump', type: 'button', 'aria-haspopup': 'dialog', onclick: () => openNavigator() });
  // On a timed exam's review page, where there's nothing to turn in yet: snake, while they wait
  const gameBtn = h('button', { class: 'btn game-btn', type: 'button', hidden: true, onclick: () => openGame() }, gameIcon(), 'Play snake');
  const mid = h('div', { class: 'qnav-mid' }, jump, gameBtn);
  const prev = h('button', { class: 'btn', type: 'button', text: 'Back', onclick: () => go(S.reviewOpen ? (timedNav() ? S.parts[partNow() - 1].end : S.quiz.questions.length - 1) : S.idx - 1) });
  const next = h('button', { class: 'btn', type: 'button' });
  next.addEventListener('click', () => {
    if (S.reviewOpen) return openSubmit();
    if (S.dirOpen) return closeDirections();
    if (S.idx === S.quiz.questions.length - 1 || (timedNav() && S.idx === partOf(S.idx).end)) return openReview();
    go(S.idx + 1);
  });
  const hlBar = highlightBar();
  main.addEventListener('mouseup', () => setTimeout(hlBar.update, 0));
  main.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') hlBar.update(); });
  main.addEventListener('scroll', hlBar.hide, { passive: true });
  const scratchBtn = h('button', { class: 'icon-btn scratch-btn', type: 'button', title: 'Scratchpad', 'aria-pressed': 'false', 'aria-controls': 'scratch', onclick: () => toggleScratch() }, icon('pencil', 16), h('span', { class: 'icon-label', text: 'Scratchpad' }));
  const scratch = h('aside', { class: 'scratch', id: 'scratch', 'aria-label': 'Scratchpad' });
  scratch.hidden = true;
  // A calculator, on the questions that allow one (calculator.js; its maths loads the first time it's
  // opened). Each question says which: its own, its part's or the quiz's (renderQuestion sets it), and the
  // button is greyed out on the others. No question with one: no button at all.
  const calcKinds = S.quiz.questions.map((x) => x.calculator).filter(Boolean);
  const calc = calcKinds.length && window.BQCalculator && !cfg.watch
    ? window.BQCalculator.create({ kind: calcKinds.includes('graphing') ? 'graphing' : 'scientific', base: cfg.vendorBase || '/vendor/', host: () => (S.el ? S.el.wrap : root), dock: () => S.el && S.el.main, onError: () => toast('The calculator did not load. Check the connection and try again.') })
    : null;
  const wrap = h('div', { class: 'quiz' },
    // Title, name and save state | timer, centered | tools
    h('header', { class: 'qbar' },
      h('div', { class: 'qbar-side' },
        h('span', { class: 'qbar-name' }, h('span', { class: 'qbar-title', text: S.quiz.title }),
          S.me && S.me.name && (!cfg.preview || cfg.watch) ? h('span', { class: 'qbar-who', title: 'Signed in as', text: S.me.name }) : null),
        save),
      timer,
      h('div', { class: 'qbar-side qbar-end' }, calc ? calc.button : null, scratchBtn, themeButton(),
        // no Exit in Safe Exam Browser with our settings: there's nowhere to go until they turn in
        (cfg.preview && !cfg.watch) || (S.run && S.run.sebQuit) ? null
          : h('button', { class: 'icon-btn exit-btn', type: 'button', title: 'Exit', onclick: () => openExit() }, icon('exit', 16), h('span', { class: 'icon-label', text: 'Exit' })))),
    conn,
    main,
    scratch,
    h('footer', { class: 'qnav' }, prev, mid, next),
    live, hlBar.bar);
  S.el = { wrap, main, timer, jump, prev, next, save, conn, scratch, scratchBtn, calc, live, hlBar, fsOverlay: null, scratchGrip: scratchGrip(wrap, scratch), gameBtn, nav: wrap.querySelector('.qnav') };
  wrap.addEventListener('scroll', hlBar.hide, { passive: true }); // a short window scrolls the whole quiz
  document.addEventListener('keydown', quizKeys); // a listener added twice is still one
  S.saveState = 'saved';
  mount(wrap);
  renderQuestion();
  startTimer();
}

// Locked parts (quiz.lockParts): going on to a later part finishes every part before it, for good, once
// they say so. The server keeps those answers as they were. Not while a teacher watches.
function lockOn() { return !!(S.quiz && S.quiz.lockParts && !cfg.watch); }
function lockedAt(i) { return lockOn() && S.locked > 0 && !!partOf(i) && partOf(i).n <= S.locked; }
function go(i) {
  if (i < 0 || i >= S.quiz.questions.length || lockedAt(i)) return;
  if (timedNav() && partOf(i).n > partNow()) return; // a timed part opens when the one before runs out
  const done = lockOn() ? partOf(i).n - 1 : 0;
  if (done > S.locked) return confirmFinishParts(done, () => goNow(i));
  goNow(i);
}
function goNow(i) {
  S.reviewOpen = false;
  S.idx = i;
  S.dirOpen = !S.partsSeen.has(partOf(i).n);
  renderQuestion();
  toTop();
  S.el.main.focus({ preventScroll: true });
}
// A new page of the quiz opens at its top: the question's own scroll, and in a short window (a phone held
// sideways, a page zoomed in) the whole quiz's, which scrolls as one there (app.css).
function toTop() {
  S.el.main.scrollTop = 0;
  S.el.wrap.scrollTop = 0;
}
// Every question at a glance before turning in (Bluebook's "Check your work").
function openReview() {
  S.reviewOpen = true;
  S.dirOpen = false;
  renderQuestion();
  toTop();
  const head = document.getElementById('q-heading');
  if (head) head.focus({ preventScroll: true });
}
function openDirections() {
  S.dirOpen = true;
  renderQuestion();
  toTop();
  S.el.main.focus({ preventScroll: true });
}
function closeDirections() {
  S.partsSeen.add(partOf(S.idx).n);
  S.timeUpFor = 0;
  S.dirOpen = false;
  S.introOpen = false;
  renderQuestion();
  toTop();
  S.el.main.focus({ preventScroll: true });
}

function disposeEditor() {
  S.editorSubs.splice(0).forEach((d) => d && d.dispose && d.dispose());
  if (S.editor) { S.editor.dispose(); S.editor = null; }
  if (S.monitor) S.monitor.selectionProvider = null;
}

// A timed exam turns in by itself when time is up: no turning in early (extra time can, after the normal time)
function reviewButtons() {
  // timed parts, before the last one: the next part opens when this one's time is up
  if (timedNav() && partNow() < S.parts.length) {
    const n = partNow();
    S.el.next.replaceChildren(`Part ${n + 1} in`, h('span', { class: 'np-left', text: mmss(partLeft(n)) }));
    S.el.next.className = 'btn primary';
    S.el.next.disabled = true;
    S.el.gameBtn.hidden = !(!cfg.watch && BQ.snake);
    snakeLock();
    return;
  }
  const locked = timedExam();
  S.el.next.textContent = locked ? 'Turns in when time is up' : 'Submit';
  S.el.next.className = locked ? 'btn' : 'btn success'; // finishing: green
  S.el.next.disabled = locked;
  S.el.gameBtn.hidden = !(locked && !cfg.watch && BQ.snake);
  snakeLock();
}
// Snake waits until every question they can still change is answered (the review page above says how
// many are): a lock where the snake goes. Parts that are locked, or not open yet, don't count.
function snakeLock() {
  const left = S.quiz.questions.filter((q, i) => !lockedAt(i) && (!timedNav() || partOf(i).n === partNow()) && !isAnswered(q)).length;
  const btn = S.el.gameBtn;
  if (btn.dataset.locked === String(left > 0)) return;
  btn.dataset.locked = String(left > 0);
  btn.disabled = left > 0;
  btn.title = left > 0 ? 'Answer every question to play' : '';
  btn.replaceChildren(left > 0 ? lockIcon(16) : gameIcon(), 'Play snake');
}

// Where the student is, kept for this tab (sessionStorage) under this attempt's tag, so a reload comes back
// to it. Not a question in a part that's locked now, nor, with timed parts, one outside the part under way.
const placeKey = () => 'bq-place:' + (S.tag || '');
function keepPlace() {
  if (cfg.preview || cfg.watch || !S.tag) return;
  try { sessionStorage.setItem(placeKey(), JSON.stringify({ idx: S.idx, seen: [...S.partsSeen] })); } catch (e) { /* this page only */ }
}
function placeKept() {
  if (cfg.preview || cfg.watch || !S.tag) return null;
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(placeKey()) || 'null'); } catch (e) { return null; }
  if (!v || !Number.isInteger(v.idx) || v.idx < 0 || v.idx >= S.quiz.questions.length || !Array.isArray(v.seen)) return null;
  const n = partOf(v.idx).n;
  if (lockOn() && n <= (S.locked || 0)) return null;
  if (timedNav() && n !== partNow()) return null;
  return { idx: v.idx, seen: v.seen.filter(Number.isInteger) };
}
function renderQuestion() {
  keepPlace();
  disposeEditor();
  const q = S.quiz.questions[S.idx];
  const total = S.quiz.questions.length;
  // Paused by the teacher: no questions, no way around (the footer), no scratchpad
  const paused = !!S.pausedAt;
  S.el.nav.hidden = paused;
  S.el.scratchBtn.disabled = paused;
  if (S.el.calc) {
    S.el.calc.setDisabled(paused);
    // the question's own calculator, or none; on the review page, the quiz's
    S.el.calc.setKind(S.reviewOpen ? S.quiz.calculator || null : q.calculator || null);
  }
  if (paused) {
    document.title = `Paused - ${S.quiz.title}`;
    if (S.el.hlBar) S.el.hlBar.hide();
    S.el.main.classList.remove('code-fit', 'split-fit');
    S.el.main.replaceChildren(pausedView());
    return;
  }
  if (S.reviewOpen) {
    S.el.prev.disabled = false;
    reviewButtons();
    S.el.jump.hidden = true;
    document.title = `Check your work - ${S.quiz.title}`;
    if (S.el.hlBar) S.el.hlBar.hide();
    S.el.main.classList.remove('code-fit', 'split-fit');
    S.el.main.replaceChildren(reviewView());
    renderScratch();
    return;
  }
  S.el.jump.hidden = false;
  S.el.gameBtn.hidden = true;
  S.el.prev.disabled = S.idx === 0 || lockedAt(S.idx - 1);
  const last = S.idx === total - 1 || (timedNav() && S.idx === partOf(S.idx).end); // timed parts: each has its own review
  S.el.next.disabled = false;
  S.el.next.textContent = S.dirOpen ? 'Continue' : last ? 'Review' : 'Next';
  S.el.next.className = 'btn' + (last && !S.dirOpen ? ' primary' : '');
  const views = { code: codeView, output: outputView, trace: traceView, fill: fillView, essay: essayView, math: mathView, graph: graphView };
  // a part that opened while the page was offline: its questions come with the next heartbeat (answers.js takeParts)
  let view = S.dirOpen ? directionsView(partOf(S.idx)) : q.later ? h('div', { class: 'qview' }, h('p', { class: 'muted', role: 'status', text: 'Loading this part…' })) : (views[q.type] || basicView)(q);
  // Corrections: a "What went wrong?" box under the answer (in a code question's left column)
  if (!S.dirOpen && S.quiz.corrections && S.quiz.corrections.why && S.quiz.corrections.fix[q.id]) (view.querySelector('.code-left') || view).append(whyBox(q));
  // Shared material sits beside the question (above it on narrow screens). Code questions put it in
  // their left column themselves.
  if (!S.dirOpen && q.shared && !view.classList.contains('wide')) {
    const shared = sharedBlock(q);
    if (shared) shared.tabIndex = 0; // it scrolls on its own beside the question (app.css), so keys can scroll it too
    view = h('div', { class: 'shared-split' }, shared, view);
  }
  const where = S.dirOpen ? partOf(S.idx).title : `Question ${S.idx + 1} of ${total}${q.name ? `: ${q.name}` : ''}`;
  document.title = `${where} - ${S.quiz.title}`;
  if (S.el.hlBar) S.el.hlBar.hide();
  // Code questions and shared material fill the window, each side scrolling on its own (app.css).
  S.el.main.classList.toggle('code-fit', view.classList.contains('wide'));
  S.el.main.classList.toggle('split-fit', view.classList.contains('shared-split'));
  S.el.main.replaceChildren(...(S.dirOpen ? [] : [h('h1', { class: 'sr-only', id: 'q-heading', text: where })]), view);
  colorize(view);
  renderSheet();
  renderScratch();
}

export { closeDirections, disposeEditor, go, lockOn, lockedAt, openDirections, openReview, renderQuestion, reviewButtons, screenQuiz, toTop };
