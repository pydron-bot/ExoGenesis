/**
 * A uniform grid of buckets for "what's near here" queries in the sim, so crowds don't
 * cost n² a tick (predators against each other, against every building; grazers against
 * every drone, unit and predator). Arrays are reused between ticks: `clear` then `add`.
 */
const OFF = 1024, SPAN = 2048;

export class Buckets<T> {
  private cells = new Map<number, T[]>();
  private used: T[][] = [];
  constructor(readonly size: number) {}

  private key(i: number, j: number) { return (i + OFF) * SPAN + (j + OFF); }

  clear() {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
  }

  /** Put `o` in every cell its box (x ± r, z ± r) touches (r = 0: one cell). */
  add(o: T, x: number, z: number, r = 0) {
    const s = this.size;
    const i0 = Math.floor((x - r) / s), i1 = Math.floor((x + r) / s);
    const j0 = Math.floor((z - r) / s), j1 = Math.floor((z + r) / s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let a = this.cells.get(k);
      if (!a) { a = []; this.cells.set(k, a); }
      if (!a.length) this.used.push(a);
      a.push(o);
    }
  }

  /**
   * Everything in the cells within `r` of (x, z), into `out` (cleared first). An object
   * added with a radius can come back more than once; `seen` (a Set the caller clears) dedupes.
   */
  near(x: number, z: number, r: number, out: T[], seen?: Set<T>) {
    out.length = 0;
    const s = this.size;
    const i0 = Math.floor((x - r) / s), i1 = Math.floor((x + r) / s);
    const j0 = Math.floor((z - r) / s), j1 = Math.floor((z + r) / s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.cells.get(this.key(i, j));
      if (!a) continue;
      for (const o of a) {
        if (seen) { if (seen.has(o)) continue; seen.add(o); }
        out.push(o);
      }
    }
    return out;
  }
}
