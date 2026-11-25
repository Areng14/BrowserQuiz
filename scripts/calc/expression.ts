import { parse, type MathNode } from "mathjs";
import { BY_NAME, CATALOG, signature } from "./catalog";
import {
  binomialCdf,
  binomialPdf,
  chiSquareCdf,
  combinations,
  factorial,
  geometricCdf,
  geometricPdf,
  invChiSquare,
  invNorm,
  invT,
  normalCdf,
  normalPdf,
  permutations,
  poissonCdf,
  poissonPdf,
  tCdf,
  tPdf,
} from "./distributions";
import {
  determinant,
  inverse,
  rank,
  rref,
  transpose,
  type Matrix,
} from "./matrix";
import { linearRegression, oneVarStats } from "./stats";

export type AngleMode = "radians" | "degrees";

/** What an expression can evaluate to: a number, a list, or a matrix. */
export type Value = number | number[] | Matrix;

/**
 * The calculator's own expression language. It is deliberately separate from
 * the grader's parser in engine/check: the grader accepts only the handful of
 * functions an answer may contain, while a calculator carries everything the
 * courses need — logs to any base, combinations, the distributions an AP
 * Statistics question calls for, and determinants. Both parsers whitelist in
 * the same way, so neither can be talked into evaluating anything but
 * arithmetic over numbers and lists of numbers.
 */
const NODE_TYPES = new Set([
  "ConstantNode",
  "SymbolNode",
  "OperatorNode",
  "ParenthesisNode",
  "FunctionNode",
  // A list or a matrix is written in brackets, so det and mean have something
  // to take. Nothing else about arrays is allowed: no indexing, no ranges.
  "ArrayNode",
]);

const OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "!"]);

/* ------------------------------------------------------------------ *
 * Argument checking
 * ------------------------------------------------------------------ */

/**
 * math.js hands a bracketed list back as its own Matrix object, so every
 * argument is unwrapped before it is looked at.
 */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "toArray" in value)
    return (value as { toArray: () => unknown }).toArray();
  return value;
}

const number = (value: Value, where: string): number => {
  const plainValue = unwrap(value);
  if (typeof plainValue !== "number")
    throw new Error(`${where} needs a number, not a list.`);
  return plainValue;
};

/** A list of numbers, whether it was written in brackets or spelled out. */
function list(values: Value[], where: string): number[] {
  const flat: number[] = [];
  for (const value of values) {
    const plainValue = unwrap(value);
    if (typeof plainValue === "number") flat.push(plainValue);
    else if (
      Array.isArray(plainValue) &&
      plainValue.every((entry) => typeof entry === "number")
    )
      flat.push(...(plainValue as number[]));
    else throw new Error(`${where} needs a list of numbers.`);
  }
  if (!flat.length) throw new Error(`${where} needs at least one value.`);
  return flat;
}

function matrix(value: Value, where: string): Matrix {
  const rows = unwrap(value);
  if (!Array.isArray(rows))
    throw new Error(`${where} needs a matrix, written as rows in brackets.`);
  if (rows.every((row) => typeof row === "number"))
    // A single list is read as a one-row matrix, which is what it looks like.
    return [rows as number[]];
  if (
    rows.every(
      (row) => Array.isArray(row) && row.every((n) => typeof n === "number"),
    )
  )
    return rows as Matrix;
  throw new Error(`${where} needs a matrix of numbers.`);
}

/* ------------------------------------------------------------------ *
 * The functions themselves
 * ------------------------------------------------------------------ */

type Fn = (...args: Value[]) => Value;

function build(mode: AngleMode): Map<string, Fn | number> {
  const toRadians = (value: number) =>
    mode === "degrees" ? (value * Math.PI) / 180 : value;
  // An inverse trig function returns an angle, so it converts the other way:
  // in Degrees the answer comes back in degrees, ready to type in.
  const fromRadians = (value: number) =>
    mode === "degrees" ? (value * 180) / Math.PI : value;
  /**
   * sin(pi) is 1.2e-16 in floating point, not 0, and printing that as an
   * answer is the kind of thing that makes a student distrust the tool. The
   * fifteenth decimal place is past anything the screen shows, so rounding
   * there clears the noise without costing a digit of a real result.
   */
  const settle = (value: number) => {
    const rounded = Math.round(value * 1e14) / 1e14;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const inRange = (value: number) => {
    if (value < -1 || value > 1)
      throw new Error("Sine and cosine only take values from −1 to 1.");
    return value;
  };
  /** Wraps a plain numeric function so its arguments are checked by name. */
  const of =
    (name: string, fn: (...args: number[]) => number): Fn =>
    (...args) =>
      fn(...args.map((value) => number(value, name)));
  /** Wraps a one-variable summary, which takes a list however it is written. */
  const over =
    (name: string, fn: (data: number[]) => number): Fn =>
    (...args) =>
      fn(list(args, name));
  /** Wraps a two-list regression figure. */
  const fit =
    (name: string, pick: (r: ReturnType<typeof linearRegression>) => number): Fn =>
    (xs, ys) =>
      pick(linearRegression(list([xs], name), list([ys], name)));

  return new Map<string, Fn | number>([
    ["sin", of("sin", (x) => settle(Math.sin(toRadians(x))))],
    ["cos", of("cos", (x) => settle(Math.cos(toRadians(x))))],
    [
      "tan",
      of("tan", (x) => {
        const radians = toRadians(x);
        if (Math.abs(Math.cos(radians)) < 1e-14)
          throw new Error("Undefined tangent.");
        return settle(Math.tan(radians));
      }),
    ],
    ["asin", of("asin", (x) => settle(fromRadians(Math.asin(inRange(x)))))],
    ["acos", of("acos", (x) => settle(fromRadians(Math.acos(inRange(x)))))],
    ["atan", of("atan", (x) => settle(fromRadians(Math.atan(x))))],
    ["sinh", of("sinh", Math.sinh)],
    ["cosh", of("cosh", Math.cosh)],
    ["tanh", of("tanh", Math.tanh)],
    ["sqrt", of("sqrt", Math.sqrt)],
    ["cbrt", of("cbrt", Math.cbrt)],
    ["abs", of("abs", Math.abs)],
    ["exp", of("exp", Math.exp)],
    ["ln", of("ln", Math.log)],
    // log is base 10, as it is on a calculator key; log(x, b) takes a base.
    [
      "log",
      of("log", (x, base) =>
        base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base),
      ),
    ],
    ["logb", of("logb", (base, x) => Math.log(x) / Math.log(base))],
    [
      "round",
      of("round", (x, places = 0) => {
        const factor = 10 ** places;
        return Math.round(x * factor) / factor;
      }),
    ],
    ["floor", of("floor", Math.floor)],
    ["ceil", of("ceil", Math.ceil)],
    ["sign", of("sign", Math.sign)],
    ["mod", of("mod", (a, b) => ((a % b) + b) % b)],

    ["fact", of("fact", factorial)],
    ["ncr", of("ncr", combinations)],
    ["npr", of("npr", permutations)],

    ["mean", over("mean", (data) => oneVarStats(data).mean)],
    ["median", over("median", (data) => oneVarStats(data).median)],
    ["stdev", over("stdev", (data) => oneVarStats(data).sampleSd)],
    ["stdevp", over("stdevp", (data) => oneVarStats(data).populationSd)],
    ["variance", over("variance", (data) => oneVarStats(data).sampleSd ** 2)],
    ["sum", over("sum", (data) => oneVarStats(data).sum)],
    ["count", over("count", (data) => data.length)],
    ["min", over("min", (data) => Math.min(...data))],
    ["max", over("max", (data) => Math.max(...data))],
    ["q1", over("q1", (data) => oneVarStats(data).q1)],
    ["q3", over("q3", (data) => oneVarStats(data).q3)],
    ["iqr", over("iqr", (data) => oneVarStats(data).q3 - oneVarStats(data).q1)],
    ["slope", fit("slope", (r) => r.b)],
    ["intercept", fit("intercept", (r) => r.a)],
    ["corr", fit("corr", (r) => r.r)],
    ["r2", fit("r2", (r) => r.rSquared)],

    ["normalpdf", of("normalpdf", (x, mean = 0, sd = 1) => normalPdf(x, mean, sd))],
    ["normalcdf", of("normalcdf", (lower, upper, mean = 0, sd = 1) => normalCdf(lower, upper, mean, sd))],
    ["invnorm", of("invnorm", (p, mean = 0, sd = 1) => invNorm(p, mean, sd))],
    ["tpdf", of("tpdf", tPdf)],
    ["tcdf", of("tcdf", tCdf)],
    ["invt", of("invt", invT)],
    ["chi2cdf", of("chi2cdf", chiSquareCdf)],
    ["invchi2", of("invchi2", invChiSquare)],
    ["binompdf", of("binompdf", binomialPdf)],
    ["binomcdf", of("binomcdf", binomialCdf)],
    ["geometpdf", of("geometpdf", geometricPdf)],
    ["geometcdf", of("geometcdf", geometricCdf)],
    ["poissonpdf", of("poissonpdf", poissonPdf)],
    ["poissoncdf", of("poissoncdf", poissonCdf)],

    ["det", (m) => determinant(matrix(m, "det"))],
    ["inv", (m) => inverse(matrix(m, "inv"))],
    ["transpose", (m) => transpose(matrix(m, "transpose"))],
    ["rref", (m) => rref(matrix(m, "rref"))],
    ["rank", (m) => rank(matrix(m, "rank"))],
    [
      "identity",
      (size) => {
        const n = number(size, "identity");
        if (!Number.isInteger(n) || n < 1 || n > 8)
          throw new Error("identity needs a whole number from 1 to 8.");
        return Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
        );
      },
    ],

    ["pi", Math.PI],
    ["e", Math.E],
    // The open end of a distribution's bounds, so normalcdf(1.96, inf) reads
    // the way it is said out loud.
    ["inf", Infinity],
  ]);
}

/** Every name the calculator answers to. */
export const FUNCTION_NAMES = CATALOG.map((entry) => entry.name);

/**
 * Closes the brackets still open at the end. Pressing Enter on
 * "normalcdf(1.96, inf" should work the answer out, the way it does on a
 * calculator, rather than complain about the bracket nobody types.
 */
function close(text: string): string {
  const open: string[] = [];
  for (const character of text) {
    if (character === "(" || character === "[") open.push(character);
    else if (character === ")" || character === "]") open.pop();
  }
  return (
    text +
    open
      .reverse()
      .map((bracket) => (bracket === "(" ? ")" : "]"))
      .join("")
  );
}

/** math.js's own parser errors name character offsets; these do not help. */
function read(text: string): MathNode {
  try {
    return parse(text);
  } catch {
    throw new Error("Syntax error — check the brackets and commas.");
  }
}

/** Parses arithmetic only: no assignment, no statement, nothing executable. */
export function parseExpression(
  input: string,
  variables: string[] = [],
): MathNode {
  if (!input.trim()) throw new Error("Enter an expression.");
  if (input.length > 250) throw new Error("That expression is too long.");
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[−–]/g, "-")
    // MathLive writes a typed * as ∗ (\ast), and \cdot as ⋅
    .replace(/[×·∗⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/π/g, "pi")
    .replace(/∞/g, "inf")
    .replace(/\*\*/g, "^")
    // MathLive writes each letter of a name as its own symbol, so the answer
    // box hands back "n c r(10,3)" and "o o" for infinity. Runs of single
    // letters are the name they spell.
    .replace(/(?<![a-z])[a-z](?: [a-z])+(?![a-z])/g, (run) => run.replace(/ /g, ""))
    .replace(/\boo\b/g, "inf")
    // Inverse trig the way it is written on paper and on calculator keys.
    // This runs before the bracket rule below, which would otherwise put a
    // product sign inside cos^(-1)( and stop it being recognised.
    .replace(/\barc(sin|cos|tan)\s*\(/g, "a$1(")
    .replace(/\b(sin|cos|tan)\s*\^\s*\(?\s*-\s*1\s*\)?\s*\(/g, "a$1(")
    // A fraction comes back as (a)/(b), so a product reads as (a)/(b)pi. In
    // math.js an implicit product binds tighter than division, which would
    // make that a/(b*pi); an explicit sign after a bracket keeps the meaning.
    .replace(/\)(?=\s*[0-9a-zA-Z(])/g, ")*");
  const node = read(close(text));
  let count = 0;
  node.traverse((child) => {
    if (++count > 400) throw new Error("That expression is too long.");
    if (!NODE_TYPES.has(child.type)) throw new Error("Unsupported expression.");
    if (child.type === "SymbolNode") {
      const { name } = child as MathNode & { name: string };
      if (
        !["pi", "e", "inf", ...variables].includes(name) &&
        !BY_NAME.has(name)
      )
        throw new Error(`Syntax error — nothing here is called "${name}".`);
    }
    if (child.type === "FunctionNode") {
      const call = child as MathNode & { fn: { name?: string }; args: MathNode[] };
      const name = call.fn?.name ?? "";
      const entry = BY_NAME.get(name);
      if (!entry) throw new Error(`Syntax error — there is no function "${name}".`);
      const most = entry.variadic ? 64 : entry.params.length;
      if (call.args.length < entry.required || call.args.length > most)
        throw new Error(`Write it as ${signature(entry)}.`);
    }
    if (
      child.type === "OperatorNode" &&
      !OPERATORS.has((child as MathNode & { op: string }).op)
    )
      throw new Error("Unsupported operator.");
  });
  return node;
}

/** The finished result, with math.js's own matrix object unwrapped. */
function plain(value: unknown): Value {
  const unwrapped = unwrap(value);
  if (typeof unwrapped === "number") return unwrapped;
  if (Array.isArray(unwrapped)) {
    if (unwrapped.every((entry) => typeof entry === "number"))
      return unwrapped as number[];
    if (
      unwrapped.every(
        (row) => Array.isArray(row) && row.every((n) => typeof n === "number"),
      )
    )
      return unwrapped as Matrix;
  }
  throw new Error("This calculation has no result the screen can show.");
}

/** A compiled expression in one variable, for plotting and for tables. */
export function compileFunction(
  input: string,
  variable = "x",
  mode: AngleMode = "radians",
): (value: number) => number {
  const compiled = parseExpression(input, [variable]).compile();
  const scope = build(mode);
  return (value: number) => {
    scope.set(variable, value);
    try {
      const result: unknown = compiled.evaluate(scope);
      return typeof result === "number" ? result : NaN;
    } catch {
      return NaN;
    }
  };
}

/** Trims the float noise a chain of operations leaves behind. */
export function present(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("This calculation has no finite real result.");
  return String(Number(value.toPrecision(12)));
}

/** A result as it goes on screen: a number, a list, or rows of a matrix. */
export function presentValue(value: Value): string[][] {
  if (typeof value === "number") return [[present(value)]];
  if (value.every((entry) => typeof entry === "number"))
    return [(value as number[]).map(present)];
  return (value as Matrix).map((row) => row.map(present));
}

/** Evaluates a typed expression. */
export function evaluate(
  expression: string,
  mode: AngleMode = "radians",
): Value {
  return plain(parseExpression(expression).compile().evaluate(build(mode)));
}

/** Evaluates to a single number, for the places that can only show one. */
export function calculate(
  expression: string,
  mode: AngleMode = "radians",
): string {
  const value = evaluate(expression, mode);
  if (typeof value !== "number")
    throw new Error("This calculation gives a list, not a single number.");
  return present(value);
}
