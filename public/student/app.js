// BrowserQuiz student app: join → type your name → wait for admit → rules → fullscreen quiz → submitted.
// The student never learns anything about integrity from this UI. The server keeps all of that.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});
  const cfg = Object.assign({ demo: false, monacoBase: '/vendor/monaco/' }, window.BQ_CONFIG || {});

  const CODE_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
  const LANG_NAMES = { java: 'Java', python: 'Python' };
  const THEME_KEY = 'bq-theme';
  const KIND = { single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', method: 'Write a method', class: 'Write a class' };
  // Default directions per part, AP style. A quiz can override any of them with quiz.directions[type].
  const PARTS = {
    single: { title: 'Multiple choice', text: 'Each question has exactly one correct answer. Pick the best one. A blank answer earns no credit, so answer every question.' },
    multi: { title: 'Select all that apply', text: 'Each question has one or more correct answers. Select every correct answer. You earn credit only when you select all of the correct answers and none of the wrong ones.' },
    text: { title: 'Short answer', text: "Type a short answer in the box. Spelling counts. Capital letters and extra spaces don't." },
    code: { title: 'Free response', text: "Write your answer in the code editor. When a question allows more than one language, pick the one you know best. Use Run examples to check your code before you move on. Assume any imports you need are already there and that inputs follow the question's description. You can earn partial credit." },
  };
  const ERRORS = {
    bad_code: "That code doesn't match an open quiz. Check the board and try again.",
    run_closed: 'This quiz is closed.',
    wrong_network: 'This quiz only opens from the school network.',
    too_many: 'Too many wrong codes. Wait a minute, then try again.',
    bad_id: "That student ID doesn't match the name you picked. Try again.",
    name_locked: 'Too many wrong tries for this name. Wait 30 seconds, then try again.',
    already_started: 'This name already started on another computer. Ask your teacher.',
    network: "Can't reach the quiz server. Check your connection and try again.",
  };

  let api;
  let root;
  let S;

  function freshState() {
    return {
      run: null, me: null, quiz: null, idx: 0, answers: {}, deadline: 0, skew: 0,
      monitor: null, models: {}, editor: null, editorSubs: [], parts: [], partsSeen: new Set(), dirOpen: false,
      timer: 0, poll: 0, done: false, runBusy: false, results: {}, el: null,
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

  function toast(msg) {
    const host = (S.el && S.el.wrap) || root;
    let t = host.querySelector('.toast');
    if (!t) {
      t = h('div', { class: 'toast', role: 'status' });
      host.append(t);
    }
    t.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.remove(), 2600);
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
        m.editor.defineTheme('bq-light', {
          base: 'vs', inherit: true,
          rules: [
            { token: 'keyword', foreground: '0033b3' }, { token: 'string', foreground: '067d17' },
            { token: 'number', foreground: '1750eb' }, { token: 'comment', foreground: '8c8c8c', fontStyle: 'italic' },
            { token: 'type.identifier', foreground: '7a3e9d' },
          ],
          colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f5f7', 'editorLineNumber.foreground': '#98a1ab' },
        });
        m.editor.defineTheme('bq-dark', {
          base: 'vs-dark', inherit: true, rules: [],
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
        m.editor.colorizeElement(code, { theme: editorTheme() }).then(() => {
          if (!inlineCode) return;
          // keep inline code inline: unwrap the colorizer's block wrapper and line breaks
          code.querySelectorAll('div').forEach((d) => d.replaceWith(...d.childNodes));
          code.querySelectorAll('br').forEach((b) => b.remove());
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
      h('div', { class: 'heading' }, h('h1', { text: 'Join your quiz' }), h('p', { text: 'Type the code your teacher put on the board.' })),
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
      try { res = await api.findNames({ runId: run.runId, q }); } catch (e) { return; }
      if (mine !== seq || picked) return;
      const matches = (res && res.matches) || [];
      if (!matches.length) {
        list.hidden = true;
        hint.hidden = false;
        hint.textContent = 'No names match. Check the spelling.';
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
      h('div', { class: 'heading' }, h('h1', { text: 'Who are you?' }), h('p', { text: 'Start typing your name, then pick it.' })),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-name', text: 'Your name' }), name, list, hint),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-id', text: 'Student ID' }), sid),
      btn, msg,
      demoHint('Demo: type ', h('b', { text: 'Av' }), ', pick Ava Martinez, ID ', h('b', { text: '204511' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!picked) { msg.textContent = 'Start typing your name, then pick it from the list.'; name.focus(); return; }
      if (!sid.value.trim()) { msg.textContent = 'Type your student ID.'; sid.focus(); return; }
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        await api.attempt({ runId: run.runId, rosterId: picked.id, studentId: sid.value.trim() });
        S.me = { name: picked.name };
        screenWait();
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
        h('p', { text: `You're signed in as ${S.me.name}. Your teacher will let you in. Keep this page open.` })),
      h('p', { class: 'hint', text: 'Checking every few seconds…' }),
      demoHint('Demo: click ', h('b', { text: 'Admit' }), ' in the teacher view.'))));
    clearInterval(S.poll);
    const check = async () => {
      try {
        const r = await api.admitStatus();
        if (r && r.admitted) { clearInterval(S.poll); screenRules(); }
      } catch (e) { /* keep polling */ }
    };
    S.poll = setInterval(check, cfg.demo ? 700 : 2000);
  }

  function prechecks() {
    const ext = window.screen && 'isExtended' in window.screen ? window.screen.isExtended : null;
    const desktop = window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 900;
    return [
      { label: 'One display', ok: ext !== true, note: ext === true ? 'Unplug the second monitor, then reload this page.' : null },
      { label: 'Fullscreen works', ok: !!document.fullscreenEnabled, note: document.fullscreenEnabled ? null : 'Open this page in Edge or Chrome.' },
      { label: 'Desktop computer', ok: desktop, note: desktop ? null : 'Take the quiz on a lab computer with a mouse.' },
    ];
  }

  function screenRules(err) {
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const checks = prechecks();
    const blocked = !cfg.demo && checks.some((c) => !c.ok);
    const n = S.run.questionCount;
    const mins = S.run.timeLimitMin;
    const agree = h('input', { type: 'checkbox', id: 'agree' });
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start quiz', disabled: true });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    agree.addEventListener('change', () => { btn.disabled = !agree.checked || blocked; });

    const panel = h('div', { class: 'panel wide' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' },
        h('h1', { text: 'Before you start' }),
        h('p', { text: mins ? `${plural(n, 'question')} in ${plural(mins, 'minute')}.` : `${plural(n, 'question')}.` })),
      h('ul', { class: 'rules' },
        h('li', { text: 'The quiz runs in fullscreen.' }),
        h('li', { text: 'Leaving the quiz window, switching tabs or apps, or leaving fullscreen is recorded and reported to your teacher.' }),
        h('li', { text: 'Mouse and keyboard activity is recorded.' }),
        h('li', { text: 'Pasting from outside the quiz is blocked. Copying and pasting inside your own answers works.' }),
        S.run.hasCode ? h('li', { text: 'Code questions have a Run button that checks your code against the examples.' }) : null),
      h('ul', { class: 'checks', 'aria-label': 'Computer checks' },
        checks.map((c) => h('li', {},
          h('span', { class: 'check-mark ' + (c.ok ? 'ok' : 'bad'), text: c.ok ? 'OK' : 'Fix' }),
          c.label,
          c.note ? h('span', { class: 'check-note', text: c.note }) : null))),
      h('label', { class: 'agree', for: 'agree' }, agree, h('span', { text: 'I read the rules' })),
      btn, msg,
      cfg.demo && checks.some((c) => !c.ok) ? demoHint('Demo: checks are shown but not enforced here.') : null);

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Starting…'; msg.textContent = '';
      const fsOk = await enterFullscreen(); // has to run inside the click
      if (!fsOk && !cfg.demo) {
        msg.textContent = 'Your browser blocked fullscreen. Click Start again.';
        btn.disabled = false; btn.textContent = 'Start quiz';
        return;
      }
      let r;
      try {
        r = await api.start();
      } catch (ex) {
        exitFullscreen();
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Start quiz';
        return;
      }
      S.quiz = r.quiz;
      S.deadline = r.deadline || 0;
      S.skew = r.now ? r.now - Date.now() : 0;
      S.answers = restoreAnswers(r.saved || {});
      S.monitor = new BQ.Monitor(api, {
        fullscreen: fsOk,
        getAnswers: serializeAnswers,
        onFullscreenLost: showFsOverlay,
        onFullscreenBack: hideFsOverlay,
        onPasteBlocked: () => toast('Pasting from outside the quiz is blocked.'),
        onSave: () => toast('Saved. Your answers save automatically.'),
        onBeat: (res) => { if (res && res.now) S.skew = res.now - Date.now(); },
      });
      screenQuiz();
      S.monitor.arm();
    });

    mount(entry(panel));
    agree.focus();
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
    return true;
  }
  function setAnswer(qid, value) {
    if (value === undefined) delete S.answers[qid];
    else S.answers[qid] = value;
    if (S.monitor) S.monitor.markAnswersDirty();
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
    const progress = h('span', { class: 'qbar-progress' });
    const timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
    const main = h('main', { class: 'qmain', tabindex: '-1' });
    const sheet = h('nav', { class: 'sheet', 'aria-label': 'Questions' });
    const prev = h('button', { class: 'btn ghost', type: 'button', text: 'Back', onclick: () => go(S.idx - 1) });
    const next = h('button', { class: 'btn', type: 'button' });
    next.addEventListener('click', () => {
      if (S.dirOpen) return closeDirections();
      if (S.idx === S.quiz.questions.length - 1) return openSubmit();
      go(S.idx + 1);
    });
    const wrap = h('div', { class: 'quiz' },
      h('header', { class: 'qbar' }, h('span', { class: 'qbar-name', text: S.quiz.title }), progress, timer, themeButton()),
      main,
      h('footer', { class: 'qnav' }, prev, sheet, next));
    S.el = { wrap, main, progress, timer, sheet, prev, next, fsOverlay: null };
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
    S.el.progress.textContent = `Question ${S.idx + 1} of ${total}`;
    S.el.prev.disabled = S.idx === 0;
    const last = S.idx === total - 1;
    S.el.next.textContent = S.dirOpen ? 'Continue' : last ? 'Review and submit' : 'Next';
    S.el.next.className = 'btn' + (last && !S.dirOpen ? ' primary' : '');
    const view = S.dirOpen ? directionsView(partOf(S.idx)) : q.type === 'code' ? codeView(q) : basicView(q);
    S.el.main.replaceChildren(view);
    colorize(view);
    renderSheet();
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

  function metaRow(q, kind) {
    return h('div', { class: 'meta-row' },
      h('span', {}, kind, ' ', h('button', { class: 'link-btn', type: 'button', text: 'Directions', onclick: openDirections })),
      h('span', { text: plural(q.points, 'point') }));
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
      q.choices.forEach((c, i) => {
        const id = `${q.id}-c${i}`;
        const input = h('input', {
          type: multi ? 'checkbox' : 'radio', name: q.id, id, value: i,
          checked: multi ? Array.isArray(cur) && cur.includes(i) : cur === i,
        });
        input.addEventListener('change', () => {
          if (!multi) return setAnswer(q.id, i);
          const set = new Set(Array.isArray(S.answers[q.id]) ? S.answers[q.id] : []);
          if (input.checked) set.add(i); else set.delete(i);
          setAnswer(q.id, set.size ? [...set].sort((a, b) => a - b) : undefined);
        });
        list.append(h('label', { class: 'choice', for: id }, input, h('span', { class: 'choice-text' }, BQ.md.renderInline(c, { lang: S.quiz.language }))));
      });
      view.append(list);
    } else if (q.type === 'text') {
      const input = h('input', { class: 'input text-answer', id: q.id + '-text', autocomplete: 'off', spellcheck: 'false', maxlength: '500' });
      input.value = S.answers[q.id] || '';
      input.addEventListener('input', () => setAnswer(q.id, input.value.trim() ? input.value : undefined));
      view.append(h('label', { class: 'field', for: q.id + '-text' }, h('span', { class: 'field-label', text: 'Your answer' }), input));
    }
    return view;
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

    const view = h('div', { class: 'qview wide' },
      h('div', { class: 'code-q' },
        h('section', { class: 'code-left' },
          metaRow(q, KIND[q.mode] || KIND.method), prompt(q),
          h('h2', { class: 'sub', text: 'Examples' }), samples),
        h('section', { class: 'code-right', 'aria-label': 'Code editor' },
          h('div', { class: 'editor-bar' }, langCtl, h('span', { class: 'spacer' }), h('span', { class: 'save-state', text: 'Autosaved' }), runBtn),
          host, results)));
    renderResults(q, results);
    mountEditor(q, host, ans);
    return view;
  }

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
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: 14, lineHeight: 22,
        tabSize: 4, insertSpaces: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 }, renderLineHighlight: 'line',
        // No hints: these would be free help on an exam.
        quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: 'off',
        parameterHints: { enabled: false }, hover: { enabled: false }, snippetSuggestions: 'none',
        acceptSuggestionOnEnter: 'off', tabCompletion: 'off', inlineSuggest: { enabled: false },
        // Clipboard and drag rules are enforced by the monitor.
        contextmenu: false, dragAndDrop: false, emptySelectionClipboard: false, links: false,
      });
      S.editor = editor;
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
    results.replaceChildren(h('p', { class: 'results-empty', text: 'Running your code against the examples…' }));
    try {
      S.results[key] = await api.run({ questionId: q.id, language: ans.language, code: ans.code[ans.language] });
    } catch (ex) {
      S.results[key] = { status: 'error', message: errorText(ex) };
    }
    S.runBusy = false;
    if (results.isConnected) renderResults(q, results);
    let left = 5;
    const tick = () => {
      if (!btn.isConnected) return;
      if (left <= 0) { btn.disabled = false; btn.textContent = 'Run examples'; return; }
      btn.textContent = `Run again in ${left}s`;
      left--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function renderResults(q, el) {
    const ans = S.answers[q.id];
    const lang = ans.language;
    const r = S.results[q.id + ':' + lang];
    if (!r) {
      el.replaceChildren(h('p', { class: 'results-empty', text: 'Run your code against the examples.' }));
      return;
    }
    const parts = [];
    if (r.simulated) parts.push(h('p', { class: 'demo-note', text: 'Demo: simulated result. In the real app your code compiles and runs in the sandboxed runner.' }));
    if (r.status === 'compile_error') {
      parts.push(h('p', { class: 'res-head bad', text: "Didn't compile" }), h('pre', { class: 'res-pre', text: r.message || '' }));
    } else if (r.status === 'runtime_error') {
      parts.push(h('p', { class: 'res-head bad', text: 'Crashed while running' }), h('pre', { class: 'res-pre', text: r.message || '' }));
    } else if (r.status === 'error') {
      parts.push(h('p', { class: 'res-head bad', text: 'Run failed' }), h('p', { text: r.message || '' }));
    } else {
      const tests = r.tests || [];
      const passed = tests.filter((t) => t.pass).length;
      parts.push(h('p', { class: 'res-head ' + (passed === tests.length ? 'good' : 'bad'), text: `${passed} of ${tests.length} examples passed` }));
      parts.push(h('ul', { class: 'res-tests' }, tests.map((t) => h('li', {},
        h('span', { class: 'res-mark ' + (t.pass ? 'ok' : 'bad'), text: t.pass ? 'Pass' : 'Fail' }),
        h('code', { class: 'res-call', 'data-lang': lang, text: t.call }),
        t.pass ? null : h('span', { class: 'res-detail' }, 'Expected ', h('code', { 'data-lang': lang, text: t.expected }), ', got ', h('code', { 'data-lang': lang, text: t.got }))))));
    }
    if (r.stdout) parts.push(h('p', { class: 'res-sub', text: 'Printed output' }), h('pre', { class: 'res-pre', text: r.stdout }));
    el.replaceChildren(...parts);
    colorize(el);
  }

  function renderSheet() {
    if (!S.el || !S.quiz) return;
    S.el.sheet.replaceChildren(...S.quiz.questions.map((q, i) => {
      const done = isAnswered(q);
      return h('button', {
        type: 'button', class: 'sheet-dot' + (done ? ' answered' : '') + (i === S.idx ? ' current' : ''),
        'aria-label': `Question ${i + 1}${done ? ', answered' : ''}`, 'aria-current': i === S.idx ? 'step' : null,
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
      if (left <= 0) submitNow();
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
        h('h2', { id: 'fs-title', text: 'The quiz runs in fullscreen' }),
        h('p', { class: 'muted', text: 'Go back to fullscreen to keep working. Your answers are saved.' }),
        h('div', {}, btn)));
    S.el.fsOverlay = ov;
    S.el.wrap.append(ov);
    btn.focus();
  }
  function hideFsOverlay() {
    if (S.el && S.el.fsOverlay) { S.el.fsOverlay.remove(); S.el.fsOverlay = null; }
  }

  function openSubmit() {
    const missing = S.quiz.questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter(Boolean);
    let backdrop;
    const close = () => { backdrop.remove(); S.el.next.focus(); };
    const keep = h('button', { class: 'btn', type: 'button', text: 'Keep working', onclick: close });
    const submit = h('button', { class: 'btn primary', type: 'button', text: 'Submit', onclick: () => { backdrop.remove(); submitNow(); } });
    backdrop = h('div', { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'submit-title' },
        h('h2', { id: 'submit-title', text: 'Submit your quiz?' }),
        h('p', { text: missing.length ? `You haven't answered question${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.` : 'You answered every question.' }),
        h('p', { class: 'muted', text: "You can't change answers after you submit." }),
        h('div', { class: 'modal-actions' }, keep, submit)));
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    S.el.wrap.append(backdrop);
    keep.focus();
  }

  async function submitNow() {
    if (S.done) return;
    S.done = true;
    clearInterval(S.timer);
    hideFsOverlay();
    const answers = serializeAnswers();
    disposeEditor();
    if (S.monitor) S.monitor.disarm();
    let ok = true;
    try { await api.submit(answers); } catch (e) { ok = false; }
    exitFullscreen();
    screenDone(ok);
  }

  // Same screen for everyone, invalidated or not: confetti and all.
  function confetti() {
    const layer = h('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
    const colors = isDark()
      ? ['#7ea3ff', '#5ccb8a', '#ffa94d', '#f783ac', '#ffd43b']
      : ['#2257d6', '#1b7f45', '#f08c00', '#e64980', '#fab005'];
    for (let i = 0; i < 48; i++) {
      let left = Math.random() * 98;
      const top = 6 + Math.random() * 80;
      if (left > 30 && left < 70 && top < 36) left = left < 50 ? left - 22 : left + 22; // keep the message readable
      const piece = h('span', { class: 'confetti' });
      piece.style.left = left.toFixed(1) + '%';
      piece.style.top = top.toFixed(1) + '%';
      piece.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
      const bit = h('span');
      bit.style.background = colors[i % colors.length];
      bit.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
      piece.append(bit);
      layer.append(piece);
    }
    return layer;
  }

  function screenDone(ok) {
    S.el = null;
    const screen = entry(h('div', { class: 'panel done-panel' },
      h('p', { class: 'eyebrow', text: S.quiz ? S.quiz.title : '' }),
      h('div', { class: 'heading' },
        h('h1', { text: ok ? 'Submitted' : 'Saved, not confirmed' }),
        h('p', { text: ok ? 'Your teacher will release scores. You can close this page.' : "We couldn't confirm your submission, but your answers were autosaved. Tell your teacher." })),
      cfg.demo ? h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Start the demo over', onclick: () => BQ.app.restart() })) : null));
    if (ok) screen.prepend(confetti());
    mount(screen);
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
      screenJoin();
    },
    restart() {
      teardown();
      if (api && api.reset) api.reset();
      S = freshState();
      screenJoin();
    },
  };
})();
