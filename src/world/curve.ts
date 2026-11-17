/** Curves shared by the game and the editor (no content or three.js imports). */

/**
 * Monotone cubic (Fritsch–Carlson) through (X, Y): smooth through every key,
 * never overshooting between them. Clamped outside the keys.
 */
export function pchip(X: number[], Y: number[], x: number): number {
  const n = X.length;
  if (n === 1 || x <= X[0]) return Y[0];
  if (x >= X[n - 1]) return Y[n - 1];
  let i = 0;
  while (x > X[i + 1]) i++;
  const d = (k: number) => (X[k + 1] > X[k] ? (Y[k + 1] - Y[k]) / (X[k + 1] - X[k]) : 0);
  const m = (k: number) => {
    if (k === 0) return d(0);
    if (k === n - 1) return d(n - 2);
    const a = d(k - 1), b = d(k);
    if (a * b <= 0) return 0;
    const w1 = 2 * (X[k + 1] - X[k]) + (X[k] - X[k - 1]), w2 = (X[k + 1] - X[k]) + 2 * (X[k] - X[k - 1]);
    return (w1 + w2) / (w1 / a + w2 / b);
  };
  const h = X[i + 1] - X[i];
  if (h <= 0) return Y[i + 1];
  const s = (x - X[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * Y[i] + (s3 - 2 * s2 + s) * h * m(i) + (-2 * s3 + 3 * s2) * Y[i + 1] + (s3 - s2) * h * m(i + 1);
}
