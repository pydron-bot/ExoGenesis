/**
 * Story → Playthrough: the balance bot plays the campaign on the saved content
 * (src/sim/playthrough.ts, in a worker) while every story card is answered by
 * a policy (first choice, last, random). Shows each run's story timeline
 * (missions, events, choices, flags, counters) on a time axis, and what the
 * runs covered between them: events that never fired, choices nobody took,
 * missions that never started or never finished, how long each mission took.
 * Results stay while you move about the editor, and the run before stays
 * beside it for comparison.
 */
import type { Beat, ChoicePolicy, Coverage, PlaythroughResult } from '../sim/playthrough';
import { STRATEGIES } from '../sim/strategies';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const POLICY_HELP: Record<ChoicePolicy, string> = { first: 'always the first choice', last: 'always the last choice', random: 'a random choice', honest: 'the honest-sounding choice (truth, tell…), else the first' };
const state = {
  policies: new Set<ChoicePolicy>(['first', 'last', 'random']),
  strategy: 'people', minutes: 40, seed: 1337, region: 'touchdown', peaceful: false,
  running: null as { worker: Worker; current: string; left: number } | null,
  runs: [] as PlaythroughResult[],
  before: [] as PlaythroughResult[],
  coverage: null as Coverage | null,
  error: '',
  kinds: new Set<Beat['kind']>(['mission', 'objective', 'done', 'failed', 'event', 'choice', 'flag', 'counter', 'countdown', 'cinematic', 'travel', 'end']),
};
let redraw: () => void = () => {};

export interface PlaythroughHost {
  files(): Record<string, unknown>;
  regions: string[];
  /** Open a record (missions or story). */
  open(coll: 'missions' | 'story', id: string): void;
  /** Titles, for the coverage lists. */
  title(coll: 'missions' | 'story', id: string): string;
  /** A one-line description of an event's trigger. */
  trigger(id: string): string;
}

function run(host: PlaythroughHost) {
  if (state.running) return;
  const policies = [...state.policies];
  if (!policies.length) return;
  const worker = new Worker(new URL('./playthrough-worker.ts', import.meta.url), { type: 'module' });
  state.running = { worker, current: '', left: policies.length };
  state.error = '';
  state.before = state.runs;
  state.runs = [];
  worker.onmessage = (e: MessageEvent<{ type: string; name?: string; result?: PlaythroughResult; coverage?: Coverage; message?: string }>) => {
    const m = e.data;
    if (m.type === 'start') state.running!.current = m.name!;
    if (m.type === 'result') { state.runs.push(m.result!); state.running!.left--; }
    if (m.type === 'done') state.coverage = m.coverage!;
    if (m.type === 'error') state.error = m.message!;
    if (m.type === 'done' || m.type === 'error') { worker.terminate(); state.running = null; }
    redraw();
  };
  worker.onerror = (e) => { state.error = e.message || 'the worker failed'; worker.terminate(); state.running = null; redraw(); };
  worker.postMessage({ files: host.files(), policies, options: { strategy: state.strategy, minutes: state.minutes, seed: state.seed, region: state.region, peaceful: state.peaceful } });
  redraw();
}

const ICON: Record<Beat['kind'], string> = { mission: '▶', objective: '✓', done: '■', failed: '✕', event: '•', choice: '?', flag: '+', unflag: '−', counter: '#', countdown: '⏱', cinematic: '🎬', travel: '✈', end: '!' };
const KIND_LABEL: Partial<Record<Beat['kind'], string>> = { mission: 'missions', objective: 'objectives', event: 'events', choice: 'choices', flag: 'flags', counter: 'counters', countdown: 'countdowns', cinematic: 'cinematics', travel: 'travel' };

/** A run's missions as bars on a time axis, with the events as ticks under them. */
function timeline(r: PlaythroughResult, host: PlaythroughHost, span: number) {
  const W = 100;
  const x = (t: number) => `${Math.min(W, (t / span) * W).toFixed(2)}%`;
  const rows = h('div', 'pt-rows');
  for (const [id, m] of Object.entries(r.missions)) {
    if (m.start === undefined) continue;
    const end = m.done ?? m.failed ?? r.at * 60;
    const bar = h('div', `pt-bar${m.failed !== undefined ? ' failed' : m.done === undefined ? ' open' : ''}`);
    bar.style.left = x(m.start);
    bar.style.width = `max(3px, calc(${x(end)} - ${x(m.start)}))`;
    bar.title = `${host.title('missions', id)}: ${mmss(m.start)} → ${m.done !== undefined ? `done ${mmss(m.done)}` : m.failed !== undefined ? `failed ${mmss(m.failed)}` : 'not finished'}`;
    const lbl = h('a', 'pt-lbl', host.title('missions', id));
    lbl.onclick = () => host.open('missions', id);
    rows.append(h('div', 'pt-row', lbl, h('div', 'pt-track', bar)));
  }
  const ticks = h('div', 'pt-track pt-ticks');
  for (const b of r.beats) {
    if (b.kind !== 'event' && b.kind !== 'choice' && b.kind !== 'end') continue;
    const t = h('i', `pt-tick ${b.kind}`);
    t.style.left = x(b.t);
    t.title = `${mmss(b.t)} ${b.text}`;
    ticks.append(t);
  }
  rows.append(h('div', 'pt-row', h('span', 'pt-lbl dim', 'events'), ticks));
  const axis = h('div', 'pt-track pt-axis');
  for (let m = 0; m <= span / 60; m += span > 1800 ? 10 : 5) { const t = h('span', '', `${m}m`); t.style.left = x(m * 60); axis.append(t); }
  rows.append(h('div', 'pt-row', h('span', 'pt-lbl', ''), axis));
  return rows;
}

function runCard(r: PlaythroughResult, prev: PlaythroughResult | undefined, host: PlaythroughHost, span: number) {
  const outcome = r.over ? `${r.over === 'won' ? 'Won' : 'Ended'} (${r.over}) at ${r.at.toFixed(1)} min${r.overText ? `: ${r.overText}` : ''}` : `Played ${r.minutes} min`;
  const was = prev ? (prev.over ? `before: ended at ${prev.at.toFixed(1)} min` : 'before: played through') : '';
  const done = Object.values(r.missions).filter((m) => m.done !== undefined).length;
  const list = h('div', 'pt-beats');
  for (const b of r.beats) {
    if (!state.kinds.has(b.kind) && !(b.kind === 'unflag' && state.kinds.has('flag'))) continue;
    const coll = b.kind === 'event' || b.kind === 'choice' ? 'story' : b.kind === 'mission' || b.kind === 'done' || b.kind === 'failed' || b.kind === 'objective' ? 'missions' : null;
    const txt = coll ? h('a', 'fl-link', b.text) : h('span', '', b.text);
    if (coll) txt.onclick = () => host.open(coll, b.id);
    list.append(h('div', `pt-beat ${b.kind}`, h('span', 'pt-t', mmss(b.t)), h('span', 'pt-i', ICON[b.kind]), txt));
  }
  const fin = r.final;
  return h('div', `bal-run${r.over && r.over !== 'won' ? ' lost' : ''}`,
    h('div', 'bal-run-head', h('b', '', r.name), h('span', r.over && r.over !== 'won' ? 'bad' : 'good', ` ${outcome}`), was ? h('small', 'dim', ` · ${was}`) : null),
    h('div', 'bstats', h('span', 'bstat', 'missions done ', h('b', '', String(done))), h('span', 'bstat', 'events ', h('b', '', String(r.fired.length))),
      h('span', 'bstat', 'colonists ', h('b', '', String(fin.colonists))), h('span', 'bstat', 'stance ', h('b', '', fin.stance === null ? '—' : fin.stance.toFixed(0))),
      ...Object.entries(fin.counters).map(([k, v]) => h('span', 'bstat', `${k} `, h('b', '', String(v))))),
    timeline(r, host, span),
    h('details', 'bal-details', h('summary', '', `Story timeline (${r.beats.length})`), list));
}

function coverageBox(c: Coverage, host: PlaythroughHost, n: number) {
  const link = (coll: 'missions' | 'story', id: string) => { const a = h('a', 'fl-link', host.title(coll, id)); a.onclick = () => host.open(coll, id); return a; };
  const out: Node[] = [h('h2', 'bal-h', `Coverage over ${n} run${n > 1 ? 's' : ''}`)];
  const section = (title: string, items: Node[], good: string) => out.push(h('div', 'group', title), ...(items.length ? items : [h('div', 'help-block', good)]));
  section('Events no run fired', c.neverFired.map((id) => h('div', 'issue', link('story', id), h('small', 'dim', ` · ${host.trigger(id)}`))), 'Every event fired at least once.');
  section('Choices nobody took', Object.entries(c.untaken).map(([id, left]) => h('div', 'issue', link('story', id), `: ${left.map((x) => `“${x}”`).join(', ')}`)), 'Every choice was taken in some run.');
  section('Missions never started', c.missionsNeverStarted.map((id) => h('div', 'issue', link('missions', id))), 'Every mission started.');
  section('Missions started but never finished', c.missionsNeverDone.map((id) => h('div', 'issue', link('missions', id))), 'Every mission that started finished.');
  const sp = Object.entries(c.spread);
  if (sp.length) out.push(h('div', 'group', 'When each mission was done'), ...sp.sort((a, b) => a[1].min - b[1].min).map(([id, s]) =>
    h('div', '', link('missions', id), h('small', 'dim', ` · ${mmss(s.min)}${s.max !== s.min ? ` – ${mmss(s.max)}` : ''} (${s.runs}/${n} runs)`))));
  return out;
}

export function renderPlaythrough(main: HTMLElement, aside: HTMLElement, host: PlaythroughHost) {
  const draw = () => {
    const pol = h('div', 'bal-picks');
    for (const p of ['first', 'last', 'random'] as ChoicePolicy[]) {
      const box = h('input', '');
      box.type = 'checkbox';
      box.checked = state.policies.has(p);
      box.onchange = () => { if (box.checked) state.policies.add(p); else state.policies.delete(p); };
      pol.append(h('label', 'check', box, ` ${p}`, h('small', 'dim', ` (${POLICY_HELP[p]})`)));
    }
    const strat = h('select', 'bal-num');
    for (const [k, s] of Object.entries(STRATEGIES)) strat.append(Object.assign(h('option', '', k), { value: k, title: s.help }));
    strat.value = state.strategy;
    strat.onchange = () => { state.strategy = strat.value; };
    const num = (label: string, key: 'minutes' | 'seed', min: number, max: number) => {
      const inp = h('input', 'bal-num');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.value = String(state[key]);
      inp.onchange = () => { state[key] = Math.max(min, Math.min(max, Math.round(Number(inp.value) || min))); };
      return h('label', '', `${label} `, inp);
    };
    const region = h('select', 'bal-num');
    for (const id of host.regions) region.append(Object.assign(h('option', '', id), { value: id }));
    region.value = state.region;
    region.onchange = () => { state.region = region.value; };
    const peaceful = h('input', '');
    peaceful.type = 'checkbox';
    peaceful.checked = state.peaceful;
    peaceful.onchange = () => { state.peaceful = peaceful.checked; };
    const go = h('button', 'primary', state.running ? `Running ${state.running.current || '…'} (${state.running.left} left)` : '▶ Play through');
    go.disabled = !!state.running;
    go.onclick = () => run(host);
    const kinds = h('div', 'bal-picks');
    for (const [k, label] of Object.entries(KIND_LABEL) as [Beat['kind'], string][]) {
      const box = h('input', '');
      box.type = 'checkbox';
      box.checked = state.kinds.has(k);
      box.onchange = () => { if (box.checked) state.kinds.add(k); else state.kinds.delete(k); redraw(); };
      kinds.append(h('label', 'check', box, ` ${label}`));
    }
    const span = Math.max(60, ...state.runs.map((r) => r.at * 60));
    main.replaceChildren(...[
      h('div', 'head', h('div', '', h('h1', '', 'Playthrough'), h('div', 'path', 'The bot plays the campaign while each story card is answered by a policy: what the story did, and when.'))),
      h('div', 'help-block', 'The balance bot plays the saved content (the game\'s own sim, sped up) and works toward the objectives under way: it builds what they ask for, fabricates drones, researches, and sends a unit or drone to sites and camps. Cards are answered at once; cinematics count as played. The same runs are node tools/playthrough.mjs. Save first: unsaved edits aren\'t played.'),
      h('div', 'bal-opts', h('label', '', 'Bot ', strat), num('Minutes', 'minutes', 1, 120), num('Seed', 'seed', 1, 999999), h('label', '', 'Region ', region), h('label', 'check', peaceful, ' No predators'), go),
      h('div', '', h('small', 'dim', 'Answer cards with: '), pol),
      state.error ? h('div', 'issue', `Run failed: ${state.error}`) : null,
      state.runs.length ? h('div', '', h('small', 'dim', 'Show in the timelines: '), kinds) : null,
      ...state.runs.map((r, i) => runCard(r, state.before[i], host, span)),
    ].filter((x) => x !== null) as Node[]);
    aside.replaceChildren(...(state.coverage ? coverageBox(state.coverage, host, state.runs.length) : [h('div', 'group', 'Coverage'), h('div', 'help-block', 'Run a playthrough: events that never fired, choices nobody took and missions that never finished show here.')]));
  };
  // results arrive while the page may be closed: redraw only while it's showing
  redraw = () => { if (location.hash === '#playthrough') draw(); };
  draw();
}
