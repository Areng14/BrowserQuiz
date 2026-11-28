// One running quiz: its live table, and everything a teacher does from it.

import { dash } from './state.js';
import { actionsHead, api, ask, clock, EVENT_TIP, glyph, h, icon, iconButton, ICONS, LABEL, labeled, mmss, mount, plural, post, root, scoreText, sortHeads, sortRows, timeZone, tip } from './core.js';
import { noteRuns, sebButtons, setHash, shell } from './home.js';
import { LIVE_SORT, beforeAdmit, browserName, correctionsDialog, drawTrail, gone, grading, integrityCell, moreMenu, phone, progressCell, projector, statusCell, strikesCell, tick, ticks, watchLink } from './cells.js';
import { aiDialog, checkWhy } from './ai.js';
import { POINTS_TIP, livePoints, showGrade } from './grade.js';

async function showRun(runId) {
  setHash('#run/' + encodeURIComponent(runId));
  dash.menuOpen = false; // a menu left open on the page before went with it
  ++dash.navSeq;
  dash.selected = null;
  // The join code: click it to show it big, for a projector
  const code = h('button', { class: 't-joincode', type: 'button', title: 'Show it big' });
  code.addEventListener('click', () => projector(code.textContent, title.textContent, lastRun && lastRun.joinUrl));
  const title = h('h1');
  const meta = h('p', { class: 't-muted' });
  const tbody = h('tbody');
  const detail = h('div');
  const toggle = h('button', { class: 'btn', type: 'button' });
  // a fire drill, a question for the whole class: every clock stops and the questions are hidden, at once
  const pauseBtn = iconButton(h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => act(`/api/t/runs/${runId}/pause`) }), 'pause', 'Pause quiz',
    "Every student's clock stops and the questions are hidden until you resume. Leaving the quiz while it's paused doesn't count.");
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
      // the button turns off once nobody's waiting: keep keyboard focus in the table, not lost on the page
      const lost = !document.activeElement || document.activeElement === document.body || document.activeElement === admitAll;
      const first = tbody.querySelector('.t-rowhead .t-link');
      if (admitAll.disabled && lost && first) first.focus({ preventScroll: true });
    }, waitingFlagged.slice(), waitingReading);
  } });
  // AI grading: everything waiting for the teacher in this run, sent to Claude (server: aigrade.js).
  const aiBtn = h('button', { class: 'btn', type: 'button', hidden: true });
  // Answers waiting for the teacher: graded one question at a time, across the class (showGrade)
  const gradeBtn = h('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => showGrade(runId) });
  const aiMsg = h('p', { class: 't-small t-muted', role: 'status', hidden: true });
  let aiWaiting = 0;
  const aiDone = (text) => { if (text) { aiMsg.hidden = false; aiMsg.className = 't-small t-muted'; aiMsg.textContent = text; } lastDetail = ''; refresh(); };
  aiBtn.addEventListener('click', () => aiDialog(runId, null, aiDone));
  // Read out when the counts change, not on every 2-second refresh.
  const summary = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  // a spreadsheet of the grades, its times in this computer's time zone
  const tz = timeZone() || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })(); // Settings' time zone, or this browser's
  const exportLink = h('a', { class: 'btn', href: `/api/t/runs/${runId}/export.csv${tz ? '?tz=' + encodeURIComponent(tz) : ''}`, download: true, text: 'Download grades' });
  const classReport = h('a', { class: 'btn', href: `/teacher/report.html?run=${encodeURIComponent(runId)}`, target: '_blank', rel: 'noopener', text: 'Class report' });
  for (const a of [exportLink, classReport]) {
    a.style.display = 'inline-flex';
    a.style.alignItems = 'center';
    a.style.textDecoration = 'none';
  }

  // What the less obvious actions do (shown on hover, beside the menu)
  const LET_IN = "For 10 minutes, the student can sign in again on any computer and continue with the same answers and clock.";
  const INVALIDATE = "Their score counts as 0. They can keep working and aren't told. Un-invalidate restores the score.";
  async function act(path, body) {
    try { await post(path, body); } catch (e) { alertBox(e.message); }
    return refresh();
  }
  // Column headers that sort the table (kept while the page is open, and across quizzes)
  const LIVE_COLS = ['Student', 'Status', 'Integrity', 'Strikes', 'Progress', 'Time left', 'Score'];
  const LIVE_NUMS = ['Strikes', 'Progress', 'Time left', 'Score'];
  const liveHead = h('tr', {});
  const LIVE_TIPS = {
    Status: "Ready means the student agreed to the rules and is waiting for you to start them. Check first means something about their sign-in looks off, written under it, so look before you start them. No signal means their computer stopped checking in.",
    Integrity: "Invalidated means the student left the quiz or you invalidated it, and Restored means you un-invalidated it. Otherwise it's Clean. Students aren't told.",
    Strikes: "The number of times the student left the quiz for another tab, window or app, and their total time away.",
    Progress: "Questions answered out of the total. The bar is green if they answered in the last 30 seconds, blue while they're reading, and gray after 2 minutes idle.",
  };
  // Score only when there can be one: an open exam keeps scores from the teacher's screen (teacher/common.js
  // sealed), so not until it's closed; practice once someone has turned in
  let showScore = false;
  const liveCols = () => (showScore ? LIVE_COLS : LIVE_COLS.filter((c) => c !== 'Score'));
  const drawLiveHead = () => liveHead.replaceChildren(...sortHeads(liveCols(), LIVE_NUMS, dash.liveSort, (next) => {
    dash.liveSort = next;
    drawLiveHead();
    const b = liveHead.querySelector(`th:nth-child(${LIVE_COLS.indexOf((next || { by: '' }).by) + 1}) .t-sort`);
    (b || liveHead.querySelector('.t-sort')).focus();
    refresh();
  }, LIVE_TIPS), actionsHead());
  drawLiveHead();
  // Paused (the run's ⋯ menu): a bar across the top, how long it's been, and the way back
  const pausedFor = h('span', { class: 't-paused-for' });
  const resumeBtn = labeled(h('button', { class: 'btn primary', type: 'button', onclick: () => act(`/api/t/runs/${runId}/resume`) }), 'play', 'Resume quiz');
  // (not a live region: its clock ticks; the summary below says "3 paused")
  const pausedBar = h('div', { class: 't-paused', hidden: true },
    h('span', { class: 't-paused-what' }, glyph('pause', 18), h('span', { class: 't-paused-line' }, 'Quiz paused', pausedFor)), resumeBtn);
  function alertBox(msg) { detail.prepend(h('p', { class: 't-error', text: msg })); }
  // How much more time (for one student, or everyone still working): 5 minutes unless they say otherwise.
  // "10 min" counts as 10; anything else asks again, with what was typed still there.
  async function askMinutes(title) {
    let value = '5';
    let text = null;
    for (;;) {
      const v = await ask.ask({ title, text, label: 'Minutes', value, ok: 'Add time' });
      if (v == null) return null;
      const mins = Math.round(parseFloat(v));
      if (mins >= 1 && mins <= 120) return mins;
      value = v;
      text = 'Add 1 to 120 minutes.';
    }
  }
  // Ends one student's quiz: their answers are turned in and they see "Your teacher ended your quiz".
  async function unInvalidate(id, name) {
    if (await ask.confirm({ title: `Un-invalidate ${name}?`, ok: 'Un-invalidate' })) act(`/api/t/attempts/${id}/restore`);
  }
  async function invalidate(id, name) {
    const note = await ask.ask({ title: `Invalidate ${name}?`, text: INVALIDATE, label: 'Reason (optional)', max: 300, ok: 'Invalidate', danger: true });
    if (note !== null) act(`/api/t/attempts/${id}/invalidate`, { note });
  }
  // A message to one student: it pops up on their screen at their next heartbeat.
  async function messageStudent(id, name) {
    const text = await ask.ask({ title: `Message ${name}`, label: 'Message', max: 500, ok: 'Send' });
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

  // false: the run isn't there (deleted, here or in another tab, or an old link), and the page says so
  async function refresh() {
    let data;
    try { data = await api(`/api/t/runs/${runId}/live`); } catch (e) {
      if (!['not_found', 'bad_request'].includes(e.code) || !tbody.isConnected) return true;
      mount(shell('recent', h('section', { class: 't-section' }, h('p', { class: 't-error', text: e.message }))));
      return false;
    }
    const run = data.run;
    lastRun = run;
    const scores = run.status !== 'open' || (run.practice && data.students.some((x) => x.attempt && x.attempt.status === 'submitted'));
    if (scores !== showScore) { showScore = scores; drawLiveHead(); }
    // paused: the bar, and every row still working says so
    const paused = run.status === 'open' && run.pausedMs != null;
    if (pausedBar.hidden === paused) {
      pausedBar.hidden = !paused;
      // focus follows: from Pause to Resume, and back
      if (paused && document.activeElement === pauseBtn) requestAnimationFrame(() => resumeBtn.focus({ preventScroll: true }));
      if (!paused && document.activeElement === resumeBtn) requestAnimationFrame(() => pauseBtn.focus({ preventScroll: true }));
    }
    if (paused) { pausedFor.dataset.tick = 'since'; pausedFor.dataset.at = String(Date.now() - run.pausedMs); pausedFor.textContent = mmss(run.pausedMs); } else delete pausedFor.dataset.tick;
    for (const x of data.students) if (x.attempt && x.attempt.status === 'active') x.attempt.paused = paused;
    notice(data.students);
    // on the row: Announce while it's open; Corrections once an exam is closed (just once)
    corrHost.hidden = corrBtn.hidden = run.practice || !!run.corrections || run.status === 'open';
    msgBtn.hidden = run.status !== 'open';
    code.textContent = run.code;
    document.title = `${run.code} - ${run.title} - BrowserQuiz`;
    const count = (f) => data.students.filter((x) => x.attempt && f(x.attempt)).length;
    const said = [[count((a) => a.status === 'waiting' && a.ready && !gone(a)), 'ready'], [count((a) => a.status === 'waiting' && !a.ready && !gone(a)), 'reading the rules'], [count((a) => a.status === 'admitted' && !gone(a)), 'starting'], [count(gone), 'no signal'], [count((a) => a.status === 'active'), paused ? 'paused' : 'working'],
      [count((a) => a.status === 'submitted'), 'turned in'], [count((a) => a.integrity === 'invalidated'), 'invalidated']]
      .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ') || 'Nobody has joined yet';
    if (summary.textContent !== said) summary.textContent = said;
    waitingIds = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting').map((x) => x.attempt.id);
    waitingFlagged = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting' && x.attempt.checks).map((x) => ({ name: x.name, checks: x.attempt.checks }));
    waitingReading = data.students.filter((x) => x.attempt && x.attempt.status === 'waiting' && !x.attempt.ready).length;
    // stays in its place, off while nobody's waiting, so the bar doesn't shift; gone once the quiz is closed
    admitAll.hidden = run.status !== 'open';
    admitAll.disabled = !waitingIds.length;
    // before anyone's started it starts the quiz; after, it starts the students who came late, and each
    // late student's row has its own Start
    begun = count((a) => a.status === 'admitted' || a.status === 'active' || a.status === 'submitted') > 0;
    labeled(admitAll, 'play', begun ? 'Start everyone waiting' : 'Start quiz');
    // Grade with AI: shown while there's something waiting for the teacher, or while it runs.
    aiWaiting = data.students.reduce((n, x) => n + (x.attempt && x.attempt.status === 'submitted' ? x.attempt.review || 0 : 0), 0);
    gradeBtn.hidden = !aiWaiting;
    labeled(gradeBtn, 'check', `Grade ${plural(aiWaiting, 'answer')}`);
    const job = data.ai && data.ai.job;
    if (job && job.running) {
      aiBtn.hidden = false; aiBtn.disabled = true;
      labeled(aiBtn, 'spark', `Grading with AI… ${job.graded + job.failed} of ${job.total}`);
    } else {
      aiBtn.hidden = !aiWaiting; aiBtn.disabled = false;
      labeled(aiBtn, 'spark', 'Grade with AI');
    }
    if (job && !job.running) {
      aiMsg.hidden = false;
      aiMsg.className = job.failed ? 't-small t-error' : 't-small t-muted';
      aiMsg.textContent = `AI graded ${plural(job.graded, 'answer')}${job.failed ? `; ${job.failed} didn't work: ${job.errors.join(' ')}` : '.'}`;
    }
    // This run's place in the Open tab.
    if (dash.openRuns && (run.status === 'open') !== dash.openRuns.some((r) => r.id === runId)) {
      api('/api/t/overview').then((o) => {
        noteRuns(o.runs);
        const nav = root.querySelector('.t-side');
        const cur = dash.openRuns.some((r) => r.id === runId);
        if (nav && root.contains(tbody)) nav.replaceWith(shell(cur ? 'open' : ['grades', 'recent'].includes(dash.tab) ? dash.tab : 'give').querySelector('.t-side'));
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
    if (run.sebQuit && !quitPw.childNodes.length) quitPw.append('SEB quit password: ', h('code', { class: 't-temp t-reveal', tabindex: '0', title: 'Hover to show', text: run.sebQuit }));
    if (run.sebFile && !sebParts) sebParts = sebButtons(run.code, run.joinUrl);
    labeled(toggle, run.status === 'open' ? 'stop' : 'reopen', run.status === 'open' ? 'Close quiz' : 'Reopen quiz');
    toggle.classList.toggle('outline-danger', run.status === 'open'); // closing turns everyone in: red, like its confirm
    pauseBtn.hidden = run.status !== 'open' || run.pausedMs != null;
    toggle.onclick = async () => {
      if (run.status === 'open' && !(await ask.confirm({ title: 'Close the quiz?', text: 'Anyone still working gets turned in.', ok: 'Close quiz', danger: true }))) return;
      act(`/api/t/runs/${runId}/${run.status === 'open' ? 'close' : 'open'}`);
    };
    lockBtn.textContent = run.ipLock ? 'Network lock: on' : 'Network lock: off';
    lockBtn.dataset.tip = run.ipLock ? "Only students on your network, or on a network a student has already used in this quiz, can join."
      : "Students can join from any network. Turning the lock on limits joining to your network and the networks students have already used in this quiz.";
    lockBtn.onclick = () => act(`/api/t/runs/${runId}/${run.ipLock ? 'unlock' : 'lock'}`);
    const failed = data.students.filter((x) => x.attempt && x.attempt.failed).length;
    failedBox.replaceChildren(failed ? h('p', { class: 't-error' }, `Code grading failed for ${plural(failed, 'student')}. `,
      h('button', { class: 'btn small', type: 'button', text: 'Retry now', onclick: () => act(`/api/t/runs/${runId}/regrade-failed`) })) : '');
    const order = (s) => (s.attempt ? (s.attempt.integrity === 'invalidated' || s.attempt.leftAgain ? 0 : s.attempt.status === 'waiting' ? 1 : 2) : 3);
    // the teacher's sort (a column header), else flagged first, then waiting, then everyone else
    const rows = sortRows(data.students.slice().sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name)), dash.liveSort, LIVE_SORT, (s) => s.name);
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    // not while a menu is open, or a row's tip is being read (a redraw would take it away)
    const reading = !!tbody.querySelector('.t-tip-host:hover, .t-tip-host:focus-within');
    if (!dash.menuOpen && !reading) tbody.replaceChildren(...rows.map((s) => {
      const a = s.attempt;
      const actions = h('td', { class: 't-actions' });
      const btn = (text, key, onclick, extra) => h('button', Object.assign({ class: 'btn small', type: 'button', text, onclick, 'data-key': `${a.id}:${key}`, 'aria-label': `${text} ${s.name}` }, extra || {}));
      // In the row: what needs deciding now. The rest is under ⋯.
      const more = [];
      const bad = a && a.integrity === 'invalidated';
      // late and flagged: they wait for the teacher (the rest go straight in once it's begun: student.js /api/ready)
      if (a && a.status === 'waiting' && begun && a.checks) actions.append(btn('Start', 'admit', () => beforeAdmit(runId, 1, s.name, () => act(`/api/t/attempts/${a.id}/admit`), a.checks ? [{ name: s.name, checks: a.checks }] : [], a.ready ? 0 : 1), { class: 'btn small primary' }));
      if (bad) actions.append(btn('Un-invalidate', 'restore', () => unInvalidate(a.id, s.name)));
      // Flagged and still working: ending their quiz is one click away (never automatic, so a stray
      // popup doesn't end anyone's quiz without the teacher looking).
      if (bad && a.status === 'active') actions.append(btn('End quiz', 'end', () => endQuiz(a.id, s.name), { class: 'btn small outline-danger' }));
      // Practice and corrections aren't monitored: no watching, network pins or invalidating there.
      const sec = !(lastRun && lastRun.practice);
      // Their screen, live, in a new tab (watch.html).
      if (sec && a && a.status === 'active') (bad ? more.push(watchLink(a.id, s.name)) : actions.append(watchLink(a.id, s.name)));
      if (a && a.status === 'active' && a.deadline) more.push({ text: 'Add time', onclick: async () => { const mins = await askMinutes(`Add time for ${s.name}`); if (mins) act(`/api/t/attempts/${a.id}/extend`, { minutes: mins }); } });
      if (a && a.status !== 'submitted') more.push({ text: 'Message', onclick: () => messageStudent(a.id, s.name) });
      if (sec && a && (a.status === 'active' || a.status === 'admitted') && !a.letIn) more.push({ text: 'Let back in', tip: LET_IN, onclick: () => act(`/api/t/attempts/${a.id}/let-in`) });
      if (a && (a.status === 'active' || a.status === 'admitted') && a.letIn) actions.append(h('span', { class: 't-muted t-small', text: 'Can sign in again' }));
      if (a) more.push({ text: 'Reset', danger: true, onclick: () => resetAttempt(a.id, s.name) });
      if (more.length) actions.append(...moreMenu(`More for ${s.name}`, `${a.id}:more`, more, () => refresh()));
      // On a phone a row shows only what needs doing now (Admit, End quiz); the rest is one tap away, on the student.
      for (const b of actions.children) if (!/:(admit|end)$/.test(b.dataset.key || '')) b.classList.add('t-row-extra');
      if (![...actions.children].some((b) => !b.classList.contains('t-row-extra'))) actions.classList.add('t-only-extra');
      let score = '';
      if (a && a.score != null) {
        score = scoreText(a.score, a.max);
        if (a.pending) score += ' (grading)';
        else if (a.failed) score += ' (grading failed)';
        else if (a.review) score += ' (needs review)';
        if (a.corrections) score += `, total ${a.corrections.final} / ${a.corrections.max}`; // exam, plus what corrections earned back
      }
      const open = () => { dash.selected = a.id; lastDetail = ''; showDetail(a.id); refresh(); };
      return h('tr', { class: dash.selected === (a && a.id) ? 'sel' : null, onclick: a ? (e) => { if (!e.target.closest('a, button, input') && phone()) open(); } : null },
        h('td', { role: 'rowheader', class: 't-rowhead t-name' }, a ? h('button', { class: 't-link', type: 'button', text: s.name, title: s.name, 'data-key': `${a.id}:name`, 'aria-expanded': String(dash.selected === a.id), onclick: open }) : h('span', { title: s.name, text: s.name })),
        statusCell(s), integrityCell(a),
        strikesCell(a),
        progressCell(a),
        // extra time (the class's settings) shows next to the clock, and on it in words for screen readers
        h('td', { class: 'num', 'data-label': 'Time left', title: s.timeX && !(a && a.status === 'submitted') ? `${s.timeX}× time` : null },
          h('span', Object.assign({ text: a && a.timeLeft != null ? mmss(a.timeLeft) : '' }, a && a.timeLeft != null && a.status === 'active' && !a.paused ? ticks('left', a.timeLeft) : {})),
          s.timeX && !(a && a.status === 'submitted') ? h('span', { class: 't-muted t-xtime', text: ` ${s.timeX}×`, 'aria-label': `, ${s.timeX} times the time` }) : null),
        showScore ? h('td', { class: 'num' + (a && (a.failed || a.review) ? ' st-waiting' : ''), 'data-label': 'Score', text: score }) : null,
        actions);
    }));
    // Keep keyboard focus on the same button after the redraw, without scrolling the page back to it. If
    // that button is gone (say, Admit after admitting), go to the next Admit, or to the student's name.
    if (focusKey && !dash.menuOpen) {
      const [fid, what] = focusKey.split(':');
      const again = tbody.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)
        || (what === 'admit' && (tbody.querySelector('[data-key$=":admit"]') || (admitAll.isConnected && admitAll)))
        || tbody.querySelector(`[data-key="${CSS.escape(fid)}:name"]`);
      if (again) again.focus({ preventScroll: true });
    }
    if (dash.selected && !dash.menuOpen) showDetail(dash.selected, true);
  }

  async function showDetail(id, quiet) {
    let d;
    try { d = await api(`/api/t/attempts/${id}`); } catch (e) { return; }
    if (dash.selected !== id) return;
    // The poll re-renders every 2s: don't wipe what the teacher is typing, selecting, reading or has open.
    const snapshot = JSON.stringify(Object.assign({}, d, { timeLeft: null, awayMs: null, awayMax: null })); // clocks that tick: not a reason to redraw
    const typing = detail.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
    if (quiet && (snapshot === lastDetail || typing || dash.menuOpen || String(window.getSelection() || '') !== '')) return;
    lastDetail = snapshot;
    const keep = detail.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    const dk = (key) => ({ 'data-key': `detail:${key}` });
    // an entry's name, and what it means when the name doesn't say: the newest of each kind is a tab stop
    const tabbed = new Set();
    const eventName = (e) => {
      if (!EVENT_TIP[e.type]) return h('b', { text: LABEL[e.type] || e.type });
      const b = h('b', { class: 't-term', text: LABEL[e.type] || e.type });
      if (!tabbed.has(e.type)) { tabbed.add(e.type); b.tabIndex = 0; }
      return tip(h('span', { class: 't-event-name' }, b), b, EVENT_TIP[e.type]);
    };
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
      dash.selected = null;
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
        d.status === 'active' ? h('button', Object.assign({ class: 'btn small outline-danger', type: 'button', text: 'End quiz', onclick: () => endQuiz(id, d.name) }, dk('end'))) : null,
        d.status === 'active' && d.deadline ? h('span', Object.assign({ class: 't-muted t-small', text: `${mmss(d.timeLeft || 0)} left` }, d.paused ? {} : ticks('left-label', d.timeLeft || 0))) : null,
        d.timeX ? h('span', { class: 't-muted t-small', text: `${d.timeX}× time` }) : null,
        d.status === 'submitted' && !d.sealed ? h('a', { class: 'btn small', href: `/teacher/report.html?attempt=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', text: 'Report', style: 'display:inline-flex;align-items:center;text-decoration:none' }) : null,
        d.status === 'submitted' && d.totals && d.totals.review ? h('button', Object.assign({ class: 'btn small', type: 'button', text: 'Grade with AI', title: 'Send the answers waiting for you to Claude. Names and IDs stay here.',
          onclick: () => aiDialog(runId, id, aiDone) }, dk('ai'))) : null,
        moreMenu(`More for ${d.name}`, 'detail:more', [
          d.status === 'active' && d.deadline ? { text: 'Add time', onclick: async () => { const mins = await askMinutes(`Add time for ${d.name}`); if (mins) { lastDetail = ''; act(`/api/t/attempts/${id}/extend`, { minutes: mins }); } } } : null,
          d.status !== 'submitted' ? { text: 'Message', onclick: () => messageStudent(id, d.name) } : null,
          d.integrity !== 'invalidated' && !(lastRun && lastRun.practice) ? { text: 'Invalidate', tip: INVALIDATE, onclick: () => invalidate(id, d.name) } : null,
          d.status === 'submitted' && !d.sealed ? { text: 'Regrade', tip: "Grades their answers again against the current version of the quiz. Points you set by hand and rubric items you ticked are kept.", onclick: () => act(`/api/t/attempts/${id}/regrade`) } : null,
          (d.status === 'active' || d.status === 'admitted') && !(lastRun && lastRun.practice) ? { text: 'Let back in', tip: LET_IN, onclick: () => act(`/api/t/attempts/${id}/let-in`) } : null,
          { text: 'Reset', danger: true, onclick: () => resetAttempt(id, d.name, closeDetail) },
        ], () => refresh())),
      d.integrity === 'invalidated' ? h('p', { class: 'st-bad', text: `Invalidated at ${clock(d.invalidatedAt)}: ${(LABEL[d.reason] || d.reason || '').toLowerCase()}` }) : null,
      d.strikes ? h('p', { class: 't-small t-away', text: `Left ${d.strikes === 1 ? 'once' : d.strikes + ' times'}. Away ${mmss(d.awayMs)} in all${d.strikes > 1 ? `, ${mmss(d.awayMax)} at the longest` : ''}.` }) : null,
      h('div', { class: 't-detail-grid' },
        h('div', { class: 't-section' }, h('h3', { text: 'Activity' }),
          h('ul', { class: 't-events' }, d.events.map((e) => h('li', { class: e.severity }, h('time', { text: clock(e.t) }), h('span', {}, eventName(e), e.detail ? h('span', { class: 't-muted', text: ` ${e.detail}` }) : null))))),
        h('div', { class: 't-section' }, h('h3', { text: 'Mouse trail' }), canvas,
          d.userAgent ? h('p', { class: 't-muted t-small', title: d.userAgent, text: browserName(d.userAgent) }) : null)),
      h('div', { class: 't-section' }, h('h3', { text: d.sealed ? 'Answers' : d.totals ? `Answers (${scoreText(d.totals.score, d.totals.max)}${d.totals.pending ? ', code still grading' : d.totals.failed ? ', grading failed' : d.totals.review ? ', needs review' : ''})` : 'Answers so far' }), answers)));
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
    const over = h('input', { class: 'input t-points', type: 'number', min: '0', max: String(x.max), step: '0.5', id: `ov-${x.id}`, value: x.overridePoints != null ? String(x.overridePoints) : '' });
    if (boxes.length) livePoints(over, boxes, x); else over.placeholder = 'auto';
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
    if (boxes.length) tip(pointsRow, over, POINTS_TIP);
    if (!boxes.length) {
      // Most answers never need this: keep it folded away unless it's in use.
      return h('details', { class: 't-adjust', open: x.overridePoints != null }, h('summary', { class: 't-small', text: 'Adjust points' }), pointsRow);
    }
    return h('div', { class: 't-grade' },
      h('div', { class: 't-rubric' }, h('p', { class: 't-small', text: 'Rubric' }), boxes.map((b) => b.el)),
      pointsRow);
  }

  const corrBtn = labeled(h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => correctionsDialog(runId, lastRun) }), 'pencil', 'Corrections');
  const corrHost = tip(h('span', { class: 't-tip-host' }, corrBtn), corrBtn, "Students redo the questions they lost points on, without lockdown. Each fixed answer earns back part of the points it lost.");

  // Notifications: a strike, an invalidation, or a sign-in to look at, as it happens. On this page always
  // (a toast; clicking it opens the student). As the computer's own notification too, and a buzz on a
  // phone, once the teacher turns them on (⋯ menu), for when this tab isn't in front.
  const toasts = h('div', { class: 't-toasts', 'aria-live': 'polite' });
  const openStudent = (id) => { dash.selected = id; lastDetail = ''; showDetail(id); refresh(); };
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
  // Start, Announce, Pause, Corrections and Close quiz stay out; the rest is under ⋯.
  // A message to everyone taking the quiz: it pops up on their screens at the next heartbeat.
  const msgBtn = labeled(h('button', { class: 'btn', type: 'button' }), 'megaphone', 'Announce');
  msgBtn.addEventListener('click', async () => {
    const text = await ask.ask({ title: 'Announce', label: 'Announcement', max: 500, ok: 'Send' }); // what students are shown at most (teacher/runs.js)
    if (text == null || !text.trim()) return;
    try { await post(`/api/t/runs/${runId}/message`, { text }); } catch (e) { alertBox(e.message); }
  });
  const runMenu = moreMenu('More for this quiz', 'run:more', () => [
    // a fire drill, the wifi down, a late start: everyone still working gets the same
    lastRun && lastRun.status === 'open' && lastRun.timeLimitMin ? { text: 'Add time for everyone', onclick: async () => {
      const mins = await askMinutes('Add time for everyone');
      if (mins) act(`/api/t/runs/${lastRun.id}/extend`, { minutes: mins });
    } } : null,
    lastRun && !aiWaiting && lastRun.byHand && (lastRun.status !== 'open' || lastRun.practice) ? { text: 'Grade by question', onclick: () => showGrade(runId) } : null,
    lockBtn, notifyBtn,
    ...(lastRun && lastRun.sebFile && lastRun.status === 'open' && sebParts ? sebParts : []),
    // results (export, class report) once an exam is closed: while it's open it's proctoring only
    ...(lastRun && !lastRun.practice && lastRun.status === 'open' ? [] : [exportLink, classReport])], () => refresh());
  detail.className = 't-detail-host';
  detail.setAttribute('aria-labelledby', 't-detail-name');
  if (dash.openRuns === null) { try { noteRuns((await api('/api/t/overview')).runs); } catch (e) { /* the tab can wait */ } }
  const isOpen = dash.openRuns && dash.openRuns.some((r) => r.id === runId);
  mount(shell(isOpen ? 'open' : ['grades', 'recent'].includes(dash.tab) ? dash.tab : 'give',
      pausedBar,
      h('section', { class: 't-section' },
        h('div', { class: 't-code' }, code, h('div', {}, title, meta)),
        howTo, quitPw,
        h('div', { class: 't-row t-run-acts' }, admitAll, gradeBtn, aiBtn, msgBtn, pauseBtn, corrHost, toggle, runMenu), aiMsg,
        failedBox, summary, toasts),
      h('div', { class: 't-livegrid' }, h('div', { class: 't-table-wrap' }, h('table', { class: 't-table t-run' },
        h('thead', {}, liveHead),
        tbody)),
      detail)));
  if ((await refresh()) === false) return;
  dash.pollTimer = setInterval(refresh, 2000);
  dash.tickTimer = setInterval(tick, 1000);
}

export { showRun };
