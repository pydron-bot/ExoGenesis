/**
 * Team trim: in skirmish each player's machines show their colour on their trim, not all over. The colour
 * comes per unit from an instanced attribute, `aTeam` (rgb; black = none: the campaign, or a mesh without
 * it, keeps the model's own look), so the instance colour stays free for health and hit flashes.
 *
 * Trim is picked by material name (blender/build.py):
 *  - `team`: painted trim (the side stripes and the bar on top): its paint becomes the team's colour;
 *  - `cyan`: the glowing strips every unit model has: they glow in the team's colour.
 * Only the up-close Blender models have it; the zoomed-out built-ins keep the whole-unit tint (ArmyView).
 */
import * as THREE from 'three';

export const TRIM_ATTR = 'aTeam';

/** An `aTeam` attribute for `geo` (one rgb per instance), all black. */
export function addTeamAttr(geo: THREE.BufferGeometry, count: number) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(TRIM_ATTR, a);
  return a;
}

const VERT_PARS = /* glsl */ `
  attribute vec3 aTeam;
  varying vec3 vTeam;`;
const VERT = /* glsl */ `
  vTeam = aTeam;`;
const FRAG_PARS = /* glsl */ `
  varying vec3 vTeam;`;

/** Give the model's trim materials the team colour. Safe to call more than once. */
export function addTeamTrim(mats: THREE.Material | THREE.Material[]) {
  for (const mat of Array.isArray(mats) ? mats : [mats]) {
    const m = mat as THREE.MeshStandardMaterial;
    const kind = m.name === 'team' ? 'paint' : m.name === 'cyan' ? 'glow' : null;
    if (!kind || !m.isMeshStandardMaterial || m.userData.trim) continue;
    m.userData.trim = true;
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>${VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${VERT}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>${FRAG_PARS}`);
      if (kind === 'paint') {
        // the team's colour as the paint, times the instance colour's brightness (health darkening, hit flash)
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          if (dot(vTeam, vTeam) > 1e-6) {
            #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
              float trimK = max(vColor.r, max(vColor.g, vColor.b));
            #else
              float trimK = 1.0;
            #endif
            diffuseColor.rgb = vTeam * 0.85 * trimK;
          }`);
      } else {
        // the strip glows in the team's colour, as bright as it was
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (dot(vTeam, vTeam) > 1e-6) totalEmissiveRadiance = vTeam * max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));`);
      }
    };
    m.customProgramCacheKey = () => `${prevKey()}|trim-${kind}`;
    m.needsUpdate = true;
  }
}
