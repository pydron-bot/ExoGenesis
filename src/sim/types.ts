/**
 * Simulation data contract. Everything in SimState is plain data so it can be
 * structured-cloned to/from the worker and written straight into IndexedDB.
 */

import type { PeopleCommand, PeopleSnap, PeopleState } from './people-types';

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
/** Half-width of the landing region, in world units (~1 unit = 10 m). */
export const REGION_HALF = 120;
/** Fog of war grid: FOG_N² cells of FOG_CELL units, row-major by z then x. */
export const FOG_CELL = 4;
export const FOG_N = Math.ceil((REGION_HALF * 2) / FOG_CELL);
/** Hostile render slots (shared buffer layout with the skirmish renderer). */
export const MAX_HOSTILES = 400;

// Balance numbers (costs, power, build times, sol length...) live in /content;
// see src/content/defs.ts.

/** A building; `kind` is its content id (content/buildings/<kind>.json). */
export interface Building {
  id: number;
  /** Wardens' cooldown (Autonomist-led colonies: the people inside fight back). */
  mcd?: number;
  kind: string;
  x: number;
  z: number;
  /** Facing (radians, region heading: 0 = +z). Walls run along it; a bay's door faces the opposite way. */
  yaw?: number;
  /** 0..1 construction progress; 1 = online. */
  progress: number;
  hp: number;
  /** Player's power switch. */
  on: boolean;
  /** Got power this tick (computed). */
  powered: boolean;
  /** Turret: seconds until it can fire; aim yaw. */
  cd?: number;
  aim?: number;
  /** Shooter has a target in range (draws full power; otherwise standby). */
  engaged?: boolean;
  /** Depot: deposit index being mined (-1 none). */
  mining?: number;
  /** Factory: unit ids (content/units) waiting to be produced; the first is in progress. */
  queue?: string[];
  /** Factory: 0..1 progress on queue[0]. */
  prod?: number;
}

export type DroneTask =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'build'; siteId: number }
  | { kind: 'repair'; id: number };

export interface Drone {
  id: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  task: DroneTask;
  /** Player gave this order: don't auto-assign until it's done. */
  manual?: boolean;
}

export interface Creature {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  herd: number;
}

export interface Hostile {
  id: number;
  /** Unit content id (swarmer, brute...). */
  unit: string;
  /** Render slot. */
  slot: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  /** Entity id it's after (building or drone), -1 none. */
  target: number;
  cd: number;
  pack: number;
  /** Stuck against something (a wall) and chewing through it: keep this target till it's gone. */
  chew?: boolean;
  /** Burrower travelling underground: unseen (radar still shows it), untargetable, passes under walls. */
  under?: boolean;
  best?: number;
  stall?: number;
}

/**
 * A player combat unit (Rover, Tank...). Orders: `move` walks there ignoring
 * enemies except to shoot what's in range on the way; `idle` guards `gx/gz`,
 * chasing hostiles within aggro of it, then walks back.
 */
export interface Unit {
  id: number;
  /** Unit content id (rover, tank). */
  unit: string;
  /** Render slot (shared pool with hostiles). */
  slot: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  cd: number;
  order: { kind: 'idle' } | { kind: 'move'; x: number; z: number };
  /** Guard post: where it returns to after a chase. */
  gx: number;
  gz: number;
  /** Hostile id it's shooting at (-1 none). */
  target: number;
  /** Repairers: id of the unit or building being repaired (-1 none). */
  fix?: number;
  /** Waypoints being followed (flat x, z pairs) toward `goal`; re-planned every few seconds. */
  path?: number[];
  goal?: [number, number];
  repath?: number;
  /** Stuck detection: closest it has got to the goal, and ticks since it last improved. */
  best?: number;
  stall?: number;
}

/** One of the inhabitants at a camp (walker, or the elder who keeps to the centre). */
export interface Native {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  /** Seconds to stand before picking a new spot. */
  wait: number;
  elder?: boolean;
}

export type ContactChoice = 'approach' | 'avoid' | 'drive';

/** An inhabitant camp (region map `camps`, group = content/inhabitants/<id>.json). */
export interface Camp {
  group: string;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
  /** 0..100: what they think of the colony. They leave at 0. */
  regard: number;
  /** First contact happened (the camp came into sight). */
  met: boolean;
  /** First contact is waiting for the player's choice. */
  pending: boolean;
  choice?: ContactChoice;
  /** Regard reached the group's trustAt: they warn of packs and share sight of their land. */
  trusted: boolean;
  /** The trust story has played (it plays once). */
  sang?: boolean;
  /** The "uneasy" warning was given (cleared once regard recovers). */
  uneasy?: boolean;
  /** They left (driven off, or regard hit 0). The camp stands empty. */
  gone: boolean;
  natives: Native[];
}

export interface Deposit { x: number; z: number; alloys: number; max: number }

export interface Pack { id: number; size: number; announced: boolean; alive: number; from: string }

export interface SimState {
  /** Region id (content/regions/<id>.json); older saves are Touchdown. */
  region?: string;
  version: 2;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  alloys: number;
  /** Cryo bank integrity, 0..100. */
  cryo: number;
  cryoWarn: number;
  /** Battery charge, MJ. */
  stored: number;
  drones: Drone[];
  buildings: Building[];
  herds: { x: number; z: number }[];
  fauna: Creature[];
  deposits: Deposit[];
  hostiles: Hostile[];
  /** Player combat units (absent in saves from before units existed). */
  units?: Unit[];
  /** Fog of war: cells ever seen, one '0'/'1' per cell (absent in older saves). */
  explored?: string;
  packs: Pack[];
  /** Next pack index and the tick it arrives; attackers spawned so far. */
  waves: { n: number; next: number; spawned: number };
  /** Drone fabrication at the Core. */
  fab: { queued: number; progress: number; free?: boolean };
  /** Landing sequence: 'descent' until touchdown, 'landed' until the drone is out, then 'deployed'. */
  phase: 'descent' | 'landed' | 'deployed';
  /** Ticks of engine-noise panic left: grazers near the core bolt. */
  panic: number;
  /** Inhabitant camps (absent in saves from before inhabitants existed: set up from the region on load). */
  camps?: Camp[];
  /** Colonists, embryos, pods, food, Trust (absent in saves from before people existed). */
  people?: PeopleState;
  /** Set when the game is lost. */
  over: null | 'core' | 'cryo' | 'people';
  stats: { kills: number; buildingsLost: number; dronesLost: number; packsBeaten: number; mined: number; unitsLost?: number };
}

export type LandingStage = 'burn' | 'touchdown' | 'deploy';

export type Command =
  | { type: 'move'; drone: number; x: number; z: number }
  | { type: 'build'; kind: string; x: number; z: number; yaw?: number }
  /** A line of segments (walls) from (x1, z1) to (x2, z2). */
  | { type: 'buildLine'; kind: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'repair'; id: number }
  | { type: 'power'; id: number; on: boolean }
  | { type: 'demolish'; id: number }
  | { type: 'fab' }
  /** Factory: queue a unit, or drop the last queued one. */
  | { type: 'produce'; id: number; unit: string }
  | { type: 'unqueue'; id: number }
  /** Combat units: move (spread out around the point), or stop and guard where they stand. */
  | { type: 'order'; ids: number[]; x: number; z: number }
  | { type: 'stop'; ids: number[] }
  | { type: 'landing'; stage: LandingStage }
  /** First contact with an inhabitant camp: the player's answer. */
  | { type: 'contact'; camp: number; choice: ContactChoice }
  | PeopleCommand
  /** Playtesting / tests: spawn the next pack now, add alloys, damage a building, or drop in hostiles or combat units. */
  | { type: 'debug'; regard?: { camp: number; value: number }; wave?: boolean; alloys?: number; hurt?: { id: number; hp: number }; spawn?: { unit: string; x: number; z: number; n?: number }; units?: { unit: string; x: number; z: number; n?: number }; people?: { colonists?: number; biomass?: number; stance?: number; wb?: number } };

export type ToWorker =
  /** First message: the region to play (`def` = an unsaved editor draft for a play test). */
  | { type: 'init'; region: string; def?: import('../content/defs').RegionDef }
  | { type: 'cmd'; cmd: Command }
  | { type: 'speed'; speed: number }
  | { type: 'save'; reqId: number }
  | { type: 'load'; state: SimState }
  | { type: 'new'; seed: number }
  /** Autosave to IndexedDB every few seconds while on; `flush` saves right now. */
  | { type: 'autosave'; on: boolean }
  | { type: 'flush' };

export interface DroneSnap {
  id: number; x: number; z: number; heading: number; tx: number; tz: number;
  moving: boolean; working: boolean; hp: number; task: DroneTask['kind']; manual: boolean;
}

export interface UnitSnap {
  id: number; unit: string; slot: number; x: number; z: number; hp: number;
  order: Unit['order']['kind']; tx: number; tz: number; engaged: boolean;
}

export interface CampSnap {
  group: string; x: number; z: number; yaw: number; regard: number;
  met: boolean; pending: boolean; choice: ContactChoice | null; trusted: boolean; gone: boolean;
  /** Colony buildings standing on their land. */
  encroaching: number;
}

export interface Snapshot {
  type: 'snap';
  tick: number;
  /** Game seconds since landing. */
  secs: number;
  /** False until the landing sequence has put the drone on the ground. */
  deployed: boolean;
  drones: DroneSnap[];
  /** x, z, heading per grazer. */
  fauna: Float32Array;
  buildings: Building[];
  deposits: Deposit[];
  /** Hostiles in the skirmish renderer's layout (see skirmish/types STRIDE / F). Only ones in sight. */
  army: Float32Array;
  /** Fog of war, FOG_N² cells: 0 never seen, 1 seen before, 2 in sight now. */
  fog: Uint8Array;
  /** Radar blips: x, z of every hostile on the map (empty without a powered radar). */
  blips: Float32Array;
  armySlots: number;
  /** Effects this tick (skirmish FX layout). */
  fx: Float32Array;
  hostiles: number;
  /** Inhabitant camps (structures show once explored). */
  camps: CampSnap[];
  /** Inhabitants in sight: x, z, heading, camp index, elder (1/0) per person. */
  natives: Float32Array;
  /** Player combat units (they're also in `army`, at `slot`). */
  units: UnitSnap[];
  alloys: number;
  cryo: number;
  /** MW generated / wanted / actually short for the cryo bank. */
  gen: number;
  draw: number;
  short: number;
  stored: number;
  storageMax: number;
  daylight: number;
  /** A powered radar exists. */
  radar: boolean;
  /** Seconds to the next pack (only with radar). */
  nextPack: number | null;
  /** Packs on the map: centre, members alive, seen (radar or sight). */
  packs: { x: number; z: number; alive: number; seen: boolean }[];
  fab: { queued: number; progress: number };
  people: PeopleSnap;
  over: SimState['over'];
  stats: SimState['stats'];
}

/**
 * What an event sounds like (src/audio). Sent alongside the event text so the
 * client doesn't have to match on wording; events without one stay silent.
 */
export type EventCue = 'placed' | 'online' | 'unitReady' | 'droneReady' | 'packCleared' | 'lost' | 'deny' | 'warning' | 'alarm';

export type FromWorker =
  | Snapshot
  | { type: 'saved'; reqId: number; state: SimState }
  | { type: 'event'; text: string; level: 'info' | 'warn' | 'bad'; cue?: EventCue };
