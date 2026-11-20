// Safe markdown subset for question prompts and choices.
// Builds DOM nodes with textContent only. Never innerHTML, so quiz text can't inject markup.
// Supports: paragraphs, - / 1. lists, ```fenced code```, `inline code`, **bold**, *italic*.
// opts.lang tags code (inline and unlabeled fences) so the app can syntax-highlight it.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  const UL = /^\s*[-*]\s+/;
  const OL = /^\s*\d+[.)]\s+/;
  const FENCE = /^```\s*([\w+#-]*)\s*$/;

  function inline(text, parent, lang) {
    let last = 0;
    let m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const tok = m[0];
      let el;
      if (tok[0] === '`') {
        el = document.createElement('code');
        el.textContent = tok.slice(1, -1);
        if (lang) el.dataset.lang = lang;
      } else if (tok.startsWith('**')) {
        el = document.createElement('strong');
        el.textContent = tok.slice(2, -2);
      } else {
        el = document.createElement('em');
        el.textContent = tok.slice(1, -1);
      }
      parent.append(el);
      last = m.index + tok.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // "none": inline code and unlabeled blocks stay plain. Blocks labeled ```java still get colors.
  const codeLang = (opts) => (opts && opts.lang && opts.lang !== 'none' ? opts.lang : null);

  function render(src, opts) {
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
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !FENCE.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i])) {
        buf.push(lines[i++]);
      }
      const p = document.createElement('p');
      inline(buf.join(' '), p, lang);
      frag.append(p);
    }
    return frag;
  }

  function renderInline(src, opts) {
    const span = document.createElement('span');
    inline(String(src == null ? '' : src), span, codeLang(opts));
    return span;
  }

  BQ.md = { render, renderInline };
})();
