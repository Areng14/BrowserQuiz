// What students write, read from a solution: the method (its name, parameters and what it returns) or the
// class (its name, constructor and public methods), in the quiz's own type names (types.js). A type the code
// doesn't spell out (Python without hints, JavaScript) comes back null, and TypeScript's number as 'number':
// the tests' values settle those (fillFromTests). Plain string work, no DOM, so it's tested on its own.

// Typed languages first: the solution read for the shape is the first of these that has one.
const RANK = ['java', 'csharp', 'go', 'rust', 'c', 'cpp', 'typescript', 'python', 'javascript'];
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try', 'using', 'lock', 'foreach', 'sizeof', 'synchronized', 'function']);
const SCALAR = new Set(['int', 'long', 'double', 'boolean', 'string', 'char']);

// "a, Map<K, V> b" -> ["a", "Map<K, V> b"]: commas inside <>, (), [] and {} don't split
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
// Comments out, and strings emptied, so a brace or a "def" in either doesn't count.
function clean(code, lang) {
  let s = String(code || '').replace(/\r/g, '');
  if (lang === 'python') {
    s = s.replace(/("""|''')[\s\S]*?\1/g, (m) => m.replace(/[^\n]/g, ' '));
    s = s.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""').replace(/#.*$/gm, '');
  } else {
    s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
    s = s.replace(/"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
    if (lang !== 'rust') s = s.replace(/'(?:\\.|[^'\\\n])'/g, "''");
  }
  return s;
}
// The index of the "}" that closes the "{" at i
function closeOf(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}' && --d === 0) return k;
  }
  return s.length;
}

// ---------- each language's types, in the quiz's names ----------
const arr = (t) => (t && t !== 'void' && !t.startsWith('map<') && (t.match(/\[\]/g) || []).length < 2 ? `${t}[]` : null);
const listOf = (t) => (t && (SCALAR.has(t) || t === 'number' || /^[A-Z]\w*$/.test(t)) ? `list<${t}>` : null);
function mapOf(k, v) {
  if (k !== 'string' && k !== 'int') return null;
  if (v && /^(int|string)\[\]$/.test(v)) v = `list<${v.slice(0, -2)}>`;
  if (!v || !(SCALAR.has(v) || v === 'number' || /^list<(int|string)>$/.test(v))) return null;
  return `map<${k}, ${v}>`;
}
const userClass = (t) => (/^[A-Z]\w*$/.test(t) ? t : null);
const TYPES = {
  java(t) {
    t = t.replace(/\b(final)\b/g, '').replace(/\s+/g, '');
    const S = { int: 'int', long: 'long', double: 'double', boolean: 'boolean', char: 'char', String: 'string', void: 'void', Integer: 'int', Long: 'long', Double: 'double', Boolean: 'boolean', Character: 'char' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^(.+)\[\]$/.exec(t))) return arr(TYPES.java(m[1]));
    if ((m = /^(?:List|ArrayList|LinkedList)<(.+)>$/.exec(t))) return listOf(TYPES.java(m[1]));
    if ((m = /^(?:Map|HashMap|TreeMap|LinkedHashMap)<(.+)>$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.java(k), TYPES.java(v || '')); }
    return /^(List|Map|Set|Object)\b/.test(t) ? null : userClass(t);
  },
  csharp(t) {
    t = t.replace(/\s+/g, '');
    const S = { int: 'int', long: 'long', double: 'double', bool: 'boolean', char: 'char', string: 'string', String: 'string', void: 'void' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^(.+)\[\]$/.exec(t))) return arr(TYPES.csharp(m[1]));
    if ((m = /^(?:List|IList)<(.+)>$/.exec(t))) return listOf(TYPES.csharp(m[1]));
    if ((m = /^(?:Dictionary|IDictionary)<(.+)>$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.csharp(k), TYPES.csharp(v || '')); }
    return /^(List|Dictionary|Object)\b/.test(t) ? null : userClass(t);
  },
  cpp(t) {
    t = t.replace(/\bconst\b|\bstd::|&/g, '').replace(/\s+/g, ' ').trim();
    const S = { int: 'int', long: 'long', 'long long': 'long', double: 'double', bool: 'boolean', char: 'char', string: 'string', void: 'void' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^vector\s*<(.+)>$/.exec(t))) return arr(TYPES.cpp(m[1]));
    if ((m = /^(?:unordered_)?map\s*<(.+)>$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.cpp(k), TYPES.cpp(v || '')); }
    return userClass(t.replace(/\s*\*$/, ''));
  },
  c(t) {
    t = t.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').replace(/\s*\*/g, '*').trim();
    const S = { int: 'int', long: 'long', 'long long': 'long', double: 'double', bool: 'boolean', char: 'char', 'char*': 'string', void: 'void', 'int*': 'int[]', 'long long*': 'long[]', 'double*': 'double[]', 'bool*': 'boolean[]', 'char**': 'string[]', 'int**': 'int[][]', 'double**': 'double[][]' };
    return S[t] || null;
  },
  go(t) {
    t = t.replace(/\s+/g, '');
    const S = { int: 'int', int64: 'long', float64: 'double', bool: 'boolean', string: 'string', byte: 'char', rune: 'char' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^\[\](.+)$/.exec(t))) return arr(TYPES.go(m[1]));
    if ((m = /^map\[(.+?)\](.+)$/.exec(t))) return mapOf(TYPES.go(m[1]), TYPES.go(m[2]));
    return userClass(t.replace(/^\*/, ''));
  },
  rust(t) {
    t = t.replace(/&(?:'\w+\s+)?(mut\s+)?/g, '').replace(/\s+/g, '');
    const S = { i32: 'int', i64: 'long', f64: 'double', bool: 'boolean', String: 'string', str: 'string', char: 'char', '()': 'void' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^Vec<(.+)>$/.exec(t)) || (m = /^\[(.+)\]$/.exec(t))) return arr(TYPES.rust(m[1]));
    if ((m = /^HashMap<(.+)>$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.rust(k), TYPES.rust(v || '')); }
    return /^(Option|Box|Rc|RefCell|Self)\b/.test(t) ? null : userClass(t);
  },
  python(t) {
    t = t.replace(/\s+/g, '');
    const S = { int: 'int', float: 'double', bool: 'boolean', str: 'string', None: 'void' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^(?:list|List)\[(.+)\]$/.exec(t))) return arr(TYPES.python(m[1]));
    if ((m = /^(?:dict|Dict)\[(.+)\]$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.python(k), TYPES.python(v || '')); }
    return /^(Optional|List|Dict|Any)\b/.test(t) ? null : userClass(t);
  },
  typescript(t) {
    t = t.replace(/\s+/g, '').replace(/\|null$/, '');
    const S = { number: 'number', string: 'string', boolean: 'boolean', void: 'void' };
    if (S[t]) return S[t];
    let m;
    if ((m = /^(.+)\[\]$/.exec(t)) || (m = /^Array<(.+)>$/.exec(t))) return arr(TYPES.typescript(m[1]));
    if ((m = /^(?:Map|Record)<(.+)>$/.exec(t))) { const [k, v] = splitTop(m[1]); return mapOf(TYPES.typescript(k) === 'number' ? 'int' : TYPES.typescript(k), TYPES.typescript(v || '')); }
    return /^(Array|Map|Record|Set|any|unknown|object)\b/.test(t) ? null : userClass(t);
  },
  javascript: () => null,
};

// ---------- parameters ----------
// "String s" / "const vector<int>& nums" / "int *nums": type words, then the name
function typeThenName(p, lang) {
  const s = p.replace(/@\w+\s*/g, '').replace(/\b(final|ref|in|out|params)\s+/g, '').replace(/\s*=.*$/, '').trim();
  const m = /^(.*?)([*&\s]+)?([A-Za-z_]\w*)$/.exec(s);
  if (!m) return null;
  const type = (m[1] + (m[2] || '').replace(/\s/g, '')).trim();
  return { name: m[3], type: TYPES[lang](type), raw: type };
}
// "s: str" / "s string" / "s" (JavaScript)
function nameThenType(p, lang) {
  const s = p.replace(/\s*=.*$/, '').trim();
  if (lang === 'go') { const m = /^([A-Za-z_]\w*)\s+(.+)$/.exec(s); return m ? { name: m[1], type: TYPES.go(m[2]) } : { name: s, type: null, later: true }; }
  const m = /^(?:mut\s+)?([A-Za-z_]\w*)\??\s*(?::\s*(.+))?$/.exec(s);
  if (!m) return null;
  return { name: m[1], type: m[2] ? TYPES[lang](m[2]) : null };
}
function readParams(text, lang) {
  const parts = splitTop(text);
  if (lang === 'c') {
    // an array comes as a pointer and its length after it: int* nums, int numsSize (and int* gridColSize)
    const out = [];
    for (let k = 0; k < parts.length; k++) {
      const p = typeThenName(parts[k], 'c');
      if (!p) return null;
      if (/Size$|ColSize$/.test(p.name) && out.length && out[out.length - 1].type && /\[\]/.test(out[out.length - 1].type)) continue;
      out.push({ name: p.name, type: p.type });
    }
    return out;
  }
  const typed = ['java', 'csharp', 'cpp'].includes(lang);
  const out = parts.map((p) => (typed ? typeThenName(p, lang) : nameThenType(p, lang)));
  if (out.some((p) => !p)) return null;
  if (lang === 'go') { for (let k = out.length - 2; k >= 0; k--) if (out[k].later) { out[k].type = out[k + 1].type; delete out[k].later; } }
  return out.filter((p) => !['self', 'this'].includes(p.name)).map((p) => ({ name: p.name, type: p.type }));
}

// ---------- each language's functions, with the class each sits in ----------
// -> [{ name, params, returns, cls, ctor, hidden, body }] and the classes named
function functions(code, lang) {
  const s = clean(code, lang);
  const fns = [];
  const classes = [];
  if (lang === 'python') {
    const lines = s.split('\n');
    let cls = null;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const ind = /^\s*/.exec(line)[0].length;
      const c = /^class\s+([A-Za-z_]\w*)/.exec(line);
      if (c) { cls = c[1]; classes.push(cls); return; }
      if (ind === 0 && !/^@/.test(line)) cls = null;
      const head = /^\s*def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
      if (!head) return;
      const rest = lines.slice(i).join('\n');
      const m = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+?))?\s*:/.exec(rest);
      if (!m) return;
      const bodyLines = [];
      for (let k = i + 1; k < lines.length; k++) {
        if (lines[k].trim() && /^\s*/.exec(lines[k])[0].length <= ind) break;
        bodyLines.push(lines[k]);
      }
      const body = bodyLines.join('\n');
      const params = readParams(m[2], 'python');
      if (!params) return;
      const inCls = ind > 0 ? cls : null;
      fns.push({ name: m[1], params, returns: m[3] ? TYPES.python(m[3]) : /\breturn\s+\S/.test(body) ? null : 'void',
        cls: inCls, ctor: m[1] === '__init__', hidden: m[1].startsWith('_') && m[1] !== '__init__' });
    });
    return { fns, classes };
  }
  // the brace-bodied languages: classes (impl blocks, structs) by their braces
  const ranges = [];
  const clsRe = lang === 'rust' ? /\bimpl\s+([A-Za-z_]\w*)\s*\{/g : lang === 'go' ? /\btype\s+([A-Za-z_]\w*)\s+struct\s*\{/g : /\b(?:class|struct)\s+([A-Za-z_]\w*)[^{;]*\{/g;
  for (const m of s.matchAll(clsRe)) {
    const open = m.index + m[0].length - 1;
    ranges.push({ name: m[1], from: open, to: closeOf(s, open) });
    if (!classes.includes(m[1])) classes.push(m[1]);
  }
  const clsAt = (i) => ranges.filter((r) => r.from < i && i < r.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  const bodyAt = (i) => s.slice(i, closeOf(s, i));
  if (lang === 'go') {
    for (const m of s.matchAll(/\bfunc\s*(?:\(\s*\w+\s+\*?([A-Za-z_]\w*)\s*\))?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^{]*)\{/g)) {
      const params = readParams(m[3], 'go');
      if (!params) continue;
      const ret = m[4].trim();
      const ctorOf = /^New([A-Z]\w*)$/.exec(m[2]);
      fns.push({ name: m[2], params, returns: ret ? TYPES.go(ret) : 'void', cls: m[1] || (ctorOf && classes.includes(ctorOf[1]) ? ctorOf[1] : null),
        ctor: !!(ctorOf && classes.includes(ctorOf[1])), hidden: false });
    }
    return { fns, classes };
  }
  if (lang === 'rust') {
    for (const m of s.matchAll(/\b(pub\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*(?:where[^{]*)?\{/g)) {
      const params = readParams(m[3].replace(/&?\s*(?:'\w+\s+)?(?:mut\s+)?self\b/, 'self'), 'rust');
      if (!params) continue;
      const r = clsAt(m.index);
      const ret = (m[4] || '').trim();
      fns.push({ name: m[2], params, returns: !ret ? 'void' : TYPES.rust(ret), cls: r ? r.name : null,
        ctor: !!r && (m[2] === 'new' || ret === 'Self' || ret === r.name), hidden: !!r && !m[1] && r.name !== 'Solution' });
    }
    return { fns, classes };
  }
  const isJs = lang === 'javascript' || lang === 'typescript';
  const headRe = isJs
    ? /(?:^|[;{}\n])\s*((?:export\s+|async\s+|static\s+|public\s+|private\s+|protected\s+|function\s+)*)(#?[A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?::\s*([^{=;]+?))?\s*\{/g
    : /(?:^|[;{}\n])\s*([\w<>[\],.*&:\s]*?)\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?(?:throws\s+[\w\s,.]+)?(?:\s*:\s*[^{;]+)?\s*\{/g;
  for (const m of s.matchAll(headRe)) {
    const name = m[2].replace(/^#/, '');
    if (CONTROL.has(name)) continue;
    const at = m.index + m[0].length - 1;
    const r = clsAt(at);
    const nameAt = m.index + m[0].search(new RegExp(`${m[2].replace('$', '\\$')}\\s*\\(`));
    const words = m[1].replace(/\b(public|private|protected)\s*:/g, ' ').trim().split(/\s+/).filter(Boolean);
    const mods = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'override', 'virtual', 'internal', 'sealed', 'inline', 'export', 'async', 'function', 'explicit']);
    const typeWords = words.filter((w) => !mods.has(w));
    if (!isJs && typeWords.some((w) => CONTROL.has(w) || w === 'else')) continue;
    const ctor = isJs ? name === 'constructor' : !!r && name === r.name && !typeWords.length;
    if (!isJs && !ctor && !typeWords.length) continue; // a call, not a declaration
    // C++: the access label above it in its class
    let hidden = words.includes('private') || words.includes('protected') || m[2].startsWith('#');
    if (lang === 'cpp' && r) {
      const before = s.slice(r.from, nameAt);
      const label = [...before.matchAll(/\b(public|private|protected)\s*:/g)].pop();
      hidden = label ? label[1] !== 'public' : s.slice(Math.max(0, r.from - 200), r.from).includes('class');
    }
    const params = readParams(m[3], lang);
    if (!params) continue;
    const typeText = typeWords.join(' ');
    let returns = ctor ? null : isJs ? (m[4] ? TYPES[lang](m[4]) : null) : TYPES[lang](typeText);
    if (isJs && !ctor && !m[4] && !/\breturn\s+[^;\s]/.test(bodyAt(at))) returns = 'void';
    fns.push({ name, params, returns, cls: r ? r.name : null, ctor, hidden });
  }
  return { fns, classes };
}

// ---------- the shape ----------
// One solution -> { mode: 'method', signature } or { mode: 'class', class }, or null when nothing reads.
function readSolution(code, lang) {
  if (!String(code || '').trim() || !TYPES[lang]) return null;
  const { fns } = functions(code, lang);
  const own = (f) => !f.hidden && !f.ctor && !/^(main|__\w+__)$/.test(f.name);
  const method = fns.find((f) => own(f) && (!f.cls || f.cls === 'Solution'));
  if (method) return { mode: 'method', signature: { name: method.name, params: method.params, returns: method.returns } };
  const name = (fns.find((f) => f.cls && f.cls !== 'Solution' && (f.ctor || own(f))) || {}).cls;
  if (!name) return null;
  const ctor = fns.find((f) => f.cls === name && f.ctor);
  const methods = fns.filter((f) => f.cls === name && own(f)).map((f) => ({ name: f.name, params: f.params, returns: f.returns }));
  return { mode: 'class', class: { name, constructor: ctor ? ctor.params : [], methods } };
}
// Every language's reading, typed ones first: { shape, from, others: [{ lang, shape }] }
function readSolutions(refs, langs) {
  const reads = RANK.filter((l) => langs.includes(l)).map((l) => ({ lang: l, shape: readSolution(refs[l], l) })).filter((r) => r.shape);
  if (!reads.length) return null;
  return { shape: JSON.parse(JSON.stringify(reads[0].shape)), from: reads[0].lang, others: reads.slice(1) };
}

// ---------- types from the tests' values ----------
function valueType(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'long' : 'int') : 'double';
  if (Array.isArray(v)) { const e = v.map(valueType).reduce(merge, null); return e ? arr(e) : null; }
  if (typeof v === 'object') { const e = Object.values(v).map(valueType).reduce(merge, null); return e ? mapOf('string', e) : null; }
  return null;
}
function merge(a, b) {
  if (!a) return b;
  if (!b || a === b) return a;
  const pair = new Set([a, b]);
  if (pair.has('double') && (pair.has('int') || pair.has('long'))) return 'double';
  if (pair.has('long') && pair.has('int')) return 'long';
  const ea = /^(.+)\[\]$/.exec(a);
  const eb = /^(.+)\[\]$/.exec(b);
  if (ea && eb) { const e = merge(ea[1], eb[1]); return e ? `${e}[]` : a; }
  return a;
}
// A type the code left open, from what the tests pass and expect; 'number' settles as int or double.
function settle(type, seen) {
  if (type && !/number/.test(type)) return type;
  if (!type) return seen || null;
  const scalar = seen ? seen.replace(/\[\]/g, '').replace(/^list<(.+)>$/, '$1') : 'int';
  return type.replace(/number/g, scalar === 'double' ? 'double' : scalar === 'long' ? 'long' : 'int');
}
// method tests: [{ args, expected }]; class tests: [{ steps: [{ new } | { call, args, expect }] }]
function fillFromTests(shape, tests) {
  if (!shape) return shape;
  const fill = (params, argLists) => params.forEach((p, k) => {
    p.type = settle(p.type, argLists.map((a) => (a && a.length > k ? valueType(a[k]) : null)).reduce(merge, null));
  });
  if (shape.mode === 'method') {
    const sig = shape.signature;
    fill(sig.params, tests.map((t) => t.args));
    sig.returns = settle(sig.returns, tests.map((t) => valueType(t.expected)).reduce(merge, null));
  } else {
    const C = shape.class;
    const steps = tests.flatMap((t) => t.steps || []);
    fill(C.constructor, steps.filter((s) => s.new).map((s) => s.new));
    for (const m of C.methods) {
      const calls = steps.filter((s) => s.call === m.name);
      fill(m.params, calls.map((s) => s.args));
      m.returns = settle(m.returns, calls.map((s) => valueType(s.expect)).reduce(merge, null));
    }
  }
  return shape;
}
// The types still open: [] when every one is known
function openTypes(shape) {
  if (!shape) return [];
  const list = shape.mode === 'method'
    ? [...shape.signature.params.map((p) => [p.name, p.type]), ['returns', shape.signature.returns]]
    : [...shape.class.constructor.map((p) => [p.name, p.type]), ...shape.class.methods.flatMap((m) => [...m.params.map((p) => [`${m.name} ${p.name}`, p.type]), [`${m.name} returns`, m.returns]])];
  return list.filter(([, t]) => !t).map(([n]) => n);
}
// Where another language's solution disagrees with the one read: names and parameter counts
function disagreements(read) {
  if (!read) return [];
  const names = (sh) => (sh.mode === 'method' ? [`${sh.signature.name}/${sh.signature.params.length}`] : [sh.class.name, ...sh.class.methods.map((m) => `${m.name}/${m.params.length}`)]);
  const base = names(read.shape).join(',');
  return read.others.filter((o) => o.shape.mode !== read.shape.mode || names(o.shape).join(',') !== base).map((o) => o.lang);
}

export { RANK, disagreements, fillFromTests, openTypes, readSolution, readSolutions, valueType };
