/**
 * Region map editor: sculpt terrain, paint flora, place grazer herds, alloy
 * deposits and predator spawn points.
 *
 * Heights use the same functions as the game (world/planet.ts), so the view
 * matches what loads in game, minus the planet's curvature (~2 u drop at the
 * region edge). Region x → three x, region z → three −z, so the map isn't
 * mirrored relative to the game.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEIGHT_SCALE, PREVIEW_KEY, REGION_CELLS as NC, REGION_STEP, campShape, depositShape, siteShape, herdShape, regionShape, spawnShape, ventShape } from '../content/defs';
import { decodeGrid, encodeGrid, isEmptyGrid } from '../content/grid';
import type { Field, Shape } from '../content/schema';
import { REGION_HALF as HALF } from '../sim/types';
import {
  FLORA_PAINT_SHIFT, PAD_OUTER, SCULPT_FADE, floraAt, padBlend, padHeight, regionDir, regionProcBase, sculptFade, setRegionSite, terrainColor,
} from '../world/planet';

export interface MapHost {
  /** Region id (the file name). */
  id: string;
  draft: Record<string, unknown>;
  /** The draft changed (dirty state, title, buttons). */
  changed(): void;
  control(d: Record<string, unknown>, key: string, f: Field, onChange: () => void): HTMLElement;
  /** Inhabitant groups (for a camp's land ring). */
  inhabitants?: Record<string, { land?: number }>;
  /** Numbers the overlays draw from (content: the Core's range, the colony's build radius, a predator's speed). */
  rules?: { coreRange: number; buildRadius: number; packSpeed: number };
}

/** What Copy keeps: grid cells relative to the selection's corner, markers relative to its centre. */
interface Clip { w: number; h: number; off: number[]; shape: number[]; paint: number[]; markers: Partial<Record<MKind, Marker[]>> }
const CLIP_KEY = 'exo.map.clip';
/** Ground packs can't cross (the sim's `blocked`), and ground too low or steep to build on (sim/rules.ts placeProblem). */
const WATER_PATH = 0.3, WATER_BUILD = 0.6, PLACE_EDGE = HALF - 10, PACK_LIMIT = HALF - 6;

type Tool = 'select' | 'area' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'flora+' | 'flora-' | 'herd' | 'deposit' | 'spawn' | 'vent' | 'camp' | 'site';
const TOOLS: { id: Tool; label: string; key: string; tip: string }[] = [
  { id: 'select', label: 'Select', key: 'Q', tip: 'Click a herd, deposit, spawn, vent, camp or story site to select it; drag to move it' },
  { id: 'area', label: 'Select area', key: 'A', tip: 'Drag a rectangle to copy (Ctrl+C), then paste it anywhere, in this region or another (Ctrl+V at the cursor)' },
  { id: 'raise', label: 'Raise', key: '1', tip: 'Raise ground (Shift: lower)' },
  { id: 'lower', label: 'Lower', key: '2', tip: 'Lower ground (Shift: raise)' },
  { id: 'smooth', label: 'Smooth', key: '3', tip: 'Even out bumps' },
  { id: 'flatten', label: 'Flatten', key: '4', tip: 'Level to the height where the stroke started' },
  { id: 'flora+', label: 'Flora +', key: '5', tip: 'More plants, lusher ground (Shift: clear)' },
  { id: 'flora-', label: 'Flora −', key: '6', tip: 'Fewer plants, barer ground (Shift: add)' },
  { id: 'herd', label: 'Add herd', key: 'H', tip: 'Click the ground to place a grazer herd' },
  { id: 'deposit', label: 'Add deposit', key: 'D', tip: 'Click the ground to place an alloy deposit (mined by depots)' },
  { id: 'spawn', label: 'Add spawn', key: 'P', tip: 'Click the ground to place a predator spawn point (packs enter here)' },
  { id: 'vent', label: 'Add vent', key: 'V', tip: 'Click the ground to place a geothermal vent (a Geothermal Tap can be built on it)' },
  { id: 'camp', label: 'Add camp', key: 'C', tip: 'Click the ground to place an inhabitant camp (who lives there: Story → Inhabitants)' },
  { id: 'site', label: 'Add site', key: 'S', tip: 'Click the ground to place a story site: a story event can fire when a drone or unit reaches it (a ruin, a crash site…)' },
];

type MKind = 'herds' | 'deposits' | 'spawns' | 'vents' | 'camps' | 'sites';
type Marker = Record<string, number>;
const MARKERS: Record<MKind, { label: string; one: string; shape: Shape; tool: Tool; make(x: number, z: number): Marker; summary(m: Marker): string; color: string; sel: string }> = {
  herds: { label: 'Grazer herds', one: 'Herd', shape: herdShape, tool: 'herd', make: (x, z) => ({ x, z, grazers: 20, roam: 40 }), summary: (m) => `${m.grazers} grazers`, color: '#c99a4a', sel: '#ffe08a' },
  deposits: { label: 'Alloy deposits', one: 'Deposit', shape: depositShape, tool: 'deposit', make: (x, z) => ({ x, z, alloys: 1000 }), summary: (m) => `${m.alloys} alloys`, color: '#e08a2c', sel: '#ffd08a' },
  spawns: { label: 'Predator spawns', one: 'Spawn', shape: spawnShape, tool: 'spawn', make: (x, z) => ({ x, z }), summary: () => 'packs enter here', color: '#d8414e', sel: '#ff9aa3' },
  vents: { label: 'Geothermal vents', one: 'Vent', shape: ventShape, tool: 'vent', make: (x, z) => ({ x, z }), summary: () => 'a Geothermal Tap fits here', color: '#ff7a2a', sel: '#ffc08a' },
  // a camp's `group` is an id (text); markers are otherwise all numbers
  sites: { label: 'Story sites', one: 'Site', shape: siteShape, tool: 'site', make: (x, z) => ({ id: `site${Math.round(Math.abs(x) + Math.abs(z))}`, x, z, r: 10 }) as unknown as Marker, summary: (m) => `${m.id}${m.label ? ` · ${m.label}` : ''}`, color: '#3fd6ff', sel: '#b8f1ff' },
  camps: { label: 'Inhabitant camps', one: 'Camp', shape: campShape, tool: 'camp', make: (x, z) => ({ x, z, group: 'vell' }) as unknown as Marker, summary: (m) => String(m.group), color: '#b98cff', sel: '#e2ccff' },
};
const MKINDS = Object.keys(MARKERS) as MKind[];

const MAX_OFF = 60; // units, matches the schema's ±600 tenths
const N2 = NC * NC;
const CENTER = ((NC - 1) / 2) * NC + (NC - 1) / 2;
const nodeX = (i: number) => -HALF + (i % NC) * REGION_STEP;
const nodeZ = (i: number) => -HALF + Math.floor(i / NC) * REGION_STEP;

// one renderer for the editor's lifetime (WebGL contexts are scarce); camera survives reopening
let renderer: THREE.WebGLRenderer | null = null;
const camState = { pos: new THREE.Vector3(0, 190, -170), target: new THREE.Vector3(0, 0, 0) };
const prefs = {
  tool: 'raise' as Tool, radius: 12, strength: 0.5, showPaint: true,
  /** Overlays: where you can build at the start, distance rings from the Core, the way packs walk in. */
  build: false, rings: false, paths: false,
  /** Paste the copied sculpt as it was (relative) or the copied ground's shape (absolute heights, feathered edges). */
  pasteShape: false, pasteMarkers: true,
};
try { Object.assign(prefs, JSON.parse(localStorage.getItem('exo.map.prefs') ?? '{}')); } catch { /* private mode */ }
const savePrefs = () => { try { localStorage.setItem('exo.map.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } };

// the generated terrain depends only on the region's site; recomputed when that moves
let proc: Float32Array | null = null, fade: Float32Array, pad: Float32Array, floraBase: Float32Array;
let procSite = '';
function precompute(lat = 0, lon = 0) {
  if (proc && procSite === `${lat},${lon}`) return;
  procSite = `${lat},${lon}`;
  setRegionSite(lat, lon);
  proc = new Float32Array(N2); fade = new Float32Array(N2); pad = new Float32Array(N2); floraBase = new Float32Array(N2);
  for (let i = 0; i < N2; i++) {
    const x = nodeX(i), z = nodeZ(i);
    proc[i] = regionProcBase(x, z);
    fade[i] = sculptFade(x, z);
    pad[i] = padBlend(x, z);
    floraBase[i] = floraAt(regionDir(x, z));
  }
}

interface Snap { off: Float32Array; paint: Float32Array; markers: string }

export class MapEditor {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private canvasWrap: HTMLElement;
  private readout: HTMLElement;
  private terrain: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private hgt = new Float32Array(N2); // displayed (final) height per node
  private raw = new Float32Array(N2); // the same before sea level (the sim's regionHeightRaw)
  private overlays = new THREE.Group();
  private area: { x0: number; z0: number; x1: number; z1: number } | null = null;
  private areaDrag: { x: number; z: number } | null = null;
  private areaLine: THREE.LineLoop | null = null;
  private off: Float32Array;
  private paint: Float32Array;
  private lists = {} as Record<MKind, Marker[]>;
  private markerGroup = new THREE.Group();
  private cursor: THREE.LineLoop;
  private selected: { k: MKind; i: number } | null = null;
  private undo: Snap[] = [];
  private redo: Snap[] = [];
  private raf = 0;
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hover: { x: number; z: number } | null = null;
  private stroke: { tool: Tool; target: number; last: number } | null = null;
  private dragging: { k: MKind; i: number } | null = null;
  private shift = false;
  private disposed = false;
  private asideEls: { tools: HTMLElement; lists: Record<MKind, HTMLElement>; form: Record<MKind, HTMLElement> } = null!;

  constructor(main: HTMLElement, private aside: HTMLElement, private host: MapHost) {
    const d = host.draft;
    precompute(d.siteLat as number | undefined, d.siteLon as number | undefined);
    this.off = Float32Array.from(decodeGrid(d.height as string[] | undefined, NC, NC), (v) => v * HEIGHT_SCALE);
    this.paint = Float32Array.from(decodeGrid(d.flora as string[] | undefined, NC, NC), (v) => v / 100);
    for (const k of MKINDS) this.lists[k] = Array.isArray(d[k]) ? (d[k] as Marker[]) : ((d[k] = []) as Marker[]);

    renderer ??= new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'map-wrap';
    this.canvasWrap.append(renderer.domElement);
    this.readout = document.createElement('div');
    this.readout.className = 'map-readout';
    this.canvasWrap.append(this.readout);
    main.append(this.canvasWrap);

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
    this.camera.position.copy(camState.pos);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.copy(camState.target);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 900;
    this.controls.update();

    this.scene.background = new THREE.Color('#0a1018');
    this.scene.add(new THREE.HemisphereLight('#cfe6ff', '#3a2a20', 1.1));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-120, 200, 80);
    this.scene.add(sun);

    // terrain: one vertex per grid node, flat shaded like the game's flat look
    const pos = new Float32Array(N2 * 3), col = new Float32Array(N2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let j = 0; j < NC - 1; j++) for (let i = 0; i < NC - 1; i++) {
      const a = j * NC + i, b = a + 1, c = a + NC, e = c + 1;
      idx.push(a, b, c, b, e, c); // counter-clockwise from above (x right, region z → −three z)
    }
    this.geo.setIndex(idx);
    this.terrain = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    this.scene.add(this.terrain);
    this.rebuild(0, N2);

    // sea level
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ color: '#2a7a9a', transparent: true, opacity: 0.18, depthWrite: false }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.05;
    this.scene.add(sea);

    // fixed references: landing pad, sculpt fade border, region edge
    this.scene.add(this.flatRing(PAD_OUTER, '#ffb547', 0.9), this.squareLine(HALF - SCULPT_FADE, '#5d7a96', true), this.squareLine(HALF, '#3fd6ff', false));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 6, 6), new THREE.MeshStandardMaterial({ color: '#c9d6e2', emissive: '#1d6a80', flatShading: true }));
    core.position.y = this.hgt[CENTER] + 3;
    core.name = 'core';
    this.scene.add(core);

    this.cursor = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3)), new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }));
    this.cursor.renderOrder = 10;
    this.cursor.frustumCulled = false;
    this.scene.add(this.cursor, this.markerGroup, this.overlays);
    this.drawMarkers();
    this.drawOverlays();

    this.buildAside();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvasWrap);
    this.resize();
    const loop = () => { if (this.disposed) return; this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    camState.pos.copy(this.camera.position);
    camState.target.copy(this.controls.target);
    this.controls.dispose();
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    renderer?.domElement.remove();
  }

  // ---------- terrain ----------
  private coreH() {
    return padHeight(proc![CENTER] + this.off[CENTER] * fade[CENTER]);
  }

  /** Recompute heights and colours for nodes [from, to). */
  private rebuild(from: number, to: number, nodes?: Iterable<number>) {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const ch = this.coreH();
    const c = new THREE.Color(), tint = new THREE.Color();
    const one = (i: number) => {
      const base = proc![i] + this.off[i] * fade[i];
      const raw = ch + (base - ch) * pad[i];
      this.raw[i] = raw;
      this.hgt[i] = Math.max(0, raw);
      pos.setXYZ(i, nodeX(i), this.hgt[i], -nodeZ(i));
      const p = this.paint[i];
      terrainColor(raw, floraBase[i] + p * FLORA_PAINT_SHIFT, c);
      if (prefs.showPaint && p !== 0) c.lerp(tint.set(p > 0 ? '#3cff9a' : '#ff4fa3'), Math.min(0.6, Math.abs(p) * 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    };
    // the unbuildable tint depends on the slope round a node: redo the neighbours of what changed too
    const list = nodes && prefs.build ? [...new Set([...nodes].flatMap((i) => this.nodesNear(nodeX(i), nodeZ(i), 6)))] : nodes ? [...nodes] : null;
    if (list) for (const i of list) one(i);
    else for (let i = from; i < to; i++) one(i);
    if (prefs.build) this.tintUnbuildable(list, from, to);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /**
   * Overlay: red where nothing can be built: water, ground too steep for a
   * mid-sized building (clearance 8), or too near the region edge. Same tests
   * as the game's placement check.
   */
  private tintUnbuildable(nodes: number[] | null, from: number, to: number) {
    const col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const red = new THREE.Color('#ff3040'), c = new THREE.Color();
    const r = 4, offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]];
    const one = (i: number) => {
      const x = nodeX(i), z = nodeZ(i);
      let lo = Infinity, hi = -Infinity;
      for (const [dx, dz] of offs) { const h = this.rawAt(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      if (!(lo < WATER_BUILD || hi - lo > Math.max(4, r * 1.1) || Math.abs(x) > PLACE_EDGE || Math.abs(z) > PLACE_EDGE)) return;
      c.fromBufferAttribute(col, i).lerp(red, lo < WATER_BUILD ? 0.25 : 0.55);
      col.setXYZ(i, c.r, c.g, c.b);
    };
    if (nodes) nodes.forEach(one); else for (let i = from; i < to; i++) one(i);
    col.needsUpdate = true;
  }

  /** Height of the displayed terrain at region coords (bilinear over nodes). */
  private heightAt(x: number, z: number) { return this.sample(this.hgt, x, z); }
  /** Height before sea level, as the sim sees it (water is below 0.3). */
  private rawAt(x: number, z: number) { return this.sample(this.raw, x, z); }
  private sample(g: Float32Array, x: number, z: number) {
    const fx = Math.min(NC - 1.0001, Math.max(0, (x + HALF) / REGION_STEP));
    const fz = Math.min(NC - 1.0001, Math.max(0, (z + HALF) / REGION_STEP));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = g[j * NC + i], b = g[j * NC + i + 1], c = g[(j + 1) * NC + i], d = g[(j + 1) * NC + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  private nodesNear(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const i0 = Math.max(0, Math.floor((x - r + HALF) / REGION_STEP)), i1 = Math.min(NC - 1, Math.ceil((x + r + HALF) / REGION_STEP));
    const j0 = Math.max(0, Math.floor((z - r + HALF) / REGION_STEP)), j1 = Math.min(NC - 1, Math.ceil((z + r + HALF) / REGION_STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(j * NC + i);
    return out;
  }

  private applyBrush(dt: number) {
    const s = this.stroke, h = this.hover;
    if (!s || !h) return;
    const r = prefs.radius, k = prefs.strength;
    const nodes = this.nodesNear(h.x, h.z, r);
    let tool = s.tool;
    if (this.shift) tool = ({ raise: 'lower', lower: 'raise', 'flora+': 'flora-', 'flora-': 'flora+' } as Partial<Record<Tool, Tool>>)[tool] ?? tool;
    const touched: number[] = [];
    const ch0 = this.coreH();
    for (const i of nodes) {
      const d = Math.hypot(nodeX(i) - h.x, nodeZ(i) - h.z);
      if (d > r) continue;
      const w = 1 - smooth01(d / r);
      const pre = proc![i] + this.off[i] * fade[i]; // pre-pad height
      switch (tool) {
        case 'raise': this.off[i] += 10 * k * w * dt; break;
        case 'lower': this.off[i] -= 10 * k * w * dt; break;
        case 'flatten': this.off[i] += (s.target - pre) * Math.min(1, 6 * k * w * dt); break;
        case 'smooth': {
          let sum = 0, n = 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = (i % NC) + di, jj = Math.floor(i / NC) + dj;
            if (ii < 0 || jj < 0 || ii >= NC || jj >= NC) continue;
            const q = jj * NC + ii;
            sum += proc![q] + this.off[q] * fade[q];
            n++;
          }
          this.off[i] += (sum / n - pre) * Math.min(1, 8 * k * w * dt);
          break;
        }
        case 'flora+': this.paint[i] = Math.min(1, this.paint[i] + 1.5 * k * w * dt); break;
        case 'flora-': this.paint[i] = Math.max(-1, this.paint[i] - 1.5 * k * w * dt); break;
      }
      this.off[i] = Math.max(-MAX_OFF, Math.min(MAX_OFF, this.off[i]));
      touched.push(i);
    }
    // a change at the core moves the whole landing pad
    if (this.coreH() !== ch0) this.rebuild(0, 0, this.nodesNear(0, 0, PAD_OUTER + 2));
    this.rebuild(0, 0, touched);
  }

  /** The site moved: regenerate the ground under the sculpting. */
  private resite() {
    const d = this.host.draft;
    precompute(d.siteLat as number | undefined, d.siteLon as number | undefined);
    this.rebuild(0, N2);
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
    this.updateCore();
    this.drawMarkers();
  }

  /** Hand the draft to the game (localStorage) and open it there. */
  private playTest() {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify({ id: this.host.id, def: this.host.draft }));
    } catch (e) {
      alert(`Couldn't hand the map to the game: ${(e as Error).message}`);
      return;
    }
    window.open(`${import.meta.env.BASE_URL}?preview=1&intro=0`, 'exo-playtest');
  }

  private commitLayers() {
    const d = this.host.draft;
    const hRows = encodeGrid(this.off.map((v) => v / HEIGHT_SCALE), NC, NC);
    const fRows = encodeGrid(this.paint.map((v) => v * 100), NC, NC);
    if (isEmptyGrid(this.off.map((v) => v / HEIGHT_SCALE))) delete d.height; else d.height = hRows;
    if (isEmptyGrid(this.paint.map((v) => v * 100))) delete d.flora; else d.flora = fRows;
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
    this.updateCore();
    this.drawMarkers();
    this.drawOverlays();
    this.renderPaths();
    this.host.changed();
  }

  private updateCore() {
    const core = this.scene.getObjectByName('core');
    if (core) core.position.y = this.hgt[CENTER] + 3;
  }

  // ---------- undo ----------
  private snap(): Snap {
    return { off: this.off.slice(), paint: this.paint.slice(), markers: JSON.stringify(this.lists) };
  }
  private pushUndo() {
    this.undo.push(this.snap());
    if (this.undo.length > 60) this.undo.shift();
    this.redo.length = 0;
  }
  private restore(s: Snap) {
    this.off.set(s.off);
    this.paint.set(s.paint);
    const m = JSON.parse(s.markers) as Record<MKind, Marker[]>;
    for (const k of MKINDS) this.lists[k].splice(0, this.lists[k].length, ...(m[k] ?? []));
    if (this.selected && this.selected.i >= this.lists[this.selected.k].length) this.selected = null;
    this.rebuild(0, N2);
    this.commitLayers();
    this.renderLists();
  }
  undoStep() { const s = this.undo.pop(); if (s) { this.redo.push(this.snap()); this.restore(s); } }
  redoStep() { const s = this.redo.pop(); if (s) { this.undo.push(this.snap()); this.restore(s); } }

  // ---------- markers: herds, deposits, spawns ----------
  private drawMarkers() {
    for (const o of [...this.markerGroup.children]) {
      this.markerGroup.remove(o);
      o.traverse((m) => { (m as THREE.Mesh).geometry?.dispose(); ((m as THREE.Mesh).material as THREE.Material | undefined)?.dispose(); });
    }
    for (const k of MKINDS) {
      const spec = MARKERS[k];
      this.lists[k].forEach((m, i) => {
        const sel = this.selected?.k === k && this.selected.i === i;
        const tag = { mk: k, i };
        const y = this.heightAt(m.x, m.z);
        const mat = new THREE.MeshStandardMaterial({ color: sel ? spec.sel : spec.color, emissive: sel ? '#5a3a00' : '#1a0d00', flatShading: true });
        const g = new THREE.Group();
        if (k === 'herds') {
          const size = 2 + Math.sqrt(m.grazers) * 0.6;
          const puck = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 1.2, 16), mat);
          puck.position.set(m.x, y + 0.8, -m.z);
          const pole = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 8), mat);
          pole.position.set(m.x, y + 4.5, -m.z);
          g.add(puck, pole);
          if (m.roam > 0) g.add(this.terrainRing(m.x, m.z, m.roam, sel ? '#ffe08a' : '#f0cf8a', sel ? 0.95 : 0.6));
        } else if (k === 'deposits') {
          const sz = 1.2 + Math.sqrt(m.alloys / 1000) * 1.4;
          for (const [dx, dz, h] of [[0, 0, 1.6], [1.6, 0.6, 1.1], [-1.3, 1, 0.9], [0.4, -1.5, 1.2]]) {
            const c = new THREE.Mesh(new THREE.OctahedronGeometry(sz * 0.6 * h), mat);
            c.position.set(m.x + dx * sz * 0.6, y + sz * h * 0.5, -(m.z + dz * sz * 0.6));
            g.add(c);
          }
        } else if (k === 'sites') {
          const pin = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), mat);
          pin.position.set(m.x, y + 6, -m.z);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 5, 6), mat);
          stem.position.set(m.x, y + 2.5, -m.z);
          g.add(pin, stem, this.terrainRing(m.x, m.z, m.r, sel ? '#b8f1ff' : '#3fd6ff', sel ? 0.9 : 0.6));
        } else if (k === 'camps') {
          // a few huts round a fire, and the ring of their land
          const land = (this.host.inhabitants?.[String(m.group)]?.land as number | undefined) ?? 40;
          for (let h = 0; h < 3; h++) {
            const a = (h / 3) * Math.PI * 2 + 0.5;
            const hut = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.5, 8), mat);
            hut.position.set(m.x + Math.cos(a) * 5, this.heightAt(m.x + Math.cos(a) * 5, m.z + Math.sin(a) * 5) + 2.25, -(m.z + Math.sin(a) * 5));
            g.add(hut);
          }
          const fire = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: '#ffb547' }));
          fire.position.set(m.x, y + 1.2, -m.z);
          g.add(fire, this.terrainRing(m.x, m.z, land, sel ? '#e2ccff' : '#b98cff', sel ? 0.9 : 0.55));
        } else if (k === 'vents') {
          const crack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 7), mat);
          crack.position.set(m.x, y + 0.4, -m.z);
          crack.rotation.y = 0.4;
          const plume = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 8), mat);
          plume.rotation.x = Math.PI;
          plume.position.set(m.x, y + 4.5, -m.z);
          g.add(crack, plume, this.terrainRing(m.x, m.z, 5, sel ? '#ffc08a' : '#ff7a2a', 0.8));
        } else {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 4), mat);
          cone.rotation.x = Math.PI;
          cone.position.set(m.x, y + 5, -m.z);
          g.add(cone, this.terrainRing(m.x, m.z, 7, sel ? '#ff9aa3' : '#d8414e', 0.8));
        }
        g.traverse((o) => { o.userData = { ...tag }; });
        this.markerGroup.add(g);
      });
    }
  }

  private pickMarker(): { k: MKind; i: number } | null {
    const hits = this.ray.intersectObjects(this.markerGroup.children, true);
    for (const hit of hits) if (hit.object.userData.mk) return { k: hit.object.userData.mk, i: hit.object.userData.i };
    return null;
  }

  private select(sel: { k: MKind; i: number } | null) {
    this.selected = sel;
    this.drawMarkers();
    this.renderLists();
  }

  private addMarker(k: MKind, x: number, z: number) {
    const list = this.lists[k];
    if (list.length >= ((regionShape[k] as { max?: number }).max ?? 60)) return;
    this.pushUndo();
    list.push(MARKERS[k].make(round1(x), round1(z)));
    this.selected = { k, i: list.length - 1 };
    this.commitLayers();
    this.renderLists();
  }

  private deleteMarker(sel: { k: MKind; i: number } | null) {
    if (!sel || sel.i >= this.lists[sel.k].length) return;
    this.pushUndo();
    this.lists[sel.k].splice(sel.i, 1);
    this.selected = null;
    this.commitLayers();
    this.renderLists();
  }

  // ---------- overlays ----------
  private drawOverlays() {
    for (const o of [...this.overlays.children]) {
      this.overlays.remove(o);
      o.traverse((m) => { (m as THREE.Mesh).geometry?.dispose(); ((m as THREE.Mesh).material as THREE.Material | undefined)?.dispose(); });
    }
    const r = this.host.rules;
    if (prefs.build && r) {
      // the Core's own reach, and how far one finished building at its edge pushes it
      this.overlays.add(this.terrainRing(0, 0, r.coreRange, '#5be3a0', 0.95), this.terrainRing(0, 0, r.coreRange + r.buildRadius + 4, '#5be3a0', 0.4));
    }
    if (prefs.rings) for (let d = 25; d < HALF * 1.42; d += 25) this.overlays.add(this.terrainRing(0, 0, d, '#cfe6ff', d % 50 ? 0.18 : 0.35));
    if (prefs.paths) for (const sp of this.packStarts()) {
      const path = this.packPath(sp.x, sp.z);
      const pts = path.pts.map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z) + 1.2, -z));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: path.stuck ? '#ffb547' : '#ff5d6c', transparent: true, opacity: 0.95, depthTest: false }));
      line.renderOrder = 5;
      line.raycast = () => {};
      this.overlays.add(line);
      // a dot every 10 s of walking
      const dotGeo = new THREE.SphereGeometry(0.9, 8, 6);
      for (let k = 100; k < path.pts.length; k += 100) {
        const [x, z] = path.pts[k];
        const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#ff5d6c', depthTest: false }));
        dot.position.set(x, this.heightAt(x, z) + 1.2, -z);
        dot.renderOrder = 6;
        dot.raycast = () => {};
        this.overlays.add(dot);
      }
    }
    if (this.area) this.overlays.add(this.areaRect());
  }

  /** Where packs come in: the spawns, or the sim's fallback corner. */
  private packStarts() {
    const sp = this.lists.spawns;
    return sp.length ? sp : [{ x: PACK_LIMIT - 10, z: PACK_LIMIT - 10 }];
  }

  /**
   * The way a pack walks from (x, z) to the Core: the sim's steering (straight
   * at the target, sidestepping water, turning at most 6 rad/s), at the
   * predators' speed, 10 steps a second. `stuck` = it never got there.
   */
  packPath(x: number, z: number): { pts: [number, number][]; secs: number; stuck: boolean } {
    const speed = this.host.rules?.packSpeed ?? 6, DT = 0.1, step = speed * DT;
    const blocked = (px: number, pz: number) => Math.abs(px) > PACK_LIMIT || Math.abs(pz) > PACK_LIMIT || this.rawAt(px, pz) < WATER_PATH;
    let heading = Math.atan2(-x, -z);
    const pts: [number, number][] = [[x, z]];
    let best = Infinity, stall = 0;
    for (let t = 0; t < 3000; t++) {
      const left = Math.hypot(x, z);
      if (left < 14) return { pts, secs: t * DT, stuck: false };
      let ang = Math.atan2(-x, -z);
      for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
        const a = ang + off;
        if (!blocked(x + Math.sin(a) * (step + 2), z + Math.cos(a) * (step + 2))) { ang = a; break; }
      }
      let dh = ang - heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      heading += Math.max(-6 * DT, Math.min(6 * DT, dh));
      x += Math.sin(heading) * Math.min(step, left);
      z += Math.cos(heading) * Math.min(step, left);
      pts.push([x, z]);
      if (left < best - 0.3) { best = left; stall = 0; } else if (++stall > 150) break;
    }
    return { pts, secs: pts.length * DT, stuck: true };
  }

  // ---------- area: select, copy, paste ----------
  private areaRect() {
    const a = this.area!;
    const pts: THREE.Vector3[] = [];
    const edge = (x: number, z: number) => pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.8, -z));
    const n = 40;
    for (let k = 0; k < n; k++) edge(a.x0 + ((a.x1 - a.x0) * k) / n, a.z0);
    for (let k = 0; k < n; k++) edge(a.x1, a.z0 + ((a.z1 - a.z0) * k) / n);
    for (let k = 0; k < n; k++) edge(a.x1 - ((a.x1 - a.x0) * k) / n, a.z1);
    for (let k = 0; k < n; k++) edge(a.x0, a.z1 - ((a.z1 - a.z0) * k) / n);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 2, gapSize: 1.5, depthTest: false }));
    line.computeLineDistances();
    line.renderOrder = 7;
    line.raycast = () => {};
    return (this.areaLine = line);
  }

  /** Snap a rectangle to grid nodes: [i0, j0, i1, j1] inclusive. */
  private areaNodes(a: { x0: number; z0: number; x1: number; z1: number }) {
    const ni = (v: number) => Math.min(NC - 1, Math.max(0, Math.round((v + HALF) / REGION_STEP)));
    return [ni(Math.min(a.x0, a.x1)), ni(Math.min(a.z0, a.z1)), ni(Math.max(a.x0, a.x1)), ni(Math.max(a.z0, a.z1))];
  }

  /** Copy the selected area (or the whole region) to the clipboard: sculpt, ground shape, flora paint, markers. */
  copyArea(): Clip | null {
    const a = this.area ?? { x0: -HALF, z0: -HALF, x1: HALF, z1: HALF };
    const [i0, j0, i1, j1] = this.areaNodes(a);
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    if (w < 2 || h < 2) return null;
    const clip: Clip = { w, h, off: [], shape: [], paint: [], markers: {} };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const n = j * NC + i;
      clip.off.push(round1(this.off[n]));
      clip.shape.push(round1(proc![n] + this.off[n] * fade[n]));
      clip.paint.push(Math.round(this.paint[n] * 100) / 100);
    }
    const cx = nodeX(i0) + ((w - 1) * REGION_STEP) / 2, cz = nodeZ(j0 * NC) + ((h - 1) * REGION_STEP) / 2;
    const inside = (m: Marker) => m.x >= nodeX(i0) - 1 && m.x <= nodeX(i1) + 1 && m.z >= nodeZ(j0 * NC) - 1 && m.z <= nodeZ(j1 * NC) + 1;
    for (const k of MKINDS) {
      const ms = this.lists[k].filter(inside).map((m) => ({ ...m, x: round1(m.x - cx), z: round1(m.z - cz) }));
      if (ms.length) clip.markers[k] = ms;
    }
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { return null; }
    this.renderClip();
    return clip;
  }

  /** Paste the clipboard centred on (x, z). Undoable. */
  pasteArea(x: number, z: number): boolean {
    let clip: Clip;
    try { clip = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null'); } catch { return false; }
    if (!clip?.w) return false;
    this.pushUndo();
    const ci = Math.round((x + HALF) / REGION_STEP) - Math.floor((clip.w - 1) / 2), cj = Math.round((z + HALF) / REGION_STEP) - Math.floor((clip.h - 1) / 2);
    const feather = 3;
    for (let b = 0; b < clip.h; b++) for (let a = 0; a < clip.w; a++) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= NC || j >= NC) continue;
      const n = j * NC + i, k = b * clip.w + a;
      if (prefs.pasteShape) {
        // the copied ground's shape, blended in over the outer few cells so there's no cliff at the seam
        const edge = Math.min(a, b, clip.w - 1 - a, clip.h - 1 - b);
        const t = Math.min(1, (edge + 1) / (feather + 1));
        const want = (clip.shape[k] - proc![n]) / Math.max(0.05, fade[n]);
        this.off[n] = Math.max(-MAX_OFF, Math.min(MAX_OFF, this.off[n] + (want - this.off[n]) * t));
      } else this.off[n] = clip.off[k];
      this.paint[n] = clip.paint[k];
    }
    if (prefs.pasteMarkers) {
      const px = nodeX(Math.max(0, Math.min(NC - 1, ci))) + ((clip.w - 1) * REGION_STEP) / 2, pz = nodeZ(Math.max(0, Math.min(NC - 1, cj)) * NC) + ((clip.h - 1) * REGION_STEP) / 2;
      for (const k of MKINDS) {
        const max = (regionShape[k] as { max?: number }).max ?? 60;
        for (const m of clip.markers[k] ?? []) {
          if (this.lists[k].length >= max) break;
          const copy = { ...m, x: round1(clampR(px + m.x)), z: round1(clampR(pz + m.z)) } as Marker;
          // story sites are found by id: keep them unique
          if (k === 'sites') { const id = String(copy.id); let v = id, n = 2; while (this.lists.sites.some((o) => String(o.id) === v)) v = `${id}-${n++}`; (copy as unknown as Record<string, unknown>).id = v; }
          this.lists[k].push(copy);
        }
      }
    }
    this.rebuild(0, N2);
    this.commitLayers();
    this.renderLists();
    return true;
  }

  /** How long each spawn's pack takes to reach the Core (with the paths overlay on). */
  private renderPaths() {
    const el2 = this.aside.querySelector('#pack-paths');
    if (!el2) return;
    if (!prefs.paths) { el2.textContent = ''; return; }
    el2.textContent = this.packStarts().map((sp, i) => {
      const p = this.packPath(sp.x, sp.z);
      return `${this.lists.spawns.length ? `Spawn ${i + 1}` : 'Corner (no spawns)'}: ${p.stuck ? 'gets stuck' : `${Math.round(p.secs)} s to the Core`}`;
    }).join(' · ') + ` (at ${this.host.rules?.packSpeed ?? 6} u/s)`;
  }

  private clipInfo(): string {
    try {
      const c = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null') as Clip | null;
      if (!c?.w) return 'Nothing copied yet.';
      const n = Object.values(c.markers).reduce((m, l) => m + (l?.length ?? 0), 0);
      return `Copied: ${(c.w - 1) * REGION_STEP} × ${(c.h - 1) * REGION_STEP} u${n ? `, ${n} marker${n > 1 ? 's' : ''}` : ''}. Ctrl+V pastes it centred on the cursor (any region).`;
    } catch { return ''; }
  }
  private renderClip() {
    const el = this.aside.querySelector('#clip-info');
    if (el) el.textContent = `${this.area ? `Selected: ${Math.round(Math.abs(this.area.x1 - this.area.x0))} × ${Math.round(Math.abs(this.area.z1 - this.area.z0))} u. ` : 'No area selected: Copy takes the whole region. '}${this.clipInfo()}`;
  }

  // ---------- helpers for lines ----------
  private terrainRing(cx: number, cz: number, r: number, color: string, opacity: number) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const x = clampR(cx + Math.cos(a) * r), z = clampR(cz + Math.sin(a) * r);
      pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.6, -z));
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.raycast = () => {};
    return line;
  }
  private flatRing(r: number, color: string, opacity: number) {
    const line = this.terrainRing(0, 0, r, color, opacity);
    return line;
  }
  private squareLine(e: number, color: string, dashed: boolean) {
    const pts: THREE.Vector3[] = [];
    const n = 120;
    const edge = (x: number, z: number) => pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.5, -z));
    for (let k = 0; k < n; k++) edge(-e + (2 * e * k) / n, -e);
    for (let k = 0; k < n; k++) edge(e, -e + (2 * e * k) / n);
    for (let k = 0; k < n; k++) edge(e - (2 * e * k) / n, e);
    for (let k = 0; k < n; k++) edge(-e, e - (2 * e * k) / n);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.8 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    if (dashed) line.computeLineDistances();
    line.raycast = () => {};
    return line;
  }

  private updateCursor() {
    const brush = !['select', 'area', 'herd', 'deposit', 'spawn', 'vent', 'camp', 'site'].includes(prefs.tool);
    this.cursor.visible = !!this.hover && brush;
    if (!this.hover || !brush) return;
    const p = this.cursor.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const x = clampR(this.hover.x + Math.cos(a) * prefs.radius), z = clampR(this.hover.z + Math.sin(a) * prefs.radius);
      p.setXYZ(k, x, this.heightAt(x, z) + 0.7, -z);
    }
    p.needsUpdate = true;
    const minus = this.shift !== (prefs.tool === 'lower' || prefs.tool === 'flora-');
    (this.cursor.material as THREE.LineBasicMaterial).color.set(prefs.tool.startsWith('flora') ? (minus ? '#ff4fa3' : '#3cff9a') : minus ? '#ffb547' : '#ffffff');
  }

  // ---------- input ----------
  private toNdc(e: PointerEvent | MouseEvent) {
    const r = renderer!.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  private groundHit(): { x: number; z: number } | null {
    const hit = this.ray.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    return { x: hit.point.x, z: -hit.point.z };
  }

  private onKey = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redoStep(); else this.undoStep(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redoStep(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); this.copyArea(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); if (this.hover) this.pasteArea(this.hover.x, this.hover.z); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (tool) { this.setTool(tool.id); return; }
    if (e.key === '[') this.setRadius(prefs.radius / 1.2);
    else if (e.key === ']') this.setRadius(prefs.radius * 1.2);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { e.preventDefault(); this.deleteMarker(this.selected); }
    else if (e.key === 'Escape') { this.select(null); if (this.area) { this.area = null; this.drawOverlays(); this.renderClip(); } }
    else if (e.key.toLowerCase() === 'f') this.frameAll();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.shift = e.shiftKey; };

  private bindInput() {
    const el = renderer!.domElement;
    el.oncontextmenu = (e) => e.preventDefault();
    el.onpointermove = (e) => {
      this.shift = e.shiftKey;
      this.toNdc(e);
      this.hover = this.groundHit();
      if (this.areaDrag && this.hover) {
        this.area = { x0: this.areaDrag.x, z0: this.areaDrag.z, x1: clampR(this.hover.x), z1: clampR(this.hover.z) };
        if (this.areaLine) { this.overlays.remove(this.areaLine); this.areaLine.geometry.dispose(); (this.areaLine.material as THREE.Material).dispose(); }
        this.overlays.add(this.areaRect());
        this.renderClip();
      }
      if (this.dragging && this.hover) {
        const m = this.lists[this.dragging.k][this.dragging.i];
        m.x = round1(clampR(this.hover.x)); m.z = round1(clampR(this.hover.z));
        this.drawMarkers();
      }
      this.updateReadout();
    };
    el.onpointerleave = () => { this.hover = null; this.updateReadout(); };
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      this.toNdc(e);
      this.hover = this.groundHit();
      const tool = prefs.tool;
      if (tool === 'area') {
        if (!this.hover) return;
        this.areaDrag = { x: clampR(this.hover.x), z: clampR(this.hover.z) };
        this.area = null;
        this.drawOverlays();
        el.setPointerCapture(e.pointerId);
        return;
      }
      const adds = MKINDS.find((k) => MARKERS[k].tool === tool);
      if (tool === 'select' || adds) {
        const hit = this.pickMarker();
        if (hit) {
          this.pushUndo();
          this.dragging = hit;
          this.select(hit);
          el.setPointerCapture(e.pointerId);
          return;
        }
        if (adds && this.hover) this.addMarker(adds, this.hover.x, this.hover.z);
        else this.select(null);
        return;
      }
      if (!this.hover) return;
      this.pushUndo();
      const i = nearestNode(this.hover.x, this.hover.z);
      this.stroke = { tool, target: proc![i] + this.off[i] * fade[i], last: performance.now() };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointerup = (e) => {
      if (this.areaDrag) {
        this.areaDrag = null;
        // a click without a drag clears the selection
        if (this.area && (Math.abs(this.area.x1 - this.area.x0) < REGION_STEP * 2 || Math.abs(this.area.z1 - this.area.z0) < REGION_STEP * 2)) { this.area = null; this.drawOverlays(); }
        this.renderClip();
      }
      if (this.dragging) {
        this.dragging = null;
        this.commitLayers();
        this.renderLists();
      }
      if (this.stroke) {
        this.stroke = null;
        this.commitLayers();
      }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
  }

  private frame() {
    if (this.stroke) {
      const now = performance.now();
      this.applyBrush(Math.min(0.05, (now - this.stroke.last) / 1000));
      this.stroke.last = now;
    }
    this.updateCursor();
    this.controls.update();
    renderer!.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.canvasWrap.clientWidth, h = this.canvasWrap.clientHeight;
    if (!w || !h) return;
    renderer!.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frameAll() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 190, -170);
  }

  private updateReadout() {
    const h = this.hover;
    if (!h) { this.readout.textContent = ''; return; }
    const i = nearestNode(h.x, h.z);
    const sculpt = this.off[i] * fade[i];
    this.readout.textContent =
      `x ${h.x.toFixed(1)}  z ${h.z.toFixed(1)}  ·  ${Math.hypot(h.x, h.z).toFixed(0)} u from the Core  ·  height ${this.heightAt(h.x, h.z).toFixed(1)} u` +
      `  ·  sculpt ${sculpt >= 0 ? '+' : ''}${sculpt.toFixed(1)}  ·  flora ${Math.round(this.paint[i] * 100)}%` +
      (pad[i] < 1 ? '  ·  landing pad' : '') + (fade[i] < 1 ? '  ·  edge fade' : '');
  }

  /** Test hook: client coordinates of a region point. */
  screenOf(x: number, z: number) {
    const v = new THREE.Vector3(x, this.heightAt(x, z), -z).project(this.camera);
    const r = renderer!.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
  get herdCount() { return this.lists.herds.length; }
  count(k: MKind) { return this.lists[k].length; }

  // ---------- side panel ----------
  private setTool(t: Tool) {
    prefs.tool = t;
    for (const b of this.asideEls.tools.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.tool === t);
    this.updateCursor();
  }
  private setRadius(r: number) {
    prefs.radius = Math.max(2, Math.min(60, r));
    const inp = this.aside.querySelector<HTMLInputElement>('#brush-radius');
    if (inp) { inp.value = String(prefs.radius); inp.nextElementSibling!.textContent = `${prefs.radius.toFixed(0)} u`; }
  }

  private buildAside() {
    const a = this.aside;
    a.replaceChildren();
    const sec = (title: string) => { const g = el('div', 'group', title); a.append(g); return g; };

    sec('Tools');
    const tools = el('div', 'tools');
    for (const t of TOOLS) {
      const b = el('button', '', '') as HTMLButtonElement;
      b.dataset.tool = t.id;
      b.title = t.tip;
      b.append(t.label, el('kbd', '', t.key));
      b.onclick = () => this.setTool(t.id);
      tools.append(b);
    }
    a.append(tools);
    const slider = (id: string, label: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const row = el('label', 'slider');
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(val) });
      const out = el('span', 'unit', fmt(val));
      inp.oninput = () => { set(Number(inp.value)); out.textContent = fmt(Number(inp.value)); };
      row.append(el('span', 'lbl', label), inp, out);
      a.append(row);
    };
    slider('brush-radius', 'Brush size', 2, 60, 1, prefs.radius, (v) => `${v.toFixed(0)} u`, (v) => (prefs.radius = v));
    slider('brush-strength', 'Strength', 0.05, 1, 0.05, prefs.strength, (v) => `${Math.round(v * 100)}%`, (v) => (prefs.strength = v));
    const paintToggle = el('label', 'check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = prefs.showPaint;
    cb.onchange = () => { prefs.showPaint = cb.checked; this.rebuild(0, N2); };
    paintToggle.append(cb, ' Show flora paint (green more, pink less)');
    a.append(paintToggle);

    sec('Overlays');
    const toggle = (key: 'build' | 'rings' | 'paths', label: string, tip: string) => {
      const row = el('label', 'check');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = prefs[key];
      box.dataset.overlay = key;
      box.onchange = () => { prefs[key] = box.checked; savePrefs(); if (key === 'build') this.rebuild(0, N2); this.drawOverlays(); this.renderPaths(); };
      row.title = tip;
      row.append(box, ` ${label}`);
      a.append(row);
    };
    toggle('build', 'Build area and unbuildable ground', 'Green: the Core\'s reach at the start (solid) and one building further out (faint). Red: water, ground too steep for a building, or too near the edge.');
    toggle('rings', 'Distance rings from the Core (every 25 u)', 'Faint every 25 u, brighter every 50 u. The readout shows the distance under the cursor too.');
    toggle('paths', 'The way packs walk in', 'From each predator spawn to the Core, steering as the game does (straight at it, around water). A dot every 10 s of walking; amber if they get stuck.');
    const paths = el('div', 'help', '');
    paths.id = 'pack-paths';
    a.append(paths);

    sec('Copy and paste');
    const clip = el('div', 'help', '');
    clip.id = 'clip-info';
    const btn = (label: string, fn: () => void) => { const b = el('button', '', label) as HTMLButtonElement; b.onclick = fn; return b; };
    const pasteOpt = (key: 'pasteShape' | 'pasteMarkers', label: string, tip: string) => {
      const row = el('label', 'check');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = prefs[key];
      box.onchange = () => { prefs[key] = box.checked; savePrefs(); };
      row.title = tip;
      row.append(box, ` ${label}`);
      return row;
    };
    a.append(
      el('div', 'help', 'Select area (A), drag a rectangle, Ctrl+C. Then Ctrl+V with the cursor where its centre should go: here or in another region.'),
      el('div', 'actions-col', btn('Copy (Ctrl+C)', () => this.copyArea()), btn('Paste at the centre of the view', () => this.pasteArea(this.controls.target.x, -this.controls.target.z))),
      pasteOpt('pasteShape', 'Paste the ground\'s shape, not just the sculpting', 'On: the pasted area takes the copied ground\'s actual heights (generated terrain included), blended in at the edges. Off: only the sculpting is copied, added to whatever terrain is generated here.'),
      pasteOpt('pasteMarkers', 'Paste markers in the area too', 'Herds, deposits, spawns, vents, camps and story sites inside the copied area.'),
      clip,
    );
    this.asideEls = { tools, lists: {} as Record<MKind, HTMLElement>, form: {} as Record<MKind, HTMLElement> };
    for (const k of MKINDS) { this.asideEls.lists[k] = el('div', 'herd-list'); this.asideEls.form[k] = el('div', 'herd-form'); }
    this.setTool(prefs.tool);

    sec('Play test');
    const play = el('button', 'primary', '▶ Play this region') as HTMLButtonElement;
    play.title = 'Opens the game in a new tab on this region as it is now (unsaved edits too), starting deployed. Your own colony\'s autosave is left alone.';
    play.onclick = () => this.playTest();
    a.append(play, el('div', 'help', 'A fresh game on this map, as it is now. Nothing is saved from it.'));

    sec('Region');
    const d = this.host.draft;
    const fields = (keys: (keyof typeof regionShape)[], onChange = () => this.host.changed()) => {
      for (const key of keys) {
        const f = regionShape[key];
        const row = el('label', 'mini-row');
        row.append(el('span', 'lbl', f.label ?? key), this.host.control(d, key, f, onChange));
        if (f.help) row.append(el('span', 'help', f.help));
        a.append(row);
      }
    };
    fields(['name', 'description', 'floraSeed', 'floraDensity']);
    sec('Place on the planet');
    fields(['siteLat', 'siteLon'], () => { this.resite(); this.host.changed(); });
    sec('Difficulty');
    a.append(el('div', 'help', 'Overrides for this region only; empty fields use Rules → Threat rules and Colony rules.'));
    fields(['packScale', 'graceSeconds', 'waveInterval', 'startAlloys']);

    for (const k of MKINDS) {
      sec(MARKERS[k].label);
      a.append(this.asideEls.lists[k], this.asideEls.form[k]);
    }
    this.renderLists();
    this.renderClip();
    this.renderPaths();

    sec('Layers');
    const clr = (label: string, fn: () => void) => { const b = el('button', '', label) as HTMLButtonElement; b.onclick = fn; return b; };
    a.append(el('div', 'actions-col',
      clr('Clear all sculpting', () => { if (confirm('Reset the terrain to the generated shape? (Undo with Ctrl+Z)')) { this.pushUndo(); this.off.fill(0); this.rebuild(0, N2); this.commitLayers(); } }),
      clr('Clear all flora paint', () => { if (confirm('Remove all flora paint? (Undo with Ctrl+Z)')) { this.pushUndo(); this.paint.fill(0); this.rebuild(0, N2); this.commitLayers(); } }),
    ));

    sec('Controls');
    a.append(el('div', 'help-block',
      'Left drag: use tool · Right drag: orbit · Middle drag: pan · Wheel: zoom · [ ]: brush size · Shift: invert raise/lower and flora · Ctrl+Z / Ctrl+Shift+Z: undo / redo · F: frame region · H / D / P: add herd / deposit / spawn · Del: delete the selected marker. ' +
      'The amber ring is the landing pad (kept flat; sculpting its centre raises or lowers the whole pad). Sculpting fades out inside the dashed line so the region meets the planet.'));
  }

  private renderLists() {
    for (const k of MKINDS) {
      const spec = MARKERS[k];
      const list = this.asideEls.lists[k], form = this.asideEls.form[k];
      list.replaceChildren();
      this.lists[k].forEach((m, i) => {
        const on = this.selected?.k === k && this.selected.i === i;
        const b = el('button', on ? 'item on' : 'item', '') as HTMLButtonElement;
        b.append(el('span', '', `${spec.one} ${i + 1}`), el('small', '', `${spec.summary(m)} · (${Math.round(m.x)}, ${Math.round(m.z)})`));
        b.onclick = () => { this.select({ k, i }); this.controls.target.set(m.x, this.heightAt(m.x, m.z), -m.z); };
        list.append(b);
      });
      const key = TOOLS.find((t) => t.id === spec.tool)!.key;
      let note = `None yet. Use ${TOOLS.find((t) => t.id === spec.tool)!.label} (${key}) and click the ground.`;
      if (this.lists[k].length) {
        if (k === 'herds') note = `${this.lists[k].reduce((s, m) => s + m.grazers, 0)} grazers in ${this.lists[k].length} herds. Add with ${key}.`;
        else if (k === 'deposits') note = `${this.lists[k].reduce((s, m) => s + m.alloys, 0).toLocaleString()} alloys in ${this.lists[k].length} deposits. Add with ${key}.`;
        else if (k === 'sites') note = `Story events with a "site" trigger fire when a drone or unit gets inside the ring. Add with ${key}.`;
        else if (k === 'camps') note = `The ring is their land: the colony's buildings there wear their regard down. Add with ${key}.`;
        else if (k === 'vents') note = `${this.lists[k].length} vents. Add with ${key}.`;
        else note = `Packs pick one of these at random. Add with ${key}.`;
      } else if (k === 'spawns') note += ' Without any, packs come from the north-east corner.';
      list.append(el('div', 'help', note));
      form.replaceChildren();
      const m = this.selected?.k === k ? this.lists[k][this.selected.i] : undefined;
      if (!m) continue;
      form.append(el('div', 'sub', `${spec.one} ${this.selected!.i + 1}`));
      for (const [key, f] of Object.entries(spec.shape)) {
        const row = el('label', 'mini-row');
        row.append(el('span', 'lbl', f.label ?? key), this.host.control(m as unknown as Record<string, unknown>, key, f, () => { this.drawMarkers(); this.host.changed(); }));
        if (f.help) row.append(el('span', 'help', f.help));
        form.append(row);
      }
      const del = el('button', 'danger', `Delete ${spec.one.toLowerCase()}`) as HTMLButtonElement;
      del.onclick = () => this.deleteMarker(this.selected);
      form.append(del);
    }
  }
}

function el(tag: string, cls: string, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
const smooth01 = (t: number) => t * t * (3 - 2 * t);
const round1 = (v: number) => Math.round(v * 10) / 10;
const clampR = (v: number) => Math.max(-HALF, Math.min(HALF, v));
function nearestNode(x: number, z: number) {
  const i = Math.min(NC - 1, Math.max(0, Math.round((x + HALF) / REGION_STEP)));
  const j = Math.min(NC - 1, Math.max(0, Math.round((z + HALF) / REGION_STEP)));
  return j * NC + i;
}
