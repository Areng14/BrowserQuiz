// Math answers, read: the words, the tokens and the parser that turn an answer into a small tree of
// numbers, variables and operators, and evaluating that tree. mathexpr.js (comparing answers) and
// mathshapes.js (graphs) build on it. Shared by the server and the browser, with no dependencies.
//
// It reads two spellings of the same language:
//  - plain text, as teachers write answers: 2x + 3, x^2 - 1, sqrt(2)/2, x <= 3, (2, -3), x = 3, x = -3
//  - LaTeX, as the student's math box (MathLive) sends it: \frac{1}{2}, \sqrt{x}, x\le3, \left(2,-3\right)
// Single letters are variables (xy is x times y), e and pi are the constants, and the usual functions
// are known (sin, cos, tan and their inverses, sec, csc, cot, sqrt, abs, ln, log, exp). Nothing in here
// runs code: an answer becomes a small tree of numbers, variables and operators, and is evaluated by
// walking it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQMathRead = factory();
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

  // a op b, as F op' 0 with op' one of = != < <= (so x > 3 is 3 - x < 0).
  function normRel(lhs, op, rhs) {
    if (op === '>' || op === '>=') return { F: { t: 'bin', op: '-', a: rhs, b: lhs }, op: op === '>' ? '<' : '<=' };
    return { F: { t: 'bin', op: '-', a: lhs, b: rhs }, op };
  }

  return { MathError, fail, GREEK_SET, parse, readAnswer, evaluate, varsOf, normRel };
}));
