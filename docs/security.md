# Security and privacy

How BrowserQuiz keeps answers, quizzes and student data safe.

## Answers stay on the server

- **What students get:** the questions, the sample tests and the starter code. Answers, explanations,
  hidden tests, reference solutions and rubrics never reach their browser.
- **The one exception:** practice mode's review after turning in shows answers, explanations and
  reference solutions, but still no hidden tests or rubrics. Once a quiz has been turned in as practice, the
  dashboard asks before giving it as a graded quiz.
- **Images:** a quiz's images load only once the student has started, and only the ones their quiz
  shows. One that appears only in an answer key stays on the server.
- **Hidden tests:** the sandbox only gets the student's code and the inputs. Expected outputs stay on
  the server and are compared there, and saved results don't keep them either.

## Student code runs in a sandbox

Code runs in its own container. With Docker Compose, that container sits on a network with no way out
to the internet. Wherever it runs, each job:

- runs as its own user, and everything it started is killed (and collected) when it's done
- can only write to its own job folder, so it can't touch other jobs or the system (Landlock). Only a
  compiled C, C++, Go or Rust answer can be run as a program from that folder; everything else can
  only run the language's own tools
- can't open network sockets or socket pairs, so it can't reach anything at all (seccomp, plus
  Landlock on newer kernels)
- has limits on CPU time, memory, processes, file size, disk use and run time. Each slot writes to its own
  area (a tmpfs of its own with Docker Compose), so one job filling its disk can't stop the others

The runner checks its own sandbox when it starts, and refuses to run code if anything's missing.

Student code also can't fake its own results. Each run's results come back tagged with a random
marker that only lives in the test harness's local variables, and the harness deletes its own files
before student code runs. In Java it writes through the real output stream it kept before student
code ran. In Python, code that reaches into the harness (frames, closures, swapping
`time.perf_counter` or `sys.stdout`) fails its speed tests. In JavaScript and TypeScript the harness
keeps its own copies of everything it uses before student code loads, and writes values out itself,
so patching `JSON`, `Array.prototype` or `process.stdout` changes nothing it reports. C and C++ have
no speed tests, and their results can only say what the code returned, since the expected values
aren't in the sandbox. The same goes for C#, Go and Rust, which have no speed tests either.

## Quizzes are encrypted, even from whoever hosts it

- **How:** each teacher's quizzes and images are encrypted (AES-256-GCM) with a key that only their
  password, recovery code or passkeys unlock. The person running the server can't read them from the
  database or a backup.
- **Recovery code:** teachers see it once, when they first set their password. If they forget the
  password, an admin reset plus that code (or one of their passkeys) gets their quizzes back. The
  temporary password alone isn't enough, even while the server has their key in memory. Without
  either, nobody can open them, and they start over, which also removes their passkeys.
- **After a restart:** the key stays in the server's memory from sign-in until the server restarts.
  Until the teacher signs in again, their quizzes are locked: students see "your teacher needs to sign
  in", and their app keeps their answers and retries.
- **Not covered:**
  - Quiz titles, class lists and results (scores, and which answers were right) stay readable.
  - The server has to read a quiz to grade it, so a host who changes the server's code can get at a
    quiz while it's unlocked.
  - When admin's password comes from `.env` (`ADMIN_PASSWORD`), admin's quizzes are keyed off `.env`,
    which the host has anyway. With the one-time code instead, admin gets their own key too.

## Private by default

- **Your machine, your data.** Everything lives in one SQLite database on your server. Nothing is
  sent anywhere else, and the pages load nothing from other sites.
- **Student IDs** are stored as keyed hashes (HMAC with a secret from `.env`), never as plain text.
- **Teachers are walled off from each other.** Asking for another teacher's quiz, class, run or
  student gets "not found".
- **Sign-in:**
  - passwords are hashed with scrypt, and wrong guesses are throttled
  - passkeys (on HTTPS) sign in without a password, and still unlock the teacher's quizzes: each one
    keeps their key sealed with a secret only that passkey gives, after a fingerprint, face or PIN
    (the WebAuthn PRF extension). A passkey that can't do that isn't accepted, except for admin while
    the password comes from `.env`. Every response is checked against this site and a one-time
    challenge.
  - adding a passkey asks for the password first, so nobody at an unlocked computer can add their own
  - session cookies are HttpOnly and SameSite=Strict, and requests from other sites are refused
  - pages run only the app's own scripts (CSP)
  - use HTTPS for a real class: over plain HTTP, the teacher password and student IDs cross the
    network unencrypted ([HTTPS](setup.md#https-and-a-domain))
- **Wrong student IDs** lock a name for a moment in the browser that typed them, so a classmate's typo
  doesn't lock someone out. After many, the name waits everywhere for a while, and the live page shows
  how many wrong IDs were typed for it.
- **The class list stays private:** the name box only finds a name from its first letters, so someone
  with the join code can't list the class.

## Exams

- **Lockdown:** exams run full screen and catch leaving the quiz. You can lock a quiz to your network,
  and each attempt stays on the network it started on. For graded exams, use
  [Safe Exam Browser](setup.md#giving-an-exam).
- **The live page** shows who's where and anything that looks off, with the details. Students never
  find out whether they were flagged: their screens look the same either way. You decide what counts.
- **While an exam is open,** answers and scores stay hidden, even from you: reports, replays, CSV and
  AI grading open once it's closed. **Watch** still shows a student's screen as they see it.
- **No lockdown is perfect.** It stops the easy stuff and records the rest. Walking the room is still
  part of it.
