# Write a BrowserQuiz quiz

You're writing a quiz for BrowserQuiz, a quiz app for CS classes. Your answer is one file,
`quiz.json`, in the format described below. The teacher uploads it on the BrowserQuiz dashboard.

## The quiz I want

Topic:
Number and kinds of questions:
Time limit:
Languages for code questions (Java, Python, or both):
Anything else:

## How to write it

1. If something above is blank, use these defaults and list the ones you used:
   - AP CSA style, Java
   - 1 minute per multiple choice question, 2 per select-all, 1–2 per short answer, 5–10 per code question
   - 1 point per multiple choice, 2 per select-all, 1 per short answer, 6–9 per code question
2. Order the questions by type: single, multi, text, output, trace, fill, code, essay. For AP-style
   "what is printed" questions use `output`, and for tracing loops use `trace`.
3. Prompts say exactly what's asked, including edge cases ("return 0 for an empty array").
   No hints and nothing that gives the answer away.
4. Multiple choice:
   - Exactly one clearly correct answer.
   - Wrong choices come from real mistakes: integer division, off-by-one, `==` vs `.equals`,
     aliasing, short-circuiting, precedence.
   - No "all/none of the above".
   - Choices are one line each. Multi-line code goes in the prompt as labeled segments
     (Segment I, II, …), and for "I only / I and II" style choices, set
     `"shuffleChoices": false` on that question.
5. Use select-all only when 2+ choices are correct. Use short answer only when there are few
   ways to write the answer, and list all of them.
6. Code questions:
   - Use only the types in the format's type table.
   - Write 2 simple sample tests, plus 5–10 hidden tests. The hidden tests repeat the samples
     and cover empty input, one element, negatives, duplicates, boundaries, and a larger case.
   - Always include a reference solution in every allowed language.
   - Use a rubric only for things tests can't check (1–2 points). Give each item a `require`
     or `forbid` regex when a pattern can decide it (private fields, no library sort,
     recursion), so it grades itself. Leave it off for things only a person can judge.

## Images

Use an image only when the question needs one:
- an image the teacher attached, or
- a diagram you can draw exactly with code (for example a 2D array grid or a memory diagram
  drawn with matplotlib).

Put each image in `assets/`, point to it with `"image": "assets/<name>.png"`, and describe it
in `"imageAlt"`. Never reference an image you aren't including.

## Check your work before answering

- Recount every `answer` index against its `choices`, counting from 0.
- Trace every code test through your reference solution by hand. Every `expected` value must be
  exactly what your reference returns. If you can run code, run the references on every test.
  When you upload, BrowserQuiz runs the references against every test and rejects the quiz if
  any value is wrong.
- Every `image` path must be a file you put in `assets/`.
- Make sure the JSON is valid: double quotes, no trailing commas, no comments, nothing left out.

## Your answer

If you can create files, make a `.quiz` file:
- a zip with `quiz.json` at its root and the images in an `assets/` folder
- named after the quiz, like `unit-6-arrays.quiz`
- given to me to download

If you can't create files, answer with the whole `quiz.json` in one ```json code block instead,
without images.

Either way, then list the defaults you used.

## The format

{{FORMAT}}

## A complete example

```json
{{EXAMPLE}}
```
