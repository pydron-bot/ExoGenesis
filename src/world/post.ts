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

/** Bloom works at this fraction of the canvas resolution (the pass halves it again for its first level). */
const BLOOM_SCALE = 0.5;

export interface GlowLook {
  /** 0 day .. 1 night at the landing site. */
  night: number;
  /** 0 on the surface .. 1 up in orbit or beyond. */
  orbit: number;
}

export class Post {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private on = false;
  /** Bloom strength, threshold and radius in use (test hook). */
  readonly look = { strength: 0, threshold: 0, radius: 0 };

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
  }

  render(dt: number) {
    if (this.on && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
