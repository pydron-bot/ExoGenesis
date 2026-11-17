/**
 * Planet view: every region on a map of the whole planet, placed by its
 * `siteLat` / `siteLon` (degrees north and east of Touchdown). Drag a region to
 * move it; Save writes the moved regions' files.
 *
 * The map is an equirectangular projection in Touchdown's frame (so Touchdown
 * sits at 0, 0), coloured with the game's own terrain functions. In game the
 * ground under the region being played is lifted onto dry land (planet.ts
 * `siteLift`); the map shows that lift round every region.
 */
import * as THREE from 'three';
import { REGION_HALF } from '../sim/types';
import { R, bodyFlora, bodyHeight, siteDir, siteLift, terrainColor } from '../world/planet';

export interface PlanetRegion { id: string; name: string; lat: number; lon: number }
export interface PlanetHost {
  regions: PlanetRegion[];
  open(id: string): void;
  /** Write new positions to the regions' files. */
  save(moves: PlanetRegion[]): Promise<void>;
}

const W = 720, H = 320, LAT = 80;
/** A region's half-width on the planet, in degrees. */
const HALF_DEG = THREE.MathUtils.radToDeg(REGION_HALF / R);
/** Base terrain, computed once: per-pixel direction, height and flora. */
let base: { dir: Float32Array; h: Float32Array; f: Float32Array } | null = null;
let baking: Promise<void> | null = null;

const pxLon = (x: number) => -180 + ((x + 0.5) / W) * 360;
const pxLat = (y: number) => LAT - ((y + 0.5) / H) * LAT * 2;

async function bake(progress: (k: number) => void) {
  const dir = new Float32Array(W * H * 3), h = new Float32Array(W * H), f = new Float32Array(W * H);
  const v = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      siteDir(pxLat(y), pxLon(x), v);
      const i = y * W + x;
      dir[i * 3] = v.x; dir[i * 3 + 1] = v.y; dir[i * 3 + 2] = v.z;
      h[i] = bodyHeight(v);
      f[i] = bodyFlora(v);
    }
    if (y % 16 === 15) { progress(y / H); await new Promise((r) => setTimeout(r)); }
  }
  base = { dir, h, f };
}

/** Angle (degrees) between two sites. */
export function siteAngle(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return THREE.MathUtils.radToDeg(siteDir(a.lat, a.lon).angleTo(siteDir(b.lat, b.lon)));
}

/** Regions whose squares overlap (closer than one region's width, plus a little). */
export function overlaps(regions: PlanetRegion[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    if (siteAngle(regions[i], regions[j]) < HALF_DEG * 2.2) out.push([regions[i].id, regions[j].id]);
  }
  return out;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

export function renderPlanet(main: HTMLElement, aside: HTMLElement, host: PlanetHost): { dispose(): void } {
  const regs = host.regions.map((r) => ({ ...r }));
  const orig = new Map(host.regions.map((r) => [r.id, { lat: r.lat, lon: r.lon }]));
  let disposed = false;
  const canvas = h('canvas', 'planet-map');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = document.createElement('canvas');
  img.width = W; img.height = H;
  const ictx = img.getContext('2d')!;
  const readout = h('div', 'planet-readout', 'Drawing the planet…');
  const save = h('button', 'primary', 'Save positions');
  const reset = h('button', '', 'Undo moves');
  const list = h('div', 'planet-list');
  let drag: { id: string; dx: number; dy: number } | null = null;
  let hover: string | null = null;

  const toPx = (lat: number, lon: number) => ({ x: ((lon + 180) / 360) * W, y: ((LAT - lat) / (LAT * 2)) * H });
  const fromPx = (x: number, y: number) => ({ lat: LAT - (y / H) * LAT * 2, lon: (x / W) * 360 - 180 });
  const moved = () => regs.filter((r) => { const o = orig.get(r.id)!; return o.lat !== r.lat || o.lon !== r.lon; });

  /** Recolour the map with the dry-land lift round each region. */
  const paint = () => {
    if (!base) return;
    const data = ictx.createImageData(W, H), c = new THREE.Color();
    const dirs = regs.map((r) => siteDir(r.lat, r.lon));
    for (let i = 0; i < W * H; i++) {
      let lift = 0;
      for (const d of dirs) {
        const dot = base.dir[i * 3] * d.x + base.dir[i * 3 + 1] * d.y + base.dir[i * 3 + 2] * d.z;
        if (dot > 0.96) lift = Math.max(lift, siteLift(Math.acos(Math.min(1, dot))));
      }
      terrainColor(base.h[i] + lift, base.f[i], c);
      data.data[i * 4] = c.r * 255; data.data[i * 4 + 1] = c.g * 255; data.data[i * 4 + 2] = c.b * 255; data.data[i * 4 + 3] = 255;
    }
    ictx.putImageData(data, 0, 0);
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    // graticule every 30°
    ctx.strokeStyle = 'rgba(207, 230, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let lon = -150; lon < 180; lon += 30) { const { x } = toPx(0, lon); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { const { y } = toPx(lat, 0); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const bad = new Set(overlaps(regs).flat());
    for (const r of regs) {
      const p = toPx(r.lat, r.lon);
      const hw = (HALF_DEG / Math.cos(THREE.MathUtils.degToRad(r.lat)) / 360) * W, hh = (HALF_DEG / (LAT * 2)) * H;
      const on = r.id === hover || r.id === drag?.id;
      ctx.strokeStyle = bad.has(r.id) ? '#ff6f61' : on ? '#ffffff' : '#3fd6ff';
      ctx.lineWidth = on ? 2 : 1.5;
      ctx.strokeRect(p.x - Math.max(3, hw), p.y - Math.max(3, hh), Math.max(6, hw * 2), Math.max(6, hh * 2));
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(5, 8, 13, 0.75)';
      const label = r.name;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(p.x + 8, p.y - 18, tw + 8, 15);
      ctx.fillStyle = bad.has(r.id) ? '#ff6f61' : '#d5e3f0';
      ctx.fillText(label, p.x + 12, p.y - 7);
    }
  };

  const at = (e: MouseEvent) => {
    const b = canvas.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H };
  };
  const hit = (x: number, y: number) => regs.find((r) => { const p = toPx(r.lat, r.lon); return Math.abs(p.x - x) < 9 && Math.abs(p.y - y) < 9; })?.id ?? null;
  canvas.onpointermove = (e) => {
    const p = at(e), ll = fromPx(p.x, p.y);
    if (drag) {
      const r = regs.find((x) => x.id === drag!.id)!;
      const n = fromPx(p.x - drag.dx, p.y - drag.dy);
      r.lat = Math.round(Math.max(-LAT, Math.min(LAT, n.lat)));
      r.lon = Math.round(((n.lon + 540) % 360) - 180);
      renderList();
    } else hover = hit(p.x, p.y);
    canvas.style.cursor = drag ? 'grabbing' : hover ? 'grab' : 'crosshair';
    const i = Math.floor(p.y) * W + Math.floor(p.x);
    const ht = base && i >= 0 && i < W * H ? base.h[i] : NaN;
    readout.textContent = `${Math.abs(ll.lat).toFixed(0)}° ${ll.lat >= 0 ? 'N' : 'S'}  ${Math.abs(ll.lon).toFixed(0)}° ${ll.lon >= 0 ? 'E' : 'W'}${Number.isFinite(ht) ? `  ·  ${ht < 0 ? `sea, ${(-ht).toFixed(0)} u deep` : `ground ${ht.toFixed(0)} u up`} (before the dry-land lift)` : ''}${hover ? `  ·  ${regs.find((r) => r.id === hover)!.name}: drag to move, double-click to open` : ''}`;
    draw();
  };
  canvas.onpointerdown = (e) => {
    const p = at(e), id = hit(p.x, p.y);
    if (!id) return;
    const r = regs.find((x) => x.id === id)!, q = toPx(r.lat, r.lon);
    drag = { id, dx: p.x - q.x, dy: p.y - q.y };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointerup = () => { if (drag) { drag = null; paint(); draw(); renderList(); } };
  canvas.ondblclick = (e) => { const p = at(e), id = hit(p.x, p.y); if (id) host.open(id); };

  const renderList = () => {
    list.replaceChildren();
    const td = regs.find((r) => r.id === 'touchdown') ?? { lat: 0, lon: 0 };
    const bad = overlaps(regs);
    for (const r of regs) {
      const num = (key: 'lat' | 'lon', min: number, max: number) => {
        const inp = h('input', 'planet-num');
        inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1';
        inp.value = String(r[key]);
        inp.onchange = () => { r[key] = Math.max(min, Math.min(max, Math.round(Number(inp.value) || 0))); paint(); draw(); renderList(); };
        return inp;
      };
      const o = orig.get(r.id)!;
      const name = h('a', 'fl-link', r.name);
      name.href = '#';
      name.onclick = (e) => { e.preventDefault(); host.open(r.id); };
      const dist = siteAngle(r, td);
      list.append(h('div', `planet-row${o.lat !== r.lat || o.lon !== r.lon ? ' moved' : ''}`,
        h('div', '', name, h('small', 'dim', ` ${r.id}`)),
        h('label', '', num('lat', -LAT, LAT), '° N'), h('label', '', num('lon', -180, 180), '° E'),
        h('div', 'dim', r.id === 'touchdown' ? 'the landing site' : `${Math.round(THREE.MathUtils.degToRad(dist) * R).toLocaleString()} u from Touchdown (${dist.toFixed(0)}°)`)));
    }
    for (const [a, b] of bad) list.append(h('div', 'issue', `${regs.find((r) => r.id === a)!.name} and ${regs.find((r) => r.id === b)!.name} overlap: the same ground would turn up in both.`));
    const m = moved();
    save.disabled = reset.disabled = !m.length;
    save.textContent = m.length ? `Save ${m.length} position${m.length > 1 ? 's' : ''}` : 'Save positions';
  };
  save.onclick = async () => { save.disabled = true; await host.save(moved()); for (const r of regs) orig.set(r.id, { lat: r.lat, lon: r.lon }); renderList(); };
  reset.onclick = () => { for (const r of regs) Object.assign(r, orig.get(r.id)); paint(); draw(); renderList(); };

  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Planet'), h('div', 'path', 'Every region on the planet. Drag one to move it; double-click to open it.')), h('div', 'actions', reset, save)),
    h('div', 'planet-wrap', canvas),
    readout,
  );
  aside.replaceChildren(
    h('div', 'group', 'Regions'), list,
    h('div', 'group', 'Reading the map'),
    h('div', 'help-block', `Degrees north and east of Touchdown, which sits at 0, 0. Each box is a region (${REGION_HALF * 2} u across). Moving a region changes the generated ground under its sculpting: open it afterwards to check its map. The game lifts the ground near the region being played onto dry land; the map shows that round every region. Red boxes overlap another region.`),
  );
  renderList();
  void (async () => {
    if (!base) {
      baking ??= bake((k) => { if (!disposed) readout.textContent = `Drawing the planet… ${Math.round(k * 100)}%`; });
      await baking;
    }
    if (disposed) return;
    paint();
    draw();
    readout.textContent = 'Hover for coordinates and depth.';
  })();
  return { dispose() { disposed = true; } };
}
