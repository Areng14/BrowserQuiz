// A short answer question's accepted answers: one box each, and Try an answer beside them, which checks
// what a student might write the way grading does (server: grade.js textMatches) so the teacher can trust
// the key before anyone takes the quiz.

import { ICONS, h, icon } from '../dash/core.js';
import { check, touch } from './core.js';
import { firstRow } from './prompt.js';

// ---------- matching, as grade.js does it ----------
const norm = (s, cs) => { const t = String(s).trim().replace(/\s+/g, ' '); return cs ? t : t.toLowerCase(); };
const NUM = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const FRAC = /^([+-]?\d+)\s*\/\s*(\d+)$/;
const asNumber = (s) => { if (NUM.test(s)) return Number(s); const f = FRAC.exec(s); return f && Number(f[2]) ? Number(f[1]) / Number(f[2]) : null; };
const isPattern = (x) => /^\/.+\/$/s.test(String(x).trim());
// The accepted answer a student's answer counts as, or null. A pattern that doesn't read never matches.
function matchOf(q, a) {
  const got = norm(a, q.caseSensitive).replace(/[.!;]+$/, '');
  if (!got) return null;
  const gotNum = asNumber(got);
  return q.answer.find((x) => {
    if (!String(x).trim()) return false;
    if (isPattern(x)) { try { return new RegExp(String(x).trim().slice(1, -1), q.caseSensitive ? '' : 'i').test(got); } catch (e) { return false; } }
    const want = norm(x, q.caseSensitive).replace(/[.!;]+$/, '');
    if (want === got) return true;
    const wantNum = asNumber(want);
    return wantNum != null && gotNum != null && Math.abs(wantNum - gotNum) <= 1e-9 * Math.max(1, Math.abs(wantNum));
  }) ?? null;
}
const badPattern = (x) => { if (!isPattern(x)) return false; try { new RegExp(String(x).trim().slice(1, -1)); return false; } catch (e) { return true; } };

// ---------- the editor ----------
const tried = new WeakMap(); // question -> what was tried, newest first (kept while the maker is open)
function acceptedEditor(q, redraw) {
  if (!Array.isArray(q.answer) || !q.answer.length) q.answer = [''];
  // with random values, answers are checked as the first row makes them
  const key = () => (Array.isArray(q.vars) && q.vars[0] ? firstRow({ answer: q.answer, caseSensitive: q.caseSensitive }, q.vars[0]) : q);
  const list = h('div', { class: 'qe-acc-list' });
  const focusRow = (k) => { const el = list.querySelectorAll('input')[k]; if (el) el.focus(); };
  const rowFor = (k) => {
    const el = h('input', { class: `input${isPattern(q.answer[k]) ? ' qe-mono' : ''}`, value: q.answer[k], 'aria-label': `Accepted answer ${k + 1}`, spellcheck: 'false', autocomplete: 'off', placeholder: k ? '' : 'binary search' });
    const why = h('span', { class: 't-error t-small', role: 'alert' });
    const mark = () => { el.classList.toggle('qe-mono', isPattern(el.value)); why.textContent = badPattern(el.value) ? "This pattern doesn't read as a regex." : ''; };
    mark();
    el.addEventListener('input', () => { q.answer[k] = el.value; mark(); touch(q); tryIt(); });
    el.addEventListener('keydown', (e) => {
      // Enter adds the next answer, as choices do; Backspace in an empty one takes it away
      if (e.key === 'Enter') { e.preventDefault(); q.answer.splice(k + 1, 0, ''); touch(q); draw(); focusRow(k + 1); }
      else if (e.key === 'Backspace' && !el.value && q.answer.length > 1) { e.preventDefault(); q.answer.splice(k, 1); touch(q); draw(); focusRow(Math.max(0, k - 1)); }
    });
    const x = h('button', { class: 'btn small qe-x', type: 'button', 'aria-label': `Remove accepted answer ${k + 1}`, title: 'Remove', disabled: q.answer.length < 2,
      onclick: () => { q.answer.splice(k, 1); touch(q); draw(); focusRow(Math.min(k, q.answer.length - 1)); } }, icon(ICONS.x, 16));
    return h('div', { class: 'qe-acc-row' }, h('div', { class: 'qe-acc-line' }, el, x), why);
  };
  const draw = () => { list.replaceChildren(...q.answer.map((_, k) => rowFor(k))); tryIt(); };
  const add = h('button', { class: 'btn small t-ib', type: 'button', onclick: () => { q.answer.push(''); touch(q); draw(); focusRow(q.answer.length - 1); } }, icon(ICONS.plus, 16), 'Add answer');
  const caps = check(q, q.caseSensitive, 'Capital letters count', (v) => { if (v) q.caseSensitive = true; else delete q.caseSensitive; tryIt(); });

  // Try an answer: checked as it's typed; Enter keeps it in the list under it, checked again as the key changes
  const box = h('input', { class: 'input', id: `qe-try-${q.id}`, autocomplete: 'off', spellcheck: 'false', placeholder: 'What a student might write' });
  const result = h('div', { class: 'qe-try-result', role: 'status' });
  const past = h('ul', { class: 'qe-try-list' });
  const verdict = (text) => {
    const m = matchOf(key(), text);
    return m != null ? { ok: true, by: String(m).trim() } : { ok: false };
  };
  function tryIt() {
    const v = box.value;
    if (!v.trim()) result.replaceChildren();
    else {
      const r = verdict(v);
      result.className = `qe-try-result ${r.ok ? 'qe-try-ok' : 'qe-try-no'}`;
      result.replaceChildren(icon(r.ok ? ICONS.check : ICONS.x, 18), r.ok ? 'Accepted' : 'Not accepted', r.ok ? h('span', { class: 'qe-try-by', text: `as ${r.by}` }) : null);
    }
    const list2 = tried.get(q) || [];
    past.hidden = !list2.length;
    past.replaceChildren(...list2.map((t) => {
      const r = verdict(t);
      return h('li', { class: r.ok ? 'qe-try-ok' : 'qe-try-no' }, h('span', { class: 'qe-try-text', text: t }),
        h('span', { class: 'qe-try-mark' }, icon(r.ok ? ICONS.check : ICONS.x, 14), r.ok ? r.by : 'Not accepted'));
    }));
  }
  box.addEventListener('input', tryIt);
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !box.value.trim()) return;
    e.preventDefault();
    const list2 = [box.value, ...(tried.get(q) || []).filter((t) => t !== box.value)].slice(0, 8);
    tried.set(q, list2);
    box.value = '';
    tryIt();
  });
  draw();
  return h('div', { class: 'qe-acc' },
    h('div', { class: 'qe-acc-side' }, h('h2', { class: 'qe-card-title', text: 'Accepted answers' }), list, h('div', { class: 'qe-line' }, add, caps)),
    h('div', { class: 'qe-acc-side' }, h('h2', { class: 'qe-card-title' }, h('label', { for: box.id, text: 'Try an answer' })), box, result, past));
}

export { acceptedEditor, matchOf };
