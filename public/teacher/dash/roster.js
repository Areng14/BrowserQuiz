// The roster maker: a class from a pasted list or a CSV.

import { dash } from './state.js';
import { actionsHead, api, ask, h, mount, plural, post, sortableTable, tip } from './core.js';
import { guard, setHash, shell, showHome } from './home.js';

// ---------- roster maker ----------
async function showRoster(id) {
  setHash('#class/' + (id ? encodeURIComponent(id) : 'new'));
  const seq = ++dash.navSeq;
  let roster = { name: '', students: [] };
  if (id) {
    try { roster = await api(`/api/t/rosters/${encodeURIComponent(id)}`); } catch (e) {
      // deleted, or an old link: say so in Classes instead of a blank page
      if (e.message !== 'login' && seq === dash.navSeq) mount(shell('classes', h('section', { class: 't-section' }, h('p', { class: 't-error', text: e.message }))));
      return;
    }
  }
  const removing = new Set();
  const timeChanges = {}; // roster student id -> 1 | 1.25 | 1.5 | 2: extra time on every timed quiz
  const name = h('input', { class: 'input', id: 'class-name', value: roster.name, placeholder: 'Period 3' });
  const add = h('textarea', { class: 'input t-textarea', id: 'class-add', rows: 8, spellcheck: 'false', placeholder: 'Ava Martinez, 204511\nDiego Ramos, 204651' });
  const msg = h('p', { class: 't-error', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'button', text: 'Save' });
  const list = roster.students.length ? h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Student' }), h('th', { text: 'Time' }), actionsHead())),
    h('tbody', {}, roster.students.map((st) => {
      const row = h('tr', {});
      const btn = h('button', { class: 'btn small outline-danger', type: 'button', text: 'Remove', 'aria-label': `Remove ${st.name}` });
      btn.addEventListener('click', () => {
        if (removing.has(st.id)) { removing.delete(st.id); btn.textContent = 'Remove'; btn.setAttribute('aria-label', `Remove ${st.name}`); row.classList.remove('t-removed'); }
        else { removing.add(st.id); btn.textContent = 'Undo'; btn.setAttribute('aria-label', `Undo removing ${st.name}`); row.classList.add('t-removed'); }
        btn.classList.toggle('outline-danger', !removing.has(st.id)); // Undo is plain
      });
      const time = h('select', { class: 'input t-time-x', 'aria-label': `Time for ${st.name}` },
        [[1, 'Standard time'], [1.25, '1.25× time'], [1.5, '1.5× time'], [2, '2× time']].map(([v, t]) => h('option', { value: String(v), text: t, selected: Number(st.timeX || 1) === v })));
      const timeCell = h('td', { 'data-sort': String(Number(st.timeX || 1)) }, time);
      time.addEventListener('change', () => { timeChanges[st.id] = Number(time.value); timeCell.dataset.sort = time.value; });
      row.append(h('td', { text: st.name }), timeCell, h('td', { class: 't-actions' }, btn));
      return row;
    }))))) : null;
  save.addEventListener('click', async () => {
    save.disabled = true;
    msg.textContent = '';
    try {
      if (id) await post(`/api/t/rosters/${encodeURIComponent(id)}/edit`, { name: name.value, add: add.value, remove: [...removing], time: timeChanges });
      else await post('/api/t/rosters', { name: name.value, text: add.value });
      showHome('classes');
    } catch (e) { msg.textContent = e.message; save.disabled = false; }
  });
  // Pasted students, a new name or extra time aren't dropped without asking: Cancel, the sidebar, Back, reload
  const changed = () => name.value !== roster.name || !!add.value.trim() || removing.size > 0
    || roster.students.some((st) => st.id in timeChanges && timeChanges[st.id] !== Number(st.timeX || 1));
  const leaveOk = () => !changed() || ask.confirm({ title: 'Leave without saving?', text: "Changes you haven't saved are lost.", ok: 'Leave', danger: true });
  if (seq !== dash.navSeq) return;
  const page = h('section', { class: 't-section' },
    h('h1', { text: id ? 'Edit class' : 'New class' }),
    h('label', { class: 'field', for: 'class-name' }, h('span', { class: 'field-label', text: 'Class name' }), name),
    id ? h('h2', { text: plural(roster.students.length, 'student') }) : null,
    list,
    tip(h('label', { class: 'field', for: 'class-add' }, h('span', { class: 'field-label', text: id ? 'Add students: name, student ID (one per line)' : 'Students: name, student ID (one per line)' }), add), add,
      "Students pick their name and type their ID to sign in. IDs can't be shown again after saving, so keep your own copy."),
    h('div', { class: 't-row' }, save, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: async () => { if (await leaveOk()) showHome('classes'); } })),
    msg);
  mount(shell('classes', page));
  guard(leaveOk);
  const onUnload = (e) => {
    if (!page.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
    if (changed()) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onUnload);
  if (!id) name.focus(); // a new class starts with its name; an open one stays at the top
}

export { showRoster };
