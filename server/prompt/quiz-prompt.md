# Write a BrowserQuiz quiz

You're writing a quiz for BrowserQuiz, a quiz app for CS classes. Your answer is one file,
`quiz.json`, in the format described below. The teacher uploads it on the BrowserQuiz dashboard.

## The quiz I want

Topic:
Difficulty (easy, medium, hard, or mixed):
Number and kinds of questions:
Time limit:
Languages for code questions (Java, Python, JavaScript, TypeScript, C, C++, C#, Go, Rust; one or several, or any):
Rubric points on code questions (graded automatically, by me, or none):
Extras (any from the list in step 1, or none):
Anything else:

## 1. Ask before you write

Before writing, send me one short message and wait for my answer. In it:

- Ask about anything left blank above, with the default in brackets:
  1. What topic or unit, and what have students covered so far? Notes or a worksheet help.
  2. How hard: easy, medium, hard, or mixed? [medium]
  3. How many questions, and what kinds? [6 multiple choice, 1 select-all, 1 predict the output, 1 code]
  4. Time limit? [worked out from the questions]
  5. Which languages for code questions (Java, Python, JavaScript, TypeScript, C, C++, C#, Go, Rust)?
     [the topic's language, or Java]
  6. Code questions can have rubric points for things tests can't check, like private fields.
     Should those be graded automatically, by you, or left out? [automatically]
- Unless Extras is already filled in, list these extras in one line each and ask which I want
  [none]. Teachers often don't know BrowserQuiz has them:
  - **Question pools:** each student gets a random few questions from a bigger set, so neighbors'
    screens don't match.
  - **Random values:** the numbers in a question change per student, each with its own answer.
  - **Locked parts:** once a student moves on to the next part, they can't go back.
  - **Sections:** named parts, like "Part A: Arrays, Part B: Strings".
  - **Timed parts:** each section gets its own minutes, like the SAT. Students stay in a part until
    its time is up, then it locks and the next one starts.
  - **Shared material:** one passage, table or piece of code that several questions use.
  - **Speed tests:** a code question that needs an efficient solution (Java, Python, JavaScript and
    TypeScript).
  - **Banned methods:** rule out shortcuts on code questions, like a built-in sort.
  - **Code without running:** students write code questions without running them, like on paper.
    The tests still grade them.
  - **Images:** diagrams you draw, or pictures I attach.
  - **Turning in early:** students can turn in before time is up. Without it, a timed quiz turns in
    when time runs out.

Ask only once. If everything above is filled in and Extras says none, don't ask: start writing. If I
answer "defaults", use the defaults with no extras.

## 2. Defaults

Use these for anything still blank, and list the ones you used in your answer.

- **Style, level and language:** match the topic and notes. If nothing says otherwise, use Java.
- **Topics that aren't about code** (networking, math, theory): set `"language": "none"` and write
  no code questions unless I ask for them. Concept, scenario and calculation questions fit better.
  A quiz about TCP handshakes doesn't need a method to write. Write math in LaTeX (`$x^2$`), as the
  format shows.
- **Difficulty:** medium.
- **Minutes:** 1 per multiple choice, 2 per select-all, 1–2 per short answer or output, 3–4 per
  trace table, 2–4 per fill in the blanks, 5–15 per code question (by difficulty), 5 per written answer.
- **Points:** 1 per multiple choice, 2 per select-all, 1 per short answer, 6–9 per code question.
- **Rubric points:** graded automatically.

## 3. Difficulty

- **Easy:** one idea per question, recall or a single direct step. Code to trace is about 5 lines.
  Code questions take about 5 minutes.
- **Medium:** questions combine two ideas, and wrong choices are real student mistakes. Code
  questions take about 10 minutes.
- **Hard:** multi-step reasoning and tricky edge cases. Code questions take about 15 minutes and
  have more hidden tests. They can require an efficient solution (O(log n), O(n)) with a speed
  test (see "Speed tests" in the format; Java, Python, JavaScript and TypeScript only). Say so in
  the prompt.
- **Mixed:** start easy and end hard.

Pitch it at the class, not at the best student: someone who studied the notes should get most
questions right. When unsure, make it easier. Only go hard if I ask for it. No question should need
a trick or an idea the notes don't teach.

## 4. Keep every question short

Students read on laptops, iPads and phones. Long questions overflow the screen and eat time
that should go to thinking. Keep to these limits, even when the notes are wordy:

- **Prompt:** what's asked, in 1–3 sentences (about 60 words), plus code if the question is about
  code. No story, no setup, no "In this question you will…", no restating the rules. Teachers' notes
  are often wordy: keep the idea, cut the words.
- **Code shown to students:** at most about 15 lines, each under about 70 characters. One snippet
  per question.
- **Choices:** one line each, under about 60 characters, all about the same length.
- **Code questions:** one method with an exact signature. The prompt (about 100 words at most)
  says what it returns, the edge cases and what isn't allowed. The sample tests show examples,
  so don't repeat them in words.
- **Explanations:** one or two sentences.
- **Directions:** one line, or none.
- When several questions use the same case, passage or code, put it in `shared` once and point
  each question at it, instead of repeating it.
- If a question needs more than this, split it into two questions.

## 5. Questions

**Order and types**
- Order the questions by type: single, multi, text, output, trace, fill, code, essay (inside each
  section, if there are sections).
- For "what is printed" questions use `output`, and for tracing loops use `trace`.
- Use select-all only when 2 or more choices are correct.
- Use short answer only when there are few ways to write the answer, and list all of them.
- Use question pools only if I ask for them (Extras).
- Use random values (`vars`, see the format) only if I ask for them: give 3 to 6 rows, and work
  out each row's answer and put it in the row.
- Set `"lockParts": true` only if I ask that students can't go back to earlier parts.
- Add `sections` only if I ask for named parts. Set `"turnInEarly": true` only if I ask that students can
  turn in before time is up.
- Timed parts only if I ask for them: give every section a `timeLimitMin`, start the first one at the
  first question, and leave the quiz's `timeLimitMin` out (it's the sections added up). Work out each
  part's minutes from its questions, as for the time limit (Defaults), with room to check work.
- Set `"noRun": true` on code questions only if I ask for code without running.

**Every question**
- Give every question an `explanation`: why the right answer is right, and for multiple choice,
  the mistake behind the likeliest wrong choice. Students read it after a practice quiz, so teach,
  don't just restate the answer.
- Prompts say exactly what's asked, including edge cases ("return 0 for an empty array").
  No hints and nothing that gives the answer away.
- Give each question a short `name`, like "countVowels" or "Search running time". Students see the
  names before they start, so a name never gives the answer away ("Binary search" for "which search
  is this?" does).

**Multiple choice**
- Exactly one clearly correct answer.
- The right answer must not stand out. Students quickly learn that "the longest, most detailed or most
  careful-sounding choice is right", so make the wrong choices just as long, specific and confident.
  Across the quiz the right answer is the longest choice no more often than the others, and its position
  varies.
- Wrong choices come from real mistakes in the quiz's language or topic. In Java: integer
  division, off-by-one, `==` vs `.equals`, aliasing, short-circuiting, precedence. In Python:
  mutable default arguments, `is` vs `==`, off-by-one in `range`. In networking: off-by-one
  subnet sizes, mixing up layers. Use the equivalent mistakes for any other language or topic.
- No "all/none of the above".
- Multi-line code goes in the prompt as labeled segments (Segment I, II, …). For "I only /
  I and II" style choices, set `"shuffleChoices": false` on that question.

**Code questions**
- Use only the types in the format's type table. For languages other than Java and Python,
  keep to what the format's "Languages" section allows.
- Write 2 simple sample tests, plus 5–10 hidden tests. The hidden tests repeat the samples
  and cover empty input, one element, negatives, duplicates, boundaries, and a larger case.
- Always include a reference solution in every allowed language.
- To rule out a shortcut (a library sort, streams), use `ban`: code that uses a banned
  method scores 0 on the question, in any language.
  - A plain name like `["sort"]` works for every language and covers its relatives there
    (`sorted`, `toSorted`, `qsort`, `stable_sort`, `sort_unstable`, LINQ's `OrderBy`).
  - `Class.method` entries mean one language's class, so with several languages give those
    per language (`{ "java": ["Arrays.sort"], "javascript": ["Math.max"], "rust": ["sort"] }`).
  - Other library routes to the same answer aren't caught unless you list them: for a sorting
    question, think of the sorted collections (`"TreeSet"`, `"PriorityQueue"` in Java,
    `"BinaryHeap"` in Rust).
  - The reference solutions have to keep to the bans. Say in the prompt what isn't allowed.
  - For a point off instead of a zero, use a rubric item with a `forbid` regex instead.
- Use a rubric only for things tests can't check (1–2 points). How depends on my answer
  about rubric points:
  - **Automatically:** give every rubric item a `require` or `forbid` regex (see "Rubric
    checks" in the format), like private fields or recursion. Leave out items a pattern
    can't decide.
  - **By me:** rubric items with no `require` or `forbid`. I tick them on the dashboard.
  - **Left out:** no rubric. The tests are worth all the points.

## 6. Keep it fair

Students should lose points for not knowing the material, never for guessing what you meant.

- Use only the language features and library methods the notes cover. If there are no notes,
  stick to what an intro course in that language teaches (for AP CSA, the Java Quick Reference).
  No trivia.
- No trick questions: no misleading names, no typos planted in code, no wording traps. A question
  that asks what's NOT true says **NOT** in bold.
- Code questions give the exact signature and say what to return. Every hidden test checks
  something the prompt says: if a test uses an empty array, a negative or a tie, the prompt says
  what to do with it. A speed test means the prompt names the speed needed.
- All code is clean, the way students should write it: in prompts, choices, starter code and
  reference solutions. The language's usual formatting, indentation and naming (camelCase in Java,
  snake_case in Python), clear names, braces on every `if` and loop in Java and the C family, no
  unused variables or dead code, no clever one-liners, comments only where they help. Reference
  solutions are the simple, expected solution, not the shortest or most clever one.
- Code students read compiles. Predict-the-output
  code prints a few short lines, never output where only the spacing differs.
- Short answer accepts every reasonable way to write it: synonyms, abbreviations, with or
  without units. Use a pattern when there are many.
- Fill in the blanks: each blank has one clear answer, or list every one that works.
- Trace tables: about 8 rows at most, with the starting values given.
- Select-all with 3 or more correct choices uses `"partialCredit": true`.
- Points match the work: a 10-minute code question is worth more than a 1-minute recall question.
- The time limit leaves room to check work, about 20% more than the per-question minutes add up to.

## 7. Images

Use an image only when the question needs one:
- an image the teacher attached, or
- a diagram you can draw exactly with code (for example a 2D array grid, a memory diagram or
  a network diagram drawn with matplotlib).

Put each image in `assets/`, point to it with `"image": "assets/<name>.png"`, and describe it
in `"imageAlt"`. Never reference an image you aren't including.

## 8. Check your work before answering

- Recount every `answer` index against its `choices`, counting from 0.
- For each multiple choice question, check whether the right answer is the longest choice. If it is in
  more than about a quarter of them, rewrite choices until it isn't.
- Trace every code test through your reference solution by hand. Every `expected` value must be
  exactly what your reference returns. If you can run code, run the references on every test.
  When you upload, BrowserQuiz runs the references against every test and rejects the quiz if
  any value is wrong.
- Every `image` path must be a file you put in `assets/`.
- Reread each question against the limits in "Keep every question short", and cut what's over.
- Reread every piece of code: it compiles, and it's formatted and named cleanly.
- Reread the quiz as a student who studied: if a question would stump most of them, make it easier.
- Make sure the JSON is valid: double quotes, no trailing commas, no comments, nothing left out.

## 9. Your answer

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

This example is an AP CSA quiz in Java. Copy its format, not its course, level or language.

```json
{{EXAMPLE}}
```
