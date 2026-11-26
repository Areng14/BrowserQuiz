// Safe Markdown for question prompts, choices and shared material.
// Builds DOM nodes with textContent only. Never innerHTML, so quiz text can't inject markup.
// Blocks: paragraphs, # headings, - / 1. lists, > quotes, --- lines, | tables |, ```fenced code```, $$math$$,
// and ```graph blocks: a graph drawn from equations and points (graph.js).
// Inline: `code`, **bold**, *italic*, ~~struck~~, $math$, [links](url) (shown as their text, so a click
// can't take a student out of the quiz), ![images](assets/x.png), and \ to escape a character.
// opts.lang tags code (inline and unlabeled fences) so the app can syntax-highlight it.
// opts.assetUrl(path) gives an image's address. Only the quiz's own images (assets/...) show; anything
// else stays text, so a quiz can't load a picture from another site.
// Math is typeset with KaTeX, loaded the first time a page has any.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  // ---------- math (KaTeX, from vendor/katex next to this script) ----------
  const here = document.currentScript && document.currentScript.src;
  const KATEX = here ? new URL('vendor/katex/', here).href : '/vendor/katex/';
  const pending = [];
  let katexLoad = null;
  let idle = Promise.resolve();
  function loadKatex() {
    if (!katexLoad) {
      katexLoad = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = KATEX + 'katex.min.css';
        document.head.append(css);
        const s = document.createElement('script');
        s.src = KATEX + 'katex.min.js';
        s.onload = () => resolve(window.katex);
        s.onerror = reject;
        document.head.append(s);
      });
    }
    return katexLoad;
  }
  function typesetSoon() {
    idle = loadKatex().then((katex) => {
      for (const el of pending.splice(0)) {
        try {
          katex.render(el.dataset.tex, el, {
            displayMode: el.classList.contains('display'), throwOnError: false, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 500,
          });
        } catch (e) { /* leaves the TeX source showing */ }
      }
    }).catch(() => { pending.length = 0; }); // no KaTeX: the TeX source stays readable
  }
  function mathEl(tex, display) {
    const el = document.createElement(display ? 'div' : 'span');
    el.className = display ? 'math display' : 'math';
    el.dataset.tex = tex;
    el.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    pending.push(el);
    if (pending.length === 1) Promise.resolve().then(typesetSoon);
    return el;
  }

  // ---------- inline ----------
  // escape | `code` | $$math$$ | $math$ (opening $ before non-space, closing $ after non-space and not before a
  // digit, so "$5 and $10" stays text) | **bold** | ~~struck~~ | *italic* | [text](url)
  const INLINE = /(\\[\\`*_$|~[\]()#>!-])|(`[^`]+`)|(\$\$[^$]+\$\$)|(\$(?=\S)(?:\\\$|[^$\n])+?(?<=\S)\$(?!\d))|(\*\*(?:\*[^*\s][^*]*\*|[^*])+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]*\))/g;
  const ASSET = /^(?:\.\/)?(assets\/[A-Za-z0-9 _.-]{1,100}\.(?:png|jpe?g|gif|webp))$/i;
  let assetUrl = null; // set while a render runs (rendering is synchronous)

  function inline(text, parent, lang) {
    let last = 0;
    let m;
    const re = new RegExp(INLINE.source, 'g');
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const tok = m[0];
      let el;
      if (m[1]) el = document.createTextNode(tok.slice(1));
      else if (m[2]) {
        el = document.createElement('code');
        el.textContent = tok.slice(1, -1);
        if (lang) el.dataset.lang = lang;
      } else if (m[3]) el = mathEl(tok.slice(2, -2).trim(), true);
      else if (m[4]) el = mathEl(tok.slice(1, -1), false);
      else if (m[5]) { el = document.createElement('strong'); inline(tok.slice(2, -2), el, lang); }
      else if (m[6]) { el = document.createElement('s'); inline(tok.slice(2, -2), el, lang); }
      else if (m[7]) { el = document.createElement('em'); inline(tok.slice(1, -1), el, lang); }
      else if (m[8]) {
        const alt = tok.slice(2, tok.indexOf(']('));
        const path = tok.slice(tok.indexOf('](') + 2, -1).match(ASSET);
        if (path && !path[1].includes('..') && assetUrl) {
          el = document.createElement('img');
          el.className = 'md-img';
          el.alt = alt;
          el.src = assetUrl(path[1]);
        } else el = document.createTextNode(alt ? `[${alt}]` : ''); // not one of the quiz's images
      } else { el = document.createElement('span'); inline(tok.slice(1, tok.indexOf('](')), el, lang); }
      parent.append(el);
      last = m.index + tok.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // ---------- blocks ----------
  const UL = /^\s*[-*+]\s+/;
  const OL = /^\s*\d+[.)]\s+/;
  const FENCE = /^```\s*([\w+#-]*)\s*$/;
  const HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?/;
  const MATH = /^\s*\$\$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const isTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-');
  const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEADING.test(lines[i]) || RULE.test(lines[i]) || QUOTE.test(lines[i])
    || MATH.test(lines[i]) || UL.test(lines[i]) || OL.test(lines[i]) || isTable(lines, i);

  // Cells of a table row: split on | outside `code` and not escaped.
  function cells(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const out = [];
    let cur = '';
    let code = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\' && s[k + 1] === '|') { cur += '\\|'; k++; continue; }
      if (c === '`') code = !code;
      if (c === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  function render(src, opts) {
    const prev = assetUrl;
    assetUrl = (opts && opts.assetUrl) || null;
    try { return renderBlocks(src, opts); } finally { assetUrl = prev; }
  }
  function renderBlocks(src, opts) {
    const lang = codeLang(opts);
    const frag = document.createDocumentFragment();
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(FENCE);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        if ((fence[1] || '').toLowerCase() === 'graph' && window.BQGraph) {
          frag.append(window.BQGraph.block(buf.join('\n')));
          continue;
        }
        const pre = document.createElement('pre');
        pre.className = 'md-code';
        const code = document.createElement('code');
        code.textContent = buf.join('\n');
        const fenceLang = (fence[1] || lang || '').toLowerCase();
        if (fenceLang) code.dataset.lang = fenceLang;
        pre.append(code);
        frag.append(pre);
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      if (MATH.test(line)) { // $$ ... $$ on one line, or $$ / lines / $$
        const one = line.match(/^\s*\$\$(.+)\$\$\s*$/);
        if (one) { frag.append(mathEl(one[1].trim(), true)); i++; continue; }
        const buf = [line.replace(/^\s*\$\$/, '')];
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
        if (i < lines.length) buf.push(lines[i++].replace(/\$\$\s*$/, ''));
        frag.append(mathEl(buf.join('\n').trim(), true));
        continue;
      }
      const h = line.match(HEADING);
      if (h) {
        const el = document.createElement(['h3', 'h4', 'h5'][h[1].length - 1]);
        el.className = 'md-h';
        inline(h[2], el, lang);
        frag.append(el);
        i++;
        continue;
      }
      if (RULE.test(line)) { frag.append(document.createElement('hr')); i++; continue; }
      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, ''));
        const q = document.createElement('blockquote');
        q.append(render(buf.join('\n'), opts));
        frag.append(q);
        continue;
      }
      if (isTable(lines, i)) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        i += 2;
        const table = document.createElement('table');
        const row = (vals, tag) => {
          const tr = document.createElement('tr');
          head.forEach((_, k) => {
            const td = document.createElement(tag);
            if (align[k]) td.style.textAlign = align[k];
            inline(vals[k] || '', td, lang);
            tr.append(td);
          });
          return tr;
        };
        const thead = document.createElement('thead');
        thead.append(row(head, 'th'));
        const tbody = document.createElement('tbody');
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) tbody.append(row(cells(lines[i++]), 'td'));
        table.append(thead, tbody);
        const wrap = document.createElement('div');
        wrap.className = 'md-table';
        wrap.append(table);
        frag.append(wrap);
        continue;
      }
      if (UL.test(line) || OL.test(line)) {
        const ordered = OL.test(line);
        const re = ordered ? OL : UL;
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (i < lines.length && re.test(lines[i])) {
          const li = document.createElement('li');
          inline(lines[i].replace(re, ''), li, lang);
          list.append(li);
          i++;
        }
        frag.append(list);
        continue;
      }
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !(buf.length && startsBlock(lines, i))) buf.push(lines[i++]);
      const p = document.createElement('p');
      inline(buf.join(' '), p, lang);
      frag.append(p);
    }
    return frag;
  }

  // "none": inline code and unlabeled blocks stay plain. Blocks labeled ```java still get colors.
  function codeLang(opts) { return opts && opts.lang && opts.lang !== 'none' ? opts.lang : null; }

  function renderInline(src, opts) {
    const span = document.createElement('span');
    const prev = assetUrl;
    assetUrl = (opts && opts.assetUrl) || null;
    try { inline(String(src == null ? '' : src), span, codeLang(opts)); } finally { assetUrl = prev; }
    return span;
  }

  // Resolves once the math rendered so far is typeset (the report waits on this before printing).
  function ready() { return Promise.resolve().then(() => idle); }

  BQ.md = { render, renderInline, ready };
})();
