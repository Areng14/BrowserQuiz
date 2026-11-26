# BrowserQuiz

A self-hosted quiz and exam app for CS and math classes.

## Features

- **Code questions.** A code editor with hints and snippets off.
- **10 question types.** Multiple choice, select-all, short answer, math, graphing, predict the output,
  trace tables, fill in the blanks, written answers and code.
- **Quiz maker.** Every question on one page with its answer. Markdown, math, images and diagrams.
- **AI prompts.** For a whole quiz, or for one question.
- **Random values.** Numbers that change per student.
- **Question pools.** A random set of questions per student.
- **Timed parts.** A clock for each part.
- **Live dashboard.** Start, pause, extra time, who left and for how long, and each student's screen live.
- **Exam lockdown.** Full screen, flags for leaving the window, Safe Exam Browser.
- **Auto grading.** Answers next to the key, code diffs, CSV export, regrading after a key fix.
- **AI grading.** ChatGPT, Claude or Gemini, with a reason for each grade.
- **Copied code detection.** Near-identical code, even renamed or reformatted.
- **Corrections.** Students redo what they missed for points back.
- **Calculator.** Scientific or graphing.
- **Student tools.** Scratchpad, highlighter, mark for review, cross out, dark mode, keyboard and screen
  reader support.
- **Multiple teachers.** Each with their own quizzes and classes.

## Question types

- **Multiple choice.** One correct choice.
- **Select-all.** Several correct choices: all or nothing, or partial credit.
- **Short answer.** A list of accepted answers, or a pattern like `/^(binary|bin) search$/`. Numbers match
  by value (3.5, 3.50, 7/2).
- **Math.** Typed in a math box and matched as math (3 + 2x for 2x + 3), optionally in a set form, like
  expanded or factored.
- **Graphing.** Drawn on a grid: points, lines, parabolas, absolute values, exponentials, circles and
  inequalities.
- **Predict the output.** What a piece of code prints.
- **Trace tables.** Each variable's value, step by step.
- **Fill in the blanks.** Blanks inside code.
- **Written answers.** Free response with a rubric, graded by hand or with AI.
- **Code.** A method or a class in Java, Python, JavaScript, TypeScript, C, C++, C#, Go or Rust, graded by
  hidden tests. Sample tests, speed tests, custom classes, banned methods and a no-run mode.

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
