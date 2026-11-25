/**
 * The night sky behind everything: the star field and a Milky Way band.
 *
 *  - Stars: points on a far sphere, re-centred on the camera every frame (SolarSystem.update). Each has
 *    its own size, tint and twinkle phase; about a third crowd along the band. Seen from the ground
 *    (`uTwinkle` → 1) they shimmer through the air; in space they hold steady.
 *  - Milky Way: an inside-out sphere just inside the stars, drawn per pixel: a soft band along a great
 *    circle, brighter and warmer toward its core, broken by drifting cloud and dark dust lanes, with faint
 *    coloured nebula patches. Additive and faint; hidden by a bright daytime sky (`uFade`).
 */
import * as THREE from 'three';

const FAR = 6e6;
/** The band's pole and the direction of its bright core (any unit vectors at right angles). */
const POLE = new THREE.Vector3(0.32, 0.86, 0.4).normalize();
const CORE = new THREE.Vector3().crossVectors(POLE, new THREE.Vector3(0, 0, 1)).normalize();

const NOISE = /* glsl */`
float mHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1, 0, 0)), f.x), mix(mHash(i + vec3(0, 1, 0)), mHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0, 0, 1)), mHash(i + vec3(1, 0, 1)), f.x), mix(mHash(i + vec3(0, 1, 1)), mHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float mFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * mNoise(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
`;

export function milkyWay(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPole: { value: POLE }, uCore: { value: CORE }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uPole, uCore;
      uniform float uFade;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float lat = dot(d, uPole);
        float core = max(dot(d, uCore), 0.0);
        // wider and brighter toward the core
        float width = 0.13 + 0.12 * core * core;
        // most of the sky is away from the band: skip the noise there (cheap on phones)
        if (abs(lat) > width * 2.6) discard;
        float clouds = mFbm(d * 6.0);
        float band = exp(-pow(lat / width, 2.0)) * (0.45 + 0.8 * clouds);
        // dark dust lanes along the middle of the band
        float lanes = smoothstep(0.45, 0.7, mFbm(d * 11.0 + 7.0)) * exp(-pow(lat / (width * 0.45), 2.0));
        band *= 1.0 - 0.75 * lanes;
        float glow = band * (0.35 + 0.9 * pow(core, 3.0));
        vec3 col = mix(vec3(0.45, 0.55, 0.95), vec3(1.0, 0.78, 0.55), pow(core, 2.0) * smoothstep(0.0, 1.0, band));
        // faint nebula patches: rose and teal
        float neb = smoothstep(0.62, 0.8, mFbm(d * 3.0 + 21.0));
        vec3 nebCol = mix(vec3(0.9, 0.35, 0.55), vec3(0.3, 0.8, 0.8), step(0.5, mNoise(d * 2.0 + 5.0)));
        vec3 c = col * glow * 0.16 + nebCol * neb * 0.035 * band;
        gl_FragColor = vec4(c * uFade, 1.0);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(FAR * 0.9, 64, 32), mat);
  m.frustumCulled = false;
  m.renderOrder = -2;
  return m;
}

/** The star field; `rnd` is the system's seeded random. */
export function starField(rnd: () => number, count = 6000): THREE.Points {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
  const tint = new THREE.Color(), p = new THREE.Vector3();
  const side = new THREE.Vector3().crossVectors(POLE, CORE);
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.35) {
      // along the band: a random longitude, latitude clustered round the plane
      const a = rnd() * Math.PI * 2, lat = (rnd() + rnd() + rnd() - 1.5) * 0.12;
      p.copy(CORE).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).addScaledVector(POLE, lat).normalize();
    } else p.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    p.multiplyScalar(FAR);
    pos.set([p.x, p.y, p.z], i * 3);
    // mostly blue-white, a few warm
    const warm = rnd() < 0.18;
    tint.setHSL(warm ? 0.07 + rnd() * 0.06 : 0.55 + rnd() * 0.12, warm ? 0.55 : 0.4, 0.55 + rnd() * 0.4);
    col.set([tint.r, tint.g, tint.b], i * 3);
    // a few bright ones
    size[i] = 1.1 + rnd() ** 6 * 2.6;
    phase[i] = rnd() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTwinkle: { value: 0 }, uOpacity: { value: 1 }, uScale: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 color;
      uniform float uTime, uTwinkle, uScale;
      varying vec3 vCol;
      varying float vTw;
      void main() {
        vCol = color;
        // twinkle: two flickers beating against each other
        float tw = 0.5 + 0.5 * sin(uTime * (3.0 + fract(aPhase) * 4.0) + aPhase) * sin(uTime * 1.7 + aPhase * 2.3);
        vTw = mix(1.0, 0.35 + 0.95 * tw, uTwinkle);
        gl_PointSize = aSize * uScale * mix(1.0, 0.8 + 0.4 * tw, uTwinkle);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vCol;
      varying float vTw;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.15, length(q));
        gl_FragColor = vec4(vCol * vTw, a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

/**
 * Light in the air round the sun, added over the sky colour (seen from the ground, on bodies with air):
 * a soft halo round the sun by day, and at sunrise and sunset (`uGolden`) a warm band low along the
 * horizon, brightest on the sun's side and fading round to a rose afterglow opposite it.
 */
export function skyGlow(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uGolden: { value: 0 }, uAir: { value: 0 }, uDay: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uUp;
      uniform float uGolden, uAir, uDay;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = dot(d, uUp);
        float cs = dot(d, uSun);
        // horizontal: how far round from the sun's side
        vec3 dh = normalize(d - uUp * h + 1e-5), sh = normalize(uSun - uUp * dot(uSun, uUp) + 1e-5);
        float side = dot(dh, sh) * 0.5 + 0.5;
        float low = exp(-max(h, 0.0) * 7.0) * smoothstep(-0.12, 0.0, h);
        vec3 warm = mix(vec3(0.55, 0.25, 0.35), vec3(1.0, 0.5, 0.18), pow(side, 2.0));
        vec3 band = warm * low * (0.25 + 0.75 * pow(side, 3.0)) * uGolden * 0.55;
        // the halo: a tight bright core and a wide soft glow
        float halo = pow(max(cs, 0.0), 300.0) * 0.6 + pow(max(cs, 0.0), 12.0) * 0.18;
        vec3 haloCol = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.6, 0.3), uGolden);
        vec3 c = (band + haloCol * halo * (0.35 + 0.65 * max(uDay, uGolden))) * uAir;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(FAR * 0.85, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/**
 * The sky itself, seen from the ground on bodies with air (drawn over the flat background colour, under the
 * sun's glow): a gradient from the horizon (exactly the background, so the fog it matches meets it seamlessly)
 * to a deeper zenith, and a layer of drifting clouds lit from the sun's side, warm round sunrise and sunset, grey
 * and thicker in bad weather (`uOvercast`), dark at night where they blot out the stars. Off from orbit.
 */
export function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uBg: { value: new THREE.Color() },
      uAir: { value: 0 }, uDay: { value: 0 }, uGolden: { value: 0 }, uOvercast: { value: 0 }, uTime: { value: 0 }, uCloudy: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uUp, uBg;
      uniform float uAir, uDay, uGolden, uOvercast, uTime, uCloudy;
      varying vec3 vDir;
      float sH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(sH(i), sH(i + vec2(1, 0)), f.x), mix(sH(i + vec2(0, 1)), sH(i + vec2(1, 1)), f.x), f.y); }
      float sF(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * sN(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = dot(d, uUp);
        if (h < -0.05) discard;
        // gradient: the horizon is the background (and the fog); higher up deeper and bluer, a pale band just above it
        float up = smoothstep(0.0, 0.85, h);
        vec3 zen = uBg * mix(vec3(0.62, 0.74, 0.92), vec3(0.75, 0.62, 0.7), uGolden);
        vec3 col = mix(uBg, zen, up) + uBg * 0.12 * exp(-max(h, 0.0) * 18.0) * uDay;
        float a = smoothstep(-0.05, 0.02, h) * uDay;
        // clouds on a sheet overhead, drifting
        if (uCloudy > 0.5 && h > 0.0) {
          vec3 e = normalize(cross(uUp, abs(uUp.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 n = cross(e, uUp);
          vec2 p = vec2(dot(d, e), dot(d, n)) / max(h, 0.08) * 1.6 + vec2(uTime * 0.012, uTime * 0.005);
          float cov = 0.58 - 0.22 * uOvercast;
          float f = sF(p);
          float c = smoothstep(cov, cov + 0.22, f) * smoothstep(0.02, 0.3, h);
          if (c > 0.002) {
            float toSun = max(dot(d, uSun), 0.0);
            // thicker cores are darker underneath; the sun's side and the edges catch light
            float body = smoothstep(cov + 0.05, cov + 0.4, f);
            vec3 day = mix(vec3(1.0, 0.99, 0.97), vec3(0.72, 0.75, 0.8), body) * (0.85 + 0.3 * pow(toSun, 3.0));
            day = mix(day, vec3(1.0, 0.62, 0.42) * (0.8 + 0.5 * pow(toSun, 2.0)), uGolden * 0.75);
            vec3 night = uBg * 1.25 + vec3(0.01, 0.012, 0.016);
            vec3 cc = mix(night, day * max(uBg * 1.6, vec3(0.55)), max(uDay, uGolden * 0.6));
            cc *= 1.0 - 0.4 * uOvercast;
            col = mix(col, cc, c * (0.85 + 0.15 * uOvercast));
            a = max(a, c * (0.9 + 0.1 * uOvercast));
          }
        }
        gl_FragColor = vec4(col, a * uAir);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(FAR * 0.8, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -1.5;
  return m;
}
