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

function cleanView(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    marks: cleanMarks(v.marks),
    q: id(v.q), review: v.review === true, dir: v.dir === true, intro: v.intro === true,
    scroll: num(v.scroll, 0, 1e6) || 0, wscroll: num(v.wscroll, 0, 1e6) || 0,
    w: num(v.w, 200, 8000) || 1280, h: num(v.h, 200, 8000) || 800,
    lang: v.lang === 'java' || v.lang === 'python' ? v.lang : null, nav: v.nav === true, modal: v.modal === true,
  };
}

const isWatched = (runId, now) => now - (watched.get(runId) || 0) < WATCH_MS;

// From a heartbeat. pts are the monitor's [x, y, dt(, 1 for a click)], x and y out of 1000 of the window;
// mouseEnd is how long before the heartbeat the last one was. Returns what the heartbeat answers with.
let swept = 0;
function beat(a, body, pts, now) {
  const v = cleanView(body.view);
  if (v) views.set(a.id, { view: v, at: now });
  // Views of attempts that stopped beating (turned in, reset, closed) go after 2 hours.
  if (now - swept > 10 * 60 * 1000) {
    swept = now;
    for (const [id, x] of views) if (now - x.at > 2 * 3600 * 1000) { views.delete(id); trails.delete(id); }
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

// For the watch page: marks the run watched, and gives the latest screen and the trail after `since`.
function look(a, since, now) {
  watched.set(a.runId, now);
  const v = views.get(a.id) || null;
  return {
    view: v ? v.view : null, viewAt: v ? v.at : null,
    trail: (trails.get(a.id) || []).filter((p) => p[0] > (Number(since) || 0)),
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
}

module.exports = { beat, look, where, forget, isWatched, FAST_BEAT_MS };
