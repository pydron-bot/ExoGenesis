/** Skirmish proof of concept: data contract between the worker sim and the renderer. */

export const SK_TICK_HZ = 10;
export const SK_TICK_MS = 1000 / SK_TICK_HZ;
export const MAX_UNITS = 1500;

/** Per-slot floats in the snapshot buffer. */
export const STRIDE = 7;
export const F = { X: 0, Z: 1, HEADING: 2, TYPE: 3, HP: 4, GEN: 5, ALIVE: 6 } as const;

/** Per-event floats in the effects buffer: kind, x1, z1, x2, z2. */
export const FX_STRIDE = 5;
export const FX = { ROVER_SHOT: 0, TANK_SHOT: 1, BITE: 2, DIE_SMALL: 3, DIE_BIG: 4, CORE_HIT: 5 } as const;

export const UT = { Rover: 0, Tank: 1, Swarmer: 2, Brute: 3 } as const;
export const TYPE_NAMES = ['Rover', 'Tank', 'Swarmer', 'Brute'];

export interface UnitDef {
  team: 0 | 1;
  hp: number;
  speed: number;
  range: number;
  dmg: number;
  cooldown: number; // seconds
  radius: number;
  splash?: number;
  aggro: number;
}

export const DEFS: UnitDef[] = [
  { team: 0, hp: 60, speed: 7.5, range: 14, dmg: 6, cooldown: 0.5, radius: 0.9, aggro: 18 },
  { team: 0, hp: 170, speed: 4.2, range: 22, dmg: 26, cooldown: 1.6, radius: 1.3, splash: 3, aggro: 26 },
  { team: 1, hp: 40, speed: 6.5, range: 1.6, dmg: 6, cooldown: 0.6, radius: 0.7, aggro: 16 },
  { team: 1, hp: 300, speed: 3.2, range: 2.4, dmg: 24, cooldown: 1.4, radius: 1.5, aggro: 16 },
];

export type SkToWorker =
  | { type: 'move'; slots: number[]; x: number; z: number }
  | { type: 'stop'; slots: number[] }
  | { type: 'wave'; count: number }
  | { type: 'speed'; speed: number }
  | { type: 'reset'; units: number; waveSize: number };

export interface SkSnapshot {
  type: 'snap';
  tick: number;
  slots: number;
  units: Float32Array;
  fx: Float32Array;
  coreHp: number;
  wave: number;
  nextWave: number;
  kills: number;
  lost: number;
  players: number;
  enemies: number;
  simMs: number;
}

export type SkFromWorker = SkSnapshot | { type: 'event'; text: string; level: 'info' | 'warn' | 'bad' };
