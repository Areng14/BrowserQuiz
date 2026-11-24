// BrowserQuiz teacher dashboard: sign in, upload quizzes and rosters, start a quiz, watch it live.
// Everything a student typed is shown with textContent only.
(function () {
  'use strict';
  const root = document.getElementById('t-app');
  const ask = window.BQAsk; // our own confirm, notice and prompt (ask.js)
  const THEME_KEY = 'bq-theme';
  const LABEL = {
    join: 'Signed in', ready: 'Agreed to the rules, waiting in full screen', admit: 'Started by you', 'away-long': 'Gone longer than 10 seconds', start: 'Started the quiz', submit: 'Submitted', run: 'Ran examples', reload: 'Reopened mid-quiz',
    restore: 'Un-invalidated by teacher', automation: 'Browser run by a script', 'virtual-machine': 'Virtual machine or remote desktop', 'software-graphics': 'No graphics card (VM or remote desktop?)', invalidate: 'Invalidated by teacher', blur: 'Left the quiz window', hidden: 'Tab hidden',
    'fullscreen-exit': 'Left fullscreen', return: 'Came back', 'mouse-left': 'Cursor left the page', copy: 'Copy blocked',
    paste: 'Outside paste blocked', contextmenu: 'Right-click', 'blocked-key': 'Blocked key', 'print-screen': 'Print Screen',
    resize: 'Window resized', 'unfocused-beat': 'Heartbeat: not focused', 'heartbeat-lost': 'Connection lost', reconnect: 'Reconnected',
    resume: 'Continued on a new computer', 'let-in': 'Let back in by teacher', extend: 'Extra time', grade: 'Graded by teacher', 'ai-grade': 'Graded by AI',
    'extended-display': 'Second display', 'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
    'late-submit': 'Submitted late', exit: 'Exited the quiz', 'other-network': 'Request from another network', 'left-network': 'Tried to continue from another network', 'other-device': 'Request from another browser',
    extension: 'Extension on the page', 'spoofed-checks': 'Extension hides leaving the window', 'no-frames': 'Quiz not on screen, no leave reported',
    'scripted-input': 'Typed by a script', viewport: 'Side panel or DevTools open', setup: 'Computer',
    'answer-after-return': 'Changed an answer right after coming back', 'same-browser': 'Same browser as',
    'new-network': 'Network not used on earlier quizzes',
  };
  // Browsers only offer passkeys on HTTPS (and localhost), so plain-http installs don't show them.
  const PASSKEYS = !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);
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
    if (!res.ok) {
      const err = new Error((data && data.message) || (data && data.error) || `Request failed (${res.status})`);
      err.code = data && data.error;
      throw err;
    }
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
  // The password just typed at sign-in, so picking a new one doesn't ask for it again (memory only).
  let justTyped = null;
  // The signed-in teacher's name, opening a menu: their password (or, for admin with the password in
  // .env, which is changed there, only passkeys) and Sign out.
  function accountMenu() {
    if (!who) return null;
    const items = [];
    if (!(who.passwordFromEnv && !PASSKEYS)) items.push({ text: who.passwordFromEnv ? 'Passkeys' : 'Password', onclick: () => showSetPassword(false) });
    items.push({ text: 'Sign out', onclick: async () => { await post('/api/t/logout'); who = null; showLogin(); } });
    return moreMenu(`Account, ${who.name}`, 'account', items, null, { text: who.name });
  }
  function bar(...left) {
    return h('header', { class: 't-bar' }, h('span', { class: 'grow' }, ...left), themeButton(), accountMenu());
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
    const pk = PASSKEYS ? h('button', { class: 'btn', type: 'button', text: 'Sign in with a passkey' }) : null;
    if (pk) pk.addEventListener('click', () => passkeySignIn(pk, msg));
    const form = h('form', { class: 't-login' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: 'Teacher sign in' }),
      h('label', { class: 'field', for: 'user' }, h('span', { class: 'field-label', text: 'Username' }), user),
      h('label', { class: 'field', for: 'pw' }, h('span', { class: 'field-label', text: 'Password' }), pw),
      btn, pk, msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; msg.textContent = '';
      try { const r = await post('/api/t/login', { username: user.value.trim(), password: pw.value }); justTyped = { pw: pw.value, at: Date.now() }; if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else route(); } catch (ex) { msg.textContent = ex.message === 'bad_password' ? 'Wrong password.' : ex.message === 'too_many' ? 'Too many tries. Wait a minute.' : ex.message; btn.disabled = false; pw.select(); }
    });
    mount(h('main', { class: 't-login-page' }, form, h('p', { class: 't-login-foot' }, ghLink())));
    user.focus();
  }

  // A teacher on a temporary password picks their own before anything else (first), or changes it later.
  async function showSetPassword(first) {
    if (!first && who && who.passwordFromEnv) {
      mount(h('main', {}, passkeysSection(true), h('div', { class: 't-pk' }, h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Back', onclick: () => showHome() })))));
      return;
    }
    // After an admin reset, with the quiz key not in memory: the recovery code keeps their quizzes.
    let recover = false;
    let fromEnv = false; // admin's first sign-in, with ADMIN_PASSWORD: it isn't a temporary one
    let uname = who ? who.username : '';
    let role = who ? who.role : '';
    if (first) { try { const me = await api('/api/t/me'); recover = !!(me.teacher && me.teacher.needsRecovery); fromEnv = !!(me.teacher && me.teacher.passwordFromEnv); uname = (me.teacher && me.teacher.username) || uname; role = (me.teacher && me.teacher.role) || role; } catch (e) { return; } }
    // Admin still called "admin" picks a username of their own too (anyone could guess "admin"). Otherwise
    // it's whose password this is, hidden, for password managers to save the new one under.
    const needName = role === 'admin' && uname.toLowerCase() === 'admin';
    const account = needName
      ? h('input', { class: 'input', id: 'pw-user', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true })
      : h('input', { type: 'text', autocomplete: 'username', value: uname, readonly: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    const code = h('input', { class: 'input t-mono', id: 'pw-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX' });
    const fresh = h('input', { type: 'checkbox', id: 'pw-fresh' });
    fresh.addEventListener('change', () => { code.disabled = fresh.checked; });
    const cur = h('input', { class: 'input', type: 'password', id: 'pw-cur', autocomplete: 'current-password' });
    const known = first && justTyped && Date.now() - justTyped.at < 10 * 60000;
    if (known) cur.value = justTyped.pw;
    const curField = h('label', { class: 'field', for: 'pw-cur', hidden: known }, h('span', { class: 'field-label', text: first && !fromEnv ? 'Temporary password' : 'Current password' }), cur);
    const next = h('input', { class: 'input', type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '10' });
    const again = h('input', { class: 'input', type: 'password', id: 'pw-again', autocomplete: 'new-password' });
    const msg = h('p', { class: 't-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: needName ? 'Save' : 'Save password' });
    const form = h('form', { class: 't-login' }, needName ? null : account,
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: needName ? 'Pick your username and password' : first ? 'Pick your password' : 'Change your password' }),
      needName ? h('label', { class: 'field', for: 'pw-user' }, h('span', { class: 'field-label', text: 'Username' }), account) : null,
      curField,
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
      if (recover && fresh.checked && !(await ask.confirm({ title: 'Start over?', text: 'Your quizzes, and the results from them, are deleted for good.', ok: 'Start over', danger: true }))) { btn.disabled = false; return; }
      try {
        const r = await post('/api/t/me/password', { current: cur.value, next: next.value, username: needName ? account.value.trim() : undefined, recoveryCode: recover && !fresh.checked ? code.value : undefined, startOver: recover && fresh.checked });
        justTyped = null;
        if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else showHome();
      } catch (ex) {
        msg.textContent = ex.message; btn.disabled = false;
        if (ex.code === 'bad_password' && curField.hidden) { curField.hidden = false; cur.value = ''; cur.focus(); }
      }
    });
    mount(h('main', { class: 't-login-page' }, form, !first && PASSKEYS ? passkeysSection(false) : null));
    (needName ? account : known ? next : cur).focus();
  }

  // ---------- passkeys ----------
  const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const cancelled = (e) => e && (e.name === 'NotAllowedError' || e.name === 'AbortError'); // closed the browser's prompt
  const prfOut = (cred) => { const x = cred.getClientExtensionResults().prf; return x && x.results && x.results.first ? b64e(x.results.first) : null; };
  const signed = (cred) => ({ id: b64e(cred.rawId), clientDataJSON: b64e(cred.response.clientDataJSON), authenticatorData: b64e(cred.response.authenticatorData), signature: b64e(cred.response.signature) });
  // A passkey the server doesn't keep: the passkey manager stops offering it, where the browser can.
  const forget = (rpId, credentialId) => {
    try { if (PublicKeyCredential.signalUnknownCredential) PublicKeyCredential.signalUnknownCredential({ rpId, credentialId }).catch(() => {}); } catch (e) { /* not supported */ }
  };

  async function passkeySignIn(btn, msg) {
    btn.disabled = true;
    msg.textContent = '';
    try {
      const o = await post('/api/t/passkeys/login-options');
      let cred;
      try {
        cred = await navigator.credentials.get({ publicKey: {
          challenge: b64d(o.challenge), rpId: o.rpId, allowCredentials: [], userVerification: 'required', timeout: 120000,
          extensions: { prf: { eval: { first: b64d(o.prfSalt) } } },
        } });
      } catch (e) { if (cancelled(e)) return; throw e; }
      try {
        await post('/api/t/passkeys/login', Object.assign(signed(cred), { userHandle: cred.response.userHandle ? b64e(cred.response.userHandle) : null, prf: prfOut(cred) }));
      } catch (e) { if (e.code === 'unknown_passkey') forget(o.rpId, b64e(cred.rawId)); throw e; }
      route();
    } catch (ex) {
      msg.textContent = ex.message === 'too_many' ? 'Too many tries. Wait a minute.' : ex.message;
    } finally { btn.disabled = false; }
  }

  // create(), then, if that gave no PRF output (it usually doesn't), get() on just the new passkey for
  // it: a second touch. The quiz key is sealed with it, so a passkey without PRF can't be added (except
  // by admin with the password in .env). null: the teacher closed the browser's prompt.
  async function addPasskey(password) {
    const o = await post('/api/t/passkeys/add-options', { password });
    const salt = b64d(o.prfSalt);
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: {
        rp: { id: o.rpId, name: 'BrowserQuiz' },
        user: { id: b64d(o.user.id), name: o.user.name, displayName: o.user.displayName },
        challenge: b64d(o.challenge),
        pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: o.exclude.map((id) => ({ type: 'public-key', id: b64d(id) })),
        attestation: 'none', timeout: 120000, extensions: { prf: { eval: { first: salt } } },
      } });
    } catch (e) {
      if (cancelled(e)) return null;
      if (e.name === 'InvalidStateError') throw new Error('That passkey is already added.');
      throw e;
    }
    const id = b64e(cred.rawId);
    const body = {
      create: { id, clientDataJSON: b64e(cred.response.clientDataJSON), attestationObject: b64e(cred.response.attestationObject) },
      get: null, prf: prfOut(cred), attachment: cred.authenticatorAttachment || null,
    };
    const noPrf = () => { forget(o.rpId, id); return new Error("This passkey can't unlock your quizzes. Try another."); };
    if (o.needPrf && !body.prf) {
      const ext = cred.getClientExtensionResults().prf;
      if (!ext || ext.enabled === false) throw noPrf();
      let got;
      try {
        got = await navigator.credentials.get({ publicKey: {
          challenge: b64d(o.getChallenge), rpId: o.rpId, allowCredentials: [{ type: 'public-key', id: cred.rawId }],
          userVerification: 'required', timeout: 120000, extensions: { prf: { eval: { first: salt } } },
        } });
      } catch (e) { forget(o.rpId, id); if (cancelled(e)) return null; throw e; }
      body.prf = prfOut(got);
      if (!body.prf) throw noPrf();
      body.get = signed(got);
    }
    try { return await post('/api/t/passkeys/add', body); } catch (e) { if (e.code && e.code !== 'taken') forget(o.rpId, id); throw e; }
  }

  // The signed-in teacher's passkeys: each one's name, when it was added and last used, and Remove.
  function passkeysSection(top) {
    const list = h('ul', { class: 't-pk-list' });
    list.hidden = true;
    const msg = h('p', { class: 't-error', role: 'alert' });
    const add = h('button', { class: 'btn', type: 'button', text: 'Add a passkey' });
    const paint = (keys) => {
      list.hidden = !keys.length;
      list.replaceChildren(...keys.map((k) => h('li', {},
        h('span', { class: 't-pk-what' }, h('span', { class: 't-pk-name', text: k.name }),
          h('span', { class: 't-small t-muted t-pk-meta' },
            h('span', { text: `Added ${new Date(k.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` }), ' · ',
            h('span', { text: k.lastUsedAt ? `Last used ${date(k.lastUsedAt)}` : 'Not used yet' }))),
        h('button', { class: 'btn small', type: 'button', text: 'Remove', 'aria-label': `Remove ${k.name}`, onclick: async () => {
          if (!(await ask.confirm({ title: `Remove ${k.name}?`, text: "You can't sign in with it after this.", ok: 'Remove', danger: true }))) return;
          msg.textContent = '';
          try { paint((await post(`/api/t/passkeys/${encodeURIComponent(k.id)}/delete`)).passkeys); } catch (e) { if (e.message !== 'login') msg.textContent = e.message; }
        } }))));
    };
    add.addEventListener('click', async () => {
      add.disabled = true;
      msg.textContent = '';
      try {
        // the password first, so nobody else at this computer can add a passkey of their own
        const password = await ask.ask({ title: 'Add a passkey', label: 'Your password', password: true, ok: 'Continue' });
        const r = password == null ? null : await addPasskey(password);
        if (r) paint(r.passkeys);
      } catch (e) { if (e.message !== 'login') msg.textContent = e.message; }
      add.disabled = false;
    });
    api('/api/t/passkeys').then((r) => paint(r.passkeys)).catch(() => {});
    return h('section', { class: top ? 't-pk t-pk-top' : 't-pk', 'aria-labelledby': 'pk-title' },
      top ? h('p', { class: 'eyebrow', text: 'BrowserQuiz' }) : null,
      h(top ? 'h1' : 'h2', { id: 'pk-title', text: 'Passkeys' }), list, h('div', {}, add), msg);
  }

  // Shown once, when a teacher's quiz key is made: the only way back to their quizzes without the password.
  function showRecoveryCode(codeText) {
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy' }); // as tall as the code beside it
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
        if (action === 'disable' && !(await ask.confirm({ title: `Disable ${x.name}?`, text: "They're signed out and can't sign in. Their quizzes and results stay.", ok: 'Disable', danger: true }))) return;
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
          h('td', { class: 't-actions' }, x.role === 'admin' ? null : moreMenu(`More for ${x.name}`, `teacher:${x.id}`, [
            { text: 'Reset password', onclick: () => act(x, 'reset') },
            { text: x.disabled ? 'Enable' : 'Disable', danger: !x.disabled, onclick: () => act(x, x.disabled ? 'enable' : 'disable') },
          ]))))))));
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
  // Open quizzes: one goes straight to its live page, two or more to a list of them (#open).
  const OPEN = { id: 'open', label: 'Open quizzes', short: 'Open', icon: ['M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M16.24 7.76a6 6 0 0 1 0 8.49', 'M7.76 16.24a6 6 0 0 1 0-8.49', 'M19.07 4.93a10 10 0 0 1 0 14.14', 'M4.93 19.07a10 10 0 0 1 0-14.14'] };
  let openRuns = null; // [{ id, title, code }], newest first; null until the overview says
  function noteRuns(runs) {
    openRuns = runs.filter((r) => r.status === 'open').map((r) => ({ id: r.id, title: r.quiz_title, code: r.code }));
    live = openRuns.length;
  }
  let tab = 'give';
  let live = 0; // open quizzes, shown on the Open tab when there's more than one
  let here = location.hash;
  let leaveGuard = null; // set by a page with unsaved work; false keeps the teacher there
  let guardOpen = false;
  let navSeq = 0; // the latest page asked for, so a slow load doesn't replace a newer page

  function setHash(hash, replace) {
    here = hash;
    if (location.hash === hash) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  }
  async function route() {
    if (leaveGuard) {
      if (guardOpen) return; // already asking
      guardOpen = true;
      const go = await leaveGuard();
      guardOpen = false;
      if (!go) { history.pushState(null, '', here); return; }
    }
    leaveGuard = null;
    if (!who) { try { who = (await api('/api/t/me')).teacher; } catch (e) { return; } } // signs in first if needed
    const [a, b] = location.hash.slice(1).split('/');
    const id = b ? decodeURIComponent(b) : null;
    if (a === 'run' && id) showRun(id);
    else if (a === 'class') showRoster(id === 'new' ? null : id);
    else if (a === 'quiz') openQuiz(id === 'new' ? null : id);
    else showHome(a === 'open' || TABS.some((t) => t.id === a) ? a : 'give');
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
    plus: ['M12 5v14', 'M5 12h14'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
    chevron: ['M6 9l6 6 6-6'],
    dots: ['M5 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z', 'M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z', 'M19 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z'], // filled (rowMenu)
    // question types (the quiz maker)
    single: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
    multi: ['M4 4h16v16H4z', 'M8 12l3 3 5-6'],
    text: ['M4 7V5h16v2', 'M9 19h6', 'M12 5v14'],
    output: ['M4 17l6-5-6-5', 'M12 19h8'],
    trace: ['M3 4h18v16H3z', 'M3 10h18', 'M3 15h18', 'M10 4v16'],
    fill: ['M3 6h18v12H3z', 'M8 14h8'],
    code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
    essay: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h10'],
    section: ['M3 12h18', 'M8 6h8', 'M8 18h8'],
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
    const one = openRuns && openRuns.length === 1 && openRuns[0];
    if (openRuns && openRuns.length) tabs.splice(1, 0, Object.assign({}, OPEN, one ? { label: 'Open quiz', href: '#run/' + encodeURIComponent(one.id), title: `${one.title} (${one.code})` } : {}));
    return h('div', { class: 't-shell' },
      h('nav', { class: 't-side', 'aria-label': 'Dashboard' },
        h('div', { class: 't-brand' }, h('img', { class: 't-brand-icon', src: '/icon.svg', alt: '', width: 26, height: 26 }), 'BrowserQuiz'),
        h('div', { class: 't-nav' }, tabs.map((t) => h('a', { class: 't-nav-item', href: t.href || '#' + t.id, title: t.title || null, 'aria-current': t.id === active ? 'page' : null },
          icon(t.icon), h('span', { class: 't-nav-label' }, t.short || t.label, t.short ? h('span', { class: 't-nav-more', text: t.label.slice(t.short.length) }) : null),
          t.id === 'open' && live > 1 ? h('span', { class: 't-badge', title: `${live} open`, 'aria-label': `${live} open`, text: String(live) }) : null))),
        h('div', { class: 't-side-foot' }, accountMenu(), themeButton())),
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
    if (tab === 'open' && live < 2) { if (live) { history.replaceState(null, '', '#run/' + encodeURIComponent(openRuns[0].id)); showRun(openRuns[0].id); } else showHome('give'); return; }
    const page = { open: openTab, give: giveTab, results: resultsTab, quizzes: quizzesTab, classes: classesTab, teachers: teachersSection }[tab](data, me);
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
      // like every list: the rest, and Delete in red, under ⋯
      h('td', { class: 't-actions' }, moreMenu(`More for ${r.code}`, `run:${r.id}`, [
        h('a', { href: `/teacher/report.html?run=${encodeURIComponent(r.id)}`, target: '_blank', rel: 'noopener', text: 'Class report' }),
        { text: 'Delete', danger: true, onclick: () => remove(`/api/t/runs/${r.id}/delete`, `Delete ${r.code} and all its results?`, r.status === 'open' ? "It's still open: anyone taking it gets signed out." : null) }])))))));

  // Start a quiz: what, who, and how it's locked down. (Open ones are under the Open tab.)
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
    sebOwn.addEventListener('toggle', () => { if (sebOwn.open) sebKey.focus(); muteRow.hidden = mode !== 'seb' || sebOwn.open; }); // their own file has its own sound setting
    const modeCards = MODES.map((m) => {
      const input = h('input', { type: 'radio', name: 'mode', id: 'mode-' + m.id, value: m.id, checked: m.id === mode });
      input.addEventListener('change', () => { mode = m.id; sebOwn.hidden = mode !== 'seb'; muteRow.hidden = mode !== 'seb' || sebOwn.open; });
      return h('label', { class: 't-mode', for: 'mode-' + m.id, 'data-level': String(m.level) }, input,
        h('span', { class: 't-mode-title', text: m.title }),
        h('span', { class: 't-mode-sec' },
          h('span', { class: 't-meter', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('span', { class: i <= m.level ? 'on' : null }))),
          m.security));
    });
    const ipLock = h('input', { type: 'checkbox', id: 'ip-lock', class: 't-switch', role: 'switch', checked: false });
    // SEB only: mute the computer's sound (other apps and tabs included) while the quiz is open
    const sebMute = h('input', { type: 'checkbox', id: 'seb-mute', class: 't-switch', role: 'switch', checked: true });
    const muteRow = h('label', { class: 't-check t-switch-row', for: 'seb-mute' }, sebMute, h('span', { text: "Mute the computer's sound" }));
    muteRow.hidden = true;
    const startMsg = h('p', { class: 't-error', role: 'alert' });
    const ready = data.quizzes.length && data.rosters.length;
    const startBtn = h('button', { class: 'btn primary t-start', type: 'button', text: 'Start quiz', disabled: !ready });
    startBtn.addEventListener('click', async () => {
      const pick = data.quizzes.find((x) => x.id === quizSel.value);
      if (mode !== 'practice' && pick && pick.practiced
        && !(await ask.confirm({ title: 'Give it as a graded quiz?', text: `Students who practiced "${pick.title}" have seen its answers.`, ok: 'Give it anyway' }))) return;
      startBtn.disabled = true;
      startMsg.textContent = '';
      try {
        const own = mode === 'seb' && sebOwn.open && sebKey.value.trim();
        const r = await post('/api/t/runs', { quizId: quizSel.value, rosterId: rosterSel.value, ipLock: ipLock.checked, practice: mode === 'practice', seb: mode === 'seb', sebKey: own || null, sebMute: sebMute.checked });
        showRun(r.id);
      } catch (e) { startMsg.textContent = e.message; startBtn.disabled = false; }
    });
    const missing = [!data.quizzes.length && ['quiz', '#quizzes'], !data.rosters.length && ['class', '#classes']].filter(Boolean);
    return [
      h('section', { class: 't-section' },
        h('h1', { text: 'Give a quiz' }),
        missing.length ? h('p', { class: 't-muted' }, 'Add a ', missing.map(([w, href], i) => [i ? ' and a ' : '', h('a', { href, text: w })]), ' first.') : null,
        h('div', { class: 't-start-form' },
          h('div', { class: 't-row' }, quizSel.el, rosterSel.el),
          h('fieldset', { class: 't-modes' }, h('legend', { class: 'field-label', text: 'Mode' }), modeCards),
          muteRow,
          sebOwn,
          h('label', { class: 't-check t-switch-row', for: 'ip-lock' }, ipLock, h('span', { text: 'Only students on my current network' })),
          h('div', { class: 't-row t-start-row' }, startBtn, startMsg), runner)),
    ];
  }

  function openTab(data) {
    return h('section', { class: 't-section' }, h('h1', { text: 'Open quizzes' }), runsTable(data.runs.filter((r) => r.status === 'open')));
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
      h('div', { class: 't-head t-head-wrap' }, h('h1', { text: 'Quizzes' }),
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
            h('button', { class: 'btn small', type: 'button', text: 'Edit', 'aria-label': `Edit ${x.title}`, onclick: () => openQuiz(x.id) }),
            moreMenu(`More for ${x.title}`, `quiz:${x.id}`, [
              linkBtn('Preview', `/teacher/preview.html?quiz=${encodeURIComponent(x.id)}`, true),
              linkBtn('Download', `/api/t/quizzes/${encodeURIComponent(x.id)}/download`),
              { text: 'Delete', danger: true, onclick: () => remove(`/api/t/quizzes/${x.id}/delete`, `Delete ${x.title}?`, 'Past results stay.') }]))))))) : null,
      h('div', { class: 't-row t-add' }, h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: 'Upload a .quiz or quiz.json' }), quizFile), quizBtn),
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
            moreMenu(`More for ${x.name}`, `class:${x.id}`, [
              { text: 'Delete', danger: true, onclick: () => remove(`/api/t/rosters/${x.id}/delete`, `Delete ${x.name}?`, 'Past results stay.') }]))))))) : null,
      h('div', { class: 't-row t-add' },
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
  function sebButtons(code, joinUrl) {
    const file = `/api/seb/${encodeURIComponent(code)}.seb`;
    const at = new URL(joinUrl || location.origin); // where students go, not this computer's localhost
    const link = `${at.protocol === 'https:' ? 'sebs' : 'seb'}://${at.host}${file}`;
    const dl = linkBtn('Download .seb', file);
    dl.classList.remove('small');
    dl.setAttribute('download', `${code}.seb`);
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy SEB link' });
    let reset = 0;
    copy.addEventListener('click', async () => {
      if (!(await copyText(link))) { ask.ask({ title: 'Copy this link', value: link, copy: true, ok: 'Done' }); return; }
      copy.textContent = 'Copied';
      clearTimeout(reset);
      reset = setTimeout(() => { copy.textContent = 'Copy SEB link'; }, 2000);
    });
    return [dl, copy];
  }

  // The AI prompt goes on the clipboard, ready to paste into a chatbot. It's fetched ahead of time so
  // the copy happens right in the click. If copying is blocked, it downloads instead. It's long, and some
  // chats cap what you can paste (Copilot), so it also comes as a file to attach, from the button beside it.
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
    const file = h('a', { class: 'btn small t-split-icon', href: url, download: 'BrowserQuiz quiz prompt.txt', 'aria-label': 'Download the AI prompt as a file', title: 'Download as a file' }, icon(ICONS.download, 16));
    return h('span', { class: 't-split' }, btn, file);
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
  async function remove(path, title, text) {
    if (!(await ask.confirm({ title, text, ok: 'Delete', danger: true }))) return;
    try { await post(path); } catch (e) { await ask.notice({ title: "Couldn't delete it", text: e.message }); }
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
    const timeChanges = {}; // roster student id -> 1 | 1.25 | 1.5 | 2: extra time on every timed quiz
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
        const time = h('select', { class: 'input t-time-x', 'aria-label': `Time for ${st.name}` },
          [[1, 'Standard time'], [1.25, '1.25× time'], [1.5, '1.5× time'], [2, '2× time']].map(([v, t]) => h('option', { value: String(v), text: t, selected: Number(st.timeX || 1) === v })));
        time.addEventListener('change', () => { timeChanges[st.id] = Number(time.value); });
        row.append(h('td', { text: st.name }), h('td', { class: 't-actions' }, time, btn));
        return row;
      })))) : null;
    save.addEventListener('click', async () => {
      save.disabled = true;
      msg.textContent = '';
      try {
        if (id) await post(`/api/t/rosters/${encodeURIComponent(id)}/edit`, { name: name.value, add: add.value, remove: [...removing], time: timeChanges });
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
  const gone = (a) => (a.status === 'waiting' || a.status === 'admitted') && a.seenAgo > 15000;
  function statusCell(s) {
    // wrong student IDs typed for this name: a few are typos, many mean someone may be guessing
    const wrong = s.wrongIds ? `${s.wrongIds} wrong ${s.wrongIds === 1 ? 'ID' : 'IDs'}` : '';
    if (!s.attempt) return wrong ? h('td', { class: s.wrongIds >= 5 ? 't-late' : 't-muted', text: `Not joined · ${wrong}` }) : h('td', { class: 't-muted', text: 'Not joined' });
    const a = s.attempt;
    // Waiting for the start: reading the rules, or agreed and in full screen (Ready)
    // their screen stopped checking in (closed the browser, quit Safe Exam Browser): not ready any more
    if (gone(a)) return h('td', { class: 't-late', text: `No signal for ${mmss(a.seenAgo)}` });
    if (a.status === 'waiting') return a.ready ? h('td', { class: 'st-good', text: 'Ready' }) : h('td', { class: 'st-waiting', text: 'Reading the rules' });
    if (a.status === 'admitted') return h('td', { text: 'Starting' });
    // a heartbeat every few seconds; much longer without one and they've lost their connection
    if (a.status === 'active') return a.lastBeatAgo > 15000 ? h('td', { class: 't-late', text: `No signal for ${mmss(a.lastBeatAgo)}` }) : h('td', { text: 'In progress' });
    return h('td', { class: 'st-good', text: 'Submitted' });
  }
  function integrityCell(a) {
    if (!a) return h('td');
    if (a.integrity === 'invalidated') return h('td', { class: 'st-bad', title: LABEL[a.reason] || a.reason, text: 'Invalidated' }); // why: the student's panel
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
    try { p = await api(`/api/t/runs/${runId}/ai-prompt${qs}`); } catch (e) { ask.notice({ title: "Couldn't start grading", text: e.message }); return; }
    if (!p.answers) { ask.notice({ title: 'Nothing to grade' }); return; }
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
  // everything is ticked. Admit everyone asks every time; one student's Admit asks the first time in a run.
  // flagged: [{ name, checks }] students whose sign-in looks off (a new network, a browser another student
  // used): one more item, asked every time, saying why.
  const admitChecked = new Set(); // run ids
  const checkWhy = (c) => (c.type === 'same-browser' ? `Same browser as ${c.detail}` : `New network: ${c.detail}`);
  // reading: how many of them haven't agreed to the rules yet (they start as soon as they do)
  function beforeAdmit(runId, n, name, go, flagged = [], reading = 0) {
    if (name && admitChecked.has(runId) && !flagged.length) { go(); return; }
    const dlg = h('dialog', { class: 't-dialog t-admit', 'aria-labelledby': 't-admit-title' });
    const ok = h('button', { class: 'btn primary', type: 'button', text: name ? `Start ${name}` : `Start ${plural(n, 'student')}`, disabled: true });
    const items = ['Each student is who they signed in as', 'Desks are clear: no phones, notes or other screens'];
    if (flagged.length) items.push(flagged.length === 1 ? `${flagged[0].name} is at the right computer` : `${plural(flagged.length, 'student')} below are at the right computers`);
    const boxes = items.map((text, i) => h('input', { type: 'checkbox', id: `t-admit-${i}` }));
    for (const cb of boxes) cb.addEventListener('change', () => { ok.disabled = !boxes.every((x) => x.checked); });
    ok.addEventListener('click', () => { admitChecked.add(runId); dlg.close(); go(); });
    const x = h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon(ICONS.x, 18));
    // why each flagged sign-in needs a look, under its item
    const why = flagged.length ? h('ul', { class: 't-admit-why', id: 't-admit-why' }, flagged.map((f) => h('li', {},
      flagged.length > 1 ? h('b', { text: `${f.name}: ` }) : null, f.checks.map(checkWhy).join('; ')))) : null;
    if (why) boxes[boxes.length - 1].setAttribute('aria-describedby', 't-admit-why');
    dlg.append(
      h('header', { class: 't-dialog-head' }, h('h2', { id: 't-admit-title', text: 'Before you start' }), x),
      h('div', { class: 't-admit-list' }, items.map((text, i) => h('label', { class: 't-check', for: `t-admit-${i}` }, boxes[i], h('span', { text }))), why,
        reading ? h('p', { class: 't-admit-note', text: `${plural(reading, 'student')} still reading the rules ${reading === 1 ? 'starts' : 'start'} as soon as ${reading === 1 ? 'they agree' : 'they agree'}.` }) : null),
      h('footer', { class: 't-dialog-foot' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), ok));
    dlg.addEventListener('close', () => dlg.remove());
    root.append(dlg);
    dlg.showModal();
    boxes[0].focus();
  }

  // The join code filling the screen, for a projector: where to go and the code. Esc or a click closes it.
  function projector(joinCode, quizTitle, joinUrl) {
    // http addresses show without the http:// (an IP and port); https ones show their name
    const where = joinUrl ? joinUrl.replace(/^https?:\/\//, '') : "this computer's network address";
    const dlg = h('dialog', { class: 't-projector', 'aria-label': `Join code ${joinCode}` },
      h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon(ICONS.x, 22)),
      h('p', { class: 't-proj-title', text: quizTitle }),
      h('p', { class: 't-proj-url', text: `Join at ${where}` }),
      h('p', { class: 't-proj-code', text: joinCode }));
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.classList.contains('t-proj-code')) dlg.close(); });
    const onFs = () => { if (!document.fullscreenElement && dlg.open) dlg.close(); }; // Esc out of fullscreen closes it too
    dlg.addEventListener('close', () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      dlg.remove();
    });
    root.append(dlg);
    dlg.showModal();
    if (dlg.requestFullscreen) dlg.requestFullscreen().then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
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
  // "Chrome on macOS", from the browser's long description (which hovering shows).
  function browserName(ua) {
    const app = /SEB\//.test(ua) ? 'Safe Exam Browser' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${app} on ${os}` : app;
  }
  // Strikes, and how long they were away in all after a dot (ticking, in red, while they're away now)
  function strikesCell(a) {
    if (!a) return h('td', { class: 'num', 'data-label': 'Strikes' });
    const away = a.awayMs ? h('span', Object.assign({ class: a.awayNow ? 'st-bad' : 't-muted', text: (a.awayNow ? 'away ' : '') + mmss(a.awayMs) }, a.awayNow ? ticks('away', -a.awayMs) : {})) : null;
    return h('td', { class: 'num' + (!a.strikes && !away ? ' t-zero' : ''), 'data-label': 'Strikes', title: a.awayMs ? `Away ${mmss(a.awayMs)} in all` : null },
      String(a.strikes), away ? [h('span', { class: 't-muted', text: ' · ' }), away] : null);
  }
  // The bar: answered out of all, colored by what they're doing (green working, blue reading, gray idle,
  // plain on directions), which hovering (and a screen reader) says in words.
  function progressCell(a) {
    if (!a || a.status === 'waiting') return h('td', { class: 'num', 'data-label': 'Progress' });
    const pct = a.total ? Math.round((a.answered / a.total) * 100) : 0;
    // on a part's directions (a part starting, or opened again): no color, it's neither working nor idle
    const dirs = a.status === 'active' && a.on === 'directions';
    const act = a.status === 'active' && !dirs ? a.activity : null;
    const at = a.on === 'review' ? 'the review' : a.on ? `question ${a.on}` : null;
    const on = dirs ? 'reading directions' : !act || !at ? null
      : act === 'working' ? (a.on === 'review' ? 'checking their work' : `working on ${at}`)
      : act === 'idle' ? `idle on ${at}`
      : a.on === 'review' ? 'checking their work' : `reading ${at}`;
    // Timed parts: a segment per part, as long as its questions; the parts before theirs gray, theirs in the
    // color of what they're doing, the ones after it empty.
    const tp = a.parts && a.parts.sizes.length > 1 ? a.parts : null;
    const where = tp && tp.on ? `part ${tp.on} of ${tp.sizes.length}` + (on ? `, ${on}` : '') : on;
    const bar = tp
      ? h('span', { class: 't-prog t-prog-parts', 'aria-hidden': 'true' }, tp.sizes.map((size, k) => {
        const state = !tp.on || k + 1 < tp.on ? 'done' : k + 1 === tp.on ? (act ? 'is-' + act : 'now') : 'next';
        return h('span', { class: 't-seg ' + state, style: `flex:${size}` }, h('span', { style: `width:${size ? Math.round((tp.answered[k] / size) * 100) : 0}%` }));
      }))
      : h('span', { class: 't-prog' + (act ? ' is-' + act : ''), 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` }));
    return h('td', { class: 'num t-progress', 'data-label': 'Progress', title: where ? where[0].toUpperCase() + where.slice(1) : null },
      bar,
      // as wide as the widest count, so the bars line up down the column (9/14 under 10/14)
      h('span', { class: 't-prog-n', style: `min-width:${2 * String(a.total).length + 1}ch`, text: `${a.answered}/${a.total}` }),
      where ? h('span', { class: 'sr-only', text: `, ${where}` }) : null);
  }
  // Less-used actions behind a ⋯ button: a row's, a quiz's, the live quiz's. items: { text, onclick, danger }
  // or an element (a link, say), or a function that gives them, asked each time it opens. The live table
  // doesn't redraw while one is open (menuOpen), so it stays put; onClose catches it up.
  let menuOpen = false;
  // opts.text: a button with that text and a chevron (the account menu) instead of ⋯.
  function moreMenu(label, key, items, onClose, opts) {
    const named = opts && opts.text;
    const btn = named
      ? h('button', { class: 'btn small t-menu-btn t-menu-named', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, 'data-key': key }, h('span', { class: 't-menu-name', text: opts.text }), icon(ICONS.chevron, 16))
      : h('button', { class: 'btn small t-menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: 'More', 'data-key': key }, icon(ICONS.dots, 18));
    if (!named) btn.firstChild.setAttribute('fill', 'currentColor');
    const menu = h('div', { class: 't-menu', popover: 'manual', role: 'menu', 'aria-label': label });
    const fill = (list) => menu.replaceChildren(...list.filter(Boolean).map((it) => {
      if (it.nodeType) {
        it.classList.remove('btn', 'small', 'primary');
        it.classList.add('t-menu-item');
        it.removeAttribute('style');
        it.setAttribute('role', 'menuitem');
        if (!it.dataset.inMenu) { it.dataset.inMenu = '1'; it.addEventListener('click', () => close(false)); }
        return it;
      }
      return h('button', { class: 't-menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', text: it.text, onclick: () => { close(true); it.onclick(); } });
    }));
    if (typeof items !== 'function') fill(items);
    const entries = () => [...menu.querySelectorAll('[role=menuitem]:not([hidden])')];
    const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(false); };
    // under the button, right edges lined up; above it if there's no room below. It follows the button
    // when the page scrolls, and closes once the button is out of sight.
    function place() {
      const r = btn.getBoundingClientRect();
      if (!btn.isConnected || r.bottom < 0 || r.top > innerHeight) { close(false); return; }
      // Big screens zoom the page (teacher.css), and zoom scales top and left too: measure by how much.
      menu.style.top = menu.style.left = '100px';
      const m = menu.getBoundingClientRect();
      const k = m.left / 100 || 1;
      const top = r.bottom + 4 + m.height > innerHeight - 8 ? r.top - 4 - m.height : r.bottom + 4;
      menu.style.top = `${Math.max(8, top) / k}px`;
      menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8)) / k}px`;
    }
    const away = (e) => { if (!(e.target instanceof Node) || !menu.contains(e.target)) place(); }; // resize's target is the window
    let isOpen = false;
    function close(focusBack) {
      if (!isOpen) return;
      isOpen = false;
      if (menu.matches(':popover-open')) menu.hidePopover();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      if (focusBack) btn.focus({ preventScroll: true });
      menuOpen = false;
      if (onClose) onClose();
    }
    function open() {
      if (typeof items === 'function') fill(items());
      if (!entries().length) return;
      menu.showPopover();
      isOpen = true;
      menuOpen = true;
      btn.setAttribute('aria-expanded', 'true');
      place();
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('scroll', away, true);
      window.addEventListener('resize', away);
      entries()[0].focus();
    }
    btn.addEventListener('click', () => (isOpen ? close(true) : open()));
    menu.addEventListener('keydown', (e) => {
      const all = entries();
      const i = all.indexOf(document.activeElement);
      const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (go !== undefined) { e.preventDefault(); all[(go + all.length) % all.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    return [btn, menu];
  }

  function watchLink(id, name) {
    const w = h('a', { class: 'btn small', href: `/teacher/watch.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Watch', 'aria-label': `Watch ${name}`, 'data-key': `${id}:watch` });
    w.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none';
    return w;
  }

  async function showRun(runId) {
    setHash('#run/' + encodeURIComponent(runId));
    menuOpen = false; // a menu left open on the page before went with it
    ++navSeq;
    selected = null;
    // The join code: click it to show it big, for a projector
    const code = h('button', { class: 't-joincode', type: 'button', title: 'Show it big' });
    code.addEventListener('click', () => projector(code.textContent, title.textContent, lastRun && lastRun.joinUrl));
    const title = h('h1');
    const meta = h('p', { class: 't-muted' });
    const tbody = h('tbody');
    const detail = h('div');
    const toggle = h('button', { class: 'btn', type: 'button' });
    const lockBtn = h('button', { class: 'btn', type: 'button' });
    const howTo = h('p', { class: 't-muted t-small' });
    // A stuck student can only leave Safe Exam Browser with this; it's also what locks an iPad.
    const quitPw = h('p', { class: 't-small', hidden: true });
    let sebParts = null; // Download .seb and Copy SEB link, made once the run says it has a file
    const failedBox = h('div');
    let lastDetail = '';
    let lastRun = null; // the run as of the last refresh (for Corrections)
    let waitingIds = [];
    let waitingFlagged = []; // waiting students whose sign-in needs a look (beforeAdmit)
    let waitingReading = 0; // and how many of them haven't agreed to the rules yet
    let begun = false; // anyone started yet (rows get their own Start only after)
    // only the students waiting when the checklist opens: anyone who joins while it's up waits for the next round
    const admitAll = h('button', { class: 'btn primary', type: 'button', text: 'Start quiz', onclick: () => {
      const ids = waitingIds.slice();
      beforeAdmit(runId, ids.length, null, async () => {
        await act(`/api/t/runs/${runId}/admit-all`, { ids });
        // the button goes away once nobody's waiting: keep keyboard focus in the table, not lost on the page
        const lost = !document.activeElement || document.activeElement === document.body || document.activeElement === admitAll;
        const first = tbody.querySelector('.t-rowhead .t-link');
        if (admitAll.hidden && lost && first) first.focus({ preventScroll: true });
      }, waitingFlagged.slice(), waitingReading);
    } });
    // AI grading: everything waiting for the teacher in this run, sent to Claude (server: aigrade.js).
    const aiBtn = h('button', { class: 'btn', type: 'button', hidden: true });
    const aiMsg = h('p', { class: 't-small t-muted', role: 'status', hidden: true });
    let aiWaiting = 0;
    const aiDone = (text) => { if (text) { aiMsg.hidden = false; aiMsg.className = 't-small t-muted'; aiMsg.textContent = text; } lastDetail = ''; refresh(); };
    aiBtn.addEventListener('click', () => aiDialog(runId, null, aiDone));
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
      return refresh();
    }
    function alertBox(msg) { detail.prepend(h('p', { class: 't-error', text: msg })); }
    // How much more time (for one student, or everyone still working): 5 minutes unless they say otherwise.
    async function askMinutes(title) {
      const v = await ask.ask({ title, label: 'Minutes', value: '5', ok: 'Add time' });
      if (v == null) return null;
      const mins = Math.round(Number(v));
      if (mins >= 1 && mins <= 120) return mins;
      await ask.notice({ title: 'Add 1 to 120 minutes' });
      return null;
    }
    // Ends one student's quiz: their answers are turned in and they see "Your teacher ended your quiz".
    async function unInvalidate(id, name) {
      if (await ask.confirm({ title: `Un-invalidate ${name}?`, ok: 'Un-invalidate' })) act(`/api/t/attempts/${id}/restore`);
    }
    async function invalidate(id, name) {
      const note = await ask.ask({ title: `Invalidate ${name}?`, label: 'Reason (optional)', ok: 'Invalidate', danger: true });
      if (note !== null) act(`/api/t/attempts/${id}/invalidate`, { note });
    }
    // A message to one student: it pops up on their screen at their next heartbeat.
    async function messageStudent(id, name) {
      const text = await ask.ask({ title: `Message ${name}`, label: 'Message', ok: 'Send' });
      if (text == null || !text.trim()) return;
      act(`/api/t/attempts/${id}/message`, { text });
    }
    async function resetAttempt(id, name, before) {
      if (!(await ask.confirm({ title: `Reset ${name}?`, text: 'Their answers are deleted. Crashed computer? Use Let back in instead.', ok: 'Reset', danger: true }))) return;
      if (before) before();
      act(`/api/t/attempts/${id}/reset`);
    }
    async function endQuiz(id, name) {
      if (!(await ask.confirm({ title: `End ${name}'s quiz?`, text: "Their answers are turned in and they can't continue.", ok: 'End quiz', danger: true }))) return;
      lastDetail = '';
      act(`/api/t/attempts/${id}/end`);
    }

    async function refresh() {
      let data;
      try { data = await api(`/api/t/runs/${runId}/live`); } catch (e) { return; }
      const run = data.run;
      lastRun = run;
      notice(data.students);
      // on the row: Message students while it's open; Corrections once an exam is closed (just once)
      corrBtn.hidden = run.practice || !!run.corrections || run.status === 'open';
      msgBtn.hidden = run.status !== 'open';
      code.textContent = run.code;
      document.title = `${run.code} · ${run.title} – BrowserQuiz`;
      const count = (f) => data.students.filter((x) => x.attempt && f(x.attempt)).length;
      const said = [[count((a) => a.status === 'waiting' && a.ready && !gone(a)), 'ready'], [count((a) => a.status === 'waiting' && !a.ready && !gone(a)), 'reading the rules'], [count((a) => a.status === 'admitted' && !gone(a)), 'starting'], [count(gone), 'no signal'], [count((a) => a.status === 'active'), 'working'],
        [count((a) => a.status === 'submitted'), 'turned in'], [count((a) => a.integrity === 'invalidated'), 'invalidated']]
        .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ') || 'Nobody has joined yet';
      if (summary.textContent !== said) summary.textContent = said;
      waitingIds = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting').map((x) => x.attempt.id);
      waitingFlagged = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting' && x.attempt.checks).map((x) => ({ name: x.name, checks: x.attempt.checks }));
      waitingReading = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting' && !x.attempt.ready).length;
      admitAll.hidden = !waitingIds.length;
      // before anyone's started it starts the quiz; after, it starts the students who came late, and each
      // late student's row has its own Start
      begun = count((a) => a.status === 'admitted' || a.status === 'active' || a.status === 'submitted') > 0;
      admitAll.textContent = begun ? 'Start everyone waiting' : 'Start quiz';
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
      // This run's place in the Open tab.
      if (openRuns && (run.status === 'open') !== openRuns.some((r) => r.id === runId)) {
        api('/api/t/overview').then((o) => {
          noteRuns(o.runs);
          const nav = root.querySelector('.t-side');
          const cur = openRuns.some((r) => r.id === runId);
          if (nav && root.contains(tbody)) nav.replaceWith(shell(cur ? 'open' : tab === 'results' ? 'results' : 'give').querySelector('.t-side'));
        }).catch(() => {});
      }
      title.textContent = run.title;
      code.setAttribute('aria-label', `Join code ${run.code}. Show it big`);
      meta.textContent = run.corrections
        // each student has their own questions and no clock, so just what it is and what it's worth
        ? `Corrections, ${run.status === 'open' ? 'open' : 'closed'}. Fixed answers earn back ${Math.round(run.corrections.earnBack * 100)}%.`
        : `${plural(run.questions, 'question')}${run.timedParts ? ` in ${run.timedParts} parts` : ''}${run.timeLimitMin ? `, ${plural(run.timeLimitMin, 'minute')}` : ''}. ${run.status === 'open' ? 'Open' : 'Closed'}${run.practice ? ', practice' : ''}${run.ipLock ? ', only your network' : ''}${run.seb ? ', Safe Exam Browser only' : ''}.`;
      // where students go: on localhost, this computer's network address (server: joinOrigin)
      const joinAt = run.joinUrl || "this computer's network address, not localhost";
      howTo.textContent = run.sebFile ? `Join at ${joinAt}, which opens Safe Exam Browser` : `Join at ${joinAt}`;
      quitPw.hidden = !run.sebQuit || run.status !== 'open';
      if (run.sebQuit && !quitPw.childNodes.length) quitPw.append('SEB quit password: ', h('code', { class: 't-temp', text: run.sebQuit }));
      if (run.sebFile && !sebParts) sebParts = sebButtons(run.code, run.joinUrl);
      toggle.textContent = run.status === 'open' ? 'Close quiz' : 'Reopen quiz';
      toggle.onclick = async () => {
        if (run.status === 'open' && !(await ask.confirm({ title: 'Close the quiz?', text: 'Anyone still working gets turned in.', ok: 'Close quiz', danger: true }))) return;
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
      if (!menuOpen) tbody.replaceChildren(...rows.map((s) => {
        const a = s.attempt;
        const actions = h('td', { class: 't-actions' });
        const btn = (text, key, onclick, extra) => h('button', Object.assign({ class: 'btn small', type: 'button', text, onclick, 'data-key': `${a.id}:${key}`, 'aria-label': `${text} ${s.name}` }, extra || {}));
        // In the row: what needs deciding now. The rest is under ⋯.
        const more = [];
        const bad = a && a.integrity === 'invalidated';
        if (a && a.status === 'waiting' && begun) actions.append(btn('Start', 'admit', () => beforeAdmit(runId, 1, s.name, () => act(`/api/t/attempts/${a.id}/admit`), a.checks ? [{ name: s.name, checks: a.checks }] : [], a.ready ? 0 : 1), { class: 'btn small primary' }));
        if (bad) actions.append(btn('Un-invalidate', 'restore', () => unInvalidate(a.id, s.name)));
        // Flagged and still working: ending their quiz is one click away (never automatic, so a stray
        // popup doesn't end anyone's quiz without the teacher looking).
        if (bad && a.status === 'active') actions.append(btn('End quiz', 'end', () => endQuiz(a.id, s.name)));
        // Practice and corrections aren't monitored: no watching, network pins or invalidating there.
        const sec = !(lastRun && lastRun.practice);
        // Their screen, live, in a new tab (watch.html).
        if (sec && a && a.status === 'active') (bad ? more.push(watchLink(a.id, s.name)) : actions.append(watchLink(a.id, s.name)));
        if (a && a.status === 'active' && a.deadline) more.push({ text: 'Add time', onclick: async () => { const mins = await askMinutes(`Add time for ${s.name}`); if (mins) act(`/api/t/attempts/${a.id}/extend`, { minutes: mins }); } });
        if (a && a.status !== 'submitted') more.push({ text: 'Message', onclick: () => messageStudent(a.id, s.name) });
        if (sec && a && (a.status === 'active' || a.status === 'admitted') && !a.letIn) more.push({ text: 'Let back in', onclick: () => act(`/api/t/attempts/${a.id}/let-in`) });
        if (a && (a.status === 'active' || a.status === 'admitted') && a.letIn) actions.append(h('span', { class: 't-muted t-small', text: 'Can sign in again' }));
        if (a) more.push({ text: 'Reset', danger: true, onclick: () => resetAttempt(a.id, s.name) });
        if (more.length) actions.append(...moreMenu(`More for ${s.name}`, `${a.id}:more`, more, () => refresh()));
        // On a phone a row shows only what needs doing now (Admit, End quiz); the rest is one tap away, on the student.
        for (const b of actions.children) if (!/:(admit|end)$/.test(b.dataset.key || '')) b.classList.add('t-row-extra');
        if (![...actions.children].some((b) => !b.classList.contains('t-row-extra'))) actions.classList.add('t-only-extra');
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
          h('td', { role: 'rowheader', class: 't-rowhead t-name' }, a ? h('button', { class: 't-link', type: 'button', text: s.name, title: s.name, 'data-key': `${a.id}:name`, 'aria-expanded': String(selected === a.id), onclick: open }) : h('span', { title: s.name, text: s.name })),
          statusCell(s), integrityCell(a),
          strikesCell(a),
          progressCell(a),
          // extra time (the class's settings) shows next to the clock, and on it in words for screen readers
          h('td', { class: 'num', 'data-label': 'Time left', title: s.timeX && !(a && a.status === 'submitted') ? `${s.timeX}× time` : null },
            h('span', Object.assign({ text: a && a.timeLeft != null ? mmss(a.timeLeft) : '' }, a && a.timeLeft != null && a.status === 'active' ? ticks('left', a.timeLeft) : {})),
            s.timeX && !(a && a.status === 'submitted') ? h('span', { class: 't-muted t-xtime', text: ` ${s.timeX}×`, 'aria-label': `, ${s.timeX} times the time` }) : null),
          h('td', { class: 'num' + (a && (a.failed || a.review) ? ' st-waiting' : ''), 'data-label': 'Score', text: score }),
          actions);
      }));
      // Keep keyboard focus on the same button after the redraw, without scrolling the page back to it. If
      // that button is gone (say, Admit after admitting), go to the next Admit, or to the student's name.
      if (focusKey && !menuOpen) {
        const [fid, what] = focusKey.split(':');
        const again = tbody.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)
          || (what === 'admit' && (tbody.querySelector('[data-key$=":admit"]') || (admitAll.isConnected && admitAll)))
          || tbody.querySelector(`[data-key="${CSS.escape(fid)}:name"]`);
        if (again) again.focus({ preventScroll: true });
      }
      if (selected && !menuOpen) showDetail(selected, true);
    }

    async function showDetail(id, quiet) {
      let d;
      try { d = await api(`/api/t/attempts/${id}`); } catch (e) { return; }
      if (selected !== id) return;
      // The poll re-renders every 2s: don't wipe what the teacher is typing, selecting, reading or has open.
      const snapshot = JSON.stringify(Object.assign({}, d, { timeLeft: null, awayMs: null, awayMax: null })); // clocks that tick: not a reason to redraw
      const typing = detail.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
      if (quiet && (snapshot === lastDetail || typing || menuOpen || String(window.getSelection() || '') !== '')) return;
      lastDetail = snapshot;
      const keep = detail.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.key : null;
      const dk = (key) => ({ 'data-key': `detail:${key}` });
      const canvas = h('canvas', { class: 't-trail', width: 640, height: 360, 'aria-label': 'Mouse trail' });
      // Each question as it looked in the quiz, with this student's answer and the correct one,
      // plus what only the teacher sees: grading state, hidden test results, and the grading controls.
      const sharedSeen = new Set();
      // an exam still open: proctoring only, the answers come with the results
      const answers = d.sealed ? h('p', { class: 't-muted', text: 'Answers show once the quiz is closed.' }) : h('div', { class: 't-answers r-view' }, d.report.questions.map((rq, i) => {
        const x = d.answers[i];
        const sec = window.BQReport.question(d.quiz, rq, i, { teacher: true, sharedSeen, attemptId: id });
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
        // what's for now in the row; the rest under ⋯
        h('div', { class: 't-row t-detail-acts' },
          d.status === 'active' && !(lastRun && lastRun.practice) ? watchLink(id, d.name) : null,
          d.integrity === 'invalidated' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Un-invalidate', onclick: () => unInvalidate(id, d.name) }, dk('restore'))) : null,
          d.status === 'active' ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'End quiz', onclick: () => endQuiz(id, d.name) }, dk('end'))) : null,
          d.status === 'active' && d.deadline ? h('span', Object.assign({ class: 't-muted t-small', text: `${mmss(d.timeLeft || 0)} left` }, ticks('left-label', d.timeLeft || 0))) : null,
          d.timeX ? h('span', { class: 't-muted t-small', text: `${d.timeX}× time` }) : null,
          d.status === 'submitted' && !d.sealed ? h('a', { class: 'btn small', href: `/teacher/report.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Report', style: 'display:inline-flex;align-items:center;text-decoration:none' }) : null,
          d.status === 'submitted' && d.totals && d.totals.review ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Grade with AI', title: 'Send the answers waiting for you to Claude. Names and IDs stay here.',
            onclick: () => aiDialog(runId, id, aiDone) }, dk('ai'))) : null,
          moreMenu(`More for ${d.name}`, 'detail:more', [
            d.status === 'active' && d.deadline ? { text: 'Add time', onclick: async () => { const mins = await askMinutes(`Add time for ${d.name}`); if (mins) { lastDetail = ''; act(`/api/t/attempts/${id}/extend`, { minutes: mins }); } } } : null,
            d.status !== 'submitted' ? { text: 'Message', onclick: () => messageStudent(id, d.name) } : null,
            d.integrity !== 'invalidated' && !(lastRun && lastRun.practice) ? { text: 'Invalidate', onclick: () => invalidate(id, d.name) } : null,
            d.status === 'submitted' && !d.sealed ? { text: 'Regrade', onclick: () => act(`/api/t/attempts/${id}/regrade`) } : null,
            (d.status === 'active' || d.status === 'admitted') && !(lastRun && lastRun.practice) ? { text: 'Let back in', onclick: () => act(`/api/t/attempts/${id}/let-in`) } : null,
            { text: 'Reset', danger: true, onclick: () => resetAttempt(id, d.name, closeDetail) },
          ], () => refresh())),
        d.integrity === 'invalidated' ? h('p', { class: 'st-bad', text: `Invalidated at ${clock(d.invalidatedAt)}: ${(LABEL[d.reason] || d.reason || '').toLowerCase()}` }) : null,
        d.strikes ? h('p', { class: 't-small t-away', text: `Left ${d.strikes === 1 ? 'once' : d.strikes + ' times'}. Away ${mmss(d.awayMs)} in all${d.strikes > 1 ? `, ${mmss(d.awayMax)} at the longest` : ''}.` }) : null,
        h('div', { class: 't-detail-grid' },
          h('div', { class: 't-section' }, h('h3', { text: 'Activity' }),
            h('ul', { class: 't-events' }, d.events.map((e) => h('li', { class: e.severity }, h('time', { text: clock(e.t) }), h('span', {}, h('b', { text: LABEL[e.type] || e.type }), e.detail ? h('span', { class: 't-muted', text: ` ${e.detail}` }) : null))))),
          h('div', { class: 't-section' }, h('h3', { text: 'Mouse trail' }), canvas,
            d.userAgent ? h('p', { class: 't-muted t-small', title: d.userAgent, text: browserName(d.userAgent) }) : null)),
        h('div', { class: 't-section' }, h('h3', { text: d.sealed ? 'Answers' : d.totals ? `Answers (${d.totals.score} / ${d.totals.max}${d.totals.pending ? ', code still grading' : d.totals.failed ? ', grading failed' : d.totals.review ? ', needs review' : ''})` : 'Answers so far' }), answers)));
      drawTrail(canvas, d.mouse);
      if (!d.sealed) window.BQReport.highlight(answers);
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

    // Notifications: a strike, an invalidation, or a sign-in to look at, as it happens. On this page always
    // (a toast; clicking it opens the student). As the computer's own notification too, and a buzz on a
    // phone, once the teacher turns them on (⋯ menu), for when this tab isn't in front.
    const toasts = h('div', { class: 't-toasts', 'aria-live': 'polite' });
    const openStudent = (id) => { selected = id; lastDetail = ''; showDetail(id); refresh(); };
    const notifyKey = 'bq-notify';
    // On unless the teacher turned them off. The browser asks first, and only after a click on the page.
    const notifyWanted = () => { try { return localStorage.getItem(notifyKey) !== '0'; } catch (e) { return true; } };
    const notifyOn = () => notifyWanted() && 'Notification' in window && Notification.permission === 'granted';
    if (notifyWanted() && 'Notification' in window && Notification.permission === 'default') {
      const askOnce = () => {
        if (!toasts.isConnected) { document.removeEventListener('pointerdown', askOnce, true); return; } // left the quiz's page
        if (!lastRun || lastRun.status !== 'open') return; // an open quiz is when they matter
        document.removeEventListener('pointerdown', askOnce, true);
        Notification.requestPermission().then(paintNotify, () => {});
      };
      document.addEventListener('pointerdown', askOnce, true);
    }
    const notifyBtn = h('button', { class: 'btn', type: 'button' });
    const paintNotify = () => { notifyBtn.textContent = notifyOn() ? 'Notifications: on' : 'Notifications: off'; };
    notifyBtn.addEventListener('click', async () => {
      if (notifyOn()) { try { localStorage.setItem(notifyKey, '0'); } catch (e) { /* off for this page */ } paintNotify(); return; }
      if (!('Notification' in window)) { ask.notice({ title: "This browser can't show notifications" }); return; }
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
        ask.notice({ title: 'Notifications are blocked', text: "Allow them for this site in the browser's settings, then turn them on here." });
        return;
      }
      try { localStorage.setItem(notifyKey, '1'); } catch (e) { /* not remembered */ }
      paintNotify();
    });
    paintNotify();
    function toast(id, kind, title, text) {
      const card = h('div', { class: `t-toast ${kind}` });
      const go = h('button', { class: 't-toast-main', type: 'button', onclick: () => { card.remove(); openStudent(id); } }, h('b', { text: title }), h('span', { text }));
      const x = h('button', { class: 'btn small ghost t-toast-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => card.remove() }, icon(ICONS.x, 16));
      card.append(go, x);
      toasts.append(card);
      while (toasts.childElementCount > 4) toasts.firstChild.remove();
      setTimeout(() => card.remove(), 12000);
      if (!notifyOn()) return;
      if (navigator.vibrate) navigator.vibrate(200);
      if (!document.hidden && document.hasFocus()) return; // in front: the toast is enough
      try {
        const n = new Notification(title, { body: text, tag: `${id}:${kind}`, icon: '/icon-180.png' });
        n.onclick = () => { window.focus(); n.close(); openStudent(id); };
      } catch (e) { /* phones want a service worker for these: the buzz and the toast still came */ }
    }
    const seen = new Map(); // attempt id -> { strikes, bad, checks }, as of the last poll
    let firstLook = true;
    function notice(students) {
      for (const s of students) {
        const a = s.attempt;
        if (!a) continue;
        const was = seen.get(a.id);
        const now = { strikes: a.strikes || 0, bad: a.integrity === 'invalidated', checks: (a.checks || []).length };
        seen.set(a.id, now);
        if (firstLook) continue; // what was already there when the page opened isn't news
        if (now.bad && !(was && was.bad)) toast(a.id, 'bad', `${s.name} was invalidated`, LABEL[a.reason] || a.reason || '');
        else if (was && now.strikes > was.strikes) toast(a.id, 'bad', `${s.name}: ${LABEL[a.lastStrike] || 'Left the quiz'}`, `Strike ${now.strikes}`);
        if (now.checks > (was ? was.checks : 0)) {
          const c = a.checks[a.checks.length - 1];
          toast(a.id, 'check', `${s.name}: check their computer`, checkWhy(c));
        }
      }
      firstLook = false;
    }
    // Start, Message students, Corrections and Close quiz stay out; the rest is under ⋯.
    // A message to everyone taking the quiz: it pops up on their screens at the next heartbeat.
    const msgBtn = h('button', { class: 'btn', type: 'button', text: 'Message students' });
    msgBtn.addEventListener('click', async () => {
      const text = await ask.ask({ title: 'Message students', label: 'Message', ok: 'Send' });
      if (text == null || !text.trim()) return;
      try { await post(`/api/t/runs/${runId}/message`, { text }); } catch (e) { alertBox(e.message); }
    });
    const runMenu = moreMenu('More for this quiz', 'run:more', () => [
      // a fire drill, the wifi down, a late start: everyone still working gets the same
      lastRun && lastRun.status === 'open' && lastRun.timeLimitMin ? { text: 'Add time for everyone', onclick: async () => {
        const mins = await askMinutes('Add time for everyone');
        if (mins) act(`/api/t/runs/${lastRun.id}/extend`, { minutes: mins });
      } } : null,
      lockBtn, notifyBtn,
      ...(lastRun && lastRun.sebFile && lastRun.status === 'open' && sebParts ? sebParts : []),
      // results (export, class report) once an exam is closed: while it's open it's proctoring only
      ...(lastRun && !lastRun.practice && lastRun.status === 'open' ? [] : [exportLink, classReport])], () => refresh());
    detail.className = 't-detail-host';
    detail.setAttribute('aria-labelledby', 't-detail-name');
    if (openRuns === null) { try { noteRuns((await api('/api/t/overview')).runs); } catch (e) { /* the tab can wait */ } }
    const isOpen = openRuns && openRuns.some((r) => r.id === runId);
    mount(shell(isOpen ? 'open' : tab === 'results' ? 'results' : 'give',
        h('section', { class: 't-section' },
          h('div', { class: 't-code' }, code, h('div', {}, title, meta)),
          howTo, quitPw,
          h('div', { class: 't-row t-run-acts' }, admitAll, aiBtn, msgBtn, corrBtn, toggle, runMenu), aiMsg,
          failedBox, summary, toasts),
        h('div', { class: 't-livegrid' }, h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-run' },
          h('thead', {}, h('tr', {}, heads(['Student', 'Status', 'Integrity', 'Strikes', 'Progress', 'Time left', 'Score'], ['Strikes', 'Progress', 'Time left', 'Score']), actionsHead())),
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
      else if (el.dataset.tick === 'away') el.textContent = 'away ' + mmss(now - at);
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

  window.BQT = { h, api, post, mount, bar, showHome, plural, date, setHash, icon, ICONS, moreMenu, guard: (fn) => { leaveGuard = fn; } };
  route();
})();
