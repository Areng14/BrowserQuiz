// Before the quiz: join, name, waiting to be let in, the rules, the start screen.

import { BQ, CODE_ALPHABET, ERRORS, PARTS, S, api, cfg, resetState } from './state.js';
import { demoHint, enterFullscreen, errorText, exitFullscreen, h, keysHeld, mount, plural, toast } from './dom.js';
import { icon, isDark, svgEl, themeButton } from './theme.js';
import { loadMonaco } from './monaco.js';
import { onBeat, onBeatError, partsFor, restoreAnswers, serializeAnswers, takeUnsent } from './answers.js';
import { screenQuiz } from './quiz.js';
import { loadScratch } from './scratch.js';
import { loadMarks, marksIn, mdOpts } from './marks.js';
import { phoneSized } from './code.js';
import { hideFsOverlay, screenClosed, showFsOverlay, showLeftWarning, signedOut } from './overlays.js';
import { confetti } from './done.js';

// ---------- entry screens ----------
function entry(...kids) {
  return h('main', { class: 'screen center' }, h('div', { class: 'corner' }, themeButton()), ...kids);
}

// code: from the address (?code=), as Safe Exam Browser opens it; joins straight away.
function screenJoin(err, code) {
  const input = h('input', {
    id: 'join-code', class: 'input code-input', autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'characters',
  });
  // Cut to 6 after the spaces and dashes go, not before: a pasted " K7QX4M" or "K7Q-X4M" keeps its last letter
  // (a maxlength would cut the paste first).
  input.addEventListener('input', () => {
    const v = input.value.toUpperCase().replace(CODE_ALPHABET, '').slice(0, 6);
    if (v !== input.value) input.value = v;
  });
  const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
  const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Join' });
  const form = h('form', { class: 'panel', novalidate: true },
    h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
    h('div', { class: 'heading' }, h('h1', { text: 'Join your quiz' })),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'join-code', text: 'Join code' }), input),
    btn, msg,
    demoHint('Demo code: ', h('b', { text: 'K7QX4M' })));
  // Where the project lives; only here, before any quiz.
  const ghIcon = svgEl('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' });
  ghIcon.append(svgEl('path', { d: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z' })); // GitHub's mark (Primer Octicons, MIT)
  const gh = h('a', { class: 'site-link', href: 'https://github.com/Areng14/BrowserQuiz', target: '_blank', rel: 'noopener' }, ghIcon, 'GitHub');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value.length !== 6) { msg.textContent = 'Join codes are 6 characters.'; input.focus(); return; }
    btn.disabled = true; btn.textContent = 'Joining…'; msg.textContent = '';
    try {
      S.run = await api.join(input.value);
      screenWho();
    } catch (ex) {
      if (ex && ex.code === 'seb_launch') { screenSebLaunch(input.value); return; }
      msg.textContent = errorText(ex);
      btn.disabled = false; btn.textContent = 'Join';
      input.focus();
    }
  });
  mount(entry(form, gh));
  input.focus();
  code = String(code || '').toUpperCase().replace(CODE_ALPHABET, '');
  if (code.length === 6 && !err) { input.value = code; btn.click(); }
}

// A quiz that needs Safe Exam Browser: the seb:// (sebs:// on https) link starts SEB with the quiz's settings.
function screenSebLaunch(code) {
  // The dark or light mode they picked goes along: SEB is a browser of its own, without this one's storage.
  // SEB adds what follows "??" to the quiz's start page (seb.js).
  // Made on the click, in case they switch it on this screen.
  const link = () => {
    const theme = document.documentElement.dataset.theme;
    return `${location.protocol === 'https:' ? 'sebs' : 'seb'}://${location.host}/api/seb/${code}.seb${theme === 'dark' || theme === 'light' ? `??theme=${theme}` : ''}`;
  };
  // iPads say they're Macs; a touch screen gives them away. SEB for them comes from the App Store.
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const open = h('a', { class: 'btn primary', href: link(), text: 'Open Safe Exam Browser', onclick: (e) => { e.currentTarget.href = link(); } });
  mount(entry(h('div', { class: 'panel' },
    h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
    h('div', { class: 'heading' }, h('h1', { text: 'This quiz opens in lockdown' }),
      h('p', { text: 'Safe Exam Browser locks your device until you turn in.' })),
    h('div', { class: 'seb-launch' }, open,
      h('button', { class: 'btn', type: 'button', text: 'Use a different code', onclick: () => screenJoin() })),
    h('p', { class: 'hint seb-get' }, 'Nothing happens? ', h('a', { href: apple ? 'https://apps.apple.com/app/id1155002964' : 'https://safeexambrowser.org/download_en.html', target: '_blank', rel: 'noopener', text: 'Get Safe Exam Browser' })))));
  open.focus();
}

// Type your name, then pick it. The server only ever sends back names that match what you typed.
function screenWho(err) {
  const run = S.run;
  let picked = null;
  let seq = 0;
  let timer = 0;
  const name = h('input', {
    class: 'input', id: 'student-name', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'name-list',
  });
  const list = h('div', { class: 'name-list', id: 'name-list', role: 'listbox', 'aria-label': 'Matching names', hidden: true });
  const hint = h('p', { class: 'hint', hidden: true });
  const said = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  let active = -1;
  const opts = () => [...list.children];
  function setActive(i) {
    active = i;
    opts().forEach((o, j) => o.classList.toggle('active', j === i));
    if (i >= 0) name.setAttribute('aria-activedescendant', opts()[i].id); else name.removeAttribute('aria-activedescendant');
    if (i >= 0) opts()[i].scrollIntoView({ block: 'nearest' });
  }
  const sid = h('input', { class: 'input mono', id: 'student-id', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '20' });
  const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
  const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Continue' });

  function close() { list.hidden = true; hint.hidden = true; name.setAttribute('aria-expanded', 'false'); setActive(-1); }
  function pick(m) {
    picked = m;
    name.value = m.name;
    name.classList.add('picked');
    close();
    said.textContent = `${m.name} picked`;
    sid.focus();
  }
  async function search() {
    const q = name.value.trim();
    if (q.length < 2) { close(); return; }
    const mine = ++seq;
    let res;
    try { res = await api.findNames({ runId: run.runId, q }); } catch (e) {
      if (mine !== seq) return;
      close();
      hint.hidden = false;
      hint.textContent = e.code === 'too_many' ? 'Busy. Keep typing in a moment.' : errorText(e);
      said.textContent = hint.textContent;
      return;
    }
    if (mine !== seq || picked) return;
    const matches = (res && res.matches) || [];
    if (!matches.length) {
      close();
      if (q.length < 3) return; // names match from 3 letters (or a whole short name)
      hint.hidden = false;
      hint.textContent = 'No match. Start with your first or last name.';
      said.textContent = hint.textContent;
      return;
    }
    hint.hidden = true;
    list.replaceChildren(...matches.map((m, i) => {
      const o = h('div', { class: 'name-opt', role: 'option', id: `name-opt-${i}`, 'aria-selected': 'false', text: m.name, onclick: () => pick(m) });
      o.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
      return o;
    }));
    list.hidden = false;
    name.setAttribute('aria-expanded', 'true');
    setActive(-1);
    said.textContent = plural(matches.length, 'name');
  }
  name.addEventListener('input', () => {
    picked = null;
    name.classList.remove('picked');
    clearTimeout(timer);
    timer = setTimeout(search, 120);
  });
  // Arrows move through the names while focus stays in the box; Enter picks the highlighted one (or the
  // only one).
  name.addEventListener('keydown', (e) => {
    const n = list.hidden ? 0 : opts().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive(Math.min(active + 1, n - 1)); }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    if (e.key === 'Escape' && n) { e.preventDefault(); close(); }
    if (e.key === 'Enter' && !picked && n) {
      e.preventDefault();
      if (active >= 0) opts()[active].click(); else if (n === 1) opts()[0].click(); else setActive(0);
    }
  });

  const form = h('form', { class: 'panel', novalidate: true },
    h('p', { class: 'eyebrow', text: run.title }),
    h('div', { class: 'heading' }, h('h1', { text: 'Who are you?' })),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-name', text: 'Your name' }), name, list, hint, said),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'student-id', text: 'Student ID' }), sid),
    btn, msg,
    demoHint('Demo: type ', h('b', { text: 'Av' }), ', pick Ava Martinez, ID ', h('b', { text: '204511' })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked) { msg.textContent = 'Pick your name from the list.'; name.focus(); return; }
    if (!sid.value.trim()) { msg.textContent = 'Type your student ID.'; sid.focus(); return; }
    btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
    try {
      const got = await api.attempt({ runId: run.runId, rosterId: picked.id, studentId: sid.value.trim() });
      if (got && got.run) Object.assign(S.run, got.run); // corrections: what this student has to correct
      if (got && got.timeLimitMin != null) S.run.timeLimitMin = got.timeLimitMin; // with any extra time they get
      S.me = { name: picked.name };
      screenRules();
    } catch (ex) {
      msg.textContent = errorText(ex);
      btn.disabled = false; btn.textContent = 'Continue';
      sid.select();
    }
  });
  mount(entry(form));
  name.focus();
}

// Who's signed in, so a student who picked the wrong name sees it.
function whoCard() {
  return h('div', { class: 'who-card' }, icon('person', 20), h('div', {}, h('span', { class: 'who-label', text: 'Signed in as' }), h('b', { class: 'who-name', text: S.me.name })));
}

// Agreed to the rules: full screen and monitored already, waiting for the teacher to start the quiz.
// Their name is on screen, so the teacher can walk the room and see who's who. The status is read out;
// the game under it (snake.js) isn't, and goes once the quiz starts.
function screenWait() {
  const screen = entry(h('div', { class: 'panel' },
    h('div', { class: 'wait-status', role: 'status' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('h1', { text: 'Waiting for your teacher to start the quiz' }),
      whoCard(),
      demoHint('Demo: click ', h('b', { text: 'Start' }), ' in the teacher view.')),
    BQ.snake ? BQ.snake() : null));
  mount(screen);
  S.el = { wrap: screen, fsOverlay: null }; // where the lockdown's warnings go until the quiz is on screen
  if (S.monitor && S.monitor.opts.fullscreen && !document.fullscreenElement && !cfg.demo) showFsOverlay();
  clearInterval(S.poll);
  let starting = false;
  const check = async () => {
    if (starting) return;
    try {
      const r = await api.admitStatus();
      if (r && r.admitted) { starting = true; clearInterval(S.poll); startFromWait(); }
    } catch (e) {
      if (e.code === 'run_closed') { clearInterval(S.poll); leaveLockdown(); screenClosed(); }
      else if (e.code === 'no_attempt') { clearInterval(S.poll); leaveLockdown(); signedOut(); }
      else if (e.code === 'other_network') { clearInterval(S.poll); leaveLockdown(); resetState(); screenJoin(ERRORS.other_network); }
      // anything else: keep polling
    }
  };
  S.poll = setInterval(check, cfg.demo ? 700 : 2000);
}
// The teacher started it: the questions, on the screen they're already full screen on.
async function startFromWait() {
  for (let tries = 0; ; tries++) {
    try { enterQuiz(await api.start(), !!S.monitor && S.monitor.opts.fullscreen); return; } catch (ex) {
      if (ex.code === 'no_attempt') { leaveLockdown(); return signedOut(); }
      if (ex.code === 'run_closed') { leaveLockdown(); return screenClosed(); }
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** tries, 8000))); // offline for a moment: keep trying
    }
  }
}
// Out of the waiting screen without a quiz (closed, signed out): monitoring off, full screen off.
function leaveLockdown() {
  if (S.monitor) { S.monitor.disarm(); S.monitor = null; }
  exitFullscreen();
  S.el = null;
}

function prechecks() {
  const ext = window.screen && 'isExtended' in window.screen ? window.screen.isExtended : null;
  // A mouse, and a window about as wide as the screen. Both are measured in screen units, so a student who
  // zooms the page in to read it still passes.
  const avail = window.screen && window.screen.availWidth;
  const desktop = window.matchMedia('(pointer: fine)').matches && (!avail || !window.outerWidth || window.outerWidth >= avail * 0.9);
  // Extensions: one that fakes "this page is in front" has to go. Anything else that adds to the page
  // is only pointed out, since some students need theirs (a screen reader toolbar, say).
  const page = BQ.pageCheck();
  return [
    { label: 'Browser extension', ok: !page.spoofed.length, note: page.spoofed.length ? 'An extension is changing this page. Turn your extensions off, then reload.' : null },
    { label: 'Extensions', ok: !page.added.length, soft: true, note: page.added.length ? 'Turn off any you don\'t need. Your teacher sees which are on.' : null },
    // Safe Exam Browser locks the screen itself, on a computer or an iPad.
    ...(S.run && S.run.seb ? [] : [
      { label: 'One display', ok: ext !== true, note: ext === true ? 'Unplug the second monitor, then reload this page.' : null },
      { label: 'Fullscreen works', ok: !!document.fullscreenEnabled, note: document.fullscreenEnabled ? null : 'Open this page in Edge or Chrome.' },
      { label: 'Desktop computer', ok: desktop, note: desktop ? null : window.matchMedia('(pointer: fine)').matches ? 'Maximize this window.' : 'Take the quiz on a lab computer with a mouse.' },
    ]),
  ];
}

// What's on the quiz, before it starts: one line per type, each opening to its questions' names.
// Prompts stay on the server until the quiz starts.
const round2 = (x) => Math.round(x * 100) / 100;
function summaryLine(run) {
  const n = run.questionCount;
  const pts = run.points != null ? run.points : run.outline ? round2(run.outline.reduce((t, q) => t + q.points, 0)) : 0;
  const mins = run.timeLimitMin;
  return `${plural(n, 'question')}${pts ? ` (${plural(pts, 'point')})` : ''}${mins ? ` in ${plural(mins, 'minute')}` : ''}.`;
}
function overview(run) {
  const outline = run.outline || [];
  let groups = [];
  if (run.sections && run.sections.length) {
    // the teacher's sections, in order
    const base = run.sections.reduce((t, sec) => t + (sec.timeLimitMin || 0), 0);
    const x = base && run.timeLimitMin ? run.timeLimitMin / base : 1; // their extra time
    groups = partsFor(outline.map((q) => q.type), run.sections).map((p) => ({ title: p.title, qs: outline.slice(p.start, p.end + 1), mins: p.section && p.section.timeLimitMin ? Math.round(p.section.timeLimitMin * x) : 0 }));
  } else {
    for (const q of outline) {
      let g = groups.find((x) => x.type === q.type);
      if (!g) groups.push(g = { type: q.type, title: (PARTS[q.type] || { title: 'Questions' }).title, qs: [] });
      g.qs.push(q);
    }
  }
  groups.forEach((g) => { g.points = g.qs.reduce((t, q) => t + q.points, 0); });
  if (!groups.length) return null;
  return h('div', { class: 'overview' }, groups.map((g) => h('details', { class: 'ov-group' },
    h('summary', {}, h('span', {}, h('b', { text: `${g.title}: ` }), `${plural(g.qs.length, 'question')} (${plural(round2(g.points), 'point')})${g.mins ? ` · ${g.mins} min` : ''}`)),
    h('ul', { class: 'ov-list' }, g.qs.map((q) => h('li', {},
      q.n ? `Question ${q.n}${q.name ? `: ${q.name}` : ''}` : q.name || 'Unnamed question',
      h('span', { class: 'ov-pts', text: ` (${plural(q.points, 'point')})` })))))));
}

// The teacher's own directions for the whole quiz, if they wrote any.
function quizDirections(text, heading) {
  if (!text) return null;
  return h('div', { class: 'directions quiz-directions' },
    h('strong', { text: heading }), h('div', { class: 'prompt' }, BQ.md.render(text, mdOpts())));
}

function screenPractice(err) {
  if (S.run.corrections) return screenCorrections(err);
  if (S.run.hasCode) loadMonaco().catch(() => {});
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start' });
  const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
  btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start'));
  mount(entry(h('div', { class: 'panel' },
    h('p', { class: 'eyebrow', text: S.run.title }),
    h('div', { class: 'heading' },
      h('h1', { text: 'Practice' }),
      h('p', { text: summaryLine(S.run) })),
    btn, msg)));
  btn.focus();
}

// Corrections: the questions they missed on the quiz, their answers filled in. Practice: no lockdown.
function screenCorrections(err) {
  const n = S.run.questionCount || 0;
  const e = S.run.exam; // their score on the quiz (raw, like their reports)
  const scoreLine = e ? h('p', { class: 'corr-score' }, 'Your score on the quiz: ', h('b', { text: `${e.score} / ${e.max}` }), e.pending ? ' so far' : '') : null;
  if (!n) {
    const screen = entry(h('div', { class: 'panel', role: 'status' },
      h('p', { class: 'eyebrow', text: S.run.title }),
      h('div', { class: 'heading' }, h('h1', { text: 'Nothing to correct' }), scoreLine)));
    if (e) screen.prepend(confetti()); // nothing missed: same as turning one in
    mount(screen);
    return;
  }
  if (S.run.hasCode) loadMonaco().catch(() => {});
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Start' });
  const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
  btn.addEventListener('click', () => beginQuiz(btn, msg, 'Start'));
  mount(entry(h('div', { class: 'panel' },
    h('p', { class: 'eyebrow', text: S.run.title }),
    h('div', { class: 'heading' },
      h('h1', { text: 'Corrections' }),
      scoreLine,
      h('p', { text: `${plural(n, 'question')} to fix${S.run.points ? ` (${plural(S.run.points, 'point')})` : ''}. Your answers from the quiz are filled in.` })),
    btn, msg)));
  btn.focus();
}

function screenRules(err) {
  if (S.run.practice) return screenPractice(err);
  if (S.run.hasCode) loadMonaco().catch(() => {});
  const mins = S.run.timeLimitMin;
  // Agreeing turns the lockdown on (full screen, monitoring) and waits for the teacher to start
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'I agree' });
  const msg = h('p', { class: 'error', role: 'alert', text: err || '' });
  const checkList = h('ul', { class: 'checks', 'aria-label': 'Computer checks' });
  let blocked = false;
  // Re-check when the window changes size or a display is plugged in or out.
  function renderChecks() {
    const checks = prechecks();
    blocked = !cfg.demo && !S.run.seb && checks.some((c) => !c.ok && !c.soft); // SEB locks the screen itself
    checkList.hidden = !checks.some((c) => !c.ok);
    checkList.replaceChildren(...checks.filter((c) => !c.ok).map((c) => h('li', {},
      h('span', { class: 'check-mark ' + (c.ok ? 'ok' : c.soft ? 'soft' : 'bad'), text: c.ok ? 'OK' : c.soft ? 'Note' : 'Fix' }),
      c.label,
      c.note ? h('span', { class: 'check-note', text: c.note }) : null)));
    if (btn.textContent === 'I agree') btn.disabled = blocked;
  }
  renderChecks();
  const onChange = () => { if (!checkList.isConnected) { window.removeEventListener('resize', onChange); return; } renderChecks(); };
  window.addEventListener('resize', onChange);
  if (window.screen && window.screen.addEventListener) window.screen.addEventListener('change', onChange);

  // In Safe Exam Browser with our settings there's nothing to leave to: the device is locked until they turn in
  const locked = !!S.run.sebQuit;
  const panel = h('div', { class: 'panel wide' },
    h('p', { class: 'eyebrow', text: S.run.title }),
    h('div', { class: 'heading' },
      h('h1', { text: 'Before you start' }),
      h('p', { text: summaryLine(S.run) })),
    locked
      ? h('div', { class: 'lock-rule', role: 'note' },
        h('p', { class: 'lock-title', text: 'Lockdown mode' }),
        h('p', { text: 'Other apps, tabs and windows are blocked until you turn in. If you get stuck, ask your teacher.' }))
      : h('div', { class: 'cheat-rule', role: 'note' },
        h('p', { class: 'cheat-title', text: 'Leaving the quiz counts as cheating.' }),
        h('p', { text: 'That means switching to another window, tab or app, leaving fullscreen, reloading or closing this page, or using Exit when your teacher didn\'t say to. Your teacher sees each time it happens.' })),
    h('ul', { class: 'rules' },
      locked ? null : h('li', { text: 'The quiz runs in fullscreen.' }),
      h('li', { text: 'Mouse and keyboard activity is recorded, and your teacher can watch the quiz page live.' }),
      h('li', { text: 'Pasting from outside the quiz is blocked.' }),
      mins ? h('li', { text: 'The quiz turns itself in when time runs out.' }) : null),
    checkList,
    btn, msg,
    cfg.demo && prechecks().some((c) => !c.ok) ? demoHint('Demo: checks are shown but not enforced here.') : null);

  btn.addEventListener('click', () => { clearInterval(S.poll); agreeAndWait(btn, msg); });
  mount(entry(panel));
  btn.focus();
  // While they read: notice the quiz closing (or them being signed out) without waiting for the click
  clearInterval(S.poll);
  S.poll = setInterval(async () => {
    if (!panel.isConnected) { clearInterval(S.poll); return; }
    try { await api.admitStatus(); } catch (e) {
      if (!panel.isConnected) return;
      if (e.code === 'run_closed') { clearInterval(S.poll); screenClosed(); }
      else if (e.code === 'no_attempt') { clearInterval(S.poll); signedOut(); }
    }
  }, cfg.demo ? 2000 : 4000);
}

// "I agree": full screen (it needs this click), the server marks them ready, and the monitoring starts.
// Then the waiting screen, or straight in if the teacher already started them.
async function agreeAndWait(btn, msg) {
  btn.disabled = true; btn.textContent = 'One moment…'; msg.textContent = '';
  const seb = !!S.run.seb; // Safe Exam Browser already runs locked full screen
  const fsOk = seb ? false : await enterFullscreen();
  if (!fsOk && !cfg.demo && !seb) {
    msg.textContent = 'Fullscreen was blocked. Click again.';
    btn.disabled = false; btn.textContent = 'I agree';
    return;
  }
  let r;
  try { r = await api.ready(); } catch (ex) {
    exitFullscreen();
    if (ex.code === 'no_attempt') return signedOut();
    if (ex.code === 'run_closed') return screenClosed();
    msg.textContent = errorText(ex);
    btn.disabled = false; btn.textContent = 'I agree';
    return;
  }
  if (!S.monitor) S.monitor = makeMonitor(fsOk);
  if (!S.monitor.armed) S.monitor.arm();
  if (r && r.admitted) { btn.textContent = 'Starting…'; return startFromWait(); }
  screenWait();
}

// Shared by Start and Continue. Fullscreen has to be requested inside the click.
async function beginQuiz(btn, msg, label) {
  btn.disabled = true; btn.textContent = 'Starting…'; msg.textContent = '';
  const practice = !!S.run.practice;
  // Safe Exam Browser already runs locked full screen, and may not offer the browser's fullscreen.
  const seb = !!S.run.seb;
  const fsOk = practice || seb ? false : await enterFullscreen();
  if (!fsOk && !cfg.demo && !practice && !seb) {
    msg.textContent = 'Fullscreen was blocked. Click again.';
    btn.disabled = false; btn.textContent = label;
    return;
  }
  let r;
  try {
    r = await api.start();
  } catch (ex) {
    exitFullscreen();
    if (ex.code === 'no_attempt') return signedOut();
    if (ex.code === 'run_closed') return screenClosed();
    msg.textContent = errorText(ex);
    btn.disabled = false; btn.textContent = label;
    return;
  }
  enterQuiz(r, fsOk);
}

// The quiz on screen, from /api/start's answer: after Start (practice), Continue, or the teacher's start.
function enterQuiz(r, fsOk) {
  clearInterval(S.poll);
  S.tag = r.tag || ''; // this attempt: a reset or a second try starts with no marks or scratch work
  S.quiz = r.quiz;
  S.deadline = r.deadline || 0;
  S.turnInAt = r.turnInAt || 0;
  S.skew = r.now ? r.now - Date.now() : 0;
  S.locked = r.locked || 0;
  S.partEnds = r.partEnds || null; // timed parts: when each one's time is up (the server's clock)
  S.pausedAt = r.paused || 0; // the teacher has the quiz paused: when this student's clock stopped
  const unsent = takeUnsent(r.savedAt);
  S.answers = restoreAnswers(unsent || r.saved || {});
  loadMarks();
  loadScratch();
  if (!S.monitor) S.monitor = makeMonitor(fsOk);
  if (unsent) S.monitor.answersDirty = true; // the next heartbeat takes them to the server
  screenQuiz();
  if (!S.monitor.armed) S.monitor.arm();
  // left full screen while it was starting: the same warning as in the quiz
  if (S.monitor.opts.fullscreen && !document.fullscreenElement && !cfg.demo) showFsOverlay();
}

function makeMonitor(fsOk) {
  return new BQ.Monitor(api, {
    integrity: !S.run.practice,
    fullscreen: fsOk,
    keysHeld: () => keysHeld && !!document.fullscreenElement,
    getAnswers: serializeAnswers,
    holdAnswers: () => !!S.pausedAt, // the server doesn't take them while the quiz is paused
    getView: currentView,
    onFullscreenLost: showFsOverlay,
    onFullscreenBack: hideFsOverlay,
    // In Safe Exam Browser with our settings nothing else can be in front, so coming back from SEB's own
    // toolbar or a system dialog isn't leaving the quiz (the server doesn't count it either)
    onReturn: S.run.sebQuit ? null : showLeftWarning,
    onPasteBlocked: () => toast('Pasting from outside the quiz is blocked.'),
    onSave: () => toast('Saved'),
    onReloadBlocked: () => toast('Reloading is off during the quiz.'),
    onBeat: onBeat,
    onBeatError: onBeatError,
  });
}

// What's on screen, for a teacher watching live: the page, the scroll, the window's size, what's
// highlighted, and the scratchpad.
function currentView() {
  if (!S || !S.el || !S.quiz) return null;
  const q = S.quiz.questions[S.idx];
  const a = q && q.type === 'code' ? S.answers[q.id] : null;
  const modal = S.el.wrap.querySelector('.modal-backdrop:not(.nav-pop) [aria-labelledby]');
  const pad = !!(S.el.scratch && !S.el.scratch.hidden);
  const v = {
    q: q ? q.id : null, review: !!S.reviewOpen, dir: !!S.dirOpen && !S.reviewOpen, intro: !!S.introOpen, paused: S.pausedAt || 0,
    scroll: Math.round(S.el.main.scrollTop), wscroll: Math.round(S.el.wrap.scrollTop),
    w: window.innerWidth, h: window.innerHeight, lang: a ? a.language : null,
    nav: !!S.el.wrap.querySelector('.nav-pop'), modal: modal ? modal.getAttribute('aria-labelledby') : false,
    marks: S.marks || null, // marked for review, crossed-out choices: only ever in their browser otherwise
    hl: highlightsNow(), pad,
    toast: toastNow(), fs: !!S.el.fsOverlay, dark: isDark(),
    save: S.saveState || null, phone: phoneSized(), tool: S.scratch ? S.scratch.tool : null,
  };
  // The code editor: where it's scrolled, their cursor and selection
  if (S.editor) {
    const sel = S.editor.getSelection();
    v.ed = { top: Math.round(S.editor.getScrollTop()), left: Math.round(S.editor.getScrollLeft()),
      sel: sel ? [sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn] : null };
  }
  // The scratchpad page on screen, when it's changed since the server last had it (onBeat)
  if (pad && q && S.scratch) {
    const key = `${q.id}:${S.scratchVer || 0}`;
    if (key !== S.padSent) { v.page = { q: q.id, items: S.scratch.pages[q.id] || [] }; S.padSending = key; }
  }
  return v;
}
const toastNow = () => { const t = S.el.wrap.querySelector('.toast'); return t ? t.textContent.slice(0, 200) : null; };
// What's highlighted, by the piece of question text it's in (see kept)
function highlightsNow() {
  const out = {};
  for (const [key, node] of S.kept) if (node.querySelector('mark.hl')) out[key] = marksIn(node);
  return out;
}

export { beginQuiz, entry, overview, quizDirections, screenJoin, screenPractice, screenRules, summaryLine };
