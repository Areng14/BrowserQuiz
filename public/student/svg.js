// Diagrams (SVG) in quizzes: an assets/ file or a ```svg block in the text. Shared by the server (the check
// on upload) and the browser (drawing them).
//
// A diagram is always shown as an image (<img>), never put into the page, so nothing in it can run or load
// anything. Its colors come from a preset palette: drawn with these exact colors, a diagram follows the
// page's light and dark theme, each color swapped for its dark-mode partner. Black and white swap too, so a
// plain black-on-white diagram works in both. Other colors stay as they are.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQSvg = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // name: [light, dark] (the app's own colors)
  const PALETTE = {
    ink: ['#16191d', '#b4bac2'], // dark: softer than the page's text, so lines don't glare
    muted: ['#5b6470', '#9aa3ad'],
    line: ['#d9dde2', '#2e333b'],
    paper: ['#ffffff', '#16181d'],
    soft: ['#f4f5f7', '#1f2329'],
    blue: ['#2257d6', '#7ea3ff'],
    green: ['#1b7f45', '#5ccb8a'],
    red: ['#c0352d', '#ff7a70'],
    orange: ['#9a5b00', '#e2a64a'],
    yellow: ['#fff2b3', '#3a3300'],
    'light blue': ['#cfe2ff', '#13305a'],
    'light green': ['#c8f0d2', '#0f3a20'],
    pink: ['#ffd6e8', '#47162f'],
  };
  const DARK = new Map(Object.values(PALETTE));
  const NAMED = { black: '#000000', white: '#ffffff' };
  DARK.set('#000000', PALETTE.ink[1]);
  const MAX = 300000;

  // What's wrong with an SVG for a quiz, or null. Diagrams are pictures: no script, nothing loaded from
  // elsewhere, no HTML inside.
  function problem(text) {
    const t = String(text || '');
    if (t.length > MAX) return 'is bigger than 300 KB.';
    if (!/<svg[\s>]/i.test(t)) return "isn't an SVG (it needs an <svg> element).";
    if (/<!DOCTYPE|<!ENTITY/i.test(t)) return 'has a DOCTYPE or ENTITY. Take it out.';
    if (/<script[\s>]/i.test(t)) return 'has a <script>. Diagrams can\'t run code.';
    if (/<foreignObject[\s>]/i.test(t)) return 'has a <foreignObject>. Use SVG shapes and text only.';
    if (/\son[a-z]+\s*=/i.test(t)) return 'has an event handler (onclick, onload, ...). Take it out.';
    if (/(?:href|src)\s*=\s*["']\s*(?!#)[^"']/i.test(t) || /url\(\s*["']?\s*(?!#)/i.test(t) || /@import/i.test(t)) return 'links to something outside the diagram. Draw everything inside it.';
    return null;
  }

  // The SVG with its palette colors for the theme. Only colors in fill, stroke and the like change, so a
  // label that says "#ffffff" stays as it is.
  const COLOR = /((?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*(?:=\s*["']\s*|:\s*))(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|black\b|white\b|currentColor\b)/gi;
  const full = (c) => {
    const low = c.toLowerCase();
    if (NAMED[low]) return NAMED[low];
    if (low === 'currentcolor') return 'currentcolor';
    return low.length === 4 ? '#' + low[1] + low[1] + low[2] + low[2] + low[3] + low[3] : low;
  };
  function themed(text, dark) {
    return String(text).replace(COLOR, (m, before, c) => {
      const hex = full(c);
      if (hex === 'currentcolor') return before + (dark ? PALETTE.ink[1] : PALETTE.ink[0]);
      if (!dark) return m;
      return DARK.has(hex) ? before + DARK.get(hex) : m;
    });
  }
  const OURS = 'data:image/svg+xml;charset=utf-8,';
  const dataUrl = (text) => OURS + encodeURIComponent(text);
  const titleOf = (text) => { const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(String(text)); return m ? m[1].trim() : ''; };

  const api = { PALETTE, problem, themed, dataUrl, titleOf };
  if (typeof document === 'undefined') return api;

  // ---------- in the page ----------
  // Every SVG image on the page is redrawn from its source in the current theme: quiz files (an address
  // ending in .svg, or a data: SVG the quiz maker made) and ```svg blocks (made by block() below).
  const sources = new WeakMap(); // img -> its SVG source text
  const dark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  };
  const paint = (img) => { const s = sources.get(img); if (s != null) img.src = dataUrl(themed(s, dark())); };
  // A quiz's own svg (an assets/ file, or one the quiz maker just added), never the app's own icons
  const isSvgUrl = (src) => {
    if (!src || src.startsWith(OURS)) return false; // drawn here already
    if (/^data:image\/svg\+xml/i.test(src)) return true;
    let path = src;
    try { const u = new URL(src, location.href); path = decodeURIComponent(u.pathname) + '?' + decodeURIComponent(u.search); } catch (e) { /* as is */ }
    return /(?:^|[/=])assets\/[^?#&]*\.svg(?:$|[?&#])/i.test(path);
  };
  function adopt(img) {
    if (sources.has(img) || img.dataset.bqSvg === 'loading') return;
    const src = img.getAttribute('src');
    if (!isSvgUrl(src)) return;
    img.dataset.bqSvg = 'loading';
    img.removeAttribute('src'); // drawn once it's themed, so dark mode doesn't flash the light one
    const body = src.slice(src.indexOf(',') + 1);
    const got = src.startsWith('data:') ? Promise.resolve(src.includes(';base64,') ? decodeURIComponent(escape(atob(body))) : decodeURIComponent(body))
      : fetch(src, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    got.then((text) => {
      img.dataset.bqSvg = '';
      if (problem(text)) { img.alt = img.alt || 'Diagram'; return; } // not one to show
      sources.set(img, text);
      paint(img);
    }).catch(() => { img.dataset.bqSvg = ''; img.alt = img.alt || 'Diagram'; });
  }
  // A ```svg block in the text, as an image.
  function block(text) {
    const img = document.createElement('img');
    img.className = 'md-svg';
    const why = problem(text);
    if (why) {
      const p = document.createElement('p');
      p.className = 'md-svg-problem';
      p.textContent = `This diagram ${why}`;
      return p;
    }
    img.alt = titleOf(text) || 'Diagram';
    sources.set(img, String(text));
    img.dataset.bqSvg = '';
    paint(img);
    return img;
  }
  function repaintAll() {
    for (const img of document.querySelectorAll('img[data-bq-svg]')) paint(img);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') adopt(node);
    else for (const img of node.querySelectorAll('img')) adopt(img);
  }
  const start = () => {
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') {
          // a new address on an image (not one drawn here): read it again
          const src = m.target.getAttribute('src');
          if (m.target.tagName === 'IMG' && m.target.dataset.bqSvg !== 'loading' && src && !src.startsWith(OURS)) { sources.delete(m.target); adopt(m.target); }
          continue;
        }
        for (const n of m.addedNodes) scan(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    new MutationObserver(repaintAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintAll);
    scan(document.documentElement);
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  return Object.assign(api, { block, repaintAll });
}));
