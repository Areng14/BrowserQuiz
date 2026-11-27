// A code question's tests as a table: a method's tests one row each, a column per parameter; a class's
// tests a card each, a row per step. Every edit writes the tests' text (q._ui.sample and hidden), which stays
// what's saved and what "Edit as text" shows. What checking the solutions found sits in each row.

import { ICONS, h, icon } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { BT, LANGS } from './formats.js';
import { touch } from './core.js';

// ---------- the text, as rows ----------
// Splits at sep where it isn't inside a string or brackets
function topSplit(s, sep) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
// "(a, b) -> x speed x10 *2" -> { args, exp, speed, calls, weight }, or { raw } when it doesn't read
function readMethodLine(line) {
  const t = line.trim();
  const [call, ...after] = topSplit(t, ')');
  if (!call.startsWith('(') || !after.length) return { raw: t };
  const inner = call.slice(1);
  let rest = after.join(')').trim();
  const row = { args: inner.trim() ? topSplit(inner, ',').map((a) => a.trim()) : [], exp: '', weight: 1, speed: false, calls: 1 };
  const sp = /(?:^|\s)speed(?:\s+x\s*(\d+))?(?=\s|$)/.exec(rest);
  if (sp) { row.speed = true; row.calls = sp[1] ? Number(sp[1]) : 1; rest = (rest.slice(0, sp.index) + rest.slice(sp.index + sp[0].length)).trim(); }
  const w = /\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(rest);
  if (w) { row.weight = Number(w[1]); rest = rest.slice(0, w.index).trim(); }
  if (rest && !rest.startsWith('->')) return { raw: t };
  if (rest) row.exp = rest.slice(2).trim();
  return row;
}
const methodLine = (r) => (r.raw != null ? r.raw.trim()
  : `(${r.args.join(', ')})${r.exp.trim() ? ` -> ${r.exp.trim()}` : ''}${r.speed ? ` speed${r.calls > 1 ? ` x${r.calls}` : ''}` : ''}${r.weight !== 1 ? ` *${r.weight}` : ''}`);
const emptyRow = (r) => r.raw != null ? !r.raw.trim() : !r.exp.trim() && r.args.every((a) => !a.trim());
// A class test: steps of "call -> expected", "-> ?" for the solution's value, "*2" on its own line
function readClassBlock(block) {
  const t = { steps: [], weight: 1 };
  block.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const w = /^\*\s*(\d+(?:\.\d+)?)$/.exec(line);
    if (w) { t.weight = Number(w[1]); return; }
    const [call, ...exp] = topSplit(line, '->');
    const e = exp.join('->').trim();
    t.steps.push({ call: call.trim(), exp: e === '?' ? '' : e, check: !!exp.length });
  });
  return t;
}
const classBlock = (t) => [...t.steps.filter((s) => s.call.trim() || s.exp.trim())
  .map((s) => `${s.call.trim()}${s.exp.trim() ? ` -> ${s.exp.trim()}` : s.check ? ' -> ?' : ''}`), ...(t.weight !== 1 ? [`*${t.weight}`] : [])].join('\n');
const blocks = (text) => String(text || '').split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);

// ---------- what the check found ----------
const literal = (v) => JSON.stringify(v === undefined ? null : v);
const joinNames = (ls) => ls.map((l) => LANGS[l]).join(ls.length > 2 ? ', ' : ' and ');
// One test (or step) across the languages: { kind: 'pass'|'fail'|'error'|'value'|'none', text, detail, use }
function verdict(per, typed) {
  const langs = Object.keys(per).filter((l) => per[l]);
  if (!langs.length) return { kind: 'none' };
  const err = langs.find((l) => per[l].error);
  if (err) return { kind: 'error', text: 'Error', detail: `${LANGS[err]}: ${per[err].error}` };
  const shown = [...new Set(langs.map((l) => literal(per[l].got)))];
  const says = shown.length === 1
    ? `${joinNames(langs)}${langs.length === 2 ? ' both' : langs.length > 2 ? ' all' : ''} return${langs.length === 1 ? 's' : ''} ${per[langs[0]].shown}.`
    : `${langs.map((l) => `${LANGS[l]} returns ${per[l].shown}`).join(', ')}.`;
  if (typed) {
    if (langs.every((l) => per[l].pass)) return { kind: 'pass', text: 'Passes' };
    return { kind: 'fail', text: shown.length === 1 ? `Got ${per[langs[0]].shown}` : 'Solutions disagree', detail: says, use: shown.length === 1 ? shown[0] : null };
  }
  if (shown.length > 1) return { kind: 'fail', text: 'Solutions disagree', detail: says };
  return { kind: 'value', value: shown[0] };
}
function showVerdict(cell, detail, input, v) {
  cell.className = `qe-tres${v.kind === 'pass' ? ' ok' : v.kind === 'fail' || v.kind === 'error' ? ' no' : ''}`;
  cell.replaceChildren(...(v.kind === 'pass' ? [icon(ICONS.check, 16), v.text] : v.kind === 'fail' || v.kind === 'error' ? [icon(ICONS.x, 16), v.text] : []));
  if (input) input.placeholder = v.kind === 'value' ? `${v.value} (from solution)` : input.dataset.ph || '';
  if (!detail) return;
  detail.hidden = !v.detail;
  if (!v.detail) return;
  detail.replaceChildren(h('span', { text: v.detail }), v.use ? h('button', { class: 'btn small', type: 'button', text: `Use ${v.use}`, onclick: () => { input.value = v.use; input.dispatchEvent(new Event('input', { bubbles: true })); } }) : null);
}

// How many tests fail across the languages: a value that doesn't match, an error, or solutions disagreeing
function failingCount(checked, isClass) {
  const langs = Object.values(checked.results).filter((r) => r.status === 'ok');
  const n = Math.max(0, ...langs.map((r) => r.tests.length));
  let bad = 0;
  for (let k = 0; k < n; k++) {
    const per = langs.map((r) => r.tests[k]).filter(Boolean);
    const failed = per.some((t) => t.error || t.pass === false || (t.steps || []).some((st) => st && st.pass === false));
    const said = new Set(per.map((t) => JSON.stringify(isClass ? (t.steps || []).map((st) => st && st.got) : t.got)));
    if (failed || said.size > 1) bad++;
  }
  return bad;
}

// ---------- the table ----------
// ctx: { params() -> [{ name, type }] | null, methods() -> [{ name, returns }] | null, className(), changed(), langs() }
function testGrid(q, ctx) {
  const u = q._ui;
  const isClass = q.mode === 'class';
  const node = h('div', { class: 'qe-tests' });
  let rows = []; // method: [{ args, exp, weight, speed, calls, sample } | { raw, sample }]; class: [{ steps, weight, sample }]
  let refs = []; // per row (class: per step), what showResults fills in
  const textNow = () => `${u.sample}\u0000${u.hidden}`;
  const load = () => {
    if (u.gridText === textNow() && u.gridRows && u.gridClass === isClass) { rows = u.gridRows; return; }
    rows = isClass
      ? [...blocks(u.sample).map((b) => Object.assign(readClassBlock(b), { sample: true })), ...blocks(u.hidden).map((b) => Object.assign(readClassBlock(b), { sample: false }))]
      : [...u.sample.split('\n').filter((l) => l.trim()).map((l) => Object.assign(readMethodLine(l), { sample: true })),
        ...u.hidden.split('\n').filter((l) => l.trim()).map((l) => Object.assign(readMethodLine(l), { sample: false }))];
    u.gridRows = rows;
    u.gridClass = isClass;
    u.gridText = textNow(); // read again only when the text changes some other way (Edit as text)
  };
  // the rows back to text: what's saved, read and checked
  const write = () => {
    const kinds = (sample) => rows.filter((r) => r.sample === sample);
    if (isClass) {
      u.sample = kinds(true).map(classBlock).filter(Boolean).join('\n\n');
      u.hidden = kinds(false).map(classBlock).filter(Boolean).join('\n\n');
    } else {
      u.sample = kinds(true).filter((r) => !emptyRow(r)).map(methodLine).join('\n');
      u.hidden = kinds(false).filter((r) => !emptyRow(r)).map(methodLine).join('\n');
    }
    u.gridText = textNow();
    touch(q);
    ctx.changed();
  };
  // the sample ones first, as they're saved
  const order = () => { rows = [...rows.filter((r) => r.sample), ...rows.filter((r) => !r.sample)]; u.gridRows = rows; };

  const cellInput = (value, label, onInput, extra) => {
    const el = h('input', Object.assign({ class: 'input qe-mono', value, 'aria-label': label, spellcheck: 'false', autocomplete: 'off' }, extra || {}));
    el.addEventListener('input', () => onInput(el.value));
    return el;
  };
  const xBtn = (label, onclick) => h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': label, title: 'Remove', onclick }, icon(ICONS.x, 16));
  const focusLast = (sel) => { const all = node.querySelectorAll(sel); if (all.length) all[all.length - 1].focus(); };

  function methodTable() {
    const params = ctx.params();
    const n = params ? params.length : -1; // -1: not known yet, so one column for all of them
    const cols = `${n < 0 ? 'minmax(0, 1fr)' : n ? `repeat(${n}, minmax(0, 1fr))` : ''} minmax(120px, 200px) 128px 64px 34px`.trim();
    const head = h('div', { class: 'qe-trow qe-thead', role: 'row', style: `grid-template-columns: ${cols}` },
      ...(n < 0 ? [h('span', { role: 'columnheader', text: 'Arguments' })]
        : params.map((p) => h('span', { role: 'columnheader' }, h('span', { class: 'qe-mono qe-tname', text: p.name }), ' ', h('span', { class: 'qe-mono', text: p.type })))),
      h('span', { role: 'columnheader', text: 'Expected' }), h('span', { role: 'columnheader', text: 'Result' }),
      h('span', { role: 'columnheader', title: 'Students can run it', text: 'Sample' }), h('span', { role: 'columnheader' }, h('span', { class: 'qe-sr', text: 'More' })));
    refs = [];
    const body = rows.map((r, i) => {
      const k = i + 1;
      const cells = [];
      if (r.raw != null) cells.push(cellInput(r.raw, `Test ${k}`, (v) => { r.raw = v; write(); }, { style: `grid-column: span ${Math.max(1, n) + 1}` }));
      else {
        const args = n < 0 ? [r.args.join(', ')] : Array.from({ length: n }, (_, j) => (j === n - 1 && r.args.length > n ? r.args.slice(j).join(', ') : r.args[j] || ''));
        args.forEach((a, j) => cells.push(cellInput(a, n < 0 ? `Arguments for test ${k}` : `${params[j].name} for test ${k}`, (v) => {
          if (n < 0) r.args = v.trim() ? topSplit(v, ',').map((x) => x.trim()) : [];
          else { while (r.args.length < n) r.args.push(''); if (j === n - 1 && r.args.length > n) r.args.splice(j); r.args[j] = v; }
          write();
        })));
      }
      const exp = r.raw != null ? null : cellInput(r.exp, `Expected for test ${k}`, (v) => { r.exp = v; write(); });
      const res = h('span', { class: 'qe-tres', role: 'cell' });
      const detail = h('div', { class: 'qe-tdetail', hidden: true, role: 'note' });
      const sample = h('input', { type: 'checkbox', checked: r.sample, 'aria-label': `Sample: students can run test ${k}` });
      sample.addEventListener('change', () => { r.sample = sample.checked; order(); write(); draw(); });
      const items = [
        { text: r.weight !== 1 ? 'Count once' : 'Count double', onclick: () => { r.weight = r.weight !== 1 ? 1 : 2; write(); draw(); } },
        ctx.langs().every((l) => BT.hasSpeed(l)) && r.raw == null ? { text: r.speed ? 'Not a speed test' : 'Make it a speed test', tip: 'Calls it many times; code over 10 times slower than your solution fails it.', onclick: () => { r.speed = !r.speed; if (r.speed) r.calls = r.calls > 1 ? r.calls : 1000; write(); draw(); } } : null,
        { text: 'Remove test', danger: true, onclick: () => { rows.splice(i, 1); write(); draw(); } }];
      const marks = [r.weight !== 1 ? `×${r.weight}` : '', r.speed ? 'speed' : ''].filter(Boolean).join(' ');
      if (exp) {
        exp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        if (marks) exp.title = marks;
      }
      refs.push({ text: () => methodLine(r), res, detail, input: exp, typed: () => r.raw == null && !!r.exp.trim() });
      const row = h('div', { class: 'qe-trow', role: 'row', style: `grid-template-columns: ${cols}` },
        ...cells.map((c) => h('span', { role: 'cell', class: 'qe-tcell' }, c)),
        exp ? h('span', { role: 'cell', class: 'qe-tcell' }, exp, marks ? h('span', { class: 'qe-tmark qe-mono', text: marks }) : null) : null,
        res, h('span', { role: 'cell', class: 'qe-tcheck' }, sample),
        h('span', { role: 'cell' }, moreMenu(`More for test ${k}`, `qe-test-${i}`, items)));
      return [row, detail];
    });
    return h('div', { class: 'qe-ttable', role: 'table', 'aria-label': 'Tests' }, head, ...body.flat());
  }

  function classCards() {
    const methods = ctx.methods() || [];
    const returnsOf = (call) => { const m = /(?:^|\.)([A-Za-z_]\w*)\s*\(/.exec(call); const f = m && methods.find((x) => x.name === m[1]); return f ? f.returns : null; };
    refs = [];
    return h('div', { class: 'qe-stack' }, ...rows.map((t, i) => {
      const k = i + 1;
      const sample = h('input', { type: 'checkbox', checked: t.sample });
      sample.addEventListener('change', () => { t.sample = sample.checked; order(); write(); draw(); });
      const steps = t.steps.map((s, j) => {
        const isNew = /^\s*(?:[A-Za-z_]\w*\s*=\s*)?new\s/.test(s.call);
        const ret = returnsOf(s.call);
        const none = isNew || ret === 'void';
        const call = cellInput(s.call, `Test ${k}, step ${j + 1}`, (v) => { s.call = v; const r2 = returnsOf(v); if (!s.exp.trim()) s.check = !!r2 && r2 !== 'void'; write(); });
        const exp = none ? null : cellInput(s.exp, `Expected for test ${k}, step ${j + 1}`, (v) => { s.exp = v; if (!v.trim()) s.check = true; write(); },
          { placeholder: s.check ? '' : 'Not checked', 'data-ph': s.check ? '' : 'Not checked' });
        if (exp) exp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(t); } });
        const res = h('span', { class: 'qe-tres', role: 'cell' });
        const detail = h('div', { class: 'qe-tdetail', hidden: true, role: 'note' });
        refs.push({ test: i, step: j, res, detail, input: exp, typed: () => !!s.exp.trim(), none });
        return [h('div', { class: 'qe-trow qe-tstep', role: 'row' },
          h('span', { role: 'cell', class: 'qe-tcell' }, call),
          h('span', { role: 'cell', class: 'qe-tcell' }, exp || h('span', { class: 't-muted', title: 'Returns nothing', text: '—' })),
          res, h('span', { role: 'cell' }, xBtn(`Remove step ${j + 1} of test ${k}`, () => { t.steps.splice(j, 1); if (!t.steps.length) rows.splice(i, 1); write(); draw(); }))), detail];
      });
      return h('div', { class: 'qe-tcard', role: 'table', 'aria-label': `Test ${k}` },
        h('div', { class: 'qe-tcard-head' }, h('span', { class: 'qe-tcard-title', text: `Test ${k}` }),
          t.weight !== 1 ? h('span', { class: 'qe-mono t-muted', title: 'Counts double', text: `×${t.weight}` }) : null, h('span', { class: 'qe-grow' }),
          h('label', { class: 't-check', title: 'Students can run it' }, sample, h('span', { text: 'Sample' })),
          moreMenu(`More for test ${k}`, `qe-ctest-${i}`, [
            { text: t.weight !== 1 ? 'Count once' : 'Count double', onclick: () => { t.weight = t.weight !== 1 ? 1 : 2; write(); draw(); } },
            { text: 'Remove test', danger: true, onclick: () => { rows.splice(i, 1); write(); draw(); } }])),
        h('div', { class: 'qe-trow qe-tstep qe-thead', role: 'row' }, ...['Call', 'Expected', 'Result'].map((x) => h('span', { role: 'columnheader', text: x })), h('span', { role: 'columnheader' }, h('span', { class: 'qe-sr', text: 'Remove' }))),
        ...steps.flat(),
        h('div', { class: 'qe-tfoot' }, h('button', { class: 'btn small qe-plain', type: 'button', onclick: () => addStep(t) }, icon(ICONS.plus, 16), 'Add step')));
    }));
  }

  function add() {
    if (isClass) {
      rows.push({ steps: [{ call: `new ${ctx.className() || 'Thing'}()`, exp: '', check: false }], weight: 1, sample: !rows.some((r) => r.sample) });
      draw();
      focusLast('.qe-tcard:last-child .qe-tcell input');
      return;
    }
    const params = ctx.params();
    rows.push({ args: params ? params.map(() => '') : [], exp: '', weight: 1, speed: false, calls: 1, sample: !rows.some((r) => r.sample) });
    order();
    draw();
    const all = node.querySelectorAll('.qe-ttable .qe-trow:not(.qe-thead)');
    const last = [...all].find((el, k) => rows[k] === rows[rows.length - 1]) || all[all.length - 1];
    const first = last && last.querySelector('input.input');
    if (first) first.focus();
  }
  function addStep(t) {
    t.steps.push({ call: '', exp: '', check: true });
    draw();
    const card = node.querySelectorAll('.qe-tcard')[rows.indexOf(t)];
    const callInputs = card ? card.querySelectorAll('.qe-tstep:not(.qe-thead) > .qe-tcell:first-child input') : [];
    if (callInputs.length) callInputs[callInputs.length - 1].focus();
  }

  let last = null; // the newest check, shown again after a redraw
  function draw() {
    load();
    const list = isClass ? classCards() : methodTable();
    const addBtn = h('button', { class: 'btn small qe-plain', type: 'button', onclick: add }, icon(ICONS.plus, 16), 'Add test');
    node.replaceChildren(rows.length || isClass ? list : h('p', { class: 't-muted t-small', text: 'No tests yet.' }), h('div', { class: isClass ? '' : 'qe-tfoot' }, addBtn));
    if (rows.length && !isClass) node.firstChild.append(node.lastChild);
    showResults(last);
  }
  // checked: { sent: [text of each test], results: { lang: { status, tests } } } or null
  function showResults(checked) {
    last = checked;
    const at = new Map((checked ? checked.sent : []).map((t, k) => [t, k]));
    const per = (k, pick) => Object.fromEntries(Object.entries(checked ? checked.results : {}).map(([l, r]) => [l, r.status === 'ok' && r.tests[k] ? pick(r.tests[k]) : null]));
    let failing = 0;
    for (const ref of refs) {
      let v = { kind: 'none' };
      if (isClass) {
        const k = at.get(classBlock(rows[ref.test]));
        if (k !== undefined && !ref.none) v = verdict(per(k, (t) => (t.error ? { error: t.error } : t.steps && t.steps[ref.step])), ref.typed());
      } else {
        const k = at.get(ref.text());
        if (k !== undefined) v = verdict(per(k, (t) => t), ref.typed());
      }
      if (v.kind === 'fail' || v.kind === 'error') failing++;
      showVerdict(ref.res, ref.detail, ref.input, v);
    }
    return failing;
  }
  // the tests as checked: method lines, or class blocks, in the order they're sent
  const sent = () => (isClass ? rows.map(classBlock).filter(Boolean) : rows.filter((r) => !emptyRow(r)).map(methodLine));
  draw();
  return { node, draw, showResults, sent };
}

export { failingCount, readClassBlock, readMethodLine, testGrid };
