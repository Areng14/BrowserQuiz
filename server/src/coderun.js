'use strict';
// Talks to the sandboxed runner: Run (sample tests), grading (hidden tests), and checking
// a quiz's reference solutions at upload time.
const H = require('./harness');
const T = require('../../public/teacher/types.js');
const { checkValue, QuizError, normOutput, putVars } = require('./quizfile');
const { autoRubric } = require('./rubric');
const B = require('./bans');

const MAX_CONCURRENT = Math.max(1, Number(process.env.RUNNER_CONCURRENCY) || 4);
let active = 0;
const runs = [];
const waiting = [];
const later = [];

// Urgent: a student's Run, which they sit waiting for, goes ahead of grading (that can wait), so a flood of
// submissions never keeps a classmate's Run waiting for more than one job. Runs go in the order they came,
// so a class clicking Run at once doesn't leave the first to click waiting for all the rest. 'low': the quiz
// maker's search for tests that miss a mistake, after everything else.
async function withSlot(fn, urgent) {
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => (urgent === 'low' ? later : urgent ? runs : waiting).push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = runs.shift() || waiting.shift() || later.shift();
    if (next) next();
  }
}

function runnerConfigured() { return !!process.env.RUNNER_URL; }

// The languages the runner has (its /health: the standard runner has Java, Python, JavaScript and
// TypeScript), asked at most once a minute. null: not known (no runner, or it didn't answer). A runner
// from before it said is taken to have them all. each: the ones it builds once and runs each in ("runs").
let langs = { at: 0, list: null, each: [] };
async function runnerLanguages() {
  const url = (process.env.RUNNER_URL || '').replace(/\/$/, '');
  if (!url) return null;
  if (Date.now() - langs.at < (langs.list ? 60000 : 5000)) return langs.list;
  let list = null;
  let each = langs.each; // (a runner that doesn't answer once keeps what it said: a job finds out anyway, runEach)
  try {
    const res = await fetch(url + '/health', { signal: AbortSignal.timeout(1500) });
    const j = res.ok ? await res.json() : null;
    if (j) list = Array.isArray(j.languages) ? T.LANGS.filter((l) => j.languages.includes(l)) : T.LANGS.slice();
    if (j) each = Array.isArray(j.runs) ? j.runs : [];
  } catch (e) { /* not known */ }
  langs = { at: Date.now(), list, each };
  return list;
}
// What runnerLanguages last said, without asking (for code that can't wait): null when not known yet
const knownLanguages = () => { if (Date.now() - langs.at > (langs.list ? 60000 : 5000)) runnerLanguages(); return langs.list; };
// asked once at start, so the first students to load a quiz already get the answer
if (process.env.RUNNER_URL) setTimeout(() => runnerLanguages(), 1000).unref();
// The languages students may answer a code question in: with "any language", the ones the runner has
function studentLanguages(qq) {
  const have = qq.languagesAny && knownLanguages();
  return have && qq.languages.some((l) => have.includes(l)) ? qq.languages.filter((l) => have.includes(l)) : qq.languages;
}
// The languages a question needs the runner to have, that it doesn't: [] when it has them (or isn't known)
function missingLanguages(have, qq) {
  if (!have) return [];
  const need = qq.type === 'output' || (qq.type === 'fill' && qq.run) ? [qq.language]
    : qq.type === 'code' ? [...(qq.languagesAny ? [] : qq.languages), ...Object.keys(qq.reference || {})] : [];
  return [...new Set(need)].filter((l) => l && !have.includes(l));
}

async function runnerHealthy() {
  const url = (process.env.RUNNER_URL || '').replace(/\/$/, '');
  if (!url) return false;
  try {
    const res = await fetch(url + '/health', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// stale(): true when the job isn't wanted any more by the time it gets a slot (it's skipped: null)
async function callRunner(job, timeMs, memoryMb, urgent, stale) {
  const url = (process.env.RUNNER_URL || '').replace(/\/$/, '');
  if (!url) { const e = new Error('The code runner is not set up.'); e.code = 'runner_offline'; throw e; }
  return withSlot(async () => {
    if (stale && stale()) return null;
    let res;
    try {
      res = await fetch(url + '/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.RUNNER_TOKEN || '') },
        body: JSON.stringify({ ...job, timeMs, memoryMb }),
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      const err = new Error("Can't reach the code runner."); err.code = 'runner_offline'; throw err;
    }
    if (!res.ok) { const err = new Error(`The code runner answered ${res.status}.`); err.code = 'runner_offline'; throw err; }
    return res.json();
  }, urgent);
}

const isJsLang = (lang) => lang === 'javascript' || lang === 'typescript';
const job0Scans = (q, lang) => B.bansFor(q.ban, lang).length > 0 && ['c', 'cpp', 'go', 'csharp', 'rust'].includes(lang);

// Build once, run each (the runner's "runs", runner/each.py): the languages whose harness runs only the test
// it's given the number of. A build holds at most EACH_MAX tests (the runner's most runs), and as many as keep
// the generated test file to EACH_MAIN bytes (javac's constants for one class) and the job to EACH_JOB.
// EACH_BUDGET: how far into a job the runner still starts a run (each.py's BUDGET_S).
const EACH_LANGS = ['java'];
const EACH_FILE = { java: 'BQMain.java' };
const EACH_MAX = 100;
const EACH_MAIN = 100 * 1024;
const EACH_JOB = 300 * 1024;
const EACH_BUDGET = 10000;
const jobBytes = (job) => Object.values(job.files).reduce((s, f) => s + Buffer.byteLength(f), 0);

// Every test in one build, then each run in a process of its own from it, with the time and memory a job's one
// run has: one part per test, just as one job per test gives them. Tests the runner had no time left for
// ("skipped": code that hangs) go again, side by side in builds of as many as the runs before took the time for.
// null: the runner doesn't build once after all (one from before, which ran the program as a whole and said
// nothing of runs), so it's one job per test.
async function runEach(q, lang, code, tests) {
  const parts = new Array(tests.length);
  let before = false;
  const fill = (ids, r) => { for (const i of ids) parts[i] = r; };
  async function build(ids, first) {
    let n = Math.min(ids.length, EACH_MAX);
    let built = H.buildJob(q, lang, code, ids.slice(0, n).map((i) => tests[i]), { scan: first });
    while (n > 1 && (Buffer.byteLength(built.job.files[EACH_FILE[lang]] || '') > EACH_MAIN || jobBytes(built.job) > EACH_JOB)) {
      n = Math.ceil(n / 2);
      built = H.buildJob(q, lang, code, ids.slice(0, n).map((i) => tests[i]), { scan: first });
    }
    const list = ids.slice(0, n).map((i) => tests[i]);
    const { marker, job } = built;
    const res = await callRunner({ ...job, runs: n }, q.limits.timeMs, q.limits.memoryMb);
    if (!Array.isArray(res.runs)) {
      if (!['compile_error', 'error', 'unavailable'].includes(res.status)) { before = true; return; }
      fill(ids, H.readResults(q, lang, list, res, marker)); // didn't compile, or the job broke: for all of them
      return;
    }
    const left = [];
    const took = [];
    for (let k = 0; k < n; k++) {
      const run = res.runs[k];
      if (!run || run.status === 'skipped') { left.push(ids[k]); continue; }
      took.push(Number(run.ms) || 0);
      // In the compiled languages the ban check's facts are the runner's, read once: with the first test.
      parts[ids[k]] = H.readResults(q, lang, [list[k]], first && k === 0 && res.scan !== undefined ? { ...run, scan: res.scan } : run, marker, k);
    }
    if (!took.length) { fill(ids, H.readResults(q, lang, list, { status: 'error' }, marker)); return; } // nothing ran: broken
    left.push(...ids.slice(n));
    const per = Math.max(1, Math.floor(EACH_BUDGET / Math.max(1, ...took)));
    const groups = [];
    for (let k = 0; k < left.length; k += per) groups.push(left.slice(k, k + per));
    await Promise.all(groups.map((g) => build(g, false)));
  }
  await build(tests.map((_, i) => i), true);
  return before ? null : parts;
}

// One job for all tests (Run, reference checks), or for grading each test in a process of its own (so a hang
// only costs one test): built once where the runner can (runEach), else one job per test.
async function runTests(q, lang, code, tests, opts) {
  const perTest = opts && opts.perTest;
  if (!perTest) {
    const { marker, job } = H.buildJob(q, lang, code, tests);
    const res = await callRunner(job, Math.min(10000, q.limits.timeMs * tests.length), q.limits.memoryMb, opts && opts.urgent);
    return H.readResults(q, lang, tests, res, marker);
  }
  await runnerLanguages();
  const parts = (EACH_LANGS.includes(lang) && langs.each.includes(lang) && await runEach(q, lang, code, tests))
    // In the compiled languages the ban check's facts are the runner's, read once: with the first test.
    || await Promise.all(tests.map(async (t, k) => {
      const { marker, job } = H.buildJob(q, lang, code, [t], { scan: k === 0 });
      const res = await callRunner(job, q.limits.timeMs, q.limits.memoryMb);
      return H.readResults(q, lang, [t], res, marker);
    }));
  const compile = parts.find((p) => p.status === 'compile_error');
  if (compile) return compile;
  // A job that broke (the runner busy, a compile out of time) says nothing about the code: the whole answer
  // is graded again later (the sweeper retries), never a failed test.
  const broken = parts.find((p) => p.status === 'error');
  if (broken) return broken;
  // (JavaScript's are what each test's run tripped: all of them count)
  const scan = isJsLang(lang) ? { hits: [...new Set(parts.flatMap((p) => (p.scan && p.scan.hits) || []))] } : (parts.find((p) => p.scan) || {}).scan || null;
  return { status: 'ok', scan, tests: parts.map((p) => (p.status === 'ok' ? p.tests[0] : { pass: false, error: p.message || 'Run failed' })) };
}

// A question with bans but no sample tests still needs a run to get the facts: an empty one does.
async function runSamples(q, lang, code) {
  const banned = B.bansFor(q.ban, lang).length > 0;
  if (!q.tests.sample.length && !banned) return { status: 'ok', tests: [], stdout: '' };
  const r = await runTests(q, lang, code, q.tests.sample, { urgent: true });
  const used = r.status === 'ok' || r.status === 'compile_error' ? [...B.bannedUse(q.ban, lang, r.scan, q.types), ...B.macroUse(q.ban, lang, code)] : [];
  if (used.length) return { status: 'banned', banned: used, message: `Uses ${used.join(', ')}.` };
  return H.studentView(q, lang, q.tests.sample, r);
}

async function gradeCode(q, answer) {
  const max = q.points - q.rubric.reduce((s, r) => s + r.points, 0);
  const tests = q.tests.hidden;
  if (!answer || typeof answer.code !== 'string' || !q.languages.includes(answer.language) || !answer.code.trim()) {
    return { status: 'done', score: 0, max, note: 'No answer', tests: tests.map(() => ({ pass: false, error: 'No answer' })) };
  }
  const r = await runTests(q, answer.language, answer.code, tests, { perTest: true });
  // Using a banned method scores 0, whatever the tests say (they still run, for the teacher to see).
  const used = [...B.bannedUse(q.ban, answer.language, r.scan, q.types), ...B.macroUse(q.ban, answer.language, answer.code)];
  const banned = used.length ? { banned: used, note: `Not allowed: ${used.join(', ')}` } : null;
  if (r.status === 'compile_error') {
    // That message came from a build with a hidden test in it, and code can get a test's input into its
    // own error. Show the one the sample tests give (the same mistake shows there), or just that it didn't.
    let compileError = "Didn't compile.";
    try {
      const s = await runTests(q, answer.language, answer.code, q.tests.sample);
      if (s.status === 'compile_error') compileError = s.message;
      else if (s.status === 'error') return { status: 'error', score: 0, max, message: s.message };
    } catch (e) { /* keep the plain one */ }
    return {
      status: 'done', score: 0, max, language: answer.language, compileError, tests: tests.map(() => ({ pass: false, error: "Didn't compile" })),
      rubric: autoRubric(q, answer.language, answer.code, false), ...banned,
    };
  }
  if (r.status !== 'ok') return { status: 'error', score: 0, max, message: r.message };
  const total = tests.reduce((s, t) => s + t.weight, 0);
  const passed = r.tests.reduce((s, t, i) => s + (t.pass ? tests[i].weight : 0), 0);
  return {
    status: 'done',
    language: answer.language,
    score: banned ? 0 : Math.round((max * passed / total) * 100) / 100,
    max,
    rubric: autoRubric(q, answer.language, answer.code, !banned && r.tests.some((t) => t.pass)),
    ...banned,
    tests: r.tests.map((t, i) => ({
      pass: !!t.pass,
      call: H.callText(q, tests[i], answer.language),
      expected: H.expectedText(q, tests[i], answer.language),
      got: t.error ? t.error : q.mode === 'method' ? H.show(q.signature.returns, t.got, answer.language, q.types) : undefined,
    })),
  };
}

// Upload-time check: run each reference solution against every test, fill in missing expected values,
// and refuse the quiz if a reference disagrees with an expected value the teacher typed.
async function checkReferences(quiz) {
  const problems = [];
  for (const q of quiz.questions) {
    if (!(q.type === 'code' || (q.type === 'fill' && q.run))) continue;
    const refs = Object.entries(q.reference || {});
    for (const [lang, code] of refs) {
      for (const kind of ['sample', 'hidden']) {
        const tests = q.tests[kind];
        if (!tests.length) continue;
        const r = await runTests(q, lang, code, tests);
        const used = r.status === 'ok' ? [...B.bannedUse(q.ban, lang, r.scan, q.types), ...B.macroUse(q.ban, lang, code)] : [];
        if (used.length) { problems.push(`${q.id} (${lang}): the reference solution uses ${used.join(', ')}, which "ban" doesn't allow.`); break; }
        if (r.status !== 'ok') {
          problems.push(`${q.id} (${lang}): the reference solution ${r.status === 'compile_error' ? "doesn't compile" : "couldn't run"}: ${String(r.message || '').slice(0, 300)}`);
          break;
        }
        r.tests.forEach((res, i) => {
          const t = tests[i];
          const label = `${q.id} ${kind} test ${i + 1} (${lang})`;
          if (res.error) { problems.push(`${label}: the reference solution failed: ${res.error}`); return; }
          // Speed tests: students get 10x the reference's time in their language, and never less than 100 ms.
          if (t.speed) t.maxMs = Object.assign({}, t.maxMs, { [lang]: Math.max(100, Math.ceil((res.ms || 0) * 10)) });
          if (q.mode === 'method') {
            if (t.expected === undefined) {
              const got = H.clean(q.signature.returns, res.got, q.types);
              if (checkValue(q.signature.returns, got, q.types)) t.expected = got;
              else problems.push(`${label}: the reference solution returned something that isn't a ${q.signature.returns}.`);
            } else if (!res.pass) {
              problems.push(`${label}: expected ${H.show(q.signature.returns, t.expected, lang, q.types)} but the reference solution returned ${H.show(q.signature.returns, res.got, lang, q.types)}.`);
            }
          } else {
            t.steps.forEach((st, k) => {
              if (st.check && st.expect === undefined) {
                const sm = (st.m != null && q.class.methods[st.m]) || q.class.methods.find((x) => x.name === st.call);
                st.expect = H.clean(sm.returns, res.gotSteps[k], q.types);
                delete st.check;
              }
            });
            if (res.pass === false) problems.push(`${label}: the reference solution doesn't match the expected values.`);
          }
        });
      }
    }
    for (const kind of ['sample', 'hidden']) {
      q.tests[kind].forEach((t, i) => {
        if (q.mode === 'method' && t.expected === undefined) problems.push(`${q.id} ${kind} test ${i + 1}: no expected value.`);
        if (q.mode === 'class') t.steps.forEach((st) => { if (st.check) problems.push(`${q.id} ${kind} test ${i + 1}: a checked step has no value.`); });
      });
    }
  }
  if (problems.length) throw new QuizError('The reference solution check failed:\n- ' + problems.slice(0, 20).join('\n- '));
}

// The quiz maker's check as a question is written: every solution against every test, nothing saved or
// filled in. Per language, per test: what came back (and as that language writes it), and whether it
// matches the expected value typed (null where none was typed). Class tests say it per step.
async function checkSolutions(q) {
  const tests = q.tests.hidden; // the maker sends every test as hidden
  const out = {};
  for (const [lang, code] of Object.entries(q.reference || {})) {
    if (!code.trim()) continue;
    const r = await runTests(q, lang, code, tests);
    if (r.status !== 'ok') { out[lang] = { status: r.status === 'compile_error' ? 'compile_error' : 'error', message: String(r.message || '').slice(0, 1000) }; continue; }
    const banned = [...B.bannedUse(q.ban, lang, r.scan, q.types), ...B.macroUse(q.ban, lang, code)];
    out[lang] = {
      status: 'ok',
      banned,
      tests: r.tests.map((res, i) => {
        if (res.error) return { error: String(res.error).slice(0, 300) };
        if (q.mode === 'method') {
          const got = H.clean(q.signature.returns, res.got, q.types);
          return { pass: res.pass, got, shown: H.show(q.signature.returns, got, lang, q.types) };
        }
        return {
          pass: res.pass,
          steps: tests[i].steps.map((st, k) => {
            if (!(k in res.gotSteps)) return null;
            const m = q.class.methods.find((x) => x.name === st.call) || {};
            const got = H.clean(m.returns, res.gotSteps[k], q.types);
            return { got, shown: H.show(m.returns, got, lang, q.types), pass: st.expect === undefined ? null : H.same(m.returns, st.expect, res.gotSteps[k], q.compare === 'unordered', q.types) };
          }),
        };
      }),
    };
  }
  return out;
}

// One job of the maker's search for tests that miss a mistake (mutants.js): every test at once, within
// timeMs, after everything else; null when it went stale while it waited
async function runJob(q, lang, code, tests, timeMs, stale) {
  const { marker, job } = H.buildJob(q, lang, code, tests, { scan: false });
  const res = await callRunner(job, timeMs, q.limits.memoryMb, 'low', stale);
  return res && H.readResults(q, lang, tests, res, marker);
}

// "Predict the output": run each snippet. A missing answer is filled in from what it prints; an answer the
// teacher typed has to match it.
async function checkOutputs(quiz) {
  const problems = [];
  for (const [i, q] of quiz.questions.entries()) {
    if (q.type !== 'output') continue;
    // With random values, every row is run and has to print its own answer.
    for (const [r, row] of (q.vars || [null]).entries()) {
      const v = row ? putVars(q, row) : q;
      const label = row ? `Question ${i + 1}, random values row ${r + 1}` : `Question ${i + 1}`;
      if (row && q.answer == null) { problems.push(`Question ${i + 1}: with random values, give the answer as {{name}} and put each row's in the row.`); break; }
      const res = await callRunner(H.buildSnippetJob(v.language, v.code), 5000, 256);
      if (res.status === 'unavailable') { problems.push(`${label}: this server's code runner doesn't have ${T.LANG_NAMES[v.language]}.`); break; }
      const err = String(res.stderr || res.stdout || '').replace(/\/jobs\/(?:\d+\/)?[^/\s]+\//g, '').trim().slice(0, 400);
      if (res.status === 'compile_error') { problems.push(`${label}: the code doesn't compile: ${err}`); continue; }
      if (res.status === 'timeout') { problems.push(`${label}: the code ran out of time.`); continue; }
      if (res.status !== 'ok' || res.exitCode) { problems.push(`${label}: the code crashed: ${err}`); continue; }
      const printed = normOutput(res.stdout);
      if (!printed) { problems.push(`${label}: the code doesn't print anything.`); continue; }
      const want = row ? normOutput(v.answer) : q.answer;
      if (want == null) q.answer = printed.slice(0, 5000);
      else if (want !== printed) problems.push(`${label}: the code prints ${JSON.stringify(printed.slice(0, 200))}, but the answer says ${JSON.stringify(want.slice(0, 200))}.`);
    }
  }
  if (problems.length) throw new QuizError('The output check failed:\n- ' + problems.slice(0, 20).join('\n- '));
}

module.exports = { runSamples, gradeCode, checkReferences, checkSolutions, checkOutputs, runJob, runnerConfigured, runnerHealthy, runnerLanguages, knownLanguages, missingLanguages, studentLanguages };
