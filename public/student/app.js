// BrowserQuiz student app: join → type your name → wait for admit → rules → fullscreen quiz → submitted.
// The student never learns anything about integrity from this UI. The server keeps all of that.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});
  const cfg = Object.assign({ demo: false, monacoBase: '/vendor/monaco/' }, window.BQ_CONFIG || {});

  const CODE_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
  const LANG_NAMES = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust' };
  const THEME_KEY = 'bq-theme';
  const KIND = {
    single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', method: 'Write a method', class: 'Write a class',
    output: 'Predict the output', trace: 'Trace table', fill: 'Fill in the blanks', essay: 'Written answer',
  };
  // Default directions per part, AP style. A quiz can override any of them with quiz.directions[type].
  const PARTS = {
    single: { title: 'Multiple choice', text: 'Pick the one best answer. Blank answers earn no credit.' },
    multi: { title: 'Select all that apply', text: 'Credit only if you select every correct answer and no wrong ones.' },
    text: { title: 'Short answer', text: "Spelling counts. Capital letters and extra spaces don't." },
    code: { title: 'Free response', text: "Assume needed imports are there and inputs match the question. Partial credit is possible." },
    output: { title: 'Predict the output', text: 'Type exactly what the code prints, one line per line of output.' },
    trace: { title: 'Trace tables', text: 'Fill in each value as the code runs. Each correct cell earns credit.' },
    fill: { title: 'Fill in the blanks', text: 'Fill in each blank so the code works. Partial credit is possible.' },
    essay: { title: 'Written answers', text: 'Your teacher grades these.' },
  };
  const ERRORS = {
    nothing_to_correct: 'Nothing to correct.',
    bad_code: 'No open quiz with that code.',
    run_closed: 'This quiz is closed.',
    wrong_network: 'This quiz only opens from the school network.',
    other_network: 'This quiz is locked to the network you started it on. Ask your teacher.',
    too_many: 'Too many tries. Wait a minute.',
    bad_id: 'Wrong student ID for that name.',
    name_locked: 'Too many wrong IDs. Wait 30 seconds.',
    already_started: 'Already started on another computer. Ask your teacher.',
    network: "Can't reach the server.",
    no_attempt: 'Signed out. Sign in again.',
    not_admitted: 'Your teacher has to let you in first.',
    teacher_login: 'Sign in on the teacher page first.',
    locked: 'Your teacher needs to sign in to BrowserQuiz first. Try again in a minute.',
    seb_required: 'Open this quiz in Safe Exam Browser. Your teacher has the file that starts it.',
    seb_launch: 'This quiz opens in Safe Exam Browser.',
  };

  let api;
  let root;
  let S;
  let keysBound = false;

  function freshState() {
    return {
      run: null, me: null, quiz: null, idx: 0, answers: {}, deadline: 0, skew: 0,
      monitor: null, models: {}, editor: null, editorSubs: [], parts: [], partsSeen: new Set(), locked: 0, dirOpen: false,
      timer: 0, poll: 0, done: false, runBusy: false, results: {}, el: null, warned: {}, saveState: 'saved',
      marks: null, kept: new Map(),
    };
  }

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : String(kid));
    }
    return el;
  }
  const errorText = (e) => ERRORS[e && e.code] || ERRORS.network;
  // A new screen: the tab title says what it is, and reading starts at its heading unless the screen
  // put focus in a field itself.
  const mount = (node) => {
    root.replaceChildren(node);
    const head = node.querySelector && node.querySelector('h1');
    if (head) document.title = `${head.textContent} – BrowserQuiz`;
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!head || !head.isConnected || (a && a !== document.body && root.contains(a))) return;
      head.tabIndex = -1;
      head.focus({ preventScroll: true });
    });
  };
  const demoHint = (...kids) => (cfg.demo ? h('p', { class: 'demo-hint' }, ...kids) : null);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Screen readers hear it through the quiz's live region, which is always on the page; a status element
  // added already filled often isn't read.
  function announce(msg) {
    const el = S.el && S.el.live;
    if (!el || !el.isConnected) return false;
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 50);
    return true;
  }
  function toast(msg, ms) {
    const host = (S.el && S.el.wrap) || root;
    let t = host.querySelector('.toast');
    if (!t) {
      t = h('div', { class: 'toast' });
      host.append(t);
    }
    if (!announce(msg)) t.setAttribute('role', 'status');
    t.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.remove(), ms || 2600);
  }

  let keysHeld = false;
  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // Hold Escape (so it can't drop out of fullscreen by accident), and the keys that switch windows:
      // Tab for Alt+Tab and Ctrl+Tab, and the Windows key, which sits where a stray finger opens the Start
      // menu. The page gets them instead (monitor.js). Holding Escape for two seconds still exits.
      keysHeld = false;
      if (navigator.keyboard && navigator.keyboard.lock) {
        navigator.keyboard.lock(['Escape', 'Tab', 'MetaLeft', 'MetaRight']).then(() => { keysHeld = true; }).catch(() => {});
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function exitFullscreen() {
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    keysHeld = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // The page itself never scrolls (index.html): if something nudges it anyway (find in page, a field
  // brought into view, the browser putting back an old scroll), the bars would end up off the edge. Put it
  // back. Not on phones, where the keyboard moves the page to show the field being typed in.
  if (window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, { passive: true });
  }

  // ---------- light / dark ----------
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t === 'dark';
    return darkQuery.matches;
  }
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch (e) { /* storage blocked: follow the system */ }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
  function themeIcon(sun) {
    const s = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    if (sun) {
      s.append(svgEl('circle', { cx: 12, cy: 12, r: 4 }), svgEl('path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' }));
    } else {
      s.append(svgEl('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }));
    }
    return s;
  }
  function penIcon() {
    const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.append(svgEl('path', { d: 'M12 20h9' }), svgEl('path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z' }));
    return s;
  }
  // A pass/fail mark as a drawn icon, so phones don't swap in their own emoji.
  function markIcon(pass) {
    const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.append(svgEl('path', { d: pass ? 'M20 6L9 17l-5-5' : 'M18 6L6 18M6 6l12 12' }));
    return s;
  }
  function paintThemeButton(b) {
    const dark = isDark();
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.replaceChildren(themeIcon(dark));
  }
  function themeButton() {
    const b = h('button', { type: 'button', class: 'theme-btn' });
    paintThemeButton(b);
    b.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered, still switched */ }
      onThemeChange();
    });
    return b;
  }
  function onThemeChange() {
    if (root) root.querySelectorAll('.theme-btn').forEach(paintThemeButton);
    if (window.monaco) window.monaco.editor.setTheme(editorTheme());
    // Colored code keeps the old theme's color classes, which point at the wrong colors after a switch.
    // Redraw it: the question on screen, or any other colored blocks.
    if (S && S.kept) for (const n of S.kept.values()) n.querySelectorAll('code[data-colored]').forEach((c) => c.removeAttribute('data-colored'));
    if (S && S.el && S.quiz && !S.done) renderQuestion();
    else if (root) {
      root.querySelectorAll('code[data-colored]').forEach((c) => { c.textContent = c.textContent; c.removeAttribute('data-colored'); });
      colorize(root);
    }
  }
  darkQuery.addEventListener('change', onThemeChange);
  new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- Monaco (bundled, same origin) ----------
  let monacoPromise = null;
  function editorTheme() { return isDark() ? 'bq-dark' : 'bq-light'; }
  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (monacoPromise) return monacoPromise;
    monacoPromise = new Promise((resolve, reject) => {
      const base = cfg.monacoBase;
      window.MonacoEnvironment = { getWorkerUrl: () => base + 'editor.worker.js' };
      if (!document.querySelector('link[data-monaco]')) {
        document.head.append(h('link', { rel: 'stylesheet', href: base + 'monaco.css', 'data-monaco': true }));
      }
      const s = h('script', { src: base + 'monaco.js' });
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
          for (const [a, b] of hl) addHighlight(rangeAt(code, a, b), true);
        }).catch(() => {});
      });
    }).catch(() => {});
  }

  // ---------- entry screens ----------
  function entry(...kids) {
    return h('main', { class: 'screen center' }, h('div', { class: 'corner' }, themeButton()), ...kids);
  }

  // code: from the address (?code=), as Safe Exam Browser opens it; joins straight away.
  function screenJoin(err, code) {
    const input = h('input', {
      id: 'join-code', class: 'input code-input', maxlength: '6', autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'characters',
    });
    input.addEventListener('input', () => {
      const v = input.value.toUpperCase().replace(CODE_ALPHABET, '').slice(0, 6);
      if (v !== input.value) input.value = v;
    });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Join' });
    const form = h('form', { class: 'panel', novalidate: true },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('div', { class: 'heading' }, h('h1', { text: 'Join your quiz' })),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'join-code', text: 'Join code' }), input),
      btn, msg,
      demoHint('Demo code: ', h('b', { text: 'K7QX4M' })));
    // Where the project lives; only here, before any quiz.
    const ghIcon = svgEl('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' });
    ghIcon.append(svgEl('path', { d: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z' })); // GitHub's mark (Primer Octicons, MIT)
    const gh = h('a', { class: 'site-link', href: 'https://github.com/Areng14/BrowserQuiz', target: '_blank', rel: 'noopener' }, ghIcon, 'GitHub');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (input.value.length !== 6) { msg.textContent = 'Join codes are 6 characters.'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Joining…'; msg.textContent = '';
      try {
        S.run = await api.join(input.value);
        screenWho();
      } catch (ex) {
        if (ex && ex.code === 'seb_launch') { screenSebLaunch(input.value); return; }
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Join';
        input.focus();
      }
    });
    mount(entry(form, gh));
    input.focus();
    code = String(code || '').toUpperCase().replace(CODE_ALPHABET, '');
    if (code.length === 6 && !err) { input.value = code; btn.click(); }
  }

  // A quiz that needs Safe Exam Browser: the seb:// (sebs:// on https) link starts SEB with the quiz's settings.
  function screenSebLaunch(code) {
    const href = `${location.protocol === 'https:' ? 'sebs' : 'seb'}://${location.host}/api/seb/${code}.seb`;
    // iPads say they're Macs; a touch screen gives them away. SEB for them comes from the App Store.
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const open = h('a', { class: 'btn primary', href, text: 'Open Safe Exam Browser' });
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('div', { class: 'heading' }, h('h1', { text: 'This quiz opens in lockdown' }),
        h('p', { text: 'Safe Exam Browser locks your device until you turn in.' })),
      h('div', { class: 'seb-launch' }, open,
        h('button', { class: 'btn', type: 'button', text: 'Use a different code', onclick: () => screenJoin() })),
      h('p', { class: 'hint seb-get' }, 'Nothing happens? ', h('a', { href: apple ? 'https://apps.apple.com/app/id1155002964' : 'https://safeexambrowser.org/download_en.html', target: '_blank', rel: 'noopener', text: 'Get Safe Exam Browser' })))));
    open.focus();
  }

  // Type your name, then pick it. The server only ever sends back names that match what you typed.
  function screenWho(err) {
    const run = S.run;
    let picked = null;
    let seq = 0;
    let timer = 0;
    const name = h('input', {
      class: 'input', id: 'student-name', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'name-list',
    });
    const list = h('div', { class: 'name-list', id: 'name-list', role: 'listbox', 'aria-label': 'Matching names', hidden: true });
    const hint = h('p', { class: 'hint', hidden: true });
    const said = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    let active = -1;
    const opts = () => [...list.children];
    function setActive(i) {
      active = i;
      opts().forEach((o, j) => o.classList.toggle('active', j === i));
      if (i >= 0) name.setAttribute('aria-activedescendant', opts()[i].id); else name.removeAttribute('aria-activedescendant');
      if (i >= 0) opts()[i].scrollIntoView({ block: 'nearest' });
    }
    const sid = h('input', { class: 'input mono', id: 'student-id', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '20' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Continue' });

    function close() { list.hidden = true; hint.hidden = true; name.setAttribute('aria-expanded', 'false'); setActive(-1); }
    function pick(m) {
      picked = m;
      name.value = m.name;
      name.classList.add('picked');
      close();
      said.textContent = `${m.name} picked`;
      sid.focus();
    }
    async function search() {
      const q = name.value.trim();
      if (q.length < 2) { close(); return; }
      const mine = ++seq;
      let res;
      try { res = await api.findNames({ runId: run.runId, q }); } catch (e) {
        if (mine !== seq) return;
        close();
        hint.hidden = false;
        hint.textContent = e.code === 'too_many' ? 'Busy. Keep typing in a moment.' : errorText(e);
        said.textContent = hint.textContent;
        return;
      }
      if (mine !== seq || picked) return;
      const matches = (res && res.matches) || [];
      if (!matches.length) {
        close();
        hint.hidden = false;
        hint.textContent = 'No match.';
        said.textContent = 'No match';
        return;
      }
      hint.hidden = true;
      list.replaceChildren(...matches.map((m, i) => {
        const o = h('div', { class: 'name-opt', role: 'option', id: `name-opt-${i}`, 'aria-selected': 'false', text: m.name, onclick: () => pick(m) });
        o.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
        return o;
      }));
      list.hidden = false;
      name.setAttribute('aria-expanded', 'true');
      setActive(-1);
      said.textContent = plural(matches.length, 'name');
    }
    name.addEventListener('input', () => {
      picked = null;
      name.classList.remove('picked');
      clearTimeout(timer);
      timer = setTimeout(search, 120);
    });
    // Arrows move through the names while focus stays in the box; Enter picks the highlighted one (or the
    // only one).
    name.addEventListener('keydown', (e) => {
      const n = list.hidden ? 0 : opts().length;
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive(Math.min(active + 1, n - 1)); }
      if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      if (e.key === 'Escape' && n) { e.preventDefault(); close(); }
      if (e.key === 'Enter' && !picked && n) {
        e.preventDefault();
        if (active >= 0) opts()[active].click(); else if (n === 1) opts()[0].click(); else setActive(0);
      }
    });

    const form = h('form', { class: 'panel', novalidate: true },
      h('p', { class: 'eyebrow', text: run.title }),
      h('div', { class: 'heading' }, h('h1', { text: 'Who are you?' })),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-name', text: 'Your name' }), name, list, hint, said),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-id', text: 'Student ID' }), sid),
      btn, msg,
      demoHint('Demo: type ', h('b', { text: 'Av' }), ', pick Ava Martinez, ID ', h('b', { text: '204511' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!picked) { msg.textContent = 'Pick your name from the list.'; name.focus(); return; }
      if (!sid.value.trim()) { msg.textContent = 'Type your student ID.'; sid.focus(); return; }
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        const got = await api.attempt({ runId: run.runId, rosterId: picked.id, studentId: sid.value.trim() });
        if (got && got.run) Object.assign(S.run, got.run); // corrections: what this student has to correct
        if (got && got.timeLimitMin != null) S.run.timeLimitMin = got.timeLimitMin; // with any extra time they get
        S.me = { name: picked.name };
        screenRules();
      } catch (ex) {
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Continue';
        sid.select();
      }
    });
    mount(entry(form));
    name.focus();
  }

  // Who's signed in, so a student who picked the wrong name sees it.
  function whoCard() {
    const icon = svgEl('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.append(svgEl('circle', { cx: 12, cy: 8, r: 4 }), svgEl('path', { d: 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' }));
    return h('div', { class: 'who-card' }, icon, h('div', {}, h('span', { class: 'who-label', text: 'Signed in as' }), h('b', { class: 'who-name', text: S.me.name })));
  }

  // Agreed to the rules: full screen and monitored already, waiting for the teacher to start the quiz.
  // Their name is on screen, so the teacher can walk the room and see who's who. The status is read out;
  // the game under it (snake.js) isn't, and goes once the quiz starts.
  function screenWait() {
    const screen = entry(h('div', { class: 'panel' },
      h('div', { class: 'wait-status', role: 'status' },
        h('p', { class: 'eyebrow', text: S.run.title }),
        h('h1', { text: 'Waiting for your teacher to start the quiz' }),
        whoCard(),
        demoHint('Demo: click ', h('b', { text: 'Start' }), ' in the teacher view.')),
      BQ.snake ? BQ.snake() : null));
    mount(screen);
    S.el = { wrap: screen, fsOverlay: null }; // where the lockdown's warnings go until the quiz is on screen
    if (S.monitor && S.monitor.opts.fullscreen && !document.fullscreenElement && !cfg.demo) showFsOverlay();
    clearInterval(S.poll);
    let starting = false;
    const check = async () => {
      if (starting) return;
      try {
        const r = await api.admitStatus();
        if (r && r.admitted) { starting = true; clearInterval(S.poll); startFromWait(); }
      } catch (e) {
        if (e.code === 'run_closed') { clearInterval(S.poll); leaveLockdown(); screenClosed(); }
        else if (e.code === 'no_attempt') { clearInterval(S.poll); leaveLockdown(); signedOut(); }
        else if (e.code === 'other_network') { clearInterval(S.poll); leaveLockdown(); S = freshState(); screenJoin(ERRORS.other_network); }
        // anything else: keep polling
      }
    };
    S.poll = setInterval(check, cfg.demo ? 700 : 2000);
  }
  // The teacher started it: the questions, on the screen they're already full screen on.
  async function startFromWait() {
    for (let tries = 0; ; tries++) {
      try { enterQuiz(await api.start(), !!S.monitor && S.monitor.opts.fullscreen); return; } catch (ex) {
        if (ex.code === 'no_attempt') { leaveLockdown(); return signedOut(); }
        if (ex.code === 'run_closed') { leaveLockdown(); return screenClosed(); }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** tries, 8000))); // offline for a moment: keep trying
      }
    }
  }
  // Out of the waiting screen without a quiz (closed, signed out): monitoring off, full screen off.
  function leaveLockdown() {
    if (S.monitor) { S.monitor.disarm(); S.monitor = null; }
    exitFullscreen();
    S.el = null;
  }

  function prechecks() {
    const ext = window.screen && 'isExtended' in window.screen ? window.screen.isExtended : null;
    // A mouse, and a window about as wide as the screen. Both are measured in screen units, so a student who
    // zooms the page in to read it still passes.
    const avail = window.screen && window.screen.availWidth;
    const desktop = window.matchMedia('(pointer: fine)').matches && (!avail || !window.outerWidth || window.outerWidth >= avail * 0.9);
    // Extensions: one that fakes "this page is in front" has to go. Anything else that adds to the page
    // is only pointed out, since some students need theirs (a screen reader toolbar, say).
    const page = BQ.pageCheck();
    return [
      { label: 'Browser extension', ok: !page.spoofed.length, note: page.spoofed.length ? 'An extension is changing this page. Turn your extensions off, then reload.' : null },
      { label: 'Extensions', ok: !page.added.length, soft: true, note: page.added.length ? 'Turn off any you don\'t need. Your teacher sees which are on.' : null },
      // Safe Exam Browser locks the screen itself, on a computer or an iPad.
      ...(S.run && S.run.seb ? [] : [
        { label: 'One display', ok: ext !== true, note: ext === true ? 'Unplug the second monitor, then reload this page.' : null },
        { label: 'Fullscreen works', ok: !!document.fullscreenEnabled, note: document.fullscreenEnabled ? null : 'Open this page in Edge or Chrome.' },
        { label: 'Desktop computer', ok: desktop, note: desktop ? null : window.matchMedia('(pointer: fine)').matches ? 'Maximize this window.' : 'Take the quiz on a lab computer with a mouse.' },
      ]),
    ];
  }

  // What's on the quiz, before it starts: one line per type, each opening to its questions' names.
  // Prompts stay on the server until the quiz starts.
  const round2 = (x) => Math.round(x * 100) / 100;
  function summaryLine(run) {
    const n = run.questionCount;
    const pts = run.points != null ? run.points : run.outline ? round2(run.outline.reduce((t, q) => t + q.points, 0)) : 0;
    const mins = run.timeLimitMin;
    return `${plural(n, 'question')}${pts ? ` (${plural(pts, 'point')})` : ''}${mins ? ` in ${plural(mins, 'minute')}` : ''}.`;
  }
  function overview(run) {
    const outline = run.outline || [];
    let groups = [];
    if (run.sections && run.sections.length) {
      // the teacher's sections, in order
      groups = partsFor(outline.map((q) => q.type), run.sections).map((p) => ({ title: p.title, qs: outline.slice(p.start, p.end + 1) }));
    } else {
      for (const q of outline) {
        let g = groups.find((x) => x.type === q.type);
        if (!g) groups.push(g = { type: q.type, title: (PARTS[q.type] || { title: 'Questions' }).title, qs: [] });
        g.qs.push(q);
      }
    }
    groups.forEach((g) => { g.points = g.qs.reduce((t, q) => t + q.points, 0); });
    if (!groups.length) return null;
    return h('div', { class: 'overview' }, groups.map((g) => h('details', { class: 'ov-group' },
      h('summary', {}, h('span', {}, h('b', { text: `${g.title}: ` }), `${plural(g.qs.length, 'question')} (${plural(round2(g.points), 'point')})`)),
      h('ul', { class: 'ov-list' }, g.qs.map((q) => h('li', {},
        q.n ? `Question ${q.n}${q.name ? `: ${q.name}` : ''}` : q.name || 'Unnamed question',
        h('span', { class: 'ov-pts', text: ` (${plural(q.points, 'point')})` })))))));
  }

  // The teacher's own directions for the whole quiz, if they wrote any.
  function quizDirections(text, heading) {
    if (!text) return null;
    return h('div', { class: 'directions quiz-directions' },
      h('strong', { text: heading }), h('div', { class: 'prompt' }, BQ.md.render(text, mdOpts())));
  }

  function screenPractice(err) {
    if (S.run.corrections) return screenCorrections(err);
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start'));
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Practice' }),
        h('p', { text: summaryLine(S.run) }),
        h('p', { text: 'Your teacher can watch the quiz page live.' })),
      btn, msg)));
    btn.focus();
  }

  // Corrections: the questions they missed on the quiz, their answers filled in. Practice: no lockdown.
  function screenCorrections(err) {
    const n = S.run.questionCount || 0;
    const e = S.run.exam; // their score on the quiz (raw, like their reports)
    const scoreLine = e ? h('p', { class: 'corr-score' }, 'Your score on the quiz: ', h('b', { text: `${e.score} / ${e.max}` }), e.pending ? ' so far' : '') : null;
    if (!n) {
      const screen = entry(h('div', { class: 'panel', role: 'status' },
        h('p', { class: 'eyebrow', text: S.run.title }),
        h('div', { class: 'heading' }, h('h1', { text: 'Nothing to correct' }), scoreLine)));
      if (e) screen.prepend(confetti()); // nothing missed: same as turning one in
      mount(screen);
      return;
    }
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start'));
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Corrections' }),
        scoreLine,
        h('p', { text: `${plural(n, 'question')} to fix${S.run.points ? ` (${plural(S.run.points, 'point')})` : ''}. Your answers from the quiz are filled in.` })),
      btn, msg)));
    btn.focus();
  }

  function screenRules(err) {
    if (S.run.practice) return screenPractice(err);
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const mins = S.run.timeLimitMin;
    // Agreeing turns the lockdown on (full screen, monitoring) and waits for the teacher to start
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'I agree' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const checkList = h('ul', { class: 'checks', 'aria-label': 'Computer checks' });
    let blocked = false;
    // Re-check when the window changes size or a display is plugged in or out.
    function renderChecks() {
      const checks = prechecks();
      blocked = !cfg.demo && !S.run.seb && checks.some((c) => !c.ok && !c.soft); // SEB locks the screen itself
      checkList.hidden = !checks.some((c) => !c.ok);
      checkList.replaceChildren(...checks.filter((c) => !c.ok).map((c) => h('li', {},
        h('span', { class: 'check-mark ' + (c.ok ? 'ok' : c.soft ? 'soft' : 'bad'), text: c.ok ? 'OK' : c.soft ? 'Note' : 'Fix' }),
        c.label,
        c.note ? h('span', { class: 'check-note', text: c.note }) : null)));
      if (btn.textContent === 'I agree') btn.disabled = blocked;
    }
    renderChecks();
    const onChange = () => { if (!checkList.isConnected) { window.removeEventListener('resize', onChange); return; } renderChecks(); };
    window.addEventListener('resize', onChange);
    if (window.screen && window.screen.addEventListener) window.screen.addEventListener('change', onChange);

    // In Safe Exam Browser with our settings there's nothing to leave to: the device is locked until they turn in
    const locked = !!S.run.sebQuit;
    const panel = h('div', { class: 'panel wide' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Before you start' }),
        h('p', { text: summaryLine(S.run) })),
      locked
        ? h('div', { class: 'lock-rule', role: 'note' },
          h('p', { class: 'lock-title', text: 'Lockdown mode' }),
          h('p', { text: 'Other apps, tabs and windows are blocked until you turn in. If you get stuck, ask your teacher.' }))
        : h('div', { class: 'cheat-rule', role: 'note' },
          h('p', { class: 'cheat-title', text: 'Leaving the quiz counts as cheating.' }),
          h('p', { text: 'That means switching to another window, tab or app, leaving fullscreen, reloading or closing this page, or using Exit when your teacher didn\'t say to. Your teacher sees each time it happens.' })),
      h('ul', { class: 'rules' },
        locked ? null : h('li', { text: 'The quiz runs in fullscreen.' }),
        h('li', { text: 'Mouse and keyboard activity is recorded, and your teacher can watch the quiz page live.' }),
        h('li', { text: 'Pasting from outside the quiz is blocked.' }),
        mins ? h('li', { text: 'The quiz turns itself in when time runs out.' }) : null),
      checkList,
      btn, msg,
      cfg.demo && prechecks().some((c) => !c.ok) ? demoHint('Demo: checks are shown but not enforced here.') : null);

    btn.addEventListener('click', () => { clearInterval(S.poll); agreeAndWait(btn, msg); });
    mount(entry(panel));
    btn.focus();
    // While they read: notice the quiz closing (or them being signed out) without waiting for the click
    clearInterval(S.poll);
    S.poll = setInterval(async () => {
      if (!panel.isConnected) { clearInterval(S.poll); return; }
      try { await api.admitStatus(); } catch (e) {
        if (!panel.isConnected) return;
        if (e.code === 'run_closed') { clearInterval(S.poll); screenClosed(); }
        else if (e.code === 'no_attempt') { clearInterval(S.poll); signedOut(); }
      }
    }, cfg.demo ? 2000 : 4000);
  }

  // "I agree": full screen (it needs this click), the server marks them ready, and the monitoring starts.
  // Then the waiting screen, or straight in if the teacher already started them.
  async function agreeAndWait(btn, msg) {
    btn.disabled = true; btn.textContent = 'One moment…'; msg.textContent = '';
    const seb = !!S.run.seb; // Safe Exam Browser already runs locked full screen
    const fsOk = seb ? false : await enterFullscreen();
    if (!fsOk && !cfg.demo && !seb) {
      msg.textContent = 'Fullscreen was blocked. Click again.';
      btn.disabled = false; btn.textContent = 'I agree';
      return;
    }
    let r;
    try { r = await api.ready(); } catch (ex) {
      exitFullscreen();
      if (ex.code === 'no_attempt') return signedOut();
      if (ex.code === 'run_closed') return screenClosed();
      msg.textContent = errorText(ex);
      btn.disabled = false; btn.textContent = 'I agree';
      return;
    }
    if (!S.monitor) S.monitor = makeMonitor(fsOk);
    if (!S.monitor.armed) S.monitor.arm();
    if (r && r.admitted) { btn.textContent = 'Starting…'; return startFromWait(); }
    screenWait();
  }

  // Shared by Start and Continue. Fullscreen has to be requested inside the click.
  async function beginQuiz(btn, msg, label) {
    btn.disabled = true; btn.textContent = 'Starting…'; msg.textContent = '';
    const practice = !!S.run.practice;
    // Safe Exam Browser already runs locked full screen, and may not offer the browser's fullscreen.
    const seb = !!S.run.seb;
    const fsOk = practice || seb ? false : await enterFullscreen();
    if (!fsOk && !cfg.demo && !practice && !seb) {
      msg.textContent = 'Fullscreen was blocked. Click again.';
      btn.disabled = false; btn.textContent = label;
      return;
    }
    let r;
    try {
      r = await api.start();
    } catch (ex) {
      exitFullscreen();
      if (ex.code === 'no_attempt') return signedOut();
      if (ex.code === 'run_closed') return screenClosed();
      msg.textContent = errorText(ex);
      btn.disabled = false; btn.textContent = label;
      return;
    }
    enterQuiz(r, fsOk);
  }

  // The quiz on screen, from /api/start's answer: after Start (practice), Continue, or the teacher's start.
  function enterQuiz(r, fsOk) {
    clearInterval(S.poll);
    S.quiz = r.quiz;
    S.deadline = r.deadline || 0;
    S.skew = r.now ? r.now - Date.now() : 0;
    S.locked = r.locked || 0;
    S.answers = restoreAnswers(r.saved || {});
    loadMarks();
    loadScratch();
    if (!S.monitor) S.monitor = makeMonitor(fsOk);
    screenQuiz();
    if (!S.monitor.armed) S.monitor.arm();
    // left full screen while it was starting: the same warning as in the quiz
    if (S.monitor.opts.fullscreen && !document.fullscreenElement && !cfg.demo) showFsOverlay();
  }

  function makeMonitor(fsOk) {
    return new BQ.Monitor(api, {
      integrity: !S.run.practice,
      fullscreen: fsOk,
      keysHeld: () => keysHeld && !!document.fullscreenElement,
      getAnswers: serializeAnswers,
      getView: currentView,
      onFullscreenLost: showFsOverlay,
      onFullscreenBack: hideFsOverlay,
      // In Safe Exam Browser with our settings nothing else can be in front, so coming back from SEB's own
      // toolbar or a system dialog isn't leaving the quiz (the server doesn't count it either)
      onReturn: S.run.sebQuit ? null : showLeftWarning,
      onPasteBlocked: () => toast('Pasting from outside the quiz is blocked.'),
      onSave: () => toast('Saved'),
      onReloadBlocked: () => toast('Reloading is off during the quiz.'),
      onBeat: onBeat,
      onBeatError: onBeatError,
    });
  }

  // What's on screen, for a teacher watching live: the page, the scroll, the window's size, what's
  // highlighted, and the scratchpad.
  function currentView() {
    if (!S || !S.el || !S.quiz) return null;
    const q = S.quiz.questions[S.idx];
    const a = q && q.type === 'code' ? S.answers[q.id] : null;
    const modal = S.el.wrap.querySelector('.modal-backdrop:not(.nav-pop) [aria-labelledby]');
    const pad = !!(S.el.scratch && !S.el.scratch.hidden);
    const v = {
      q: q ? q.id : null, review: !!S.reviewOpen, dir: !!S.dirOpen && !S.reviewOpen, intro: !!S.introOpen,
      scroll: Math.round(S.el.main.scrollTop), wscroll: Math.round(S.el.wrap.scrollTop),
      w: window.innerWidth, h: window.innerHeight, lang: a ? a.language : null,
      nav: !!S.el.wrap.querySelector('.nav-pop'), modal: modal ? modal.getAttribute('aria-labelledby') : false,
      marks: S.marks || null, // marked for review, crossed-out choices: only ever in their browser otherwise
      hl: highlightsNow(), pad,
      toast: toastNow(), fs: !!S.el.fsOverlay, dark: isDark(),
      save: S.saveState || null, phone: phoneSized(), tool: S.scratch ? S.scratch.tool : null,
    };
    // The code editor: where it's scrolled, their cursor and selection
    if (S.editor) {
      const sel = S.editor.getSelection();
      v.ed = { top: Math.round(S.editor.getScrollTop()), left: Math.round(S.editor.getScrollLeft()),
        sel: sel ? [sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn] : null };
    }
    // The scratchpad page on screen, when it's changed since the server last had it (onBeat)
    if (pad && q && S.scratch) {
      const key = `${q.id}:${S.scratchVer || 0}`;
      if (key !== S.padSent) { v.page = { q: q.id, items: S.scratch.pages[q.id] || [] }; S.padSending = key; }
    }
    return v;
  }
  const toastNow = () => { const t = S.el.wrap.querySelector('.toast'); return t ? t.textContent.slice(0, 200) : null; };
  // What's highlighted, by the piece of question text it's in (see kept)
  function highlightsNow() {
    const out = {};
    for (const [key, node] of S.kept) if (node.querySelector('mark.hl')) out[key] = marksIn(node);
    return out;
  }

  // ---------- connection + save state ----------
  function onBeat(res, info) {
    if (!S.el) return;
    if (S.padSending) { S.padSent = S.padSending; S.padSending = null; }
    if (res && res.now) S.skew = res.now - Date.now();
    if (res && res.deadline && res.deadline !== S.deadline) { // teacher gave extra time
      if (S.deadline && res.deadline > S.deadline + 30000) toast('Your teacher gave you more time.', 6000);
      S.deadline = res.deadline;
    }
    if (res && res.done && !S.submitting) return endQuiz('mine'); // the teacher ended this student's quiz
    if (res && res.notice && res.notice.id !== S.noticeId) { S.noticeId = res.notice.id; showNotice(res.notice.text); }
    setOnline(true);
    if (info && info.answers && S.saveState === 'saving') setSave('saved');
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
    if (q.type === 'text') return String(a).trim() !== '';
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

  // ---------- quiz ----------
  function screenQuiz() {
    S.parts = buildParts(S.quiz.questions);
    S.idx = 0;
    // back after a reload in a quiz with locked parts: start at the first part that isn't done
    const open = lockOn() && S.locked ? S.parts.find((p) => p.n > S.locked) : null;
    if (open) { S.idx = open.start; S.introOpen = false; for (const p of S.parts) if (p.n <= S.locked) S.partsSeen.add(p.n); }
    S.dirOpen = true;
    if (!open) S.introOpen = true; // the first page also shows what's on the quiz and its directions
    const timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
    const save = h('span', { class: 'save-state' }); // not a live region: it flips with every keystroke
    const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const conn = h('div', { class: 'conn-banner', role: 'alert', hidden: true },
      'Offline. Keep working, answers save when you reconnect.');
    const main = h('main', { class: 'qmain', tabindex: '-1', 'aria-labelledby': 'q-heading' });
    // "Question 3 of 20" opens every question; the review page lists them all before turning in.
    const jump = h('button', { class: 'btn q-jump', type: 'button', 'aria-haspopup': 'dialog', onclick: () => openNavigator() });
    const mid = h('div', { class: 'qnav-mid' }, jump);
    const prev = h('button', { class: 'btn', type: 'button', text: 'Back', onclick: () => go(S.reviewOpen ? S.quiz.questions.length - 1 : S.idx - 1) });
    const next = h('button', { class: 'btn', type: 'button' });
    next.addEventListener('click', () => {
      if (S.reviewOpen) return openSubmit();
      if (S.dirOpen) return closeDirections();
      if (S.idx === S.quiz.questions.length - 1) return openReview();
      go(S.idx + 1);
    });
    const hlBar = highlightBar();
    main.addEventListener('mouseup', () => setTimeout(hlBar.update, 0));
    main.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') hlBar.update(); });
    main.addEventListener('scroll', hlBar.hide, { passive: true });
    const scratchBtn = h('button', { class: 'btn small ghost scratch-btn', type: 'button', 'aria-pressed': 'false', 'aria-controls': 'scratch', onclick: () => toggleScratch() }, penIcon(), h('span', { class: 'scratch-label', text: 'Scratchpad' }));
    const scratch = h('aside', { class: 'scratch', id: 'scratch', 'aria-label': 'Scratchpad' });
    scratch.hidden = true;
    const wrap = h('div', { class: 'quiz' },
      // Title, name and save state | timer, centered | tools
      h('header', { class: 'qbar' },
        h('div', { class: 'qbar-side' },
          h('span', { class: 'qbar-name' }, h('span', { class: 'qbar-title', text: S.quiz.title }),
            S.me && S.me.name && (!cfg.preview || cfg.watch) ? h('span', { class: 'qbar-who', title: 'Signed in as', text: S.me.name }) : null),
          save),
        timer,
        h('div', { class: 'qbar-side qbar-end' }, scratchBtn, themeButton(),
          cfg.preview && !cfg.watch ? null : h('button', { class: 'btn small ghost', type: 'button', text: 'Exit', onclick: () => openExit() }))),
      conn,
      main,
      scratch,
      h('footer', { class: 'qnav' }, prev, mid, next),
      live, hlBar.bar);
    S.el = { wrap, main, timer, jump, prev, next, save, conn, scratch, scratchBtn, live, hlBar, fsOverlay: null };
    wrap.addEventListener('scroll', hlBar.hide, { passive: true }); // a short window scrolls the whole quiz
    if (!keysBound) { document.addEventListener('keydown', quizKeys); keysBound = true; }
    S.saveState = 'saved';
    mount(wrap);
    renderQuestion();
    startTimer();
  }

  // Locked parts (quiz.lockParts): going on to a later part finishes every part before it, for good, once
  // they say so. The server keeps those answers as they were. Not while a teacher watches.
  function lockOn() { return !!(S.quiz && S.quiz.lockParts && !cfg.watch); }
  function lockedAt(i) { return lockOn() && S.locked > 0 && !!partOf(i) && partOf(i).n <= S.locked; }
  function go(i) {
    if (i < 0 || i >= S.quiz.questions.length || lockedAt(i)) return;
    const done = lockOn() ? partOf(i).n - 1 : 0;
    if (done > S.locked) return confirmFinishParts(done, () => goNow(i));
    goNow(i);
  }
  function goNow(i) {
    S.reviewOpen = false;
    S.idx = i;
    S.dirOpen = !S.partsSeen.has(partOf(i).n);
    renderQuestion();
    S.el.main.scrollTop = 0;
    S.el.main.focus({ preventScroll: true });
  }
  // Every question at a glance before turning in (Bluebook's "Check your work").
  function openReview() {
    S.reviewOpen = true;
    S.dirOpen = false;
    renderQuestion();
    S.el.main.scrollTop = 0;
    const head = document.getElementById('q-heading');
    if (head) head.focus({ preventScroll: true });
  }
  function openDirections() {
    S.dirOpen = true;
    renderQuestion();
    S.el.main.focus({ preventScroll: true });
  }
  function closeDirections() {
    S.partsSeen.add(partOf(S.idx).n);
    S.dirOpen = false;
    S.introOpen = false;
    renderQuestion();
    S.el.main.focus({ preventScroll: true });
  }

  function disposeEditor() {
    S.editorSubs.splice(0).forEach((d) => d && d.dispose && d.dispose());
    if (S.editor) { S.editor.dispose(); S.editor = null; }
    if (S.monitor) S.monitor.selectionProvider = null;
  }

  function renderQuestion() {
    disposeEditor();
    const q = S.quiz.questions[S.idx];
    const total = S.quiz.questions.length;
    if (S.reviewOpen) {
      S.el.prev.disabled = false;
      // a timed exam turns in by itself when time is up: no turning in early
      S.el.next.textContent = timedExam() ? 'Turns in when time is up' : 'Submit';
      S.el.next.className = timedExam() ? 'btn' : 'btn primary';
      S.el.next.disabled = timedExam();
      S.el.jump.hidden = true;
      document.title = `Check your work – ${S.quiz.title}`;
      if (S.el.hlBar) S.el.hlBar.hide();
      S.el.main.classList.remove('code-fit', 'split-fit');
      S.el.main.replaceChildren(reviewView());
      renderScratch();
      return;
    }
    S.el.jump.hidden = false;
    S.el.prev.disabled = S.idx === 0 || lockedAt(S.idx - 1);
    const last = S.idx === total - 1;
    S.el.next.disabled = false;
    S.el.next.textContent = S.dirOpen ? 'Continue' : last ? 'Review' : 'Next';
    S.el.next.className = 'btn' + (last && !S.dirOpen ? ' primary' : '');
    const views = { code: codeView, output: outputView, trace: traceView, fill: fillView, essay: essayView };
    let view = S.dirOpen ? directionsView(partOf(S.idx)) : (views[q.type] || basicView)(q);
    // Corrections: a "What went wrong?" box under the answer (in a code question's left column)
    if (!S.dirOpen && S.quiz.corrections && S.quiz.corrections.why && S.quiz.corrections.fix[q.id]) (view.querySelector('.code-left') || view).append(whyBox(q));
    // Shared material sits beside the question (above it on narrow screens). Code questions put it in
    // their left column themselves.
    if (!S.dirOpen && q.shared && !view.classList.contains('wide')) {
      const shared = sharedBlock(q);
      if (shared) shared.tabIndex = 0; // it scrolls on its own beside the question (app.css), so keys can scroll it too
      view = h('div', { class: 'shared-split' }, shared, view);
    }
    const where = S.dirOpen ? partOf(S.idx).title : `Question ${S.idx + 1} of ${total}${q.name ? `: ${q.name}` : ''}`;
    document.title = `${where} – ${S.quiz.title}`;
    if (S.el.hlBar) S.el.hlBar.hide();
    // Code questions and shared material fill the window, each side scrolling on its own (app.css).
    S.el.main.classList.toggle('code-fit', view.classList.contains('wide'));
    S.el.main.classList.toggle('split-fit', view.classList.contains('shared-split'));
    S.el.main.replaceChildren(...(S.dirOpen ? [] : [h('h1', { class: 'sr-only', id: 'q-heading', text: where })]), view);
    colorize(view);
    renderSheet();
    renderScratch();
  }

  // ---------- scratchpad ----------
  // The student's own working space: one board a question, where they draw and drop typed notes
  // anywhere. It's kept in this browser (per run and student), isn't graded, and is cleared when the
  // quiz is turned in. A teacher watching live sees the page on screen (the server keeps it in memory).
  const scratchKey = () => 'bq-scratch:' + [S.run && (S.run.id || S.run.code || S.run.title), S.me && S.me.name].join(':');
  function loadScratch() {
    S.scratch = { tool: 'pen', pages: {} };
    try {
      const v = JSON.parse(localStorage.getItem(scratchKey()) || 'null');
      if (v && v.pages && typeof v.pages === 'object') Object.assign(S.scratch, v);
    } catch (e) { /* nothing saved */ }
  }
  let scratchTimer = 0;
  function saveScratch() {
    S.scratchVer = (S.scratchVer || 0) + 1;
    if (cfg.watch) return; // the student's, shown to a teacher: not theirs to keep
    clearTimeout(scratchTimer);
    scratchTimer = setTimeout(() => { try { localStorage.setItem(scratchKey(), JSON.stringify(S.scratch)); } catch (e) { /* kept for this page */ } }, 400);
  }
  function clearScratch() {
    clearTimeout(scratchTimer);
    try { localStorage.removeItem(scratchKey()); } catch (e) { /* nothing to clear */ }
  }
  function toggleScratch(force) {
    if (!S.el || !S.el.scratch) return;
    const open = force != null ? force : S.el.scratch.hidden;
    S.el.scratch.hidden = !open;
    S.el.wrap.classList.toggle('with-scratch', open);
    S.el.scratchBtn.setAttribute('aria-pressed', String(open));
    if (open) renderScratch();
    if (S.editor) S.editor.layout();
    if (open) { const first = S.el.scratch.querySelector('.scratch-tool'); if (first) first.focus(); } else S.el.scratchBtn.focus();
  }
  const PAD_ICONS = {
    pen: ['M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z', 'm15 5 4 4'],
    text: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
    eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
    undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
    clear: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
    close: ['M18 6 6 18', 'm6 6 12 12'],
  };
  function padIcon(name) {
    const s = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const d of PAD_ICONS[name]) s.append(svgEl('path', { d }));
    return s;
  }
  function renderScratch() {
    const el = S.el && S.el.scratch;
    if (!el || el.hidden || !S.quiz || !S.scratch) return;
    el.replaceChildren(...scratchBoard(S.quiz.questions[S.idx]));
  }
  // Items on a page, oldest first: strokes { p: [x, y, ...], e: true for the eraser } and notes
  // { x, y, s }. Positions are scaled to the board's width, so a page redraws after a resize. Strokes
  // and notes take the page's text color, so they follow the theme.
  function scratchBoard(q) {
    const pages = S.scratch.pages;
    const items = pages[q.id] || [];
    let tool = ['pen', 'text', 'eraser'].includes(S.scratch.tool) ? S.scratch.tool : 'pen';
    let ctx = null;
    let w = 0;
    let cur = null;
    let cleared = null; // what Clear took away, until something new goes on the page
    const canvas = h('canvas', { class: 'scratch-canvas', 'aria-hidden': 'true' });
    const notes = h('div', { class: 'scratch-notes' });
    const board = h('div', { class: 'scratch-board' }, canvas, notes);
    const save = () => { if (items.length) pages[q.id] = items; else delete pages[q.id]; saveScratch(); };
    const btn = (name, label, on) => {
      const b = h('button', { class: 'scratch-tool', type: 'button', title: label, 'aria-label': label, onclick: on });
      b.append(padIcon(name));
      return b;
    };
    // Text from the keyboard (Enter or Space on the tool) starts a note below the others, since there's
    // no pointer to place it.
    const tools = {
      pen: btn('pen', 'Pen', () => pick('pen')),
      text: btn('text', 'Text', (e) => { pick('text'); if (e && e.detail === 0) keyboardNote(); }),
      eraser: btn('eraser', 'Eraser', () => pick('eraser')),
    };
    function keyboardNote() {
      if (!ctx && !size()) return;
      let y = 0.03;
      for (const ta of notes.querySelectorAll('.scratch-note')) y = Math.max(y, (ta.offsetTop + ta.offsetHeight + 8) / w);
      const n = { x: 0.03, y: +y.toFixed(4), s: '' };
      add(n);
      const ta = noteEl(n);
      notes.append(ta);
      ta.focus();
    }
    function pick(t) {
      tool = t;
      S.scratch.tool = t;
      for (const [k, b] of Object.entries(tools)) b.setAttribute('aria-pressed', String(k === t));
      board.dataset.tool = t;
      saveScratch();
    }
    pick(tool);
    const undo = btn('undo', 'Undo', () => {
      if (!items.length && cleared) { items.push(...cleared); cleared = null; }
      else {
        const it = items.pop();
        if (it && it.rm) for (const [i, n] of it.rm.slice().reverse()) items.splice(i, 0, n);
      }
      paint();
      save();
    });
    const clear = btn('clear', 'Clear page', () => {
      if (!items.length) return;
      cleared = items.splice(0);
      paint();
      save();
    });
    const add = (it) => { items.push(it); cleared = null; };

    function size() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return false;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = r.width;
      return true;
    }
    function style(st) {
      ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
      ctx.lineWidth = st.e ? 22 : 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = getComputedStyle(canvas).color;
    }
    function path(p, from) {
      ctx.beginPath();
      ctx.moveTo(p[from] * w, p[from + 1] * w);
      if (p.length - from === 2) ctx.lineTo(p[from] * w + 0.01, p[from + 1] * w); // a dot
      for (let i = from + 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * w);
      ctx.stroke();
    }
    function paint() {
      if (!ctx && !size()) return;
      ctx.clearRect(0, 0, w, canvas.height);
      for (const it of items) if (it.p) { style(it); path(it.p, 0); }
      // Redrawing makes new note boxes: keep the one being typed in focused, cursor and all.
      const a = document.activeElement;
      const typing = a && notes.contains(a) && a._note ? { n: a._note, from: a.selectionStart, to: a.selectionEnd } : null;
      notes.replaceChildren(...items.filter((it) => it.s != null).map(noteEl));
      const again = typing && [...notes.children].find((t) => t._note === typing.n);
      if (again) { again.focus({ preventScroll: true }); again.setSelectionRange(typing.from, typing.to); }
    }
    // A note is a borderless text box that grows with what's typed, up to the board's right edge.
    let measure = null;
    function fit(ta, n) {
      measure = measure || document.createElement('canvas').getContext('2d');
      measure.font = getComputedStyle(ta).font;
      const widest = Math.max(0, ...ta.value.split('\n').map((l) => measure.measureText(l).width));
      ta.style.width = Math.max(28, Math.min(widest + 14, w - n.x * w - 4)) + 'px';
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    function noteEl(n) {
      const ta = h('textarea', { class: 'scratch-note', rows: '1', spellcheck: 'false', 'aria-label': 'Note' });
      ta.value = n.s;
      ta.style.left = n.x * w + 'px';
      ta.style.top = n.y * w + 'px';
      ta.addEventListener('input', () => { n.s = ta.value; fit(ta, n); save(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); } });
      ta.addEventListener('blur', () => {
        if (n.s.trim() || !ta.isConnected) return;
        const i = items.indexOf(n);
        if (i >= 0) items.splice(i, 1);
        ta.remove();
        save();
      });
      requestAnimationFrame(() => fit(ta, n));
      ta._note = n;
      return ta;
    }
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [+((e.clientX - r.left) / w).toFixed(4), +((e.clientY - r.top) / w).toFixed(4)]; };
    // The eraser takes out any note it passes over; Undo puts it back.
    function eraseNotes(x, y) {
      for (const ta of notes.querySelectorAll('.scratch-note')) {
        const l = ta.offsetLeft - 11; const t = ta.offsetTop - 11;
        if (x * w < l || y * w < t || x * w > l + ta.offsetWidth + 22 || y * w > t + ta.offsetHeight + 22) continue;
        const i = items.indexOf(ta._note);
        if (i < 0) continue;
        (cur.rm = cur.rm || []).push([i, ta._note]);
        items.splice(i, 1);
        ta.remove();
      }
    }
    board.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.scratch-note') || (!ctx && !size())) return;
      e.preventDefault();
      if (tool === 'text') {
        const [x, y] = at(e);
        const n = { x: Math.min(x, +((w - 80) / w).toFixed(4)), y: Math.max(0, +(y - 11 / w).toFixed(4)), s: '' };
        add(n);
        const ta = noteEl(n);
        notes.append(ta);
        ta.focus();
        return;
      }
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.scratch-note')) document.activeElement.blur();
      canvas.setPointerCapture(e.pointerId);
      cur = { p: at(e) };
      if (tool === 'eraser' || e.button === 5) cur.e = true; // button 5: a pen's eraser end
      add(cur);
      style(cur);
      path(cur.p, 0);
      if (cur.e) eraseNotes(cur.p[0], cur.p[1]);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const from = cur.p.length - 2;
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
        const [x, y] = at(ev);
        const lx = cur.p[cur.p.length - 2];
        const ly = cur.p[cur.p.length - 1];
        if (Math.hypot(x - lx, y - ly) * w >= 1.5) { cur.p.push(x, y); if (cur.e) eraseNotes(x, y); } // skip points closer than 1.5px
      }
      if (cur.p.length - 2 > from) { style(cur); path(cur.p, from); }
    });
    const end = () => { if (cur) { cur = null; save(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    requestAnimationFrame(() => { size(); paint(); });
    const onResize = () => { if (!canvas.isConnected) { window.removeEventListener('resize', onResize); return; } size(); paint(); };
    window.addEventListener('resize', onResize);

    const close = btn('close', 'Close scratchpad', () => toggleScratch(false));
    close.classList.add('scratch-close');
    const head = h('div', { class: 'scratch-head' },
      h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Tool' }, tools.pen, tools.text, tools.eraser),
      h('div', { class: 'scratch-group', role: 'group', 'aria-label': 'Edit' }, undo, clear),
      h('span', { class: 'scratch-q', text: `Question ${S.idx + 1}` }),
      close);
    return [head, board];
  }

  function directionsView(part) {
    const seen = S.partsSeen.has(part.n);
    const range = part.start === part.end ? `Question ${part.start + 1}` : `Questions ${part.start + 1}–${part.end + 1}`;
    // Right after Start: the quiz's own directions and what's on it, above the first part's.
    const intro = S.introOpen && part.n === 1;
    const qs = S.quiz.questions;
    const run = { questionCount: qs.length, timeLimitMin: S.quiz.timeLimitMin, sections: S.quiz.sections,
      outline: qs.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })) }; // the student's own order, so numbers are right
    return h('div', { class: 'qview' + (intro ? ' intro' : '') },
      intro ? [
        h('div', { class: 'meta-row' }, h('span', { text: 'Before you begin' }), h('span', { text: summaryLine(run) })),
        h('h1', { id: 'q-heading', text: S.quiz.title }),
        quizDirections(S.quiz.directions && S.quiz.directions.quiz, 'Directions'),
        h('section', { class: 'intro-ov', 'aria-labelledby': 'ov-head' }, h('h2', { id: 'ov-head', text: "What's on the quiz" }), overview(run)),
        h('hr', { class: 'intro-rule' }),
      ] : null,
      h('div', { class: 'meta-row' }, h('span', { text: `Part ${part.n} of ${S.parts.length}` }), h('span', { text: range })),
      h(intro ? 'h2' : 'h1', { id: intro ? 'part-heading' : 'q-heading', class: 'part-title', text: part.title }),
      part.md ? h('div', { class: 'directions prompt' }, BQ.md.render(part.md, mdOpts()))
        : part.list ? h('div', { class: 'directions' }, h('strong', { text: 'Directions' }), h('ul', {}, part.list.map(([t, text]) => h('li', {}, h('b', { text: `${t}: ` }), text))))
          : h('p', { class: 'directions' }, h('strong', { text: 'Directions: ' }), part.text),
      // shown once, before the first part; after that only when they open Directions again
      intro || !seen ? null : quizDirections(S.quiz.directions && S.quiz.directions.quiz, 'For the whole quiz'),
      h('div', {}, h('button', { class: 'btn primary', type: 'button', text: seen ? 'Back to the question' : 'Start this part', onclick: closeDirections })));
  }

  // ---------- mark for review, crossed-out choices ----------
  // Study aids only: they never change an answer, so they stay in this browser (per run and student)
  // and are cleared once the quiz is turned in.
  const marksKey = () => 'bq-marks:' + [S.run && (S.run.id || S.run.code || S.run.title), S.me && S.me.name].join(':');
  function loadMarks() {
    S.marks = { review: [], out: {} };
    try {
      const m = JSON.parse(localStorage.getItem(marksKey()) || 'null');
      if (m && Array.isArray(m.review) && m.out && typeof m.out === 'object') S.marks = m;
    } catch (e) { /* nothing saved */ }
  }
  function saveMarks() {
    try { localStorage.setItem(marksKey(), JSON.stringify(S.marks)); } catch (e) { /* kept for this page only */ }
  }
  function clearMarks() {
    try { localStorage.removeItem(marksKey()); } catch (e) { /* nothing to clear */ }
  }
  const isMarked = (q) => !!S.marks && S.marks.review.includes(q.id);
  const isCrossed = (q, i) => !!S.marks && (S.marks.out[q.id] || []).includes(i);
  function setCrossed(q, i, on) {
    if (!S.marks) S.marks = { review: [], out: {} };
    const list = (S.marks.out[q.id] || []).filter((x) => x !== i);
    if (on) list.push(i);
    if (list.length) S.marks.out[q.id] = list; else delete S.marks.out[q.id];
    saveMarks();
  }
  function bookmarkIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'mark-icon');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M4 1.75h8v12.5l-4-3.25-4 3.25z');
    svg.append(p);
    return svg;
  }
  function markButton(q) {
    const b = h('button', { class: 'mark-btn', type: 'button', 'aria-pressed': String(isMarked(q)) }, bookmarkIcon(), h('span', { text: 'Mark for review' }));
    b.addEventListener('click', () => {
      if (!S.marks) S.marks = { review: [], out: {} };
      S.marks.review = isMarked(q) ? S.marks.review.filter((x) => x !== q.id) : [...S.marks.review, q.id];
      saveMarks();
      b.setAttribute('aria-pressed', String(isMarked(q)));
      renderSheet();
    });
    return b;
  }

  function metaRow(q, kind) {
    return h('div', { class: 'meta-row' },
      h('span', {}, q.name ? h('b', { class: 'q-name', text: q.name }) : null, kind, ' ', h('button', { class: 'link-btn', type: 'button', text: 'Directions', onclick: openDirections })),
      h('span', { class: 'meta-right' }, markButton(q), h('span', { text: plural(q.points, 'point') + (q.partialCredit ? ' (partial credit)' : '') })));
  }

  // Question text is made once and kept for the whole quiz, so highlights (and colored code, and math)
  // are still there when a student comes back to the question.
  function kept(key, make) {
    let n = S.kept.get(key);
    if (!n) { n = make(); S.kept.set(key, n); }
    return n;
  }

  // A passage, case or listing that several questions use, written once in the quiz. Highlights in it
  // show on every question that uses it.
  // Markdown options: the quiz's language for code, and where its images are.
  const mdOpts = () => ({ lang: S.quiz && S.quiz.language, assetUrl: api.assetUrl });
  // A choice with more than one line (code, a table, a list) is set as blocks; a one-line choice stays inline.
  const choiceText = (c) => (/\n/.test(c)
    ? h('div', { class: 'choice-text choice-rich hl-root' }, BQ.md.render(c, mdOpts()))
    : h('span', { class: 'choice-text hl-root' }, BQ.md.renderInline(c, mdOpts())));

  // The material's card is kept between questions; it's only a tab stop where it scrolls on its own.
  const notTabbable = (el) => { if (el) el.removeAttribute('tabindex'); return el; };
  // A question can use more than one: they stack, in the quiz's order.
  function sharedBlock(q) {
    const blocks = [].concat(q.shared || []).map((sid) => {
      const m = S.quiz.shared ? S.quiz.shared[sid] : null;
      return m && kept('shared:' + sid, () => h('section', { class: 'shared', 'aria-label': m.title || 'Shared material' },
        m.title ? h('p', { class: 'shared-title', text: m.title }) : null,
        m.text ? h('div', { class: 'prompt hl-root' }, BQ.md.render(m.text, mdOpts())) : null,
        m.image ? h('img', { class: 'qimg', src: api.assetUrl(m.image), alt: m.imageAlt || '' }) : null));
    }).filter(Boolean);
    if (!blocks.length) return null;
    return blocks.length === 1 ? blocks[0] : h('div', { class: 'shared-stack', role: 'group', 'aria-label': 'Shared material' }, blocks);
  }

  function prompt(q) {
    const fix = S.quiz.corrections && S.quiz.corrections.fix[q.id];
    return [
      fix ? h('p', { class: 'fix-note', text: fix.fresh ? 'A new question like the one you missed' : `On the quiz: ${fix.points} / ${plural(fix.max, 'point')}` }) : null,
      kept('prompt:' + q.id, () => h('div', { class: 'prompt hl-root' }, BQ.md.render(q.prompt, mdOpts()))),
      q.image ? h('img', { class: 'qimg', src: api.assetUrl(q.image), alt: q.imageAlt || '' }) : null,
    ];
  }

  // ---------- highlighting ----------
  // Students select question text and highlight it, like on paper. Copying or dragging it out stays
  // blocked by the monitor. A small bar over the selection offers Highlight, and Remove when the
  // selection (or a click) touches a highlight.
  function highlightBar() {
    let range = null;
    const hl = h('button', { class: 'btn small', type: 'button', text: 'Highlight', onclick: () => { if (range) addHighlight(range); hide(); } });
    const un = h('button', { class: 'btn small', type: 'button', text: 'Remove highlight', onclick: () => { if (range) removeHighlight(range); hide(); } });
    const bar = h('div', { class: 'hl-bar', role: 'toolbar', 'aria-label': 'Highlight', hidden: true }, hl, un);
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
    function hide() { bar.hidden = true; range = null; }
    const rootOf = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('.hl-root'); };
    function update() {
      const sel = window.getSelection();
      if (!S.el || !sel || !sel.rangeCount) return hide();
      const r = sel.getRangeAt(0);
      const root = rootOf(r.startContainer);
      if (!root || root !== rootOf(r.endContainer) || !S.el.main.contains(root)) return hide();
      const marks = [...root.querySelectorAll('mark.hl')].filter((m) => r.intersectsNode(m));
      // A click (no selection) on a highlight offers to remove it; not on a choice, where a click picks it.
      if (sel.isCollapsed && (!marks.length || root.closest('.choice'))) return hide();
      if (sel.isCollapsed) { range = document.createRange(); range.selectNodeContents(marks[0]); } else range = r.cloneRange();
      hl.hidden = sel.isCollapsed;
      un.hidden = !marks.length;
      bar.hidden = false;
      const at = (sel.isCollapsed ? marks[0] : r).getBoundingClientRect();
      const box = S.el.wrap.getBoundingClientRect();
      const y = S.el.wrap.scrollTop; // a short window scrolls the whole quiz
      const top = at.top - box.top - bar.offsetHeight - 8;
      // On touch screens the phone's own Copy menu sits above the selection, so go below it.
      bar.style.top = `${top > 4 && !coarse() ? top + y : at.bottom - box.top + 8 + y}px`;
      bar.style.left = `${Math.max(8, Math.min(box.width - bar.offsetWidth - 8, at.left - box.left + at.width / 2 - bar.offsetWidth / 2))}px`;
    }
    return { bar, update, hide };
  }
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  // A touch selection never sends mouseup or keyup: follow the selection itself.
  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    if (!coarse()) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(() => { if (S.el && S.el.hlBar && S.el.main.isConnected) S.el.hlBar.update(); }, 250);
  });
  function textNodesIn(range) {
    const top = range.commonAncestorContainer;
    const root = top.nodeType === 1 ? top : top.parentNode;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      // math keeps its own layout, so it isn't split up
      acceptNode: (n) => (n.nodeValue && range.intersectsNode(n) && !n.parentElement.closest('.katex') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const out = [];
    if (top.nodeType === 3) { if (!top.parentElement.closest('.katex')) out.push(top); return out; }
    while (walk.nextNode()) out.push(walk.currentNode);
    return out;
  }
  // Highlights in el as [start, end) character offsets, counting a line break element as one character,
  // so they survive el being rewritten with the same text.
  function marksIn(el) {
    const out = [];
    let pos = 0;
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          const len = c.nodeValue.length;
          if (c.parentElement.closest('mark.hl')) {
            const last = out[out.length - 1];
            if (last && last[1] === pos) last[1] += len; else out.push([pos, pos + len]);
          }
          pos += len;
        } else if (c.nodeName === 'BR') pos += 1;
        else if (c.nodeType === 1) walk(c);
      }
    }(el));
    return out;
  }
  function rangeAt(el, a, b) {
    const r = document.createRange();
    let pos = 0;
    let started = false;
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          const len = c.nodeValue.length;
          if (!started && a <= pos + len) { r.setStart(c, a - pos); started = true; }
          if (started && b <= pos + len) { r.setEnd(c, b - pos); return true; }
          pos += len;
        } else if (c.nodeName === 'BR') pos += 1;
        else if (c.nodeType === 1 && walk(c)) return true;
      }
      return false;
    }(el));
    return r;
  }
  function addHighlight(range, keepSelection) {
    for (let node of textNodesIn(range)) {
      if (node.parentElement.closest('mark.hl')) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (start >= end) continue;
      if (end < node.length) node.splitText(end);
      if (start > 0) node = node.splitText(start);
      if (!node.nodeValue.trim() && node.nodeValue.includes('\n')) continue; // the gap between two paragraphs
      const mark = h('mark', { class: 'hl' });
      node.replaceWith(mark);
      mark.append(node);
    }
    if (!keepSelection) window.getSelection().removeAllRanges();
  }
  function removeHighlight(range) {
    for (const m of [...S.el.main.querySelectorAll('mark.hl')]) {
      if (!range.intersectsNode(m)) continue;
      const parent = m.parentNode;
      m.replaceWith(...m.childNodes);
      parent.normalize();
    }
    window.getSelection().removeAllRanges();
  }

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
      runCooldown(runBtn);
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
    if (results.isConnected) renderResults(q, results, q.codeLang);
    runCooldown(btn);
  }

  function essayView(q) {
    const ta = growArea({ id: q.id + '-essay', rows: 8 }, S.answers[q.id], (v) => setAnswer(q.id, v.trim() ? v : undefined), !!q.codeLang);
    return h('div', { class: 'qview' }, metaRow(q, KIND.essay), prompt(q),
      h('label', { class: 'field', for: q.id + '-essay' }, h('span', { class: 'field-label', text: 'Your answer' }), ta));
  }

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
    runCooldown(runBtn);
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
        S.locked = cfg.preview ? n : (await api.partDone(n, serializeAnswers())).locked;
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
    const ta = h('textarea', { class: 'code-fallback', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', 'aria-label': `Code answer. Tab indents. ${leaveHint()}.` });
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
    if (results.isConnected) renderResults(q, results);
    runCooldown(btn);
  }

  // One cooldown for the whole quiz (the server limits runs per student, not per question).
  function runCooldown(btn) {
    const tick = (first) => {
      if (!first && !btn.isConnected) return; // the view was closed
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

  // One question's number: answered, marked for review, current.
  function sheetDot(q, i, onPick) {
    const done = isAnswered(q);
    const marked = isMarked(q);
    const here = i === S.idx && !S.reviewOpen; // the review page isn't on any one question
    return h('button', {
      type: 'button', class: 'sheet-dot' + (done ? ' answered' : '') + (here ? ' current' : '') + (marked ? ' marked' : ''),
      'aria-label': `Question ${i + 1}${q.name ? `, ${q.name}` : ''}${done ? ', answered' : ''}${marked ? ', marked for review' : ''}`, 'aria-current': here ? 'step' : null,
      title: q.name ? `${i + 1}. ${q.name}` : null,
      text: String(i + 1), onclick: () => onPick(i), disabled: lockedAt(i) || null,
    });
  }
  function renderSheet() {
    if (!S.el || !S.quiz) return;
    const n = S.quiz.questions.length;
    S.el.jump.replaceChildren(h('span', {}, h('span', { class: 'q-jump-word', text: 'Question ' }), `${S.idx + 1} of ${n}`), chevronUp());
    S.el.jump.setAttribute('aria-label', `Question ${S.idx + 1} of ${n}. Show all questions`);
  }
  // The key and every question by part, numbered: for the panel and the review page.
  function questionGrid(onPick) {
    const legend = h('p', { class: 'nav-legend', 'aria-hidden': 'true' },
      h('span', {}, h('span', { class: 'sheet-dot mini answered' }), 'Answered'),
      h('span', {}, h('span', { class: 'sheet-dot mini marked' }), 'For review'),
      S.reviewOpen ? null : h('span', {}, h('span', { class: 'sheet-dot mini current' }), 'Current'));
    const parts = S.parts && S.parts.length ? S.parts : [{ title: 'Questions', start: 0, end: S.quiz.questions.length - 1 }];
    return [legend, ...parts.map((p) => {
      const range = p.start === p.end ? `Question ${p.start + 1}` : `Questions ${p.start + 1}–${p.end + 1}`;
      return h('section', { class: 'nav-part', 'aria-label': `${p.title}, ${range}` },
        h('h3', {}, p.title, h('span', { class: 'nav-range', text: ` ${range}` })),
        h('div', { class: 'nav-grid' }, S.quiz.questions.slice(p.start, p.end + 1).map((q, k) => sheetDot(q, p.start + k, onPick))));
    })];
  }
  function reviewView() {
    const qs = S.quiz.questions;
    const done = qs.filter(isAnswered).length;
    const marked = qs.filter(isMarked).length;
    return h('div', { class: 'qview review' },
      h('h1', { id: 'q-heading', tabindex: '-1', text: 'Check your work' }),
      h('p', { class: 'muted', text: `${done} of ${plural(qs.length, 'question')} answered${marked ? `, ${marked} for review` : ''}.` }),
      ...questionGrid(go));
  }
  function chevronUp() {
    const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.append(svgEl('path', { d: 'M6 15l6-6 6 6' }));
    return s;
  }

  // Every question, numbered and grouped by part, to jump to any of them.
  function openNavigator() {
    if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    let release = null;
    const close = () => { backdrop.remove(); release(); };
    const pick = (i) => { backdrop.remove(); release(false); go(i); };
    const x = h('button', { class: 'btn small ghost nav-close', type: 'button', 'aria-label': 'Close', onclick: close }, closeIcon());
    const toReview = h('button', { class: 'btn', type: 'button', text: 'Go to review page', onclick: () => { backdrop.remove(); release(false); openReview(); } });
    backdrop = h('div', { class: 'modal-backdrop nav-pop' },
      h('div', { class: 'modal q-navigator', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nav-title' },
        h('div', { class: 'nav-head' }, h('h2', { id: 'nav-title', text: `Question ${S.idx + 1} of ${S.quiz.questions.length}` }), x),
        ...questionGrid(pick),
        h('div', { class: 'nav-foot' }, toReview)));
    // It opens just above the bottom bar, like a menu from its button.
    const bar = S.el.next.closest('.qnav');
    if (bar) backdrop.style.paddingBottom = `${Math.max(16, Math.round(S.el.wrap.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 8))}px`;
    S.el.wrap.append(backdrop);
    release = holdFocus(backdrop, close);
    const cur = backdrop.querySelector('.sheet-dot.current:not(.mini)');
    (cur || x).focus();
  }
  function closeIcon() {
    const s = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' });
    s.append(svgEl('path', { d: 'M18 6L6 18M6 6l12 12' }));
    return s;
  }

  function startTimer() {
    clearInterval(S.timer);
    const tick = () => {
      if (!S.deadline) { S.el.timer.textContent = ''; return; }
      const left = Math.max(0, S.deadline - (Date.now() + S.skew));
      const m = Math.floor(left / 60000);
      const s = Math.floor(left / 1000) % 60;
      S.el.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      S.el.timer.classList.toggle('warn', left < 5 * 60000 && left >= 60000);
      S.el.timer.classList.toggle('crit', left < 60000);
      for (const mins of [5, 1]) {
        if (left > mins * 60000 + 1000) S.warned[mins] = false; // re-arm after extra time
        else if (!S.warned[mins] && left > 0) {
          S.warned[mins] = true;
          if (left > (mins - 1) * 60000 + 30000 && !cfg.watch) toast(`${plural(mins, 'minute')} left.`, 6000);
        }
      }
      if (left <= 0 && !cfg.watch) submitNow('time');
    };
    tick();
    S.timer = setInterval(tick, 250);
  }

  // ---------- overlays ----------
  // While a dialog or overlay is up, the quiz behind it can't be reached (inert), Tab stays inside it,
  // Esc does onEscape (if any), and closing puts focus back where it was. Returns the close function.
  // A message the teacher sent to everyone taking the quiz.
  function showNotice(text) {
    if (!S.el || !S.el.wrap) return;
    const old = S.el.wrap.querySelector('.notice-backdrop');
    if (old) old.remove();
    let release = null;
    const ok = h('button', { class: 'btn primary', type: 'button', text: 'OK' });
    const backdrop = h('div', { class: 'modal-backdrop notice-backdrop' },
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'notice-title', 'aria-describedby': 'notice-text' },
        h('h2', { id: 'notice-title', text: 'Message from your teacher' }),
        h('p', { id: 'notice-text', class: 'notice-text', text: String(text || '') }),
        h('div', { class: 'modal-actions' }, ok)));
    const close = () => { backdrop.remove(); if (release) release(); };
    ok.addEventListener('click', close);
    S.el.wrap.append(backdrop);
    release = holdFocus(backdrop, close);
    ok.focus();
  }

  function holdFocus(layer, onEscape) {
    const back = document.activeElement;
    const others = [...S.el.wrap.children].filter((el) => el !== layer && !el.inert);
    others.forEach((el) => { el.inert = true; });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      const f = [...layer.querySelectorAll('button, a[href], input, select, textarea')].filter((x) => !x.disabled && x.getClientRects().length);
      e.preventDefault();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      const next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length;
      f[next].focus();
    });
    return (refocus = true) => {
      others.forEach((el) => { el.inert = false; });
      if (refocus && back && back.isConnected && back !== document.body && back.focus) back.focus({ preventScroll: true });
      else if (refocus && S.el && S.el.main) S.el.main.focus({ preventScroll: true });
    };
  }
  function showFsOverlay() {
    if (S.done || !S.el || S.el.fsOverlay) return;
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Return to fullscreen', onclick: () => enterFullscreen() });
    const ov = h('div', { class: 'fs-overlay' },
      h('div', { class: 'fs-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fs-title' },
        h('h2', { id: 'fs-title', text: 'You left fullscreen' }),
        h('p', { text: 'Leaving fullscreen counts as cheating, and your teacher can see that you left. Go back to keep working.' }),
        h('div', { class: 'row-actions' }, btn, S.quiz ? h('button', { class: 'btn', type: 'button', text: 'Exit', onclick: () => openExit() }) : null)));
    S.el.fsOverlay = ov;
    S.el.wrap.append(ov);
    S.el.fsRelease = holdFocus(ov);
    btn.focus();
  }
  // Every time a student comes back to the window. It reads the same no matter how many times they left
  // or whether that cost them anything, so it gives nothing away.
  function showLeftWarning() {
    if (S.done || !S.el || S.el.fsOverlay || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    let release = null;
    const back = h('button', { class: 'btn primary', type: 'button', text: 'Back to the quiz', onclick: () => { backdrop.remove(); release(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal warn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'left-title', 'aria-describedby': 'left-text' },
        h('h2', { id: 'left-title', text: 'You left the quiz' }),
        h('p', { id: 'left-text', text: 'Leaving the quiz window counts as cheating, and your teacher can see that you left.' }),
        h('div', { class: 'modal-actions' }, back)));
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); back.click(); } });
    S.el.wrap.append(backdrop);
    release = holdFocus(backdrop, () => back.click());
    back.focus();
  }
  function hideFsOverlay() {
    if (S.el && S.el.fsOverlay) {
      S.el.fsOverlay.remove();
      S.el.fsOverlay = null;
      if (S.el.fsRelease) { S.el.fsRelease(); S.el.fsRelease = null; }
    }
  }

  // Students can always get out: turn in now, or leave with answers saved and come back later.
  function openExit() {
    if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    let release = null;
    const close = () => { backdrop.remove(); release(); };
    const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
    // Turn in shows the usual check first: unanswered questions, and that answers can't change after.
    const turnIn = h('button', { class: 'btn', type: 'button', text: 'Turn in', onclick: () => { backdrop.remove(); release(false); openSubmit(); } });
    const exit = h('button', { class: 'btn primary', type: 'button', text: 'Exit', onclick: () => { backdrop.remove(); release(false); exitQuiz(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exit-title' },
        h('h2', { id: 'exit-title', text: 'Exit the quiz?' }),
        h('p', { text: "Exiting counts as leaving the quiz unless your teacher told you to. Your answers are saved." }),
        h('div', { class: 'modal-actions' }, keep, timedExam() ? null : turnIn, exit)));
    S.el.wrap.append(backdrop);
    release = holdFocus(backdrop, close);
    keep.focus();
  }
  async function exitQuiz() {
    S.done = true;
    clearInterval(S.timer);
    hideFsOverlay();
    if (S.monitor && S.monitor.armed) await Promise.resolve(api.event('exit')).catch(() => {});
    disposeEditor();
    if (S.monitor) S.monitor.disarm(); // last heartbeat carries the answers
    exitFullscreen();
    const run = S.run;
    const me = S.me;
    S = freshState();
    S.run = run;
    S.me = me;
    S.el = null;
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Continue quiz' });
    const msg = h('p', { class: 'error', role: 'alert' });
    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Continue quiz'));
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: run.title }),
      h('div', { class: 'heading' }, h('h1', { text: 'You left the quiz' }), h('p', { text: 'Your answers are saved.' })),
      btn, msg)));
  }

  // Keyboard: 1–9 pick a choice, Enter goes to the next question (or opens Submit on the last one).
  function quizKeys(e) {
    if (S.done || !S.el || !S.quiz || e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.el.wrap.querySelector('.modal-backdrop, .fs-overlay')) return;
    const t = e.target;
    const typing = t && t.closest && t.closest('textarea, .monaco-editor, select, input[type="text"], input:not([type])');
    const q = S.quiz.questions[S.idx];
    if (S.dirOpen) {
      if (e.key === 'Enter' && !(t && t.closest && t.closest('button'))) { e.preventDefault(); closeDirections(); }
      return;
    }
    const onChoices = t === S.el.main || t === document.body || (t && t.closest && t.closest('.choices'));
    if (!typing && onChoices && e.shiftKey && /^Digit[1-9]$/.test(e.code) && (q.type === 'single' || q.type === 'multi')) {
      const x = S.el.main.querySelectorAll('.choice-x')[Number(e.code.slice(5)) - 1];
      if (x) { e.preventDefault(); x.click(); }
      return;
    }
    if (!typing && onChoices && /^[1-9]$/.test(e.key) && (q.type === 'single' || q.type === 'multi')) {
      const input = S.el.main.querySelectorAll('.choice input')[Number(e.key) - 1];
      if (!input) return;
      e.preventDefault();
      input.focus();
      if (q.type === 'single') { if (!input.checked) input.click(); } else input.click();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || q.type === 'code') return;
    const onChoice = t && t.closest && t.closest('.choice, .text-answer');
    if (!onChoice && t !== S.el.main && t !== document.body) return;
    e.preventDefault();
    S.el.next.click();
  }

  const timedExam = () => !!(S.run && !S.run.practice && S.deadline);
  function openSubmit() {
    if (timedExam()) return;
    const missing = S.quiz.questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter(Boolean);
    const marked = S.quiz.questions.map((q, i) => (isMarked(q) ? i + 1 : null)).filter(Boolean);
    if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    let release = null;
    const close = () => { backdrop.remove(); release(false); S.el.next.focus(); };
    const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
    const submit = h('button', { class: 'btn primary', type: 'button', text: 'Submit', onclick: () => { backdrop.remove(); release(false); submitNow(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'submit-title' },
        h('h2', { id: 'submit-title', text: 'Submit your quiz?' }),
        missing.length ? h('p', { text: `Unanswered: ${missing.length > 1 ? 'questions' : 'question'} ${missing.join(', ')}.` }) : null,
        marked.length ? h('p', { text: `Marked for review: ${marked.length > 1 ? 'questions' : 'question'} ${marked.join(', ')}.` }) : null,
        h('p', { class: 'muted', text: "You can't change answers after this." }),
        h('div', { class: 'modal-actions' }, keep, submit)));
    S.el.wrap.append(backdrop);
    release = holdFocus(backdrop, close);
    keep.focus();
  }

  // The monitor stays armed until the server confirms: a dropped connection at Submit keeps retrying.
  async function submitNow(reason) {
    if (S.done || S.submitting) return;
    S.submitting = true;
    clearInterval(S.timer);
    hideFsOverlay();
    const answers = serializeAnswers();
    const edits = S.monitor ? S.monitor.takeEdits() : []; // the replay's last few seconds
    const ov = submittingOverlay();
    for (let tries = 0; ; tries++) {
      try {
        S.result = await api.submit(answers, edits);
        break;
      } catch (e) {
        if (S.done) return;
        if (e.code === 'no_attempt') return leaveQuiz(signedOut);
        if (e.code === 'run_closed') return finishQuiz('ended');
        if (e.code === 'other_network') return leaveQuiz(() => screenJoin(ERRORS.other_network));
        if (tries === 1) ov.failed();
        const delay = Math.min(2000 * 2 ** tries, 15000);
        await new Promise((resolve) => {
          const t = setTimeout(resolve, delay);
          ov.retry.onclick = () => { clearTimeout(t); ov.trying(); resolve(); };
        });
      }
    }
    finishQuiz(reason === 'time' ? 'time' : 'submitted');
  }

  function submittingOverlay() {
    const title = h('h2', { id: 'turnin-title', text: 'Turning in your quiz…' });
    const text = h('p', { class: 'muted' });
    const retry = h('button', { class: 'btn primary', type: 'button', text: 'Try again', hidden: true });
    const backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'turnin-title' },
        title, text, h('div', { class: 'modal-actions' }, retry)));
    S.el.wrap.append(backdrop);
    holdFocus(backdrop);
    return {
      retry,
      failed() {
        title.textContent = "Couldn't reach the quiz server";
        text.textContent = 'Your answers are still here. Retrying automatically.';
        retry.hidden = false;
        retry.focus();
      },
      trying() { title.textContent = 'Turning in your quiz…'; },
    };
  }

  function finishQuiz(kind) {
    S.done = true;
    clearMarks();
    clearScratch();
    clearInterval(S.timer);
    hideFsOverlay();
    disposeEditor();
    if (S.monitor) S.monitor.disarm();
    exitFullscreen();
    screenDone(kind);
  }
  function endQuiz(kind) { finishQuiz(kind); }

  // Out of the quiz without turning anything in (the teacher reset or moved this attempt).
  function leaveQuiz(next) {
    teardown();
    S = freshState();
    next();
  }
  function signedOut() {
    S = freshState();
    screenJoin(ERRORS.no_attempt);
  }
  function screenClosed() {
    mount(entry(h('div', { class: 'panel', role: 'status' },
      h('p', { class: 'eyebrow', text: S.run ? S.run.title : 'BrowserQuiz' }),
      h('div', { class: 'heading' },
        h('h1', { text: 'This quiz is closed' })),
      h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Back to start', onclick: () => { S = freshState(); screenJoin(); } })))));
  }
  // Page reloaded mid-quiz: one button back in instead of the whole sign-in again.
  function screenContinue() {
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Continue quiz' });
    const msg = h('p', { class: 'error', role: 'alert' });
    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Continue quiz'));
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Your quiz is still open' }),
        h('p', { text: `Signed in as ${S.me.name}. The timer is still running.` })),
      btn, msg)));
    btn.focus();
  }

  // Same screen for everyone, invalidated or not: confetti and all.
  // Confetti from both bottom corners. A little physics so it moves like paper: launched up and inward,
  // slowed by the air, then drifting down slowly, swaying and flipping, fading near the bottom.
  function confetti() {
    const layer = h('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return layer;
    const colors = isDark()
      ? ['#7ea3ff', '#5ccb8a', '#ffa94d', '#f783ac', '#ffd43b', '#b197fc']
      : ['#2257d6', '#1b7f45', '#f08c00', '#e64980', '#fab005', '#7048e8'];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const pieces = [];
    for (let i = 0; i < 150; i++) {
      const left = i % 2 === 0;
      const el = h('span', { class: 'confetti' });
      el.style.width = rand(6, 11).toFixed(1) + 'px';
      el.style.height = rand(9, 17).toFixed(1) + 'px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      layer.append(el);
      const angle = rand(48, 82) * Math.PI / 180;
      const speed = rand(0.022, 0.035) * H; // px per frame at 60 fps
      pieces.push({
        el, x: left ? -12 : W + 12, y: H + 12,
        vx: Math.cos(angle) * speed * (left ? 1 : -1), vy: -Math.sin(angle) * speed,
        rot: rand(0, 360), spin: rand(-14, 14), flip: rand(0, 6.3), flipSpeed: rand(0.06, 0.18),
        sway: rand(0, 6.3), swaySpeed: rand(0.025, 0.06), swayAmp: rand(0.5, 1.6), fall: rand(2.2, 3.8),
        delay: rand(0, 20), age: 0, launched: false,
      });
    }
    let last = 0;
    const frame = (now) => {
      if (!layer.isConnected) { if (!last) requestAnimationFrame(frame); return; } // wait until it's on screen
      const dt = last ? Math.min(3, (now - last) / 16.7) : 1;
      last = now;
      let alive = 0;
      for (const p of pieces) {
        p.age += dt;
        if (p.age < p.delay) { alive++; continue; }
        if (!p.launched) { p.launched = true; p.el.style.opacity = '1'; }
        p.vx *= Math.pow(0.975, dt);
        p.vy = p.vy * Math.pow(0.985, dt) + 0.3 * dt;
        if (p.vy > p.fall) p.vy = p.fall; // paper falls slowly
        const falling = p.vy > 0;
        p.sway += p.swaySpeed * dt;
        p.x += (p.vx + (falling ? Math.sin(p.sway) * p.swayAmp : 0)) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt * (falling ? 0.4 : 1);
        p.flip += p.flipSpeed * dt;
        const fade = p.y > H * 0.8 ? Math.max(0, 1 - (p.y - H * 0.8) / (H * 0.2)) : 1;
        p.el.style.opacity = falling ? fade.toFixed(2) : '1';
        p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(0)}deg) scaleY(${Math.cos(p.flip).toFixed(2)})`;
        if (p.y < H + 30 && p.age < 900) alive++;
      }
      if (alive) requestAnimationFrame(frame);
      else layer.remove();
    };
    requestAnimationFrame(frame);
    return layer;
  }

  const DONE = {
    submitted: ['Submitted', null],
    time: ["Time's up", 'Your answers were turned in.'],
    ended: ['Quiz ended', 'Your teacher ended the quiz. Your answers were turned in.'],
    mine: ['Quiz ended', 'Your teacher ended your quiz. Your answers were turned in.'],
    already: ['Already turned in', null],
  };
  function screenDone(kind) {
    S.el = null;
    const quitSeb = !!(S.run && S.run.sebQuit && !cfg.preview); // in Safe Exam Browser: a button to quit it
    const [title, plain] = DONE[kind] || DONE.submitted;
    const text = plain;
    const r = cfg.preview && S.result && S.result.questions ? S.result : null;
    const screen = entry(h('div', { class: 'panel done-panel' },
      h('p', { class: 'eyebrow', text: S.quiz ? S.quiz.title : S.run ? S.run.title : '' }),
      h('div', { class: 'heading' }, h('h1', { text: title }), text ? h('p', { text }) : null),
      r ? h('div', { class: 'pv-score' },
        h('p', {}, 'Score: ', h('b', { text: `${r.score} / ${r.max}` })),
        h('ul', {}, r.questions.map((x) => h('li', {
          text: `Question ${x.n}: ${x.points == null ? 'not graded' : x.points} / ${x.max}${x.rubric ? ` (${x.rubric} by rubric)` : ''}`,
        }))),
        h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Start over', onclick: () => location.reload() }))) : null,
      cfg.demo ? h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Start the demo over', onclick: () => BQ.app.restart() })) : null));
    if (S.run && S.run.practice && !cfg.preview) {
      const retry = !S.run.corrections; // corrections: once, then the answers
      const again = h('button', { class: 'btn', type: 'button', text: 'Try again' });
      again.addEventListener('click', async () => {
        again.disabled = true;
        try {
          await api.practiceRetry();
          const run = S.run;
          const me = S.me;
          S = freshState();
          S.run = run;
          S.me = me;
          screenPractice();
        } catch (e) { again.disabled = false; }
      });
      const see = h('a', { class: 'btn primary', href: '/teacher/report.html?practice=1', target: '_blank', rel: 'noopener', text: 'See answers' });
      screen.querySelector('.panel').append(h('div', { class: 'row-actions' }, see, retry ? again : null));
    }
    if (quitSeb) {
      screen.querySelector('.panel').append(h('div', {}, h('a', { class: 'btn primary', href: '/seb-quit.html', text: 'Quit Safe Exam Browser' })));
    }
    if (kind !== 'already') screen.prepend(confetti());
    mount(screen);
  }

  // Teacher preview: straight into the quiz. No sign-in, monitor, fullscreen or timer; nothing is saved.
  async function startPreview() {
    let r;
    try {
      r = await api.start();
    } catch (e) {
      mount(entry(h('div', { class: 'panel' }, h('p', { class: 'error', role: 'alert', text: errorText(e) }))));
      return;
    }
    S.quiz = r.quiz;
    S.run = { title: r.quiz.title, timeLimitMin: r.quiz.timeLimitMin, questionCount: r.quiz.questions.length, outline: r.quiz.questions.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })), quizDirections: (r.quiz.directions && r.quiz.directions.quiz) || '', sections: r.quiz.sections || [], hasCode: r.quiz.questions.some((q) => q.type === 'code') };
    S.deadline = 0;
    S.answers = {};
    loadMarks();
    loadScratch();
    S.monitor = null;
    if (S.run.hasCode) loadMonaco().catch(() => {});
    screenQuiz();
  }

  // Teacher watching a student live (teacher/watch.js): the student's quiz, in their order, read-only. The
  // watch page sends what the student has on screen and their answers; this follows along.
  async function startWatch() {
    let r;
    try {
      r = await api.start();
    } catch (e) {
      // Not started yet (or a blip): wait and try again; the watch page says what's going on meanwhile.
      if (e.code === 'teacher_login') { mount(entry(h('div', { class: 'panel' }, h('p', { class: 'error', role: 'alert', text: errorText(e) })))); return; }
      setTimeout(startWatch, 2000);
      return;
    }
    S.quiz = r.quiz;
    S.run = { title: r.quiz.title, timeLimitMin: 0, questionCount: r.quiz.questions.length, outline: r.quiz.questions.map((q, i) => ({ type: q.type, points: q.points, name: q.name, n: i + 1 })), quizDirections: (r.quiz.directions && r.quiz.directions.quiz) || '', sections: r.quiz.sections || [], hasCode: r.quiz.questions.some((q) => q.type === 'code') };
    S.deadline = r.deadline || 0;
    S.skew = r.now ? r.now - Date.now() - (r.delay || 0) : 0;
    S.me = { name: r.name || '' };
    S.run.practice = !!r.practice;
    S.answers = restoreAnswers(r.answers || {});
    S.watchAnswers = JSON.stringify(r.answers || {});
    S.marks = { review: [], out: {} };
    S.scratch = { tool: 'pen', pages: {} };
    S.monitor = null;
    if (S.run.hasCode) loadMonaco().catch(() => {});
    screenQuiz();
  }
  function watchView(v, answers, extra) {
    if (!S || !S.el || !S.quiz) return false;
    // Turned in: the screen they got, confetti and all
    if (v && v.done) {
      S.done = true;
      clearInterval(S.timer);
      disposeEditor();
      screenDone(DONE[v.done] ? v.done : 'submitted');
      return { where: 'Turned in' };
    }
    let redraw = false;
    let padDraw = false;
    const q = S.quiz.questions[S.idx];
    // Their sample runs' results, and their scratchpad pages
    if (extra && extra.runs && JSON.stringify(extra.runs) !== S.watchRuns) {
      S.watchRuns = JSON.stringify(extra.runs);
      S.results = JSON.parse(S.watchRuns);
      if (q && (q.type === 'code' || q.type === 'fill')) redraw = true;
    }
    if (extra && extra.pages) { S.scratch.pages = extra.pages; padDraw = true; }
    if (answers) {
      const text = JSON.stringify(answers);
      if (text !== S.watchAnswers) {
        const before = S.answers;
        S.watchAnswers = text;
        S.answers = restoreAnswers(answers);
        // Code goes into the editor's model as it is; anything else is redrawn.
        for (const x of S.quiz.questions) {
          if (x.type !== 'code') { if (x === q && JSON.stringify(before[x.id]) !== JSON.stringify(S.answers[x.id])) redraw = true; continue; }
          const a = S.answers[x.id];
          if (!a) continue;
          for (const l of x.languages) {
            const m = S.models[x.id + ':' + l];
            if (m && !m.isDisposed() && m.getValue() !== a.code[l]) m.setValue(a.code[l]);
          }
        }
        if (q && q.type === 'code' && !S.editor) redraw = true; // the plain box
      }
    }
    if (v && v.marks && JSON.stringify(v.marks) !== JSON.stringify(S.marks)) { S.marks = v.marks; redraw = true; }
    if (v) {
      const i = v.q ? S.quiz.questions.findIndex((x) => x.id === v.q) : -1;
      if (v.review) {
        if (!S.reviewOpen) { S.reviewOpen = true; S.dirOpen = false; redraw = true; }
      } else if (i >= 0 && (S.reviewOpen || S.idx !== i || S.dirOpen !== v.dir || S.introOpen !== v.intro)) {
        Object.assign(S, { reviewOpen: false, idx: i, dirOpen: v.dir, introOpen: v.intro });
        redraw = true;
      }
      const cq = S.quiz.questions[S.idx];
      if (v.lang && cq && cq.type === 'code' && S.answers[cq.id] && S.answers[cq.id].language !== v.lang && cq.languages.includes(v.lang)) {
        S.answers[cq.id].language = v.lang;
        redraw = true;
      }
    }
    if (v && typeof v.dark === 'boolean' && v.dark !== isDark()) { // their light or dark
      document.documentElement.dataset.theme = v.dark ? 'dark' : 'light';
      onThemeChange();
    }
    if (v && v.deadline !== undefined) S.deadline = v.deadline || 0; // extra time
    if (v && typeof v.phone === 'boolean' && v.phone !== !!S.watchPhone) { S.watchPhone = v.phone; redraw = true; } // their plain code box
    if (v && S.scratch && typeof v.tool === 'string' && v.tool !== S.scratch.tool) { S.scratch.tool = v.tool; padDraw = true; }
    if (v && S.el.scratch && S.el.scratch.hidden === !!v.pad) { // the scratchpad opened or closed
      S.el.scratch.hidden = !v.pad;
      S.el.wrap.classList.toggle('with-scratch', !!v.pad);
      S.el.scratchBtn.setAttribute('aria-pressed', String(!!v.pad));
      if (S.editor) S.editor.layout();
      padDraw = true;
    }
    if (v && S.el.save && v.save !== undefined && v.save !== S.watchSave) { // Saved / Saving… / Not saved yet
      S.watchSave = v.save;
      S.el.save.textContent = v.save === 'saved' ? 'Saved' : v.save === 'saving' ? 'Saving…' : v.save === 'offline' ? 'Not saved yet' : '';
      S.el.save.classList.toggle('bad', v.save === 'offline');
    }
    if (redraw) renderQuestion();
    else if (padDraw) renderScratch();
    if (v && v.hl) watchHighlights(v.hl);
    if (v) watchModal(v.modal);
    if (v && v.fs && !S.el.fsOverlay) showFsOverlay();
    else if (v && !v.fs && S.el.fsOverlay) hideFsOverlay();
    if (v) watchToast(v.toast);
    if (v && v.ed) watchEditor(v.ed);
    if (v) {
      S.el.main.scrollTop = v.scroll || 0;
      S.el.wrap.scrollTop = v.wscroll || 0;
      const open = S.el.wrap.querySelector('.nav-pop');
      if (v.nav && !open) openNavigator();
      else if (!v.nav && open) open.remove();
    }
    const total = S.quiz.questions.length;
    return { where: S.reviewOpen ? 'Check your work' : S.dirOpen ? (S.introOpen ? 'Directions' : partOf(S.idx).title) : `Question ${S.idx + 1} of ${total}` };
  }
  // Their highlights, put on the same text here
  function watchHighlights(hl) {
    for (const [key, node] of S.kept) {
      const want = hl[key] || [];
      if (JSON.stringify(marksIn(node)) === JSON.stringify(want)) continue;
      for (const m of [...node.querySelectorAll('mark.hl')]) { const parent = m.parentNode; m.replaceWith(...m.childNodes); parent.normalize(); }
      for (const [a, b] of want) {
        const r = rangeAt(node, a, b);
        if (!r.collapsed && node.contains(r.startContainer) && node.contains(r.endContainer)) addHighlight(r, true);
      }
    }
  }
  function watchToast(text) {
    let t = S.el.wrap.querySelector('.toast');
    if (!text) { if (t) t.remove(); return; }
    if (!t) { t = h('div', { class: 'toast' }); S.el.wrap.append(t); }
    if (t.textContent !== text) t.textContent = text;
  }
  // Their code editor: scrolled where theirs is, with their cursor and selection drawn in
  function watchEditor(ed) {
    if (!S.editor || !window.monaco) return;
    S.editor.setScrollTop(ed.top || 0);
    S.editor.setScrollLeft(ed.left || 0);
    const m = window.monaco;
    const model = S.editor.getModel();
    const marks = [];
    if (ed.sel) {
      const [al, ac, pl, pc] = ed.sel;
      if (al !== pl || ac !== pc) marks.push({ range: new m.Range(al, ac, pl, pc), options: { className: 'watch-sel' } });
      marks.push({ range: new m.Range(pl, pc, pl, pc), options: { beforeContentClassName: 'watch-caret' } });
    }
    if (S.watchDecs && S.watchDecs.model !== model && !S.watchDecs.model.isDisposed()) S.watchDecs.model.deltaDecorations(S.watchDecs.ids, []);
    const ids = model.deltaDecorations(S.watchDecs && S.watchDecs.model === model ? S.watchDecs.ids : [], marks);
    S.watchDecs = { model, ids };
  }
  // The dialog they have open, if it's one of these
  function watchModal(id) {
    const show = { 'submit-title': openSubmit, 'turnin-title': submittingOverlay, 'exit-title': openExit, 'left-title': showLeftWarning };
    const want = typeof id === 'string' && show[id] ? id : null;
    const open = S.el.wrap.querySelector('.modal-backdrop:not(.nav-pop)');
    const title = open && open.querySelector('[aria-labelledby]');
    const now = title ? title.getAttribute('aria-labelledby') : null;
    if (now === want) return;
    if (open) { open.remove(); for (const el of S.el.wrap.children) el.inert = false; }
    if (want && !S.el.wrap.querySelector('.modal-backdrop')) show[want]();
  }

  // ---------- lifecycle ----------
  function teardown() {
    if (!S) return;
    clearInterval(S.timer);
    clearInterval(S.poll);
    disposeEditor();
    if (S.monitor) S.monitor.disarm();
    Object.values(S.models).forEach((m) => m && !m.isDisposed() && m.dispose());
    exitFullscreen();
  }

  BQ.app = {
    start(el, apiImpl) {
      root = el;
      api = apiImpl || BQ.api;
      S = freshState();
      if (cfg.watch) { startWatch(); return; }
      if (cfg.preview) { startPreview(); return; }
      if (!api.resume) { screenJoin(); return; }
      let code = null;
      try {
        const u = new URL(location.href);
        code = u.searchParams.get('code');
        if (code) { u.searchParams.delete('code'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
      } catch (e) { /* no code */ }
      // Already signed in on this browser (say, after a reload)? Pick up where they were.
      api.resume().then((r) => {
        if (!r || !r.status) return screenJoin(null, code);
        S.run = r.run;
        S.me = { name: r.name };
        // not started yet: the rules again (agreeing goes back into lockdown; doing it twice counts as
        // reopening, server /api/ready)
        if (r.status === 'waiting' || r.status === 'admitted') return screenRules();
        if (r.status === 'active') return screenContinue();
        return screenJoin(null, code); // turned in already: free to join the next quiz
      }).catch(() => screenJoin(null, code));
    },
    restart() {
      teardown();
      if (api && api.reset) api.reset();
      S = freshState();
      screenJoin();
    },
    // Teacher watch page: follow the student's screen and answers. False until the quiz is on screen.
    watch: (view, answers, extra) => watchView(view, answers, extra),
  };
})();
