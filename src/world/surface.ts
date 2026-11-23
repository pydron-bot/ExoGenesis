/**
 * Planet detail from orbit, added per pixel on top of the low-poly globe:
 *
 *  - a baked equirectangular surface map (colour + flora in one RGBA texture,
 *    height in another), made from the same `surfaceAt` as the globe's
 *    geometry, in a background worker after startup and faded in when ready;
 *  - relief lighting from the height map, smooth glinting oceans, a fine
 *    detail noise, and bioluminescent flora on the night side;
 *  - a cloud layer that drifts and is lit by the sun, faded out near the ground.
 *
 * Everything is driven by `surfaceUniforms` (main.ts sets the sun direction and
 * how far out the camera is); at the surface it costs one branch on a uniform.
 */
import * as THREE from 'three';
import { R, surfaceAt } from './planet';

export const SURF_W = 2048;
export const SURF_H = 1024;
/** Height channel encoding: byte = (h - H_MIN) / H_RANGE * 255. */
const H_MIN = -90, H_RANGE = 200;
/** Slope channels (east, north): byte = 128 + slope / S_RANGE * 127 (slope = dh/ds in units per unit). */
const S_RANGE = 0.6;

export interface SurfaceMaps { color: Uint8Array; height: Uint8Array; w: number; h: number }

/** Bake the surface maps (run it in a worker: ~2 s on a desktop, longer on phones). */
export function bakeSurface(w = SURF_W, h = SURF_H): SurfaceMaps {
  const color = new Uint8Array(w * h * 4), height = new Uint8Array(w * h * 4);
  const hs = new Float32Array(w * h);
  const d = new THREE.Vector3(), c = new THREE.Color();
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w - 0.5) * Math.PI * 2;
      d.set(cl * Math.cos(lon), sl, cl * Math.sin(lon));
      const s = surfaceAt(d, c);
      const k = (j * w + i) * 4;
      color[k] = c.r * 255; color[k + 1] = c.g * 255; color[k + 2] = c.b * 255;
      color[k + 3] = Math.max(0, Math.min(255, (s.flora + 0.2) * 400)); // flora field, for the night glow
      hs[j * w + i] = s.h;
    }
  }
  // height + its slope (central differences, sea level flat), so the shader needs one lookup for relief
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round(128 + (v / S_RANGE) * 127)));
  const dLat = (Math.PI / h) * R;
  for (let j = 0; j < h; j++) {
    const dLon = Math.max(0.15, Math.cos(((j + 0.5) / h - 0.5) * Math.PI)) * ((2 * Math.PI) / w) * R;
    const jn = Math.min(h - 1, j + 1), js = Math.max(0, j - 1);
    for (let i = 0; i < w; i++) {
      const k = j * w + i, ie = (i + 1) % w, iw = (i - 1 + w) % w;
      const at = (q: number) => Math.max(0, hs[q]);
      const se = (at(j * w + ie) - at(j * w + iw)) / (2 * dLon);
      const sn = (at(jn * w + i) - at(js * w + i)) / ((jn - js) * dLat);
      height[k * 4] = Math.max(0, Math.min(255, ((hs[k] - H_MIN) / H_RANGE) * 255));
      height[k * 4 + 1] = enc(se);
      height[k * 4 + 2] = enc(sn);
      height[k * 4 + 3] = 255;
    }
  }
  return { color, height, w, h };
}

function tex(data: Uint8Array, w: number, h: number, format: THREE.PixelFormat, srgb: boolean) {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 2;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
blank.needsUpdate = true;

export const surfaceUniforms = {
  uSurfColor: { value: blank as THREE.Texture },
  uSurfHeight: { value: blank as THREE.Texture },
  /** 0..1: the baked maps fade in when they arrive. */
  uSurfOn: { value: 0 },
  /** 0..1: how far out the camera is (detail only matters from orbit). */
  uSurfFar: { value: 0 },
  /** World direction to the sun. */
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  uSurfTime: { value: 0 },
};

/** Hand the baked maps to the globe (and start fading them in). */
export function setSurfaceMaps(m: SurfaceMaps) {
  surfaceUniforms.uSurfColor.value = tex(m.color, m.w, m.h, THREE.RGBAFormat, false);
  surfaceUniforms.uSurfHeight.value = tex(m.height, m.w, m.h, THREE.RGBAFormat, false);
  surfaceTarget = 1;
}
let surfaceTarget = 0;

/** Per frame: ease the fade-in, follow the sun and the camera. */
export function updateSurface(dt: number, sunDir: THREE.Vector3, camAlt: number, t: number) {
  const u = surfaceUniforms;
  u.uSurfOn.value += (surfaceTarget - u.uSurfOn.value) * Math.min(1, dt * 1.2);
  u.uSunDir.value.copy(sunDir).normalize();
  u.uSurfFar.value = THREE.MathUtils.smoothstep(camAlt, 250, 1200);
  u.uSurfTime.value = t;
}

// Shared GLSL: equirect lookup with a seam-free gradient (Tarini), value noise.
const GLSL_COMMON = /* glsl */ `
  uniform sampler2D uSurfColor, uSurfHeight;
  uniform float uSurfOn, uSurfFar, uSurfTime;
  uniform vec3 uSunDir;
  vec2 surfUv(vec3 d, out vec2 gx, out vec2 gy) {
    float u = atan(d.z, d.x) / 6.28318530718 + 0.5;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5;
    float u2 = fract(u + 0.5) - 0.5;
    vec2 a = vec2(u, v), b = vec2(u2, v);
    // the derivative of whichever u doesn't wrap here, so the seam doesn't pick a tiny mip
    bool useB = fwidth(u) > fwidth(u2) + 1e-6;
    gx = useB ? dFdx(b) : dFdx(a);
    gy = useB ? dFdy(b) : dFdy(a);
    return a;
  }
  // hash13 (Dave Hoskins): no axis-aligned streaks, stable in mediump-ish ranges
  float sHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  float sNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/** Patch the globe's MeshStandardMaterial with the surface detail. Call once, before addFog. */
export function addSurfaceDetail(mat: THREE.MeshStandardMaterial) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, surfaceUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vSurfDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSurfDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 vSurfDir;\n${GLSL_COMMON}
        float sWater = 0.0; float sFlora = 0.0; float sK = 0.0; float sc_flora_hue = 0.5; vec4 sHt = vec4(0.5);`)
      // colour: the baked map over the vertex colours, plus a fine detail noise
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sDir = normalize(vSurfDir);
        vec2 sGx, sGy;
        vec2 sUv = surfUv(sDir, sGx, sGy);
        sK = uSurfOn * uSurfFar;
        if (sK > 0.001) {
          vec4 sc = textureGrad(uSurfColor, sUv, sGx, sGy);
          sHt = textureGrad(uSurfHeight, sUv, sGx, sGy);
          float sh0 = sHt.r;
          sWater = smoothstep(0.455, 0.445, sh0); // h <= 0
          sFlora = sc.a;
          sc_flora_hue = clamp((sc.b - sc.g) * 4.0 + 0.5, 0.0, 1.0); // purple flora → magenta, teal → cyan
          // fine grain, only where it's bigger than a pixel (one noise, skipped from far away)
          float fineFade = (1.0 - smoothstep(0.2, 1.0, length(fwidth(sDir * 900.0)))) * (1.0 - sWater);
          float fine = fineFade > 0.01 ? sNoise(sDir * 900.0) : 0.5;
          vec3 col = sc.rgb * (1.0 + (fine - 0.5) * 0.22 * fineFade);
          // ocean depth: darker far from shore
          col = mix(col, col * vec3(0.55, 0.75, 0.9), sWater * smoothstep(0.44, 0.3, sh0));
          diffuseColor.rgb = mix(diffuseColor.rgb, col, sK);
        }`)
      // relief: tilt the normal by the height map's slope; oceans get the smooth sphere normal
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (sK > 0.001) {
          // baked slopes (dh/ds east and north), decoded
          vec2 sl = (sHt.gb * 255.0 - 128.0) / 127.0 * ${S_RANGE};
          vec3 east = normalize(cross(sDir, vec3(0.0, 1.0, 0.0))); // direction of increasing longitude
          vec3 north = cross(east, sDir);
          vec3 g = east * sl.x + north * sl.y;
          vec3 gView = (viewMatrix * vec4(g, 0.0)).xyz;
          vec3 sphereN = normalize((viewMatrix * vec4(sDir, 0.0)).xyz);
          vec3 land = normalize(normal - gView * 2.2);
          normal = normalize(mix(normal, mix(land, sphereN, sWater), sK));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.26, sWater * sK);`)
      // night side: flora regions glow in the hues the plants glow on the ground
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (sK > 0.001) {
          // night side only, thick flora only: clusters of tiny lights, breathing slowly
          float glow = smoothstep(0.0, -0.25, dot(sDir, uSunDir)) * smoothstep(0.5, 0.85, sFlora) * (1.0 - sWater);
          if (glow > 0.01) {
            float cn = sNoise(sDir * 160.0);
            float cluster = smoothstep(0.45, 0.75, cn);
            if (cluster > 0.01) {
              float speck = smoothstep(0.62, 0.9, sNoise(sDir * 1100.0)) * cluster * (0.6 + 0.4 * sin(uSurfTime * 0.7 + cn * 40.0));
              vec3 hue = mix(vec3(0.1, 0.8, 0.9), vec3(0.75, 0.15, 0.85), smoothstep(0.3, 0.7, sc_flora_hue));
              totalEmissiveRadiance += hue * speck * glow * 0.45 * sK;
            }
          }
        }`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|surface`;
  mat.needsUpdate = true;
}

/** Drifting cloud shell, lit by the sun; invisible near the ground. */
export function buildClouds(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...surfaceUniforms, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir; varying vec3 vN; varying vec3 vV;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vDir; varying vec3 vN; varying vec3 vV;
      uniform float uOpacity;
      ${GLSL_COMMON}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        // slow drift about the poles, with the latitudes swaying a little against each other. The sway is bounded:
        // a speed that differed by latitude kept shearing the clouds, until after half an hour or so they were
        // thin streaks along the lines of latitude. The turn is wrapped so it stays precise in a long game.
        float a = mod(uSurfTime * 0.004, 6.2831853) + 0.35 * d.y * sin(uSurfTime * 0.0023);
        vec3 p = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
        vec3 q = p * 3.0 + vec3(sNoise(p * 4.0), sNoise(p * 4.0 + 7.1), sNoise(p * 4.0 + 13.7)) * 0.9; // swirl
        float n = sNoise(q * 2.0) * 0.5 + sNoise(q * 4.1) * 0.25 + sNoise(q * 8.3) * 0.15 + sNoise(q * 17.0) * 0.1;
        float cover = smoothstep(0.52, 0.72, n) * (0.55 + 0.45 * smoothstep(0.2, 0.9, abs(d.y) + 0.3));
        float lit = smoothstep(-0.25, 0.35, dot(d, uSunDir));
        // fade at the limb so the shell's edge doesn't show
        float limb = smoothstep(0.02, 0.25, abs(dot(normalize(vN), normalize(vV))));
        float alpha = cover * limb * uOpacity * uSurfFar;
        vec3 col = mix(vec3(0.05, 0.07, 0.1), vec3(0.95, 0.97, 1.0), lit);
        gl_FragColor = vec4(col, alpha * mix(0.25, 0.85, lit));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(R * 1.022, 96, 64), mat);
  m.name = 'clouds';
  m.renderOrder = 1;
  return m;
}

/** Per frame: clouds fade in from orbit and out near the ground. */
export function updateClouds(m: THREE.Mesh, camAlt: number) {
  const mat = m.material as THREE.ShaderMaterial;
  const k = THREE.MathUtils.smoothstep(camAlt, 400, 1500);
  mat.uniforms.uOpacity.value = k;
  m.visible = k > 0.01;
}
