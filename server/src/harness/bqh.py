# Harness helper: turns return values into JSON lines tagged with a per-run marker.
# The server reads these lines and compares them to the expected values, which never enter the sandbox.
# The marker only lives in main.py's locals (main.py deletes itself first) and in the closure writer()
# returns, which main.py makes before importing the student's code.
import json
import math


def _enc(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, (list, tuple)):
        return [_enc(x) for x in v]
    if isinstance(v, dict):  # keys become strings, as in JSON
        return {str(k): _enc(x) for k, x in v.items()}
    return str(v)


def writer(marker, stream):
    write, flush, dumps = stream.write, stream.flush, json.dumps

    def out(o):
        flush()
        write(marker + dumps(o) + "\n")
        flush()
    return out


def _gen(v):
    # {"range": [start, stop, step]}: a big test argument made here instead of written out.
    # {"__map__": [[key, value], ...]}: a dict, with int keys kept as ints.
    if isinstance(v, dict) and "__map__" in v:
        return {k: x for k, x in v["__map__"]}
    if isinstance(v, dict) and "range" in v:
        return list(range(*v["range"]))
    return v


def args(s):
    return [_gen(v) for v in json.loads(s)]


def timed(out, i, v, ms):
    out({"i": i, "ok": True, "v": _enc(v), "ms": ms})


def ok(out, i, v):
    out({"i": i, "ok": True, "v": _enc(v)})


def step(out, i, s, v):
    out({"i": i, "s": s, "v": _enc(v)})


def done(out, i):
    out({"i": i, "ok": True})


def fail(out, i, e):
    out({"i": i, "ok": False, "err": (type(e).__name__ + ": " + str(e))[:500]})
