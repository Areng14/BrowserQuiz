'use strict';
// Code that looks copied: pairs of students whose answers to a code question are much alike, even after
// renaming variables and reformatting. Like MOSS, it compares short runs of tokens with names, numbers
// and strings made generic. What everyone has doesn't count: the starter code, the reference solution,
// and what much of the class wrote. Answers with too little of their own are skipped, since two short
// right answers look alike without anyone copying. It only points the teacher at pairs to read.

const K = 5; // tokens in a run
const MIN_OWN = 12; // runs of its own an answer needs before it's compared
const MIN_SHARED = 10; // runs two answers must share
const FLAG = 0.6; // of the smaller answer's own runs
const MAX_PAIRS = 30; // per question

const JAVA_KW = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record yield true false null').split(' '));
const PY_KW = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield').split(' '));
const JS_KW = new Set(('break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async await get set '
  + 'interface type enum implements private public protected readonly abstract as declare namespace number string boolean any unknown never').split(' '));
const C_KW = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL '
  + 'class public private protected new delete this nullptr template typename namespace using virtual override operator friend explicit mutable constexpr try catch throw static_cast const_cast dynamic_cast reinterpret_cast include define').split(' '));
const GO_KW = new Set('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota make len append'.split(' '));
const RS_KW = new Set('as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while dyn Some None Ok Err Vec String Box Option'.split(' '));
const CS_KW = new Set('abstract as base bool break case catch char class const continue default do double else enum false finally for foreach if in int interface is long new null object out override private protected public readonly ref return static string struct switch this throw true try using var virtual void while List Dictionary'.split(' '));
const JAVA_RE = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_$][\w$]*)|(\d[\w.]*)|(>>>=?|<<=|>>=|==|!=|<=|>=|&&|\|\||\+\+|--|->|::|[-+*/%&|^]=|<<|>>|\S)/g;
const JS_RE = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_$][\w$]*)|(\d[\w.]*)|(>>>=?|<<=|>>=|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|=>|[-+*/%&|^]=|<<|>>|\S)/g;
const PY_RE = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[^\n]*)|([A-Za-z_]\w*)|(\d[\w.]*)|(\*\*=?|\/\/=?|==|!=|<=|>=|->|<<|>>|[-+*/%&|^@]=|\S)/g;

// [generic, exact] tokens, and the comments (which copying often keeps word for word)
function tokenize(code, lang) {
  const js = lang === 'javascript' || lang === 'typescript';
  const re = new RegExp(lang === 'python' ? PY_RE : js || lang === 'go' ? JS_RE : JAVA_RE);
  const kw = { python: PY_KW, javascript: JS_KW, typescript: JS_KW, c: C_KW, cpp: C_KW, go: GO_KW, rust: RS_KW, csharp: CS_KW }[lang] || JAVA_KW;
  const toks = [];
  const comments = [];
  let m;
  while ((m = re.exec(code))) {
    if (m[2]) { const c = m[2].replace(/^(\/\/|\/\*|#)|\*\/$/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); if (c.length >= 8) comments.push(c); continue; }
    if (m[1]) toks.push(['S', m[1]]);
    else if (m[3]) toks.push([kw.has(m[3]) ? m[3] : 'I', m[3]]);
    else if (m[4]) toks.push(['N', m[4]]);
    else toks.push([m[5], m[5]]);
  }
  return { toks, comments };
}
function grams(toks, which) {
  const out = new Set();
  for (let i = 0; i + K <= toks.length; i++) out.add(toks.slice(i, i + K).map((t) => t[which]).join('\u0001'));
  return out;
}
const minus = (a, ...bs) => new Set([...a].filter((x) => !bs.some((b) => b.has(x))));
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

// answers: [{ who, code, language }] for one question. Returns pairs, most alike first.
function comparePairs(qq, answers) {
  const pairs = [];
  for (const lang of new Set(answers.map((x) => x.language))) {
    const subs = answers.filter((x) => x.language === lang && typeof x.code === 'string' && x.code.trim());
    if (subs.length < 2) continue;
    const base = [qq.starter && qq.starter[lang], qq.reference && qq.reference[lang]].filter(Boolean).map((c) => tokenize(c, lang));
    const baseG = base.map((b) => grams(b.toks, 0));
    const baseX = base.map((b) => grams(b.toks, 1));
    const baseC = new Set(base.flatMap((b) => b.comments));
    const parts = subs.map((s) => {
      const t = tokenize(s.code, lang);
      return { who: s.who, g: grams(t.toks, 0), x: grams(t.toks, 1), c: new Set(t.comments.filter((c) => !baseC.has(c))) };
    });
    // what much of the class wrote: in at least 3 answers, and at least 40% of them
    const common = (key) => {
      const df = new Map();
      for (const p of parts) for (const g of p[key]) df.set(g, (df.get(g) || 0) + 1);
      const at = Math.max(3, Math.ceil(parts.length * 0.4));
      return new Set([...df].filter(([, n]) => n >= at).map(([g]) => g));
    };
    const commonG = common('g');
    const commonX = common('x');
    for (const p of parts) { p.own = minus(p.g, commonG, ...baseG); p.ownX = minus(p.x, commonX, ...baseX); }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        if (a.own.size < MIN_OWN || b.own.size < MIN_OWN) continue;
        const shared = overlap(a.own, b.own);
        const score = shared / Math.min(a.own.size, b.own.size);
        if (shared < MIN_SHARED || score < FLAG) continue;
        const sx = Math.min(a.ownX.size, b.ownX.size);
        pairs.push({
          a: a.who, b: b.who, language: lang, score: Math.round(score * 100) / 100,
          names: sx ? Math.round((overlap(a.ownX, b.ownX) / sx) * 100) / 100 : 0, // the same with names as written
          comments: overlap(a.c, b.c),
        });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score || y.names - x.names).slice(0, MAX_PAIRS);
}

// For a class report: every code question, its flagged pairs. attempts: [{ who, attempt }], with who
// what the caller uses to point at a student.
function similarCode(quiz, attempts) {
  const out = [];
  quiz.questions.forEach((qq, i) => {
    if (qq.type !== 'code') return;
    const answers = [];
    for (const { who, attempt } of attempts) {
      const ans = attempt.answers && attempt.answers[qq.id];
      if (ans && typeof ans.code === 'string') answers.push({ who, code: ans.code, language: ans.language });
    }
    if (answers.length < 2) return;
    out.push({ id: qq.id, n: i + 1, answers: answers.length, pairs: comparePairs(qq, answers) });
  });
  return out;
}

module.exports = { similarCode, comparePairs, tokenize };
