// Code: what students read (output, trace and fill questions), and code questions with their tests.

import { ICONS, h, icon, plural } from '../dash/core.js';
import { ed } from './state.js';
import { BT, LANGS, countBlanks } from './formats.js';
import { readCode, realign, refLangsOf, starterCode } from './model.js';
import { codeKeys, grow, insert } from './editing.js';
import { area, card, check, field, input, touch } from './core.js';
import { BAN_HINT, rubricEditor } from './prompt.js';
import { renderPane } from './pane.js';

// ---------- the code students read: output, trace and fill questions ----------
const codeAttrs = (rows, more) => Object.assign({ rows, class: 'input qe-area qe-mono qe-code', autocomplete: 'off' }, more || {});
function langSelect(q, onChange) {
  const sel = h('select', { class: 'input qe-narrow', 'aria-label': 'Language' }, Object.entries(LANGS).map(([v, t]) => h('option', { value: v, text: t, selected: (q.language || (ed.quiz.language === 'none' ? 'java' : ed.quiz.language)) === v })));
  sel.addEventListener('change', () => { q.language = sel.value; if (onChange) onChange(); touch(q); });
  return sel;
}
const codeHead = (q, label, onLang, ...tools) => h('div', { class: 'qe-tools' },
  h('label', { class: 'field-label', for: 'qe-code', text: label }), h('span', { class: 'qe-grow' }), ...tools, langSelect(q, onLang));

function outputEditor(q) {
  const u = q._ui;
  const out = area(q, q.answer, (v) => { if (v.trim()) q.answer = v; else delete q.answer; },
    codeAttrs(2, { 'data-out': '', placeholder: 'Leave empty. Saving runs the code and fills this in' }));
  // An output the server worked out goes stale when the code changes; one typed here stays, as a check.
  const stale = () => { if (q.answer != null && q.answer === u.auto) { delete q.answer; out.value = ''; grow(out); } };
  const code = area(q, q.code, (v) => { q.code = v; stale(); }, codeAttrs(5, { id: 'qe-code', placeholder: OUTPUT_HINT[q.language || ed.quiz.language] || OUTPUT_HINT.java }));
  codeKeys(code);
  return [h('div', { class: 'field' }, codeHead(q, 'Code', stale), code), field('Output', out)];
}

const OUTPUT_HINT = {
  java: 'int x = 7;\nSystem.out.println(x / 2);', python: 'x = 7\nprint(x // 2)', javascript: 'const x = 7;\nconsole.log(Math.floor(x / 2));',
  typescript: 'const x: number = 7;\nconsole.log(Math.floor(x / 2));', c: 'int x = 7;\nprintf("%d\\n", x / 2);', cpp: 'int x = 7;\ncout << x / 2 << endl;',
  go: 'x := 7\nfmt.Println(x / 2)', rust: 'let x = 7;\nprintln!("{}", x / 2);', csharp: 'int x = 7;\nConsole.WriteLine(x / 2);',
};
function traceEditor(q) {
  const u = q._ui;
  const code = area(q, q.code, (v) => { q.code = v; }, codeAttrs(4, { id: 'qe-code' }));
  codeKeys(code);
  const cell = (r, c) => ed.pane.querySelector(`.qe-grid input[data-r="${r}"][data-c="${c}"]`);
  const edit = (fn, r, c) => { fn(); touch(q); renderPane(); const el = cell(r, c); if (el) el.focus(); };
  const addRow = (r, c) => edit(() => u.cells.push(u.cols.map(() => ({ v: '', given: false }))), r, c);
  const wide = u.cols.length >= 8;
  const tall = u.cells.length >= 40;
  const head = h('tr', {}, u.cols.map((name, c) => {
    const el = input(q, name, (v) => { u.cols[c] = v; }, { type: 'text', class: 'qe-gridcell', placeholder: 'Name', 'aria-label': `Column ${c + 1}`, 'data-r': '-1', 'data-c': c, maxlength: '40', autocomplete: 'off', spellcheck: 'false' });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const next = cell(0, c); if (next) next.focus(); } });
    return h('th', {}, h('div', { class: 'qe-cell' }, el,
      h('button', { class: 'qe-tool', type: 'button', title: 'Remove column', 'aria-label': `Remove column ${c + 1}`, disabled: u.cols.length <= 1,
        onclick: () => edit(() => { u.cols.splice(c, 1); u.cells.forEach((row) => row.splice(c, 1)); }) }, icon(ICONS.x, 14))));
  }), h('td', { class: 'qe-grid-side' }, h('button', { class: 'btn small', type: 'button', text: 'Add column', disabled: wide,
    onclick: () => edit(() => { u.cols.push(''); u.cells.forEach((row) => row.push({ v: '', given: false })); }, -1, u.cols.length) })));
  const body = u.cells.map((row, r) => h('tr', {}, row.map((cl, c) => {
    const td = h('td', { class: cl.given ? 'given' : '' });
    const el = input(q, cl.v, (v) => { cl.v = v; }, { type: 'text', class: 'qe-gridcell', 'aria-label': `${u.cols[c] || `Column ${c + 1}`}, row ${r + 1}`, 'data-r': r, 'data-c': c, autocomplete: 'off', spellcheck: 'false' });
    // Enter goes down the column, like a spreadsheet, and adds a row at the bottom.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (cell(r + 1, c)) cell(r + 1, c).focus(); else if (!tall) addRow(r + 1, c);
    });
    // A block copied from a spreadsheet fills the cells from here.
    el.addEventListener('paste', (e) => {
      const text = (e.clipboardData.getData('text') || '').replace(/\r/g, '').replace(/\n+$/, '');
      if (!/[\t\n]/.test(text)) return;
      e.preventDefault();
      edit(() => text.split('\n').forEach((line, i) => {
        if (r + i >= 40) return;
        while (u.cells.length <= r + i) u.cells.push(u.cols.map(() => ({ v: '', given: false })));
        line.split('\t').forEach((v, k) => { if (u.cells[r + i][c + k]) u.cells[r + i][c + k].v = v.trim(); });
      }), r, c);
    });
    const given = h('input', { type: 'checkbox', checked: cl.given, title: 'Given to students', 'aria-label': `Given to students: ${u.cols[c] || `column ${c + 1}`}, row ${r + 1}` });
    given.addEventListener('change', () => { cl.given = given.checked; td.classList.toggle('given', cl.given); touch(q); });
    td.append(h('div', { class: 'qe-cell' }, el, given));
    return td;
  }), h('td', { class: 'qe-grid-side' }, h('button', { class: 'qe-tool', type: 'button', title: 'Remove row', 'aria-label': `Remove row ${r + 1}`, disabled: u.cells.length <= 1,
    onclick: () => edit(() => u.cells.splice(r, 1)) }, icon(ICONS.x, 14)))));
  return [h('div', { class: 'field' }, codeHead(q, 'Code (optional)'), code),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Table, with the correct values' }),
      h('div', { class: 'qe-grid-wrap' }, h('table', { class: 'qe-grid' }, h('thead', {}, head), h('tbody', {}, body))),
      h('div', { class: 'qe-line' },
        h('button', { class: 'btn small', type: 'button', text: 'Add row', disabled: tall, onclick: () => addRow(u.cells.length, 0) })))];
}

function fillEditor(q) {
  const u = q._ui;
  const list = h('div', { class: 'qe-blanks' });
  const label = h('span', { class: 'field-label', text: 'Accepted answers for each blank, one per line' });
  function renderBlanks() {
    const lines = [];
    (q.code || '').split('\n').forEach((line) => { for (let k = countBlanks(line); k > 0; k--) lines.push(line.trim()); });
    list.replaceChildren(...u.blanks.map((text, k) => {
      const ta = area(q, text, (v) => { u.blanks[k] = v; }, { rows: 1, class: 'input qe-area qe-mono', 'aria-label': `Accepted answers for blank ${k + 1}`, autocomplete: 'off' });
      return h('div', { class: 'qe-blank' }, h('span', { class: 'qe-row-n', text: String(k + 1) }), h('div', { class: 'qe-stack qe-tight' }, h('code', { class: 't-small t-muted qe-blank-line', text: lines[k] || '' }), ta));
    }));
    list.querySelectorAll('textarea').forEach(grow);
    label.hidden = !u.blanks.length;
  }
  const code = area(q, q.code, (v) => { u.blanks = realign(q.code || '', v, u.blanks); q.code = v; renderBlanks(); },
    codeAttrs(6, { id: 'qe-code', placeholder: 'int total = ___;\nfor (int n : nums) {\n    total ___ n;\n}' }));
  codeKeys(code);
  // Write working code, then turn pieces of it into blanks: the piece becomes the blank's answer.
  const makeBlank = () => {
    const start = code.selectionStart;
    const text = code.value.slice(start, code.selectionEnd).trim();
    const k = countBlanks(code.value.slice(0, start));
    insert(code, '___');
    if (text && u.blanks[k] === '') { u.blanks[k] = text; renderBlanks(); touch(q); }
  };
  const run = check(q, u.run, 'Grade by running tests', (v) => { u.run = v; if (v && !q.mode) q.mode = 'method'; renderPane(); });
  return {
    after: renderBlanks,
    nodes: [
      h('div', { class: 'field' }, codeHead(q, 'Code', null, h('button', { class: 'qe-tool', type: 'button', text: 'Blank', title: 'Turn the selected code into a blank', onclick: makeBlank })), code),
      h('div', { class: 'field' }, label, list),
      run,
      u.run ? h('p', { class: 't-small t-muted', text: 'The code has to be the whole class.' }) : null],
  };
}

// ---------- code questions, and fill questions graded by running ----------
function codeEditor(q) {
  const u = q._ui;
  const fill = q.type === 'fill';
  const from = fill ? 'your answers for the blanks' : 'the reference solution';
  const isClass = q.mode === 'class';
  // "Any language": every language that can run the question (the server leaves out the ones that can't)
  const anyBox = check(q, !!q.languagesAny, 'Any language', (v) => {
    q.languages = v ? Object.keys(LANGS) : refLangsOf(q);
    q.languagesAny = v;
    renderPane();
  });
  const langBox = (el) => { el.classList.add('qe-lang'); return el; };
  const langs = fill ? null : h('div', { class: 'qe-langs', role: 'group', 'aria-label': 'Languages' }, langBox(anyBox),
    q.languagesAny ? null : Object.entries(LANGS).map(([l, name]) => langBox(check(q, q.languages.includes(l), name, (v) => {
      q.languages = Object.keys(LANGS).filter((x) => (x === l ? v : q.languages.includes(x)));
      if (!q.languages.length) q.languages = [l === 'java' ? 'python' : 'java'];
      renderPane();
    }))));
  const mode = h('select', { class: 'input qe-narrow', 'aria-label': 'What students write' },
    h('option', { value: 'method', text: 'Write a method', selected: !isClass }),
    h('option', { value: 'class', text: 'Write a class', selected: isClass }));
  mode.addEventListener('change', () => {
    q.mode = mode.value;
    u.sample = '';
    u.hidden = '';
    touch(q);
    renderPane();
  });
  const mono = { class: 'input qe-mono', spellcheck: 'false', autocomplete: 'off' };
  const shapeNote = h('p', { class: 't-small qe-note' });
  const notes = { sample: h('p', { class: 't-small qe-note' }), hidden: h('p', { class: 't-small qe-note' }) };
  const tests = (kind, rows, placeholder) => area(q, u[kind], (v) => { u[kind] = v; }, { rows, placeholder, class: 'input qe-area qe-mono qe-code', 'data-tests': kind });
  const starters = [];
  const refLangs = fill ? [] : refLangsOf(q);
  // One language's reference at a time, with a tab for each
  if (!refLangs.includes(u.refTab)) u.refTab = refLangs[0];
  const tabbed = refLangs.length > 1;
  const panels = refLangs.map((l) => {
    const ta = area(q, (q.reference || {})[l], (v) => { q.reference = Object.assign({}, q.reference, { [l]: v }); }, { rows: 8, class: 'input qe-area qe-mono qe-code' });
    codeKeys(ta);
    const btn = h('button', { class: 'btn small', type: 'button', text: 'Insert the starter code', onclick: () => {
      const shape = readCode(q).shape;
      if (!shape) return;
      ta.select();
      insert(ta, starterCode(shape, l, false));
    } });
    starters.push({ ta, btn });
    const label = h('label', { class: 'field' }, h('span', { class: `field-label${tabbed ? ' qe-sr' : ''}`, text: `Reference solution (${LANGS[l]})` }), ta);
    return h('div', { class: 'qe-ref', id: `qe-ref-${l}`, role: tabbed ? 'tabpanel' : null, hidden: l !== u.refTab }, label, h('div', {}, btn));
  });
  const tabs = tabbed ? h('div', { class: 't-tabs qe-reftabs', role: 'tablist', 'aria-label': 'Reference solutions' }, refLangs.map((l) => h('button', {
    class: 't-tab', type: 'button', role: 'tab', 'aria-selected': String(l === u.refTab), 'aria-controls': `qe-ref-${l}`, text: LANGS[l],
    onclick: (e) => {
      u.refTab = l;
      for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-selected', String(b === e.currentTarget));
      panels.forEach((p, k) => { p.hidden = refLangs[k] !== l; });
      const ta = panels[refLangs.indexOf(l)].querySelector('textarea');
      grow(ta);
    },
  }))) : null;
  const refs = [tabs, ...panels];
  // With "any", a reference in another language is one pick away
  const more = q.languagesAny ? Object.keys(LANGS).filter((l) => !refLangs.includes(l)) : [];
  if (more.length) {
    const add = h('select', { class: 'input qe-narrow', 'aria-label': 'Add a reference solution' },
      h('option', { value: '', text: 'Add a reference in…' }), more.map((l) => h('option', { value: l, text: LANGS[l] })));
    add.addEventListener('change', () => { if (add.value) { u.refLangs = [...(u.refLangs || refLangs), add.value]; u.refTab = add.value; renderPane(); } });
    refs.push(h('div', { class: 'qe-line' }, add));
  }
  const rubric = fill ? null : rubricEditor(q, 'Uses private instance variables', refLangs);
  // Methods students may not use: comma separated, one list for every language or one per language (a
  // Class.method entry names one language's class). Using one scores 0 (server/src/bans.js).
  const banLangs = q.languages.filter(BT.hasBans);
  const parse = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const cppOnly = (l) => l === 'cpp' || (!l && banLangs.length === 1 && banLangs[0] === 'cpp');
  const banField = (label, list, set, hint, l) => field(label, input(q, list.map((b) => (cppOnly(l) ? b.replace('.', '::') : b)).join(', '), (v) => set(parse(v)),
    { class: 'input qe-mono', placeholder: hint, spellcheck: 'false' }));
  let bans = null;
  if (!fill) {
    const perLang = !!q.ban && !Array.isArray(q.ban);
    const fields = perLang
      ? banLangs.map((l) => banField(`Not allowed in ${LANGS[l]}`, q.ban[l] || [], (list) => {
        if (list.length) q.ban[l] = list; else delete q.ban[l];
      }, BAN_HINT[l], l))
      : [banField('Not allowed (methods students may not use)', q.ban || [], (list) => { if (list.length) q.ban = list; else delete q.ban; },
        banLangs.length === 1 ? BAN_HINT[banLangs[0]] : banLangs.every((l) => l === 'java' || l === 'python') ? BAN_HINT.java + ', sorted' : 'sort')];
    const split = banLangs.length > 1 && !q.languagesAny ? check(q, perLang, 'Per language', (v) => {
      const all = [...new Set(Array.isArray(q.ban) ? q.ban : Object.values(q.ban || {}).flat())];
      if (v) q.ban = Object.fromEntries(banLangs.map((l) => [l, all.slice()]));
      else if (all.length) q.ban = all; else delete q.ban;
      renderPane();
    }) : null;
    bans = h('div', { class: 'qe-stack' }, ...fields, split);
  }

  const tick = () => {
    const r = readCode(q);
    const hasRef = fill || q.languages.some((l) => ((q.reference || {})[l] || '').trim());
    shapeNote.textContent = r.shapeErrors.join('\n') || `Types: ${BT.HELP}${isClass ? ', void' : ''}`;
    shapeNote.classList.toggle('t-error', !!r.shapeErrors.length);
    for (const kind of ['sample', 'hidden']) {
      const p = r[kind];
      const open = isClass ? 0 : p.tests.filter((t) => t.expected === undefined).length;
      notes[kind].textContent = p.errors.map((e) => e[0].toUpperCase() + e.slice(1)).join('\n')
        || (p.tests.length ? `${plural(p.tests.length, 'test')}${p.tests.some((t) => t.speed) ? `, ${plural(p.tests.filter((t) => t.speed).length, 'speed test')}` : ''}${open && hasRef ? `, ${open} filled in from ${from} when you save` : ''}` : '');
      notes[kind].classList.toggle('t-error', !!p.errors.length);
    }
    for (const s of starters) { s.btn.hidden = !!s.ta.value.trim(); s.btn.disabled = !r.shape; }
    if (rubric) rubric.worth.textContent = q.rubric.some((x) => x.text.trim()) && r.rubric < Number(q.points) ? `Tests are worth ${Number(q.points) - r.rubric} of ${q.points}` : '';
  };

  const emptyClass = isClass && !fill ? check(q, q.starter === 'empty', 'Start with an empty class', (v) => { if (v) q.starter = 'empty'; else delete q.starter; }) : null;
  const shape = [
    h('div', { class: 'qe-line' }, mode, emptyClass),
    langs,
    isClass
      ? [h('div', { class: 'qe-pair' },
        field('Class name', input(q, u.className, (v) => { u.className = v; }, Object.assign({}, mono, { placeholder: 'BankAccount' }))),
        field('Constructor', input(q, u.ctor, (v) => { u.ctor = v; }, Object.assign({}, mono, { placeholder: '(owner: string, balance: double)' })))),
      field('Methods, one per line', area(q, u.methods, (v) => { u.methods = v; }, { rows: 3, class: 'input qe-area qe-mono', placeholder: 'deposit(amount: double): void\ngetBalance(): double' }))]
      : field('Signature', input(q, u.sig, (v) => { u.sig = v; }, Object.assign({}, mono, { placeholder: 'countVowels(s: string): int' }))),
    fill ? null : field('Classes (optional, one per line)', area(q, u.types, (v) => { u.types = v; }, { rows: 1, class: 'input qe-area qe-mono', placeholder: 'Point(x: int, y: int)' })),
    shapeNote];
  const testFields = [
    field('Sample tests (students can run these)', tests('sample', 2, isClass ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2'), notes.sample),
    field('Hidden tests (used for grading)', tests('hidden', 4, isClass ? 'a = new BankAccount("Jo", 20.0)\na.withdraw(50.0) -> false\na.getBalance() -> ?\n*2' : '("AEIOU") -> 5\n("rhythm") -> 0\n("Programming is fun") *2'), notes.hidden),
    h('p', { class: 't-muted t-small', text: isClass
      ? `A blank line starts the next test. -> ? takes the value from ${from}. A line with *2 makes the test count double.`
      : `One test per line. Leave out -> to take the value from ${from}. *2 at the end counts double.` })];
  const unordered = check(q, q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; });
  const noRun = check(q, !!q.noRun, "Students can't run their code (like on paper)", (v) => { if (v) q.noRun = true; else delete q.noRun; });
  const stack = (...kids) => h('div', { class: 'qe-stack' }, ...kids);
  // A fill question has no reference field: what students are to write, then the tests.
  if (fill) return { node: h('div', { class: 'qe-codegrid' }, card('What students write', shape, noRun), card('Tests', testFields, unordered)), tick };
  // Bans and the rubric are folded away until one is set; folded, the heading says what's there.
  const said = [];
  const banned = [...new Set(Array.isArray(q.ban) ? q.ban : Object.values(q.ban || {}).flat())];
  if (banned.length) said.push(`Not allowed: ${banned.slice(0, 4).join(', ')}${banned.length > 4 ? ', …' : ''}`);
  const items = q.rubric.filter((x) => x.text.trim()).length;
  if (items) said.push(plural(items, 'rubric item'));
  if (q.noRun) said.push("Students can't run their code");
  const rules = h('details', { class: 'qe-card qe-rules', open: said.length > 0 },
    h('summary', {}, h('span', { class: 'qe-card-title', text: 'Rules and grading' }), said.length ? h('span', { class: 't-small t-muted qe-rules-said', text: said.join(' · ') }) : null),
    h('div', { class: 'qe-stack' }, bans, rubric.node, noRun));
  return { tick, node: h('div', { class: 'qe-codegrid' },
    stack(card('What students write', shape), card('Tests', testFields, unordered)),
    stack(card(tabbed ? 'Reference solutions' : 'Reference solution', refs), rules)) };
}

export { codeEditor, fillEditor, outputEditor, traceEditor };
