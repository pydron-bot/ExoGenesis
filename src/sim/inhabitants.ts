/**
 * Inhabitants (STORY.md §5): remnants of earlier runs living in camps the region
 * map places (`camps`, each naming a group in content/inhabitants/). Owned by the
 * Sim (src/sim/core.ts), which steps it every tick.
 *
 * They're neutral: predators ignore them and they never fight. What matters is
 * their **regard** for the colony (0–100):
 *   - First contact (E4 "Smoke on the Horizon") happens when the camp first
 *     comes into sight. The player chooses: approach (+regard, and it can keep
 *     rising), keep away, or drive them off (they leave).
 *   - Each colony building on their land wears regard down; with none there it
 *     recovers (up to where it started, or all the way once you approached).
 *   - At the group's trustAt they trust you (E5 "The Keeper's Song" for the
 *     Vell): their runners warn of packs, and they share sight of their land.
 *   - At 0 they abandon the camp and walk out of the region.
 */
import { content } from '../content';
import type { CampDef, InhabitantDef } from '../content/defs';
import type { Sim } from './core';
import { REGION_HALF, TICK_HZ, type Camp, type CampSnap, type ContactChoice, type Native, type Pack } from './types';
import { clamp } from '../util/math';

const SOL = content.colony.solSeconds;
const DT = 1 / TICK_HZ;
/** How far from the centre things may go (read per use: the region's size is set per region). */
const limit = () => REGION_HALF - 6;
/** Regard below this: uneasy (warned once); the warning re-arms above UNEASY + 10. */
const UNEASY = 25;
/** How close to a camp's centre counts as seeing it (first contact). */
const SEE_R = 8;
/** Regard is re-assessed this often (ticks). */
const EVERY = TICK_HZ;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where lived-in camps stand, for placement rules (nothing may be built on one). Sim and HUD both use it. */
export function campSites(camps: { group: string; x: number; z: number; gone: boolean }[]) {
  const out: { x: number; z: number; r: number; name: string }[] = [];
  for (const c of camps) {
    const g = content.inhabitants[c.group];
    if (!g || c.gone) continue;
    out.push({ x: c.x, z: c.z, r: (g.dwellings ? g.ring : 0) + 7, name: g.name });
  }
  return out;
}

export class Inhabitants {
  constructor(private sim: Sim) {}

  private get camps(): Camp[] { return (this.sim.s.camps ??= []); }
  group(c: Camp): InhabitantDef | undefined { return content.inhabitants[c.group]; }

  /** Camps from the region map (a new game, or a save from before inhabitants). */
  init(defs: CampDef[]) {
    const s = this.sim.s;
    s.camps = [];
    for (const d of defs) {
      const g = content.inhabitants[d.group];
      if (!g) continue;
      const yaw = ((d.yaw ?? 0) * Math.PI) / 180;
      const camp: Camp = { group: d.group, x: d.x, z: d.z, yaw, regard: g.regard, met: false, pending: false, trusted: false, gone: false, natives: [] };
      if (g.elder) camp.natives.push(this.spot({ x: d.x, z: d.z, heading: 0, tx: d.x, tz: d.z, wait: 0, elder: true }, camp, g));
      for (let i = 0; i < g.walkers; i++) {
        const a = (i / Math.max(1, g.walkers)) * Math.PI * 2 + this.sim.rnd();
        const r = g.ritual ? g.roam : g.roam * (0.3 + 0.6 * this.sim.rnd());
        const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
        camp.natives.push({ x, z, heading: a, tx: x, tz: z, wait: this.sim.rnd() * 6 });
      }
      s.camps.push(camp);
    }
  }

  /** Saves keep camps; older saves get the region's. */
  load(defs: CampDef[]) {
    const s = this.sim.s;
    if (!s.camps) { this.init(defs); return; }
    s.camps = s.camps.filter((c) => content.inhabitants[c.group]);
  }

  /** Set a story flag (research gates and story events wait on contact-<group>, trust-<group>). */
  private flag(f: string) { const st = this.sim.story.s; if (!st.flags.includes(f)) st.flags.push(f); }

  /** Trusted camps share sight of their land. */
  sight(see: (x: number, z: number, r: number) => void) {
    for (const c of this.camps) if (c.trusted && !c.gone) see(c.x, c.z, this.group(c)!.land);
  }

  /** A pack just arrived. Friends send word if the colony has no radar to see it. */
  packArrived(p: Pack, radar: boolean) {
    if (radar) return;
    const friend = this.camps.find((c) => (c.trusted || (c.watchUntil ?? 0) > this.sim.s.tick) && !c.gone);
    if (!friend) return;
    p.announced = true;
    this.sim.emit(`${cap(this.group(friend)!.name)} send word: a pack of ${p.alive} is coming from the ${p.from}`, 'warn', 'warning');
  }

  /** Colony buildings standing on a camp's land. */
  encroaching(c: Camp, g: InhabitantDef) {
    let n = 0;
    for (const b of this.sim.s.buildings) if (Math.hypot(b.x - c.x, b.z - c.z) < g.land) n += content.buildings[b.kind]?.lure ? 3 : 1;
    return n;
  }

  step() {
    const s = this.sim.s;
    this.camps.forEach((c, i) => {
      const g = this.group(c);
      if (!g) return;
      this.walk(c, g);
      if (c.gone) return;
      this.fight(c, g);
      // first contact: the camp comes into sight
      if (!c.met && this.seen(c)) {
        c.met = true;
        c.pending = true;
        this.sim.emit(`${g.contactTitle}: ${cap(g.name)} have seen us`, 'warn', 'discovery');
        this.flag(`contact-${c.group}`); this.flag('inhabitants-met');
        if (s.people) this.sim.people.say('contact', undefined, { other: g.name });
      }
      if ((s.tick + i) % EVERY) return;
      this.regard(c, g, EVERY * DT);
    });
  }

  private seen(c: Camp) {
    for (const [dx, dz] of [[0, 0], [SEE_R, 0], [-SEE_R, 0], [0, SEE_R], [0, -SEE_R]]) if (this.sim.visible(c.x + dx, c.z + dz)) return true;
    return false;
  }

  private regard(c: Camp, g: InhabitantDef, secs: number) {
    const n = this.encroaching(c, g);
    const k = this.sim.mod('regard');
    if (n > 0) c.regard -= (g.encroach * n * secs * Math.max(0.1, 1 - k / 2)) / SOL;
    else {
      const top = c.choice === 'approach' ? 100 : Math.max(g.regard, Math.min(100, c.regard));
      if (c.regard < top) c.regard = Math.min(top, c.regard + (g.recover * secs * Math.max(0, 1 + k)) / SOL);
    }
    c.regard = clamp(c.regard, 0, 100);
    if (c.regard <= 0) { this.leave(c, g.leaveText, 'bad'); return; }
    if (!c.met) return;
    if (c.regard < UNEASY && !c.uneasy) {
      c.uneasy = true;
      if (c.trusted) c.trusted = false; // trust is lost; it can be earned back
      this.sim.emit(g.uneasyText, 'warn', 'warning');
    } else if (c.uneasy && c.regard > UNEASY + 10) c.uneasy = false;
    if (!c.trusted && c.regard >= g.trustAt && !c.pending) {
      c.trusted = true;
      // the story plays once (the HUD shows it as a card); after that, a log line
      this.sim.emit(c.sang ? `${cap(g.name)} trust us again` : `${g.trustTitle}: ${cap(g.name)} trust us`, 'info', 'friend');
      this.flag(`trust-${c.group}`);
      if (this.sim.s.people) this.sim.people.say('trust', undefined, { other: g.name });
      c.sang = true;
    }
  }

  private leave(c: Camp, text: string, level: 'info' | 'warn' | 'bad') {
    if (c.gone) return;
    c.gone = true;
    this.sim.planet.campLost();
    c.trusted = false;
    c.pending = false;
    c.regard = 0;
    this.sim.emit(text, level, 'lost');
    // everyone heads for the nearest edge of the region
    const ex = Math.abs(c.x) > Math.abs(c.z) ? Math.sign(c.x || 1) * (limit() + 4) : c.x;
    const ez = Math.abs(c.x) > Math.abs(c.z) ? c.z : Math.sign(c.z || 1) * (limit() + 4);
    for (const p of c.natives) { p.tx = ex + (p.x - c.x) * 0.5; p.tz = ez + (p.z - c.z) * 0.5; p.wait = 0; p.elder = false; }
  }

  command(camp: number, choice: ContactChoice) {
    const c = this.camps[camp], g = c && this.group(c);
    if (!c || !g || !c.pending) return;
    c.pending = false;
    c.choice = choice;
    if (choice === 'approach') {
      c.regard = clamp(c.regard + g.approach, 0, 100);
      this.sim.emit(g.approachText, 'info', 'friend');
    } else if (choice === 'avoid') this.sim.emit(g.avoidText, 'info', 'message');
    else this.leave(c, g.driveText, 'warn');
  }

  /** Debug / tests: set a camp's regard (assessed on the next pass). */
  setRegard(camp: number, v: number) {
    const c = this.camps[camp];
    if (c) c.regard = clamp(v, 0, 100);
  }

  // ---------- relations: trade, favours, fighting beside us ----------
  /** Why we can't make trade `n` with this camp now (null = we can). */
  tradeProblem(c: Camp, g: InhabitantDef, n: number): string | null {
    const t = g.trades?.[n], s = this.sim.s;
    if (!t) return 'no such trade';
    if (c.gone || !c.met || c.pending) return 'not now';
    if (!c.trusted && this.sim.mod('trade') < 1) return 'they don\'t trust us yet, and we don\'t speak their language (Translation Matrix)';
    if (c.regard < (t.regard ?? 0)) return `they want regard ${t.regard} first`;
    if ((c.tradeAt ?? 0) > s.tick) return `they\'re not ready to trade again yet (${Math.ceil(((c.tradeAt ?? 0) - s.tick) / TICK_HZ)} s)`;
    if (this.have(t.give) < t.giveAmount) return `not enough ${t.give}`;
    return null;
  }
  private have(r: string) {
    const s = this.sim.s;
    return r === 'alloys' ? s.alloys : r === 'isotopes' ? s.isotopes ?? 0 : s.people?.biomass ?? 0;
  }
  private add(r: string, n: number) {
    const s = this.sim.s;
    if (r === 'alloys') s.alloys = Math.max(0, s.alloys + n);
    else if (r === 'isotopes') s.isotopes = Math.max(0, (s.isotopes ?? 0) + n);
    else if (s.people) this.sim.people.debug({ biomass: n });
  }

  /** The Neighbours tab: a trade, or a favour asked of a camp that trusts us. */
  ask(camp: number, act: 'trade' | 'guide' | 'watch' | 'hunters', n = 0) {
    const c = this.camps[camp], g = c && this.group(c), s = this.sim.s;
    if (!c || !g) return;
    const name = cap(g.name);
    if (act === 'trade') {
      const why = this.tradeProblem(c, g, n), t = g.trades?.[n];
      if (why || !t) { this.sim.emit(`Can\'t trade with ${g.name}: ${why}`, 'warn', 'deny'); return; }
      this.add(t.give, -t.giveAmount);
      this.add(t.get, t.getAmount);
      c.regard = clamp(c.regard + 1, 0, 100); // dealing fairly builds a little regard
      c.tradeAt = s.tick + Math.round((g.tradeEvery ?? 90) * TICK_HZ);
      this.sim.emit(`Traded with ${g.name}: ${t.giveAmount} ${t.give} for ${t.getAmount} ${t.get}`, 'info', 'friend', { x: c.x, z: c.z });
      return;
    }
    const cost = act === 'guide' ? g.guideCost : act === 'watch' ? g.watchCost : g.hunterCost;
    if (cost === undefined || (act === 'hunters' && !g.hunters)) { this.sim.emit(`${name} don\'t do that`, 'warn', 'deny'); return; }
    if (!c.trusted || c.gone) { this.sim.emit(`${name} won\'t do us favours until they trust us`, 'warn', 'deny'); return; }
    if ((c.helpAt ?? 0) > s.tick) { this.sim.emit(`${name} helped us lately: ask again in ${Math.ceil(((c.helpAt ?? 0) - s.tick) / TICK_HZ)} s`, 'warn', 'deny'); return; }
    c.regard = clamp(c.regard - cost, 0, 100);
    c.helpAt = s.tick + Math.round((g.helpEvery ?? 240) * TICK_HZ);
    if (act === 'guide') {
      this.sim.reveal(c.x, c.z, g.guideReveal ?? 80);
      this.sim.emit(g.guideText || `${name} show us their land`, 'info', 'friend', { x: c.x, z: c.z });
    } else if (act === 'watch') {
      c.watchUntil = s.tick + Math.round(SOL * TICK_HZ);
      this.sim.story.effect({ kind: 'boost', stat: 'warning', amount: 30, seconds: SOL, text: `${name}: lookouts` });
      this.sim.emit(g.watchText || `${name} keep watch for us`, 'info', 'friend');
    } else {
      const free = c.natives.filter((p) => !p.elder && p.hunt === undefined).slice(0, g.hunters ?? 0);
      for (const p of free) { p.hunt = s.tick + Math.round((g.hunterSeconds ?? 60) * TICK_HZ); p.cd = this.sim.rnd(); }
      this.sim.emit(g.hunterText || `${free.length} of ${g.name} come to fight beside us`, 'info', 'friend', { x: c.x, z: c.z });
    }
  }

  /** A hunter out for the colony: to the predator nearest our buildings, and strike it; home when their time is up. */
  private hunt(p: Native, c: Camp, g: InhabitantDef) {
    const sim = this.sim, s = sim.s;
    if (s.tick >= (p.hunt ?? 0)) { p.hunt = undefined; p.cd = undefined; this.spot(p, c, g); return; }
    p.cd = Math.max(0, (p.cd ?? 0) - DT);
    const reach = g.hunterRange ?? 14;
    if (p.cd <= 0 && sim.nativeStrike(p.x, p.z, reach, g.hunterDamage ?? 10, g.hunterWeapon)) { p.cd = g.hunterCooldown ?? 1.4; return; }
    // where to go: the predator closest to one of our buildings, or stand by the Core
    if ((s.tick + c.natives.indexOf(p)) % 5 === 0) {
      let best: { x: number; z: number } | null = null, bd = 70;
      for (const h of s.hostiles) {
        if (h.relic || h.nest !== undefined || h.under) continue;
        for (const b of s.buildings) { const d = Math.hypot(b.x - h.x, b.z - h.z); if (d < bd) { bd = d; best = h; } }
      }
      const core = s.buildings.find((b) => b.kind === 'core') ?? c;
      const k = c.natives.indexOf(p) * 1.7, t = best ?? { x: core.x + Math.cos(k) * 14, z: core.z + Math.sin(k) * 14 };
      p.tx = t.x; p.tz = t.z;
    }
    if (Math.hypot(p.tx - p.x, p.tz - p.z) > reach * 0.6) this.toward(p, p.tx, p.tz, g.speed * 2.6 * DT);
  }

  /** A trusted camp that defends its land strikes predators that come onto it. */
  private fight(c: Camp, g: InhabitantDef) {
    if (!g.defends || !c.trusted) return;
    c.dcd = Math.max(0, (c.dcd ?? 0) - DT);
    if (c.dcd > 0 || !c.natives.length) return;
    const from = c.natives[(this.sim.s.tick >> 3) % c.natives.length];
    if (this.sim.nativeStrike(c.x, c.z, g.land, (g.hunterDamage ?? 10) * 2, g.hunterWeapon, from)) c.dcd = g.hunterCooldown ?? 1.4;
  }

  /** Depots took alloys from (x, z): a deposit on someone's land costs their regard. */
  mined(x: number, z: number, alloys: number) {
    for (const c of this.camps) {
      const g = this.group(c);
      if (!g?.mineHarm || c.gone || Math.hypot(x - c.x, z - c.z) > g.land) continue;
      c.regard = clamp(c.regard - (g.mineHarm * alloys) / 100, 0, 100);
    }
  }

  /** A nest died at (x, z): if it was on someone's land, they're glad of it. */
  nestCleared(x: number, z: number) {
    for (const c of this.camps) {
      const g = this.group(c);
      if (!g?.nestHelp || c.gone || !c.met || Math.hypot(x - c.x, z - c.z) > g.land + 20) continue;
      c.regard = clamp(c.regard + g.nestHelp, 0, 100);
      this.sim.emit(`${cap(g.name)} saw us clear the nest that hunted near their camp`, 'info', 'friend');
    }
  }

  // ---------- moving about ----------
  private spot(p: Native, c: Camp, g: InhabitantDef): Native {
    if (p.elder) {
      // the elder keeps to the fire: a few steps either side of the centre
      const a = this.sim.rnd() * Math.PI * 2;
      p.tx = c.x + Math.cos(a) * 3.5; p.tz = c.z + Math.sin(a) * 3.5;
      p.wait = 6 + this.sim.rnd() * 10;
      return p;
    }
    for (let tries = 0; tries < 8; tries++) {
      const a = this.sim.rnd() * Math.PI * 2, r = (0.25 + 0.75 * Math.sqrt(this.sim.rnd())) * g.roam;
      const x = clamp(c.x + Math.cos(a) * r, -limit(), limit()), z = clamp(c.z + Math.sin(a) * r, -limit(), limit());
      // they keep out of the colony's way
      if (this.sim.s.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 10)) continue;
      p.tx = x; p.tz = z;
      break;
    }
    p.wait = 2 + this.sim.rnd() * 8;
    return p;
  }

  private walk(c: Camp, g: InhabitantDef) {
    const sp = g.speed * DT;
    for (let i = c.natives.length - 1; i >= 0; i--) {
      const p = c.natives[i];
      if (c.gone) {
        this.toward(p, p.tx, p.tz, sp * 1.6);
        if (Math.abs(p.x) > limit() + 2 || Math.abs(p.z) > limit() + 2 || Math.hypot(p.tx - p.x, p.tz - p.z) < 1) c.natives.splice(i, 1);
        continue;
      }
      if (p.hunt !== undefined) { this.hunt(p, c, g); continue; }
      if (g.ritual && !p.elder) {
        // the loop: always walking the circle round the centre
        const a = Math.atan2(p.z - c.z, p.x - c.x) + (sp / g.roam);
        p.tx = c.x + Math.cos(a) * g.roam; p.tz = c.z + Math.sin(a) * g.roam;
        this.toward(p, p.tx, p.tz, sp);
        continue;
      }
      if (Math.hypot(p.tx - p.x, p.tz - p.z) < 0.5) {
        p.wait -= DT;
        if (p.wait <= 0) this.spot(p, c, g);
        continue;
      }
      this.toward(p, p.tx, p.tz, p.elder ? sp * 0.6 : sp);
    }
  }

  private toward(p: Native, tx: number, tz: number, step: number) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const k = Math.min(1, step / d);
    p.x += dx * k; p.z += dz * k;
    const want = Math.atan2(dx, dz);
    let dh = want - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    p.heading += dh * 0.2;
  }

  // ---------- snapshot ----------
  snapshot(): { camps: CampSnap[]; natives: Float32Array } {
    const out: number[] = [];
    const camps = this.camps.map((c, i) => {
      const g = this.group(c)!;
      for (const p of c.natives) if (this.sim.visible(p.x, p.z)) out.push(p.x, p.z, p.heading, i, p.elder ? 1 : 0);
      return {
        group: c.group, x: c.x, z: c.z, yaw: c.yaw, regard: c.regard, met: c.met, pending: c.pending,
        choice: c.choice ?? null, trusted: c.trusted, gone: c.gone, encroaching: g ? this.encroaching(c, g) : 0,
        tradeIn: Math.max(0, ((c.tradeAt ?? 0) - this.sim.s.tick) / TICK_HZ), helpIn: Math.max(0, ((c.helpAt ?? 0) - this.sim.s.tick) / TICK_HZ),
        watch: Math.max(0, ((c.watchUntil ?? 0) - this.sim.s.tick) / TICK_HZ), hunting: c.natives.filter((p) => p.hunt).length,
        canTrade: !c.gone && c.met && !c.pending && (c.trusted || this.sim.mod('trade') >= 1),
      };
    });
    return { camps, natives: new Float32Array(out) };
  }
}
