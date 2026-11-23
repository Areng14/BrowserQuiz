// Watch a student live: their quiz in a frame the size of their window (watch-frame.html), following the
// page they're on, their scrolling and answers, with their mouse played back along its path. It runs a few
// seconds behind, so the cursor moves smoothly between heartbeats instead of jumping.
(function () {
  'use strict';
  const id = new URLSearchParams(location.search).get('attempt') || '';
  const $ = (x) => document.getElementById(x);
  const stage = $('w-stage');
  const screen = $('w-screen');
  const frame = $('w-frame');
  const cursor = $('w-cursor');
  const msg = $('w-msg');
  const DELAY = 2500; // how far behind live the playback runs
  frame.setAttribute('inert', '');

  let skew = 0; // server clock minus ours
  let since = 0; // newest trail point we have
  let ver = ''; // version of the answers the frame has
  let xver = ''; // and of their run results and scratchpad
  let size = null; // the student's window
  let trail = []; // [[t, x, y, click]], x and y out of 1000
  const views = []; // [[t, view]] still to show
  let pendingAnswers = null;
  let pendingExtra = null;
  let deadline; // theirs, for the clock in their top bar (extra time moves it)
  let wasActive = false; // seen working: when they turn in, play it instead of just saying so
  let doneQueued = false;
  let frameReady = false;
  let lastClick = 0;
  let status = '';

  let runId = '';
  $('w-close').addEventListener('click', () => {
    window.close();
    // a tab the browser won't close (opened by hand, or with history): back to the run instead
    setTimeout(() => { if (!window.closed) location.href = runId ? `/teacher/#run/${encodeURIComponent(runId)}` : '/teacher/'; }, 150);
  });
  // Caught them: invalidate from here (or restore). Their screen stays the same either way.
  let name = '';
  let invalidated = false;
  const integrityBtn = $('w-integrity');
  integrityBtn.addEventListener('click', async () => {
    let body = {};
    if (invalidated) { if (!(await window.BQAsk.confirm({ title: `Un-invalidate ${name}?`, ok: 'Un-invalidate' }))) return; } else {
      const note = await window.BQAsk.ask({ title: `Invalidate ${name}?`, label: 'Reason (optional)', ok: 'Invalidate', danger: true });
      if (note === null) return;
      body = { note };
    }
    integrityBtn.disabled = true;
    try {
      const res = await fetch(`/api/t/attempts/${encodeURIComponent(id)}/${invalidated ? 'restore' : 'invalidate'}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) setIntegrity(!invalidated);
    } catch (e) { /* the next poll shows where it stands */ }
    integrityBtn.disabled = false;
  });
  function setIntegrity(bad) {
    invalidated = bad;
    $('w-state').hidden = !bad;
    integrityBtn.textContent = bad ? 'Un-invalidate' : 'Invalidate';
    integrityBtn.setAttribute('aria-label', `${bad ? 'Un-invalidate' : 'Invalidate'} ${name}`);
    integrityBtn.hidden = false;
  }
  frame.src = `/teacher/watch-frame.html?attempt=${encodeURIComponent(id)}`;

  const show = (text) => { msg.textContent = text; msg.hidden = !text; };

  function fit() {
    if (!size) return;
    const pad = 16;
    const k = Math.min((stage.clientWidth - pad * 2) / size.w, (stage.clientHeight - pad * 2) / size.h, 1.5); // up to 1.5x on big screens
    screen.style.width = size.w + 'px';
    screen.style.height = size.h + 'px';
    const left = Math.max(pad, (stage.clientWidth - size.w * k) / 2);
    screen.style.transform = `translate(${left}px, ${pad}px) scale(${k})`;
  }
  window.addEventListener('resize', fit);

  // Whatever the frame's app says it can show yet.
  function apply(view, answers, extra) {
    const app = frame.contentWindow && frame.contentWindow.BQ && frame.contentWindow.BQ.app;
    if (!app || !app.watch) return false;
    return app.watch(view, answers, extra);
  }

  // Polls for good: a slip in handling one answer mustn't stop the watching.
  let lastStatus = '';
  async function poll() {
    try { await pollOnce(); } catch (e) { /* the next poll tries again */ }
    setTimeout(poll, lastStatus === 'active' ? 1000 : 3000);
  }
  async function pollOnce() {
    let r;
    try {
      const res = await fetch(`/api/t/attempts/${encodeURIComponent(id)}/watch?since=${since}&ver=${encodeURIComponent(ver)}&xver=${encodeURIComponent(xver)}`, { credentials: 'same-origin' });
      if (res.status === 401) { show('Sign in to the teacher dashboard again, then reopen Watch.'); return; }
      if (!res.ok) { show("Can't find this student's quiz."); return; }
      r = await res.json();
    } catch (e) {
      $('w-live').classList.add('off');
      lastStatus = '';
      return;
    }
    $('w-live').classList.remove('off');
    lastStatus = r.status;
    skew = r.now - Date.now();
    document.title = `Watching ${r.name}`;
    name = r.name;
    runId = r.runId || runId;
    if (!integrityBtn.disabled) setIntegrity(r.integrity === 'invalidated');
    $('w-name').textContent = `Watching ${r.name}`;
    $('w-away').hidden = !(r.away && r.status === 'active');
    status = r.status;
    if (r.trail && r.trail.length) {
      since = r.trail[r.trail.length - 1][0];
      trail = trail.concat(r.trail).filter((p) => p[0] > r.now - 30000); // can be empty: a still mouse, older than that
    }
    if (r.view && (!views.length || views[views.length - 1][0] !== r.viewAt)) views.push([r.viewAt, r.view]);
    if (r.answers !== undefined) { pendingAnswers = { at: r.now, answers: r.answers }; ver = r.ver; }
    if (r.extra !== undefined) { pendingExtra = { at: r.now, extra: r.extra }; xver = r.xver; }
    if (r.status === 'active') wasActive = true;
    deadline = r.deadline || 0;
    if (r.status === 'submitted' && wasActive && !doneQueued) {
      doneQueued = true;
      views.push([Math.max(r.submittedAt || r.now, views.length ? views[views.length - 1][0] : 0), { done: r.ended || 'submitted' }]);
    }
    if (r.status === 'submitted') show(doneQueued ? '' : 'Turned in.');
    else if (r.status !== 'active') show("They haven't started yet.");
    else if (!r.view || !frameReady) show('Waiting for their screen…');
    else show('');
  }

  // Playback, a few seconds behind live: screens and answers when their time comes, the cursor along its path.
  function tick() {
    const t = Date.now() + skew - DELAY;
    const due = pendingAnswers && t >= pendingAnswers.at - 1500 ? pendingAnswers.answers : undefined;
    const dueX = pendingExtra && t >= pendingExtra.at - 1500 ? pendingExtra.extra : undefined;
    let used = false;
    let usedX = false;
    while (views.length && views[0][0] <= t) {
      const v = views[0][1];
      if (v.w && (!size || size.w !== v.w || size.h !== v.h)) { size = { w: v.w, h: v.h }; screen.hidden = false; fit(); }
      const shown = apply(v.done || deadline === undefined ? v : Object.assign({}, v, { deadline }), used ? undefined : due, usedX ? undefined : dueX);
      if (!shown) break; // the frame isn't up yet: next time
      views.shift();
      used = true;
      usedX = true;
      if (!frameReady) { frameReady = true; if (status === 'active') show(''); }
      $('w-where').textContent = shown.where;
    }
    if ((due !== undefined || dueX !== undefined) && !used && frameReady && apply(null, due, dueX)) { used = true; usedX = true; } // new answers, same screen
    if (used && due !== undefined) pendingAnswers = null;
    if (usedX && dueX !== undefined) pendingExtra = null;
    // The cursor: between the two samples around t.
    let k = 0;
    while (k < trail.length && trail[k][0] <= t) k++;
    const a = trail[k - 1];
    const b = trail[k];
    if (a && size) {
      let x = a[1];
      let y = a[2];
      if (b && b[0] - a[0] < 1000) { const f = (t - a[0]) / (b[0] - a[0]); x += (b[1] - a[1]) * f; y += (b[2] - a[2]) * f; }
      cursor.removeAttribute('hidden'); // an SVG: no .hidden property
      cursor.style.transform = `translate(${(x / 1000) * size.w}px, ${(y / 1000) * size.h}px)`;
      for (let j = 0; j < k; j++) {
        const p = trail[j];
        if (p[3] && p[0] > lastClick) {
          lastClick = p[0];
          const ring = document.createElement('div');
          ring.className = 'w-click';
          ring.style.left = (p[1] / 1000) * size.w + 'px';
          ring.style.top = (p[2] / 1000) * size.h + 'px';
          screen.append(ring);
          setTimeout(() => ring.remove(), 700);
        }
      }
      trail = trail.slice(Math.max(0, k - 2)); // what's been played can go
    }
    requestAnimationFrame(tick);
  }

  if (!id) { show('No student picked.'); return; }
  poll();
  requestAnimationFrame(tick);
})();
