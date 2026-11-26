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
// Line icons (Lucide, from /icons.js): icon('lock', 16). The names are in scripts/build-icons.mjs.
function icon(name, size, attrs) { return window.BQIcons.svg(name, size, attrs); }
// A pass/fail mark as a drawn icon, so phones don't swap in their own emoji.
const markIcon = (pass) => icon(pass ? 'check' : 'x', 16, { 'stroke-width': 3 });
function paintThemeButton(b) {
  const dark = isDark();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.replaceChildren(icon(dark ? 'sun' : 'moon', 18));
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

export { icon, isDark, markIcon, onThemeChange, pageParams, svgEl, themeButton };
