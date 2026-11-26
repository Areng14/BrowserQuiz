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
  'unfocused-beat': "Their computer said the quiz wasn't the window in front, so they had left it.",
  reload: 'They reloaded the quiz, or closed it and opened it again.',
  'extended-display': 'Another screen was connected to their computer during the quiz.',
  paste: 'They tried to paste something copied from outside the quiz. Nothing was pasted. Not a strike.',
  'blocked-key': 'They pressed a shortcut the quiz blocks, like Alt+Tab or F12. Not a strike.',
  resize: 'The browser window changed size, as when it\'s made smaller to put something next to it. Not a strike.',
  'bulk-insert': '80 or more characters arrived in the code box at once, as a paste would. Not a strike.',
  'inhuman-typing': 'More than 150 characters typed in 10 seconds. Not a strike.',
  'other-network': 'With the network lock on, their quiz was reached from another network. It was refused. Not a strike.',
  'left-network': "They tried to carry on from another network than the one they started on, like a phone's hotspot. It was refused until you let them back in. Not a strike.",
  'other-device': 'Their quiz was reached from a different browser than the one they started in. Not a strike.',
  extension: 'A browser add-on put something on the quiz page: a spelling helper, say, or an AI helper. Not a strike.',
  'spoofed-checks': 'Something in their browser fakes the checks that see them leave, so leaving may not show up. Not a strike.',
  'no-frames': "The quiz wasn't drawn for a few seconds, as when something covers it, but no leave was reported. Not a strike.",
  'scripted-input': "Typing in an answer that didn't come from the keyboard, like an auto-typer's. Not a strike.",
  viewport: "In full screen, something sat beside the quiz, like a browser's side panel or developer tools. Not a strike.",
  setup: 'Their screen and window, and which checks worked on this computer.',
  automation: 'The browser says a program is controlling it, not a person. Not a strike.',
  'virtual-machine': "The quiz ran in a virtual computer or a remote desktop, so it may not be the screen in front of them. Not a strike.",
  'software-graphics': 'The browser draws without a graphics card. Some school computers do; it can also mean a virtual computer or remote desktop.',
  'answer-after-return': 'Changed within 30 seconds of coming back from 3 or more seconds away. Not a strike.',
  'same-browser': 'Another student signed in to this quiz from the same browser. Not a strike.',
  'new-network': "They joined from a network they haven't used on your earlier quizzes, like home or a phone's hotspot. Not a strike.",
};
// Browsers only offer passkeys on HTTPS (and localhost), so plain-http installs don't show them.
const PASSKEYS = !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);
dash.pollTimer = 0;
dash.tickTimer = 0;
dash.selected = null;

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
dash.who = null; // the signed-in teacher, from /api/t/me
// The password just typed at sign-in, so picking a new one doesn't ask for it again (memory only).
dash.justTyped = null;
// The signed-in teacher's name, opening a menu: their password (or, for admin with the password in
// .env, which is changed there, only passkeys) and Sign out.
function accountMenu() {
  if (!dash.who) return null;
  const items = [];
  if (!(dash.who.passwordFromEnv && !PASSKEYS)) items.push({ text: dash.who.passwordFromEnv ? 'Passkeys' : 'Password', onclick: () => showSetPassword(false) });
  items.push({ text: 'Sign out', onclick: async () => { await post('/api/t/logout'); dash.who = null; showLogin(); } });
  return moreMenu(`Account, ${dash.who.name}`, 'account', items, null, { text: dash.who.name });
}
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
    const arrow = icon([on && sort.dir < 0 ? 'M12 5v14M6 13l6 6 6-6' : 'M12 19V5M6 11l6-6 6 6'], 14);
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
  math: ['M3 13h3l3 7 5-16h7'],
  graph: ['M4 3v17h17', 'M7 16c3-9 7-11 12-9'],
  output: ['M4 17l6-5-6-5', 'M12 19h8'],
  trace: ['M3 4h18v16H3z', 'M3 10h18', 'M3 15h18', 'M10 4v16'],
  fill: ['M3 6h18v12H3z', 'M8 14h8'],
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  essay: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h10'],
  section: ['M3 12h18', 'M8 6h8', 'M8 18h8'],
  spark: ['M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z', 'M19 3v4M17 5h4'], // something an AI writes
};
function icon(paths, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, String(v));
  for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
// Filled pause and play marks (the paused quiz's banner)
function glyph(kind, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' })) s.setAttribute(k, String(v));
  const shapes = kind === 'pause' ? [['rect', { x: 6, y: 5, width: 4, height: 14, rx: 1 }], ['rect', { x: 14, y: 5, width: 4, height: 14, rx: 1 }]] : [['path', { d: 'M7 5l12 7-12 7z' }]];
  for (const [tag, attrs] of shapes) { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); s.append(el); }
  return s;
}

export { EVENT_TIP, ICONS, LABEL, PASSKEYS, accountMenu, actionsHead, api, ask, bar, clock, date, ghLink, glyph, h, heads, icon, mmss, mount, plural, post, root, scoreText, sortHeads, sortRows, sortableTable, themeButton, tip };
