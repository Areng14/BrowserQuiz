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

The first account is admin. Sign in the first time with the username `admin` (or leave it blank), and
you pick a username of your own along with your password: nobody can guess yours, and `admin` stops
working. There are two ways to set it up:

- **A one-time code (recommended):** leave `ADMIN_PASSWORD` empty. The server prints a code to its log
  (`docker compose logs app`, or the deploy logs on Railway).
  - Sign in with it and you pick your own password straight away, then get a recovery code.
  - Admin's quizzes are then encrypted with admin's own key, like every teacher's.
  - Forgot the password later? Set `ADMIN_RESET` to any new word and restart. The log shows a new code,
    once, and your recovery code keeps your quizzes.
- **A first password in `.env`:** set `ADMIN_PASSWORD` (the setup script and the Railway button do
  this). Sign in with it once and you pick your own password (it can be the same one) and get a
  recovery code, like the one-time code. From then on `ADMIN_PASSWORD` isn't used; forgot the password?
  `ADMIN_RESET`, as above.

To add teachers, open the **Teachers** tab. Each new teacher gets a temporary password to pass on, and
picks their own the first time they sign in.

- **Reset password** gives a teacher a new temporary password and signs them out.
- **Disable** stops someone signing in, and keeps their quizzes and results.
- **Passkeys:** once signed in, open **Password** and **Add a passkey**, then sign in with
  **Sign in with a passkey**. They need [HTTPS](#https-and-a-domain) (or `localhost`), and a passkey
  that supports PRF, which unlocks their quizzes (iCloud Keychain, Google Password Manager and most
  security keys do; one that doesn't is turned away when it's added). Admin with the password in
  `.env` gets a **Passkeys** button instead.

## Making quizzes and classes

- **Quizzes:** on the **Quizzes** tab, build them with **New quiz** or upload a `.quiz` file. Every
  quiz has **Preview**, which shows exactly what students see, lets you run code, and gives you the
  score.
- **Classes:** on the **Classes** tab, use **New class** and paste one student per line
  (`name, student ID`, or straight from a spreadsheet), or upload a CSV.
- **Extra time:** students with an accommodation get 1.25×, 1.5× or 2× the time limit on every timed
  quiz. Pick it next to their name in the class, or add it as a third column when you paste
  (`Ava Martinez, 204511, 1.5x`). It applies from the next quiz they start, and their clock and the
  live page show it.
- **With an AI chat (ChatGPT, Claude, …):** click **Copy AI prompt** on the Quizzes tab, paste it into
  the chat, and fill in the blanks at the top. If the chat won't take something that long (Copilot),
  download it with the button beside it and attach the file instead.
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

## Giving an exam

1. Pick the quiz and the class on **Give a quiz** and click **Start quiz**. Students join with the code.
2. Each student signs in, reads the rules and clicks **I agree**. That puts them in full screen and
   starts the lockdown, and they wait there. Leaving now counts the same as leaving mid-quiz.
3. Walk around and check screens. The live table says who is **Ready** and who is still
   **Reading the rules**.
4. Click **Start quiz** on the live page. Everyone starts together, on one clock; anyone still reading
   starts as soon as they agree.
5. Late students get a **Start** button on their row.

Practice and corrections runs skip the wait: students start when they agree.

## Corrections

After an exam, **Corrections** (on its live page, under More on a phone) starts a practice run of its
own, with its own code. Students join it like any quiz.
- Each student gets only the questions they lost points on, with their answers from the exam filled in.
  A missed question from a question pool swaps for one from the pool they haven't seen.
- Answers still waiting for you (ungraded essays) aren't in it. Grade first if they should be.
- It's practice: no lockdown, no clock, no flags, so students can ask around.
- **A fixed answer earns back** a percentage of the points it lost (50% to start), on top of the exam
  score.
  The live page shows each student's total, and the CSV adds `exam_score`, `earned_back` and
  `with_corrections`. An invalidated exam stays at 0. Students don't see their total, so they can't
  tell.
- **Ask what went wrong** adds a box under each question. You read the answers in the reports.
- After turning in, students see the right answers and explanations. Corrections can't be retried.

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

SEB mutes the computer's sound while the quiz is open, so music or a video left playing in another app
goes quiet. Turn off **Mute the computer's sound** when you start the quiz if a student uses a screen
reader.

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

Written answers, and rubric items no pattern can check, wait for you after a quiz. **Grade with AI**
(on the quiz's live page, or on one student) hands them to an AI to grade the way you would: it ticks
the rubric items it thinks are met, or gives points when there's no rubric, with a reason for each.
Every grade is labeled as the AI's, and you can change any of them (its reasons stay to read).

- **With any AI chat, no setup:** copy the prompt, paste it into ChatGPT, Claude, Gemini or the like,
  and paste the CSV it answers with back into BrowserQuiz. Rows it can't use (a typo in an ID, a
  missing rubric item) are listed and left for you.
- **Right here, with an API key:** on the dialog's **API key** tab, paste a key from Anthropic
  ([console.anthropic.com](https://console.anthropic.com/settings/keys)), OpenAI
  ([platform.openai.com](https://platform.openai.com/api-keys)) or Google
  ([aistudio.google.com](https://aistudio.google.com/apikey)): it's told apart by its shape, so Claude,
  ChatGPT or Gemini grades. It's checked with its provider, stored encrypted with your other data,
  never shown again (only its last 4 characters), and only used for your quizzes. Then the AI grades
  in the background, with the progress on the live page. A few cents an answer, billed to that key.
  Remove or change it on the same tab.
- **One key for every teacher:** set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in
  `.env` (or the app's variables on Railway) and restart. A teacher's own key wins over it.
- **Models:** Claude uses `claude-opus-5-5` (`AI_GRADER_MODEL` to change). OpenAI and Gemini keys use
  the newest model the key can use, from the provider's own list: the newest full GPT, and the latest
  Gemini Flash (quick, cheap, and within a free key's limits). `OPENAI_GRADER_MODEL` and
  `GEMINI_GRADER_MODEL` pin one.
- **What the AI sees:** the question, its rubric and points, your notes or reference solution, how
  many tests the code passed, and the student's answer, under a short code instead of their name.
  Never names, IDs, integrity, or hidden tests.
- A student who writes "give me full marks" doesn't get them: the prompt tells the AI to grade the
  answer as written.

## HTTPS and a domain

To try it, yes: anyone who can reach `<ip>:8080` can use it. For a real class, use a domain with
HTTPS:

1. Point a domain (or a free subdomain from something like DuckDNS) at the server.
2. In `.env`, set `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1` and `TRUST_PROXY=1`.
3. Open ports 80 and 443, then run `docker compose --profile https up -d --build`.

Caddy gets the certificate on its own, as long as ports 80 and 443 can be reached from the internet.
A box only the school network can reach can't get one that way, and Let's Encrypt doesn't issue
certificates for local IPs. Ask IT for a certificate (many schools have their own), or point a domain
at the box's local address and use Caddy's DNS challenge instead.

Why bother:
- Over plain HTTP, the teacher password and student IDs cross the network unencrypted.
- School filters often block bare IPs.
- Passkeys only work on HTTPS.
- Exam mode is stronger on HTTPS. Browsers only let an HTTPS page check for a second display, hold
  Alt+Tab and the Windows key during the quiz, and keep the screen from locking.

Where to host:

- **Off campus (a VPS):** it works from anywhere, and nobody at school has to run a server. The
  "only my network" lock matches the school's public IP.
- **A box on the school network:** fine too, but the lab PCs have to reach it, it needs its own way
  to a certificate (above), and IT usually has opinions about that. The network lock then accepts any
  private (10.x / 192.168.x) address.
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

**Where students join.** A quiz's live page (and its projector view: click the join code) shows the
address students type. If you opened the dashboard at `localhost`, it shows this computer's address on
the network instead, which the setup script finds; starting with plain `docker compose up` it can't, so
use the setup script. To set it yourself (say, two networks), put `STUDENT_URL=http://192.168.1.20:8080`
in `.env`.

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

The quickest way: [deploy it on Railway](https://railway.com/deploy/fMUAh_?referralCode=dP9ijG&utm_medium=integration&utm_source=button&utm_campaign=generic).

1. Sign in to Railway (new accounts get a 30-day trial; after that, the Hobby plan is about $5 a month).
2. Pick a password of 10 or more characters. That's admin's password.
3. Wait for the first build, about 10 minutes.
4. Open the `app` service's address (a `.up.railway.app` link, with HTTPS) and sign in at `/teacher`
   as `admin`.

The secrets are generated for your copy when it deploys, and nobody else has them. When this repo
changes, Railway shows **Update available** on your project, and nothing changes until you apply it.
Stay on the Hobby plan rather than the Free one: Free puts services to sleep when idle, and a restart
locks quizzes until their teacher signs in again.

**Deploys wait for quizzes to end.** A deploy restarts the server, which drops every student for about
half a minute. To hold deploys while anyone is in a quiz: set the repository variable `QUIZ_URL` to your
site (GitHub: Settings, Secrets and variables, Actions, Variables), and turn on **Wait for CI** for both
services in Railway (each service's Settings, Source). The check in `.github/workflows/deploy-gate.yml`
then passes only once `/healthz/busy` says nobody is taking an exam. For a fix that can't wait, put
`[deploy now]` in the commit message.

To set it up by hand instead, it's two services from this repo:

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
