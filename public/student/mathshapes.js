// Graphs: the shapes students draw on a grid (point, line, parabola, absolute value, exponential, circle,
// and their inequalities), worked out from equations, built from a student's handles, and compared.
// Reads equations with mathread.js. Shared by the server (grading, quiz checks) and the browser (graph.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mathread.js'));
  else root.BQMathShapes = factory(root.BQMathRead);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  if (!R) throw new Error('mathshapes.js needs mathread.js loaded first.');
  const { MathError, fail, evaluate, readAnswer, varsOf, normRel } = R;

  // ---------- graphs ----------
  // A shape students draw: { kind, ... } with the numbers that pin it down.
  //   point     { x, y }
  //   line      { a, b, c }      a·x + b·y = c, with a² + b² = 1 and b > 0 (or b = 0 and a > 0)
  //   parabola  { a, h, k }      y = a(x − h)² + k
  //   abs       { a, h, k }      y = a|x − h| + k
  //   exp       { a, b, k }      y = a·b^x + k
  //   circle    { h, k, r }      (x − h)² + (y − k)² = r²
  // An inequality adds side (1: above, right of a vertical line, or outside a circle; −1: the other side)
  // and strict (a dashed edge). The side is where S > 0 for S (sideFn) below.
  const KINDS = ['point', 'line', 'parabola', 'abs', 'exp', 'circle'];
  const KIND_NAMES = { point: 'Point', line: 'Line', parabola: 'Parabola', abs: 'Absolute value', exp: 'Exponential', circle: 'Circle' };
  const HANDLES = { point: 1, line: 2, parabola: 2, abs: 2, exp: 2, circle: 2 };
  const near = (a, b, rel) => Math.abs(a - b) <= (rel || 1e-7) * Math.max(1, Math.abs(a), Math.abs(b));
  function fnOf(kind, s) {
    if (kind === 'parabola') return (x) => s.a * (x - s.h) * (x - s.h) + s.k;
    if (kind === 'abs') return (x) => s.a * Math.abs(x - s.h) + s.k;
    if (kind === 'exp') return (x) => s.a * Math.pow(s.b, x) + s.k;
    if (kind === 'line') return Math.abs(s.b) < 1e-12 ? null : (x) => (s.c - s.a * x) / s.b;
    return null;
  }
  function sideFn(s) {
    if (s.kind === 'line') return (x, y) => s.a * x + s.b * y - s.c;
    if (s.kind === 'circle') return (x, y) => (x - s.h) * (x - s.h) + (y - s.k) * (y - s.k) - s.r * s.r;
    const f = fnOf(s.kind, s);
    return (x, y) => y - f(x);
  }
  function normLine(a, b, c) {
    const n = Math.hypot(a, b);
    if (n < 1e-12) return null;
    let s = (b > 1e-12 || (Math.abs(b) <= 1e-12 && a > 0)) ? 1 / n : -1 / n;
    const out = { kind: 'line', a: a * s, b: b * s, c: c * s };
    if (Math.abs(out.b) < 1e-12) out.b = 0;
    if (Math.abs(out.a) < 1e-12) out.a = 0;
    return out;
  }
  // The shape an equation, inequality or point (plain text) draws. Throws MathError when it isn't one.
  const CANT = 'can\'t be drawn with the graph tools. Use a point, line, parabola, absolute value, exponential or circle.';
  function shapesOf(src) {
    const items = readAnswer(src, { latex: false });
    return items.map((it) => shapeOf(it, src));
  }
  function shapeOf(it, src) {
    if (it.t === 'tuple') {
      if (it.items.length !== 2 || it.open !== '(' || it.close !== ')') fail(`${src}: a point is (x, y).`);
      const [x, y] = it.items.map((n) => evaluate(n, {}));
      if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${src}: a point is two numbers, like (2, -3).`);
      return { kind: 'point', x, y };
    }
    if (it.t !== 'rel') fail(`${src}: write it as an equation, like y = 2x + 1.`);
    if (it.sides.length !== 2 || it.ops[0] === '!=') fail(`${src} ${CANT}`);
    const vs = varsOf(it);
    for (const v of vs) if (v !== 'x' && v !== 'y') fail(`${src}: only x and y can be in a graph's equation.`);
    const { F: Fn, op } = normRel(it.sides[0], it.ops[0], it.sides[1]);
    const F = (x, y) => evaluate(Fn, { x, y });
    const pts = [[0.37, 1.13], [-1.43, 0.61], [2.79, -2.07], [1.61, 3.31], [-3.71, -0.83], [4.13, 2.53], [0.83, -4.19], [-0.29, 5.07]];
    const ineq = op === '<' || op === '<=';
    const finish = (shape, lambda) => {
      // F = lambda·S: the side where F < 0 is where S < 0 when lambda > 0
      if (ineq) { shape.side = lambda > 0 ? -1 : 1; shape.strict = op === '<'; }
      return shape;
    };
    // a line: F is a·x + b·y + c
    const c0 = F(0, 0);
    const ax = F(1, 0) - c0;
    const by = F(0, 1) - c0;
    if ([c0, ax, by].every(Number.isFinite) && pts.every(([x, y]) => near(F(x, y), ax * x + by * y + c0, 1e-8))) {
      const line = normLine(ax, by, -c0);
      if (!line) fail(`${src} has no x or y in it.`);
      const lambda = Math.hypot(ax, by) * Math.sign(Math.abs(by) > 1e-12 ? by : ax);
      return finish(line, lambda);
    }
    // a circle: F is A(x² + y²) + D·x + E·y + C
    {
      const C = c0;
      const A = (F(1, 0) + F(-1, 0)) / 2 - C;
      const D = (F(1, 0) - F(-1, 0)) / 2;
      const E = (F(0, 1) - F(0, -1)) / 2;
      const A2 = (F(0, 1) + F(0, -1)) / 2 - C;
      if ([A, C, D, E].every(Number.isFinite) && Math.abs(A) > 1e-12 && near(A, A2, 1e-8) && pts.every(([x, y]) => near(F(x, y), A * (x * x + y * y) + D * x + E * y + C, 1e-8))) {
        const h = -D / (2 * A);
        const k = -E / (2 * A);
        const r2 = h * h + k * k - C / A;
        if (!(r2 > 1e-12)) fail(`${src} isn't a circle with a radius.`);
        return finish({ kind: 'circle', h, k, r: Math.sqrt(r2) }, A);
      }
    }
    // y as a function of x: F is lambda·(y − f(x))
    const lam = F(0.5, 1) - F(0.5, 0);
    if (!Number.isFinite(lam) || Math.abs(lam) < 1e-12 || !pts.every(([x, y]) => near(F(x, y + 1) - F(x, y), lam, 1e-8) && near(F(x, y + 2) - F(x, y), 2 * lam, 1e-8))) fail(`${src} ${CANT}`);
    const f = (x) => -F(x, 0) / lam;
    const xs = [-2.3, -1.1, 0.4, 1.7, 2.9, 3.6, -0.7, 0.9];
    const fits = (g) => xs.every((x) => { const v = f(x); return Number.isFinite(v) && near(v, g(x), 1e-7); });
    // parabola
    {
      const f0 = f(0);
      const fp = f(1);
      const fm = f(-1);
      const A = (fp + fm) / 2 - f0;
      const B = (fp - fm) / 2;
      if ([f0, fp, fm].every(Number.isFinite) && Math.abs(A) > 1e-12 && fits((x) => A * x * x + B * x + f0)) {
        const h = -B / (2 * A);
        return finish({ kind: 'parabola', a: A, h, k: A * h * h + B * h + f0 }, lam);
      }
    }
    // absolute value: one corner, slopes a and −a
    {
      const R = 1000;
      const a = f(R + 1) - f(R);
      const aLeft = f(-R) - f(-R - 1);
      if (Number.isFinite(a) && Math.abs(a) > 1e-9 && near(aLeft, -a, 1e-6)) {
        const h = (f(-R) - f(R)) / (2 * a);
        const k = f(h);
        if (Number.isFinite(k) && fits((x) => a * Math.abs(x - h) + k)) return finish({ kind: 'abs', a, h, k }, lam);
      }
    }
    // exponential
    {
      const f0 = f(0);
      const f1 = f(1);
      const f2 = f(2);
      const d1 = f1 - f0;
      const d2 = f2 - f1;
      if ([f0, f1, f2].every(Number.isFinite) && Math.abs(d1) > 1e-12) {
        const b = d2 / d1;
        if (b > 0 && Math.abs(b - 1) > 1e-9) {
          const a = d1 / (b - 1);
          const k = f0 - a;
          if (fits((x) => a * Math.pow(b, x) + k)) return finish({ kind: 'exp', a, b, k }, lam);
        }
      }
    }
    fail(`${src} ${CANT}`);
  }
  // What a student drew: { kind, p: [[x, y], ...], k (an exponential's asymptote), dash, side } → a shape,
  // or null when it doesn't make one (two points on top of each other, say).
  function fromHandles(d) {
    if (!d || !KINDS.includes(d.kind) || !Array.isArray(d.p) || d.p.length !== HANDLES[d.kind]) return null;
    const P = d.p;
    if (!P.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite))) return null;
    let s = null;
    if (d.kind === 'point') return { kind: 'point', x: P[0][0], y: P[0][1] };
    const [[x1, y1], [x2, y2]] = P;
    if (d.kind === 'line') s = normLine(y2 - y1, x1 - x2, (y2 - y1) * x1 + (x1 - x2) * y1);
    else if (d.kind === 'circle') { const r = Math.hypot(x2 - x1, y2 - y1); if (r > 1e-12) s = { kind: 'circle', h: x1, k: y1, r }; }
    else if (d.kind === 'parabola') { if (Math.abs(x2 - x1) > 1e-12) s = { kind: 'parabola', a: (y2 - y1) / ((x2 - x1) * (x2 - x1)), h: x1, k: y1 }; }
    else if (d.kind === 'abs') { if (Math.abs(x2 - x1) > 1e-12) s = { kind: 'abs', a: (y2 - y1) / Math.abs(x2 - x1), h: x1, k: y1 }; }
    else if (d.kind === 'exp') {
      const k = Number(d.k);
      if (Number.isFinite(k) && Math.abs(x2 - x1) > 1e-12 && (y1 - k) * (y2 - k) > 0) {
        const b = Math.pow((y2 - k) / (y1 - k), 1 / (x2 - x1));
        if (Number.isFinite(b) && b > 0) s = { kind: 'exp', a: (y1 - k) / Math.pow(b, x1), b, k };
      }
    }
    if (!s) return null;
    if (d.side === 1 || d.side === -1) { s.side = d.side; s.strict = !!d.dash; } else if (d.dash) s.dash = true;
    return s;
  }
  function sameShape(e, g) {
    if (!e || !g || e.kind !== g.kind) return false;
    const n = (a, b) => near(a, b, 1e-6);
    let ok;
    switch (e.kind) {
      case 'point': ok = n(e.x, g.x) && n(e.y, g.y); break;
      case 'line': ok = n(e.a, g.a) && n(e.b, g.b) && n(e.c, g.c); break;
      case 'parabola': case 'abs': ok = n(e.a, g.a) && n(e.h, g.h) && n(e.k, g.k); break;
      // the same curve: equal at a few x's (b and a trade off near flat curves)
      case 'exp': ok = n(e.k, g.k) && [-2, 0, 1, 3].every((x) => n(fnOf('exp', e)(x), fnOf('exp', g)(x))); break;
      case 'circle': ok = n(e.h, g.h) && n(e.k, g.k) && n(e.r, g.r); break;
      default: ok = false;
    }
    if (!ok) return false;
    if (e.side) return g.side === e.side && !!g.strict === !!e.strict;
    return !g.side && !g.dash;
  }
  // How much of a graph question is right: { right, extra } (expected shapes found, and shapes drawn that
  // aren't any of them).
  function gradeShapes(expected, drawn) {
    const got = (Array.isArray(drawn) ? drawn : []).map(fromHandles);
    const used = new Array(got.length).fill(false);
    let right = 0;
    for (const e of expected) {
      const j = got.findIndex((g, i) => !used[i] && sameShape(e, g));
      if (j >= 0) { used[j] = true; right++; }
    }
    return { right, extra: got.length - right, drawn: got.length };
  }
  // Can this shape be drawn by putting points on the grid? Throws MathError when not.
  function checkDrawable(s, win, step, src) {
    const [x0, x1, y0, y1] = win;
    const onGrid = (v) => Math.abs(v / step - Math.round(v / step)) < 1e-9;
    const inside = (x, y) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9;
    const xsGrid = [];
    for (let x = Math.ceil(x0 / step - 1e-9); x * step <= x1 + 1e-9; x++) xsGrid.push(x * step);
    const ysGrid = [];
    for (let y = Math.ceil(y0 / step - 1e-9); y * step <= y1 + 1e-9; y++) ysGrid.push(y * step);
    const what = `${src}: `;
    if (s.kind === 'point') {
      if (!onGrid(s.x) || !onGrid(s.y)) fail(`${what}the point has to be on the grid (every ${step}).`);
      if (!inside(s.x, s.y)) fail(`${what}the point is outside the graph's window.`);
      return;
    }
    // grid points on the curve
    const on = (x, y) => Math.abs(sideFn(s)(x, y)) < 1e-7 * Math.max(1, Math.abs(y));
    const count = (limit, skip) => {
      let n = 0;
      for (const x of xsGrid) for (const y of ysGrid) if ((!skip || !skip(x, y)) && on(x, y) && ++n >= limit) return n;
      return n;
    };
    if (s.kind === 'line') { if (count(2) < 2) fail(`${what}no two points of the grid are on this line inside the window, so it can't be drawn.`); return; }
    if (s.kind === 'circle') {
      if (!onGrid(s.h) || !onGrid(s.k) || !inside(s.h, s.k)) fail(`${what}the circle's center has to be on the grid, inside the window.`);
      if (count(1) < 1) fail(`${what}no point of the grid inside the window is on this circle, so it can't be drawn.`);
      return;
    }
    if (s.kind === 'parabola' || s.kind === 'abs') {
      if (!onGrid(s.h) || !onGrid(s.k) || !inside(s.h, s.k)) fail(`${what}the vertex (${fmt(s.h)}, ${fmt(s.k)}) has to be on the grid, inside the window.`);
      if (count(1, (x, y) => Math.abs(x - s.h) < 1e-9) < 1) fail(`${what}no other point of the grid inside the window is on it, so it can't be drawn.`);
      return;
    }
    if (s.kind === 'exp') {
      if (!onGrid(s.k) || s.k < y0 - 1e-9 || s.k > y1 + 1e-9) fail(`${what}the asymptote y = ${fmt(s.k)} has to be on the grid, inside the window.`);
      if (count(2) < 2) fail(`${what}no two points of the grid inside the window are on it, so it can't be drawn.`);
    }
  }
  const fmt = (v) => String(Math.round(v * 1e6) / 1e6);
  // A shape as an equation, for people: y = 2x - 1, y >= (x - 1)^2 - 4, (2, -3)
  function shapeText(s) {
    const num = (v) => fmt(v);
    const signed = (v) => (v < 0 ? ` - ${num(-v)}` : ` + ${num(v)}`);
    const coef = (v, x) => (near(v, 1, 1e-9) ? x : near(v, -1, 1e-9) ? '-' + x : num(v) + x);
    const shift = (v, x) => (Math.abs(v) < 1e-12 ? x : `(${x}${signed(-v)})`);
    let lhs = 'y';
    let rhs;
    if (s.kind === 'point') return `(${num(s.x)}, ${num(s.y)})`;
    if (s.kind === 'line') {
      if (s.b === 0) { lhs = 'x'; rhs = num(s.c / s.a); } else {
        const m = -s.a / s.b;
        const b = s.c / s.b;
        rhs = Math.abs(m) < 1e-12 ? num(b) : coef(m, 'x') + (Math.abs(b) < 1e-12 ? '' : signed(b));
      }
    } else if (s.kind === 'parabola') rhs = coef(s.a, shift(s.h, 'x') + '^2') + (Math.abs(s.k) < 1e-12 ? '' : signed(s.k));
    else if (s.kind === 'abs') rhs = coef(s.a, `|${Math.abs(s.h) < 1e-12 ? 'x' : `x${signed(-s.h)}`}|`) + (Math.abs(s.k) < 1e-12 ? '' : signed(s.k));
    else if (s.kind === 'exp') rhs = (near(s.a, 1, 1e-9) ? '' : near(s.a, -1, 1e-9) ? '-' : num(s.a)) + `(${num(s.b)})^x` + (Math.abs(s.k) < 1e-12 ? '' : signed(s.k));
    else if (s.kind === 'circle') return `${shift(s.h, 'x')}^2 + ${shift(s.k, 'y')}^2 ${s.side ? (s.side > 0 ? (s.strict ? '>' : '>=') : (s.strict ? '<' : '<=')) : '='} ${num(s.r * s.r)}`;
    let op = '=';
    if (s.side) {
      const vertical = s.kind === 'line' && s.b === 0;
      const up = vertical ? s.side * Math.sign(s.a) > 0 : s.side > 0;
      op = up ? (s.strict ? '>' : '>=') : (s.strict ? '<' : '<=');
    }
    return `${lhs} ${op} ${rhs}`;
  }

  return { KINDS, KIND_NAMES, HANDLES, shapesOf, fromHandles, sameShape, gradeShapes, checkDrawable, fnOf, sideFn, shapeText };
}));
