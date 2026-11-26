// The live table's parts: status and integrity cells, menus, dialogs before letting someone in, the projector,
// corrections, and the clocks that tick between polls.

import { dash } from './state.js';
import { ICONS, LABEL, h, icon, mmss, plural, post, root, tip } from './core.js';
import { admitChecked, checkWhy } from './ai.js';
import { showRun } from './run.js';

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
  // a sign-in that looks off (another student's browser, a new network): says so, and why on hover, before Start
  if (a.status === 'waiting' && a.checks && a.checks.length) {
    const what = h('span', { class: 'st-waiting t-check-head', tabindex: '0' }, icon(ICONS.warn, 15), a.ready ? 'Check first' : 'Reading the rules');
    return h('td', { class: 't-check-first' }, tip(h('span', { class: 't-tip-host' }, what), what,
      `${a.checks.map(checkWhy).join('. ')}. Check it's really them, at their own computer, before you start them.`));
  }
  if (a.status === 'waiting') return a.ready ? h('td', { class: 'st-good', text: 'Ready' }) : h('td', { class: 'st-waiting', text: 'Reading the rules' });
  if (a.status === 'admitted') return h('td', { text: 'Starting' });
  // a heartbeat every few seconds; much longer without one and they've lost their connection
  if (a.status === 'active') return a.lastBeatAgo > 15000 ? h('td', { class: 't-late', text: `No signal for ${mmss(a.lastBeatAgo)}` }) : h('td', { text: a.paused ? 'Paused' : 'In progress' });
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
      tip(h('label', { class: 't-check', for: 't-corr-why' }, why, h('span', { text: 'Ask what went wrong' })), why,
        "Students also write what went wrong on each question they fix. You can read it in their report."),
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
  const act = a.status === 'active' && !dirs && !a.paused ? a.activity : null; // paused: nobody's doing anything
  const at = a.on === 'review' ? 'the review' : a.on ? `question ${a.on}` : null;
  const on = a.paused ? 'paused' : dirs ? 'reading directions' : !act || !at ? null
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
// Less-used actions behind a ⋯ button: a row's, a quiz's, the live quiz's. items: { text, onclick, danger, tip }
// or an element (a link, say; its tip in data-tip), or a function that gives them, asked each time it opens.
// A tip shows beside its item, so it doesn't cover the next one. The live table
// doesn't redraw while one is open (menuOpen), so it stays put; onClose catches it up.
dash.menuOpen = false;
dash.quizFind = ''; // the Quizzes tab's search, kept while it redraws
dash.liveSort = null; // the live table's column sort: { by, dir }
const STATUS_RANK = { waiting: 1, admitted: 2, active: 3, submitted: 4 };
const INTEGRITY_RANK = { invalidated: 0, restored: 1, clean: 2 };
const LIVE_SORT = {
  Student: (s) => s.name,
  Status: (s) => (s.attempt ? STATUS_RANK[s.attempt.status] || 0 : null),
  Integrity: (s) => (s.attempt ? INTEGRITY_RANK[s.attempt.integrity] ?? 3 : null),
  Strikes: (s) => (s.attempt ? s.attempt.strikes : null),
  Progress: (s) => (s.attempt && s.attempt.total ? s.attempt.answered / s.attempt.total : null),
  'Time left': (s) => (s.attempt && s.attempt.timeLeft != null ? s.attempt.timeLeft : null),
  Score: (s) => (s.attempt && s.attempt.score != null && s.attempt.max ? s.attempt.score / s.attempt.max : null),
};
// opts.text: a button with that text and a chevron (the account menu) instead of ⋯.
function moreMenu(label, key, items, onClose, opts) {
  const named = opts && opts.text;
  const btn = named
    ? h('button', { class: 'btn small t-menu-btn t-menu-named', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, 'data-key': key }, h('span', { class: 't-menu-name', text: opts.text }), icon(ICONS.chevron, 16))
    : h('button', { class: 'btn small t-menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: 'More', 'data-key': key }, icon(ICONS.dots, 18));
  const menu = h('div', { class: 't-menu', popover: 'manual', role: 'menu', 'aria-label': label });
  const tipped = (el, text) => tip(h('div', { role: 'none', class: 't-menu-tip' }, el), el, text, true);
  const fill = (list) => menu.replaceChildren(...list.filter(Boolean).map((it) => {
    if (it.nodeType) {
      it.classList.remove('btn', 'small', 'primary');
      it.classList.add('t-menu-item');
      it.removeAttribute('style');
      it.setAttribute('role', 'menuitem');
      if (!it.dataset.inMenu) { it.dataset.inMenu = '1'; it.addEventListener('click', () => close(false)); }
      if (it.dataset.tip) { if (it.tipHost) tip.text(it, it.dataset.tip); else it.tipHost = tipped(it, it.dataset.tip); } // made once: the element stays
      return it.tipHost || it;
    }
    const b = h('button', { class: 't-menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', text: it.text, onclick: () => { close(true); it.onclick(); } });
    return it.tip ? tipped(b, it.tip) : b;
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
    dash.menuOpen = false;
    if (onClose) onClose();
  }
  function open() {
    if (typeof items === 'function') fill(items());
    if (!entries().length) return;
    menu.showPopover();
    isOpen = true;
    dash.menuOpen = true;
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
    else if (el.dataset.tick === 'since') el.textContent = mmss(now - at);
  }
}

function drawTrail(canvas, pts) {
  const css = getComputedStyle(document.documentElement);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const hh = canvas.height;
  ctx.clearRect(0, 0, w, hh); // see-through: the box's background follows light and dark (teacher.css)
  if (pts.length < 2) return;
  ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#2257d6';
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const px = (x / 1000) * w; const py = (y / 1000) * hh; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export { CHATS, KEY_PAGES, LIVE_SORT, beforeAdmit, browserName, correctionsDialog, drawTrail, gone, grading, integrityCell, moreMenu, phone, progressCell, projector, statusCell, strikesCell, tick, ticks, watchLink };
