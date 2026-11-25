/**
 * Small dense matrices: enough for the determinants, inverses and systems a
 * precalculus course asks for, and nothing larger than a calculator screen.
 */

export type Matrix = number[][];

export const MAX_SIZE = 6;

export function dimensions(m: Matrix): [number, number] {
  const rows = m.length;
  if (!rows) throw new Error("A matrix needs at least one row.");
  const columns = m[0].length;
  if (!columns) throw new Error("A matrix needs at least one column.");
  if (m.some((row) => row.length !== columns))
    throw new Error("Every row must have the same number of entries.");
  return [rows, columns];
}

function square(m: Matrix): number {
  const [rows, columns] = dimensions(m);
  if (rows !== columns)
    throw new Error("This needs a square matrix — the same number of rows and columns.");
  return rows;
}

const copy = (m: Matrix): Matrix => m.map((row) => [...row]);

/** Gaussian elimination with partial pivoting; the sign follows the swaps. */
export function determinant(m: Matrix): number {
  const n = square(m);
  const a = copy(m);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return 0;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      det = -det;
    }
    det *= a[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  // Determinants of whole-number matrices are whole numbers; clear the noise.
  const rounded = Math.round(det);
  return Math.abs(det - rounded) < 1e-9 * Math.max(1, Math.abs(det))
    ? rounded
    : det;
}

/** The reduced row echelon form, with the rows scaled to a leading 1. */
export function rref(m: Matrix): Matrix {
  const [rows, columns] = dimensions(m);
  const a = copy(m);
  let pivotRow = 0;
  for (let col = 0; col < columns && pivotRow < rows; col++) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[best][col])) best = row;
    if (Math.abs(a[best][col]) < 1e-12) continue;
    [a[pivotRow], a[best]] = [a[best], a[pivotRow]];
    const lead = a[pivotRow][col];
    for (let k = 0; k < columns; k++) a[pivotRow][k] /= lead;
    for (let row = 0; row < rows; row++) {
      if (row === pivotRow) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let k = 0; k < columns; k++) a[row][k] -= factor * a[pivotRow][k];
    }
    pivotRow++;
  }
  return a.map((row) => row.map((value) => (Object.is(value, -0) ? 0 : value)));
}

/** The inverse, by reducing [A | I]. */
export function inverse(m: Matrix): Matrix {
  const n = square(m);
  if (Math.abs(determinant(m)) < 1e-12)
    throw new Error("This matrix is singular, so it has no inverse.");
  const augmented = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  return rref(augmented).map((row) => row.slice(n));
}

export function transpose(m: Matrix): Matrix {
  const [rows, columns] = dimensions(m);
  return Array.from({ length: columns }, (_, j) =>
    Array.from({ length: rows }, (_, i) => m[i][j]),
  );
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const [rowsA, columnsA] = dimensions(a);
  const [rowsB, columnsB] = dimensions(b);
  if (columnsA !== rowsB)
    throw new Error(
      `A ${rowsA}×${columnsA} matrix cannot multiply a ${rowsB}×${columnsB} one.`,
    );
  return Array.from({ length: rowsA }, (_, i) =>
    Array.from({ length: columnsB }, (_, j) => {
      let sum = 0;
      for (let k = 0; k < columnsA; k++) sum += a[i][k] * b[k][j];
      return sum;
    }),
  );
}

export function add(a: Matrix, b: Matrix, sign = 1): Matrix {
  const [rowsA, columnsA] = dimensions(a);
  const [rowsB, columnsB] = dimensions(b);
  if (rowsA !== rowsB || columnsA !== columnsB)
    throw new Error("Both matrices must be the same size.");
  return a.map((row, i) => row.map((value, j) => value + sign * b[i][j]));
}

export function scale(m: Matrix, k: number): Matrix {
  dimensions(m);
  return m.map((row) => row.map((value) => value * k));
}

/** The rank, read off the reduced form. */
export function rank(m: Matrix): number {
  return rref(m).filter((row) => row.some((value) => Math.abs(value) > 1e-12))
    .length;
}
