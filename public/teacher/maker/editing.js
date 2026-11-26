// Small text-editing helpers, dragging to reorder, and the editor's constants.

// ---------- small text-editing helpers ----------
// Typed through the browser so Ctrl+Z still works.
function insert(el, text) {
  el.focus();
  if (document.execCommand && document.execCommand('insertText', false, text)) return;
  el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function wrap(el, before, after) {
  const s = el.selectionStart;
  const text = el.value.slice(s, el.selectionEnd);
  insert(el, before + text + after);
  el.setSelectionRange(s + before.length, s + before.length + text.length);
}
function grow(el) {
  if (!el.isConnected) return;
  const y = window.scrollY;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2 + (el.scrollWidth > el.clientWidth ? 16 : 0)}px`; // room for a sideways scrollbar
  if (window.scrollY !== y) window.scrollTo(0, y);
}
// Tab indents, Shift+Tab outdents, Enter keeps the indent. Esc, then Tab (or Shift+Tab), moves on.
function codeKeys(el) {
  let leave = false;
  el.setAttribute('aria-description', 'Tab indents. Esc, then Tab, moves on.');
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { leave = true; return; }
    if (e.key === 'Tab' && leave) { leave = false; return; } // the browser moves focus as usual
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) leave = false;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = el.value;
    const s = el.selectionStart;
    const end = el.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s === end && !e.shiftKey) { insert(el, '    '); return; }
      const block = v.slice(ls, end);
      const out = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
      if (out === block) return;
      el.setSelectionRange(ls, end);
      insert(el, out);
      if (s === end) { const at = Math.max(ls, s - (block.length - out.length)); el.setSelectionRange(at, at); } else el.setSelectionRange(ls, ls + out.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      const line = v.slice(ls, s);
      const indent = /^ */.exec(line)[0] + (/[{:]\s*$/.test(line) ? '    ' : '');
      if (!indent) return;
      e.preventDefault();
      insert(el, '\n' + indent);
    }
  });
}
// Drag rows to reorder. With handleOf, a row only drags by its handle, so text in it still selects.
function sortable(rows, onMove, handleOf) {
  let from = -1;
  const clear = () => rows.forEach((r) => r.classList.remove('qe-drop-before', 'qe-drop-after', 'qe-dragging'));
  const after = (row, e) => { const r = row.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  rows.forEach((row, i) => {
    const handle = handleOf && handleOf(row);
    if (handle) handle.addEventListener('mousedown', () => { row.draggable = true; }); else row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      if (e.target !== row) return; // a list inside this row being dragged
      from = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i + 1));
      row.classList.add('qe-dragging');
    });
    row.addEventListener('dragend', (e) => { if (e.target !== row) return; from = -1; clear(); if (handle) row.draggable = false; });
    row.addEventListener('dragover', (e) => {
      if (from < 0) return;
      e.preventDefault();
      const a = after(row, e);
      rows.forEach((r) => r.classList.remove('qe-drop-before', 'qe-drop-after'));
      row.classList.add(a ? 'qe-drop-after' : 'qe-drop-before');
    });
    row.addEventListener('drop', (e) => {
      if (from < 0) return;
      e.preventDefault();
      let to = i + (after(row, e) ? 1 : 0);
      if (from < to) to--;
      const f = from;
      from = -1;
      clear();
      if (to !== f) onMove(f, to);
    });
  });
}
const snippet = (md) => String(md || '').replace(/```[\w+#-]*/g, ' ').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

// ---------- the editor ----------
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const extOf = (p) => (String(p).match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
const MOD = /Mac|iP(hone|ad)/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
const ALT = MOD === '⌘' ? '⌥' : 'Alt+';

// preset: { quiz, missing } from a pasted quiz.json, loaded into this editor unsaved.

export { ALT, IMAGE_MIME, MOD, codeKeys, extOf, grow, insert, snippet, sortable, wrap };
