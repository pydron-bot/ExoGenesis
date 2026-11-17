/**
 * Conditions (content/defs.ts CONDITIONS): story event triggers and mission
 * objectives both ask "is this true right now?" here, so they always agree.
 */
import { content } from '../content';
import type { Condition, ConditionDef } from '../content/defs';
import type { Sim } from './core';

const SOL = content.colony.solSeconds;

export interface ConditionWorld {
  /** Story sites on the region being played. */
  sites: { id: string; x: number; z: number; r: number }[];
}

export function conditionMet(sim: Sim, kind: Condition, c: ConditionDef, w: ConditionWorld): boolean {
  const s = sim.s, n = c.count ?? 1;
  switch (kind) {
    case 'start': return sim.deployed;
    case 'time': return c.sol !== undefined && sim.secs / SOL + 1 >= c.sol;
    case 'built': return !!c.building && s.buildings.filter((b) => b.kind === c.building && b.progress >= 1).length >= n;
    case 'colonists': return (s.people?.colonists.length ?? 0) >= n;
    case 'pod': return (s.people?.pods.length ?? 0) > 0 || (s.people?.grown ?? 0) > 0;
    case 'firstAge': {
      const f = s.people ? sim.people.first() : undefined;
      const who = f && s.people!.colonists.find((x) => x.id === f.id);
      return !!who && sim.people.age(who) >= n;
    }
    case 'acceptance': { const a = s.people ? sim.people.acceptance() : null; return a !== null && a >= n; }
    case 'distrust': { const a = s.people ? sim.people.acceptance() : null; return a !== null && a <= n; }
    case 'units': return (s.units?.length ?? 0) >= n;
    case 'drones': return s.drones.length >= n;
    case 'packs': return s.stats.packsBeaten >= n;
    case 'site': {
      const site = w.sites.find((x) => x.id === c.site);
      if (!site) return false;
      const near = (o: { x: number; z: number }) => Math.hypot(o.x - site.x, o.z - site.z) <= site.r;
      return s.drones.some(near) || (s.units ?? []).some(near);
    }
    case 'contact': return (s.camps ?? []).some((x) => x.group === c.group && x.met);
    case 'trust': return (s.camps ?? []).some((x) => x.group === c.group && x.trusted);
    case 'flag': return !!c.flag && !!s.story?.flags.includes(c.flag);
    case 'after': return !!c.event && !!s.story?.answered.includes(c.event);
    case 'mission': return !!c.mission && !!s.missions?.done.includes(c.mission);
    case 'never': return false;
  }
}
