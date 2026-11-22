'use strict';
// Methods and names a code question doesn't allow: "ban": ["Arrays.sort", "stream", "sorted"], or
// { "java": [...], "python": [...] }. Code that uses one scores 0 on the question.
//
// Each entry is one of:
//   Class.method   that method of that class: "Arrays.sort", "Math.max", "math.sqrt"
//   method         a method or function of that name, on anything: "sort", "stream", "sorted", "max"
//   Name           (Java, capitalized) a library class or interface: "HashMap", "Stream"
//
// The check doesn't read the source text. The harness reports what the compiler saw, before any student
// code runs (harness/BQJ.java scan, harness/bqscan.py): for Java, every method, field and class the
// compiled classes refer to; for Python, the names that reach the builtins, the attributes read and the
// imports, from Python's own parser and symbol table. So comments, strings, spacing, unicode escapes and
// look-alike letters, imports, aliases, generics and method references are all already dealt with, and the
// student's own methods and variables (their own max, self.count) are theirs.
//
// A few entries cover their close relatives: "sort" also catches parallelSort, Math.* also StrictMath.*,
// "stream" anything in java.util.stream, a Java class its subclasses in java.util ("HashMap" catches
// LinkedHashMap), Python's sort and sorted each other plus heapq and bisect, math.* also cmath.*.
// A question with any ban also bans the usual ways around one: reflection and friends in Java; eval, exec,
// getattr, __import__, importlib, pickle and friends in Python.

const ENTRY = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;

// The ban list from a question, checked and tidied. Throws a message for the quiz file's error.
function normalizeBans(raw, languages) {
  if (raw == null) return null;
  const clean = (list, label) => {
    if (!Array.isArray(list)) throw new Error(`${label} should be a list of names, like ["Arrays.sort", "stream"].`);
    const out = [];
    for (const v of list.slice(0, 30)) {
      const name = String(v == null ? '' : v).trim();
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

// The banned names this code uses (or the way around a ban it uses), in the question's order. `facts` is
// the harness's scan; without one (the code never got that far) there's nothing to hold against it.
// D is the question's declared classes, whose fields and methods count as the student's own.
function bannedUse(ban, lang, facts, D) {
  const entries = bansFor(ban, lang);
  if (!entries.length || !facts || facts.syntax) return [];
  if (facts.fail) return ['code the check could not read'];
  return lang === 'python' ? pythonHits(entries, facts, D) : javaHits(entries, facts);
}

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

// The languages bans work in: the check reads what the compiler saw, which these two report.
const BAN_LANGS = ['java', 'python'];

module.exports = { normalizeBans, bansFor, bannedUse, timingIntrusions, BAN_LANGS };
