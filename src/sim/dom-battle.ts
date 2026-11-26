/**
 * Domination battles in full (DESIGN §5.12 phase 4, TECH.md "Domination: battles in full"): a fight on the strategy
 * map between you and other players, played as a skirmish on that area's map. The strategy page writes a `DomBattle`
 * (who's there, with what) and opens the game; the game turns the numbers into units and turrets, plays it, writes
 * what's left (`battleOutcome`) and goes back; the page lays that over the war (`applyBattle`).
 *
 * Strength ⇄ units: about one unit per 5 strength (tanks, rovers and lancers in turn), at most 40 a side, each worth
 * an equal share of the army; a damaged unit counts for its share of health. Guns: a turret per 10 (at most 12).
 */
import { content } from '../content';
import type { DomLevel, DomState } from './domination';
import type { SimState } from './types';

/** The IndexedDB record that carries a battle between the two pages. */
export const BATTLE_KEY = 'dombattle';
const MIX = ['tank', 'rover', 'lancer', 'tank', 'rover'];
const MAX_UNITS = 40, MAX_TURRETS = 12, PER_TURRET = 10;

export interface BattleSide {
  /** The player's index in the war. */
  player: number;
  name: string;
  color: string;
  ai?: DomLevel;
  /** Holds the area: a Command Core, its guns as turrets. */
  core: boolean;
  army: number;
  guns: number;
  /** Strength each of its units stands for. */
  per: number;
  units: { unit: string; n: number }[];
  turrets: number;
}

export interface BattleResult {
  /** Fought to a finish (not left half way). */
  done: boolean;
  /** Per side (same order): what's left. */
  sides: { player: number; army: number; guns: number; core: boolean }[];
}

export interface DomBattle {
  version: 1;
  area: string;
  /** The war's seed (the area's map comes from it). */
  seed: number;
  /** War time when it started. */
  at: number;
  /** Skirmish players in order: you first. */
  sides: BattleSide[];
  result?: BattleResult;
}

/** An army as units: about one per 5 strength, at most 40. */
export function battleUnits(army: number) {
  const n = army < 1 ? 0 : Math.max(1, Math.min(MAX_UNITS, Math.round(army / 5)));
  const count: Record<string, number> = {};
  for (let i = 0; i < n; i++) count[MIX[i % MIX.length]] = (count[MIX[i % MIX.length]] ?? 0) + 1;
  return { units: Object.entries(count).map(([unit, k]) => ({ unit, n: k })), per: n ? army / n : 0 };
}

/** Why you can't fight this area's battle yourself, or null. */
export function cannotCommand(s: DomState, areaId: string, me = 0): string | null {
  const a = s.areas[areaId];
  if (!a || s.over) return 'No battle here';
  const visitors = Object.entries(a.visitors).filter(([, v]) => v > 0).map(([p]) => Number(p));
  if (!visitors.length) return 'No battle here';
  if (a.owner !== me && !visitors.includes(me)) return 'You\'re not in this fight';
  if (a.owner < 0) return 'Fights with the natives play out on the map';
  return null;
}

/** The battle as it stands now in `areaId` (check `cannotCommand` first). */
export function makeBattle(s: DomState, areaId: string, me = 0): DomBattle {
  const a = s.areas[areaId];
  const who = [me, ...(a.owner >= 0 && a.owner !== me ? [a.owner] : []), ...Object.entries(a.visitors).filter(([p, v]) => v > 0 && Number(p) !== me).map(([p]) => Number(p))];
  const sides = who.map((p): BattleSide => {
    const pl = s.players[p], core = a.owner === p;
    const army = core ? a.army : a.visitors[p] ?? 0, guns = core ? a.guns : 0;
    const { units, per } = battleUnits(army);
    return { player: p, name: pl.name, color: pl.color, ai: pl.ai, core, army, guns, per, units, turrets: core ? Math.min(MAX_TURRETS, Math.round(guns / PER_TURRET)) : 0 };
  });
  return { version: 1, area: areaId, seed: s.seed, at: s.t, sides };
}

/** What's left of each side in a battle's sim state. */
export function battleOutcome(st: SimState, b: DomBattle, done: boolean): BattleResult {
  return {
    done,
    sides: b.sides.map((side, i) => {
      const mine = (o: { team?: number }) => (o.team ?? 0) === i;
      const army = (st.units ?? []).filter(mine).reduce((m, u) => m + (u.hp / (content.units[u.unit]?.hp ?? u.hp)) * side.per, 0);
      const guns = st.buildings.filter((x) => mine(x) && x.kind === 'turret').reduce((m, t) => m + (t.hp / (content.buildings.turret?.hp ?? t.hp)) * PER_TURRET, 0);
      const core = side.core && st.buildings.some((x) => mine(x) && x.kind === 'core');
      // turrets stood for at most MAX_TURRETS × 10: guns beyond that are kept in proportion
      const gunsLeft = side.turrets ? Math.min(side.guns, guns * (side.guns / (side.turrets * PER_TURRET))) : side.guns;
      return { player: side.player, army: Math.round(army * 10) / 10, guns: core ? Math.round(gunsLeft * 10) / 10 : 0, core };
    }),
  };
}

/** Lay a battle's outcome over the war: the area's numbers become what was left (the map's fight goes on from there). */
export function applyBattle(s: DomState, b: DomBattle, r: BattleResult) {
  const a = s.areas[b.area];
  if (!a) return;
  r.sides.forEach((x, i) => {
    const side = b.sides[i];
    if (!side) return;
    if (side.core) {
      if (a.owner !== x.player) return; // (it changed hands meanwhile: nothing to lay over)
      a.army = x.core ? x.army : 0;
      a.guns = x.core ? x.guns : 0;
    } else if (x.army >= 0.5) a.visitors[x.player] = x.army;
    else delete a.visitors[x.player];
  });
}
