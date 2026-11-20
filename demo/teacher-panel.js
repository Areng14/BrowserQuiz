// Demo-only teacher view: shows what the server sees while the student takes the quiz.
// In the real app this is the teacher dashboard; the student's page never gets any of it.
(function () {
  'use strict';
  const BQ = window.BQ;

  const LABEL = {
    join: 'Signed in', admit: 'Admitted by teacher', start: 'Started the quiz', submit: 'Submitted',
    restore: 'Restored by teacher', run: 'Ran examples', reload: 'Reopened mid-quiz',
    blur: 'Left the quiz window', hidden: 'Tab hidden', 'fullscreen-exit': 'Left fullscreen', return: 'Came back',
    'mouse-left': 'Cursor left the page', copy: 'Copy blocked', paste: 'Outside paste blocked', contextmenu: 'Right-click',
    'blocked-key': 'Blocked key', 'print-screen': 'Print Screen pressed', resize: 'Window resized',
    'unfocused-beat': 'Heartbeat: not focused', 'heartbeat-lost': 'Connection lost', 'extended-display': 'Second display',
    'bulk-insert': 'Large insert in editor', 'inhuman-typing': 'Typing faster than a person',
  };
  const STATUS = {
    waiting: ['Waiting to be admitted', 'warn'], admitted: ['Admitted', 'neutral'],
    active: ['In progress', 'neutral'], submitted: ['Submitted', 'good'],
  };
  const INTEGRITY = { clean: ['Clean', 'good'], invalidated: ['Invalidated', 'bad'], restored: ['Restored', 'warn'] };
  const SEV = { violation: 'Violation', warning: 'Warning', info: 'Info' };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  function mount(host) {
    const t = BQ.api.teacher;
    const name = h('p', { class: 'tp-name' });
    const sub = h('p', { class: 'tp-sub' });
    const pills = h('div', { class: 'tp-pills' });
    const stat = (label) => { const dd = h('dd'); return [h('div', { class: 'tp-stat' }, h('dt', { text: label }), dd), dd]; };
    const [sStrikes, vStrikes] = stat('Strikes');
    const [sWarn, vWarn] = stat('Warnings');
    const [sBeat, vBeat] = stat('Last heartbeat');
    const [sRuns, vRuns] = stat('Code runs');
    const reason = h('p', { class: 'tp-reason', hidden: true });
    const admit = h('button', { class: 'btn small primary', type: 'button', text: 'Admit', onclick: () => t.admit() });
    const restore = h('button', { class: 'btn small', type: 'button', text: 'Restore attempt', onclick: () => t.restore() });
    const auto = h('input', { type: 'checkbox', id: 'tp-auto' });
    auto.addEventListener('change', () => t.setAutoAdmit(auto.checked));
    const score = h('div', { class: 'tp-score' });
    const canvas = h('canvas', { class: 'tp-trail', width: 320, height: 180, 'aria-label': 'Mouse trail' });
    const trailNote = h('p', { class: 'tp-sub' });
    const logList = h('ol', { class: 'tp-log' });

    host.replaceChildren(h('aside', { class: 'tp', 'aria-label': 'Teacher view' },
      h('header', { class: 'tp-head' },
        h('div', {}, h('p', { class: 'tp-eyebrow', text: 'Teacher view' }), h('h2', { text: 'What the server sees' })),
        h('span', { class: 'pill neutral', text: 'Demo only' })),
      h('p', { class: 'tp-lead', text: "None of this ever shows on the student's screen. Try it: start the quiz, then switch tabs or click outside the page." }),
      h('section', { class: 'tp-card' },
        h('div', { class: 'tp-row' }, h('div', { class: 'tp-who' }, name, sub), pills),
        h('dl', { class: 'tp-stats' }, sStrikes, sWarn, sBeat, sRuns),
        reason,
        h('div', { class: 'tp-actions' }, admit, restore),
        h('label', { class: 'tp-toggle', for: 'tp-auto' }, auto, h('span', { text: 'Admit students automatically' }))),
      h('section', { class: 'tp-card', hidden: true }, h('h3', { text: 'Score' }), score),
      h('section', { class: 'tp-card' }, h('h3', { text: 'Mouse trail' }), canvas, trailNote),
      h('section', { class: 'tp-card' }, h('h3', { text: 'Activity' }), logList)));
    const scoreCard = score.parentElement;

    let lastMouseLen = -1;
    let lastEventsLen = -1;
    let lastState = null;

    function drawTrail(points) {
      const css = getComputedStyle(document.documentElement);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 320;
      const hgt = Math.round((w * 9) / 16);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      ctx.fillStyle = css.getPropertyValue('--bg').trim() || '#fff';
      ctx.fillRect(0, 0, w, hgt);
      ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#ddd';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((w * i) / 4, 0); ctx.lineTo((w * i) / 4, hgt); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (hgt * i) / 4); ctx.lineTo(w, (hgt * i) / 4); ctx.stroke();
      }
      const pts = points.slice(-1500);
      if (pts.length < 2) return;
      const accent = css.getPropertyValue('--accent').trim() || '#1d5bd6';
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const px = (x / 1000) * w; const py = (y / 1000) * hgt; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      ctx.globalAlpha = 1;
      const [lx, ly] = pts[pts.length - 1];
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc((lx / 1000) * w, (ly / 1000) * hgt, 4, 0, Math.PI * 2); ctx.fill();
    }

    function render(st) {
      lastState = st;
      const a = st.attempt;
      auto.checked = !!st.autoAdmit;
      if (!a) {
        name.textContent = 'No one has joined yet';
        sub.textContent = 'Join code K7QX4M';
        pills.replaceChildren();
        [vStrikes, vWarn, vBeat, vRuns].forEach((d) => { d.textContent = '–'; });
        admit.hidden = true; restore.hidden = true; reason.hidden = true; scoreCard.hidden = true;
      } else {
        name.textContent = a.name;
        sub.textContent = 'Signed in from this browser';
        const [sl, sc] = STATUS[a.status] || ['', 'neutral'];
        const [il, ic] = INTEGRITY[a.integrity];
        pills.replaceChildren(h('span', { class: 'pill ' + sc, text: sl }), h('span', { class: 'pill ' + ic, text: il }));
        vStrikes.textContent = String(a.strikes);
        vWarn.textContent = String(a.warnings);
        vBeat.textContent = a.status === 'active' ? Math.max(0, Math.round((Date.now() - st.lastBeat) / 1000)) + 's ago' : '–';
        vBeat.classList.toggle('late', a.status === 'active' && Date.now() - st.lastBeat > 6000);
        vRuns.textContent = String(a.runs);
        admit.hidden = a.status !== 'waiting';
        restore.hidden = a.integrity !== 'invalidated';
        reason.hidden = a.integrity === 'clean';
        if (a.integrity === 'invalidated') reason.textContent = `Invalidated silently at ${clock(a.invalidatedAt)}: ${(LABEL[a.reason] || a.reason).toLowerCase()}. The student wasn't told.`;
        if (a.integrity === 'restored') reason.textContent = 'Restored by the teacher. The raw score counts again.';
        scoreCard.hidden = !a.result;
        if (a.result) {
          const auto = a.result.max - a.result.pendingCode;
          const final = a.integrity === 'invalidated' ? 0 : a.result.score;
          score.replaceChildren(
            h('p', { class: 'tp-big' }, h('span', { text: String(final) }), h('span', { class: 'tp-sub', text: ` / ${auto} auto-graded points` })),
            a.integrity === 'invalidated' ? h('p', { class: 'tp-sub', text: `Raw score ${a.result.score} is kept in case you restore.` }) : null,
            h('p', { class: 'tp-sub', text: `${a.result.pendingCode} code points are graded by the runner's hidden tests (not part of this demo).` }));
        }
      }
      if (st.mouse.length !== lastMouseLen) {
        lastMouseLen = st.mouse.length;
        drawTrail(st.mouse);
        trailNote.textContent = st.mouse.length ? `${st.mouse.length} samples at up to 10 per second.` : 'Starts recording when the quiz starts.';
      }
      if (st.events.length !== lastEventsLen) {
        lastEventsLen = st.events.length;
        const items = st.events.slice(-80).reverse().map((e) => h('li', { class: 'tp-ev ' + e.severity },
          h('span', { class: 'tp-time', text: clock(e.t) }),
          h('span', { class: 'tp-what' }, h('span', { class: 'tp-label', text: LABEL[e.type] || e.type }), e.detail ? h('span', { class: 'tp-detail', text: e.detail }) : null),
          h('span', { class: 'tp-sev', text: SEV[e.severity] || '' })));
        logList.replaceChildren(...(items.length ? items : [h('li', { class: 'tp-empty', text: 'Nothing yet.' })]));
      }
    }

    t.subscribe(render);
    const redraw = () => { lastMouseLen = -1; if (lastState) render(lastState); };
    window.addEventListener('resize', redraw);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  }

  BQ.teacherPanel = { mount };
})();
