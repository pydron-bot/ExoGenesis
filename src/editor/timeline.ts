/**
 * Cinematic timeline (Cinematics → any): camera keys, captions, spoken lines
 * and sound cues on one time axis, above the form (the landing adds its beats).
 *
 *   - drag a beat, a camera key, a caption, a line or a sound to move it (snaps
 *     to beats and whole tenths; hold Alt for no snapping). Anything that sat
 *     on a beat moves with it.
 *   - click an item to jump to its fields in the form below
 *   - click the ruler to put the playhead there: the caption and camera at
 *     that moment show underneath, and "Play from here" starts the game's
 *     cinematic there (unsaved edits included)
 *   - the curves are the camera's distance, pitch and yaw, as the game will
 *     interpolate them (the same monotone cubic: src/world/curve.ts)
 */
import { BEATS, cinematicShape, type CinematicDef } from '../content/defs';
import { pchip } from '../world/curve';

export interface TimelineHost {
  draft(): CinematicDef;
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

type ListKey = 'camera' | 'captions' | 'lines' | 'sounds';
const LISTS: ListKey[] = ['camera', 'captions', 'lines', 'sounds'];
/** Row positions: the landing has a band of beats at the top. */
const layout = (beats: boolean) => {
  const top = beats ? 92 : 30;
  const r = { ruler: 0, beats: 22, camera: top, captions: top + 30, lines: top + 56, sounds: top + 82, curves: top + 112 };
  return { ...r, H: r.curves + 94 };
};
const PAD_L = 74, PAD_R = 14;

let playhead = 0;

export function timelinePanel(host: TimelineHost): { el: HTMLElement; update(): void } {
  const svg = svgEl('svg', { class: 'tl' });
  const info = h('div', 'tl-info');
  const playAll = h('button', 'primary', '▶ Play it');
  const playHere = h('button', '', '▶ From the playhead');
  playAll.onclick = () => host.play(0);
  playHere.onclick = () => host.play(playhead);
  const el = h('div', 'tl-wrap', svg, h('div', 'tl-bar', info, h('div', 'actions', playAll, playHere)));
  let W = 800;
  let drag: { kind: 'beat' | ListKey; key: string; i: number; dx: number; moved: boolean; from: number; riders: { list: ListKey; i: number }[] } | null = null;
  const isLanding = () => host.draft().scene === 'landing';
  let L = layout(isLanding()), H = L.H;

  const span = () => Math.max(5, (host.draft().length ?? 27) + 1);
  const xOf = (t: number) => PAD_L + (t / span()) * (W - PAD_L - PAD_R);
  const tOf = (x: number) => ((x - PAD_L) / (W - PAD_L - PAD_R)) * span();
  const beatTimes = () => (isLanding() ? BEATS.map((b) => host.draft()[b] as number).filter((v) => typeof v === 'number') : []);
  const snap = (t: number, alt: boolean) => {
    t = Math.max(0, t);
    if (alt) return Math.round(t * 100) / 100;
    const near = beatTimes().find((b) => Math.abs(b - t) < span() * 0.006);
    return near ?? Math.round(t * 10) / 10;
  };

  /** Camera channels at time t (as the game computes them). */
  const camAt = (d: CinematicDef, t: number) => {
    const keys = d.camera ?? [];
    if (!keys.length) return null;
    const X = keys.map((k) => k.at);
    return {
      dist: Math.exp(pchip(X, keys.map((k) => Math.log(Math.max(1, k.dist ?? 1))), t)),
      pitch: pchip(X, keys.map((k) => k.pitch ?? 0), t),
      yaw: pchip(X, keys.map((k) => k.yaw ?? 0), t),
      on: (() => { let k = keys[0]; for (const x of keys) if (x.at <= t) k = x; return lookText(k); })(),
    };
  };

  const draw = () => {
    W = Math.max(400, el.clientWidth || 800);
    L = layout(isLanding());
    H = L.H;
    const ROWS = L;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
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
    if (isLanding()) label(ROWS.beats + 26, 'Beats');
    label(ROWS.camera + 4, 'Camera');
    label(ROWS.captions + 13, 'Captions');
    label(ROWS.lines + 13, 'Lines');
    label(ROWS.sounds + 13, 'Sounds');
    label(ROWS.curves + 12, 'Distance');
    label(ROWS.curves + 40, 'Pitch');
    label(ROWS.curves + 68, 'Yaw');
    // beats: a line through every row, the name staggered so neighbours don't collide
    if (isLanding()) BEATS.forEach((b, i) => {
      const t = d[b] as number;
      if (typeof t !== 'number') return;
      const x = xOf(t);
      svg.append(svgEl('line', { x1: x, x2: x, y1: ROWS.beats, y2: H - 4, class: 'tl-beat-line' }));
      const g = svgEl('g', { class: 'tl-beat', 'data-kind': 'beat', 'data-key': b });
      g.append(svgEl('rect', { x: x - 4, y: ROWS.beats + (i % 3) * 16, width: 8, height: 12, rx: 2 }), svgEl('text', { x: x + 6, y: ROWS.beats + (i % 3) * 16 + 10, class: 'tl-name' }, cinematicShape[b].label ?? b));
      svg.append(g);
    });
    // camera keys
    (d.camera ?? []).forEach((k, i) => {
      const x = xOf(k.at);
      const g = svgEl('g', { class: `tl-key ${k.target}`, 'data-kind': 'camera', 'data-i': i });
      g.append(svgEl('path', { d: `M${x} ${ROWS.camera - 7} L${x + 7} ${ROWS.camera} L${x} ${ROWS.camera + 7} L${x - 7} ${ROWS.camera} Z` }));
      g.append(svgEl('title', {}, `Key ${i + 1} at ${k.at}s: ${lookText(k)}, ${k.dist} u, pitch ${k.pitch}, yaw ${k.yaw}`));
      svg.append(g);
    });
    // captions: a block from each to the next
    const caps = d.captions ?? [];
    caps.forEach((c, i) => {
      const x0 = xOf(c.at), x1 = xOf(caps[i + 1]?.at ?? d.length ?? span());
      const g = svgEl('g', { class: 'tl-cap', 'data-kind': 'captions', 'data-i': i });
      g.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 1), height: 18, rx: 2 }));
      const clip = `tl-clip-${i}`;
      const cp = svgEl('clipPath', { id: clip });
      cp.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 4), height: 18 }));
      g.append(cp, svgEl('text', { x: x0 + 4, y: ROWS.captions + 13, 'clip-path': `url(#${clip})` }, c.title || '…'));
      g.append(svgEl('title', {}, `${c.at}s · ${c.title}${c.sub ? ` · ${c.sub}` : ''}`));
      svg.append(g);
    });
    // lines: a block for as long as each shows
    const ls = d.lines ?? [];
    ls.forEach((l, i) => {
      const end = l.at + (l.for ?? (ls[i + 1] ? ls[i + 1].at - l.at : 5));
      const x0 = xOf(l.at), x1 = xOf(Math.min(end, d.length ?? span()));
      const g = svgEl('g', { class: 'tl-line', 'data-kind': 'lines', 'data-i': i });
      g.append(svgEl('rect', { x: x0, y: ROWS.lines, width: Math.max(4, x1 - x0 - 1), height: 18, rx: 2 }));
      const clip = `tl-lclip-${i}`, cp = svgEl('clipPath', { id: clip });
      cp.append(svgEl('rect', { x: x0, y: ROWS.lines, width: Math.max(4, x1 - x0 - 4), height: 18 }));
      g.append(cp, svgEl('text', { x: x0 + 4, y: ROWS.lines + 13, 'clip-path': `url(#${clip})` }, `${l.character || l.speaker || '…'}: ${l.text || '…'}`));
      g.append(svgEl('title', {}, `${l.at}s · ${l.character || l.speaker || ''} · ${l.text}`));
      svg.append(g);
    });
    // sounds: a marker, and a bar to the end for music
    (d.sounds ?? []).forEach((x, i) => {
      const x0 = xOf(x.at);
      const g = svgEl('g', { class: `tl-sound${x.music ? ' music' : ''}`, 'data-kind': 'sounds', 'data-i': i });
      if (x.music) g.append(svgEl('rect', { x: x0, y: ROWS.sounds + 6, width: Math.max(4, xOf(d.length ?? span()) - x0), height: 6, rx: 2, class: 'tl-music' }));
      g.append(svgEl('circle', { cx: x0, cy: ROWS.sounds + 9, r: 6 }), svgEl('text', { x: x0 + 9, y: ROWS.sounds + 13 }, `${x.music ? '♫' : '♪'} ${x.sound || '…'}`));
      g.append(svgEl('title', {}, `${x.at}s · ${x.music ? 'music' : 'sound'} ${x.sound} · volume ${x.volume ?? 1}`));
      svg.append(g);
    });
    // the end
    if (typeof d.length === 'number') svg.append(svgEl('line', { x1: xOf(d.length), x2: xOf(d.length), y1: 14, y2: H - 4, class: 'tl-end' }));
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
    let cap: NonNullable<CinematicDef['captions']>[number] | undefined;
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
    const kind = g.getAttribute('data-kind') as 'beat' | ListKey;
    const d = host.draft();
    const key = g.getAttribute('data-key') ?? '', i = Number(g.getAttribute('data-i') ?? -1);
    const from = kind === 'beat' ? (d[key as typeof BEATS[number]] as number) : list(d, kind)[i].at;
    // anything sitting on a beat rides along when it moves
    const riders = kind === 'beat' ? LISTS.flatMap((lk) => list(d, lk).map((x, n) => ({ lk, n, at: x.at })).filter((x) => Math.abs(x.at - from) < 1e-6).map((x) => ({ list: x.lk, i: x.n }))) : [];
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
      for (const r of drag.riders) list(d, r.list)[r.i].at = t;
    } else list(d, drag.kind)[drag.i].at = t;
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
    for (const lk of LISTS) list(d, lk).sort((a, b) => a.at - b.at);
    host.rerender();
  };
  new ResizeObserver(() => draw()).observe(el);
  draw();
  return { el, update: () => { if (!drag) draw(); } };
}

/** A list on the draft (empty if it has none yet). */
const list = (d: CinematicDef, k: ListKey): { at: number }[] => (d[k] ?? []) as { at: number }[];

/** What a camera key looks at, in words. */
function lookText(k: NonNullable<CinematicDef['camera']>[number]) {
  switch (k.target) {
    case 'probe': return 'the probe';
    case 'building': return `the ${k.building ?? '?'}`;
    case 'storysite': return `site "${k.site ?? '?'}"`;
    case 'camp': return `the ${k.group ?? '?'} camp`;
    default: return `${k.x ?? 0}, ${k.z ?? 0}`;
  }
}
