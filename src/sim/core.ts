/**
 * The colony simulation: pure logic over SimState, no worker or DOM. The worker
 * (sim/worker.ts) runs it at a fixed tick; tools/balance.mjs runs it headless.
 *
 * One tick: power → drones → fabrication + factories → mining → turrets →
 * repair pads → combat units → predators → waves → cryo bank → people
 * (src/sim/people.ts) → grazers.
 */
import { content } from '../content';
import { biomeOf, herdCount, herdSpecies, wildlifeIds } from '../content/nature';
import { expeditionOf, type BuildingDef, type ModStat, type RegionDef, type UnitDef, type Weapon } from '../content/defs';
import { HOME_REGION, newCampaign } from './campaign';
import { F, FX, STRIDE, unitType } from '../skirmish/types';
import { regionHeightRaw, regionTerrain, setRegionTerrain } from '../world/planet';
import { chronicleEvent, recordChronicle } from './chronicle';
import { daylight } from './daylight';
import { PathGrid, moveOf, offLimits, straight, type Move } from './path';
import { Buckets } from './spatial';
import { LEVELS as AI_LEVELS, think as aiThink, type AiHost } from './ai';
import { Inhabitants, campSites } from './inhabitants';
import { People } from './people';
import { Planet } from './planet';
import { Story } from './story';
import { Missions } from './missions';
import { Frontier } from './frontier';
import { modTotals, researchBlocked, type ResearchWorld } from './mods';
import { blocOf, type Colonist } from './people-types';
import { compass, depositFor, factoryMakes, gateSnap, isBarrier, linePoints, placeProblem, seamFor, wallsUnderGate, type PlaceWorld } from './rules';
import {
  FOG_CELL, FOG_N, MAX_HOSTILES, REGION_HALF, TICK_HZ,
  type Building, type Command, type EventCue, type PlaySetup, type Drone, type DroneSnap, type Hostile, type SimState, type Snapshot, type Unit, type UnitSnap,
  type Econ, type PlayerState, type SimStats, type SkirmishSetup, type FactionState, type CampaignInfo,
} from './types';

/** The Clause's colour: units it has turned are drawn in it (team 1). */
const CLAUSE_COLOR = '#c13cff';
/** Combat units each skirmish player may have. */
const SKIRMISH_UNITS = 40;
/** Anything a player's guns can shoot: fauna, or another player's unit, drone or building. */
type Foe = Hostile | Unit | Building | Drone;
const isHostile = (f: Foe): f is Hostile => 'pack' in f;
const isBuilding = (f: Foe): f is Building => 'kind' in f;
const isUnit = (f: Foe): f is Unit => 'order' in f && !('pack' in f);
/** Seconds between uses of an ability when the unit doesn't say. */
const ABILITY_CD = 30;
/** Damage a dug-in (siege) unit takes. */
const SIEGE_ARMOUR = 0.7;
/** Is this unit's ability `kind`, and on right now? */
const abilityOn = (u: Unit, d: UnitDef, kind: string) => d.ability === kind && (u.abT ?? 0) > 0;
const isDrone = (f: Foe): f is Drone => 'task' in f;
/** Shooters pick anything that moves before a building, unless the building is this much closer (u). */
const BUILDING_LAST = 10;

/**
 * Skirmish start spots: evenly round a ring at 62% of the way to the edge, each moved to the nearest dry, flat
 * ground for a Command Core.
 */
export function skirmishHomes(n: number, lim: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const ok = (x: number, z: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 8; a++) for (const r of [0, 6, 12]) {
      const h = regionHeightRaw(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return lo >= 0.8 && hi - lo <= 4;
  };
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 0.25 + (i / n) * Math.PI * 2, r = lim * 0.62;
    let best = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    search: for (let rr = 0; rr < lim * 0.5; rr += 4) {
      for (let q = 0; q < Math.max(1, Math.round(rr)); q++) {
        const t = (q / Math.max(1, Math.round(rr))) * Math.PI * 2;
        const x = best.x + Math.cos(t) * rr, z = best.z + Math.sin(t) * rr;
        if (Math.abs(x) < lim - 14 && Math.abs(z) < lim - 14 && ok(x, z)) { best = { x, z }; break search; }
      }
    }
    out.push(best);
  }
  return out;
}

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
/** The region the sim is playing (campaign travel: `here` conditions, the snapshot). */
export const regionNow = () => REGION_ID;
/** The region's own difficulty, falling back to the threat rules. */
const packScale = () => REGION.packScale ?? 1;
const graceSeconds = () => REGION.graceSeconds ?? THREATS.graceSeconds;
const waveInterval = () => REGION.waveInterval ?? THREATS.waveInterval;

/** A gun fixed to its hull fires when the target is within this of straight ahead (radians, ~17°). */
const FIXED_GUN_ARC = 0.3;
/** …and one this close to the end of its move, with a target in range, halts there to turn and fire (u). */
const FIXED_GUN_HALT = 8;
const DT = 1 / TICK_HZ;
const WALK = 2.2;
const RUN = 7.5;
const FLEE_R = 14;
/** Wildlife species in snapshot order, and how each moves (content/wildlife, with defaults filled in). */
const WILD_IDS = wildlifeIds(content);
const WILD_INDEX = new Map(WILD_IDS.map((id, i) => [id, i]));
interface WildMove { idx: number; behavior: string; speed: number; run: number; flee: number; spread: number }
const WILD_MOVES = new Map<string, WildMove>();
function wildMove(id: string | undefined): WildMove {
  const key = id && content.wildlife[id] ? id : content.wildlife.grazer ? 'grazer' : WILD_IDS[0];
  let w = WILD_MOVES.get(key);
  if (!w) {
    const d = content.wildlife[key];
    w = { idx: WILD_INDEX.get(key) ?? 0, behavior: d?.behavior ?? 'herd', speed: d?.speed ?? WALK, run: d?.run ?? RUN, flee: d?.flee ?? FLEE_R, spread: d?.spread ?? 22 };
    WILD_MOVES.set(key, w);
  }
  return w;
}
/** The species of each of the region's herds (its own, or picked from the biome). */
const regionHerdSpecies = () => {
  const biome = biomeOf(content, REGION);
  return REGION.herds.map((hd, i) => herdSpecies(content, biome, hd, i, REGION.floraSeed ?? 1));
};
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
/** A unit that hasn't got any further along its path for this many ticks re-plans (three times that: gives up). */
const STALL = 30;
/** Building buckets cover each body plus this: more than any moving unit's radius (u). */
const BODY_MARGIN = Math.max(2, ...Object.values(content.units).filter((u) => u.speed > 0).map((u) => u.radius)) + 1;
/** A medevac picks up someone lying injured this close to its hull (u). */
const PICKUP = 2.5;
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
export type EventSink = (text: string, level: Level, cue?: EventCue, at?: { x: number; z: number }, style?: 'clause') => void;

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

/** Flies (moves on air): only anti-air shooters can hit it, and nothing on the ground blocks it. */
const flies = (u: UnitDef) => u.move === 'air';
/** A collapsed shield comes back up once it has recharged to this share of its full charge. */
const SHIELD_BACK = 0.3;
/** A shield up this tick: centre, radius, and what holds its charge (a projector or an Aegis). */
interface Dome { x: number; z: number; r: number; o: Building | Unit; max: number; name: string }

export class Sim {
  s!: SimState;
  private fx: number[] = [];
  /** Spatial buckets (reused every tick): hostiles by index; buildings by index, rebuilt when the set changes. */
  private hostileBuckets = new Buckets<number>(6);
  private scaryBuckets = new Buckets<number>(FLEE_R);
  private bldBuckets = new Buckets<number>(8);
  private bldKey = '';
  private found: number[] = [];
  private seen = new Set<number>();
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
  /** Shields up this tick (stepShields), for stepHostiles to check hits against. */
  private domes: Dome[] = [];
  /** Units' shield abilities on this tick: our units inside take `keep` of the damage. */
  private auras: { x: number; z: number; r: number; keep: number; team: number }[] = [];
  /** Power result of the last tick. */
  power = { gen: 0, draw: 0, short: 0, storageMax: 0, daylight: 1 };

  /** Colonists, embryos, pods, food and Trust. */
  readonly people: People = new People(this);
  /** Planet health: scars, harm, Seed Banks, the Biosphere Report. */
  readonly planet: Planet = new Planet(this);
  /** Inhabitant camps: regard, first contact, trust. */
  readonly inhabitants: Inhabitants = new Inhabitants(this);
  /** Story events: triggers, cards, effects. */
  readonly story: Story = new Story(this, () => ({ id: REGION_ID, sites: REGION.sites ?? [] }));
  /**
   * Headless playthroughs (src/sim/playthrough.ts) play the whole campaign in one region: every region counts as
   * here (story events, missions and `here` conditions), each reading its own region's story sites. Not saved.
   */
  everywhere = false;
  /** With `everywhere`: missions set in other regions start as soon as their `after` is done (the old playthrough rule), not only once routed or visited. */
  everywhereStarts = false;
  /** Is the home region (Touchdown) the one being played? */
  get atHome() { return REGION_ID === HOME_REGION; }
  /** The frontier: threats to outlying holdings, standing orders. */
  readonly frontier: Frontier = new Frontier(this);
  /** Missions: objectives, rewards, what comes next. */
  readonly missions: Missions = new Missions(this);

  /** Events for the local player (skirmish: what other players' economies do stays quiet). */
  readonly emit: EventSink = (text, level, cue, at, style) => {
    if (this.team !== 0) return;
    this.sink(text, level, cue, at, style);
    if (this.s && !this.s.players) chronicleEvent(this.s, this.secs, text, cue);
  };
  /** The last "under attack" alert (not saved: a load just alerts again). */
  private lastAlert = { tick: -1e9, x: 0, z: 0 };
  /**
   * One of the local player's things has been hit by an enemy: an "under attack" alert with where, at most once every
   * 20 s for the same place (a new place, 60 u away or more, can alert after 6 s).
   */
  private underAttack(o: Building | Unit | Drone) {
    if ((o.team ?? 0) !== 0) return;
    const s = this.s, a = this.lastAlert, near = Math.hypot(o.x - a.x, o.z - a.z) < 60;
    if (s.tick - a.tick < (near ? 20 : 6) * TICK_HZ) return;
    this.lastAlert = { tick: s.tick, x: o.x, z: o.z };
    const home = s.players?.[0]?.home ?? { x: 0, z: 0 };
    const what = 'kind' in o ? def(o).name : 'task' in o ? 'a worker drone' : content.units[o.unit]?.name ?? 'a unit';
    const where = Math.hypot(o.x - home.x, o.z - home.z) < 20 ? 'at the Core' : `${compass(o.x - home.x, o.z - home.z)} of the Core`;
    this.emit(`Under attack: ${what}, ${where}`, 'bad', 'warning', { x: o.x, z: o.z });
  }

  constructor(private readonly sink: EventSink, seed = 1337) {
    this.newGame(seed);
  }

  // ---------- players (skirmish) ----------
  /** Whose view the economy steps and commands are running in (0 = the local player; the campaign is always 0). */
  team = 0;
  /** The whole lists while one player's view is swapped in (placement still has to see everyone's buildings). */
  private all: { buildings: Building[]; drones: Drone[]; units: Unit[] } | null = null;
  /** Each player's power result and fog (index = team; [0] is the local player's, `power` / `vis` / `exp` outside a swap). */
  private powers: Sim['power'][] = [];
  private fogs: { vis: Uint8Array<ArrayBuffer>; exp: Uint8Array<ArrayBuffer> }[] = [];
  /** Players whose Command Core fell this tick (taken off the map at the end of the tick). */
  private falling: number[] = [];
  /** Foes per team this tick (see `foes`). */
  private foeCache = new Map<number, Foe[]>();
  private foeTick = -1;

  get players(): PlayerState[] | undefined { return this.s.players; }
  /** Same side (or the campaign, where there's only one; with factions: us and our allies, or the hostiles together). */
  allied(a: number, b: number) {
    const P = this.s.players;
    if (P) return a === b || P[a]?.side === P[b]?.side;
    if (a === b || !this.s.factions?.length) return true;
    const A = this.attitude(a), B = this.attitude(b), friend = (x: string) => x === 'self' || x === 'allied';
    return (friend(A) && friend(B)) || (A === 'hostile' && B === 'hostile');
  }
  /** Do teams `a` and `b` fight? A skirmish: different sides. The campaign: neither is neutral and they aren't allied. */
  private enemies(a: number, b: number) {
    if (this.s.players) return !this.allied(a, b);
    if (a === b || !this.s.factions?.length) return false;
    if (this.attitude(a) === 'neutral' || this.attitude(b) === 'neutral') return false;
    return !this.allied(a, b);
  }
  /** Campaign factions in play (region `factions`, or units the Clause has turned): the lists hold other teams' things. */
  get teamsOn() { return !this.s.players && !!this.s.factions?.length; }
  /** How team `t` stands with us (campaign): ourselves, or its faction's attitude (the Clause's team 1 is hostile). */
  attitude(t: number): 'self' | FactionState['attitude'] {
    if (!t) return 'self';
    return this.s.factions?.find((f) => f.team === t)?.attitude ?? 'hostile';
  }
  /** What predators go for: ours and our allies' (a campaign faction that isn't allied is left alone). */
  private prey(o: object) {
    const t = (o as { team?: number }).team;
    if (!t || !this.teamsOn) return true;
    return this.attitude(t) === 'allied';
  }
  /** A campaign faction turns (a story effect, its flag, or our attack on a neutral one). */
  setAttitude(id: string, att: FactionState['attitude']) {
    const f = this.s.factions?.find((x) => x.id === id);
    if (!f || f.attitude === att) return;
    f.attitude = att;
    this.foeCache.clear();
    // everyone picks their targets again
    for (const u of this.all?.units ?? this.units) u.target = -1;
    this.emit(att === 'hostile' ? `${f.name}: hostile` : att === 'allied' ? `${f.name}: allied. They fight beside us.` : `${f.name}: standing down`, att === 'hostile' ? 'bad' : 'info', att === 'hostile' ? 'warning' : att === 'allied' ? 'friend' : undefined);
  }
  /** Region factions and their outposts (a new game, or a save from before the region had them). */
  private initFactions() {
    const s = this.s, F = REGION.factions ?? [];
    if (!F.length || s.players) return;
    s.factions = F.map((f) => ({ id: f.id, name: f.name, color: f.color, team: f.team, attitude: f.attitude }));
    for (const o of REGION.outposts ?? []) {
      const f = s.factions.find((x) => x.id === o.faction), dd = DEFS[o.kind];
      if (!f || !dd || dd.role === 'core') continue;
      s.buildings.push({ id: s.nextId++, team: f.team, kind: o.kind, x: o.x, z: o.z, yaw: ((o.yaw ?? 0) * Math.PI) / 180, progress: 1, hp: dd.hp, on: true, powered: true, flag: o.story });
    }
  }
  /** Factions' flags (once a second): a faction's hostile or allied flag turns it, once. */
  private stepFactions() {
    const F = this.s.factions;
    if (!F?.length || this.s.tick % TICK_HZ) return;
    for (const f of F) {
      const d = REGION.factions?.find((x) => x.id === f.id);
      if (!d) continue;
      for (const [flag, att] of [[d.flag, 'hostile'], [d.allyFlag, 'allied']] as const) {
        if (!flag || !this.story.has(flag) || (f.done ??= []).includes(flag)) continue;
        f.done.push(flag);
        this.setAttitude(f.id, att);
      }
    }
  }
  /**
   * The home colony's numbers for the rest of the campaign (`CampaignInfo.home`), once a second while Touchdown is
   * played: expeditions read its people, its planet and its inhabitants from here (conditions, the epilogue).
   */
  private recordHome() {
    const s = this.s, c = s.campaign;
    if (!c || s.players || s.expedition || !this.atHome || !s.people || !s.planet) return;
    const adults = s.people.colonists.filter((x) => this.people.adult(x));
    const by = (b: string) => adults.filter((x) => blocOf(x.stance) === b).length;
    const groups: NonNullable<CampaignInfo['home']>['groups'] = {};
    for (const camp of s.camps ?? []) {
      const g = (groups[camp.group] ??= { regard: 0, low: 100, met: false, trusted: false });
      if (!camp.gone) g.regard = Math.max(g.regard, camp.regard);
      if (camp.met && !camp.gone) g.low = Math.min(g.low, camp.regard);
      g.met ||= camp.met;
      g.trusted ||= camp.trusted && !camp.gone;
    }
    c.home = {
      planet: Math.round(this.planet.health() * 10) / 10,
      acceptance: this.people.acceptance(),
      autonomists: by('autonomist'), partners: by('partner'), devoted: by('devoted'),
      colonists: s.people.colonists.length,
      deaths: s.people.memorial.filter((m) => !m.cause.startsWith('left')).length,
      sols: Math.floor(this.secs / RULES.solSeconds) + 1,
      groups,
    };
  }

  /**
   * The outpost effect: a faction's buildings (all of the faction's, those within `r` of a point, or the one with a
   * story flag) destroyed, disabled (no shooting, no working) or captured (ours from now on). Returns how many.
   */
  outposts(o: { faction?: string; at?: { x: number; z: number; r: number }; story?: string; outcome: 'destroy' | 'disable' | 'capture' }) {
    const s = this.s, whole = this.all?.buildings ?? s.buildings;
    const team = o.faction ? s.factions?.find((f) => f.id === o.faction)?.team : undefined;
    if (o.faction && team === undefined) return 0;
    const hit = whole.filter((b) => b.team && (team === undefined || b.team === team) && (!o.story || b.flag === o.story)
      && (!o.at || Math.hypot(b.x - o.at.x, b.z - o.at.z) <= o.at.r));
    if (!o.faction && !o.story && !o.at) return 0; // (nothing named: nothing happens)
    for (const b of hit) {
      if (o.outcome === 'destroy') this.destroyBuilding(b);
      else if (o.outcome === 'disable') { b.on = false; b.powered = false; b.off = true; b.engaged = false; if (b.queue) b.queue = []; }
      else {
        delete b.team; delete b.off;
        b.on = true;
        for (const u of this.units) if (u.target === b.id) u.target = -1;
        // inside the colony's own view the list is ours alone: it joins it
        if (this.all && !s.buildings.includes(b)) s.buildings.push(b);
      }
    }
    if (hit.length) {
      const f = s.factions?.find((x) => x.team === hit[0].team) ?? s.factions?.find((x) => x.id === o.faction);
      if (o.outcome === 'disable') this.emit(`${f ? `${f.name}'s` : 'Their'} ${hit.length > 1 ? `${hit.length} outposts go` : `${def(hit[0]).name} goes`} dark`, 'info', 'message', { x: hit[0].x, z: hit[0].z });
      else if (o.outcome === 'capture') this.emit(`${hit.length > 1 ? `${hit.length} outposts are` : `The ${def(hit[0]).name} is`} ours now`, 'info', 'message', { x: hit[0].x, z: hit[0].z });
    }
    return hit.length;
  }

  /** A campaign faction's buildings (inside the colony's own view too). */
  factionBuildings(team: number) { return (this.all?.buildings ?? this.s.buildings).filter((b) => b.team === team); }
  /** Players still in the game (all of them in order; just [0] in the campaign). */
  private liveTeams() {
    const P = this.s.players;
    return P ? P.map((_, i) => i).filter((i) => !P[i].out) : [0];
  }

  /**
   * Run `fn` as player `t` sees the world: its own buildings, drones and units in the lists, its alloys, isotopes,
   * battery, research, drone fabrication, stats, power and fog in the top-level fields. Whatever `fn` adds to the lists
   * becomes `t`'s; whatever it takes out is gone. The campaign (no players) runs `fn` as it is.
   */
  withTeam<T>(t: number, fn: () => T): T {
    const s = this.s, P = s.players;
    if ((!P && !this.teamsOn) || this.all) return fn();
    const all = { buildings: s.buildings, drones: s.drones, units: this.units };
    const own = <X extends { team?: number }>(a: X[]) => a.filter((o) => (o.team ?? 0) === t);
    s.buildings = own(all.buildings); s.drones = own(all.drones); s.units = own(all.units);
    this.all = all;
    const e = t && P ? P[t].econ : undefined;
    if (e) this.swapEcon(e);
    const power = this.power, vis = this.vis, exp = this.exp;
    // (campaign factions have no economy or fog: only the colony's own view is ever swapped in there)
    if (P) {
      this.power = this.powerOf(t);
      const f = this.fogOf(t);
      this.vis = f.vis; this.exp = f.exp;
    }
    this.team = t;
    try {
      return fn();
    } finally {
      this.team = 0;
      this.power = power; this.vis = vis; this.exp = exp;
      if (e) this.swapEcon(e);
      const merge = <X extends { team?: number }>(whole: X[], mine: X[]) => {
        const keep = new Set(mine), had = new Set(whole);
        const out = whole.filter((o) => (o.team ?? 0) !== t || keep.has(o));
        for (const o of mine) if (!had.has(o)) { if (t) o.team = t; out.push(o); }
        return out;
      };
      s.buildings = merge(all.buildings, s.buildings);
      s.drones = merge(all.drones, s.drones);
      s.units = merge(all.units, s.units!);
      this.all = null;
    }
  }

  /** Trade the top-level economy fields with `e` (twice puts them back). */
  private swapEcon(e: Econ) {
    const s = this.s;
    [s.alloys, e.alloys] = [e.alloys, s.alloys];
    [s.isotopes, e.isotopes] = [e.isotopes, s.isotopes ?? 0];
    [s.stored, e.stored] = [e.stored, s.stored];
    [s.research, e.research] = [e.research, s.research ?? { done: [], active: null }];
    [s.fab, e.fab] = [e.fab, s.fab];
    [s.stats, e.stats] = [e.stats, s.stats];
  }

  private powerOf(t: number) {
    if (!t) return (this.powers[0] ??= this.power);
    return (this.powers[t] ??= { gen: 0, draw: 0, short: 0, storageMax: 0, daylight: 1 });
  }
  private fogOf(t: number) {
    if (!t) return (this.fogs[0] ??= { vis: this.vis, exp: this.exp });
    return (this.fogs[t] ??= { vis: new Uint8Array(FOG_N * FOG_N), exp: new Uint8Array(FOG_N * FOG_N) });
  }
  /** Tests: another computer player for a team (tools/ai-sim.mjs --baseline plays the last release's against the new one). */
  thinkers: Record<number, (h: AiHost, level: NonNullable<PlayerState['ai']>) => void> = {};
  /** What a computer player sees and does (called inside its `withTeam` view). */
  private aiHost(t: number): AiHost {
    const sim = this;
    return {
      get s() { return sim.s; },
      team: t,
      get power() { return sim.power; },
      place: (kind, x, z) => placeProblem(sim.world, DEFS, RULES, kind, x, z),
      run: (c) => sim.run(c),
      foes: () => sim.foes(t).filter((f) => f.hp > 0 && !(f as Hostile).under && sim.visible(f.x, f.z)) as ReturnType<AiHost['foes']>,
      researched: (id) => sim.researched(id),
      unitCap: () => sim.unitCap(),
      armySize: () => sim.armySize(),
      get secs() { return sim.secs; },
      vents: VENTS,
      visible: (x, z) => sim.visible(x, z),
    };
  }
  /** A player's stats (outside a swap). */
  private statsOf(t: number): SimStats {
    return !t || this.all ? this.s.stats : this.s.players?.[t]?.econ?.stats ?? this.s.stats;
  }

  /**
   * What player `t`'s guns and units fight: the fauna, and in a skirmish every unit, drone and building of a player on
   * another side. In the campaign this is exactly `s.hostiles` (same array, same order).
   */
  private foes(t: number): Foe[] {
    const s = this.s, P = s.players;
    if (!P && !this.teamsOn) return s.hostiles;
    if (this.foeTick !== s.tick) { this.foeCache.clear(); this.foeTick = s.tick; }
    let f = this.foeCache.get(t);
    if (f) return f;
    const B = this.all?.buildings ?? s.buildings, D = this.all?.drones ?? s.drones, U = this.all?.units ?? this.units;
    const enemy = (o: { team?: number }) => this.enemies(t, o.team ?? 0);
    // campaign factions: only we and our allies fight the wildlife
    const A = P ? 'self' : this.attitude(t);
    f = [...(A === 'self' || A === 'allied' ? s.hostiles : []), ...U.filter(enemy), ...D.filter(enemy), ...B.filter(enemy)];
    this.foeCache.set(t, f);
    return f;
  }
  /** A foe's body radius, and whether it flies. */
  // (hot loops: plain property reads, not `in` checks; fauna and units have `unit`, buildings `kind`, drones neither)
  private foeR(f: Foe) { const u = (f as Unit).unit; return u !== undefined ? content.units[u].radius : (f as Building).kind !== undefined ? bodyR(f as Building) : 1; }
  private foeAir(f: Foe) { const u = (f as Unit).unit; return u !== undefined && flies(content.units[u]); }
  /** Take a foe off the map: whatever kind it is. */
  private kill(f: Foe, by = 0) {
    // a skirmish player's kills of other players' things (fauna count as `kills`, in killHostile)
    if (!isHostile(f) && this.s.players) { const st = this.statsOf(by); st.enemyKills = (st.enemyKills ?? 0) + 1; }
    if (isHostile(f)) this.killHostile(f);
    else if (isBuilding(f)) this.destroyBuilding(f);
    else if (isDrone(f)) this.destroyDrone(f);
    else this.destroyUnit(f);
  }

  /**
   * A skirmish: the region's terrain with `setup.players` Command Cores on it, each with a worker drone and the starting
   * alloys. No cryo bank, colonists, story or missions; fauna and predator packs only if asked for.
   */
  newSkirmish(setup: SkirmishSetup) {
    this.newGame(setup.seed);
    const s = this.s;
    s.phase = 'deployed';
    s.buildings = []; s.drones = []; s.units = []; s.hostiles = []; s.packs = [];
    s.nests = []; s.relics = { grids: {}, caches: [] }; s.wrecks = [];
    s.stats = { kills: 0, buildingsLost: 0, dronesLost: 0, packsBeaten: 0, mined: 0, unitsLost: 0 };
    if (!setup.wildlife) { s.fauna = []; s.herds = []; }
    s.skirmish = { fog: setup.fog !== false, packs: !!setup.packs };
    s.factions = undefined;
    delete s.campaign;
    if (this.story.s) this.story.s.locked = []; // everything buildable from the start (no tutorial gates)
    if (!setup.packs) s.waves.next = Number.MAX_SAFE_INTEGER;
    this.slotsUsed = 0;
    const n = setup.players.length;
    const homes = setup.homes ?? skirmishHomes(n, limit());
    s.deposits = setup.deposits ?? s.deposits;
    s.players = setup.players.map((p, i) => ({ name: p.name, side: p.side ?? i, color: p.color, ai: p.ai, home: homes[i] }));
    this.powers = []; this.fogs = [];
    s.alloys = setup.alloys;
    s.players.forEach((p, i) => {
      if (i) p.econ = { alloys: setup.alloys, isotopes: 0, stored: 0, research: { done: [], active: null }, fab: { queued: 0, progress: 0 }, stats: { kills: 0, buildingsLost: 0, dronesLost: 0, packsBeaten: 0, mined: 0, unitsLost: 0 } };
      const team = i ? i : undefined, h = p.home;
      s.buildings.push({ id: s.nextId++, team, kind: 'core', x: h.x, z: h.z, progress: 1, hp: DEFS.core.hp, on: true, powered: true });
      // the drone parks on the side of the Core toward the middle of the map
      const a = Math.atan2(-h.x, -h.z);
      s.drones.push({ id: s.nextId++, team, x: h.x + Math.sin(a) * 14, z: h.z + Math.cos(a) * 14, heading: a, hp: RULES.droneHp, task: { kind: 'idle' } });
    });
    for (const t of this.liveTeams()) this.withTeam(t, () => { this.fogOf(t).exp.fill(0); this.stepFog(true); });
  }

  /** A player's Command Core fell: everything of theirs goes, and the game ends when one side is left. */
  private eliminate(t: number) {
    const s = this.s, P = s.players!;
    if (P[t].out) return;
    P[t].out = true;
    const mine = (o: { team?: number }) => (o.team ?? 0) === t;
    for (const o of [...s.buildings.filter(mine), ...s.drones.filter(mine), ...this.units.filter(mine)]) this.fx.push(FX.DIE_BIG, o.x, o.z, 0, 0);
    s.buildings = s.buildings.filter((o) => !mine(o));
    s.drones = s.drones.filter((o) => !mine(o));
    s.units = this.units.filter((o) => !mine(o));
    this.emit(t === 0 ? 'Your Command Core has fallen. You are out of the game.' : `${P[t].name} has been defeated`, t === 0 ? 'bad' : 'info', t === 0 ? 'alarm' : 'packCleared');
    const sides = new Set(P.filter((p) => !p.out).map((p) => p.side));
    // you're out (and nobody on your side is left): your game is over, whoever goes on fighting
    if (t === 0 && !P[0].ai && !P.some((p) => !p.out && p.side === P[0].side) && sides.size > 1) { s.over = 'core'; s.overText = 'Defeat: your Command Core has fallen'; return; }
    if (sides.size > 1) return;
    if (P[0].out) { s.over = 'core'; s.overText = sides.size ? `Defeat: ${P.filter((p) => !p.out).map((p) => p.name).join(' and ')} won` : 'Defeat'; }
    else this.end('won', `Victory: ${P.filter((p) => !p.out).map((p) => p.name).join(' and ')} won`);
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
    const kinds = regionHerdSpecies();
    REGION.herds.forEach((hd, herd) => {
      const sp = kinds[herd];
      s.herds.push({ x: hd.x, z: hd.z, sp });
      const n = herdCount(hd.grazers, content.wildlife[sp]);
      for (let i = 0; i < n; i++) {
        const x = clamp(hd.x + (this.rnd() - 0.5) * 30, -limit(), limit());
        const z = clamp(hd.z + (this.rnd() - 0.5) * 30, -limit(), limit());
        s.fauna.push({ x, z, heading: this.rnd() * Math.PI * 2, tx: x, tz: z, herd, sp, ang: this.rnd() * Math.PI * 2 });
      }
    });
    this.slotsUsed = 0;
    s.wrecks = this.regionWrecks();
    s.isotopes = 0;
    s.seams = this.regionSeams();
    s.research = { done: [], active: null };
    s.planet = Planet.fresh();
    s.campaign = newCampaign(REGION_ID);
    this.expedition();
    this.initNests();
    this.initRelics();
    this.exp.fill(0);
    this.stepFog(true);
    this.initFactions();
  }

  /** A region you travel to (its `expedition`): what the expedition brings; without colonists, no cryo bank or people. */
  private expedition() {
    const ex = expeditionOf(REGION), s = this.s;
    if (!ex) return;
    if (ex.alloys !== undefined) s.alloys = ex.alloys;
    s.isotopes = ex.isotopes ?? 0;
    const drones = ex.drones ?? 1;
    s.drones = [];
    for (let i = 0; i < drones; i++) {
      const a = Math.PI + (i - (drones - 1) / 2) * 0.5;
      s.drones.push({ id: s.nextId++, x: Math.sin(a) * 14, z: Math.cos(a) * 14, heading: a, hp: RULES.droneHp, task: { kind: 'idle' } });
    }
    let row = 0;
    for (const u of ex.units ?? []) if (content.units[u.unit]?.faction === 'accord') { this.spawnAt(u.unit, u.count ?? 1, -9, 12 + row * 4); row += Math.ceil((u.count ?? 1) / 4); }
    if (!ex.people) {
      s.expedition = true;
      if (s.people) s.people.bank = s.people.bank.map(() => 0);
    }
  }

  /** Campaign travel: the region being played counts as visited (a new game, a load, the shared state laid over). */
  arrived() {
    const s = this.s;
    if (s.players) return;
    const c = (s.campaign ??= newCampaign(REGION_ID));
    if (!c.visited.includes(REGION_ID)) c.visited.push(REGION_ID);
  }

  load(state: SimState) {
    // content may have changed since the save: drop things that no longer exist
    state.buildings = state.buildings.filter((b) => DEFS[b.kind] || b.kind === 'core');
    state.hostiles = state.hostiles.filter((h) => content.units[h.unit]);
    state.units = (state.units ?? []).filter((u) => content.units[u.unit]);
    state.stats.unitsLost ??= 0;
    for (const b of state.buildings) if (b.queue) b.queue = b.queue.filter((k) => content.units[k]);
    for (const b of state.buildings) b.hp = Math.min(b.hp, DEFS[b.kind]?.hp ?? b.hp);
    // wildlife from before species: each creature takes its herd's
    const kinds = regionHerdSpecies();
    for (const f of state.fauna) if (!f.sp || !content.wildlife[f.sp]) f.sp = state.herds[f.herd]?.sp && content.wildlife[state.herds[f.herd].sp!] ? state.herds[f.herd].sp : kinds[f.herd];
    this.s = state;
    // a skirmish's other players start with fresh power and fog (worked out again on the next tick)
    this.powers = []; this.fogs = []; this.falling = [];
    this.people.load();
    this.inhabitants.load(REGION.camps ?? []);
    this.story.load();
    this.missions.load();
    this.arrived();
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
    if (!state.factions && REGION.factions?.length) this.initFactions();
    if (state.players) for (const t of this.liveTeams()) this.withTeam(t, () => this.stepFog(true));
    else this.withTeam(0, () => this.stepFog(true));
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

  /** Worked out once a tick (or when research or the boosts change): every modifier summed (src/sim/mods.ts). */
  private modMemo: { tick: number; done: readonly string[] | null; n: number; b: number; v: Partial<Record<ModStat, number>> } = { tick: -1, done: null, n: -1, b: -1, v: {} };
  /** A colony modifier: finished research plus story boosts still running (0 when nothing changes it). */
  mod(stat: ModStat): number {
    const s = this.s, done = s.research?.done ?? [], boosts = s.story?.mods ?? [], m = this.modMemo;
    if (m.tick !== s.tick || m.done !== done || m.n !== done.length || m.b !== boosts.length) {
      m.v = modTotals(done, content.research, boosts, s.tick);
      m.tick = s.tick; m.done = done; m.n = done.length; m.b = boosts.length;
    }
    return m.v[stat] ?? 0;
  }
  /** Everything the modifiers add up to now (snapshot: the research tree and the Colony panel). */
  modsNow() { this.mod('mining'); return { ...this.modMemo.v }; }
  /** Drone build and repair speed: the Devoted's Vigil and research. */
  droneWork() { return this.people.droneWork() * Math.max(0.1, 1 + this.mod('droneWork')); }
  /** Worker drones allowed. */
  maxDrones() { return RULES.maxDrones + Math.round(this.mod('drones')); }
  /** Seconds a destroyed nest takes to grow back. */
  nestRegrowSecs() { return (THREATS.nestRegrow ?? 600) * Math.max(0.1, 1 + this.mod('nestRegrow')); }
  /** Share of a blow a building takes (armour research). */
  buildingHarm(b: Building) { return clamp(1 - this.mod('armor'), 0.2, 2) * this.frontier.harm(b) * (this.s.people ? this.people.heroGuard(b) : 1); }
  /** The region's pack size multiplier. */
  regionPackScale() { return packScale(); }
  /**
   * A relic surge (the frontier): `n` sentinels break the surface round (x, z), awake, on free ground. Their ids.
   */
  surge(x: number, z: number, n: number): number[] {
    const s = this.s, unit = relicUnit('sentinel'), out: number[] = [];
    if (!unit) return out;
    for (let i = 0; i < n; i++) {
      const slot = this.freeSlot();
      if (slot < 0) break;
      let at = { x, z };
      for (let tries = 0; tries < 24; tries++) {
        const a = (i / n) * Math.PI * 2 + tries * 0.7 + this.rnd(), r = 16 + tries * 0.8;
        const px = clamp(x + Math.cos(a) * r, -limit(), limit()), pz = clamp(z + Math.sin(a) * r, -limit(), limit());
        if (s.buildings.some((b) => Math.hypot(b.x - px, b.z - pz) < bodyR(b) + 3) || this.blocked(px, pz)) continue;
        at = { x: px, z: pz };
        break;
      }
      const id = s.nextId++;
      s.hostiles.push({ id, unit, slot, x: at.x, z: at.z, heading: this.rnd() * Math.PI * 2, hp: content.units[unit].hp, target: -1, cd: 1 + this.rnd(), pack: -1, relic: 'surge' });
      this.fx.push(FX.EMERGE, at.x, at.z, 0, 0);
      out.push(id);
    }
    return out;
  }

  /** What research gates look at (src/sim/mods.ts ResearchWorld). */
  researchWorld(): ResearchWorld {
    const s = this.s;
    return {
      done: s.research?.done ?? [], buildings: s.buildings, flags: s.story?.flags ?? [],
      specialists: (s.people?.colonists ?? []).filter((c) => c.specialty && this.people.adult(c)).map((c) => c.specialty!),
    };
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
      const k = 1 + this.mod('cacheYield');
      alloys = Math.round(alloys * k); iso = Math.round(iso * k);
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
        if (!s.hostiles.some((h) => h.id === n.id)) { n.id = -1; n.regrow = s.tick + Math.round(this.nestRegrowSecs() * TICK_HZ); }
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
      const take = Math.min(w.alloys, SALVAGE_RATE * (1 + this.mod('salvage')) * DT);
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
  private get world(): PlaceWorld {
    const others = this.all ? this.all.buildings.filter((b) => (b.team ?? 0) !== this.team) : undefined;
    return { buildings: this.s.buildings, others, deposits: this.s.deposits, vents: VENTS, seams: this.s.seams, campSites: campSites(this.s.camps ?? []) };
  }
  private entity(id: number): Building | Drone | Unit | Colonist | undefined {
    return this.s.buildings.find((b) => b.id === id) ?? this.s.drones.find((d) => d.id === id) ?? this.units.find((u) => u.id === id) ?? this.people.colonist(id);
  }

  // ---------- tick ----------
  step() {
    const s = this.s;
    if (s.over) return;
    s.tick++;
    if (s.players && this.deployed) {
      // skirmish: each player's economy in its own view, then one fight for everyone
      for (const t of this.liveTeams()) this.withTeam(t, () => {
        this.stepPower();
        this.stepDrones();
        this.stepFab();
        this.stepFactories();
        this.stepResearch();
        this.stepMining();
        this.stepRepairPads();
      });
      // computer players think (each on its own beat, staggered so they don't all think on the same tick)
      for (const t of this.liveTeams()) {
        const lv = s.players[t].ai;
        if (!lv || (s.tick + t * 7) % AI_LEVELS[lv].period) continue;
        this.withTeam(t, () => (this.thinkers[t] ?? aiThink)(this.aiHost(t), lv));
      }
      this.stepTurrets();
      this.stepUnits();
      this.stepShields();
      this.stepHostiles();
      this.stepNests();
      if (s.skirmish?.packs) this.stepWaves();
      for (const t of this.falling.splice(0)) this.eliminate(t);
      if (s.tick % 5 === 0) for (const t of this.liveTeams()) this.withTeam(t, () => this.stepFog());
      this.stepGrazers();
      return;
    }
    if (this.deployed) {
      // with campaign factions on the map the colony's own steps see only its own things, and the fight is everyone's
      // (without any, `withTeam` just runs them)
      this.withTeam(0, () => {
        this.stepPower();
        this.stepDrones();
        this.stepFab();
        this.stepFactories();
        this.stepResearch();
        this.stepMining();
      });
      this.stepTurrets();
      this.withTeam(0, () => this.stepRepairPads());
      this.stepUnits();
      this.stepShields();
      this.stepHostiles();
      this.stepNests();
      this.withTeam(0, () => {
        this.stepRelics();
        this.stepWaves();
        this.frontier.step();
        if (!s.expedition) { this.stepCryo(); this.people.step(); } // an expedition has no cryo bank or colonists
        this.planet.step();
        this.inhabitants.step();
        this.story.step();
        this.stepEncounters();
        this.stepFactions();
        this.missions.step();
        if (s.tick % TICK_HZ === 0 && this.deployed) { recordChronicle(s, this.secs); this.recordHome(); }
      });
    }
    if (s.tick % 5 === 0) this.withTeam(0, () => this.stepFog());
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
      if (d.role === 'battery') { cap += (d.storage ?? 0) * (1 + this.mod('battery')); b.powered = true; }
      if (d.role === 'reactor') {
        // steady power while it has fuel: no isotopes, no power
        const need = (d.fuelRate ?? 0) * DT;
        if ((s.isotopes ?? 0) >= need) { s.isotopes = (s.isotopes ?? 0) - need; gen += d.powerMW * this.people.mult(b); b.powered = true; }
        else if (!b.starved) { b.starved = true; this.emit(`${d.name} is out of isotopes: no power from it`, 'warn', 'warning'); }
        if ((s.isotopes ?? 0) >= need * 20) b.starved = false;
        continue;
      }
      if (d.powerMW > 0) { gen += (d.role === 'solar' ? d.powerMW * this.solarFactor() * (1 + this.mod('solar')) : d.powerMW) * this.people.mult(b); b.powered = true; }
      else if (d.powerMW < 0) {
        // homes and growth pods share the cryo bank's priority; farms run with the radar
        // a matter printer only gets what nothing else wants (rank 4, live power only)
        const rank = d.role === 'printer' ? 4 : d.fireRange || d.role === 'shield' ? 0 : d.role === 'civic' || d.role === 'medbay' ? 1 : d.role === 'radar' || d.role === 'factory' || d.role === 'repair' || d.role === 'farm' || d.role === 'sensor' || d.role === 'relay' || d.role === 'seedbank' ? 2 : 3;
        const idle = (d.fireRange && !b.engaged) || (d.role === 'factory' && !b.queue?.length) || (d.role === 'repair' && !b.engaged);
        loads.push({ b, mw: (-d.powerMW * (idle ? STANDBY : 1) + (d.role === 'civic' ? this.people.podDraw(b) : 0)) * this.people.powerDraw() * Math.max(0.2, 1 + this.mod('power')), rank, battery: d.role !== 'depot' && d.role !== 'printer' });
      } else b.powered = true;
    }
    const drones = s.drones.reduce((m, d) => m + (d.task.kind === 'idle' ? RULES.droneIdleDrawMW : RULES.droneBusyDrawMW), 0);
    const essential = (s.players || s.expedition ? 0 : RULES.cryoDrawMW) + drones; // (a skirmish or an expedition has no cryo bank)
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
          if (th === 75 && s.people) this.people.say('brownout');
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
      if (this.deployed) this.emit(`Wreck sighted ${compass(w.x, w.z)} of the Core. Field Engineers can salvage it.`, 'warn', 'discovery');
    }
    if (this.team === 0 && (grew || force || !s.explored)) { // (the local player's: what saves keep)
      let str = '';
      for (let i = 0; i < exp.length; i++) str += exp[i] ? '1' : '0';
      s.explored = str;
    }
  }

  /** Is region point (x, z) in sight right now? */
  visible(x: number, z: number) {
    const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
    return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && (this.vis[j * FOG_N + i] === 1 || this.s.skirmish?.fog === false);
  }
  /** In sight of player `t` (outside a swap: `visible` is player 0's). */
  private visibleTo(t: number, x: number, z: number) {
    if (!this.s.players) return t ? true : this.visible(x, z); // (campaign factions keep no fog)
    if (!t) return this.visible(x, z);
    if (this.s.skirmish?.fog === false) return true;
    const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
    return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && this.fogOf(t).vis[j * FOG_N + i] === 1;
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
          site.progress = dd.buildSeconds > 0 ? Math.min(1, site.progress + (DT * this.droneWork()) / dd.buildSeconds) : 1;
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
          const hp = Math.min(RULES.repairRate * this.droneWork() * DT, maxHp(b) - b.hp);
          const cost = (hp / dd.hp) * dd.cost * 0.5;
          if (s.alloys >= cost) { s.alloys -= cost; b.hp += hp; }
        }
      }
      if (d.task.kind === 'idle' && !d.manual) this.autoTask(d);
    }
  }

  private nearestHostile(x: number, z: number) {
    let best: Foe | null = null, bd = Infinity;
    for (const h of this.foes(this.team)) {
      if ((isHostile(h) && h.under) || isBuilding(h) || h.hp <= 0) continue;
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
      s.stats.unitsBuilt = (s.stats.unitsBuilt ?? 0) + 1;
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
    a.progress = Math.min(1, a.progress + (DT * rate * (1 + this.mod('researchSpeed'))) / Math.max(1, r.seconds));
    if (a.progress < 1) return;
    s.research!.done.push(a.id);
    s.research!.active = null;
    s.stats.researched = (s.stats.researched ?? 0) + 1;
    const unlocks = [...Object.values(DEFS), ...Object.values(content.units)].filter((x) => x.research === a.id).map((x) => x.name);
    this.emit(`Research complete: ${r.name}${unlocks.length ? ` · unlocks ${unlocks.join(', ')}` : ''}`, 'info', 'research');
    if (s.people) this.people.say('research', s.people.colonists.find((c) => c.specialty === 'technician'), { other: r.name });
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
        const take = Math.min(sm.isotopes, (d.mineRate ?? 0) * this.people.mult(b) * (1 + this.mod('isotopeMining')) * DT);
        sm.isotopes -= take;
        s.isotopes = (s.isotopes ?? 0) + take;
        s.stats.isotopesMined = (s.stats.isotopesMined ?? 0) + take;
        this.planet.minedIsotopes(sm.x, sm.z, take);
        if (sm.isotopes <= 0) this.emit(`Isotope seam ${compass(sm.x, sm.z)} of the Core is exhausted`, 'warn', 'exhausted');
        continue;
      }
      if (d.role === 'printer') {
        // alloys from spare power: no deposit, no scars
        if (b.progress >= 1 && b.powered) {
          const made = (d.mineRate ?? 0) * this.people.mult(b) * (1 + this.mod('printer')) * DT;
          s.alloys += made;
          s.stats.printed = (s.stats.printed ?? 0) + made;
        }
        continue;
      }
      if (d.role !== 'depot' || b.progress < 1) continue;
      if (b.mining === undefined || b.mining < 0 || !s.deposits[b.mining] || s.deposits[b.mining].alloys <= 0) b.mining = depositFor(s, d, b.x, b.z);
      if (!b.powered || b.mining < 0) continue;
      const dep = s.deposits[b.mining];
      const take = Math.min(dep.alloys, (d.mineRate ?? 0) * this.people.mult(b) * (1 + this.mod('mining')) * DT);
      dep.alloys -= take;
      s.alloys += take;
      s.stats.mined += take;
      this.planet.mined(dep.x, dep.z, take);
      this.inhabitants.mined(dep.x, dep.z, take);
      if (dep.alloys <= 0) this.emit(`Deposit ${compass(dep.x, dep.z)} of the Core is exhausted`, 'warn', 'exhausted');
    }
    s.alloys += RULES.alloyTrickle * DT;
  }

  // ---------- combat ----------
  private unitDef(h: Hostile): UnitDef { return content.units[h.unit]; }

  /** Can the colony shoot at this hostile? Not while it's underground or out of sight. */
  private targetable(h: Foe, team = 0) {
    return h.hp > 0 && !(h as Hostile).under && !(h as Hostile).dormant && this.visibleTo(team, h.x, h.z);
  }

  /** Can a shooter (anti-air or not) hit this hostile: targetable, and not a flyer unless it can hit flyers. */
  private canHit(h: Foe, antiAir: boolean | undefined, airOnly = false, team = 0) {
    if (!this.targetable(h, team)) return false;
    const f = this.foeAir(h);
    return f ? !!antiAir : !airOnly;
  }

  /**
   * One hit on `tgt` from (fx, fz): splash does half damage around the target;
   * a chain jumps on to the nearest unhit hostile within `chainRange`, losing
   * 30% each jump. Effects are pushed here so every shooter looks the same.
   */
  private strike(fx: number, fz: number, tgt: Foe, dmg: number, fxKind: number, o: { splash?: number; chain?: number; chainRange?: number; antiAir?: boolean } = {}, team = 0) {
    const tx = tgt.x, tz = tgt.z;
    if (isHostile(tgt) && tgt.relic) dmg *= 1 + this.mod('relicDamage');
    const foes = this.foes(team);
    // splash stays at the target's level (a burst in the air catches flyers, one on the ground doesn't); a chain reaches flyers only if anti-air
    const air = this.foeAir(tgt);
    this.fx.push(fxKind, fx, fz, tx, tz);
    tgt.hp -= dmg * this.armour(tgt);
    if (team && !isHostile(tgt)) this.underAttack(tgt);
    if (o.splash) {
      for (const h of [...foes]) {
        if (h !== tgt && h.hp > 0 && !(isHostile(h) && h.under) && this.foeAir(h) === air && Math.hypot(h.x - tx, h.z - tz) < o.splash) { h.hp -= (dmg / 2) * this.armour(h); if (h.hp <= 0) this.kill(h, team); }
      }
    }
    if (o.chain && o.chainRange) {
      const hit = new Set<Foe>([tgt]);
      let from: Foe = tgt, d = dmg;
      for (let j = 0; j < o.chain; j++) {
        let next: Foe | null = null, bd = o.chainRange;
        for (const h of foes) {
          if (hit.has(h) || h.hp <= 0 || (isHostile(h) && h.under) || (!o.antiAir && this.foeAir(h))) continue;
          const dist = Math.hypot(h.x - from.x, h.z - from.z);
          if (dist < bd) { bd = dist; next = h; }
        }
        if (!next) break;
        d *= CHAIN_FALLOFF;
        this.fx.push(FX.ARC, from.x, from.z, next.x, next.z);
        next.hp -= d * this.armour(next);
        hit.add(next);
        if (from !== tgt && from.hp <= 0) this.kill(from, team);
        from = next;
      }
      for (const h of hit) if (h !== tgt && h.hp <= 0) this.kill(h, team);
    }
    if (tgt.hp <= 0) this.kill(tgt, team);
  }

  /** What share of a hit a target takes: units dug in (siege) or under a shield ability take less. */
  private armour(f: Foe) {
    if (!isUnit(f)) return 1;
    const d = content.units[f.unit];
    let k = d && abilityOn(f, d, 'siege') ? SIEGE_ARMOUR : 1;
    if (this.auras.length) {
      let best = 1;
      for (const a of this.auras) if (this.allied(a.team, f.team ?? 0) && Math.hypot(f.x - a.x, f.z - a.z) <= a.r) best = Math.min(best, a.keep);
      k *= best;
    }
    return k;
  }

  /**
   * A unit's ability (the player's G or button, or a computer player): false if it has none or it isn't ready.
   * Commands run inside the player's own view, so the instant kinds (pulse, mend) only arm here and go off in
   * the shared fight (stepUnits), where they can reach everyone's things.
   */
  private useAbility(u: Unit): boolean {
    const d = content.units[u.unit];
    if (!d?.ability || (u.ab ?? 0) > 0 || u.ride !== undefined) return false;
    u.ab = d.abilityCooldown ?? ABILITY_CD;
    if (d.ability === 'pulse' || d.ability === 'mend') { u.abFire = true; return true; }
    u.abT = d.abilitySeconds ?? 5;
    if (d.ability === 'siege') { u.order = { kind: 'idle' }; u.gx = u.x; u.gz = u.z; u.path = undefined; }
    return true;
  }

  /** An armed instant ability goes off (in the shared fight). */
  private fireAbility(u: Unit, d: UnitDef) {
    u.abFire = undefined;
    const team = u.team ?? 0, p = d.abilityPower ?? 1, r = d.abilityRadius ?? 0;
    if (d.ability === 'pulse') {
      for (const h of [...this.foes(team)]) {
        if (h.hp <= 0 || !this.targetable(h, team) || Math.hypot(h.x - u.x, h.z - u.z) - this.foeR(h) > r) continue;
        this.strike(u.x, u.z, h, p, FX.ARC, {}, team);
      }
    } else if (d.ability === 'mend') {
      for (const o of this.units) {
        if (!this.allied(o.team ?? 0, team) || Math.hypot(o.x - u.x, o.z - u.z) > r) continue;
        const max = content.units[o.unit].hp;
        if (o.hp < max) { o.hp = Math.min(max, o.hp + p); this.fx.push(FX.REPAIR, u.x, u.z, o.x, o.z); }
      }
      for (const b of this.s.buildings) {
        if (!this.allied(b.team ?? 0, team) || b.progress < 1 || Math.hypot(b.x - u.x, b.z - u.z) > r + bodyR(b)) continue;
        const max = def(b).hp;
        if (b.hp < max) { b.hp = Math.min(max, b.hp + p); this.fx.push(FX.REPAIR, u.x, u.z, b.x, b.z); }
      }
    }
  }

  private stepTurrets() {
    const s = this.s;
    for (const b of s.buildings) {
      const d = def(b);
      if (!d.fireRange || !d.damage || !d.cooldown || b.progress < 1) continue;
      if (b.off) { b.engaged = false; continue; } // a faction's outpost the story disabled
      b.cd = Math.max(0, (b.cd ?? 0) - DT);
      // turned by the Clause (a glitch): it faces the colony and holds fire, then turns back
      if (b.slew) {
        if (b.slew.until > s.tick) { b.aim = b.slew.aim; b.engaged = false; continue; }
        b.aim = b.slew.was ?? b.yaw ?? 0;
        b.slew = undefined;
      }
      const min = d.minRange ?? 0, team = b.team ?? 0;
      let best: Foe | null = null, bs = Infinity;
      for (const h of this.foes(team)) {
        if (!this.canHit(h, d.antiAir, d.airOnly, team)) continue;
        const dist = Math.hypot(h.x - b.x, h.z - b.z) - this.foeR(h);
        // anything that moves before buildings
        const score = dist + (isBuilding(h) ? BUILDING_LAST : 0);
        if (dist <= d.fireRange && dist >= min && score <= bs) { bs = score; best = h; } // (ties: the later one, as before)
      }
      b.engaged = !!best;
      if (!best || !b.powered) continue;
      b.aim = Math.atan2(best.x - b.x, best.z - b.z);
      if (b.cd > 0) continue;
      b.cd = d.cooldown ?? 1;
      this.strike(b.x, b.z, best, (d.damage ?? 0) * this.people.mult(b) * (1 + this.mod('turretDamage')) * this.frontier.fire(b), weaponFx(d.weapon ?? (d.splash ? 'shell' : 'cannon'), true), { splash: d.splash, antiAir: d.antiAir }, team);
    }
    this.stepWardens();
  }

  /**
   * Inhabitants fighting beside us (asked-for hunters, a trusted camp defending its land): strike the predator nearest
   * (x, z) within `range` (never a relic, a nest, a burrower underground or a flyer). True if they struck.
   */
  nativeStrike(x: number, z: number, range: number, dmg: number, weapon?: Weapon, from?: { x: number; z: number }) {
    let best: Hostile | null = null, bd = range;
    for (const h of this.s.hostiles) {
      if (h.hp <= 0 || h.relic || h.nest !== undefined || h.under || h.dormant || flies(this.unitDef(h))) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d <= bd) { bd = d; best = h; }
    }
    if (!best) return false;
    const o = from ?? { x, z };
    this.strike(o.x, o.z, best, dmg, weaponFx(weapon ?? 'bolt', false));
    return true;
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
        if (!this.canHit(h, false)) continue;
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
        u.hp = Math.min(ud.hp, u.hp + (d.repairRate ?? 10) * (1 + this.mod('repairPad')) * DT);
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
      if (t.cargo.length === td.carries || !this.units.some((o) => o !== u && o.ride === t.id)) this.emit(`${td.name}: ${t.cargo.length} aboard`, 'info', 'confirm');
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
  /** Combat units a player may have: the colony rules' limit, or a skirmish's own (bigger: armies are the point). */
  unitCap() { return this.s.skirmish ? (this.s.skirmish.unitCap ?? SKIRMISH_UNITS) : RULES.maxUnits + Math.round(this.mod('units')); }
  armySize() { return this.units.reduce((m, u) => m + 1 + (u.cargo?.length ?? 0), 0); }

  /**
   * Buildings by index, each in every cell its body (a wall: its whole segment) touches, plus a margin
   * for the biggest body pushed against it. Rebuilt only when buildings come or go.
   */
  private buildingBuckets() {
    const bs = this.s.buildings;
    let sum = 0;
    for (const b of bs) sum = (sum * 31 + b.id) | 0;
    const key = `${bs.length}:${sum}`;
    if (key !== this.bldKey) {
      this.bldKey = key;
      const B = this.bldBuckets;
      B.clear();
      bs.forEach((b, i) => {
        if (barrier(b)) { const w = wallEnds(b); B.add(i, (w.ax + w.bx) / 2, (w.az + w.bz) / 2, Math.hypot(w.bx - w.ax, w.bz - w.az) / 2 + WALL_HALF + BODY_MARGIN); }
        else B.add(i, b.x, b.z, bodyR(b) + BODY_MARGIN);
      });
    }
    return this.bldBuckets;
  }

  /** Targetable hostiles at the building they're attacking (idle units answer these). */
  private raiders(team = 0): Foe[] {
    const s = this.s;
    const byId = new Map(s.buildings.map((b) => [b.id, b]));
    const fauna = s.hostiles.filter((h) => {
      if (!this.targetable(h, team)) return false;
      const b = byId.get(h.target);
      return !!b && this.allied(team, b.team ?? 0) && Math.hypot(b.x - h.x, b.z - h.z) <= bodyR(b) + 12;
    });
    if (!s.players) return fauna;
    // skirmish: enemy units and drones in among our buildings too
    const mine = s.buildings.filter((b) => this.allied(team, b.team ?? 0));
    return [...fauna, ...this.foes(team).filter((f) => !isHostile(f) && !isBuilding(f) && this.targetable(f, team) &&
      mine.some((b) => Math.hypot(b.x - f.x, b.z - f.z) <= bodyR(b) + 14))];
  }

  /** Building bodies onto the path grids these units use (gates are open to units: not obstacles). */
  private setUnitBodies(us: Unit[]) {
    const bodies = this.s.buildings.filter((b) => def(b).role !== 'gate').map((b) => ({ x: b.x, z: b.z, r: bodyR(b) }));
    const moves = new Set(us.map((u) => moveOf(content.units[u.unit])));
    for (const m of moves) if (m !== 'air') this.unitGrid(m).setBodies(bodies, PATH_PAD);
  }
  private unitGrid(m: Move) { return (this.unitGrids[m] ??= new PathGrid(limit(), m)); }
  private faunaGrid(m: Move) { return (this.faunaGrids[m] ??= new PathGrid(limit(), m)); }

  /**
   * Whether a predator can get close enough to hit something at (x, z) (`r` = its body radius):
   * ground fauna can't cross water to an island, sea creatures can't leave the water. Hover,
   * burrowing and rooted ones (nests, relics) aren't limited.
   */
  private canReach(h: Hostile, u: UnitDef, x: number, z: number, r: number) {
    const m = moveOf(u);
    if (straight(m) || h.under || u.burrows || u.speed <= 0) return true;
    return this.faunaGrid(m).reaches(h.x, h.z, x, z, r + u.range + 1.5);
  }

  /**
   * A predator heads for (tx, tz): ground fauna follow a path round water (re-planned every few
   * seconds, or when the target has moved off), hover fauna go straight.
   */
  private chase(h: Hostile, u: UnitDef, tx: number, tz: number, speed: number) {
    const move = moveOf(u);
    if (straight(move)) { this.steer(h, tx, tz, speed, move); return; }
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
  private steer(o: { x: number; z: number; heading: number }, tx: number, tz: number, speed: number, move: Move = 'ground', brake = false) {
    let ang = Math.atan2(tx - o.x, tz - o.z);
    let step = Math.min(speed * DT, Math.hypot(tx - o.x, tz - o.z));
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const a = ang + off;
      if (!this.blocked(o.x + Math.sin(a) * (step + 2), o.z + Math.cos(a) * (step + 2), move)) { ang = a; break; }
    }
    let dh = ang - o.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    // slow into a sharp turn rather than swing wide (into a building, or round and round a waypoint)
    if (brake) step *= 0.25 + 0.75 * Math.max(0, Math.cos(dh));
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
      const m = moveOf(content.units[u.unit]);
      u.path = m === 'air' ? [tx, tz] : this.unitGrid(m).find(u.x, u.z, tx, tz) ?? [];
      u.repath = t + REPATH + (u.id % 7);
    }
    const p = u.path;
    // on to the next waypoint once at this one, or past it (heading along the next leg)
    while (p.length > 2) {
      const ax = p[0] - u.x, az = p[1] - u.z;
      if (Math.hypot(ax, az) < 1.5 || (Math.hypot(ax, az) < 4 && ax * (p[2] - p[0]) + az * (p[3] - p[1]) < 0)) p.splice(0, 2);
      else break;
    }
    if (!p.length) return false;
    // the goal is walled off or inside a building: the path ends at the nearest place it can get, so stop there
    const ex = p[p.length - 2], ez = p[p.length - 1];
    if (p.length === 2 && Math.hypot(ex - tx, ez - tz) > 2 && Math.hypot(ex - u.x, ez - u.z) < 1.5) return false;
    this.steer(u, p[0], p[1], speed, moveOf(content.units[u.unit]), true);
    // progress is what's left along the path, not as the crow flies: a detour round a base gets farther first
    let left = Math.hypot(p[0] - u.x, p[1] - u.z);
    for (let k = 2; k < p.length; k += 2) left += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    if (left < (u.best ?? Infinity) - 0.5) { u.best = left; u.stall = 0; }
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
    if (us.length) this.setUnitBodies(us);
    const boarded: Unit[] = [];
    const raiders = new Map<number, Foe[]>(); // hostiles at a building, worked out once per player if an idle unit asks
    this.auras.length = 0;
    for (const u of [...us]) {
      const d = content.units[u.unit];
      if (u.abFire && u.hp > 0) this.fireAbility(u, d);
    }
    for (const u of us) {
      const d = content.units[u.unit];
      if (u.ab) u.ab = Math.max(0, u.ab - DT);
      if (u.abT) u.abT = Math.max(0, u.abT - DT);
      if (abilityOn(u, d, 'shield')) this.auras.push({ x: u.x, z: u.z, r: d.abilityRadius ?? 0, keep: Math.max(0, 1 - (d.abilityPower ?? 0.5)), team: u.team ?? 0 });
    }
    for (const u of us) {
      const d = content.units[u.unit];
      u.cd = Math.max(0, u.cd - DT);
      if (u.ride !== undefined) { if (this.stepBoarding(u, d)) boarded.push(u); continue; }
      if (u.drop) { this.stepLanding(u, d); continue; }
      if (d.rescues) { this.stepMedevac(u, d); continue; }
      if (d.repairRate) { this.stepRepairer(u, d); continue; }
      let moving = u.order.kind === 'move';
      const team = u.team ?? 0, foes = this.foes(team);
      const pw = d.abilityPower ?? 1, sieged = abilityOn(u, d, 'siege');
      const range = d.range * (sieged ? pw : 1), speed = d.speed * (abilityOn(u, d, 'boost') ? pw : 1);
      let tgt = u.target >= 0 ? foes.find((h) => h.id === u.target) : undefined;
      if (tgt && !this.canHit(tgt, d.antiAir, false, team)) tgt = undefined;
      const leash = Math.max(d.aggro * LEASH, RULES.unitResponse + 10);
      const min = d.minRange ?? 0;
      if (!tgt || (s.tick + u.id) % 5 === 0) {
        const seek = moving ? range : Math.max(d.aggro, range);
        let bd = Infinity;
        tgt = undefined;
        for (const h of foes) {
          if (!this.canHit(h, d.antiAir, false, team)) continue;
          const dist = Math.hypot(h.x - u.x, h.z - u.z) - this.foeR(h);
          const score = dist + (isBuilding(h) ? BUILDING_LAST : 0);
          if (dist <= seek && dist >= min && score < bd) { bd = score; tgt = h; }
        }
        // idle: answer attacks on buildings near the guard post
        if (!tgt && !moving) {
          let rs = raiders.get(team);
          if (!rs) raiders.set(team, (rs = this.raiders(team)));
          for (const h of rs) {
            if (h.hp <= 0 || Math.hypot(h.x - u.gx, h.z - u.gz) > RULES.unitResponse || !this.canHit(h, d.antiAir, false, team)) continue; // (killed earlier this tick)
            const dist = Math.hypot(h.x - u.x, h.z - u.z);
            if (dist < bd && dist - this.foeR(h) >= min) { bd = dist; tgt = h; }
          }
        }
      }
      if (tgt && !moving && Math.hypot(tgt.x - u.gx, tgt.z - u.gz) > leash) tgt = undefined;
      // too close for a gun with a minimum range: let it go (others deal with it)
      if (tgt && min && Math.hypot(tgt.x - u.x, tgt.z - u.z) - this.foeR(tgt) < min) tgt = undefined;
      if (!d.damage) tgt = undefined; // unarmed (a transport): never chases anything
      u.target = tgt?.id ?? -1;
      u.aim = tgt ? Math.atan2(tgt.x - u.x, tgt.z - u.z) : undefined;
      const gap = tgt ? Math.hypot(tgt.x - u.x, tgt.z - u.z) - this.foeR(tgt) - d.radius : Infinity;
      if (tgt && gap <= range && d.damage > 0) {
        // a fixed gun nearly where it was sent stops there to fight (a crowd at the goal never quite arrives)
        if (moving && d.fixedGun && u.order.kind === 'move' && Math.hypot(u.order.x - u.x, u.order.z - u.z) < FIXED_GUN_HALT) { this.arrive(u); moving = false; }
        let dh = Math.atan2(tgt.x - u.x, tgt.z - u.z) - u.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        if (!moving) {
          const turn = clamp(dh, -8 * DT, 8 * DT);
          u.heading += turn;
          dh -= turn;
        }
        // a gun fixed to the hull fires only along it (turrets turn to their target: drawn only)
        if (u.cd <= 0 && (!d.fixedGun || Math.abs(dh) < FIXED_GUN_ARC)) {
          u.cd = d.cooldown / (abilityOn(u, d, 'overdrive') ? pw : 1);
          const charged = abilityOn(u, d, 'charge');
          const dmg = d.damage * (sieged ? pw : 1) * (charged ? pw : 1) * (isBuilding(tgt) ? d.vsBuildings ?? 1 : 1);
          if (charged) u.abT = 0;
          const dead = tgt.hp <= dmg;
          this.strike(u.x, u.z, tgt, dmg, weaponFx(unitWeapon(d), false), d, team); // (d carries antiAir)
          if (dead) u.target = -1;
        }
      }
      if (sieged) continue; // dug in: turns and shoots, doesn't move
      if (u.order.kind === 'move') {
        const o = u.order;
        if (Math.hypot(o.x - u.x, o.z - u.z) < 1.2 || !this.goTo(u, o.x, o.z, speed)) this.arrive(u);
      } else if (tgt && gap > range) {
        if (!this.goTo(u, tgt.x, tgt.z, speed)) u.target = -1;
      } else if (!tgt && Math.hypot(u.gx - u.x, u.gz - u.z) > 1.5) {
        if (!this.goTo(u, u.gx, u.gz, speed)) this.arrive(u);
      } else if (!tgt && u.patrol) {
        // a faction's patrol: at one end, turn for the other
        const [px, pz] = u.patrol;
        u.patrol = [u.gx, u.gz]; u.gx = px; u.gz = pz;
      }
    }
    for (const u of boarded) us.splice(us.indexOf(u), 1);
    // separation, and out of building bodies (but never pushed somewhere it can't go: a Rover into the sea, a boat ashore)
    const before = us.map((u) => [u.x, u.z]);
    const blds = this.buildingBuckets();
    for (let i = 0; i < us.length; i++) {
      const a = us[i], ra = content.units[a.unit].radius, af = flies(content.units[a.unit]);
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j], rb = content.units[b.unit].radius;
        if (flies(content.units[b.unit]) !== af) continue; // flyers pass over the ground units (and they under them)
        const dx = b.x - a.x, dz = b.z - a.z, dd = Math.hypot(dx, dz), min = ra + rb + 0.3;
        if (dd > 1e-3 && dd < min) {
          const push = (min - dd) / 2;
          a.x -= (dx / dd) * push; a.z -= (dz / dd) * push;
          b.x += (dx / dd) * push; b.z += (dz / dd) * push;
        }
      }
      if (af) { a.x = clamp(a.x, -limit(), limit()); a.z = clamp(a.z, -limit(), limit()); continue; } // over buildings
      this.seen.clear();
      blds.near(a.x, a.z, 0.5, this.found, this.seen);
      this.found.sort((p, q) => p - q);
      for (const k of this.found) {
        const b = this.s.buildings[k];
        if (def(b).role === 'gate') continue;
        const dx = a.x - b.x, dz = a.z - b.z, dd = Math.hypot(dx, dz), min = bodyR(b) + ra;
        if (dd > 1e-3 && dd < min) { a.x = b.x + (dx / dd) * min; a.z = b.z + (dz / dd) * min; }
      }
      a.x = clamp(a.x, -limit(), limit()); a.z = clamp(a.z, -limit(), limit());
    }
    us.forEach((u, i) => {
      const [px, pz] = before[i];
      if (u.x === px && u.z === pz) return;
      const m = moveOf(content.units[u.unit]);
      if (m !== 'hover' && offLimits(m, regionHeightRaw(u.x, u.z)) && !offLimits(m, regionHeightRaw(px, pz))) { u.x = px; u.z = pz; }
    });
  }

  /**
   * A medevac: picks up anyone lying injured it passes; idle, it drives to the nearest of them within
   * its aggro radius while it has room, then takes everyone aboard in to the nearest home (or the Core).
   * Move orders come first (it still picks up whoever it passes).
   */
  private stepMedevac(u: Unit, d: UnitDef) {
    const P = this.people, cap = d.rescues ?? 0, pax = (u.pax ??= []);
    u.target = -1;
    const down = P.injured();
    for (const c of down) {
      if (pax.length >= cap) break;
      if (Math.hypot(c.x - u.x, c.z - u.z) > d.radius + PICKUP) continue;
      P.board(c, u.id);
      pax.push(c.id);
      this.emit(`${d.name}: ${c.name} is aboard${pax.length < cap && down.length > 1 ? '' : ' · taking them in'}`, 'info', 'unitReady');
    }
    for (let i = pax.length - 1; i >= 0; i--) if (!P.colonist(pax[i])) pax.splice(i, 1); // (died meanwhile)
    if (u.order.kind === 'move') {
      const o = u.order;
      if (Math.hypot(o.x - u.x, o.z - u.z) < 1.2 || !this.goTo(u, o.x, o.z, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) this.arrive(u);
    } else {
      let want: { x: number; z: number } | null = null, bd = d.aggro;
      if (pax.length < cap) for (const c of P.injured()) {
        const dist = Math.hypot(c.x - u.x, c.z - u.z);
        if (dist < bd) { bd = dist; want = c; }
      }
      if (want) this.goTo(u, want.x, want.z, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1));
      else if (pax.length) {
        // in to the nearest finished home, Med Bay (preferred: they're fully treated there) or the Core
        let home: Building | null = null, hd = Infinity, best = Infinity;
        for (const b of this.s.buildings) {
          const med = def(b)?.role === 'medbay' && b.powered;
          if (b.progress < 1 || !(b.kind === 'core' || med || (def(b).housing ?? 0) > 0)) continue;
          const dist = Math.hypot(b.x - u.x, b.z - u.z), score = med ? dist * 0.6 : dist;
          if (score < best) { best = score; hd = dist; home = b; }
        }
        if (home && hd <= bodyR(home) + d.radius + 3) {
          const n = P.admit(pax, home);
          u.pax = [];
          if (n) this.emit(`${d.name}: ${n === 1 ? 'one' : n} brought in to the ${def(home).name}`, 'info', 'online');
        } else if (home && !this.goTo(u, home.x, home.z, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) u.repath = this.s.tick;
      } else if (Math.hypot(u.gx - u.x, u.gz - u.z) > 1.5 && !this.goTo(u, u.gx, u.gz, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) this.arrive(u);
    }
    if (u.pax?.length) P.carry(u.pax, u.x, u.z);
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
      const side = u.team ?? 0;
      for (const o of this.units) if (this.allied(side, o.team ?? 0)) consider(o.id, o.x, o.z, o.hp / content.units[o.unit].hp, true);
      for (const b of s.buildings) if (b.progress >= 1 && this.allied(side, b.team ?? 0)) consider(b.id, b.x, b.z, b.hp / maxHp(b), false);
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
      if (Math.hypot(o.x - u.x, o.z - u.z) < 1.2 || !this.goTo(u, o.x, o.z, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) this.arrive(u);
    } else if (p && gap > d.range) {
      if (!this.goTo(u, p.e.x, p.e.z, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) u.fix = -1;
    } else if (!p && Math.hypot(u.gx - u.x, u.gz - u.z) > 1.5) {
      if (!this.goTo(u, u.gx, u.gz, d.speed * (abilityOn(u, d, 'boost') ? d.abilityPower ?? 1 : 1))) this.arrive(u);
    }
  }

  /**
   * Shields: projectors (while powered) and Aegis units recharge; a collapsed one comes back at
   * SHIELD_BACK of its charge. The ones up this tick are listed for stepHostiles.
   */
  private stepShields() {
    const domes = this.domes;
    domes.length = 0;
    for (const b of this.s.buildings) {
      const d = def(b);
      if (!d.shield || !d.shieldRadius) continue;
      if (b.progress < 1) { b.sh = 0; b.shDown = true; continue; }
      if (b.sh === undefined) { b.sh = 0; b.shDown = true; }
      if (b.powered) b.sh = Math.min(d.shield, b.sh + (d.shieldRegen ?? 0) * this.people.mult(b) * (1 + this.mod('shieldRegen')) * DT);
      if (b.shDown && b.sh >= d.shield * SHIELD_BACK) {
        b.shDown = false;
        if (this.s.tick > 1) this.emit(`${d.name} dome up`, 'info', 'online');
      }
      if (b.powered && !b.shDown && b.sh > 0) domes.push({ x: b.x, z: b.z, r: d.shieldRadius, o: b, max: d.shield, name: d.name });
    }
    for (const u of this.units) {
      const d = content.units[u.unit];
      if (!d.shield || !d.shieldRadius) continue;
      u.sh = Math.min(d.shield, (u.sh ?? d.shield) + (d.shieldRegen ?? 0) * (1 + this.mod('shieldRegen')) * DT);
      if (u.shDown && u.sh >= d.shield * SHIELD_BACK) u.shDown = false;
      if (!u.shDown && u.sh > 0) domes.push({ x: u.x, z: u.z, r: d.shieldRadius, o: u, max: d.shield, name: d.name });
    }
  }

  /**
   * A predator's hit on something at (tx, tz): a shield up over the target that the attacker is
   * outside of takes it first (the fullest one, if several). Returns the damage left over for the
   * target, and draws the hit (stopped at the shield's edge, or on the target).
   */
  private soak(h: Hostile, tx: number, tz: number, dmg: number, fxKind: number) {
    let best: Dome | null = null;
    for (const m of this.domes) {
      if ((m.o.sh ?? 0) <= 0 || Math.hypot(tx - m.x, tz - m.z) > m.r || Math.hypot(h.x - m.x, h.z - m.z) <= m.r) continue;
      if (!best || (m.o.sh ?? 0) > (best.o.sh ?? 0)) best = m;
    }
    if (!best) { this.fx.push(fxKind, h.x, h.z, tx, tz); return dmg; }
    // where the blow meets the shield: on its edge, toward the attacker
    const ax = h.x - best.x, az = h.z - best.z, ad = Math.max(1e-3, Math.hypot(ax, az));
    const ix = best.x + (ax / ad) * best.r, iz = best.z + (az / ad) * best.r;
    this.fx.push(fxKind, h.x, h.z, ix, iz, FX.SHIELD, ix, iz, best.x, best.z);
    const took = Math.min(best.o.sh ?? 0, dmg);
    best.o.sh = (best.o.sh ?? 0) - took;
    if (best.o.sh <= 1e-6) {
      best.o.sh = 0;
      best.o.shDown = true;
      this.domes.splice(this.domes.indexOf(best), 1);
      this.emit(`${best.name}: shield down. It comes back at ${Math.round(SHIELD_BACK * 100)}% charge.`, 'warn', 'warning');
    }
    return dmg - took;
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
      const secs = this.nestRegrowSecs();
      if (n) { n.id = -1; n.regrow = s.tick + Math.round(secs * TICK_HZ); }
      s.stats.nestsDestroyed = (s.stats.nestsDestroyed ?? 0) + 1;
      this.planet.nestDestroyed(h.x, h.z);
      this.inhabitants.nestCleared(h.x, h.z);
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

  /** A predator can attack a colony flyer only if it can hit flyers (spitters, flying packs). */
  private canBite(u: UnitDef, o: object) {
    return u.antiAir || flies(u) || !('unit' in o) || !flies(content.units[(o as Unit).unit]);
  }

  private chooseTarget(h: Hostile, u: UnitDef) {
    const s = this.s;
    let best = -1, bd = Infinity;
    const g = h.guard;
    if (g) {
      // a guard: only what comes near its post (and near it), never the base beyond
      const post = (o: { x: number; z: number }, r: number) => Math.hypot(o.x - g.x, o.z - g.z) <= r;
      for (const d of [...s.drones, ...this.units, ...this.people.outdoors()]) {
        if (!this.canBite(u, d) || !this.prey(d)) continue;
        const dist = Math.hypot(d.x - h.x, d.z - h.z);
        if (dist < Math.max(u.aggro, 6) && dist < bd && post(d, g.r * 1.6 + u.aggro)) { bd = dist; best = d.id; }
      }
      if (best >= 0) return best;
      for (const b of s.buildings) {
        if (!this.prey(b)) continue;
        const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b);
        if (dist < bd && post(b, g.r + bodyR(b))) { bd = dist; best = b.id; }
      }
      return best;
    }
    // underground, a burrower can't sense drones or units: it heads for the base (never a wall)
    if (!h.under) {
      for (const d of [...s.drones, ...this.units, ...this.people.outdoors()]) {
        if (!this.canBite(u, d) || !this.prey(d)) continue;
        const dist = Math.hypot(d.x - h.x, d.z - h.z);
        if (dist < u.aggro && dist < bd && this.canReach(h, u, d.x, d.z, 1)) { bd = dist; best = d.id; }
      }
      if (best >= 0) return best;
    }
    // nearest building it can get at (not one across the water, or inland for a sea creature); flyers go over walls
    const over = h.under || flies(u);
    for (const b of s.buildings) {
      if ((over && barrier(b)) || !this.prey(b)) continue;
      const dist = Math.hypot(b.x - h.x, b.z - h.z) - bodyR(b) + (barrier(b) ? WALL_PENALTY : 0) - (def(b).lure ?? 0);
      if (dist < bd && this.canReach(h, u, b.x, b.z, bodyR(b))) { bd = dist; best = b.id; }
    }
    if (best >= 0) return best;
    // nothing it can get at: make for the nearest anyway and wait as close as it can (a sea creature off the coast)
    for (const b of s.buildings) {
      if ((over && barrier(b)) || !this.prey(b)) continue;
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
      if (tgt && 'lineage' in tgt && tgt.at !== -1) { h.target = -1; tgt = undefined; }
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
          const left = this.soak(h, tgt.x, tgt.z, u.damage * (isC ? this.people.harm() : 1), weaponFx(unitWeapon(u), false));
          if (left <= 0) continue;
          tgt.hp -= isB ? left * this.buildingHarm(tgt as Building) : isU ? left * this.armour(tgt as Unit) : left;
          if (isB && s.people) this.people.struck(tgt as Building);
          if (!isC) this.underAttack(tgt as Building | Unit | Drone);
          if (tgt.hp <= 0) isB ? this.destroyBuilding(tgt as Building) : isU ? this.destroyUnit(tgt as Unit) : isC ? this.people.kill(tgt as Colonist, 'killed by predators') : this.destroyDrone(tgt as Drone);
        }
        continue;
      }
      this.chase(h, u, tgt.x, tgt.z, u.speed);
      if (flies(u)) continue; // nothing is in a flyer's way
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
    // separation, and keep out of building bodies: only what's near each one (spatial buckets), in the same order
    // as a check against everything would go (so the result doesn't depend on the buckets)
    const near = this.hostileBuckets;
    near.clear();
    let maxR = 0;
    hs.forEach((h, i) => { if (!h.under) { near.add(i, h.x, h.z); maxR = Math.max(maxR, this.unitDef(h).radius); } });
    const air = hs.map((h) => flies(this.unitDef(h)));
    const blds = this.buildingBuckets(), found = this.found, seen = this.seen;
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i], ra = this.unitDef(a).radius;
      if (a.under) continue; // tunnelling: nothing above ground pushes it about
      const an = this.unitDef(a).speed <= 0, af = air[i];
      near.near(a.x, a.z, ra + maxR + 1, found);
      found.sort((p, q) => p - q);
      for (const j of found) {
        if (j <= i) continue;
        const b = hs[j], rb = this.unitDef(b).radius;
        if (air[j] !== af) continue; // flyers only jostle flyers
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
      // flyers: over buildings and walls alike
      if (af) { a.x = clamp(a.x, -limit(), limit()); a.z = clamp(a.z, -limit(), limit()); continue; }
      seen.clear();
      blds.near(a.x, a.z, 0.5, found, seen);
      found.sort((p, q) => p - q);
      for (const k of found) {
        const b = s.buildings[k];
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
      seen.clear();
      blds.near((px + a.x) / 2, (pz + a.z) / 2, Math.hypot(a.x - px, a.z - pz) / 2 + 1, found, seen);
      found.sort((p, q) => p - q);
      for (const k of found) {
        const b = s.buildings[k];
        if (!barrier(b)) continue;
        const w = wallEnds(b);
        if (crosses(px, pz, a.x, a.z, w.ax, w.az, w.bx, w.bz)) { a.x = px; a.z = pz; break; }
      }
    }
    // packs are announced once seen (radar sees them as they arrive)
    for (const p of s.packs) {
      if (p.announced) continue;
      const near = hs.some((h) => h.pack === p.id && s.buildings.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < THREATS.sightRange));
      if (near) {
        p.announced = true;
        const m = hs.find((h) => h.pack === p.id);
        this.emit(`Contact! Predators at the ${p.from} perimeter`, 'bad', 'warning', m ? { x: m.x, z: m.z } : undefined);
      }
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
      const team = e.faction ? this.s.factions?.find((f) => f.id === e.faction)?.team : undefined;
      this.spawnAt(e.unit, e.count, e.x, e.z, e.mode === 'attack' ? 0 : e.r ?? 14, route, e.id, team);
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
  spawnAt(unit: string, n: number, x: number, z: number, guardR = 0, route?: number[], enc?: string, team?: number) {
    const s = this.s, ud = content.units[unit];
    if (!ud) return 0;
    let made = 0;
    if (ud.faction === 'accord' || team) {
      // a campaign faction's: guards hold the spot, a patrol walks to the route's far end and back, attackers make for the Core
      const core = team && !guardR ? s.buildings.find((b) => b.kind === 'core' && !b.team) ?? { x: 0, z: 0 } : null;
      for (let i = 0; i < n; i++) {
        const slot = this.freeSlot();
        if (slot < 0) break;
        const ux = clamp(x + (i % 4) * 3, -limit(), limit()), uz = clamp(z - Math.floor(i / 4) * 3, -limit(), limit());
        const u: Unit = { id: s.nextId++, team, unit, slot, x: ux, z: uz, heading: 0, hp: ud.hp, cd: 0, order: { kind: 'idle' }, gx: ux, gz: uz, target: -1, enc };
        if (route && route.length >= 4) u.patrol = [route[2] + (u.x - x), route[3] + (u.z - z)];
        if (core) u.order = { kind: 'move', x: core.x + (i % 4) * 3 - 4, z: core.z - 12 - Math.floor(i / 4) * 3 };
        this.units.push(u);
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

  // ---------- the climax (story effects: strike, corrupt, glitch) ----------
  /**
   * An orbital strike lands at (x, z): the fullest shield dome over the point soaks what it can, then everything of ours
   * (and any predator) within `r` takes what is left: all of it in the inner half, down to 30% at the edge.
   */
  orbitalStrike(x: number, z: number, r: number, amount: number) {
    const s = this.s;
    let left = amount, best: Dome | null = null;
    for (const m of this.domes) if ((m.o.sh ?? 0) > 0 && Math.hypot(x - m.x, z - m.z) <= m.r && (!best || (m.o.sh ?? 0) > (best.o.sh ?? 0))) best = m;
    if (best) {
      const took = Math.min(best.o.sh ?? 0, left);
      best.o.sh = (best.o.sh ?? 0) - took;
      left -= took;
      this.fx.push(FX.SHIELD, x, z + best.r * 0.2, best.x, best.z);
      if (best.o.sh <= 1e-6) {
        best.o.sh = 0; best.o.shDown = true;
        this.domes.splice(this.domes.indexOf(best), 1);
        this.emit(`${best.name}: shield down. It comes back at ${Math.round(SHIELD_BACK * 100)}% charge.`, 'warn', 'warning');
      }
    }
    this.fx.push(FX.DIE_BIG, x, z, 0, 0);
    for (let i = 0; i < 5; i++) { const a = i * 1.257, d = r * 0.55; this.fx.push(FX.DIE_BIG, x + Math.cos(a) * d, z + Math.sin(a) * d, 0, 0); }
    if (left <= 0) { this.emit('Orbital strike: the shield held', 'info', 'confirm', { x, z }); return; }
    const share = (ox: number, oz: number, body: number) => {
      const d = Math.max(0, Math.hypot(ox - x, oz - z) - body);
      return d > r ? 0 : d <= r / 2 ? 1 : 1 - (0.7 * (d - r / 2)) / (r / 2);
    };
    for (const b of [...s.buildings]) {
      if (b.team) continue;
      const k = share(b.x, b.z, bodyR(b));
      if (!k) continue;
      b.hp -= left * k * this.buildingHarm(b);
      if (s.people) this.people.struck(b);
      if (b.hp <= 0) this.destroyBuilding(b);
    }
    for (const u of [...this.units]) {
      if (u.team) continue;
      const k = share(u.x, u.z, content.units[u.unit].radius);
      if (k) { u.hp -= left * k * this.armour(u); if (u.hp <= 0) this.destroyUnit(u); }
    }
    for (const d of [...s.drones]) { const k = share(d.x, d.z, 1); if (k && !d.team) { d.hp -= left * k; if (d.hp <= 0) this.destroyDrone(d); } }
    for (const h of [...s.hostiles]) { const k = share(h.x, h.z, this.unitDef(h).radius); if (k && !h.under) { h.hp -= left * k * this.armour(h); if (h.hp <= 0) this.killHostile(h); } }
  }

  /** The Clause turns `n` of our combat units (of `kind`, if given) against us: they join its team and make for the Core. */
  corrupt(n: number, kind?: string) {
    const s = this.s;
    const pool = this.units.filter((u) => !u.team && (!kind || u.unit === kind) && content.units[u.unit].damage > 0 && u.ride === undefined);
    if (!pool.length || s.players) return 0;
    if (!s.factions?.some((f) => f.team === 1)) (s.factions ??= []).push({ id: 'clause', name: 'The Clause', color: CLAUSE_COLOR, team: 1, attitude: 'hostile' });
    this.foeCache.clear();
    const core = s.buildings.find((b) => b.kind === 'core' && !b.team) ?? { x: 0, z: 0 };
    let made = 0;
    for (; made < n && pool.length; made++) {
      const u = pool.splice(Math.floor(this.rnd() * pool.length), 1)[0];
      u.team = 1; u.target = -1; u.abT = 0;
      u.order = { kind: 'move', x: core.x + Math.sin(made * 2.4) * 10, z: core.z + Math.cos(made * 2.4) * 10 };
      this.emit(`${content.units[u.unit].name} no longer answers.`, 'bad', 'alarm', { x: u.x, z: u.z }, 'clause');
    }
    for (const o of this.units) if (!o.team) o.target = -1;
    return made;
  }

  /** The Clause turns one of our turrets to face a colony building for two seconds (a glitch). False if we have none. */
  slewTurret() {
    const s = this.s, ours = s.buildings.filter((b) => !b.team && b.progress >= 1);
    const guns = ours.filter((b) => def(b).role === 'turret');
    if (!guns.length) return false;
    const b = guns[Math.floor(this.rnd() * guns.length)];
    const homes = ours.filter((x) => def(x).role === 'civic');
    const at = (homes.length ? homes : ours.filter((x) => x.kind === 'core')).sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
    if (!at) return false;
    b.slew = { until: s.tick + 2 * TICK_HZ, aim: Math.atan2(at.x - b.x, at.z - b.z), was: b.aim };
    return true;
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
    this.emit(text || (how === 'won' ? 'The colony has won through.' : 'The colony is lost.'), how === 'won' ? 'info' : 'bad', how === 'won' ? 'victory' : 'defeat');
  }

  private destroyBuilding(b: Building) {
    const s = this.s;
    // (inside the colony's own view a faction's building is only in the whole list)
    const list = b.team && this.all && !s.buildings.includes(b) ? this.all.buildings : s.buildings;
    const i = list.indexOf(b);
    if (i < 0) return;
    list.splice(i, 1);
    b.hp = Math.min(b.hp, 0);
    const t = b.team ?? 0;
    if (t && !s.players) {
      // a campaign faction's outpost: theirs, not ours (its story flag, if it has one)
      this.fx.push(FX.DIE_BIG, b.x, b.z, 0, 0);
      for (const u of this.units) if (u.fix === b.id) u.fix = -1;
      const f = s.factions?.find((x) => x.team === t);
      this.emit(`${f ? `${f.name}'s` : 'Their'} ${def(b).name} destroyed`, 'info', undefined, { x: b.x, z: b.z });
      if (b.flag && !this.story.has(b.flag)) this.story.s.flags.push(b.flag);
      return;
    }
    this.statsOf(t).buildingsLost++;
    this.fx.push(FX.DIE_BIG, b.x, b.z, 0, 0);
    for (const u of this.units) if (u.fix === b.id) u.fix = -1;
    if (s.players) {
      if (t === 0) this.emit(`${def(b).name} destroyed`, 'bad', def(b).role === 'wall' ? 'lost' : 'alarm', { x: b.x, z: b.z });
      else if (!this.allied(0, t) && b.kind !== 'core' && def(b).role !== 'wall') this.emit(`${s.players[t].name}'s ${def(b).name} destroyed`, 'info', undefined, { x: b.x, z: b.z });
      if (b.kind === 'core') this.falling.push(t);
      return;
    }
    this.emit(`${def(b).name} destroyed`, 'bad', def(b).role === 'wall' ? 'lost' : 'alarm', { x: b.x, z: b.z });
    if (def(b).role !== 'wall' && s.people) this.people.say('lost', undefined, { building: def(b).name });
    this.planet.buildingLost(b.x, b.z, barrier(b));
    this.people.buildingLost(b);
    // the Core falls: a mission under way here that fails on it (coreLost) fails instead, and the story answers
    if (b.kind === 'core' && !this.missions.coreLost()) this.lose('core');
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
    if (p.peaceful) { s.waves.next = Number.MAX_SAFE_INTEGER; this.frontier.hold(); done.push('no predators'); }
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
    d.hp = Math.min(d.hp, 0);
    this.statsOf(d.team ?? 0).dronesLost++;
    this.fx.push(FX.DIE_SMALL, d.x, d.z, 0, 0);
    if (!d.team) this.emit('Worker drone destroyed', 'bad', 'lost');
  }

  private destroyUnit(u: Unit) {
    const i = this.units.indexOf(u);
    if (i < 0) return;
    this.units.splice(i, 1);
    u.hp = Math.min(u.hp, 0);
    const aboard = u.cargo?.length ?? 0, st = this.statsOf(u.team ?? 0);
    if (!u.team || this.s.players) st.unitsLost = (st.unitsLost ?? 0) + 1 + aboard; // (a campaign faction's aren't ours)
    // the last of a faction's map encounter: its "beaten" flag
    if (u.enc && !this.units.some((x) => x.enc === u.enc)) {
      const e = REGION.encounters?.find((x) => x.id === u.enc);
      if (e?.doneFlag && !this.story.has(e.doneFlag)) this.story.s.flags.push(e.doneFlag);
    }
    this.fx.push(dieFx(content.units[u.unit].radius), u.x, u.z, 0, 0);
    if (!u.team) this.emit(`${content.units[u.unit].name} destroyed${aboard ? ` with ${aboard} aboard` : ''}`, 'bad', 'lost');
    if (u.pax?.length) this.people.spill(u.pax, u.x, u.z);
    for (const o of this.units) if (o.ride === u.id) { o.ride = undefined; this.arrive(o); }
  }

  lose(why: 'core' | 'cryo' | 'people') {
    if (this.s.over) return;
    this.s.over = why;
    this.emit(why === 'core' ? 'The Command Core has fallen. The colony is lost.' : why === 'cryo' ? 'The last embryos are gone. The colony is lost.' : 'No one is left. The colony is lost.', 'bad', 'defeat');
  }

  // ---------- waves ----------
  private radarPowered() {
    return this.s.buildings.some((b) => b.powered && !b.team && def(b).role === 'radar');
  }

  private stepWaves() {
    const s = this.s, w = s.waves;
    // seismic listening (research): a powered radar hears the next pack gather before it sets out
    const early = this.mod('warning');
    if (early > 0 && w.warned !== w.n && s.tick < w.next && w.next - s.tick <= early * TICK_HZ && this.radarPowered()) {
      w.warned = w.n;
      this.emit(`Seismic listening: a pack is gathering. It sets out in about ${Math.round((w.next - s.tick) / TICK_HZ)} s.`, 'warn', 'warning');
    }
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
    const used = new Set([...this.s.hostiles, ...(this.all?.units ?? this.units)].map((h) => h.slot));
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
      s.herds[h] = { ...this.herdSpot(h), sp: s.herds[h].sp };
    }
    const scary = [...s.drones, ...this.units, ...s.hostiles.filter((h) => !h.under)];
    // what's near each creature, in list order (as a check against everything would go)
    const sb = this.scaryBuckets, found = this.found;
    sb.clear();
    scary.forEach((o, i) => sb.add(i, o.x, o.z));
    const blds = this.buildingBuckets(), seen = this.seen;
    for (const f of s.fauna) {
      const w = wildMove(f.sp);
      const beh = w.behavior;
      const c = s.herds[f.herd] ?? { x: f.x, z: f.z };
      if (f.wait) f.wait--;
      // the nearest threat: the landing's engine noise, or something within the species' wariness
      let thx = 0, thz = 0, threat = false;
      const rc0 = Math.hypot(f.x, f.z);
      if (panic && rc0 < PANIC_R && rc0 > 1e-3) { thx = f.x / rc0; thz = f.z / rc0; threat = true; }
      else if (this.deployed && w.flee > 0) {
        sb.near(f.x, f.z, w.flee, found);
        found.sort((p, q) => p - q);
        for (const k of found) {
          const o = scary[k];
          const dx = f.x - o.x, dz = f.z - o.z, dd = Math.hypot(dx, dz);
          if (dd < w.flee && dd > 1e-3) { thx = dx / dd; thz = dz / dd; threat = true; break; }
        }
      }
      let tx = f.tx, tz = f.tz, sp = w.speed, turn = 2.5;
      const hidden = f.st === 2;
      f.st = 0;
      const newTarget = (r: number) => {
        f.tx = clamp(c.x + (this.rnd() - 0.5) * 2 * r, -limit(), limit());
        f.tz = clamp(c.z + (this.rnd() - 0.5) * 2 * r, -limit(), limit());
        tx = f.tx; tz = f.tz;
      };
      if (beh === 'flyer') {
        // circle the herd's ground; wider and faster when disturbed. Flyers pass over buildings.
        const rad = w.spread * (threat ? 1.6 : 0.6) + (f.herd % 3) * 3;
        sp = threat ? w.run : w.speed;
        f.ang = ((f.ang ?? 0) + (sp / Math.max(4, rad)) * DT) % (Math.PI * 2);
        tx = clamp(c.x + Math.cos(f.ang) * rad, -limit(), limit());
        tz = clamp(c.z + Math.sin(f.ang) * rad, -limit(), limit());
        if (threat) f.st = 1;
        this.approach(f, tx, tz, sp, 1.6);
        continue;
      }
      if (beh === 'burrow') {
        // duck underground and wait it out
        if (threat) { f.st = 2; f.wait = Math.round((3 + this.rnd() * 4) * TICK_HZ); continue; }
        if (hidden && f.wait) { f.st = 2; continue; }
      }
      if (threat && beh === 'lumber' && !panic) {
        // stand and stare
        const want = Math.atan2(-thx, -thz);
        let dh = want - f.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        f.heading += clamp(dh, -1.2 * DT, 1.2 * DT);
        continue;
      }
      let fled = false;
      if (threat) {
        tx = f.x + thx * 20; tz = f.z + thz * 20; sp = w.run; fled = true; f.st = 1; f.wait = 0;
        turn = 9;
      } else if (beh === 'skittish') {
        // dash, pause, dash
        if (f.wait) continue;
        if (Math.hypot(f.tx - f.x, f.tz - f.z) < 1) {
          f.wait = Math.round((0.8 + this.rnd() * 3) * TICK_HZ);
          const a = this.rnd() * Math.PI * 2, r = 3 + this.rnd() * 8;
          let nx = f.x + Math.cos(a) * r, nz = f.z + Math.sin(a) * r;
          // drift back toward the herd's centre when strayed
          if (Math.hypot(nx - c.x, nz - c.z) > w.spread) { nx = (nx + c.x) / 2; nz = (nz + c.z) / 2; }
          f.tx = clamp(nx, -limit(), limit()); f.tz = clamp(nz, -limit(), limit());
          continue;
        }
        sp = w.run * 0.6; turn = 12;
      }
      if (!fled && beh !== 'skittish' && (Math.hypot(f.tx - f.x, f.tz - f.z) < 1.5 || this.rnd() < 0.003)) newTarget(w.spread);
      // keep out of the base
      seen.clear();
      blds.near(f.x, f.z, CORE_KEEP_OUT, found, seen);
      found.sort((p, q) => p - q);
      for (const k of found) {
        const b = s.buildings[k];
        const r = b.kind === 'core' ? CORE_KEEP_OUT : bodyR(b) + 4;
        const dx = f.x - b.x, dz = f.z - b.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-3) { tx = b.x + (dx / d) * (r + 8); tz = b.z + (dz / d) * (r + 8); }
      }
      if (Math.hypot(tx - f.x, tz - f.z) > 0.4) this.approach(f, tx, tz, sp, sp > w.speed * 1.5 ? Math.max(turn, 9) : turn);
      f.x = clamp(f.x, -limit(), limit());
      f.z = clamp(f.z, -limit(), limit());
    }
  }

  // ---------- commands ----------
  /** A player's command (skirmish: `team` says whose; it acts only on that player's things and alloys). */
  command(c: Command, team = 0) {
    if (this.s.players && !this.s.players[team]?.out) return this.withTeam(team, () => this.run(c));
    if (!this.s.players) this.withTeam(0, () => this.run(c)); // (campaign factions: only our own things take orders)
  }

  private run(c: Command) {
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
        this.emit(`${dd.name} ${b.progress < 1 ? 'cancelled' : 'recycled'} · +${Math.floor(refund)} alloys`, 'info', 'recycle');
        return;
      }
      case 'standing': this.frontier.command(c.sector, c.order); return;
      case 'neighbour': this.inhabitants.ask(c.camp, c.act, c.n ?? 0); return;
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
      case 'travelled':
        delete s.travel;
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
        if (c.route) this.story.effect({ kind: 'route', region: c.route });
        if (c.unroute) this.story.effect({ kind: 'unroute', region: c.unroute });
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
        if (this.armySize() + queued >= this.unitCap()) { this.emit(`Combat unit limit reached (${this.unitCap()})`, 'warn', 'deny'); return; }
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
        for (const u of sel) { u.ride = undefined; u.drop = undefined; if (content.units[u.unit].ability === 'siege') u.abT = 0; }
        // a loaded transport sent to a spot on land goes to land its cargo there
        if (!offLimits('ground', regionHeightRaw(x, z))) sel = sel.filter((u) => !(u.cargo?.length && this.sendToLand(u, x, z)));
        // spread out around the point (sunflower), nearest units take the inner spots
        sel.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        // spots that land in a building (or the water, for a Rover) move to open ground beside it, a spot apart
        this.setUnitBodies(sel);
        // spots already held near the point (units standing there, or on their way to it) stay theirs: reinforcements
        // sent after the first group take the next free spots instead of all piling onto the middle
        const held: number[] = [];
        const near = SPREAD * Math.sqrt(sel.length + 40) + 6;
        for (const o of this.units) {
          if (sel.includes(o) || (o.team ?? 0) !== this.team) continue;
          const px = o.order.kind === 'move' ? o.order.x : o.order.kind === 'idle' ? o.x : NaN, pz = o.order.kind === 'move' ? o.order.z : o.z;
          if (Number.isFinite(px) && Math.hypot(px - x, pz - z) < near) held.push(px, pz);
        }
        const isHeld = (px: number, pz: number) => { for (let k = 0; k < held.length; k += 2) if (Math.hypot(held[k] - px, held[k + 1] - pz) < SPREAD * 0.8) return true; return false; };
        const taken: number[] = [];
        let slot = 0;
        sel.forEach((u) => {
          let i = slot;
          while (i < slot + 400 && isHeld(x + Math.cos(i * 2.39996) * SPREAD * Math.sqrt(i), z + Math.sin(i * 2.39996) * SPREAD * Math.sqrt(i))) i++;
          slot = i + 1;
          const r = SPREAD * Math.sqrt(i) * (i ? 1 : 0), a = i * 2.39996;
          let ox = clamp(x + Math.cos(a) * r, -limit(), limit()), oz = clamp(z + Math.sin(a) * r, -limit(), limit());
          const m = moveOf(content.units[u.unit]);
          if (m !== 'air' && this.unitGrid(m).isBlocked(ox, oz)) {
            const g = this.unitGrid(m), free = (px: number, pz: number) => !g.isBlocked(px, pz) && !taken.some((_, k) => k % 2 === 0 && Math.hypot(taken[k] - px, taken[k + 1] - pz) < SPREAD * 0.8);
            search: for (let rr = 2; rr < 40; rr += 2) {
              const steps = Math.ceil((rr * 6.3) / 2);
              for (let q = 0; q < steps; q++) {
                const t = a + (q / steps) * Math.PI * 2, px = ox + Math.cos(t) * rr, pz = oz + Math.sin(t) * rr;
                if (Math.abs(px) < limit() && Math.abs(pz) < limit() && free(px, pz)) { ox = px; oz = pz; break search; }
              }
            }
          }
          taken.push(ox, oz);
          u.order = { kind: 'move', x: ox, z: oz };
          u.target = -1;
        });
        return;
      }
      case 'attack': {
        // one target: a campaign faction's unit or building (a neutral one turns hostile), or a predator
        const all = this.all ?? { buildings: s.buildings, units: this.units };
        const tgt: Foe | undefined = all.units.find((u) => u.id === c.target) ?? all.buildings.find((b) => b.id === c.target) ?? s.hostiles.find((h) => h.id === c.target);
        if (!tgt) return;
        const t = (tgt as { team?: number }).team ?? 0;
        if (t && !s.players) {
          const f = s.factions?.find((x) => x.team === t);
          if (this.attitude(t) === 'allied') { this.emit(`${f?.name ?? 'They'} are on our side`, 'warn', 'deny'); return; }
          if (f && f.attitude === 'neutral') {
            this.setAttitude(f.id, 'hostile');
            if (!this.story.has(`${f.id}-attacked`)) this.story.s.flags.push(`${f.id}-attacked`);
          }
        }
        this.run({ type: 'order', ids: c.ids, x: tgt.x, z: tgt.z });
        for (const u of this.units) if (c.ids.includes(u.id)) u.target = tgt.id;
        return;
      }
      case 'surrender': {
        if (s.players && !s.players[this.team]?.out && !this.falling.includes(this.team)) this.falling.push(this.team);
        return;
      }
      case 'ability': {
        let n = 0, any = false;
        for (const u of this.units) {
          if (!c.ids.includes(u.id) || !content.units[u.unit]?.ability) continue;
          any = true;
          if (this.useAbility(u)) n++;
        }
        if (any && !n) this.emit('Not ready yet', 'warn', 'deny');
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
        const why = researchBlocked(r, content.research, DEFS, this.researchWorld());
        if (why) { this.emit(`${r.name} needs ${why}`, 'warn', 'deny'); return; }
        if (s.alloys < r.cost) { this.emit(`Not enough alloys for ${r.name} (${r.cost} needed)`, 'warn', 'deny'); return; }
        if ((s.isotopes ?? 0) < (r.isotopes ?? 0)) { this.emit(`Not enough isotopes for ${r.name} (${r.isotopes} needed)`, 'warn', 'deny'); return; }
        s.alloys -= r.cost;
        s.isotopes = (s.isotopes ?? 0) - (r.isotopes ?? 0);
        R.active = { id: c.id, progress: 0 };
        this.emit(`Research started: ${r.name}`, 'info', 'confirm');
        return;
      }
      case 'unresearch': {
        const R = s.research, a = R?.active, r = a && content.research[a.id];
        if (!R || !a) return;
        if (r) { s.alloys += r.cost; s.isotopes = (s.isotopes ?? 0) + (r.isotopes ?? 0); }
        R.active = null;
        this.emit(`Research cancelled${r ? `: ${r.name} (refunded)` : ''}`, 'info', 'recycle');
        return;
      }
      case 'fab': {
        if (s.drones.length + s.fab.queued >= this.maxDrones()) { this.emit(`Drone limit reached (${this.maxDrones()})`, 'warn', 'deny'); return; }
        if (s.alloys < RULES.droneCost) { this.emit(`Not enough alloys for a drone (${RULES.droneCost} needed)`, 'warn', 'deny'); return; }
        s.alloys -= RULES.droneCost;
        s.fab.queued++;
        this.emit('Drone fabrication started', 'info', 'confirm');
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
      this.emit(`Touchdown. Cryo bank on reserve power: ${deficit.toFixed(1)} MW short.`, 'warn', 'message');
    } else if (stage === 'deploy') {
      if (s.phase === 'descent' && !s.expedition) this.landing('touchdown');
      s.phase = 'deployed';
      if (s.expedition) this.emit(`Expedition down in ${REGION.name}. The Command Core is up.`, 'info', 'message');
      else this.emit('Worker drone deployed. Build a Solar Array to stabilize the cryo bank.', 'info', 'message');
    }
  }

  // ---------- snapshot ----------
  snapshot(): Snapshot {
    const s = this.s;
    const fa = new Float32Array(s.fauna.length * 4);
    s.fauna.forEach((f, i) => { fa[i * 4] = f.x; fa[i * 4 + 1] = f.z; fa[i * 4 + 2] = f.heading; fa[i * 4 + 3] = wildMove(f.sp).idx * 4 + (f.st ?? 0); });
    const slots = this.slotsUsed;
    const army = new Float32Array(Math.max(1, slots) * STRIDE);
    const radar = this.radarPowered();
    const blips = new Float32Array(radar ? s.hostiles.length * 2 : 0);
    s.hostiles.forEach((h, i) => { if (radar) { blips[i * 2] = h.x; blips[i * 2 + 1] = h.z; } });
    for (const h of s.hostiles) {
      if (h.under || !this.visible(h.x, h.z)) continue; // underground or in the fog: not drawn (radar shows it as a blip)
      const o = h.slot * STRIDE;
      army[o + F.X] = h.x; army[o + F.Z] = h.z; army[o + F.HEADING] = army[o + F.AIM] = h.heading;
      army[o + F.TYPE] = unitType(h.unit);
      army[o + F.HP] = h.hp / this.unitDef(h).hp;
      army[o + F.GEN] = h.id & 0xffff; army[o + F.ALIVE] = 1;
    }
    // skirmish: what the local player can know of the others: their units and drones in sight, their buildings once seen
    const P = s.players, multi = !!P || this.teamsOn; // (campaign factions: theirs in sight, their buildings once seen)
    const known = <X extends { team?: number; x: number; z: number }>(o: X) => !multi || this.allied(0, o.team ?? 0) || this.visible(o.x, o.z);
    if (multi) for (const b of s.buildings) if (!b.seen && known(b)) b.seen = true;
    const units: UnitSnap[] = this.units.filter(known).map((u) => {
      const o = u.slot * STRIDE, d = content.units[u.unit];
      army[o + F.X] = u.x; army[o + F.Z] = u.z; army[o + F.HEADING] = u.heading; army[o + F.AIM] = u.aim ?? u.heading;
      army[o + F.TYPE] = unitType(u.unit);
      army[o + F.HP] = u.hp / d.hp;
      army[o + F.GEN] = u.id & 0xffff; army[o + F.ALIVE] = 1; army[o + F.TEAM] = u.team ?? 0;
      const mv = u.order.kind === 'move' ? u.order : null;
      return {
        id: u.id, team: u.team, unit: u.unit, slot: u.slot, x: u.x, z: u.z, hp: u.hp / d.hp, order: u.order.kind, tx: mv ? mv.x : u.gx, tz: mv ? mv.z : u.gz, engaged: u.target >= 0,
        cargo: d.carries ? u.cargo?.length ?? 0 : undefined, boarding: u.ride !== undefined || undefined, pax: d.rescues ? u.pax?.length ?? 0 : undefined,
        ...(d.shield && d.shieldRadius ? { sh: (u.sh ?? d.shield) / d.shield, shR: d.shieldRadius, shUp: !u.shDown && (u.sh ?? d.shield) > 0 } : {}),
        ...(d.ability ? { abCd: u.ab ?? 0, abOn: u.abT || undefined } : {}),
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
    const drones: DroneSnap[] = s.drones.filter(known).map((d) => {
      const t = d.task;
      let tx = d.x, tz = d.z;
      if (t.kind === 'move') { tx = t.x; tz = t.z; }
      else if (t.kind === 'build' || t.kind === 'repair') {
        const b = s.buildings.find((x) => x.id === (t.kind === 'build' ? t.siteId : t.id));
        if (b) { tx = b.x; tz = b.z; }
      }
      const working = (t.kind === 'build' || t.kind === 'repair') && Math.hypot(tx - d.x, tz - d.z) < 14;
      return { id: d.id, team: d.team, x: d.x, z: d.z, heading: d.heading, tx, tz, moving: t.kind !== 'idle', working, hp: d.hp / RULES.droneHp, task: t.kind, manual: !!d.manual };
    });
    const packs = s.packs.map((p) => {
      let x = 0, z = 0, n = 0;
      for (const h of s.hostiles) if (h.pack === p.id) { x += h.x; z += h.z; n++; }
      return { x: n ? x / n : 0, z: n ? z / n : 0, alive: n, seen: radar || p.announced };
    });
    const inh = this.inhabitants.snapshot();
    return {
      type: 'snap', tick: s.tick, secs: this.secs, deployed: this.deployed,
      unitCap: this.unitCap(), droneCap: P ? undefined : this.maxDrones(), mods: P ? undefined : this.modsNow(),
      players: P?.map((p, i) => ({ name: p.name, color: p.color, side: p.side, ai: p.ai, out: !!p.out, home: p.home, stats: { ...this.statsOf(i) } })),
      drones, fauna: fa, buildings: (multi ? s.buildings.filter((b) => this.allied(0, b.team ?? 0) || b.seen) : s.buildings).map((b) => ({ ...b, queue: b.queue ? [...b.queue] : undefined })), deposits: s.deposits.map((d) => ({ ...d })),
      wrecks: (s.wrecks ?? []).map((w) => ({ ...w })),
      seams: (s.seams ?? []).map((v) => ({ ...v })), isotopes: s.isotopes ?? 0,
      caches: (s.relics?.caches ?? []).map((c) => ({ ...c })),
      research: { done: [...(s.research?.done ?? [])], active: s.research?.active ? { ...s.research.active } : null },
      nests: (s.nests ?? []).map((n) => ({ x: this.spawns()[n.spawn]?.x ?? 0, z: this.spawns()[n.spawn]?.z ?? 0, alive: n.id >= 0 })),
      army, armySlots: slots, fx, fog, blips, hostiles: s.hostiles.length, units, camps: inh.camps, natives: inh.natives, story: this.story.snapshot(), missions: this.missions.snapshot(),
      campaign: s.campaign ? { here: REGION_ID, home: HOME_REGION, visited: [...s.campaign.visited], routes: [...s.campaign.routes], travel: s.travel, expedition: !!s.expedition } : undefined,
      alloys: s.alloys, cryo: s.cryo, gen: this.power.gen, draw: this.power.draw, short: this.power.short,
      stored: s.stored, storageMax: this.power.storageMax, daylight: this.power.daylight,
      radar, nextPack: radar ? Math.max(0, (s.waves.next - s.tick) / TICK_HZ) : null, packs,
      fab: { queued: s.fab.queued, progress: s.fab.progress }, frontier: P ? undefined : this.frontier.snapshot(), people: this.people.snapshot(), planet: this.planet.snapshot(), over: s.over, overText: s.overText, stats: { ...s.stats },
      factions: s.factions?.length ? s.factions.map((f) => ({ ...f })) : undefined,
    };
  }
}
