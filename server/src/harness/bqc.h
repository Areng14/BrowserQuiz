/* Harness helper for C: writes return values as JSON, and makes test arguments. Included by bqmain.c
 * after the student's code (everything here is static and starts with bq_). */
void bq_begin(const char* marker);
void bq_rec(const char* json, size_t n);
void bq_fail(int i, const char* msg);
int bq_test_begin(int i, int secs);
void bq_test_end(void);

typedef struct { char* s; size_t n, cap; int d; } bq_w;

static void bq_w_put(bq_w* w, const char* s, size_t n) {
    if (w->n + n + 1 > w->cap) {
        size_t c = w->cap ? w->cap : 256;
        while (c < w->n + n + 1) c *= 2;
        char* t = (char*)realloc(w->s, c);
        if (!t) return;
        w->s = t;
        w->cap = c;
    }
    memcpy(w->s + w->n, s, n);
    w->n += n;
}
static void bq_w_raw(bq_w* w, const char* s) { bq_w_put(w, s, strlen(s)); }
static void bq_w_int(bq_w* w, int v) { char b[24]; snprintf(b, sizeof b, "%d", v); bq_w_raw(w, b); }
static void bq_w_ll(bq_w* w, long long v) { char b[32]; snprintf(b, sizeof b, "%lld", v); bq_w_raw(w, b); }
static void bq_w_dbl(bq_w* w, double v) {
    char b[40];
    if (isfinite(v)) snprintf(b, sizeof b, "%.17g", v);
    else snprintf(b, sizeof b, "\"%s\"", isnan(v) ? "nan" : v > 0 ? "inf" : "-inf");
    bq_w_raw(w, b);
}
static void bq_w_bool(bq_w* w, bool v) { bq_w_raw(w, v ? "true" : "false"); }
static void bq_w_strn(bq_w* w, const char* s, size_t n) {
    bq_w_raw(w, "\"");
    for (size_t k = 0; k < n; k++) {
        unsigned char c = (unsigned char)s[k];
        char b[8];
        if (c == '"' || c == '\\') { b[0] = '\\'; b[1] = (char)c; bq_w_put(w, b, 2); }
        else if (c == '\n') bq_w_raw(w, "\\n");
        else if (c == '\t') bq_w_raw(w, "\\t");
        else if (c < 0x20) { snprintf(b, sizeof b, "\\u%04x", c); bq_w_raw(w, b); }
        else bq_w_put(w, (const char*)&s[k], 1);
    }
    bq_w_raw(w, "\"");
}
static void bq_w_str(bq_w* w, const char* s) { if (!s) bq_w_raw(w, "null"); else bq_w_strn(w, s, strlen(s)); }
static void bq_w_chr(bq_w* w, char c) { bq_w_strn(w, &c, 1); }

static void bq_send(bq_w* w, const char* head, const char* tail) {
    bq_w all = {0};
    bq_w_raw(&all, head);
    if (w) bq_w_put(&all, w->s ? w->s : "null", w->s ? w->n : 4);
    bq_w_raw(&all, tail);
    bq_rec(all.s, all.n);
}
static void bq_ok(int i, bq_w* w) { char h[48]; snprintf(h, sizeof h, "{\"i\":%d,\"ok\":true,\"v\":", i); bq_send(w, h, "}"); }
static void bq_step(int i, int s, bq_w* w) { char h[48]; snprintf(h, sizeof h, "{\"i\":%d,\"s\":%d,\"v\":", i, s); bq_send(w, h, "}"); }
static void bq_done(int i) { char h[48]; snprintf(h, sizeof h, "{\"i\":%d,\"ok\":true}", i); bq_send(NULL, h, ""); }

/* A returned array's length has to make sense before it's read. */
static int bq_size(int i, const void* r, int n) {
    if (n < 0) { bq_fail(i, "Set *returnSize to the length of the array you return"); return 0; }
    if (!r && n > 0) { bq_fail(i, "Returned NULL, but *returnSize isn't 0"); return 0; }
    return 1;
}

/* Arguments are copies on the heap, so code can change or free them like LeetCode's. */
static void* bq_dup(const void* src, size_t n) {
    void* p = malloc(n ? n : 1);
    if (p && n && src) memcpy(p, src, n);
    return p;
}
static char* bq_str(const char* s) { return (char*)bq_dup(s, strlen(s) + 1); }
static long long bq_len(long long a, long long b, long long s) { return s > 0 ? (b > a ? (b - a + s - 1) / s : 0) : (a > b ? (a - b - s - 1) / -s : 0); }
static int* bq_range(long long a, long long b, long long s, int* n) {
    *n = (int)bq_len(a, b, s);
    int* x = (int*)malloc((size_t)*n * sizeof(int) + 1);
    for (int k = 0; k < *n; k++) x[k] = (int)(a + k * s);
    return x;
}
static long long* bq_rangeL(long long a, long long b, long long s, int* n) {
    *n = (int)bq_len(a, b, s);
    long long* x = (long long*)malloc((size_t)*n * sizeof(long long) + 1);
    for (int k = 0; k < *n; k++) x[k] = a + k * s;
    return x;
}
