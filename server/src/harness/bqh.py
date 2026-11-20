# Harness helper: turns return values into JSON lines tagged with a per-run marker.
# The server reads these lines and compares them to the expected values, which never enter the sandbox.
import json
import math
import sys

M = ""


def _enc(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, (list, tuple)):
        return [_enc(x) for x in v]
    return str(v)


def _out(o):
    sys.stdout.flush()
    sys.stdout.write(M + json.dumps(o) + "\n")
    sys.stdout.flush()


def _gen(v):
    # {"range": [start, stop, step]}: a big test argument made here instead of written out
    if isinstance(v, dict) and "range" in v:
        return list(range(*v["range"]))
    return v


def args(s):
    return [_gen(v) for v in json.loads(s)]


def timed(i, v, ms):
    _out({"i": i, "ok": True, "v": _enc(v), "ms": ms})


def ok(i, v):
    _out({"i": i, "ok": True, "v": _enc(v)})


def step(i, s, v):
    _out({"i": i, "s": s, "v": _enc(v)})


def done(i):
    _out({"i": i, "ok": True})


def fail(i, e):
    _out({"i": i, "ok": False, "err": (type(e).__name__ + ": " + str(e))[:500]})
