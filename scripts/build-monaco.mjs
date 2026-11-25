// Bundles Monaco into public/vendor/monaco: monaco.js, monaco.css, codicon.ttf, editor.worker.js.
// Also copies KaTeX (math in prompts) into public/vendor/katex: the script, the CSS and its woff2 fonts.
import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';

const outdir = 'public/vendor/monaco';
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: { monaco: 'scripts/monaco-entry.js' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outdir,
  loader: { '.ttf': 'file' },
  assetNames: '[name]',
  legalComments: 'none',
  logLevel: 'warning',
});

await esbuild.build({
  entryPoints: { 'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outdir,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('monaco bundled ->', outdir);

const katexDir = 'public/vendor/katex';
mkdirSync(katexDir + '/fonts', { recursive: true });
for (const f of ['katex.min.js', 'katex.min.css']) copyFileSync('node_modules/katex/dist/' + f, `${katexDir}/${f}`);
for (const f of readdirSync('node_modules/katex/dist/fonts').filter((x) => x.endsWith('.woff2'))) {
  copyFileSync('node_modules/katex/dist/fonts/' + f, `${katexDir}/fonts/${f}`);
}
console.log('katex copied ->', katexDir);

// The calculator: its engine (scripts/calc, from AlgebraLoop) with mathjs' parser, as window.BQCalc,
// and MathLive (the maths input) with its fonts. Both load only when a quiz has a calculator.
await esbuild.build({
  entryPoints: { calc: 'scripts/calc-entry.js' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outdir: 'public/vendor/calc',
  legalComments: 'none',
  logLevel: 'warning',
});
const mathliveDir = 'public/vendor/mathlive';
mkdirSync(mathliveDir + '/fonts', { recursive: true });
copyFileSync('node_modules/mathlive/mathlive.min.js', `${mathliveDir}/mathlive.min.js`);
copyFileSync('node_modules/mathlive/LICENSE.txt', `${mathliveDir}/LICENSE.txt`);
for (const f of readdirSync('node_modules/mathlive/fonts').filter((x) => x.endsWith('.woff2'))) {
  copyFileSync('node_modules/mathlive/fonts/' + f, `${mathliveDir}/fonts/${f}`);
}
console.log('calculator bundled -> public/vendor/calc, mathlive copied ->', mathliveDir);
