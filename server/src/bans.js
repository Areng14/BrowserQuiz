'use strict';
// Methods and names a code question doesn't allow: "ban": ["Arrays.sort", "stream", "sorted"], or
// { "java": [...], "python": [...], "cpp": [...] }. Code that uses one scores 0 on the question.
//
// Each entry is one of:
//   Class.method   that method of that class: "Arrays.sort", "Math.max", "math.sqrt", "std::sort", "sort.Ints"
//   method         a method or function of that name, on anything: "sort", "stream", "sorted", "max"
//   Name           a library class, interface or package: "HashMap", "Stream", "List", "map", "strings"
//
// The check doesn't read the source text. It reads what the compiler made of the code, before any of it
// runs: for Java, every method, field and class the compiled classes refer to (harness/BQJ.java scan); for
// Python, the names that reach the builtins, the attributes read and the imports, from Python's own parser
// and symbol table (harness/bqscan.py); for C, the library functions the student's compiled file calls; for
// C++, what each of the student's compiled functions calls or refers to in the library; for Go, what Go's
// own type checker says the student's file uses from other packages; for C#, the library members and types
// the compiled code refers to; for Rust, the calls in the compile's MIR (runner.py run_scan, rust_facts,
// runner/bqscan.go, runner/bqscan.cs). So comments,
// strings, spacing, macros, imports, aliases, using-declarations, generics, lambdas and method references
// are all already dealt with, and the student's own methods and variables (their own max, self.count) are
// theirs. In C and C++ that holds for code that calls library functions in the usual ways; code that works
// out a function's address from another's isn't caught. JavaScript and TypeScript can't be read that way
// (a["so" + "rt"]() is a sort), so there the banned builtins are tripwires, set before the student's code
// loads (harness/bqh.cjs guard): a call counts however it was written, if it happens while the tests run.
//
// A few entries cover their close relatives: "sort" also catches parallelSort (Java), sorted, heapq and
// bisect (Python), toSorted (JavaScript), qsort (C), every std:: sort (C++), package sort and slices.Sort*
// (Go), and OrderBy and friends (C#); Math.* also StrictMath.* (Java) and MathF.* and the number types' own (C#), math.* also
// cmath.*, a Java class its subclasses in java.util ("HashMap" catches LinkedHashMap), and a C math
// function its float and long double versions. Go and C# names match whatever their case.
// A question with any ban also bans the usual ways around one: reflection and friends in Java and C#
// (and dynamic, expression trees, DllImport), eval, exec, getattr, __import__, importlib, pickle and friends
// in Python, dlsym and friends in C and C++ (and in C++ inline asm, reopening namespace std, #line and
// unusual #includes), vm, workers, child_process, the inspector and process.binding in JavaScript,
// reflect, unsafe, templates and go:linkname in Go, unsafe, include!, #[path] and file modules in Rust.

const T = require('../../public/teacher/types.js');

const ENTRY = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;
// A ban list that applies to every language (not one per language) can have Class.method entries only for
// these: elsewhere a class name means something else (C has no classes, so there it's just the method).
const LIST_QUALIFIED = ['java', 'python', 'c'];

// The ban list from a question, checked and tidied. Throws a message for the quiz file's error.
function normalizeBans(raw, languages) {
  if (raw == null) return null;
  const clean = (list, label) => {
    if (!Array.isArray(list)) throw new Error(`${label} should be a list of names, like ["Arrays.sort", "stream"].`);
    const out = [];
    for (const v of list.slice(0, 30)) {
      const name = String(v == null ? '' : v).trim().replace(/::/g, '.');
      if (!name) continue;
      if (!ENTRY.test(name)) throw new Error(`${label}: "${name.slice(0, 60)}" isn't a name. Use a method ("sort"), Class.method ("Arrays.sort") or a class ("HashMap").`);
      if (!out.includes(name)) out.push(name);
    }
    return out;
  };
  if (Array.isArray(raw)) { const list = clean(raw, '"ban"'); return list.length ? list : null; }
  if (typeof raw === 'object') {
    const out = {};
    for (const lang of languages) if (raw[lang] != null) { const list = clean(raw[lang], `"ban".${lang}`); if (list.length) out[lang] = list; }
    return Object.keys(out).length ? out : null;
  }
  throw new Error('"ban" should be a list of names, like ["Arrays.sort", "stream"].');
}

// The entries that apply to one language.
function bansFor(ban, lang) {
  if (!ban) return [];
  return Array.isArray(ban) ? ban : ban[lang] || [];
}

// ---------- Java ----------
const simple = (owner) => owner.slice(owner.lastIndexOf('/') + 1).replace(/^.*\$/, '');
const METHOD_KIN = { sort: ['sort', 'parallelSort'] };
const CLASS_KIN = { Math: ['Math', 'StrictMath'] };
const BOOTSTRAPS = /^java\/lang\/invoke\/(LambdaMetafactory|StringConcatFactory|ObjectMethods|SwitchBootstraps)$/;
const CLASS_LOOKUPS = /^(forName|getMethods?|getDeclaredMethods?|getConstructors?|getDeclaredConstructors?|getFields?|getDeclaredFields?|newInstance|getRecordComponents|getEnclosingMethod)$/;
function javaEscape(owner, name) {
  if (BOOTSTRAPS.test(owner)) return false;
  return /^(java\/lang\/(reflect|invoke|instrument)\/|java\/beans\/|javax\/script\/|javax\/tools\/|jdk\/jshell\/|jdk\/internal\/|sun\/)/.test(owner)
    || /^java\/lang\/(ClassLoader|Module|ModuleLayer|ProcessBuilder|Process)$/.test(owner) || owner === 'java/net/URLClassLoader'
    || (owner === 'java/lang/Class' && CLASS_LOOKUPS.test(name))
    || (owner === 'java/lang/Runtime' && name === 'exec')
    || (owner === 'java/lang/System' && /^load(Library)?$/.test(name));
}

function javaHits(entries, facts) {
  const own = new Map((facts.classes || []).map((c) => [c.n, c]));
  // The library classes a reference really lands on: a call to their own method is theirs; one they
  // inherit (sort() in a class extending ArrayList) goes up to the library class it comes from.
  const landsOn = (owner, name, seen = new Set()) => {
    const c = own.get(owner);
    if (!c) return [owner];
    if (seen.has(owner) || (c.m || []).includes(name) || (c.f || []).includes(name)) return [];
    seen.add(owner);
    return [c.s, ...(c.i || [])].filter(Boolean).flatMap((o) => landsOn(o, name, seen));
  };
  const refs = [];
  for (const r of facts.refs || []) {
    const k = r.lastIndexOf('.');
    const name = r.slice(k + 1);
    for (const owner of landsOn(r.slice(0, k), name)) refs.push({ owner, name });
  }
  const types = (facts.types || []).filter((t) => !own.has(t));
  const hits = [];
  for (const entry of entries) {
    const [a, b] = entry.split('.');
    let hit;
    if (b) {
      const classes = CLASS_KIN[a] || [a];
      const methods = METHOD_KIN[b] || [b];
      hit = refs.some((r) => classes.includes(simple(r.owner)) && methods.includes(r.name));
    } else if (/^[A-Z]/.test(a)) {
      hit = types.concat(refs.map((r) => r.owner)).some((t) => simple(t) === a || (/^java\/util\//.test(t) && simple(t).endsWith(a)));
    } else {
      const methods = METHOD_KIN[a] || [a];
      hit = refs.some((r) => methods.includes(r.name)) || (a === 'stream' && types.concat(refs.map((r) => r.owner)).some((t) => t.startsWith('java/util/stream/')));
    }
    if (hit) hits.push(entry);
  }
  if (refs.some((r) => javaEscape(r.owner, r.name))) hits.push('reflection');
  return hits;
}

// ---------- Python ----------
const PY_KIN = { sort: ['sort', 'sorted'], sorted: ['sort', 'sorted'] };
const PY_KIN_MODULES = { sort: ['heapq', 'bisect'], sorted: ['heapq', 'bisect'] };
const MODULE_KIN = { math: ['math', 'cmath'] };
const PY_ESCAPE_NAMES = ['eval', 'exec', 'compile', 'getattr', 'delattr', '__import__', 'globals', 'locals', 'vars', 'breakpoint', '__builtins__'];
const PY_ESCAPE_MODULES = ['builtins', 'importlib', 'pickle', '_pickle', 'marshal', 'shelve', 'copyreg', 'ctypes', 'types', 'inspect', 'gc', '__main__', 'solution'];
const PY_ESCAPE_ATTRS = ['__dict__', '__getattribute__', '__getattr__', '__globals__', '__builtins__', '__self__', '__subclasses__', '__code__', '__closure__',
  '__class__', '__bases__', '__base__', '__mro__', '__func__', '__reduce__', '__reduce_ex__', '_getframe', 'f_locals', 'f_globals', 'f_back', 'f_builtins',
  'tb_frame', 'gi_frame', 'cr_frame', 'modules'];
const PY_ESCAPE_HELPERS = ['methodcaller', 'attrgetter']; // operator's, which call a method by its name
const topModule = (i) => i.split('.')[0];

function pythonHits(entries, facts, D) {
  const names = new Set(facts.names || []);
  // The question's own classes' fields (node.next) are the student's to use.
  const given = new Set(Object.values(D || {}).flat().map((f) => f.name));
  const attrs = new Set((facts.attrs || []).filter((a) => !given.has(a)));
  const imports = facts.imports || [];
  const imported = (m) => imports.some((i) => i === m || i.startsWith(m + '.'));
  const hits = [];
  for (const entry of entries) {
    const [a, b] = entry.split('.');
    let hit;
    if (b) {
      hit = (MODULE_KIN[a] || [a]).some((m) => imports.includes(`${m}.${b}`) || (imported(m) && attrs.has(b)) || (imports.includes(`${m}.*`) && names.has(b)));
    } else {
      const kin = PY_KIN[a] || [a];
      hit = kin.some((n) => names.has(n) || attrs.has(n) || imports.some((i) => i === n || i.startsWith(n + '.') || i.endsWith('.' + n)))
        || (PY_KIN_MODULES[a] || []).some(imported);
    }
    if (hit) hits.push(entry);
  }
  for (const n of PY_ESCAPE_NAMES) if (names.has(n)) hits.push(n);
  for (const m of PY_ESCAPE_MODULES) if (imports.some((i) => topModule(i) === m)) hits.push(m);
  for (const t of PY_ESCAPE_ATTRS) if (attrs.has(t)) hits.push(t);
  for (const t of PY_ESCAPE_HELPERS) if (attrs.has(t) || imports.some((i) => i.endsWith('.' + t))) hits.push(t);
  return [...new Set(hits)];
}

// ---------- the compiled languages: facts from the runner (runner.py run_scan) ----------
// The runner's text, one fact per line; null means it couldn't read the code. (Rust's is its MIR: rustFacts.)
function runnerFacts(text, ctx) {
  if (text === null) return { fail: true };
  if (ctx && ctx.lang === 'rust') return rustFacts(String(text || ''), ctx);
  const lines = String(text || '').split('\n').filter(Boolean);
  return lines.some((l) => l.startsWith('fail')) ? { fail: true } : { lines };
}

// ---------- Rust: the compile's MIR ----------
// MIR is the compiler's own form of each function, with every call written out as what it resolved to:
//   _4 = slice::<impl [i32]>::sort(move _5) -> ...      _9 = <std::slice::Iter<'_, i32> as Iterator>::max(...)
// So aliases, use-declarations, generics, closures, macros and trait methods are already dealt with. The
// student's functions are the bodies from their file: an impl's methods say where the impl is
// (<impl at solution.rs:3:1: 5:2>); a free function has its name only, so the harness's carry the run's marker
// (harness.js rsMain) and bq.rs's are known. In those bodies, a path that isn't one of their own names (nor
// the given classes') is the library's: its last name is what's called, the rest what it belongs to.
let RS_HARNESS = null;
function rsHarnessNames() {
  if (!RS_HARNESS) {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'harness', 'bq.rs'), 'utf8');
    RS_HARNESS = new Set(['main', ...[...src.matchAll(/^(?:pub\s+)?(?:fn|const|static)\s+(\w+)/gm)].map((m) => m[1])]);
  }
  return RS_HARNESS;
}
const MIR_WORDS = new Set(['drop', 'discriminant', 'assert', 'switchInt', 'move', 'copy', 'deinit', 'retag', 'assume', 'copy_nonoverlapping', 'const',
  'return', 'resume', 'unreachable', 'goto', 'bb', 'debug', 'let', 'mut', 'scope', 'in', 'as', 'for', 'fn', 'dyn', 'impl', 'unwind', 'continue', 'terminate',
  'cleanup', 'otherwise', 'true', 'false']);

// A path's segments, split at :: outside brackets: "slice::<impl [i32]>::sort" -> ["slice", "<impl [i32]>", "sort"].
function rsSegments(p) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '<' || c === '{' || c === '[' || c === '(') depth++;
    else if (c === '>' || c === '}' || c === ']' || c === ')') depth--;
    if (depth === 0 && c === ':' && p[i + 1] === ':') { out.push(cur); cur = ''; i++; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
// The paths in a piece of MIR: maximal runs of identifiers and <...>/{...} groups joined by ::, each with
// whether it's called or used as a value; the insides of <...> are paths too (Vec<BinaryHeap<i32>>).
function rsPaths(text, out) {
  let i = 0;
  const n = text.length;
  const ident = /[A-Za-z_][A-Za-z0-9_]*/y;
  const group = (k) => { // the end of a bracketed group starting at k
    const open = text[k];
    const close = { '<': '>', '{': '}', '[': ']', '(': ')' }[open];
    let d = 0;
    for (let j = k; j < n; j++) {
      if (text[j] === open) d++;
      else if (text[j] === close && --d === 0) return j + 1;
      else if (open === '<' && text[j] === '-' && text[j + 1] === '>') j++; // "->" isn't a bracket
    }
    return n;
  };
  while (i < n) {
    const c = text[i];
    const prev = i ? text[i - 1] : ' ';
    let start = -1;
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_@]/.test(prev)) start = i;
    else if (c === '<' && /[\s(&*,=]/.test(prev) && /^<(?:impl |[A-Za-z_&*\[(]|dyn )/.test(text.slice(i, i + 6)) && text.slice(group(i), group(i) + 2) === '::') start = i;
    if (start < 0) { i++; continue; }
    let j = start;
    const inner = [];
    for (;;) {
      if (text[j] === '<' || text[j] === '{') { const e = group(j); inner.push(text.slice(j + 1, e - 1)); j = e; }
      else { ident.lastIndex = j; const m = ident.exec(text); if (!m) break; j += m[0].length; if (text[j] === '<') { const e = group(j); inner.push(text.slice(j + 1, e - 1)); j = e; } }
      if (text[j] === '[' && /^\[\d+\]/.test(text.slice(j, j + 8))) j = group(j); // promoted[0]
      if (text[j] === ':' && text[j + 1] === ':') { j += 2; continue; }
      break;
    }
    const p = text.slice(start, j);
    if (/::/.test(p) || text[j] === '(') out.push({ p, call: text[j] === '(' });
    for (const x of inner) rsPaths(x, out);
    i = Math.max(j, start + 1);
  }
  return out;
}
// A type's path, without its generic arguments: "std::slice::Iter<'_, i32>" -> ["std", "slice", "Iter"]; "[i32]" -> ["i32"].
const rsType = (t) => {
  const m = /^(?:[A-Za-z_]\w*\s*::\s*)*[A-Za-z_]\w*/.exec(t.replace(/^(impl|dyn)\s+/, '').replace(/^(?:[&*\[(\s]|mut\s|const\s)+/, ''));
  return m ? m[0].split('::').map((x) => x.trim()) : [];
};

function rustFacts(text, ctx) {
  const k = text.indexOf('\n@@mir\n');
  if (k < 0) return { fail: true };
  const head = text.slice(0, k).split('\n').filter(Boolean);
  const mir = text.slice(k + 7);
  const mark = 'bq_' + ctx.marker;
  const harness = rsHarnessNames();
  // their own names, and the given classes' and the harness's modules
  const local = new Set(['Solution', 'sol', 'bq', 'crate', 'self', 'super', 'Self', ...Object.keys(ctx.D || {}), ...head.filter((l) => l.startsWith('local ')).map((l) => l.slice(6))]);
  // the bodies: "fn PATH(" / "const PATH: " / "static PATH: " at the start of a line, up to the next
  const bodies = [];
  let cur = null;
  let data = false; // a constant's bytes ("ALLOC0 (size: 19, align: 1) { 0x00 │ 62 2e ... │ b.sort() }"): not code
  for (const line of mir.split('\n')) {
    if (/^alloc\d+ \(size/i.test(line)) { data = true; continue; }
    if (data) { if (/^\}/.test(line)) data = false; continue; }
    const m = /^(?:fn|const|static(?: mut)?) (.*)$/.exec(line);
    if (m) {
      let depth = 0;
      let end = m[1].length;
      for (let i = 0; i < m[1].length; i++) {
        const c = m[1][i];
        if (c === '<' || c === '{' || c === '[') depth++;
        else if (c === '>' || c === '}' || c === ']') depth--;
        else if (depth === 0 && (c === '(' || (c === ':' && m[1][i + 1] !== ':' && m[1][i - 1] !== ':'))) { end = i; break; }
      }
      cur = { path: m[1].slice(0, end).trim(), text: [] };
      bodies.push(cur);
    } else if (cur) cur.text.push(line);
  }
  const theirs = (path) => {
    const impl = /<impl at ([^:>]+):/.exec(path);
    if (impl) return impl[1] === 'solution.rs';
    const segs = rsSegments(path).filter((x) => !/^(\{closure#\d+\}|\{constant#\d+\}|\{synthetic#\d+\}|promoted\[\d+\])$/.test(x));
    if (!segs.length || segs[0] === 'bq' || path.includes(mark)) return false;
    return !(segs.length === 1 && harness.has(segs[0]));
  };
  const uses = [];
  for (const b of bodies) {
    if (!theirs(b.path)) continue;
    for (const seg of rsSegments(b.path)) if (/^[A-Za-z_]\w*$/.test(seg)) local.add(seg); // their own function names
  }
  for (const b of bodies) {
    if (!theirs(b.path)) continue;
    // string and char constants aren't code
    const body = b.text.join('\n').replace(/b?"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.[^']*)'/g, "' '");
    for (const { p, call } of rsPaths(body, [])) {
      const segs = rsSegments(p);
      const idents = [];
      let lib = null;
      for (const sg of segs) {
        let mm;
        if ((mm = /^<impl (.*)>$/.exec(sg))) {
          const h = rsType(mm[1]);
          idents.push(...h);
          if (lib === null) lib = !local.has(h[h.length - 1]);
        } else if ((mm = /^<(.*) as (.*)>$/.exec(sg))) {
          const h = rsType(mm[1]);
          const t = rsType(mm[2]);
          idents.push(...h, ...t);
          if (lib === null) lib = !local.has(t[t.length - 1]);
        } else if (/^[A-Za-z_]\w*/.test(sg)) idents.push(/^[A-Za-z_]\w*/.exec(sg)[0]);
      }
      if (!idents.length) continue;
      if (idents.some((x) => x === 'std' || x === 'core' || x === 'alloc')) lib = true;
      if (lib === null) lib = !local.has(idents[0]);
      if (segs.length === 1 && (!call || MIR_WORDS.has(idents[0]) || /^[A-Z]/.test(idents[0]) || /^_\d/.test(idents[0]))) continue; // MIR's own words
      if (lib) uses.push({ name: idents[idents.length - 1], quals: idents.slice(0, -1) });
    }
  }
  return { rust: true, uses, escapes: head.filter((l) => l.startsWith('escape ')).map((l) => l.slice(7)) };
}

const RS_KIN = { max: ['max', 'max_by', 'max_by_key'], min: ['min', 'min_by', 'min_by_key'], abs: ['abs', 'unsigned_abs', 'abs_diff'] };
const RS_ALIAS = { Vec: ['Vec', 'slice'], String: ['String', 'str'], array: ['array'] };
function rustHits(entries, facts) {
  const nameIs = (a) => (a === 'sort' ? isSort : (n) => (RS_KIN[a] || [a]).includes(n));
  const hits = entries.filter((entry) => {
    const [a, b] = entry.split('.');
    if (b) {
      const cls = RS_ALIAS[a] || [a];
      return facts.uses.some((u) => u.quals.some((q) => cls.includes(q)) && nameIs(b)(u.name));
    }
    return facts.uses.some((u) => nameIs(a)(u.name) || u.quals.includes(a));
  });
  hits.push(...facts.escapes);
  return hits;
}
const lower = (x) => String(x).toLowerCase();
const fl = (names) => names.flatMap((n) => [n, n + 'f', n + 'l']); // C's sqrt, sqrtf, sqrtl
const isSort = (n) => /sort/i.test(n) && !/^_*is_sorted/i.test(n);
const DL = ['dlopen', 'dlsym', 'dlvsym', 'dlmopen', 'dladdr', 'dlinfo', 'dl_iterate_phdr'];

// C: the library functions the student's own compiled file refers to (nm -u).
const C_KIN = { sort: ['qsort', 'qsort_r'], qsort: ['qsort', 'qsort_r'], abs: ['abs', 'labs', 'llabs', 'fabs', 'imaxabs'], max: ['fmax'], min: ['fmin'] };
function cHits(entries, facts) {
  // glibc's other names for the same function: __isoc99_scanf, __printf_chk
  const refs = new Set(facts.lines.filter((l) => l.startsWith('ref ')).map((l) => l.slice(4).replace(/@.*$/, '').replace(/^__isoc\d+_/, '').replace(/^__(\w+)_chk$/, '$1')));
  const hits = entries.filter((entry) => {
    const name = entry.split('.').pop();
    return fl(C_KIN[name] || [name]).some((n) => refs.has(n));
  });
  hits.push(...DL.filter((n) => refs.has(n)));
  return hits;
}

// C++: what the student's compiled functions call or refer to in the library (std::, or not in the object).
const CPP_LIB = ['std', '__gnu_cxx', '__cxxabiv1'];
const CPP_KIN = { max: ['max', 'max_element', 'fmax', 'minmax', 'minmax_element'], min: ['min', 'min_element', 'fmin', 'minmax', 'minmax_element'],
  abs: ['abs', 'labs', 'llabs', 'fabs'] };
const CPP_ALIAS = { string: ['basic_string'], stringstream: ['basic_stringstream'], istringstream: ['basic_istringstream'], ostringstream: ['basic_ostringstream'],
  string_view: ['basic_string_view'] };
function cppHits(entries, facts, D) {
  const given = new Set(Object.keys(D || {}));
  const uses = [];
  for (const l of facts.lines) {
    if (!l.startsWith('call ')) continue;
    const [owner, target, kind] = l.slice(5).split('\t');
    const o = owner.split('::');
    if ((o[0] === 'bq' && o.length > 1) || owner === 'main' || given.has(o[0])) continue; // the tests' code, the given classes'
    const t = target.split('::');
    if (kind === 'U' || CPP_LIB.includes(t[0])) uses.push(t);
  }
  const nameIs = (a) => {
    if (lower(a) === 'sort') return (n) => isSort(n);
    const kin = fl(CPP_KIN[a] || [a]);
    return (n, path) => kin.includes(n) && !(['max', 'min'].includes(a) && path.includes('numeric_limits'));
  };
  const classIs = (a) => [a, ...(CPP_ALIAS[a] || [])];
  const hits = entries.filter((entry) => {
    const [a, b] = entry.split('.');
    if (b) {
      const cls = classIs(a);
      const name = nameIs(b);
      return uses.some((p) => p.slice(0, -1).some((c) => cls.includes(c)) && name(p[p.length - 1], p));
    }
    const name = nameIs(a);
    const cls = classIs(a);
    return uses.some((p) => name(p[p.length - 1], p) || p.slice(0, -1).some((c) => cls.includes(c)));
  });
  hits.push(...DL.filter((n) => uses.some((p) => p.length === 1 && p[0] === n)));
  for (const l of facts.lines) {
    if (l === 'asm') hits.push('asm');
    else if (l === 'linemarker') hits.push('#line');
    else if (l.startsWith('namespace ')) hits.push('own code in ' + l);
    else if (l.startsWith('include ')) hits.push('#include ' + l.slice(8));
  }
  return hits;
}

// Go: what the student's file uses from other packages, by Go's type checker.
const GO_ESCAPES = ['reflect', 'unsafe', 'text/template', 'html/template', 'plugin'];
const GO_HARNESS = ['bqh.go', 'bqmain.go'];
function goHits(entries, facts) {
  const uses = [];
  const imports = [];
  const builtins = [];
  for (const l of facts.lines) {
    if (l.startsWith('use ')) {
      const ref = l.slice(4);
      const k = ref.indexOf('.', ref.lastIndexOf('/') + 1);
      const path = ref.slice(0, k);
      uses.push({ path, pkg: lower(path.split('/').pop()), parts: ref.slice(k + 1).split('.').map(lower) });
    } else if (l.startsWith('import ')) imports.push(l.slice(7));
    else if (l.startsWith('builtin ')) builtins.push(lower(l.slice(8)));
  }
  const nameIs = (a) => (lower(a) === 'sort' ? (n) => /^sort/.test(n) : (n) => n === lower(a));
  const hits = entries.filter((entry) => {
    const [a, b] = entry.split('.');
    if (b) return uses.some((u) => (u.pkg === lower(a) || (u.parts.length === 2 && u.parts[0] === lower(a))) && nameIs(b)(u.parts[u.parts.length - 1]));
    const name = nameIs(a);
    return uses.some((u) => u.pkg === lower(a) || u.parts.some(name)) || builtins.some(name);
  });
  hits.push(...GO_ESCAPES.filter((p) => imports.includes(p)));
  if (facts.lines.includes('linkname')) hits.push('go:linkname');
  if (facts.lines.some((l) => GO_HARNESS.includes(l.split(' ')[1]) && l.startsWith('local '))) hits.push('the test code');
  return hits;
}

// C#: the library members and types the compiled code refers to.
const CS_KIN = { sort: ['sort', 'orderby', 'orderbydescending', 'order', 'orderdescending', 'thenby', 'thenbydescending'],
  max: ['max', 'maxby', 'maxmagnitude', 'maxnumber'], min: ['min', 'minby', 'minmagnitude', 'minnumber'] };
const CS_CLASS_KIN = { math: ['math', 'mathf', 'int16', 'int32', 'int64', 'int128', 'uint16', 'uint32', 'uint64', 'uint128', 'byte', 'sbyte',
  'double', 'single', 'decimal', 'half', 'biginteger'], array: ['array', 'memoryextensions'] };
const CS_ESCAPE_NS = /^(System\.Reflection|System\.Linq\.Expressions|Microsoft\.CSharp|System\.Dynamic|System\.Runtime\.Loader)(\.|$)/;
const CS_ESCAPE_TYPES = ['System.Runtime.InteropServices.NativeLibrary', 'System.Runtime.CompilerServices.UnsafeAccessorAttribute',
  'System.Runtime.CompilerServices.UnsafeAccessorTypeAttribute'];
const CS_ESCAPE_MEMBERS = /^(System\.Type::(GetType|GetMethods?|GetMembers?|InvokeMember|GetPropert(y|ies)|GetFields?|GetConstructors?|GetInterfaces?|GetNestedTypes?|MakeGenericType|GetEvents?|FindMembers|GetDefaultMembers)|System\.Delegate::CreateDelegate|System\.Runtime\.InteropServices\.Marshal::GetDelegateForFunctionPointer)$/;
const CS_COMPILER = ['System.Reflection.DefaultMemberAttribute']; // what the compiler itself puts there (an indexer's)
function csHits(entries, facts) {
  const split = (full) => {
    const name = full.split(/[.+]/).pop().replace(/`\d+$/, '');
    return { full, simple: lower(name), ns: full.split('.').slice(0, -1).map(lower) };
  };
  const members = [];
  const types = [];
  for (const l of facts.lines) {
    if (l.startsWith('M ')) {
      const k = l.lastIndexOf('::');
      // a property is its accessors: DataView.Sort is set_Sort
      members.push({ ...split(l.slice(2, k)), name: lower(l.slice(k + 2)).replace(/^(get|set|add|remove)_/, ''), text: l.slice(2) });
    } else if (l.startsWith('T ')) types.push(split(l.slice(2)));
  }
  const all = [...types, ...members];
  const hits = entries.filter((entry) => {
    const [a, b] = entry.split('.').map(lower);
    if (b) {
      const cls = CS_CLASS_KIN[a] || [a];
      const kin = CS_KIN[b] || [b];
      return members.some((m) => cls.includes(m.simple) && kin.includes(m.name));
    }
    const kin = CS_KIN[a] || [a];
    return members.some((m) => kin.includes(m.name)) || all.some((t) => t.simple === a || t.ns.includes(a));
  });
  const escape = all.find((t) => !CS_COMPILER.includes(t.full) && (CS_ESCAPE_NS.test(t.full) || CS_ESCAPE_TYPES.includes(t.full)))
    || members.find((m) => CS_ESCAPE_MEMBERS.test(m.text));
  if (escape) hits.push('reflection');
  if (facts.lines.includes('pinvoke')) hits.push('DllImport');
  return hits;
}

// JavaScript and TypeScript: the tripwires that went off while the code ran (harness/bqh.cjs guard). Each is an
// entry, or the module or function that would have given the code a fresh set of builtins.
function jsHits(entries, facts) {
  const hits = facts.hits || [];
  return [...entries.filter((e) => hits.includes(e)), ...hits.filter((h) => !entries.includes(h))];
}

// Whether a JavaScript ban entry names something there is: a builtin method ("sort"), class or namespace
// ("Map", "Math"), or one's method ("Math.max", "Array.sort"). From this Node's own builtins (the runner's
// is the same version).
let JS_NAMES = null;
function jsKnows(entry) {
  if (!JS_NAMES) {
    const c = require('./harness/bqh.cjs').catalog();
    JS_NAMES = { methods: new Set(c.methods), classes: new Set(c.classes) };
  }
  const [a, b] = entry.split('.');
  if (!b) return /^[A-Z]/.test(a) ? JS_NAMES.classes.has(a) : JS_NAMES.methods.has(a);
  const X = JS_NAMES.classes.has(a) ? globalThis[a] : null;
  if (!X) return false;
  const has = (o, k) => o != null && Object.getOwnPropertyDescriptor(o, k) !== undefined;
  return [b, ...(b === 'sort' ? ['toSorted'] : [])].some((k) => has(X, k) || has(X.prototype, k));
}

// The banned names this code uses (or the way around a ban it uses), in the question's order. `facts` is
// the scan; without one (the code never got that far) there's nothing to hold against it.
// D is the question's declared classes, whose fields and methods count as the student's own.
function bannedUse(ban, lang, facts, D) {
  const entries = bansFor(ban, lang);
  if (!entries.length || !facts || facts.syntax) return [];
  if (facts.fail) return ['code the check could not read'];
  const hits = lang === 'python' ? pythonHits(entries, facts, D) : lang === 'c' ? cHits(entries, facts) : lang === 'cpp' ? cppHits(entries, facts, D)
    : lang === 'go' ? goHits(entries, facts) : lang === 'csharp' ? csHits(entries, facts) : T.isJs(lang) ? jsHits(entries, facts)
      : lang === 'rust' ? rustHits(entries, facts) : javaHits(entries, facts);
  return [...new Set(hits.map((h) => (entries.includes(h) ? shown(h, lang) : h)))];
}

// An entry as students of a language see it: std::sort in C++.
const shown = (entry, lang) => (lang === 'cpp' ? entry.replace('.', '::') : entry);

// Speed tests time the code from inside its own process, so in Python they only count when the code keeps
// out of the harness: no frames, closures or code objects, no swapping module attributes (time.perf_counter,
// sys.stdout), no harness modules. Returns what it used, or [].
const PY_INTRUDE_ATTRS = ['_getframe', 'f_back', 'f_locals', 'f_globals', 'f_code', 'f_builtins', 'tb_frame', 'tb_next', 'gi_frame', 'cr_frame', 'ag_frame',
  '__traceback__', 'co_consts', '__code__', '__closure__', 'cell_contents', '__globals__', '__dict__', '__builtins__', '__subclasses__', 'settrace', 'setprofile',
  'monitoring', 'modules', 'dup', 'dup2', 'fdopen'];
const PY_INTRUDE_MODULES = ['inspect', 'gc', 'ctypes', '__main__', 'solution', 'bqh', 'bqscan', 'builtins', 'importlib', 'dis', 'faulthandler', 'traceback'];
const PY_INTRUDE_NAMES = ['eval', 'exec', 'compile', 'globals', 'locals', 'vars', 'getattr', '__import__', 'breakpoint', '__builtins__'];
function timingIntrusions(lang, facts) {
  if (lang !== 'python') return [];
  if (!facts || facts.fail) return ['code the check could not read'];
  if (facts.syntax) return [];
  const used = [];
  for (const t of PY_INTRUDE_ATTRS) if ((facts.attrs || []).includes(t)) used.push(t);
  for (const m of PY_INTRUDE_MODULES) if ((facts.imports || []).some((i) => topModule(i) === m)) used.push(m);
  for (const n of PY_INTRUDE_NAMES) if ((facts.names || []).includes(n)) used.push(n);
  used.push(...(facts.stores || []));
  return [...new Set(used)];
}

// The languages bans work in (all of them now).
const BAN_LANGS = T.LANGS.filter(T.hasBans);

module.exports = { normalizeBans, bansFor, bannedUse, runnerFacts, timingIntrusions, shown, jsKnows, BAN_LANGS, LIST_QUALIFIED };
