/**
 * Computer players for skirmishes (DESIGN §5.11 phase 4). Runs in the sim, in the player's own view
 * (`Sim.withTeam`), and plays only through the commands a person has (build, fabricate a drone, queue a unit,
 * research, order units): no peeking past its fog except where every player's base started.
 *
 * Each think (every `period` ticks, by difficulty) it:
 *   1. builds the next thing its base lacks, in priority order: power first, depots on its deposits, a Vehicle Bay,
 *      turrets toward the middle, the geothermal vent, batteries for the night, more deposits, a Tech Lab, a second
 *      bay, more guns, a Deep-Core Mine; one site per drone at a time, leaving lanes between buildings;
 *   2. keeps its drones topped up, researches, and keeps its factories busy with a mix that shifts over the game;
 *   3. runs its army: everyone home when the base is under attack, otherwise new units gather at a rally point and
 *      leave in waves (bigger each time) for the nearest enemy's Core; a wave that's broken falls back.
 * Its memory (`PlayerState.brain`) lives in the save.
 */
import { content } from '../content';
import type { BuildingDef } from '../content/defs';
import { factoryMakes } from './rules';
import type { AiBrain, Building, Command, PlayerState, SimState, Unit } from './types';

export type Level = NonNullable<PlayerState['ai']>;

interface LevelRules {
  /** Ticks between thinks. */
  period: number;
  drones: number;
  turrets: number;
  /** First attack no earlier than this (s), and wave sizes. */
  firstAttack: number;
  waveBase: number;
  waveGrow: number;
  waveMax: number;
  /** Tech Lab and research. */
  tech: boolean;
  bays: number;
  /** Alloys kept back from unit production for buildings. */
  reserve: number;
  /** Extra alloys a second (the hard computer's edge). */
  bonus: number;
  /** Relay Towers to reach more deposits. */
  relays: number;
}
export const LEVELS: Record<Level, LevelRules> = {
  easy: { period: 50, drones: 2, turrets: 1, firstAttack: 540, waveBase: 6, waveGrow: 1, waveMax: 12, tech: false, bays: 1, reserve: 80, bonus: 0, relays: 0 },
  normal: { period: 25, drones: 3, turrets: 2, firstAttack: 390, waveBase: 10, waveGrow: 2, waveMax: 22, tech: true, bays: 2, reserve: 50, bonus: 0, relays: 2 },
  hard: { period: 12, drones: 4, turrets: 2, firstAttack: 330, waveBase: 12, waveGrow: 3, waveMax: 30, tech: true, bays: 2, reserve: 30, bonus: 0.5, relays: 3 },
};

/** What the computer needs from the sim (all in its own view). */
export interface AiHost {
  readonly s: SimState;
  readonly team: number;
  readonly power: { gen: number; draw: number; short: number; storageMax: number; daylight: number };
  /** Why `kind` can't go at (x, z) for this player (placement rules only; alloys aside), or null. */
  place(kind: string, x: number, z: number): string | null;
  run(c: Command): void;
  /** Other sides' units, drones and buildings in this player's sight (and fauna). */
  foes(): { id: number; x: number; z: number; hp: number; kind?: string; unit?: string; team?: number; pack?: number }[];
  researched(id?: string): boolean;
  unitCap(): number;
  armySize(): number;
  readonly secs: number;
  /** The map's geothermal vents. */
  readonly vents: { x: number; z: number }[];
}

const DEFS = content.buildings;
const UNITS = content.units;
const RULES = content.colony;
const def = (b: Building): BuildingDef => DEFS[b.kind];
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Combat units (not transports, medics or engineers). */
const fighter = (u: Unit) => (UNITS[u.unit]?.damage ?? 0) > 0 && !UNITS[u.unit].carries;
/** Keep this much room between a new building and the ones there (lanes for units). */
const LANE = 3;

export function freshBrain(): AiBrain {
  return { wave: 0, attack: [], target: -1, launched: 0, size: 0, rally: null };
}

export function think(h: AiHost, level: Level) {
  const L = LEVELS[level], s = h.s, P = s.players!, me = P[h.team];
  const brain = (me.brain ??= freshBrain());
  if (L.bonus) s.alloys += (L.bonus * L.period) / 10;
  const home = me.home;
  // toward the middle of the map, and away from it (the safe side)
  const inA = Math.atan2(-home.z, -home.x);
  economy(h, L, inA);
  army(h, L, brain, inA);
}

// ---------- building ----------
function economy(h: AiHost, L: LevelRules, inA: number) {
  const s = h.s, home = s.players![h.team].home, B = s.buildings;
  const have = (kind: string) => B.filter((b) => b.kind === kind).length;
  const role = (r: string) => B.filter((b) => def(b)?.role === r);
  const sites = B.filter((b) => b.progress < 1).length;
  // drones: one more while short, once the first depot is up
  if (s.drones.length + s.fab.queued < L.drones && have('depot') >= 1 && s.alloys >= RULES.droneCost + 30) h.run({ type: 'fab' });
  // research
  if (L.tech && !s.research?.active && role('lab').some((b) => b.progress >= 1)) {
    for (const id of ['deep-survey', 'isotope-cells', 'shield-lattice']) {
      const r = content.research[id];
      if (!r || h.researched(id) || !h.researched(r.requires)) continue;
      if (s.alloys >= r.cost + 40 && (s.isotopes ?? 0) >= (r.isotopes ?? 0)) h.run({ type: 'research', id });
      break;
    }
  }
  if (sites >= Math.max(1, s.drones.length)) return; // the drones have enough on
  const want = nextBuilding(h, L, have, role);
  if (!want) return;
  const d = DEFS[want.kind];
  if (s.alloys < d.cost || (s.isotopes ?? 0) < (d.isotopes ?? 0)) return; // saving up for it
  const at = want.at ?? spot(h, want.kind, home, want.toward ? inA : inA + Math.PI, want.r0 ?? 14, want.r1 ?? 44);
  if (at) h.run({ type: 'build', kind: want.kind, x: at.x, z: at.z, yaw: (want.toward ? inA : inA + Math.PI) - Math.PI / 2 });
}

interface Want { kind: string; at?: { x: number; z: number } | null; toward?: boolean; r0?: number; r1?: number }

function nextBuilding(h: AiHost, L: LevelRules, have: (k: string) => number, role: (r: string) => Building[]): Want | null {
  const s = h.s, home = s.players![h.team].home, B = s.buildings, secs = h.secs;
  // power: daytime generation against the full load (everything running), and what carries the night
  let load = s.drones.length * RULES.droneBusyDrawMW;
  let day = 0, night = 0;
  for (const b of B) {
    const d = def(b);
    if (!d) continue;
    if (d.powerMW < 0) load += -d.powerMW;
    else if (d.role === 'solar') { day += d.powerMW; night += d.powerMW * RULES.nightSolar; }
    else if (d.powerMW > 0 && d.role !== 'reactor') { day += d.powerMW; night += d.powerMW; }
    else if (d.role === 'reactor' && (s.isotopes ?? 0) > 5) { day += d.powerMW; night += d.powerMW; }
  }
  const store = role('battery').length * (DEFS.battery?.storage ?? 600);
  const nightNeed = Math.max(0, load * 0.6 - night) * (RULES.solSeconds / 2);
  // deposits: near home first, then any this player can reach
  const depots = role('depot');
  const unmined = s.deposits.filter((d) => d.alloys > 300 && !depots.some((b) => dist(b, d) <= (DEFS.depot.range ?? 30)))
    .sort((a, b) => dist(a, home) - dist(b, home));
  const depotFor = (near: number) => {
    for (const dp of unmined) {
      if (dist(dp, home) > near) break;
      const at = spot(h, 'depot', dp, Math.atan2(home.z - dp.z, home.x - dp.x), 11, (DEFS.depot.range ?? 30) - 2);
      if (at) return { kind: 'depot', at };
    }
    return null;
  };
  const vent = ventSpot(h);
  const short = day < load * 1.1 + 1;
  if (have('solar') < 1) return { kind: 'solar' };
  if (depots.length < 2) { const w = depotFor(45); if (w) return w; }
  if (short) return vent && s.alloys >= DEFS.geothermal.cost ? { kind: 'geothermal', at: vent } : { kind: 'solar' };
  if (have('bay') < 1) return { kind: 'bay', toward: true, r0: 16, r1: 40 };
  const guns = role('turret').length;
  if (guns < L.turrets) return { kind: 'turret', toward: true, r0: 18, r1: 34 };
  if (vent) return { kind: 'geothermal', at: vent };
  if (store < nightNeed) return { kind: 'battery' };
  if (secs > 150) { const w = depotFor(Infinity); if (w) return w; }
  // reach for more: a Relay Tower toward the nearest free deposit on our side of the map
  if (secs > 200 && role('relay').length < L.relays && DEFS.relay) {
    const foes = s.players!.filter((p, i) => i !== h.team && p.side !== s.players![h.team].side);
    const ours = unmined.find((d) => dist(d, home) < 140 && foes.every((p) => dist(d, home) <= dist(d, p.home) + 10));
    if (ours) {
      for (let f = 0.9; f >= 0.3; f -= 0.1) {
        const p = { x: home.x + (ours.x - home.x) * f, z: home.z + (ours.z - home.z) * f };
        const at = spot(h, 'relay', p, Math.atan2(ours.z - p.z, ours.x - p.x), 0, 9);
        if (at) return { kind: 'relay', at };
      }
    }
  }
  if (L.tech && have('lab') < 1 && secs > 300) return { kind: 'lab' };
  if (have('bay') < L.bays && secs > 420) return { kind: 'bay', toward: true, r0: 16, r1: 44 };
  if (guns < L.turrets + 2 && secs > 480) return { kind: secs > 700 ? 'cannon' : 'turret', toward: true, r0: 20, r1: 40 };
  if (h.researched('deep-survey') && DEFS.deepmine) {
    const seam = (s.seams ?? []).filter((v) => v.isotopes > 50 && !B.some((b) => b.kind === 'deepmine' && dist(b, v) < 6)).sort((a, b) => dist(a, home) - dist(b, home))[0];
    if (seam && dist(seam, home) < 70) for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (!h.place('deepmine', seam.x + dx, seam.z + dz)) return { kind: 'deepmine', at: { x: seam.x + dx, z: seam.z + dz } };
  }
  if (h.researched('isotope-cells') && have('fusion') < 1 && (s.isotopes ?? 0) >= 40) return { kind: 'fusion' };
  return null;
}

/** This player's free geothermal vent within its reach, or null. */
function ventSpot(h: AiHost) {
  const s = h.s, home = s.players![h.team].home;
  for (const v of h.vents) {
    if (dist(v, home) > 60 || s.buildings.some((b) => b.kind === 'geothermal' && dist(b, v) < 5)) continue;
    for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (!h.place('geothermal', v.x + dx, v.z + dz)) return { x: v.x + dx, z: v.z + dz };
  }
  return null;
}

/**
 * The first spot for `kind` on rings round `c` (radius r0..r1), starting in direction `a` and fanning out both
 * ways, that placement allows with a lane's room round it.
 */
function spot(h: AiHost, kind: string, c: { x: number; z: number }, a: number, r0: number, r1: number) {
  const d = DEFS[kind], B = h.s.buildings;
  for (let r = r0; r <= r1; r += 3) {
    const steps = Math.max(8, Math.round((r * 2 * Math.PI) / 5));
    for (let k = 0; k < steps; k++) {
      const off = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps);
      const x = c.x + Math.cos(a + off) * r, z = c.z + Math.sin(a + off) * r;
      if (h.place(kind, x, z)) continue;
      // room for units to get between buildings (walls aside)
      if (B.some((b) => def(b)?.role !== 'wall' && dist(b, { x, z }) < (def(b).clearance + d.clearance) / 2 + LANE)) continue;
      return { x, z };
    }
  }
  return null;
}

// ---------- army ----------
function army(h: AiHost, L: LevelRules, brain: AiBrain, inA: number) {
  const s = h.s, P = s.players!, me = P[h.team], home = me.home, secs = h.secs;
  const mine = (s.units ?? []).filter(fighter);
  const byId = new Map(mine.map((u) => [u.id, u]));
  brain.attack = brain.attack.filter((id) => byId.has(id));
  const rally = brain.rally ?? (brain.rally = { x: home.x + Math.cos(inA) * 30, z: home.z + Math.sin(inA) * 30 });
  // production: keep the factories busy (saving the reserve for buildings)
  const foes = h.foes();
  const flyers = foes.some((f) => f.unit && UNITS[f.unit]?.move === 'air');
  for (const b of s.buildings) {
    if (def(b)?.role !== 'factory' || b.progress < 1 || (b.queue?.length ?? 0) >= 2) continue;
    if (h.armySize() + s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0) >= h.unitCap()) break;
    const kind = pickUnit(h, b, brain, flyers, mine.length);
    if (kind && s.alloys >= (UNITS[kind].cost ?? 0) + L.reserve) h.run({ type: 'produce', id: b.id, unit: kind });
  }
  // defence: anything hostile among our buildings brings everyone not on a raid home
  const near = foes.filter((f) => !f.kind && s.buildings.some((b) => dist(b, f) < (def(b)?.clearance ?? 8) / 2 + 28));
  const raid = new Set(brain.attack);
  if (near.length) {
    const c = centroid(near);
    const home = mine.filter((u) => !raid.has(u.id) && orderedFar(u, c, 12));
    if (home.length) h.run({ type: 'order', ids: home.map((u) => u.id), x: c.x, z: c.z });
    // a raid that's barely started comes back for a big attack on the base
    if (near.length >= 4 && brain.attack.length && brain.launched > secs - 25) {
      h.run({ type: 'order', ids: brain.attack, x: c.x, z: c.z });
      brain.attack = [];
    }
    return;
  }
  // a raid on its way
  if (brain.attack.length) {
    const target = P[brain.target];
    if (!target || target.out) {
      const next = nearestEnemy(h);
      if (next < 0) { brain.attack = []; return; }
      brain.target = next;
    }
    const goal = P[brain.target].home;
    const group = brain.attack.map((id) => byId.get(id)!).filter(Boolean);
    // broken (under a third left): fall back to the rally point and build up again
    if (group.length < Math.max(2, brain.size * 0.33)) {
      h.run({ type: 'order', ids: brain.attack, x: rally.x, z: rally.z });
      brain.attack = [];
      return;
    }
    // stragglers that stopped short (nothing in sight where they stand): on to the Core
    const idle = group.filter((u) => u.order.kind === 'idle' && u.target < 0);
    if (idle.length) h.run({ type: 'order', ids: idle.map((u) => u.id), x: goal.x, z: goal.z });
    // new units join the raid once there are a few of them (not one at a time across the map)
    const fresh = mine.filter((u) => !raid.has(u.id));
    if (fresh.length >= 4) {
      for (const u of fresh) brain.attack.push(u.id);
      brain.size += fresh.length;
      h.run({ type: 'order', ids: fresh.map((u) => u.id), x: goal.x, z: goal.z });
    }
    return;
  }
  // gathering: new units go to the rally point; a big enough group sets off
  const loose = mine.filter((u) => orderedFar(u, rally, 18));
  if (loose.length) h.run({ type: 'order', ids: loose.map((u) => u.id), x: rally.x, z: rally.z });
  const size = Math.min(L.waveMax, L.waveBase + brain.wave * L.waveGrow, Math.max(4, h.unitCap() - 4));
  if (secs >= L.firstAttack && mine.length >= size) {
    const t = nearestEnemy(h);
    if (t < 0) return;
    brain.target = t;
    brain.attack = mine.map((u) => u.id);
    brain.size = mine.length;
    brain.launched = secs;
    brain.wave++;
    const goal = P[t].home;
    h.run({ type: 'order', ids: brain.attack, x: goal.x, z: goal.z });
  }
}

/** What a factory should make next: early on cheap and quick, later heavier, anti-air if the enemy flies. */
function pickUnit(h: AiHost, f: Building, brain: AiBrain, flyers: boolean, armySize: number) {
  const fd = def(f);
  const ok = (k: string) => UNITS[k] && UNITS[k].faction === 'accord' && UNITS[k].cost !== undefined && factoryMakes(fd, UNITS[k]) && h.researched(UNITS[k].research) && (UNITS[k].damage ?? 0) > 0;
  const mix: [string, number][] = brain.wave === 0 && armySize < 6
    ? [['rover', 1], ['tank', 3]]
    : [['tank', 4], ['lancer', 3], ['rover', 2], ['artillery', 1], ['arc', flyers ? 4 : 1]];
  const pool = mix.filter(([k]) => ok(k));
  if (!pool.length) return null;
  const total = pool.reduce((m, [, w]) => m + w, 0);
  // a steady rotation through the mix (deterministic)
  let r = (armySize * 7 + h.s.tick) % total;
  for (const [k, w] of pool) { if (r < w) return k; r -= w; }
  return pool[0][0];
}

/** The nearest player on another side still in the game (by where they started), or -1. */
function nearestEnemy(h: AiHost) {
  const P = h.s.players!, me = P[h.team];
  let best = -1, bd = Infinity;
  P.forEach((p, i) => {
    if (i === h.team || p.out || p.side === me.side) return;
    const d = dist(p.home, me.home);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

const centroid = (a: { x: number; z: number }[]) => ({ x: a.reduce((m, p) => m + p.x, 0) / a.length, z: a.reduce((m, p) => m + p.z, 0) / a.length });
/** Not already standing at, or on its way to, within r of p. */
function orderedFar(u: Unit, p: { x: number; z: number }, r: number) {
  const o = u.order.kind === 'move' ? u.order : { x: u.x, z: u.z };
  return Math.hypot(o.x - p.x, o.z - p.z) > r;
}
