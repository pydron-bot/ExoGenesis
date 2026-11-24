/**
 * Destroyed buildings don't just vanish (look only). The building's model buckles: it crushes down, leans
 * and chars over about a second and a half, then sinks out of sight while a heap of rubble (broken chunks
 * and a few bent beams, sized to the footprint) is left smouldering on scorched ground. The heap stays for
 * a few minutes of game time, then settles into the ground. Building over it clears it at once.
 *
 * RegionView owns one; main.ts reads `fresh` (each collapse once: a dust burst and the scorch mark) and
 * `smouldering()` (smoke over young heaps).
 */
import * as THREE from 'three';
import { placeMatrix } from './heightGrid';

/** Seconds of game time: the fall, the heap's life, the settle at the end. */
const FALL = 1.6;
const SINK = 1.4;
const LIFE = 180;
const SETTLE = 8;
/** Most heaps at once (the oldest goes first). */
const MAX = 16;

const CHAR = new THREE.Color('#1b1715');

const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
const beamGeo = new THREE.BoxGeometry(0.4, 0.3, 1);
const chunkMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
/** Chunk colours: concrete, panel grey, char. */
const CHUNK_COLS = ['#6b6560', '#57524e', '#3a3633', '#262220', '#7a7570'].map((c) => new THREE.Color(c));
const beamMat = new THREE.MeshStandardMaterial({ color: '#2c2a29', roughness: 0.6, metalness: 0.6, flatShading: true });

interface Ruin {
  x: number; z: number; r: number; h: number;
  /** Game seconds since it fell. */
  t: number;
  model: THREE.Object3D | null;
  /** The model's materials and their colours before charring. */
  mats: { m: THREE.MeshStandardMaterial; c: THREE.Color; e: number }[];
  base: THREE.Vector3; up: THREE.Vector3; q0: THREE.Quaternion; axis: THREE.Vector3; lean: number;
  chunks: THREE.InstancedMesh; beams: THREE.InstancedMesh;
  /** Per instance: matrix at rest (heaps rise into place and sink away by scaling about it). */
  rest: THREE.Matrix4[]; restB: THREE.Matrix4[];
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Ruins {
  private list: Ruin[] = [];
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  /** Collapses since main.ts last looked (it adds a dust burst and the scorch). */
  readonly fresh: { x: number; z: number; r: number; h: number }[] = [];

  constructor(private parent: THREE.Object3D) {}

  /** Heaps standing now (tests). */
  get count() { return this.list.length; }

  /**
   * A building at (x, z), `r` in radius and `h` tall, was destroyed. `model` is a fresh copy of its model, posed
   * where it stood (or null: rubble only); it is taken over and disposed of here.
   */
  collapse(x: number, z: number, r: number, h: number, model: THREE.Object3D | null, done = true) {
    while (this.list.length >= MAX) this.drop(this.list[0]);
    const mats: Ruin['mats'] = [];
    if (model) {
      // own materials, so charring this one leaves the others alone
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const one = (mm: THREE.Material) => {
          const c = mm.clone() as THREE.MeshStandardMaterial;
          if ('color' in c && c.color) mats.push({ m: c, c: c.color.clone(), e: c.emissiveIntensity ?? 0 });
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
      });
      this.parent.add(model);
    }
    const size = done ? 1 : 0.55;
    const n = Math.round(THREE.MathUtils.clamp(r * r * 1.5, 12, 60) * size);
    const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, n);
    const nb = Math.round(THREE.MathUtils.clamp(r * 0.6, 2, 6) * size);
    const beams = new THREE.InstancedMesh(beamGeo, beamMat, nb);
    const rest: THREE.Matrix4[] = [], restB: THREE.Matrix4[] = [];
    const s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      // a heap: bigger and higher toward the middle
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.85;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const mid = 1 - d / (r * 0.85 + 0.01);
      const k = rnd(0.25, 0.55) * Math.max(0.6, Math.min(2.2, r * 0.32)) * (0.6 + 0.6 * mid) * size;
      placeMatrix(px, pz, Math.random() * 6.28, k * 0.35 + mid * r * 0.12 * size, 1, this.m);
      this.m.decompose(p, this.q, s);
      this.q.multiply(new THREE.Quaternion().setFromEuler(e.set(rnd(-1, 1), 0, rnd(-1, 1))));
      const mm = new THREE.Matrix4().compose(p, this.q, s.set(k * rnd(0.8, 1.4), k * rnd(0.5, 0.9), k * rnd(0.8, 1.3)));
      rest.push(mm);
      chunks.setColorAt(i, CHUNK_COLS[Math.floor(Math.random() * CHUNK_COLS.length)]);
    }
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.6;
      const len = rnd(0.5, 0.9) * Math.min(5, r) * size;
      placeMatrix(x + Math.cos(a) * d, z + Math.sin(a) * d, Math.random() * 6.28, len * 0.18, 1, this.m);
      this.m.decompose(p, this.q, s);
      // leaning out of the heap
      this.q.multiply(new THREE.Quaternion().setFromEuler(e.set(rnd(-0.5, -0.2), 0, rnd(-0.2, 0.2))));
      restB.push(new THREE.Matrix4().compose(p, this.q, s.set(1, 1, len)));
    }
    for (const im of [chunks, beams]) { im.frustumCulled = false; im.count = 0; this.parent.add(im); }
    const ruin: Ruin = {
      x, z, r, h, t: 0, model, mats,
      base: model ? model.position.clone() : new THREE.Vector3(), up: model ? model.position.clone().normalize() : new THREE.Vector3(0, 1, 0),
      q0: model ? model.quaternion.clone() : new THREE.Quaternion(),
      axis: new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize(), lean: rnd(0.12, 0.28) * (Math.random() < 0.5 ? -1 : 1),
      chunks, beams, rest, restB,
    };
    this.list.push(ruin);
    this.fresh.push({ x, z, r, h });
    this.place(ruin, 0);
  }

  /** Clear heaps under a new building (centre and radius). */
  clearAt(x: number, z: number, r: number) {
    for (const u of [...this.list]) if (Math.hypot(u.x - x, u.z - z) < u.r + r) this.drop(u);
  }

  /** Young heaps still smoking: where, how big, how strongly (1 fresh → 0). */
  smouldering(): { x: number; z: number; r: number; k: number }[] {
    const out: { x: number; z: number; r: number; k: number }[] = [];
    for (const u of this.list) if (u.t < 45) out.push({ x: u.x, z: u.z, r: u.r, k: 1 - u.t / 45 });
    return out;
  }

  /** Once a frame with the game time passed (0 while paused). */
  update(gdt: number) {
    for (const u of [...this.list]) {
      u.t += gdt;
      if (u.t > LIFE + SETTLE) { this.drop(u); continue; }
      this.place(u, u.t);
    }
  }

  private place(u: Ruin, t: number) {
    if (u.model) {
      if (t > FALL + SINK) {
        this.parent.remove(u.model);
        this.disposeModel(u);
      } else {
        // buckle: crush, lean and char; then sink out of sight under the dust
        const f = Math.min(1, t / FALL);
        const e = f * f * (3 - 2 * f);
        const sink = Math.max(0, (t - FALL) / SINK);
        u.model.scale.set(1 + 0.08 * e, 1 - 0.5 * e, 1 + 0.08 * e);
        u.model.quaternion.copy(u.q0).multiply(this.q.setFromAxisAngle(u.axis, u.lean * e));
        u.model.position.copy(u.base).addScaledVector(u.up, -u.h * (0.12 * e + 0.6 * sink * sink));
        for (const mt of u.mats) {
          mt.m.color.copy(mt.c).lerp(CHAR, 0.75 * e);
          if ('emissiveIntensity' in mt.m) mt.m.emissiveIntensity = mt.e * (1 - e);
        }
      }
    }
    // the heap: shows as the building comes down, settles into the ground at the end
    const grow = THREE.MathUtils.smoothstep(t, 0.2, FALL + 0.4);
    const settle = 1 - THREE.MathUtils.smoothstep(t, LIFE, LIFE + SETTLE);
    const k = grow * settle;
    const set = (im: THREE.InstancedMesh, rest: THREE.Matrix4[]) => {
      im.count = k > 0.01 ? rest.length : 0;
      if (!im.count) return;
      for (let i = 0; i < rest.length; i++) {
        this.m.copy(rest[i]);
        // scale about the ground: sink along the local up as it settles
        const s = 0.3 + 0.7 * k;
        this.m.multiply(this.tmp.makeScale(s, s, s));
        this.v.setFromMatrixPosition(rest[i]).addScaledVector(this.v2.setFromMatrixPosition(rest[i]).normalize(), -(1 - k) * 1.2);
        this.m.setPosition(this.v);
        im.setMatrixAt(i, this.m);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    set(u.chunks, u.rest);
    set(u.beams, u.restB);
  }
  private tmp = new THREE.Matrix4();
  private v2 = new THREE.Vector3();

  private disposeModel(u: Ruin) {
    for (const mt of u.mats) mt.m.dispose();
    u.mats = [];
    u.model = null;
  }

  private drop(u: Ruin) {
    if (u.model) { this.parent.remove(u.model); this.disposeModel(u); }
    this.parent.remove(u.chunks, u.beams);
    u.chunks.dispose(); u.beams.dispose();
    this.list.splice(this.list.indexOf(u), 1);
  }
}
