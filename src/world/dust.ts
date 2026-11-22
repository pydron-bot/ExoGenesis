/**
 * Dust kicked up by things moving over dry ground: drones, vehicles and creatures. Each frame the
 * caller lists what's on the map (an id, where it is, how high above the ground); anything that moved
 * since last frame faster than a walk, low enough to stir the ground, puffs out soft clouds behind it,
 * more the faster it goes. Over water (height < `wet`) it doesn't: no dust off a sea.
 *
 * A fixed pool of puffs (soft round points that grow, drift up and away, and fade over ~1.6 s), written
 * round-robin, positions kept on the CPU (a few hundred), so it costs one draw call. Lit by the day.
 */
import * as THREE from 'three';
import { regionToWorld } from './planet';

const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** The pool, and how many puffs a second a fast mover lets out at most (phones: fewer, smaller: overdraw). */
const MAX = PHONE ? 260 : 700;
const RATE = PHONE ? 9 : 22;
const PUFF = PHONE ? 0.75 : 1;
const LIFE = 1.6;

export interface Mover { id: string; x: number; z: number; lift: number }

export class Dust {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(LIFE);
  private size = new Float32Array(MAX);
  private next = 0;
  /** Whether any puff was alive last frame (no uploads while there's none). */
  private wasLive = false;
  private last = new Map<string, { x: number; z: number; acc: number }>();
  private v = new THREE.Vector3();
  private up = new THREE.Vector3();
  enabled = true;

  constructor(color: THREE.ColorRepresentation, private height: (x: number, z: number) => number, private wet = 0.3) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uLight: { value: 1 }, uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float aAge;
        attribute float aSize;
        uniform float uScale;
        varying float vA;
        void main() {
          float k = aAge / ${LIFE.toFixed(2)};
          vA = k >= 1.0 ? 0.0 : (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, k);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = k >= 1.0 ? 0.0 : aSize * (0.6 + 1.8 * sqrt(k)) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uLight;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, r) * vA * 0.55;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * uLight, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** `light` 0..1 how lit (day), `scale` the screen height / (2 tan(fov/2)). */
  update(dt: number, movers: Mover[], light: number, scale: number) {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    u.uLight.value = 0.22 + 0.78 * light;
    u.uScale.value = scale;
    if (this.enabled && dt > 0) {
      const seen = new Set<string>();
      for (const m of movers) {
        seen.add(m.id);
        const l = this.last.get(m.id);
        if (!l) { this.last.set(m.id, { x: m.x, z: m.z, acc: 0 }); continue; }
        const dx = m.x - l.x, dz = m.z - l.z;
        const speed = Math.hypot(dx, dz) / dt;
        l.x = m.x; l.z = m.z;
        // a jump (respawn, teleport) or standing still: nothing
        if (speed > 400 || speed < 1.2 || m.lift > 4) { l.acc = 0; continue; }
        if (this.height(m.x, m.z) < this.wet) continue;
        // puffs per second: more when fast, fewer when it's hovering higher
        l.acc = Math.min(6, l.acc + dt * Math.min(RATE, speed * 2.2) * (1 - m.lift / 5));
        while (l.acc >= 1) {
          l.acc -= 1;
          const back = 0.6 + Math.random() * 0.8;
          const sx = m.x - (dx / (speed * dt)) * back + (Math.random() - 0.5) * 1.4;
          const sz = m.z - (dz / (speed * dt)) * back + (Math.random() - 0.5) * 1.4;
          this.spawn(sx, sz, speed);
        }
      }
      for (const k of this.last.keys()) if (!seen.has(k)) this.last.delete(k);
    }
    // age and drift
    let live = false;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) continue;
      live = true;
      this.age[i] += dt;
      const o = i * 3, damp = Math.exp(-dt * 2.2);
      this.vel[o] *= damp; this.vel[o + 1] *= damp; this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.points.visible = live;
    if (!live && !this.wasLive) return;
    this.wasLive = live;
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAge').needsUpdate = true;
    g.getAttribute('aSize').needsUpdate = true;
  }

  private spawn(x: number, z: number, speed: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    regionToWorld(x, z, 0.4, this.v);
    this.up.copy(this.v).normalize();
    const o = i * 3;
    this.pos[o] = this.v.x; this.pos[o + 1] = this.v.y; this.pos[o + 2] = this.v.z;
    // rise and spread a little (in world units/s)
    const s = 0.6 + Math.min(1.5, speed * 0.08);
    this.vel[o] = (Math.random() - 0.5) * s + this.up.x * 0.9;
    this.vel[o + 1] = (Math.random() - 0.5) * s + this.up.y * 0.9;
    this.vel[o + 2] = (Math.random() - 0.5) * s + this.up.z * 0.9;
    this.age[i] = 0;
    this.size[i] = (1.1 + Math.random() * 1.2 + Math.min(1.5, speed * 0.06)) * PUFF;
  }
}
