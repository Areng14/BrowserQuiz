// Typing replay: how a student wrote a code answer, played back edit by edit (server: /api/t/attempts/:id/replay,
// recorded by monitor.js). Code that appears fully formed, without typos or rewrites, is the sign of
// copying it from somewhere else; long pauses and many rewrites are what working it out looks like.
// Used by the dashboard's student panel and the report page. window.BQReplay.open(attemptId, q, n).
(function () {
  'use strict';
  const cache = new Map(); // attempt id -> Promise of { question id: edits }
  const PAUSE_CAP = 1500; // a long pause plays as this long, at 1x
  const SNAP = 100; // keep the text every this many steps, so jumping around stays fast
  const LANGS = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust' };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter((x) => x != null && x !== false));
    return el;
  }
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function load(attemptId) {
    if (!cache.has(attemptId)) {
      const p = fetch(`/api/t/attempts/${encodeURIComponent(attemptId)}/replay`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Couldn't load the replay (${r.status}).`)))).then((d) => d.edits || {});
      p.catch(() => cache.delete(attemptId));
      cache.set(attemptId, p);
    }
    return cache.get(attemptId);
  }

  // One language's edits as steps: the text after each, what changed, and the numbers for the stats line.
  // Replays start from a snapshot of what was in the box (init); edits before the first one can't be placed.
  function build(edits) {
    const steps = []; // { t, ch, init }
    let started = false;
    for (const e of edits) {
      if (typeof e.init === 'string') { started = true; steps.push({ t: e.t, init: e.init }); } else if (started && e.ch && e.ch.length) steps.push({ t: e.t, ch: e.ch });
    }
    const snaps = [];
    let text = '';
    let typed = 0;
    let deleted = 0;
    let biggest = 0;
    let pause = 0;
    steps.forEach((s, i) => {
      text = apply(text, s);
      if (s.ch) for (const [, len, ins] of s.ch) { typed += ins.length; deleted += len; biggest = Math.max(biggest, ins.length); }
      if (i) pause = Math.max(pause, s.t - steps[i - 1].t);
      if (i % SNAP === 0) snaps.push(text);
    });
    return { steps, snaps, final: text, stats: { typed, deleted, biggest, pause } };
  }
  // Monaco lists a change's pieces from the end of the text back, each against the text before the edit,
  // so they apply in order.
  function apply(text, s) {
    if (s.init != null) return s.init;
    for (const [off, len, ins] of s.ch) {
      const at = Math.max(0, Math.min(text.length, off));
      text = text.slice(0, at) + ins + text.slice(Math.min(text.length, at + Math.max(0, len)));
    }
    return text;
  }
  // The code with its colors (report-view's tokens, the report's code colors) and the newest change marked.
  // m: Monaco, or null to show it plain. Text only ever goes in as text.
  function paint(el, text, lang, from, to, m) {
    const R = window.BQReport;
    let tokens = null;
    if (m && lang && R && R.tokenClass) { try { tokens = m.editor.tokenize(text, lang); } catch (e) { tokens = null; } }
    const segs = []; // [start, end, class]
    let base = 0;
    text.split('\n').forEach((line, li, lines) => {
      const lt = tokens ? tokens[li] || [] : [];
      if (!lt.length) segs.push([base, base + line.length, '']);
      lt.forEach((t, k) => {
        const s = base + t.offset;
        const e = base + (k + 1 < lt.length ? lt[k + 1].offset : line.length);
        if (e > s) segs.push([s, e, R.tokenClass(t.type)]);
      });
      if (li < lines.length - 1) segs.push([base + line.length, base + line.length + 1, '']);
      base += line.length + 1;
    });
    const frag = document.createDocumentFragment();
    let mark = null;
    const put = (s, e, cls) => {
      if (e <= s) return;
      const piece = text.slice(s, e);
      const node = cls ? h('span', { class: cls, text: piece }) : document.createTextNode(piece);
      if (from != null && s >= from && e <= to) {
        if (!mark) { mark = h('mark'); frag.append(mark); }
        mark.append(node);
      } else { mark = null; frag.append(node); }
    };
    for (const [s, e, cls] of segs) {
      if (from == null || e <= from || s >= to) put(s, e, cls);
      else { put(s, Math.max(s, from), cls); put(Math.max(s, from), Math.min(e, to), cls); put(Math.min(e, to), e, cls); }
    }
    if (!text) frag.append(' ');
    el.replaceChildren(frag);
  }

  function textAt(r, i) {
    let text = r.snaps[Math.floor(i / SNAP)];
    for (let k = Math.floor(i / SNAP) * SNAP + 1; k <= i; k++) text = apply(text, r.steps[k]);
    return text;
  }

  // n: the question's number as the report shows it. final: the answer as turned in, to say when the
  // recording doesn't add up to it (heartbeats lost for good, or the cap on recorded edits).
  async function open(attemptId, questionId, n, final) {
    const back = document.activeElement;
    const close = h('button', { class: 'rp-btn', type: 'button', text: 'Close' });
    const title = h('h2', { id: 'rp-title', text: `Typing replay, question ${n}` });
    const body = h('div', { class: 'rp-body' }, h('p', { class: 'rp-note', text: 'Loading…' }));
    const dlg = h('dialog', { class: 'rp-dialog', 'aria-labelledby': 'rp-title' }, h('header', { class: 'rp-head' }, title, close), body);
    // the editor's tokenizer, for colors: loading while the replay loads; plain if it can't
    const monacoP = window.BQReport && window.BQReport.loadMonaco ? window.BQReport.loadMonaco().catch(() => null) : Promise.resolve(null);
    let timer = 0;
    close.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { clearTimeout(timer); dlg.remove(); if (back && back.isConnected) back.focus({ preventScroll: true }); });
    (document.querySelector('.t-app') || document.body).append(dlg); // in the dashboard, under its theme
    dlg.showModal();
    close.focus();
    let all;
    try { all = await load(attemptId); } catch (e) { body.replaceChildren(h('p', { class: 'rp-note', text: e.message })); return; }
    const M = await monacoP;
    const mine = (all[questionId] || []);
    const langs = [...new Set(mine.filter((e) => typeof e.init === 'string').map((e) => e.l || ''))];
    if (!langs.length) {
      body.replaceChildren(h('p', { class: 'rp-note', text: mine.length ? 'This answer was typed before replays were recorded.' : 'No typing recorded for this answer.' }));
      return;
    }
    // the language they turned in: the one whose replay ends where their answer does, or the last one used
    const runs = new Map(langs.map((l) => [l, build(mine.filter((e) => (e.l || '') === l))]));
    let lang = langs.find((l) => final != null && runs.get(l).final === final) || mine.filter((e) => langs.includes(e.l || '')).pop().l || langs[0];

    const code = h('pre', { class: 'rp-code', tabindex: '0', 'aria-label': 'The code at this point' });
    const play = h('button', { class: 'rp-btn rp-play', type: 'button', text: 'Play' });
    const slider = h('input', { class: 'rp-slider', type: 'range', min: '0', step: '1', 'aria-label': 'Step' });
    const at = h('span', { class: 'rp-time', 'aria-live': 'off' });
    const speed = h('select', { class: 'rp-select', 'aria-label': 'Speed' }, [1, 2, 5, 10].map((x) => h('option', { value: String(x), text: `${x}×`, selected: x === 2 })));
    const langSel = langs.length > 1 ? h('select', { class: 'rp-select', 'aria-label': 'Language' }, langs.map((l) => h('option', { value: l, text: LANGS[l] || l || 'Code', selected: l === lang }))) : null;
    const stats = h('p', { class: 'rp-stats' });
    const note = h('p', { class: 'rp-note', hidden: true, text: "Some of the typing wasn't recorded, so this doesn't end at the answer they turned in." });
    body.replaceChildren(h('div', { class: 'rp-controls' }, play, slider, at, speed, langSel), code, stats, note);

    let r;
    let i = 0;
    function show() {
      const text = textAt(r, i);
      const s = r.steps[i];
      // the newest change, marked: what was just typed (one piece; several at once aren't marked)
      const one = s && s.ch && s.ch.length === 1 ? s.ch[0] : null;
      const from = one && one[2] ? Math.max(0, Math.min(text.length, one[0])) : null;
      paint(code, text, lang, from, from == null ? null : from + one[2].length, M);
      const m = code.querySelector('mark');
      if (m && !playingUser) m.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      slider.value = String(i);
      const t0 = r.steps[0].t;
      at.textContent = `${clock(r.steps[i].t - t0)} / ${clock(r.steps[r.steps.length - 1].t - t0)}`;
    }
    let playingUser = false; // the teacher is dragging the slider: don't jump the code around
    function stop() { clearTimeout(timer); timer = 0; play.textContent = 'Play'; }
    function tick() {
      if (i >= r.steps.length - 1) { stop(); return; }
      const gap = Math.min(PAUSE_CAP, Math.max(0, r.steps[i + 1].t - r.steps[i].t)) / Number(speed.value);
      timer = setTimeout(() => { i++; show(); tick(); }, Math.max(16, gap));
    }
    function pick(l) {
      stop();
      lang = l;
      r = runs.get(l);
      i = 0;
      slider.max = String(r.steps.length - 1);
      const st = r.stats;
      stats.textContent = `${st.typed} characters typed · ${st.deleted} deleted · longest pause ${clock(st.pause)} · biggest single insert ${st.biggest} characters`;
      note.hidden = final == null || r.final === final;
      show();
    }
    play.addEventListener('click', () => {
      if (timer) { stop(); return; }
      if (i >= r.steps.length - 1) i = 0;
      play.textContent = 'Pause';
      show();
      tick();
    });
    slider.addEventListener('input', () => { stop(); playingUser = true; i = Number(slider.value) || 0; show(); playingUser = false; });
    if (langSel) langSel.addEventListener('change', () => pick(langSel.value));
    pick(lang);
    i = r.steps.length - 1; // open on the finished answer; Play starts from the beginning
    show();
    play.focus();
  }

  window.BQReplay = { open, build };
})();
