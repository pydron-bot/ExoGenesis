/**
 * Stones on the ground (v0.80.0): pebbles, with now and then a bigger rock, scattered over the region so the
 * open ground between the plants isn't bare. One instanced mesh (one draw call), coloured from the ground they
 * lie on (a little darker, a few lighter), half sunk. Not on water, not on the landing pad, and hidden under
 * building pads when the ground there is levelled. Look only: the sim never sees them.
 */
import * as THREE from 'three';
import { hash01 } from '../content/nature';
import { HALF, regionColor, regionDir, regionHeightRaw, regionToWorld } from './planet';

const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Stones per 100×100 u of ground. */
const DENSITY = PHONE ? 380 : 1200;
/** Clear ground round the Core. */
const PAD = 13;

/** 0..1, smooth over ~18 u: where the ground is stony. */
function patchy(x: number, z: number, seed: number) {
  const cx = x / 18, cz = z / 18, ix = Math.floor(cx), iz = Math.floor(cz);
  const fx = cx - ix, fz = cz - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number) => hash01(seed * 131 + i * 7349, j * 2711 + 17);
  const v = (h(ix, iz) * (1 - ux) + h(ix + 1, iz) * ux) * (1 - uz) + (h(ix, iz + 1) * (1 - ux) + h(ix + 1, iz + 1) * ux) * uz;
  return Math.min(1, Math.max(0, (v - 0.3) / 0.5));
}

interface Stone { x: number; z: number; s: number; q: THREE.Quaternion; sink: number }

export class Pebbles {
  readonly mesh: THREE.InstancedMesh;
  private stones: Stone[] = [];
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private qu = new THREE.Quaternion();

  constructor(seed = 1) {
    const want = Math.round(((HALF * 2) / 100) ** 2 * DENSITY);
    const c = new THREE.Color();
    const cols: THREE.Color[] = [];
    for (let tries = 0; this.stones.length < want && tries < want * 4; tries++) {
      const k = seed * 7919 + tries;
      const x = (hash01(k, 1) * 2 - 1) * (HALF - 2), z = (hash01(k, 2) * 2 - 1) * (HALF - 2);
      if (Math.hypot(x, z) < PAD + hash01(k, 3) * 4) continue;
      if (regionHeightRaw(x, z) < 0.6) continue; // in or at the edge of water
      // in patches: stony ground and bare ground (a coarse value-noise field, ~18 u cells)
      if (hash01(k, 11) > 0.15 + 0.85 * patchy(x, z, seed)) continue;
      const big = hash01(k, 4) < 0.025;
      const s = big ? 0.7 + hash01(k, 5) * 0.9 : 0.16 + Math.pow(hash01(k, 5), 2) * 0.6;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(hash01(k, 6) * 6.28, hash01(k, 7) * 6.28, hash01(k, 8) * 6.28));
      this.stones.push({ x, z, s, q, sink: 0.3 + hash01(k, 9) * 0.25 });
      regionColor(x, z, c);
      const t = hash01(k, 10);
      cols.push(c.clone().multiplyScalar(t < 0.12 ? 1.3 : 0.42 + t * 0.4));
    }
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.scale(1, 0.62, 0.85);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true }), this.stones.length);
    this.mesh.name = 'pebbles';
    this.mesh.frustumCulled = false;
    this.stones.forEach((_, i) => { this.place(i); this.mesh.setColorAt(i, cols[i]); });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private place(i: number, hide = false) {
    const st = this.stones[i];
    regionToWorld(st.x, st.z, -st.s * st.sink, this.v);
    // lie along the ground's up, then the stone's own tumble
    this.qu.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, regionDir(st.x, st.z)).multiply(st.q);
    this.sc.setScalar(hide ? 0 : st.s);
    this.mesh.setMatrixAt(i, this.m.compose(this.v, this.qu, this.sc));
  }

  /** The ground under these pads was levelled: stones on a pad go (the building stands there), those round it settle. */
  relevel(pads: { x: number; z: number; r: number }[], fall: number) {
    if (!pads.length) return;
    let any = false;
    for (let i = 0; i < this.stones.length; i++) {
      const st = this.stones[i];
      const p = pads.find((p) => Math.abs(st.x - p.x) < p.r + fall && Math.abs(st.z - p.z) < p.r + fall);
      if (!p) continue;
      this.place(i, Math.abs(st.x - p.x) < p.r + 0.5 && Math.abs(st.z - p.z) < p.r + 0.5);
      any = true;
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  get count() { return this.stones.length; }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
