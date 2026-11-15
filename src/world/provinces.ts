/**
 * Strategic regions ("provinces") on the home globe — the planet layer of the
 * game. Fixed seeds, so borders are the same every run: the landing province,
 * a ring of tutorial provinces around it, and larger provinces across the rest
 * of the planet. Ocean is unclaimed.
 *
 * Borders follow the globe's triangles (spherical Voronoi on triangle
 * centroids), so they read as low-poly territory lines from orbit.
 */
import * as THREE from 'three';
import { smoothstep } from './noise';
import { R, U, E, N, globeHeight } from './planet';

export type ProvinceState = 'held' | 'tutorial' | 'unexplored';

export interface Province {
  id: number;
  name: string;
  seed: THREE.Vector3;
  state: ProvinceState;
  tris: number;
}

const TUTORIAL_NAMES = ['BASALT RIDGE', 'SALT FLATS', 'VENT FIELD', 'NORTHERN REACH'];

function makeSeeds(): Province[] {
  const out: Province[] = [];
  out.push({ id: 0, name: 'TOUCHDOWN', seed: U.clone(), state: 'held', tris: 0 });
  // tutorial ring
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const ang = 0.15 + (i % 2) * 0.03;
    const s = U.clone().multiplyScalar(Math.cos(ang))
      .addScaledVector(E, Math.sin(ang) * Math.cos(a)).addScaledVector(N, Math.sin(ang) * Math.sin(a)).normalize();
    out.push({ id: out.length, name: TUTORIAL_NAMES[i], seed: s, state: 'tutorial', tris: 0 });
  }
  // the rest of the planet: jittered Fibonacci sphere, kept clear of the tutorial cluster
  let rs = 99;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const n = 90;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) * (2 / n);
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963 + rnd() * 0.5;
    const s = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r)
      .add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.12)).normalize();
    if (Math.acos(Math.min(1, s.dot(U))) < 0.36) continue;
    out.push({ id: out.length, name: `R-${String(out.length).padStart(2, '0')}`, seed: s, state: 'unexplored', tris: 0 });
  }
  return out;
}

export class Provinces {
  readonly list: Province[];
  private borders: THREE.LineSegments;
  private fill: THREE.Mesh;
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; p: Province }[] = [];
  readonly landCount: number;

  constructor(scene: THREE.Scene, globe: THREE.Mesh, labelLayer: HTMLElement) {
    this.list = makeSeeds();
    const geo = globe.geometry.index ? globe.geometry.toNonIndexed() : globe.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const triCount = pos.count / 3;
    const owner = new Int16Array(triCount);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();

    for (let t = 0; t < triCount; t++) {
      a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
      m.copy(a).add(b).add(c).normalize();
      if (globeHeight(m) <= 0) { owner[t] = -1; continue; }
      let best = 0, bd = -2;
      for (const p of this.list) {
        const d = p.seed.dot(m);
        if (d > bd) { bd = d; best = p.id; }
      }
      owner[t] = best;
      this.list[best].tris++;
    }
    this.landCount = this.list.filter((p) => p.tris > 0).length;

    // shared edges between triangles owned by different land provinces
    const key = (v: THREE.Vector3) => `${Math.round(v.x * 4)},${Math.round(v.y * 4)},${Math.round(v.z * 4)}`;
    const edges = new Map<string, number>();
    const linePts: number[] = [];
    const lift = (v: THREE.Vector3) => v.clone().multiplyScalar((v.length() + 4) / v.length());
    const verts = [a, b, c];
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) verts[k].fromBufferAttribute(pos, t * 3 + k);
      for (let k = 0; k < 3; k++) {
        const v0 = verts[k], v1 = verts[(k + 1) % 3];
        const k0 = key(v0), k1 = key(v1);
        const ek = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
        const other = edges.get(ek);
        if (other === undefined) { edges.set(ek, t); continue; }
        edges.delete(ek);
        const o1 = owner[t], o2 = owner[other];
        if (o1 !== o2 && o1 >= 0 && o2 >= 0) {
          const p0 = lift(v0), p1 = lift(v1);
          linePts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
    this.borders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: '#bff8ff', transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    scene.add(this.borders);

    // tinted overlay for held + tutorial provinces
    const fp: number[] = [], fc: number[] = [];
    const cyan = new THREE.Color('#5ff3ff'), amber = new THREE.Color('#ffb547');
    for (let t = 0; t < triCount; t++) {
      const o = owner[t];
      if (o < 0 || this.list[o].state === 'unexplored') continue;
      const col = this.list[o].state === 'held' ? cyan : amber;
      for (let k = 0; k < 3; k++) {
        const v = lift(a.fromBufferAttribute(pos, t * 3 + k));
        fp.push(v.x, v.y, v.z);
        fc.push(col.r, col.g, col.b);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    this.fill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    scene.add(this.fill);

    for (const p of this.list) {
      if (p.state === 'unexplored') continue;
      const el = document.createElement('div');
      el.className = `label province ${p.state}`;
      el.innerHTML = `${p.name}<small>${p.state === 'held' ? 'held' : 'tutorial'}</small>`;
      el.style.opacity = '0';
      labelLayer.appendChild(el);
      this.labels.push({ el, p, pos: p.seed.clone().multiplyScalar(R + Math.max(0, globeHeight(p.seed)) + 10) });
    }
  }

  update(camera: THREE.PerspectiveCamera, dist: number, width: number, height: number) {
    const k = smoothstep(900, 3500, dist) * (1 - smoothstep(40000, 160000, dist));
    (this.borders.material as THREE.LineBasicMaterial).opacity = k * 0.45;
    (this.fill.material as THREE.MeshBasicMaterial).opacity = k * 0.22;
    this.borders.visible = this.fill.visible = k > 0.01;
    const v = new THREE.Vector3();
    const lk = smoothstep(1500, 4000, dist) * (1 - smoothstep(22000, 45000, dist));
    for (const l of this.labels) {
      // hide labels on the far side of the planet
      const facing = v.copy(camera.position).sub(l.pos).normalize().dot(l.p.seed);
      v.copy(l.pos).project(camera);
      const o = lk * smoothstep(0.05, 0.3, facing);
      if (o < 0.02 || v.z > 1) { l.el.style.opacity = '0'; continue; }
      l.el.style.opacity = String(o);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -140%)`;
    }
  }
}
