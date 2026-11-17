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
import { HEIGHT_SCALE, PREVIEW_KEY, REGION_CELLS as NC, REGION_STEP, depositShape, herdShape, regionShape, spawnShape, ventShape } from '../content/defs';
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
}

type Tool = 'select' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'flora+' | 'flora-' | 'herd' | 'deposit' | 'spawn' | 'vent';
const TOOLS: { id: Tool; label: string; key: string; tip: string }[] = [
  { id: 'select', label: 'Select', key: 'Q', tip: 'Click a herd, deposit, spawn or vent to select it; drag to move it' },
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
];

type MKind = 'herds' | 'deposits' | 'spawns' | 'vents';
type Marker = Record<string, number>;
const MARKERS: Record<MKind, { label: string; one: string; shape: Shape; tool: Tool; make(x: number, z: number): Marker; summary(m: Marker): string; color: string; sel: string }> = {
  herds: { label: 'Grazer herds', one: 'Herd', shape: herdShape, tool: 'herd', make: (x, z) => ({ x, z, grazers: 20, roam: 40 }), summary: (m) => `${m.grazers} grazers`, color: '#c99a4a', sel: '#ffe08a' },
  deposits: { label: 'Alloy deposits', one: 'Deposit', shape: depositShape, tool: 'deposit', make: (x, z) => ({ x, z, alloys: 1000 }), summary: (m) => `${m.alloys} alloys`, color: '#e08a2c', sel: '#ffd08a' },
  spawns: { label: 'Predator spawns', one: 'Spawn', shape: spawnShape, tool: 'spawn', make: (x, z) => ({ x, z }), summary: () => 'packs enter here', color: '#d8414e', sel: '#ff9aa3' },
  vents: { label: 'Geothermal vents', one: 'Vent', shape: ventShape, tool: 'vent', make: (x, z) => ({ x, z }), summary: () => 'a Geothermal Tap fits here', color: '#ff7a2a', sel: '#ffc08a' },
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
const prefs = { tool: 'raise' as Tool, radius: 12, strength: 0.5, showPaint: true };

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
    this.scene.add(this.cursor, this.markerGroup);
    this.drawMarkers();

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
      this.hgt[i] = Math.max(0, raw);
      pos.setXYZ(i, nodeX(i), this.hgt[i], -nodeZ(i));
      const p = this.paint[i];
      terrainColor(raw, floraBase[i] + p * FLORA_PAINT_SHIFT, c);
      if (prefs.showPaint && p !== 0) c.lerp(tint.set(p > 0 ? '#3cff9a' : '#ff4fa3'), Math.min(0.6, Math.abs(p) * 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    };
    if (nodes) for (const i of nodes) one(i);
    else for (let i = from; i < to; i++) one(i);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Height of the displayed terrain at region coords (bilinear over nodes). */
  private heightAt(x: number, z: number) {
    const fx = Math.min(NC - 1.0001, Math.max(0, (x + HALF) / REGION_STEP));
    const fz = Math.min(NC - 1.0001, Math.max(0, (z + HALF) / REGION_STEP));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, g = this.hgt;
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
    const brush = !['select', 'herd', 'deposit', 'spawn', 'vent'].includes(prefs.tool);
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (tool) { this.setTool(tool.id); return; }
    if (e.key === '[') this.setRadius(prefs.radius / 1.2);
    else if (e.key === ']') this.setRadius(prefs.radius * 1.2);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { e.preventDefault(); this.deleteMarker(this.selected); }
    else if (e.key === 'Escape') this.select(null);
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
      `x ${h.x.toFixed(1)}  z ${h.z.toFixed(1)}  ·  height ${this.heightAt(h.x, h.z).toFixed(1)} u` +
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
