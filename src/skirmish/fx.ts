/**
 * Battle effects: projectiles that fly, muzzle flashes, soft glows, sparks, smoke, debris,
 * ground shockwaves and scorch marks. Everything is pooled in ring buffers (a new effect
 * overwrites the oldest when a pool is full) and drawn as one instanced call per pool,
 * with camera-facing soft sprites (shaders below) instead of solid spheres.
 *
 * Driven by the sim's FX events (skirmish/types FX) through `spawn()`; `update()` runs per frame.
 * Positions are world space: the region sits on a sphere centred at the origin, so "up" at
 * a point is its normalised position (gravity pulls the other way).
 */
import * as THREE from 'three';
import { placeMatrix, regionPoint } from '../world/heightGrid';
import { colonyLights } from '../world/lights';
import { E, N, R, U } from '../world/planet';
import { FX } from './types';

/** Seconds a shell is in the air (synth.ts times the shell's boom to land with it). */
export const SHELL_FLIGHT = 0.5;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- shaders ----------

/** Camera-facing quad at the instance's position, sized by the instance's scale. */
const spriteVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aAlpha;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vUv = uv;
    vCol = instanceColor;
    vAlpha = aAlpha;
    vSeed = float(gl_InstanceID) * 1.618;
    float s = length(instanceMatrix[0].xyz);
    vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    c.xy += position.xy * s;
    gl_Position = projectionMatrix * c;
    #include <logdepthbuf_vertex>
  }`;
/** Additive glow: a hot white core inside a soft coloured halo. */
const glowFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float halo = exp(-r * r * 4.5) - 0.011;
    float core = smoothstep(0.42, 0.0, r);
    vec3 c = vCol * halo + core * core * max(max(vCol.r, vCol.g), vCol.b) * 0.8;
    gl_FragColor = vec4(c, 1.0);
  }`;
/** Smoke and dust: a lumpy soft puff with per-instance alpha (normal blending). */
const smokeFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float lump = 0.14 * sin(p.x * 11.0 + vSeed) * sin(p.y * 9.0 - vSeed * 1.7) + 0.08 * sin((p.x + p.y) * 17.0 + vSeed * 2.3);
    float a = smoothstep(1.0, 0.25, r + lump) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol * (1.0 - 0.35 * r), a);
  }`;
/** Streaks (tracers, bolts, beams): crossed ribbons, bright along the middle and toward the head. */
const streakVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vUv = uv;
    vCol = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const streakFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    #include <logdepthbuf_fragment>
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = mix(0.2, 1.0, vUv.y * vUv.y);
    float core = smoothstep(0.55, 1.0, across);
    vec3 c = (vCol * across * across + core * max(max(vCol.r, vCol.g), vCol.b) * 0.9) * along;
    gl_FragColor = vec4(c, 1.0);
  }`;
/** Scorch: darkens what's under it (dst × src), soft-edged. */
const scorchFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0 + 0.1 * sin(atan(p.y, p.x) * 7.0 + vSeed);
    float a = smoothstep(1.0, 0.3, r) * vAlpha;
    gl_FragColor = vec4(vec3(1.0 - 0.7 * a), 1.0);
  }`;
const flatVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vUv = uv; vAlpha = aAlpha; vSeed = float(gl_InstanceID) * 2.399;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

/** Two crossed ribbons from z = 0 (tail, uv.y 0) to z = −1 (head, uv.y 1), 1 wide. */
function streakGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, -1, -0.5, 0, -1,
    0, -0.5, 0, 0, 0.5, 0, 0, 0.5, -1, 0, -0.5, -1,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, alpha: boolean) {
  if (alpha) geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color(0, 0, 0));
  m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

const additive = (vertexShader: string, fragmentShader: string) => new THREE.ShaderMaterial({
  vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
});

// ---------- particles (sprites that move) ----------

class Particles {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private next = 0;
  private hi = -1;
  private pos: Float32Array; private vel: Float32Array;
  private life: Float32Array; private max: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private a0: Float32Array;
  private rgb: Float32Array;
  private alpha: THREE.InstancedBufferAttribute | null;
  constructor(mat: THREE.Material, n: number, private glow: boolean) {
    this.n = n;
    this.mesh = instanced(new THREE.PlaneGeometry(1, 1), mat, n, !glow);
    this.alpha = glow ? null : this.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.a0 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
  }
  /** One particle at p moving at v (world units/s); size grows s0 → s1; `grav` pulls down, `drag` slows it. */
  add(p: THREE.Vector3, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c: THREE.Color, grav = 0, drag = 0, a0 = 1) {
    const j = this.next; this.next = (j + 1) % this.n;
    this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y; this.pos[j * 3 + 2] = p.z;
    this.vel[j * 3] = vx; this.vel[j * 3 + 1] = vy; this.vel[j * 3 + 2] = vz;
    this.life[j] = this.max[j] = life;
    this.s0[j] = s0; this.s1[j] = s1; this.grav[j] = grav; this.drag[j] = drag; this.a0[j] = a0;
    this.rgb[j * 3] = c.r; this.rgb[j * 3 + 1] = c.g; this.rgb[j * 3 + 2] = c.b;
    if (j > this.hi) this.hi = j;
  }
  update(dt: number) {
    if (this.hi < 0) return;
    const M = this.mesh.instanceMatrix.array as Float32Array, C = this.mesh.instanceColor!.array as Float32Array;
    const A = this.alpha?.array as Float32Array | undefined;
    let hi = -1;
    for (let j = 0; j <= this.hi; j++) {
      const o = j * 16;
      if (this.life[j] <= 0) { if (M[o] !== 0) { M[o] = M[o + 5] = M[o + 10] = 0; } continue; }
      this.life[j] -= dt;
      const k = Math.max(0, this.life[j] / this.max[j]);
      const i3 = j * 3;
      let px = this.pos[i3], py = this.pos[i3 + 1], pz = this.pos[i3 + 2];
      let vx = this.vel[i3], vy = this.vel[i3 + 1], vz = this.vel[i3 + 2];
      const g = this.grav[j];
      if (g) {
        const il = g * dt / Math.hypot(px, py, pz);
        vx -= px * il; vy -= py * il; vz -= pz * il;
      }
      const d = this.drag[j];
      if (d) { const f = Math.max(0, 1 - d * dt); vx *= f; vy *= f; vz *= f; }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      this.pos[i3] = px; this.pos[i3 + 1] = py; this.pos[i3 + 2] = pz;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      const s = k <= 0 ? 0 : this.s0[j] + (this.s1[j] - this.s0[j]) * Math.sqrt(1 - k);
      M[o] = M[o + 5] = M[o + 10] = s; M[o + 15] = 1;
      M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz;
      if (this.glow) {
        const f = k * k * this.a0[j];
        C[i3] = this.rgb[i3] * f; C[i3 + 1] = this.rgb[i3 + 1] * f; C[i3 + 2] = this.rgb[i3 + 2] * f;
      } else {
        C[i3] = this.rgb[i3]; C[i3 + 1] = this.rgb[i3 + 1]; C[i3 + 2] = this.rgb[i3 + 2];
        // a quick fade in, then out
        A![j] = this.a0[j] * k * Math.min(1, (1 - k) * 8);
      }
      if (this.life[j] > 0) hi = j;
    }
    this.hi = hi;
    this.mesh.count = hi + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.alpha) this.alpha.needsUpdate = true;
  }
}

// ---------- the layer ----------

/** What a projectile does when it lands. */
const enum Hit { None, Bolt, Cannon, Pd, Spit, Shell, Mote }

export class BattleFx {
  readonly group = new THREE.Group();
  private glows: Particles;
  private smoke: Particles;
  /** Static streaks (beams, rails, arcs, slashes) that fade where they are. */
  private beams: THREE.InstancedMesh;
  private beamLife = new Float32Array(400); private beamMax = new Float32Array(400); private beamRgb = new Float32Array(400 * 3);
  private beamNext = 0; private beamHi = -1;
  /** Projectiles in flight: world start/end, arc height, timing, streak length, look, what happens on landing. */
  private bolts: THREE.InstancedMesh;
  private nB = 500;
  private bP = new Float32Array(this.nB * 6); private bT = new Float32Array(this.nB); private bDur = new Float32Array(this.nB);
  private bArc = new Float32Array(this.nB); private bLen = new Float32Array(this.nB); private bW = new Float32Array(this.nB);
  private bRgb = new Float32Array(this.nB * 3); private bHit = new Uint8Array(this.nB); private bLive = new Uint8Array(this.nB);
  private bNext = 0; private bHi = -1;
  /** Ground rings (shockwaves) and scorch marks: region position, growth, life. */
  private rings: THREE.InstancedMesh;
  private scorch: THREE.InstancedMesh;
  private nR = 120;
  private rX = new Float32Array(this.nR); private rZ = new Float32Array(this.nR); private rS = new Float32Array(this.nR);
  private rLife = new Float32Array(this.nR); private rMax = new Float32Array(this.nR); private rRgb = new Float32Array(this.nR * 3);
  private rNext = 0; private rHi = -1;
  private nS = 160;
  private sNext = 0;
  private sLife = new Float32Array(this.nS); private sMax = new Float32Array(this.nS); private sHi = -1;

  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private upv = new THREE.Vector3(); private v4 = new THREE.Vector3(); private v5 = new THREE.Vector3(); private m = new THREE.Matrix4(); private c = new THREE.Color();
  /** Fewer particles per effect (phones, or a huge battle). */
  detail = 1;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    this.glows = new Particles(additive(spriteVert, glowFrag), 2200, true);
    this.smoke = new Particles(new THREE.ShaderMaterial({
      vertexShader: spriteVert, fragmentShader: smokeFrag, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    }), 900, false);
    this.smoke.mesh.renderOrder = 1;
    this.glows.mesh.renderOrder = 2;
    this.beams = instanced(streakGeometry(), additive(streakVert, streakFrag), 400, false);
    this.bolts = instanced(streakGeometry(), additive(streakVert, streakFrag), this.nB, false);
    this.rings = instanced(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    }), this.nR, false);
    this.scorch = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: flatVert, fragmentShader: scorchFrag, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), this.nS, true);
    this.scorch.renderOrder = -1;
    this.group.add(this.scorch, this.rings, this.smoke.mesh, this.beams, this.bolts, this.glows.mesh);
  }

  /**
   * One sim FX event. `h1`/`h2`: heights above the ground at each end (muzzle, or a flyer's altitude);
   * `organic`: a death that was a creature (splatter rather than fire).
   */
  spawn(k: number, x1: number, z1: number, x2: number, z2: number, h1: number, h2: number, organic = false) {
    const P = this.v1, Q = this.v2;
    switch (k) {
      case FX.ROVER_SHOT:
        regionPoint(x1, z1, 1.3 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.muzzle(P, Q, 0.9, COL.roverShot);
        this.bolt(P, Q, 110, 0.12, 2.2, 0.22, COL.roverShot, Hit.Bolt);
        break;
      case FX.TANK_SHOT: case FX.TURRET_SHOT:
        regionPoint(x1, z1, 1.45 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.muzzle(P, Q, 1.7, COL.tankShot, true);
        this.bolt(P, Q, 95, 0.15, 3.2, 0.42, COL.tankShot, Hit.Cannon);
        break;
      case FX.PD_SHOT:
        // a burst of three quick rounds (the sound has three ticks)
        regionPoint(x1, z1, 2.0 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.muzzle(P, Q, 0.7, COL.pd);
        for (let i = 0; i < 3; i++) this.bolt(P, Q, 150, 0.1, 1.6, 0.14, COL.pd, i === 2 ? Hit.Pd : Hit.None, -i * 0.022, 0.6);
        break;
      case FX.SPIT:
        regionPoint(x1, z1, 1.9 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.bolt(P, Q, 38, 0.45, 1.2, 0.5, COL.spit, Hit.Spit, 0, 0, 0.8 + P.distanceTo(Q) * 0.08);
        break;
      case FX.SHELL: {
        regionPoint(x1, z1, 2.4 + h1, P); regionPoint(x2, z2, 0.6 + h2, Q);
        this.muzzle(P, Q, 2.6, COL.shell, true);
        this.puffs(P, 4, 0.8, COL.smokeLight, 1.2, 0.45);
        this.bolt(P, Q, 0, SHELL_FLIGHT, 2.4, 0.5, COL.shell, Hit.Shell, 0, 0, 4 + P.distanceTo(Q) * 0.22, SHELL_FLIGHT);
        break;
      }
      case FX.ARC: {
        regionPoint(x1, z1, 1.6 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.lightning(P, Q, COL.arc, 4, 0.22);
        this.sparks(Q, 8, 9, COL.arc, 0.3, 0.16);
        this.glow(Q, 2.2, 0.2, COL.arc);
        this.glow(P, 1.2, 0.12, COL.arc);
        break;
      }
      case FX.RAIL: {
        // the whole line at once: a white-hot core, a wider glow, and a trail of motes that drifts off
        regionPoint(x1, z1, 1.7 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.beam(P, Q, 0.16, 0.28, COL.rail);
        this.beam(P, Q, 0.6, 0.5, COL.railGlow);
        const n = Math.round(Math.min(26, P.distanceTo(Q) * 0.8) * this.detail);
        for (let i = 0; i < n; i++) {
          this.v3.copy(P).lerp(Q, (i + Math.random()) / n);
          this.glows.add(this.v3, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(0.4, 0.8), 0.35, 0.9, COL.railGlow, 0, 1.5, 0.6);
        }
        this.muzzle(P, Q, 1.4, COL.rail);
        this.glow(Q, 2.4, 0.3, COL.rail);
        this.sparks(Q, 14, 16, COL.rail, 0.45, 0.2);
        this.ring(x2, z2, 3.5, 0.35, COL.railGlow);
        break;
      }
      case FX.BITE: {
        // claws: two or three short crossing slashes over the target, and a spray
        regionPoint(x2, z2, 1.2 + h2, Q);
        for (let i = 0; i < 3; i++) {
          this.upv.copy(Q).normalize();
          this.v3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).cross(this.upv).normalize().multiplyScalar(0.9);
          P.copy(Q).add(this.v3).addScaledVector(this.upv, 0.5 - i * 0.25);
          this.v3.multiplyScalar(-2).addScaledVector(this.upv, -0.4).add(P);
          this.beam(P, this.v3, 0.16, 0.18, COL.bite);
        }
        this.sparks(Q, 7, 6, COL.blood, 0.4, 0.22, 14);
        break;
      }
      case FX.REPAIR: {
        regionPoint(x1, z1, 1.6 + h1, P); regionPoint(x2, z2, 1.0 + h2, Q);
        this.beam(P, Q, 0.12, 0.35, COL.repair);
        // motes that travel the beam to the target
        for (let i = 0; i < 3; i++) this.bolt(P, Q, 26, 0.6, 0.6, 0.35, COL.repairMote, i === 0 ? Hit.Mote : Hit.None, -i * 0.1);
        break;
      }
      case FX.EMERGE: {
        regionPoint(x1, z1, 0.3, P);
        this.glow(P, 3.4, 0.6, COL.emerge, 0.6);
        this.ring(x1, z1, 6, 0.6, COL.emerge);
        this.dust(P, 14, 6, COL.dirt, 1.6, 2.4);
        this.debris(P, 12, 9, COL.clod, 1.0);
        this.mark(x1, z1, 3.4, 10);
        break;
      }
      case FX.SHIELD:
        regionPoint(x1, z1, 1 + h1, P);
        this.glow(P, 3.2, 0.4, COL.shield);
        this.glow(P, 1.4, 0.15, COL.white, 0.6);
        this.sparks(P, 6, 10, COL.shield, 0.3, 0.16);
        break;
      case FX.CORE_HIT:
        regionPoint(x1, z1, 1, P);
        this.glow(P, 1.8, 0.25, COL.coreHit);
        this.sparks(P, 5, 8, COL.coreHit, 0.3, 0.16);
        break;
      case FX.DIE_SMALL: case FX.DIE_BIG: {
        const big = k === FX.DIE_BIG, s = big ? 1.8 : 1;
        regionPoint(x1, z1, 0.9 + h1, P);
        if (organic) {
          // a creature: a wet burst and spatter, no fire
          this.glow(P, 2.4 * s, 0.3, COL.ichor, 0.6);
          this.sparks(P, 14 * s, 9 * s, COL.ichor, 0.6, 0.3, 18);
          this.dust(P, 5 * s, 2 * s, COL.ichorMist, 1.2 * s, 1.0);
          this.ring(x1, z1, 3.5 * s, 0.4, COL.ichor);
          this.mark(x1, z1, 1.6 * s, 7, 0.55);
          break;
        }
        this.glow(P, 3.6 * s, 0.35 * s, COL.fireball);
        this.glow(P, 1.8 * s, 0.14 * s, COL.white, 0.9);
        this.sparks(P, 18 * s, 14 * s, COL.spark, 0.7, 0.26, 16);
        this.debris(P, 8 * s, 8 * s, COL.debris, 1.1);
        this.dust(P, 6 * s, 1.6 * s, COL.smokeDark, 1.6 * s, 1.6 + s);
        this.ring(x1, z1, 5 * s, 0.45 * s, COL.dieSmall);
        this.mark(x1, z1, 1.8 * s, 12);
        if (big) {
          // secondary pops around it
          for (let i = 0; i < 3; i++) {
            this.v3.set(rnd(-1.4, 1.4), rnd(0, 1.2), rnd(-1.4, 1.4)).add(P);
            this.glows.add(this.v3, 0, 0, 0, rnd(0.3, 0.5), 0.4, rnd(2, 3), COL.fireball, 0, 0, 1);
          }
        }
        break;
      }
    }
  }

  // ---------- per frame ----------

  update(dt: number) {
    this.updateBolts(dt);
    this.updateBeams(dt);
    this.updateRings(dt);
    this.updateScorch(dt);
    this.glows.update(dt);
    this.smoke.update(dt);
  }

  private updateBolts(dt: number) {
    if (this.bHi < 0) return;
    const M = this.bolts.instanceMatrix.array as Float32Array, C = this.bolts.instanceColor!.array as Float32Array;
    let hi = -1;
    for (let j = 0; j <= this.bHi; j++) {
      if (!this.bLive[j]) continue;
      this.bT[j] += dt;
      const t = this.bT[j], dur = this.bDur[j];
      if (t >= dur) {
        this.bLive[j] = 0;
        this.zero(M, j);
        this.boltPoint(j, 1, this.v1);
        this.land(this.bHit[j], this.v1, j);
        continue;
      }
      hi = j;
      if (t < 0) { this.zero(M, j); continue; } // not fired yet (a burst's later rounds)
      const k = t / dur;
      this.boltPoint(j, k, this.v2);
      const span = this.v3.set(this.bP[j * 6 + 3] - this.bP[j * 6], this.bP[j * 6 + 4] - this.bP[j * 6 + 1], this.bP[j * 6 + 5] - this.bP[j * 6 + 2]).length() + this.bArc[j];
      this.boltPoint(j, Math.max(0, k - this.bLen[j] / Math.max(0.01, span)), this.v1);
      this.streakMatrix(this.v1, this.v2, this.bW[j]);
      this.m.toArray(M, j * 16);
      C[j * 3] = this.bRgb[j * 3]; C[j * 3 + 1] = this.bRgb[j * 3 + 1]; C[j * 3 + 2] = this.bRgb[j * 3 + 2];
      // a shell trails smoke
      if (this.bHit[j] === Hit.Shell && Math.random() < dt * 40 * this.detail) this.smoke.add(this.v2, 0, 0, 0, 0.7, 0.4, 1.2, COL.smokeLight, 0, 0, 0.35);
    }
    this.bHi = hi;
    this.bolts.count = hi + 1;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.bolts.instanceColor!.needsUpdate = true;
  }

  /** Where projectile j is at k (0..1): along the line, lifted by its arc. */
  private boltPoint(j: number, k: number, out: THREE.Vector3) {
    const o = j * 6, b = this.bP;
    out.set(b[o] + (b[o + 3] - b[o]) * k, b[o + 1] + (b[o + 4] - b[o + 1]) * k, b[o + 2] + (b[o + 5] - b[o + 2]) * k);
    const a = this.bArc[j];
    if (a) {
      const l = out.length();
      out.multiplyScalar((l + a * 4 * k * (1 - k)) / l);
    }
    return out;
  }

  private land(hit: Hit, p: THREE.Vector3, j: number) {
    const col = this.c.setRGB(this.bRgb[j * 3], this.bRgb[j * 3 + 1], this.bRgb[j * 3 + 2]);
    switch (hit) {
      case Hit.Bolt:
        this.glow(p, 1.3, 0.14, col);
        this.sparks(p, 5, 7, col, 0.22, 0.12);
        break;
      case Hit.Cannon:
        this.glow(p, 2.4, 0.22, col);
        this.glow(p, 1.0, 0.1, COL.white, 0.7);
        this.sparks(p, 9, 11, COL.spark, 0.4, 0.16, 12);
        this.dust(p, 2, 0.8, COL.smokeLight, 1.0, 0.9);
        break;
      case Hit.Pd:
        this.glow(p, 1.0, 0.1, col);
        this.sparks(p, 4, 8, col, 0.2, 0.1);
        break;
      case Hit.Spit:
        this.glow(p, 1.8, 0.3, col, 0.7);
        this.sparks(p, 10, 6, col, 0.5, 0.2, 14);
        this.dust(p, 3, 1, COL.acidMist, 1.1, 1.2);
        break;
      case Hit.Mote:
        this.glow(p, 1.2, 0.25, col);
        this.sparks(p, 3, 3, col, 0.4, 0.14, -2);
        break;
      case Hit.Shell: {
        this.glow(p, 6, 0.5, COL.fireball);
        this.glow(p, 2.6, 0.16, COL.white, 0.9);
        this.sparks(p, 22, 16, COL.spark, 0.8, 0.24, 16);
        this.debris(p, 10, 10, COL.clod, 1.2);
        this.dust(p, 9, 3, COL.smokeDark, 2.4, 2.4);
        const { x, z } = this.regionOf(p);
        this.ring(x, z, 9, 0.5, COL.shell);
        this.mark(x, z, 3, 14);
        colonyLights?.fx(FX.SHELL, x, z, x, z);
        break;
      }
    }
  }

  private updateBeams(dt: number) {
    if (this.beamHi < 0) return;
    const C = this.beams.instanceColor!.array as Float32Array, M = this.beams.instanceMatrix.array as Float32Array;
    let hi = -1;
    for (let j = 0; j <= this.beamHi; j++) {
      if (this.beamLife[j] <= 0) continue;
      this.beamLife[j] -= dt;
      const k = Math.max(0, this.beamLife[j] / this.beamMax[j]), f = k * k * 1.4;
      C[j * 3] = this.beamRgb[j * 3] * f; C[j * 3 + 1] = this.beamRgb[j * 3 + 1] * f; C[j * 3 + 2] = this.beamRgb[j * 3 + 2] * f;
      if (this.beamLife[j] > 0) hi = j; else this.zero(M, j);
    }
    this.beamHi = hi;
    this.beams.count = hi + 1;
    this.beams.instanceColor!.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  private updateRings(dt: number) {
    if (this.rHi < 0) return;
    const C = this.rings.instanceColor!.array as Float32Array;
    let hi = -1;
    for (let j = 0; j <= this.rHi; j++) {
      if (this.rLife[j] <= 0) continue;
      this.rLife[j] -= dt;
      const k = Math.max(0, this.rLife[j] / this.rMax[j]);
      const s = this.rS[j] * (0.15 + 0.85 * Math.sqrt(1 - k));
      placeMatrix(this.rX[j], this.rZ[j], 0, 0.45, s, this.m);
      if (k <= 0) this.m.makeScale(0, 0, 0);
      this.rings.setMatrixAt(j, this.m);
      const f = k * k * k * 0.55;
      C[j * 3] = this.rRgb[j * 3] * f; C[j * 3 + 1] = this.rRgb[j * 3 + 1] * f; C[j * 3 + 2] = this.rRgb[j * 3 + 2] * f;
      if (k > 0) hi = j;
    }
    this.rHi = hi;
    this.rings.count = hi + 1;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor!.needsUpdate = true;
  }

  private updateScorch(dt: number) {
    if (this.sHi < 0) return;
    const A = (this.scorch.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute);
    let hi = -1;
    for (let j = 0; j <= this.sHi; j++) {
      if (this.sLife[j] <= 0) continue;
      this.sLife[j] -= dt;
      const k = Math.max(0, this.sLife[j] / this.sMax[j]);
      // full for most of its life, fading over the last third
      (A.array as Float32Array)[j] = Math.min(1, k * 3) * this.sAlpha[j];
      if (k > 0) hi = j; else this.zero(this.scorch.instanceMatrix.array as Float32Array, j);
    }
    this.sHi = hi;
    this.scorch.count = hi + 1;
    A.needsUpdate = true;
    this.scorch.instanceMatrix.needsUpdate = true;
  }
  private sAlpha = new Float32Array(this.nS);

  // ---------- building blocks ----------

  private zero(M: Float32Array, j: number) { const o = j * 16; M[o] = M[o + 1] = M[o + 2] = M[o + 4] = M[o + 5] = M[o + 6] = M[o + 8] = M[o + 9] = M[o + 10] = 0; }

  /** Matrix for a streak from a to b, w wide (crossed ribbons along a → b). */
  private streakMatrix(a: THREE.Vector3, b: THREE.Vector3, w: number) {
    const len = a.distanceTo(b);
    if (len < 1e-3) return this.m.makeScale(0, 0, 0);
    this.m.lookAt(a, b, this.upv.copy(a).normalize());
    this.m.scale(this.v3.set(w, w, len));
    return this.m.setPosition(a);
  }

  private glow(p: THREE.Vector3, size: number, life: number, c: THREE.Color, a = 1) {
    this.glows.add(p, 0, 0, 0, life, size * 0.45, size, c, 0, 0, a);
  }

  /** The flash at a gun's mouth, pushed a little toward the target; `smoke` adds a puff. */
  private muzzle(p: THREE.Vector3, q: THREE.Vector3, size: number, c: THREE.Color, smoke = false) {
    this.v3.copy(q).sub(p).normalize();
    const d = this.v3;
    const mx = p.x + d.x * 0.5, my = p.y + d.y * 0.5, mz = p.z + d.z * 0.5;
    this.upv.set(mx, my, mz);
    this.glows.add(this.upv, d.x * 3, d.y * 3, d.z * 3, 0.07, size * 0.6, size, c, 0, 0, 1.2);
    this.glows.add(this.upv, 0, 0, 0, 0.05, size * 0.3, size * 0.5, COL.white, 0, 0, 0.8);
    if (smoke && this.detail > 0.5) this.smoke.add(this.upv, d.x * 2, d.y * 2 + 0.3, d.z * 2, 0.6, size * 0.4, size * 1.3, COL.smokeLight, 0, 2, 0.35);
  }

  /** A projectile from p to q: `speed` u/s (or `fixed` seconds), streak `len` long and `w` wide. */
  private bolt(p: THREE.Vector3, q: THREE.Vector3, speed: number, maxDur: number, len: number, w: number, c: THREE.Color, hit: Hit, delay = 0, spread = 0, arc = 0, fixed = 0) {
    const j = this.bNext; this.bNext = (j + 1) % this.nB;
    const o = j * 6;
    this.bP[o] = p.x; this.bP[o + 1] = p.y; this.bP[o + 2] = p.z;
    this.bP[o + 3] = q.x + (spread ? rnd(-spread, spread) : 0); this.bP[o + 4] = q.y + (spread ? rnd(-spread, spread) : 0); this.bP[o + 5] = q.z + (spread ? rnd(-spread, spread) : 0);
    // fast enough that the shot lands about when the sim says it hit
    this.bDur[j] = fixed || Math.max(0.03, Math.min(maxDur, p.distanceTo(q) / speed));
    this.bT[j] = delay;
    this.bArc[j] = arc; this.bLen[j] = len; this.bW[j] = w;
    this.bRgb[j * 3] = c.r; this.bRgb[j * 3 + 1] = c.g; this.bRgb[j * 3 + 2] = c.b;
    this.bHit[j] = hit; this.bLive[j] = 1;
    if (j > this.bHi) this.bHi = j;
  }

  /** A streak that stays put and fades. */
  private beam(a: THREE.Vector3, b: THREE.Vector3, w: number, life: number, c: THREE.Color) {
    const j = this.beamNext; this.beamNext = (j + 1) % this.beamLife.length;
    this.streakMatrix(a, b, w);
    this.beams.setMatrixAt(j, this.m);
    this.beamLife[j] = this.beamMax[j] = life;
    this.beamRgb[j * 3] = c.r; this.beamRgb[j * 3 + 1] = c.g; this.beamRgb[j * 3 + 2] = c.b;
    if (j > this.beamHi) this.beamHi = j;
  }

  /** A jagged bolt of `segs` segments with a short fork. */
  private lightning(p: THREE.Vector3, q: THREE.Vector3, c: THREE.Color, segs: number, life: number) {
    const len = p.distanceTo(q), jit = Math.min(1.6, len * 0.12);
    const a = this.v4.copy(p), b = this.v5;
    for (let i = 1; i <= segs; i++) {
      b.copy(p).lerp(q, i / segs);
      if (i < segs) b.add(this.v3.set(rnd(-jit, jit), rnd(-jit, jit), rnd(-jit, jit)));
      this.beam(a, b, 0.2, life, c);
      this.beam(a, b, 0.07, life * 0.7, COL.white);
      if (i === 2) {
        const f = this.v3.set(rnd(-jit, jit), rnd(-jit, jit), rnd(-jit, jit)).multiplyScalar(1.4).add(b);
        this.beam(b, f, 0.12, life * 0.6, c);
      }
      a.copy(b);
    }
  }

  /** Hot sparks flung out (they fall); `up` biases them upward. */
  private sparks(p: THREE.Vector3, n: number, speed: number, c: THREE.Color, life: number, size: number, grav = 10, up = 0.4) {
    n = Math.round(n * this.detail);
    this.upv.copy(p).normalize();
    for (let i = 0; i < n; i++) {
      this.v3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().addScaledVector(this.upv, up).multiplyScalar(speed * rnd(0.4, 1));
      this.glows.add(p, this.v3.x, this.v3.y, this.v3.z, life * rnd(0.6, 1.2), size, size * 0.5, c, grav, 1.2, 1.4);
    }
  }

  /** Dark chunks thrown up that fall back. */
  private debris(p: THREE.Vector3, n: number, speed: number, c: THREE.Color, life: number) {
    n = Math.round(n * this.detail);
    this.upv.copy(p).normalize();
    for (let i = 0; i < n; i++) {
      this.v3.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().addScaledVector(this.upv, 0.8).multiplyScalar(speed * rnd(0.4, 1));
      this.smoke.add(p, this.v3.x, this.v3.y, this.v3.z, life * rnd(0.6, 1.1), rnd(0.25, 0.45), 0.2, c, 22, 0.3, 1);
    }
  }

  /** Smoke or dust billowing out and up, slowing as it goes. */
  private dust(p: THREE.Vector3, n: number, speed: number, c: THREE.Color, size: number, life: number) {
    n = Math.max(1, Math.round(n * this.detail));
    this.upv.copy(p).normalize();
    for (let i = 0; i < n; i++) {
      this.v3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.3, 1)).addScaledVector(this.upv, rnd(0.6, 1.6));
      this.smoke.add(p, this.v3.x, this.v3.y, this.v3.z, life * rnd(0.7, 1.2), size * 0.5, size * rnd(1.4, 2.2), c, -0.4, 1.6, rnd(0.3, 0.5));
    }
  }

  /** A few lingering puffs (gun smoke). */
  private puffs(p: THREE.Vector3, n: number, speed: number, c: THREE.Color, size: number, a: number) {
    this.upv.copy(p).normalize();
    for (let i = 0; i < n * this.detail; i++) this.smoke.add(p, rnd(-speed, speed) + this.upv.x, rnd(-speed, speed) + this.upv.y, rnd(-speed, speed) + this.upv.z, rnd(0.8, 1.4), size * 0.5, size * 1.8, c, 0, 1.2, a);
  }

  /** A shockwave ring on the ground at region (x, z). */
  private ring(x: number, z: number, size: number, life: number, c: THREE.Color) {
    const j = this.rNext; this.rNext = (j + 1) % this.nR;
    this.rX[j] = x; this.rZ[j] = z; this.rS[j] = size;
    this.rLife[j] = this.rMax[j] = life;
    this.rRgb[j * 3] = c.r; this.rRgb[j * 3 + 1] = c.g; this.rRgb[j * 3 + 2] = c.b;
    if (j > this.rHi) this.rHi = j;
  }

  /** A scorch mark (or stain) on the ground that fades after `life` s. */
  private mark(x: number, z: number, size: number, life: number, a = 0.8) {
    const j = this.sNext; this.sNext = (j + 1) % this.nS;
    placeMatrix(x, z, Math.random() * 6.28, 0.06, size, this.m);
    this.scorch.setMatrixAt(j, this.m);
    this.sLife[j] = this.sMax[j] = life;
    this.sAlpha[j] = a;
    if (j > this.sHi) this.sHi = j;
  }

  /** Region coordinates under a world point (inverse of regionPoint, ignoring height). */
  private regionOf(p: THREE.Vector3) { return regionXZ(p); }
}

function regionXZ(p: THREE.Vector3) {
  // regionPoint normalises U·R + E·x + N·z; so p ∝ that, and x = (p·E)/(p·U)·R, z likewise
  const pu = p.x * U.x + p.y * U.y + p.z * U.z;
  return { x: (p.x * E.x + p.y * E.y + p.z * E.z) / pu * R, z: (p.x * N.x + p.y * N.y + p.z * N.z) / pu * R };
}

const COL = {
  roverShot: new THREE.Color('#7ff8ff'), tankShot: new THREE.Color('#ffc46b'), pd: new THREE.Color('#fff07a'),
  spit: new THREE.Color('#a6ff4d'), shell: new THREE.Color('#ff9a3d'), arc: new THREE.Color('#b9a6ff'),
  rail: new THREE.Color('#f2fdff'), railGlow: new THREE.Color('#5fd8ff'), bite: new THREE.Color('#ff6a4d'), blood: new THREE.Color('#d23a2a'),
  repair: new THREE.Color('#5bff9a'), repairMote: new THREE.Color('#b8ffd2'), emerge: new THREE.Color('#c08a4a'),
  shield: new THREE.Color('#7fe8ff'), coreHit: new THREE.Color('#ff4d5e'), dieSmall: new THREE.Color('#ff8a3d'),
  fireball: new THREE.Color('#ff8a2e'), spark: new THREE.Color('#ffd28a'), white: new THREE.Color('#ffffff'),
  ichor: new THREE.Color('#9be04a'), ichorMist: new THREE.Color('#5d7a2e'), acidMist: new THREE.Color('#6f8f3a'),
  smokeDark: new THREE.Color('#3d3833'), smokeLight: new THREE.Color('#77726b'), debris: new THREE.Color('#1c1a18'),
  dirt: new THREE.Color('#7a5f43'), clod: new THREE.Color('#4a3a2a'),
};
