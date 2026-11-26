// After the quiz, and the two ways in that aren't a student's: the teacher preview and the watch page.

import { BQ, S, api, cfg, resetState } from './state.js';
import { errorText, h, mount } from './dom.js';
import { isDark } from './theme.js';
import { loadMonaco } from './monaco.js';
import { entry, screenPractice } from './entry.js';
import { restoreAnswers } from './answers.js';
import { screenQuiz } from './quiz.js';
import { loadScratch } from './scratch.js';
import { loadMarks } from './marks.js';

function confetti() {
  const layer = h('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
  const colors = isDark()
    ? ['#7ea3ff', '#5ccb8a', '#ffa94d', '#f783ac', '#ffd43b', '#b197fc']
    : ['#2257d6', '#1b7f45', '#f08c00', '#e64980', '#fab005', '#7048e8'];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pieces = [];
  for (let i = 0; i < 150; i++) {
    const left = i % 2 === 0;
    const el = h('span', { class: 'confetti' });
    el.style.width = rand(6, 11).toFixed(1) + 'px';
    el.style.height = rand(9, 17).toFixed(1) + 'px';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    layer.append(el);
    const angle = rand(48, 82) * Math.PI / 180;
    const speed = rand(0.022, 0.035) * H; // px per frame at 60 fps
    pieces.push({
      el, x: left ? -12 : W + 12, y: H + 12,
      vx: Math.cos(angle) * speed * (left ? 1 : -1), vy: -Math.sin(angle) * speed,
      rot: rand(0, 360), spin: rand(-14, 14), flip: rand(0, 6.3), flipSpeed: rand(0.06, 0.18),
      sway: rand(0, 6.3), swaySpeed: rand(0.025, 0.06), swayAmp: rand(0.5, 1.6), fall: rand(2.2, 3.8),
      delay: rand(0, 20), age: 0, launched: false,
    });
  }
  let last = 0;
  const frame = (now) => {
    if (!layer.isConnected) { if (!last) requestAnimationFrame(frame); return; } // wait until it's on screen
    const dt = last ? Math.min(3, (now - last) / 16.7) : 1;
    last = now;
    let alive = 0;
    for (const p of pieces) {
      p.age += dt;
      if (p.age < p.delay) { alive++; continue; }
      if (!p.launched) { p.launched = true; p.el.style.opacity = '1'; }
      p.vx *= Math.pow(0.975, dt);
      p.vy = p.vy * Math.pow(0.985, dt) + 0.3 * dt;
      if (p.vy > p.fall) p.vy = p.fall; // paper falls slowly
      const falling = p.vy > 0;
      p.sway += p.swaySpeed * dt;
      p.x += (p.vx + (falling ? Math.sin(p.sway) * p.swayAmp : 0)) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt * (falling ? 0.4 : 1);
      p.flip += p.flipSpeed * dt;
      const fade = p.y > H * 0.8 ? Math.max(0, 1 - (p.y - H * 0.8) / (H * 0.2)) : 1;
      p.el.style.opacity = falling ? fade.toFixed(2) : '1';
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(0)}deg) scaleY(${Math.cos(p.flip).toFixed(2)})`;
      if (p.y < H + 30 && p.age < 900) alive++;
    }
    if (alive) requestAnimationFrame(frame);
    else layer.remove();
  };
  requestAnimationFrame(frame);
  return layer;
}

const DONE = {
  submitted: ['Submitted', null],
  time: ["Time's up", 'Your answers were turned in.'],
  ended: ['Quiz ended', 'Your teacher ended the quiz. Your answers were turned in.'],
  mine: ['Quiz ended', 'Your teacher ended your quiz. Your answers were turned in.'],
  already: ['Already turned in', null],
};
function screenDone(kind) {
  S.el = null;
  const quitSeb = !!(S.run && S.run.sebQuit && !cfg.preview); // in Safe Exam Browser: a button to quit it
  const [title, plain] = DONE[kind] || DONE.submitted;
  const text = plain;
  const r = cfg.preview && S.result && S.result.questions ? S.result : null;
  const screen = entry(h('div', { class: 'panel done-panel' },
    h('p', { class: 'eyebrow', text: S.quiz ? S.quiz.title : S.run ? S.run.title : '' }),
    h('div', { class: 'heading' }, h('h1', { text: title }), text ? h('p', { text }) : null),
    r ? h('div', { class: 'pv-score' },
      h('p', {}, 'Score: ', h('b', { text: `${r.score} / ${r.max}` })),
      h('ul', {}, r.questions.map((x) => h('li', {
        text: `Question ${x.n}: ${x.points == null ? 'not graded' : x.points} / ${x.max}${x.rubric ? ` (${x.rubric} by rubric)` : ''}`,
      }))),
      h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Start over', onclick: () => location.reload() }))) : null,
    cfg.demo ? h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Start the demo over', onclick: () => BQ.app.restart() })) : null));
  if (S.run && S.run.practice && !cfg.preview) {
    const retry = !S.run.corrections; // corrections: once, then the answers
    const again = h('button', { class: 'btn', type: 'button', text: 'Try again' });
    again.addEventListener('click', async () => {
      again.disabled = true;
      try {
        await api.practiceRetry();
        const run = S.run;
        const me = S.me;
        resetState();
        S.run = run;
        S.me = me;
        screenPractice();
      } catch (e) { again.disabled = false; }
    });
    const see = h('a', { class: 'btn primary', href: '/teacher/report.html?practice=1', target: '_blank', rel: 'noopener', text: 'See answers' });
    screen.querySelector('.panel').append(h('div', { class: 'row-actions' }, see, retry ? again : null));
  }
  if (quitSeb) {
    screen.querySelector('.panel').append(h('div', {}, h('a', { class: 'btn primary', href: '/seb-quit.html', text: 'Quit Safe Exam Browser' })));
  }
  if (kind !== 'already') screen.prepend(confetti());
  mount(screen);
}

// Teacher preview: straight into the quiz. No sign-in, monitor, fullscreen or timer; nothing is saved.
async function startPreview() {
  let r;
  try {
    r = await api.start();
  } catch (e) {
    mount(entry(h('div', { class: 'panel' }, h('p', { class: 'error', role: 'alert', text: errorText(e) }))));
    return;
  }
  S.quiz = r.quiz;
  S.run = { title: r.quiz.title, timeLimitMin: r.quiz.timeLimitMin, questionCount: r.quiz.questions.length, outline: r.quiz.questions.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })), quizDirections: (r.quiz.directions && r.quiz.directions.quiz) || '', sections: r.quiz.sections || [], hasCode: r.quiz.questions.some((q) => q.type === 'code') };
  S.deadline = 0;
  S.answers = {};
  loadMarks();
  loadScratch();
  S.monitor = null;
  if (S.run.hasCode) loadMonaco().catch(() => {});
  screenQuiz();
}

// Teacher watching a student live (teacher/watch.js): the student's quiz, in their order, read-only. The
// watch page sends what the student has on screen and their answers; this follows along.
async function startWatch() {
  let r;
  try {
    r = await api.start();
  } catch (e) {
    // Not started yet (or a blip): wait and try again; the watch page says what's going on meanwhile.
    if (e.code === 'teacher_login') { mount(entry(h('div', { class: 'panel' }, h('p', { class: 'error', role: 'alert', text: errorText(e) })))); return; }
    setTimeout(startWatch, 2000);
    return;
  }
  S.quiz = r.quiz;
  S.run = { title: r.quiz.title, timeLimitMin: 0, questionCount: r.quiz.questions.length, outline: r.quiz.questions.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })), quizDirections: (r.quiz.directions && r.quiz.directions.quiz) || '', sections: r.quiz.sections || [], hasCode: r.quiz.questions.some((q) => q.type === 'code') };
  S.deadline = r.deadline || 0;
  S.partEnds = r.partEnds || null;
  S.turnInAt = r.turnInAt || 0;
  S.skew = r.now ? r.now - Date.now() - (r.delay || 0) : 0;
  S.me = { name: r.name || '' };
  S.run.practice = !!r.practice;
  S.answers = restoreAnswers(r.answers || {});
  S.watchAnswers = JSON.stringify(r.answers || {});
  S.marks = { review: [], out: {} };
  S.scratch = { tool: 'pen', pages: {} };
  S.monitor = null;
  if (S.run.hasCode) loadMonaco().catch(() => {});
  screenQuiz();
}

export { DONE, confetti, screenDone, startPreview, startWatch };
