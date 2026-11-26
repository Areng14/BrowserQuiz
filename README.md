# BrowserQuiz

A self-hosted quiz and exam app for CS and math classes.

## Features

- **Code questions.** Questions with a code editor with hints and snippets off.
- **10 question types.** Multiple choice, select-all, short answer, math, graphing, predict the output,
  trace tables, fill in the blanks, written answers and code.
- **Quiz maker.** Use the inbuilt quiz editor, or copy a prompt and let an AI do it for you.
- **Random values.** The numbers in a question can change for each student, and each one gets their own
  answer.
- **Question pools.** Each student gets a random few questions from a pool.
- **Timed parts.** Each part has its own clock, and the next one opens when time's up.
- **Live dashboard.** Start everyone at once, pause, give extra time, see who left and for how long, and
  watch any student's screen live.
- **Exam lockdown.** Full screen, and leaving the window gets flagged quietly. Safe Exam Browser works too.
- **Auto grading.** Every answer next to the right one, with a diff for code, and a CSV export. If a key
  was wrong, fix it and everyone gets regraded.
- **AI grading.** Paste a prompt into ChatGPT, Claude or Gemini, or add your own API key. Every grade
  comes with its reasons, and you can change any of them.
- **Copied code detection.** Flags students whose code is near-identical, even with renamed variables or
  different formatting.
- **Corrections.** After an exam, students redo what they missed and earn back points.
- **Calculator.** Turn on a scientific or graphing calculator for a quiz.
- **Student tools.** Scratchpad, highlighting, mark for review, cross out choices and dark mode. Works
  with a keyboard and screen readers.
- **Multiple teachers.** Each teacher only sees their own stuff.

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
