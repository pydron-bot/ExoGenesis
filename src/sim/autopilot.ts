/**
 * Autopilot (spectator mode), the brain in the sim worker (TECH.md "Autopilot"): the balance bot's build plan
 * (`BalanceBot`, src/sim/balance.ts) and the story playthrough's `chase` (src/sim/playthrough.ts) run on the
 * live game every tick, as they do headless, plus what only the real game has: travel between regions (it sets
 * `SimState.travel`, as a story `travel` effect does, and the renderer saves and goes), an optional assist that
 * finishes an objective that hasn't moved for a while, and what it is doing for the watcher (a caption and where
 * the camera might look). Story cards and cinematics are the renderer's (src/autopilot.ts): they are read on screen.
 */
import { content } from '../content';
import { conditionsIn, type Condition, type ConditionDef } from '../content/defs';
import { BalanceBot, STRATEGIES } from './balance';
import { HOME_REGION } from './campaign';
import { regionNow, type Sim } from './core';
import { chase } from './playthrough';
import type { Command } from './types';
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

/** The autopilot's build at home: the fortress strategy, then farms and homes (the people plan carries on from there). */
const HOME_PLAN = (): Step[] => [...STRATEGIES.fortress.plan(), ['hydroponics'], ['civic'], ['solar'], ['battery'], ['hydroponics'], ['depot', 'near']];

/** "The ritual loop round the pylon (E8)" → "the ritual loop round the pylon". */
const placeName = (label: string) => {
  const t = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return /^[A-Z][a-z]/.test(t) && !/^[A-Z][a-z]+ [A-Z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};
const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);

export class Autopilot {
  private bot: BalanceBot | null = null;
  private cfg: PilotConfig = { on: false };
  /** Game seconds when this region's play started (arrival or the autopilot switched on). */
  private since = -1;
  /** Per mission under way here: objectives met and when that last changed (seconds). */
  private progress = new Map<string, { n: number; at: number }>();
  private lastDefend = -1e9;
  private extra = 0;
  private fightSince = -1;
  private offSince = -1;
  /** Per mission under way: objectives met and when that last changed (seconds), for travel. */
  private moved = new Map<string, { n: number; at: number }>();
  private doing = { text: '', at: undefined as { x: number; z: number } | undefined, t: -1e9 };
  /** The unit (or drone) last sent to a site, while it walks there. */
  private walker: { id: number; drone: boolean; x: number; z: number } | null = null;

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
    this.sim.withTeam(0, () => this.think());
  }

  private note(text: string, at?: { x: number; z: number }) {
    if (this.sim.s.travel && !text.startsWith('Travelling')) return; // on the way out: that is the news
    this.doing = { text, at, t: this.sim.secs };
  }

  /** Every order goes through here: it says what the bot is doing. */
  private command = (c: Command, from: 'plan' | 'chase') => {
    const sim = this.sim, s = sim.s;
    sim.command(c);
    const B = content.buildings, U = content.units;
    switch (c.type) {
      case 'build': if (B[c.kind]) this.note(`Building ${article(B[c.kind].name)}`, { x: c.x, z: c.z }); break;
      case 'produce': if (U[c.unit]) this.note(`Producing ${article(U[c.unit].name)}`, s.buildings.find((b) => b.id === c.id)); break;
      case 'fab': this.note('Fabricating a drone'); break;
      case 'research': this.note(`Researching ${content.research[c.id]?.name ?? c.id}`); break;
      case 'ui': this.note(`Looking at the ${c.what.replace(/^select:/, '')} panel`); break;
      case 'order': case 'move': {
        if (from === 'plan') { if (this.sim.secs - this.doing.t > 8) this.note(s.hostiles.length ? 'Units out to meet hostiles' : 'Units back to the bay', { x: c.x, z: c.z }); break; }
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
      this.bot = new BalanceBot(sim, s.expedition ? 'mixed' : 'people', here, { pace: 1 });
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
      // a deposit no depot mines yet comes first
      if (s.deposits.some((d, i) => d.alloys > 0 && !s.buildings.some((b) => b.kind === 'depot' && b.mining === i))) this.bot.plan.push(['depot', 'near']);
      this.bot.plan.push(...more[this.extra++ % more.length]);
    }
    // missions waiting off this world: a Launch Gantry (again, if packs took it), once researched
    if (tick % (10 * HZ) === 0 && here === HOME_REGION && this.offWorld(here).length) {
      const g = Object.entries(content.buildings).find(([, d]) => d.role === 'launch');
      if (g && sim.researched(g[1].research) && !s.buildings.some((b) => b.kind === g[0] && !b.team) && !this.bot.plan.slice(0, 2).some((p) => p[0] === g[0])) this.bot.plan.unshift([g[0]]);
    }
    this.bot.step(tick);
    if (tick % (5 * HZ) === 0) chase(sim, this.bot.plan, tick, (c) => this.command(c, 'chase'));
    if (tick % (5 * HZ) === 0) this.travel(here);
    if (this.cfg.assist && tick % (10 * HZ) === 0) this.assist(here);
    if (this.cfg.assist && tick % (2 * HZ) === 0) this.defend();
    // nothing said for a while: what it is waiting for
    if (sim.secs - this.doing.t > 12 && tick % (5 * HZ) === 0) {
      const o = this.nextObjective(here);
      if (o) this.doing = { text: `Working on: ${o.text}`, at: undefined, t: sim.secs - 6 };
    }
  }

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
    // not in the middle of a fight (the colony is saved as it is, and the fight waits for us)
    const ours = s.buildings.filter((b) => !b.team);
    // (at most two minutes: a pack that lingers out of reach doesn't keep us here for good)
    const fight = s.hostiles.some((h) => s.packs.some((p) => p.id === h.pack) && ours.some((b) => Math.abs(b.x - h.x) < 60 && Math.abs(b.z - h.z) < 60));
    if (!fight) this.fightSince = -1;
    else if (this.fightSince < 0) this.fightSince = sim.secs;
    if (fight && sim.secs - this.fightSince < 120) return;
    const where = (id: string) => content.missions[id]?.region ?? HOME_REGION;
    // a mission here keeps us here while it moves (an objective met in the last 5 minutes, or only just begun; 8 with the assist)
    const now = sim.secs;
    for (const id of m.active) {
      const n = m.marks[id]?.length ?? 0, p = this.moved.get(id);
      if (!p || p.n !== n) this.moved.set(id, { n, at: now });
    }
    // (with the assist on, long enough for it to step in first)
    const wait = this.cfg.assist ? (this.cfg.assistMinutes ?? 6) * 60 + 120 : 300;
    const stuck = (id: string) => now - (this.moved.get(id)?.at ?? now) > wait;
    const hereOnes = m.active.filter((id) => where(id) === here);
    if (hereOnes.some((id) => !stuck(id))) return;
    const body = (r: string) => content.regions[r]?.body ?? 'home';
    const gantry = s.buildings.some((b) => content.buildings[b.kind]?.role === 'launch' && b.progress >= 1);
    const reach = (r: string) => r !== here && !!content.regions[r] && (c.routes.includes(r) || c.visited.includes(r)) && (!home || body(r) === body(here) || gantry);
    // home with a mission stuck here: only for one elsewhere; an expedition with one stuck: home
    const to = home ? m.active.map(where).find(reach) : HOME_REGION;
    if (!to) return;
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
    for (const id of m.active) {
      const def = content.missions[id];
      if (!def || (def.region ?? HOME_REGION) !== here) { this.progress.delete(id); continue; }
      const n = m.marks[id]?.length ?? 0, p = this.progress.get(id);
      if (!p || p.n !== n) { this.progress.set(id, { n, at: now }); continue; }
      if (now - p.at < limit) continue;
      // a clock (a sol, a countdown) isn't stuck: it comes by itself
      const i = def.objectives.findIndex((o, k) => !m.marks[id]?.includes(k) && o.kind !== 'time' && o.kind !== 'timer');
      if (i < 0) continue;
      sim.command({ type: 'inspect', objective: { mission: id, index: i } });
      this.say(`Autopilot assist: ${def.title}: “${def.objectives[i].text}” ticked off (no progress for ${Math.round((now - p.at) / 60)} min)`);
      this.progress.set(id, { n: n + 1, at: now });
      this.note(`Assist: ${def.objectives[i].text}`);
    }
  }

  /** Assist: hostiles at a Command Core that is about to fall are sent away (once a minute at most). */
  private defend() {
    const sim = this.sim, s = sim.s, core = s.buildings.find((b) => b.kind === 'core');
    if (!core || sim.secs - this.lastDefend < 60) return;
    if (core.hp > (content.buildings.core?.hp ?? 2000) * 0.35) return;
    // pack predators only (not nests or relic guards)
    const near = s.hostiles.filter((h) => h.nest === undefined && s.packs.some((p) => p.id === h.pack) && Math.hypot(h.x - core.x, h.z - core.z) < 70);
    if (!near.length) return;
    s.hostiles = s.hostiles.filter((h) => !near.includes(h));
    for (const p of s.packs) p.alive = s.hostiles.filter((h) => h.pack === p.id).length;
    s.waves.next = Math.max(s.waves.next, s.tick + 180 * HZ);
    this.lastDefend = sim.secs;
    this.say(`Autopilot assist: ${near.length} hostile${near.length > 1 ? 's' : ''} at the Command Core sent away; the next pack held back 3 min`);
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
    const up = s.buildings.filter((b) => !b.team && b.progress < 1).pop();
    if (up) out.build = { x: up.x, z: up.z };
    const core = s.buildings.find((b) => b.kind === 'core' && !b.team);
    if (core) out.core = { x: core.x, z: core.z };
    return out;
  }
}
