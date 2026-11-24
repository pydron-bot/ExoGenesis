/**
 * Wear on the colony's machines (ArmyView's player units): painted, not modelled, so every vehicle gets it,
 * Blender model and built-in alike.
 *
 *  - Dust: the lower hull, tracks and wheels take on the ground's colour, rougher and less metallic, fading out
 *    over the first ~1.5 u above the ground. Height is measured above the terrain itself (the light map's height
 *    texture), not within the model, so a turret drawn apart from its hull isn't dusted as if it were the hull.
 *    A thinner film of it lies in patches on upward faces.
 *  - Panels: the hull's plates vary a few percent in tone (cells in the model's own space).
 *  - Each vehicle is a shade lighter or darker than the next (by instance), so a column doesn't look stamped out.
 *
 * Glow materials (black, emissive) are left alone.
 */
import * as THREE from 'three';
import { lightUniforms } from './lights';

export const wearUniforms = {
  /** The ground's colour (linear) and how much dust shows (0 = off). */
  uWearDust: { value: new THREE.Color('#7c4a33') },
  uWearK: { value: 1 },
};

const VERT_PARS = /* glsl */ `
  uniform sampler2D uWearH;
  uniform float uWearR, uWearHalf;
  uniform vec3 uWearU, uWearE, uWearN;
  varying vec3 vWearP;
  varying float vWearLift;
  varying float vWearI;`;

const VERT = /* glsl */ `
  {
    vWearP = position;
    vec4 ww4 = vec4(transformed, 1.0);
    vWearI = 0.0;
    #ifdef USE_INSTANCING
      ww4 = instanceMatrix * ww4;
      vWearI = float(gl_InstanceID);
    #endif
    vec3 ww = (modelMatrix * ww4).xyz;
    float wr = length(ww);
    vec3 wd = ww / wr;
    float wup = dot(wd, uWearU);
    vec2 wrp = uWearR * vec2(dot(wd, uWearE), dot(wd, uWearN)) / max(wup, 0.5);
    float wg = texture2D(uWearH, (wrp + uWearHalf + 0.5) / (2.0 * uWearHalf + 1.0)).r;
    vWearLift = wr - uWearR - max(wg, 0.0);
  }`;

const FRAG_PARS = /* glsl */ `
  uniform vec3 uWearDust, uWearUpV;
  uniform float uWearK;
  varying vec3 vWearP;
  varying float vWearLift;
  varying float vWearI;
  float wearHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float wearDust() {
    // a ragged edge: the dust line wanders a little round the hull
    float edge = 0.25 * (wearHash(floor(vWearP * 3.0)) - 0.5);
    return uWearK * (1.0 - smoothstep(0.15, 1.5 + edge, vWearLift));
  }`;

/** Before the lighting (the normal is known by then): tone, dust low down and a film of it on flat tops. */
const FRAG_WEAR = /* glsl */ `
  {
    float pn = wearHash(floor(vWearP * vec3(1.3, 2.1, 1.1)));
    float iv = fract(sin(vWearI * 91.7 + 3.1) * 4375.85);
    diffuseColor.rgb *= (0.9 + 0.16 * pn) * (0.94 + 0.12 * iv);
    float wd = wearDust() * 0.75;
    // settled on upward faces, in patches
    float top = pow(max(dot(normal, uWearUpV), 0.0), 3.0) * (0.12 + 0.3 * wearHash(floor(vWearP * 4.0) + 7.0)) * uWearK;
    float wk = max(wd, top);
    diffuseColor.rgb = mix(diffuseColor.rgb, uWearDust * 1.2, wk);
    roughnessFactor = mix(roughnessFactor, 0.95, wk);
    metalnessFactor *= 1.0 - wk * 0.8;
  }`;

/** Give `mat` the wear. Safe to call more than once; skips glow materials. */
export function addWear(mat: THREE.Material | THREE.Material[]) {
  if (Array.isArray(mat)) { mat.forEach(addWear); return; }
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.userData.wear) return;
  m.userData.wear = true;
  // glow parts: a black base lit by its emission
  if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0 && m.color.getHex() === 0) return;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, wearUniforms, {
      // the light map's ground heights, under names of our own (its patch declares its own in the same shader)
      uWearH: lightUniforms.uLmH, uWearR: lightUniforms.uLmR, uWearHalf: lightUniforms.uLmHalf,
      uWearU: lightUniforms.uLmU, uWearE: lightUniforms.uLmE, uWearN: lightUniforms.uLmN, uWearUpV: lightUniforms.uLmUpV,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_PARS}`)
      .replace('#include <lights_physical_fragment>', `${FRAG_WEAR}
        #include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|wear`;
  m.needsUpdate = true;
}
