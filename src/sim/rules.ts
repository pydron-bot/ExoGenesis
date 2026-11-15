/**
 * Placement and power rules shared by the sim (authoritative) and the main
 * thread (placement ghost), so the ghost turns red exactly when the sim would
 * refuse.
 */
import type { BuildingDef, ColonyRules } from '../content/defs';
import { regionHeightRaw } from '../world/planet';
import { REGION_HALF } from './types';

export interface PlaceWorld {
  buildings: { kind: string; x: number; z: number; progress: number }[];
  deposits: { x: number; z: number; alloys: number }[];
}

export const DEPOSIT_RADIUS = 6;
export const EDGE = REGION_HALF - 10;
/** Order in which loads lose power when there isn't enough (first = shed first). */
export const SHED_ORDER = ['radar', 'depot', 'turret', 'battery', 'solar', 'core'];

/** Why `kind` can't go at (x, z), or null if it can. */
export function placeProblem(
  w: PlaceWorld, defs: Record<string, BuildingDef>, rules: ColonyRules, kind: string, x: number, z: number,
): string | null {
  const d = defs[kind];
  if (!d) return 'unknown building';
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return 'too close to the region edge';
  const r = d.clearance / 2;
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) {
    const h = regionHeightRaw(x + dx, z + dz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  if (lo < 0.6) return 'can’t build in water';
  if (hi - lo > Math.max(3, r * 0.5)) return 'ground too steep';
  for (const b of w.buildings) {
    const o = defs[b.kind];
    if (!o) continue;
    if (Math.hypot(b.x - x, b.z - z) < (o.clearance + d.clearance) / 2) return `too close to the ${o.name}`;
  }
  for (const dep of w.deposits) {
    if (dep.alloys > 0 && Math.hypot(dep.x - x, dep.z - z) < DEPOSIT_RADIUS + r) return 'on top of a deposit';
  }
  // must be near the core or a finished building
  let near = false;
  for (const b of w.buildings) {
    const o = defs[b.kind];
    if (!o) continue;
    const reach = o.role === 'core' ? (o.range ?? rules.buildRadius) : b.progress >= 1 ? rules.buildRadius + o.clearance / 2 : 0;
    if (Math.hypot(b.x - x, b.z - z) <= reach) { near = true; break; }
  }
  if (!near) return 'outside the build area: build closer to the Core or a finished building';
  if (d.role === 'depot' && depositFor(w, d, x, z) < 0) return `no alloy deposit within ${d.range} u`;
  return null;
}

/** Nearest deposit with alloys left within a depot's range, or -1. */
export function depositFor(w: Pick<PlaceWorld, 'deposits'>, d: BuildingDef, x: number, z: number): number {
  let best = -1, bd = Infinity;
  w.deposits.forEach((dep, i) => {
    const dist = Math.hypot(dep.x - x, dep.z - z);
    if (dep.alloys > 0 && dist <= (d.range ?? 0) && dist < bd) { bd = dist; best = i; }
  });
  return best;
}

/** Compass word for a direction from the base (region x = east, z = north). */
export function compass(x: number, z: number): string {
  const a = (Math.atan2(x, z) * 180) / Math.PI;
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[(Math.round(a / 45) + 8) % 8];
}
