/**
 * The people system: the cryo bank's embryos, growth pods, colonists, food,
 * housing, jobs, mood and Trust. Owned by the Sim (src/sim/core.ts), which calls
 * `step()` every tick and asks it for power draw, staffing bonuses and
 * predator targets.
 *
 * Time: 1 sol = 1 year (content/rules/colony.json solSeconds), so colonists age
 * and generations turn over while you play. Numbers live in
 * content/rules/people.json; every "/sol" rate there is per game year.
 *
 * Colonists are never ordered around. They live in a civic building, walk to
 * the job that suits them in working hours, shelter when predators come, and
 * have opinions: wellbeing (are they all right?) and stance (do they accept the
 * AI?). Stance sorts them into blocs, and the blocs want different policies.
 */
import { content } from '../content';
import { SPECIALTIES, type BuildingDef, type Specialty } from '../content/defs';
import type { Sim } from './core';
import { hourAt } from './daylight';
import { GIVEN, LINEAGES, TRAITS, type Trait } from './names';
import {
  AT_RIDE, BLOCS, CURRICULA, POLICIES, blocOf,
  type Bloc, type Colonist, type ColonistSnap, type PeopleCommand, type PeopleSnap, type PeopleState, type Pod, type PolicyKey,
} from './people-types';
import { TICK_HZ, type Building } from './types';

const P = content.people;
const SOL = content.colony.solSeconds;
const DEFS = content.buildings;
const DT = 1 / TICK_HZ;
/** Colonists outdoors run for shelter from predators this close. */
const SHELTER_R = 30;
/** Predators this close to any building or anyone outdoors put the colony on alert (everyone stays in)... */
const ALERT_R = 45;
/** ...until none have been within this range for ALERT_HOLD seconds. */
const ALERT_CLEAR_R = 60;
const ALERT_HOLD = 10;
/** Pods can be stopped (embryo back to the bank) only this early. */
const UNPOD_BEFORE = 0.25;
const SHIFTS = { short: [8, 16], standard: [7, 18], long: [6, 21] } as const;
/** The boost each leading bloc gives (names shown in the HUD and the log). */
export const BOOST: Record<Bloc, string> = { autonomist: 'Wardens', partner: 'Symbiosis', devoted: 'Vigil' };
const LEAD_NEWS: Record<Bloc, string> = {
  autonomist: 'Autonomists lead the colony · Wardens: people fight back from the buildings they are in, and take less harm outdoors',
  partner: 'Partners lead the colony · Symbiosis: colonists at work add half as much again to their buildings',
  devoted: 'The Devoted lead the colony · Vigil: drones work faster and buildings draw less power',
};

/** Wellbeing each bloc gets from each policy choice. */
const LIKES: Record<'council' | 'oversight', Record<string, Record<Bloc, number>>> = {
  council: {
    directive: { devoted: 10, partner: -2, autonomist: -14 },
    joint: { devoted: -2, partner: 6, autonomist: -2 },
    assembly: { devoted: -10, partner: 0, autonomist: 10 },
  },
  oversight: {
    light: { devoted: -4, partner: 0, autonomist: 6 },
    standard: { devoted: 0, partner: 0, autonomist: -3 },
    total: { devoted: 6, partner: -4, autonomist: -15 },
  },
};
/** Stance drift per sol from policy. */
const PULL = { council: { directive: 3, joint: 0.5, assembly: -3 }, oversight: { light: 1, standard: 0, total: -2 } } as const;

/** Grief fades this much faster while a Memorial stands. */
const MEMORIAL_GRIEF = 1.75;
/** A Med Bay caring for someone's home multiplies their yearly chance of dying of old age by this. */
const MEDBAY_AGEING = 0.5;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const def = (b: Building): BuildingDef => DEFS[b.kind];
const bodyR = (b: Building) => def(b).clearance / 2;
const lineName = (l: number) => LINEAGES[l % LINEAGES.length];

export class People {
  /** Staffing multiplier per building id, refreshed every second. */
  private mults = new Map<number, number>();
  /** Why each colonist feels as they do (refreshed with the mood). */
  private why = new Map<number, [string, number][]>();
  private alert = false;
  private alertQuiet = 0;
  private lostPending = 0;
  private lostAt = 0;
  private packsSeen = 0;
  private strikeSaid = 0;
  /** Last cause of a loss: decides the game-over reason. */
  private lastLoss: 'cryo' | 'people' = 'cryo';
  private food = { made: 0, eaten: 0 };
  /** Comfort from buildings with an aura (Med Bays, Memorials), refreshed every second. */
  private auras: { b: Building; r: number; v: number; label: string; med: boolean }[] = [];
  /** Memorials standing (grief fades faster). */
  private memorials = 0;
  /** Injured colonists a Med Bay has stabilised this second (their clock stops). */
  private stable = new Set<number>();
  /** Med Bay id → seconds towards bringing the next injured person in. */
  private treat = new Map<number, number>();

  constructor(private sim: Sim) {}

  get s(): PeopleState { return this.sim.s.people!; }
  private get secs() { return this.sim.secs; }

  // ---------- setup ----------
  init() {
    const n = clamp(P.lineages, 2, LINEAGES.length);
    const bank = Array.from({ length: n }, (_, i) => Math.floor(P.embryos / n) + (i < P.embryos % n ? 1 : 0));
    this.sim.s.people = {
      bank, lossAcc: 0, biomass: P.startBiomass, colonists: [], pods: [],
      policies: { hours: 'standard', rations: 'normal', oversight: 'standard', council: 'joint' },
      memorial: [], grief: 0, fear: 0, hungry: 0, breakthrough: 0, surge: 0, unrest: 0, gone: [], grown: 0, births: 0, departed: 0,
    };
    this.reset();
  }

  /** A save from before people existed: start the bank, scaled by how it's held up. */
  load() {
    if (!this.sim.s.people) {
      this.init();
      const k = clamp(this.sim.s.cryo / 100, 0, 1);
      this.s.bank = this.s.bank.map((n) => Math.round(n * Math.max(k, P.cryoSafe / 100)));
    }
    const s = this.s;
    s.colonists = s.colonists.filter((c) => !c.specialty || SPECIALTIES.includes(c.specialty));
    this.reset();
  }

  private reset() {
    this.mults.clear(); this.why.clear();
    this.alert = false; this.lostPending = 0; this.strikeSaid = 0;
    this.packsSeen = this.sim.s.stats.packsBeaten;
  }

  // ---------- queries used by the Sim ----------
  embryos() { return this.s.bank.reduce((m, n) => m + n, 0); }
  age(c: Colonist) { return (this.secs - c.born) / SOL; }
  /** The first colonist out of a pod (an older save without the record: the earliest pod-born one still here). */
  first(): { id: number; name: string } | undefined {
    const s = this.s;
    if (!s.first) { const c = s.colonists.filter((x) => x.origin === 'pod').sort((a, b) => a.id - b.id)[0]; if (c) s.first = { id: c.id, name: c.name }; }
    return s.first;
  }
  /** Average acceptance of the AI among adults (null with no adults). */
  acceptance(): number | null {
    const ad = this.s.colonists.filter((c) => this.adult(c));
    return ad.length ? ad.reduce((m, c) => m + c.stance, 0) / ad.length : null;
  }
  adult(c: Colonist) { return this.age(c) >= P.adultAge; }

  /** Extra MW a building wants for its pods. */
  podDraw(b: Building) {
    let n = 0;
    for (const p of this.s.pods) if (p.b === b.id) n++;
    return n * P.podMW;
  }

  /** Output multiplier from the staff working there right now (1 = unstaffed). */
  mult(b: Building) { return this.mults.get(b.id) ?? 1; }

  /** Colonists predators can reach (outdoors). */
  outdoors(): Colonist[] { return this.s.colonists.filter((c) => c.at === -1); }

  // ---------- the injured and the medevac ----------
  /** How long someone lying injured has (people rules). */
  private downFor() { return P.downSeconds ?? 60; }
  /** Colonists lying injured, outdoors. */
  injured(): Colonist[] { return this.s.colonists.filter((c) => c.down !== undefined && c.at === -1); }
  /** A medevac takes them aboard: they're safe (and stop getting worse) while they ride. */
  board(c: Colonist, unit: number) {
    c.at = AT_RIDE; c.ride = unit; c.goal = -1; c.path = undefined;
  }
  /** Riders follow their medevac about (for the roster and the camera). */
  carry(ids: number[], x: number, z: number) {
    for (const c of this.s.colonists) if (ids.includes(c.id)) { c.x = x; c.z = z; }
  }
  /** A medevac brings its riders in to a building: they're treated, and remember who came for them. */
  admit(ids: number[], b: Building) {
    let n = 0;
    for (const c of this.s.colonists) {
      if (!ids.includes(c.id) || c.at !== AT_RIDE) continue;
      c.at = b.id; c.x = b.x; c.z = b.z; c.ride = undefined; c.down = undefined; c.goal = -1; c.path = undefined;
      c.hp = Math.max(c.hp, def(b)?.role === 'medbay' ? this.maxHp(c) : P.colonistHp * 0.5);
      c.stance = clamp(c.stance + 4, 0, 100);
      n++;
    }
    return n;
  }
  /** The medevac was lost with them aboard: back on the ground, worse off. */
  spill(ids: number[], x: number, z: number) {
    for (const c of this.s.colonists) {
      if (!ids.includes(c.id) || c.at !== AT_RIDE) continue;
      const a = this.sim.rnd() * Math.PI * 2;
      c.at = -1; c.ride = undefined; c.x = x + Math.sin(a) * 1.5; c.z = z + Math.cos(a) * 1.5;
      c.down = Math.min(c.down ?? Infinity, Math.max(15, this.downFor() * 0.5));
    }
  }

  colonist(id: number) { return this.s.colonists.find((c) => c.id === id); }
  private maxHp(c: Colonist) { return P.colonistHp * (c.traits.includes('frail') ? 0.6 : 1); }

  // ---------- Med Bays and Memorials ----------
  /** Once a second: comfort auras, and each powered Med Bay stabilises and brings in the injured in its Range. */
  private care(dt: number) {
    this.auras = []; this.memorials = 0; this.stable.clear();
    const down = this.injured();
    for (const b of this.sim.s.buildings) {
      const d = def(b);
      if (!d || b.progress < 1 || !b.powered) continue;
      if (d.role === 'memorial') this.memorials++;
      if (d.aura && d.range) this.auras.push({ b, r: d.range, v: d.aura, med: d.role === 'medbay', label: d.role === 'medbay' ? 'Medical care' : d.role === 'memorial' ? 'Memorial' : d.name });
      if (d.role !== 'medbay' || !d.range) continue;
      const near = down.filter((c) => !this.stable.has(c.id) && Math.hypot(c.x - b.x, c.z - b.z) <= d.range!);
      if (!near.length) { this.treat.delete(b.id); continue; }
      for (const c of near) this.stable.add(c.id);
      let t = (this.treat.get(b.id) ?? 0) + dt * this.mult(b);
      if (t >= (d.treatSeconds ?? 8)) {
        t = 0;
        const c = near.sort((x, y) => (x.down ?? 0) - (y.down ?? 0))[0]; // the worst off first
        c.at = b.id; c.x = b.x; c.z = b.z; c.down = undefined; c.goal = -1; c.path = undefined;
        c.hp = this.maxHp(c);
        c.stance = clamp(c.stance + 3, 0, 100);
        this.stable.delete(c.id);
        this.emit(`${d.name}: ${c.name} was brought in on a stretcher`, 'info', 'online');
      }
      this.treat.set(b.id, t);
    }
  }

  /** Is this spot within the care of a powered Med Bay? */
  private medCare(p: { x: number; z: number }) {
    return this.auras.some((a) => a.med && Math.hypot(a.b.x - p.x, a.b.z - p.z) <= a.r);
  }

  /** Biomass storage. */
  storage() {
    let m = P.baseStorage;
    for (const b of this.sim.s.buildings) if (b.progress >= 1) m += def(b)?.biomassStorage ?? 0;
    return m;
  }

  // ---------- events from the Sim ----------
  /** The cryo bank's integrity this tick: below the safe level, embryos die. */
  cryo(integrity: number) {
    const s = this.s;
    if (integrity >= P.cryoSafe) return;
    const rate = P.embryoLoss * (1 - integrity / Math.max(1e-6, P.cryoSafe));
    s.lossAcc += rate * DT;
    while (s.lossAcc >= 1) {
      s.lossAcc -= 1;
      const total = this.embryos();
      if (total <= 0) { s.lossAcc = 0; break; }
      let r = this.sim.rnd() * total;
      for (let l = 0; l < s.bank.length; l++) {
        if ((r -= s.bank[l]) < 0) { s.bank[l]--; break; }
      }
      this.lostPending++;
      this.lastLoss = 'cryo';
    }
    // the first loss is announced at once, then at most every 20 s (with the running count)
    if (this.lostPending && (this.secs - this.lostAt > 20 || this.embryos() === 0)) {
      const n = this.lostPending;
      this.lostPending = 0; this.lostAt = this.secs;
      this.emit(`Cryo bank too warm: ${n} embryo${n > 1 ? 's' : ''} lost · ${this.embryos()} left${this.embryos() ? '. Restore power!' : ''}`, 'bad', 'alarm');
      this.shock(-Math.min(6, n * 0.5));
      this.s.grief += Math.min(8, n);
    }
  }

  /** A building is gone: its people spill out (hurt), its pods are lost. */
  buildingLost(b: Building, hurt = true) {
    const s = this.s;
    let down = 0;
    for (const p of [...s.pods]) {
      if (p.b !== b.id) continue;
      s.pods.splice(s.pods.indexOf(p), 1);
      this.memorialise(`Unnamed (${lineName(p.lineage)} line)`, p.lineage, 0, `growth pod destroyed`);
      this.emit(`A growth pod was destroyed with the ${def(b).name}. A ${lineName(p.lineage)} child is lost.`, 'bad', 'alarm');
      this.s.grief += 8;
      this.shock(-3);
    }
    for (const c of [...s.colonists]) {
      if (c.home === b.id) c.home = -1;
      if (c.job === b.id) c.job = -1;
      if (c.goal === b.id) { c.goal = -1; c.path = undefined; }
      if (c.at === b.id) {
        const a = this.sim.rnd() * Math.PI * 2;
        c.at = -1; c.x = b.x + Math.sin(a) * (bodyR(b) + 1.5); c.z = b.z + Math.cos(a) * (bodyR(b) + 1.5);
        if (hurt) c.hp -= P.colonistHp * 0.6;
        if (c.hp <= 0) this.kill(c, `killed when the ${def(b).name} fell`);
        else if (hurt) { c.down = this.downFor(); c.goal = -1; c.path = undefined; down++; }
      }
    }
    if (down) this.emit(`${down === 1 ? 'Someone is' : `${down} people are`} lying injured by the ruins of the ${def(b).name}. A Medevac can bring them in: they have about ${Math.round(this.downFor())} s.`, 'bad', 'alarm');
  }

  /** A colonist dies (or leaves). */
  kill(c: Colonist, cause: string, left = false) {
    const s = this.s;
    const i = s.colonists.indexOf(c);
    if (i < 0) return;
    s.colonists.splice(i, 1);
    for (const o of s.colonists) if (o.partner === c.id) o.partner = -1;
    this.memorialise(c.name, c.lineage, Math.floor(this.age(c)), cause);
    this.lastLoss = 'people';
    if (left) { s.departed++; return; }
    this.sim.fxDeath(c.x, c.z);
    s.grief += 12;
    this.emit(`${c.name} (${Math.floor(this.age(c))}) has died: ${cause}`, 'bad', 'lost');
    // deaths the AI might have prevented cost it trust
    if (cause !== 'old age') this.shock(cause.includes('starv') ? -3 : -1.5);
  }

  /** Tests / playtesting: colonists straight out of a pod at the first Civilian Center, biomass, everyone's stance or wellbeing. */
  debug(d: { colonists?: number; biomass?: number; stance?: number; wb?: number }) {
    const s = this.s;
    if (d.biomass) s.biomass = clamp(s.biomass + d.biomass, 0, this.storage());
    const b = this.sim.s.buildings.find((x) => def(x)?.role === 'civic' && x.progress >= 1) ?? this.sim.s.buildings.find((x) => x.kind === 'core');
    for (let i = 0; i < (d.colonists ?? 0) && b; i++) {
      const lineage = this.rarestLine();
      if (lineage < 0) break;
      s.bank[lineage]--;
      const curr = (['charter', 'charter', 'heritage', 'unity'] as const)[i % 4];
      this.decant({ b: b.id, lineage, specialty: SPECIALTIES[i % SPECIALTIES.length], curriculum: curr, progress: 1, dark: 0 }, b);
    }
    for (const c of s.colonists) {
      if (d.stance !== undefined) c.stance = d.stance;
      if (d.wb !== undefined) c.wb = d.wb;
    }
  }

  // ---------- commands ----------
  command(c: PeopleCommand) {
    const s = this.s;
    if (c.type === 'policy') {
      const opts = POLICIES[c.key]?.options as Record<string, string> | undefined;
      if (!opts || !(c.value in opts) || s.policies[c.key] === c.value) return;
      (s.policies as Record<PolicyKey, string>)[c.key] = c.value;
      this.emit(`${POLICIES[c.key].name}: ${opts[c.value]}`, 'info', 'placed');
      return;
    }
    const b = this.sim.s.buildings.find((x) => x.id === c.id);
    if (!b || def(b)?.role !== 'civic' || b.progress < 1) return;
    if (c.type === 'unpod') {
      const ps = s.pods.filter((p) => p.b === b.id);
      const p = ps[ps.length - 1];
      if (!p) return;
      if (p.progress >= UNPOD_BEFORE) { this.emit('Too late to stop that pod: the child is already growing', 'warn', 'deny'); return; }
      s.pods.splice(s.pods.indexOf(p), 1);
      s.bank[p.lineage]++;
      this.emit(`Pod stopped · embryo returned to the cryo bank`, 'info');
      return;
    }
    // grow
    const slots = def(b).pods ?? 0;
    if (s.pods.filter((p) => p.b === b.id).length >= slots) { this.emit('Every growth pod here is in use', 'warn', 'deny'); return; }
    if (!SPECIALTIES.includes(c.specialty) || !(c.curriculum in CURRICULA)) return;
    const lineage = c.lineage !== undefined && c.lineage >= 0 ? c.lineage : this.rarestLine();
    if (lineage < 0 || !(s.bank[lineage] > 0)) { this.emit('No embryos left in the cryo bank', 'warn', 'deny'); return; }
    s.bank[lineage]--;
    s.pods.push({ b: b.id, lineage, specialty: c.specialty, curriculum: c.curriculum, progress: 0, dark: 0 });
    this.emit(`Growth pod started · ${lineName(lineage)} line · ${cap(c.specialty)}, ${CURRICULA[c.curriculum].name} imprint`, 'info', 'placed');
  }

  /** The surviving lineage with the fewest people (living + embryos), to keep diversity up. */
  private rarestLine() {
    const s = this.s, living = this.livingPerLine();
    let best = -1, bn = Infinity;
    s.bank.forEach((n, l) => {
      if (n <= 0) return;
      const tot = n + living[l] * 3;
      if (tot < bn) { bn = tot; best = l; }
    });
    return best;
  }

  private livingPerLine() {
    const a = new Array(this.s.bank.length).fill(0);
    for (const c of this.s.colonists) a[c.lineage] = (a[c.lineage] ?? 0) + 1;
    for (const p of this.s.pods) a[p.lineage] = (a[p.lineage] ?? 0) + 1;
    return a as number[];
  }

  // ---------- tick ----------
  step() {
    const s = this.s, sim = this.sim.s;
    this.stepFood();
    this.stepPods();
    for (const c of [...s.colonists]) {
      if (c.at === AT_RIDE) {
        // their medevac is gone (a save from elsewhere): back on the ground
        if (!this.sim.units.some((u) => u.id === c.ride || u.cargo?.some((v) => v.id === c.ride))) this.spill([c.id], c.x, c.z);
        continue;
      }
      if (c.down !== undefined) {
        if (!this.stable.has(c.id)) c.down -= 1 / TICK_HZ;
        if (c.down <= 0) this.kill(c, 'died of their injuries before help came');
        continue;
      }
      this.walk(c);
    }
    if (sim.tick % TICK_HZ === 0) {
      const dt = 1;
      this.housing();
      if (sim.tick % (TICK_HZ * 5) === 0) this.jobs();
      this.alert = this.underAttack();
      this.care(dt);
      for (const c of s.colonists) this.decide(c);
      this.mood(dt);
      this.staffing();
      this.lifecycle(dt);
      this.politics(dt);
      this.checkLines();
      if (sim.stats.packsBeaten > this.packsSeen) {
        // a pack beaten off with nobody hurt: a little faith in the AI
        this.packsSeen = sim.stats.packsBeaten;
        if (s.colonists.length) this.shock(1);
      }
      if (this.embryos() === 0 && !s.colonists.length && !s.pods.length) this.sim.lose(this.lastLoss);
    }
  }

  private emit(text: string, level: 'info' | 'warn' | 'bad', cue?: Parameters<Sim['emit']>[2]) { this.sim.emit(text, level, cue); }

  /** Everyone's opinion of the AI moves at once (an event they all hear about). */
  private shock(d: number) {
    for (const c of this.s.colonists) c.stance = clamp(c.stance + d * (c.traits.includes('trusting') && d < 0 ? 0.5 : 1), 0, 100);
  }

  private memorialise(name: string, lineage: number, age: number, cause: string) {
    this.s.memorial.push({ name, lineage, age, cause, at: this.secs });
    if (this.s.memorial.length > 200) this.s.memorial.shift();
  }

  // ---------- food ----------
  private stepFood() {
    const s = this.s;
    let made = 0;
    for (const b of this.sim.s.buildings) {
      const d = def(b);
      if (d?.role !== 'farm' || b.progress < 1 || !b.powered) continue;
      made += (d.biomassRate ?? 0) * this.mult(b);
    }
    const r = { lean: 0.75, normal: 1, generous: 1.4 }[s.policies.rations];
    let eaten = 0;
    for (const c of s.colonists) eaten += P.eat * r * (this.adult(c) ? 1 : 0.5);
    const podsFed = s.pods.filter((p) => this.podPowered(p)).length;
    eaten += podsFed * P.podBiomass;
    eaten += this.sim.planet.use; // seed banks (src/sim/planet.ts), last tick
    this.food = { made, eaten };
    s.biomass = clamp(s.biomass + (made - eaten) * DT, 0, this.storage());
    if (s.biomass <= 0 && eaten > made) s.hungry += DT;
    else s.hungry = Math.max(0, s.hungry - DT * 3);
  }

  private podPowered(p: Pod) {
    const b = this.sim.s.buildings.find((x) => x.id === p.b);
    return !!b && b.powered;
  }

  // ---------- growth pods ----------
  private stepPods() {
    const s = this.s;
    for (const p of [...s.pods]) {
      const b = this.sim.s.buildings.find((x) => x.id === p.b);
      if (!b) { s.pods.splice(s.pods.indexOf(p), 1); continue; }
      const ok = b.powered && s.biomass > 0;
      if (!ok) {
        const was = p.dark;
        p.dark += DT;
        if (was < 5 && p.dark >= 5) this.emit(`Growth pod failing: ${b.powered ? 'no biomass' : 'no power'}`, 'bad', 'alarm');
        const grace = P.podGrace * (this.hasMedic(b) || this.medCare(b) ? 1.5 : 1);
        if (p.dark >= grace) {
          s.pods.splice(s.pods.indexOf(p), 1);
          this.memorialise(`Unnamed (${lineName(p.lineage)} line)`, p.lineage, 0, 'growth pod failed');
          this.emit(`A growth pod failed. The ${lineName(p.lineage)} child inside is lost.`, 'bad', 'alarm');
          s.grief += 10;
          this.shock(-4);
          this.lastLoss = 'people';
        }
        continue;
      }
      p.dark = Math.max(0, p.dark - DT * 2);
      p.progress += DT / (P.podSols * SOL);
      if (p.progress >= 1) {
        s.pods.splice(s.pods.indexOf(p), 1);
        this.decant(p, b);
      }
    }
  }

  private hasMedic(b: Building) {
    return this.s.colonists.some((c) => c.job === b.id && c.at === b.id && c.specialty === 'medic');
  }

  private uniqueName(lineage: number) {
    const taken = new Set(this.s.colonists.map((c) => c.name));
    for (let i = 0; i < 20; i++) {
      const n = `${GIVEN[Math.floor(this.sim.rnd() * GIVEN.length)]} ${lineName(lineage)}`;
      if (!taken.has(n)) return n;
    }
    return `${GIVEN[Math.floor(this.sim.rnd() * GIVEN.length)]} ${lineName(lineage)} ${this.s.grown + this.s.births}`;
  }

  private rollTraits(): Trait[] {
    const pool: Trait[] = ['optimist', 'anxious', 'stoic', 'diligent', 'independent', 'trusting'];
    const t: Trait[] = [pool[Math.floor(this.sim.rnd() * pool.length)]];
    if (this.sim.rnd() < 0.35) {
      const u = pool[Math.floor(this.sim.rnd() * pool.length)];
      const clash = (a: Trait, b: Trait) => a === b || (a === 'independent' && b === 'trusting') || (a === 'trusting' && b === 'independent') || (a === 'stoic' && b === 'anxious') || (a === 'anxious' && b === 'stoic');
      if (!clash(t[0], u)) t.push(u);
    }
    // low genetic diversity shows up in the people born from it
    if (this.sim.rnd() < Math.max(0, (60 - this.diversity()) / 100)) t.push('frail');
    return t;
  }

  private spawn(lineage: number, b: Building, extra: Partial<Colonist>): Colonist {
    const s = this.s;
    const traits = this.rollTraits();
    const c: Colonist = {
      id: this.sim.s.nextId++, name: this.uniqueName(lineage), lineage, born: this.secs, specialty: null, traits,
      origin: 'pod', wb: 65, stance: 50, hp: P.colonistHp * (traits.includes('frail') ? 0.6 : 1),
      home: -1, job: -1, at: b.id, goal: b.id, x: b.x, z: b.z, heading: 0, partner: -1, ...extra,
    };
    s.colonists.push(c);
    return c;
  }

  private decant(p: Pod, b: Building) {
    const cur = CURRICULA[p.curriculum];
    const c = this.spawn(p.lineage, b, {
      born: this.secs - P.decantAge * SOL, specialty: p.specialty, origin: 'pod', imprint: p.curriculum,
      stance: clamp(cur.stance + (this.sim.rnd() - 0.5) * 12, 0, 100), wb: 62,
    });
    this.s.grown++;
    this.s.first ??= { id: c.id, name: c.name };
    this.emit(`${c.name} steps out of the growth pod · ${cap(p.specialty)}, ${cur.name} imprint`, 'info', 'unitReady');
  }

  // ---------- housing and jobs ----------
  private housing() {
    const s = this.s, bs = this.sim.s.buildings;
    const homes = bs.filter((b) => b.progress >= 1 && def(b)?.role === 'civic' && (def(b).housing ?? 0) > 0);
    const count = new Map<number, number>();
    for (const c of s.colonists) {
      if (c.home >= 0 && !homes.some((h) => h.id === c.home)) c.home = -1;
      if (c.home >= 0) count.set(c.home, (count.get(c.home) ?? 0) + 1);
    }
    // a couple in a full house moves somewhere with room for a family
    for (const c of s.colonists) {
      const pt = c.partner >= 0 ? this.colonist(c.partner) : undefined;
      if (!pt || c.id > pt.id || c.home < 0 || c.home !== pt.home) continue;
      const here = homes.find((h) => h.id === c.home);
      if (!here || (count.get(here.id) ?? 0) < (def(here).housing ?? 0)) continue;
      const roomy = homes.find((h) => (def(h).housing ?? 0) - (count.get(h.id) ?? 0) >= 3);
      if (!roomy) continue;
      count.set(here.id, (count.get(here.id) ?? 0) - 2);
      count.set(roomy.id, (count.get(roomy.id) ?? 0) + 2);
      c.home = pt.home = roomy.id;
    }
    for (const c of s.colonists) {
      if (c.home >= 0) continue;
      // with their partner if there's room, else anywhere with room
      const pt = c.partner >= 0 ? this.colonist(c.partner) : undefined;
      const order = [...homes].sort((a, b) => (pt && b.id === pt.home ? 1 : 0) - (pt && a.id === pt.home ? 1 : 0));
      for (const h of order) {
        const n = count.get(h.id) ?? 0;
        if (n < (def(h).housing ?? 0)) { c.home = h.id; count.set(h.id, n + 1); break; }
      }
    }
  }

  private jobs() {
    const s = this.s, bs = this.sim.s.buildings;
    const slots = bs.filter((b) => b.progress >= 1 && (def(b)?.staff ?? 0) > 0);
    const filled = new Map<number, number>();
    const workers = s.colonists.filter((c) => this.adult(c) && c.specialty);
    for (const c of workers) {
      const b = slots.find((x) => x.id === c.job);
      if (c.strike || !b || (filled.get(b.id) ?? 0) >= (def(b).staff ?? 0)) { c.job = -1; continue; }
      filled.set(b.id, (filled.get(b.id) ?? 0) + 1);
    }
    const free = (b: Building) => (def(b).staff ?? 0) - (filled.get(b.id) ?? 0);
    const from = (c: Colonist) => bs.find((b) => b.id === c.home) ?? { x: c.x, z: c.z };
    // specialists first to where they fit, then anyone anywhere
    for (const pass of [true, false]) {
      for (const c of workers) {
        if (c.job >= 0 || c.strike) continue;
        const o = from(c);
        let best: Building | null = null, bd = Infinity;
        for (const b of slots) {
          if (free(b) <= 0 || (pass && def(b).specialty !== c.specialty)) continue;
          const d = Math.hypot(b.x - o.x, b.z - o.z);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) { c.job = best.id; filled.set(best.id, (filled.get(best.id) ?? 0) + 1); }
      }
      // a specialist stuck in someone else's job moves when their own kind of work opens up
      if (pass) for (const c of workers) {
        const b = slots.find((x) => x.id === c.job);
        if (!b || def(b).specialty === c.specialty) continue;
        const better = slots.find((x) => free(x) > 0 && def(x).specialty === c.specialty);
        if (better) { filled.set(b.id, (filled.get(b.id) ?? 1) - 1); c.job = better.id; filled.set(better.id, (filled.get(better.id) ?? 0) + 1); }
      }
    }
  }

  /** Staffing bonus per building: only staff actually there count, so output follows the shift. */
  private staffing() {
    this.mults.clear();
    const surge = this.s.surge > 0 ? 1.25 : 1;
    for (const c of this.s.colonists) {
      if (c.job < 0 || c.at !== c.job) continue;
      const b = this.sim.s.buildings.find((x) => x.id === c.job);
      if (!b) continue;
      let add = P.staffBonus + (def(b).specialty === c.specialty ? P.specialtyBonus : 0);
      if (c.traits.includes('diligent')) add *= 1.5;
      if (c.stance > 75) add *= 1.1; // the Devoted work hard
      if (this.s.lead === 'partner') add *= P.partnerStaff;
      this.mults.set(b.id, (this.mults.get(b.id) ?? 1) + add);
    }
    if (surge > 1) for (const [k, v] of this.mults) this.mults.set(k, v * surge);
  }

  // ---------- moving about ----------
  /** Called once a second: is the colony on alert? */
  private underAttack() {
    const near = (r: number) => {
      for (const h of this.sim.s.hostiles) {
        for (const b of this.sim.s.buildings) if (def(b)?.role !== 'wall' && Math.hypot(b.x - h.x, b.z - h.z) < r + bodyR(b)) return true;
        for (const c of this.s.colonists) if (c.at === -1 && Math.hypot(c.x - h.x, c.z - h.z) < r) return true;
      }
      return false;
    };
    if (near(ALERT_R)) { this.alertQuiet = 0; return true; }
    if (!this.alert) return false;
    this.alertQuiet = near(ALERT_CLEAR_R) ? 0 : this.alertQuiet + 1;
    return this.alertQuiet < ALERT_HOLD;
  }

  private building(id: number) { return id >= 0 ? this.sim.s.buildings.find((b) => b.id === id) : undefined; }

  /** Where each colonist wants to be right now. */
  private decide(c: Colonist) {
    if (c.down !== undefined || c.at === AT_RIDE) return; // they can't go anywhere by themselves
    const bs = this.sim.s.buildings;
    const core = bs.find((b) => b.kind === 'core');
    const shelter = () => {
      // the nearest roof of any kind (not a wall)
      let best = this.building(c.home) ?? core, bd = best ? Math.hypot(best.x - c.x, best.z - c.z) : Infinity;
      for (const b of bs) {
        if (b.progress < 1 || def(b)?.role === 'wall') continue;
        const d = Math.hypot(b.x - c.x, b.z - c.z);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    };
    let goal: Building | undefined;
    if (this.alert) {
      if (c.at >= 0) return; // shelter in place
      const near = this.sim.s.hostiles.some((h) => Math.hypot(h.x - c.x, h.z - c.z) < SHELTER_R);
      goal = near || !this.building(c.goal) ? shelter() : this.building(c.goal);
    } else {
      const h = hourAt(this.secs, SOL), [a, b] = SHIFTS[this.s.policies.hours];
      const working = this.adult(c) && !c.strike && c.job >= 0 && h >= a && h < b;
      goal = (working ? this.building(c.job) : undefined) ?? this.building(c.home) ?? core;
    }
    if (!goal) return;
    if (goal.id !== c.goal) { c.goal = goal.id; c.path = undefined; }
  }

  private walk(c: Colonist) {
    if (c.goal < 0 || c.at === c.goal) return;
    const g = this.building(c.goal);
    if (!g) { c.goal = -1; return; }
    if (c.at >= 0) {
      // step out of the building we're in, on the side facing where we're going
      const b = this.building(c.at);
      c.at = -1;
      if (b) {
        const a = Math.atan2(g.x - b.x, g.z - b.z);
        c.x = b.x + Math.sin(a) * (bodyR(b) + 0.8); c.z = b.z + Math.cos(a) * (bodyR(b) + 0.8); c.heading = a;
      }
    }
    const door = () => {
      const a = Math.atan2(c.x - g.x, c.z - g.z);
      return [g.x + Math.sin(a) * (bodyR(g) + 0.6), g.z + Math.cos(a) * (bodyR(g) + 0.6)];
    };
    if (!c.path) {
      const [dx, dz] = door();
      c.path = this.sim.pathFor(c.x, c.z, dx, dz) ?? [dx, dz];
    }
    const p = c.path;
    while (p.length > 2 && Math.hypot(p[0] - c.x, p[1] - c.z) < 1) p.splice(0, 2);
    const run = this.alert ? 2.2 : 1;
    const [tx, tz] = p.length ? [p[0], p[1]] : door();
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, P.walkSpeed * run * DT * (this.adult(c) ? 1 : 0.8));
    if (d > 1e-3) { c.x += (dx / d) * step; c.z += (dz / d) * step; c.heading = Math.atan2(dx, dz); }
    if (Math.hypot(g.x - c.x, g.z - c.z) < bodyR(g) + 1.2) { c.at = g.id; c.x = g.x; c.z = g.z; c.path = undefined; }
    else if (p.length <= 2 && d < 0.3) c.path = undefined; // got to the end of a stale path: re-plan
  }

  // ---------- wellbeing and stance ----------
  private mood(dt: number) {
    const s = this.s, pol = s.policies;
    const k = 1 - Math.exp(-P.moodRate * dt / SOL);
    for (const c of s.colonists) {
      const bloc = blocOf(c.stance), adult = this.adult(c);
      const why: [string, number][] = [];
      const add = (label: string, v: number) => { if (Math.abs(v) >= 0.5) why.push([label, v]); };
      add(s.hungry > 0 ? 'Hungry' : 'Fed', s.hungry > 0 ? -35 : 6);
      add('Rations', { lean: -10, normal: 0, generous: 8 }[pol.rations]);
      const home = this.building(c.home);
      if (!home) add('No home', -20);
      else add(home.powered ? 'Home' : 'Home without power', home.powered ? 6 : -10);
      if (adult && c.job >= 0) add('Work hours', { short: 8, standard: 0, long: bloc === 'devoted' ? -4 : -12 }[pol.hours]);
      if (adult) {
        add('Council', LIKES.council[pol.council][bloc]);
        add('Oversight', LIKES.oversight[pol.oversight][bloc]);
      }
      const hard = c.traits.includes('stoic') ? 0.5 : c.traits.includes('anxious') ? 2 : 1;
      add('Grief', -s.grief * hard);
      add('Fear', -s.fear * hard);
      if (c.traits.includes('optimist')) add('Optimist', 8);
      if (home) {
        // comfort from what's near home: a medic in the house, a Med Bay or a Memorial in reach (the best of each kind)
        const best = new Map<string, number>();
        if (this.hasMedic(home)) best.set('Medical care', 5);
        for (const a of this.auras) if (Math.hypot(a.b.x - home.x, a.b.z - home.z) <= a.r) best.set(a.label, Math.max(best.get(a.label) ?? 0, a.v));
        for (const [k, v] of best) add(k, v);
      }
      if (c.partner >= 0) add('Partner', 5);
      if (s.surge > 0) add('Breakthrough', 6);
      if (c.hp < P.colonistHp * 0.5) add('Injured', -10);
      const target = clamp(50 + why.reduce((m, [, v]) => m + v, 0), 0, 100);
      c.wb += (target - c.wb) * k;
      why.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      this.why.set(c.id, why);
      // stance: where policy, mood, temperament and the people around them pull
      // misery is blamed on the AI; contentment settles people toward partnership, not devotion
      let drift = PULL.council[pol.council] + PULL.oversight[pol.oversight];
      drift += c.wb < 50 ? (c.wb - 50) * 0.12 : (c.wb - 50) * 0.1 * clamp((60 - c.stance) / 20, -1, 1);
      if (c.traits.includes('independent')) drift -= 2;
      if (c.traits.includes('trusting')) drift += 2;
      if (c.origin === 'born') drift -= 0.5;
      if (s.surge > 0) drift += 2;
      if (c.home >= 0) {
        let m = 0, n = 0;
        for (const o of s.colonists) if (o !== c && o.home === c.home) { m += o.stance; n++; }
        if (n) drift += (m / n - c.stance) * 0.15;
      }
      c.stance = clamp(c.stance + drift * P.stanceRate * dt / SOL, 0, 100);
      // strikes, with a little hysteresis
      if (adult && !c.strike && c.wb < P.strikeBelow) { c.strike = true; c.job = -1; }
      else if (c.strike && c.wb > P.strikeBelow + 10) c.strike = false;
    }
    s.grief *= Math.exp(-2 * (this.memorials ? MEMORIAL_GRIEF : 1) * dt / SOL);
    s.fear = this.alert ? 12 : s.fear * Math.exp(-dt / SOL * 12);
    const striking = s.colonists.filter((c) => c.strike).length;
    // announce a strike when it starts and when it has grown by half again; and when it ends
    if (striking > 0 && striking >= Math.max(1, Math.ceil(this.strikeSaid * 1.5))) {
      this.emit(`${striking} colonist${striking > 1 ? 's are' : ' is'} on strike`, 'warn', 'warning');
      this.strikeSaid = striking;
    } else if (striking === 0 && this.strikeSaid > 0) {
      this.emit('The strike is over: everyone is back at work', 'info');
      this.strikeSaid = 0;
    }
  }

  // ---------- births, ageing, death ----------
  private lifecycle(dt: number) {
    const s = this.s, per = dt / SOL;
    // hunger: after the grace period the weakest start dying
    if (s.hungry > P.starveGrace && s.colonists.length && this.sim.s.tick % (TICK_HZ * 20) === 0) {
      const c = [...s.colonists].sort((a, b) => a.hp - b.hp)[0];
      c.hp -= P.colonistHp * 0.35;
      if (c.hp <= 0) this.kill(c, 'starvation');
      else if (s.hungry < P.starveGrace + 21) this.emit('The colony is starving. Build Hydroponics or ration food.', 'bad', 'alarm');
    }
    for (const c of [...s.colonists]) {
      const age = this.age(c);
      if (s.hungry <= 0 && c.down === undefined) c.hp = Math.min(this.maxHp(c), c.hp + 2 * dt);
      const old = P.lifespan - 10 - (c.traits.includes('frail') ? 15 : 0);
      // a Med Bay looking after their home halves the yearly chance
      const home = this.building(c.home), cared = !!home && this.medCare(home);
      if (age > old && this.sim.rnd() < ((age - old) / 20) * per * (cared ? MEDBAY_AGEING : 1)) { this.kill(c, 'old age'); continue; }
      // children come of age
      if (!c.specialty && age >= P.adultAge) {
        c.specialty = this.neededSpecialty();
        this.emit(`${c.name} comes of age and trains as ${aOrAn(c.specialty)} ${cap(c.specialty)}`, 'info');
      }
    }
    // couples form among housemates, and settled, happy couples have children
    const adults = s.colonists.filter((c) => this.adult(c) && this.age(c) >= 18 && this.age(c) <= 50);
    for (const c of adults) {
      if (c.partner >= 0 || c.home < 0 || c.wb < 40) continue;
      if (this.sim.rnd() > 0.6 * per * (c.stance > 75 ? 0.3 : 1)) continue;
      const o = adults.find((x) => x !== c && x.partner < 0 && x.home === c.home && x.lineage !== c.lineage && x.wb >= 40);
      if (o) { c.partner = o.id; o.partner = c.id; this.emit(`${c.name} and ${o.name} are now partners`, 'info'); }
    }
    const homeCount = new Map<number, number>();
    for (const c of s.colonists) if (c.home >= 0) homeCount.set(c.home, (homeCount.get(c.home) ?? 0) + 1);
    for (const a of adults) {
      const b = a.partner >= 0 ? this.colonist(a.partner) : undefined;
      if (!b || a.id > b.id || a.home !== b.home || a.home < 0 || a.wb < 50 || b.wb < 50 || this.age(b) > 50) continue;
      const home = this.building(a.home)!;
      if ((homeCount.get(home.id) ?? 0) >= (def(home).housing ?? 0)) continue;
      const devoted = (a.stance > 75 ? 1 : 0) + (b.stance > 75 ? 1 : 0);
      if (this.sim.rnd() > P.birthChance * per * [1, 0.4, 0.15][devoted]) continue;
      const kid = this.spawn(this.sim.rnd() < 0.5 ? a.lineage : b.lineage, home, {
        origin: 'born', stance: clamp((a.stance + b.stance) / 2 - 15, 0, 100), wb: 75, home: home.id, parents: [a.id, b.id],
      });
      kid.hp = Math.min(kid.hp, P.colonistHp * 0.5);
      homeCount.set(home.id, (homeCount.get(home.id) ?? 0) + 1);
      s.births++;
      this.emit(`A child is born: ${kid.name}, to ${a.name.split(' ')[0]} and ${b.name.split(' ')[0]}`, 'info', 'unitReady');
    }
  }

  /** The specialty with the most open jobs (a coming-of-age choice). */
  private neededSpecialty(): Specialty {
    const open = new Map<Specialty, number>();
    for (const b of this.sim.s.buildings) {
      const d = def(b);
      if (b.progress < 1 || !d?.staff || !d.specialty) continue;
      const have = this.s.colonists.filter((c) => c.job === b.id).length;
      open.set(d.specialty, (open.get(d.specialty) ?? 0) + Math.max(0, d.staff - have));
    }
    let best: Specialty = SPECIALTIES[Math.floor(this.sim.rnd() * SPECIALTIES.length)], bn = 0;
    for (const [k, n] of open) if (n > bn) { bn = n; best = k; }
    return best;
  }

  // ---------- the leading bloc and its boost ----------
  /** The bloc leading the colony (its boost is on), or null. */
  lead(): Bloc | null { return this.s.lead ?? null; }

  private leadership(adults: number, n: (b: Bloc) => number) {
    const s = this.s;
    let lead: Bloc | null = null;
    if (adults >= P.leadMin) for (const b of BLOCS) if (n(b) / adults >= P.leadShare) lead = b;
    if (lead === (s.lead ?? null)) return;
    const was = s.lead ?? null;
    s.lead = lead;
    if (lead) this.emit(LEAD_NEWS[lead], 'info', 'online');
    else if (was) this.emit(`No bloc leads the colony any more: the ${BOOST[was]} boost is gone`, 'warn', 'warning');
  }

  /** Autonomist-led: how many Autonomists in building `b` fight off predators. */
  wardens(b: Building): number {
    if (this.s.lead !== 'autonomist') return 0;
    let k = 0;
    for (const c of this.s.colonists) if (c.at === b.id && this.adult(c) && blocOf(c.stance) === 'autonomist') k++;
    return Math.min(k, P.militiaMax);
  }

  /** Share of predator damage a colonist outdoors takes. */
  harm(): number {
    return this.s.lead === 'autonomist' ? P.wardenHarm : 1;
  }

  /** Devoted-led: drone work speed and building power draw. */
  droneWork(): number { return this.s.lead === 'devoted' ? P.devotedDrones : 1; }
  powerDraw(): number { return this.s.lead === 'devoted' ? P.devotedPower : 1; }

  // ---------- Trust: blocs acting on their mood ----------
  private politics(dt: number) {
    const s = this.s, per = dt / SOL;
    const adults = s.colonists.filter((c) => this.adult(c));
    const n = (b: Bloc) => adults.filter((c) => blocOf(c.stance) === b).length;
    this.leadership(adults.length, n);
    if (!adults.length) { s.breakthrough = 0; return; }
    const wb = adults.reduce((m, c) => m + c.wb, 0) / adults.length;
    // sabotage by angry Autonomists, unless Oversight catches it
    const watch = { light: 1.5, standard: 1, total: 0 }[s.policies.oversight];
    for (const c of adults) {
      if (blocOf(c.stance) !== 'autonomist' || c.wb >= P.sabotageBelow) continue;
      if (this.sim.rnd() > P.sabotageChance * per * Math.max(watch, s.policies.oversight === 'total' ? 1 : 0)) continue;
      const targets = this.sim.s.buildings.filter((b) => b.progress >= 1 && b.kind !== 'core' && def(b)?.role !== 'wall');
      const t = targets[Math.floor(this.sim.rnd() * targets.length)];
      if (!t) continue;
      const caught = s.policies.oversight === 'total' || (s.policies.oversight === 'standard' && this.sim.rnd() < 0.5);
      if (caught) {
        this.emit(`Oversight stopped ${c.name} from sabotaging the ${def(t).name}`, 'warn', 'warning');
        for (const o of adults) if (blocOf(o.stance) === 'autonomist') o.stance = clamp(o.stance - 2, 0, 100);
      } else {
        t.hp -= def(t).hp * 0.3;
        this.emit(`Sabotage! The ${def(t).name} was damaged. Autonomists are blamed.`, 'bad', 'alarm');
        if (t.hp <= 0) this.sim.sabotaged(t);
      }
    }
    // walkout: an angry Autonomist majority leaves to live on its own
    if (adults.length >= 4 && n('autonomist') / adults.length >= 0.5 && wb < 30) {
      s.unrest += dt;
      if (s.unrest > SOL * 0.25 && s.unrest - dt <= SOL * 0.25) this.emit('Autonomists are talking about leaving the colony', 'warn', 'warning');
      if (s.unrest > SOL * 0.5) {
        s.unrest = 0;
        const go = adults.filter((c) => blocOf(c.stance) === 'autonomist').sort((a, b) => a.wb - b.wb).slice(0, Math.max(1, Math.floor(n('autonomist') / 3)));
        for (const c of go) this.kill(c, 'left to found a settlement of their own', true);
        this.emit(`${go.length} Autonomist${go.length > 1 ? 's have' : ' has'} walked out to found a settlement of their own`, 'bad', 'alarm');
      }
    } else s.unrest = Math.max(0, s.unrest - dt * 2);
    // breakthroughs when humans and AI are in step
    if (s.surge > 0) s.surge = Math.max(0, s.surge - dt);
    else if (adults.length >= 3 && n('partner') / adults.length >= 0.6 && wb >= 65) {
      s.breakthrough += per;
      if (s.breakthrough >= 1) {
        s.breakthrough = 0;
        s.surge = SOL / 2;
        this.emit('Breakthrough! Humans and AI in step: staffed buildings +25% for half a sol', 'info', 'packCleared');
      }
    } else s.breakthrough = Math.max(0, s.breakthrough - per * 0.5);
  }

  private checkLines() {
    const s = this.s, living = this.livingPerLine();
    s.bank.forEach((n, l) => {
      if (n > 0 || living[l] > 0 || s.gone.includes(l)) return;
      s.gone.push(l);
      s.grief += 4;
      this.emit(`The ${lineName(l)} line is gone`, 'bad', 'lost');
    });
  }

  /** Genetic diversity 0..100: effective number of lineages (embryos + living) against the starting number. */
  diversity() {
    const s = this.s, living = this.livingPerLine();
    let tot = 0, sq = 0;
    s.bank.forEach((n, l) => { const v = n + living[l] * 2; tot += v; sq += v * v; });
    if (tot <= 0) return 0;
    return clamp((tot * tot) / sq / s.bank.length * 100, 0, 100);
  }

  // ---------- snapshot ----------
  snapshot(): PeopleSnap {
    const s = this.s, bs = this.sim.s.buildings;
    const adults = s.colonists.filter((c) => this.adult(c));
    const blocs: Record<Bloc, number> = { partner: 0, autonomist: 0, devoted: 0 };
    for (const c of adults) blocs[blocOf(c.stance)]++;
    const avg = (f: (c: Colonist) => number) => (adults.length ? adults.reduce((m, c) => m + f(c), 0) / adults.length : 0);
    const name = (id: number) => { const b = this.building(id); return b ? def(b)?.name ?? null : null; };
    const outdoors = s.colonists.filter((c) => c.at === -1);
    const walkers = new Float32Array(outdoors.length * 6);
    outdoors.forEach((c, i) => {
      // flags: 1 child, 2 lying injured
      walkers.set([c.id, c.x, c.z, c.heading, BLOCS.indexOf(blocOf(c.stance)), (this.adult(c) ? 0 : 1) + (c.down !== undefined ? 2 : 0)], i * 6);
    });
    const living = this.livingPerLine();
    const roster: ColonistSnap[] = s.colonists.map((c) => {
      const g = this.building(c.goal), at = this.building(c.at);
      const doing = c.at === AT_RIDE ? 'Aboard a Medevac'
        : c.down !== undefined ? (this.stable.has(c.id) ? `Injured: stabilised, a Med Bay crew is coming (${Math.ceil(c.down)} s)` : `Injured: needs a Medevac (${Math.ceil(c.down)} s)`)
        : c.strike && c.at >= 0 ? `On strike at ${at ? def(at).name : 'home'}`
        : c.at < 0 ? (this.alert ? `Running for shelter${g ? ` (${def(g).name})` : ''}` : `Walking to ${g ? (g.id === c.home ? 'home' : def(g).name) : '…'}`)
        : this.alert ? `Sheltering in ${at ? def(at).name : '…'}`
        : c.at === c.job ? `Working at ${at ? def(at).name : '…'}`
        : c.at === c.home ? (this.adult(c) ? 'At home' : 'At home (child)') : `At ${at ? def(at).name : '…'}`;
      const pt = c.partner >= 0 ? this.colonist(c.partner) : undefined;
      return {
        id: c.id, name: c.name, lineage: lineName(c.lineage), age: Math.floor(this.age(c)), specialty: c.specialty, traits: [...c.traits],
        origin: c.origin, imprint: c.imprint, wb: c.wb, stance: c.stance, bloc: blocOf(c.stance), hp: c.hp / P.colonistHp,
        home: name(c.home), job: name(c.job), doing, strike: !!c.strike, partner: pt?.name ?? null, x: c.x, z: c.z, outdoors: c.at === -1, jobId: c.job, atId: c.at, why: (this.why.get(c.id) ?? []).slice(0, 6),
      };
    });
    const housing = bs.reduce((m, b) => m + (b.progress >= 1 && def(b)?.role === 'civic' ? def(b).housing ?? 0 : 0), 0);
    return {
      embryos: this.embryos(), lineages: s.bank.length,
      lineagesLeft: s.bank.filter((n, l) => n > 0 || living[l] > 0).length,
      diversity: this.diversity(), biomass: s.biomass, biomassMax: this.storage(), food: { ...this.food },
      adults: adults.length, children: s.colonists.length - adults.length, housing,
      wellbeing: avg((c) => c.wb), stance: avg((c) => c.stance), blocs, lead: s.lead ?? null,
      striking: s.colonists.filter((c) => c.strike).length, policies: { ...s.policies },
      breakthrough: s.breakthrough, surge: s.surge,
      pods: bs.filter((b) => def(b)?.role === 'civic' && b.progress >= 1).map((b) => ({
        b: b.id, slots: def(b).pods ?? 0,
        running: s.pods.filter((p) => p.b === b.id).map((p) => ({ specialty: p.specialty, curriculum: p.curriculum, lineage: lineName(p.lineage), progress: p.progress, dark: p.dark })),
      })),
      roster,
      memorial: s.memorial.slice(-40).reverse().map((m) => ({ ...m, lineage: lineName(m.lineage) })),
      bank: s.bank.map((n, l) => ({ name: lineName(l), embryos: n, living: living[l] })),
      walkers,
      care: [...this.treat].map(([b, t]) => {
        const bb = this.building(b), d = bb && def(bb);
        const waiting = bb && d?.range ? this.injured().filter((c) => Math.hypot(c.x - bb.x, c.z - bb.z) <= d.range!).length : 0;
        return { b, progress: Math.min(1, t / (d?.treatSeconds ?? 8)), waiting };
      }),
      stats: { grown: s.grown, births: s.births, deaths: s.memorial.filter((m) => !m.cause.startsWith('left')).length, departed: s.departed },
    };
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const aOrAn = (s: string) => (/^[aeiou]/i.test(s) ? 'an' : 'a');
export { TRAITS };
