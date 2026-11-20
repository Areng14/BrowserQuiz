// BrowserQuiz student app: join → type your name → wait for admit → rules → fullscreen quiz → submitted.
// The student never learns anything about integrity from this UI. The server keeps all of that.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});
  const cfg = Object.assign({ demo: false, monacoBase: '/vendor/monaco/' }, window.BQ_CONFIG || {});

  const CODE_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
  const LANG_NAMES = { java: 'Java', python: 'Python' };
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
    bad_code: 'No open quiz with that code.',
    run_closed: 'This quiz is closed.',
    wrong_network: 'This quiz only opens from the school network.',
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
  };

  let api;
  let root;
  let S;
  let keysBound = false;

  function freshState() {
    return {
      run: null, me: null, quiz: null, idx: 0, answers: {}, deadline: 0, skew: 0,
      monitor: null, models: {}, editor: null, editorSubs: [], parts: [], partsSeen: new Set(), dirOpen: false,
      timer: 0, poll: 0, done: false, runBusy: false, results: {}, el: null, warned: {}, saveState: 'saved',
      marks: null,
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
  const mount = (node) => root.replaceChildren(node);
  const demoHint = (...kids) => (cfg.demo ? h('p', { class: 'demo-hint' }, ...kids) : null);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function toast(msg, ms) {
    const host = (S.el && S.el.wrap) || root;
    let t = host.querySelector('.toast');
    if (!t) {
      t = h('div', { class: 'toast', role: 'status' });
      host.append(t);
    }
    t.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.remove(), ms || 2600);
  }

  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }
  function exitFullscreen() {
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
          rules: rules({ keyword: '0033b3', control: '0033b3', string: '067d17', number: '1750eb', comment: '8c8c8c', type: '7a3e9d', fn: '00627a', ident: '16191d' }),
          colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f5f7', 'editorLineNumber.foreground': '#98a1ab' },
        });
        m.editor.defineTheme('bq-dark', {
          base: 'vs-dark', inherit: true,
          rules: rules({ keyword: '569cd6', control: 'c586c0', string: 'ce9178', number: 'b5cea8', comment: '6a9955', type: '4ec9b0', fn: 'dcdcaa', ident: '9cdcfe' }),
          colors: { 'editor.background': '#1b1e23', 'editor.lineHighlightBackground': '#22262c', 'editorLineNumber.foreground': '#6e7681' },
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
        const endsWithNewline = /\n$/.test(code.textContent);
        m.editor.colorizeElement(code, { theme: editorTheme() }).then(() => {
          if (!inlineCode && !inFill) return;
          // keep inline code inline: unwrap the colorizer's block wrapper (and, for inline code, line breaks)
          code.querySelectorAll('div').forEach((d) => d.replaceWith(...d.childNodes));
          if (inlineCode) code.querySelectorAll('br').forEach((b) => b.remove());
          else if (!endsWithNewline && code.lastChild && code.lastChild.nodeName === 'BR') code.lastChild.remove();
        }).catch(() => {});
      });
    }).catch(() => {});
  }

  // ---------- entry screens ----------
  function entry(...kids) {
    return h('main', { class: 'screen center' }, h('div', { class: 'corner' }, themeButton()), ...kids);
  }

  function screenJoin(err) {
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (input.value.length !== 6) { msg.textContent = 'Join codes are 6 characters.'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Joining…'; msg.textContent = '';
      try {
        S.run = await api.join(input.value);
        screenWho();
      } catch (ex) {
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Join';
        input.focus();
      }
    });
    mount(entry(form));
    input.focus();
  }

  // Type your name, then pick it. The server only ever sends back names that match what you typed.
  function screenWho(err) {
    const run = S.run;
    let picked = null;
    let seq = 0;
    let timer = 0;
    const name = h('input', { class: 'input', id: 'student-name', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div', { class: 'name-list', id: 'name-list', 'aria-label': 'Matching names', hidden: true });
    const hint = h('p', { class: 'hint', hidden: true });
    const sid = h('input', { class: 'input mono', id: 'student-id', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '20' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Continue' });

    function close() { list.hidden = true; hint.hidden = true; }
    function pick(m) {
      picked = m;
      name.value = m.name;
      name.classList.add('picked');
      close();
      sid.focus();
    }
    async function search() {
      const q = name.value.trim();
      if (q.length < 2) { close(); return; }
      const mine = ++seq;
      let res;
      try { res = await api.findNames({ runId: run.runId, q }); } catch (e) {
        if (mine !== seq) return;
        list.hidden = true;
        hint.hidden = false;
        hint.textContent = e.code === 'too_many' ? 'Busy. Keep typing in a moment.' : errorText(e);
        return;
      }
      if (mine !== seq || picked) return;
      const matches = (res && res.matches) || [];
      if (!matches.length) {
        list.hidden = true;
        hint.hidden = false;
        hint.textContent = 'No match.';
        return;
      }
      hint.hidden = true;
      list.replaceChildren(...matches.map((m) => h('button', { type: 'button', class: 'name-opt', text: m.name, onclick: () => pick(m) })));
      list.hidden = false;
    }
    name.addEventListener('input', () => {
      picked = null;
      name.classList.remove('picked');
      clearTimeout(timer);
      timer = setTimeout(search, 120);
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); list.firstChild.focus(); }
      if (e.key === 'Enter' && !picked && !list.hidden && list.firstChild) { e.preventDefault(); list.firstChild.click(); }
    });
    list.addEventListener('keydown', (e) => {
      const opts = [...list.children];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < opts.length - 1) { e.preventDefault(); opts[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? opts[i - 1] : name).focus(); }
      if (e.key === 'Escape') { close(); name.focus(); }
    });

    const form = h('form', { class: 'panel', novalidate: true },
      h('p', { class: 'eyebrow', text: run.title }),
      h('div', { class: 'heading' }, h('h1', { text: 'Who are you?' })),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-name', text: 'Your name' }), name, list, hint),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-id', text: 'Student ID' }), sid),
      btn, msg,
      demoHint('Demo: type ', h('b', { text: 'Av' }), ', pick Ava Martinez, ID ', h('b', { text: '204511' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!picked) { msg.textContent = 'Pick your name from the list.'; name.focus(); return; }
      if (!sid.value.trim()) { msg.textContent = 'Type your student ID.'; sid.focus(); return; }
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        await api.attempt({ runId: run.runId, rosterId: picked.id, studentId: sid.value.trim() });
        S.me = { name: picked.name };
        if (run.practice) screenRules(); else screenWait();
      } catch (ex) {
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Continue';
        sid.select();
      }
    });
    mount(entry(form));
    name.focus();
  }

  function screenWait() {
    mount(entry(h('div', { class: 'panel', role: 'status' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Waiting for your teacher' }),
        h('p', { text: `Signed in as ${S.me.name}.` })),
      demoHint('Demo: click ', h('b', { text: 'Admit' }), ' in the teacher view.'))));
    clearInterval(S.poll);
    const check = async () => {
      try {
        const r = await api.admitStatus();
        if (r && r.admitted) { clearInterval(S.poll); screenRules(); }
      } catch (e) {
        if (e.code === 'run_closed') { clearInterval(S.poll); screenClosed(); }
        else if (e.code === 'no_attempt') { clearInterval(S.poll); signedOut(); }
        // anything else: keep polling
      }
    };
    S.poll = setInterval(check, cfg.demo ? 700 : 2000);
  }

  function prechecks() {
    const ext = window.screen && 'isExtended' in window.screen ? window.screen.isExtended : null;
    const desktop = window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 900;
    return [
      { label: 'One display', ok: ext !== true, note: ext === true ? 'Unplug the second monitor, then reload this page.' : null },
      { label: 'Fullscreen works', ok: !!document.fullscreenEnabled, note: document.fullscreenEnabled ? null : 'Open this page in Edge or Chrome.' },
      { label: 'Desktop computer', ok: desktop, note: desktop ? null : window.matchMedia('(pointer: fine)').matches ? 'Maximize this window.' : 'Take the quiz on a lab computer with a mouse.' },
    ];
  }

  function screenPractice(err) {
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const n = S.run.questionCount;
    const mins = S.run.timeLimitMin;
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start'));
    mount(entry(h('div', { class: 'panel' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Practice' }),
        h('p', { text: mins ? `${plural(n, 'question')} in ${plural(mins, 'minute')}.` : `${plural(n, 'question')}.` }),
        h('p', { text: 'You see the answers when you finish.' })),
      btn, msg)));
    btn.focus();
  }

  function screenRules(err) {
    if (S.run.practice) return screenPractice(err);
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const n = S.run.questionCount;
    const mins = S.run.timeLimitMin;
    const agree = h('input', { type: 'checkbox', id: 'agree' });
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start quiz', disabled: true });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const checkList = h('ul', { class: 'checks', 'aria-label': 'Computer checks' });
    let blocked = false;
    // Re-check when the window changes size or a display is plugged in or out.
    function renderChecks() {
      const checks = prechecks();
      blocked = !cfg.demo && !S.run.seb && checks.some((c) => !c.ok); // SEB locks the screen itself
      checkList.hidden = !checks.some((c) => !c.ok);
      checkList.replaceChildren(...checks.filter((c) => !c.ok).map((c) => h('li', {},
        h('span', { class: 'check-mark ' + (c.ok ? 'ok' : 'bad'), text: c.ok ? 'OK' : 'Fix' }),
        c.label,
        c.note ? h('span', { class: 'check-note', text: c.note }) : null)));
      if (btn.textContent === 'Start quiz') btn.disabled = !agree.checked || blocked;
    }
    renderChecks();
    const onChange = () => { if (!checkList.isConnected) { window.removeEventListener('resize', onChange); return; } renderChecks(); };
    window.addEventListener('resize', onChange);
    if (window.screen && window.screen.addEventListener) window.screen.addEventListener('change', onChange);
    agree.addEventListener('change', () => { btn.disabled = !agree.checked || blocked; });

    const panel = h('div', { class: 'panel wide' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Before you start' }),
        h('p', { text: mins ? `${plural(n, 'question')} in ${plural(mins, 'minute')}.` : `${plural(n, 'question')}.` })),
      h('div', { class: 'cheat-rule', role: 'note' },
        h('p', { class: 'cheat-title', text: 'Leaving the quiz counts as cheating.' }),
        h('p', { text: 'That means switching to another window, tab or app, leaving fullscreen, reloading or closing this page, or using Exit when your teacher didn\'t say to. Your teacher sees each time it happens.' })),
      h('ul', { class: 'rules' },
        h('li', { text: 'The quiz runs in fullscreen.' }),
        h('li', { text: 'Mouse and keyboard activity is recorded.' }),
        h('li', { text: 'Pasting from outside the quiz is blocked.' }),
        mins ? h('li', { text: 'The quiz turns itself in when time runs out.' }) : null),
      checkList,
      h('label', { class: 'agree', for: 'agree' }, agree, h('span', { text: 'I understand that leaving the quiz counts as cheating' })),
      btn, msg,
      cfg.demo && prechecks().some((c) => !c.ok) ? demoHint('Demo: checks are shown but not enforced here.') : null);

    btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start quiz'));
    mount(entry(panel));
    agree.focus();
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
    S.quiz = r.quiz;
    S.deadline = r.deadline || 0;
    S.skew = r.now ? r.now - Date.now() : 0;
    S.answers = restoreAnswers(r.saved || {});
    loadMarks();
    loadScratch();
    S.monitor = new BQ.Monitor(api, {
      integrity: !practice,
      fullscreen: fsOk,
      getAnswers: serializeAnswers,
      onFullscreenLost: showFsOverlay,
      onFullscreenBack: hideFsOverlay,
      onReturn: showLeftWarning,
      onPasteBlocked: () => toast('Pasting from outside the quiz is blocked.'),
      onSave: () => toast('Saved'),
      onReloadBlocked: () => toast('Reloading is off during the quiz.'),
      onBeat: onBeat,
      onBeatError: onBeatError,
    });
    screenQuiz();
    S.monitor.arm();
  }

  // ---------- connection + save state ----------
  function onBeat(res, info) {
    if (!S.el) return;
    if (res && res.now) S.skew = res.now - Date.now();
    if (res && res.deadline && res.deadline !== S.deadline) S.deadline = res.deadline; // teacher gave extra time
    if (res && res.done && !S.submitting) return endQuiz('mine'); // the teacher ended this student's quiz
    setOnline(true);
    if (info && info.answers && S.saveState === 'saving') setSave('saved');
  }
  function onBeatError(err, failures) {
    if (S.done || !S.el) return;
    if (err && err.code === 'run_closed') return endQuiz('ended');
    if (err && err.code === 'no_attempt') return leaveQuiz(signedOut);
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
    if (S.monitor) S.monitor.markAnswersDirty();
    if (S.saveState !== 'offline') setSave('saving');
    renderSheet();
  }

  // ---------- parts + directions ----------
  // Back-to-back questions of the same type form a part. Entering a part the first time shows its directions.
  function buildParts(questions) {
    const parts = [];
    questions.forEach((q, i) => {
      const last = parts[parts.length - 1];
      if (last && last.type === q.type) last.end = i;
      else parts.push({ type: q.type, start: i, end: i });
    });
    const custom = S.quiz.directions || {};
    parts.forEach((p, n) => {
      const base = PARTS[p.type] || { title: 'Questions', text: '' };
      p.n = n + 1;
      p.title = base.title;
      p.text = custom[p.type] || base.text;
    });
    return parts;
  }
  const partOf = (i) => S.parts.find((p) => i >= p.start && i <= p.end);

  // ---------- quiz ----------
  function screenQuiz() {
    S.parts = buildParts(S.quiz.questions);
    S.idx = 0;
    S.dirOpen = true;
    const timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
    const save = h('span', { class: 'save-state', role: 'status' });
    const conn = h('div', { class: 'conn-banner', role: 'alert', hidden: true },
      'Offline. Keep working, answers save when you reconnect.');
    const main = h('main', { class: 'qmain', tabindex: '-1' });
    const sheet = h('nav', { class: 'sheet', 'aria-label': 'Questions' });
    const prev = h('button', { class: 'btn ghost', type: 'button', text: 'Back', onclick: () => go(S.idx - 1) });
    const next = h('button', { class: 'btn', type: 'button' });
    next.addEventListener('click', () => {
      if (S.dirOpen) return closeDirections();
      if (S.idx === S.quiz.questions.length - 1) return openSubmit();
      go(S.idx + 1);
    });
    const scratchBtn = h('button', { class: 'btn small ghost', type: 'button', text: 'Scratchpad', 'aria-pressed': 'false', 'aria-controls': 'scratch', onclick: () => toggleScratch() });
    const scratch = h('aside', { class: 'scratch', id: 'scratch', 'aria-label': 'Scratchpad' });
    scratch.hidden = true;
    const wrap = h('div', { class: 'quiz' },
      h('header', { class: 'qbar' }, h('span', { class: 'qbar-name', text: S.quiz.title }), save, timer, scratchBtn, themeButton(),
        cfg.preview ? null : h('button', { class: 'btn small ghost', type: 'button', text: 'Exit', onclick: () => openExit() })),
      conn,
      main,
      scratch,
      h('footer', { class: 'qnav' }, prev, sheet, next));
    S.el = { wrap, main, timer, sheet, prev, next, save, conn, scratch, scratchBtn, fsOverlay: null };
    if (!keysBound) { document.addEventListener('keydown', quizKeys); keysBound = true; }
    S.saveState = 'saved';
    mount(wrap);
    renderQuestion();
    startTimer();
  }

  function go(i) {
    if (i < 0 || i >= S.quiz.questions.length) return;
    S.idx = i;
    S.dirOpen = !S.partsSeen.has(partOf(i).n);
    renderQuestion();
    S.el.main.scrollTop = 0;
    S.el.main.focus({ preventScroll: true });
  }
  function openDirections() {
    S.dirOpen = true;
    renderQuestion();
    S.el.main.focus({ preventScroll: true });
  }
  function closeDirections() {
    S.partsSeen.add(partOf(S.idx).n);
    S.dirOpen = false;
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
    S.el.prev.disabled = S.idx === 0;
    const last = S.idx === total - 1;
    S.el.next.textContent = S.dirOpen ? 'Continue' : last ? 'Review and submit' : 'Next';
    S.el.next.className = 'btn' + (last && !S.dirOpen ? ' primary' : '');
    const views = { code: codeView, output: outputView, trace: traceView, fill: fillView, essay: essayView };
    let view = S.dirOpen ? directionsView(partOf(S.idx)) : (views[q.type] || basicView)(q);
    // Shared material sits beside the question (above it on narrow screens). Code questions put it in
    // their left column themselves.
    if (!S.dirOpen && q.shared && !view.classList.contains('wide')) view = h('div', { class: 'shared-split' }, sharedBlock(q), view);
    S.el.main.replaceChildren(view);
    colorize(view);
    renderSheet();
    renderScratch();
  }

  // ---------- scratchpad ----------
  // The student's own working space: one board a question, where they draw and drop typed notes
  // anywhere. It stays in this browser (per run and student), isn't graded, and is cleared when the
  // quiz is turned in.
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
    const board = h('div', { class: 'scratch-board', role: 'application', 'aria-label': `Scratchpad for question ${S.idx + 1}` }, canvas, notes);
    const save = () => { if (items.length) pages[q.id] = items; else delete pages[q.id]; saveScratch(); };
    const btn = (name, label, on) => {
      const b = h('button', { class: 'scratch-tool', type: 'button', title: label, 'aria-label': label, onclick: on });
      b.append(padIcon(name));
      return b;
    };
    const tools = { pen: btn('pen', 'Pen', () => pick('pen')), text: btn('text', 'Text', () => pick('text')), eraser: btn('eraser', 'Eraser', () => pick('eraser')) };
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
      notes.replaceChildren(...items.filter((it) => it.s != null).map(noteEl));
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
      h('div', { class: 'scratch-group' }, undo, clear),
      h('span', { class: 'scratch-q', text: `Question ${S.idx + 1}` }),
      close);
    return [head, board];
  }

  function directionsView(part) {
    const seen = S.partsSeen.has(part.n);
    const range = part.start === part.end ? `Question ${part.start + 1}` : `Questions ${part.start + 1}–${part.end + 1}`;
    return h('div', { class: 'qview' },
      h('div', { class: 'meta-row' }, h('span', { text: `Part ${part.n} of ${S.parts.length}` }), h('span', { text: range })),
      h('h1', { text: part.title }),
      h('p', { class: 'directions' }, h('strong', { text: 'Directions: ' }), part.text),
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
      h('span', {}, kind, ' ', h('button', { class: 'link-btn', type: 'button', text: 'Directions', onclick: openDirections })),
      h('span', { class: 'meta-right' }, markButton(q), h('span', { text: plural(q.points, 'point') })));
  }

  // A passage, case or listing that several questions use, written once in the quiz.
  function sharedBlock(q) {
    const m = q.shared && S.quiz.shared ? S.quiz.shared[q.shared] : null;
    if (!m) return null;
    return h('section', { class: 'shared', 'aria-label': m.title || 'Shared material' },
      m.title ? h('p', { class: 'shared-title', text: m.title }) : null,
      m.text ? h('div', { class: 'prompt' }, BQ.md.render(m.text, { lang: S.quiz.language })) : null,
      m.image ? h('img', { class: 'qimg', src: api.assetUrl(m.image), alt: m.imageAlt || '' }) : null);
  }

  function prompt(q) {
    return [
      h('div', { class: 'prompt' }, BQ.md.render(q.prompt, { lang: S.quiz.language })),
      q.image ? h('img', { class: 'qimg', src: api.assetUrl(q.image), alt: q.imageAlt || '' }) : null,
    ];
  }

  function basicView(q) {
    const view = h('div', { class: 'qview' }, metaRow(q, KIND[q.type] || 'Question'), prompt(q));
    if (q.type === 'single' || q.type === 'multi') {
      const multi = q.type === 'multi';
      const cur = S.answers[q.id];
      const list = h('div', { class: 'choices', role: multi ? 'group' : 'radiogroup', 'aria-label': 'Answer choices' });
      const picked = (i) => (multi ? Array.isArray(S.answers[q.id]) && S.answers[q.id].includes(i) : S.answers[q.id] === i);
      const rows = q.choices.map((c, i) => {
        const id = `${q.id}-c${i}`;
        const input = h('input', {
          type: multi ? 'checkbox' : 'radio', name: q.id, id, value: i,
          checked: multi ? Array.isArray(cur) && cur.includes(i) : cur === i,
        });
        // Crossing out: picking a crossed-out choice brings it back, and crossing out the picked one unpicks it.
        const x = h('button', { class: 'choice-x', type: 'button' });
        const row = h('div', { class: 'choice-row' },
          h('label', { class: 'choice', for: id }, input, h('span', { class: 'choice-text' }, BQ.md.renderInline(c, { lang: S.quiz.language }))), x);
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
        input.checked = picked(i);
        x.setAttribute('aria-pressed', String(out));
        x.setAttribute('aria-label', `${out ? 'Undo cross out' : 'Cross out'} choice ${i + 1}`);
        x.title = out ? '' : i < 9 ? `Cross out (Shift+${i + 1})` : 'Cross out';
        x.replaceChildren(out ? 'Undo' : h('span', { class: 'x-icon', text: 'abc' }));
      });
      paint();
      view.append(list);
    } else if (q.type === 'text') {
      const input = h('input', { class: 'input text-answer', id: q.id + '-text', autocomplete: 'off', spellcheck: 'false', maxlength: '500' });
      input.value = S.answers[q.id] || '';
      input.addEventListener('input', () => setAnswer(q.id, input.value.trim() ? input.value : undefined));
      view.append(h('label', { class: 'field', for: q.id + '-text' }, h('span', { class: 'field-label', text: 'Your answer' }), input));
    }
    return view;
  }

  // ---------- predict the output, trace tables, fill in the blanks, written answers ----------
  const codeBlock = (code, lang) => h('pre', { class: 'md-code' }, h('code', { 'data-lang': lang || (S.quiz.language !== 'none' ? S.quiz.language : null), text: code }));
  // A textarea that grows with what's typed; Tab indents when it holds code.
  function growArea(attrs, value, onChange, codeLike) {
    const ta = h('textarea', Object.assign({ class: 'input long-answer' + (codeLike ? ' mono' : ''), spellcheck: codeLike ? 'false' : 'true', autocomplete: 'off' }, attrs));
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
    const table = h('table', { class: 'trace' });
    table.append(h('thead', {}, h('tr', {}, q.columns.map((c) => h('th', { text: c })))),
      h('tbody', {}, q.cells.map((row, r) => h('tr', {}, row.map((given, c) => {
        if (given != null) return h('td', { class: 'given', text: given });
        const input = h('input', { class: 'trace-cell', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${q.columns[c]}, row ${r + 1}`, 'data-r': r, 'data-c': c });
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
      const input = h('input', { class: 'blank', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Blank ${i + 1}` });
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
    runBtn.addEventListener('click', () => runCode(q, runBtn, results));
    runCooldown(runBtn);

    const view = h('div', { class: 'qview wide' },
      h('div', { class: 'code-q' },
        h('section', { class: 'code-left' },
          metaRow(q, KIND[q.mode] || KIND.method), sharedBlock(q), prompt(q),
          h('h2', { class: 'sub', text: 'Examples' }), samples),
        h('section', { class: 'code-right', 'aria-label': 'Code editor' },
          h('div', { class: 'editor-bar' }, langCtl, h('span', { class: 'spacer' }), runBtn),
          host, results)));
    renderResults(q, results);
    mountEditor(q, host, ans);
    return view;
  }

  const editorFontSize = () => (window.innerWidth >= 2300 ? 18 : window.innerWidth >= 1700 ? 16 : 14);

  function mountEditor(q, host, ans) {
    const lang = ans.language;
    host.append(h('div', { class: 'editor-loading', text: 'Loading editor…' }));
    loadMonaco().then((m) => {
      if (!host.isConnected || S.quiz.questions[S.idx] !== q || ans.language !== lang) return;
      host.replaceChildren();
      const key = q.id + ':' + lang;
      if (!S.models[key] || S.models[key].isDisposed()) S.models[key] = m.editor.createModel(ans.code[lang], lang);
      const editor = m.editor.create(host, {
        model: S.models[key], theme: editorTheme(), automaticLayout: true, ariaLabel: 'Code answer',
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
      S.errDecor = [];
      markErrorLines(S.results[q.id + ':' + lang]);
      if (S.monitor) {
        S.editorSubs.push(S.monitor.trackEditor(editor, q.id));
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
    }).catch(() => {
      if (!host.isConnected) return;
      const ta = h('textarea', { class: 'code-fallback', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Code answer' });
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
    });
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
    } else if (r.status === 'runtime_error') {
      parts.push(h('p', { class: 'res-head bad', text: 'Crashed' }), h('pre', { class: 'res-pre', text: r.message || '' }));
    } else if (r.status === 'error') {
      parts.push(h('p', { class: 'res-head bad', text: 'Run failed' }), h('p', { text: r.message || '' }));
    } else {
      const tests = r.tests || [];
      const passed = tests.filter((t) => t.pass).length;
      parts.push(h('p', { class: 'res-head ' + (passed === tests.length ? 'good' : 'bad'), text: `${passed} of ${tests.length} examples passed` }));
      parts.push(h('ul', { class: 'res-tests' }, tests.map((t) => h('li', { class: t.pass ? 'ok' : 'bad' },
        h('span', { class: 'res-mark', text: t.pass ? '✓' : '✗', 'aria-label': t.pass ? 'Passed' : 'Failed' }),
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

  function renderSheet() {
    if (!S.el || !S.quiz) return;
    S.el.sheet.replaceChildren(...S.quiz.questions.map((q, i) => {
      const done = isAnswered(q);
      const marked = isMarked(q);
      return h('button', {
        type: 'button', class: 'sheet-dot' + (done ? ' answered' : '') + (i === S.idx ? ' current' : '') + (marked ? ' marked' : ''),
        'aria-label': `Question ${i + 1}${done ? ', answered' : ''}${marked ? ', marked for review' : ''}`, 'aria-current': i === S.idx ? 'step' : null,
        text: String(i + 1), onclick: () => go(i),
      });
    }));
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
          if (left > (mins - 1) * 60000 + 30000) toast(`${plural(mins, 'minute')} left.`, 6000);
        }
      }
      if (left <= 0) submitNow('time');
    };
    tick();
    S.timer = setInterval(tick, 250);
  }

  // ---------- overlays ----------
  function showFsOverlay() {
    if (S.done || !S.el || S.el.fsOverlay) return;
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Return to fullscreen', onclick: () => enterFullscreen() });
    const ov = h('div', { class: 'fs-overlay' },
      h('div', { class: 'fs-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fs-title' },
        h('h2', { id: 'fs-title', text: 'You left fullscreen' }),
        h('p', { text: 'Leaving fullscreen counts as cheating, and your teacher can see that you left. Go back to keep working.' }),
        h('div', { class: 'row-actions' }, btn, h('button', { class: 'btn', type: 'button', text: 'Exit', onclick: () => openExit() }))));
    S.el.fsOverlay = ov;
    S.el.wrap.append(ov);
    btn.focus();
  }
  // Every time a student comes back to the window. It reads the same no matter how many times they left
  // or whether that cost them anything, so it gives nothing away.
  function showLeftWarning() {
    if (S.done || !S.el || S.el.fsOverlay || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    const back = h('button', { class: 'btn primary', type: 'button', text: 'Back to the quiz', onclick: () => { backdrop.remove(); S.el.main.focus({ preventScroll: true }); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal warn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'left-title', 'aria-describedby': 'left-text' },
        h('h2', { id: 'left-title', text: 'You left the quiz' }),
        h('p', { id: 'left-text', text: 'Leaving the quiz window counts as cheating, and your teacher can see that you left.' }),
        h('div', { class: 'modal-actions' }, back)));
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); back.click(); } });
    S.el.wrap.append(backdrop);
    back.focus();
  }
  function hideFsOverlay() {
    if (S.el && S.el.fsOverlay) { S.el.fsOverlay.remove(); S.el.fsOverlay = null; }
  }

  // Students can always get out: turn in now, or leave with answers saved and come back later.
  function openExit() {
    if (S.done || !S.el || S.el.wrap.querySelector('.modal-backdrop')) return;
    let backdrop;
    const close = () => { backdrop.remove(); };
    const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
    const turnIn = h('button', { class: 'btn', type: 'button', text: 'Turn in', onclick: () => { backdrop.remove(); submitNow(); } });
    const exit = h('button', { class: 'btn primary', type: 'button', text: 'Exit', onclick: () => { backdrop.remove(); exitQuiz(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exit-title' },
        h('h2', { id: 'exit-title', text: 'Exit the quiz?' }),
        h('p', { text: "Exiting counts as leaving the quiz unless your teacher told you to. Your answers are saved." }),
        h('div', { class: 'modal-actions' }, keep, turnIn, exit)));
    const buttons = [keep, turnIn, exit];
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    });
    S.el.wrap.append(backdrop);
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
    if (!typing && e.shiftKey && /^Digit[1-9]$/.test(e.code) && (q.type === 'single' || q.type === 'multi')) {
      const x = S.el.main.querySelectorAll('.choice-x')[Number(e.code.slice(5)) - 1];
      if (x) { e.preventDefault(); x.click(); }
      return;
    }
    if (!typing && /^[1-9]$/.test(e.key) && (q.type === 'single' || q.type === 'multi')) {
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

  function openSubmit() {
    const missing = S.quiz.questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter(Boolean);
    const marked = S.quiz.questions.map((q, i) => (isMarked(q) ? i + 1 : null)).filter(Boolean);
    let backdrop;
    const close = () => { backdrop.remove(); S.el.next.focus(); };
    const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
    const submit = h('button', { class: 'btn primary', type: 'button', text: 'Submit', onclick: () => { backdrop.remove(); submitNow(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'submit-title' },
        h('h2', { id: 'submit-title', text: 'Submit your quiz?' }),
        missing.length ? h('p', { text: `Unanswered: ${missing.length > 1 ? 'questions' : 'question'} ${missing.join(', ')}.` }) : null,
        marked.length ? h('p', { text: `Marked for review: ${marked.length > 1 ? 'questions' : 'question'} ${marked.join(', ')}.` }) : null,
        h('p', { class: 'muted', text: "You can't change answers after this." }),
        h('div', { class: 'modal-actions' }, keep, submit)));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { // keep focus inside the dialog
        e.preventDefault();
        (document.activeElement === keep ? submit : keep).focus();
      }
    });
    S.el.wrap.append(backdrop);
    keep.focus();
  }

  // The monitor stays armed until the server confirms: a dropped connection at Submit keeps retrying.
  async function submitNow(reason) {
    if (S.done || S.submitting) return;
    S.submitting = true;
    clearInterval(S.timer);
    hideFsOverlay();
    const answers = serializeAnswers();
    const ov = submittingOverlay();
    for (let tries = 0; ; tries++) {
      try {
        S.result = await api.submit(answers);
        break;
      } catch (e) {
        if (S.done) return;
        if (e.code === 'no_attempt') return leaveQuiz(signedOut);
        if (e.code === 'run_closed') return finishQuiz('ended');
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
    submitted: ['Submitted', 'You can close this page.'],
    time: ["Time's up", 'Your answers were turned in.'],
    ended: ['Quiz ended', 'Your teacher ended the quiz. Your answers were turned in.'],
    mine: ['Quiz ended', 'Your teacher ended your quiz. Your answers were turned in.'],
    already: ['Already turned in', null],
  };
  function screenDone(kind) {
    S.el = null;
    const [title, text] = DONE[kind] || DONE.submitted;
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
      screen.querySelector('.panel').append(h('div', { class: 'row-actions' }, see, again));
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
    S.run = { title: r.quiz.title, timeLimitMin: r.quiz.timeLimitMin, questionCount: r.quiz.questions.length, hasCode: r.quiz.questions.some((q) => q.type === 'code') };
    S.deadline = 0;
    S.answers = {};
    loadMarks();
    loadScratch();
    S.monitor = null;
    if (S.run.hasCode) loadMonaco().catch(() => {});
    screenQuiz();
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
      if (cfg.preview) { startPreview(); return; }
      if (!api.resume) { screenJoin(); return; }
      // Already signed in on this browser (say, after a reload)? Pick up where they were.
      api.resume().then((r) => {
        if (!r || !r.status) return screenJoin();
        S.run = r.run;
        S.me = { name: r.name };
        if (r.status === 'waiting') return screenWait();
        if (r.status === 'admitted') return screenRules();
        if (r.status === 'active') return screenContinue();
        return screenJoin(); // turned in already: free to join the next quiz
      }).catch(() => screenJoin());
    },
    restart() {
      teardown();
      if (api && api.reset) api.reset();
      S = freshState();
      screenJoin();
    },
  };
})();
