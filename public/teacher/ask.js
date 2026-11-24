// The teacher pages' own dialogs, in place of the browser's alert(), confirm() and prompt().
//   BQAsk.confirm({ title, text, ok, danger })        -> Promise<boolean>
//   BQAsk.notice({ title, text })                      -> Promise<void>
//   BQAsk.ask({ title, text, label, value, ok, danger, copy }) -> Promise<string | null> (null: cancelled)
// One at a time; Escape or Cancel says no. A destructive one starts on Cancel, so Enter can't delete.
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

  function open({ title, text, ok = 'OK', danger = false, cancel = true, field = null }) {
    return new Promise((resolve) => {
      const id = `bq-ask-${++seq}`;
      const back = document.activeElement;
      let answer = null;
      const okBtn = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: ok });
      const noBtn = cancel ? el('button', { class: 'btn', type: 'button', text: 'Cancel' }) : null;
      const dlg = el('dialog', { class: 't-dialog t-ask', 'aria-labelledby': `${id}-t`, 'aria-describedby': text ? `${id}-d` : null },
        el('header', { class: 't-dialog-head' }, el('h2', { id: `${id}-t`, text: title })),
        text || field ? el('div', { class: 't-ask-body' }, text ? el('p', { id: `${id}-d`, text }) : null, field ? field.node : null) : null,
        el('footer', { class: 't-dialog-foot' }, noBtn, okBtn));
      okBtn.addEventListener('click', () => { answer = field ? field.value() : true; dlg.close(); });
      if (noBtn) noBtn.addEventListener('click', () => dlg.close());
      if (field && field.input) field.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } });
      dlg.addEventListener('close', () => {
        dlg.remove();
        if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
        resolve(answer);
      });
      (document.querySelector('.t-app') || document.body).append(dlg);
      dlg.showModal();
      if (field && field.input) { field.input.focus(); field.input.select(); } else (danger && noBtn ? noBtn : okBtn).focus();
    });
  }

  function inputField(label, value, readOnly) {
    const fid = `bq-ask-in-${++seq}`;
    const input = el('input', { class: 'input', id: fid, type: 'text', value: value || '', readonly: readOnly, autocomplete: 'off', spellcheck: 'false', autocorrect: 'off' }); // typed as typed: no autocorrect (Safari) or autofill
    input.value = value || '';
    const node = el('div', { class: 'field' }, label ? el('label', { class: 'field-label', for: fid, text: label }) : null, input);
    if (!label) input.setAttribute('aria-label', 'Text');
    return { node, input, value: () => input.value };
  }

  window.BQAsk = {
    confirm: (o) => open(o).then((a) => a === true),
    notice: (o) => open(Object.assign({ ok: 'OK', cancel: false }, o)).then(() => undefined),
    // copy: a read-only box with the text selected, to copy by hand when the clipboard isn't allowed
    ask: (o) => open(Object.assign({}, o, { cancel: !o.copy, field: inputField(o.label, o.value, o.copy) })).then((a) => (a === null ? null : String(a))),
  };
})();
