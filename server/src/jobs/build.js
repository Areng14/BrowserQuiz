'use strict';
// A job for the sandbox: the student's code, the harness's own files and the main program. Only code and
// inputs go to the sandbox; expected values stay here.

const fs = require('node:fs');
const path = require('node:path');
const B = require('../bans');
const crypto = require('node:crypto');
const T = require('../../../public/teacher/types.js');
const { C_PRELUDE, isC, isJs } = require('./literals');
const { CS_USINGS, cMain, cSol, cppMain, csMain, goMain, goPackaged, javaMain, jsExport, jsMain, pyMain, rsMain } = require('./mains');

const BQJ_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'BQJ.java'), 'utf8');
const BQH_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqh.py'), 'utf8');
const BQSCAN_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqscan.py'), 'utf8');
const BQJS_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqh.cjs'), 'utf8');
const BQRT_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqrt.c'), 'utf8');
const BQC_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqc.h'), 'utf8');
const BQCPP_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bq.hpp'), 'utf8');
const BQGO_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bqh.go'), 'utf8');
const BQRS_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'bq.rs'), 'utf8');
const BQCS_SRC = fs.readFileSync(path.join(__dirname, '..', 'harness', 'BQ.cs'), 'utf8');
// A snippet for "predict the output": Java statements get wrapped in a main method unless the code
// already has one (then the class around main is the program). C and C++ the same, in int main(), with the
// usual headers. Python, JavaScript and TypeScript run as is.
function buildSnippetJob(lang, code) {
  if (lang === 'python') return { language: 'python', files: { 'main.py': code }, main: 'main.py' };
  if (isJs(lang)) { const f = lang === 'typescript' ? 'main.ts' : 'main.js'; return { language: lang, files: { [f]: code }, main: f }; }
  if (lang === 'csharp') return { language: 'csharp', files: { 'main.cs': code, 'bqusings.cs': CS_USINGS }, main: 'main', sources: ['bqusings.cs', 'main.cs'] };
  if (lang === 'go') {
    let body;
    if (/^\s*package\s/m.test(code)) body = code;
    else if (/\bfunc\s+main\s*\(/.test(code)) body = 'package main\n' + code;
    else {
      body = 'package main\n\nimport (\n\t"fmt"\n\t"math"\n\t"sort"\n\t"strconv"\n\t"strings"\n)\n\nvar _, _, _, _, _ = fmt.Println, math.Abs, sort.Ints, strconv.Itoa, strings.Split\n\nfunc main() {\n'
        + code + '\n}\n';
    }
    return { language: 'go', files: { 'main.go': body }, main: 'main', sources: ['main.go'] };
  }
  if (lang === 'rust') {
    const body = /\bfn\s+main\s*\(/.test(code) ? '#![allow(warnings)] ' + code : `#![allow(warnings)]\nuse std::collections::*;\nfn main() {\n${code}\n}\n`;
    return { language: 'rust', files: { 'main.rs': body }, main: 'main', sources: ['main.rs'] };
  }
  if (isC(lang)) {
    const f = lang === 'cpp' ? 'main.cpp' : 'main.c';
    const body = /\bmain\s*\(/.test(code) ? code : `int main(${lang === 'c' ? 'void' : ''}) {\n${code}\n    return 0;\n}\n`;
    const files = { [f]: body };
    if (lang === 'c') files['bqpre.h'] = C_PRELUDE;
    return { language: lang, files, main: 'main', sources: [f], include: lang === 'c' ? 'bqpre.h' : 'bqpre.hpp' };
  }
  const imports = 'import java.util.*; import java.util.function.*; import java.util.stream.*; ';
  const at = code.search(/\bstatic\s+void\s+main\s*\(/);
  if (at >= 0) {
    const classes = [...code.slice(0, at).matchAll(/\bclass\s+(\w+)/g)];
    const name = classes.length ? classes[classes.length - 1][1] : 'Main';
    return { language: 'java', files: { [name + '.java']: imports + code }, main: name };
  }
  return { language: 'java', files: { 'Main.java': imports + 'public class Main { public static void main(String[] args) throws Exception {\n' + code + '\n} }' }, main: 'Main' };
}

// opts.scan: false leaves out the ban check's facts for the compiled languages (they're read once per answer).
function buildJob(q, lang, code, tests, opts) {
  const scan = B.bansFor(q.ban, lang).length > 0 && !(opts && opts.scan === false);
  // Random through and through, so there's no fixed part to search memory or output for.
  const marker = crypto.randomBytes(16).toString('hex');
  const files = {};
  if (lang === 'java') {
    // The directions promise common imports. Same line as the student's first line, so compile errors
    // still point at the line numbers they see. (Duplicate imports are legal Java; a package line isn't.)
    const imports = /^\s*package\s/m.test(code) ? '' : 'import java.util.*; import java.util.function.*; import java.util.stream.*; ';
    const mine = q.mode === 'class' ? `${q.class.name}.java` : 'Solution.java';
    files[mine] = imports + code;
    files['BQJ.java'] = BQJ_SRC;
    if (q.types) files['Given.java'] = T.classSource(q.types, 'java');
    if (q.support && q.support.java) files['Support.java'] = q.support.java;
    // The ban check reads the compiled classes, so only when there's something to check.
    files['BQMain.java'] = javaMain(q, tests, marker, B.bansFor(q.ban, 'java').length ? mine : null, q.types ? 'Given.java' : null);
    return { marker, job: { language: 'java', files, main: 'BQMain' } };
  }
  if (isJs(lang)) {
    const ts = lang === 'typescript';
    files[ts ? 'solution.cts' : 'solution.cjs'] = code + jsExport(q);
    files['bqh.cjs'] = BQJS_SRC;
    if (q.types) files['bqtypes.js'] = T.classSource(q.types, 'javascript');
    if (q.support && q.support[lang]) files[ts ? 'support.ts' : 'support.js'] = q.support[lang];
    files['main.cjs'] = jsMain(q, tests, marker, lang);
    return { marker, job: { language: lang, files, main: 'main.cjs' } };
  }
  // The ban check's facts for these come from the runner (runner.py, run_scan): which files it reads.
  const scanOf = (list) => (scan ? { scan: list } : {});
  if (lang === 'cpp') {
    Object.assign(files, { 'solution.cpp': code, 'bq.hpp': BQCPP_SRC, 'bqrt.c': BQRT_SRC, 'bqmain.cpp': cppMain(q, tests, marker) });
    return { marker, job: { language: 'cpp', files, main: 'main', sources: ['bqmain.cpp', 'bqrt.c'], ...scanOf(['bqmain.cpp', 'solution.cpp']) } };
  }
  if (lang === 'csharp') {
    Object.assign(files, { 'solution.cs': code, 'BQ.cs': BQCS_SRC, 'bqusings.cs': CS_USINGS, 'bqmain.cs': csMain(q, tests, marker) });
    if (q.types) files['bqtypes.cs'] = T.classSource(q.types, 'csharp');
    if (q.support && q.support.csharp) files['support.cs'] = q.support.csharp;
    const sources = Object.keys(files).filter((n) => n.endsWith('.cs')).sort();
    return { marker, job: { language: 'csharp', files, main: 'main', entry: 'BQMain', sources, ...scanOf(sources.filter((n) => n !== 'BQ.cs' && n !== 'bqmain.cs')) } };
  }
  if (lang === 'go') {
    Object.assign(files, { 'solution.go': goPackaged(code), 'bqh.go': BQGO_SRC, 'bqmain.go': goMain(q, tests, marker) });
    if (q.types) files['bqtypes.go'] = 'package main\n\n' + T.classSource(q.types, 'go');
    if (q.support && q.support.go) files['support.go'] = goPackaged(q.support.go);
    return { marker, job: { language: 'go', files, main: 'main', sources: Object.keys(files).filter((n) => n.endsWith('.go')).sort(), ...scanOf(['solution.go']) } };
  }
  if (lang === 'rust') {
    Object.assign(files, { 'solution.rs': code, 'bq.rs': BQRS_SRC, 'bqmain.rs': rsMain(q, tests, marker) });
    return { marker, job: { language: 'rust', files, main: 'main', sources: ['bqmain.rs'], ...scanOf(['solution.rs']) } };
  }
  if (lang === 'c') {
    Object.assign(files, {
      'solution.c': code, 'bqpre.h': C_PRELUDE + (q.types ? '\n' + T.classSource(q.types, 'c') : ''), 'bqc.h': BQC_SRC, 'bqrt.c': BQRT_SRC,
      'bqsol.c': cSol(q), 'bqmain.c': cMain(q, tests, marker),
    });
    return { marker, job: { language: 'c', files, main: 'main', sources: ['bqmain.c', 'bqsol.c', 'bqrt.c'], ...scanOf(['bqsol.c']) } };
  }
  files['solution.py'] = code;
  files['bqh.py'] = BQH_SRC;
  files['bqscan.py'] = BQSCAN_SRC;
  if (q.types) files['bqtypes.py'] = T.classSource(q.types, 'python');
  if (q.support && q.support.python) files['support.py'] = q.support.python;
  files['main.py'] = pyMain(q, tests, marker);
  return { marker, job: { language: 'python', files, main: 'main.py' } };
}

module.exports = { buildJob, buildSnippetJob };
