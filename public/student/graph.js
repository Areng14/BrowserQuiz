// Graphs: the grid students draw on for a graph question, the same grid showing a drawn answer (reports,
// review), and graphs in a prompt (```graph blocks in Markdown). The math is in mathexpr.js (BQMath).
//
//   BQGraph.editor({ window, step, tools, shade, value, onChange, label }) → { el }
//   BQGraph.view({ window, step, drawn, shapes, label }) → element (drawn: a student's handles; shapes: worked-out shapes)
//   BQGraph.block(source) → element (a ```graph block: equations and points, one a line, window: and step:)
(function () {
  'use strict';
  const M = window.BQMath;
  const S = M.shapes;
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
    for (const k of kids) if (k != null) el.append(k);
    return el;
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) el.append(k);
    return el;
  }
  const num = (v) => { const r = Math.round(v * 1e6) / 1e6; return (r < 0 ? '−' : '') + Math.abs(r); };
  const pt = (p) => `(${num(p[0])}, ${num(p[1])})`;

  // ---------- the grid ----------
  // Equal scales on both axes, unless that would make it very tall or very flat.
  function frame(win, step) {
    const [x0, x1, y0, y1] = win;
    const W = 400;
    const H = Math.max(220, Math.min(560, W * (y1 - y0) / (x1 - x0)));
    const px = (x) => ((x - x0) / (x1 - x0)) * W;
    const py = (y) => ((y1 - y) / (y1 - y0)) * H;
    const fx = (X) => x0 + (X / W) * (x1 - x0);
    const fy = (Y) => y1 - (Y / H) * (y1 - y0);
    return { x0, x1, y0, y1, W, H, px, py, fx, fy, step };
  }
  // The grid's lines (under the shapes) and its numbers (over them, so a curve never hides one).
  function grid(F) {
    const g = svg('g', { class: 'gr-grid', 'aria-hidden': 'true' });
    const nums = svg('g', { class: 'gr-ticks', 'aria-hidden': 'true' });
    const { x0, x1, y0, y1, W, H, px, py, step } = F;
    const cellX = px(x0 + step) - px(x0);
    const cellY = py(y0) - py(y0 + step);
    const every = (cell) => { const want = 26 / cell; for (const k of [1, 2, 5, 10, 20, 25, 50, 100]) if (k >= want) return k; return 100; };
    const ex = every(cellX);
    const ey = every(cellY);
    const lines = [];
    const first = (lo) => Math.ceil(lo / step - 1e-9);
    if (cellX >= 4) for (let i = first(x0); i * step <= x1 + 1e-9; i++) lines.push(svg('line', { x1: px(i * step), y1: 0, x2: px(i * step), y2: H, class: i % ex === 0 ? 'major' : null }));
    if (cellY >= 4) for (let i = first(y0); i * step <= y1 + 1e-9; i++) lines.push(svg('line', { x1: 0, y1: py(i * step), x2: W, y2: py(i * step), class: i % ey === 0 ? 'major' : null }));
    g.append(...lines);
    // axes, where 0 is in the window; else the numbers go along the edge
    const ax = y0 <= 0 && y1 >= 0 ? py(0) : null;
    const ay = x0 <= 0 && x1 >= 0 ? px(0) : null;
    if (ax != null) g.append(svg('line', { class: 'axis', x1: 0, y1: ax, x2: W, y2: ax }));
    if (ay != null) g.append(svg('line', { class: 'axis', x1: ay, y1: 0, x2: ay, y2: H }));
    const labelY = ax != null ? Math.min(H - 4, ax + 13) : H - 4;
    const labelX = ay != null ? ay - 4 : 4;
    for (let i = first(x0); i * step <= x1 + 1e-9; i++) {
      if (i === 0 || i % ex) continue;
      const X = px(i * step);
      if (X < 8 || X > W - 8) continue;
      nums.append(svg('text', { class: 'tick', x: X, y: labelY, 'text-anchor': 'middle' }, num(i * step)));
    }
    for (let i = first(y0); i * step <= y1 + 1e-9; i++) {
      if (i === 0 || i % ey) continue;
      const Y = py(i * step);
      if (Y < 8 || Y > H - 8) continue;
      nums.append(svg('text', { class: 'tick', x: ay != null ? labelX : 4, y: Y + 4, 'text-anchor': ay != null ? 'end' : 'start' }, num(i * step)));
    }
    return { lines: g, nums };
  }

  // ---------- drawing a shape ----------
  // A function's curve as path data, broken where it isn't defined or leaves the window by far.
  function curvePath(F, f) {
    const N = 320;
    const lim = (F.y1 - F.y0) * 4;
    let d = '';
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const x = F.x0 + ((F.x1 - F.x0) * i) / N;
      const y = f(x);
      if (!Number.isFinite(y) || y > F.y1 + lim || y < F.y0 - lim) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${F.px(x).toFixed(2)} ${F.py(y).toFixed(2)}`;
      pen = true;
    }
    return d;
  }
  // The shaded side of an inequality, as path data (clipped to the window by the caller).
  function shadePath(F, s) {
    const { W, H } = F;
    if (s.kind === 'circle') {
      const cx = F.px(s.h);
      const cy = F.py(s.k);
      const rx = F.px(s.h + s.r) - cx;
      const ry = F.py(s.k - s.r) - cy;
      const ring = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
      return s.side > 0 ? `M-10 -10H${W + 10}V${H + 10}H-10Z${ring}` : ring;
    }
    if (s.kind === 'line' && s.b === 0) {
      const X = F.px(s.c / s.a);
      return s.side > 0 ? `M${X} -10H${W + 10}V${H + 10}H${X}Z` : `M${X} -10H-10V${H + 10}H${X}Z`;
    }
    const f = s.kind === 'curve' ? s.f : S.fnOf(s.kind, s);
    const N = 320;
    const edge = s.side > 0 ? -10 : H + 10;
    let d = `M-10 ${edge}`;
    for (let i = 0; i <= N; i++) {
      const x = F.x0 + ((F.x1 - F.x0) * i) / N;
      let Y = F.py(f(x));
      if (!Number.isFinite(Y)) Y = edge;
      Y = Math.max(-20, Math.min(H + 20, Y));
      d += `L${F.px(x).toFixed(2)} ${Y.toFixed(2)}`;
    }
    return `${d}L${W + 10} ${edge}Z`;
  }
  // One worked-out shape (mathexpr.js), drawn: { kind, ... } or { kind: 'curve', f } for a prompt's graph.
  function shapeEl(F, s, cls) {
    const g = svg('g', { class: 'gr-shape' + (cls ? ' ' + cls : '') });
    if (s.side) g.append(svg('path', { class: 'gr-shade', d: shadePath(F, s), 'fill-rule': 'evenodd' }));
    const dash = s.strict || s.dash ? '7 5' : null;
    if (s.kind === 'point') {
      g.append(svg('circle', { class: 'gr-dot', cx: F.px(s.x), cy: F.py(s.y), r: 5 }));
      if (s.label) g.append(svg('text', { class: 'gr-label', x: F.px(s.x) + 8, y: F.py(s.y) - 8 }, s.label));
      return g;
    }
    if (s.kind === 'circle') {
      g.append(svg('ellipse', { class: 'gr-curve', cx: F.px(s.h), cy: F.py(s.k), rx: F.px(s.h + s.r) - F.px(s.h), ry: F.py(s.k - s.r) - F.py(s.k), 'stroke-dasharray': dash }));
      return g;
    }
    if (s.kind === 'line' && s.b === 0) {
      const X = F.px(s.c / s.a);
      g.append(svg('line', { class: 'gr-curve', x1: X, y1: -10, x2: X, y2: F.H + 10, 'stroke-dasharray': dash }));
      return g;
    }
    const f = s.kind === 'curve' ? s.f : S.fnOf(s.kind, s);
    g.append(svg('path', { class: 'gr-curve', d: curvePath(F, f), 'stroke-dasharray': dash }));
    return g;
  }
  function plot(F, label) {
    const id = 'grc' + ++uid;
    const root = svg('svg', { class: 'gr-svg', viewBox: `0 0 ${F.W} ${F.H}`, role: 'img', 'aria-label': label });
    root.append(svg('defs', {}, svg('clipPath', { id }, svg('rect', { x: 0, y: 0, width: F.W, height: F.H }))));
    const g = grid(F);
    root.append(svg('rect', { class: 'gr-bg', x: 0, y: 0, width: F.W, height: F.H }), g.lines);
    const layer = svg('g', { 'clip-path': `url(#${id})` });
    root.append(layer, g.nums);
    return { root, layer };
  }
  const windowText = (F) => `x from ${num(F.x0)} to ${num(F.x1)}, y from ${num(F.y0)} to ${num(F.y1)}`;

  // ---------- a drawn answer, or worked-out shapes, to look at ----------
  function view(o) {
    const F = frame(o.window, o.step);
    const shapes = o.shapes || (o.drawn || []).map((d) => S.fromHandles(d)).filter(Boolean);
    const words = shapes.map((s) => S.shapeText(s));
    const { root, layer } = plot(F, `${o.label || 'Graph'}: ${words.length ? words.join('; ') : 'nothing drawn'}. ${windowText(F)}.`);
    for (const s of shapes) layer.append(shapeEl(F, s));
    // what a student drew also shows where they put their points
    for (const d of o.drawn || []) for (const p of d.p || []) if (d.kind !== 'point') layer.append(svg('circle', { class: 'gr-dot small', cx: F.px(p[0]), cy: F.py(p[1]), r: 3.5 }));
    return h('div', { class: 'gr-view' }, root);
  }

  // ---------- a graph in a prompt ----------
  // ```graph
  // y = x^2 - 4
  // y < 2x + 1
  // (2, 0) A
  // window: -5, 5, -6, 6
  // ```
  function block(src) {
    let win = [-10, 10, -10, 10];
    let step = 1;
    const shapes = [];
    const problems = [];
    for (const raw of String(src || '').split('\n').slice(0, 30)) {
      const line = raw.trim();
      if (!line) continue;
      const set = /^(window|step)\s*:\s*(.+)$/i.exec(line);
      if (set) {
        const nums = set[2].split(/[\s,]+/).filter(Boolean).map(Number);
        if (set[1].toLowerCase() === 'window' && nums.length === 4 && nums.every(Number.isFinite) && nums[0] < nums[1] && nums[2] < nums[3]) win = nums;
        else if (set[1].toLowerCase() === 'step' && nums.length === 1 && nums[0] > 0) step = nums[0];
        else problems.push(line);
        continue;
      }
      const point = /^(\([^()]*\))\s*([^\s].{0,19})?$/.exec(line);
      try {
        if (point) {
          const s = S.shapesOf(point[1])[0];
          if (s.kind === 'point' && point[2]) s.label = point[2];
          shapes.push(s);
          continue;
        }
        shapes.push(...S.shapesOf(line));
      } catch (e) {
        const f = curveOf(line);
        if (f) shapes.push(f); else problems.push(line);
      }
    }
    if ((win[1] - win[0]) / step > 200 || (win[3] - win[2]) / step > 200) step = Math.max(win[1] - win[0], win[3] - win[2]) / 20;
    const F = frame(win, step);
    const words = shapes.map((s) => (s.kind === 'curve' ? s.text : S.shapeText(s)) + (s.label ? ` ${s.label}` : ''));
    const { root, layer } = plot(F, `Graph of ${words.join('; ') || 'nothing'}. ${windowText(F)}.`);
    for (const s of shapes) layer.append(shapeEl(F, s));
    const out = h('div', { class: 'gr-view gr-block' }, root);
    if (problems.length) out.append(h('p', { class: 'gr-problem', text: `Can't draw: ${problems.join('; ')}` }));
    return out;
  }
  // y = any function of x (or y < …): a curve for a prompt's graph, even ones students can't draw
  function curveOf(line) {
    let items;
    try { items = M.readAnswer(line, { latex: false }); } catch (e) { return null; }
    if (items.length !== 1 || items[0].t !== 'rel' || items[0].sides.length !== 2) return null;
    const [l, r] = items[0].sides;
    let op = items[0].ops[0];
    let rhs = r;
    if (!(l.t === 'var' && l.n === 'y')) {
      if (!(r.t === 'var' && r.n === 'y')) return null;
      rhs = l;
      op = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=' }[op];
    }
    if (!op || op === '!=') return null;
    for (const v of M.varsOf(rhs)) if (v !== 'x') return null;
    const f = (x) => M.evaluate(rhs, { x });
    const s = { kind: 'curve', f, text: line };
    if (op !== '=') { s.side = op[0] === '>' ? 1 : -1; s.strict = op.length === 1; }
    return s;
  }

  // ---------- the student's grid ----------
  function editor(o) {
    const F = frame(o.window, o.step);
    const step = o.step;
    const tools = o.tools && o.tools.length ? o.tools : ['point'];
    let shapes = Array.isArray(o.value) ? o.value.map((d) => JSON.parse(JSON.stringify(d))) : [];
    let sel = -1;
    let drag = null;
    const snap = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v / step) * step));
    const snapX = (x) => { const v = snap(x, F.x0, F.x1); return v < F.x0 - 1e-9 ? v + step : v > F.x1 + 1e-9 ? v - step : Math.round(v * 1e6) / 1e6; };
    const snapY = (y) => { const v = snap(y, F.y0, F.y1); return v < F.y0 - 1e-9 ? v + step : v > F.y1 + 1e-9 ? v - step : Math.round(v * 1e6) / 1e6; };
    const id = 'gr' + ++uid;
    const said = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const { root, layer } = plot(F, `Graph, ${windowText(F)}. ${tools.length === 1 && tools[0] === 'point' ? 'Click to place a point.' : ''}`.trim());
    root.setAttribute('role', 'group');
    root.classList.add('gr-edit');
    const handles = svg('g', { class: 'gr-handles' });
    root.append(handles);
    const list = h('ul', { class: 'sr-only', id: id + '-list' });

    // the toolbar: add a shape; and for the one picked, its edge and shading
    const addBtns = tools.map((k) => h('button', { type: 'button', class: 'btn small gr-add', 'aria-label': `Add ${k === 'abs' ? 'an absolute value graph' : k === 'exp' ? 'an exponential' : 'a ' + S.KIND_NAMES[k].toLowerCase()}`, onclick: () => add(k) }, plusIcon(), S.KIND_NAMES[k]));
    const remove = h('button', { type: 'button', class: 'btn small ghost gr-remove', disabled: '', onclick: () => removeSel() }, 'Remove');
    const edgeSolid = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setSel({ dash: false }) }, 'Solid');
    const edgeDash = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setSel({ dash: true }) }, 'Dashed');
    const sideBtns = [0, 1, -1].map((v) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setSel({ side: v }) }, ''));
    const edge = h('div', { class: 'gr-seg', role: 'group', 'aria-label': 'Edge' }, edgeSolid, edgeDash);
    const shade = h('div', { class: 'gr-seg', role: 'group', 'aria-label': 'Shading' }, ...sideBtns);
    const style = h('div', { class: 'gr-style', hidden: '' }, edge, shade);
    const bar = h('div', { class: 'gr-bar' }, h('div', { class: 'gr-tools', role: 'group', 'aria-label': 'Draw' }, ...addBtns), remove);
    const el = h('div', { class: 'gr-editor', style: `--gr-aspect: ${(F.W / F.H).toFixed(3)}` }, bar, o.shade ? style : null, h('div', { class: 'gr-view' }, root), list, said);
    root.setAttribute('aria-describedby', id + '-list');

    function plusIcon() { return window.BQIcons.svg('plus', 14, { class: 'gr-plus' }); } // /icons.js
    const describe = (d, i) => {
      const n = `${S.KIND_NAMES[d.kind]} ${i + 1}${d.fresh ? ' (not placed yet)' : ''}`;
      if (d.kind === 'point') return `${n} at ${pt(d.p[0])}`;
      const s = S.fromHandles(d);
      const eq = s ? `: ${S.shapeText(s).replace(/-/g, '−')}` : '';
      if (d.kind === 'line') return `${n} through ${pt(d.p[0])} and ${pt(d.p[1])}${eq}`;
      if (d.kind === 'circle') return `${n}, center ${pt(d.p[0])}, through ${pt(d.p[1])}${eq}`;
      if (d.kind === 'exp') return `${n} through ${pt(d.p[0])} and ${pt(d.p[1])}, asymptote y = ${num(d.k)}${eq}`;
      return `${n}, vertex ${pt(d.p[0])}, through ${pt(d.p[1])}${eq}`;
    };
    const handleName = (d, i, j) => {
      if (j === 'k') return `${S.KIND_NAMES[d.kind]} ${i + 1} asymptote, y = ${num(d.k)}`;
      const role = d.kind === 'point' ? '' : (d.kind === 'parabola' || d.kind === 'abs') ? (j ? ' point' : ' vertex') : d.kind === 'circle' ? (j ? ' edge' : ' center') : ` point ${j + 1}`;
      return `${S.KIND_NAMES[d.kind]} ${i + 1}${role}, ${pt(d.p[j])}`;
    };
    // A shape just added (fresh) sits where the tool put it, dashed: it isn't part of the answer until the
    // student moves it, so an untouched starter line can't be turned in by accident.
    function changed() {
      const placed = shapes.filter((d) => !d.fresh).map((d) => JSON.parse(JSON.stringify(d)));
      o.onChange(placed.length ? placed : undefined);
    }
    function paint(focus) {
      layer.replaceChildren();
      handles.replaceChildren();
      shapes.forEach((d, i) => {
        const s = S.fromHandles(d);
        const picked = i === sel;
        if (s) {
          const g = shapeEl(F, s, picked ? 'picked' : null);
          if (d.fresh) g.classList.add('fresh');
          g.addEventListener('pointerdown', (e) => { if (e.button === 0) { sel = i; paint(); e.stopPropagation(); } });
          layer.append(g);
        }
        if (d.kind === 'exp') {
          const Y = F.py(d.k);
          layer.append(svg('line', { class: 'gr-asym', x1: 0, y1: Y, x2: F.W, y2: Y }));
        }
        d.p.forEach((p, j) => handles.append(handle(d, i, j, F.px(p[0]), F.py(p[1]), picked)));
        if (d.kind === 'exp') handles.append(handle(d, i, 'k', F.px(F.x0) + 18, F.py(d.k), picked));
      });
      list.replaceChildren(...shapes.map((d, i) => h('li', { text: describe(d, i) })));
      remove.disabled = sel < 0;
      const cur = shapes[sel];
      if (o.shade) {
        style.hidden = !cur || cur.kind === 'point';
        if (cur && cur.kind !== 'point') {
          edgeSolid.setAttribute('aria-pressed', String(!cur.dash));
          edgeDash.setAttribute('aria-pressed', String(!!cur.dash));
          const s = S.fromHandles(cur);
          const vertical = s && s.kind === 'line' && s.b === 0;
          const names = cur.kind === 'circle' ? ['No shading', 'Outside', 'Inside'] : vertical ? ['No shading', 'Right', 'Left'] : ['No shading', 'Above', 'Below'];
          sideBtns.forEach((b, k) => { b.textContent = names[k]; b.setAttribute('aria-pressed', String((cur.side || 0) === [0, 1, -1][k])); });
        }
      }
      if (focus) {
        const el = handles.querySelector(`[data-h="${focus}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    }
    function handle(d, i, j, X, Y, picked) {
      const asym = j === 'k';
      const g = svg('g', { class: 'gr-handle' + (picked ? ' picked' : '') + (asym ? ' asym' : '') + (d.fresh ? ' fresh' : ''), tabindex: '0', role: 'button', 'data-h': `${i}:${j}`, 'aria-roledescription': 'draggable point', 'aria-label': handleName(d, i, j) + '. Arrow keys move it, Delete removes the ' + S.KIND_NAMES[d.kind].toLowerCase() + '.' });
      g.append(svg('circle', { class: 'gr-hit', cx: X, cy: Y, r: 16 }));
      if (asym) g.append(svg('rect', { class: 'gr-knob', x: X - 6, y: Y - 6, width: 12, height: 12, rx: 3 }));
      else g.append(svg('circle', { class: 'gr-knob', cx: X, cy: Y, r: d.kind === 'point' ? 6.5 : 6 }));
      if (picked || (drag && drag.i === i && drag.j === j)) {
        const label = asym ? `y = ${num(d.k)}` : pt(d.p[j]);
        const right = X < F.W - 70;
        g.append(svg('text', { class: 'gr-coord', x: X + (right ? 11 : -11), y: Y - 10, 'text-anchor': right ? 'start' : 'end' }, label));
      }
      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        sel = i;
        drag = { i, j, id: e.pointerId };
        root.setPointerCapture(e.pointerId);
        paint(`${i}:${j}`);
      });
      g.addEventListener('keydown', (e) => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
        if (moves[e.key]) {
          e.preventDefault();
          const k = e.shiftKey ? 5 : 1;
          const [dx, dy] = moves[e.key];
          sel = i;
          if (asym) moveTo(i, j, null, d.k + dy * step * k);
          else moveTo(i, j, d.p[j][0] + dx * step * k, d.p[j][1] + dy * step * k);
          paint(`${i}:${j}`);
          said.textContent = handleName(shapes[i], i, j);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          sel = i;
          removeSel();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sel = i;
          paint(`${i}:${j}`);
        }
      });
      return g;
    }
    // Move one handle; refused when the shape would stop making sense (two points on top of each other,
    // a parabola's point straight above its vertex, an asymptote between an exponential's points).
    function moveTo(i, j, x, y) {
      const d = shapes[i];
      const next = JSON.parse(JSON.stringify(d));
      if (j === 'k') next.k = snapY(y);
      else next.p[j] = [snapX(x), snapY(y)];
      if (d.kind !== 'point' && !S.fromHandles(next)) return false;
      if ((j === 'k' ? next.k !== d.k : next.p[j].join() !== d.p[j].join())) delete next.fresh; // moved: now it counts
      shapes[i] = next;
      changed();
      return true;
    }
    function local(e) {
      const r = root.getBoundingClientRect();
      return [F.fx(((e.clientX - r.left) / r.width) * F.W), F.fy(((e.clientY - r.top) / r.height) * F.H)];
    }
    root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [x, y] = local(e);
      const d = shapes[drag.i];
      const before = drag.j === 'k' ? d.k : d.p[drag.j].join();
      moveTo(drag.i, drag.j, x, y);
      const now = drag.j === 'k' ? shapes[drag.i].k : shapes[drag.i].p[drag.j].join();
      if (before !== now) paint(`${drag.i}:${drag.j}`);
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { i, j } = drag;
      drag = null;
      paint(`${i}:${j}`);
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    // a click on the empty grid: a point there when points are all it draws, else nothing picked
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      if (tools.length === 1 && tools[0] === 'point' && shapes.length < 20) {
        const [x, y] = local(e);
        const p = [snapX(x), snapY(y)];
        if (!shapes.some((d) => d.kind === 'point' && d.p[0][0] === p[0] && d.p[0][1] === p[1])) {
          shapes.push({ kind: 'point', p: [p] });
          sel = shapes.length - 1;
          changed();
          paint(`${sel}:0`);
          said.textContent = `Point placed at ${pt(p)}`;
          return;
        }
      }
      sel = -1;
      paint();
    });

    // A new shape near the middle, clear of the handles already there.
    function add(kind) {
      if (shapes.length >= 20) return;
      const taken = new Set(shapes.flatMap((d) => d.p.map((p) => p.join())));
      const cx = snapX((F.x0 + F.x1) / 2);
      const cy = snapY((F.y0 + F.y1) / 2);
      const u = Math.max(1, Math.min(2, Math.floor(Math.min(F.x1 - F.x0, F.y1 - F.y0) / step / 6))) * step;
      // every other one of a kind turns the other way: a second line crosses the first, a second parabola opens down
      const flip = shapes.filter((d) => d.kind === kind).length % 2 ? -1 : 1;
      const shapeAt = (x, y) => {
        if (kind === 'point') return { kind, p: [[x, y]] };
        if (kind === 'line') return { kind, p: [[x - u, y - flip * u], [x + u, y + flip * u]] };
        if (kind === 'circle') return { kind, p: [[x, y], [x + u, y]] };
        if (kind === 'exp') return { kind, p: [[x, y], [x + u, y + u]], k: y - u };
        return { kind, p: [[x, y], [x + u, y + flip * u]] };
      };
      let d = null;
      for (let r = 0; r < 12 && !d; r++) {
        for (const [ox, oy] of r ? [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] : [[0, 0]]) {
          const c = shapeAt(snapX(cx + ox * step), snapY(cy + oy * step));
          const fits = c.p.every((p) => snapX(p[0]) === p[0] && snapY(p[1]) === p[1]) && (c.k == null || snapY(c.k) === c.k);
          if (fits && c.p.every((p) => !taken.has(p.join())) && (kind === 'point' || S.fromHandles(c))) { d = c; break; }
        }
      }
      if (!d) d = shapeAt(cx, cy);
      if (kind !== 'point' && !S.fromHandles(d)) return;
      d.fresh = true;
      shapes.push(d);
      sel = shapes.length - 1;
      changed();
      paint(`${sel}:0`);
      said.textContent = `Added ${describe(d, sel)}. Move one of its points to place it.`;
    }
    function removeSel() {
      if (sel < 0 || !shapes[sel]) return;
      const gone = describe(shapes[sel], sel);
      shapes.splice(sel, 1);
      sel = -1;
      changed();
      paint();
      said.textContent = `Removed ${gone}`;
      (addBtns[0] || remove).focus();
    }
    function setSel(patch) {
      const d = shapes[sel];
      if (!d) return;
      delete d.fresh; // styling it means they meant it
      if ('dash' in patch) { if (patch.dash) d.dash = true; else delete d.dash; }
      if ('side' in patch) { if (patch.side) d.side = patch.side; else delete d.side; }
      changed();
      paint();
    }
    paint();
    fitOnScreen(el, F.W / F.H);
    return { el };
  }

  // The grid as big as fits between its top and the bottom of what scrolls (the quiz's page, or the
  // window), so its bottom row isn't cut off on a short laptop screen: at most 460px wide, and at least
  // 260 (then the page scrolls). Again when the window or the question around it changes size.
  function fitOnScreen(el, aspect) {
    const fit = () => {
      const v = el.querySelector('.gr-view');
      if (!v || !el.isConnected) return;
      let box = el.parentElement;
      while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
      const pane = box && box !== document.body ? box : null;
      const top = v.getBoundingClientRect().top - (pane ? pane.getBoundingClientRect().top - pane.scrollTop : -window.scrollY);
      const room = (pane ? pane.clientHeight : window.innerHeight) - top - 16;
      el.style.maxWidth = `${Math.round(Math.max(260, Math.min(460, room * aspect)))}px`; // the tools above it stay as wide as the grid
    };
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); window.removeEventListener('resize', fit); return; } fit(); });
    requestAnimationFrame(() => { if (el.parentElement) ro.observe(el.parentElement); fit(); });
    window.addEventListener('resize', fit);
  }

  window.BQGraph = { editor, view, block };
})();
