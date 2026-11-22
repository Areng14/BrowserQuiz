// Checks a quiz before you upload it: the same validation the server runs, warnings for likely
// mistakes (typo'd keys, missing references), and with --run, every reference solution run against
// its tests on this computer.
//   node scripts/check-quiz.mjs examples/ap-csa-unit4          a folder, .quiz or .zip
//   node scripts/check-quiz.mjs examples/ap-csa-unit4 --run    also run references (python3; a JDK for Java; gcc/g++ for C/C++; go; rustc)
// Exit code 0 means the server will accept it (with --run: and the references pass).
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { writeZip, readZip } = require('../server/src/zip.js');
const { loadQuizFile, QuizError } = require('../server/src/quizfile.js');
const { bansFor } = require('../server/src/bans.js');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const run = args.includes('--run');
if (!target) {
  console.error('usage: node scripts/check-quiz.mjs <folder | file.quiz> [--run]');
  process.exit(2);
}

// ---------- load (a folder is zipped in memory, exactly like pack-quiz) ----------
function load(path) {
  if (!statSync(path).isDirectory()) return readFileSync(path);
  const entries = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!name.startsWith('.')) entries.push({ name: relative(path, p).split('\\').join('/'), data: readFileSync(p) });
    }
  };
  walk(path);
  return writeZip(entries);
}

const warnings = [];
const buf = load(target);
// ---------- warnings: typo'd keys and the like (shown even when the quiz is invalid) ----------
const TOP = ['format', 'title', 'timeLimitMin', 'shuffleQuestions', 'shuffleChoices', 'language', 'integrity', 'directions', 'shared', 'sections', 'questions'];
const QKEYS = ['id', 'type', 'name', 'prompt', 'points', 'image', 'imageAlt', 'shared', 'explanation', 'answer', 'caseSensitive', 'choices', 'shuffleChoices', 'partialCredit', 'mode', 'languages',
  'language', 'code', 'columns', 'rows', 'given',
  'signature', 'class', 'types', 'tests', 'reference', 'compare', 'noRun', 'limits', 'rubric', 'ban', 'starter', 'support'];
function near(word, list) {
  const d = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    }
    return m[a.length][b.length];
  };
  const best = list.map((k) => [k, d(word, k)]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 3 ? ` (did you mean "${best[0]}"?)` : '';
}
let zipped = new Map();
try { zipped = readZip(buf); } catch (e) { /* the validator below explains */ }
const jsonName = [...zipped.keys()].filter((n) => /^([^/]+\/)?quiz\.json$/.test(n)).sort((a, b) => a.length - b.length)[0];
let raw = {};
try { raw = JSON.parse(zipped.get(jsonName).toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { /* the validator below explains */ }
for (const k of Object.keys(raw)) if (!TOP.includes(k)) warnings.push(`unknown key "${k}" is ignored${near(k, TOP)}`);
(raw.questions || []).forEach((q, i) => {
  if (!q || typeof q !== 'object') return;
  const label = `question ${i + 1} (${q.id || `q${i + 1}`})`;
  for (const k of Object.keys(q)) if (!QKEYS.includes(k)) warnings.push(`${label}: unknown key "${k}" is ignored${near(k, QKEYS)}`);
  if (q.points !== undefined && !(Number(q.points) > 0)) warnings.push(`${label}: points ${JSON.stringify(q.points)} isn't a positive number, so it counts as 1`);
  // A code fence only works on its own lines: in a one-line choice it shows as backticks.
  (Array.isArray(q.choices) ? q.choices : []).forEach((c, k) => {
    if (/```/.test(String(c)) && !/\n/.test(String(c))) warnings.push(`${label}: choice ${k + 1} has a code fence on one line. Put the code on its own lines (\\n), or use \`inline code\``);
  });
});
let parsed;
try {
  parsed = loadQuizFile(buf);
} catch (e) {
  if (e instanceof QuizError) {
    for (const w of warnings) console.log('warning: ' + w);
    console.error('NOT VALID: ' + e.message);
    process.exit(1);
  }
  throw e;
}
const quiz = parsed.quiz;

for (const q of quiz.questions) {
  if (q.type !== 'code') continue; // fill-in questions build their reference from the answer key
  // ("any" is every language that can run it: a reference in each isn't expected)
  const missing = q.languagesAny ? (Object.keys(q.reference).length ? [] : ['any of them']) : q.languages.filter((l) => !q.reference[l]);
  if (missing.length) warnings.push(`${q.id}: no reference solution for ${missing.join(', ')}; nothing checks those tests until a student fails them`);
  if (!q.tests.sample.length) warnings.push(`${q.id}: no sample tests, so Run examples has nothing to run`);
}

// ---------- summary ----------
const count = (t) => quiz.questions.filter((q) => q.type === t).length;
const total = quiz.questions.reduce((s, q) => s + q.points, 0);
console.log(`${quiz.title}: ${quiz.questions.length} questions, ${total} points${quiz.timeLimitMin ? `, ${quiz.timeLimitMin} min` : ', no time limit'}`);
console.log(`  ${['single', 'multi', 'text', 'code', 'output', 'trace', 'fill', 'essay'].filter((t) => count(t)).map((t) => `${t} ${count(t)}`).join(', ')}, images ${parsed.assets.size}`);
for (const q of quiz.questions) {
  if (q.type !== 'code') continue;
  const what = q.mode === 'class' ? `class ${q.class.name}` : `method ${q.signature.name}`;
  console.log(`  ${q.id}: ${what} [${q.languagesAny ? 'any: ' : ''}${q.languages.join(', ')}], ${q.tests.sample.length} sample + ${q.tests.hidden.length} hidden tests, reference: ${Object.keys(q.reference).join(', ') || 'none'}`);
}
for (const w of warnings) console.log('warning: ' + w);

// ---------- --run: reference solutions against every test, on this computer ----------
const needsRun = quiz.questions.some((q) => q.type === 'code' || q.type === 'output' || (q.type === 'fill' && q.run));
if (!run) {
  console.log('VALID' + (needsRun ? ' (add --run to run the code: reference solutions and output questions)' : ''));
  process.exit(0);
}
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const tools = { java: has('javac') && has('java'), python: has('python3'), javascript: true, typescript: true, c: has('gcc'), cpp: has('g++'), go: spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0, rust: has('rustc'), csharp: false };
const MISSING = { java: 'no JDK', python: 'no python3', c: 'no gcc', cpp: 'no g++', go: 'no go', rust: 'no rustc', csharp: 'C# needs the runner' };
const outputsSkipped = [];
for (const [i, q] of quiz.questions.entries()) {
  if (q.type === 'output' && !tools[q.language]) { outputsSkipped.push(i); console.log(`skipped: question ${i + 1} output (${MISSING[q.language]} here; the server runs it on upload)`); }
  for (const lang of Object.keys(q.reference || {})) {
    if (!tools[lang]) {
      delete q.reference[lang];
      console.log(`skipped: ${q.id} ${lang} reference (${MISSING[lang]} here; the server checks it on upload)`);
    } else if (['c', 'cpp', 'go'].includes(lang) && bansFor(q.ban, lang).length) {
      // their ban check is the runner's (runner.py), and this stand-in doesn't have it
      console.log(`skipped: ${q.id} ${lang} ban check (the server checks it on upload)`);
    }
  }
}

// A stand-in for the sandboxed runner. Only reference solutions run here, so no sandbox.
function runJob(job) {
  const dir = mkdtempSync(join(tmpdir(), 'bq-check-'));
  try {
    for (const [name, body] of Object.entries(job.files)) writeFileSync(join(dir, name), body);
    const timeout = Math.max(2000, (job.timeMs || 2000) * 3);
    const env = { ...process.env };
    delete env.JAVA_TOOL_OPTIONS; // the JVM echoes these to stderr, burying compile errors
    delete env._JAVA_OPTIONS;
    const opts = { cwd: dir, encoding: 'utf8', timeout, maxBuffer: 8 << 20, env };
    if (job.language === 'java') {
      const srcs = Object.keys(job.files).filter((n) => n.endsWith('.java')).sort();
      const c = spawnSync('javac', ['-encoding', 'UTF-8', '-nowarn', '-d', '.', ...srcs], opts);
      if (c.status !== 0) return { status: 'compile_error', stdout: c.stdout, stderr: c.stderr || c.stdout };
      const r = spawnSync('java', ['-cp', '.', job.main || 'BQMain'], opts);
      return { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : 'ok', stdout: r.stdout || '', stderr: r.stderr || '' };
    }
    if (job.language === 'javascript' || job.language === 'typescript') {
      const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--stack-size=4000', job.main || 'main.cjs'], opts);
      return { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : 'ok', stdout: r.stdout || '', stderr: r.stderr || '' };
    }
    if (job.language === 'c' || job.language === 'cpp') {
      // the C++ prelude is the runner's (precompiled there; plain here)
      const cpp = job.language === 'cpp';
      const flags = cpp ? ['-std=gnu++17', '-D_GLIBCXX_ASSERTIONS', '-I' + join(import.meta.dirname, '..', 'runner')] : ['-std=gnu17'];
      const c = spawnSync(cpp ? 'g++' : 'gcc', [...flags, '-O2', '-w', ...(job.include ? ['-include', job.include] : []), '-o', 'main', ...(job.sources || []), ...(cpp ? [] : ['-lm'])], opts);
      if (c.status !== 0) return { status: 'compile_error', stdout: c.stdout, stderr: c.stderr || c.stdout };
      const r = spawnSync(join(dir, 'main'), [], opts);
      return { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : 'ok', stdout: r.stdout || '', stderr: r.stderr || '' };
    }
    if (job.language === 'go' || job.language === 'rust') {
      const c = job.language === 'go'
        ? spawnSync('go', ['build', '-o', 'main', ...job.sources], { ...opts, env: { ...env, GO111MODULE: 'off', GOFLAGS: '' } })
        : spawnSync('rustc', ['--edition', '2021', '-C', 'opt-level=1', '-A', 'warnings', '-o', 'main', job.sources[0]], opts);
      if (c.status !== 0) return { status: 'compile_error', stdout: c.stdout, stderr: c.stderr || c.stdout };
      const r = spawnSync(join(dir, 'main'), [], opts);
      return { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : 'ok', stdout: r.stdout || '', stderr: r.stderr || '' };
    }
    const r = spawnSync('python3', ['-B', job.main || 'main.py'], opts);
    return { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : 'ok', stdout: r.stdout || '', stderr: r.stderr || '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(runJob(JSON.parse(body))));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.RUNNER_URL = `http://127.0.0.1:${server.address().port}`;
process.env.RUNNER_TOKEN = 'local-check';
const { checkReferences, checkOutputs } = require('../server/src/coderun.js');
let ok = true;
try {
  await checkOutputs({ questions: quiz.questions.map((q, i) => (outputsSkipped.includes(i) ? { type: 'skip' } : q)) });
  for (const [i, q] of quiz.questions.entries()) if (q.type === 'output' && !outputsSkipped.includes(i)) console.log(`question ${i + 1} prints: ${JSON.stringify(q.answer)}`);
  await checkReferences(quiz);
  let n = 0;
  for (const q of quiz.questions) if (q.type === 'code' || (q.type === 'fill' && q.run)) n += Object.keys(q.reference).length * (q.tests.sample.length + q.tests.hidden.length);
  if (n) console.log(`references: ${n} test runs passed`);
} catch (e) {
  ok = false;
  console.error('REFERENCES FAILED: ' + e.message);
}
server.close();
console.log(ok ? 'VALID' : 'NOT VALID');
process.exit(ok ? 0 : 1);
