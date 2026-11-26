// Saving: the connection, answers and when they reach the server, and the parts with their directions.

import { ERRORS, PARTS, S, api, cfg } from './state.js';
import { announce, h, toast } from './dom.js';
import { svgEl } from './theme.js';
import { screenJoin } from './entry.js';
import { lockOn, renderQuestion } from './quiz.js';
import { toggleScratch } from './scratch.js';
import { renderSheet } from './nav.js';
import { endQuiz, leaveQuiz, showNotice, signedOut } from './overlays.js';

// ---------- connection + save state ----------
function onBeat(res, info) {
  if (!S.el) return;
  if (S.padSending) { S.padSent = S.padSending; S.padSending = null; }
  if (res && res.now) S.skew = res.now - Date.now();
  const resumed = !!S.pausedAt && !!res && !res.paused && !res.done; // the clocks moved on by the time it was paused
  if (res && res.deadline && res.deadline !== S.deadline) { // teacher gave extra time
    if (S.deadline && res.deadline > S.deadline + 30000 && !resumed) toast('Your teacher gave you more time.', 6000);
    S.deadline = res.deadline;
  }
  if (res && res.partEnds) S.partEnds = res.partEnds; // added time moves the parts along too
  if (res && res.done && !S.submitting) return endQuiz('mine'); // the teacher ended this student's quiz
  if (res && (res.paused || 0) !== (S.pausedAt || 0)) setPaused(res.paused || 0);
  if (res && res.held && S.monitor) S.monitor.answersDirty = true; // not taken while paused: they go after
  if (res && res.notice && res.notice.id !== S.noticeId) { S.noticeId = res.notice.id; showNotice(res.notice.text); }
  if (res && res.note && res.note.id !== S.noteId) { S.noteId = res.note.id; showNotice(res.note.text); }
  setOnline(true);
  if (info && info.answers && !res.held && S.saveState === 'saving') setSave('saved');
  if (info && info.answers && !res.held && S.monitor && !S.monitor.answersDirty) clearUnsent(); // the server has them all
}
function onBeatError(err, failures) {
  if (S.done || !S.el) return;
  if (err && err.code === 'run_closed') return endQuiz('ended');
  if (err && err.code === 'no_attempt') return leaveQuiz(signedOut);
  if (err && err.code === 'other_network') return leaveQuiz(() => screenJoin(ERRORS.other_network));
  if (failures >= 2) setOnline(false);
}
function setOnline(ok) {
  if (!S.el || !S.el.conn) return;
  S.el.conn.hidden = ok;
  if (!ok) setSave('offline');
  else if (S.saveState === 'offline') setSave(S.monitor && S.monitor.answersDirty ? 'saving' : 'saved');
}
function setSave(state) {
  if (!S.monitor) return; // preview: nothing is saved
  if (state === S.saveState && S.el && S.el.save && S.el.save.textContent) return;
  S.saveState = state;
  if (!S.el || !S.el.save) return;
  S.el.save.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Not saved yet';
  S.el.save.classList.toggle('bad', state === 'offline');
}

// ---------- answers ----------
function codeAnswer(q) {
  let a = S.answers[q.id];
  if (!a) {
    a = { language: q.languages[0], code: {} };
    for (const l of q.languages) a.code[l] = (q.starter && q.starter[l]) || '';
    S.answers[q.id] = a;
  }
  return a;
}
function restoreAnswers(saved) {
  const out = {};
  for (const q of S.quiz.questions) {
    if (typeof saved[q.id + '~why'] === 'string') out[q.id + '~why'] = saved[q.id + '~why'];
    const v = saved[q.id];
    if (v == null) continue;
    if (q.type === 'code') {
      const a = { language: q.languages.includes(v.language) ? v.language : q.languages[0], code: {} };
      for (const l of q.languages) a.code[l] = (q.starter && q.starter[l]) || '';
      if (typeof v.code === 'string') a.code[a.language] = v.code;
      out[q.id] = a;
    } else {
      out[q.id] = v;
    }
  }
  return out;
}
function serializeAnswers() {
  const out = {};
  for (const q of S.quiz.questions) {
    if (S.answers[q.id + '~why'] != null) out[q.id + '~why'] = S.answers[q.id + '~why']; // corrections: what went wrong
    const a = S.answers[q.id];
    if (a == null) continue;
    out[q.id] = q.type === 'code' ? { language: a.language, code: a.code[a.language] } : a;
  }
  return out;
}
function isAnswered(q) {
  const a = S.answers[q.id];
  if (a == null) return false;
  if (q.type === 'multi') return Array.isArray(a) && a.length > 0;
  if (q.type === 'text' || q.type === 'math') return String(a).trim() !== '';
  if (q.type === 'graph') return Array.isArray(a) && a.length > 0;
  if (q.type === 'code') return (a.code[a.language] || '').trim() !== ((q.starter && q.starter[a.language]) || '').trim();
  if (q.type === 'output' || q.type === 'essay') return String(a).trim() !== '';
  if (q.type === 'fill') return Array.isArray(a) && a.some((x) => String(x || '').trim());
  if (q.type === 'trace') return Array.isArray(a) && a.some((r) => Array.isArray(r) && r.some((x) => String(x || '').trim()));
  return true;
}
function setAnswer(qid, value) {
  if (value === undefined) delete S.answers[qid];
  else S.answers[qid] = value;
  if (S.monitor) S.monitor.markAnswersDirty(String(qid).split('~')[0]);
  keepUnsent();
  if (S.saveState !== 'offline') setSave('saving');
  renderSheet();
}

// ---------- parts + directions ----------
// Back-to-back questions of the same type form a part, unless the teacher divided the quiz into sections:
// each section is a part, whatever its questions' types. Entering a part the first time shows its directions.
// types: each question's type, in order. sections: [{ start, title, directions }] from the server.
function partsFor(types, sections) {
  const starts = new Map((sections || []).map((sec) => [sec.start, sec]));
  const parts = [];
  types.forEach((type, i) => {
    const last = parts[parts.length - 1];
    if (starts.has(i)) parts.push({ type, types: [type], start: i, end: i, section: starts.get(i) });
    else if (last && (last.section || last.type === type)) { last.end = i; if (!last.types.includes(type)) last.types.push(type); }
    else parts.push({ type, types: [type], start: i, end: i });
  });
  let made = 0;
  parts.forEach((p, n) => {
    p.n = n + 1;
    if (p.section) made++;
    p.title = p.section ? p.section.title || `Section ${made}` : (PARTS[p.type] || { title: 'Questions' }).title;
  });
  return parts;
}
function buildParts(questions) {
  const custom = S.quiz.directions || {};
  const parts = partsFor(questions.map((q) => q.type), S.quiz.sections);
  for (const p of parts) {
    // A section's own directions, or else each of its kinds' (the teacher's for that kind, or the built-in).
    const inPart = questions.slice(p.start, p.end + 1);
    const partial = inPart.some((q) => q.type === 'multi') && inPart.every((q) => q.type !== 'multi' || q.partialCredit);
    const textOf = (t) => custom[t] || (t === 'multi' && partial ? 'Each right choice earns credit, and each wrong one takes it back.' : (PARTS[t] || { text: '' }).text);
    if (p.section && p.section.directions) p.md = p.section.directions;
    else if (p.types.length > 1) p.list = p.types.map((t) => [(PARTS[t] || { title: t }).title, textOf(t)]);
    else p.text = textOf(p.type);
  }
  return parts;
}
const partOf = (i) => S.parts.find((p) => i >= p.start && i <= p.end);
const rangeOf = (p) => (p.start === p.end ? `Question ${p.start + 1}` : `Questions ${p.start + 1}-${p.end + 1}`);

// Timed parts: each part has its own clock, one after another (S.partEnds, on the server's clock). The
// student can't move on before a part's time is up; when it is, the part locks and the next one starts.
const timedParts = () => !!(S.partEnds && S.parts && S.parts.length > 1 && S.partEnds.length === S.parts.length);
const timedNav = () => timedParts() && lockOn();
// The server's clock, held where it stopped while the teacher has the quiz paused (S.pausedAt)
const serverNow = () => { const t = Date.now() + (S.skew || 0); return S.pausedAt ? Math.min(t, S.pausedAt) : t; };
// the part whose clock is running (from 1)
function partNow() {
  const over = S.partEnds.filter((e) => e <= serverNow()).length;
  return Math.min(Math.max(over, S.locked || 0) + 1, S.partEnds.length);
}
const partLeft = (n) => Math.max(0, S.partEnds[n - 1] - serverNow());
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
// The next part, locked until this one's time is up (the question list and the review page).
function nextPartRow(withMinutes) {
  if (!timedNav()) return null;
  const n = partNow();
  const next = S.parts[n];
  if (!next) return null;
  const mins = Math.round((S.partEnds[n] - S.partEnds[n - 1]) / 60000); // their own, with extra time
  return h('div', { class: 'next-part' }, lockIcon(),
    h('span', { class: 'np-text' }, h('b', { text: next.title }), ` ${rangeOf(next)}${withMinutes ? ` · ${mins} min` : ''}`),
    h('span', { class: 'np-when' }, 'Opens in ', h('span', { class: 'np-left', 'data-part-left': '', text: mmss(partLeft(n)) })));
}
function lockIcon(size = 18) {
  const s = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }), svgEl('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }));
  return s;
}
// The teacher paused the quiz, or went on (at: when this student's clock stopped, on the server's
// clock, or 0). Paused, every clock holds and the questions are hidden; nothing they do counts.
function setPaused(at) {
  const was = !!S.pausedAt;
  S.pausedAt = at || 0;
  if (!S.el || S.done || S.submitting || was === !!at) return; // turning in: that decides (submitNow)
  if (at) {
    // whatever's open over the quiz waits (the teacher's messages stay)
    for (const b of [...S.el.wrap.querySelectorAll('.modal-backdrop')]) if (b._release && !b.classList.contains('notice-backdrop')) { b.remove(); b._release(false); }
    if (!S.el.scratch.hidden) toggleScratch(false);
  }
  renderQuestion();
  S.el.main.scrollTop = 0;
  if (!cfg.watch) {
    const head = document.getElementById('q-heading');
    if (head && !S.el.wrap.querySelector('.modal-backdrop')) head.focus({ preventScroll: true });
    if (!at) announce('The quiz is back on.');
  }
}
function pausedView() {
  return h('div', { class: 'qview paused-view', role: 'status' },
    h('span', { class: 'paused-mark' }, pauseGlyph(20)),
    h('h1', { id: 'q-heading', tabindex: '-1', text: 'Your teacher paused the quiz' }));
}
function pauseGlyph(size) {
  const s = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' });
  s.append(svgEl('rect', { x: 6, y: 5, width: 4, height: 14, rx: 1 }), svgEl('rect', { x: 14, y: 5, width: 4, height: 14, rx: 1 }));
  return s;
}

// A part's time is up: its last answers go in, it locks, and the next part's directions come up.
async function partTimeUp(done) {
  if (S.moving || S.done || S.submitting || !S.el) return;
  S.moving = true;
  // whatever's open over the quiz (the question list, snake) was for the part that ended
  for (const b of [...S.el.wrap.querySelectorAll('.modal-backdrop')]) if (b._release && !b.classList.contains('notice-backdrop')) { b.remove(); b._release(false); }
  try {
    const r = await api.partDone(done, serializeAnswers());
    S.locked = Math.max(S.locked || 0, r.locked || done);
    if (S.monitor) S.monitor.answersDirty = false;
  } catch (e) {
    S.locked = Math.max(S.locked || 0, done); // offline: the server locks it on time anyway
  }
  S.moving = false;
  const next = S.parts[done];
  if (S.done || !S.el || !next) return;
  S.timeUpFor = done;
  announce(`Time's up for Part ${done}.`);
  S.reviewOpen = false;
  S.idx = next.start;
  S.dirOpen = true;
  renderQuestion();
  S.el.main.scrollTop = 0;
  const head = document.getElementById('q-heading');
  if (head) head.focus({ preventScroll: true });
}

// Answers the server doesn't have yet (offline, or typed in the seconds before a reload or a dead
// battery) stay in this browser until a heartbeat saves them. Back on this page, they're used if they're
// newer than the server's last word from this student (so an older copy here can't undo work done on
// another computer since). Cleared once saved, and on turn-in.
const unsentKey = () => 'bq-unsent:' + [S.run && (S.run.id || S.run.code || S.run.title), S.me && S.me.name, S.tag || ''].join(':');
let unsentTimer = 0;
function keepUnsent() {
  if (cfg.preview || cfg.watch || cfg.demo || !S.monitor) return;
  clearTimeout(unsentTimer);
  unsentTimer = setTimeout(() => {
    try { localStorage.setItem(unsentKey(), JSON.stringify({ at: Date.now() + (S.skew || 0), answers: serializeAnswers() })); } catch (e) { /* kept on the server only */ }
  }, 300);
}
function clearUnsent() {
  clearTimeout(unsentTimer);
  try { localStorage.removeItem(unsentKey()); } catch (e) { /* nothing kept */ }
}
function takeUnsent(savedAt) {
  try {
    const v = JSON.parse(localStorage.getItem(unsentKey()) || 'null');
    if (v && v.answers && typeof v.answers === 'object' && v.at > (savedAt || 0)) return v.answers;
  } catch (e) { /* nothing kept */ }
  return null;
}

export { buildParts, clearUnsent, codeAnswer, isAnswered, lockIcon, mmss, nextPartRow, onBeat, onBeatError, partLeft, partNow, partOf, partTimeUp, partsFor, pausedView, rangeOf, restoreAnswers, serializeAnswers, serverNow, setAnswer, setPaused, takeUnsent, timedNav, timedParts };
