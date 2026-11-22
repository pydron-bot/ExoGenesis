/**
 * Autopilot (spectator mode), the brain in the sim worker (TECH.md "Autopilot"): the balance bot's build plan
 * (`BalanceBot`, src/sim/balance.ts) and the story playthrough's `chase` (src/sim/playthrough.ts) run on the
 * live game every tick, as they do headless, plus what only the real game has: travel between regions (it sets
 * `SimState.travel`, as a story `travel` effect does, and the renderer saves and goes), an optional assist that
 * finishes an objective that hasn't moved for a while, and what it is doing for the watcher (a caption and where
 * the camera might look). Story cards and cinematics are the renderer's (src/autopilot.ts): they are read on screen.
 *
 * On top of the plan it keeps the colony going (`manage`): power for the nights (a sol worked through ahead: batteries,
 * geothermal on the vents, fusion, solar), drones, depots on every deposit it can reach (a relay toward a far one),
 * Deep-Core Mines on the seams, research when the lab is idle, printers, farms and homes; at home guns that grow with
 * the packs, a gun by every outlying building, a shield and a garrison. Its army (`army`) defends what is attacked,
 * fights for objectives (a mission's flag traced back to the encounter, relic grid, outpost or story event that sets
 * it; a site with something guarding it; kills), escorts those a mission must keep alive, pulls back to mend, and is
 * replaced as it is lost. It never fires on a neutral faction (that breaks talks).
 */
import { content } from '../content';
import { conditionsIn, type Condition, type ConditionDef } from '../content/defs';
import { BalanceBot, STRATEGIES } from './balance';
import { HOME_REGION } from './campaign';
import { daylight } from './daylight';
import { regionNow, type Sim } from './core';
import { researchBlocked } from './mods';
import { chase } from './playthrough';
import type { Building, Command, Unit } from './types';
import type { Step } from './strategies';

const HZ = 10;

export interface PilotConfig {
  on: boolean;
  /** Finish an objective that hasn't moved for `assistMinutes`, and hold off a pack about to take the Core. */
  assist?: boolean;
  assistMinutes?: number;
}

/** What the autopilot is doing and where the camera might look (the renderer's director picks among them). */
export interface PilotStatus {
  doing: string;
  /** The place the caption is about (a site, a building going up). */
  at?: { x: number; z: number };
  /** Places worth a look, most urgent first. */
  strike?: { x: number; z: number };
  fight?: { x: number; z: number };
  card?: { x: number; z: number };
  group?: { x: number; z: number };
  build?: { x: number; z: number };
  core?: { x: number; z: number };
}

type P = { x: number; z: number };
/** A plan step placed at a spot the autopilot chose (and checked): [kind, 'at', x, z]. */
type AtStep = [string, 'at', number, number];
const at = (kind: string, p: P): Step => [kind, 'at', p.x, p.z] as unknown as Step;
const isAt = (s: Step | undefined): s is Step & AtStep => !!s && (s as unknown[])[1] === 'at';

/** The autopilot's build at home: the fortress strategy, then farms and homes (the people plan carries on from there). */
const HOME_PLAN = (): Step[] => ([...STRATEGIES.fortress.plan(), ['hydroponics'], ['civic'], ['solar'], ['battery'], ['hydroponics']] as Step[]).filter((p, i) => p[0] !== 'depot' || i < 3);
/** Research it does on its own when the lab is idle (missions' research comes first), in this order. */
const RESEARCH = ['deep-survey', 'refined-drills', 'hardened-plating', 'isotope-cells', 'tracking-arrays', 'matter-compiler', 'deep-cells', 'fire-control', 'seismic-listening',
  'orbital-launch', 'shield-lattice', 'vertical-farms', 'swarm-logic', 'logistics-grid', 'field-repair', 'garrison-doctrine', 'seam-harmonics', 'matter-compiler',
  'lattice-tuning', 'colony-medicine', 'nutrition', 'accelerated-pods', 'low-scar', 'commons-design'];
/** Units it builds, in turn (the first it can). */
const ARMY = ['tank', 'lancer', 'rover', 'tank', 'artillery', 'lancer', 'tank', 'rover'];

/** "The ritual loop round the pylon (E8)" → "the ritual loop round the pylon". */
const placeName = (label: string) => {
  const t = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return /^[A-Z][a-z]/.test(t) && !/^[A-Z][a-z]+ [A-Z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};
const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const centre = (l: P[]): P => ({ x: l.reduce((m, o) => m + o.x, 0) / l.length, z: l.reduce((m, o) => m + o.z, 0) / l.length });

/** Valid spot for `kind` nearest to (x, z) within `maxR` (the sim's own placement check), or null. */
function findSpot(sim: Sim, kind: string, x: number, z: number, maxR = 30, ok?: (p: P) => boolean): P | null {
  // (not on top of our units: a building put down round them boxes them in for good)
  const units = (sim.s.units ?? []).filter((u) => !u.team), room = (content.buildings[kind]?.clearance ?? 6) / 2 + 2.5;
  for (let r = 0; r <= maxR; r += 2) {
    const n = Math.max(1, Math.round(r * 1.2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      if (!sim.placeProblemAt(kind, p.x, p.z) && !units.some((u) => dist(u, p) < room) && (!ok || ok(p))) return p;
    }
  }
  return null;
}

/**
 * The balance bot as the autopilot drives it: steps placed at spots it chose (`[kind, 'at', x, z]`), a step that
 * costs isotopes waits for them (rather than being refused and lost), and no army of its own (the autopilot's).
 */
class PilotBot extends BalanceBot {
  /** The plan's own spots go through the autopilot's search (which keeps clear of our units). */
  protected spot(_s: unknown, kind: string, px: number, pz: number) { return findSpot(this.sim, kind, px, pz, 70); }
  /** Alloys kept back for a mission (a step not in `exempt` waits rather than spend them). */
  reserve = 0;
  exempt = new Set<string>();

  protected army() { /* the autopilot commands the army */ }

  step(tick: number) {
    const plan = this.plan, s = this.sim.s, D = content.buildings;
    // saving up for a mission: its own steps (and the other exempt ones) go first
    if (this.reserve && plan[0] && !this.exempt.has(plan[0][0])) {
      const i = plan.findIndex((p) => this.exempt.has(p[0]));
      if (i > 0) plan.unshift(...plan.splice(i, 1));
    }
    const head = plan[0];
    const keep = head && !this.exempt.has(head[0]) ? this.reserve : 0;
    const wait = head && D[head[0]] && ((s.isotopes ?? 0) < (D[head[0]].isotopes ?? 0) || s.alloys < D[head[0]].cost + keep);
    if (head && (isAt(head) || wait)) {
      if (isAt(head) && !wait && tick % HZ === 0) {
        const [kind, , x, z] = head as unknown as AtStep;
        // (it was checked when queued; nearby if something has gone up there since, else dropped)
        const p = findSpot(this.sim, kind, x, z, 6);
        plan.shift();
        if (p) { this.command({ type: 'build', kind, x: p.x, z: p.z }); this.firsts[kind] ??= Math.round(this.sim.secs); }
      }
      // the rest of the bot (pods, the people plan) runs with the plan held back
      const held = plan.splice(0);
      super.step(tick);
      const added = plan.splice(0).filter((p) => !held.some((h) => h[0] === p[0]));
      plan.push(...held, ...added);
      return;
    }
    super.step(tick);
  }
}

interface Fight {
  at: P;
  why: string;
  /** Something to attack (a hostile faction's building or unit). */
  target?: number;
  /** Walk one unit there (nothing to fight). */
  walk?: boolean;
  /** Stay with these (an escort). */
  escort?: boolean;
  /** A nest raid: the nest's id. */
  nest?: number;
  /** Several places to hold at once (tuning plates): the force splits between them. */
  split?: P[];
}

export class Autopilot {
  private bot: PilotBot | null = null;
  private cfg: PilotConfig = { on: false };
  /** Game seconds when this region's play started (arrival or the autopilot switched on). */
  private since = -1;
  /** Per mission under way here: objectives met and when that last changed (seconds). */
  private progress = new Map<string, { n: number; at: number }>();
  private lastDefend = -1e9;
  private lastCryo = -1e9;
  private extra = 0;
  private fightSince = -1;
  private offSince = -1;
  /** Per mission under way: objectives met and when that last changed (seconds), for travel. */
  private moved = new Map<string, { n: number; at: number }>();
  private doing = { text: '', at: undefined as { x: number; z: number } | undefined, t: -1e9 };
  /** The unit (or drone) last sent to a site, while it walks there. */
  private walker: { id: number; drone: boolean; x: number; z: number } | null = null;
  /** The plan's first step and since when it has been first (an unreachable spot must not hold the plan for good). */
  private head = { key: '', since: 0 };
  private gunIdx = 0;
  /** What the missions here are waiting for (alloys, isotopes): other spending waits too. */
  private saving: { alloys: number; isotopes: number } | null = null;
  private armyIdx = 0;
  /** Units sent to a site (site key → unit id), so one standing on a plate isn't taken for the next. */
  private posted = new Map<string, number>();
  /** When each site was last asked for (a post nobody asks for any more is let go). */
  private asked = new Map<string, number>();
  /** The fight under way: where, and since when (seconds); units pulled back to mend. */
  private fight: { f: Fight; since: number; sent: number } | null = null;
  private mending = new Set<number>();
  /** Other teams' units and buildings (campaign factions), gathered before the colony's view is swapped in. */
  private others: { buildings: Building[]; units: Unit[] } = { buildings: [], units: [] };

  constructor(private sim: Sim, private say: (text: string) => void) {}

  get on() { return this.cfg.on; }

  configure(c: PilotConfig) {
    if (c.on && !this.cfg.on) { this.since = -1; this.progress.clear(); }
    this.cfg = { ...c };
  }

  /** One tick, before the sim steps. */
  tick() {
    const s = this.sim.s;
    if (!this.cfg.on || s.phase !== 'deployed' || s.over || s.players) return;
    this.sim.withTeam(0, () => { this.others = this.sim.othersInView(); this.think(); });
  }

  private note(text: string, at?: { x: number; z: number }) {
    if (this.sim.s.travel && !text.startsWith('Travelling')) return; // on the way out: that is the news
    this.doing = { text, at, t: this.sim.secs };
  }

  /** Every order goes through here: it says what the bot is doing. */
  /** Alloys spent, by what on (tools/autopilot-campaign.mjs --trace prints it). */
  readonly spent: Record<string, number> = {};
  private command = (c: Command, from: 'plan' | 'chase' | 'army') => {
    const sim = this.sim, s = sim.s;
    const before = s.alloys;
    sim.command(c);
    if (s.alloys < before) { const k = c.type === 'build' ? c.kind : c.type === 'produce' ? c.unit : c.type === 'research' ? `r:${c.id}` : c.type; this.spent[k] = (this.spent[k] ?? 0) + before - s.alloys; }
    const B = content.buildings, U = content.units;
    switch (c.type) {
      case 'build': if (B[c.kind]) this.note(`Building ${article(B[c.kind].name)}`, { x: c.x, z: c.z }); break;
      case 'produce': if (U[c.unit]) this.note(`Producing ${article(U[c.unit].name)}`, s.buildings.find((b) => b.id === c.id)); break;
      case 'fab': this.note('Fabricating a drone'); break;
      case 'research': if (s.research?.active?.id === c.id) this.note(`Researching ${content.research[c.id]?.name ?? c.id}`); break;
      case 'ui': this.note(`Looking at the ${c.what.replace(/^select:/, '')} panel`); break;
      case 'order': case 'move': {
        if (from === 'plan') { if (this.sim.secs - this.doing.t > 8) this.note(s.hostiles.length ? 'Units out to meet hostiles' : 'Units back to the bay', { x: c.x, z: c.z }); break; }
        if (from === 'army') break;
        const site = (content.regions[regionNow()]?.sites ?? []).find((p) => Math.hypot(p.x - c.x, p.z - c.z) < 1);
        const camp = (s.camps ?? []).find((p) => Math.hypot(p.x * 0.85 - c.x, p.z * 0.85 - c.z) < 1);
        const group = camp ? content.inhabitants[camp.group]?.name ?? camp.group : '';
        this.note(site ? `Going to ${placeName(site.label ?? site.id)}` : camp ? `Going to meet ${group}` : 'On the move', { x: c.x, z: c.z });
        this.walker = c.type === 'move' ? { id: c.drone, drone: true, x: c.x, z: c.z } : { id: c.ids[0], drone: false, x: c.x, z: c.z };
        break;
      }
    }
  };

  private think() {
    const sim = this.sim, s = sim.s, tick = s.tick, here = regionNow();
    if (this.since < 0) this.since = sim.secs;
    if (!this.bot) {
      // home grows a colony; an expedition (no colonists) builds up an army
      this.bot = new PilotBot(sim, s.expedition ? 'mixed' : 'people', here, { pace: 1 });
      // home: the fortress's build with farms and homes after it (the people plan alone falls to the packs of the
      // second and third sol: tools/balance.mjs --strategy people --minutes 45; the fortress holds 45 min)
      if (!s.expedition) this.bot.plan.splice(0, this.bot.plan.length, ...HOME_PLAN());
      this.bot.command = (c) => this.command(c, 'plan');
      this.bot.prune();
    }
    // the plan run out and alloys piling up: more defence (an expedition: an army too)
    if (tick % (10 * HZ) === 0 && !this.bot.plan.length && s.alloys > (s.expedition ? 250 : 400)) {
      const more: Step[][] = s.expedition
        ? [[['tank']], [['turret', 'spawn']], [['solar'], ['battery']], [['rover'], ['tank']], [['pointdefense', 'spawn']], [['turret', 'guard']]]
        : [[['turret', 'spawn']], [['solar'], ['battery']], [['tank']], [['turret', 'guard']], [['pointdefense', 'spawn']]];
      this.bot.plan.push(...more[this.extra++ % more.length]);
    }
    // missions waiting off this world: a Launch Gantry (again, if packs took it), once researched
    if (tick % (10 * HZ) === 0 && here === HOME_REGION && this.offWorld(here).length) {
      const g = Object.entries(content.buildings).find(([, d]) => d.role === 'launch');
      if (g && sim.researched(g[1].research) && !s.buildings.some((b) => b.kind === g[0] && !b.team) && !this.bot.plan.slice(0, 2).some((p) => p[0] === g[0])) this.bot.plan.unshift([g[0]]);
    }
    if (tick % (5 * HZ) === 0) this.manage();
    this.unstick();
    this.bot.step(tick);
    if (tick % (5 * HZ) === 0) chase(sim, this.bot.plan, tick, (c) => this.command(c, 'chase'), { go: (x, z) => this.go(x, z) });
    if (tick % (3 * HZ) === 0) this.army(here);
    if (tick % (5 * HZ) === 0) this.travel(here);
    if (this.cfg.assist && tick % (10 * HZ) === 0) this.assist(here);
    if (this.cfg.assist && tick % (2 * HZ) === 0) this.defend();
    // nothing said for a while: what it is waiting for
    if (sim.secs - this.doing.t > 12 && tick % (5 * HZ) === 0) {
      const o = this.nextObjective(here);
      if (o) this.doing = { text: `Working on: ${o.text}`, at: undefined, t: sim.secs - 6 };
    }
  }

  // ---------- the colony ----------

  /** A plan step that can't go anywhere (or waits for something that never comes) doesn't hold the plan for good. */
  private unstick() {
    const plan = this.bot!.plan, s = this.sim.s, now = this.sim.secs, h = plan[0];
    const key = h ? h.join(',') : '';
    if (key !== this.head.key) { this.head = { key, since: now }; return; }
    if (!h || now - this.head.since < 60) return;
    const d = content.buildings[h[0]], u = content.units[h[0]];
    const cost = d?.cost ?? u?.cost ?? 0, iso = d?.isotopes ?? u?.isotopes ?? 0;
    // still saving up for it: fine for a while (3 min), then it goes to the back
    const poor = s.alloys < cost || (s.isotopes ?? 0) < iso;
    if (poor && now - this.head.since < 180) return;
    plan.shift();
    if (poor) plan.push(h);
    this.head = { key: '', since: now };
  }

  private ours(kind?: string) { return this.sim.s.buildings.filter((b) => !b.team && (!kind || b.kind === kind)); }
  private role(role: string) { return this.sim.s.buildings.filter((b) => !b.team && content.buildings[b.kind]?.role === role); }
  /** The buildable kind with this role, one on dry land first (a Pier is a relay too, on the water). */
  private kindOf(role: string) {
    const ks = Object.keys(content.buildings).filter((k) => content.buildings[k].role === role && content.buildings[k].buildable);
    return ks.find((k) => (content.buildings[k].site ?? 'land') === 'land') ?? ks[0];
  }
  private core(): P { return this.sim.s.buildings.find((b) => b.kind === 'core' && !b.team) ?? { x: 0, z: 0 }; }
  /** Our combat units (armed). */
  private soldiers() { return (this.sim.s.units ?? []).filter((u) => !u.team && (content.units[u.unit]?.damage ?? 0) > 0); }

  /** Put a step at the front (urgent) or just behind the step under way, unless the plan already has it near the front. */
  private queue(step: Step, urgent = false) {
    const plan = this.bot!.plan;
    if (plan.slice(0, urgent ? 2 : 4).some((p) => p[0] === step[0])) return false;
    if (urgent) plan.unshift(step); else plan.splice(Math.min(1, plan.length), 0, step);
    return true;
  }

  /** A relay toward (x, z) when it lies beyond the build area: the spot nearest it, if that gets us closer. */
  private reach(x: number, z: number): Step | null {
    const relay = this.kindOf('relay');
    if (!relay) return null;
    const p = findSpot(this.sim, relay, x, z, 70);
    if (!p) return null;
    const closest = Math.min(...this.ours().map((b) => dist(b, { x, z })));
    return dist(p, { x, z }) < closest - 12 ? at(relay, p) : null;
  }

  /** Every 5 s: what the colony is short of, put into the plan (most urgent first). */
  /** Buildings the missions here ask for. */
  private missionKinds() {
    const m = this.sim.s.missions, here = regionNow(), out: string[] = [];
    for (const id of m?.active ?? []) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) continue;
      for (const o of def.objectives) for (const x of conditionsIn(o.kind as Condition, o as unknown as ConditionDef)) if (x.c.building) out.push(x.c.building);
    }
    return out;
  }

  /**
   * What the missions here still need to research and build, in alloys and isotopes (the research chain from the
   * first project that can start, the buildings not yet up): while it waits the colony saves for it.
   */
  private needs(): { alloys: number; isotopes: number } | null {
    const sim = this.sim, s = sim.s, m = s.missions, here = regionNow();
    if (!m) return null;
    let alloys = 0, isotopes = 0;
    const done = new Set(s.research?.done ?? []);
    const research = (id: string | undefined, seen = new Set<string>()) => {
      for (let r = id; r && !done.has(r) && !seen.has(r) && s.research?.active?.id !== r; r = content.research[r]?.requires) {
        seen.add(r);
        alloys += content.research[r]?.cost ?? 0; isotopes += content.research[r]?.isotopes ?? 0;
        const also = content.research[r]?.also;
        if (also) research(also, seen);
      }
    };
    for (const id of m.active) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) continue;
      def.objectives.forEach((o, i) => {
        if (m.marks[id]?.includes(i)) return;
        for (const x of conditionsIn(o.kind as Condition, o as unknown as ConditionDef)) {
          if (x.kind === 'researched') research(x.c.research);
          if ((x.kind === 'built' || x.kind === 'placed') && x.c.building && !this.ours(x.c.building).length) {
            const d = content.buildings[x.c.building];
            if (!d) continue;
            research(d.research);
            alloys += d.cost; isotopes += d.isotopes ?? 0;
          }
        }
      });
    }
    return alloys + isotopes > 0 ? { alloys, isotopes } : null;
  }

  private manage() {
    const sim = this.sim, s = sim.s, D = content.buildings, plan = this.bot!.plan, home = !s.expedition;
    this.saving = home ? this.needs() : null;
    // (the plan keeps back what the mission needs, except for the mission's own steps and guns when they're well short)
    const bot = this.bot!;
    bot.reserve = this.saving ? Math.min(this.saving.alloys, 320) : 0;
    bot.exempt = new Set(['lab', 'depot', this.kindOf('deepmine') ?? '', this.kindOf('printer') ?? '', this.kindOf('reactor') ?? '', this.kindOf('launch') ?? '', ...this.missionKinds()]);
    const has = (k: string) => this.ours(k).length;
    const planned = (k: string) => plan.some((p) => p[0] === k);
    // drones: one per depot or so, up to the cap
    const depots = this.role('depot');
    if (s.drones.length + s.fab.queued < Math.min(sim.maxDrones(), 2 + Math.ceil(depots.length / 2) + (home ? 0 : 1)) && s.alloys >= content.colony.droneCost + 30) this.command({ type: 'fab' }, 'plan');
    // power for the nights
    const pw = this.powerNeed();
    if (pw) this.queue(pw, true);
    // the defence (and the army) that the packs call for
    const short = this.defence(home);
    // depots on every deposit it can reach
    if (!plan.some((p) => isAt(p) && (p[0] === 'depot' || p[0] === this.kindOf('relay')))) {
      const range = D.depot?.range ?? 30;
      const free = s.deposits.map((d, i) => ({ d, i })).filter(({ d }) => d.alloys > 40 && !depots.some((b) => dist(b, d) <= range))
        .sort((a, b) => dist(a.d, this.core()) - dist(b.d, this.core()));
      const working = s.deposits.filter((d) => d.alloys > 0 && depots.some((b) => dist(b, d) <= range)).length;
      const rich = s.deposits.filter((d) => d.alloys > 250 && depots.some((b) => dist(b, d) <= range)).length;
      if (free.length && (rich < 3 || short < 3 || s.alloys > 150)) {
        const { d, i } = free[0];
        const p = findSpot(sim, 'depot', d.x, d.z, range - 2, (q) => {
          let best = -1, bd = Infinity;
          s.deposits.forEach((o, k) => { const dd = dist(o, q); if (o.alloys > 0 && dd <= range && dd < bd) { bd = dd; best = k; } });
          return best === i;
        });
        const step = p ? at('depot', p) : this.reach(d.x, d.z);
        if (step) this.queue(step, working < 2);
      }
    }
    if (home) {
      // a Tech Lab once the colony stands (research makes the rest)
      if (!has('lab') && !planned('lab') && (s.waves.n >= 3 || sim.secs > 600) && depots.length >= 2 && short <= 3) this.queue(['lab']);
      // Deep-Core Mines on the seams: isotopes for Isotope Cells, the gantry, fusion, shields
      const deep = this.kindOf('deepmine');
      if (deep && sim.researched(D[deep].research) && this.role('deepmine').length < ((s.isotopes ?? 0) > (this.saving?.isotopes ?? 0) + 150 ? 1 : 2) && !planned(deep) && !plan.some((p) => isAt(p) && p[0] === this.kindOf('relay'))) {
        const seam = (s.seams ?? []).filter((v) => v.isotopes > 20 && !this.role('deepmine').some((b) => dist(b, v) < 6)).sort((a, b) => dist(a, this.core()) - dist(b, this.core()))[0];
        if (seam) {
          const p = findSpot(sim, deep, seam.x, seam.z, 6);
          const step = p ? at(deep, p) : this.reach(seam.x, seam.z);
          if (step) this.queue(step, !this.role('deepmine').length || (this.saving?.isotopes ?? 0) > (s.isotopes ?? 0));
        }
      }
      // food: a farm ahead of the colonists; homes as they fill
      const ppl = s.people;
      if (ppl && !planned('hydroponics')) {
        const n = ppl.colonists.length + ppl.pods.length, farms = has('hydroponics');
        if (farms < 1 || n * 0.045 > farms * 0.16 * (1 + sim.mod('farm')) || (ppl.biomass < 25 && farms < n / 2)) this.queue(['hydroponics'], ppl.biomass < 15);
      }
      if (ppl && !planned('civic') && has('civic') && !pw && !this.saving) {
        const housing = this.ours('civic').length * (D.civic?.housing ?? 0) + this.ours('habitat').length * (D.habitat?.housing ?? 0);
        if (ppl.colonists.length + ppl.pods.length >= housing - 2 && s.alloys > 200) this.queue(['civic']);
      }
      // Matter Printers on steady power (the deposits run dry): a Fusion Cell for every two, fuelled from the seams
      const printer = this.kindOf('printer'), fusion = this.kindOf('reactor');
      if (printer && fusion && sim.researched(D[printer].research) && !planned(printer) && !planned(fusion) && short <= 2 && (!this.saving || (s.isotopes ?? 0) > this.saving.isotopes + 60)) {
        const iso = s.isotopes ?? 0, prints = this.role('printer').length, cells = this.role('reactor').length;
        const fuelled = this.role('deepmine').length > 0 || iso > 150;
        const spare = cells * (D[fusion].powerMW ?? 0) + this.role('geothermal').length * (D.geothermal?.powerMW ?? 0) - prints * -(D[printer].powerMW ?? 0);
        if (spare >= -(D[printer].powerMW ?? 0) && prints < 6 && iso >= (D[printer].isotopes ?? 0)) this.queue([printer], s.deposits.every((d) => d.alloys < 300));
        else if (fuelled && cells < 3 && iso >= (D[fusion].isotopes ?? 0) + 15) this.queue([fusion], s.deposits.every((d) => d.alloys < 300));
      }
    }
    // an expedition with alloys to spare: a Tech Lab (research done here is the campaign's)
    if (!home && !has('lab') && !planned('lab') && s.alloys >= 420 && Object.keys(content.research).some((id) => !s.research?.done.includes(id))) this.queue(['lab']);
    // a repair pad for the army
    if (this.soldiers().length >= 3 && !this.role('repair').length && !planned('repairpad') && D.repairpad) this.queue(['repairpad']);
    // research when the lab stands idle (a mission's research goes first: chase starts it)
    this.research();
  }

  /** Steady generation (geothermal, fusion fuelled, the Core). */
  steady() {
    const s = this.sim.s;
    return this.ours().reduce((m, b) => {
      const d = content.buildings[b.kind];
      if (!d || d.powerMW <= 0 || d.role === 'solar') return m;
      if (d.role === 'reactor' && (s.isotopes ?? 0) < 5 && !this.role('deepmine').length) return m;
      return m + d.powerMW;
    }, 0);
  }

  /**
   * Will the colony's power last the night? A sol and a half worked through from now in 5 s steps (the sun by the
   * clock, the battery as it stands; turrets and factories at part load, depots and printers left out as the sim
   * leaves them); short in the second night: a battery if the day makes enough, else more generation (geothermal on
   * a free vent, a relay toward one, fusion with isotopes coming in, solar).
   */
  private powerNeed(): Step | null {
    const sim = this.sim, s = sim.s, D = content.buildings, sol = content.colony.solSeconds, R = content.colony;
    let steady = 0, sun = 0, cap = 0, load = 0;
    for (const b of this.ours()) {
      const d = D[b.kind];
      if (!d) continue;
      if (d.role === 'battery') { cap += (d.storage ?? 0) * (1 + sim.mod('battery')); continue; }
      if (d.role === 'reactor') { if ((s.isotopes ?? 0) > 10 || this.role('deepmine').length) steady += d.powerMW; continue; }
      if (d.powerMW > 0) { if (d.role === 'solar') sun += d.powerMW * (1 + sim.mod('solar')); else steady += d.powerMW; continue; }
      if (d.powerMW < 0 && d.role !== 'depot' && d.role !== 'printer') {
        const part = d.role === 'shield' ? 1 : d.fireRange ? 0.25 : d.role === 'factory' || d.role === 'repair' ? 0.3 : 1;
        load += -d.powerMW * part + (d.role === 'civic' ? (d.pods ?? 0) * content.people.podMW : 0);
      }
    }
    load += (s.expedition ? 0 : R.cryoDrawMW) + s.drones.length * R.droneBusyDrawMW;
    load *= 1.05 * sim.people.powerDraw();
    let st = Math.min(s.stored, cap), short = 0, net = 0;
    const step = 5;
    // (three sols: the batteries as they stand take a while to fill; only the last sol counts)
    for (let t = 0; t < sol * 3; t += step) {
      const g = steady + sun * (R.nightSolar + (1 - R.nightSolar) * daylight(sim.secs + t, sol));
      const e = (g - load) * step;
      if (t >= sol * 2) net += e;
      st += e;
      if (st < 0) { if (t >= sol * 2) short -= st; st = 0; }
      st = Math.min(st, cap);
    }
    if (short <= 0) return null;
    const battery = this.kindOf('battery');
    if (net > 0 && battery) return [battery];
    // more generation: a vent first
    const geo = this.kindOf('geothermal');
    if (geo && s.alloys >= (D[geo].cost ?? 0) * 0.6) {
      const vents = (content.regions[regionNow()]?.vents ?? []).filter((v) => !this.role('geothermal').some((b) => dist(b, v) < 6)).sort((a, b) => dist(a, this.core()) - dist(b, this.core()));
      for (const v of vents.slice(0, 2)) {
        const p = findSpot(sim, geo, v.x, v.z, 5);
        if (p) return at(geo, p);
      }
      if (vents.length && dist(vents[0], this.core()) < 110) { const r = this.reach(vents[0].x, vents[0].z); if (r && !this.bot!.plan.some((q) => isAt(q) && q[0] === r[0])) return r; }
    }
    const fusion = this.kindOf('reactor');
    if (fusion && sim.researched(D[fusion].research) && this.role('deepmine').length && (s.isotopes ?? 0) >= (D[fusion].isotopes ?? 0) && this.role('reactor').length < 2 + this.role('deepmine').length) return [fusion];
    return ['solar'];
  }

  /** Guns that grow with the packs, one by each outlying building, a shield; units: a garrison at home, an army away. */
  private defence(home: boolean): number {
    const sim = this.sim, s = sim.s, D = content.buildings, plan = this.bot!.plan, n = s.waves.n;
    const guns = this.ours().filter((b) => D[b.kind]?.role === 'turret' && !D[b.kind].airOnly && (D[b.kind].site ?? 'land') === 'land');
    const want = home ? Math.min(24, 3 + Math.ceil(n * 0.75)) : Math.min(12, 2 + Math.ceil(n * 0.4));
    const isGun = (p: Step) => p[0] === 'turret' || p[0] === 'pointdefense' || p[0] === 'cannon';
    const pending = plan.filter(isGun).length;

    // (at home past eight guns the army comes first: it raids the nests, and no nest, no packs)
    const armyFirst = home && guns.length >= 8 && this.soldiers().length < 6 && guns.length >= want - 4;
    // (saving up for a mission: only when the guns are well short)
    const saving = !!this.saving && guns.length >= want - 4;
    if (guns.length + pending < want && !armyFirst && !saving) {
      const cycle: Step[] = [['turret', 'spawn'], ['cannon', 'spawn'], ['pointdefense', 'spawn'], ['cannon', 'spawn']];
      const step = cycle[this.gunIdx++ % cycle.length];
      if (guns.length + pending < want - 2) plan.splice(Math.min(1, plan.length), 0, step); else plan.push(step);
    }
    // outlying buildings (far depots, deep mines, relays, the gantry): a gun beside each, two by a deep mine (they draw packs)
    if (!plan.some((p) => isAt(p) && (p[0] === 'turret' || p[0] === 'pointdefense'))) {
      const core = this.core(), spawns = content.regions[regionNow()]?.spawns ?? [];
      for (const b of this.ours()) {
        const d = D[b.kind];
        if (!d || dist(b, core) < 36 || !['depot', 'deepmine', 'relay', 'launch', 'geothermal'].includes(d.role ?? '')) continue;
        const need = d.role === 'deepmine' || d.role === 'launch' ? 2 : 1;
        if (guns.filter((g) => dist(g, b) < 22).length >= need) continue;
        const sp = [...spawns].sort((a, c) => dist(a, b) - dist(c, b))[0] ?? { x: b.x * 2, z: b.z * 2 };
        const k = 9 / Math.max(1, dist(sp, b));
        const p = findSpot(sim, 'turret', b.x + (sp.x - b.x) * k, b.z + (sp.z - b.z) * k, 12);
        if (p) { this.queue(at('turret', p)); break; }
      }
    }
    // a shield over the core once researched
    const shield = this.kindOf('shield');
    if (home && shield && sim.researched(D[shield].research) && !this.role('shield').length && !plan.some((p) => p[0] === shield) && (s.isotopes ?? 0) >= (D[shield].isotopes ?? 0) && s.alloys > (D[shield].cost ?? 0) + 60) {
      const p = findSpot(sim, shield, this.core().x, this.core().z - 8, 16);
      if (p) this.queue(at(shield, p));
    }
    // units: a bay first, then a garrison growing with the packs (an expedition: as many as it can)
    const bay = this.ours().find((b) => D[b.kind]?.role === 'factory' && b.kind === 'bay');
    const fighting = !!this.fight && !this.fight.f.walk;
    if (!bay && !plan.some((p) => p[0] === 'bay') && (n >= 2 || fighting || !home) && s.alloys >= (D.bay?.cost ?? 0)) this.queue(['bay'], fighting);
    if (bay && bay.progress >= 1) {
      const army = this.soldiers().length + (bay.queue?.length ?? 0);
      const cap = sim.unitCap();
      // (at home the guns hold the colony: units only for a fight)
      const wantUnits = Math.min(cap, home ? (fighting ? 6 : this.saving ? 0 : guns.length >= Math.min(want, 8) ? 8 : 0) : fighting || this.objectiveFight() ? cap : 6);
      const reserve = home ? (guns.length >= 8 ? 20 : 120) : 40;
      if (army < wantUnits && (bay.queue?.length ?? 0) < 2) {
        for (let i = 0; i < ARMY.length; i++) {
          const k = ARMY[(this.armyIdx + i) % ARMY.length], u = content.units[k];
          if (!u || !sim.researched(u.research) || sim.story.locked(k)) continue;
          if (s.alloys < (u.cost ?? 0) + reserve || (s.isotopes ?? 0) < (u.isotopes ?? 0)) break;
          this.armyIdx += i + 1;
          this.command({ type: 'produce', id: bay.id, unit: k }, 'plan');
          break;
        }
      }
      this.salvage(bay);
    }
    return Math.max(0, want - guns.length);
  }

  /** Wrecks with alloys in them: a Field Engineer to strip them (it parks by the nearest). */
  private salvage(bay: Building) {
    const sim = this.sim, s = sim.s, eng = Object.keys(content.units).find((k) => content.units[k].repairRate && content.units[k].faction === 'accord' && content.units[k].cost !== undefined);
    const wrecks = (s.wrecks ?? []).filter((w) => w.alloys > 0 && !this.guarded(w, 20));
    if (!eng || !wrecks.length) return;
    const mine = (s.units ?? []).filter((u) => !u.team && u.unit === eng);
    if (!mine.length) {
      const u = content.units[eng];
      if (sim.researched(u.research) && s.alloys >= (u.cost ?? 0) + 40 && !(bay.queue ?? []).includes(eng) && sim.armySize() < sim.unitCap()) this.command({ type: 'produce', id: bay.id, unit: eng }, 'plan');
      return;
    }
    const e = mine[0];
    const w = [...wrecks].sort((a, b) => dist(a, e) - dist(b, e))[0];
    if (e.order.kind === 'idle' && dist(e, w) > 7) { this.command({ type: 'order', ids: [e.id], x: w.x, z: w.z }, 'army'); this.note('Sending an engineer to strip a wreck', w); }
  }

  /** Research of its own when the lab is idle and nothing a mission needs is waiting. */
  private research() {
    const sim = this.sim, s = sim.s;
    if (s.research?.active || !this.role('lab').some((b) => b.progress >= 1)) return;
    // Deep Survey first, as soon as the lab stands (the seams: isotopes for everything after)
    const first = content.research['deep-survey'];
    if (first && !s.research?.done.includes('deep-survey') && s.alloys >= first.cost) { this.command({ type: 'research', id: 'deep-survey' }, 'plan'); return; }
    const o = this.nextObjective(regionNow());
    if (o?.kind === 'researched' || this.saving) return;
    const reserve = s.expedition ? 150 : 100;
    // (research is the campaign's: an expedition spends what it brought on the way to the Launch Gantry first)
    const order = s.expedition ? ['deep-survey', 'isotope-cells', 'orbital-launch', ...RESEARCH] : RESEARCH;
    for (const id of order) {
      const r = content.research[id];
      if (!r || s.research?.done.includes(id)) continue;
      if (researchBlocked(r, content.research, content.buildings, sim.researchWorld())) continue;
      // save up for the next in line (an expedition: past one it hasn't the isotopes for)
      if (s.alloys < r.cost + reserve || (s.isotopes ?? 0) < (r.isotopes ?? 0)) { if (s.expedition && s.alloys >= r.cost + reserve) continue; return; }
      this.command({ type: 'research', id }, 'plan');
      return;
    }
  }

  // ---------- the army ----------

  /** Foes: wild hostiles (not asleep) and hostile factions' units and buildings. */
  private foes() {
    const sim = this.sim, s = sim.s;
    const wild = s.hostiles.filter((h) => !h.under);
    const theirs = [...this.others.units, ...this.others.buildings].filter((o) => sim.attitude(o.team ?? 0) === 'hostile');
    return [...wild, ...theirs] as (P & { id: number; hp: number; enc?: string; relic?: string; dormant?: boolean; nest?: number })[];
  }

  private flies(f: object) {
    const u = (f as { unit?: string }).unit;
    return !!u && content.units[u]?.move === 'air';
  }

  /** Strength: hit points × damage per second, summed. */
  private strength(l: { unit?: string; kind?: string; hp: number }[]) {
    return l.reduce((m, o) => {
      const d = o.unit ? content.units[o.unit] : o.kind ? content.buildings[o.kind] : undefined;
      if (!d) return m;
      const dps = (d.damage ?? 0) / Math.max(0.1, d.cooldown ?? 1);
      return m + Math.sqrt(o.hp * Math.max(1, dps) * 4);
    }, 0);
  }

  /** A site objective: someone walks there; with something guarding it, the army clears it first. */
  private go(x: number, z: number) {
    const s = this.sim.s, key = `${Math.round(x)},${Math.round(z)}`;
    this.asked.set(key, this.sim.secs);
    if (this.guarded({ x, z }) || s.pilot?.lost[key]) return; // the army sees to it (objectiveFight)
    const id = this.posted.get(key);
    const u = id !== undefined ? (s.units ?? []).find((v) => v.id === id) : undefined;
    if (u) { if (u.order.kind === 'idle' && dist(u, { x, z }) > 6) this.command({ type: 'order', ids: [u.id], x, z }, 'chase'); return; }
    const d = id !== undefined ? s.drones.find((v) => v.id === id) : undefined;
    if (d) { if (d.task.kind === 'idle' && dist(d, { x, z }) > 6) this.command({ type: 'move', drone: d.id, x, z }, 'chase'); return; }
    // someone not already posted at another site: an idle combat unit, else a drone
    const taken = new Set(this.posted.values());
    const free = this.soldiers().filter((v) => !taken.has(v.id) && v.order.kind === 'idle' && !this.mending.has(v.id)).sort((a, b) => dist(a, { x, z }) - dist(b, { x, z }))[0];
    if (free) { this.posted.set(key, free.id); this.command({ type: 'order', ids: [free.id], x, z }, 'chase'); return; }
    const dr = s.drones.filter((v) => !taken.has(v.id)).sort((a, b) => (a.task.kind === 'idle' ? 0 : 1) - (b.task.kind === 'idle' ? 0 : 1))[0];
    if (dr) { this.posted.set(key, dr.id); this.command({ type: 'move', drone: dr.id, x, z }, 'chase'); }
  }

  /** Something hostile within reach of a spot (wild or a hostile faction's), awake or asleep. */
  private guarded(p: P, r = 26) { return this.guards(p, r).length > 0; }
  private guards(p: P, r = 26) {
    // (a relic sentinel reaches 26 u, asleep or awake: one a little further off still guards the way in)
    // (asleep, a relic only scans us: it isn't in the way)
    return this.foes().filter((f) => f.nest === undefined && !f.dormant && dist(f, p) < (f.relic && content.units[(f as { unit?: string }).unit ?? '']?.relic === 'sentinel' ? r + 10 : r));
  }

  /**
   * What an objective under way here needs fought for (or walked to, or escorted): its flag traced back to what sets
   * it, a guarded site, kills, a faction to bring down. Null if nothing.
   */
  private objectiveFight(): Fight | null {
    const sim = this.sim, s = sim.s, m = s.missions, here = regionNow();
    if (!m) return null;
    const R = content.regions[here];
    // escorts first: a faction's encounter whose loss fails a mission under way here
    for (const id of m.active) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) continue;
      for (const f of def.fails ?? []) for (const x of conditionsIn(f.kind as Condition, f as unknown as ConditionDef)) {
        if (x.kind !== 'flag' || !x.c.flag) continue;
        const enc = (R?.encounters ?? []).find((e) => e.doneFlag === x.c.flag && e.faction);
        const them = enc ? this.others.units.filter((u) => u.enc === enc.id) : [];
        if (them.length) return { at: centre(them), why: `Escorting ${content.regions[here]?.factions?.find((q) => q.id === enc!.faction)?.name ?? 'them'}`, escort: true };
      }
    }
    for (const id of m.active) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) continue;
      for (const [i, o] of def.objectives.entries()) {
        if (m.marks[id]?.includes(i)) continue;
        const parts = conditionsIn(o.kind as Condition, o as unknown as ConditionDef);
        for (const x of parts) {
          if ((x.c as { not?: boolean }).not) continue;
          const f = this.need(x.kind, x.c, 0);
          if (f) return f;
        }
        // several sites at once (hold all three plates): the force splits between them
        const sites = o.kind === 'all' ? parts.filter((x) => x.kind === 'site').map((x) => (R?.sites ?? []).find((q) => q.id === x.c.site)).filter((q) => !!q) : [];
        if (sites.length >= 2) return { at: sites[0]!, why: `Holding ${sites.length} places at once`, split: sites as P[] };
      }
    }
    return null;
  }

  /** What meeting one condition takes (`depth`: how far back along flags and events). */
  private need(kind: Condition, c: ConditionDef, depth: number): Fight | null {
    const sim = this.sim, s = sim.s, here = regionNow(), R = content.regions[here], st = s.story;
    if (depth > 4) return null;
    const has = (f: string) => !!st?.flags.includes(f);
    const foes = this.foes();
    switch (kind) {
      case 'site': case 'explored': {
        const site = (content.regions[here]?.sites ?? []).find((x) => x.id === c.site);
        if (!site) return null;
        const near = this.guards(site);
        if (near.length) {
          return { at: centre(near), why: `Clearing the way to ${placeName(site.label ?? site.id)}` };
        }
        // the one sent there was lost on the way: everyone goes
        if (s.pilot?.lost[`${Math.round(site.x)},${Math.round(site.z)}`]) return { at: site, why: `Going in force to ${placeName(site.label ?? site.id)}` };
        return depth ? { at: site, why: `Going to ${placeName(site.label ?? site.id)}`, walk: true } : null; // (chase walks to its own sites)
      }
      case 'kills': {
        if (s.stats.kills >= (c.count ?? 1)) return null;
        const wild = s.hostiles.filter((h) => h.nest === undefined && !h.relic && !h.under).sort((a, b) => dist(a, this.core()) - dist(b, this.core()));
        return wild.length ? { at: wild[0], why: 'Hunting' } : null;
      }
      case 'factionLost': {
        const f = s.factions?.find((q) => q.id === c.faction);
        if (!f || sim.attitude(f.team) !== 'hostile') return null;
        const b = this.others.buildings.filter((q) => q.team === f.team).sort((a, q) => dist(a, this.core()) - dist(q, this.core()))[0];
        return b ? { at: b, target: b.id, why: `Attacking ${f.name}` } : null;
      }
      case 'after': {
        const ev = c.event ? content.story[c.event] : undefined;
        if (!ev || st?.fired.includes(c.event!)) return null;
        for (const x of conditionsIn(ev.trigger as Condition, ev as unknown as ConditionDef)) {
          if ((x.c as { not?: boolean }).not) continue;
          const f = this.need(x.kind, x.c, depth + 1);
          if (f) return f;
        }
        return null;
      }
      case 'flag': {
        const flag = c.flag;
        if (!flag || has(flag)) return null;
        // an encounter here that sets it when beaten
        for (const e of R?.encounters ?? []) {
          if (e.doneFlag !== flag) continue;
          if (e.faction && sim.attitude(s.factions?.find((q) => q.id === e.faction)?.team ?? 0) !== 'hostile') continue;
          const them = foes.filter((f) => f.enc === e.id);
          if (them.length) return { at: centre(them), why: `Fighting the ${content.units[e.unit]?.name ?? e.unit}s` };
          if (e.flag && !has(e.flag)) { const f = this.need('flag', { flag: e.flag } as ConditionDef, depth + 1); if (f) return f; }
        }
        // a relic grid that sets it when opened: its nodes
        const g = /^relic-(.+)-opened$/.exec(flag);
        if (g) {
          const nodes = s.hostiles.filter((h) => h.relic === g[1] && content.units[h.unit]?.relic === 'node').sort((a, b) => dist(a, this.core()) - dist(b, this.core()));
          if (nodes.length) return { at: nodes[0], why: 'Breaking the relic grid' };
        }
        // an outpost that sets it when destroyed (a hostile faction's only)
        for (const o of R?.outposts ?? []) {
          if (o.story !== flag) continue;
          const b = this.others.buildings.find((q) => dist(q, o) < 3);
          if (b && sim.attitude(b.team ?? 0) === 'hostile') return { at: b, target: b.id, why: `Attacking the ${content.buildings[b.kind]?.name ?? b.kind}` };
        }
        // a story event (here, or anywhere) that sets it: what fires it
        for (const [id, ev] of Object.entries(content.story)) {
          if ((ev.region && ev.region !== here) || st?.fired.includes(id)) continue;
          if (!(ev.effects ?? []).some((x) => x.kind === 'flag' && x.flag === flag)) continue;
          for (const x of conditionsIn(ev.trigger as Condition, ev as unknown as ConditionDef)) {
            if ((x.c as { not?: boolean }).not) continue;
            const f = this.need(x.kind, x.c, depth + 1);
            if (f) return f;
          }
        }
        return null;
      }
      default: return null;
    }
  }

  /**
   * Every 3 s: defend what is attacked (at home the garrison, all of it when it's close), else fight for the
   * objective (an escort stays with them), pull back units below a third of their health to mend, and come home idle.
   */
  private army(here: string) {
    const sim = this.sim, s = sim.s, now = sim.secs, home = here === HOME_REGION;
    const units = this.soldiers();
    if (!units.length) { this.fight = null; return; }
    const ours = this.ours(), foes = this.foes(), core = this.core();
    const rally = this.ours('repairpad')[0] ?? this.ours('bay')[0] ?? core;
    const order = (ids: number[], p: P, why?: string) => {
      if (!ids.length) return;
      this.command({ type: 'order', ids, x: p.x, z: p.z }, 'army');
      if (why) this.note(why, p);
    };
    // mending: a unit worn down goes back to the pad until it's mostly whole
    for (const u of units) {
      const max = content.units[u.unit]?.hp ?? 1;
      if (this.mending.has(u.id)) { if (u.hp > max * 0.85 || !this.ours('repairpad').length) this.mending.delete(u.id); continue; }
      if (u.hp < max * 0.3 && this.ours('repairpad').length && dist(u, rally) > 15) { this.mending.add(u.id); order([u.id], rally); }
    }
    for (const id of this.mending) if (!units.some((u) => u.id === id)) this.mending.delete(id);
    const fit = units.filter((u) => !this.mending.has(u.id));
    const posted = new Set(this.posted.values());
    for (const [k, id] of this.posted) {
      const gone = !units.some((u) => u.id === id) && !s.drones.some((d) => d.id === id);
      if (gone) { const l = (s.pilot ??= { lost: {} }).lost; l[k] = (l[k] ?? 0) + 1; }
      if (gone || now - (this.asked.get(k) ?? 0) > 12) this.posted.delete(k);
    }
    // raiders at our buildings: the nearest units go (all of them at home when it's at the Core)
    // (flyers are for the point defence: ground units can't hit them)
    const air = units.some((u) => content.units[u.unit]?.antiAir);
    const raid = foes.filter((f) => f.nest === undefined && !f.dormant && (air || !this.flies(f)) && ours.some((b) => dist(b, f) < 40));
    let f = this.objectiveFight();
    // nothing to fight for: a raid on a nest (that side's packs stop until it grows back)
    if ((!f || f.walk) && !raid.length) {
      if (f?.walk) this.go(f.at.x, f.at.z);
      const nf = this.nestRaid(fit.filter((u) => !posted.has(u.id)));
      if (nf) f = nf;
    }
    if (raid.length) {
      // the group nearest the Core (raiders on two sides: one at a time, not the middle between them)
      const first = [...raid].sort((a, b) => dist(a, core) - dist(b, core))[0];
      const c = centre(raid.filter((r) => dist(r, first) < 25));
      const atCore = dist(c, core) < 45;
      const free = fit.filter((u) => !posted.has(u.id) && (u.order.kind === 'idle' || atCore) && (atCore || !f || dist(u, c) < 50));
      const send = free.filter((u) => dist(u, c) > 10);
      if (send.length && (atCore || this.strength(free) > this.strength(raid as never) * 0.5 || !f)) { order(send.map((u) => u.id), c, 'Units out to meet hostiles'); }
      if (atCore && home) return;
    }
    if (!f || f.walk) {
      // nothing to fight for: back to the rally point when idle and far
      if (f?.walk && raid.length) this.go(f.at.x, f.at.z);
      this.fight = null;
      if (!raid.length) {
        const far = fit.filter((u) => u.order.kind === 'idle' && u.target < 0 && !posted.has(u.id) && dist(u, rally) > 30);
        if (far.length) order(far.map((u) => u.id), { x: rally.x, z: rally.z - 12 });
      }
      return;
    }
    if (!this.fight || dist(this.fight.f.at, f.at) > 30 || this.fight.f.why !== f.why) this.fight = { f, since: now, sent: -1e9 };
    this.fight.f = f;
    // the strike force: at home a garrison stays (a third, at least two) unless the fight is close by
    const keep = home && dist(f.at, core) > 60 ? Math.max(2, Math.floor(fit.length / 3)) : 0;
    const byCore = [...fit].sort((a, b) => dist(a, core) - dist(b, core));
    const force = byCore.slice(keep).filter((u) => !posted.has(u.id));
    if (!force.length) return;
    if (f.split) {
      // one group to each place (a unit already standing on one stays there)
      const n = f.split.length, groups: Unit[][] = f.split.map(() => []);
      const left = [...force];
      f.split.forEach((p, i) => { const k = left.findIndex((u) => dist(u, p) < 8); if (k >= 0) groups[i].push(...left.splice(k, 1)); });
      left.forEach((u, i) => groups[i % n].push(u));
      if (now - this.fight.sent > 6) {
        this.fight.sent = now;
        f.split.forEach((p, i) => { const go = groups[i].filter((u) => u.order.kind === 'idle' && dist(u, p) > 6); if (go.length) order(go.map((u) => u.id), p); });
        this.note(f.why, f.at);
      }
      return;
    }
    if (f.escort) {
      // stay with them: a little ahead, every 6 s
      const lag = force.filter((u) => dist(u, f.at) > 12);
      if (lag.length && now - this.fight.sent > 6) { order(lag.map((u) => u.id), f.at, f.why); this.fight.sent = now; }
      return;
    }
    const there = foes.filter((q) => dist(q, f.at) < 30);
    const mine = this.strength(force), theirs = this.strength(there as never);
    const waited = now - this.fight.since;
    const ready = mine >= theirs * 1.3 || waited > 240 || force.length >= sim.unitCap() - 1;
    if (!ready) {
      // gather by the rally point while more are made
      const far = force.filter((u) => u.order.kind === 'idle' && dist(u, rally) > 25 && dist(u, f.at) > 40);
      if (far.length) order(far.map((u) => u.id), rally);
      if (now - this.doing.t > 10) this.note(`Gathering for: ${f.why.toLowerCase()} (${force.length} units)`, rally);
      return;
    }
    // worn out: pull back (and wait for more)
    const hp = force.reduce((m, u) => m + u.hp / (content.units[u.unit]?.hp ?? 1), 0) / force.length;
    if (hp < 0.35 && force.length < 3 && waited < 400) { order(force.map((u) => u.id), rally, 'Pulling back to mend'); this.fight.since = now - 120; return; }
    if (now - this.fight.sent < 8) return;
    const idle = force.filter((u) => u.order.kind === 'idle' && u.target < 0 && dist(u, f.at) > 8);
    if (!idle.length) return;
    this.fight.sent = now;
    if (f.target !== undefined) { this.command({ type: 'attack', ids: idle.map((u) => u.id), target: f.target }, 'army'); this.note(f.why, f.at); }
    else order(idle.map((u) => u.id), f.at, f.why);
  }

  /**
   * A standing nest to raid, once the army is big enough (five or more fit, strong enough for what stands round it):
   * the nearest first. A raid under way carries on while its nest stands.
   */
  private nestRaid(fit: Unit[]): Fight | null {
    const s = this.sim.s, core = this.core();
    const nests = s.hostiles.filter((h) => h.nest !== undefined).sort((a, b) => dist(a, core) - dist(b, core));
    if (!nests.length) return null;
    const cur = this.fight?.f.nest !== undefined ? nests.find((n) => n.id === this.fight!.f.nest) : undefined;
    const n = cur ?? (fit.length >= 5 ? nests[0] : undefined);
    if (!n) return null;
    const dir = Math.atan2(n.x - core.x, n.z - core.z) * 180 / Math.PI;
    const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return { at: n, why: `Raiding the nest to the ${names[(Math.round(dir / 45) + 8) % 8]}`, nest: n.id };
  }

  // ---------- missions and travel ----------

  /** Regions off this world with a mission under way there, routed or visited. */
  private offWorld(here: string) {
    const s = this.sim.s, c = s.campaign, body = (r: string) => content.regions[r]?.body ?? 'home';
    if (!c || !s.missions) return [];
    return s.missions.active.map((id) => content.missions[id]?.region ?? HOME_REGION).filter((r) => body(r) !== body(here) && (c.routes.includes(r) || c.visited.includes(r)));
  }

  /** The first objective not yet met of a mission under way here. */
  private nextObjective(here: string) {
    const m = this.sim.s.missions;
    for (const id of m?.active ?? []) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) continue;
      const i = def.objectives.findIndex((_, k) => !m!.marks[id]?.includes(k));
      if (i >= 0) return { mission: id, index: i, text: def.objectives[i].text, kind: def.objectives[i].kind };
    }
    return null;
  }

  /**
   * Missions elsewhere: once none is under way here (or those here haven't moved for 5 minutes), go where one is (its region routed or visited): overland
   * from home on this world, by a Launch Gantry off it; an expedition goes home (the Core's "Return to
   * Touchdown"), and on from there. Not while a card waits, a cinematic plays, hostiles are at the colony or it has
   * only just arrived.
   */
  private travel(here: string) {
    const sim = this.sim, s = sim.s, c = s.campaign, m = s.missions, st = s.story;
    if (!c || !m || s.travel || s.over) return;
    if (st && (st.inbox.length || (st.cineQueue ?? []).length)) return;
    const home = here === HOME_REGION;
    if (sim.secs - this.since < (home ? 90 : 30)) return;
    // an expedition's lab half way through a project: see it done (research is the campaign's)
    if (!home && s.research?.active && sim.secs - this.since < 360) return;
    // not in the middle of a fight (the colony is saved as it is, and the fight waits for us)
    const ours = s.buildings.filter((b) => !b.team);
    // (at most two minutes: a pack that lingers out of reach doesn't keep us here for good)
    const fight = s.hostiles.some((h) => s.packs.some((p) => p.id === h.pack) && ours.some((b) => Math.abs(b.x - h.x) < 60 && Math.abs(b.z - h.z) < 60));
    if (!fight) this.fightSince = -1;
    else if (this.fightSince < 0) this.fightSince = sim.secs;
    if (fight && sim.secs - this.fightSince < 120) return;
    // (and never while the Core itself is under attack, up to 6 minutes: we would come back to it falling)
    const core = this.core();
    if (home && s.hostiles.some((h) => h.nest === undefined && !h.dormant && dist(h, core) < 45) && sim.secs - this.fightSince < 360) return;
    const where = (id: string) => content.missions[id]?.region ?? HOME_REGION;
    // a mission here keeps us here while it moves (an objective met in the last 5 minutes, or only just begun; 8 with the assist)
    const now = sim.secs;
    for (const id of m.active) {
      const n = m.marks[id]?.length ?? 0, p = this.moved.get(id);
      if (!p || p.n !== n) this.moved.set(id, { n, at: now });
    }
    // (with the assist on, long enough for it to step in first)
    const wait = this.cfg.assist ? (this.cfg.assistMinutes ?? 6) * 60 + 120 : 300;
    // a fight for one of them under way: give it longer (the army is being built for it)
    const stuck = (id: string) => now - (this.moved.get(id)?.at ?? now) > wait * (this.fight && !this.fight.f.walk ? 2 : 1);
    const hereOnes = m.active.filter((id) => where(id) === here);
    if (hereOnes.some((id) => !stuck(id))) return;
    const body = (r: string) => content.regions[r]?.body ?? 'home';
    const gantry = s.buildings.some((b) => content.buildings[b.kind]?.role === 'launch' && b.progress >= 1);
    const reach = (r: string) => r !== here && !!content.regions[r] && (c.routes.includes(r) || c.visited.includes(r)) && (!home || body(r) === body(here) || gantry);
    // home with a mission stuck here: only for one elsewhere (the story's own before an optional one, and an optional
    // one tried twice without getting anywhere only when there's nothing else); an expedition with one stuck: home
    const optional = (id: string) => /^optional/i.test(content.missions[id]?.summary ?? '');
    const tried = (r: string) => (c.pilotTrips?.[r] ?? 0) >= 2;
    const order = [...m.active.filter((id) => !optional(id)), ...m.active.filter((id) => optional(id) && !tried(where(id))), ...m.active.filter((id) => optional(id) && tried(where(id)))];
    const to = home ? order.map(where).find(reach) : HOME_REGION;
    if (!to) return;
    // an expedition left with its missions there still under way: a trip that got nowhere
    if (!home && hereOnes.length) (c.pilotTrips ??= {})[here] = (c.pilotTrips[here] ?? 0) + 1;
    s.travel = to;
    this.note(`Travelling to ${content.regions[to]?.name ?? to}`);
  }

  /**
   * Assist: an objective here that hasn't moved for N minutes is ticked off (the inspector's way), logged; and at
   * home with missions waiting off this world and no Launch Gantry for as long, a gantry (and its research) is set up.
   */
  private assist(here: string) {
    const sim = this.sim, s = sim.s, m = s.missions, now = sim.secs, limit = (this.cfg.assistMinutes ?? 6) * 60;
    if (!m) return;
    if (here === HOME_REGION && s.campaign) {
      const off = this.offWorld(here);
      const gantry = Object.entries(content.buildings).find(([, d]) => d.role === 'launch');
      if (!off.length || !gantry || s.buildings.some((b) => b.kind === gantry[0] && !b.team)) this.offSince = -1;
      else if (this.offSince < 0) this.offSince = now;
      else if (now - this.offSince > limit) {
        const research: string[] = [];
        for (let r = gantry[1].research; r && !research.includes(r); r = content.research[r]?.requires) research.unshift(r);
        sim.command({ type: 'debug', setup: { buildings: [gantry[0]], research } });
        this.say(`Autopilot assist: a ${gantry[1].name} set up (${off.length} mission${off.length > 1 ? 's' : ''} waiting off this world for ${Math.round((now - this.offSince) / 60)} min)`);
        this.offSince = -1;
      }
    }
    // (a fight being built up for gets longer: the army may still win it)
    const fighting = this.fight && !this.fight.f.walk ? 2 : 1;
    for (const id of m.active) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) { this.progress.delete(id); continue; }
      const n = m.marks[id]?.length ?? 0, p = this.progress.get(id);
      if (!p || p.n !== n) { this.progress.set(id, { n, at: now }); continue; }
      if (now - p.at < limit * fighting) continue;
      // a clock (a sol, a countdown) isn't stuck: it comes by itself
      const i = def.objectives.findIndex((o, k) => !m.marks[id]?.includes(k) && o.kind !== 'time' && o.kind !== 'timer');
      if (i < 0) continue;
      sim.command({ type: 'inspect', objective: { mission: id, index: i } });
      this.say(`Autopilot assist: ${def.title}: “${def.objectives[i].text}” ticked off (no progress for ${Math.round((now - p.at) / 60)} min)`);
      this.progress.set(id, { n: n + 1, at: now });
      this.note(`Assist: ${def.objectives[i].text}`);
    }
  }

  /**
   * Assist: predators at a Command Core below half its strength are sent away and the next pack held back 4 minutes
   * (every 45 s at most, 10 s below a quarter): wild ones only (not nests or relic guards, not a faction's units). And a
   * cryo bank below the safe level (50%, where embryos start to die) is brought back to 75% (every 2 minutes at most).
   */
  private defend() {
    const sim = this.sim, s = sim.s, core = s.buildings.find((b) => b.kind === 'core' && !b.team);
    // the cryo bank about to fail (the colony's power gone under the packs): kept going (every 3 minutes at most)
    // (embryos die below the people rules' safe level: it is kept above that)
    const safe = content.people.cryoSafe ?? 50;
    if (!s.expedition && s.people && s.cryo < safe && sim.secs - this.lastCryo > 120) {
      this.say(`Autopilot assist: the cryo bank at ${Math.round(s.cryo)}% kept from failing (back to ${safe + 25}%)`);
      s.cryo = safe + 25;
      this.lastCryo = sim.secs;
    }
    const max = content.buildings.core?.hp ?? 2000;
    // (sooner again when it's nearly gone)
    if (!core || core.hp > max * 0.5 || sim.secs - this.lastDefend < (core.hp < max * 0.25 ? 10 : 45)) return;
    const near = s.hostiles.filter((h) => h.nest === undefined && !h.relic && Math.hypot(h.x - core.x, h.z - core.z) < 70);
    if (!near.length) return;
    s.hostiles = s.hostiles.filter((h) => !near.includes(h));
    for (const p of s.packs) p.alive = s.hostiles.filter((h) => h.pack === p.id).length;
    s.waves.next = Math.max(s.waves.next, s.tick + 240 * HZ);
    this.lastDefend = sim.secs;
    this.say(`Autopilot assist: ${near.length} hostile${near.length > 1 ? 's' : ''} at the Command Core sent away; the next pack held back 4 min`);
  }

  /** For the renderer: the caption and the places worth a look. */
  status(): PilotStatus {
    const sim = this.sim, s = sim.s, st = s.story;
    const out: PilotStatus = { doing: this.doing.text, at: this.doing.at };
    const sx = st?.strikes?.[0];
    if (sx) out.strike = { x: sx.x, z: sx.z };
    // a fight: hostiles (wild ones and enemy factions' units) close to ours
    const ours = [...s.buildings.filter((b) => !b.team), ...(s.units ?? []).filter((u) => !u.team)];
    const foes = [...s.hostiles, ...(s.units ?? []).filter((u) => u.team && u.target >= 0)];
    const close = foes.filter((h) => ours.some((o) => Math.abs(o.x - h.x) < 25 && Math.abs(o.z - h.z) < 25));
    if (close.length) out.fight = { x: close.reduce((a, h) => a + h.x, 0) / close.length, z: close.reduce((a, h) => a + h.z, 0) / close.length };
    // the card on screen: its site or camp
    const ev = st?.inbox.length ? content.story[st.inbox[0]] : undefined;
    if (ev) {
      for (const x of conditionsIn(ev.trigger as Condition, ev as unknown as ConditionDef)) {
        const site = x.c.site ? sim.story.region().sites.find((p) => p.id === x.c.site) : undefined;
        const camp = x.c.group ? (s.camps ?? []).find((p) => p.group === x.c.group) : undefined;
        if (site || camp) { out.card = { x: (site ?? camp)!.x, z: (site ?? camp)!.z }; break; }
      }
    }
    const w = this.walker;
    if (w) {
      const u = w.drone ? s.drones.find((d) => d.id === w.id) : (s.units ?? []).find((x) => x.id === w.id);
      if (!u || Math.hypot(u.x - w.x, u.z - w.z) < 6) this.walker = null;
      else out.group = { x: u.x, z: u.z };
    }
    // the army on its way to a fight
    if (!out.group && this.fight && !this.fight.f.walk) {
      const mine = (s.units ?? []).filter((u) => !u.team && u.order.kind === 'move');
      if (mine.length) out.group = centre(mine);
    }
    const up = s.buildings.filter((b) => !b.team && b.progress < 1).pop();
    if (up) out.build = { x: up.x, z: up.z };
    const core = s.buildings.find((b) => b.kind === 'core' && !b.team);
    if (core) out.core = { x: core.x, z: core.z };
    return out;
  }
}
