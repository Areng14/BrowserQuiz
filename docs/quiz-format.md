# The .quiz format

A quiz is a `quiz.json` file. Upload it as is, or as a `.quiz` file: a zip with `quiz.json`
at the root (or inside one top-level folder) and an optional `assets/` folder of images
(png, jpg, gif or webp). Limits: 25 MB, 500 files, 300 questions.

<!-- not-in-prompt -->
Check a quiz before uploading. `--run` also runs the reference solutions, which needs
`python3`, plus a JDK for Java, gcc/g++ for C and C++, `go` and `rustc` for those (JavaScript and TypeScript run on Node; C# is only checked on upload):

```bash
node scripts/check-quiz.mjs path/to/folder --run
```

Upload the folder zipped, or pack it first:

```bash
node scripts/pack-quiz.mjs path/to/folder out.quiz
```

`examples/ap-csa-unit4/quiz.json` uses most features. Teachers can also build quizzes in the
dashboard (New quiz) and check how one looks with Preview. Both save this same format.
<!-- /not-in-prompt -->

## Top level

| Key | Default | Meaning |
| --- | --- | --- |
| `format` | `1` | Format version. Optional |
| `title` | `"Untitled quiz"` | Shown to students and on reports |
| `timeLimitMin` | `0` (no limit) | Minutes, up to 600. The quiz turns itself in at 0:00 |
| `language` | `"java"` | `"java"`, `"python"`, `"javascript"`, `"typescript"`, `"c"`, `"cpp"`, `"csharp"`, `"go"`, `"rust"` or `"none"`: how `inline code` and unlabeled code blocks are highlighted. `"none"` leaves them plain, for quizzes that aren't about code (networking, math); blocks labeled ```` ```java ```` still get colors. Output, trace and fill questions then default to Java |
| `shuffleQuestions` | `true` | Shuffle order per student, within each part (see below) |
| `shuffleChoices` | `true` | Shuffle multiple choice options per student |
| `lockParts` | `false` | Once a student moves on to a later part, the parts before it are final: they can't go back to them. The page asks first. Not in corrections |
| `integrity.graceStrikes` | `1` | Times a student can leave the window before the attempt is invalidated (0–10). The default lets one slip go; 0 invalidates on the first. |
| `directions` | built in | `"quiz"`: your own directions for the whole quiz (Markdown), shown before it starts and with each part's. The type keys replace that part's directions: `{ "quiz": "No calculators.", "single": "...", "code": "..." }` |
| `shared` | none | Shared material that several questions use (below) |
| `pools` | none | How many questions each student gets from each question pool: `{ "loops": 2 }` (below). A pool not listed gives 1 |
| `sections` | none | Your own section dividers: `[{ "before": "q5", "title": "Part B: Strings", "directions": "..." }]`. Each starts at the question named in `before` and runs to the next one, whatever the questions' types, with its own title and directions (Markdown). Questions before the first are grouped by type. Shuffling stays inside a section |
| `questions` | required | List of questions |

**Shared material.** A case, passage, table or code listing that several questions use goes
in `shared` once, instead of being copied into each prompt:

```json
"shared": [
  { "id": "caseA", "title": "Case A", "text": "Lab subnet `10.21.8.0/24`. Every device is on switch S..." }
],
"questions": [
  { "type": "single", "shared": "caseA", "prompt": "After K sends its 09:01 frame, what is S's forwarding state?", ... },
  { "type": "single", "shared": "caseA", "prompt": "Which port does S send H's next frame to J on?", ... }
]
```

- `id` (letters, digits, `-`, `_`) is what questions point to with `"shared"`. `title` is
  optional. `text` is Markdown like a prompt. `image` and `imageAlt` work as on questions.
- Students see the material beside each question that uses it (above it on small screens).
  Reports show it once, at the first question of the set.
- Put a set's questions next to each other: shuffling keeps them together, in order.

**Parts.** Consecutive questions of the same `type` form a part. Each part gets a
directions page, and shuffling never moves a question out of its part. Keep same-type
questions together.

**Question pools.** Give questions the same `"pool"` and each student gets only some of them,
picked at random, so a neighbor's screen doesn't help:

```json
"pools": { "loops": 2 },
"questions": [
  { "id": "l1", "type": "code", "pool": "loops", "points": 6, ... },
  { "id": "l2", "type": "code", "pool": "loops", "points": 6, ... },
  { "id": "l3", "type": "code", "pool": "loops", "points": 6, ... }
]
```

- Each student gets 2 of l1, l2 and l3. The ones they get stay where the pool's questions are.
- Every question in a pool is worth the same, so everyone's quiz is out of the same points.
- Write a pool's questions next to each other, of one type and about as hard as each other.
- Reports and the CSV show each student only the questions they got.

## Every question

| Key | Default | Meaning |
| --- | --- | --- |
| `id` | `q1`, `q2`, … | Unique. Letters, digits, `-`, `_` |
| `type` | `"single"` | `single`, `multi`, `text`, `code`, `output`, `trace`, `fill` or `essay` |
| `prompt` | required | Markdown subset (below) |
| `points` | `1` | Positive number |
| `name` | none | Up to 80 characters, like `"BankAccount class"`. Students see each question's name, type and points before they start, so it shouldn't give the answer away |
| `image` | none | `"assets/diagram.png"`, must exist in the zip |
| `imageAlt` | `""` | Alt text for the image |
| `shared` | none | The `id` of a shared material this question uses, or a list of up to 3 (`["s1", "s2"]`), shown in that order |
| `explanation` | none | Why the answer is right (Markdown, up to 4000 characters). Students see it with the answer in a practice quiz's review, after turning it in; never during a quiz. It's in reports, and AI grading reads it as your notes |
| `pool` | none | A question pool's name (letters, digits, `-`, `_`): each student gets some of the pool's questions (see Question pools) |

**Prompts** (and shared material) use Markdown:
- paragraphs (blank line between)
- `- ` or `1. ` lists
- `**bold**`, `*italic*`, `~~struck~~` and `` `inline code` ``
- fenced code blocks, written ```` ```java ```` … ```` ``` ````
- `#`, `##` and `###` headings, `> ` quotes, and `---` for a line across
- tables: `| a | b |`, then `| --- | --- |`, then one row per line. `:---:` centers a column and
  `---:` right-aligns it. Write `\|` for a `|` inside a cell
- LaTeX math: `$x^2$` in a line, and `$$\frac{n(n+1)}{2}$$` on a line of its own (or `$$`,
  lines, `$$`). A `$` only starts math when the next character isn't a space, so "costs $5 and
  $10" stays text. Write `\$` for a dollar sign
- `\` before a character keeps it as is: `\*not italic\*`
- images from `assets/`: `![a binary tree](assets/tree.png)`, as many as you like, in prompts,
  choices, shared material and directions. File names can't have spaces here

Links show as their text only, so nothing on the page leads out of the quiz. No HTML.

**Choices** on one line take inline Markdown: code, bold, italic, struck, `$math$` and images. A
choice with a line break in it (`\n` in JSON) is Markdown like a prompt, so it can hold a code
block, a table or a list.

## single and multi (multiple choice)

```json
{ "id": "q1", "type": "single", "prompt": "What is `7 / 2` in Java?",
  "choices": ["`3`", "`3.5`", "`4`", "It doesn't compile"], "answer": 0 }
```

- `choices`: 2 to 8 strings.
- `answer` counts from 0: one index for `single`, a list of indexes for `multi` (`[0, 2]`).
- `multi` is all or nothing (every correct choice and no wrong ones), unless it has `"partialCredit": true`:
  then each right pick earns `points / number of correct choices` and each wrong pick takes that back,
  never below 0. Students see "partial credit" next to the points.
- `"shuffleChoices": false` keeps this question's choices in order, for "I only", "I and II", … answers.

## text (short answer)

```json
{ "id": "q3", "type": "text", "prompt": "Worst-case time of binary search?", "answer": ["O(log n)", "O(logn)"] }
```

- `answer`: one string or a list of accepted strings.
- Matching ignores leading and trailing spaces, repeated spaces, a trailing period, and capital letters.
- Numbers match by value: `"3.5"` also accepts `3.50`, `.5` style decimals and `7/2`.
- For answers with many phrasings, write a pattern between slashes: `"/^(binary|bin\\.?) search$/"`.
  It's a regex, checked against the trimmed answer, any case unless `caseSensitive`. It can't
  accept a blank answer. Students never see patterns, even in the practice review.
- To make capitals count, set `"caseSensitive": true`.

## output (predict the output)

```json
{ "id": "q4", "type": "output", "prompt": "What does this print?",
  "code": "int x = 7;\nSystem.out.println(x / 2);\nSystem.out.println(x % 2);" }
```

- `code`: the snippet students read.
  - Java: statements, or a full class with `main`.
  - C and C++: statements, or a full program with `main`. The usual headers are included (C++
    also gets `using namespace std`).
  - Go: statements (`fmt`, `math`, `sort`, `strconv` and `strings` are imported), or a full program.
  - Rust: statements, or a full program with `fn main`.
  - C#: statements (top-level, with `System`, `System.Collections.Generic`, `System.Linq` and
    `System.Text`), or a full program.
  - Python, JavaScript, TypeScript: a script.
- `language`: defaults to the quiz's `language`.
- `answer` is optional. On upload the code is run and its output becomes the answer. If you
  write an `answer` yourself, it has to match what the code prints.
- Matching ignores spaces at the ends of lines and blank lines at the start and end. Everything
  else counts, including capital letters.

## trace (trace table)

```json
{ "id": "q5", "type": "trace", "points": 3, "prompt": "Fill in i and sum at the end of each pass.",
  "code": "int sum = 0;\nfor (int i = 1; i <= 4; i++) {\n    sum += i;\n}",
  "columns": ["i", "sum"],
  "rows": [["1", "1"], ["2", "3"], ["3", "6"], ["4", "10"]],
  "given": [[0, 0], [0, 1]] }
```

- `columns`: 1 to 8 headings.
- `rows`: the correct value for every cell, with up to 40 rows.
- `given`: cells shown already filled in, as `[row, column]` counting from 0. They aren't graded.
- `code` is optional.
- Each graded cell is worth the same. Spaces around a value and quotes around a string
  (`"abc"` for `abc`) don't matter.

## fill (fill in the blanks)

```json
{ "id": "q6", "type": "fill", "points": 2, "prompt": "Complete the code so total is the sum of nums.",
  "code": "int total = ___;\nfor (int n : nums) {\n    total ___ n;\n}",
  "answer": ["0", ["+=", "= total +"]] }
```

- `code` marks each blank with `___` (three or more underscores), up to 30 blanks.
- `answer` has one entry per blank: a string, or a list of accepted strings. Spacing doesn't
  matter.
- Each blank is worth the same.
- **Graded by running instead:** add the fields of a code question (`signature` or `class`, and
  `tests`, as described under code). The code with the student's blanks filled in is then run
  against the tests, so any blanks that make it work earn credit, not just the ones in `answer`.
  - Students get Run examples for the sample tests.
  - The `answer` blanks are the reference solution.
  - The code must be the whole `Solution` class (or the class from `class`).

## essay (written answer)

```json
{ "id": "q7", "type": "essay", "points": 3, "prompt": "Explain why a == b can be false for two equal Strings.",
  "rubric": [{ "text": "Says == compares references", "points": 2 }, { "text": "Says .equals compares the text", "points": 1 }] }
```

- The teacher grades it, with the rubric checkboxes or by typing points.
- `"language": "java"` (or any code language) gives students a code box instead of a text box. Use it
  for AP-style free response graded by rubric.

## code

Students write code in an editor and press Run examples to test against the sample tests.
Grading uses the hidden tests, which students never see.

| Key | Default | Meaning |
| --- | --- | --- |
| `languages` | `["java"]` | Any of `"java"`, `"python"`, `"javascript"`, `"typescript"`, `"c"`, `"cpp"`, `"csharp"`, `"go"`, `"rust"` (the student picks), or `"any"`: every language that can run the question. See [Languages](#languages) |
| `mode` | `"method"` | `"method"`: write one method. `"class"`: write a whole class |
| `signature` | — | Method mode: `{ "name", "params": [{ "name", "type" }], "returns" }` |
| `class` | — | Class mode: `{ "name", "constructor": [params], "methods": [{ "name", "params", "returns" }] }` |
| `tests` | — | `{ "sample": [...], "hidden": [...] }`: up to 10 sample, 1 to 100 hidden |
| `reference` | none | `{ "java": "...", "python": "..." }` correct solutions. Strongly recommended |
| `rubric` | none | `[{ "id", "text", "points", "require", "forbid" }]` points for things tests can't see. See [Rubric checks](#rubric-checks) |
| `ban` | none | Methods students may not use: `["Arrays.sort", "Collections.sort", "stream"]`, or `{ "java": [...], "cpp": [...] }`. Code that uses one scores 0 on the question. See [Banned methods](#banned-methods) |
| `noRun` | `false` | `true`: written without running, like on paper. No **Run examples**; grading still runs the tests |
| `compare` | `"ordered"` | `"unordered"`: array/list results can come back in any order |
| `starter` | `"stubs"` | `"stubs"` (generated signatures), `"empty"` (class mode: bare class), or `{ "java": "...", "python": "..." }` |
| `types` | none | Classes for parameters and results: `{ "Point": { "x": "int", "y": "int" } }`. See [Classes](#classes) |
| `support` | none | `{ "java": "...", "python": "..." }` extra code compiled with the student's (helper classes). In JavaScript and TypeScript it runs first as a script, so its functions and classes are globals |
| `limits` | 2000 ms, 256 MB | `{ "timeMs": 200–5000, "memoryMb": 64–512 }` per test |

### Types

Every parameter and return value uses one of these:

| Type | Java | Python | JavaScript, TypeScript | C++ | C | Go | Rust | JSON value |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `int`, `long` | `int`, `long` | `int` | `number` | `int`, `long long` | `int`, `long long` | `int`, `int64` | `i32`, `i64` | `3` |
| `double` | `double` | `float` | `number` | `double` | `double` | `float64` | `f64` | `2.5` |
| `boolean` | `boolean` | `bool` | `boolean` | `bool` | `bool` | `bool` | `bool` | `true` |
| `string` | `String` | `str` | `string` | `string` | `char*` | `string` | `String` | `"hi"` |
| `char` | `char` | `str` (one letter) | `string` (one letter) | `char` | `char` | `byte` | `char` | `"a"` |
| any of those with `[]` or `[][]`, like `char[]`, `string[][]` | arrays | `list[...]` | arrays | `vector<...>` | `int* nums, int numsSize` (see below) | slices | `Vec<...>` | `[1, 2]`, `[[1], [2, 3]]` |
| `list<int>`, `list<string>`, `list<double>`, ... (any of the first six) | `ArrayList<Integer>`, ... | `list[...]` | arrays | `vector<...>` | like an array | slices | `Vec<...>` | `[1, 2]` |
| `map<string, V>`, `map<int, V>` | `HashMap<String, V>`, ... | `dict[str, V]`, ... | `Map<string, V>`, ... | `unordered_map<string, V>`, ... | none | `map[string]V`, ... | `HashMap<String, V>`, ... | `{"a": 1}`, `{"3": "c"}` |

In C# they're like Java's, with `bool`, `string`, jagged arrays (`int[][]`), `List<int>` and
`Dictionary<string, V>`.

A map's values (`V`) can be any of the first six types, `list<int>` or `list<string>`. Map keys
are strings in JSON, so an `int` key is written `"3"`. Maps match when they have the same keys
and values, in any order. Doubles match within a relative 1e-6. For your own classes as
parameters and results (a `Point`, a linked list's `Node`), see [Classes](#classes) below.

Class methods can also return `void`. A class can have overloads (two methods with one name and
different parameters) when its languages are only Java, C++ and C#, since the others have no
overloading. A test step calls the first one listed whose parameters fit its arguments. Names
can't be keywords in any of the question's languages.

In the quiz maker, write map values like Python: `{"a": 1}` or `{3: "c"}`.

### Classes

`"types"` declares classes the question uses, field by field. BrowserQuiz writes them in each of
the question's languages, and students see them above the examples as given code: theirs to use,
not to write.

```json
"types": {
  "Point": { "x": "int", "y": "int" },
  "Node": { "val": "int", "next": "Node" }
},
"signature": { "name": "reverse", "params": [{ "name": "head", "type": "Node" }], "returns": "Node" }
```

- Use the name like any other type: `Point`, `Point[]`, `Point[][]`, `list<Point>`, in method
  parameters and results, and in class mode's constructor and methods.
- Fields can be any type, other declared classes and the class itself included.
- **Java** gets public fields (`p.x`), a constructor taking every field in order, one taking
  none, getters (`getX()`, `isActive()` for a boolean) and `toString`. **Python** gets the same
  fields, each with a default, so `Node(3)` works. **JavaScript and TypeScript** get a class whose
  constructor takes every field, each with a default. **C++** gets a struct with a constructor
  taking every field and one taking none; an object is a pointer (`Node*`, `nullptr` for none).
  **C** gets a `typedef struct`, objects are pointers (`Node*`, `NULL`), and its fields can only be
  numbers, booleans, chars, strings and other classes. **Go** gets a struct with the same field
  names; an object is a pointer (`*Node`, `nil`). **Rust** gets a `pub struct` with `pub` fields and
  `new` taking every field; an object is `Option<Box<Node>>` (`None` for none), like LeetCode's
  `ListNode`. **C#** gets public fields and the two constructors, like Java.
- In tests, an object is a JSON object of its fields: `{ "x": 1, "y": 2 }`. Fields holding objects,
  arrays, lists or strings can be left out, and are then `null`:
  `{ "val": 1, "next": { "val": 2 } }` is the list 1, 2.
- Results compare field by field. A subclass with extra fields still matches.
- In the quiz maker, write classes one per line, like `Node(val: int, next: Node)`, and objects in
  tests like `Point(1, 2)` or `Node(1, Node(2))`.
- Names can't clash with Java's or Python's own classes (`String`, `List`, ...), JavaScript's
  (`Map`, `Date`, ...) when it's one of the languages, the question's class, or each other. At
  most 10 classes of 20 fields.

### What students write

- **Method mode, Java:** `class Solution { public <returns> <name>(<params>) { ... } }`
- **Method mode, Python:** `class Solution:` with `def <name>(self, <params>):`
- **Method mode, JavaScript and TypeScript:** a function, `function <name>(<params>) { ... }`
  (JavaScript's starter has a JSDoc comment with the types).
- **Method mode, C++:** `class Solution { public: <returns> <name>(<params>) { ... } };` with
  vectors and maps by reference (`vector<int>& nums`), like LeetCode.
- **Method mode, C:** a function. An array parameter comes with its length after it
  (`int* nums, int numsSize`), and a 2D one with its rows' lengths too (`int** grid, int gridSize,
  int* gridColSize`). A function that returns an array also takes `int* returnSize` and sets it
  (and `int** returnColumnSizes` for 2D). Arguments are on the heap, so code can change or free
  them. Returning `NULL` with `*returnSize` 0 counts as an empty array.
- **Method mode, Go:** a function, `func <name>(<params>) <returns> { ... }`. The `package main`
  line is optional; imports are theirs to add (Go refuses unused ones). A `nil` slice or map counts
  as an empty one.
- **Method mode, Rust:** `impl Solution { pub fn <name>(<params>) -> <returns> { ... } }`, like
  LeetCode. The usual collections (`HashMap`, `HashSet`, `VecDeque`, ...) are already in scope.
- **Method mode, C#:** `public class Solution { public <returns> <name>(<params>) { ... } }`. The
  usual namespaces are already there, and a `Main` of their own doesn't get in the way.
- **Class mode:** a class named `class.name` with that constructor and those methods. In
  Python the constructor is `__init__`. Go: a struct, a `New<Name>(...) *<Name>` function and
  methods on `*<Name>`. Rust: a struct with `fn new(...) -> Self` and methods. Not in C.

Java gets `java.util.*`, `java.util.function.*` and `java.util.stream.*` imported automatically.
C++ gets the usual standard headers and `using namespace std`; C gets `stdio.h`, `stdlib.h`,
`string.h`, `stdbool.h`, `math.h`, `limits.h`, `ctype.h` and `stdint.h`.

### Languages

Java and Python can do everything here. The others:

- **JavaScript** runs on Node 22. **TypeScript** too, with its types taken out first: it runs,
  but type errors aren't reported (there's no `tsc`).
- **C++** (g++, C++17) and **C** (gcc, C17) compile with `-O2`, **Go** with its standard compiler,
  and **Rust** (2021 edition) with `rustc`. **C#** compiles with .NET 10's
  compiler (latest C#). Each test runs in its own process, so a crash fails only
  that test, with a plain message (segmentation fault, a panic and its line, stack overflow). In C++
  an index out of range on a `vector` stops the program instead of reading garbage.
- Speed tests only run in Java, Python, JavaScript and TypeScript (an optimizing compiler times badly,
  and the others can reach into whatever times them).
- C has no maps, no class questions, and keeps 2D arrays to numbers, booleans and chars.
- In C, C++ and Go a `char` is one byte, so test values have to be plain ASCII. C++ and Rust have
  no `null` string, array or map (only an object can be `None`), and Go no `null` string,
  so tests can't use one (or leave out such a field of an object).
- A C# stack overflow stops the run, so the examples after it say so too.

The upload check says which of these a question runs into. With `"languages": "any"` it doesn't: the
languages that can't run the question are just left out (a map leaves out C, a speed test leaves the languages that have one and a reference). References are
optional per language there; tests' expected values come from the ones you give.

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

### Speed tests (O(log n), O(n), ...)

To require an efficient solution, add a speed test: a big input, called many times, that a
slow solution can't finish in time. Method mode only.

```json
{ "args": [{ "range": [0, 2000000, 2] }, 1999998], "speed": true, "calls": 1000, "weight": 2 }
```

- `{ "range": [start, stop, step] }` makes a big `int[]`, `long[]` or `list<int>` when the test
  runs: `start`, `start + step`, ... up to (not including) `stop`, like Python's `range`. `step`
  defaults to 1. At most 10,000,000 numbers. Keep Python questions to 1,000,000 or less.
- `"speed": true` times the calls, not making the input. `calls` (default 1, at most 100,000)
  calls the method that many times with the same arguments.
- At upload, the reference solution runs the test and students get 10 times its time in
  their language, never less than 100 ms. Correct but slower code fails that test with
  "Too slow". Speed tests need a reference solution in every allowed language.
- Pick sizes where the slow way takes seconds and the fast way milliseconds. For O(log n) vs
  O(n), search a million numbers a thousand times. For O(n log n) vs O(n²), sort 100,000
  numbers once.
- In the quiz maker, write `range(0, 2000000, 2)` as an argument and end the line with
  `speed x1000`.
- With `calls` over 1, every call gets the same arguments, so code can remember its first answer
  (or build a lookup table on the first call) and answer the rest instantly. A speed test checks
  that the code is fast enough, not how. To require a particular algorithm, add a rubric item for it
  or ban the shortcut.

### Scoring

The code part is worth `points` minus the rubric points. Students earn the share of hidden
test weight they pass. Rubric items with a check (below) grade themselves; the teacher ticks
the rest in the dashboard. Rubric points must total less than `points`.

### Banned methods

`"ban"` lists what a code question doesn't allow. Students see the list on the question, **Run
examples** tells them if their code uses one, and code that does scores 0 on the question (the
teacher can still adjust points).

- `"Class.method"`: that method of that class, like `"Arrays.sort"`, `"Math.max"` or `"math.sqrt"`;
  in JavaScript `"Array.sort"` or `"Math.max"`, in C++ `"std::sort"` or `"vector::push_back"`, in Go
  `"sort.Ints"` or `"strings.Contains"`, in C# `"Array.Sort"` or `"Enumerable.OrderBy"`, in Rust
  `"Vec.sort"`, `"Iterator.max"` or `"cmp.max"`
- `"method"`: a method or function of that name on anything, like `"sort"`, `"stream"`, `"sorted"`, `"qsort"`
- `"Name"`: a library class or package, like `"HashMap"` (Java), `"Map"` (JavaScript), `"map"` or
  `"priority_queue"` (C++), `"strings"` (Go), `"List"` or `"Linq"` (C#), `"BinaryHeap"` (Rust)

One list counts for every language the question has, so plain names (`["sort"]`) work everywhere. A
`"Class.method"` entry names something else in each language, so with C++, Go or C# and another
language, give the ban per language: `{ "java": ["Arrays.sort"], "cpp": ["sort"], "go": ["sort"] }`.
In Go and C# names match whatever their case (`"sort"` is also `Sort`).

The check reads what the compiler made of the code, not the text, before any student code runs: for
Java, the compiled classes; for Python, Python's own parser and symbol table; for C, the library
functions the student's compiled file calls; for C++, what each of the student's compiled functions
calls in the library; for Go, Go's own type checker; for C#, the compiled code's references; for
Rust, the compiler's MIR, where every call is written out as what it resolved to. So
comments, strings, spacing, unicode escapes, look-alike letters, full names (`java.util.Arrays.sort`),
static imports, macros, `using` declarations, method references, function pointers, lambdas,
generics, aliases (`s = sorted`, `import math as m`, `import s "sort"`) and f-strings are all covered,
and the student's own methods and variables (their own `max`, `self.count`) are theirs to use. In C and
C++ that covers calling a library function in any normal way; code that works out a function's address
from another one's gets past it.

JavaScript and TypeScript can't be read that way (`a["so" + "rt"]()` is a sort), so there the banned
builtins are tripwires instead: before the student's code loads, every library function of that name
(`Array.prototype.sort`, typed arrays' `sort`, ...) is swapped for one that does the same and notes the
call. However the name was written, a call counts, but only one that happens while the tests run (code
that never runs earns nothing either). A JavaScript entry has to be in its library, so the upload
refuses a typo like `"Sort"`.

A few entries also cover close relatives:

| Entry | Also catches |
| --- | --- |
| `"sort"`, `"Arrays.sort"` (Java) | `parallelSort` |
| `"Math.max"` and other `Math.*` (Java) | `StrictMath.max` |
| `"stream"` | anything in `java.util.stream` (`IntStream.of`, `s.chars()...`) |
| a class, like `"HashMap"` (Java) | its relatives in `java.util` (`LinkedHashMap`) |
| `"sort"` or `"sorted"` (Python) | each other, and `heapq` and `bisect` |
| `"math.sqrt"` and other `math.*` | `cmath.sqrt` |
| `"sort"` (JavaScript) | `toSorted` |
| `"sort"` (C) | `qsort` |
| `"sqrt"` and other C math functions | `sqrtf`, `sqrtl` |
| `"sort"` (C++) | `stable_sort`, `partial_sort`, `list::sort` and every other library sort |
| `"max"` (C++) | `max_element`, `minmax`, `fmax` |
| `"sort"` (Go) | the whole `sort` package, and `slices.Sort`, `SortFunc`, `SortStableFunc` |
| `"sort"` (C#) | `OrderBy`, `OrderByDescending`, `ThenBy` (LINQ, query syntax too) |
| `"Math.Max"` (C#) | `MathF.Max`, `int.Max` and the other number types' |
| `"sort"` (Rust) | `sort_unstable`, `sort_by`, `sort_by_key` and the rest |
| `"Vec.sort"` (Rust) | the slice's sorts (a `Vec` sorts as a slice) |
| `"max"` (Rust) | `max_by`, `max_by_key` |

A question with any ban also bans the ways around one: reflection in Java; `eval`, `exec`,
`getattr`, `__import__`, `importlib`, `pickle` and friends in Python; `dlsym` and friends in C and C++,
and in C++ inline `asm`, adding to `namespace std`, `#line` and `#include` of anything but a standard
header; `vm`, workers, `child_process`, the inspector and `process.binding` in JavaScript (each would
give the code a fresh set of builtins); `reflect`, `unsafe`, templates and `go:linkname` in Go;
reflection, `dynamic`, expression trees and `DllImport` in C#; `unsafe`, `include!`, `#[path]` and a
module from another file in Rust. In C, C++, C#, JavaScript and
TypeScript, `support` code counts as the student's, so keep banned names out of it. The reference solutions must keep to the bans, or the upload is refused.

Other library routes to the same answer aren't caught unless you list them. For a sorting
question, also think about `"PriorityQueue"`, `"TreeSet"`, `"TreeMap"` (`"set"`, `"map"`,
`"priority_queue"` in C++, `"SortedSet"` in C#; in JavaScript an object's integer keys come out in
order); for a max, `"Collections.max"` is caught by `"max"`
but `summaryStatistics` isn't; for a square root, `"Math.pow"`.

For a point off instead of a zero, use a rubric item with `"forbid"` (below).

### Rubric checks

A rubric item on a code question can grade itself with a regex:

- `"require"`: the code must match it
- `"forbid"`: the code must not match it

Use one pattern for every language, or `{ "java": "...", "python": "..." }`. Comments and
the inside of strings are removed before matching, so `// private` doesn't count. Patterns
match per line (`^` and `$` are line starts and ends) and are case-sensitive.

```json
"rubric": [
  { "text": "Uses private instance variables", "points": 1,
    "require": { "java": "\\bprivate\\s+[\\w<>\\[\\], ]+\\s+\\w+\\s*[;=]", "python": "self\\._\\w+\\s*=(?!=)" },
    "forbid": { "java": "\\bpublic\\s+(static\\s+)?(final\\s+)?[\\w<>\\[\\]]+\\s+\\w+\\s*[;=]", "python": "self\\.[a-zA-Z]\\w*\\s*=(?!=)" } },
  { "text": "Doesn't sort with a library call", "points": 1, "forbid": { "java": "Arrays\\.sort|Collections\\.sort", "python": "sorted\\(|\\.sort\\(" } }
]
```

- Checked items only give points to code that compiles and passes at least one hidden test.
  An empty class doesn't earn "doesn't use Arrays.sort".
- Every check must pass on the reference solutions, or the upload is refused.
- A language with no pattern leaves that item to the teacher. So does a written answer: checks
  only work on code questions.
- The teacher can still change any item in the dashboard. Once they save, their ticks count.

### Reference solutions

When you upload a quiz, each reference solution runs against every test:
- missing `expected` values are filled in from what the reference returns
- if a reference disagrees with an `expected` you wrote, the upload is refused, with the test named

Write references for every language you allow.
