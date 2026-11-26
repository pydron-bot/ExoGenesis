/**
 * The Chronicle (DESIGN §5.10 C): a colony history told from what the campaign kept (`SimState.chronicle`,
 * src/sim/chronicle.ts, plus the people and the memorial): the key moments by sol, how the blocs shifted,
 * the family tree across generations, the memorial and the lines that ended, and who walked out. Opened from
 * the game menu at any time and from the end screen; Save image draws it all on one canvas (a PNG to keep or
 * share).
 */
import type { ChronicleEvent, ChroniclePerson, ChronicleSample } from './sim/chronicle';
import { LINEAGES } from './sim/names';
import type { SimState } from './sim/types';
import { esc } from './util/html';
const lineName = (l: number) => LINEAGES[l % LINEAGES.length];
const C = { cyan: '#5ff3ff', amber: '#ffb547', crimson: '#ff4d5e', violet: '#c08bff', text: '#d6f6ff', dim: '#6f8f9c', panel: '#060e16', kids: '#7d93a0' };
export const BLOC_COLORS = { partner: C.cyan, autonomist: C.amber, devoted: C.violet };

export interface ChronPerson extends ChroniclePerson { gen: number; status: 'living' | 'died' | 'left' }
export interface ChronicleModel {
  region: string;
  secs: number;
  sol: number;
  over?: string;
  overText?: string;
  totals: { lived: number; grown: number; born: number; died: number; left: number; living: number; embryos: number; linesLeft: number; lines: number; generations: number };
  people: ChronPerson[];
  samples: ChronicleSample[];
  moments: ChronicleEvent[];
  memorial: { name: string; age: number; cause: string; at: number }[];
  /** Children lost before they were born (growth pods failed or destroyed): one line, not a row each. */
  podLosses: number;
  linesEnded: { text: string; at: number }[];
  departures: { text: string; at: number }[];
}

/** Sol and time of day, as the HUD clock says it ("Sol 3 · 14:20"). */
export function solClock(secs: number, solSecs: number) {
  const sol = Math.floor(secs / solSecs) + 1;
  const h = ((secs / solSecs) * 24 + 7) % 24;
  return `Sol ${sol} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

/** Everything the page and the image show, worked out once from a saved state. */
export function chronicleModel(s: SimState, opts: { region: string; solSeconds: number; lineages: number }): ChronicleModel {
  const ch = s.chronicle ?? { people: [], samples: [], events: [], seen: { missions: 0, fired: 0, lead: null, departed: 0 } };
  const P = s.people;
  const secs = s.tick / 10;
  const byId = new Map(ch.people.map((p) => [p.id, p]));
  const gens = new Map<number, number>();
  const genOf = (p: ChroniclePerson, depth = 0): number => {
    const k = gens.get(p.id);
    if (k) return k;
    let g = 1;
    if (p.parents && depth < 30) {
      const ps = p.parents.map((id) => byId.get(id)).filter((x): x is ChroniclePerson => !!x);
      g = ps.length ? 1 + Math.max(...ps.map((x) => genOf(x, depth + 1))) : 2;
    } else if (p.origin === 'born') g = 2;
    gens.set(p.id, g);
    return g;
  };
  const people: ChronPerson[] = ch.people.map((p) => ({ ...p, gen: genOf(p), status: p.end ? p.end.how : 'living' }));
  const living = P?.colonists.length ?? 0;
  const bank = P?.bank ?? [];
  const lines = opts.lineages;
  let linesLeft = 0;
  for (let l = 0; l < lines; l++) if ((bank[l] ?? 0) > 0 || P?.colonists.some((c) => c.lineage === l)) linesLeft++;
  return {
    region: opts.region, secs, sol: Math.floor(secs / opts.solSeconds) + 1, over: s.over || undefined, overText: s.overText,
    totals: {
      lived: people.length, grown: people.filter((p) => p.origin === 'pod').length, born: people.filter((p) => p.origin === 'born').length,
      died: people.filter((p) => p.status === 'died').length, left: people.filter((p) => p.status === 'left').length,
      living, embryos: bank.reduce((m, x) => m + x, 0), linesLeft, lines, generations: Math.max(0, ...people.map((p) => p.gen)),
    },
    people,
    samples: ch.samples,
    moments: ch.events,
    memorial: (P?.memorial ?? []).filter((m) => !/left to found|walked out/.test(m.cause) && !/^Unnamed/.test(m.name)).map((m) => ({ name: m.name, age: m.age, cause: m.cause, at: m.at })),
    podLosses: (P?.memorial ?? []).filter((m) => /^Unnamed/.test(m.name)).length,
    linesEnded: ch.events.filter((e) => e.kind === 'death' && / line is gone$/.test(e.text)).map((e) => ({ text: e.text, at: e.at })),
    departures: ch.events.filter((e) => e.kind === 'walkout').map((e) => ({ text: e.text, at: e.at })),
  };
}

// ---------- the family tree layout (page and image) ----------
export const NODE_W = 132, NODE_H = 36, GAP = 10, ROW = 84;
export interface TreeLayout { nodes: { p: ChronPerson; x: number; y: number }[]; links: [number, number, number, number][]; width: number; height: number }
/** Rows by generation; children sit under their parents (ordered by where their parents are). */
export function treeLayout(people: ChronPerson[]): TreeLayout {
  const rows = new Map<number, ChronPerson[]>();
  for (const p of people) (rows.get(p.gen) ?? rows.set(p.gen, []).get(p.gen)!).push(p);
  const at = new Map<number, number>(); // id → x centre
  const nodes: TreeLayout['nodes'] = [];
  let width = NODE_W;
  for (const g of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(g)!;
    const key = (p: ChronPerson) => {
      const xs = (p.parents ?? []).map((id) => at.get(id)).filter((x): x is number => x !== undefined);
      return xs.length ? xs.reduce((m, x) => m + x, 0) / xs.length : p.from;
    };
    // first generation: in the order they came out of the pods, partners side by side
    if (g === 1) {
      row.sort((a, b) => a.from - b.from || a.id - b.id);
      for (let i = 0; i < row.length; i++) {
        const j = row.findIndex((q, k) => k > i + 1 && q.id === row[i].partner);
        if (j > 0) row.splice(i + 1, 0, row.splice(j, 1)[0]);
      }
    } else row.sort((a, b) => key(a) - key(b) || a.born - b.born);
    row.forEach((p, i) => {
      const x = i * (NODE_W + GAP);
      nodes.push({ p, x, y: (g - 1) * ROW });
      at.set(p.id, x + NODE_W / 2);
    });
    width = Math.max(width, row.length * (NODE_W + GAP) - GAP);
  }
  const pos = new Map(nodes.map((n) => [n.p.id, n]));
  const links: TreeLayout['links'] = [];
  for (const n of nodes) for (const id of n.p.parents ?? []) {
    const q = pos.get(id);
    if (q) links.push([q.x + NODE_W / 2, q.y + NODE_H, n.x + NODE_W / 2, n.y]);
  }
  return { nodes, links, width, height: rows.size ? Math.max(...nodes.map((n) => n.y)) + NODE_H : 0 };
}

const lifespan = (p: ChronPerson, sol: number) => {
  const born = Math.floor(p.from / sol) + 1;
  return p.end ? `Sol ${born}–${Math.floor(p.end.at / sol) + 1}` : `Sol ${born} –`;
};
const statusColor = (p: ChronPerson) => (p.status === 'died' ? C.crimson : p.status === 'left' ? C.amber : C.cyan);

// ---------- bloc chart (page and image) ----------
/** Stacked areas: Partners, Autonomists, Devoted (adults), then children; a line for the embryos left. */
export function drawBlocs(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, samples: ChronicleSample[], solSecs: number) {
  g.save();
  g.fillStyle = 'rgba(95,243,255,0.04)';
  g.fillRect(x, y, w, h);
  if (samples.length < 2) {
    g.fillStyle = C.dim; g.font = '13px ui-monospace, monospace'; g.textAlign = 'center';
    g.fillText('No colonists yet: the blocs form once the first are out of the pods.', x + w / 2, y + h / 2);
    g.restore();
    return;
  }
  const t0 = samples[0][0], t1 = samples[samples.length - 1][0];
  const top = Math.max(1, ...samples.map((s) => s[1] + s[2] + s[3] + s[4]));
  const X = (t: number) => x + ((t - t0) / Math.max(1, t1 - t0)) * w, Y = (v: number) => y + h - (v / top) * h;
  const layers: [number[], string][] = [[[1], C.cyan], [[1, 2], C.amber], [[1, 2, 3], C.violet], [[1, 2, 3, 4], C.kids]];
  for (let k = layers.length - 1; k >= 0; k--) {
    const [cols, color] = layers[k];
    const below = k ? layers[k - 1][0] : [];
    const sum = (s: ChronicleSample, cs: number[]) => cs.reduce((m, c) => m + s[c], 0);
    g.beginPath();
    samples.forEach((s, i) => (i ? g.lineTo(X(s[0]), Y(sum(s, cols))) : g.moveTo(X(s[0]), Y(sum(s, cols)))));
    for (let i = samples.length - 1; i >= 0; i--) g.lineTo(X(samples[i][0]), Y(sum(samples[i], below)));
    g.closePath();
    g.fillStyle = color; g.globalAlpha = k === 3 ? 0.35 : 0.75;
    g.fill();
  }
  g.globalAlpha = 1;
  // sol ticks
  g.strokeStyle = 'rgba(214,246,255,0.15)'; g.fillStyle = C.dim; g.font = '11px ui-monospace, monospace'; g.textAlign = 'center';
  const sols = (t1 - t0) / solSecs, every = Math.max(1, Math.ceil(sols / 8));
  for (let k = Math.ceil(t0 / solSecs / every) * every; k * solSecs <= t1; k += every) {
    const px = X(k * solSecs);
    g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke();
    g.fillText(`Sol ${k + 1}`, px, y + h + 14);
  }
  g.textAlign = 'left';
  g.fillText(`${top} people`, x + 4, y + 12);
  g.restore();
}

// ---------- the page ----------
const MOMENT_ICON: Record<ChronicleEvent['kind'], string> = { mission: '■', story: '◆', birth: '+', death: '✕', people: '·', contact: '◎', lead: '⚖', walkout: '↗', milestone: '★', end: '!' };

export function chronicleHtml(m: ChronicleModel, solSecs: number) {
  const T = m.totals;
  const chip = (n: number | string, label: string, color = C.text) => `<div class="ch-chip"><b style="color:${color}">${n}</b><small>${label}</small></div>`;
  const tree = treeLayout(m.people);
  const svg = tree.nodes.length ? `<svg class="ch-tree" width="${tree.width}" height="${tree.height}" viewBox="0 0 ${tree.width} ${tree.height}" role="img" aria-label="Family tree">
      ${tree.links.map(([x1, y1, x2, y2]) => `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" />`).join('')}
      ${tree.nodes.map(({ p, x, y }) => `<g class="ch-node ${p.status}" transform="translate(${x},${y})"><title>${esc(`${p.name} · ${lineName(p.line)} line · ${p.origin === 'pod' ? `grown, ${p.imprint ?? ''} imprint` : 'born in the colony'}${p.end ? ` · ${p.end.how === 'died' ? `died at ${p.end.age ?? '?'}: ${p.end.cause ?? ''}` : 'walked out'}` : ''}`)}</title>
        <rect width="${NODE_W}" height="${NODE_H}" rx="3" style="stroke:${statusColor(p)}"/>
        <text x="7" y="15">${esc(p.name.length > 17 ? `${p.name.slice(0, 16)}…` : p.name)}</text>
        <text x="7" y="29" class="s">${esc(lifespan(p, solSecs))}${p.origin === 'pod' ? ' · pod' : ''}</text></g>`).join('')}
    </svg>` : '<div class="ch-empty">No one has come out of the pods yet.</div>';
  const bySol = new Map<number, ChronicleEvent[]>();
  for (const e of m.moments) { const k = Math.floor(e.at / solSecs) + 1; (bySol.get(k) ?? bySol.set(k, []).get(k)!).push(e); }
  const moments = [...bySol].map(([sol, es]) => `<div class="ch-sol"><div class="ch-sol-h">SOL ${sol}</div>${es.map((e) => `<div class="ch-m ${e.kind}"><i>${MOMENT_ICON[e.kind]}</i><span class="t">${esc(solClock(e.at, solSecs).split(' · ')[1])}</span><span>${esc(e.text)}</span></div>`).join('')}</div>`).join('') || '<div class="ch-empty">Nothing yet.</div>';
  const outcome = m.over ? (m.over === 'won' || m.over === 'story' ? 'The colony endures' : 'The colony fell') : 'The colony lives on';
  return `<div class="ch-page">
    <div class="ch-top"><div><div class="ch-kicker">THE CHRONICLE</div><h2>The Accord colony at ${esc(m.region)}</h2>
      <div class="ch-sub">${esc(outcome)} · Sol 1 to Sol ${m.sol}${m.overText ? ` · ${esc(m.overText)}` : ''}</div></div>
      <div class="ch-acts"><button class="ch-img">Save image</button><button class="ch-x" aria-label="Close">×</button></div></div>
    <div class="ch-chips">${chip(T.lived, 'lived')}${chip(T.grown, 'grown in pods')}${chip(T.born, 'born')}${chip(T.living, 'living', C.cyan)}${chip(T.died, 'died', C.crimson)}${chip(T.left, 'walked out', C.amber)}${chip(`${T.linesLeft}/${T.lines}`, 'lines left')}${chip(T.generations, T.generations === 1 ? 'generation' : 'generations')}${chip(T.embryos, 'embryos in the bank')}</div>
    <section><h3>How the blocs shifted</h3><div class="ch-legend"><i style="background:${C.cyan}"></i>Partners <i style="background:${C.amber}"></i>Autonomists <i style="background:${C.violet}"></i>Devoted <i style="background:${C.kids}"></i>Children</div><canvas class="ch-blocs" height="190"></canvas></section>
    <section><h3>Family tree</h3><div class="ch-legend"><i style="background:${C.cyan}"></i>Living <i style="background:${C.crimson}"></i>Died <i style="background:${C.amber}"></i>Walked out · each row a generation</div><div class="ch-treebox">${svg}</div></section>
    <div class="ch-cols">
      <section><h3>Key moments</h3><div class="ch-moments">${moments}</div></section>
      <section><h3>Memorial</h3>${m.memorial.length ? `<div class="ch-mem">${m.memorial.map((x) => `<div><b>${esc(x.name)}</b>${x.age ? `, ${x.age}` : ''}<small>${esc(x.cause)} · ${esc(solClock(x.at, solSecs))}</small></div>`).join('')}</div>` : m.podLosses ? '' : '<div class="ch-empty">No one lost. Yet.</div>'}
        ${m.podLosses ? `<div class="ch-line-end">${m.podLosses} ${m.podLosses > 1 ? 'children' : 'child'} lost in the growth pods, before they had names</div>` : ''}
        ${m.linesEnded.length ? `<h4>Lines that ended</h4>${m.linesEnded.map((x) => `<div class="ch-line-end">${esc(x.text)} <small>${esc(solClock(x.at, solSecs))}</small></div>`).join('')}` : ''}
        ${m.departures.length ? `<h4>Walked out</h4>${m.departures.map((x) => `<div class="ch-line-end">${esc(x.text)} <small>${esc(solClock(x.at, solSecs))}</small></div>`).join('')}` : ''}
      </section>
    </div>
  </div>`;
}

/** Open the Chronicle over the game. Returns a close function. */
export function openChronicle(m: ChronicleModel, solSecs: number, opts: { tap?: () => void; onClose?: () => void } = {}) {
  document.getElementById('chronicle')?.remove();
  const el = document.createElement('div');
  el.id = 'chronicle';
  el.innerHTML = chronicleHtml(m, solSecs);
  document.body.appendChild(el);
  const cv = el.querySelector<HTMLCanvasElement>('.ch-blocs')!;
  const paint = () => {
    const w = cv.clientWidth || 600, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = 190 * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    drawBlocs(g, 0, 4, w, 166, m.samples, solSecs);
  };
  paint();
  addEventListener('resize', paint);
  const close = () => { removeEventListener('resize', paint); removeEventListener('keydown', key, true); el.remove(); opts.onClose?.(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener('keydown', key, true);
  el.querySelector<HTMLButtonElement>('.ch-x')!.onclick = () => { opts.tap?.(); close(); };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  const img = el.querySelector<HTMLButtonElement>('.ch-img')!;
  img.onclick = async () => {
    opts.tap?.();
    img.textContent = 'Drawing…';
    const how = await saveChronicleImage(m, solSecs);
    img.textContent = how === 'shared' ? 'Shared' : how === 'saved' ? 'Saved' : 'Save image';
  };
  return close;
}

// ---------- the image ----------
/** The whole Chronicle on one canvas (1200 px wide): header, numbers, the blocs, the tree, moments, memorial. */
export function chronicleCanvas(m: ChronicleModel, solSecs: number): HTMLCanvasElement {
  const W = 1200, PAD = 40, inner = W - PAD * 2;
  const tree = treeLayout(m.people);
  const scale = Math.min(1, inner / Math.max(1, tree.width));
  const keyMoments = m.moments.filter((e) => e.kind !== 'people').slice(-18);
  const mem = m.memorial.slice(-14);
  const listH = Math.max(keyMoments.length, mem.length + 2 + (m.linesEnded.length ? 3 : 0)) * 22 + 60;
  const H = 150 + 90 + 260 + (tree.nodes.length ? tree.height * scale + 90 : 60) + listH + 50;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Math.ceil(H);
  const g = cv.getContext('2d')!;
  const mono = (px: number, wt = 400) => `${wt} ${px}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
  g.fillStyle = C.panel; g.fillRect(0, 0, W, H);
  // a faint frame
  g.strokeStyle = 'rgba(95,243,255,0.25)'; g.strokeRect(12.5, 12.5, W - 25, H - 25);
  let y = PAD + 14;
  g.fillStyle = C.amber; g.font = mono(14, 600); g.fillText('THE CHRONICLE', PAD, y);
  y += 38;
  g.fillStyle = C.text; g.font = mono(30, 600); g.fillText(`The Accord colony at ${m.region}`, PAD, y);
  y += 28;
  const outcome = m.over ? (m.over === 'won' || m.over === 'story' ? 'The colony endures' : 'The colony fell') : 'The colony lives on';
  g.fillStyle = C.dim; g.font = mono(15); g.fillText(`${outcome} · Sol 1 to Sol ${m.sol}`, PAD, y);
  // numbers
  y += 40;
  const T = m.totals;
  const chips: [string, string, string][] = [[String(T.lived), 'lived', C.text], [String(T.born), 'born', C.text], [String(T.living), 'living', C.cyan], [String(T.died), 'died', C.crimson], [String(T.left), 'walked out', C.amber], [`${T.linesLeft}/${T.lines}`, 'lines left', C.text], [String(T.generations), 'generations', C.text]];
  chips.forEach(([n, l, col], i) => {
    const x = PAD + i * (inner / chips.length);
    g.fillStyle = col; g.font = mono(26, 600); g.fillText(n, x, y);
    g.fillStyle = C.dim; g.font = mono(12); g.fillText(l, x, y + 18);
  });
  y += 56;
  g.fillStyle = C.text; g.font = mono(16, 600); g.fillText('HOW THE BLOCS SHIFTED', PAD, y);
  y += 14;
  drawBlocs(g, PAD, y, inner, 200, m.samples, solSecs);
  y += 240;
  if (tree.nodes.length) {
    g.fillStyle = C.text; g.font = mono(16, 600); g.fillText('FAMILY TREE', PAD, y);
    y += 18;
    g.save();
    g.translate(PAD, y); g.scale(scale, scale);
    g.strokeStyle = 'rgba(214,246,255,0.35)'; g.lineWidth = 1.2 / scale;
    for (const [x1, y1, x2, y2] of tree.links) { g.beginPath(); g.moveTo(x1, y1); g.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2); g.stroke(); }
    for (const { p, x, y: ny } of tree.nodes) {
      g.fillStyle = 'rgba(6,14,22,0.95)'; g.fillRect(x, ny, NODE_W, NODE_H);
      g.strokeStyle = statusColor(p); g.lineWidth = 1.5; g.strokeRect(x + 0.5, ny + 0.5, NODE_W - 1, NODE_H - 1);
      g.fillStyle = p.status === 'living' ? C.text : C.dim; g.font = mono(12, 600);
      g.fillText(p.name.length > 17 ? `${p.name.slice(0, 16)}…` : p.name, x + 7, ny + 15);
      g.fillStyle = C.dim; g.font = mono(10); g.fillText(lifespan(p, solSecs), x + 7, ny + 29);
    }
    g.restore();
    y += tree.height * scale + 50;
  }
  // moments and memorial side by side
  const colW = inner / 2 - 10;
  const clip = (t: string, px: number) => { g.font = mono(px); let s = t; while (g.measureText(s).width > colW - 70 && s.length > 4) s = `${s.slice(0, -2)}…`; return s; };
  g.fillStyle = C.text; g.font = mono(16, 600); g.fillText('KEY MOMENTS', PAD, y); g.fillText('MEMORIAL', PAD + inner / 2 + 10, y);
  let ly = y + 26;
  for (const e of keyMoments) {
    g.fillStyle = e.kind === 'death' || e.kind === 'walkout' ? C.crimson : e.kind === 'birth' ? C.cyan : C.amber; g.font = mono(12); g.fillText(`Sol ${Math.floor(e.at / solSecs) + 1}`, PAD, ly);
    g.fillStyle = C.text; g.fillText(clip(e.text, 12), PAD + 64, ly);
    ly += 22;
  }
  if (!keyMoments.length) { g.fillStyle = C.dim; g.font = mono(12); g.fillText('Nothing yet.', PAD, ly); }
  let my = y + 26;
  const mx = PAD + inner / 2 + 10;
  for (const x of mem) {
    g.fillStyle = C.text; g.font = mono(12, 600); g.fillText(clip(`${x.name}${x.age ? `, ${x.age}` : ''}`, 12), mx, my);
    g.fillStyle = C.dim; g.font = mono(11); g.fillText(clip(`${x.cause} · Sol ${Math.floor(x.at / solSecs) + 1}`, 11), mx + 250, my);
    my += 22;
  }
  if (m.memorial.length > mem.length) { g.fillStyle = C.dim; g.font = mono(11); g.fillText(`and ${m.memorial.length - mem.length} more`, mx, my); my += 22; }
  if (m.podLosses) { g.fillStyle = C.dim; g.font = mono(12); g.fillText(clip(`${m.podLosses} ${m.podLosses > 1 ? 'children' : 'child'} lost in the growth pods`, 12), mx, my); my += 22; }
  if (!mem.length && !m.podLosses) { g.fillStyle = C.dim; g.font = mono(12); g.fillText('No one lost.', mx, my); my += 22; }
  if (m.linesEnded.length) {
    my += 10; g.fillStyle = C.crimson; g.font = mono(12, 600); g.fillText('LINES THAT ENDED', mx, my); my += 22;
    g.fillStyle = C.text; g.font = mono(12); g.fillText(clip(m.linesEnded.map((x) => x.text.replace(/^The | line is gone$/g, '')).join(', '), 12), mx, my);
  }
  g.fillStyle = C.dim; g.font = mono(11); g.textAlign = 'right'; g.fillText('EXO GENESIS', W - PAD, H - 26);
  return cv;
}

/** Draw it and hand it over: the share sheet on phones that can share files, else a download. */
export async function saveChronicleImage(m: ChronicleModel, solSecs: number): Promise<'shared' | 'saved' | 'failed'> {
  const cv = chronicleCanvas(m, solSecs);
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
  if (!blob) return 'failed';
  const name = `exo-chronicle-sol-${m.sol}.png`;
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await nav.share!({ files: [file], title: 'The Chronicle' }); return 'shared'; } catch { /* cancelled: download instead */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
