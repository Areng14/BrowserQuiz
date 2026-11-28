// The questions: multiple choice and short answer, predict the output, trace tables, fill in the blanks,
// written answers.

import { KIND, S, api } from './state.js';
import { errorText, h } from './dom.js';
import { setAnswer } from './answers.js';
import { choiceText, isCrossed, kept, metaRow, prompt, setCrossed } from './marks.js';
import { ranInto, renderResults, runSpot } from './code.js';

function basicView(q) {
  const view = h('div', { class: 'qview' }, metaRow(q, KIND[q.type] || 'Question'), prompt(q));
  if (q.type === 'single' || q.type === 'multi') {
    const multi = q.type === 'multi';
    const cur = S.answers[q.id];
    const list = h('div', { class: 'choices', role: multi ? 'group' : 'radiogroup', 'aria-label': 'Answer choices' });
    // Selecting text in a choice (to highlight it) shouldn't also pick that choice. Only a selection made
    // by this press counts: one left over from before (an exam stops a click on the frame from clearing
    // it) is dropped, and the click picks the choice.
    let before = '';
    list.addEventListener('pointerdown', () => { const sel = window.getSelection(); before = sel ? sel.toString() : ''; }, true);
    list.addEventListener('click', (e) => {
      const sel = window.getSelection();
      const label = e.target.closest && e.target.closest('label.choice');
      if (!label || !sel || sel.isCollapsed || !label.contains(sel.anchorNode)) return;
      const now = sel.toString();
      if (now !== before && now.trim().length > 1) e.preventDefault();
      else sel.removeAllRanges();
    }, true);
    const picked = (i) => (multi ? Array.isArray(S.answers[q.id]) && S.answers[q.id].includes(i) : S.answers[q.id] === i);
    const rows = q.choices.map((c, i) => {
      const id = `${q.id}-c${i}`;
      const input = h('input', {
        type: multi ? 'checkbox' : 'radio', name: q.id, id, value: i,
        checked: multi ? Array.isArray(cur) && cur.includes(i) : cur === i,
      });
      // Crossing out: picking a crossed-out choice brings it back, and crossing out the picked one unpicks it.
      const x = h('button', { class: 'choice-x', type: 'button' });
      const outNote = h('span', { class: 'sr-only', id: `${id}-out`, text: 'crossed out' });
      const row = h('div', { class: 'choice-row' },
        h('label', { class: 'choice', for: id }, input, kept(`choice:${q.id}:${i}`, () => choiceText(c)), outNote), x);
      input.addEventListener('change', () => {
        if (input.checked && isCrossed(q, i)) setCrossed(q, i, false);
        if (!multi) setAnswer(q.id, i);
        else {
          const set = new Set(Array.isArray(S.answers[q.id]) ? S.answers[q.id] : []);
          if (input.checked) set.add(i); else set.delete(i);
          setAnswer(q.id, set.size ? [...set].sort((a, b) => a - b) : undefined);
        }
        paint();
      });
      x.addEventListener('click', () => {
        const on = !isCrossed(q, i);
        setCrossed(q, i, on);
        if (on && picked(i)) {
          const rest = multi ? S.answers[q.id].filter((v) => v !== i) : [];
          setAnswer(q.id, rest.length ? rest : undefined);
        }
        paint();
      });
      list.append(row);
      return { row, input, x, i };
    });
    const paint = () => rows.forEach(({ row, input, x, i }) => {
      const out = isCrossed(q, i);
      row.classList.toggle('crossed', out);
      if (out) input.setAttribute('aria-describedby', `${input.id}-out`); else input.removeAttribute('aria-describedby');
      input.checked = picked(i);
      x.setAttribute('aria-pressed', String(out));
      x.setAttribute('aria-label', `${out ? 'Undo cross out' : 'Cross out'} choice ${i + 1}`);
      x.title = out ? '' : i < 9 ? `Cross out (Shift+${i + 1})` : 'Cross out';
      x.replaceChildren(out ? 'Undo' : h('span', { class: 'x-icon', text: 'abc' }));
    });
    paint();
    view.append(list);
  } else if (q.type === 'text') {
    const input = h('input', { class: 'input text-answer', id: q.id + '-text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', maxlength: '500' });
    input.value = S.answers[q.id] || '';
    input.addEventListener('input', () => setAnswer(q.id, input.value.trim() ? input.value : undefined));
    view.append(h('label', { class: 'field', for: q.id + '-text' }, h('span', { class: 'field-label', text: 'Your answer' }), input));
  }
  return view;
}

// ---------- predict the output, trace tables, fill in the blanks, written answers ----------
const codeBlock = (code, lang) => h('pre', { class: 'md-code' }, h('code', { 'data-lang': lang || (S.quiz.language !== 'none' ? S.quiz.language : null), text: code }));
// A textarea that grows with what's typed; Tab indents when it holds code.
// The next (dir 1) or previous (dir -1) thing Tab would reach outside box.
function focusBeyond(box, dir) {
  const all = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && !box.contains(el) && !el.closest('[inert]') && el.getClientRects().length);
  const after = (el) => box.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
  const target = dir > 0 ? all.find(after) : all.filter((el) => !after(el)).pop();
  if (target) target.focus();
}
// In code boxes Tab indents, so it can't also move on. Esc, then Tab (or Shift+Tab), leaves the box.
// Where Esc would take the page out of fullscreen (a browser that can't hold the key), Ctrl+M does it.
const escSafe = () => !document.fullscreenElement || !!(navigator.keyboard && navigator.keyboard.lock);
const leaveHint = () => `${escSafe() ? 'Esc' : 'Ctrl+M'}, then Tab, leaves the box`;
function tabOut(box) {
  let armed = false;
  box.addEventListener('keydown', (e) => {
    const ctrlM = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'm';
    if (ctrlM || (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      if (ctrlM) { e.preventDefault(); e.stopPropagation(); }
      armed = true;
      return;
    }
    if (e.key === 'Tab' && armed && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      armed = false;
      focusBeyond(box, e.shiftKey ? -1 : 1);
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) armed = false;
  }, true);
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) armed = false; });
}

function whyBox(q) {
  const id = q.id + '-why';
  const ta = growArea({ id, rows: 3 }, S.answers[q.id + '~why'], (v) => setAnswer(q.id + '~why', v.trim() ? v : undefined));
  return h('div', { class: 'why-box' }, h('label', { class: 'sub', for: id, text: 'What went wrong?' }), ta);
}
function growArea(attrs, value, onChange, codeLike) {
  // Phones would capitalize or curl quotes in code-like answers, which changes what gets graded.
  const ta = h('textarea', Object.assign({ class: 'input long-answer' + (codeLike ? ' mono' : ''), spellcheck: codeLike ? 'false' : 'true', autocomplete: 'off' }, codeLike ? { autocapitalize: 'off', autocorrect: 'off' } : {}, attrs));
  ta.value = value || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 96) + 'px'; };
  ta.addEventListener('input', () => { grow(); onChange(ta.value); });
  if (codeLike) {
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.shiftKey) return;
      e.preventDefault();
      ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
      onChange(ta.value);
    });
    tabOut(ta);
    const hintId = `${ta.id || 'ta'}-tab-hint`;
    const note = h('span', { class: 'sr-only', id: hintId, text: `Tab indents. ${leaveHint()}.` });
    ta.setAttribute('aria-describedby', hintId);
    requestAnimationFrame(() => { if (ta.isConnected && !note.isConnected) ta.after(note); });
  }
  requestAnimationFrame(grow);
  return ta;
}

function outputView(q) {
  const ta = growArea({ id: q.id + '-out', rows: 4 }, S.answers[q.id], (v) => setAnswer(q.id, v.trim() ? v : undefined), true);
  return h('div', { class: 'qview' }, metaRow(q, KIND.output), prompt(q), codeBlock(q.code, q.codeLang),
    h('label', { class: 'field', for: q.id + '-out' }, h('span', { class: 'field-label', text: 'Output' }), ta));
}

function traceView(q) {
  const blank = () => q.cells.map((r) => r.map(() => ''));
  const cur = S.answers[q.id] || blank();
  const table = h('table', { class: 'trace', 'aria-label': 'Trace table' });
  table.append(h('thead', {}, h('tr', {}, q.columns.map((c) => h('th', { scope: 'col', text: c })))),
    h('tbody', {}, q.cells.map((row, r) => h('tr', {}, row.map((given, c) => {
      if (given != null) return h('td', { class: 'given', text: given });
      const input = h('input', { class: 'trace-cell', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': `${q.columns[c]}, row ${r + 1}`, 'data-r': r, 'data-c': c });
      input.value = (cur[r] && cur[r][c]) || '';
      input.addEventListener('input', () => {
        const v = (S.answers[q.id] || blank()).map((rr) => rr.slice());
        v[r][c] = input.value;
        setAnswer(q.id, v.some((rr) => rr.some((x) => x.trim())) ? v : undefined);
      });
      // Enter goes down the column, like a spreadsheet.
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = table.querySelector(`input[data-r="${r + 1}"][data-c="${c}"]`) || table.querySelector(`input[data-r="0"][data-c="${c + 1}"]`);
        if (next) next.focus();
      });
      return h('td', {}, input);
    })))));
  return h('div', { class: 'qview' }, metaRow(q, KIND.trace), prompt(q), q.code ? codeBlock(q.code, q.codeLang) : null,
    h('div', { class: 'trace-wrap' }, table));
}

function fillView(q) {
  const cur = S.answers[q.id] || [];
  const pre = h('pre', { class: 'md-code fill-code' });
  const inputs = [];
  const pieces = q.code.split(/_{3,}/);
  pieces.forEach((seg, i) => {
    if (seg) pre.append(h('code', { 'data-lang': q.codeLang, text: seg }));
    if (i === pieces.length - 1) return;
    const input = h('input', { class: 'blank', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': `Blank ${i + 1}` });
    input.value = cur[i] || '';
    const size = () => { input.style.width = Math.max(6, input.value.length + 2) + 'ch'; };
    size();
    input.addEventListener('input', () => {
      size();
      const v = inputs.map((x) => x.value);
      setAnswer(q.id, v.some((x) => x.trim()) ? v : undefined);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) next.focus();
    });
    inputs.push(input);
    pre.append(input);
  });
  const view = h('div', { class: 'qview' }, metaRow(q, KIND.fill), prompt(q), pre);
  if (q.run) {
    const results = h('div', { class: 'results fill-results', 'aria-live': 'polite' });
    const runBtn = h('button', { class: 'btn small primary', type: 'button', text: 'Run examples' });
    runBtn.addEventListener('click', () => runFill(q, runBtn, results));
    runSpot(q, runBtn, results);
    view.append(h('div', {}, runBtn), results);
    renderResults(q, results, q.codeLang);
  }
  return view;
}
async function runFill(q, btn, results) {
  if (S.runBusy) return;
  S.runBusy = true;
  btn.disabled = true;
  btn.textContent = 'Running…';
  const key = q.id + ':' + q.codeLang;
  try {
    S.results[key] = await api.run({ questionId: q.id, language: q.codeLang, blanks: S.answers[q.id] || [] });
  } catch (ex) {
    S.results[key] = { status: 'error', message: ex && ex.code === 'too_many' ? 'Wait a few seconds.' : errorText(ex) };
  }
  S.runBusy = false;
  S.runReadyAt = Date.now() + 5000;
  ranInto(q, results, btn, q.codeLang);
}

function essayView(q) {
  const ta = growArea({ id: q.id + '-essay', rows: 8 }, S.answers[q.id], (v) => setAnswer(q.id, v.trim() ? v : undefined), !!q.codeLang);
  return h('div', { class: 'qview' }, metaRow(q, KIND.essay), prompt(q),
    h('label', { class: 'field', for: q.id + '-essay' }, h('span', { class: 'field-label', text: 'Your answer' }), ta));
}

export { basicView, essayView, fillView, leaveHint, outputView, tabOut, traceView, whyBox };
