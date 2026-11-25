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
 *  - Up close (`sunNear` 1: the title tour's pass round the star) the photosphere turns from a white-hot disc to a
 *    rich gold one whose granulation, spots and faculae show, the shell gives way to `coronaRays()` (a camera-facing
 *    sheet of long streamers) and prominences arch off the limb.
 */
import * as THREE from 'three';
import { bodyUniforms, sunPosUniform } from './body-surface';

export const sunUniforms = { uSunPos: sunPosUniform };
/** 1 clear .. lower behind cloud or dust (weather): dims the disc and corona. */
export const sunDim = { value: 1 };
/** 0 far .. 1 right up at the star (SolarSystem.update sets it from the camera's distance). */
export const sunNear = { value: 0 };

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
    uniforms: { uBodyTime: bodyUniforms.uBodyTime, uDim: sunDim, uNear: sunNear },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <logdepthbuf_pars_fragment>
      uniform float uBodyTime, uDim, uNear;
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
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
        // up close: kept under white, so the surface reads: gold cells with orange lanes, a deep red limb,
        // bright faculae near the edge, and darker, redder spots with warm halos
        vec3 hotN = vec3(0.98, 0.58, 0.18), edgeN = vec3(0.55, 0.09, 0.01);
        vec3 near = mix(edgeN, hotN, pow(mu, 0.7));
        near *= 0.5 + 0.7 * gran;
        float fac = smoothstep(0.55, 0.8, sFbm(d * 9.0 - t * 0.004)) * (1.0 - smoothstep(0.15, 0.6, mu));
        near += vec3(0.5, 0.32, 0.12) * fac;
        near = mix(near, near * vec3(0.4, 0.18, 0.08), spot);
        near = mix(near, near * vec3(0.85, 0.6, 0.4), pen);
        col = mix(col, near, uNear);
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
    fog: false,
    toneMapped: false,
  });
}

export function coronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBodyTime: bodyUniforms.uBodyTime, uDim: sunDim, uNear: sunNear },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <logdepthbuf_pars_fragment>
      uniform float uBodyTime, uDim, uNear;
      varying vec3 vDir;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float mu = abs(dot(normalize(vN), normalize(vV)));
        // the shell is 1.3× the star: mu runs 0 at its outline to ~0.64 at the star's edge (the disc hides the rest)
        float rim = pow(smoothstep(0.0, 0.64, mu), 1.6);
        float s = sFbm(vDir * 7.0 + vec3(0.0, uBodyTime * 0.05, 0.0)) * 0.7 + sNoise(vDir * 19.0 - uBodyTime * 0.08) * 0.3;
        float a = rim * (0.35 + 0.9 * smoothstep(0.35, 0.75, s));
        a *= uDim * (1.0 - uNear);
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

/**
 * The star's corona up close (`sunNear`): a sheet always facing the camera, round the disc out to `OUT` radii.
 * Streamers: long, soft rays whose brightness varies round the rim and flickers slowly outward. Prominences: flame
 * loops at a few places on the limb, red-orange, rising and curling. Nothing inside the disc (the star covers it).
 */
export function coronaRays(starR: number): THREE.Mesh {
  const OUT = 4.2;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBodyTime: bodyUniforms.uBodyTime, uDim: sunDim, uNear: sunNear, uR: { value: starR }, uOut: { value: OUT } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uR, uOut;
      varying vec2 vP;
      void main() {
        vP = position.xy * uOut; // in star radii
        vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // nudged toward the camera by the star's radius, so the disc in front hides only what's behind it
        vec3 toCam = normalize(-c.xyz);
        c.xyz += toCam * uR * 0.0;
        gl_Position = projectionMatrix * (c + vec4(position.xy * uR * uOut, 0.0, 0.0));
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uBodyTime, uDim, uNear;
      varying vec2 vP;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vP);
        if (r < 0.985 || uNear < 0.01) discard;
        float a = atan(vP.y, vP.x);
        float t = uBodyTime;
        vec2 ca = vec2(cos(a), sin(a));
        // streamers: brightness round the rim (a few broad fans and many fine rays), stretched outward
        float fans = sFbm(vec3(ca * 1.6, t * 0.01));
        float rays = sNoise(vec3(ca * 14.0, r * 0.35 - t * 0.04)) * 0.6 + sNoise(vec3(ca * 37.0, r * 0.6 - t * 0.07)) * 0.4;
        float fall = exp(-(r - 1.0) * (2.4 - 1.2 * fans));
        float str = fall * (0.25 + 0.75 * smoothstep(0.3, 0.75, fans)) * (0.55 + 0.6 * rays);
        // a bright, thin inner corona hugging the limb
        float inner = exp(-(r - 1.0) * 14.0);
        vec3 col = vec3(1.2, 0.8, 0.45) * str * 0.85 + vec3(1.3, 0.62, 0.25) * inner * 0.5;
        // prominences: flame loops at a few places on the limb, rising and curling
        float site = smoothstep(0.5, 0.68, sNoise(vec3(ca * 2.6, 3.0 + t * 0.002)));
        float h = (r - 1.0) * 4.0;
        // arches: the flame field bent into loops (a curl that rises and falls back), with fine filaments
        float arch = sin(a * 9.0 + sNoise(vec3(ca * 3.0, t * 0.01)) * 6.0) * 0.5 + 0.5;
        float flame = sFbm(vec3(ca * 18.0 + vec2(h * 0.8, -h * 0.5), h * 1.3 - t * 0.12)) * 0.75 + arch * 0.25;
        float fil = sNoise(vec3(ca * 70.0, h * 3.0 - t * 0.2));
        float loop = smoothstep(0.42, 0.7, flame) * exp(-h * 0.9) * smoothstep(0.0, 0.06, h) * (0.7 + 0.5 * fil);
        col += vec3(1.7, 0.32, 0.06) * loop * site * 2.6;
        float alpha = clamp(max(str, inner) + loop * site, 0.0, 1.0);
        gl_FragColor = vec4(col * uDim * uNear, alpha * uNear);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = 2;
  return m;
}
