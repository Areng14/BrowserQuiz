/* Harness runtime for C and C++ (compiled on its own, so these headers never meet the student's names).
 * Each test runs in a child process: a crash, an exit() or a hang in one test is reported as that test's
 * failure and the next one still runs. Results go out as JSON lines tagged with the run's marker; the
 * expected values never enter the sandbox, so a line can only say what the code returned. */
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BQ_DONE 97

static const char* bq_m = "";

void bq_begin(const char* marker) {
    bq_m = marker;
    setvbuf(stdout, NULL, _IOLBF, 0); /* what they print survives a crash */
    fflush(stdout);
}

/* One line: marker, JSON, newline, in one writev so it isn't split up. */
void bq_rec(const char* json, size_t n) {
    struct iovec v[3];
    fflush(stdout);
    v[0].iov_base = (void*)bq_m;
    v[0].iov_len = strlen(bq_m);
    v[1].iov_base = (void*)json;
    v[1].iov_len = n;
    v[2].iov_base = (void*)"\n";
    v[2].iov_len = 1;
    while (writev(1, v, 3) < 0 && errno == EINTR) {}
}

void bq_fail(int i, const char* msg) {
    char b[1200];
    size_t n = (size_t)snprintf(b, 32, "{\"i\":%d,\"ok\":false,\"err\":\"", i);
    for (const char* p = msg; *p && n < sizeof b - 8; p++) {
        unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') { b[n++] = '\\'; b[n++] = (char)c; }
        else if (c < 0x20) { b[n++] = ' '; }
        else b[n++] = (char)c;
    }
    b[n++] = '"';
    b[n++] = '}';
    bq_rec(b, n);
}

/* Returns 1 in the child, which runs test i and calls bq_test_end. The parent waits, reports a child
 * that didn't finish, and gets 0. */
int bq_test_begin(int i, int secs) {
    fflush(stdout);
    pid_t p = fork();
    if (p < 0) { bq_fail(i, "Couldn't start the test"); return 0; }
    if (p == 0) {
        if (secs > 0) alarm((unsigned)secs);
        return 1;
    }
    int st = 0;
    while (waitpid(p, &st, 0) < 0) if (errno != EINTR) break;
    if (WIFEXITED(st) && WEXITSTATUS(st) == BQ_DONE) return 0;
    char msg[200];
    if (WIFSIGNALED(st)) {
        int s = WTERMSIG(st);
        if (s == SIGALRM || s == SIGXCPU || s == SIGKILL) snprintf(msg, sizeof msg, "Ran out of time");
        else if (s == SIGSEGV || s == SIGBUS) snprintf(msg, sizeof msg, "Segmentation fault: a bad pointer or index, or recursion too deep");
        else if (s == SIGABRT) snprintf(msg, sizeof msg, "Aborted: an index out of range, a bad free, or a failed assert");
        else if (s == SIGFPE) snprintf(msg, sizeof msg, "Division by zero");
        else snprintf(msg, sizeof msg, "Crashed (signal %d)", s);
    } else {
        snprintf(msg, sizeof msg, "Stopped: the code called exit(%d)", WIFEXITED(st) ? WEXITSTATUS(st) : -1);
    }
    bq_fail(i, msg);
    return 0;
}

void bq_test_end(void) {
    fflush(stdout);
    _exit(BQ_DONE);
}

#ifdef __cplusplus
}
#endif
