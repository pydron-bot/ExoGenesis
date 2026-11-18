/**
 * Placement and power rules shared by the sim (authoritative) and the main
 * thread (placement ghost), so the ghost turns red exactly when the sim would
 * refuse.
 */
import type { BuildingDef, ColonyRules } from '../content/defs';
import { regionHeightRaw } from '../world/planet';
import { REGION_HALF } from './types';

export interface PlaceWorld {
  buildings: { kind: string; x: number; z: number; progress: number; yaw?: number }[];
  deposits: { x: number; z: number; alloys: number }[];
  /** Geothermal vents (from the region map). */
  vents?: { x: number; z: number }[];
  /** Inhabitant camps still lived in: nothing may be built on the camp itself (r = its radius). */
  campSites?: { x: number; z: number; r: number; name: string }[];
}

/** Line-placed or gate: blocks predators, doesn't extend the build area. */
export const isBarrier = (role: string | undefined) => role === 'wall' || role === 'gate';

export const DEPOSIT_RADIUS = 6;
export const EDGE = REGION_HALF - 10;

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
  if (hi - lo > Math.max(4, r * 1.1)) return 'ground too steep';
  for (const b of w.buildings) {
    const o = defs[b.kind];
    if (!o) continue;
    // a gate goes onto a wall line, replacing the segments under it
    if (d.role === 'gate' && o.role === 'wall') continue;
    if (Math.hypot(b.x - x, b.z - z) < (o.clearance + d.clearance) / 2) return `too close to the ${o.name}`;
  }
  for (const c of w.campSites ?? []) {
    if (Math.hypot(c.x - x, c.z - z) < c.r + r) return `on ${c.name}'s camp`;
  }
  for (const dep of w.deposits) {
    if (dep.alloys > 0 && Math.hypot(dep.x - x, dep.z - z) < DEPOSIT_RADIUS + r) return 'on top of a deposit';
  }
  // must be near the core or a finished building
  let near = false;
  for (const b of w.buildings) {
    const o = defs[b.kind];
    if (!o) continue;
    // walls don't extend the build area (no creeping a wall across the map)
    const reach = o.role === 'core' ? (o.range ?? rules.buildRadius) : o.role === 'relay' && b.progress >= 1 ? Math.max(o.range ?? 0, rules.buildRadius + o.clearance / 2) : b.progress >= 1 && !isBarrier(o.role) ? rules.buildRadius + o.clearance / 2 : 0;
    if (Math.hypot(b.x - x, b.z - z) <= reach) { near = true; break; }
  }
  if (!near) return 'outside the build area: build closer to the Core or a finished building';
  if (d.role === 'depot' && depositFor(w, d, x, z) < 0) return `no alloy deposit within ${d.range} u`;
  if (d.role === 'geothermal' && ventFor(w, defs, d, x, z) < 0) return 'must sit on a free geothermal vent';
  return null;
}

/** An untapped vent within a geothermal tap's range of (x, z), or -1. */
export function ventFor(w: PlaceWorld, defs: Record<string, BuildingDef>, d: BuildingDef, x: number, z: number): number {
  const reach = d.range ?? 5;
  let best = -1, bd = Infinity;
  (w.vents ?? []).forEach((v, i) => {
    const dist = Math.hypot(v.x - x, v.z - z);
    if (dist > reach || dist >= bd) return;
    const taken = w.buildings.some((b) => defs[b.kind]?.role === 'geothermal' && Math.hypot(b.x - v.x, b.z - v.z) <= (defs[b.kind].range ?? 5) && (b.x !== x || b.z !== z));
    if (!taken) { bd = dist; best = i; }
  });
  return best;
}

/**
 * A gate near a wall snaps onto that wall's line and turns to match it. It
 * centres between the segment under the cursor and its neighbour on the
 * cursor's side, so it replaces exactly those two and leaves no gap (at the end
 * of a line it centres on the last segment). Null if no wall is close.
 */
export function gateSnap(w: PlaceWorld, defs: Record<string, BuildingDef>, x: number, z: number): { x: number; z: number; yaw: number } | null {
  let near: PlaceWorld['buildings'][number] | null = null, bd = 4;
  for (const b of w.buildings) {
    if (defs[b.kind]?.role !== 'wall') continue;
    const dist = Math.hypot(b.x - x, b.z - z);
    if (dist < bd) { bd = dist; near = b; }
  }
  if (!near) return null;
  const yaw = near.yaw ?? 0, ux = Math.sin(yaw), uz = Math.cos(yaw);
  const side = Math.sign((x - near.x) * ux + (z - near.z) * uz) || 1;
  const step = defs[near.kind].clearance + 0.02;
  const pair = (dir: number) => w.buildings.find((b) => b !== near && defs[b.kind]?.role === 'wall' && Math.abs(Math.sin((b.yaw ?? 0) - yaw)) < 0.05
    && Math.hypot(b.x - (near!.x + ux * step * dir), b.z - (near!.z + uz * step * dir)) < 0.6);
  const mate = pair(side) ?? pair(-side);
  return mate ? { x: (near.x + mate.x) / 2, z: (near.z + mate.z) / 2, yaw } : { x: near.x, z: near.z, yaw };
}

/** Wall segments a gate at (x, z, yaw) replaces: centred on its line, within its length. */
export function wallsUnderGate<B extends PlaceWorld['buildings'][number]>(list: B[], defs: Record<string, BuildingDef>, gate: BuildingDef, x: number, z: number, yaw: number): B[] {
  const ux = Math.sin(yaw), uz = Math.cos(yaw), half = gate.clearance / 2;
  return list.filter((b) => {
    const o = defs[b.kind];
    if (o?.role !== 'wall') return false;
    const dx = b.x - x, dz = b.z - z;
    const along = dx * ux + dz * uz, across = Math.abs(dx * uz - dz * ux);
    return Math.abs(along) < half - 0.5 && across < 2.5;
  });
}

/** Most segments in one wall line. */
export const MAX_LINE = 30;

/**
 * Segment centres for a line of `kind` from (x1, z1) toward (x2, z2), one
 * clearance apart (a hair more, so neighbours pass the clearance check), and the
 * yaw they all share. At least one segment.
 */
export function linePoints(d: BuildingDef, x1: number, z1: number, x2: number, z2: number) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const step = d.clearance + 0.02;
  const n = Math.min(MAX_LINE, Math.floor(len / step) + 1);
  const yaw = len > 0.01 ? Math.atan2(x2 - x1, z2 - z1) : 0;
  const ux = len > 0.01 ? (x2 - x1) / len : 0, uz = len > 0.01 ? (z2 - z1) / len : 0;
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: x1 + ux * step * i, z: z1 + uz * step * i });
  return { pts, yaw };
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
