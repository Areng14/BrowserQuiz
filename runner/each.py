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

# What runner.py tries at start (each_test), per language: (files, main, sources). Each run prints "ok" and its
# number, and " seen" if it finds the file an earlier run left.
_C = ('#include <stdio.h>\nint main(int argc, char** argv) { FILE* f = fopen("left", "r"); printf("ok%s%s\\n", argv[1], f ? " seen" : "");'
      ' fclose(fopen("left", "w")); return 0; }\n')
PROBES = {
    "java": ({"Main.java": "public class Main { public static void main(String[] a) throws Exception {\n"
                           "    java.io.File f = new java.io.File(\"left\");\n"
                           "    System.out.println(\"ok\" + a[0] + (f.exists() ? \" seen\" : \"\"));\n"
                           "    f.createNewFile();\n} }\n"}, "Main", None),
    "c": ({"main.c": _C}, "main", ["main.c"]),
    "cpp": ({"main.cpp": _C}, "main", ["main.cpp"]),
    "go": ({"main.go": 'package main\nimport ("fmt"; "os")\nfunc main() { _, err := os.Stat("left"); s := ""; if err == nil { s = " seen" }\n'
                       '    fmt.Printf("ok%s%s\\n", os.Args[1], s); os.WriteFile("left", nil, 0o600) }\n'}, "main", ["main.go"]),
    "rust": ({"main.rs": 'fn main() { let a: Vec<String> = std::env::args().collect(); let s = if std::path::Path::new("left").exists() { " seen" } else { "" };\n'
                         '    println!("ok{}{}", a[1], s); let _ = std::fs::write("left", ""); }\n'}, "main", ["main.rs"]),
    "csharp": ({"main.cs": 'var s = System.IO.File.Exists("left") ? " seen" : "";\nSystem.Console.WriteLine("ok" + args[0] + s);\n'
                           'System.IO.File.WriteAllText("left", "");\n'}, "main", ["main.cs"]),
}


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
