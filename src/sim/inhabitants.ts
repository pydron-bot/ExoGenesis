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

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
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

  /** Trusted camps share sight of their land. */
  sight(see: (x: number, z: number, r: number) => void) {
    for (const c of this.camps) if (c.trusted && !c.gone) see(c.x, c.z, this.group(c)!.land);
  }

  /** A pack just arrived. Friends send word if the colony has no radar to see it. */
  packArrived(p: Pack, radar: boolean) {
    if (radar) return;
    const friend = this.camps.find((c) => c.trusted && !c.gone);
    if (!friend) return;
    p.announced = true;
    this.sim.emit(`${cap(this.group(friend)!.name)} send word: a pack of ${p.alive} is coming from the ${p.from}`, 'warn', 'warning');
  }

  /** Colony buildings standing on a camp's land. */
  encroaching(c: Camp, g: InhabitantDef) {
    let n = 0;
    for (const b of this.sim.s.buildings) if (Math.hypot(b.x - c.x, b.z - c.z) < g.land) n++;
    return n;
  }

  step() {
    const s = this.sim.s;
    this.camps.forEach((c, i) => {
      const g = this.group(c);
      if (!g) return;
      this.walk(c, g);
      if (c.gone) return;
      // first contact: the camp comes into sight
      if (!c.met && this.seen(c)) {
        c.met = true;
        c.pending = true;
        this.sim.emit(`${g.contactTitle}: ${cap(g.name)} have seen us`, 'warn', 'warning');
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
    if (n > 0) c.regard -= (g.encroach * n * secs) / SOL;
    else {
      const top = c.choice === 'approach' ? 100 : Math.max(g.regard, Math.min(100, c.regard));
      if (c.regard < top) c.regard = Math.min(top, c.regard + (g.recover * secs) / SOL);
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
      this.sim.emit(c.sang ? `${cap(g.name)} trust us again` : `${g.trustTitle}: ${cap(g.name)} trust us`, 'info', 'online');
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
      this.sim.emit(g.approachText, 'info', 'online');
    } else if (choice === 'avoid') this.sim.emit(g.avoidText, 'info');
    else this.leave(c, g.driveText, 'warn');
  }

  /** Debug / tests: set a camp's regard (assessed on the next pass). */
  setRegard(camp: number, v: number) {
    const c = this.camps[camp];
    if (c) c.regard = clamp(v, 0, 100);
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
      };
    });
    return { camps, natives: new Float32Array(out) };
  }
}
