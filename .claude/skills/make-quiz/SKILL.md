---
name: make-quiz
description: Write BrowserQuiz quizzes (a quiz.json packed into a .quiz) with multiple choice, select-all, short answer, and code questions (Java, Python, JavaScript, TypeScript, C, C++, C#, Go, Rust) with hidden tests and reference solutions. Use when asked to make, write, generate, convert, fix or check a quiz, test or exam for BrowserQuiz.
---

# Make a BrowserQuiz quiz

The format spec is `docs/quiz-format.md`. Read it first, and look at `examples/ap-csa-unit4/quiz.json`
for a working example of every question type.

## 1. Pin down what's wanted

Use what the user gave you: topic or unit, source material (notes, a worksheet, a PDF),
number of questions and mix of types, time limit, languages, and difficulty.
Fill gaps with these defaults and say which ones you used. Don't stop to ask.
- Match the style, level and language of the topic and notes. If nothing says otherwise, use
  Java. If an AP unit number is given, say which course outline you assumed (AP CSA renumbered
  its units in 2025).
- Topics that aren't about code (networking, math, theory): `"language": "none"` and no code
  questions unless asked.
- Minutes per question: 1 for multiple choice, 2 for select-all, 1–2 for short answer or output,
  3–4 for a trace table, 2–4 for fill in the blanks, 5–15 for code (by difficulty), 5 for a
  written answer
- Points per question: 1 for multiple choice, 2 for select-all, 1 for short answer, 6–9 for code
- "A few" questions means 3–5
- Medium difficulty.
  - Easy: one idea per question, recall or a single direct step, code to trace about 5 lines,
    code questions about 5 minutes.
  - Medium: questions combine two ideas, and wrong choices are real student mistakes. Code
    questions take about 10 minutes.
  - Hard: multi-step reasoning and tricky edge cases, code questions about 15 minutes with more
    hidden tests, and speed tests that require an efficient solution (see "Speed tests" in the
    format spec; say the required big-O in the prompt).
  - Mixed: start easy, end hard.
  - Pitch it at the class, not the best student: someone who studied should get most questions
    right. When unsure, make it easier; only go hard when asked. Nothing needs a trick or an idea the
    notes don't teach.
- Rubric items on code questions grade themselves (`require`/`forbid`) unless the user wants
  to grade them by hand or wants no rubric

## 2. Write it

Keep every question short: long ones overflow the screen on laptops, iPads and phones.
- Prompt: what's asked in 1–3 sentences (about 60 words), plus code if it's about code. No story,
  no setup, no restating the rules.
- Code shown to students: at most about 15 lines, each under about 70 characters, one snippet per
  question.
- Choices: one line, under about 60 characters, about the same length.
- Code questions: one method with an exact signature; the prompt is about 100 words at most and
  doesn't repeat the sample tests in words.
- Explanations one or two sentences, directions one line or none. If a question needs more,
  split it into two.

Create `quizzes/<short-name>/quiz.json`. `quizzes/` is gitignored, because quiz files hold
answer keys. Images go in `quizzes/<short-name>/assets/`.

- **Question types:** single, multi, text, code, plus output (predict what code prints), trace (trace
  table), fill (fill in the blanks) and essay (teacher-graded). Prefer output and trace for
  "what is printed" and tracing questions.
- **Order** questions single → multi → text → output → trace → fill → code → essay. Consecutive questions of one type form a part,
  with its own directions page, and shuffling stays inside parts.
- **Sections:** only when asked for them ("Part A: Arrays, Part B: Strings"), add top-level `sections`,
  each starting at a question id with a title and optional directions.
- **Names:** give each question a short `name` ("BankAccount class", "Trace the sum loop").
  Students see names, types and points before they start, so a name never hints at the answer.
- **Explanations:** give every question an `explanation`, one or two sentences on why the right
  answer is right (for multiple choice, the mistake behind the likeliest wrong choice). Students see it
  after a practice quiz.
- **Prompts** say exactly what's asked, including edge cases ("return 0 for an empty array").
  No flavor text, no hints, nothing that gives away the answer. Put code in backticks or
  fenced blocks.
- **Random values:** only when asked ("different numbers for each student"). Put `"vars"`, 3 to 6
  rows like `{ "x": 7, "y": 2, "out": 1 }`, on a `single`, `multi`, `text`, `output` or `trace`
  question and write `{{x}}` where each value goes, answers included. Work out every row's answer
  yourself and check each one: a wrong row is a wrong answer key for some students.
- **Locked parts:** `"lockParts": true` only when asked that students can't go back to earlier parts.
- **Question pools:** only when asked ("each student gets 2 of these 5"). Give those questions the same
  `"pool"`, set `"pools": { "<name>": 2 }`, and make them worth the same, of one type, next to each
  other and about as hard as each other.
- **Shared material:** when several questions use the same case, passage or code, write it
  once in top-level `shared` and give each question `"shared": "<id>"`. Keep the set's
  questions next to each other.
- **Multiple choice:** one clearly correct answer. Wrong choices come from real mistakes in the
  quiz's language or topic:
  - Java: integer division, off-by-one errors, `==` vs `.equals`, aliasing, short-circuiting,
    precedence
  - Python: mutable default arguments, `is` vs `==`, off-by-one in `range`
  - networking: off-by-one subnet sizes, mixing up layers
  - or the equivalent mistakes for any other language or topic

  Keep choices about the same length, and make sure the right one doesn't stand out: across the quiz
  it's the longest (or most detailed, most hedged) choice no more often than the wrong ones are, and
  its position varies. No "all/none of the above". `answer` counts from 0:
  recount it against the `choices` list.
- **Choices:** one line takes `inline code`, **bold**, *italic* and images. A choice with a
  `\n` in it is full Markdown, so four short code blocks as the choices work. Long code still
  reads better in the prompt as labeled segments (Segment I, II, …) that the choices name. For
  "I only / I and II" style answers, set `"shuffleChoices": false` on that question.
- **More than one image:** `![alt](assets/name.png)` anywhere in the text (no spaces in the file
  name). `image` is still the one big picture under the prompt.
- **Select all:** use only when 2+ choices are correct. Scoring is all or nothing unless the question
  has `"partialCredit": true` (right picks earn, wrong picks take back).
- **Short answer:** use only when there are few ways to say the answer. List every accepted
  form in `answer` (`"O(log n)"`, `"O(logn)"`).
- **Code:**
  - Use only the types in the spec's table: scalars (including `char`), arrays and 2D arrays,
    `list<...>` and `map<string|int, ...>`, plus classes the question declares in `types`
    (`"types": { "Node": { "val": "int", "next": "Node" } }`, objects in tests as
    `{ "val": 1, "next": { "val": 2 } }`). Don't write those classes in the starter or reference:
    they're given. Overloads only work when the languages are only Java, C++ and C#.
  - Other languages than Java and Python have limits (spec, "Languages"): speed tests only in
    Java, Python, JavaScript and TypeScript, no maps or
    class questions in C, ASCII chars in C, C++ and Go, no null strings or arrays in C++ and Rust
    (no null strings in Go). Write a reference in every language the question offers.
    `"languages": "any"` lets students pick any language that can run the question; write
    references in the languages you know best.
  - Bans (a banned method scores 0 on the question): a plain name (`["sort"]`) works for every
    language and covers its relatives there (`sorted`, `toSorted`, `qsort`, `sort_unstable`,
    `OrderBy`). `Class.method` entries are one language's, so with several languages give those
    per language (`{ "java": ["Arrays.sort"], "javascript": ["Math.max"], "rust": ["sort"] }`).
    Other routes to the same answer aren't caught unless listed (`"TreeSet"`, `"PriorityQueue"`,
    `"BinaryHeap"` for sorting). For a point off instead of a zero, use a rubric `forbid` regex.
  - Write 2 simple `sample` tests that students can run, and 5–10 `hidden` tests. Only hidden
    tests are graded, so repeat the sample cases in `hidden` too. Cover:
    - empty input
    - a single element
    - negatives
    - duplicates
    - boundaries
    - a larger case

    Give the tests that matter most `"weight": 2`.
  - Always write a `reference` solution in every allowed language. Write `expected` for
    samples. Hidden tests can omit it, and the reference fills it in on upload.
  - Use `rubric` only for what tests can't check, like private fields or recursion.
    Keep it to 1–2 points. Add a `require`/`forbid` regex when a pattern can decide the
    item, so it grades itself (see "Rubric checks" in the format spec). Keep the patterns
    simple, and check them against the reference: the checker refuses ones it fails.
  - For `list`/array answers where order doesn't matter, set `"compare": "unordered"`.
- **Fair to students:** they lose points for not knowing the material, never for guessing what
  was meant.
  - Only the language features and library methods the notes cover. With no notes, stick to what
    an intro course in that language teaches (for AP CSA, the Java Quick Reference). No trivia,
    trick questions, misleading names or planted typos. "NOT" questions say **NOT** in bold.
  - Every hidden test checks something the prompt says (empty input, negatives, ties); a speed
    test means the prompt names the speed needed.
  - All code is clean, the way students should write it (prompts, choices, starters, references):
    the language's usual formatting and naming, clear names, braces on every `if` and loop in Java
    and the C family, no unused variables, dead code or clever one-liners. References are the simple,
    expected solution. Code students read compiles; output questions print a few short lines.
  - Short answers and blanks accept every reasonable form. Trace tables: about 8 rows, starting
    values given. Select-all with 3+ correct choices gets `"partialCredit": true`.
  - Points match the work, and the time limit is about 20% more than the questions need.

## 3. Check it, and fix until it's clean

```bash
node scripts/check-quiz.mjs quizzes/<short-name> --run
```

This runs the server's validation, warns about likely typos in keys, and runs every reference
solution against every test. Fix every error and warning, then run it again, until it ends
with `VALID`. If there's no JDK (or no gcc/g++, go or rustc; C# always), those references get skipped and are
checked on upload instead; say so. Bans in C, C++, Go, C# and Rust are also only checked on upload.

## 4. Pack it

```bash
node scripts/pack-quiz.mjs quizzes/<short-name> quizzes/<short-name>.quiz
```

Report:
- the `.quiz` path
- number of questions and total points
- the time limit
- the defaults you picked, including shuffling
- anything you couldn't verify

`VALID` means the server accepts the quiz and the references pass. It doesn't show what the
quiz looks like: tell the teacher to open it with Preview on the dashboard before using it.

The teacher uploads it on the dashboard under Quizzes.
