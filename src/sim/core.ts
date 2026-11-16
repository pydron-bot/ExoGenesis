/**
 * The colony simulation: pure logic over SimState, no worker or DOM. The worker
 * (sim/worker.ts) runs it at a fixed tick; tools/balance.mjs runs it headless.
 *
 * One tick: power → drones → fabrication + factories → mining → turrets →
 * combat units → predators → waves → cryo bank → grazers.
 */
import { content } from '../content';
import type { BuildingDef, UnitDef } from '../content/defs';
import { F, FX, STRIDE, UT } from '../skirmish/types';
import { regionHeightRaw, setRegionTerrain } from '../world/planet';
import { daylight } from './daylight';
import { PathGrid } from './path';
import { compass, depositFor, placeProblem } from './rules';
import {
  MAX_HOSTILES, REGION_HALF, TICK_HZ,
  type Building, type Command, type Drone, type DroneSnap, type Hostile, type SimState, type Snapshot, type Unit, type UnitSnap,
} from './types';

const RULES = content.colony;
const THREATS = content.threats;
const REGION = content.regions.touchdown;
const DEFS = content.buildings;
setRegionTerrain(REGION);

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

export type Level = 'info' | 'warn' | 'bad';
export type EventSink = (text: string, level: Level) => void;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const def = (b: Building): BuildingDef => DEFS[b.kind];
const bodyR = (b: Building) => def(b).clearance / 2;
const maxHp = (b: Building) => def(b).hp;
const UNIT_TYPE: Record<string, number> = { rover: UT.Rover, tank: UT.Tank, swarmer: UT.Swarmer, brute: UT.Brute };

export class Sim {
  s!: SimState;
  private fx: number[] = [];
  private grid = new PathGrid(LIMIT);
  private slotsUsed = 0;
  /** Power result of the last tick. */
  power = { gen: 0, draw: 0, short: 0, storageMax: 0, daylight: 1 };

  constructor(private emit: EventSink, seed = 1337) {
    this.newGame(seed);
  }

  // ---------- setup ----------
  newGame(seed: number) {
    const s: SimState = {
      version: 2, seed, rng: seed, tick: 0, nextId: 2, alloys: RULES.startAlloys, cryo: 100, cryoWarn: 100, stored: 0,
      drones: [], buildings: [], herds: [], fauna: [], hostiles: [], units: [], packs: [],
      deposits: (REGION.deposits ?? []).map((d) => ({ x: d.x, z: d.z, alloys: d.alloys, max: d.alloys })),
      waves: { n: 0, next: Math.round(THREATS.graceSeconds * TICK_HZ), spawned: 0 },
      fab: { queued: 0, progress: 0 },
      phase: 'descent', panic: 0, over: null,
      stats: { kills: 0, buildingsLost: 0, dronesLost: 0, packsBeaten: 0, mined: 0, unitsLost: 0 },
    };
    this.s = s;
    s.buildings.push({ id: 1, kind: 'core', x: 0, z: 0, progress: 1, hp: DEFS.core.hp, on: true, powered: true });
    s.drones.push({ id: s.nextId++, x: 0, z: -14, heading: Math.PI, hp: RULES.droneHp, task: { kind: 'idle' } });
    // herds come from the region map (content/regions/touchdown.json)
    REGION.herds.forEach((hd, herd) => {
      s.herds.push({ x: hd.x, z: hd.z });
      for (let i = 0; i < hd.grazers; i++) {
        const x = clamp(hd.x + (this.rnd() - 0.5) * 30, -LIMIT, LIMIT);
        const z = clamp(hd.z + (this.rnd() - 0.5) * 30, -LIMIT, LIMIT);
        s.fauna.push({ x, z, heading: this.rnd() * Math.PI * 2, tx: x, tz: z, herd });
      }
    });
    this.slotsUsed = 0;
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
    if (this.s.phase !== 'deployed') { this.s.phase = 'deployed'; this.s.panic = 0; }
    this.slotsUsed = [...state.hostiles, ...state.units].reduce((m, h) => Math.max(m, h.slot + 1), 0);
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
  private entity(id: number): Building | Drone | Unit | undefined {
    return this.s.buildings.find((b) => b.id === id) ?? this.s.drones.find((d) => d.id === id) ?? this.units.find((u) => u.id === id);
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
      this.stepUnits();
      this.stepHostiles();
      this.stepWaves();
      this.stepCryo();
    }
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
      if (d.powerMW > 0) { gen += d.role === 'solar' ? d.powerMW * this.solarFactor() : d.powerMW; b.powered = true; }
      else if (d.powerMW < 0) {
        const rank = d.fireRange ? 0 : d.role === 'radar' || d.role === 'factory' ? 2 : 3;
        const idle = (d.fireRange && !b.engaged) || (d.role === 'factory' && !b.queue?.length);
        loads.push({ b, mw: -d.powerMW * (idle ? STANDBY : 1), rank, battery: d.role !== 'depot' });
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

  private stepCryo() {
    const s = this.s;
    const short = this.power.short;
    if (short <= 0.001) {
      s.cryo = Math.min(100, s.cryo + RULES.cryoRecover * DT);
      if (s.cryo >= 100) s.cryoWarn = 100;
      return;
    }
    s.cryo = Math.max(0, s.cryo - short * RULES.cryoLossPerMW * DT);
    for (const th of [75, 50, 25, 0]) {
      if (s.cryo <= th && s.cryoWarn > th) {
        s.cryoWarn = th;
        this.emit(th === 0 ? 'Cryo bank failure. The embryos are lost.' : `Cryo bank integrity ${th}% — not enough power`, th <= 25 ? 'bad' : 'warn');
      }
    }
    if (s.cryo <= 0) this.lose('cryo');
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
          site.progress = dd.buildSeconds > 0 ? Math.min(1, site.progress + DT / dd.buildSeconds) : 1;
          site.hp = Math.min(dd.hp, site.hp + (site.progress - before) * dd.hp * 0.9);
          if (site.progress >= 1) {
            site.hp = Math.max(site.hp, dd.hp * 0.999);
            this.emit(`${dd.name} online${dd.powerMW > 0 ? ` · +${dd.powerMW} MW${dd.role === 'solar' ? ' at noon' : ''}` : ''}`, 'info');
            d.task = { kind: 'idle' }; d.manual = false;
          }
        }
      } else if (t.kind === 'repair') {
        const b = s.buildings.find((x) => x.id === t.id);
        if (!b || b.hp >= maxHp(b) || b.progress < 1) { d.task = { kind: 'idle' }; d.manual = false; continue; }
        if (this.reach(d, b)) {
          d.heading += 1.5 * DT;
          const dd = def(b);
          const hp = Math.min(RULES.repairRate * DT, maxHp(b) - b.hp);
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
      this.emit('No worker drones left. The Core is fabricating a replacement.', 'warn');
    }
    if (!f.queued) return;
    const core = s.buildings.find((b) => b.kind === 'core');
    if (!core) return;
    f.progress += DT / (RULES.droneBuildSeconds * (f.free ? 1.5 : 1));
    if (f.progress >= 1) {
      f.queued--; f.progress = 0; f.free = false;
      s.drones.push({ id: s.nextId++, x: core.x + 6, z: core.z - 12, heading: Math.PI, hp: RULES.droneHp, task: { kind: 'idle' } });
      this.emit(`Worker drone fabricated (${s.drones.length} active)`, 'info');
    }
  }

  /** Vehicle bays work through their queue while powered; a finished unit rolls out the front. */
  private stepFactories() {
    const s = this.s;
    for (const b of s.buildings) {
      if (def(b).role !== 'factory' || b.progress < 1 || !b.queue?.length || !b.powered) continue;
      const ud = content.units[b.queue[0]];
      if (!ud) { b.queue.shift(); b.prod = 0; continue; }
      b.prod = Math.min(1, (b.prod ?? 0) + DT / Math.max(0.1, ud.buildSeconds ?? 10));
      if (b.prod < 1) continue;
      const slot = this.freeSlot();
      if (slot < 0) continue; // render pool full: hold the unit until one frees up
      const kind = b.queue.shift()!;
      b.prod = 0;
      const out = bodyR(b) + 3;
      const n = this.units.length;
      const gx = b.x + Math.sin(n * 2.4) * 4, gz = b.z - out - 5 + Math.cos(n * 2.4) * 3;
      this.units.push({
        id: s.nextId++, unit: kind, slot, x: b.x, z: b.z - out, heading: Math.PI, hp: ud.hp, cd: 0,
        order: { kind: 'move', x: gx, z: gz }, gx, gz, target: -1,
      });
      this.emit(`${ud.name} ready${b.queue.length ? ` · ${b.queue.length} more queued` : ''}`, 'info');
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
      const take = Math.min(dep.alloys, (d.mineRate ?? 0) * DT);
      dep.alloys -= take;
      s.alloys += take;
      s.stats.mined += take;
      if (dep.alloys <= 0) this.emit(`Deposit ${compass(dep.x, dep.z)} of the Core is exhausted`, 'warn');
    }
    s.alloys += RULES.alloyTrickle * DT;
  }

  // ---------- combat ----------
  private unitDef(h: Hostile): UnitDef { return content.units[h.unit]; }

  private stepTurrets() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (!d.fireRange || !d.damage || !d.cooldown || b.progress < 1) continue;
      b.cd = Math.max(0, (b.cd ?? 0) - DT);
      let best: Hostile | null = null, bd = d.fireRange;
      for (const h of s.hostiles) {
        const dist = Math.hypot(h.x - b.x, h.z - b.z) - this.unitDef(h).radius;
        if (dist <= bd) { bd = dist; best = h; }
      }
      b.engaged = !!best;
      if (!best || !b.powered) continue;
      b.aim = Math.atan2(best.x - b.x, best.z - b.z);
      if (b.cd > 0) continue;
      b.cd = d.cooldown ?? 1;
      best.hp -= d.damage ?? 0;
      this.fx.push(FX.TANK_SHOT, b.x, b.z, best.x, best.z);
      if (best.hp <= 0) this.killHostile(best);
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
    if (us.length) this.grid.setBodies(s.buildings.map((b) => ({ x: b.x, z: b.z, r: bodyR(b) })), PATH_PAD);
    for (const u of us) {
      const d = content.units[u.unit];
      u.cd = Math.max(0, u.cd - DT);
      const moving = u.order.kind === 'move';
      let tgt = u.target >= 0 ? s.hostiles.find((h) => h.id === u.target) : undefined;
      const leash = Math.max(d.aggro * LEASH, RULES.unitResponse + 10);
      if (!tgt || (s.tick + u.id) % 5 === 0) {
        const seek = moving ? d.range : d.aggro;
        let bd = Infinity;
        tgt = undefined;
        for (const h of s.hostiles) {
          const dist = Math.hypot(h.x - u.x, h.z - u.z) - this.unitDef(h).radius;
          if (dist <= seek && dist < bd) { bd = dist; tgt = h; }
        }
        // idle: answer attacks on buildings near the guard post
        if (!tgt && !moving) {
          for (const h of s.hostiles) {
            if (Math.hypot(h.x - u.gx, h.z - u.gz) > RULES.unitResponse) continue;
            const b = s.buildings.find((x) => x.id === h.target);
            if (!b || Math.hypot(b.x - h.x, b.z - h.z) > bodyR(b) + 12) continue;
            const dist = Math.hypot(h.x - u.x, h.z - u.z);
            if (dist < bd) { bd = dist; tgt = h; }
          }
        }
      }
      if (tgt && !moving && Math.hypot(tgt.x - u.gx, tgt.z - u.gz) > leash) tgt = undefined;
      u.target = tgt?.id ?? -1;
      const gap = tgt ? Math.hypot(tgt.x - u.x, tgt.z - u.z) - this.unitDef(tgt).radius - d.radius : Infinity;
      if (tgt && gap <= d.range) {
        if (!moving) {
          let dh = Math.atan2(tgt.x - u.x, tgt.z - u.z) - u.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          u.heading += clamp(dh, -8 * DT, 8 * DT);
        }
        if (u.cd <= 0) {
          u.cd = d.cooldown;
          const tx = tgt.x, tz = tgt.z;
          this.fx.push(d.splash ? FX.TANK_SHOT : FX.ROVER_SHOT, u.x, u.z, tx, tz);
          tgt.hp -= d.damage;
          if (d.splash) {
            for (const h of [...s.hostiles]) {
              if (h !== tgt && Math.hypot(h.x - tx, h.z - tz) < d.splash) { h.hp -= d.damage / 2; if (h.hp <= 0) this.killHostile(h); }
            }
          }
          if (tgt.hp <= 0) { this.killHostile(tgt); u.target = -1; }
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
        const dx = a.x - b.x, dz = a.z - b.z, dd = Math.hypot(dx, dz), min = bodyR(b) + ra;
        if (dd > 1e-3 && dd < min) { a.x = b.x + (dx / dd) * min; a.z = b.z + (dz / dd) * min; }
      }
      a.x = clamp(a.x, -LIMIT, LIMIT); a.z = clamp(a.z, -LIMIT, LIMIT);
    }
  }

  private killHostile(h: Hostile) {
    const s = this.s;
    const i = s.hostiles.indexOf(h);
    if (i < 0) return;
    s.hostiles.splice(i, 1);
    s.stats.kills++;
    this.fx.push(h.unit === 'brute' ? FX.DIE_BIG : FX.DIE_SMALL, h.x, h.z, 0, 0);
    const p = s.packs.find((x) => x.id === h.pack);
    if (p && --p.alive <= 0) {
      s.packs.splice(s.packs.indexOf(p), 1);
      s.stats.packsBeaten++;
      this.emit(`Pack from the ${p.from} destroyed (${s.stats.packsBeaten} so far)`, 'info');
    }
  }

  private blocked(x: number, z: number) {
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return true;
    return regionHeightRaw(x, z) < 0.3;
  }

  private chooseTarget(h: Hostile, u: UnitDef) {
    const s = this.s;
    let best = -1, bd = Infinity;
    for (const d of [...s.drones, ...this.units]) {
      const dist = Math.hypot(d.x - h.x, d.z - h.z);
      if (dist < u.aggro && dist < bd) { bd = dist; best = d.id; }
    }
    if (best >= 0) return best;
    for (const b of s.buildings) {
      const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b);
      if (dist < bd) { bd = dist; best = b.id; }
    }
    return best;
  }

  private stepHostiles() {
    const s = this.s;
    const hs = s.hostiles;
    for (const h of hs) {
      const u = this.unitDef(h);
      h.cd = Math.max(0, h.cd - DT);
      let tgt = h.target >= 0 ? this.entity(h.target) : undefined;
      if (!tgt || (s.tick + h.id) % 10 === 0) { h.target = this.chooseTarget(h, u); tgt = this.entity(h.target); }
      if (!tgt) continue;
      const isB = 'kind' in tgt, isU = 'order' in tgt;
      const tr = isB ? bodyR(tgt as Building) : isU ? content.units[(tgt as Unit).unit].radius : 1;
      const dx = tgt.x - h.x, dz = tgt.z - h.z, dist = Math.hypot(dx, dz);
      if (dist - tr - u.radius <= u.range) {
        h.heading = Math.atan2(dx, dz);
        if (h.cd <= 0) {
          h.cd = u.cooldown;
          tgt.hp -= u.damage;
          this.fx.push(FX.BITE, h.x, h.z, tgt.x, tgt.z);
          if (tgt.hp <= 0) isB ? this.destroyBuilding(tgt as Building) : isU ? this.destroyUnit(tgt as Unit) : this.destroyDrone(tgt as Drone);
        }
        continue;
      }
      this.steer(h, tgt.x, tgt.z, u.speed);
    }
    // separation, and keep out of building bodies
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i], ra = this.unitDef(a).radius;
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j], rb = this.unitDef(b).radius;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = ra + rb;
        if (d > 1e-3 && d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
      for (const b of s.buildings) {
        const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), min = bodyR(b) + ra;
        if (d > 1e-3 && d < min) { a.x = b.x + (dx / d) * min; a.z = b.z + (dz / d) * min; }
      }
      a.x = clamp(a.x, -LIMIT, LIMIT); a.z = clamp(a.z, -LIMIT, LIMIT);
    }
    // packs are announced once seen (radar sees them as they arrive)
    for (const p of s.packs) {
      if (p.announced) continue;
      const near = hs.some((h) => h.pack === p.id && s.buildings.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < THREATS.sightRange));
      if (near) { p.announced = true; this.emit(`Contact! Predators at the ${p.from} perimeter`, 'bad'); }
    }
  }

  private destroyBuilding(b: Building) {
    const s = this.s;
    const i = s.buildings.indexOf(b);
    if (i < 0) return;
    s.buildings.splice(i, 1);
    s.stats.buildingsLost++;
    this.fx.push(FX.DIE_BIG, b.x, b.z, 0, 0);
    this.emit(`${def(b).name} destroyed`, 'bad');
    if (b.kind === 'core') this.lose('core');
  }

  private destroyDrone(d: Drone) {
    const s = this.s;
    const i = s.drones.indexOf(d);
    if (i < 0) return;
    s.drones.splice(i, 1);
    s.stats.dronesLost++;
    this.fx.push(FX.DIE_SMALL, d.x, d.z, 0, 0);
    this.emit('Worker drone destroyed', 'bad');
  }

  private destroyUnit(u: Unit) {
    const s = this.s;
    const i = this.units.indexOf(u);
    if (i < 0) return;
    this.units.splice(i, 1);
    s.stats.unitsLost = (s.stats.unitsLost ?? 0) + 1;
    this.fx.push(u.unit === 'tank' ? FX.DIE_BIG : FX.DIE_SMALL, u.x, u.z, 0, 0);
    this.emit(`${content.units[u.unit].name} destroyed`, 'bad');
  }

  private lose(why: 'core' | 'cryo') {
    if (this.s.over) return;
    this.s.over = why;
    this.emit(why === 'core' ? 'The Command Core has fallen. The colony is lost.' : 'The cryo bank has failed. The colony is lost.', 'bad');
  }

  // ---------- waves ----------
  private radarPowered() {
    return this.s.buildings.some((b) => b.powered && def(b).role === 'radar');
  }

  private stepWaves() {
    const s = this.s, w = s.waves;
    if (s.tick < w.next) return;
    const night = this.power.daylight < 0.3;
    const size = Math.round(Math.min(THREATS.maxSize, THREATS.startSize + THREATS.growth * w.n) * (night ? THREATS.nightBoost : 1));
    const spawns = REGION.spawns?.length ? REGION.spawns : [{ x: LIMIT - 10, z: LIMIT - 10 }];
    const sp = spawns[Math.floor(this.rnd() * spawns.length)];
    const pack = { id: s.nextId++, size, alive: 0, announced: false, from: compass(sp.x, sp.z) };
    for (let i = 0; i < size; i++) {
      const brute = THREATS.bruteEvery > 0 && (++w.spawned % THREATS.bruteEvery === 0);
      const unit = brute ? 'brute' : 'swarmer';
      const slot = this.freeSlot();
      if (slot < 0) break;
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * 7;
      s.hostiles.push({
        id: s.nextId++, unit, slot, x: clamp(sp.x + Math.cos(a) * r, -LIMIT, LIMIT), z: clamp(sp.z + Math.sin(a) * r, -LIMIT, LIMIT),
        heading: Math.atan2(-sp.x, -sp.z), hp: content.units[unit].hp, target: -1, cd: this.rnd(), pack: pack.id,
      });
      pack.alive++;
    }
    if (pack.alive) {
      s.packs.push(pack);
      if (this.radarPowered()) {
        pack.announced = true;
        this.emit(`Radar: pack of ${pack.alive} approaching from the ${pack.from}`, 'warn');
      }
    }
    w.n++;
    w.next = s.tick + Math.round((THREATS.waveInterval + (this.rnd() * 2 - 1) * THREATS.waveJitter) * TICK_HZ);
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
    const scary = [...s.drones, ...this.units, ...s.hostiles];
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
        if (s.alloys < dd.cost) { this.emit(`Not enough alloys for a ${dd.name} (${dd.cost} needed)`, 'warn'); return; }
        const why = placeProblem(s, DEFS, RULES, c.kind, c.x, c.z);
        if (why) { this.emit(`Can't build there: ${why}`, 'warn'); return; }
        s.alloys -= dd.cost;
        s.buildings.push({ id: s.nextId++, kind: c.kind, x: c.x, z: c.z, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
        this.emit(`${dd.name} placed${s.drones.length ? '' : ' · waiting for a drone'}`, 'info');
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
      case 'demolish': {
        const b = s.buildings.find((x) => x.id === c.id);
        if (!b || b.kind === 'core') return;
        const dd = def(b);
        const queued = (b.queue ?? []).reduce((m, k) => m + (content.units[k]?.cost ?? 0), 0);
        const refund = queued + (b.progress < 1 ? dd.cost * (1 - b.progress * 0.5) : dd.cost * 0.5 * (b.hp / dd.hp));
        s.alloys += refund;
        s.buildings.splice(s.buildings.indexOf(b), 1);
        this.emit(`${dd.name} ${b.progress < 1 ? 'cancelled' : 'recycled'} · +${Math.floor(refund)} alloys`, 'info');
        return;
      }
      case 'debug': {
        if (c.alloys) s.alloys += c.alloys;
        if (c.wave) s.waves.next = s.tick;
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
        if (this.units.length + queued >= RULES.maxUnits) { this.emit(`Combat unit limit reached (${RULES.maxUnits})`, 'warn'); return; }
        if (s.alloys < ud.cost) { this.emit(`Not enough alloys for a ${ud.name} (${ud.cost} needed)`, 'warn'); return; }
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
        if (s.drones.length + s.fab.queued >= RULES.maxDrones) { this.emit(`Drone limit reached (${RULES.maxDrones})`, 'warn'); return; }
        if (s.alloys < RULES.droneCost) { this.emit(`Not enough alloys for a drone (${RULES.droneCost} needed)`, 'warn'); return; }
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
    for (const h of s.hostiles) {
      const o = h.slot * STRIDE;
      army[o + F.X] = h.x; army[o + F.Z] = h.z; army[o + F.HEADING] = h.heading;
      army[o + F.TYPE] = UNIT_TYPE[h.unit] ?? UT.Swarmer;
      army[o + F.HP] = h.hp / this.unitDef(h).hp;
      army[o + F.GEN] = h.id & 0xffff; army[o + F.ALIVE] = 1;
    }
    const units: UnitSnap[] = this.units.map((u) => {
      const o = u.slot * STRIDE, d = content.units[u.unit];
      army[o + F.X] = u.x; army[o + F.Z] = u.z; army[o + F.HEADING] = u.heading;
      army[o + F.TYPE] = UNIT_TYPE[u.unit] ?? UT.Rover;
      army[o + F.HP] = u.hp / d.hp;
      army[o + F.GEN] = u.id & 0xffff; army[o + F.ALIVE] = 1;
      const mv = u.order.kind === 'move' ? u.order : null;
      return { id: u.id, unit: u.unit, slot: u.slot, x: u.x, z: u.z, hp: u.hp / d.hp, order: u.order.kind, tx: mv ? mv.x : u.gx, tz: mv ? mv.z : u.gz, engaged: u.target >= 0 };
    });
    const fx = new Float32Array(this.fx);
    this.fx.length = 0;
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
    const radar = this.radarPowered();
    const packs = s.packs.map((p) => {
      let x = 0, z = 0, n = 0;
      for (const h of s.hostiles) if (h.pack === p.id) { x += h.x; z += h.z; n++; }
      return { x: n ? x / n : 0, z: n ? z / n : 0, alive: n, seen: radar || p.announced };
    });
    return {
      type: 'snap', tick: s.tick, secs: this.secs, deployed: this.deployed,
      drones, fauna: fa, buildings: s.buildings.map((b) => ({ ...b, queue: b.queue ? [...b.queue] : undefined })), deposits: s.deposits.map((d) => ({ ...d })),
      army, armySlots: slots, fx, hostiles: s.hostiles.length, units,
      alloys: s.alloys, cryo: s.cryo, gen: this.power.gen, draw: this.power.draw, short: this.power.short,
      stored: s.stored, storageMax: this.power.storageMax, daylight: this.power.daylight,
      radar, nextPack: radar ? Math.max(0, (s.waves.next - s.tick) / TICK_HZ) : null, packs,
      fab: { queued: s.fab.queued, progress: s.fab.progress }, over: s.over, stats: { ...s.stats },
    };
  }
}
