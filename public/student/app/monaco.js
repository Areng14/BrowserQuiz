// Monaco, the code editor (bundled, same origin), loaded when a quiz has a code question. Code that's only
// shown is colored by syntax.js instead.

import { MONACO_V, cfg } from './state.js';
import { h } from './dom.js';
import { isDark } from './theme.js';

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

export { editorTheme, loadMonaco };
