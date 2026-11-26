// Grading with AI: the dialog, with an API key or by pasting into any chat.

import { ICONS, api, ask, h, icon, plural, post, root } from './core.js';
import { CHATS, KEY_PAGES } from './cells.js';

async function aiDialog(runId, attemptId, done) {
  const qs = attemptId ? `?attempt=${encodeURIComponent(attemptId)}` : '';
  let p;
  try { p = await api(`/api/t/runs/${runId}/ai-prompt${qs}`); } catch (e) { ask.notice({ title: "Couldn't start grading", text: e.message }); return; }
  if (!p.answers) { ask.notice({ title: 'Nothing to grade' }); return; }
  let ks = { mine: false, hint: null, server: false };
  try { ks = await api('/api/t/ai-key'); } catch (e) { /* the copy and paste way still works */ }
  const dlg = h('dialog', { class: 't-dialog t-ai-dialog', 'aria-labelledby': 't-ai-title' });
  const close = () => { dlg.close(); };
  // a step: its number (a check once done), a title, and what's in it
  const step = (n, title, ...body) => {
    const num = h('span', { class: 't-step-n', 'aria-hidden': 'true', text: String(n) });
    const li = h('li', { class: 't-step' }, num, h('div', { class: 't-step-body' }, h('h3', { text: title }), ...body));
    li.done = (on) => { li.classList.toggle('done', on); num.replaceChildren(on ? icon(['M20 6L9 17l-5-5'], 14) : String(n)); };
    return li;
  };

  const copyBtn = h('button', { class: 'btn primary', type: 'button', text: 'Copy prompt' });
  const promptView = h('details', { class: 't-ai-see' }, h('summary', { text: 'See it' }), h('pre', { class: 't-ai-prompt', text: p.prompt }));
  const s1 = step(1, 'Copy the prompt', h('div', { class: 't-row t-step-row' }, copyBtn, promptView));
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p.prompt); } catch (e) {
      const ta = h('textarea', { class: 'sr-only' }); ta.value = p.prompt; dlg.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    copyBtn.textContent = 'Copied';
    s1.done(true);
  });

  const s2 = step(2, 'Paste it into an AI chat',
    h('div', { class: 't-ai-chats' }, CHATS.map(([name, url]) => h('a', { class: 't-chip', href: url, target: '_blank', rel: 'noopener noreferrer', text: name, onclick: () => s2.done(true) }))));

  const replyBox = h('textarea', { class: 'input t-ai-reply', rows: 4, placeholder: 'The whole reply', 'aria-label': "The AI's reply", spellcheck: 'false' });
  const preview = h('div', { class: 't-ai-preview', 'aria-live': 'polite' });
  const s3 = step(3, 'Paste its reply here', replyBox, preview);

  const status = h('span', { class: 't-small t-muted t-ai-count' });
  const applyBtn = h('button', { class: 'btn primary', type: 'button', text: 'Apply grades', disabled: true });
  let timer = 0;
  let seq = 0;
  let previewed = null; // Apply sends only the exact text whose preview is on screen
  const check = async () => {
    const n = ++seq;
    const text = replyBox.value;
    if (!text.trim()) { preview.replaceChildren(); applyBtn.disabled = true; applyBtn.textContent = 'Apply grades'; status.textContent = ''; s3.done(false); return; }
    let r;
    try { r = await post(`/api/t/runs/${runId}/ai-csv`, { csv: text, attempt: attemptId || undefined }); } catch (e) {
      if (n === seq) { preview.replaceChildren(h('p', { class: 't-error t-small', text: e.message })); s3.done(false); }
      return;
    }
    if (n !== seq || text !== replyBox.value) return;
    const rows = (r.preview || []).map((x) => h('tr', {},
      h('td', { text: x.name }),
      h('td', {}, `Q${x.n}`, x.qname ? h('span', { class: 't-muted', text: ` ${x.qname}` }) : null,
        x.items.length ? h('span', { class: 't-ai-items' }, x.items.map((it) => h('span', { class: it.met ? 'met' : 'unmet', title: it.met ? 'Met' : 'Not met' }, icon(it.met ? ICONS.check : ICONS.cross, 13), it.text))) : null),
      h('td', { class: 'num' }, h('b', { text: `${x.got}/${x.of}` }))));
    const problems = r.skipped;
    preview.replaceChildren(...[
      rows.length ? h('div', { class: 't-ai-table' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Student' }), h('th', { text: 'Question' }), h('th', { class: 'num', text: "AI's grade" }))), h('tbody', {}, rows))) : null,
      problems.length ? h('div', { class: 't-ai-warn', role: 'note' }, h('b', { text: r.found ? 'Left for you' : "Couldn't read that" }),
        h('ul', {}, problems.map((x) => h('li', { text: x })))) : null,
    ].filter(Boolean)); // replaceChildren would print a null
    previewed = r.found ? text : null;
    applyBtn.disabled = !r.found;
    applyBtn.textContent = r.found ? `Apply ${plural(r.found, 'grade')}` : 'Apply grades';
    status.textContent = r.found ? `${r.found} of ${r.waiting} answers` : '';
    s3.done(!!r.found);
  };
  replyBox.addEventListener('input', () => {
    // an edit makes the preview out of date: no applying until it's checked again
    previewed = null; applyBtn.disabled = true; ++seq;
    clearTimeout(timer); timer = setTimeout(check, 250);
  });
  applyBtn.addEventListener('click', async () => {
    const text = previewed;
    if (text == null || text !== replyBox.value) return;
    applyBtn.disabled = true;
    try {
      const r = await post(`/api/t/runs/${runId}/ai-csv`, { csv: text, attempt: attemptId || undefined, apply: true });
      close();
      done(`AI grades applied to ${plural(r.applied, 'answer')}.`);
    } catch (e) { status.textContent = e.message; applyBtn.disabled = false; }
  });

  // The API key way: ready (which key, change or remove it) or a field to add one.
  const keyPanel = h('div', { class: 't-ai-key', role: 'tabpanel', id: 't-ai-p-key', 'aria-labelledby': 't-ai-t-key' });
  const gradeBtn = h('button', { class: 'btn primary', type: 'button', text: `Grade ${plural(p.answers, 'answer')}` });
  const linkBtn2 = (text, onclick) => h('button', { class: 't-linkbtn', type: 'button', text, onclick });
  const drawKey = (editing, focus) => {
    const has = ks.mine || ks.server;
    gradeBtn.disabled = !has || editing;
    if (has && !editing) {
      keyPanel.replaceChildren(h('p', { class: 't-ai-ready' },
        h('b', { text: ks.name }), ` · ${ks.mine ? `${ks.company} key ${ks.hint}` : `Server's ${ks.server} key`} · `,
        linkBtn2(ks.mine ? 'Change' : 'Use my own', () => drawKey(true, true)),
        ks.mine ? [' · ', linkBtn2('Remove', async () => { try { ks = await post('/api/t/ai-key', { key: null }); } catch (e) { /* stays */ } drawKey(false, true); })] : null));
      if (focus) setTimeout(() => gradeBtn.focus(), 0);
      return;
    }
    const input = h('input', { class: 'input', type: 'password', id: 't-ai-keyin', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…, sk-… or AIza…' });
    const msg = h('p', { class: 't-small', role: 'status' });
    const save = h('button', { class: 'btn', type: 'button', text: 'Save key' });
    save.addEventListener('click', async () => {
      save.disabled = true; msg.className = 't-small t-muted'; msg.textContent = 'Checking it…';
      try { ks = await post('/api/t/ai-key', { key: input.value }); drawKey(false, true); } catch (e) { msg.className = 't-small t-error'; msg.textContent = e.message; save.disabled = false; }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    keyPanel.replaceChildren(
      h('label', { class: 'field', for: 't-ai-keyin' }, h('span', { class: 'field-label', text: 'Your API key' }), h('div', { class: 't-row t-ai-keyrow' }, input, save)),
      h('div', { class: 't-ai-chats', role: 'group', 'aria-label': 'Make a key' }, KEY_PAGES.map(([name, url]) => h('a', { class: 't-chip', href: url, target: '_blank', rel: 'noopener noreferrer', text: name }))),
      msg);
    if (has) keyPanel.append(linkBtn2('Cancel', () => drawKey(false, true)));
    if (focus) setTimeout(() => input.focus(), 0);
  };
  gradeBtn.addEventListener('click', async () => {
    gradeBtn.disabled = true;
    try { await post(attemptId ? `/api/t/attempts/${attemptId}/ai-grade` : `/api/t/runs/${runId}/ai-grade`); close(); done(''); } catch (e) {
      keyPanel.append(h('p', { class: 't-small t-error', role: 'alert', text: e.message }));
      gradeBtn.disabled = false;
    }
  });

  // The two ways, as tabs; the footer's main button follows the tab.
  const steps = h('ol', { class: 't-steps', role: 'tabpanel', id: 't-ai-p-paste', 'aria-labelledby': 't-ai-t-paste' }, s1, s2, s3);
  const tabBtn = (id, text) => h('button', { class: 't-tab', type: 'button', role: 'tab', id: `t-ai-t-${id}`, 'aria-controls': `t-ai-p-${id}`, text });
  const tPaste = tabBtn('paste', 'Copy & paste');
  const tKey = tabBtn('key', 'API key');
  const show = (which) => {
    const k = which === 'key';
    tPaste.setAttribute('aria-selected', String(!k)); tKey.setAttribute('aria-selected', String(k));
    tPaste.tabIndex = k ? -1 : 0; tKey.tabIndex = k ? 0 : -1;
    steps.hidden = k; keyPanel.hidden = !k;
    applyBtn.hidden = k; gradeBtn.hidden = !k; status.hidden = k;
    if (k) drawKey(false);
  };
  tPaste.addEventListener('click', () => show('paste'));
  tKey.addEventListener('click', () => show('key'));
  const tabs = h('div', { class: 't-tabs', role: 'tablist', 'aria-label': 'How to grade' }, tPaste, tKey);
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const to = document.activeElement === tPaste ? tKey : tPaste;
    to.focus(); to.click();
  });
  const x = h('button', { class: 'btn small ghost t-dialog-x', type: 'button', 'aria-label': 'Close', onclick: close }, icon(ICONS.x, 18));
  dlg.append(
    h('header', { class: 't-dialog-head' },
      h('h2', { id: 't-ai-title', text: 'Grade with AI' }),
      x),
    tabs, steps, keyPanel,
    h('footer', { class: 't-dialog-foot' }, status, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close }), applyBtn, gradeBtn));
  dlg.addEventListener('close', () => dlg.remove());
  root.append(dlg); // inside the dashboard, for its fonts and sizing
  show(ks.mine || ks.server ? 'key' : 'paste');
  dlg.showModal();
  (ks.mine || ks.server ? tKey : copyBtn).focus();
}
// Before letting students in, a checklist, so the teacher looks up from the screen: Admit stays off until
// everything is ticked. Admit everyone asks every time; one student's Admit asks the first time in a run.
// flagged: [{ name, checks }] students whose sign-in looks off (a new network, a browser another student
// used): one more item, asked every time, saying why.
const admitChecked = new Set(); // run ids
const checkWhy = (c) => (c.type === 'same-browser' ? `Same browser as ${c.detail}` : `New network: ${c.detail}`);
// reading: how many of them haven't agreed to the rules yet (they start as soon as they do)

export { admitChecked, aiDialog, checkWhy };
