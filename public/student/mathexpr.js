// Math answers, read and compared. Shared by the server (grading, quiz checks) and the browser (what a
// student typed, the quiz maker, reports), so both read an answer the same way. No dependencies.
//
// It reads two spellings of the same language:
//  - plain text, as teachers write answers: 2x + 3, x^2 - 1, sqrt(2)/2, x <= 3, (2, -3), x = 3, x = -3
//  - LaTeX, as the student's math box (MathLive) sends it: \frac{1}{2}, \sqrt{x}, x\le3, \left(2,-3\right)
// Single letters are variables (xy is x times y), e and pi are the constants, and the usual functions
// are known (sin, cos, tan and their inverses, sec, csc, cot, sqrt, abs, ln, log, exp). Nothing in here
// runs code: an answer becomes a small tree of numbers, variables and operators, and is evaluated by
// walking it.
//
// Two answers match when they're equal as math, checked at many sample values of their variables (a
// numeric check, not a proof): 2x+3 and 3+2x, 1/2 and 0.5, (x+1)^2 and x^2+2x+1. Equations and
// inequalities match when one is a nonzero multiple of the other (a positive one for inequalities), and
// when the expected one is solved for a variable (x = 4, y = 2x + 1), the student's has to be too.
//
// The graph part (shapes) turns equations into the shapes students draw on a grid (point, line, parabola,
// absolute value, exponential, circle, and their inequalities) and compares what they drew.
//
// In three files: mathread.js reads an answer, this one compares answers (and writes them as LaTeX),
// and mathshapes.js does graphs. BQMath is all of it, so a page loads mathread.js, mathshapes.js, then this.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mathread.js'), require('./mathshapes.js'));
  else root.BQMath = factory(root.BQMathRead, root.BQMathShapes);
}(typeof self !== 'undefined' ? self : this, function (R, shapes) {
  'use strict';

  if (!R || !shapes) throw new Error('mathexpr.js needs mathread.js and mathshapes.js loaded first.');
  const { MathError, GREEK_SET, evaluate, parse, readAnswer, varsOf, normRel } = R;

  // ---------- comparing ----------
  // Sample values: not whole numbers, both signs, so different expressions don't agree by accident.
  const SAMPLES = [0.37, -1.43, 1.61, 2.79, -0.29, 4.13, 0.83, -3.71, 6.53, 1.17, -2.31, 9.17, 0.53, -0.67, 3.37, 5.29, -4.87, 2.21, 7.43, -0.91];
  const POSITIVE = [0.37, 1.61, 2.79, 4.13, 0.83, 6.53, 1.17, 9.17, 0.53, 3.37, 5.29, 2.21, 7.43, 0.71, 1.93, 3.83];
  const WIDE = POSITIVE.map((v) => v * 7.3 + 1.1);
  const PASSES = [SAMPLES, POSITIVE, WIDE];
  function scopes(names, pass) {
    const list = PASSES[pass];
    const out = [];
    for (let k = 0; k < 24; k++) {
      const s = {};
      names.forEach((n, j) => { s[n] = list[(k * 7 + j * 5 + j * j) % list.length] * (1 + 0.013 * j); });
      out.push(s);
    }
    return out;
  }
  const close = (a, b, tol) => {
    if (a === b) return true; // the same infinity, or exactly equal
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= (tol || 0) + 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  };
  // Do two expressions mean the same? Constants are compared with the tolerance; with variables, at
  // sample values (and positive ones only, if the first set mostly falls outside where it's defined).
  function sameExpr(a, b, tol) {
    const names = [...new Set([...varsOf(a), ...varsOf(b)])];
    if (!names.length) return close(evaluate(a, {}), evaluate(b, {}), tol);
    for (let pass = 0; pass < PASSES.length; pass++) {
      let checked = 0;
      let bad = false;
      for (const s of scopes(names, pass)) {
        const want = evaluate(a, s);
        if (!Number.isFinite(want)) continue;
        const got = evaluate(b, s);
        if (!close(want, got, 0)) { bad = true; break; }
        checked++;
      }
      if (bad) return false;
      if (checked >= 6) return true;
    }
    return false;
  }
  // A relation solved for a variable: x = 4, y = 2x + 1, 3 < x. { v, op (with v on the left), other }
  function solvedFor(rel, v) {
    if (rel.sides.length !== 2) return null;
    const [l, r] = rel.sides;
    const op = rel.ops[0];
    const lone = (n) => n.t === 'var' && (v == null || n.n === v);
    const flip = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=', '!=': '!=' };
    if (lone(l) && !varsOf(r).has(l.n)) return { v: l.n, op, other: r };
    if (lone(r) && !varsOf(l).has(r.n)) return { v: r.n, op: flip[op], other: l };
    return null;
  }
  // f(x) = …, g(t) = …: a name for what follows, like y. { other } or null
  function labelled(rel) {
    if (rel.t !== 'rel' || rel.sides.length !== 2 || rel.ops[0] !== '=') return null;
    const [l, r] = rel.sides;
    const fx = (n) => n.t === 'bin' && n.imp && n.op === '*' && n.a.t === 'var' && n.b.t === 'paren' && n.b.a.t === 'var';
    if (fx(l)) return { name: l.a.n, other: r };
    if (fx(r)) return { name: r.a.n, other: l };
    const s = solvedFor(rel);
    return s ? { name: s.v, other: s.other } : null;
  }
  function sameRel(e, g, tol) {
    // chains: 1 < x < 5 and 5 > x > 1
    const chain = (r) => {
      const desc = r.ops.every((o) => o === '>' || o === '>=');
      if (!desc) return r;
      const flip = { '>': '<', '>=': '<=' };
      return { t: 'rel', sides: r.sides.slice().reverse(), ops: r.ops.slice().reverse().map((o) => flip[o]) };
    };
    if (e.sides.length === 3 || g.sides.length === 3) {
      if (e.sides.length !== g.sides.length) return false;
      const a = chain(e);
      const b = chain(g);
      for (let k = 0; k < 2; k++) {
        if (!sameRel({ t: 'rel', sides: [a.sides[k], a.sides[k + 1]], ops: [a.ops[k]] }, { t: 'rel', sides: [b.sides[k], b.sides[k + 1]], ops: [b.ops[k]] }, tol)) return false;
      }
      return true;
    }
    // Solved for a variable: the student's has to be solved for it too.
    const es = solvedFor(e);
    if (es) {
      const gs = solvedFor(g, es.v);
      return !!gs && gs.op === es.op && sameExpr(es.other, gs.other, tol);
    }
    const a = normRel(e.sides[0], e.ops[0], e.sides[1]);
    const b = normRel(g.sides[0], g.ops[0], g.sides[1]);
    if (a.op !== b.op) return false;
    return proportional(a.F, b.F, a.op === '=' || a.op === '!=' ? 0 : 1);
  }
  // Is G = k·F for some constant k (k > 0 when sign is 1, any nonzero k when 0)?
  function proportional(F, G, sign) {
    const names = [...new Set([...varsOf(F), ...varsOf(G)])];
    for (let pass = 0; pass < PASSES.length; pass++) {
      let k = null;
      let checked = 0;
      let bad = false;
      for (const s of scopes(names, pass)) {
        const f = evaluate(F, s);
        const g = evaluate(G, s);
        if (!Number.isFinite(f)) continue;
        if (!Number.isFinite(g)) { bad = true; break; }
        if (k == null) {
          if (Math.abs(f) < 1e-9) { if (Math.abs(g) > 1e-9) { bad = true; break; } checked++; continue; }
          k = g / f;
          if (Math.abs(k) < 1e-12 || (sign > 0 && k < 0)) { bad = true; break; }
          checked++;
          continue;
        }
        if (!close(k * f, g, 0)) { bad = true; break; }
        checked++;
      }
      if (bad) return false;
      if (checked >= 6) return k != null || names.length === 0;
    }
    return false;
  }
  function sameItem(e, g, tol) {
    const isRel = (n) => n.t === 'rel';
    if (e.t === 'tuple' || g.t === 'tuple') {
      if (e.t !== 'tuple' || g.t !== 'tuple' || e.items.length !== g.items.length) return false;
      if ((e.open !== g.open || e.close !== g.close)) return false;
      return e.items.every((x, i) => sameExpr(x, g.items[i], tol));
    }
    if (isRel(e) && isRel(g)) return sameRel(e, g, tol);
    if (isRel(e)) { // x = 4, answered 4
      const s = e.ops.length === 1 && e.ops[0] === '=' ? solvedFor(e) : null;
      return !!s && !varsOf(g).has(s.v) && sameExpr(s.other, g, tol);
    }
    if (isRel(g)) { // 2x + 1, answered y = 2x + 1 or f(x) = 2x + 1
      const l = labelled(g);
      return !!l && !varsOf(e).has(l.name) && sameExpr(e, l.other, tol);
    }
    return sameExpr(e, g, tol);
  }
  // Every expected item matched by a different one of the student's, in any order.
  function sameItems(E, G, tol) {
    if (E.length !== G.length) return false;
    const used = new Array(G.length).fill(false);
    const go = (i) => {
      if (i === E.length) return true;
      for (let j = 0; j < G.length; j++) {
        if (used[j] || !sameItem(E[i], G[j], tol)) continue;
        used[j] = true;
        if (go(i + 1)) return true;
        used[j] = false;
      }
      return false;
    };
    return go(0);
  }

  // ---------- forms ----------
  // The parts of an item that are the answer itself (not the y = in front of it).
  function answerParts(n) {
    if (n.t === 'tuple' || n.t === 'set') return n.items;
    if (n.t === 'rel') {
      const s = n.sides.length === 2 ? solvedFor(n) : null;
      if (s) return [s.other];
      return n.sides;
    }
    return [n];
  }
  const unparen = (n) => (n.t === 'paren' ? unparen(n.a) : n);
  const isSum = (n) => { n = unparen(n); return n.t === 'bin' && (n.op === '+' || n.op === '-'); };
  function walk(n, fn) {
    if (!n || typeof n !== 'object') return;
    fn(n);
    for (const k of ['a', 'b', 'base']) if (n[k]) walk(n[k], fn);
    for (const k of ['sides', 'items']) if (n[k]) n[k].forEach((x) => walk(x, fn));
  }
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const FORMS = {
    // multiplied out: no sum inside a product or a power, (x+2)(x+3) and (x+1)^2 aren't
    expanded: (n) => {
      let ok = true;
      walk(n, (x) => {
        if (x.t === 'bin' && x.op === '*' && (isSum(x.a) || isSum(x.b))) ok = false;
        if (x.t === 'bin' && x.op === '^' && isSum(x.a)) ok = false;
        if (x.t === 'neg' && isSum(x.a)) ok = false;
      });
      return ok;
    },
    // written as a product: (x+2)(x-3), 2x(x+1), not x^2 - x - 6
    factored: (n) => !isSum(n),
    // no decimals: 3/4 and sqrt(2)/2, not 0.75 and 0.707
    exact: (n) => { let ok = true; walk(n, (x) => { if (x.t === 'num' && x.dec) ok = false; }); return ok; },
    // a fraction in lowest terms (and no decimals): 3/4, not 6/8 or 0.75
    lowest: (n) => {
      if (!FORMS.exact(n)) return false;
      let ok = true;
      walk(n, (x) => {
        if (x.t !== 'bin' || x.op !== '/') return;
        const num = unparen(x.a.t === 'neg' ? x.a.a : x.a);
        const den = unparen(x.b.t === 'neg' ? x.b.a : x.b);
        if (num.t === 'num' && den.t === 'num' && Number.isInteger(num.v) && Number.isInteger(den.v)) {
          if (den.v === 1 || gcd(num.v, den.v) !== 1) ok = false;
        }
      });
      return ok;
    },
  };
  const FORM_NAMES = Object.keys(FORMS);
  const inForm = (items, form) => !form || !FORMS[form] || items.every((it) => answerParts(it).every((part) => FORMS[form](part)));

  // Does the student's answer (LaTeX, from the math box) match an accepted one (plain text, or LaTeX)?
  // opts: { tolerance, form }. A student answer that can't be read never matches.
  function matches(accepted, got, opts) {
    opts = opts || {};
    let G;
    try { G = readAnswer(got, { latex: true }); } catch (e) { return false; }
    if (!inForm(G, opts.form)) return false;
    const tol = Math.max(0, Number(opts.tolerance) || 0);
    return [].concat(accepted).some((want) => {
      let E;
      try { E = readAnswer(want, { latex: false }); } catch (e) { return false; }
      return sameItems(E, G, tol);
    });
  }
  // Check an answer key when a quiz is saved: null when it can be read, else what's wrong.
  function checkAnswer(src) {
    try { readAnswer(src, { latex: false }); return null; } catch (e) { return e instanceof MathError ? e.message : 'It can\'t be read as math.'; }
  }
  // Is an answer key (plain text) written in the form it asks of students?
  function keyInForm(src, form) {
    try { return inForm(readAnswer(src, { latex: false }), form); } catch (e) { return false; }
  }
  // What's wrong with what a student typed, for a note under the box (null: it reads fine).
  function problem(src, latex) {
    if (!String(src || '').trim()) return null;
    try { readAnswer(src, { latex: latex !== false }); return null; } catch (e) { return e instanceof MathError ? e.message : 'This can\'t be read as math.'; }
  }

  // ---------- LaTeX, for showing a typed answer ----------
  const PREC = { '+': 1, '-': 1, pm: 1, mp: 1, '*': 2, '/': 2, neg: 3, '^': 4 };
  const fnTex = { sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot', asin: '\\sin^{-1}', acos: '\\cos^{-1}', atan: '\\tan^{-1}', ln: '\\ln', log: '\\log', exp: '\\exp', abs: '\\operatorname{abs}' };
  const numTex = (v) => (v === Infinity ? '\\infty' : String(v));
  const varTex = (n) => {
    const [base, sub] = n.split('_');
    const b = GREEK_SET.has(base) ? '\\' + base + ' ' : base;
    return sub ? `${b}_{${sub}}` : b;
  };
  function tex(n, parent) {
    const wrap = (s, prec) => (parent != null && prec < parent ? `\\left(${s}\\right)` : s);
    switch (n.t) {
      case 'num': return numTex(n.v);
      case 'const': return n.n === 'pi' ? '\\pi ' : 'e';
      case 'var': return varTex(n.n);
      case 'paren': return `\\left(${tex(n.a)}\\right)`;
      case 'abs': return `\\left|${tex(n.a)}\\right|`;
      case 'neg': return wrap('-' + tex(n.a, PREC.neg), PREC.neg);
      case 'fn': {
        if (n.f === 'sqrt') return `\\sqrt{${tex(n.a)}}`;
        if (n.f === 'cbrt') return `\\sqrt[3]{${tex(n.a)}}`;
        if (n.f === 'root') return `\\sqrt[${tex(n.base)}]{${tex(n.a)}}`;
        const name = fnTex[n.f] + (n.f === 'log' && n.base ? `_{${tex(n.base)}}` : '');
        return wrap(`${name}\\left(${tex(n.a)}\\right)`, PREC['^']);
      }
      case 'bin': {
        const p = PREC[n.op];
        if (n.op === '/') return wrap(`\\frac{${tex(n.a)}}{${tex(n.b)}}`, 5);
        if (n.op === '^') return wrap(`${tex(n.a, p + 1)}^{${tex(unparen(n.b))}}`, p);
        if (n.op === 'pm' || n.op === 'mp') return wrap(`${n.a ? tex(n.a, p) : ''}${n.op === 'pm' ? '\\pm ' : '\\mp '}${tex(n.b, p + 1)}`, p);
        if (n.op === '*') {
          const a = tex(n.a, p);
          const b = tex(n.b, p + 1);
          const dot = !n.imp || /^[\d.]/.test(b) || n.b.t === 'neg';
          return wrap(a + (dot ? ' \\cdot ' : '') + b, p);
        }
        return wrap(tex(n.a, p) + (n.op === '+' ? '+' : '-') + tex(n.b, p + 1), p);
      }
      default: return '';
    }
  }
  const REL_TEX = { '=': '=', '<': '<', '>': '>', '<=': '\\le ', '>=': '\\ge ', '!=': '\\ne ' };
  function itemTex(it) {
    if (it.t === 'rel') return it.sides.map((s, i) => (i ? REL_TEX[it.ops[i - 1]] : '') + tex(s)).join('');
    if (it.t === 'tuple') return `\\left${it.open === '[' ? '[' : '('}${it.items.map((x) => tex(x)).join(', ')}\\right${it.close}`;
    if (it.t === 'set') return `\\left\\{${it.items.map(itemTex).join(', ')}\\right\\}`;
    return tex(it);
  }
  // A plain-text answer (a teacher's) as LaTeX, to show it typeset; null when it can't be read.
  function toTex(src, latex) {
    try { return parse(src, { latex: !!latex }).map(itemTex).join(',\\ '); } catch (e) { return null; }
  }

  return {
    MathError, parse, readAnswer, evaluate, varsOf, matches, checkAnswer, inForm: keyInForm, problem, toTex, sameExpr, FORM_NAMES, shapes,
  };
}));
