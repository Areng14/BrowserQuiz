'use strict';
// The main program for each language: it calls the student's code once per test and prints each result.

const B = require('../bans');
const T = require('../../../public/teacher/types.js');
const { elementType, isRange } = require('../quizfile');
const { cArg, cStr, cWriter, cppLit, csLit, goLit, javaLit, javaStr, javaType, jsDesc, jsLit, rsLit, stepMethod } = require('./literals');

// ---------- job building ----------
function javaMain(q, tests, marker, scanFile, givenFile) {
  const L = ['import java.util.*;', '', 'public class BQMain {'];
  tests.forEach((t, i) => {
    L.push(`    static void t${i}(String m) throws Throwable {`);
    if (q.mode === 'method' && t.speed) {
      // Speed test: the arguments are made first, then only the calls are timed.
      const s = q.signature;
      t.args.forEach((a, k) => L.push(`        ${javaType(s.params[k].type)} a${k} = ${javaLit(s.params[k].type, a, q.types)};`));
      L.push('        Solution sol = new Solution();', '        Object r = null;', '        long t0 = System.nanoTime();',
        `        for (int c = 0; c < ${t.calls || 1}; c++) r = sol.${s.name}(${t.args.map((_, k) => 'a' + k).join(', ')});`,
        `        BQJ.timed(m, ${i}, r, (System.nanoTime() - t0) / 1e6);`);
    } else if (q.mode === 'method') {
      const s = q.signature;
      L.push(`        BQJ.ok(m, ${i}, new Solution().${s.name}(${t.args.map((a, k) => javaLit(s.params[k].type, a, q.types)).join(', ')}));`);
    } else {
      const C = q.class;
      const declared = new Set();
      t.steps.forEach((st, k) => {
        if (st.new) {
          const decl = declared.has(st.as) ? '' : `${C.name} `;
          declared.add(st.as);
          L.push(`        ${decl}o_${st.as} = new ${C.name}(${st.new.map((a, j) => javaLit(C.constructor[j].type, a, q.types)).join(', ')});`);
          return;
        }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => javaLit(m.params[j].type, a, q.types)).join(', ')})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        BQJ.step(m, ${i}, ${k}, ${call});`);
        else L.push(`        ${call};`);
      });
      L.push(`        BQJ.done(m, ${i});`);
    }
    L.push('    }');
  });
  // The marker stays a local, and this file (source and class) is gone before student code runs. Given a
  // test's number (the runner's "runs": built once, each test in a process of its own), only that test runs,
  // and the ban check's facts come with the first. The number is read without naming a class: the student's
  // classes are in this package, and one of theirs could be called Integer.
  L.push('', '    public static void main(String[] args) {', `        String m = ${javaStr(marker)};`, '        BQJ.begin();',
    '        new java.io.File("BQMain.java").delete();', '        new java.io.File("BQMain.class").delete();',
    '        int only = -1;', '        if (args.length > 0) { only = 0; for (char c : args[0].toCharArray()) only = only * 10 + (c - \'0\'); }');
  if (scanFile) L.push(`        if (only <= 0) BQJ.scan(m, ${javaStr(scanFile)}, ${givenFile ? javaStr(givenFile) : 'null'});`);
  tests.forEach((_, i) => L.push(`        if (only < 0 || only == ${i}) { try { t${i}(m); } catch (Throwable e) { BQJ.fail(m, ${i}, e); } }`));
  L.push('        System.out.flush();', '    }', '}', '');
  return L.join('\n');
}

function pyMain(q, tests, marker) {
  const a = (params, v) => `bqh.args(${JSON.stringify(JSON.stringify(v.map((x, j) => pyArg(params[j] ? params[j].type : '', x, q.types))))})`;
  // Everything lives inside _bq(): the marker and the helpers are locals, taken before the student's code
  // is imported, and main.py deletes itself first. The facts for the ban check come before any of it runs.
  const L = ['import sys', 'import time', 'sys.setrecursionlimit(10000)', '', 'def _bq():', `    M = ${JSON.stringify(marker)}`,
    '    import os', '    try:', '        os.remove(__file__)', '    except OSError:', '        pass',
    '    import bqh', '    out = bqh.writer(M, sys.stdout)', '    del M',
    '    ok, timed, step, done, fail, args, clock = bqh.ok, bqh.timed, bqh.step, bqh.done, bqh.fail, bqh.args, time.perf_counter',
    '    import bqscan', '    out({"scan": bqscan.scan("solution.py")})'];
  // The question's classes (types.js classSource), usable without an import like Python's own.
  if (q.types) {
    L.push('    import builtins, bqtypes', `    bqh.TYPES = ${JSON.stringify(Object.fromEntries(Object.entries(q.types).map(([n, fs]) => [n, fs.map((f) => f.name)])))}`,
      '    bqh.CLASSES = {_n: getattr(bqtypes, _n) for _n in bqh.TYPES}', '    for _n, _c in bqh.CLASSES.items():', '        setattr(builtins, _n, _c)');
  }
  if (q.support && q.support.python) {
    L.push('    import builtins, support', '    for _k in dir(support):', '        if not _k.startswith("_"):', '            setattr(builtins, _k, getattr(support, _k))');
  }
  L.push('    try:', '        import solution', '    except BaseException as _e:', '        import traceback',
    '        out({"compile": True, "err": "".join(traceback.format_exception_only(type(_e), _e))[-2000:]})',
    '        return');
  const A = (params, v) => a(params, v).replace(/^bqh\.args/, 'args');
  tests.forEach((t, i) => {
    L.push(`    def t${i}():`);
    if (q.mode === 'method' && t.speed) {
      L.push(`        _a = ${A(q.signature.params, t.args)}`, '        _s = solution.Solution()', '        _r = None', '        _t0 = clock()',
        `        for _c in range(${t.calls || 1}):`, `            _r = _s.${q.signature.name}(*_a)`, `        timed(out, ${i}, _r, (clock() - _t0) * 1000)`);
    } else if (q.mode === 'method') {
      L.push(`        ok(out, ${i}, solution.Solution().${q.signature.name}(*${A(q.signature.params, t.args)}))`);
    } else {
      const C = q.class;
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`        o_${st.as} = solution.${C.name}(*${A(C.constructor, st.new)})`); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(*${A(m.params, st.args)})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        step(out, ${i}, ${k}, ${call})`);
        else L.push(`        ${call}`);
      });
      L.push(`        done(out, ${i})`);
    }
  });
  L.push(`    for _i, _t in enumerate([${tests.map((_, i) => 't' + i).join(', ')}]):`, '        try:', '            _t()', '        except BaseException as _e:', '            fail(out, _i, _e)',
    '', '', '_bq()', '');
  return L.join('\n');
}

// JavaScript and TypeScript: main.cjs loads the question's classes and support code as plain scripts (so they're
// globals, like Python's builtins), then the student's file, which ends with a line handing back what the
// question asks for. Everything with the marker is in a closure made before their code loads (bqh.cjs).
function jsMain(q, tests, marker, lang) {
  const D = q.types;
  const L = ["'use strict';", '(function () {', `  const M = ${JSON.stringify(marker)};`, "  const fs = require('fs');",
    '  try { fs.unlinkSync(__filename); } catch (e) {}', "  const H = require('./bqh.cjs');", '  const out = H.writer(M);',
    '  const { ok, timed, step, done, fail, broken, missing, range, map, enc, now } = H;'];
  if (D) L.push(`  H.classes({ ${Object.entries(D).map(([n, fs]) => `${JSON.stringify(n)}: [${fs.map((f) => `[${JSON.stringify(f.name)}, ${jsDesc(f.type, D)}]`).join(', ')}]`).join(', ')} });`);
  const scripts = [];
  if (D) scripts.push(['bqtypes.js', false]);
  if (q.support && q.support[lang]) scripts.push([lang === 'typescript' ? 'support.ts' : 'support.js', lang === 'typescript']);
  if (scripts.length) {
    L.push("  const vm = require('vm');", "  const strip = require('module').stripTypeScriptTypes;");
    for (const [f, ts] of scripts) {
      L.push(`  { let src = fs.readFileSync(${JSON.stringify(f)}, 'utf8');${ts ? " if (strip) src = strip(src, { mode: 'transform' });" : ''} vm.runInThisContext(src, { filename: ${JSON.stringify(f)} }); }`);
    }
  }
  // Bans are tripwires on the builtins, armed as their file loads (bqh.cjs guard).
  const file = `solution.${lang === 'typescript' ? 'cts' : 'cjs'}`;
  const bans = B.bansFor(q.ban, lang);
  if (bans.length) L.push(`  H.guard(${JSON.stringify(bans)}, out, ${JSON.stringify(file)}, ${lang === 'typescript'});`);
  L.push('  let S;', `  try { S = require('./${file}'); S = (S && S.__bq) || {}; } catch (e) { broken(out, e); return; }`);
  if (q.mode === 'method') {
    const s = q.signature;
    L.push(`  if (missing(out, S, [["f", ${JSON.stringify(s.name)}, ${JSON.stringify(`${s.name}(${s.params.map((p) => p.name).join(', ')})`)}]])) return;`, `  const F = S[${JSON.stringify(s.name)}];`);
  } else {
    L.push(`  if (missing(out, S, [["c", ${JSON.stringify(q.class.name)}, ${JSON.stringify([...new Set(q.class.methods.map((m) => m.name))])}]])) return;`, `  const C = S[${JSON.stringify(q.class.name)}];`);
  }
  L.push('  const tests = [');
  tests.forEach((t, i) => {
    L.push('    () => {');
    if (q.mode === 'method') {
      const s = q.signature;
      const R = jsDesc(s.returns, D);
      if (t.speed) {
        // The arguments are made first; the calls and writing out what came back are timed.
        t.args.forEach((a, k) => L.push(`      const a${k} = ${jsLit(s.params[k].type, a, D)};`));
        L.push('      let r;', '      const t0 = now();', `      for (let c = 0; c < ${t.calls || 1}; c++) r = F(${t.args.map((_, k) => 'a' + k).join(', ')});`,
          `      const v = enc(${R}, r);`, `      timed(out, ${i}, v, now() - t0);`);
      } else {
        L.push(`      ok(out, ${i}, ${R}, F(${t.args.map((a, k) => jsLit(s.params[k].type, a, D)).join(', ')}));`);
      }
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      if (names.length) L.push(`      let ${names.map((n) => 'o_' + n).join(', ')};`);
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`      o_${st.as} = new C(${st.new.map((a, j) => jsLit(C.constructor[j].type, a, D)).join(', ')});`); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${st.args.map((a, j) => jsLit(m.params[j].type, a, D)).join(', ')})`;
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`      step(out, ${i}, ${k}, ${jsDesc(m.returns, D)}, ${call});`);
        else L.push(`      ${call};`);
      });
      L.push(`      done(out, ${i});`);
    }
    L.push('    },');
  });
  L.push('  ];', '  for (let i = 0; i < tests.length; i++) {', '    try { tests[i](); } catch (e) { fail(out, i, e); }', '  }', '})();', '');
  return L.join('\n');
}
// The last line of the student's file: what the question asks for, handed back to main.cjs.
function jsExport(q) {
  const n = q.mode === 'method' ? q.signature.name : q.class.name;
  return `\n;module.exports.__bq = { ${n}: typeof ${n} === "undefined" ? undefined : ${n} };\n`;
}

// C++: one file that has the standard headers (precompiled), the question's classes and support code, then
// the student's file, then the harness. Each test runs in its own process (bqrt.c), so a crash is only that
// test's. Arguments are locals of the exact types, so vector<int>& and by-value parameters both take them.
const ALARM = (q) => Math.max(1, Math.ceil(q.limits.timeMs / 1000) * 2);
function cppMain(q, tests, marker) {
  const D = q.types;
  const L = ['#include "bqpre.hpp"'];
  if (D) L.push(T.classSource(D, 'cpp'));
  if (q.support && q.support.cpp) L.push(q.support.cpp);
  // Their own main() can stay; a "#define int long long" doesn't reach the harness.
  L.push('#define main bq_student_main', '#include "solution.cpp"', '#undef main', '#ifdef int', '#undef int', '#endif', '#include "bq.hpp"');
  if (D) {
    const names = Object.keys(D);
    L.push('namespace bq {', ...names.map((n) => `void j(W& w, const ${n}* p);`));
    for (const n of names) {
      L.push(`void j(W& w, const ${n}* p) {`, '    if (!p) { w.s += "null"; return; }', '    if (w.d > 400) { w.s += "\\"...\\""; return; }', '    w.d++;');
      D[n].forEach((f, k) => L.push(`    w.s += ${JSON.stringify((k ? ',' : '{') + JSON.stringify(f.name) + ':')};`, `    j(w, p->${f.name});`));
      L.push(`    w.s += "${D[n].length ? '}' : '{}'}";`, '    w.d--;', '}');
    }
    L.push('}  // namespace bq');
  }
  const locals = (params, args, ind) => params.map((p, k) => `${ind}${T.cppType(p.type)} a${k} = ${cppLit(T.canon(p.type), args[k], D)};`);
  const argNames = (n) => Array.from({ length: n }, (_, k) => 'a' + k).join(', ');
  const paramList = (params) => params.map((p, k) => `${T.cppType(p.type)} a${k}`);
  // The test code is all in namespace bq, which the ban check leaves out (bans.js). Each method the question
  // asks for is also called here with arguments the compiler can't know, so every one is compiled whole
  // whichever tests run.
  L.push('namespace bq {');
  if (q.mode === 'method') {
    L.push(`void keep(${paramList(q.signature.params).join(', ')}) { Solution sol; (void)sol.${q.signature.name}(${argNames(q.signature.params.length)}); }`);
  } else {
    const C = q.class;
    L.push(`void keep_new(${paramList(C.constructor).join(', ')}) { (void)new ${C.name}(${argNames(C.constructor.length)}); }`);
    C.methods.forEach((m, j) => L.push(`void keep${j}(${[`${C.name}* o`, ...paramList(m.params)].join(', ')}) { (void)o->${m.name}(${argNames(m.params.length)}); }`));
  }
  tests.forEach((t, i) => {
    L.push(`static void t${i}(int i) {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(...locals(s.params, t.args, '    '), '    Solution sol;', `    ${T.cppType(s.returns)} r = sol.${s.name}(${argNames(s.params.length)});`,
        '    bq::W w;', '    bq::j(w, r);', '    bq::ok(i, w);');
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      if (names.length) L.push(`    ${names.map((n) => `${C.name}* o_${n} = nullptr;`).join(' ')}`);
      t.steps.forEach((st, k) => {
        if (st.new) { L.push('    {', ...locals(C.constructor, st.new, '        '), `        o_${st.as} = new ${C.name}(${argNames(C.constructor.length)});`, '    }'); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}->${st.call}(${argNames(m.params.length)})`;
        L.push('    {', ...locals(m.params, st.args, '        '));
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        ${T.cppType(m.returns)} r = ${call};`, '        bq::W w;', '        bq::j(w, r);', `        bq::step(i, ${k}, w);`);
        else L.push(`        ${call};`);
        L.push('    }');
      });
      L.push('    bq::done(i);');
    }
    L.push('}');
  });
  // Given a test's number (the runner's "runs": built once, each test in a process of its own), only that test.
  // (Read without a library call, and with names their macros won't have.)
  L.push(`static void (*const tests[])(int) = {${tests.map((_, i) => 't' + i).join(', ') || 'nullptr'}};`, '}  // namespace bq', 'int main(int bq_argc, char** bq_argv) {',
    '    int bq_only = -1;', '    if (bq_argc > 1) { bq_only = 0; for (const char* bq_c = bq_argv[1]; *bq_c; bq_c++) bq_only = bq_only * 10 + (*bq_c - \'0\'); }',
    `    bq_begin(${cStr(marker).lit});`, '    std::remove("bqmain.cpp");', `    for (int i = 0; i < ${tests.length}; i++) {`, '        if (bq_only >= 0 && i != bq_only) continue;', '        std::cout.flush();',
    `        if (!bq_test_begin(i, ${ALARM(q)})) continue;`, '        try {', '            bq::tests[i](i);', '        } catch (const std::exception& e) {', '            bq::fail(i, e);',
    '        } catch (const char* e) {', '            bq::fail(i, std::string("Threw ") + e);', '        } catch (const std::string& e) {', '            bq::fail(i, "Threw " + e);',
    '        } catch (...) {', '            bq::fail(i, "Threw something that isn\'t an exception");', '        }', '        bq_test_end();', '    }', '    return 0;', '}', '');
  return L.join('\n');
}

// C: functions only. The student's file is its own translation unit (bqsol.c), so the ban check reads exactly
// what it uses from the compiled object, and nothing of theirs (macros, names) meets the tests'. The
// question's function is declared first, so a definition that doesn't match it is a compile error in their
// file ("conflicting types"), not a wrong call.
function cSol(q) {
  const L = ['#include "bqpre.h"'];
  if (q.support && q.support.c) L.push(q.support.c);
  L.push(T.cSignature(q.signature) + ';', '#define main bq_student_main', '#include "solution.c"', '');
  return L.join('\n');
}
function cMain(q, tests, marker) {
  const D = q.types;
  const s = q.signature;
  const L = ['#include "bqpre.h"', T.cSignature(s) + ';', '#include "bqc.h"'];
  if (D) {
    const names = Object.keys(D);
    L.push(...names.map((n) => `static void bq_w_${n}(bq_w* w, const ${n}* p);`));
    for (const n of names) {
      const fs = D[n];
      L.push(`static ${n}* bq_new_${n}(${fs.map((f) => `${T.cType(f.type)} ${f.name}`).join(', ') || 'void'}) {`, `    ${n}* p = (${n}*)calloc(1, sizeof(${n}));`,
        ...fs.map((f) => `    p->${f.name} = ${f.name};`), '    return p;', '}');
      L.push(`static void bq_w_${n}(bq_w* w, const ${n}* p) {`, '    if (!p) { bq_w_raw(w, "null"); return; }', '    if (w->d > 400) { bq_w_raw(w, "\\"...\\""); return; }', '    w->d++;');
      fs.forEach((f, k) => L.push(`    bq_w_raw(w, ${JSON.stringify((k ? ',' : '{') + JSON.stringify(f.name) + ':')});`, `    ${cWriter(f.type, D)}(w, p->${f.name});`));
      L.push(`    bq_w_raw(w, "${fs.length ? '}' : '{}'}");`, '    w->d--;', '}');
    }
  }
  const ret = T.canon(s.returns);
  const d = T.cDims(ret);
  tests.forEach((t, i) => {
    L.push(`static void t${i}(int i) {`);
    const args = [];
    s.params.forEach((p, k) => args.push(...cArg(p.type, t.args[k], 'a' + k, D, L)));
    if (d) args.push('&rs');
    if (d === 2) args.push('&rcs');
    if (d) L.push('    int rs = -1;');
    if (d === 2) L.push('    int* rcs = NULL;');
    L.push(`    ${T.cType(ret)} r = ${s.name}(${args.join(', ')});`);
    if (d) L.push('    if (!bq_size(i, r, rs)) return;');
    if (d === 2) L.push('    if (rs > 0 && !rcs) { bq_fail(i, "Set *returnColumnSizes to an array of the rows\' lengths"); return; }');
    L.push('    bq_w w = {0};');
    if (!d) L.push(`    ${cWriter(ret, D)}(&w, r);`);
    else if (d === 1) {
      L.push('    bq_w_raw(&w, "[");', `    for (int k = 0; k < rs; k++) { if (k) bq_w_raw(&w, ","); ${cWriter(elementType(ret), D)}(&w, r[k]); }`, '    bq_w_raw(&w, "]");');
    } else {
      L.push('    bq_w_raw(&w, "[");', '    for (int k = 0; k < rs; k++) {', '        if (k) bq_w_raw(&w, ",");',
        '        if (rcs[k] < 0 || (!r[k] && rcs[k] > 0)) { bq_fail(i, "A row\'s length in *returnColumnSizes doesn\'t fit the row"); return; }',
        '        bq_w_raw(&w, "[");', `        for (int c = 0; c < rcs[k]; c++) { if (c) bq_w_raw(&w, ","); ${cWriter(elementType(elementType(ret)), D)}(&w, r[k][c]); }`,
        '        bq_w_raw(&w, "]");', '    }', '    bq_w_raw(&w, "]");');
    }
    L.push('    bq_ok(i, &w);', '}');
  });
  // Given a test's number (the runner's "runs": built once, each test in a process of its own), only that test.
  L.push(`static void (*const bq_tests[])(int) = {${tests.map((_, i) => 't' + i).join(', ') || '0'}};`, 'int main(int bq_argc, char** bq_argv) {',
    '    int bq_only = -1;', '    if (bq_argc > 1) { bq_only = 0; for (const char* bq_c = bq_argv[1]; *bq_c; bq_c++) bq_only = bq_only * 10 + (*bq_c - \'0\'); }',
    `    bq_begin(${cStr(marker).lit});`, '    remove("bqmain.c");', `    for (int i = 0; i < ${tests.length}; i++) {`, '        if (bq_only >= 0 && i != bq_only) continue;',
    `        if (bq_test_begin(i, ${ALARM(q)})) { bq_tests[i](i); bq_test_end(); }`, '    }', '    return 0;', '}', '');
  return L.join('\n');
}

// Go: the student's file joins the harness's package main (a "package main" is added at the start of their
// first line when they leave it out, so line numbers stay theirs). Each test runs in a child process (bqh.go).
const goPackaged = (code) => (/^\s*package\s+\w+/m.test(code) ? code : 'package main; ' + code);
function goMain(q, tests, marker) {
  const D = q.types;
  const L = ['package main', ''];
  const locals = (params, args, ind) => params.map((p, k) => `${ind}var a${k} ${T.goType(p.type)} = ${goLit(p.type, args[k], D)}`);
  const argNames = (n) => Array.from({ length: n }, (_, k) => 'a' + k).join(', ');
  tests.forEach((t, i) => {
    L.push(`func bqT${i}(i int) {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(...locals(s.params, t.args, '\t'), `\tvar r ${T.goType(s.returns)} = ${s.name}(${argNames(s.params.length)})`, '\tbqOk(i, r)');
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      names.forEach((n) => L.push(`\tvar o_${n} *${C.name}`, `\t_ = o_${n}`));
      t.steps.forEach((st, k) => {
        if (st.new) { L.push('\t{', ...locals(C.constructor, st.new, '\t\t'), `\t\to_${st.as} = New${C.name}(${argNames(C.constructor.length)})`, '\t}'); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${argNames(m.params.length)})`;
        L.push('\t{', ...locals(m.params, st.args, '\t\t'));
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`\t\tvar r ${T.goType(m.returns)} = ${call}`, `\t\tbqStep(i, ${k}, r)`);
        else L.push(`\t\t${call}`);
        L.push('\t}');
      });
      L.push('\tbqDone(i)');
    }
    L.push('}', '');
  });
  L.push('func main() {', `\tbqMain(${JSON.stringify(marker)}, []func(int){${tests.map((_, i) => 'bqT' + i).join(', ')}}, ${ALARM(q)})`, '}', '');
  return L.join('\n');
}

// Rust: the student's file is included in a module of its own (sol), next to the question's classes and the
// tests, so their private methods are reachable and their "use" lines don't clash with ours.
const RS_PRELUDE = 'pub use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet, VecDeque};\npub use std::cell::RefCell;\npub use std::rc::Rc;\n';
function rsMain(q, tests, marker) {
  const D = q.types;
  const L = ['#![allow(warnings)]', 'mod bq;', RS_PRELUDE, 'mod sol {', 'use super::*;', 'pub struct Solution;'];
  if (D) {
    L.push(T.classSource(D, 'rust'));
    for (const [n, fs] of Object.entries(D)) {
      L.push(`impl crate::bq::J for ${n} {`, '    fn j(&self, w: &mut String, d: usize) {', "        w.push('{');");
      fs.forEach((f, k) => L.push(`        w.push_str(${JSON.stringify((k ? ',' : '') + JSON.stringify(f.name) + ':')});`, `        crate::bq::J::j(&self.${f.name}, w, d + 1);`));
      L.push("        w.push('}');", '    }', '}');
    }
  }
  if (q.support && q.support.rust) L.push(q.support.rust);
  L.push('include!("solution.rs");');
  const locals = (params, args, ind) => params.map((p, k) => `${ind}let a${k}: ${T.rustType(p.type)} = ${rsLit(p.type, args[k], D)};`);
  const argNames = (n) => Array.from({ length: n }, (_, k) => 'a' + k).join(', ');
  // The test functions' names carry the run's marker, so the ban check (bans.js) can tell them from anything
  // in the student's file.
  const tn = (i) => `bq_${marker}_t${i}`;
  tests.forEach((t, i) => {
    L.push(`pub fn ${tn(i)}(i: usize) {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(...locals(s.params, t.args, '    '), `    let r: ${T.rustType(s.returns)} = Solution::${s.name}(${argNames(s.params.length)});`, '    crate::bq::ok(i, &r);');
    } else {
      const C = q.class;
      t.steps.forEach((st, k) => {
        if (st.new) { L.push(`    let mut o_${st.as} = {`, ...locals(C.constructor, st.new, '        '), `        ${C.name}::new(${argNames(C.constructor.length)})`, '    };'); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${argNames(m.params.length)})`;
        L.push('    {', ...locals(m.params, st.args, '        '));
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`        let r: ${T.rustType(m.returns)} = ${call};`, `        crate::bq::step(i, ${k}, &r);`);
        else L.push(`        ${call};`);
        L.push('    }');
      });
      L.push('    crate::bq::done(i);');
    }
    L.push('}');
  });
  L.push(`pub fn bq_${marker}_test(i: usize) {`, '    match i {', ...tests.map((_, i) => `        ${i} => ${tn(i)}(i),`), '        _ => {}', '    }', '}', '}', '',
    `fn main() { bq::main(${JSON.stringify(marker)}, ${tests.length}, sol::bq_${marker}_test, ${ALARM(q)}); }`, '');
  return L.join('\n');
}

// C#: BQMain is the entry point (-main:BQMain), so a Main of their own can stay. Tests run in one process; a
// stack overflow, which .NET can't catch, stops the rest (readResults says so). Given a test's number (the
// runner's "runs": built once, each test in a process of its own), only that test.
const CS_USINGS = 'global using System;\nglobal using System.Collections.Generic;\nglobal using System.Linq;\nglobal using System.Text;\n';
function csMain(q, tests, marker) {
  const D = q.types;
  const L = ['public static class BQMain {'];
  const locals = (params, args, ind) => params.map((p, k) => `${ind}${T.csType(p.type)} a${k} = ${csLit(p.type, args[k], D)};`);
  const argNames = (n) => Array.from({ length: n }, (_, k) => 'a' + k).join(', ');
  tests.forEach((t, i) => {
    L.push(`    static void T${i}(int i) {`);
    if (q.mode === 'method') {
      const s = q.signature;
      L.push(...locals(s.params, t.args, '        '), `        ${T.csType(s.returns)} r = new Solution().${s.name}(${argNames(s.params.length)});`, '        BQ.Ok(i, r);');
    } else {
      const C = q.class;
      const names = [...new Set(t.steps.filter((st) => st.new).map((st) => st.as))];
      names.forEach((n) => L.push(`        ${C.name} o_${n} = null;`));
      t.steps.forEach((st, k) => {
        if (st.new) { L.push('        {', ...locals(C.constructor, st.new, '            '), `            o_${st.as} = new ${C.name}(${argNames(C.constructor.length)});`, '        }'); return; }
        const m = stepMethod(C, st);
        const call = `o_${st.on}.${st.call}(${argNames(m.params.length)})`;
        L.push('        {', ...locals(m.params, st.args, '            '));
        if (m.returns !== 'void' && (st.expect !== undefined || st.check)) L.push(`            ${T.csType(m.returns)} r = ${call};`, `            BQ.Step(i, ${k}, r);`);
        else L.push(`            ${call};`);
        L.push('        }');
      });
      L.push('        BQ.Done(i);');
    }
    L.push('    }');
  });
  L.push('    public static void Main(string[] args) {', `        BQ.Begin(${JSON.stringify(marker)});`, '        try { System.IO.File.Delete("bqmain.cs"); } catch { }',
    `        var tests = new System.Action<int>[] { ${tests.map((_, i) => 'T' + i).join(', ')} };`, '        int only = args.Length > 0 ? int.Parse(args[0]) : -1;',
    '        for (int i = 0; i < tests.Length; i++) {', '            if (only >= 0 && i != only) continue;', '            try { tests[i](i); } catch (System.Exception e) { BQ.Fail(i, e); }', '        }', '        System.Console.Out.Flush();', '    }', '}', '');
  return L.join('\n');
}

// An argument as JSON for bqh.args: maps carry their keys' types, and objects of declared classes say which
// class they are ({"__obj__": "Point", "f": [1, 2]}). Lists only get wrapped when they hold objects.
const hasClass = (type, D) => !!D && Object.keys(D).some((n) => new RegExp(`\\b${n}\\b`).test(type));
function pyArg(type, x, D) {
  if (x === null || x === undefined || typeof x !== 'object') return x === undefined ? null : x;
  if (isRange(x) && !T.isClass(type, D) && !T.mapTypes(type)) return x;
  if (T.isClass(type, D)) return { __obj__: type, f: D[type].map((f) => pyArg(f.type, x[f.name], D)) };
  const kv = T.mapTypes(type);
  if (kv) return { __map__: Object.entries(x).map(([k, val]) => [kv[0] === 'int' ? Number(k) : k, pyArg(kv[1], val, D)]) };
  if (Array.isArray(x) && hasClass(type, D)) return { __list__: x.map((y) => pyArg(elementType(type), y, D)) };
  return x;
}

module.exports = { CS_USINGS, cMain, cSol, cppMain, csMain, goMain, goPackaged, javaMain, jsExport, jsMain, pyMain, rsMain };
