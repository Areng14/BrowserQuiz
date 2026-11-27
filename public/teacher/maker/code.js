// Code: what students read (output, trace and fill questions), and code questions with their tests.

import { ICONS, h, icon, plural, tip } from '../dash/core.js';
import { ed } from './state.js';
import { BT, LANGS, countBlanks } from './formats.js';
import { readCode, realign } from './model.js';
import { codeKeys, grow, insert } from './editing.js';
import { area, card, check, field, input, touch } from './core.js';
import { BAN_HINT, rubricEditor } from './prompt.js';
import { colored, recolor } from './colors.js';
import { renderPane } from './pane.js';

// ---------- the code students read: output, trace and fill questions ----------
const codeAttrs = (rows, more) => Object.assign({ rows, class: 'input qe-area qe-mono qe-code', autocomplete: 'off' }, more || {});
const langOf = (q) => () => q.language || (ed.quiz.language === 'none' ? 'java' : ed.quiz.language);
function langSelect(q, onChange) {
  const sel = h('select', { class: 'input qe-narrow', 'aria-label': 'Language' }, Object.entries(LANGS).map(([v, t]) => h('option', { value: v, text: t, selected: (q.language || (ed.quiz.language === 'none' ? 'java' : ed.quiz.language)) === v })));
  sel.addEventListener('change', () => { q.language = sel.value; if (onChange) onChange(); touch(q); recolor(ed.pane); });
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
  return [h('div', { class: 'field' }, codeHead(q, 'Code', stale), colored(code, langOf(q))), field('Output', out)];
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
  return [h('div', { class: 'field' }, codeHead(q, 'Code (optional)'), colored(code, langOf(q))),
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
      h('div', { class: 'field' }, codeHead(q, 'Code', null, h('button', { class: 'qe-tool', type: 'button', text: 'Blank', title: 'Turn the selected code into a blank', onclick: makeBlank })), colored(code, langOf(q), { blanks: true })),
      h('div', { class: 'field' }, label, list),
      run,
      u.run ? h('p', { class: 't-small t-muted', text: 'The code has to be the whole class.' }) : null],
  };
}

// ---------- fill questions graded by running ----------
// (Code questions are written solution first: codeq.js.)
function codeEditor(q) {
  const u = q._ui;
  const isClass = q.mode === 'class';
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
  const testsField = (label, box, note, what) => (what ? tip(field(label, box, note), box.querySelector('textarea'), what) : field(label, box, note));
  const tests = (kind, rows, placeholder) => colored(area(q, u[kind], (v) => { u[kind] = v; }, { rows, placeholder, class: 'input qe-area qe-mono qe-code', 'data-tests': kind }),
    () => q.language || (ed.quiz.language === 'none' ? 'java' : ed.quiz.language));
  const tick = () => {
    const r = readCode(q);
    shapeNote.textContent = r.shapeErrors.join('\n') || `Types: ${BT.HELP}${isClass ? ', void' : ''}`;
    shapeNote.classList.toggle('t-error', !!r.shapeErrors.length);
    for (const kind of ['sample', 'hidden']) {
      const p = r[kind];
      const open = isClass ? 0 : p.tests.filter((t) => t.expected === undefined).length;
      notes[kind].textContent = p.errors.map((e) => e[0].toUpperCase() + e.slice(1)).join('\n')
        || (p.tests.length ? `${plural(p.tests.length, 'test')}${open ? `, ${open} filled in from your answers for the blanks when you save` : ''}` : '');
      notes[kind].classList.toggle('t-error', !!p.errors.length);
    }
  };
  const shape = [
    h('div', { class: 'qe-line' }, mode),
    isClass
      ? [h('div', { class: 'qe-pair' },
        field('Class name', input(q, u.className, (v) => { u.className = v; }, Object.assign({}, mono, { placeholder: 'BankAccount' }))),
        field('Constructor', input(q, u.ctor, (v) => { u.ctor = v; }, Object.assign({}, mono, { placeholder: '(owner: string, balance: double)' })))),
      field('Methods, one per line', area(q, u.methods, (v) => { u.methods = v; }, { rows: 3, class: 'input qe-area qe-mono', placeholder: 'deposit(amount: double): void\ngetBalance(): double' }))]
      : field('Signature', input(q, u.sig, (v) => { u.sig = v; }, Object.assign({}, mono, { placeholder: 'countVowels(s: string): int' }))),
    shapeNote];
  const testFields = [
    testsField('Sample tests (students can run these)', tests('sample', 2, isClass ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2'), notes.sample,
      "Students can run these while they work to see what their code returns. They don't affect the grade."),
    testsField('Hidden tests (used for grading)', tests('hidden', 4, isClass ? 'a = new BankAccount("Jo", 20.0)\na.withdraw(50.0) -> false\na.getBalance() -> ?\n*2' : '("AEIOU") -> 5\n("rhythm") -> 0\n("Programming is fun") *2'), notes.hidden),
    h('p', { class: 't-muted t-small', text: isClass
      ? 'A blank line starts the next test. -> ? takes the value from your answers for the blanks. A line with *2 makes the test count double.'
      : 'One test per line. Leave out -> to take the value from your answers for the blanks. *2 at the end counts double.' })];
  const unordered = check(q, q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; });
  const noRun = check(q, !!q.noRun, "Students can't run their code (like on paper)", (v) => { if (v) q.noRun = true; else delete q.noRun; });
  return { node: h('div', { class: 'qe-codegrid' }, card('What students write', shape, noRun), card('Tests', testFields, unordered)), tick };
}

// ---------- a code question's rules: bans, the rubric, running ----------
// Folded away until one is set; folded, the heading says what's there. extra: more of the same kind.
function rulesPart(q, refLangs, ...extra) {
  const rubric = rubricEditor(q, 'Uses private instance variables', refLangs);
  // Methods students may not use: comma separated, one list for every language or one per language (a
  // Class.method entry names one language's class). Using one scores 0 (server/src/bans.js).
  const banLangs = q.languages.filter(BT.hasBans);
  const parse = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const cppOnly = (l) => l === 'cpp' || (!l && banLangs.length === 1 && banLangs[0] === 'cpp');
  const banField = (label, list, set, hint, l) => {
    const box = input(q, list.map((b) => (cppOnly(l) ? b.replace('.', '::') : b)).join(', '), (v) => set(parse(v)), { class: 'input qe-mono', placeholder: hint, spellcheck: 'false' });
    return tip(field(label, box), box, "An answer that uses any of these scores 0.");
  };
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
  const noRun = check(q, !!q.noRun, "Students can't run their code (like on paper)", (v) => { if (v) q.noRun = true; else delete q.noRun; });
  const said = [];
  const banned = [...new Set(Array.isArray(q.ban) ? q.ban : Object.values(q.ban || {}).flat())];
  if (banned.length) said.push(`Not allowed: ${banned.slice(0, 4).join(', ')}${banned.length > 4 ? ', …' : ''}`);
  const items = q.rubric.filter((x) => x.text.trim()).length;
  if (items) said.push(plural(items, 'rubric item'));
  if (q.noRun) said.push("Students can't run their code");
  if (q.compare === 'unordered') said.push('Lists in any order');
  const node = h('details', { class: 'qe-card qe-rules', open: said.length > 0 },
    h('summary', {}, h('span', { class: 'qe-card-title', text: 'Rules and grading' }), said.length ? h('span', { class: 't-small t-muted qe-rules-said', text: said.join(' · ') }) : null),
    h('div', { class: 'qe-stack' }, h('div', { class: 'qe-stack' }, ...fields, split), rubric.node, noRun, ...extra));
  // what the rubric leaves the tests
  const tick = (rubricPoints) => {
    const any = q.rubric.some((x) => x.text.trim());
    rubric.worth.textContent = !any ? '' : rubricPoints < Number(q.points) ? `Tests are worth ${Number(q.points) - rubricPoints} of ${q.points}`
      : `The rubric is worth all ${q.points} points, so the tests count for nothing.`;
    rubric.worth.classList.toggle('qe-off', any && rubricPoints >= Number(q.points));
  };
  return { node, tick };
}

export { codeEditor, fillEditor, langOf, outputEditor, rulesPart, traceEditor };
