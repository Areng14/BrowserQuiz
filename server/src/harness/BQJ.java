// Harness helper: turns return values into JSON lines tagged with a per-run marker.
// The server reads these lines and compares them to the expected values, which never enter the sandbox.
final class BQJ {
    static String M = "";

    private BQJ() {}

    static void out(String json) {
        System.out.flush();
        System.out.println(M + json);
        System.out.flush();
    }

    static void ok(int i, Object v) { out("{\"i\":" + i + ",\"ok\":true,\"v\":" + json(v) + "}"); }
    static void step(int i, int s, Object v) { out("{\"i\":" + i + ",\"s\":" + s + ",\"v\":" + json(v) + "}"); }
    static void done(int i) { out("{\"i\":" + i + ",\"ok\":true}"); }
    static void fail(int i, Throwable e) {
        String msg = e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage());
        if (msg.length() > 500) msg = msg.substring(0, 500);
        out("{\"i\":" + i + ",\"ok\":false,\"err\":" + str(msg) + "}");
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

    static String num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return str(Double.toString(d));
        return Double.toString(d);
    }

    static String json(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return str((String) o);
        if (o instanceof Character) return str(String.valueOf(o));
        if (o instanceof Boolean || o instanceof Integer || o instanceof Long || o instanceof Short || o instanceof Byte) return String.valueOf(o);
        if (o instanceof Double || o instanceof Float) return num(((Number) o).doubleValue());
        StringBuilder b = new StringBuilder("[");
        if (o instanceof int[]) { int[] x = (int[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof long[]) { long[] x = (long[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof double[]) { double[] x = (double[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(num(x[i])); } }
        else if (o instanceof boolean[]) { boolean[] x = (boolean[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(x[i]); } }
        else if (o instanceof char[]) return str(new String((char[]) o));
        else if (o instanceof Object[]) { Object[] x = (Object[]) o; for (int i = 0; i < x.length; i++) { if (i > 0) b.append(','); b.append(json(x[i])); } }
        else if (o instanceof Iterable) { int i = 0; for (Object x : (Iterable<?>) o) { if (i++ > 0) b.append(','); b.append(json(x)); } }
        else return str(String.valueOf(o));
        return b.append(']').toString();
    }
}
