/**
 * Sky reflections: an environment map baked from the sky as it is now, so metal and glossy surfaces have
 * something to reflect (without one, metalness just darkens them: hulls read as black cut-outs) and every
 * standard material picks up a little light from the sky and ground round it.
 *
 * A tiny scene (one inside-out sphere: zenith, horizon and ground colours plus a bright sun spot) is turned
 * into a PMREM by three's PMREMGenerator and set as `scene.environment`. The sky only changes slowly (the
 * time of day, weather), so it's re-baked only when its colours or the sun have moved past a small step, and
 * at most every MIN_GAP seconds: a bake is a few small cube renders, cheap enough for phones.
 */
import * as THREE from 'three';

/** Re-bake at most this often (seconds): a sol is minutes long, so the sun moves only a degree or so a second. */
const MIN_GAP = 1.5;
/** The baked cube's face size: reflections are soft, so a small one does. */
const SIZE = 128;

export interface SkyLook {
  /** Overhead, at the horizon, and the ground round about (linear colours, as the scene renders them). */
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  /** Unit vector toward the sun, and its colour × brightness in the reflection (0 = below the horizon). */
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  /** The landing site's up. */
  up: THREE.Vector3;
}

export class SkyEnv {
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private mat: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget | null = null;
  private key = '';
  private lastBake = -1e9;
  private on = true;
  /** Bakes so far (test hook). */
  bakes = 0;

  constructor(renderer: THREE.WebGLRenderer, private target: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uGround, uSun, uSunCol, uUp;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = dot(d, uUp);
          // sky: horizon to zenith; below: the horizon's haze into the ground
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.6));
          vec3 c = h >= 0.0 ? sky : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -h));
          // the sun: a small bright disc and a soft glow round it (the glints on metal)
          float cs = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(cs, 900.0) * 40.0 + pow(cs, 24.0) * 0.6) * smoothstep(-0.05, 0.02, h);
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.mat));
  }

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    this.key = '';
    if (!v) { this.target.environment = null; this.rt?.dispose(); this.rt = null; }
  }

  /** How strongly the environment lights and reflects (0..1, e.g. faded out away from the ground). */
  set intensity(k: number) { this.target.environmentIntensity = k; }

  /**
   * A material that takes less of the sky than the rest (call each frame; materials can be swapped). The scene's
   * environment has one strength for everything, so this gives the material the map itself, with its own
   * strength: matte ground lit as strongly as metal loses the shading that shows its hills.
   */
  own(mat: THREE.Material | THREE.Material[], k: number) {
    if (Array.isArray(mat)) { for (const m of mat) this.own(m, k); return; }
    const m = mat as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial) return;
    // 0: no map at all (no per-pixel lookups: the ground is most of the screen, and they cost a phone ~2.5 ms)
    const tex = this.on && k > 0 ? this.rt?.texture ?? null : null;
    if (m.envMap !== tex) m.envMap = tex;
    m.envMapIntensity = k;
  }

  /** Call each frame; bakes when the sky has changed enough (and not too often). `now` in seconds. */
  update(look: SkyLook, now: number) {
    if (!this.on) return;
    const q = (c: THREE.Color) => `${Math.round(c.r * 40)},${Math.round(c.g * 40)},${Math.round(c.b * 40)}`;
    // the sun to about 3°
    const s = look.sun;
    const key = `${q(look.zenith)}|${q(look.horizon)}|${q(look.ground)}|${q(look.sunColor)}|${Math.round(s.x * 20)},${Math.round(s.y * 20)},${Math.round(s.z * 20)}`;
    if (key === this.key || now - this.lastBake < MIN_GAP) return;
    this.key = key;
    this.lastBake = now;
    const u = this.mat.uniforms;
    u.uZenith.value.copy(look.zenith);
    u.uHorizon.value.copy(look.horizon);
    u.uGround.value.copy(look.ground);
    u.uSun.value.copy(look.sun);
    u.uSunCol.value.copy(look.sunColor);
    u.uUp.value.copy(look.up);
    const rt = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size: SIZE });
    this.rt?.dispose();
    this.rt = rt;
    this.target.environment = rt.texture;
    this.bakes++;
  }
}
