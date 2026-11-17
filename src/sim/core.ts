/**
 * The colony simulation: pure logic over SimState, no worker or DOM. The worker
 * (sim/worker.ts) runs it at a fixed tick; tools/balance.mjs runs it headless.
 *
 * One tick: power → drones → fabrication + factories → mining → turrets →
 * repair pads → combat units → predators → waves → cryo bank → people
 * (src/sim/people.ts) → grazers.
 */
import { content } from '../content';
import type { BuildingDef, RegionDef, UnitDef, Weapon } from '../content/defs';
import { F, FX, STRIDE, unitType } from '../skirmish/types';
import { regionHeightRaw, setRegionTerrain } from '../world/planet';
import { daylight } from './daylight';
import { PathGrid } from './path';
import { Inhabitants, campSites } from './inhabitants';
import { People } from './people';
import { Story } from './story';
import type { Colonist } from './people-types';
import { compass, depositFor, gateSnap, isBarrier, linePoints, placeProblem, wallsUnderGate, type PlaceWorld } from './rules';
import {
  FOG_CELL, FOG_N, MAX_HOSTILES, REGION_HALF, TICK_HZ,
  type Building, type Command, type EventCue, type Drone, type DroneSnap, type Hostile, type SimState, type Snapshot, type Unit, type UnitSnap,
} from './types';

const RULES = content.colony;
const THREATS = content.threats;
const DEFS = content.buildings;
let REGION_ID = 'touchdown';
let REGION: RegionDef = content.regions.touchdown;
let VENTS: NonNullable<RegionDef['vents']> = [];
/**
 * Pick the region the sim plays on (content/regions/<id>.json); unknown ids fall
 * back to Touchdown; `draft` plays an unsaved editor version instead. Call before
 * creating a Sim: the path grid reads the terrain.
 */
export function useRegion(id: string, draft?: RegionDef) {
  REGION_ID = draft || content.regions[id] ? id : 'touchdown';
  REGION = draft ?? content.regions[REGION_ID];
  VENTS = REGION.vents ?? [];
  setRegionTerrain(REGION);
  return REGION_ID;
}
useRegion('touchdown');
/** The region's own difficulty, falling back to the threat rules. */
const packScale = () => REGION.packScale ?? 1;
const graceSeconds = () => REGION.graceSeconds ?? THREATS.graceSeconds;
const waveInterval = () => REGION.waveInterval ?? THREATS.waveInterval;

const DT = 1 / TICK_HZ;
const WALK = 2.2;
const RUN = 7.5;
const FLEE_R = 14;
const CORE_KEEP_OUT = 24;
const LIMIT = REGION_HALF - 6;
const PANIC_R = 115;
const DRONE_REACH = 5;
/** Shooters with nothing in range draw this fraction of their power. */
const STANDBY = 0.15;
/** Drones not under orders back away from predators this close, and won't auto-task near them. */
const DRONE_FEAR = 10;
const HOT_ZONE = 18;
/** Idle combat units drop a chase once the target is this many aggro radii from their guard post. */
const LEASH = 1.8;
/** Spacing between units sent to the same point. */
const SPREAD = 3.4;
/** Path grid keeps units this far from building bodies (the biggest unit radius). */
const PATH_PAD = 1.4;
/** Re-plan a followed path this often (ticks), so chases and new buildings are picked up. */
const REPATH = 20;
/** A unit that hasn't got closer to its goal for this many ticks re-plans, then gives up. */
const STALL = 30;
/** Predators treat walls as this much farther away when picking a target (they'd rather get past them). */
const WALL_PENALTY = 14;
/** Half the thickness of a wall segment, for collisions. */
const WALL_HALF = 0.8;

/** A wall segment's ends (it runs along its yaw, one clearance long, overlapping its neighbours a little). */
function wallEnds(b: Building) {
  const half = DEFS[b.kind].clearance / 2 + 0.15, yaw = b.yaw ?? 0;
  const ux = Math.sin(yaw), uz = Math.cos(yaw);
  return { ax: b.x - ux * half, az: b.z - uz * half, bx: b.x + ux * half, bz: b.z + uz * half };
}

/** Do segments p→q and a→b cross? */
function crosses(px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number) {
  const o = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) => Math.sign((x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1));
  return o(px, pz, qx, qz, ax, az) !== o(px, pz, qx, qz, bx, bz) && o(ax, az, bx, bz, px, pz) !== o(ax, az, bx, bz, qx, qz);
}

export type Level = 'info' | 'warn' | 'bad';
export type EventSink = (text: string, level: Level, cue?: EventCue) => void;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const def = (b: Building): BuildingDef => DEFS[b.kind];
const bodyR = (b: Building) => def(b).clearance / 2;
const maxHp = (b: Building) => def(b).hp;
/** Walls and gates: predators collide with them and chew through; gates let units by. */
const barrier = (b: Building) => isBarrier(def(b).role);
/** Each chain jump does this fraction of the previous hit. */
const CHAIN_FALLOFF = 0.7;
/** Burrowers surface this far (beyond their reach) from their target. */
const SURFACE_AT = 3;

/** Default attack look for a unit record. */
export function unitWeapon(d: UnitDef): Weapon {
  return d.weapon ?? (d.faction === 'accord' ? (d.splash ? 'cannon' : 'bolt') : d.range > 4 ? 'spit' : 'bite');
}
/** Tracer/sound effect for a weapon; building cannons sound like turrets. */
function weaponFx(w: Weapon, building: boolean): number {
  switch (w) {
    case 'bolt': return FX.ROVER_SHOT;
    case 'cannon': return building ? FX.TURRET_SHOT : FX.TANK_SHOT;
    case 'shell': return FX.SHELL;
    case 'arc': return FX.ARC;
    case 'pd': return FX.PD_SHOT;
    case 'spit': return FX.SPIT;
    default: return FX.BITE;
  }
}
const dieFx = (radius: number) => (radius >= 1.2 ? FX.DIE_BIG : FX.DIE_SMALL);
/** Fauna that join packs on their own (packEvery), in id order so runs are reproducible. */
const PACK_EXTRAS = Object.entries(content.units)
  .filter(([id, u]) => u.faction === 'fauna' && (u.packEvery ?? 0) > 0 && id !== 'swarmer')
  .sort(([a], [b]) => a.localeCompare(b));

export class Sim {
  s!: SimState;
  private fx: number[] = [];
  private grid = new PathGrid(LIMIT);
  /** Fog of war: in sight now / ever seen (mirrored into s.explored for saves). */
  private vis = new Uint8Array(FOG_N * FOG_N);
  private exp = new Uint8Array(FOG_N * FOG_N);
  private slotsUsed = 0;
  /** Tick of the last "burrower surfaced" warning (so a pack doesn't spam it). */
  private lastEmerge = -1e9;
  /** Power result of the last tick. */
  power = { gen: 0, draw: 0, short: 0, storageMax: 0, daylight: 1 };

  /** Colonists, embryos, pods, food and Trust. */
  readonly people: People = new People(this);
  /** Inhabitant camps: regard, first contact, trust. */
  readonly inhabitants: Inhabitants = new Inhabitants(this);
  /** Story events: triggers, cards, effects. */
  readonly story: Story = new Story(this, () => ({ id: REGION_ID, sites: REGION.sites ?? [] }));

  constructor(readonly emit: EventSink, seed = 1337) {
    this.newGame(seed);
  }

  // ---------- setup ----------
  newGame(seed: number) {
    const s: SimState = {
      version: 2, region: REGION_ID, seed, rng: seed, tick: 0, nextId: 2, alloys: REGION.startAlloys ?? RULES.startAlloys, cryo: 100, cryoWarn: 100, stored: 0,
      drones: [], buildings: [], herds: [], fauna: [], hostiles: [], units: [], packs: [],
      deposits: (REGION.deposits ?? []).map((d) => ({ x: d.x, z: d.z, alloys: d.alloys, max: d.alloys })),
      waves: { n: 0, next: Math.round(graceSeconds() * TICK_HZ), spawned: 0 },
      fab: { queued: 0, progress: 0 },
      phase: 'descent', panic: 0, over: null,
      stats: { kills: 0, buildingsLost: 0, dronesLost: 0, packsBeaten: 0, mined: 0, unitsLost: 0 },
    };
    this.s = s;
    this.people.init();
    this.inhabitants.init(REGION.camps ?? []);
    this.story.init();
    s.buildings.push({ id: 1, kind: 'core', x: 0, z: 0, progress: 1, hp: DEFS.core.hp, on: true, powered: true });
    s.drones.push({ id: s.nextId++, x: 0, z: -14, heading: Math.PI, hp: RULES.droneHp, task: { kind: 'idle' } });
    // herds come from the region map (content/regions/<id>.json)
    REGION.herds.forEach((hd, herd) => {
      s.herds.push({ x: hd.x, z: hd.z });
      for (let i = 0; i < hd.grazers; i++) {
        const x = clamp(hd.x + (this.rnd() - 0.5) * 30, -LIMIT, LIMIT);
        const z = clamp(hd.z + (this.rnd() - 0.5) * 30, -LIMIT, LIMIT);
        s.fauna.push({ x, z, heading: this.rnd() * Math.PI * 2, tx: x, tz: z, herd });
      }
    });
    this.slotsUsed = 0;
    this.exp.fill(0);
    this.stepFog(true);
  }

  load(state: SimState) {
    // content may have changed since the save: drop things that no longer exist
    state.buildings = state.buildings.filter((b) => DEFS[b.kind] || b.kind === 'core');
    state.hostiles = state.hostiles.filter((h) => content.units[h.unit]);
    state.units = (state.units ?? []).filter((u) => content.units[u.unit]);
    state.stats.unitsLost ??= 0;
    for (const b of state.buildings) if (b.queue) b.queue = b.queue.filter((k) => content.units[k]);
    for (const b of state.buildings) b.hp = Math.min(b.hp, DEFS[b.kind]?.hp ?? b.hp);
    this.s = state;
    this.people.load();
    this.inhabitants.load(REGION.camps ?? []);
    this.story.load();
    if (this.s.phase !== 'deployed') { this.s.phase = 'deployed'; this.s.panic = 0; }
    this.slotsUsed = [...state.hostiles, ...state.units].reduce((m, h) => Math.max(m, h.slot + 1), 0);
    this.exp.fill(0);
    const ex = state.explored;
    if (ex?.length === this.exp.length) for (let i = 0; i < ex.length; i++) this.exp[i] = ex.charCodeAt(i) === 49 ? 1 : 0;
    this.stepFog(true);
  }

  rnd(): number {
    // mulberry32, state kept in the save so runs are reproducible
    let t = (this.s.rng = (this.s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get secs() { return this.s.tick / TICK_HZ; }
  get deployed() { return this.s.phase === 'deployed'; }
  get units(): Unit[] { return (this.s.units ??= []); }
  /** What placement rules see. */
  private get world(): PlaceWorld { return { buildings: this.s.buildings, deposits: this.s.deposits, vents: VENTS, campSites: campSites(this.s.camps ?? []) }; }
  private entity(id: number): Building | Drone | Unit | Colonist | undefined {
    return this.s.buildings.find((b) => b.id === id) ?? this.s.drones.find((d) => d.id === id) ?? this.units.find((u) => u.id === id) ?? this.people.colonist(id);
  }

  // ---------- tick ----------
  step() {
    const s = this.s;
    if (s.over) return;
    s.tick++;
    if (this.deployed) {
      this.stepPower();
      this.stepDrones();
      this.stepFab();
      this.stepFactories();
      this.stepMining();
      this.stepTurrets();
      this.stepRepairPads();
      this.stepUnits();
      this.stepHostiles();
      this.stepWaves();
      this.stepCryo();
      this.people.step();
      this.inhabitants.step();
      this.story.step();
    }
    if (s.tick % 5 === 0) this.stepFog();
    this.stepGrazers();
  }

  private solarFactor() {
    return RULES.nightSolar + (1 - RULES.nightSolar) * this.power.daylight;
  }

  /**
   * Power allocation, most protected first: shooters → cryo bank + drones →
   * radar → depots (and anything else). Each load takes live generation first,
   * then the battery, except depots, which only run on live generation (so
   * mining pauses at night unless there's surplus). What the cryo bank can't
   * get is `short`; spare generation charges the battery.
   */
  private stepPower() {
    const s = this.s;
    this.power.daylight = daylight(this.secs, RULES.solSeconds);
    let gen = 0, cap = 0;
    const loads: { b: Building | null; mw: number; rank: number; battery: boolean }[] = [];
    for (const b of s.buildings) {
      const d = def(b);
      b.powered = false;
      if (b.progress < 1 || !b.on) continue;
      if (d.role === 'battery') { cap += d.storage ?? 0; b.powered = true; }
      if (d.powerMW > 0) { gen += (d.role === 'solar' ? d.powerMW * this.solarFactor() : d.powerMW) * this.people.mult(b); b.powered = true; }
      else if (d.powerMW < 0) {
        // homes and growth pods share the cryo bank's priority; farms run with the radar
        const rank = d.fireRange ? 0 : d.role === 'civic' ? 1 : d.role === 'radar' || d.role === 'factory' || d.role === 'repair' || d.role === 'farm' ? 2 : 3;
        const idle = (d.fireRange && !b.engaged) || (d.role === 'factory' && !b.queue?.length) || (d.role === 'repair' && !b.engaged);
        loads.push({ b, mw: (-d.powerMW * (idle ? STANDBY : 1) + (d.role === 'civic' ? this.people.podDraw(b) : 0)) * this.people.powerDraw(), rank, battery: d.role !== 'depot' });
      } else b.powered = true;
    }
    const drones = s.drones.reduce((m, d) => m + (d.task.kind === 'idle' ? RULES.droneIdleDrawMW : RULES.droneBusyDrawMW), 0);
    const essential = RULES.cryoDrawMW + drones;
    loads.push({ b: null, mw: essential, rank: 1, battery: true });
    loads.sort((a, b) => a.rank - b.rank);
    s.stored = Math.min(s.stored, cap);
    let live = gen, bank = s.stored / DT, want = 0, short = 0;
    for (const l of loads) {
      want += l.mw;
      const fromLive = Math.min(live, l.mw);
      const fromBank = l.battery ? Math.min(bank, l.mw - fromLive) : 0;
      const got = fromLive + fromBank;
      if (l.b) {
        if (got < l.mw - 1e-6) continue; // not enough for this load: it stays off, takes nothing
        l.b.powered = true;
      } else short = l.mw - got; // the cryo bank takes whatever there is
      live -= fromLive;
      bank -= fromBank;
    }
    s.stored = Math.min(cap, bank * DT + live * DT);
    this.power.gen = gen;
    this.power.draw = want;
    this.power.short = Math.max(0, short);
    this.power.storageMax = cap;
  }

  /**
   * Cryo bank integrity is a thermal buffer: it falls while the bank is short of
   * power and recovers when it isn't. Below the people rules' safe level the
   * embryos themselves start dying (src/sim/people.ts).
   */
  private stepCryo() {
    const s = this.s;
    const short = this.power.short;
    if (short <= 0.001) {
      s.cryo = Math.min(100, s.cryo + RULES.cryoRecover * DT);
      if (s.cryo >= 100) s.cryoWarn = 100;
    } else {
      s.cryo = Math.max(0, s.cryo - short * RULES.cryoLossPerMW * DT);
      for (const th of [75, 50, 25, 0]) {
        if (s.cryo <= th && s.cryoWarn > th) {
          s.cryoWarn = th;
          const safe = content.people.cryoSafe;
          const text = th === 0 ? 'Cryo bank at 0%: the embryos are dying fast'
            : `Cryo bank integrity ${th}% — not enough power${th < safe ? ' · embryos are dying' : th - 25 < safe ? ' · embryos at risk below ' + safe + '%' : ''}`;
          this.emit(text, th < safe ? 'bad' : 'warn', 'alarm');
        }
      }
    }
    this.people.cryo(s.cryo);
  }

  // ---------- fog of war ----------
  /** Recompute what's in sight; anything newly seen joins the explored map. */
  private stepFog(force = false) {
    const s = this.s, vis = this.vis, exp = this.exp;
    vis.fill(0);
    const see = (x: number, z: number, r: number) => {
      const c = FOG_CELL, i0 = Math.max(0, Math.floor((x - r + REGION_HALF) / c)), i1 = Math.min(FOG_N - 1, Math.floor((x + r + REGION_HALF) / c));
      const j0 = Math.max(0, Math.floor((z - r + REGION_HALF) / c)), j1 = Math.min(FOG_N - 1, Math.floor((z + r + REGION_HALF) / c));
      for (let j = j0; j <= j1; j++) {
        const cz = -REGION_HALF + (j + 0.5) * c - z;
        for (let i = i0; i <= i1; i++) {
          const cx = -REGION_HALF + (i + 0.5) * c - x;
          if (cx * cx + cz * cz <= r * r) vis[j * FOG_N + i] = 1;
        }
      }
    };
    for (const b of s.buildings) {
      const d = def(b);
      see(b.x, b.z, b.progress < 1 ? bodyR(b) + 6 : d.sight ?? Math.max(RULES.buildingSight, (d.fireRange ?? 0) + 4));
    }
    for (const d of s.drones) see(d.x, d.z, RULES.droneSight);
    this.inhabitants.sight(see);
    for (const u of this.units) {
      const d = content.units[u.unit];
      see(u.x, u.z, d.sight ?? Math.max(d.aggro, d.range) + 8);
    }
    let grew = false;
    for (let i = 0; i < vis.length; i++) if (vis[i] && !exp[i]) { exp[i] = 1; grew = true; }
    if (grew || force || !s.explored) {
      let str = '';
      for (let i = 0; i < exp.length; i++) str += exp[i] ? '1' : '0';
      s.explored = str;
    }
  }

  /** Is region point (x, z) in sight right now? */
  visible(x: number, z: number) {
    const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
    return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && this.vis[j * FOG_N + i] === 1;
  }

  // ---------- drones ----------
  private approach(o: { x: number; z: number; heading: number }, tx: number, tz: number, sp: number, turn: number) {
    const dx = tx - o.x, dz = tz - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return 0;
    const want = Math.atan2(dx, dz);
    let dh = want - o.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    o.heading += clamp(dh, -turn * DT, turn * DT);
    const step = Math.min(d, sp * DT);
    o.x += (dx / d) * step;
    o.z += (dz / d) * step;
    return d - step;
  }

  /** Fly to within `reach` of a building's edge. True when there. */
  private reach(d: Drone, b: Building) {
    const dist = Math.hypot(b.x - d.x, b.z - d.z);
    const stop = bodyR(b) + DRONE_REACH - 1;
    if (dist <= stop + 0.5) return true;
    const k = (dist - stop) / dist;
    this.approach(d, d.x + (b.x - d.x) * k, d.z + (b.z - d.z) * k, RULES.droneSpeed, 7);
    return false;
  }

  private stepDrones() {
    const s = this.s;
    for (const d of s.drones) {
      const t = d.task;
      if (!d.manual) {
        // back off from predators; the task resumes once they're gone
        const h = this.nearestHostile(d.x, d.z);
        if (h && h.dist < DRONE_FEAR) {
          const k = 1 / Math.max(1e-3, h.dist);
          this.approach(d, d.x + (d.x - h.h.x) * k * 12, d.z + (d.z - h.h.z) * k * 12, RULES.droneSpeed, 9);
          continue;
        }
      }
      if (t.kind === 'move') {
        if (this.approach(d, t.x, t.z, RULES.droneSpeed, 7) < 0.2) { d.task = { kind: 'idle' }; d.manual = false; }
      } else if (t.kind === 'build') {
        const site = s.buildings.find((b) => b.id === t.siteId);
        if (!site || site.progress >= 1) { d.task = { kind: 'idle' }; d.manual = false; continue; }
        if (this.reach(d, site)) {
          d.heading += 1.5 * DT; // circle-scan while building
          const dd = def(site);
          const before = site.progress;
          site.progress = dd.buildSeconds > 0 ? Math.min(1, site.progress + (DT * this.people.droneWork()) / dd.buildSeconds) : 1;
          site.hp = Math.min(dd.hp, site.hp + (site.progress - before) * dd.hp * 0.9);
          if (site.progress >= 1) {
            site.hp = Math.max(site.hp, dd.hp * 0.999);
            this.emit(`${dd.name} online${dd.powerMW > 0 ? ` · +${dd.powerMW} MW${dd.role === 'solar' ? ' at noon' : ''}` : ''}`, 'info', 'online');
            d.task = { kind: 'idle' }; d.manual = false;
          }
        }
      } else if (t.kind === 'repair') {
        const b = s.buildings.find((x) => x.id === t.id);
        if (!b || b.hp >= maxHp(b) || b.progress < 1) { d.task = { kind: 'idle' }; d.manual = false; continue; }
        if (this.reach(d, b)) {
          d.heading += 1.5 * DT;
          const dd = def(b);
          const hp = Math.min(RULES.repairRate * this.people.droneWork() * DT, maxHp(b) - b.hp);
          const cost = (hp / dd.hp) * dd.cost * 0.5;
          if (s.alloys >= cost) { s.alloys -= cost; b.hp += hp; }
        }
      }
      if (d.task.kind === 'idle' && !d.manual) this.autoTask(d);
    }
  }

  private nearestHostile(x: number, z: number) {
    let best: Hostile | null = null, bd = Infinity;
    for (const h of this.s.hostiles) {
      if (h.under) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < bd) { bd = d; best = h; }
    }
    return best ? { h: best, dist: bd } : null;
  }

  private hot(b: Building) {
    const h = this.nearestHostile(b.x, b.z);
    return !!h && h.dist < HOT_ZONE + bodyR(b);
  }

  /** Idle drones help: unfinished sites first, then damaged buildings nearby; never into a fight. */
  private autoTask(d: Drone) {
    const s = this.s;
    let best: Building | null = null, bd = Infinity;
    for (const b of s.buildings) {
      if (b.progress >= 1 || this.hot(b)) continue;
      const dist = Math.hypot(b.x - d.x, b.z - d.z);
      if (dist < bd) { bd = dist; best = b; }
    }
    if (best) { d.task = { kind: 'build', siteId: best.id }; return; }
    for (const b of s.buildings) {
      if (b.progress < 1 || b.hp >= maxHp(b) * 0.98 || this.hot(b)) continue;
      const dist = Math.hypot(b.x - d.x, b.z - d.z);
      if (dist < 90 && dist < bd) { bd = dist; best = b; }
    }
    if (best && s.alloys > 1) d.task = { kind: 'repair', id: best.id };
  }

  private stepFab() {
    const s = this.s, f = s.fab;
    if (!s.drones.length && !f.queued) {
      f.queued = 1; f.progress = 0; f.free = true;
      this.emit('No worker drones left. The Core is fabricating a replacement.', 'warn', 'warning');
    }
    if (!f.queued) return;
    const core = s.buildings.find((b) => b.kind === 'core');
    if (!core) return;
    f.progress += DT / (RULES.droneBuildSeconds * (f.free ? 1.5 : 1));
    if (f.progress >= 1) {
      f.queued--; f.progress = 0; f.free = false;
      s.drones.push({ id: s.nextId++, x: core.x + 6, z: core.z - 12, heading: Math.PI, hp: RULES.droneHp, task: { kind: 'idle' } });
      this.emit(`Worker drone fabricated (${s.drones.length} active)`, 'info', 'droneReady');
    }
  }

  /** Vehicle bays work through their queue while powered; a finished unit rolls out the front. */
  private stepFactories() {
    const s = this.s;
    for (const b of s.buildings) {
      if (def(b).role !== 'factory' || b.progress < 1 || !b.queue?.length || !b.powered) continue;
      const ud = content.units[b.queue[0]];
      if (!ud) { b.queue.shift(); b.prod = 0; continue; }
      b.prod = Math.min(1, (b.prod ?? 0) + (DT * this.people.mult(b)) / Math.max(0.1, ud.buildSeconds ?? 10));
      if (b.prod < 1) continue;
      const slot = this.freeSlot();
      if (slot < 0) continue; // render pool full: hold the unit until one frees up
      const kind = b.queue.shift()!;
      b.prod = 0;
      // the door faces away from the bay's yaw (local −Z)
      const yaw = b.yaw ?? 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const out = bodyR(b) + 3;
      const n = this.units.length;
      const side = Math.sin(n * 2.4) * 4, ahead = out + 5 + Math.cos(n * 2.4) * 3;
      const gx = b.x + fx * ahead + fz * side, gz = b.z + fz * ahead - fx * side;
      this.units.push({
        id: s.nextId++, unit: kind, slot, x: b.x + fx * out, z: b.z + fz * out, heading: yaw + Math.PI, hp: ud.hp, cd: 0,
        order: { kind: 'move', x: gx, z: gz }, gx, gz, target: -1,
      });
      this.emit(`${ud.name} ready${b.queue.length ? ` · ${b.queue.length} more queued` : ''}`, 'info', 'unitReady');
    }
  }

  // ---------- mining ----------
  private stepMining() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (d.role !== 'depot' || b.progress < 1) continue;
      if (b.mining === undefined || b.mining < 0 || !s.deposits[b.mining] || s.deposits[b.mining].alloys <= 0) b.mining = depositFor(s, d, b.x, b.z);
      if (!b.powered || b.mining < 0) continue;
      const dep = s.deposits[b.mining];
      const take = Math.min(dep.alloys, (d.mineRate ?? 0) * this.people.mult(b) * DT);
      dep.alloys -= take;
      s.alloys += take;
      s.stats.mined += take;
      if (dep.alloys <= 0) this.emit(`Deposit ${compass(dep.x, dep.z)} of the Core is exhausted`, 'warn');
    }
    s.alloys += RULES.alloyTrickle * DT;
  }

  // ---------- combat ----------
  private unitDef(h: Hostile): UnitDef { return content.units[h.unit]; }

  /** Can the colony shoot at this hostile? Not while it's underground or out of sight. */
  private targetable(h: Hostile) {
    return !h.under && this.visible(h.x, h.z);
  }

  /**
   * One hit on `tgt` from (fx, fz): splash does half damage around the target;
   * a chain jumps on to the nearest unhit hostile within `chainRange`, losing
   * 30% each jump. Effects are pushed here so every shooter looks the same.
   */
  private strike(fx: number, fz: number, tgt: Hostile, dmg: number, fxKind: number, o: { splash?: number; chain?: number; chainRange?: number } = {}) {
    const s = this.s;
    const tx = tgt.x, tz = tgt.z;
    this.fx.push(fxKind, fx, fz, tx, tz);
    tgt.hp -= dmg;
    if (o.splash) {
      for (const h of [...s.hostiles]) {
        if (h !== tgt && !h.under && Math.hypot(h.x - tx, h.z - tz) < o.splash) { h.hp -= dmg / 2; if (h.hp <= 0) this.killHostile(h); }
      }
    }
    if (o.chain && o.chainRange) {
      const hit = new Set([tgt]);
      let from = tgt, d = dmg;
      for (let j = 0; j < o.chain; j++) {
        let next: Hostile | null = null, bd = o.chainRange;
        for (const h of s.hostiles) {
          if (hit.has(h) || h.under) continue;
          const dist = Math.hypot(h.x - from.x, h.z - from.z);
          if (dist < bd) { bd = dist; next = h; }
        }
        if (!next) break;
        d *= CHAIN_FALLOFF;
        this.fx.push(FX.ARC, from.x, from.z, next.x, next.z);
        next.hp -= d;
        hit.add(next);
        if (from !== tgt && from.hp <= 0) this.killHostile(from);
        from = next;
      }
      for (const h of hit) if (h !== tgt && h.hp <= 0) this.killHostile(h);
    }
    if (tgt.hp <= 0) this.killHostile(tgt);
  }

  private stepTurrets() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (!d.fireRange || !d.damage || !d.cooldown || b.progress < 1) continue;
      b.cd = Math.max(0, (b.cd ?? 0) - DT);
      const min = d.minRange ?? 0;
      let best: Hostile | null = null, bd = d.fireRange;
      for (const h of s.hostiles) {
        if (!this.targetable(h)) continue;
        const dist = Math.hypot(h.x - b.x, h.z - b.z) - this.unitDef(h).radius;
        if (dist <= bd && dist >= min) { bd = dist; best = h; }
      }
      b.engaged = !!best;
      if (!best || !b.powered) continue;
      b.aim = Math.atan2(best.x - b.x, best.z - b.z);
      if (b.cd > 0) continue;
      b.cd = d.cooldown ?? 1;
      this.strike(b.x, b.z, best, (d.damage ?? 0) * this.people.mult(b), weaponFx(d.weapon ?? (d.splash ? 'shell' : 'cannon'), true), { splash: d.splash });
    }
    this.stepWardens();
  }

  /** Autonomist-led colonies: the people inside a building fight off predators that come close (no power needed). */
  private stepWardens() {
    const P = content.people;
    if (this.people.lead() !== 'autonomist') return;
    for (const b of this.s.buildings) {
      if (b.progress < 1) continue;
      b.mcd = Math.max(0, (b.mcd ?? 0) - DT);
      if (b.mcd > 0) continue;
      const k = this.people.wardens(b);
      if (!k) continue;
      let best: Hostile | null = null, bd = P.militiaRange + bodyR(b);
      for (const h of this.s.hostiles) {
        if (!this.targetable(h)) continue;
        const dist = Math.hypot(h.x - b.x, h.z - b.z) - this.unitDef(h).radius;
        if (dist <= bd) { bd = dist; best = h; }
      }
      if (!best) continue;
      b.mcd = P.militiaCooldown;
      this.strike(b.x, b.z, best, P.militiaDamage * k, FX.ROVER_SHOT);
    }
  }

  /** Repair pads mend combat units parked within reach, while powered (free: power is the cost). */
  private stepRepairPads() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (d.role !== 'repair' || b.progress < 1) continue;
      const reach = (d.range ?? 8) + bodyR(b);
      let any = false;
      for (const u of this.units) {
        const ud = content.units[u.unit];
        if (u.hp >= ud.hp || Math.hypot(u.x - b.x, u.z - b.z) > reach + ud.radius) continue;
        any = true;
        if (!b.powered) continue;
        u.hp = Math.min(ud.hp, u.hp + (d.repairRate ?? 10) * DT);
        if ((s.tick + u.id) % 8 === 0) this.fx.push(FX.REPAIR, b.x, b.z, u.x, u.z);
      }
      b.engaged = any;
    }
  }

  /** Turn and step toward (tx, tz), sliding around water. */
  private steer(o: { x: number; z: number; heading: number }, tx: number, tz: number, speed: number) {
    let ang = Math.atan2(tx - o.x, tz - o.z);
    const step = Math.min(speed * DT, Math.hypot(tx - o.x, tz - o.z));
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const a = ang + off;
      if (!this.blocked(o.x + Math.sin(a) * (step + 2), o.z + Math.cos(a) * (step + 2))) { ang = a; break; }
    }
    let dh = ang - o.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    o.heading += clamp(dh, -6 * DT, 6 * DT);
    o.x += Math.sin(o.heading) * step;
    o.z += Math.cos(o.heading) * step;
  }

  /**
   * Walk a unit toward (tx, tz) along a planned path. Returns false if it's
   * stuck and should give up.
   */
  private goTo(u: Unit, tx: number, tz: number, speed: number) {
    const t = this.s.tick;
    const far = !u.goal || Math.hypot(u.goal[0] - tx, u.goal[1] - tz) > 3;
    if (far || !u.path || (u.repath ?? 0) <= t) {
      if (far) { u.best = Infinity; u.stall = 0; }
      u.goal = [tx, tz];
      u.path = this.grid.find(u.x, u.z, tx, tz) ?? [];
      u.repath = t + REPATH + (u.id % 7);
    }
    const p = u.path;
    while (p.length > 2 && Math.hypot(p[0] - u.x, p[1] - u.z) < 1.5) p.splice(0, 2);
    if (!p.length) return false;
    this.steer(u, p[0], p[1], speed);
    const d = Math.hypot(tx - u.x, tz - u.z);
    if (d < (u.best ?? Infinity) - 0.5) { u.best = d; u.stall = 0; }
    else if ((u.stall = (u.stall ?? 0) + 1) > STALL * 3) return false;
    else if (u.stall % STALL === 0) u.repath = t;
    return true;
  }

  private arrive(u: Unit) {
    u.gx = u.x; u.gz = u.z;
    u.order = { kind: 'idle' };
    u.path = undefined; u.goal = undefined;
  }

  /**
   * Combat units: shoot the nearest hostile in range (even on the move); idle
   * units chase hostiles that come within aggro of them, on a leash from their
   * guard post, then walk back.
   */
  private stepUnits() {
    const s = this.s, us = this.units;
    // gates are open to units: they aren't obstacles on the path grid
    if (us.length) this.grid.setBodies(s.buildings.filter((b) => def(b).role !== 'gate').map((b) => ({ x: b.x, z: b.z, r: bodyR(b) })), PATH_PAD);
    for (const u of us) {
      const d = content.units[u.unit];
      u.cd = Math.max(0, u.cd - DT);
      if (d.repairRate) { this.stepRepairer(u, d); continue; }
      const moving = u.order.kind === 'move';
      let tgt = u.target >= 0 ? s.hostiles.find((h) => h.id === u.target) : undefined;
      if (tgt && !this.targetable(tgt)) tgt = undefined;
      const leash = Math.max(d.aggro * LEASH, RULES.unitResponse + 10);
      const min = d.minRange ?? 0;
      if (!tgt || (s.tick + u.id) % 5 === 0) {
        const seek = moving ? d.range : d.aggro;
        let bd = Infinity;
        tgt = undefined;
        for (const h of s.hostiles) {
          if (!this.targetable(h)) continue;
          const dist = Math.hypot(h.x - u.x, h.z - u.z) - this.unitDef(h).radius;
          if (dist <= seek && dist >= min && dist < bd) { bd = dist; tgt = h; }
        }
        // idle: answer attacks on buildings near the guard post
        if (!tgt && !moving) {
          for (const h of s.hostiles) {
            if (!this.targetable(h) || Math.hypot(h.x - u.gx, h.z - u.gz) > RULES.unitResponse) continue;
            const b = s.buildings.find((x) => x.id === h.target);
            if (!b || Math.hypot(b.x - h.x, b.z - h.z) > bodyR(b) + 12) continue;
            const dist = Math.hypot(h.x - u.x, h.z - u.z);
            if (dist < bd && dist - this.unitDef(h).radius >= min) { bd = dist; tgt = h; }
          }
        }
      }
      if (tgt && !moving && Math.hypot(tgt.x - u.gx, tgt.z - u.gz) > leash) tgt = undefined;
      // too close for a gun with a minimum range: let it go (others deal with it)
      if (tgt && min && Math.hypot(tgt.x - u.x, tgt.z - u.z) - this.unitDef(tgt).radius < min) tgt = undefined;
      u.target = tgt?.id ?? -1;
      const gap = tgt ? Math.hypot(tgt.x - u.x, tgt.z - u.z) - this.unitDef(tgt).radius - d.radius : Infinity;
      if (tgt && gap <= d.range && d.damage > 0) {
        if (!moving) {
          let dh = Math.atan2(tgt.x - u.x, tgt.z - u.z) - u.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          u.heading += clamp(dh, -8 * DT, 8 * DT);
        }
        if (u.cd <= 0) {
          u.cd = d.cooldown;
          const dead = tgt.hp <= d.damage;
          this.strike(u.x, u.z, tgt, d.damage, weaponFx(unitWeapon(d), false), d);
          if (dead) u.target = -1;
        }
      }
      if (u.order.kind === 'move') {
        const o = u.order;
        if (Math.hypot(o.x - u.x, o.z - u.z) < 1.2 || !this.goTo(u, o.x, o.z, d.speed)) this.arrive(u);
      } else if (tgt && gap > d.range) {
        if (!this.goTo(u, tgt.x, tgt.z, d.speed)) u.target = -1;
      } else if (!tgt && Math.hypot(u.gx - u.x, u.gz - u.z) > 1.5) {
        if (!this.goTo(u, u.gx, u.gz, d.speed)) this.arrive(u);
      }
    }
    // separation, and out of building bodies
    for (let i = 0; i < us.length; i++) {
      const a = us[i], ra = content.units[a.unit].radius;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j], rb = content.units[b.unit].radius;
        const dx = b.x - a.x, dz = b.z - a.z, dd = Math.hypot(dx, dz), min = ra + rb + 0.3;
        if (dd > 1e-3 && dd < min) {
          const push = (min - dd) / 2;
          a.x -= (dx / dd) * push; a.z -= (dz / dd) * push;
          b.x += (dx / dd) * push; b.z += (dz / dd) * push;
        }
      }
      for (const b of this.s.buildings) {
        if (def(b).role === 'gate') continue;
        const dx = a.x - b.x, dz = a.z - b.z, dd = Math.hypot(dx, dz), min = bodyR(b) + ra;
        if (dd > 1e-3 && dd < min) { a.x = b.x + (dx / dd) * min; a.z = b.z + (dz / dd) * min; }
      }
      a.x = clamp(a.x, -LIMIT, LIMIT); a.z = clamp(a.z, -LIMIT, LIMIT);
    }
  }

  /** Hit points and alloy cost of a repair target (unit or building). */
  private patient(id: number): { e: Unit | Building; max: number; cost: number; r: number } | null {
    const u = this.units.find((x) => x.id === id);
    if (u) { const d = content.units[u.unit]; return { e: u, max: d.hp, cost: d.cost ?? 50, r: d.radius }; }
    const b = this.s.buildings.find((x) => x.id === id);
    if (b && b.progress >= 1) { const d = def(b); return { e: b, max: d.hp, cost: d.cost, r: bodyR(b) }; }
    return null;
  }

  /**
   * Field engineers: repair the most hurt unit (then building) near them or,
   * when idle, near their guard post; repairs cost alloys at the same rate as a
   * drone's. They don't fight; moving orders always come first.
   */
  private stepRepairer(u: Unit, d: UnitDef) {
    const s = this.s, moving = u.order.kind === 'move';
    let p = u.fix !== undefined && u.fix >= 0 ? this.patient(u.fix) : null;
    if (p && p.e.hp >= p.max) p = null;
    if (!p || (s.tick + u.id) % 10 === 0) {
      const reach = moving ? d.range + 4 : d.aggro;
      let best: number | null = null, bs = Infinity;
      const consider = (id: number, x: number, z: number, frac: number, isUnit: boolean) => {
        if (frac >= 0.98 || id === u.id) return;
        const from = moving ? Math.hypot(x - u.x, z - u.z) : Math.min(Math.hypot(x - u.x, z - u.z), Math.hypot(x - u.gx, z - u.gz));
        if (from > reach) return;
        // units first, then the most hurt, then the nearest
        const score = (isUnit ? 0 : 1000) + frac * 100 + from;
        if (score < bs) { bs = score; best = id; }
      };
      for (const o of this.units) consider(o.id, o.x, o.z, o.hp / content.units[o.unit].hp, true);
      for (const b of s.buildings) if (b.progress >= 1) consider(b.id, b.x, b.z, b.hp / maxHp(b), false);
      u.fix = best ?? -1;
      p = best !== null ? this.patient(best) : null;
    }
    u.target = -1;
    const gap = p ? Math.hypot(p.e.x - u.x, p.e.z - u.z) - p.r - d.radius : Infinity;
    if (p && gap <= d.range) {
      if (!moving) {
        let dh = Math.atan2(p.e.x - u.x, p.e.z - u.z) - u.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        u.heading += clamp(dh, -8 * DT, 8 * DT);
      }
      const hp = Math.min((d.repairRate ?? 0) * DT, p.max - p.e.hp);
      const cost = (hp / p.max) * p.cost * 0.5;
      if (hp > 0 && s.alloys >= cost) {
        s.alloys -= cost;
        p.e.hp += hp;
        if ((s.tick + u.id) % 6 === 0) this.fx.push(FX.REPAIR, u.x, u.z, p.e.x, p.e.z);
      }
    }
    if (moving) {
      const o = u.order as { x: number; z: number };
      if (Math.hypot(o.x - u.x, o.z - u.z) < 1.2 || !this.goTo(u, o.x, o.z, d.speed)) this.arrive(u);
    } else if (p && gap > d.range) {
      if (!this.goTo(u, p.e.x, p.e.z, d.speed)) u.fix = -1;
    } else if (!p && Math.hypot(u.gx - u.x, u.gz - u.z) > 1.5) {
      if (!this.goTo(u, u.gx, u.gz, d.speed)) this.arrive(u);
    }
  }

  private killHostile(h: Hostile) {
    const s = this.s;
    const i = s.hostiles.indexOf(h);
    if (i < 0) return;
    s.hostiles.splice(i, 1);
    s.stats.kills++;
    this.fx.push(dieFx(this.unitDef(h).radius), h.x, h.z, 0, 0);
    const p = s.packs.find((x) => x.id === h.pack);
    if (p && --p.alive <= 0) {
      s.packs.splice(s.packs.indexOf(p), 1);
      s.stats.packsBeaten++;
      this.emit(`Pack from the ${p.from} destroyed (${s.stats.packsBeaten} so far)`, 'info', 'packCleared');
    }
  }

  private blocked(x: number, z: number) {
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return true;
    return regionHeightRaw(x, z) < 0.3;
  }

  private chooseTarget(h: Hostile, u: UnitDef) {
    const s = this.s;
    let best = -1, bd = Infinity;
    // underground, a burrower can't sense drones or units: it heads for the base (never a wall)
    if (!h.under) {
      for (const d of [...s.drones, ...this.units, ...this.people.outdoors()]) {
        const dist = Math.hypot(d.x - h.x, d.z - h.z);
        if (dist < u.aggro && dist < bd) { bd = dist; best = d.id; }
      }
      if (best >= 0) return best;
    }
    for (const b of s.buildings) {
      if (h.under && barrier(b)) continue;
      const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b) + (barrier(b) ? WALL_PENALTY : 0);
      if (dist < bd) { bd = dist; best = b.id; }
    }
    return best;
  }

  private stepHostiles() {
    const s = this.s;
    const hs = s.hostiles;
    const was = hs.map((h) => [h.x, h.z]);
    for (const h of hs) {
      const u = this.unitDef(h);
      h.cd = Math.max(0, h.cd - DT);
      let tgt = h.target >= 0 ? this.entity(h.target) : undefined;
      if (!tgt) h.chew = false;
      if (!tgt || (!h.chew && (s.tick + h.id) % 10 === 0)) {
        const was = h.target;
        h.target = this.chooseTarget(h, u);
        tgt = this.entity(h.target);
        if (h.target !== was) { h.best = Infinity; h.stall = 0; }
      }
      // a colonist who made it indoors is out of reach
      if (tgt && 'lineage' in tgt && tgt.at >= 0) { h.target = -1; tgt = undefined; }
      if (!tgt) continue;
      const isB = 'kind' in tgt, isU = 'order' in tgt, isC = 'lineage' in tgt;
      const tr = isB ? bodyR(tgt as Building) : isU ? content.units[(tgt as Unit).unit].radius : 1;
      const dx = tgt.x - h.x, dz = tgt.z - h.z, dist = Math.hypot(dx, dz);
      if (h.under) {
        // tunnelling: straight at the target, under walls and water
        if (dist - tr - u.radius <= u.range + SURFACE_AT) {
          h.under = false;
          this.fx.push(FX.EMERGE, h.x, h.z, 0, 0);
          if (s.tick - this.lastEmerge > 5 * TICK_HZ) {
            this.lastEmerge = s.tick;
            this.emit(`${u.name} surfaced by the ${(tgt as Building).kind ? def(tgt as Building).name : 'base'}!`, 'bad', 'warning');
          }
        } else {
          h.heading = Math.atan2(dx, dz);
          const step = Math.min(u.speed * DT, dist);
          h.x += (dx / dist) * step; h.z += (dz / dist) * step;
        }
        continue;
      }
      if (dist - tr - u.radius <= u.range) {
        h.heading = Math.atan2(dx, dz);
        if (h.cd <= 0) {
          h.cd = u.cooldown;
          tgt.hp -= u.damage * (isC ? this.people.harm() : 1);
          this.fx.push(weaponFx(unitWeapon(u), false), h.x, h.z, tgt.x, tgt.z);
          if (tgt.hp <= 0) isB ? this.destroyBuilding(tgt as Building) : isU ? this.destroyUnit(tgt as Unit) : isC ? this.people.kill(tgt as Colonist, 'killed by predators') : this.destroyDrone(tgt as Drone);
        }
        continue;
      }
      this.steer(h, tgt.x, tgt.z, u.speed);
      // pressed against something (a wall) and getting nowhere: chew through what's in the way
      const left = dist - tr;
      if (left < (h.best ?? Infinity) - 0.3) { h.best = left; h.stall = 0; }
      else if ((h.stall = (h.stall ?? 0) + 1) > 15) {
        let block: Building | null = null, bd = u.radius + 2.5;
        for (const b of s.buildings) {
          let gap = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b);
          if (barrier(b)) {
            const w = wallEnds(b), lx = w.bx - w.ax, lz = w.bz - w.az;
            const t = clamp(((h.x - w.ax) * lx + (h.z - w.az) * lz) / (lx * lx + lz * lz), 0, 1);
            gap = Math.hypot(h.x - (w.ax + lx * t), h.z - (w.az + lz * t)) - WALL_HALF;
          }
          if (gap < bd) { bd = gap; block = b; }
        }
        h.stall = 0;
        if (block && block.id !== h.target) { h.target = block.id; h.chew = true; h.best = Infinity; }
      }
    }
    // separation, and keep out of building bodies
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i], ra = this.unitDef(a).radius;
      if (a.under) continue; // tunnelling: nothing above ground pushes it about
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j], rb = this.unitDef(b).radius;
        if (b.under) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = ra + rb;
        if (d > 1e-3 && d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
      for (const b of s.buildings) {
        let cx = b.x, cz = b.z, min = bodyR(b) + ra;
        if (barrier(b)) {
          // walls are thick line segments: push out from the nearest point on the segment
          const w = wallEnds(b), lx = w.bx - w.ax, lz = w.bz - w.az;
          const t = clamp(((a.x - w.ax) * lx + (a.z - w.az) * lz) / (lx * lx + lz * lz), 0, 1);
          cx = w.ax + lx * t; cz = w.az + lz * t; min = WALL_HALF + ra;
        }
        const dx = a.x - cx, dz = a.z - cz, d = Math.hypot(dx, dz);
        if (d > 1e-3 && d < min) { a.x = cx + (dx / d) * min; a.z = cz + (dz / d) * min; }
      }
      a.x = clamp(a.x, -LIMIT, LIMIT); a.z = clamp(a.z, -LIMIT, LIMIT);
      // never end up on the other side of a wall this tick
      const [px, pz] = was[i];
      for (const b of s.buildings) {
        if (!barrier(b)) continue;
        const w = wallEnds(b);
        if (crosses(px, pz, a.x, a.z, w.ax, w.az, w.bx, w.bz)) { a.x = px; a.z = pz; break; }
      }
    }
    // packs are announced once seen (radar sees them as they arrive)
    for (const p of s.packs) {
      if (p.announced) continue;
      const near = hs.some((h) => h.pack === p.id && s.buildings.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < THREATS.sightRange));
      if (near) { p.announced = true; this.emit(`Contact! Predators at the ${p.from} perimeter`, 'bad', 'warning'); }
    }
  }

  private destroyBuilding(b: Building) {
    const s = this.s;
    const i = s.buildings.indexOf(b);
    if (i < 0) return;
    s.buildings.splice(i, 1);
    s.stats.buildingsLost++;
    this.fx.push(FX.DIE_BIG, b.x, b.z, 0, 0);
    this.emit(`${def(b).name} destroyed`, 'bad', def(b).role === 'wall' ? 'lost' : 'alarm');
    for (const u of this.units) if (u.fix === b.id) u.fix = -1;
    this.people.buildingLost(b);
    if (b.kind === 'core') this.lose('core');
  }

  /** People hooks: a building sabotaged to nothing, a death effect, a walking path. */
  sabotaged(b: Building) { this.destroyBuilding(b); }
  fxDeath(x: number, z: number) { this.fx.push(FX.DIE_SMALL, x, z, 0, 0); }
  pathFor(ax: number, az: number, bx: number, bz: number) {
    this.grid.setBodies(this.s.buildings.map((b) => ({ x: b.x, z: b.z, r: bodyR(b) })), PATH_PAD);
    return this.grid.find(ax, az, bx, bz);
  }

  private destroyDrone(d: Drone) {
    const s = this.s;
    const i = s.drones.indexOf(d);
    if (i < 0) return;
    s.drones.splice(i, 1);
    s.stats.dronesLost++;
    this.fx.push(FX.DIE_SMALL, d.x, d.z, 0, 0);
    this.emit('Worker drone destroyed', 'bad', 'lost');
  }

  private destroyUnit(u: Unit) {
    const s = this.s;
    const i = this.units.indexOf(u);
    if (i < 0) return;
    this.units.splice(i, 1);
    s.stats.unitsLost = (s.stats.unitsLost ?? 0) + 1;
    this.fx.push(dieFx(content.units[u.unit].radius), u.x, u.z, 0, 0);
    this.emit(`${content.units[u.unit].name} destroyed`, 'bad', 'lost');
  }

  lose(why: 'core' | 'cryo' | 'people') {
    if (this.s.over) return;
    this.s.over = why;
    this.emit(why === 'core' ? 'The Command Core has fallen. The colony is lost.' : why === 'cryo' ? 'The last embryos are gone. The colony is lost.' : 'No one is left. The colony is lost.', 'bad', 'alarm');
  }

  // ---------- waves ----------
  private radarPowered() {
    return this.s.buildings.some((b) => b.powered && def(b).role === 'radar');
  }

  private stepWaves() {
    const s = this.s, w = s.waves;
    if (s.tick < w.next) return;
    const night = this.power.daylight < 0.3;
    const size = Math.round(Math.min(THREATS.maxSize, THREATS.startSize + THREATS.growth * w.n) * packScale() * (night ? THREATS.nightBoost : 1));
    const spawns = REGION.spawns?.length ? REGION.spawns : [{ x: LIMIT - 10, z: LIMIT - 10 }];
    const sp = spawns[Math.floor(this.rnd() * spawns.length)];
    const pack = { id: s.nextId++, size, alive: 0, announced: false, from: compass(sp.x, sp.z) };
    for (let i = 0; i < size; i++) {
      const k = ++w.spawned;
      let unit = 'swarmer';
      if (THREATS.bruteEvery > 0 && k % THREATS.bruteEvery === 0) unit = 'brute';
      else for (const [id, x] of PACK_EXTRAS) if (w.n >= (x.packFrom ?? 0) && k % x.packEvery! === 0) { unit = id; break; }
      const slot = this.freeSlot();
      if (slot < 0) break;
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * 7;
      s.hostiles.push({
        id: s.nextId++, unit, slot, x: clamp(sp.x + Math.cos(a) * r, -LIMIT, LIMIT), z: clamp(sp.z + Math.sin(a) * r, -LIMIT, LIMIT),
        heading: Math.atan2(-sp.x, -sp.z), hp: content.units[unit].hp, target: -1, cd: this.rnd(), pack: pack.id,
        under: content.units[unit].burrows || undefined,
      });
      pack.alive++;
    }
    if (pack.alive) {
      s.packs.push(pack);
      if (this.radarPowered()) {
        pack.announced = true;
        this.emit(`Radar: pack of ${pack.alive} approaching from the ${pack.from}`, 'warn', 'warning');
      } else this.inhabitants.packArrived(pack, false);
    }
    w.n++;
    w.next = s.tick + Math.round((waveInterval() + (this.rnd() * 2 - 1) * THREATS.waveJitter) * TICK_HZ);
  }

  private freeSlot() {
    const used = new Set([...this.s.hostiles, ...this.units].map((h) => h.slot));
    for (let i = 0; i < MAX_HOSTILES; i++) if (!used.has(i)) { this.slotsUsed = Math.max(this.slotsUsed, i + 1); return i; }
    return -1;
  }

  // ---------- grazers (ambient) ----------
  private herdSpot(h: number) {
    const s = this.s;
    const home = REGION.herds[h] ?? { x: s.herds[h].x, z: s.herds[h].z, roam: 60 };
    if (home.roam <= 0) return { x: home.x, z: home.z };
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * home.roam;
      const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
      if (Math.abs(x) < LIMIT - 15 && Math.abs(z) < LIMIT - 15 && Math.hypot(x, z) > 50) return { x, z };
    }
    return { x: home.x, z: home.z };
  }

  private stepGrazers() {
    const s = this.s;
    const panic = s.panic > 0;
    if (panic) s.panic--;
    if (s.herds.length && this.rnd() < 0.004) {
      const h = Math.floor(this.rnd() * s.herds.length);
      s.herds[h] = this.herdSpot(h);
    }
    const scary = [...s.drones, ...this.units, ...s.hostiles.filter((h) => !h.under)];
    for (const f of s.fauna) {
      let tx = f.tx, tz = f.tz, sp = WALK;
      const rc0 = Math.hypot(f.x, f.z);
      let fled = false;
      if (panic && rc0 < PANIC_R && rc0 > 1e-3) {
        // engine noise: bolt away from the landing site
        tx = f.x + (f.x / rc0) * 30; tz = f.z + (f.z / rc0) * 30; sp = RUN; fled = true;
      } else if (this.deployed) {
        for (const o of scary) {
          const dx = f.x - o.x, dz = f.z - o.z, dd = Math.hypot(dx, dz);
          if (dd < FLEE_R && dd > 1e-3) { tx = f.x + (dx / dd) * 20; tz = f.z + (dz / dd) * 20; sp = RUN; fled = true; break; }
        }
      }
      if (!fled && (Math.hypot(f.tx - f.x, f.tz - f.z) < 1.5 || this.rnd() < 0.003)) {
        const c = s.herds[f.herd];
        f.tx = clamp(c.x + (this.rnd() - 0.5) * 44, -LIMIT, LIMIT);
        f.tz = clamp(c.z + (this.rnd() - 0.5) * 44, -LIMIT, LIMIT);
        tx = f.tx; tz = f.tz;
      }
      // keep grazers out of the base
      for (const b of s.buildings) {
        const r = b.kind === 'core' ? CORE_KEEP_OUT : bodyR(b) + 4;
        const dx = f.x - b.x, dz = f.z - b.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-3) { tx = b.x + (dx / d) * (r + 8); tz = b.z + (dz / d) * (r + 8); }
      }
      if (Math.hypot(tx - f.x, tz - f.z) > 0.4) this.approach(f, tx, tz, sp, sp > WALK ? 9 : 2.5);
      f.x = clamp(f.x, -LIMIT, LIMIT);
      f.z = clamp(f.z, -LIMIT, LIMIT);
    }
  }

  // ---------- commands ----------
  command(c: Command) {
    const s = this.s;
    if (c.type === 'landing') { this.landing(c.stage); return; }
    if (!this.deployed || s.over) return;
    switch (c.type) {
      case 'move': {
        const d = s.drones.find((x) => x.id === c.drone) ?? s.drones[0];
        if (!d) return;
        d.task = { kind: 'move', x: clamp(c.x, -LIMIT, LIMIT), z: clamp(c.z, -LIMIT, LIMIT) };
        d.manual = true;
        return;
      }
      case 'build': {
        const dd = DEFS[c.kind];
        if (!dd || !dd.buildable) return;
        if (s.alloys < dd.cost) { this.emit(`Not enough alloys for a ${dd.name} (${dd.cost} needed)`, 'warn', 'deny'); return; }
        let { x, z } = c, yaw = c.yaw ?? 0;
        // a gate dropped by a wall snaps onto its line
        const sn = dd.role === 'gate' ? gateSnap(this.world, DEFS, x, z) : null;
        if (sn) ({ x, z, yaw } = sn);
        const why = placeProblem(this.world, DEFS, RULES, c.kind, x, z);
        if (why) { this.emit(`Can't build there: ${why}`, 'warn', 'deny'); return; }
        s.alloys -= dd.cost;
        let swapped = 0;
        if (dd.role === 'gate') {
          for (const w of wallsUnderGate(s.buildings, DEFS, dd, x, z, yaw)) {
            s.alloys += def(w).cost * 0.5 * (w.progress >= 1 ? w.hp / maxHp(w) : 1);
            s.buildings.splice(s.buildings.indexOf(w), 1);
            swapped++;
          }
        }
        s.buildings.push({ id: s.nextId++, kind: c.kind, x, z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
        this.emit(`${dd.name} placed${swapped ? ` · replaces ${swapped} wall segment${swapped > 1 ? 's' : ''}` : ''}${s.drones.length ? '' : ' · waiting for a drone'}`, 'info', 'placed');
        return;
      }
      case 'buildLine': {
        const dd = DEFS[c.kind];
        if (!dd || !dd.buildable) return;
        const { pts, yaw } = linePoints(dd, c.x1, c.z1, c.x2, c.z2);
        let placed = 0, skipped = 0, poor = false;
        for (const p of pts) {
          if (s.alloys < dd.cost) { poor = true; break; }
          if (placeProblem(this.world, DEFS, RULES, c.kind, p.x, p.z)) { skipped++; continue; }
          s.alloys -= dd.cost;
          s.buildings.push({ id: s.nextId++, kind: c.kind, x: p.x, z: p.z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
          placed++;
        }
        if (placed) this.emit(`${placed} ${dd.name} segment${placed > 1 ? 's' : ''} placed${skipped ? ` · ${skipped} spots blocked` : ''}${poor ? ' · ran out of alloys' : ''}`, 'info', 'placed');
        else this.emit(poor ? `Not enough alloys for a ${dd.name} (${dd.cost} each)` : `Can't build a ${dd.name} there`, 'warn', 'deny');
        return;
      }
      case 'repair': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (!b || b.progress < 1 || b.hp >= maxHp(b)) return;
        let best: Drone | null = null, bd = Infinity;
        for (const d of s.drones) {
          const dist = Math.hypot(d.x - b.x, d.z - b.z) + (d.task.kind === 'idle' ? 0 : 1000);
          if (dist < bd) { bd = dist; best = d; }
        }
        if (best) { best.task = { kind: 'repair', id: b.id }; best.manual = true; }
        return;
      }
      case 'power': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (b && b.kind !== 'core') b.on = c.on;
        return;
      }
      case 'grow': case 'unpod': case 'policy':
        this.people.command(c);
        return;
      case 'demolish': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (!b || b.kind === 'core') return;
        const dd = def(b);
        if (s.people?.pods.some((p) => p.b === b.id)) { this.emit(`Can't recycle the ${dd.name}: its growth pods are running`, 'warn', 'deny'); return; }
        const queued = (b.queue ?? []).reduce((m, k) => m + (content.units[k]?.cost ?? 0), 0);
        const refund = queued + (b.progress < 1 ? dd.cost * (1 - b.progress * 0.5) : dd.cost * 0.5 * (b.hp / dd.hp));
        s.alloys += refund;
        s.buildings.splice(s.buildings.indexOf(b), 1);
        this.people.buildingLost(b, false);
        this.emit(`${dd.name} ${b.progress < 1 ? 'cancelled' : 'recycled'} · +${Math.floor(refund)} alloys`, 'info');
        return;
      }
      case 'contact':
        this.inhabitants.command(c.camp, c.choice);
        return;
      case 'story':
        this.story.answer(c.id, c.choice);
        return;
      case 'debug': {
        if (c.story) this.story.fire(c.story);
        if (c.regard) this.inhabitants.setRegard(c.regard.camp, c.regard.value);
        if (c.alloys) s.alloys += c.alloys;
        if (c.wave) s.waves.next = s.tick;
        if (c.spawn && content.units[c.spawn.unit]) {
          // tests: a pack of `n` right here
          const sp = c.spawn, pack = { id: s.nextId++, size: sp.n ?? 1, alive: 0, announced: true, from: compass(sp.x, sp.z) };
          for (let i = 0; i < pack.size; i++) {
            const slot = this.freeSlot();
            if (slot < 0) break;
            s.hostiles.push({ id: s.nextId++, unit: sp.unit, slot, x: sp.x + (i % 4) * 1.6, z: sp.z - Math.floor(i / 4) * 1.6, heading: 0, hp: content.units[sp.unit].hp, target: -1, cd: 0, pack: pack.id, under: content.units[sp.unit].burrows || undefined });
            pack.alive++;
          }
          s.packs.push(pack);
        }
        if (c.units && content.units[c.units.unit]?.faction === 'accord') {
          // tests / playtesting: combat units right here, guarding where they land
          const sp = c.units, ud = content.units[sp.unit];
          for (let i = 0; i < (sp.n ?? 1); i++) {
            const slot = this.freeSlot();
            if (slot < 0) break;
            const x = clamp(sp.x + (i % 4) * 3, -LIMIT, LIMIT), z = clamp(sp.z - Math.floor(i / 4) * 3, -LIMIT, LIMIT);
            this.units.push({ id: s.nextId++, unit: sp.unit, slot, x, z, heading: 0, hp: ud.hp, cd: 0, order: { kind: 'idle' }, gx: x, gz: z, target: -1 });
          }
        }
        if (c.people) this.people.debug(c.people);
        if (c.hurt) {
          const b = s.buildings.find((x) => x.id === c.hurt!.id);
          if (b) { b.hp -= c.hurt.hp; if (b.hp <= 0) this.destroyBuilding(b); }
        }
        return;
      }
      case 'produce': {
        const b = s.buildings.find((x) => x.id === c.id);
        const ud = content.units[c.unit];
        if (!b || def(b).role !== 'factory' || b.progress < 1 || !ud || ud.faction !== 'accord' || ud.cost === undefined) return;
        const queued = s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0);
        if (this.units.length + queued >= RULES.maxUnits) { this.emit(`Combat unit limit reached (${RULES.maxUnits})`, 'warn', 'deny'); return; }
        if (s.alloys < ud.cost) { this.emit(`Not enough alloys for a ${ud.name} (${ud.cost} needed)`, 'warn', 'deny'); return; }
        s.alloys -= ud.cost;
        (b.queue ??= []).push(c.unit);
        if (b.queue.length === 1) b.prod = 0;
        return;
      }
      case 'unqueue': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (!b?.queue?.length) return;
        const k = b.queue.pop()!;
        s.alloys += content.units[k]?.cost ?? 0;
        if (!b.queue.length) b.prod = 0;
        return;
      }
      case 'order': {
        const sel = this.units.filter((u) => c.ids.includes(u.id));
        // spread out around the point (sunflower), nearest units take the inner spots
        const x = clamp(c.x, -LIMIT, LIMIT), z = clamp(c.z, -LIMIT, LIMIT);
        sel.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        sel.forEach((u, i) => {
          const r = SPREAD * Math.sqrt(i) * (i ? 1 : 0), a = i * 2.39996;
          const ox = clamp(x + Math.cos(a) * r, -LIMIT, LIMIT), oz = clamp(z + Math.sin(a) * r, -LIMIT, LIMIT);
          u.order = { kind: 'move', x: ox, z: oz };
          u.target = -1;
        });
        return;
      }
      case 'stop': {
        for (const u of this.units) if (c.ids.includes(u.id)) { u.order = { kind: 'idle' }; u.gx = u.x; u.gz = u.z; }
        return;
      }
      case 'fab': {
        if (s.drones.length + s.fab.queued >= RULES.maxDrones) { this.emit(`Drone limit reached (${RULES.maxDrones})`, 'warn', 'deny'); return; }
        if (s.alloys < RULES.droneCost) { this.emit(`Not enough alloys for a drone (${RULES.droneCost} needed)`, 'warn', 'deny'); return; }
        s.alloys -= RULES.droneCost;
        s.fab.queued++;
        this.emit('Drone fabrication started', 'info');
        return;
      }
    }
  }

  private landing(stage: 'burn' | 'touchdown' | 'deploy') {
    const s = this.s;
    if (this.deployed) return;
    if (stage === 'burn') {
      s.panic = Math.max(s.panic, 16 * TICK_HZ);
    } else if (stage === 'touchdown' && s.phase === 'descent') {
      s.phase = 'landed';
      s.panic = Math.max(s.panic, 10 * TICK_HZ);
      const deficit = RULES.cryoDrawMW + RULES.droneIdleDrawMW - DEFS.core.powerMW;
      this.emit(`Touchdown. Cryo bank on reserve power: ${deficit.toFixed(1)} MW short.`, 'warn');
    } else if (stage === 'deploy') {
      if (s.phase === 'descent') this.landing('touchdown');
      s.phase = 'deployed';
      this.emit('Worker drone deployed. Build a Solar Array to stabilize the cryo bank.', 'info');
    }
  }

  // ---------- snapshot ----------
  snapshot(): Snapshot {
    const s = this.s;
    const fa = new Float32Array(s.fauna.length * 3);
    s.fauna.forEach((f, i) => { fa[i * 3] = f.x; fa[i * 3 + 1] = f.z; fa[i * 3 + 2] = f.heading; });
    const slots = this.slotsUsed;
    const army = new Float32Array(Math.max(1, slots) * STRIDE);
    const radar = this.radarPowered();
    const blips = new Float32Array(radar ? s.hostiles.length * 2 : 0);
    s.hostiles.forEach((h, i) => { if (radar) { blips[i * 2] = h.x; blips[i * 2 + 1] = h.z; } });
    for (const h of s.hostiles) {
      if (h.under || !this.visible(h.x, h.z)) continue; // underground or in the fog: not drawn (radar shows it as a blip)
      const o = h.slot * STRIDE;
      army[o + F.X] = h.x; army[o + F.Z] = h.z; army[o + F.HEADING] = h.heading;
      army[o + F.TYPE] = unitType(h.unit);
      army[o + F.HP] = h.hp / this.unitDef(h).hp;
      army[o + F.GEN] = h.id & 0xffff; army[o + F.ALIVE] = 1;
    }
    const units: UnitSnap[] = this.units.map((u) => {
      const o = u.slot * STRIDE, d = content.units[u.unit];
      army[o + F.X] = u.x; army[o + F.Z] = u.z; army[o + F.HEADING] = u.heading;
      army[o + F.TYPE] = unitType(u.unit);
      army[o + F.HP] = u.hp / d.hp;
      army[o + F.GEN] = u.id & 0xffff; army[o + F.ALIVE] = 1;
      const mv = u.order.kind === 'move' ? u.order : null;
      return { id: u.id, unit: u.unit, slot: u.slot, x: u.x, z: u.z, hp: u.hp / d.hp, order: u.order.kind, tx: mv ? mv.x : u.gx, tz: mv ? mv.z : u.gz, engaged: u.target >= 0 };
    });
    // effects in the fog stay hidden too
    const kept: number[] = [];
    for (let i = 0; i < this.fx.length; i += 5) {
      const f = this.fx;
      if (this.visible(f[i + 1], f[i + 2]) || this.visible(f[i + 3], f[i + 4])) kept.push(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4]);
    }
    const fx = new Float32Array(kept);
    this.fx.length = 0;
    const fog = new Uint8Array(FOG_N * FOG_N);
    for (let i = 0; i < fog.length; i++) fog[i] = this.vis[i] ? 2 : this.exp[i];
    const drones: DroneSnap[] = s.drones.map((d) => {
      const t = d.task;
      let tx = d.x, tz = d.z;
      if (t.kind === 'move') { tx = t.x; tz = t.z; }
      else if (t.kind === 'build' || t.kind === 'repair') {
        const b = s.buildings.find((x) => x.id === (t.kind === 'build' ? t.siteId : t.id));
        if (b) { tx = b.x; tz = b.z; }
      }
      const working = (t.kind === 'build' || t.kind === 'repair') && Math.hypot(tx - d.x, tz - d.z) < 14;
      return { id: d.id, x: d.x, z: d.z, heading: d.heading, tx, tz, moving: t.kind !== 'idle', working, hp: d.hp / RULES.droneHp, task: t.kind, manual: !!d.manual };
    });
    const packs = s.packs.map((p) => {
      let x = 0, z = 0, n = 0;
      for (const h of s.hostiles) if (h.pack === p.id) { x += h.x; z += h.z; n++; }
      return { x: n ? x / n : 0, z: n ? z / n : 0, alive: n, seen: radar || p.announced };
    });
    const inh = this.inhabitants.snapshot();
    return {
      type: 'snap', tick: s.tick, secs: this.secs, deployed: this.deployed,
      drones, fauna: fa, buildings: s.buildings.map((b) => ({ ...b, queue: b.queue ? [...b.queue] : undefined })), deposits: s.deposits.map((d) => ({ ...d })),
      army, armySlots: slots, fx, fog, blips, hostiles: s.hostiles.length, units, camps: inh.camps, natives: inh.natives, story: this.story.snapshot(),
      alloys: s.alloys, cryo: s.cryo, gen: this.power.gen, draw: this.power.draw, short: this.power.short,
      stored: s.stored, storageMax: this.power.storageMax, daylight: this.power.daylight,
      radar, nextPack: radar ? Math.max(0, (s.waves.next - s.tick) / TICK_HZ) : null, packs,
      fab: { queued: s.fab.queued, progress: s.fab.progress }, people: this.people.snapshot(), over: s.over, stats: { ...s.stats },
    };
  }
}
