/**
 * Renders the skirmish: one instanced draw per unit type (plus a glow layer for
 * player units), selection rings, tracers, impact flashes and explosions — all
 * pooled and allocation-free per frame so hundreds of units stay cheap.
 */
import * as THREE from 'three';
import { placeMatrix, regionPoint } from '../world/heightGrid';
import { flattenForInstancing, loadModel } from '../assets/models';
import { creatureGeo, roverGeo, roverGlow, tankGeo, tankGlow, unitMaterials } from './models';
import { DEFS, FX, FX_STRIDE, MAX_UNITS, STRIDE, F, type SkSnapshot } from './types';

interface Pool { mesh: THREE.InstancedMesh; life: Float32Array; max: Float32Array; next: number; color: THREE.Color[]; size: Float32Array; pos: Float32Array }

function pool(geo: THREE.BufferGeometry, n: number): Pool {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }), n);
  mesh.frustumCulled = false;
  mesh.count = n;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, new THREE.Color(0, 0, 0)); }
  return { mesh, life: new Float32Array(n), max: new Float32Array(n), next: 0, color: Array.from({ length: n }, () => new THREE.Color()), size: new Float32Array(n), pos: new Float32Array(n * 3) };
}

const C = {
  roverShot: new THREE.Color('#7ff8ff'), tankShot: new THREE.Color('#ffc46b'), bite: new THREE.Color('#ff6a4d'),
  dieSmall: new THREE.Color('#ff8a3d'), dieBig: new THREE.Color('#ffb547'), coreHit: new THREE.Color('#ff4d5e'),
  glow: new THREE.Color('#5ff3ff'), glowSel: new THREE.Color('#ffd27a'), white: new THREE.Color('#e9eef2'), hurt: new THREE.Color('#ff5a4a'),
};

export class ArmyView {
  /** Interpolated per-slot world positions this frame (for screen-space picking). */
  readonly wx = new Float32Array(MAX_UNITS);
  readonly wy = new Float32Array(MAX_UNITS);
  readonly wz = new Float32Array(MAX_UNITS);
  readonly lx = new Float32Array(MAX_UNITS);
  readonly lz = new Float32Array(MAX_UNITS);
  readonly visible = new Uint8Array(MAX_UNITS);
  readonly type = new Uint8Array(MAX_UNITS);
  slots = 0;
  private bodies: THREE.InstancedMesh[] = [];
  private glows: (THREE.InstancedMesh | null)[] = [];
  private rings: THREE.InstancedMesh;
  private tracers: Pool;
  private flashes: Pool;
  private lastTick = -1;
  private m = new THREE.Matrix4();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private up = new THREE.Vector3();
  private col = new THREE.Color();
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const geos = [roverGeo(), tankGeo(), creatureGeo(false), creatureGeo(true)];
    const mats = unitMaterials();
    for (let t = 0; t < 4; t++) {
      const im = new THREE.InstancedMesh(geos[t], mats[t], MAX_UNITS);
      im.count = 0;
      im.frustumCulled = false;
      if (t < 2) im.setColorAt(0, C.white);
      this.group.add(im);
      this.bodies.push(im);
      if (t < 2) {
        const g = new THREE.InstancedMesh(t === 0 ? roverGlow() : tankGlow(), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), MAX_UNITS);
        g.count = 0;
        g.frustumCulled = false;
        g.setColorAt(0, C.glow);
        this.group.add(g);
        this.glows.push(g);
      } else this.glows.push(null);
    }
    // asset models replace the built-in meshes once loaded (the glow strips belong to the built-ins)
    DEFS.forEach((d, t) => {
      if (!d.model) return;
      loadModel(d.model).then((root) => {
        const { geometry, materials } = flattenForInstancing(root);
        const body = this.bodies[t];
        body.geometry.dispose();
        body.geometry = geometry;
        body.material = materials;
        const g = this.glows[t];
        if (g) { this.group.remove(g); g.geometry.dispose(); this.glows[t] = null; }
      }, (e) => console.warn(`unit model ${d.model!.file} failed to load; keeping the built-in`, e));
    });
    const ring = new THREE.RingGeometry(1.5, 1.85, 24).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false }), MAX_UNITS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.group.add(this.rings);

    this.tracers = pool(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5), 900);
    this.flashes = pool(new THREE.IcosahedronGeometry(1, 1), 500);
    this.group.add(this.tracers.mesh, this.flashes.mesh);
  }

  update(prev: SkSnapshot, cur: SkSnapshot, alpha: number, selected: Map<number, number>, dt: number) {
    const a = prev.units, b = cur.units;
    const counts = [0, 0, 0, 0];
    let rings = 0;
    this.slots = cur.slots;
    const prevSlots = prev.slots;
    for (let s = 0; s < cur.slots; s++) {
      const o = s * STRIDE;
      this.visible[s] = 0;
      if (!b[o + F.ALIVE]) continue;
      const t = b[o + F.TYPE];
      let x = b[o], z = b[o + 1], h = b[o + 2];
      if (s < prevSlots && a[o + F.ALIVE] && a[o + F.GEN] === b[o + F.GEN]) {
        x = a[o] + (x - a[o]) * alpha;
        z = a[o + 1] + (z - a[o + 1]) * alpha;
        let dh = h - a[o + 2];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        h = a[o + 2] + dh * alpha;
      }
      const scale = DEFS[t].scale;
      placeMatrix(x, z, h, 0, scale, this.m);
      const i = counts[t]++;
      this.bodies[t].setMatrixAt(i, this.m);
      this.lx[s] = x; this.lz[s] = z;
      this.wx[s] = this.m.elements[12]; this.wy[s] = this.m.elements[13]; this.wz[s] = this.m.elements[14];
      this.visible[s] = 1;
      this.type[s] = t;
      if (t < 2) {
        const hp = b[o + F.HP];
        this.bodies[t].setColorAt(i, this.col.copy(C.hurt).lerp(C.white, Math.min(1, hp * 1.3)));
        const g = this.glows[t];
        const sel = selected.get(s) === b[o + F.GEN];
        if (g) { g.setMatrixAt(i, this.m); g.setColorAt(i, sel ? C.glowSel : C.glow); }
        if (sel) {
          placeMatrix(x, z, 0, 0.25, DEFS[t].radius * 1.1, this.m);
          this.rings.setMatrixAt(rings++, this.m);
        }
      }
    }
    for (let t = 0; t < 4; t++) {
      const im = this.bodies[t];
      im.count = counts[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      const g = this.glows[t];
      if (g) { g.count = counts[t]; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true; }
    }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;

    if (cur.tick !== this.lastTick) {
      this.lastTick = cur.tick;
      this.spawnFx(cur.fx);
    }
    this.tickPool(this.tracers, dt, false);
    this.tickPool(this.flashes, dt, true);
  }

  private spawnFx(fx: Float32Array) {
    for (let i = 0; i < fx.length; i += FX_STRIDE) {
      const k = fx[i], x1 = fx[i + 1], z1 = fx[i + 2], x2 = fx[i + 3], z2 = fx[i + 4];
      if (k === FX.ROVER_SHOT || k === FX.TANK_SHOT || k === FX.BITE) {
        const tank = k === FX.TANK_SHOT;
        regionPoint(x1, z1, tank ? 1.45 : 1.3, this.v1);
        regionPoint(x2, z2, 1.0, this.v2);
        const len = this.v1.distanceTo(this.v2);
        if (len < 0.01) continue;
        const p = this.tracers;
        const j = p.next; p.next = (j + 1) % p.life.length;
        const w = tank ? 0.32 : k === FX.BITE ? 0.25 : 0.14;
        this.m.lookAt(this.v1, this.v2, this.up.copy(this.v1).normalize());
        this.m.scale(this.v2.set(w, w, k === FX.BITE ? Math.min(len, 1.2) : len));
        this.m.setPosition(regionPoint(x1, z1, tank ? 1.45 : 1.3, this.v1));
        p.mesh.setMatrixAt(j, this.m);
        p.life[j] = p.max[j] = tank ? 0.22 : 0.12;
        p.color[j].copy(tank ? C.tankShot : k === FX.BITE ? C.bite : C.roverShot);
        if (tank) this.flash(x2, z2, 1.0, 0.25, C.tankShot);
      } else if (k === FX.DIE_SMALL) this.flash(x1, z1, 1.3, 0.4, C.dieSmall);
      else if (k === FX.DIE_BIG) this.flash(x1, z1, 2.6, 0.6, C.dieBig);
      else if (k === FX.CORE_HIT) this.flash(x1, z1, 0.9, 0.25, C.coreHit);
    }
    if (fx.length) {
      this.tracers.mesh.instanceMatrix.needsUpdate = true;
      this.flashes.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private flash(x: number, z: number, size: number, life: number, color: THREE.Color) {
    const p = this.flashes;
    const j = p.next; p.next = (j + 1) % p.life.length;
    regionPoint(x, z, 1, this.v1);
    p.pos[j * 3] = this.v1.x; p.pos[j * 3 + 1] = this.v1.y; p.pos[j * 3 + 2] = this.v1.z;
    p.size[j] = size;
    this.m.makeScale(size * 0.4, size * 0.4, size * 0.4).setPosition(this.v1);
    p.mesh.setMatrixAt(j, this.m);
    p.life[j] = p.max[j] = life;
    p.color[j].copy(color);
  }

  private tickPool(p: Pool, dt: number, grow: boolean) {
    let any = false;
    for (let j = 0; j < p.life.length; j++) {
      if (p.life[j] <= 0) continue;
      any = true;
      p.life[j] -= dt;
      const k = Math.max(0, p.life[j] / p.max[j]);
      p.mesh.setColorAt(j, this.col.copy(p.color[j]).multiplyScalar(k * k * (grow ? 0.9 : 1.6)));
      if (grow) {
        // expand from 40% to 100% of the burst size over its life
        const sz = p.size[j] * (0.4 + 0.6 * Math.sqrt(1 - k));
        this.m.makeScale(sz, sz, sz).setPosition(p.pos[j * 3], p.pos[j * 3 + 1], p.pos[j * 3 + 2]);
        p.mesh.setMatrixAt(j, this.m);
      }
      if (p.life[j] <= 0) p.mesh.setColorAt(j, this.col.setRGB(0, 0, 0));
    }
    if (any) {
      p.mesh.instanceColor!.needsUpdate = true;
      if (grow) p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
