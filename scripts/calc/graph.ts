/**
 * What a graphing calculator does beyond drawing: the features a question
 * asks a student to read off a graph — zeros, intersections, turning points,
 * a value, a slope, an area. Everything here works on a compiled function of
 * one variable, so it is independent of how the curve is drawn.
 */

export type Window = { xMin: number; xMax: number; yMin: number; yMax: number };

export const DEFAULT_WINDOW: Window = {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
};

export type Fn = (x: number) => number;

/** A run of points with no break in it; a new run starts at a discontinuity. */
export type Path = { x: number; y: number }[];

/**
 * Samples a function across the window, splitting the curve wherever it stops
 * being defined or jumps — so 1/x is drawn as two branches rather than joined
 * across the asymptote by a vertical line that is not part of the graph.
 */
export function samplePaths(f: Fn, window: Window, steps = 600): Path[] {
  const { xMin, xMax, yMin, yMax } = window;
  const step = (xMax - xMin) / steps;
  const height = yMax - yMin;
  const paths: Path[] = [];
  let current: Path = [];
  let previous: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * step;
    const y = f(x);
    const usable = Number.isFinite(y);
    // A jump larger than the whole window between neighbouring samples is an
    // asymptote, not a steep segment.
    const jumped =
      usable && previous !== null && Math.abs(y - previous) > height * 2;
    if (!usable || jumped) {
      if (current.length > 1) paths.push(current);
      current = [];
      previous = usable ? y : null;
      if (usable) current.push({ x, y });
      continue;
    }
    current.push({ x, y });
    previous = y;
  }
  if (current.length > 1) paths.push(current);
  return paths;
}

/** Narrows a sign change to the root inside it. */
function bisect(f: Fn, lower: number, upper: number): number | null {
  let a = lower;
  let b = upper;
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0 || (b - a) / 2 < 1e-12) return mid;
    if (fa * fm < 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

const tidy = (value: number) => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Every x in the window where the curve meets the axis. */
export function zeros(f: Fn, window: Window, steps = 2000): number[] {
  const { xMin, xMax } = window;
  const step = (xMax - xMin) / steps;
  const found: number[] = [];
  const keep = (x: number) => {
    const value = tidy(x);
    // A root landing on a sample point is also found by the sign change on
    // either side of it, so only the first sighting is kept.
    if (!found.some((seen) => Math.abs(seen - value) < step / 2))
      found.push(value);
  };
  let previousX = xMin;
  let previousY = f(xMin);
  if (previousY === 0) keep(xMin);
  for (let i = 1; i <= steps; i++) {
    const x = xMin + i * step;
    const y = f(x);
    if (y === 0) keep(x);
    else if (
      Number.isFinite(previousY) &&
      Number.isFinite(y) &&
      previousY * y < 0
    ) {
      const root = bisect(f, previousX, x);
      // A pole changes sign too; at a genuine root the value really is small.
      if (root !== null && Math.abs(f(root)) < 1e-6) keep(root);
    }
    previousX = x;
    previousY = y;
  }
  return found.sort((a, b) => a - b);
}

/** Where two curves meet, found as the zeros of their difference. */
export function intersections(
  f: Fn,
  g: Fn,
  window: Window,
): { x: number; y: number }[] {
  return zeros((x) => f(x) - g(x), window).map((x) => ({
    x,
    y: tidy(f(x)),
  }));
}

export type Extremum = { x: number; y: number; kind: "minimum" | "maximum" };

/** Turning points inside the window, refined from a coarse scan. */
export function extrema(f: Fn, window: Window, steps = 1200): Extremum[] {
  const { xMin, xMax } = window;
  const step = (xMax - xMin) / steps;
  const out: Extremum[] = [];
  for (let i = 1; i < steps; i++) {
    const left = xMin + (i - 1) * step;
    const middle = xMin + i * step;
    const right = xMin + (i + 1) * step;
    const [a, b, c] = [f(left), f(middle), f(right)];
    if (![a, b, c].every(Number.isFinite)) continue;
    const isMax = b > a && b > c;
    const isMin = b < a && b < c;
    if (!isMax && !isMin) continue;
    // Golden-section down to where the comparisons are still meaningful.
    // Past that the two values differ only by float noise, so the search
    // wanders; a parabolic step finishes the job and is exact on a parabola.
    let lo = left;
    let hi = right;
    const phi = (Math.sqrt(5) - 1) / 2;
    const tolerance = Math.max(1e-7, Math.abs(middle) * 1e-7);
    for (let k = 0; k < 200 && hi - lo > tolerance; k++) {
      const p = hi - phi * (hi - lo);
      const q = lo + phi * (hi - lo);
      const better = isMax ? f(p) < f(q) : f(p) > f(q);
      if (better) lo = p;
      else hi = q;
    }
    let x = (lo + hi) / 2;
    const d = Math.max(1e-4, Math.abs(x) * 1e-4);
    const [fl, fm, fr] = [f(x - d), f(x), f(x + d)];
    const curvature = fl - 2 * fm + fr;
    if (Math.abs(curvature) > 1e-300) {
      const shift = (d / 2) * ((fl - fr) / curvature);
      if (Math.abs(shift) <= d) x += shift;
    }
    out.push({ x: tidy(x), y: tidy(f(x)), kind: isMax ? "maximum" : "minimum" });
  }
  return out;
}

/** The slope at a point, by a Richardson-extrapolated central difference. */
export function derivativeAt(f: Fn, x: number): number {
  const h = Math.max(1e-5, Math.abs(x) * 1e-5);
  const first = (f(x + h) - f(x - h)) / (2 * h);
  const second = (f(x + h / 2) - f(x - h / 2)) / h;
  return tidy((4 * second - first) / 3);
}

/** The signed area under the curve, by adaptive Simpson's rule. */
export function integrate(f: Fn, from: number, to: number): number {
  if (from === to) return 0;
  const simpson = (a: number, b: number) =>
    ((b - a) / 6) * (f(a) + 4 * f((a + b) / 2) + f(b));
  const refine = (a: number, b: number, whole: number, depth: number): number => {
    const mid = (a + b) / 2;
    const left = simpson(a, mid);
    const right = simpson(mid, b);
    if (depth <= 0 || Math.abs(left + right - whole) < 1e-10)
      return left + right + (left + right - whole) / 15;
    return refine(a, mid, left, depth - 1) + refine(mid, b, right, depth - 1);
  };
  const value = refine(from, to, simpson(from, to), 24);
  if (!Number.isFinite(value))
    throw new Error("This integral does not settle on a value.");
  return tidy(value);
}

/** A table of values, the way a calculator's TABLE screen lists them. */
export function table(
  f: Fn,
  start: number,
  step: number,
  rows = 10,
): { x: number; y: number }[] {
  return Array.from({ length: rows }, (_, i) => {
    const x = tidy(start + i * step);
    return { x, y: f(x) };
  });
}
