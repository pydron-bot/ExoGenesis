/**
 * The ground weathers (look only: the sim never sees any of it).
 *
 *  - **Cloud shadows**: soft patches of shade drifting over the land on bodies with air. A cheap value-noise
 *    field in region coordinates, worked out per vertex in every lit material (patched in lights.ts), so it
 *    costs nothing per pixel. More cloud while it rains; none at night or without air.
 *  - **Wet ground**: rain darkens what faces up and makes it a little glossy, with puddles that mirror the sky
 *    in hollows. It soaks in over a minute or so of rain and dries over a few minutes after.
 *  - **Ground marks** (`GroundMarks`): a top-down RGBA8 texture over the region (like the light map, same
 *    mapping), drawn into and never cleared: vehicles press tread marks into it (red), creatures leave
 *    footprints (red), and wrecked buildings scorch it (blue). Every so often a full-screen pass subtracts a
 *    little from each channel, so tracks fade in about half a minute and scorches in a few minutes (game time:
 *    they wait while paused). Lit materials near the ground darken where it's marked.
 *
 * The uniforms are shared by every lit material (lights.ts merges them in); `?lights=0` leaves all of it out
 * along with the light map.
 */
import * as THREE from 'three';
import { HALF } from './planet';

const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Marks texture resolution over the 240 u region: ~0.23 u a texel on desktop, ~0.47 on phones. */
const RES = PHONE ? 512 : 1024;
const MAX_STAMPS = 1024;
/** Cloud cells are this many units across; the drift wraps after 64 cells (the noise repeats there). */
export const CLOUD_CELL = 70;
const CLOUD_WRAP = CLOUD_CELL * 64;

const rt = new THREE.WebGLRenderTarget(RES, RES, {
  type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
});

export const groundUniforms = {
  /** How much of the direct (sun) light a cloud's shadow takes away (0 = no cloud shadows). */
  uCloudK: { value: 0 },
  /** How much of the sky is cloud, 0..1. */
  uCloudCover: { value: 0.4 },
  /** The clouds' drift so far (region units, wrapped). */
  uCloudOff: { value: new THREE.Vector2() },
  /** 0 dry .. 1 soaked. */
  uWet: { value: 0 },
  /** The sky colour puddles mirror. */
  uWetSky: { value: new THREE.Color('#8fb0ad') },
  uMkTex: { value: rt.texture as THREE.Texture },
  /** Ground marks on (1) or off (0). */
  uMkOn: { value: 0 },
};

/**
 * GLSL for the vertex shader: periodic value noise (period 64 cells, so the wrapped drift has no seam) and the
 * cloud cover at a region point. `grCloud` is 0 in sun, 1 under cloud.
 */
export const GROUND_VERT_PARS = /* glsl */ `
  uniform float uCloudK, uCloudCover;
  uniform vec2 uCloudOff;
  float grHash(vec2 i) { i = mod(i, 64.0); return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
  float grNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(grHash(i), grHash(i + vec2(1.0, 0.0)), f.x), mix(grHash(i + vec2(0.0, 1.0)), grHash(i + vec2(1.0)), f.x), f.y);
  }
  float grCloud(vec2 rp) {
    vec2 p = (rp + uCloudOff) / ${CLOUD_CELL.toFixed(1)};
    float n = grNoise(p) * 0.55 + grNoise(p * 2.0 + 3.1) * 0.3 + grNoise(p * 4.0 + 7.7) * 0.15;
    float t = mix(0.72, 0.3, uCloudCover);
    return smoothstep(t - 0.07, t + 0.07, n);
  }`;

/** GLSL for the fragment shader: the puddle mask (fixed in place: hollows don't move). */
export const GROUND_FRAG_PARS = /* glsl */ `
  uniform float uWet, uMkOn;
  uniform vec3 uWetSky;
  uniform sampler2D uMkTex;
  float grHashF(vec2 i) { return fract(sin(dot(mod(i, 289.0), vec2(127.1, 311.7))) * 43758.5453); }
  float grNoiseF(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(grHashF(i), grHashF(i + vec2(1.0, 0.0)), f.x), mix(grHashF(i + vec2(0.0, 1.0)), grHashF(i + vec2(1.0)), f.x), f.y);
  }`;

// ---------- the marks texture ----------

const stampVert = /* glsl */ `
  attribute float aKind;
  attribute float aVal;
  varying vec2 vUv;
  varying float vKind;
  varying float vVal;
  varying float vAlong;
  void main() {
    vUv = position.xy;
    vKind = aKind; vVal = aVal;
    vec4 w = instanceMatrix * vec4(position, 1.0);
    // distance along the track in region units (its +y axis), so the tread pattern stays put on the ground
    vec2 dir = normalize(instanceMatrix[1].xy);
    vAlong = dot(w.xy, dir);
    gl_Position = projectionMatrix * modelViewMatrix * w;
  }`;
const stampFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vKind;
  varying float vVal;
  varying float vAlong;
  void main() {
    vec2 p = vUv;
    float x = abs(p.x);
    if (vKind < 0.5) {
      // tread pair: two bands with cross bars, soft at the edges
      float band = smoothstep(0.32, 0.45, x) * (1.0 - smoothstep(0.85, 0.98, x));
      float bars = 0.6 + 0.4 * step(0.45, fract(vAlong * 1.6));
      gl_FragColor = vec4(vVal * band * bars, 0.0, 0.0, 0.0);
    } else if (vKind < 1.5) {
      // footprints: pads alternating left and right
      float ph = fract(vAlong * 0.55);
      float side = ph < 0.5 ? -0.5 : 0.5;
      vec2 q = vec2((p.x - side) * 2.2, (fract(ph * 2.0) - 0.5) * 2.4);
      float pad = 1.0 - smoothstep(0.35, 0.8, length(q));
      gl_FragColor = vec4(vVal * pad, 0.0, 0.0, 0.0);
    } else {
      // scorched ground: a ragged soft blob
      float a = atan(p.y, p.x);
      float r = length(p) * (1.0 + 0.16 * sin(a * 5.0 + vVal * 31.0) + 0.09 * sin(a * 11.0 + vVal * 7.0));
      float w = 1.0 - smoothstep(0.45, 1.0, r);
      gl_FragColor = vec4(0.0, 0.0, fract(vVal) * w, 0.0);
    }
  }`;

/** What the movers tell the marks: per slot, where it is, how wide, and what it leaves. */
export interface MarkMover { key: number; x: number; z: number; w: number; kind: 0 | 1 }

/** Seconds of game time between fade steps (one step = 1/255): tracks and scorches. */
const FADE_TRACK = 0.25;
const FADE_SCORCH = 1.0;

export class GroundMarks {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, -10, 10);
  private stamps: THREE.InstancedMesh;
  private aKind: THREE.InstancedBufferAttribute;
  private aVal: THREE.InstancedBufferAttribute;
  private fade: THREE.Mesh;
  private fadeCol: THREE.Vector4;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);
  /** Where each mover last left a mark. */
  private last = new Map<number, { x: number; z: number }>();
  private tTrack = 0;
  private tScorch = 0;
  private fresh = true;
  private on = true;
  /** Stamps drawn last frame (tests). */
  drawn = 0;
  /** Stamps drawn since load (tests). */
  total = 0;

  constructor() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.aKind = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS), 1).setUsage(THREE.DynamicDrawUsage);
    this.aVal = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aKind', this.aKind);
    geo.setAttribute('aVal', this.aVal);
    this.stamps = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      vertexShader: stampVert, fragmentShader: stampFrag,
      // the darkest mark wins: overlapping tracks don't add up to black
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }), MAX_STAMPS);
    this.stamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stamps.frustumCulled = false;
    this.stamps.count = 0;
    this.stamps.renderOrder = 1;
    this.fadeCol = new THREE.Vector4();
    // the fade: subtract a step from every texel (8-bit targets clamp at 0)
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.ShaderMaterial({
      uniforms: { uCol: { value: this.fadeCol } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec4 uCol; void main() { gl_FragColor = uCol; }',
      blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.fade.frustumCulled = false;
    this.fade.renderOrder = 0;
    this.scene.add(this.fade, this.stamps);
    this.cam.position.z = 5;
    groundUniforms.uMkOn.value = 1;
  }

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    groundUniforms.uMkOn.value = v ? 1 : 0;
    if (!v) { this.last.clear(); this.fresh = true; }
  }

  /** A stamp from (ax, az) to (bx, bz), `w` wide: kind 0 treads, 1 footprints, 2 scorch. */
  private stamp(kind: number, ax: number, az: number, bx: number, bz: number, w: number, val: number) {
    if (this.n >= MAX_STAMPS) return;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (Math.abs(mx) > HALF + w || Math.abs(mz) > HALF + w) return;
    const len = Math.hypot(bx - ax, bz - az);
    const heading = Math.atan2(bx - ax, bz - az);
    const j = this.n++;
    this.q.setFromAxisAngle(this.zAxis, -heading);
    this.m.compose(this.p.set(mx, mz, 0), this.q, this.s.set(w, Math.max(w * 0.3, len / 2 + w * 0.15), 1));
    this.stamps.setMatrixAt(j, this.m);
    this.aKind.array[j] = kind;
    this.aVal.array[j] = val;
  }

  /** Scorch the ground under a wrecked building (`r` across, `dark` 0..1). Kept for the next update. */
  scorch(x: number, z: number, r: number, dark: number) {
    if (!this.on) return;
    // the value carries a seed in its whole part for the ragged edge (the shader takes the fraction as darkness)
    const seed = Math.floor(Math.abs(x * 3.1 + z * 7.3)) % 50;
    this.stamp(2, x, z - r, x, z + r, r, seed + Math.min(0.99, dark));
  }

  /**
   * Once a frame. `movers` are the ground units this frame (`key` stays the same for one unit); `wet(x, z)`
   * says the ground there is under water (no marks); `gdt` is game time passed (0 while paused).
   */
  update(renderer: THREE.WebGLRenderer, gdt: number, movers: MarkMover[], wet: (x: number, z: number) => boolean) {
    if (!this.on) { this.n = 0; return; }
    const seen = new Set<number>();
    for (const mv of movers) {
      seen.add(mv.key);
      const l = this.last.get(mv.key);
      if (!l) { this.last.set(mv.key, { x: mv.x, z: mv.z }); continue; }
      const d = Math.hypot(mv.x - l.x, mv.z - l.z);
      if (d > 12) { l.x = mv.x; l.z = mv.z; continue; } // a new unit in the slot, or a jump: no streak across the map
      if (d < Math.max(0.35, mv.w * 0.4)) continue;
      if (!wet(mv.x, mv.z) && !wet(l.x, l.z)) this.stamp(mv.kind, l.x, l.z, mv.x, mv.z, mv.w, mv.kind === 0 ? 0.55 : 0.4);
      l.x = mv.x; l.z = mv.z;
    }
    for (const k of this.last.keys()) if (!seen.has(k)) this.last.delete(k);
    // fade steps owed (game time)
    this.tTrack += gdt; this.tScorch += gdt;
    let fr = 0, fb = 0;
    if (this.tTrack >= FADE_TRACK) { const k = Math.floor(this.tTrack / FADE_TRACK); this.tTrack -= k * FADE_TRACK; fr = Math.min(255, k) / 255; }
    if (this.tScorch >= FADE_SCORCH) { const k = Math.floor(this.tScorch / FADE_SCORCH); this.tScorch -= k * FADE_SCORCH; fb = Math.min(255, k) / 255; }
    this.fadeCol.set(fr, 0, fb, 0);
    this.fade.visible = fr > 0 || fb > 0;
    if (!this.n && !this.fade.visible && !this.fresh) { this.drawn = 0; return; }
    this.stamps.count = this.n;
    this.drawn = this.n;
    this.total += this.n;
    this.stamps.instanceMatrix.needsUpdate = true;
    this.aKind.needsUpdate = true;
    this.aVal.needsUpdate = true;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(rt);
    if (this.fresh) {
      const c = new THREE.Color();
      renderer.getClearColor(c);
      const a = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setClearColor(c, a);
      this.fresh = false;
    }
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    this.n = 0;
  }

  /** Test hook: read the marks texture back (RGBA bytes, RES²). */
  read(renderer: THREE.WebGLRenderer) {
    const buf = new Uint8Array(RES * RES * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, RES, RES, buf);
    let r = 0, b = 0;
    for (let i = 0; i < buf.length; i += 4) { if (buf[i] > 8) r++; if (buf[i + 2] > 8) b++; }
    return { res: RES, tracked: r, scorched: b };
  }
}

/**
 * Clouds and wetness from the weather, once a frame. `gdt` game seconds passed, `air` 0..1 (none on airless
 * bodies), `day` 0 night .. 1 day, `rain` 0..1 how hard it's raining now, `overcast` 0..1.
 */
export class Sky {
  private off = new THREE.Vector2(17, -41);
  private t = 0;
  wet = 0;
  cloudShadows = true;
  /** Wet ground after rain (Options: Tracks and wet ground). */
  wetOn = true;
  /** What the shaders get now (tests). */
  get look() {
    const u = groundUniforms;
    return { cloudK: u.uCloudK.value, cover: u.uCloudCover.value, wet: u.uWet.value };
  }
  update(gdt: number, air: number, day: number, rain: number, overcast: number, sky: THREE.Color) {
    this.t += gdt;
    // a wind that turns slowly, a few units a second
    const a = 0.7 + Math.sin(this.t * 0.0031) * 0.9;
    const sp = 3.2 + Math.sin(this.t * 0.011) * 0.8;
    this.off.x = (this.off.x + Math.sin(a) * sp * gdt) % CLOUD_WRAP;
    this.off.y = (this.off.y + Math.cos(a) * sp * gdt) % CLOUD_WRAP;
    const u = groundUniforms;
    u.uCloudOff.value.copy(this.off);
    // fair-weather cloud that comes and goes, and closes in under rain
    const base = 0.32 + 0.22 * Math.sin(this.t * 0.0047 + 1.3);
    u.uCloudCover.value = THREE.MathUtils.lerp(base, 0.85, Math.max(rain, overcast * 0.6));
    // under a grey sky there's little sun left to block
    u.uCloudK.value = this.cloudShadows ? 0.4 * air * day * (1 - overcast * 0.75) : 0;
    // soak in over about a minute of steady rain, dry over about four
    if (rain > 0.05) this.wet = Math.min(1, this.wet + gdt * rain / 50);
    else this.wet = Math.max(0, this.wet - gdt / 240);
    u.uWet.value = this.wetOn ? this.wet : 0;
    u.uWetSky.value.copy(sky);
  }
}
