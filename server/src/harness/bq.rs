// Harness helper for Rust: writes return values as JSON lines tagged with the run's marker, and runs each test
// in a child process (this same program, given the test's number), so a panic, an abort or a hang is only that
// test's. The expected values never enter the sandbox, so a line can only say what the code returned.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DONE: i32 = 97;
static MARKER: Mutex<String> = Mutex::new(String::new());
static PANIC: Mutex<Option<String>> = Mutex::new(None);

pub fn str(w: &mut String, s: &str) {
    w.push('"');
    for c in s.chars() {
        match c {
            '"' => w.push_str("\\\""),
            '\\' => w.push_str("\\\\"),
            '\n' => w.push_str("\\n"),
            '\t' => w.push_str("\\t"),
            c if (c as u32) < 0x20 => w.push_str(&format!("\\u{:04x}", c as u32)),
            c => w.push(c),
        }
    }
    w.push('"');
}

// A value as JSON.
pub trait J {
    fn j(&self, w: &mut String, d: usize);
}
impl J for i32 { fn j(&self, w: &mut String, _: usize) { w.push_str(&self.to_string()); } }
impl J for i64 { fn j(&self, w: &mut String, _: usize) { w.push_str(&self.to_string()); } }
impl J for bool { fn j(&self, w: &mut String, _: usize) { w.push_str(if *self { "true" } else { "false" }); } }
impl J for f64 {
    fn j(&self, w: &mut String, _: usize) {
        if self.is_finite() { w.push_str(&format!("{}", self)); } else { str(w, &format!("{}", self)); }
    }
}
impl J for char { fn j(&self, w: &mut String, _: usize) { str(w, &self.to_string()); } }
impl J for String { fn j(&self, w: &mut String, _: usize) { str(w, self); } }
impl<T: J> J for Vec<T> {
    fn j(&self, w: &mut String, d: usize) {
        w.push('[');
        for (k, x) in self.iter().enumerate() {
            if k > 0 { w.push(','); }
            x.j(w, d + 1);
        }
        w.push(']');
    }
}
pub trait Key { fn key(&self) -> String; }
impl Key for String { fn key(&self) -> String { self.clone() } }
impl Key for i32 { fn key(&self) -> String { self.to_string() } }
impl<K: Key, V: J> J for HashMap<K, V> {
    fn j(&self, w: &mut String, d: usize) {
        w.push('{');
        for (k, (a, b)) in self.iter().enumerate() {
            if k > 0 { w.push(','); }
            str(w, &a.key());
            w.push(':');
            b.j(w, d + 1);
        }
        w.push('}');
    }
}
impl<T: J> J for Option<Box<T>> {
    fn j(&self, w: &mut String, d: usize) {
        match self {
            None => w.push_str("null"),
            Some(_) if d > 400 => w.push_str("\"...\""),
            Some(b) => b.j(w, d + 1),
        }
    }
}

fn out(rec: &str) {
    let m = MARKER.lock().map(|m| m.clone()).unwrap_or_default();
    let mut o = std::io::stdout().lock();
    let _ = o.flush();
    let _ = o.write_all(format!("{}{}\n", m, rec).as_bytes());
    let _ = o.flush();
}
pub fn ok<T: J>(i: usize, v: &T) { let mut w = String::new(); v.j(&mut w, 0); out(&format!("{{\"i\":{},\"ok\":true,\"v\":{}}}", i, w)); }
pub fn step<T: J>(i: usize, s: usize, v: &T) { let mut w = String::new(); v.j(&mut w, 0); out(&format!("{{\"i\":{},\"s\":{},\"v\":{}}}", i, s, w)); }
pub fn done(i: usize) { out(&format!("{{\"i\":{},\"ok\":true}}", i)); }
pub fn fail(i: usize, msg: &str) {
    let mut w = String::new();
    str(&mut w, &msg.chars().take(500).collect::<String>());
    out(&format!("{{\"i\":{},\"ok\":false,\"err\":{}}}", i, w));
}

// Big test arguments, made here instead of written out.
fn len(a: i64, b: i64, s: i64) -> usize {
    (if s > 0 { if b > a { (b - a + s - 1) / s } else { 0 } } else if a > b { (a - b - s - 1) / -s } else { 0 }) as usize
}
pub fn range(a: i64, b: i64, s: i64) -> Vec<i32> { (0..len(a, b, s)).map(|k| (a + k as i64 * s) as i32).collect() }
pub fn range_l(a: i64, b: i64, s: i64) -> Vec<i64> { (0..len(a, b, s)).map(|k| a + k as i64 * s).collect() }

// In the child: one test, a panic becoming its failure (with the line in their file).
fn run_one(i: usize, test: fn(usize)) -> ! {
    std::panic::set_hook(Box::new(|info| {
        let p = info.payload();
        let msg = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".to_string());
        let at = info.location().filter(|l| l.file().ends_with("solution.rs")).map(|l| format!(" (solution.rs:{})", l.line())).unwrap_or_default();
        if let Ok(mut m) = PANIC.lock() { *m = Some(format!("{}{}", msg, at)); }
    }));
    if std::panic::catch_unwind(|| test(i)).is_err() {
        let m = PANIC.lock().ok().and_then(|mut m| m.take()).unwrap_or_else(|| "panic".to_string());
        fail(i, &format!("panicked: {}", m));
    }
    let _ = std::io::stdout().flush();
    std::process::exit(DONE);
}

// In the parent: each test in a child process, with a time limit. Given a test's number (the runner's "runs":
// built once, each test in a process of its own), only that test.
pub fn main(marker: &str, n: usize, test: fn(usize), secs: u64) {
    if let Ok(mut m) = MARKER.lock() { *m = marker.to_string(); }
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 2 && args[1] == "-child" {
        run_one(args[2].parse().unwrap_or(0), test);
    }
    let only: Option<usize> = args.get(1).and_then(|a| a.parse().ok());
    let _ = std::fs::remove_file("bqmain.rs");
    for i in 0..n {
        if only.map_or(false, |k| k != i) { continue; }
        let _ = std::io::stdout().flush();
        let mut child = match Command::new(&args[0]).arg("-child").arg(i.to_string()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(_) => { fail(i, "Couldn't start the test"); continue; }
        };
        let mut err = child.stderr.take().unwrap();
        let reader = std::thread::spawn(move || { let mut s = String::new(); let _ = err.read_to_string(&mut s); s });
        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break Some(s),
                Ok(None) if start.elapsed() < Duration::from_secs(secs) => std::thread::sleep(Duration::from_millis(2)),
                _ => { let _ = child.kill(); let _ = child.wait(); break None; }
            }
        };
        let text = reader.join().unwrap_or_default();
        eprint!("{}", text);
        use std::os::unix::process::ExitStatusExt;
        match status {
            None => fail(i, "Ran out of time"),
            Some(s) if s.code() == Some(DONE) => {}
            Some(_) if text.contains("overflowed its stack") => fail(i, "Stack overflow: recursion too deep"),
            Some(_) if text.contains("memory allocation of") => fail(i, "Ran out of memory"),
            Some(s) if s.signal() == Some(9) || s.signal() == Some(24) => fail(i, "Ran out of time"),
            // safe Rust only gets here by running out of stack
            Some(s) if s.signal() == Some(11) || s.signal() == Some(7) => fail(i, "Stack overflow: recursion too deep"),
            Some(s) if s.signal() == Some(6) => fail(i, "Aborted"),
            Some(s) if s.signal().is_some() => fail(i, &format!("Crashed (signal {})", s.signal().unwrap())),
            Some(s) => fail(i, &format!("Stopped: the code called process::exit({})", s.code().unwrap_or(-1))),
        }
    }
}
