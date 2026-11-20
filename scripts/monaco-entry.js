// Monaco core + editor features, plus only the languages the course uses.
// Bundled and served from our own origin (no CDN), per the design doc.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';

self.monaco = monaco;
