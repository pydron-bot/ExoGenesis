/**
 * Story → Endings ledger: every place the story moves something the endings
 * can read (stance, wellbeing, regard with each group, counters, flags), choice
 * by choice, with the range each can reach if every event fires (choices of one
 * card are either-or), and the thresholds triggers wait for, flagged when the
 * story can never reach them. `buildLedger` is pure (the editor smoke test
 * checks it).
 */
import { REPORT_COUNTERS } from '../sim/grade';
import { conditionsIn, type Condition, type ConditionDef, type EffectDef, type MissionDef, type StoryDef } from '../content/defs';
import { h } from './dom';

export interface LedgerRow {
  coll: 'missions' | 'story';
  id: string;
  title: string;
  /** "When it fires", a choice's label, or "Reward". */
  when: string;
  /** Choice index (1-based) or 0. */
  choice: number;
  deltas: Record<string, number>;
  /** Values set outright (setCounter). */
  sets: Record<string, number>;
  flags: string[];
}
export interface Threshold { measure: string; op: '≥' | '≤'; value: number; coll: 'missions' | 'story'; id: string; title: string; reachable: boolean }
export interface Ledger { measures: string[]; rows: LedgerRow[]; range: Record<string, { min: number; max: number }>; thresholds: Threshold[] }

const MEASURE: Partial<Record<EffectDef['kind'], (e: EffectDef) => string | null>> = {
  stance: () => 'stance', wellbeing: () => 'wellbeing', regard: (e) => (e.group ? `regard:${e.group}` : null), counter: (e) => (e.counter ? `counter:${e.counter}` : null),
  glitch: () => 'counter:clause', // each Clause glitch adds 1 to counter clause
};

export function buildLedger(missions: Record<string, MissionDef>, story: Record<string, StoryDef>): Ledger {
  const rows: LedgerRow[] = [];
  const measures = new Set<string>();
  const add = (row: LedgerRow, e: EffectDef) => {
    const m = MEASURE[e.kind]?.(e);
    if (m) { measures.add(m); row.deltas[m] = (row.deltas[m] ?? 0) + (e.kind === 'glitch' ? 1 : e.amount ?? 0); }
    if (e.kind === 'setCounter' && e.counter) { measures.add(`counter:${e.counter}`); row.sets[`counter:${e.counter}`] = e.amount ?? 0; }
    if (e.kind === 'flag' && e.flag) row.flags.push(e.flag);
  };
  const keep = (r: LedgerRow) => { if (Object.keys(r.deltas).length || Object.keys(r.sets).length || r.flags.length) rows.push(r); };
  for (const [id, ev] of Object.entries(story)) {
    const base = { coll: 'story' as const, id, title: ev.title || id };
    const r0: LedgerRow = { ...base, when: 'When it fires', choice: 0, deltas: {}, sets: {}, flags: [] };
    for (const e of ev.effects ?? []) if (!e.after) add(r0, e);
    keep(r0);
    (ev.choices ?? []).forEach((c, i) => {
      const r: LedgerRow = { ...base, when: `“${c.label}”`, choice: i + 1, deltas: {}, sets: {}, flags: [] };
      for (const e of ev.effects ?? []) if (e.after === i + 1) add(r, e);
      // a choice that changes nothing still counts (it's the 0 in the range)
      rows.push(r);
    });
  }
  for (const [id, m] of Object.entries(missions)) {
    const r: LedgerRow = { coll: 'missions', id, title: m.title || id, when: 'Reward', choice: 0, deltas: {}, sets: {}, flags: [] };
    for (const e of m.rewards ?? []) add(r, e);
    keep(r);
  }
  // each card's choices are either-or: the range takes the smallest and largest choice per card
  const range: Ledger['range'] = {};
  for (const m of measures) {
    let min = 0, max = 0;
    const byCard = new Map<string, number[]>();
    for (const r of rows) {
      const d = r.deltas[m] ?? 0;
      if (r.choice) byCard.set(`${r.coll}:${r.id}`, [...(byCard.get(`${r.coll}:${r.id}`) ?? []), d]);
      else { min += Math.min(0, d); max += Math.max(0, d); }
    }
    for (const ds of byCard.values()) { min += Math.min(0, ...ds); max += Math.max(0, ...ds); }
    // a counter set outright can land anywhere it's set to
    for (const r of rows) if (r.sets[m] !== undefined) { min = Math.min(min, r.sets[m]); max = Math.max(max, r.sets[m]); }
    range[m] = { min, max };
  }
  // counters the game keeps by itself (the report's streak) can reach any value
  for (const c of REPORT_COUNTERS) range[`counter:${c}`] = { min: 0, max: Infinity };
  // thresholds: what triggers and objectives wait for
  const thresholds: Threshold[] = [];
  const read = (kind: Condition, c: ConditionDef, coll: 'missions' | 'story', id: string, title: string) => {
    for (const x of conditionsIn(kind, c)) {
      if ((x.kind === 'counter' || x.kind === 'counterBelow') && x.c.counter) {
        const measure = `counter:${x.c.counter}`, value = x.c.count ?? 0, op = x.kind === 'counter' ? '≥' : '≤';
        const r = range[measure] ?? { min: 0, max: 0 };
        thresholds.push({ measure, op, value, coll, id, title, reachable: op === '≥' ? r.max >= value : r.min <= value });
      }
      if ((x.kind === 'acceptance' || x.kind === 'distrust') && x.c.count !== undefined) {
        // stance moves with the colony's own life as well as the story: always reachable, listed for reference
        thresholds.push({ measure: 'stance', op: x.kind === 'acceptance' ? '≥' : '≤', value: x.c.count, coll, id, title, reachable: true });
      }
    }
  };
  for (const [id, ev] of Object.entries(story)) read(ev.trigger, ev, 'story', id, ev.title || id);
  for (const [id, m] of Object.entries(missions)) for (const o of [...(m.objectives ?? []), ...(m.fails ?? [])]) read(o.kind, o, 'missions', id, m.title || id);
  const order = (m: string) => (m === 'stance' ? 0 : m === 'wellbeing' ? 1 : m.startsWith('regard') ? 2 : 3);
  return { measures: [...measures].sort((a, b) => order(a) - order(b) || a.localeCompare(b)), rows, range, thresholds };
}

// ---------- the page ----------
const label = (m: string) => (m.startsWith('counter:') ? `# ${m.slice(8)}` : m.startsWith('regard:') ? `regard ${m.slice(7)}` : m);

export function renderLedger(main: HTMLElement, aside: HTMLElement, host: { missions: Record<string, MissionDef>; story: Record<string, StoryDef>; open(coll: 'missions' | 'story', id: string): void }) {
  const L = buildLedger(host.missions, host.story);
  const link = (coll: 'missions' | 'story', id: string, text: string) => { const a = h('a', 'fl-link', text); a.onclick = () => host.open(coll, id); return a; };
  const t = h('table', 'bal ledger');
  t.append(h('tr', '', h('th', '', 'Record'), h('th', '', 'When'), ...L.measures.map((m) => h('th', '', label(m))), h('th', '', 'Flags')));
  let lastKey = '';
  for (const r of L.rows) {
    const key = `${r.coll}:${r.id}`;
    const tr = h('tr', key === lastKey ? 'cont' : '',
      h('td', '', key === lastKey ? '' : link(r.coll, r.id, r.title)),
      h('td', r.choice ? 'choice' : 'dim', r.when),
      ...L.measures.map((m) => {
        const d = r.deltas[m], set = r.sets[m];
        return h('td', d ? (d > 0 ? 'good' : 'bad') : 'dim', set !== undefined ? `= ${set}` : d ? `${d > 0 ? '+' : ''}${d}` : '·');
      }),
      h('td', 'dim', r.flags.join(', ')));
    t.append(tr);
    lastKey = key;
  }
  t.append(h('tr', 'total', h('td', '', 'Reachable'), h('td', 'dim', 'every event fires; each card\'s choices either-or'), ...L.measures.map((m) => h('td', '', `${L.range[m].min} … ${L.range[m].max}`)), h('td', '', '')));
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Endings ledger'), h('div', 'path', 'Every choice and reward that moves what the endings can read: stance, wellbeing, regard, counters and flags.'))),
    h('div', 'help-block', 'Stance and wellbeing also drift with the colony\'s own life, and regard with how you treat a group\'s land: the ranges here are only what the story itself adds. Counters only change through the story, so their ranges are exact (if every event fires).'),
    L.rows.length ? h('div', 'bal-wrap', t) : h('p', 'note', 'Nothing in the story moves stance, wellbeing, regard or counters yet.'),
  );
  const bad = L.thresholds.filter((x) => !x.reachable);
  aside.replaceChildren(
    h('div', 'group', bad.length ? `${bad.length} threshold${bad.length > 1 ? 's' : ''} the story can't reach` : 'Thresholds'),
    ...L.thresholds.map((x) => h('div', x.reachable ? '' : 'issue', link(x.coll, x.id, x.title), ` waits for ${label(x.measure)} ${x.op} ${x.value}`,
      x.reachable ? null : h('small', '', ` · the story reaches ${L.range[x.measure]?.min ?? 0} … ${L.range[x.measure]?.max ?? 0}`))),
    ...(L.thresholds.length ? [] : [h('div', 'help-block', 'No trigger or objective waits on a counter or on acceptance yet.')]),
  );
}
