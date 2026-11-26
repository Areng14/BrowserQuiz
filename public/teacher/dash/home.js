// The dashboard itself: where it is (the address), its tabs, and the pickers and buttons they share.

import { showQuizEditor } from '../maker/main.js';
import { dash } from './state.js';
import { ICONS, accountMenu, actionsHead, api, ask, date, ghLink, h, heads, icon, mount, plural, post, sortableTable, themeButton } from './core.js';
import { teachersSection } from './account.js';
import { showRoster } from './roster.js';
import { moreMenu } from './cells.js';
import { showRun } from './run.js';
import { showGrade } from './grade.js';

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
  if (!dash.who) { try { dash.who = (await api('/api/t/me')).teacher; } catch (e) { return; } } // signs in first if needed
  const [a, b, c] = location.hash.slice(1).split('/');
  const id = b ? decodeURIComponent(b) : null;
  if (a === 'run' && id) showRun(id);
  else if (a === 'grade' && id) showGrade(id, c ? decodeURIComponent(c) : null);
  else if (a === 'class') showRoster(id === 'new' ? null : id);
  else if (a === 'quiz') openQuiz(id === 'new' ? null : id);
  else showHome(a === 'open' || TABS.some((t) => t.id === a) ? a : 'give');
}
window.addEventListener('hashchange', route);
function openQuiz(id) {
  setHash('#quiz/' + (id ? encodeURIComponent(id) : 'new'));
  showQuizEditor(id);
}
// The page frame: tabs on the left, the page on the right. active: the tab this page belongs to.
function shell(active, ...content) {
  const tabs = TABS.filter((t) => !t.admin || (dash.who && dash.who.role === 'admin'));
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
    h('footer', { class: 't-foot' }, ghLink())); // at the bottom of the page, or after it when it's long
}

async function showHome(next) {
  const same = !next || next === dash.tab;
  if (next) dash.tab = next;
  setHash('#' + dash.tab);
  const seq = ++dash.navSeq;
  let data;
  let me = null;
  try { [data, me] = await Promise.all([api('/api/t/overview'), api('/api/t/me').catch(() => null)]); } catch (e) { if (e.message !== 'login') mount(h('p', { class: 't-error', text: e.message })); return; }
  if (seq !== dash.navSeq) return;
  dash.who = me && me.teacher;
  if (dash.tab === 'teachers' && !(dash.who && dash.who.role === 'admin')) { showHome('give'); return; }
  noteRuns(data.runs);
  if (dash.tab === 'open' && dash.live < 2) { if (dash.live) { history.replaceState(null, '', '#run/' + encodeURIComponent(dash.openRuns[0].id)); showRun(dash.openRuns[0].id); } else showHome('give'); return; }
  const page = { open: openTab, give: giveTab, results: resultsTab, quizzes: quizzesTab, classes: classesTab, teachers: teachersSection }[dash.tab](data, me);
  const y = same ? window.scrollY : 0;
  mount(shell(dash.tab, page));
  window.scrollTo(0, y);
}

const runsTable = (runs) => h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table' },
  h('thead', {}, h('tr', {}, heads(['Code', 'Quiz', 'Class', 'Status', 'Joined', 'Started'], ['Joined']), actionsHead())),
  h('tbody', {}, runs.map((r) => h('tr', {},
    h('td', {}, h('button', { class: 't-link t-mono', type: 'button', text: r.code, onclick: () => showRun(r.id) })),
    h('td', { text: r.quiz }), h('td', { text: r.roster }),
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
  if (given && quizSel.value === given) requestAnimationFrame(() => document.getElementById('run-roster').focus());
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
      h('button', { class: 'btn small primary', type: 'button', text: 'New quiz', onclick: () => openQuiz(null) })),
    search,
    data.quizzes.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-list' },
      h('thead', { class: 'sr-only' }, h('tr', {}, ['Quiz', 'Questions', 'Time limit', 'Added'].map((x) => h('th', { text: x })), actionsHead())),
      h('tbody', {}, data.quizzes.map((x) => h('tr', { 'data-title': x.title.toLowerCase() },
        h('td', { role: 'rowheader', class: 't-rowhead', text: x.title }),
        h('td', { class: 't-muted', text: plural(x.questions, 'question') }),
        h('td', { class: 't-muted', text: x.timeLimitMin ? `${x.timeLimitMin} min` : 'No time limit' }),
        h('td', { class: 't-muted', text: date(x.createdAt) }),
        h('td', { class: 't-actions' },
          h('button', { class: 'btn small', type: 'button', text: 'Edit', 'aria-label': `Edit ${x.title}`, onclick: () => openQuiz(x.id) }),
          moreMenu(`More for ${x.title}`, `quiz:${x.id}`, [
            { text: 'Give', onclick: () => { dash.giveQuiz = x.id; showHome('give'); } },
            linkBtn('Preview', `/teacher/preview.html?quiz=${encodeURIComponent(x.id)}`, true),
            // a copy to change, opened straight in the quiz maker
            { text: 'Duplicate', onclick: async () => {
              try { openQuiz((await post(`/api/t/quizzes/${encodeURIComponent(x.id)}/duplicate`)).id); } catch (e) { if (e.message !== 'login') quizMsg.textContent = e.message; }
            } },
            linkBtn('Download', `/api/t/quizzes/${encodeURIComponent(x.id)}/download`),
            { text: 'Delete', danger: true, onclick: () => remove(`/api/t/quizzes/${x.id}/delete`, `Delete ${x.title}?`, 'Past results stay.') }]))))))) : null,
    h('div', { class: 't-row t-add' }, h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: 'Upload a .quiz or quiz.json' }), quizFile), quizBtn),
    h('details', { class: 't-paste' }, h('summary', { text: 'Paste a quiz.json' }),
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
// select can't do. items: [{ value, label, meta: [column, ...] }]; start: the value picked first (else the
// first). Keyboard: arrows, Home/End,
// Enter or Space to pick, Escape to close.
function picker(id, labelText, items, start) {
  let value = items.some((x) => x.value === start) ? start : items.length ? items[0].value : '';
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
// kind: 'quiz' (the Quizzes tab), or 'question' (one question, from the quiz maker)
function copyPromptBtn(kind = 'quiz') {
  const url = `/api/t/${kind}-prompt`;
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
