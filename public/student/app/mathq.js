// Math and graph questions: the math box, MathLive sending LaTeX that the server reads and grades
// (mathexpr.js), and the grid students draw on (graph.js).

import { BQ, KIND, S, cfg } from './state.js';
import { h } from './dom.js';
import { setAnswer } from './answers.js';
import { metaRow, prompt } from './marks.js';

const MATH_KEYS = [
  ['a/b', '\\frac{#@}{#0}', 'Fraction'], ['√', '\\sqrt{#0}', 'Square root'], ['x²', '#@^2', 'Squared'], ['xʸ', '#@^{#0}', 'Power'],
  ['π', '\\pi', 'Pi'], ['|x|', '\\left|#0\\right|', 'Absolute value'], ['≤', '\\le', 'Less than or equal to'], ['≥', '\\ge', 'Greater than or equal to'], ['±', '\\pm', 'Plus or minus'],
];
function loadMathLive() {
  if (!window.BQCalculator || !window.BQCalculator.mathlive) return Promise.reject(new Error('no MathLive'));
  return window.BQCalculator.mathlive(cfg.vendorBase || '/vendor/');
}
function mathView(q) {
  const id = q.id + '-math';
  const box = h('div', { class: 'math-box' });
  const note = h('p', { class: 'math-note', id: id + '-note', hidden: true });
  const keys = h('div', { class: 'math-keys', role: 'group', 'aria-label': 'Math keys' });
  const field = h('div', { class: 'field' }, h('span', { class: 'field-label', id: id + '-label', text: 'Your answer' }), box, note);
  const view = h('div', { class: 'qview' }, metaRow(q, KIND.math), prompt(q), field);
  const saved = typeof S.answers[q.id] === 'string' ? S.answers[q.id] : '';
  if (cfg.watch) { // the student's answer, typeset
    box.classList.add('static');
    box.append(saved ? BQ.md.render(`$$${saved.replace(/\$/g, '')}$$`) : h('span', { class: 'muted', text: 'No answer yet' }));
    return view;
  }
  const explain = (v) => {
    const why = window.BQMath ? window.BQMath.problem(v) : null;
    note.hidden = !why;
    note.textContent = why || '';
  };
  const plain = () => { // no MathLive: a plain box, read the same way
    const input = h('input', { class: 'input text-answer', id, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', maxlength: '500', 'aria-labelledby': id + '-label', 'aria-describedby': id + '-note' });
    input.value = saved;
    input.addEventListener('input', () => { setAnswer(q.id, input.value.trim() ? input.value : undefined); note.hidden = true; });
    input.addEventListener('blur', () => explain(input.value));
    box.replaceChildren(input);
  };
  loadMathLive().then((ML) => {
    const mf = Object.assign(new ML.MathfieldElement(), { smartFence: true }); // an option, not a constructor argument (MathLive ignores those)
    mf.id = id;
    mf.className = 'math-field';
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.setAttribute('aria-labelledby', id + '-label');
    mf.setAttribute('aria-describedby', id + '-note');
    box.replaceChildren(mf);
    if (saved) mf.setValue(saved, { silenceNotifications: true });
    let last = saved;
    mf.addEventListener('input', () => {
      const v = mf.getValue('latex');
      if (v === last) return; // MathLive also fires input for Enter, which changes nothing
      last = v;
      setAnswer(q.id, v.trim() ? v : undefined);
      note.hidden = true;
    });
    mf.addEventListener('blur', () => explain(mf.getValue('latex')));
    const keep = (e) => e.preventDefault(); // keys don't take the focus from the box
    keys.replaceChildren(...MATH_KEYS.map(([label, latex, name]) => h('button', {
      type: 'button', class: 'math-key', 'aria-label': name, title: name, onmousedown: keep,
      onclick: () => mf.executeCommand(['insert', latex, { focus: true }]),
    }, label)));
    box.after(keys);
  }).catch(plain);
  return view;
}
// The question on the left and the student's grid on the right, on a wide screen; one above the other on a
// narrower one. A prompt that ends in a ```graph block keeps that graph with the question, so the given
// graph and the student's grid are both in view at once.
const LAST_GRAPH = /\n*```[ \t]*graph[ \t]*\n([\s\S]*?)\n```[ \t]*$/i;
function graphView(q) {
  const m = window.BQGraph ? LAST_GRAPH.exec(q.prompt) : null;
  const ask = h('div', { class: 'gr-ask' }, metaRow(q, KIND.graph), prompt(m ? Object.assign({}, q, { prompt: q.prompt.slice(0, m.index) }) : q));
  if (!window.BQGraph) return h('div', { class: 'qview' }, ask);
  if (m) ask.append(window.BQGraph.block(m[1]));
  const theirs = cfg.watch
    ? window.BQGraph.view({ window: q.window, step: q.step, drawn: Array.isArray(S.answers[q.id]) ? S.answers[q.id] : [], label: 'Their graph' })
    : window.BQGraph.editor({ window: q.window, step: q.step, tools: q.tools, shade: q.shade, value: S.answers[q.id], onChange: (v) => setAnswer(q.id, v) }).el;
  return h('div', { class: 'qview gr-split' }, ask, h('div', { class: 'gr-side' }, theirs));
}

export { graphView, mathView };
