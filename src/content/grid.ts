/**
 * Integer grids stored as text: one string per row, values separated by spaces,
 * runs written as "value*count" (a flat row is just "0*121"). Keeps region files
 * small and their git diffs line-per-row.
 */

export function decodeGrid(rows: readonly string[] | undefined, cols: number, nRows: number): Int16Array {
  const out = new Int16Array(cols * nRows);
  if (!rows) return out;
  for (let r = 0; r < nRows && r < rows.length; r++) {
    let c = 0;
    for (const tok of rows[r].split(' ')) {
      const star = tok.indexOf('*');
      const v = Number(star < 0 ? tok : tok.slice(0, star));
      const n = star < 0 ? 1 : Number(tok.slice(star + 1));
      for (let k = 0; k < n && c < cols; k++) out[r * cols + c++] = v;
    }
  }
  return out;
}

export function encodeGrid(g: ArrayLike<number>, cols: number, nRows: number): string[] {
  const rows: string[] = [];
  for (let r = 0; r < nRows; r++) {
    const toks: string[] = [];
    let c = 0;
    while (c < cols) {
      const v = Math.round(g[r * cols + c]);
      let n = 1;
      while (c + n < cols && Math.round(g[r * cols + c + n]) === v) n++;
      toks.push(n >= 3 ? `${v}*${n}` : Array(n).fill(String(v)).join(' '));
      c += n;
    }
    rows.push(toks.join(' '));
  }
  return rows;
}

export const isEmptyGrid = (g: ArrayLike<number>) => {
  for (let i = 0; i < g.length; i++) if (Math.round(g[i]) !== 0) return false;
  return true;
};
