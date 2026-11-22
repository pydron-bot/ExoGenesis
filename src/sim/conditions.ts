/**
 * Conditions (content/defs.ts CONDITIONS): story event triggers and mission
 * objectives both ask "is this true right now?" here, so they always agree.
 * `all` / `any` hold a group of conditions (each can be turned round with `not`).
 */
import { content } from '../content';
import type { Condition, ConditionDef } from '../content/defs';
import type { Sim } from './core';
import { blocOf } from './people-types';

const SOL = content.colony.solSeconds;

export interface ConditionWorld {
  /** The region being played. */
  region: string;
  /** Story sites on the region being played. */
  sites: { id: string; x: number; z: number; r: number }[];
}

export function conditionMet(sim: Sim, kind: Condition, c: ConditionDef, w: ConditionWorld): boolean {
  const s = sim.s, n = c.count ?? 1, st = s.story;
  switch (kind) {
    case 'start': return sim.deployed;
    case 'time': return c.sol !== undefined && sim.secs / SOL + 1 >= c.sol;
    case 'built': return !!c.building && s.buildings.filter((b) => b.kind === c.building && b.progress >= 1).length >= n;
    case 'placed': return !!c.building && (!!st?.placed?.includes(c.building) || s.buildings.some((b) => b.kind === c.building));
    case 'colonists': return (s.people?.colonists.length ?? 0) >= n;
    case 'pod': return (s.people?.pods.length ?? 0) > 0 || (s.people?.grown ?? 0) > 0;
    case 'firstAge': {
      const f = s.people ? sim.people.first() : undefined;
      const who = f && s.people!.colonists.find((x) => x.id === f.id);
      return !!who && sim.people.age(who) >= n;
    }
    case 'acceptance': { const a = s.people ? sim.people.acceptance() : null; return a !== null && a >= n; }
    case 'distrust': { const a = s.people ? sim.people.acceptance() : null; return a !== null && a <= n; }
    case 'births': return (s.people?.births ?? 0) >= n;
    case 'deaths': return (s.people?.memorial.filter((m) => !m.cause.startsWith('left')).length ?? 0) >= n;
    case 'units': return (s.units?.length ?? 0) >= n;
    case 'drones': return s.drones.length >= n;
    case 'packs': return s.stats.packsBeaten >= n;
    case 'kills': return s.stats.kills >= n;
    case 'lost': return s.stats.buildingsLost >= n;
    case 'alloys': return s.alloys >= n;
    case 'researched': return !!c.research && !!s.research?.done.includes(c.research);
    case 'site': {
      const site = w.sites.find((x) => x.id === c.site);
      if (!site) return false;
      const near = (o: { x: number; z: number }) => Math.hypot(o.x - site.x, o.z - site.z) <= site.r;
      return s.drones.some(near) || (s.units ?? []).some(near);
    }
    case 'explored': {
      const site = w.sites.find((x) => x.id === c.site);
      return !!site && sim.explored(site.x, site.z);
    }
    case 'contact': return (s.camps ?? []).some((x) => x.group === c.group && x.met);
    case 'trust': return (s.camps ?? []).some((x) => x.group === c.group && x.trusted);
    case 'flag': return !!c.flag && !!st?.flags.includes(c.flag);
    case 'counter': return !!c.counter && (st?.counters?.[c.counter] ?? 0) >= (c.count ?? 0);
    case 'counterBelow': return !!c.counter && (st?.counters?.[c.counter] ?? 0) <= (c.count ?? 0);
    case 'timer': return !!c.timer && !!st?.expired?.includes(c.timer);
    case 'opened': {
      const seen = st?.opened ?? [];
      return !!c.panel && (c.panel === 'select' && c.building ? seen.includes(`select:${c.building}`) : seen.includes(c.panel));
    }
    case 'after': return !!c.event && !!st?.answered.includes(c.event);
    case 'mission': return !!c.mission && !!s.missions?.done.includes(c.mission);
    case 'failed': return !!c.mission && !!s.missions?.failed?.includes(c.mission);
    case 'planet': return sim.planet.health() >= (c.count ?? 0);
    case 'planetBelow': return sim.planet.health() <= (c.count ?? 0);
    case 'reports': return (s.planet?.reports.length ?? 0) >= n;
    case 'cryoBelow': return s.cryo <= (c.count ?? 0);
    case 'biomassBelow': return !!s.people?.colonists.length && s.people.biomass <= (c.count ?? 0);
    case 'embryosBelow': return !!s.people && sim.people.embryos() <= (c.count ?? 0);
    case 'injured': return !!s.people && sim.people.injured().length >= n;
    case 'children': return !!s.people && s.people.colonists.filter((x) => !sim.people.adult(x)).length >= n;
    case 'autonomists': return !!s.people && s.people.colonists.filter((x) => sim.people.adult(x) && blocOf(x.stance) === 'autonomist').length >= n;
    case 'devoted': return !!s.people && s.people.colonists.filter((x) => sim.people.adult(x) && blocOf(x.stance) === 'devoted').length >= n;
    case 'striking': return !!s.people && s.people.colonists.filter((x) => x.strike).length >= n;
    case 'linesGone': return (s.people?.gone.length ?? 0) >= n;
    case 'regard': return (s.camps ?? []).some((x) => x.group === c.group && !x.gone && x.regard >= (c.count ?? 0));
    case 'regardBelow': return (s.camps ?? []).some((x) => x.group === c.group && x.met && !x.gone && x.regard <= (c.count ?? 0));
    case 'here': return !!c.place && (c.place === w.region || sim.everywhere);
    case 'visited': return !!c.place && (!!s.campaign?.visited.includes(c.place) || (sim.everywhere && c.place === w.region));
    case 'all': return !!c.of?.length && c.of.every((x) => conditionMet(sim, x.kind, x, w) !== !!x.not);
    case 'any': return !!c.of?.some((x) => conditionMet(sim, x.kind, x, w) !== !!x.not);
    case 'never': return false;
  }
}
