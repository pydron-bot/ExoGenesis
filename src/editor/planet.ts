/**
 * Planet view: every region on a map of a whole body (Home, a moon, an
 * asteroid…), placed by its `siteLat` / `siteLon` (degrees north and east of the
 * body's 0, 0: Touchdown's spot on Home). Pick the body at the top; drag a
 * region to move it; Save writes the moved regions' files. ＋ New region starts
 * one where you click.
 *
 * The map is an equirectangular projection in the region frame (so 0, 0 is in
 * the middle), coloured with the game's own terrain functions for that body. In
 * game the ground under the region being played is lifted onto dry land on a
 * body with seas (planet.ts `siteLift`) unless it keeps its sea; the map shows that lift round every region that has it.
 */
import * as THREE from 'three';
import { DEFAULT_REGION_SIZE } from '../sim/types';
import { bodyFlora, bodyHeight, bodyTerrain, siteDir, siteLift, terrainColorFor, type BodyTerrain } from '../world/planet';

export interface PlanetRegion { id: string; name: string; lat: number; lon: number; body: string; size: number; keepSea?: boolean }
export interface PlanetBody { id: string; name: string; kind: string; def: Record<string, unknown> }
export interface PlanetHost {
  regions: PlanetRegion[];
  bodies: PlanetBody[];
  /** The body to show first. */
  body: string;
  /** The body shown changed (remembered for next time). */
  pick(body: string): void;
  open(id: string): void;
  /** Write new positions to the regions' files. */
  save(moves: PlanetRegion[]): Promise<void>;
  /** Make a region at this spot (asks for its id), then open it. */
  create(at: { body: string; lat: number; lon: number }): void;
}

const W = 720, H = 320, LAT = 80;
/** A region's half-width on a body, in degrees. */
const halfDeg = (size: number, radius: number) => THREE.MathUtils.radToDeg(Math.min(1.2, size / 2 / radius));
/** Base terrain per body, computed once each: per-pixel direction, height and flora. */
const bases = new Map<string, { dir: Float32Array; h: Float32Array; f: Float32Array }>();
const bakings = new Map<string, Promise<void>>();

const pxLon = (x: number) => -180 + ((x + 0.5) / W) * 360;
const pxLat = (y: number) => LAT - ((y + 0.5) / H) * LAT * 2;

async function bake(w: BodyTerrain, key: string, progress: (k: number) => void) {
  const dir = new Float32Array(W * H * 3), h = new Float32Array(W * H), f = new Float32Array(W * H);
  const v = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      siteDir(pxLat(y), pxLon(x), v);
      const i = y * W + x;
      dir[i * 3] = v.x; dir[i * 3 + 1] = v.y; dir[i * 3 + 2] = v.z;
      h[i] = bodyHeight(v, w);
      f[i] = bodyFlora(v, w);
    }
    if (y % 16 === 15) { progress(y / H); await new Promise((r) => setTimeout(r)); }
  }
  bases.set(key, { dir, h, f });
}

/** Angle (degrees) between two sites. */
export function siteAngle(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return THREE.MathUtils.radToDeg(siteDir(a.lat, a.lon).angleTo(siteDir(b.lat, b.lon)));
}

/** Regions on the same body whose squares overlap (closer than their half-widths together, plus a little). */
export function overlaps(regions: PlanetRegion[], radius = 3000): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i], b = regions[j];
    if (a.body !== b.body) continue;
    if (siteAngle(a, b) < (halfDeg(a.size, radius) + halfDeg(b.size, radius)) * 1.1) out.push([a.id, b.id]);
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
  const all = host.regions.map((r) => ({ ...r }));
  const landable = host.bodies.filter((b) => b.kind !== 'giant');
  let bodyId = landable.some((b) => b.id === host.body) ? host.body : 'home';
  const bodyOf = () => landable.find((b) => b.id === bodyId);
  let world = bodyTerrain(bodyId, bodyOf()?.def);
  let color = terrainColorFor(world);
  /** The regions on the body shown. */
  let regs = all.filter((r) => r.body === bodyId);
  let base: { dir: Float32Array; h: Float32Array; f: Float32Array } | null = null;
  let placing = false;
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
  const add = h('button', '', '＋ New region');
  add.title = 'Then click the map where it should go';
  add.onclick = () => { placing = !placing; add.classList.toggle('on', placing); readout.textContent = placing ? 'Click the map where the new region should go (Esc to stop).' : ''; };
  const picker = h('select', 'planet-body');
  for (const b of landable) {
    const o = h('option', '', `${b.name} (${b.kind}${all.filter((r) => r.body === b.id).length ? ` · ${all.filter((r) => r.body === b.id).length} region${all.filter((r) => r.body === b.id).length > 1 ? 's' : ''}` : ''})`);
    o.value = b.id;
    picker.append(o);
  }
  picker.value = bodyId;
  picker.onchange = () => {
    if (moved().length && !confirm('Moves on this body aren\'t saved. Switch anyway (they\'re kept until you leave the page)?')) { picker.value = bodyId; return; }
    bodyId = picker.value;
    host.pick(bodyId);
    world = bodyTerrain(bodyId, bodyOf()?.def);
    color = terrainColorFor(world);
    regs = all.filter((r) => r.body === bodyId);
    base = null;
    load();
    renderList();
  };
  const reset = h('button', '', 'Undo moves');
  const list = h('div', 'planet-list');
  let drag: { id: string; dx: number; dy: number } | null = null;
  let hover: string | null = null;

  const toPx = (lat: number, lon: number) => ({ x: ((lon + 180) / 360) * W, y: ((LAT - lat) / (LAT * 2)) * H });
  const fromPx = (x: number, y: number) => ({ lat: LAT - (y / H) * LAT * 2, lon: (x / W) * 360 - 180 });
  const moved = () => all.filter((r) => { const o = orig.get(r.id)!; return o.lat !== r.lat || o.lon !== r.lon; });

  /** Recolour the map with the dry-land lift round each region. */
  const paint = () => {
    if (!base) return;
    const data = ictx.createImageData(W, H), c = new THREE.Color();
    const dirs = regs.filter((r) => !r.keepSea).map((r) => siteDir(r.lat, r.lon));
    for (let i = 0; i < W * H; i++) {
      let lift = 0;
      for (const d of dirs) {
        const dot = base.dir[i * 3] * d.x + base.dir[i * 3 + 1] * d.y + base.dir[i * 3 + 2] * d.z;
        if (dot > 0.96) lift = Math.max(lift, siteLift(Math.acos(Math.min(1, dot)), world));
      }
      color(world.ocean ? base.h[i] + lift : Math.max(0.6, base.h[i]), base.f[i], c);
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
    const bad = new Set(overlaps(regs, world.radius).flat());
    for (const r of regs) {
      const p = toPx(r.lat, r.lon), hd = halfDeg(r.size, world.radius);
      const hw = (hd / Math.cos(THREE.MathUtils.degToRad(r.lat)) / 360) * W, hh = (hd / (LAT * 2)) * H;
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
    canvas.style.cursor = drag ? 'grabbing' : hover && !placing ? 'grab' : placing ? 'copy' : 'crosshair';
    const i = Math.floor(p.y) * W + Math.floor(p.x);
    const ht = base && i >= 0 && i < W * H ? base.h[i] : NaN;
    readout.textContent = `${placing ? 'Click to place the new region · ' : ''}${Math.abs(ll.lat).toFixed(0)}° ${ll.lat >= 0 ? 'N' : 'S'}  ${Math.abs(ll.lon).toFixed(0)}° ${ll.lon >= 0 ? 'E' : 'W'}${Number.isFinite(ht) ? `  ·  ${world.ocean && ht < 0 ? `sea, ${(-ht).toFixed(0)} u deep` : `ground ${Math.max(0, ht).toFixed(0)} u up`}${world.ocean ? ' (before the dry-land lift)' : ''}` : ''}${hover ? `  ·  ${regs.find((r) => r.id === hover)!.name}: drag to move, double-click to open` : ''}`;
    draw();
  };
  canvas.onpointerdown = (e) => {
    const p = at(e), id = hit(p.x, p.y);
    if (placing) {
      const ll = fromPx(p.x, p.y);
      placing = false;
      add.classList.remove('on');
      host.create({ body: bodyId, lat: Math.round(Math.max(-LAT, Math.min(LAT, ll.lat))), lon: Math.round(ll.lon) });
      return;
    }
    if (!id) return;
    const r = regs.find((x) => x.id === id)!, q = toPx(r.lat, r.lon);
    drag = { id, dx: p.x - q.x, dy: p.y - q.y };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointerup = () => { if (drag) { drag = null; paint(); draw(); renderList(); } };
  canvas.ondblclick = (e) => { const p = at(e), id = hit(p.x, p.y); if (id) host.open(id); };

  const renderList = () => {
    list.replaceChildren();
    const td = { lat: 0, lon: 0 };
    const bad = overlaps(regs, world.radius);
    if (!regs.length) list.append(h('div', 'help-block', `No regions on ${bodyOf()?.name ?? bodyId} yet. ＋ New region, then click the map.`));
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
        h('div', 'dim', `${r.size} u across · ${r.id === 'touchdown' ? 'the landing site' : `${Math.round(THREE.MathUtils.degToRad(dist) * world.radius).toLocaleString()} u from ${bodyId === 'home' ? 'Touchdown\'s spot' : '0, 0'} (${dist.toFixed(0)}°)`}`)));
    }
    for (const [a, b] of bad) list.append(h('div', 'issue', `${regs.find((r) => r.id === a)!.name} and ${regs.find((r) => r.id === b)!.name} overlap: the same ground would turn up in both.`));
    const m = moved();
    save.disabled = reset.disabled = !m.length;
    save.textContent = m.length ? `Save ${m.length} position${m.length > 1 ? 's' : ''}` : 'Save positions';
  };
  save.onclick = async () => { save.disabled = true; await host.save(moved()); for (const r of regs) orig.set(r.id, { lat: r.lat, lon: r.lon }); renderList(); };
  reset.onclick = () => { for (const r of all) Object.assign(r, orig.get(r.id)); paint(); draw(); renderList(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && placing) { placing = false; add.classList.remove('on'); readout.textContent = ''; } };
  addEventListener('keydown', onKey);

  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Planet map'), h('div', 'path', 'Every region on a body. Drag one to move it; double-click to open it.')), h('div', 'actions', picker, add, reset, save)),
    h('div', 'planet-wrap', canvas),
    readout,
  );
  aside.replaceChildren(
    h('div', 'group', 'Regions'), list,
    h('div', 'group', 'Reading the map'),
    h('div', 'help-block', `Degrees north and east of the body's 0, 0 (on Home, Touchdown's spot). Each box is a region at its own size (standard: ${DEFAULT_REGION_SIZE} u across). Moving a region changes the generated ground under its sculpting: open it afterwards to check its map. On a body with seas the game lifts the ground near the region being played onto dry land; the map shows that round every region. Red boxes overlap another region. The body's own look (radius, relief, colours) is set under Maps → Worlds.`),
  );
  renderList();
  const load = () => {
    const key = JSON.stringify(world);
    void (async () => {
      if (!bases.has(key)) {
        if (!bakings.has(key)) bakings.set(key, bake(world, key, (k) => { if (!disposed) readout.textContent = `Drawing ${world.name}… ${Math.round(k * 100)}%`; }));
        await bakings.get(key);
      }
      if (disposed || key !== JSON.stringify(world)) return;
      base = bases.get(key)!;
      paint();
      draw();
      readout.textContent = 'Hover for coordinates and height.';
    })();
  };
  load();
  return { dispose() { disposed = true; removeEventListener('keydown', onKey); } };
}
