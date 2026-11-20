// Quiz maker: build or edit a quiz in the dashboard. Saves the same quiz.json an uploaded .quiz has.
// Code questions use short text formats instead of piles of fields:
//   signature  countVowels(s: string): int
//   method test  ("hello") -> 2        class test  a = new BankAccount("Ava", 100.0) / a.getBalance() -> 100.0
(function () {
  'use strict';
  const TYPES = { single: 'Multiple choice', multi: 'Select all that apply', text: 'Short answer', code: 'Code' };
  const VALUE_TYPES = ['int', 'long', 'double', 'boolean', 'string', 'int[]', 'long[]', 'double[]', 'boolean[]', 'string[]', 'int[][]', 'list<int>', 'list<string>'];
  const LANGS = { java: 'Java', python: 'Python' };

  // ---------- text formats ----------
  const fmt = (v) => JSON.stringify(v);
  // Python spellings outside strings become JSON ones, so True/False/None work too.
  function jsonish(src) {
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        out += c;
        if (c === '\\') { out += src[++i] || ''; } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      const word = /^(True|False|None)\b/.exec(src.slice(i));
      if (word && !/\w/.test(src[i - 1] || '')) {
        out += { True: 'true', False: 'false', None: 'null' }[word[1]];
        i += word[1].length - 1;
        continue;
      }
      out += c;
    }
    return out;
  }
  function parseValues(inner) {
    try { return JSON.parse('[' + jsonish(inner) + ']'); } catch (e) {
      throw new Error(`can't read (${inner}). Write values like "text", 3, 2.5, true, [1, 2]`);
    }
  }
  function parseValue(src) {
    try { return JSON.parse(jsonish(src)); } catch (e) {
      throw new Error(`can't read ${src}. Write values like "text", 3, 2.5, true, [1, 2]`);
    }
  }
  // "head(inner) rest": finds the ")" that closes the first "(", skipping strings and brackets.
  function splitCall(line) {
    const open = line.indexOf('(');
    if (open < 0) throw new Error('needs (…)');
    let depth = 0;
    let inStr = false;
    for (let i = open; i < line.length; i++) {
      const c = line[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') {
        depth--;
        if (depth === 0) {
          if (c !== ')') break;
          return { head: line.slice(0, open).trim(), inner: line.slice(open + 1, i), rest: line.slice(i + 1).trim() };
        }
      }
    }
    throw new Error('the ( … ) doesn\'t close');
  }
  // "-> value" and "*2" after a call.
  function parseRest(rest) {
    const out = { weight: 1 };
    const w = /\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(rest);
    if (w) { out.weight = Number(w[1]); rest = rest.slice(0, w.index).trim(); }
    if (!rest) return out;
    if (!rest.startsWith('->')) throw new Error('after the call, write -> and the expected value');
    const v = rest.slice(2).trim();
    if (v === '?') out.check = true;
    else out.expected = parseValue(v);
    return out;
  }

  function parseSig(text, what) {
    const m = /^\s*([A-Za-z_]\w*)?\s*\(([^)]*)\)\s*(?::\s*(\S.*?))?\s*$/.exec(text || '');
    if (!m) throw new Error(`${what}: write it like countVowels(s: string): int`);
    const params = m[2].trim() ? m[2].split(',').map((p) => {
      const pm = /^\s*([A-Za-z_]\w*)\s*:\s*(\S+)\s*$/.exec(p);
      if (!pm) throw new Error(`${what}: "${p.trim()}" should be name: type`);
      if (!VALUE_TYPES.includes(pm[2])) throw new Error(`${what}: ${pm[2]} isn't a type (use ${VALUE_TYPES.join(', ')})`);
      return { name: pm[1], type: pm[2] };
    }) : [];
    return { name: m[1] || '', params, returns: m[3] || '' };
  }
  const sigText = (name, params, returns) => `${name || ''}(${(params || []).map((p) => `${p.name}: ${p.type}`).join(', ')})${returns ? `: ${returns}` : ''}`;

  function methodTestsText(tests) {
    return (tests || []).map((t) => `(${t.args.map(fmt).join(', ')})${t.expected !== undefined ? ' -> ' + fmt(t.expected) : ''}${t.weight && t.weight !== 1 ? ' *' + t.weight : ''}`).join('\n');
  }
  function parseMethodTests(text, kind) {
    return text.split('\n').map((l, i) => [l.trim(), i]).filter(([l]) => l).map(([line, i]) => {
      try {
        const c = splitCall(line);
        const t = { args: parseValues(c.inner) };
        const r = parseRest(c.rest);
        if (r.expected !== undefined) t.expected = r.expected;
        if (r.weight !== 1) t.weight = r.weight;
        return t;
      } catch (e) { throw new Error(`${kind} tests, line ${i + 1}: ${e.message}`); }
    });
  }
  function classTestsText(tests, className) {
    return (tests || []).map((t) => {
      const objs = new Set(t.steps.filter((s) => s.new).map((s) => s.as));
      const many = objs.size > 1 || [...objs].some((o) => o !== 'a');
      const lines = t.steps.map((s) => {
        if (s.new) return `${many ? s.as + ' = ' : ''}new ${className}(${s.new.map(fmt).join(', ')})`;
        return `${many ? s.on + '.' : ''}${s.call}(${(s.args || []).map(fmt).join(', ')})${s.expect !== undefined ? ' -> ' + fmt(s.expect) : s.check ? ' -> ?' : ''}`;
      });
      if (t.weight && t.weight !== 1) lines.push('*' + t.weight);
      return lines.join('\n');
    }).join('\n\n');
  }
  function parseClassTests(text, kind) {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((block, bi) => {
      const t = { steps: [] };
      block.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
        const where = `${kind} test ${bi + 1}, "${line}"`;
        try {
          const w = /^\*\s*(\d+(?:\.\d+)?)$/.exec(line);
          if (w) { t.weight = Number(w[1]); return; }
          const nw = /^(?:([A-Za-z_]\w*)\s*=\s*)?new\s+[A-Za-z_]\w*\s*\(/.exec(line);
          const c = splitCall(line);
          if (nw) {
            const step = { new: parseValues(c.inner) };
            if (nw[1]) step.as = nw[1];
            t.steps.push(step);
            return;
          }
          const hm = /^(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)$/.exec(c.head);
          if (!hm) throw new Error('write a method call like getBalance() or a.getBalance()');
          const step = { call: hm[2], args: parseValues(c.inner) };
          if (hm[1]) step.on = hm[1];
          const r = parseRest(c.rest);
          if (r.check) step.check = true;
          else if (r.expected !== undefined) step.expect = r.expected;
          t.steps.push(step);
        } catch (e) { throw new Error(`${where}: ${e.message}`); }
      });
      return t;
    });
  }

  // ---------- question defaults ----------
  function blank(type, keep) {
    const q = { id: keep.id, type, prompt: keep.prompt || '', points: keep.points || (type === 'code' ? 6 : type === 'multi' ? 2 : 1) };
    if (type === 'single') Object.assign(q, { choices: ['', ''], answer: 0 });
    if (type === 'multi') Object.assign(q, { choices: ['', '', ''], answer: [] });
    if (type === 'text') q.answer = [''];
    if (type === 'code') {
      Object.assign(q, { mode: 'method', languages: ['java'], signature: { name: 'solve', params: [], returns: 'int' }, tests: { sample: [], hidden: [] }, reference: {} });
    }
    return withUi(q);
  }
  // Text-format fields live in q._ui while editing and are parsed back on save.
  function withUi(q) {
    if (q.type !== 'code') return q;
    const C = q.class || { name: '', constructor: [], methods: [] };
    q._ui = {
      sig: q.signature ? sigText(q.signature.name, q.signature.params, q.signature.returns) : 'solve(): int',
      className: C.name,
      ctor: sigText('', C.constructor, ''),
      methods: (C.methods || []).map((m) => sigText(m.name, m.params, m.returns)).join('\n'),
      sample: q.mode === 'class' ? classTestsText(q.tests.sample, C.name) : methodTestsText(q.tests.sample),
      hidden: q.mode === 'class' ? classTestsText(q.tests.hidden, C.name) : methodTestsText(q.tests.hidden),
    };
    return q;
  }

  // Build quiz.json from the editor, or throw with every problem found.
  function collect(quiz) {
    const problems = [];
    const out = Object.assign({}, quiz, { questions: [] });
    quiz.questions.forEach((q, i) => {
      const label = `Question ${i + 1}`;
      const o = Object.assign({}, q);
      delete o._ui;
      try {
        if (q.type === 'text') o.answer = q.answer.map((a) => a.trim()).filter(Boolean);
        if (q.type === 'single' || q.type === 'multi') o.choices = q.choices.map((c) => c.trim());
        if (q.type === 'code') {
          const u = q._ui;
          if (q.mode === 'class') {
            delete o.signature;
            o.class = {
              name: u.className.trim(),
              constructor: parseSig(u.ctor.trim() ? u.ctor : '()', 'constructor').params,
              methods: u.methods.split('\n').filter((l) => l.trim()).map((l) => {
                const m = parseSig(l, 'methods');
                if (!m.name || !m.returns) throw new Error(`methods: write each like deposit(amount: double): void`);
                return { name: m.name, params: m.params, returns: m.returns };
              }),
            };
            o.tests = { sample: parseClassTests(u.sample, 'sample'), hidden: parseClassTests(u.hidden, 'hidden') };
          } else {
            delete o.class;
            const sig = parseSig(u.sig, 'signature');
            if (!sig.name || !sig.returns) throw new Error('signature: write it like countVowels(s: string): int');
            o.signature = sig;
            o.tests = { sample: parseMethodTests(u.sample, 'sample'), hidden: parseMethodTests(u.hidden, 'hidden') };
          }
          o.reference = Object.fromEntries(Object.entries(q.reference || {}).filter(([l, v]) => q.languages.includes(l) && v.trim()));
          o.rubric = (q.rubric || []).filter((r) => r.text.trim()).map((r, k) => ({ id: r.id || `r${k + 1}`, text: r.text.trim(), points: Number(r.points) || 0 }));
        }
      } catch (e) { problems.push(`${label}: ${e.message}`); }
      out.questions.push(o);
    });
    if (problems.length) throw new Error(problems.join('\n'));
    return out;
  }

  // ---------- the editor ----------
  async function showQuizEditor(id) {
    const { h, api, post, mount, bar, showHome } = window.BQT;
    let quiz;
    let currentId = id;
    if (id) {
      try { quiz = (await api(`/api/t/quizzes/${encodeURIComponent(id)}/source`)).quiz; } catch (e) { return; }
      quiz.questions.forEach(withUi);
    } else {
      quiz = { format: 1, title: '', timeLimitMin: 20, language: 'java', shuffleQuestions: true, shuffleChoices: true, integrity: { graceStrikes: 0 }, questions: [] };
    }
    let dirty = false;
    const touch = () => { dirty = true; status.textContent = ''; };
    const msg = h('pre', { class: 't-error t-problems', role: 'alert' });
    const status = h('span', { class: 't-muted t-small', role: 'status' });
    const list = h('div', { class: 'qe-list' });
    const nextId = () => { let n = quiz.questions.length + 1; while (quiz.questions.some((q) => q.id === `q${n}`)) n++; return `q${n}`; };

    const input = (value, on, attrs) => {
      const el = h('input', Object.assign({ class: 'input', value: value == null ? '' : String(value) }, attrs || {}));
      el.addEventListener('input', () => { on(el.value); touch(); });
      return el;
    };
    const area = (value, on, attrs) => {
      const el = h('textarea', Object.assign({ class: 'input t-textarea', spellcheck: 'false' }, attrs || {}));
      el.value = value || '';
      el.addEventListener('input', () => { on(el.value); touch(); });
      return el;
    };
    const codeArea = (value, on, attrs) => {
      const el = area(value, on, Object.assign({ rows: 10 }, attrs || {}));
      el.classList.add('qe-code');
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.shiftKey) return;
        e.preventDefault();
        el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end');
        on(el.value);
        touch();
      });
      return el;
    };
    const check = (checked, label, on) => {
      const cb = h('input', { type: 'checkbox', checked: !!checked });
      cb.addEventListener('change', () => { on(cb.checked); touch(); });
      return h('label', { class: 't-check' }, cb, h('span', { text: label }));
    };
    const field = (label, el) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);

    function choicesEditor(q) {
      const multi = q.type === 'multi';
      const rows = q.choices.map((c, k) => {
        const mark = h('input', { type: multi ? 'checkbox' : 'radio', name: `ans-${q.id}`, checked: multi ? q.answer.includes(k) : q.answer === k, 'aria-label': 'Correct' });
        mark.addEventListener('change', () => {
          if (multi) q.answer = mark.checked ? [...new Set([...q.answer, k])] : q.answer.filter((x) => x !== k);
          else q.answer = k;
          touch();
        });
        const del = h('button', { class: 'btn small', type: 'button', text: '✕', 'aria-label': 'Remove choice', disabled: q.choices.length <= 2 });
        del.addEventListener('click', () => {
          q.choices.splice(k, 1);
          if (multi) q.answer = q.answer.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x));
          else if (q.answer >= q.choices.length || q.answer === k) q.answer = 0; else if (q.answer > k) q.answer--;
          touch();
          render();
        });
        return h('div', { class: 'qe-choice' }, mark, input(c, (v) => { q.choices[k] = v; }, { placeholder: `Choice ${k + 1}` }), del);
      });
      const add = h('button', { class: 'btn small', type: 'button', text: 'Add choice', disabled: q.choices.length >= 8 });
      add.addEventListener('click', () => { q.choices.push(''); touch(); render(); });
      return [h('div', { class: 'qe-choices' }, rows), h('div', { class: 't-row' }, add,
        check(q.shuffleChoices === false, 'Keep choices in this order', (v) => { if (v) q.shuffleChoices = false; else delete q.shuffleChoices; }))];
    }

    function codeEditor(q) {
      const u = q._ui;
      const langs = h('div', { class: 't-row qe-inline' }, Object.entries(LANGS).map(([l, name]) => check(q.languages.includes(l), name, (v) => {
        q.languages = Object.keys(LANGS).filter((x) => (x === l ? v : q.languages.includes(x)));
        if (!q.languages.length) q.languages = [l === 'java' ? 'python' : 'java'];
        render();
      })));
      const mode = h('select', { class: 'input qe-narrow' },
        h('option', { value: 'method', text: 'Write a method', selected: q.mode !== 'class' }),
        h('option', { value: 'class', text: 'Write a class', selected: q.mode === 'class' }));
      mode.addEventListener('change', () => {
        q.mode = mode.value;
        u.sample = '';
        u.hidden = '';
        touch();
        render();
      });
      const isClass = q.mode === 'class';
      const testHint = isClass
        ? 'Tests are separated by a blank line. -> ? takes the value from the reference solution. *2 counts double.'
        : 'One test per line. Leave out -> to take the value from the reference solution. *2 counts double.';
      const parts = [
        h('div', { class: 't-row qe-inline' }, langs, mode),
        isClass
          ? h('div', { class: 't-row' },
            field('Class name', input(u.className, (v) => { u.className = v; }, { placeholder: 'BankAccount' })),
            field('Constructor', input(u.ctor, (v) => { u.ctor = v; }, { placeholder: '(owner: string, balance: double)', class: 'input qe-mono' })))
          : field('Signature', input(u.sig, (v) => { u.sig = v; }, { placeholder: 'countVowels(s: string): int', class: 'input qe-mono' })),
        isClass ? field('Methods, one per line', area(u.methods, (v) => { u.methods = v; }, { rows: 4, placeholder: 'deposit(amount: double): void\ngetBalance(): double' })) : null,
        h('p', { class: 't-muted t-small', text: `Types: ${VALUE_TYPES.join(', ')}${isClass ? ', void' : ''}` }),
        field('Sample tests (students can run these)', area(u.sample, (v) => { u.sample = v; }, {
          rows: 3, placeholder: isClass ? 'new BankAccount("Ava", 100.0)\ndeposit(50.0)\ngetBalance() -> 150.0' : '("hello") -> 2',
        })),
        field('Hidden tests (used for grading)', area(u.hidden, (v) => { u.hidden = v; }, {
          rows: 6, placeholder: isClass ? 'a = new BankAccount("Jo", 20.0)\na.withdraw(50.0) -> false\na.getBalance() -> ?\n*2' : '("AEIOU") -> 5\n("rhythm") -> 0\n("Programming is fun") *2',
        })),
        h('p', { class: 't-muted t-small', text: testHint }),
        q.languages.map((l) => field(`Reference solution (${LANGS[l]})`, codeArea((q.reference || {})[l], (v) => { q.reference = Object.assign({}, q.reference, { [l]: v }); }))),
      ];
      // Rubric: points the teacher gives by hand.
      q.rubric = q.rubric || [];
      const rub = q.rubric.map((r, k) => h('div', { class: 'qe-choice' },
        input(r.text, (v) => { r.text = v; }, { placeholder: 'Uses private instance variables' }),
        input(r.points, (v) => { r.points = v; }, { type: 'number', min: '0', step: '0.5', class: 'input t-points', 'aria-label': 'Points' }),
        h('button', { class: 'btn small', type: 'button', text: '✕', 'aria-label': 'Remove rubric item', onclick: () => { q.rubric.splice(k, 1); touch(); render(); } })));
      parts.push(h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Rubric (points you give by hand)' }), rub,
        h('div', {}, h('button', { class: 'btn small', type: 'button', text: 'Add rubric item', onclick: () => { q.rubric.push({ text: '', points: 1 }); touch(); render(); } }))));
      parts.push(h('div', { class: 't-row qe-inline' },
        check(q.compare === 'unordered', 'Array/list results can be in any order', (v) => { if (v) q.compare = 'unordered'; else delete q.compare; }),
        isClass ? check(q.starter === 'empty', 'Start with an empty class', (v) => { if (v) q.starter = 'empty'; else delete q.starter; }) : null));
      return parts;
    }

    function questionCard(q, i) {
      const type = h('select', { class: 'input qe-narrow', 'aria-label': 'Type' }, Object.entries(TYPES).map(([v, t]) => h('option', { value: v, text: t, selected: q.type === v })));
      type.addEventListener('change', () => { quiz.questions[i] = blank(type.value, q); touch(); render(); });
      const move = (d) => { const j = i + d; [quiz.questions[i], quiz.questions[j]] = [quiz.questions[j], quiz.questions[i]]; touch(); render(); };
      const head = h('div', { class: 'qe-head' },
        h('b', { class: 'qe-n', text: String(i + 1) }), type,
        h('label', { class: 'qe-pts' }, 'Points ', input(q.points, (v) => { q.points = Number(v); }, { type: 'number', min: '0.5', step: '0.5', class: 'input t-points' })),
        h('span', { class: 'qe-grow' }),
        h('button', { class: 'btn small', type: 'button', text: '↑', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }),
        h('button', { class: 'btn small', type: 'button', text: '↓', 'aria-label': 'Move down', disabled: i === quiz.questions.length - 1, onclick: () => move(1) }),
        h('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => { quiz.questions.splice(i, 1); touch(); render(); } }));
      const body = [field('Prompt', area(q.prompt, (v) => { q.prompt = v; }, { rows: 3, placeholder: 'Use `code`, **bold**, and ```java blocks for longer code' }))];
      if (q.image) body.push(h('p', { class: 't-muted t-small', text: `Image: ${q.image}` }));
      if (q.type === 'single' || q.type === 'multi') body.push(...choicesEditor(q));
      if (q.type === 'text') {
        body.push(field('Accepted answers, one per line', area(q.answer.join('\n'), (v) => { q.answer = v.split('\n'); }, { rows: 3 })),
          check(q.caseSensitive, 'Capital letters count', (v) => { if (v) q.caseSensitive = true; else delete q.caseSensitive; }));
      }
      if (q.type === 'code') body.push(...codeEditor(q));
      return h('section', { class: 'qe-card' }, head, body);
    }

    function render() {
      list.replaceChildren(...quiz.questions.map(questionCard));
    }

    async function save() {
      msg.textContent = '';
      let out;
      try { out = collect(quiz); } catch (e) { msg.textContent = e.message; return null; }
      if (!out.questions.length) { msg.textContent = 'Add a question first.'; return null; }
      saveBtn.disabled = true;
      status.textContent = 'Checking…';
      try {
        const r = await post('/api/t/quizzes/json', { quiz: out, replaces: currentId });
        currentId = r.id;
        dirty = false;
        status.textContent = 'Saved';
        return r.id;
      } catch (e) {
        msg.textContent = e.message;
        status.textContent = '';
        return null;
      } finally { saveBtn.disabled = false; }
    }
    const saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: () => save() });
    const previewBtn = h('button', { class: 'btn', type: 'button', text: 'Preview' });
    previewBtn.addEventListener('click', async () => {
      const w = window.open('about:blank', '_blank'); // open now: after the save, a popup blocker would stop it
      const saved = dirty || !currentId ? await save() : currentId;
      if (saved && w) w.location = `/teacher/preview.html?quiz=${encodeURIComponent(saved)}`;
      else if (w) w.close();
    });
    const leave = () => { if (!dirty || confirm('Leave without saving?')) showHome(); };

    const addRow = h('div', { class: 't-row' }, Object.entries(TYPES).map(([t, name]) => h('button', {
      class: 'btn small', type: 'button', text: `Add ${name.toLowerCase()}`,
      onclick: () => { quiz.questions.push(blank(t, { id: nextId() })); touch(); render(); list.lastElementChild.scrollIntoView({ block: 'center' }); },
    })));
    const langSel = h('select', { class: 'input' }, Object.entries(LANGS).map(([v, t]) => h('option', { value: v, text: t, selected: quiz.language === v })));
    langSel.addEventListener('change', () => { quiz.language = langSel.value; touch(); });
    const settings = h('div', { class: 't-row' },
      field('Title', input(quiz.title, (v) => { quiz.title = v; }, { placeholder: 'Unit 4 check' })),
      field('Time limit (minutes, 0 = none)', input(quiz.timeLimitMin, (v) => { quiz.timeLimitMin = Number(v) || 0; }, { type: 'number', min: '0', max: '600' })),
      field('Code in prompts is', langSel),
      field('Window exits allowed before invalidating', input((quiz.integrity || {}).graceStrikes || 0, (v) => { quiz.integrity = { graceStrikes: Number(v) || 0 }; }, { type: 'number', min: '0', max: '10' })));
    const toggles = h('div', { class: 't-row qe-inline' },
      check(quiz.shuffleQuestions !== false, 'Shuffle question order', (v) => { quiz.shuffleQuestions = v; }),
      check(quiz.shuffleChoices !== false, 'Shuffle choices', (v) => { quiz.shuffleChoices = v; }));

    mount(bar(h('button', { class: 't-link', type: 'button', text: '← All quizzes', onclick: leave })),
      h('main', { class: 't-main' },
        h('section', { class: 't-section' }, h('h1', { text: id ? 'Edit quiz' : 'New quiz' }), settings, toggles),
        list,
        addRow,
        h('div', { class: 'qe-save' }, saveBtn, previewBtn, status),
        msg));
    render();
  }

  window.BQT.showQuizEditor = showQuizEditor;
})();
