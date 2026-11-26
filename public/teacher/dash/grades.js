// Grades: a class's quizzes side by side, a column each with the newest on the right, every student's
// percent, their average, and the class's (the server's teacher/grades.js works them out). Every quiz given,
// open ones too, is All classes in the class picker: the list this tab used to be.

import { dash } from './state.js';
import { ICONS, api, date, day, h, icon, iconButton, plural, timeZone, tip } from './core.js';
import { picker } from './picker.js';

const KEEP = 'bq-grades'; // the class picked last, for next time
const remember = (id) => { try { localStorage.setItem(KEEP, id); } catch (e) { /* asked again next time */ } };
const recall = () => { try { return localStorage.getItem(KEEP); } catch (e) { return null; } };
// the address says which class, so a reload or Back comes back to it
function showAt(id) {
  const hash = '#grades/' + encodeURIComponent(id);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  dash.here = location.hash;
}
const pct = (p) => (p == null ? '—' : `${Math.round(p)}%`);

// runsTable: the list of every quiz given (home.js), for All classes
function gradesTab(data, runsTable) {
  const ids = new Set(data.rosters.map((x) => x.id));
  const newest = data.runs.find((r) => ids.has(r.rosterId)); // the class that had a quiz last
  const first = [dash.gradesFor, recall(), newest && newest.rosterId, data.rosters.length ? data.rosters[0].id : null]
    .find((x) => x === 'all' || ids.has(x)) || 'all';
  const items = [...data.rosters.map((x) => ({ value: x.id, label: x.name, meta: [plural(x.students, 'student')] })), { value: 'all', label: 'All classes', meta: [] }];
  const body = h('div', { class: 'gb-body' });
  const dl = h('button', { class: 'btn t-ib gb-dl', type: 'button', 'aria-label': 'Download grades', disabled: true },
    icon(ICONS.download, 16), h('span', { class: 'gb-dl-text', text: 'Download grades' }));
  let shown = null; // the class whose grades are on screen
  dl.addEventListener('click', () => {
    if (!shown) return;
    const tz = timeZone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    location.href = `/api/t/rosters/${encodeURIComponent(shown)}/grades.csv${tz ? '?tz=' + encodeURIComponent(tz) : ''}`;
  });
  let seq = 0;
  async function show(id) {
    const n = ++seq;
    dash.gradesFor = id;
    remember(id);
    showAt(id);
    if (id === 'all') {
      shown = null;
      dl.disabled = true;
      body.replaceChildren(data.runs.length ? runsTable(data.runs) : h('p', { class: 't-muted', text: 'None yet.' }));
      return;
    }
    let g;
    try { g = await api(`/api/t/rosters/${encodeURIComponent(id)}/grades`); } catch (e) {
      if (n === seq && e.message !== 'login') body.replaceChildren(h('p', { class: 't-error', text: e.message }));
      return;
    }
    if (n !== seq) return; // another class was picked meanwhile
    const ok = g.quizzes.length && g.students.length;
    shown = ok ? id : null;
    dl.disabled = !ok;
    body.replaceChildren(ok ? gradebook(g) : h('p', { class: 't-muted', text: g.quizzes.length ? 'No students yet.' : 'No grades yet.' }));
  }
  const sel = picker('grades-class', 'Class', items, first, show);
  sel.el.querySelector('.field-label').classList.add('sr-only');
  show(first);
  return h('section', { class: 't-section gb-page' }, h('div', { class: 't-head gb-head' }, h('h1', { text: 'Grades' }), sel.el, dl), body);
}

const AVG_TIP = "Each quiz counts the same. A quiz a student didn't take is left out; an invalidated one counts as 0.";
// The Average column comes twice: last, pinned on the right, and second, pinned after the names, which
// phones show instead (grades.css).
function avgHead(where) {
  const label = h('span', { class: 'gb-term', tabindex: '0', text: 'Average' });
  return tip(h('th', { scope: 'col', class: `gb-avg ${where}` }, label), label, AVG_TIP);
}
const avgCells = (tag, text, attrs) => ['gb-start', 'gb-end'].map((where) => h(tag, Object.assign({ class: `gb-avg ${where}` }, attrs), text));

function gradebook(g) {
  const older = iconButton(h('button', { class: 'btn small gb-arrow', type: 'button' }), 'prev', 'Older quizzes');
  const newer = iconButton(h('button', { class: 'btn small gb-arrow', type: 'button' }), 'next', 'Newer quizzes');
  const report = (id, text, cls) => h('a', { class: cls || 't-link', href: `/teacher/report.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text });
  // a cell opens that student's report, or grading when it needs the teacher
  const cell = (x, quiz) => {
    if (x.k === 'score' && x.was != null) {
      const a = report(x.a, pct(x.p), 't-link gb-term');
      return tip(h('td', {}, a), a, `Corrected from ${pct(x.was)}`);
    }
    if (x.k === 'score') return h('td', {}, report(x.a, pct(x.p)));
    if (x.k === 'invalid') { const a = report(x.a, 'Invalidated', 'gb-bad'); return tip(h('td', {}, a), a, 'Counts as 0%'); }
    if (x.k === 'review') return h('td', {}, h('a', { class: 'gb-needs', href: '#grade/' + encodeURIComponent(quiz.runId), text: 'Needs grading' }));
    if (x.k === 'grading') return h('td', { class: 't-muted', text: 'Grading…' });
    return h('td', { class: 't-muted' }, h('span', { 'aria-hidden': 'true', text: '—' }), h('span', { class: 'sr-only', text: "Didn't take it" }));
  };
  const quizHead = (x) => {
    const link = h('a', { class: 't-link gb-qname', href: '#run/' + encodeURIComponent(x.runId), text: x.title });
    return tip(h('th', { scope: 'col', class: 'gb-q' }, link, h('span', { class: 'gb-qdate', text: day(x.at) })), link, `${x.title}, ${date(x.at)}`);
  };
  const table = h('table', { class: 'gb-table', style: `--n: ${g.quizzes.length}` },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'gb-name' }, h('div', { class: 'gb-name-head' }, h('span', { text: 'Student' }), older, newer)),
      avgHead('gb-start'), g.quizzes.map(quizHead), avgHead('gb-end'))),
    h('tbody', {}, g.students.map((s) => {
      const [start, end] = avgCells('td', pct(s.avg));
      return h('tr', {}, h('th', { scope: 'row', role: 'rowheader', class: 'gb-name', title: s.name, text: s.name }),
        start, s.cells.map((x, i) => cell(x, g.quizzes[i])), end);
    })));
  // the row of averages: under each quiz, and the class's under Average
  const foot = h('tr', {}, h('th', { scope: 'row', role: 'rowheader', class: 'gb-name', text: 'Class average' }));
  const [fStart, fEnd] = avgCells('td', pct(g.avg));
  foot.append(fStart, ...g.quizzes.map((x) => h('td', { text: pct(x.avg) })), fEnd);
  table.append(h('tfoot', {}, foot));
  const box = h('div', { class: 'gb-scroll', role: 'region', 'aria-label': `Grades for ${g.roster.name}`, tabindex: '0' }, table);
  const thumb = h('div', { class: 'gb-thumb' });
  const rail = h('div', { class: 'gb-rail' }, thumb);
  const gb = h('div', { class: 'gb' }, box,
    h('div', { class: 'gb-bar', 'aria-hidden': 'true' }, rail),
    h('div', { class: 'gb-fade gb-fade-l', 'aria-hidden': 'true' }), h('div', { class: 'gb-fade gb-fade-r', 'aria-hidden': 'true' }));
  requestAnimationFrame(() => scroller(gb, box, rail, thumb, older, newer));
  return gb;
}

// Sideways scrolling under the pinned columns, made plain: a scrollbar of its own (the system's hides
// itself on Macs and phones), a soft shadow on the side there's more, and arrows that go a page at a time.
// It opens on the newest quizzes, and is as tall as the window leaves, so the page itself doesn't scroll.
function scroller(gb, box, rail, thumb, older, newer) {
  if (!gb.isConnected) return;
  const [fadeL, fadeR] = gb.querySelectorAll('.gb-fade');
  const head = box.querySelector('thead tr');
  const pinned = () => {
    const w = (sel) => head.querySelector(sel).offsetWidth; // 0 when it isn't shown
    return { left: w('.gb-name') + w('.gb-start'), right: w('.gb-end') };
  };
  const colW = () => (head.querySelector('.gb-q') || {}).offsetWidth || 120;
  const page = () => { const p = pinned(); return Math.max(1, Math.floor((box.clientWidth - p.left - p.right) / colW())) * colW(); };
  function sync() {
    const p = pinned();
    const bar = box.offsetWidth - box.clientWidth; // the up-and-down scrollbar, when there is one
    const max = box.scrollWidth - box.clientWidth;
    const x = box.scrollLeft;
    gb.toggleAttribute('data-scrolls', max > 1);
    gb.toggleAttribute('data-more-left', x > 1);
    gb.toggleAttribute('data-more-right', x < max - 1);
    older.disabled = x <= 1;
    newer.disabled = x >= max - 1;
    fadeL.style.left = `${p.left}px`;
    fadeR.style.right = `${p.right + bar}px`;
    rail.style.left = `${p.left + 12}px`;
    rail.style.right = `${p.right + bar + 12}px`;
    if (max <= 1) return;
    // the thumb: the share of quizzes in view, where they are
    const rw = rail.clientWidth;
    const w = Math.min(rw, Math.max(40, (rw * (box.clientWidth - p.left - p.right)) / (box.scrollWidth - p.left - p.right)));
    thumb.style.width = `${w}px`;
    thumb.style.transform = `translateX(${(x / max) * (rw - w)}px)`;
  }
  // as tall as the window leaves under it, the page's bottom padding and footer included
  function fit() {
    const k = gb.getBoundingClientRect().width / gb.offsetWidth || 1; // big screens zoom the page
    const main = gb.closest('.t-main');
    const foot = document.querySelector('.t-foot');
    const below = gb.offsetHeight - box.offsetHeight + (main ? parseFloat(getComputedStyle(main).paddingBottom) : 0) + (foot ? foot.offsetHeight : 0);
    const top = box.getBoundingClientRect().top + window.scrollY;
    box.style.maxHeight = `${Math.max(240, Math.floor((innerHeight - top) / k - below))}px`;
  }
  older.addEventListener('click', () => box.scrollBy({ left: -page(), behavior: 'smooth' }));
  newer.addEventListener('click', () => box.scrollBy({ left: page(), behavior: 'smooth' }));
  box.addEventListener('scroll', sync, { passive: true });
  // drag the thumb; a press on the rail beside it goes a page that way
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    thumb.classList.add('drag');
    const k = rail.getBoundingClientRect().width / rail.clientWidth || 1;
    const x0 = e.clientX;
    const s0 = box.scrollLeft;
    const per = (box.scrollWidth - box.clientWidth) / Math.max(1, rail.clientWidth - thumb.offsetWidth);
    const move = (m) => { box.scrollLeft = s0 + ((m.clientX - x0) / k) * per; };
    const end = () => { thumb.classList.remove('drag'); thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', end); thumb.removeEventListener('pointercancel', end); };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
  });
  rail.addEventListener('pointerdown', (e) => {
    if (e.target !== rail || e.button) return;
    box.scrollBy({ left: (e.clientX < thumb.getBoundingClientRect().left ? -1 : 1) * page(), behavior: 'smooth' });
  });
  const resized = () => {
    if (!gb.isConnected) { removeEventListener('resize', resized); ro.disconnect(); return; }
    fit();
    sync();
  };
  const ro = new ResizeObserver(() => sync());
  ro.observe(gb);
  addEventListener('resize', resized);
  fit();
  box.scrollLeft = box.scrollWidth;
  sync();
}

export { gradesTab };
