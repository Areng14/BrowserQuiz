# BrowserQuiz teacher onboarding

## What it is

BrowserQuiz is quizzes and CS exams in the browser. Students join with a 6-letter code, answer on their own laptops, and code questions run against hidden tests. This guide should guide you through the process of setting it up.

1. Sign in and save your recovery code.
2. Make a class.
3. Make a quiz.
4. Give it.
5. Watch it live, then grade.

**What students need.** A laptop with Chrome, or Edge (or Safe Exam Browser), the join code, and their student ID.

## First sign-in

- **Your account.** The admin adds you as a teacher and gives you a temporary password. You pick your own the first time you sign in.
- **Recovery code.** Shown once, so copy it somewhere safe. Your quizzes and your students' data are encrypted with your own key, and this code is the only way back in if you forget your password.
- **Passkey.** Optional. Sign in with a fingerprint or Windows Hello instead of a password for a faster and safer sign in.

## Setting up a class

Students sign in by picking their name and typing their student ID, so we need to define the class which will store their name and id.

1. Go to **Classes** and click **New class**.
2. Paste one student per line, `name, student ID`. Straight from a spreadsheet works, or upload a CSV. Use their school student ID, or anything classmates don't know. The ID is what stops someone signing in as someone else, so a class number or computer number is easy to guess.

**Extra time.** 1.25×, 1.5× or 2× for anyone with an accommodation. Pick it next to their name, or add it as a third column (`Ava Martinez, 204511, 1.5x`). It applies to every timed quiz from then on.

## Making a quiz

- **Quiz maker.** **Quizzes**, then **New quiz**. 8 question types: multiple choice, select-all, short answer, predict the output, trace tables, fill in the blanks, written answers and code.
- **Writing it with AI.** Click **Copy AI prompt**, paste it into ChatGPT or Claude, fill in the blanks at the top, and upload the `.quiz` or `quiz.json` it gives back. Chat won't take something that long? Download it with the button next to it and attach the file.
- **Preview.** Shows exactly what students see, runs code, and gives you a score. Check it before you give a quiz.
- **Other options.** You can allow the quiz to have time limits, timed parts, a question pool, a calculator, etc.

## Giving a quiz

Pick the quiz, the class and a mode on **Give a quiz**, then click **Start quiz**. Students join with the code on your screen. Click on the code to make it bigger for a projector.

| Mode | Security | What students get | Good for |
| --- | --- | --- | --- |
| Exam | Medium | Full screen, and leaving the window gets flagged quietly | Most tests |
| Safe Exam Browser | High | The whole computer locked down. They open a `.seb` file | Big exams |
| Practice | None | No lockdown. Answers and explanations once they turn it in | Homework and review |

**On the day.**

1. Turn on **Only students on my current network** if everyone's on school wifi and you are on the same network as them.
2. Students go to the address on your screen, type the code, pick their name and type their ID.
3. They read the rules and click **I agree**, which puts them in lockdown to wait.
4. Once everyone is ready, go around the room and ensure that they are sitting at the right computer and signed in as themselves.
5. Click **Start quiz**. Everyone starts together on one clock, and anyone late gets a **Start** button on their row.

## Proctoring the quiz

One row per student, updated every couple of seconds. You can find the live page at any time by going to the Open quiz tab.

- **The table.** Status, integrity, strikes, progress, time left and score. The progress bar's color shows if they're working, reading or idle. You can also click on a title to sort by name, progress, etc.
- **Watch.** Monitor any student's screen. You see their quiz page, not their whole screen.
- **Message students.** Pops up on everyone's screen, or just one student's from their row.
- **Add time.** For one student from their row, or everyone from the quiz's ⋯ menu.
- **Pause quiz.** You may pause a quiz which stops the questions from showing and freezes the timer for breaks or emergencies.
- **Close quiz.** Closes the quiz and turns in everyone's quiz.

**Integrity.** Leaving the quiz window during an exam flags the attempt, quietly. Students never find out. You see when they left and for how long, and **Un-invalidate** undoes it if they had a good reason.

## Grading the quiz

Most questions grade themselves the second a student turns in. Only written answers and some rubric items wait for you.

- **Auto grading.** Multiple choice, select-all, short answer, predict the output, trace tables, fill in the blanks, and code against the hidden tests.
- **Grade with AI.** Grades all the written answers at once, with a reason for every grade. You can change any of them.
- **Grade by question.** Or do it yourself: one question across the whole class, with feedback for each student.
- **Corrections.** If you wish to offer corrections, click on the corrections button which will open a new "quiz" that students can enter to do corrections. It will not lock their computer down and they are free to search online or ask friends how to solve this.
- **Reports.** A class report (averages, the hardest questions, copied code, same wrong answers), a printable report per student, and **Export CSV** for your gradebook.

## Troubleshooting

| What happened | What to do |
| --- | --- |
| The wifi drops | Nothing. Students keep working, and answers save automatically once it's back. |
| A laptop dies | Row's ⋯, then **Let back in**. They sign in on another computer and keep going. |
| Fire drill | ⋯, then **Pause quiz**. Everyone gets their exact time back when you hit **Resume quiz**. |
| The quiz started late | ⋯, then **Add time for everyone**. |
| One student needs more time | Row's ⋯, then **Add time**. Or set extra time on the class for every quiz. |
| A student got flagged for a good reason | Open them and hit **Un-invalidate**. |
| The answer key was wrong | Fix it in the quiz maker, save, then **Update scores**. |
| Stuck on the rules screen | Their window has to fill the screen, on one display, in Chrome or Edge. |
| A student got kicked out of the quiz | Row's ⋯, then **Let back in**. They sign in on their computer and keep going. |
