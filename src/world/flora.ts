/**
 * Procedural alien flora for the landing region.
 *
 * A seed picks a handful of species. Each species comes from an archetype
 * (spire, parasol, fan, tube clump, bulb cluster, crystal) whose shape,
 * proportions and palette are randomised. Plants are scattered with a jittered
 * grid weighted by habitat (the same flora density field that tints the ground,
 * altitude, slope) and drawn as one InstancedMesh per variant.
 *
 * Everything is deterministic from (seed, region), so the sim can later
 * reproduce the same plants as a biomass resource. Shading: vertex colours
 * plus a per-vertex `aGlow` channel that lights up at night (bioluminescence),
 * and a vertex-shader wind sway weighted by height.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3, smoothstep } from './noise';
import { E, HALF, N, currentBody, floraPaintAt, regionDir, regionFlora, regionHeightRaw, regionToWorld } from './planet';

type Rng = () => number;

export function mulberry(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

// ---------- geometry builder ----------

/** Accumulates triangles with per-vertex colour and glow. */
export class Mesher {
  pos: number[] = [];
  col: number[] = [];
  glow: number[] = [];
  private v(p: THREE.Vector3, c: THREE.Color, g: number) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.glow.push(g);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, ga = 0, gb = 0, gc = 0) {
    this.v(a, ca, ga); this.v(b, cb, gb); this.v(c, cc, gc);
  }

  /**
   * Tube along a path. `rad(t)`, `color(t)` and `glow(t)` take t in 0..1 along
   * the path. Capped at the end with a point (or flat if `flatTop`).
   */
  tube(path: THREE.Vector3[], sides: number, rad: (t: number) => number, color: (t: number) => THREE.Color,
    glow: (t: number) => number = () => 0, flatTop = false) {
    const rings: THREE.Vector3[][] = [];
    const ts: number[] = [];
    let ref = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < path.length; i++) {
      const t = i / (path.length - 1);
      const tan = new THREE.Vector3().subVectors(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]).normalize();
      // parallel-transport-ish frame: keep ref perpendicular to the tangent
      const side = new THREE.Vector3().crossVectors(tan, ref);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      ref = new THREE.Vector3().crossVectors(side, tan).normalize();
      const r = rad(t);
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        ring.push(path[i].clone().addScaledVector(ref, Math.cos(a) * r).addScaledVector(side, Math.sin(a) * r));
      }
      rings.push(ring);
      ts.push(t);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const ca = color(ts[i]), cb = color(ts[i + 1]);
      const ga = glow(ts[i]), gb = glow(ts[i + 1]);
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const a = rings[i][k], b = rings[i][k2], c = rings[i + 1][k], d = rings[i + 1][k2];
        this.tri(a, b, d, ca, ca, cb, ga, ga, gb);
        this.tri(a, d, c, ca, cb, cb, ga, gb, gb);
      }
    }
    const last = rings[rings.length - 1];
    const tip = path[path.length - 1].clone();
    if (!flatTop) {
      const tan = new THREE.Vector3().subVectors(path[path.length - 1], path[path.length - 2]).normalize();
      tip.addScaledVector(tan, rad(1) * 1.5);
    }
    const ct = color(1), gt = glow(1);
    for (let k = 0; k < sides; k++) this.tri(last[k], last[(k + 1) % sides], tip, ct, ct, ct, gt, gt, gt);
  }

  /** Low-poly blob (icosahedron), squashed by `sy`. */
  blob(center: THREE.Vector3, r: number, sy: number, c: THREE.Color, g: number, detail = 0) {
    const ico = new THREE.IcosahedronGeometry(r, detail);
    const geo = ico.index ? ico.toNonIndexed() : ico;
    geo.scale(1, sy, 1);
    const p = geo.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i).add(center);
      b.fromBufferAttribute(p, i + 1).add(center);
      d.fromBufferAttribute(p, i + 2).add(center);
      this.tri(a, b, d, c, c, c, g, g, g);
    }
    geo.dispose();
  }

  /** Tapered strip (a leaf / frond) along a path, `width(t)` half-width, facing `normal`-ish. */
  blade(path: THREE.Vector3[], width: (t: number) => number, sideDir: THREE.Vector3, color: (t: number) => THREE.Color, glow: (t: number) => number) {
    for (let i = 0; i < path.length - 1; i++) {
      const t0 = i / (path.length - 1), t1 = (i + 1) / (path.length - 1);
      const a0 = path[i].clone().addScaledVector(sideDir, width(t0)), b0 = path[i].clone().addScaledVector(sideDir, -width(t0));
      const a1 = path[i + 1].clone().addScaledVector(sideDir, width(t1)), b1 = path[i + 1].clone().addScaledVector(sideDir, -width(t1));
      const c0 = color(t0), c1 = color(t1), g0 = glow(t0), g1 = glow(t1);
      // slight crease down the midline so flat shading catches light
      const m0 = path[i].clone().addScaledVector(new THREE.Vector3(0, 1, 0), width(t0) * 0.25);
      const m1 = path[i + 1].clone().addScaledVector(new THREE.Vector3(0, 1, 0), width(t1) * 0.25);
      this.tri(a0, m0, a1, c0, c0, c1, g0, g0, g1);
      this.tri(m0, m1, a1, c0, c1, c1, g0, g1, g1);
      this.tri(m0, b0, b1, c0, c0, c1, g0, g0, g1);
      this.tri(m0, b1, m1, c0, c1, c1, g0, g1, g1);
    }
  }

  build(smooth: boolean): THREE.BufferGeometry {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    if (smooth) {
      // crease-angle normals: average only faces within ~50° of each other, so a
      // parasol's cap top and its gills (sharing rim vertices) keep separate normals
      const p = this.pos;
      const nTri = p.length / 9;
      const fn = new Float32Array(nTri * 3);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let t = 0; t < nTri; t++) {
        a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
        b.sub(a); c.sub(a);
        const n = b.cross(c); // area-weighted
        fn[t * 3] = n.x; fn[t * 3 + 1] = n.y; fn[t * 3 + 2] = n.z;
      }
      const groups = new Map<string, number[]>();
      const key = (i: number) => `${p[i * 3].toFixed(3)},${p[i * 3 + 1].toFixed(3)},${p[i * 3 + 2].toFixed(3)}`;
      const nv = p.length / 3;
      for (let i = 0; i < nv; i++) {
        const k = key(i);
        const l = groups.get(k);
        if (l) l.push(i); else groups.set(k, [i]);
      }
      const nrm = new Float32Array(nv * 3);
      const own = new THREE.Vector3(), other = new THREE.Vector3(), acc = new THREE.Vector3();
      const COS = Math.cos((50 * Math.PI) / 180);
      for (const list of groups.values()) {
        for (const i of list) {
          const ti = Math.floor(i / 3);
          own.fromArray(fn, ti * 3).normalize();
          acc.set(0, 0, 0);
          for (const j of list) {
            other.fromArray(fn, Math.floor(j / 3) * 3);
            if (other.clone().normalize().dot(own) >= COS) acc.add(other);
          }
          if (acc.lengthSq() < 1e-12) acc.copy(own);
          acc.normalize();
          nrm[i * 3] = acc.x; nrm[i * 3 + 1] = acc.y; nrm[i * 3 + 2] = acc.z;
        }
      }
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    }
    // flat look derives normals per pixel, so it needs none; either way, indexing
    // lets the GPU share vertices between triangles (a third of the vertex work)
    g = mergeVertices(g, 1e-4);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- palette ----------

/** A biome's plant look: stem and glow colours (content/biomes). Home's when none is given. */
export interface FloraBiome {
  plants?: { plant: string; chance?: number; amount?: number }[];
  extra?: number;
  stems?: { color: string }[];
  glows?: { color: string }[];
  glow?: number; density?: number; size?: number; wind?: number;
}
const hsl = (h: number, s: number, l: number) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
/** Home's look, as it was before biomes (and the fallback when content has none). */
export const HOME_FLORA: FloraBiome = {
  plants: ['spire', 'parasol', 'fan', 'tubes', 'bulbs', 'crystal'].map((plant) => ({ plant })),
  extra: 2,
  stems: [0.75, 0.8, 0.47, 0.52, 0.9, 0.05, 0.62].map((h) => ({ color: hsl(h, 0.38, 0.19) })),
  glows: [0.5, 0.53, 0.83, 0.92, 0.3, 0.12].map((h) => ({ color: hsl(h, 0.85, 0.62) })),
};

interface Palette { base: THREE.Color; tip: THREE.Color; glow: THREE.Color }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export function palette(r: Rng, biome: FloraBiome = HOME_FLORA): Palette {
  const stems = biome.stems?.length ? biome.stems : HOME_FLORA.stems!;
  const glows = biome.glows?.length ? biome.glows : HOME_FLORA.glows!;
  const c = new THREE.Color(pick(r, stems).color).getHSL({ h: 0, s: 0, l: 0 });
  const h = c.h + range(r, -0.03, 0.03);
  const base = new THREE.Color().setHSL(h, clamp01(c.s * range(r, 0.7, 1.3)), clamp01(c.l * range(r, 0.75, 1.25)));
  const tip = new THREE.Color().setHSL(h + range(r, -0.08, 0.08), clamp01(c.s * 1.3 + 0.05), clamp01(c.l + range(r, 0.12, 0.28)));
  const g = new THREE.Color(pick(r, glows).color).getHSL({ h: 0, s: 0, l: 0 });
  const glow = new THREE.Color().setHSL(g.h + range(r, -0.02, 0.02), g.s, clamp01(g.l + range(r, -0.06, 0.06)));
  return { base, tip, glow };
}

const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

// ---------- archetypes ----------
// Sizes are in world units (~10 m); the core is ~17 tall, a grazer ~1.5.

type Habitat = { lush: number; bare: number; high: number };
export interface Archetype {
  name: string;
  /** Large plants use the coarse placement grid; small ones the fine grid. */
  big: boolean;
  habitat: Habitat;
  /** Grows on steep ground too. */
  cliff?: boolean;
  build: (r: Rng, pal: Palette, m: Mesher) => void;
}

export const ARCHETYPES: Archetype[] = [
  {
    name: 'spire', big: true, habitat: { lush: 1, bare: 0.08, high: 0 },
    build(r, pal, m) {
      // segmented, gently curving stalk with a glowing bulb and side nodules
      const H = range(r, 4.5, 7.5);
      const segs = 7;
      const bend = new THREE.Vector3(range(r, -1, 1), 0, range(r, -1, 1)).normalize().multiplyScalar(range(r, 0.4, 1.6));
      const path: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        path.push(new THREE.Vector3(bend.x * t * t, H * t, bend.z * t * t));
      }
      const r0 = range(r, 0.28, 0.45);
      const ribs = Math.round(range(r, 3, 6));
      m.tube(path, 5, (t) => r0 * (1 - t * 0.75) * (1 + 0.18 * Math.max(0, Math.sin(t * Math.PI * ribs * 2))),
        (t) => mix(pal.base, pal.tip, t), () => 0);
      const top = path[segs].clone();
      m.blob(top.add(new THREE.Vector3(0, range(r, 0.2, 0.5), 0)), range(r, 0.35, 0.6), range(r, 1, 1.6), pal.glow, 1, 1);
      const nod = Math.floor(range(r, 1, 4));
      for (let i = 0; i < nod; i++) {
        const t = range(r, 0.35, 0.8);
        const p = path[Math.round(t * segs)].clone();
        const a = r() * Math.PI * 2;
        p.x += Math.cos(a) * r0 * 0.7; p.z += Math.sin(a) * r0 * 0.7;
        m.blob(p, range(r, 0.12, 0.22), 1.3, pal.glow, 0.8);
      }
    },
  },
  {
    name: 'parasol', big: true, habitat: { lush: 0.8, bare: 0.04, high: 0 },
    build(r, pal, m) {
      // leaning trunk with one to three drooping canopy tiers; glowing gills underneath
      const H = range(r, 3.2, 5.5);
      const lean = new THREE.Vector3(range(r, -0.6, 0.6), 0, range(r, -0.6, 0.6));
      const path: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        path.push(new THREE.Vector3(lean.x * Math.sin(t * 1.6), H * t, lean.z * Math.sin(t * 1.6)));
      }
      const r0 = range(r, 0.22, 0.38);
      m.tube(path, 5, (t) => r0 * (1.3 - t * 0.6), (t) => mix(pal.base, pal.tip, t * 0.6), undefined, true);
      const tiers = Math.floor(range(r, 1, 3.99));
      const sides = Math.round(range(r, 6, 9));
      let cr = range(r, 1.6, 2.6);
      const capC = mix(pal.tip, pal.base, 0.25);
      for (let k = 0; k < tiers; k++) {
        const y = H - k * range(r, 0.9, 1.4);
        const c = new THREE.Vector3(path[5].x * (y / H), y, path[5].z * (y / H));
        const apex = c.clone().add(new THREE.Vector3(0, cr * range(r, 0.25, 0.45), 0));
        const droop = cr * range(r, 0.2, 0.45);
        const rim: THREE.Vector3[] = [];
        const under: THREE.Vector3[] = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          const rr = cr * (i % 2 ? 0.88 : 1);
          rim.push(c.clone().add(new THREE.Vector3(Math.cos(a) * rr, -droop, Math.sin(a) * rr)));
          under.push(c.clone().add(new THREE.Vector3(Math.cos(a) * rr * 0.25, -droop * 0.2, Math.sin(a) * rr * 0.25)));
        }
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          m.tri(apex, rim[j], rim[i], capC, capC, capC);
          // gills
          m.tri(under[i], rim[i], rim[j], pal.glow, pal.glow, pal.glow, 0.9, 0.5, 0.5);
          m.tri(under[i], rim[j], under[j], pal.glow, pal.glow, pal.glow, 0.9, 0.5, 0.9);
        }
        cr *= range(r, 0.6, 0.8);
      }
    },
  },
  {
    name: 'canopy', big: true, habitat: { lush: 1, bare: 0.05, high: 0 },
    build(r, pal, m) {
      // forked trunk, a clump of foliage on each branch, glowing fruit hanging under
      const H = range(r, 3.2, 5.5);
      const lean = new THREE.Vector3(range(r, -0.5, 0.5), 0, range(r, -0.5, 0.5));
      const trunk = [0, 0.5, 1].map((t) => new THREE.Vector3(lean.x * t * t, H * 0.6 * t, lean.z * t * t));
      const r0 = range(r, 0.25, 0.4);
      m.tube(trunk, 5, (t) => r0 * (1.35 - t * 0.5), (t) => mix(pal.base, pal.tip, t * 0.4), undefined, true);
      const fork = trunk[2];
      const n = Math.round(range(r, 2, 3.4));
      const leaf = mix(pal.tip, pal.base, range(r, 0, 0.35));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + range(r, -0.4, 0.4);
        const out = range(r, 0.9, 1.6);
        const end = fork.clone().add(new THREE.Vector3(Math.cos(a) * out, H * range(r, 0.3, 0.45), Math.sin(a) * out));
        m.tube([fork, fork.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.2, 0)), end], 4, (t) => r0 * 0.7 * (1 - t * 0.5), () => pal.base, undefined, true);
        const cr = range(r, 1.1, 1.8);
        m.blob(end.clone().add(new THREE.Vector3(0, cr * 0.25, 0)), cr, range(r, 0.55, 0.8), mix(leaf, pal.tip, r() * 0.3), 0);
        if (r() < 0.7) m.blob(end.clone().add(new THREE.Vector3(Math.cos(a) * cr * 0.5, -cr * 0.3, Math.sin(a) * cr * 0.5)), range(r, 0.12, 0.2), 1.4, pal.glow, 1);
      }
      m.blob(fork.clone().add(new THREE.Vector3(0, H * 0.45, 0)), range(r, 1.2, 1.7), range(r, 0.6, 0.8), leaf, 0);
    },
  },
  {
    name: 'tendril', big: true, habitat: { lush: 0.7, bare: 0.15, high: 0.05 },
    build(r, pal, m) {
      // two or three giant whips from one root, curling over at the top, tips glowing
      const n = Math.round(range(r, 1.6, 3.4));
      for (let i = 0; i < n; i++) {
        const H = range(r, 3.5, 7) * (i === 0 ? 1 : 0.7);
        const a = r() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const curl = range(r, 1.4, 3.2);
        const path: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const ang = t * t * curl; // straight low down, curling at the top
          path.push(dir.clone().multiplyScalar(i * 0.25 + Math.sin(ang) * H * 0.35).add(new THREE.Vector3(0, H * (0.15 + 0.85 * Math.sin(Math.min(Math.PI / 2, t * 1.7))) - (ang > 1.6 ? (ang - 1.6) * H * 0.12 : 0), 0)));
        }
        path[0].y = -0.2;
        const r0 = range(r, 0.2, 0.32);
        m.tube(path, 5, (t) => r0 * (1 - t * 0.85), (t) => mix(pal.base, pal.tip, t), (t) => smoothstep(0.8, 1, t), false);
      }
    },
  },
  {
    name: 'fan', big: false, habitat: { lush: 1, bare: 0.35, high: 0.05 },
    build(r, pal, m) {
      // rosette of curved, tapering fronds
      const n = Math.round(range(r, 5, 8));
      const L = range(r, 1.0, 2.2);
      const curl = range(r, 0.3, 1.2);
      const w = range(r, 0.12, 0.28);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + range(r, -0.2, 0.2);
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const up = range(r, 0.9, 1.6);
        const len = L * range(r, 0.75, 1.15);
        const path: THREE.Vector3[] = [];
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          path.push(dir.clone().multiplyScalar(len * t * 0.8).add(new THREE.Vector3(0, len * (up * t - curl * t * t * 0.9), 0)));
        }
        m.blade(path, (t) => w * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * len, side,
          (t) => mix(pal.base, pal.tip, t), (t) => smoothstep(0.75, 1, t) * 0.7);
      }
    },
  },
  {
    name: 'tubes', big: false, habitat: { lush: 0.7, bare: 0.25, high: 0.1 },
    build(r, pal, m) {
      // clump of upright tubes with glowing mouths
      const n = Math.round(range(r, 3, 7));
      const hMax = range(r, 1.0, 2.4);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = i === 0 ? 0 : range(r, 0.2, 0.6);
        const base = new THREE.Vector3(Math.cos(a) * d, -0.1, Math.sin(a) * d);
        const h = hMax * range(r, 0.4, 1);
        const tilt = new THREE.Vector3(Math.cos(a) * d * 0.35, 0, Math.sin(a) * d * 0.35);
        const path = [0, 0.5, 1].map((t) => base.clone().addScaledVector(tilt, t * t).add(new THREE.Vector3(0, h * t, 0)));
        const rad = range(r, 0.13, 0.28);
        m.tube(path, 5, (t) => rad * (1 + 0.25 * t), (t) => mix(pal.base, pal.tip, t), (t) => (t > 0.98 ? 1 : 0), true);
      }
    },
  },
  {
    name: 'bulbs', big: false, habitat: { lush: 0.6, bare: 0.5, high: 0.15 },
    build(r, pal, m) {
      // spore pods on short stalks
      const n = Math.round(range(r, 3, 5));
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = range(r, 0, 0.55);
        const h = range(r, 0.15, 0.7);
        const p = new THREE.Vector3(Math.cos(a) * d, h, Math.sin(a) * d);
        m.tube([new THREE.Vector3(p.x * 0.6, -0.1, p.z * 0.6), p], 4, () => 0.05, () => pal.base, undefined, true);
        m.blob(p, range(r, 0.16, 0.4), range(r, 0.8, 1.3), mix(pal.glow, pal.tip, range(r, 0, 0.5)), range(r, 0.4, 0.9));
      }
    },
  },
  {
    name: 'crystal', big: false, cliff: true, habitat: { lush: 0, bare: 0.12, high: 1 },
    build(r, pal, m) {
      // lithophyte: leaning hexagonal prisms with pointed, glowing tips
      const n = Math.round(range(r, 3, 7));
      const pale = mix(pal.tip, new THREE.Color('#d8e4ff'), 0.45);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const lean = i === 0 ? range(r, 0, 0.15) : range(r, 0.2, 0.7);
        const h = range(r, 0.8, 2.6) * (i === 0 ? 1.2 : 1);
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
        const base = new THREE.Vector3(Math.cos(a) * 0.2, -0.2, Math.sin(a) * 0.2);
        const path = [base, base.clone().addScaledVector(dir, h)];
        const rad = range(r, 0.16, 0.32);
        m.tube(path, 6, () => rad, (t) => mix(pal.base, pale, t), (t) => t * 0.7);
      }
    },
  },
  {
    name: 'reeds', big: false, habitat: { lush: 1, bare: 0.3, high: 0 },
    build(r, pal, m) {
      // a tuft of tall thin blades, leaning out, tips catching the glow
      const n = Math.round(range(r, 6, 11));
      const L = range(r, 1.2, 2.6);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const len = L * range(r, 0.6, 1.1), bend = range(r, 0.1, 0.5);
        const base = dir.clone().multiplyScalar(range(r, 0, 0.25));
        const path = [0, 0.5, 1].map((t) => base.clone().addScaledVector(dir, len * bend * t * t).add(new THREE.Vector3(0, len * t, 0)));
        path[0].y = -0.1;
        m.blade(path, (t) => 0.07 * (1 - t * 0.8), side, (t) => mix(pal.base, pal.tip, t), (t) => (t > 0.9 ? 0.6 : 0));
      }
    },
  },
  {
    name: 'cap', big: false, habitat: { lush: 0.7, bare: 0.4, high: 0.1 },
    build(r, pal, m) {
      // a cluster of mushroom caps on stalks, gills glowing underneath
      const n = Math.round(range(r, 2, 5));
      const capC = mix(pal.tip, pal.base, 0.2);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = i === 0 ? 0 : range(r, 0.3, 0.8);
        const h = range(r, 0.4, 1.4) * (i === 0 ? 1.2 : 1);
        const base = new THREE.Vector3(Math.cos(a) * d, -0.1, Math.sin(a) * d);
        const top = base.clone().add(new THREE.Vector3(Math.cos(a) * d * 0.2, h, Math.sin(a) * d * 0.2));
        m.tube([base, top], 4, () => range(r, 0.06, 0.1) * (1 + h * 0.3), () => pal.base, undefined, true);
        const cr = range(r, 0.3, 0.6) * (0.7 + h * 0.4), sides = 6;
        const apex = top.clone().add(new THREE.Vector3(0, cr * range(r, 0.3, 0.7), 0));
        const rim: THREE.Vector3[] = [];
        for (let k = 0; k < sides; k++) {
          const b = (k / sides) * Math.PI * 2;
          rim.push(top.clone().add(new THREE.Vector3(Math.cos(b) * cr, -cr * 0.15, Math.sin(b) * cr)));
        }
        for (let k = 0; k < sides; k++) {
          const j = (k + 1) % sides;
          m.tri(apex, rim[j], rim[k], capC, capC, capC);
          m.tri(top, rim[k], rim[j], pal.glow, pal.glow, pal.glow, 0.9, 0.5, 0.5);
        }
      }
    },
  },
  {
    name: 'barrel', big: false, habitat: { lush: 0.15, bare: 1, high: 0.1 },
    build(r, pal, m) {
      // ribbed succulent, maybe with arms; glowing flowers on top
      const H = range(r, 0.9, 2.4), R0 = range(r, 0.3, 0.55);
      const ribs = 7;
      const path = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(0, -0.15 + H * t, 0));
      const body = (t: number) => R0 * (0.85 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 1.1)));
      m.tube(path, ribs, body, (t) => mix(pal.base, pal.tip, t * 0.7), undefined, false);
      const arms = H > 1.5 ? Math.floor(range(r, 0, 2.99)) : 0;
      for (let i = 0; i < arms; i++) {
        const a = r() * Math.PI * 2, y = H * range(r, 0.35, 0.6);
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const p0 = new THREE.Vector3(0, y, 0).addScaledVector(out, R0 * 0.6);
        const p1 = p0.clone().addScaledVector(out, R0 * 1.3);
        const p2 = p1.clone().add(new THREE.Vector3(0, H * range(r, 0.3, 0.5), 0));
        m.tube([p0, p1, p2], 5, () => R0 * 0.45, (t) => mix(pal.base, pal.tip, t), undefined, false);
      }
      const fl = Math.floor(range(r, 1, 3.99));
      for (let i = 0; i < fl; i++) {
        const a = r() * Math.PI * 2;
        m.blob(new THREE.Vector3(Math.cos(a) * R0 * 0.4, H + R0 * 0.2, Math.sin(a) * R0 * 0.4), range(r, 0.1, 0.18), 0.7, pal.glow, 1);
      }
    },
  },
  {
    name: 'thorn', big: false, habitat: { lush: 0.2, bare: 1, high: 0.2 },
    build(r, pal, m) {
      // dry spiky scrub: thin forking twigs, a glint at each tip
      const n = Math.round(range(r, 4, 7));
      const L = range(r, 0.8, 1.8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + range(r, -0.3, 0.3);
        const up = range(r, 0.5, 1.2);
        const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
        const len = L * range(r, 0.6, 1.1);
        const p0 = new THREE.Vector3(0, -0.1, 0), p1 = dir.clone().multiplyScalar(len * 0.5), p2 = dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, len * 0.15, 0));
        m.tube([p0, p1, p2], 3, (t) => 0.06 * (1 - t * 0.7), (t) => mix(pal.base, pal.tip, t), (t) => (t > 0.95 ? 0.5 : 0), false);
        const b = a + range(r, 0.5, 1) * (r() < 0.5 ? -1 : 1);
        const twig = p1.clone().add(new THREE.Vector3(Math.cos(b) * len * 0.4, len * 0.35, Math.sin(b) * len * 0.4));
        m.tube([p1, twig], 3, () => 0.035, (t) => mix(pal.base, pal.tip, 0.5 + t * 0.5), (t) => (t > 0.95 ? 0.5 : 0), false);
      }
    },
  },
  {
    name: 'lichen', big: false, cliff: true, habitat: { lush: 0.1, bare: 0.6, high: 1 },
    build(r, pal, m) {
      // flat crusts hugging the ground, a few glowing spots
      const n = Math.round(range(r, 3, 6));
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = i === 0 ? 0 : range(r, 0.3, 0.9);
        const rad = range(r, 0.3, 0.75);
        m.blob(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), rad, range(r, 0.12, 0.22), mix(pal.base, pal.tip, r()), 0);
        if (r() < 0.5) m.blob(new THREE.Vector3(Math.cos(a) * d, rad * 0.15, Math.sin(a) * d), rad * 0.3, 0.4, pal.glow, 0.8);
      }
    },
  },
];

// ---------- shader patch (sway + glow) ----------

export const floraUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uGlow: { value: 0.2 },
};

export function floraMaterial(flat: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: flat, roughness: 0.78, metalness: 0, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floraUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGlow;
        varying float vGlow;
        uniform float uTime;
        uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = dot(ip, vec3(0.071, 0.053, 0.037));
        float hh = max(0.0, transformed.y);
        float sw = sin(uTime * 1.25 + ph) + 0.45 * sin(uTime * 2.7 + ph * 1.7);
        transformed.x += sw * uWind * hh * hh * 0.011;
        transformed.z += cos(uTime * 1.05 + ph * 1.3) * uWind * hh * hh * 0.007;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGlow;
        varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * vGlow * uGlow;`);
  };
  mat.customProgramCacheKey = () => 'flora-v1';
  return mat;
}

// ---------- species + scatter ----------

interface Variant {
  arch: Archetype;
  species: number;
  mesh: THREE.InstancedMesh;
  /** region x, z per instance, for clearing */
  xz: Float32Array;
  hidden: Uint8Array;
  /** full-size instance matrices / colours; the mesh holds only the visible, compacted set */
  base: Float32Array;
  colors: Float32Array;
  /** world-space bounding sphere per instance (x, y, z, r) */
  sphere: Float32Array;
  /** full density within this camera distance; thinned beyond */
  full: number;
  /** per-instance distance at which it drops out (full / sqrt(rand)) */
  cut: Float32Array;
}

/**
 * Distance thinning: inside FULL_* every plant draws; beyond, each plant has its
 * own random cut-off so density falls off as (full / d)^2 — about constant
 * plants per screen area — with no visible line. Plants shrink out over the last
 * fifth of their range instead of popping.
 */
const FULL_SMALL = 140;
const FULL_BIG = 520;

export interface FloraOptions { seed: number; flat: boolean; density?: number; biome?: FloraBiome }

const KEEP_OUT = 32; // landing pad + where the lander's petals fold down

export class Flora {
  readonly group = new THREE.Group();
  readonly variants: Variant[] = [];
  readonly speciesNames: string[] = [];
  count = 0;
  /** The biome's glow and wind strength. */
  private glowK = 1;
  private windK = 1;

  constructor(opts: FloraOptions) {
    this.group.name = 'flora';
    const r = mulberry(opts.seed * 7919 + 17);
    const mat = floraMaterial(opts.flat);
    const biome = opts.biome ?? HOME_FLORA;
    const density = (opts.density ?? 1) * (biome.density ?? 1);
    const sizeK = biome.size ?? 1;
    this.glowK = biome.glow ?? 1;
    this.windK = biome.wind ?? 1;

    // species: each of the biome's forms that this region rolls, plus a few look-alikes
    const byName = new Map(ARCHETYPES.map((a) => [a.name, a]));
    const rows = (biome.plants ?? []).filter((p) => byName.has(p.plant));
    const grown = rows.filter((p) => r() < (p.chance ?? 1));
    if (!grown.length && rows.length) grown.push(rows[0]);
    const repeatable = grown.filter((p) => !byName.get(p.plant)!.cliff);
    const extra = Math.min(biome.extra ?? 1, 12 - grown.length);
    for (let i = 0; i < extra && repeatable.length; i++) grown.push(pick(r, repeatable));
    const species = grown.map((row, si) => {
      const arch = byName.get(row.plant)!;
      const pal = palette(r, biome);
      const habitat = { ...arch.habitat };
      // shift each species' niche a little so repeats don't overlap exactly
      const nicheSeed = Math.floor(r() * 1e6);
      const geos = [0, 1].map((v) => {
        const m = new Mesher();
        arch.build(mulberry(opts.seed * 131 + si * 977 + v * 31), pal, m);
        return m.build(!opts.flat);
      });
      this.speciesNames.push(arch.name);
      return { arch, habitat, nicheSeed, geos, si, amount: row.amount ?? 1 };
    });
    // the same ground cover however many species share it (Home's mix was 3 big, 5 small)
    const share = (big: boolean) => {
      const n = species.filter((sp) => sp.arch.big === big).length;
      return n ? Math.min(2, Math.max(0.6, (big ? 3 : 5) / n)) : 0;
    };
    const shareBig = share(true), shareSmall = share(false);

    // collect placements first so each InstancedMesh is sized exactly
    const placed: { x: number; z: number; s: number; v: number; h: number; tilt: number; sy: number; tint: number }[][] =
      species.map(() => []);
    const pass = (cell: number, big: boolean, base: number) => {
      const n = Math.floor((HALF * 2) / cell);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -HALF + (i + r()) * cell, z = -HALF + (j + r()) * cell;
        if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) continue;
        const rc = Math.hypot(x, z);
        if (rc < KEEP_OUT) continue;
        const h = regionHeightRaw(x, z);
        if (h < 2.5) continue;
        const slope = Math.hypot(regionHeightRaw(x + 1, z) - regionHeightRaw(x - 1, z), regionHeightRaw(x, z + 1) - regionHeightRaw(x, z - 1)) / 2;
        const fl = regionFlora(x, z);
        const lush = smoothstep(0, 0.18, fl) * (1 - smoothstep(28, 37, h));
        const high = smoothstep(32, 38, h);
        const bare = Math.max(0, 1 - lush - high);
        const near = smoothstep(KEEP_OUT, KEEP_OUT + 18, rc);
        // weight each species by its niche; clumping noise per species
        let total = 0;
        const w = species.map((sp) => {
          if (sp.arch.big !== big) return 0;
          if (!sp.arch.cliff && slope > 0.85) return 0;
          const hab = sp.habitat.lush * lush + sp.habitat.bare * bare + sp.habitat.high * high;
          const clump = smoothstep(-0.35, 0.35, fbm3(x * 0.05, sp.nicheSeed % 97, z * 0.05, 2, sp.nicheSeed));
          const v = hab * clump * sp.amount;
          total += v;
          return v;
        });
        const fp = floraPaintAt(x, z);
        const paint = Math.min(2, Math.max(0, 1 + fp));
        // a barren body (plant life −1) grows nothing, except where flora is painted on
        const life = Math.min(1, smoothstep(-0.9, -0.3, currentBody().plants) + Math.max(0, fp));
        const p = Math.min(0.95, total * (big ? shareBig : shareSmall) * base * density * near * paint * life);
        if (r() > p) continue;
        let k = r() * total, si = 0;
        for (; si < w.length - 1; si++) { k -= w[si]; if (k <= 0) break; }
        if (w[si] === 0) continue;
        placed[si].push({
          x, z, h,
          s: range(r, 0.7, 1.3) * (big ? 1 : range(r, 0.8, 1.2)) * sizeK,
          v: r() < 0.5 ? 0 : 1,
          tilt: range(r, 0, 0.12),
          sy: range(r, 0.85, 1.2),
          tint: range(r, -1, 1),
        });
      }
    };
    pass(4.2, true, 0.6);
    pass(2.4, false, 0.34);

    // build meshes
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4();
    const tilt = new THREE.Quaternion(), tint = new THREE.Color();
    species.forEach((sp, si) => {
      for (const v of [0, 1]) {
        const list = placed[si].filter((p) => p.v === v);
        if (!list.length) continue;
        const mesh = new THREE.InstancedMesh(sp.geos[v], mat, list.length);
        mesh.name = `flora-${sp.arch.name}-${si}-${v}`;
        const xz = new Float32Array(list.length * 2);
        list.forEach((p, i) => {
          regionToWorld(p.x, p.z, sp.arch.big ? -0.35 : -0.12, pos);
          regionDir(p.x, p.z, up);
          const yaw = (p.tint + 1) * Math.PI * 7.3;
          fwd.copy(E).multiplyScalar(Math.sin(yaw)).addScaledVector(N, Math.cos(yaw));
          fwd.addScaledVector(up, -fwd.dot(up)).normalize();
          right.crossVectors(up, fwd);
          q.setFromRotationMatrix(basis.makeBasis(right, up, fwd));
          tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.tilt);
          q.multiply(tilt);
          sc.set(p.s, p.s * p.sy, p.s);
          m4.compose(pos, q, sc);
          mesh.setMatrixAt(i, m4);
          const l = 1 + p.tint * 0.12;
          mesh.setColorAt(i, tint.setRGB(l, l * (1 + p.tint * 0.04), l * (1 - p.tint * 0.04)));
          xz[i * 2] = p.x; xz[i * 2 + 1] = p.z;
        });
        const geoR = sp.geos[v].boundingSphere!;
        const sphere = new Float32Array(list.length * 4);
        const ctr = new THREE.Vector3();
        list.forEach((p, i) => {
          mesh.getMatrixAt(i, m4);
          ctr.copy(geoR.center).applyMatrix4(m4);
          sphere.set([ctr.x, ctr.y, ctr.z, geoR.radius * p.s * Math.max(1, p.sy)], i * 4);
        });
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; // culled per instance in update()
        this.group.add(mesh);
        this.variants.push({
          arch: sp.arch, species: si, mesh, xz, hidden: new Uint8Array(list.length),
          base: (mesh.instanceMatrix.array as Float32Array).slice(),
          colors: (mesh.instanceColor!.array as Float32Array).slice(),
          sphere, full: sp.arch.big ? FULL_BIG : FULL_SMALL,
          cut: Float32Array.from(list, () => (sp.arch.big ? FULL_BIG : FULL_SMALL) / Math.sqrt(Math.max(1e-4, r()))),
        });
        this.count += list.length;
      }
    });
  }

  /** Remove plants within `r` of a region point (building footprint). Returns how many were cleared. */
  clear(x: number, z: number, r: number): number {
    let n = 0;
    for (const v of this.variants) {
      for (let i = 0; i < v.hidden.length; i++) {
        if (v.hidden[i]) continue;
        if (Math.hypot(v.xz[i * 2] - x, v.xz[i * 2 + 1] - z) < r) { v.hidden[i] = 1; n++; }
      }
    }
    if (n) this.dirty = true;
    return n;
  }

  private dirty = true;
  private lastCam = new THREE.Vector3(Infinity, 0, 0);
  private lastQuat = new THREE.Quaternion();
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sph = new THREE.Sphere();
  /** Instances drawn last cull (for the debug hook). */
  visible = 0;

  /**
   * `night` 0..1 drives bioluminescence. When the camera has moved, re-cull:
   * drop instances outside the view or too far to matter (small plants shrink
   * out over the last quarter of their range), and pack the rest to the front.
   */
  update(t: number, night: number, camera: THREE.Camera) {
    floraUniforms.uTime.value = t;
    floraUniforms.uGlow.value = (0.18 + night * 1.6) * this.glowK;
    floraUniforms.uWind.value = this.windK;
    if (!this.group.visible) return;
    const cp = camera.position;
    const moved = cp.distanceToSquared(this.lastCam) > 0.04 || 1 - Math.abs(camera.quaternion.dot(this.lastQuat)) > 1e-6;
    if (!moved && !this.dirty) return;
    this.lastCam.copy(cp);
    this.lastQuat.copy(camera.quaternion);
    this.dirty = false;
    camera.updateMatrixWorld();
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    let total = 0;
    for (const v of this.variants) {
      const out = v.mesh.instanceMatrix.array as Float32Array;
      const oc = v.mesh.instanceColor!.array as Float32Array;
      let n = 0;
      for (let i = 0; i < v.hidden.length; i++) {
        if (v.hidden[i]) continue;
        const sx = v.sphere[i * 4], sy = v.sphere[i * 4 + 1], sz = v.sphere[i * 4 + 2];
        const d = Math.sqrt((sx - cp.x) ** 2 + (sy - cp.y) ** 2 + (sz - cp.z) ** 2);
        const cut = v.cut[i];
        if (d > cut) continue;
        this.sph.center.set(sx, sy, sz);
        this.sph.radius = v.sphere[i * 4 + 3];
        if (!this.frustum.intersectsSphere(this.sph)) continue;
        const k = d > cut * 0.8 ? (cut - d) / (cut * 0.2) : 1;
        const src = i * 16, dst = n * 16;
        for (let c = 0; c < 12; c++) out[dst + c] = v.base[src + c] * (c % 4 === 3 ? 1 : k);
        out[dst + 12] = v.base[src + 12]; out[dst + 13] = v.base[src + 13]; out[dst + 14] = v.base[src + 14]; out[dst + 15] = 1;
        oc[n * 3] = v.colors[i * 3]; oc[n * 3 + 1] = v.colors[i * 3 + 1]; oc[n * 3 + 2] = v.colors[i * 3 + 2];
        n++;
      }
      v.mesh.count = n;
      v.mesh.visible = n > 0;
      v.mesh.instanceMatrix.needsUpdate = true;
      v.mesh.instanceColor!.needsUpdate = true;
      total += n;
    }
    this.visible = total;
  }
}
