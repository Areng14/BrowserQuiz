// Harness helper for C#: writes return values as JSON lines tagged with the run's marker. The server reads
// these lines and compares them to the expected values, which never enter the sandbox. Records go through the
// real standard output, taken before student code runs, whatever they do to Console later.
using System.Collections;
using System.IO;
using System.Globalization;
using System.Reflection;

public static class BQ {
    static string M = "";
    static Stream Out = Stream.Null;

    public static void Begin(string marker) {
        M = marker;
        Out = Console.OpenStandardOutput();
    }

    static void Rec(string json) {
        Console.Out.Flush();
        var bytes = new UTF8Encoding(false).GetBytes(M + json + "\n");
        Out.Write(bytes, 0, bytes.Length);
        Out.Flush();
    }

    public static void Str(StringBuilder b, string s) {
        b.Append('"');
        foreach (char c in s) {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c == '\n') b.Append("\\n");
            else if (c == '\t') b.Append("\\t");
            else if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
            else b.Append(c);
        }
        b.Append('"');
    }

    // A value as JSON: numbers, text, arrays and lists, dictionaries, and an object's public fields.
    public static void J(StringBuilder b, object v, int d) {
        if (v == null) { b.Append("null"); return; }
        if (d > 400) { b.Append("\"...\""); return; }
        switch (v) {
            case bool x: b.Append(x ? "true" : "false"); return;
            case int or long or short or byte or sbyte or uint or ulong or ushort:
                b.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return;
            case double or float: {
                double x = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (double.IsFinite(x)) b.Append(x.ToString("R", CultureInfo.InvariantCulture));
                else Str(b, x.ToString(CultureInfo.InvariantCulture));
                return;
            }
            case char c: Str(b, c.ToString()); return;
            case string s: Str(b, s); return;
            case IDictionary dict: {
                b.Append('{');
                bool first = true;
                foreach (DictionaryEntry e in dict) {
                    if (!first) b.Append(',');
                    first = false;
                    Str(b, Convert.ToString(e.Key, CultureInfo.InvariantCulture) ?? "");
                    b.Append(':');
                    J(b, e.Value, d + 1);
                }
                b.Append('}');
                return;
            }
            case IEnumerable items: {
                b.Append('[');
                bool first = true;
                foreach (var x in items) {
                    if (!first) b.Append(',');
                    first = false;
                    J(b, x, d + 1);
                }
                b.Append(']');
                return;
            }
        }
        b.Append('{');
        bool f = true;
        foreach (var field in v.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance)) {
            if (!f) b.Append(',');
            f = false;
            Str(b, field.Name);
            b.Append(':');
            J(b, field.GetValue(v), d + 1);
        }
        b.Append('}');
    }

    static string Js(object v) { var b = new StringBuilder(); J(b, v, 0); return b.ToString(); }
    public static void Ok(int i, object v) => Rec("{\"i\":" + i + ",\"ok\":true,\"v\":" + Js(v) + "}");
    public static void Step(int i, int s, object v) => Rec("{\"i\":" + i + ",\"s\":" + s + ",\"v\":" + Js(v) + "}");
    public static void Done(int i) => Rec("{\"i\":" + i + ",\"ok\":true}");

    // An exception as the student reads it, with the line in their file when there is one.
    public static void Fail(int i, Exception e) {
        if (e is TargetInvocationException t && t.InnerException != null) e = t.InnerException;
        var msg = e.GetType().Name + ": " + e.Message;
        var at = System.Text.RegularExpressions.Regex.Match(e.StackTrace ?? "", @"solution\.cs:line (\d+)");
        if (at.Success) msg += " (solution.cs:" + at.Groups[1].Value + ")";
        if (msg.Length > 500) msg = msg.Substring(0, 500);
        var b = new StringBuilder();
        Str(b, msg);
        Rec("{\"i\":" + i + ",\"ok\":false,\"err\":" + b + "}");
    }

    // Big test arguments, made here instead of written out.
    static int Len(long a, long b, long s) => (int)Math.Max(0, s > 0 ? (b - a + s - 1) / s : (a - b - s - 1) / -s);
    public static int[] Range(long a, long b, long s) { var x = new int[Len(a, b, s)]; for (int k = 0; k < x.Length; k++) x[k] = (int)(a + k * s); return x; }
    public static long[] RangeL(long a, long b, long s) { var x = new long[Len(a, b, s)]; for (int k = 0; k < x.Length; k++) x[k] = a + k * s; return x; }
    public static List<int> RangeList(long a, long b, long s) => new List<int>(Range(a, b, s));
}
