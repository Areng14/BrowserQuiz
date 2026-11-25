// The calculator a quiz can allow (quiz.calculator: "scientific" or "graphing"). Ported from AlgebraLoop:
// the engine (window.BQCalc, /vendor/calc) does the maths, MathLive (/vendor/mathlive) is the display.
// Both load the first time a student opens it. A floating panel the student can drag (docked at the
// bottom on a phone), with a Calculate screen and, for "graphing", a Graph screen.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const PLACE_KEY = 'bq.calculator';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    for (const kid of kids) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function icon(paths, size) {
    const s = svg('svg', { width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const d of paths) s.append(svg('path', { d }));
    return s;
  }
  const calcIcon = () => icon(['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8 7h8v3H8z', 'M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01M16 17.5h.01']);

  // ---------- loading ----------
  const loaded = {};
  function script(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = h('script', { src });
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Could not load the calculator.')); };
      document.head.append(s);
    });
    return loaded[src];
  }
  function engine(base) { return window.BQCalc ? Promise.resolve(window.BQCalc) : script(base + 'calc/calc.js').then(() => window.BQCalc); }
  function mathlive(base) {
    const ready = window.MathLive ? Promise.resolve() : script(base + 'mathlive/mathlive.min.js');
    return ready.then(() => {
      const M = window.MathLive.MathfieldElement;
      M.fontsDirectory = base + 'mathlive/fonts';
      M.soundsDirectory = null; // never a sound in an exam room
      return window.MathLive;
    });
  }

  // ---------- where it was ----------
  function recall() {
    try {
      const v = JSON.parse(sessionStorage.getItem(PLACE_KEY) || 'null') || {};
      return {
        position: v.position && Number.isFinite(v.position.x) && Number.isFinite(v.position.y) ? v.position : null,
        mode: v.mode === 'degrees' ? 'degrees' : 'radians',
        screen: v.screen === 'graph' ? 'graph' : 'calculate',
      };
    } catch (e) { return { position: null, mode: 'radians', screen: 'calculate' }; }
  }
  function remember(state) {
    try { sessionStorage.setItem(PLACE_KEY, JSON.stringify({ position: state.position, mode: state.mode, screen: state.screen })); } catch (e) { /* this page only */ }
  }
  const phone = () => window.matchMedia('(max-width: 560px)').matches;

  // ---------- completion: the list of names, and the shape of the call being typed ----------
  function suggestionList(id, C, entries, highlighted, onPick) {
    if (!entries.length) return null;
    return h('ul', { class: 'calc-suggest', id: id + '-suggestions', role: 'listbox', 'aria-label': 'Functions' },
      entries.map((entry, i) => h('li', {},
        h('button', {
          type: 'button', role: 'option', 'aria-selected': String(i === highlighted), class: i === highlighted ? 'chosen' : null,
          onmousedown: (e) => e.preventDefault(), onclick: () => onPick(entry),
        }, h('code', { text: C.signature(entry) }), h('span', { text: entry.summary })))));
  }
  function signatureLine(entry, argument) {
    return h('p', { class: 'calc-sig' },
      h('code', {}, entry.name + '(', entry.params.map((name, i) => h('span', { class: i === argument ? 'on' : null },
        (i >= entry.required ? '[' + name + ']' : name) + (i < entry.params.length - 1 ? ', ' : ''))), ')'),
      h('span', { text: entry.example || entry.summary }));
  }

  // ---------- the Calculate screen ----------
  // label, then the LaTeX it writes: #0 is where the caret lands, #@ takes what precedes it
  const KEYS = [
    ['sin', '\\sin(#0)'], ['cos', '\\cos(#0)'], ['tan', '\\tan(#0)'], ['ln', '\\ln(#0)'],
    ['sin⁻¹', '\\arcsin(#0)'], ['cos⁻¹', '\\arccos(#0)'], ['tan⁻¹', '\\arctan(#0)'], ['√', '\\sqrt{#0}'],
    ['log', '\\log(#0)'], ['eˣ', '\\exp(#0)'], ['n!', '!'], [',', ','],
    ['xʸ', '#@^{#0}'], ['x²', '#@^2'], ['(', '('], [')', ')'],
    ['[', '\\lbrack'], [']', '\\rbrack'], ['π', '\\pi'], ['e', 'e'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '\\frac{#@}{#0}'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['×', '\\times'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'],
    ['0', '0'], ['.', '.'], ['∞', '\\infty'], ['+', '+'],
  ];
  const FUNCTION_KEYS = 20;
  const OPERATORS = ['+', '-', '\\times', '\\frac{#@}{#0}'];
  const KEY_NAMES = {
    '√': 'Square root', 'xʸ': 'Power', 'x²': 'Squared', ln: 'Natural logarithm', log: 'Logarithm base ten',
    'eˣ': 'e to the power', 'n!': 'Factorial', ',': 'Comma', '[': 'Open a list', ']': 'Close a list', '∞': 'Infinity',
    '÷': 'Fraction', 'sin⁻¹': 'Inverse sine', 'cos⁻¹': 'Inverse cosine', 'tan⁻¹': 'Inverse tangent', '−': 'Minus', '×': 'Times',
  };
  const asLatex = (rows) => rows.length === 1 && rows[0].length === 1 ? '(' + rows[0][0] + ')' : '\\begin{bmatrix}' + rows.map((r) => r.join('&')).join('\\\\') + '\\end{bmatrix}';

  function readout(rows, error) {
    const box = h('div', { class: 'calc-readout', 'aria-live': 'polite', 'aria-atomic': 'true' });
    if (error) box.append(h('span', { class: 'calc-error', text: error }));
    else if (!rows) box.append(h('span', { class: 'calc-empty', 'aria-hidden': 'true', text: '= 0' }));
    else if (rows.length === 1 && rows[0].length === 1) box.append(h('output', { class: 'calc-single' }, h('span', { class: 'calc-eq', text: '=' }), ' ' + rows[0][0]));
    else {
      box.append(h('output', { class: 'calc-matrix' }, h('span', { class: 'calc-bracket', 'aria-hidden': 'true' }),
        h('table', {}, h('tbody', {}, rows.map((row) => h('tr', {}, row.map((v) => h('td', { text: v })))))),
        h('span', { class: 'calc-bracket right', 'aria-hidden': 'true' })));
    }
    return box;
  }

  function calculateScreen(C, ML, state) {
    const id = 'calc-input';
    const field = new ML.MathfieldElement({ smartFence: true });
    field.id = id;
    field.className = 'calc-mathfield';
    field.mathVirtualKeyboardPolicy = 'manual';
    field.setAttribute('aria-label', 'Calculator expression');
    const display = h('div', { class: 'calc-display' }, field);
    const below = h('div', { class: 'calc-below' });
    const said = h('span', { class: 'calc-sr', 'aria-live': 'polite' });
    let result = null; // { value, mode }
    let error = '';
    let prefix = { ascii: '', latex: '' };
    let chosen = null;
    let dismissed = false;
    const out = h('div', { class: 'calc-out' });

    function show() {
      const rows = result && result.mode === state.mode ? C.presentValue(result.value) : null;
      out.replaceChildren(readout(rows, error));
      ans.disabled = !rows;
      ans.rows = rows;
    }
    let last = '';
    function edited() {
      // MathLive sends input events a moment late (and one more after Enter): one for the expression the
      // answer is for mustn't wipe the answer
      const now = field.getValue('ascii-math');
      if (now === last) return;
      last = now;
      result = null; error = ''; chosen = null; dismissed = false; show(); requestAnimationFrame(readPrefix);
    }
    function readPrefix() {
      try { const to = field.position; prefix = { ascii: field.getValue(0, to, 'ascii-math'), latex: field.getValue(0, to, 'latex') }; } catch (e) { prefix = { ascii: '', latex: '' }; }
      complete();
    }
    let current = [];
    function complete() {
      const word = C.wordInAscii(prefix.ascii);
      current = dismissed ? [] : C.complete(word);
      const hi = current.length && chosen !== null ? chosen % current.length : 0;
      const call = current.length ? null : C.callInLatex(prefix.latex);
      below.replaceChildren(suggestionList(id, C, current, hi, accept) || '', call ? signatureLine(call.entry, call.argument) : '');
      field.setAttribute('aria-expanded', String(current.length > 0));
      said.textContent = current.length ? `${current.length} functions match. ${C.signature(current[hi])}. Tab to take it.` : '';
    }
    function accept(entry) {
      const word = C.wordInAscii(prefix.ascii);
      for (let i = 0; i < word.length; i++) field.executeCommand('deleteBackward');
      field.executeCommand(['insert', `\\operatorname{${entry.name}}(#0)`, { focus: true }]);
      chosen = null; dismissed = false;
      requestAnimationFrame(readPrefix);
    }
    function submit() {
      if (state.disabled) return;
      last = field.getValue('ascii-math');
      try { result = { value: C.evaluate(last, state.mode), mode: state.mode }; error = ''; } catch (e) { result = null; error = (e && e.message) || 'Check the expression and its closing brackets.'; }
      show();
    }
    function type(latex) { field.executeCommand(['insert', latex, { focus: true }]); }

    field.addEventListener('input', edited);
    field.addEventListener('selection-change', readPrefix);
    // MathLive handles arrows, Tab and Enter itself, so the list sees them first (capture phase)
    field.addEventListener('keydown', (e) => {
      if (current.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          chosen = ((chosen || 0) + (e.key === 'ArrowDown' ? 1 : current.length - 1)) % current.length;
          return complete();
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && chosen !== null)) {
          e.preventDefault(); e.stopPropagation();
          return accept(current[chosen === null ? 0 : chosen % current.length]);
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed = true; return complete(); }
      }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
    }, { capture: true });

    const keep = (e) => e.preventDefault(); // keep the caret in the display
    const ans = h('button', { type: 'button', 'aria-label': 'Insert the last answer', disabled: true, onmousedown: keep, onclick: () => ans.rows && type(asLatex(ans.rows)) }, 'Ans');
    const keys = h('div', { class: 'calc-keys' },
      KEYS.map(([label, latex], i) => h('button', {
        type: 'button', class: i < FUNCTION_KEYS ? 'fn' : OPERATORS.includes(latex) ? 'op' : null,
        'aria-label': KEY_NAMES[label] || label, onmousedown: keep, onclick: () => type(latex),
      }, label)),
      h('button', { type: 'button', onmousedown: keep, onclick: () => { field.setValue(''); last = ''; result = null; error = ''; show(); readPrefix(); field.focus(); } }, 'Clear'),
      h('button', { type: 'button', 'aria-label': 'Backspace', onmousedown: keep, onclick: () => { field.executeCommand('deleteBackward'); field.focus(); } }, icon(['M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M18 9l-6 6M12 9l6 6'], 18)),
      ans,
      h('button', { type: 'button', class: 'eq', 'aria-label': 'Calculate', onmousedown: keep, onclick: submit }, '='));

    const el = h('div', { class: 'calc-screen' },
      h('div', { class: 'calc-editor' }, display, below), said, out, keys);
    show();
    return {
      el,
      focus: () => field.focus(),
      mounted() {
        field.inlineShortcuts = {}; // the language has names like "inf" and "or"; no surprise symbols
        // MathLive's own text box inside it is named after what's typed, and nothing while it's empty:
        // name it then, so a screen reader still says what it is
        const sink = field.shadowRoot && field.shadowRoot.querySelector('.ML__keyboard-sink');
        if (sink) {
          const name = () => { if (!sink.getAttribute('aria-label')) sink.setAttribute('aria-label', 'Calculator expression'); };
          new MutationObserver(name).observe(sink, { attributes: true, attributeFilter: ['aria-label'] });
          name();
        }
      },
      modeChanged: show,
    };
  }

  // ---------- the Graph screen ----------
  const W = 320, HT = 220, PAD = 2, SNAP = 11, REACH = 26;
  function tickStep(span) { const rough = span / 8; const p = 10 ** Math.floor(Math.log10(rough)); const n = rough / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; }
  function ticks(from, to) { const step = tickStep(to - from); const out = []; for (let v = Math.ceil(from / step) * step; v <= to; v += step) out.push(Number(v.toPrecision(12))); return out; }
  const short = (v) => Math.abs(v) >= 10000 || (Math.abs(v) < 0.001 && v !== 0) ? v.toExponential(0) : String(Number(v.toPrecision(4)));
  const settle = (w) => ({ xMin: Number(w.xMin.toPrecision(6)), xMax: Number(w.xMax.toPrecision(6)), yMin: Number(w.yMin.toPrecision(6)), yMax: Number(w.yMax.toPrecision(6)) });

  function textField(C, id, label, placeholder, onChange) {
    const input = h('input', { class: 'calc-text', id, type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', role: 'combobox', 'aria-label': label, 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': id + '-suggestions', placeholder });
    const below = h('div', { class: 'calc-below' });
    let chosen = null, dismissed = false, current = [], word = { word: '', from: 0 };
    function caret() { return input.selectionStart == null ? input.value.length : input.selectionStart; }
    function refresh() {
      word = C.wordAt(input.value, caret());
      current = dismissed ? [] : C.complete(word.word);
      const hi = chosen === null ? 0 : chosen % current.length;
      const call = current.length ? null : C.callAt(input.value, caret());
      below.replaceChildren(suggestionList(id, C, current, hi, accept) || '', call ? signatureLine(call.entry, call.argument) : '');
      input.setAttribute('aria-expanded', String(current.length > 0));
    }
    function accept(entry) {
      const at = caret();
      input.value = input.value.slice(0, word.from) + entry.name + '(' + input.value.slice(at);
      const pos = word.from + entry.name.length + 1;
      input.focus(); input.setSelectionRange(pos, pos);
      chosen = null; dismissed = false;
      onChange(input.value); refresh();
    }
    input.addEventListener('input', () => { chosen = null; dismissed = false; onChange(input.value); refresh(); });
    for (const ev of ['keyup', 'click', 'select']) input.addEventListener(ev, refresh);
    input.addEventListener('blur', () => { chosen = null; setTimeout(() => { if (document.activeElement !== input) below.replaceChildren(); }, 150); });
    input.addEventListener('keydown', (e) => {
      if (!current.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); chosen = ((chosen || 0) + (e.key === 'ArrowDown' ? 1 : current.length - 1)) % current.length; refresh(); }
      else if (e.key === 'Tab' || (e.key === 'Enter' && chosen !== null)) { e.preventDefault(); accept(current[chosen === null ? 0 : chosen % current.length]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed = true; refresh(); }
    });
    return { el: h('div', { class: 'calc-editor' }, input, below), input };
  }

  function graphScreen(C, state) {
    const exprs = ['', '', ''];
    let win = Object.assign({}, C.DEFAULT_WINDOW);
    let curves = [], paths = [], features = [], trace = null, answer = '', error = '';
    const plot = svg('svg', { class: 'calc-plot', viewBox: `0 0 ${W} ${HT}`, tabindex: 0, role: 'img' });
    const out = h('div', { class: 'calc-readout quiet', 'aria-live': 'polite' });
    const from = h('input', { type: 'text', inputmode: 'decimal', value: '0', 'aria-label': 'Area from' });
    const to = h('input', { type: 'text', inputmode: 'decimal', value: '1', 'aria-label': 'Area to' });

    const toX = (x) => PAD + ((x - win.xMin) / (win.xMax - win.xMin)) * (W - 2 * PAD);
    const toY = (y) => HT - PAD - ((y - win.yMin) / (win.yMax - win.yMin)) * (HT - 2 * PAD);
    const readable = (x) => { const per = (win.xMax - win.xMin) / W; return Number(x.toFixed(Math.max(0, Math.ceil(-Math.log10(per)) + 1))); };

    function compile() {
      curves = [];
      exprs.forEach((e, i) => { if (!e.trim()) return; try { curves.push({ expression: e, row: i, f: C.compileFunction(e, 'x', state.mode) }); } catch (x) { /* named in the readout */ } });
      recompute();
    }
    function recompute() {
      paths = curves.map((c) => C.samplePaths(c.f, win));
      features = [];
      curves.forEach((c, i) => {
        for (const x of C.zeros(c.f, win)) features.push({ x, y: 0, curve: i, kind: 'zero' });
        for (const p of C.extrema(c.f, win)) features.push({ x: p.x, y: p.y, curve: i, kind: p.kind });
        if (win.xMin <= 0 && win.xMax >= 0) { const y = c.f(0); if (Number.isFinite(y)) features.push({ x: 0, y, curve: i, kind: 'y-intercept' }); }
      });
      for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
        for (const p of C.intersections(curves[i].f, curves[j].f, win)) features.push({ x: p.x, y: p.y, curve: i, kind: 'intersection' });
      }
      draw();
    }
    function nearest(px, py) {
      let snapped = null, best = SNAP;
      for (const f of features) { const d = Math.hypot(toX(f.x) - px, toY(f.y) - py); if (d < best) { best = d; snapped = f; } }
      if (snapped) return snapped;
      let close = null; best = REACH;
      paths.forEach((cp, i) => { for (const path of cp) for (const p of path) { const d = Math.hypot(toX(p.x) - px, toY(p.y) - py); if (d < best) { best = d; const x = readable(p.x); close = { x, y: curves[i].f(x), curve: i }; } } });
      return close;
    }
    function at(e) { const r = plot.getBoundingClientRect(); return r.width ? { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * HT } : null; }
    const pointers = new Map();
    let gesture = null;
    function follow(e) { const p = at(e); if (p) { trace = nearest(p.px, p.py); draw(); } }
    plot.addEventListener('pointerdown', (e) => {
      const p = at(e); if (!p) return;
      pointers.set(e.pointerId, p);
      if (!(e.button === 1 || pointers.size === 2)) return follow(e);
      e.preventDefault(); plot.setPointerCapture(e.pointerId);
      const marks = [...pointers.values()];
      gesture = { px: marks.reduce((t, m) => t + m.px, 0) / marks.length, py: marks.reduce((t, m) => t + m.py, 0) / marks.length, apart: marks.length === 2 ? Math.hypot(marks[0].px - marks[1].px, marks[0].py - marks[1].py) : 0, win };
      trace = null; draw();
    });
    plot.addEventListener('pointermove', (e) => {
      const p = at(e); if (!p) return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (!gesture) return follow(e);
      const marks = [...pointers.values()];
      const px = marks.reduce((t, m) => t + m.px, 0) / marks.length, py = marks.reduce((t, m) => t + m.py, 0) / marks.length;
      const apart = marks.length === 2 ? Math.hypot(marks[0].px - marks[1].px, marks[0].py - marks[1].py) : 0;
      const k = gesture.apart && apart ? gesture.apart / apart : 1;
      const s = gesture.win, sx = (s.xMax - s.xMin) * k, sy = (s.yMax - s.yMin) * k;
      if (sx < 1e-6 || sx > 1e9) return;
      const x = s.xMin + ((gesture.px - PAD) / (W - 2 * PAD)) * (s.xMax - s.xMin);
      const y = s.yMin + ((HT - PAD - gesture.py) / (HT - 2 * PAD)) * (s.yMax - s.yMin);
      const xMin = x - ((px - PAD) / (W - 2 * PAD)) * sx, yMin = y - ((HT - PAD - py) / (HT - 2 * PAD)) * sy;
      win = settle({ xMin, xMax: xMin + sx, yMin, yMax: yMin + sy });
      recompute();
    });
    const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) gesture = null; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) plot.addEventListener(ev, release);
    plot.addEventListener('pointerleave', () => { if (!gesture) { trace = null; draw(); } });
    plot.addEventListener('auxclick', (e) => e.preventDefault());
    plot.addEventListener('dblclick', () => { trace = null; win = Object.assign({}, C.DEFAULT_WINDOW); recompute(); });
    plot.addEventListener('blur', () => { trace = null; draw(); });
    plot.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = plot.getBoundingClientRect();
      const steps = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const k = Math.min(2, Math.max(0.5, Math.exp(steps * 0.0015)));
      const sx = win.xMax - win.xMin, sy = win.yMax - win.yMin;
      if (sx * k < 1e-6 || sx * k > 1e9) return;
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * HT;
      const x = win.xMin + ((px - PAD) / (W - 2 * PAD)) * sx, y = win.yMin + ((HT - PAD - py) / (HT - 2 * PAD)) * sy;
      trace = null;
      win = settle({ xMin: x - (x - win.xMin) * k, xMax: x + (win.xMax - x) * k, yMin: y - (y - win.yMin) * k, yMax: y + (win.yMax - y) * k });
      recompute();
    }, { passive: false });
    // arrows walk the trace along the curve
    plot.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir || !curves.length) return;
      e.preventDefault();
      const i = trace ? trace.curve : 0, c = curves[i] || curves[0];
      const x = (trace ? trace.x : (win.xMin + win.xMax) / 2) + dir * ((win.xMax - win.xMin) / W) * (e.shiftKey ? 10 : 2);
      const near = features.find((f) => f.curve === i && Math.abs(toX(f.x) - toX(x)) < SNAP / 2 && (!trace || dir * (f.x - trace.x) > 0));
      const step = readable(x);
      trace = near || { x: step, y: c.f(step), curve: i };
      draw();
    });

    function draw() {
      plot.replaceChildren();
      const label = curves.length
        ? `Graph of ${curves.map((c) => 'y = ' + c.expression).join(' and ')}, for x from ${win.xMin} to ${win.xMax} and y from ${win.yMin} to ${win.yMax}. Use the arrow keys to read points off the curve.`
        : 'An empty graph.';
      plot.setAttribute('aria-label', label);
      const tx = ticks(win.xMin, win.xMax), ty = ticks(win.yMin, win.yMax);
      for (const x of tx) plot.append(svg('line', { x1: toX(x), y1: 0, x2: toX(x), y2: HT, class: 'grid' }));
      for (const y of ty) plot.append(svg('line', { x1: 0, y1: toY(y), x2: W, y2: toY(y), class: 'grid' }));
      const ay = win.yMin < 0 && win.yMax > 0 ? toY(0) : null, ax = win.xMin < 0 && win.xMax > 0 ? toX(0) : null;
      if (ay !== null) plot.append(svg('line', { x1: 0, y1: ay, x2: W, y2: ay, class: 'axis' }));
      if (ax !== null) plot.append(svg('line', { x1: ax, y1: 0, x2: ax, y2: HT, class: 'axis' }));
      if (ay !== null) for (const x of tx) if (x !== 0 && toX(x) > 12 && toX(x) < W - 12) plot.append(svg('text', { x: toX(x), y: ay + 11, class: 'tick' }, short(x)));
      if (ax !== null) for (const y of ty) if (y !== 0 && toY(y) > 10 && toY(y) < HT - 6) plot.append(svg('text', { x: ax - 4, y: toY(y) + 3, class: 'tick', 'text-anchor': 'end' }, short(y)));
      paths.forEach((cp, i) => { for (const path of cp) plot.append(svg('polyline', { class: 'curve c' + (curves[i].row + 1), points: path.map((p) => toX(p.x) + ',' + toY(p.y)).join(' ') })); });
      let reading = '';
      if (trace) {
        const c = curves[trace.curve];
        reading = `${trace.kind ? trace.kind + ' · ' : 'y' + (c.row + 1) + ' · '}(${C.present(trace.x)}, ${C.present(trace.y)})`;
        const ly = Math.min(Math.max(toY(trace.y) - 9, 2), HT - 20);
        const rect = svg('rect', { y: ly, height: 18, rx: 3 }), label = svg('text', { y: ly + 12 }, reading);
        plot.append(svg('g', { class: 'trace c' + (c.row + 1) },
          svg('line', { x1: toX(trace.x), y1: 0, x2: toX(trace.x), y2: HT }),
          svg('circle', { cx: toX(trace.x), cy: toY(trace.y), r: trace.kind ? 4.4 : 3.2, class: trace.kind ? 'snapped' : null }),
          rect, label));
        // size the box to the text as drawn (the font isn't known until then)
        let tw = 0; try { tw = label.getComputedTextLength(); } catch (e) { /* not laid out */ }
        const lw = Math.max(58, (tw || reading.length * 5.2) + 12), lx = toX(trace.x) + 8 + lw > W ? toX(trace.x) - 8 - lw : toX(trace.x) + 8;
        rect.setAttribute('x', lx); rect.setAttribute('width', lw); label.setAttribute('x', lx + lw / 2);
      }
      const bad = exprs.map((e, i) => e.trim() && !curves.some((c) => c.row === i) ? 'y' + (i + 1) : '').filter(Boolean);
      const complaint = error || (bad.length ? 'Syntax error in ' + bad.join(' and ') : '');
      out.className = 'calc-readout' + (complaint || answer ? '' : ' quiet');
      out.replaceChildren(complaint ? h('span', { class: 'calc-error', text: complaint }) : answer ? h('div', { text: answer }) : reading ? h('span', { class: 'calc-sr', text: reading }) : '');
    }
    function area() {
      if (!curves.length) { error = 'Enter a function of x first.'; answer = ''; return draw(); }
      const a = Number(from.value), b = Number(to.value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !from.value.trim() || !to.value.trim()) { error = 'Enter numbers for both limits.'; answer = ''; return draw(); }
      try { answer = `∫ from ${C.present(a)} to ${C.present(b)} = ${C.present(C.integrate(curves[0].f, a, b))}`; error = ''; } catch (e) { answer = ''; error = (e && e.message) || 'That did not work.'; }
      draw();
    }

    const rows = [0, 1, 2].map((i) => {
      const f = textField(C, 'calc-y' + (i + 1), `Function y${i + 1} of x`, i ? 'another function of x' : 'x^2-4', (v) => { exprs[i] = v; trace = null; answer = ''; error = ''; compile(); });
      return h('div', { class: 'calc-curve' }, h('span', { class: 'calc-swatch c' + (i + 1), 'aria-hidden': 'true' }), h('label', { for: 'calc-y' + (i + 1), text: `y${i + 1} =` }), f.el);
    });
    const el = h('div', { class: 'calc-screen' }, rows, plot,
      h('div', { class: 'calc-area' },
        h('label', {}, h('span', { text: 'Area from' }), from),
        h('label', {}, h('span', { text: 'to' }), to),
        h('button', { type: 'button', class: 'btn small', onclick: area }, 'Area')),
      out);
    draw();
    return { el, focus: () => rows[0].querySelector('input').focus(), modeChanged: compile };
  }

  // ---------- the panel ----------
  function create(opts) {
    opts = opts || {};
    const base = (opts && opts.base) || '/vendor/';
    const graphing = opts && opts.kind === 'graphing';
    const place = recall();
    // graphing: the Graph screen is built (some question allows it); kind: what the question on screen allows
    const state = { mode: place.mode, screen: graphing ? place.screen : 'calculate', position: place.position, disabled: false, kind: opts.kind };
    const screenNow = () => (state.kind === 'graphing' ? state.screen : 'calculate');
    const button = h('button', { class: 'btn small ghost calc-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'calc-panel' }, calcIcon(), h('span', { class: 'calc-btn-label', text: 'Calculator' }));
    let panel = null, screens = null, built = null;

    function move(x, y) {
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      state.position = { x: Math.max(12, Math.min(x, window.innerWidth - r.width - 12)), y: Math.max(12, Math.min(y, window.innerHeight - r.height - 12)) };
      if (!phone()) Object.assign(panel.style, { left: state.position.x + 'px', top: state.position.y + 'px', right: 'auto', bottom: 'auto' });
      remember(state);
    }
    function onResize() { if (panel && state.position && !phone()) { const r = panel.getBoundingClientRect(); move(r.left, r.top); } }

    function build(C, ML) {
      const calc = calculateScreen(C, ML, state);
      const graph = graphing ? graphScreen(C, state) : null;
      const tabs = graphing ? h('div', { class: 'calc-seg', role: 'tablist', 'aria-label': 'Calculator screen' },
        [['calculate', 'Calculate'], ['graph', 'Graph']].map(([v, t]) => h('button', { type: 'button', role: 'tab', 'data-v': v, onclick: () => { state.screen = v; remember(state); showScreen(); } }, t))) : null;
      const modes = h('div', { class: 'calc-seg', role: 'group', 'aria-label': 'Angle mode' },
        [['radians', 'Radians'], ['degrees', 'Degrees']].map(([v, t]) => h('button', { type: 'button', 'data-v': v, onclick: () => { state.mode = v; remember(state); setPressed(); calc.modeChanged(); if (graph) graph.modeChanged(); } }, t)));
      const head = h('div', { class: 'calc-head', tabindex: 0, role: 'group', 'aria-label': 'Calculator. Drag, or use the arrow keys, to move it.' },
        h('h2', { text: 'Calculator' }),
        h('button', { type: 'button', class: 'calc-close', 'aria-label': 'Close calculator', onpointerdown: (e) => e.stopPropagation(), onclick: () => close(true) }, icon(['M18 6 6 18', 'M6 6l12 12'])));
      let drag = null;
      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || phone()) return;
        const r = panel.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        head.setPointerCapture(e.pointerId); e.preventDefault();
      });
      head.addEventListener('pointermove', (e) => { if (drag) move(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) head.addEventListener(ev, () => { drag = null; });
      head.addEventListener('keydown', (e) => {
        if (e.target !== head || phone()) return;
        const d = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
        if (!d) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        move(r.left + d[0], r.top + d[1]);
      });
      panel = h('section', { class: 'calc-panel', id: 'calc-panel', 'aria-label': graphing ? 'Graphing calculator' : 'Calculator' },
        head, h('div', { class: 'calc-bar' }, tabs, modes), calc.el, graph ? graph.el : null);
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(true); } });
      // keystrokes in the calculator are the calculator's, not the quiz's
      panel.addEventListener('keyup', (e) => e.stopPropagation());
      screens = { calc, graph, tabs, modes };
      function setPressed() { for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.v === state.mode)); }
      function showScreen() {
        const now = screenNow();
        calc.el.hidden = now !== 'calculate';
        if (graph) graph.el.hidden = now !== 'graph';
        if (tabs) {
          tabs.hidden = state.kind !== 'graphing';
          for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.v === now));
        }
        panel.setAttribute('aria-label', state.kind === 'graphing' ? 'Graphing calculator' : 'Calculator');
      }
      setPressed(); showScreen();
      built = { calc, graph, showScreen };
    }

    async function open() {
      if (state.disabled) return;
      button.setAttribute('aria-expanded', 'true');
      button.classList.add('on');
      try {
        if (!built) {
          button.setAttribute('aria-busy', 'true');
          const [C, ML] = await Promise.all([engine(base), mathlive(base)]);
          button.removeAttribute('aria-busy');
          if (button.getAttribute('aria-expanded') !== 'true') return;
          build(C, ML);
        }
        const host = typeof opts.host === 'function' ? opts.host() : opts.host;
        (host || document.body).append(panel);
        if (built.calc.mounted && !built.mountedOnce) { built.calc.mounted(); built.mountedOnce = true; }
        if (state.position && !phone()) Object.assign(panel.style, { left: state.position.x + 'px', top: state.position.y + 'px', right: 'auto', bottom: 'auto' });
        else Object.assign(panel.style, { left: '', top: '', right: '', bottom: '' });
        built.showScreen();
        requestAnimationFrame(() => { onResize(); (screenNow() === 'graph' && built.graph ? built.graph : built.calc).focus(); });
        window.addEventListener('resize', onResize);
        if (opts.onToggle) opts.onToggle(true);
      } catch (e) {
        button.removeAttribute('aria-busy');
        button.setAttribute('aria-expanded', 'false');
        button.classList.remove('on');
        if (opts.onError) opts.onError(e);
      }
    }
    function close(refocus) {
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('on');
      if (panel && panel.isConnected) panel.remove();
      window.removeEventListener('resize', onResize);
      if (refocus) button.focus();
      if (opts.onToggle) opts.onToggle(false);
    }
    button.addEventListener('click', () => (button.getAttribute('aria-expanded') === 'true' ? close(false) : open()));
    return {
      button,
      close: () => close(false),
      isOpen: () => !!(panel && panel.isConnected),
      setDisabled(v) { state.disabled = !!v; button.disabled = !!v; if (v) close(false); },
      // what the question on screen allows: "scientific", "graphing" or null (no button)
      setKind(k) {
        if (k === state.kind) return;
        const focused = panel && panel.contains(document.activeElement);
        state.kind = k;
        button.hidden = !k;
        if (!k) { close(false); if (focused) button.blur(); return; }
        if (built) built.showScreen();
      },
    };
  }

  window.BQCalculator = { create };
})();
