---
name: make-quiz
description: Write BrowserQuiz quizzes (a quiz.json packed into a .quiz) with multiple choice, select-all, short answer, and Java/Python code questions with hidden tests and reference solutions. Use when asked to make, write, generate, convert, fix or check a quiz, test or exam for BrowserQuiz.
---

# Make a BrowserQuiz quiz

The format spec is `docs/quiz-format.md`. Read it first, and look at `examples/ap-csa-unit4/quiz.json`
for a working example of every question type.

## 1. Pin down what's wanted

Use what the user gave you: topic or unit, source material (notes, a worksheet, a PDF),
number of questions and mix of types, time limit, languages, and difficulty.
Fill gaps with these defaults and say which ones you used. Don't stop to ask.
- AP CSA style, Java (add Python to code questions only if asked). If a unit number is
  given, say which course outline you assumed (AP CSA renumbered its units in 2025).
- Minutes per question: 1 for multiple choice, 2 for select-all, 1–2 for short answer or output,
  3–4 for a trace table, 2–4 for fill in the blanks, 5–10 for code, 5 for a written answer
- Points per question: 1 for multiple choice, 2 for select-all, 1 for short answer, 6–9 for code
- "A few" questions means 3–5
- Medium difficulty. Easy: one idea per question, short code (about 5 lines), direct tracing
  or recall. Medium: AP exam level, two ideas per question, traps real students fall into,
  code questions the size of one free-response part. Hard: multi-step reasoning, nested loops
  and 2D arrays, tricky edge cases, and speed tests that require an efficient solution (see
  "Speed tests" in the format spec; say the required big-O in the prompt). Mixed: start easy,
  end hard.
- Rubric items on code questions grade themselves (`require`/`forbid`) unless the user wants
  to grade them by hand or wants no rubric

## 2. Write it

Create `quizzes/<short-name>/quiz.json`. `quizzes/` is gitignored, because quiz files hold
answer keys. Images go in `quizzes/<short-name>/assets/`.

- **Question types:** single, multi, text, code, plus output (predict what code prints), trace (trace
  table), fill (fill in the blanks) and essay (teacher-graded). Prefer output and trace for AP-style
  "what is printed" and tracing questions.
- **Order** questions single → multi → text → output → trace → fill → code → essay. Consecutive questions of one type form a part,
  with its own directions page, and shuffling stays inside parts.
- **Prompts** say exactly what's asked, including edge cases ("return 0 for an empty array").
  No flavor text, no hints, nothing that gives away the answer. Put code in backticks or
  fenced blocks.
- **Shared material:** when several questions use the same case, passage or code, write it
  once in top-level `shared` and give each question `"shared": "<id>"`. Keep the set's
  questions next to each other.
- **Multiple choice:** one clearly correct answer. Wrong choices come from real mistakes:
  - integer division
  - off-by-one errors
  - `==` vs `.equals`
  - aliasing
  - short-circuiting
  - precedence

  Keep choices about the same length. No "all/none of the above". `answer` counts from 0:
  recount it against the `choices` list.
- **Choices are one line:** only `inline code`, **bold** and *italic*. Multi-line code goes in
  the prompt as labeled segments (Segment I, II, …), and the choices name the segments. For
  "I only / I and II" style answers, set `"shuffleChoices": false` on that question.
- **Select all:** use only when 2+ choices are correct. Scoring is all or nothing.
- **Short answer:** use only when there are few ways to say the answer. List every accepted
  form in `answer` (`"O(log n)"`, `"O(logn)"`).
- **Code:**
  - Use only the types in the spec's table: scalars (including `char`), arrays and 2D arrays,
    `list<...>` and `map<string|int, ...>`. Custom classes as parameters aren't supported (use
    class mode instead). Overloads only work in Java-only class questions.
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

## 3. Check it, and fix until it's clean

```bash
node scripts/check-quiz.mjs quizzes/<short-name> --run
```

This runs the server's validation, warns about likely typos in keys, and runs every reference
solution against every test. Fix every error and warning, then run it again, until it ends
with `VALID`. If there's no JDK, Java references get skipped and are checked on upload instead;
say so.

## 4. Pack it

```bash
node scripts/pack-quiz.mjs quizzes/<short-name> quizzes/<short-name>.quiz
```

Report:
- the `.quiz` path
- number of questions and total points
- the time limit
- the defaults you picked, including `graceStrikes` (0 means one window switch invalidates)
  and shuffling
- anything you couldn't verify

`VALID` means the server accepts the quiz and the references pass. It doesn't show what the
quiz looks like: tell the teacher to open it with Preview on the dashboard before using it.

The teacher uploads it on the dashboard under Quizzes.
