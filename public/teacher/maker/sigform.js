// What students write, set by hand: the form behind Edit, for when the solution doesn't say it (or says it
// wrong). It edits the same text the solution fills in (q._ui.sig, or className, ctor and methods), so
// whichever wrote it last is what's saved.

import { ICONS, h, icon } from '../dash/core.js';
import { moreMenu } from '../dash/cells.js';
import { BT, sigText } from './formats.js';
import { area, check, touch } from './core.js';

// "name(a: int, b: map<string, int>): int" -> { name, params, returns }, reading what it can
function looseSig(text) {
  const m = /^\s*([A-Za-z_]\w*)?\s*\(([^)]*)\)\s*(?::\s*(.*?))?\s*$/.exec(text || '');
  if (!m) return { name: '', params: [], returns: '' };
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of m[2]) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const params = parts.map((p) => { const pm = /^\s*([A-Za-z_]\w*)?\s*(?::\s*(.*?))?\s*$/.exec(p) || []; return { name: pm[1] || '', type: (pm[2] || '').trim() }; });
  return { name: m[1] || '', params, returns: (m[3] || '').trim() };
}
const COMMON = ['int', 'long', 'double', 'boolean', 'string', 'char', 'int[]', 'long[]', 'double[]', 'boolean[]', 'string[]', 'char[]',
  'int[][]', 'double[][]', 'string[][]', 'char[][]', 'list<int>', 'list<double>', 'list<string>', 'map<string, int>', 'map<string, string>',
  'map<string, double>', 'map<int, int>', 'map<int, string>', 'map<string, list<int>>', 'map<string, list<string>>'];
const classNames = (u) => String(u.types || '').split('\n').map((l) => (/^\s*([A-Z]\w*)\s*\(/.exec(l) || [])[1]).filter(Boolean);
function typeSelect(u, value, label, withVoid, onChange) {
  const own = classNames(u).flatMap((c) => [c, `${c}[]`, `list<${c}>`]);
  const list = [...(withVoid ? ['void'] : []), ...COMMON, ...own];
  const canon = BT.canon(value);
  const known = list.find((t) => BT.canon(t) === canon);
  const sel = h('select', { class: 'input qe-mono', 'aria-label': label },
    !value || value === '?' ? h('option', { value: '', text: 'Choose…', selected: true, disabled: true }) : null,
    value && value !== '?' && !known ? h('option', { value, text: value, selected: true }) : null,
    list.map((t) => h('option', { value: t, text: t, selected: t === known })));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// params: [{ name, type }], edited in place; what: 'Parameter' | 'Constructor parameter'
function paramRows(u, params, what, changed) {
  const box = h('div', { class: 'qe-stack qe-tight' });
  const draw = () => {
    box.replaceChildren(...params.map((p, k) => {
      const name = h('input', { class: 'input qe-mono', value: p.name, 'aria-label': `${what} ${k + 1} name`, spellcheck: 'false', autocomplete: 'off', placeholder: 'name' });
      name.addEventListener('input', () => { p.name = name.value.trim(); changed(); });
      return h('div', { class: 'qe-param' }, name,
        typeSelect(u, p.type, `${what} ${k + 1} type`, false, (v) => { p.type = v; changed(); }),
        h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': `Remove ${p.name || `${what.toLowerCase()} ${k + 1}`}`, title: 'Remove',
          onclick: () => { params.splice(k, 1); changed(); draw(); } }, icon(ICONS.x, 16)));
    }), h('div', {}, h('button', { class: 'btn small qe-plain', type: 'button', onclick: () => { params.push({ name: '', type: 'int' }); changed(); draw(); box.querySelectorAll('.qe-param input')[params.length - 1].focus(); } },
      icon(ICONS.plus, 16), 'Add parameter')));
  };
  draw();
  return box;
}
const field = (label, el) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);
const group = (label, el) => h('div', { class: 'field', role: 'group', 'aria-label': label }, h('span', { class: 'field-label', text: label }), el);
const nameInput = (value, label, on) => {
  const el = h('input', { class: 'input qe-mono', value, spellcheck: 'false', autocomplete: 'off', 'aria-label': label });
  el.addEventListener('input', () => on(el.value.trim()));
  return el;
};

// changed(): after any edit (the shape is the teacher's from then on); fromSolution(): back to reading it
function shapeForm(q, changed, fromSolution) {
  const u = q._ui;
  const done = () => { u.byHand = true; touch(q); changed(); };
  const isClass = q.mode === 'class';
  const mode = h('select', { class: 'input' }, h('option', { value: 'method', text: 'A method', selected: !isClass }), h('option', { value: 'class', text: 'A class', selected: isClass }));
  mode.addEventListener('change', () => { q.mode = mode.value; u.sample = ''; u.hidden = ''; u.byHand = true; touch(q); changed(true); });
  const parts = [field('Students write', mode)];
  if (!isClass) {
    const s = looseSig(u.sig);
    const save = () => { u.sig = sigText(s.name, s.params, s.returns || '?'); done(); };
    parts.push(field('Method name', nameInput(s.name, 'Method name', (v) => { s.name = v; save(); })),
      group('Parameters', paramRows(u, s.params, 'Parameter', save)),
      field('Returns', typeSelect(u, s.returns, 'Returns', false, (v) => { s.returns = v; save(); })));
  } else {
    const ctor = looseSig(`${u.className || ''}(${(looseSig(u.ctor || '()').params).map((p) => `${p.name}: ${p.type}`).join(', ')})`);
    const methods = String(u.methods || '').split('\n').filter((l) => l.trim()).map(looseSig);
    const save = () => {
      u.className = ctor.name;
      u.ctor = ctor.params.length ? sigText('', ctor.params, '') : '';
      u.methods = methods.map((m) => sigText(m.name, m.params, m.returns || '?')).join('\n');
      done();
    };
    const list = h('div', { class: 'qe-stack qe-tight' });
    const drawMethods = () => list.replaceChildren(...methods.map((m, k) => {
      const open = u.openMethod === k;
      const sum = h('button', { class: 'qe-msum', type: 'button', 'aria-expanded': String(open), onclick: () => { u.openMethod = open ? -1 : k; drawMethods(); } },
        icon(open ? ICONS.chevron : ICONS.next, 16),
        h('span', { class: 'qe-mono qe-msig', text: `${m.name || 'method'}(${m.params.map((p) => `${p.name}: ${p.type}`).join(', ')})` }),
        h('span', { class: 'qe-mono t-muted', text: m.returns || '?' }));
      return h('div', { class: `qe-method${open ? ' open' : ''}` },
        h('div', { class: 'qe-method-head' }, sum, moreMenu(`More for ${m.name || `method ${k + 1}`}`, `qe-method-${k}`,
          [{ text: 'Remove method', danger: true, onclick: () => { methods.splice(k, 1); save(); drawMethods(); } }])),
        open ? h('div', { class: 'qe-stack qe-method-body' },
          field('Method name', nameInput(m.name, 'Method name', (v) => { m.name = v; save(); })),
          group('Parameters', paramRows(u, m.params, 'Parameter', save)),
          field('Returns', typeSelect(u, m.returns, 'Returns', true, (v) => { m.returns = v; save(); }))) : null);
    }), h('div', {}, h('button', { class: 'btn small qe-plain', type: 'button', onclick: () => { methods.push({ name: '', params: [], returns: 'void' }); u.openMethod = methods.length - 1; drawMethods(); list.querySelector('.qe-method.open input').focus(); } },
      icon(ICONS.plus, 16), 'Add method')));
    drawMethods();
    parts.push(field('Class name', nameInput(ctor.name, 'Class name', (v) => { ctor.name = v; save(); })),
      group('Constructor parameters', paramRows(u, ctor.params, 'Constructor parameter', save)),
      group('Methods', list),
      check(q, q.starter === 'empty', 'Start with an empty class', (v) => { if (v) q.starter = 'empty'; else delete q.starter; }));
  }
  parts.push(field('Classes (optional, one per line)', area(q, u.types, (v) => { u.types = v; changed(); }, { rows: 1, class: 'input qe-area qe-mono', placeholder: 'Point(x: int, y: int)' })));
  return h('div', { class: 'qe-sigform' }, h('div', { class: 'qe-sigform-grid' }, ...parts),
    u.byHand ? h('div', {}, h('button', { class: 'btn small', type: 'button', text: 'Read it from the solution', onclick: fromSolution })) : null);
}

export { looseSig, shapeForm };
