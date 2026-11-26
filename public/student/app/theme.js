// Light and dark.

import { S, THEME_KEY, root } from './state.js';
import { h } from './dom.js';
import { colorize, editorTheme } from './monaco.js';
import { renderQuestion } from './quiz.js';

// ---------- light / dark ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t === 'dark';
  return darkQuery.matches;
}
// The page's address: ?code=ABC123, and in Safe Exam Browser maybe the dark mode they picked before it
// opened (screenSebLaunch), which SEB for Mac and iPad add with a second "?" instead of "&".
function pageParams() {
  try { return new URLSearchParams(location.search.slice(1).replace(/\?/g, '&')); } catch (e) { return new URLSearchParams(); }
}
const askedTheme = pageParams().get('theme');
if (askedTheme === 'dark' || askedTheme === 'light') {
  document.documentElement.dataset.theme = askedTheme;
  try { localStorage.setItem(THEME_KEY, askedTheme); } catch (e) { /* this page only */ }
} else {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch (e) { /* storage blocked: follow the system */ }
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
function themeIcon(sun) {
  const s = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  if (sun) {
    s.append(svgEl('circle', { cx: 12, cy: 12, r: 4 }), svgEl('path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' }));
  } else {
    s.append(svgEl('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }));
  }
  return s;
}
function penIcon() {
  const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: 'M12 20h9' }), svgEl('path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z' }));
  return s;
}
// A pass/fail mark as a drawn icon, so phones don't swap in their own emoji.
function markIcon(pass) {
  const s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: pass ? 'M20 6L9 17l-5-5' : 'M18 6L6 18M6 6l12 12' }));
  return s;
}
function paintThemeButton(b) {
  const dark = isDark();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.replaceChildren(themeIcon(dark));
}
function themeButton() {
  const b = h('button', { type: 'button', class: 'theme-btn' });
  paintThemeButton(b);
  b.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered, still switched */ }
    onThemeChange();
  });
  return b;
}
function onThemeChange() {
  if (root) root.querySelectorAll('.theme-btn').forEach(paintThemeButton);
  if (window.monaco) window.monaco.editor.setTheme(editorTheme());
  // Colored code keeps the old theme's color classes, which point at the wrong colors after a switch.
  // Redraw it: the question on screen, or any other colored blocks.
  if (S && S.kept) for (const n of S.kept.values()) n.querySelectorAll('code[data-colored]').forEach((c) => c.removeAttribute('data-colored'));
  if (S && S.el && S.quiz && !S.done) renderQuestion();
  else if (root) {
    root.querySelectorAll('code[data-colored]').forEach((c) => { c.textContent = c.textContent; c.removeAttribute('data-colored'); });
    colorize(root);
  }
}
darkQuery.addEventListener('change', onThemeChange);
new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

export { isDark, markIcon, onThemeChange, pageParams, penIcon, svgEl, themeButton };
