// The teacher pages' own dialogs, in place of the browser's alert(), confirm() and prompt().
//   BQAsk.confirm({ title, text, ok, no, danger })    -> Promise<boolean> (no: the Cancel button's words)
//   BQAsk.notice({ title, text })                      -> Promise<void>
//   BQAsk.ask({ title, text, label, value, ok, danger, copy, password, max }) -> Promise<string | null> (null: cancelled; max: most characters)
// One at a time; Escape or Cancel says no. A destructive one starts on Cancel, so Enter can't delete.
// One with a password field isn't a modal dialog (that makes the rest of the page inert, a password
// manager's list included), so iCloud Passwords and the like still work: our own backdrop covers the
// page instead, and Tab stays inside.
(function () {
  'use strict';
  let seq = 0;
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.flat().filter(Boolean));
    return n;
  };

  function open({ title, text, ok = 'OK', no = 'Cancel', danger = false, cancel = true, field = null }) {
    return new Promise((resolve) => {
      const id = `bq-ask-${++seq}`;
      const back = document.activeElement;
      let answer = null;
      const okBtn = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: ok });
      const noBtn = cancel ? el('button', { class: 'btn', type: 'button', text: no }) : null;
      const dlg = el('dialog', { class: 't-dialog t-ask', 'aria-labelledby': `${id}-t`, 'aria-describedby': text ? `${id}-d` : null },
        el('header', { class: 't-dialog-head' }, el('h2', { id: `${id}-t`, text: title })),
        text || field ? el('div', { class: 't-ask-body' }, text ? el('p', { id: `${id}-d`, text }) : null, field ? field.node : null) : null,
        el('footer', { class: 't-dialog-foot' }, noBtn, okBtn));
      okBtn.addEventListener('click', () => { answer = field ? field.value() : true; dlg.close(); });
      if (noBtn) noBtn.addEventListener('click', () => dlg.close());
      if (field && field.input) field.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } });
      const loose = !!(field && field.password);
      const shade = loose ? el('div', { class: 't-ask-back' }) : null;
      const keys = (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); dlg.close(); return; }
        if (e.key !== 'Tab') return;
        const stops = [...dlg.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
        if (!stops.length) return;
        const first = stops[0], last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      dlg.addEventListener('close', () => {
        if (shade) { shade.remove(); dlg.removeEventListener('keydown', keys); }
        dlg.remove();
        if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
        resolve(answer);
      });
      const host = document.querySelector('.t-app') || document.body;
      if (loose) {
        dlg.classList.add('t-loose');
        dlg.setAttribute('aria-modal', 'true');
        dlg.addEventListener('keydown', keys);
        host.append(shade, dlg);
        dlg.show();
      } else {
        host.append(dlg);
        dlg.showModal();
      }
      if (field && field.input) { field.input.focus(); field.input.select(); } else (danger && noBtn ? noBtn : okBtn).focus();
    });
  }

  function inputField(label, value, readOnly, password, max) {
    const fid = `bq-ask-in-${++seq}`;
    const input = el('input', { class: 'input', id: fid, type: password ? 'password' : 'text', value: value || '', readonly: readOnly, maxlength: max ? String(max) : null, autocomplete: password ? 'current-password' : 'off', spellcheck: 'false', autocorrect: 'off' }); // typed as typed: no autocorrect (Safari) or autofill
    input.value = value || '';
    const node = el('div', { class: 'field' }, label ? el('label', { class: 'field-label', for: fid, text: label }) : null, input);
    if (!label) input.setAttribute('aria-label', 'Text');
    return { node, input, password: !!password, value: () => input.value };
  }

  window.BQAsk = {
    confirm: (o) => open(o).then((a) => a === true),
    notice: (o) => open(Object.assign({ ok: 'OK', cancel: false }, o)).then(() => undefined),
    // copy: a read-only box with the text selected, to copy by hand when the clipboard isn't allowed
    ask: (o) => open(Object.assign({}, o, { cancel: !o.copy, field: inputField(o.label, o.value, o.copy, o.password, o.max) })).then((a) => (a === null ? null : String(a))),
  };
})();
