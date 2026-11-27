/**
 * The army snapshot's float layout and the battle-effect codes: plain constants, no content, so the renderer and the
 * editor can use them without loading the game's content (src/content/index.ts reloads a page on content edits).
 * ./types.ts re-exports them with the unit roster.
 */
export const MAX_UNITS = 1500;

/** Per-slot floats in the snapshot buffer. */
export const STRIDE = 9;
/** TEAM: the owner of one of our units (skirmish players; 0 = you, and the PoC's armies). */
/** AIM: where the unit's gun points (world yaw, like HEADING); the hull's heading when it has no target. */
export const F = { X: 0, Z: 1, HEADING: 2, TYPE: 3, HP: 4, GEN: 5, ALIVE: 6, TEAM: 7, AIM: 8 } as const;

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
