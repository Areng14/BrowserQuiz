// What covers the quiz: notices, the fullscreen and left-the-quiz screens, exit, turning in, the keys.

import { ERRORS, S, api, resetState } from './state.js';
import { enterFullscreen, exitFullscreen, h, mount } from './dom.js';
import { loadMonaco } from './monaco.js';
import { beginQuiz, entry, screenJoin } from './entry.js';
import { clearUnsent, isAnswered, partNow, serializeAnswers, serverNow, setPaused, timedNav } from './answers.js';
import { closeDirections, disposeEditor } from './quiz.js';
import { clearScratch } from './scratch.js';
import { clearMarks, isMarked } from './marks.js';
import { startTimer } from './nav.js';
import { screenDone } from './done.js';
import { teardown } from './main.js';

function showNotice(text) {
  if (!S.el || !S.el.wrap) return;
  const old = S.el.wrap.querySelector('.notice-backdrop');
  if (old) old.remove();
  let release = null;
  const ok = h('button', { class: 'btn primary', type: 'button', text: 'OK' });
  const backdrop = h('div', { class: 'modal-backdrop notice-backdrop' },
    h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'notice-title', 'aria-describedby': 'notice-text' },
      h('h2', { id: 'notice-title', text: 'Message from your teacher' }),
      h('p', { id: 'notice-text', class: 'notice-text', text: String(text || '') }),
      h('div', { class: 'modal-actions' }, ok)));
  const close = () => { backdrop.remove(); if (release) release(); };
  ok.addEventListener('click', close);
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  ok.focus();
}

function holdFocus(layer, onEscape) {
  const back = document.activeElement;
  const others = [...S.el.wrap.children].filter((el) => el !== layer && !el.inert);
  others.forEach((el) => { el.inert = true; });
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = [...layer.querySelectorAll('button, a[href], input, select, textarea')].filter((x) => !x.disabled && x.getClientRects().length);
    e.preventDefault();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    const next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length;
    f[next].focus();
  });
  const release = (refocus = true) => {
    layer._release = null;
    others.forEach((el) => { el.inert = false; });
    if (refocus && back && back.isConnected && back !== document.body && back.focus) back.focus({ preventScroll: true });
    else if (refocus && S.el && S.el.main) S.el.main.focus({ preventScroll: true });
  };
  layer._release = release; // a timed part ending closes it (partTimeUp)
  return release;
}
function showFsOverlay() {
  if (S.done || !S.el || S.el.fsOverlay) return;
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Return to fullscreen', onclick: () => enterFullscreen() });
  const ov = h('div', { class: 'fs-overlay' },
    h('div', { class: 'fs-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fs-title' },
      h('h2', { id: 'fs-title', text: 'You left fullscreen' }),
      // waiting for the teacher's Start (no quiz yet): leaving doesn't count until it starts (store.record)
      h('p', { text: !S.quiz ? 'Once the quiz starts, this counts as cheating.' : S.pausedAt ? 'Once the quiz goes on, this counts as cheating.' : 'Leaving fullscreen counts as cheating, and your teacher can see that you left. Go back to keep working.' }),
      h('div', { class: 'row-actions' }, btn, S.quiz && !(S.run && S.run.sebQuit) ? h('button', { class: 'btn outline-danger', type: 'button', text: 'Exit', onclick: () => openExit() }) : null)));
  S.el.fsOverlay = ov;
  S.el.wrap.append(ov);
  S.el.fsRelease = holdFocus(ov);
  btn.focus();
}
// Every time a student comes back to the window. It reads the same no matter how many times they left
// or whether that cost them anything, so it gives nothing away.
function showLeftWarning() {
  if (S.done || !S.el || S.el.fsOverlay || S.el.wrap.querySelector('.modal-backdrop')) return;
  let backdrop;
  let release = null;
  const before = !S.quiz; // waiting for the teacher's Start: it doesn't count yet (store.record)
  const paused = !before && !!S.pausedAt; // nor while the teacher has it paused
  const back = h('button', { class: 'btn primary', type: 'button', text: before || paused ? 'OK' : 'Back to the quiz', onclick: () => { backdrop.remove(); release(); } });
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal warn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'left-title', 'aria-describedby': 'left-text' },
      h('h2', { id: 'left-title', text: before || paused ? 'You left the quiz window' : 'You left the quiz' }),
      h('p', { id: 'left-text', text: before ? 'Once the quiz starts, this counts as cheating.' : paused ? 'Once the quiz goes on, this counts as cheating.' : 'Leaving the quiz window counts as cheating, and your teacher can see that you left.' }),
      h('div', { class: 'modal-actions' }, back)));
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); back.click(); } });
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, () => back.click());
  back.focus();
}
function hideFsOverlay() {
  if (S.el && S.el.fsOverlay) {
    S.el.fsOverlay.remove();
    S.el.fsOverlay = null;
    if (S.el.fsRelease) { S.el.fsRelease(); S.el.fsRelease = null; }
  }
}

// Students can always get out: turn in now, or leave with answers saved and come back later.
function openExit() {
  if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop') || (S.run && S.run.sebQuit)) return;
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(); };
  const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
  // Turn in shows the usual check first: unanswered questions, and that answers can't change after.
  const turnIn = h('button', { class: 'btn outline-success', type: 'button', text: 'Turn in', onclick: () => { backdrop.remove(); release(false); openSubmit(); } });
  const exit = h('button', { class: 'btn danger', type: 'button', text: 'Exit', onclick: () => { backdrop.remove(); release(false); exitQuiz(); } });
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exit-title' },
      h('h2', { id: 'exit-title', text: 'Exit the quiz?' }),
      h('p', { text: "Exiting counts as leaving the quiz unless your teacher told you to. Your answers are saved." }),
      h('div', { class: 'modal-actions' }, keep, timedExam() ? null : turnIn, exit)));
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  keep.focus();
}
async function exitQuiz() {
  S.done = true;
  clearInterval(S.timer);
  hideFsOverlay();
  if (S.monitor && S.monitor.armed) await Promise.resolve(api.event('exit')).catch(() => {});
  disposeEditor();
  if (S.monitor) S.monitor.disarm(); // last heartbeat carries the answers
  exitFullscreen();
  const run = S.run;
  const me = S.me;
  resetState();
  S.run = run;
  S.me = me;
  S.el = null;
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Continue quiz' });
  const msg = h('p', { class: 'error', role: 'alert' });
  btn.addEventListener('click', () => beginQuiz(btn, msg, 'Continue quiz'));
  mount(entry(h('div', { class: 'panel' },
    h('p', { class: 'eyebrow', text: run.title }),
    h('div', { class: 'heading' }, h('h1', { text: 'You left the quiz' }), h('p', { text: 'Your answers are saved.' })),
    btn, msg)));
}

// Keyboard: 1–9 pick a choice, Enter goes to the next question (or opens Submit on the last one).
function quizKeys(e) {
  if (S.done || !S.el || !S.quiz || S.pausedAt || e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.el.wrap.querySelector('.modal-backdrop, .fs-overlay')) return;
  const t = e.target;
  const typing = t && t.closest && t.closest('textarea, .monaco-editor, select, input[type="text"], input:not([type])');
  const q = S.quiz.questions[S.idx];
  if (S.dirOpen) {
    if (e.key === 'Enter' && !(t && t.closest && t.closest('button'))) { e.preventDefault(); closeDirections(); }
    return;
  }
  const onChoices = t === S.el.main || t === document.body || (t && t.closest && t.closest('.choices'));
  if (!typing && onChoices && e.shiftKey && /^Digit[1-9]$/.test(e.code) && (q.type === 'single' || q.type === 'multi')) {
    const x = S.el.main.querySelectorAll('.choice-x')[Number(e.code.slice(5)) - 1];
    if (x) { e.preventDefault(); x.click(); }
    return;
  }
  if (!typing && onChoices && /^[1-9]$/.test(e.key) && (q.type === 'single' || q.type === 'multi')) {
    const input = S.el.main.querySelectorAll('.choice input')[Number(e.key) - 1];
    if (!input) return;
    e.preventDefault();
    input.focus();
    if (q.type === 'single') { if (!input.checked) input.click(); } else input.click();
    return;
  }
  if (e.key !== 'Enter' || e.shiftKey || q.type === 'code') return;
  const onChoice = t && t.closest && t.closest('.choice, .text-answer');
  if (!onChoice && t !== S.el.main && t !== document.body) return;
  e.preventDefault();
  S.el.next.click();
}

const timedExam = () => !!(S.run && !S.run.practice && S.deadline && !(S.quiz && S.quiz.turnInEarly)
  && !(S.turnInAt && S.turnInAt < S.deadline && serverNow() >= S.turnInAt));
function openSubmit() {
  if (timedExam() || (timedNav() && partNow() < S.parts.length)) return;
  const missing = S.quiz.questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter(Boolean);
  const marked = S.quiz.questions.map((q, i) => (isMarked(q) ? i + 1 : null)).filter(Boolean);
  if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(false); S.el.next.focus(); };
  const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
  const submit = h('button', { class: 'btn success', type: 'button', text: 'Submit', onclick: () => { backdrop.remove(); release(false); submitNow(); } });
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'submit-title' },
      h('h2', { id: 'submit-title', text: 'Submit your quiz?' }),
      missing.length ? h('p', { text: `Unanswered: ${missing.length > 1 ? 'questions' : 'question'} ${missing.join(', ')}.` }) : null,
      marked.length ? h('p', { text: `Marked for review: ${marked.length > 1 ? 'questions' : 'question'} ${marked.join(', ')}.` }) : null,
      h('p', { class: 'muted', text: "You can't change answers after this." }),
      h('div', { class: 'modal-actions' }, keep, submit)));
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  keep.focus();
}

// The monitor stays armed until the server confirms: a dropped connection at Submit keeps retrying.
async function submitNow(reason) {
  if (S.done || S.submitting) return;
  S.submitting = true;
  clearInterval(S.timer);
  hideFsOverlay();
  const answers = serializeAnswers();
  const edits = S.monitor ? S.monitor.takeEdits() : []; // the replay's last few seconds
  const late = S.monitor ? S.monitor.takeLate() : []; // anything the monitor couldn't send
  const ov = submittingOverlay();
  for (let tries = 0; ; tries++) {
    try {
      S.result = await api.submit(answers, edits, late);
      break;
    } catch (e) {
      if (S.done) return;
      if (e.code === 'no_attempt') return leaveQuiz(signedOut);
      if (e.code === 'run_closed') return finishQuiz('ended');
      if (e.code === 'other_network') return leaveQuiz(() => screenJoin(ERRORS.other_network));
      if (e.code === 'paused') { // the teacher paused it just now: back to the quiz, which shows that
        ov.close();
        S.submitting = false;
        startTimer();
        const at = S.pausedAt || serverNow();
        S.pausedAt = 0;
        setPaused(at);
        return;
      }
      if (tries === 1) ov.failed();
      const delay = Math.min(2000 * 2 ** tries, 15000);
      await new Promise((resolve) => {
        const t = setTimeout(resolve, delay);
        ov.retry.onclick = () => { clearTimeout(t); ov.trying(); resolve(); };
      });
    }
  }
  finishQuiz(reason === 'time' ? 'time' : 'submitted');
}

function submittingOverlay() {
  const title = h('h2', { id: 'turnin-title', text: 'Turning in your quiz…' });
  const text = h('p', { class: 'muted' });
  const retry = h('button', { class: 'btn primary', type: 'button', text: 'Try again', hidden: true });
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'turnin-title' },
      title, text, h('div', { class: 'modal-actions' }, retry)));
  S.el.wrap.append(backdrop);
  const release = holdFocus(backdrop);
  return {
    retry,
    close() { backdrop.remove(); release(false); },
    failed() {
      title.textContent = "Couldn't reach the quiz server";
      text.textContent = 'Your answers are still here. Retrying automatically.';
      retry.hidden = false;
      retry.focus();
    },
    trying() { title.textContent = 'Turning in your quiz…'; },
  };
}

function finishQuiz(kind) {
  S.done = true;
  clearMarks();
  clearScratch();
  clearUnsent();
  clearInterval(S.timer);
  hideFsOverlay();
  disposeEditor();
  if (S.monitor) S.monitor.disarm();
  exitFullscreen();
  screenDone(kind);
}
function endQuiz(kind) { finishQuiz(kind); }

// Out of the quiz without turning anything in (the teacher reset or moved this attempt).
function leaveQuiz(next) {
  clearUnsent(); // the teacher reset or moved it: these answers belong to an attempt that's gone
  teardown();
  resetState();
  next();
}
function signedOut() {
  resetState();
  screenJoin(ERRORS.no_attempt);
}
function screenClosed() {
  mount(entry(h('div', { class: 'panel', role: 'status' },
    h('p', { class: 'eyebrow', text: S.run ? S.run.title : 'BrowserQuiz' }),
    h('div', { class: 'heading' },
      h('h1', { text: 'This quiz is closed' })),
    h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Back to start', onclick: () => { resetState(); screenJoin(); } })))));
}
// Page reloaded mid-quiz: one button back in instead of the whole sign-in again.
function screenContinue() {
  if (S.run.hasCode) loadMonaco().catch(() => {});
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Continue quiz' });
  const msg = h('p', { class: 'error', role: 'alert' });
  btn.addEventListener('click', () => beginQuiz(btn, msg, 'Continue quiz'));
  mount(entry(h('div', { class: 'panel' },
    h('p', { class: 'eyebrow', text: S.run.title }),
    h('div', { class: 'heading' },
      h('h1', { text: 'Your quiz is still open' }),
      h('p', { text: `Signed in as ${S.me.name}. The timer is still running.` })),
    btn, msg)));
  btn.focus();
}

// Same screen for everyone, invalidated or not: confetti and all.
// Always moving, even with the computer's animations turned off (school PCs and remote desktops often have
// them off for everyone). Confetti from both bottom corners, with a little physics so it moves like paper:
// launched up and inward, slowed by the air, then drifting down slowly, swaying and flipping, fading near the bottom.

export { endQuiz, hideFsOverlay, holdFocus, leaveQuiz, openExit, openSubmit, quizKeys, screenClosed, screenContinue, showFsOverlay, showLeftWarning, showNotice, signedOut, submitNow, submittingOverlay, timedExam };
