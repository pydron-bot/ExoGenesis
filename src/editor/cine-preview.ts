/**
 * Cinematic preview (Cinematics → any): a small 3D view in the editor that
 * plays the draft at the timeline's playhead, without opening the game.
 *
 * It runs the game's own player (src/cinematic.ts) and camera (src/camera.ts)
 * over the region's real terrain (world/planet.ts), so framing matches the
 * game. What it leaves out: the colony (every building key looks at the
 * Command Core), flora, fog, lighting by time of day, and sound.
 *
 * Flying: drag orbits, the wheel changes the distance (Alt+wheel: the focus
 * height), Shift+drag or right-drag pans the focus over the ground. That is a
 * free view, held until "Back to the cinematic"; the timeline's "＋ Key from
 * view" turns it into a camera key. The inverse is exact: the camera follows
 * the focus point `regionToWorld(x, z, lift)` at `dist`, `pitch`, `yaw`
 * (ZoomCamera.update with the cinematic's override), which is just what a
 * `site` key with those numbers plays back.
 *
 * Beside it, a map of the region from above: the camera's path and its focus
 * points, each key (a numbered dot, click to select it), and where the camera
 * is and looks at the playhead.
 */
import * as THREE from 'three';
import { ZoomCamera } from '../camera';
import { Cinematic, type CineHooks, type SetPiece } from '../cinematic';
import type { CameraKeyDef, CharacterDef, CinematicDef, RegionDef } from '../content/defs';
import { REGION_HALF as HALF } from '../sim/types';
import { probePath } from '../world/probe-path';
import { R, U, regionColor, regionDir, regionHeight, regionTerrain, regionToWorld, setGroundPads, setRegionTerrain, terrainColor, worldToRegion } from '../world/planet';
import { buildCore, orient } from '../world/region';

const STEP = 2;
/** Terrain samples per side for the region's size (set per region). */
const gridN = () => Math.round((HALF * 2) / STEP) + 1;

let renderer: THREE.WebGLRenderer | null = null;

/** The camera's numbers: a focus point on the ground (region x, z, lift above it) and where the camera sits round it. */
export interface View { x: number; z: number; lift: number; dist: number; pitch: number; yaw: number }

/** Guides over the preview: none, rule of thirds, or title / action safe areas. */
export type Guides = 'off' | 'thirds' | 'safe';
const GUIDES_KEY = 'exo.editor.pvguides';

/** The free view outlives the preview (the form re-renders on every timeline edit), per cinematic. */
let free: View | null = null;
let freeFor = '';
let guides: Guides = 'off';
try { guides = (localStorage.getItem(GUIDES_KEY) as Guides) || 'off'; } catch { /* private mode */ }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Round to a step without float dust (0.1 → 12.3, not 12.299999). */
const rnd = (v: number, s: number) => Number((Math.round(v / s) * s).toFixed(Math.max(0, Math.ceil(-Math.log10(s)))));
/** The yaw (as the camera sees it, any turn) nearest the neighbouring keys', inside the schema's ±6.3, so the curve turns the short way. */
export function unwrapYaw(yaw: number, near: number[]): number {
  const T = Math.PI * 2;
  const m = near.length ? near.reduce((a, b) => a + b, 0) / near.length : 0;
  let y = yaw + T * Math.round((m - yaw) / T);
  while (y > 6.3) y -= T;
  while (y < -6.3) y += T;
  return y;
}

export interface PreviewSource {
  draft(): CinematicDef;
  id(): string;
  region(): RegionDef | undefined;
  character(id: string): CharacterDef | undefined;
  /** {first} in lines, as the editor shows it elsewhere. */
  sample(text: string): string;
  /** content.bodies: the region's body sets the ground (and the globe under it). */
  bodies?(): Record<string, unknown>;
}

const h = (cls: string, ...kids: Node[]) => { const e = document.createElement('div'); e.className = cls; e.append(...kids); return e; };
const NS = 'http://www.w3.org/2000/svg';

export class CinePreview {
  readonly el: HTMLElement;
  /** The free view started or moved (the timeline stops playing and refreshes its buttons). */
  onFly: (() => void) | null = null;
  /** A key's dot on the map was clicked. */
  onPick: ((i: number) => void) | null = null;
  /** The selected camera key (highlighted on the map). */
  selected: number | null = null;
  private scene = new THREE.Scene();
  private cam: ZoomCamera;
  private cine: Cinematic | null = null;
  private piece: SetPiece | null = null;
  private core: THREE.Group;
  private probe: THREE.Group;
  private terrain: THREE.Mesh | null = null;
  private markers = new THREE.Group();
  private regionKey = '';
  private globe: THREE.Mesh;
  private view3d: HTMLElement;
  private wrap: HTMLElement;
  private ui: { title: HTMLElement; sub: HTMLElement; who: HTMLElement; said: HTMLElement; line: HTMLElement; fade: HTMLElement; bars: HTMLElement; note: HTMLElement; hud: HTMLElement; nums: HTMLElement; guides: SVGSVGElement };
  private t = 0;
  private ro: ResizeObserver;
  private map = document.createElement('canvas');
  private mapBase = document.createElement('canvas');
  private path: { cam: { x: number; z: number }[]; foc: { x: number; z: number }[]; keys: { cam: { x: number; z: number }; foc: { x: number; z: number } }[] } | null = null;
  private dots: { x: number; y: number; i: number }[] = [];
  private fly: { x: number; y: number; pan: boolean } | null = null;

  constructor(private src: PreviewSource) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const ui = {
      title: h('pv-title'), sub: h('pv-sub'), who: h('pv-who'), said: h('pv-said'), line: h('pv-line'),
      fade: h('pv-fade'), bars: h('pv-bars', h('pv-bar'), h('pv-bar')), note: h('pv-note'), hud: h('pv-hud'), nums: h('pv-nums'),
      guides: document.createElementNS(NS, 'svg'),
    };
    ui.guides.setAttribute('class', 'pv-guides');
    ui.guides.setAttribute('viewBox', '0 0 100 100');
    ui.guides.setAttribute('preserveAspectRatio', 'none');
    ui.line.append(ui.who, ui.said);
    this.ui = ui;
    this.wrap = h('pv-view');
    this.view3d = h('cine-pv', this.wrap, ui.bars, ui.guides, ui.line, h('pv-cap', ui.title, ui.sub), ui.fade, ui.note, ui.hud, ui.nums);
    this.map.className = 'pv-map';
    this.map.title = 'The region from above: the camera\'s path (cyan), what it looks at (amber, dashed), each key (click one to select it) and the camera at the playhead (white).';
    this.el = h('cine-pv-row', this.view3d, this.map);

    this.cam = new ZoomCamera(new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 1.2e7));
    this.cam.freePitch = true;
    this.scene.background = new THREE.Color('#8fb0b6');
    this.scene.fog = new THREE.Fog('#8fb0b6', 600, 5000);
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#4a3428', 1.2));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.copy(U).multiplyScalar(R * 2).add(new THREE.Vector3(800, 600, -400));
    this.scene.add(sun);
    // the rest of the planet, for shots from high up (the landing starts at ~26 km)
    // a unit sphere, scaled to the body of the region shown (buildRegion)
    const globe = this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ color: '#7a5139', roughness: 1 }));
    globe.scale.setScalar(R - 1.5);
    this.scene.add(globe, this.markers);
    this.core = buildCore();
    this.scene.add(this.core);
    this.probe = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.ConeGeometry(10, 19, 6), new THREE.MeshStandardMaterial({ color: '#8d969e', flatShading: true }));
    shell.position.y = 9.5;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffb066' }));
    glow.position.y = -1;
    this.probe.add(shell, glow);
    this.scene.add(this.probe);

    this.flyControls();
    this.map.onpointerdown = (e) => {
      const r = this.map.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best: { i: number; d: number } | null = null;
      for (const p of this.dots) { const d = Math.hypot(p.x - x, p.y - y); if (d < 10 && (!best || d < best.d)) best = { i: p.i, d }; }
      if (best) this.onPick?.(best.i);
    };

    if (freeFor !== src.id()) free = null;
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.wrap);
    this.refresh();
  }

  /** The draft changed: rebuild the player (and the terrain if the region did). */
  refresh() {
    const d = this.src.draft(), reg = this.region();
    const key = `${reg.id}:${reg.def?.body ?? ''}:${reg.def?.size ?? 240}:${JSON.stringify(reg.def?.ground?.length ?? 0)}:${(reg.def?.height ?? []).length}:${reg.def?.siteLat ?? 0}:${reg.def?.siteLon ?? 0}:${reg.def?.keepSea ? 1 : 0}:${JSON.stringify(reg.def?.camps ?? [])}:${JSON.stringify(reg.def?.sites ?? [])}`;
    if (key !== this.regionKey) { this.regionKey = key; this.buildRegion(reg.def); }
    this.path = null;
    if (!d?.camera?.length || !(d.length > 0)) { this.cine = null; this.piece = null; this.ui.note.textContent = 'Add a camera key to preview (fly the view, then ＋ Key from view).'; this.render(); return; }
    this.ui.note.textContent = '';
    const landing = d.scene === 'landing';
    this.piece = landing ? this.probePiece(d, this.probe) : null;
    this.cine = new Cinematic(this.src.id(), d, this.cam, this.hooks(), this.piece);
    this.tracePath(d);
    this.show(this.t);
  }

  /** Show the moment `t` (s). */
  show(t: number) {
    this.t = t;
    if (this.cine) {
      this.cine.seek(Math.min(t, this.cine.length - 0.01));
      // the landing: the probe until its shell is reclaimed, the Core from touchdown
      const d = this.src.draft(), landing = d.scene === 'landing';
      this.core.visible = !landing || t >= (d.touchdown ?? 12);
      this.probe.visible = landing && t < (d.reclaimed ?? 21.4);
    }
    this.render();
  }

  /** Flying freely (not following the cinematic)? */
  get isFree() { return !!free; }

  /** Back to the cinematic's own camera. */
  dropFree() {
    free = null;
    this.show(this.t);
  }

  /** Overlay guides (remembered in this browser). */
  get guides() { return guides; }
  set guides(g: Guides) {
    guides = g;
    try { localStorage.setItem(GUIDES_KEY, g); } catch { /* private mode */ }
    this.render();
  }

  /** The camera's numbers as it is now (the free view, or the cinematic's camera at the playhead). */
  view(): View {
    if (free) return { ...free };
    const c = this.cam, f = c.focus, g = worldToRegion(f);
    return { x: g.x, z: g.z, lift: f.length() - R - regionHeight(g.x, g.z), dist: c.dist, pitch: c.pitch, yaw: c.yaw };
  }

  /** The camera's world position (tests: a captured key frames the same shot). */
  get position() { return this.cam.camera.position.clone(); }

  /**
   * A `site` key at `at` that frames the view, rounded (0.1 u, 0.001 rad), its yaw
   * unwrapped next to `near` (the neighbouring keys' yaws). The free view snaps to
   * the rounded numbers, so what you see is exactly what the key plays.
   */
  siteKey(at: number, near: number[]): CameraKeyDef {
    const v = this.view();
    const k: CameraKeyDef = {
      at, target: 'site',
      x: rnd(clamp(v.x, -HALF, HALF), 0.1), z: rnd(clamp(v.z, -HALF, HALF), 0.1),
      lift: rnd(clamp(v.lift, -20, 200), 0.1),
      dist: rnd(clamp(v.dist, 5, 3000), 0.1),
      pitch: rnd(clamp(v.pitch, -1.5, 1.5), 0.001),
      yaw: rnd(unwrapYaw(v.yaw, near), 0.001),
    };
    if (free) { free = { x: k.x!, z: k.z!, lift: k.lift, dist: k.dist, pitch: k.pitch, yaw: k.yaw }; this.render(); }
    return k;
  }

  /**
   * Point key `k` (in place) at the view. A `site` key takes all of it; a key that
   * looks at something (a building, story site, camp, the probe) keeps its target
   * and takes the distance, pitch, yaw and the focus height as lift.
   */
  applyView(k: CameraKeyDef, near: number[]) {
    const s = this.siteKey(k.at, near);
    if (k.target === 'site') { Object.assign(k, { x: s.x, z: s.z, lift: s.lift, dist: s.dist, pitch: s.pitch, yaw: s.yaw }); return; }
    const v = this.view();
    // the key's own focus now, and the view's: lift moves it to the same height
    let f: THREE.Vector3;
    if (k.target === 'probe') f = this.probe.position.clone().addScaledVector(regionDir(0, 0), k.lift);
    else { const p = this.hooks().target(k) ?? { x: k.x ?? 0, z: k.z ?? 0 }; f = regionToWorld(p.x, p.z, k.lift); }
    const viewR = R + regionHeight(v.x, v.z) + v.lift;
    k.lift = rnd(clamp(k.lift + viewR - f.length(), -20, 200), 0.1);
    const follow = k.target === 'probe' ? (k.follow ?? 0) * (this.piece?.alt ?? 0) : 0;
    k.dist = rnd(clamp(v.dist - follow, 5, 3000), 0.1);
    k.pitch = s.pitch;
    k.yaw = s.yaw;
  }

  dispose() { this.ro.disconnect(); this.el.remove(); }

  private region(): { id: string; def: RegionDef | undefined } {
    const d = this.src.draft();
    const def = this.src.region();
    return { id: d?.scene === 'landing' ? 'touchdown' : d?.region || 'touchdown', def };
  }

  /** Drag orbits, Shift / right drag pans, the wheel zooms (Alt: lift). */
  private flyControls() {
    const w = this.wrap;
    const start = () => {
      if (!free) { free = this.view(); freeFor = this.src.id(); }
    };
    w.addEventListener('contextmenu', (e) => e.preventDefault());
    w.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      w.setPointerCapture(e.pointerId);
      this.fly = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      start();
      this.onFly?.();
      this.render();
    });
    w.addEventListener('pointermove', (e) => {
      if (!this.fly || !free) return;
      const dx = e.clientX - this.fly.x, dy = e.clientY - this.fly.y;
      this.fly.x = e.clientX; this.fly.y = e.clientY;
      const v = free;
      if (this.fly.pan || e.shiftKey) {
        // as ZoomCamera.pan: the ground follows the pointer
        const k = (v.dist * 1.1) / Math.max(100, w.clientHeight), sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.max(0.4, Math.sin(v.pitch));
        v.x = clamp(v.x + (-dx * cy + (dy * sy) / sp) * k, -HALF, HALF);
        v.z = clamp(v.z + (dx * sy + (dy * cy) / sp) * k, -HALF, HALF);
      } else {
        v.yaw += dx * 0.008;
        v.pitch = clamp(v.pitch + dy * 0.006, -0.6, 1.5);
      }
      this.onFly?.();
      this.render();
    });
    const end = (e: PointerEvent) => { this.fly = null; if (w.hasPointerCapture(e.pointerId)) w.releasePointerCapture(e.pointerId); this.render(); };
    w.addEventListener('pointerup', end);
    w.addEventListener('pointercancel', end);
    w.addEventListener('wheel', (e) => {
      e.preventDefault();
      start();
      const v = free!;
      if (e.altKey) v.lift = clamp(v.lift - e.deltaY * 0.01 * Math.max(1, v.dist / 40), -20, 200);
      else v.dist = clamp(v.dist * Math.exp(e.deltaY * 0.0012), 5, Math.max(3000, v.dist));
      this.onFly?.();
      this.render();
    }, { passive: false });
  }

  /** The region's ground as the game shapes it, in world space, plus markers for camps and story sites. */
  private buildRegion(def: RegionDef | undefined) {
    if (def) setRegionTerrain(regionTerrain(def, this.src.bodies?.()));
    const N = gridN();
    this.globe.scale.setScalar(R - 1.5);
    terrainColor(R * 0.01, -1, (this.globe.material as THREE.MeshStandardMaterial).color);
    setGroundPads([]);
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), c = new THREE.Color(), v = new THREE.Vector3();
    // the same colours, from above, for the map (row 0 = north)
    this.mapBase.width = this.mapBase.height = N;
    const mctx = this.mapBase.getContext('2d');
    const img = mctx?.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP, k = (j * N + i) * 3;
      regionToWorld(x, z, 0, v);
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      regionColor(x, z, c);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      if (img) {
        const p = ((N - 1 - j) * N + i) * 4;
        img.data[p] = c.r * 255; img.data[p + 1] = c.g * 255; img.data[p + 2] = c.b * 255; img.data[p + 3] = 255;
      }
    }
    if (img) mctx!.putImageData(img, 0, 0);
    const idx: number[] = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, cc = a + N, e = cc + 1;
      idx.push(a, cc, b, b, cc, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    if (this.terrain) { this.scene.remove(this.terrain); this.terrain.geometry.dispose(); }
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }));
    this.scene.add(this.terrain);
    orient(this.core, 0, 0, 0, 0);
    // camps (amber spires) and story sites (cyan rings)
    this.markers.clear();
    for (const cp of def?.camps ?? []) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(2.5, 9, 6), new THREE.MeshStandardMaterial({ color: '#ffb547', emissive: '#5a3a00', flatShading: true }));
      m.geometry.translate(0, 4.5, 0);
      orient(m, cp.x, cp.z, 0, 0);
      this.markers.add(m);
    }
    for (const s of def?.sites ?? []) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(2, s.r), 0.35, 6, 40), new THREE.MeshBasicMaterial({ color: '#3fd6ff' }));
      ring.geometry.rotateX(Math.PI / 2);
      orient(ring, s.x, s.z, 0, 0.6);
      this.markers.add(ring);
    }
  }

  /** The landing's probe (`node`), following the same path as in the game. */
  private probePiece(d: CinematicDef, node: THREE.Object3D): SetPiece {
    const pad = regionHeight(0, 0), td = d.touchdown ?? 12;
    let alt = 0, speed = 0;
    const at = (t: number, out: THREE.Vector3) => { const p = probePath(td, t); return regionDir(p.x, p.z, out).multiplyScalar(R + pad + p.alt); };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    return {
      frame(t) {
        at(t, node.position);
        node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), regionDir(0, 0));
        alt = probePath(td, t).alt;
        speed = at(t + 0.05, b).distanceTo(at(t, a)) / 0.05;
      },
      get probe() { return node.position; },
      get alt() { return alt; },
      fill: (x) => x.replace(/\{alt\}/g, (alt * 0.01).toFixed(alt < 100 ? 2 : 1)).replace(/\{speed\}/g, String(Math.round(speed * 10))).replace(/\{shield\}/g, '—'),
      finish() {},
    };
  }

  private hooks(): CineHooks {
    const ui = this.ui, reg = () => this.src.region();
    return {
      caption: (title, sub) => { ui.title.textContent = title; ui.sub.textContent = sub; },
      line: (l) => {
        ui.line.classList.toggle('on', !!l);
        if (!l) return;
        ui.who.textContent = l.name;
        ui.who.style.color = l.color ?? '';
        ui.said.textContent = l.text;
      },
      fade: (a) => { ui.fade.style.opacity = a.toFixed(3); },
      sound: () => null,
      target: (k: CameraKeyDef) => {
        if (k.target === 'building') return { x: 0, z: 0 };
        if (k.target === 'storysite') return reg()?.sites?.find((x) => x.id === k.site) ?? null;
        if (k.target === 'camp') return reg()?.camps?.find((x) => x.group === k.group) ?? null;
        return null;
      },
      speaker: (character, speaker) => {
        const ch = character ? this.src.character(character) : undefined;
        return { name: this.src.sample(ch?.name ?? speaker ?? ''), role: ch?.role, color: ch?.color };
      },
      fillText: (t) => this.src.sample(t),
      done: () => {},
    };
  }

  /** The camera's path for the map: a second, silent player on its own camera. */
  private tracePath(d: CinematicDef) {
    const cam = new ZoomCamera(new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 1.2e7));
    const quiet: CineHooks = { ...this.hooks(), caption: () => {}, line: () => {}, fade: () => {}, sound: () => null };
    const cin = new Cinematic(this.src.id(), d, cam, quiet, d.scene === 'landing' ? this.probePiece(d, new THREE.Object3D()) : null);
    const star = new THREE.Vector3().copy(U).multiplyScalar(1e7);
    const at = (t: number) => { cin.seek(t); cam.update(1, star); return { cam: worldToRegion(cam.camera.position), foc: worldToRegion(cam.focus) }; };
    const n = 160, out: NonNullable<CinePreview['path']> = { cam: [], foc: [], keys: [] };
    for (let i = 0; i <= n; i++) { const s = at((i / n) * d.length); out.cam.push(s.cam); out.foc.push(s.foc); }
    for (const k of d.camera ?? []) out.keys.push(at(k.at));
    this.path = out;
  }

  /** The map: region from above, the path, the keys, and the camera now. */
  private drawMap() {
    const S = Math.max(80, this.map.clientWidth || 240), dpr = Math.min(devicePixelRatio, 2);
    if (this.map.width !== Math.round(S * dpr)) { this.map.width = this.map.height = Math.round(S * dpr); }
    const g = this.map.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#05080d';
    g.fillRect(0, 0, S, S);
    // the view: the region, grown to take in the camera's path (within reason)
    const far = HALF * 2, ok = (p: { x: number; z: number }) => Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < far && Math.abs(p.z) < far;
    let x0 = -HALF, x1 = HALF, z0 = -HALF, z1 = HALF;
    for (const p of [...(this.path?.cam ?? []), ...(this.path?.foc ?? [])]) if (ok(p)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const span = Math.max(x1 - x0, z1 - z0) * 1.08, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const P = (p: { x: number; z: number }) => ({ x: ((p.x - cx) / span) * S + S / 2, y: S / 2 - ((p.z - cz) / span) * S });
    const a = P({ x: -HALF, z: HALF }), b = P({ x: HALF, z: -HALF });
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapBase, a.x, a.y, b.x - a.x, b.y - a.y);
    g.strokeStyle = 'rgba(255,255,255,.25)';
    g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    // the Core, camps, story sites
    const reg = this.src.region();
    const dot = (p: { x: number; y: number }, r: number, fill: string) => { g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    const c0 = P({ x: 0, z: 0 });
    g.fillStyle = '#e8f4ff'; g.fillRect(c0.x - 3, c0.y - 3, 6, 6);
    for (const cp of reg?.camps ?? []) dot(P(cp), 3, '#ffb547');
    for (const s of reg?.sites ?? []) { const p = P(s); g.beginPath(); g.arc(p.x, p.y, Math.max(3, (s.r / span) * S), 0, Math.PI * 2); g.strokeStyle = '#3fd6ff'; g.stroke(); }
    const line = (pts: { x: number; z: number }[], style: string, dash: number[] = [], w = 1.5) => {
      g.beginPath();
      let pen = false;
      for (const p of pts) { if (!ok(p)) { pen = false; continue; } const q = P(p); if (pen) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); pen = true; }
      g.setLineDash(dash); g.strokeStyle = style; g.lineWidth = w; g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    };
    this.dots = [];
    if (this.path) {
      line(this.path.foc, 'rgba(255,181,71,.85)', [3, 3]);
      line(this.path.cam, '#3fd6ff', [], 2);
      this.path.keys.forEach((k, i) => {
        if (!ok(k.cam)) return;
        const p = P(k.cam), f = ok(k.foc) ? P(k.foc) : null;
        if (f) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(f.x, f.y); g.strokeStyle = 'rgba(63,214,255,.35)'; g.stroke(); dot(f, 2, '#ffb547'); }
        const sel = this.selected === i;
        dot(p, 7.5, sel ? '#ffffff' : '#0f3a4a');
        g.beginPath(); g.arc(p.x, p.y, 7.5, 0, Math.PI * 2); g.strokeStyle = sel ? '#ffb547' : '#3fd6ff'; g.lineWidth = sel ? 2 : 1; g.stroke(); g.lineWidth = 1;
        g.fillStyle = sel ? '#000' : '#fff'; g.font = '9px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), p.x, p.y + 0.5);
        this.dots.push({ x: p.x, y: p.y, i });
      });
    }
    // the camera now: where it is, what it looks at, and its field of view
    const cp = worldToRegion(this.cam.camera.position), fp = worldToRegion(this.cam.focus);
    if (ok(cp) && ok(fp)) {
      const p = P(cp), f = P(fp), ang = Math.atan2(f.y - p.y, f.x - p.x);
      const cam = this.cam.camera, hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect), L = 26;
      g.beginPath(); g.moveTo(p.x, p.y);
      g.lineTo(p.x + Math.cos(ang - hf) * L, p.y + Math.sin(ang - hf) * L);
      g.lineTo(p.x + Math.cos(ang + hf) * L, p.y + Math.sin(ang + hf) * L);
      g.closePath(); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill();
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(f.x, f.y); g.strokeStyle = '#fff'; g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]);
      dot(p, 4, free ? '#ffb547' : '#ffffff');
      g.beginPath(); g.moveTo(f.x - 4, f.y - 4); g.lineTo(f.x + 4, f.y + 4); g.moveTo(f.x + 4, f.y - 4); g.lineTo(f.x - 4, f.y + 4); g.strokeStyle = '#fff'; g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '10px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('N ↑', 6, 5);
  }

  /** Thirds or safe-area guides, inside the letterbox when it shows. */
  private drawGuides(bars: boolean) {
    const s = this.ui.guides;
    s.replaceChildren();
    s.style.display = guides === 'off' ? 'none' : '';
    if (guides === 'off') return;
    const top = bars ? 11 : 0, bot = bars ? 89 : 100;
    const ln = (x1: number, y1: number, x2: number, y2: number) => { const l = document.createElementNS(NS, 'line'); for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, String(v)); s.append(l); };
    const rect = (f: number, cls: string) => {
      const r = document.createElementNS(NS, 'rect'), hh = bot - top;
      for (const [k, v] of Object.entries({ x: (100 * (1 - f)) / 2, y: top + (hh * (1 - f)) / 2, width: 100 * f, height: hh * f })) r.setAttribute(k, String(v));
      r.setAttribute('class', cls);
      s.append(r);
    };
    if (guides === 'thirds') {
      for (const f of [1 / 3, 2 / 3]) { ln(100 * f, top, 100 * f, bot); ln(0, top + (bot - top) * f, 100, top + (bot - top) * f); }
    } else { rect(0.9, 'action'); rect(0.8, 'title'); ln(48, 50, 52, 50); ln(50, (top + bot) / 2 - 2, 50, (top + bot) / 2 + 2); }
  }

  /** The key at (or before) the playhead, in the corner. */
  private hud() {
    const keys = this.src.draft()?.camera ?? [], t = this.t;
    let n = -1;
    keys.forEach((k, i) => { if (k.at <= t + 1e-6) n = i; });
    const on = n >= 0 && Math.abs(keys[n].at - t) < 0.005;
    const key = !keys.length ? 'no keys' : n < 0 ? '→ key 1' : on ? `key ${n + 1}` : n === keys.length - 1 ? `after key ${n + 1}` : `key ${n + 1} → ${n + 2}`;
    this.ui.hud.textContent = `${free ? 'free view · ' : ''}${key} · ${t.toFixed(2)} s`;
    const v = free;
    this.ui.nums.style.display = v ? '' : 'none';
    if (v) this.ui.nums.textContent = `x ${v.x.toFixed(1)}  z ${v.z.toFixed(1)}  lift ${v.lift.toFixed(1)}  ·  dist ${v.dist.toFixed(1)}  pitch ${v.pitch.toFixed(3)}  yaw ${v.yaw.toFixed(3)}`;
  }

  private render() {
    if (!renderer) return;
    const w = Math.max(200, this.wrap.clientWidth), hgt = Math.round(w * 9 / 16);
    this.wrap.style.height = `${hgt}px`;
    if (renderer.domElement.parentElement !== this.wrap) this.wrap.append(renderer.domElement);
    renderer.setSize(w, hgt);
    this.cam.camera.aspect = w / hgt;
    const d = this.src.draft();
    const bars = d?.scene === 'landing' ? !!d?.letterbox : d?.letterbox !== false;
    this.ui.bars.style.display = bars ? '' : 'none';
    if (free) {
      // the free view: exactly what a `site` key with these numbers plays (Cinematic.direct)
      const c = this.cam;
      regionToWorld(free.x, free.z, free.lift, c.focusOverride);
      c.overrideW = 1;
      c.freePitch = true;
      c.dist = c.targetDist = free.dist;
      c.pitch = c.targetPitch = free.pitch;
      c.yaw = free.yaw;
    }
    this.view3d.classList.toggle('free', !!free);
    this.cam.update(1, new THREE.Vector3().copy(U).multiplyScalar(1e7));
    renderer.render(this.scene, this.cam.camera);
    this.drawGuides(bars);
    this.hud();
    this.drawMap();
  }
}
