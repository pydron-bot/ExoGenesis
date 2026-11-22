/**
 * Surface detail for the other bodies in the system (v0.40.0), drawn per pixel
 * on top of their low-poly, vertex-coloured meshes (src/world/system.ts), so a
 * moon in the title tour or a planet seen from orbit has craters, ice, lava or
 * storms at any distance, with no textures to load.
 *
 *  - Rocky bodies: a look (`surface` in content/bodies, or picked from the
 *    record when it's `auto`) sets which layers draw: crater fields at three
 *    scales (bowls, raised rims, bright ejecta), dark maria, ice fractures,
 *    glowing lava cracks, sulfur calderas, wind-blown dune streaks, polar frost
 *    and a fine grain. Each layer adds colour and a height that tilts the normal
 *    (screen-space bump), and fades out once it is smaller than a pixel, so far
 *    bodies cost little and nothing shimmers.
 *  - Gas giants: bands from the record's palette, warped by turbulence and
 *    streaked along the latitudes, with storm ovals, darker poles and a slow
 *    drift (the shared `uBodyTime`).
 *  - Rings: radial ringlets and gaps from the seed, in a 1D texture.
 *  - Clouds for bodies that have them: a lit shell that drifts.
 */
import * as THREE from 'three';
import type { BodyDef } from '../content/defs';

/** Where the sun is drawn (SolarSystem.update sets it): rings use it for shadows and backlight. */
export const sunPosUniform = { value: new THREE.Vector3(1e5, 0, 0) };

export const SURFACE_LOOKS = ['auto', 'cratered', 'icy', 'volcanic', 'sulfur', 'dusty', 'verdant', 'smooth'] as const;
export type SurfaceLook = (typeof SURFACE_LOOKS)[number];

/** Time for the giants' drift and the clouds (SolarSystem.update sets it). */
export const bodyUniforms = { uBodyTime: { value: 0 } };

/** Layer strengths for one rocky body (0 = off). */
interface Layers {
  craters: number; maria: number; cracks: number; lava: number; spots: number; dunes: number; frost: number; grain: number;
  /** Bump height scale. */
  bump: number;
  crackColor: string; lavaColor: string; spotColor: string;
}

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** The look a body gets when its record says `auto` (or nothing): from its kind, colours and air. */
export function autoLook(d: Pick<BodyDef, 'kind' | 'ground' | 'atmosphere' | 'ocean'>): Exclude<SurfaceLook, 'auto'> {
  if (d.kind === 'comet') return 'icy';
  if (d.ocean) return 'verdant';
  const cols = (d.ground ?? []).map((g) => new THREE.Color(g.color));
  if (cols.length) {
    const hot = cols.some((c) => c.r > 0.8 && c.g > 0.25 && c.g < 0.75 && c.b < 0.35);
    const sulfur = cols.some((c) => c.r > 0.75 && c.g > 0.7 && c.b < 0.5);
    const bright = cols.reduce((m, c) => m + lum(c), 0) / cols.length;
    const blue = cols.every((c) => c.b >= c.r);
    if (hot && !sulfur) return 'volcanic';
    if (sulfur) return 'sulfur';
    if (bright > 0.45 && blue) return 'icy';
  }
  if (d.atmosphere) return 'dusty';
  return 'cratered';
}

function layersFor(look: Exclude<SurfaceLook, 'auto'>, d: BodyDef): Layers {
  const k = d.surfaceDetail ?? 1, cr = (d.craters ?? 1) * k;
  const base: Layers = { craters: 0, maria: 0, cracks: 0, lava: 0, spots: 0, dunes: 0, frost: 0, grain: 0.6 * k, bump: k, crackColor: '#7a4a32', lavaColor: '#ff7a24', spotColor: '#2a1608' };
  switch (look) {
    case 'cratered': return { ...base, craters: cr, maria: 0.8 * k, grain: 0.8 * k };
    case 'icy': return { ...base, craters: 0.35 * cr, cracks: k, frost: 0.8 * k, grain: 0.4 * k, bump: 0.6 * k, crackColor: d.kind === 'comet' ? '#4f5a66' : '#8a5a44' };
    case 'volcanic': return { ...base, craters: 0.15 * cr, lava: k, grain: 0.9 * k };
    case 'sulfur': return { ...base, craters: 0.1 * cr, spots: k, grain: 0.7 * k, bump: 0.5 * k, lava: 0.35 * k, lavaColor: '#ff5a1a' };
    case 'dusty': return { ...base, craters: 0.45 * cr, dunes: k, frost: 0.5 * k, maria: 0.4 * k, grain: 0.7 * k };
    case 'verdant': return { ...base, grain: 0.5 * k, bump: 0.4 * k };
    case 'smooth': return { ...base, grain: 0.3 * k, bump: 0.3 * k };
  }
}

// Shared GLSL: hashes, value noise, fbm and cell noise in direction space.
const GLSL = /* glsl */ `
  float bHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  vec3 bHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  float bNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(bHash(i), bHash(i + vec3(1, 0, 0)), f.x), mix(bHash(i + vec3(0, 1, 0)), bHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(bHash(i + vec3(0, 0, 1)), bHash(i + vec3(1, 0, 1)), f.x), mix(bHash(i + vec3(0, 1, 1)), bHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float bFbm(vec3 p) { return bNoise(p) * 0.5 + bNoise(p * 2.03) * 0.25 + bNoise(p * 4.01) * 0.15 + bNoise(p * 8.07) * 0.1; }
  /** How visible detail at frequency f is here: 1 while a feature spans several pixels, 0 once it's under one. */
  float bFade(vec3 d, float f) { return 1.0 - smoothstep(0.25, 0.9, length(fwidth(d * f))); }
`;

const ROCKY_GLSL = /* glsl */ `
  uniform float uCraters, uMaria, uCracks, uLava, uSpots, uDunes, uFrost, uGrain, uBump, uSeed, uRadius;
  uniform vec3 uCrackCol, uLavaCol, uSpotCol;
  varying vec3 vBodyDir;
  ${GLSL}
  // one scale of craters: adds to height h (cell units × size), albedo shift a
  void bCraters(vec3 d, float freq, float density, float fade, inout float h, inout float a) {
    if (fade < 0.01 || density <= 0.0) return;
    vec3 q = d * freq + uSeed, i = floor(q), f = fract(q);
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 c = vec3(float(x), float(y), float(z));
      vec3 r = bHash3(i + c);
      if (r.x > density) continue;
      vec3 o = c + 0.2 + 0.6 * r.yzx - f;
      float rad = 0.16 + 0.34 * r.z * r.z;
      float t0 = length(o) / rad;
      if (t0 > 2.4) continue;
      // an irregular rim: the radius wobbles round the crater
      float t = t0 * (1.0 + (bNoise(normalize(o + 1e-4) * 2.0 + r * 11.0) - 0.5) * 0.16);
      if (t > 2.2) continue;
      float bowl = t < 1.0 ? (t * t - 1.0) * 0.55 : 0.0;
      float rim = exp(-pow((t - 1.0) / 0.16, 2.0)) * (0.2 + 0.15 * r.y);
      bowl += rad > 0.34 ? exp(-pow(t / 0.16, 2.0)) * 0.22 : 0.0; // central peak in the big ones
      float ray = t > 1.0 ? (1.0 - smoothstep(1.0, 2.2, t)) * smoothstep(0.6, 0.95, bNoise(normalize(o) * 6.0 + r * 9.0)) : 0.0;
      h += (bowl + rim) * rad * fade;
      a += (rim * 0.5 + ray * 0.18 * (1.0 - r.x / density) - (t < 0.8 ? 0.06 : 0.0)) * fade;
    }
  }
  // cell edges (F2 - F1) for fractures and lava: 0 on an edge
  float bEdges(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 c = vec3(float(x), float(y), float(z));
      vec3 o = c + bHash3(i + c) - f;
      float dd = dot(o, o);
      if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
    }
    return sqrt(f2) - sqrt(f1);
  }
`;

/** Patch a rocky body's material with its surface look. */
export function addRockyDetail(mat: THREE.MeshStandardMaterial, d: BodyDef, look: Exclude<SurfaceLook, 'auto'>) {
  const L = layersFor(look, d);
  const u = {
    uCraters: { value: L.craters }, uMaria: { value: L.maria }, uCracks: { value: L.cracks }, uLava: { value: L.lava },
    uSpots: { value: L.spots }, uDunes: { value: L.dunes }, uFrost: { value: L.frost }, uGrain: { value: L.grain }, uBump: { value: L.bump },
    uSeed: { value: ((d.seed ?? 7) % 97) * 1.37 }, uRadius: { value: d.radius },
    uCrackCol: { value: new THREE.Color(L.crackColor) }, uLavaCol: { value: new THREE.Color(L.lavaColor) }, uSpotCol: { value: new THREE.Color(L.spotColor) },
  };
  mat.userData.bodyUniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vBodyDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBodyDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCKY_GLSL}\n float bH = 0.0; float bGlow = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bd = normalize(vBodyDir);
        vec3 col = diffuseColor.rgb;
        float a = 0.0;
        // maria: broad dark, smooth lowlands (fewer craters in them)
        float mare = uMaria > 0.0 ? smoothstep(0.52, 0.6, bFbm(bd * 2.2 + uSeed)) * uMaria : 0.0;
        // craters at three scales (each only once it's bigger than a pixel)
        float cd = 0.55 * uCraters * (1.0 - mare * 0.7);
        bCraters(bd, 6.0, cd * 0.6, bFade(bd, 6.0), bH, a);
        float h1 = 0.0; bCraters(bd, 17.0, cd, bFade(bd, 17.0), h1, a); bH += h1 * 0.45;
        float h2 = 0.0; bCraters(bd, 48.0, cd * 0.75, bFade(bd, 48.0), h2, a); bH += h2 * 0.18;
        col *= 1.0 - mare * 0.32;
        // ice fractures: long dark-tinted lines over a bright crust
        if (uCracks > 0.0) {
          float fd = bFade(bd, 14.0);
          if (fd > 0.01) {
            vec3 wp = bd * 5.0 + (vec3(bNoise(bd * 3.0 + 1.7), bNoise(bd * 3.0 + 5.3), bNoise(bd * 3.0 + 9.1)) - 0.5) * 1.6;
            float e = bEdges(wp + uSeed);
            float keep = 0.25 + 0.75 * smoothstep(0.38, 0.62, bNoise(wp * 0.8 + 2.0)); // some lines fade out: lineae, not a net
            float line = (1.0 - smoothstep(0.0, 0.06, e)) * fd * uCracks * keep;
            float e2 = bEdges(wp * 2.7 + uSeed * 2.0);
            line = max(line, (1.0 - smoothstep(0.0, 0.04, e2)) * bFade(bd, 38.0) * uCracks * 0.5 * smoothstep(0.45, 0.7, bNoise(wp * 1.7 + 5.0)));
            col = mix(col, uCrackCol, line * 0.75);
            bH -= line * 0.04;
            bGlow = uLava * (1.0 - smoothstep(0.0, 0.05, e)) * fd;
          }
        }
        // lava: dark plates of crust, molten seams between them (emissive below)
        if (uLava > 0.0 && uCracks <= 0.0 && uSpots <= 0.0) {
          float fd = bFade(bd, 10.0);
          vec3 wp = bd * 4.0 + (vec3(bNoise(bd * 2.5 + 3.1), bNoise(bd * 2.5 + 8.2), bNoise(bd * 2.5 + 1.4)) - 0.5) * 1.2;
          float e = bEdges(wp + uSeed);
          float seam = 1.0 - smoothstep(0.0, 0.06, e);
          float flow = 0.15 + 0.85 * smoothstep(0.4, 0.7, bNoise(wp * 1.3 + uSeed));
          bGlow = seam * flow * fd * uLava;
          float crust = 0.75 + 0.5 * bFbm(bd * 25.0 + uSeed) * bFade(bd, 25.0);
          col = mix(col, col * 0.3 * crust, smoothstep(0.05, 0.3, e) * 0.75 * uLava);
          col = mix(col, uLavaCol * 0.6, seam * flow * 0.5 * uLava);
          bH += smoothstep(0.0, 0.3, e) * 0.05 * fd;
        }
        // sulfur: calderas, each a dark vent inside a pale or reddish halo
        if (uSpots > 0.0) {
          vec3 q = bd * 6.0 + uSeed, i = floor(q), f = fract(q);
          float fd = bFade(bd, 6.0);
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 c = vec3(float(x), float(y), float(z));
            vec3 r = bHash3(i + c + 3.7);
            if (r.x > 0.55) continue;
            float t = length(c + 0.2 + 0.6 * r.yzx - f) / (0.1 + 0.16 * r.z);
            vec3 halo = r.y > 0.5 ? vec3(0.93, 0.88, 0.62) : vec3(0.72, 0.28, 0.14);
            col = mix(col, halo, (1.0 - smoothstep(1.0, 2.6, t)) * 0.45 * fd * uSpots);
            col = mix(col, uSpotCol, (1.0 - smoothstep(0.55, 0.85, t)) * 0.9 * fd * uSpots);
            bGlow += (1.0 - smoothstep(0.0, 0.4, t)) * fd * uLava * step(r.x, 0.1);
          }
        }
        // dunes: wind streaks along a warped east-west, dark in the lee of craters
        if (uDunes > 0.0) {
          float fd = bFade(bd, 70.0);
          float lat = asin(clamp(bd.y, -1.0, 1.0));
          float w = bFbm(bd * 4.0 + uSeed) * 6.0;
          float wave = sin(lat * 140.0 + w * 3.0 + bNoise(bd * 20.0) * 2.0) * 0.5 + 0.5;
          float field = smoothstep(0.45, 0.6, bFbm(bd * 3.0 + uSeed + 4.0)) * uDunes;
          col *= 1.0 + (wave - 0.5) * 0.22 * field * fd;
          bH += (wave - 0.5) * 0.012 * field * fd;
          col = mix(col, col * vec3(1.08, 1.0, 0.9), smoothstep(0.5, 0.7, bFbm(bd * 1.5 + 2.0)) * 0.4 * uDunes);
        }
        // polar frost, with a ragged edge
        if (uFrost > 0.0) {
          float cap = smoothstep(0.78, 0.86, abs(bd.y) + (bFbm(bd * 6.0 + uSeed) - 0.5) * 0.18) * uFrost;
          col = mix(col, vec3(0.93, 0.95, 0.97), cap * 0.85);
        }
        // mottling and rough ground at mid scales, so close up it isn't smooth plastic
        if (uGrain > 0.0) {
          float m1 = bFade(bd, 18.0), m2 = bFade(bd, 55.0), m3 = bFade(bd, 170.0);
          col *= 1.0 + (bFbm(bd * 18.0 + uSeed * 1.3) - 0.5) * 0.35 * m1 * uGrain;
          float rough = (bNoise(bd * 55.0 + uSeed) - 0.5) * m2 + (bNoise(bd * 170.0 + uSeed) - 0.5) * 0.5 * m3;
          bH += rough * 0.02 * uGrain;
        }
        // fine grain
        if (uGrain > 0.0) {
          float g1 = bFade(bd, 150.0), g2 = bFade(bd, 600.0);
          float g = (bNoise(bd * 150.0 + uSeed) - 0.5) * g1 * 0.6 + (bNoise(bd * 600.0) - 0.5) * g2 * 0.4;
          col *= 1.0 + g * 0.35 * uGrain;
          bH += g * 0.004 * uGrain;
        }
        col *= 1.0 + a * 0.9;
        diffuseColor.rgb = clamp(col, 0.0, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // screen-space bump from the detail height (world units: a crater is about a fifth as deep as it is wide)
          float hw = bH * uRadius * 0.05 * uBump;
          vec3 sp = -vViewPosition;
          vec3 sx = dFdx(sp), sy = dFdy(sp);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(hw), dFdy(hw));
          vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uLavaCol * bGlow * (0.7 + 0.5 * bNoise(normalize(vBodyDir) * 30.0)) * 1.5;`);
  };
  mat.customProgramCacheKey = () => 'exo-rocky-body';
  mat.needsUpdate = true;
}

const GIANT_GLSL = /* glsl */ `
  uniform vec3 uBands[8];
  uniform int uBandN;
  uniform float uSeed, uBodyTime, uStorm;
  varying vec3 vBodyDir;
  ${GLSL}
  vec3 bandAt(float t) {
    float b = t * float(uBandN);
    int k = int(floor(b));
    vec3 c0 = uBands[0], c1 = uBands[0];
    for (int i = 0; i < 8; i++) {
      if (i == k % uBandN) c0 = uBands[i];
      if (i == (k + 1) % uBandN) c1 = uBands[i];
    }
    return mix(c0, c1, smoothstep(0.55, 1.0, fract(b)));
  }
`;

/** A gas giant's material: palette bands with turbulence, streaks, storms and dark poles. */
export function giantMaterial(palette: string[], seed: number, icy: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, color: '#ffffff' });
  const cols = palette.slice(0, 8).map((p) => new THREE.Color(p));
  while (cols.length < 8) cols.push(cols[cols.length % Math.max(1, palette.length)]?.clone() ?? new THREE.Color('#c99a6b'));
  const u = { uBands: { value: cols }, uBandN: { value: Math.max(1, Math.min(8, palette.length)) }, uSeed: { value: (seed % 97) * 1.37 }, uStorm: { value: icy ? 0.4 : 1 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, bodyUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vBodyDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBodyDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GIANT_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bd = normalize(vBodyDir);
        float tt = uBodyTime * 0.002;
        // turbulence: the latitude is pushed about by swirling noise, more at the band edges
        vec3 w = vec3(bFbm(bd * 3.0 + uSeed + tt), bFbm(bd * 3.0 + uSeed + 5.2), bFbm(bd * 3.0 + uSeed + 9.7 - tt)) - 0.5;
        float lat = bd.y + w.y * 0.13 + (bFbm(bd * 9.0 + w * 3.0 + uSeed) - 0.5) * 0.06 * bFade(bd, 9.0);
        lat += sin(atan(bd.z, bd.x) * 6.0 + bd.y * 20.0 + w.x * 8.0) * 0.012; // long waves along the band edges
        float t = fract(lat * 0.75 + 0.5 + uSeed * 0.01);
        vec3 col = bandAt(t);
        // streaks along the latitudes
        float sf = bFade(bd, 40.0);
        float streak = bNoise(vec3(bd.x * 3.0 + w.x * 4.0, lat * 90.0, bd.z * 3.0 + w.z * 4.0));
        col *= 1.0 + (streak - 0.5) * 0.18 * sf;
        // storms: a great oval at a fixed latitude, smaller white ones scattered
        float lon = atan(bd.z, bd.x);
        float slat = 0.35 * sign(sin(uSeed)) * (0.6 + 0.4 * fract(uSeed));
        vec2 so = vec2((lon - uSeed * 0.7 - tt * 0.5) * 1.0, (bd.y - slat) * 3.2);
        so.x = mod(so.x + 3.14159, 6.28318) - 3.14159;
        float sr = length(so * vec2(1.0, 1.7));
        float great = 1.0 - smoothstep(0.13, 0.2, sr);
        float collar = exp(-pow((sr - 0.21) / 0.03, 2.0));
        float swirl = (1.0 - smoothstep(0.05, 0.2, sr)) * (bNoise(vec3(so * vec2(18.0, 30.0) + vec2(atan(so.y, so.x) * 2.0, 0.0), uSeed)) - 0.5);
        // warm giants: a red or white oval; ice giants (uStorm < 1): a dark spot
        vec3 stormCol = uStorm < 0.9 ? col * vec3(0.45, 0.5, 0.65) : mix(vec3(0.78, 0.36, 0.22), vec3(0.92, 0.9, 0.86), step(0.5, fract(uSeed * 3.1)));
        col = mix(col, stormCol, great * (uStorm < 0.9 ? 0.9 : 0.8));
        col *= 1.0 - collar * 0.25 * uStorm;
        col *= 1.0 + swirl * 0.45 * uStorm;
        vec3 q = bd * 14.0 + uSeed, ci = floor(q), cf = fract(q);
        float ov = 0.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 c = vec3(float(x), float(y), float(z));
          vec3 r = bHash3(ci + c);
          if (r.x > 0.18) continue;
          vec3 o = c + 0.2 + 0.6 * r.yzx - cf;
          o.y *= 2.2;
          ov = max(ov, 1.0 - smoothstep(0.08, 0.2 + 0.12 * r.z, length(o)));
        }
        col = mix(col, vec3(0.96, 0.94, 0.9), ov * 0.6 * bFade(bd, 14.0) * uStorm);
        // darker, hazier poles
        col = mix(col, col * vec3(0.7, 0.75, 0.85), smoothstep(0.7, 0.98, abs(bd.y)));
        diffuseColor.rgb = col;`);
  };
  mat.customProgramCacheKey = () => 'exo-giant';
  mat.needsUpdate = true;
  return mat;
}

/** Ring material: ringlets and gaps across the ring's width, from the seed. */
export function ringMaterial(color: string, opacity: number, inner: number, outer: number, seed: number, planetR = inner / 1.4): THREE.MeshBasicMaterial {
  const W = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = 1;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, 1);
  let s = (seed * 9301 + 49297) % 233280 || 1;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const gaps = Array.from({ length: 3 }, () => ({ at: 0.2 + rnd() * 0.65, w: 0.008 + rnd() * 0.03 }));
  const f = Array.from({ length: 5 }, () => ({ k: 20 + rnd() * 140, ph: rnd() * 6.28, a: 0.08 + rnd() * 0.18 }));
  const c = new THREE.Color(color);
  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    let dens = 0.75 + f.reduce((m, q) => m + Math.sin(t * q.k + q.ph) * q.a, 0);
    dens *= Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.08); // soft edges
    for (const g of gaps) dens *= 1 - Math.exp(-(((t - g.at) / g.w) ** 2)) * 0.92;
    dens = Math.max(0, Math.min(1, dens));
    const shade = 0.8 + 0.25 * Math.sin(t * 9 + seed);
    img.data.set([Math.min(255, c.r * 255 * shade + 20), Math.min(255, c.g * 255 * shade + 15), Math.min(255, c.b * 255 * shade + 10), dens * 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: Math.min(1, opacity * 1.6), side: THREE.DoubleSide, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uIn = { value: inner };
    sh.uniforms.uOut = { value: outer };
    sh.uniforms.uPlanetR = { value: planetR };
    sh.uniforms.uSunPos = sunPosUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vRingR; varying vec3 vRingW; varying vec3 vRingC; varying vec3 vRingN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRingR = length(position.xy);
        vRingW = (modelMatrix * vec4(position, 1.0)).xyz;
        vRingC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vRingN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vRingR; varying vec3 vRingW; varying vec3 vRingC; varying vec3 vRingN; uniform float uIn, uOut, uPlanetR; uniform vec3 uSunPos;')
      .replace('#include <map_fragment>', `
        vec4 rc = texture2D(map, vec2(clamp((vRingR - uIn) / (uOut - uIn), 0.0, 1.0), 0.5));
        diffuseColor *= rc;
        vec3 L = normalize(uSunPos - vRingC);
        // the planet's shadow: the night side of the ring, where the line to the sun passes through the planet
        vec3 dd = vRingW - vRingC;
        float along = dot(dd, L);
        float miss = length(dd - L * along);
        float lit = along < 0.0 ? smoothstep(uPlanetR * 0.97, uPlanetR * 1.04, miss) : 1.0;
        // seen from the side the sun isn't on, light comes through: thin ringlets glow, dense ones go dark
        vec3 toCam = cameraPosition - vRingW;
        float under = step(dot(vRingN, L) * dot(vRingN, toCam), 0.0);
        float through = mix(1.0, 0.3 + 0.9 * (1.0 - rc.a), under);
        // looking toward the sun through the ring: forward-scattered light
        float fs = pow(max(dot(normalize(-toCam), L), 0.0), 6.0);
        diffuseColor.rgb *= lit * (through + fs * (1.6 - rc.a * 0.8));
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + fs * 0.5));`);
  };
  mat.customProgramCacheKey = () => 'exo-ring';
  return mat;
}

/** A drifting cloud shell for a far body with clouds, lit by the scene's light. */
export function cloudShell(radius: number, seed: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSeed = { value: (seed % 97) * 1.37 };
    Object.assign(sh.uniforms, bodyUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vBodyDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBodyDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 vBodyDir; uniform float uSeed, uBodyTime;\n${GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 d = normalize(vBodyDir);
        float a = uBodyTime * 0.004 * (1.0 + 0.4 * d.y);
        vec3 p = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
        vec3 q = p * 3.0 + (vec3(bNoise(p * 4.0 + uSeed), bNoise(p * 4.0 + 7.1), bNoise(p * 4.0 + 13.7)) - 0.5) * 1.8;
        float n = bFbm(q * 2.0);
        diffuseColor.a *= smoothstep(0.5, 0.7, n) * (0.55 + 0.45 * smoothstep(0.2, 0.9, abs(d.y) + 0.3)) * 0.9;`);
  };
  mat.customProgramCacheKey = () => 'exo-cloud-shell';
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.015, 64, 40), mat);
  m.name = 'clouds';
  return m;
}

/** The look a body record asks for, with `auto` resolved. */
export function lookOf(d: BodyDef): Exclude<SurfaceLook, 'auto'> {
  const s = d.surface as SurfaceLook | undefined;
  return !s || s === 'auto' ? autoLook(d) : s;
}
