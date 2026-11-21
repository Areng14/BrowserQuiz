// Value types for code questions, shared by the server (require) and the quiz maker (window.BQTypes).
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

  // The declared classes, written out for the harness. Java: public fields (so p.x works), a constructor
  // taking every field in order, a no-argument one, getters and toString. Python: the same fields, every
  // one with a default, so Node(3) works. `brief` is what students read: the same classes without
  // toString/__repr__, and in Python the field types as a comment instead of annotations.
  const JAVA_ZERO = { int: '0', long: '0L', double: '0.0', boolean: 'false', char: "'\\0'" };
  const PY_ZERO = { int: '0', long: '0', double: '0.0', boolean: 'False', char: "''" };
  const cap = (n) => n.charAt(0).toUpperCase() + n.slice(1);
  function classSource(D, lang, brief) {
    const names = Object.keys(D || {});
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

  return { SCALARS, CLASS, canon, isClass, isValueType, elementType, mapTypes, checkValue, nullable, javaType, pyType, classSource, JAVA_ZERO, HELP, MAX_ITEMS, MAX_DEPTH };
}));
