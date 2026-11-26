// A few words on a term a teacher may not know, for every teacher page and the report (CSS: tip.css).
//   BQTip(host, control, text, side) -> host
// Shown while the pointer is over host, or the control in it has keyboard focus, and read with the control.
// Escape hides it until the pointer or focus moves on. It sits under host (above, if there's no room below),
// or beside it with side set (a menu's items, so it doesn't cover the next one). It's fixed to the window,
// so a scrolling box or a dialog never cuts it off and it never makes the page scroll sideways.
//   BQTip.text(control, text) changes what a control's tip says.
(function () {
  'use strict';
  let seq = 0;
  const tips = new WeakMap(); // control -> its tip
  const live = new Set(); // hosts the pointer or focus is in, to follow when the page scrolls
  const tipOf = (host) => host.querySelector(':scope > .t-tip');
  function place(host) {
    const t = tipOf(host);
    if (!t) return;
    // Big screens zoom the page (teacher.css), and zoom scales top and left too: measure by how much.
    t.style.left = t.style.top = '100px';
    t.style.maxWidth = '';
    const k = t.getBoundingClientRect().left / 100 || 1;
    const r = host.getBoundingClientRect();
    const gap = 6 * k;
    const edge = 8;
    let m = t.getBoundingClientRect();
    let left = null;
    let top = null;
    if (host.dataset.tipSide) {
      // beside: left of it if there's room (menus open at the right), else right of it
      const room = Math.max(r.left, innerWidth - r.right) - gap - edge;
      if (room >= 160 * k) {
        if (m.width > room) { t.style.maxWidth = `${room / k}px`; m = t.getBoundingClientRect(); }
        left = r.left - gap - m.width >= edge ? r.left - gap - m.width : r.right + gap;
        top = Math.max(edge, Math.min(r.top, innerHeight - edge - m.height));
      }
    }
    if (left == null) {
      // under it, starting at its left edge (its right edge for numbers, which sit right), kept on screen
      left = host.classList.contains('num') || host.dataset.tipEnd ? r.right - m.width : r.left;
      left = Math.max(edge, Math.min(left, innerWidth - edge - m.width));
      top = r.bottom + gap;
      if (top + m.height > innerHeight - edge && r.top - gap - m.height >= edge) top = r.top - gap - m.height;
    }
    t.style.left = `${left / k}px`;
    t.style.top = `${top / k}px`;
  }
  const follow = () => { for (const host of live) if (host.isConnected) place(host); else live.delete(host); };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);

  function tip(host, control, text, side) {
    const t = document.createElement('span');
    t.className = 't-tip';
    t.setAttribute('role', 'tooltip');
    // not part of a label's or a header's name: it's read as the control's description (aria-describedby)
    t.setAttribute('aria-hidden', 'true');
    t.id = `t-tip-${++seq}`;
    t.textContent = text;
    host.classList.add('t-tipped');
    if (side) host.dataset.tipSide = '1';
    host.append(t);
    const was = control.getAttribute('aria-describedby');
    control.setAttribute('aria-describedby', was ? `${was} ${t.id}` : t.id);
    tips.set(control, t);
    // Escape hides it only while it shows, so a menu's or dialog's own Escape still works otherwise.
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || host.classList.contains('t-tip-off') || getComputedStyle(t).visibility !== 'visible') return;
      host.classList.add('t-tip-off');
      e.stopPropagation();
      e.preventDefault();
    });
    const enter = () => { live.add(host); place(host); };
    const leave = (e) => {
      if (e.type === 'focusout' && host.contains(e.relatedTarget)) return;
      host.classList.remove('t-tip-off');
      if (e.type === 'pointerleave' ? !host.contains(document.activeElement) : !host.matches(':hover')) live.delete(host);
    };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('focusin', enter);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('focusout', leave);
    return host;
  }
  tip.text = (control, text) => { const t = tips.get(control); if (t) t.textContent = text; };
  window.BQTip = tip;
})();
