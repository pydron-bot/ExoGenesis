/**
 * Terrain generators for the map editor (Generate): procedural shapes written
 * into a region's sculpt grid, over a selected area or the whole region, and an
 * automatic ground paint by height and slope.
 *
 * Everything works on the editor's node grids (one node every REGION_STEP u):
 * `gen` returns a height (u) per node in the area; the map editor adds it to,
 * or sets, the sculpting, feathered at the area's edge.
 */
import { fbm3, smoothstep } from '../world/noise';

export type GenKind = 'hills' | 'ridges' | 'craters' | 'mesas' | 'dunes' | 'basin' | 'plateau' | 'canyon';
export interface GenOpts {
  kind: GenKind;
  /** Height of the shapes (u). */
  height: number;
  /** Roughly how far apart they are (u). */
  size: number;
  seed: number;
  /** add: on top of what's there; replace: the area's sculpting becomes the shape; flatten: blend the sculpting toward 0 first. */
  mode: 'add' | 'replace';
  /** Blend in over this many units at the area's edge. */
  edge: number;
}

export const GENERATORS: { id: GenKind; label: string; tip: string }[] = [
  { id: 'hills', label: 'Rolling hills', tip: 'Soft noise: gentle rises and hollows.' },
  { id: 'ridges', label: 'Ridges', tip: 'Sharp-crested ridges with valleys between.' },
  { id: 'craters', label: 'Craters', tip: 'Impact craters with raised rims: moons, asteroids, airless worlds.' },
  { id: 'mesas', label: 'Mesas and terraces', tip: 'Flat-topped steps with steep sides.' },
  { id: 'dunes', label: 'Dunes', tip: 'Long wind-blown waves, slightly crooked.' },
  { id: 'basin', label: 'Basin', tip: 'One wide bowl, deepest in the middle of the area (negative height: a dome).' },
  { id: 'plateau', label: 'Plateau', tip: 'A raised flat table over the area with a cliff round it.' },
  { id: 'canyon', label: 'Canyon', tip: 'A winding gorge across the area (negative height: a winding ridge).' },
];

/** Cheap seeded random numbers. */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

/**
 * The shape's height at (x, z), for an area centred (cx, cz) with half-sizes
 * (hw, hh). Region coordinates; result in units.
 */
export function shapeAt(o: GenOpts, x: number, z: number, cx: number, cz: number, hw: number, hh: number, craters: { x: number; z: number; r: number }[]): number {
  const f = 1 / Math.max(2, o.size), s = o.seed;
  switch (o.kind) {
    case 'hills': return fbm3(x * f, s * 0.37, z * f, 4, s) * o.height * 1.6;
    case 'ridges': {
      const n = 1 - Math.abs(fbm3(x * f * 0.8, s * 0.37, z * f * 0.8, 4, s) * 1.6);
      return (n * n - 0.35) * o.height * 1.6;
    }
    case 'mesas': {
      const n = (fbm3(x * f, s * 0.37, z * f, 3, s) + 0.5) * 4;
      const step = Math.floor(n), t = n - step;
      return (step + smoothstep(0.82, 0.98, t)) * o.height * 0.4 - o.height * 0.8;
    }
    case 'dunes': {
      const w = fbm3(x * f * 0.4, s, z * f * 0.4, 2, s + 7) * 6;
      const along = (x * 0.8 + z * 0.6) * f * Math.PI * 2 + w;
      return (Math.sin(along) * 0.5 + 0.5) ** 1.6 * o.height - o.height * 0.35;
    }
    case 'basin': {
      const d = Math.hypot((x - cx) / Math.max(1, hw), (z - cz) / Math.max(1, hh));
      return -o.height * (1 - smoothstep(0, 1, d));
    }
    case 'plateau': {
      const d = Math.max(Math.abs(x - cx) / Math.max(1, hw), Math.abs(z - cz) / Math.max(1, hh));
      const wobble = fbm3(x * f, s, z * f, 3, s) * 0.12;
      return o.height * (1 - smoothstep(0.7, 0.82, d + wobble));
    }
    case 'canyon': {
      // a path wandering along the area's long axis
      const longX = hw >= hh;
      const a = longX ? x : z, b = longX ? z - cz : x - cx, half = longX ? hh : hw;
      const mid = fbm3(a * f * 0.5, s, 0.5, 3, s) * half * 1.2;
      const width = Math.max(4, o.size * 0.35);
      const d = Math.abs(b - mid) / width;
      return -o.height * (1 - smoothstep(0.35, 1, d));
    }
    case 'craters': {
      let h = 0;
      for (const c of craters) {
        const d = Math.hypot(x - c.x, z - c.z) / c.r;
        if (d > 1.6) continue;
        const depth = o.height * Math.min(1, c.r / o.size);
        // bowl inside, raised rim at the edge, fading out beyond it
        if (d < 1) h += -depth * (1 - d * d) + depth * 0.35 * smoothstep(0.7, 1, d);
        else h += depth * 0.35 * (1 - smoothstep(1, 1.6, d));
      }
      return h;
    }
  }
}

/** Crater centres and radii scattered over the area (fewer, bigger ones for a bigger feature size). */
export function scatterCraters(o: GenOpts, x0: number, z0: number, x1: number, z1: number) {
  const r = rng(o.seed);
  const area = (x1 - x0) * (z1 - z0);
  const n = Math.max(1, Math.min(60, Math.round(area / (o.size * o.size) * 1.4)));
  const out: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const big = r() ** 2.2;
    out.push({ x: x0 + r() * (x1 - x0), z: z0 + r() * (z1 - z0), r: o.size * (0.18 + big * 0.7) });
  }
  return out;
}

/**
 * Apply a generator to sculpt offsets `off` over nodes [i0..i1] × [j0..j1] of
 * an `nc`-wide grid. `nodeX`/`nodeZ` give a node's region coords; `fade` is the
 * region's sculpt fade (sculpting there is scaled down, so the shape is divided
 * by it to come out at full height). Returns the nodes changed.
 */
export function generate(
  o: GenOpts, off: Float32Array, nc: number, i0: number, j0: number, i1: number, j1: number,
  nodeX: (i: number) => number, nodeZ: (i: number) => number, max: number,
): number {
  const x0 = nodeX(j0 * nc + i0), z0 = nodeZ(j0 * nc + i0), x1 = nodeX(j1 * nc + i1), z1 = nodeZ(j1 * nc + i1);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hh = (z1 - z0) / 2;
  const craters = o.kind === 'craters' ? scatterCraters(o, x0, z0, x1, z1) : [];
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * nc + i, x = nodeX(k), z = nodeZ(k);
    const edgeD = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    const t = o.edge > 0 ? smoothstep(0, o.edge, edgeD) : 1;
    const v = shapeAt(o, x, z, cx, cz, hw, hh, craters);
    const want = o.mode === 'replace' ? v : off[k] + v;
    off[k] = Math.max(-max, Math.min(max, off[k] + (want - off[k]) * t));
    n++;
  }
  return n;
}

/**
 * Ground paint chosen by the land's shape: steep slopes rock, low ground sand,
 * high ground ice; `paint` gets paint × 100 + amount (planet.ts encodePaint).
 * `slots` says which paint (1-based) each of rock / sand / ice uses; 0 skips it.
 */
export function autoPaint(
  heights: Float32Array, nc: number, step: number, paint: Uint16Array,
  slots: { rock: number; sand: number; ice: number }, opts: { low: number; high: number; steep: number; strength: number },
  i0 = 0, j0 = 0, i1 = nc - 1, j1 = nc - 1,
) {
  const enc = (id: number, amt: number) => (id > 0 && amt > 0.004 ? id * 100 + Math.round(Math.min(1, amt) * 99) : 0);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * nc + i, h = heights[k];
    const hx = (heights[j * nc + Math.min(nc - 1, i + 1)] - heights[j * nc + Math.max(0, i - 1)]) / (2 * step);
    const hz = (heights[Math.min(nc - 1, j + 1) * nc + i] - heights[Math.max(0, j - 1) * nc + i]) / (2 * step);
    const slope = Math.hypot(hx, hz);
    const rock = smoothstep(opts.steep * 0.6, opts.steep, slope);
    const ice = smoothstep(opts.high, opts.high + 8, h);
    const sand = 1 - smoothstep(opts.low, opts.low + 4, h);
    const pick = [{ id: slots.rock, a: rock }, { id: slots.ice, a: ice }, { id: slots.sand, a: sand }].filter((p) => p.id > 0).sort((a, b) => b.a - a.a)[0];
    paint[k] = pick && pick.a > 0.05 ? enc(pick.id, pick.a * opts.strength) : 0;
  }
}
