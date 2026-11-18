/**
 * Worlds (Maps → Worlds → any): the body as it will look, turning slowly, lit
 * from one side (drag to turn it, wheel to zoom), and a top-down map of the
 * system with its orbit picked out. Redraws as the form changes.
 *
 * The globe is the same one the solar system draws (world/system.ts
 * buildBodyObject), which uses the same terrain functions as landing there.
 */
import * as THREE from 'three';
import type { BodyDef } from '../content/defs';
import { buildBodyObject } from '../world/system';

let renderer: THREE.WebGLRenderer | null = null;

export interface WorldSource {
  id(): string;
  draft(): BodyDef;
  /** Every body (saved), for the orbit map. */
  all(): Record<string, BodyDef>;
  /** Regions on this body. */
  regions(): { id: string; name: string; size: number }[];
  openRegion(id: string): void;
  openMap(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

export class WorldPreview {
  readonly el: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 1e6);
  private obj: THREE.Object3D | null = null;
  private view: HTMLElement;
  private orbit = document.createElement('canvas');
  private info: HTMLElement;
  private regionsEl: HTMLElement;
  private raf = 0;
  private yaw = 0.6;
  private tilt = 0.25;
  private zoom = 3.2;
  private key = '';
  private spin = true;
  private disposed = false;

  constructor(private src: WorldSource) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.view = h('div', 'wp-view');
    this.info = h('div', 'wp-info');
    this.regionsEl = h('div', 'wp-regions');
    this.orbit.className = 'wp-orbit';
    this.orbit.width = 360; this.orbit.height = 360;
    this.el = h('div', 'world-pv', h('div', 'wp-row', this.view, this.orbit), this.info, this.regionsEl);
    this.scene.background = new THREE.Color('#03050a');
    const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    sun.position.set(-1, 0.35, 0.6);
    this.scene.add(sun, new THREE.AmbientLight('#8fa6c0', 0.18));
    this.bindInput();
    this.refresh();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.spin) this.yaw += 0.003;
      this.render();
    };
    loop();
  }

  /** The draft changed: rebuild the globe if its look did, redraw the orbit map. */
  refresh() {
    const d = this.src.draft();
    if (!d || typeof d.radius !== 'number') return;
    const look = JSON.stringify({ ...d, name: 0, sub: 0, description: 0, orbit: 0, ecc: 0, incl: 0, period: 0, phase: 0, parent: 0 });
    if (look !== this.key) {
      this.key = look;
      if (this.obj) { this.scene.remove(this.obj); dispose(this.obj); }
      try { this.obj = buildBodyObject(this.src.id(), d); this.scene.add(this.obj); } catch { this.obj = null; }
    }
    const regions = this.src.regions();
    const maxRegion = Math.floor(((d.radius / 3) * 2) / 40) * 40;
    this.info.textContent = d.kind === 'giant'
      ? `${d.name}: a gas giant, ${Math.round(d.radius).toLocaleString()} u radius. Nothing can land on it; its moons can hold regions.`
      : `${d.name}: radius ${Math.round(d.radius).toLocaleString()} u (Home 3,000). Regions here can be up to ${Math.min(480, maxRegion)} u across.${d.ocean ? ' Has seas.' : ' No seas: the lowest ground is dry basin floor.'}${(d.plants ?? -1) <= -0.9 ? ' Barren: no plants grow unless painted on.' : ''}`;
    this.regionsEl.replaceChildren();
    if (d.kind !== 'giant') {
      const map = h('button', '', 'Open on the planet map');
      map.onclick = () => this.src.openMap();
      this.regionsEl.append(h('span', 'dim', regions.length ? 'Regions here: ' : 'No regions here yet. '));
      regions.forEach((r, i) => {
        const a = h('a', 'fl-link', r.name);
        a.href = '#';
        a.onclick = (e) => { e.preventDefault(); this.src.openRegion(r.id); };
        this.regionsEl.append(a, h('small', 'dim', ` ${r.size} u${i < regions.length - 1 ? ', ' : ' '}`));
      });
      this.regionsEl.append(map);
    }
    this.drawOrbits();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.obj) dispose(this.obj);
    this.el.remove();
  }

  private bindInput() {
    let drag: { x: number; y: number } | null = null;
    this.view.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; this.spin = false; this.view.setPointerCapture(e.pointerId); };
    this.view.onpointermove = (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.008;
      this.tilt = Math.max(-1.3, Math.min(1.3, this.tilt + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    };
    this.view.onpointerup = () => { drag = null; };
    this.view.ondblclick = () => { this.spin = !this.spin; };
    this.view.onwheel = (e) => { e.preventDefault(); this.zoom = Math.max(1.3, Math.min(12, this.zoom * Math.exp(e.deltaY * 0.001))); };
    this.view.title = 'Drag to turn it, wheel to zoom, double-click to stop or start the spin';
  }

  private render() {
    if (!renderer || !this.obj) return;
    const w = Math.max(200, this.view.clientWidth), hh = Math.round(Math.min(360, w * 0.75));
    this.view.style.height = `${hh}px`;
    if (renderer.domElement.parentElement !== this.view) this.view.append(renderer.domElement);
    renderer.setSize(w, hh);
    this.camera.aspect = w / hh;
    const d = this.src.draft();
    const r = d?.radius ?? 1000, reach = d?.ring ? r * Math.max(1, d.ringOuter ?? 2.2) : r;
    const dist = reach * this.zoom;
    this.camera.near = dist * 0.01; this.camera.far = dist * 10;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.tilt) * dist, Math.sin(this.tilt) * dist, Math.cos(this.yaw) * Math.cos(this.tilt) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  /** Top-down system map, distances on a square-root scale so the inner planets don't vanish. */
  private drawOrbits() {
    const ctx = this.orbit.getContext('2d')!, W = this.orbit.width, C = W / 2;
    const all = { ...this.src.all(), [this.src.id()]: this.src.draft() };
    const me = this.src.id();
    ctx.fillStyle = '#03050a';
    ctx.fillRect(0, 0, W, W);
    const top = Object.values(all).reduce((m, b) => (b && !b.parent ? Math.max(m, b.orbit * (1 + (b.ecc ?? 0))) : m), 1);
    const scale = (d: number) => (Math.sqrt(d / top) * (C - 14));
    // the chain of parents of this body, to centre an inset on its planet
    const parent = all[me]?.parent ? all[all[me].parent!] : undefined;
    const ellipse = (a: number, e: number, cx: number, cy: number, k: (d: number) => number, color: string, width: number) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const th = (i / 96) * Math.PI * 2, r = (a * (1 - e * e)) / (1 + e * Math.cos(th));
        const x = cx + Math.cos(th) * k(r), y = cy + Math.sin(th) * k(r);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    ctx.fillStyle = '#ffe6b0';
    ctx.beginPath(); ctx.arc(C, C, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10px system-ui, sans-serif';
    for (const [id, b] of Object.entries(all)) {
      if (!b || b.parent) continue;
      const mine = id === me || (parent && b === parent);
      ellipse(b.orbit, b.ecc ?? 0, C, C, scale, mine ? '#ffb547' : 'rgba(95, 243, 255, 0.28)', mine ? 1.6 : 1);
      const th = ((b.phase ?? 0) * Math.PI) / 180, rr = scale((b.orbit * (1 - (b.ecc ?? 0) ** 2)) / (1 + (b.ecc ?? 0) * Math.cos(th)));
      const x = C + Math.cos(th) * rr, y = C + Math.sin(th) * rr;
      ctx.fillStyle = mine ? '#ffb547' : b.kind === 'giant' ? '#d9c39a' : '#9fb7c4';
      ctx.beginPath(); ctx.arc(x, y, b.kind === 'giant' ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      if (mine || b.kind !== 'comet') { ctx.fillStyle = mine ? '#ffd28a' : 'rgba(213, 227, 240, 0.65)'; ctx.fillText(b.name, x + 5, y - 4); }
    }
    // inset: the planet this body orbits, and its moons
    if (parent) {
      const R0 = 66, cx = W - R0 - 6, cy = W - R0 - 6;
      ctx.fillStyle = 'rgba(5, 8, 13, 0.9)'; ctx.strokeStyle = 'rgba(95, 243, 255, 0.4)'; ctx.lineWidth = 1;
      ctx.fillRect(cx - R0, cy - R0, R0 * 2, R0 * 2); ctx.strokeRect(cx - R0, cy - R0, R0 * 2, R0 * 2);
      const moons = Object.entries(all).filter(([, b]) => b?.parent === all[me].parent);
      const far = Math.max(...moons.map(([, b]) => b.orbit), 1);
      const k = (d: number) => (d / far) * (R0 - 10);
      ctx.fillStyle = '#d9c39a'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      for (const [id, b] of moons) ellipse(b.orbit, b.ecc ?? 0, cx, cy, k, id === me ? '#ffb547' : 'rgba(95, 243, 255, 0.35)', id === me ? 1.6 : 1);
      ctx.fillStyle = '#d5e3f0'; ctx.fillText(`round ${parent.name}`, cx - R0 + 4, cy - R0 + 12);
    }
  }
}

function dispose(o: THREE.Object3D) {
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}
