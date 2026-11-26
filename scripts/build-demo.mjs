// Builds the standalone demo: the real student app + an in-browser fake server + the teacher view.
//   demo/dist/index.html  page body only (the Artifact host adds doctype/head/body)
//   demo/dist/local.html  same page as a full HTML document, for local testing
//   demo/dist/vendor/monaco/*  the bundled editor, served next to the page
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

if (!existsSync('public/vendor/monaco/monaco.js')) {
  console.error('Run `npm run build:monaco` first.');
  process.exit(1);
}

const css = [read('public/student/app.css'), read('demo/demo.css')].join('\n');
const scripts = [
  "window.BQ_CONFIG = { demo: true, monacoBase: 'vendor/monaco/' };",
  read('public/student/mathexpr.js'),
  read('public/student/graph.js'),
  read('public/student/md.js'),
  read('public/student/monitor.js'),
  read('demo/mock-server.js'),
  read('public/student/app.js'),
  read('demo/teacher-panel.js'),
  "BQ.app.start(document.getElementById('bq-app'), BQ.api);\nBQ.teacherPanel.mount(document.getElementById('bq-teacher'));",
];

const fonts = ''; // system fonts only

const body = `<div class="demo">
  <div class="demo-student"><div id="bq-app" class="bq-app"></div></div>
  <div class="demo-teacher" id="bq-teacher"></div>
</div>
${scripts.map((js) => `<script>\n${safeScript(js)}\n</script>`).join('\n')}`;

const page = `<title>BrowserQuiz Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
`;

const local = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>BrowserQuiz Demo</title>
${fonts}
<style>
body { margin: 0; }
[hidden] { display: none !important; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync('demo/dist', { recursive: true });
writeFileSync('demo/dist/index.html', page);
writeFileSync('demo/dist/local.html', local);
cpSync('public/vendor/monaco', 'demo/dist/vendor/monaco', { recursive: true });
// Hosts that only allow fonts from a font CDN still accept data: URIs, so embed the icon font.
const font = readFileSync('public/vendor/monaco/codicon.ttf').toString('base64');
const monacoCss = read('public/vendor/monaco/monaco.css').replace(/url\(["']?\.?\/?codicon\.ttf["']?\)/g, `url("data:font/ttf;base64,${font}")`);
writeFileSync('demo/dist/vendor/monaco/monaco.css', monacoCss);
console.log('demo built -> demo/dist (index.html %s KB)', Math.round(page.length / 1024));
