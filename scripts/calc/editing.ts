import { BY_NAME, type Entry } from "./catalog";

/**
 * What the editor needs to know about where the caret is: the name being
 * typed, and the call it is inside. Both are worked out from text, so they
 * can be tested without a browser.
 */

/** The half-typed name the caret is sitting in, if any. */
export function wordAt(
  text: string,
  caret: number,
): { word: string; from: number } {
  let from = caret;
  while (from > 0 && /[a-z0-9]/i.test(text[from - 1])) from--;
  return { word: text.slice(from, caret), from };
}

/**
 * The call the caret is inside, and which of its arguments is being typed.
 * Walks back keeping a bracket depth, so a nested call reports the inner
 * one — the one being written.
 */
export function callAt(
  text: string,
  caret: number,
): { entry: Entry; argument: number } | null {
  let depth = 0;
  let commas = 0;
  for (let i = caret - 1; i >= 0; i--) {
    const character = text[i];
    if (character === ")" || character === "]") {
      depth++;
    } else if (character === "," && depth === 0) {
      commas++;
    } else if (character === "[") {
      if (depth > 0) depth--;
      // An unclosed bracket means the caret is inside a list, so the commas
      // counted so far separate its values, not the call's arguments.
      else commas = 0;
    } else if (character === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const { word } = wordAt(text, i);
      const entry = BY_NAME.get(word.toLowerCase());
      return entry ? { entry, argument: commas } : null;
    }
  }
  return null;
}

/**
 * The same question, asked of MathLive.
 *
 * MathLive hands back everything before the caret, but a group the caret is
 * *inside* comes back without its brackets — "normalcdf(1.96," reads as
 * "normalcdf1.96,". That missing bracket is the tell: the innermost name not
 * followed by one is the call being written. Reading the LaTeX rather than
 * the ASCII keeps the function names whole, since MathLive writes a name it
 * knows as \operatorname{…} and spells every other one letter by letter.
 */
export function readLatex(prefix: string): string {
  return (
    prefix
      // A name, however MathLive chose to wrap it. The space keeps two names
      // apart when the bracket between them has been dropped.
      .replace(/\\operatorname\{\\mathrm\{([a-z0-9]+)\}\}/gi, " $1")
      .replace(/\\operatorname\{([a-z0-9]+)\}/gi, " $1")
      .replace(/\\mathrm\{([a-z0-9]+)\}/gi, " $1")
      .replace(/\\placeholder\{\}/g, "")
      .replace(/\\left\s*/g, "")
      .replace(/\\right\s*/g, "")
      .replace(/\\lbrack/g, "[")
      .replace(/\\rbrack/g, "]")
      .replace(/\\pi/g, "pi")
      .replace(/\\infty/g, "inf")
      // Anything else with a backslash is a name too: \sin, \frac, \times.
      .replace(/\\([a-z]+)/gi, " $1")
      // A fraction's braces group like brackets as far as the caret cares.
      .replace(/\{/g, "(")
      .replace(/\}/g, ")")
  );
}

export function callInLatex(
  prefix: string,
): { entry: Entry; argument: number } | null {
  const text = readLatex(prefix);
  let depth = 0;
  let commas = 0;
  let i = text.length - 1;
  while (i >= 0) {
    const character = text[i];
    if (character === ")" || character === "]") {
      depth++;
      i--;
      continue;
    }
    if (character === "(" || character === "[") {
      if (depth > 0) depth--;
      i--;
      continue;
    }
    if (depth > 0 || !/[a-z0-9]/i.test(character)) {
      if (depth === 0 && character === ",") commas++;
      i--;
      continue;
    }
    // A name can run straight into its first argument, as normalcdf1.96
    // does, so the longest name this run begins with is the name.
    let from = i;
    while (from > 0 && /[a-z0-9]/i.test(text[from - 1])) from--;
    const run = text.slice(from, i + 1).toLowerCase();
    for (let length = run.length; length > 0; length--) {
      const entry = BY_NAME.get(run.slice(0, length));
      if (!entry) continue;
      const after = text[from + length] ?? "";
      // A name followed by its own bracket is a call that is already
      // finished; the one missing its bracket is the one the caret is in.
      if (after !== "(" && after !== "[") return { entry, argument: commas };
      break;
    }
    i = from - 1;
  }
  return null;
}

/** The name being typed, read from MathLive's spaced-out ASCII. */
export function wordInAscii(prefix: string): string {
  const text = prefix.replace(/\s+/g, "");
  return wordAt(text, text.length).word;
}
