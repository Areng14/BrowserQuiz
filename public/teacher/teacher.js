// BrowserQuiz teacher dashboard: sign in, upload quizzes and rosters, start a quiz, watch it live.
// Everything a student typed is shown with textContent only.
(function () {
  'use strict';
  const root = document.getElementById('t-app');
  const THEME_KEY = 'bq-theme';
  const LABEL = {
    join: 'Signed in', admit: 'Admitted', start: 'Started the quiz', submit: 'Submitted', run: 'Ran examples', reload: 'Reopened mid-quiz',
    restore: 'Restored by teacher', invalidate: 'Invalidated by teacher', blur: 'Left the quiz window', hidden: 'Tab hidden',
    'fullscreen-exit': 'Left fullscreen', return: 'Came back', 'mouse-left': 'Cursor left the page', copy: 'Copy blocked',
    paste: 'Outside paste blocked', contextmenu: 'Right-click', 'blocked-key': 'Blocked key', 'print-screen': 'Print Screen',
    resize: 'Window resized', 'unfocused-beat': 'Heartbeat: not focused', 'heartbeat-lost': 'Heartbeat lost',
    'extended-display': 'Second display', 'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
    'late-submit': 'Submitted late', 'other-network': 'Request from another network', 'other-device': 'Request from another browser',
  };
  let pollTimer = 0;
  let selected = null;

  try { const t = localStorage.getItem(THEME_KEY); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
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

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (res.status === 401 && data && data.error === 'login') { showLogin(); throw new Error('login'); }
    if (!res.ok) throw new Error((data && data.message) || (data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function themeButton() {
    const b = h('button', { class: 'theme-btn', type: 'button' });
    const paint = () => { const d = isDark(); b.textContent = d ? '☀' : '☾'; b.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); };
    paint();
    b.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      paint();
    });
    return b;
  }
  function bar(...left) {
    return h('header', { class: 't-bar' }, h('span', { class: 'grow' }, ...left), themeButton(),
      h('button', { class: 'btn small', type: 'button', text: 'Sign out', onclick: async () => { await post('/api/t/logout'); showLogin(); } }));
  }
  function mount(...nodes) { clearInterval(pollTimer); root.replaceChildren(...nodes); }

  // ---------- sign in ----------
  function showLogin() {
    const pw = h('input', { class: 'input', type: 'password', id: 'pw', autocomplete: 'current-password' });
    const msg = h('p', { class: 't-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h('form', { class: 't-login' },
      h('p', { class: 'eyebrow', text: 'BrowserQuiz' }),
      h('h1', { text: 'Teacher sign in' }),
      h('label', { class: 'field', for: 'pw' }, h('span', { class: 'field-label', text: 'Password' }), pw),
      btn, msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; msg.textContent = '';
      try { await post('/api/t/login', { password: pw.value }); showHome(); } catch (ex) { msg.textContent = ex.message === 'bad_password' ? 'Wrong password.' : ex.message; btn.disabled = false; pw.select(); }
    });
    mount(form);
    pw.focus();
  }

  // ---------- home ----------
  async function showHome() {
    let data;
    try { data = await api('/api/t/overview'); } catch (e) { if (e.message !== 'login') mount(h('p', { class: 't-error', text: e.message })); return; }
    const quizSel = h('select', { class: 'input', id: 'run-quiz' }, data.quizzes.map((x) => h('option', { value: x.id, text: `${x.title} (${x.questions} questions)` })));
    const rosterSel = h('select', { class: 'input', id: 'run-roster' }, data.rosters.map((x) => h('option', { value: x.id, text: `${x.name} (${x.students})` })));
    const ipLock = h('input', { type: 'checkbox', id: 'ip-lock', checked: true });
    const startMsg = h('p', { class: 't-error', role: 'alert' });
    const startBtn = h('button', { class: 'btn primary', type: 'button', text: 'Start quiz', disabled: !data.quizzes.length || !data.rosters.length });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try { const r = await post('/api/t/runs', { quizId: quizSel.value, rosterId: rosterSel.value, ipLock: ipLock.checked }); showRun(r.id); } catch (e) { startMsg.textContent = e.message; startBtn.disabled = false; }
    });

    const quizFile = h('input', { class: 'input', type: 'file', id: 'quiz-file', accept: '.quiz,.zip' });
    const quizMsg = h('p', { class: 't-error', role: 'alert' });
    const quizBtn = h('button', { class: 'btn', type: 'button', text: 'Upload .quiz' });
    quizBtn.addEventListener('click', async () => {
      const f = quizFile.files[0];
      if (!f) { quizMsg.textContent = 'Pick a .quiz file first.'; return; }
      quizBtn.disabled = true; quizBtn.textContent = 'Checking…'; quizMsg.textContent = '';
      try { await api('/api/t/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() }); showHome(); } catch (e) { quizMsg.textContent = e.message; quizBtn.disabled = false; quizBtn.textContent = 'Upload .quiz'; }
    });

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

    mount(bar('BrowserQuiz · Teacher'), h('main', { class: 't-main' },
      h('section', { class: 't-section' },
        h('h1', { text: 'Start a quiz' }),
        !data.quizzes.length || !data.rosters.length ? h('p', { class: 't-muted', text: 'Upload a quiz and a roster below first.' }) : null,
        h('div', { class: 't-row' },
          h('label', { class: 'field', for: 'run-quiz' }, h('span', { class: 'field-label', text: 'Quiz' }), quizSel),
          h('label', { class: 'field', for: 'run-roster' }, h('span', { class: 'field-label', text: 'Class' }), rosterSel)),
        h('label', { class: 't-check', for: 'ip-lock' }, ipLock, h('span', { text: 'Only allow students on this network (recommended)' })),
        h('div', {}, startBtn), startMsg),
      h('section', { class: 't-section' },
        h('h2', { text: 'Recent quizzes' }),
        data.runs.length ? h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
          h('thead', {}, h('tr', {}, ['Code', 'Quiz', 'Class', 'Status', 'Joined', 'Started'].map((x) => h('th', { text: x })))),
          h('tbody', {}, data.runs.map((r) => h('tr', {},
            h('td', {}, h('button', { class: 't-link', type: 'button', text: r.code, onclick: () => showRun(r.id) })),
            h('td', { text: r.quiz }), h('td', { text: r.roster }),
            h('td', { class: r.status === 'open' ? 'st-good' : 't-muted', text: r.status === 'open' ? 'Open' : 'Closed' }),
            h('td', { class: 'num', text: String(r.joined) }), h('td', { text: date(r.createdAt) })))))) : h('p', { class: 't-muted', text: 'None yet.' })),
      h('section', { class: 't-section' },
        h('h2', { text: 'Quizzes' }),
        data.quizzes.length ? h('ul', {}, data.quizzes.map((x) => h('li', { text: `${x.title} · ${x.questions} questions${x.timeLimitMin ? ` · ${x.timeLimitMin} min` : ''}` }))) : null,
        h('div', { class: 't-row' }, h('label', { class: 'field', for: 'quiz-file' }, h('span', { class: 'field-label', text: '.quiz file' }), quizFile), quizBtn),
        quizMsg),
      h('section', { class: 't-section' },
        h('h2', { text: 'Classes' }),
        data.rosters.length ? h('ul', {}, data.rosters.map((x) => h('li', { text: `${x.name} · ${x.students} students` }))) : null,
        h('p', { class: 't-muted t-small', text: 'CSV with a header row: name, student_id. Student IDs are stored hashed, never as typed.' }),
        h('div', { class: 't-row' },
          h('label', { class: 'field', for: 'roster-name' }, h('span', { class: 'field-label', text: 'Class name' }), rosterName),
          h('label', { class: 'field', for: 'roster-file' }, h('span', { class: 'field-label', text: 'Roster CSV' }), rosterFile),
          rosterBtn),
        rosterMsg)));
  }

  // ---------- one running quiz ----------
  function statusCell(s) {
    if (!s.attempt) return h('td', { class: 't-muted', text: 'Not joined' });
    const a = s.attempt;
    if (a.status === 'waiting') return h('td', { class: 'st-waiting', text: 'Waiting' });
    if (a.status === 'admitted') return h('td', { text: 'Admitted' });
    if (a.status === 'active') return h('td', { text: 'In progress' });
    return h('td', { class: 'st-good', text: 'Submitted' });
  }
  function integrityCell(a) {
    if (!a) return h('td');
    if (a.integrity === 'invalidated') return h('td', { class: 'st-bad', text: `Invalidated (${LABEL[a.reason] || a.reason})` });
    if (a.integrity === 'restored') return h('td', { class: 'st-waiting', text: 'Restored' });
    return h('td', { class: 'st-good', text: 'Clean' });
  }

  async function showRun(runId) {
    selected = null;
    const code = h('span', { class: 't-joincode' });
    const title = h('h1');
    const meta = h('p', { class: 't-muted' });
    const tbody = h('tbody');
    const detail = h('div');
    const toggle = h('button', { class: 'btn', type: 'button' });
    const admitAll = h('button', { class: 'btn primary', type: 'button', text: 'Admit everyone waiting', onclick: () => act(`/api/t/runs/${runId}/admit-all`) });
    const exportLink = h('a', { class: 'btn', href: `/api/t/runs/${runId}/export.csv`, download: true, text: 'Export CSV' });
    exportLink.style.display = 'inline-flex';
    exportLink.style.alignItems = 'center';
    exportLink.style.textDecoration = 'none';

    async function act(path, body) {
      try { await post(path, body); } catch (e) { alertBox(e.message); }
      refresh();
    }
    function alertBox(msg) { detail.prepend(h('p', { class: 't-error', text: msg })); }

    async function refresh() {
      let data;
      try { data = await api(`/api/t/runs/${runId}/live`); } catch (e) { return; }
      const run = data.run;
      code.textContent = run.code;
      title.textContent = run.title;
      meta.textContent = `${run.questions} questions${run.timeLimitMin ? ` · ${run.timeLimitMin} minutes` : ''} · ${run.status === 'open' ? 'Open' : 'Closed'}${run.ipLock ? ' · locked to this network' : ''}`;
      toggle.textContent = run.status === 'open' ? 'Close quiz' : 'Reopen quiz';
      toggle.onclick = () => act(`/api/t/runs/${runId}/${run.status === 'open' ? 'close' : 'open'}`);
      const order = (s) => (s.attempt ? (s.attempt.integrity === 'invalidated' ? 0 : s.attempt.status === 'waiting' ? 1 : 2) : 3);
      const rows = data.students.slice().sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
      tbody.replaceChildren(...rows.map((s) => {
        const a = s.attempt;
        const actions = h('td', { class: 't-actions' });
        if (a && a.status === 'waiting') actions.append(h('button', { class: 'btn small primary', type: 'button', text: 'Admit', onclick: () => act(`/api/t/attempts/${a.id}/admit`) }));
        if (a && a.integrity === 'invalidated') actions.append(h('button', { class: 'btn small', type: 'button', text: 'Restore', onclick: () => act(`/api/t/attempts/${a.id}/restore`) }));
        if (a) actions.append(h('button', { class: 'btn small', type: 'button', text: 'Reset', title: 'Let this student start over', onclick: () => { if (confirm(`Reset ${s.name}? Their attempt is archived and they can start over.`)) act(`/api/t/attempts/${a.id}/reset`); } }));
        const beat = a && a.lastBeatAgo != null ? Math.round(a.lastBeatAgo / 1000) : null;
        return h('tr', { class: selected === (a && a.id) ? 'sel' : null },
          h('td', {}, a ? h('button', { class: 't-link', type: 'button', text: s.name, onclick: () => { selected = a.id; showDetail(a.id); refresh(); } }) : s.name),
          statusCell(s), integrityCell(a),
          h('td', { class: 'num', text: a ? String(a.strikes) : '' }), h('td', { class: 'num', text: a ? String(a.warnings) : '' }),
          h('td', { class: 'num', text: a && a.status !== 'waiting' ? `${a.answered}/${a.total}` : '' }),
          h('td', { class: 'num' + (beat != null && beat > 6 ? ' t-late' : ''), text: beat != null ? `${beat}s ago` : '' }),
          h('td', { class: 'num', text: a && a.score != null ? `${a.score} / ${a.max}${a.pending ? ' (grading)' : ''}` : '' }),
          actions);
      }));
      if (selected) showDetail(selected, true);
    }

    async function showDetail(id, quiet) {
      let d;
      try { d = await api(`/api/t/attempts/${id}`); } catch (e) { return; }
      if (selected !== id) return;
      const canvas = h('canvas', { class: 't-trail', width: 640, height: 360, 'aria-label': 'Mouse trail' });
      const answers = h('div', { class: 't-answers' }, d.answers.map((x, i) => {
        const parts = [h('p', {}, h('b', { text: `${i + 1}. ` }), x.prompt.replace(/```\w*/g, ' ').replace(/`/g, '').replace(/\s+/g, ' ').trim().slice(0, 140))];
        const pts = x.points != null ? `${x.points} / ${x.max}` : x.code && x.code.status === 'pending' ? 'grading…' : `– / ${x.max}`;
        parts.push(h('p', { class: 't-muted t-small', text: `Points: ${pts}` }));
        if (x.type === 'code') {
          parts.push(h('pre', { text: x.answer || '(no answer)' }));
          if (x.code && x.code.compileError) parts.push(h('pre', { class: 't-error', text: x.code.compileError }));
          if (x.code && x.code.tests) parts.push(h('p', { class: 't-small', text: `Hidden tests passed: ${x.code.tests.filter((t) => t.pass).length} of ${x.code.tests.length}${x.language ? ` · ${x.language}` : ''}` }));
        } else {
          parts.push(h('p', { class: 't-small' }, 'Answer: ', h('b', { text: x.answer == null ? '(blank)' : String(x.answer) })));
          parts.push(h('p', { class: 't-small t-muted', text: `Correct: ${x.correctAnswer}` }));
        }
        return h('div', { class: 't-answer' }, parts);
      }));
      detail.replaceChildren(h('section', { class: 't-detail' },
        h('div', { class: 't-row' },
          h('h2', { style: 'flex:1', text: d.name }),
          d.integrity !== 'invalidated' ? h('button', { class: 'btn small', type: 'button', text: 'Invalidate', onclick: () => { const note = prompt('Why? (kept in the log)'); if (note !== null) act(`/api/t/attempts/${id}/invalidate`, { note }); } }) : null,
          d.status === 'submitted' ? h('button', { class: 'btn small', type: 'button', text: 'Regrade', onclick: () => act(`/api/t/attempts/${id}/regrade`) }) : null,
          h('button', { class: 'btn small', type: 'button', text: 'Close', onclick: () => { selected = null; detail.replaceChildren(); refresh(); } })),
        d.integrity === 'invalidated' ? h('p', { class: 'st-bad', text: `Invalidated at ${clock(d.invalidatedAt)}: ${(LABEL[d.reason] || d.reason || '').toLowerCase()}. The student wasn't told.` }) : null,
        h('div', { class: 't-detail-grid' },
          h('div', { class: 't-section' }, h('h3', { text: 'Activity' }),
            h('ul', { class: 't-events' }, d.events.map((e) => h('li', { class: e.severity }, h('time', { text: clock(e.t) }), h('span', {}, h('b', { text: LABEL[e.type] || e.type }), e.detail ? ` · ${e.detail}` : ''))))),
          h('div', { class: 't-section' }, h('h3', { text: 'Mouse trail' }), canvas,
            h('p', { class: 't-muted t-small', text: `${d.mouse.length} samples · ${d.userAgent || ''}` }))),
        h('div', { class: 't-section' }, h('h3', { text: d.totals ? `Answers · ${d.totals.score} / ${d.totals.max}${d.totals.pending ? ' (code still grading)' : ''}` : 'Answers' }), answers)));
      drawTrail(canvas, d.mouse);
      if (!quiet) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    mount(bar(h('button', { class: 't-link', type: 'button', text: '← All quizzes', onclick: () => showHome() })),
      h('main', { class: 't-main' },
        h('section', { class: 't-section' },
          h('div', { class: 't-code' }, code, h('div', {}, title, meta)),
          h('div', { class: 't-row' }, admitAll, toggle, exportLink)),
        h('div', { class: 't-table-wrap' }, h('table', { class: 't-table' },
          h('thead', {}, h('tr', {}, ['Student', 'Status', 'Integrity', 'Strikes', 'Warnings', 'Answered', 'Heartbeat', 'Score', ''].map((x) => h('th', { text: x })))),
          tbody)),
        detail));
    await refresh();
    pollTimer = setInterval(refresh, 2000);
  }

  function drawTrail(canvas, pts) {
    const css = getComputedStyle(document.documentElement);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const hh = canvas.height;
    ctx.fillStyle = css.getPropertyValue('--bg').trim() || '#fff';
    ctx.fillRect(0, 0, w, hh);
    if (pts.length < 2) return;
    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#2257d6';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const px = (x / 1000) * w; const py = (y / 1000) * hh; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  api('/api/t/me').then(showHome).catch(() => {});
})();
