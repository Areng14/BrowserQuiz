// Saving, leaving, and the keys.

import { api, plural, post } from '../dash/core.js';
import { setHash, showHome } from '../dash/home.js';
import { ed } from './state.js';
import { collect, plainer, withUi } from './model.js';
import { grow } from './editing.js';
import { markdownImages, refreshSoon, setStatus } from './core.js';
import { imageSrc } from './choices.js';
import { renderPane, sectionTimeProblem, selectDivider } from './pane.js';
import { addQuestion, moveQuestion, renderOutline, select } from './outline.js';

// ---------- save ----------
// Puts what the server said on the questions it's about; returns the lines that fit nowhere.
function placeServerError(message) {
  const head = /^The (reference solution|output) check failed:\n- /.exec(message);
  const items = head ? message.slice(head[0].length).split('\n- ') : [message];
  const rest = [];
  for (const item of items) {
    let q = null;
    let text = item;
    const m = /^Question (\d+)\b:?\s*/.exec(item);
    if (m) { q = ed.quiz.questions[Number(m[1]) - 1]; text = item.slice(m[0].length); } else {
      q = ed.quiz.questions.find((x) => item.startsWith(`${x.id} `));
      if (q) text = item.slice(q.id.length + 1);
    }
    if (q) ed.fromServer.set(q, (ed.fromServer.get(q) || []).concat(plainer(text))); else rest.push(item);
  }
  return rest.join('\n');
}
function showFirstProblem() {
  const i = ed.problems.findIndex((p) => p.length);
  if (i >= 0) select(i);
}
async function save() {
  if (ed.saving) return null;
  ed.globalMsg.textContent = '';
  if (!ed.quiz.questions.length) { setStatus('Add a question first.', true); return null; }
  renderOutline();
  const secTime = sectionTimeProblem();
  if (secTime) { selectDivider(secTime.k); setStatus('Not saved. Fix the section times', true); return null; }
  const left = ed.problems.filter((p) => p.length).length;
  if (left) {
    ed.tried = true;
    if (!ed.problems[ed.sel] || !ed.problems[ed.sel].length) showFirstProblem(); else renderPane();
    setStatus(`Not saved. ${plural(left, 'question')} to fix`, true);
    return null;
  }
  const out = collect(ed.quiz);
  ed.saving = true;
  ed.saveBtn.disabled = true;
  setStatus('Checking…');
  const at = ed.edits;
  try {
    const used = new Set([...[...out.questions, ...(out.shared || [])].map((q) => q.image).filter(Boolean), ...markdownImages(out)]);
    const assets = Object.fromEntries(Object.entries(ed.newAssets).filter(([p2]) => used.has(p2)));
    const r = await post('/api/t/quizzes/json', { quiz: out, replaces: ed.currentId, assets });
    ed.currentId = r.id;
    if (ed.root.isConnected) setHash('#quiz/' + encodeURIComponent(r.id), true);
    ed.assetQuizId = r.id;
    for (const p2 of Object.keys(assets)) ed.existingAssets.add(p2);
    ed.newAssets = {};
    ed.tried = false;
    ed.removed = null;
    // Show the expected values the reference solutions filled in.
    if (at === ed.edits) {
      ed.dirty = false;
      const src = await api(`/api/t/quizzes/${encodeURIComponent(r.id)}/source`).catch(() => null);
      if (src && at === ed.edits && src.quiz.questions.length === ed.quiz.questions.length) {
        ed.quiz.questions.forEach((q, i) => {
          const s = src.quiz.questions[i];
          if (q.type !== s.type) return;
          if (q.type === 'output') { // what the code printed
            q.answer = s.answer;
            q._ui.auto = s.answer;
            if (i === ed.sel) ed.pane.querySelectorAll('textarea[data-out]').forEach((ta) => { ta.value = s.answer || ''; grow(ta); });
          }
          if (q.type !== 'code' && !(q.type === 'fill' && q._ui.run && s.tests)) return;
          const fresh = withUi(s)._ui;
          q._ui.sample = fresh.sample;
          q._ui.hidden = fresh.hidden;
          if (i === ed.sel) ed.pane.querySelectorAll('textarea[data-tests]').forEach((ta) => { ta.value = q._ui[ta.dataset.tests]; grow(ta); });
        });
      }
    }
    const shown = ed.quiz.questions[ed.sel];
    if (shown && shown.image) ed.pane.querySelectorAll('img.qe-thumb, img.qimg').forEach((img) => { img.src = imageSrc(shown); });
    refreshSoon();
    setStatus(ed.dirty ? '' : 'Saved');
    if (r.past) pastScores(r.id, r.past);
    return r.id;
  } catch (e) {
    if (e.message === 'login') return null;
    ed.globalMsg.textContent = placeServerError(e.message);
    renderOutline();
    showFirstProblem();
    setStatus('Not saved', true);
    return null;
  } finally { ed.saving = false; ed.saveBtn.disabled = false; }
}
// The answers changed on a quiz already given: those classes can be scored again with the new ones
// (server: rekey.js). past: { classes: [names], questions: how many changed }.
async function pastScores(id, past) {
  const names = past.classes.length > 3 ? [...past.classes.slice(0, 2), `${past.classes.length - 2} more`] : past.classes;
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const yes = await window.BQAsk.confirm({ title: 'Update past scores?', ok: 'Update scores', no: 'Keep old scores',
    text: `${who} took this quiz with the old ${past.questions === 1 ? 'answer' : 'answers'}. Grades you gave by hand stay.` });
  if (!yes) return;
  try {
    await post(`/api/t/quizzes/${encodeURIComponent(id)}/rekey`, {});
    if (!ed.dirty) setStatus('Saved. Scores updated');
  } catch (e) { if (e.message !== 'login') window.BQAsk.notice({ title: "Scores weren't updated", text: e.message }); }
}
const leaveOk = () => !ed.dirty || window.BQAsk.confirm({ title: 'Leave without saving?', text: "Changes you haven't saved are lost.", ok: 'Leave', danger: true });
const leave = async () => { if (await leaveOk()) showHome('quizzes'); };
const items = () => [...ed.addMenu.querySelectorAll('.qe-add-item:not(:disabled)')];
function closeAdd(refocus) { ed.addMenu.hidden = true; ed.addBtn.setAttribute('aria-expanded', 'false'); if (refocus) ed.addBtn.focus(); }

function onKey(e) {
  if (!ed.root.isConnected) { document.removeEventListener('keydown', onKey); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    addQuestion(ed.quiz.questions[ed.sel] ? ed.quiz.questions[ed.sel].type : ed.quiz.questions.length ? ed.quiz.questions[ed.quiz.questions.length - 1].type : 'single');
  } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const d = e.key === 'ArrowUp' ? -1 : 1;
    if (e.shiftKey) { if (ed.sel >= 0) moveQuestion(ed.sel, ed.sel + d); } else select(ed.sel + d, true);
  }
}
function onUnload(e) {
  if (!ed.root.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
  if (ed.dirty) { e.preventDefault(); e.returnValue = ''; }
}

export { closeAdd, items, leave, leaveOk, onKey, onUnload, save };
