// Value types for code questions, shared by the server (require) and the quiz maker (window.BQTypes),
// and how each language writes them.
//   scalars:  int, long, double, boolean, string, char
//   arrays:   any scalar with [] or [][]          e.g. char[], string[][]
//   lists:    list<int|long|double|boolean|string|char>
//   maps:     map<string|int, V>, V a scalar, list<int> or list<string>
//   classes:  a class the question declares in "types" (D below), like Point, with Point[],
//             Point[][] and list<Point>. A class's fields can be any of the above, itself included.
// Values are JSON: a char is a one-letter string; a map is an object whose keys are strings
// (for int keys, strings like "3"); an object of a declared class is a JSON object of its fields
// ({"x": 1, "y": 2}), where fields that hold objects, arrays, lists or strings can be left out (null).
//
// D, where it's taken, is the question's declared classes: { Point: [{ name: 'x', type: 'int' }, ...] }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQTypes = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const SCALARS = ['int', 'long', 'double', 'boolean', 'string', 'char'];
  const LIST_OF = SCALARS;
  const MAP_KEYS = ['string', 'int'];
  const MAP_VALUES = [...SCALARS, 'list<int>', 'list<string>'];
  const MAX_ITEMS = 1000;
  const INT_MIN = -2147483648;
  const INT_MAX = 2147483647;
  const MAX_DEPTH = 300; // objects inside objects (a linked list's length)
  const CLASS = /^[A-Z][A-Za-z0-9_]{0,40}$/;
  const isClass = (t, D) => !!(D && CLASS.test(t) && Object.prototype.hasOwnProperty.call(D, t));

  // "map< string , int >" -> "map<string,int>"
  const canon = (t) => String(t == null ? '' : t).replace(/\s+/g, '');
  function mapTypes(t) {
    const m = /^map<(\w+),(.+)>$/.exec(canon(t));
    return m ? [m[1], m[2]] : null;
  }
  function isValueType(t, D) {
    t = canon(t);
    if (SCALARS.includes(t) || isClass(t, D)) return true;
    const arr = /^(\w+)(\[\]){1,2}$/.exec(t);
    if (arr) return SCALARS.includes(arr[1]) || isClass(arr[1], D);
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return LIST_OF.includes(list[1]) || isClass(list[1], D);
    const kv = mapTypes(t);
    return !!kv && MAP_KEYS.includes(kv[0]) && MAP_VALUES.includes(kv[1]);
  }
  // What an array or list holds; null for scalars and maps.
  function elementType(t) {
    t = canon(t);
    if (t.endsWith('[]')) return t.slice(0, -2);
    const list = /^list<(\w+)>$/.exec(t);
    return list ? list[1] : null;
  }
  const isIntKey = (k) => /^-?\d+$/.test(k) && Number(k) >= INT_MIN && Number(k) <= INT_MAX;
  // A field that may be left out of an object's JSON: it's null then.
  const nullable = (t) => !SCALARS.includes(canon(t)) || canon(t) === 'string';
  function checkValue(t, v, D, depth) {
    t = canon(t);
    depth = depth || 0;
    if (v === null) return nullable(t);
    if (isClass(t, D)) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || depth > MAX_DEPTH) return false;
      const fields = D[t];
      if (Object.keys(v).some((k) => !fields.some((f) => f.name === k))) return false;
      return fields.every((f) => (v[f.name] === undefined ? nullable(f.type) : checkValue(f.type, v[f.name], D, depth + 1)));
    }
    switch (t) {
      case 'int': return Number.isInteger(v) && v >= INT_MIN && v <= INT_MAX;
      case 'long': return Number.isSafeInteger(v);
      case 'double': return typeof v === 'number' && Number.isFinite(v);
      case 'boolean': return typeof v === 'boolean';
      case 'string': return typeof v === 'string' && v.length <= 10000;
      case 'char': return typeof v === 'string' && [...v].length === 1 && v.length === 1;
      default: break;
    }
    const kv = mapTypes(t);
    if (kv) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const keys = Object.keys(v);
      return keys.length <= MAX_ITEMS && keys.every((k) => (kv[0] === 'int' ? isIntKey(k) : true) && checkValue(kv[1], v[k], D, depth));
    }
    const e = elementType(t);
    if (!e || !Array.isArray(v) || v.length > MAX_ITEMS) return false;
    return v.every((x) => checkValue(e, x, D, depth));
  }

  const BOX = { int: 'Integer', long: 'Long', double: 'Double', boolean: 'Boolean', string: 'String', char: 'Character' };
  function javaType(t) {
    t = canon(t);
    if (t === 'void') return 'void';
    if (t === 'string') return 'String';
    if (SCALARS.includes(t)) return t;
    if (t.endsWith('[]')) return javaType(t.slice(0, -2)) + '[]';
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return `ArrayList<${BOX[list[1]] || list[1]}>`;
    const kv = mapTypes(t);
    if (kv) return `HashMap<${BOX[kv[0]]}, ${BOX[kv[1]] || javaType(kv[1])}>`;
    return t;
  }
  const PY = { int: 'int', long: 'int', double: 'float', boolean: 'bool', string: 'str', char: 'str', void: 'None' };
  function pyType(t) {
    t = canon(t);
    if (PY[t]) return PY[t];
    if (t.endsWith('[]')) return `list[${pyType(t.slice(0, -2))}]`;
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return `list[${PY[list[1]] || list[1]}]`;
    const kv = mapTypes(t);
    if (kv) return `dict[${PY[kv[0]]}, ${pyType(kv[1])}]`;
    return t;
  }
  const HELP = 'int, long, double, boolean, string, char; any of them with [] or [][]; list<...> of them; map<string or int, ...>; a class from Classes';

  // ---------- languages ----------
  const LANGS = ['java', 'python', 'javascript', 'typescript', 'c', 'cpp', 'csharp', 'go', 'rust', 'swift', 'ruby'];
  const LANG_NAMES = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust', swift: 'Swift', ruby: 'Ruby' };
  const isJs = (l) => l === 'javascript' || l === 'typescript';
  const isC = (l) => l === 'c' || l === 'cpp';
  // Compiled to a program of its own: C, C++, Go, Rust (each test in its own process, no speed tests)
  const isNative = (l) => isC(l) || l === 'go' || l === 'rust' || l === 'swift';
  // Languages with speed tests: the ones whose harness can time code without the code reaching in
  const hasSpeed = (l) => l === 'java' || l === 'python' || isJs(l);
  const isClassName = (t) => /^[A-Z]\w*$/.test(canon(t));

  // JavaScript and TypeScript: numbers are number, chars are one-letter strings, maps are Map.
  const JS = { int: 'number', long: 'number', double: 'number', boolean: 'boolean', string: 'string', char: 'string', void: 'void' };
  function jsType(t) {
    t = canon(t);
    if (JS[t]) return JS[t];
    if (t.endsWith('[]')) return jsType(t.slice(0, -2)) + '[]';
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return jsType(list[1]) + '[]';
    const kv = mapTypes(t);
    if (kv) return `Map<${JS[kv[0]]}, ${jsType(kv[1])}>`;
    return t;
  }
  // TypeScript, where an object of a class can be null: ListNode | null.
  const tsType = (t) => jsType(t) + (isClassName(t) ? ' | null' : '');

  // C++: vector for arrays and lists, unordered_map for maps, a pointer for an object (it can be nullptr).
  const CPP = { int: 'int', long: 'long long', double: 'double', boolean: 'bool', string: 'string', char: 'char', void: 'void' };
  function cppType(t) {
    t = canon(t);
    if (CPP[t]) return CPP[t];
    if (t.endsWith('[]')) return `vector<${cppType(t.slice(0, -2))}>`;
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return `vector<${cppType(list[1])}>`;
    const kv = mapTypes(t);
    if (kv) return `unordered_map<${CPP[kv[0]]}, ${cppType(kv[1])}>`;
    return t + '*';
  }
  // vectors and maps come in by reference, like LeetCode: vector<int>& nums
  const cppParam = (p) => `${cppType(p.type)}${/^(vector|unordered_map)</.test(cppType(p.type)) ? '&' : ''} ${p.name}`;

  // C: an array comes with its length, LeetCode's way: int* nums, int numsSize (and int* gridColSize for
  // the rows of a 2D array). An array that's returned sets *returnSize. No maps, no class questions.
  const CT = { int: 'int', long: 'long long', double: 'double', boolean: 'bool', string: 'char*', char: 'char', void: 'void' };
  function cType(t) {
    t = canon(t);
    if (CT[t]) return CT[t];
    const e = elementType(t);
    return e ? cType(e) + '*' : t + '*';
  }
  const cDims = (t) => (/\[\]\[\]$/.test(canon(t)) ? 2 : elementType(t) ? 1 : 0);
  function cSignature(s) {
    const ps = s.params.map((p) => {
      const d = cDims(p.type);
      const base = `${cType(p.type)} ${p.name}`;
      return d === 2 ? `${base}, int ${p.name}Size, int* ${p.name}ColSize` : d === 1 ? `${base}, int ${p.name}Size` : base;
    });
    const d = cDims(s.returns);
    if (d) ps.push('int* returnSize');
    if (d === 2) ps.push('int** returnColumnSizes');
    return `${cType(s.returns)} ${s.name}(${ps.join(', ') || 'void'})`;
  }

  // Go: slices, maps, and a pointer for an object (nil for none). A char is a byte, like Go's s[i].
  const GO = { int: 'int', long: 'int64', double: 'float64', boolean: 'bool', string: 'string', char: 'byte' };
  function goType(t) {
    t = canon(t);
    if (GO[t]) return GO[t];
    const e = elementType(t);
    if (e) return '[]' + goType(e);
    const kv = mapTypes(t);
    if (kv) return `map[${GO[kv[0]]}]${goType(kv[1])}`;
    return '*' + t;
  }
  // Rust: Vec, HashMap, and Option<Box<...>> for an object (None for none), like LeetCode's ListNode.
  const RS = { int: 'i32', long: 'i64', double: 'f64', boolean: 'bool', string: 'String', char: 'char' };
  function rustType(t) {
    t = canon(t);
    if (RS[t]) return RS[t];
    const e = elementType(t);
    if (e) return `Vec<${rustType(e)}>`;
    const kv = mapTypes(t);
    if (kv) return `HashMap<${RS[kv[0]]}, ${rustType(kv[1])}>`;
    return `Option<Box<${t}>>`;
  }

  // C#: arrays (jagged for [][]), List, Dictionary; an object is a reference (null for none).
  const CS = { int: 'int', long: 'long', double: 'double', boolean: 'bool', string: 'string', char: 'char', void: 'void' };
  function csType(t) {
    t = canon(t);
    if (CS[t]) return CS[t];
    if (t.endsWith('[]')) return csType(t.slice(0, -2)) + '[]';
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return `List<${csType(list[1])}>`;
    const kv = mapTypes(t);
    if (kv) return `Dictionary<${CS[kv[0]]}, ${csType(kv[1])}>`;
    return t;
  }
  // Swift: arrays, dictionaries, and an optional for an object (ListNode?, nil for none), like LeetCode.
  const SW = { int: 'Int', long: 'Int', double: 'Double', boolean: 'Bool', string: 'String', char: 'Character' };
  function swiftType(t, inner) {
    t = canon(t);
    if (SW[t]) return SW[t];
    const e = elementType(t);
    if (e) return `[${swiftType(e, true)}]`;
    const kv = mapTypes(t);
    if (kv) return `[${SW[kv[0]]}: ${swiftType(kv[1], true)}]`;
    return t + '?';
  }
  // Ruby: what its YARD comments call them (Integer, Integer[], Hash<String, Integer>).
  const RB = { int: 'Integer', long: 'Integer', double: 'Float', boolean: 'Boolean', string: 'String', char: 'String', void: 'void' };
  function rubyType(t) {
    t = canon(t);
    if (RB[t]) return RB[t];
    const e = elementType(t);
    if (e) return rubyType(e) + '[]';
    const kv = mapTypes(t);
    if (kv) return `Hash<${RB[kv[0]]}, ${rubyType(kv[1])}>`;
    return t;
  }

  // Why a language can't take a type (C has no maps, and keeps 2D arrays to numbers), or null.
  function unsupported(lang, t, D) {
    t = canon(t);
    if (lang !== 'c') return null;
    if (mapTypes(t)) return 'C has no maps';
    const two = /^(\w+)\[\]\[\]$/.exec(t);
    if (two && (two[1] === 'string' || isClass(two[1], D))) return 'C can only have 2D arrays of numbers, booleans and chars';
    return null;
  }

  // Why a value can't be written in a language, or null. C and C++ chars are one byte; C++ has no null
  // string, vector or map; C strings end at \0.
  function fits(lang, t, v, D, depth) {
    t = canon(t);
    depth = depth || 0;
    if (!(isNative(lang) || lang === 'csharp') || depth > MAX_DEPTH) return null;
    if (lang === 'csharp') return null;
    if (v === null || v === undefined) {
      if (isClass(t, D) || lang === 'c') return null;
      if (lang === 'go') return t === 'string' ? 'Go has no null string' : null;
      if (lang === 'swift') return `Swift has no nil ${swiftType(t)} (only for an object)`;
      return lang === 'rust' ? `Rust has no null ${rustType(t)} (only None for an object)` : `C++ has no null ${cppType(t)}`;
    }
    if (typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.range)) return null;
    if (isClass(t, D)) {
      for (const f of D[t]) {
        if (v[f.name] === undefined && !nullable(f.type)) continue;
        const r = fits(lang, f.type, v[f.name] === undefined ? null : v[f.name], D, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (t === 'char') {
      if (lang === 'rust' || lang === 'swift') return typeof v === 'string' && !(v.charCodeAt(0) >= 0xd800 && v.charCodeAt(0) < 0xe000) ? null : `that char isn't a ${lang === 'rust' ? 'Rust' : 'Swift'} char`;
      return typeof v === 'string' && v.charCodeAt(0) < 128 ? null : `a ${lang === 'go' ? 'Go' : 'C or C++'} char is one byte (plain ASCII only)`;
    }
    if (t === 'string') return lang === 'c' && typeof v === 'string' && v.includes('\0') ? "a C string can't hold \\0" : null;
    if (SCALARS.includes(t)) return null;
    const kv = mapTypes(t);
    const items = kv ? Object.values(v || {}) : Array.isArray(v) ? v : [];
    for (const x of items) { const r = fits(lang, kv ? kv[1] : elementType(t), x, D, depth); if (r) return r; }
    return null;
  }

  // What students start with, when the quiz doesn't give its own starter code.
  function starter(shape, lang, emptyClass) {
    const jp = (ps) => ps.map((p) => `${javaType(p.type)} ${p.name}`).join(', ');
    const pp = (ps) => ps.map((p) => `, ${p.name}: ${pyType(p.type)}`).join('');
    const tp = (ps) => ps.map((p) => `${p.name}: ${tsType(p.type)}`).join(', ');
    const names = (ps) => ps.map((p) => p.name).join(', ');
    const cp = (ps) => ps.map(cppParam).join(', ');
    const gp = (ps) => ps.map((p) => `${p.name} ${goType(p.type)}`).join(', ');
    const rp = (ps) => ps.map((p) => `${p.name}: ${rustType(p.type)}`).join(', ');
    const goRet = (t) => (t === 'void' ? '' : ' ' + goType(t));
    const csp = (ps) => ps.map((p) => `${csType(p.type)} ${p.name}`).join(', ');
    const swp = (ps) => ps.map((p) => `_ ${p.name}: ${swiftType(p.type)}`).join(', ');
    const swRet = (t) => (t === 'void' ? '' : ' -> ' + swiftType(t));
    // YARD, so Ruby students know the types, as LeetCode does: # @param {Integer[]} nums
    const rbDoc = (ps, ret, ind) => [...ps.map((p) => `${ind}# @param {${rubyType(p.type)}} ${p.name}`), ...(ret ? [`${ind}# @return {${rubyType(ret)}}`] : [])].map((l) => l + '\n').join('');
    const rsRet = (t) => (t === 'void' ? '' : ' -> ' + rustType(t));
    // JSDoc, so JavaScript students know the types: @param {number[]} nums
    const doc = (ps, ret, ind) => (ps.length || ret ? [`${ind}/**`, ...ps.map((p) => `${ind} * @param {${jsType(p.type)}} ${p.name}`),
      ...(ret ? [`${ind} * @return {${jsType(ret)}}`] : []), `${ind} */`].join('\n') + '\n' : '');
    if (shape.signature) {
      const s = shape.signature;
      if (lang === 'java') return `class Solution {\n    public ${javaType(s.returns)} ${s.name}(${jp(s.params)}) {\n        \n    }\n}\n`;
      if (lang === 'python') return `class Solution:\n    def ${s.name}(self${pp(s.params)}) -> ${pyType(s.returns)}:\n        pass\n`;
      if (lang === 'javascript') return `${doc(s.params, s.returns, '')}function ${s.name}(${names(s.params)}) {\n    \n}\n`;
      if (lang === 'typescript') return `function ${s.name}(${tp(s.params)}): ${tsType(s.returns)} {\n    \n}\n`;
      if (lang === 'cpp') return `class Solution {\npublic:\n    ${cppType(s.returns)} ${s.name}(${cp(s.params)}) {\n        \n    }\n};\n`;
      if (lang === 'go') return `func ${s.name}(${gp(s.params)}) ${goType(s.returns)} {\n    \n}\n`;
      if (lang === 'csharp') return `public class Solution {\n    public ${csType(s.returns)} ${s.name}(${csp(s.params)}) {\n        \n    }\n}\n`;
      if (lang === 'swift') return `class Solution {\n    func ${s.name}(${swp(s.params)}) -> ${swiftType(s.returns)} {\n        \n    }\n}\n`;
      if (lang === 'ruby') return `${rbDoc(s.params, s.returns, '')}def ${s.name}(${names(s.params)})\n    \nend\n`;
      if (lang === 'rust') return `impl Solution {\n    pub fn ${s.name}(${rp(s.params)}) -> ${rustType(s.returns)} {\n        \n    }\n}\n`;
      const d = cDims(s.returns);
      const note = d === 2 ? '// Return a malloc\'d array of malloc\'d rows. Set *returnSize to the number of rows\n// and *returnColumnSizes to a malloc\'d array of their lengths.\n'
        : d ? '// Return a malloc\'d array, and set *returnSize to its length.\n' : '';
      return `${note}${cSignature(s)} {\n    \n}\n`;
    }
    const C = shape.class;
    const n = C.name;
    if (emptyClass) {
      return {
        java: `public class ${n} {\n    \n}\n`, python: `class ${n}:\n    pass\n`, cpp: `class ${n} {\npublic:\n    \n};\n`, go: `type ${n} struct {\n    \n}\n`, rust: `struct ${n} {\n    \n}\n`,
        csharp: `public class ${n} {\n    \n}\n`, ruby: `class ${n}\n    \nend\n`,
      }[lang] || `class ${n} {\n    \n}\n`;
    }
    let body;
    if (lang === 'java') {
      body = [`    public ${n}(${jp(C.constructor)}) {\n    }`].concat(C.methods.map((m) => `    public ${javaType(m.returns)} ${m.name}(${jp(m.params)}) {\n    }`));
      return `public class ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    if (lang === 'python') {
      body = [`    def __init__(self${pp(C.constructor)}):\n        pass`].concat(C.methods.map((m) => `    def ${m.name}(self${pp(m.params)}) -> ${pyType(m.returns)}:\n        pass`));
      return `class ${n}:\n${body.join('\n\n')}\n`;
    }
    if (lang === 'javascript') {
      body = [`${doc(C.constructor, null, '    ')}    constructor(${names(C.constructor)}) {\n    }`]
        .concat(C.methods.map((m) => `${doc(m.params, m.returns, '    ')}    ${m.name}(${names(m.params)}) {\n    }`));
      return `class ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    if (lang === 'typescript') {
      body = [`    constructor(${tp(C.constructor)}) {\n    }`].concat(C.methods.map((m) => `    ${m.name}(${tp(m.params)}): ${tsType(m.returns)} {\n    }`));
      return `class ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    if (lang === 'csharp') {
      body = [`    public ${n}(${csp(C.constructor)}) {\n    }`].concat(C.methods.map((m) => `    public ${csType(m.returns)} ${m.name}(${csp(m.params)}) {\n    }`));
      return `public class ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    if (lang === 'swift') {
      body = [`    init(${swp(C.constructor)}) {\n    }`].concat(C.methods.map((m) => `    func ${m.name}(${swp(m.params)})${swRet(m.returns)} {\n    }`));
      return `class ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    if (lang === 'ruby') {
      body = [`${rbDoc(C.constructor, null, '    ')}    def initialize(${names(C.constructor)})\n    end`]
        .concat(C.methods.map((m) => `${rbDoc(m.params, m.returns, '    ')}    def ${m.name}(${names(m.params)})\n    end`));
      return `class ${n}\n${body.join('\n\n')}\nend\n`;
    }
    if (lang === 'go') {
      // a constructor function and methods on a pointer, the usual Go way: c := NewCounter(5); c.add(3)
      body = [`type ${n} struct {\n    \n}`, `func New${n}(${gp(C.constructor)}) *${n} {\n    return &${n}{}\n}`]
        .concat(C.methods.map((m) => `func (this *${n}) ${m.name}(${gp(m.params)})${goRet(m.returns)} {\n    \n}`));
      return body.join('\n\n') + '\n';
    }
    if (lang === 'rust') {
      body = [`    pub fn new(${rp(C.constructor)}) -> Self {\n        ${n} {}\n    }`]
        .concat(C.methods.map((m) => `    pub fn ${m.name}(&mut self${m.params.map((p) => `, ${p.name}: ${rustType(p.type)}`).join('')})${rsRet(m.returns)} {\n        \n    }`));
      return `struct ${n} {\n    \n}\n\nimpl ${n} {\n${body.join('\n\n')}\n}\n`;
    }
    body = [`    ${n}(${cp(C.constructor)}) {\n    }`].concat(C.methods.map((m) => `    ${cppType(m.returns)} ${m.name}(${cp(m.params)}) {\n    }`));
    return `class ${n} {\npublic:\n${body.join('\n\n')}\n};\n`;
  }

  // The declared classes, written out for the harness. Java: public fields (so p.x works), a constructor
  // taking every field in order, a no-argument one, getters and toString. Python: the same fields, every
  // one with a default, so Node(3) works. `brief` is what students read: the same classes without
  // toString/__repr__, and in Python the field types as a comment instead of annotations.
  const JAVA_ZERO = { int: '0', long: '0L', double: '0.0', boolean: 'false', char: "'\\0'" };
  const PY_ZERO = { int: '0', long: '0', double: '0.0', boolean: 'False', char: "''" };
  const cap = (n) => n.charAt(0).toUpperCase() + n.slice(1);
  const JS_ZERO = { int: '0', long: '0', double: '0', boolean: 'false', char: "''" };
  const CPP_ZERO = { int: '0', long: '0', double: '0.0', boolean: 'false', char: "'\\0'" };
  function classSource(D, lang, brief) {
    const names = Object.keys(D || {});
    if (isJs(lang)) {
      const ts = lang === 'typescript';
      const dflt = (f) => JS_ZERO[canon(f.type)] || 'null';
      const tsField = (f) => jsType(f.type) + (JS_ZERO[canon(f.type)] ? '' : ' | null');
      return names.map((n) => {
        const fs = D[n];
        const L = [`class ${n} {`];
        if (ts) { fs.forEach((f) => L.push(`    ${f.name}: ${tsField(f)};`)); if (fs.length) L.push(''); } else if (brief && fs.length) L.push(`    // ${fs.map((f) => `${f.name}: ${jsType(f.type)}`).join(', ')}`);
        L.push(`    constructor(${fs.map((f) => (ts ? `${f.name}: ${tsField(f)} = ${dflt(f)}` : `${f.name} = ${dflt(f)}`)).join(', ')}) {`);
        fs.forEach((f) => L.push(`        this.${f.name} = ${f.name};`));
        L.push('    }', '}');
        return L.join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'cpp') {
      // Objects are pointers (Node* next), so classes can hold each other: declared up front when there are several.
      const fwd = names.length > 1 ? names.map((n) => `struct ${n};`).join('\n') + '\n\n' : '';
      return fwd + names.map((n) => {
        const fs = D[n];
        const L = [`struct ${n} {`];
        fs.forEach((f) => L.push(`    ${cppType(f.type)} ${f.name};`));
        const init = fs.filter((f) => CPP_ZERO[canon(f.type)] || isClass(canon(f.type), D)).map((f) => `${f.name}(${CPP_ZERO[canon(f.type)] || 'nullptr'})`);
        L.push('', `    ${n}()${init.length ? ' : ' + init.join(', ') : ''} {}`);
        if (fs.length) L.push(`    ${n}(${fs.map((f) => `${cppType(f.type)} ${f.name}`).join(', ')}) : ${fs.map((f) => `${f.name}(${f.name})`).join(', ')} {}`);
        L.push('};');
        return L.join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'csharp') {
      // public fields, a constructor taking every field and one taking none
      return names.map((n) => {
        const fs = D[n];
        const L = [`public class ${n} {`, ...fs.map((f) => `    public ${csType(f.type)} ${f.name};`), '', `    public ${n}() {}`];
        if (fs.length) L.push(`    public ${n}(${fs.map((f) => `${csType(f.type)} ${f.name}`).join(', ')}) {`, ...fs.map((f) => `        this.${f.name} = ${f.name};`), '    }');
        L.push('}');
        return L.join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'swift') {
      // a class (objects are shared, like Java's), its init taking every field, each with a default: ListNode(1)
      const SWZ = { int: '0', long: '0', double: '0.0', boolean: 'false', char: '" "', string: '""' };
      const dflt = (f) => SWZ[canon(f.type)] || (isClass(canon(f.type), D) ? 'nil' : '[]');
      return names.map((n) => {
        const fs = D[n];
        return [`class ${n} {`, ...fs.map((f) => `    var ${f.name}: ${swiftType(f.type)}`), '',
          `    init(${fs.map((f) => `_ ${f.name}: ${swiftType(f.type)} = ${mapTypes(f.type) ? '[:]' : dflt(f)}`).join(', ')}) {`,
          ...fs.map((f) => `        self.${f.name} = ${f.name}`), '    }', '}'].join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'ruby') {
      // attr_accessor fields, and initialize taking every field, each with a default (a field can be called next)
      const RBZ = { int: '0', long: '0', double: '0.0', boolean: 'false', char: "''" };
      return names.map((n) => {
        const fs = D[n];
        return [`class ${n}`, ...(fs.length ? [`    attr_accessor ${fs.map((f) => ':' + f.name).join(', ')}`, ''] : []),
          `    def initialize(${fs.map((f) => `_${f.name} = ${RBZ[canon(f.type)] || 'nil'}`).join(', ')})`, ...fs.map((f) => `        @${f.name} = _${f.name}`), '    end', 'end'].join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'go') {
      const w = Math.max(0, ...names.flatMap((n) => D[n].map((f) => f.name.length)));
      return names.map((n) => [`type ${n} struct {`, ...D[n].map((f) => `    ${f.name.padEnd(w)} ${goType(f.type)}`), '}'].join('\n')).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'rust') {
      return names.map((n) => {
        const fs = D[n];
        const L = ['#[derive(Debug, Clone, PartialEq)]', `pub struct ${n} {`, ...fs.map((f) => `    pub ${f.name}: ${rustType(f.type)},`), '}'];
        if (!brief) {
          L.push('', `impl ${n} {`, `    pub fn new(${fs.map((f) => `${f.name}: ${rustType(f.type)}`).join(', ')}) -> Self {`, `        ${n} { ${fs.map((f) => f.name).join(', ')} }`, '    }', '}');
        }
        return L.join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'c') {
      return names.map((n) => [`typedef struct ${n} {`,
        ...D[n].map((f) => `    ${isClass(canon(f.type), D) ? `struct ${canon(f.type)}*` : cType(f.type)} ${f.name};`), `} ${n};`].join('\n')).join('\n\n') + (names.length ? '\n' : '');
    }
    if (lang === 'java') {
      return names.map((n) => {
        const fs = D[n];
        const L = [`class ${n} {`];
        fs.forEach((f) => L.push(`    public ${javaType(f.type)} ${f.name};`));
        L.push('', `    public ${n}() {}`, '');
        if (fs.length) {
          L.push(`    public ${n}(${fs.map((f) => `${javaType(f.type)} ${f.name}`).join(', ')}) {`);
          fs.forEach((f) => L.push(`        this.${f.name} = ${f.name};`));
          L.push('    }', '');
        }
        fs.forEach((f) => L.push(`    public ${javaType(f.type)} ${canon(f.type) === 'boolean' ? 'is' : 'get'}${cap(f.name)}() { return ${f.name}; }`));
        const parts = fs.map((f) => `"${f.name}=" + ${/\[\]$/.test(canon(f.type)) ? `java.util.Arrays.${/\[\]\[\]$/.test(canon(f.type)) ? 'deepToString' : 'toString'}(${f.name})` : f.name}`);
        if (brief) { if (L[L.length - 1] === '') L.pop(); L.push('}'); } else L.push('', `    public String toString() { return "${n}(" + ${parts.length ? parts.join(' + ", " + ') : '""'} + ")"; }`, '}');
        return L.join('\n');
      }).join('\n\n') + (names.length ? '\n' : '');
    }
    if (!names.length) return '';
    return (brief ? '' : 'from __future__ import annotations\n\n\n') + names.map((n) => {
      const fs = D[n];
      const L = [`class ${n}:`];
      if (brief) {
        if (fs.length) L.push(`    # ${fs.map((f) => `${f.name}: ${pyType(f.type)}`).join(', ')}`);
        L.push(`    def __init__(self${fs.map((f) => `, ${f.name}=${PY_ZERO[canon(f.type)] || 'None'}`).join('')}):`);
      } else {
        L.push(`    def __init__(self${fs.map((f) => `, ${f.name}: ${pyType(f.type)}${PY_ZERO[canon(f.type)] ? '' : ' | None'} = ${PY_ZERO[canon(f.type)] || 'None'}`).join('')}):`);
      }
      if (!fs.length) L.push('        pass');
      fs.forEach((f) => L.push(`        self.${f.name} = ${f.name}`));
      if (!brief) L.push('', '    def __repr__(self):', `        return f"${n}(${fs.map((f) => `${f.name}={self.${f.name}!r}`).join(', ')})"`);
      return L.join('\n');
    }).join(brief ? '\n\n' : '\n\n\n') + '\n';
  }

  return {
    SCALARS, CLASS, canon, isClass, isValueType, elementType, mapTypes, checkValue, nullable, javaType, pyType, classSource, JAVA_ZERO, HELP, MAX_ITEMS, MAX_DEPTH,
    LANGS, LANG_NAMES, isJs, isC, isNative, hasSpeed, csType, swiftType, rubyType, jsType, tsType, cppType, cppParam, cType, cDims, cSignature, goType, rustType, unsupported, fits, starter, JS_ZERO, CPP_ZERO,
  };
}));
