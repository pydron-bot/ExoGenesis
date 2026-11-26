/**
 * Skirmish maps (DESIGN §5.11 phase 2): a region record generated from a seed and a few options, the same for every
 * player and fair to each of them.
 *
 * The ground is a world's own terrain at a random site (the globe's height, plus the region's local relief); the
 * generator then sculpts it:
 *   - start spots evenly round a ring, each a flat base (raised clear of any water) with the same layout of alloy
 *     deposits, an isotope seam and a geothermal vent round it, turned to face the middle;
 *   - contested deposits between neighbouring bases and an isotope seam in the middle;
 *   - land roads from every base to the middle, so nobody is cut off by the sea;
 *   - small flat pads under every deposit, seam and vent, so they can be built on.
 * Predator spawns (for packs) sit near the edge between bases, herds (for wildlife) partway out between them.
 *
 * The page generates the map once and hands the record to the sim worker (`useRegion(id, draft)`); nothing is saved
 * to content. Needs the world records (`content.bodies`) and works on the shared terrain state in world/planet.ts,
 * so whoever calls it sets the terrain again afterwards (it leaves the generated map's terrain set).
 */
import type { RegionDef } from '../content/defs';
import { HEIGHT_SCALE, REGION_STEP, regionCells } from '../content/defs';
import { encodeGrid } from '../content/grid';
import { PathGrid } from '../sim/path';
import { regionHeightRaw, regionProcBase, regionTerrain, setRegionTerrain } from '../world/planet';
import { mulberry32 } from '../util/rng';

export type MapSize = 'small' | 'medium' | 'large';
export type MapWater = 'none' | 'some' | 'lots';
export type MapRelief = 'flat' | 'rolling' | 'rugged';

export interface MapOptions {
  seed: number;
  players: number;
  size: MapSize;
  /** World record id (content/bodies): its terrain, look and biome. */
  world: string;
  /** Seas on worlds that have them ('none' lifts the whole map onto dry land). */
  water: MapWater;
  relief: MapRelief;
  /** A fixed site on the world (a Domination area, src/sim/areas.ts), instead of a random one. */
  site?: { lat: number; lon: number; name?: string };
}

export interface SkirmishMap {
  region: RegionDef;
  /** One per player, in player order. */
  homes: { x: number; z: number }[];
  /** False if a check failed even after the retries (a base low or wet, or a base cut off). */
  ok: boolean;
  /** What the checks found, for tests and the setup screen. */
  report: { landShare: number; tries: number; problems: string[] };
}

/** Side length per size (u): bigger for more players. */
export function mapSide(size: MapSize, players: number) {
  const base = size === 'small' ? 240 : size === 'medium' ? 320 : 400;
  return Math.min(480, base + (players > 2 ? 40 : 0));
}

/** Seeded random numbers (mulberry32). */
const rng = (seed: number) => mulberry32((seed >>> 0) || 1);

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const round1 = (v: number) => Math.round(v * 2) / 2;

/** Per base, relative to it: along = toward the middle, side = to its left (so the layout turns with the base). */
const LAYOUT = {
  deposits: [{ d: 27, a: 0.95, alloys: 3000 }, { d: 27, a: -0.95, alloys: 3000 }, { d: 62, a: 1.25, alloys: 2500 }],
  seam: { d: 40, a: -1.6, isotopes: 600 },
  vent: { d: 34, a: 1.95 },
};
/** The flat base round each Command Core (u): flat out to FLAT, blending into the terrain by EASE. */
const FLAT = 34, EASE = 62;

export function generateSkirmishMap(o: MapOptions, bodies: Record<string, unknown>): SkirmishMap {
  const rnd = rng(o.seed * 7919 + o.players * 31);
  const side = mapSide(o.size, o.players), half = side / 2;
  const ocean = !!(bodies[o.world] as { ocean?: unknown } | undefined)?.ocean;
  const keepSea = ocean && o.water !== 'none';
  const region: RegionDef = {
    name: o.site?.name ?? `Skirmish ${o.seed}`,
    body: o.world === 'home' ? undefined : o.world,
    size: side,
    detail: o.relief === 'flat' ? 4 : o.relief === 'rolling' ? 9 : 18,
    detailSize: o.relief === 'flat' ? 20 : o.relief === 'rolling' ? 13 : 9,
    detailSeed: 1 + Math.floor(rnd() * 99999),
    floraSeed: 1 + Math.floor(rnd() * 99999),
    floraDensity: 1,
    keepSea: keepSea || undefined,
    siteLat: 0, siteLon: 0,
    herds: [], deposits: [], spawns: [], vents: [], seams: [],
    graceSeconds: 240,
  };
  // ---- the site: on a sea world with water, the candidate whose land share is nearest the ask
  const want = o.water === 'lots' ? 0.5 : 0.75;
  let landShare = 1;
  {
    let best = { lat: 0, lon: 0, score: -Infinity, land: 1 };
    const tries = keepSea && !o.site ? 18 : 1;
    for (let k = 0; k < tries; k++) {
      const lat = o.site ? o.site.lat : Math.round((rnd() - 0.5) * 110), lon = o.site ? o.site.lon : Math.round((rnd() - 0.5) * 360);
      region.siteLat = lat; region.siteLon = lon;
      setRegionTerrain(regionTerrain(region, bodies));
      let land = 0, n = 0;
      for (let z = -half + 8; z < half; z += 12) for (let x = -half + 8; x < half; x += 12) { n++; if (regionProcBase(x, z) >= 0.6) land++; }
      const share = land / n, score = keepSea ? -Math.abs(share - want) : 0;
      if (score > best.score) best = { lat, lon, score, land: share };
    }
    region.siteLat = best.lat; region.siteLon = best.lon;
    landShare = best.land;
  }
  setRegionTerrain(regionTerrain(region, bodies));

  // ---- where things go
  const turn = rnd() * Math.PI * 2;
  const ring = half * 0.6;
  const homes = Array.from({ length: o.players }, (_, i) => {
    const a = turn + (i / o.players) * Math.PI * 2;
    return { x: round1(Math.cos(a) * ring), z: round1(Math.sin(a) * ring) };
  });
  const at = (h: { x: number; z: number }, d: number, a: number) => {
    const c = Math.atan2(-h.z, -h.x) + a; // angle toward the middle, turned by a
    return { x: round1(h.x + Math.cos(c) * d), z: round1(h.z + Math.sin(c) * d) };
  };
  for (const h of homes) {
    for (const dp of LAYOUT.deposits) region.deposits.push({ ...at(h, dp.d, dp.a), alloys: dp.alloys });
    region.seams!.push({ ...at(h, LAYOUT.seam.d, LAYOUT.seam.a), isotopes: LAYOUT.seam.isotopes });
    region.vents!.push(at(h, LAYOUT.vent.d, LAYOUT.vent.a));
  }
  // between each pair of neighbours: a rich contested deposit; spawns out by the edge, herds partway
  for (let i = 0; i < o.players; i++) {
    const a = turn + ((i + 0.5) / o.players) * Math.PI * 2;
    // two players: the gaps are wide, so a deposit each side of the middle
    const r = o.players === 2 ? half * 0.32 : half * 0.42;
    region.deposits.push({ x: round1(Math.cos(a) * r), z: round1(Math.sin(a) * r), alloys: 5000 });
    region.spawns.push({ x: round1(Math.cos(a) * half * 0.86), z: round1(Math.sin(a) * half * 0.86) });
    region.herds.push({ x: round1(Math.cos(a) * half * 0.6), z: round1(Math.sin(a) * half * 0.6), grazers: 8, roam: 30 });
  }
  region.seams!.push({ x: 0, z: 18, isotopes: 1200 });

  // ---- sculpt: work out a target height per node, store target − generated
  const n = regionCells(half);
  const base = new Float32Array(n * n), target = new Float32Array(n * n);
  const nx = (i: number) => -half + i * REGION_STEP;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) base[j * n + i] = target[j * n + i] = regionProcBase(nx(i), nx(j));
  /** Mean generated height in a disc (sampled). */
  const meanAt = (x: number, z: number, r: number) => {
    let s = 0, c = 0;
    for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) if (dx * dx + dz * dz <= r * r) { s += regionProcBase(x + dx, z + dz); c++; }
    return s / Math.max(1, c);
  };
  /** Blend the target toward height h: fully inside r0, easing out to r1. */
  const flatten = (x: number, z: number, h: number, r0: number, r1: number) => {
    const i0 = Math.max(0, Math.floor((x - r1 + half) / REGION_STEP)), i1 = Math.min(n - 1, Math.ceil((x + r1 + half) / REGION_STEP));
    const j0 = Math.max(0, Math.floor((z - r1 + half) / REGION_STEP)), j1 = Math.min(n - 1, Math.ceil((z + r1 + half) / REGION_STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = 1 - smooth(r0, r1, Math.hypot(nx(i) - x, nx(j) - z));
      if (k > 0) target[j * n + i] += (h - target[j * n + i]) * k;
    }
  };
  /** Raise the target to at least h along the segment a → b, `w` u wide. */
  const road = (a: { x: number; z: number }, b: { x: number; z: number }, h: number, w: number) => {
    const lx = b.x - a.x, lz = b.z - a.z, ll = lx * lx + lz * lz;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const px = nx(i), pz = nx(j);
      const t = Math.min(1, Math.max(0, ((px - a.x) * lx + (pz - a.z) * lz) / ll));
      const d = Math.hypot(px - (a.x + lx * t), pz - (a.z + lz * t));
      const k = 1 - smooth(w * 0.5, w * 0.5 + 8, d);
      const p = j * n + i;
      if (k > 0 && target[p] < h) target[p] += (h - target[p]) * k;
    }
  };
  const problems: string[] = [];
  let tries = 0, roadH = 1.2, roadW = 12;
  const baseH = homes.map((h) => Math.max(2, meanAt(h.x, h.z, FLAT)));
  const spots = [...region.deposits, ...region.seams!, ...region.vents!];
  const spotH = spots.map((p) => Math.max(1.4, meanAt(p.x, p.z, 8)));
  for (;;) {
    tries++;
    target.set(base);
    homes.forEach((h, i) => flatten(h.x, h.z, baseH[i], FLAT, EASE));
    // the flat bases take the deposits round them along; outside them, each spot gets a small pad of its own
    spots.forEach((p, i) => {
      const home = homes.findIndex((h) => Math.hypot(h.x - p.x, h.z - p.z) < FLAT + 4);
      if (home >= 0) return;
      // near a base (in its easing ring): a pad at the base's height, so it doesn't pull the base's rim
      const by = homes.findIndex((h) => Math.hypot(h.x - p.x, h.z - p.z) < EASE + 16);
      flatten(p.x, p.z, by >= 0 ? baseH[by] : spotH[i], 8, 16);
    });
    for (const h of homes) road(h, { x: 0, z: 0 }, roadH, roadW);
    const sculpt = new Float32Array(n * n);
    for (let p = 0; p < n * n; p++) sculpt[p] = Math.max(-600, Math.min(600, Math.round((target[p] - base[p]) / HEIGHT_SCALE)));
    region.height = encodeGrid(sculpt, n, n);
    setRegionTerrain(regionTerrain(region, bodies));
    // checks: every base dry and flat; every base can reach every other by land
    problems.length = 0;
    homes.forEach((h, i) => {
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 16; a++) for (const r of [0, 10, 20, 28]) {
        const v = regionHeightRaw(h.x + Math.cos(a * 0.393) * r, h.z + Math.sin(a * 0.393) * r);
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      if (lo < 0.8) problems.push(`base ${i + 1} is low (${lo.toFixed(1)} u)`);
      if (hi - lo > 3) problems.push(`base ${i + 1} isn't flat (${(hi - lo).toFixed(1)} u)`);
    });
    const grid = new PathGrid(half - 6, 'ground');
    for (let i = 1; i < homes.length; i++) {
      if (!grid.reaches(homes[0].x, homes[0].z, homes[i].x, homes[i].z, 6)) problems.push(`base ${i + 1} is cut off from base 1`);
    }
    if (!problems.length || tries >= 4) break;
    roadH += 0.6; roadW += 6; // wider, higher roads next time
  }
  return { region, homes, ok: !problems.length, report: { landShare, tries, problems: [...problems] } };
}
