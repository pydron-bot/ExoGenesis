/**
 * Domination areas drawn on the globe being played (DESIGN §5.12, TECH.md "Domination areas"): borders between the
 * body's areas (a spherical Voronoi of their centres over the globe's triangles, like the provinces), the area being
 * played tinted, and a label on each. It takes the provinces' place while it's on.
 */
import * as THREE from 'three';
import type { Area } from '../sim/areas';
import { smoothstep } from './noise';
import { globeDirOfSite, globeHeight, R } from './planet';

export class AreaGlobe {
  private borders: THREE.LineSegments;
  private fill: THREE.Mesh;
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  readonly count: number;

  /** `areas`: this body's; `here`: the one being played (tinted), if any. */
  constructor(scene: THREE.Scene, globe: THREE.Mesh, labelLayer: HTMLElement, areas: Area[], here: string | null, private sea: boolean) {
    this.count = areas.length;
    const dirs = areas.map((a) => globeDirOfSite(a.lat, a.lon));
    const g = globe.geometry;
    const pa = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const index = g.index ? (g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pa.length / 3 }, (_, i) => i);
    const triCount = index.length / 3;
    const owner = new Int16Array(triCount);
    const m = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
      m.set(pa[a] + pa[b] + pa[c], pa[a + 1] + pa[b + 1] + pa[c + 1], pa[a + 2] + pa[b + 2] + pa[c + 2]).normalize();
      // seas belong to nobody
      if (this.sea && globeHeight(m) <= 0) { owner[t] = -1; continue; }
      let best = 0, bd = -2;
      dirs.forEach((d, i) => { const v = d.dot(m); if (v > bd) { bd = v; best = i; } });
      owner[t] = best;
    }
    const lift = R * 0.0015 + 3;
    const lifted = (vi: number, out: number[]) => {
      const x = pa[vi * 3], y = pa[vi * 3 + 1], z = pa[vi * 3 + 2], l = Math.hypot(x, y, z), k = (l + lift) / l;
      out.push(x * k, y * k, z * k);
    };
    const edges = new Map<number, number>();
    const nv = pa.length / 3;
    const line: number[] = [];
    for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) {
      const v0 = index[t * 3 + k], v1 = index[t * 3 + ((k + 1) % 3)];
      const ek = v0 < v1 ? v0 * nv + v1 : v1 * nv + v0;
      const other = edges.get(ek);
      if (other === undefined) { edges.set(ek, t); continue; }
      edges.delete(ek);
      const o1 = owner[t], o2 = owner[other];
      if (o1 !== o2 && o1 >= 0 && o2 >= 0) { lifted(v0, line); lifted(v1, line); }
    }
    const hi = areas.findIndex((a) => a.id === here);
    const fp: number[] = [];
    if (hi >= 0) for (let t = 0; t < triCount; t++) if (owner[t] === hi) for (let k = 0; k < 3; k++) lifted(index[t * 3 + k], fp);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(line), 3));
    this.borders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ffe2a8', transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.borders);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(fp), 3));
    this.fill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: '#36d6e8', transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.fill);

    areas.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = `label area${a.id === here ? ' here' : ''}`;
      el.dataset.area = a.id;
      el.innerHTML = `${a.name.toUpperCase()}<small>${a.id === here ? 'you are here' : `area ${i + 1} of ${areas.length}`}</small>`;
      el.style.opacity = '0';
      labelLayer.appendChild(el);
      const d = dirs[i];
      this.labels.push({ el, dir: d, pos: d.clone().multiplyScalar(R + Math.max(0, globeHeight(d)) + R * 0.004) });
    });
  }

  hide() {
    this.borders.visible = this.fill.visible = false;
    for (const l of this.labels) l.el.style.opacity = '0';
  }

  /** Faded in from orbit (the provinces' distances, scaled to this body's size). */
  update(camera: THREE.PerspectiveCamera, dist: number, width: number, height: number) {
    const s = R / 3000;
    const k = smoothstep(900 * s, 3500 * s, dist) * (1 - smoothstep(40000 * s, 160000 * s, dist));
    (this.borders.material as THREE.LineBasicMaterial).opacity = k * 0.6;
    (this.fill.material as THREE.MeshBasicMaterial).opacity = k * 0.28;
    this.borders.visible = this.fill.visible = k > 0.01;
    const v = new THREE.Vector3();
    const lk = smoothstep(1500 * s, 4000 * s, dist) * (1 - smoothstep(22000 * s, 45000 * s, dist));
    for (const l of this.labels) {
      const facing = v.copy(camera.position).sub(l.pos).normalize().dot(l.dir);
      v.copy(l.pos).project(camera);
      const o = lk * smoothstep(0.05, 0.3, facing);
      if (o < 0.02 || v.z > 1) { l.el.style.opacity = '0'; continue; }
      l.el.style.opacity = String(o);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -140%)`;
    }
  }
}
