/**
 * Simulation data contract. Everything in SimState is plain data so it can be
 * structured-cloned to/from the worker and written straight into IndexedDB.
 */

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
/** Half-width of the landing region, in world units (~1 unit = 10 m). */
export const REGION_HALF = 120;

export const SOLAR_COST = 40;
export const SOLAR_MW = 6;
export const CORE_MW = 2;
export const CRYO_DRAW_MW = 4;
export const BUILD_SECONDS = 8;
/** Real seconds per game day (the compressed clock). */
export const SOL_SECONDS = 240;

export type BuildingKind = 'core' | 'solar';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  z: number;
  /** 0..1 construction progress; 1 = online. */
  progress: number;
}

export type DroneTask =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'build'; siteId: number };

export interface Drone {
  x: number;
  z: number;
  heading: number;
  task: DroneTask;
}

export interface Creature {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  herd: number;
}

export interface SimState {
  version: 1;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  alloys: number;
  /** Cryo bank integrity, 0..100. */
  cryo: number;
  cryoWarn: number;
  drone: Drone;
  buildings: Building[];
  herds: { x: number; z: number }[];
  fauna: Creature[];
}

export type Command =
  | { type: 'move'; x: number; z: number }
  | { type: 'build'; kind: 'solar'; x: number; z: number };

export type ToWorker =
  | { type: 'cmd'; cmd: Command }
  | { type: 'speed'; speed: number }
  | { type: 'save'; reqId: number }
  | { type: 'load'; state: SimState }
  | { type: 'new'; seed: number };

export interface Snapshot {
  type: 'snap';
  tick: number;
  drone: { x: number; z: number; heading: number; tx: number; tz: number; moving: boolean; building: boolean };
  /** x, z, heading per creature. */
  fauna: Float32Array;
  buildings: Building[];
  alloys: number;
  cryo: number;
  gen: number;
  draw: number;
}

export type FromWorker =
  | Snapshot
  | { type: 'saved'; reqId: number; state: SimState }
  | { type: 'event'; text: string; level: 'info' | 'warn' | 'bad' };
