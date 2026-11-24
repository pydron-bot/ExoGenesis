/**
 * Mist and sun haze: the scene's fog, made to sit in the land. Three's linear fog (near/far from the camera,
 * main.ts) stays; on top of it, in every lit material (the light map's shader patch, src/world/lights.ts):
 *
 *  - Mist pools in low ground: fog thickens below `uAtBase` (height above the planet's datum), fading out over
 *    `uAtScale` above it, and only past what the camera looks at (a valley across the map is hazy, one at your feet clear).
 *    main.ts makes it strongest round sunrise and sunset, and thicker in weather.
 *  - Looking toward the sun, the fog takes the sun's colour: haze glows warm round a low sun.
 *
 * Unlit materials (glow strips, sprites) keep the plain fog. Off on airless bodies and up in orbit.
 */
import * as THREE from 'three';

export const atmosUniforms = {
  /** Planet radius: heights are measured from it. */
  uAtR: { value: 1 },
  /** Mist: how much (0 = off), the height it pools below, how fast it thins above that, and the camera's distance (it builds beyond it). */
  uAtMist: { value: 0 },
  uAtBase: { value: 4 },
  uAtScale: { value: 6 },
  uAtReach: { value: 80 },
  /** Unit vector toward the sun, and the haze's colour and strength that way. */
  uAtSun: { value: new THREE.Vector3(0, 1, 0) },
  uAtSunCol: { value: new THREE.Color('#ffd2a0') },
  uAtSunK: { value: 0 },
};

/** Vertex declarations (the world position is filled in by the light-map patch). */
export const ATMOS_VERT_PARS = /* glsl */ `
        varying vec3 vAtW;`;

export const ATMOS_FRAG_PARS = /* glsl */ `
        uniform float uAtR, uAtMist, uAtBase, uAtScale, uAtReach, uAtSunK;
        uniform vec3 uAtSun, uAtSunCol;
        varying vec3 vAtW;`;

/** Replaces `#include <fog_fragment>`. */
export const ATMOS_FOG = /* glsl */ `
        #ifdef USE_FOG
        {
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          vec3 atV = vAtW - cameraPosition;
          float atD = max(length(atV), 1e-3);
          if (uAtMist > 0.001) {
            float alt = length(vAtW) - uAtR;
            float low = exp(-max(alt - uAtBase, 0.0) / uAtScale);
            // beyond what you're looking at: clear round the focus, building over the distance past it
            float mist = uAtMist * low * smoothstep(uAtReach * 0.6, uAtReach * 3.0, atD);
            fogFactor = 1.0 - (1.0 - fogFactor) * (1.0 - clamp(mist, 0.0, 0.85));
          }
          vec3 fc = fogColor;
          if (uAtSunK > 0.001) {
            float toSun = max(dot(atV / atD, uAtSun), 0.0);
            fc = mix(fogColor, uAtSunCol, uAtSunK * (pow(toSun, 6.0) * 0.8 + pow(toSun, 2.0) * 0.2));
          }
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
        }
        #endif`;
