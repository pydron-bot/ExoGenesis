/**
 * Renders the skirmish: one instanced draw per unit type (plus a glow layer for
 * player units), selection rings, health bars, tracers, impact flashes and
 * explosions — all pooled and allocation-free per frame so hundreds of units
 * stay cheap.
 *
 * Level of detail: asset models (the Blender set, 500–900 triangles a unit)
 * only draw when the camera is close; zoomed out, the built-in meshes (a few
 * dozen triangles) stand in, where a unit is a few pixels anyway. Measured on
 * 350 units at phone size, the models alone doubled the frame's triangles.
 */
import * as THREE from 'three';
import { placeMatrix, regionPoint, sampleRaw } from '../world/heightGrid';
import { WATER_LIFT } from '../world/water';
import { flattenForInstancing, loadModel } from '../assets/models';
import { builtinUnitLook } from './models';
import { DEFS, FX, FX_STRIDE, MAX_UNITS, STRIDE, F, type SkSnapshot } from './types';
import { colonyLights } from '../world/lights';

interface Pool { mesh: THREE.InstancedMesh; life: Float32Array; max: Float32Array; next: number; color: THREE.Color[]; size: Float32Array; pos: Float32Array }

function pool(geo: THREE.BufferGeometry, n: number): Pool {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }), n);
  mesh.frustumCulled = false;
  // only draw up to the highest live slot (tickPool / spawns keep this current); 0 = no draw
  mesh.count = 0;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, new THREE.Color(0, 0, 0)); }
  return { mesh, life: new Float32Array(n), max: new Float32Array(n), next: 0, color: Array.from({ length: n }, () => new THREE.Color()), size: new Float32Array(n), pos: new Float32Array(n * 3) };
}

/** Camera distance below which asset models draw (hysteresis: switch back beyond LOD_FAR). */
export const LOD_NEAR = 90, LOD_FAR = 105; // the colony's default view is 75, the skirmish's 150

/** Health bars: camera-facing quads drawn in one instanced call; the fill comes from aHp. */
const barVert = /* glsl */ `
  attribute float aHp;
  attribute float aTeam;
  varying vec2 vUv;
  varying float vHp;
  varying float vTeam;
  void main() {
    vUv = uv; vHp = aHp; vTeam = aTeam;
    float w = length(instanceMatrix[0].xyz);
    vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    c.xy += position.xy * vec2(w, w * 0.16);
    gl_Position = projectionMatrix * c;
  }`;
const barFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vHp;
  varying float vTeam;
  void main() {
    // dark frame, 1 px-ish inset fill
    float inX = step(0.04, vUv.x) * step(vUv.x, 0.96), inY = step(0.2, vUv.y) * step(vUv.y, 0.8);
    float f = (vUv.x - 0.04) / 0.92;
    vec3 col = vTeam > 0.5 ? vec3(1.0, 0.36, 0.29)
      : vHp > 0.6 ? vec3(0.36, 1.0, 0.6) : vHp > 0.3 ? vec3(1.0, 0.71, 0.28) : vec3(1.0, 0.35, 0.29);
    if (inX * inY > 0.5 && f <= vHp) gl_FragColor = vec4(col, 1.0);
    else gl_FragColor = vec4(0.02, 0.03, 0.05, 0.75);
  }`;

const C = {
  roverShot: new THREE.Color('#7ff8ff'), tankShot: new THREE.Color('#ffc46b'), bite: new THREE.Color('#ff6a4d'),
  dieSmall: new THREE.Color('#ff8a3d'), dieBig: new THREE.Color('#ffb547'), coreHit: new THREE.Color('#ff4d5e'),
  shell: new THREE.Color('#ff9a3d'), arc: new THREE.Color('#b9a6ff'), spit: new THREE.Color('#a6ff4d'),
  emerge: new THREE.Color('#c08a4a'), repair: new THREE.Color('#5bff9a'), pd: new THREE.Color('#fff07a'), rail: new THREE.Color('#e8fbff'),
  glow: new THREE.Color('#5ff3ff'), glowSel: new THREE.Color('#ffd27a'), white: new THREE.Color('#e9eef2'), hurt: new THREE.Color('#ff5a4a'),
};

export class ArmyView {
  /** Interpolated per-slot world positions this frame (for screen-space picking). */
  readonly wx = new Float32Array(MAX_UNITS);
  readonly wy = new Float32Array(MAX_UNITS);
  readonly wz = new Float32Array(MAX_UNITS);
  readonly lx = new Float32Array(MAX_UNITS);
  readonly lz = new Float32Array(MAX_UNITS);
  /** Interpolated heading per slot (headlights). */
  readonly hd = new Float32Array(MAX_UNITS);
  readonly visible = new Uint8Array(MAX_UNITS);
  readonly type = new Uint8Array(MAX_UNITS);
  private counts = new Int32Array(DEFS.length);
  slots = 0;
  private bodies: THREE.InstancedMesh[] = [];
  private glows: (THREE.InstancedMesh | null)[] = [];
  /** Asset model per type once loaded (drawn instead of the built-in when the camera is close). */
  private models: (THREE.InstancedMesh | null)[] = [];
  private near = true;
  private bars: THREE.InstancedMesh;
  private aHp: THREE.InstancedBufferAttribute;
  private aTeam: THREE.InstancedBufferAttribute;
  private rings: THREE.InstancedMesh;
  private tracers: Pool;
  private flashes: Pool;
  private lastTick = -1;
  private clock = 0;
  private m = new THREE.Matrix4();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private up = new THREE.Vector3();
  private col = new THREE.Color();
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    colonyLights?.addArmy(this, (t) => DEFS[t]?.team ?? 1, (t) => (DEFS[t]?.radius ?? 1) * (DEFS[t]?.scale ?? 1));
    // one instanced draw per unit type, plus a glow layer for types that have one (player vehicles)
    for (const d of DEFS) {
      const look = builtinUnitLook(d.id, d.team === 0 ? 'accord' : 'fauna');
      const im = new THREE.InstancedMesh(look.geo(), look.material(), MAX_UNITS);
      im.count = 0;
      im.frustumCulled = false;
      if (d.team === 0) im.setColorAt(0, C.white);
      this.group.add(im);
      this.bodies.push(im);
      if (look.glow) {
        const g = new THREE.InstancedMesh(look.glow(), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), MAX_UNITS);
        g.count = 0;
        g.frustumCulled = false;
        g.setColorAt(0, C.glow);
        this.group.add(g);
        this.glows.push(g);
      } else this.glows.push(null);
    }
    // asset models draw instead of the built-ins up close (the glow strips belong to the built-ins)
    this.models = DEFS.map(() => null);
    DEFS.forEach((d, t) => {
      if (!d.model) return;
      loadModel(d.model).then((root) => {
        const { geometry, materials } = flattenForInstancing(root);
        const im = new THREE.InstancedMesh(geometry, materials, MAX_UNITS);
        im.count = 0;
        im.frustumCulled = false;
        if (d.team === 0) im.setColorAt(0, C.white);
        this.group.add(im);
        this.models[t] = im;
      }, (e) => console.warn(`unit model ${d.model!.file} failed to load; keeping the built-in`, e));
    });
    const barGeo = new THREE.PlaneGeometry(1, 1);
    this.aHp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_UNITS), 1).setUsage(THREE.DynamicDrawUsage);
    this.aTeam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_UNITS), 1).setUsage(THREE.DynamicDrawUsage);
    barGeo.setAttribute('aHp', this.aHp);
    barGeo.setAttribute('aTeam', this.aTeam);
    this.bars = new THREE.InstancedMesh(barGeo, new THREE.ShaderMaterial({
      vertexShader: barVert, fragmentShader: barFrag, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }), MAX_UNITS);
    this.bars.count = 0;
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 20;
    this.group.add(this.bars);
    const ring = new THREE.RingGeometry(1.5, 1.85, 24).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false }), MAX_UNITS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.group.add(this.rings);

    this.tracers = pool(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5), 900);
    this.flashes = pool(new THREE.IcosahedronGeometry(1, 1), 500);
    this.group.add(this.tracers.mesh, this.flashes.mesh);
  }

  /**
   * `camDist`: the camera's orbit distance, for the model level of detail (omitted = always models).
   * Health bars show on damaged units and on selected ones.
   */
  update(prev: SkSnapshot, cur: SkSnapshot, alpha: number, selected: Map<number, number>, dt: number, camDist = 0) {
    const a = prev.units, b = cur.units;
    this.clock += dt;
    const counts = this.counts.fill(0);
    let rings = 0, bars = 0;
    this.near = camDist < (this.near ? LOD_FAR : LOD_NEAR);
    const near = this.near;
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
      // hover craft ride on the water (and bob a little), boats sit in it (rocking gently), others stand on the ground
      let lift = 0;
      const mv = DEFS[t].move;
      if (mv) {
        const g = sampleRaw(x, z);
        const sea = Math.max(0, WATER_LIFT - Math.max(0, g));
        lift = mv === 'hover' ? sea + 0.15 + 0.08 * Math.sin(this.clock * 2.3 + s * 1.7) : sea - 0.25 + 0.06 * Math.sin(this.clock * 1.4 + s * 2.1);
      }
      placeMatrix(x, z, h, lift, scale, this.m);
      const i = counts[t]++;
      const model = near ? this.models[t] : null;
      const body = model ?? this.bodies[t];
      body.setMatrixAt(i, this.m);
      this.lx[s] = x; this.lz[s] = z; this.hd[s] = h;
      this.wx[s] = this.m.elements[12]; this.wy[s] = this.m.elements[13]; this.wz[s] = this.m.elements[14];
      this.visible[s] = 1;
      this.type[s] = t;
      const hp = b[o + F.HP];
      const team = DEFS[t].team;
      const sel = team === 0 && selected.get(s) === b[o + F.GEN];
      if (team === 0) {
        body.setColorAt(i, this.col.copy(C.hurt).lerp(C.white, Math.min(1, hp * 1.3)));
        const g = model ? null : this.glows[t];
        if (g) { g.setMatrixAt(i, this.m); g.setColorAt(i, sel ? C.glowSel : C.glow); }
        if (sel) {
          placeMatrix(x, z, 0, 0.25, DEFS[t].radius * 1.1, this.m);
          this.rings.setMatrixAt(rings++, this.m);
        }
      }
      if (hp < 0.995 || sel) {
        const r = DEFS[t].radius;
        regionPoint(x, z, r * 1.3 + 1.6, this.v1);
        const w = Math.max(1.8, r * 2.2);
        this.m.makeScale(w, w, w).setPosition(this.v1);
        this.bars.setMatrixAt(bars, this.m);
        this.aHp.array[bars] = Math.max(0, Math.min(1, hp));
        this.aTeam.array[bars] = team;
        bars++;
      }
    }
    this.bars.count = bars;
    if (bars) { this.bars.instanceMatrix.needsUpdate = true; this.aHp.needsUpdate = true; this.aTeam.needsUpdate = true; }
    for (let t = 0; t < DEFS.length; t++) {
      const model = this.models[t];
      const useModel = near && !!model;
      const im = useModel ? model! : this.bodies[t];
      im.count = counts[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      const idle = useModel ? this.bodies[t] : model;
      if (idle) idle.count = 0;
      const g = this.glows[t];
      if (g) {
        g.count = useModel ? 0 : counts[t];
        g.instanceMatrix.needsUpdate = true;
        if (g.instanceColor) g.instanceColor.needsUpdate = true;
      }
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
      colonyLights?.fx(k, x1, z1, x2, z2);
      switch (k) {
        case FX.ROVER_SHOT: this.tracer(x1, z1, 1.3, x2, z2, 0.14, 0.12, C.roverShot); break;
        case FX.TANK_SHOT: case FX.TURRET_SHOT:
          this.tracer(x1, z1, 1.45, x2, z2, 0.32, 0.22, C.tankShot);
          this.flash(x2, z2, 1.0, 0.25, C.tankShot);
          break;
        case FX.BITE: this.tracer(x1, z1, 1.3, x2, z2, 0.25, 0.12, C.bite, 1.2); break;
        case FX.SHELL: {
          // a lobbed round: two segments up to a peak and down, then a wide burst
          const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, peak = 4 + Math.hypot(x2 - x1, z2 - z1) * 0.18;
          this.tracer(x1, z1, 2.4, mx, mz, 0.36, 0.3, C.shell, Infinity, peak);
          this.tracer(mx, mz, peak, x2, z2, 0.36, 0.3, C.shell, Infinity, 1.0);
          this.flash(x2, z2, 4.2, 0.55, C.shell);
          break;
        }
        case FX.ARC: {
          // a jagged bolt: two segments through a jittered midpoint
          const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 2.2, mz = (z1 + z2) / 2 + (Math.random() - 0.5) * 2.2;
          this.tracer(x1, z1, 1.6, mx, mz, 0.18, 0.16, C.arc, Infinity, 1.8);
          this.tracer(mx, mz, 1.8, x2, z2, 0.18, 0.16, C.arc, Infinity, 1.0);
          this.flash(x2, z2, 0.9, 0.2, C.arc);
          break;
        }
        case FX.PD_SHOT: this.tracer(x1, z1, 2.0, x2, z2, 0.1, 0.07, C.pd); break;
        case FX.RAIL:
          // the whole line at once, thin and white-hot, then a hard flash on the target
          this.tracer(x1, z1, 1.7, x2, z2, 0.12, 0.3, C.rail);
          this.flash(x2, z2, 1.6, 0.3, C.rail);
          break;
        case FX.SPIT:
          this.tracer(x1, z1, 1.9, x2, z2, 0.3, 0.3, C.spit);
          this.flash(x2, z2, 1.1, 0.35, C.spit);
          break;
        case FX.REPAIR: this.tracer(x1, z1, 1.6, x2, z2, 0.1, 0.35, C.repair); break;
        case FX.EMERGE: this.flash(x1, z1, 3.4, 0.8, C.emerge); break;
        case FX.DIE_SMALL: this.flash(x1, z1, 1.3, 0.4, C.dieSmall); break;
        case FX.DIE_BIG: this.flash(x1, z1, 2.6, 0.6, C.dieBig); break;
        case FX.CORE_HIT: this.flash(x1, z1, 0.9, 0.25, C.coreHit); break;
      }
    }
    if (fx.length) {
      this.tracers.mesh.instanceMatrix.needsUpdate = true;
      this.flashes.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** A glowing streak from (x1, z1) at height h1 to (x2, z2) at h2, `max` long at most. */
  private tracer(x1: number, z1: number, h1: number, x2: number, z2: number, w: number, life: number, color: THREE.Color, max = Infinity, h2 = 1.0) {
    regionPoint(x1, z1, h1, this.v1);
    regionPoint(x2, z2, h2, this.v2);
    const len = this.v1.distanceTo(this.v2);
    if (len < 0.01) return;
    const p = this.tracers;
    const j = p.next; p.next = (j + 1) % p.life.length;
    p.mesh.count = Math.max(p.mesh.count, j + 1);
    this.m.lookAt(this.v1, this.v2, this.up.copy(this.v1).normalize());
    this.m.scale(this.v2.set(w, w, Math.min(len, max)));
    this.m.setPosition(regionPoint(x1, z1, h1, this.v1));
    p.mesh.setMatrixAt(j, this.m);
    p.life[j] = p.max[j] = life;
    p.color[j].copy(color);
  }

  private flash(x: number, z: number, size: number, life: number, color: THREE.Color) {
    const p = this.flashes;
    const j = p.next; p.next = (j + 1) % p.life.length;
    p.mesh.count = Math.max(p.mesh.count, j + 1);
    regionPoint(x, z, 1, this.v1);
    p.pos[j * 3] = this.v1.x; p.pos[j * 3 + 1] = this.v1.y; p.pos[j * 3 + 2] = this.v1.z;
    p.size[j] = size;
    this.m.makeScale(size * 0.4, size * 0.4, size * 0.4).setPosition(this.v1);
    p.mesh.setMatrixAt(j, this.m);
    p.life[j] = p.max[j] = life;
    p.color[j].copy(color);
  }

  private tickPool(p: Pool, dt: number, grow: boolean) {
    let any = false, hi = -1;
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
      else hi = j;
    }
    p.mesh.count = hi + 1;
    if (any) {
      p.mesh.instanceColor!.needsUpdate = true;
      if (grow) p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
