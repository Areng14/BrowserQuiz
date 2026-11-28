// Server (admin, in the menu under their name): this server's version and whether a newer one is out, its
// code runner, data and disk; and its backups (server/src/backups.js), every night or now, each one to
// download or restore, and a downloaded one to restore from a file.

import { actionsHead, api, ask, date, h, heads, post, sortableTable } from './core.js';
import { moreMenu } from './cells.js';

const LANGS = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust' };
const KINDS = { nightly: 'Nightly', manual: 'By you', 'before-restore': 'Before a restore' };
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const card = (id, title, ...body) => h('section', { class: 't-set-card', 'aria-labelledby': id }, h('h2', { id, text: title }), ...body);
const HOW_TO_UPDATE = 'https://github.com/Areng14/BrowserQuiz/blob/main/docs/setup.md#updates-backups-and-logs';
const fact = (label, ...value) => [h('dt', { text: label }), h('dd', {}, ...value)];

// After a restore: the server restarts. Wait for it, then load the page again (it may ask to sign in).
async function waitForRestart(say) {
  say('Restarting…');
  const start = Date.now();
  let down = false;
  while (Date.now() - start < 180000) {
    await new Promise((r) => setTimeout(r, 2000));
    let up = false;
    try { up = (await fetch('/healthz', { cache: 'no-store' })).ok; } catch (e) { up = false; }
    if (!up) down = true;
    else if (down || Date.now() - start > 8000) { location.reload(); return; }
  }
  say("The server hasn't come back. Check its logs.", true);
}

function thisServer(s) {
  const u = s.update;
  const version = [h('span', { class: 't-mono', text: s.version || 'Unknown' })];
  if (u && u.behind) {
    version.push('  ', h('a', { class: 'st-waiting', href: HOW_TO_UPDATE, target: '_blank', rel: 'noopener', text: `${u.behind === 1 ? 'An update' : `${u.behind} updates`} available` }));
  } else if (u && !u.failed) version.push(h('span', { class: 'st-good', text: '  Up to date' }));
  else if (u) version.push(h('span', { class: 't-muted', text: "  Couldn't check for updates" }));
  const r = s.runner;
  const langs = r.languages || [];
  const runner = !r.configured ? h('span', { class: 't-error', text: 'Not set up' })
    : !r.healthy ? h('span', { class: 't-error', text: 'Offline' })
      : h('span', { text: langs.length === 9 ? 'All nine languages' : langs.map((l) => LANGS[l]).join(', ') });
  return card('srv-this', 'This server',
    h('dl', { class: 't-facts' },
      ...fact('Version', ...version),
      ...fact('Code runner', runner),
      ...fact('Data', size(s.dataBytes)),
      ...(s.freeBytes != null ? fact('Free disk', size(s.freeBytes)) : [])));
}

function backups(s) {
  const msg = h('p', { class: 't-small t-set-msg', role: 'status' });
  const say = (text, bad) => { msg.className = `t-small t-set-msg ${bad ? 't-error' : 'st-good'}`; msg.textContent = text; };
  const list = h('div', {});
  // Signed out (a restart, or the session ran out): the browser would fail the download quietly, or save the
  // error as the backup. Sign in first.
  const download = (b) => {
    const url = `/api/t/server/backups/${encodeURIComponent(b.name)}`;
    return h('a', { href: url, download: b.name, text: 'Download', onclick: async (e) => {
      e.preventDefault();
      try { await api('/api/t/me'); } catch (ex) { if (ex.message !== 'login') say(ex.message, true); return; }
      location.href = url; // an attachment: it downloads, and the page stays
    } });
  };
  const draw = (all) => {
    list.replaceChildren(!all.length ? h('p', { class: 't-muted', text: 'None yet.' }) : h('div', { class: 't-table-wrap' }, sortableTable(h('table', { class: 't-table' },
      h('thead', {}, h('tr', {}, heads(['Made', 'Kind', 'Size'], ['Size']), actionsHead())),
      h('tbody', {}, all.map((b) => h('tr', {},
        h('td', { 'data-sort': String(b.at), text: date(b.at) }), h('td', { text: KINDS[b.kind] || b.kind }),
        h('td', { class: 'num', 'data-label': 'Size', 'data-sort': String(b.bytes), text: size(b.bytes) }),
        h('td', { class: 't-actions' }, moreMenu(`More for the backup of ${date(b.at)}`, `backup:${b.name}`, [
          download(b),
          { text: 'Restore', danger: true, onclick: () => restore(b) }])))))), ['Size'], { by: 'Made', dir: -1 })));
  };
  const restarting = () => { now.disabled = true; fromFile.disabled = true; waitForRestart(say); };
  async function restore(b) {
    if (!(await ask.confirm({ title: `Restore the backup of ${date(b.at)}?`, text: 'Everything since then is lost, and the server restarts.', ok: 'Restore', danger: true }))) return;
    try { await post('/api/t/server/restore', { name: b.name }); } catch (e) { say(e.message, true); return; }
    restarting();
  }
  const now = h('button', { class: 'btn', type: 'button', text: 'Back up now' });
  now.addEventListener('click', async () => {
    now.disabled = true;
    try { draw((await post('/api/t/server/backups')).backups); say('Backed up.'); } catch (e) { say(e.message, true); }
    now.disabled = false;
  });
  // A downloaded backup, from this computer
  const file = h('input', { type: 'file', accept: '.db', hidden: true });
  const fromFile = h('button', { class: 'btn', type: 'button', text: 'Restore from a file' });
  fromFile.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f || !(await ask.confirm({ title: `Restore ${f.name}?`, text: 'Everything on this server is replaced by it, and the server restarts.', ok: 'Restore', danger: true }))) return;
    say('Uploading…');
    fromFile.disabled = true;
    // api(): signed out since the page opened (a restart), it goes to sign-in like everything else
    try {
      await api('/api/t/server/restore-upload', { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (e) { if (e.message !== 'login') { say(e.message, true); fromFile.disabled = false; } return; }
    restarting();
  });
  draw(s.backups);
  return card('srv-backups', 'Backups',
    h('div', { class: 't-row t-set-foot' }, now, fromFile, file, msg),
    list);
}

// The tab's page (home.js shell)
function serverTab() {
  const body = h('div', { class: 't-set' }, h('p', { class: 't-muted', text: 'Loading…' }));
  const page = h('section', { class: 't-section t-settings' }, h('h1', { text: 'Server' }), body);
  (async () => {
    let s;
    try { s = await api('/api/t/server'); } catch (e) { if (e.message !== 'login') body.replaceChildren(h('p', { class: 't-error', text: e.message })); return; }
    body.replaceChildren(thisServer(s), backups(s));
  })();
  return page;
}

export { serverTab };
