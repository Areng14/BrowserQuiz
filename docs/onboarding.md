# BrowserQuiz teacher onboarding

BrowserQuiz runs quizzes and CS exams in the browser. Students join with a 6-letter code and answer on their own laptops. Code questions run against hidden tests.

1. Sign in and save your recovery code.
2. Make a class.
3. Make a quiz.
4. Give it.
5. Watch it live, then grade.

**What students need.** A laptop with Chrome or Edge (or Safe Exam Browser), the join code, and their student ID.

## First sign-in

The admin adds you as a teacher and gives you a temporary password.

1. Sign in with the temporary password, then pick your own.
2. Copy your recovery code somewhere safe. It is shown once.
3. Optional: add a passkey in **Settings**, to sign in with a fingerprint or Windows Hello instead of a password.

**Recovery code.** Your quizzes and your students' data are encrypted with your own key. If you forget your password, this code is the only way back in. If you lose the code, make a new one in **Settings** while you still know your password. The old one stops working.

## Settings

Open **Settings** from the menu under your name. Each section has its own save button.

- **You.** Your name, the time zone for times on your quizzes, results and downloaded grades, and light or dark on this computer.
- **Password, recovery code and passkeys.** Changing your password signs you out everywhere else.
- **Other devices.** How many other browsers are signed in as you, and a button to sign them all out.
- **Quiz defaults.** What **Give a quiz** starts with: the mode, your own `.seb` file's Config Key, muting the sound, and the network lock. You can still change them each time.
- **AI grading key.** Your own key for **Grade with AI**.

## Setting up a class

Students sign in by picking their name and typing their student ID. The class holds both.

1. Go to **Classes** and click **New class**.
2. Paste one student per line, as `name, student ID`. You can paste straight from a spreadsheet, or upload a CSV.
3. Click **Save**.

**Which ID to use.** Use the school student ID, or anything classmates don't know. The ID is what stops someone signing in as someone else. A class number or computer number is easy to guess.

**Extra time.** For a student with an accommodation, pick 1.25×, 1.5× or 2× next to their name, or add it as a third column (`Ava Martinez, 204511, 1.5x`). It applies to every timed quiz from then on.

## Making a quiz

Go to **Quizzes** and click **New quiz**. There are 10 question types: multiple choice, select-all, short answer, math, graphing, predict the output, trace tables, fill in the blanks, written answers and code. The quiz is one list, each question with its answer. Click a question to edit it in place, and click **Done** when you're finished.

**Writing it with AI.**

1. Click **Copy AI prompt**.
2. Paste it into ChatGPT or Claude, and fill in the blanks at the top.
3. Upload the `.quiz` or `quiz.json` it gives back.

If the chat won't take a prompt that long, download it with the button next to **Copy AI prompt** and attach the file. To add one question to a quiz you're making, click **Add question**, then **From an AI**. It has its own prompt, and what the AI writes back goes straight into the quiz.

**Preview.** Check the quiz in **Preview** before you give it. It shows exactly what students see, runs code, and gives you a score.

**Other options.** A quiz can also have a time limit, timed parts, a question pool, a calculator and more.

## Giving a quiz

1. Go to **Give a quiz** and pick the quiz, the class and a mode.
2. Click **Start quiz**.
3. Students join with the code on your screen. Click the code to make it bigger for a projector.

| Mode | Security | What students get | Good for |
| --- | --- | --- | --- |
| Exam | Medium | Full screen, and leaving the window gets flagged quietly | Most tests |
| Safe Exam Browser | High | The whole computer locked down. They open a `.seb` file | Big exams |
| Practice | None | No lockdown. Answers and explanations once they turn it in | Homework and review |

**On the day.**

1. If everyone, you included, is on the school wifi, turn on **Only students on my current network**.
2. Students go to the address on your screen, type the code, pick their name and type their ID.
3. They read the rules and click **I agree**. That puts them in lockdown to wait.
4. Walk around the room. Check that each student is at the right computer and signed in as themselves.
5. Click **Start quiz**. Everyone starts together on one clock.

**Late students** start as soon as they agree to the rules. If their sign-in needs a look (a new network, or a browser another student used), their row gets a **Start** button instead.

## Proctoring the quiz

The live page has one row per student, updated every couple of seconds. To get back to it, click **Open quiz** in the sidebar (**Open quizzes** when more than one is open).

- **The table.** Status, integrity, strikes, progress and time left. Scores show once you close an exam, or once someone turns in a practice quiz. The progress bar's color shows whether a student is working, reading or idle. Click a column title to sort by it (name, progress and so on).
- **Watch.** Shows any student's quiz page, not their whole screen.
- **Announce.** Pops up a message on everyone's screen. To message one student, use their row's ⋯.
- **Add time.** For one student, use their row. For everyone, use the quiz's ⋯ menu.
- **Pause quiz.** Hides the questions and freezes the timer. Use it for breaks or emergencies.
- **Close quiz.** Ends the quiz and turns in every student's work.

**Integrity.** If a student leaves the quiz window during an exam, the attempt is flagged quietly. Students never find out. You see when they left and for how long. If they had a good reason, click **Un-invalidate** to undo it.

## Grading the quiz

Most questions grade themselves as soon as a student turns in. Only written answers and some rubric items wait for you.

- **Auto grading.** Multiple choice, select-all, short answer, predict the output, trace tables, fill in the blanks, and code against the hidden tests.
- **Grade with AI.** Grades all the written answers at once, with a reason for every grade. You can change any of them.
- **Grade by question.** Grade it yourself: one question across the whole class, with feedback for each student.
- **Corrections.** Click **Corrections** to open a corrections quiz. Students join it and redo what they missed. It doesn't lock their computer, so they can search online or ask friends.
- **Reports.** A class report (averages, the hardest questions, copied code, same wrong answers), a printable report per student, and **Download grades**, a spreadsheet for your gradebook.
- **Grades.** Every quiz a class took, side by side: each student's percent, their average, and the class's. Practice and open quizzes aren't in it, and corrections are counted in the exam's score. **Download grades** there gives the whole table as a spreadsheet. Every quiz you've given, practice and open ones too, is on **Recent**.

## Troubleshooting

| What happened | What to do |
| --- | --- |
| The wifi drops | Nothing. Students keep working, and answers save automatically once it's back. |
| A laptop dies | Row's ⋯, then **Let back in**. They sign in on another computer and keep going. |
| Fire drill | ⋯, then **Pause quiz**. Everyone gets their exact time back when you click **Resume quiz**. |
| The quiz started late | ⋯, then **Add time for everyone**. |
| One student needs more time | Row's ⋯, then **Add time**. Or set extra time on the class for every quiz. |
| A student got flagged for a good reason | Open them and click **Un-invalidate**. |
| The answer key was wrong | Fix it in the quiz maker, save, then click **Update scores**. |
| Stuck on the rules screen | Their window has to fill the screen, on one display, in Chrome or Edge. |
| A student got kicked out of the quiz | Row's ⋯, then **Let back in**. They sign in on their computer and keep going. |
