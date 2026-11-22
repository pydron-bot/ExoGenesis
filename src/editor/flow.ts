/**
 * Story flow: one page that shows how missions and story events link up.
 *
 *   Campaign  the mission chain in order (each mission's objectives, and the
 *             events it fires or that wait on it), then missions nothing starts
 *   Events    every story event, grouped by what fires it, with what it leads
 *             to (choices → flags set, events started)
 *   Flags     each flag: what sets it, what waits on it, what it blocks
 *   Problems  things that can never happen: a flag nobody sets, an event that
 *             waits on a missing one, a "never" event nothing starts, a mission
 *             loop
 *
 * Read-only; every name is a link that opens the record. `analyzeFlow` is pure
 * (the editor smoke test checks it).
 */
import { CONDITION_HELP, EFFECT_HELP, conditionsIn, type Condition, type ConditionDef, type EffectDef, type MissionDef, type StoryDef, type StoryEffect } from '../content/defs';

export { conditionsIn };

export interface FlowLink { coll: 'missions' | 'story'; id: string }
export interface FlowProblem { at: FlowLink; msg: string }
export interface FlagUse { setBy: FlowLink[]; clearedBy: FlowLink[]; waits: FlowLink[]; blocks: FlowLink[] }

export interface Flow {
  /** Mission chains, each from a mission that follows nothing, in order (branches after their parent). */
  chain: string[];
  /** Missions not reachable from a start (they follow a missing mission, or a loop). */
  stray: string[];
  flags: Map<string, FlagUse>;
  /** Counters: what changes them (setBy), what waits on them. */
  counters: Map<string, FlagUse>;
  /** Countdowns: what starts them (setBy), stops them (clearedBy), waits for them to run out. */
  timers: Map<string, FlagUse>;
  problems: FlowProblem[];
}


/** Short form of an effect: "add 60 alloys", "spawn 4× brute at ridge". */
export function effectShort(e: Partial<EffectDef>): string {
  switch (e.kind) {
    case 'counter': return `${e.counter ?? '?'} ${(e.amount ?? 0) >= 0 ? '+' : ''}${e.amount ?? '?'}`;
    case 'setCounter': return `${e.counter ?? '?'} = ${e.amount ?? '?'}`;
    case 'countdown': return `countdown ${e.timer ?? '?'} (${e.amount ?? '?'} s)`;
    case 'stopCountdown': return `stop countdown ${e.timer ?? '?'}`;
    case 'spawn': return `spawn ${e.count && e.count > 1 ? `${e.count}× ` : ''}${e.unit ?? '?'} at ${e.site ?? '?'}${e.guard ? ' (guarding)' : ''}`;
    case 'research': return `research ${e.research ?? '?'} done`;
    case 'lock': case 'unlock': return `${e.kind} ${[e.building, e.unit].filter(Boolean).join(', ') || '?'}`;
    case 'reveal': return `reveal ${e.site ?? '?'}`;
    case 'waypoint': return `waypoint at ${e.site ?? '?'}`;
    case 'clearWaypoint': return e.site ? `clear waypoint ${e.site}` : 'clear waypoints';
    case 'camera': return `camera to ${e.site ?? e.building ?? '?'}`;
    case 'hint': return `hint at ${e.target === 'buildItem' ? e.building ?? '?' : e.target ?? '?'}`;
    case 'unhint': return 'clear hint';
    case 'win': return 'WIN';
    case 'fail': return 'LOSE';
    case 'cinematic': return `play ${e.cinematic ?? '?'}`;
    case 'attitude': return `${e.faction ?? '?'} ${e.attitude ?? '?'}`;
    case 'strike': return `orbital strike on ${e.site ?? e.building ?? 'a random building'} (${e.amount || 400} dmg, ${e.radius ?? 10} u, in ${e.delay ?? 6} s)`;
    case 'corrupt': return `corrupt ${e.count ?? 1}× ${e.unit ?? 'combat unit'}`;
    case 'glitch': return `Clause glitch: ${e.glitch ?? '?'}${e.glitch === 'pod' ? ` (${e.seconds || 8} s)` : ''}`;
    case 'epilogue': return `EPILOGUE: ${e.ending ?? '?'} (${e.pages?.length ?? 0} page${e.pages?.length === 1 ? '' : 's'})`;
    case 'travel': return `travel to ${e.region ?? '?'}`;
    case 'route': return `route to ${e.region ?? '?'}`;
    case 'unroute': return `no route to ${e.region ?? '?'}`;
    case 'mission': return `start mission ${e.mission ?? '?'}`;
    case 'outpost': {
      const which = e.story ? `outpost ${e.story}` : e.site ? `${e.faction ?? 'faction'} outposts at ${e.site}${e.radius ? ` (${e.radius} u)` : ''}` : `${e.faction ?? '?'}'s outposts`;
      return `${e.outcome ?? '?'} ${which}`;
    }
    case undefined: return '?';
    default: return EFFECT_HELP[e.kind as StoryEffect].replace('Amount', String(e.amount ?? '?')).replace(/ \(.*\)/, '').replace('the Group', e.group ?? '?').replace('the Flag', `flag ${e.flag ?? '?'}`).replace('the Event', e.event ?? '?');
  }
}

const flagsSet = (effects: EffectDef[] | undefined) => (effects ?? []).filter((e) => e.kind === 'flag' && e.flag).map((e) => e.flag!);

/** `known`: flags something other than the story sets (a map encounter's "beaten" flag). */
export function analyzeFlow(missions: Record<string, MissionDef>, story: Record<string, StoryDef>, known: Set<string> = new Set()): Flow {
  const problems: FlowProblem[] = [];
  // ---- campaign order: depth-first from missions that follow nothing
  const kids = new Map<string, string[]>();
  for (const [id, m] of Object.entries(missions)) if (m.after) kids.set(m.after, [...(kids.get(m.after) ?? []), id]);
  const chain: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    chain.push(id);
    for (const k of (kids.get(id) ?? []).sort()) walk(k);
  };
  for (const id of Object.keys(missions).filter((x) => !missions[x].after).sort()) walk(id);
  const stray = Object.keys(missions).filter((x) => !seen.has(x)).sort();
  for (const id of stray) {
    const after = missions[id].after!;
    problems.push({ at: { coll: 'missions', id }, msg: missions[after] ? `never starts: it follows "${after}", which is in a loop or never starts` : `never starts: it follows "${after}", which doesn't exist` });
  }

  // ---- flags
  const flags = new Map<string, FlagUse>(), counters = new Map<string, FlagUse>(), timers = new Map<string, FlagUse>();
  const useIn = (m: Map<string, FlagUse>) => (f: string) => { let u = m.get(f); if (!u) m.set(f, (u = { setBy: [], clearedBy: [], waits: [], blocks: [] })); return u; };
  const use = useIn(flags), useC = useIn(counters), useT = useIn(timers);
  const wants = (c: ConditionDef, kind: Condition, at: FlowLink) => {
    for (const x of conditionsIn(kind, c)) {
      if (x.kind === 'flag' && x.c.flag) use(x.c.flag).waits.push(at);
      if ((x.kind === 'counter' || x.kind === 'counterBelow') && x.c.counter) useC(x.c.counter).waits.push(at);
      if (x.kind === 'timer' && x.c.timer) useT(x.c.timer).waits.push(at);
      if (x.kind === 'failed' && x.c.mission && missions[x.c.mission] && !missions[x.c.mission].fails?.length) problems.push({ at, msg: `waits for mission "${x.c.mission}" to fail, but it has no fail conditions` });
    }
  };
  const does = (effects: EffectDef[] | undefined, at: FlowLink) => {
    for (const f of flagsSet(effects)) use(f).setBy.push(at);
    for (const e of effects ?? []) {
      if (e.kind === 'unflag' && e.flag) use(e.flag).clearedBy.push(at);
      if ((e.kind === 'counter' || e.kind === 'setCounter') && e.counter) useC(e.counter).setBy.push(at);
      if (e.kind === 'countdown' && e.timer) useT(e.timer).setBy.push(at);
      if (e.kind === 'stopCountdown' && e.timer) useT(e.timer).clearedBy.push(at);
      if (e.kind === 'research' && e.research) use(`research-${e.research}`).setBy.push(at);
      if (e.kind === 'glitch') useC('clause').setBy.push(at);
    }
  };
  for (const [id, ev] of Object.entries(story)) {
    const at: FlowLink = { coll: 'story', id };
    does(ev.effects, at);
    wants(ev, ev.trigger, at);
    if (ev.unless) use(ev.unless).blocks.push(at);
    // a choice offered only with (or without) a flag
    for (const c of ev.choices ?? []) {
      if (c.ifFlag) use(c.ifFlag).waits.push(at);
      if (c.unlessFlag) use(c.unlessFlag).blocks.push(at);
    }
  }
  for (const [id, m] of Object.entries(missions)) {
    const at: FlowLink = { coll: 'missions', id };
    does(m.rewards, at);
    for (const o of m.objectives ?? []) wants(o, o.kind, at);
    for (const f of m.fails ?? []) wants(f, f.kind, at);
  }
  // flags the game itself sets (research-<id>, wreck-found, relic-woke…) are never "missing"
  const builtin = (f: string) => /^(research|contact|trust|relic)-/.test(f) || /-attacked$/.test(f) || ['wreck-found', 'relic-woke', 'relic-opened', 'nest-destroyed', 'inhabitants-met', 'walkout'].includes(f) || known.has(f);
  for (const [f, u] of flags) {
    if (!u.setBy.length && !builtin(f)) for (const w of u.waits) problems.push({ at: w, msg: `waits for flag "${f}", which nothing sets` });
  }
  for (const [f, u] of counters) if (!u.setBy.length) for (const w of u.waits) problems.push({ at: w, msg: `waits on counter "${f}", which nothing changes` });
  for (const [f, u] of timers) if (!u.setBy.length) for (const w of u.waits) problems.push({ at: w, msg: `waits for countdown "${f}", which nothing starts` });

  // ---- events that can't fire
  const startedBy = (id: string) =>
    Object.values(story).some((e) => e.effects?.some((x) => x.kind === 'event' && x.event === id)) ||
    Object.values(missions).some((m) => m.onStart === id || m.onDone === id || m.onFail === id || m.rewards?.some((x) => x.kind === 'event' && x.event === id));
  for (const [id, ev] of Object.entries(story)) {
    const at: FlowLink = { coll: 'story', id };
    if (ev.trigger === 'never' && !startedBy(id)) problems.push({ at, msg: 'trigger is "never" and nothing starts it' });
    if (ev.trigger === 'after' && ev.event && !story[ev.event]) problems.push({ at, msg: `follows event "${ev.event}", which doesn't exist` });
    if (ev.trigger === 'mission' && ev.mission && stray.includes(ev.mission)) problems.push({ at, msg: `waits on mission "${ev.mission}", which never starts` });
  }
  return { chain, stray, flags, counters, timers, problems };
}

// ---------- rendering ----------
export interface FlowHost {
  missions: Record<string, MissionDef>;
  story: Record<string, StoryDef>;
  /** Flags the maps set (encounters' "beaten" flags). */
  known?: Set<string>;
  open(link: FlowLink): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

/** Short form of a condition: "built solar", "2 drones", "Sol 4". */
export function condText(kind: Condition, c: ConditionDef): string {
  const n = c.count ?? 1;
  const pl = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  switch (kind) {
    case 'start': return 'on deploy';
    case 'time': return `Sol ${c.sol ?? '?'}`;
    case 'built': return `built ${n > 1 ? `${n}× ` : ''}${c.building ?? '?'}`;
    case 'placed': return `placed ${c.building ?? '?'}`;
    case 'colonists': return pl(n, 'colonist');
    case 'pod': return 'a growth pod running';
    case 'firstAge': return `first colonist ${c.count ?? 1} years old`;
    case 'acceptance': return `acceptance ≥ ${c.count ?? 1}`;
    case 'distrust': return `acceptance ≤ ${c.count ?? 1}`;
    case 'births': return pl(n, 'birth');
    case 'deaths': return pl(n, 'death');
    case 'units': return pl(n, 'combat unit');
    case 'drones': return pl(n, 'drone');
    case 'packs': return `${pl(n, 'pack')} destroyed`;
    case 'kills': return `${pl(n, 'hostile')} killed`;
    case 'lost': return `${pl(n, 'building')} lost`;
    case 'alloys': return `${n} alloys held`;
    case 'researched': return `researched ${c.research ?? '?'}`;
    case 'site': return `reach site ${c.site ?? '?'}`;
    case 'explored': return `see site ${c.site ?? '?'}`;
    case 'contact': return `meet ${c.group ?? '?'}`;
    case 'trust': return `${c.group ?? '?'} trust us`;
    case 'flag': return `flag ${c.flag ?? '?'}`;
    case 'counter': return `${c.counter ?? '?'} ≥ ${c.count ?? 0}`;
    case 'counterBelow': return `${c.counter ?? '?'} ≤ ${c.count ?? 0}`;
    case 'timer': return `countdown ${c.timer ?? '?'} out`;
    case 'opened': return `opened ${c.panel ?? '?'}${c.panel === 'select' && c.building ? ` ${c.building}` : ''}`;
    case 'after': return `after ${c.event ?? '?'}`;
    case 'mission': return `mission ${c.mission ?? '?'} done`;
    case 'failed': return `mission ${c.mission ?? '?'} failed`;
    case 'planet': return `planet health ≥ ${c.count ?? 0}`;
    case 'planetBelow': return `planet health ≤ ${c.count ?? 0}`;
    case 'reports': return pl(n, 'Biosphere Report');
    case 'cryoBelow': return `cryo bank ≤ ${c.count ?? 0}%`;
    case 'biomassBelow': return `biomass ≤ ${c.count ?? 0}`;
    case 'embryosBelow': return `embryos ≤ ${c.count ?? 0}`;
    case 'injured': return `${pl(n, 'colonist')} injured`;
    case 'children': return pl(n, 'child').replace('childs', 'children');
    case 'autonomists': return pl(n, 'Autonomist');
    case 'devoted': return `${n} Devoted`;
    case 'striking': return `${n} on strike`;
    case 'linesGone': return `${pl(n, 'line')} gone`;
    case 'regard': return `${c.group ?? '?'} regard ≥ ${c.count ?? 0}`;
    case 'regardBelow': return `${c.group ?? '?'} regard ≤ ${c.count ?? 0}`;
    case 'here': return `playing ${c.place ?? '?'}`;
    case 'visited': return `been to ${c.place ?? '?'}`;
    case 'all': case 'any': return (c.of ?? []).map((x) => `${x.not ? 'not ' : ''}${condText(x.kind as Condition, x as ConditionDef)}`).join(kind === 'all' ? ' and ' : ' or ') || `(empty ${kind} group)`;
    case 'never': return 'only when started';
    case 'faction': return `${c.faction ?? '?'} ${c.attitude ?? '?'}`;
    case 'factionLost': return `${c.faction ?? '?'} outposts gone`;
    case 'partners': return pl(n, 'Partner');
    case 'majority': return `${c.stance ?? '?'}s the largest group`;
    case 'coreLost': return 'the Command Core falls';
    case 'homePlanet': return `home planet health ≥ ${c.count ?? 0}`;
    case 'night': return 'at night';
  }
}

export function renderFlow(main: HTMLElement, aside: HTMLElement, host: FlowHost) {
  const { missions, story } = host;
  const flow = analyzeFlow(missions, story, host.known);
  const link = (l: FlowLink, label?: string) => {
    const a = h('a', `fl-link ${l.coll}`, label ?? (l.coll === 'missions' ? missions[l.id]?.title : story[l.id]?.title) ?? l.id);
    a.href = `#${l.coll}/${l.id}.json`;
    a.title = `${l.coll === 'missions' ? 'Mission' : 'Story event'} ${l.id}`;
    a.onclick = (e) => { e.preventDefault(); host.open(l); };
    return a;
  };
  const ev = (id: string) => link({ coll: 'story', id });
  const effLine = (e: EffectDef): Node => {
    if (e.kind === 'event' && e.event) return h('span', '', 'starts ', ev(e.event));
    if (e.kind === 'flag' || e.kind === 'unflag') return h('span', '', `${e.kind === 'flag' ? 'sets' : 'clears'} `, h('code', '', e.flag ?? '?'));
    return h('span', 'dim', effectShort(e));
  };

  // ---- campaign
  const camp = h('div', 'fl-camp');
  const depth = new Map<string, number>();
  for (const id of [...flow.chain, ...flow.stray]) {
    const m = missions[id];
    const d = m.after && depth.has(m.after) ? depth.get(m.after)! + (missions[m.after] && flow.chain.filter((x) => missions[x].after === m.after).length > 1 ? 1 : 0) : 0;
    depth.set(id, d);
    const box = h('div', `fl-mission${flow.stray.includes(id) ? ' stray' : ''}`);
    box.style.marginLeft = `${d * 24}px`;
    box.append(h('div', 'fl-head', link({ coll: 'missions', id }), m.region ? h('small', '', ` · ${m.region}`) : null));
    const obj = h('ol', 'fl-obj');
    for (const o of m.objectives ?? []) obj.append(h('li', '', o.text || '(no text)', h('small', '', ` · ${condText(o.kind, o)}`)));
    box.append(obj);
    const out: Node[] = [];
    if (m.onStart) out.push(h('div', '', '▶ at start: ', ev(m.onStart)));
    for (const e of m.rewards ?? []) out.push(h('div', '', '★ reward: ', effLine(e)));
    if (m.onDone) out.push(h('div', '', '■ when done: ', ev(m.onDone)));
    for (const f of m.fails ?? []) out.push(h('div', '', `✕ fails: ${condText(f.kind, f)}${m.failEnds ? ' (ends the game)' : ''}`));
    if (m.onFail) out.push(h('div', '', '✕ when failed: ', ev(m.onFail)));
    for (const [sid, s] of Object.entries(story)) if (s.trigger === 'mission' && s.mission === id) out.push(h('div', '', '→ then fires ', ev(sid)));
    if (out.length) box.append(h('div', 'fl-out', ...out));
    camp.append(box);
  }
  if (!flow.chain.length && !flow.stray.length) camp.append(h('p', 'note', 'No missions yet.'));

  // ---- events by trigger
  const evs = h('div', 'fl-events');
  const by = new Map<Condition, string[]>();
  for (const [id, e] of Object.entries(story)) by.set(e.trigger, [...(by.get(e.trigger) ?? []), id]);
  for (const [kind, ids] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    evs.append(h('div', 'fl-kind', `Fires ${CONDITION_HELP[kind]}`));
    for (const id of ids.sort()) {
      const e = story[id];
      const card = h('div', 'fl-event');
      const why = kind === 'after' && e.event ? h('span', '', ' after ', ev(e.event))
        : kind === 'mission' && e.mission ? h('span', '', ' after ', link({ coll: 'missions', id: e.mission }))
        : kind === 'flag' ? h('span', '', ' on ', h('code', '', e.flag ?? '?'))
        : kind === 'start' || kind === 'never' ? null : h('small', 'dim', ` ${condText(kind, e)}`);
      card.append(h('div', 'fl-head', ev(id), why, e.unless ? h('small', 'dim', ' unless ', h('code', '', e.unless)) : null, e.region ? h('small', 'dim', ` · ${e.region}`) : null));
      const lines: Node[] = [];
      const at0 = (e.effects ?? []).filter((x) => (x.after ?? 0) === 0);
      if (at0.length) lines.push(h('div', '', 'fires: ', ...at0.flatMap((x, i) => [i ? ', ' : '', effLine(x)])));
      (e.choices ?? []).forEach((c, n) => {
        const fx = (e.effects ?? []).filter((x) => x.after === n + 1);
        const only = [c.ifFlag ? `if ${c.ifFlag}` : '', c.unlessFlag ? `unless ${c.unlessFlag}` : ''].filter(Boolean).join(', ');
        lines.push(h('div', '', h('b', '', `“${c.label}”`), only ? h('small', 'dim', ` (${only})`) : null, fx.length ? ' → ' : '', ...fx.flatMap((x, i) => [i ? ', ' : '', effLine(x)])));
      });
      for (const [sid, s] of Object.entries(story)) if (s.trigger === 'after' && s.event === id) lines.push(h('div', '', '→ then ', ev(sid)));
      if (lines.length) card.append(h('div', 'fl-out', ...lines));
      evs.append(card);
    }
  }
  if (!by.size) evs.append(h('p', 'note', 'No story events yet.'));

  // ---- flags
  const fl = h('div', 'fl-flags');
  const list = (ls: FlowLink[]) => (ls.length ? ls.flatMap((l, i) => [i ? ', ' : '', link(l)]) : [h('span', 'dim', '—')]);
  for (const [f, u] of [...flow.flags].sort((a, b) => a[0].localeCompare(b[0]))) {
    fl.append(h('div', `fl-flag${u.setBy.length ? '' : ' bad'}`, h('code', '', f),
      h('div', '', 'set by ', ...list(u.setBy)),
      u.clearedBy.length ? h('div', '', 'cleared by ', ...list(u.clearedBy)) : null,
      u.waits.length ? h('div', '', 'waited on by ', ...list(u.waits)) : null,
      u.blocks.length ? h('div', '', 'blocks ', ...list(u.blocks)) : null));
  }
  if (!flow.flags.size) fl.append(h('p', 'note', 'No flags yet.'));
  const named = (title: string, m: Map<string, FlagUse>, setWord: string, clearWord: string) => {
    if (!m.size) return [];
    return [h('div', 'group', title), ...[...m].sort((a, b) => a[0].localeCompare(b[0])).map(([f, u]) => h('div', `fl-flag${u.setBy.length ? '' : ' bad'}`, h('code', '', f),
      h('div', '', `${setWord} `, ...list(u.setBy)),
      u.clearedBy.length ? h('div', '', `${clearWord} `, ...list(u.clearedBy)) : null,
      u.waits.length ? h('div', '', 'waited on by ', ...list(u.waits)) : null))];
  };

  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Story flow'), h('div', 'path', 'How missions and story events link up. Click a name to open it.'))),
    h('div', 'flow',
      h('section', '', h('h2', '', 'Campaign'), camp),
      h('section', '', h('h2', '', 'Story events'), evs),
    ),
  );
  aside.replaceChildren(
    h('div', 'group', flow.problems.length ? `${flow.problems.length} problem${flow.problems.length > 1 ? 's' : ''}` : 'No problems'),
    ...flow.problems.map((p) => h('div', 'issue fl-problem', link(p.at), `: ${p.msg}`)),
    h('div', 'group', 'Flags'),
    fl,
    ...named('Counters', flow.counters, 'changed by', ''),
    ...named('Countdowns', flow.timers, 'started by', 'stopped by'),
  );
}
