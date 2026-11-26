// Building the page: elements, toasts, fullscreen and the keys held while in it.

import { ERRORS, S, cfg, root } from './state.js';

// ---------- helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}
const errorText = (e) => ERRORS[e && e.code] || ERRORS.network;
// A new screen: the tab title says what it is, and reading starts at its heading unless the screen
// put focus in a field itself.
const mount = (node) => {
  root.replaceChildren(node);
  const head = node.querySelector && node.querySelector('h1');
  if (head) document.title = `${head.textContent} - BrowserQuiz`;
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!head || !head.isConnected || (a && a !== document.body && root.contains(a))) return;
    head.tabIndex = -1;
    head.focus({ preventScroll: true });
  });
};
const demoHint = (...kids) => (cfg.demo ? h('p', { class: 'demo-hint' }, ...kids) : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Screen readers hear it through the quiz's live region, which is always on the page; a status element
// added already filled often isn't read.
function announce(msg) {
  const el = S.el && S.el.live;
  if (!el || !el.isConnected) return false;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 50);
  return true;
}
function toast(msg, ms) {
  const host = (S.el && S.el.wrap) || root;
  let t = host.querySelector('.toast');
  if (!t) {
    t = h('div', { class: 'toast' });
    host.append(t);
  }
  if (!announce(msg)) t.setAttribute('role', 'status');
  t.textContent = msg;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.remove(), ms || 2600);
}

let keysHeld = false;
async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Hold Escape (so it can't drop out of fullscreen by accident), and the keys that switch windows:
    // Tab for Alt+Tab and Ctrl+Tab, and the Windows key, which sits where a stray finger opens the Start
    // menu. The page gets them instead (monitor.js). Holding Escape for two seconds still exits.
    keysHeld = false;
    if (navigator.keyboard && navigator.keyboard.lock) {
      navigator.keyboard.lock(['Escape', 'Tab', 'MetaLeft', 'MetaRight']).then(() => { keysHeld = true; }).catch(() => {});
    }
    return true;
  } catch (e) {
    return false;
  }
}
function exitFullscreen() {
  if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
  keysHeld = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// The page itself never scrolls (index.html): if something nudges it anyway (find in page, a field
// brought into view, the browser putting back an old scroll), the bars would end up off the edge. Put it
// back. Not on phones, where the keyboard moves the page to show the field being typed in.
if (window.matchMedia('(pointer: fine)').matches) {
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, { passive: true });
}

export { announce, demoHint, enterFullscreen, errorText, exitFullscreen, h, keysHeld, mount, plural, toast };
