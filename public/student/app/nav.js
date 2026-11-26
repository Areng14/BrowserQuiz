// Getting around: the question sheet and navigator, the review screen, the game, the timer.

import { BQ, S, cfg } from './state.js';
import { h, plural, toast } from './dom.js';
import { svgEl } from './theme.js';
import { isAnswered, mmss, nextPartRow, partNow, partTimeUp, rangeOf, serverNow, timedNav, timedParts } from './answers.js';
import { go, lockOn, lockedAt, openReview, reviewButtons } from './quiz.js';
import { isMarked } from './marks.js';
import { holdFocus, submitNow, timedExam } from './overlays.js';

// One question's number: answered, marked for review, current.
function sheetDot(q, i, onPick) {
  const done = isAnswered(q);
  const marked = isMarked(q);
  const here = i === S.idx && !S.reviewOpen; // the review page isn't on any one question
  return h('button', {
    type: 'button', class: 'sheet-dot' + (done ? ' answered' : '') + (here ? ' current' : '') + (marked ? ' marked' : ''),
    'aria-label': `Question ${i + 1}${q.name ? `, ${q.name}` : ''}${done ? ', answered' : ''}${marked ? ', marked for review' : ''}`, 'aria-current': here ? 'step' : null,
    title: q.name ? `${i + 1}. ${q.name}` : null,
    text: String(i + 1), onclick: () => onPick(i), disabled: lockedAt(i) || null,
  });
}
function renderSheet() {
  if (!S.el || !S.quiz) return;
  const n = S.quiz.questions.length;
  S.el.jump.replaceChildren(h('span', {}, h('span', { class: 'q-jump-word', text: 'Question ' }), `${S.idx + 1} of ${n}`), chevronUp());
  S.el.jump.setAttribute('aria-label', `Question ${S.idx + 1} of ${n}. Show all questions`);
}
// The key and every question by part, numbered: for the panel and the review page.
function questionGrid(onPick) {
  const legend = h('p', { class: 'nav-legend', 'aria-hidden': 'true' },
    h('span', {}, h('span', { class: 'sheet-dot mini answered' }), 'Answered'),
    h('span', {}, h('span', { class: 'sheet-dot mini marked' }), 'For review'),
    S.reviewOpen ? null : h('span', {}, h('span', { class: 'sheet-dot mini current' }), 'Current'));
  const parts = timedNav() ? [S.parts[partNow() - 1]] : S.parts && S.parts.length ? S.parts : [{ title: 'Questions', start: 0, end: S.quiz.questions.length - 1 }];
  return [legend, ...parts.map((p) => {
    const range = rangeOf(p);
    return h('section', { class: 'nav-part', 'aria-label': `${p.title}, ${range}` },
      h('h3', {}, p.title, h('span', { class: 'nav-range', text: ` ${range}` })),
      h('div', { class: 'nav-grid' }, S.quiz.questions.slice(p.start, p.end + 1).map((q, k) => sheetDot(q, p.start + k, onPick))));
  }), nextPartRow(S.reviewOpen)];
}
function reviewView() {
  const now = timedNav() ? S.parts[partNow() - 1] : null; // timed parts: this part's questions
  const qs = now ? S.quiz.questions.slice(now.start, now.end + 1) : S.quiz.questions;
  const done = qs.filter(isAnswered).length;
  const marked = qs.filter(isMarked).length;
  return h('div', { class: 'qview review' },
    h('h1', { id: 'q-heading', tabindex: '-1', text: 'Check your work' }),
    h('p', { class: 'muted', text: `${done} of ${plural(qs.length, 'question')} answered${marked ? `, ${marked} for review` : ''}.` }),
    ...questionGrid(go));
}
// Snake's icon: three linked nodes, the head filled
function snakeGlyph() {
  const glyph = svgEl('svg', { class: 'game-glyph', viewBox: '0 0 44 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'aria-hidden': 'true' });
  [[1, false], [16, false], [31, true]].forEach(([x, head]) => glyph.append(svgEl('rect', { x, y: 2, width: 12, height: 12, rx: 3, fill: head ? 'currentColor' : 'none' })));
  glyph.append(svgEl('path', { d: 'M13 8h3M28 8h3', 'stroke-linecap': 'round' }));
  return glyph;
}
// Done before time is up on a timed exam: snake (snake.js) in a dialog, while they wait. Still in the quiz.
function openGame() {
  if (S.done || !S.el || cfg.watch || !BQ.snake || (S.el.gameBtn && S.el.gameBtn.disabled) || S.el.wrap.querySelector('.modal-backdrop')) return;
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(); };
  const x = h('button', { class: 'btn small ghost nav-close', type: 'button', 'aria-label': 'Close', onclick: close }, closeIcon());
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal game-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'game-title' },
      h('div', { class: 'nav-head' }, h('h2', { id: 'game-title', text: 'Snake' }), x),
      BQ.snake()));
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  const play = backdrop.querySelector('.snake button');
  (play || x).focus();
}
function chevronUp() {
  const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: 'M6 15l6-6 6 6' }));
  return s;
}

// Every question, numbered and grouped by part, to jump to any of them.
function openNavigator() {
  if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(); };
  const pick = (i) => { backdrop.remove(); release(false); go(i); };
  const x = h('button', { class: 'btn small ghost nav-close', type: 'button', 'aria-label': 'Close', onclick: close }, closeIcon());
  const toReview = h('button', { class: 'btn', type: 'button', text: 'Go to review page', onclick: () => { backdrop.remove(); release(false); openReview(); } });
  backdrop = h('div', { class: 'modal-backdrop nav-pop' },
    h('div', { class: 'modal q-navigator', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nav-title' },
      h('div', { class: 'nav-head' }, h('h2', { id: 'nav-title', text: `Question ${S.idx + 1} of ${S.quiz.questions.length}` }), x),
      ...questionGrid(pick),
      h('div', { class: 'nav-foot' }, toReview)));
  // It opens just above the bottom bar, like a menu from its button.
  const bar = S.el.next.closest('.qnav');
  if (bar) backdrop.style.paddingBottom = `${Math.max(16, Math.round(S.el.wrap.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 8))}px`;
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  const cur = backdrop.querySelector('.sheet-dot.current:not(.mini)');
  (cur || x).focus();
}
function closeIcon() {
  const s = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: 'M18 6L6 18M6 6l12 12' }));
  return s;
}

function startTimer() {
  clearInterval(S.timer);
  // a small line above the clock (which part, or Paused), or the clock alone
  const lines = (top, digits) => {
    if (!S.el.timerDigits) {
      S.el.timerPart = h('span', { class: 'timer-part' });
      S.el.timerDigits = h('span');
      S.el.timer.replaceChildren(S.el.timerPart, S.el.timerDigits);
      S.el.timer.classList.add('parts');
    }
    S.el.timerPart.textContent = top;
    S.el.timerDigits.textContent = digits;
  };
  const plain = (text) => {
    if (S.el.timerDigits) { S.el.timerDigits = S.el.timerPart = null; S.el.timer.classList.remove('parts'); }
    S.el.timer.textContent = text;
  };
  const tick = () => {
    const paused = !!S.pausedAt; // the teacher paused the quiz: the clock holds
    S.el.timer.classList.toggle('paused', paused);
    S.el.timer.setAttribute('aria-label', paused ? 'Paused, time left' : 'Time left');
    if (!S.deadline) { if (paused) lines('Paused', ''); else plain(''); return; }
    // timed parts: the part's own clock, and which part it is above it
    const tp = timedParts();
    const n = tp ? partNow() : 0;
    const left = Math.max(0, (tp ? S.partEnds[n - 1] : S.deadline) - serverNow());
    const quizLeft = Math.max(0, S.deadline - serverNow());
    if (tp || paused) lines(paused ? 'Paused' : `Part ${n} of ${S.partEnds.length}`, mmss(left));
    else plain(mmss(left));
    if (tp) {
      if (S.warnPart !== n) { S.warnPart = n; S.warned = {}; } // the warnings again for each part
      for (const el of S.el.wrap.querySelectorAll('[data-part-left]')) el.textContent = mmss(left);
      if (S.reviewOpen) reviewButtons();
      if (lockOn() && !cfg.watch && n - 1 > (S.locked || 0)) partTimeUp(n - 1);
    }
    S.el.timer.classList.toggle('warn', !paused && left < 5 * 60000 && left >= 60000);
    S.el.timer.classList.toggle('crit', !paused && left < 60000);
    for (const mins of [5, 1]) {
      if (left > mins * 60000 + 1000) S.warned[mins] = false; // re-arm after extra time
      else if (!S.warned[mins] && left > 0) {
        S.warned[mins] = true;
        if (left > (mins - 1) * 60000 + 30000 && !cfg.watch) toast(`${plural(mins, 'minute')} left.`, 6000);
      }
    }
    if (quizLeft <= 0 && !cfg.watch) submitNow('time');
    const locked = timedExam(); // the class's time is up and they have extra: they can turn in now
    if (S.lockedIn && !locked && left > 0) {
      if (S.reviewOpen) reviewButtons();
      if (!cfg.watch) toast('You can turn in now.', 6000);
    }
    S.lockedIn = locked;
  };
  tick();
  S.timer = setInterval(tick, 250);
}

// ---------- overlays ----------
// While a dialog or overlay is up, the quiz behind it can't be reached (inert), Tab stays inside it,
// Esc does onEscape (if any), and closing puts focus back where it was. Returns the close function.
// A message the teacher sent to everyone taking the quiz.

export { openGame, openNavigator, renderSheet, reviewView, snakeGlyph, startTimer };
