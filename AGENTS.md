# BrowserQuiz: notes for AI assistants

A self-hosted quiz and CS exam app.
- Node server in `server/` (no runtime dependencies, SQLite through `node:sqlite`)
- Student app and teacher dashboard in `public/`
- Sandboxed Java/Python code runner in `runner/`
- Everything runs with Docker Compose; see `README.md`

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
