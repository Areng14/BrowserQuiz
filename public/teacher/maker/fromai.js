// One question from an AI chat: copy the prompt, paste back what the AI wrote, and the question joins
// the quiz in its part, open. (A whole quiz from an AI is Settings' "Paste a quiz.json".)

import { h, post } from '../dash/core.js';
import { copyPromptBtn } from '../dash/home.js';
import { ed } from './state.js';
import { withUi } from './model.js';
import { grow } from './editing.js';
import { field } from './core.js';
import { insertQuestions } from './outline.js';

// The JSON in what the AI wrote: its ```json block if it has one (chats wrap it in words), else all of it
function jsonIn(text) {
  const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)\n```/i.exec(text);
  const src = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(src); } catch (e) { throw new Error("That isn't JSON. Paste the AI's answer, or just its ```json block."); }
}
// A question, a list of them, or a quiz.json with questions: what to add
function questionsIn(v) {
  const list = Array.isArray(v) ? v : v && Array.isArray(v.questions) ? v.questions : v && typeof v === 'object' && v.type ? [v] : null;
  if (!list || !list.length) throw new Error('No question in it. Ask the AI for the question as JSON.');
  return list;
}

function aiCard(close) {
  // not part of the quiz, so typing here doesn't count as a change to save
  const paste = h('textarea', { class: 'input qe-area qe-mono', id: 'qe-ai-paste', rows: 6, spellcheck: 'false', placeholder: '```json\n{ "type": "single", "prompt": "…", … }\n```' });
  paste.addEventListener('input', () => grow(paste));
  const msg = h('p', { class: 't-error qe-ai-msg', role: 'alert' });
  const addBtn = h('button', { class: 'btn small', type: 'button', text: 'Add question' });
  addBtn.addEventListener('click', async () => {
    msg.textContent = '';
    let list;
    try { list = questionsIn(jsonIn(paste.value)); } catch (e) { msg.textContent = e.message; paste.focus(); return; }
    addBtn.disabled = true;
    try {
      // the server reads it the way it reads a quiz.json, so it's checked and filled in the same way
      const r = await post('/api/t/quizzes/normalize', { json: JSON.stringify({ title: ed.quiz.title || 'Quiz', language: ed.quiz.language || 'java', questions: list }) });
      insertQuestions(r.quiz.questions.map(withUi));
    } catch (e) {
      if (e.message !== 'login') { msg.textContent = e.message; paste.focus(); }
    } finally { addBtn.disabled = false; }
  });
  return [h('div', { class: 'qe-head' }, h('h2', { class: 'qe-n', text: 'Question from an AI' }), h('span', { class: 'qe-grow' }),
    h('button', { class: 'btn small qe-done', type: 'button', text: 'Cancel', onclick: close })),
  h('div', { class: 'qe-stack' },
    h('div', { class: 'qe-line' }, copyPromptBtn('question')),
    field('What the AI wrote', paste),
    h('div', { class: 'qe-line' }, addBtn), msg)];
}

export { aiCard };
