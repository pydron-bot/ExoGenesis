/**
 * The body being played (a planet, moon, asteroid or comet: content/bodies) and
 * the mapping between region coordinates (x, z on a flat sim grid) and the
 * curved world. That body sits at the world origin — the floating origin for
 * everything that needs precision — and the rest of the system is placed
 * relative to it.
 *
 * Which body, its radius and terrain, and the region's size are set by
 * `setRegionTerrain` before anything samples the terrain (every thread calls it
 * with the same `RegionTerrain`). `R` and `HALF` are live bindings: read them
 * where they're used rather than copying them into module-level constants.
 */
import * as THREE from 'three';
import { DEFAULT_REGION_SIZE, REGION_HALF, setRegionHalf } from '../sim/types';
import { HEIGHT_SCALE, REGION_STEP, regionCells } from '../content/defs';
import { decodeGrid } from '../content/grid';
import { fbm3, lerp, smoothstep } from './noise';
import { sunPosUniform } from './body-surface';

/** The body's radius (Home: 3,000 u). */
export let R = 3000;
/** Half-width of the region being played. */
export let HALF = REGION_HALF;
/** Home's radius: distances tuned on Home (camera views, the globe's look) scale by R / HOME_RADIUS. */
export const HOME_RADIUS = 3000;

/** Region frame: U = up at the landing site, E/N = tangent axes (sim x/z). */
export const U = new THREE.Vector3(0.55, 0.5, 0.67).normalize();
export const E = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), U).normalize();
export const N = new THREE.Vector3().crossVectors(U, E).normalize();

const _d = new THREE.Vector3();

// ---------- the body ----------
/**
 * What the terrain needs from a body record (content/bodies/<id>.json, resolved
 * by `regionTerrain`). Home's numbers are the defaults, so a region with no body
 * plays exactly as before.
 */
export interface BodyTerrain {
  id: string;
  name: string;
  radius: number;
  /** Height of the generated relief (Home 90 u). */
  relief: number;
  /** Feature size: noise frequency over the body (Home 2.1; higher = smaller, busier features). */
  feature: number;
  seed: number;
  /** Seas below height 0 (Home). Without, the lowest ground is dry, flat basin floor. */
  ocean: boolean;
  /** Plant life: added to the flora field (−1 = barren, 0 = Home). */
  plants: number;
  /** Ground colours, low to high. */
  ground: string[];
  deep: string; shallow: string; shore: string;
  floraA: string; floraB: string;
  /** Snow / frost colour, and the height it starts at (0 = none). */
  snow: string; snowLine: number;
}
export const HOME_BODY: BodyTerrain = {
  id: 'home', name: 'Home', radius: 3000, relief: 90, feature: 2.1, seed: 7, ocean: true, plants: 0,
  ground: ['#7c4a33', '#a8744d'], deep: '#0f2a3a', shallow: '#1f5a6a', shore: '#b59b74',
  floraA: '#563a78', floraB: '#2d6e68', snow: '#ddd3c4', snowLine: 34,
};
let body: BodyTerrain = HOME_BODY;
/** Visual ground height under the sea (terrain patch, globe): sunk below the water, shallower than the sim's, capped. */
export const seabed = (h: number) => (h >= 0 ? h : Math.max(h * 0.6, -7));
/** The body being played has seas (water at sea level, see water.ts). */
export const bodyHasSea = () => body.ocean;
/** The body's sea colours (its record's deep and shallow). */
export const bodySea = () => ({ deep: body.deep, shallow: body.shallow });
/** The body being played. */
export const currentBody = () => body;
type ColorFn = (h: number, flora: number, out: THREE.Color) => THREE.Color;
let colorFn: ColorFn;
function setBody(b: BodyTerrain) {
  body = b;
  R = b.radius;
  colorFn = terrainColorFor(b);
}

/**
 * Body terrain from a body record (content/bodies), filling in Home's values
 * for anything it leaves out. Plain data, so it can go to the workers.
 */
export function bodyTerrain(id: string, b: Partial<Record<string, unknown>> | undefined): BodyTerrain {
  if (!b) return { ...HOME_BODY, id };
  const pick = <T,>(k: keyof BodyTerrain, d: T): T => (b[k] !== undefined && b[k] !== null ? (b[k] as T) : d);
  const ground = Array.isArray(b.ground) ? (b.ground as { color?: string }[]).map((g) => g?.color).filter((c): c is string => typeof c === 'string') : [];
  return {
    id,
    name: pick('name', id),
    radius: pick('radius', HOME_BODY.radius),
    relief: pick('relief', HOME_BODY.relief),
    feature: pick('feature', HOME_BODY.feature),
    seed: pick('seed', HOME_BODY.seed),
    ocean: pick('ocean', false),
    plants: pick('plants', -1),
    ground: ground.length ? ground : HOME_BODY.ground,
    deep: pick('deep', HOME_BODY.deep), shallow: pick('shallow', HOME_BODY.shallow), shore: pick('shore', HOME_BODY.shore),
    floraA: pick('floraA', HOME_BODY.floraA), floraB: pick('floraB', HOME_BODY.floraB),
    snow: pick('snow', HOME_BODY.snow), snowLine: pick('snowLine', 0),
  };
}

export function regionDir(x: number, z: number, out = new THREE.Vector3()) {
  return out.copy(U).multiplyScalar(R).addScaledVector(E, x).addScaledVector(N, z).normalize();
}

/**
 * Where on the planet the loaded region sits. The region frame (U/E/N) never
 * moves, so camera, sun and sky stay as they are; the planet's generated ground
 * turns under it instead. Touchdown is the origin (no turn).
 */
const siteQ = new THREE.Quaternion();
let siteTurned = false;
const _sd = new THREE.Vector3();
/** Planet-body direction for world direction `d` (identity at Touchdown). */
const bodyDir = (d: THREE.Vector3) => (siteTurned ? _sd.copy(d).applyQuaternion(siteQ) : d);
/** Point the region at `lat` degrees north and `lon` degrees east of Touchdown. */
export function setRegionSite(lat = 0, lon = 0) {
  siteTurned = lat !== 0 || lon !== 0;
  siteQ.setFromUnitVectors(U, siteDir(lat, lon));
  coreH = null;
}
/** Planet-body direction of a site `lat` degrees north and `lon` east of Touchdown. */
export function siteDir(lat: number, lon: number, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return out.copy(U).multiplyScalar(Math.cos(la) * Math.cos(lo)).addScaledVector(E, Math.cos(la) * Math.sin(lo)).addScaledVector(N, Math.sin(la)).normalize();
}
let siteName = 'TOUCHDOWN';
/** The loaded region's name (the globe labels its province with it). */
export const regionName = () => siteName;

/**
 * The body's generated height at body direction `b`, before the lift under the
 * region being played. A body without seas sits its relief above height 0 (the
 * lowest basins are clamped flat by `dry`), so nothing reads as water.
 */
export const bodyHeight = (b: THREE.Vector3, w: BodyTerrain = body) => {
  const f = w.feature;
  const n = fbm3(b.x * f + 3.1, b.y * f, b.z * f - 1.7, 6, w.seed) * w.relief;
  return w.ocean ? n : n + w.relief * 0.6;
};
/** Ground on a body without seas never dips to sea level (the sim treats below 0.3 as water). */
const DRY_FLOOR = 0.6;
const dry = (h: number) => (body.ocean ? h : Math.max(DRY_FLOOR, h));
/**
 * The region being played sits on dry land: ground within ~15° of its centre is
 * lifted (`ang` in radians). Only bodies with seas need it, and a region that
 * keeps its sea (region field `keepSea`) skips it: see `setRegionTerrain`.
 */
export const siteLift = (ang: number, w: BodyTerrain = body) => (w.ocean ? (1 - smoothstep(0.04, 0.26, ang)) * 40 : 0);
export const bodyFlora = (b: THREE.Vector3, w: BodyTerrain = body) => fbm3(b.x * 14 + 11, b.y * 14, b.z * 14, 3, 33) + w.plants;

/** False while the region being played keeps the body's seas (no lift round it). */
let lifted = true;
export function globeHeight(d: THREE.Vector3): number {
  // keep the landing site (and the tutorial regions around it) on dry land, unless the region keeps its sea
  return dry(bodyHeight(bodyDir(d)) + (lifted ? siteLift(Math.acos(Math.min(1, d.dot(U)))) : 0));
}

export function floraAt(d: THREE.Vector3): number {
  return bodyFlora(bodyDir(d));
}

/**
 * The region's own generated detail on top of the body's terrain (content
 * region fields `detail`, `detailSize`, `detailSeed`; Home's Touchdown values
 * are the defaults). Plain data, so it can go to the workers.
 */
export interface RegionDetail { amp: number; freq: number; seed: number }
const DEFAULT_DETAIL: RegionDetail = { amp: 10, freq: 0.045, seed: 21 };
let detail: RegionDetail = DEFAULT_DETAIL;

/** Generated terrain before any hand sculpting. */
export function regionProcBase(x: number, z: number): number {
  const h = globeHeight(regionDir(x, z, _d));
  const edge = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
  return h + fbm3(x * detail.freq, 1.3, z * detail.freq, 3, detail.seed) * detail.amp * smoothstep(0, 26, edge);
}

// ---------- hand-authored layers (content/regions/<id>.json) ----------
/** Sculpted height offset (units) and flora paint (-1..1), REGION_CELLS² samples, row-major [z][x]. */
let hOff: Float32Array | null = null;
let fPaint: Float32Array | null = null;
/** Ground paint per grid node: which paint (0 = none) and how much (0..1). */
let gId: Uint8Array | null = null;
let gAmt: Float32Array | null = null;
let paints: THREE.Color[] = [];
let coreH: number | null = null;
/** Grid nodes per side of the region being played (121 for 240 u). */
let NC = regionCells(HALF);

/** The ground paints a region has when it lists none (map editor: Paint ground). */
export const DEFAULT_PAINTS: { name: string; color: string }[] = [
  { name: 'Bare rock', color: '#6b625a' },
  { name: 'Pale sand', color: '#c8a77a' },
  { name: 'Dark soil', color: '#4a3528' },
  { name: 'Moss', color: '#3d6b4f' },
  { name: 'Ash', color: '#3a3836' },
  { name: 'Ice', color: '#dfe8ee' },
  { name: 'Rust', color: '#8f4a2c' },
  { name: 'Violet bloom', color: '#6a3f8a' },
];
/** Ground paint grid values: paint number × 100 + amount (0..99 → 0..1); 0 = none. */
export const GROUND_PAINT_MAX = DEFAULT_PAINTS.length * 100 + 99;
export const decodePaint = (v: number) => ({ id: Math.floor(v / 100), amt: v >= 100 ? (v % 100) / 99 : 0 });
export const encodePaint = (id: number, amt: number) => (id > 0 && amt > 0.004 ? id * 100 + Math.round(Math.min(1, amt) * 99) : 0);

/**
 * What the terrain needs from a region record and its body (workers get just
 * this). Build it with `regionTerrain(def, bodies)`.
 */
export interface RegionTerrain {
  name?: string; height?: string[]; flora?: string[]; ground?: string[]; siteLat?: number; siteLon?: number;
  /** Side length (u); 240 when absent. */
  size?: number;
  /** The body it's on, resolved (Home when absent). */
  world?: BodyTerrain;
  paints?: string[];
  detail?: RegionDetail;
  /** Leave the body's seas where they are: no dry-land lift round the region. */
  keepSea?: boolean;
}
interface RegionLike {
  name?: string; height?: string[]; flora?: string[]; ground?: string[]; siteLat?: number; siteLon?: number; size?: number; body?: string;
  paints?: { color?: string }[]; detail?: number; detailSize?: number; detailSeed?: number; keepSea?: boolean;
}
/**
 * The terrain part of a region record, with its body looked up in `bodies`
 * (content.bodies). Without `bodies`, or with no body set, it's on Home.
 */
export function regionTerrain(r: RegionLike, bodies?: Record<string, unknown>): RegionTerrain {
  const id = r.body || 'home';
  const b = bodies?.[id] as Record<string, unknown> | undefined;
  return {
    name: r.name, height: r.height, flora: r.flora, ground: r.ground, siteLat: r.siteLat, siteLon: r.siteLon,
    size: r.size,
    world: b ? bodyTerrain(id, b) : id === 'home' ? HOME_BODY : undefined,
    paints: r.paints?.map((p) => p?.color ?? '#808080'),
    detail: {
      amp: r.detail ?? DEFAULT_DETAIL.amp,
      freq: r.detailSize ? 0.45 / r.detailSize : DEFAULT_DETAIL.freq,
      seed: r.detailSeed ?? DEFAULT_DETAIL.seed,
    },
    keepSea: r.keepSea || undefined,
  };
}
/** A region's side length, 240 u unless it says. */
export const regionSize = (r: { size?: number }) => r.size ?? DEFAULT_REGION_SIZE;

/**
 * Load a region: its body, size, place on the body, generated detail and painted
 * layers. Call before anything samples the terrain (or sizes a grid from it).
 */
export function setRegionTerrain(t: RegionTerrain) {
  setBody(t.world ?? HOME_BODY);
  setRegionSize(t.size ?? DEFAULT_REGION_SIZE);
  detail = t.detail ?? DEFAULT_DETAIL;
  lifted = !t.keepSea;
  setRegionSite(t.siteLat, t.siteLon);
  if (t.name) siteName = t.name.toUpperCase();
  const n = NC;
  setRegionLayers(
    t.height ? Float32Array.from(decodeGrid(t.height, n, n), (v) => v * HEIGHT_SCALE) : null,
    t.flora ? Float32Array.from(decodeGrid(t.flora, n, n), (v) => v / 100) : null,
  );
  setGroundPaint(t.ground ? decodeGrid(t.ground, n, n) : null, t.paints);
}

/** The region's side length (u). Sets the sim's REGION_HALF too. */
export function setRegionSize(size: number) {
  HALF = size / 2;
  setRegionHalf(HALF);
  NC = regionCells(HALF);
  coreH = null;
}

/** Editor: share live arrays with the terrain functions. */
export function setRegionLayers(height: Float32Array | null, flora: Float32Array | null) {
  hOff = height;
  fPaint = flora;
  coreH = null;
}

/** Ground paint: grid values (see `decodePaint`) and the region's paint colours (DEFAULT_PAINTS when none). */
export function setGroundPaint(grid: ArrayLike<number> | null, colors?: string[]) {
  paints = (colors?.length ? colors : DEFAULT_PAINTS.map((p) => p.color)).map((c) => new THREE.Color(c));
  if (!grid) { gId = null; gAmt = null; return; }
  gId = new Uint8Array(grid.length);
  gAmt = new Float32Array(grid.length);
  let any = false;
  for (let i = 0; i < grid.length; i++) {
    const p = decodePaint(grid[i]);
    if (p.id > 0 && p.id <= paints.length && p.amt > 0) { gId[i] = p.id; gAmt[i] = p.amt; any = true; }
  }
  if (!any) { gId = null; gAmt = null; }
}

/** Bilinear sample of a region grid at region coords. */
export function sampleLayer(g: Float32Array, x: number, z: number): number {
  const n = NC;
  const fx = Math.min(n - 1.0001, Math.max(0, (x + HALF) / REGION_STEP));
  const fz = Math.min(n - 1.0001, Math.max(0, (z + HALF) / REGION_STEP));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Sculpting fades out over the last few units so the patch still meets the globe. */
export const SCULPT_FADE = 14;
export const sculptFade = (x: number, z: number) => smoothstep(0, SCULPT_FADE, Math.min(HALF - Math.abs(x), HALF - Math.abs(z)));
/** 0 on the flat landing pad, 1 outside it. */
export const PAD_INNER = 13, PAD_OUTER = 28;
export const padBlend = (x: number, z: number) => smoothstep(PAD_INNER, PAD_OUTER, Math.hypot(x, z));
/** Pad height from the pre-pad terrain at the origin. */
export const padHeight = (base0: number) => Math.max(1.5, base0);

function regionBase(x: number, z: number): number {
  return regionProcBase(x, z) + (hOff ? sampleLayer(hOff, x, z) * sculptFade(x, z) : 0);
}

function regionHeightRawWet(x: number, z: number): number {
  coreH ??= padHeight(regionBase(0, 0));
  return lerp(coreH, regionBase(x, z), padBlend(x, z));
}
/** Raw (may be below sea level) height for region coords; flattened pad around the core. */
export function regionHeightRaw(x: number, z: number): number {
  return regionHeightDry(x, z);
}

/** Raw height including the dry floor of bodies without seas (what everything samples). */
const regionHeightDry = (x: number, z: number) => dry(regionHeightRawWet(x, z));
/** Painted flora, -1 (cleared) .. 1 (doubled). */
export const floraPaintAt = (x: number, z: number) => (fPaint ? sampleLayer(fPaint, x, z) : 0);
/** How far painting shifts the flora field (lushness / ground tint). */
export const FLORA_PAINT_SHIFT = 0.3;
const _fd = new THREE.Vector3();
/** Flora field inside the region, including paint. */
export const regionFlora = (x: number, z: number) => floraAt(regionDir(x, z, _fd)) + floraPaintAt(x, z) * FLORA_PAINT_SHIFT;

/**
 * Building pads (visual only — the sim keeps reading the raw terrain): the
 * ground under each building is levelled to `h` within `r`, blending back to the
 * terrain over PAD_FALL. Set by the region view from the building list.
 */
export interface GroundPad { x: number; z: number; r: number; h: number }
export const PAD_FALL = 3;
let groundPads: GroundPad[] = [];
export function setGroundPads(p: GroundPad[]) { groundPads = p; }

export const regionHeight = (x: number, z: number) => padded(x, z, Math.max(0, regionHeightRaw(x, z)));
/** `h` with the building pads levelled in (the terrain patch passes the seabed, so a quay can reach out over it). */
export function padded(x: number, z: number, h: number) {
  for (const p of groundPads) {
    const dx = x - p.x, dz = z - p.z, reach = p.r + PAD_FALL;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    const d = Math.hypot(dx, dz);
    if (d < reach) h = lerp(h, p.h, 1 - smoothstep(p.r, reach, d));
  }
  return h;
}

/** World position of region coords, `lift` units above the ground. */
export function regionToWorld(x: number, z: number, lift: number, out = new THREE.Vector3()) {
  return regionDir(x, z, out).multiplyScalar(R + regionHeight(x, z) + lift);
}

/** Inverse of regionDir: world point → region coords (unclamped). */
export function worldToRegion(p: THREE.Vector3): { x: number; z: number } {
  _d.copy(p).normalize();
  const cu = _d.dot(U);
  return { x: (R * _d.dot(E)) / cu, z: (R * _d.dot(N)) / cu };
}

/**
 * Ground colour for a height and flora value on a body: seas and shore (bodies
 * with seas), the body's ground colours from low to high, plants, then snow
 * above its snow line. Home's is the game's original palette.
 */
export function terrainColorFor(w: BodyTerrain): ColorFn {
  const C = {
    deep: new THREE.Color(w.deep), shallow: new THREE.Color(w.shallow), shore: new THREE.Color(w.shore),
    floraA: new THREE.Color(w.floraA), floraB: new THREE.Color(w.floraB), high: new THREE.Color(w.snow),
  };
  const g = (w.ground.length ? w.ground : HOME_BODY.ground).map((c) => new THREE.Color(c));
  if (g.length === 1) g.push(g[0].clone());
  const _c = new THREE.Color();
  return (h, flora, out) => {
  if (w.ocean) {
    if (h <= 0) return out.copy(C.deep).lerp(C.shallow, smoothstep(-30, 0, h));
    if (h < 2.5) return out.copy(C.shore);
  }
  // Home: 3..30 u; a dry body spans its relief
  const lo = w.ocean ? 3 : w.relief * 0.25, hi = w.ocean ? 30 : w.relief * 0.95;
  const t = smoothstep(lo, hi, h) * (g.length - 1);
  const k = Math.min(g.length - 2, Math.floor(t));
  out.copy(g[k]).lerp(g[k + 1], t - k);
  const snow = w.snowLine > 0 ? w.snowLine : Infinity;
  const f = smoothstep(0.02, 0.2, flora) * (1 - smoothstep(snow - 8, snow + 2, h));
  if (f > 0) out.lerp(_c.copy(C.floraA).lerp(C.floraB, smoothstep(-0.2, 0.3, fbm3(flora * 7, 2, 3, 1, 5))), f * 0.85);
  return w.snowLine > 0 ? out.lerp(C.high, smoothstep(snow, snow + 12, h)) : out;
  };
}
setBody(HOME_BODY);
/** Ground colour on the body being played (see `terrainColorFor`). */
export const terrainColor: ColorFn = (h, flora, out) => colorFn(h, flora, out);

const _p = new THREE.Color();
/** Blend the region's ground paint at (x, z) into `out` (bilinear over the paint grid's nodes). */
export function applyGroundPaint(x: number, z: number, out: THREE.Color) {
  if (!gId || !gAmt) return out;
  const n = NC;
  const fx = Math.min(n - 1.0001, Math.max(0, (x + HALF) / REGION_STEP));
  const fz = Math.min(n - 1.0001, Math.max(0, (z + HALF) / REGION_STEP));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  let wsum = 0, r = 0, gg = 0, b = 0;
  const node = (k: number, w: number) => {
    const id = gId![k];
    if (!id || w <= 0) return;
    const a = gAmt![k] * w, c = paints[id - 1];
    if (!c) return;
    wsum += a; r += c.r * a; gg += c.g * a; b += c.b * a;
  };
  node(j * n + i, (1 - tx) * (1 - tz)); node(j * n + i + 1, tx * (1 - tz));
  node((j + 1) * n + i, (1 - tx) * tz); node((j + 1) * n + i + 1, tx * tz);
  if (wsum <= 0) return out;
  _p.setRGB(r / wsum, gg / wsum, b / wsum);
  return out.lerp(_p, Math.min(1, wsum));
}

/** The ground's colour at region coords, as the game draws it: generated, then painted. */
export function regionColor(x: number, z: number, out: THREE.Color) {
  terrainColor(regionHeightRaw(x, z), regionFlora(x, z), out);
  return applyGroundPaint(x, z, out);
}

/**
 * The planet's surface at direction `d`: raw height (may be below sea level),
 * flora field and colour (into `color`). Inside the landing region it follows
 * the detailed (sculpted, painted) patch; `inner` is then the region's
 * Chebyshev distance from the centre, else -1. Shared by the globe geometry and
 * the baked surface texture (surface.ts) so the two always agree.
 */
export function surfaceAt(d: THREE.Vector3, color: THREE.Color): { h: number; flora: number; inner: number } {
  const cu = d.dot(U);
  if (cu > 0.95) {
    const x = (R * d.dot(E)) / cu, z = (R * d.dot(N)) / cu;
    const inner = Math.max(Math.abs(x), Math.abs(z));
    if (inner < HALF + 2) {
      const h = regionHeightRaw(x, z), flora = regionFlora(x, z);
      terrainColor(h, flora, color);
      applyGroundPaint(x, z, color);
      return { h, flora, inner };
    }
  }
  const h = globeHeight(d), flora = floraAt(d);
  terrainColor(h, flora, color);
  return { h, flora, inner: -1 };
}

/** Globe geometry as plain arrays (worker-friendly: see gen-worker.ts). */
export interface GlobeArrays { position: Float32Array; color: Float32Array; normal: Float32Array; index: Uint32Array | null }

/**
 * Low-poly globe geometry; the part under the landing region is sunk so the
 * detailed patch covers it. The icosphere repeats each corner for every
 * triangle that uses it (~6×), so corners are welded first and the terrain is
 * worked out once per corner; the result is indexed for both looks (flat
 * shading takes its normals per pixel).
 */
export function globeArrays(look: 'flat' | 'smooth' = 'flat'): GlobeArrays {
  const ico = new THREE.IcosahedronGeometry(1, 64);
  const src = (ico.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const count = src.length / 3;
  const index = new Uint32Array(count);
  const seen = new Map<number, number>();
  const dirs: number[] = [];
  const Q = 32768, B = 2 * Q + 1;
  for (let i = 0; i < count; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const key = (Math.round(x * Q) + Q) * B * B + (Math.round(y * Q) + Q) * B + (Math.round(z * Q) + Q);
    let k = seen.get(key);
    if (k === undefined) { k = dirs.length / 3; seen.set(key, k); dirs.push(x, y, z); }
    index[i] = k;
  }
  ico.dispose();
  const n = dirs.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const d = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    d.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]).normalize();
    const sf = surfaceAt(d, color);
    let r = R + seabed(sf.h);
    if (sf.inner >= 0) {
      // follow the detailed patch; sink only well inside it so coarse triangles that
      // straddle the border don't open a trench along the patch edge
      r = R + seabed(sf.h) - (sf.inner < Math.max(HALF * 0.5, HALF - 60) ? 14 : 1.5);
    }
    pos[i * 3] = d.x * r; pos[i * 3 + 1] = d.y * r; pos[i * 3 + 2] = d.z * r;
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  void look; // same geometry for both looks; the material decides flat or smooth shading
  return { position: pos, color: col, normal: (geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array, index };
}

/** The globe mesh from its arrays. */
export function globeMesh(a: GlobeArrays, look: 'flat' | 'smooth' = 'flat'): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  if (a.index) geo.setIndex(new THREE.BufferAttribute(a.index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: look === 'flat', roughness: 0.95, metalness: 0 }),
  );
  mesh.name = 'home-globe';
  return mesh;
}

export const buildGlobe = (look: 'flat' | 'smooth' = 'flat') => globeMesh(globeArrays(look), look);

/** Thin fresnel shell for the atmosphere glow seen from orbit. */
export function buildAtmosphere(radius: number, color: THREE.ColorRepresentation, strength = 1): THREE.Mesh {
  // lit by the sun (sunPosUniform, set by SolarSystem.update): bright on the day side, a faint rim on
  // the night side, and a glowing ring when the sun is behind the body (light scattered toward you)
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength }, uSunPos: sunPosUniform },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color;
      uniform float strength;
      uniform vec3 uSunPos;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN), V = normalize(vV);
        vec3 L = normalize((viewMatrix * vec4(uSunPos, 1.0)).xyz - vP);
        float rim = pow(1.0 - abs(dot(N, V)), 2.6) * strength;
        float nl = dot(N, L);
        float day = smoothstep(-0.3, 0.35, nl);
        float fs = pow(max(dot(-V, L), 0.0), 5.0);
        // warmer along the terminator (sunrise and sunset seen from space)
        vec3 col = mix(color, vec3(1.0, 0.58, 0.32), (1.0 - smoothstep(0.0, 0.35, abs(nl + 0.05))) * 0.45);
        float f = rim * (0.12 + 0.88 * day + 4.0 * fs);
        gl_FragColor = vec4(col * f, f);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
}
