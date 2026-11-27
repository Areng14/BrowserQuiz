// A code question, solution first. The solution has a tab per language (the tabs are the question's
// languages), what students write is read from it (infer.js) and shown in one line, with Edit to set it by
// hand (sigform.js), and the tests are a table checked against every solution as they change (testgrid.js,
// checks.js). A fill question graded by running gets the same line and tests, read from its code with the
// answers put in.

import { ICONS, h, icon } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { ed } from './state.js';
import { BLANK, LANGS, parseClassTests, parseMethodTests, sigText } from './formats.js';
import { readCode, refLangsOf, starterCode } from './model.js';
import { codeKeys, insert } from './editing.js';
import { area, check, touch } from './core.js';
import { colorIn, colored } from './colors.js';
import { disagreements, fillFromTests, openTypes, readSolutions } from './infer.js';
import { looseSig, shapeForm } from './sigform.js';
import { testGrid } from './testgrid.js';
import { checker, names } from './checks.js';
import { rulesPart } from './code.js';
import { renderPane } from './pane.js';

// ---------- the shape, read from the solutions ----------
const known = (t) => t || '?';
const listed = (ps) => ps.map((p) => ({ name: p.name, type: known(p.type) }));
function shapeText(shape) {
  if (shape.mode === 'method') { const s = shape.signature; return { sig: sigText(s.name, listed(s.params), known(s.returns)) }; }
  const C = shape.class;
  return { className: C.name, ctor: C.constructor.length ? sigText('', listed(C.constructor), '') : '', methods: C.methods.map((m) => sigText(m.name, listed(m.params), known(m.returns))).join('\n') };
}
const flat = (x) => String(x || '').replace(/\s+/g, ''); // map<string, int> is map<string,int>
const sameShape = (q, t) => (t.sig !== undefined ? q.mode !== 'class' && flat(t.sig) === flat(q._ui.sig)
  : q.mode === 'class' && t.className === q._ui.className && flat(t.ctor) === flat(q._ui.ctor) && flat(t.methods) === flat(q._ui.methods));
// The solutions read, the tests' values settling what the code doesn't say
function readShape(q, src) {
  const u = q._ui;
  const read = readSolutions(src.refs(), src.langs());
  if (!read) return null;
  const open = openTypes(read.shape).length;
  const tests = read.shape.mode === 'class' ? parseClassTests(`${u.sample}\n\n${u.hidden}`).tests : parseMethodTests(`${u.sample}\n${u.hidden}`).tests;
  fillFromTests(read.shape, tests);
  read.open = openTypes(read.shape);
  read.fromTests = open > read.open.length;
  read.text = shapeText(read.shape);
  read.differ = disagreements(read);
  return read;
}
function apply(q, read) {
  q.mode = read.shape.mode;
  Object.assign(q._ui, read.text);
}
// The lines of the starter code that name what students write, as they'll see them in lang
function sigLines(shape, lang) {
  let code;
  try { code = starterCode(shape, lang, false); } catch (e) { return []; }
  const lines = code.split('\n');
  const find = (...ns) => {
    for (const n of ns) {
      const l = lines.find((x) => new RegExp(`\\b${n}\\s*\\(`).test(x));
      if (l) return l.trim().replace(/\s*[{:]\s*$/, '');
    }
    return null;
  };
  if (shape.signature) return [find(shape.signature.name)].filter(Boolean);
  const C = shape.class;
  return [find(C.name, '__init__', 'constructor', `New${C.name}`, 'new'), ...C.methods.map((m) => find(m.name))].filter(Boolean);
}

// Where the code comes from: a code question's solutions, or a fill question's code with its answers
const fillLang = (q) => q.language || (ed.quiz.language === 'none' ? 'java' : ed.quiz.language);
const firstAnswers = (q) => q._ui.blanks.map((b) => b.split('\n').map((x) => x.trim()).find(Boolean) || '');
const sources = {
  code: (q) => ({ langs: () => refLangsOf(q), refs: () => q.reference || {}, tab: () => q._ui.refTab, ready: () => true,
    whose: (l) => `The ${LANGS[l]} solution`, yours: 'your solution', label: 'Students write' }),
  fill: (q) => ({ langs: () => [fillLang(q)], tab: () => fillLang(q),
    refs: () => { const a = firstAnswers(q); let i = 0; return { [fillLang(q)]: String(q.code || '').replace(BLANK, () => a[i++] || '') }; },
    ready: () => !!String(q.code || '').trim() && firstAnswers(q).every(Boolean), whose: () => 'The code with your answers', yours: 'your code', label: 'Tests call' }),
};

// What's shared: the line saying what students write (or the tests call), the tests and their checks, the rules.
// compile: where a solution that doesn't compile says so; drawn(): after the line is drawn.
function testsParts(q, src, compile, drawn) {
  const u = q._ui;
  let read = readShape(q, src);
  // A question saved before: its shape is the teacher's own when the solution reads otherwise
  if (u.byHand === undefined) u.byHand = !!read && !sameShape(q, read.text) && !!String(q.mode === 'class' ? u.className : u.sig).trim();
  if (!u.byHand && read) apply(q, read);
  const reread = () => { read = readShape(q, src); if (!u.byHand && read) apply(q, read); };
  const fromCode = () => { u.byHand = false; reread(); touch(q); renderPane(); };

  // ---------- what students write ----------
  const summary = h('div', { class: 'qe-sig' });
  const formBox = h('div', { class: 'qe-sigform-box' });
  const drawForm = () => {
    formBox.hidden = !u.editShape; // (an empty box would still take a gap in the card)
    formBox.replaceChildren(u.editShape ? shapeForm(q, (modeChanged) => { if (modeChanged) { renderPane(); return; } drawSummary(); grid.draw(); checks.schedule(); },
      fromCode, { label: src.label, from: `Read it from ${src.yours}` }) : '');
  };
  function drawSummary() {
    const r = readCode(q);
    const shape = r.shape;
    const lines = shape ? sigLines(shape, src.tab()) : [];
    const code = h('div', { class: 'qe-sig-code' });
    if (lines.length) code.append(...lines.map((l) => h('code', { class: 'qe-mono', 'data-lang': src.tab(), text: l })));
    else if (q.mode === 'class' ? u.className : u.sig) code.append(h('code', { class: 'qe-mono', text: q.mode === 'class' ? `${u.className}(${looseSig(u.ctor || '()').params.map((p) => `${p.name}: ${p.type}`).join(', ')})` : u.sig }));
    else code.append(h('span', { class: 't-muted', text: `Read from ${src.yours}` }));
    const notes = [];
    const warn = (text, btn) => notes.push(h('span', { class: 'qe-sig-warn' }, text, btn || null));
    if (u.byHand && read && !sameShape(q, read.text)) warn(`${src.yours[0].toUpperCase()}${src.yours.slice(1)} says otherwise.`, h('button', { class: 'btn small', type: 'button', text: `Use ${src.yours.replace('your ', 'the ')}`, onclick: () => { u.byHand = false; apply(q, read); touch(q); renderPane(); } }));
    else if (!u.byHand && read && read.open.length) warn('Add a test or type hints to set the types.');
    else if (r.shapeErrors.length && (u.sig || u.className)) warn(r.shapeErrors[0].replace(/^Signature: /, ''));
    else if (!u.byHand && read && read.fromTests) notes.push(h('span', { class: 't-muted', text: 'Types from the tests' }));
    if (read && read.differ.length) warn(`${names(read.differ)}'s solution doesn't match ${LANGS[read.from]}'s.`);
    const edit = h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(!!u.editShape), text: u.editShape ? 'Done' : 'Edit',
      onclick: () => { u.editShape = !u.editShape; drawSummary(); drawForm(); } });
    summary.replaceChildren(h('span', { class: 'qe-sig-label', text: src.label }), code, ...notes, h('span', { class: 'qe-grow' }), edit);
    colorIn(summary);
    if (drawn) drawn(shape);
  }

  // ---------- the tests ----------
  const grid = testGrid(q, {
    params: () => (q.mode === 'class' || !String(u.sig).trim() ? null : looseSig(u.sig).params),
    methods: () => String(u.methods || '').split('\n').filter((l) => l.trim()).map(looseSig),
    className: () => u.className,
    langs: src.langs,
    changed: () => { if (!u.byHand) reread(); drawSummary(); checks.schedule(); },
  });
  const sampleText = () => (q.mode === 'class' ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2');
  const textMode = () => h('div', { class: 'qe-stack' },
    ...['sample', 'hidden'].map((kind) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: kind === 'sample' ? 'Sample tests (students can run these)' : 'Hidden tests' }),
      colored(area(q, u[kind], (v) => { u[kind] = v; checks.schedule(); }, { rows: kind === 'sample' ? 2 : 4, class: 'input qe-area qe-mono qe-code', 'data-tests': kind, placeholder: kind === 'sample' ? sampleText() : '' }), src.tab))),
    h('p', { class: 't-muted t-small', text: q.mode === 'class' ? `A blank line starts the next test. -> ? takes the value from ${src.yours}. A line with *2 counts double.`
      : `One test per line. Leave out -> to take the value from ${src.yours}. *2 at the end counts double.` }));
  const testsBody = h('div', {});
  const textBtn = h('button', { class: 'btn small', type: 'button' });
  const drawTests = () => {
    textBtn.textContent = u.testsAsText ? 'Edit as a table' : 'Edit as text';
    if (u.testsAsText) testsBody.replaceChildren(textMode());
    else { grid.draw(); testsBody.replaceChildren(grid.node); }
  };
  textBtn.addEventListener('click', () => { u.testsAsText = !u.testsAsText; drawTests(); checks.schedule(); });
  const checks = checker(q, { grid, src, compile, redrawTests: drawTests });

  // ---------- the rest ----------
  const unordered = check(q, q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; checks.schedule(); });
  const rules = rulesPart(q, src.langs(), unordered);
  // after the code changes
  function sync() {
    const was = q.mode;
    const cols = JSON.stringify(looseSig(u.sig).params.map((p) => p.name)) + u.methods;
    reread();
    if (q.mode !== was) { touch(q); renderPane(); return; } // a class where a method was: the tests show the other way (and come back)
    if (cols !== JSON.stringify(looseSig(u.sig).params.map((p) => p.name)) + u.methods && !u.testsAsText) grid.draw();
    if (u.editShape) drawForm();
    drawSummary();
    checks.schedule();
  }
  drawSummary();
  drawForm();
  drawTests();
  if (u.checked) checks.finish();
  checks.schedule();
  const testsCard = (...top) => h('section', { class: 'qe-card' },
    h('div', { class: 'qe-tools' }, h('h2', { class: 'qe-card-title', text: 'Tests' }), checks.status, h('span', { class: 'qe-grow' }), textBtn), ...top, testsBody, checks.gapBox);
  return { summary, formBox, testsCard, rules, sync, drawSummary, showCompile: checks.showCompile };
}

function solutionEditor(q) {
  const u = q._ui;
  q.reference = q.reference || {};
  const src = sources.code(q);
  const langs = refLangsOf(q);
  if (!langs.includes(u.refTab)) u.refTab = langs[0];

  // ---------- the solution, a tab per language ----------
  const tabs = h('div', { class: 'qe-ltabs', role: 'tablist', 'aria-label': 'Solutions' });
  const panels = {};
  const compile = h('div', { class: 'qe-compile', role: 'alert', hidden: true });
  const starterBtn = h('button', { class: 'btn small', type: 'button', text: 'Insert the starter code', hidden: true });
  for (const l of langs) {
    const ta = area(q, q.reference[l], (v) => { q.reference[l] = v; parts.sync(); }, { rows: 8, class: 'input qe-area qe-mono qe-code', 'aria-label': `Solution (${LANGS[l]})` });
    codeKeys(ta);
    panels[l] = { ta, el: h('div', { class: 'qe-ref', id: `qe-ref-${l}`, role: 'tabpanel', hidden: l !== u.refTab }, colored(ta, () => l)) };
  }
  const parts = testsParts(q, src, compile, (shape) => { starterBtn.hidden = !shape || !!(q.reference[u.refTab] || '').trim(); });
  starterBtn.addEventListener('click', () => { const sh = readCode(q).shape; const ta = panels[u.refTab].ta; if (!sh) return; ta.select(); insert(ta, starterCode(sh, u.refTab, false)); });
  const pick = (l) => {
    u.refTab = l;
    for (const [k, p] of Object.entries(panels)) p.el.hidden = k !== l;
    drawTabs();
    parts.drawSummary();
    parts.showCompile();
  };
  const removeLang = async (l) => {
    if ((q.reference[l] || '').trim() && !(await window.BQAsk.confirm({ title: `Remove ${LANGS[l]}?`, text: `Its solution goes too, and students can't answer in ${LANGS[l]}.`, ok: 'Remove', danger: true }))) return;
    delete q.reference[l];
    if (q.languagesAny) u.refLangs = (u.refLangs || langs).filter((x) => x !== l);
    else q.languages = q.languages.filter((x) => x !== l);
    touch(q);
    renderPane();
  };
  const addLang = (l) => {
    if (q.languagesAny) u.refLangs = [...(u.refLangs || langs), l];
    else q.languages = Object.keys(LANGS).filter((x) => x === l || q.languages.includes(x));
    u.refTab = l;
    touch(q);
    renderPane();
  };
  function drawTabs() {
    const [plus, menu] = moreMenu('Add a language', 'qe-addlang', () => [
      ...Object.keys(LANGS).filter((l) => !langs.includes(l)).map((l) => ({ text: LANGS[l], onclick: () => addLang(l) })),
      { text: q.languagesAny ? 'Only these languages' : 'Any language', tip: q.languagesAny ? 'Students answer in one of these.' : 'Students pick any language that can run it.',
        onclick: () => { q.languagesAny = !q.languagesAny; q.languages = q.languagesAny ? Object.keys(LANGS) : langs.slice(); touch(q); renderPane(); } }]);
    plus.replaceChildren(icon(ICONS.plus, 16));
    plus.title = 'Add a language';
    tabs.replaceChildren(...langs.map((l) => {
      const on = l === u.refTab;
      return h('span', { class: `qe-ltab${on ? ' on' : ''}` },
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-controls': `qe-ref-${l}`, text: LANGS[l], onclick: () => pick(l) }),
        on && langs.length > 1 ? h('button', { class: 'qe-ltab-x', type: 'button', 'aria-label': `Remove ${LANGS[l]}`, title: `Remove ${LANGS[l]}`, onclick: () => removeLang(l) }, icon(ICONS.x, 14)) : null);
    }), plus, menu);
  }
  drawTabs();
  parts.drawSummary();
  const node = h('div', { class: 'qe-stack qe-codeq' },
    h('section', { class: 'qe-card' },
      h('div', { class: 'qe-tools' }, h('h2', { class: 'qe-card-title', text: 'Solution' }), h('span', { class: 'qe-grow' }), q.languagesAny ? h('span', { class: 't-small t-muted', text: 'Any language' }) : null, tabs),
      ...langs.map((l) => panels[l].el), compile, h('div', {}, starterBtn), parts.summary, parts.formBox),
    parts.testsCard(),
    parts.rules.node);
  return { node, tick: () => parts.rules.tick(readCode(q).rubric) };
}

// A fill question graded by running: its code is above (fillEditor), so here the line saying what the tests
// call, the tests and the rules. compile: under the code, where it says the code doesn't compile.
function fillTestsEditor(q, compile) {
  const parts = testsParts(q, sources.fill(q), compile);
  const node = h('div', { class: 'qe-stack qe-codeq' }, parts.testsCard(parts.summary, parts.formBox), parts.rules.node);
  return { node, sync: parts.sync, tick: () => parts.rules.tick(readCode(q).rubric) };
}

export { fillTestsEditor, solutionEditor };
