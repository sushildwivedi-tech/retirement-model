/**
 * Seeded randomness.
 *
 * Every Monte Carlo run in this app is reproducible: the same seed gives the same answer.
 * That matters for a planning tool - a success probability that jitters between reloads
 * invites the user to re-roll until they like the number.
 */

/** mulberry32: small, fast, good enough for Monte Carlo (not for cryptography). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function makeNormal(rng: () => number): () => number {
  let spare: number | null = null;
  return function normal() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

/**
 * Cholesky decomposition of a symmetric positive-definite matrix.
 *
 * Used to turn independent normals into correlated ones. Throws rather than silently
 * returning NaN if the matrix is not positive definite - a correlation matrix that
 * cannot be decomposed is a modelling error, not something to paper over.
 */
export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const d = matrix[i][i] - sum;
        if (d <= 0) {
          throw new Error(
            `cholesky: correlation matrix is not positive definite (pivot ${d} at index ${i}). ` +
              'Check the correlations - some combination is internally inconsistent.',
          );
        }
        L[i][j] = Math.sqrt(d);
      } else {
        L[i][j] = (matrix[i][i] === 0 ? 0 : matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/** Draw a vector of correlated standard normals given a Cholesky factor. */
export function correlatedNormals(L: number[][], normal: () => number): number[] {
  const n = L.length;
  const z = Array.from({ length: n }, normal);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
    out[i] = s;
  }
  return out;
}

/** Percentile of a sorted-in-place copy, using linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (idx - lo) * (s[hi] - s[lo]);
}
