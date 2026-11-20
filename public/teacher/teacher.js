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
    resume: 'Continued on a new computer', 'let-in': 'Let back in by teacher', extend: 'Extra time', grade: 'Graded by teacher',
    'extended-display': 'Second display', 'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
    'late-submit': 'Submitted late', exit: 'Exited the quiz', 'other-network': 'Request from another network', 'other-device': 'Request from another browser',
  };
  let pollTimer = 0;
  let selected = null;

  try { const t = localStorage.getItem(THEME_KEY); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
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
    const paint = () => { const d = isDark(); b.textContent = d ? '☀' : '☾'; b.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); };
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
      who && who.role !== 'admin' ? h('button', { class: 'btn small', type: 'button', text: 'Password', onclick: () => showSetPassword(false) }) : null,
      h('button', { class: 'btn small', type: 'button', text: 'Sign out', onclick: async () => { await post('/api/t/logout'); who = null; showLogin(); } }));
  }
  function mount(...nodes) { clearInterval(pollTimer); root.replaceChildren(...nodes); }

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
      try { await post('/api/t/login', { username: user.value.trim(), password: pw.value }); showHome(); } catch (ex) { msg.textContent = ex.message === 'bad_password' ? 'Wrong password.' : ex.message === 'too_many' ? 'Too many tries. Wait a minute.' : ex.message; btn.disabled = false; pw.select(); }
    });
    mount(form);
    user.focus();
  }

  // A teacher on a temporary password picks their own before anything else (first), or changes it later.
  function showSetPassword(first) {
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
      h('div', { class: 't-row' }, btn, first ? null : h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => showHome() })), msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      if (next.value !== again.value) { msg.textContent = "The new passwords don't match."; return; }
      btn.disabled = true;
      try { await post('/api/t/me/password', { current: cur.value, next: next.value }); showHome(); } catch (ex) { msg.textContent = ex.message; btn.disabled = false; }
    });
    mount(form);
    cur.focus();
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
        h('thead', {}, h('tr', {}, ['Name', 'Username', 'Quizzes', 'Classes', 'Status', ''].map((x) => h('th', { text: x })))),
        h('tbody', {}, r.teachers.map((x) => h('tr', {},
          h('td', { text: x.name }), h('td', { class: 't-muted', text: x.username }),
          h('td', { class: 'num', text: String(x.quizzes) }), h('td', { class: 'num', text: String(x.classes) }),
          h('td', { class: x.disabled ? 't-muted' : x.pending ? 'st-waiting' : 'st-good', text: x.role === 'admin' ? 'Admin' : x.disabled ? 'Disabled' : x.pending ? 'Not signed in yet' : 'Active' }),
          h('td', { class: 't-actions' }, x.role === 'admin' ? null : [
            h('button', { class: 'btn small', type: 'button', text: 'Reset password', onclick: () => act(x, 'reset') }),
            h('button', { class: 'btn small', type: 'button', text: x.disabled ? 'Enable' : 'Disable', onclick: () => act(x, x.disabled ? 'enable' : 'disable') }),
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
    return h('section', { class: 't-section' }, h('h2', { text: 'Teachers' }), list, form, msg);
  }

  // ---------- home ----------
  async function showHome() {
    let data;
    let me = null;
    try { [data, me] = await Promise.all([api('/api/t/overview'), api('/api/t/me').catch(() => null)]); } catch (e) { if (e.message !== 'login') mount(h('p', { class: 't-error', text: e.message })); return; }
    who = me && me.teacher;
    const runner = !me || !me.runner || me.runnerOk ? null
      : h('p', { class: 't-error t-small' }, h('span', { class: 'dot bad' }), 'Code runner offline. Code questions get graded once it is back.');
    const quizSel = picker('run-quiz', 'Quiz', data.quizzes.map((x) => ({ value: x.id, label: x.title, meta: [plural(x.questions, 'question'), date(x.createdAt)] })));
    const rosterSel = picker('run-roster', 'Class', data.rosters.map((x) => ({ value: x.id, label: x.name, meta: [plural(x.students, 'student')] })));
    const ipLock = h('input', { type: 'checkbox', id: 'ip-lock', checked: true });
    const practice = h('input', { type: 'checkbox', id: 'practice' });
    const startMsg = h('p', { class: 't-error', role: 'alert' });
    const startBtn = h('button', { class: 'btn primary', type: 'button', text: 'Start quiz', disabled: !data.quizzes.length || !data.rosters.length });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try { const r = await post('/api/t/runs', { quizId: quizSel.value, rosterId: rosterSel.value, ipLock: ipLock.checked, practice: practice.checked }); showRun(r.id); } catch (e) { startMsg.textContent = e.message; startBtn.disabled = false; }
    });

    const quizFile = h('input', { class: 'input', type: 'file', id: 'quiz-file', accept: '.quiz,.zip,.json' });
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

    mount(bar('BrowserQuiz (Teacher Panel)'), h('main', { class: 't-main' },
      h('section', { class: 't-section' },
        h('h1', { text: 'Start a quiz' }),
        !data.quizzes.length || !data.rosters.length ? h('p', { class: 't-muted', text: 'Upload a quiz and a roster below first.' }) : null,
        h('div', { class: 't-row' },
          quizSel.el, rosterSel.el),
        h('label', { class: 't-check', for: 'ip-lock' }, ipLock, h('span', { text: 'Only allow students on my current network' })),
        h('label', { class: 't-check', for: 'practice' }, practice, h('span', { text: 'Practice: no lockdown or monitoring, and students see the answers at the end' })),
        h('div', {}, startBtn), startMsg, runner),
      h('section', { class: 't-section' },
        h('h2', { text: 'Recent quizzes' }),
        data.runs.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
          h('thead', {}, h('tr', {}, ['Code', 'Quiz', 'Class', 'Status', 'Joined', 'Started', ''].map((x) => h('th', { text: x })))),
          h('tbody', {}, data.runs.map((r) => h('tr', {},
            h('td', {}, h('button', { class: 't-link', type: 'button', text: r.code, onclick: () => showRun(r.id) })),
            h('td', { text: r.quiz }), h('td', { text: r.roster }),
            h('td', { class: r.status === 'open' ? 'st-good' : 't-muted', text: `${r.status === 'open' ? 'Open' : 'Closed'}${r.practice ? ' (practice)' : ''}` }),
            h('td', { class: 'num', text: String(r.joined) }), h('td', { text: date(r.createdAt) }),
            h('td', { class: 't-actions' }, h('button', { class: 'btn small', type: 'button', text: 'Delete',
              onclick: () => remove(`/api/t/runs/${r.id}/delete`, `Delete ${r.code} and all its results?${r.status === 'open' ? " It's still open: anyone taking it gets signed out." : ''}`) }))))))) : h('p', { class: 't-muted', text: 'None yet.' })),
      h('section', { class: 't-section' },
        h('div', { class: 't-head' }, h('h2', { text: 'Quizzes' }),
          copyPromptBtn(),
          h('button', { class: 'btn small primary', type: 'button', text: 'New quiz', onclick: () => window.BQT.showQuizEditor(null) })),
        data.quizzes.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-list' },
          h('tbody', {}, data.quizzes.map((x) => h('tr', {},
            h('td', { text: x.title }),
            h('td', { class: 't-muted', text: plural(x.questions, 'question') }),
            h('td', { class: 't-muted', text: x.timeLimitMin ? `${x.timeLimitMin} min` : 'No time limit' }),
            h('td', { class: 't-muted', text: date(x.createdAt) }),
            h('td', { class: 't-actions' },
              linkBtn('Preview', `/teacher/preview.html?quiz=${encodeURIComponent(x.id)}`, true),
              h('button', { class: 'btn small', type: 'button', text: 'Edit', onclick: () => window.BQT.showQuizEditor(x.id) }),
              linkBtn('Download', `/api/t/quizzes/${encodeURIComponent(x.id)}/download`),
              h('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => remove(`/api/t/quizzes/${x.id}/delete`, `Delete ${x.title}? Past results stay.`) }))))))) : null,
        h('div', { class: 't-row' }, h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: 'Upload a .quiz or quiz.json' }), quizFile), quizBtn),
        h('details', { class: 't-paste' }, h('summary', { text: 'Paste a quiz.json' }),
          h('label', { class: 'field', for: 'paste-quiz' }, h('span', { class: 'field-label', text: 'quiz.json' }), pasteJson), h('div', {}, pasteBtn)),
        quizMsg),
      h('section', { class: 't-section' },
        h('div', { class: 't-head' }, h('h2', { text: 'Classes' }),
          h('button', { class: 'btn small primary', type: 'button', text: 'New class', onclick: () => showRoster(null) })),
        data.rosters.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-list' },
          h('tbody', {}, data.rosters.map((x) => h('tr', {},
            h('td', { text: x.name }),
            h('td', { class: 't-muted', text: plural(x.students, 'student') }),
            h('td', { class: 't-actions' },
              h('button', { class: 'btn small', type: 'button', text: 'Edit', onclick: () => showRoster(x.id) }),
              h('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => remove(`/api/t/rosters/${x.id}/delete`, `Delete ${x.name}? Past results stay.`) }))))))) : null,
        h('div', { class: 't-row' },
          h('label', { class: 'field', for: 'roster-name' }, h('span', { class: 'field-label', text: 'Class name' }), rosterName),
          h('label', { class: 'field', for: 'roster-file' }, h('span', { class: 'field-label', text: 'Upload a CSV (name, student_id)' }), rosterFile),
          rosterBtn),
        rosterMsg),
      who && who.role === 'admin' ? teachersSection() : null));
  }

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
      'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-labelledby': `${id}-label ${id}-value`,
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
        const btn = h('button', { class: 'btn small', type: 'button', text: 'Remove' });
        btn.addEventListener('click', () => {
          if (removing.has(st.id)) { removing.delete(st.id); btn.textContent = 'Remove'; row.classList.remove('t-removed'); }
          else { removing.add(st.id); btn.textContent = 'Undo'; row.classList.add('t-removed'); }
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
        showHome();
      } catch (e) { msg.textContent = e.message; save.disabled = false; }
    });
    mount(bar(h('button', { class: 't-link', type: 'button', text: '← All quizzes', onclick: () => showHome() })),
      h('main', { class: 't-main' }, h('section', { class: 't-section' },
        h('h1', { text: id ? 'Edit class' : 'New class' }),
        h('label', { class: 'field', for: 'class-name' }, h('span', { class: 'field-label', text: 'Class name' }), name),
        id ? h('h2', { text: plural(roster.students.length, 'student') }) : null,
        list,
        h('label', { class: 'field', for: 'class-add' }, h('span', { class: 'field-label', text: id ? 'Add students: name, student ID (one per line)' : 'Students: name, student ID (one per line)' }), add),
        h('div', { class: 't-row' }, save, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => showHome() })),
        msg)));
    (id ? add : name).focus();
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
    if (a.integrity === 'restored') return h('td', { class: 'st-waiting', text: 'Restored' });
    return h('td', { class: 'st-good', text: 'Clean' });
  }

  async function showRun(runId) {
    selected = null;
    const code = h('span', { class: 't-joincode' });
    const title = h('h1');
    const meta = h('p', { class: 't-muted' });
    const tbody = h('tbody');
    const detail = h('div');
    const toggle = h('button', { class: 'btn', type: 'button' });
    const lockBtn = h('button', { class: 'btn', type: 'button' });
    const howTo = h('p', { class: 't-muted t-small' });
    const failedBox = h('div');
    let lastDetail = '';
    const admitAll = h('button', { class: 'btn primary', type: 'button', text: 'Admit everyone waiting', onclick: () => act(`/api/t/runs/${runId}/admit-all`) });
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

    async function refresh() {
      let data;
      try { data = await api(`/api/t/runs/${runId}/live`); } catch (e) { return; }
      const run = data.run;
      code.textContent = run.code;
      title.textContent = run.title;
      meta.textContent = `${plural(run.questions, 'question')}${run.timeLimitMin ? `, ${plural(run.timeLimitMin, 'minute')}` : ''}. ${run.status === 'open' ? 'Open' : 'Closed'}${run.practice ? ', practice' : ''}${run.ipLock ? ', only your network' : ''}.`;
      howTo.textContent = `Join at ${location.origin}`;
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
      const order = (s) => (s.attempt ? (s.attempt.integrity === 'invalidated' ? 0 : s.attempt.status === 'waiting' ? 1 : 2) : 3);
      const rows = data.students.slice().sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
      const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
      tbody.replaceChildren(...rows.map((s) => {
        const a = s.attempt;
        const actions = h('td', { class: 't-actions' });
        const btn = (text, key, onclick, extra) => h('button', Object.assign({ class: 'btn small', type: 'button', text, onclick, 'data-key': `${a.id}:${key}` }, extra || {}));
        if (a && a.status === 'waiting') actions.append(btn('Admit', 'admit', () => act(`/api/t/attempts/${a.id}/admit`), { class: 'btn small primary' }));
        if (a && a.integrity === 'invalidated') actions.append(btn('Restore', 'restore', () => { if (confirm(`Restore ${s.name}?`)) act(`/api/t/attempts/${a.id}/restore`); }));
        if (a && (a.status === 'active' || a.status === 'admitted')) {
          actions.append(a.letIn
            ? h('span', { class: 't-muted t-small', text: 'Can sign in again' })
            : btn('Let back in', 'letin', () => act(`/api/t/attempts/${a.id}/let-in`), { title: 'Crashed computer or new seat: they sign in again and keep their answers and time' }));
        }
        if (a) actions.append(btn('Reset', 'reset', () => { if (confirm(`Reset ${s.name}? Their answers are deleted. (Crashed computer? Use Let back in.)`)) act(`/api/t/attempts/${a.id}/reset`); }, { title: 'Throw out this attempt and let them start over' }));
        const beat = a && a.lastBeatAgo != null ? Math.round(a.lastBeatAgo / 1000) : null;
        let score = '';
        if (a && a.score != null) {
          score = `${a.score} / ${a.max}`;
          if (a.pending) score += ' (grading)';
          else if (a.failed) score += ' (grading failed)';
          else if (a.review) score += ' (needs review)';
        }
        return h('tr', { class: selected === (a && a.id) ? 'sel' : null },
          h('td', {}, a ? h('button', { class: 't-link', type: 'button', text: s.name, 'data-key': `${a.id}:name`, onclick: () => { selected = a.id; lastDetail = ''; showDetail(a.id); refresh(); } }) : s.name),
          statusCell(s), integrityCell(a),
          h('td', { class: 'num', text: a ? String(a.strikes) : '' }), h('td', { class: 'num', text: a ? String(a.warnings) : '' }),
          h('td', { class: 'num', text: a && a.status !== 'waiting' ? `${a.answered}/${a.total}` : '' }),
          h('td', { class: 'num' + (beat != null && beat > 6 ? ' t-late' : ''), text: beat != null ? `${beat}s ago` : '' }),
          h('td', { class: 'num', text: a && a.timeLeft != null ? mmss(a.timeLeft) : '' }),
          h('td', { class: 'num' + (a && (a.failed || a.review) ? ' st-waiting' : ''), text: score }),
          actions);
      }));
      // Keep keyboard focus on the same button after the redraw, without scrolling the page back to it.
      if (focusKey) { const again = tbody.querySelector(`[data-key="${CSS.escape(focusKey)}"]`); if (again) again.focus({ preventScroll: true }); }
      if (selected) showDetail(selected, true);
    }

    async function showDetail(id, quiet) {
      let d;
      try { d = await api(`/api/t/attempts/${id}`); } catch (e) { return; }
      if (selected !== id) return;
      // The poll re-renders every 2s: don't wipe what the teacher is typing, selecting or reading.
      const snapshot = JSON.stringify(Object.assign({}, d, { timeLeft: null }));
      const typing = detail.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
      if (quiet && (snapshot === lastDetail || typing || String(window.getSelection() || '') !== '')) return;
      lastDetail = snapshot;
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
        if (x.override) notes.push('Points set by you');
        if (x.review) notes.push('Needs review');
        if (x.type === 'code' && x.code && x.code.tests && x.code.tests.length) {
          notes.push(`Hidden tests passed: ${x.code.tests.filter((t) => t.pass).length} of ${x.code.tests.length}`);
        }
        if (notes.length) sec.append(h('p', { class: 't-small t-muted', text: notes.join('. ') + '.' }));
        if (d.status === 'submitted') sec.append(gradeControls(id, x));
        return sec;
      }));
      detail.replaceChildren(h('section', { class: 't-detail' },
        h('div', { class: 't-row' },
          h('h2', { style: 'flex:1', text: d.name }),
          d.integrity !== 'invalidated' ? h('button', { class: 'btn small', type: 'button', text: 'Invalidate', onclick: () => { const note = prompt('Reason (optional)'); if (note !== null) act(`/api/t/attempts/${id}/invalidate`, { note }); } }) : null,
          d.status === 'active' && d.deadline ? h('span', { class: 't-muted t-small', text: `${mmss(d.timeLeft || 0)} left` }) : null,
          d.status === 'active' && d.deadline ? h('button', { class: 'btn small', type: 'button', text: '+5 min', onclick: () => { lastDetail = ''; act(`/api/t/attempts/${id}/extend`, { minutes: 5 }); } }) : null,
          d.status === 'submitted' ? h('a', { class: 'btn small', href: `/teacher/report.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Report', style: 'display:inline-flex;align-items:center;text-decoration:none' }) : null,
          d.status === 'submitted' ? h('button', { class: 'btn small', type: 'button', text: 'Regrade', onclick: () => act(`/api/t/attempts/${id}/regrade`) }) : null,
          h('button', { class: 'btn small', type: 'button', text: 'Close', onclick: () => { selected = null; detail.replaceChildren(); refresh(); } })),
        d.integrity === 'invalidated' ? h('p', { class: 'st-bad', text: `Invalidated at ${clock(d.invalidatedAt)}: ${(LABEL[d.reason] || d.reason || '').toLowerCase()}` }) : null,
        h('div', { class: 't-detail-grid' },
          h('div', { class: 't-section' }, h('h3', { text: 'Activity' }),
            h('ul', { class: 't-events' }, d.events.map((e) => h('li', { class: e.severity }, h('time', { text: clock(e.t) }), h('span', {}, h('b', { text: LABEL[e.type] || e.type }), e.detail ? h('span', { class: 't-muted', text: ` ${e.detail}` }) : null))))),
          h('div', { class: 't-section' }, h('h3', { text: 'Mouse trail' }), canvas,
            h('p', { class: 't-muted t-small', text: `${d.mouse.length} mouse samples` }),
            d.userAgent ? h('p', { class: 't-muted t-small', text: d.userAgent }) : null)),
        h('div', { class: 't-section' }, h('h3', { text: d.totals ? `Answers (${d.totals.score} / ${d.totals.max}${d.totals.pending ? ', code still grading' : d.totals.failed ? ', grading failed' : d.totals.review ? ', needs review' : ''})` : 'Answers so far' }), answers)));
      drawTrail(canvas, d.mouse);
      window.BQReport.highlight(answers);
      if (!quiet) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Rubric checkboxes and a points override for one answer.
    function gradeControls(id, x) {
      const boxes = x.rubric.map((r) => {
        const cb = h('input', { type: 'checkbox', id: `rb-${x.id}-${r.id}`, checked: r.checked });
        return { r, cb, el: h('label', { class: 't-check', for: cb.id }, cb, h('span', { text: `${r.text} (${plural(r.points, 'point')})` }),
          r.auto ? h('span', { class: 't-auto', text: 'Auto', title: 'Checked by the server. Change it and press Save to grade it yourself.' }) : null) };
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

    mount(bar(h('button', { class: 't-link', type: 'button', text: '← All quizzes', onclick: () => showHome() })),
      h('main', { class: 't-main' },
        h('section', { class: 't-section' },
          h('div', { class: 't-code' }, code, h('div', {}, title, meta)),
          howTo,
          h('div', { class: 't-row' }, admitAll, toggle, lockBtn, exportLink, classReport),
          failedBox),
        h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
          h('thead', {}, h('tr', {}, ['Student', 'Status', 'Integrity', 'Strikes', 'Warnings', 'Answered', 'Heartbeat', 'Time left', 'Score', ''].map((x) => h('th', { text: x })))),
          tbody)),
        detail));
    await refresh();
    pollTimer = setInterval(refresh, 2000);
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

  window.BQT = { h, api, post, mount, bar, showHome, plural, date };
  api('/api/t/me').then(showHome).catch(() => {});
})();
