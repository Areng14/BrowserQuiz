# Harness helper: turns return values into JSON lines tagged with a per-run marker.
# The server reads these lines and compares them to the expected values, which never enter the sandbox.
# The marker only lives in main.py's locals (main.py deletes itself first) and in the closure writer()
# returns, which main.py makes before importing the student's code.
import json
import math


TYPES = {}  # the question's classes and their fields, set by main.py
CLASSES = {}


def _enc(v, d=0):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if d > 400:
        return "..."
    if isinstance(v, (list, tuple)):
        return [_enc(x, d + 1) for x in v]
    if isinstance(v, dict):  # keys become strings, as in JSON
        return {str(k): _enc(x, d + 1) for k, x in v.items()}
    for c in type(v).__mro__:  # an object of one of the question's classes: its fields
        if c.__name__ in TYPES:
            return {f: _enc(getattr(v, f, None), d + 1) for f in TYPES[c.__name__]}
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
    # {"__obj__": "Point", "f": [...]}: an object of one of the question's classes, fields in order.
    # {"__list__": [...]}: a list that holds such objects.
    if isinstance(v, dict):
        if "__obj__" in v:
            return CLASSES[v["__obj__"]](*[_gen(x) for x in v["f"]])
        if "__list__" in v:
            return [_gen(x) for x in v["__list__"]]
        if "__map__" in v:
            return {k: _gen(x) for k, x in v["__map__"]}
        if "range" in v:
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
