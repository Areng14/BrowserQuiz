// Monaco core + editor features, plus only the languages the course uses.
// Bundled and served from our own origin (no CDN), per the design doc.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import { conf as javaConf, language as javaLang } from 'monaco-editor/esm/vs/basic-languages/java/java.js';
import { conf as pyConf, language as pyLang } from 'monaco-editor/esm/vs/basic-languages/python/python.js';
import { conf as jsConf, language as jsLang } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
import { conf as tsConf, language as tsLang } from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';
import { conf as cppConf, language as cppLang } from 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js';
import { conf as goConf, language as goLang } from 'monaco-editor/esm/vs/basic-languages/go/go.js';
import { conf as rustConf, language as rustLang } from 'monaco-editor/esm/vs/basic-languages/rust/rust.js';
import { conf as csConf, language as csLang } from 'monaco-editor/esm/vs/basic-languages/csharp/csharp.js';

// Monaco's basic grammars color keywords, strings and numbers but leave every name plain. Split names
// into types (Capitalized), calls (followed by "(") and variables, so code reads like it does in VS Code.
function richer(lang) {
  const root = lang.tokenizer.root.slice();
  const i = root.findIndex((r) => Array.isArray(r) && r[1] && r[1].cases && r[1].cases['@default'] === 'identifier');
  if (i < 0) return lang;
  const [re, action] = root[i];
  const kw = action.cases['@keywords'];
  root.splice(i, 1,
    [new RegExp(re.source + '(?=\\s*\\()'), { cases: { '@keywords': kw, '[A-Z][\\w$]*': 'type.identifier', '@default': 'function' } }],
    [re, { cases: { '@keywords': kw, '[A-Z][\\w$]*': 'type.identifier', '@default': 'identifier' } }]);
  return { ...lang, tokenizer: { ...lang.tokenizer, root } };
}
// Coloring only (Monaco's basic grammars): no language service, so no type hints or completions on an exam.
const LANGS = [['java', '.java', javaConf, javaLang], ['python', '.py', pyConf, pyLang], ['javascript', '.js', jsConf, jsLang],
  ['typescript', '.ts', tsConf, tsLang], ['c', '.c', cppConf, cppLang], ['cpp', '.cpp', cppConf, cppLang], ['go', '.go', goConf, goLang], ['rust', '.rs', rustConf, rustLang],
  ['csharp', '.cs', csConf, csLang]];
for (const [id, ext, conf, lang] of LANGS) {
  monaco.languages.register({ id, extensions: [ext] });
  monaco.languages.setLanguageConfiguration(id, conf);
  monaco.languages.setMonarchTokensProvider(id, richer(lang));
}

self.monaco = monaco;
