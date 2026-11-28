"""Build once, run each: a job with "runs": n is compiled once, then run n times, run k with the number k (the
harness runs only that test). Each run is a process of its own in a fresh copy of the build, so a crash, a
hang, an exit, static state or a file one test leaves behind can't reach another, and each has the time and
memory a job's one run has. runner.py does the sandboxing (run_step); this is the copying and the order."""
import os
import shutil
import stat
import time

MAX_RUNS = 100  # a code question's most hidden tests (server/src/quizfile.js)
# No run starts once a job is this far in, whatever its runs: the rest come back "skipped", for the app to send
# again. So a slot is never held for long (at worst this, plus a compile, plus one run), and every job gets its
# first run.
BUDGET_S = 10


def copy_build(src, dst, uid):
    """The build's files and folders into dst (made already), owned by uid. Only regular files and folders: a
    run's own copy, so whatever it does to its files is gone for the next. Nothing of uid's runs meanwhile."""
    stack = [(src, dst)]
    while stack:
        s_dir, d_dir = stack.pop()
        with os.scandir(s_dir) as it:
            entries = list(it)
        for e in entries:
            st = e.stat(follow_symlinks=False)
            target = os.path.join(d_dir, e.name)
            if stat.S_ISDIR(st.st_mode):
                os.mkdir(target, 0o700)
                os.chown(target, uid, uid)
                stack.append((e.path, target))
            elif stat.S_ISREG(st.st_mode):
                with os.fdopen(os.open(e.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC), "rb") as fi, \
                        os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600), "wb") as fo:
                    shutil.copyfileobj(fi, fo, 1 << 20)
                    os.fchown(fo.fileno(), uid, uid)
                    os.fchmod(fo.fileno(), stat.S_IMODE(st.st_mode) & 0o777)


def run_each(n, started, one):
    """one(k) -> run k's result, in order. A run that would start past BUDGET_S into the job (started: its
    time.monotonic()) is skipped, and so is every one after it; run 0 always runs."""
    runs = []
    for k in range(n):
        if k and (runs[-1]["status"] == "skipped" or time.monotonic() - started > BUDGET_S):
            runs.append({"status": "skipped"})
        else:
            runs.append(one(k))
    return runs
