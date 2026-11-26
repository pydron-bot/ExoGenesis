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
  hard: { period: 12, drones: 4, turrets: 2, firstAttack: 330, waveBase: 10, waveGrow: 3, waveMax: 30, tech: true, bays: 2, reserve: 30, bonus: 0.5, relays: 3 },
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
  /** In this player's sight now. */
  visible(x: number, z: number): boolean;
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
  return { wave: 0, attack: [], target: -1, launched: 0, size: 0, rally: null, raid: [], known: {}, armies: {} };
}

export function think(h: AiHost, level: Level) {
  const L = LEVELS[level], s = h.s, P = s.players!, me = P[h.team];
  const brain = (me.brain ??= freshBrain());
  // a Domination battle: nothing to build, just fight
  if (s.skirmish?.battle) { battle(h); if (level !== 'easy') abilities(h); return; }
  if (L.bonus) s.alloys += (L.bonus * L.period) / 10;
  const home = me.home;
  // toward the middle of the map, and away from it (the safe side)
  const inA = Math.atan2(-home.z, -home.x);
  economy(h, L, inA);
  army(h, L, level, brain, inA);
  if (level !== 'easy' && !(globalThis as { exoNoAbilities?: boolean }).exoNoAbilities) abilities(h);
}

/**
 * Unit abilities (UnitDef.ability), each when it pays: guns in a fight fire theirs (a tank digs in only
 * standing), a discharge with three or more in reach (or a flyer), a shield or repairs when friends
 * near it are hurt, a speed boost on a long drive.
 */
function abilities(h: AiHost) {
  const s = h.s, ids: number[] = [];
  let foes: ReturnType<AiHost['foes']> | null = null;
  const all = () => (foes ??= h.foes());
  const near = (u: Unit, r: number) => all().filter((f) => f.hp > 0 && dist(f, u) <= r);
  const home = s.players![h.team].home;
  for (const u of s.units ?? []) {
    const d = UNITS[u.unit];
    if (!d?.ability || (u.ab ?? 0) > 0 || u.ride !== undefined) continue;
    const r = d.abilityRadius ?? 0;
    const hurt = (k: number) => (s.units ?? []).some((o) => o !== u && dist(o, u) <= r && o.hp < UNITS[o.unit].hp * k);
    let go = false;
    switch (d.ability) {
      case 'overdrive': case 'charge': go = u.target >= 0; break;
      // dig in against guns (out on the attack), where the reach counts
      case 'siege': go = u.target >= 0 && u.order.kind === 'idle' && dist(u, home) > 70 && !!all().find((f) => f.id === u.target)?.kind; break;
      case 'pulse': { const n = near(u, r); go = n.length >= 3 || n.some((f) => f.unit && UNITS[f.unit]?.move === 'air'); break; }
      case 'shield': go = u.target >= 0 || (near(u, r + 12).length > 0 && hurt(0.8)); break;
      case 'mend': go = hurt(0.6); break;
      case 'boost': go = u.order.kind === 'move' && Math.hypot(u.order.x - u.x, u.order.z - u.z) > 50; break;
    }
    if (go) ids.push(u.id);
  }
  if (ids.length) h.run({ type: 'ability', ids });
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
  // a Matter Printer on spare power: one late on, two once the deposits in reach are nearly mined out
  const pd = DEFS.printer;
  if (pd && h.researched(pd.research) && (s.isotopes ?? 0) >= (pd.isotopes ?? 0)) {
    const inReach = s.deposits.filter((d) => depots.some((b) => dist(b, d) <= (DEFS.depot.range ?? 30))).reduce((m, d) => m + d.alloys, 0);
    const wantPrinters = inReach < 2500 ? 2 : secs > 900 ? 1 : 0;
    if (have('printer') < wantPrinters) return { kind: 'printer' };
  }
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
/** A unit's or gun's fighting weight: damage a second and hit points (strength in a fight goes as their product). */
const dps = (d: { damage?: number; cooldown?: number }) => (d.damage ?? 0) / Math.max(0.1, d.cooldown ?? 1);
/** Lanchester-style strength of a force: √(total dps × total hp). */
function strength(parts: { dps: number; hp: number }[]) {
  let a = 0, b = 0;
  for (const p of parts) { a += p.dps; b += p.hp; }
  return Math.sqrt(a * b);
}
const unitPart = (u: { unit?: string; hp?: number }) => { const d = UNITS[u.unit ?? '']; return d ? { dps: dps(d), hp: u.hp ?? d.hp } : { dps: 0, hp: 0 }; };
/** How sure of winning before setting off, by level (ours ÷ theirs). */
const NERVE: Record<Level, number> = { easy: 1.6, normal: 1.3, hard: 1.15 };

/** Update what this player knows: enemy buildings seen (forgotten once seen gone), enemy armies seen. */
function remember(h: AiHost, brain: AiBrain, foes: ReturnType<AiHost['foes']>) {
  const known = (brain.known ??= {});
  const now = h.secs;
  for (const f of foes) {
    if (f.kind) known[f.id] = { kind: f.kind, x: f.x, z: f.z, team: f.team ?? 0, hp: f.hp }; // (unset team: player 0)
  }
  const seen = new Set(foes.map((f) => f.id));
  for (const [id, k] of Object.entries(known)) if (!seen.has(Number(id)) && h.visible(k.x, k.z)) delete known[Number(id)];
  // the biggest enemy army seen lately, per player (decays after two minutes)
  const armies = (brain.armies ??= {});
  const by: Record<number, { dps: number; hp: number }[]> = {};
  for (const f of foes) if (f.unit && f.pack === undefined) (by[f.team ?? 0] ??= []).push(unitPart(f)); // (fauna have a pack)
  for (const [t, parts] of Object.entries(by)) {
    const st = strength(parts), a = armies[Number(t)];
    if (!a || st >= a.st || now - a.at > 120) armies[Number(t)] = { st, at: now };
  }
}

/**
 * What defends a point, as far as this player knows: guns seen there, and that player's army: as strong as the
 * strongest seen lately, grown since (a third more for every 100 s), or never seen: as strong as ours (`ours`).
 */
function defence(brain: AiBrain, team: number, at: { x: number; z: number }, now: number, ours: number) {
  const parts: { dps: number; hp: number }[] = [];
  for (const k of Object.values(brain.known ?? {})) {
    if (k.team !== team) continue;
    const d = DEFS[k.kind];
    if (d?.fireRange && d.damage && dist(k, at) < 70) parts.push({ dps: dps(d), hp: k.hp });
  }
  const guns = strength(parts), a = brain.armies?.[team];
  const army = a ? a.st * (1 + Math.max(0, now - a.at) / 300) : ours;
  return Math.sqrt(guns * guns + army * army);
}

/** Known guns of a player near a point: where they are and how far they reach. */
const gunsNear = (brain: AiBrain, team: number, at: { x: number; z: number }, r: number) =>
  Object.values(brain.known ?? {}).filter((k) => k.team === team && DEFS[k.kind]?.fireRange && DEFS[k.kind]?.damage && dist(k, at) < r);

function army(h: AiHost, L: LevelRules, level: Level, brain: AiBrain, inA: number) {
  const s = h.s, P = s.players!, me = P[h.team], home = me.home, secs = h.secs;
  const mine = (s.units ?? []).filter(fighter);
  const byId = new Map(mine.map((u) => [u.id, u]));
  brain.attack = brain.attack.filter((id) => byId.has(id));
  brain.raid = (brain.raid ?? []).filter((id) => byId.has(id));
  if (brain.scout !== undefined && brain.scout >= 0 && !byId.has(brain.scout)) brain.scout = -2; // lost: done scouting
  const rally = brain.rally ?? (brain.rally = { x: home.x + Math.cos(inA) * 30, z: home.z + Math.sin(inA) * 30 });
  const foes = h.foes();
  remember(h, brain, foes);
  const busy = new Set([...brain.attack, ...brain.raid, ...(brain.scout !== undefined && brain.scout >= 0 ? [brain.scout] : [])]);

  // ---- production: keep the factories busy (saving the reserve for buildings), answering what the enemy has
  for (const b of s.buildings) {
    if (def(b)?.role !== 'factory' || b.progress < 1 || (b.queue?.length ?? 0) >= 2) continue;
    if (h.armySize() + s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0) >= h.unitCap()) break;
    const kind = pickUnit(h, b, brain, foes, mine.length);
    if (kind && s.alloys >= (UNITS[kind].cost ?? 0) + L.reserve) h.run({ type: 'produce', id: b.id, unit: kind });
  }

  // ---- scouting: the first unit, and again whenever what it knows of the enemy is old, goes to look at the
  // nearest enemy's base, then comes home
  const st0 = nearestEnemy(h), seen = st0 >= 0 ? brain.armies?.[st0] : undefined;
  if (brain.scout === -2 && (!seen || secs - seen.at > 150) && mine.length >= 3 && !brain.attack.length) brain.scout = undefined;
  if (brain.scout === undefined && mine.length) {
    const t = nearestEnemy(h);
    const free = mine.filter((u) => !brain.attack.includes(u.id) && !(brain.raid ?? []).includes(u.id));
    const u = (free.length ? free : mine).reduce((a, b) => (UNITS[b.unit].speed > UNITS[a.unit].speed ? b : a));
    if (t >= 0) { brain.scout = u.id; h.run({ type: 'order', ids: [u.id], x: P[t].home.x, z: P[t].home.z }); }
  } else if (brain.scout !== undefined && brain.scout >= 0) {
    const u = byId.get(brain.scout)!, t = nearestEnemy(h);
    const there = t >= 0 && dist(u, P[t].home) < 40;
    // looked and saw no army there (remember() would have just noted one): that's worth knowing too
    if (there) { const a = (brain.armies ??= {})[t]; if (!a || secs - a.at > 5) brain.armies[t] = { st: 0, at: secs }; }
    if (there || u.order.kind === 'idle') { h.run({ type: 'order', ids: [u.id], x: rally.x, z: rally.z }); brain.scout = -2; }
  }

  // ---- defence: enemies among our buildings; answer with enough (everyone if it's a real attack)
  const near = foes.filter((f) => !f.kind && s.buildings.some((b) => dist(b, f) < (def(b)?.clearance ?? 8) / 2 + 28));
  if (near.length) {
    const c = centroid(near);
    const threat = strength(near.map(unitPart));
    const free = mine.filter((u) => !busy.has(u.id)).sort((a, b) => dist(a, c) - dist(b, c));
    const send: Unit[] = [];
    let st = 0;
    for (const u of free) { if (st > threat * 1.5 + 1) break; send.push(u); st = strength(send.map(unitPart)); }
    const go = send.filter((u) => orderedFar(u, c, 12));
    if (go.length) h.run({ type: 'order', ids: go.map((u) => u.id), x: c.x, z: c.z });
    // a big attack on the base while the army's still gathering or just left: everyone comes back
    if (threat > st && brain.attack.length && (brain.phase === 'gather' || brain.launched > secs - 30)) {
      h.run({ type: 'order', ids: brain.attack, x: c.x, z: c.z });
      brain.attack = [];
    }
  }

  // ---- raiding party (normal, hard): a few fast units after a depot with no guns by it
  if (level !== 'easy') raid(h, brain, byId, busy, mine, rally);

  // ---- the main army
  if (brain.attack.length) { push(h, brain, byId, mine, rally, busy); return; }
  // gathering at the rally point
  const loose = mine.filter((u) => !busy.has(u.id) && orderedFar(u, rally, 18) && !near.length);
  if (loose.length) h.run({ type: 'order', ids: loose.map((u) => u.id), x: rally.x, z: rally.z });
  if (secs < L.firstAttack) return;
  const t = nearestEnemy(h);
  if (t < 0) return;
  const army = mine.filter((u) => !busy.has(u.id));
  const ours = strength(army.map(unitPart));
  const theirs = defence(brain, t, P[t].home, secs, ours);
  const minimum = Math.min(L.waveBase + brain.wave * L.waveGrow, L.waveMax);
  const full = h.armySize() >= h.unitCap() - 2;
  // go when the army's big enough and (as far as it knows) strong enough, or when it can't grow any more
  if (army.length >= Math.max(4, minimum * 0.6) && (ours >= theirs * NERVE[level] && army.length >= minimum * 0.75 || full || army.length >= minimum * 1.6)) {
    brain.target = t;
    brain.attack = army.map((u) => u.id);
    brain.size = army.length;
    brain.launched = secs;
    brain.wave++;
    // form up short of the target first (out of its known guns' reach), then go in together
    const goal = P[t].home, back = Math.atan2(home.z - goal.z, home.x - goal.x);
    const reach = Math.max(30, ...gunsNear(brain, t, goal, 80).map((k) => DEFS[k.kind].fireRange! + dist(k, goal)));
    const stage = { x: goal.x + Math.cos(back) * Math.min(reach + 12, dist(goal, home) * 0.6), z: goal.z + Math.sin(back) * Math.min(reach + 12, dist(goal, home) * 0.6) };
    brain.stage = stage;
    brain.phase = 'gather';
    h.run({ type: 'order', ids: brain.attack, x: stage.x, z: stage.z });
  }
}

/** The main army on a raid: form up at the staging point, then push in (artillery holds back and shells the guns). */
function push(h: AiHost, brain: AiBrain, byId: Map<number, Unit>, mine: Unit[], rally: { x: number; z: number }, busy: Set<number>) {
  const P = h.s.players!, secs = h.secs;
  if (!P[brain.target] || P[brain.target].out) {
    const next = nearestEnemy(h);
    if (next < 0) { brain.attack = []; return; }
    brain.target = next;
    brain.phase = 'push';
  }
  const goal = P[brain.target].home;
  const group = brain.attack.map((id) => byId.get(id)!).filter(Boolean);
  // broken (under a third left): fall back and build up again
  if (group.length < Math.max(2, brain.size * 0.33)) {
    h.run({ type: 'order', ids: brain.attack, x: rally.x, z: rally.z });
    brain.attack = [];
    return;
  }
  if (brain.phase === 'gather') {
    const st = brain.stage ?? goal;
    const there = group.filter((u) => dist(u, st) < 16).length;
    // most of them there (or waited long enough): in together
    if (there >= group.length * 0.8 || secs - brain.launched > 75) {
      brain.phase = 'push';
      const art = group.filter((u) => (UNITS[u.unit].range ?? 0) >= 40);
      const rest = group.filter((u) => !art.includes(u));
      if (rest.length) h.run({ type: 'order', ids: rest.map((u) => u.id), x: goal.x, z: goal.z });
      siege(h, brain, art, goal);
    }
    return;
  }
  // pushing: artillery keeps to its siege line; anyone who stopped short goes on to the Core
  const art = group.filter((u) => (UNITS[u.unit].range ?? 0) >= 40);
  if (art.length && secs % 10 < 3) siege(h, brain, art, goal);
  const idle = group.filter((u) => !art.includes(u) && u.order.kind === 'idle' && u.target < 0);
  if (idle.length) h.run({ type: 'order', ids: idle.map((u) => u.id), x: goal.x, z: goal.z });
  // reinforcements join in fours, going straight in
  const fresh = mine.filter((u) => !busy.has(u.id) && dist(u, rally) < 30);
  if (fresh.length >= 4) {
    for (const u of fresh) brain.attack.push(u.id);
    brain.size += fresh.length;
    h.run({ type: 'order', ids: fresh.map((u) => u.id), x: goal.x, z: goal.z });
  }
}

/** Artillery: to just inside its reach of the nearest known gun (outside the gun's, if it can), or in with the rest. */
function siege(h: AiHost, brain: AiBrain, art: Unit[], goal: { x: number; z: number }) {
  if (!art.length) return;
  const c = centroid(art);
  const guns = gunsNear(brain, brain.target, goal, 90).sort((a, b) => dist(a, c) - dist(b, c));
  const g = guns[0] ?? { x: goal.x, z: goal.z };
  const reach = (UNITS[art[0].unit].range ?? 40) - 3;
  const a = Math.atan2(c.z - g.z, c.x - g.x);
  const at = { x: g.x + Math.cos(a) * reach, z: g.z + Math.sin(a) * reach };
  const go = art.filter((u) => orderedFar(u, at, 6));
  if (go.length) h.run({ type: 'order', ids: go.map((u) => u.id), x: at.x, z: at.z });
}

/** A raiding party: three or four of the fastest after the nearest known enemy depot with no gun covering it. */
function raid(h: AiHost, brain: AiBrain, byId: Map<number, Unit>, busy: Set<number>, mine: Unit[], rally: { x: number; z: number }) {
  const home = h.s.players![h.team].home;
  const known = Object.entries(brain.known ?? {}).map(([id, k]) => ({ id: Number(id), ...k }));
  const exposed = (k: { team: number; x: number; z: number }) => !known.some((g) => g.team === k.team && DEFS[g.kind]?.fireRange && DEFS[g.kind]?.damage && dist(g, k) < (DEFS[g.kind].fireRange ?? 0) + 6);
  const target = known.filter((k) => (DEFS[k.kind]?.role === 'depot' || DEFS[k.kind]?.role === 'deepmine' || DEFS[k.kind]?.role === 'printer') && exposed(k))
    .sort((a, b) => dist(a, home) - dist(b, home))[0];
  const party = brain.raid!.map((id) => byId.get(id)!).filter(Boolean);
  if (!party.length) {
    if (!target || h.secs < 240) return;
    const fast = mine.filter((u) => !busy.has(u.id) && UNITS[u.unit].speed >= 7).sort((a, b) => dist(a, rally) - dist(b, rally)).slice(0, 4);
    // only with enough left at home to hold it
    if (fast.length < 3 || mine.filter((u) => !busy.has(u.id)).length - fast.length < 6) return;
    brain.raid = fast.map((u) => u.id);
    for (const u of fast) busy.add(u.id);
    h.run({ type: 'order', ids: brain.raid, x: target.x, z: target.z });
    return;
  }
  for (const u of party) busy.add(u.id);
  // down to one, or nothing left to hit: home to the army
  if (party.length < 2 || !target) { h.run({ type: 'order', ids: brain.raid!, x: rally.x, z: rally.z }); brain.raid = []; return; }
  const idle = party.filter((u) => u.order.kind === 'idle' && u.target < 0);
  if (idle.length) h.run({ type: 'order', ids: idle.map((u) => u.id), x: target.x, z: target.z });
}

/**
 * What a factory should make next: early on cheap and quick (and fast ones for raiding), later heavier, shaped by
 * what it has seen: artillery and lancers against a lot of guns, lancers against heavy armour, arcs against flyers.
 */
function pickUnit(h: AiHost, f: Building, brain: AiBrain, foes: ReturnType<AiHost['foes']>, armySize: number) {
  const fd = def(f);
  const ok = (k: string) => UNITS[k] && UNITS[k].faction === 'accord' && UNITS[k].cost !== undefined && factoryMakes(fd, UNITS[k]) && h.researched(UNITS[k].research) && (UNITS[k].damage ?? 0) > 0;
  const known = Object.values(brain.known ?? {});
  const guns = known.filter((k) => DEFS[k.kind]?.fireRange && DEFS[k.kind]?.damage).length;
  const flyers = foes.some((f2) => f2.unit && UNITS[f2.unit]?.move === 'air');
  const heavy = foes.filter((f2) => f2.unit && (UNITS[f2.unit]?.hp ?? 0) >= 400).length;
  const fastOnes = (h.s.units ?? []).filter((u) => UNITS[u.unit]?.speed >= 7).length;
  const mix: [string, number][] = brain.wave === 0 && armySize < 6
    ? [['rover', 1], ['tank', 3]]
    : [['tank', 4], ['lancer', 2 + Math.min(4, heavy)], ['rover', fastOnes < 4 ? 3 : 1], ['artillery', 1 + Math.min(4, guns)], ['arc', flyers ? 5 : 1]];
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

/**
 * A Domination battle (src/sim/dom-battle.ts): an attacker (no Core) sends everything at the Core of the area's holder
 * (or, with no holder left, at whatever enemy it can see); the holder keeps its army by its Core and goes for anything
 * that comes within reach of it.
 */
function battle(h: AiHost) {
  const s = h.s, P = s.players!, me = P[h.team], home = me.home;
  const mine = (s.units ?? []).filter(fighter);
  if (!mine.length) return;
  // other players' units and buildings (player 0's carry no team; fauna have neither a unit nor a kind)
  const foes = h.foes().filter((f) => (f.unit || f.kind) && f.pack === undefined && P[f.team ?? 0] && (f.team ?? 0) !== h.team && P[f.team ?? 0].side !== me.side && !P[f.team ?? 0].out);
  if (me.coreless) {
    const holder = P.findIndex((p, i) => i !== h.team && !p.out && !p.coreless && p.side !== me.side);
    const goal = holder >= 0 ? P[holder].home : foes.length ? centroid(foes) : null;
    if (!goal) return;
    const go = mine.filter((u) => u.target < 0 && orderedFar(u, goal, 10));
    if (go.length) h.run({ type: 'order', ids: go.map((u) => u.id), x: goal.x, z: goal.z });
    return;
  }
  const near = foes.filter((f) => dist(f, home) < 75);
  if (near.length) {
    const c = centroid(near.slice().sort((a, b) => dist(a, home) - dist(b, home)).slice(0, 6));
    const go = mine.filter((u) => u.target < 0 && orderedFar(u, c, 8));
    if (go.length) h.run({ type: 'order', ids: go.map((u) => u.id), x: c.x, z: c.z });
    return;
  }
  const inA = Math.atan2(-home.z, -home.x);
  const post = { x: home.x + Math.cos(inA) * 24, z: home.z + Math.sin(inA) * 24 };
  const back = mine.filter((u) => u.target < 0 && dist(u, home) > 45);
  if (back.length) h.run({ type: 'order', ids: back.map((u) => u.id), x: post.x, z: post.z });
}
