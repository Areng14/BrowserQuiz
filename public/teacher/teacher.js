// BrowserQuiz teacher dashboard: sign in, upload quizzes and rosters, start a quiz, watch it live.
// Everything a student typed is shown with textContent only.
(function () {
  'use strict';
  const root = document.getElementById('t-app');
  const THEME_KEY = 'bq-theme';
  const LABEL = {
    join: 'Signed in', admit: 'Admitted', start: 'Started the quiz', submit: 'Submitted', run: 'Ran examples', reload: 'Reopened mid-quiz',
    restore: 'Restored by teacher', invalidate: 'Invalidated by teacher', blur: 'Left the quiz window', hidden: 'Tab hidden',
    'fullscreen-exit': 'Left fullscreen', return: 'Came back', 'mouse-left': 'Cursor left the page', copy: 'Copy blocked',
    paste: 'Outside paste blocked', contextmenu: 'Right-click', 'blocked-key': 'Blocked key', 'print-screen': 'Print Screen',
    resize: 'Window resized', 'unfocused-beat': 'Heartbeat: not focused', 'heartbeat-lost': 'Connection lost', reconnect: 'Reconnected',
    resume: 'Continued on a new computer', 'let-in': 'Let back in by teacher', extend: 'Extra time', grade: 'Graded by teacher', 'ai-grade': 'Graded by AI',
    'extended-display': 'Second display', 'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
    'late-submit': 'Submitted late', exit: 'Exited the quiz', 'other-network': 'Request from another network', 'other-device': 'Request from another browser',
    extension: 'Extension on the page', 'spoofed-checks': 'Extension hides leaving the window', 'no-frames': 'Quiz not on screen, no leave reported',
    'scripted-input': 'Typed by a script', viewport: 'Side panel or DevTools open', setup: 'Computer',
  };
  let pollTimer = 0;
  let tickTimer = 0;
  let selected = null;

  try { const t = localStorage.getItem(THEME_KEY); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

  // Tables say what they are, so they still read as tables when phones lay their rows out as cards.
  const ROLES = { table: 'table', thead: 'rowgroup', tbody: 'rowgroup', tr: 'row', th: 'columnheader', td: 'cell' };
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (ROLES[tag] && !(attrs && attrs.role)) el.setAttribute('role', ROLES[tag]);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const clock = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');
  const date = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (res.status === 401 && data && data.error === 'login') { showLogin(); throw new Error('login'); }
    if (res.status === 403 && data && data.error === 'must_change') { showSetPassword(true); throw new Error('login'); }
    if (!res.ok) throw new Error((data && data.message) || (data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function themeButton() {
    const b = h('button', { class: 'theme-btn', type: 'button' });
    const paint = () => { const d = isDark(); b.replaceChildren(icon(d ? ICONS.sun : ICONS.moon)); b.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); };
    paint();
    b.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      paint();
    });
    return b;
  }
  let who = null; // the signed-in teacher, from /api/t/me
  function bar(...left) {
    return h('header', { class: 't-bar' }, h('span', { class: 'grow' }, ...left),
      who ? h('span', { class: 't-small t-muted t-who', text: who.name }) : null, themeButton(),
      who && !who.passwordFromEnv ? h('button', { class: 'btn small', type: 'button', text: 'Password', onclick: () => showSetPassword(false) }) : null,
      h('button', { class: 'btn small', type: 'button', text: 'Sign out', onclick: async () => { await post('/api/t/logout'); who = null; showLogin(); } }));
  }
  // A new page: the tab title names it, and reading starts at its heading unless the page focused a field.
  function mount(...nodes) {
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    document.documentElement.classList.remove('t-sheet-open');
    leaveGuard = null;
    root.replaceChildren(...nodes);
    const head = root.querySelector('main h1, h1');
    document.title = head && head.textContent ? `${head.textContent} – BrowserQuiz` : 'BrowserQuiz (Teacher Panel)';
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!head || !head.isConnected || (a && a !== document.body && root.contains(a))) return;
      head.tabIndex = -1;
      head.focus({ preventScroll: true });
    });
  }
  // Where the project lives: on the sign-in page and under the sidebar.
  const GH_MARK = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'; // GitHub's mark (Primer Octicons, MIT)
  function ghMark() {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ width: 15, height: 15, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', GH_MARK); s.append(p);
    return s;
  }
  const ghLink = () => h('a', { class: 't-gh', href: 'https://github.com/Areng14/BrowserQuiz', target: '_blank', rel: 'noopener' }, ghMark(), 'GitHub');
  const actionsHead = () => h('th', {}, h('span', { class: 'sr-only', text: 'Actions' }));
  // Column headers; the ones named in nums sit right, over their right-aligned numbers.
  const heads = (names, nums = []) => names.map((x) => h('th', { class: nums.includes(x) ? 'num' : null, text: x }));

  // ---------- sign in ----------
  function showLogin() {
    const user = h('input', { class: 'input', id: 'user', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { class: 'input', type: 'password', id: 'pw', autocomplete: 'current-password' });
    const msg = h('p', { class: 't-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h('form', { class: 't-login' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: 'Teacher sign in' }),
      h('label', { class: 'field', for: 'user' }, h('span', { class: 'field-label', text: 'Username' }), user),
      h('label', { class: 'field', for: 'pw' }, h('span', { class: 'field-label', text: 'Password' }), pw),
      btn, msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; msg.textContent = '';
      try { const r = await post('/api/t/login', { username: user.value.trim(), password: pw.value }); if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else route(); } catch (ex) { msg.textContent = ex.message === 'bad_password' ? 'Wrong password.' : ex.message === 'too_many' ? 'Too many tries. Wait a minute.' : ex.message; btn.disabled = false; pw.select(); }
    });
    mount(h('main', { class: 't-login-page' }, form, h('p', { class: 't-login-foot' }, ghLink())));
    user.focus();
  }

  // A teacher on a temporary password picks their own before anything else (first), or changes it later.
  async function showSetPassword(first) {
    // After an admin reset, with the quiz key not in memory: the recovery code keeps their quizzes.
    let recover = false;
    if (first) { try { const me = await api('/api/t/me'); recover = !!(me.teacher && me.teacher.needsRecovery); } catch (e) { return; } }
    const code = h('input', { class: 'input t-mono', id: 'pw-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX' });
    const fresh = h('input', { type: 'checkbox', id: 'pw-fresh' });
    fresh.addEventListener('change', () => { code.disabled = fresh.checked; });
    const cur = h('input', { class: 'input', type: 'password', id: 'pw-cur', autocomplete: 'current-password' });
    const next = h('input', { class: 'input', type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '10' });
    const again = h('input', { class: 'input', type: 'password', id: 'pw-again', autocomplete: 'new-password' });
    const msg = h('p', { class: 't-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Save password' });
    const form = h('form', { class: 't-login' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: first ? 'Pick your password' : 'Change your password' }),
      h('label', { class: 'field', for: 'pw-cur' }, h('span', { class: 'field-label', text: first ? 'Temporary password' : 'Current password' }), cur),
      h('label', { class: 'field', for: 'pw-new' }, h('span', { class: 'field-label', text: 'New password (10+ characters)' }), next),
      h('label', { class: 'field', for: 'pw-again' }, h('span', { class: 'field-label', text: 'New password again' }), again),
      recover ? [
        h('label', { class: 'field', for: 'pw-code' }, h('span', { class: 'field-label', text: 'Recovery code (keeps your quizzes)' }), code),
        h('label', { class: 't-check', for: 'pw-fresh' }, fresh, h('span', { text: "I don't have it: start over without my quizzes and results" })),
      ] : null,
      h('div', { class: 't-row' }, btn, first ? null : h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => showHome() })), msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      if (next.value !== again.value) { msg.textContent = "The new passwords don't match."; return; }
      btn.disabled = true;
      if (recover && fresh.checked && !confirm('Start over? Your quizzes, and the results from them, are deleted for good.')) { btn.disabled = false; return; }
      try {
        const r = await post('/api/t/me/password', { current: cur.value, next: next.value, recoveryCode: recover && !fresh.checked ? code.value : undefined, startOver: recover && fresh.checked });
        if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else showHome();
      } catch (ex) { msg.textContent = ex.message; btn.disabled = false; }
    });
    mount(h('main', { class: 't-login-page' }, form));
    cur.focus();
  }

  // Shown once, when a teacher's quiz key is made: the only way back to their quizzes without the password.
  function showRecoveryCode(codeText) {
    const copy = h('button', { class: 'btn small', type: 'button', text: 'Copy' });
    copy.addEventListener('click', async () => { if (await copyText(codeText)) copy.textContent = 'Copied'; });
    mount(h('main', { class: 't-login t-recovery' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: 'Save your recovery code' }),
      h('p', { text: 'Your quizzes are encrypted with your password, so only you can open them, not whoever runs this server. If you forget your password, this code is the only way to get them back.' }),
      h('div', { class: 't-row' }, h('code', { class: 't-code-big', text: codeText }), copy),
      h('p', { class: 't-small t-muted', text: "It isn't shown again. Keep it somewhere other than this computer." }),
      h('div', {}, h('button', { class: 'btn primary', type: 'button', text: 'I saved it', onclick: () => route() }))));
  }

  // ---------- teacher accounts (admin) ----------
  function teachersSection() {
    const list = h('div', {});
    const msg = h('p', { class: 't-small', role: 'status' });
    const name = h('input', { class: 'input', id: 'teacher-name', placeholder: 'Jordan Lee', maxlength: '80' });
    const username = h('input', { class: 'input', id: 'teacher-user', placeholder: 'jlee', autocapitalize: 'none', spellcheck: 'false', maxlength: '32' });
    const add = h('button', { class: 'btn', type: 'submit', text: 'Add teacher' });
    // The temporary password shows once, here: the teacher picks their own when they first sign in.
    const showTemp = (who2, temp) => msg.replaceChildren(`Give ${who2} this temporary password: `, h('code', { class: 't-temp', text: temp }), '. They pick their own when they sign in.');
    async function load() {
      let r;
      try { r = await api('/api/t/teachers'); } catch (e) { return; }
      const act = async (x, action) => {
        if (action === 'disable' && !confirm(`Disable ${x.name}? They're signed out and can't sign in. Their quizzes and results stay.`)) return;
        try {
          const out = await post(`/api/t/teachers/${x.id}/${action}`);
          if (out.tempPassword) showTemp(x.name, out.tempPassword); else msg.textContent = '';
          load();
        } catch (e) { msg.textContent = e.message; }
      };
      list.replaceChildren(h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
        h('thead', {}, h('tr', {}, heads(['Name', 'Username', 'Quizzes', 'Classes', 'Status'], ['Quizzes', 'Classes']), actionsHead())),
        h('tbody', {}, r.teachers.map((x) => h('tr', {},
          h('td', { text: x.name }), h('td', { class: 't-muted', text: x.username }),
          h('td', { class: 'num', 'data-label': 'Quizzes', text: String(x.quizzes) }), h('td', { class: 'num', 'data-label': 'Classes', text: String(x.classes) }),
          h('td', { class: x.disabled ? 't-muted' : x.pending ? 'st-waiting' : 'st-good', text: x.role === 'admin' ? 'Admin' : x.disabled ? 'Disabled' : x.pending ? 'Not signed in yet' : 'Active' }),
          h('td', { class: 't-actions' }, x.role === 'admin' ? null : [
            h('button', { class: 'btn small', type: 'button', text: 'Reset password', 'aria-label': `Reset password for ${x.name}`, onclick: () => act(x, 'reset') }),
            h('button', { class: 'btn small', type: 'button', text: x.disabled ? 'Enable' : 'Disable', 'aria-label': `${x.disabled ? 'Enable' : 'Disable'} ${x.name}`, onclick: () => act(x, x.disabled ? 'enable' : 'disable') }),
          ])))))));
    }
    const form = h('form', { class: 't-row' },
      h('label', { class: 'field', for: 'teacher-name' }, h('span', { class: 'field-label', text: 'Name' }), name),
      h('label', { class: 'field', for: 'teacher-user' }, h('span', { class: 'field-label', text: 'Username' }), username), add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      add.disabled = true;
      try {
        const out = await post('/api/t/teachers', { name: name.value, username: username.value });
        showTemp(name.value.trim(), out.tempPassword);
        name.value = '';
        username.value = '';
        load();
      } catch (ex) { msg.textContent = ex.message; }
      add.disabled = false;
    });
    load();
    return h('section', { class: 't-section' }, h('h1', { text: 'Teachers' }), list, form, msg);
  }

  // ---------- dashboard: a sidebar of tabs, each with its own address (#give, #run/<id>, ...) ----------
  const TABS = [
    { id: 'give', label: 'Give a quiz', short: 'Give', icon: ['M6 4l14 8-14 8z'] },
    { id: 'results', label: 'Results', icon: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'] },
    { id: 'quizzes', label: 'Quizzes', icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'] },
    { id: 'classes', label: 'Classes', icon: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'] },
    { id: 'teachers', label: 'Teachers', icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'], admin: true },
  ];
  // The open quiz (the newest, if there are several): its live page is a tab of its own, Current quiz.
  const CURRENT = { id: 'current', label: 'Current quiz', short: 'Current', icon: ['M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M16.24 7.76a6 6 0 0 1 0 8.49', 'M7.76 16.24a6 6 0 0 1 0-8.49', 'M19.07 4.93a10 10 0 0 1 0 14.14', 'M4.93 19.07a10 10 0 0 1 0-14.14'] };
  let openRuns = null; // [{ id, title, code }], newest first; null until the overview says
  function noteRuns(runs) {
    openRuns = runs.filter((r) => r.status === 'open').map((r) => ({ id: r.id, title: r.quiz_title, code: r.code }));
    live = openRuns.length;
  }
  let tab = 'give';
  let live = 0; // open quizzes, shown on Current quiz when there's more than one
  let here = location.hash;
  let leaveGuard = null; // set by a page with unsaved work; false keeps the teacher there
  let navSeq = 0; // the latest page asked for, so a slow load doesn't replace a newer page

  function setHash(hash, replace) {
    here = hash;
    if (location.hash === hash) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  }
  async function route() {
    if (leaveGuard && !leaveGuard()) { history.pushState(null, '', here); return; }
    leaveGuard = null;
    if (!who) { try { who = (await api('/api/t/me')).teacher; } catch (e) { return; } } // signs in first if needed
    const [a, b] = location.hash.slice(1).split('/');
    const id = b ? decodeURIComponent(b) : null;
    if (a === 'run' && id) showRun(id);
    else if (a === 'class') showRoster(id === 'new' ? null : id);
    else if (a === 'quiz') openQuiz(id === 'new' ? null : id);
    else showHome(TABS.some((t) => t.id === a) ? a : 'give');
  }
  window.addEventListener('hashchange', route);
  function openQuiz(id) {
    setHash('#quiz/' + (id ? encodeURIComponent(id) : 'new'));
    window.BQT.showQuizEditor(id);
  }

  // Line icons (24x24, stroked), so buttons look the same everywhere instead of as each phone's emoji.
  const ICONS = {
    sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'],
    moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
    x: ['M18 6L6 18', 'M6 6l12 12'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    cross: ['M7 7l10 10', 'M17 7L7 17'],
    up: ['M12 19V5', 'M5 12l7-7 7 7'],
    down: ['M12 5v14', 'M19 12l-7 7-7-7'],
    back: ['M19 12H5', 'M12 19l-7-7 7-7'],
    grip: ['M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01'],
  };
  function icon(paths, size = 18) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, String(v));
    for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  }
  // The page frame: tabs on the left, the page on the right. active: the tab this page belongs to.
  function shell(active, ...content) {
    const tabs = TABS.filter((t) => !t.admin || (who && who.role === 'admin'));
    const cur = openRuns && openRuns[0];
    if (cur) tabs.splice(1, 0, Object.assign({}, CURRENT, { href: '#run/' + encodeURIComponent(cur.id), title: `${cur.title} (${cur.code})` }));
    return h('div', { class: 't-shell' },
      h('nav', { class: 't-side', 'aria-label': 'Dashboard' },
        h('div', { class: 't-brand' }, h('img', { class: 't-brand-icon', src: '/icon.svg', alt: '', width: 26, height: 26 }), 'BrowserQuiz'),
        h('div', { class: 't-nav' }, tabs.map((t) => h('a', { class: 't-nav-item', href: t.href || '#' + t.id, title: t.title || null, 'aria-current': t.id === active ? 'page' : null },
          icon(t.icon), h('span', { class: 't-nav-label' }, t.short || t.label, t.short ? h('span', { class: 't-nav-more', text: t.label.slice(t.short.length) }) : null),
          t.id === 'current' && live > 1 ? h('span', { class: 't-badge', title: `${live} open`, 'aria-label': `${live} open`, text: String(live) }) : null))),
        h('div', { class: 't-side-foot' },
          who ? h('span', { class: 't-small t-muted t-who', text: who.name }) : null,
          h('div', { class: 't-side-btns' }, themeButton(),
            who && !who.passwordFromEnv ? h('button', { class: 'btn small', type: 'button', text: 'Password', onclick: () => showSetPassword(false) }) : null,
            h('button', { class: 'btn small', type: 'button', text: 'Sign out', onclick: async () => { await post('/api/t/logout'); who = null; showLogin(); } })))),
      h('main', { class: 't-main' }, ...content),
      h('footer', { class: 't-foot' }, ghLink())); // at the bottom of the page, or after it when it's long
  }

  async function showHome(next) {
    const same = !next || next === tab;
    if (next) tab = next;
    setHash('#' + tab);
    const seq = ++navSeq;
    let data;
    let me = null;
    try { [data, me] = await Promise.all([api('/api/t/overview'), api('/api/t/me').catch(() => null)]); } catch (e) { if (e.message !== 'login') mount(h('p', { class: 't-error', text: e.message })); return; }
    if (seq !== navSeq) return;
    who = me && me.teacher;
    if (tab === 'teachers' && !(who && who.role === 'admin')) { showHome('give'); return; }
    noteRuns(data.runs);
    const page = { give: giveTab, results: resultsTab, quizzes: quizzesTab, classes: classesTab, teachers: teachersSection }[tab](data, me);
    const y = same ? window.scrollY : 0;
    mount(shell(tab, page));
    window.scrollTo(0, y);
  }

  const runsTable = (runs) => h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
    h('thead', {}, h('tr', {}, heads(['Code', 'Quiz', 'Class', 'Status', 'Joined', 'Started'], ['Joined']), actionsHead())),
    h('tbody', {}, runs.map((r) => h('tr', {},
      h('td', {}, h('button', { class: 't-link t-mono', type: 'button', text: r.code, onclick: () => showRun(r.id) })),
      h('td', { text: r.quiz }), h('td', { text: r.roster }),
      h('td', { class: r.status === 'open' ? 'st-good' : 't-muted', text: `${r.status === 'open' ? 'Open' : 'Closed'}${r.corrections ? ' (corrections)' : r.practice ? ' (practice)' : r.seb ? ' (SEB)' : ''}` }),
      h('td', { class: 'num', 'data-label': 'Joined', text: String(r.joined) }), h('td', { 'data-label': 'Started', text: date(r.createdAt) }),
      h('td', { class: 't-actions' }, h('button', { class: 'btn small', type: 'button', text: 'Delete', 'aria-label': `Delete ${r.code}`,
        onclick: () => remove(`/api/t/runs/${r.id}/delete`, `Delete ${r.code} and all its results?${r.status === 'open' ? " It's still open: anyone taking it gets signed out." : ''}`) })))))));

  // Start a quiz: what, who, and how it's locked down. Open quizzes are listed under it.
  function giveTab(data, me) {
    const runner = !me || !me.runner || me.runnerOk ? null
      : h('p', { class: 't-error t-small' }, h('span', { class: 'dot bad' }), 'Code runner offline. Code questions get graded once it is back.');
    const quizSel = picker('run-quiz', 'Quiz', data.quizzes.map((x) => ({ value: x.id, label: x.title, meta: [plural(x.questions, 'question'), date(x.createdAt)] })));
    const rosterSel = picker('run-roster', 'Class', data.rosters.map((x) => ({ value: x.id, label: x.name, meta: [plural(x.students, 'student')] })));
    // level: how locked down, out of 3.
    const MODES = [
      { id: 'exam', title: 'Exam', level: 2, security: 'Medium security' },
      { id: 'seb', title: 'Safe Exam Browser', level: 3, security: 'High security' },
      { id: 'practice', title: 'Practice', level: 0, security: 'No security' },
    ];
    let mode = 'exam';
    // Safe Exam Browser: BrowserQuiz makes the settings, unless the teacher has their own .seb file
    // (then its Config Key, from SEB Config Tool's Exam tab).
    const sebKey = h('input', { class: 'input t-mono', id: 'seb-key', autocomplete: 'off', spellcheck: 'false', maxlength: '64', placeholder: '64 letters and digits' });
    const sebOwn = h('details', { class: 't-seb' }, h('summary', { text: 'Use my own .seb file' }),
      h('label', { class: 'field', for: 'seb-key' }, h('span', { class: 'field-label', text: 'Config Key (SEB Config Tool, Exam tab)' }), sebKey));
    sebOwn.hidden = true;
    sebOwn.addEventListener('toggle', () => { if (sebOwn.open) sebKey.focus(); });
    const modeCards = MODES.map((m) => {
      const input = h('input', { type: 'radio', name: 'mode', id: 'mode-' + m.id, value: m.id, checked: m.id === mode });
      input.addEventListener('change', () => { mode = m.id; sebOwn.hidden = mode !== 'seb'; });
      return h('label', { class: 't-mode', for: 'mode-' + m.id, 'data-level': String(m.level) }, input,
        h('span', { class: 't-mode-title', text: m.title }),
        h('span', { class: 't-mode-sec' },
          h('span', { class: 't-meter', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('span', { class: i <= m.level ? 'on' : null }))),
          m.security));
    });
    const ipLock = h('input', { type: 'checkbox', id: 'ip-lock', class: 't-switch', role: 'switch', checked: true });
    const startMsg = h('p', { class: 't-error', role: 'alert' });
    const ready = data.quizzes.length && data.rosters.length;
    const startBtn = h('button', { class: 'btn primary t-start', type: 'button', text: 'Start quiz', disabled: !ready });
    startBtn.addEventListener('click', async () => {
      const pick = data.quizzes.find((x) => x.id === quizSel.value);
      if (mode !== 'practice' && pick && pick.practiced
        && !confirm(`Students who practiced "${pick.title}" have seen its answers. Give it as a graded quiz anyway?`)) return;
      startBtn.disabled = true;
      startMsg.textContent = '';
      try {
        const own = mode === 'seb' && sebOwn.open && sebKey.value.trim();
        const r = await post('/api/t/runs', { quizId: quizSel.value, rosterId: rosterSel.value, ipLock: ipLock.checked, practice: mode === 'practice', seb: mode === 'seb', sebKey: own || null });
        showRun(r.id);
      } catch (e) { startMsg.textContent = e.message; startBtn.disabled = false; }
    });
    const missing = [!data.quizzes.length && ['quiz', '#quizzes'], !data.rosters.length && ['class', '#classes']].filter(Boolean);
    const open = data.runs.filter((r) => r.status === 'open');
    return [
      h('section', { class: 't-section' },
        h('h1', { text: 'Give a quiz' }),
        missing.length ? h('p', { class: 't-muted' }, 'Add a ', missing.map(([w, href], i) => [i ? ' and a ' : '', h('a', { href, text: w })]), ' first.') : null,
        h('div', { class: 't-start-form' },
          h('div', { class: 't-row' }, quizSel.el, rosterSel.el),
          h('fieldset', { class: 't-modes' }, h('legend', { class: 'field-label', text: 'Mode' }), modeCards),
          sebOwn,
          h('label', { class: 't-check t-switch-row', for: 'ip-lock' }, ipLock, h('span', { text: 'Only students on my current network' })),
          h('div', { class: 't-row t-start-row' }, startBtn, startMsg), runner)),
      open.length ? h('section', { class: 't-section' }, h('h2', { text: 'Open now' }), runsTable(open)) : null,
    ];
  }

  function resultsTab(data) {
    return h('section', { class: 't-section' },
      h('h1', { text: 'Results' }),
      data.runs.length ? runsTable(data.runs) : h('p', { class: 't-muted', text: 'None yet.' }));
  }

  function quizzesTab(data) {
    // Only .quiz (and quiz.json) files can be picked, except in Safari's engine (Safari, and every iPhone
    // and iPad browser): it only knows file types it has heard of, so it greys .quiz files out. There any
    // file can be picked; the server checks what comes in either way.
    const ua = navigator.userAgent;
    const webkitPicker = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
    const quizFile = h('input', { class: 'input', type: 'file', id: 'quiz-file', accept: webkitPicker ? null : '.quiz,.zip,.json' });
    const quizMsg = h('p', { class: 't-error', role: 'alert' });
    // Paste quiz.json (from an AI chat, say) and upload it straight away.
    const pasteJson = h('textarea', { class: 'input t-textarea', id: 'paste-quiz', rows: 8, spellcheck: 'false', placeholder: '{ "title": "...", "questions": [ ... ] }' });
    const pasteBtn = h('button', { class: 'btn', type: 'button', text: 'Upload pasted quiz' });
    pasteBtn.addEventListener('click', async () => {
      if (!pasteJson.value.trim()) { quizMsg.textContent = 'Paste a quiz.json first.'; return; }
      pasteBtn.disabled = true; pasteBtn.textContent = 'Checking…'; quizMsg.textContent = '';
      try { await api('/api/t/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pasteJson.value }); showHome(); } catch (e) { quizMsg.textContent = e.message; pasteBtn.disabled = false; pasteBtn.textContent = 'Upload pasted quiz'; }
    });
    const quizBtn = h('button', { class: 'btn', type: 'button', text: 'Upload .quiz' });
    quizBtn.addEventListener('click', async () => {
      const f = quizFile.files[0];
      if (!f) { quizMsg.textContent = 'Pick a .quiz file first.'; return; }
      quizBtn.disabled = true; quizBtn.textContent = 'Checking…'; quizMsg.textContent = '';
      try { await api('/api/t/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() }); showHome(); } catch (e) { quizMsg.textContent = e.message; quizBtn.disabled = false; quizBtn.textContent = 'Upload .quiz'; }
    });
    return h('section', { class: 't-section' },
      h('div', { class: 't-head' }, h('h1', { text: 'Quizzes' }),
        copyPromptBtn(),
        h('button', { class: 'btn small primary', type: 'button', text: 'New quiz', onclick: () => openQuiz(null) })),
      data.quizzes.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-list' },
        h('thead', { class: 'sr-only' }, h('tr', {}, ['Quiz', 'Questions', 'Time limit', 'Added'].map((x) => h('th', { text: x })), actionsHead())),
        h('tbody', {}, data.quizzes.map((x) => h('tr', {},
          h('td', { role: 'rowheader', class: 't-rowhead', text: x.title }),
          h('td', { class: 't-muted', text: plural(x.questions, 'question') }),
          h('td', { class: 't-muted', text: x.timeLimitMin ? `${x.timeLimitMin} min` : 'No time limit' }),
          h('td', { class: 't-muted', text: date(x.createdAt) }),
          h('td', { class: 't-actions' },
            named(linkBtn('Preview', `/teacher/preview.html?quiz=${encodeURIComponent(x.id)}`, true), `Preview ${x.title}`),
            h('button', { class: 'btn small', type: 'button', text: 'Edit', 'aria-label': `Edit ${x.title}`, onclick: () => openQuiz(x.id) }),
            named(linkBtn('Download', `/api/t/quizzes/${encodeURIComponent(x.id)}/download`), `Download ${x.title}`),
            h('button', { class: 'btn small', type: 'button', text: 'Delete', 'aria-label': `Delete ${x.title}`, onclick: () => remove(`/api/t/quizzes/${x.id}/delete`, `Delete ${x.title}? Past results stay.`) }))))))) : null,
      h('div', { class: 't-row' }, h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: 'Upload a .quiz or quiz.json' }), quizFile), quizBtn),
      h('details', { class: 't-paste' }, h('summary', { text: 'Paste a quiz.json' }),
        h('label', { class: 'field', for: 'paste-quiz' }, h('span', { class: 'field-label', text: 'quiz.json' }), pasteJson), h('div', {}, pasteBtn)),
      quizMsg);
  }

  function classesTab(data) {
    const rosterName = h('input', { class: 'input', id: 'roster-name', placeholder: 'Period 3' });
    const rosterFile = h('input', { class: 'input', type: 'file', id: 'roster-file', accept: '.csv,text/csv' });
    const rosterMsg = h('p', { class: 't-error', role: 'alert' });
    const rosterBtn = h('button', { class: 'btn', type: 'button', text: 'Upload roster' });
    rosterBtn.addEventListener('click', async () => {
      const f = rosterFile.files[0];
      if (!f) { rosterMsg.textContent = 'Pick a CSV file first.'; return; }
      rosterBtn.disabled = true; rosterMsg.textContent = '';
      try { await post('/api/t/rosters', { name: rosterName.value, csv: await f.text() }); showHome(); } catch (e) { rosterMsg.textContent = e.message; rosterBtn.disabled = false; }
    });
    return h('section', { class: 't-section' },
      h('div', { class: 't-head' }, h('h1', { text: 'Classes' }),
        h('button', { class: 'btn small primary', type: 'button', text: 'New class', onclick: () => showRoster(null) })),
      data.rosters.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-list' },
        h('thead', { class: 'sr-only' }, h('tr', {}, ['Class', 'Students'].map((x) => h('th', { text: x })), actionsHead())),
        h('tbody', {}, data.rosters.map((x) => h('tr', {},
          h('td', { role: 'rowheader', class: 't-rowhead', text: x.name }),
          h('td', { class: 't-muted', text: plural(x.students, 'student') }),
          h('td', { class: 't-actions' },
            h('button', { class: 'btn small', type: 'button', text: 'Edit', 'aria-label': `Edit ${x.name}`, onclick: () => showRoster(x.id) }),
            h('button', { class: 'btn small', type: 'button', text: 'Delete', 'aria-label': `Delete ${x.name}`, onclick: () => remove(`/api/t/rosters/${x.id}/delete`, `Delete ${x.name}? Past results stay.`) }))))))) : null,
      h('div', { class: 't-row' },
        h('label', { class: 'field', for: 'roster-name' }, h('span', { class: 'field-label', text: 'Class name' }), rosterName),
        h('label', { class: 'field', for: 'roster-file' }, h('span', { class: 'field-label', text: 'Upload a CSV (name, student ID)' }), rosterFile),
        rosterBtn),
      rosterMsg);
  }

  const named = (el, label) => { el.setAttribute('aria-label', label); return el; };
  function linkBtn(text, href, newTab) {
    const a = h('a', { class: 'btn small', href, text, target: newTab ? '_blank' : null, rel: newTab ? 'noopener' : null });
    a.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none';
    return a;
  }

  // A dropdown whose rows have a name on the left and details lined up on the right, which a native
  // select can't do. items: [{ value, label, meta: [column, ...] }]. Keyboard: arrows, Home/End,
  // Enter or Space to pick, Escape to close.
  function picker(id, labelText, items) {
    let value = items.length ? items[0].value : '';
    let active = 0;
    const row = (it) => [h('span', { class: 'pick-label', text: it.label }), h('span', { class: 'pick-meta' }, it.meta.map((m) => h('span', { text: m })))];
    const face = h('span', { class: 'pick-face', id: id + '-value' });
    const btn = h('button', {
      class: 'input pick', type: 'button', id, disabled: !items.length,
      'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id + '-list', 'aria-labelledby': `${id}-label ${id}-value`,
    }, face, h('span', { class: 'pick-caret', 'aria-hidden': 'true' }));
    const list = h('ul', { class: 'pick-list', role: 'listbox', id: id + '-list', tabindex: '-1', 'aria-labelledby': id + '-label' });
    list.hidden = true;
    const opts = items.map((it, i) => {
      const li = h('li', { class: 'pick-opt', role: 'option', id: `${id}-o${i}`, 'data-value': it.value }, row(it));
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the list until the click
      li.addEventListener('click', () => { choose(i); close(); });
      li.addEventListener('mousemove', () => setActive(i, true));
      list.append(li);
      return li;
    });
    const el = h('div', { class: 'field pick-wrap' }, h('span', { class: 'field-label', id: id + '-label', text: labelText }), btn, list);
    function paint() {
      const it = items.find((x) => x.value === value);
      face.replaceChildren(...(it ? row(it) : []));
      opts.forEach((li, i) => li.setAttribute('aria-selected', String(items[i].value === value)));
    }
    function setActive(i, fromMouse) {
      active = Math.max(0, Math.min(items.length - 1, i));
      opts.forEach((li, k) => li.classList.toggle('active', k === active));
      list.setAttribute('aria-activedescendant', opts[active].id);
      if (!fromMouse) opts[active].scrollIntoView({ block: 'nearest' });
    }
    function choose(i) { value = items[i].value; paint(); }
    function open() {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      setActive(Math.max(0, items.findIndex((x) => x.value === value)));
      list.focus();
    }
    function close(stay) {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (!stay) btn.focus();
    }
    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') setActive(active + 1);
      else if (e.key === 'ArrowUp') setActive(active - 1);
      else if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(items.length - 1);
      else if (e.key === 'Enter' || e.key === ' ') { choose(active); close(); }
      else if (e.key === 'Escape') close();
      else if (e.key === 'Tab') { close(true); return; }
      else return;
      e.preventDefault();
    });
    list.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) close(true); });
    paint();
    return { el, get value() { return value; } };
  }

  // The .seb file BrowserQuiz made for a Safe Exam Browser quiz, and the link that opens SEB with it
  // (to post for students, say). The join page offers the same link.
  function sebButtons(code) {
    const file = `/api/seb/${encodeURIComponent(code)}.seb`;
    const link = `${location.protocol === 'https:' ? 'sebs' : 'seb'}://${location.host}${file}`;
    const dl = linkBtn('Download .seb', file);
    dl.classList.remove('small');
    dl.setAttribute('download', `${code}.seb`);
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy SEB link' });
    let reset = 0;
    copy.addEventListener('click', async () => {
      if (!(await copyText(link))) { prompt('Copy this link:', link); return; }
      copy.textContent = 'Copied';
      clearTimeout(reset);
      reset = setTimeout(() => { copy.textContent = 'Copy SEB link'; }, 2000);
    });
    return [dl, copy];
  }

  // The AI prompt goes on the clipboard, ready to paste into a chatbot. It's fetched ahead of time so
  // the copy happens right in the click. If copying is blocked, it downloads instead.
  function copyPromptBtn() {
    const url = `/api/t/quiz-prompt`;
    const btn = h('button', { class: 'btn small', type: 'button', text: 'Copy AI prompt' });
    let text = null;
    const ready = fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : null)).then((t) => { text = t; }).catch(() => {});
    let reset = 0;
    btn.addEventListener('click', async () => {
      if (text == null) await ready;
      if (text != null && await copyText(text)) {
        btn.textContent = 'Copied';
        clearTimeout(reset);
        reset = setTimeout(() => { btn.textContent = 'Copy AI prompt'; }, 2000);
      } else {
        location.href = url;
      }
    });
    return btn;
  }
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* try the old way */ }
    }
    // Plain http on a school network has no clipboard API; a selected textarea still copies.
    const ta = h('textarea', { readonly: '', 'aria-hidden': 'true' });
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function remove(path, question) {
    if (!confirm(question)) return;
    try { await post(path); } catch (e) { alert(e.message); }
    showHome();
  }

  // ---------- roster maker ----------
  async function showRoster(id) {
    setHash('#class/' + (id ? encodeURIComponent(id) : 'new'));
    const seq = ++navSeq;
    let roster = { name: '', students: [] };
    if (id) {
      try { roster = await api(`/api/t/rosters/${encodeURIComponent(id)}`); } catch (e) { return; }
    }
    const removing = new Set();
    const name = h('input', { class: 'input', id: 'class-name', value: roster.name, placeholder: 'Period 3' });
    const add = h('textarea', { class: 'input t-textarea', id: 'class-add', rows: 8, spellcheck: 'false', placeholder: 'Ava Martinez, 204511\nDiego Ramos, 204651' });
    const msg = h('p', { class: 't-error', role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'button', text: 'Save' });
    const list = roster.students.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
      h('tbody', {}, roster.students.map((st) => {
        const row = h('tr', {});
        const btn = h('button', { class: 'btn small', type: 'button', text: 'Remove', 'aria-label': `Remove ${st.name}` });
        btn.addEventListener('click', () => {
          if (removing.has(st.id)) { removing.delete(st.id); btn.textContent = 'Remove'; btn.setAttribute('aria-label', `Remove ${st.name}`); row.classList.remove('t-removed'); }
          else { removing.add(st.id); btn.textContent = 'Undo'; btn.setAttribute('aria-label', `Undo removing ${st.name}`); row.classList.add('t-removed'); }
        });
        row.append(h('td', { text: st.name }), h('td', { class: 't-actions' }, btn));
        return row;
      })))) : null;
    save.addEventListener('click', async () => {
      save.disabled = true;
      msg.textContent = '';
      try {
        if (id) await post(`/api/t/rosters/${encodeURIComponent(id)}/edit`, { name: name.value, add: add.value, remove: [...removing] });
        else await post('/api/t/rosters', { name: name.value, text: add.value });
        showHome('classes');
      } catch (e) { msg.textContent = e.message; save.disabled = false; }
    });
    if (seq !== navSeq) return;
    mount(shell('classes', h('section', { class: 't-section' },
        h('h1', { text: id ? 'Edit class' : 'New class' }),
        h('label', { class: 'field', for: 'class-name' }, h('span', { class: 'field-label', text: 'Class name' }), name),
        id ? h('h2', { text: plural(roster.students.length, 'student') }) : null,
        list,
        h('label', { class: 'field', for: 'class-add' }, h('span', { class: 'field-label', text: id ? 'Add students: name, student ID (one per line)' : 'Students: name, student ID (one per line)' }), add),
        h('div', { class: 't-row' }, save, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => showHome('classes') })),
        msg)));
    if (!id) name.focus(); // a new class starts with its name; an open one stays at the top
  }

  // ---------- one running quiz ----------
  function statusCell(s) {
    if (!s.attempt) return h('td', { class: 't-muted', text: 'Not joined' });
    const a = s.attempt;
    if (a.status === 'waiting') return h('td', { class: 'st-waiting', text: 'Waiting' });
    if (a.status === 'admitted') return h('td', { text: 'Admitted' });
    if (a.status === 'active') return h('td', { text: 'In progress' });
    return h('td', { class: 'st-good', text: 'Submitted' });
  }
  function integrityCell(a) {
    if (!a) return h('td');
    if (a.integrity === 'invalidated') return h('td', { class: 'st-bad', text: `Invalidated (${LABEL[a.reason] || a.reason})` });
    // Restoring doesn't re-arm the strikes, so say when a restored student has left again.
    if (a.integrity === 'restored') return h('td', { class: a.leftAgain ? 'st-bad' : 'st-waiting', text: a.leftAgain ? `Restored, left ${a.leftAgain} more` : 'Restored' });
    return h('td', { class: 'st-good t-clean', text: 'Clean' });
  }
  const phone = () => matchMedia('(max-width: 820px)').matches;
  // Wide enough to grade side by side: the class on the left, the open student on the right.
  const grading = () => matchMedia('(min-width: 1600px)').matches;

  // Grade with AI (server: aicsv.js, aigrade.js), two ways. Copy & paste, in three steps: copy a prompt,
  // paste it into any AI chat, paste the reply back; a table shows each student's grade before anything
  // applies. API key: Claude, ChatGPT or Gemini grades here, in the background, with the teacher's own key (saved here,
  // sealed on the server) or the server's. attemptId: one student only.
  const CHATS = [['ChatGPT', 'https://chatgpt.com/'], ['Claude', 'https://claude.ai/new'], ['Gemini', 'https://gemini.google.com/app']];
  // Where each provider makes API keys (aigrade.js tells them apart by the key).
  const KEY_PAGES = [['Anthropic', 'https://console.anthropic.com/settings/keys'], ['OpenAI', 'https://platform.openai.com/api-keys'], ['Google AI Studio', 'https://aistudio.google.com/apikey']];
  async function aiDialog(runId, attemptId, done) {
    const qs = attemptId ? `?attempt=${encodeURIComponent(attemptId)}` : '';
    let p;
    try { p = await api(`/api/t/runs/${runId}/ai-prompt${qs}`); } catch (e) { alert(e.message); return; }
    if (!p.answers) { alert('Nothing is waiting for you to grade.'); return; }
    let ks = { mine: false, hint: null, server: false };
    try { ks = await api('/api/t/ai-key'); } catch (e) { /* the copy and paste way still works */ }
    const dlg = h('dialog', { class: 't-dialog t-ai-dialog', 'aria-labelledby': 't-ai-title' });
    const close = () => { dlg.close(); };
    // a step: its number (a check once done), a title, and what's in it
    const step = (n, title, ...body) => {
      const num = h('span', { class: 't-step-n', 'aria-hidden': 'true', text: String(n) });
      const li = h('li', { class: 't-step' }, num, h('div', { class: 't-step-body' }, h('h3', { text: title }), ...body));
      li.done = (on) => { li.classList.toggle('done', on); num.replaceChildren(on ? icon(['M20 6L9 17l-5-5'], 14) : String(n)); };
      return li;
    };

    const copyBtn = h('button', { class: 'btn primary', type: 'button', text: 'Copy prompt' });
    const promptView = h('details', { class: 't-ai-see' }, h('summary', { text: 'See it' }), h('pre', { class: 't-ai-prompt', text: p.prompt }));
    const s1 = step(1, 'Copy the prompt', h('div', { class: 't-row t-step-row' }, copyBtn, promptView));
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(p.prompt); } catch (e) {
        const ta = h('textarea', { class: 'sr-only' }); ta.value = p.prompt; dlg.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      copyBtn.textContent = 'Copied';
      s1.done(true);
    });

    const s2 = step(2, 'Paste it into an AI chat',
      h('div', { class: 't-ai-chats' }, CHATS.map(([name, url]) => h('a', { class: 't-chip', href: url, target: '_blank', rel: 'noopener noreferrer', text: name, onclick: () => s2.done(true) }))));

    const replyBox = h('textarea', { class: 'input t-ai-reply', rows: 4, placeholder: 'The whole reply', 'aria-label': "The AI's reply", spellcheck: 'false' });
    const preview = h('div', { class: 't-ai-preview', 'aria-live': 'polite' });
    const s3 = step(3, 'Paste its reply here', replyBox, preview);

    const status = h('span', { class: 't-small t-muted t-ai-count' });
    const applyBtn = h('button', { class: 'btn primary', type: 'button', text: 'Apply grades', disabled: true });
    let timer = 0;
    let seq = 0;
    let previewed = null; // Apply sends only the exact text whose preview is on screen
    const check = async () => {
      const n = ++seq;
      const text = replyBox.value;
      if (!text.trim()) { preview.replaceChildren(); applyBtn.disabled = true; applyBtn.textContent = 'Apply grades'; status.textContent = ''; s3.done(false); return; }
      let r;
      try { r = await post(`/api/t/runs/${runId}/ai-csv`, { csv: text, attempt: attemptId || undefined }); } catch (e) {
        if (n === seq) { preview.replaceChildren(h('p', { class: 't-error t-small', text: e.message })); s3.done(false); }
        return;
      }
      if (n !== seq || text !== replyBox.value) return;
      const rows = (r.preview || []).map((x) => h('tr', {},
        h('td', { text: x.name }),
        h('td', {}, `Q${x.n}`, x.qname ? h('span', { class: 't-muted', text: ` ${x.qname}` }) : null,
          x.items.length ? h('span', { class: 't-ai-items' }, x.items.map((it) => h('span', { class: it.met ? 'met' : 'unmet', title: it.met ? 'Met' : 'Not met' }, icon(it.met ? ICONS.check : ICONS.cross, 13), it.text))) : null),
        h('td', { class: 'num' }, h('b', { text: `${x.got}/${x.of}` }))));
      const problems = r.skipped;
      preview.replaceChildren(...[
        rows.length ? h('div', { class: 't-ai-table' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Student' }), h('th', { text: 'Question' }), h('th', { class: 'num', text: "AI's grade" }))), h('tbody', {}, rows))) : null,
        problems.length ? h('div', { class: 't-ai-warn', role: 'note' }, h('b', { text: r.found ? 'Left for you' : "Couldn't read that" }),
          h('ul', {}, problems.map((x) => h('li', { text: x })))) : null,
      ].filter(Boolean)); // replaceChildren would print a null
      previewed = r.found ? text : null;
      applyBtn.disabled = !r.found;
      applyBtn.textContent = r.found ? `Apply ${plural(r.found, 'grade')}` : 'Apply grades';
      status.textContent = r.found ? `${r.found} of ${r.waiting} answers` : '';
      s3.done(!!r.found);
    };
    replyBox.addEventListener('input', () => {
      // an edit makes the preview out of date: no applying until it's checked again
      previewed = null; applyBtn.disabled = true; ++seq;
      clearTimeout(timer); timer = setTimeout(check, 250);
    });
    applyBtn.addEventListener('click', async () => {
      const text = previewed;
      if (text == null || text !== replyBox.value) return;
      applyBtn.disabled = true;
      try {
        const r = await post(`/api/t/runs/${runId}/ai-csv`, { csv: text, attempt: attemptId || undefined, apply: true });
        close();
        done(`AI grades applied to ${plural(r.applied, 'answer')}.`);
      } catch (e) { status.textContent = e.message; applyBtn.disabled = false; }
    });

    // The API key way: ready (which key, change or remove it) or a field to add one.
    const keyPanel = h('div', { class: 't-ai-key', role: 'tabpanel', id: 't-ai-p-key', 'aria-labelledby': 't-ai-t-key' });
    const gradeBtn = h('button', { class: 'btn primary', type: 'button', text: `Grade ${plural(p.answers, 'answer')}` });
    const linkBtn2 = (text, onclick) => h('button', { class: 't-linkbtn', type: 'button', text, onclick });
    const drawKey = (editing, focus) => {
      const has = ks.mine || ks.server;
      gradeBtn.disabled = !has || editing;
      if (has && !editing) {
        keyPanel.replaceChildren(h('p', { class: 't-ai-ready' },
          h('b', { text: ks.name }), ` · ${ks.mine ? `${ks.company} key ${ks.hint}` : `Server's ${ks.server} key`} · `,
          linkBtn2(ks.mine ? 'Change' : 'Use my own', () => drawKey(true, true)),
          ks.mine ? [' · ', linkBtn2('Remove', async () => { try { ks = await post('/api/t/ai-key', { key: null }); } catch (e) { /* stays */ } drawKey(false, true); })] : null));
        if (focus) setTimeout(() => gradeBtn.focus(), 0);
        return;
      }
      const input = h('input', { class: 'input', type: 'password', id: 't-ai-keyin', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…, sk-… or AIza…' });
      const msg = h('p', { class: 't-small', role: 'status' });
      const save = h('button', { class: 'btn', type: 'button', text: 'Save key' });
      save.addEventListener('click', async () => {
        save.disabled = true; msg.className = 't-small t-muted'; msg.textContent = 'Checking it…';
        try { ks = await post('/api/t/ai-key', { key: input.value }); drawKey(false, true); } catch (e) { msg.className = 't-small t-error'; msg.textContent = e.message; save.disabled = false; }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
      keyPanel.replaceChildren(
        h('label', { class: 'field', for: 't-ai-keyin' }, h('span', { class: 'field-label', text: 'Your API key' }), h('div', { class: 't-row t-ai-keyrow' }, input, save)),
        h('div', { class: 't-ai-chats', role: 'group', 'aria-label': 'Make a key' }, KEY_PAGES.map(([name, url]) => h('a', { class: 't-chip', href: url, target: '_blank', rel: 'noopener noreferrer', text: name }))),
        msg);
      if (has) keyPanel.append(linkBtn2('Cancel', () => drawKey(false, true)));
      if (focus) setTimeout(() => input.focus(), 0);
    };
    gradeBtn.addEventListener('click', async () => {
      gradeBtn.disabled = true;
      try { await post(attemptId ? `/api/t/attempts/${attemptId}/ai-grade` : `/api/t/runs/${runId}/ai-grade`); close(); done(''); } catch (e) {
        keyPanel.append(h('p', { class: 't-small t-error', role: 'alert', text: e.message }));
        gradeBtn.disabled = false;
      }
    });

    // The two ways, as tabs; the footer's main button follows the tab.
    const steps = h('ol', { class: 't-steps', role: 'tabpanel', id: 't-ai-p-paste', 'aria-labelledby': 't-ai-t-paste' }, s1, s2, s3);
    const tabBtn = (id, text) => h('button', { class: 't-tab', type: 'button', role: 'tab', id: `t-ai-t-${id}`, 'aria-controls': `t-ai-p-${id}`, text });
    const tPaste = tabBtn('paste', 'Copy & paste');
    const tKey = tabBtn('key', 'API key');
    const show = (which) => {
      const k = which === 'key';
      tPaste.setAttribute('aria-selected', String(!k)); tKey.setAttribute('aria-selected', String(k));
      tPaste.tabIndex = k ? -1 : 0; tKey.tabIndex = k ? 0 : -1;
      steps.hidden = k; keyPanel.hidden = !k;
      applyBtn.hidden = k; gradeBtn.hidden = !k; status.hidden = k;
      if (k) drawKey(false);
    };
    tPaste.addEventListener('click', () => show('paste'));
    tKey.addEventListener('click', () => show('key'));
    const tabs = h('div', { class: 't-tabs', role: 'tablist', 'aria-label': 'How to grade' }, tPaste, tKey);
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const to = document.activeElement === tPaste ? tKey : tPaste;
      to.focus(); to.click();
    });
    const x = h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: close }, icon(ICONS.x, 18));
    dlg.append(
      h('header', { class: 't-dialog-head' },
        h('h2', { id: 't-ai-title', text: 'Grade with AI' }),
        x),
      tabs, steps, keyPanel,
      h('footer', { class: 't-dialog-foot' }, status, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close }), applyBtn, gradeBtn));
    dlg.addEventListener('close', () => dlg.remove());
    root.append(dlg); // inside the dashboard, for its fonts and sizing
    show(ks.mine || ks.server ? 'key' : 'paste');
    dlg.showModal();
    (ks.mine || ks.server ? tKey : copyBtn).focus();
  }
  // Before letting students in, a checklist, so the teacher looks up from the screen: Admit stays off until
  // both are ticked. Admit everyone asks every time; one student's Admit asks the first time in a run.
  const admitChecked = new Set(); // run ids
  function beforeAdmit(runId, n, name, go) {
    if (name && admitChecked.has(runId)) { go(); return; }
    const dlg = h('dialog', { class: 't-dialog t-admit', 'aria-labelledby': 't-admit-title' });
    const ok = h('button', { class: 'btn primary', type: 'button', text: name ? `Admit ${name}` : `Admit ${plural(n, 'student')}`, disabled: true });
    const items = ['Each student is who they signed in as', 'Desks are clear: no phones, notes or other screens'];
    const boxes = items.map((text, i) => h('input', { type: 'checkbox', id: `t-admit-${i}` }));
    for (const cb of boxes) cb.addEventListener('change', () => { ok.disabled = !boxes.every((x) => x.checked); });
    ok.addEventListener('click', () => { admitChecked.add(runId); dlg.close(); go(); });
    const x = h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon(ICONS.x, 18));
    dlg.append(
      h('header', { class: 't-dialog-head' }, h('h2', { id: 't-admit-title', text: 'Before you admit' }), x),
      h('div', { class: 't-admit-list' }, items.map((text, i) => h('label', { class: 't-check', for: `t-admit-${i}` }, boxes[i], h('span', { text })))),
      h('footer', { class: 't-dialog-foot' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), ok));
    dlg.addEventListener('close', () => dlg.remove());
    root.append(dlg);
    dlg.showModal();
    boxes[0].focus();
  }

  // Corrections (server: corrections.js): a practice run of its own where each student redoes what they
  // missed. The teacher picks how much a fixed answer earns back, and whether to ask what went wrong.
  function correctionsDialog(runId, run) {
    const dlg = h('dialog', { class: 't-dialog t-admit', 'aria-labelledby': 't-corr-title' });
    const earn = h('input', { class: 'input t-points', id: 't-corr-earn', type: 'number', min: '0', max: '100', step: '5', value: '50', inputmode: 'numeric' });
    const why = h('input', { type: 'checkbox', id: 't-corr-why', checked: true });
    const msg = h('p', { class: 't-error t-small', role: 'alert' });
    const ok = h('button', { class: 'btn primary', type: 'button', text: 'Start corrections' });
    ok.addEventListener('click', async () => {
      const pct = Number(earn.value);
      if (earn.value.trim() === '' || !(pct >= 0 && pct <= 100)) { msg.textContent = 'Earn back is a percentage from 0 to 100.'; earn.focus(); return; }
      ok.disabled = true;
      try {
        const r = await post(`/api/t/runs/${runId}/corrections`, { earnBack: pct / 100, why: why.checked });
        dlg.close();
        showRun(r.id);
      } catch (e) { msg.textContent = e.message; ok.disabled = false; }
    });
    const x = h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon(ICONS.x, 18));
    dlg.append(
      h('header', { class: 't-dialog-head' }, h('h2', { id: 't-corr-title', text: 'Corrections' }), x),
      h('div', { class: 't-admit-list' },
        h('label', { class: 'field', for: 't-corr-earn' }, h('span', { class: 'field-label', text: 'A fixed answer earns back' }),
          h('span', { class: 't-corr-pct' }, earn, h('span', { text: '% of what it lost' }))),
        h('label', { class: 't-check', for: 't-corr-why' }, why, h('span', { text: 'Ask what went wrong' })),
        run && run.waiting ? h('p', { class: 't-small', text: `${plural(run.waiting, 'answer')} still ${run.waiting === 1 ? 'needs' : 'need'} grading, so ${run.waiting === 1 ? "it isn't" : "they aren't"} in corrections.` }) : null,
        msg),
      h('footer', { class: 't-dialog-foot' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), ok));
    dlg.addEventListener('close', () => dlg.remove());
    root.append(dlg);
    dlg.showModal();
    earn.focus();
  }

  // How far along: a bar of what's answered, the count, and where they are right now.
  function progressCell(a) {
    if (!a || a.status === 'waiting') return h('td', { class: 'num', 'data-label': 'Answered' });
    const pct = a.total ? Math.round((a.answered / a.total) * 100) : 0;
    const on = a.status !== 'active' || !a.on ? null : a.on === 'review' ? 'checking their work' : a.on === 'directions' ? 'reading directions' : `on question ${a.on}`;
    return h('td', { class: 'num t-progress', 'data-label': 'Answered' },
      h('span', { class: 't-prog', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })),
      h('span', { text: `${a.answered}/${a.total}` }),
      on ? h('span', { class: 't-on', text: on }) : null);
  }
  function watchLink(id, name) {
    const w = h('a', { class: 'btn small', href: `/teacher/watch.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Watch', 'aria-label': `Watch ${name}`, 'data-key': `${id}:watch` });
    w.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none';
    return w;
  }

  async function showRun(runId) {
    setHash('#run/' + encodeURIComponent(runId));
    ++navSeq;
    selected = null;
    const code = h('span', { class: 't-joincode' });
    const title = h('h1');
    const meta = h('p', { class: 't-muted' });
    const tbody = h('tbody');
    const detail = h('div');
    const toggle = h('button', { class: 'btn', type: 'button' });
    const lockBtn = h('button', { class: 'btn', type: 'button' });
    const howTo = h('p', { class: 't-muted t-small' });
    // A stuck student can only leave Safe Exam Browser with this; it's also what locks an iPad.
    const quitPw = h('p', { class: 't-small', hidden: true });
    const sebLinks = h('span', { class: 't-seb-links', hidden: true });
    const failedBox = h('div');
    let lastDetail = '';
    let lastRun = null; // the run as of the last refresh (for Corrections)
    let waitingIds = [];
    // only the students waiting when the checklist opens: anyone who joins while it's up waits for the next round
    const admitAll = h('button', { class: 'btn primary', type: 'button', text: 'Admit everyone waiting', onclick: () => {
      const ids = waitingIds.slice();
      beforeAdmit(runId, ids.length, null, () => act(`/api/t/runs/${runId}/admit-all`, { ids }));
    } });
    // AI grading: everything waiting for the teacher in this run, sent to Claude (server: aigrade.js).
    const aiBtn = h('button', { class: 'btn', type: 'button', hidden: true });
    const aiMsg = h('p', { class: 't-small t-muted', role: 'status', hidden: true });
    let aiWaiting = 0;
    const aiDone = (text) => { if (text) { aiMsg.hidden = false; aiMsg.className = 't-small t-muted'; aiMsg.textContent = text; } lastDetail = ''; refresh(); };
    aiBtn.addEventListener('click', () => aiDialog(runId, null, aiDone));
    // On a phone the less-used buttons fold under More, so the students start near the top.
    const extra = h('span', { class: 't-run-extra', id: 't-run-extra' });
    const moreBtn = h('button', { class: 'btn t-run-morebtn', type: 'button', text: 'More', 'aria-expanded': 'false', 'aria-controls': 't-run-extra',
      onclick: () => moreBtn.setAttribute('aria-expanded', String(extra.classList.toggle('open'))) });
    // Read out when the counts change, not on every 2-second refresh.
    const summary = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const exportLink = h('a', { class: 'btn', href: `/api/t/runs/${runId}/export.csv`, download: true, text: 'Export CSV' });
    const classReport = h('a', { class: 'btn', href: `/teacher/report.html?run=${encodeURIComponent(runId)}`, target: '_blank', rel: 'noopener', text: 'Class report' });
    for (const a of [exportLink, classReport]) {
      a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.textDecoration = 'none';
    }

    async function act(path, body) {
      try { await post(path, body); } catch (e) { alertBox(e.message); }
      refresh();
    }
    function alertBox(msg) { detail.prepend(h('p', { class: 't-error', text: msg })); }
    // Ends one student's quiz: their answers are turned in and they see "Your teacher ended your quiz".
    function endQuiz(id, name) {
      if (!confirm(`End ${name}'s quiz now? Their answers are turned in and they can't continue.`)) return;
      lastDetail = '';
      act(`/api/t/attempts/${id}/end`);
    }

    async function refresh() {
      let data;
      try { data = await api(`/api/t/runs/${runId}/live`); } catch (e) { return; }
      const run = data.run;
      lastRun = run;
      corrBtn.hidden = run.practice || !!run.corrections; // an exam's, once
      code.textContent = run.code;
      document.title = `${run.code} · ${run.title} – BrowserQuiz`;
      const count = (f) => data.students.filter((x) => x.attempt && f(x.attempt)).length;
      const said = [[count((a) => a.status === 'waiting'), 'waiting'], [count((a) => a.status === 'admitted'), 'admitted'], [count((a) => a.status === 'active'), 'working'],
        [count((a) => a.status === 'submitted'), 'turned in'], [count((a) => a.integrity === 'invalidated'), 'invalidated']]
        .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ') || 'Nobody has joined yet';
      if (summary.textContent !== said) summary.textContent = said;
      waitingIds = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting').map((x) => x.attempt.id);
      admitAll.hidden = !waitingIds.length;
      // Grade with AI: shown while there's something waiting for the teacher, or while it runs.
      aiWaiting = data.students.reduce((n, x) => n + (x.attempt && x.attempt.status === 'submitted' ? x.attempt.review || 0 : 0), 0);
      const job = data.ai && data.ai.job;
      if (job && job.running) {
        aiBtn.hidden = false; aiBtn.disabled = true;
        aiBtn.textContent = `Grading with AI… ${job.graded + job.failed} of ${job.total}`;
      } else {
        aiBtn.hidden = !aiWaiting; aiBtn.disabled = false;
        aiBtn.textContent = `Grade ${plural(aiWaiting, 'answer')} with AI`;
      }
      if (job && !job.running) {
        aiMsg.hidden = false;
        aiMsg.className = job.failed ? 't-small t-error' : 't-small t-muted';
        aiMsg.textContent = `AI graded ${plural(job.graded, 'answer')}${job.failed ? `; ${job.failed} didn't work: ${job.errors.join(' ')}` : '.'}`;
      }
      // This run's place in the Current quiz tab.
      if (openRuns && (run.status === 'open') !== openRuns.some((r) => r.id === runId)) {
        api('/api/t/overview').then((o) => {
          noteRuns(o.runs);
          const nav = root.querySelector('.t-side');
          const cur = openRuns[0] && openRuns[0].id === runId;
          if (nav && root.contains(tbody)) nav.replaceWith(shell(cur ? 'current' : tab === 'results' ? 'results' : 'give').querySelector('.t-side'));
        }).catch(() => {});
      }
      title.textContent = run.title;
      meta.textContent = `${plural(run.questions, 'question')}${run.timeLimitMin ? `, ${plural(run.timeLimitMin, 'minute')}` : ''}. ${run.status === 'open' ? 'Open' : 'Closed'}${run.corrections ? `, corrections, earning back ${Math.round(run.corrections.earnBack * 100)}%` : run.practice ? ', practice' : ''}${run.ipLock ? ', only your network' : ''}${run.seb ? ', Safe Exam Browser only' : ''}.`;
      howTo.textContent = run.sebFile ? `Join at ${location.origin}, which opens Safe Exam Browser` : `Join at ${location.origin}`;
      quitPw.hidden = !run.sebQuit || run.status !== 'open';
      if (run.sebQuit && !quitPw.childNodes.length) quitPw.append('SEB quit password: ', h('code', { class: 't-temp', text: run.sebQuit }));
      if (run.sebFile && !sebLinks.childNodes.length) sebLinks.append(...sebButtons(run.code));
      sebLinks.hidden = !run.sebFile || run.status !== 'open';
      toggle.textContent = run.status === 'open' ? 'Close quiz' : 'Reopen quiz';
      toggle.onclick = () => {
        if (run.status === 'open' && !confirm('Close the quiz? Anyone still working gets turned in.')) return;
        act(`/api/t/runs/${runId}/${run.status === 'open' ? 'close' : 'open'}`);
      };
      lockBtn.textContent = run.ipLock ? 'Network lock: on' : 'Network lock: off';
      lockBtn.title = run.ipLock ? 'Only your network can join' : 'Any network can join';
      lockBtn.onclick = () => act(`/api/t/runs/${runId}/${run.ipLock ? 'unlock' : 'lock'}`);
      const failed = data.students.filter((x) => x.attempt && x.attempt.failed).length;
      failedBox.replaceChildren(failed ? h('p', { class: 't-error' }, `Code grading failed for ${plural(failed, 'student')}. `,
        h('button', { class: 'btn small', type: 'button', text: 'Retry now', onclick: () => act(`/api/t/runs/${runId}/regrade-failed`) })) : '');
      const order = (s) => (s.attempt ? (s.attempt.integrity === 'invalidated' || s.attempt.leftAgain ? 0 : s.attempt.status === 'waiting' ? 1 : 2) : 3);
      const rows = data.students.slice().sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
      const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
      tbody.replaceChildren(...rows.map((s) => {
        const a = s.attempt;
        const actions = h('td', { class: 't-actions' });
        const btn = (text, key, onclick, extra) => h('button', Object.assign({ class: 'btn small', type: 'button', text, onclick, 'data-key': `${a.id}:${key}`, 'aria-label': `${text} ${s.name}` }, extra || {}));
        if (a && a.status === 'waiting') actions.append(btn('Admit', 'admit', () => beforeAdmit(runId, 1, s.name, () => act(`/api/t/attempts/${a.id}/admit`)), { class: 'btn small primary' }));
        // Their screen, live, in a new tab (watch.html).
        if (a && a.status === 'active') actions.append(watchLink(a.id, s.name));
        if (a && a.integrity === 'invalidated') actions.append(btn('Restore', 'restore', () => { if (confirm(`Restore ${s.name}?`)) act(`/api/t/attempts/${a.id}/restore`); }));
        // Flagged and still working: ending their quiz is one click away (never automatic, so a stray
        // popup doesn't end anyone's quiz without the teacher looking).
        if (a && a.integrity === 'invalidated' && a.status === 'active') actions.append(btn('End quiz', 'end', () => endQuiz(a.id, s.name)));
        if (a && (a.status === 'active' || a.status === 'admitted')) {
          actions.append(a.letIn
            ? h('span', { class: 't-muted t-small', text: 'Can sign in again' })
            : btn('Let back in', 'letin', () => act(`/api/t/attempts/${a.id}/let-in`), { title: 'Crashed computer or new seat: they sign in again and keep their answers and time' }));
        }
        if (a) actions.append(btn('Reset', 'reset', () => { if (confirm(`Reset ${s.name}? Their answers are deleted. (Crashed computer? Use Let back in.)`)) act(`/api/t/attempts/${a.id}/reset`); }, { title: 'Throw out this attempt and let them start over' }));
        // On a phone a row shows only what needs doing now (Admit, End quiz); the rest is one tap away, on the student.
        for (const b of actions.children) if (!/:(admit|end)$/.test(b.dataset.key || '')) b.classList.add('t-row-extra');
        if (![...actions.children].some((b) => !b.classList.contains('t-row-extra'))) actions.classList.add('t-only-extra');
        const beat = a && a.lastBeatAgo != null ? Math.round(a.lastBeatAgo / 1000) : null;
        let score = '';
        if (a && a.score != null) {
          score = `${a.score} / ${a.max}`;
          if (a.pending) score += ' (grading)';
          else if (a.failed) score += ' (grading failed)';
          else if (a.review) score += ' (needs review)';
          if (a.corrections) score += `, total ${a.corrections.final} / ${a.corrections.max}`; // exam, plus what corrections earned back
        }
        const open = () => { selected = a.id; lastDetail = ''; showDetail(a.id); refresh(); };
        return h('tr', { class: selected === (a && a.id) ? 'sel' : null, onclick: a ? (e) => { if (!e.target.closest('a, button, input') && phone()) open(); } : null },
          h('td', { role: 'rowheader', class: 't-rowhead' }, a ? h('button', { class: 't-link', type: 'button', text: s.name, 'data-key': `${a.id}:name`, 'aria-expanded': String(selected === a.id), onclick: open }) : s.name),
          statusCell(s), integrityCell(a),
          h('td', { class: 'num' + (a && !a.strikes ? ' t-zero' : ''), 'data-label': 'Strikes', text: a ? String(a.strikes) : '' }),
          h('td', Object.assign({ class: 'num' + (a && a.awayNow ? ' st-bad' : ''), 'data-label': 'Away', text: a && a.awayMs ? (a.awayNow ? 'Now, ' : '') + mmss(a.awayMs) : '' }, a && a.awayNow ? ticks('away', -a.awayMs) : {})),
          h('td', { class: 'num quiet', 'data-label': 'Warnings', text: a ? String(a.warnings) : '' }),
          progressCell(a),
          h('td', Object.assign({ class: 'num' + (beat != null && beat > 6 ? ' t-late' : ' quiet'), 'data-label': 'Heartbeat', text: beat != null ? `${beat}s ago` : '' }, beat != null && a.status === 'active' ? ticks('beat', -a.lastBeatAgo) : {})),
          h('td', Object.assign({ class: 'num', 'data-label': 'Time left', text: a && a.timeLeft != null ? mmss(a.timeLeft) : '' }, a && a.timeLeft != null && a.status === 'active' ? ticks('left', a.timeLeft) : {})),
          h('td', { class: 'num' + (a && (a.failed || a.review) ? ' st-waiting' : ''), 'data-label': 'Score', text: score }),
          actions);
      }));
      // Keep keyboard focus on the same button after the redraw, without scrolling the page back to it. If
      // that button is gone (say, Admit after admitting), go to the next Admit, or to the student's name.
      if (focusKey) {
        const [fid, what] = focusKey.split(':');
        const again = tbody.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)
          || (what === 'admit' && (tbody.querySelector('[data-key$=":admit"]') || (admitAll.isConnected && admitAll)))
          || tbody.querySelector(`[data-key="${CSS.escape(fid)}:name"]`);
        if (again) again.focus({ preventScroll: true });
      }
      if (selected) showDetail(selected, true);
    }

    async function showDetail(id, quiet) {
      let d;
      try { d = await api(`/api/t/attempts/${id}`); } catch (e) { return; }
      if (selected !== id) return;
      // The poll re-renders every 2s: don't wipe what the teacher is typing, selecting or reading.
      const snapshot = JSON.stringify(Object.assign({}, d, { timeLeft: null, awayMs: null, awayMax: null })); // clocks that tick: not a reason to redraw
      const typing = detail.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
      if (quiet && (snapshot === lastDetail || typing || String(window.getSelection() || '') !== '')) return;
      lastDetail = snapshot;
      const keep = detail.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.key : null;
      const dk = (key) => ({ 'data-key': `detail:${key}` });
      const canvas = h('canvas', { class: 't-trail', width: 640, height: 360, 'aria-label': 'Mouse trail' });
      // Each question as it looked in the quiz, with this student's answer and the correct one,
      // plus what only the teacher sees: grading state, hidden test results, and the grading controls.
      const sharedSeen = new Set();
      const answers = h('div', { class: 't-answers r-view' }, d.report.questions.map((rq, i) => {
        const x = d.answers[i];
        const sec = window.BQReport.question(d.quiz, rq, i, { teacher: true, sharedSeen });
        const notes = [];
        if (x.state === 'pending') notes.push('Grading…');
        if (x.state === 'failed') notes.push(`Grading failed (${(x.code && x.code.message) || 'runner offline'})`);
        if (x.ai && !x.ai.changed) notes.push('Graded by AI');
        else if (x.ai) notes.push('Graded by AI, then changed by you');
        else if (x.override) notes.push('Points set by you');
        if (x.review) notes.push('Needs review');
        if (notes.length) sec.append(h('p', { class: 't-small t-muted', text: notes.join('. ') + '.' }));
        // The AI's reasons, to check before trusting the grade.
        // With a rubric, its reasons sit on each item below; the box only holds a note, if there is one.
        if (x.ai && (!x.ai.items || x.ai.note)) {
          sec.append(h('div', { class: 't-ai' }, x.ai.items
            ? h('p', {}, h('b', { text: 'AI: ' }), x.ai.note)
            : [h('p', {}, h('b', { text: x.ai.changed || x.points == null ? 'AI: ' : `AI gave ${x.points} / ${x.max} points. ` }), x.ai.why || ''),
              x.ai.note ? h('p', { class: 't-muted', text: x.ai.note }) : null]));
        }
        if (d.status === 'submitted') sec.append(gradeControls(id, x));
        return sec;
      }));
      const closeDetail = () => {
        selected = null;
        detail.replaceChildren();
        detail.parentElement.classList.remove('t-grading');
        document.documentElement.classList.remove('t-sheet-open');
        detail.removeAttribute('role');
        detail.removeAttribute('aria-modal');
        refresh().then(() => { const n = tbody.querySelector(`[data-key="${CSS.escape(id)}:name"]`); if (n) n.focus({ preventScroll: true }); });
      };
      detail.onkeydown = (e) => { if (e.key === 'Escape' && document.documentElement.classList.contains('t-sheet-open')) closeDetail(); };
      detail.replaceChildren(h('section', { class: d.status === 'submitted' ? 't-detail t-done' : 't-detail' },
        h('div', { class: 't-row t-detail-head' },
          h('h2', { style: 'flex:1', tabindex: '-1', class: 't-detail-name', id: 't-detail-name', text: d.name }),
          h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Close', onclick: closeDetail }, dk('close')))),
        h('div', { class: 't-row t-detail-acts' },
          d.status === 'active' ? watchLink(id, d.name) : null,
          d.status === 'active' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'End quiz', onclick: () => endQuiz(id, d.name) }, dk('end'))) : null,
          d.integrity !== 'invalidated' ? h('button', Object.assign(dk('invalidate'), { class: 'btn small', type: 'button', text: 'Invalidate', onclick: () => { const note = prompt('Reason (optional)'); if (note !== null) act(`/api/t/attempts/${id}/invalidate`, { note }); } })) : null,
          d.status === 'active' && d.deadline ? h('span', Object.assign({ class: 't-muted t-small', text: `${mmss(d.timeLeft || 0)} left` }, ticks('left-label', d.timeLeft || 0))) : null,
          d.status === 'active' && d.deadline ? h('button', Object.assign({ class: 'btn small', type: 'button', text: '+5 min', 'aria-label': 'Add 5 minutes', onclick: () => { lastDetail = ''; act(`/api/t/attempts/${id}/extend`, { minutes: 5 }); } }, dk('extend'))) : null,
          d.status === 'submitted' ? h('a', { class: 'btn small', href: `/teacher/report.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Report', style: 'display:inline-flex;align-items:center;text-decoration:none' }) : null,
          d.status === 'submitted' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Regrade', onclick: () => act(`/api/t/attempts/${id}/regrade`) }, dk('regrade'))) : null,
          d.status === 'submitted' && d.totals && d.totals.review ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Grade with AI', title: 'Send the answers waiting for you to Claude. Names and IDs stay here.',
            onclick: () => aiDialog(runId, id, aiDone) }, dk('ai'))) : null,
          d.integrity === 'invalidated' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Restore', onclick: () => { if (confirm(`Restore ${d.name}?`)) act(`/api/t/attempts/${id}/restore`); } }, dk('restore'))) : null,
          d.status === 'active' || d.status === 'admitted' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Let back in', title: 'Crashed computer or new seat: they sign in again and keep their answers and time', onclick: () => act(`/api/t/attempts/${id}/let-in`) }, dk('letin'))) : null,
          h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Reset', title: 'Throw out this attempt and let them start over', onclick: () => { if (confirm(`Reset ${d.name}? Their answers are deleted. (Crashed computer? Use Let back in.)`)) { closeDetail(); act(`/api/t/attempts/${id}/reset`); } } }, dk('reset')))),
        d.integrity === 'invalidated' ? h('p', { class: 'st-bad', text: `Invalidated at ${clock(d.invalidatedAt)}: ${(LABEL[d.reason] || d.reason || '').toLowerCase()}` }) : null,
        d.strikes ? h('p', { class: 't-small t-away', text: `Left ${d.strikes === 1 ? 'once' : d.strikes + ' times'}. Away ${mmss(d.awayMs)} in all${d.strikes > 1 ? `, ${mmss(d.awayMax)} at the longest` : ''}.` }) : null,
        h('div', { class: 't-detail-grid' },
          h('div', { class: 't-section' }, h('h3', { text: 'Activity' }),
            h('ul', { class: 't-events' }, d.events.map((e) => h('li', { class: e.severity }, h('time', { text: clock(e.t) }), h('span', {}, h('b', { text: LABEL[e.type] || e.type }), e.detail ? h('span', { class: 't-muted', text: ` ${e.detail}` }) : null))))),
          h('div', { class: 't-section' }, h('h3', { text: 'Mouse trail' }), canvas,
            h('p', { class: 't-muted t-small', text: `${d.mouse.length} mouse samples` }),
            d.userAgent ? h('p', { class: 't-muted t-small', text: d.userAgent }) : null)),
        h('div', { class: 't-section' }, h('h3', { text: d.totals ? `Answers (${d.totals.score} / ${d.totals.max}${d.totals.pending ? ', code still grading' : d.totals.failed ? ', grading failed' : d.totals.review ? ', needs review' : ''})` : 'Answers so far' }), answers)));
      drawTrail(canvas, d.mouse);
      window.BQReport.highlight(answers);
      if (keep) { const again = detail.querySelector(`[data-key="${CSS.escape(keep)}"]`); if (again) again.focus({ preventScroll: true }); }
      if (!quiet) {
        // A phone: the student's page covers the list, and closing it is back where they were.
        const sheet = phone();
        document.documentElement.classList.toggle('t-sheet-open', sheet);
        if (sheet) { detail.setAttribute('role', 'dialog'); detail.setAttribute('aria-modal', 'true'); } else { detail.removeAttribute('role'); detail.removeAttribute('aria-modal'); }
        // Side by side (grading mode, on wide screens) it's already in view; otherwise it's below the list.
        const grid = detail.parentElement;
        grid.classList.add('t-grading');
        if (!sheet && !grading()) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Side by side: scroll just far enough that the student's side fills the screen (never back up,
        // so a student picked further down the list stays in view).
        const gap = grid.getBoundingClientRect().top - 16;
        if (!sheet && grading() && gap > 0) window.scrollBy({ top: gap, behavior: 'smooth' });
        detail.querySelector('.t-detail-name').focus({ preventScroll: true });
      }
    }

    // Rubric checkboxes and a points override for one answer.
    function gradeControls(id, x) {
      const boxes = x.rubric.map((r) => {
        const cb = h('input', { type: 'checkbox', id: `rb-${x.id}-${r.id}`, checked: r.checked });
        return { r, cb, el: h('label', { class: 't-check', for: cb.id }, cb, h('span', { text: `${r.text} (${plural(r.points, 'point')})` }),
          r.auto ? h('span', { class: 't-auto', text: 'Auto', title: 'Checked by the server. Change it and press Save to grade it yourself.' }) : null,
          x.ai && x.ai.items && x.ai.items[r.id] ? h('span', { class: 't-ai-why' }, h('b', { text: 'AI: ' }), x.ai.items[r.id].why) : null) };
      });
      const over = h('input', { class: 'input t-points', type: 'number', min: '0', max: String(x.max), step: '0.5', id: `ov-${x.id}`, placeholder: 'auto', value: x.overridePoints != null ? String(x.overridePoints) : '' });
      const msg = h('span', { class: 't-small t-muted', role: 'status' });
      const save = h('button', { class: 'btn small', type: 'button', text: 'Save' });
      save.addEventListener('click', async () => {
        save.disabled = true; msg.textContent = '';
        const rubric = Object.fromEntries(boxes.map((b) => [b.r.id, b.cb.checked]));
        try {
          await post(`/api/t/attempts/${id}/grade`, { questionId: x.id, rubric, override: over.value === '' ? null : Number(over.value) });
          msg.textContent = 'Saved';
          lastDetail = '';
          save.blur();
          refresh();
        } catch (e) { msg.textContent = e.message; save.disabled = false; }
      });
      const pointsRow = h('div', { class: 't-row' },
        h('label', { class: 't-small', for: over.id, text: `Points (0–${x.max})` }), over, save, msg);
      if (!boxes.length) {
        // Most answers never need this: keep it folded away unless it's in use.
        return h('details', { class: 't-adjust', open: x.overridePoints != null }, h('summary', { class: 't-small', text: 'Adjust points' }), pointsRow);
      }
      return h('div', { class: 't-grade' },
        h('div', { class: 't-rubric' }, h('p', { class: 't-small', text: 'Rubric' }), boxes.map((b) => b.el)),
        pointsRow);
    }

    const corrBtn = h('button', { class: 'btn', type: 'button', text: 'Corrections', hidden: true, onclick: () => correctionsDialog(runId, lastRun) });
    extra.append(toggle, lockBtn, sebLinks, exportLink, classReport, corrBtn);
    detail.className = 't-detail-host';
    detail.setAttribute('aria-labelledby', 't-detail-name');
    if (openRuns === null) { try { noteRuns((await api('/api/t/overview')).runs); } catch (e) { /* the tab can wait */ } }
    const isCurrent = openRuns && openRuns[0] && openRuns[0].id === runId;
    mount(shell(isCurrent ? 'current' : tab === 'results' ? 'results' : 'give',
        h('section', { class: 't-section' },
          h('div', { class: 't-code' }, code, h('div', {}, title, meta)),
          howTo, quitPw,
          h('div', { class: 't-row t-run-acts' }, admitAll, aiBtn, moreBtn, extra), aiMsg,
          failedBox, summary),
        h('div', { class: 't-livegrid' }, h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-run' },
          h('thead', {}, h('tr', {}, heads(['Student', 'Status', 'Integrity', 'Strikes', 'Time away', 'Warnings', 'Answered', 'Heartbeat', 'Time left', 'Score'], ['Strikes', 'Time away', 'Warnings', 'Answered', 'Heartbeat', 'Time left', 'Score']), actionsHead())),
          tbody)),
        detail)));
    await refresh();
    pollTimer = setInterval(refresh, 2000);
    tickTimer = setInterval(tick, 1000);
  }

  // Clocks between polls: the server's numbers come every 2s, and these count every second in between.
  // ticks(kind, ms) marks a cell with when its clock reads 0 (counting down) or started (counting up).
  const ticks = (kind, ms) => ({ 'data-tick': kind, 'data-at': String(Date.now() + ms) });
  function tick() {
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-tick]')) {
      const at = Number(el.dataset.at);
      if (el.dataset.tick === 'left') el.textContent = mmss(Math.max(0, at - now));
      else if (el.dataset.tick === 'left-label') el.textContent = `${mmss(Math.max(0, at - now))} left`;
      else if (el.dataset.tick === 'away') el.textContent = 'Now, ' + mmss(now - at);
      else if (el.dataset.tick === 'beat') {
        const s = Math.round((now - at) / 1000);
        el.textContent = `${s}s ago`;
        el.classList.toggle('t-late', s > 6);
        el.classList.toggle('quiet', s <= 6);
      }
    }
  }

  function drawTrail(canvas, pts) {
    const css = getComputedStyle(document.documentElement);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const hh = canvas.height;
    ctx.fillStyle = css.getPropertyValue('--bg').trim() || '#fff';
    ctx.fillRect(0, 0, w, hh);
    if (pts.length < 2) return;
    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#2257d6';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const px = (x / 1000) * w; const py = (y / 1000) * hh; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  window.BQT = { h, api, post, mount, bar, showHome, plural, date, setHash, icon, ICONS, guard: (fn) => { leaveGuard = fn; } };
  route();
})();
