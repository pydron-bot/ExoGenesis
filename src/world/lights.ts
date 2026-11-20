/**
 * Colony lighting (on by default; `?lights=0` leaves it out, the ⋯ menu turns it off).
 *
 * Two layers:
 *  1. A light map: every light source (floodlights, the core and its beacon,
 *     headlights, muzzle flashes, explosions) is drawn as a soft additive blob
 *     into a small top-down HDR texture covering the region, once a frame.
 *     Every lit material on the surface samples it at its own position, so
 *     hundreds of lights cost one tiny render pass plus one texture read. No
 *     shadows, and no light direction beyond "facing up gets more" — fine from an
 *     RTS camera.
 *     The map's alpha channel carries ground shadows the same way: every
 *     building, drone and vehicle draws a soft dark blob under itself, pushed
 *     away from the sun and stretched as it sinks (long shadows at dusk), so
 *     things sit on the ground instead of floating. Shadows only darken
 *     fragments near the ground, and they stay on when the lights are off
 *     (`?shadows=0` leaves them out).
 *  2. On desktop, two real point lights (fixed count, so shaders never
 *     recompile) handed each frame to the biggest live explosions, for proper
 *     highlights on the sides of things. Phones get none (see REAL).
 *
 * Floodlights come from the building records (lightColor, lightRadius,
 * lightIntensity, lightFlicker; editable in the editor).
 *
 * Materials are patched lazily on first draw (a Mesh.onBeforeRender hook), so
 * models that load later light up without anyone having to remember to call
 * this. The shader only acts inside the region, so the globe and the solar
 * system are untouched.
 */
import * as THREE from 'three';
import { E, HALF, N, R, U } from './planet';
import { GRID_N, rawGrid, regionPoint } from './heightGrid';

/** Light map resolution: 256² over the 240 u region ≈ 1 texel per unit. */
const RES = 256;
const MAX_BLOBS = 4096;
const MAX_FLASHES = 384;
/**
 * Real point lights for the biggest flashes. Every lit shader pays for each one on every pixel, so phones
 * (fill-bound) get none and rely on the light map alone. `?lreal=N` overrides.
 */
const REAL = Number(new URLSearchParams(location.search).get('lreal') ?? (matchMedia('(pointer: coarse)').matches ? 0 : 2));

const rt = new THREE.WebGLRenderTarget(RES, RES, {
  type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
});

/** Ground height per region grid node, so the shader knows how far above the ground a fragment is. */
function heightTexture() {
  const g = rawGrid();
  const data = new Uint16Array(g.length);
  for (let i = 0; i < g.length; i++) data[i] = THREE.DataUtils.toHalfFloat(Math.max(0, g[i]));
  const t = new THREE.DataTexture(data, GRID_N, GRID_N, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const lightUniforms = {
  uLmTex: { value: rt.texture as THREE.Texture },
  uLmH: { value: null as THREE.Texture | null },
  uLmOn: { value: 0 },
  /** Ground shadows (the map's alpha) on or off. */
  uShOn: { value: 0 },
  uLmU: { value: U.clone() },
  uLmE: { value: E.clone() },
  uLmN: { value: N.clone() },
  uLmR: { value: R },
  uLmHalf: { value: HALF },
  /** Region up in view space (lights fall mostly on upward faces). */
  uLmUpV: { value: new THREE.Vector3(0, 1, 0) },
};

const LIT = /#include <lights_fragment_end>/;

/** Make `mat` receive the light map. Safe to call repeatedly; skips materials without lighting. */
export function addLights(mat: THREE.Material) {
  if (mat.userData.lm !== undefined) return;
  const ok = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshPhongMaterial;
  mat.userData.lm = ok;
  if (!ok) return;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!LIT.test(sh.fragmentShader)) return;
    Object.assign(sh.uniforms, lightUniforms);
    // everything positional (where in the light map, how high above the ground) is worked out per vertex;
    // the fragment does one texture read
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLmH;
        uniform float uLmR, uLmHalf;
        uniform vec3 uLmU, uLmE, uLmN;
        varying vec2 vLmUv;
        varying float vLmK;
        varying float vLmS;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 lmW4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            lmW4 = instanceMatrix * lmW4;
          #endif
          vec3 lmW = (modelMatrix * lmW4).xyz;
          float lmRad = length(lmW);
          vec3 fd = lmW / lmRad;
          float up = dot(fd, uLmU);
          vec2 rp = uLmR * vec2(dot(fd, uLmE), dot(fd, uLmN)) / max(up, 0.5);
          vLmUv = (rp + uLmHalf) / (2.0 * uLmHalf);
          vLmK = 0.0;
          vLmS = 0.0;
          if (lmRad < uLmR + 400.0 && up > 0.5 && abs(rp.x) < uLmHalf && abs(rp.y) < uLmHalf) {
            float g = texture2D(uLmH, (rp + uLmHalf + 0.5) / (2.0 * uLmHalf + 1.0)).r;
            float lift = max(0.0, lmRad - uLmR - g);
            // pools on the ground: tall things catch less the higher they reach
            vLmK = 1.0 / (1.0 + lift * lift * 0.006);
            // shadows lie on the ground: only the bottom of things is darkened
            vLmS = 1.0 - smoothstep(0.3, 2.4, lift);
          }
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLmTex;
        uniform float uLmOn, uShOn;
        uniform vec3 uLmUpV;
        varying vec2 vLmUv;
        varying float vLmK;
        varying float vLmS;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        vec4 lmT = vec4(0.0);
        if ((uLmOn > 0.001 && vLmK > 0.002) || (uShOn > 0.001 && vLmS > 0.002)) lmT = texture2D(uLmTex, vLmUv);
        if (uShOn > 0.001 && vLmS > 0.002) {
          // sun (direct) light is blocked; sky light only partly (contact shade)
          float sh = min(lmT.a, 0.8) * vLmS * uShOn;
          reflectedLight.directDiffuse *= 1.0 - sh;
          reflectedLight.directSpecular *= 1.0 - sh;
          reflectedLight.indirectDiffuse *= 1.0 - sh * 0.55;
        }
        if (uLmOn > 0.001 && vLmK > 0.002) {
          vec3 L = lmT.rgb;
          L /= 1.0 + 0.35 * dot(L, vec3(0.333)); // soft cap: a parked army's headlights shouldn't white out
          // tops catch more than sides
          float k = uLmOn * vLmK * (0.45 + 0.55 * max(dot(normal, uLmUpV), 0.0));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * L * k;
        }`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|lm`;
  mat.needsUpdate = true;
}

function patchObject(o: THREE.Object3D) {
  const m = (o as THREE.Mesh).material;
  if (!m) return;
  if (Array.isArray(m)) m.forEach(addLights); else addLights(m);
}

// ---------- the light map pass ----------

const blobVert = /* glsl */ `
  attribute vec3 aCol;
  attribute float aShape;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vShape;
  void main() {
    vCol = aCol; vShape = aShape; vUv = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const blobFrag = /* glsl */ `
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vShape;
  void main() {
    vec2 p = vUv;
    float w;
    if (vShape > 1.5) {
      // a shadow: a soft ellipse, written to alpha only
      float d = dot(p, p);
      w = max(0.0, 1.0 - d);
      gl_FragColor = vec4(0.0, 0.0, 0.0, vCol.r * w * sqrt(w));
      return;
    }
    if (vShape > 0.5) {
      // a headlight: narrow at the lamp (y = -1), widening and fading toward the far end
      float along = (p.y + 1.0) * 0.5;
      p.x /= 0.25 + 0.75 * along;
      float d = dot(p, p);
      w = max(0.0, 1.0 - d);
      w = w * w * (1.0 - along * 0.6);
    } else {
      float d = dot(p, p);
      w = max(0.0, 1.0 - d);
      w *= w;
    }
    gl_FragColor = vec4(vCol * w, 0.0);
  }`;

interface Flash { x: number; z: number; r: number; i: number; col: THREE.Color; life: number; max: number; real: boolean }

/** Colour and strength of a light source. */
export interface LightLook { color: string; radius: number; intensity: number; flicker?: boolean }

/** Floodlight fields of a building record (content/buildings/*.json). */
export interface LightFields { lightColor?: string; lightRadius?: number; lightIntensity?: number; lightFlicker?: boolean }

const BEACON = new THREE.Color('#ffb547');
const SCAFFOLD = new THREE.Color('#7fe8ff'); // the printer's cyan (src/world/print.ts)
const HEADLIGHT = new THREE.Color('#e6f6ff');

/** Light-relevant view of an army (ArmyView), kept structural so this module has no skirmish imports. */
export interface ArmyLights {
  slots: number;
  readonly visible: Uint8Array;
  readonly type: Uint8Array;
  readonly lx: Float32Array;
  readonly lz: Float32Array;
  readonly hd: Float32Array;
  /** Height above the ground per slot (flyers): the shadow falls away from the unit, down-sun. */
  readonly lift?: Float32Array;
}

export class ColonyLights {
  private scene = new THREE.Scene();
  // the region's size and body are set by now (main.ts loads the region first)
  private cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, -10, 10);
  private blobs: THREE.InstancedMesh;
  private aCol: THREE.InstancedBufferAttribute;
  private aShape: THREE.InstancedBufferAttribute;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private c = new THREE.Color();
  private flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({ x: 0, z: 0, r: 0, i: 0, col: new THREE.Color(), life: 0, max: 1, real: false }));
  private nextFlash = 0;
  private real: THREE.PointLight[] = [];
  private armies: { army: ArmyLights; team: (type: number) => number; size: (type: number) => number }[] = [];
  private colors = new Map<string, THREE.Color>();
  /** Floodlight per building kind, from the building records. */
  private looks: Record<string, LightLook> = {};
  private on = true;
  private shade = true;
  /** Sun direction in region terms: horizontal (x, z) and elevation; set each update. */
  private sun = { x: 0, z: 0, up: 1 };
  /** 0 day .. 1 night: steady lights are faint by day. */
  night = 0;
  /** Count of blobs drawn last frame (debug / tests). */
  drawn = 0;

  constructor(scene: THREE.Scene) {
    lightUniforms.uLmR.value = R;
    lightUniforms.uLmHalf.value = HALF;
    lightUniforms.uLmH.value = heightTexture();
    lightUniforms.uLmOn.value = 1;
    this.shadows = new URLSearchParams(location.search).get('shadows') !== '0';
    const geo = new THREE.PlaneGeometry(2, 2);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOBS * 3), 3);
    this.aShape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOBS), 1);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aShape.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aShape', this.aShape);
    this.blobs = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      vertexShader: blobVert, fragmentShader: blobFrag,
      // plain additive on all four channels: light sums in rgb, shadow in alpha
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }), MAX_BLOBS);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.scene.add(this.blobs);
    this.cam.position.z = 5;

    for (let i = 0; i < REAL; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 30, 2);
      scene.add(l);
      this.real.push(l);
    }
    // patch every lit material the first time it's drawn
    THREE.Mesh.prototype.onBeforeRender = function (this: THREE.Mesh, _r, _s, _c, _g, mat) { addLights(mat); };
    scene.traverse(patchObject);
  }

  /** Floodlights per building kind from the building records (lightColor, lightRadius, …). */
  setLooks(defs: Record<string, LightFields>) {
    this.looks = {};
    for (const [kind, d] of Object.entries(defs)) {
      if (!d.lightColor || !(d.lightRadius! > 0)) continue;
      this.looks[kind] = { color: d.lightColor, radius: d.lightRadius!, intensity: d.lightIntensity ?? 1, flicker: d.lightFlicker };
    }
  }

  /** Lights on or off (the ⋯ menu): off skips the light map in every shader and the pass itself. */
  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    lightUniforms.uLmOn.value = v ? 1 : 0;
    if (!v) for (const l of this.real) l.intensity = 0;
  }

  /** Ground shadows on or off (`?shadows=0`). They don't depend on the lights being on. */
  get shadows() { return this.shade; }
  set shadows(v: boolean) {
    this.shade = v;
    lightUniforms.uShOn.value = v ? 1 : 0;
  }

  /**
   * Register an army: its player vehicles get headlights (`team(type)` → 0 player, 1 fauna), and
   * every unit a shadow `size(type)` across (body radius) and about as tall.
   */
  addArmy(army: ArmyLights, team: (type: number) => number, size: (type: number) => number = () => 1) { this.armies.push({ army, team, size }); }

  /**
   * Queue a ground shadow for something `r` in radius and `h` tall standing at (x, z): a soft
   * contact patch under it plus (with `cast`) the sun's shadow, pushed away from the sun and
   * longer as it sinks. Small things get one blob that does both.
   */
  shadow(x: number, z: number, r: number, h: number, cast = true) {
    if (!this.shade) return;
    const s = this.sun;
    const day = THREE.MathUtils.smoothstep(s.up, -0.02, 0.2);
    // shadow length along the ground: h / tan(elevation), capped so dawn doesn't paint the map
    const len = day > 0 ? Math.min(h * Math.sqrt(Math.max(0, 1 - s.up * s.up)) / Math.max(s.up, 0.12), h * 4) : 0;
    const heading = Math.atan2(-s.x, -s.z);
    if (!cast || r < 2.5) {
      const off = len * 0.35 * day;
      this.shadowBlob(x + Math.sin(heading) * off, z + Math.cos(heading) * off, r * 1.35, r * 1.35 + off, heading, 0.5 + 0.25 * day);
      return;
    }
    this.shadowBlob(x, z, r * 1.25, r * 1.25, 0, 0.45);
    if (day > 0.01) {
      const half = r + len * 0.5;
      const c = len * 0.5;
      this.shadowBlob(x + Math.sin(heading) * c, z + Math.cos(heading) * c, r * 1.05, half, heading, 0.68 * day);
    }
  }

  /**
   * The shadow of something `r` across flying `h` up over (x, z): detached from it, cast down-sun (straight
   * under it at night, faint), a little softer and lighter the higher it is.
   */
  airShadow(x: number, z: number, r: number, h: number) {
    if (!this.shade) return;
    const s = this.sun;
    const day = THREE.MathUtils.smoothstep(s.up, -0.02, 0.2);
    const len = day > 0 ? Math.min(h * Math.sqrt(Math.max(0, 1 - s.up * s.up)) / Math.max(s.up, 0.12), h * 3) * day : 0;
    const heading = Math.atan2(-s.x, -s.z);
    this.shadowBlob(x + Math.sin(heading) * len, z + Math.cos(heading) * len, r * 1.4, r * 1.6, heading, 0.25 + 0.3 * day);
  }

  private shadowBlob(x: number, z: number, w: number, half: number, heading: number, dark: number) {
    if (this.n >= MAX_BLOBS) return;
    if (Math.abs(x) > HALF + half || Math.abs(z) > HALF + half) return;
    const j = this.n++;
    this.q.setFromAxisAngle(this.zAxis, -heading);
    this.m.compose(this.p.set(x, z, 0), this.q, this.s.set(w, half, 1));
    this.aShape.array[j] = 2;
    this.blobs.setMatrixAt(j, this.m);
    this.aCol.array[j * 3] = dark;
    this.aCol.array[j * 3 + 1] = 0;
    this.aCol.array[j * 3 + 2] = 0;
  }

  private color(hex: string) {
    let c = this.colors.get(hex);
    if (!c) { c = new THREE.Color(hex); this.colors.set(hex, c); }
    return c;
  }

  /** Queue one light blob for this frame: region (x, z), radius, colour × intensity; heading ≠ null makes it a forward cone. */
  blob(x: number, z: number, r: number, col: THREE.Color, i: number, heading: number | null = null, len = r) {
    if (this.n >= MAX_BLOBS || i <= 0.001) return;
    if (Math.abs(x) > HALF + r || Math.abs(z) > HALF + r) return;
    const j = this.n++;
    if (heading === null) {
      this.m.makeScale(r, r, 1).setPosition(x, z, 0);
      this.aShape.array[j] = 0;
    } else {
      // forward in region coords is (sin h, cos h); the quad's +y points along it after rotating by −h
      this.q.setFromAxisAngle(this.zAxis, -heading);
      const half = len / 2;
      this.p.set(x + Math.sin(heading) * half, z + Math.cos(heading) * half, 0);
      this.m.compose(this.p, this.q, this.s.set(r * 0.55, half, 1));
      this.aShape.array[j] = 1;
    }
    this.blobs.setMatrixAt(j, this.m);
    this.aCol.array[j * 3] = col.r * i;
    this.aCol.array[j * 3 + 1] = col.g * i;
    this.aCol.array[j * 3 + 2] = col.b * i;
  }

  /** A short-lived light (shot, impact, explosion). `real` lets it borrow one of the point lights. */
  flash(x: number, z: number, r: number, color: THREE.Color, i: number, life: number, real = false) {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % MAX_FLASHES;
    f.x = x; f.z = z; f.r = r; f.i = i; f.col.copy(color); f.life = f.max = life; f.real = real;
  }

  /** Sim effect events (skirmish FX layout): see skirmish/types FX. */
  fx(kind: number, x1: number, z1: number, x2: number, z2: number) {
    const C = FXC;
    switch (kind) {
      case 0: this.flash(x1, z1, 4, C.rover, 1.2, 0.08); this.flash(x2, z2, 3, C.rover, 0.8, 0.12); break; // rover shot
      case 1: case 6: // tank / turret shot: a muzzle flash and a hit
        this.flash(x1, z1, 7, C.tank, 2.0, 0.1);
        this.flash(x2, z2, 5, C.tank, 1.4, 0.2);
        break;
      case 2: this.flash(x2, z2, 3, C.bite, 0.8, 0.12); break; // bite
      case 13: this.flash(x1, z1, 5, C.rail, 1.6, 0.1); this.flash(x2, z2, 6, C.rail, 1.8, 0.2); break; // rail
      case 3: this.flash(x1, z1, 8, C.dieSmall, 2.2, 0.4, true); break; // small death
      case 4: this.flash(x1, z1, 16, C.dieBig, 3.0, 0.7, true); break; // big death
      case 5: this.flash(x1, z1, 7, C.coreHit, 1.6, 0.25); break; // core hit
      case 7: // shell: the gun flash when fired; the wide burst comes when it lands (the battle effects send x1 = x2 then)
        if (x1 === x2 && z1 === z2) this.flash(x2, z2, 14, C.shell, 3.0, 0.6, true);
        else this.flash(x1, z1, 8, C.shell, 2.2, 0.12);
        break;
      case 8: this.flash(x2, z2, 9, C.arc, 2.2, 0.15, true); this.flash(x1, z1, 5, C.arc, 1.2, 0.1); break; // arc
      case 9: this.flash(x2, z2, 5, C.spit, 1.2, 0.3); break; // spit
      case 10: this.flash(x1, z1, 10, C.emerge, 1.0, 0.8); break; // burrower surfaces
      case 11: this.flash(x2, z2, 4, C.repair, 0.8, 0.2); break; // repair beam
      case 12: this.flash(x1, z1, 3.5, C.pd, 1.2, 0.05); break; // point-defense
      case 14: this.flash(x1, z1, 6, C.shield, 1.4, 0.25); break; // a hit on a shield
    }
  }

  /**
   * Gather this frame's lights and render the light map. Call once a frame,
   * before the main render.
   */
  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera, dt: number, t: number, src: {
    buildings?: { kind: string; x: number; z: number; progress: number; powered: boolean; yaw?: number }[];
    core?: { x: number; z: number; beacon: number } | null;
    drones?: { x: number; z: number; heading: number }[];
    /** Direction toward the sun (world space), for the shadows. */
    sun?: THREE.Vector3;
    /** Building sizes for their shadows: body radius and height per kind. */
    sizes?: Record<string, { r: number; h: number }>;
    /** Scarred land (planet health): dark patches, bigger and darker the deeper the scar (a: health points). */
    scars?: { x: number; z: number; a: number }[];
  }) {
    this.n = 0;
    if (src.sun) {
      const d = src.sun;
      this.sun.x = d.dot(E); this.sun.z = d.dot(N); this.sun.up = d.dot(U);
    }
    // shadows first: under the lights in draw order (it doesn't matter for the sums, but keeps the cap fair)
    if (this.shade) {
      for (const sc of src.scars ?? []) {
        const w = Math.min(14, 3 + Math.sqrt(sc.a) * 2.5);
        this.shadowBlob(sc.x, sc.z, w, w * 1.15, (sc.x * 0.37 + sc.z * 0.61) % Math.PI, Math.min(0.55, 0.2 + sc.a * 0.05));
      }
      for (const b of src.buildings ?? []) {
        const sz = src.sizes?.[b.kind];
        if (!sz) continue;
        this.shadow(b.x, b.z, sz.r, sz.h * Math.max(0.15, Math.min(1, b.progress)));
      }
      if (src.core) this.shadow(src.core.x, src.core.z, src.sizes?.core?.r ?? 5, src.sizes?.core?.h ?? 8);
      for (const d of src.drones ?? []) this.shadow(d.x, d.z, 0.9, 1.6, false);
      for (const { army, size } of this.armies) {
        for (let s = 0; s < army.slots; s++) {
          if (!army.visible[s]) continue;
          const r = size(army.type[s]), up = army.lift?.[s] ?? 0;
          if (up > 2) this.airShadow(army.lx[s], army.lz[s], r, up);
          else this.shadow(army.lx[s], army.lz[s], r, r * 1.3, false);
        }
      }
    }
    if (!this.on) { this.render(renderer, camera); return; }
    const steady = (0.12 + 0.88 * this.night) * 0.75;
    // floodlights
    for (const b of src.buildings ?? []) {
      if (b.kind === 'core') continue;
      if (b.progress < 1) {
        // construction work light, a little restless
        this.blob(b.x, b.z, 9, SCAFFOLD, 0.35 * steady * (0.85 + 0.15 * Math.sin(t * 9 + b.x)));
        continue;
      }
      const l = this.looks[b.kind];
      if (!l || !b.powered) continue;
      const f = l.flicker ? 0.85 + 0.15 * Math.sin(t * 5.3 + b.z) * Math.sin(t * 2.1 + b.x) : 1;
      this.blob(b.x, b.z, l.radius, this.color(l.color), l.intensity * steady * f);
    }
    if (src.core) {
      const c = src.core;
      const l = this.looks.core;
      if (l) this.blob(c.x, c.z, l.radius, this.color(l.color), l.intensity * steady);
      // the beacon: a slow amber pulse washing a wide circle
      this.blob(c.x, c.z, 34, BEACON, c.beacon * 0.18 * steady);
    }
    // headlights: drones and player vehicles
    for (const d of src.drones ?? []) this.blob(d.x, d.z, 7, HEADLIGHT, 1.6 * steady, d.heading, 12);
    for (const { army, team } of this.armies) {
      for (let s = 0; s < army.slots; s++) {
        if (!army.visible[s] || team(army.type[s]) !== 0) continue;
        this.blob(army.lx[s], army.lz[s], 8, HEADLIGHT, 1.8 * steady, army.hd[s], 16);
      }
    }
    // flashes, and the biggest few get the real point lights
    const flashK = 0.55 + 0.45 * this.night;
    let nReal = 0;
    const best: Flash[] = [];
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) continue;
      const k = f.life / f.max;
      const grow = 0.6 + 0.4 * (1 - k);
      this.blob(f.x, f.z, f.r * grow, f.col, f.i * k * k * flashK);
      if (f.real) best.push(f);
    }
    if (best.length > REAL) best.sort((a, b) => b.i * b.r * (b.life / b.max) - a.i * a.r * (a.life / a.max));
    for (const l of this.real) {
      const f = best[nReal++];
      if (!f) { l.intensity = 0; continue; }
      const k = f.life / f.max;
      regionPoint(f.x, f.z, 2.5, l.position);
      l.color.copy(f.col);
      l.distance = f.r * 1.6;
      l.intensity = 60 * f.i * k * k * flashK;
    }

    this.render(renderer, camera);
  }

  private render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.on && !this.shade) return;
    this.blobs.count = this.n;
    this.drawn = this.n;
    this.blobs.instanceMatrix.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aShape.needsUpdate = true;
    // region up in view space for the shader
    lightUniforms.uLmUpV.value.copy(U).transformDirection(camera.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(this.c);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (this.n) renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.c, prevAlpha);
    renderer.autoClear = prevAuto;
  }
}

const FXC = {
  rover: new THREE.Color('#7ff8ff'), tank: new THREE.Color('#ffc46b'), bite: new THREE.Color('#ff6a4d'),
  dieSmall: new THREE.Color('#ff8a3d'), dieBig: new THREE.Color('#ffb547'), coreHit: new THREE.Color('#ff4d5e'),
  shell: new THREE.Color('#ff9a3d'), arc: new THREE.Color('#b9a6ff'), spit: new THREE.Color('#a6ff4d'),
  emerge: new THREE.Color('#c08a4a'), repair: new THREE.Color('#5bff9a'), pd: new THREE.Color('#fff07a'), rail: new THREE.Color('#e8fbff'),
  shield: new THREE.Color('#7fe8ff'),
};

/** The live instance (null with `?lights=0`). Renderers that make light (ArmyView) check this. */
export let colonyLights: ColonyLights | null = null;
export function enableColonyLights(scene: THREE.Scene) {
  colonyLights ??= new ColonyLights(scene);
  return colonyLights;
}
