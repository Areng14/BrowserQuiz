# BrowserQuiz: notes for AI assistants

A self-hosted quiz and CS exam app.
- Node server in `server/` (no runtime dependencies, SQLite through `node:sqlite`)
- Student app and teacher dashboard in `public/`
- Sandboxed Java/Python code runner in `runner/`
- Everything runs with Docker Compose; see `docs/setup.md`

## Making quizzes

Follow `.claude/skills/make-quiz/SKILL.md`. The format spec is `docs/quiz-format.md`.
- Check: `node scripts/check-quiz.mjs <folder> --run`
- Pack: `node scripts/pack-quiz.mjs <folder> <out.quiz>`

Put quizzes in `quizzes/`, which is gitignored because quiz files contain answer keys.

## UI work

Follow `.claude/skills/arenguidesign/SKILL.md` for any UI you build or change, and check it
with screenshots before calling it done.

Never use the browser's `alert()`, `confirm()` or `prompt()`. Teacher pages use their own dialogs from
`public/teacher/ask.js` (`BQAsk.confirm`, `BQAsk.notice`, `BQAsk.ask`); the student app has its own modals.

## Rules

- Never commit `.env`: it holds the teacher password and secrets.
- Students must never learn their integrity status. API responses and screens look the same
  whether or not an attempt was invalidated, and student-facing reports leave it out.
- Answers, explanations, hidden tests, reference solutions and rubrics never go to the student's browser.
  The one exception is the practice review after submitting, which shows answers, explanations and
  reference solutions (still no hidden tests or rubrics).
- Keep UI copy short: no text that repeats what the screen already shows.
- No slogans or explainer lines under headings, buttons, fields or dialogs. Add one only when the point
  really can't be made by the UI itself.
- No pill statuses: no rounded badges or chips for a status. Show it as plain text.
- Teachers only reach their own quizzes, classes, runs and attempts. Every `/api/t/` route gets the
  teacher from `requireTeacher` and looks things up through them (`getQuizRow`, `getRoster`,
  `getRun`, `getAttemptRun`, or `owner_id = ?`), so another teacher's id is simply not found.
- Quizzes and quiz images are encrypted with their teacher's key (`server/src/vault.js`). Read them
  only through `store.getQuiz`, `store.getAsset` and `store.listAssets`, write them only through
  `saveQuiz`, and never `SELECT json` or `bytes` directly. Stored results never hold hidden tests'
  inputs or expected values (`store.storedResult`).
