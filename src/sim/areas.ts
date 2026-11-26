/**
 * Domination areas (DESIGN §5.12, TECH.md "Domination areas"): every body with `areas` in its record is split into
 * that many areas, generated from its seed, the same every time.
 *
 * - **Where:** a jittered Fibonacci sphere of candidates turned by the body's seed; on a world with seas only
 *   candidates on land; then farthest-point picking, so the areas spread evenly. Home's first area is Touchdown.
 * - **Links:** areas on one body that are neighbours (a Gabriel graph on the sphere: no third area closer to their
 *   midpoint than they are), so every area on a body can be reached overland.
 * - **Names:** a direction and a landform from the body's ground there ("Northern Highlands", "Eastern Basin").
 *
 * Coordinates are the region `siteLat` / `siteLon` frame (degrees from Touchdown, `siteDir` in world/planet.ts), so an
 * area is played as a region sited there (`areaMapOptions`).
 */
import * as THREE from 'three';
import type { BodyDef } from '../content/defs';
import { lookOf } from '../world/body-surface';
import { bodyHeight, bodyTerrain, E, N, siteDir, U, type BodyTerrain } from '../world/planet';
import { mulberry32 } from '../util/rng';

export interface Area {
  /** `<body>-<n>`, n from 1. */
  id: string;
  body: string;
  /** "Northern Highlands" (the body's name goes in front where it isn't obvious: `areaLabel`). */
  name: string;
  /** Degrees, region site frame. */
  lat: number;
  lon: number;
  /** Neighbour areas on the same body. */
  links: string[];
  /** Map size for a battle there. */
  size: 'small' | 'medium';
}

interface BodyLike { name?: string; kind?: string; areas?: number; radius?: number; seed?: number; ocean?: boolean; surface?: string; ground?: unknown; atmosphere?: string }

const rng = (seed: number) => mulberry32((seed >>> 0) || 1);
const ang = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** lat / lon (degrees, site frame) of a body direction. */
export function latLonOf(d: THREE.Vector3) {
  return { lat: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.dot(N))))), lon: THREE.MathUtils.radToDeg(Math.atan2(d.dot(E), d.dot(U))) };
}

/** Title case for an all-caps body name ("DUNMORE" → "Dunmore", "IO-T" stays). */
export const bodyTitle = (name: string) => name.replace(/\b([A-Z])([A-Z]{2,})\b/g, (_, a, b) => a + b.toLowerCase());

const LANDFORMS: Record<string, { high: string[]; mid: string[]; low: string[] }> = {
  icy: { high: ['Ice Ridges', 'Frost Heights'], mid: ['Ice Shelf', 'Rime Plain', 'Fracture Field'], low: ['Frozen Basin', 'Glass Flats'] },
  volcanic: { high: ['Caldera Rim', 'Ash Peaks'], mid: ['Lava Fields', 'Cinder Plain', 'Vent Field'], low: ['Magma Basin', 'Slag Flats'] },
  sulfur: { high: ['Sulfur Heights', 'Vent Crags'], mid: ['Yellow Plain', 'Caldera Field'], low: ['Acid Basin', 'Brimstone Flats'] },
  dusty: { high: ['Mesas', 'Dust Highlands'], mid: ['Dune Sea', 'Wind Plain', 'Erg'], low: ['Dry Basin', 'Salt Pan'] },
  verdant: { high: ['Highlands', 'Ridges'], mid: ['Reach', 'Plains', 'Steppe'], low: ['Lowlands', 'Coast', 'Delta'] },
  cratered: { high: ['Crater Rim', 'Highlands'], mid: ['Crater Field', 'Regolith Plain', 'Terrace'], low: ['Mare', 'Impact Basin'] },
  smooth: { high: ['Rise', 'Heights'], mid: ['Plain', 'Expanse'], low: ['Basin', 'Hollow'] },
};

function direction(lat: number, lon: number) {
  if (lat > 50) return 'North Polar';
  if (lat < -50) return 'South Polar';
  const ns = lat > 18 ? 'North' : lat < -18 ? 'South' : '';
  const ew = Math.abs(lon) < 45 ? '' : Math.abs(lon) > 135 ? 'Far' : lon > 0 ? 'East' : 'West';
  if (ew === 'Far') return ns ? `Far ${ns}ern` : 'Far Side';
  if (ns && ew) return `${ns}-${ew.toLowerCase()}ern`.replace(/^./, (c) => c.toUpperCase());
  if (ns) return `${ns}ern`;
  if (ew) return `${ew}ern`;
  return 'Central';
}

/** The areas on one body (empty without `areas`, or on a giant or comet). */
export function bodyAreas(id: string, b: BodyLike): Area[] {
  const n = Math.max(0, Math.min(12, Math.floor(b.areas ?? 0)));
  if (!n || b.kind === 'giant' || b.kind === 'comet') return [];
  const w: BodyTerrain = bodyTerrain(id, b as Record<string, unknown>);
  let hash = 17;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const rnd = rng((b.seed ?? 7) * 7349 + hash);
  // candidates: a jittered Fibonacci sphere, turned by the seed
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
  const cand: { d: THREE.Vector3; h: number }[] = [];
  const M = 160;
  for (let i = 0; i < M; i++) {
    const y = 1 - (i + 0.5) * (2 / M), r = Math.sqrt(1 - y * y), th = i * 2.399963 + rnd() * 0.3;
    const d = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).applyQuaternion(turn).normalize();
    // keep off the very poles of the site frame (the region frame turns badly there)
    if (Math.abs(d.dot(N)) > 0.93) continue;
    const h = bodyHeight(d, w);
    // seas: land only, with some margin (the middle of an area should be well inland)
    if (w.ocean && h < 10) continue;
    cand.push({ d, h });
  }
  const picked: { d: THREE.Vector3; h: number }[] = [];
  // Home's first area is Touchdown (the campaign's landing site)
  if (id === 'home') picked.push({ d: siteDir(0, 0), h: bodyHeight(siteDir(0, 0), w) });
  else if (cand.length) picked.push(cand[Math.floor(rnd() * cand.length)]);
  while (picked.length < n && cand.length) {
    let best = -1, bd = -1;
    cand.forEach((c, i) => {
      const md = Math.min(...picked.map((p) => ang(p.d, c.d)));
      if (md > bd) { bd = md; best = i; }
    });
    if (best < 0 || bd < 0.05) break;
    picked.push(cand.splice(best, 1)[0]);
  }
  // order: north to south, west to east, so ids read sensibly (Home keeps Touchdown first)
  const head = id === 'home' ? picked.splice(0, 1) : [];
  picked.sort((a, c) => c.d.dot(N) - a.d.dot(N) || a.d.dot(E) - c.d.dot(E));
  const all = [...head, ...picked];
  // landform by height within this body's own range
  const hs = all.map((p) => p.h).sort((a, c) => a - c);
  const lo = hs[Math.floor(hs.length / 3)] ?? 0, hi = hs[Math.floor((hs.length * 2) / 3)] ?? 0;
  const forms = LANDFORMS[lookOf(b as BodyDef)] ?? LANDFORMS.cratered;
  const used = new Set<string>();
  const areas: Area[] = all.map((p, i) => {
    const { lat, lon } = latLonOf(p.d);
    const band = all.length < 3 ? forms.mid : p.h >= hi && p.h > lo ? forms.high : p.h <= lo ? forms.low : forms.mid;
    let name = id === 'home' && i === 0 ? 'Touchdown' : `${direction(lat, lon)} ${band[i % band.length]}`;
    for (let k = 0; used.has(name) && k < band.length; k++) name = `${direction(lat, lon)} ${band[(i + k + 1) % band.length]}`;
    if (used.has(name)) name = `${name} ${['II', 'III', 'IV', 'V'][[...used].filter((u) => u.startsWith(name)).length - 1] ?? i + 1}`;
    used.add(name);
    return { id: `${id}-${i + 1}`, body: id, name, lat: r1(lat), lon: r1(lon), links: [], size: (b.radius ?? 3000) < 1000 ? 'small' : 'medium' };
  });
  // links: the Gabriel graph on the sphere
  const dirs = all.map((p) => p.d);
  const mid = new THREE.Vector3();
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    mid.copy(dirs[i]).add(dirs[j]).normalize();
    const r = ang(mid, dirs[i]);
    if (dirs.every((d, k) => k === i || k === j || ang(mid, d) >= r)) { areas[i].links.push(areas[j].id); areas[j].links.push(areas[i].id); }
  }
  return areas;
}

/** Every body's areas, by body id order. */
export function systemAreas(bodies: Record<string, BodyLike>): Area[] {
  return Object.keys(bodies).sort().flatMap((id) => bodyAreas(id, bodies[id]));
}

/** "Dunmore · Northern Mesas" (Home's Touchdown is just "Touchdown"). */
export const areaLabel = (a: Area, bodies: Record<string, BodyLike>) => (a.id === 'home-1' ? 'Touchdown' : `${bodyTitle(bodies[a.body]?.name ?? a.body)} · ${a.name}`);

/** Look an area up by id (null if there's no such area). */
export function findArea(id: string | null | undefined, bodies: Record<string, BodyLike>): Area | null {
  if (!id) return null;
  const body = id.replace(/-\d+$/, '');
  return bodies[body] ? bodyAreas(body, bodies[body]).find((a) => a.id === id) ?? null : null;
}
