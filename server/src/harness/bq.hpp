// Harness helper for C++: writes return values as JSON, makes big test arguments, and reports exceptions.
// Included by bqmain.cpp after the student's code; bqrt.c (compiled on its own) does the processes.
#include <cxxabi.h>
#include <typeinfo>

extern "C" {
void bq_begin(const char* marker);
void bq_rec(const char* json, size_t n);
void bq_fail(int i, const char* msg);
int bq_test_begin(int i, int secs);
void bq_test_end(void);
}

namespace bq {
struct W {
    std::string s;
    int d = 0;
};

inline void str(W& w, const std::string& s) {
    w.s += '"';
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { w.s += '\\'; w.s += (char)c; }
        else if (c == '\n') w.s += "\\n";
        else if (c == '\t') w.s += "\\t";
        else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); w.s += b; }
        else w.s += (char)c;
    }
    w.s += '"';
}
inline void j(W& w, int v) { w.s += std::to_string(v); }
inline void j(W& w, long v) { w.s += std::to_string(v); }
inline void j(W& w, long long v) { w.s += std::to_string(v); }
inline void j(W& w, double v) {
    char b[40];
    if (std::isfinite(v)) snprintf(b, sizeof b, "%.17g", v);
    else snprintf(b, sizeof b, "\"%s\"", std::isnan(v) ? "nan" : v > 0 ? "inf" : "-inf");
    w.s += b;
}
inline void j(W& w, bool v) { w.s += v ? "true" : "false"; }
inline void j(W& w, char c) { str(w, std::string(1, c)); }
inline void j(W& w, const std::string& s) { str(w, s); }
// A pointer to something without its own j() is a mistake here, not a bool.
template <class T> void j(W& w, const T* p) = delete;

template <class T> void j(W& w, const std::vector<T>& v) {
    w.s += '[';
    bool first = true;
    for (const auto& x : v) {
        if (!first) w.s += ',';
        first = false;
        j(w, static_cast<const T&>(x));
    }
    w.s += ']';
}
inline void key(W& w, const std::string& k) { str(w, k); }
inline void key(W& w, int k) { str(w, std::to_string(k)); }
template <class K, class V> void j(W& w, const std::unordered_map<K, V>& m) {
    w.s += '{';
    bool first = true;
    for (const auto& kv : m) {
        if (!first) w.s += ',';
        first = false;
        key(w, kv.first);
        w.s += ':';
        j(w, kv.second);
    }
    w.s += '}';
}

inline void send(const std::string& s) {
    std::cout.flush();
    bq_rec(s.data(), s.size());
}
inline void ok(int i, const W& w) { send("{\"i\":" + std::to_string(i) + ",\"ok\":true,\"v\":" + w.s + "}"); }
inline void step(int i, int k, const W& w) { send("{\"i\":" + std::to_string(i) + ",\"s\":" + std::to_string(k) + ",\"v\":" + w.s + "}"); }
inline void done(int i) { send("{\"i\":" + std::to_string(i) + ",\"ok\":true}"); }
inline void fail(int i, const std::string& msg) { std::cout.flush(); bq_fail(i, msg.substr(0, 500).c_str()); }
inline void fail(int i, const std::exception& e) {
    int st = 0;
    char* n = abi::__cxa_demangle(typeid(e).name(), nullptr, nullptr, &st);
    std::string name = st == 0 && n ? n : typeid(e).name();
    std::free(n);
    if (name.rfind("std::", 0) == 0) name = name.substr(5);
    fail(i, name + ": " + e.what());
}

inline long long len(long long a, long long b, long long s) { return s > 0 ? (b > a ? (b - a + s - 1) / s : 0) : (a > b ? (a - b - s - 1) / -s : 0); }
inline std::vector<int> range(long long a, long long b, long long s) {
    std::vector<int> x((size_t)len(a, b, s));
    for (size_t k = 0; k < x.size(); k++) x[k] = (int)(a + (long long)k * s);
    return x;
}
inline std::vector<long long> rangeL(long long a, long long b, long long s) {
    std::vector<long long> x((size_t)len(a, b, s));
    for (size_t k = 0; k < x.size(); k++) x[k] = a + (long long)k * s;
    return x;
}
}  // namespace bq
