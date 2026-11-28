// The dashboard itself: where it is (the address), its tabs, and the pickers and buttons they share.

import { showQuizEditor } from '../maker/main.js';
import { dash } from './state.js';
import { ICONS, accountMenu, actionsHead, api, ask, date, h, heads, icon, iconButton, mount, pendingCode, plural, post, labeled, siteFoot, sortableTable, themeButton, tip } from './core.js';
import { showRecoveryCode, teachersSection } from './account.js';
import { settingsTab } from './settings.js';
import { showRoster } from './roster.js';
import { moreMenu } from './cells.js';
import { showRun } from './run.js';
import { showGrade } from './grade.js';
import { lockdownFields } from './modes.js';
import { picker } from './picker.js';
import { gradesTab } from './grades.js';
import { serverTab } from './server.js';

// ---------- dashboard: a sidebar of tabs, each with its own address (#give, #run/<id>, ...) ----------
const TABS = [
  { id: 'give', label: 'Give a quiz', short: 'Give', icon: 'play' },
  { id: 'grades', label: 'Grades', icon: 'results' },
  { id: 'recent', label: 'Recent', icon: 'recent' },
  { id: 'quizzes', label: 'Quizzes', icon: 'quizzes' },
  { id: 'classes', label: 'Classes', icon: 'classes' },
  // in the menu under the teacher's name (core.js accountMenu), not the sidebar
  { id: 'teachers', label: 'Teachers', icon: 'teachers', admin: true, menu: true },
  { id: 'server', label: 'Server', icon: 'settings', admin: true, menu: true },
  { id: 'settings', label: 'Settings', icon: 'settings', menu: true },
];
// Open quizzes: one goes straight to its live page, two or more to a list of them (#open).
const OPEN = { id: 'open', label: 'Open quizzes', short: 'Open', icon: 'live' };
dash.openRuns = null; // [{ id, title, code }], newest first; null until the overview says
function noteRuns(runs) {
  dash.openRuns = runs.filter((r) => r.status === 'open').map((r) => ({ id: r.id, title: r.quiz_title, code: r.code }));
  dash.live = dash.openRuns.length;
}
dash.tab = 'give';
dash.live = 0; // open quizzes, shown on the Open tab when there's more than one
dash.here = location.hash;
dash.leaveGuard = null; // set by a page with unsaved work; false keeps the teacher there
dash.guardOpen = false;
dash.navSeq = 0; // the latest page asked for, so a slow load doesn't replace a newer page

function setHash(hash, replace) {
  dash.here = hash;
  if (location.hash === hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}
async function route() {
  if (dash.leaveGuard) {
    if (dash.guardOpen) return; // already asking
    dash.guardOpen = true;
    const go = await dash.leaveGuard();
    dash.guardOpen = false;
    if (!go) { history.pushState(null, '', dash.here); return; }
  }
  dash.leaveGuard = null;
  // a recovery code not saved yet stays on screen, even after a reload (account.js showRecoveryCode)
  const code = pendingCode();
  if (code) { if (!dash.who) { try { dash.who = (await api('/api/t/me')).teacher; } catch (e) { /* shown anyway */ } } showRecoveryCode(code.code, code.again); return; }
  if (!dash.who) { try { const me = await api('/api/t/me'); dash.who = me.teacher; dash.version = me.version; } catch (e) { return; } } // signs in first if needed
  const [a, b, c] = location.hash.slice(1).split('/');
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } }; // a mangled link: not found, not a blank page
  const id = b ? dec(b) : null;
  if (a === 'run' && id) showRun(id);
  else if (a === 'grade' && id) showGrade(id, c ? dec(c) : null);
  else if (a === 'class') showRoster(id === 'new' ? null : id);
  else if (a === 'quiz') openQuiz(id === 'new' ? null : id);
  else if (a === 'grades' && id !== 'all') { dash.gradesFor = id; showHome('grades'); } // #grades/<class>
  else if (a === 'results' || a === 'grades') { history.replaceState(null, '', '#recent'); showHome('recent'); } // the list's old addresses
  else showHome(a === 'open' || TABS.some((t) => t.id === a) ? a : 'give');
}
window.addEventListener('hashchange', route);
function openQuiz(id) {
  setHash('#quiz/' + (id ? encodeURIComponent(id) : 'new'));
  showQuizEditor(id);
}
// The page frame: tabs on the left, the page on the right. active: the tab this page belongs to.
function shell(active, ...content) {
  const tabs = TABS.filter((t) => !t.menu && (!t.admin || (dash.who && dash.who.role === 'admin')));
  const one = dash.openRuns && dash.openRuns.length === 1 && dash.openRuns[0];
  if (dash.openRuns && dash.openRuns.length) tabs.splice(1, 0, Object.assign({}, OPEN, one ? { label: 'Open quiz', href: '#run/' + encodeURIComponent(one.id), title: `${one.title} (${one.code})` } : {}));
  return h('div', { class: 't-shell' },
    h('nav', { class: 't-side', 'aria-label': 'Dashboard' },
      h('div', { class: 't-brand' }, h('img', { class: 't-brand-icon', src: '/icon.svg', alt: '', width: 26, height: 26 }), 'BrowserQuiz'),
      h('div', { class: 't-nav' }, tabs.map((t) => h('a', { class: 't-nav-item', href: t.href || '#' + t.id, title: t.title || null, 'aria-current': t.id === active ? 'page' : null },
        icon(t.icon), h('span', { class: 't-nav-label' }, t.short || t.label, t.short ? h('span', { class: 't-nav-more', text: t.label.slice(t.short.length) }) : null),
        t.id === 'open' && dash.live > 1 ? h('span', { class: 't-badge', title: `${dash.live} open`, 'aria-label': `${dash.live} open`, text: String(dash.live) }) : null))),
      h('div', { class: 't-side-foot' }, accountMenu(), themeButton())),
    h('main', { class: 't-main' }, ...content),
    h('footer', { class: 't-foot' }, siteFoot())); // at the bottom of the page, or after it when it's long
}

async function showHome(next) {
  const same = !next || next === dash.tab;
  if (next) dash.tab = next;
  setHash('#' + dash.tab + (dash.tab === 'grades' && dash.gradesFor ? '/' + encodeURIComponent(dash.gradesFor) : ''), dash.tab === 'grades');
  const seq = ++dash.navSeq;
  let data;
  let me = null;
  try { [data, me] = await Promise.all([api('/api/t/overview'), api('/api/t/me').catch(() => null)]); } catch (e) { if (e.message !== 'login') mount(h('p', { class: 't-error', text: e.message })); return; }
  if (seq !== dash.navSeq) return;
  dash.who = me && me.teacher;
  if (me && me.version) dash.version = me.version;
  if ((dash.tab === 'teachers' || dash.tab === 'server') && !(dash.who && dash.who.role === 'admin')) { showHome('give'); return; }
  noteRuns(data.runs);
  if (dash.tab === 'open' && dash.live < 2) { if (dash.live) { history.replaceState(null, '', '#run/' + encodeURIComponent(dash.openRuns[0].id)); showRun(dash.openRuns[0].id); } else showHome('give'); return; }
  const page = { open: openTab, give: giveTab, grades: gradesTab, recent: recentTab, quizzes: quizzesTab, classes: classesTab, teachers: teachersSection, server: serverTab, settings: settingsTab }[dash.tab](data, me);
  const y = same ? window.scrollY : 0;
  mount(shell(dash.tab, page));
  window.scrollTo(0, y);
}

const runsTable = (runs) => h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table' },
  h('thead', {}, h('tr', {}, heads(['Code', 'Quiz', 'Class', 'Status', 'Joined', 'Started'], ['Joined']), actionsHead())),
  h('tbody', {}, runs.map((r) => h('tr', {},
    h('td', {}, h('button', { class: 't-link t-mono', type: 'button', text: r.code, onclick: () => showRun(r.id) })),
    // the quiz's name opens its results too, as the code does (where a teacher looks for it)
    h('td', {}, h('button', { class: 't-link', type: 'button', text: r.quiz, onclick: () => showRun(r.id) })), h('td', { text: r.roster }),
    h('td', { class: r.status === 'open' ? 'st-good' : 't-muted', text: `${r.status === 'open' ? 'Open' : 'Closed'}${r.corrections ? ' (corrections)' : r.practice ? ' (practice)' : r.seb ? ' (SEB)' : ''}` }),
    h('td', { class: 'num', 'data-label': 'Joined', text: String(r.joined) }), h('td', { 'data-label': 'Started', 'data-sort': String(r.createdAt), text: date(r.createdAt) }),
    // like every list: the rest, and Delete in red, under ⋯
    h('td', { class: 't-actions' }, moreMenu(`More for ${r.code}`, `run:${r.id}`, [
      h('a', { href: `/teacher/report.html?run=${encodeURIComponent(r.id)}`, target: '_blank', rel: 'noopener', text: 'Class report' }),
      { text: 'Delete', danger: true, onclick: () => remove(`/api/t/runs/${r.id}/delete`, `Delete ${r.code} and all its results?`, r.status === 'open' ? "It's still open: anyone taking it gets signed out." : null) }])))))), ['Joined']));

// Start a quiz: what, who, and how it's locked down. (Open ones are under the Open tab.)
function giveTab(data, me) {
  const runner = !me || !me.runner || me.runnerOk ? null
    : h('p', { class: 't-error t-small' }, h('span', { class: 'dot bad' }), 'Code runner offline. Code questions get graded once it is back.');
  // Give, from a quiz's ⋯ on the Quizzes tab: that quiz is picked, and the class is next
  const given = dash.giveQuiz;
  dash.giveQuiz = null;
  const quizSel = picker('run-quiz', 'Quiz', data.quizzes.map((x) => ({ value: x.id, label: x.title, meta: [plural(x.questions, 'question'), date(x.createdAt)] })), given);
  const rosterSel = picker('run-roster', 'Class', data.rosters.map((x) => ({ value: x.id, label: x.name, meta: [plural(x.students, 'student')] })));
  // what Settings says it starts with (dash/modes.js)
  const lock = lockdownFields(me && me.teacher && me.teacher.defaults);
  const startMsg = h('p', { class: 't-error', role: 'alert' });
  const ready = data.quizzes.length && data.rosters.length;
  const startBtn = labeled(h('button', { class: 'btn primary t-start', type: 'button', disabled: !ready }), 'play', 'Start quiz');
  startBtn.addEventListener('click', async () => {
    const pick = data.quizzes.find((x) => x.id === quizSel.value);
    if (lock.read().mode !== 'practice' && pick && pick.practiced
      && !(await ask.confirm({ title: 'Give it as a graded quiz?', text: `Students who practiced "${pick.title}" have seen its answers.`, ok: 'Give it anyway' }))) return;
    startBtn.disabled = true;
    startMsg.textContent = '';
    try {
      const l = lock.read();
      const r = await post('/api/t/runs', { quizId: quizSel.value, rosterId: rosterSel.value, ipLock: l.ipLock, practice: l.mode === 'practice', seb: l.mode === 'seb', sebKey: l.sebKey || null, sebMute: l.sebMute });
      showRun(r.id);
    } catch (e) { startMsg.textContent = e.message; startBtn.disabled = false; }
  });
  const missing = [!data.quizzes.length && ['quiz', '#quizzes'], !data.rosters.length && ['class', '#classes']].filter(Boolean);
  if (given && quizSel.value === given) requestAnimationFrame(() => document.getElementById('run-roster').focus());
  return [
    h('section', { class: 't-section' },
      h('h1', { text: 'Give a quiz' }),
      missing.length ? h('p', { class: 't-muted' }, 'Add a ', missing.map(([w, href], i) => [i ? ' and a ' : '', h('a', { href, text: w })]), ' first.') : null,
      h('div', { class: 't-start-form' },
        h('div', { class: 't-row' }, quizSel.el, rosterSel.el),
        lock.nodes,
        h('div', { class: 't-row t-start-row' }, startBtn, startMsg), runner)),
  ];
}

function openTab(data) {
  return h('section', { class: 't-section' }, h('h1', { text: 'Open quizzes' }), runsTable(data.runs.filter((r) => r.status === 'open')));
}

// Every quiz given, open ones first, then newest first: where a practice run, corrections or one still
// open is found (Grades has closed exams only). Search, once the list is long enough to need it.
function recentTab(data) {
  const runs = [...data.runs.filter((r) => r.status === 'open'), ...data.runs.filter((r) => r.status !== 'open')];
  if (!runs.length) return h('section', { class: 't-section' }, h('h1', { text: 'Recent' }), h('p', { class: 't-muted', text: 'None yet.' }));
  const table = runsTable(runs);
  const rows = [...table.querySelectorAll('tbody tr')];
  rows.forEach((tr, i) => { const r = runs[i]; tr.dataset.find = `${r.code} ${r.quiz} ${r.roster}`.toLowerCase(); });
  const none = h('p', { class: 't-muted', text: 'None found.', hidden: true });
  const filter = () => {
    const want = (dash.recentFind || '').trim().toLowerCase();
    for (const tr of rows) tr.hidden = !!want && !tr.dataset.find.includes(want);
    none.hidden = rows.some((tr) => !tr.hidden);
    table.hidden = !none.hidden;
  };
  const findBox = h('input', { class: 'input t-search', type: 'search', value: dash.recentFind || '', placeholder: 'Search', 'aria-label': 'Search quizzes given', autocomplete: 'off', spellcheck: 'false' });
  findBox.addEventListener('input', () => { dash.recentFind = findBox.value; filter(); });
  const long = runs.length > 6;
  if (long) filter();
  return h('section', { class: 't-section' },
    h('div', { class: 't-head t-head-wrap' }, h('h1', { text: 'Recent' }), long ? findBox : null),
    table, none);
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
    const json = jsonIn(pasteJson.value);
    if (!json) { quizMsg.textContent = "That isn't a quiz.json."; return; }
    pasteBtn.disabled = true; pasteBtn.textContent = 'Checking…'; quizMsg.textContent = '';
    try { await api('/api/t/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: json }); showHome(); } catch (e) { quizMsg.textContent = e.message; pasteBtn.disabled = false; pasteBtn.textContent = 'Upload pasted quiz'; }
  });
  const quizBtn = h('button', { class: 'btn', type: 'button', text: 'Upload .quiz' });
  quizBtn.addEventListener('click', async () => {
    const f = quizFile.files[0];
    if (!f) { quizMsg.textContent = 'Pick a .quiz file first.'; return; }
    if (f.size > 25 * 1024 * 1024) { quizMsg.textContent = 'The .quiz file is bigger than 25 MB.'; return; } // the server's limit, before reading it all in
    quizBtn.disabled = true; quizBtn.textContent = 'Checking…'; quizMsg.textContent = '';
    try { await api('/api/t/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() }); showHome(); } catch (e) { quizMsg.textContent = e.message; quizBtn.disabled = false; quizBtn.textContent = 'Upload .quiz'; }
  });
  // Search by title, once the list is long enough to need it; kept while the tab redraws.
  const none = h('p', { class: 't-muted', text: 'None found.', hidden: true });
  const filter = () => {
    const want = dash.quizFind.trim().toLowerCase();
    const rows = [...section.querySelectorAll('tbody tr[data-title]')];
    for (const tr of rows) tr.hidden = !!want && !tr.dataset.title.includes(want);
    none.hidden = !rows.length || rows.some((tr) => !tr.hidden);
    const wrap = section.querySelector('.t-table-wrap');
    if (wrap) wrap.hidden = !none.hidden;
  };
  const findBox = h('input', { class: 'input t-search', type: 'search', value: dash.quizFind, placeholder: 'Search quizzes', 'aria-label': 'Search quizzes', autocomplete: 'off', spellcheck: 'false' });
  findBox.addEventListener('input', () => { dash.quizFind = findBox.value; filter(); });
  const search = data.quizzes.length > 6 ? h('div', { class: 't-search-row' }, findBox, none) : null;
  const section = h('section', { class: 't-section' },
    h('div', { class: 't-head t-head-wrap' }, h('h1', { text: 'Quizzes' }),
      copyPromptBtn(),
      labeled(h('button', { class: 'btn small primary', type: 'button', onclick: () => openQuiz(null) }), 'plus', 'New quiz')),
    search,
    data.quizzes.length ? h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table t-list' },
      h('thead', {}, h('tr', {}, ['Quiz', 'Questions', 'Time limit', 'Added'].map((x) => h('th', { text: x })), actionsHead())),
      h('tbody', {}, data.quizzes.map((x) => h('tr', { 'data-title': x.title.toLowerCase() },
        h('td', { role: 'rowheader', class: 't-rowhead' }, h('button', { class: 't-link', type: 'button', text: x.title, onclick: () => openQuiz(x.id) })),
        h('td', { class: 't-muted', 'data-sort': String(x.questions), text: plural(x.questions, 'question') }),
        h('td', { class: 't-muted', 'data-sort': x.timeLimitMin ? String(x.timeLimitMin) : '', text: x.timeLimitMin ? `${x.timeLimitMin} min` : 'No time limit' }),
        h('td', { class: 't-muted', 'data-sort': String(x.createdAt), text: date(x.createdAt) }),
        h('td', { class: 't-actions' },
          iconButton(h('button', { class: 'btn small', type: 'button', 'aria-label': `Edit ${x.title}`, onclick: () => openQuiz(x.id) }), 'pencil', 'Edit'),
          moreMenu(`More for ${x.title}`, `quiz:${x.id}`, [
            { text: 'Give', onclick: () => { dash.giveQuiz = x.id; showHome('give'); } },
            linkBtn('Preview', `/teacher/preview.html?quiz=${encodeURIComponent(x.id)}`, true),
            // a copy to change, opened straight in the quiz maker
            { text: 'Duplicate', onclick: async () => {
              try { openQuiz((await post(`/api/t/quizzes/${encodeURIComponent(x.id)}/duplicate`)).id); } catch (e) { if (e.message !== 'login') quizMsg.textContent = e.message; }
            } },
            linkBtn('Download', `/api/t/quizzes/${encodeURIComponent(x.id)}/download`),
            { text: 'Delete', danger: true, onclick: () => remove(`/api/t/quizzes/${x.id}/delete`, `Delete ${x.title}?`, 'Past results stay.') }])))))))) : null,
    h('div', { class: 't-row t-add' }, tip(h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: 'Upload a .quiz or quiz.json' }), quizFile), quizFile,
      "Upload a quiz file: a .quiz downloaded from a quiz's ⋯ menu, or a quiz.json an AI wrote from Copy AI prompt."), quizBtn),
    h('details', { class: 't-paste' }, (() => {
      const s = h('summary', { text: 'Paste a quiz.json' });
      return tip(s, s, "Paste the quiz.json an AI wrote from Copy AI prompt, from its first { to its last }.");
    })(),
      h('label', { class: 'field', for: 'paste-quiz' }, h('span', { class: 'field-label', text: 'quiz.json' }), pasteJson), h('div', {}, pasteBtn)),
    quizMsg);
  if (search) filter();
  return section;
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
    try { await post('/api/t/rosters', { name: rosterName.value, csv: await csvText(f) }); showHome(); } catch (e) { rosterMsg.textContent = e.message; rosterBtn.disabled = false; }
  });
  return h('section', { class: 't-section' },
    h('div', { class: 't-head' }, h('h1', { text: 'Classes' }),
      labeled(h('button', { class: 'btn small primary', type: 'button', onclick: () => showRoster(null) }), 'plus', 'New class')),
    data.rosters.length ? h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table t-list' },
      h('thead', {}, h('tr', {}, ['Class', 'Students'].map((x) => h('th', { text: x })), actionsHead())),
      h('tbody', {}, data.rosters.map((x) => h('tr', {},
        h('td', { role: 'rowheader', class: 't-rowhead' }, h('button', { class: 't-link', type: 'button', text: x.name, onclick: () => showRoster(x.id) })),
        h('td', { class: 't-muted', 'data-sort': String(x.students), text: plural(x.students, 'student') }),
        h('td', { class: 't-actions' },
          iconButton(h('button', { class: 'btn small', type: 'button', 'aria-label': `Edit ${x.name}`, onclick: () => showRoster(x.id) }), 'pencil', 'Edit'),
          moreMenu(`More for ${x.name}`, `class:${x.id}`, [
            { text: 'Delete', danger: true, onclick: () => remove(`/api/t/rosters/${x.id}/delete`, `Delete ${x.name}?`, 'Past results stay.') }])))))))) : null,
    h('div', { class: 't-row t-add' },
      h('label', { class: 'field', for: 'roster-name' }, h('span', { class: 'field-label', text: 'Class name' }), rosterName),
      tip(h('label', { class: 'field', for: 'roster-file' }, h('span', { class: 'field-label', text: 'Upload a CSV (name, student ID)' }), rosterFile), rosterFile,
        "A spreadsheet saved as CSV, with name and student_id in the first row and one student on each row after it. Students type their ID to sign in."),
      rosterBtn),
    rosterMsg);
}

// A CSV in the encoding it was saved in: UTF-8, UTF-16 (Excel's "Unicode Text"), or else Windows-1252, which
// Excel's plain "CSV" is on Windows (read as UTF-8, José came out as Jos�).
async function csvText(f) {
  const b = new Uint8Array(await f.arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('windows-1252').decode(b); }
}
// The quiz.json in what was pasted: an AI chat's ```json block, or else from its first { to its last }
// (a chat's whole answer has words around it). null: there's no { in it at all.
function jsonIn(text) {
  const fenced = /```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/i.exec(text);
  if (fenced) return fenced[1];
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  return a < 0 ? null : text.slice(a, b > a ? b + 1 : text.length); // cut short: the server says where
}

const named = (el, label) => { el.setAttribute('aria-label', label); return el; };
function linkBtn(text, href, newTab) {
  const a = h('a', { class: 'btn small', href, text, target: newTab ? '_blank' : null, rel: newTab ? 'noopener' : null });
  a.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none';
  return a;
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
// kind: 'quiz' (the Quizzes tab), or 'question' (one question, from the quiz maker)
function copyPromptBtn(kind = 'quiz') {
  const url = `/api/t/${kind}-prompt`;
  const btn = labeled(h('button', { class: 'btn small', type: 'button' }), 'copy', 'Copy AI prompt');
  let text = null;
  const ready = fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : null)).then((t) => { text = t; }).catch(() => {});
  let reset = 0;
  btn.addEventListener('click', async () => {
    if (text == null) await ready;
    if (text != null && await copyText(text)) {
      labeled(btn, 'check', 'Copied');
      clearTimeout(reset);
      reset = setTimeout(() => { labeled(btn, 'copy', 'Copy AI prompt'); }, 2000);
    } else {
      location.href = url;
    }
  });
  const file = h('a', { class: 'btn small t-split-icon', href: url, download: `BrowserQuiz ${kind} prompt.txt`, 'aria-label': 'Download the AI prompt as a file', title: 'Download as a file' }, icon(ICONS.download, 16));
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

// A page with unsaved work (the quiz maker) asks before anyone leaves it.
function guard(fn) { dash.leaveGuard = fn; }

export { copyPromptBtn, copyText, guard, noteRuns, route, sebButtons, setHash, shell, showHome };
