/**
 * The Balance page's test runs: the balance bot (src/sim/balance.ts) plays
 * strategies on the saved content in a worker, and each result shows how the
 * colony did: outcome, a few curves over time, and the change from the run
 * before (so "did my change help?" is one click).
 */
import type { BalanceResult } from '../sim/balance';
import { STRATEGIES } from '../sim/strategies';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

const state = {
  picked: new Set(['balanced', 'mixed', 'people']),
  minutes: 20, seed: 1337, region: 'touchdown', peaceful: false,
  running: null as { worker: Worker; current: string; left: number } | null,
  results: new Map<string, BalanceResult>(),
  /** The previous run of each strategy (for the change). */
  before: new Map<string, BalanceResult>(),
  error: '',
};
try { Object.assign(state, { picked: new Set(JSON.parse(localStorage.getItem('exo.balance.picked') ?? 'null') ?? state.picked) }); } catch { /* private mode */ }

let redraw: () => void = () => {};

export function runBalance(files: Record<string, unknown>) {
  if (state.running) return;
  const strategies = [...state.picked].filter((s) => STRATEGIES[s]);
  if (!strategies.length) return;
  const worker = new Worker(new URL('./balance-worker.ts', import.meta.url), { type: 'module' });
  state.running = { worker, current: '', left: strategies.length };
  state.error = '';
  worker.onmessage = (e: MessageEvent<{ type: string; name?: string; result?: BalanceResult; message?: string }>) => {
    const m = e.data;
    if (m.type === 'start') state.running!.current = m.name!;
    if (m.type === 'result') {
      const r = m.result!;
      const prev = state.results.get(r.name);
      if (prev) state.before.set(r.name, prev);
      state.results.set(r.name, r);
      state.running!.left--;
    }
    if (m.type === 'error') state.error = m.message!;
    if (m.type === 'done' || m.type === 'error') { worker.terminate(); state.running = null; }
    redraw();
  };
  worker.onerror = (e) => { state.error = e.message || 'the worker failed'; worker.terminate(); state.running = null; redraw(); };
  worker.postMessage({ files, strategies, options: { minutes: state.minutes, seed: state.seed, region: state.region, peaceful: state.peaceful } });
  redraw();
}

/** A small line chart of one number over the run's minutes. */
function spark(values: number[], prev: number[] | null, color: string, label: string, fmt = (v: number) => String(Math.round(v))) {
  const W = 150, H = 38, all = [...values, ...(prev ?? [])];
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const pts = (vs: number[]) => vs.map((v, i) => `${((i / Math.max(1, vs.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / (max - min)) * (H - 4)).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  if (prev?.length) {
    const p = document.createElementNS(ns, 'polyline');
    p.setAttribute('points', pts(prev));
    p.setAttribute('class', 'prev');
    svg.append(p);
  }
  const l = document.createElementNS(ns, 'polyline');
  l.setAttribute('points', pts(values));
  l.setAttribute('stroke', color);
  svg.append(l);
  return h('div', 'spark-box', h('div', 'spark-lbl', label, h('b', '', values.length ? fmt(values[values.length - 1]) : '—')), svg as unknown as Node);
}

function resultCard(r: BalanceResult, prev: BalanceResult | undefined) {
  const delta = (k: keyof BalanceResult['stats'], better: 1 | -1) => {
    if (!prev) return null;
    const d = r.stats[k] - prev.stats[k];
    if (!d) return null;
    return h('small', d * better > 0 ? 'good' : 'bad', ` ${d > 0 ? '+' : ''}${d}`);
  };
  const outcome = r.over ? `Lost (${r.over}) at ${r.at.toFixed(1)} min` : `Survived ${r.minutes} min`;
  const was = prev ? (prev.over ? `was lost at ${prev.at.toFixed(1)} min` : 'survived before') : '';
  const series = (vs: (row: BalanceResult['rows'][number]) => number, res?: BalanceResult) => res?.rows.map(vs) ?? null;
  const num = (s: string) => Number(s.split(/[ +]/)[0]);
  const ppl = (row: BalanceResult['rows'][number]) => row.people.split('+').reduce((m, x) => m + Number(x), 0);
  const stat = (label: string, k: keyof BalanceResult['stats'], better: 1 | -1) => h('span', 'bstat', `${label} `, h('b', '', String(r.stats[k])), delta(k, better));
  const details = h('details', 'bal-details');
  const t = h('table', 'bal');
  const cols: (keyof BalanceResult['rows'][number])[] = ['min', 'alloys', 'cryo', 'gen', 'draw', 'built', 'hostiles', 'units', 'kills', 'lost', 'packs', 'people', 'food', 'wb', 'stance'];
  t.append(h('tr', '', ...cols.map((c) => h('th', '', c))));
  for (const row of r.rows) t.append(h('tr', '', ...cols.map((c) => h('td', '', String(row[c])))));
  details.append(h('summary', '', 'Minute by minute, and what happened'), h('div', 'bal-wrap', t),
    h('div', 'bal-events', ...r.events.map((e) => h('div', e.level === 'bad' ? 'bad' : e.level === 'warn' ? 'warn' : '', `${(e.t / 60).toFixed(1).padStart(5)}m  ${e.text}`))),
    h('div', 'dim', r.people), h('div', 'dim', `first placed (s): ${Object.entries(r.firsts).map(([k, v]) => `${k} ${v}`).join(', ')}`));
  return h('div', `bal-run${r.over ? ' lost' : ''}`,
    h('div', 'bal-run-head', h('b', '', r.name), h('span', r.over ? 'bad' : 'good', ` ${outcome}`), was ? h('small', 'dim', ` · ${was}`) : null,
      h('small', 'dim', ` · ${STRATEGIES[r.name]?.help ?? ''}`)),
    h('div', 'bstats', stat('alloys', 'alloys', 1), stat('built', 'built', 1), stat('kills', 'kills', 1), stat('buildings lost', 'buildingsLost', -1), stat('units lost', 'unitsLost', -1),
      stat('packs beaten', 'packsBeaten', 1), stat('mined', 'mined', 1), stat('colonists', 'colonists', 1), stat('cryo %', 'cryo', 1)),
    h('div', 'sparks',
      spark(r.rows.map((x) => x.alloys), series((x) => x.alloys, prev), '#ffb547', 'Alloys'),
      spark(r.rows.map((x) => x.built), series((x) => x.built, prev), '#3fd6ff', 'Buildings'),
      spark(r.rows.map((x) => num(x.cryo)), series((x) => num(x.cryo), prev), '#9fd3ff', 'Cryo %'),
      spark(r.rows.map((x) => x.hostiles), series((x) => x.hostiles, prev), '#ff6f61', 'Hostiles'),
      spark(r.rows.map(ppl), series(ppl, prev), '#5be3a0', 'Colonists')),
    details);
}

/** The test-run panel (keeps its results while you move about the editor). */
export function balanceRunPanel(o: { files: () => Record<string, unknown>; regions: string[] }): HTMLElement {
  const root = h('div', 'bal-runner');
  const draw = () => {
    const picks = h('div', 'bal-picks');
    for (const [name, s] of Object.entries(STRATEGIES)) {
      const box = h('input', '');
      box.type = 'checkbox';
      box.checked = state.picked.has(name);
      box.onchange = () => { if (box.checked) state.picked.add(name); else state.picked.delete(name); try { localStorage.setItem('exo.balance.picked', JSON.stringify([...state.picked])); } catch { /* private mode */ } };
      const lbl = h('label', 'check', box, ` ${name}`);
      lbl.title = s.help;
      picks.append(lbl);
    }
    const num = (label: string, key: 'minutes' | 'seed', min: number, max: number) => {
      const inp = h('input', 'bal-num');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.value = String(state[key]);
      inp.onchange = () => { state[key] = Math.max(min, Math.min(max, Math.round(Number(inp.value) || min))); };
      return h('label', '', `${label} `, inp);
    };
    const region = h('select', 'bal-num');
    for (const id of o.regions) region.append(Object.assign(h('option', '', id), { value: id }));
    region.value = state.region;
    region.onchange = () => { state.region = region.value; };
    const peaceful = h('input', '');
    peaceful.type = 'checkbox';
    peaceful.checked = state.peaceful;
    peaceful.onchange = () => { state.peaceful = peaceful.checked; };
    const run = h('button', 'primary', state.running ? `Running ${state.running.current || '…'} (${state.running.left} left)` : '▶ Run');
    run.disabled = !!state.running;
    run.onclick = () => runBalance(o.files());
    root.replaceChildren(...[
      h('h2', 'bal-h', 'Test runs'),
      h('div', 'help-block', 'The balance bot plays each strategy on the saved content for real (the game\'s own sim, sped up), the same as node tools/balance.mjs. Run again after a change: grey lines and the small numbers show the run before. Runs repeat exactly in the same browser; the command line\'s numbers can differ a little, as the browser and Node round some maths functions differently.'),
      picks,
      h('div', 'bal-opts', num('Minutes', 'minutes', 1, 60), num('Seed', 'seed', 1, 999999), h('label', '', 'Region ', region), h('label', 'check', peaceful, ' No predators'), run),
      state.error ? h('div', 'issue', `Run failed: ${state.error}`) : null,
      ...Object.keys(STRATEGIES).filter((n) => state.results.has(n)).map((n) => resultCard(state.results.get(n)!, state.before.get(n))),
    ].filter((x) => x !== null) as Node[]);
  };
  redraw = () => { if (root.isConnected) draw(); };
  draw();
  return root;
}
