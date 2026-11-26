/**
 * The landing's set piece (cinematics/landing.json, scene `landing`; played by
 * src/cinematic.ts): the seed-probe comes in from orbit, burns its retro
 * thrusters at full throttle into a cloud of dust, touches down, folds its six
 * shell petals out flat, and the petals dissolve (reclaimed by the core's
 * fabricators) to leave the Command Core. Then the drone bay opens and the
 * worker drone flies out to its post.
 *
 * Purely presentational: the sim is told 'burn' / 'touchdown' / 'deploy' at the
 * right moments and owns everything that matters (economy, fauna panic, when
 * the drone can take orders). The player (src/cinematic.ts) runs the clock,
 * the camera, captions and sounds; this animates the probe to the beats.
 *
 * Look (v0.80.0): the shell is panelled, with a tiled heat shield that glows on
 * entry and cools; the plumes are shaded cones (turbulence, shock diamonds,
 * soft edges); the burn lights the ground and the dust, scorches the pad (the
 * region's scorch, which stays) and
 * throws sparks; touchdown kicks out a shock ring and rocks; the dissolving
 * shell sheds motes that drift into the core.
 */
import * as THREE from 'three';
import type { ZoomCamera } from './camera';
import type { CinematicDef } from './content/defs';
import type { SetPiece } from './cinematic';
import type { LandingStage } from './sim/types';
import { lerp, smoothstep } from './world/noise';
import { R, regionFlora, regionDir, regionHeight, regionHeightRaw, regionToWorld, terrainColor, U } from './world/planet';
import { orient, type RegionView } from './world/region';
import { buildCore } from './world/building-models';
import { A0, probePath } from './world/probe-path';
import { decalMaterial, groundDisc } from './world/decal';
import { lightUniforms } from './world/lights';
import { LandingSound } from './audio/landing';

// ---------- beats (seconds; content/cinematics/landing.json) ----------
let T_BURN = 0, T_TD = 0, T_OPEN = 0, T_POWER = 0, T_DISSOLVE = 0, T_DISSOLVED = 0, T_HATCH = 0, T_DRONE = 0, T_DRONE_POST = 0, T_END = 27;
function useTimeline(def: CinematicDef) {
  // a missing beat (an unfinished draft) falls back to the shipped timing
  T_BURN = def.burn ?? 5.2; T_TD = def.touchdown ?? 12; T_OPEN = def.open ?? 13.3; T_POWER = def.power ?? 15.4; T_DISSOLVE = def.dissolve ?? 17.4;
  T_DISSOLVED = def.reclaimed ?? 21.4; T_HATCH = def.hatch ?? 21.4; T_DRONE = def.drone ?? 22.5; T_DRONE_POST = def.post ?? 25.2;
  T_END = def.length ?? 27;
}


const PETALS = 6;
const RB = 10.3; // hinge apothem
const RT = 1.2; // top apothem when closed
const HS = 19; // shell height
const PL = Math.hypot(RB - RT, HS); // petal slant length
const LEAN = Math.atan2(RB - RT, HS);

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const glf = (x: number) => x.toFixed(4);

export interface LandingHooks {
  stage: (s: LandingStage) => void;
  /** Where the landing's own sounds go (GameAudio.sfxOut); none while sound is off. */
  sfx?: () => { c: AudioContext; out: AudioNode } | null;
}

/** Hash + 3D value noise, shared by the shell and plume shaders. */
const NOISE = /* glsl */ `
  float dh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dvn(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dh3(i), dh3(i + vec3(1,0,0)), f.x), mix(dh3(i + vec3(0,1,0)), dh3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dh3(i + vec3(0,0,1)), dh3(i + vec3(1,0,1)), f.x), mix(dh3(i + vec3(0,1,1)), dh3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

// ---------- the shell's materials (they all dissolve) ----------

interface ShellUniforms {
  uDissolve: { value: number };
  uCenter: { value: THREE.Vector3 };
  /** Entry heat on the shield and the lower petals (0..1). */
  uHeat: { value: number };
  /** Nozzle glow: the burn, then cooling (0..1). */
  uNozzle: { value: number };
}

/**
 * `petal`: panel seams, a tiled heat shield near the hinge, re-entry streaks and a
 * painted band (in hinge space, so it stays put as the petal folds); `shield`: the
 * underside plate, glowing with entry heat; `nozzle`: engine bells that glow while
 * burning and cool after; `part`: everything else.
 */
type ShellKind = 'petal' | 'part' | 'shield' | 'nozzle';

function shellMaterial(u: ShellUniforms, kind: ShellKind) {
  const petal = kind === 'petal';
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    roughness: petal ? 0.5 : kind === 'nozzle' ? 0.45 : 0.6, metalness: petal ? 0.5 : kind === 'nozzle' ? 0.7 : 0.35,
  });
  mat.defines = { [`SHELL_${kind.toUpperCase()}`]: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        varying vec3 vLp;
        varying float vSeed;
        #ifdef SHELL_PETAL
        attribute float aSeed;
        #endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vLp = position;
        #ifdef SHELL_PETAL
        vSeed = aSeed;
        #else
        vSeed = 0.0;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        varying vec3 vLp;
        varying float vSeed;
        uniform float uDissolve;
        uniform vec3 uCenter;
        uniform float uHeat;
        uniform float uNozzle;
        ${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dn = 0.65 * dvn(vWp * 0.45) + 0.35 * dvn(vWp * 1.4);
        // reclaimed from the tips inward, toward the core
        dn = mix(dn, 1.0 - clamp(distance(vWp, uCenter) / 32.0, 0.0, 1.0), 0.5);
        float thr = uDissolve * 1.12 - 0.06;
        if (dn < thr) discard;
        float edge = 1.0 - smoothstep(thr, thr + 0.06, dn);
        float pS = 0.0, pOuter = 0.0, pZone = 0.0, pGrime = 0.5;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef SHELL_PETAL
        {
          pS = vLp.y;
          float w = vLp.x;
          float hw = max(0.5, (${glf(RB)} - ${glf(RB - RT)} * pS / ${glf(PL)}) * 0.5774);
          float wn = w / hw;
          pOuter = step(-0.03, vLp.z);
          // panel seams: rows along the petal, two lines across it (anti-aliased by screen size)
          float aS = fwidth(pS) * 1.2 + 0.01, aW = fwidth(w) * 1.2 + 0.01;
          float ds = abs(fract(pS / 3.4 + 0.5) - 0.5) * 3.4;
          float dv = abs(abs(w) - hw * 0.5);
          float seam = max(1.0 - smoothstep(0.05, 0.05 + aS, ds), 1.0 - smoothstep(0.05, 0.05 + aW, dv));
          // heat-shield tiles near the hinge, staggered
          pZone = 1.0 - smoothstep(5.6, 6.3, pS);
          vec2 q = vec2(w, pS) / 1.05;
          q.x += 0.5 * mod(floor(q.y), 2.0);
          vec2 fq = abs(fract(q) - 0.5);
          float gap = smoothstep(0.43, 0.47, max(fq.x, fq.y));
          float tv = dh3(vec3(floor(q), vSeed * 7.0));
          // grime and re-entry streaks (long along the petal)
          pGrime = dvn(vec3(w * 0.7, pS * 0.7, vSeed * 3.0 + 11.0));
          float streak = smoothstep(0.45, 0.85, dvn(vec3(w * 1.7, pS * 0.09, vSeed * 5.0))) * (1.0 - smoothstep(4.0, 17.0, pS));
          vec3 c = diffuseColor.rgb * (0.86 + 0.28 * pGrime);
          c *= 1.0 - 0.5 * seam * (1.0 - pZone);
          vec3 tile = vec3(0.07, 0.06, 0.055) * (0.7 + 0.6 * tv);
          c = mix(c, mix(tile, tile * 0.3, gap), pZone);
          c *= 1.0 - 0.5 * streak * (1.0 - 0.5 * pZone);
          // a painted orange band and a white pinstripe below the tip
          float inb = step(abs(wn), 0.8);
          c = mix(c, vec3(0.6, 0.2, 0.05), inb * smoothstep(13.0, 13.04, pS) * (1.0 - smoothstep(13.7, 13.74, pS)) * 0.9);
          c = mix(c, vec3(0.78), inb * smoothstep(14.0, 14.04, pS) * (1.0 - smoothstep(14.2, 14.24, pS)));
          diffuseColor.rgb = mix(diffuseColor.rgb, c, pOuter);
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifdef SHELL_PETAL
        roughnessFactor = mix(roughnessFactor, mix(0.32 + 0.3 * pGrime, 0.9, pZone), pOuter);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.12, 0.75, 1.0) * edge * 1.6 * step(0.001, uDissolve);
        #ifdef SHELL_PETAL
        float hot = pow(clamp(1.0 - pS / 9.0, 0.0, 1.0), 1.4) * pOuter;
        totalEmissiveRadiance += vec3(1.0, 0.28, 0.04) * uHeat * hot * (0.55 + 0.6 * dvn(vec3(vLp.xy * 0.9, vSeed))) * 2.2;
        #endif
        #ifdef SHELL_SHIELD
        totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * uHeat * (0.6 + 0.6 * dvn(vLp * 0.7)) * 2.4;
        #endif
        #ifdef SHELL_NOZZLE
        totalEmissiveRadiance += vec3(1.0, 0.4, 0.1) * uNozzle * (0.25 + 0.75 * smoothstep(0.3, -0.8, vLp.y)) * 2.6;
        #endif`);
  };
  mat.customProgramCacheKey = () => `lander-shell-v2-${kind}`;
  return mat;
}

/** Slab of a petal in hinge space: +y up the petal, +z outward, thickness inward. `seed` varies its wear. */
function petalGeometry(seed: number): THREE.BufferGeometry {
  const tan30 = Math.tan(Math.PI / 6);
  const wAt = (s: number) => (RB - (RB - RT) * (s / PL)) * tan30 * 0.985;
  const T = 0.4;
  const pos: number[] = [], col: number[] = [];
  const outerBot = new THREE.Color('#3a302a'), outerTop = new THREE.Color('#c4beb3'), inner = new THREE.Color('#8b939b'), edgeC = new THREE.Color('#5f666d');
  const quad = (a: number[], b: number[], c: number[], d: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, cd: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const k of [ca, cb, cc, ca, cc, cd]) col.push(k.r, k.g, k.b);
  };
  // rows so the char gradient reads (the shader adds the fine detail)
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    const s0 = (i / rows) * PL, s1 = ((i + 1) / rows) * PL;
    const w0 = wAt(s0), w1 = wAt(s1);
    const c0 = outerBot.clone().lerp(outerTop, Math.pow(i / rows, 0.5)), c1 = outerBot.clone().lerp(outerTop, Math.pow((i + 1) / rows, 0.5));
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
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(seed), 1));
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

/** An engine bell: throat at the top, flaring to the exit at y = -0.8. */
function bellGeometry() {
  const prof = [[0.32, 0.35], [0.38, 0.2], [0.5, -0.05], [0.68, -0.35], [0.88, -0.62], [1.0, -0.8], [1.05, -0.82]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(prof, 18);
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

// ---------- exhaust ----------

/** An open, widening tube from the nozzle (y = 0) down to -h: the plume's shape. */
function exhaustGeometry(r0: number, r1: number, h: number) {
  return new THREE.CylinderGeometry(r0, r1, h, 24, 24, true).translate(0, -h / 2, 0);
}

/**
 * Exhaust shading: soft at the silhouette (reads as a volume, not a cone), turbulence
 * scrolling down the plume, and for the core a white-blue throat with shock diamonds.
 * `uThrottle` sets both brightness and reach.
 */
function exhaustMaterial(time: { value: number }, core: boolean, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uThrottle: { value: 0 }, uSeed: { value: seed } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vVp;
      varying vec3 vLp;
      void main() {
        vUv = uv; vLp = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vVp = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform float uThrottle;
      uniform float uSeed;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vVp;
      varying vec3 vLp;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float t = 1.0 - vUv.y; // 0 at the nozzle .. 1 at the far end
        float facing = abs(dot(normalize(vN), normalize(-vVp)));
        float ang = atan(vLp.z, vLp.x);
        vec3 np = vec3(cos(ang) * 1.6, sin(ang) * 1.6, t * ${core ? '6.0' : '3.5'} - uTime * ${core ? '19.0' : '12.0'} + uSeed);
        float n = 0.6 * dvn(np * 1.7) + 0.4 * dvn(np * 4.3 + 3.1);
        float reach = clamp(uThrottle, 0.0, 1.0);
        float fade = 1.0 - smoothstep(${core ? '0.15' : '0.3'} * reach, reach, t + (n - 0.5) * 0.3);
        float on = smoothstep(0.0, 0.25, uThrottle);
        ${core ? `
        float diamonds = pow(0.5 + 0.5 * cos(t * 6.2832 * 4.0 - 0.8), 6.0) * (1.0 - smoothstep(0.0, 0.7, t));
        vec3 col = mix(vec3(0.75, 0.85, 1.25) * 1.25, vec3(1.25, 0.55, 0.16), smoothstep(0.05, 0.55, t));
        col *= 0.55 + 1.6 * diamonds;
        float a = pow(facing, 2.2) * fade * (0.55 + 0.6 * n) * 0.85;` : `
        vec3 col = mix(vec3(1.15, 0.45, 0.12), vec3(0.7, 0.16, 0.03), smoothstep(0.0, 0.7, t));
        float a = pow(facing, 1.3) * fade * smoothstep(0.15, 0.75, n) * 0.85 * (1.0 - 0.4 * t);`}
        a *= on;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

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

// ---------- particles ----------

/**
 * Camera-facing soft billboards, simulated on the CPU. Dust (billowy, lit by the day
 * and by the burn) or, `additive`, glowing sparks and motes.
 */
class Puffs {
  readonly mesh: THREE.Mesh;
  private max: number;
  private n = 0;
  private p: Float32Array;
  private v: Float32Array;
  private c: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private g: Float32Array;
  private iPos: THREE.InstancedBufferAttribute;
  private iSA: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private jit = new THREE.Color();
  readonly uniforms = {
    uLight: { value: 1 }, uHot: { value: new THREE.Vector3() }, uHotK: { value: 0 },
    // the ground's heights (the light map's), so a puff fades out where it meets the ground: no hard line where
    // a big billboard cuts into a hill (soft particles, against the terrain only, without a depth pass)
    uSoftOn: { value: 0 }, uGH: lightUniforms.uLmH, uGR: lightUniforms.uLmR, uGHalf: lightUniforms.uLmHalf,
    uGU: lightUniforms.uLmU, uGE: lightUniforms.uLmE, uGN: lightUniforms.uLmN,
  };

  constructor(private base: THREE.Color, private additiveMode = false, max = 1600) {
    this.max = max;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.g = new Float32Array(max);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iSA = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iSA', this.iSA);
    this.geo.setAttribute('iCol', this.iCol);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: additiveMode ? { GLOW: '' } : {},
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos;
        attribute vec3 iSA;
        attribute vec3 iCol;
        uniform vec3 uHot;
        uniform float uHotK;
        varying vec2 vUv;
        varying float vA;
        varying float vS;
        varying vec3 vC;
        varying float vHot;
        varying vec3 vWp;
        varying float vSz;
        void main() {
          vUv = uv; vA = iSA.y; vS = iSA.z; vC = iCol; vSz = iSA.x;
          vHot = uHotK * exp(-distance(iPos, uHot) / 13.0);
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          // a slow per-puff twist so the billows don't all line up
          float r = vS * 6.2832;
          vec2 q = vec2(cos(r) * position.x - sin(r) * position.y, sin(r) * position.x + cos(r) * position.y);
          vec3 wp = iPos + (camR * q.x + camU * q.y) * iSA.x;
          vWp = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uLight, uSoftOn, uGR, uGHalf;
        uniform sampler2D uGH;
        uniform vec3 uGU, uGE, uGN;
        varying vec2 vUv;
        varying float vA;
        varying float vS;
        varying vec3 vC;
        varying float vHot;
        varying vec3 vWp;
        varying float vSz;
        float groundSoft() {
          if (uSoftOn < 0.5) return 1.0;
          float r = length(vWp);
          vec3 d = vWp / r;
          vec2 rp = uGR * vec2(dot(d, uGE), dot(d, uGN)) / max(dot(d, uGU), 0.5);
          float g = texture2D(uGH, (clamp(rp, -uGHalf, uGHalf) + uGHalf + 0.5) / (2.0 * uGHalf + 1.0)).r;
          float lift = r - uGR - max(g, 0.0);
          return smoothstep(0.0, clamp(vSz * 0.3, 0.6, 4.0), lift);
        }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 q = vUv - 0.5;
          float d = length(q) * 2.0;
          #ifdef GLOW
          float a = (1.0 - smoothstep(0.0, 1.0, d)) * vA;
          a *= a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vC, a);
          #else
          // billowy edge and a lighter top (the sun) over a darker underside
          float bn = 0.65 * n2(q * 3.2 + vS * 19.0) + 0.35 * n2(q * 7.0 + vS * 41.0);
          d += (bn - 0.5) * 0.5;
          float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA;
          if (a < 0.004) discard;
          a *= groundSoft();
          if (a < 0.004) discard;
          float shade = 0.78 + 0.3 * q.y + 0.25 * (bn - 0.5);
          vec3 col = vC * shade * (0.75 + 0.45 * vS) * uLight + vec3(1.0, 0.48, 0.16) * vHot * 1.5;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #endif
        }`,
      transparent: true,
      depthWrite: false,
      blending: additiveMode ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additiveMode ? 6 : 5;
  }

  /**
   * Spawn one particle at region (x, z) `lift` above the ground, moving radially out
   * from (cx, cz) (negative speed: in) and rising; `grav` pulls along the site's up.
   */
  spawn(x: number, z: number, cx: number, cz: number, speed: number, rise: number, size0: number, size1: number, life: number, alpha: number,
    o: { col?: THREE.Color; lift?: number; grav?: number } = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const w = regionToWorld(x, z, o.lift ?? 0.4 + Math.random() * 0.8);
    const up = regionDir(x, z);
    let dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // tangent directions at the site are close enough to E/N for a 60-unit cloud
    const out = regionToWorld(x + dx, z + dz, 0).sub(regionToWorld(x, z, 0)).normalize();
    const vel = out.multiplyScalar(speed).addScaledVector(up, rise);
    this.p.set([w.x, w.y, w.z], i * 3);
    this.v.set([vel.x, vel.y, vel.z], i * 3);
    const c = o.col ?? this.jit.copy(this.base).multiplyScalar(0.82 + Math.random() * 0.3);
    this.c.set([c.r, c.g, c.b], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.g[i] = o.grav ?? 0.9;
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
    this.uniforms.uSoftOn.value = lightUniforms.uLmH.value ? 1 : 0;
    const up = U;
    const drag = Math.exp(-dt * 1.5);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (const arr of [this.p, this.v, this.c]) arr.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j]; this.g[i] = this.g[j];
          this.iSA.array[i * 3 + 2] = this.iSA.array[j * 3 + 2];
        }
        i--;
        continue;
      }
      const k = i * 3, gk = this.g[i] * dt;
      this.v[k] = this.v[k] * drag + up.x * gk;
      this.v[k + 1] = this.v[k + 1] * drag + up.y * gk;
      this.v[k + 2] = this.v[k + 2] * drag + up.z * gk;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.iPos.array[k] = this.p[k]; this.iPos.array[k + 1] = this.p[k + 1]; this.iPos.array[k + 2] = this.p[k + 2];
      this.iSA.array[k] = lerp(this.s0[i], this.s1[i], 1 - (1 - t) * (1 - t));
      this.iSA.array[k + 1] = this.a0[i] * smoothstep(0, this.additiveMode ? 0.02 : 0.12, t) * (1 - smoothstep(this.additiveMode ? 0.5 : 0.35, 1, t));
    }
    this.geo.instanceCount = this.n;
    this.iPos.needsUpdate = true;
    this.iSA.needsUpdate = true;
    this.iCol.needsUpdate = true;
  }

  get live() { return this.n; }
  /** One invisible particle, so the program compiles (see Landing.warmUp). */
  prime() { this.spawn(0, 0, 0, 0, 0, 0, 0.01, 0.01, 1, 0, { lift: -50 }); this.geo.instanceCount = this.n; }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** Rocks thrown out at touchdown: ballistic in region terms, bouncing to rest on the ground. */
class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private st: { x: number; z: number; h: number; vx: number; vz: number; vh: number; size: number; ax: THREE.Vector3; ang: number; spin: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qs = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor(color: THREE.Color, private max = 70) {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.scale(1, 0.7, 0.85);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, c.copy(color).multiplyScalar(0.4 + Math.random() * 0.45));
  }

  burst(r0: number, r1: number) {
    for (let i = this.n; i < this.max; i++) {
      const a = Math.random() * Math.PI * 2, r = lerp(r0, r1, Math.random()), sp = 8 + Math.random() * 20;
      this.st.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r, h: 0.4, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vh: 5 + Math.random() * 12,
        size: 0.25 + Math.pow(Math.random(), 2) * 0.8, ax: new THREE.Vector3().randomDirection(), ang: Math.random() * 6, spin: 4 + Math.random() * 10,
      });
    }
    this.n = this.mesh.count = this.max;
  }

  /** One rock drawn at zero size for a frame, so the program compiles (see Landing.warmUp). */
  prime() {
    if (this.n) return;
    this.mesh.setMatrixAt(0, this.m.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 1;
  }

  /** `shrink` 1 → 0 sinks them away before the hand-over. */
  update(dt: number, shrink: number) {
    if (!this.n) { this.mesh.count = 0; return; }
    for (let i = 0; i < this.n; i++) {
      const r = this.st[i];
      const moving = r.vh !== 0 || Math.abs(r.vx) + Math.abs(r.vz) > 0.05;
      if (moving) {
        r.vh -= 26 * dt;
        r.x += r.vx * dt; r.z += r.vz * dt; r.h += r.vh * dt;
        r.ang += r.spin * dt;
        if (r.h < r.size * 0.5) {
          r.h = r.size * 0.5;
          if (r.vh < -3) { r.vh *= -0.3; r.vx *= 0.55; r.vz *= 0.55; r.spin *= 0.5; } else { r.vh = 0; r.vx *= 0.8; r.vz *= 0.8; r.spin *= 0.8; }
        }
      }
      regionToWorld(r.x, r.z, r.h - r.size * 0.3, this.w);
      this.qs.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, regionDir(r.x, r.z));
      this.q.setFromAxisAngle(r.ax, r.ang).premultiply(this.qs);
      this.s.setScalar(r.size * shrink);
      this.mesh.setMatrixAt(i, this.m.compose(this.w, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}

// ---------- the lander ----------

const SPARK = new THREE.Color(1.6, 0.7, 0.22);
const MOTE = new THREE.Color(0.35, 1.1, 1.6);

export class Landing implements SetPiece {
  private probeObj = new THREE.Group();
  private core: THREE.Group;
  private pivots: THREE.Group[] = [];
  private plumes: { inner: THREE.Mesh; outer: THREE.Mesh; flare: THREE.Sprite }[] = [];
  private plumeTime = { value: 0 };
  /**
   * Frames of warm-up left: everything the landing will ever draw is drawn once, invisibly, at the start, so no
   * shader compiles mid-flight (each was a visible hitch on phones). No point lights either: adding or removing a
   * light recompiles every lit material in the scene (dozens of programs at the hand-over); the burn's light is
   * emissive heat on the shell, the nozzles' glow, the firelight disc on the ground and the warmed dust instead.
   */
  private warm = false;
  /** Landing-clock time the warm-up runs until (0.4 s from the start; a late model adds 0.3 s more). */
  private warmUntil = 0.4;
  private lastT = 0;
  private culled: THREE.Object3D[] = [];
  private hidden: THREE.Object3D[] = [];
  private sheath: THREE.Mesh;
  private trail: THREE.Mesh;
  private plasma: THREE.Sprite;
  private dust: Puffs;
  private sparks: Puffs;
  private debris: Debris;
  private glowDisc: THREE.Mesh;
  private scorchK = 0;
  private shellU: ShellUniforms = { uDissolve: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uHeat: { value: 0 }, uNozzle: { value: 0 } };
  private glows: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private hatch: THREE.Object3D;
  private sent = new Set<LandingStage>();
  private snd: LandingSound;
  /** One-shot sounds already played (by name). */
  private heard = new Set<string>();
  private thudded = new Set<number>();
  private padH = regionHeight(0, 0);
  private v = 0; // probe speed, units/s
  /** Probe altitude (units), for the camera's pull-back and the {alt} caption. */
  alt = A0;

  /** `def`: the landing cinematic (an unsaved draft from the editor's play test, or the content's). */
  constructor(private scene: THREE.Scene, private region: RegionView, private cam: ZoomCamera, private hooks: LandingHooks, def: CinematicDef) {
    useTimeline(def);
    this.snd = new LandingSound(hooks.sfx ?? (() => null));
    this.core = buildCore();
    this.probeObj.add(this.core);
    this.core.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.emissiveIntensity > 0 && o.material.emissive.getHex() !== 0) {
        this.glows.push({ mat: o.material, base: o.material.emissiveIntensity });
      }
    });
    this.hatch = this.core.getObjectByName('hatch')!;

    // shell: six petals hinged at the base + a heat-shield plate underneath
    this.shellU.uCenter.value.copy(regionToWorld(0, 0, 0));
    const petalMat = shellMaterial(this.shellU, 'petal');
    const partMat = shellMaterial(this.shellU, 'part');
    const nozzleMat = shellMaterial(this.shellU, 'nozzle');
    const bellGeo = painted(bellGeometry(), '#34373c');
    const podGeo = painted(new THREE.BoxGeometry(1.7, 2.4, 0.9), '#6e757c');
    const podCapGeo = painted(new THREE.BoxGeometry(1.9, 0.35, 1.05), '#41474e');
    const ribGeo = painted(new THREE.BoxGeometry(0.35, PL * 0.8, 0.25), '#4d545b');
    const knuckleGeo = painted(new THREE.CylinderGeometry(0.42, 0.42, 2.2, 10).rotateZ(Math.PI / 2), '#3b4047');
    const rcsGeo = painted(new THREE.BoxGeometry(0.9, 0.8, 0.55), '#5a6168');
    const rcsNozGeo = painted(new THREE.CylinderGeometry(0.1, 0.18, 0.35, 6), '#26292d');
    for (let i = 0; i < PETALS; i++) {
      const a = (i / PETALS) * Math.PI * 2 + Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = Math.PI / 2 - a;
      pivot.position.set(Math.cos(a) * RB, 0.25, Math.sin(a) * RB);
      pivot.userData.a = a;
      const petal = new THREE.Mesh(petalGeometry(i * 1.37 + 0.5), petalMat);
      pivot.add(petal);
      for (const x of [-1.9, 1.9]) {
        const rib = new THREE.Mesh(ribGeo, partMat);
        rib.position.set(x * (1 - 0.1), PL * 0.45, 0.12);
        pivot.add(rib);
      }
      // hinge knuckles along the base
      for (const x of [-3.4, 3.4]) {
        const kn = new THREE.Mesh(knuckleGeo, partMat);
        kn.position.set(x, 0.15, -0.15);
        pivot.add(kn);
      }
      if (i % 2 === 1) {
        // thruster pod: nozzle points down and out
        const pod = new THREE.Mesh(podGeo, partMat);
        pod.position.set(0, PL * 0.3, 0.45);
        const cap = new THREE.Mesh(podCapGeo, partMat);
        cap.position.set(0, PL * 0.3 + 1.2, 0.47);
        pivot.add(pod, cap);
        const noz = new THREE.Group();
        noz.position.set(0, PL * 0.3 - 1.4, 0.75);
        noz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, -0.05).normalize());
        const bell = new THREE.Mesh(bellGeo, nozzleMat);
        bell.position.y = -0.35;
        noz.add(bell);
        const inner = new THREE.Mesh(exhaustGeometry(0.55, 1.05, 11), exhaustMaterial(this.plumeTime, true, i * 3.1));
        const outer = new THREE.Mesh(exhaustGeometry(0.95, 3.4, 19), exhaustMaterial(this.plumeTime, false, i * 5.7));
        inner.position.y = outer.position.y = -1.1;
        inner.renderOrder = 7; outer.renderOrder = 6;
        inner.frustumCulled = outer.frustumCulled = false;
        const flare = glowSprite('rgba(255,245,230,1)', 'rgba(255,150,60,0.5)');
        flare.position.y = -1.3;
        flare.scale.setScalar(6);
        noz.add(inner, outer, flare);
        pivot.add(noz);
        this.plumes.push({ inner, outer, flare });
      } else {
        // attitude-thruster block near the tip
        const rcs = new THREE.Mesh(rcsGeo, partMat);
        rcs.position.set(0, PL * 0.74, 0.32);
        pivot.add(rcs);
        for (const x of [-0.5, 0.5]) {
          const rn = new THREE.Mesh(rcsNozGeo, partMat);
          rn.rotation.z = Math.PI / 2 * Math.sign(x);
          rn.position.set(x * 1.2, PL * 0.74, 0.32);
          pivot.add(rn);
        }
      }
      this.probeObj.add(pivot);
      this.pivots.push(pivot);
    }
    const shield = new THREE.Mesh(painted(new THREE.CylinderGeometry(RB / Math.cos(Math.PI / 6), RB / Math.cos(Math.PI / 6) * 0.96, 0.5, 6), '#2b221d'), shellMaterial(this.shellU, 'shield'));
    shield.rotation.y = Math.PI / 6;
    shield.position.y = 0.05;
    this.probeObj.add(shield);

    // entry plasma: a hot cap on the shield, a long wake behind, and a sprite that reads from far away
    const sheathGeo = new THREE.SphereGeometry(13, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    sheathGeo.scale(1, 0.45, 1);
    this.sheath = new THREE.Mesh(painted(sheathGeo, new THREE.Color(1.4, 0.6, 0.25)), additive(0));
    this.sheath.position.y = 1;
    const trailGeo = plumeGeometry(9, 1, new THREE.Color(1.1, 0.42, 0.14));
    trailGeo.rotateX(Math.PI); // apex up, base at y=0
    this.trail = new THREE.Mesh(trailGeo, additive(0));
    this.plasma = glowSprite('rgba(255,235,200,1)', 'rgba(255,120,40,0.45)');
    this.probeObj.add(this.sheath, this.trail, this.plasma);


    const dc = terrainColor(regionHeightRaw(0, 0), regionFlora(0, 0), new THREE.Color());
    this.debris = new Debris(dc.clone());
    this.dust = new Puffs(dc.lerp(new THREE.Color('#c9b49a'), 0.35));
    this.sparks = new Puffs(SPARK, true, 900);

    // firelight pooled on the ground, and the burn's scorch mark (both draped on the terrain)
    const warm = new THREE.Color(1.0, 0.45, 0.14);
    this.glowDisc = new THREE.Mesh(groundDisc(34, 0.5, (r) => [warm.r, warm.g, warm.b, Math.pow(1 - r, 2.2)]), decalMaterial(true));
    this.glowDisc.frustumCulled = false;
    this.glowDisc.renderOrder = 2;
    // the burn's scorch is the region's own (it stays after the landing)
    region.setScorch(0);

    scene.add(this.probeObj, this.dust.mesh, this.sparks.mesh, this.debris.mesh, this.glowDisc);
    region.core.visible = false;
    region.droneHeld = true;
    region.drone.visible = false;
    this.setPower(0.12);
    cam.freePitch = true;
    cam.overrideW = 1;
  }

  /** Where camera keys that look at the probe aim. */
  get probe() { return this.probeObj.position; }

  private setPower(k: number) {
    for (const g of this.glows) g.mat.emissiveIntensity = g.base * k;
  }

  /** Probe path in region terms at time t. */
  private path(t: number) { return probePath(T_TD, t); }

  private pathWorld(t: number, out = new THREE.Vector3()) {
    const p = this.path(t);
    return regionDir(p.x, p.z, out).multiplyScalar(R + this.padH + p.alt);
  }

  /** Pose everything for time `t` (s). */
  frame(t: number, dt: number, day: number) {
    this.lastT = t;
    // the effects' visibility below reads this: drawn (invisibly) through the warm-up
    this.warm = this.warm || (t < this.warmUntil && !this.over);
    const pos = this.pathWorld(t);
    const p = this.path(t);
    this.alt = p.alt;
    this.plumeTime.value = t;

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
      this.probeObj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
      this.probeObj.position.copy(pos);
    } else {
      this.v = 0;
      orient(this.probeObj, 0, 0, 0, 0);
      // landing-gear settle: a small sag and rebound
      const st = t - T_TD;
      this.probeObj.position.addScaledVector(regionDir(0, 0), -0.35 * Math.exp(-st * 4) * Math.sin(st * 14));
    }

    // ---- entry plasma ----
    const entry = 1 - smoothstep(T_BURN - 2.6, T_BURN + 0.2, t);
    const heat = entry * (0.6 + 0.4 * Math.sin(t * 37) * Math.sin(t * 23));
    (this.sheath.material as THREE.MeshBasicMaterial).opacity = heat;
    (this.trail.material as THREE.MeshBasicMaterial).opacity = heat * 0.5;
    this.trail.scale.set(1 - t * 0.08, 60 + 260 * (1 - smoothstep(0, T_BURN - 0.2, t)), 1 - t * 0.08);
    this.sheath.visible = this.trail.visible = heat > 0.01 || this.warm;
    const camDist = this.cam.camera.position.distanceTo(this.probeObj.position);
    this.plasma.visible = heat > 0.01;
    this.plasma.scale.setScalar(Math.max(34, camDist * 0.09) * (0.6 + heat * 0.6));
    (this.plasma.material as THREE.SpriteMaterial).opacity = heat;
    // the shield and lower petals glow through entry, then cool to a dull red
    this.shellU.uHeat.value = Math.max(entry * (0.85 + 0.15 * Math.sin(t * 31)), 0.5 * Math.exp(-Math.max(0, t - T_BURN - 0.2) / 3.5) * smoothstep(0, T_BURN, t));

    // ---- retro thrusters ----
    let throttle = 0;
    if (t >= T_BURN && t < T_TD + 0.15) {
      throttle = smoothstep(T_BURN, T_BURN + 0.5, t) * (1 - smoothstep(T_TD - 0.1, T_TD + 0.15, t));
    }
    const fl = 0.88 + Math.random() * 0.24;
    for (const pl of this.plumes) {
      pl.inner.visible = pl.outer.visible = pl.flare.visible = throttle > 0.01 || this.warm;
      (pl.inner.material as THREE.ShaderMaterial).uniforms.uThrottle.value = throttle * (0.95 + 0.05 * fl);
      (pl.outer.material as THREE.ShaderMaterial).uniforms.uThrottle.value = throttle * fl;
      pl.outer.scale.set(1 + 0.06 * Math.random(), 1, 1 + 0.06 * Math.random());
      (pl.flare.material as THREE.SpriteMaterial).opacity = throttle;
      pl.flare.scale.setScalar(5 + 3.5 * fl * throttle);
    }
    this.shellU.uNozzle.value = t < T_TD ? throttle : 0.85 * Math.exp(-(t - T_TD) / 2.4);
    if (throttle > 0.01 && !this.sent.has('burn') && p.alt < 600) this.send('burn');

    // ---- the burn on the ground: firelight, scorch, dust and sparks ----
    const near = throttle * (1 - smoothstep(18, 90, p.alt));
    (this.glowDisc.material as THREE.ShaderMaterial).uniforms.uOpacity.value = near * 0.8 * fl;
    this.glowDisc.visible = near > 0.01 || this.warm;
    this.dust.uniforms.uHot.value.copy(regionToWorld(p.x, p.z, 4));
    this.dust.uniforms.uHotK.value = near * fl;
    this.scorchK = Math.max(this.scorchK, throttle * (1 - smoothstep(6, 40, p.alt)));
    this.region.setScorch(this.scorchK);

    if (throttle > 0.05 && p.alt < 90) {
      const k = throttle * Math.sqrt(1 - p.alt / 90);
      const n = Math.floor(320 * k * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 5 + p.alt * 0.25 + Math.random() * 6;
        this.dust.spawn(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.x, p.z, (16 + Math.random() * 26) * k, 1 + Math.random() * 4,
          2 + Math.random() * 2, 9 + Math.random() * 8, 2.5 + Math.random() * 2.5, 0.5);
      }
      if (p.alt < 45) {
        const ks = throttle * (1 - p.alt / 45);
        const m = Math.floor(160 * ks * dt + Math.random());
        for (let i = 0; i < m; i++) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
          this.sparks.spawn(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.x, p.z, 14 + Math.random() * 30, 3 + Math.random() * 9,
            0.9, 0.3, 0.4 + Math.random() * 0.8, 1, { col: SPARK, lift: 0.3, grav: -16 });
        }
      }
    }
    if (t >= T_TD && !this.sent.has('touchdown')) {
      this.send('touchdown');
      if (this.cue('touchdown', T_TD, t)) this.snd.touchdown();
      this.dust.burst(0, 0, 260, 9, 13, 18, 42, { rise: 4, size: [3, 14], life: [3, 5.5], alpha: 0.6 });
      // a fast, low shock ring racing out along the ground
      this.dust.burst(0, 0, 150, 10, 12, 45, 75, { rise: 0.6, size: [2, 7], life: [1.2, 2.2], alpha: 0.45 });
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 4;
        this.sparks.spawn(Math.cos(a) * r, Math.sin(a) * r, 0, 0, 20 + Math.random() * 30, 6 + Math.random() * 10, 1.0, 0.3, 0.5 + Math.random() * 0.9, 1,
          { col: SPARK, lift: 0.5, grav: -16 });
      }
      this.debris.burst(7, 12);
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
        if (this.cue(`petal${i}`, T_OPEN + i * 0.13 + 2.2, t)) this.snd.petal(i);
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
    // the reclaimed shell drifts into the core as motes
    if (t > T_DISSOLVE && t < T_DISSOLVED) {
      const u = (t - T_DISSOLVE) / (T_DISSOLVED - T_DISSOLVE);
      const m = Math.floor(200 * Math.sin(Math.PI * u) * dt + Math.random());
      for (let i = 0; i < m; i++) {
        const a = (Math.floor(Math.random() * PETALS) / PETALS) * Math.PI * 2 + Math.PI / 2 + (Math.random() - 0.5) * 0.7;
        const r = RB + Math.random() * PL * (1 - u * 0.7);
        this.sparks.spawn(Math.cos(a) * r, Math.sin(a) * r, 0, 0, -(5 + Math.random() * 7), 1.5 + Math.random() * 3, 1.1, 0.35, 1.2 + Math.random() * 1.2, 0.9,
          { col: MOTE, lift: 0.4 + Math.random() * 0.8, grav: 2.5 });
      }
    }
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
    this.sparks.update(dt);
    this.debris.update(dt, 1 - smoothstep(T_DRONE_POST, T_END - 0.3, t));
    // ---- sound ----
    if (throttle > 0.01 && this.cue('ignite', T_BURN, t)) this.snd.ignite();
    if (t >= T_POWER && this.cue('power', T_POWER, t)) this.snd.power();
    if (t >= T_HATCH && this.cue('hatch', T_HATCH, t)) this.snd.hatch();
    if (t >= T_DRONE && this.cue('drone', T_DRONE, t)) this.snd.drone();
    const du = (t - T_DISSOLVE) / Math.max(0.1, T_DISSOLVED - T_DISSOLVE);
    this.snd.update({ heat: entry, throttle, alt: p.alt, speed: this.v, dissolve: du > 0 && du < 1 ? Math.sin(Math.PI * du) : 0 });

    // last, so it overrides this frame's pose
    const warming = t < this.warmUntil && !this.over;
    if (warming || this.warm) this.warmUp(warming);
    this.warm = warming;
  }

  /**
   * `on`: draw everything this frame (whatever its visibility later and wherever the camera looks), invisibly, so
   * the programs compile now; off: put things back. frame() runs the rest of the pose after it, which sets the
   * effects' own visibility again.
   */
  private warmUp(on: boolean) {
    if (on) {
      this.scene.traverse((o) => { if (o.frustumCulled && (o as THREE.Mesh).isMesh) { o.frustumCulled = false; this.culled.push(o); } });
      this.dust.prime();
      this.sparks.prime();
      this.debris.prime();
      // the drone and every model it can show (near and far looks), which first draw well after touchdown
      this.region.drone.visible = true;
      this.region.drone.traverse((o) => {
        if (!o.visible) { o.visible = true; this.hidden.push(o); }
        if (o.frustumCulled) { o.frustumCulled = false; this.culled.push(o); }
      });
      this.region.setScorch(0.02);
      this.region.forceDetails = 2;
      this.region.details.visible = true;
      return;
    }
    for (const o of this.culled) o.frustumCulled = true;
    for (const o of this.hidden) o.visible = false;
    this.culled.length = this.hidden.length = 0;
    this.region.drone.visible = false;
  }

  /** Models swapped in after the start (they load in the background): draw everything once more, so they compile now. */
  rewarm() { if (!this.over) this.warmUntil = Math.max(this.warmUntil, this.lastT + 0.3); }
  private over = false;

  /**
   * A one-shot sound's moment (`at`) has come: true the first time, if it's fresh (a jump ahead, the editor's play
   * from the playhead, doesn't set off everything it skipped at once).
   */
  private cue(name: string, at: number, t: number) {
    if (this.heard.has(name) || t < at) return false;
    this.heard.add(name);
    return t - at < 0.5;
  }

  /** Caption text with {alt} km, {speed} m/s and {shield} °C filled in. */
  fill(x: string, t: number) {
    const km = (this.alt * 0.01).toFixed(this.alt < 100 ? 2 : 1);
    return x.replace(/\{alt\}/g, km).replace(/\{speed\}/g, String(Math.round(this.v * 10)))
      .replace(/\{shield\}/g, String(Math.round(1400 + 900 * Math.max(0, 1 - t / Math.max(0.1, T_BURN)))));
  }

  private send(s: LandingStage) {
    if (this.sent.has(s)) return;
    this.sent.add(s);
    this.hooks.stage(s);
  }

  /** The end (or a skip): the colony takes over, the camera goes to the normal view. */
  finish() {
    this.over = true;
    this.snd.stop();
    if (this.warm) this.warmUp(false);
    this.warm = false;
    this.send('touchdown');
    this.send('deploy');
    this.scene.remove(this.probeObj, this.dust.mesh, this.sparks.mesh, this.debris.mesh, this.glowDisc);
    this.region.setScorch(1);
    this.dust.dispose();
    this.sparks.dispose();
    this.debris.dispose();
    this.glowDisc.geometry.dispose(); (this.glowDisc.material as THREE.Material).dispose();
    this.probeObj.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
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
  }
}
