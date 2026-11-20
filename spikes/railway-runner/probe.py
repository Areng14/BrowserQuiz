#!/usr/bin/env python3
"""Code-runner feasibility probe.

Answers one question: can we safely run student Java/Python on this host
without privileged containers? Prints a report and touches nothing outside
a temp dir. Run as root inside the container (that's the Docker default).

Sandbox recipe being tested ("jail-lite", all unprivileged kernel features):
  separate uid  +  rlimits (CPU, memory, processes, file size, open files)
  +  Landlock (filesystem allowlist, and TCP block on ABI >= 4)
  +  seccomp (deny socket(), as a backstop when Landlock can't block network)
  +  process-group kill on wall-clock timeout
"""
import ctypes, ctypes.util, errno, json, os, platform, resource, shutil, signal
import struct, subprocess, sys, tempfile, textwrap, time

libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
libc.syscall.restype = ctypes.c_long
ARCH = platform.machine()
JAIL_UID = int(os.environ.get("JAIL_UID", "1234567001"))  # high uid: RLIMIT_NPROC counts host-wide per uid
REPORT = {}


def say(k, v):
    REPORT[k] = v
    print(f"{k:<26} {v}", flush=True)


def sh(cmd, timeout=20):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = (p.stdout + p.stderr).strip().replace("\n", " | ")
        return ("ok" if p.returncode == 0 else f"FAIL rc={p.returncode}") + (f": {out[:160]}" if out else "")
    except Exception as e:  # noqa
        return f"FAIL: {e}"


def read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception as e:  # noqa
        return f"unreadable ({e.__class__.__name__})"


# ---------------------------------------------------------------- host facts
def host_facts():
    say("kernel", platform.release())
    say("arch", ARCH)
    say("cpus", os.cpu_count())
    say("mem_total", next((l.split(":")[1].strip() for l in read("/proc/meminfo").splitlines() if l.startswith("MemTotal")), "?"))
    say("uid", os.getuid())
    st = {l.split(":")[0]: l.split(":")[1].strip() for l in read("/proc/self/status").splitlines() if ":" in l}
    say("cap_eff", st.get("CapEff"))
    say("seccomp_already", st.get("Seccomp"))
    say("lsm_list", read("/sys/kernel/security/lsm"))
    ver = read("/proc/version")
    say("gvisor", "yes" if "gvisor" in ver.lower() or platform.release().startswith("4.4.0") else "no sign")
    say("cgroup", read("/proc/self/cgroup").replace("\n", " "))
    try:
        os.mkdir("/sys/fs/cgroup/probe_test"); os.rmdir("/sys/fs/cgroup/probe_test")
        say("cgroup_writable", "yes  -> isolate/Judge0 style limits possible")
    except Exception as e:  # noqa
        say("cgroup_writable", f"no ({e.__class__.__name__})")
    say("unshare_net (root)", sh("unshare -n true"))
    say("unshare_user", sh("unshare -Ur true"))
    say("unshare_user+net+pid", sh("unshare -Urnpf --mount-proc true"))
    say("max_user_namespaces", read("/proc/sys/user/max_user_namespaces"))
    try:
        import urllib.request
        urllib.request.urlopen("https://example.com", timeout=5)
        say("egress_internet", "open (so the jail MUST block network)")
    except Exception as e:  # noqa
        say("egress_internet", f"blocked/failed ({e.__class__.__name__})")


# ---------------------------------------------------------------- landlock
SYS = {
    "x86_64": dict(landlock_create_ruleset=444, landlock_add_rule=445, landlock_restrict_self=446, socket=41),
    "aarch64": dict(landlock_create_ruleset=444, landlock_add_rule=445, landlock_restrict_self=446, socket=198),
}[ARCH]
PR_SET_NO_NEW_PRIVS, PR_SET_SECCOMP, SECCOMP_MODE_FILTER = 38, 22, 2

FS_EXECUTE, FS_WRITE_FILE, FS_READ_FILE, FS_READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
FS_ALL_V1 = (1 << 13) - 1
FS_REFER, FS_TRUNCATE, FS_IOCTL_DEV = 1 << 13, 1 << 14, 1 << 15
NET_BIND_TCP, NET_CONNECT_TCP = 1 << 0, 1 << 1


def landlock_abi():
    r = libc.syscall(SYS["landlock_create_ruleset"], None, ctypes.c_size_t(0), ctypes.c_uint32(1))
    return r if r >= 0 else -ctypes.get_errno()


def fs_mask(abi):
    m = FS_ALL_V1
    if abi >= 2: m |= FS_REFER
    if abi >= 3: m |= FS_TRUNCATE
    if abi >= 5: m |= FS_IOCTL_DEV
    return m


def apply_landlock(abi, read_paths, rw_paths):
    handled = fs_mask(abi)
    if abi >= 4:
        attr = struct.pack("QQ", handled, NET_BIND_TCP | NET_CONNECT_TCP)  # no net rules => all TCP denied
    else:
        attr = struct.pack("Q", handled)
    buf = ctypes.create_string_buffer(attr)
    fd = libc.syscall(SYS["landlock_create_ruleset"], buf, ctypes.c_size_t(len(attr)), ctypes.c_uint32(0))
    if fd < 0:
        raise OSError(ctypes.get_errno(), "landlock_create_ruleset")
    ro = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR
    file_ro = FS_EXECUTE | FS_READ_FILE  # dir-only rights are invalid on a file rule
    for path, rights in [(p, ro) for p in read_paths] + [(p, handled) for p in rw_paths]:
        if not os.path.exists(path):
            continue
        pfd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        r = rights if os.path.isdir(path) else (file_ro if rights == ro else FS_READ_FILE | FS_WRITE_FILE)
        rule = ctypes.create_string_buffer(struct.pack("=Qi", r, pfd))
        if libc.syscall(SYS["landlock_add_rule"], ctypes.c_int(fd), ctypes.c_int(1), rule, ctypes.c_uint32(0)) < 0:
            raise OSError(ctypes.get_errno(), f"landlock_add_rule {path}")
        os.close(pfd)
    if libc.syscall(SYS["landlock_restrict_self"], ctypes.c_int(fd), ctypes.c_uint32(0)) < 0:
        raise OSError(ctypes.get_errno(), "landlock_restrict_self")
    os.close(fd)


# ---------------------------------------------------------------- seccomp
class SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_uint16), ("jt", ctypes.c_uint8), ("jf", ctypes.c_uint8), ("k", ctypes.c_uint32)]


class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_uint16), ("filter", ctypes.POINTER(SockFilter))]


AUDIT_ARCH = {"x86_64": 0xC000003E, "aarch64": 0xC00000B7}[ARCH]


def apply_seccomp_no_socket():
    # if arch != ours -> kill; if nr == socket -> EPERM; else allow
    prog = [
        SockFilter(0x20, 0, 0, 4),                 # ld [arch]
        SockFilter(0x15, 1, 0, AUDIT_ARCH),        # jeq arch -> skip next
        SockFilter(0x06, 0, 0, 0x80000000),        # ret KILL_PROCESS
        SockFilter(0x20, 0, 0, 0),                 # ld [nr]
        SockFilter(0x15, 0, 1, SYS["socket"]),     # jeq socket
        SockFilter(0x06, 0, 0, 0x00050000 | errno.EPERM),  # ret ERRNO(EPERM)
        SockFilter(0x06, 0, 0, 0x7FFF0000),        # ret ALLOW
    ]
    arr = (SockFilter * len(prog))(*prog)
    fprog = SockFprog(len(prog), arr)
    if libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.byref(fprog), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "seccomp")


# ---------------------------------------------------------------- the jail
def make_preexec(job, abi, mem_mb, nproc, cpu_s):
    java_home = os.path.realpath(os.path.dirname(os.path.dirname(shutil.which("java") or "/usr/bin/java")))
    read_paths = ["/usr", "/lib", "/lib64", "/bin", "/opt/java", java_home, "/etc/ld.so.cache",
                  "/etc/alternatives", "/proc/self", "/proc/meminfo", "/proc/cpuinfo", "/proc/stat",
                  "/dev/urandom", "/dev/random", "/sys/devices/system/cpu"]
    read_paths += [os.path.join("/etc", n) for n in os.listdir("/etc") if n.startswith("java")]
    rw_paths = [job, "/dev/null"]

    def pre():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb << 20, mem_mb << 20))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if os.getuid() == 0:
            os.setgroups([]); os.setgid(JAIL_UID); os.setuid(JAIL_UID)
        resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))  # per-uid, after the drop
        if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "no_new_privs")
        if abi > 0:
            apply_landlock(abi, read_paths, rw_paths)
        apply_seccomp_no_socket()
    return pre


def jailed(argv, job, abi, mem_mb=512, nproc=64, cpu_s=5, wall_s=10, env=None):
    t0 = time.time()
    p = subprocess.Popen(argv, cwd=job, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         preexec_fn=make_preexec(job, abi, mem_mb, nproc, cpu_s),
                         env=env or {"PATH": "/usr/bin:/bin", "HOME": job, "LANG": "C.UTF-8"})
    try:
        out, _ = p.communicate(timeout=wall_s)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, _ = p.communicate()
        return "TIMEOUT", out.decode(errors="replace"), time.time() - t0
    return p.returncode, out.decode(errors="replace"), time.time() - t0


ESCAPES = textwrap.dedent(r'''
    import os, socket, json
    r = {}
    def t(name, fn):
        try:
            fn(); r[name] = "ALLOWED"
        except Exception as e:
            r[name] = "blocked (" + e.__class__.__name__ + ")"
    t("read /etc/hostname", lambda: open("/etc/hostname").read())
    t("list /tmp", lambda: os.listdir("/tmp"))
    t("read /proc/1/cmdline", lambda: open("/proc/1/cmdline").read())
    t("list /home", lambda: os.listdir("/home"))
    t("tcp connect 1.1.1.1:443", lambda: socket.create_connection(("1.1.1.1", 443), timeout=3))
    t("write own job dir", lambda: open("ok.txt", "w").write("hi"))
    t("write /var/tmp", lambda: open("/var/tmp/x", "w").write("hi"))
    print(json.dumps(r))
''')

FORK_BOMB = "import os\nn=0\ntry:\n    while True:\n        os.fork(); n+=1\nexcept OSError as e:\n    print('fork stopped:', e.__class__.__name__)\n"
MEM_HOG = "x=[]\ntry:\n    while True: x.append(bytearray(10**7))\nexcept MemoryError:\n    print('memory capped at ~', len(x)*10, 'MB')\n"
SPIN = "while True: pass\n"

JAVA_SOLUTION = textwrap.dedent('''
    class Solution {
        public int countVowels(String s) {
            int n = 0;
            for (char c : s.toLowerCase().toCharArray()) if ("aeiou".indexOf(c) >= 0) n++;
            return n;
        }
    }
    public class Main {
        public static void main(String[] a) {
            Solution s = new Solution();
            System.out.println(s.countVowels("Programming is fun"));
        }
    }
''')
JAVA_FLAGS = ["-XX:ActiveProcessorCount=1", "-Xmx256m", "-Xss1m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:CICompilerCount=1",
              "-XX:-UsePerfData", "-XX:-UseContainerSupport", "-XX:ReservedCodeCacheSize=32m",
              "-XX:MaxMetaspaceSize=128m", "-XX:CompressedClassSpaceSize=64m", "-Xshare:auto"]


def jail_tests():
    abi = landlock_abi()
    say("landlock_abi", f"{abi}  ({'available' if abi > 0 else 'NOT available'}" +
        (", blocks TCP too)" if abi >= 4 else ", no TCP blocking: seccomp covers network)" if abi > 0 else ")"))
    base = tempfile.mkdtemp(prefix="probe-")
    os.chmod(base, 0o711)

    def job():
        d = tempfile.mkdtemp(dir=base)
        os.chown(d, JAIL_UID, JAIL_UID) if os.getuid() == 0 else None
        os.chmod(d, 0o700)
        return d

    py = shutil.which("python3")
    d = job(); open(os.path.join(d, "esc.py"), "w").write(ESCAPES)
    rc, out, dt = jailed([py, "-I", "esc.py"], d, abi)
    try:
        for k, v in json.loads(out.strip().splitlines()[-1]).items():
            say(f"  jail: {k}", v)
    except Exception:  # noqa
        say("jail_escape_test", f"rc={rc} out={out[:300]}")

    d = job(); open(os.path.join(d, "f.py"), "w").write(FORK_BOMB)
    rc, out, dt = jailed([py, "-I", "f.py"], d, abi, nproc=32, wall_s=8)
    say("  jail: fork bomb", f"rc={rc} {out.strip().splitlines()[0][:60] if out.strip() else ''} ({dt:.1f}s)")

    d = job(); open(os.path.join(d, "m.py"), "w").write(MEM_HOG)
    rc, out, dt = jailed([py, "-I", "m.py"], d, abi, mem_mb=256)
    say("  jail: memory hog", f"rc={rc} {out.strip()[:80]}")

    d = job(); open(os.path.join(d, "s.py"), "w").write(SPIN)
    rc, out, dt = jailed([py, "-I", "s.py"], d, abi, cpu_s=2, wall_s=6)
    say("  jail: infinite loop", f"rc={rc} after {dt:.1f}s")

    d = job(); open(os.path.join(d, "h.py"), "w").write("print(sum(c in 'aeiouAEIOU' for c in 'Programming is fun'))\n")
    rc, out, dt = jailed([py, "-I", "h.py"], d, abi)
    say("python run (jailed)", f"rc={rc} out={out.strip()[:40]} {dt*1000:.0f} ms")

    javac, java = shutil.which("javac"), shutil.which("java")
    if not (javac and java):
        say("java", "not installed")
        return
    d = job(); open(os.path.join(d, "Main.java"), "w").write(JAVA_SOLUTION)
    os.chown(os.path.join(d, "Main.java"), JAIL_UID, JAIL_UID) if os.getuid() == 0 else None
    env = {"PATH": "/usr/bin:/bin", "HOME": d, "LANG": "C.UTF-8", "MALLOC_ARENA_MAX": "2"}
    rc, out, dt = jailed([javac, "-J-XX:ActiveProcessorCount=1", "-J-Xmx256m", "-J-XX:+UseSerialGC", "-J-XX:-UsePerfData", "-J-XX:TieredStopAtLevel=1",
                          "-J-XX:-UseContainerSupport", "Main.java"], d, abi, mem_mb=3072, nproc=256, cpu_s=15, wall_s=30, env=env)
    say("javac (jailed)", f"rc={rc} {dt:.2f}s {out.strip()[:200]}")
    if rc == 0:
        rc, out, dt = jailed([java, *JAVA_FLAGS, "Main"], d, abi, mem_mb=2048, nproc=256, cpu_s=5, wall_s=15, env=env)
        say("java run (jailed)", f"rc={rc} out={out.strip()[:200]} {dt:.2f}s")
    shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    print("=== CODE RUNNER PROBE ===", flush=True)
    host_facts()
    say("jail_uid", JAIL_UID)
    try:
        jail_tests()
    except Exception as e:  # noqa
        say("jail_tests", f"CRASHED: {e!r}")
    print("=== PROBE DONE ===", flush=True)
    print("REPORT_JSON " + json.dumps(REPORT, default=str), flush=True)
