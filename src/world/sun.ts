/**
 * The star's look and the sun's place for every shader that wants it.
 *
 *  - `sunUniforms.uSunPos`: where the sun is drawn in the scene (SolarSystem.update sets it each
 *    frame). Atmosphere shells use it to darken their night side and glow when backlit; rings use it
 *    for the planet's shadow and to brighten against the light.
 *  - `starMaterial()`: the photosphere: boiling granulation cells that drift and churn, a few dark
 *    spots, and limb darkening to a deep orange edge. Unlit and over 1.0 in the middle, so it blooms.
 *  - `coronaMaterial()`: a shell a little larger than the star with streamers that flicker outward,
 *    brightest at the edge (seen side-on), so the disc gets a ragged, living rim.
 */
import * as THREE from 'three';
import { bodyUniforms, sunPosUniform } from './body-surface';

export const sunUniforms = { uSunPos: sunPosUniform };
/** 1 clear .. lower behind cloud or dust (weather): dims the disc and corona. */
export const sunDim = { value: 1 };

const NOISE = /* glsl */`
float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * sNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// distance to the nearest of a jittered grid of points: cells
float sCells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 c = vec3(float(x), float(y), float(z));
    vec3 o = c + vec3(sHash(i + c), sHash(i + c + 13.1), sHash(i + c + 27.7)) - f;
    d = min(d, dot(o, o));
  }
  return sqrt(d);
}
`;

export function starMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBodyTime: bodyUniforms.uBodyTime, uDim: sunDim },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uBodyTime, uDim;
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE}
      void main() {
        float t = uBodyTime;
        vec3 d = vDir;
        // churning: the cell grid is pushed about by slow noise
        vec3 w = vec3(sNoise(d * 3.0 + t * 0.02), sNoise(d * 3.0 + 9.0 - t * 0.017), sNoise(d * 3.0 + 4.0 + t * 0.013)) - 0.5;
        float cells = sCells(d * 22.0 + w * 2.5 + t * 0.01);
        float fine = sCells(d * 55.0 - w * 3.0 - t * 0.02);
        // bright cell middles, dark lanes between them
        float gran = smoothstep(0.85, 0.15, cells) * 0.6 + smoothstep(0.9, 0.2, fine) * 0.4;
        // a few dark spots with lighter halos
        float sp = sFbm(d * 4.0 + 31.0 + t * 0.003);
        float spot = smoothstep(0.66, 0.72, sp);
        float pen = smoothstep(0.6, 0.66, sp) - spot;
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        // limb darkening: white-hot centre, deep orange edge
        vec3 hot = vec3(1.0, 0.86, 0.62), edge = vec3(0.85, 0.32, 0.06);
        vec3 col = mix(edge, hot, pow(mu, 0.45));
        col *= 0.62 + 0.6 * gran;
        col *= 1.0 - pen * 0.35 - spot * 0.7;
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
    fog: false,
    toneMapped: false,
  });
}

export function coronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBodyTime: bodyUniforms.uBodyTime, uDim: sunDim },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uBodyTime, uDim;
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE}
      void main() {
        float mu = abs(dot(normalize(vN), normalize(vV)));
        // the shell is 1.3× the star: mu runs 0 at its outline to ~0.64 at the star's edge (the disc hides the rest)
        float rim = pow(smoothstep(0.0, 0.64, mu), 1.6);
        float s = sFbm(vDir * 7.0 + vec3(0.0, uBodyTime * 0.05, 0.0)) * 0.7 + sNoise(vDir * 19.0 - uBodyTime * 0.08) * 0.3;
        float a = rim * (0.35 + 0.9 * smoothstep(0.35, 0.75, s));
        a *= uDim;
        gl_FragColor = vec4(vec3(1.4, 0.9, 0.5) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
  });
}
