/**
 * Story playthroughs: the balance bot (src/sim/balance.ts) plays the colony
 * while this answers every story card, and records what the story did and
 * when: missions started, done and failed, events fired, choices taken, flags,
 * counters, countdowns, cinematics, and how the game ended. Several runs with
 * different choice policies show coverage: events that never fired, choices
 * nobody took, missions that never started.
 *
 * Campaign travel: the run stays in one region and one sim, with `sim.everywhere` on, so every region counts as
 * the one being played (story events and missions set elsewhere fire and are checked here, against their own
 * region's story sites, which the bot walks to on this map). A `travel` effect is recorded as a beat (and the
 * region as visited) instead of loading the region; what an expedition would bring and its map are not played.
 * A mission set in another region still waits, as in the game, until that region is routed or visited
 * (`anywhere: true` starts it as soon as its `after` is done, the rule before).
 *
 * Shared by `node tools/playthrough.mjs` and the editor's Story → Playthrough
 * page (in a worker on the editor's content, src/editor/playthrough-worker.ts).
 */
import { content } from '../content';
import { conditionsIn, shownChoices, type Condition, type ConditionDef } from '../content/defs';
import { runBalance } from './balance';
import type { Sim } from './core';
import type { Step } from './strategies';
import type { Command } from './types';

const TICK_HZ = 10;

/** How the bot answers a card with choices. */
export type ChoicePolicy = 'first' | 'last' | 'random' | 'honest';
export const POLICIES: Record<ChoicePolicy, string> = {
  first: 'always the first choice',
  last: 'always the last choice',
  random: 'a random choice (seeded)',
  honest: 'the honest-sounding choice (truth, tell, honest…), else the first',
};
/** Words that make a choice "honest" for that policy (whole words, any case). */
export const HONEST_WORDS = ['truth', 'true', 'tell', 'honest', 'honestly', 'admit', 'confess', 'explain', 'open', 'share', 'answer'];

/**
 * Which choice a policy takes: `offered` are the indices on offer (`shownChoices`), `labels` the full list's
 * labels, `rnd` a 0..1 random for `random`. Returns an index into the full list.
 */
export function pickChoice(policy: ChoicePolicy, offered: number[], labels: string[], rnd: () => number, words = HONEST_WORDS): number {
  const n = offered.length;
  if (!n) return 0;
  if (policy === 'last') return offered[n - 1];
  if (policy === 'random') return offered[Math.floor(rnd() * n)];
  if (policy === 'honest') {
    const re = new RegExp(`\\b(${words.join('|')})\\b`, 'i');
    const k = offered.find((i) => re.test(labels[i] ?? ''));
    if (k !== undefined) return k;
  }
  return offered[0];
}

export interface PlaythroughOptions {
  strategy?: string;
  minutes?: number;
  seed?: number;
  region?: string;
  peaceful?: boolean;
  policy?: ChoicePolicy;
  /** Fixed answers for some events: event id → choice index (0-based). */
  answers?: Record<string, number>;
  /** Seconds between the bot's build steps (see BalanceOptions.pace). */
  pace?: number;
  /**
   * Missions set in other regions start as soon as their `after` is done, routed or not (the rule before
   * round three of the story engine). Default: like the game, only once the region is routed or visited.
   */
  anywhere?: boolean;
  /** Called every tick after the story bookkeeping (measurements). */
  onTick?: (sim: Sim, tick: number, plan: Step[]) => void;
}

export type BeatKind = 'mission' | 'objective' | 'done' | 'failed' | 'event' | 'choice' | 'flag' | 'unflag' | 'counter' | 'countdown' | 'cinematic' | 'travel' | 'end';
export interface Beat { t: number; kind: BeatKind; id: string; text: string }

export interface PlaythroughResult {
  name: string;
  strategy: string;
  policy: ChoicePolicy;
  seed: number;
  minutes: number;
  /** Game minutes played. */
  at: number;
  over: string | null;
  overText?: string;
  beats: Beat[];
  /** Event id → choice index taken. */
  choices: Record<string, number>;
  /** Seconds when each mission started / finished / failed. */
  missions: Record<string, { start?: number; done?: number; failed?: number }>;
  fired: string[];
  final: { flags: string[]; counters: Record<string, number>; stance: number | null; wellbeing: number | null; colonists: number; alloys: number };
}

/** A little seeded random for the "random" policy (separate from the sim's). */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The bot plays the campaign: every few seconds it looks at the objectives
 * under way and works toward them (puts what they ask for at the front of its
 * build plan, fabricates drones, starts research, sends a unit or drone to a
 * site or a camp). Conditions it can't act on (time, packs…) it just waits for.
 */
export function chase(sim: Sim, plan: Step[], tick: number, cmd: (c: Command) => void = (c) => sim.command(c)) {
  const s = sim.s, m = s.missions;
  if (!m) return;
  const front = (step: Step) => { if (!plan.slice(0, 3).some((p) => p[0] === step[0])) plan.unshift(step); };
  const have = (kind: string) => s.buildings.filter((b) => b.kind === kind).length;
  const where = (kind: string): Step => {
    const role = content.buildings[kind]?.role;
    return role === 'depot' ? [kind, 'near'] : role === 'geothermal' ? [kind, 'vent'] : [kind];
  };
  const go = (x: number, z: number) => {
    // a combat unit if there is one, else an idle drone (once every 20 s)
    if (tick % (20 * TICK_HZ)) return;
    const u = (s.units ?? []).find((x) => x.order.kind === 'idle');
    if (u) { cmd({ type: 'order', ids: [u.id], x, z }); return; }
    const d = s.drones.find((x) => x.task.kind === 'idle') ?? s.drones[s.drones.length - 1];
    if (d) cmd({ type: 'move', drone: d.id, x, z });
  };
  let sites = sim.story.region().sites;
  const want = (kind: Condition, c: ConditionDef) => {
    const n = c.count ?? 1;
    switch (kind) {
      case 'built': case 'placed':
        if (c.building && have(c.building) < n && !sim.story.locked(c.building)) front(where(c.building));
        return;
      case 'drones': if (s.drones.length + s.fab.queued < n) front(['fab']); return;
      case 'units': {
        if ((s.units?.length ?? 0) >= n) return;
        const unit = Object.entries(content.units).filter(([k, u]) => u.faction === 'accord' && u.cost !== undefined && (u.move ?? 'ground') === 'ground' && sim.researched(u.research) && !sim.story.locked(k)).sort((a, b) => a[1].cost! - b[1].cost!)[0];
        if (!have('bay')) front(['bay']);
        else if (unit) front([unit[0]]);
        return;
      }
      case 'pod': case 'colonists': case 'firstAge': case 'births':
        if (!have('hydroponics')) front(['hydroponics']);
        if (!have('civic')) front(['civic']);
        return;
      case 'researched': {
        if (!c.research || s.research?.done.includes(c.research)) return;
        if (!have('lab')) { front(['lab']); return; }
        // the first research on the way to it that can start
        let r = c.research;
        for (let i = 0; i < 8; i++) {
          const q = content.research[r], need = [q?.requires, q?.also].find((x) => x && !s.research?.done.includes(x));
          if (need) r = need; else break;
        }
        // a building the project needs goes to the front of the plan
        const nb = content.research[r]?.building;
        if (nb && !have(nb)) front([nb]);
        if (!s.research?.active && tick % (5 * TICK_HZ) === 0) cmd({ type: 'research', id: r });
        return;
      }
      case 'site': case 'explored': {
        const site = sites.find((x) => x.id === c.site);
        if (site) go(site.x, site.z);
        return;
      }
      case 'contact': case 'trust': {
        const camp = (s.camps ?? []).find((x) => x.group === c.group && !x.gone);
        if (camp && (kind === 'contact' ? !camp.met : false)) go(camp.x * 0.85, camp.z * 0.85);
        return;
      }
      case 'planet':
        if (!have('seedbank')) front(['seedbank']);
        return;
      case 'opened':
        // the bot "opens" what a tutorial waits for
        if (c.panel) cmd({ type: 'ui', what: c.panel === 'select' && c.building ? `select:${c.building}` : c.panel });
        return;
      default: return;
    }
  };
  for (const id of m.active) {
    const def = content.missions[id];
    sites = sim.story.world(def?.region).sites;
    def?.objectives.forEach((o, i) => {
      if (m.marks[id]?.includes(i)) return;
      for (const x of conditionsIn(o.kind, o)) want(x.kind, x.c);
    });
  }
}

export function runPlaythrough(o: PlaythroughOptions = {}): PlaythroughResult {
  const strategy = o.strategy ?? 'people', policy = o.policy ?? 'first', seed = o.seed ?? 1337, minutes = o.minutes ?? 30;
  const beats: Beat[] = [];
  const choices: Record<string, number> = {};
  const missions: PlaythroughResult['missions'] = {};
  const pick = rng(seed * 31 + 7);
  let prev = { flags: new Set<string>(), counters: {} as Record<string, number>, fired: new Set<string>(), active: new Set<string>(), done: new Set<string>(), failed: new Set<string>(), marks: new Map<string, number>(), countdowns: new Set<string>() };
  let last: Sim | null = null;
  const add = (t: number, kind: BeatKind, id: string, text: string) => beats.push({ t: Math.round(t), kind, id, text });

  const hook = (sim: Sim, tick: number, plan: Step[]) => {
    last = sim;
    sim.everywhere = true;
    sim.everywhereStarts = !!o.anywhere;
    o.onTick?.(sim, tick, plan);
    if (tick % TICK_HZ) return;
    // travel: recorded, not played (see the top of this file)
    if (sim.s.travel) {
      const to = sim.s.travel, c = sim.s.campaign;
      add(sim.secs, 'travel', to, `Travel to ${content.regions[to]?.name ?? to}`);
      if (c && !c.visited.includes(to)) c.visited.push(to);
      delete sim.s.travel;
    }
    if (tick % (5 * TICK_HZ) === 0) chase(sim, plan, tick);
    const s = sim.s, st = s.story, t = sim.secs;
    if (!st) return;
    // headless: nothing plays cinematics, so they're "played" at once
    for (const id of st.cineQueue ?? []) { add(t, 'cinematic', id, content.cinematics[id]?.title ?? id); sim.command({ type: 'cinematic', id, done: true }); }
    // what changed since the last second
    for (const id of st.fired) if (!prev.fired.has(id)) add(t, 'event', id, content.story[id]?.title ?? id);
    const m = s.missions ?? { active: [], done: [], marks: {}, failed: [] };
    for (const id of m.active) if (!prev.active.has(id) && !prev.done.has(id)) { add(t, 'mission', id, content.missions[id]?.title ?? id); (missions[id] ??= {}).start = Math.round(t); }
    for (const id of m.active) {
      const n = m.marks[id]?.length ?? 0;
      if (n > (prev.marks.get(id) ?? 0)) for (const i of (m.marks[id] ?? []).slice(prev.marks.get(id) ?? 0)) add(t, 'objective', id, content.missions[id]?.objectives[i]?.text ?? `objective ${i + 1}`);
    }
    for (const id of m.done) if (!prev.done.has(id)) {
      // objectives met in the same check that finished it
      for (const i of (m.marks[id] ?? []).slice(prev.marks.get(id) ?? 0)) add(t, 'objective', id, content.missions[id]?.objectives[i]?.text ?? `objective ${i + 1}`);
      add(t, 'done', id, content.missions[id]?.title ?? id);
      (missions[id] ??= {}).done = Math.round(t);
    }
    for (const id of m.failed ?? []) if (!prev.failed.has(id)) { add(t, 'failed', id, content.missions[id]?.title ?? id); (missions[id] ??= {}).failed = Math.round(t); }
    for (const f of st.flags) if (!prev.flags.has(f)) add(t, 'flag', f, f);
    for (const f of prev.flags) if (!st.flags.includes(f)) add(t, 'unflag', f, f);
    for (const [k, v] of Object.entries(st.counters ?? {})) if (prev.counters[k] !== v) add(t, 'counter', k, `${k} = ${v}`);
    for (const c of st.countdowns ?? []) if (!prev.countdowns.has(c.id)) add(t, 'countdown', c.id, `${c.id}: ${Math.round((c.at - s.tick) / TICK_HZ)} s${c.text ? ` · ${c.text}` : ''}`);
    prev = {
      flags: new Set(st.flags), counters: { ...(st.counters ?? {}) }, fired: new Set(st.fired), active: new Set(m.active), done: new Set(m.done), failed: new Set(m.failed ?? []),
      marks: new Map(m.active.map((id) => [id, m.marks[id]?.length ?? 0])), countdowns: new Set((st.countdowns ?? []).map((c) => c.id)),
    };
    // answer the cards waiting, oldest first
    for (const id of [...st.inbox]) {
      const ev = content.story[id];
      // only the choices on offer now (some wait for a flag, or go with one); k is the index in the full list
      const offered = ev ? shownChoices(ev, st.flags) : [];
      const n = offered.length;
      let k = 0;
      if (n) {
        const fixed = o.answers?.[id];
        k = fixed !== undefined && offered.includes(fixed) ? fixed : pickChoice(policy, offered, ev.choices!.map((c) => c.label), pick);
        choices[id] = k;
        add(t, 'choice', id, `${ev.title}: “${ev.choices![k].label}”`);
      }
      sim.command({ type: 'story', id, choice: k });
    }
  };
  const r = runBalance(strategy, { minutes, seed, region: o.region, peaceful: o.peaceful, hook, pace: o.pace });
  const sim = last as Sim | null;
  const st = sim?.s.story, ppl = sim?.s.people;
  const avg = (f: (c: { stance: number; wb: number }) => number) => (ppl?.colonists.length ? ppl.colonists.reduce((m, c) => m + f(c), 0) / ppl.colonists.length : null);
  if (r.over) add(r.at * 60, 'end', r.over, sim?.s.overText || r.over);
  return {
    name: `${strategy} · ${policy}${o.answers && Object.keys(o.answers).length ? ' + fixed answers' : ''}`, strategy, policy, seed, minutes,
    at: r.at, over: r.over, overText: sim?.s.overText, beats, choices, missions, fired: [...(st?.fired ?? [])],
    final: {
      flags: [...(st?.flags ?? [])], counters: { ...(st?.counters ?? {}) },
      stance: avg((c) => c.stance), wellbeing: avg((c) => c.wb), colonists: ppl?.colonists.length ?? 0, alloys: Math.floor(sim?.s.alloys ?? 0),
    },
  };
}

/** What several runs covered between them. */
export interface Coverage {
  /** Events no run fired, with why (their trigger). */
  neverFired: string[];
  /** Choices no run took: event id → labels. */
  untaken: Record<string, string[]>;
  missionsNeverStarted: string[];
  missionsNeverDone: string[];
  /** Per mission: earliest and latest finish (s) across runs. */
  spread: Record<string, { min: number; max: number; runs: number }>;
}

export function coverage(runs: PlaythroughResult[]): Coverage {
  const fired = new Set(runs.flatMap((r) => r.fired));
  const neverFired = Object.keys(content.story).filter((id) => !fired.has(id)).sort();
  const untaken: Record<string, string[]> = {};
  for (const [id, ev] of Object.entries(content.story)) {
    if (!ev.choices?.length || !fired.has(id)) continue;
    const took = new Set(runs.map((r) => r.choices[id]).filter((x) => x !== undefined));
    const left = ev.choices.map((c, i) => (took.has(i) ? '' : c.label)).filter(Boolean);
    if (left.length) untaken[id] = left;
  }
  const started = new Set(runs.flatMap((r) => Object.entries(r.missions).filter(([, m]) => m.start !== undefined).map(([id]) => id)));
  const done = new Set(runs.flatMap((r) => Object.entries(r.missions).filter(([, m]) => m.done !== undefined).map(([id]) => id)));
  const spread: Coverage['spread'] = {};
  for (const r of runs) for (const [id, m] of Object.entries(r.missions)) {
    if (m.done === undefined) continue;
    const s = (spread[id] ??= { min: Infinity, max: -Infinity, runs: 0 });
    s.min = Math.min(s.min, m.done); s.max = Math.max(s.max, m.done); s.runs++;
  }
  return {
    neverFired, untaken,
    missionsNeverStarted: Object.keys(content.missions).filter((id) => !started.has(id)).sort(),
    missionsNeverDone: Object.keys(content.missions).filter((id) => started.has(id) && !done.has(id)).sort(),
    spread,
  };
}
