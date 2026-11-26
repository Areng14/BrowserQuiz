// The student app's settings, words and session state, shared by its modules (main.js starts it).

const BQ = (window.BQ = window.BQ || {});
const cfg = Object.assign({ demo: false, monacoBase: '/vendor/monaco/' }, window.BQ_CONFIG || {});
// Browsers once kept Monaco for a week at the same address, so an old copy (without C, Go, Rust or C#)
// could outlive a deploy. A new address fetches it fresh once; since then the server has it checked on
// every load (http.js serveStatic).
const MONACO_V = '?v=2';

const CODE_ALPHABET = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
const LANG_NAMES = { java: 'Java', python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust' };
const THEME_KEY = 'bq-theme';
const KIND = {
  single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', math: 'Math', graph: 'Graph', method: 'Write a method', class: 'Write a class',
  output: 'Predict the output', trace: 'Trace table', fill: 'Fill in the blanks', essay: 'Written answer',
};
// Default directions per part, AP style. A quiz can override any of them with quiz.directions[type].
const PARTS = {
  single: { title: 'Multiple choice', text: 'Pick the one best answer. Blank answers earn no credit.' },
  multi: { title: 'Select all that apply', text: 'Credit only if you select every correct answer and no wrong ones.' },
  text: { title: 'Short answer', text: "Spelling counts. Capital letters and extra spaces don't." },
  math: { title: 'Math', text: 'Type / for a fraction and ^ for a power. Any equivalent answer counts, unless the question asks for a form.' },
  graph: { title: 'Graphing', text: 'Add each graph, then drag its points into place. Points snap to the grid.' },
  code: { title: 'Free response', text: "Assume needed imports are there and inputs match the question. Partial credit is possible." },
  output: { title: 'Predict the output', text: 'Type exactly what the code prints, one line per line of output.' },
  trace: { title: 'Trace tables', text: 'Fill in each value as the code runs. Each correct cell earns credit.' },
  fill: { title: 'Fill in the blanks', text: 'Fill in each blank so the code works. Partial credit is possible.' },
  essay: { title: 'Written answers', text: 'Your teacher grades these.' },
};
const ERRORS = {
  nothing_to_correct: 'Nothing to correct.',
  bad_code: 'No open quiz with that code.',
  run_closed: 'This quiz is closed.',
  wrong_network: 'This quiz only opens from the school network.',
  other_network: 'This quiz is locked to the network you started it on. Ask your teacher.',
  too_many: 'Too many tries. Wait a minute.',
  bad_id: 'Wrong student ID for that name.',
  name_locked: 'Too many wrong IDs. Wait a little, then try again.',
  already_started: 'Already started on another computer. Ask your teacher.',
  network: "Can't reach the server.",
  no_attempt: 'Signed out. Sign in again.',
  not_admitted: 'Your teacher has to let you in first.',
  teacher_login: 'Sign in on the teacher page first.',
  locked: 'Your teacher needs to sign in to BrowserQuiz first. Try again in a minute.',
  seb_required: 'Open this quiz in Safe Exam Browser. Your teacher has the file that starts it.',
  seb_launch: 'This quiz opens in Safe Exam Browser.',
};

let api;
let root;
let S;

// A new quiz session (a new sign-in, or starting over): everything about the last one is dropped.
function resetState() {
  S = freshState();
  return S;
}
// The page it draws into and the API it talks to (the server's, the teacher preview's or the watch page's).
function setUp(el, apiImpl) {
  root = el;
  api = apiImpl;
}

function freshState() {
  return {
    run: null, me: null, quiz: null, idx: 0, answers: {}, deadline: 0, skew: 0,
    monitor: null, models: {}, editor: null, editorSubs: [], parts: [], partsSeen: new Set(), locked: 0, dirOpen: false,
    timer: 0, poll: 0, done: false, runBusy: false, results: {}, el: null, warned: {}, saveState: 'saved',
    marks: null, kept: new Map(),
  };
}

export { BQ, CODE_ALPHABET, ERRORS, KIND, LANG_NAMES, MONACO_V, PARTS, S, THEME_KEY, api, cfg, resetState, root, setUp };
