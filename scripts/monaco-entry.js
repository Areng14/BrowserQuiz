// Monaco core + editor features, plus only the languages the course uses.
// Bundled and served from our own origin (no CDN), per the design doc.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import { conf as javaConf, language as javaLang } from 'monaco-editor/esm/vs/basic-languages/java/java.js';
import { conf as pyConf, language as pyLang } from 'monaco-editor/esm/vs/basic-languages/python/python.js';

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
for (const [id, ext, conf, lang] of [['java', '.java', javaConf, javaLang], ['python', '.py', pyConf, pyLang]]) {
  monaco.languages.register({ id, extensions: [ext] });
  monaco.languages.setLanguageConfiguration(id, conf);
  monaco.languages.setMonarchTokensProvider(id, richer(lang));
}

self.monaco = monaco;
