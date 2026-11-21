# BrowserQuiz

**No more paper CS quizzes.**

A quiz and exam app for CS classes that you host yourself. Students write real code, the server grades
it against hidden tests, and your data never leaves your machine.

## Features

- **Real code questions.** Java and Python, hidden tests, partial credit, and speed tests that fail an
  O(n) answer to an O(log n) question.
- **8 question types.** Multiple choice, select-all, short answer, predict the output, trace tables, fill
  in the blanks, written answers and code.
- **Quiz maker.** Live preview, Markdown, LaTeX math, images. Or paste the built-in prompt into an AI
  chat and upload what it makes.
- **Live dashboard.** Admit students, give extra time, see who left and for how long, end a quiz.
- **Auto grading and reports.** Every answer next to the right one, with a diff view for code. Export to
  CSV.
- **Exam lockdown.** Full screen, leaving the window gets flagged quietly, and Safe Exam Browser is an
  option.
- **Student tools.** Scratchpad, highlighting, mark for review, cross out choices, dark mode. Works with
  a keyboard and screen readers.
- **Multiple teachers.** Each one only sees their own stuff.

## Secure and private

- Answers and hidden tests never reach students' browsers.
- Student code runs in a sandbox with no internet.
- Each teacher's quizzes are encrypted with their own key, so even whoever hosts it can't read them.
- No CDNs, no trackers. Student IDs are only stored hashed.
- Checked in 3 security reviews, including a live pentest.

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

- [Setup](docs/setup.md): hosting, HTTPS, Railway, Safe Exam Browser, accounts, backups
- [Security](docs/security.md): how it works, and what it can't do
- [Quiz format](docs/quiz-format.md): writing quizzes by hand or with AI
