# Railway code-runner spike

Question: can we run student Java/Python safely on Railway, which has no
privileged containers?

`probe.py` checks the host and then runs real payloads inside "jail-lite",
a sandbox built only from unprivileged kernel features:

| Layer | Blocks |
| --- | --- |
| Separate high uid (e.g. 1234567001+slot), job dir 0700 | other jobs' files |
| rlimits: CPU, address space, NPROC, FSIZE, NOFILE, no core | infinite loops, memory hogs, fork bombs, disk fill |
| Landlock (ABI >= 4): read-only allowlist of runtime dirs, rw job dir, all TCP denied | reading the host, other jobs, network |
| seccomp: `socket()` -> EPERM | network, as a backstop to Landlock |
| `setsid` + wall-clock `killpg` | anything that sleeps instead of burning CPU |

## How to run it on Railway

1. Service from image `eclipse-temurin:21-jdk`
2. Variable `PROBE` = `gzip -9 -c probe.py | base64 -w0`
3. Start command:
   `bash -c 'apt-get update -qq; apt-get install -y -qq python3; echo "$PROBE" | base64 -d | gunzip > /probe.py && python3 /probe.py; sleep infinity'`
4. Read the deploy logs.

## Gotcha found on Railway

`RLIMIT_NPROC` counts processes per uid **across the whole host**, and other
tenants' containers share uids like 10001. With uid 10001 the JVM could not
start a single thread. Use a high, unlikely uid.

The JVM also sizes itself for the host (48 CPUs on Railway), so it ran out of
address space under `RLIMIT_AS`. Fix: `-XX:ActiveProcessorCount=1`,
`MALLOC_ARENA_MAX=2`, serial GC, and a looser address-space cap for the JVM
(real memory is bounded by `-Xmx` / metaspace / code cache flags).
