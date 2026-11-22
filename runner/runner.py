#!/usr/bin/env python3
"""BrowserQuiz code runner.

Compiles and runs student Java, Python, JavaScript, TypeScript, C, C++, C#, Go, Rust, Swift and Ruby inside "jail-lite", a sandbox built only from unprivileged
kernel features (it works on hosts like Railway that don't allow privileged containers):

  * a separate uid per worker slot; everything that uid owns is killed after every job
  * rlimits: CPU, address space, processes, file size, open files, no core dumps
  * Landlock: read-only access to the runtimes, read-write to the job dir only (and running a program from
    it only for a compiled C/C++ job's own binary), all TCP denied,
    signals and abstract unix sockets scoped to the job (ABI 6+)
  * seccomp: x32 syscalls kill the process; sockets, io_uring, SysV IPC, ptrace, bpf, keyctl,
    namespaces and friends are denied
  * a wall-clock timeout, output written to a capped file, job dirs on a size-limited tmpfs

It refuses to start if the sandbox can't be built (fail closed). The app sends code + inputs only:
expected answers never reach this service.
"""
import ctypes
import ctypes.util
import errno
import hmac
import json
import os
import platform
import queue
import resource
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("RUNNER_TOKEN", "")
JOBS = os.environ.get("JOBS_DIR", "/jobs")
SLOTS = max(1, int(os.environ.get("RUNNER_SLOTS", "4")))
UID_BASE = int(os.environ.get("RUNNER_UID_BASE", "1234567000"))
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 512 * 1024
OUT_CAP = 64 * 1024
FILE_CAP = 1 << 20

libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
libc.syscall.restype = ctypes.c_long
ARCH = platform.machine()
if ARCH not in ("x86_64", "aarch64"):
    sys.exit(f"runner: unsupported architecture {ARCH}")

# ---------------------------------------------------------------- seccomp
NR = {
    "x86_64": dict(landlock_create_ruleset=444, landlock_add_rule=445, landlock_restrict_self=446,
                   clone=56, clone3=435,
                   deny=[41, 53, 425, 426, 427, 101, 310, 311, 321, 250, 248, 249, 323, 298, 272, 308, 165, 166, 155,
                         161, 29, 30, 31, 67, 64, 65, 66, 220, 68, 69, 70, 71, 246, 320, 175, 313, 176, 163, 167,
                         168, 169, 170, 171, 133, 259, 134, 139, 303, 304, 312, 430, 431, 432, 433, 434]),
    "aarch64": dict(landlock_create_ruleset=444, landlock_add_rule=445, landlock_restrict_self=446,
                    clone=220, clone3=435,
                    deny=[198, 199, 425, 426, 427, 117, 270, 271, 280, 219, 217, 218, 282, 241, 97, 268, 40, 39, 41,
                          51, 194, 196, 195, 197, 190, 193, 191, 192, 186, 189, 187, 188, 104, 294, 105, 273, 106, 89,
                          224, 225, 142, 161, 162, 33, 264, 265, 266, 430, 431, 432, 433, 434]),
}[ARCH]
# x86_64 deny list: socket, socketpair, io_uring_setup/enter/register, ptrace, process_vm_readv/writev, bpf, keyctl, add_key,
# request_key, userfaultfd, perf_event_open, unshare, setns, mount, umount2, pivot_root, chroot,
# shmget/shmat/shmctl/shmdt, semget/semop/semctl/semtimedop, msgget/msgsnd/msgrcv/msgctl, kexec_load, kexec_file_load,
# init_module, finit_module, delete_module, acct, swapon, swapoff, reboot, sethostname, setdomainname, mknod, mknodat,
# uselib, sysfs, name_to_handle_at, open_by_handle_at, kcmp, fsopen, fsconfig, fsmount, fspick, pidfd_open.
AUDIT_ARCH = {"x86_64": 0xC000003E, "aarch64": 0xC00000B7}[ARCH]
NS_FLAGS = 0x7E020000  # CLONE_NEWNS | NEWCGROUP | NEWUTS | NEWIPC | NEWUSER | NEWPID | NEWNET
RET_KILL, RET_ALLOW = 0x80000000, 0x7FFF0000
RET_EPERM, RET_ENOSYS = 0x00050000 | errno.EPERM, 0x00050000 | errno.ENOSYS
PR_SET_NO_NEW_PRIVS, PR_SET_SECCOMP, SECCOMP_MODE_FILTER = 38, 22, 2


class SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_uint16), ("jt", ctypes.c_uint8), ("jf", ctypes.c_uint8), ("k", ctypes.c_uint32)]


class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_uint16), ("filter", ctypes.POINTER(SockFilter))]


def _bpf_program():
    LD, JEQ, JGE, JSET, RET = 0x20, 0x15, 0x35, 0x45, 0x06
    p = [SockFilter(LD, 0, 0, 4), SockFilter(JEQ, 1, 0, AUDIT_ARCH), SockFilter(RET, 0, 0, RET_KILL),
         SockFilter(LD, 0, 0, 0)]
    if ARCH == "x86_64":
        p += [SockFilter(JGE, 0, 1, 0x40000000), SockFilter(RET, 0, 0, RET_KILL)]  # x32 ABI
    for nr in NR["deny"]:
        p += [SockFilter(JEQ, 0, 1, nr), SockFilter(RET, 0, 0, RET_EPERM)]
    p += [SockFilter(JEQ, 0, 1, NR["clone3"]), SockFilter(RET, 0, 0, RET_ENOSYS),  # libc falls back to clone
          SockFilter(JEQ, 0, 3, NR["clone"]), SockFilter(LD, 0, 0, 16),
          SockFilter(JSET, 0, 1, NS_FLAGS), SockFilter(RET, 0, 0, RET_EPERM),
          SockFilter(RET, 0, 0, RET_ALLOW)]
    return p


BPF = _bpf_program()
BPF_ARRAY = (SockFilter * len(BPF))(*BPF)
BPF_PROG = SockFprog(len(BPF), BPF_ARRAY)


def apply_seccomp():
    if libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.byref(BPF_PROG), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "seccomp")


# ---------------------------------------------------------------- landlock
FS_EXECUTE, FS_WRITE_FILE, FS_READ_FILE, FS_READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
NET_BIND_TCP, NET_CONNECT_TCP = 1 << 0, 1 << 1
SCOPE_ABSTRACT_UNIX, SCOPE_SIGNAL = 1 << 0, 1 << 1


def landlock_abi():
    r = libc.syscall(NR["landlock_create_ruleset"], None, ctypes.c_size_t(0), ctypes.c_uint32(1))
    return r if r >= 0 else 0


ABI = landlock_abi()


def fs_handled():
    m = (1 << 13) - 1
    if ABI >= 2:
        m |= 1 << 13  # REFER
    if ABI >= 3:
        m |= 1 << 14  # TRUNCATE
    if ABI >= 5:
        m |= 1 << 15  # IOCTL_DEV
    return m


def _real(name):
    p = shutil.which(name)
    return os.path.realpath(p) if p else ""


def build_rules(job, run_here=False):
    java, javac, python = _real("java"), _real("javac"), _real("python3")
    java_home = os.path.dirname(os.path.dirname(java)) if java else ""
    # (the job's own /proc/self is added in the child, where it names the job and not this process)
    read_dirs = ["/usr", "/lib", "/lib64", "/etc/alternatives", "/etc/ssl", java_home, "/sys/devices/system/cpu", "/opt/bq"]
    read_dirs += [os.path.join("/etc", n) for n in os.listdir("/etc") if n.startswith("java")]
    read_files = ["/etc/ld.so.cache", "/etc/localtime", "/etc/timezone", "/proc/meminfo", "/proc/cpuinfo", "/proc/stat",
                  "/dev/urandom", "/dev/random", "/dev/zero"]
    # the dynamic loader and shared libraries, and gcc's own programs (cc1, collect2)
    exec_dirs = ["/lib", "/lib64", "/usr/lib", "/usr/lib64", "/usr/libexec/gcc", "/usr/libexec/swift"]
    tools = [java, javac, python] + [_real(n) for n in ("node", "gcc", "g++", "cc", "as", "ld", "rustc", "dotnet", "swiftc", "ruby")]
    exec_files = sorted(set(p for p in tools if p))
    # Files in the job dir can only be run as programs by a C or C++ job's run step (its compiled main).
    return dict(read_dirs=read_dirs, read_files=read_files, exec_dirs=exec_dirs, exec_files=exec_files,
                rw_dirs=[job], rw_files=["/dev/null"], run_here=run_here)


def prepare_landlock(rules):
    """Build the ruleset in the parent (no forking hazards); the child only calls landlock_restrict_self."""
    handled = fs_handled()
    if ABI >= 6:
        attr = struct.pack("QQQ", handled, NET_BIND_TCP | NET_CONNECT_TCP, SCOPE_ABSTRACT_UNIX | SCOPE_SIGNAL)
    elif ABI >= 4:
        attr = struct.pack("QQ", handled, NET_BIND_TCP | NET_CONNECT_TCP)
    else:
        attr = struct.pack("Q", handled)
    buf = ctypes.create_string_buffer(attr)
    fd = libc.syscall(NR["landlock_create_ruleset"], buf, ctypes.c_size_t(len(attr)), ctypes.c_uint32(0))
    if fd < 0:
        raise OSError(ctypes.get_errno(), "landlock_create_ruleset")
    file_rights = FS_EXECUTE | FS_READ_FILE | FS_WRITE_FILE | (1 << 14 if ABI >= 3 else 0) | (1 << 15 if ABI >= 5 else 0)

    def add(path, rights):
        if not path or not os.path.exists(path):
            return
        if not os.path.isdir(path):
            rights &= file_rights
        pfd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        try:
            rule = ctypes.create_string_buffer(struct.pack("=Qi", rights & handled, pfd))
            if libc.syscall(NR["landlock_add_rule"], ctypes.c_int(fd), ctypes.c_int(1), rule, ctypes.c_uint32(0)) < 0:
                raise OSError(ctypes.get_errno(), f"landlock_add_rule {path}")
        finally:
            os.close(pfd)

    try:
        for d in rules["read_dirs"]:
            add(d, FS_READ_FILE | FS_READ_DIR)
        for f in rules["read_files"]:
            add(f, FS_READ_FILE)
        for d in rules["exec_dirs"]:
            add(d, FS_EXECUTE | FS_READ_FILE | FS_READ_DIR)
        for f in rules["exec_files"]:
            add(f, FS_EXECUTE | FS_READ_FILE)
        for d in rules["rw_dirs"]:
            add(d, handled if rules.get("run_here") else handled & ~FS_EXECUTE)
        for f in rules["rw_files"]:
            add(f, FS_READ_FILE | FS_WRITE_FILE)
    except Exception:
        os.close(fd)
        raise
    return fd


# ---------------------------------------------------------------- running
def make_preexec(uid, ruleset_fd, cpu_s, mem_mb, nproc, fsize):
    def pre():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb << 20, mem_mb << 20))
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_MEMLOCK, (0, 0))
        os.setgroups([])
        os.setgid(uid)
        os.setuid(uid)
        resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))  # counted per uid, so this is the slot's cap
        if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "no_new_privs")
        # Its own /proc/self (the path, opened here, is this process: a rule made in the parent would be the runner's).
        pfd = os.open("/proc/self", os.O_PATH | os.O_CLOEXEC)
        rule = ctypes.create_string_buffer(struct.pack("=Qi", (FS_READ_FILE | FS_READ_DIR) & fs_handled(), pfd))
        added = libc.syscall(NR["landlock_add_rule"], ctypes.c_int(ruleset_fd), ctypes.c_int(1), rule, ctypes.c_uint32(0))
        os.close(pfd)
        if added < 0:
            raise OSError(ctypes.get_errno(), "landlock_add_rule /proc/self")
        if libc.syscall(NR["landlock_restrict_self"], ctypes.c_int(ruleset_fd), ctypes.c_uint32(0)) < 0:
            raise OSError(ctypes.get_errno(), "landlock_restrict_self")
        apply_seccomp()
    return pre


def kill_uid(uid):
    """Kill every process owned by the slot's uid, including ones that escaped the process group."""
    for _ in range(3):
        pid = os.fork()
        if pid == 0:
            try:
                os.setgid(uid)
                os.setuid(uid)
                os.kill(-1, signal.SIGKILL)
            except Exception:
                pass
            os._exit(0)
        os.waitpid(pid, 0)
        time.sleep(0.02)
    reap_uid(uid)


def reap_uid(uid):
    """Collect the slot's orphans. A job's processes whose parent died come to this process (PID 1 in the
    container), and as zombies they'd count against the slot's process limit for good. Only this slot's
    thread uses its uid, and its own child was already waited for, so any child left with that uid is one."""
    me = os.getpid()
    for _ in range(50):
        left = 0
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            try:
                with open(f"/proc/{name}/status") as f:
                    st = f.read()
            except OSError:
                continue
            fields = dict(line.split(":", 1) for line in st.splitlines() if ":" in line)
            if fields.get("PPid", "").strip() != str(me) or fields.get("Uid", "").split()[:1] != [str(uid)]:
                continue
            try:
                if os.waitpid(int(name), os.WNOHANG)[0] == 0:
                    left += 1
            except ChildProcessError:
                pass
        if not left:
            return
        time.sleep(0.02)


def run_step(argv, uid, job, cpu_s, wall_s, mem_mb, nproc, env, fsize=FILE_CAP, run_here=False):
    out = tempfile.TemporaryFile(dir=JOBS)
    err = tempfile.TemporaryFile(dir=JOBS)
    ruleset = prepare_landlock(build_rules(job, run_here))
    t0 = time.time()
    status = "ok"
    try:
        try:
            p = subprocess.Popen(argv, cwd=job, stdin=subprocess.DEVNULL, stdout=out, stderr=err, env=env, close_fds=True,
                                 preexec_fn=make_preexec(uid, ruleset, cpu_s, mem_mb, nproc, fsize))
        finally:
            os.close(ruleset)
        try:
            code = p.wait(timeout=wall_s)
        except subprocess.TimeoutExpired:
            status = "timeout"
            kill_uid(uid)
            code = p.wait()
        if code in (-signal.SIGXCPU, -signal.SIGKILL) and status == "ok":
            status = "timeout"
        if code == -signal.SIGXFSZ:
            status = "output_limit"
        out.seek(0)
        err.seek(0)
        return status, code, out.read(OUT_CAP).decode("utf-8", "replace"), err.read(OUT_CAP).decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    finally:
        out.close()
        err.close()


JAVA_RUN_FLAGS = ["-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:CICompilerCount=1",
                  "-XX:-UsePerfData", "-XX:-UseContainerSupport", "-XX:ReservedCodeCacheSize=32m",
                  "-XX:MaxMetaspaceSize=128m", "-XX:CompressedClassSpaceSize=64m", "-Xss8m", "-Xshare:auto"]


# Node: V8 needs ~700 MB of address space before any code runs, and WebAssembly's usual 10 GB reservation
# won't fit under RLIMIT_AS, so it's switched to bounds checks (TypeScript's type stripping is WebAssembly).
NODE_FLAGS = ["--disable-wasm-trap-handler", "--experimental-transform-types", "--no-warnings", "--stack-size=4000"]
CC_FLAGS = {
    "c": ["-std=gnu17", "-O2", "-pipe", "-w", "-fmax-errors=20", "-fdiagnostics-color=never"],
    # -D_GLIBCXX_ASSERTIONS: an index out of range on a vector stops the program instead of reading garbage.
    # These flags must match the ones bqpre.hpp.gch was built with (Dockerfile).
    "cpp": ["-std=gnu++17", "-O2", "-pipe", "-w", "-fmax-errors=20", "-fdiagnostics-color=never", "-D_GLIBCXX_ASSERTIONS", "-I/opt/bq/cpp"],
}
LANGS = ("java", "python", "javascript", "typescript", "c", "cpp", "csharp", "go", "rust", "swift", "ruby")
CS = "/opt/bq/cs"  # csc, the reference assemblies and the runtime config (Dockerfile)
CS_FLAGS = ["-nologo", "-noconfig", "-nostdlib", "@" + CS + "/refs.rsp", "-langversion:latest", "-nullable:disable", "-optimize+",
            "-debug:portable", "-warn:0", "-target:exe", "-out:main.dll"]
# .NET reserves ~1.5 GB of address space at start, whatever its heap limit. No diagnostics socket (sockets are
# denied), and no W^X double mapping of its code (it can't set that up in the sandbox, and fails to start).
DOTNET_ENV = {"DOTNET_EnableDiagnostics": "0", "DOTNET_EnableWriteXorExecute": "0", "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
              "DOTNET_NOLOGO": "1", "DOTNET_gcServer": "0"}
SWIFT_FLAGS = ["-Onone", "-suppress-warnings", "-diagnostic-style", "llvm", "-module-cache-path", "mc", "-o", "main"]
GO = "/opt/bq/go"  # the standard library, compiled when the image was built (Dockerfile)
# The linker by its full path: with a bare name, Rust's process spawning (rustc changes PATH for the linker)
# takes a route that needs socketpair, which the sandbox denies.
RUST_FLAGS = ["--edition", "2021", "-C", "opt-level=1", "-C", "debuginfo=0", "-C", "linker=/usr/bin/cc", "--color", "never", "-A", "warnings"]


def run_job(slot, req):
    uid = UID_BASE + slot
    lang = req.get("language")
    files = req.get("files") or {}
    time_ms = max(200, min(10000, int(req.get("timeMs") or 2000)))
    mem_mb = max(64, min(512, int(req.get("memoryMb") or 256)))
    if lang not in LANGS or not isinstance(files, dict) or not files or len(files) > 20:
        return {"status": "error", "message": "bad job"}
    sources = req.get("sources")
    include = req.get("include")
    entry = req.get("entry")
    if entry is not None and (not isinstance(entry, str) or not entry.isidentifier()):
        return {"status": "error", "message": "bad job"}
    if lang in ("c", "cpp", "go", "rust", "csharp", "swift"):
        if sources is None:
            sources = sorted(n for n in files if n.endswith({"c": ".c", "cpp": ".cpp", "go": ".go", "rust": ".rs", "csharp": ".cs", "swift": ".swift"}[lang]))
        if not isinstance(sources, list) or not sources or not all(isinstance(n, str) and n in files for n in sources):
            return {"status": "error", "message": "bad job"}
        if include not in (None, "bqpre.h", "bqpre.hpp"):
            return {"status": "error", "message": "bad job"}
    total = 0
    for name, body in files.items():
        if not isinstance(name, str) or not isinstance(body, str) or not name or len(name) > 64 \
                or not all(c.isalnum() or c in "._-" for c in name) or name.startswith("."):
            return {"status": "error", "message": "bad file name"}
        total += len(body.encode("utf-8"))
    if total > 400 * 1024:
        return {"status": "error", "message": "job too large"}

    job = tempfile.mkdtemp(prefix="job-", dir=JOBS)
    try:
        for name, body in files.items():
            with open(os.path.join(job, name), "w", encoding="utf-8") as f:
                f.write(body)
            os.chown(os.path.join(job, name), uid, uid)
        os.chown(job, uid, uid)
        os.chmod(job, 0o700)
        env = {"PATH": "/usr/bin:/bin", "HOME": job, "LANG": "C.UTF-8", "MALLOC_ARENA_MAX": "2", "TMPDIR": job}
        cpu_s = max(1, -(-time_ms // 1000))
        wall_s = cpu_s * 3 + 3
        if lang == "java":
            javac = shutil.which("javac")
            srcs = sorted(n for n in files if n.endswith(".java"))
            st, code, out, err, ms = run_step(
                [javac, "-J-XX:ActiveProcessorCount=1", "-J-Xmx384m", "-J-XX:+UseSerialGC", "-J-XX:-UsePerfData",
                 "-J-XX:TieredStopAtLevel=1", "-J-XX:-UseContainerSupport", "-encoding", "UTF-8", "-nowarn", "-d", "."] + srcs,
                uid, job, 20, 40, 3072, 256, env)
            kill_uid(uid)
            if st != "ok" or code != 0:
                return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                        "exitCode": code, "ms": ms}
            argv = [shutil.which("java"), f"-Xmx{mem_mb}m"] + JAVA_RUN_FLAGS + ["-cp", ".", req.get("main") or "BQMain"]
            st, code, out, err, ms = run_step(argv, uid, job, cpu_s, wall_s, mem_mb + 1536, 256, env)
        elif lang in ("c", "cpp"):
            cc = shutil.which("g++" if lang == "cpp" else "gcc")
            argv = [cc] + CC_FLAGS[lang] + (["-include", include] if include else []) + ["-o", "main"] + sources + (["-lm"] if lang == "c" else [])
            st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 2048, 64, env, fsize=32 << 20)
            kill_uid(uid)
            if st != "ok" or code != 0:
                return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                        "exitCode": code, "ms": ms}
            st, code, out, err, ms = run_step([os.path.join(job, "main")], uid, job, cpu_s, wall_s, mem_mb + 64, 64, env, run_here=True)
        elif lang in ("go", "rust"):
            if lang == "go":
                steps = [[os.path.join(GO, "tool", "compile"), "-p", "main", "-importcfg", os.path.join(GO, "importcfg"), "-pack", "-o", "main.a"] + sources,
                         [os.path.join(GO, "tool", "link"), "-importcfg", os.path.join(GO, "importcfg"), "-o", "main", "main.a"]]
            else:
                steps = [[shutil.which("rustc")] + RUST_FLAGS + ["-o", "main", sources[0]]]
            for argv in steps:
                st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 2048, 64, env, fsize=64 << 20)
                kill_uid(uid)
                if st != "ok" or code != 0:
                    return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                            "exitCode": code, "ms": ms}
            # Go reserves ~800 MB of address space before it starts; GOMEMLIMIT keeps its heap to the limit.
            run_env = dict(env, GOMEMLIMIT=f"{mem_mb}MiB", GOMAXPROCS="2") if lang == "go" else env
            st, code, out, err, ms = run_step([os.path.join(job, "main")], uid, job, cpu_s, wall_s,
                                              mem_mb + (1536 if lang == "go" else 128), 64, run_env, run_here=True)
        elif lang in ("csharp", "swift"):
            if lang == "csharp":
                argv = [shutil.which("dotnet"), "exec", CS + "/csc.dll"] + CS_FLAGS + (["-main:" + entry] if entry else []) + sources
                cenv = dict(env, **DOTNET_ENV, DOTNET_GCHeapHardLimit=hex(1536 << 20))
            else:
                argv = [shutil.which("swiftc")] + SWIFT_FLAGS + sources
                cenv = env
            st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 4096, 64, cenv, fsize=64 << 20)
            kill_uid(uid)
            if st != "ok" or code != 0:
                return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                        "exitCode": code, "ms": ms}
            if lang == "csharp":
                st, code, out, err, ms = run_step([shutil.which("dotnet"), "exec", "--runtimeconfig", CS + "/main.runtimeconfig.json", "main.dll"],
                                                  uid, job, cpu_s, wall_s, mem_mb + 1792, 64,
                                                  dict(env, **DOTNET_ENV, DOTNET_GCHeapHardLimit=hex(mem_mb << 20)))
            else:
                st, code, out, err, ms = run_step([os.path.join(job, "main")], uid, job, cpu_s, wall_s, mem_mb + 256, 64,
                                                  dict(env, SWIFT_BACKTRACE="enable=no"), run_here=True)
        elif lang == "ruby":
            st, code, out, err, ms = run_step([shutil.which("ruby"), "--disable-gems", "-W0", req.get("main") or "main.rb"],
                                              uid, job, cpu_s, wall_s, mem_mb + 256, 64, env)
        elif lang in ("javascript", "typescript"):
            argv = [shutil.which("node"), f"--max-old-space-size={mem_mb}"] + NODE_FLAGS + [req.get("main") or "main.cjs"]
            st, code, out, err, ms = run_step(argv, uid, job, cpu_s, wall_s, mem_mb + 1024, 64, env)
        else:
            argv = [shutil.which("python3"), "-E", "-s", "-B", "-X", "utf8", req.get("main") or "main.py"]
            st, code, out, err, ms = run_step(argv, uid, job, cpu_s, wall_s, mem_mb + 128, 64, env)
        return {"status": st, "stdout": out, "stderr": err, "exitCode": code, "ms": ms}
    finally:
        kill_uid(uid)
        shutil.rmtree(job, ignore_errors=True)


SLOT_Q = queue.Queue()
for _s in range(SLOTS):
    SLOT_Q.put(_s)


class Handler(BaseHTTPRequestHandler):
    server_version = "bq-runner"
    sys_version = ""

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "landlock": ABI, "slots": SLOTS})
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/run":
            return self._send(404, {"error": "not_found"})
        auth = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(auth.encode(), ("Bearer " + TOKEN).encode()):
            return self._send(401, {"error": "unauthorized"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "too_large"})
        try:
            req = json.loads(self.rfile.read(n))
        except Exception:
            return self._send(400, {"error": "bad_json"})
        try:
            slot = SLOT_Q.get(timeout=60)
        except queue.Empty:
            return self._send(503, {"error": "busy"})
        try:
            res = run_job(slot, req)
        except Exception as e:  # never leak details of the host
            print("job failed:", repr(e), flush=True)
            res = {"status": "error", "message": "runner error"}
        finally:
            SLOT_Q.put(slot)
        self._send(200, res)


def self_test():
    problems = []
    if os.getuid() != 0:
        problems.append("must run as root inside its container (it drops to a per-slot uid for every job)")
    # Landlock does the filesystem jail (any ABI). Network is blocked by seccomp (socket and io_uring
    # denied), which the probe below proves; Landlock ABI 4+ (kernel 6.7+) adds a second network block.
    if ABI < 1:
        problems.append("Landlock is missing: the host kernel needs Landlock enabled (Linux 5.13+)")
    if len(TOKEN) < 16:
        problems.append("RUNNER_TOKEN must be set to 16+ random characters")
    if not os.path.isdir(JOBS):
        problems.append(f"{JOBS} does not exist")
    for b in ("java", "javac", "python3"):
        if not shutil.which(b):
            problems.append(f"{b} is not installed")
    if problems:
        return problems
    probe = ("import socket, os\n"
             "def t(f):\n"
             "    try:\n        f(); return 'ALLOWED'\n"
             "    except Exception as e:\n        return 'blocked'\n"
             "print('net', t(lambda: socket.socket()))\n"
             "print('etc', t(lambda: open('/etc/hostname').read()))\n"
             "print('ok')\n")
    res = run_job(0, {"language": "python", "files": {"main.py": probe}, "main": "main.py", "timeMs": 2000})
    out = res.get("stdout", "")
    if "net blocked" not in out or "etc blocked" not in out or "ok" not in out:
        problems.append(f"sandbox self-test failed: {res}")
    return problems


def language_test():
    """The other languages, run once at start. A problem here is reported, not fatal: Java and Python still work."""
    notes = []
    probes = [
        ("javascript", {"main.js": "console.log('ok' + (1 + 1))"}, "main.js", None),
        ("typescript", {"main.ts": "const n: number = 2;\nconsole.log('ok' + n)"}, "main.ts", None),
        ("c", {"main.c": "#include <stdio.h>\nint main(void) { printf(\"ok%d\\n\", 1 + 1); return 0; }"}, "main", ["main.c"]),
        ("cpp", {"main.cpp": "int main() { vector<int> v{1, 1}; cout << \"ok\" << v[0] + v[1] << endl; }"}, "main", ["main.cpp"]),
        ("go", {"main.go": "package main\nimport \"fmt\"\nfunc main() { fmt.Printf(\"ok%d\\n\", 1+1) }"}, "main", ["main.go"]),
        ("rust", {"main.rs": "fn main() { let v = vec![1, 1]; println!(\"ok{}\", v[0] + v[1]); }"}, "main", ["main.rs"]),
        ("csharp", {"main.cs": "System.Console.WriteLine(\"ok\" + (1 + 1));"}, "main", ["main.cs"]),
        ("swift", {"main.swift": "print(\"ok\\(1 + 1)\")"}, "main", ["main.swift"]),
        ("ruby", {"main.rb": "puts \"ok#{1 + 1}\""}, "main.rb", None),
    ]
    for lang, files, main, sources in probes:
        need = {"javascript": "node", "typescript": "node", "c": "gcc", "cpp": "g++", "go": None, "rust": "rustc", "csharp": "dotnet",
                "swift": "swiftc", "ruby": "ruby"}[lang]
        if (need and not shutil.which(need)) or (lang == "go" and not os.path.exists(os.path.join(GO, "importcfg"))):
            notes.append(f"{lang}: not installed")
            continue
        req = {"language": lang, "files": files, "main": main, "timeMs": 3000}
        if sources:
            req["sources"] = sources
        if lang == "cpp":
            req["include"] = "bqpre.hpp"
        res = run_job(0, req)
        if "ok2" not in res.get("stdout", ""):
            notes.append(f"{lang}: self-test failed: {json.dumps(res)[:400]}")
    return notes


if __name__ == "__main__":
    os.makedirs(JOBS, exist_ok=True)
    os.chmod(JOBS, 0o711)
    # PID 1 ignores SIGTERM unless it asks for it, so docker stop would wait 10s and SIGKILL.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    problems = self_test()
    if problems:
        print("runner: not starting, so code questions can't run:", flush=True)
        for p in problems:
            print("  -", p, flush=True)
        if os.getpid() == 1:
            # In a container: stay parked instead of exiting, or Docker restarts it forever and
            # repeats this message. The health check reports it as unhealthy.
            while True:
                signal.pause()
        sys.exit(1)
    for note in language_test():
        print("runner: warning:", note, flush=True)
    extras = [f"landlock ABI {ABI}", "network blocked by seccomp" + (" and landlock" if ABI >= 4 else "")]
    if ABI >= 6:
        extras.append("signal scoping on")
    print(f"runner: sandbox ok ({', '.join(extras)}), {SLOTS} slots, listening on :{PORT}", flush=True)
    # Listen on IPv6 and IPv4 both: Railway's private network can be IPv6-only.
    class DualStackServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6

        def server_bind(self):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            super().server_bind()

    try:
        server = DualStackServer(("::", PORT), Handler)
    except OSError:  # no IPv6 in this container
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
