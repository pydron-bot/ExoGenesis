/** Skirmish proof of concept: data contract between the worker sim and the renderer. */
import { content, type AssetDef } from '../content';

/**
 * Unit roster, indexed by type number (UT). The skirmish's four come first so
 * their numbers never change; every other unit record follows in id order.
 * Stats come from content/units/*.json.
 */
const FIXED = ['rover', 'tank', 'swarmer', 'brute'];
export const ROSTER: string[] = [...FIXED, ...Object.keys(content.units).filter((id) => !FIXED.includes(id)).sort()];
const TYPE_OF: Record<string, number> = Object.fromEntries(ROSTER.map((id, i) => [id, i]));
/** Type number of a unit id (the roster index). */
export const unitType = (id: string) => TYPE_OF[id] ?? -1;

export const SK_TICK_HZ = 10;
export const SK_TICK_MS = 1000 / SK_TICK_HZ;
export const MAX_UNITS = 1500;

/** Per-slot floats in the snapshot buffer. */
export const STRIDE = 8;
/** TEAM: the owner of one of our units (skirmish players; 0 = you, and the PoC's armies). */
export const F = { X: 0, Z: 1, HEADING: 2, TYPE: 3, HP: 4, GEN: 5, ALIVE: 6, TEAM: 7 } as const;

/** Per-event floats in the effects buffer: kind, x1, z1, x2, z2. */
export const FX_STRIDE = 5;
/**
 * TURRET_SHOT draws like TANK_SHOT; it's separate so it can sound different.
 * SHELL: artillery/cannon round (x1,z1 gun → x2,z2 impact). ARC: one jump of a
 * chain discharge. SPIT: a spitter's glob. EMERGE: a burrower surfaces at x1,z1.
 * REPAIR: a repair beam (engineer or pad). PD_SHOT: rapid point-defense fire.
 * RAIL: a Lancer's rail slug (an instant white-hot line and a hard hit).
 * SHIELD: a hit stopped by a shield (x1,z1 where it struck the shield, x2,z2 the shield's centre).
 */
export const FX = {
  ROVER_SHOT: 0, TANK_SHOT: 1, BITE: 2, DIE_SMALL: 3, DIE_BIG: 4, CORE_HIT: 5, TURRET_SHOT: 6,
  SHELL: 7, ARC: 8, SPIT: 9, EMERGE: 10, REPAIR: 11, PD_SHOT: 12, RAIL: 13, SHIELD: 14,
} as const;

export const UT = { Rover: 0, Tank: 1, Swarmer: 2, Brute: 3 } as const;
export const TYPE_NAMES = ROSTER.map((id) => content.units[id].name);

export interface SkUnitDef {
  id: string;
  /** 0 player, 1 fauna. */
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
  /** How it gets about (ground when unset): hover craft ride on the water, boats sit in it, flyers fly high. */
  move?: 'hover' | 'water' | 'air';
  /** Asset model replacing the built-in mesh, if any. */
  model?: AssetDef;
}

export const DEFS: SkUnitDef[] = ROSTER.map((id) => {
  const u = content.units[id];
  return {
    id, team: u.faction === 'accord' ? 0 : 1, hp: u.hp, speed: u.speed, range: u.range, dmg: u.damage,
    cooldown: u.cooldown, radius: u.radius, splash: u.splash || undefined, aggro: u.aggro, scale: u.modelScale,
    move: u.move === 'ground' ? undefined : u.move,
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
