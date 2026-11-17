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
import { CONDITION_HELP, EFFECT_HELP, type Condition, type ConditionDef, type EffectDef, type MissionDef, type StoryDef, type StoryEffect } from '../content/defs';

export interface FlowLink { coll: 'missions' | 'story'; id: string }
export interface FlowProblem { at: FlowLink; msg: string }
export interface FlagUse { setBy: FlowLink[]; clearedBy: FlowLink[]; waits: FlowLink[]; blocks: FlowLink[] }

export interface Flow {
  /** Mission chains, each from a mission that follows nothing, in order (branches after their parent). */
  chain: string[];
  /** Missions not reachable from a start (they follow a missing mission, or a loop). */
  stray: string[];
  flags: Map<string, FlagUse>;
  problems: FlowProblem[];
}

const flagsSet = (effects: EffectDef[] | undefined) => (effects ?? []).filter((e) => e.kind === 'flag' && e.flag).map((e) => e.flag!);

export function analyzeFlow(missions: Record<string, MissionDef>, story: Record<string, StoryDef>): Flow {
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
  const flags = new Map<string, FlagUse>();
  const use = (f: string) => { let u = flags.get(f); if (!u) flags.set(f, (u = { setBy: [], clearedBy: [], waits: [], blocks: [] })); return u; };
  const wants = (c: ConditionDef, kind: Condition, at: FlowLink) => { if (kind === 'flag' && c.flag) use(c.flag).waits.push(at); };
  for (const [id, ev] of Object.entries(story)) {
    const at: FlowLink = { coll: 'story', id };
    for (const f of flagsSet(ev.effects)) use(f).setBy.push(at);
    for (const e of ev.effects ?? []) if (e.kind === 'unflag' && e.flag) use(e.flag).clearedBy.push(at);
    wants(ev, ev.trigger, at);
    if (ev.unless) use(ev.unless).blocks.push(at);
  }
  for (const [id, m] of Object.entries(missions)) {
    const at: FlowLink = { coll: 'missions', id };
    for (const f of flagsSet(m.rewards)) use(f).setBy.push(at);
    for (const e of m.rewards ?? []) if (e.kind === 'unflag' && e.flag) use(e.flag).clearedBy.push(at);
    for (const o of m.objectives ?? []) wants(o, o.kind, at);
  }
  for (const [f, u] of flags) {
    if (!u.setBy.length) for (const w of u.waits) problems.push({ at: w, msg: `waits for flag "${f}", which nothing sets` });
  }

  // ---- events that can't fire
  const startedBy = (id: string) =>
    Object.values(story).some((e) => e.effects?.some((x) => x.kind === 'event' && x.event === id)) ||
    Object.values(missions).some((m) => m.onStart === id || m.onDone === id || m.rewards?.some((x) => x.kind === 'event' && x.event === id));
  for (const [id, ev] of Object.entries(story)) {
    const at: FlowLink = { coll: 'story', id };
    if (ev.trigger === 'never' && !startedBy(id)) problems.push({ at, msg: 'trigger is "never" and nothing starts it' });
    if (ev.trigger === 'after' && ev.event && !story[ev.event]) problems.push({ at, msg: `follows event "${ev.event}", which doesn't exist` });
    if (ev.trigger === 'mission' && ev.mission && stray.includes(ev.mission)) problems.push({ at, msg: `waits on mission "${ev.mission}", which never starts` });
  }
  return { chain, stray, flags, problems };
}

// ---------- rendering ----------
export interface FlowHost {
  missions: Record<string, MissionDef>;
  story: Record<string, StoryDef>;
  open(link: FlowLink): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

/** Short form of a condition: "built solar", "2 drones", "Sol 4". */
function condText(kind: Condition, c: ConditionDef) {
  const n = c.count ?? 1;
  switch (kind) {
    case 'start': return 'on deploy';
    case 'time': return `Sol ${c.sol ?? '?'}`;
    case 'built': return `built ${n > 1 ? `${n}× ` : ''}${c.building ?? '?'}`;
    case 'colonists': return `${n} colonist${n > 1 ? 's' : ''}`;
    case 'pod': return 'a growth pod running';
    case 'units': return `${n} combat unit${n > 1 ? 's' : ''}`;
    case 'drones': return `${n} drone${n > 1 ? 's' : ''}`;
    case 'packs': return `${n} pack${n > 1 ? 's' : ''} destroyed`;
    case 'site': return `reach site ${c.site ?? '?'}`;
    case 'contact': return `meet ${c.group ?? '?'}`;
    case 'trust': return `${c.group ?? '?'} trust us`;
    case 'flag': return `flag ${c.flag ?? '?'}`;
    case 'after': return `after ${c.event ?? '?'}`;
    case 'mission': return `mission ${c.mission ?? '?'} done`;
    case 'never': return 'only when started';
  }
}

export function renderFlow(main: HTMLElement, aside: HTMLElement, host: FlowHost) {
  const { missions, story } = host;
  const flow = analyzeFlow(missions, story);
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
    return h('span', 'dim', EFFECT_HELP[e.kind as StoryEffect].replace('Amount', String(e.amount ?? '?')).replace(/ \(.*\)/, '').replace('the Group', e.group ?? '?'));
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
        lines.push(h('div', '', h('b', '', `“${c.label}”`), fx.length ? ' → ' : '', ...fx.flatMap((x, i) => [i ? ', ' : '', effLine(x)])));
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
  );
}
