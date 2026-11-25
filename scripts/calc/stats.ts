/** One- and two-variable summaries, in the order a calculator reports them. */

export type OneVarStats = {
  n: number;
  sum: number;
  sumSquares: number;
  mean: number;
  /** The sample standard deviation, Sx, dividing by n − 1. */
  sampleSd: number;
  /** The population standard deviation, σx, dividing by n. */
  populationSd: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

/** The middle value, averaging the two middle values of an even-length list. */
function middle(sorted: number[]): number {
  const n = sorted.length;
  if (!n) throw new Error("Enter at least one value.");
  const half = Math.floor(n / 2);
  return n % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function oneVarStats(data: number[]): OneVarStats {
  if (!data.length) throw new Error("Enter at least one value.");
  const n = data.length;
  const sorted = [...data].sort((a, b) => a - b);
  const sum = data.reduce((total, x) => total + x, 0);
  const sumSquares = data.reduce((total, x) => total + x * x, 0);
  const mean = sum / n;
  const squaredError = data.reduce((total, x) => total + (x - mean) ** 2, 0);
  const half = Math.floor(n / 2);
  // The quartiles split the halves on either side of the median, and an odd
  // middle value belongs to neither half — the convention a TI uses.
  return {
    n,
    sum,
    sumSquares,
    mean,
    sampleSd: n > 1 ? Math.sqrt(squaredError / (n - 1)) : NaN,
    populationSd: Math.sqrt(squaredError / n),
    min: sorted[0],
    q1: middle(sorted.slice(0, half)),
    median: middle(sorted),
    q3: middle(sorted.slice(n % 2 ? half + 1 : half)),
    max: sorted[n - 1],
  };
}

export type LinearRegression = {
  n: number;
  /** y = a + bx, the form AP Statistics writes a least-squares line in. */
  a: number;
  b: number;
  r: number;
  rSquared: number;
  meanX: number;
  meanY: number;
  sdX: number;
  sdY: number;
};

export function linearRegression(
  xs: number[],
  ys: number[],
): LinearRegression {
  if (xs.length !== ys.length)
    throw new Error("Both lists must hold the same number of values.");
  if (xs.length < 2) throw new Error("Enter at least two pairs.");
  const n = xs.length;
  const meanX = xs.reduce((t, x) => t + x, 0) / n;
  const meanY = ys.reduce((t, y) => t + y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sxx === 0)
    throw new Error("Every x is the same, so no line can be fitted.");
  const b = sxy / sxx;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return {
    n,
    a: meanY - b * meanX,
    b,
    r,
    rSquared: r * r,
    meanX,
    meanY,
    sdX: Math.sqrt(sxx / (n - 1)),
    sdY: Math.sqrt(syy / (n - 1)),
  };
}
