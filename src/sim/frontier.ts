/**
 * The frontier (DESIGN §4 "Persistent territory", inside one region): the colony's outlying holdings come under
 * escalating, telegraphed threats, so the player has to go back out to them, and standing orders let a holding
 * partly look after itself. Owned by the Sim (src/sim/core.ts), checked once a second (campaign only).
 *
 * - A **holding** is every finished building (walls aside) at least `holdFrom` from the Command Core, grouped by
 *   compass sector ("the north-east holding").
 * - The **director**: from `frontierFrom` seconds after landing, every `frontierEvery` (± jitter) once the last threat
 *   is over, it picks a holding (the one furthest from our combat units, a little at random) and a threat:
 *     - a **migration**: a big pack from the edge of the region beyond the holding, straight at it;
 *     - a **relic surge** (the region has relic grids): sentinels break the surface beside the holding;
 *     - a **raid** (a camp we've met holds a grudge: regard under 30): their people come for our stores. Not a fight:
 *       if the holding has guards (combat units, a powered turret) they turn back; if not, they take alloys and
 *       biomass and wreck a building's systems.
 *   Each is **telegraphed**: a warning in the log, a countdown under GOALS and a marker on the holding, `frontierWarn`
 *   seconds ahead (more with the `warning` modifier: Seismic Listening, the Vell's lookouts, the Choir's sweeps).
 *   Each threat is bigger than the last.
 * - **Standing orders**, per holding: Hold (nothing extra), Muster (idle combat units go out to it when a threat is
 *   announced), Fortify (needs the `fortify` ability: its buildings take less damage and its turrets hit harder while a
 *   threat is on it) and Evacuate (its workers stay away until the threat is over).
 */
import { content } from '../content';
import type { Sim } from './core';
import { compass } from './rules';
import { REGION_HALF, TICK_HZ, type Building } from './types';

export type StandingOrder = 'hold' | 'muster' | 'fortify' | 'evacuate';
export const ORDERS: Record<StandingOrder, { name: string; help: string }> = {
  hold: { name: 'Hold', help: 'Nothing extra: its own turrets and people.' },
  muster: { name: 'Muster', help: 'Idle combat units go out to it when a threat is announced.' },
  fortify: { name: 'Fortify', help: 'While a threat is on it, its buildings take 40% less damage and its turrets hit 25% harder. Needs Garrison Doctrine.' },
  evacuate: { name: 'Evacuate', help: 'While a threat is on it, the people who work there stay away.' },
};
export type ThreatKind = 'migration' | 'relic' | 'raid';
const KIND_TEXT: Record<ThreatKind, string> = { migration: 'a fauna migration', relic: 'a relic surge', raid: 'a raid' };
const KIND_NAME: Record<ThreatKind, string> = { migration: 'Migration', relic: 'Relic surge', raid: 'Raid' };

export interface Threat {
  kind: ThreatKind;
  /** The holding's compass sector, and where it was when the threat was announced. */
  sector: string;
  x: number;
  z: number;
  /** The tick it strikes; then live until it's over. */
  at: number;
  live: boolean;
  size: number;
  /** A migration's pack id; a raid's camp index. */
  pack?: number;
  camp?: number;
  /** Hostile ids of a relic surge. */
  ids?: number[];
}
export interface FrontierState {
  /** Threats so far (they grow), the tick the next may come, the one under way. */
  n: number;
  next: number;
  threat: Threat | null;
  orders: Record<string, StandingOrder>;
}
export interface Holding { sector: string; name: string; x: number; z: number; ids: number[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const T = () => content.threats;
const holdFrom = () => T().holdFrom ?? 55;

export class Frontier {
  constructor(private sim: Sim) {}

  get s(): FrontierState {
    return (this.sim.s.frontier ??= { n: 0, next: Math.round((T().frontierFrom ?? 1500) * TICK_HZ), threat: null, orders: {} });
  }

  /** The colony's outlying holdings right now. */
  holdings(): Holding[] {
    const S = this.sim.s, core = S.buildings.find((b) => b.kind === 'core') ?? { x: 0, z: 0 };
    const by = new Map<string, Building[]>();
    for (const b of S.buildings) {
      const d = content.buildings[b.kind];
      if (!d || b.progress < 1 || d.role === 'wall' || d.role === 'gate' || b.kind === 'core') continue;
      if (Math.hypot(b.x - core.x, b.z - core.z) < holdFrom()) continue;
      const k = compass(b.x - core.x, b.z - core.z);
      by.set(k, [...(by.get(k) ?? []), b]);
    }
    return [...by].map(([sector, bs]) => ({
      sector, name: `${sector} holding`, ids: bs.map((b) => b.id),
      x: bs.reduce((m, b) => m + b.x, 0) / bs.length, z: bs.reduce((m, b) => m + b.z, 0) / bs.length,
    }));
  }
  /** Which holding a building belongs to (its sector), if any. */
  sectorOf(b: { x: number; z: number; kind: string }): string | null {
    const core = this.sim.s.buildings.find((x) => x.kind === 'core') ?? { x: 0, z: 0 };
    const d = content.buildings[b.kind];
    if (!d || b.kind === 'core' || d.role === 'wall' || d.role === 'gate' || Math.hypot(b.x - core.x, b.z - core.z) < holdFrom()) return null;
    return compass(b.x - core.x, b.z - core.z);
  }
  order(sector: string): StandingOrder { return this.s.orders[sector] ?? 'hold'; }

  /** Is a threat announced or under way at this building's holding, with this standing order? */
  private on(b: { x: number; z: number; kind: string }, o: StandingOrder) {
    const t = this.s.threat;
    if (!t) return false;
    const k = this.sectorOf(b);
    return k === t.sector && this.order(k) === o;
  }
  /** Fortify: damage a building takes, and a turret's damage. */
  harm(b: Building) { return this.on(b, 'fortify') ? 0.6 : 1; }
  fire(b: Building) { return this.on(b, 'fortify') ? 1.25 : 1; }
  /** Evacuate: no one goes to work at (or stays in) this building. */
  evacuated(b: { x: number; z: number; kind: string } | undefined) { return !!b && this.on(b, 'evacuate'); }

  /** The player sets a holding's standing order. */
  command(sector: string, order: StandingOrder) {
    if (!(order in ORDERS)) return;
    if (order === 'fortify' && this.sim.mod('fortify') < 1) { this.sim.emit('Fortify needs research: Garrison Doctrine', 'warn', 'deny'); return; }
    this.s.orders[sector] = order;
    this.sim.emit(`${cap(sector)} holding: standing order ${ORDERS[order].name}`, 'info', 'confirm');
  }

  /** Peaceful play tests: no frontier threats. */
  hold() { this.s.next = Number.MAX_SAFE_INTEGER; }

  step() {
    const sim = this.sim, S = sim.s;
    if (S.tick % TICK_HZ || S.players) return;
    const f = this.s, t = f.threat;
    if (t && !t.live) {
      if (S.tick >= t.at) this.strike(t);
      return;
    }
    if (t?.live) { this.check(t); return; }
    if (S.tick < f.next) return;
    const hs = this.holdings();
    if (!hs.length) { f.next = S.tick + 30 * TICK_HZ; return; }
    // the holding furthest from our army (where it hurts), a little at random
    const us = sim.units.filter((u) => !u.team);
    const cx = us.length ? us.reduce((m, u) => m + u.x, 0) / us.length : 0, cz = us.length ? us.reduce((m, u) => m + u.z, 0) / us.length : 0;
    const h = [...hs].sort((a, b) => Math.hypot(b.x - cx, b.z - cz) * (0.7 + sim.rnd() * 0.6) - Math.hypot(a.x - cx, a.z - cz) * (0.7 + sim.rnd() * 0.6))[0];
    this.announce(h, this.pickKind(h));
  }

  private pickKind(h: Holding): { kind: ThreatKind; camp?: number } {
    const sim = this.sim, S = sim.s;
    const camp = (S.camps ?? []).findIndex((c) => c.met && !c.gone && (c.regard < 30 || sim.story.has(`${c.group}-grievance`)));
    if (camp >= 0 && sim.rnd() < 0.6) return { kind: 'raid', camp };
    const relics = (sim.s.relics && Object.keys(sim.s.relics.grids).length) || 0;
    if (relics && this.s.n >= 1 && sim.rnd() < 0.35) return { kind: 'relic' };
    void h;
    return { kind: 'migration' };
  }

  private announce(h: Holding, k: { kind: ThreatKind; camp?: number }) {
    const sim = this.sim, S = sim.s, f = this.s;
    const lead = (T().frontierWarn ?? 90) + Math.max(0, sim.mod('warning'));
    const n = f.n;
    const size = k.kind === 'relic' ? Math.min(4, 1 + Math.floor(n / 2)) : Math.round(((T().frontierSize ?? 6) + (T().frontierGrowth ?? 3) * n) * (sim.regionPackScale()));
    f.threat = { kind: k.kind, sector: h.sector, x: h.x, z: h.z, at: S.tick + Math.round(lead * TICK_HZ), live: false, size: Math.max(1, size), camp: k.camp };
    f.n++;
    const who = k.kind === 'raid' && k.camp !== undefined ? ` by ${content.inhabitants[S.camps![k.camp].group]?.name ?? 'the inhabitants'}` : '';
    sim.emit(`Frontier: ${KIND_TEXT[k.kind]}${who} is coming for the ${h.name} in ${Math.round(lead)} s`, 'bad', 'alarm', { x: h.x, z: h.z });
    const label = `${KIND_NAME[k.kind]}: ${h.name}`;
    sim.story.effect({ kind: 'countdown', timer: 'frontier', amount: lead, text: label });
    if (S.people) sim.people.say('threat', undefined, { other: h.name });
    sim.story.effect({ kind: 'clearWaypoint', site: 'frontier' });
    const st = sim.story.s;
    st.marks = (st.marks ?? []).filter((m) => m.site !== 'frontier');
    st.marks.push({ site: 'frontier', x: h.x, z: h.z, text: label });
    // standing order Muster: idle combat units go out to it
    if (this.order(h.sector) === 'muster') {
      const idle = sim.units.filter((u) => !u.team && u.order.kind === 'idle' && !content.units[u.unit]?.rescues);
      if (idle.length) {
        sim.command({ type: 'order', ids: idle.map((u) => u.id), x: h.x, z: h.z });
        sim.emit(`Standing order Muster: ${idle.length} unit${idle.length > 1 ? 's' : ''} head out to the ${h.name}`, 'info', 'confirm');
      }
    }
    if (this.order(h.sector) === 'evacuate') sim.emit(`Standing order Evacuate: the ${h.name}'s workers are coming in`, 'info', 'confirm');
  }

  /** The countdown is up: the threat arrives. */
  private strike(t: Threat) {
    const sim = this.sim, S = sim.s;
    t.live = true;
    const core = S.buildings.find((b) => b.kind === 'core') ?? { x: 0, z: 0 };
    if (t.kind === 'migration') {
      // from the region's edge, beyond the holding
      const dx = t.x - core.x, dz = t.z - core.z, L = Math.max(1, Math.hypot(dx, dz)), lim = REGION_HALF - 10;
      const k = Math.min(lim / Math.max(Math.abs(dx / L), Math.abs(dz / L)), L + 70);
      const sx = core.x + (dx / L) * k, sz = core.z + (dz / L) * k;
      const before = S.packs.length;
      const brutes = Math.floor(t.size / 5), spit = Math.floor(t.size / 6);
      sim.spawnAt('swarmer', t.size - brutes - spit, sx, sz);
      const pack = S.packs[before];
      if (pack) {
        if (brutes && content.units.brute) for (const h of this.spawnInto('brute', brutes, sx, sz, pack.id)) void h;
        if (spit && content.units.spitter) for (const h of this.spawnInto('spitter', spit, sx, sz, pack.id)) void h;
        pack.announced = true;
        t.pack = pack.id;
      }
      sim.emit(`Frontier: the migration reaches the ${t.sector} holding`, 'bad', 'warning', { x: t.x, z: t.z });
    } else if (t.kind === 'relic') {
      t.ids = sim.surge(t.x, t.z, t.size);
      sim.emit(`Frontier: relic sentinels break the surface by the ${t.sector} holding`, 'bad', 'alarm', { x: t.x, z: t.z });
    } else this.raid(t);
    sim.story.effect({ kind: 'stopCountdown', timer: 'frontier' });
  }

  /** Extra hostiles of another kind joining a pack (spawnAt makes its own pack). */
  private spawnInto(unit: string, n: number, x: number, z: number, pack: number) {
    const S = this.sim.s, before = S.packs.length;
    this.sim.spawnAt(unit, n, x, z);
    const extra = S.packs.splice(before, 1)[0];
    const p = S.packs.find((q) => q.id === pack);
    const moved = S.hostiles.filter((h) => extra && h.pack === extra.id);
    for (const h of moved) h.pack = pack;
    if (p) { p.alive += moved.length; p.size += moved.length; }
    return moved;
  }

  /** A raid: turned back by guards, or they take what they came for. */
  private raid(t: Threat) {
    const sim = this.sim, S = sim.s, c = t.camp !== undefined ? S.camps?.[t.camp] : undefined, g = c && content.inhabitants[c.group];
    const name = g ? cap(g.name) : 'Raiders';
    const guards = sim.units.some((u) => !u.team && content.units[u.unit]?.damage && Math.hypot(u.x - t.x, u.z - t.z) < 35)
      || S.buildings.some((b) => b.powered && content.buildings[b.kind]?.fireRange && Math.hypot(b.x - t.x, b.z - t.z) < 40);
    if (guards || !c || c.gone) {
      if (c && !c.gone) c.regard = Math.max(0, c.regard - 3);
      sim.emit(`${name} raiders saw our guards at the ${t.sector} holding and turned back`, 'info', 'packCleared', { x: t.x, z: t.z });
      this.over(true);
      return;
    }
    const alloys = Math.min(Math.floor(S.alloys), 60 + 20 * this.s.n), bio = Math.min(Math.floor(S.people?.biomass ?? 0), 40);
    S.alloys -= alloys;
    if (S.people) S.people.biomass -= bio;
    const hs = this.holdings().find((h) => h.sector === t.sector);
    const b = hs ? S.buildings.find((x) => hs.ids.includes(x.id)) : undefined;
    if (b) b.hp = Math.max(1, b.hp - content.buildings[b.kind].hp * 0.35);
    c.regard = Math.min(100, c.regard + 4); // a grudge partly settled
    sim.emit(`${name} raided the ${t.sector} holding: ${alloys} alloys and ${bio} biomass gone${b ? `, the ${content.buildings[b.kind].name} wrecked inside` : ''}. Guards would have turned them back.`, 'bad', 'alarm', { x: t.x, z: t.z });
    this.over(false);
  }

  /** A live threat: over when the migration's pack or the surge's sentinels are gone. */
  private check(t: Threat) {
    const S = this.sim.s;
    const left = t.kind === 'migration' ? S.hostiles.some((h) => h.pack === t.pack) : S.hostiles.some((h) => t.ids?.includes(h.id));
    if (left) return;
    const held = !!this.holdings().find((h) => h.sector === t.sector);
    this.sim.emit(held ? `Frontier: the ${t.sector} holding held` : `Frontier: the ${t.sector} holding is lost`, held ? 'info' : 'bad', held ? 'packCleared' : 'lost', { x: t.x, z: t.z });
    if (held && S.people) { for (const c of S.people.colonists) c.stance = Math.min(100, c.stance + 1); this.sim.people.say('held', undefined, { other: `${t.sector} holding` }); }
    this.over(held);
  }

  private over(_held: boolean) {
    const sim = this.sim, f = this.s;
    f.threat = null;
    const st = sim.story.s;
    st.marks = (st.marks ?? []).filter((m) => m.site !== 'frontier');
    sim.story.effect({ kind: 'stopCountdown', timer: 'frontier' });
    f.next = sim.s.tick + Math.round(((T().frontierEvery ?? 420) + (sim.rnd() * 2 - 1) * (T().frontierJitter ?? 90)) * TICK_HZ);
  }

  snapshot() {
    const f = this.s, S = this.sim.s, t = f.threat;
    return {
      holdings: this.holdings().map((h) => ({ sector: h.sector, name: h.name, x: h.x, z: h.z, ids: h.ids, order: this.order(h.sector) })),
      threat: t ? { kind: t.kind, sector: t.sector, x: t.x, z: t.z, size: t.size, left: t.live ? -1 : Math.max(0, (t.at - S.tick) / TICK_HZ) } : null,
      fortify: this.sim.mod('fortify') >= 1,
    };
  }
}
