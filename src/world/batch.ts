/**
 * Instanced drawing for finished buildings of one kind: one InstancedMesh per
 * material, however many buildings there are (instead of ~6 draw calls per
 * building). Only for kinds without animated parts (walls, solar arrays).
 *
 * Unpowered buildings dim their lights: every glowing material gets a second,
 * dimmed pool, and a building's glowing parts live in exactly one of the two
 * (the other slot is collapsed to zero scale).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Kinds drawn instanced once finished. */
export const BATCHED_KINDS = new Set(['wall', 'solar']);

/** Emissive multiplier for an unpowered building (same as the per-building path). */
const DIM = 0.08;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Part { lit: THREE.InstancedMesh; dark: THREE.InstancedMesh | null }

export class BuildingBatch {
  readonly group = new THREE.Group();
  private parts: Part[] = [];
  private cap = 0;
  /** Building id per instance slot (dense), and the reverse. */
  private ids: number[] = [];
  private slot = new Map<number, number>();
  private mats: THREE.Matrix4[] = [];
  private powered: boolean[] = [];

  constructor(template: THREE.Object3D, capacity = 32) {
    template.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    template.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      src.applyMatrix4(local);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const groups = src.groups.length ? src.groups : [{ start: 0, count: src.getAttribute('position').count, materialIndex: 0 }];
      for (const gr of groups) {
        const g = new THREE.BufferGeometry();
        for (const k of ['position', 'normal']) {
          const a = src.getAttribute(k) as THREE.BufferAttribute | undefined;
          if (a) g.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
        }
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const mat = mats[gr.materialIndex ?? 0] ?? mats[0];
        byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
      }
    });
    for (const [mat, geos] of byMat) {
      const geo = mergeGeometries(geos)!;
      // only materials that actually glow need a dimmed twin (glTF and built-ins default to intensity 1 on black)
      const sm = mat as THREE.MeshStandardMaterial;
      const glows = 'emissiveIntensity' in sm && sm.emissiveIntensity > 0 && !!sm.emissive && sm.emissive.getHex() !== 0;
      let darkMat: THREE.Material | null = null;
      if (glows) {
        darkMat = mat.clone();
        (darkMat as THREE.MeshStandardMaterial).emissiveIntensity *= DIM;
      }
      this.parts.push({ lit: this.mesh(geo, mat), dark: darkMat ? this.mesh(geo, darkMat) : null });
    }
    this.grow(capacity);
  }

  get count() { return this.ids.length; }
  /** Draw calls this batch costs (for tests). */
  get drawCalls() { return this.parts.reduce((n, p) => n + (p.dark ? 2 : 1), 0); }

  has(id: number) { return this.slot.has(id); }

  /** Add (or move) building `id`, placed by `matrix` (relative to the batch's parent). */
  set(id: number, matrix: THREE.Matrix4, powered = true) {
    let i = this.slot.get(id);
    if (i === undefined) {
      i = this.ids.length;
      if (i >= this.cap) this.grow(this.cap * 2);
      this.ids.push(id);
      this.slot.set(id, i);
      this.mats.push(new THREE.Matrix4());
      this.powered.push(powered);
    }
    this.mats[i].copy(matrix);
    this.powered[i] = powered;
    this.write(i);
    this.sync();
  }

  setPowered(id: number, powered: boolean) {
    const i = this.slot.get(id);
    if (i === undefined || this.powered[i] === powered) return;
    this.powered[i] = powered;
    this.write(i);
    this.sync();
  }

  remove(id: number) {
    const i = this.slot.get(id);
    if (i === undefined) return;
    const last = this.ids.length - 1;
    if (i !== last) {
      // move the last building into the freed slot
      const moved = this.ids[last];
      this.ids[i] = moved;
      this.slot.set(moved, i);
      this.mats[i].copy(this.mats[last]);
      this.powered[i] = this.powered[last];
      this.write(i);
    }
    this.ids.pop();
    this.mats.pop();
    this.powered.pop();
    this.slot.delete(id);
    this.sync();
  }

  dispose() {
    for (const p of this.parts) for (const m of [p.lit, p.dark]) {
      if (!m) continue;
      m.geometry.dispose();
      m.dispose();
    }
    for (const p of this.parts) if (p.dark) (p.dark.material as THREE.Material).dispose();
    this.group.clear();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const m = new THREE.InstancedMesh(geo, mat, 1);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false; // instances span the whole base; one bounding sphere would be meaningless
    return m;
  }

  private write(i: number) {
    const on = this.powered[i];
    for (const p of this.parts) {
      if (!p.dark) { p.lit.setMatrixAt(i, this.mats[i]); continue; }
      p.lit.setMatrixAt(i, on ? this.mats[i] : ZERO);
      p.dark.setMatrixAt(i, on ? ZERO : this.mats[i]);
    }
  }

  private sync() {
    const n = this.ids.length;
    for (const p of this.parts) for (const m of [p.lit, p.dark]) {
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.visible = n > 0;
    }
  }

  private grow(cap: number) {
    this.cap = cap;
    this.group.clear();
    for (const p of this.parts) {
      for (const k of ['lit', 'dark'] as const) {
        const old = p[k];
        if (!old) continue;
        const m = new THREE.InstancedMesh(old.geometry, old.material, cap);
        m.frustumCulled = false;
        m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, m.instanceMatrix.array.length)));
        m.count = old.count;
        m.visible = old.visible;
        old.dispose(); // frees the instance buffer only; geometry and material are reused
        p[k] = m;
        this.group.add(m);
      }
    }
  }
}
