/**
 * The distribution functions a graphing calculator carries, written out here
 * because the site ships no statistics library and an AP Statistics question
 * that needs a normal or a t probability is otherwise unanswerable.
 *
 * The incomplete gamma and incomplete beta routines are the standard series
 * and continued-fraction pair (Numerical Recipes §6.2, §6.4); both converge
 * to about 1e-14, well past the three decimal places the course asks for.
 */

const EPS = 1e-15;
const TINY = 1e-300;
const MAX_ITERATIONS = 400;

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x) for x > 0, by the Lanczos approximation. */
export function lnGamma(x: number): number {
  if (x < 0.5) {
    // Reflection, so the approximation is only ever used above 0.5.
    return (
      Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x)
    );
  }
  const z = x - 1;
  let sum = 0.99999999999980993;
  LANCZOS.forEach((c, i) => {
    sum += c / (z + i + 1);
  });
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** log n! */
export function lnFactorial(n: number): number {
  return lnGamma(n + 1);
}

/** n!, exactly for the values a calculator can hold. */
export function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n))
    throw new Error("A factorial needs a whole number that is not negative.");
  if (n > 170) return Infinity;
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

/** The number of combinations of n things taken r at a time. */
export function combinations(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0)
    throw new Error("nCr needs whole numbers that are not negative.");
  if (r > n) return 0;
  const k = Math.min(r, n - r);
  let out = 1;
  // Multiply and divide in step so the running value stays small.
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

/** The number of ordered arrangements of n things taken r at a time. */
export function permutations(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0)
    throw new Error("nPr needs whole numbers that are not negative.");
  if (r > n) return 0;
  let out = 1;
  for (let i = 0; i < r; i++) out *= n - i;
  return out;
}

/** The regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new Error("Undefined gamma argument.");
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series representation.
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n <= MAX_ITERATIONS; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Continued fraction for the upper tail, then complement it.
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** The regularised incomplete beta I_x(a, b). */
export function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // The continued fraction converges quickly only on one side of the mode.
  if (x >= (a + 1) / (a + b + 2)) return 1 - betaI(b, a, 1 - x);
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return (front * h) / a;
}

/** Φ(z): the area to the left of z under the standard normal curve. */
export function normalCdfBelow(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const half = gammaP(0.5, (z * z) / 2) / 2;
  return z >= 0 ? 0.5 + half : 0.5 - half;
}

/** The normal density, for drawing and for normalpdf. */
export function normalPdf(x: number, mean = 0, sd = 1): number {
  if (sd <= 0) throw new Error("A standard deviation must be positive.");
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** The area between two bounds under a normal curve, as normalcdf does it. */
export function normalCdf(lower: number, upper: number, mean = 0, sd = 1): number {
  if (sd <= 0) throw new Error("A standard deviation must be positive.");
  return (
    normalCdfBelow((upper - mean) / sd) - normalCdfBelow((lower - mean) / sd)
  );
}

/** The z (or x) with the given area to its left. */
export function invNorm(p: number, mean = 0, sd = 1): number {
  if (!(p > 0 && p < 1))
    throw new Error("An area must be strictly between 0 and 1.");
  if (sd <= 0) throw new Error("A standard deviation must be positive.");
  // Acklam's rational start, then Halley steps against our own Φ.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const low = 0.02425;
  let z: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    z =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    z =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 3; i++) {
    const error = normalCdfBelow(z) - p;
    const density = normalPdf(z);
    if (density < 1e-300) break;
    const u = error / density;
    z -= u / (1 + (z * u) / 2);
  }
  return mean + sd * z;
}

/** The area to the left of t in Student's t distribution. */
export function tCdfBelow(t: number, df: number): number {
  if (df <= 0) throw new Error("Degrees of freedom must be positive.");
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = betaI(df / 2, 0.5, df / (df + t * t)) / 2;
  return t >= 0 ? 1 - tail : tail;
}

/** The area between two bounds under a t curve, as tcdf does it. */
export function tCdf(lower: number, upper: number, df: number): number {
  return tCdfBelow(upper, df) - tCdfBelow(lower, df);
}

export function tPdf(t: number, df: number): number {
  if (df <= 0) throw new Error("Degrees of freedom must be positive.");
  return Math.exp(
    lnGamma((df + 1) / 2) -
      lnGamma(df / 2) -
      0.5 * Math.log(df * Math.PI) -
      ((df + 1) / 2) * Math.log(1 + (t * t) / df),
  );
}

/** Solves an increasing cumulative function for the value at a given area. */
function solveCdf(
  cdf: (value: number) => number,
  p: number,
  low: number,
  high: number,
): number {
  let a = low;
  let b = high;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (cdf(mid) < p) a = mid;
    else b = mid;
    if (b - a < 1e-12 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

/** The t with the given area to its left. */
export function invT(p: number, df: number): number {
  if (!(p > 0 && p < 1))
    throw new Error("An area must be strictly between 0 and 1.");
  return solveCdf((t) => tCdfBelow(t, df), p, -1e6, 1e6);
}

/** The area to the left of x in a chi-square distribution. */
export function chiSquareCdfBelow(x: number, df: number): number {
  if (df <= 0) throw new Error("Degrees of freedom must be positive.");
  return x <= 0 ? 0 : gammaP(df / 2, x / 2);
}

/** The area between two bounds under a chi-square curve. */
export function chiSquareCdf(lower: number, upper: number, df: number): number {
  return chiSquareCdfBelow(upper, df) - chiSquareCdfBelow(lower, df);
}

/** The chi-square value with the given area to its left. */
export function invChiSquare(p: number, df: number): number {
  if (!(p > 0 && p < 1))
    throw new Error("An area must be strictly between 0 and 1.");
  return solveCdf((x) => chiSquareCdfBelow(x, df), p, 0, 1e7);
}

function checkBinomial(n: number, p: number) {
  if (!Number.isInteger(n) || n < 0)
    throw new Error("The number of trials must be a whole number.");
  if (!(p >= 0 && p <= 1))
    throw new Error("A probability must be between 0 and 1.");
}

/** P(X = k) for X ~ B(n, p). */
export function binomialPdf(n: number, p: number, k: number): number {
  checkBinomial(n, p);
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(
    lnFactorial(n) -
      lnFactorial(k) -
      lnFactorial(n - k) +
      k * Math.log(p) +
      (n - k) * Math.log(1 - p),
  );
}

/** P(X ≤ k) for X ~ B(n, p). */
export function binomialCdf(n: number, p: number, k: number): number {
  checkBinomial(n, p);
  const top = Math.floor(k);
  if (top < 0) return 0;
  if (top >= n) return 1;
  let sum = 0;
  for (let i = 0; i <= top; i++) sum += binomialPdf(n, p, i);
  return Math.min(1, sum);
}

/** P(first success on trial k) for a geometric distribution. */
export function geometricPdf(p: number, k: number): number {
  if (!(p > 0 && p <= 1))
    throw new Error("A probability must be between 0 and 1.");
  if (!Number.isInteger(k) || k < 1) return 0;
  return Math.pow(1 - p, k - 1) * p;
}

/** P(first success on or before trial k). */
export function geometricCdf(p: number, k: number): number {
  if (!(p > 0 && p <= 1))
    throw new Error("A probability must be between 0 and 1.");
  return k < 1 ? 0 : 1 - Math.pow(1 - p, Math.floor(k));
}

/** P(X = k) for a Poisson count with mean λ. */
export function poissonPdf(mean: number, k: number): number {
  if (mean < 0) throw new Error("A Poisson mean cannot be negative.");
  if (!Number.isInteger(k) || k < 0) return 0;
  if (mean === 0) return k === 0 ? 1 : 0;
  return Math.exp(-mean + k * Math.log(mean) - lnFactorial(k));
}

/** P(X ≤ k) for a Poisson count with mean λ. */
export function poissonCdf(mean: number, k: number): number {
  const top = Math.floor(k);
  if (top < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= top; i++) sum += poissonPdf(mean, i);
  return Math.min(1, sum);
}
