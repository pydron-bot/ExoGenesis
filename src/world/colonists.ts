/**
 * Colonists outdoors: small figures walking between home and work, coloured by
 * bloc so the colony's politics are visible at a glance (cyan Partners, amber
 * Autonomists, violet Devoted). Children are smaller. Indoors they aren't drawn.
 *
 * Colonists lying injured (thrown out of a fallen building) lie flat, pulsing red.
 *
 * Reads the snapshot's `people.walkers` (id, x, z, heading, bloc, flags: 1 child, 2 injured) and
 * interpolates between the previous and current snapshot by id.
 */
import * as THREE from 'three';
import type { Snapshot } from '../sim/types';
import { orient } from './region';

export const BLOC_COLORS = ['#5ff3ff', '#ffb547', '#c08bff'];
const HURT = new THREE.Color('#ff4d5e');
const MAX = 256;
const PICK_PX = 22;

function figure(): THREE.BufferGeometry {
  // body + head, merged by hand: a capsule and a sphere stacked
  const body = new THREE.CapsuleGeometry(0.26, 0.55, 2, 8);
  body.translate(0, 0.55, 0);
  const head = new THREE.SphereGeometry(0.22, 8, 6);
  head.translate(0, 1.25, 0);
  const parts = [body.toNonIndexed(), head.toNonIndexed()];
  const pos: number[] = [], nor: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute('position').array as Float32Array));
    nor.push(...(p.getAttribute('normal').array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  // a figure this small at RTS distances needs to read bigger than life
  g.scale(2.2, 2.2, 2.2);
  return g;
}

export class ColonistView {
  readonly mesh: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  /** Interpolated positions this frame: id → world position (for picking) and region x, z. */
  readonly at = new Map<number, { x: number; z: number; world: THREE.Vector3 }>();

  constructor(parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(figure(), new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 0.6, metalness: 0.1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.25,
    }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    parent.add(this.mesh);
    const ringGeo = new THREE.RingGeometry(1.0, 1.3, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    parent.add(this.ring);
  }

  update(prev: Snapshot | null, cur: Snapshot, alpha: number, selected: number | null, t: number) {
    const w = cur.people?.walkers;
    const n = Math.min(MAX, w ? w.length / 6 : 0);
    const before = new Map<number, [number, number, number]>();
    const pw = prev?.people?.walkers;
    if (pw) for (let i = 0; i < pw.length; i += 6) before.set(pw[i], [pw[i + 1], pw[i + 2], pw[i + 3]]);
    this.at.clear();
    this.ring.visible = false;
    for (let i = 0; i < n; i++) {
      const o = i * 6, id = w![o];
      let x = w![o + 1], z = w![o + 2], h = w![o + 3];
      const b = before.get(id);
      if (b && Math.hypot(b[0] - x, b[1] - z) < 4) {
        x = b[0] + (x - b[0]) * alpha; z = b[1] + (z - b[1]) * alpha;
        let dh = h - b[2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); h = b[2] + dh * alpha;
      }
      const flags = w![o + 5], child = (flags & 1) > 0, down = (flags & 2) > 0;
      // a little walking bob; the injured lie still
      orient(this.dummy, x, z, h, down ? 0.55 : 0.05 + Math.abs(Math.sin(t * 9 + id)) * 0.12);
      if (down) this.dummy.rotateX(-Math.PI / 2);
      this.dummy.scale.setScalar(child ? 0.65 : 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.set(BLOC_COLORS[w![o + 4]] ?? BLOC_COLORS[0]);
      if (down) this.color.lerp(HURT, 0.5 + 0.5 * Math.sin(t * 6 + id));
      this.mesh.setColorAt(i, this.color);
      this.at.set(id, { x, z, world: this.dummy.position.clone() });
      if (id === selected) {
        orient(this.ring, x, z, 0, 0.15);
        this.ring.visible = true;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Colonist under a screen point (client px), or -1. */
  pick(x: number, y: number, camera: THREE.Camera, rect: DOMRect) {
    let best = -1, bd = PICK_PX;
    const v = new THREE.Vector3();
    for (const [id, c] of this.at) {
      v.copy(c.world).project(camera);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - x, ((1 - v.y) / 2) * rect.height + rect.top - y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  hide() { this.mesh.visible = false; this.ring.visible = false; }
}
