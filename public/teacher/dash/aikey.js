// The teacher's own AI key (Anthropic, OpenAI or Google): which one is saved, changing or removing it, or a
// field to add one. In Settings, and in Grade with AI's API key tab.

import { h, post } from './core.js';
import { KEY_PAGES } from './cells.js';

// ks: /api/t/ai-key's answer. onChange(ks, editing): after each redraw (focus: whether to move focus).
// pre: put before the field's id. Returns { el, draw(editing, focus), ks() }.
function aiKeyEditor(ks, onChange, pre = 't-ai') {
  const el = h('div', { class: 't-ai-keyed' });
  const linkBtn = (text, onclick) => h('button', { class: 't-linkbtn', type: 'button', text, onclick });
  const draw = (editing, focus) => {
    const has = ks.mine || ks.server;
    if (has && !editing) {
      const change = linkBtn(ks.mine ? 'Change' : 'Use my own', () => draw(true, true));
      el.replaceChildren(h('p', { class: 't-ai-ready' },
        h('b', { text: ks.name }), ` · ${ks.mine ? `${ks.company} key ${ks.hint}` : `Server's ${ks.server} key`} · `, change,
        ks.mine ? [' · ', linkBtn('Remove', async () => { try { ks = await post('/api/t/ai-key', { key: null }); } catch (e) { /* stays */ } draw(false, true); })] : null));
      if (onChange) onChange(ks, false, focus);
      return;
    }
    const input = h('input', { class: 'input', type: 'password', id: pre + '-keyin', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…, sk-… or AIza…' });
    const msg = h('p', { class: 't-small', role: 'status' });
    const save = h('button', { class: 'btn', type: 'button', text: 'Save key' });
    save.addEventListener('click', async () => {
      save.disabled = true; msg.className = 't-small t-muted'; msg.textContent = 'Checking it…';
      try { ks = await post('/api/t/ai-key', { key: input.value }); draw(false, true); } catch (e) { msg.className = 't-small t-error'; msg.textContent = e.message; save.disabled = false; }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    el.replaceChildren(
      h('label', { class: 'field', for: pre + '-keyin' }, h('span', { class: 'field-label', text: 'Your API key' }), h('div', { class: 't-row t-ai-keyrow' }, input, save)),
      h('div', { class: 't-ai-chats', role: 'group', 'aria-label': 'Make a key' }, KEY_PAGES.map(([name, url]) => h('a', { class: 't-chip', href: url, target: '_blank', rel: 'noopener noreferrer', text: name }))),
      msg);
    if (has) el.append(linkBtn('Cancel', () => draw(false, true)));
    if (focus) setTimeout(() => input.focus(), 0);
    if (onChange) onChange(ks, true, focus);
  };
  return { el, draw, ks: () => ks };
}

export { aiKeyEditor };
