// Value types for code questions, shared by the server (require) and the quiz maker (window.BQTypes).
//   scalars:  int, long, double, boolean, string, char
//   arrays:   any scalar with [] or [][]          e.g. char[], string[][]
//   lists:    list<int|long|double|boolean|string|char>
//   maps:     map<string|int, V>, V a scalar, list<int> or list<string>
// Values are JSON: a char is a one-letter string; a map is an object whose keys are strings
// (for int keys, strings like "3").
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

  // "map< string , int >" -> "map<string,int>"
  const canon = (t) => String(t == null ? '' : t).replace(/\s+/g, '');
  function mapTypes(t) {
    const m = /^map<(\w+),(.+)>$/.exec(canon(t));
    return m ? [m[1], m[2]] : null;
  }
  function isValueType(t) {
    t = canon(t);
    if (SCALARS.includes(t)) return true;
    const arr = /^(\w+)(\[\]){1,2}$/.exec(t);
    if (arr) return SCALARS.includes(arr[1]);
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return LIST_OF.includes(list[1]);
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
  function checkValue(t, v) {
    t = canon(t);
    if (v === null) return !SCALARS.includes(t) || t === 'string';
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
      return keys.length <= MAX_ITEMS && keys.every((k) => (kv[0] === 'int' ? isIntKey(k) : true) && checkValue(kv[1], v[k]));
    }
    const e = elementType(t);
    if (!e || !Array.isArray(v) || v.length > MAX_ITEMS) return false;
    return v.every((x) => checkValue(e, x));
  }

  const BOX = { int: 'Integer', long: 'Long', double: 'Double', boolean: 'Boolean', string: 'String', char: 'Character' };
  function javaType(t) {
    t = canon(t);
    if (t === 'void') return 'void';
    if (t === 'string') return 'String';
    if (SCALARS.includes(t)) return t;
    if (t.endsWith('[]')) return javaType(t.slice(0, -2)) + '[]';
    const list = /^list<(\w+)>$/.exec(t);
    if (list) return `ArrayList<${BOX[list[1]]}>`;
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
    if (list) return `list[${PY[list[1]]}]`;
    const kv = mapTypes(t);
    if (kv) return `dict[${PY[kv[0]]}, ${pyType(kv[1])}]`;
    return t;
  }
  const HELP = 'int, long, double, boolean, string, char; any of them with [] or [][]; list<...> of them; map<string or int, ...>';

  return { SCALARS, canon, isValueType, elementType, mapTypes, checkValue, javaType, pyType, HELP, MAX_ITEMS };
}));
