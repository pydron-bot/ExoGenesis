/**
 * The army's data contract between the sim (src/sim/core.ts packs it into each snapshot) and the renderer
 * (./view.ts): unit type numbers, the per-unit float layout and the battle-effects buffer.
 */
import { content, type AssetDef } from '../../content';

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

export { F, FX, FX_STRIDE, MAX_UNITS, STRIDE } from './layout';

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

/** What ArmyView draws: the sim snapshot's army and effects, in this shape (main.ts `asArmy`). */
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
