// Settings: the teacher's name, time zone and theme, password, recovery code, passkeys, other browsers,
// what Give a quiz starts with, and the AI grading key. Each section saves on its own button.

import { dash } from './state.js';
import { PASSKEYS, accountMenu, api, ask, h, labeled, plural, post, setTheme, themeButton, themeChoice, tip } from './core.js';
import { passkeysSection, showRecoveryCode } from './account.js';
import { lockdownFields } from './modes.js';
import { aiKeyEditor } from './aikey.js';

const card = (id, title, ...body) => h('section', { class: 't-set-card', 'aria-labelledby': id }, h('h2', { id, text: title }), ...body);
const note = (text) => h('p', { class: 't-set-note', text });
// A section's message after its button: green when saved, red when not.
const status = () => h('p', { class: 't-small t-set-msg', role: 'status' });
const say = (el, text, bad) => { el.className = `t-small t-set-msg ${bad ? 't-error' : 'st-good'}`; el.textContent = text; };
const field = (id, label, input) => h('label', { class: 'field', for: id }, h('span', { class: 'field-label', text: label }), input);
// The sidebar's name and theme button, after either changes here.
function repaintSide() {
  const foot = document.querySelector('.t-side-foot');
  if (foot) foot.replaceChildren(...[accountMenu()].flat(), themeButton()); // the menu is its button and its list
}

// Every time zone this browser knows, as "Eastern Time (New York)", by UTC offset.
function zoneOptions(current) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
  if (current && !zones.includes(current)) zones.push(current);
  const now = new Date();
  const part = (tz, style) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style }).formatToParts(now).find((p) => p.type === 'timeZoneName').value; } catch (e) { return ''; } };
  const offset = (s) => { const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(s); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0; };
  return zones.map((tz) => {
    const city = tz.split('/').pop().replace(/_/g, ' ');
    const generic = part(tz, 'longGeneric');
    return { tz, label: generic && !/^GMT/.test(generic) ? `${generic} (${city})` : `${part(tz, 'shortOffset') || 'GMT'} (${city})`, at: offset(part(tz, 'shortOffset')) };
  }).sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
}
function browserZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }

function youCard(s) {
  const name = h('input', { class: 'input', id: 'set-name', autocomplete: 'name', maxlength: '80', value: s.name });
  const here = browserZone();
  const tz = h('select', { class: 'input', id: 'set-tz' },
    h('option', { value: '', text: `This computer's${here ? ` (${here.split('/').pop().replace(/_/g, ' ')})` : ''}` }),
    zoneOptions(s.tz).map((z) => h('option', { value: z.tz, text: z.label, selected: z.tz === s.tz })));
  const theme = h('select', { class: 'input', id: 'set-theme' },
    [['', 'Match my computer'], ['light', 'Light'], ['dark', 'Dark']].map(([v, t]) => h('option', { value: v, text: t, selected: v === themeChoice() })));
  const msg = status();
  const save = h('button', { class: 'btn primary', type: 'submit', text: 'Save' });
  const form = h('form', { class: 't-set-card', 'aria-labelledby': 'set-you' }, h('h2', { id: 'set-you', text: 'You' }),
    h('div', { class: 't-set-grid' }, field('set-name', 'Name', name),
      tip(field('set-tz', 'Time zone', tz), tz, 'Times on your quizzes, results and downloaded grades are shown in this time zone.'),
      tip(field('set-theme', 'Theme', theme), theme, 'Light or dark, on this computer only.')),
    h('div', { class: 't-row t-set-foot' }, save, msg));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true; msg.textContent = '';
    try {
      const r = await post('/api/t/settings/you', { name: name.value, tz: tz.value || null });
      setTheme(theme.value);
      dash.who = Object.assign({}, dash.who, { name: r.name, tz: r.tz });
      name.value = r.name;
      repaintSide();
      say(msg, 'Saved.');
    } catch (ex) { if (ex.message !== 'login') say(msg, ex.message, true); }
    save.disabled = false;
  });
  return form;
}

function passwordCard(onSignedOut) {
  if (dash.who && dash.who.passwordFromEnv) return card('set-pw', 'Password', note("It's ADMIN_PASSWORD in the server's .env file."));
  // whose password this is, hidden, so a password manager saves the new one under the right name
  const account = h('input', { type: 'text', autocomplete: 'username', value: dash.who ? dash.who.username : '', readonly: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  const cur = h('input', { class: 'input', type: 'password', id: 'set-pw-cur', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', id: 'set-pw-new', autocomplete: 'new-password', minlength: '10' });
  const again = h('input', { class: 'input', type: 'password', id: 'set-pw-again', autocomplete: 'new-password' });
  const msg = status();
  const save = h('button', { class: 'btn primary', type: 'submit', text: 'Change password' });
  const form = h('form', { class: 't-set-card', 'aria-labelledby': 'set-pw' }, account, h('h2', { id: 'set-pw', text: 'Password' }),
    h('div', { class: 't-set-grid' }, field('set-pw-cur', 'Current password', cur), field('set-pw-new', 'New password (10+ characters)', next), field('set-pw-again', 'New password again', again)),
    h('div', { class: 't-row t-set-foot' }, save, msg));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    if (next.value !== again.value) { say(msg, "The new passwords don't match.", true); again.focus(); return; }
    save.disabled = true;
    try {
      const r = await post('/api/t/me/password', { current: cur.value, next: next.value });
      if (r && r.recoveryCode) { showRecoveryCode(r.recoveryCode); return; }
      cur.value = next.value = again.value = '';
      say(msg, 'Password changed. Your other devices are signed out.');
      onSignedOut();
    } catch (ex) { if (ex.message !== 'login') say(msg, ex.message, true); if (ex.code === 'bad_password') cur.select(); }
    save.disabled = false;
  });
  return form;
}

function recoveryCard() {
  const msg = h('p', { class: 't-error', role: 'alert' });
  const btn = labeled(h('button', { class: 'btn outline-warning', type: 'button' }), 'reopen', 'New recovery code');
  btn.addEventListener('click', async () => {
    msg.textContent = '';
    const password = await ask.ask({ title: 'New recovery code', text: 'Your current recovery code stops working.', label: 'Your password', password: true, ok: 'Make a new code' });
    if (password == null) return;
    btn.disabled = true;
    try { showRecoveryCode((await post('/api/t/settings/recovery-code', { password })).recoveryCode, true); } catch (ex) { if (ex.message !== 'login') msg.textContent = ex.message; btn.disabled = false; }
  });
  return card('set-rc', 'Recovery code',
    h('div', {}, btn), msg);
}

function devicesCard(s) {
  const line = h('p', { class: 't-set-note' });
  const msg = h('p', { class: 't-error', role: 'alert' });
  const btn = labeled(h('button', { class: 'btn outline-danger', type: 'button' }), 'exit', 'Sign out other devices');
  const paint = (n) => { line.textContent = n ? `Signed in on ${plural(n, 'other device')}.` : 'Not signed in anywhere else.'; btn.disabled = !n; };
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = '';
    try { paint((await post('/api/t/settings/sign-out-others')).otherSessions); } catch (ex) { if (ex.message !== 'login') msg.textContent = ex.message; btn.disabled = false; }
  });
  paint(s.otherSessions);
  const el = h('section', { class: 't-set-card t-set-inline', 'aria-labelledby': 'set-dev' },
    h('div', { class: 't-set-what' }, h('h2', { id: 'set-dev', text: 'Other devices' }), line), btn, msg);
  return { el, signedOut: () => paint(0) };
}

function defaultsCard(s) {
  const lock = lockdownFields(s.defaults, 'def-');
  const msg = status();
  const save = h('button', { class: 'btn primary', type: 'submit', text: 'Save defaults' });
  const form = h('form', { class: 't-set-card', 'aria-labelledby': 'set-qd' }, h('h2', { id: 'set-qd', text: 'Quiz defaults' }),
    lock.nodes, h('div', { class: 't-row t-set-foot' }, save, msg));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true; msg.textContent = '';
    try {
      const r = await post('/api/t/settings/defaults', lock.read(true));
      if (dash.who) dash.who.defaults = r.defaults;
      say(msg, 'Saved.');
    } catch (ex) { if (ex.message !== 'login') say(msg, ex.message, true); }
    save.disabled = false;
  });
  return form;
}

async function aiCard() {
  let ks = { mine: false, server: false };
  try { ks = await api('/api/t/ai-key'); } catch (e) { /* drawn without one */ }
  const keys = aiKeyEditor(ks, (now, editing, focus) => {
    if (!editing && focus) { const b = keys.el.querySelector('.t-linkbtn'); if (b) b.focus(); }
  }, 'set-ai');
  keys.draw(false);
  return card('set-ai', 'AI grading key',
    keys.el);
}

// The tab's page (home.js shell): its sections fill in once the settings are in.
function settingsTab() {
  const body = h('div', { class: 't-set' });
  const page = h('section', { class: 't-section t-settings' }, h('h1', { text: 'Settings' }), body);
  (async () => {
    let s;
    try { s = await api('/api/t/settings'); } catch (e) { if (e.message !== 'login') body.replaceChildren(h('p', { class: 't-error', text: e.message })); return; }
    const devices = devicesCard(s);
    body.replaceChildren(...[
      youCard(s),
      passwordCard(devices.signedOut),
      s.recovery ? recoveryCard() : null,
      PASSKEYS ? passkeysSection(true) : null,
      devices.el,
      defaultsCard(s),
      await aiCard()].filter(Boolean));
  })();
  return page;
}

export { settingsTab };
