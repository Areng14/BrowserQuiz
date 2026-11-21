# BrowserQuiz

**No more paper CS quizzes.**

BrowserQuiz is a quiz and exam app for computer science classes that you run yourself. Students write
real code in a real editor. The server runs it against hidden tests and grades it on the spot, and
everything stays on a machine you control.

- **Code is graded for real.** Java and Python run against hidden tests in a sandbox, with partial
  credit. Speed tests can even fail an O(n) answer to an O(log n) question.
- **It runs where you put it.** That can be a laptop, a box on the school network or a small VPS:
  setup is one Docker command, and everything lives in one database file. There's no account to make
  with anyone, and nothing in it calls out to the internet.
- **It's private.** Each teacher's quizzes are encrypted with their own key, student IDs are only
  stored as keyed hashes, and every file the app uses is served from your server: no CDNs, no
  analytics, no trackers.
- **It's hard to cheat on.** Answers never reach the student's browser, leaving the quiz window gets
  flagged quietly, and exams can require Safe Exam Browser.

## For students

- **Question types:**
  - multiple choice and select-all
  - short answer and predict the output
  - trace tables and fill in the blanks
  - written answers
  - code: a single method or a whole class
- **The editor:** the same one VS Code uses, with Java and Python highlighting. **Run examples**
  tries the code on the sample tests.
- **Help while working:**
  - a scratchpad for drawing and notes on each question
  - highlighting question text
  - mark for review and crossing out choices
- **Clear status:** a timer that turns red when time runs low, and answers that save as you go and
  survive a crashed computer.
- **Easy to use:** dark mode, and it works from the keyboard and with screen readers.

## For teachers

- **Making quizzes:**
  - a quiz maker with a live preview of the student's screen
  - Markdown, math (LaTeX), images, and shared material for several questions to use
  - or upload a `.quiz` file, or paste what an AI chat made from the built-in prompt
- **Grading:**
  - automatic for everything except written answers, including rubric checks on code ("uses a loop",
    "doesn't call `Arrays.sort`")
  - the rest is graded by hand with a rubric
- **During a quiz:** a live page shows who's waiting, working and done. From it you can:
  - admit students
  - give extra time
  - let someone back in after a crash
  - end someone's quiz
  - restore a student who was flagged
- **Afterwards:**
  - class reports, with each answer next to the correct one and a diff view for code
  - a CSV export
- **Practice mode:** no lockdown, and students see the answers when they finish.
- **More than one teacher:** each teacher only ever sees their own quizzes, classes and results.

## Security and privacy

### Answers stay on the server

- **What students get:** the questions, the sample tests and the starter code. Answers, hidden tests,
  reference solutions and rubrics never reach their browser.
- **The one exception:** practice mode's review after turning in shows answers and reference
  solutions, but still no hidden tests or rubrics.
- **Hidden tests:** the sandbox only gets the student's code and the inputs. Expected outputs stay on
  the server and are compared there, and saved results don't keep them either.

### Student code runs in a sandbox

Code runs in its own container. With Docker Compose, that container sits on a network with no way out
to the internet. Wherever it runs, each job:

- runs as its own user, and everything it started is killed when it's done
- can only write to its own job folder, so it can't touch other jobs or the system (Landlock)
- can't open network sockets, so it can't reach anything at all (seccomp, plus Landlock on newer
  kernels)
- has limits on CPU time, memory, processes, file size and run time

The runner checks its own sandbox when it starts, and refuses to run code if anything's missing.

### Quizzes are encrypted, even from whoever hosts it

- **How:** each teacher's quizzes and images are encrypted (AES-256-GCM) with a key that only their
  password or recovery code unlocks. The person running the server can't read them from the database
  or a backup.
- **Recovery code:** teachers see it once, when they first set their password. If they forget the
  password, an admin reset plus that code gets their quizzes back. Without either, nobody can open
  them, and they start over.
- **After a restart:** the key stays in the server's memory from sign-in until the server restarts.
  Until the teacher signs in again, their quizzes are locked: students see "your teacher needs to sign
  in", and their app keeps their answers and retries.
- **Not covered:**
  - Quiz titles, class lists and results (scores, and which answers were right) stay readable.
  - The server has to read a quiz to grade it, so a host who changes the server's code can get at a
    quiz while it's unlocked.
  - When admin's password comes from `.env` (`ADMIN_PASSWORD`), admin's quizzes are keyed off `.env`,
    which the host has anyway. With the one-time code instead, admin gets their own key too.

### Private by default

- **Your machine, your data.** Everything lives in one SQLite database on your server. Nothing is
  sent anywhere else, and the pages load nothing from other sites.
- **Student IDs** are stored as keyed hashes (HMAC with a secret from `.env`), never as plain text.
- **Teachers are walled off from each other.** Asking for another teacher's quiz, class, run or
  student gets "not found".
- **Sign-in:**
  - passwords are hashed with scrypt, and wrong guesses are throttled
  - session cookies are HttpOnly and SameSite=Strict, and requests from other sites are refused
  - pages run only the app's own scripts (CSP)
- **Wrong student IDs** lock a name for a moment, but only in the browser that typed them, so a
  classmate can't lock someone out.

## Run it

You need a machine with Docker. That can be your own computer with Docker Desktop, or a small Linux
VPS (2 GB RAM handles a class).

```bash
git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
```

Then run the setup script. On Windows, double-click `setup.cmd`. On Mac or Linux:

```bash
./setup.sh
```

The script:
- asks for a teacher password, or makes one up if you press Enter
- generates the other secrets into `.env`
- picks a free port
- builds and starts everything
- prints where to go

Run it again any time: it keeps what's already set.

To do it by hand instead: copy `.env.example` to `.env`, fill in the three secrets, then run
`docker compose up -d --build`.

If students can't reach it, open port 8080 in the server's firewall.

## Teachers

The first account is `admin` (leaving the username blank also means admin). There are two ways to set
it up:

- **A one-time code (recommended):** leave `ADMIN_PASSWORD` empty. The server prints a code to its log
  (`docker compose logs app`, or the deploy logs on Railway).
  - Sign in with it and you pick your own password straight away, then get a recovery code.
  - Admin's quizzes are then encrypted with admin's own key, like every teacher's.
  - Forgot the password later? Set `ADMIN_RESET` to any new word and restart. The log shows a new code,
    once, and your recovery code keeps your quizzes.
- **A password in `.env`:** set `ADMIN_PASSWORD` (the setup script does this). To change it, edit
  `.env` and run `docker compose up -d` again. That's also the way back in if you forget it.

To add teachers, open the **Teachers** tab. Each new teacher gets a temporary password to pass on, and
picks their own the first time they sign in.

- **Reset password** gives a teacher a new temporary password and signs them out.
- **Disable** stops someone signing in, and keeps their quizzes and results.

## Making quizzes and classes

- **Quizzes:** on the **Quizzes** tab, build them with **New quiz** or upload a `.quiz` file. Every
  quiz has **Preview**, which shows exactly what students see, lets you run code, and gives you the
  score.
- **Classes:** on the **Classes** tab, use **New class** and paste one student per line
  (`name, student ID`, or straight from a spreadsheet), or upload a CSV.
- **With an AI chat (ChatGPT, Claude, …):** click **Copy AI prompt** on the Quizzes tab, paste it into
  the chat, and fill in the blanks at the top.
  - AIs that can make files hand back a `.quiz` (images included) to upload.
  - Others give a `quiz.json`: upload it, or paste it under New quiz and add any images there.
- **With an AI coding assistant in this repo:** it follows `AGENTS.md` and the Claude Code skill. It
  writes the quiz, runs the reference solutions, and packs a `.quiz`.

The format is in [`docs/quiz-format.md`](docs/quiz-format.md). A `.quiz` file is a zip of a folder
holding `quiz.json` and an optional `assets/` folder.

To try the example, zip `examples/ap-csa-unit4` and upload it along with `examples/roster-demo.csv`
(Ava Martinez, ID 204511). To check a quiz before uploading, reference solutions included:

```bash
node scripts/check-quiz.mjs examples/ap-csa-unit4 --run
```

## Safe Exam Browser (optional)

[Safe Exam Browser](https://safeexambrowser.org) (SEB) is a free lockdown browser that keeps students
out of other apps. (Respondus LockDown Browser only works inside an LMS like Canvas, so BrowserQuiz
can't require it.)

1. Have SEB installed on the student computers. Installing it needs an administrator, so ask IT.
2. Open the dashboard at the address students use, since SEB opens the quiz there. Under
   **Give a quiz**, pick **Safe Exam Browser** and start it.
3. Students join with the code as usual and click **Open Safe Exam Browser**. If it isn't installed,
   the page links to SEB's download page. The quiz's page also has the SEB link and the `.seb` file,
   to post or hand out.

When students turn in, **Quit Safe Exam Browser** closes it.

Have your own settings from SEB Config Tool? Open **Use my own .seb file** and paste the Config Key.
It's on the Exam tab, with sending the Browser Exam Key and Config Key turned on. If you change those
settings, the Config Key changes too, so start the quiz with the new one.

## Do I just need the IP?

To try it, yes: anyone who can reach `<ip>:8080` can use it. For a real class, use a domain with
HTTPS:

1. Point a domain (or a free subdomain from something like DuckDNS) at the server.
2. In `.env`, set `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1` and `TRUST_PROXY=1`.
3. Open ports 80 and 443, then run `docker compose --profile https up -d --build`.

Caddy gets the certificate on its own. Why bother:
- Over plain HTTP, the teacher password and student IDs cross the network unencrypted.
- School filters often block bare IPs.
- Exam mode is stronger on HTTPS. Browsers only let an HTTPS page check for a second display, hold
  Alt+Tab and the Windows key during the quiz, and keep the screen from locking.

Where to host:

- **Off campus (a VPS):** it works from anywhere, and nobody at school has to run a server. The
  "only my network" lock matches the school's public IP.
- **A box on the school network:** fine too, but the lab PCs have to reach it, and IT usually has
  opinions about that. The network lock then accepts any private (10.x / 192.168.x) address.
- **Railway:** see [Hosting on Railway](#hosting-on-railway).

## Requirements

- **A kernel with Landlock** (Linux 5.13+). Any current distro works, and so does Docker Desktop on
  Windows. The runner checks its sandbox when it starts. If anything is missing it won't run code,
  and `docker compose logs runner` says why. Everything else still works.
- **Docker Compose v2** (`docker compose`, not `docker-compose`).

## Day to day

| Task | How |
| --- | --- |
| Update | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f app` |
| Wipe everything | `docker compose down -v` (deletes the data volume) |

Everything (quizzes, classes, attempts) lives in one SQLite database in the `bq-data` volume. Back it
up between classes:

```bash
docker compose stop app && docker compose cp app:/data ./backup-$(date +%F) && docker compose start app
```

Restore a backup:

```bash
docker compose stop app
docker compose cp ./backup-2026-11-20/. app:/data
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
```

Never change `ID_PEPPER` after you upload classes. Student IDs are stored as keyed hashes, so a new
pepper means no student can sign in.

Backups made before quiz encryption was added still hold plain copies of quizzes.

## Behind a TLS-intercepting proxy

If `npm ci` or `apt-get` fails during the build with certificate errors, pass the proxy's CA
certificate (just that one, not a whole bundle):

```bash
docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -f server/Dockerfile -t browserquiz-app .
docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -t browserquiz-runner runner
docker compose up -d --no-build
```

## Hosting on Railway

BrowserQuiz runs on [Railway](https://railway.com) as two services from this repo, with HTTPS on your
own domain:

| Service | Settings |
| --- | --- |
| `runner` | Root directory `/runner`. No public domain. Variables: `RUNNER_TOKEN=${{shared.RUNNER_TOKEN}}`, `PORT=8080`. |
| `app` | Dockerfile `server/Dockerfile`, a volume at `/data`, health check `/healthz`, your domain on port 8080. Variables: `ID_PEPPER` and `RUNNER_TOKEN` as `${{shared.…}}` references, `RUNNER_URL=http://${{runner.RAILWAY_PRIVATE_DOMAIN}}:8080`, `TRUST_PROXY=1`, `PORT=8080`. |

Put the two secrets in the project's **shared variables**, and get admin's one-time code from the app's
deploy logs. On Railway the runner's container can
reach the internet, unlike with Docker Compose. Student code still can't, because the sandbox blocks
network sockets.

## Layout

| Path | What |
| --- | --- |
| `server/` | Node app (no runtime dependencies, SQLite through `node:sqlite`) |
| `public/student/` | Student app: quiz screens, code editor, integrity monitor |
| `public/teacher/` | Teacher dashboard, quiz maker, reports |
| `runner/` | Code runner: Java 21 and Python 3 in the sandbox |
| `examples/` | Example quizzes and a class |
| `demo/` | Self-contained demo build with a mock server |
| `docs/` | Quiz format, security and accessibility reviews |

Design doc: https://claude.ai/artifact/84JVZVzV5oC2mkPbu9iLXZ
