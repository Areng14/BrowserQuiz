// Code questions: the editor, Run examples and their results.

import { BQ, KIND, LANG_NAMES, S, api, cfg } from './state.js';
import { errorText, h } from './dom.js';
import { markIcon } from './theme.js';
import { editorTheme, loadMonaco } from './monaco.js';
import { colorize } from './syntax.js';
import { codeAnswer, serializeAnswers, setAnswer, takeParts } from './answers.js';
import { renderQuestion } from './quiz.js';
import { mdOpts, metaRow, notTabbable, prompt, sharedBlock } from './marks.js';
import { leaveHint, tabOut } from './views.js';
import { holdFocus } from './overlays.js';

function codeView(q) {
  const ans = codeAnswer(q);
  const lang = ans.language;
  const samples = h('ol', { class: 'samples' }, (q.samples || []).map((s) =>
    h('li', {},
      h('pre', { class: 'sample-call' }, h('code', { 'data-lang': lang, text: s.call[lang] })),
      h('div', { class: 'sample-exp' }, 'Returns ', h('code', { 'data-lang': lang, text: s.expected[lang] })))));

  // What this question doesn't allow, for the language in use: it's part of the rules.
  const bans = !q.ban ? [] : Array.isArray(q.ban) ? q.ban : q.ban[lang] || [];
  const banNote = bans.length ? h('p', { class: 'ban-note' }, h('strong', { text: 'Not allowed: ' }),
    bans.map((b, i) => [i ? ', ' : '', h('code', { text: lang === 'cpp' ? b.replace('.', '::') : b })])) : null;
  // Classes the question gives them (Point, Node, ...), in the language they're writing.
  const given = q.given && q.given[lang] ? [h('h2', { class: 'sub', text: 'Classes you can use' }),
    h('div', { class: 'prompt given-code hl-root' }, BQ.md.render('```' + lang + '\n' + q.given[lang] + '```', mdOpts()))] : null;

  let langCtl;
  if (q.languages.length > 1) {
    langCtl = h('select', { class: 'select', 'aria-label': 'Language' },
      q.languages.map((l) => h('option', { value: l, text: LANG_NAMES[l] || l, selected: l === lang })));
    langCtl.addEventListener('change', () => {
      ans.language = langCtl.value;
      setAnswer(q.id, ans);
      renderQuestion();
    });
  } else {
    langCtl = h('span', { class: 'lang-label', text: LANG_NAMES[lang] || lang });
  }

  const runBtn = h('button', { class: 'btn small primary', type: 'button', text: 'Run examples' });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const host = h('div', { class: 'editor-host', 'data-answer-field': true });
  // Back to the starter code, for when the class or method around their code got broken.
  const resetBtn = h('button', { class: 'btn small', type: 'button', text: 'Reset', title: 'Start over from the starter code',
    onclick: () => confirmReset(q, ans, host, resetBtn) });
  runBtn.addEventListener('click', () => runCode(q, runBtn, results));
  runSpot(q, runBtn, results);
  // Written without running, like on paper.
  const runCtl = q.noRun ? h('span', { class: 'kbd-hint', text: 'No running on this one' }) : runBtn;

  const view = h('div', { class: 'qview wide' },
    h('div', { class: 'code-q' },
      h('section', { class: 'code-left', tabindex: '0', 'aria-label': 'Question' },
        metaRow(q, KIND[q.mode] || KIND.method), notTabbable(sharedBlock(q)), prompt(q),
        banNote, given,
        h('h2', { class: 'sub', text: 'Examples' }), samples),
      h('section', { class: 'code-right', 'aria-label': 'Code editor' },
        h('div', { class: 'editor-bar' }, langCtl, h('span', { class: 'spacer' }), h('span', { class: 'kbd-hint', text: leaveHint() }), resetBtn, runCtl),
        host, results)));
  renderResults(q, results);
  mountEditor(q, host, ans);
  return view;
}

const editorFontSize = () => (window.innerWidth >= 2300 ? 18 : window.innerWidth >= 1700 ? 16 : 14);

function mountEditor(q, host, ans) {
  const lang = ans.language;
  if (phoneSized()) { plainEditor(host, ans, lang, q); return; }
  host.append(h('div', { class: 'editor-loading', text: 'Loading editor…' }));
  loadMonaco().then((m) => {
    if (!host.isConnected || S.quiz.questions[S.idx] !== q || ans.language !== lang) return;
    host.replaceChildren();
    const key = q.id + ':' + lang;
    if (!S.models[key] || S.models[key].isDisposed()) S.models[key] = m.editor.createModel(ans.code[lang], lang);
    const editor = m.editor.create(host, {
      model: S.models[key], theme: editorTheme(), automaticLayout: true, readOnly: !!cfg.watch, ariaLabel: `Code answer. Tab indents. ${leaveHint()}.`,
      fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: editorFontSize(), lineHeight: Math.round(editorFontSize() * 1.6),
      tabSize: 4, insertSpaces: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 }, renderLineHighlight: 'line',
      // Suggestions only from words already in the student's own code (their names, keywords they typed).
      // Nothing else: API hints and snippets would be free help on an exam. Tab accepts, Enter is a new line.
      quickSuggestions: { other: true, comments: false, strings: false }, wordBasedSuggestions: 'currentDocument',
      suggestOnTriggerCharacters: false, parameterHints: { enabled: false }, hover: { enabled: false }, snippetSuggestions: 'none',
      acceptSuggestionOnEnter: 'off', tabCompletion: 'off', inlineSuggest: { enabled: false }, suggest: { showWords: true, showSnippets: false },
      // Clipboard and drag rules are enforced by the monitor.
      contextmenu: false, dragAndDrop: false, emptySelectionClipboard: false, links: false,
    });
    S.editor = editor;
    tabOut(host);
    S.errDecor = [];
    markErrorLines(S.results[q.id + ':' + lang]);
    if (S.monitor) {
      S.editorSubs.push(S.monitor.trackEditor(editor, q.id, lang));
      S.monitor.selectionProvider = (target) => {
        if (!target || !target.closest || !target.closest('.monaco-editor')) return '';
        const sel = editor.getSelection();
        return sel ? editor.getModel().getValueInRange(sel) : '';
      };
    }
    S.editorSubs.push(editor.onDidChangeModelContent(() => {
      ans.code[lang] = editor.getValue();
      setAnswer(q.id, ans);
    }));
  }).catch(() => { if (host.isConnected) plainEditor(host, ans, lang, q); });
}
// The app's own dialog, not confirm(): a browser dialog can count as leaving the quiz.
function confirmReset(q, ans, host, opener) {
  if (!S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
  const lang = ans.language;
  const starter = (q.starter && q.starter[lang]) || '';
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(false); opener.focus(); };
  const keep = h('button', { class: 'btn', type: 'button', text: 'Keep my code', onclick: close });
  const reset = h('button', { class: 'btn primary', type: 'button', text: 'Reset', onclick: () => {
    close();
    const ed = S.editor && host.contains(S.editor.getDomNode()) ? S.editor : null;
    if (ed) { // an edit, so Ctrl+Z brings their code back
      ed.pushUndoStop();
      ed.executeEdits('reset', [{ range: ed.getModel().getFullModelRange(), text: starter }]);
      ed.pushUndoStop();
      ed.setPosition({ lineNumber: 1, column: 1 });
      ed.focus();
    } else {
      const ta = host.querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); insertText(ta, starter); }
    }
    ans.code[lang] = starter;
    setAnswer(q.id, ans);
  } });
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'reset-title' },
      h('h2', { id: 'reset-title', text: 'Start over?' }),
      h('p', { text: 'Your code for this question goes back to the starter code. Ctrl+Z undoes it.' }),
      h('div', { class: 'modal-actions' }, keep, reset)));
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  keep.focus();
}
// Moving on from part `n` (and any before it) in a quiz with locked parts.
function confirmFinishParts(n, then) {
  if (!S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
  const opener = document.activeElement;
  let backdrop;
  let release = null;
  const close = () => { backdrop.remove(); release(false); if (opener && opener.isConnected) opener.focus(); };
  const parts = S.parts.filter((p) => p.n > S.locked && p.n <= n);
  const what = parts.length === 1 ? parts[0].title : `${parts.length} parts`;
  const msg = h('p', { class: 'error', role: 'alert' });
  const stay = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
  const move = h('button', { class: 'btn primary', type: 'button', text: 'Move on', onclick: async () => {
    move.disabled = true;
    try {
      if (cfg.preview) S.locked = n;
      else { const r = await api.partDone(n, serializeAnswers()); S.locked = r.locked; takeParts(r.parts); }
      if (S.monitor) S.monitor.answersDirty = false;
    } catch (e) {
      msg.textContent = errorText(e);
      move.disabled = false;
      return;
    }
    backdrop.remove();
    release(false);
    then();
  } });
  backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lock-title' },
      h('h2', { id: 'lock-title', text: `Done with ${what}?` }),
      h('p', { text: "You can't come back to change these answers." }),
      msg,
      h('div', { class: 'modal-actions' }, stay, move)));
  S.el.wrap.append(backdrop);
  release = holdFocus(backdrop, close);
  stay.focus();
}
// Typed through the browser where it can be, so undo works.
function insertText(ta, text) {
  if (document.execCommand && document.execCommand('insertText', false, text)) return;
  ta.setRangeText(text, 0, ta.value.length, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
// A phone held either way: Monaco there takes over swipes, so the page can't scroll past it.
const phoneSized = () => (cfg.watch ? !!S.watchPhone // the student's screen, not the teacher's mouse
  : matchMedia('(pointer: coarse) and (max-width: 600px), (pointer: coarse) and (max-height: 480px)').matches);
// The code box without Monaco: on phones, and if Monaco fails to load.
function plainEditor(host, ans, lang, q) {
  const ta = h('textarea', { class: 'code-fallback', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', maxlength: '50000', 'aria-label': `Code answer. Tab indents. ${leaveHint()}.` });
  tabOut(ta);
  ta.value = ans.code[lang];
  ta.addEventListener('input', () => { ans.code[lang] = ta.value; setAnswer(q.id, ans); });
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
    ans.code[lang] = ta.value;
    setAnswer(q.id, ans);
  });
  host.replaceChildren(ta);
  if (S.monitor) S.editorSubs.push(S.monitor.trackText(ta, q.id, lang)); // the typing replay
}

async function runCode(q, btn, results) {
  if (S.runBusy) return;
  const ans = S.answers[q.id];
  const key = q.id + ':' + ans.language;
  S.runBusy = true;
  btn.disabled = true;
  btn.textContent = 'Running…';
  results.replaceChildren();
  try {
    S.results[key] = await api.run({ questionId: q.id, language: ans.language, code: ans.code[ans.language] });
  } catch (ex) {
    S.results[key] = { status: 'error', message: ex && ex.code === 'too_many' ? 'Wait a few seconds.' : errorText(ex) };
  }
  S.runBusy = false;
  S.runReadyAt = Date.now() + 5000;
  ranInto(q, results, btn);
}

// A run can outlast the question's view: the student goes to another question and comes back while it
// runs. Each view of a question with Run puts its button and results here, and the result goes to
// whichever is on screen when it comes back.
const runSpots = new Map();
function runSpot(q, btn, results) {
  runSpots.set(q.id, { btn, results });
  runCooldown(btn);
}
function ranInto(q, results, btn, lang) {
  const now = runSpots.get(q.id);
  if (now && now.results.isConnected) ({ results, btn } = now);
  if (results.isConnected) renderResults(q, results, lang);
  runCooldown(btn);
}

// One cooldown for the whole quiz (the server limits runs per student, not per question), and one run
// at a time: a button drawn while a run is still going waits for it.
function runCooldown(btn) {
  const tick = (first) => {
    if (!first && !btn.isConnected) return; // the view was closed
    if (S.runBusy) { btn.disabled = true; btn.textContent = 'Running…'; setTimeout(tick, 250); return; }
    const left = Math.ceil(((S.runReadyAt || 0) - Date.now()) / 1000);
    if (left <= 0) { btn.disabled = false; btn.textContent = 'Run examples'; return; }
    btn.disabled = true;
    btn.textContent = `Run again in ${left}s`;
    setTimeout(tick, 250);
  };
  tick(true);
}

// Lines named in compile errors and crash traces get a red highlight in the editor (their own file only,
// not the test harness). They stay until the next Run and move with edits.
function markErrorLines(r) {
  const m = window.monaco;
  if (!S.editor || !m) return;
  const model = S.editor.getModel();
  const lines = new Set();
  const texts = [];
  if (r && (r.status === 'compile_error' || r.status === 'runtime_error')) texts.push(String(r.message || ''));
  if (r && Array.isArray(r.tests)) r.tests.forEach((t) => { if (!t.pass && t.got) texts.push(String(t.got)); });
  for (const text of texts) {
    for (const hit of text.matchAll(/\b(\w+)\.java:(\d+)/g)) if (!/^(BQMain|BQJ)$/.test(hit[1])) lines.add(Number(hit[2]));
    for (const hit of text.matchAll(/File "(?:solution|support)\.py", line (\d+)/g)) lines.add(Number(hit[1]));
    for (const hit of text.matchAll(/\bsolution\.(?:js|ts|c|cpp|go|rs|cs):(?:line )?(\d+)/g)) lines.add(Number(hit[1]));
    for (const hit of text.matchAll(/\bsolution\.cs\((\d+),/g)) lines.add(Number(hit[1]));
  }
  const decor = [...lines].filter((n) => n >= 1 && n <= model.getLineCount()).map((n) => ({
    range: new m.Range(n, 1, n, 1),
    options: { isWholeLine: true, className: 'bq-err-line', linesDecorationsClassName: 'bq-err-gutter', overviewRuler: { color: '#e5534b', position: m.editor.OverviewRulerLane.Full } },
  }));
  S.errDecor = S.editor.deltaDecorations(S.errDecor || [], decor);
}

function renderResults(q, el, langOverride) {
  const lang = langOverride || S.answers[q.id].language;
  const r = S.results[q.id + ':' + lang];
  if (q.type === 'code') markErrorLines(r);
  if (!r) {
    el.replaceChildren();
    return;
  }
  const parts = [];
  if (r.simulated) parts.push(h('p', { class: 'demo-note', text: 'Demo: simulated result.' }));
  if (r.status === 'compile_error') {
    parts.push(h('p', { class: 'res-head bad', text: "Didn't compile" }), h('pre', { class: 'res-pre', text: r.message || '' }));
  } else if (r.status === 'banned') {
    parts.push(h('p', { class: 'res-head bad', text: 'Not allowed' }), h('p', { text: r.message || '' }));
  } else if (r.status === 'runtime_error') {
    parts.push(h('p', { class: 'res-head bad', text: 'Crashed' }), h('pre', { class: 'res-pre', text: r.message || '' }));
  } else if (r.status === 'error') {
    parts.push(h('p', { class: 'res-head bad', text: 'Run failed' }), h('p', { text: r.message || '' }));
  } else {
    const tests = r.tests || [];
    const passed = tests.filter((t) => t.pass).length;
    parts.push(h('p', { class: 'res-head ' + (passed === tests.length ? 'good' : 'bad'), text: `${passed} of ${tests.length} examples passed` }));
    parts.push(h('ul', { class: 'res-tests' }, tests.map((t) => h('li', { class: t.pass ? 'ok' : 'bad' },
      h('span', { class: 'res-mark', role: 'img', 'aria-label': t.pass ? 'Passed' : 'Failed' }, markIcon(t.pass)),
      h('div', { class: 'res-body' },
        h('pre', { class: 'res-call' }, h('code', { 'data-lang': lang, text: t.call })),
        t.pass
          ? (t.expected ? h('div', { class: 'res-detail' }, 'Returns ', h('code', { 'data-lang': lang, text: t.expected })) : null)
          : h('div', { class: 'res-detail' }, 'Expected ', h('code', { 'data-lang': lang, text: t.expected }), ', got ', h('code', { class: 'got', text: t.got })))))));
  }
  if (r.stdout) parts.push(h('p', { class: 'res-sub', text: 'Output' }), h('pre', { class: 'res-pre', text: r.stdout }));
  el.replaceChildren(...parts);
  colorize(el);
}

export { codeView, confirmFinishParts, phoneSized, ranInto, renderResults, runSpot };
