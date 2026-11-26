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
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_LEN = 1000;
  const MAX_TOKENS = 400;
  const MAX_DEPTH = 60;

  class MathError extends Error {}
  const fail = (msg) => { throw new MathError(msg); };

  // ---------- words ----------
  const FUNCS = {
    sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
    arcsin: 'asin', arccos: 'acos', arctan: 'atan', asin: 'asin', acos: 'acos', atan: 'atan',
    sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs', ln: 'ln', log: 'log', exp: 'exp',
  };
  const INVERSE = { sin: 'asin', cos: 'acos', tan: 'atan' };
  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
    'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega'];
  const GREEK_SET = new Set(GREEK);
  const INFINITY = new Set(['infty', 'infinity', 'inf', 'oo']);
  // Words read out of a run of letters, longest first, so "sinx" is sin x and "pix" is pi x.
  const WORDS = Object.keys(FUNCS).concat(GREEK.filter((g) => g.length >= 3), ['pi', 'infinity', 'inf']).sort((a, b) => b.length - a.length);
  const FN_WORDS = Object.keys(FUNCS).sort((a, b) => b.length - a.length);
  const UNICODE = [
    [/[−–—]/g, '-'], [/[×·⋅∙]/g, '*'], [/÷/g, '/'], [/≤|⩽/g, '<='], [/≥|⩾/g, '>='], [/≠/g, '!='],
    [/π/g, '\\pi '], [/√/g, '\\sqrt '], [/±/g, '\\pm '], [/∞/g, '\\infty '], [/∪/g, '\\cup '], [/θ/g, '\\theta '],
    [/²/g, '^2'], [/³/g, '^3'], [/ /g, ' '],
  ];
  // LaTeX commands that mean an operator or nothing at all.
  const LATEX_OPS = {
    cdot: '*', times: '*', ast: '*', div: '/', le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=',
    ne: '!=', neq: '!=', lt: '<', gt: '>', pm: 'pm', mp: 'mp', cup: 'cup',
  };
  const LATEX_SPACE = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle', 'left.', 'right.']);

  // ---------- tokens ----------
  // { k: 'num', v, dec } | { k: 'var', n } | { k: 'const', n } | { k: 'fn', f } | { k: 'op', v } |
  // { k: 'open', v: '(' | '[' | '{' | '|' | 'set' } | { k: 'close', v } | { k: 'bar' } | { k: 'frac' } | { k: 'sqrt' }
  function tokenize(src, latex) {
    let s = String(src == null ? '' : src);
    if (s.length > MAX_LEN) fail('That answer is too long.');
    for (const [re, to] of UNICODE) s = s.replace(re, to);
    const out = [];
    const push = (t) => { if (out.push(t) > MAX_TOKENS) fail('That answer is too long.'); };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) fail(`"${c}" isn't a number.`);
        // LaTeX: an argument without braces is one character (\frac12, x^10), handled by the parser.
        push({ k: 'num', v: Number(m[1]), dec: m[1].includes('.'), text: m[1] });
        i += m[1].length;
        continue;
      }
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        if (!m) fail('A \\ on its own.');
        const name = m[1];
        i += m[0].length;
        if (name === 'left' || name === 'right' || name === 'bigl' || name === 'bigr' || name === 'Bigl' || name === 'Bigr') {
          // \left( \left[ \left| \left\{ \left.  — the bracket that follows
          const rest = /^\s*(\\\{|\\\}|\\lvert|\\rvert|\\vert|\\lbrace|\\rbrace|\\langle|\\rangle|[()[\]|.])/.exec(s.slice(i));
          if (!rest) fail(`\\${name} needs a bracket after it.`);
          i += rest[0].length;
          const b = rest[1];
          const open = name.endsWith('l') || name === 'left';
          if (b === '.') continue;
          if (b === '|' || b === '\\vert' || b === '\\lvert' || b === '\\rvert') { push({ k: open ? 'open' : 'close', v: '|' }); continue; }
          if (b === '\\{' || b === '\\lbrace') { push({ k: 'open', v: 'set' }); continue; }
          if (b === '\\}' || b === '\\rbrace') { push({ k: 'close', v: 'set' }); continue; }
          if (b === '\\langle' || b === '\\rangle') { push({ k: b === '\\langle' ? 'open' : 'close', v: '(' }); continue; }
          push({ k: '([{'.includes(b) ? 'open' : 'close', v: b === ')' ? '(' : b === ']' ? '[' : b });
          continue;
        }
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') { push({ k: 'frac' }); continue; }
        if (name === 'sqrt') { push({ k: 'sqrt' }); continue; }
        if (name === 'pi') { push({ k: 'const', n: 'pi' }); continue; }
        if (name === 'exponentialE') { push({ k: 'const', n: 'e' }); continue; }
        if (INFINITY.has(name)) { push({ k: 'num', v: Infinity, text: '∞' }); continue; }
        if (GREEK_SET.has(name)) { push({ k: 'var', n: name.replace(/^var/, '') }); continue; }
        if (FUNCS[name] || name === 'arcsin' || name === 'arccos' || name === 'arctan') { push({ k: 'fn', f: FUNCS[name] }); continue; }
        if (LATEX_OPS[name]) { push({ k: 'op', v: LATEX_OPS[name] }); continue; }
        if (name === 'lvert' || name === 'vert' || name === 'mid') { push({ k: 'bar' }); continue; }
        if (name === 'rvert') { push({ k: 'close', v: '|' }); continue; }
        if (name === '{' || name === 'lbrace') { push({ k: 'open', v: 'set' }); continue; }
        if (name === '}' || name === 'rbrace') { push({ k: 'close', v: 'set' }); continue; }
        if (name === 'operatorname' || name === 'mathrm' || name === 'mathit' || name === 'text' || name === 'textrm' || name === 'mathbf') {
          // \operatorname{abs}, \mathrm{d}: the word in braces
          const w = /^\s*\{\s*([A-Za-z]*)\s*\}/.exec(s.slice(i));
          if (!w) fail(`\\${name} needs a word in braces.`);
          i += w[0].length;
          if (!w[1]) continue;
          words(w[1], push, true, latex);
          continue;
        }
        if (LATEX_SPACE.has(name)) continue;
        if (name === 'placeholder') fail('Fill in the empty box.');
        fail(`\\${name} isn't something this can read.`);
      }
      if (/[A-Za-z]/.test(c)) {
        const m = /^[A-Za-z]+/.exec(s.slice(i));
        i += m[0].length;
        if (!latex && m[0] === 'U') { push({ k: 'op', v: 'cup' }); continue; } // (-oo, 2) U (3, oo)
        words(m[0], push, false, latex);
        continue;
      }
      if (c === '<' || c === '>' || c === '!' || c === '=') {
        if (s[i + 1] === '=' && c !== '=') { push({ k: 'op', v: c + '=' }); i += 2; continue; }
        if (c === '!') fail('"!" isn\'t something this can read.');
        if (c === '=' && s[i + 1] === '=') { push({ k: 'op', v: '=' }); i += 2; continue; }
        push({ k: 'op', v: c });
        i++;
        continue;
      }
      if (c === '+' && s[i + 1] === '-') { push({ k: 'op', v: 'pm' }); i += 2; continue; }
      if ('+-*/^_,'.includes(c)) {
        if (c === '*' && s[i + 1] === '*') { push({ k: 'op', v: '^' }); i += 2; continue; }
        push({ k: 'op', v: c });
        i++;
        continue;
      }
      if (c === '(' || c === '[') { push({ k: 'open', v: c }); i++; continue; }
      if (c === ')' || c === ']') { push({ k: 'close', v: c === ')' ? '(' : '[' }); i++; continue; }
      if (c === '{') { push({ k: 'open', v: '{' }); i++; continue; }
      if (c === '}') { push({ k: 'close', v: '{' }); i++; continue; }
      if (c === '|') { push({ k: 'bar' }); i++; continue; }
      if (c === '%') fail('Write a percent as a number (25% is 0.25), unless the question says otherwise.');
      fail(`"${c}" isn't something this can read.`);
    }
    return out;
  }
  // A run of letters: known words (sin, sqrt, pi, theta, infinity), else one variable per letter.
  function words(run, push, whole, latex) {
    const low = run.toLowerCase();
    if (whole && FUNCS[low]) { push({ k: 'fn', f: FUNCS[low] }); return; }
    const list = latex ? FN_WORDS : WORDS;
    let j = 0;
    while (j < run.length) {
      const rest = low.slice(j);
      if (!latex && rest === 'oo') { push({ k: 'num', v: Infinity, text: '∞' }); j += 2; continue; }
      const w = list.find((x) => rest.startsWith(x));
      if (w) {
        if (FUNCS[w]) push({ k: 'fn', f: FUNCS[w] });
        else if (w === 'pi') push({ k: 'const', n: 'pi' });
        else if (w === 'infinity' || w === 'inf') push({ k: 'num', v: Infinity, text: '∞' });
        else push({ k: 'var', n: w.replace(/^var/, '') });
        j += w.length;
        continue;
      }
      const ch = run[j];
      if (ch === 'e') push({ k: 'const', n: 'e' });
      else push({ k: 'var', n: ch });
      j++;
    }
  }

  // ---------- parser ----------
  // Nodes: { t: 'num', v, dec } | { t: 'var', n } | { t: 'const', n } | { t: 'neg', a } |
  // { t: 'bin', op: + - * / ^ pm, a, b, imp } | { t: 'fn', f, a, base, root } | { t: 'abs', a }
  // Items (top level): an expression | { t: 'rel', sides, ops } | { t: 'tuple', open, close, items }
  function parse(src, opts) {
    const latex = !!(opts && opts.latex);
    const toks = tokenize(src, latex);
    let p = 0;
    let depth = 0;
    let bars = 0; // plain | absolute values open
    const peek = (o) => toks[p + (o || 0)];
    const isOp = (t, v) => t && t.k === 'op' && (v == null || t.v === v);
    const deeper = () => { if (++depth > MAX_DEPTH) fail('That answer is nested too deeply.'); };
    const expect = (k, v, what) => {
      const t = toks[p];
      if (!t || t.k !== k || (v != null && t.v !== v)) fail(what);
      p++;
      return t;
    };

    // list := item (',' item | '∪' item)*  — a whole answer, which can be several items
    function list(stop) {
      const items = [item()];
      while (isOp(peek(), ',') || isOp(peek(), 'cup')) { p++; items.push(item()); }
      if (p < toks.length && !stop) fail(leftover(toks[p]));
      return items;
    }
    function leftover(t) {
      if (t.k === 'close') return 'There\'s a closing bracket without an opening one.';
      return 'Part of the answer can\'t be read. Check for a missing sign or bracket.';
    }
    // item := tuple | expr (relop expr)*
    function item() {
      const t = peek();
      if (t && t.k === 'open' && (t.v === '(' || t.v === '[')) {
        // a point or interval: (2, 3), [1, 5), unless it's just brackets around an expression
        const save = p;
        const tup = tryTuple();
        if (tup) return tup;
        p = save;
      }
      if (t && t.k === 'open' && (t.v === 'set' || t.v === '{')) {
        // {1, 2, 3}: a set, unless the braces just group an expression
        const at = { p, depth, bars };
        try {
          p++;
          const inner = list(true);
          const c = peek();
          const after = peek(1);
          if (c && c.k === 'close' && c.v === t.v && (!after || isOp(after, ',') || isOp(after, 'cup'))) { p++; return { t: 'set', items: inner }; }
        } catch (e) { if (!(e instanceof MathError)) throw e; }
        p = at.p; depth = at.depth; bars = at.bars;
        if (t.v === 'set') fail('A set needs its closing brace.');
      }
      const sides = [expr()];
      const ops = [];
      while (peek() && peek().k === 'op' && ['=', '<', '>', '<=', '>=', '!='].includes(peek().v)) {
        ops.push(toks[p++].v);
        if (!peek() || isOp(peek(), ',')) fail(`Something has to come after "${ops[ops.length - 1]}".`);
        sides.push(expr());
      }
      if (sides.length > 3) fail('Write at most two signs in a row, like 1 < x < 5.');
      return ops.length ? { t: 'rel', sides, ops } : sides[0];
    }
    function tryTuple() {
      const open = toks[p].v;
      const at = { depth, bars };
      p++;
      deeper();
      let parts;
      try {
        parts = [expr()];
        while (isOp(peek(), ',')) { p++; parts.push(expr()); }
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        depth = at.depth;
        bars = at.bars;
        return null;
      }
      depth = at.depth;
      const t = peek();
      if (parts.length < 2 || !t || t.k !== 'close' || (t.v !== '(' && t.v !== '[')) return null;
      p++;
      const after = peek();
      if (after && !(after.k === 'op' && (after.v === ',' || after.v === 'cup'))) return null; // (2, 3)x: not a tuple
      if (parts.length > 10) fail('A point can have at most 10 numbers.');
      return { t: 'tuple', open, close: t.v === '(' ? ')' : ']', items: parts };
    }
    // expr := term (('+' | '-' | '±') term)*
    function expr() {
      deeper();
      let a;
      if (isOp(peek(), '+') || isOp(peek(), '-') || isOp(peek(), 'pm') || isOp(peek(), 'mp')) {
        const op = toks[p++].v;
        const b = term();
        a = op === '-' ? { t: 'neg', a: b } : op === '+' ? b : { t: 'bin', op: op === 'pm' ? 'pm' : 'mp', a: null, b };
      } else a = term();
      while (isOp(peek(), '+') || isOp(peek(), '-') || isOp(peek(), 'pm') || isOp(peek(), 'mp')) {
        const op = toks[p++].v;
        a = { t: 'bin', op, a, b: term() };
      }
      depth--;
      return a;
    }
    // term := unary (('*' | '/') unary | implicit factor)*
    function term(noFn) {
      deeper();
      let a = unary();
      for (;;) {
        const t = peek();
        if (isOp(t, '*') || isOp(t, '/')) { p++; a = { t: 'bin', op: t.v, a, b: unary() }; continue; }
        if (startsFactor(t) && !(noFn && t.k === 'fn')) {
          if (a.t === 'num' && t.k === 'num') fail('Two numbers in a row. Use * between them, or a single number.');
          a = { t: 'bin', op: '*', a, b: power(), imp: true };
          continue;
        }
        break;
      }
      depth--;
      return a;
    }
    function startsFactor(t) {
      if (!t) return false;
      if (t.k === 'num' || t.k === 'var' || t.k === 'const' || t.k === 'fn' || t.k === 'frac' || t.k === 'sqrt') return true;
      if (t.k === 'open' && t.v !== 'set') return true;
      // a bar opens |x| unless it closes the one we're inside
      if (t.k === 'bar') return bars === 0;
      return false;
    }
    function unary() {
      if (isOp(peek(), '-')) { p++; return { t: 'neg', a: unary() }; }
      if (isOp(peek(), '+')) { p++; return unary(); }
      return power();
    }
    // power := primary ('^' exponent)?   (right to left: 2^3^2 is 2^9)
    function power() {
      const base = primary();
      if (isOp(peek(), '^')) {
        p++;
        return { t: 'bin', op: '^', a: base, b: exponent() };
      }
      return base;
    }
    function exponent() {
      deeper();
      let e;
      if (latex) e = arg();
      else if (isOp(peek(), '-')) { p++; e = { t: 'neg', a: exponent() }; } else if (isOp(peek(), '+')) { p++; e = exponent(); } else e = power();
      depth--;
      return e;
    }
    // A LaTeX argument: {...}, or a single character (\frac12, x^2y is x^2 times y)
    function arg() {
      const t = peek();
      if (!t) fail('Something is missing at the end.');
      if (t.k === 'open' && t.v === '{') {
        p++;
        const e = expr();
        expect('close', '{', 'A { needs its closing }.');
        return e;
      }
      if (t.k === 'num' && t.text && t.text.length > 1 && t.v !== Infinity) {
        // only the first digit: split the token
        const first = t.text[0];
        const rest = t.text.slice(1);
        toks[p] = { k: 'num', v: Number(rest), dec: rest.includes('.'), text: rest };
        if (first === '.') fail('A decimal point on its own.');
        return { t: 'num', v: Number(first), dec: false };
      }
      if (isOp(t, '-')) { p++; return { t: 'neg', a: arg() }; }
      return primary();
    }
    function primary() {
      deeper();
      const t = toks[p];
      if (!t) fail('Something is missing at the end.');
      let node;
      if (t.k === 'num') { p++; node = { t: 'num', v: t.v, dec: !!t.dec }; }
      else if (t.k === 'var') {
        p++;
        node = { t: 'var', n: t.n };
        if (isOp(peek(), '_')) { p++; node.n += '_' + subscript(); }
      } else if (t.k === 'const') { p++; node = { t: 'const', n: t.n }; }
      else if (t.k === 'frac') {
        p++;
        const a = arg();
        const b = arg();
        node = { t: 'bin', op: '/', a, b, frac: true };
      } else if (t.k === 'sqrt') {
        p++;
        let index = null;
        if (peek() && peek().k === 'open' && peek().v === '[') {
          p++;
          index = expr();
          expect('close', '[', 'The root needs its closing ].');
        }
        const a = latex || (peek() && peek().k === 'open' && peek().v === '{') ? arg() : fnArg();
        node = index ? { t: 'fn', f: 'root', a, base: index } : { t: 'fn', f: 'sqrt', a };
      } else if (t.k === 'fn') {
        p++;
        node = fnCall(t.f);
      } else if (t.k === 'open' && t.v !== 'set') {
        p++;
        if (t.v === '|') {
          const was = bars;
          bars = 0;
          const inner = expr();
          bars = was;
          if (!(peek() && peek().k === 'close' && peek().v === '|')) fail('An absolute value needs its closing |.');
          p++;
          node = { t: 'abs', a: inner };
        } else {
          const inner = expr();
          const c = peek();
          if (!c || c.k !== 'close') fail(`A ${t.v === '{' ? '{' : t.v} needs its closing bracket.`);
          if (c.v !== t.v) fail('The brackets don\'t match.');
          p++;
          node = t.v === '{' ? inner : { t: 'paren', a: inner };
        }
      } else if (t.k === 'bar') {
        p++;
        bars++;
        const inner = expr();
        bars--;
        if (!(peek() && peek().k === 'bar')) fail('An absolute value needs its closing |.');
        p++;
        node = { t: 'abs', a: inner };
      } else if (t.k === 'op' && (t.v === '=' || t.v === '<' || t.v === '>' || t.v === '<=' || t.v === '>=' || t.v === '!=')) {
        fail(`Something has to come before "${t.v}".`);
      } else if (t.k === 'close') fail('There\'s a closing bracket without an opening one.');
      else fail('Something is missing between two signs.');
      depth--;
      return node;
    }
    function subscript() {
      const t = peek();
      if (!t) fail('A subscript is missing.');
      if (t.k === 'open' && t.v === '{') {
        p++;
        let s = '';
        while (peek() && !(peek().k === 'close' && peek().v === '{')) {
          const x = toks[p++];
          if (x.k === 'num') s += x.text;
          else if (x.k === 'var') s += x.n;
          else fail('A subscript can only have letters and digits.');
        }
        expect('close', '{', 'A { needs its closing }.');
        if (!s) fail('A subscript is missing.');
        return s;
      }
      if (t.k === 'num' && t.v !== Infinity && !t.dec) {
        if (latex && t.text.length > 1) {
          toks[p] = { k: 'num', v: Number(t.text.slice(1)), dec: false, text: t.text.slice(1) };
          return t.text[0];
        }
        p++;
        return t.text;
      }
      p++;
      if (t.k === 'var') return t.n;
      fail('A subscript can only have letters and digits.');
    }
    // sin x, sin(x), sin^2 x, sin^{-1} x, log_2 x, log_{10}(x)
    function fnCall(f) {
      let base = null;
      let pow = null;
      if (f === 'log' && isOp(peek(), '_')) {
        p++;
        base = latex ? arg() : primary();
      }
      if (isOp(peek(), '^')) {
        p++;
        pow = exponent();
        if (INVERSE[f] && isMinusOne(pow)) { f = INVERSE[f]; pow = null; }
      }
      const a = fnArg();
      let node = { t: 'fn', f, a };
      if (base) node.base = base;
      if (pow) node = { t: 'bin', op: '^', a: node, b: pow };
      return node;
    }
    // A function's argument: (…) right after it, else the product that follows (sin 2x is sin(2x)).
    function fnArg() {
      const t = peek();
      if (!t) fail('A function is missing what it applies to.');
      if (t.k === 'open' && (t.v === '(' || t.v === '[' || t.v === '{')) {
        p++;
        const inner = expr();
        const c = peek();
        if (!c || c.k !== 'close') fail('A bracket needs its closing bracket.');
        p++;
        return inner;
      }
      if (!startsFactor(t) && !isOp(t, '-')) fail('A function is missing what it applies to.');
      if (isOp(t, '-')) { p++; return { t: 'neg', a: term(true) }; }
      return term(true);
    }
    const out = list(false);
    return out;
  }
  const isMinusOne = (n) => n && ((n.t === 'neg' && n.a.t === 'num' && n.a.v === 1) || (n.t === 'num' && n.v === -1));

  // One reading of an answer: its items, with ± written out (x = ±3 is x = 3, x = -3).
  function readAnswer(src, opts) {
    const items = parse(src, opts);
    const out = [];
    for (const it of items) {
      if (it.t === 'set') { for (const x of it.items) out.push(...expandPm(x)); continue; }
      out.push(...expandPm(it));
    }
    if (out.length > 20) fail('At most 20 parts in one answer.');
    return out;
  }
  // Every way of reading the ± signs, at most 4.
  function expandPm(node) {
    let count = 0;
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.t === 'bin' && (n.op === 'pm' || n.op === 'mp')) count++; for (const k of ['a', 'b', 'base']) walk(n[k]); for (const k of ['sides', 'items']) if (n[k]) n[k].forEach(walk); };
    walk(node);
    if (!count) return [node];
    if (count > 2) fail('At most two ± signs.');
    const outs = [];
    for (let mask = 0; mask < (1 << count); mask++) {
      let k = 0;
      const copy = (n) => {
        if (!n || typeof n !== 'object') return n;
        const o = Object.assign({}, n);
        if (n.t === 'bin' && (n.op === 'pm' || n.op === 'mp')) {
          const plus = ((mask >> k++) & 1) === 0;
          const sign = n.op === 'pm' ? plus : !plus;
          const b = copy(n.b);
          const a = n.a ? copy(n.a) : null;
          if (!a) return sign ? b : { t: 'neg', a: b };
          return { t: 'bin', op: sign ? '+' : '-', a, b };
        }
        for (const key of ['a', 'b', 'base']) if (n[key]) o[key] = copy(n[key]);
        for (const key of ['sides', 'items']) if (n[key]) o[key] = n[key].map(copy);
        return o;
      };
      outs.push(copy(node));
    }
    return outs;
  }

  // ---------- evaluating ----------
  const CONSTS = { pi: Math.PI, e: Math.E };
  function realPow(a, b) {
    if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
    // a negative base to a fraction with an odd bottom: (-8)^(1/3) is -2
    for (let q = 3; q <= 15; q += 2) {
      const pq = b * q;
      if (Math.abs(pq - Math.round(pq)) < 1e-9) {
        const r = Math.pow(-a, b);
        return Math.round(pq) % 2 === 0 ? r : -r;
      }
    }
    return NaN;
  }
  function evaluate(n, scope) {
    switch (n.t) {
      case 'num': return n.v;
      case 'const': return CONSTS[n.n];
      case 'var': return Object.prototype.hasOwnProperty.call(scope, n.n) ? scope[n.n] : NaN;
      case 'paren': return evaluate(n.a, scope);
      case 'neg': return -evaluate(n.a, scope);
      case 'abs': return Math.abs(evaluate(n.a, scope));
      case 'bin': {
        const a = evaluate(n.a, scope);
        const b = evaluate(n.b, scope);
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? NaN : a / b;
          case '^': return realPow(a, b);
          default: return NaN;
        }
      }
      case 'fn': {
        const x = evaluate(n.a, scope);
        switch (n.f) {
          case 'sin': return Math.sin(x);
          case 'cos': return Math.cos(x);
          case 'tan': return Math.abs(Math.cos(x)) < 1e-12 ? NaN : Math.tan(x);
          case 'sec': return 1 / Math.cos(x);
          case 'csc': return 1 / Math.sin(x);
          case 'cot': return 1 / Math.tan(x);
          case 'asin': return Math.asin(x);
          case 'acos': return Math.acos(x);
          case 'atan': return Math.atan(x);
          case 'sqrt': return x < 0 ? NaN : Math.sqrt(x);
          case 'cbrt': return Math.cbrt(x);
          case 'root': {
            const k = evaluate(n.base, scope);
            if (!Number.isInteger(k) || k < 2) return realPow(x, 1 / k);
            return x < 0 ? (k % 2 ? -Math.pow(-x, 1 / k) : NaN) : Math.pow(x, 1 / k);
          }
          case 'abs': return Math.abs(x);
          case 'ln': return x <= 0 ? NaN : Math.log(x);
          case 'log': {
            if (x <= 0) return NaN;
            if (!n.base) return Math.log10(x);
            const b = evaluate(n.base, scope);
            return b > 0 && b !== 1 ? Math.log(x) / Math.log(b) : NaN;
          }
          case 'exp': return Math.exp(x);
          default: return NaN;
        }
      }
      default: return NaN;
    }
  }
  function varsOf(n, out) {
    out = out || new Set();
    if (!n || typeof n !== 'object') return out;
    if (n.t === 'var') out.add(n.n);
    for (const k of ['a', 'b', 'base']) if (n[k]) varsOf(n[k], out);
    for (const k of ['sides', 'items']) if (n[k]) n[k].forEach((x) => varsOf(x, out));
    return out;
  }

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
  // a op b, as F op' 0 with op' one of = != < <= (so x > 3 is 3 - x < 0).
  function normRel(lhs, op, rhs) {
    if (op === '>' || op === '>=') return { F: { t: 'bin', op: '-', a: rhs, b: lhs }, op: op === '>' ? '<' : '<=' };
    return { F: { t: 'bin', op: '-', a: lhs, b: rhs }, op };
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

  return {
    MathError, parse, readAnswer, evaluate, varsOf, matches, checkAnswer, inForm: keyInForm, problem, toTex, sameExpr, FORM_NAMES,
    shapes: { KINDS, KIND_NAMES, HANDLES, shapesOf, fromHandles, sameShape, gradeShapes, checkDrawable, fnOf, sideFn, shapeText },
  };
}));
