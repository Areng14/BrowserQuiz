# BrowserQuiz

A quiz and CS exam app you host yourself. Teachers upload a `.quiz` file and a class
roster. Students take the quiz in a browser, the server grades it, and anyone who
leaves the window gets quietly invalidated (the teacher can restore them).

- Answers, hidden tests and rubrics never leave the server
- Multiple choice, select-all, short answer, and code questions (Java and Python,
  LeetCode-style hidden tests, single method or whole class, partial credit)
- Student code runs in a locked-down runner: its own uid, rlimits, Landlock and
  seccomp, on a Docker network with no internet

## Run it

You need a machine with Docker. That can be your own computer with Docker Desktop, or a small Linux VPS (2 GB RAM handles a class).

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

Doing it by hand instead: copy `.env.example` to `.env`, fill in the three secrets, then run `docker compose up -d --build`.

If students can't reach it, open port 8080 in the server's firewall.

## Teachers

Sign in as `admin` with the teacher password from setup (`ADMIN_PASSWORD` in `.env`; leaving the
username blank also means admin). To add teachers, go to **Teachers** at the bottom of the
dashboard. Each new teacher gets a temporary password to pass on, and picks their own the first
time they sign in. Each teacher sees only their own quizzes, classes and results.

- **Reset password** gives a teacher a new temporary password and signs them out.
- **Disable** stops someone signing in, and keeps their quizzes and results.
- The admin password lives in `.env`. To change it, edit `.env` and run `docker compose up -d`
  again. That's also the way back in if you forget it.

## Making quizzes and classes

- **Quizzes:** build them on the dashboard with **New quiz**, or upload a `.quiz` file. Every quiz
  has **Preview**, which shows exactly what students see, lets you run code, and gives you the score.
- **Classes:** use **New class** and paste one student per line (`name, student ID`, or straight
  from a spreadsheet), or upload a CSV.
- **With an AI chat (ChatGPT, Claude, …):** click **AI prompt** next to New quiz, fill in the blanks
  at the top, and paste it into the chat. AIs that can make files hand back a `.quiz` (images
  included) to upload. Others give a `quiz.json`: upload it, or paste it under New quiz and add
  any images there.
- **With an AI coding assistant in this repo:** it follows `AGENTS.md` and the Claude Code skill.
  It writes the quiz, runs the reference solutions, and packs a `.quiz`.

The format is in `docs/quiz-format.md`. A `.quiz` file is a zip of a folder holding `quiz.json`
and an optional `assets/` folder. To try the example, zip `examples/ap-csa-unit4` and upload it
along with `examples/roster-demo.csv` (Ava Martinez, ID 204511). To check a quiz, with its
reference solutions, before uploading:

```bash
node scripts/check-quiz.mjs examples/ap-csa-unit4 --run
```

## Do I just need the IP?

To try it, yes: anyone who can reach `<ip>:8080` can use it. For a real class, use a
domain with HTTPS:

1. Point a domain (or a free subdomain from something like DuckDNS) at the server.
2. In `.env`, set `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1` and `TRUST_PROXY=1`.
3. Open ports 80 and 443, then run `docker compose --profile https up -d --build`.

Caddy gets the certificate on its own. Why bother: over plain HTTP, the teacher
password and student IDs cross the network unencrypted. Also, school filters often
block bare IPs, and some browser features only work on HTTPS pages.

Where to host:

- **Off campus (a VPS):** works from anywhere, and nobody at school has to run a
  server. The "only allow students on this network" lock matches the school's public
  IP.
- **A box on the school network:** fine too, but the lab PCs have to reach it, and
  IT usually has opinions about that. The network lock then accepts any private
  (10.x / 192.168.x) address.
- **Railway and similar:** the runner sandbox was tested there. The compose file is
  for plain Docker hosts, though.

## Requirements

- **A kernel with Landlock** (Linux 5.13+). Any current distro works, and so does Docker Desktop on Windows.
  The runner checks its sandbox when it starts. If anything is missing it won't run code, and
  `docker compose logs runner` says why. Everything else still works.
- Docker Compose v2 (`docker compose`, not `docker-compose`).

## Day to day

| Task | How |
| --- | --- |
| Update | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f app` |
| Wipe everything | `docker compose down -v` (deletes the data volume) |

Everything (quizzes, rosters, attempts) lives in one SQLite database in the `bq-data`
volume. Back it up between classes:

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

Never change `ID_PEPPER` after you upload rosters. Student IDs are stored as keyed
hashes, so a new pepper means no student can sign in.

## Behind a TLS-intercepting proxy

If `npm ci` or `apt-get` fails during the build with certificate errors, pass the
proxy's CA:

```bash
docker build --secret id=extra_ca,src=/path/to/ca.crt -f server/Dockerfile -t browserquiz-app .
docker build --secret id=extra_ca,src=/path/to/ca.crt -t browserquiz-runner runner
docker compose up -d --no-build
```

## Layout

| Path | What |
| --- | --- |
| `server/` | Node app (no runtime dependencies, SQLite through `node:sqlite`) |
| `public/student/` | Student app: integrity monitor, Monaco editor, quiz UI |
| `public/teacher/` | Teacher dashboard |
| `runner/` | Code runner: Java 21 + Python 3 in the sandbox |
| `examples/` | Example quiz and roster |
| `demo/` | Self-contained demo build with a mock server |
| `docs/` | Security review |

Design doc: https://claude.ai/artifact/84JVZVzV5oC2mkPbu9iLXZ
