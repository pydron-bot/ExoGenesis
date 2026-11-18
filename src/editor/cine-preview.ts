/**
 * Cinematic preview (Cinematics → any): a small 3D view in the editor that
 * plays the draft at the timeline's playhead, without opening the game.
 *
 * It runs the game's own player (src/cinematic.ts) and camera (src/camera.ts)
 * over the region's real terrain (world/planet.ts), so framing matches the
 * game. What it leaves out: the colony (every building key looks at the
 * Command Core), flora, fog, lighting by time of day, and sound.
 */
import * as THREE from 'three';
import { ZoomCamera } from '../camera';
import { Cinematic, type CineHooks, type SetPiece } from '../cinematic';
import type { CameraKeyDef, CharacterDef, CinematicDef, RegionDef } from '../content/defs';
import { REGION_HALF as HALF } from '../sim/types';
import { probePath } from '../world/probe-path';
import { R, U, regionDir, regionFlora, regionHeight, regionHeightRaw, regionTerrain, regionToWorld, setGroundPads, setRegionTerrain, terrainColor } from '../world/planet';
import { buildCore, orient } from '../world/region';

const STEP = 2;
const N = Math.round((HALF * 2) / STEP) + 1;

let renderer: THREE.WebGLRenderer | null = null;

export interface PreviewSource {
  draft(): CinematicDef;
  id(): string;
  region(): RegionDef | undefined;
  character(id: string): CharacterDef | undefined;
  /** {first} in lines, as the editor shows it elsewhere. */
  sample(text: string): string;
}

const h = (cls: string, ...kids: Node[]) => { const e = document.createElement('div'); e.className = cls; e.append(...kids); return e; };

export class CinePreview {
  readonly el: HTMLElement;
  private scene = new THREE.Scene();
  private cam: ZoomCamera;
  private cine: Cinematic | null = null;
  private core: THREE.Group;
  private probe: THREE.Group;
  private terrain: THREE.Mesh | null = null;
  private markers = new THREE.Group();
  private regionKey = '';
  private wrap: HTMLElement;
  private ui: { title: HTMLElement; sub: HTMLElement; who: HTMLElement; said: HTMLElement; line: HTMLElement; fade: HTMLElement; bars: HTMLElement; note: HTMLElement };
  private t = 0;
  private ro: ResizeObserver;

  constructor(private src: PreviewSource) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const ui = {
      title: h('pv-title'), sub: h('pv-sub'), who: h('pv-who'), said: h('pv-said'), line: h('pv-line'),
      fade: h('pv-fade'), bars: h('pv-bars', h('pv-bar'), h('pv-bar')), note: h('pv-note'),
    };
    ui.line.append(ui.who, ui.said);
    this.ui = ui;
    this.wrap = h('pv-view');
    this.el = h('cine-pv', this.wrap, ui.bars, ui.line, h('pv-cap', ui.title, ui.sub), ui.fade, ui.note);

    this.cam = new ZoomCamera(new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 1.2e7));
    this.scene.background = new THREE.Color('#8fb0b6');
    this.scene.fog = new THREE.Fog('#8fb0b6', 600, 5000);
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#4a3428', 1.2));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.copy(U).multiplyScalar(R * 2).add(new THREE.Vector3(800, 600, -400));
    this.scene.add(sun);
    // the rest of the planet, for shots from high up (the landing starts at ~26 km)
    const globe = new THREE.Mesh(new THREE.SphereGeometry(R - 1.5, 96, 64), new THREE.MeshStandardMaterial({ color: '#7a5139', roughness: 1 }));
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

    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.wrap);
    this.refresh();
  }

  /** The draft changed: rebuild the player (and the terrain if the region did). */
  refresh() {
    const d = this.src.draft(), reg = this.region();
    const key = `${reg.id}:${(reg.def?.height ?? []).length}:${reg.def?.siteLat ?? 0}:${reg.def?.siteLon ?? 0}:${JSON.stringify(reg.def?.camps ?? [])}:${JSON.stringify(reg.def?.sites ?? [])}`;
    if (key !== this.regionKey) { this.regionKey = key; this.buildRegion(reg.def); }
    if (!d?.camera?.length || !(d.length > 0)) { this.cine = null; this.ui.note.textContent = 'Add a camera key to preview.'; this.render(); return; }
    this.ui.note.textContent = '';
    const landing = d.scene === 'landing';
    const piece: SetPiece | null = landing ? this.probePiece(d) : null;
    this.cine = new Cinematic(this.src.id(), d, this.cam, this.hooks(), piece);
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

  dispose() { this.ro.disconnect(); this.el.remove(); }

  private region(): { id: string; def: RegionDef | undefined } {
    const d = this.src.draft();
    const def = this.src.region();
    return { id: d?.scene === 'landing' ? 'touchdown' : d?.region || 'touchdown', def };
  }

  /** The region's ground as the game shapes it, in world space, plus markers for camps and story sites. */
  private buildRegion(def: RegionDef | undefined) {
    if (def) setRegionTerrain(regionTerrain(def));
    setGroundPads([]);
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), c = new THREE.Color(), v = new THREE.Vector3();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP, k = (j * N + i) * 3;
      regionToWorld(x, z, 0, v);
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      terrainColor(regionHeightRaw(x, z), regionFlora(x, z), c);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
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

  /** The landing's probe, following the same path as in the game. */
  private probePiece(d: CinematicDef): SetPiece {
    const self = this, pad = regionHeight(0, 0), td = d.touchdown ?? 12;
    let alt = 0, speed = 0;
    const at = (t: number, out: THREE.Vector3) => { const p = probePath(td, t); return regionDir(p.x, p.z, out).multiplyScalar(R + pad + p.alt); };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    return {
      frame(t) {
        at(t, self.probe.position);
        self.probe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), regionDir(0, 0));
        alt = probePath(td, t).alt;
        speed = at(t + 0.05, b).distanceTo(at(t, a)) / 0.05;
      },
      get probe() { return self.probe.position; },
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

  private render() {
    if (!renderer) return;
    const w = Math.max(200, this.wrap.clientWidth), hgt = Math.round(w * 9 / 16);
    this.wrap.style.height = `${hgt}px`;
    if (renderer.domElement.parentElement !== this.wrap) this.wrap.append(renderer.domElement);
    renderer.setSize(w, hgt);
    this.cam.camera.aspect = w / hgt;
    this.ui.bars.style.display = this.src.draft()?.letterbox !== false && this.src.draft()?.scene !== 'landing' ? '' : 'none';
    if (this.src.draft()?.scene === 'landing' && this.src.draft()?.letterbox) this.ui.bars.style.display = '';
    this.cam.update(1, new THREE.Vector3().copy(U).multiplyScalar(1e7));
    renderer.render(this.scene, this.cam.camera);
  }
}
