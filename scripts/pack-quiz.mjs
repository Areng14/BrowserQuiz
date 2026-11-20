// Packs a quiz folder (quiz.json + assets/) into a .quiz file.
//   node scripts/pack-quiz.mjs examples/ap-csa-unit4 [out.quiz]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const require = createRequire(import.meta.url);
const { writeZip } = require('../server/src/zip.js');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/pack-quiz.mjs <folder> [out.quiz]'); process.exit(1); }
const out = process.argv[3] || basename(dir.replace(/\/$/, '')) + '.quiz';
const entries = [];
const walk = (d) => {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!name.startsWith('.')) entries.push({ name: relative(dir, p).split('\\').join('/'), data: readFileSync(p) });
  }
};
walk(dir);
if (!entries.some((e) => e.name === 'quiz.json')) { console.error('No quiz.json in ' + dir); process.exit(1); }
writeFileSync(out, writeZip(entries));
console.log(`wrote ${out} (${entries.length} files)`);
