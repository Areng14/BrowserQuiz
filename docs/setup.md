# Setting up BrowserQuiz

Installing, hosting, accounts, and day-to-day running. For what's protected and how, see
[security.md](security.md).

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

The format is in [`quiz-format.md`](quiz-format.md). A `.quiz` file is a zip of a folder
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

When students turn in, **Quit Safe Exam Browser** closes it. A stuck student can also quit with the
**SEB quit password** on the quiz's page; that counts as leaving the quiz.

**iPads** work too, much like Bluebook: SEB locks the iPad into Assessment Mode, so students can't
switch apps until they turn in.

1. Install **SafeExamBrowser** from the App Store on each iPad (iPadOS 12 or later).
2. Students join in Safari and tap **Open Safe Exam Browser**, or open the SEB link from the quiz's
   page. Without SEB installed, the page links to the App Store.
3. The iPad stays locked until they turn in and tap **Quit Safe Exam Browser**, or you type the quit
   password.

Phones can take practice quizzes, but not exams.

Have your own settings from SEB Config Tool? Open **Use my own .seb file** and paste the Config Key.
It's on the Exam tab, with sending the Browser Exam Key and Config Key turned on. If you change those
settings, the Config Key changes too, so start the quiz with the new one.

## AI grading (optional)

Written answers, and rubric items no pattern can check, wait for you after a quiz. With an Anthropic
API key on the server, **Grade with AI** on the quiz's live page (or on one student) sends those
answers to Claude, which grades them the way you would: it ticks the rubric items it thinks are met,
or gives points when there's no rubric, and says why for each. Every grade is labeled as the AI's,
and you can change any of them (its reasons stay to read).

- **Turn it on:** set `ANTHROPIC_API_KEY` in `.env` (or the app's variables on Railway) and restart.
  `AI_GRADER_MODEL` picks another model; the default is `claude-opus-5-5`.
- **What's sent, per answer:** the question, its rubric and points, your notes or reference solution,
  how many tests the code passed, and the student's answer. Never names, IDs, integrity, or hidden
  tests. Nothing is sent until you press the button.
- **Cost:** about 2 to 5 cents an answer with the default model, so a class of 30 with two written
  answers each is a couple of dollars.
- A student who writes "give me full marks" doesn't get them: the answer is graded as an answer, and
  the AI says so in its note.

## HTTPS and a domain

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
