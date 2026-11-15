/** Skirmish proof of concept: data contract between the worker sim and the renderer. */
import { content, type AssetDef } from '../content';

/** Skirmish roster, indexed by UT. Stats come from content/units/*.json. */
const ROSTER = ['rover', 'tank', 'swarmer', 'brute'] as const;

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
export const TYPE_NAMES = ROSTER.map((id) => content.units[id].name);

export interface SkUnitDef {
  team: 0 | 1;
  hp: number;
  speed: number;
  range: number;
  dmg: number;
  cooldown: number; // seconds
  radius: number;
  splash?: number;
  aggro: number;
  scale: number;
  /** Asset model replacing the built-in mesh, if any. */
  model?: AssetDef;
}

export const DEFS: SkUnitDef[] = ROSTER.map((id) => {
  const u = content.units[id];
  return {
    team: u.faction === 'accord' ? 0 : 1, hp: u.hp, speed: u.speed, range: u.range, dmg: u.damage,
    cooldown: u.cooldown, radius: u.radius, splash: u.splash || undefined, aggro: u.aggro, scale: u.modelScale,
    model: u.model ? content.assets[u.model] : undefined,
  };
});

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
