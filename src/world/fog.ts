/**
 * Fog of war, render side. The sim sends a FOG_N² grid (0 unexplored,
 * 1 explored, 2 visible now); FogView eases a small texture toward it, and
 * `addFog` makes a material darken by that texture wherever it is drawn.
 *
 * Region coords come from the world position in the shader (the inverse of
 * regionDir), so the same add-on works for the terrain patch, instanced flora
 * and anything else on the surface, and stacks on a material's own
 * onBeforeCompile (flora's wind sway).
 */
import * as THREE from 'three';
import { FOG_N } from '../sim/types';
import { E, HALF, N, R, U } from './planet';

/** Brightness left in fog: never seen, and seen before but not now. */
const DARK = 0.1;
const SEEN = 0.42;

const makeTex = (n: number) => {
  const t = new THREE.DataTexture(new Uint8Array(n * n).fill(255), n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
};
let tex = makeTex(FOG_N);

export const fogUniforms = {
  uFogTex: { value: tex },
  /** How much fog shows, 0..1 (0 in skirmish / editor / ?fog=0; fades in after the landing). */
  uFogOn: { value: 0 },
  uFogDark: { value: DARK },
  uFogU: { value: U.clone() },
  uFogE: { value: E.clone() },
  uFogN: { value: N.clone() },
  uFogR: { value: R },
  uFogHalf: { value: HALF },
};

/** Match the texture and uniforms to the region being played (its body's radius, its size). */
function syncFog() {
  if (tex.image.width !== FOG_N) { tex.dispose(); tex = makeTex(FOG_N); fogUniforms.uFogTex.value = tex; }
  fogUniforms.uFogR.value = R;
  fogUniforms.uFogHalf.value = HALF;
}

/** Darken `mat` by the fog wherever it's drawn. Safe to call once per material. */
export function addFog(mat: THREE.Material) {
  syncFog();
  if (mat.userData.fog) return;
  mat.userData.fog = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, fogUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFogW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fogW4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogW4 = instanceMatrix * fogW4;
        #endif
        vFogW = (modelMatrix * fogW4).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFogW;
        uniform sampler2D uFogTex;
        uniform float uFogOn, uFogDark, uFogR, uFogHalf;
        uniform vec3 uFogU, uFogE, uFogN;`)
      .replace('#include <tonemapping_fragment>', `
        if (uFogOn > 0.001) {
          vec3 fd = normalize(vFogW);
          vec2 rp = uFogR * vec2(dot(fd, uFogE), dot(fd, uFogN)) / dot(fd, uFogU);
          // the region's grid; past its edge the land is unexplored too, fading back to lit over most of a
          // region's width (the globe carries this as well), so there's no hard square seen from above
          if (dot(fd, uFogU) > 0.5) {
            float fogOut = max(abs(rp.x), abs(rp.y)) - uFogHalf;
            float fv = texture2D(uFogTex, (clamp(rp, -uFogHalf, uFogHalf) + uFogHalf) / (2.0 * uFogHalf)).r;
            if (fogOut > 0.0) fv = mix(fv, 1.0, smoothstep(0.0, uFogHalf * 1.6, fogOut));
            gl_FragColor.rgb *= mix(1.0, mix(uFogDark, 1.0, fv), uFogOn);
          }
        }
        #include <tonemapping_fragment>`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|fog`;
  mat.needsUpdate = true;
}

/**
 * Seen from high up the fog thins (unexplored land lightens), so from orbit the region isn't a dark tile on a
 * lit planet; at play distances it's as dark as ever. `dist`: the camera's distance from its focus.
 */
export function fogDistance(dist: number) {
  fogUniforms.uFogDark.value = THREE.MathUtils.lerp(DARK, 0.8, THREE.MathUtils.smoothstep(dist, 180, 1200));
}

/** Eases the fog texture toward the sim's grid (cells brighten fast, darken slowly). */
export class FogView {
  /** Eased brightness per cell; starts fully lit, matching the texture's initial data. */
  private cur: Float32Array;
  private data: Uint8Array;
  private first = true;
  /** Target fog amount; `uFogOn` eases toward it. */
  amount = 0;

  /** Make it after the region is loaded (world/planet.ts setRegionTerrain): the grid follows the region's size. */
  constructor(readonly enabled: boolean) {
    syncFog();
    this.cur = new Float32Array(FOG_N * FOG_N).fill(1);
    this.data = tex.image.data as Uint8Array;
  }

  update(grid: Uint8Array | undefined, dt: number) {
    const u = fogUniforms.uFogOn;
    const want = this.enabled ? this.amount : 0;
    u.value += (want - u.value) * Math.min(1, dt * 1.5);
    if (Math.abs(want - u.value) < 0.002) u.value = want;
    if (!grid || !this.enabled) return;
    const up = this.first ? 1 : Math.min(1, dt * 4), down = this.first ? 1 : Math.min(1, dt * 1.2);
    this.first = false;
    let changed = false;
    for (let i = 0; i < grid.length; i++) {
      const want = grid[i] === 2 ? 1 : grid[i] === 1 ? SEEN : 0;
      const c = this.cur[i];
      if (Math.abs(want - c) < 0.002) continue;
      const v = c + (want - c) * (want > c ? up : down);
      this.cur[i] = v;
      const b = Math.round(v * 255);
      if (b !== this.data[i]) { this.data[i] = b; changed = true; }
    }
    if (changed) tex.needsUpdate = true;
  }

  /** New game / load: jump straight to the new state. */
  reset() { this.first = true; }
}
