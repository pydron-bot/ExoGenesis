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
 * The threshold follows the light: low at night, so glow strips, pods, floodlight
 * pools and gunfire bloom; high by day, so only the hottest things (flashes,
 * explosions, the sun) do and sunlit ground never washes out.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Sun shafts (with Glow on): light streaming from the sun past whatever stands in front of it. The
 * bright sky and sun round the sun's place on screen are smeared toward it in 40 steps that fade as they
 * go (GPU Gems 3, ch. 13), so flora, hills and buildings against the sun cut dark gaps in the rays. Off
 * (and skipped) when the sun is far off screen or the strength is 0.
 */
/**
 * Heat shimmer and zoom blur in one pass (with Glow on). Shimmer: up to 8 sources (the screen position
 * and size of a working reactor, generator, core…): inside a column rising from each, the picture
 * wobbles with fine travelling ripples. Zoom blur: while the camera zooms fast, the frame is smeared
 * toward/away from the middle (10 taps), as a lens would on a quick pull.
 */
const DistortShader = {
  uniforms: {
    tDiffuse: { value: null }, uZoom: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uHeatK: { value: 0 },
    uHeatN: { value: 0 }, uHeat: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uZoom, uTime, uAspect, uHeatK;
    uniform int uHeatN;
    uniform vec3 uHeat[8];
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      for (int i = 0; i < 8; i++) {
        if (i >= uHeatN) break;
        vec3 h = uHeat[i];
        vec2 d = (vUv - h.xy) * vec2(uAspect, 1.0);
        // a column: narrow at the source, rising and spreading above it
        float w = h.z * (0.55 + 0.6 * clamp(d.y / h.z, 0.0, 2.0));
        float col = exp(-pow(d.x / w, 2.0)) * smoothstep(-0.2 * h.z, 0.3 * h.z, d.y) * (1.0 - smoothstep(1.2 * h.z, 3.2 * h.z, d.y));
        float fi = float(i) * 1.7;
        vec2 wob = vec2(sin(vUv.y * 220.0 - uTime * 7.0 + fi) + 0.5 * sin(vUv.y * 470.0 - uTime * 11.0), cos(vUv.x * 160.0 + uTime * 5.0 + fi));
        uv += wob * 0.0016 * col * uHeatK;
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
      vec2 delta = (vUv - uSun) * (0.85 / 40.0);
      vec2 uv = vUv;
      float decay = 1.0, sum = 0.0;
      for (int i = 0; i < 40; i++) {
        uv -= delta;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        sum += smoothstep(0.5, 1.3, l) * decay;
        decay *= 0.955;
      }
      vec2 off = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = 1.0 / (1.0 + dot(off, off) * 6.0);
      gl_FragColor = vec4(base.rgb + uTint * sum * (1.6 / 40.0) * uStrength * fall, base.a);
    }`,
};

/** Bloom works at this fraction of the canvas resolution (the pass halves it again for its first level). */
const BLOOM_SCALE = 0.5;

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
}

export class Post {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private shafts: ShaderPass | null = null;
  private distort: ShaderPass | null = null;
  private on = false;
  /** Bloom strength, threshold and radius in use (test hook). */
  readonly look = { strength: 0, threshold: 0, radius: 0, shafts: 0, zoom: 0, heat: 0 };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    if (v && !this.composer) this.build();
  }

  private build() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    // HDR. The renderer's own antialias doesn't apply to render targets, so desktop multisamples it; phones
    // skip that (dense screens hide the jaggies, and on SwiftShader 4× MSAA more than doubled the frame:
    // phone size, dpr 1: ~190 ms with it, ~80 ms without, vs ~100 ms with glow off). ?glowaa=N overrides.
    const aa = Number(new URLSearchParams(location.search).get('glowaa') ?? (matchMedia('(pointer: coarse)').matches ? 0 : 4));
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: aa });
    const c = new EffectComposer(r, target);
    c.addPass(new RenderPass(this.scene, this.camera));
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
  update(l: GlowLook) {
    if (!this.bloom) return;
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
        u.uHeatN.value = Math.min(8, heat.length);
        for (let i = 0; i < u.uHeatN.value; i++) (u.uHeat.value as THREE.Vector3[])[i].copy(heat[i]);
        const sz = this.renderer.getSize(new THREE.Vector2());
        u.uAspect.value = sz.x / Math.max(1, sz.y);
      }
      this.look.zoom = zoom; this.look.heat = on ? Math.min(8, heat.length) : 0;
    }
  }

  render(dt: number) {
    if (this.on && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
