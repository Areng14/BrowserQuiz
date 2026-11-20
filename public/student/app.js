// BrowserQuiz student app: join → pick name → wait for admit → rules → fullscreen quiz → submitted.
// The student never learns anything about integrity from this UI. The server keeps all of that.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});
  const cfg = Object.assign({ demo: false, monacoBase: '/vendor/monaco/' }, window.BQ_CONFIG || {});

  const LETTERS = 'ABCDEFGH';
  const CODE_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
  const LANG_NAMES = { java: 'Java', python: 'Python' };
  const KIND_LABEL = { single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer' };
  const ERRORS = {
    bad_code: "That code doesn't match an open quiz. Check the board and try again.",
    run_closed: 'This quiz is closed.',
    wrong_network: 'This quiz only opens from the school network.',
    too_many: 'Too many wrong codes. Wait a minute, then try again.',
    bad_id: "That student ID doesn't match the name you picked. Try again.",
    name_locked: 'Too many wrong tries for this name. Wait 30 seconds, then try again.',
    already_started: 'This name already started on another computer. Ask your teacher.',
    pick_name: 'Pick your name from the list.',
    network: "Can't reach the quiz server. Check your connection and try again.",
  };

  let api;
  let root;
  let S;

  function freshState() {
    return {
      run: null, me: null, quiz: null, idx: 0, answers: {}, deadline: 0, skew: 0,
      monitor: null, fsWanted: false, models: {}, editor: null, editorSubs: [],
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

  // ---------- Monaco (bundled, same origin) ----------
  let monacoPromise = null;
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function editorTheme() { return isDark() ? 'bq-dark' : 'bq-light'; }
  function syncTheme() { if (window.monaco) window.monaco.editor.setTheme(editorTheme()); }
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
          base: 'vs', inherit: true, rules: [],
          colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f3f6f9', 'editorLineNumber.foreground': '#98a3ae' },
        });
        m.editor.defineTheme('bq-dark', {
          base: 'vs-dark', inherit: true, rules: [],
          colors: { 'editor.background': '#161c24', 'editor.lineHighlightBackground': '#1b222c', 'editorLineNumber.foreground': '#5c6774' },
        });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => m.editor.remeasureFonts());
        resolve(m);
      };
      s.onerror = () => reject(new Error('monaco failed to load'));
      document.head.append(s);
    });
    monacoPromise.catch(() => { monacoPromise = null; });
    return monacoPromise;
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function colorize(scope) {
    if (!window.monaco) return;
    scope.querySelectorAll('pre.md-code code[data-lang]:not([data-colored])').forEach((code) => {
      code.setAttribute('data-colored', '');
      window.monaco.editor.colorizeElement(code, { theme: editorTheme() }).catch(() => {});
    });
  }

  // ---------- screens: join ----------
  function screenJoin(err) {
    const input = h('input', {
      id: 'join-code', class: 'code-input', maxlength: '6', autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'characters', inputmode: 'text', 'aria-label': 'Join code', placeholder: '······',
    });
    input.addEventListener('input', () => {
      const v = input.value.toUpperCase().replace(CODE_ALPHABET, '').slice(0, 6);
      if (v !== input.value) input.value = v;
    });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Join' });
    const form = h('form', { class: 'card', novalidate: true },
      h('span', { class: 'brand', text: 'BrowserQuiz' }),
      h('div', { class: 'field' }, h('h1', { text: 'Join your quiz' }), h('p', { class: 'lead', text: 'Type the code your teacher put on the board.' })),
      input, msg, btn,
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
    mount(h('main', { class: 'screen center' }, form));
    input.focus();
  }

  // ---------- screens: who are you ----------
  function screenWho(err) {
    const run = S.run;
    const search = h('input', { class: 'input', id: 'roster-search', type: 'search', placeholder: 'Search your name', autocomplete: 'off', 'aria-label': 'Search your name' });
    const list = h('ul', { class: 'roster-list', role: 'radiogroup', 'aria-label': 'Your name' });
    let picked = null;
    function renderList() {
      const term = search.value.trim().toLowerCase();
      const items = run.roster.filter((r) => !term || r.name.toLowerCase().includes(term));
      list.replaceChildren(...(items.length ? items.map((r) => {
        const id = 'rs-' + r.id;
        const input = h('input', { type: 'radio', name: 'roster', id, value: r.id, class: 'sr-only', checked: picked === r.id });
        input.addEventListener('change', () => { picked = r.id; });
        return h('li', { class: 'roster-item' }, h('label', { for: id }, input, h('span', { class: 'roster-dot', 'aria-hidden': 'true' }), h('span', { text: r.name })));
      }) : [h('li', { class: 'roster-empty', text: 'No names match. Check the spelling.' })]));
    }
    search.addEventListener('input', renderList);
    renderList();
    const sid = h('input', { class: 'input mono', id: 'student-id', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '20' });
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Continue' });
    const form = h('form', { class: 'card', novalidate: true },
      h('span', { class: 'brand', text: run.title }),
      h('div', { class: 'field' }, h('h1', { text: 'Who are you?' }), h('p', { class: 'lead', text: 'Pick your name, then type your student ID.' })),
      h('div', { class: 'roster' }, search, list),
      h('label', { class: 'field', for: 'student-id' }, h('span', { class: 'field-label', text: 'Student ID' }), sid),
      msg, btn,
      demoHint('Demo: pick ', h('b', { text: 'Ava Martinez' }), ' with ID ', h('b', { text: '204511' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!picked) { msg.textContent = ERRORS.pick_name; return; }
      if (!sid.value.trim()) { msg.textContent = 'Type your student ID.'; sid.focus(); return; }
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        await api.attempt({ runId: run.runId, rosterId: picked, studentId: sid.value.trim() });
        S.me = { name: (run.roster.find((r) => r.id === picked) || {}).name || 'Student' };
        screenWait();
      } catch (ex) {
        msg.textContent = errorText(ex);
        btn.disabled = false; btn.textContent = 'Continue';
        sid.select();
      }
    });
    mount(h('main', { class: 'screen center' }, form));
    search.focus();
  }

  // ---------- screens: waiting for admit ----------
  function screenWait() {
    mount(h('main', { class: 'screen center' },
      h('div', { class: 'card waiting', role: 'status' },
        h('div', { class: 'waiting-dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
        h('h1', { text: 'Waiting for your teacher' }),
        h('p', { class: 'lead', text: `You're signed in as ${S.me.name}. Your teacher will let you in. Keep this page open.` }),
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

  // ---------- screens: rules + prechecks ----------
  function prechecks() {
    const ext = window.screen && 'isExtended' in window.screen ? window.screen.isExtended : null;
    const desktop = window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 900;
    return [
      { label: 'One display', ok: ext !== true, blocking: ext === true,
        note: ext === true ? 'Unplug the second monitor, then reload this page.' : null },
      { label: 'Fullscreen works', ok: !!document.fullscreenEnabled, blocking: !document.fullscreenEnabled,
        note: document.fullscreenEnabled ? null : 'Open this page in Edge or Chrome.' },
      { label: 'Desktop computer', ok: desktop, blocking: !desktop,
        note: desktop ? null : 'Take the quiz on a lab computer with a mouse.' },
    ];
  }

  function screenRules(err) {
    if (S.run.hasCode) loadMonaco().catch(() => {});
    const checks = prechecks();
    const blocked = !cfg.demo && checks.some((c) => c.blocking);
    const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
    const btn = h('button', { class: 'btn primary block', type: 'button', text: 'Start quiz', disabled: blocked });
    const minutes = S.run.timeLimitMin;
    const card = h('div', { class: 'card wide' },
      h('span', { class: 'brand', text: S.run.title }),
      h('div', { class: 'field' },
        h('h1', { text: 'Before you start' }),
        h('p', { class: 'lead', text: `${S.run.questionCount} questions${minutes ? ` · ${minutes} minutes` : ''}. The timer starts when you click Start.` })),
      h('ul', { class: 'rules' },
        h('li', { text: 'The quiz runs in fullscreen.' }),
        h('li', { text: 'Leaving the quiz window, switching tabs or apps, or leaving fullscreen is recorded and reported to your teacher.' }),
        h('li', { text: 'Mouse and keyboard activity is recorded.' }),
        h('li', { text: 'Pasting from outside the quiz is blocked. Copying and pasting inside your own answers works.' }),
        S.run.hasCode ? h('li', { text: 'Code questions have a Run button that checks your code against the examples.' }) : null),
      h('ul', { class: 'checks', 'aria-label': 'Computer checks' },
        checks.map((c) => h('li', { class: 'check' },
          h('span', { class: 'pill ' + (c.ok ? 'good' : c.blocking ? 'bad' : 'warn'), text: c.ok ? 'OK' : 'Fix' }),
          h('span', { text: c.label }),
          c.note ? h('span', { class: 'check-note', text: c.note }) : null))),
      msg, btn,
      cfg.demo && checks.some((c) => !c.ok) ? demoHint('Demo: checks are shown but not enforced here.') : null);

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Starting…'; msg.textContent = '';
      const fsOk = await enterFullscreen(); // must run inside the click
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
      S.fsWanted = fsOk;
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

    mount(h('main', { class: 'screen center' }, card));
    btn.focus();
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

  // ---------- quiz ----------
  function watermark(name) {
    const esc = String(name).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="210"><text x="30" y="118" transform="rotate(-18 190 105)" font-family="Arial, sans-serif" font-size="17" fill="#000">${esc} · BrowserQuiz</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }

  function screenQuiz() {
    const progress = h('span', { class: 'qbar-progress' });
    const timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
    const main = h('main', { class: 'qmain', tabindex: '-1' });
    const sheet = h('nav', { class: 'sheet', 'aria-label': 'Questions' });
    const prev = h('button', { class: 'btn ghost', type: 'button', text: 'Back', onclick: () => go(S.idx - 1) });
    const next = h('button', { class: 'btn', type: 'button' });
    next.addEventListener('click', () => (S.idx === S.quiz.questions.length - 1 ? openSubmit() : go(S.idx + 1)));
    const wrap = h('div', { class: 'quiz' },
      h('header', { class: 'qbar' },
        h('div', { class: 'qbar-title' }, h('span', { class: 'brand', text: 'BrowserQuiz' }), h('span', { class: 'qbar-name', text: S.quiz.title })),
        progress,
        h('div', { class: 'qbar-right' },
          h('span', { class: 'rec', title: 'Activity in this quiz is recorded' }, h('i', { 'aria-hidden': 'true' }), h('span', { text: 'Recording' })),
          timer)),
      main,
      h('footer', { class: 'qnav' }, prev, sheet, next));
    wrap.style.setProperty('--wm', watermark(S.me.name));
    S.el = { wrap, main, progress, timer, sheet, prev, next, fsOverlay: null };
    mount(wrap);
    renderQuestion();
    startTimer();
  }

  function go(i) {
    if (i < 0 || i >= S.quiz.questions.length || i === S.idx) return;
    S.idx = i;
    renderQuestion();
    S.el.main.scrollTop = 0;
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
    const n = S.idx + 1;
    const total = S.quiz.questions.length;
    S.el.progress.textContent = `Question ${n} of ${total}`;
    S.el.prev.disabled = S.idx === 0;
    S.el.next.textContent = S.idx === total - 1 ? 'Review and submit' : 'Next';
    S.el.next.className = 'btn' + (S.idx === total - 1 ? ' primary' : '');
    const view = q.type === 'code' ? codeView(q) : basicView(q);
    S.el.main.replaceChildren(view);
    colorize(view);
    renderSheet();
  }

  function head(q, kind) {
    return h('div', { class: 'field' },
      h('p', { class: 'eyebrow', text: `${kind} · ${q.points} ${q.points === 1 ? 'point' : 'points'}` }),
      h('div', { class: 'prompt' }, BQ.md.render(q.prompt)),
      q.image ? h('img', { class: 'qimg', src: api.assetUrl(q.image), alt: q.imageAlt || '' }) : null);
  }

  function basicView(q) {
    const view = h('div', { class: 'qview' }, head(q, KIND_LABEL[q.type] || 'Question'));
    if (q.type === 'single' || q.type === 'multi') {
      const multi = q.type === 'multi';
      const cur = S.answers[q.id];
      const list = h('div', { class: 'choices', role: multi ? 'group' : 'radiogroup', 'aria-label': 'Answer choices' });
      q.choices.forEach((c, i) => {
        const id = `${q.id}-c${i}`;
        const input = h('input', {
          type: multi ? 'checkbox' : 'radio', name: q.id, id, value: i, class: 'sr-only',
          checked: multi ? Array.isArray(cur) && cur.includes(i) : cur === i,
        });
        input.addEventListener('change', () => {
          if (!multi) return setAnswer(q.id, i);
          const set = new Set(Array.isArray(S.answers[q.id]) ? S.answers[q.id] : []);
          if (input.checked) set.add(i); else set.delete(i);
          setAnswer(q.id, set.size ? [...set].sort((a, b) => a - b) : undefined);
        });
        list.append(h('label', { class: 'choice' + (multi ? ' multi' : ''), for: id },
          input, h('span', { class: 'bubble', 'aria-hidden': 'true', text: LETTERS[i] }),
          h('span', { class: 'choice-text' }, BQ.md.renderInline(c))));
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
    const kind = q.mode === 'class' ? 'Write a class' : 'Write a method';
    const samples = h('ol', { class: 'samples' }, (q.samples || []).map((s) =>
      h('li', { class: 'sample' },
        h('pre', { class: 'sample-call' }, h('code', { text: s.call[lang] })),
        h('div', { class: 'sample-exp' }, h('span', { class: 'k', text: 'Returns' }), h('code', { text: s.expected[lang] })))));

    const langCtl = q.languages.length > 1
      ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Language' }, q.languages.map((l) =>
          h('button', {
            type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(l === lang), text: LANG_NAMES[l] || l,
            onclick: () => {
              if (ans.language === l) return;
              ans.language = l;
              setAnswer(q.id, ans);
              renderQuestion();
            },
          })))
      : h('span', { class: 'lang-label', text: LANG_NAMES[lang] || lang });

    const runBtn = h('button', { class: 'btn small primary', type: 'button', text: 'Run examples' });
    const results = h('div', { class: 'results', 'aria-live': 'polite' });
    const host = h('div', { class: 'editor-host', 'data-answer-field': true });
    runBtn.addEventListener('click', () => runCode(q, runBtn, results));

    const view = h('div', { class: 'qview wide' },
      h('div', { class: 'code-q' },
        h('section', { class: 'code-left' }, head(q, kind), h('h3', { class: 'sub', text: 'Examples' }), samples),
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
        fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", fontSize: 14, lineHeight: 22,
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
      colorize(S.el.main);
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
    const r = S.results[q.id + ':' + ans.language];
    if (!r) {
      el.replaceChildren(h('p', { class: 'results-empty', text: 'Run checks your code against the examples. Your grade uses more tests than these.' }));
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
      parts.push(h('ul', { class: 'res-tests' }, tests.map((t) => h('li', { class: 'res-test' },
        h('span', { class: 'pill ' + (t.pass ? 'good' : 'bad'), text: t.pass ? 'Pass' : 'Fail' }),
        h('code', { class: 'res-call', text: t.call }),
        t.pass ? null : h('span', { class: 'res-detail' }, 'Expected ', h('code', { text: t.expected }), ', got ', h('code', { text: t.got }))))));
    }
    if (r.stdout) parts.push(h('p', { class: 'res-sub', text: 'Printed output' }), h('pre', { class: 'res-pre', text: r.stdout }));
    el.replaceChildren(...parts);
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
      if (!S.deadline) { S.el.timer.textContent = 'No limit'; return; }
      const left = Math.max(0, S.deadline - (Date.now() + S.skew));
      const m = Math.floor(left / 60000);
      const s = Math.floor(left / 1000) % 60;
      S.el.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
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
        btn));
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
    const keep = h('button', { class: 'btn ghost', type: 'button', text: 'Keep working', onclick: close });
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

  function screenDone(ok) {
    S.el = null;
    mount(h('main', { class: 'screen center' },
      h('div', { class: 'card waiting' },
        h('div', { class: 'done-mark', 'aria-hidden': 'true' }),
        h('h1', { text: ok ? 'Submitted' : 'Saved, not confirmed' }),
        h('p', { class: 'lead', text: ok ? 'Your teacher will release scores. You can close this page.' : "We couldn't confirm your submission, but your answers were autosaved. Tell your teacher." }),
        cfg.demo ? h('button', { class: 'btn', type: 'button', text: 'Start the demo over', onclick: () => BQ.app.restart() }) : null)));
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
