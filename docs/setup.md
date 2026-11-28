# Setting up BrowserQuiz

Teaching with it rather than installing it? Read [onboarding.md](onboarding.md) instead. How BrowserQuiz protects quizzes and student data is in [security.md](security.md).

## Installing BrowserQuiz

Putting it on a school server? Follow [school-hosting.md](school-hosting.md) instead.

You need a computer with Docker: your own computer with Docker Desktop, or a small Linux server. 2 GB of RAM is enough for a class, and 4 GB is recommended.

1. Get BrowserQuiz and run the setup script:

   ```bash
   git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
   ./setup.sh
   ```

   On Windows, double-click `setup.cmd` instead of running `./setup.sh`.
2. Type an admin password, or press Enter to have it make one up.
3. Pick what students write code in ([Languages](#languages)).
4. Open the address it prints.
5. If students cannot reach it, open that port in the server's firewall. The default is 8080.

The script checks your computer first. It creates the other secrets in `.env`, picks a free port, downloads BrowserQuiz and starts it. You can run it again at any time: it keeps everything that is already set. If the download is blocked, it builds BrowserQuiz on your computer instead, which takes 10 minutes or more the first time.

**Requirements.** Docker Compose v2 (the `docker compose` command) and Linux 5.13 or newer on a 64-bit processor. Any current Linux and Docker Desktop already have them. The setup script checks these first, along with the memory, the free disk on a Linux server and whether it can download. If it can't go on, it stops before downloading anything. On an older Linux, code questions will not run but everything else works, and `docker compose logs runner` says why.

**Doing it by hand.** Copy `.env.example` to `.env`, fill in the three secrets, then run `docker compose pull && docker compose up -d`.

## Languages

The code runner comes in two kinds:

| `RUNNER_LANGS` | Languages | Download |
| --- | --- | --- |
| `standard` (the default) | Java, Python, JavaScript, TypeScript | about 150 MB |
| `full` | those, and C, C++, C#, Go, Rust | about 700 MB |

The setup script asks which one the first time. To change it later, run `./setup.sh --languages` (on Windows, `setup.cmd -Languages`). On Railway, add the variable `RUNNER_LANGS=full` to the `runner` service and redeploy it. The quiz maker only offers the languages the runner has. A quiz that needs another one says so when you save it.

**Several classes writing code at once.** The app itself keeps up with a couple of thousand students. Grading code is what takes time. Each hidden test runs the student's code on its own, and an answer in a compiled language is built once for all its tests. The runner does a few runs at a time. When it falls behind, grading still finishes on its own, only later. A student's **Run examples** always goes ahead of grading.

| Variable | Service | Default | |
| --- | --- | --- | --- |
| `RUNNER_SLOTS` | runner | 4 | Runs at the same time: about one per CPU the runner has |
| `RUNNER_CONCURRENCY` | app | 4 | The same number as `RUNNER_SLOTS` (with Docker, it's set from it) |
| `RUNNER_CPUS`, `RUNNER_MEMORY` | runner, Docker only (`.env`) | 2, `2g` | What the runner may use |

For a few classes coding at the same time, 8 CPUs and 8 slots grade about four times as fast as the default. On Railway, set `RUNNER_SLOTS=8` on the runner and `RUNNER_CONCURRENCY=8` on the app.

## Setting up accounts

**Admin.** The first account is admin.

1. Sign in at `/teacher` with the username `admin` and the password from the setup script.
2. Pick your own username and password.
3. Save the recovery code it gives you somewhere safe. It is the only way back into your quizzes if you forget your password.

After this, `admin` no longer works as a username.

- To keep the password out of `.env`, leave `ADMIN_PASSWORD` empty. The server then prints a one-time code to its log (`docker compose logs app`). Sign in with that instead.
- Forgot the admin password? Set `ADMIN_RESET` in `.env` to any new word and restart the server. The log shows a new one-time code, and your recovery code gets your quizzes back.

**Teachers.** To add a teacher, open **Teachers** from the menu under your name. Each teacher gets a temporary password. Pass it on. They pick their own the first time they sign in.

- **Reset password** gives the teacher a new temporary password and signs them out.
- **Disable** stops the teacher from signing in, but keeps their quizzes and results.

**Passkeys.** Teachers add them in **Settings**, under **Passkeys**, to sign in with a fingerprint, face or PIN instead of a password. Passkeys need HTTPS, and a passkey from iCloud Keychain, Google Password Manager or most security keys. A passkey that cannot unlock quizzes is turned away when it is added.

## HTTPS and where to host it

Plain `http://` is fine for trying it out. For real classes, HTTPS is recommended:

- Passwords and student IDs are encrypted when they are sent.
- Passkeys work.
- Exam mode is stronger, since browsers only let an HTTPS site check for a second monitor, block `ALT + TAB` and `WIN`, and keep the screen from locking.
- School web filters often block plain IP addresses.

If you have a domain pointed at the server and ports 80 and 443 open to the internet:

1. In `.env`, set `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1` and `TRUST_PROXY=1`.
2. Run `docker compose --profile https up -d`.

The certificate is set up and renewed automatically. A server that can only be reached from the school network cannot get a certificate this way. Use your school's own certificate instead, as shown in [school-hosting.md](school-hosting.md#https).

**Where to host it.**

- **A rented server off campus.** Works from anywhere, and nobody at school has to run anything.
- **A school server.** Follow [school-hosting.md](school-hosting.md).
- **Railway.** See [Hosting on Railway](#hosting-on-railway) below.

The teacher's **Only students on my current network** option matches the school's public address on an off-campus server, and any private address (10.x, 192.168.x) on a school server.

## Safe Exam Browser

[Safe Exam Browser](https://safeexambrowser.org) (SEB) is a free browser that locks down the whole computer during an exam. It is optional. Respondus LockDown Browser only works inside an LMS like Canvas, so BrowserQuiz cannot use it.

1. Install SEB on the student computers. This needs an administrator.
2. Open the dashboard at the address students use. That is where SEB will open the quiz.
3. On **Give a quiz**, pick **Safe Exam Browser** and start it.
4. Students join with the code as usual and click **Open Safe Exam Browser**. If SEB is not installed, the page links to its download.

The quiz's page also has the SEB link and the `.seb` file, if you want to post or hand them out.

**Things to know.**

- **Sound.** SEB mutes the computer while the quiz is open. If a student uses a screen reader, turn off **Mute the computer's sound** when you start the quiz.
- **Leaving the window.** There is nothing else to switch to in SEB, so the quiz losing focus (SEB's own toolbar, a notification) never counts against a student, and there is no **Exit** button. Time away still shows on the live page.
- **Quitting.** After turning in, **Quit Safe Exam Browser** closes it. A stuck student can quit with the **SEB quit password** on the quiz's page (hover over it to see it). This counts as leaving the quiz.
- **iPads.** Install **SafeExamBrowser** from the App Store (iPadOS 12 or later). Students join in Safari and tap **Open Safe Exam Browser**. The iPad stays locked until they turn in.
- **Phones.** Phones can take practice quizzes, but not exams.
- **Your own SEB settings.** If you made your own settings in SEB Config Tool, open **Use my own .seb file** and paste its Config Key. The key is on the Exam tab, with sending the Browser Exam Key and Config Key turned on. Changing those settings changes the key, so start the quiz again with the new key.

## AI grading

After a quiz, written answers and rubric items that cannot be checked automatically wait for the teacher. **Grade with AI** (on the quiz's live page, or on one student) grades them. It ticks the rubric items it thinks are met, or gives points if there is no rubric, with a reason for each one. Every AI grade is labeled, and you can change any of them.

There are two ways to use it:

- **Any AI chat, no setup.** Copy the prompt into ChatGPT, Claude, Gemini or similar, then paste the CSV it gives back into BrowserQuiz. Any rows it cannot use (like a typo in an ID) are listed and left for you.
- **With an API key.** On the dialog's **API key** tab, paste a key from [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys) or [Google](https://aistudio.google.com/apikey). The AI then grades in the background, and the live page shows its progress. It costs a few cents an answer, billed to that key. The key is stored encrypted, only used for your quizzes, and never shown again (only its last 4 characters).

**One key for every teacher.** Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env` and restart. If a teacher adds their own key, theirs is used instead.

**Which model.** Claude keys use `claude-opus-5-5`, which you can change with `AI_GRADER_MODEL`. OpenAI and Gemini keys use the newest model the key can use: the newest full GPT, and the latest Gemini Flash (fast, cheap, and within a free key's limits). `OPENAI_GRADER_MODEL` and `GEMINI_GRADER_MODEL` pin a specific one.

**What the AI sees.** The question, its rubric and points, your notes or reference solution, how many tests the code passed, and the student's answer under a short code instead of their name. It never sees names, IDs, integrity or hidden tests. A student who writes "give me full marks" will not get them.

## Quizzes, classes and corrections

For making and giving quizzes, see [onboarding.md](onboarding.md).

- **Quiz files.** A `.quiz` file is a zip of a folder with `quiz.json` and an optional `assets/` folder for images. The format is in [quiz-format.md](quiz-format.md).
- **Trying the example.** Zip `examples/sample-exam` and upload it, then upload `examples/roster-demo.csv` as a class (Ava Martinez, ID 204511).
- **Checking a quiz before uploading.** Run `node scripts/check-quiz.mjs examples/sample-exam --run`. It checks the quiz and runs its reference solutions.
- **AI coding assistants.** Assistants working in this repo follow `AGENTS.md`. They write the quiz, run the reference solutions and pack the `.quiz` for you.
- **Extra time.** 1.25×, 1.5× or 2× applies from the next quiz the student starts.
- **Corrections.** By default a fixed answer earns back 50% of the points it lost, on top of the exam score. The CSV adds `exam_score`, `earned_back` and `with_corrections`. An invalidated exam stays at 0, and students never see their total. Answers still waiting to be graded are not in corrections, so grade those first.

## Updates, backups and logs

| Task | How |
| --- | --- |
| Update | `git pull && ./setup.sh`, when no quiz is running. On Railway, apply **Update available** on your project. The Server page says when there's a newer version. |
| Logs | `docker compose logs -f app` |
| Wipe everything | `docker compose down -v` (deletes all the data) |

Everything (quizzes, classes and results) is stored in one database in the `bq-data` volume. It backs itself up every night around 2:00 (never during a quiz) and keeps the last 7. On the **Server** page (admin only, in the menu under your name) you can back up now, download a backup, and restore one from the list or from a downloaded file. A restore keeps a copy of what it replaced, then restarts the server.

- The nightly backups sit on the same disk as the data. Download one now and then and keep it somewhere else. To copy them all off without signing in: `docker compose cp app:/data/backups ./backups`
- **Never change `ID_PEPPER`** in `.env` once classes are added. Student IDs are scrambled with it, so changing it means no student can sign in.
- Backups made before quiz encryption was added still have readable copies of quizzes.

**Where students join.** A quiz's live page (and its projector view, which you get by clicking the join code) shows the address students type. If you opened the dashboard at `localhost`, it shows this computer's network address instead, which the setup script finds. If you started it without the setup script, or the server is on two networks, put `STUDENT_URL=http://192.168.1.20:8080` in `.env`.

## Hosting on Railway

To skip installing anything, [deploy it on Railway](https://railway.com/deploy/fMUAh_?referralCode=dP9ijG&utm_medium=integration&utm_source=button&utm_campaign=generic). New accounts get a 30-day trial. After that, the Hobby plan is about $5 a month.

1. Sign in to Railway.
2. Pick an admin password with 10 or more characters.
3. Wait a few minutes for the first build.
4. Open the `app` service's address (a `.up.railway.app` link, with HTTPS) and sign in at `/teacher` as `admin`.

Your copy gets its own secrets that nobody else has. When this repo changes, Railway shows **Update available**. Nothing changes until you apply it. Stay on the Hobby plan, not the Free one: Free puts the app to sleep, and after every restart teachers have to sign in again before their quizzes work.

**Holding updates while a quiz is running.** An update restarts the server, which drops every student for about half a minute. To make updates wait until nobody is in an exam:

1. On GitHub, set the repository variable `QUIZ_URL` to your site (Settings, Secrets and variables, Actions, Variables).
2. In Railway, turn on **Wait for CI** for both services (each service's Settings, Source).

If a fix cannot wait, put `[deploy now]` in the commit message.

**Setting it up by hand.** You need two services from this repo:

| Service | Settings |
| --- | --- |
| `runner` | Root directory `/runner`. No public domain. Variables: `RUNNER_TOKEN=${{shared.RUNNER_TOKEN}}`, `PORT=8080`, and `RUNNER_LANGS=full` for all nine languages ([Languages](#languages)). |
| `app` | A volume at `/data`, health check `/healthz`, your domain on port 8080. Variables: `RAILWAY_DOCKERFILE_PATH=server/Dockerfile`, `ID_PEPPER` and `RUNNER_TOKEN` as `${{shared.…}}` references, `RUNNER_URL=http://${{runner.RAILWAY_PRIVATE_DOMAIN}}:8080`, `TRUST_PROXY=1`, `PORT=8080`. |

Put the two secrets in the project's **shared variables**. If you left the admin password out, the one-time code is in the app's deploy logs. Student code still cannot reach the internet here, since the sandbox blocks it.

## Troubleshooting

| What happened | What to do |
| --- | --- |
| Students cannot reach it | Open the port in the server's firewall, and make sure their devices are on a network that can reach the server. |
| Code questions do not run | `docker compose logs runner` says what is missing, which is usually a Linux older than 5.13. |
| Quizzes say "your teacher needs to sign in" | The server restarted. The teacher signs in again and students can keep going. |
| The download or build fails with certificate errors | Your network checks HTTPS traffic, which is common at schools. Build with your network's certificate (below). |

To build with your network's certificate (only that one certificate, not a whole bundle):

```bash
docker compose build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)"
docker compose up -d
```

## Repository layout

| Folder | What's in it |
| --- | --- |
| `server/` | The server (Node, no dependencies, SQLite through `node:sqlite`) |
| `public/student/` | The student app: quiz screens, code editor, exam lockdown |
| `public/teacher/` | The teacher dashboard, quiz maker and reports |
| `runner/` | The code runner, in a sandbox: Java, Python, JavaScript and TypeScript, and with `RUNNER_LANGS=full` C, C++, C#, Go and Rust |
| `examples/` | Example quizzes and a class |
| `demo/` | A self-contained demo, with a fake server |
| `docs/` | These guides |
