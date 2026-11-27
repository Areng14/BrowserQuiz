// The dashboard's building blocks: elements, the API, light and dark, the account menu, the top bar, sortable tables.

import { dash } from './state.js';
import { showLogin, showSetPassword } from './account.js';
import { moreMenu } from './cells.js';

const root = document.getElementById('t-app');
const ask = window.BQAsk; // our own confirm, notice and prompt (ask.js)
const THEME_KEY = 'bq-theme';
const LABEL = {
  join: 'Signed in', ready: 'Agreed to the rules, waiting in full screen', admit: 'Started by you', 'away-long': 'Gone longer than 10 seconds', start: 'Started the quiz', submit: 'Submitted', run: 'Ran examples', reload: 'Reopened mid-quiz',
  restore: 'Un-invalidated by teacher', automation: 'Browser run by a script', 'virtual-machine': 'Virtual machine or remote desktop', 'software-graphics': 'No graphics card (VM or remote desktop?)', invalidate: 'Invalidated by teacher', blur: 'Left the quiz window', hidden: 'Tab hidden',
  'fullscreen-exit': 'Left fullscreen', return: 'Came back', 'mouse-left': 'Cursor left the page', copy: 'Copy blocked',
  paste: 'Outside paste blocked', contextmenu: 'Right-click', 'blocked-key': 'Blocked key', 'print-screen': 'Print Screen',
  resize: 'Window resized', 'unfocused-beat': 'Heartbeat: not focused', 'heartbeat-lost': 'Connection lost', reconnect: 'Reconnected',
  resume: 'Continued on a new computer', 'let-in': 'Let back in by teacher', extend: 'Extra time', pause: 'Quiz paused', unpause: 'Quiz resumed', grade: 'Graded by teacher', 'ai-grade': 'Graded by AI',
  'extended-display': 'Second display', 'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
  'late-submit': 'Submitted late', exit: 'Exited the quiz', 'other-network': 'Request from another network', 'left-network': 'Tried to continue from another network', 'other-device': 'Request from another browser',
  extension: 'Extension on the page', 'spoofed-checks': 'Extension hides leaving the window', 'no-frames': 'Quiz not on screen, no leave reported',
  'scripted-input': 'Typed by a script', viewport: 'Side panel or DevTools open', setup: 'Computer',
  'answer-after-return': 'Changed an answer right after coming back', 'same-browser': 'Same browser as',
  'new-network': 'Network not used on earlier quizzes',
};
// What an activity log entry means, for the ones whose name doesn't say (shown on hover). Orange ones are
// worth a look but never a strike (server: store.js CLIENT_EVENTS, SERVER_EVENTS).
const EVENT_TIP = {
  'unfocused-beat': "Their computer reported that the quiz wasn't the window in front, so they had left it.",
  reload: "They reloaded the quiz, or closed it and opened it again.",
  'extended-display': "Another screen was connected to their computer during the quiz.",
  paste: "They tried to paste something copied from outside the quiz, and nothing was pasted. This doesn't count as a strike.",
  'blocked-key': "They pressed a shortcut the quiz blocks, such as Alt+Tab or F12. This doesn't count as a strike.",
  resize: "The browser window changed size, for example to fit another window beside it. This doesn't count as a strike.",
  'bulk-insert': "80 or more characters appeared in the code box at once, as they do with a paste. This doesn't count as a strike.",
  'inhuman-typing': "More than 150 characters were typed in 10 seconds. This doesn't count as a strike.",
  'other-network': "The network lock is on, and their quiz was reached from another network. The request was refused. This doesn't count as a strike.",
  'left-network': "They tried to continue from a different network than the one they started on, such as a phone hotspot. It was refused until you let them back in. This doesn't count as a strike.",
  'other-device': "Their quiz was reached from a different browser than the one they started in. This doesn't count as a strike.",
  extension: "A browser extension added something to the quiz page, such as a spelling or AI helper. This doesn't count as a strike.",
  'spoofed-checks': "Something in their browser fakes the checks that detect leaving, so leaving may not be recorded. This doesn't count as a strike.",
  'no-frames': "The quiz wasn't displayed for a few seconds, for example because something covered it, but no leave was recorded. This doesn't count as a strike.",
  'scripted-input': "Text was entered in an answer without using the keyboard, as an auto-typer does. This doesn't count as a strike.",
  viewport: "In full screen, something was shown beside the quiz, such as a browser side panel or developer tools. This doesn't count as a strike.",
  setup: "Their screen and window size, and which checks work on this computer.",
  automation: "The browser reports that a program, not a person, is controlling it. This doesn't count as a strike.",
  'virtual-machine': "The quiz ran in a virtual machine or a remote desktop, so it may not be the screen in front of them. This doesn't count as a strike.",
  'software-graphics': "The browser is drawing without a graphics card. Some school computers do this, but it can also mean a virtual machine or remote desktop.",
  'answer-after-return': "They changed an answer within 30 seconds of returning from 3 or more seconds away. This doesn't count as a strike.",
  'same-browser': "Another student signed in to this quiz from the same browser. This doesn't count as a strike.",
  'new-network': "They joined from a network they haven't used on your earlier quizzes, such as home or a phone hotspot. This doesn't count as a strike.",
};
// Browsers only offer passkeys on HTTPS (and localhost), so plain-http installs don't show them.
const PASSKEYS = !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);
dash.pollTimer = 0;
dash.tickTimer = 0;
dash.selected = null;

// light, dark, or '' to match the computer (this browser only)
function themeChoice() { try { const t = localStorage.getItem(THEME_KEY); return t === 'dark' || t === 'light' ? t : ''; } catch (e) { return ''; } }
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem(THEME_KEY, t); else localStorage.removeItem(THEME_KEY); } catch (e) { /* this page only */ }
}
if (themeChoice()) document.documentElement.dataset.theme = themeChoice();

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
// Times in the teacher's time zone from Settings, or this browser's.
const timeZone = () => (dash.who && dash.who.tz) || undefined;
function when(t, how, opts) {
  try { return new Date(t)[how]([], Object.assign({ timeZone: timeZone() }, opts)); } catch (e) { return new Date(t)[how]([], opts); } // a zone this browser doesn't know
}
const clock = (t) => (t ? when(t, 'toLocaleTimeString', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');
const date = (t) => when(t, 'toLocaleString', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (t) => when(t, 'toLocaleDateString', { month: 'short', day: 'numeric', year: 'numeric' });
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
  b.addEventListener('click', () => { setTheme(isDark() ? 'light' : 'dark'); paint(); });
  return b;
}
dash.who = null; // the signed-in teacher, from /api/t/me
// The password just typed at sign-in, so picking a new one doesn't ask for it again (memory only).
dash.justTyped = null;
// The signed-in teacher's name, opening a menu: Settings, Teachers (an admin's), and Sign out. They're
// here rather than in the sidebar: rarely needed, and a phone's tab bar has room for six at most.
function accountMenu() {
  if (!dash.who) return null;
  return moreMenu(`Account, ${dash.who.name}`, 'account', [
    { text: 'Settings', onclick: () => { location.hash = '#settings'; } },
    dash.who.role === 'admin' ? { text: 'Teachers', onclick: () => { location.hash = '#teachers'; } } : null,
    dash.who.role === 'admin' ? { text: 'Server', onclick: () => { location.hash = '#server'; } } : null,
    { text: 'Sign out', onclick: async () => { await post('/api/t/logout'); dash.who = null; forgetCode(); showLogin(); } },
  ], null, { text: dash.who.name });
}
// A recovery code waiting to be saved (account.js showRecoveryCode): this tab keeps it until "I saved it",
// so a reload doesn't lose it.
const CODE_KEY = 'bq-recovery';
function pendingCode() { try { return JSON.parse(sessionStorage.getItem(CODE_KEY) || 'null'); } catch (e) { return null; } }
function keepCode(code, again) { try { sessionStorage.setItem(CODE_KEY, JSON.stringify({ code, again: !!again })); } catch (e) { /* shown until they leave the page */ } }
function forgetCode() { try { sessionStorage.removeItem(CODE_KEY); } catch (e) { /* nothing kept */ } }
function bar(...left) {
  return h('header', { class: 't-bar' }, h('span', { class: 'grow' }, ...left), themeButton(), accountMenu());
}
// A new page: the tab title names it, and reading starts at its heading unless the page focused a field.
function mount(...nodes) {
  clearInterval(dash.pollTimer);
  clearInterval(dash.tickTimer);
  document.documentElement.classList.remove('t-sheet-open');
  dash.leaveGuard = null;
  root.replaceChildren(...nodes);
  const head = root.querySelector('main h1, h1');
  document.title = head && head.textContent ? `${head.textContent} - BrowserQuiz` : 'BrowserQuiz (Teacher Panel)';
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
// The page's foot once signed in: the project, and the version this server runs (the admin's Server page says more)
const siteFoot = () => [ghLink(), dash.version ? h('span', { class: 't-version', text: `Version ${dash.version}` }) : null];
const actionsHead = () => h('th', {}, h('span', { class: 'sr-only', text: 'Actions' }));
// Column headers; the ones named in nums sit right, over their right-aligned numbers.
const heads = (names, nums = []) => names.map((x) => h('th', { class: nums.includes(x) ? 'num' : null, text: x }));
// A few words on a term a teacher may not know: tip(host, control, text, side) (tip.js, shared with Watch).
const tip = window.BQTip;
// Click to sort: up, then down, then back to the list's own order. sort: { by, dir } or null; onSort(next).
// tipsFor: a few words on what a column means, by its name.
function sortHeads(names, nums, sort, onSort, tipsFor = {}) {
  return names.map((x) => {
    const on = sort && sort.by === x;
    const arrow = icon(on && sort.dir < 0 ? ICONS.down : ICONS.up, 14);
    arrow.classList.add('t-sort-arrow');
    const btn = h('button', { class: 't-sort', type: 'button', onclick: () => onSort(!on ? { by: x, dir: 1 } : sort.dir > 0 ? { by: x, dir: -1 } : null) }, x, arrow);
    const th = h('th', { class: (nums.includes(x) ? 'num ' : '') + (on ? 't-sorted' : ''), 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : null }, btn);
    return tipsFor[x] ? tip(th, btn, tipsFor[x]) : th;
  });
}
// Sorting rows by a key: numbers and text both, nothing (null) always last, ties by name.
function sortRows(rows, sort, keys, name) {
  if (!sort || !keys[sort.by]) return rows;
  const k = keys[sort.by];
  return rows.slice().sort((x, y) => {
    const a = k(x), b = k(y);
    if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
    const c = typeof a === 'string' ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) : a - b;
    return c * sort.dir || name(x).localeCompare(name(y));
  });
}
// A list that doesn't redraw by itself (Results, Teachers): sorts its rows where they are, by each
// cell's data-sort, or its text.
function sortableTable(table, nums = []) {
  const thead = table.querySelector('thead tr');
  const names = [...thead.children].map((th) => th.textContent).filter((t) => t && t !== 'Actions');
  const body = table.querySelector('tbody');
  const original = [...body.children];
  let sort = null;
  const cellKey = (tr, i) => { const td = tr.children[i]; if (!td) return null; const v = td.dataset.sort != null ? td.dataset.sort : td.textContent.trim(); return v === '' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.toLowerCase(); };
  const draw = () => {
    const keys = Object.fromEntries(names.map((n, i) => [n, (tr) => cellKey(tr, i)]));
    body.replaceChildren(...sortRows(original, sort, keys, (tr) => tr.children[0].textContent));
    const extra = [...thead.children].slice(names.length);
    thead.replaceChildren(...sortHeads(names, nums, sort, (next) => { sort = next; draw(); }), ...extra);
    if (sort) { const b = thead.querySelector('.t-sorted .t-sort'); if (b && document.activeElement && document.activeElement.classList.contains('t-sort')) b.focus(); }
  };
  draw();
  return table;
}
// A score with its percentage: "7 / 9 · 78%"
const scoreText = (score, max) => `${score} / ${max}${max ? ` · ${Math.round((score / max) * 100)}%` : ''}`;


// Line icons (Lucide, from /icons.js), so buttons look the same everywhere instead of as each phone's emoji.
// icon(ICONS.pause, 16); the names, and the Lucide icon each one is, are in scripts/build-icons.mjs.
const ICONS = Object.freeze(Object.fromEntries(window.BQIcons.names.map((n) => [n, n])));
function icon(name, size = 18, attrs) { return window.BQIcons.svg(name, size, attrs); }
// A button's icon and words (ICONS[name], 16px). Called again with new words, it changes only if they did.
function labeled(btn, name, text) {
  if (btn.dataset.label === text && btn.dataset.icon === name) return btn;
  btn.dataset.label = text;
  btn.dataset.icon = name;
  btn.classList.add('t-ib');
  btn.replaceChildren(icon(ICONS[name], 16), text);
  return btn;
}
// A button that's only its icon, for the ones anyone can tell (pause, edit, preview): its name shows on
// hover or keyboard focus (tip.js), and is what a screen reader says (aria-label, unless it has one).
// more: what it does, for one a teacher may not know, shown after its name.
function iconButton(btn, name, text, more) {
  btn.classList.add('t-ib', 't-icon-only');
  if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', text);
  btn.replaceChildren(icon(ICONS[name], 18));
  tip(btn, btn, more ? `${text}. ${more}` : text);
  if (!more) {
    btn.removeAttribute('aria-describedby'); // its name already says it
    btn.lastChild.classList.add('t-tip-name');
  }
  return btn;
}
// Filled pause and play marks (the paused quiz's banner)
function glyph(kind, size = 16) { return icon(kind, size, { fill: 'currentColor', stroke: 'none' }); }

export { EVENT_TIP, ICONS, LABEL, PASSKEYS, accountMenu, actionsHead, api, ask, bar, clock, date, day, forgetCode, ghLink, glyph, h, heads, icon, iconButton, keepCode, labeled, mmss, mount, pendingCode, plural, post, root, scoreText, setTheme, siteFoot, sortableTable, sortHeads, sortRows, themeButton, themeChoice, timeZone, tip };
