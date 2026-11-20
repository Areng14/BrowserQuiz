// Demo-only fake server. In the real app all of this lives on the server, and the
// answers below never reach the browser. It speaks the same API as public/student/api.js
// and applies the same strike rules, so the teacher panel shows what the server would see.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  const JOIN_CODE = 'K7QX4M';
  const ROSTER = [
    { id: 'r1', name: 'Ava Martinez', sid: '204511' },
    { id: 'r2', name: 'Jordan Lee', sid: '204587' },
    { id: 'r3', name: 'Sam Okafor', sid: '204602' },
    { id: 'r4', name: 'Priya Shah', sid: '204633' },
    { id: 'r5', name: 'Diego Ramos', sid: '204651' },
    { id: 'r6', name: 'Mia Chen', sid: '204678' },
  ];

  const QUIZ = {
    title: 'AP CSA Unit 4 Check',
    timeLimitMin: 20,
    language: 'java', // highlights code in prompts and choices
    graceStrikes: 0,
    questions: [
      {
        id: 'q1', type: 'single', points: 1,
        prompt: 'What does this print?\n\n```java\nint x = 7;\nint y = x / 2 * 2;\nSystem.out.println(x - y);\n```',
        choices: ['`0`', '`1`', '`3`', '`3.5`'], answer: 1,
      },
      {
        id: 'q2', type: 'multi', points: 2,
        prompt: 'Which of these lines compile? Assume `java.util.*` is imported.',
        choices: [
          '`ArrayList<String> a = new ArrayList<>();`',
          '`List<String> b = new ArrayList<String>();`',
          '`ArrayList<string> c = new ArrayList<>();`',
          '`String[] d = new ArrayList<>();`',
        ],
        answer: [0, 1],
      },
      {
        id: 'q3', type: 'text', points: 1,
        prompt: 'What is the worst-case time complexity of binary search on a sorted array of `n` items? Use Big-O notation.',
        answer: ['o(log n)', 'o(logn)', 'o(log(n))', 'o(lg n)'],
      },
      {
        id: 'q4', type: 'code', mode: 'method', points: 8, languages: ['java', 'python'],
        prompt: 'Write `countVowels(s)`, which returns how many vowels (`a e i o u`, upper or lower case) are in `s`.',
        starter: {
          java: 'class Solution {\n    public int countVowels(String s) {\n        \n    }\n}\n',
          python: 'class Solution:\n    def countVowels(self, s: str) -> int:\n        pass\n',
        },
        samples: [
          { call: { java: 'countVowels("hello")', python: 'countVowels("hello")' }, expected: { java: '2', python: '2' } },
          { call: { java: 'countVowels("")', python: 'countVowels("")' }, expected: { java: '0', python: '0' } },
        ],
      },
      {
        id: 'q5', type: 'code', mode: 'class', points: 9, languages: ['java', 'python'],
        prompt: 'Write the complete `BankAccount` class.\n\n- A constructor that takes the owner\'s name and a starting balance\n- `deposit(amount)` adds to the balance\n- `withdraw(amount)` takes money out and returns `true`, or refuses and returns `false` if it would overdraw the account\n- `getBalance()` returns the balance',
        starter: {
          java: 'public class BankAccount {\n    \n}\n',
          python: 'class BankAccount:\n    pass\n',
        },
        samples: [
          {
            call: { java: 'BankAccount a = new BankAccount("Ava", 100.0);\na.deposit(50.0);\na.getBalance();', python: 'a = BankAccount("Ava", 100.0)\na.deposit(50.0)\na.getBalance()' },
            expected: { java: '150.0', python: '150.0' },
          },
          {
            call: { java: 'BankAccount b = new BankAccount("Jo", 20.0);\nb.withdraw(50.0);', python: 'b = BankAccount("Jo", 20.0)\nb.withdraw(50.0)' },
            expected: { java: 'false', python: 'False' },
          },
        ],
      },
    ],
  };

  // Server-side scoring of client reports. The client never sees any of this.
  const SEVERITY = {
    'blur': 'violation', 'hidden': 'violation', 'fullscreen-exit': 'violation', 'extended-display': 'violation',
    'reload': 'violation', 'unfocused-beat': 'violation', 'heartbeat-lost': 'warning',
    'mouse-left': 'warning', 'copy': 'warning', 'paste': 'warning', 'contextmenu': 'warning', 'blocked-key': 'warning',
    'print-screen': 'warning', 'resize': 'warning', 'bulk-insert': 'warning', 'inhuman-typing': 'warning',
    'return': 'info', 'exit': 'violation',
  };
  const SERVER_ONLY = new Set(['start', 'submit', 'admit', 'run', 'restore', 'join', 'reload']);
  const VIOLATION_MERGE_MS = 2000;
  const HEARTBEAT_LOST_MS = 10000;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code) => { const e = new Error(code); e.code = code; return e; };
  const listeners = new Set();

  let st;
  function reset() {
    st = {
      attempt: null,       // { rosterId, name, status: waiting|active|submitted, integrity: clean|invalidated|restored, ... }
      events: [],
      mouse: [],
      failedTries: {},     // rosterId -> { n, until }
      autoAdmit: false,
      lastBeat: 0,
      beatLostFlagged: false,
      away: false,
      burstStart: 0,
      perm: {},            // questionId -> shuffled original indexes (server-side mapping)
    };
    emit();
  }

  function emit() { listeners.forEach((fn) => { try { fn(st); } catch (e) { /* panel bug shouldn't kill the demo */ } }); }

  function log(type, detail, severity) {
    st.events.push({ t: Date.now(), type, detail: detail == null ? null : String(detail).slice(0, 120), severity });
    if (st.events.length > 400) st.events.splice(0, st.events.length - 400);
  }

  // A strike is a transition from "present" to "away". Everything that fires while already away
  // (blur + hidden + fullscreen-exit + unfocused beats) is logged but doesn't stack strikes.
  function record(type, detail) {
    const a = st.attempt;
    if (!a) return;
    const severity = SEVERITY[type] || 'info';
    log(type, detail, severity);
    if (type === 'return') st.away = false;
    if (severity === 'violation' && a.status === 'active') {
      const now = Date.now();
      const merged = st.away || now - st.burstStart < VIOLATION_MERGE_MS;
      st.away = true;
      if (!merged) {
        st.burstStart = now;
        a.strikes++;
        if (a.integrity === 'clean' && a.strikes > QUIZ.graceStrikes) {
          a.integrity = 'invalidated';
          a.reason = type;
          a.invalidatedAt = now;
        }
      }
    }
    if (severity === 'warning') a.warnings++;
    emit();
  }

  function shuffle(n) {
    const a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function publicQuiz() {
    return {
      title: QUIZ.title,
      timeLimitMin: QUIZ.timeLimitMin,
      language: QUIZ.language,
      directions: QUIZ.directions || {},
      questions: QUIZ.questions.map((q) => {
        const pub = { id: q.id, type: q.type, prompt: q.prompt, points: q.points };
        if (q.choices) {
          // Positional choices only: the original index never leaves the server.
          st.perm[q.id] = shuffle(q.choices.length);
          pub.choices = st.perm[q.id].map((i) => q.choices[i]);
        }
        if (q.type === 'code') Object.assign(pub, { mode: q.mode, languages: q.languages, starter: q.starter, samples: q.samples });
        return pub;
      }),
    };
  }

  function grade(answers) {
    let score = 0, max = 0, pendingCode = 0;
    const detail = {};
    for (const q of QUIZ.questions) {
      max += q.points;
      const a = answers[q.id];
      let ok = false;
      if (q.type === 'code') { pendingCode += q.points; detail[q.id] = 'runner'; continue; }
      if (q.type === 'single') ok = Number.isInteger(a) && st.perm[q.id][a] === q.answer;
      if (q.type === 'multi') {
        const got = new Set((Array.isArray(a) ? a : []).map((i) => st.perm[q.id][i]));
        ok = got.size === q.answer.length && q.answer.every((x) => got.has(x));
      }
      if (q.type === 'text') ok = typeof a === 'string' && q.answer.includes(a.trim().toLowerCase().replace(/\s+/g, ' '));
      if (ok) score += q.points;
      detail[q.id] = ok;
    }
    return { score, max, pendingCode, detail };
  }

  // Run is simulated: a browser page can't safely compile Java. Untouched starter code gets the
  // result the real runner would give; anything else gets a clearly labelled example result.
  function simulateRun(q, language, code) {
    const untouched = code.trim() === (q.starter[language] || '').trim();
    const calls = q.samples.map((s) => ({ call: s.call[language], expected: s.expected[language] }));
    if (untouched) {
      if (language === 'java' && q.mode === 'method') {
        return { status: 'compile_error', simulated: true, message: 'Solution.java:4: error: missing return statement\n    }\n    ^\n1 error' };
      }
      if (language === 'java') {
        return { status: 'compile_error', simulated: true, message: 'Main.java:3: error: constructor BankAccount in class BankAccount cannot be applied to given types;\n        BankAccount a = new BankAccount("Ava", 100.0);\n                        ^\n  required: no arguments\n  found:    String,double\n1 error' };
      }
      if (q.mode === 'class') {
        return { status: 'runtime_error', simulated: true, message: 'Traceback (most recent call last):\n  File "main.py", line 4, in <module>\n    a = BankAccount("Ava", 100.0)\nTypeError: BankAccount() takes no arguments' };
      }
      return { status: 'ok', simulated: true, tests: calls.map((c) => ({ ...c, got: 'None', pass: false })), stdout: '' };
    }
    return { status: 'ok', simulated: true, tests: calls.map((c) => ({ ...c, got: c.expected, pass: true })), stdout: '' };
  }

  // Heartbeat watchdog: a client that goes quiet for 10s gets flagged (a warning, not a strike: wifi drops).
  setInterval(() => {
    const a = st && st.attempt;
    if (!a || a.status !== 'active') return;
    if (Date.now() - st.lastBeat > HEARTBEAT_LOST_MS && !st.beatLostFlagged) {
      st.beatLostFlagged = true;
      record('heartbeat-lost', Math.round((Date.now() - st.lastBeat) / 1000) + 's silent');
    }
    emit();
  }, 1000);

  BQ.api = {
    async join(code) {
      await delay(350);
      if (String(code).toUpperCase() !== JOIN_CODE) throw fail('bad_code');
      return {
        runId: 'demo-run', title: QUIZ.title, timeLimitMin: QUIZ.timeLimitMin,
        questionCount: QUIZ.questions.length, hasCode: QUIZ.questions.some((q) => q.type === 'code'),
      };
    },
    async findNames({ q }) {
      await delay(60);
      const term = String(q || '').trim().toLowerCase();
      if (term.length < 2) return { matches: [] };
      return { matches: ROSTER.filter((r) => r.name.toLowerCase().includes(term)).slice(0, 5).map(({ id, name }) => ({ id, name })) };
    },
    async attempt({ rosterId, studentId }) {
      await delay(400);
      const r = ROSTER.find((x) => x.id === rosterId);
      if (!r) throw fail('bad_id');
      const ft = (st.failedTries[rosterId] = st.failedTries[rosterId] || { n: 0, until: 0 });
      if (Date.now() < ft.until) throw fail('name_locked');
      if (r.sid !== studentId) {
        ft.n++;
        if (ft.n >= 5) { ft.n = 0; ft.until = Date.now() + 30000; }
        throw fail('bad_id');
      }
      if (st.attempt && st.attempt.rosterId === rosterId && st.attempt.status !== 'waiting') throw fail('already_started');
      st.attempt = {
        rosterId, name: r.name, status: 'waiting', integrity: 'clean', strikes: 0, warnings: 0,
        startedAt: 0, deadline: 0, answers: {}, result: null, runs: 0, edits: 0, reason: null,
      };
      st.events = [];
      st.mouse = [];
      log('join', r.name, 'info');
      emit();
      if (st.autoAdmit) setTimeout(() => BQ.api.teacher.admit(), 600);
      return { ok: true };
    },
    async admitStatus() {
      await delay(80);
      return { admitted: !!st.attempt && st.attempt.status !== 'waiting' };
    },
    async start() {
      await delay(300);
      const a = st.attempt;
      if (!a || a.status === 'waiting') throw fail('network');
      if (a.status === 'submitted') throw fail('run_closed');
      if (a.status === 'active') record('reload', 'reopened mid-quiz');
      else {
        a.status = 'active';
        a.startedAt = Date.now();
        a.deadline = a.startedAt + QUIZ.timeLimitMin * 60000;
        st.lastBeat = Date.now();
        log('start', null, 'info');
      }
      emit();
      return { quiz: publicQuiz(), deadline: a.deadline, now: Date.now(), saved: {} };
    },
    async event(type, detail) {
      if (!SERVER_ONLY.has(type)) record(type, detail);
      return { ok: true };
    },
    async beat(p) {
      const a = st.attempt;
      if (a && a.status === 'active') {
        st.lastBeat = Date.now();
        st.beatLostFlagged = false;
        if (p.focused && p.visible) st.away = false;
        else record('unfocused-beat', p.visible ? 'window not focused' : 'tab hidden');
        if (Array.isArray(p.mouse)) { st.mouse.push(...p.mouse); if (st.mouse.length > 6000) st.mouse.splice(0, st.mouse.length - 6000); }
        if (Array.isArray(p.edits)) a.edits += p.edits.length;
        if (p.answers) a.answers = p.answers;
        emit();
      }
      return { ok: true, now: Date.now() };
    },
    async run({ questionId, language, code }) {
      await delay(650 + Math.random() * 500);
      const q = QUIZ.questions.find((x) => x.id === questionId);
      if (!q) throw fail('network');
      if (st.attempt) { st.attempt.runs++; log('run', `${questionId} (${language === 'python' ? 'Python' : 'Java'})`, 'info'); emit(); }
      return simulateRun(q, language, String(code || ''));
    },
    async submit(answers) {
      await delay(300);
      const a = st.attempt;
      if (a && a.status === 'active') {
        a.answers = answers || a.answers;
        a.status = 'submitted';
        a.submittedAt = Date.now();
        a.result = grade(a.answers);
        log('submit', null, 'info');
        emit();
      }
      return { ok: true };
    },
    assetUrl: (p) => p,
    reset,

    // Teacher-side hooks, used only by the demo's teacher panel.
    teacher: {
      subscribe(fn) { listeners.add(fn); fn(st); return () => listeners.delete(fn); },
      admit() {
        const a = st.attempt;
        if (a && a.status === 'waiting') { a.status = 'admitted'; log('admit', null, 'info'); emit(); }
      },
      restore() {
        const a = st.attempt;
        if (a && a.integrity === 'invalidated') { a.integrity = 'restored'; log('restore', 'teacher restored the attempt', 'info'); emit(); }
      },
      setAutoAdmit(on) { st.autoAdmit = !!on; emit(); if (on) BQ.api.teacher.admit(); },
      quiz: QUIZ,
      severity: SEVERITY,
    },
  };

  reset();
})();
