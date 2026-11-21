# BrowserQuiz

**No more paper CS quizzes.**

A quiz and exam app for CS classes that teachers can host themselves. Students can write real code in
the Monaco editor, with insane question customizability.

## Features

- **Real code questions.** Instead of having students write on paper, students write in a code editor
  that has code hints and snippets turned off.
- **8 question types.** Multiple choice, select-all, short answer, predict the output, trace tables, fill
  in the blanks, written answers and code. You can find the details in the
  [Question types](#question-types) section.
- **Quiz maker.** Live preview, Markdown, LaTeX math, images. Or paste the built-in prompt into an AI
  chat and upload the response.
- **Live dashboard.** Admit students, give extra time, see who left and for how long, end a quiz.
  Monitor any student's quiz page live, mouse and all.
- **Grade with AI.** Copy one prompt into ChatGPT, Claude or Gemini and paste the grades back, or drop
  in your own API key and it grades in the background. Every grade comes with its reasons, and you can
  change any of them.
- **Auto grading and reports.** Every answer next to the right one, with a diff view for code. Export to
  CSV.
- **Exam lockdown.** Full screen, leaving the window gets flagged quietly, and if that isn't safe
  enough, Safe Exam Browser is an option.
- **Student tools.** Scratchpad, highlighting, mark for review, cross out choices, dark mode. Bluebook
  style. Works with a keyboard and screen readers.
- **Multiple teachers.** Each one only sees their own stuff.

## Question types

- **Multiple choice.** You know what this is.
- **Select-all.** All or nothing, or partial credit if you choose.
- **Short answer.** Accept as many phrasings as you like, or a pattern like `/^(binary|bin) search$/`.
  Numbers match by value, so 3.5, 3.50 and 7/2 all count and formatting isn't an issue.
- **Predict the output.** Show some code, students predict its output.
- **Trace tables.** Students fill in what the loop does to each variable, step by step, in a table.
- **Fill in the blanks.** Blanks right inside the code. Fill it out and check your work.
- **Written answers.** Free response with a rubric. Grade by hand or with AI.
- **Code.** Implement a method or an entire class. Supports Java and Python. Like LeetCode, students can
  run some example test cases, and you can have hidden test cases to catch more. Plus speed tests,
  custom classes as parameters, banned methods, and a no-running mode for paper-style questions.

Any question can share material, a code block or an image with others, and every question gets its own
points.

## Secure and private

- Answers and hidden tests never reach students' browsers.
- Students never find out they got flagged. Their screens look the same either way.
- Student code runs in its own sandbox on the server, with no internet.
- Each teacher's quizzes are encrypted with their own key, so even whoever hosts it can't read them.
- Four rounds of AI pentesting. Everything they found got fixed or written up in
  [docs/security.md](docs/security.md).

The details are in [docs/security.md](docs/security.md).

## Quick start

You need Docker.

```bash
git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
```

Run the setup script: double-click `setup.cmd` on Windows, or on Mac and Linux:

```bash
./setup.sh
```

It prints the address to open. Sign in at `/teacher` as `admin`, with the password it gave you.

## Docs

- [Setup](docs/setup.md): hosting, HTTPS, Railway, Safe Exam Browser, AI grading keys, accounts, backups
- [Security](docs/security.md): how it works, and what it can't do
- [Quiz format](docs/quiz-format.md): writing quizzes by hand or with AI

## License

[MIT](LICENSE)
