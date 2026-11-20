/**
 * Colony modifiers and research gates, shared by the sim (authoritative) and the
 * HUD (the research tree), so the tree says exactly what the sim will accept.
 *
 * A modifier (content/defs.ts MOD_STATS) is a sum: every finished research
 * project's `effects`, plus story boosts still running (StoryState.mods, set by
 * dilemma choices and inhabitants' gifts). The sim reads it where the stat is
 * used (`Sim.mod`); `modTotals` works it out for the HUD.
 */
import type { BuildingDef, ModStat, ResearchDef } from '../content/defs';

/** What a research project's gates look at. */
export interface ResearchWorld {
  done: readonly string[];
  /** The colony's buildings (finished or not). */
  buildings: readonly { kind: string; progress: number }[];
  /** Specialties of the adult colonists. */
  specialists: readonly string[];
  /** Story flags set. */
  flags: readonly string[];
}

export interface ResearchNeed { text: string; ok: boolean }

const SPEC_NAME: Record<string, string> = { engineer: 'an Engineer', botanist: 'a Botanist', medic: 'a Medic', technician: 'a Technician', security: 'a Security officer' };

/** Everything a project waits on, each met or not (in the order the tree lists them). */
export function researchNeeds(r: ResearchDef, all: Record<string, ResearchDef>, defs: Record<string, BuildingDef>, w: ResearchWorld): ResearchNeed[] {
  const out: ResearchNeed[] = [];
  for (const id of [r.requires, r.also]) if (id && all[id]) out.push({ text: `after ${all[id].name}`, ok: w.done.includes(id) });
  if (r.building && defs[r.building]) out.push({ text: `a finished ${defs[r.building].name}`, ok: w.buildings.some((b) => b.kind === r.building && b.progress >= 1) });
  if (r.specialist) out.push({ text: `${SPEC_NAME[r.specialist] ?? r.specialist} in the colony`, ok: w.specialists.includes(r.specialist) });
  if (r.flag) out.push({ text: r.flagText || `discovery: ${r.flag}`, ok: w.flags.includes(r.flag) });
  return out;
}

/** Why a project can't start yet (its first unmet need), or null. Cost and the lab aside. */
export function researchBlocked(r: ResearchDef, all: Record<string, ResearchDef>, defs: Record<string, BuildingDef>, w: ResearchWorld): string | null {
  return researchNeeds(r, all, defs, w).find((n) => !n.ok)?.text ?? null;
}

/** A running story boost (StoryState.mods): a stat, how much, until which tick (−1 = for good), what to call it. */
export interface ModBoost { stat: string; amount: number; until: number; text: string; id?: string }

/** Every modifier summed: finished research plus boosts still running at `tick`. */
export function modTotals(done: readonly string[], all: Record<string, ResearchDef>, boosts: readonly ModBoost[] = [], tick = 0): Partial<Record<ModStat, number>> {
  const out: Partial<Record<ModStat, number>> = {};
  for (const id of done) for (const e of all[id]?.effects ?? []) out[e.stat] = (out[e.stat] ?? 0) + e.amount;
  for (const b of boosts) if (b.until < 0 || b.until > tick) out[b.stat as ModStat] = (out[b.stat as ModStat] ?? 0) + b.amount;
  return out;
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const less = (v: number) => (v >= 0 ? `−${Math.round(v * 100)}%` : `+${Math.round(-v * 100)}%`);
/** One modifier in words, for the research tree and the Colony panel ("Depot mining +20%"). */
export function modText(stat: string, v: number): string {
  switch (stat as ModStat) {
    case 'mining': return `Depot mining ${pct(v)}`;
    case 'isotopeMining': return `Isotope mining ${pct(v)}`;
    case 'solar': return `Solar power ${pct(v)}`;
    case 'farm': return `Biomass grown ${pct(v)}`;
    case 'printer': return `Matter Printer output ${pct(v)}`;
    case 'eat': return `Food eaten ${less(v)}`;
    case 'battery': return `Battery storage ${pct(v)}`;
    case 'droneWork': return `Drone work ${pct(v)}`;
    case 'drones': return `${v > 0 ? '+' : ''}${v} worker drone${Math.abs(v) === 1 ? '' : 's'} allowed`;
    case 'units': return `${v > 0 ? '+' : ''}${v} combat unit${Math.abs(v) === 1 ? '' : 's'} allowed`;
    case 'turretDamage': return `Turret damage ${pct(v)}`;
    case 'armor': return `Damage to buildings ${less(v)}`;
    case 'repairPad': return `Repair Pads ${pct(v)}`;
    case 'shieldRegen': return `Shield recharge ${pct(v)}`;
    case 'relicDamage': return `Damage to relics ${pct(v)}`;
    case 'researchSpeed': return `Research speed ${pct(v)}`;
    case 'podSpeed': return `Growth pods ${pct(v)} faster`;
    case 'injuredTime': return `The injured hold on ${pct(v)} longer`;
    case 'wellbeing': return `Wellbeing ${v > 0 ? '+' : ''}${Math.round(v)}`;
    case 'stance': return `AI acceptance ${v > 0 ? '+' : ''}${v}/sol`;
    case 'sabotage': return `Sabotage ${less(v)}`;
    case 'grief': return `Grief fades ${pct(v)} faster`;
    case 'staff': return `Staff bonus ${pct(v)}`;
    case 'scars': return `Mining scars ${less(v)}`;
    case 'restore': return `Seed Bank healing ${pct(v)}`;
    case 'regard': return `Inhabitants' regard recovers ${pct(v)} faster`;
    case 'salvage': return `Salvage speed ${pct(v)}`;
    case 'cacheYield': return `Relic caches pay ${pct(v)}`;
    case 'nestRegrow': return `Nests regrow ${pct(v)} slower`;
    case 'warning': return `Threat warnings ${Math.round(v)} s earlier`;
    case 'power': return `Power draw ${pct(v)}`;
    case 'trade': return 'Trade with inhabitants';
    case 'fortify': return 'Standing order: Fortify';
  }
  return `${stat} ${v}`;
}
