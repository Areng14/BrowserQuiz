// Code: what students read (output, trace and fill questions), and the rules of questions graded by running.

import { ICONS, h, icon, plural, tip } from '../dash/core.js';
import { ed } from './state.js';
import { BT, LANGS, countBlanks } from './formats.js';
import { realign } from './model.js';
import { codeKeys, grow, insert } from './editing.js';
import { area, check, field, input, touch } from './core.js';
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

// hooks.changed(): after the code or an answer changes (the tests, when it's graded by running)
function fillEditor(q, hooks) {
  const u = q._ui;
  const changed = () => { if (hooks.changed) hooks.changed(); };
  const compile = h('div', { class: 'qe-compile', role: 'alert', hidden: true });
  const list = h('div', { class: 'qe-blanks' });
  const label = h('span', { class: 'field-label', text: 'Accepted answers for each blank, one per line' });
  function renderBlanks() {
    const lines = [];
    (q.code || '').split('\n').forEach((line) => { for (let k = countBlanks(line); k > 0; k--) lines.push(line.trim()); });
    list.replaceChildren(...u.blanks.map((text, k) => {
      const ta = area(q, text, (v) => { u.blanks[k] = v; changed(); }, { rows: 1, class: 'input qe-area qe-mono', 'aria-label': `Accepted answers for blank ${k + 1}`, autocomplete: 'off' });
      return h('div', { class: 'qe-blank' }, h('span', { class: 'qe-row-n', text: String(k + 1) }), h('div', { class: 'qe-stack qe-tight' }, h('code', { class: 't-small t-muted qe-blank-line', text: lines[k] || '' }), ta));
    }));
    list.querySelectorAll('textarea').forEach(grow);
    label.hidden = !u.blanks.length;
  }
  const code = area(q, q.code, (v) => { u.blanks = realign(q.code || '', v, u.blanks); q.code = v; renderBlanks(); changed(); },
    codeAttrs(6, { id: 'qe-code', placeholder: 'int total = ___;\nfor (int n : nums) {\n    total ___ n;\n}' }));
  codeKeys(code);
  // Write working code, then turn pieces of it into blanks: the piece becomes the blank's answer.
  const makeBlank = () => {
    const start = code.selectionStart;
    const text = code.value.slice(start, code.selectionEnd).trim();
    const k = countBlanks(code.value.slice(0, start));
    insert(code, '___');
    if (text && u.blanks[k] === '') { u.blanks[k] = text; renderBlanks(); touch(q); changed(); }
  };
  const run = check(q, u.run, 'Grade by running tests', (v) => { u.run = v; if (v && !q.mode) q.mode = 'method'; renderPane(); });
  return {
    after: renderBlanks,
    compile,
    nodes: [
      h('div', { class: 'field' }, codeHead(q, 'Code', () => { if (u.run) renderPane(); }, h('button', { class: 'qe-tool', type: 'button', text: 'Blank', title: 'Turn the selected code into a blank', onclick: makeBlank })), colored(code, langOf(q), { blanks: true }), compile),
      h('div', { class: 'field' }, label, list),
      run,
      u.run ? h('p', { class: 't-small t-muted', text: 'The code has to be the whole class.' }) : null],
  };
}

// ---------- a code question's rules: bans, the rubric, running ----------
// Folded away until one is set; folded, the heading says what's there. extra: more of the same kind.
// A fill question graded by running gets the running rules only: its students write blanks, not code.
function rulesPart(q, refLangs, ...extra) {
  const fill = q.type === 'fill';
  const rubric = fill ? null : rubricEditor(q, 'Uses private instance variables', refLangs);
  // Methods students may not use: comma separated, one list for every language or one per language (a
  // Class.method entry names one language's class). Using one scores 0 (server/src/bans.js).
  const banLangs = fill ? [] : q.languages.filter(BT.hasBans);
  const parse = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const cppOnly = (l) => l === 'cpp' || (!l && banLangs.length === 1 && banLangs[0] === 'cpp');
  const banField = (label, list, set, hint, l) => {
    const box = input(q, list.map((b) => (cppOnly(l) ? b.replace('.', '::') : b)).join(', '), (v) => set(parse(v)), { class: 'input qe-mono', placeholder: hint, spellcheck: 'false' });
    return tip(field(label, box), box, "An answer that uses any of these scores 0.");
  };
  const perLang = !!q.ban && !Array.isArray(q.ban);
  const fields = fill ? [] : perLang
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
  const items = (q.rubric || []).filter((x) => x.text.trim()).length;
  if (items) said.push(plural(items, 'rubric item'));
  if (q.noRun) said.push("Students can't run their code");
  if (q.compare === 'unordered') said.push('Lists in any order');
  const node = h('details', { class: 'qe-card qe-rules', open: said.length > 0 },
    h('summary', {}, h('span', { class: 'qe-card-title', text: 'Rules and grading' }), said.length ? h('span', { class: 't-small t-muted qe-rules-said', text: said.join(' · ') }) : null),
    h('div', { class: 'qe-stack' }, fields.length ? h('div', { class: 'qe-stack' }, ...fields, split) : null, rubric && rubric.node, noRun, ...extra));
  // what the rubric leaves the tests
  const tick = (rubricPoints) => {
    if (!rubric) return;
    const any = q.rubric.some((x) => x.text.trim());
    rubric.worth.textContent = !any ? '' : rubricPoints < Number(q.points) ? `Tests are worth ${Number(q.points) - rubricPoints} of ${q.points}`
      : `The rubric is worth all ${plural(Number(q.points), 'point')}, so the tests count for nothing.`;
    rubric.worth.classList.toggle('qe-off', any && rubricPoints >= Number(q.points));
  };
  return { node, tick };
}

export { fillEditor, langOf, outputEditor, rulesPart, traceEditor };
