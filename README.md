# BrowserQuiz

A quiz and exam app for CS and math classes that teachers can host themselves. Students write real code
in the Monaco editor, type math and draw graphs, and each question type has its own options.

## Features

- **Real code questions.** A code editor with hints and snippets off.
- **10 question types.** Multiple choice to math, graphing and code. [Details below](#question-types).
- **Quiz maker.** The whole quiz on one page, every answer showing. Markdown, math, images, diagrams.
- **Write it with AI.** Paste the prompt into any AI chat for a whole quiz, or just one question.
- **Random values.** Numbers change per student, each with its own answer.
- **Question pools.** Each student gets a random few, so a neighbor's screen won't help.
- **Timed parts.** Each part gets its own clock, like the SAT.
- **Live dashboard.** Start everyone together, pause, add time, see who left, watch any screen live.
- **Exam lockdown.** Full screen, quiet flags for leaving, and Safe Exam Browser if you want it.
- **Auto grading.** Every answer next to the key, diffs for code, CSV export. Fix a key and everyone's regraded.
- **AI grading.** ChatGPT, Claude or Gemini, with reasons. You can change any grade.
- **Copied code detection.** Catches near-identical code, even renamed and reformatted.
- **Corrections.** Students redo what they missed and earn points back.
- **Calculator.** Scientific or graphing, when you turn it on.
- **Student tools.** Scratchpad, highlighter, mark for review, cross out, dark mode. Works with a keyboard
  and screen readers.
- **Multiple teachers.** Each sees only their own.

## Question types

- **Multiple choice.** One answer from a list of choices.
- **Select-all.** All or nothing, or partial credit if you choose.
- **Short answer.** Accept as many phrasings as you like, or a pattern like `/^(binary|bin) search$/`.
  Numbers match by value, so 3.5, 3.50 and 7/2 all count and formatting isn't an issue.
- **Math.** Students type the answer in a math box with fractions, powers and roots. Answers match as
  math, so 3 + 2x counts for 2x + 3, and you can ask for a form, like expanded or factored.
- **Graphing.** Students draw on a grid: points, lines, parabolas, absolute values, exponentials and
  circles, shaded for inequalities. Partial credit for systems, if you like.
- **Predict the output.** Show some code, students predict its output.
- **Trace tables.** Students fill in what the loop does to each variable, step by step, in a table.
- **Fill in the blanks.** Blanks right inside the code. Fill it out and check your work.
- **Written answers.** Free response with a rubric. Grade by hand or with AI.
- **Code.** Implement a method or an entire class. Supports Java, Python, JavaScript, TypeScript, C, C++, C#, Go and Rust. Like LeetCode, students can
  run some example test cases, and you can have hidden test cases to catch more. Plus speed tests,
  custom classes as parameters, banned methods, and a no-running mode for paper-style questions.

Any question can share material, a code block or an image with others, and every question gets its own
points. Prompts can show diagrams and graphs, in the student's light or dark colors.

## Security and privacy

- Answers and hidden tests never reach students' browsers.
- Students never find out they got flagged. Their screens look the same either way.
- Student code runs in its own sandbox on the server, with no internet.
- Each teacher's quizzes and students' data are encrypted with their own key, so even whoever hosts
  it can't read them.
- Five rounds of security testing.

The details are in [docs/security.md](docs/security.md).

## Quick start

**No install:** deploy your own copy on Railway (about $5 a month after the free trial).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/fMUAh_?referralCode=dP9ijG&utm_medium=integration&utm_source=button&utm_campaign=generic)

Pick a password (10+ characters) when it asks, wait about 10 minutes for the first build, then open the
`app` service's address and sign in at `/teacher` as `admin`. More in
[docs/setup.md](docs/setup.md#hosting-on-railway).

**On your own server:** you need Docker.

```bash
git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
```

Run the setup script: double-click `setup.cmd` on Windows, or on Mac and Linux:

```bash
./setup.sh
```

It prints the address to open. Sign in at `/teacher` as `admin`, with the password it gave you.

## Docs

- [Teacher onboarding](docs/onboarding.md): a walkthrough from first sign-in to grading
- [Hosting it at school](docs/school-hosting.md): running it free on a school server
- [Setup](docs/setup.md): hosting, HTTPS, Railway, Safe Exam Browser, AI grading keys, accounts, backups
- [Security](docs/security.md): how it works, and what it can't do
- [Quiz format](docs/quiz-format.md): writing quizzes by hand or with AI

## License

[MIT](LICENSE)
