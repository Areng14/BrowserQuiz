# The .quiz format

A `.quiz` file is a zip with `quiz.json` at the root (or inside one top-level folder) and an
optional `assets/` folder of images (png, jpg, gif or webp). Limits: 25 MB, 500 files,
300 questions.

Check a quiz before uploading. `--run` also runs the reference solutions, which needs
`python3`, plus a JDK for Java:

```bash
node scripts/check-quiz.mjs path/to/folder --run
```

Upload the folder zipped, or pack it first:

```bash
node scripts/pack-quiz.mjs path/to/folder out.quiz
```

`examples/ap-csa-unit4/quiz.json` uses most features.

## Top level

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `"Untitled quiz"` | Shown to students and on reports |
| `timeLimitMin` | `0` (no limit) | Minutes, up to 600. The quiz turns itself in at 0:00 |
| `language` | `"java"` | `"java"` or `"python"`: how `inline code` and unlabeled code blocks are highlighted |
| `shuffleQuestions` | `true` | Shuffle order per student, within each part (see below) |
| `shuffleChoices` | `true` | Shuffle multiple choice options per student |
| `integrity.graceStrikes` | `0` | Times a student can leave the window before the attempt is invalidated (0–10) |
| `directions` | built in | Override the directions text per part: `{ "single": "...", "multi": "...", "text": "...", "code": "..." }` |
| `questions` | required | List of questions |

**Parts.** Consecutive questions of the same `type` form a part. Each part gets a
directions page, and shuffling never moves a question out of its part. Keep same-type
questions together.

## Every question

| Key | Default | Meaning |
| --- | --- | --- |
| `id` | `q1`, `q2`, … | Unique. Letters, digits, `-`, `_` |
| `type` | `"single"` | `single`, `multi`, `text` or `code` |
| `prompt` | required | Markdown subset (below) |
| `points` | `1` | Positive number |
| `image` | none | `"assets/diagram.png"`, must exist in the zip |
| `imageAlt` | `""` | Alt text for the image |

**Markdown subset** (prompts and choices):
- paragraphs (blank line between)
- `- ` or `1. ` lists
- `**bold**` and `*italic*`
- `` `inline code` ``
- fenced code blocks, written ```` ```java ```` … ```` ``` ````

No HTML, links, headings or tables.

## single and multi (multiple choice)

```json
{ "id": "q1", "type": "single", "prompt": "What is `7 / 2` in Java?",
  "choices": ["`3`", "`3.5`", "`4`", "It doesn't compile"], "answer": 0 }
```

- `choices`: 2 to 8 strings.
- `answer` counts from 0: one index for `single`, a list of indexes for `multi` (`[0, 2]`).
- `multi` is all or nothing: every correct choice and no wrong ones.

## text (short answer)

```json
{ "id": "q3", "type": "text", "prompt": "Worst-case time of binary search?", "answer": ["O(log n)", "O(logn)"] }
```

- `answer`: one string or a list of accepted strings.
- Matching ignores leading and trailing spaces, repeated spaces, and capital letters.
- To make capitals count, set `"caseSensitive": true`.

## code

Students write code in an editor and press Run examples to test against the sample tests.
Grading uses the hidden tests, which students never see.

| Key | Default | Meaning |
| --- | --- | --- |
| `languages` | `["java"]` | `["java"]`, `["python"]` or both (the student picks) |
| `mode` | `"method"` | `"method"`: write one method. `"class"`: write a whole class |
| `signature` | — | Method mode: `{ "name", "params": [{ "name", "type" }], "returns" }` |
| `class` | — | Class mode: `{ "name", "constructor": [params], "methods": [{ "name", "params", "returns" }] }` |
| `tests` | — | `{ "sample": [...], "hidden": [...] }`: up to 10 sample, 1 to 100 hidden |
| `reference` | none | `{ "java": "...", "python": "..." }` correct solutions. Strongly recommended |
| `rubric` | none | `[{ "id", "text", "points" }]` points the teacher awards by hand |
| `compare` | `"ordered"` | `"unordered"`: array/list results can come back in any order |
| `starter` | `"stubs"` | `"stubs"` (generated signatures), `"empty"` (class mode: bare class), or `{ "java": "...", "python": "..." }` |
| `support` | none | `{ "java": "...", "python": "..." }` extra code compiled with the student's (helper classes) |
| `limits` | 2000 ms, 256 MB | `{ "timeMs": 200–5000, "memoryMb": 64–512 }` per test |

### Types

Every parameter and return value uses one of these:

| Type | Java | Python |
| --- | --- | --- |
| `int`, `long` | `int`, `long` | `int` |
| `double` | `double` | `float` |
| `boolean` | `boolean` | `bool` |
| `string` | `String` | `str` |
| `int[]`, `long[]`, `double[]`, `boolean[]`, `string[]` | arrays | `list[...]` |
| `int[][]` | `int[][]` | `list[list[int]]` |
| `list<int>`, `list<string>` | `ArrayList<Integer>`, `ArrayList<String>` | `list[int]`, `list[str]` |

Class methods can also return `void`. Doubles match within a relative 1e-6. Overloaded
methods aren't supported. Names can't be keywords in either language.

### What students write

- **Method mode, Java:** `class Solution { public <returns> <name>(<params>) { ... } }`
- **Method mode, Python:** `class Solution:` with `def <name>(self, <params>):`
- **Class mode:** a class named `class.name` with that constructor and those methods. In
  Python the constructor is `__init__`.

Java gets `java.util.*`, `java.util.function.*` and `java.util.stream.*` imported automatically.

### Tests

Method mode. `expected` can be left out when there's a reference: it's filled in at upload.

```json
{ "args": ["hello"], "expected": 2 }
{ "args": [[3, 1, 2]], "expected": [1, 2, 3], "weight": 2 }
```

Class mode tests are a list of steps:

```json
{ "steps": [
  { "new": ["Ava", 100.0] },
  { "call": "deposit", "args": [50.0] },
  { "call": "getBalance", "expect": 150.0 }
] }
```

- `new` makes an object. Name it with `"as": "x"` to use several, then pick one with
  `"on": "x"`. `on` defaults to the last object made.
- `expect` checks a method's return value. `"check": true` takes the value from the
  reference solution instead.
- `weight` (default 1) makes a test count more.

A test can appear in both `sample` and `hidden`.

### Scoring

The code part is worth `points` minus the rubric points. Students earn the share of hidden
test weight they pass. The teacher ticks rubric items in the dashboard. Rubric points must
total less than `points`.

### Reference solutions

When you upload a quiz, each reference solution runs against every test:
- missing `expected` values are filled in from what the reference returns
- if a reference disagrees with an `expected` you wrote, the upload is refused, with the test named

Write references for every language you allow.
