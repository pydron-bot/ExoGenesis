/**
 * Inhabitant camps on the region (src/sim/inhabitants.ts): the camp's
 * structures (centre model plus a ring of dwellings facing it) once the camp
 * has been explored, and the people in sight, instanced per group and role.
 *
 * Models come from the group's record (content/inhabitants/<id>.json); until
 * they load, nothing is drawn for them. A camp the colony drove off (or that
 * left) keeps its structures, cold.
 */
import * as THREE from 'three';
import { flattenForInstancing, loadModel } from '../assets/models';
import type { AssetDef, InhabitantDef } from '../content/defs';
import { FOG_CELL, FOG_N, REGION_HALF, type Snapshot } from '../sim/types';
import { addFog } from './fog';
import type { Flora } from './flora';
import { orient } from './region';

const MAX_PEOPLE = 64;

interface Crowd { mesh: THREE.InstancedMesh | null; n: number }

export class InhabitantView {
  private group = new THREE.Group();
  /** Built camps, by index in the snapshot. */
  private camps: ({ obj: THREE.Group; cold: boolean; charge: THREE.MeshStandardMaterial[] } | null)[] = [];
  /** Instanced people: `<group>:walker` / `<group>:elder`. */
  private crowds = new Map<string, Crowd>();
  private dummy = new THREE.Object3D();

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

  private fogged(o: THREE.Object3D) {
    if (!this.fog) return;
    o.traverse((m) => { if (m instanceof THREE.Mesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) addFog(mat); });
  }

  private crowd(key: string, assetId: string | undefined): Crowd {
    let c = this.crowds.get(key);
    if (c) return c;
    c = { mesh: null, n: 0 };
    this.crowds.set(key, c);
    const crowd = c;
    this.model(assetId)?.then((root) => {
      const { geometry, materials } = flattenForInstancing(root);
      const mesh = new THREE.InstancedMesh(geometry, materials, MAX_PEOPLE);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.fogged(mesh);
      this.group.add(mesh);
      crowd.mesh = mesh;
    }, (e) => console.warn(`${key} model failed to load`, e));
    return c;
  }

  /** Build a camp's structures: the centre, and the dwellings in a ring facing it. */
  private build(i: number, c: Snapshot['camps'][number]) {
    const g = this.defs[c.group];
    const obj = new THREE.Group();
    const entry = { obj, cold: false, charge: [] as THREE.MeshStandardMaterial[] };
    this.camps[i] = entry;
    this.group.add(obj);
    const place = (m: THREE.Group, x: number, z: number, heading: number) => {
      orient(m, x, z, heading, 0);
      this.fogged(m);
      obj.add(m);
    };
    this.model(g.centre)?.then((m) => {
      // a part named `charge` (the pylon's glow band) pulses; its own material so it can
      m.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !/^charge/.test(o.name)) return;
        const mat = (o.material as THREE.MeshStandardMaterial).clone();
        o.material = mat;
        entry.charge.push(mat);
      });
      place(m, c.x, c.z, c.yaw);
    }, (e) => console.warn(`${c.group} camp centre failed to load`, e));
    const n = g.dwelling ? g.dwellings : 0;
    for (let k = 0; k < n; k++) {
      // spread over the back of the camp, leaving its front (toward `yaw`) open
      const a = c.yaw + Math.PI + (n > 1 ? (k / (n - 1) - 0.5) * Math.PI * 1.3 : 0);
      const x = c.x + Math.sin(a) * g.ring, z = c.z + Math.cos(a) * g.ring;
      // ladders face the fire (a model's front is +Z)
      this.model(g.dwelling)?.then((m) => place(m, x, z, a + Math.PI), (e) => console.warn(`${c.group} dwelling failed to load`, e));
    }
    this.flora?.clear(c.x, c.z, (n ? g.ring : 0) + 8);
  }

  update(prev: Snapshot | null, cur: Snapshot, alpha: number, t: number) {
    const camps = cur.camps ?? [];
    camps.forEach((c, i) => {
      if (!this.defs[c.group]) return;
      if (!this.camps[i] && (c.met || explored(cur, c.x, c.z))) this.build(i, c);
      const e = this.camps[i];
      if (!e) return;
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
      if (!cr.mesh || cr.n >= MAX_PEOPLE) continue;
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
      cr.mesh.setMatrixAt(cr.n++, this.dummy.matrix);
    }
    for (const cr of this.crowds.values()) {
      if (!cr.mesh) continue;
      cr.mesh.count = cr.n;
      cr.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Test hook: what's drawn. */
  stats() {
    return {
      camps: this.camps.filter(Boolean).length,
      parts: this.camps.reduce((n, e) => n + (e?.obj.children.length ?? 0), 0),
      people: [...this.crowds.values()].reduce((n, c) => n + c.n, 0),
    };
  }
}

function explored(s: Snapshot, x: number, z: number) {
  if (!s.fog?.length) return true;
  const i = Math.floor((x + REGION_HALF) / FOG_CELL), j = Math.floor((z + REGION_HALF) / FOG_CELL);
  return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && s.fog[j * FOG_N + i] > 0;
}
