# Quiz Lockdown

A hosted quiz and CS exam app. Teachers upload a `.quiz` file and a class
roster. Students take the quiz in a locked-down fullscreen page, the server
grades it, and anyone who leaves the window gets quietly invalidated.

- Answers, hidden tests and rubrics never leave the server
- Multiple choice, text, and code questions (Java and Python, LeetCode-style
  hidden test cases, single-method or whole-class)
- Code runs in a sandboxed runner (Landlock + seccomp + rlimits), tested on Railway

Design doc: https://claude.ai/artifact/84JVZVzV5oC2mkPbu9iLXZ

## Layout

| Path | What |
| --- | --- |
| `lib/zip.js` | Zero-dependency zip reader/writer for `.quiz` files |
| `lib/quiz-core.js` | Shared quiz logic (validation, grading, strike rules). First draft: still needs the rework from the design doc (integrity separate from status, silent responses, code questions) |
| `spikes/railway-runner/` | Probe that proved the code sandbox works on Railway |

## Status

Design is done. Next up: milestone 1 (core) and the code runner.
