'use strict';
// Harness helper for JavaScript and TypeScript: turns return values into JSON lines tagged with a per-run
// marker. The server reads these lines and compares them to the expected values, which never enter the sandbox.
//
// The marker lives only in main.cjs's closure (main.cjs deletes itself first) and in the one writer() makes,
// both made before the student's code loads. Everything here that runs after that was taken when this file
// loaded: student code can patch JSON, Array.prototype or fs, but not the copies below. Values are written
// by hand from the question's types (never JSON.stringify on an object, which would run their toJSON), so
// whatever their objects do, a record says only what their code returned. All of it is strict mode, so a
// student function can't reach these through .caller.
const fs = require('fs');
const { performance } = require('perf_hooks');

const Module = require('module');

const writeSync = fs.writeSync;
const readFileSync = fs.readFileSync;
const quote = JSON.stringify; // only ever on strings, which have no toJSON
const isArray = Array.isArray;
const ownKeys = Object.keys;
const apply = Reflect.apply;
const construct = Reflect.construct;
const isFiniteNum = Number.isFinite;
const Str = String;
const ArrayC = Array;
const MapC = Map;
const SetC = Set;
const mapForEach = Map.prototype.forEach;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
const substring = String.prototype.substring;
const strIndexOf = String.prototype.indexOf;
const strTrim = String.prototype.trim;
const strSplit = String.prototype.split;
const mathMax = Math.max;
const mathCeil = Math.ceil;
const gopd = Object.getOwnPropertyDescriptor;
const defp = Object.defineProperty;
const allKeys = Reflect.ownKeys;
const hasOwn = Object.hasOwn;
const ProxyC = Proxy;
const ErrorC = Error;
const strip = Module.stripTypeScriptTypes;
const now = performance.now.bind(performance);

// The question's classes: { Point: [["x", type], ["y", type]] }, types as below. Set once, before their code.
let CLASSES = Object.create(null);
function classes(c) { CLASSES = c; }

function isMap(v) {
  try { apply(mapSize, v, []); return true; } catch (e) { return false; }
}
function text(v) {
  try { const s = Str(v); return typeof s === 'string' ? s : '?'; } catch (e) { return '?'; }
}
function scalar(v) {
  if (typeof v === 'number') return isFiniteNum(v) ? '' + v : quote('' + v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'bigint') return '' + v;
  return null;
}

// A value as JSON, by its type: { k: "s" } scalar, { k: "a", e } array or list, { k: "m", v } map,
// { k: "c", n } object of a declared class. Something of another shape than the type says is written as
// what it is, so it doesn't match and the student sees what they returned.
function enc(t, v, d) {
  d = d || 0;
  if (v === null || v === undefined) return 'null';
  const s = scalar(v);
  if (s !== null) return s;
  if (d > 400) return '"..."';
  if (typeof v !== 'object') return quote(typeof v === 'function' ? '[Function]' : text(v));
  if (t && t.k === 'c' && CLASSES[t.n]) {
    const fields = CLASSES[t.n];
    let o = '{';
    for (let k = 0; k < fields.length; k++) o += (k ? ',' : '') + quote(fields[k][0]) + ':' + enc(fields[k][1], v[fields[k][0]], d + 1);
    return o + '}';
  }
  if (t && t.k === 'm' && !isArray(v)) {
    let o = '{';
    let first = true;
    const put = (val, key) => { o += (first ? '' : ',') + quote(text(key)) + ':' + enc(t.v, val, d + 1); first = false; };
    if (isMap(v)) apply(mapForEach, v, [put]);
    else { const ks = ownKeys(v); for (let k = 0; k < ks.length; k++) put(v[ks[k]], ks[k]); }
    return o + '}';
  }
  if (isArray(v)) {
    const e = t && t.k === 'a' ? t.e : null;
    let o = '[';
    for (let k = 0; k < v.length; k++) o += (k ? ',' : '') + enc(e, v[k], d + 1);
    return o + ']';
  }
  if (isMap(v)) return enc({ k: 'm', v: null }, v, d);
  if (t === null) { // no type to go by: its own fields
    const ks = ownKeys(v);
    let o = '{';
    for (let k = 0; k < ks.length; k++) o += (k ? ',' : '') + quote(ks[k]) + ':' + enc(null, v[ks[k]], d + 1);
    return o + '}';
  }
  return quote(text(v));
}

function writer(marker) {
  return function out(s) { writeSync(1, marker + s + '\n'); };
}

function ok(out, i, t, v) { out('{"i":' + i + ',"ok":true,"v":' + enc(t, v) + '}'); }
function timed(out, i, s, ms) { out('{"i":' + i + ',"ok":true,"v":' + s + ',"ms":' + ms + '}'); }
function step(out, i, s, t, v) { out('{"i":' + i + ',"s":' + s + ',"v":' + enc(t, v) + '}'); }
function done(out, i) { out('{"i":' + i + ',"ok":true}'); }

// Where in their file an error happened: "solution.js:4".
const PLACE = /solution\.c([jt]s):(\d+)/;
const reExec = RegExp.prototype.exec;
function place(e) {
  let st = null;
  try { st = e && typeof e === 'object' ? e.stack : null; } catch (x) { st = null; }
  if (typeof st !== 'string') return '';
  const m = apply(reExec, PLACE, [st]);
  return m ? ' (solution.' + m[1] + ':' + m[2] + ')' : '';
}
function message(e) {
  let msg;
  try { msg = e && typeof e === 'object' ? text(e.name) + ': ' + text(e.message) : 'Threw ' + text(e); } catch (x) { msg = 'Crashed'; }
  if (typeof msg !== 'string') msg = 'Crashed';
  if (msg.length > 500) msg = apply(substring, msg, [0, 500]);
  return msg + place(e);
}
function fail(out, i, e) { out('{"i":' + i + ',"ok":false,"err":' + quote(message(e)) + '}'); }

// Their file didn't load: a syntax error (with the line and a caret, as Node shows it), or an error at the top level.
function broken(out, e) {
  let st = null;
  try { st = e && typeof e === 'object' ? e.stack : null; } catch (x) { st = null; }
  let msg;
  if (typeof st === 'string' && e instanceof SyntaxError) {
    // the lines before the stack, without blank ones except the one after the caret
    const lines = apply(strSplit, st, ['\n']);
    msg = '';
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      if (apply(reExec, AT, [l])) break;
      const prev = k > 0 ? lines[k - 1] : '';
      if (apply(strTrim, l, []) || (k > 0 && apply(strTrim, prev, []) && !apply(reExec, CARET, [prev]))) msg += (msg ? '\n' : '') + l;
    }
  } else msg = message(e);
  out('{"compile":true,"err":' + quote(typeof msg === 'string' ? apply(substring, msg, [0, 2000]) : 'Crashed') + '}');
}
const AT = /^\s+at /;
const CARET = /^\s*\^/;
// What the question asks for and their code doesn't have: [["f", "twoSum(nums, target)"]] or [["c", "Counter", [methods]]].
function missing(out, S, want) {
  let gone = '';
  const say = (t) => { gone += (gone ? '\n' : '') + t; };
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const v = S[w[1]];
    if (w[0] === 'f') { if (typeof v !== 'function') say('Missing function ' + w[2]); continue; }
    if (typeof v !== 'function') { say('Missing class ' + w[1]); continue; }
    for (let j = 0; j < w[2].length; j++) {
      let f;
      try { f = v.prototype[w[2][j]]; } catch (e) { f = null; }
      if (typeof f !== 'function') say(w[1] + ' needs a method ' + w[2][j]);
    }
  }
  if (gone) out('{"compile":true,"err":' + quote(gone) + '}');
  return gone !== '';
}

// Big test arguments, made here instead of written out: start, start+step, ... up to (not including) stop.
function range(a, b, s) {
  const n = mathMax(0, s > 0 ? mathCeil((b - a) / s) : mathCeil((a - b) / -s));
  const x = new ArrayC(n);
  for (let k = 0; k < n; k++) x[k] = a + k * s;
  return x;
}
// A map test argument: [[key, value], ...].
function map(pairs) {
  const m = new MapC();
  for (let k = 0; k < pairs.length; k++) apply(mapSet, m, [pairs[k][0], pairs[k][1]]);
  return m;
}

// ---------- bans (server/src/bans.js) ----------
// What a question bans, made into tripwires before the student's code loads: each banned builtin (every
// function of that name: Array.prototype.sort, %TypedArray%.prototype.sort, ...) is swapped for one that
// writes a {"ban": entry} record the first time it's called, then does what the builtin does. So a call
// counts however its name was put together (a["so" + "rt"]), and only calls that really happen count. The
// harness itself only uses the copies above, never the tripwires. A fresh set of builtins (vm, a worker,
// another node process, the inspector, process.binding) would have none, so with a ban those are tripwires too
// that also refuse.
const KIN = { sort: ['sort', 'toSorted'] };
const FRESH = ['vm', 'worker_threads', 'child_process', 'cluster', 'inspector', 'inspector/promises', 'repl', 'v8', 'wasi'];
const CAP = /^[A-Z]/;
const reTest = (re, s) => apply(reExec, re, [s]) !== null;

// Where builtins live: the global object, its classes and their prototypes (and those of namespaces like
// Intl), typed arrays' shared ones, and the iterators'.
function roots() {
  const G = globalThis;
  const out = [G];
  const seen = new SetC([G]);
  const add = (o) => { if (o && (typeof o === 'object' || typeof o === 'function') && !apply(setHas, seen, [o])) { apply(setAdd, seen, [o]); out[out.length] = o; } };
  const addClass = (v) => { add(v); if (typeof v === 'function') { const d = gopd(v, 'prototype'); if (d && d.value) add(d.value); } };
  const names = Object.getOwnPropertyNames(G);
  for (let i = 0; i < names.length; i++) {
    if (!reTest(CAP, names[i])) continue;
    const d = gopd(G, names[i]);
    if (!d || !('value' in d)) continue; // lazy getters (fetch, crypto): not loaded for this
    addClass(d.value);
    if (d.value && typeof d.value === 'object') {
      const inner = Object.getOwnPropertyNames(d.value);
      for (let j = 0; j < inner.length; j++) {
        const dd = gopd(d.value, inner[j]);
        if (dd && typeof dd.value === 'function' && reTest(CAP, inner[j])) addClass(dd.value);
      }
    }
  }
  const proto = Object.getPrototypeOf;
  const TA = proto(Int8Array);
  addClass(TA);
  const ai = proto([][Symbol.iterator]());
  add(ai); add(proto(ai));
  add(proto(new MapC()[Symbol.iterator]())); add(proto(new SetC()[Symbol.iterator]())); add(proto(''[Symbol.iterator]()));
  return out;
}
const fnOrAccessor = (d) => d && (typeof d.value === 'function' || typeof d.get === 'function' || typeof d.set === 'function');

// The names a ban entry can be: for the server's check of a question's bans. { methods, classes }.
function catalog() {
  const methods = new SetC();
  const rs = roots();
  for (let i = 0; i < rs.length; i++) {
    const ks = Object.getOwnPropertyNames(rs[i]);
    for (let j = 0; j < ks.length; j++) if (!reTest(CAP, ks[j]) && fnOrAccessor(gopd(rs[i], ks[j]))) apply(setAdd, methods, [ks[j]]);
  }
  const classes = Object.getOwnPropertyNames(globalThis).filter((n) => reTest(CAP, n) && (typeof globalThis[n] === 'function' || (globalThis[n] && typeof globalThis[n] === 'object')));
  return { methods: [...methods], classes };
}

let guarded = false;
// entries: the question's bans for this language; file: the student's file (solution.cjs / solution.cts).
function guard(entries, out, file, ts) {
  if (guarded) return;
  guarded = true;
  let armed = false;
  const said = new SetC();
  const hit = (label) => {
    if (!armed || apply(setHas, said, [label])) return;
    apply(setAdd, said, [label]);
    out('{"ban":' + quote(label) + '}');
  };
  const G = globalThis;
  // what to wrap: object -> key -> labels
  const plan = new MapC();
  const want = (o, k, label) => {
    if (!o || !fnOrAccessor(gopd(o, k))) return;
    let m = apply(mapGet, plan, [o]);
    if (!m) { m = new MapC(); apply(mapSet, plan, [o, m]); }
    let l = apply(mapGet, m, [k]);
    if (!l) { l = []; apply(mapSet, m, [k, l]); }
    l[l.length] = label;
  };
  const value = (o, k) => { const d = o && gopd(o, k); return d && 'value' in d ? d.value : undefined; };
  const rs = roots();
  const classBans = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const dot = apply(strIndexOf, entry, ['.']);
    if (dot > 0) { // Class.method: its own or its prototype's
      const X = value(G, apply(substring, entry, [0, dot]));
      const m = apply(substring, entry, [dot + 1]);
      const names = KIN[m] || [m];
      for (let j = 0; j < names.length; j++) { want(X, names[j], entry); want(value(X, 'prototype'), names[j], entry); }
    } else if (reTest(CAP, entry)) { // a class or namespace: everything it has, and making one
      const X = value(G, entry);
      if (!X) continue;
      const ts2 = [X, value(X, 'prototype')];
      for (let t = 0; t < 2; t++) {
        if (!ts2[t]) continue;
        const ks = allKeys(ts2[t]);
        for (let j = 0; j < ks.length; j++) if (ks[j] !== 'constructor' && ks[j] !== 'prototype') want(ts2[t], ks[j], entry);
      }
      if (typeof X === 'function') classBans[classBans.length] = [entry, X];
    } else { // a method: every builtin one of that name
      const names = KIN[entry] || [entry];
      for (let r = 0; r < rs.length; r++) for (let j = 0; j < names.length; j++) want(rs[r], names[j], entry);
    }
  }
  apply(mapForEach, plan, [(keys, o) => {
    apply(mapForEach, keys, [(labels, k) => {
      const d = gopd(o, k);
      const wrap = (f) => {
        const w = { [typeof k === 'symbol' ? 'x' : k](...args) { for (let i = 0; i < labels.length; i++) hit(labels[i]); return apply(f, this, args); } };
        const fn = w[typeof k === 'symbol' ? 'x' : k];
        try { defp(fn, 'name', { value: f.name }); defp(fn, 'length', { value: f.length }); } catch (e) { /* keep its own */ }
        return fn;
      };
      const nd = { configurable: d.configurable, enumerable: d.enumerable };
      if ('value' in d) { nd.value = wrap(d.value); nd.writable = d.writable; } else { nd.get = d.get && wrap(d.get); nd.set = d.set && wrap(d.set); }
      try { defp(o, k, nd); } catch (e) { /* not ours to change */ }
    }]);
  }]);
  for (let i = 0; i < classBans.length; i++) {
    const [label, X] = classBans[i];
    const P = new ProxyC(X, {
      apply(t, self, args) { hit(label); return apply(t, self, args); },
      construct(t, args, nt) { hit(label); return construct(t, args, nt === P ? t : nt); },
    });
    try { defp(G, label, { value: P }); } catch (e) { /* stays */ }
    const proto = value(X, 'prototype');
    if (proto && value(proto, 'constructor') === X) try { defp(proto, 'constructor', { value: P }); } catch (e) { /* stays */ }
  }
  // the ways to a fresh set of builtins
  const refuse = (label) => function () { hit(label); throw new ErrorC(label + " can't be used in this question"); };
  for (let i = 0; i < FRESH.length; i++) {
    let mod;
    try { mod = require(FRESH[i]); } catch (e) { continue; }
    const ks = allKeys(mod);
    for (let j = 0; j < ks.length; j++) {
      const d = gopd(mod, ks[j]);
      if (d && typeof d.value === 'function' && (d.writable || d.configurable)) try { defp(mod, ks[j], { value: refuse(FRESH[i]), writable: d.writable, configurable: d.configurable, enumerable: d.enumerable }); } catch (e) { /* stays */ }
    }
  }
  for (const k of ['register', 'registerHooks']) if (typeof Module[k] === 'function') Module[k] = refuse('module.' + k);
  for (const k of ['binding', '_linkedBinding', 'dlopen']) if (typeof process[k] === 'function') process[k] = refuse('process.' + k);
  // Armed as their file starts. TypeScript's types are taken out first, and Node reads the source map that
  // keeps its line numbers as it compiles: that code isn't theirs, so there the first statement arms them
  // (put on their first line, after any "use strict", so line numbers stay theirs; gone before their code runs).
  const ext = Module._extensions;
  const key = ts ? '.cts' : '.cjs';
  const had = hasOwn(ext, key);
  const before = ext[key];
  ext[key] = function (m, filename) {
    if (had) ext[key] = before; else delete ext[key];
    if (apply(substring, filename, [filename.length - file.length - 1]) !== '/' + file) throw new ErrorC('not the solution');
    let code = readFileSync(filename, 'utf8');
    if (ts) {
      code = strip(code, { mode: 'transform', sourceMap: true, sourceUrl: filename });
      process.setSourceMapsEnabled(true);
      defp(G, '__bqArm', { value: () => { delete G.__bqArm; armed = true; }, configurable: true });
      const lead = /^(?:\s*(?:(['"])use strict\1\s*;?))?/.exec(code)[0];
      code = lead + 'globalThis.__bqArm();' + code.slice(lead.length);
    } else armed = true;
    m._compile(code, filename, 'commonjs');
  };
}

module.exports = Object.freeze({ writer, classes, enc, ok, timed, step, done, fail, broken, missing, range, map, now, guard, catalog });
