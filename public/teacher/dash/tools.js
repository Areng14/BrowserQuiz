// Tools: things a teacher needs now and then. Trace a photo: whose quiz screen is in a photo, read from the
// screen marks (server marks.js, student/app/screenmark.js) by teacher/trace/worker.js, off the page's thread.

import { ICONS, api, day, h, icon, iconButton } from './core.js';

// What counts: a read that two lines agree on, or one very clean line (reader.js combine). Short of that,
// a best guess only when one student is well ahead of the next; never a name otherwise.
const GUESS_AT = 0.8;
const GUESS_LEAD = 0.25;

function toolsTab() {
  const view = h('div', { class: 't-tools' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) trace(view, f, () => file.click(), list); });
  const row = h('button', { class: 't-tool', type: 'button', onclick: () => file.click() },
    h('span', { class: 't-tool-ic' }, icon(ICONS.camera, 20)), h('span', { class: 't-tool-name', text: 'Trace a photo' }), icon(ICONS.next, 18));
  const list = () => view.replaceChildren(h('div', { class: 't-tool-list' }, row), file);
  list();
  return h('section', { class: 't-section' }, h('h1', { text: 'Tools' }), view);
}

// The photo, the lines read in it, and who it was. again(): pick another photo; back(): the list of tools.
async function trace(view, f, again, back) {
  const close = iconButton(h('button', { class: 'btn', type: 'button', onclick: back }), 'x', 'Close');
  const shot = h('canvas', { class: 't-trace-shot', role: 'img', 'aria-label': 'The photo' });
  const status = h('p', { class: 't-muted', role: 'status', text: 'Reading the photo…' });
  const bar = h('div', { class: 't-prog is-reading t-trace-bar' }, h('span', { style: 'width: 5%' }));
  const out = h('div', { class: 't-trace-out' }, status, bar);
  view.replaceChildren(h('div', { class: 't-head' }, close, h('h2', { class: 't-trace-title', text: 'Trace a photo' })),
    h('div', { class: 't-trace' }, h('div', { class: 't-trace-photo' }, shot), out));
  let bmp, marks;
  try { [bmp, marks] = await Promise.all([createImageBitmap(f), api('/api/t/marks')]); } catch (e) {
    return done(e.message === 'login' ? null : "That photo didn't open. Try another one.");
  }
  // the photo, fit to its box; the lines read are drawn on it once they're known
  const fit = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  shot.width = Math.round(bmp.width * fit); shot.height = Math.round(bmp.height * fit);
  shot.getContext('2d').drawImage(bmp, 0, 0, shot.width, shot.height);
  const byCode = new Map();
  for (const m of marks.marks) if (!byCode.has(m.code)) byCode.set(m.code, m); // newest first: a code given twice is the latest
  let w;
  try { w = new Worker('/teacher/trace/worker.js'); } catch (e) { return done("This browser can't read photos here. Try Chrome, Edge or Safari."); }
  w.onerror = () => { w.terminate(); done("That photo couldn't be read. Try another one."); };
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'reading') { bar.firstChild.style.width = Math.round(5 + (m.i / m.n) * 85) + '%'; return; }
    w.terminate();
    if (m.type !== 'done') return done("That photo couldn't be read. Try another one.");
    const ctx = shot.getContext('2d');
    ctx.strokeStyle = '#7ea3ff'; ctx.lineWidth = Math.max(3, shot.width / 300); ctx.lineCap = 'round';
    for (const [a, b] of m.lines) { ctx.beginPath(); ctx.moveTo(a.x * fit, a.y * fit); ctx.lineTo(b.x * fit, b.y * fit); ctx.stroke(); }
    const top = m.ranked[0], next = m.ranked[1];
    if (m.code && byCode.has(m.code)) return found(byCode.get(m.code), m.sure ? `${m.agree} lines agree` : 'Read from one line', 'st-good');
    if (top && top.score >= GUESS_AT && top.score - (next ? next.score : 0) >= GUESS_LEAD) return found(byCode.get(top.code), 'Not confirmed', 'st-warn', true);
    done(null, true);
  };
  w.postMessage({ bmp, codes: [...byCode.keys()] }, [bmp]);

  function found(who, note, cls, guess) {
    if (!who) return done('This mark is from a quiz that is no longer here.');
    const open = h('a', { class: 'btn' + (guess ? '' : ' primary'), href: `/teacher/report.html?attempt=${encodeURIComponent(who.attemptId)}`, target: '_blank', rel: 'noopener', text: 'Open attempt' });
    const retake = h('button', { class: 'btn' + (guess ? ' primary' : ''), type: 'button', onclick: again }, icon(ICONS.camera, 16), guess ? 'Retake photo' : 'Trace another');
    retake.classList.add('t-ib');
    out.replaceChildren(
      h('p', { class: 't-muted t-trace-of', text: 'Screen of' }),
      h('p', { class: 't-trace-who', text: who.name || 'A student' }),
      h('p', { class: 't-muted', text: `${who.quiz}, ${who.roster}, ${day(who.at)}` }),
      h('p', { class: cls, text: note }),
      h('div', { class: 't-trace-acts' }, guess ? [retake, open] : [open, retake]));
  }
  function done(problem, none) {
    const retry = h('button', { class: 'btn primary t-ib', type: 'button', onclick: again }, icon(ICONS.camera, 16), 'Try another photo');
    out.replaceChildren(
      h('p', { class: 't-trace-who', text: problem || (none ? 'No marks found' : 'Signed out') }),
      none ? h('p', { class: 't-muted', text: 'Get the whole screen in, straight on.' }) : null,
      h('div', { class: 't-trace-acts' }, retry));
  }
}

export { toolsTab };
