/**
 * The opening cinematic: the seed-probe comes in from orbit, burns its retro
 * thrusters at full throttle into a cloud of dust, touches down, folds its six
 * shell petals out flat, and the petals dissolve (reclaimed by the core's
 * fabricators) to leave the Command Core. Then the drone bay opens and the
 * worker drone flies out to its post.
 *
 * Purely presentational: the sim is told 'burn' / 'touchdown' / 'deploy' at the
 * right moments and owns everything that matters (economy, fauna panic, when
 * the drone can take orders). Skippable at any point.
 *
 * The timeline is content (content/rules/landing.json, editor: Cinematics →
 * Landing): the beats, the camera keys (the camera passes smoothly through
 * them, PCHIP per channel) and the captions.
 */
import * as THREE from 'three';
import type { ZoomCamera } from './camera';
import { content } from './content';
import type { LandingDef } from './content/defs';
import { pchip } from './world/curve';
import type { LandingStage } from './sim/types';
import { lerp, smoothstep } from './world/noise';
import { R, regionFlora, regionDir, regionHeight, regionHeightRaw, regionToWorld, terrainColor, U } from './world/planet';
import { buildCore, orient, type RegionView } from './world/region';

// ---------- timeline (seconds; content/rules/landing.json) ----------
let L: LandingDef = content.landing;
let T_BURN = 0, T_TD = 0, T_OPEN = 0, T_POWER = 0, T_DISSOLVE = 0, T_DISSOLVED = 0, T_HATCH = 0, T_DRONE = 0, T_DRONE_POST = 0, T_END = 0;
function useTimeline(def: LandingDef) {
  L = def;
  ({ burn: T_BURN, touchdown: T_TD, open: T_OPEN, power: T_POWER, dissolve: T_DISSOLVE, reclaimed: T_DISSOLVED, hatch: T_HATCH, drone: T_DRONE, post: T_DRONE_POST, end: T_END } = def);
}
useTimeline(L);


const A0 = 2600; // entry altitude (units; ~26 km)
const H0 = 1500; // downrange offset at entry
const APPROACH = Math.PI; // comes in from the -z side, toward the drone bay
const PETALS = 6;
const RB = 10.3; // hinge apothem
const RT = 1.2; // top apothem when closed
const HS = 19; // shell height
const PL = Math.hypot(RB - RT, HS); // petal slant length
const LEAN = Math.atan2(RB - RT, HS);

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export interface LandingHooks {
  stage: (s: LandingStage) => void;
  caption: (title: string, sub: string) => void;
  done: () => void;
}

// ---------- dissolving shell material ----------

function shellMaterial(uniforms: { uDissolve: { value: number }; uCenter: { value: THREE.Vector3 } }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        uniform float uDissolve;
        uniform vec3 uCenter;
        float dh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float dvn(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dh3(i), dh3(i + vec3(1,0,0)), f.x), mix(dh3(i + vec3(0,1,0)), dh3(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh3(i + vec3(0,0,1)), dh3(i + vec3(1,0,1)), f.x), mix(dh3(i + vec3(0,1,1)), dh3(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dn = 0.65 * dvn(vWp * 0.45) + 0.35 * dvn(vWp * 1.4);
        // reclaimed from the tips inward, toward the core
        dn = mix(dn, 1.0 - clamp(distance(vWp, uCenter) / 32.0, 0.0, 1.0), 0.5);
        float thr = uDissolve * 1.12 - 0.06;
        if (dn < thr) discard;
        float edge = 1.0 - smoothstep(thr, thr + 0.06, dn);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.12, 0.75, 1.0) * edge * 1.6 * step(0.001, uDissolve);`);
  };
  mat.customProgramCacheKey = () => 'lander-shell-v1';
  return mat;
}

/** Slab of a petal in hinge space: +y up the petal, +z outward, thickness inward. */
function petalGeometry(): THREE.BufferGeometry {
  const tan30 = Math.tan(Math.PI / 6);
  const wAt = (s: number) => (RB - (RB - RT) * (s / PL)) * tan30 * 0.985;
  const T = 0.4;
  const pos: number[] = [], col: number[] = [];
  const outerBot = new THREE.Color('#2e2420'), outerTop = new THREE.Color('#b9b2a6'), inner = new THREE.Color('#8b939b'), edgeC = new THREE.Color('#5f666d');
  const quad = (a: number[], b: number[], c: number[], d: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, cd: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const k of [ca, cb, cc, ca, cc, cd]) col.push(k.r, k.g, k.b);
  };
  // a few rows so the heat-shield char gradient reads
  const rows = 4;
  for (let i = 0; i < rows; i++) {
    const s0 = (i / rows) * PL, s1 = ((i + 1) / rows) * PL;
    const w0 = wAt(s0), w1 = wAt(s1);
    const c0 = outerBot.clone().lerp(outerTop, Math.pow(i / rows, 0.6)), c1 = outerBot.clone().lerp(outerTop, Math.pow((i + 1) / rows, 0.6));
    // outer face (z = 0)
    quad([-w0, s0, 0], [w0, s0, 0], [w1, s1, 0], [-w1, s1, 0], c0, c0, c1, c1);
    // inner face (z = -T), slightly narrower
    quad([w0 - T * 0.6, s0, -T], [-w0 + T * 0.6, s0, -T], [-w1 + T * 0.6, s1, -T], [w1 - T * 0.6, s1, -T], inner, inner, inner, inner);
    // side edges
    quad([w0, s0, 0], [w0 - T * 0.6, s0, -T], [w1 - T * 0.6, s1, -T], [w1, s1, 0], edgeC, edgeC, edgeC, edgeC);
    quad([-w0 + T * 0.6, s0, -T], [-w0, s0, 0], [-w1, s1, 0], [-w1 + T * 0.6, s1, -T], edgeC, edgeC, edgeC, edgeC);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Paint a geometry one flat colour (for parts sharing the vertex-coloured shell material). */
function painted(g: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Additive cone with a hot base fading to nothing at the apex; base at y=0, apex at -h. */
function plumeGeometry(radius: number, h: number, hot: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, h, 14, 4, true);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h; // 0 base .. 1 apex
    const k = Math.pow(1 - t, 1.6);
    col.set([hot.r * k, hot.g * k * (1 - t * 0.5), hot.b * k * (1 - t)], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.rotateX(Math.PI);
  g.translate(0, -h / 2, 0);
  return g;
}

const additive = (opacity = 1) => new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
});

function glowSprite(inner: string, outer: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.3, outer);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
}

// ---------- dust ----------

/** Camera-facing soft billboards, simulated on the CPU. */
class Dust {
  readonly mesh: THREE.Mesh;
  private max = 1600;
  private n = 0;
  private p = new Float32Array(this.max * 3);
  private v = new Float32Array(this.max * 3);
  private age = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private s0 = new Float32Array(this.max);
  private s1 = new Float32Array(this.max);
  private a0 = new Float32Array(this.max);
  private iPos: THREE.InstancedBufferAttribute;
  private iSA: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  readonly uniforms = { uCol: { value: new THREE.Color() }, uLight: { value: 1 } };

  constructor(color: THREE.Color) {
    this.uniforms.uCol.value.copy(color);
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iSA = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iSA', this.iSA);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos;
        attribute vec3 iSA;
        varying vec2 vUv;
        varying float vA;
        varying float vS;
        void main() {
          vUv = uv; vA = iSA.y; vS = iSA.z;
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = iPos + (camR * position.x + camU * position.y) * iSA.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uCol;
        uniform float uLight;
        varying vec2 vUv;
        varying float vA;
        varying float vS;
        void main() {
          #include <logdepthbuf_fragment>
          float d = length(vUv - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.25, 1.0, d)) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uCol * (0.7 + 0.55 * vS) * uLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Spawn one particle at region (x, z), moving radially out from (cx, cz). */
  spawn(x: number, z: number, cx: number, cz: number, speed: number, rise: number, size0: number, size1: number, life: number, alpha: number) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const w = regionToWorld(x, z, 0.4 + Math.random() * 0.8);
    const up = regionDir(x, z);
    let dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // tangent directions at the site are close enough to E/N for a 60-unit cloud
    const out = regionToWorld(x + dx, z + dz, 0).sub(regionToWorld(x, z, 0)).normalize();
    const vel = out.multiplyScalar(speed).addScaledVector(up, rise);
    this.p.set([w.x, w.y, w.z], i * 3);
    this.v.set([vel.x, vel.y, vel.z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.iSA.array[i * 3 + 2] = Math.random();
  }

  /** Ring burst around (cx, cz). */
  burst(cx: number, cz: number, n: number, r0: number, r1: number, sp0: number, sp1: number, o: { rise?: number; size?: [number, number]; life?: [number, number]; alpha?: number } = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = lerp(r0, r1, Math.random());
      const size = o.size ?? [2.5, 12];
      const life = o.life ?? [2.5, 4.5];
      this.spawn(cx + Math.cos(a) * r, cz + Math.sin(a) * r, cx, cz, lerp(sp0, sp1, Math.random()), (o.rise ?? 3) * (0.3 + Math.random()),
        size[0] * (0.7 + Math.random() * 0.6), size[1] * (0.7 + Math.random() * 0.6), lerp(life[0], life[1], Math.random()), o.alpha ?? 0.55);
    }
  }

  update(dt: number) {
    const up = U;
    const drag = Math.exp(-dt * 1.5);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (const arr of [this.p, this.v]) arr.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
          this.iSA.array[i * 3 + 2] = this.iSA.array[j * 3 + 2];
        }
        i--;
        continue;
      }
      const k = i * 3;
      this.v[k] = this.v[k] * drag + up.x * 0.9 * dt;
      this.v[k + 1] = this.v[k + 1] * drag + up.y * 0.9 * dt;
      this.v[k + 2] = this.v[k + 2] * drag + up.z * 0.9 * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.iPos.array[k] = this.p[k]; this.iPos.array[k + 1] = this.p[k + 1]; this.iPos.array[k + 2] = this.p[k + 2];
      this.iSA.array[k] = lerp(this.s0[i], this.s1[i], 1 - (1 - t) * (1 - t));
      this.iSA.array[k + 1] = this.a0[i] * smoothstep(0, 0.12, t) * (1 - smoothstep(0.35, 1, t));
    }
    this.geo.instanceCount = this.n;
    this.iPos.needsUpdate = true;
    this.iSA.needsUpdate = true;
  }

  get live() { return this.n; }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ---------- the lander ----------

export class Landing {
  t = 0;
  done = false;
  private probe = new THREE.Group();
  private core: THREE.Group;
  private pivots: THREE.Group[] = [];
  private plumes: { inner: THREE.Mesh; outer: THREE.Mesh; flare: THREE.Sprite }[] = [];
  private light = new THREE.PointLight('#ffa860', 0, 160, 1.3);
  private sheath: THREE.Mesh;
  private trail: THREE.Mesh;
  private plasma: THREE.Sprite;
  private dust: Dust;
  private shellU = { uDissolve: { value: 0 }, uCenter: { value: new THREE.Vector3() } };
  private glows: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private hatch: THREE.Object3D;
  private sent = new Set<LandingStage>();
  private thudded = new Set<number>();
  private padH = regionHeight(0, 0);
  private lastCaption = '';
  private v = 0; // probe speed, units/s
  private alt = A0;

  /** `def`: an unsaved timeline from the editor (play test), else the content's. */
  constructor(private scene: THREE.Scene, private region: RegionView, private cam: ZoomCamera, private hooks: LandingHooks, def: LandingDef = content.landing) {
    useTimeline(def);
    this.core = buildCore();
    this.probe.add(this.core);
    this.core.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.emissiveIntensity > 0 && o.material.emissive.getHex() !== 0) {
        this.glows.push({ mat: o.material, base: o.material.emissiveIntensity });
      }
    });
    this.hatch = this.core.getObjectByName('hatch')!;

    // shell: six petals hinged at the base + a heat-shield plate underneath
    this.shellU.uCenter.value.copy(regionToWorld(0, 0, 0));
    const shellMat = shellMaterial(this.shellU);
    const petalGeo = petalGeometry();
    const nozzleGeo = painted(new THREE.CylinderGeometry(0.45, 1.0, 1.5, 10, 1, true), '#2a2d31');
    const podGeo = painted(new THREE.BoxGeometry(1.7, 2.4, 0.9), '#6e757c');
    const ribGeo = painted(new THREE.BoxGeometry(0.35, PL * 0.8, 0.25), '#4d545b');
    for (let i = 0; i < PETALS; i++) {
      const a = (i / PETALS) * Math.PI * 2 + Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = Math.PI / 2 - a;
      pivot.position.set(Math.cos(a) * RB, 0.25, Math.sin(a) * RB);
      pivot.userData.a = a;
      const petal = new THREE.Mesh(petalGeo, shellMat);
      pivot.add(petal);
      for (const x of [-1.9, 1.9]) {
        const rib = new THREE.Mesh(ribGeo, shellMat);
        rib.position.set(x * (1 - 0.1), PL * 0.45, 0.12);
        pivot.add(rib);
      }
      if (i % 2 === 1) {
        // thruster pod: nozzle points down and out
        const pod = new THREE.Mesh(podGeo, shellMat);
        pod.position.set(0, PL * 0.3, 0.45);
        pivot.add(pod);
        const noz = new THREE.Group();
        noz.position.set(0, PL * 0.3 - 1.4, 0.75);
        noz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, -0.05).normalize());
        const bell = new THREE.Mesh(nozzleGeo, shellMat);
        bell.position.y = -0.4;
        noz.add(bell);
        const inner = new THREE.Mesh(plumeGeometry(0.85, 7, new THREE.Color(1.6, 1.35, 1.0)), additive());
        const outer = new THREE.Mesh(plumeGeometry(1.7, 14, new THREE.Color(1.3, 0.55, 0.18)), additive(0.8));
        inner.position.y = outer.position.y = -1.1;
        const flare = glowSprite('rgba(255,240,210,1)', 'rgba(255,150,60,0.5)');
        flare.position.y = -1.3;
        flare.scale.setScalar(6);
        noz.add(inner, outer, flare);
        pivot.add(noz);
        this.plumes.push({ inner, outer, flare });
      }
      this.probe.add(pivot);
      this.pivots.push(pivot);
    }
    const shield = new THREE.Mesh(painted(new THREE.CylinderGeometry(RB / Math.cos(Math.PI / 6), RB / Math.cos(Math.PI / 6) * 0.96, 0.5, 6), '#2b221d'), shellMat);
    shield.rotation.y = Math.PI / 6;
    shield.position.y = 0.05;
    this.probe.add(shield);

    // entry plasma: a hot cap on the shield, a long wake behind, and a sprite that reads from far away
    const sheathGeo = new THREE.SphereGeometry(13, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    sheathGeo.scale(1, 0.45, 1);
    this.sheath = new THREE.Mesh(painted(sheathGeo, new THREE.Color(1.4, 0.6, 0.25)), additive(0));
    this.sheath.position.y = 1;
    const trailGeo = plumeGeometry(9, 1, new THREE.Color(1.1, 0.42, 0.14));
    trailGeo.rotateX(Math.PI); // apex up, base at y=0
    this.trail = new THREE.Mesh(trailGeo, additive(0));
    this.plasma = glowSprite('rgba(255,235,200,1)', 'rgba(255,120,40,0.45)');
    this.probe.add(this.sheath, this.trail, this.plasma);

    this.light.position.set(0, -2, 0);
    this.probe.add(this.light);

    const dc = terrainColor(regionHeightRaw(0, 0), regionFlora(0, 0), new THREE.Color());
    this.dust = new Dust(dc.lerp(new THREE.Color('#c9b49a'), 0.35));

    scene.add(this.probe, this.dust.mesh);
    region.core.visible = false;
    region.droneHeld = true;
    region.drone.visible = false;
    this.setPower(0.12);
    cam.freePitch = true;
    cam.overrideW = 1;
    this.frame(0, 1);
  }

  private setPower(k: number) {
    for (const g of this.glows) g.mat.emissiveIntensity = g.base * k;
  }

  /** Probe path in region terms at time t. */
  private path(t: number) {
    const u = clamp01(t / T_TD);
    const alt = A0 * Math.pow(1 - u, 3);
    const h = H0 * Math.pow(1 - u, 4);
    return { x: Math.sin(APPROACH) * h, z: Math.cos(APPROACH) * h, alt };
  }

  private pathWorld(t: number, out = new THREE.Vector3()) {
    const p = this.path(t);
    return regionDir(p.x, p.z, out).multiplyScalar(R + this.padH + p.alt);
  }

  skip() {
    if (this.done) return;
    this.t = T_END;
    this.update(0, 1);
  }

  update(dt: number, day: number) {
    if (this.done) return;
    this.t += dt;
    if (this.t >= T_END) { this.finish(); return; }
    this.frame(dt, day);
  }

  private frame(dt: number, day: number) {
    const t = this.t;
    const pos = this.pathWorld(t);
    const p = this.path(t);
    this.alt = p.alt;

    // ---- probe transform ----
    if (t < T_TD) {
      const ahead = this.pathWorld(t + 0.05);
      const vel = ahead.clone().sub(pos);
      this.v = vel.length() / 0.05;
      const site = regionDir(p.x, p.z);
      const up = vel.lengthSq() > 1e-8 ? vel.normalize().negate() : site.clone();
      up.lerp(site, smoothstep(T_TD - 2.5, T_TD - 0.2, t)).normalize();
      // keep the probe's local -z (drone bay) facing region -z once down
      const ref = regionToWorld(0, -1, 0).sub(regionToWorld(0, 0, 0)).normalize().negate();
      const fwd = ref.addScaledVector(up, -ref.dot(up)).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd);
      this.probe.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
      this.probe.position.copy(pos);
    } else {
      this.v = 0;
      orient(this.probe, 0, 0, 0, 0);
      // landing-gear settle: a small sag and rebound
      const st = t - T_TD;
      this.probe.position.addScaledVector(regionDir(0, 0), -0.35 * Math.exp(-st * 4) * Math.sin(st * 14));
    }

    // ---- entry plasma ----
    const heat = (1 - smoothstep(T_BURN - 2.6, T_BURN + 0.2, t)) * (0.6 + 0.4 * Math.sin(t * 37) * Math.sin(t * 23));
    (this.sheath.material as THREE.MeshBasicMaterial).opacity = heat;
    (this.trail.material as THREE.MeshBasicMaterial).opacity = heat * 0.5;
    this.trail.scale.set(1 - t * 0.08, 60 + 260 * (1 - smoothstep(0, T_BURN - 0.2, t)), 1 - t * 0.08);
    this.sheath.visible = this.trail.visible = heat > 0.01;
    const camDist = this.cam.camera.position.distanceTo(this.probe.position);
    this.plasma.visible = heat > 0.01;
    this.plasma.scale.setScalar(Math.max(34, camDist * 0.09) * (0.6 + heat * 0.6));
    (this.plasma.material as THREE.SpriteMaterial).opacity = heat;

    // ---- retro thrusters ----
    let throttle = 0;
    if (t >= T_BURN && t < T_TD + 0.15) {
      throttle = smoothstep(T_BURN, T_BURN + 0.5, t) * (1 - smoothstep(T_TD - 0.1, T_TD + 0.15, t));
    }
    const fl = 0.85 + Math.random() * 0.3;
    for (const pl of this.plumes) {
      pl.inner.visible = pl.outer.visible = pl.flare.visible = throttle > 0.01;
      pl.inner.scale.set(1, throttle * fl, 1);
      pl.outer.scale.set(1 + 0.1 * Math.random(), throttle * (0.9 + Math.random() * 0.25), 1 + 0.1 * Math.random());
      (pl.flare.material as THREE.SpriteMaterial).opacity = throttle;
      pl.flare.scale.setScalar(5 + 3 * fl * throttle);
    }
    this.light.intensity = throttle * 160 * fl + heat * 60;
    if (throttle > 0.01 && !this.sent.has('burn') && p.alt < 600) this.send('burn');

    // ---- dust ----
    if (throttle > 0.05 && p.alt < 90) {
      const k = throttle * Math.sqrt(1 - p.alt / 90);
      const n = Math.floor(320 * k * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 5 + p.alt * 0.25 + Math.random() * 6;
        this.dust.spawn(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.x, p.z, (16 + Math.random() * 26) * k, 1 + Math.random() * 4,
          2 + Math.random() * 2, 9 + Math.random() * 8, 2.5 + Math.random() * 2.5, 0.5);
      }
    }
    if (t >= T_TD && !this.sent.has('touchdown')) {
      this.send('touchdown');
      this.dust.burst(0, 0, 260, 9, 13, 18, 42, { rise: 4, size: [3, 14], life: [3, 5.5], alpha: 0.6 });
      this.cam.shake = 1.4;
    }

    // ---- petals fold out (with a thud), then dissolve ----
    this.pivots.forEach((pv, i) => {
      const st = clamp01((t - T_OPEN - i * 0.13) / 2.2);
      // slow release, then gravity takes over
      const k = st < 1 ? st * st * st * (st * (st * 6 - 15) + 10) * 0.25 + st * st * 0.75 : 1;
      const bounce = st >= 1 ? Math.exp(-(t - T_OPEN - i * 0.13 - 2.2) * 6) * Math.sin((t - T_OPEN - i * 0.13 - 2.2) * 18) * 0.05 : 0;
      pv.rotation.x = lerp(-LEAN, Math.PI / 2 - 0.015, Math.min(1, k)) - Math.abs(bounce);
      if (st >= 1 && !this.thudded.has(i)) {
        this.thudded.add(i);
        const a = pv.userData.a as number;
        for (let j = 0; j < 22; j++) {
          const r = RB + Math.random() * PL;
          const x = Math.cos(a) * r + (Math.random() - 0.5) * 6, z = Math.sin(a) * r + (Math.random() - 0.5) * 6;
          this.dust.spawn(x, z, Math.cos(a) * RB * 0.5, Math.sin(a) * RB * 0.5, 2 + Math.random() * 6, 1 + Math.random() * 2, 2, 7 + Math.random() * 5, 2 + Math.random() * 1.5, 0.45);
        }
        this.cam.shake = Math.max(this.cam.shake, 0.35);
      }
    });
    this.shellU.uDissolve.value = smoothstep(T_DISSOLVE, T_DISSOLVED, t);
    this.setPower(lerp(0.12, 1, smoothstep(T_POWER, T_POWER + 1.6, t)) * (t > T_POWER && t < T_POWER + 0.5 ? 0.6 + Math.random() * 0.4 : 1));

    // ---- drone bay + drone ----
    const hOpen = smoothstep(T_HATCH, T_HATCH + 1.1, t) * (1 - smoothstep(T_DRONE_POST, T_DRONE_POST + 1, t));
    this.hatch.rotation.x = lerp(0.142, -Math.PI / 2 + 0.06, hOpen);
    const drone = this.region.drone;
    if (t >= T_DRONE) {
      drone.visible = true;
      const k = clamp01((t - T_DRONE) / (T_DRONE_POST - T_DRONE));
      // slide out of the bay, then drop to hover height and glide to the post
      const zOut = lerp(-4.2, -8, smoothstep(0, 0.35, k));
      const z = lerp(zOut, -14, smoothstep(0.3, 1, k));
      const lift = lerp(2.6, 2.4 + Math.sin(t * 3) * 0.15, smoothstep(0.3, 0.8, k));
      orient(drone, 0, z, Math.PI, lift);
      this.region.droneWorld.copy(drone.position);
      if (k >= 1 && !this.sent.has('deploy')) this.send('deploy');
    }

    this.dust.uniforms.uLight.value = 0.35 + 0.75 * day;
    this.dust.update(dt);
    this.direct(t, pos);
    this.captions(t);
  }

  /**
   * Camera: through the content's keys (chase the probe down, frame the
   * unfolding, the drone bay, then the normal surface view). Each channel
   * (focus x/y/z, log distance, pitch, yaw) is a monotone cubic over the keys'
   * times; a key that looks at the probe follows it live.
   */
  private direct(t: number, probePos: THREE.Vector3) {
    const keys = L.camera, X = keys.map((k) => k.at), up = regionDir(0, 0);
    const F = keys.map((k) => (k.target === 'probe' ? probePos.clone().addScaledVector(up, k.lift) : regionToWorld(k.x ?? 0, k.z ?? 0, k.lift)));
    const f = new THREE.Vector3(pchip(X, F.map((v) => v.x), t), pchip(X, F.map((v) => v.y), t), pchip(X, F.map((v) => v.z), t));
    const ld = pchip(X, keys.map((k) => Math.log(k.dist + (k.target === 'probe' ? (k.follow ?? 0) * this.alt : 0))), t);
    const c = this.cam;
    c.focusOverride.copy(f);
    c.overrideW = 1;
    c.fx = 0; c.fz = -8;
    c.dist = c.targetDist = Math.exp(ld);
    c.pitch = c.targetPitch = pchip(X, keys.map((k) => k.pitch), t);
    c.yaw = pchip(X, keys.map((k) => k.yaw), t);
  }

  /** The caption whose time has come: {alt} km, {speed} m/s, {shield} °C filled in. */
  private captions(t: number) {
    let cap: LandingDef['captions'][number] | undefined;
    for (const c of L.captions) if (c.at <= t) cap = c;
    const km = (this.alt * 0.01).toFixed(this.alt < 100 ? 2 : 1);
    const fill = (x: string) => x.replace(/\{alt\}/g, km).replace(/\{speed\}/g, String(Math.round(this.v * 10)))
      .replace(/\{shield\}/g, String(Math.round(1400 + 900 * Math.max(0, 1 - t / Math.max(0.1, T_BURN)))));
    const title = cap ? fill(cap.title) : '', sub = cap?.sub ? fill(cap.sub) : '';
    const key = title + sub;
    if (key !== this.lastCaption) { this.lastCaption = key; this.hooks.caption(title, sub); }
  }

  private send(s: LandingStage) {
    if (this.sent.has(s)) return;
    this.sent.add(s);
    this.hooks.stage(s);
  }

  private finish() {
    this.done = true;
    this.send('touchdown');
    this.send('deploy');
    this.scene.remove(this.probe, this.dust.mesh);
    this.dust.dispose();
    this.probe.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.region.core.visible = true;
    this.region.droneHeld = false;
    this.region.drone.visible = true;
    const c = this.cam;
    c.overrideW = 0;
    c.freePitch = false;
    c.shake = 0;
    c.fx = 0; c.fz = -8;
    c.dist = c.targetDist = 75;
    c.pitch = c.targetPitch = 0.85;
    c.yaw = 0.4;
    this.hooks.done();
  }

  /** Debug: jump to a moment in the sequence. */
  seek(t: number) {
    this.t = Math.max(0, Math.min(T_END - 0.01, t));
    this.frame(0, 1);
  }

  get length() { return T_END; }
}
