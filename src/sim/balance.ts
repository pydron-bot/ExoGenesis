/**
 * Headless balance runs: plays the real sim for N game minutes with a scripted
 * strategy and records a timeline, so tuning content numbers is measured, not
 * guessed. Shared by `node tools/balance.mjs` (prints it) and the editor's
 * Balance page (runs it in a worker on the editor's content, see
 * src/editor/balance-worker.ts).
 */
import { content } from '../content';
import { Sim, useRegion } from './core';
import { placeProblem } from './rules';
import type { SimState } from './types';

const TICK_HZ = 10;

export { STRATEGIES } from './strategies';
import { STRATEGIES } from './strategies';

export interface BalanceOptions {
  minutes?: number;
  seed?: number;
  region?: string;
  /** No predators (the economy and the colonists on their own). */
  peaceful?: boolean;
  /** People policies, e.g. { hours: 'long' }. */
  policy?: Record<string, string>;
  imprint?: string;
  /** Every 10 s while hostiles are about: a line about the Core, hostiles and units. */
  trace?: (line: string) => void;
}

export interface BalanceRow {
  min: number; alloys: number; cryo: string; gen: string; draw: string; stored: number; day: string; built: number;
  hostiles: number; units: number; kills: number; lost: number; packs: number; embryos: number; people: string; pods: number;
  food: string; wb: string; stance: string; blocs: string;
}
export interface BalanceResult {
  name: string; seed: number; minutes: number;
  /** Why the colony was lost ('core', 'cryo'…), or null if it survived. */
  over: string | null;
  /** Game minutes played. */
  at: number;
  rows: BalanceRow[];
  /** Seconds when each kind was first placed or produced. */
  firsts: Record<string, number>;
  events: { t: number; text: string; level: string }[];
  people: string;
  end: string;
  /** Numbers for charts and comparisons. */
  stats: { alloys: number; cryo: number; kills: number; buildingsLost: number; dronesLost: number; unitsLost: number; packs: number; packsBeaten: number; mined: number; colonists: number; built: number };
}

type S = SimState & Record<string, unknown>;

export function runBalance(name: string, o: BalanceOptions = {}): BalanceResult {
  const minutes = o.minutes ?? 20, seed = o.seed ?? 1337;
  const REGION = useRegion(o.region ?? 'touchdown');
  const DEFS = content.buildings, RULES = content.colony;
  const spawns = content.regions[REGION].spawns;
  const VENTS = content.regions[REGION].vents ?? [];
  /** Valid spot for `kind` nearest to (px, pz), searching outward. */
  const spot = (s: S, kind: string, px: number, pz: number) => {
    for (let r = 0; r < 70; r += 2) {
      const n = Math.max(1, Math.round(r * 1.2));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
        if (!placeProblem({ ...s, vents: VENTS } as never, DEFS, RULES, kind, x, z)) return { x, z };
      }
    }
    return null;
  };
  const count = (s: S, kind: string) => s.buildings.filter((b) => b.kind === kind).length;

  const events: BalanceResult['events'] = [];
  const sim = new Sim((text: string, level: string) => events.push({ t: sim.secs, text, level }), seed);
  sim.command({ type: 'landing', stage: 'deploy' });
  if (o.peaceful) sim.s.waves.next = 1e12;
  for (const [key, value] of Object.entries(o.policy ?? {})) sim.command({ type: 'policy', key, value } as never);
  const strat = STRATEGIES[name];
  if (!strat) throw new Error(`no strategy "${name}"`);
  const plan = strat.plan();
  let spawnIdx = 0;
  const rows: BalanceRow[] = [];
  const firsts: Record<string, number> = {};
  const imprint = o.imprint ?? 'charter';
  for (let tick = 0; tick < minutes * 60 * TICK_HZ; tick++) {
    const s = sim.s as S;
    if (s.over) break;
    // the bot: every second, try the next item in its plan
    if (tick % TICK_HZ === 0 && plan.length) {
      const [kind, where] = plan[0];
      if (kind === 'fab') {
        if (s.alloys >= RULES.droneCost) { sim.command({ type: 'fab' } as never); plan.shift(); }
      } else if (content.units[kind]) {
        const bay = s.buildings.find((b) => b.kind === 'bay' && b.progress >= 1);
        if (!s.buildings.some((b) => b.kind === 'bay')) plan.unshift(['bay']); // lost it: rebuild first
        else if (bay && s.alloys >= (content.units[kind].cost ?? Infinity)) { sim.command({ type: 'produce', id: bay.id, unit: kind }); plan.shift(); firsts[kind] ??= Math.round(sim.secs); }
      } else if (DEFS[kind] && s.alloys >= DEFS[kind].cost) {
        let target = { x: 0, z: -10 };
        if (where === 'near') {
          // nearest deposit with alloys that no depot covers yet
          const free = s.deposits.map((d, i) => ({ d, i })).filter(({ d, i }) => d.alloys > 0 && !s.buildings.some((b) => b.kind === 'depot' && b.mining === i))
            .sort((a, b) => Math.hypot(a.d.x, a.d.z) - Math.hypot(b.d.x, b.d.z));
          if (free.length) target = { x: free[0].d.x * 0.75, z: free[0].d.z * 0.75 };
        } else if (where === 'guard') {
          // next to the newest depot, on the side facing the nearest spawn
          const dep = [...s.buildings].reverse().find((b) => b.kind === 'depot');
          if (dep && spawns.length) {
            const sp = [...spawns].sort((a, b) => Math.hypot(a.x - dep.x, a.z - dep.z) - Math.hypot(b.x - dep.x, b.z - dep.z))[0];
            const k = 10 / Math.hypot(sp.x - dep.x, sp.z - dep.z);
            target = { x: dep.x + (sp.x - dep.x) * k, z: dep.z + (sp.z - dep.z) * k };
          }
        } else if (where === 'vent') {
          const free = VENTS.filter((v) => !s.buildings.some((b) => b.kind === 'geothermal' && Math.hypot(b.x - v.x, b.z - v.z) < 6))
            .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
          if (free.length) target = free[0];
        } else if (where === 'spawn' && spawns.length) {
          const sp = spawns[spawnIdx++ % spawns.length];
          const k = 34 / Math.hypot(sp.x, sp.z);
          target = { x: sp.x * k, z: sp.z * k };
        }
        const p = spot(s, kind, target.x, target.z);
        if (p) { sim.command({ type: 'build', kind, ...p }); plan.shift(); firsts[kind] ??= Math.round(sim.secs); }
        else if (where === 'vent' && s.alloys >= DEFS.solar.cost + DEFS[kind].cost) {
          // the vent is outside the build area: reach toward it with a solar array first
          const b = spot(s, 'solar', target.x * 0.55, target.z * 0.55);
          if (b) sim.command({ type: 'build', kind: 'solar', ...b });
        }
      } else if (!DEFS[kind]) plan.shift(); // a kind this content doesn't have: skip it
    }
    const ppl = s.people;
    // people plan: when the plan runs out, grow the base with the colony
    if (name === 'people' && !plan.length && tick % (30 * TICK_HZ) === 0 && ppl) {
      const n = ppl.colonists.length, farms = count(s, 'hydroponics'), homes = count(s, 'civic');
      if (n * 0.04 > farms * 0.16) plan.push(['hydroponics'], ['solar']);
      else if (n >= homes * (DEFS.civic?.housing ?? 0) - 2) plan.push(['civic'], ['solar'], ['battery']);
    }
    // growth pods: keep them running (the specialty the colony is shortest of)
    if (tick % (5 * TICK_HZ) === 0 && ppl) {
      const want = ['botanist', 'engineer', 'medic', 'technician', 'security'];
      for (const b of s.buildings) {
        if (b.kind !== 'civic' || b.progress < 1) continue;
        if (ppl.pods.filter((p) => p.b === b.id).length >= (DEFS.civic.pods ?? 0)) continue;
        if (ppl.biomass < 15) continue;
        const housing = s.buildings.filter((x) => x.kind === 'civic' && x.progress >= 1).length * (DEFS.civic.housing ?? 0);
        if (ppl.colonists.length + ppl.pods.length >= housing - 1) continue; // leave room for children
        const have = (k: string) => ppl.colonists.filter((c) => c.specialty === k).length + ppl.pods.filter((p) => p.specialty === k).length;
        const sp = [...want].sort((a, b) => have(a) - have(b))[0];
        sim.command({ type: 'grow', id: b.id, specialty: sp, curriculum: ({ guardian: 'unity' } as Record<string, string>)[imprint] ?? imprint } as never);
      }
    }
    // the army: idle units go after any hostile near the base, then come home
    const units = s.units ?? [];
    if (tick % (3 * TICK_HZ) === 0 && units.length) {
      const near = s.hostiles.filter((h) => s.buildings.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < 45));
      const idle = units.filter((u) => u.order.kind === 'idle' && u.target < 0);
      if (near.length && idle.length) {
        const cx = near.reduce((m, h) => m + h.x, 0) / near.length, cz = near.reduce((m, h) => m + h.z, 0) / near.length;
        sim.command({ type: 'order', ids: idle.map((u) => u.id), x: cx, z: cz } as never);
      } else if (!s.hostiles.length && idle.length) {
        const bay = s.buildings.find((b) => b.kind === 'bay');
        const far = idle.filter((u) => bay && Math.hypot(u.x - bay.x, u.z - bay.z) > 30);
        if (far.length && bay) sim.command({ type: 'order', ids: far.map((u) => u.id), x: bay.x, z: bay.z - 14 } as never);
      }
    }
    sim.step();
    if (o.trace && tick % (10 * TICK_HZ) === 0 && s.hostiles.length) {
      const c = s.buildings.find((b) => b.kind === 'core');
      const p = (q: { x: number; z: number }) => `${q.x.toFixed(0)},${q.z.toFixed(0)}`;
      o.trace(`${(sim.secs / 60).toFixed(2)}m core ${c ? c.hp.toFixed(0) : '-'} · ${s.hostiles.length} hostiles @${p(s.hostiles[0])}→${s.hostiles[0].target} · units ${units.map((u) => `${u.unit[0]}@${p(u)} ${u.order.kind}${u.target >= 0 ? '!' : ''} g${u.gx.toFixed(0)},${u.gz.toFixed(0)}`).join(' ')} · bays ${s.buildings.filter((b) => b.kind === 'bay').map((b) => `${p(b)} ${b.progress.toFixed(1)} q${b.queue?.length ?? 0}`)}`);
    }
    if (tick % (60 * TICK_HZ) === 0) {
      const snap = sim.snapshot();
      const sp = snap.people;
      rows.push({
        min: tick / 600, alloys: Math.floor(s.alloys), cryo: s.cryo.toFixed(0), gen: snap.gen.toFixed(1), draw: snap.draw.toFixed(1),
        stored: Math.round(s.stored), day: snap.daylight.toFixed(2), built: s.buildings.filter((b) => b.progress >= 1).length - 1,
        hostiles: s.hostiles.length, units: units.length, kills: s.stats.kills, lost: s.stats.buildingsLost, packs: s.waves.n,
        embryos: sp.embryos, people: `${sp.adults}+${sp.children}`, pods: ppl?.pods.length ?? 0,
        food: `${Math.round(sp.biomass)} ${(sp.food.made - sp.food.eaten).toFixed(2)}`, wb: sp.wellbeing.toFixed(0), stance: sp.stance.toFixed(0),
        blocs: `${sp.blocs.partner}/${sp.blocs.autonomist}/${sp.blocs.devoted}`,
      });
    }
  }
  const s = sim.s as S;
  const ps = sim.snapshot().people;
  return {
    name, seed, minutes,
    over: (s.over as string | undefined) || null,
    at: sim.secs / 60,
    rows, firsts, events,
    people: `people: ${ps.adults} adults + ${ps.children} children · embryos ${ps.embryos} · grown ${ps.stats.grown} · born ${ps.stats.births} · died ${ps.stats.deaths} · left ${ps.stats.departed} · diversity ${ps.diversity.toFixed(0)}% · wellbeing ${ps.wellbeing.toFixed(0)} · stance ${ps.stance.toFixed(0)}`,
    end: `end: alloys ${Math.floor(s.alloys)} · cryo ${s.cryo.toFixed(0)}% · kills ${s.stats.kills} · buildings lost ${s.stats.buildingsLost} · drones lost ${s.stats.dronesLost} · units lost ${s.stats.unitsLost ?? 0} · packs ${s.waves.n} (beaten ${s.stats.packsBeaten}) · mined ${Math.round(s.stats.mined)}`,
    stats: {
      alloys: Math.floor(s.alloys), cryo: Math.round(s.cryo), kills: s.stats.kills, buildingsLost: s.stats.buildingsLost, dronesLost: s.stats.dronesLost,
      unitsLost: s.stats.unitsLost ?? 0, packs: s.waves.n, packsBeaten: s.stats.packsBeaten, mined: Math.round(s.stats.mined), colonists: ps.adults + ps.children,
      built: s.buildings.filter((b) => b.progress >= 1).length - 1,
    },
  };
}
