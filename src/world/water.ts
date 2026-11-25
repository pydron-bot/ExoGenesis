/**
 * Seas at ground level: a water surface at sea level over the landing region
 * and out to the horizon, drawn over a seabed that sinks below it (the terrain
 * patch and the globe sink their underwater ground, see `seabed`).
 *
 * The water knows how deep it is at every vertex (`aDepth`, sampled from the
 * same `surfaceAt` as the ground), so without a depth pass it can:
 *  - shade shallow to deep and let the seabed show through near the shore;
 *  - ripple: two scrolling layers of a baked, tileable ripple normal map;
 *  - glint in the sun (a low roughness on the ripples) and mirror the sky at
 *    grazing angles (fresnel on the sky colour main.ts hands over each frame);
 *  - lap foam onto the shore in bands that run in toward the beach.
 *
 * Two levels: detailed (desktop default) and simple (phones: one ripple layer,
 * a still shore line, no lapping). Options → Detailed water; `?water=0|1`.
 * Only ocean bodies get water; it is a MeshStandardMaterial underneath, so the
 * sun, colony lights, ground shadows, fog and fog of war all apply as usual.
 */
import * as THREE from 'three';
import { E, HALF, N, R, bodyHasSea, bodySea, regionDir, surfaceAt } from './planet';

/** The water sits a touch above sea level, so ground the sim calls wet (< 0.3) reads wet. */
export const WATER_LIFT = 0.2;

/** Ground colour for underwater ground: the body's shore colour, darkening with depth (the water tints it). */
export function seabedColor(h: number, shore: THREE.Color, out: THREE.Color) {
  const k = Math.min(1, Math.max(0, -h / 14));
  return out.copy(shore).multiplyScalar(1 - 0.6 * k * (2 - k));
}

const RIP = 256;

/** Tileable ripple normals (rgb) from a periodic noise height field, plus a foam breakup noise (a). */
function rippleTexture(): THREE.DataTexture {
  const hash = (x: number, y: number, s: number) => {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number, p: number, s: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const w = (v: number) => ((v % p) + p) % p;
    const a = hash(w(ix), w(iy), s), b = hash(w(ix + 1), w(iy), s), c = hash(w(ix), w(iy + 1), s), d = hash(w(ix + 1), w(iy + 1), s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const hgt = new Float32Array(RIP * RIP), foam = new Float32Array(RIP * RIP);
  for (let y = 0; y < RIP; y++) for (let x = 0; x < RIP; x++) {
    const u = x / RIP, v = y / RIP;
    let s = 0, amp = 1, norm = 0;
    for (let o = 0, p = 6; o < 4; o++, p *= 2) {
      // ridged: sharp crests, wide troughs, like wind ripples
      const n = 1 - Math.abs(noise(u * p, v * p, p, 3 + o * 11) * 2 - 1);
      s += n * n * amp; norm += amp; amp *= 0.5;
    }
    hgt[y * RIP + x] = s / norm;
    foam[y * RIP + x] = (noise(u * 16, v * 16, 16, 41) * 0.6 + noise(u * 48, v * 48, 48, 43) * 0.4);
  }
  const data = new Uint8Array(RIP * RIP * 4);
  const at = (x: number, y: number) => hgt[((y + RIP) % RIP) * RIP + ((x + RIP) % RIP)];
  for (let y = 0; y < RIP; y++) for (let x = 0; x < RIP; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dy = (at(x, y + 1) - at(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1), k = (y * RIP + x) * 4;
    data[k] = 128 + (-dx / l) * 127; data[k + 1] = 128 + (-dy / l) * 127; data[k + 2] = 128 + (1 / l) * 127;
    data[k + 3] = foam[y * RIP + x] * 255;
  }
  const t = new THREE.DataTexture(data, RIP, RIP, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export const waterUniforms = {
  uRipple: { value: null as THREE.Texture | null },
  uWaterTime: { value: 0 },
  /** The sky the water mirrors (main.ts: the day/night background colour). */
  uWaterSky: { value: new THREE.Color('#8fb0ad') },
  uWaterDeep: { value: new THREE.Color('#0b3346') },
  uWaterShallow: { value: new THREE.Color('#2f8c8c') },
  uWaterE: { value: E.clone() },
  uWaterN: { value: N.clone() },
  /** Where the sea round the region fades out (region units from the centre, Chebyshev): start, end. */
  uWaterEdge: { value: new THREE.Vector2(1e9, 2e9) },
};

/** Per frame: the water's clock (game time) and the sky colour it reflects. */
export function updateWater(t: number, sky: THREE.Color) {
  waterUniforms.uWaterTime.value = t;
  waterUniforms.uWaterSky.value.copy(sky);
}

function waterMaterial(detailed: boolean): THREE.MeshStandardMaterial {
  waterUniforms.uRipple.value ??= rippleTexture();
  waterUniforms.uWaterE.value.copy(E);
  waterUniforms.uWaterN.value.copy(N);
  // the body's sea colours (the editor's Deep and Shallow); shallow water is lit by the sand under it, so lift it a little
  const sea = bodySea();
  waterUniforms.uWaterDeep.value.set(sea.deep);
  waterUniforms.uWaterShallow.value.set(sea.shallow).multiplyScalar(1.35);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.14, metalness: 0, transparent: true });
  mat.name = 'water';
  // cloud shadows, but no tracks or puddles on the sea (src/world/ground.ts)
  mat.userData.noGround = true;
  setWaterDetail(mat, detailed);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDepth;
        attribute float aFoam;
        attribute vec2 aXZ;
        varying float vWDepth;
        varying float vWFoam;
        varying vec2 vWXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWDepth = aDepth; vWFoam = aFoam; vWXZ = aXZ;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uRipple;
        uniform float uWaterTime;
        uniform vec3 uWaterSky, uWaterDeep, uWaterShallow, uWaterE, uWaterN;
        uniform vec2 uWaterEdge;
        varying float vWDepth;
        varying float vWFoam;
        varying vec2 vWXZ;
        float wDepthK = 0.0;
        float wFoam = 0.0;`)
      // colour: shallow to deep, see-through near the shore, foam on the beach
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wd = max(0.0, -vWDepth);
        wDepthK = 1.0 - exp(-wd * 0.16);
        diffuseColor.rgb = mix(uWaterShallow, uWaterDeep, wDepthK);
        diffuseColor.a = mix(0.36, 0.95, smoothstep(0.0, 3.2, wd));
        {
          float t = uWaterTime;
          float brk = texture2D(uRipple, vWXZ * 0.045 + vec2(t * 0.004, t * 0.003)).a;
          // the wet line: a thin band where the water meets the ground
          float line = 1.0 - smoothstep(0.04, 0.3 + brk * 0.35, wd);
          #ifdef WATER_DETAILED
            // swash: bands running in toward the shore, broken up and fading out to sea
            float ph = wd * 4.2 - t * 1.3 + brk * 5.0;
            float band = smoothstep(0.6, 0.95, sin(ph)) * (1.0 - smoothstep(0.2, 1.4, wd));
            float fine = texture2D(uRipple, vWXZ * 0.21 - vec2(t * 0.011, t * 0.007)).a;
            wFoam = clamp(line * 0.85 + band * smoothstep(0.4, 0.7, fine) * 0.6, 0.0, 1.0);
          #else
            wFoam = line * 0.7;
          #endif
          wFoam *= vWFoam;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.95), wFoam);
        diffuseColor.a = max(diffuseColor.a, wFoam);`)
      // ripples: scrolling layers of the ripple normal map, tilting the up normal
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float t = uWaterTime;
          vec3 wE = normalize((viewMatrix * vec4(uWaterE, 0.0)).xyz);
          vec3 wN = normalize((viewMatrix * vec4(uWaterN, 0.0)).xyz);
          vec2 p = vWXZ;
          vec2 sl = (texture2D(uRipple, p * 0.085 + vec2(t * 0.018, t * 0.011)).xy * 2.0 - 1.0);
          #ifdef WATER_DETAILED
            sl += (texture2D(uRipple, p * 0.031 + vec2(-t * 0.007, t * 0.014)).xy * 2.0 - 1.0) * 0.8;
            sl += (texture2D(uRipple, p * 0.23 + vec2(t * 0.03, -t * 0.024)).xy * 2.0 - 1.0) * 0.35;
          #endif
          // calmer on the beach, and fading with distance so far water doesn't shimmer
          float far = smoothstep(0.6, 4.0, length(fwidth(p)));
          sl *= mix(0.55, 0.12, far) * (0.35 + 0.65 * wDepthK) * (1.0 - wFoam * 0.8);
          normal = normalize(normal + wE * sl.x + wN * sl.y);
        }`)
      // the sky in the water: stronger at grazing angles; foam doesn't mirror
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float wF = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
          wF *= 1.0 - wFoam;
          reflectedLight.indirectSpecular += uWaterSky * wF * 0.85;
          diffuseColor.a = mix(diffuseColor.a, 1.0, wF);
          // the far edge of the sea round the region fades into the globe's own ocean (no visible sheet edge from above)
          diffuseColor.a *= 1.0 - smoothstep(uWaterEdge.x, uWaterEdge.y, max(abs(vWXZ.x), abs(vWXZ.y)));
        }`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|water`;
  return mat;
}

/** Switch a water material between detailed and simple (recompiles once). */
export function setWaterDetail(mat: THREE.Material, detailed: boolean) {
  mat.defines = { ...(mat.defines ?? {}) };
  if (detailed) mat.defines.WATER_DETAILED = ''; else delete mat.defines.WATER_DETAILED;
  mat.needsUpdate = true;
}

/** How far past the region's edge the sea goes on (u): out to the camera's horizon. */
const REACH = 520;

/**
 * The sea round the landing region (null on a body without seas, or with no water in reach):
 * the region itself on a fine grid (its shore lines matter), the rest on a coarse one.
 */
export function buildWater(detailed: boolean): THREE.Mesh | null {
  if (!bodyHasSea()) return null;
  const pos: number[] = [], nrm: number[] = [], depth: number[] = [], foam: number[] = [], xz: number[] = [], idx: number[] = [];
  const d = new THREE.Vector3(), c = new THREE.Color();
  const grid = (x0: number, z0: number, nx: number, nz: number, step: number, wetFoam: number, skip?: (x: number, z: number) => boolean) => {
    const base = pos.length / 3;
    const hs = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      regionDir(x, z, d);
      const h = surfaceAt(d, c).h;
      hs[j * (nx + 1) + i] = h;
      pos.push(d.x * (R0 + WATER_LIFT), d.y * (R0 + WATER_LIFT), d.z * (R0 + WATER_LIFT));
      nrm.push(d.x, d.y, d.z);
      depth.push(h); foam.push(wetFoam); xz.push(x, z);
    }
    // foam only where the bed shelves (per vertex, so it blends): wide flats a hand deep stay clear, not a white sheet
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const at = (a: number, b: number) => hs[Math.min(nz, Math.max(0, b)) * (nx + 1) + Math.min(nx, Math.max(0, a))];
      const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const k = Math.min(1, Math.max(0, (slope - 0.025) / 0.08));
      foam[base + j * (nx + 1) + i] *= k * k * (3 - 2 * k);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, dd = cc + 1;
      if (Math.min(hs[a], hs[b], hs[cc], hs[dd]) > 0.8) continue; // dry: no water here
      if (skip?.(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
      idx.push(base + a, base + b, base + cc, base + b, base + dd, base + cc);
    }
  };
  const R0 = R;
  // the region, matching the terrain patch's 2 u grid; then a coarse frame out to the horizon,
  // its cells lined up on the region's edge so the two meet without a gap or an overlap
  const step = 2, n = Math.round((HALF * 2) / step);
  grid(-HALF, -HALF, n, n, step, 1);
  const cs = HALF / Math.max(1, Math.round(HALF / 10)), ring = Math.ceil(REACH / cs), cn = Math.round((HALF * 2) / cs) + ring * 2;
  grid(-HALF - ring * cs, -HALF - ring * cs, cn, cn, cs, 0.5, (x, z) => Math.abs(x) < HALF && Math.abs(z) < HALF);
  if (!idx.length) return null;
  waterUniforms.uWaterEdge.value.set(HALF + REACH * 0.45, HALF + ring * cs - cs);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
  geo.setAttribute('aXZ', new THREE.Float32BufferAttribute(xz, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, waterMaterial(detailed));
  m.name = 'water';
  return m;
}
