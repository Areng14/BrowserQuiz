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

const writeSync = fs.writeSync;
const quote = JSON.stringify; // only ever on strings, which have no toJSON
const isArray = Array.isArray;
const ownKeys = Object.keys;
const apply = Reflect.apply;
const isFiniteNum = Number.isFinite;
const Str = String;
const mapForEach = Map.prototype.forEach;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
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
  if (msg.length > 500) msg = msg.substring(0, 500);
  return msg + place(e);
}
function fail(out, i, e) { out('{"i":' + i + ',"ok":false,"err":' + quote(message(e)) + '}'); }

// Their file didn't load: a syntax error (with the line and a caret, as Node shows it), or an error at the top level.
function broken(out, e) {
  let st = null;
  try { st = e && typeof e === 'object' ? e.stack : null; } catch (x) { st = null; }
  let msg;
  if (typeof st === 'string' && e instanceof SyntaxError) {
    const lines = st.split('\n');
    const at = lines.findIndex((l) => /^\s+at /.test(l));
    msg = (at < 0 ? lines : lines.slice(0, at)).filter((l, k, a) => l.trim() || (k > 0 && a[k - 1].trim() && !/^\s*\^/.test(a[k - 1]))).join('\n');
  } else msg = message(e);
  out('{"compile":true,"err":' + quote(typeof msg === 'string' ? msg.substring(0, 2000) : 'Crashed') + '}');
}
// What the question asks for and their code doesn't have: [["f", "twoSum(nums, target)"]] or [["c", "Counter", [methods]]].
function missing(out, S, want) {
  const gone = [];
  for (const w of want) {
    const v = S[w[1]];
    if (w[0] === 'f') { if (typeof v !== 'function') gone.push('Missing function ' + w[2]); continue; }
    if (typeof v !== 'function') { gone.push('Missing class ' + w[1]); continue; }
    for (const m of w[2]) {
      let f;
      try { f = v.prototype[m]; } catch (e) { f = null; }
      if (typeof f !== 'function') gone.push(w[1] + ' needs a method ' + m);
    }
  }
  if (gone.length) out('{"compile":true,"err":' + quote(gone.join('\n')) + '}');
  return gone.length > 0;
}

// Big test arguments, made here instead of written out: start, start+step, ... up to (not including) stop.
function range(a, b, s) {
  const n = Math.max(0, s > 0 ? Math.ceil((b - a) / s) : Math.ceil((a - b) / -s));
  const x = new Array(n);
  for (let k = 0; k < n; k++) x[k] = a + k * s;
  return x;
}

module.exports = Object.freeze({ writer, classes, enc, ok, timed, step, done, fail, broken, missing, range, now });
