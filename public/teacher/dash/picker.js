// A dropdown whose rows have a name on the left and details lined up on the right (Give a quiz's quiz and
// class, the class on Grades).

import { h } from './core.js';

// A native select can't line details up on the right. items: [{ value, label, meta: [column, ...] }]; start: the value picked first (else the
// first); onChange(value): called when another is picked. Keyboard: arrows, Home/End, typing a name's start, Enter or Space to pick, Escape to close.
function picker(id, labelText, items, start, onChange) {
  let value = items.some((x) => x.value === start) ? start : items.length ? items[0].value : '';
  let active = 0;
  const row = (it) => [h('span', { class: 'pick-label', text: it.label }), h('span', { class: 'pick-meta' }, it.meta.map((m) => h('span', { text: m })))];
  const face = h('span', { class: 'pick-face', id: id + '-value' });
  const btn = h('button', {
    class: 'input pick', type: 'button', id, disabled: !items.length,
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id + '-list', 'aria-labelledby': `${id}-label ${id}-value`,
  }, face, h('span', { class: 'pick-caret', 'aria-hidden': 'true' }));
  const list = h('ul', { class: 'pick-list', role: 'listbox', id: id + '-list', tabindex: '-1', 'aria-labelledby': id + '-label' });
  list.hidden = true;
  const opts = items.map((it, i) => {
    const li = h('li', { class: 'pick-opt', role: 'option', id: `${id}-o${i}`, 'data-value': it.value }, row(it));
    li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the list until the click
    li.addEventListener('click', () => { choose(i); close(); });
    li.addEventListener('mousemove', () => setActive(i, true));
    list.append(li);
    return li;
  });
  const el = h('div', { class: 'field pick-wrap' }, h('span', { class: 'field-label', id: id + '-label', text: labelText }), btn, list);
  function paint() {
    const it = items.find((x) => x.value === value);
    face.replaceChildren(...(it ? row(it) : []));
    opts.forEach((li, i) => li.setAttribute('aria-selected', String(items[i].value === value)));
  }
  function setActive(i, fromMouse) {
    active = Math.max(0, Math.min(items.length - 1, i));
    opts.forEach((li, k) => li.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', opts[active].id);
    if (!fromMouse) opts[active].scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const was = value;
    value = items[i].value;
    paint();
    if (onChange && value !== was) onChange(value);
  }
  // Type to jump, as in a native select: the next name starting with what's typed in quick succession
  let typed = '';
  let typedAt = 0;
  function jump(ch) {
    const now = Date.now();
    typed = (now - typedAt < 800 ? typed : '') + ch.toLowerCase();
    typedAt = now;
    const from = typed.length === 1 ? active + 1 : active;
    const k = items.map((_, n) => (from + n) % items.length).find((i) => items[i].label.toLowerCase().startsWith(typed));
    if (k != null) setActive(k);
  }
  const letter = (e) => e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
  function open() {
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, items.findIndex((x) => x.value === value)));
    list.focus();
  }
  function close(stay) {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (!stay) btn.focus();
  }
  btn.addEventListener('click', () => (list.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } else if (letter(e)) { e.preventDefault(); open(); jump(e.key); }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') setActive(active + 1);
    else if (e.key === 'ArrowUp') setActive(active - 1);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(items.length - 1);
    else if (letter(e) || (e.key === ' ' && Date.now() - typedAt < 800 && items.some((x) => x.label.toLowerCase().startsWith(typed + ' ')))) jump(e.key); // "Period 3"
    else if (e.key === 'Enter' || e.key === ' ') { choose(active); close(); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { close(true); return; }
    else return;
    e.preventDefault();
  });
  list.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) close(true); });
  paint();
  return { el, get value() { return value; } };
}

export { picker };
