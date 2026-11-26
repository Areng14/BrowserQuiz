// The open question, shared material, Settings and section dividers.

import { ICONS, h, icon, plural, post } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { ed } from './state.js';
import { LANGS, TYPES } from './formats.js';
import { blank } from './model.js';
import { grow, sortable } from './editing.js';
import { FORMS, M, VAR_TYPES, answersOf, area, card, check, field, graphShapes, input, poolSettings, problemsOf, touch, typeset, varsEditor } from './core.js';

// Done: what's open goes back to being a row
const doneBtn = () => h('button', { class: 'btn small qe-done', type: 'button', text: 'Done', onclick: () => closeOpen() });
import { addImage, addInlineImage, choicesEditor, imageEditor } from './choices.js';
import { promptEditor, rubricEditor } from './prompt.js';
import { codeEditor, fillEditor, outputEditor, traceEditor } from './code.js';
import { aiCard } from './fromai.js';
import { addQuestion, closeOpen, duplicate, moveQuestion, remove, renderOutline, reveal, rowOf, select, settingsOpen } from './outline.js';
import { showQuizEditor } from './main.js';

// ---------- the open question ----------
function questionPane(q, i) {
  const n = ed.quiz.questions.length;
  const type = h('select', { class: 'input qe-narrow', 'aria-label': 'Type' }, Object.entries(TYPES).map(([v, t]) => h('option', { value: v, text: t, selected: q.type === v })));
  type.addEventListener('change', () => {
    const to = type.value;
    if ((q.type === 'single' || q.type === 'multi') && (to === 'single' || to === 'multi')) { // choices stay
      q.answer = to === 'multi' ? (q.answer == null ? [] : [q.answer]) : q.answer.length === 1 ? q.answer[0] : null;
      q.type = to;
    } else ed.quiz.questions[i] = blank(to, Object.assign({}, q, { language: to === 'essay' || q.type === 'essay' ? null : q.language }));
    touch(ed.quiz.questions[i]);
    renderPane();
  });
  const head = h('div', { class: 'qe-head' },
    h('span', { class: 'qe-grip', title: 'Drag to move', 'aria-hidden': 'true' }, icon(ICONS.grip, 16)),
    h('h2', { class: 'qe-n' }, h('span', { class: 'qe-sr', text: 'Question ' }), String(i + 1)),
    h('span', { class: 'qe-type' }, icon(ICONS[q.type], 18), type),
    h('label', { class: 'qe-pts' }, 'Points', input(q, q.points, (v) => { q.points = Number(v); }, { type: 'number', min: '0.5', step: '0.5', class: 'input t-points' })),
    h('span', { class: 'qe-grow' }),
    // Duplicate in view; moving (also by dragging in the list, or Alt+Shift+arrows) and Delete under ⋯
    h('button', { class: 'btn small qe-act', type: 'button', onclick: () => duplicate(i) }, icon(ICONS.copy, 15), 'Duplicate'),
    moreMenu(`More for question ${i + 1}`, 'qe-more-q', [
      i > 0 ? { text: 'Move up', onclick: () => moveQuestion(i, i - 1) } : null,
      i < n - 1 ? { text: 'Move down', onclick: () => moveQuestion(i, i + 1) } : null,
      { text: 'Delete', danger: true, onclick: () => remove(i) },
    ].filter(Boolean)),
    doneBtn());
  const probs = h('ul', { class: 't-error qe-problems', role: 'alert' });
  // Optional. Students see names, types and points before they start, so a name shouldn't give the answer away.
  const name = field('Name', input(q, q.name || '', (v) => { const t = v.replace(/\s+/g, ' ').trim(); if (t) q.name = t; else delete q.name; renderOutline(); }, { class: 'input qe-name', maxlength: '80', placeholder: 'Optional' }));
  // A question pool: each student gets some of a pool's questions, picked at random (how many: Settings).
  const poolNames = [...new Set(ed.quiz.questions.map((x) => x.pool).filter(Boolean))];
  const pool = field('Question pool', input(q, q.pool || '', (v) => { const t = v.trim(); if (t) q.pool = t; else delete q.pool; renderOutline(); },
    { class: 'input qe-pool', maxlength: '40', placeholder: 'Optional', list: 'qe-pool-names', autocomplete: 'off', spellcheck: 'false' }),
  h('datalist', { id: 'qe-pool-names' }, poolNames.map((p) => h('option', { value: p }))));
  // What's to be answered, by type (a code question's parts come under the columns)
  const answer = [];
  const add = (nodes) => answer.push(...nodes.filter(Boolean));
  let answerTitle = null;
  if (q.type === 'single' || q.type === 'multi') { answer.push(choicesEditor(q)); answerTitle = null; }
  if (q.type === 'text') {
    answerTitle = 'Accepted answers';
    answer.push(field('One per line', area(q, q.answer.join('\n'), (v) => { q.answer = v.split('\n'); }, { rows: 2, placeholder: '3.5\n/^(binary|bin) search$/' })),
      check(q, q.caseSensitive, 'Capital letters count', (v) => { if (v) q.caseSensitive = true; else delete q.caseSensitive; }));
  }
  let answerTick = null;
  if (q.type === 'math') {
    answerTitle = 'Accepted answers';
    const reads = h('div', { class: 'qe-math-reads' });
    answerTick = () => {
      const list = answersOf(q).map(typeset).filter(Boolean);
      reads.replaceChildren(...(list.length ? [h('span', { class: 'field-label', text: 'Reads as' }), ...list] : []));
    };
    const form = h('select', { class: 'input qe-narrow' }, FORMS.map(([v, t]) => h('option', { value: v, text: t, selected: (q.form || '') === v })));
    form.addEventListener('change', () => { if (form.value) q.form = form.value; else delete q.form; touch(q); });
    answer.push(field('One per line', area(q, q.answer.join('\n'), (v) => { q.answer = v.split('\n'); }, { rows: 2, placeholder: 'x = 4' })), reads,
      h('div', { class: 'qe-line qe-fields' }, field('Answer form', form),
        field('Tolerance', input(q, q.tolerance || '', (v) => { if (Number(v) > 0) q.tolerance = Number(v); else delete q.tolerance; }, { type: 'number', min: '0', step: 'any', class: 'input t-points', placeholder: '0' }))));
  }
  if (q.type === 'graph') {
    answerTitle = 'What students draw';
    const pic = h('div', { class: 'qe-graph-answer' });
    answerTick = () => {
      const g = M ? graphShapes(q) : { shapes: [] };
      pic.replaceChildren(...(g.shapes && g.shapes.length && window.BQGraph ? [h('span', { class: 'field-label', text: 'Answer' }), window.BQGraph.view({ window: q.window, step: q.step, shapes: g.shapes, label: 'Answer' })] : []));
      if (pic.querySelector('.gr-view')) pic.querySelector('.gr-view').classList.add('answer');
    };
    const num = (k, label) => input(q, q.window[k], (v) => { const n = Number(v); if (v.trim() !== '' && Number.isFinite(n)) q.window[k] = n; }, { type: 'number', step: 'any', class: 'input t-points', 'aria-label': label });
    // the fields, and the answer drawn beside them
    answer.push(h('div', { class: 'qe-graph-ans' },
      h('div', { class: 'qe-stack' },
        field('Equations, inequalities or points, one per line', area(q, q.answer.join('\n'), (v) => { q.answer = v.split('\n'); }, { rows: 2, placeholder: 'y = 2x - 1' })),
        h('div', { class: 'qe-line' },
          field('x from', num(0, 'x from')), field('x to', num(1, 'x to')), field('y from', num(2, 'y from')), field('y to', num(3, 'y to')),
          field('Grid step', input(q, q.step, (v) => { const n = Number(v); if (n > 0) q.step = n; }, { type: 'number', min: '0', step: 'any', class: 'input t-points' }))),
        check(q, q.partialCredit, 'Partial credit when there\'s more than one', (v) => { if (v) q.partialCredit = true; else delete q.partialCredit; })),
      pic));
  }
  let fillParts = null;
  if (q.type === 'output') add(outputEditor(q));
  if (q.type === 'trace') add(traceEditor(q));
  if (q.type === 'fill') { fillParts = fillEditor(q); add(fillParts.nodes); fillParts.after(); }
  if (q.type === 'essay') {
    const kind = h('select', { class: 'input qe-narrow' }, [['', 'Text'], ...Object.entries(LANGS).map(([l, n]) => [l, `${n} code`])].map(([v, t]) => h('option', { value: v, text: t, selected: (q.language || '') === v })));
    kind.addEventListener('change', () => { if (kind.value) q.language = kind.value; else delete q.language; touch(q); });
    add([h('div', { class: 'qe-line' }, field('Students write', kind)), rubricEditor(q, 'Says == compares references').node]);
  }
  // Why the answer is right: with the answer in a practice quiz's review, in reports, and for AI grading
  const explanation = field('Explanation', area(q, q.explanation || '', (v) => { if (v.trim()) q.explanation = v; else delete q.explanation; },
    { rows: 2, spellcheck: 'true', placeholder: 'Optional. Shown with the answer after a practice quiz.' }));
  // Pools and shared material: most questions have neither, so they're folded away until used
  // the calculator: the section's (or the quiz's), unless this question says otherwise
  const secAbove = [...(ed.quiz.sections || [])].filter((d) => d.at <= i).sort((a, b) => b.at - a.at)[0];
  const inherited = (secAbove && secAbove.calculator) || ed.quiz.calculator || 'none';
  const calcField = field('Calculator', calcOverrideSelect(q, `Same as the ${secAbove && secAbove.calculator ? 'section' : 'quiz'} (${CALC_NAMES[inherited]})`));
  const more = h('details', { class: 'qe-more', open: !!(q.explanation || q.pool || q.shared || q.vars || q.calculator) }, h('summary', { text: 'More options' }),
    h('div', { class: 'qe-stack' }, explanation, h('div', { class: 'qe-pair' }, name, pool), calcField, sharedEditor(q, i), VAR_TYPES.has(q.type) ? varsEditor(q) : null));
  const code = q.type === 'code' || (q.type === 'fill' && q._ui.run) ? codeEditor(q) : null;
  const main = h('div', { class: 'qe-stack' },
    card(null, promptEditor(q)),
    answer.length ? card(answerTitle, ...answer) : null,
    code && code.node,
    more);
  ed.paneTick = () => {
    if (answerTick) answerTick();
    const list = ed.tried || ed.fromServer.has(q) ? problemsOf(q) : [];
    probs.replaceChildren(...list.map((p) => h('li', { text: p })));
    probs.hidden = !list.length;
    if (code) code.tick();
  };
  return [head, probs, main];
}

// ---------- shared material: a case or passage written once, used by several questions ----------
// Shared material: a question can use up to 3. Each in use gets its own picker and fields; "Also uses"
// adds another. One is saved as an id, more as a list.
function sharedEditor(q, i) {
  ed.quiz.shared = ed.quiz.shared || [];
  const ids = [].concat(q.shared || []);
  const setIds = (next) => { const list = [...new Set(next.filter(Boolean))]; if (!list.length) delete q.shared; else q.shared = list.length === 1 ? list[0] : list; };
  const newShared = () => {
    let n = ed.quiz.shared.length + 1;
    while (ed.quiz.shared.some((m) => m.id === `s${n}`)) n++;
    ed.quiz.shared.push({ id: `s${n}`, title: '', text: '' });
    return `s${n}`;
  };
  // slot k: the k-th material it uses, or (k === ids.length) a picker to add one
  const picker = (k) => {
    const cur = ids[k] || '';
    const pick = h('select', { class: 'input qe-narrow', id: `qe-shared-${k}`, 'aria-label': k ? 'Also uses' : 'Shared material' },
      h('option', { value: '', text: 'None', selected: !cur }),
      ed.quiz.shared.filter((m) => m.id === cur || !ids.includes(m.id)).map((m) => h('option', { value: m.id, text: m.title.trim() || `Shared material ${ed.quiz.shared.indexOf(m) + 1}`, selected: cur === m.id })),
      h('option', { value: '+', text: 'New shared material' }));
    pick.addEventListener('change', () => {
      const v = pick.value === '+' ? newShared() : pick.value;
      const next = ids.slice();
      if (v) next[k] = v; else next.splice(k, 1);
      setIds(next);
      touch(q);
      renderPane();
      if (pick.value === '+') { const t = ed.pane.querySelector(`#qe-shared-${k}`)?.closest('.qe-shared')?.querySelector('input[type=text]'); if (t) t.focus(); }
    });
    return pick;
  };
  const block = (k) => {
    const m = ed.quiz.shared.find((x) => x.id === ids[k]);
    const others = m ? ed.quiz.questions.map((x, j) => ([].concat(x.shared || []).includes(m.id) && j !== i ? j + 1 : null)).filter(Boolean) : [];
    // Images work like a question's: the button, or paste or drop one into the text.
    const file = h('input', { type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
    file.addEventListener('change', () => addImage(m, file.files[0]));
    const text = m ? area(q, m.text, (v) => { m.text = v; }, { rows: 6, placeholder: 'The case, passage or code every question in the set uses. Markdown works.', 'aria-label': 'Shared material' }) : null;
    const takeImage = (files, e) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); if (m.image) addInlineImage(text, f); else addImage(m, f); } };
    if (text) {
      text.addEventListener('paste', (e) => takeImage(e.clipboardData && e.clipboardData.files, e));
      text.addEventListener('drop', (e) => takeImage(e.dataTransfer && e.dataTransfer.files, e));
    }
    return h('div', { class: 'qe-shared' + (m ? ' on' : '') },
      h('div', { class: 'qe-line' }, h('label', { class: 'field-label', for: `qe-shared-${k}`, text: k ? 'Also uses' : 'Shared material' }), picker(k),
        others.length ? h('span', { class: 't-small t-muted', text: `Also on question${others.length > 1 ? 's' : ''} ${others.join(', ')}` }) : null),
      m ? [
        input(q, m.title, (v) => { m.title = v; }, { type: 'text', placeholder: 'Title, like Case A', 'aria-label': 'Shared material title', maxlength: '120' }),
        text, file,
        m.image ? imageEditor(m, file) : h('div', {}, h('button', { class: 'btn small', type: 'button', text: 'Add image', onclick: () => file.click() })),
      ] : null);
  };
  const blocks = ids.map((_, k) => block(k));
  if (!ids.length) return block(0);
  return h('div', { class: 'qe-stack' }, blocks, ids.length < 3 ? h('div', { class: 'qe-line' }, h('label', { class: 'field-label', for: `qe-shared-${ids.length}`, text: 'Also uses' }), picker(ids.length)) : null);
}

// The student app's built-in directions for each part (student/app/state.js PARTS), shown as placeholders.
const PART_DIRECTIONS = {
  single: 'Pick the one best answer. Blank answers earn no credit.',
  multi: 'Credit only if you select every correct answer and no wrong ones.',
  text: "Spelling counts. Capital letters and extra spaces don't.",
  code: 'Assume needed imports are there and inputs match the question. Partial credit is possible.',
  output: 'Type exactly what the code prints, one line per line of output.',
  trace: 'Fill in each value as the code runs. Each correct cell earns credit.',
  fill: 'Fill in each blank so the code works. Partial credit is possible.',
  essay: 'Your teacher grades these.',
};
function settingsPane() {
  const q = null;
  // Directions: one box for the whole quiz, and one for each kind of question the quiz has. Empty keeps the default.
  const setDir = (k, v) => { ed.quiz.directions = ed.quiz.directions || {}; if (v.trim()) ed.quiz.directions[k] = v; else delete ed.quiz.directions[k]; };
  const dirs = ed.quiz.directions || {};
  const used = [...new Set(ed.quiz.questions.map((x) => x.type))];
  const prose = { spellcheck: 'true' };
  const pasteArea = h('textarea', { class: 'input t-textarea', rows: 8, spellcheck: 'false', id: 'paste-json', placeholder: '{ "title": "...", "questions": [ ... ] }' });
  const pasteMsg = h('p', { class: 't-error', role: 'alert' });
  const pasteBtn = h('button', { class: 'btn small', type: 'button', text: 'Load' });
  pasteBtn.addEventListener('click', async () => {
    pasteMsg.textContent = '';
    if (ed.dirty && ed.quiz.questions.length && !(await window.BQAsk.confirm({ title: "Replace what's here?", text: 'The pasted quiz takes its place. Changes you haven\'t saved are lost.', ok: 'Replace', danger: true }))) return;
    try {
      const r = await post('/api/t/quizzes/normalize', { json: pasteArea.value });
      showQuizEditor(ed.currentId, { quiz: r.quiz, missing: r.missingImages });
    } catch (e) { pasteMsg.textContent = e.message; }
  });
  const langSel = h('select', { class: 'input' }, Object.entries(Object.assign({}, LANGS, { none: 'None' })).map(([v, t]) => h('option', { value: v, text: t, selected: ed.quiz.language === v })));
  langSel.addEventListener('change', () => { ed.quiz.language = langSel.value; touch(); });
  // a calculator students can open during the quiz
  const calcSel = h('select', { class: 'input' }, [['', 'None'], ['scientific', 'Scientific'], ['graphing', 'Graphing']].map(([v, t]) => h('option', { value: v, text: t, selected: (ed.quiz.calculator || '') === v })));
  calcSel.addEventListener('change', () => { if (calcSel.value) ed.quiz.calculator = calcSel.value; else delete ed.quiz.calculator; touch(); });
  ed.paneTick = null;
  const pools = poolSettings(q);
  // timed sections set the quiz's time (their total) and lock each part
  const timedSum = (ed.quiz.sections || []).reduce((t, d) => t + (d.timeLimitMin || 0), 0);
  const lockParts = check(q, ed.quiz.lockParts === true || timedSum > 0, timedSum ? 'Lock each part once it\'s done (timed sections do)' : 'Lock each part once it\'s done', (v) => { if (v) ed.quiz.lockParts = true; else delete ed.quiz.lockParts; });
  if (timedSum) lockParts.querySelector('input').disabled = true;
  return [h('div', { class: 'qe-head' }, h('h2', { class: 'qe-n', text: 'Settings' }), h('span', { class: 'qe-grow' }), doneBtn()),
    h('div', { class: 'qe-settings-cards' },
      card('Quiz',
        h('div', { class: 'qe-settings-grid' },
          timedSum ? field('Time limit (minutes, the sections added up)', input(q, timedSum, () => {}, { type: 'number', disabled: true }))
            : field('Time limit (minutes, 0 = none)', input(q, ed.quiz.timeLimitMin, (v) => { ed.quiz.timeLimitMin = Number(v) || 0; }, { type: 'number', min: '0', max: '600' })),
          field('Code highlighting', langSel),
          field('Calculator', calcSel)),
        h('div', { class: 'qe-line' },
          check(q, ed.quiz.shuffleQuestions !== false, 'Shuffle question order', (v) => { ed.quiz.shuffleQuestions = v; }),
          check(q, ed.quiz.shuffleChoices !== false, 'Shuffle choices', (v) => { ed.quiz.shuffleChoices = v; }),
          lockParts,
          check(q, ed.quiz.turnInEarly === true, 'Students can turn in before time is up', (v) => { if (v) ed.quiz.turnInEarly = true; else delete ed.quiz.turnInEarly; }))),
      pools ? card('Question pools', pools) : null,
      card('Directions',
        field('For the whole quiz', area(q, dirs.quiz, (v) => setDir('quiz', v), Object.assign({ rows: 3, placeholder: 'Optional' }, prose))),
        used.length ? h('details', { class: 'qe-paste', open: used.some((t) => dirs[t]) },
          h('summary', { text: 'For each part' }),
          used.map((t) => field(TYPES[t], area(q, dirs[t], (v) => setDir(t, v), Object.assign({ rows: 2, placeholder: PART_DIRECTIONS[t] }, prose))))) : null),
      h('details', { class: 'qe-card qe-paste qe-paste-json' }, h('summary', {}, h('span', { class: 'qe-card-title', text: 'Paste a quiz.json (from an AI)' })),
        h('label', { class: 'field', for: 'paste-json' }, h('span', { class: 'field-label', text: 'quiz.json' }), pasteArea),
        h('div', {}, pasteBtn), pasteMsg))];
}

function selectDivider(k) {
  ed.selDiv = k;
  ed.closed = false;
  ed.aiOpen = false;
  renderPane();
  reveal();
  const t = ed.pane.querySelector('#qe-div-title');
  if (t) t.focus({ preventScroll: true });
}
// A divider goes before the open question (the first one from Settings).
function addDivider() {
  if (!ed.quiz.questions.length) return;
  const at = Math.max(0, ed.sel);
  if (!ed.quiz.sections.some((d) => d.at === at)) {
    ed.quiz.sections.push({ at, title: '', directions: '' });
    ed.quiz.sections.sort((a, b) => a.at - b.at);
    touch();
  }
  selectDivider(ed.quiz.sections.findIndex((d) => d.at === at));
}
// Timed sections (docs/quiz-format.md): every one has minutes, and the first starts at question 1, as
// the server checks (quizfile.js). Which section is off, and what to do, for its pane and for Save.
function sectionTimeProblem() {
  const secs = ed.quiz.sections || [];
  if (!secs.some((d) => d.timeLimitMin > 0)) return null;
  const untimed = secs.findIndex((d) => !(d.timeLimitMin > 0));
  if (untimed >= 0) return { k: untimed, text: 'Give every section a time limit, or none of them.' };
  const first = secs.reduce((m, d) => (d.at < m.at ? d : m), secs[0]);
  if (first.at !== 0) return { k: secs.indexOf(first), text: 'With timed sections, the first one starts at question 1. Add a section there.' };
  return null;
}
// A part's or a question's own calculator, over the one above it (the quiz's, or the part's)
function calcOverrideSelect(obj, inherit) {
  const sel = h('select', { class: 'input qe-narrow' }, [['', inherit], ['none', 'None'], ['scientific', 'Scientific'], ['graphing', 'Graphing']]
    .map(([v, t]) => h('option', { value: v, text: t, selected: (obj.calculator || '') === v })));
  sel.addEventListener('change', () => { if (sel.value) obj.calculator = sel.value; else delete obj.calculator; touch(); });
  return sel;
}
const CALC_NAMES = { none: 'none', scientific: 'scientific', graphing: 'graphing' };
function dividerPane(k) {
  const d = ed.quiz.sections[k];
  const title = input(null, d.title, (v) => { d.title = v; renderOutline(); }, { id: 'qe-div-title', maxlength: '120', placeholder: `Section ${k + 1}` });
  const dirs = area(null, d.directions, (v) => { d.directions = v; }, { rows: 4, spellcheck: 'true', placeholder: 'Optional' });
  // timed parts (docs/quiz-format.md): every section gets its own minutes, or none does
  const timeMsg = h('p', { class: 't-error t-small', role: 'alert' });
  const showTime = () => { const p = sectionTimeProblem(); timeMsg.textContent = p && p.k === k ? p.text : ''; };
  const mins = input(null, d.timeLimitMin || '', (v) => { d.timeLimitMin = Math.max(0, Math.round(Number(v) || 0)); showTime(); }, { type: 'number', min: '0', max: '600', placeholder: 'None' });
  showTime();
  const del = h('button', { class: 'btn small', type: 'button', text: 'Remove section', onclick: () => { ed.quiz.sections.splice(k, 1); touch(); ed.selDiv = null; ed.closed = true; renderPane(); } });
  ed.paneTick = null;
  return [h('div', { class: 'qe-head' }, h('h2', { class: 'qe-n', text: d.title.trim() || `Section ${k + 1}` }), h('span', { class: 'qe-grow' }), del, doneBtn()),
    h('div', { class: 'qe-stack' }, field('Title', title), field('Time limit (minutes)', mins, timeMsg),
      field('Calculator', calcOverrideSelect(d, `Same as the quiz (${CALC_NAMES[ed.quiz.calculator] || 'none'})`)), field('Directions', dirs))];
}

// A quiz with no questions yet opens on the kinds of question to start with
const HINTS = { single: 'One right answer', multi: 'Several right answers', text: 'A word or a number', math: 'An expression or equation', graph: 'Drawn on a grid', output: 'What code prints',
  trace: 'Track variables by hand', fill: 'Complete the code', code: 'Write code that\'s tested', essay: 'Graded by you' };
function startPane() {
  ed.paneTick = null;
  return [h('div', { class: 'qe-head' }, h('h2', { class: 'qe-n', text: 'Add a question' })),
    h('div', { class: 'qe-tiles' }, Object.keys(TYPES).map((t) => h('button', { class: 'qe-tile', type: 'button', 'data-add': t, onclick: () => addQuestion(t) },
      icon(ICONS[t], 22), h('span', { class: 'qe-tile-name', text: TYPES[t] }), h('span', { class: 'qe-tile-hint', text: HINTS[t] }))),
      h('button', { class: 'qe-tile', type: 'button', 'data-add': 'ai', onclick: () => openAi() },
        icon(ICONS.spark, 22), h('span', { class: 'qe-tile-name', text: 'From an AI' }), h('span', { class: 'qe-tile-hint', text: 'Written from a prompt' }))),
    h('p', { class: 't-muted' }, 'Or ', h('button', { class: 't-link', type: 'button', text: 'paste a quiz.json', onclick: () => {
      ed.wantSettings = true;
      select(-1);
      const d = ed.pane.querySelector('.qe-paste-json');
      if (d) { d.open = true; d.querySelector('textarea').focus(); }
    } }), ' an AI wrote.')];
}

// A section in the list: its title, and its time when it has one
function dividerRow(k) {
  const d = ed.quiz.sections[k];
  return h('li', { class: 'qe-divider', 'data-k': String(k) },
    h('button', { class: 'qe-div-btn', type: 'button', onclick: () => selectDivider(k) },
      h('span', { class: 'qe-div-title', text: d.title.trim() || `Section ${k + 1}` }),
      d.timeLimitMin ? h('span', { class: 'qe-div-meta', text: plural(d.timeLimitMin, 'minute') }) : null));
}

// The whole list: Settings when open, the sections, each part's heading, a row per question with the
// open one in its place, then Add question. Typing doesn't come here (renderOutline redraws the rows).
// One question from an AI: its card opens at the end of the list, on the button that copies the prompt
function openAi() {
  ed.aiOpen = true;
  ed.closed = true;
  ed.selDiv = null;
  renderPane();
  reveal();
  const b = ed.pane.querySelector('.qe-open-ai .t-split button');
  if (b) b.focus({ preventScroll: true });
}

function renderPane() {
  const qs = ed.quiz.questions;
  ed.problems = qs.map(problemsOf);
  ed.paneTick = null;
  const openQ = !ed.closed && ed.selDiv == null ? ed.sel : -1;
  const openDiv = !ed.closed ? ed.selDiv : null;
  const kids = [];
  const rows = [];
  ed.parts = [];
  let part = null;
  qs.forEach((q, i) => {
    const k = ed.quiz.sections.findIndex((d) => d.at === i);
    if (k >= 0) kids.push(openDiv === k ? h('li', { class: 'qe-open qe-open-div', 'data-k': String(k) }, dividerPane(k)) : dividerRow(k));
    if (i === 0 || k >= 0 || qs[i - 1].type !== q.type) {
      part = { from: i, to: i + 1, pts: h('span', { class: 'qe-part-pts' }) };
      ed.parts.push(part);
      kids.push(h('li', { class: 'qe-part' }, h('h2', { class: 'qe-part-name', text: TYPES[q.type] }), part.pts));
    } else part.to = i + 1;
    const el = i === openQ ? h('li', { class: 'qe-open', 'data-q': String(i) }, questionPane(q, i)) : rowOf(i);
    rows.push(el);
    kids.push(el);
  });
  sortable(rows, moveQuestion, (row) => row.querySelector('.qe-grip'));
  ed.outline.replaceChildren(...kids);
  const ai = ed.aiOpen ? h('section', { class: 'qe-open qe-open-ai', 'aria-label': 'Question from an AI' }, aiCard(closeOpen)) : null;
  const top = settingsOpen() ? h('section', { class: 'qe-open qe-open-settings', 'aria-label': 'Settings' }, settingsPane())
    : !qs.length && !ai ? h('section', { class: 'qe-start' }, startPane()) : null;
  ed.pane.replaceChildren(...[top, ed.outline, ai, qs.length && !ai ? ed.addWrap : null, ed.keysEl].filter(Boolean));
  ed.pane.querySelectorAll('textarea.qe-area').forEach(grow);
  if (ed.paneTick) ed.paneTick();
  renderOutline();
}

export { addDivider, openAi, renderPane, sectionTimeProblem, selectDivider };
