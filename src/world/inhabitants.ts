/**
 * Inhabitant camps on the region (src/sim/inhabitants.ts): the camp's
 * structures (centre model plus a ring of dwellings facing it) once the camp
 * has been explored, and the people in sight, instanced per group and role.
 *
 * Models come from the group's record (content/inhabitants/<id>.json). An
 * asset with a `far` stand-in (src/world/inhabitant-models.ts) has two
 * versions: the asset model up close, the low-poly stand-in when the camera is
 * zoomed out (same thresholds as the skirmish's LOD), and the stand-in also
 * while the asset model loads, or if it fails to. A camp the colony drove off
 * (or that left) keeps its structures, cold.
 */
import * as THREE from 'three';
import { flattenForInstancing, loadModel } from '../assets/models';
import type { AssetDef, InhabitantDef } from '../content/defs';
import { FOG_CELL, FOG_N, REGION_HALF, type Snapshot } from '../sim/types';
import { LOD_FAR, LOD_NEAR } from '../skirmish/view';
import { addFog } from './fog';
import type { Flora } from './flora';
import { STANDINS } from './inhabitant-models';
import { orient } from './region';

const MAX_PEOPLE = 64;

/** People of one group and role: the asset model's mesh (once loaded) and the stand-in's. */
interface Crowd { mesh: THREE.InstancedMesh | null; far: THREE.InstancedMesh | null; n: number }
/** One camp structure: the asset model (once loaded) and its stand-in, if it has one. */
interface Part { near: THREE.Object3D | null; far: THREE.Object3D | null }
interface Camp { obj: THREE.Group; parts: Part[]; charge: THREE.MeshStandardMaterial[] }

export class InhabitantView {
  private group = new THREE.Group();
  /** Built camps, by index in the snapshot. */
  private camps: (Camp | null)[] = [];
  /** Instanced people: `<group>:walker` / `<group>:elder`. */
  private crowds = new Map<string, Crowd>();
  private dummy = new THREE.Object3D();
  /** Drawing the asset models (camera close), not the stand-ins. */
  private near = true;

  constructor(
    parent: THREE.Object3D,
    private defs: Record<string, InhabitantDef>,
    private assets: Record<string, AssetDef>,
    private fog: boolean,
    private flora: Flora | null,
  ) {
    parent.add(this.group);
  }

  private model(id: string | undefined): Promise<THREE.Group> | null {
    const a = id ? this.assets[id] : undefined;
    return a ? loadModel(a) : null;
  }

  /** The asset's far stand-in, freshly built (null if it has none). */
  private standIn(id: string | undefined): THREE.Group | null {
    const far = id ? this.assets[id]?.far : undefined;
    return far && STANDINS[far] ? STANDINS[far]() : null;
  }

  private fogged(o: THREE.Object3D) {
    if (!this.fog) return;
    o.traverse((m) => { if (m instanceof THREE.Mesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) addFog(mat); });
  }

  private instanced(root: THREE.Object3D): THREE.InstancedMesh {
    const { geometry, materials } = flattenForInstancing(root);
    const mesh = new THREE.InstancedMesh(geometry, materials, MAX_PEOPLE);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.fogged(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private crowd(key: string, assetId: string | undefined): Crowd {
    let c = this.crowds.get(key);
    if (c) return c;
    const far = this.standIn(assetId);
    c = { mesh: null, far: far ? this.instanced(far) : null, n: 0 };
    this.crowds.set(key, c);
    const crowd = c;
    this.model(assetId)?.then((root) => { crowd.mesh = this.instanced(root); }, (e) => console.warn(`${key} model failed to load`, e));
    return c;
  }

  /** Build a camp's structures: the centre, and the dwellings in a ring facing it. */
  private build(i: number, c: Snapshot['camps'][number]) {
    const g = this.defs[c.group];
    const obj = new THREE.Group();
    const entry: Camp = { obj, parts: [], charge: [] };
    this.camps[i] = entry;
    this.group.add(obj);
    // a part named `charge` (the pylon's glow band) pulses; its own material so it can
    const charges = (m: THREE.Object3D) => m.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !/^charge/.test(o.name)) return;
      const mat = (o.material as THREE.MeshStandardMaterial).clone();
      o.material = mat;
      entry.charge.push(mat);
    });
    const place = (assetId: string | undefined, x: number, z: number, heading: number, what: string) => {
      const part: Part = { near: null, far: this.standIn(assetId) };
      const put = (m: THREE.Object3D) => {
        orient(m, x, z, heading, 0);
        this.fogged(m);
        charges(m);
        obj.add(m);
      };
      if (part.far) put(part.far);
      entry.parts.push(part);
      this.model(assetId)?.then((m) => { put(m); part.near = m; this.show(part); }, (e) => console.warn(`${c.group} ${what} failed to load`, e));
      this.show(part);
    };
    place(g.centre, c.x, c.z, c.yaw, 'camp centre');
    const n = g.dwelling ? g.dwellings : 0;
    for (let k = 0; k < n; k++) {
      // spread over the back of the camp, leaving its front (toward `yaw`) open
      const a = c.yaw + Math.PI + (n > 1 ? (k / (n - 1) - 0.5) * Math.PI * 1.3 : 0);
      // ladders face the fire (a model's front is +Z)
      place(g.dwelling, c.x + Math.sin(a) * g.ring, c.z + Math.cos(a) * g.ring, a + Math.PI, 'dwelling');
    }
    this.flora?.clear(c.x, c.z, (n ? g.ring : 0) + 8);
  }

  /** Asset model when close (or when there's no stand-in), stand-in when far or still loading. */
  private show(p: Part) {
    const useNear = !!p.near && (this.near || !p.far);
    if (p.near) p.near.visible = useNear;
    if (p.far) p.far.visible = !useNear;
  }

  /** `camDist`: the colony camera's orbit distance, for the level of detail (omitted = close). */
  update(prev: Snapshot | null, cur: Snapshot, alpha: number, t: number, camDist = 0) {
    const near = camDist < (this.near ? LOD_FAR : LOD_NEAR);
    const switched = near !== this.near;
    this.near = near;
    const camps = cur.camps ?? [];
    camps.forEach((c, i) => {
      if (!this.defs[c.group]) return;
      if (!this.camps[i] && (c.met || explored(cur, c.x, c.z))) this.build(i, c);
      const e = this.camps[i];
      if (!e) return;
      if (switched) e.parts.forEach((p) => this.show(p));
      for (const m of e.charge) m.emissiveIntensity = c.gone ? 0.15 : 0.6 + 0.5 * Math.sin(t * 1.7 + i);
    });

    // people in sight, interpolated toward the current snapshot
    for (const cr of this.crowds.values()) cr.n = 0;
    const w = cur.natives;
    const pw = prev?.natives;
    for (let o = 0; o < (w?.length ?? 0); o += 5) {
      const camp = camps[w[o + 3]];
      if (!camp) continue;
      const g = this.defs[camp.group];
      if (!g) continue;
      const elder = w[o + 4] > 0;
      const cr = this.crowd(`${camp.group}:${elder ? 'elder' : 'walker'}`, elder ? g.elder : g.walker);
      const mesh = drawn(cr, near);
      if (!mesh || cr.n >= MAX_PEOPLE) continue;
      let x = w[o], z = w[o + 1], h = w[o + 2];
      // same person in the previous snapshot: the nearest one from the same camp
      if (pw) {
        let best = -1, bd = 3;
        for (let p = 0; p < pw.length; p += 5) {
          if (pw[p + 3] !== w[o + 3] || pw[p + 4] !== w[o + 4]) continue;
          const d = Math.abs(pw[p] - x) + Math.abs(pw[p + 1] - z);
          if (d < bd) { bd = d; best = p; }
        }
        if (best >= 0) {
          x = pw[best] + (x - pw[best]) * alpha; z = pw[best + 1] + (z - pw[best + 1]) * alpha;
          let dh = h - pw[best + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); h = pw[best + 2] + dh * alpha;
        }
      }
      orient(this.dummy, x, z, h, elder ? 0 : Math.abs(Math.sin(t * 5 + o)) * 0.08);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(cr.n++, this.dummy.matrix);
    }
    for (const cr of this.crowds.values()) {
      const mesh = drawn(cr, near);
      for (const m of [cr.mesh, cr.far]) {
        if (!m) continue;
        m.count = m === mesh ? cr.n : 0;
        if (m === mesh) m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Test hook: what's drawn. */
  stats() {
    let far = 0;
    for (const e of this.camps) for (const p of e?.parts ?? []) if (p.far?.visible) far++;
    for (const c of this.crowds.values()) far += c.far?.count ?? 0;
    return {
      camps: this.camps.filter(Boolean).length,
      parts: this.camps.reduce((n, e) => n + (e?.parts.filter((p) => p.near?.visible || p.far?.visible).length ?? 0), 0),
      people: [...this.crowds.values()].reduce((n, c) => n + c.n, 0),
      /** Camp parts and people drawn as stand-ins. */
      far,
      near: this.near,
    };
  }
}

/** The crowd's mesh to draw: the asset model up close, the stand-in far away; whichever exists otherwise. */
function drawn(c: Crowd, near: boolean) {
  return near ? (c.mesh ?? c.far) : (c.far ?? c.mesh);
}

function explored(s: Snapshot, x: number, z: number) {
  if (!s.fog?.length) return true;
  const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
  return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && s.fog[j * FOG_N + i] > 0;
}
