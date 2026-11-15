/**
 * Simulation data contract. Everything in SimState is plain data so it can be
 * structured-cloned to/from the worker and written straight into IndexedDB.
 */

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
/** Half-width of the landing region, in world units (~1 unit = 10 m). */
export const REGION_HALF = 120;
/** Hostile render slots (shared buffer layout with the skirmish renderer). */
export const MAX_HOSTILES = 400;

// Balance numbers (costs, power, build times, sol length...) live in /content;
// see src/content/defs.ts.

/** A building; `kind` is its content id (content/buildings/<kind>.json). */
export interface Building {
  id: number;
  kind: string;
  x: number;
  z: number;
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
}

export interface Deposit { x: number; z: number; alloys: number; max: number }

export interface Pack { id: number; size: number; announced: boolean; alive: number; from: string }

export interface SimState {
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
  packs: Pack[];
  /** Next pack index and the tick it arrives; attackers spawned so far. */
  waves: { n: number; next: number; spawned: number };
  /** Drone fabrication at the Core. */
  fab: { queued: number; progress: number; free?: boolean };
  /** Landing sequence: 'descent' until touchdown, 'landed' until the drone is out, then 'deployed'. */
  phase: 'descent' | 'landed' | 'deployed';
  /** Ticks of engine-noise panic left: grazers near the core bolt. */
  panic: number;
  /** Set when the game is lost. */
  over: null | 'core' | 'cryo';
  stats: { kills: number; buildingsLost: number; dronesLost: number; packsBeaten: number; mined: number };
}

export type LandingStage = 'burn' | 'touchdown' | 'deploy';

export type Command =
  | { type: 'move'; drone: number; x: number; z: number }
  | { type: 'build'; kind: string; x: number; z: number }
  | { type: 'repair'; id: number }
  | { type: 'power'; id: number; on: boolean }
  | { type: 'demolish'; id: number }
  | { type: 'fab' }
  | { type: 'landing'; stage: LandingStage };

export type ToWorker =
  | { type: 'cmd'; cmd: Command }
  | { type: 'speed'; speed: number }
  | { type: 'save'; reqId: number }
  | { type: 'load'; state: SimState }
  | { type: 'new'; seed: number };

export interface DroneSnap {
  id: number; x: number; z: number; heading: number; tx: number; tz: number;
  moving: boolean; working: boolean; hp: number; task: DroneTask['kind']; manual: boolean;
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
  /** Hostiles in the skirmish renderer's layout (see skirmish/types STRIDE / F). */
  army: Float32Array;
  armySlots: number;
  /** Effects this tick (skirmish FX layout). */
  fx: Float32Array;
  hostiles: number;
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
  over: SimState['over'];
  stats: SimState['stats'];
}

export type FromWorker =
  | Snapshot
  | { type: 'saved'; reqId: number; state: SimState }
  | { type: 'event'; text: string; level: 'info' | 'warn' | 'bad' };
