// A code question, solution first. The solution has a tab per language (the tabs are the question's
// languages), what students write is read from it (infer.js) and shown in one line, with Edit to set it by
// hand (sigform.js), and the tests are a table checked against every solution as they change (testgrid.js).

import { ICONS, h, icon, plural, post } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { LANGS, parseClassTests, parseMethodTests, sigText } from './formats.js';
import { collect, readCode, refLangsOf, starterCode } from './model.js';
import { codeKeys, insert } from './editing.js';
import { area, check, touch } from './core.js';
import { colorIn, colored } from './colors.js';
import { disagreements, fillFromTests, openTypes, readSolutions } from './infer.js';
import { looseSig, shapeForm } from './sigform.js';
import { failingCount, testGrid } from './testgrid.js';
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
function readShape(q) {
  const u = q._ui;
  const read = readSolutions(q.reference || {}, refLangsOf(q));
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
  const find = (...names) => {
    for (const n of names) {
      const l = lines.find((x) => new RegExp(`\\b${n}\\s*\\(`).test(x));
      if (l) return l.trim().replace(/\s*[{:]\s*$/, '');
    }
    return null;
  };
  if (shape.signature) return [find(shape.signature.name)].filter(Boolean);
  const C = shape.class;
  return [find(C.name, '__init__', 'constructor', `New${C.name}`, 'new'), ...C.methods.map((m) => find(m.name))].filter(Boolean);
}
const names = (ls) => ls.map((l) => LANGS[l]).join(' and ');

function solutionEditor(q) {
  const u = q._ui;
  q.reference = q.reference || {};
  let read = readShape(q);
  // A question saved before: its shape is the teacher's own when the solution reads otherwise
  if (u.byHand === undefined) u.byHand = !!read && !sameShape(q, read.text) && !!String(q.mode === 'class' ? u.className : u.sig).trim();
  if (!u.byHand && read) apply(q, read);
  const langs = refLangsOf(q);
  if (!langs.includes(u.refTab)) u.refTab = langs[0];

  // ---------- the solution, a tab per language ----------
  const tabs = h('div', { class: 'qe-ltabs', role: 'tablist', 'aria-label': 'Solutions' });
  const panels = {};
  const compile = h('div', { class: 'qe-compile', role: 'alert', hidden: true });
  const starterBtn = h('button', { class: 'btn small', type: 'button', text: 'Insert the starter code', hidden: true });
  const shapeNow = () => readCode(q).shape;
  for (const l of langs) {
    const ta = area(q, q.reference[l], (v) => { q.reference[l] = v; sync(); }, { rows: 8, class: 'input qe-area qe-mono qe-code', 'aria-label': `Solution (${LANGS[l]})` });
    codeKeys(ta);
    panels[l] = { ta, el: h('div', { class: 'qe-ref', id: `qe-ref-${l}`, role: 'tabpanel', hidden: l !== u.refTab }, colored(ta, () => l)) };
  }
  starterBtn.addEventListener('click', () => { const sh = shapeNow(); const ta = panels[u.refTab].ta; if (!sh) return; ta.select(); insert(ta, starterCode(sh, u.refTab, false)); });
  const pick = (l) => {
    u.refTab = l;
    for (const [k, p] of Object.entries(panels)) p.el.hidden = k !== l;
    drawTabs();
    drawSummary();
    showCompile();
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

  // ---------- what students write ----------
  const summary = h('div', { class: 'qe-sig' });
  const formBox = h('div', { class: 'qe-sigform-box' });
  const drawForm = () => {
    formBox.replaceChildren(u.editShape ? shapeForm(q, (modeChanged) => { if (modeChanged) { renderPane(); return; } drawSummary(); grid.draw(); schedule(); },
      () => { u.byHand = false; read = readShape(q); if (read) apply(q, read); renderPane(); }) : '');
  };
  function drawSummary() {
    const r = readCode(q);
    const shape = r.shape;
    const lines = shape ? sigLines(shape, u.refTab) : [];
    const code = h('div', { class: 'qe-sig-code' });
    if (lines.length) code.append(...lines.map((l) => h('code', { class: 'qe-mono', 'data-lang': u.refTab, text: l })));
    else if (q.mode === 'class' ? u.className : u.sig) code.append(h('code', { class: 'qe-mono', text: q.mode === 'class' ? `${u.className}(${looseSig(u.ctor || '()').params.map((p) => `${p.name}: ${p.type}`).join(', ')})` : u.sig }));
    else code.append(h('span', { class: 't-muted', text: 'Read from your solution' }));
    const notes = [];
    const warn = (text, btn) => notes.push(h('span', { class: 'qe-sig-warn' }, text, btn || null));
    if (u.byHand && read && !sameShape(q, read.text)) warn('Your solution says otherwise.', h('button', { class: 'btn small', type: 'button', text: 'Use the solution', onclick: () => { u.byHand = false; apply(q, read); touch(q); renderPane(); } }));
    else if (!u.byHand && read && read.open.length) warn('Add a test or type hints to set the types.');
    else if (r.shapeErrors.length && (u.sig || u.className)) warn(r.shapeErrors[0].replace(/^Signature: /, ''));
    else if (!u.byHand && read && read.fromTests) notes.push(h('span', { class: 't-muted', text: 'Types from the tests' }));
    if (read && read.differ.length) warn(`${names(read.differ)}'s solution doesn't match ${LANGS[read.from]}'s.`);
    const edit = h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(!!u.editShape), text: u.editShape ? 'Done' : 'Edit',
      onclick: () => { u.editShape = !u.editShape; drawSummary(); drawForm(); } });
    summary.replaceChildren(h('span', { class: 'qe-sig-label', text: 'Students write' }), code, ...notes, h('span', { class: 'qe-grow' }), edit);
    colorIn(summary);
    starterBtn.hidden = !shape || !!(q.reference[u.refTab] || '').trim();
  }

  // ---------- the tests ----------
  const status = h('span', { class: 'qe-tstatus', role: 'status' });
  const grid = testGrid(q, {
    params: () => (q.mode === 'class' || !String(u.sig).trim() ? null : looseSig(u.sig).params),
    methods: () => String(u.methods || '').split('\n').filter((l) => l.trim()).map(looseSig),
    className: () => u.className,
    langs: () => refLangsOf(q),
    changed: () => { if (!u.byHand) { read = readShape(q); if (read) apply(q, read); } drawSummary(); schedule(); },
  });
  const sampleText = () => (q.mode === 'class' ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2');
  const textMode = () => h('div', { class: 'qe-stack' },
    ...['sample', 'hidden'].map((kind) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: kind === 'sample' ? 'Sample tests (students can run these)' : 'Hidden tests' }),
      colored(area(q, u[kind], (v) => { u[kind] = v; grid.changedText = true; schedule(); }, { rows: kind === 'sample' ? 2 : 4, class: 'input qe-area qe-mono qe-code', 'data-tests': kind, placeholder: kind === 'sample' ? sampleText() : '' }), () => u.refTab))),
    h('p', { class: 't-muted t-small', text: q.mode === 'class' ? 'A blank line starts the next test. -> ? takes the value from your solution. A line with *2 counts double.'
      : 'One test per line. Leave out -> to take the value from your solution. *2 at the end counts double.' }));
  const testsBody = h('div', {});
  const textBtn = h('button', { class: 'btn small', type: 'button' });
  const drawTests = () => {
    textBtn.textContent = u.testsAsText ? 'Edit as a table' : 'Edit as text';
    if (u.testsAsText) testsBody.replaceChildren(textMode());
    else { grid.draw(); testsBody.replaceChildren(grid.node); }
  };
  textBtn.addEventListener('click', () => { u.testsAsText = !u.testsAsText; drawTests(); schedule(); });

  // ---------- checking: every solution against every test, a moment after each change ----------
  let timer = null;
  let seq = 0;
  const say = (text, cls) => { status.textContent = text; status.className = `qe-tstatus${cls ? ` ${cls}` : ''}`; };
  function showCompile() {
    const res = u.checked && u.checked.results[u.refTab];
    const bad = res && (res.status !== 'ok' || (res.banned && res.banned.length));
    compile.hidden = !bad;
    if (!bad) return;
    compile.replaceChildren(h('strong', { text: res.status === 'compile_error' ? `The ${LANGS[u.refTab]} solution doesn't compile.` : res.status !== 'ok' ? `The ${LANGS[u.refTab]} solution didn't run.` : `It uses ${res.banned.join(', ')}, which isn't allowed.` }),
      res.message ? h('pre', { class: 'qe-mono', text: res.message }) : null);
  }
  function schedule() {
    clearTimeout(timer);
    seq++;
    timer = setTimeout(run, 900);
  }
  async function run() {
    const r = readCode(q);
    const refs = refLangsOf(q).filter((l) => (q.reference[l] || '').trim());
    const tests = [...r.sample.tests, ...r.hidden.tests];
    if (!refs.length || !tests.length || r.shapeErrors.length || r.sample.errors.length || r.hidden.errors.length) { say(''); return; }
    const one = collect({ title: 'Check', questions: [q] }).questions[0];
    Object.assign(one, { tests: { sample: [], hidden: tests }, rubric: [], points: 1, prompt: one.prompt && one.prompt.trim() ? one.prompt : 'Check' });
    delete one.shared; // sent on its own: the quiz's material and pools aren't there to name
    delete one.pool;
    const key = JSON.stringify(one);
    if (u.checked && u.checked.key === key) { finish(); return; }
    const my = ++seq;
    say('Checking…', 'busy');
    let res;
    try { res = await post('/api/t/check-code', { question: one }); } catch (e) { if (my === seq) say("Couldn't check the tests.", 'no'); return; }
    if (my !== seq) return;
    if (res.status === 'busy') { timer = setTimeout(run, 1500); return; }
    if (res.status === 'offline') { say("Tests can't run here.", ''); return; }
    if (res.status === 'invalid') { say(res.message, 'no'); return; }
    u.checked = { key, sent: grid.sent(), results: res.results };
    finish();
  }
  function finish() {
    if (!u.testsAsText) grid.showResults(u.checked);
    const failing = failingCount(u.checked, q.mode === 'class');
    const broken = Object.entries(u.checked.results).filter(([, x]) => x.status !== 'ok').map(([l]) => l);
    if (broken.length) say(`${names(broken)} didn't run`, 'no');
    else say(failing ? `${plural(failing, 'test')} failing` : 'All pass', failing ? 'no' : 'ok');
    showCompile();
  }

  // ---------- the rest ----------
  const unordered = check(q, q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; schedule(); });
  const rules = rulesPart(q, langs, unordered);
  function sync() {
    const was = q.mode;
    const cols = JSON.stringify(looseSig(u.sig).params.map((p) => p.name)) + u.methods;
    read = readShape(q);
    if (!u.byHand && read) apply(q, read);
    if (q.mode !== was) { touch(q); renderPane(); return; } // a class where a method was: the tests show the other way (and come back)
    if (cols !== JSON.stringify(looseSig(u.sig).params.map((p) => p.name)) + u.methods && !u.testsAsText) grid.draw();
    if (u.editShape) drawForm();
    drawSummary();
    schedule();
  }
  drawTabs();
  drawSummary();
  drawForm();
  drawTests();
  if (u.checked) finish();
  schedule();
  const node = h('div', { class: 'qe-stack qe-codeq' },
    h('section', { class: 'qe-card' },
      h('div', { class: 'qe-tools' }, h('h2', { class: 'qe-card-title', text: 'Solution' }), h('span', { class: 'qe-grow' }), q.languagesAny ? h('span', { class: 't-small t-muted', text: 'Any language' }) : null, tabs),
      ...langs.map((l) => panels[l].el), compile, h('div', {}, starterBtn), summary, formBox),
    h('section', { class: 'qe-card' },
      h('div', { class: 'qe-tools' }, h('h2', { class: 'qe-card-title', text: 'Tests' }), status, h('span', { class: 'qe-grow' }), textBtn), testsBody),
    rules.node);
  return { node, tick: () => rules.tick(readCode(q).rubric) };
}

export { solutionEditor };
