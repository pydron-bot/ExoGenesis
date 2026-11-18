/**
 * Cinematic timeline (Cinematics → any): camera keys, captions, spoken lines
 * and sound cues on one time axis, above the form (the landing adds its beats).
 *
 *   - drag a beat, a camera key, a caption, a line or a sound to move it (snaps
 *     to beats and whole tenths; hold Alt for no snapping). Anything that sat
 *     on a beat moves with it. Drag the right edge of a line to set how long it shows.
 *   - click an item to select it (its card in the form lights up); Enter, or a
 *     double-click on a key or sound, jumps to its fields. Double-click a caption
 *     or line to edit its text in place.
 *   - selected: Delete / Backspace removes it, Ctrl/Cmd+D copies it to the
 *     playhead, ← / → nudge it 0.1 s (Shift: 1 s), Esc lets go
 *   - click or drag on the ruler (or any empty space) to move the playhead;
 *     Home / End, `,` / `.` step it; Space plays the preview
 *   - Ctrl+wheel zooms the time axis (it scrolls sideways when zoomed)
 *   - the curves are the camera's distance, pitch and yaw, as the game will
 *     interpolate them (the same monotone cubic: src/world/curve.ts)
 *
 * Every edit goes through the host (rerender → the form, undo history), and
 * lists stay sorted by time. Selection, zoom and the playhead live at module
 * level because each edit rebuilds the form and this panel with it.
 */
import { BEATS, cinematicShape, type CameraKeyDef, type CinematicDef } from '../content/defs';
import { pchip } from '../world/curve';
import type { CinePreview, Guides } from './cine-preview';

export interface TimelineHost {
  draft(): CinematicDef;
  /** The record's id (selection and zoom are kept per cinematic). */
  id(): string;
  /** The draft changed: refresh the form's dependants (and this). */
  changed(): void;
  /** A list was reordered or its values changed under the form: rebuild the form inputs. */
  rerender(): void;
  /** Focus the form row for a field path ("camera[3].at", "burn"). */
  reveal(field: string): void;
  /** Light up a list item's card in the form ("camera[3]"), or none. */
  highlight?(item: string | null): void;
  play(from: number): void;
  /** A preview in the editor (src/editor/cine-preview.ts) that follows the playhead. */
  preview?: CinePreview;
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
const button = (text: string, title: string, fn: () => void, cls = '') => {
  const b = h('button', cls, text);
  b.type = 'button';
  b.title = title;
  b.onclick = fn;
  return b;
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
/** Times in the content are in 0.05 s steps. */
const q05 = (t: number) => Math.round(t * 20) / 20;
const r2 = (t: number) => Math.round(t * 100) / 100;

let playhead = 0;
/** The selected list item (survives the re-render every edit causes). */
let sel: { kind: ListKey; i: number } | null = null;
/** Time-axis zoom (1 = the whole cinematic fits) and the scroll position when zoomed. */
let zoom = 1;
let scrollX = 0;
/** Open the in-place editor on this item once drawn (a caption or line just added). */
let editNext: { kind: 'captions' | 'lines'; item: object } | null = null;
/** Which cinematic the module state belongs to. */
let stateFor = '';

export function timelinePanel(host: TimelineHost): { el: HTMLElement; update(): void; stop(): void } {
  if (stateFor !== host.id()) { sel = null; editNext = null; zoom = 1; scrollX = 0; stateFor = host.id(); }
  const svg = svgEl('svg', { class: 'tl' });
  const scroller = h('div', 'tl-scroll', svg);
  const info = h('div', 'tl-info');
  const playAll = h('button', '', '▶ Play in the game');
  const playHere = h('button', '', '▶ From the playhead');
  playAll.onclick = () => host.play(0);
  playHere.onclick = () => host.play(playhead);
  // the preview plays here, in real time, moving the playhead
  const pvPlay = h('button', 'primary', '▶ Preview');
  pvPlay.title = 'Play it here (Space when not typing). No sound in the preview.';
  let raf = 0, last = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; pvPlay.textContent = '▶ Preview'; };
  const tick = (now: number) => {
    playhead = Math.min(span(), playhead + (now - last) / 1000);
    last = now;
    draw();
    if (playhead >= (host.draft().length ?? span())) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  pvPlay.onclick = () => {
    if (raf) { stop(); return; }
    if (host.preview?.isFree) host.preview.dropFree();
    if (playhead >= (host.draft().length ?? span()) - 0.05) playhead = 0;
    pvPlay.textContent = '❚❚ Pause';
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const actions = host.preview ? h('div', 'actions', pvPlay, playAll, playHere) : h('div', 'actions', playAll, playHere);

  // ---- editing: every change is one host.rerender() (the form and the undo history follow) ----
  const d0 = () => host.draft();
  const length = () => host.draft().length ?? span();
  const at = () => Math.max(0, Math.min(length(), q05(playhead)));
  /** Apply an edit, keep lists in time order, keep `item` selected, rebuild. */
  const commit = (fn: (d: CinematicDef) => void, keep?: { kind: ListKey; item: object | null }) => {
    stop();
    const d = d0();
    fn(d);
    for (const lk of LISTS) list(d, lk).sort((a, b) => a.at - b.at);
    if (keep) {
      const i = keep.item ? list(d, keep.kind).indexOf(keep.item as { at: number }) : -1;
      sel = i >= 0 ? { kind: keep.kind, i } : null;
    }
    host.rerender();
  };
  const selItem = () => (sel ? list(d0(), sel.kind)[sel.i] : undefined);
  /** Yaws of the camera keys either side of time t (or of key `skip`'s neighbours). */
  const nearYaws = (t: number, skip = -1) => {
    const keys = d0().camera ?? [];
    let before: CameraKeyDef | undefined, after: CameraKeyDef | undefined;
    keys.forEach((k, i) => { if (i === skip) return; if (k.at <= t) before = k; else if (!after) after = k; });
    if (skip >= 0) { before = keys[skip - 1]; after = keys[skip + 1]; }
    return [before, after].filter(Boolean).map((k) => k!.yaw);
  };
  /** ＋ Key from view: a `site` key at the playhead (or the key already there, within 0.05 s, takes the view). */
  const keyFromView = () => {
    const pv = host.preview;
    if (!pv) return;
    const t = at(), keys = d0().camera ?? [];
    const there = keys.findIndex((k) => Math.abs(k.at - t) <= 0.05 + 1e-9);
    playhead = t;
    if (there >= 0) {
      const k = keys[there];
      playhead = k.at;
      commit(() => pv.applyView(k, nearYaws(k.at, there)), { kind: 'camera', item: k });
      say(`Key ${there + 1} takes the view`);
    } else {
      if (keys.length >= (cinematicShape.camera.max ?? 60)) { say('That\'s as many camera keys as a cinematic can have'); return; }
      const k = pv.siteKey(t, nearYaws(t));
      commit((d) => { (d.camera ??= []).push(k); }, { kind: 'camera', item: k });
    }
    pv.dropFree();
  };
  /** Update selected key: point it at the view (keeping what it looks at). */
  const updateKey = () => {
    const pv = host.preview, k = sel?.kind === 'camera' ? (selItem() as CameraKeyDef | undefined) : undefined;
    if (!pv || !k || !sel) { say('Select a camera key first'); return; }
    const i = sel.i;
    commit(() => pv.applyView(k, nearYaws(k.at, i)), { kind: 'camera', item: k });
    if (Math.abs(k.at - playhead) < 0.005) pv.dropFree();
  };
  const remove = () => {
    const it = selItem();
    if (!it || !sel) return;
    const kind = sel.kind;
    commit((d) => {
      const l = list(d, kind);
      l.splice(l.indexOf(it), 1);
      if (!l.length && kind !== 'camera') delete d[kind];
    }, { kind, item: null });
  };
  const duplicate = () => {
    const it = selItem();
    if (!it || !sel) return;
    const kind = sel.kind, t = at();
    if (kind === 'camera' && (d0().camera ?? []).some((k) => Math.abs(k.at - t) < 0.05)) { say('A camera key already sits at the playhead: move the playhead first'); return; }
    const copy = { ...structuredClone(it), at: t };
    playhead = t;
    commit((d) => { (d as Record<string, unknown>)[kind] = [...list(d, kind), copy]; }, { kind, item: copy });
  };
  const nudge = (dt: number) => {
    const it = selItem();
    if (!it || !sel) return;
    const to = Math.max(0, Math.min(length(), r2(it.at + dt)));
    playhead = to;
    commit(() => { it.at = to; }, { kind: sel.kind, item: it });
  };
  const add = (kind: Exclude<ListKey, 'camera'>) => {
    const t = at(), d = d0();
    let item: { at: number } & Record<string, unknown>;
    if (kind === 'captions') item = { at: t, title: 'NEW CAPTION' };
    else if (kind === 'lines') {
      // the same voice as the line before
      const prev = [...(d.lines ?? [])].reverse().find((l) => l.at <= t);
      item = { at: t, ...(prev?.character ? { character: prev.character } : prev?.speaker ? { speaker: prev.speaker } : { speaker: 'Someone' }), text: '…' };
    } else item = { at: t, sound: '', volume: 1 };
    if (kind !== 'sounds') editNext = { kind, item };
    commit((x) => { (x as Record<string, unknown>)[kind] = [...list(x, kind), item]; }, { kind, item });
    if (kind === 'sounds') host.reveal(`sounds[${list(d0(), 'sounds').indexOf(item)}].sound`);
  };
  /** A short message in the info line (it goes on the next draw). */
  let said = '', saidUntil = 0;
  const say = (msg: string) => { said = msg; saidUntil = performance.now() + 2500; draw(); };

  // the preview's tools: fly it, then capture
  const capBtn = button('＋ Key from view', 'A `site` camera key at the playhead that frames what the preview shows (a key already at the playhead takes the view instead, as with Update selected key). Drag the preview to orbit, Shift / right drag to pan, wheel for distance, Alt+wheel for height.', keyFromView, 'primary-ish');
  const updBtn = button('Update selected key', 'Point the selected camera key at this view. A key that looks at a building, story site, camp or the probe keeps looking at it and takes the distance, pitch, yaw and height.', updateKey);
  const backBtn = button('Back to the cinematic', 'Drop the free view: the preview follows the cinematic again.', () => { host.preview?.dropFree(); syncTools(); });
  const guideNames: Record<Guides, string> = { off: 'Guides: off', thirds: 'Guides: thirds', safe: 'Guides: title safe' };
  const guideBtn = button(guideNames[host.preview?.guides ?? 'off'], 'Rule of thirds, or title (80%) and action (90%) safe areas, over the preview.', () => {
    const pv = host.preview;
    if (!pv) return;
    const order: Guides[] = ['off', 'thirds', 'safe'];
    pv.guides = order[(order.indexOf(pv.guides) + 1) % order.length];
    guideBtn.textContent = guideNames[pv.guides];
  });
  const syncTools = () => {
    const free = !!host.preview?.isFree;
    backBtn.disabled = !free;
    updBtn.disabled = sel?.kind !== 'camera';
    capBtn.textContent = (d0().camera ?? []).some((k) => Math.abs(k.at - at()) <= 0.05 + 1e-9) ? '＋ Key from view (updates the key here)' : '＋ Key from view';
  };
  const pvTools = host.preview
    ? h('div', 'pv-tools', capBtn, updBtn, backBtn, guideBtn, h('span', 'pv-hint', 'Drag: orbit · Shift / right drag: pan · wheel: distance · Alt+wheel: height'))
    : null;
  if (host.preview) {
    host.preview.onFly = () => { stop(); syncTools(); };
    host.preview.onPick = (i) => { sel = { kind: 'camera', i }; playhead = (d0().camera ?? [])[i]?.at ?? playhead; draw(); };
  }
  const tlTools = h('div', 'tl-tools',
    h('span', 'tl-tools-lbl', 'Add at the playhead:'),
    button('＋ Camera key', 'A camera key here, framing what the preview shows', keyFromView),
    button('＋ Caption', 'A caption here (type its title)', () => add('captions')),
    button('＋ Line', 'A spoken line here (type it)', () => add('lines')),
    button('＋ Sound', 'A sound cue here (pick the audio in the form)', () => add('sounds')),
    h('span', 'tl-tools-keys', 'Del remove · Ctrl+D copy here · ←/→ nudge · Ctrl+wheel zoom'),
  );

  const el = h('div', 'tl-wrap', ...(host.preview ? [host.preview.el] : []), ...(pvTools ? [pvTools] : []), tlTools, scroller, h('div', 'tl-bar', info, actions));
  let W = 800, VW = 800;
  let drag: { kind: 'beat' | ListKey | 'for' | 'scrub'; key: string; i: number; dx: number; moved: boolean; from: number; riders: { list: ListKey; i: number }[] } | null = null;
  const isLanding = () => host.draft().scene === 'landing';
  let L = layout(isLanding()), H = L.H;
  let mounted = false;

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
    VW = Math.max(400, scroller.clientWidth || el.clientWidth || 800);
    W = Math.round(VW * zoom);
    L = layout(isLanding());
    H = L.H;
    const ROWS = L;
    if (sel && !selItem()) sel = null;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = `${W}px`;
    if (!mounted && scroller.isConnected && scroller.clientWidth) { mounted = true; scroller.scrollLeft = scrollX; }
    svg.replaceChildren();
    const d = host.draft();
    const isSel = (kind: ListKey, i: number) => sel?.kind === kind && sel.i === i;
    // ruler: a tick every second (every 0.1 s when zoomed in), a label every 5 (every 1)
    const fine = (W - PAD_L - PAD_R) / span() > 60;
    for (let n = 0; n <= span() * (fine ? 10 : 1); n++) {
      const t = fine ? n / 10 : n, x = xOf(t), major = fine ? n % 10 === 0 : n % 5 === 0;
      svg.append(svgEl('line', { x1: x, x2: x, y1: 12, y2: major ? 20 : fine && n % 5 === 0 ? 18 : 16, class: 'tl-tick' }));
      if (major) svg.append(svgEl('text', { x: x + 2, y: 10, class: 'tl-lbl' }, `${t}s`));
    }
    svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: 21, class: 'tl-ruler' }));
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
      const g = svgEl('g', { class: `tl-key ${k.target}${isSel('camera', i) ? ' sel' : ''}`, 'data-kind': 'camera', 'data-i': i });
      g.append(svgEl('path', { d: `M${x} ${ROWS.camera - 7} L${x + 7} ${ROWS.camera} L${x} ${ROWS.camera + 7} L${x - 7} ${ROWS.camera} Z` }));
      g.append(svgEl('text', { x, y: ROWS.camera + 18, class: 'tl-knum' }, String(i + 1)));
      g.append(svgEl('title', {}, `Key ${i + 1} at ${k.at}s: ${lookText(k)}, ${k.dist} u, pitch ${k.pitch}, yaw ${k.yaw}`));
      svg.append(g);
    });
    // captions: a block from each to the next
    const caps = d.captions ?? [];
    caps.forEach((c, i) => {
      const x0 = xOf(c.at), x1 = xOf(caps[i + 1]?.at ?? d.length ?? span());
      const g = svgEl('g', { class: `tl-cap${isSel('captions', i) ? ' sel' : ''}`, 'data-kind': 'captions', 'data-i': i });
      g.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 1), height: 18, rx: 2 }));
      const clip = `tl-clip-${i}`;
      const cp = svgEl('clipPath', { id: clip });
      cp.append(svgEl('rect', { x: x0, y: ROWS.captions, width: Math.max(4, x1 - x0 - 4), height: 18 }));
      g.append(cp, svgEl('text', { x: x0 + 4, y: ROWS.captions + 13, 'clip-path': `url(#${clip})` }, c.title || '…'));
      g.append(svgEl('title', {}, `${c.at}s · ${c.title}${c.sub ? ` · ${c.sub}` : ''} (double-click to edit)`));
      svg.append(g);
    });
    // lines: a block for as long as each shows (drag its right edge for "Shows for")
    const ls = d.lines ?? [];
    ls.forEach((l, i) => {
      const end = l.at + (l.for ?? (ls[i + 1] ? ls[i + 1].at - l.at : 5));
      const x0 = xOf(l.at), x1 = xOf(Math.min(end, d.length ?? span()));
      const g = svgEl('g', { class: `tl-line${isSel('lines', i) ? ' sel' : ''}`, 'data-kind': 'lines', 'data-i': i });
      g.append(svgEl('rect', { x: x0, y: ROWS.lines, width: Math.max(4, x1 - x0 - 1), height: 18, rx: 2 }));
      const clip = `tl-lclip-${i}`, cp = svgEl('clipPath', { id: clip });
      cp.append(svgEl('rect', { x: x0, y: ROWS.lines, width: Math.max(4, x1 - x0 - 8), height: 18 }));
      g.append(cp, svgEl('text', { x: x0 + 4, y: ROWS.lines + 13, 'clip-path': `url(#${clip})` }, `${l.character || l.speaker || '…'}: ${l.text || '…'}`));
      g.append(svgEl('title', {}, `${l.at}s · ${l.character || l.speaker || ''} · ${l.text} (double-click to edit; drag the right edge for how long it shows)`));
      const grip = svgEl('rect', { x: Math.max(x0 + 2, x1 - 6), y: ROWS.lines, width: 6, height: 18, class: 'tl-grip', 'data-grip': 1 });
      grip.append(svgEl('title', {}, `Shows for ${l.for !== undefined ? `${l.for} s` : `${r2(end - l.at)} s (until the next)`}: drag to change`));
      g.append(grip);
      svg.append(g);
    });
    // sounds: a marker, and a bar to the end for music
    (d.sounds ?? []).forEach((x, i) => {
      const x0 = xOf(x.at);
      const g = svgEl('g', { class: `tl-sound${x.music ? ' music' : ''}${isSel('sounds', i) ? ' sel' : ''}`, 'data-kind': 'sounds', 'data-i': i });
      if (x.music) g.append(svgEl('rect', { x: x0, y: ROWS.sounds + 6, width: Math.max(4, xOf(d.length ?? span()) - x0), height: 6, rx: 2, class: 'tl-music' }));
      g.append(svgEl('circle', { cx: x0, cy: ROWS.sounds + 9, r: 6 }), svgEl('text', { x: x0 + 9, y: ROWS.sounds + 13 }, `${x.music ? '♫' : '♪'} ${x.sound || '…'}`));
      g.append(svgEl('title', {}, `${x.at}s · ${x.music ? 'music' : 'sound'} ${x.sound} · volume ${x.volume ?? 1}`));
      svg.append(g);
    });
    // the end
    if (typeof d.length === 'number') svg.append(svgEl('line', { x1: xOf(d.length), x2: xOf(d.length), y1: 14, y2: H - 4, class: 'tl-end' }));
    // curves (sampled at most every pixel, at most 1500 times)
    if (d.camera?.length) {
      const n = Math.min(1500, Math.round(W - PAD_L - PAD_R));
      const xs = Array.from({ length: n + 1 }, (_, i) => PAD_L + (i / n) * (W - PAD_L - PAD_R));
      const samples = xs.map((x) => camAt(d, tOf(x))!);
      (['dist', 'pitch', 'yaw'] as const).forEach((k, row) => {
        const vs = samples.map((s) => (k === 'dist' ? Math.log(s.dist) : s[k]));
        const lo = Math.min(...vs), hi = Math.max(...vs);
        const y0 = ROWS.curves + row * 28 + 22;
        const pts = vs.map((v, i) => `${xs[i].toFixed(1)},${(y0 - ((v - lo) / Math.max(1e-6, hi - lo)) * 18).toFixed(1)}`).join(' ');
        svg.append(svgEl('polyline', { points: pts, class: `tl-curve ${k}` }));
      });
      for (const k of d.camera) svg.append(svgEl('line', { x1: xOf(k.at), x2: xOf(k.at), y1: ROWS.curves, y2: H - 4, class: 'tl-key-line' }));
    }
    // row labels, pinned to the left edge however it scrolls
    const sx = scroller.scrollLeft;
    svg.append(svgEl('rect', { x: sx, y: 21, width: PAD_L - 8, height: H - 21, class: 'tl-gutter' }));
    const label = (y: number, text: string) => svg.append(svgEl('text', { x: sx + 6, y, class: 'tl-row' }, text));
    if (isLanding()) label(ROWS.beats + 26, 'Beats');
    label(ROWS.camera + 4, 'Camera');
    label(ROWS.captions + 13, 'Captions');
    label(ROWS.lines + 13, 'Lines');
    label(ROWS.sounds + 13, 'Sounds');
    label(ROWS.curves + 12, 'Distance');
    label(ROWS.curves + 40, 'Pitch');
    label(ROWS.curves + 68, 'Yaw');
    // playhead
    const px = xOf(playhead);
    svg.append(svgEl('line', { x1: px, x2: px, y1: 0, y2: H, class: 'tl-play' }), svgEl('path', { d: `M${px - 5} 0 L${px + 5} 0 L${px} 7 Z`, class: 'tl-play-head' }));
    // what's on screen at the playhead
    let cap: NonNullable<CinematicDef['captions']>[number] | undefined;
    for (const c of caps) if (c.at <= playhead) cap = c;
    const cam = camAt(d, playhead);
    const selText = sel ? ` · selected: ${({ camera: 'key', captions: 'caption', lines: 'line', sounds: 'sound' })[sel.kind]} ${sel.i + 1}` : '';
    info.textContent = performance.now() < saidUntil ? `${playhead.toFixed(1)} s · ${said}`
      : `${playhead.toFixed(1)} s · ${cap ? `“${cap.title}${cap.sub ? ` · ${cap.sub}` : ''}”` : 'no caption'}${cam ? ` · camera on ${cam.on}, ${cam.dist.toFixed(0)} u, pitch ${cam.pitch.toFixed(2)}, yaw ${cam.yaw.toFixed(2)}` : ''}${selText}`;
    playHere.textContent = `▶ From ${playhead.toFixed(1)} s`;
    host.highlight?.(sel ? `${sel.kind}[${sel.i}]` : null);
    if (host.preview) host.preview.selected = sel?.kind === 'camera' ? sel.i : null;
    host.preview?.show(playhead);
    syncTools();
    if (editNext && scroller.isConnected) { const e = editNext; editNext = null; const i = list(d, e.kind).indexOf(e.item as { at: number }); if (i >= 0) inlineEdit(e.kind, i); }
  };

  /** Edit a caption's title or a line's text in place, over its block. */
  const inlineEdit = (kind: 'captions' | 'lines', i: number) => {
    const d = d0(), item = list(d, kind)[i] as { at: number; title?: string; text?: string };
    if (!item) return;
    const field = kind === 'captions' ? 'title' : 'text';
    const g = svg.querySelector(`g[data-kind="${kind}"][data-i="${i}"] rect`);
    const x = Number(g?.getAttribute('x') ?? xOf(item.at)), y = kind === 'captions' ? L.captions : L.lines;
    const input = h('input', 'tl-edit');
    input.value = item[field] ?? '';
    input.style.left = `${x}px`;
    input.style.top = `${y - 2}px`;
    input.style.width = `${Math.max(220, Number(g?.getAttribute('width') ?? 0))}px`;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const v = input.value;
      input.remove();
      if (save && v !== (item[field] ?? '')) commit(() => { item[field] = v; }, { kind, item });
      else draw();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    input.onblur = () => finish(true);
    scroller.append(input);
    input.focus();
    input.select();
  };

  const local = (e: { clientX: number; clientY: number }) => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  svg.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const g = target.closest('g[data-kind]');
    const p = local(e);
    if (!g) {
      // the ruler (or empty space): move the playhead, and keep moving it while dragging
      stop();
      playhead = Math.max(0, Math.min(span(), tOf(p.x)));
      drag = { kind: 'scrub', key: '', i: -1, dx: 0, moved: false, from: playhead, riders: [] };
      svg.setPointerCapture(e.pointerId);
      draw();
      return;
    }
    const kind = g.getAttribute('data-kind') as 'beat' | ListKey;
    const d = host.draft();
    const key = g.getAttribute('data-key') ?? '', i = Number(g.getAttribute('data-i') ?? -1);
    if (kind === 'lines' && target.hasAttribute('data-grip')) {
      const l = (d.lines ?? [])[i];
      drag = { kind: 'for', key: '', i, dx: 0, moved: false, from: l.at, riders: [] };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const from = kind === 'beat' ? (d[key as typeof BEATS[number]] as number) : list(d, kind)[i].at;
    // anything sitting on a beat rides along when it moves
    const riders = kind === 'beat' ? LISTS.flatMap((lk) => list(d, lk).map((x, n) => ({ lk, n, at: x.at })).filter((x) => Math.abs(x.at - from) < 1e-6).map((x) => ({ list: x.lk, i: x.n }))) : [];
    drag = { kind, key, i, dx: p.x - xOf(from), moved: false, from, riders };
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const d = host.draft();
    if (drag.kind === 'scrub') { playhead = Math.max(0, Math.min(span(), tOf(local(e).x))); draw(); return; }
    if (drag.kind === 'for') {
      const l = (d.lines ?? [])[drag.i];
      l.for = Math.max(0.5, Math.min(60, Math.round((snap(tOf(local(e).x), e.altKey) - l.at) * 10) / 10));
      drag.moved = true;
      draw();
      return;
    }
    const t = snap(tOf(local(e).x - drag.dx), e.altKey);
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
    if (dr.kind === 'scrub') return;
    if (dr.kind === 'for') { commit(() => {}, { kind: 'lines', item: (d0().lines ?? [])[dr.i] ?? null }); return; }
    if (!dr.moved) {
      playhead = dr.from;
      if (dr.kind === 'beat') { draw(); host.reveal(dr.key); return; }
      // a second click on the same item soon after: a double-click (the redraw in between loses the browser's own)
      const again = lastClick && lastClick.kind === dr.kind && lastClick.i === dr.i && performance.now() - lastClick.t < 450;
      lastClick = again ? null : { kind: dr.kind, i: dr.i, t: performance.now() };
      sel = { kind: dr.kind, i: dr.i };
      draw();
      if (again) open(dr.kind, dr.i);
      return;
    }
    // keep lists in time order (the game reads them that way); the moved item stays selected
    if (dr.kind === 'beat') { commit(() => {}); return; }
    commit(() => {}, { kind: dr.kind, item: list(d0(), dr.kind)[dr.i] });
  };
  /** Double-click: a caption or line edits in place, a key or sound shows its fields. */
  let lastClick: { kind: ListKey; i: number; t: number } | null = null;
  const open = (kind: ListKey, i: number) => {
    if (kind === 'captions' || kind === 'lines') inlineEdit(kind, i);
    else host.reveal(`${kind}[${i}].${kind === 'camera' ? 'target' : 'sound'}`);
  };
  // Ctrl / Cmd + wheel zooms the time axis round the pointer; it scrolls sideways when zoomed
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect(), t = tOf(local(e).x);
    zoom = Math.max(1, Math.min(60, zoom * Math.exp(-e.deltaY * 0.002)));
    draw();
    scroller.scrollLeft = Math.max(0, xOf(t) - (e.clientX - r.left));
    scrollX = scroller.scrollLeft;
    draw();
  }, { passive: false });
  scroller.addEventListener('scroll', () => { scrollX = scroller.scrollLeft; if (!drag) requestAnimationFrame(() => draw()); });

  // keys on the timeline (while it's on the page and nobody is typing)
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) { removeEventListener('keydown', onKey); return; }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (t?.closest('#top, #side-top')) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = (to: number) => { e.preventDefault(); stop(); playhead = Math.max(0, Math.min(length(), r2(to))); draw(); };
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !mod) { e.preventDefault(); remove(); }
    else if (mod && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); duplicate(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !mod && !e.altKey) {
      const dt = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
      if (sel) { e.preventDefault(); nudge(dt); } else step(playhead + dt);
    } else if (e.key === 'Home' && !mod) step(0);
    else if (e.key === 'End' && !mod) step(length());
    else if ((e.key === ',' || e.key === '.') && !mod) step(playhead + (e.key === ',' ? -0.1 : 0.1));
    else if (e.key === 'Enter' && sel && !mod) { e.preventDefault(); host.reveal(`${sel.kind}[${sel.i}].at`); }
    else if (e.key === 'Escape' && sel) { sel = null; draw(); }
  };
  addEventListener('keydown', onKey);
  new ResizeObserver(() => draw()).observe(el);
  draw();
  return { el, stop, update: () => { host.preview?.refresh(); if (!drag) draw(); } };
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
