/**
 * Planet health (DESIGN §5.8, STORY §6): the number the Biosphere Report sends
 * home at the end of every sol, and the one Meridian is really reading.
 *
 *   health = start − scars − harm + restored   (0..100)
 *
 * - Scars are places: strip-mined deposits and seams, burnt-out buildings, nest
 *   sites. Each has a size in health points; a Seed Bank (role `seedbank`)
 *   heals the ones in its Range, spending surplus biomass.
 * - Harm can't be healed: nests wiped out, inhabitants driven off their land.
 * - Restored: with nothing left to heal in reach a Seed Bank rewilds, raising
 *   health beyond where it started, up to the colony rules' cap.
 *
 * Plain data in SimState.planet, like everything else the sim keeps.
 */
import { goodReport, reportGrade } from './grade';
import { content } from '../content';
import type { BuildingDef } from '../content/defs';
import type { Sim } from './core';
import { TICK_HZ, type PlanetState, type PlanetSnap } from './types';

const DT = 1 / TICK_HZ;
/** Scars this close together are one scar. */
const MERGE_R = 6;
/** Smaller than this (health points), a scar has healed over. */
const HEALED = 0.05;
/** Seed banks only spend biomass above this share of storage: they never eat into the food reserve. */
const RESERVE = 0.25;
/** Rewilding (nothing to heal in reach) goes at this share of a seed bank's restore rate. */
const REWILD = 0.5;

const R = () => content.colony;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const def = (kind: string): BuildingDef | undefined => content.buildings[kind];

export class Planet {
  /** Biomass the seed banks spent per second, last tick (the HUD's food readout). */
  use = 0;

  constructor(private sim: Sim) {}

  get s(): PlanetState { return (this.sim.s.planet ??= Planet.fresh()); }

  static fresh(): PlanetState { return { scars: [], harm: 0, restored: 0, reports: [] }; }

  /** Where planet health starts (colony rules). */
  start() { return R().planetStart ?? 70; }

  health() {
    const p = this.s;
    let scars = 0;
    for (const sc of p.scars) scars += sc.a;
    return clamp(this.start() - scars - p.harm + p.restored, 0, 100);
  }

  /** A scar of `a` health points at (x, z), merged into one already there. */
  scar(x: number, z: number, a: number) {
    if (!(a > 0)) return;
    const p = this.s;
    let best: PlanetState['scars'][number] | null = null, bd = MERGE_R;
    for (const sc of p.scars) {
      const d = Math.hypot(sc.x - x, sc.z - z);
      if (d < bd) { bd = d; best = sc; }
    }
    if (best) best.a += a;
    else p.scars.push({ x, z, a });
  }

  /** Lasting harm (it can't be healed): a nest wiped out, a camp driven off. */
  harm(a: number) { this.s.harm += a; }

  /** A story effect: health up (or down) by `a`, for good. */
  adjust(a: number) {
    if (a >= 0) this.s.restored += a;
    else this.s.harm -= a;
  }

  // ---------- events the sim reports ----------
  mined(x: number, z: number, alloys: number) { this.scar(x, z, alloys * (R().scarPerAlloy ?? 0) * this.lessScar()); }
  minedIsotopes(x: number, z: number, iso: number) { this.scar(x, z, iso * (R().scarPerIsotope ?? 0) * this.lessScar()); }
  /** Low-scar extraction research: mining scars less. */
  private lessScar() { return Math.max(0, 1 - this.sim.mod('scars')); }
  buildingLost(x: number, z: number, wall: boolean) { this.scar(x, z, (R().scarBuildingLost ?? 0) * (wall ? 0.25 : 1)); }
  nestDestroyed(x: number, z: number) {
    this.harm(R().nestHarm ?? 0);
    this.scar(x, z, R().scarBuildingLost ?? 0);
  }
  campLost() { this.harm(R().campHarm ?? 0); }

  // ---------- tick ----------
  step() {
    const sim = this.sim, s = sim.s, p = this.s;
    this.use = 0;
    const people = s.people;
    const storage = people ? sim.people.storage() : 0;
    for (const b of s.buildings) {
      const d = def(b.kind);
      if (d?.role !== 'seedbank') continue;
      b.engaged = false;
      if (b.progress < 1 || !b.powered || !people) continue;
      const rate = (d.restoreRate ?? 0) * sim.people.mult(b) * Math.max(0, 1 + sim.mod('restore')) * DT, cost = d.restoreCost ?? 0;
      if (rate <= 0) continue;
      // what it can afford from the surplus above the reserve
      const spare = Math.max(0, people.biomass - storage * RESERVE);
      let heal = cost > 0 ? Math.min(rate, spare / cost) : rate;
      if (heal <= 1e-9) continue;
      // the worst scar in reach first
      const reach = d.range ?? 20;
      let worst: PlanetState['scars'][number] | null = null;
      for (const sc of p.scars) if (Math.hypot(sc.x - b.x, sc.z - b.z) <= reach && (!worst || sc.a > worst.a)) worst = sc;
      if (worst) {
        heal = Math.min(heal, worst.a);
        worst.a -= heal;
        if (worst.a < HEALED) {
          p.scars.splice(p.scars.indexOf(worst), 1);
          sim.emit('Scarred land restored: the Seed Bank has healed it over', 'info', 'online');
        }
      } else {
        // nothing left to heal nearby: rewild, up to the cap
        const room = (R().rewildMax ?? 0) - p.restored;
        heal = Math.min(heal * REWILD, Math.max(0, room));
        if (heal <= 1e-9) continue;
        p.restored += heal;
      }
      people.biomass -= heal * cost;
      this.use += (heal * cost) / DT;
      b.engaged = true;
    }
    // the Biosphere Report goes out as each sol ends
    const sol = Math.floor(sim.secs / R().solSeconds);
    p.sol ??= sol;
    if (sol > p.sol) {
      p.sol = sol;
      const h = Math.round(this.health()), last = p.reports.length ? p.reports[p.reports.length - 1] : Math.round(this.start());
      p.reports.push(h);
      const diff = h - last, best = p.reports.length > 1 && h > Math.max(...p.reports.slice(0, -1));
      // the streak of good reports (B or better) running, for the story (counter report-streak, flag report-good)
      const st = sim.story.s, good = goodReport(h); // the home colony's reports (an expedition's don't count)
      const streak = good ? (st?.counters?.['report-streak'] ?? 0) + 1 : 0;
      if (st && !sim.s.expedition) {
        (st.counters ??= {})['report-streak'] = streak;
        if (good && !sim.story.has('report-good')) st.flags.push('report-good');
      }
      sim.emit(`Biosphere Report sent: grade ${reportGrade(h)} · planet health ${h}${diff ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)} this sol)` : ' (no change)'}${best ? ' · best yet' : ''}${streak >= 2 ? ` · ${streak} good reports running` : ''}`, good ? 'info' : 'warn', 'message');
      if (st && !sim.story.has('biosphere-report')) st.flags.push('biosphere-report');
    }
  }

  snapshot(): PlanetSnap {
    const p = this.s;
    return {
      health: this.health(), start: this.start(), restored: p.restored, harm: p.harm, use: this.use,
      scars: p.scars.map((sc) => ({ x: sc.x, z: sc.z, a: sc.a })), reports: [...p.reports],
    };
  }
}
