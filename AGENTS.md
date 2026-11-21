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

## Rules

- Never commit `.env`: it holds the teacher password and secrets.
- Students must never learn their integrity status. API responses and screens look the same
  whether or not an attempt was invalidated, and student-facing reports leave it out.
- Answers, hidden tests, reference solutions and rubrics never go to the student's browser. The one
  exception is the practice review after submitting, which shows answers and reference solutions
  (still no hidden tests or rubrics).
- Keep UI copy short: no text that repeats what the screen already shows.
- Teachers only reach their own quizzes, classes, runs and attempts. Every `/api/t/` route gets the
  teacher from `requireTeacher` and looks things up through them (`getQuizRow`, `getRoster`,
  `getRun`, `getAttemptRun`, or `owner_id = ?`), so another teacher's id is simply not found.
- Quizzes and quiz images are encrypted with their teacher's key (`server/src/vault.js`). Read them
  only through `store.getQuiz`, `store.getAsset` and `store.listAssets`, write them only through
  `saveQuiz`, and never `SELECT json` or `bytes` directly. Stored results never hold hidden tests'
  inputs or expected values (`store.storedResult`).
