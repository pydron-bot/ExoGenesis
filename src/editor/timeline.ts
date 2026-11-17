/**
 * Cinematic timeline (Cinematics → Landing): the landing's beats, camera keys
 * and captions on one time axis, above the form.
 *
 *   - drag a beat, a camera key or a caption to move it (snaps to beats and
 *     whole tenths; hold Alt for no snapping). Keys and captions that sat on a
 *     beat move with it.
 *   - click an item to jump to its fields in the form below
 *   - click the ruler to put the playhead there: the caption and camera at
 *     that moment show underneath, and "Play from here" starts the game's
 *     landing there (unsaved edits included)
 *   - the curves are the camera's distance, pitch and yaw, as the game will
 *     interpolate them (the same monotone cubic: src/world/curve.ts)
 */
import { BEATS, landingShape, type LandingDef } from '../content/defs';
import { pchip } from '../world/curve';

export interface TimelineHost {
  draft(): LandingDef;
  /** The draft changed: refresh the form's dependants (and this). */
  changed(): void;
  /** A list was reordered or its values changed under the form: rebuild the form inputs. */
  rerender(): void;
  /** Focus the form row for a field path ("camera[3].at", "burn"). */
  reveal(field: string): void;
  play(from: number): void;
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

const ROWS = { ruler: 0, beats: 22, camera: 92, captions: 122, curves: 156 };
const H = 250, PAD_L = 74, PAD_R = 14;

let playhead = 0;

export function timelinePanel(host: TimelineHost): { el: HTMLElement; update(): void } {
  const svg = svgEl('svg', { class: 'tl', height: H });
  const info = h('div', 'tl-info');
  const playAll = h('button', 'primary', '▶ Play the landing');
  const playHere = h('button', '', '▶ From the playhead');
  playAll.onclick = () => host.play(0);
  playHere.onclick = () => host.play(playhead);
  const el = h('div', 'tl-wrap', svg, h('div', 'tl-bar', info, h('div', 'actions', playAll, playHere)));
  let W = 800;
  let drag: { kind: 'beat' | 'camera' | 'captions'; key: string; i: number; dx: number; moved: boolean; from: number; riders: { list: 'camera' | 'captions'; i: number }[] } | null = null;

  const span = () => Math.max(5, (host.draft().end ?? 27) + 1);
  const xOf = (t: number) => PAD_L + (t / span()) * (W - PAD_L - PAD_R);
  const tOf = (x: number) => ((x - PAD_L) / (W - PAD_L - PAD_R)) * span();
  const beatTimes = () => BEATS.map((b) => host.draft()[b] as number).filter((v) => typeof v === 'number');
  const snap = (t: number, alt: boolean) => {
    t = Math.max(0, t);
    if (alt) return Math.round(t * 100) / 100;
    const near = beatTimes().find((b) => Math.abs(b - t) < span() * 0.006);
    return near ?? Math.round(t * 10) / 10;
  };

  /** Camera channels at time t (as the game computes them). */
  const camAt = (d: LandingDef, t: number) => {
    const keys = d.camera ?? [];
    if (!keys.length) return null;
    const X = keys.map((k) => k.at);
    return {
      dist: Math.exp(pchip(X, keys.map((k) => Math.log(Math.max(1, k.dist ?? 1))), t)),
      pitch: pchip(X, keys.map((k) => k.pitch ?? 0), t),
      yaw: pchip(X, keys.map((k) => k.yaw ?? 0), t),
      on: (() => { let k = keys[0]; for (const x of keys) if (x.at <= t) k = x; return k.target === 'probe' ? 'the probe' : `${k.x ?? 0}, ${k.z ?? 0}`; })(),
    };
  };

  const draw = () => {
    W = Math.max(400, el.clientWidth || 800);
    svg.setAttribute('width', String(W));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const d = host.draft();
    // ruler: a tick every second, a label every 5
    for (let t = 0; t <= span(); t++) {
      const x = xOf(t);
      svg.append(svgEl('line', { x1: x, x2: x, y1: 12, y2: t % 5 ? 16 : 20, class: 'tl-tick' }));
      if (t % 5 === 0) svg.append(svgEl('text', { x: x + 2, y: 10, class: 'tl-lbl' }, `${t}s`));
    }
    const label = (y: number, text: string) => svg.append(svgEl('text', { x: 6, y, class: 'tl-row' }, text));
    label(ROWS.beats + 26, 'Beats');
    label(ROWS.camera + 4, 'Camera');
    label(ROWS.captions + 13, 'Captions');
    label(ROWS.curves + 12, 'Distance');
    label(ROWS.curves + 40, 'Pitch');
    label(ROWS.curves + 68, 'Yaw');
    // beats: a line through every row, the name staggered so neighbours don't collide
    BEATS.forEach((b, i) => {
      const t = d[b] as number;
      if (typeof t !== 'number') return;
      const x = xOf(t);
      svg.append(svgEl('line', { x1: x, x2: x, y1: ROWS.beats, y2: H - 4, class: 'tl-beat-line' }));
      const g = svgEl('g', { class: 'tl-beat', 'data-kind': 'beat', 'data-key': b });
      g.append(svgEl('rect', { x: x - 4, y: ROWS.beats + (i % 3) * 16, width: 8, height: 12, rx: 2 }), svgEl('text', { x: x + 6, y: ROWS.beats + (i % 3) * 16 + 10, class: 'tl-name' }, landingShape[b].label ?? b));
      svg.append(g);
    });
    // camera keys
    (d.camera ?? []).forEach((k, i) => {
      const x = xOf(k.at);
      const g = svgEl('g', { class: `tl-key ${k.target}`, 'data-kind': 'camera', 'data-i': i });
      g.append(svgEl('path', { d: `M${x} ${ROWS.camera - 7} L${x + 7} ${ROWS.camera} L${x} ${ROWS.camera + 7} L${x - 7} ${ROWS.camera} Z` }));
      g.append(svgEl('title', {}, `Key ${i + 1} at ${k.at}s: ${k.target === 'probe' ? 'the probe' : `${k.x ?? 0}, ${k.z ?? 0}`}, ${k.dist} u, pitch ${k.pitch}, yaw ${k.yaw}`));
      svg.append(g);
    });
    // captions: a block from each to the next
    const caps = d.captions ?? [];
    caps.forEach((c, i) => {
      const x0 = xOf(c.at), x1 = xOf(caps[i + 1]?.at ?? d.end ?? span());
      const g = svgEl('g', { class: 'tl-cap', 'data-kind': 'captions', 'data-i': i });
      g.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 1), height: 18, rx: 2 }));
      const clip = `tl-clip-${i}`;
      const cp = svgEl('clipPath', { id: clip });
      cp.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 4), height: 18 }));
      g.append(cp, svgEl('text', { x: x0 + 4, y: ROWS.captions + 13, 'clip-path': `url(#${clip})` }, c.title || '…'));
      g.append(svgEl('title', {}, `${c.at}s · ${c.title}${c.sub ? ` · ${c.sub}` : ''}`));
      svg.append(g);
    });
    // curves
    if (d.camera?.length) {
      const N = Math.round(W - PAD_L - PAD_R), pts = { dist: '', pitch: '', yaw: '' };
      const samples = Array.from({ length: N + 1 }, (_, n) => camAt(d, (n / N) * span())!);
      const rng = (k: 'dist' | 'pitch' | 'yaw') => {
        const vs = samples.map((s) => (k === 'dist' ? Math.log(s.dist) : s[k]));
        return { vs, lo: Math.min(...vs), hi: Math.max(...vs) };
      };
      (['dist', 'pitch', 'yaw'] as const).forEach((k, row) => {
        const { vs, lo, hi } = rng(k);
        const y0 = ROWS.curves + row * 28 + 22;
        pts[k] = vs.map((v, n) => `${(PAD_L + n).toFixed(0)},${(y0 - ((v - lo) / Math.max(1e-6, hi - lo)) * 18).toFixed(1)}`).join(' ');
        svg.append(svgEl('polyline', { points: pts[k], class: `tl-curve ${k}` }));
      });
      for (const k of d.camera) svg.append(svgEl('line', { x1: xOf(k.at), x2: xOf(k.at), y1: ROWS.curves, y2: H - 4, class: 'tl-key-line' }));
    }
    // playhead
    const px = xOf(playhead);
    svg.append(svgEl('line', { x1: px, x2: px, y1: 0, y2: H, class: 'tl-play' }), svgEl('path', { d: `M${px - 5} 0 L${px + 5} 0 L${px} 7 Z`, class: 'tl-play-head' }));
    // what's on screen at the playhead
    let cap: LandingDef['captions'][number] | undefined;
    for (const c of caps) if (c.at <= playhead) cap = c;
    const cam = camAt(d, playhead);
    info.textContent = `${playhead.toFixed(1)} s · ${cap ? `“${cap.title}${cap.sub ? ` · ${cap.sub}` : ''}”` : 'no caption'}${cam ? ` · camera on ${cam.on}, ${cam.dist.toFixed(0)} u, pitch ${cam.pitch.toFixed(2)}, yaw ${cam.yaw.toFixed(2)}` : ''}`;
    playHere.textContent = `▶ From ${playhead.toFixed(1)} s`;
  };

  const local = (e: PointerEvent) => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  svg.onpointerdown = (e) => {
    const g = (e.target as Element).closest('g[data-kind]');
    const p = local(e);
    if (!g) {
      // the ruler (or empty space): move the playhead
      playhead = Math.max(0, Math.min(span(), tOf(p.x)));
      draw();
      return;
    }
    const kind = g.getAttribute('data-kind') as 'beat' | 'camera' | 'captions';
    const d = host.draft();
    const key = g.getAttribute('data-key') ?? '', i = Number(g.getAttribute('data-i') ?? -1);
    const from = kind === 'beat' ? (d[key as typeof BEATS[number]] as number) : d[kind][i].at;
    // keys and captions sitting on a beat ride along when it moves
    const riders = kind === 'beat' ? (['camera', 'captions'] as const).flatMap((list) => d[list].map((x, n) => ({ list, n, at: x.at })).filter((x) => Math.abs(x.at - from) < 1e-6).map((x) => ({ list: x.list, i: x.n }))) : [];
    drag = { kind, key, i, dx: p.x - xOf(from), moved: false, from, riders };
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const d = host.draft(), t = snap(tOf(local(e).x - drag.dx), e.altKey);
    if (Math.abs(xOf(t) - xOf(drag.from)) > 2) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'beat') {
      (d as unknown as Record<string, number>)[drag.key] = t;
      for (const r of drag.riders) d[r.list][r.i].at = t;
    } else d[drag.kind][drag.i].at = t;
    draw();
  };
  svg.onpointerup = (e) => {
    if (!drag) return;
    const dr = drag;
    drag = null;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    const field = dr.kind === 'beat' ? dr.key : `${dr.kind}[${dr.i}].at`;
    if (!dr.moved) { playhead = dr.from; draw(); host.reveal(field); return; }
    // keep lists in time order (the game reads them that way)
    const d = host.draft();
    for (const list of ['camera', 'captions'] as const) d[list].sort((a, b) => a.at - b.at);
    host.rerender();
  };
  new ResizeObserver(() => draw()).observe(el);
  draw();
  return { el, update: () => { if (!drag) draw(); } };
}
