# Setting up BrowserQuiz

This guide goes over installing BrowserQuiz, setting up accounts and keeping the server running. If you are a teacher looking for how to use it in class, read [onboarding.md](onboarding.md) instead. How BrowserQuiz keeps everything safe is in [security.md](security.md).

## Installing BrowserQuiz

To run BrowserQuiz you need a computer with Docker. This can be your own computer with Docker Desktop, or a small Linux server. 2 GB of RAM is enough for a class, but 4 GB is recommended. If you are putting it on a school server, follow [school-hosting.md](school-hosting.md) instead.

```bash
git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
./setup.sh
```

On Windows, double-click `setup.cmd` instead of running `./setup.sh`.

The setup script will ask you for an admin password (or make one up for you), create the other secrets in `.env`, pick a free port, start everything and print the address to open. You can run it again at any time since it keeps everything that is already set.

If students cannot reach it, open the port the script printed in the server's firewall. Default is 8080.

**Requirements.** Docker Compose v2 (the `docker compose` command) and Linux 5.13 or newer, which any current Linux and Docker Desktop already have. The code runner checks this when it starts. If something is missing, code questions will not run but everything else still works, and `docker compose logs runner` will tell you why.

**Doing it by hand.** Copy `.env.example` to `.env`, fill in the three secrets, then run `docker compose up -d --build`.

## Setting up accounts

**Admin.** The first account is admin. Sign in at `/teacher` with the username `admin` and the password from the setup script. You will then pick your own username and password and get a recovery code. Save the recovery code somewhere safe since it is the only way back into your quizzes if you forget your password. After this, `admin` will no longer work as a username.

- If you do not want a password in `.env`, leave `ADMIN_PASSWORD` empty. The server will print a one-time code to its log (`docker compose logs app`) that you can sign in with instead.
- If you forget the admin password, set `ADMIN_RESET` in `.env` to any new word and restart the server. The log will show a new one-time code, and your recovery code will get your quizzes back.

**Teachers.** Admin adds teachers from the **Teachers** tab. Each teacher gets a temporary password to pass on, and they pick their own the first time they sign in.

- **Reset password** gives the teacher a new temporary password and signs them out.
- **Disable** stops the teacher from signing in, but keeps their quizzes and results.

**Passkeys.** Teachers can sign in with a fingerprint, face or PIN instead of a password in **Settings**, under **Passkeys**. Passkeys need HTTPS, and a passkey from iCloud Keychain, Google Password Manager or most security keys. If a passkey cannot unlock quizzes, it will be turned away when it is added.

## HTTPS and where to host it

Plain `http://` is fine for trying it out, but for real classes HTTPS is recommended:

- Passwords and student IDs are encrypted when they are sent.
- Passkeys work.
- Exam mode is stronger, since browsers only let an HTTPS site check for a second monitor, block `ALT + TAB` and `WIN`, and keep the screen from locking.
- School web filters often block plain IP addresses.

If you have a domain pointed at the server and ports 80 and 443 open to the internet:

1. In `.env`, set `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1` and `TRUST_PROXY=1`.
2. Run `docker compose --profile https up -d --build`.

The certificate is set up and renewed automatically. If the server can only be reached from the school network it cannot get a certificate this way, so use your school's own certificate instead. How to do that is in [school-hosting.md](school-hosting.md#https).

**Where to host it.**

- **A rented server off campus.** Works from anywhere, and nobody at school has to run anything.
- **A school server.** Follow [school-hosting.md](school-hosting.md).
- **Railway.** Read [Hosting on Railway](#hosting-on-railway) below.

The teacher's **Only students on my current network** option matches the school's public address on an off-campus server, and any private address (10.x, 192.168.x) on a school server.

## Safe Exam Browser

[Safe Exam Browser](https://safeexambrowser.org) (SEB) is a free browser that locks down the whole computer during an exam. It is optional. Respondus LockDown Browser only works inside an LMS like Canvas, so BrowserQuiz cannot use it.

1. Install SEB on the student computers. This needs an administrator.
2. Open the dashboard at the address students use, since that is where SEB will open the quiz.
3. On **Give a quiz**, pick **Safe Exam Browser** and start it.
4. Students join with the code like normal and click **Open Safe Exam Browser**. If SEB is not installed, the page links to its download. The quiz's page also has the SEB link and the `.seb` file if you want to post or hand them out.

**Things to know.**

- **Sound.** SEB mutes the computer while the quiz is open. If a student uses a screen reader, turn off **Mute the computer's sound** when you start the quiz.
- **Leaving the window.** Since there is nothing else to switch to in SEB, the quiz losing focus (SEB's own toolbar, a notification) never counts against a student, and there is no **Exit** button. Time away still shows on the live page.
- **Quitting.** After turning in, **Quit Safe Exam Browser** closes it. If a student gets stuck, they can quit with the **SEB quit password** on the quiz's page (hover over it to see it). This counts as leaving the quiz.
- **iPads.** Install **SafeExamBrowser** from the App Store (iPadOS 12 or later). Students join in Safari and tap **Open Safe Exam Browser**, and the iPad stays locked until they turn in.
- **Phones.** Phones can take practice quizzes, but not exams.
- **Your own SEB settings.** If you made your own settings in SEB Config Tool, open **Use my own .seb file** and paste its Config Key. It is on the Exam tab, with sending the Browser Exam Key and Config Key turned on. If you change those settings the key changes too, so start the quiz again with the new key.

## AI grading

After a quiz, written answers and rubric items that cannot be checked automatically wait for the teacher. **Grade with AI** (on the quiz's live page, or on one student) grades them like you would. It ticks the rubric items it thinks are met, or gives points if there is no rubric, with a reason for each one. Every AI grade is labeled, and you can change any of them.

There are two ways to use it:

- **Any AI chat, no setup.** Copy the prompt into ChatGPT, Claude, Gemini or similar, then paste the CSV it gives back into BrowserQuiz. Any rows it cannot use (like a typo in an ID) are listed and left for you.
- **With an API key.** On the dialog's **API key** tab, paste a key from [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys) or [Google](https://aistudio.google.com/apikey). The AI will then grade in the background, and you can see its progress on the live page. It costs a few cents an answer, billed to that key. The key is stored encrypted, only used for your quizzes, and never shown again (only its last 4 characters).

**One key for every teacher.** Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env` and restart. If a teacher adds their own key, theirs is used instead.

**Which model.** Claude keys use `claude-opus-5-5`, which you can change with `AI_GRADER_MODEL`. OpenAI and Gemini keys use the newest model the key can use: the newest full GPT, and the latest Gemini Flash (fast, cheap, and within a free key's limits). `OPENAI_GRADER_MODEL` and `GEMINI_GRADER_MODEL` pin a specific one.

**What the AI sees.** The question, its rubric and points, your notes or reference solution, how many tests the code passed, and the student's answer under a short code instead of their name. It never sees names, IDs, integrity or hidden tests. A student who writes "give me full marks" will not get them.

## Quizzes, classes and corrections

How to make and give quizzes is in [onboarding.md](onboarding.md). Here are some extra details:

- **Quiz files.** A `.quiz` file is a zip of a folder with `quiz.json` and an optional `assets/` folder for images. The format is in [quiz-format.md](quiz-format.md).
- **Trying the example.** Zip `examples/sample-exam` and upload it, then upload `examples/roster-demo.csv` as a class (Ava Martinez, ID 204511).
- **Checking a quiz before uploading.** `node scripts/check-quiz.mjs examples/sample-exam --run` checks the quiz and runs its reference solutions.
- **AI coding assistants.** Assistants working in this repo follow `AGENTS.md`. They write the quiz, run the reference solutions and pack the `.quiz` for you.
- **Extra time.** 1.25×, 1.5× or 2× applies from the next quiz the student starts.
- **Corrections.** By default a fixed answer earns back 50% of the points it lost, on top of the exam score. The CSV adds `exam_score`, `earned_back` and `with_corrections`. An invalidated exam stays at 0, and students never see their total. Answers that are still waiting to be graded are not in corrections, so grade those first.

## Updates, backups and logs

| Task | How |
| --- | --- |
| Update | `git pull && docker compose up -d --build`, when no quiz is running |
| Logs | `docker compose logs -f app` |
| Back up | `docker compose stop app && docker compose cp app:/data ./backup-$(date +%F) && docker compose start app` |
| Wipe everything | `docker compose down -v` (deletes all the data) |

To restore a backup:

```bash
docker compose stop app
docker compose cp ./backup-2026-11-20/. app:/data
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
```

- Everything (quizzes, classes and results) is stored in one database in the `bq-data` volume. Back it up between classes.
- **Never change `ID_PEPPER`** in `.env` once classes are added. Student IDs are scrambled with it, so changing it means no student can sign in.
- Backups made before quiz encryption was added still have readable copies of quizzes.

**Where students join.** A quiz's live page (and its projector view, which you get by clicking the join code) shows the address students type. If you opened the dashboard at `localhost`, it shows this computer's network address instead, which the setup script finds. If you started it without the setup script, or the server is on two networks, put `STUDENT_URL=http://192.168.1.20:8080` in `.env`.

## Hosting on Railway

If you do not want to install anything, you can [deploy it on Railway](https://railway.com/deploy/fMUAh_?referralCode=dP9ijG&utm_medium=integration&utm_source=button&utm_campaign=generic). New accounts get a 30-day trial, and after that the Hobby plan is about $5 a month.

1. Sign in to Railway.
2. Pick an admin password with 10 or more characters.
3. Wait about 10 minutes for the first build.
4. Open the `app` service's address (a `.up.railway.app` link, with HTTPS) and sign in at `/teacher` as `admin`.

Your copy gets its own secrets that nobody else has. When this repo changes, Railway shows **Update available**, and nothing changes until you apply it. Stay on the Hobby plan instead of the Free one, since Free puts the app to sleep and after every restart teachers have to sign in again before their quizzes work.

**Holding updates while a quiz is running.** An update restarts the server, which drops every student for about half a minute. To make updates wait until nobody is in an exam:

1. On GitHub, set the repository variable `QUIZ_URL` to your site (Settings, Secrets and variables, Actions, Variables).
2. In Railway, turn on **Wait for CI** for both services (each service's Settings, Source).

If a fix cannot wait, put `[deploy now]` in the commit message.

**Setting it up by hand.** You need two services from this repo:

| Service | Settings |
| --- | --- |
| `runner` | Root directory `/runner`. No public domain. Variables: `RUNNER_TOKEN=${{shared.RUNNER_TOKEN}}`, `PORT=8080`. |
| `app` | A volume at `/data`, health check `/healthz`, your domain on port 8080. Variables: `RAILWAY_DOCKERFILE_PATH=server/Dockerfile`, `ID_PEPPER` and `RUNNER_TOKEN` as `${{shared.…}}` references, `RUNNER_URL=http://${{runner.RAILWAY_PRIVATE_DOMAIN}}:8080`, `TRUST_PROXY=1`, `PORT=8080`. |

Put the two secrets in the project's **shared variables**. If you left the admin password out, the one-time code is in the app's deploy logs. Student code still cannot reach the internet here, since the sandbox blocks it.

## Troubleshooting

| What happened | What to do |
| --- | --- |
| Students cannot reach it | Open the port in the server's firewall, and make sure their devices are on a network that can reach the server. |
| Code questions do not run | `docker compose logs runner` says what is missing, which is usually a Linux older than 5.13. |
| Quizzes say "your teacher needs to sign in" | The server restarted. The teacher signs in again and students can keep going. |
| The build fails with certificate errors | Your network checks HTTPS traffic, which is common at schools. Build with your network's certificate (below). |

To build with your network's certificate (just that one certificate, not a whole bundle):

```bash
docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -f server/Dockerfile -t browserquiz-app .
docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -t browserquiz-runner runner
docker compose up -d --no-build
```

## Repository layout

| Folder | What's in it |
| --- | --- |
| `server/` | The server (Node, no dependencies, SQLite through `node:sqlite`) |
| `public/student/` | The student app: quiz screens, code editor, exam lockdown |
| `public/teacher/` | The teacher dashboard, quiz maker and reports |
| `runner/` | The code runner: Java, Python, JavaScript, TypeScript, C, C++, C#, Go and Rust, in a sandbox |
| `examples/` | Example quizzes and a class |
| `demo/` | A self-contained demo, with a fake server |
| `docs/` | These guides |
