// Harness helper: turns return values into JSON lines tagged with a per-run marker.
// The server reads these lines and compares them to the expected values, which never enter the sandbox.
// The marker is only ever a local in BQMain.main (whose files are deleted before student code runs) and a
// parameter here, so student code can't print a line the server would believe.
final class BQJ {
    // The real stdout, kept when BQMain first calls in (before any student code), whatever they do to
    // System.out later. Final, so reflection can't swap it either.
    private static final java.io.PrintStream OUT = System.out;

    private BQJ() {}

    static void begin() { OUT.flush(); }

    static void out(String m, String json) {
        System.out.flush();
        OUT.println(m + json);
        OUT.flush();
    }

    static void ok(String m, int i, Object v) { out(m, "{\"i\":" + i + ",\"ok\":true,\"v\":" + json(v) + "}"); }
    static void timed(String m, int i, Object v, double ms) { out(m, "{\"i\":" + i + ",\"ok\":true,\"v\":" + json(v) + ",\"ms\":" + ms + "}"); }

    // Big test arguments, made here instead of written out: start, start+step, ... up to (not including) stop.
    static int len(long a, long b, long s) { return (int) Math.max(0, s > 0 ? (b - a + s - 1) / s : (a - b - s - 1) / -s); }
    static int[] range(long a, long b, long s) { int n = len(a, b, s); int[] x = new int[n]; for (int k = 0; k < n; k++) x[k] = (int) (a + k * s); return x; }
    static long[] rangeL(long a, long b, long s) { int n = len(a, b, s); long[] x = new long[n]; for (int k = 0; k < n; k++) x[k] = a + k * s; return x; }
    // Map test arguments: BQJ.<String, Integer>map("a", 1, "b", 2)
    @SuppressWarnings("unchecked")
    static <K, V> java.util.HashMap<K, V> map(Object... kv) {
        java.util.HashMap<K, V> m = new java.util.HashMap<>();
        for (int k = 0; k + 1 < kv.length; k += 2) m.put((K) kv[k], (V) kv[k + 1]);
        return m;
    }
    static java.util.ArrayList<Integer> rangeList(long a, long b, long s) {
        int n = len(a, b, s);
        java.util.ArrayList<Integer> x = new java.util.ArrayList<>(n);
        for (int k = 0; k < n; k++) x.add((int) (a + k * s));
        return x;
    }
    static void step(String m, int i, int s, Object v) { out(m, "{\"i\":" + i + ",\"s\":" + s + ",\"v\":" + json(v) + "}"); }
    static void done(String m, int i) { out(m, "{\"i\":" + i + ",\"ok\":true}"); }
    static void fail(String m, int i, Throwable e) {
        String msg = e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage());
        if (msg.length() > 500) msg = msg.substring(0, 500);
        out(m, "{\"i\":" + i + ",\"ok\":false,\"err\":" + str(msg) + "}");
    }

    static String str(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    // An object of one of the question's classes (Given.java): its public fields, as a JSON object.
    private static String fields(Object o, int d) {
        StringBuilder b = new StringBuilder("{");
        for (java.lang.reflect.Field f : o.getClass().getFields()) {
            if (java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
            Object v;
            try { v = f.get(o); } catch (IllegalAccessException e) { continue; }
            if (b.length() > 1) b.append(',');
            b.append(str(f.getName())).append(':').append(json(v, d + 1));
        }
        return b.append('}').toString();
    }

    static String num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return str(Double.toString(d));
        return Double.toString(d);
    }

    static String json(Object o) { return json(o, 0); }

    static String json(Object o, int d) {
        if (o == null) return "null";
        if (d > 400) return str("...");
        if (o instanceof String) return str((String) o);
        if (o instanceof Character) return str(String.valueOf(o));
        if (o instanceof Boolean || o instanceof Integer || o instanceof Long || o instanceof Short || o instanceof Byte) return String.valueOf(o);
        if (o instanceof Double || o instanceof Float) return num(((Number) o).doubleValue());
        if (o instanceof java.util.Map) { // keys become strings, as in JSON
            StringBuilder m = new StringBuilder("{");
            int i = 0;
            for (java.util.Map.Entry<?, ?> e : ((java.util.Map<?, ?>) o).entrySet()) {
                if (i++ > 0) m.append(',');
                m.append(str(String.valueOf(e.getKey()))).append(':').append(json(e.getValue(), d + 1));
            }
            return m.append('}').toString();
        }
        StringBuilder b = new StringBuilder("[");
        if (o instanceof int[]) { int[] x = (int[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof long[]) { long[] x = (long[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof double[]) { double[] x = (double[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(num(x[i])); } }
        else if (o instanceof boolean[]) { boolean[] x = (boolean[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof char[]) { char[] x = (char[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(str(String.valueOf(x[i]))); } }
        else if (o instanceof Object[]) { Object[] x = (Object[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(json(x[i], d + 1)); } }
        else if (o instanceof Iterable) { int i = 0; for (Object x : (Iterable<?>) o) { if (i++ > 0) b.append(','); b.append(json(x, d + 1)); } }
        else if (!o.getClass().getModule().isNamed()) return fields(o, d); // one of the question's classes
        else return str(String.valueOf(o));
        return b.append(']').toString();
    }

    // Facts for the ban check (server/src/bans.js), read from the compiled classes before any student code
    // runs: the classes compiled from the student's file, what they declare, and every method, field and class
    // they refer to. javac has already dealt with comments, strings, unicode escapes, imports and generics.
    static void scan(String m, String source, String given) {
        java.util.TreeSet<String> refs = new java.util.TreeSet<>();
        java.util.TreeSet<String> types = new java.util.TreeSet<>();
        StringBuilder cls = new StringBuilder();
        boolean bad = false;
        java.io.File[] files = new java.io.File(".").listFiles();
        if (files != null) for (java.io.File f : files) {
            if (!f.getName().endsWith(".class")) continue;
            try { readClass(f, source, given, refs, types, cls); } catch (Exception e) { bad = true; }
        }
        out(m, "{\"scan\":{\"classes\":[" + cls + "],\"refs\":" + list(refs) + ",\"types\":" + list(types) + (bad ? ",\"fail\":true" : "") + "}}");
    }

    private static String list(java.util.Collection<String> xs) {
        StringBuilder b = new StringBuilder("[");
        for (String x : xs) { if (b.length() > 1) b.append(','); b.append(str(x)); }
        return b.append(']').toString();
    }

    private static void addDesc(java.util.Set<String> types, String desc) {
        java.util.regex.Matcher mt = java.util.regex.Pattern.compile("L([^;<]+)[;<]").matcher(desc);
        while (mt.find()) types.add(mt.group(1));
    }

    private static void readClass(java.io.File f, String source, String given, java.util.Set<String> refs, java.util.Set<String> types, StringBuilder cls) throws java.io.IOException {
        try (java.io.DataInputStream in = new java.io.DataInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(f)))) {
            if (in.readInt() != 0xCAFEBABE) throw new java.io.IOException("not a class file");
            in.readUnsignedShort();
            in.readUnsignedShort();
            int n = in.readUnsignedShort();
            String[] utf = new String[n];
            int[] tag = new int[n], a = new int[n], b = new int[n];
            for (int k = 1; k < n; k++) {
                int t = in.readUnsignedByte();
                tag[k] = t;
                switch (t) {
                    case 1: utf[k] = in.readUTF(); break;
                    case 3: case 4: in.readInt(); break;
                    case 5: case 6: in.readLong(); k++; break;
                    case 7: case 8: case 16: case 19: case 20: a[k] = in.readUnsignedShort(); break;
                    case 9: case 10: case 11: case 12: case 17: case 18: a[k] = in.readUnsignedShort(); b[k] = in.readUnsignedShort(); break;
                    case 15: in.readUnsignedByte(); a[k] = in.readUnsignedShort(); break;
                    default: throw new java.io.IOException("constant tag " + t);
                }
            }
            in.readUnsignedShort();
            String self = utf[a[in.readUnsignedShort()]];
            int sup = in.readUnsignedShort();
            String superName = sup == 0 ? null : utf[a[sup]];
            java.util.List<String> ifaces = new java.util.ArrayList<>();
            for (int k = in.readUnsignedShort(); k > 0; k--) ifaces.add(utf[a[in.readUnsignedShort()]]);
            java.util.List<String> fields = new java.util.ArrayList<>(), methods = new java.util.ArrayList<>(), descs = new java.util.ArrayList<>();
            for (int pass = 0; pass < 2; pass++) {
                for (int k = in.readUnsignedShort(); k > 0; k--) {
                    in.readUnsignedShort();
                    (pass == 0 ? fields : methods).add(utf[in.readUnsignedShort()]);
                    descs.add(utf[in.readUnsignedShort()]);
                    for (int x = in.readUnsignedShort(); x > 0; x--) { in.readUnsignedShort(); in.skipNBytes(in.readInt() & 0xffffffffL); }
                }
            }
            String src = null;
            for (int k = in.readUnsignedShort(); k > 0; k--) {
                String name = utf[in.readUnsignedShort()];
                long len = in.readInt() & 0xffffffffL;
                if ("SourceFile".equals(name) && len == 2) src = utf[in.readUnsignedShort()];
                else in.skipNBytes(len);
            }
            boolean mine = source.equals(src);
            if (!mine && !(given != null && given.equals(src))) return;
            if (mine) for (int k = 1; k < n; k++) {
                if (tag[k] == 7) { String c = utf[a[k]]; if (c.startsWith("[")) addDesc(types, c); else types.add(c); }
                else if (tag[k] == 9 || tag[k] == 10 || tag[k] == 11) { refs.add(utf[a[a[k]]] + "." + utf[a[b[k]]]); addDesc(types, utf[b[b[k]]]); }
                else if (tag[k] == 16) addDesc(types, utf[a[k]]);
                else if (tag[k] == 17 || tag[k] == 18) addDesc(types, utf[b[b[k]]]);
            }
            if (mine) {
                for (String d : descs) addDesc(types, d);
                if (superName != null) types.add(superName);
                types.addAll(ifaces);
            }
            if (cls.length() > 0) cls.append(',');
            cls.append("{\"n\":").append(str(self)).append(",\"s\":").append(str(superName)).append(",\"i\":").append(list(ifaces))
               .append(",\"m\":").append(list(new java.util.TreeSet<>(methods))).append(",\"f\":").append(list(fields)).append('}');
        }
    }
}
