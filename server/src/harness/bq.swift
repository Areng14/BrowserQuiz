// Harness helper for Swift: writes return values as JSON lines tagged with the run's marker, and runs each
// test in a child process (fork), so a trap (index out of range, nil unwrapped, overflow) or a hang is only
// that test's. The expected values never enter the sandbox, so a line can only say what the code returned.
#if canImport(Glibc)
import Glibc
#endif

var bqMarker = ""

func bqStr(_ w: inout String, _ s: String) {
    w += "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": w += "\\\""
        case "\\": w += "\\\\"
        case "\n": w += "\\n"
        case "\t": w += "\\t"
        default:
            if u.value < 0x20 {
                let h = String(u.value, radix: 16)
                w += "\\u" + String(repeating: "0", count: 4 - h.count) + h
            } else {
                w.unicodeScalars.append(u)
            }
        }
    }
    w += "\""
}

// A value as JSON.
protocol BQJ { func bqj(_ w: inout String, _ d: Int) }
extension Int: BQJ { func bqj(_ w: inout String, _ d: Int) { w += String(self) } }
extension Bool: BQJ { func bqj(_ w: inout String, _ d: Int) { w += self ? "true" : "false" } }
extension Double: BQJ {
    func bqj(_ w: inout String, _ d: Int) { if isFinite { w += "\(self)" } else { bqStr(&w, "\(self)") } }
}
extension String: BQJ { func bqj(_ w: inout String, _ d: Int) { bqStr(&w, self) } }
extension Character: BQJ { func bqj(_ w: inout String, _ d: Int) { bqStr(&w, String(self)) } }
extension Array: BQJ where Element: BQJ {
    func bqj(_ w: inout String, _ d: Int) {
        w += "["
        for (k, x) in enumerated() { if k > 0 { w += "," }; x.bqj(&w, d + 1) }
        w += "]"
    }
}
protocol BQKey { var bqKey: String { get } }
extension String: BQKey { var bqKey: String { self } }
extension Int: BQKey { var bqKey: String { String(self) } }
extension Dictionary: BQJ where Key: BQKey, Value: BQJ {
    func bqj(_ w: inout String, _ d: Int) {
        w += "{"
        for (k, (a, b)) in enumerated() { if k > 0 { w += "," }; bqStr(&w, a.bqKey); w += ":"; b.bqj(&w, d + 1) }
        w += "}"
    }
}
extension Optional: BQJ where Wrapped: BQJ {
    func bqj(_ w: inout String, _ d: Int) {
        switch self {
        case .none: w += "null"
        case .some(let x): if d > 400 { w += "\"...\"" } else { x.bqj(&w, d + 1) }
        }
    }
}

func bqOut(_ rec: String) {
    fflush(stdout)
    let bytes = Array((bqMarker + rec + "\n").utf8)
    let total = bytes.count
    var off = 0
    while off < total {
        let n = bytes.withUnsafeBytes { write(1, $0.baseAddress! + off, total - off) }
        if n <= 0 { break }
        off += n
    }
}
func bqOk<T: BQJ>(_ i: Int, _ v: T) { var w = ""; v.bqj(&w, 0); bqOut("{\"i\":\(i),\"ok\":true,\"v\":\(w)}") }
func bqStep<T: BQJ>(_ i: Int, _ s: Int, _ v: T) { var w = ""; v.bqj(&w, 0); bqOut("{\"i\":\(i),\"s\":\(s),\"v\":\(w)}") }
func bqDone(_ i: Int) { bqOut("{\"i\":\(i),\"ok\":true}") }
func bqFail(_ i: Int, _ msg: String) { var w = ""; bqStr(&w, String(msg.prefix(500))); bqOut("{\"i\":\(i),\"ok\":false,\"err\":\(w)}") }

// Big test arguments, made here instead of written out.
func bqRange(_ a: Int, _ b: Int, _ s: Int) -> [Int] { Array(stride(from: a, to: b, by: s)) }

// Each test in a child process, its stderr in a file so a crash's message can be read back.
func bqMain(_ marker: String, _ tests: [(Int) -> Void], _ secs: UInt32) {
    bqMarker = marker
    remove("main.swift")
    for (i, t) in tests.enumerated() {
        fflush(stdout)
        let errFile = "bqerr\(i)"
        let pid = fork()
        if pid == 0 {
            _ = freopen(errFile, "w", stderr)
            alarm(secs)
            t(i)
            fflush(stdout)
            _exit(97)
        }
        if pid < 0 { bqFail(i, "Couldn't start the test"); continue }
        var st: Int32 = 0
        while waitpid(pid, &st, 0) < 0 && errno == EINTR {}
        var text = ""
        if let f = fopen(errFile, "r") {
            var buf = [CChar](repeating: 0, count: 4096)
            while fgets(&buf, 4096, f) != nil { text += String(cString: buf) }
            fclose(f)
        }
        if !text.isEmpty { fputs(text, stderr) } // what the test printed to stderr goes on
        let sig = st & 0x7f
        let code = (st >> 8) & 0xff
        if sig == 0 && code == 97 { continue }
        if let line = text.split(separator: "\n").first(where: { $0.firstRange(of: "Fatal error") != nil }) {
            var msg = String(line[line.firstRange(of: "Fatal error")!.lowerBound...])
            if let r = line.firstRange(of: "solution.swift:") {
                let num = line[r.upperBound...].prefix(while: { $0.isNumber })
                msg += " (solution.swift:\(num))"
            }
            bqFail(i, msg)
        } else if sig == SIGALRM || sig == SIGKILL || sig == SIGXCPU {
            bqFail(i, "Ran out of time")
        } else if sig == SIGSEGV || sig == SIGBUS {
            bqFail(i, "Stack overflow: recursion too deep")
        } else if sig == SIGILL || sig == SIGTRAP {
            bqFail(i, "Crashed: a runtime error (an index out of range, nil unwrapped, or an overflow)")
        } else if sig != 0 {
            bqFail(i, "Crashed (signal \(sig))")
        } else {
            bqFail(i, "Stopped: the code called exit(\(code))")
        }
    }
}
