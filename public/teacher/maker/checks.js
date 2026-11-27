// Checking a code question as it's written (and a fill question graded by running): a moment after each
// change every solution runs against every test (POST /api/t/check-code) and each row says what came back.
// Once they all pass, the server looks for a wrong solution the tests would pass (check-tests, mutants.js),
// and the tests card says what it is, with a test that catches it.

import { ICONS, h, icon, plural, post } from '../dash/core.js';
import { LANGS, classTestsText, methodTestsText } from './formats.js';
import { collect, readCode } from './model.js';
import { touch } from './core.js';
import { failingCount } from './testgrid.js';

const names = (ls) => ls.map((l) => LANGS[l]).join(' and ');
const gapId = (g) => JSON.stringify([g.line, g.blank, g.text, g.test]);

// ctx: { grid, src: { langs(), refs(), tab(), ready(), whose(lang) }, compile (an element), redrawTests() }
function checker(q, ctx) {
  const u = q._ui;
  const { grid, src } = ctx;
  const status = h('span', { class: 'qe-tstatus', role: 'status' });
  const gapBox = h('div', { class: 'qe-gap', hidden: true });
  let timer = null;
  let seq = 0;
  let gapSeq = 0;
  const say = (text, cls, more) => {
    status.replaceChildren(text, more ? h('span', { class: 'qe-tstatus-more', text: more }) : '');
    status.className = `qe-tstatus${cls ? ` ${cls}` : ''}`;
  };
  function showCompile() {
    const res = u.checked && u.checked.results[src.tab()];
    const bad = res && (res.status !== 'ok' || (res.banned && res.banned.length));
    ctx.compile.hidden = !bad;
    if (!bad) return;
    const who = src.whose(src.tab());
    ctx.compile.replaceChildren(h('strong', { text: res.status === 'compile_error' ? `${who} doesn't compile.` : res.status !== 'ok' ? `${who} didn't run.` : `It uses ${res.banned.join(', ')}, which isn't allowed.` }),
      res.message ? h('pre', { class: 'qe-mono', text: res.message }) : null);
  }
  function schedule() {
    clearTimeout(timer);
    seq++;
    gapSeq++;
    gapBox.hidden = true;
    timer = setTimeout(run, 900);
  }
  // The question on its own, with every test as hidden: the quiz's material and pools aren't there to name
  function payload(r) {
    const one = collect({ title: 'Check', questions: [q] }).questions[0];
    Object.assign(one, { tests: { sample: [], hidden: [...r.sample.tests, ...r.hidden.tests] }, rubric: [], points: 1, prompt: one.prompt && one.prompt.trim() ? one.prompt : 'Check' });
    if (q.type === 'fill') one.language = src.tab();
    delete one.shared;
    delete one.pool;
    return one;
  }
  async function run() {
    const r = readCode(q);
    const refs = src.langs().filter((l) => (src.refs()[l] || '').trim());
    if (!refs.length || !src.ready() || !(r.sample.tests.length + r.hidden.tests.length) || r.shapeErrors.length || r.sample.errors.length || r.hidden.errors.length) { say(''); return; }
    const one = payload(r);
    const key = JSON.stringify(one);
    if (u.checked && u.checked.key === key) { finish(); return; }
    const my = ++seq;
    say('Checking…', 'busy');
    let res;
    try { res = await post('/api/t/check-code', { question: one }); } catch (e) { if (my === seq) say("Couldn't check the tests.", 'no'); return; }
    if (my !== seq) return;
    if (res.status === 'busy') { timer = setTimeout(run, 1500); return; }
    if (res.status === 'offline') { say("Tests can't run here.", ''); return; }
    if (res.status === 'invalid') { say(res.message, 'no'); return; }
    u.checked = { key, sent: grid.sent(), results: res.results };
    finish();
  }
  function finish() {
    if (!u.testsAsText) grid.showResults(u.checked);
    const failing = failingCount(u.checked, q.mode === 'class');
    const broken = Object.entries(u.checked.results).filter(([, x]) => x.status !== 'ok').map(([l]) => l);
    showCompile();
    if (broken.length) { say(`${names(broken)} didn't run`, 'no'); return; }
    if (failing) { say(`${plural(failing, 'test')} failing`, 'no'); return; }
    say('All pass', 'ok');
    // the search costs the runner more than a check: only once the tests have sat still a moment
    const my = gapSeq;
    if (u.gaps && u.gaps.key === u.checked.key) drawGap();
    else setTimeout(() => { if (my === gapSeq) lookForGaps(); }, 2500);
  }

  // ---------- a wrong solution the tests would pass ----------
  async function lookForGaps() {
    const key = u.checked.key;
    if (u.gaps && u.gaps.key === key) { drawGap(); return; }
    const my = ++gapSeq;
    say('All pass', 'ok', 'Trying wrong versions…');
    let res;
    try { res = await post('/api/t/check-tests', { question: JSON.parse(key) }); } catch (e) { res = { status: 'offline' }; }
    if (my !== gapSeq) return;
    if (res.status === 'busy') { setTimeout(() => { if (my === gapSeq) { gapSeq--; lookForGaps(); } }, 2000); return; }
    say('All pass', 'ok');
    u.gaps = { key, list: res.status === 'ok' ? res.gaps || [] : [] };
    drawGap();
  }
  function drawGap() {
    const list = u.gaps && u.checked && u.gaps.key === u.checked.key ? u.gaps.list : [];
    const gap = list.find((g) => !(u.gapsIgnored || []).includes(gapId(g)));
    const shape = readCode(q).shape;
    gapBox.hidden = !gap || !shape;
    if (gapBox.hidden) return;
    const text = gap.test.steps ? classTestsText([gap.test], shape.class) : methodTestsText([gap.test], shape.signature);
    const [a, b] = gap.mark;
    const where = gap.blank ? `Blank ${gap.blank}` : `${src.langs().length > 1 ? `${LANGS[gap.lang]} line` : 'Line'} ${gap.line}`;
    const changed = h('code', { class: 'qe-mono' }, gap.text.slice(0, a), b > a ? h('mark', { text: gap.text.slice(a, b) }) : '', gap.text.slice(b));
    const add = () => {
      u.hidden = [String(u.hidden || '').trim(), text].filter(Boolean).join(q.mode === 'class' ? '\n\n' : '\n');
      touch(q);
      ctx.redrawTests();
      schedule();
    };
    gapBox.replaceChildren(
      h('p', {}, `${where} as `, changed, ' still passes every test.'),
      h('div', { class: 'qe-gap-fix' }, h('pre', { class: 'qe-mono', text }),
        h('button', { class: 'btn small', type: 'button', onclick: add }, icon(ICONS.plus, 16), 'Add this test'),
        h('button', { class: 'btn small qe-plain', type: 'button', text: 'Ignore', onclick: () => { u.gapsIgnored = [...(u.gapsIgnored || []), gapId(gap)]; drawGap(); } })));
  }
  return { status, gapBox, schedule, finish, showCompile };
}

export { checker, names };
