// Syntax colors for code shown in a quiz (prompts, choices, examples, results), without the code editor:
// Monaco is 3 MB, and a quiz whose code is only read (what does this print?) shouldn't wait for it. The
// colors are the editor's own (app.css, --sy-*), and they follow the theme without coloring again.
// tokens(src, lang) is pure: it splits the text into [class, text] pieces that join back to it exactly, so
// a student's highlights, which are kept as offsets in the text (marks.js), land in the same place.

import { addHighlight, marksIn, rangeAt } from './marks.js';

const words = (s) => new Set(s.split(' '));
// Words that steer the flow get their own color in the dark theme, as in the editor.
const CONTROL = 'if else for while do switch case default break continue return try catch finally throw';
const C = 'auto char const double enum extern float inline int long register restrict short signed sizeof static struct typedef union unsigned void volatile bool true false NULL';
const LANGS = {
  java: { kw: 'abstract assert boolean byte char class const double enum extends final float implements import instanceof int interface long native new package private protected public short static strictfp super synchronized this transient void volatile var record sealed permits non-sealed true false null' },
  python: {
    kw: 'False None True and as assert async class def del from global import in is lambda nonlocal not or pass with self',
    fn: 'print len range int float str bool list dict set tuple abs min max sum sorted reversed enumerate zip map filter isinstance input open round type any all super object chr ord',
    control: 'elif except raise',
    hash: true,
  },
  javascript: { kw: 'class const debugger delete export extends function import in instanceof let new of static get set super this typeof var void with async true false null undefined' },
  typescript: { kw: 'class const debugger delete export extends function import in instanceof let new of static get set super this typeof var void with async true false null undefined interface type enum implements private protected public readonly abstract declare namespace keyof as is any number string boolean never unknown bigint symbol' },
  c: { kw: C, control: 'goto', pre: true },
  cpp: { kw: C + ' class namespace template typename public private protected virtual override final new delete this using friend operator explicit mutable constexpr nullptr noexcept static_cast dynamic_cast const_cast reinterpret_cast' + ' wchar_t', control: 'goto', pre: true },
  csharp: { kw: 'abstract as base bool byte char checked class const decimal delegate double enum event explicit extern false fixed float implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref sbyte sealed short sizeof stackalloc static string struct this true typeof uint ulong unchecked unsafe ushort using var virtual void volatile async get set init record', control: 'foreach goto' },
  go: {
    kw: 'chan const func go import interface map package range struct type var true false nil iota int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error any',
    fn: 'len cap append make new panic recover copy delete print println min max',
    control: 'fallthrough defer select goto',
  },
  rust: { kw: 'as async const crate dyn enum extern false fn for impl in let mod move mut pub ref self Self static struct super trait true type unsafe use where i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Some None Ok Err Result Box', control: 'loop match' },
};
// What a fence label may say instead (```js)
const ALIAS = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', python3: 'python', h: 'c', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', 'c#': 'csharp', golang: 'go', rs: 'rust' };
for (const l of Object.values(LANGS)) { l.kw = words(l.kw); l.fn = words(l.fn || ''); l.control = words(`${CONTROL} ${l.control || ''}`.trim()); }

// Each rule: a sticky pattern and the class its match gets (null: plain text).
const NUM = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.(?!\.)\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;
const IDENT = /[A-Za-z_$][\w$]*/y;
function rules(lang, l) {
  const r = [];
  if (l.hash) r.push([/#[^\n]*/y, 'sy-m']);
  else r.push([/\/\/[^\n]*/y, 'sy-m'], [/\/\*[\s\S]*?(?:\*\/|$)/y, 'sy-m']);
  if (l.pre) r.push([/#[ \t]*\w+/y, 'pre']); // #include, at the start of a line (below)
  if (lang === 'python') r.push([/[rbfuRBFU]{0,2}(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$))/y, 'sy-s'], [/[rbfuRBFU]{0,2}(?:'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?)/y, 'sy-s']);
  else {
    if (lang === 'csharp') r.push([/\$?@"(?:""|[^"])*"?|@?\$"(?:\\.|[^"\\\n])*"?/y, 'sy-s']);
    if (lang === 'rust') r.push([/r(#*)"[\s\S]*?(?:"\1|$)/y, 'sy-s'], [/b?'(?:\\.|[^'\\\n])'/y, 'sy-s'], [/'[A-Za-z_]\w*/y, 'sy-t']); // a char, else a lifetime
    if (lang === 'javascript' || lang === 'typescript' || lang === 'go') r.push([/`[\s\S]*?(?:`|$)/y, 'sy-s']);
    r.push([/"(?:\\.|[^"\\\n])*"?/y, 'sy-s']);
    if (lang !== 'rust') r.push([/'(?:\\.|[^'\\\n])*'?/y, 'sy-s']);
  }
  r.push([/@[A-Za-z_][\w.]*/y, 'sy-f']); // annotations and decorators
  return r;
}
const cache = new Map();

function tokens(src, name) {
  const lang = ALIAS[name] || name;
  const l = LANGS[lang];
  if (!l) return [[null, src]];
  if (!cache.has(lang)) cache.set(lang, rules(lang, l));
  const rs = cache.get(lang);
  const out = [];
  const push = (cls, text) => {
    const last = out[out.length - 1];
    if (last && last[0] === cls) last[1] += text; else out.push([cls, text]);
  };
  let i = 0;
  while (i < src.length) {
    let hit = null;
    for (const [re, cls] of rs) {
      if (cls === 'pre' && i > 0 && !/\n[ \t]*$/.test(src.slice(Math.max(0, i - 80), i))) continue; // preprocessor: line start only
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m[0]) { hit = [cls === 'pre' ? 'sy-k' : cls, m[0]]; break; }
    }
    if (!hit && /\d|\./.test(src[i]) && (src[i] !== '.' || /\d/.test(src[i + 1] || '')) && !/[\w$]/.test(src[i - 1] || '')) {
      NUM.lastIndex = i;
      const m = NUM.exec(src);
      if (m && m[0]) hit = ['sy-n', m[0]];
    }
    if (!hit) {
      IDENT.lastIndex = i;
      const m = IDENT.exec(src);
      if (m) {
        const w = m[0];
        const after = src.slice(i + w.length, i + w.length + 2);
        const cls = lang === 'rust' && /^![([{]/.test(after) ? 'sy-f' // a macro: println!(
          : l.control.has(w) ? 'sy-c' : l.kw.has(w) ? 'sy-k' : l.fn.has(w) ? 'sy-f'
            : /^[A-Z]/.test(w) && lang !== 'python' ? 'sy-t' : 'sy-i';
        hit = [cls, w];
      }
    }
    if (!hit) hit = [null, src[i]];
    push(hit[0], hit[1]);
    i += hit[1].length;
    if (hit[0] === 'sy-f' && lang === 'rust' && src[i] === '!' && /\w$/.test(hit[1])) { push('sy-f', '!'); i++; }
    // #include <stdio.h>: the header is a string, as in the editor
    if (hit[0] === 'sy-k' && /^#\s*include$/.test(hit[1])) {
      const m = /^([ \t]*)(<[^>\n]*>)/.exec(src.slice(i));
      if (m) { push(null, m[1]); push('sy-s', m[2]); i += m[0].length; }
    }
  }
  return out;
}

// Put the pieces into an element, in place of its text
function paint(el, src, lang) {
  el.replaceChildren(...tokens(src, lang).map(([cls, text]) => {
    if (!cls) return document.createTextNode(text);
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }));
}

// Color every tagged <code> in scope (prompts, choices, examples, results), keeping the student's highlights.
function colorize(scope) {
  if (!scope) return;
  for (const code of scope.querySelectorAll('code[data-lang]:not([data-colored])')) {
    code.setAttribute('data-colored', '');
    const hl = marksIn(code);
    if (code.dataset.src == null) code.dataset.src = code.textContent;
    paint(code, code.dataset.src, code.dataset.lang);
    for (const [a, b, st] of hl) addHighlight(rangeAt(code, a, b), true, st);
  }
}

export { colorize, tokens };
