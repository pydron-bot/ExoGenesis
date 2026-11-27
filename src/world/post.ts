/**
 * Glow (bloom): bright parts spill soft light. On by default on desktop, off on
 * phones until it's been checked on a real one (the ⋯ menu's ✺ Glow turns it on or
 * off, remembered; `?bloom=0|1` overrides).
 *
 * While it's on the scene renders into an HDR target, UnrealBloomPass blurs what's
 * brighter than a threshold, and OutputPass applies the tone mapping and sRGB the
 * renderer would otherwise do itself. While it's off the renderer draws straight to
 * the screen, exactly as before, so turning it off costs nothing.
 *
 * Anti-aliasing (⚙ Options → Anti-aliasing, remembered; `?aa=auto|off|fxaa|smaa|msaa` overrides):
 *  - auto: as it always was. Glow off: the canvas's own MSAA. Glow on: 4× MSAA on the HDR target on
 *    desktop, none on phones.
 *  - off / fxaa / smaa / msaa: the same whether Glow is on or off. FXAA and SMAA are passes after
 *    OutputPass; MSAA is the canvas's own when Glow is off (if the page started with it), else 4× on the
 *    target. With Glow off and FXAA/SMAA (or MSAA on a canvas without its own) the composer runs with
 *    bloom and the other effects skipped.
 *  The canvas's MSAA is fixed when the page loads (main.ts asks for it only for auto/msaa), so switching
 *  to Off with Glow off applies after a restart (the options row says so).
 * Cost (tools/aa-bench.mjs, llvmpipe, glow on, phone size): FXAA +10%, SMAA +14%, MSAA +42%. A CPU
 * renderer overstates MSAA; on phone GPUs it's much cheaper, so measure there before changing `auto`.
 *
 * The threshold follows the light: low at night, so glow strips, pods, floodlight
 * pools and gunfire bloom; high by day, so only the hottest things (flashes,
 * explosions, the sun) do and sunlit ground never washes out.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { N8AOPass } from 'n8ao';
/** n8ao (ambient occlusion, off by default): loaded the first time it's switched on, not with the game. */
let N8AO: typeof N8AOPass | null = null;
let n8aoLoading: Promise<void> | null = null;
const loadN8ao = () => (n8aoLoading ??= import('n8ao').then((m) => { N8AO = m.N8AOPass; }));

export type AAMode = 'auto' | 'off' | 'fxaa' | 'smaa' | 'msaa';
export const AA_MODES: AAMode[] = ['auto', 'off', 'fxaa', 'smaa', 'msaa'];

/**
 * Sun shafts (with Glow on): light streaming from the sun past whatever stands in front of it. The
 * bright sky and sun round the sun's place on screen are smeared toward it in 40 steps (16 on phones) that fade as they
 * go (GPU Gems 3, ch. 13), so flora, hills and buildings against the sun cut dark gaps in the rays. Only bright
 * pixels near the sun count (each sample is weighted by its distance from it), and main.ts turns the pass off
 * while the sun is down or behind a planet. Off (and skipped) when the sun is far off screen or the strength is 0.
 */
/**
 * Heat shimmer and zoom blur in one pass (with Glow on). Shimmer: up to 8 sources (3 on phones) (the screen position
 * and size of a working reactor, generator, core…): inside a column rising from each, the picture
 * wobbles with fine travelling ripples. Zoom blur: while the camera zooms fast, the frame is smeared
 * toward/away from the middle (10 taps), as a lens would on a quick pull.
 */
/** Phones (coarse pointer) do less per pixel: fewer shaft steps, fewer shimmer sources. */
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SHAFT_TAPS = PHONE ? 16 : 40;
/** Most heat-shimmer sources a frame carries (nearest first). */
export const HEAT_MAX = PHONE ? 3 : 8;

const DistortShader = {
  uniforms: {
    tDiffuse: { value: null }, uZoom: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uHeatK: { value: 0 },
    uHeatN: { value: 0 }, uHeat: { value: Array.from({ length: HEAT_MAX }, () => new THREE.Vector3()) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uZoom, uTime, uAspect, uHeatK;
    uniform int uHeatN;
    uniform vec3 uHeat[${HEAT_MAX}];
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      for (int i = 0; i < ${HEAT_MAX}; i++) {
        if (i >= uHeatN) break;
        vec3 h = uHeat[i];
        vec2 d = (vUv - h.xy) * vec2(uAspect, 1.0);
        // a column: narrow at the source, rising and spreading above it
        float w = h.z * (0.55 + 0.6 * clamp(d.y / h.z, 0.0, 2.0));
        // (kept short and faint: from the high camera a tall column reads as a stripe of light, v0.74.3)
        float col = exp(-pow(d.x / w, 2.0)) * smoothstep(-0.2 * h.z, 0.3 * h.z, d.y) * (1.0 - smoothstep(0.7 * h.z, 1.8 * h.z, d.y));
        float fi = float(i) * 1.7;
        vec2 wob = vec2(sin(vUv.y * 220.0 - uTime * 7.0 + fi) + 0.5 * sin(vUv.y * 470.0 - uTime * 11.0), cos(vUv.x * 160.0 + uTime * 5.0 + fi));
        uv += wob * 0.0009 * col * uHeatK;
      }
      vec4 c = texture2D(tDiffuse, uv);
      if (uZoom > 0.0005) {
        vec2 dir = uv - 0.5;
        vec4 acc = c;
        for (int i = 1; i < 10; i++) acc += texture2D(tDiffuse, uv - dir * uZoom * float(i) / 9.0);
        c = acc / 10.0;
      }
      gl_FragColor = c;
    }`,
};

const ShaftShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uAspect: { value: 1 }, uTint: { value: new THREE.Color('#ffe2b8') } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStrength, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = (vUv - uSun) * (0.85 / ${SHAFT_TAPS}.0);
      vec2 uv = vUv;
      float decay = 1.0, sum = 0.0;
      for (int i = 0; i < ${SHAFT_TAPS}; i++) {
        uv -= delta;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // only light near the sun feeds the rays: a glowing building elsewhere mustn't throw a shaft across the screen (v0.75.1)
        vec2 so = (uv - uSun) * vec2(uAspect, 1.0);
        sum += smoothstep(0.5, 1.3, l) * decay / (1.0 + dot(so, so) * 10.0);
        decay *= ${(0.955 ** (40 / SHAFT_TAPS)).toFixed(4)};
      }
      vec2 off = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = 1.0 / (1.0 + dot(off, off) * 6.0);
      gl_FragColor = vec4(base.rgb + uTint * sum * (1.6 / ${SHAFT_TAPS}.0) * uStrength * fall, base.a);
    }`,
};

/**
 * Colour grade and vignette (Options → Colour grade): after OutputPass, on the display picture. Each world gets
 * its own mood from its sky and ground (main.ts, `gradeFor`): shadows lifted toward a tint, highlights
 * tinted, saturation and contrast nudged; nights go bluer, sunrise and sunset warmer. The vignette darkens the
 * corners a little. With no composer running (Glow off, plain anti-aliasing) only the vignette shows, drawn by
 * the page (a CSS overlay, free).
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uLift: { value: new THREE.Color(0, 0, 0) }, uGain: { value: new THREE.Color(1, 1, 1) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uVig: { value: 0.3 }, uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift, uGain;
    uniform float uSat, uContrast, uVig, uAspect;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 c = clamp(base.rgb, 0.0, 1.0);
      // a gentle S round the middle
      c = clamp(mix(vec3(0.5), c, uContrast), 0.0, 1.0);
      // lift the shadows toward a tint, tint the highlights
      c = c * uGain + uLift * (1.0 - c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // the corners a little darker (an ellipse that fits the screen)
      vec2 d = (vUv - 0.5) * 2.0;
      d.x *= mix(1.0, 0.85, clamp(uAspect - 1.0, 0.0, 1.0));
      float r = length(d) * 0.7071;
      c *= 1.0 - uVig * pow(smoothstep(0.4, 1.0, r), 1.4);
      gl_FragColor = vec4(c, base.a);
    }`,
};

/** A world's grade (see GradeShader): shadow tint and amount, highlight tint, saturation, contrast. */
export interface Grade { lift: THREE.Color; gain: THREE.Color; sat: number; contrast: number }

/**
 * The grade for a world from its look: `sky` its sky colour (none: airless), `ground` its ground colours.
 * Airless worlds get harsh, cool, a little drained; worlds with air take their sky into the shadows and a
 * touch of their ground into the light.
 */
export function gradeFor(sky: string | undefined, ground: string[], oceans: boolean): Grade {
  const lift = new THREE.Color(sky ?? '#2c3a5c');
  // keep its hue, set its strength: shadows only lean toward it
  const lk = 0.045 / Math.max(0.05, Math.max(lift.r, lift.g, lift.b));
  lift.multiplyScalar(lk);
  const g = new THREE.Color(ground[Math.min(1, ground.length - 1)] ?? '#999999');
  const gl = Math.max(0.05, 0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b);
  const gain = new THREE.Color(1, 1, 1).lerp(g.multiplyScalar(1 / gl), 0.07);
  // (never brighter overall: the largest channel stays at 1)
  gain.multiplyScalar(1 / Math.max(gain.r, gain.g, gain.b));
  return { lift, gain, sat: sky ? (oceans ? 1.08 : 1.04) : 0.9, contrast: sky ? 1.04 : 1.1 };
}

const NIGHT_LIFT = new THREE.Color('#0a1430');
const GOLDEN_GAIN = new THREE.Color('#fff0dc');

/** Bloom works at this fraction of the canvas resolution (the pass halves it again for its first level). */
const BLOOM_SCALE = 0.5;
/** Ambient occlusion's darkening (n8ao's intensity: an exponent on the occlusion). */
const AO_STRENGTH = 4;

export interface GlowLook {
  /** 0 day .. 1 night at the landing site. */
  night: number;
  /** 0 on the surface .. 1 up in orbit or beyond. */
  orbit: number;
  /** The sun on screen (0..1 uv, may be outside), and how strong its shafts are (0 = off). */
  sun?: THREE.Vector2;
  shafts?: number;
  /** Zoom blur amount (0 = off; ~0.03 is a strong pull). */
  zoom?: number;
  /** Heat sources: screen uv and radius (in screen heights), and the overall strength. */
  heat?: THREE.Vector3[];
  heatK?: number;
  /** Seconds, for the shimmer's ripples. */
  time?: number;
  /** The camera's distance from what it looks at (the AO's reach grows with it). */
  camDist?: number;
  /** The world's grade, and 0..1 sunrise/sunset (night comes from `night`). */
  grade?: Grade;
  golden?: number;
}

export class Post {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private shafts: ShaderPass | null = null;
  private distort: ShaderPass | null = null;
  private gradePass: ShaderPass | null = null;
  private on = false;
  private gradeOn = true;
  private aaMode: AAMode = 'auto';
  private aaPass: FXAAPass | SMAAPass | null = null;
  /** Ambient occlusion (n8ao): it renders the scene itself, in place of the RenderPass. */
  private aoOn = false;
  private aoPass: N8AOPass | null = null;
  /** Whether the canvas itself was made with MSAA (fixed for the page's life). */
  private readonly nativeAA: boolean;
  /** Bloom strength, threshold and radius in use (test hook). */
  readonly look = { strength: 0, threshold: 0, radius: 0, shafts: 0, zoom: 0, heat: 0, grade: false, ao: 0, aoRadius: 0 };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {
    this.nativeAA = !!renderer.getContext().getContextAttributes()?.antialias;
  }

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    if (this.needsComposer() && !this.composer) this.build();
  }

  /** Colour grade and vignette (Options). */
  get grading() { return this.gradeOn; }
  set grading(v: boolean) { this.gradeOn = v; }
  /** The grade pass is drawing this frame (else the page shows a plain vignette while grading is on). */
  get gradeInUse() { return this.gradeOn && !!this.composer && this.needsComposer(); }

  /**
   * Ambient occlusion (Options): soft shade where things meet, in creases and under overhangs. It needs the
   * composer, and can't share it with MSAA (the depth it reads isn't multisampled), so with it on, auto and MSAA
   * smooth edges with SMAA instead.
   */
  get ao() { return this.aoOn; }
  set ao(v: boolean) {
    if (v === this.aoOn) return;
    this.aoOn = v;
    this.dispose();
    if (this.needsComposer()) this.build();
    // first time on: build again once n8ao has loaded (until then the plain render pass stands in)
    if (v && !N8AO) void loadN8ao().then(() => { if (this.aoOn && !this.aoPass) { this.dispose(); if (this.needsComposer()) this.build(); } }).catch(() => {});
  }

  /** The AA pass the composer gets: what was asked for, except that AO turns auto and MSAA into SMAA. */
  private aaPassMode(): 'fxaa' | 'smaa' | null {
    const m = this.aaMode;
    if (m === 'fxaa' || m === 'smaa') return m;
    return this.aoOn && (m === 'auto' || m === 'msaa') ? 'smaa' : null;
  }

  get aa() { return this.aaMode; }
  set aa(m: AAMode) {
    if (m === this.aaMode) return;
    this.aaMode = m;
    this.dispose(); // the target's sample count and the AA pass are fixed at build
    if (this.needsComposer()) this.build();
  }

  /** What actually smooths edges right now (for the options row and tests). */
  get aaInUse(): 'off' | 'fxaa' | 'smaa' | 'msaa' {
    if (this.composer && this.needsComposer()) {
      if (this.aaPass) return this.aaPassMode()!;
      return this.samples() > 0 ? 'msaa' : 'off';
    }
    return this.nativeAA ? 'msaa' : 'off';
  }

  private samples() {
    if (this.aoOn) return 0;
    const q = new URLSearchParams(location.search).get('glowaa');
    if (q !== null) return Number(q) || 0;
    // the renderer's own antialias doesn't apply to render targets, so desktop multisamples the HDR target;
    // auto skips that on phones (dense screens hide the jaggies, and on SwiftShader 4× MSAA more than doubled the frame)
    if (this.aaMode === 'auto') return PHONE ? 0 : 4;
    return this.aaMode === 'msaa' ? 4 : 0;
  }

  /** Glow needs it; so do FXAA/SMAA, and MSAA on a canvas that wasn't made with its own. */
  private needsComposer() {
    const m = this.aaMode;
    return this.on || this.aoOn || m === 'fxaa' || m === 'smaa' || (m === 'msaa' && !this.nativeAA);
  }

  private dispose() {
    if (!this.composer) return;
    for (const p of this.composer.passes) p.dispose?.();
    this.composer.dispose();
    this.composer = this.bloom = this.shafts = this.distort = this.gradePass = this.aaPass = this.aoPass = null;
  }

  private build() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: this.samples() });
    const c = new EffectComposer(r, target);
    if (this.aoOn && N8AO) {
      const ao = new N8AO(this.scene, this.camera, size.x * pr, size.y * pr);
      ao.setQualityMode(PHONE ? 'Performance' : 'Low');
      const cf = ao.configuration;
      cf.halfRes = true;
      // the OutputPass after it does the colour space
      cf.gammaCorrection = false;
      cf.screenSpaceRadius = false;
      // shield domes, ghosts and glass don't occlude: skip the second transparent render
      cf.transparencyAware = false;
      c.addPass(ao);
      this.aoPass = ao;
    } else c.addPass(new RenderPass(this.scene, this.camera));
    const sh = new ShaderPass(ShaftShader);
    sh.enabled = false;
    c.addPass(sh);
    this.shafts = sh;
    const dp = new ShaderPass(DistortShader);
    dp.enabled = false;
    c.addPass(dp);
    this.distort = dp;
    const b = new UnrealBloomPass(new THREE.Vector2(size.x * pr * BLOOM_SCALE, size.y * pr * BLOOM_SCALE), 0.6, 0.5, 0.9);
    // the composer hands every pass the full size; keep the bloom chain smaller
    const setSize = b.setSize.bind(b);
    b.setSize = (w: number, h: number) => setSize(Math.max(1, Math.round(w * BLOOM_SCALE)), Math.max(1, Math.round(h * BLOOM_SCALE)));
    c.addPass(b);
    c.addPass(new OutputPass());
    const gp = new ShaderPass(GradeShader);
    c.addPass(gp);
    this.gradePass = gp;
    // FXAA/SMAA work on the final (tone-mapped, sRGB) picture, so they go last
    const am = this.aaPassMode();
    this.aaPass = am === 'fxaa' ? new FXAAPass() : am === 'smaa' ? new SMAAPass() : null;
    if (this.aaPass) c.addPass(this.aaPass);
    this.composer = c;
    this.bloom = b;
    this.resize();
  }

  /** After the renderer's size or pixel ratio changed. */
  resize() {
    if (!this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
  }

  /** Tune the bloom to the light (call once a frame, before render). */
  /**
   * Frames left to run the optional passes (sun shafts, heat shimmer / zoom blur) doing nothing, so their shaders
   * compile now instead of with a hitch the first time they switch on (main.ts sets it as the landing starts).
   */
  warm = 0;

  update(l: GlowLook) {
    if (!this.bloom) return;
    if (this.aoPass) {
      // reach in world units: a unit's height up close, more of a building's footprint from further out
      const d = l.camDist ?? 60;
      const cf = this.aoPass.configuration;
      cf.aoRadius = THREE.MathUtils.clamp(d * 0.22, 2.5, 14);
      cf.distanceFalloff = 1;
      // gone in orbit (no creases worth shading from there). It stays enabled: it's the pass that draws the scene
      cf.intensity = AO_STRENGTH * (1 - l.orbit);
      this.look.ao = cf.intensity;
      this.look.aoRadius = cf.aoRadius;
    }
    const surfaceThreshold = THREE.MathUtils.lerp(1.0, 0.72, l.night);
    const threshold = THREE.MathUtils.lerp(surfaceThreshold, 0.85, l.orbit);
    const strength = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.35, 0.55, l.night), 0.6, l.orbit);
    const radius = THREE.MathUtils.lerp(0.45, 0.3, l.night);
    const b = this.bloom;
    b.threshold = threshold;
    b.strength = strength;
    b.radius = radius;
    // a soft knee, so glow fades in rather than switching on at the threshold
    (b as unknown as { highPassUniforms: { smoothWidth: { value: number } } }).highPassUniforms.smoothWidth.value = 0.35;
    this.look.threshold = threshold; this.look.strength = strength; this.look.radius = radius;
    if (this.shafts) {
      const k = l.shafts ?? 0;
      this.shafts.enabled = k > 0.01 && !!l.sun;
      if (this.shafts.enabled) {
        const u = this.shafts.uniforms;
        u.uSun.value.copy(l.sun!);
        u.uStrength.value = k;
        const sz = this.renderer.getSize(new THREE.Vector2());
        u.uAspect.value = sz.x / Math.max(1, sz.y);
      }
      this.look.shafts = this.shafts.enabled ? k : 0;
    }
    if (this.distort) {
      const heat = l.heat ?? [], hk = l.heatK ?? 0, zoom = l.zoom ?? 0;
      const on = (heat.length > 0 && hk > 0.01) || zoom > 0.0005;
      this.distort.enabled = on;
      if (on) {
        const u = this.distort.uniforms;
        u.uZoom.value = zoom;
        u.uTime.value = l.time ?? 0;
        u.uHeatK.value = hk;
        u.uHeatN.value = Math.min(HEAT_MAX, heat.length);
        for (let i = 0; i < u.uHeatN.value; i++) (u.uHeat.value as THREE.Vector3[])[i].copy(heat[i]);
        const sz = this.renderer.getSize(new THREE.Vector2());
        u.uAspect.value = sz.x / Math.max(1, sz.y);
      }
      this.look.zoom = zoom; this.look.heat = on ? Math.min(HEAT_MAX, heat.length) : 0;
    }
    if (this.warm > 0) {
      this.warm--;
      if (this.shafts && !this.shafts.enabled) { this.shafts.enabled = true; this.shafts.uniforms.uStrength.value = 0; }
      if (this.distort && !this.distort.enabled) {
        this.distort.enabled = true;
        const u = this.distort.uniforms;
        u.uZoom.value = 0; u.uHeatK.value = 0; u.uHeatN.value = 0;
      }
    }
    this.updateGrade(l);
  }

  private updateGrade(l: GlowLook) {
    const gp = this.gradePass;
    if (!gp) return;
    gp.enabled = this.gradeOn;
    this.look.grade = this.gradeOn;
    if (!this.gradeOn) return;
    const u = gp.uniforms;
    const g = l.grade;
    const n = l.night * (1 - l.orbit), gold = (l.golden ?? 0) * (1 - l.orbit);
    // the grade is the surface's: it eases off in orbit (space keeps its own colours)
    const k = 1 - l.orbit;
    (u.uLift.value as THREE.Color).setRGB(0, 0, 0);
    (u.uGain.value as THREE.Color).setRGB(1, 1, 1);
    if (g) {
      (u.uLift.value as THREE.Color).copy(g.lift).multiplyScalar(k);
      (u.uGain.value as THREE.Color).lerp(g.gain, k);
    }
    (u.uLift.value as THREE.Color).lerp(NIGHT_LIFT, n * 0.6);
    (u.uGain.value as THREE.Color).multiply(this.tmpC.setRGB(1, 1, 1).lerp(GOLDEN_GAIN, gold));
    u.uSat.value = THREE.MathUtils.lerp(1, g?.sat ?? 1, k) * (1 - 0.12 * n);
    u.uContrast.value = THREE.MathUtils.lerp(1, g?.contrast ?? 1, k);
    u.uVig.value = THREE.MathUtils.lerp(0.32, 0.18, l.orbit);
    const sz = this.renderer.getSize(this.tmpV);
    u.uAspect.value = sz.x / Math.max(1, sz.y);
  }
  private tmpC = new THREE.Color();
  private tmpV = new THREE.Vector2();

  render(dt: number) {
    if (this.composer && this.needsComposer()) {
      // with Glow off the composer is only here for anti-aliasing: skip bloom and the glow-only effects
      if (!this.on) this.bloom!.enabled = this.shafts!.enabled = this.distort!.enabled = false;
      else this.bloom!.enabled = true;
      this.gradePass!.enabled = this.gradeOn;
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);
  }
}
