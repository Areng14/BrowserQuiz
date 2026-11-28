// Signing in: passwords, passkeys, and teacher accounts (the admin's).

import { dash } from './state.js';
import { ICONS, PASSKEYS, actionsHead, api, ask, date, day, forgetCode, ghLink, h, heads, icon, iconButton, keepCode, mount, post, sortableTable, tip } from './core.js';
import { copyText, route, showHome } from './home.js';
import { moreMenu } from './cells.js';

// ---------- sign in ----------
function showLogin() {
  if (dash.parked && dash.parked.login.isConnected) return; // already asking
  dash.parked = null;
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
    btn, pk ? tip(h('div', { class: 't-tip-grid' }, pk), pk, "Sign in with your fingerprint, face or phone instead of a password. Add a passkey first, in Settings.") : null, msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; msg.textContent = '';
    try { const r = await post('/api/t/login', { username: user.value.trim(), password: pw.value }); dash.justTyped = { pw: pw.value, at: Date.now() }; if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else signedIn(); } catch (ex) { msg.textContent = ex.message === 'bad_password' ? 'Wrong password.' : ex.message === 'too_many' ? 'Too many tries. Wait a minute.' : ex.message; btn.disabled = false; pw.select(); }
  });
  const page = h('main', { class: 't-login-page' }, form, h('p', { class: 't-login-foot' }, ghLink()));
  // Unsaved work on screen (a quiz being written, a class being edited) when the session ends: a restart,
  // the 12 hours, signing out in another tab. It stays, hidden, under the sign-in and comes back after it.
  const root = document.getElementById('t-app');
  if (dash.leaveGuard && dash.who) {
    dash.parked = { nodes: [...root.children], guard: dash.leaveGuard, title: document.title, at: location.hash, who: dash.who.username, login: page };
    for (const n of dash.parked.nodes) n.hidden = true;
    root.append(page);
    document.title = 'Teacher sign in - BrowserQuiz';
  } else mount(page);
  user.focus();
}
// After signing in (password or passkey): the work set aside above comes back if it's the same teacher;
// otherwise it's their dashboard, as it was.
async function signedIn() {
  const work = dash.parked;
  dash.parked = null;
  dash.who = null;
  if (work) {
    try { dash.who = (await api('/api/t/me')).teacher; } catch (e) { return; }
    if (dash.who.username === work.who && !dash.who.mustChange && location.hash === work.at) {
      work.login.remove();
      for (const n of work.nodes) n.hidden = false;
      dash.leaveGuard = work.guard;
      document.title = work.title;
      return;
    }
    dash.leaveGuard = null; // someone else's: not theirs to keep
  }
  route();
}

// A teacher on a temporary password picks their own before anything else (first). Later, it's changed in
// Settings (settings.js).
async function showSetPassword(first) {
  // After an admin reset, with the quiz key not in memory: the recovery code keeps their quizzes.
  let recover = false;
  let fromEnv = false; // admin's first sign-in, with ADMIN_PASSWORD: it isn't a temporary one
  let uname = dash.who ? dash.who.username : '';
  let role = dash.who ? dash.who.role : '';
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
  const known = first && dash.justTyped && Date.now() - dash.justTyped.at < 10 * 60000;
  if (known) cur.value = dash.justTyped.pw;
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
      dash.justTyped = null;
      if (r && r.recoveryCode) showRecoveryCode(r.recoveryCode); else showHome();
    } catch (ex) {
      // the same words as the field: it's the temporary password on a first sign-in
      msg.textContent = ex.code === 'bad_password' && first && !fromEnv ? 'The temporary password is wrong. Use the one your admin gave you.' : ex.message;
      btn.disabled = false;
      if (ex.code === 'bad_password' && curField.hidden) { curField.hidden = false; cur.value = ''; cur.focus(); }
    }
  });
  mount(h('main', { class: 't-login-page' }, form));
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
    signedIn();
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
// card: a section of Settings.
function passkeysSection(card) {
  const list = h('ul', { class: 't-pk-list' });
  list.hidden = true;
  const msg = h('p', { class: 't-error', role: 'alert' });
  const add = h('button', { class: 'btn t-ib', type: 'button' }, icon(ICONS.plus, 16), 'Add a passkey');
  const paint = (keys) => {
    list.hidden = !keys.length;
    list.replaceChildren(...keys.map((k) => h('li', {},
      h('span', { class: 't-pk-what' }, h('span', { class: 't-pk-name', text: k.name }),
        h('span', { class: 't-small t-muted t-pk-meta' },
          h('span', { text: `Added ${day(k.createdAt)}` }), ' · ',
          h('span', { text: k.lastUsedAt ? `Last used ${date(k.lastUsedAt)}` : 'Not used yet' }))),
      h('button', { class: 'btn small outline-danger', type: 'button', text: 'Remove', 'aria-label': `Remove ${k.name}`, onclick: async () => {
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
  return h('section', { class: card ? 't-set-card' : 't-pk', 'aria-labelledby': 'pk-title' },
    h('h2', { id: 'pk-title', text: 'Passkeys' }), list, tip(h('div', { class: 't-tip-host' }, add), add, "A passkey lets you sign in with your fingerprint, face or phone instead of a password, on this computer or your phone."), msg);
}

// Shown once, when a teacher's quiz key is made, or they make a new code in Settings (again): the only way
// back to their quizzes without the password. This tab keeps it until "I saved it" (core.js keepCode).
function showRecoveryCode(codeText, again) {
  keepCode(codeText, again);
  const copy = h('button', { class: 'btn t-ib', type: 'button' }, icon(ICONS.copy, 16), 'Copy'); // as tall as the code beside it
  copy.addEventListener('click', async () => { if (await copyText(codeText)) copy.lastChild.textContent = 'Copied'; });
  const file = URL.createObjectURL(new Blob([`BrowserQuiz recovery code for ${dash.who ? dash.who.username : 'your account'}\r\n${codeText}\r\n`], { type: 'text/plain' }));
  const dl = iconButton(h('a', { class: 'btn', href: file, download: 'BrowserQuiz recovery code.txt' }), 'download', 'Download as a file');
  mount(h('main', { class: 't-login t-recovery' },
    h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
    h('h1', { text: again ? 'Save your new recovery code' : 'Save your recovery code' }),
    h('p', { text: `Your quizzes are encrypted with your password, so only you can open them, not whoever runs this server. If you forget your password, this code is the only way to get them back.${again ? ' Your old code no longer works.' : ''}` }),
    h('div', { class: 't-row t-code-row' }, h('code', { class: 't-code-big', text: codeText }), copy, dl),
    h('p', { class: 't-small t-muted', text: "It isn't shown again. Keep it somewhere other than this computer." }),
    h('div', {}, h('button', { class: 'btn primary', type: 'button', text: 'I saved it', onclick: () => { forgetCode(); URL.revokeObjectURL(file); route(); } }))));
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
    list.replaceChildren(h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table' },
      h('thead', {}, h('tr', {}, heads(['Name', 'Username', 'Quizzes', 'Classes', 'Status'], ['Quizzes', 'Classes']), actionsHead())),
      h('tbody', {}, r.teachers.map((x) => h('tr', {},
        h('td', { text: x.name }), h('td', { class: 't-muted', text: x.username }),
        h('td', { class: 'num', 'data-label': 'Quizzes', text: String(x.quizzes) }), h('td', { class: 'num', 'data-label': 'Classes', text: String(x.classes) }),
        h('td', { class: x.disabled ? 't-muted' : x.pending ? 'st-waiting' : 'st-good', text: x.role === 'admin' ? 'Admin' : x.disabled ? 'Disabled' : x.pending ? 'Not signed in yet' : 'Active' }),
        h('td', { class: 't-actions' }, x.role === 'admin' ? null : moreMenu(`More for ${x.name}`, `teacher:${x.id}`, [
          { text: 'Reset password', onclick: () => act(x, 'reset') },
          { text: x.disabled ? 'Enable' : 'Disable', danger: !x.disabled, onclick: () => act(x, x.disabled ? 'enable' : 'disable') },
        ])))))), ['Quizzes', 'Classes'])));
  }
  const form = h('form', { class: 't-row t-add' }, // apart from the list, like adding a quiz or a class
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

export { passkeysSection, showLogin, showRecoveryCode, showSetPassword, teachersSection };
