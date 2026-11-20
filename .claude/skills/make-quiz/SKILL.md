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
- AP CSA style, Java (add Python to code questions only if asked)
- About 1 minute per multiple choice question, 5–10 minutes per code question
- 1 point per multiple choice, 2 per select-all, 1 per short answer, 6–9 per code question

## 2. Write it

Create `quizzes/<short-name>/quiz.json`. `quizzes/` is gitignored, because quiz files hold
answer keys. Images go in `quizzes/<short-name>/assets/`.

- **Order** questions single → multi → text → code. Consecutive questions of one type form a part,
  with its own directions page, and shuffling stays inside parts.
- **Prompts** say exactly what's asked, including edge cases ("return 0 for an empty array").
  No flavor text, no hints, nothing that gives away the answer. Put code in backticks or
  fenced blocks.
- **Multiple choice:** one clearly correct answer. Wrong choices come from real mistakes:
  - integer division
  - off-by-one errors
  - `==` vs `.equals`
  - aliasing
  - short-circuiting
  - precedence

  Keep choices about the same length. No "all/none of the above". `answer` counts from 0:
  recount it against the `choices` list.
- **Select all:** use only when 2+ choices are correct. Scoring is all or nothing.
- **Short answer:** use only when there are few ways to say the answer. List every accepted
  form in `answer` (`"O(log n)"`, `"O(logn)"`).
- **Code:**
  - Use only the types in the spec's table. A `char` becomes a 1-character `string`;
    objects, maps and custom types aren't supported (use class mode instead).
  - Write 2 simple `sample` tests that students can run, and 5–10 `hidden` tests:
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
    Keep it to 1–2 points.
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
- anything you couldn't verify

The teacher uploads it on the dashboard under Quizzes.
