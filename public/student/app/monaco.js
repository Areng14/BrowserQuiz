// Monaco, the code editor (bundled, same origin), loaded when a quiz has code.

import { MONACO_V, cfg } from './state.js';
import { h } from './dom.js';
import { isDark } from './theme.js';
import { addHighlight, marksIn, rangeAt } from './marks.js';

// ---------- Monaco (bundled, same origin) ----------
let monacoPromise = null;
function editorTheme() { return isDark() ? 'bq-dark' : 'bq-light'; }
function loadMonaco() {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const base = cfg.monacoBase;
    window.MonacoEnvironment = { getWorkerUrl: () => base + 'editor.worker.js' + MONACO_V };
    if (!document.querySelector('link[data-monaco]')) {
      document.head.append(h('link', { rel: 'stylesheet', href: base + 'monaco.css' + MONACO_V, 'data-monaco': true }));
    }
    const s = h('script', { src: base + 'monaco.js' + MONACO_V });
    s.onload = () => {
      const m = window.monaco;
      if (!m) return reject(new Error('monaco missing'));
      // Light: calm, IntelliJ-like. Dark: VS Code's Dark+.
      const control = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw'];
      const rules = (c) => [
        { token: 'keyword', foreground: c.keyword }, { token: 'string', foreground: c.string },
        { token: 'number', foreground: c.number }, { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
        { token: 'type.identifier', foreground: c.type }, { token: 'function', foreground: c.fn },
        { token: 'identifier', foreground: c.ident }, { token: 'annotation', foreground: c.fn },
        ...control.map((k) => ({ token: 'keyword.' + k, foreground: c.control })),
      ];
      m.editor.defineTheme('bq-light', {
        base: 'vs', inherit: true,
        rules: rules({ keyword: '0033b3', control: '0033b3', string: '067d17', number: '1750eb', comment: '6a6f76', type: '7a3e9d', fn: '00627a', ident: '16191d' }),
        colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f5f7', 'editorLineNumber.foreground': '#6b7480' },
      });
      m.editor.defineTheme('bq-dark', {
        base: 'vs-dark', inherit: true,
        rules: rules({ keyword: '569cd6', control: 'c586c0', string: 'ce9178', number: 'b5cea8', comment: '6a9955', type: '4ec9b0', fn: 'dcdcaa', ident: '9cdcfe' }),
        colors: { 'editor.background': '#1b1e23', 'editor.lineHighlightBackground': '#22262c', 'editorLineNumber.foreground': '#8b949e' },
      });
      m.editor.setTheme(editorTheme());
      resolve(m);
    };
    s.onerror = () => reject(new Error('monaco failed to load'));
    document.head.append(s);
  });
  monacoPromise.catch(() => { monacoPromise = null; });
  return monacoPromise;
}

// Syntax-highlight every tagged <code> in scope (prompts, choices, examples, results).
function colorize(scope) {
  const els = scope ? [...scope.querySelectorAll('code[data-lang]:not([data-colored])')] : [];
  if (!els.length) return;
  loadMonaco().then((m) => {
    els.forEach((code) => {
      if (code.hasAttribute('data-colored') || !code.isConnected) return;
      code.setAttribute('data-colored', '');
      const inlineCode = !code.closest('pre');
      const inFill = !!code.closest('.fill-code'); // pieces of code between blanks: stay inline, keep line breaks
      // Coloring rewrites the element from its plain text (the colorizer only reads one text node), so
      // keep the source, and put any highlights back afterwards.
      const hl = marksIn(code);
      if (code.dataset.src == null) code.dataset.src = code.textContent;
      code.textContent = code.dataset.src;
      const endsWithNewline = /\n$/.test(code.textContent);
      m.editor.colorizeElement(code, { theme: editorTheme() }).then(() => {
        if (inlineCode || inFill) {
          // keep inline code inline: unwrap the colorizer's block wrapper (and, for inline code, line breaks)
          code.querySelectorAll('div').forEach((d) => d.replaceWith(...d.childNodes));
          if (inlineCode) code.querySelectorAll('br').forEach((b) => b.remove());
          else if (!endsWithNewline && code.lastChild && code.lastChild.nodeName === 'BR') code.lastChild.remove();
        }
        for (const [a, b, st] of hl) addHighlight(rangeAt(code, a, b), true, st);
      }).catch(() => {});
    });
  }).catch(() => {});
}

export { colorize, editorTheme, loadMonaco };
