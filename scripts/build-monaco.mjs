// Bundles Monaco into public/vendor/monaco: monaco.js, monaco.css, codicon.ttf, editor.worker.js
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

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
