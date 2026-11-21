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
  let size = null; // the student's window
  let trail = []; // [[t, x, y, click]], x and y out of 1000
  const views = []; // [[t, view]] still to show
  let pendingAnswers = null;
  let frameReady = false;
  let lastClick = 0;
  let status = '';

  $('w-close').addEventListener('click', () => window.close());
  frame.src = `/teacher/watch-frame.html?attempt=${encodeURIComponent(id)}`;

  const show = (text) => { msg.textContent = text; msg.hidden = !text; };
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

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
  function apply(view, answers) {
    const app = frame.contentWindow && frame.contentWindow.BQ && frame.contentWindow.BQ.app;
    if (!app || !app.watch) return false;
    return app.watch(view, answers);
  }

  async function poll() {
    let r;
    try {
      const res = await fetch(`/api/t/attempts/${encodeURIComponent(id)}/watch?since=${since}&ver=${encodeURIComponent(ver)}`, { credentials: 'same-origin' });
      if (res.status === 401) { show('Sign in to the teacher dashboard again, then reopen Watch.'); return; }
      if (!res.ok) { show("Can't find this student's quiz."); return; }
      r = await res.json();
    } catch (e) {
      $('w-live').classList.add('off');
      setTimeout(poll, 2000);
      return;
    }
    $('w-live').classList.remove('off');
    skew = r.now - Date.now();
    document.title = `Watching ${r.name}`;
    $('w-name').textContent = `Watching ${r.name}`;
    $('w-away').hidden = !(r.away && r.status === 'active');
    $('w-left').textContent = r.timeLeft != null ? `${mmss(r.timeLeft)} left` : '';
    status = r.status;
    if (r.trail && r.trail.length) {
      trail = trail.concat(r.trail).filter((p) => p[0] > r.now - 30000);
      since = trail[trail.length - 1][0];
    }
    if (r.view && (!views.length || views[views.length - 1][0] !== r.viewAt)) views.push([r.viewAt, r.view]);
    if (r.answers !== undefined) { pendingAnswers = { at: r.now, answers: r.answers }; ver = r.ver; }
    if (r.status === 'submitted') show('Turned in.');
    else if (r.status !== 'active') show("They haven't started yet.");
    else if (!r.view) show('Waiting for their screen…');
    else if (frameReady) show('');
    setTimeout(poll, r.status === 'active' ? 1000 : 3000);
  }

  // Playback, a few seconds behind live: screens and answers when their time comes, the cursor along its path.
  function tick() {
    const t = Date.now() + skew - DELAY;
    const due = pendingAnswers && t >= pendingAnswers.at - 1500 ? pendingAnswers.answers : undefined;
    let used = false;
    while (views.length && views[0][0] <= t) {
      const v = views[0][1];
      if (!size || size.w !== v.w || size.h !== v.h) { size = { w: v.w, h: v.h }; screen.hidden = false; fit(); }
      const shown = apply(v, used ? undefined : due);
      if (!shown) break; // the frame isn't up yet: next time
      views.shift();
      used = true;
      if (!frameReady) { frameReady = true; if (status === 'active') show(''); }
      $('w-where').textContent = shown.where;
    }
    if (due !== undefined && !used && frameReady && apply(null, due)) used = true; // new answers, same screen
    if (used && due !== undefined) pendingAnswers = null;
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
