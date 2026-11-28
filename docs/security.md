# Security and privacy

## What reaches the student's browser

- **What students get.** Only the questions, the sample tests and the starter code. Answers, explanations, hidden tests, reference solutions and rubrics never reach their browser.
- **Locked and timed parts.** A part's questions, images and directions reach the browser only when that part opens. Until then the browser has each question's type and points, to lay the parts out.
- **Practice review.** In practice mode, the review after turning in shows answers, explanations and reference solutions, but still no hidden tests or rubrics. If you already gave a quiz as practice, the dashboard asks before you give it as a graded quiz.
- **Images.** A quiz's images only load once the student has started, and only the ones their quiz shows. An image that is only in an answer key stays on the server.
- **Hidden tests.** The sandbox only gets the student's code and the inputs. The expected outputs stay on the server and are compared there, and saved results do not keep them either.

## How student code is run

Student code runs in its own container. With Docker Compose, that container is on a network with no way out to the internet. Wherever it runs, each job:

- runs as its own user, and everything it started is stopped and cleaned up when it is done
- can only write to its own job folder, so it cannot touch other jobs or the system (Landlock). When grading, each hidden test runs in its own process with a fresh copy of that folder, so one test cannot leave anything behind for the next. Only a compiled C, C++, Go or Rust answer can run as a program from that folder, and everything else can only run the language's own tools
- cannot open any network connections, so it cannot reach anything (seccomp, plus Landlock on newer kernels)
- has limits on CPU time, memory, processes, file size, disk use and run time. Each slot writes to its own space (its own tmpfs with Docker Compose), so one job filling up its disk cannot stop the others

The runner checks its own sandbox when it starts. If anything is missing, it refuses to run code.

**Fake results.** Student code cannot fake its own results. Each run's results come back tagged with a random marker that only the test harness knows. The harness deletes its own files before student code runs.

- **Java.** The harness writes through the real output stream it saved before student code ran.
- **Python.** Code that reaches into the harness (frames, closures, swapping `time.perf_counter` or `sys.stdout`) fails its speed tests.
- **JavaScript and TypeScript.** The harness keeps its own copies of everything it uses before student code loads, and writes values out itself, so patching `JSON`, `Array.prototype` or `process.stdout` does not change what it reports.
- **C, C++, C#, Go and Rust.** There are no speed tests, and results can only say what the code returned, since the expected values are not in the sandbox.

## Encryption of quizzes and student data

Your quizzes and your students' data are encrypted with your key. Whoever hosts the server cannot read them.

- **How.** Quizzes and images are encrypted (AES-256-GCM) with a key that only your password, recovery code or passkeys can unlock. The person running the server cannot read them from the database or a backup.
- **Student data.** The same key encrypts students' names, their answers and scores, their network addresses and browsers, the details of what the quiz noticed, and typing replays. A leaked database only shows ids, times and counts, not who anyone is or what they wrote. Anything saved before this was added gets encrypted the next time its teacher signs in.
- **Recovery code.** You see it once, when you first set your password. You can make a new one in Settings with your password. The old one stops working, and your key, quizzes and passkeys stay. If you forget your password, an admin reset plus that code (or one of your passkeys) gets your quizzes back. The temporary password alone is not enough, even while the server has your key in memory. Without either one nobody can open them. You start over, which also removes your passkeys.
- **After a restart.** The key stays in the server's memory from sign-in until the server restarts. Until you sign in again, your quizzes are locked. Students see "your teacher needs to sign in", and their app keeps their answers and keeps retrying. Students also cannot look up their names until then.
- **What is not covered.**
    - Quiz titles, class names, and counts like strikes and time away stay readable, since they are tied to an id and not a name.
    - The server has to read a quiz to grade it, so a host who changes the server's code can get to a quiz while it is unlocked.
    - Admin's first password can come from `.env` (`ADMIN_PASSWORD`), which the host has anyway. Once admin signs in with it, they pick their own password and get their own key, and from then on `.env` opens nothing.

## Privacy and signing in

- **Where data is stored.** Everything is stored in one SQLite database on your server. The pages do not load anything from other sites. Nothing is sent anywhere else, unless a teacher uses AI grading with an API key. Then answers go to that AI provider under a short code, never with names or IDs.
- **Student IDs** are stored scrambled with a secret from `.env` (HMAC), never as plain text.
- **Other teachers' data.** A teacher asking for another teacher's quiz, class, run or student gets "not found".
- **Signing in.**
    - Passwords are hashed (scrypt), and wrong guesses are slowed down.
    - Passkeys (on HTTPS) sign in without a password and still unlock the teacher's quizzes. Each passkey keeps the teacher's key sealed with a secret only that passkey can give, after a fingerprint, face or PIN (the WebAuthn PRF extension). A passkey that cannot do this is not accepted, except for admin while the password comes from `.env`. Every sign-in is checked against this site and a one-time challenge.
    - Adding a passkey asks for the password first, so nobody at an unlocked computer can add their own.
    - Session cookies cannot be read by scripts or sent by other sites (HttpOnly, SameSite=Strict), and requests from other sites are refused.
    - Pages only run the app's own scripts (CSP).
    - Over plain HTTP, the teacher password and student IDs are sent unencrypted. Use HTTPS for a real class ([HTTPS](setup.md#https-and-where-to-host-it)).
- **Wrong student IDs** lock a name for a moment, but only in the browser that typed them, so a classmate's typo does not lock someone out. After many wrong IDs the name is locked everywhere for a while, and the live page shows how many wrong IDs were typed for it.
- **Class list.** The name box only finds a name from its first letters, so someone with the join code cannot list the whole class.

## Exam lockdown

- **Lockdown.** Exams run in full screen and catch students leaving the quiz. You can lock a quiz to your network, and each attempt stays on the network it started on. For big exams, use [Safe Exam Browser](setup.md#safe-exam-browser).
- **The live page** shows who is where and anything that looks off, with the details. Students never find out whether they were flagged: their screens look the same either way.
- **While an exam is open,** answers and scores stay hidden, even from you. Reports, replays, CSV and AI grading open once it is closed. **Watch** still shows a student's screen as they see it.
- **Limits.** No lockdown can stop everything, like a phone under the desk. It blocks the common ways out and records the rest. You still need to walk around the room.
