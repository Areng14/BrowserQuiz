// Screen marks (server marks.js): this attempt's code, painted faintly into the quiz screen's lines (the
// header's bottom line, the footer's top line, a line between the question and its answers, and each answer
// box's top and bottom edges), so a photo of the screen shows whose it was. A line repeats the code in two
// tones that blend into each other, so it still reads as a plain line: the line's own colour and one a little
// further from the page's background, so the line never fades into it. The dashboard's Trace a photo reads
// it back (teacher/trace).
import { S } from './state.js';

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's base 32, as the server makes them
// Whitening, so no code is a long repeat; and the check bits. The reader (teacher/trace/reader.js) undoes both.
const MASK = [1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0];
const HALF = 4; // CSS pixels per half cell
const STEP = 22; // the difference between the two tones, out of 255 (less doesn't survive blur or a dark room)
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

// A line's marks as an image, w by h CSS pixels at the screen's own pixel size, kept for reuse (the screen
// redraws on every change under the question, and most of the time nothing about the lines has changed).
const made = new Map();
function image(w, h, base, offset) {
  const dpr = window.devicePixelRatio || 1, W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  const key = [W, H, base.join(','), offset, dpr, S.mark].join('|');
  if (made.has(key)) return made.get(key);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), px = img.data, pat = S.markPattern, n = pat.length;
  const at = (k) => pat[((k % n) + n) % n];
  const sm = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / dpr + offset) / HALF, i = Math.floor(u), f = u - i;
    let v = at(i);
    if (f < RAMP / 2) v = at(i - 1) + (at(i) - at(i - 1)) * sm((f + RAMP / 2) / RAMP);
    else if (f > 1 - RAMP / 2) v = at(i) + (at(i + 1) - at(i)) * sm((f - 1 + RAMP / 2) / RAMP);
    const col = base.map((ch) => Math.max(0, Math.min(255, Math.round(ch + (v * STEP) / 2))));
    for (let y = 0; y < H; y++) { const j = (y * W + x) * 4; px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2]; px[j + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  const url = `url("${c.toDataURL('image/png')}")`;
  if (made.size > 64) made.clear();
  made.set(key, url);
  return url;
}

// An element's marked edges, drawn by its ::before (app.css) from these images, so the element's own
// children stay as they were (the footer lays out its first and last child). edges: { top, bottom }, each a
// pattern offset or absent; thick: px (2 on the header, footer and question line, so they carry more);
// inset: px kept clear at each end (rounded corners).
function mark(el, edges, thick, inset) {
  const cs = getComputedStyle(el), w = el.clientWidth - 2 * inset;
  el.style.setProperty('--sm-th', thick + 'px');
  el.style.setProperty('--sm-in', inset + 'px');
  for (const [side, img, bw] of [['top', '--sm-t', '--sm-bwt'], ['bottom', '--sm-b', '--sm-bwb']]) {
    const Side = side === 'top' ? 'Top' : 'Bottom';
    el.style.setProperty(bw, (parseFloat(cs[`border${Side}Width`]) || 0) + 'px'); // over the border, and into the box when thicker
    if (edges[side] == null || w < 1) { el.style.setProperty(img, 'none'); continue; }
    // the two tones: the line's colour and STEP further from the background (lighter in dark mode, darker in light)
    const line0 = rgb(cs[`border${Side}Color`]);
    const away = 0.299 * line0[0] + 0.587 * line0[1] + 0.114 * line0[2] < 128 ? 1 : -1, base = line0.map((c) => c + (away * STEP) / 2);
    el.style.setProperty(img, image(w, thick, base, edges[side]));
  }
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
  if (bar) mark(bar, { bottom: 0 }, 2, 0);
  if (nav) mark(nav, { top: 191 }, 2, 0);
  divider();
  const div = S.el.main.querySelector('.bq-sm-div');
  if (div) mark(div, { top: 283 }, 2, 0);
  // answer boxes: not one that's picked (its edge is the accent colour then)
  S.el.main.querySelectorAll('.choice').forEach((box, k) => {
    const picked = !!box.querySelector('input:checked');
    mark(box, picked ? {} : { top: 37 + k * 53, bottom: 89 + k * 53 }, 1, parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0);
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
