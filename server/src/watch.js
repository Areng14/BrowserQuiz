'use strict';
// Watching a student live (the teacher's Watch button). In memory only, never stored: each attempt's
// latest screen (from its heartbeat) and, while a teacher is watching its run, the last half minute of
// its mouse trail with times.
//
// While any teacher watches anyone in a run, every student in that run is asked for heartbeats every
// second instead of every three. Asking all of them alike means no student can tell they're the one being
// watched.

const KEEP_MS = 30000;
const WATCH_MS = 15000; // a run counts as watched this long after the watch page last asked
const FAST_BEAT_MS = 1000;

const views = new Map(); // attempt id -> { view, at }
// What else the student has on screen that isn't in the view: their sample runs' results (from the run
// route, so the server's own) and their scratchpad pages (from heartbeats). ver goes up on every change.
const extras = new Map(); // attempt id -> { runs: { 'qid:lang': result }, pages: { qid: items }, sizes: { qid: n }, ver }
const trails = new Map(); // attempt id -> [[t, x, y, down]], oldest first
const watched = new Map(); // run id -> when a teacher last watched in it

const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
const id = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);

function cleanMarks(m) {
  if (!m || typeof m !== 'object') return null;
  const review = Array.isArray(m.review) ? m.review.map(id).filter(Boolean).slice(0, 300) : [];
  const out = {};
  if (m.out && typeof m.out === 'object') {
    for (const [k, v] of Object.entries(m.out).slice(0, 300)) {
      if (id(k) && !['__proto__', 'constructor', 'prototype'].includes(k) && Array.isArray(v)) out[k] = v.filter((x) => Number.isInteger(x) && x >= 0 && x < 20).slice(0, 20);
    }
  }
  return { review, out };
}

// Highlights: [start, end) character offsets in each highlighted piece of text (app.js marksIn).
const HL_KEY = /^(prompt|shared):[A-Za-z0-9_-]{1,40}$|^choice:[A-Za-z0-9_-]{1,40}:\d{1,2}$/;
function cleanHl(hl) {
  const out = {};
  if (!hl || typeof hl !== 'object') return out;
  for (const [k, v] of Object.entries(hl).slice(0, 400)) {
    if (!HL_KEY.test(k) || !Array.isArray(v)) continue;
    const r = v.slice(0, 100).filter((x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 0 && x[1] > x[0] && x[1] <= 1e6);
    if (r.length) out[k] = r.map((x) => [x[0], x[1]]);
  }
  return out;
}

// A scratchpad page: strokes { p: [x, y, ...] (out of the board's width), e: true for the eraser } and
// typed notes { x, y, s }.
const fin = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x * 10000) / 10000));
function cleanPage(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const it of items.slice(0, 2000)) {
    if (!it || typeof it !== 'object') continue;
    if (Array.isArray(it.p)) {
      if (it.p.length < 2 || it.p.length > 20000 || !it.p.every(Number.isFinite)) continue;
      const p = it.p.slice(0, it.p.length - (it.p.length % 2)).map((x) => fin(x, -1, 100));
      out.push(it.e ? { p, e: true } : { p });
    } else if (typeof it.s === 'string' && Number.isFinite(it.x) && Number.isFinite(it.y)) {
      out.push({ x: fin(it.x, 0, 1), y: fin(it.y, 0, 100), s: it.s.slice(0, 5000) });
    }
  }
  return out;
}
const PAGE_MAX = 300000; // bytes of one page as JSON
const PAGES_MAX = 1500000; // and of all of an attempt's pages
const RUN_MAX = 200000; // one run's results
const extraOf = (aid) => { let x = extras.get(aid); if (!x) { x = { runs: {}, pages: {}, sizes: {}, ver: 0 }; extras.set(aid, x); } return x; };

// The modals a watch page can show as the student sees them (app.js watchView), by their title's id.
const MODALS = ['submit-title', 'turnin-title', 'exit-title', 'left-title'];

function cleanView(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    marks: cleanMarks(v.marks), hl: cleanHl(v.hl), pad: v.pad === true,
    q: id(v.q), review: v.review === true, dir: v.dir === true, intro: v.intro === true,
    scroll: num(v.scroll, 0, 1e6) || 0, wscroll: num(v.wscroll, 0, 1e6) || 0,
    w: num(v.w, 200, 8000) || 1280, h: num(v.h, 200, 8000) || 800,
    lang: v.lang === 'java' || v.lang === 'python' ? v.lang : null, nav: v.nav === true,
    modal: MODALS.includes(v.modal) ? v.modal : v.modal === true,
  };
}

const isWatched = (runId, now) => now - (watched.get(runId) || 0) < WATCH_MS;

// From a heartbeat. pts are the monitor's [x, y, dt(, 1 for a click)], x and y out of 1000 of the window;
// mouseEnd is how long before the heartbeat the last one was. Returns what the heartbeat answers with.
let swept = 0;
function beat(a, body, pts, now) {
  const v = cleanView(body.view);
  if (v) views.set(a.id, { view: v, at: now });
  // The scratchpad page on screen, sent when it changes
  const page = body.view && body.view.page;
  if (page && typeof page === 'object' && id(page.q)) {
    const items = cleanPage(page.items);
    const x = extraOf(a.id);
    const size = items ? JSON.stringify(items).length : 0;
    const total = Object.values(x.sizes).reduce((n, k) => n + k, 0) - (x.sizes[page.q] || 0) + size;
    if (items && size <= PAGE_MAX && total <= PAGES_MAX) {
      if (items.length) { x.pages[page.q] = items; x.sizes[page.q] = size; } else { delete x.pages[page.q]; delete x.sizes[page.q]; }
      x.ver++;
    }
  }
  // Views of attempts that stopped beating (turned in, reset, closed) go after 2 hours.
  if (now - swept > 10 * 60 * 1000) {
    swept = now;
    for (const [id, x] of views) if (now - x.at > 2 * 3600 * 1000) { views.delete(id); trails.delete(id); extras.delete(id); }
    for (const id of extras.keys()) if (!views.has(id)) extras.delete(id);
  }
  if (!isWatched(a.runId, now)) { trails.delete(a.id); return {}; }
  if (pts.length) {
    // Back from the last sample to place each one in time.
    let t = now - Math.max(0, Math.min(10000, Number(body.mouseEnd) || 0));
    const timed = [];
    for (let k = pts.length - 1; k >= 0; k--) {
      timed.push([t, pts[k][0], pts[k][1], pts[k][3] ? 1 : 0]);
      t -= pts[k][2];
    }
    const list = (trails.get(a.id) || []).concat(timed.reverse()).filter((p) => p[0] > now - KEEP_MS);
    list.sort((x, y) => x[0] - y[0]);
    trails.set(a.id, list.slice(-600));
  }
  return { beatMs: FAST_BEAT_MS };
}

// A sample run's results, as the student got them (student.js /api/run).
function ran(attemptId, key, result) {
  const text = JSON.stringify(result);
  if (!text || text.length > RUN_MAX) return;
  const x = extraOf(attemptId);
  x.runs[key] = JSON.parse(text);
  x.ver++;
}

// For the watch page: marks the run watched, and gives the latest screen, the trail after `since`, and
// the runs and scratchpad when they've changed since the version the page has (`xver`).
function look(a, since, now, xver) {
  watched.set(a.runId, now);
  const v = views.get(a.id) || null;
  const x = extras.get(a.id);
  const ver = x ? String(x.ver) : '0';
  return {
    view: v ? v.view : null, viewAt: v ? v.at : null,
    trail: (trails.get(a.id) || []).filter((p) => p[0] > (Number(since) || 0)),
    xver: ver, extra: x && xver !== ver ? { runs: x.runs, pages: x.pages } : undefined,
  };
}

// What an attempt has on screen now, from its last heartbeat (for the live page's progress), or null.
function where(attemptId) {
  const v = views.get(attemptId);
  return v ? v.view : null;
}

function forget(attemptId) {
  views.delete(attemptId);
  trails.delete(attemptId);
  extras.delete(attemptId);
}

module.exports = { beat, look, ran, where, forget, isWatched, FAST_BEAT_MS };
