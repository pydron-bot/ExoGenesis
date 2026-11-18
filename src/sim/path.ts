/**
 * Pathfinding: A* over a 2 u grid of the region, then string-pulled into a few
 * waypoints. What blocks depends on how the mover gets about (`Move`): ground
 * movers can't enter water, water movers can't leave open water (deeper than
 * `SHALLOW`), hover movers go anywhere; building bodies block all of them
 * (`setBodies`; a grid that never gets bodies is terrain-only, as fauna use).
 *
 * The blocked grid is rebuilt only when the set of buildings changes. Distances
 * are Float64: Float32 rounding re-expands equal-cost nodes and blows up the heap
 * (learned in the skirmish flow fields).
 */
import { regionHeightRaw } from '../world/planet';

export const CELL = 2;
/** Ground below this is water to the sim. */
export const WET = 0.3;
/** Water movers need ground below this (open water, not the beach). */
export const SHALLOW = -0.6;

/** How a unit gets about: ground (land only), hover (land and water) or water (open water only). */
export type Move = 'ground' | 'hover' | 'water';
/** Whether a mover of type `m` can't be at ground height `h`. */
export const offLimits = (m: Move, h: number) => (m === 'ground' ? h < WET : m === 'water' ? h >= SHALLOW : false);
/** A unit record's movement type (ground when unset). */
export const moveOf = (u: { move?: Move }): Move => u.move ?? 'ground';

interface Body { x: number; z: number; r: number }

export class PathGrid {
  readonly n: number;
  private water: Uint8Array;
  private blocked: Uint8Array;
  private key = '';
  /** Connected open areas (terrain only, built on first use; -1 blocked): see `reaches`. */
  private comp: Int32Array | null = null;
  private g: Float64Array;
  private f: Float64Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private stamp = 0;
  private heap: Int32Array;

  /** `height`: raw ground height at region coords (the editor passes its live terrain). */
  constructor(private limit: number, readonly move: Move = 'ground', height: (x: number, z: number) => number = regionHeightRaw) {
    this.n = Math.floor((limit * 2) / CELL);
    const nn = this.n * this.n;
    this.water = new Uint8Array(nn);
    this.blocked = new Uint8Array(nn);
    if (move !== 'hover') for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const { x, z } = this.centre(i, j);
      this.water[j * this.n + i] = offLimits(move, height(x, z)) ? 1 : 0;
    }
    this.blocked.set(this.water);
    this.g = new Float64Array(nn);
    this.f = new Float64Array(nn);
    this.from = new Int32Array(nn);
    this.seen = new Uint32Array(nn);
    this.closed = new Uint32Array(nn);
    this.heap = new Int32Array(nn * 2);
  }

  centre(i: number, j: number) { return { x: -this.limit + (i + 0.5) * CELL, z: -this.limit + (j + 0.5) * CELL }; }
  cellOf(x: number, z: number) {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((x + this.limit) / CELL)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((z + this.limit) / CELL)));
    return { i, j };
  }

  /** Mark building bodies (grown by `pad`, the largest unit radius) as blocked. */
  setBodies(bodies: Body[], pad: number) {
    const key = bodies.map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)},${b.r}`).join(';');
    if (key === this.key) return;
    this.key = key;
    this.blocked.set(this.water);
    for (const b of bodies) {
      const r = b.r + pad;
      const lo = this.cellOf(b.x - r, b.z - r), hi = this.cellOf(b.x + r, b.z + r);
      for (let j = lo.j; j <= hi.j; j++) for (let i = lo.i; i <= hi.i; i++) {
        const c = this.centre(i, j);
        if (Math.hypot(c.x - b.x, c.z - b.z) < r) this.blocked[j * this.n + i] = 1;
      }
    }
  }

  isBlocked(x: number, z: number) {
    const { i, j } = this.cellOf(x, z);
    return this.blocked[j * this.n + i] === 1;
  }

  /** Straight line between two points crosses no blocked cell. */
  clear(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (this.isBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** The centre of the nearest open cell to (x, z) within `reach` u, or null. */
  openNear(x: number, z: number, reach = 24) {
    const c = this.nearestOpen(x, z, Math.ceil(reach / CELL));
    return c < 0 ? null : this.centre(c % this.n, (c / this.n) | 0);
  }

  /**
   * Whether a mover at (ax, az) can get within `slack` u of (bx, bz) over the terrain (buildings
   * aside): its open area and one round the target touch. Samples rings round the target.
   */
  reaches(ax: number, az: number, bx: number, bz: number, slack: number) {
    const comp = this.components();
    const a = this.nearestOpen(ax, az, 4);
    if (a < 0) return true; // stranded somewhere odd: don't second-guess it
    const want = comp[a];
    const at = (x: number, z: number) => { const { i, j } = this.cellOf(x, z); return comp[j * this.n + i] === want; };
    if (at(bx, bz)) return true;
    for (const k of [0.35, 0.7, 1]) {
      const r = slack * k, m = Math.max(8, Math.ceil((r * 6.3) / CELL));
      for (let q = 0; q < m; q++) {
        const t = (q / m) * Math.PI * 2;
        if (at(bx + Math.cos(t) * r, bz + Math.sin(t) * r)) return true;
      }
    }
    return false;
  }

  private components() {
    if (this.comp) return this.comp;
    const n = this.n, comp = new Int32Array(n * n).fill(-1), stack: number[] = [];
    let id = 0;
    for (let c0 = 0; c0 < n * n; c0++) {
      if (this.water[c0] || comp[c0] >= 0) continue;
      comp[c0] = id; stack.push(c0);
      while (stack.length) {
        const c = stack.pop()!, ci = c % n, cj = (c / n) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const i = ci + dx, j = cj + dz;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const nc = j * n + i;
          if (this.water[nc] || comp[nc] >= 0) continue;
          if (dx && dz && (this.water[cj * n + i] || this.water[j * n + ci])) continue;
          comp[nc] = id; stack.push(nc);
        }
      }
      id++;
    }
    return (this.comp = comp);
  }

  /** Nearest open cell to a point (spiral search), or -1. */
  private nearestOpen(x: number, z: number, rings = 12) {
    const c = this.cellOf(x, z), n = this.n;
    for (let r = 0; r < rings; r++) {
      let best = -1, bd = Infinity;
      for (let j = c.j - r; j <= c.j + r; j++) for (let i = c.i - r; i <= c.i + r; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || (Math.abs(i - c.i) !== r && Math.abs(j - c.j) !== r)) continue;
        if (this.blocked[j * n + i]) continue;
        const p = this.centre(i, j), d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = j * n + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * Waypoints (flat [x0, z0, x1, z1, ...], ending at the goal or the nearest
   * reachable point to it) from (ax, az), or null if there's no way at all.
   */
  find(ax: number, az: number, bx: number, bz: number): number[] | null {
    if (this.clear(ax, az, bx, bz) && !this.isBlocked(bx, bz)) return [bx, bz];
    const n = this.n;
    const start = this.nearestOpen(ax, az), goal = this.nearestOpen(bx, bz);
    if (start < 0 || goal < 0) return null;
    const gi = goal % n, gj = (goal / n) | 0;
    const stamp = ++this.stamp;
    const { g, f, from, seen, closed, heap } = this;
    const h = (c: number) => {
      const dx = Math.abs((c % n) - gi), dz = Math.abs(((c / n) | 0) - gj);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * CELL;
    };
    let size = 0;
    const push = (c: number) => {
      let k = size++;
      heap[k] = c;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
      return top;
    };
    g[start] = 0; f[start] = h(start); from[start] = -1; seen[start] = stamp;
    push(start);
    let best = start, bestH = h(start), found = false;
    while (size > 0 && size < heap.length - 8) {
      const c = pop();
      if (closed[c] === stamp) continue;
      closed[c] = stamp;
      if (c === goal) { found = true; break; }
      const hc = h(c);
      if (hc < bestH) { bestH = hc; best = c; }
      const ci = c % n, cj = (c / n) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const i = ci + dx, j = cj + dz;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const nc = j * n + i;
        if (this.blocked[nc] || closed[nc] === stamp) continue;
        // no cutting corners past a blocked cell
        if (dx && dz && (this.blocked[cj * n + i] || this.blocked[j * n + ci])) continue;
        const ng = g[c] + (dx && dz ? Math.SQRT2 : 1) * CELL;
        if (seen[nc] === stamp && ng >= g[nc]) continue;
        seen[nc] = stamp; g[nc] = ng; f[nc] = ng + h(nc); from[nc] = c;
        push(nc);
      }
    }
    const end = found ? goal : best;
    const cells: number[] = [];
    for (let c = end; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const pts: { x: number; z: number }[] = cells.map((c) => this.centre(c % n, (c / n) | 0));
    if (found && !this.isBlocked(bx, bz)) pts[pts.length - 1] = { x: bx, z: bz };
    // string-pull: from each kept point, jump to the farthest one in plain sight
    const out: number[] = [];
    let at = { x: ax, z: az };
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.clear(at.x, at.z, pts[m].x, pts[m].z)) { far = m; break; }
      at = pts[far];
      out.push(at.x, at.z);
      k = far + 1;
    }
    return out;
  }
}
