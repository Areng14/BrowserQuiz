// Screen marks (server marks.js): this attempt's code, painted faintly into the quiz screen's lines (the
// header's bottom line, the footer's top line, a line between the question and its answers, and each answer
// box's top and bottom edges), so a photo of
// the screen shows whose it was. A line repeats the code in two tones of its own colour that blend into each
// other, so it still reads as a plain line. The dashboard's Trace a photo reads it back (teacher/trace).
import { S } from './state.js';

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's base 32, as the server makes them
// Whitening, so no code is a long repeat; and the check bits. The reader (teacher/trace/reader.js) undoes both.
const MASK = [1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0];
const HALF = 4; // CSS pixels per half cell
const STEP = 14; // the difference between the two tones, out of 255 (10 was too faint on big screens)
const RAMP = 0.6; // how much of a half cell blends into the next

function crc7(bits) { // x^7 + x^3 + 1
  let r = 0;
  for (const b of bits) { const top = ((r >> 6) & 1) ^ b; r = (r << 1) & 0x7f; if (top) r ^= 0x09; }
  return Array.from({ length: 7 }, (_, i) => (r >> (6 - i)) & 1);
}
// +1 light, -1 dark, one per half cell: a start (3 light, 3 dark), then a light-dark pair for each 1 and
// a dark-light pair for each 0
function pattern(code) {
  const data = [];
  for (const ch of code) { const v = ALPHA.indexOf(ch); for (let i = 4; i >= 0; i--) data.push((v >> i) & 1); }
  const bits = data.concat(crc7(data)).map((b, i) => b ^ MASK[i]);
  const p = [1, 1, 1, -1, -1, -1];
  for (const b of bits) p.push(b ? 1 : -1, b ? -1 : 1);
  return p;
}
const rgb = (css) => (String(css).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);

function paint(canvas, pat, base, offset) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h), px = img.data, n = pat.length;
  const at = (k) => pat[((k % n) + n) % n];
  const sm = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) / dpr + offset) / HALF, i = Math.floor(u), f = u - i;
    let v = at(i);
    if (f < RAMP / 2) v = at(i - 1) + (at(i) - at(i - 1)) * sm((f + RAMP / 2) / RAMP);
    else if (f > 1 - RAMP / 2) v = at(i) + (at(i + 1) - at(i)) * sm((f - 1 + RAMP / 2) / RAMP);
    const c = base.map((ch) => Math.max(0, Math.min(255, Math.round(ch + (v * STEP) / 2))));
    for (let y = 0; y < h; y++) { const j = (y * w + x) * 4; px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}

// One line: a canvas laid over an edge of el. side: 'top' or 'bottom'; inset: px kept clear at each end
// (rounded corners); thick: px (2 on the header and footer, so the line carries more).
function line(el, side, inset, thick, offset) {
  let c = el.querySelector(`:scope > canvas.bq-sm-${side}`);
  if (!c) {
    c = document.createElement('canvas');
    c.className = 'bq-sm bq-sm-' + side;
    c.setAttribute('aria-hidden', 'true');
    el.append(c);
  }
  const bw = parseFloat(getComputedStyle(el)[side === 'top' ? 'borderTopWidth' : 'borderBottomWidth']) || 0;
  // a canvas keeps its own width unless it's given one (left and right alone don't stretch it)
  Object.assign(c.style, { left: inset + 'px', width: `calc(100% - ${2 * inset}px)`, height: thick + 'px', top: '', bottom: '' });
  c.style[side] = -bw + 'px'; // over the border, and into the box when thicker than it
  const base = rgb(getComputedStyle(el)[side === 'top' ? 'borderTopColor' : 'borderBottomColor']);
  paint(c, S.markPattern, base, offset);
}

// The line between a question and its answers: after the question's text (and picture), when an answer
// comes after it. Not on code questions (side by side), directions, the review page or the paused screen.
function divider() {
  const view = S.el.main.querySelector(':scope > .qview, :scope > .shared-split > .qview');
  if (!view || view.matches('.wide, .intro, .review, .paused-view') || view.querySelector(':scope > .bq-sm-div')) return;
  const ask = [...view.children].filter((el) => el.matches('.prompt, .qimg')).pop();
  if (ask && ask.nextElementSibling) ask.after(Object.assign(document.createElement('div'), { className: 'bq-sm-div' }));
}

function draw() {
  if (!S.mark || !S.el || !S.el.wrap.isConnected) return;
  S.markPattern = S.markPattern || pattern(S.mark);
  const bar = S.el.wrap.querySelector('.qbar'), nav = S.el.nav;
  if (bar) line(bar, 'bottom', 0, 2, 0);
  if (nav) line(nav, 'top', 0, 2, 191);
  divider();
  const div = S.el.main.querySelector('.bq-sm-div');
  if (div) line(div, 'top', 0, 2, 283);
  // answer boxes: not one that's picked (its edge is the accent colour then)
  S.el.main.querySelectorAll('.choice').forEach((box, k) => {
    const picked = !!box.querySelector('input:checked');
    box.querySelectorAll(':scope > canvas.bq-sm').forEach((c) => { c.hidden = picked; });
    if (picked) return;
    const r = parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0;
    line(box, 'top', r, 1, 37 + k * 53);
    line(box, 'bottom', r, 1, 89 + k * 53);
  });
}
let queued = false;
const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };

// After the quiz screen is up (screenQuiz): draw now, and again when the window, the theme, the question
// on screen or a picked answer changes.
function startMarks() {
  if (!S.mark || !S.el) return;
  S.el.wrap.classList.add('marked');
  divider();
  draw();
  const ro = new ResizeObserver(later);
  ro.observe(S.el.wrap);
  // a new question gets its line before the page paints (no jump), and its marks on the next frame
  new MutationObserver(() => { divider(); later(); }).observe(S.el.main, { childList: true, subtree: true });
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  S.el.main.addEventListener('change', later);
}

export { startMarks };
