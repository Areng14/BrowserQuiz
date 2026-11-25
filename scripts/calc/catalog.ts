/**
 * Every function the calculator answers to, described once. The evaluator
 * reads the argument counts from here, and the autocomplete reads the names,
 * the parameter list and the one-line summary, so a function can never be
 * offered by the editor without the evaluator knowing it.
 */

export type Category = "maths" | "counting" | "statistics" | "distributions" | "matrices";

export type Entry = {
  name: string;
  /** Parameter names, in order; the last ones may be optional. */
  params: string[];
  /** How many of those parameters are required. */
  required: number;
  /** True when the last parameter may be repeated, as min and max allow. */
  variadic?: boolean;
  summary: string;
  category: Category;
  /** Shown under the summary when the call is easy to get the wrong way round. */
  example?: string;
};

export const CATALOG: Entry[] = [
  // Maths
  { name: "sin", params: ["angle"], required: 1, summary: "Sine of an angle, in the current angle mode.", category: "maths" },
  { name: "cos", params: ["angle"], required: 1, summary: "Cosine of an angle, in the current angle mode.", category: "maths" },
  { name: "tan", params: ["angle"], required: 1, summary: "Tangent of an angle, in the current angle mode.", category: "maths" },
  { name: "asin", params: ["value"], required: 1, summary: "Inverse sine; returns an angle in the current mode.", category: "maths" },
  { name: "acos", params: ["value"], required: 1, summary: "Inverse cosine; returns an angle in the current mode.", category: "maths" },
  { name: "atan", params: ["value"], required: 1, summary: "Inverse tangent; returns an angle in the current mode.", category: "maths" },
  { name: "sinh", params: ["x"], required: 1, summary: "Hyperbolic sine.", category: "maths" },
  { name: "cosh", params: ["x"], required: 1, summary: "Hyperbolic cosine.", category: "maths" },
  { name: "tanh", params: ["x"], required: 1, summary: "Hyperbolic tangent.", category: "maths" },
  { name: "sqrt", params: ["x"], required: 1, summary: "Square root.", category: "maths" },
  { name: "cbrt", params: ["x"], required: 1, summary: "Cube root.", category: "maths" },
  { name: "abs", params: ["x"], required: 1, summary: "Absolute value.", category: "maths" },
  { name: "exp", params: ["x"], required: 1, summary: "e raised to the power x.", category: "maths" },
  { name: "ln", params: ["x"], required: 1, summary: "Natural logarithm, base e.", category: "maths" },
  { name: "log", params: ["x", "base"], required: 1, summary: "Logarithm base 10, or base b when a base is given.", category: "maths", example: "log(8, 2) = 3" },
  { name: "logb", params: ["base", "x"], required: 2, summary: "Logarithm of x to the given base.", category: "maths", example: "logb(2, 8) = 3" },
  { name: "round", params: ["x", "places"], required: 1, summary: "Rounds to the given number of decimal places.", category: "maths" },
  { name: "floor", params: ["x"], required: 1, summary: "Rounds down to a whole number.", category: "maths" },
  { name: "ceil", params: ["x"], required: 1, summary: "Rounds up to a whole number.", category: "maths" },
  { name: "sign", params: ["x"], required: 1, summary: "−1, 0 or 1, matching the sign of x.", category: "maths" },
  { name: "mod", params: ["a", "b"], required: 2, summary: "Remainder of a divided by b, never negative.", category: "maths" },

  // Counting
  { name: "fact", params: ["n"], required: 1, summary: "n factorial. The ! key does the same thing.", category: "counting" },
  { name: "ncr", params: ["n", "r"], required: 2, summary: "Combinations: how many ways to choose r from n.", category: "counting", example: "ncr(10, 3) = 120" },
  { name: "npr", params: ["n", "r"], required: 2, summary: "Permutations: ordered arrangements of r from n.", category: "counting" },

  // One- and two-variable statistics, over a list written in brackets
  { name: "mean", params: ["list"], required: 1, variadic: true, summary: "The mean of a list of values.", category: "statistics", example: "mean([2, 4, 6, 8]) = 5" },
  { name: "median", params: ["list"], required: 1, variadic: true, summary: "The middle value of a list.", category: "statistics" },
  { name: "stdev", params: ["list"], required: 1, variadic: true, summary: "Sample standard deviation, Sx, dividing by n − 1.", category: "statistics" },
  { name: "stdevp", params: ["list"], required: 1, variadic: true, summary: "Population standard deviation, σx, dividing by n.", category: "statistics" },
  { name: "variance", params: ["list"], required: 1, variadic: true, summary: "Sample variance, Sx².", category: "statistics" },
  { name: "sum", params: ["list"], required: 1, variadic: true, summary: "The total of a list of values.", category: "statistics" },
  { name: "count", params: ["list"], required: 1, variadic: true, summary: "How many values the list holds.", category: "statistics" },
  { name: "min", params: ["list"], required: 1, variadic: true, summary: "The smallest value.", category: "statistics" },
  { name: "max", params: ["list"], required: 1, variadic: true, summary: "The largest value.", category: "statistics" },
  { name: "q1", params: ["list"], required: 1, variadic: true, summary: "The lower quartile.", category: "statistics" },
  { name: "q3", params: ["list"], required: 1, variadic: true, summary: "The upper quartile.", category: "statistics" },
  { name: "iqr", params: ["list"], required: 1, variadic: true, summary: "The interquartile range, Q3 − Q1.", category: "statistics" },
  { name: "slope", params: ["xs", "ys"], required: 2, summary: "Slope b of the least-squares line y = a + bx.", category: "statistics", example: "slope([1,2,3], [3,5,7]) = 2" },
  { name: "intercept", params: ["xs", "ys"], required: 2, summary: "Intercept a of the least-squares line y = a + bx.", category: "statistics" },
  { name: "corr", params: ["xs", "ys"], required: 2, summary: "The correlation coefficient r.", category: "statistics" },
  { name: "r2", params: ["xs", "ys"], required: 2, summary: "The coefficient of determination, r².", category: "statistics" },

  // Distributions
  { name: "normalpdf", params: ["x", "mean", "sd"], required: 1, summary: "Height of a normal curve at x. Mean 0 and sd 1 unless given.", category: "distributions" },
  { name: "normalcdf", params: ["lower", "upper", "mean", "sd"], required: 2, summary: "Area under a normal curve between two bounds.", category: "distributions", example: "normalcdf(1.96, inf) = 0.025" },
  { name: "invnorm", params: ["area", "mean", "sd"], required: 1, summary: "The value with this area to its left.", category: "distributions", example: "invnorm(0.975) = 1.96" },
  { name: "tpdf", params: ["t", "df"], required: 2, summary: "Height of a t curve at t.", category: "distributions" },
  { name: "tcdf", params: ["lower", "upper", "df"], required: 3, summary: "Area under a t curve between two bounds.", category: "distributions", example: "tcdf(2.131, inf, 15) = 0.025" },
  { name: "invt", params: ["area", "df"], required: 2, summary: "The t with this area to its left.", category: "distributions" },
  { name: "chi2cdf", params: ["lower", "upper", "df"], required: 3, summary: "Area under a chi-square curve between two bounds.", category: "distributions" },
  { name: "invchi2", params: ["area", "df"], required: 2, summary: "The chi-square value with this area to its left.", category: "distributions" },
  { name: "binompdf", params: ["n", "p", "k"], required: 3, summary: "P(X = k) for a binomial count.", category: "distributions" },
  { name: "binomcdf", params: ["n", "p", "k"], required: 3, summary: "P(X ≤ k) for a binomial count.", category: "distributions" },
  { name: "geometpdf", params: ["p", "k"], required: 2, summary: "P(first success on trial k).", category: "distributions" },
  { name: "geometcdf", params: ["p", "k"], required: 2, summary: "P(first success on or before trial k).", category: "distributions" },
  { name: "poissonpdf", params: ["mean", "k"], required: 2, summary: "P(X = k) for a Poisson count.", category: "distributions" },
  { name: "poissoncdf", params: ["mean", "k"], required: 2, summary: "P(X ≤ k) for a Poisson count.", category: "distributions" },

  // Matrices, written as rows in brackets
  { name: "det", params: ["matrix"], required: 1, summary: "The determinant of a square matrix.", category: "matrices", example: "det([[2,3],[1,4]]) = 5" },
  { name: "inv", params: ["matrix"], required: 1, summary: "The inverse of a square matrix.", category: "matrices" },
  { name: "transpose", params: ["matrix"], required: 1, summary: "Swaps the rows and columns.", category: "matrices" },
  { name: "rref", params: ["matrix"], required: 1, summary: "Reduced row echelon form; solves a system from its augmented matrix.", category: "matrices", example: "rref([[1,1,5],[1,-1,1]])" },
  { name: "rank", params: ["matrix"], required: 1, summary: "The number of independent rows.", category: "matrices" },
  { name: "identity", params: ["n"], required: 1, summary: "The n by n identity matrix.", category: "matrices" },
];

export const BY_NAME = new Map(CATALOG.map((entry) => [entry.name, entry]));

/** The constants that may stand on their own in an expression. */
export const CONSTANTS = [
  { name: "pi", summary: "π, 3.14159…" },
  { name: "e", summary: "Euler's number, 2.71828…" },
  { name: "inf", summary: "Infinity, for the open end of a distribution's bounds." },
];

/** How the call is written, for the hint shown while the caret is inside it. */
export function signature(entry: Entry): string {
  const shown = entry.params.map((name, index) =>
    index < entry.required ? name : `[${name}]`,
  );
  if (entry.variadic && entry.params.length === 1) return `${entry.name}(list)`;
  return `${entry.name}(${shown.join(", ")})`;
}

/**
 * The completions for a half-typed name, best match first: names that start
 * with what was typed, then names that merely contain it.
 */
export function complete(typed: string, limit = 8): Entry[] {
  const needle = typed.trim().toLowerCase();
  // Only a name being typed brings up the list. A digit would otherwise
  // match the 1 in q1 while somebody is writing out a number.
  if (!/^[a-z]/.test(needle)) return [];
  const starts = CATALOG.filter((entry) => entry.name.startsWith(needle));
  // Matching in the middle of a name is useful once there is enough to go
  // on — "dev" should find stdev — but one letter would match almost
  // everything.
  const contains =
    needle.length < 2
      ? []
      : CATALOG.filter(
          (entry) =>
            !entry.name.startsWith(needle) && entry.name.includes(needle),
        );
  return [...starts, ...contains].slice(0, limit);
}
