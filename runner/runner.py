#!/usr/bin/env python3
"""BrowserQuiz code runner.

Compiles and runs student Java, Python, JavaScript, TypeScript, C, C++, C#, Go and Rust inside "jail-lite", a sandbox built only from unprivileged
kernel features (it works on hosts like Railway that don't allow privileged containers):

  * a separate uid per worker slot; everything that uid owns is killed after every job
  * rlimits: CPU, address space, processes, file size, open files, no core dumps
  * Landlock: read-only access to the runtimes, read-write to the job dir only (and running a program from
    it only for a compiled C/C++ job's own binary), all TCP denied,
    signals and abstract unix sockets scoped to the job (ABI 6+)
  * seccomp: x32 syscalls kill the process; sockets, io_uring, SysV IPC, ptrace, bpf, keyctl,
    namespaces and friends are denied
  * a wall-clock timeout, output written to a capped file the job can't reach, and a per-job disk budget:
    each slot has its own job area (its own size-limited tmpfs with Docker Compose), and a job that writes
    more than DISK_CAP_MB is stopped

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
import re
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

import each

TOKEN = os.environ.get("RUNNER_TOKEN", "")
JOBS = os.environ.get("JOBS_DIR", "/jobs")
SLOTS = max(1, int(os.environ.get("RUNNER_SLOTS", "4")))
UID_BASE = int(os.environ.get("RUNNER_UID_BASE", "1234567000"))
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 512 * 1024
OUT_DIR = os.environ.get("RUNNER_OUT_DIR", "/var/tmp/bq-out")  # captured stdout/stderr: the runner's alone
DISK_CAP = max(8, int(os.environ.get("DISK_CAP_MB", "64"))) << 20
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


def build_rules(job, tools=(), run_file=None):
    java = _real("java")
    java_home = os.path.dirname(os.path.dirname(java)) if java else ""
    # (the job's own /proc/self is added in the child, where it names the job and not this process)
    read_dirs = ["/usr", "/lib", "/lib64", "/etc/alternatives", "/etc/ssl", java_home, "/sys/devices/system/cpu", "/opt/bq"]
    read_dirs += [os.path.join("/etc", n) for n in os.listdir("/etc") if n.startswith("java")]
    read_files = ["/etc/ld.so.cache", "/etc/localtime", "/etc/timezone", "/proc/meminfo", "/proc/cpuinfo", "/proc/stat",
                  "/dev/urandom", "/dev/random", "/dev/zero"]
    # the dynamic loader and shared libraries, and gcc's own programs (cc1, collect2)
    exec_dirs = ["/lib", "/lib64", "/usr/lib", "/usr/lib64", "/usr/libexec/gcc"]
    # Only this step's own tools can be run (javac for Java's compile, gcc and its helpers for C, ...), and from
    # the job dir only its compiled program, when this is the run step of a compiled language.
    exec_files = sorted(set(p for p in (_real(t) for t in tools) if p))
    if run_file:
        exec_files.append(run_file)
    return dict(read_dirs=read_dirs, read_files=read_files, exec_dirs=exec_dirs, exec_files=exec_files,
                rw_dirs=[job], rw_files=["/dev/null"])


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
            add(d, handled & ~FS_EXECUTE)
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


def job_bytes(job):
    """Bytes the job dir holds (blocks really used, so a sparse file counts what it takes), or None for a tree
    too big to count, which is over budget anyway."""
    total, seen, stack = 0, 0, [job]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    seen += 1
                    if seen > 20000:
                        return None
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    total += st.st_blocks * 512
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
        except OSError:
            pass
    return total


def run_step(argv, uid, job, cpu_s, wall_s, mem_mb, nproc, env, fsize=FILE_CAP, tools=(), run_file=None, cap=OUT_CAP):
    out = tempfile.TemporaryFile(dir=OUT_DIR)
    err = tempfile.TemporaryFile(dir=OUT_DIR)
    ruleset = prepare_landlock(build_rules(job, tools, run_file))
    t0 = time.time()
    status = "ok"
    try:
        try:
            p = subprocess.Popen(argv, cwd=job, stdin=subprocess.DEVNULL, stdout=out, stderr=err, env=env, close_fds=True,
                                 preexec_fn=make_preexec(uid, ruleset, cpu_s, mem_mb, nproc, fsize))
        finally:
            os.close(ruleset)
        # Wait, and keep an eye on how much the job writes: one that fills its disk would starve the others.
        code = None
        while code is None:
            try:
                code = p.wait(timeout=0.05)
            except subprocess.TimeoutExpired:
                used = job_bytes(job)
                if used is None or used > DISK_CAP:
                    status = "disk_limit"
                elif time.time() - t0 > wall_s:
                    status = "timeout"
                else:
                    continue
                kill_uid(uid)
                code = p.wait()
        if code in (-signal.SIGXCPU, -signal.SIGKILL) and status == "ok":
            status = "timeout"
        if code == -signal.SIGXFSZ and status == "ok":
            status = "output_limit"
        out.seek(0)
        err.seek(0)
        return status, code, out.read(cap).decode("utf-8", "replace"), err.read(OUT_CAP).decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    finally:
        out.close()
        err.close()


JAVA_RUN_FLAGS = ["-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:CICompilerCount=1",
                  "-XX:-UsePerfData", "-XX:-UseContainerSupport", "-XX:ReservedCodeCacheSize=32m",
                  "-XX:MaxMetaspaceSize=128m", "-XX:CompressedClassSpaceSize=64m", "-Xss8m", "-Xshare:auto"]


# Node: V8 needs ~700 MB of address space before any code runs, and WebAssembly's usual 10 GB reservation
# won't fit under RLIMIT_AS, so it's switched to bounds checks (TypeScript's type stripping is WebAssembly).
NODE_FLAGS = ["--disable-wasm-trap-handler", "--experimental-transform-types", "--no-warnings", "--stack-size=4000"]
# Library calls stay calls, so the ban check sees them in the compiled object: no builtins (strlen, abs and
# friends compiled inline), no loops turned into memset or memcpy, and in C++ no inlining, no identical
# functions folded together and no copies of a function specialized for its callers. Every program is built
# this way, checked or not, so code can't tell which build it's in.
CC_FLAGS = {
    "c": ["-std=gnu17", "-O2", "-pipe", "-w", "-fmax-errors=20", "-fdiagnostics-color=never", "-fno-builtin", "-fno-tree-loop-distribute-patterns"],
    # -D_GLIBCXX_ASSERTIONS: an index out of range on a vector stops the program instead of reading garbage.
    # These flags must match the ones bqpre.hpp.gch was built with (Dockerfile).
    "cpp": ["-std=gnu++17", "-O2", "-pipe", "-w", "-fmax-errors=20", "-fdiagnostics-color=never", "-D_GLIBCXX_ASSERTIONS", "-I/opt/bq/cpp",
            "-fno-inline", "-fno-builtin", "-fno-tree-loop-distribute-patterns", "-fno-ipa-icf", "-fno-ipa-cp", "-ffunction-sections"],
}
LANGS = ("java", "python", "javascript", "typescript", "c", "cpp", "csharp", "go", "rust")
# The image's kind (Dockerfile): the standard runner has Java, Python, JavaScript and TypeScript only.
KIND = os.environ.get("RUNNER_LANGS", "full")
STANDARD = ("java", "python", "javascript", "typescript")
# The languages that ran at start (language_test): what /health says, and the only ones a job may use.
AVAILABLE = list(LANGS)
CS = "/opt/bq/cs"  # csc, the reference assemblies and the runtime config (Dockerfile)
CS_FLAGS = ["-nologo", "-noconfig", "-nostdlib", "@" + CS + "/refs.rsp", "-langversion:latest", "-nullable:disable", "-optimize+",
            "-debug:portable", "-warn:0", "-target:exe", "-out:main.dll"]
# .NET reserves ~1.5 GB of address space at start, whatever its heap limit. No diagnostics socket (sockets are
# denied), and no W^X double mapping of its code (it can't set that up in the sandbox, and fails to start).
DOTNET_ENV = {"DOTNET_EnableDiagnostics": "0", "DOTNET_EnableWriteXorExecute": "0", "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
              "DOTNET_NOLOGO": "1", "DOTNET_gcServer": "0"}
GO = "/opt/bq/go"  # the standard library, compiled when the image was built (Dockerfile)
# The languages whose jobs can ask to be built once and run each (each.py). The ones that did it at start
# (each_test): what /health says, and the only ones a job's "runs" is taken for.
EACH_LANGS = ("java", "c", "cpp", "csharp", "go", "rust")
EACH = list(EACH_LANGS)
# The linker by its full path: with a bare name, Rust's process spawning (rustc changes PATH for the linker)
# takes a route that needs socketpair, which the sandbox denies.
RUST_FLAGS = ["--edition", "2021", "-C", "opt-level=1", "-C", "debuginfo=0", "-C", "linker=/usr/bin/cc", "--color", "never", "-A", "warnings"]


# The ban check (server/src/bans.js) for compiled languages: facts about what the student's code uses, read
# from what the compiler made of it before any of their code runs. In C and C++ that's the very object the
# program is linked from (so the code can't tell it's being checked), C in its own translation unit; Go is
# its own type checker over the same files; C# a library compiled from the student's files alone.
SCAN_CAP = 32 << 20
LIB_NS = ("std", "__gnu_cxx", "__cxxabiv1")  # in a C++ object, the library's own code


def scan_steps(lang, scan, sources, objs, include):
    if lang == "c":
        return [[shutil.which("nm"), "-u", objs[sources.index(scan[0])]]], [["nm"]]
    if lang == "cpp":
        pre = ["-include", include] if include else []
        return ([[shutil.which("readelf"), "-SrsW", "-C", objs[sources.index(scan[0])]],
                 [shutil.which("g++")] + CC_FLAGS["cpp"] + pre + ["-E", "-fpch-preprocess", scan[0]]],
                [["readelf"], ["g++"]])
    if lang == "go":
        return [[GO + "/bqscan", "-importcfg", GO + "/importcfg", "-own", ",".join(scan)] + sources], [[GO + "/bqscan"]]
    if lang == "csharp":
        flags = [f for f in CS_FLAGS if not f.startswith(("-target:", "-out:"))] + ["-target:library", "-out:bqscan.dll"]
        return ([[shutil.which("dotnet"), "exec", CS + "/csc.dll"] + flags + scan,
                 [shutil.which("dotnet"), "exec", "--runtimeconfig", CS + "/main.runtimeconfig.json", CS + "/bqscan.dll", "bqscan.dll"]],
                [["dotnet"], ["dotnet"]])
    return [], []


# Processes for code that runs as one: C, C++, Rust and Python answers. A few spare, but not the dozens a
# fork loop needs to crowd out every other job on the runner (Go, Java, C# and Node keep threads of their own).
SINGLE_NPROC = 8


class ScanTimeout(Exception):
    """The check ran out of time: a busy runner as likely as the code. The job fails, to be graded again."""


def run_scan(lang, scan, sources, objs, include, files, uid, job, env):
    """The facts as text, or None when the check couldn't read the code (which then counts against it)."""
    argvs, tools = scan_steps(lang, scan, sources, objs, include)
    outs = []
    for argv, tl in zip(argvs, tools):
        senv = dict(env, **DOTNET_ENV, DOTNET_GCHeapHardLimit=hex(1536 << 20)) if lang == "csharp" else env
        st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 4096, 64, senv, fsize=64 << 20, tools=tl, cap=SCAN_CAP)
        kill_uid(uid)
        if st == "timeout":
            raise ScanTimeout()
        if st != "ok" or code != 0 or len(out) >= SCAN_CAP:
            return None
        outs.append(out)
    try:
        if lang == "c":
            return "\n".join(sorted(set("ref " + m.group(1) for m in re.finditer(r"^\s*[Uwv] (\S+)$", outs[0], re.M))))
        if lang == "cpp":
            return cpp_facts(outs[0], outs[1], [files[n] for n in scan[1:]])
        return outs[-1]
    except Exception:  # a shape we don't know: say nothing for the code
        return None


# ---- C++: who calls what, from the object's relocations
_OPS = sorted(["<<=", ">>=", "<=>", "->*", "<<", ">>", "<=", ">=", "->", "()", "[]", "==", "!=", "&&", "||", "++", "--", "+=", "-=",
               "*=", "/=", "%=", "&=", "|=", "^=", "<", ">", "+", "-", "*", "/", "%", "^", "&", "|", "~", "!", "=", ","], key=len, reverse=True)
_SPECIAL = ("vtable for ", "VTT for ", "typeinfo for ", "typeinfo name for ", "construction vtable for ", "guard variable for ",
            "non-virtual thunk to ", "virtual thunk to ", "covariant return thunk to ", "TLS init function for ", "TLS wrapper function for ",
            "transaction clone for ", "reference temporary #0 for ")
_QUALS = {"const", "volatile", "&", "&&", "noexcept", "throw"}


def cpp_path(name):
    """'void std::sort<...>(...)' -> 'std::sort'; 'Solution::f(...)::{lambda(int)#1}::operator()(int) const' ->
    'Solution::f::{lambda}::operator()'."""
    s = name.strip()
    again = True
    while again:
        again = False
        for p in _SPECIAL:
            if s.startswith(p):
                s, again = s[len(p):], True
    s = re.sub(r"\[(?:clone [^\]]*|abi:[^\]]*)\]", "", s)
    s = s.replace("(anonymous namespace)", "{anon}")
    s = re.sub(r"\{lambda\([^{}]*\)#\d+\}", "{lambda}", s)
    ops = []

    def op(m):
        ops.append(m.group(1))
        return "operator@%d" % (len(ops) - 1)
    s = re.sub(r"\boperator\s*(new\[\]|delete\[\]|new\b|delete\b|" + '""' + r"\s*\w+|" + "|".join(re.escape(o) for o in _OPS) + ")", op, s)
    s = re.sub(r"\boperator\s+[^()]+?(?=\()", "operator@cast", s)  # conversion operators
    prev = None
    while prev != s:
        prev, s = s, re.sub(r"<[^<>]*>", "", s)
    prev = None
    while prev != s:
        prev, s = s, re.sub(r"\([^()]*\)", "", s)
    toks = [t for t in s.split() if t not in _QUALS and re.search(r"[\w@{}~]", t)]
    if not toks:
        return ""
    last = re.sub(r"^[*&]+", "", toks[-1])
    return re.sub(r"operator@(\d+)", lambda m: "operator" + ops[int(m.group(1))], last)


def cpp_facts(elf, pre, raw):
    sections = {}  # index -> name
    rela_target = {}  # a relocation section's file offset -> the index of the section it relocates
    sec_re = re.compile(r"^\s*\[\s*(\d+)\]\s+(\S+)\s+(\S+)\s+[0-9a-f]+\s+([0-9a-f]+)\s+[0-9a-f]+\s+[0-9a-f]+\s+[A-Za-z]*\s+\d+\s+(\d+)\s+\d+\s*$")
    sym_re = re.compile(r"^\s*\d+:\s+([0-9a-f]+)\s+(0x[0-9a-f]+|\d+)\s+(\w+)\s+\w+\s+\w+\s+(\w+)\s+(.*)$")
    rel_head = re.compile(r"^Relocation section '(.*)' at offset 0x([0-9a-f]+) contains")
    rel_re = re.compile(r"^([0-9a-f]+)\s+[0-9a-f]+\s+\S+\s+[0-9a-f]+\s+(.*?)\s+[+-]\s+[0-9a-f]+\s*$")
    syms = []  # (section index, value, size, name)
    by_name = {}  # symbol name -> defined (True) / undefined (False)
    relocs = []  # (relocated section index or None, offset, target name, skip)
    mode = None
    cur = None
    for line in elf.split("\n"):
        if line.startswith("Section Headers:"):
            mode = "sec"
            continue
        if line.startswith("Symbol table"):
            mode = "sym"
            continue
        m = rel_head.match(line)
        if m:
            mode = "rel"
            name = m.group(1)
            skip = name.startswith((".rela.eh_frame", ".rela.gcc_except_table", ".rela.debug", ".rela.note"))
            cur = (rela_target.get(int(m.group(2), 16)), skip)
            continue
        if mode == "sec":
            m = sec_re.match(line)
            if m:
                idx, name, typ, off, inf = int(m.group(1)), m.group(2), m.group(3), int(m.group(4), 16), int(m.group(5))
                sections[idx] = name
                if typ in ("RELA", "REL"):
                    rela_target[off] = inf
        elif mode == "sym":
            m = sym_re.match(line)
            if m:
                value, size, typ, ndx, name = int(m.group(1), 16), int(m.group(2), 0), m.group(3), m.group(4), m.group(5).strip()
                if ndx == "UND":
                    by_name.setdefault(name, False)
                elif ndx.isdigit() and typ in ("FUNC", "OBJECT", "NOTYPE", "TLS", "GNU_IFUNC"):
                    syms.append((int(ndx), value, size, name))
                    by_name[name] = True
        elif mode == "rel" and cur is not None:
            m = rel_re.match(line)
            if m:
                relocs.append((cur[0], int(m.group(1), 16), m.group(2), cur[1]))
    in_section = {}
    for ndx, value, size, name in syms:
        in_section.setdefault(ndx, []).append((value, size, name))
    names_of_section = {}
    for idx, name in sections.items():
        names_of_section.setdefault(name, []).append(idx)
    lib = lambda p: p.split("::")[0] in LIB_NS  # noqa: E731
    out = set()
    for ndx, off, target, skip in relocs:
        if skip:
            continue
        owners = [cpp_path(n) for v, z, n in in_section.get(ndx, []) if v <= off < v + max(z, 1)] if ndx is not None else []
        if not owners:
            # No symbol covers it: count it, unless it points at code by its section (a jump table, say)
            if target in names_of_section:
                continue
            owners = ["?"]
        owners = [o for o in owners if o and not lib(o)]
        if not owners:
            continue  # the library's own code
        if target in names_of_section:  # a section's own symbol: what's defined there
            targets = [(cpp_path(n), "D") for i in names_of_section[target] for v, z, n in in_section.get(i, [])]
        else:
            targets = [(cpp_path(target), "D" if by_name.get(target) else "U")]
        for t, kind in targets:
            if t:
                for o in owners:
                    out.add("call %s\t%s\t%s" % (o, t, kind))
    out.update(cpp_source_facts(pre, raw))
    return "\n".join(sorted(out))


def cpp_code_only(src):
    """C or C++ source with its line splices joined, comments blanked and string and character literals
    emptied (raw strings too), newlines kept: what's left is where a directive could be."""
    src = re.sub(r"\\\r?\n", "", src)
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif c == "/" and src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(" " + "\n" * src.count("\n", i, j))
            i = j
        elif c == '"' or c == "'":
            raw = None
            if c == '"' and i > 0 and src[i - 1] == "R":
                k = i - 1
                k -= 2 if src[max(0, k - 2):k] == "u8" else 1 if k > 0 and src[k - 1] in "uUL" else 0
                if k == 0 or not (src[k - 1].isalnum() or src[k - 1] == "_"):
                    raw = re.compile(r"([^ ()\\\t\v\f\n]{0,16})\(").match(src, i + 1)
            if raw:
                end = ")" + raw.group(1) + '"'
                j = src.find(end, raw.end())
                j = n if j < 0 else j + len(end)
            else:
                j = i + 1
                while j < n and src[j] != c and src[j] != "\n":
                    j += 2 if src[j] == "\\" else 1
                j = min(n, j + 1)
            out.append(c + c + "\n" * src.count("\n", i, j))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def cpp_source_facts(pre, raw):
    """What the compiled object can't say: the student's code reopening the library's namespaces (or the
    harness's), inline asm, symbol renaming, and includes of anything but a system header. Read from the
    preprocessed translation unit, the student's file's parts only; its line markers can be trusted because
    the student's own source isn't allowed to write any."""
    facts = set()
    for src in raw:
        if re.search(r"^[ \t]*(?:#|%:)[ \t]*(?:\d|line\b)", cpp_code_only(src), re.M):
            facts.add("linemarker")
    stack = []
    owned = []
    marker = re.compile(r'^# (\d+) "((?:[^"\\]|\\.)*)"((?: \d+)*)\s*$')
    for line in pre.split("\n"):
        m = marker.match(line)
        if m:
            name, flags = m.group(2), m.group(3).split()
            base = name.replace("\\\\", "\\").rsplit("/", 1)[-1]
            if "1" in flags:
                parent = bool(stack) and stack[-1]
                mine = base == "solution.cpp"
                if parent and not mine and ("3" not in flags or
                                            re.search(r"/c\+\+/[^/]+/(?:ext|parallel|tr1|tr2|experimental|pstl|debug|backward|profile)/", name)):
                    facts.add("include " + re.sub(r"^.*/include/(?:c\+\+/[^/]+/)?", "", name))
                stack.append(mine)
            elif "2" in flags:
                if stack:
                    stack.pop()
            elif not stack:
                stack.append(False)  # the harness's own file
            continue
        if stack and stack[-1]:
            owned.append(line)
    text = "\n".join(owned)
    ns = LIB_NS + ("bq",)
    for m in re.finditer(r"\b(\w+)?\s*\bnamespace\s*(?:\[\[[^\]]*\]\]\s*)*(\w+)", text):
        if m.group(1) != "using" and m.group(2) in ns:
            facts.add("namespace " + m.group(2))
    # Code put in those namespaces without opening one: a specialization (template<> struct std::hash<T>, or
    # template<> void std::swap(...)) is the student's code under the library's name.
    names = "|".join(ns)
    for m in re.finditer(r"\b(?:struct|class|union)\s+(?:::\s*)?(" + names + r")\s*::", text):
        facts.add("namespace " + m.group(1))
    for m in re.finditer(r"\btemplate\s*<\s*>\s*[^;{}()]*?(?<![\w:])(?:::\s*)?(" + names + r")\s*::\s*(?:\w+\s*(?:<[^;{}()]*>)?\s*::\s*)*"
                         r"(?:\w+|operator\s*[^\s(]+)\s*(?:<[^;{}()]*>)?\s*\(", text):
        facts.add("namespace " + m.group(1))
    if re.search(r"\b(?:asm|__asm|__asm__|redefine_extname|symver|weakref|ifunc)\b", text):
        facts.add("asm")
    if re.search(r"\b_Z\w+", text):
        facts.add("asm")
    return facts


# ---- Rust: the compile's own MIR, every call already resolved to what it is (bans.js reads it), and what
# the source does that MIR can't show: unsafe code (where a function could be reached by its address),
# files brought in (include!, #[path], mod name;), and the names the student's code defines.
MIR_CAP = 16 << 20


def rust_facts(job, sources):
    try:
        fd = os.open(os.path.join(job, "main.mir"), os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as f:
            raw = f.read(MIR_CAP + 1)
    except OSError:
        return None
    if len(raw) > MIR_CAP:
        return None
    mir = raw.decode("utf-8", "replace")
    facts = set()
    for src in sources:
        code = rust_code_only(src)
        for m in re.finditer(r"\b(?:struct|enum|trait|type|union|mod|fn|const|static)\s+(?:r#)?([A-Za-z_]\w*)|\bmacro_rules\s*!\s*([A-Za-z_]\w*)", code):
            facts.add("local " + (m.group(1) or m.group(2)))
        if re.search(r"\bunsafe\b", code):
            facts.add("escape unsafe")
        if re.search(r"\b(?:include|include_str|include_bytes)\s*!", code):
            facts.add("escape include!")
        if re.search(r"#\s*!?\s*\[\s*path\b", code):
            facts.add("escape #[path]")
        if re.search(r"\bmod\s+(?:r#)?\w+\s*;", code):
            facts.add("escape mod file")
    return "\n".join(sorted(facts)) + "\n@@mir\n" + mir


def rust_code_only(src):
    """Rust source with comments (nested ones too), string, byte string, raw string and char literals
    emptied. A lifetime ('a) stays."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif src.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if src.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif src.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            out.append(" ")
            i = j
        elif c in "rb" and re.match(r"(?:br|r)#*\"", src[i:i + 300]) and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] == "_")):
            m = re.match(r"(?:br|r)(#*)\"", src[i:])
            end = '"' + m.group(1)
            j = src.find(end, i + m.end())
            i = n if j < 0 else j + len(end)
            out.append('""')
        elif c == '"' or (c == "b" and src.startswith('b"', i) and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] == "_"))):
            j = i + (2 if c == "b" else 1)
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            out.append('""')
        elif c == "'":
            m = re.match(r"'(?:\\(?:u\{[0-9a-fA-F]{1,6}\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'", src[i:i + 16])
            if m:
                out.append("' '")
                i += m.end()
            else:  # a lifetime or label
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def each_job(slot, uid, job, env, runs, started, step, scan, facts):
    """A job's "runs" (each.py), from the build in job: step(run dir, its env, [k]) is run k's run_step, in a copy
    of the build of its own, which goes when it's done. The ban check's facts, read from the build, once."""
    def one(k):
        run = tempfile.mkdtemp(prefix="run-", dir=os.path.join(JOBS, str(slot)))
        try:
            os.chown(run, uid, uid)
            each.copy_build(job, run, uid)
            st, code, out, err, ms = step(run, dict(env, HOME=run, TMPDIR=run), [str(k)])
            return {"status": st, "stdout": out, "stderr": err, "exitCode": code, "ms": ms}
        finally:
            kill_uid(uid)
            shutil.rmtree(run, ignore_errors=True)
    res = {"status": "ok", "runs": each.run_each(runs, started, one), "ms": int((time.monotonic() - started) * 1000)}
    if scan:
        res["scan"] = facts
    return res


def run_job(slot, req):
    started = time.monotonic()
    uid = UID_BASE + slot
    lang = req.get("language")
    files = req.get("files") or {}
    time_ms = max(200, min(10000, int(req.get("timeMs") or 2000)))
    mem_mb = max(64, min(512, int(req.get("memoryMb") or 256)))
    if lang not in LANGS or not isinstance(files, dict) or not files or len(files) > 20:
        return {"status": "error", "message": "bad job"}
    if lang not in AVAILABLE:
        return {"status": "unavailable", "message": f"{lang} isn't on this runner"}
    sources = req.get("sources")
    include = req.get("include")
    scan = req.get("scan")
    if scan is not None and (lang not in ("c", "cpp", "go", "csharp", "rust") or not isinstance(scan, list) or not scan
                             or not all(isinstance(n, str) and n in files for n in scan)):
        return {"status": "error", "message": "bad job"}
    entry = req.get("entry")
    if entry is not None and (not isinstance(entry, str) or not entry.isidentifier()):
        return {"status": "error", "message": "bad job"}
    # Build once, run each (each.py). In another language it's left out, as a runner from before it would.
    runs = req.get("runs")
    if runs is not None and (type(runs) is not int or not 1 <= runs <= each.MAX_RUNS):
        return {"status": "error", "message": "bad job"}
    if lang not in EACH:
        runs = None
    if lang in ("c", "cpp", "go", "rust", "csharp"):
        if sources is None:
            sources = sorted(n for n in files if n.endswith({"c": ".c", "cpp": ".cpp", "go": ".go", "rust": ".rs", "csharp": ".cs"}[lang]))
        if not isinstance(sources, list) or not sources or not all(isinstance(n, str) and n in files for n in sources):
            return {"status": "error", "message": "bad job"}
        if include not in (None, "bqpre.h", "bqpre.hpp"):
            return {"status": "error", "message": "bad job"}
        if lang in ("c", "cpp") and len(set(n.rsplit(".", 1)[0] for n in sources)) != len(sources):
            return {"status": "error", "message": "bad job"}
        if scan is not None and lang in ("c", "cpp", "go") and scan[0] not in sources:
            return {"status": "error", "message": "bad job"}
    total = 0
    for name, body in files.items():
        if not isinstance(name, str) or not isinstance(body, str) or not name or len(name) > 64 \
                or not all(c.isalnum() or c in "._-" for c in name) or name.startswith("."):
            return {"status": "error", "message": "bad file name"}
        total += len(body.encode("utf-8"))
    if total > 400 * 1024:
        return {"status": "error", "message": "job too large"}

    job = tempfile.mkdtemp(prefix="job-", dir=os.path.join(JOBS, str(slot)))
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
        facts = None
        if lang == "java":
            javac = shutil.which("javac")
            srcs = sorted(n for n in files if n.endswith(".java"))
            st, code, out, err, ms = run_step(
                [javac, "-J-XX:ActiveProcessorCount=1", "-J-Xmx384m", "-J-XX:+UseSerialGC", "-J-XX:-UsePerfData",
                 "-J-XX:TieredStopAtLevel=1", "-J-XX:-UseContainerSupport", "-encoding", "UTF-8", "-nowarn", "-d", "."] + srcs,
                uid, job, 20, 40, 3072, 256, env, tools=["javac"])
            kill_uid(uid)
            if st != "ok" or code != 0:
                return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                        "exitCode": code, "ms": ms}
            argv = [shutil.which("java"), f"-Xmx{mem_mb}m"] + JAVA_RUN_FLAGS + ["-cp", ".", req.get("main") or "BQMain"]
            step = lambda d, e, more: run_step(argv + more, uid, d, cpu_s, wall_s, mem_mb + 1536, 256, e, tools=["java"])  # noqa: E731
        elif lang in ("c", "cpp"):
            # Each source to its own object, then linked: the ban check reads the student's object.
            cc = shutil.which("g++" if lang == "cpp" else "gcc")
            objs = [n.rsplit(".", 1)[0] + ".o" for n in sources]
            tools = ["g++" if lang == "cpp" else "gcc", "cc", "as", "ld"]
            for argv in ([cc] + CC_FLAGS[lang] + (["-include", include] if include else []) + ["-c"] + sources,
                         [cc, "-o", "main"] + objs + (["-lm"] if lang == "c" else [])):
                st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 2048, 64, env, fsize=32 << 20, tools=tools)
                kill_uid(uid)
                if st != "ok" or code != 0:
                    return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                            "exitCode": code, "ms": ms}
            facts = run_scan(lang, scan, sources, objs, include, files, uid, job, env) if scan else None
            step = lambda d, e, more: run_step([os.path.join(d, "main")] + more, uid, d, cpu_s, wall_s, mem_mb + 64, SINGLE_NPROC, e,  # noqa: E731
                                               run_file=os.path.join(d, "main"))
        elif lang in ("go", "rust"):
            if lang == "go":
                steps = [[os.path.join(GO, "tool", "compile"), "-p", "main", "-importcfg", os.path.join(GO, "importcfg"), "-pack", "-o", "main.a"] + sources,
                         [os.path.join(GO, "tool", "link"), "-importcfg", os.path.join(GO, "importcfg"), "-o", "main", "main.a"]]
            else:
                # with a ban, the same compile also writes out its MIR (main.mir): what every call resolved to
                steps = [[shutil.which("rustc")] + RUST_FLAGS + (["--emit=mir,link"] if scan else []) + ["-o", "main", sources[0]]]
            for argv in steps:
                st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 2048, 64, env, fsize=64 << 20,
                                                  tools=["rustc", "cc", "as", "ld"] if lang == "rust" else [])
                kill_uid(uid)
                if st != "ok" or code != 0:
                    return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                            "exitCode": code, "ms": ms}
            if scan and lang == "rust":
                facts = rust_facts(job, [files[n] for n in scan])
            elif scan:
                facts = run_scan(lang, scan, sources, None, None, files, uid, job, env)
            # Go reserves ~800 MB of address space before it starts; GOMEMLIMIT keeps its heap to the limit.
            step = lambda d, e, more: run_step(  # noqa: E731
                [os.path.join(d, "main")] + more, uid, d, cpu_s, wall_s, mem_mb + (1536 if lang == "go" else 128), 64 if lang == "go" else SINGLE_NPROC,
                dict(e, GOMEMLIMIT=f"{mem_mb}MiB", GOMAXPROCS="2") if lang == "go" else e, run_file=os.path.join(d, "main"))
        elif lang == "csharp":
            argv = [shutil.which("dotnet"), "exec", CS + "/csc.dll"] + CS_FLAGS + (["-main:" + entry] if entry else []) + sources
            cenv = dict(env, **DOTNET_ENV, DOTNET_GCHeapHardLimit=hex(1536 << 20))
            st, code, out, err, ms = run_step(argv, uid, job, 20, 40, 4096, 64, cenv, fsize=64 << 20, tools=["dotnet"])
            kill_uid(uid)
            if st != "ok" or code != 0:
                return {"status": "compile_error" if st == "ok" else "error", "stdout": out, "stderr": err or out,
                        "exitCode": code, "ms": ms}
            facts = run_scan(lang, scan, sources, None, None, files, uid, job, env) if scan else None
            step = lambda d, e, more: run_step(  # noqa: E731
                [shutil.which("dotnet"), "exec", "--runtimeconfig", CS + "/main.runtimeconfig.json", "main.dll"] + more, uid, d, cpu_s, wall_s,
                mem_mb + 1792, 64, dict(e, **DOTNET_ENV, DOTNET_GCHeapHardLimit=hex(mem_mb << 20)), tools=["dotnet"])
        elif lang in ("javascript", "typescript"):
            argv = [shutil.which("node"), f"--max-old-space-size={mem_mb}"] + NODE_FLAGS + [req.get("main") or "main.cjs"]
            step = lambda d, e, more: run_step(argv + more, uid, d, cpu_s, wall_s, mem_mb + 1024, 64, e, tools=["node"])  # noqa: E731
        else:
            argv = [shutil.which("python3"), "-E", "-s", "-B", "-X", "utf8", req.get("main") or "main.py"]
            step = lambda d, e, more: run_step(argv + more, uid, d, cpu_s, wall_s, mem_mb + 128, SINGLE_NPROC, e, tools=["python3"])  # noqa: E731
        # step(dir, env, extra arguments): the program's run. Its one run, or its runs (each.py).
        if runs:
            return each_job(slot, uid, job, env, runs, started, step, scan, facts)
        st, code, out, err, ms = step(job, env, [])
        res = {"status": st, "stdout": out, "stderr": err, "exitCode": code, "ms": ms}
        if scan:
            res["scan"] = facts  # None: the scan didn't work, so nothing can be said for the code
        return res
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
            return self._send(200, {"ok": True, "landlock": ABI, "slots": SLOTS, "kind": KIND, "languages": AVAILABLE, "runs": EACH})
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
        except ScanTimeout:
            res = {"status": "error", "message": "busy"}
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
    """The other languages, run once at start. A problem here is reported, not fatal: Java and Python still work.
    -> (notes, the languages that work). The standard runner doesn't have C, C++, C#, Go or Rust to try."""
    notes = []
    ok = ["java", "python"]
    probes = [
        ("javascript", {"main.js": "console.log('ok' + (1 + 1))"}, "main.js", None),
        ("typescript", {"main.ts": "const n: number = 2;\nconsole.log('ok' + n)"}, "main.ts", None),
        ("c", {"main.c": "#include <stdio.h>\nint main(void) { printf(\"ok%d\\n\", 1 + 1); return 0; }"}, "main", ["main.c"]),
        ("cpp", {"main.cpp": "int main() { vector<int> v{1, 1}; cout << \"ok\" << v[0] + v[1] << endl; }"}, "main", ["main.cpp"]),
        ("go", {"main.go": "package main\nimport \"fmt\"\nfunc main() { fmt.Printf(\"ok%d\\n\", 1+1) }"}, "main", ["main.go"]),
        ("rust", {"main.rs": "fn main() { let v = vec![1, 1]; println!(\"ok{}\", v[0] + v[1]); }"}, "main", ["main.rs"]),
        ("csharp", {"main.cs": "System.Console.WriteLine(\"ok\" + (1 + 1));"}, "main", ["main.cs"]),
    ]
    for lang, files, main, sources in probes:
        if KIND == "standard" and lang not in STANDARD:
            continue
        need = {"javascript": "node", "typescript": "node", "c": "gcc", "cpp": "g++", "go": None, "rust": "rustc", "csharp": "dotnet"}[lang]
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
        else:
            ok.append(lang)
    return notes, [l for l in LANGS if l in ok]


def each_test(works):
    """Build once, run each (each.py), tried at start: each run gets its number, and a copy of the build of its
    own (a file run 0 leaves, run 1 doesn't see). -> (notes, the languages it works in)."""
    notes, ok = [], []
    for lang in EACH_LANGS:
        if lang not in works:
            continue
        files, main, sources = each.PROBES[lang]
        req = {"language": lang, "files": files, "main": main, "timeMs": 3000, "runs": 2}
        if sources:
            req["sources"] = sources
        if lang == "cpp":
            req["include"] = "bqpre.hpp"
        res = run_job(0, req)
        if [r.get("stdout", "").strip() for r in res.get("runs") or []] != ["ok0", "ok1"]:
            notes.append(f"{lang}: build once, run each: self-test failed: {json.dumps(res)[:400]}")
        else:
            ok.append(lang)
    return notes, ok


if __name__ == "__main__":
    os.makedirs(JOBS, exist_ok=True)
    os.chmod(JOBS, 0o711)
    # Each slot's jobs in a directory of its own (with Docker Compose, a tmpfs of its own: docker-compose.yml)
    for _s in range(SLOTS):
        os.makedirs(os.path.join(JOBS, str(_s)), exist_ok=True)
        os.chmod(os.path.join(JOBS, str(_s)), 0o711)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.chmod(OUT_DIR, 0o700)
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
    notes, works = language_test()
    for note in notes:
        print("runner: warning:", note, flush=True)
    AVAILABLE[:] = works
    notes, works = each_test(works)
    for note in notes:
        print("runner: warning:", note, flush=True)
    EACH[:] = works
    extras = [f"landlock ABI {ABI}", "network blocked by seccomp" + (" and landlock" if ABI >= 4 else "")]
    if ABI >= 6:
        extras.append("signal scoping on")
    if EACH:
        extras.append("built once and run each: " + ", ".join(EACH))
    print(f"runner: sandbox ok ({', '.join(extras)}), {KIND}: {', '.join(AVAILABLE)}, {SLOTS} slots, listening on :{PORT}", flush=True)
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
