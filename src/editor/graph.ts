/**
 * Story → Branch graph: missions, story events and cinematics as boxes, and the
 * flags, counters and countdowns that link them as small tags, with an arrow
 * for every way one leads to another (a mission follows one, an event fires
 * after a choice, an effect sets a flag a trigger waits for…). Laid out left
 * to right by how far down the story each one is; drag a box to move it (kept
 * per browser), drag the background to pan, wheel to zoom, double-click to
 * open. `buildGraph` is pure (the editor smoke test checks it).
 */
import { conditionsIn, type CinematicDef, type Condition, type ConditionDef, type EffectDef, type MissionDef, type StoryDef } from '../content/defs';
import { h } from './dom';

export type NodeKind = 'mission' | 'story' | 'cinematic' | 'flag' | 'counter' | 'timer';
export interface GNode { key: string; kind: NodeKind; id: string; label: string; col: number; row: number }
export interface GEdge { from: string; to: string; label?: string; kind: 'next' | 'fires' | 'choice' | 'sets' | 'waits' | 'clears' | 'blocks' }

const k = (kind: NodeKind, id: string) => `${kind}:${id}`;

export function buildGraph(missions: Record<string, MissionDef>, story: Record<string, StoryDef>, cinematics: Record<string, CinematicDef>, o: { tags?: boolean } = {}) {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const node = (kind: NodeKind, id: string, label: string) => { if (!nodes.has(k(kind, id))) nodes.set(k(kind, id), { key: k(kind, id), kind, id, label, col: 0, row: 0 }); return k(kind, id); };
  for (const [id, m] of Object.entries(missions)) node('mission', id, m.title || id);
  for (const [id, e] of Object.entries(story)) node('story', id, e.title || id);
  const tags = o.tags !== false;
  const edge = (from: string, to: string, kind: GEdge['kind'], label?: string) => { if (nodes.has(from) && nodes.has(to)) edges.push({ from, to, kind, label }); };
  /** What a trigger or objective waits on: an arrow into `to`. */
  const waits = (kind: Condition, c: ConditionDef, to: string) => {
    for (const x of conditionsIn(kind, c)) {
      if (x.kind === 'after' && x.c.event) edge(k('story', x.c.event), to, 'next', 'answered');
      if (x.kind === 'mission' && x.c.mission) edge(k('mission', x.c.mission), to, 'next', 'done');
      if (x.kind === 'failed' && x.c.mission) edge(k('mission', x.c.mission), to, 'next', 'failed');
      if (!tags) continue;
      if (x.kind === 'flag' && x.c.flag) edge(node('flag', x.c.flag, x.c.flag), to, 'waits');
      if ((x.kind === 'counter' || x.kind === 'counterBelow') && x.c.counter) edge(node('counter', x.c.counter, x.c.counter), to, 'waits', `${x.kind === 'counter' ? '≥' : '≤'} ${x.c.count ?? 0}`);
      if (x.kind === 'timer' && x.c.timer) edge(node('timer', x.c.timer, x.c.timer), to, 'waits', 'runs out');
    }
  };
  const does = (effects: (EffectDef & { after?: number })[] | undefined, from: string, choices?: { label: string }[]) => {
    for (const e of effects ?? []) {
      const label = e.after ? choices?.[e.after - 1]?.label : undefined;
      if (e.kind === 'event' && e.event) edge(from, k('story', e.event), label ? 'choice' : 'fires', label);
      if (e.kind === 'cinematic' && e.cinematic) edge(from, node('cinematic', e.cinematic, cinematics[e.cinematic]?.title ?? e.cinematic), label ? 'choice' : 'fires', label);
      if (!tags) continue;
      if (e.kind === 'flag' && e.flag) edge(from, node('flag', e.flag, e.flag), label ? 'choice' : 'sets', label);
      if (e.kind === 'unflag' && e.flag) edge(from, node('flag', e.flag, e.flag), 'clears', label);
      if ((e.kind === 'counter' || e.kind === 'setCounter') && e.counter) edge(from, node('counter', e.counter, e.counter), label ? 'choice' : 'sets', `${label ? `${label}: ` : ''}${e.kind === 'setCounter' ? '=' : (e.amount ?? 0) >= 0 ? '+' : ''}${e.amount ?? 0}`);
      if (e.kind === 'countdown' && e.timer) edge(from, node('timer', e.timer, e.timer), label ? 'choice' : 'sets', label);
    }
  };
  for (const [id, m] of Object.entries(missions)) {
    const me = k('mission', id);
    if (m.after) edge(k('mission', m.after), me, 'next');
    if (m.onStart) edge(me, k('story', m.onStart), 'fires', 'start');
    if (m.onDone) edge(me, k('story', m.onDone), 'fires', 'done');
    if (m.onFail) edge(me, k('story', m.onFail), 'fires', 'failed');
    for (const ob of m.objectives ?? []) waits(ob.kind, ob, me);
    for (const f of m.fails ?? []) waits(f.kind, f, me);
    does(m.rewards, me);
  }
  for (const [id, e] of Object.entries(story)) {
    const me = k('story', id);
    waits(e.trigger, e, me);
    if (tags && e.unless) edge(node('flag', e.unless, e.unless), me, 'blocks', 'unless');
    does(e.effects, me, e.choices);
  }
  for (const [id, c] of Object.entries(cinematics)) {
    if (c.scene === 'landing' || !c.trigger || c.trigger === 'never') continue;
    waits(c.trigger, c, node('cinematic', id, c.title || id));
  }
  // columns: longest path from a start (cycles cut after a few passes); rows in column order
  const inc = new Map<string, string[]>();
  for (const e of edges) if (e.kind !== 'clears' && e.kind !== 'blocks') inc.set(e.to, [...(inc.get(e.to) ?? []), e.from]);
  for (let pass = 0; pass < nodes.size + 2; pass++) {
    let moved = false;
    for (const n of nodes.values()) {
      const c = Math.max(0, ...(inc.get(n.key) ?? []).map((f) => (nodes.get(f)?.col ?? 0) + 1));
      if (c !== n.col && c < 60) { n.col = c; moved = true; }
    }
    if (!moved) break;
  }
  const order: NodeKind[] = ['mission', 'story', 'cinematic', 'flag', 'counter', 'timer'];
  const cols = new Map<number, GNode[]>();
  for (const n of nodes.values()) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  for (const list of cols.values()) {
    list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label));
    list.forEach((n, i) => { n.row = i; });
  }
  return { nodes: [...nodes.values()], edges };
}

// ---------- the page ----------
const NS = 'http://www.w3.org/2000/svg';
const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [a, v] of Object.entries(attrs)) el.setAttribute(a, String(v));
  return el;
};

const POS_KEY = 'exo.editor.graph';
const W = 168, H = 30, TW = 110, TH = 20, GX = 220, GY = 44;
const COLORS: Record<NodeKind, string> = { mission: '#5be3a0', story: '#3fd6ff', cinematic: '#c49bff', flag: '#ffb547', counter: '#ff9bd0', timer: '#ff9b6b' };

export interface GraphHost {
  missions: Record<string, MissionDef>;
  story: Record<string, StoryDef>;
  cinematics: Record<string, CinematicDef>;
  /** Content problems per record key ("story:<id>"). */
  problems: Record<string, number>;
  open(kind: 'missions' | 'story' | 'cinematics', id: string): void;
}

export function renderGraph(main: HTMLElement, aside: HTMLElement, host: GraphHost) {
  let saved: { pos: Record<string, [number, number]>; tags: boolean; view: [number, number, number] } = { pos: {}, tags: true, view: [-40, -40, 1] };
  try { Object.assign(saved, JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')); } catch { /* private mode */ }
  const keep = () => { try { localStorage.setItem(POS_KEY, JSON.stringify(saved)); } catch { /* private mode */ } };
  const svg = s('svg', { class: 'graph-svg' });
  const world = s('g');
  const defs = s('defs'), mk = s('marker', { id: 'gar', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  mk.append(s('path', { d: 'M0 0L10 5L0 10z', fill: '#7f93a8' }));
  defs.append(mk);
  svg.append(defs, world);
  let sel = '';
  const info = h('div', 'graph-info');
  const draw = () => {
    const g = buildGraph(host.missions, host.story, host.cinematics, { tags: saved.tags });
    const size = (n: GNode) => (n.kind === 'flag' || n.kind === 'counter' || n.kind === 'timer' ? [TW, TH] : [W, H]);
    const pos = (n: GNode): [number, number] => saved.pos[n.key] ?? [n.col * GX, n.row * GY];
    const at = new Map(g.nodes.map((n) => [n.key, n]));
    world.replaceChildren();
    const near = new Set<string>();
    if (sel) { near.add(sel); for (const e of g.edges) if (e.from === sel || e.to === sel) { near.add(e.from); near.add(e.to); } }
    const eg = s('g'), ng = s('g');
    for (const e of g.edges) {
      const a = at.get(e.from)!, b = at.get(e.to)!;
      const [ax, ay] = pos(a), [bx, by] = pos(b), [aw, ah] = size(a), [, bh] = size(b);
      const x1 = ax + aw, y1 = ay + ah / 2, x2 = bx - 2, y2 = by + bh / 2;
      const back = x2 < x1 + 10, dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const d = back ? `M${x1} ${y1} C${x1 + 60} ${y1 + 60} ${x2 - 60} ${y2 + 60} ${x2} ${y2}` : `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      const on = !sel || (near.has(e.from) && near.has(e.to) && (e.from === sel || e.to === sel));
      const p = s('path', { d, class: `ge ${e.kind}${on ? '' : ' dim'}`, 'marker-end': 'url(#gar)' });
      eg.append(p);
      if (e.label && on) {
        const t = s('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: 'gl' });
        t.textContent = e.label.length > 26 ? `${e.label.slice(0, 25)}…` : e.label;
        eg.append(t);
      }
    }
    for (const n of g.nodes) {
      const [x, y] = pos(n), [w, hh] = size(n);
      const tag = n.kind === 'flag' || n.kind === 'counter' || n.kind === 'timer';
      const grp = s('g', { class: `gn ${n.kind}${sel && !near.has(n.key) ? ' dim' : ''}${sel === n.key ? ' on' : ''}`, transform: `translate(${x} ${y})` });
      grp.dataset.key = n.key;
      grp.append(s('rect', { width: w, height: hh, rx: tag ? hh / 2 : 5, stroke: COLORS[n.kind] }));
      const label = s('text', { x: tag ? w / 2 : 8, y: hh / 2 + 4, 'text-anchor': tag ? 'middle' : 'start' });
      const max = tag ? 15 : 22;
      label.textContent = `${n.kind === 'counter' ? '# ' : n.kind === 'timer' ? '⏱ ' : n.kind === 'cinematic' ? '🎬 ' : ''}${n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label}`;
      grp.append(label);
      if (!tag) grp.append(s('rect', { x: 0, y: 0, width: 4, height: hh, fill: COLORS[n.kind] }));
      const bad = host.problems[`${n.kind}:${n.id}`];
      if (bad) { const c = s('circle', { cx: w - 6, cy: 6, r: 4, class: 'gbad' }); grp.append(c); }
      const tip = s('title');
      tip.textContent = `${n.kind} ${n.id}${bad ? ` · ${bad} problem${bad > 1 ? 's' : ''}` : ''}`;
      grp.append(tip);
      ng.append(grp);
    }
    world.append(eg, ng);
    const [vx, vy, z] = saved.view;
    world.setAttribute('transform', `translate(${-vx * z} ${-vy * z}) scale(${z})`);
    // the selected one's links, listed
    const n = sel ? at.get(sel) : undefined;
    if (n) {
      const ins = g.edges.filter((e) => e.to === sel), outs = g.edges.filter((e) => e.from === sel);
      const name = (key: string) => at.get(key)?.label ?? key;
      info.replaceChildren(h('div', 'group', `${n.kind} · ${n.id}`), h('b', '', n.label),
        ...(n.kind === 'mission' || n.kind === 'story' || n.kind === 'cinematic' ? [Object.assign(h('button', '', 'Open'), { onclick: () => host.open(n.kind === 'mission' ? 'missions' : n.kind === 'story' ? 'story' : 'cinematics', n.id) })] : []),
        h('div', 'group', 'Comes from'), ...(ins.length ? ins.map((e) => h('div', '', `${name(e.from)}${e.label ? ` (${e.label})` : ''} · ${e.kind}`)) : [h('div', 'dim', 'nothing: it starts the story, or nothing reaches it')]),
        h('div', 'group', 'Leads to'), ...(outs.length ? outs.map((e) => h('div', '', `${name(e.to)}${e.label ? ` (${e.label})` : ''} · ${e.kind}`)) : [h('div', 'dim', 'nothing')]));
    } else info.replaceChildren(h('div', 'help-block', 'Click a box to see what leads to it and what it leads to; double-click to open it.'));
  };
  // ---- interaction: drag boxes, pan, zoom, select, open
  let drag: { key?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
  const toWorld = (e: PointerEvent | WheelEvent) => {
    const r = svg.getBoundingClientRect(), [vx, vy, z] = saved.view;
    return [(e.clientX - r.left) / z + vx, (e.clientY - r.top) / z + vy];
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.gn');
    const key = g?.dataset.key;
    const [wx, wy] = toWorld(e);
    if (key) {
      const t = g!.getAttribute('transform')!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
      drag = { key, sx: wx, sy: wy, ox: Number(t[1]), oy: Number(t[2]), moved: false };
    } else drag = { sx: e.clientX, sy: e.clientY, ox: saved.view[0], oy: saved.view[1], moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.key) {
      const [wx, wy] = toWorld(e);
      const x = Math.round((drag.ox + wx - drag.sx) / 4) * 4, y = Math.round((drag.oy + wy - drag.sy) / 4) * 4;
      if (Math.abs(wx - drag.sx) + Math.abs(wy - drag.sy) > 3) drag.moved = true;
      if (drag.moved) { saved.pos[drag.key] = [x, y]; draw(); }
    } else {
      const z = saved.view[2];
      saved.view[0] = drag.ox - (e.clientX - drag.sx) / z; saved.view[1] = drag.oy - (e.clientY - drag.sy) / z;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      draw();
    }
  });
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved) { sel = drag.key && drag.key !== sel ? drag.key : drag.key ? sel : ''; draw(); }
    if (drag?.moved) keep();
    drag = null;
  });
  svg.addEventListener('dblclick', (e) => {
    const key = (e.target as Element).closest<SVGGElement>('.gn')?.dataset.key;
    if (!key) return;
    const [kind, ...rest] = key.split(':'), id = rest.join(':');
    if (kind === 'mission') host.open('missions', id); else if (kind === 'story') host.open('story', id); else if (kind === 'cinematic') host.open('cinematics', id);
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wy] = toWorld(e), z = saved.view[2], nz = Math.min(2.5, Math.max(0.25, z * Math.exp(-e.deltaY * 0.0015)));
    saved.view = [wx - (wx - saved.view[0]) * (z / nz), wy - (wy - saved.view[1]) * (z / nz), nz];
    draw();
    keep();
  }, { passive: false });
  const tags = h('input', '');
  tags.type = 'checkbox';
  tags.checked = saved.tags;
  tags.onchange = () => { saved.tags = tags.checked; keep(); draw(); };
  const reset = h('button', '', 'Tidy up');
  reset.title = 'Forget moved boxes and lay everything out again';
  reset.onclick = () => { saved.pos = {}; saved.view = [-40, -40, 1]; keep(); draw(); };
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Branch graph'), h('div', 'path', 'How the story branches: drag boxes, drag the background to pan, wheel to zoom, double-click to open.'))),
    h('div', 'bal-opts', h('label', 'check', tags, ' Flags, counters and countdowns'), reset,
      h('span', 'graph-key', ...(['mission', 'story', 'cinematic', 'flag', 'counter', 'timer'] as NodeKind[]).map((k) => { const i = h('i', ''); i.style.background = COLORS[k]; return h('span', '', i, k === 'story' ? 'event' : k === 'timer' ? 'countdown' : k); }))),
    h('div', 'graph-wrap', svg as unknown as Node),
  );
  aside.replaceChildren(info);
  draw();
}
