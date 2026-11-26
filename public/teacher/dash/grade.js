// Grading by question: one question across every student.

import { dash } from './state.js';
import { ICONS, api, h, icon, mount, plural, post } from './core.js';
import { setHash, shell } from './home.js';

// ---------- grading by question ----------
// One question at a time, across the class: everyone who got it down the left (their points for it, or
// Not graded), the one picked on the right with the rubric, points and feedback. Save and next goes on to
// the next one still to grade. AI grades count as graded: the teacher chose AI, and can still change one.
// #grade/<run id>/<question id>
const QTYPE = { single: 'Multiple choice', multi: 'Select-all', text: 'Short answer', math: 'Math', graph: 'Graph', output: 'Predict the output', trace: 'Trace table', fill: 'Fill in the blanks', essay: 'Written answer', code: 'Code' };
// Hide names is kept in this browser: a teacher who grades blind does it every time
const HIDE_KEY = 'bq-hide-names';
try { dash.hideNames = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { dash.hideNames = false; }
async function showGrade(runId, qid, opts) {
  const o = opts || {};
  const seq = ++dash.navSeq;
  let data;
  try { data = await api(`/api/t/runs/${encodeURIComponent(runId)}/grade${qid ? `?q=${encodeURIComponent(qid)}` : ''}`); } catch (e) {
    if (e.message !== 'login') mount(shell('results', h('section', { class: 't-section' }, h('p', { class: 't-error', text: e.message }))));
    return;
  }
  if (seq !== dash.navSeq) return;
  const qs = data.questions;
  const at = qs.findIndex((x) => x.id === data.q);
  const q = qs[at];
  setHash('#grade/' + encodeURIComponent(runId) + (q ? '/' + encodeURIComponent(q.id) : ''), true);
  document.title = `Grade - ${data.run.title} - BrowserQuiz`;
  const back = h('a', { class: 't-link t-back', href: '#run/' + encodeURIComponent(runId) }, icon(ICONS.back, 16), data.run.title);
  if (!q) {
    mount(shell('results', h('section', { class: 't-section' }, back, h('h1', { text: 'Grade' }), h('p', { class: 't-muted', text: 'Nothing here is graded by hand.' }))));
    return;
  }
  // Save and next on this question's last answer to grade: on to the next question that has some
  const onTo = o.after && !q.toGrade && [...qs.slice(at + 1), ...qs.slice(0, at)].find((x) => x.toGrade);
  if (onTo) { showGrade(runId, onTo.id, { moved: true }); return; }
  const students = data.students;
  const graded = (s) => s.x.state === 'done' && !s.x.review;
  // who's on the right: the one asked for, the next one still to grade after the one just saved, or the first not graded
  let cur = students.find((s) => s.attemptId === o.pick);
  if (o.after) {
    const i = students.findIndex((s) => s.attemptId === o.after);
    cur = [...students.slice(i + 1), ...students.slice(0, i + 1)].find((s) => !graded(s)) || students[i];
  }
  if (!cur) cur = students.find((s) => !graded(s)) || students[0];
  const nameOf = (s) => (dash.hideNames ? `Student ${students.indexOf(s) + 1}` : s.name);
  const label = (x) => `Question ${x.n}: ${QTYPE[x.type] || x.type}${x.title ? `, ${x.title}` : ''}${x.toGrade ? ` (${x.toGrade} to grade)` : ''}`;
  const go = (x) => showGrade(runId, x.id);
  const prevQ = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Previous question', disabled: at === 0, onclick: () => go(qs[at - 1]) }, icon(['M15 6l-6 6 6 6'], 18));
  const nextQ = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Next question', disabled: at === qs.length - 1, onclick: () => go(qs[at + 1]) }, icon(['M9 6l6 6-6 6'], 18));
  const pickQ = h('select', { class: 'input t-gq-select', 'aria-label': 'Question' }, qs.map((x) => h('option', { value: x.id, text: label(x), selected: x.id === q.id })));
  pickQ.addEventListener('change', () => go(qs.find((x) => x.id === pickQ.value)));
  const hide = h('input', { type: 'checkbox', id: 'gq-hide', checked: dash.hideNames });
  hide.addEventListener('change', () => {
    dash.hideNames = hide.checked;
    try { localStorage.setItem(HIDE_KEY, hide.checked ? '1' : '0'); } catch (e) { /* this page only */ }
    showGrade(runId, q.id, { pick: cur && cur.attemptId });
  });
  const done = students.filter(graded).length;
  const list = h('ul', { class: 't-gq-list', 'aria-label': 'Students' }, students.map((s) => {
    const st = s.x.state === 'pending' ? 'Grading…' : s.x.state === 'failed' ? 'Grading failed' : !graded(s) ? 'Not graded'
      : `${s.x.points} / ${s.x.max}${s.x.ai && !s.x.ai.changed ? ' (AI)' : ''}`;
    return h('li', {}, h('button', { class: 't-gq-who' + (s === cur ? ' on' : ''), type: 'button', 'aria-current': s === cur ? 'true' : null,
      onclick: () => showGrade(runId, q.id, { pick: s.attemptId }) }, h('span', { class: 't-gq-name', text: nameOf(s) }), h('span', { class: 't-gq-st' + (graded(s) ? ' ok' : ''), text: st })));
  }));
  const pane = cur ? gradePane(runId, q, cur, nameOf(cur), data.quiz) : h('p', { class: 't-muted', text: 'Nobody got this question.' });
  mount(shell('results', h('section', { class: 't-section t-gq-page' },
    back,
    h('div', { class: 't-gq-bar' },
      h('h1', { text: 'Grade' }),
      h('div', { class: 't-gq-qnav' }, prevQ, h('span', { class: 't-gq-pick' }, pickQ, icon(['M6 9l6 6 6-6'], 16)), nextQ),
      h('span', { class: 't-muted', text: `${done} of ${students.length} graded` }),
      h('label', { class: 't-check t-gq-hide', for: 'gq-hide' }, hide, h('span', { text: 'Hide names' }))),
    h('div', { class: 't-gq' }, list, pane))));
  if (cur && window.BQReport) window.BQReport.highlight(pane);
  if (o.after || o.pick || o.moved) { const first = pane.querySelector('.t-gq-grade input, .t-gq-grade textarea'); if (first) first.focus({ preventScroll: true }); }
}
// One student's answer to the question, with the rubric, points and feedback
function gradePane(runId, q, s, name, quiz) {
  const card = window.BQReport.question(quiz, s.rq, q.n - 1, { teacher: true, attemptId: s.attemptId, noFeedback: true });
  return h('section', { class: 't-gq-pane', 'aria-labelledby': 'gq-name' }, h('h2', { id: 'gq-name', tabindex: '-1', text: name }),
    h('div', { class: 't-answers r-view' }, card), gradeBox(runId, q, s)); // the report's styles, as in a student's panel
}
// The rubric (with the AI's reasons, when it graded), the points, and feedback for the student. Save and
// next: Enter in the points box, or Ctrl+Enter in the feedback.
function gradeBox(runId, q, s) {
  const x = s.x;
  const boxes = x.rubric.map((r) => {
    const cb = h('input', { type: 'checkbox', id: `gq-${r.id}`, checked: r.checked });
    return { r, cb, el: h('label', { class: 't-check', for: cb.id }, cb, h('span', { text: `${r.text} (${plural(r.points, 'point')})` }),
      r.auto ? h('span', { class: 't-auto', text: 'Auto', title: 'Checked by the server. Change it and save to grade it yourself.' }) : null,
      x.ai && x.ai.items && x.ai.items[r.id] ? h('span', { class: 't-ai-why' }, h('b', { text: 'AI: ' }), x.ai.items[r.id].why) : null) };
  });
  const pts = h('input', { class: 'input t-points', type: 'number', min: '0', max: String(x.max), step: '0.5', id: 'gq-points',
    placeholder: boxes.length ? 'auto' : '', value: x.overridePoints != null ? String(x.overridePoints) : (!boxes.length && x.points != null && !x.review ? String(x.points) : '') });
  const fb = h('textarea', { class: 'input t-gq-feedback', id: 'gq-feedback', rows: '3', text: s.feedback || '' });
  fb.value = s.feedback || '';
  const msg = h('span', { class: 't-small t-muted', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button', text: 'Save and next' });
  const send = async () => {
    if (save.disabled) return;
    save.disabled = true; msg.textContent = '';
    const rubric = Object.fromEntries(boxes.map((b) => [b.r.id, b.cb.checked]));
    try {
      await post(`/api/t/attempts/${encodeURIComponent(s.attemptId)}/grade`, { questionId: q.id, rubric, override: pts.value === '' ? null : Number(pts.value), feedback: fb.value });
      showGrade(runId, q.id, { after: s.attemptId });
    } catch (e) { if (e.message !== 'login') { msg.textContent = e.message; save.disabled = false; } }
  };
  save.addEventListener('click', send);
  pts.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  fb.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  return h('div', { class: 't-gq-grade' },
    // the AI's overall reason, when it graded without a rubric (with one, its reasons sit on each item)
    x.ai && !x.ai.items && x.ai.why ? h('p', { class: 't-ai' }, h('b', { text: 'AI: ' }), x.ai.why) : null,
    boxes.length ? h('div', { class: 't-rubric' }, h('p', { class: 't-small', text: 'Rubric' }), boxes.map((b) => b.el)) : null,
    h('div', { class: 't-gq-points' }, h('label', { for: pts.id, text: 'Points' }), pts, h('span', { class: 't-muted', text: `of ${x.max}` })),
    h('div', { class: 't-gq-fb' }, h('label', { for: fb.id, text: 'Feedback' }), fb),
    h('div', { class: 't-row' }, save, msg));
}

export { showGrade };
