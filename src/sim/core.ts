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
import { regionHeightRaw, regionTerrain, setRegionTerrain } from '../world/planet';
import { daylight } from './daylight';
import { PathGrid, moveOf, offLimits, type Move } from './path';
import { Inhabitants, campSites } from './inhabitants';
import { People } from './people';
import { Story } from './story';
import { Missions } from './missions';
import type { Colonist } from './people-types';
import { compass, depositFor, factoryMakes, gateSnap, isBarrier, linePoints, placeProblem, seamFor, wallsUnderGate, type PlaceWorld } from './rules';
import {
  FOG_CELL, FOG_N, MAX_HOSTILES, REGION_HALF, TICK_HZ,
  type Building, type Command, type EventCue, type PlaySetup, type Drone, type DroneSnap, type Hostile, type SimState, type Snapshot, type Unit, type UnitSnap,
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
  setRegionTerrain(regionTerrain(REGION, content.bodies));
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
/** How far from the centre things may go (read per use: the region's size is set per region). */
const limit = () => REGION_HALF - 6;
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
/** Ground units board a transport within this of its hull, across the shallows (u). */
const BOARD_REACH = 7;
/** A transport lands its cargo on dry ground within this of its hull (u). */
const LAND_REACH = 16;
/** Sea creatures join a pack only if there's open water this close to its spawn (u). */
const SEA_REACH = 40;
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
    case 'rail': return FX.RAIL;
    case 'spit': return FX.SPIT;
    default: return FX.BITE;
  }
}
const dieFx = (radius: number) => (radius >= 1.2 ? FX.DIE_BIG : FX.DIE_SMALL);
/** The fauna unit that grows on predator spawns (content: a unit with `nest`), if any. */
const NEST_UNIT = Object.keys(content.units).sort().find((k) => content.units[k].nest);
/** Field Engineers strip a wreck this fast (alloys/s), standing within reach of it. */
const SALVAGE_RATE = 4;
/** How close (beyond an engineer's repair reach) a wreck must be to salvage it. */
const WRECK_R = 4;
/** Nest guards come out at most this often (s). */
const GUARD_CD = 12;
/** Seconds a Field Engineer takes to re-tune a grid node (with Relic Studies). */
const TUNE_SECONDS = 20;
/** The unit record for a relic part (content: faction relic, `relic` = part). */
const relicUnit = (part: 'sentinel' | 'node') => Object.keys(content.units).sort().find((k) => content.units[k].faction === 'relic' && content.units[k].relic === part);
/** Fauna that join packs on their own (packEvery), in id order so runs are reproducible. */
const PACK_EXTRAS = Object.entries(content.units)
  .filter(([id, u]) => u.faction === 'fauna' && (u.packEvery ?? 0) > 0 && id !== 'swarmer')
  .sort(([a], [b]) => a.localeCompare(b));

export class Sim {
  s!: SimState;
  private fx: number[] = [];
  /** Colonists' paths: every building blocks (they walk round gates too). */
  private grid = new PathGrid(limit());
  /** Combat units' paths, per movement type (built on first use): buildings but not gates block. */
  private unitGrids: Partial<Record<Move, PathGrid>> = {};
  /** Fauna's paths, per movement type: terrain only (they go round water, but walk up to walls and chew through them). */
  private faunaGrids: Partial<Record<Move, PathGrid>> = {};
  /** Fog of war: in sight now / ever seen (mirrored into s.explored for saves). */
  private vis = new Uint8Array(FOG_N * FOG_N);
  private exp = new Uint8Array(FOG_N * FOG_N);
  private slotsUsed = 0;
  /** Tick of the last "burrower surfaced" warning (so a pack doesn't spam it). */
  private lastEmerge = -1e9;
  /** Tick of the last "nest is letting out its guards" warning. */
  private lastGuards = -1e9;
  /** Power result of the last tick. */
  power = { gen: 0, draw: 0, short: 0, storageMax: 0, daylight: 1 };

  /** Colonists, embryos, pods, food and Trust. */
  readonly people: People = new People(this);
  /** Inhabitant camps: regard, first contact, trust. */
  readonly inhabitants: Inhabitants = new Inhabitants(this);
  /** Story events: triggers, cards, effects. */
  readonly story: Story = new Story(this, () => ({ id: REGION_ID, sites: REGION.sites ?? [] }));
  /** Missions: objectives, rewards, what comes next. */
  readonly missions: Missions = new Missions(this, () => ({ id: REGION_ID, sites: REGION.sites ?? [] }));

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
    this.missions.init();
    s.buildings.push({ id: 1, kind: 'core', x: 0, z: 0, progress: 1, hp: DEFS.core.hp, on: true, powered: true });
    s.drones.push({ id: s.nextId++, x: 0, z: -14, heading: Math.PI, hp: RULES.droneHp, task: { kind: 'idle' } });
    // herds come from the region map (content/regions/<id>.json)
    REGION.herds.forEach((hd, herd) => {
      s.herds.push({ x: hd.x, z: hd.z });
      for (let i = 0; i < hd.grazers; i++) {
        const x = clamp(hd.x + (this.rnd() - 0.5) * 30, -limit(), limit());
        const z = clamp(hd.z + (this.rnd() - 0.5) * 30, -limit(), limit());
        s.fauna.push({ x, z, heading: this.rnd() * Math.PI * 2, tx: x, tz: z, herd });
      }
    });
    this.slotsUsed = 0;
    s.wrecks = this.regionWrecks();
    s.isotopes = 0;
    s.seams = this.regionSeams();
    s.research = { done: [], active: null };
    this.initNests();
    this.initRelics();
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
    this.missions.load();
    if (this.s.phase !== 'deployed') { this.s.phase = 'deployed'; this.s.panic = 0; }
    this.slotsUsed = [...state.hostiles, ...state.units].reduce((m, h) => Math.max(m, h.slot + 1), 0);
    state.wrecks ??= this.regionWrecks();
    state.isotopes ??= 0;
    state.seams ??= this.regionSeams();
    state.research ??= { done: [], active: null };
    if (!state.relics) this.initRelics();
    // research that no longer exists in content is dropped (its cost is lost)
    if (state.research.active && !content.research[state.research.active.id]) state.research.active = null;
    if (!state.nests) this.initNests();
    else state.nests = state.nests.filter((n) => n.spawn < this.spawns().length);
    this.exp.fill(0);
    const ex = state.explored;
    if (ex?.length === this.exp.length) for (let i = 0; i < ex.length; i++) this.exp[i] = ex.charCodeAt(i) === 49 ? 1 : 0;
    this.stepFog(true);
  }

  /** The region's predator spawns (a corner if it has none). */
  private spawns(): { x: number; z: number; nest?: boolean }[] {
    return REGION.spawns?.length ? REGION.spawns : [{ x: limit() - 10, z: limit() - 10 }];
  }

  private regionSeams() {
    return (REGION.seams ?? []).map((v) => ({ x: v.x, z: v.z, isotopes: v.isotopes, max: v.isotopes }));
  }

  /** Has this research been done? (Records without a research gate are always available.) */
  researched(id?: string) {
    return !id || !content.research[id] || !!this.s.research?.done.includes(id);
  }

  private regionWrecks() {
    return (REGION.wrecks ?? []).map((w) => ({ x: w.x, z: w.z, yaw: ((w.yaw ?? 0) * Math.PI) / 180, alloys: w.alloys, max: w.alloys }));
  }

  /** A nest on every spawn that has one (none without a nest unit in content). */
  private initNests() {
    const s = this.s;
    s.nests = [];
    if (!NEST_UNIT) return;
    this.spawns().forEach((sp, i) => {
      if (sp.nest === false) return;
      const n = { spawn: i, id: -1, regrow: 0 };
      s.nests!.push(n);
      this.growNest(n);
    });
  }

  private growNest(n: { spawn: number; id: number; regrow: number }) {
    const s = this.s, sp = this.spawns()[n.spawn], slot = this.freeSlot();
    if (!sp || !NEST_UNIT || slot < 0) return false;
    const hp = content.units[NEST_UNIT].hp, id = s.nextId++;
    s.hostiles.push({ id, unit: NEST_UNIT, slot, x: sp.x, z: sp.z, heading: this.rnd() * Math.PI * 2, hp, target: -1, cd: 0, pack: -1, nest: n.spawn, lastHp: hp });
    n.id = id;
    return true;
  }

  /** Relic grids from the region map: sentinels and nodes asleep, caches sealed. */
  private initRelics() {
    const s = this.s;
    const R = (s.relics = { grids: {} as Record<string, { woke: boolean; open: boolean }>, caches: [] as NonNullable<SimState['relics']>['caches'] });
    for (const r of REGION.relics ?? []) {
      R.grids[r.grid] ??= { woke: false, open: false };
      if (r.kind === 'cache') { R.caches.push({ x: r.x, z: r.z, grid: r.grid, alloys: r.alloys ?? 0, isotopes: r.isotopes ?? 0, opened: false }); continue; }
      const unit = relicUnit(r.kind), slot = this.freeSlot();
      if (!unit || slot < 0) continue;
      s.hostiles.push({ id: s.nextId++, unit, slot, x: r.x, z: r.z, heading: this.rnd() * Math.PI * 2, hp: content.units[unit].hp, target: -1, cd: 0, pack: -1, relic: r.grid, dormant: true });
    }
  }

  /**
   * Relic grids: anything of ours within a relic's aggro wakes its grid (E2 Handshake): it scans
   * us and every other sentinel stands down. When a grid has no nodes left it powers off and
   * its caches open.
   */
  private stepRelics() {
    const s = this.s, R = s.relics;
    if (!R || s.tick % 5) return;
    for (const [id, g] of Object.entries(R.grids)) {
      if (g.open) continue;
      const members = s.hostiles.filter((h) => h.relic === id);
      if (!g.woke) {
        const near = (x: number, z: number, r: number) =>
          this.units.some((u) => Math.hypot(u.x - x, u.z - z) < r) || s.drones.some((d) => Math.hypot(d.x - x, d.z - z) < r) ||
          s.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < r + bodyR(b));
        if (members.some((h) => near(h.x, h.z, this.unitDef(h).aggro))) {
          g.woke = true;
          const sentinels = members.filter((h) => this.unitDef(h).relic === 'sentinel').sort((a, b) => a.id - b.id);
          sentinels.forEach((h, i) => { h.dormant = i % 2 === 1; });
          for (const h of members) if (this.unitDef(h).relic === 'node') h.dormant = false;
          const down = sentinels.filter((h) => h.dormant).length;
          this.emit(`Relic grid waking. It's scanning us... firmware lineage 97.3% match. ${down ? `${down} of its ${sentinels.length} sentinels stand down.` : 'Nothing stands down.'} Destroy its nodes to shut it off.`, 'bad', 'alarm');
          for (const f of ['relic-woke', `relic-${id}-woke`]) if (this.story.s && !this.story.has(f)) this.story.s.flags.push(f);
        }
      }
      if (members.some((h) => this.unitDef(h).relic === 'node')) continue;
      // no nodes left: the grid powers off, its caches open
      g.open = g.woke = true;
      for (const h of members) h.dormant = true;
      s.stats.relicsDown = (s.stats.relicsDown ?? 0) + 1;
      let alloys = 0, iso = 0;
      for (const c of R.caches) if (c.grid === id && !c.opened) { c.opened = true; alloys += c.alloys; iso += c.isotopes; }
      s.alloys += alloys;
      s.isotopes = (s.isotopes ?? 0) + iso;
      this.emit(`The relic grid powers down.${alloys || iso ? ` Its cache opens: +${alloys} alloys${iso ? `, +${iso} isotopes` : ''}.` : ''}`, 'info', 'packCleared');
      for (const f of ['relic-opened', `relic-${id}-opened`]) if (this.story.s && !this.story.has(f)) this.story.s.flags.push(f);
    }
  }

  /** With Relic Studies, a Field Engineer with nothing to mend re-tunes a grid node in reach. True if tuning. */
  private tune(u: Unit, d: UnitDef) {
    const s = this.s;
    if (!this.researched('relic-studies') || !content.research['relic-studies']) return false;
    for (const h of s.hostiles) {
      const hd = this.unitDef(h);
      if (hd.relic !== 'node' || Math.hypot(h.x - u.x, h.z - u.z) > d.range + d.radius + hd.radius + 2) continue;
      h.tune = (h.tune ?? 0) + DT / TUNE_SECONDS;
      u.heading = Math.atan2(h.x - u.x, h.z - u.z);
      if ((s.tick + u.id) % 6 === 0) this.fx.push(FX.REPAIR, u.x, u.z, h.x, h.z);
      if (h.tune >= 1) {
        s.hostiles.splice(s.hostiles.indexOf(h), 1);
        this.fx.push(FX.EMERGE, h.x, h.z, 0, 0);
        this.emit('Grid Node re-tuned: it answers to our handshake now and lets its grid go', 'info', 'online');
      }
      return true;
    }
    return false;
  }

  /** Destroyed nests grow back after the regrow time. */
  private stepNests() {
    const s = this.s;
    for (const n of s.nests ?? []) {
      if (n.id >= 0) {
        if (!s.hostiles.some((h) => h.id === n.id)) { n.id = -1; n.regrow = s.tick + Math.round((THREATS.nestRegrow ?? 600) * TICK_HZ); }
      } else if (s.tick >= n.regrow && this.growNest(n)) {
        const sp = this.spawns()[n.spawn];
        this.emit(`A nest has grown back ${compass(sp.x, sp.z)} of the Core. Packs will come from there again.`, 'warn', 'warning');
      }
    }
  }

  /** A nest: never moves; when hurt it lets out its guards. */
  private stepNest(h: Hostile, u: UnitDef) {
    const s = this.s;
    if (u.guards && h.hp < (h.lastHp ?? h.hp) - 0.01 && h.cd <= 0) {
      h.cd = GUARD_CD;
      const pack = { id: s.nextId++, size: u.guards, alive: 0, announced: true, from: compass(h.x, h.z) };
      for (let i = 0; i < u.guards; i++) {
        const slot = this.freeSlot();
        if (slot < 0) break;
        const a = this.rnd() * Math.PI * 2, r = u.radius + 1.5 + this.rnd() * 2;
        s.hostiles.push({ id: s.nextId++, unit: 'swarmer', slot, x: clamp(h.x + Math.cos(a) * r, -limit(), limit()), z: clamp(h.z + Math.sin(a) * r, -limit(), limit()), heading: a, hp: content.units.swarmer.hp, target: -1, cd: this.rnd(), pack: pack.id });
        pack.alive++;
      }
      if (pack.alive) {
        s.packs.push(pack);
        if (s.tick - this.lastGuards > 30 * TICK_HZ) { this.lastGuards = s.tick; this.emit('The nest is letting out its guards', 'warn', 'warning'); }
      }
    }
    h.lastHp = h.hp;
  }

  /** Field Engineers with nothing to mend strip a wreck in reach. True if salvaging. */
  private salvage(u: Unit, d: UnitDef) {
    const s = this.s;
    for (const w of s.wrecks ?? []) {
      if (w.alloys <= 0 || Math.hypot(w.x - u.x, w.z - u.z) > d.range + d.radius + WRECK_R) continue;
      const take = Math.min(w.alloys, SALVAGE_RATE * DT);
      w.alloys -= take;
      s.alloys += take;
      s.stats.salvaged = (s.stats.salvaged ?? 0) + take;
      u.heading = Math.atan2(w.x - u.x, w.z - u.z);
      if ((s.tick + u.id) % 6 === 0) this.fx.push(FX.REPAIR, u.x, u.z, w.x, w.z);
      if (w.alloys <= 0) this.emit(`Wreck stripped: ${w.max} alloys salvaged in all`, 'info', 'online');
      return true;
    }
    return false;
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
  private get world(): PlaceWorld { return { buildings: this.s.buildings, deposits: this.s.deposits, vents: VENTS, seams: this.s.seams, campSites: campSites(this.s.camps ?? []) }; }
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
      this.stepResearch();
      this.stepMining();
      this.stepTurrets();
      this.stepRepairPads();
      this.stepUnits();
      this.stepHostiles();
      this.stepNests();
      this.stepRelics();
      this.stepWaves();
      this.stepCryo();
      this.people.step();
      this.inhabitants.step();
      this.story.step();
      this.stepEncounters();
      this.missions.step();
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
      if (d.role === 'reactor') {
        // steady power while it has fuel: no isotopes, no power
        const need = (d.fuelRate ?? 0) * DT;
        if ((s.isotopes ?? 0) >= need) { s.isotopes = (s.isotopes ?? 0) - need; gen += d.powerMW * this.people.mult(b); b.powered = true; }
        else if (!b.starved) { b.starved = true; this.emit(`${d.name} is out of isotopes: no power from it`, 'warn', 'warning'); }
        if ((s.isotopes ?? 0) >= need * 20) b.starved = false;
        continue;
      }
      if (d.powerMW > 0) { gen += (d.role === 'solar' ? d.powerMW * this.solarFactor() : d.powerMW) * this.people.mult(b); b.powered = true; }
      else if (d.powerMW < 0) {
        // homes and growth pods share the cryo bank's priority; farms run with the radar
        const rank = d.fireRange ? 0 : d.role === 'civic' ? 1 : d.role === 'radar' || d.role === 'factory' || d.role === 'repair' || d.role === 'farm' || d.role === 'sensor' || d.role === 'relay' ? 2 : 3;
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
    for (const c of s.relics?.caches ?? []) if (!c.found && this.visible(c.x, c.z)) c.found = true;
    for (const w of s.wrecks ?? []) {
      if (w.found || !this.visible(w.x, w.z)) continue;
      w.found = true;
      if (this.story.s && !this.story.has('wreck-found')) this.story.s.flags.push('wreck-found');
      if (this.deployed) this.emit(`Wreck sighted ${compass(w.x, w.z)} of the Core. Field Engineers can salvage it.`, 'warn', 'warning');
    }
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
      let gx = b.x + fx * ahead + fz * side, gz = b.z + fz * ahead - fx * side;
      let ux = b.x + fx * out, uz = b.z + fz * out;
      // a boat is launched on the water side (the nearest open water to the door), and moors out on it
      const m = moveOf(ud);
      if (m === 'water') {
        const g = this.faunaGrid('water');
        const at = g.openNear(ux, uz, 30) ?? g.openNear(b.x, b.z, 40);
        if (at) {
          ux = at.x; uz = at.z;
          const away = Math.atan2(at.x - b.x, at.z - b.z), moor = g.openNear(at.x + Math.sin(away) * (6 + side), at.z + Math.cos(away) * (6 + side), 12) ?? at;
          gx = moor.x; gz = moor.z;
        }
      }
      this.units.push({
        id: s.nextId++, unit: kind, slot, x: ux, z: uz, heading: yaw + Math.PI, hp: ud.hp, cd: 0,
        order: { kind: 'move', x: gx, z: gz }, gx, gz, target: -1,
      });
      this.emit(`${ud.name} ready${b.queue.length ? ` · ${b.queue.length} more queued` : ''}`, 'info', 'unitReady');
    }
  }

  /** The research under way moves on at the best powered Tech Lab (staff speed it up). */
  private stepResearch() {
    const s = this.s, a = s.research?.active;
    if (!a) return;
    const r = content.research[a.id];
    if (!r) { s.research!.active = null; return; }
    let rate = 0;
    for (const b of s.buildings) if (b.progress >= 1 && b.powered && def(b)?.role === 'lab') rate = Math.max(rate, this.people.mult(b));
    for (const b of s.buildings) if (def(b)?.role === 'lab') b.engaged = rate > 0;
    if (!rate) return;
    a.progress = Math.min(1, a.progress + (DT * rate) / Math.max(1, r.seconds));
    if (a.progress < 1) return;
    s.research!.done.push(a.id);
    s.research!.active = null;
    s.stats.researched = (s.stats.researched ?? 0) + 1;
    const unlocks = [...Object.values(DEFS), ...Object.values(content.units)].filter((x) => x.research === a.id).map((x) => x.name);
    this.emit(`Research complete: ${r.name}${unlocks.length ? ` · unlocks ${unlocks.join(', ')}` : ''}`, 'info', 'online');
    const flag = `research-${a.id}`;
    if (this.story.s && !this.story.has(flag)) this.story.s.flags.push(flag);
  }

  // ---------- mining ----------
  private stepMining() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (d.role === 'deepmine' && b.progress >= 1) {
        const seams = s.seams ?? [];
        if (b.mining === undefined || b.mining < 0 || !seams[b.mining] || seams[b.mining].isotopes <= 0) b.mining = seamFor(this.world, DEFS, d, b.x, b.z);
        if (!b.powered || b.mining < 0) continue;
        const sm = seams[b.mining];
        const take = Math.min(sm.isotopes, (d.mineRate ?? 0) * this.people.mult(b) * DT);
        sm.isotopes -= take;
        s.isotopes = (s.isotopes ?? 0) + take;
        s.stats.isotopesMined = (s.stats.isotopesMined ?? 0) + take;
        if (sm.isotopes <= 0) this.emit(`Isotope seam ${compass(sm.x, sm.z)} of the Core is exhausted`, 'warn');
        continue;
      }
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
    return !h.under && !h.dormant && this.visible(h.x, h.z);
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

  /** A unit on its way to board a transport: aboard (true) once it's alongside, else on its way to the shore by it. */
  private stepBoarding(u: Unit, d: UnitDef) {
    const t = this.units.find((x) => x.id === u.ride);
    const td = t && content.units[t.unit];
    if (!t || !td?.carries || (t.cargo?.length ?? 0) >= td.carries) { u.ride = undefined; this.arrive(u); return false; }
    if (Math.hypot(t.x - u.x, t.z - u.z) < td.radius + d.radius + BOARD_REACH) {
      (t.cargo ??= []).push(u);
      u.ride = undefined; u.slot = -1; u.target = -1; u.path = undefined; u.goal = undefined; u.order = { kind: 'idle' };
      if (t.cargo.length === td.carries || !this.units.some((o) => o !== u && o.ride === t.id)) this.emit(`${td.name}: ${t.cargo.length} aboard`, 'info');
      return true;
    }
    this.goTo(u, t.x, t.z, d.speed); // as near as the land goes: the transport comes in to meet it
    return false;
  }

  /** A transport landing its cargo: to the water nearest the drop point, then everyone ashore. */
  private stepLanding(t: Unit, d: UnitDef) {
    const o = t.drop!;
    if (!t.cargo?.length) { t.drop = undefined; this.arrive(t); return; }
    const there = Math.hypot(o.wx - t.x, o.wz - t.z) < 3;
    if (!there && this.goTo(t, o.wx, o.wz, d.speed)) return;
    // there, or as close as the water goes: ashore on the nearest dry ground
    // the bit of shore that leads on to the drop point (not a sandbar on the way), else any
    const g = this.unitGrid('ground'), shore = g.openNear(t.x, t.z, LAND_REACH, o) ?? g.openNear(t.x, t.z, LAND_REACH);
    if (!shore) { if (!there) return; t.drop = undefined; this.arrive(t); this.emit(`${d.name}: no shore close enough to land on`, 'warn', 'deny'); return; }
    let n = 0;
    while (t.cargo.length) {
      const slot = this.freeSlot();
      if (slot < 0) break;
      const u = t.cargo.shift()!, a = n * 2.39996, r = n ? SPREAD * Math.sqrt(n) * 0.6 : 0;
      const at = g.openNear(shore.x + Math.cos(a) * r, shore.z + Math.sin(a) * r, 8) ?? shore;
      u.slot = slot; u.x = at.x; u.z = at.z; u.heading = t.heading; u.target = -1;
      const r2 = SPREAD * Math.sqrt(n);
      u.order = { kind: 'move', x: clamp(o.x + Math.cos(a) * r2, -limit(), limit()), z: clamp(o.z + Math.sin(a) * r2, -limit(), limit()) };
      u.gx = u.order.x; u.gz = u.order.z;
      this.units.push(u);
      n++;
    }
    if (n) this.emit(`${d.name}: ${n} landed`, 'info', 'unitReady');
    if (!t.cargo.length) { t.drop = undefined; this.arrive(t); }
  }

  /** Send a loaded transport to land its cargo at (x, z) on land: it makes for the nearest water to it. */
  private sendToLand(t: Unit, x: number, z: number) {
    const w = this.unitGrid('water').openNear(x, z, 140, t);
    if (!w) return false;
    t.drop = { x, z, wx: w.x, wz: w.z };
    t.order = { kind: 'move', x: w.x, z: w.z };
    t.target = -1;
    return true;
  }

  /** Combat units in the field plus those aboard transports (the army limit counts both). */
  private armySize() { return this.units.reduce((m, u) => m + 1 + (u.cargo?.length ?? 0), 0); }

  private unitGrid(m: Move) { return (this.unitGrids[m] ??= new PathGrid(limit(), m)); }
  private faunaGrid(m: Move) { return (this.faunaGrids[m] ??= new PathGrid(limit(), m)); }

  /**
   * Whether a predator can get close enough to hit something at (x, z) (`r` = its body radius):
   * ground fauna can't cross water to an island, sea creatures can't leave the water. Hover,
   * burrowing and rooted ones (nests, relics) aren't limited.
   */
  private canReach(h: Hostile, u: UnitDef, x: number, z: number, r: number) {
    const m = moveOf(u);
    if (m === 'hover' || h.under || u.burrows || u.speed <= 0) return true;
    return this.faunaGrid(m).reaches(h.x, h.z, x, z, r + u.range + 1.5);
  }

  /**
   * A predator heads for (tx, tz): ground fauna follow a path round water (re-planned every few
   * seconds, or when the target has moved off), hover fauna go straight.
   */
  private chase(h: Hostile, u: UnitDef, tx: number, tz: number, speed: number) {
    const move = moveOf(u);
    if (move === 'hover') { this.steer(h, tx, tz, speed, move); return; }
    const t = this.s.tick;
    const moved = !h.goal || Math.hypot(h.goal[0] - tx, h.goal[1] - tz) > 3;
    if (!h.path || (h.repath ?? 0) <= t || (moved && t - (h.planned ?? 0) >= 10)) {
      h.goal = [tx, tz];
      h.path = this.faunaGrid(move).find(h.x, h.z, tx, tz) ?? [tx, tz];
      h.planned = t;
      h.repath = t + REPATH * 2 + (h.id % 11);
    }
    const p = h.path;
    while (p.length > 2 && Math.hypot(p[0] - h.x, p[1] - h.z) < 1.5) p.splice(0, 2);
    // the last waypoint is where the target was: once there, head straight for where it is
    const [wx, wz] = p.length > 2 ? [p[0], p[1]] : [tx, tz];
    this.steer(h, wx, wz, speed, move);
  }

  /** Turn and step toward (tx, tz), sliding around water (hover movers skim over it). */
  private steer(o: { x: number; z: number; heading: number }, tx: number, tz: number, speed: number, move: Move = 'ground') {
    let ang = Math.atan2(tx - o.x, tz - o.z);
    const step = Math.min(speed * DT, Math.hypot(tx - o.x, tz - o.z));
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const a = ang + off;
      if (!this.blocked(o.x + Math.sin(a) * (step + 2), o.z + Math.cos(a) * (step + 2), move)) { ang = a; break; }
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
      u.path = this.unitGrid(moveOf(content.units[u.unit])).find(u.x, u.z, tx, tz) ?? [];
      u.repath = t + REPATH + (u.id % 7);
    }
    const p = u.path;
    while (p.length > 2 && Math.hypot(p[0] - u.x, p[1] - u.z) < 1.5) p.splice(0, 2);
    if (!p.length) return false;
    this.steer(u, p[0], p[1], speed, moveOf(content.units[u.unit]));
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
    if (us.length) {
      const bodies = s.buildings.filter((b) => def(b).role !== 'gate').map((b) => ({ x: b.x, z: b.z, r: bodyR(b) }));
      const moves = new Set(us.map((u) => moveOf(content.units[u.unit])));
      for (const m of moves) this.unitGrid(m).setBodies(bodies, PATH_PAD);
    }
    const boarded: Unit[] = [];
    for (const u of us) {
      const d = content.units[u.unit];
      u.cd = Math.max(0, u.cd - DT);
      if (u.ride !== undefined) { if (this.stepBoarding(u, d)) boarded.push(u); continue; }
      if (u.drop) { this.stepLanding(u, d); continue; }
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
      if (!d.damage) tgt = undefined; // unarmed (a transport): never chases anything
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
    for (const u of boarded) us.splice(us.indexOf(u), 1);
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
      a.x = clamp(a.x, -limit(), limit()); a.z = clamp(a.z, -limit(), limit());
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
    if (!p && (this.tune(u, d) || this.salvage(u, d)) && !moving) return;
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
    if (h.nest !== undefined) {
      const n = s.nests?.find((x) => x.id === h.id);
      const secs = THREATS.nestRegrow ?? 600;
      if (n) { n.id = -1; n.regrow = s.tick + Math.round(secs * TICK_HZ); }
      s.stats.nestsDestroyed = (s.stats.nestsDestroyed ?? 0) + 1;
      if (this.story.s && !this.story.has('nest-destroyed')) this.story.s.flags.push('nest-destroyed');
      this.emit(`Nest destroyed ${compass(h.x, h.z)} of the Core: no packs from there for ${Math.round(secs / 60)} min`, 'info', 'packCleared');
    }
    // the last of a map encounter: its "beaten" flag
    if (h.enc && !s.hostiles.some((x) => x.enc === h.enc)) {
      const e = REGION.encounters?.find((x) => x.id === h.enc);
      if (e?.doneFlag && !this.story.has(e.doneFlag)) this.story.s.flags.push(e.doneFlag);
    }
    const p = s.packs.find((x) => x.id === h.pack);
    if (p && --p.alive <= 0) {
      s.packs.splice(s.packs.indexOf(p), 1);
      s.stats.packsBeaten++;
      this.emit(`Pack from the ${p.from} destroyed (${s.stats.packsBeaten} so far)`, 'info', 'packCleared');
    }
  }

  private blocked(x: number, z: number, move: Move = 'ground') {
    if (Math.abs(x) > limit() || Math.abs(z) > limit()) return true;
    return offLimits(move, regionHeightRaw(x, z));
  }

  private chooseTarget(h: Hostile, u: UnitDef) {
    const s = this.s;
    let best = -1, bd = Infinity;
    const g = h.guard;
    if (g) {
      // a guard: only what comes near its post (and near it), never the base beyond
      const post = (o: { x: number; z: number }, r: number) => Math.hypot(o.x - g.x, o.z - g.z) <= r;
      for (const d of [...s.drones, ...this.units, ...this.people.outdoors()]) {
        const dist = Math.hypot(d.x - h.x, d.z - h.z);
        if (dist < Math.max(u.aggro, 6) && dist < bd && post(d, g.r * 1.6 + u.aggro)) { bd = dist; best = d.id; }
      }
      if (best >= 0) return best;
      for (const b of s.buildings) {
        const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b);
        if (dist < bd && post(b, g.r + bodyR(b))) { bd = dist; best = b.id; }
      }
      return best;
    }
    // underground, a burrower can't sense drones or units: it heads for the base (never a wall)
    if (!h.under) {
      for (const d of [...s.drones, ...this.units, ...this.people.outdoors()]) {
        const dist = Math.hypot(d.x - h.x, d.z - h.z);
        if (dist < u.aggro && dist < bd && this.canReach(h, u, d.x, d.z, 1)) { bd = dist; best = d.id; }
      }
      if (best >= 0) return best;
    }
    // nearest building it can get at (not one across the water, or inland for a sea creature)
    for (const b of s.buildings) {
      if (h.under && barrier(b)) continue;
      const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b) + (barrier(b) ? WALL_PENALTY : 0) - (def(b).lure ?? 0);
      if (dist < bd && this.canReach(h, u, b.x, b.z, bodyR(b))) { bd = dist; best = b.id; }
    }
    if (best >= 0) return best;
    // nothing it can get at: make for the nearest anyway and wait as close as it can (a sea creature off the coast)
    for (const b of s.buildings) {
      if (h.under && barrier(b)) continue;
      const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b);
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
      if (h.nest !== undefined) { this.stepNest(h, u); continue; }
      if (h.dormant || (h.relic && u.damage <= 0)) continue; // a sleeping relic, or a grid node: does nothing
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
      if (!tgt) { if (h.guard) this.stepGuard(h, u); continue; }
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
      this.chase(h, u, tgt.x, tgt.z, u.speed);
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
      const an = this.unitDef(a).speed <= 0;
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j], rb = this.unitDef(b).radius;
        if (b.under) continue;
        const bn = this.unitDef(b).speed <= 0;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = ra + rb;
        if (d > 1e-3 && d < min && !(an && bn)) {
          // a nest never moves: whoever bumps into it takes the whole push
          const push = min - d, ka = an ? 0 : bn ? 1 : 0.5, kb = 1 - ka;
          a.x -= (dx / d) * push * ka; a.z -= (dz / d) * push * ka;
          b.x += (dx / d) * push * kb; b.z += (dz / d) * push * kb;
        }
      }
      if (an) continue;
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
      a.x = clamp(a.x, -limit(), limit()); a.z = clamp(a.z, -limit(), limit());
      // never end up on the other side of a wall this tick
      if (!was[i]) continue; // spawned this tick (a nest's guards): nothing to cross yet
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

  /** Map encounters (region `encounters`): each appears once, at the start or when its flag is set. */
  private stepEncounters() {
    const list = REGION.encounters;
    if (!list?.length || this.s.tick % TICK_HZ) return;
    const st = this.story.s, seen = (st.encounters ??= []);
    for (const e of list) {
      if (seen.includes(e.id) || (e.flag && !this.story.has(e.flag))) continue;
      seen.push(e.id);
      const route = e.mode === 'patrol' && e.x2 !== undefined && e.z2 !== undefined ? [e.x, e.z, e.x2, e.z2] : undefined;
      this.spawnAt(e.unit, e.count, e.x, e.z, e.mode === 'attack' ? 0 : e.r ?? 14, route, e.id);
      // ones that turn up mid-game are news; the ones there from the start are just the map
      if (e.flag) this.emit(`${content.units[e.unit]?.name ?? e.unit}${e.count > 1 ? ` ×${e.count}` : ''} sighted ${compass(e.x, e.z)} of the Core`, 'warn', 'warning');
    }
  }

  /** A guard with nothing to fight: back to its post, or on along its route. */
  private stepGuard(h: Hostile, u: UnitDef) {
    const g = h.guard!;
    let tx = g.x, tz = g.z;
    if (g.route && g.route.length >= 2) {
      const legs = g.route.length / 2, i = (g.leg ?? 0) % legs;
      tx = g.route[i * 2]; tz = g.route[i * 2 + 1];
      if (Math.hypot(tx - h.x, tz - h.z) < 2.5) g.leg = (i + 1) % legs;
    } else if (Math.hypot(tx - h.x, tz - h.z) < Math.max(2, g.r * 0.4)) return;
    this.chase(h, u, tx, tz, u.speed * (g.route ? 0.6 : 1));
  }

  /**
   * Story spawns and map encounters: `n` of a unit at (x, z). Accord units join
   * the colony; anything else is hostile: a pack that goes for the colony, or with
   * `guardR` a guard that stays round the spot (along `route` if given).
   */
  spawnAt(unit: string, n: number, x: number, z: number, guardR = 0, route?: number[], enc?: string) {
    const s = this.s, ud = content.units[unit];
    if (!ud) return 0;
    let made = 0;
    if (ud.faction === 'accord') {
      for (let i = 0; i < n; i++) {
        const slot = this.freeSlot();
        if (slot < 0) break;
        const ux = clamp(x + (i % 4) * 3, -limit(), limit()), uz = clamp(z - Math.floor(i / 4) * 3, -limit(), limit());
        this.units.push({ id: s.nextId++, unit, slot, x: ux, z: uz, heading: 0, hp: ud.hp, cd: 0, order: { kind: 'idle' }, gx: ux, gz: uz, target: -1 });
        made++;
      }
      return made;
    }
    const pack = guardR > 0 ? null : { id: s.nextId++, size: n, alive: 0, announced: false, from: compass(x, z) };
    for (let i = 0; i < n; i++) {
      const slot = this.freeSlot();
      if (slot < 0) break;
      const a = (i / Math.max(1, n)) * Math.PI * 2, r = n > 1 ? 1.5 + Math.sqrt(i) * 1.4 : 0;
      const hx = clamp(x + Math.cos(a) * r, -limit(), limit()), hz = clamp(z + Math.sin(a) * r, -limit(), limit());
      s.hostiles.push({
        id: s.nextId++, unit, slot, x: hx, z: hz, heading: Math.atan2(-x, -z), hp: ud.hp, target: -1, cd: this.rnd(), pack: pack ? pack.id : -1,
        under: (!guardR && ud.burrows) || undefined,
        guard: guardR > 0 ? { x, z, r: guardR, route: route?.length ? [...route] : undefined, leg: 0 } : undefined, enc,
      });
      if (pack) pack.alive++;
      made++;
    }
    if (pack?.alive) s.packs.push(pack);
    return made;
  }

  /** Clear the fog within `r` of (x, z) (a reveal effect). */
  reveal(x: number, z: number, r: number) {
    const c = FOG_CELL;
    for (let j = 0; j < FOG_N; j++) for (let i = 0; i < FOG_N; i++) {
      const cx = -REGION_HALF + (i + 0.5) * c - x, cz = -REGION_HALF + (j + 0.5) * c - z;
      if (cx * cx + cz * cz <= r * r) this.exp[j * FOG_N + i] = 1;
    }
    this.stepFog(true);
  }

  /** Has region point (x, z) ever been seen? */
  explored(x: number, z: number) {
    const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
    return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && this.exp[j * FOG_N + i] === 1;
  }

  /** The story ends the game: a win, or a loss with its own words. */
  end(how: 'won' | 'story', text: string) {
    if (this.s.over) return;
    this.s.over = how;
    this.s.overText = text;
    this.emit(text || (how === 'won' ? 'The colony has won through.' : 'The colony is lost.'), how === 'won' ? 'info' : 'bad', how === 'won' ? 'packCleared' : 'alarm');
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

  /** The editor's play test setup (see PlaySetup): a colony as it might be later in the game. */
  private playSetup(p: PlaySetup) {
    const s = this.s, done: string[] = [];
    if (p.sol && p.sol > 1) {
      // move the clock on; what's scheduled moves with it (the next pack keeps its countdown)
      const to = Math.round((p.sol - 1) * RULES.solSeconds * TICK_HZ), shift = to - s.tick;
      if (shift > 0) {
        s.tick = to;
        s.waves.next += shift;
        for (const t of s.story?.timers ?? []) t.at += shift;
        for (const t of s.story?.countdowns ?? []) t.at += shift;
        done.push(`Sol ${p.sol}`);
      }
    }
    if (p.alloys) { s.alloys += p.alloys; done.push(`${p.alloys} alloys`); }
    if (p.isotopes) { s.isotopes = (s.isotopes ?? 0) + p.isotopes; done.push(`${p.isotopes} isotopes`); }
    for (const id of p.research ?? []) if (content.research[id] && !s.research!.done.includes(id)) s.research!.done.push(id);
    if (p.research?.length) done.push(`research ${p.research.join(', ')}`);
    let built = 0;
    (p.buildings ?? []).forEach((kind, n) => {
      const dd = DEFS[kind];
      if (!dd || dd.role === 'core') return;
      // where it would go: a depot by a deposit, a tap on a vent, anything else round the Core
      let tx = Math.sin(n * 2.4) * 24, tz = -Math.cos(n * 2.4) * 24;
      if (dd.role === 'depot') {
        const d = s.deposits.filter((x, i) => x.alloys > 0 && !s.buildings.some((b) => b.mining === i)).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
        if (d) { tx = d.x * 0.8; tz = d.z * 0.8; }
      } else if (dd.role === 'geothermal') {
        const v = VENTS.find((x) => !s.buildings.some((b) => Math.hypot(b.x - x.x, b.z - x.z) < 6));
        if (v) { tx = v.x; tz = v.z; }
      } else if (dd.role === 'deepmine') {
        const v = (s.seams ?? []).find((x) => x.isotopes > 0 && !s.buildings.some((b) => Math.hypot(b.x - x.x, b.z - x.z) < 6));
        if (v) { tx = v.x; tz = v.z; }
      }
      for (let r = 0; r < 80; r += 2) {
        const k = Math.max(1, Math.round(r * 1.2));
        for (let i = 0; i < k; i++) {
          const a = (i / k) * Math.PI * 2, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
          if (placeProblem(this.world, DEFS, RULES, kind, x, z)) continue;
          s.buildings.push({ id: s.nextId++, kind, x, z, yaw: 0, progress: 1, hp: dd.hp, on: true, powered: false });
          built++;
          return;
        }
      }
    });
    if (built) done.push(`${built} building${built > 1 ? 's' : ''}`);
    if (p.colonists) { this.people.debug({ colonists: p.colonists }); done.push(`${p.colonists} colonist${p.colonists > 1 ? 's' : ''}`); }
    for (const f of p.flags ?? []) if (f && !this.story.has(f)) this.story.s.flags.push(f);
    if (p.flags?.length) done.push(`flags ${p.flags.join(', ')}`);
    if (p.peaceful) { s.waves.next = Number.MAX_SAFE_INTEGER; done.push('no predators'); }
    if (done.length) this.emit(`Play test: ${done.join(' · ')}`, 'info');
  }

  /**
   * Inspector: move the clock on `secs` seconds without playing them (story
   * delays, countdowns and the next pack keep their time left).
   */
  skip(secs: number) {
    const s = this.s, shift = Math.round(secs * TICK_HZ);
    s.tick += shift;
    s.waves.next += shift;
    this.emit(`Inspector: skipped ${Math.round(secs / 60 * 10) / 10} min`, 'info');
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
    const aboard = u.cargo?.length ?? 0;
    s.stats.unitsLost = (s.stats.unitsLost ?? 0) + 1 + aboard;
    this.fx.push(dieFx(content.units[u.unit].radius), u.x, u.z, 0, 0);
    this.emit(`${content.units[u.unit].name} destroyed${aboard ? ` with ${aboard} aboard` : ''}`, 'bad', 'lost');
    for (const o of this.units) if (o.ride === u.id) { o.ride = undefined; this.arrive(o); }
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
    const spawns = this.spawns();
    // packs only come from spawns whose nest stands (or that have none)
    const open = spawns.filter((sp, i) => sp.nest === false || !NEST_UNIT || (s.nests ?? []).some((n) => n.spawn === i && n.id >= 0));
    if (!open.length) { w.next = s.tick + 30 * TICK_HZ; return; }
    const sp = open[Math.floor(this.rnd() * open.length)];
    const pack = { id: s.nextId++, size, alive: 0, announced: false, from: compass(sp.x, sp.z) };
    for (let i = 0; i < size; i++) {
      const k = ++w.spawned;
      let unit = 'swarmer';
      if (THREATS.bruteEvery > 0 && k % THREATS.bruteEvery === 0) unit = 'brute';
      else for (const [id, x] of PACK_EXTRAS) {
        if (w.n < (x.packFrom ?? 0) || k % x.packEvery! !== 0) continue;
        // a sea creature only comes with a pack that has water near its spawn
        if (moveOf(x) === 'water' && !this.faunaGrid('water').openNear(sp.x, sp.z, SEA_REACH)) continue;
        unit = id; break;
      }
      const slot = this.freeSlot();
      if (slot < 0) break;
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * 7;
      let hx = clamp(sp.x + Math.cos(a) * r, -limit(), limit()), hz = clamp(sp.z + Math.sin(a) * r, -limit(), limit());
      if (moveOf(content.units[unit]) === 'water') {
        const at = this.faunaGrid('water').openNear(hx, hz, SEA_REACH + 8);
        if (at) { hx = at.x; hz = at.z; }
      }
      s.hostiles.push({
        id: s.nextId++, unit, slot, x: hx, z: hz,
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
      if (Math.abs(x) < limit() - 15 && Math.abs(z) < limit() - 15 && Math.hypot(x, z) > 50) return { x, z };
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
        f.tx = clamp(c.x + (this.rnd() - 0.5) * 44, -limit(), limit());
        f.tz = clamp(c.z + (this.rnd() - 0.5) * 44, -limit(), limit());
        tx = f.tx; tz = f.tz;
      }
      // keep grazers out of the base
      for (const b of s.buildings) {
        const r = b.kind === 'core' ? CORE_KEEP_OUT : bodyR(b) + 4;
        const dx = f.x - b.x, dz = f.z - b.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-3) { tx = b.x + (dx / d) * (r + 8); tz = b.z + (dz / d) * (r + 8); }
      }
      if (Math.hypot(tx - f.x, tz - f.z) > 0.4) this.approach(f, tx, tz, sp, sp > WALK ? 9 : 2.5);
      f.x = clamp(f.x, -limit(), limit());
      f.z = clamp(f.z, -limit(), limit());
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
        d.task = { kind: 'move', x: clamp(c.x, -limit(), limit()), z: clamp(c.z, -limit(), limit()) };
        d.manual = true;
        return;
      }
      case 'build': {
        const dd = DEFS[c.kind];
        if (!dd || !dd.buildable) return;
        if (this.story.locked(c.kind)) { this.emit(`${dd.name} isn't available yet`, 'warn', 'deny'); return; }
        if (!this.researched(dd.research)) { this.emit(`${dd.name} needs research: ${content.research[dd.research!]?.name}`, 'warn', 'deny'); return; }
        if (s.alloys < dd.cost) { this.emit(`Not enough alloys for a ${dd.name} (${dd.cost} needed)`, 'warn', 'deny'); return; }
        if ((s.isotopes ?? 0) < (dd.isotopes ?? 0)) { this.emit(`Not enough isotopes for a ${dd.name} (${dd.isotopes} needed)`, 'warn', 'deny'); return; }
        let { x, z } = c, yaw = c.yaw ?? 0;
        // a gate dropped by a wall snaps onto its line
        const sn = dd.role === 'gate' ? gateSnap(this.world, DEFS, x, z) : null;
        if (sn) ({ x, z, yaw } = sn);
        const why = placeProblem(this.world, DEFS, RULES, c.kind, x, z);
        if (why) { this.emit(`Can't build there: ${why}`, 'warn', 'deny'); return; }
        s.alloys -= dd.cost;
        s.isotopes = (s.isotopes ?? 0) - (dd.isotopes ?? 0);
        let swapped = 0;
        if (dd.role === 'gate') {
          for (const w of wallsUnderGate(s.buildings, DEFS, dd, x, z, yaw)) {
            s.alloys += def(w).cost * 0.5 * (w.progress >= 1 ? w.hp / maxHp(w) : 1);
            s.buildings.splice(s.buildings.indexOf(w), 1);
            swapped++;
          }
        }
        s.buildings.push({ id: s.nextId++, kind: c.kind, x, z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
        this.story.placed(c.kind);
        this.emit(`${dd.name} placed${swapped ? ` · replaces ${swapped} wall segment${swapped > 1 ? 's' : ''}` : ''}${s.drones.length ? '' : ' · waiting for a drone'}`, 'info', 'placed');
        return;
      }
      case 'buildLine': {
        const dd = DEFS[c.kind];
        if (!dd || !dd.buildable || this.story.locked(c.kind)) return;
        const { pts, yaw } = linePoints(dd, c.x1, c.z1, c.x2, c.z2);
        let placed = 0, skipped = 0, poor = false;
        for (const p of pts) {
          if (s.alloys < dd.cost) { poor = true; break; }
          if (placeProblem(this.world, DEFS, RULES, c.kind, p.x, p.z)) { skipped++; continue; }
          s.alloys -= dd.cost;
          s.buildings.push({ id: s.nextId++, kind: c.kind, x: p.x, z: p.z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
          placed++;
        }
        if (placed) this.story.placed(c.kind);
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
      case 'cinematic':
        this.story.cineDone(c.id);
        return;
      case 'ui':
        this.story.opened(c.what);
        return;
      case 'inspect': {
        const st = this.story.s;
        if (c.flag && !st.flags.includes(c.flag)) st.flags.push(c.flag);
        if (c.unflag) st.flags = st.flags.filter((f) => f !== c.unflag);
        if (c.counter) (st.counters ??= {})[c.counter.id] = c.counter.value;
        if (c.objective) this.missions.mark(c.objective.mission, c.objective.index);
        if (c.finish) this.missions.complete(c.finish);
        if (c.fail) this.missions.fail(c.fail, 'failed from the story inspector');
        if (c.expire) { st.countdowns = (st.countdowns ?? []).filter((x) => x.id !== c.expire); if (!(st.expired ??= []).includes(c.expire)) st.expired.push(c.expire); }
        if (c.unlock && st.locked) st.locked = st.locked.filter((x) => x !== c.unlock);
        if (c.skip && c.skip > 0) this.skip(c.skip);
        return;
      }
      case 'debug': {
        if (c.setup) this.playSetup(c.setup);
        if (c.story) this.story.fire(c.story);
        if (c.cinematic) this.story.playCine(c.cinematic);
        if (c.mission) this.missions.jump(c.mission);
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
            const x = clamp(sp.x + (i % 4) * 3, -limit(), limit()), z = clamp(sp.z - Math.floor(i / 4) * 3, -limit(), limit());
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
        if (!factoryMakes(def(b), ud)) { this.emit(`The ${def(b).name} can't build a ${ud.name}`, 'warn', 'deny'); return; }
        if (this.story.locked(c.unit)) { this.emit(`${ud.name} isn't available yet`, 'warn', 'deny'); return; }
        const queued = s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0);
        if (this.armySize() + queued >= RULES.maxUnits) { this.emit(`Combat unit limit reached (${RULES.maxUnits})`, 'warn', 'deny'); return; }
        if (!this.researched(ud.research)) { this.emit(`${ud.name} needs research: ${content.research[ud.research!]?.name}`, 'warn', 'deny'); return; }
        if (s.alloys < ud.cost) { this.emit(`Not enough alloys for a ${ud.name} (${ud.cost} needed)`, 'warn', 'deny'); return; }
        if ((s.isotopes ?? 0) < (ud.isotopes ?? 0)) { this.emit(`Not enough isotopes for a ${ud.name} (${ud.isotopes} needed)`, 'warn', 'deny'); return; }
        s.alloys -= ud.cost;
        s.isotopes = (s.isotopes ?? 0) - (ud.isotopes ?? 0);
        (b.queue ??= []).push(c.unit);
        if (b.queue.length === 1) b.prod = 0;
        return;
      }
      case 'unqueue': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (!b?.queue?.length) return;
        const k = b.queue.pop()!;
        s.alloys += content.units[k]?.cost ?? 0;
        s.isotopes = (s.isotopes ?? 0) + (content.units[k]?.isotopes ?? 0);
        if (!b.queue.length) b.prod = 0;
        return;
      }
      case 'order': {
        let sel = this.units.filter((u) => c.ids.includes(u.id));
        const x = clamp(c.x, -limit(), limit()), z = clamp(c.z, -limit(), limit());
        for (const u of sel) { u.ride = undefined; u.drop = undefined; }
        // a loaded transport sent to a spot on land goes to land its cargo there
        if (!offLimits('ground', regionHeightRaw(x, z))) sel = sel.filter((u) => !(u.cargo?.length && this.sendToLand(u, x, z)));
        // spread out around the point (sunflower), nearest units take the inner spots
        sel.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        sel.forEach((u, i) => {
          const r = SPREAD * Math.sqrt(i) * (i ? 1 : 0), a = i * 2.39996;
          const ox = clamp(x + Math.cos(a) * r, -limit(), limit()), oz = clamp(z + Math.sin(a) * r, -limit(), limit());
          u.order = { kind: 'move', x: ox, z: oz };
          u.target = -1;
        });
        return;
      }
      case 'stop': {
        for (const u of this.units) if (c.ids.includes(u.id)) { u.order = { kind: 'idle' }; u.gx = u.x; u.gz = u.z; u.ride = undefined; u.drop = undefined; }
        return;
      }
      case 'board': {
        const t = this.units.find((u) => u.id === c.transport), td = t && content.units[t.unit];
        if (!t || !td?.carries) return;
        // ground units only, as many as there's room for (nearest first)
        const room = td.carries - (t.cargo?.length ?? 0) - this.units.filter((u) => u.ride === t.id && !c.ids.includes(u.id)).length;
        const riders = this.units.filter((u) => c.ids.includes(u.id) && u !== t && !content.units[u.unit].carries && moveOf(content.units[u.unit]) === 'ground')
          .sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z)).slice(0, Math.max(0, room));
        if (!riders.length) { this.emit(room <= 0 ? `${td.name} is full (${td.carries})` : `Only ground units can board the ${td.name}`, 'warn', 'deny'); return; }
        for (const u of riders) { u.ride = t.id; u.drop = undefined; u.target = -1; u.order = { kind: 'idle' }; }
        // it comes in to the water nearest them
        const cx = riders.reduce((m, u) => m + u.x, 0) / riders.length, cz = riders.reduce((m, u) => m + u.z, 0) / riders.length;
        const w = this.unitGrid('water').openNear(cx, cz, 80, t);
        if (w && Math.hypot(w.x - t.x, w.z - t.z) > 4) { t.drop = undefined; t.order = { kind: 'move', x: w.x, z: w.z }; t.target = -1; }
        return;
      }
      case 'unload': {
        for (const t of this.units) {
          if (!c.ids.includes(t.id) || !t.cargo?.length) continue;
          const at = this.unitGrid('ground').openNear(t.x, t.z, 80);
          if (at) this.sendToLand(t, at.x, at.z);
        }
        return;
      }
      case 'research': {
        const r = content.research[c.id], R = (s.research ??= { done: [], active: null });
        if (!r || R.done.includes(c.id)) return;
        if (R.active) { this.emit(`The Tech Lab is busy with ${content.research[R.active.id]?.name ?? 'other research'}`, 'warn', 'deny'); return; }
        if (!s.buildings.some((b) => b.progress >= 1 && def(b)?.role === 'lab')) { this.emit('Research needs a finished Tech Lab', 'warn', 'deny'); return; }
        if (!this.researched(r.requires)) { this.emit(`${r.name} needs ${content.research[r.requires!]?.name} first`, 'warn', 'deny'); return; }
        if (s.alloys < r.cost) { this.emit(`Not enough alloys for ${r.name} (${r.cost} needed)`, 'warn', 'deny'); return; }
        if ((s.isotopes ?? 0) < (r.isotopes ?? 0)) { this.emit(`Not enough isotopes for ${r.name} (${r.isotopes} needed)`, 'warn', 'deny'); return; }
        s.alloys -= r.cost;
        s.isotopes = (s.isotopes ?? 0) - (r.isotopes ?? 0);
        R.active = { id: c.id, progress: 0 };
        this.emit(`Research started: ${r.name}`, 'info', 'placed');
        return;
      }
      case 'unresearch': {
        const R = s.research, a = R?.active, r = a && content.research[a.id];
        if (!R || !a) return;
        if (r) { s.alloys += r.cost; s.isotopes = (s.isotopes ?? 0) + (r.isotopes ?? 0); }
        R.active = null;
        this.emit(`Research cancelled${r ? `: ${r.name} (refunded)` : ''}`, 'info');
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
      return {
        id: u.id, unit: u.unit, slot: u.slot, x: u.x, z: u.z, hp: u.hp / d.hp, order: u.order.kind, tx: mv ? mv.x : u.gx, tz: mv ? mv.z : u.gz, engaged: u.target >= 0,
        cargo: d.carries ? u.cargo?.length ?? 0 : undefined, boarding: u.ride !== undefined || undefined,
      };
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
      wrecks: (s.wrecks ?? []).map((w) => ({ ...w })),
      seams: (s.seams ?? []).map((v) => ({ ...v })), isotopes: s.isotopes ?? 0,
      caches: (s.relics?.caches ?? []).map((c) => ({ ...c })),
      research: { done: [...(s.research?.done ?? [])], active: s.research?.active ? { ...s.research.active } : null },
      nests: (s.nests ?? []).map((n) => ({ x: this.spawns()[n.spawn]?.x ?? 0, z: this.spawns()[n.spawn]?.z ?? 0, alive: n.id >= 0 })),
      army, armySlots: slots, fx, fog, blips, hostiles: s.hostiles.length, units, camps: inh.camps, natives: inh.natives, story: this.story.snapshot(), missions: this.missions.snapshot(),
      alloys: s.alloys, cryo: s.cryo, gen: this.power.gen, draw: this.power.draw, short: this.power.short,
      stored: s.stored, storageMax: this.power.storageMax, daylight: this.power.daylight,
      radar, nextPack: radar ? Math.max(0, (s.waves.next - s.tick) / TICK_HZ) : null, packs,
      fab: { queued: s.fab.queued, progress: s.fab.progress }, people: this.people.snapshot(), over: s.over, overText: s.overText, stats: { ...s.stats },
    };
  }
}
