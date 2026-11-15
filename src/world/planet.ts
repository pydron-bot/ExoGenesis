/**
 * The home planet and the mapping between region coordinates (x, z on a flat
 * sim grid) and the curved world. The home planet sits at the world origin —
 * the floating origin for everything that needs precision — and the rest of
 * the system is placed relative to it.
 */
import * as THREE from 'three';
import { REGION_HALF } from '../sim/types';
import { fbm3, lerp, smoothstep } from './noise';

export const R = 3000;
export const HALF = REGION_HALF;

/** Region frame: U = up at the landing site, E/N = tangent axes (sim x/z). */
export const U = new THREE.Vector3(0.55, 0.5, 0.67).normalize();
export const E = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), U).normalize();
export const N = new THREE.Vector3().crossVectors(U, E).normalize();

const _d = new THREE.Vector3();

export function regionDir(x: number, z: number, out = new THREE.Vector3()) {
  return out.copy(U).multiplyScalar(R).addScaledVector(E, x).addScaledVector(N, z).normalize();
}

export function globeHeight(d: THREE.Vector3): number {
  let h = fbm3(d.x * 2.1 + 3.1, d.y * 2.1, d.z * 2.1 - 1.7, 6, 7) * 90;
  // keep the landing site (and the tutorial regions around it) on dry land
  const ang = Math.acos(Math.min(1, d.dot(U)));
  h += (1 - smoothstep(0.04, 0.26, ang)) * 40;
  return h;
}

export function floraAt(d: THREE.Vector3): number {
  return fbm3(d.x * 14 + 11, d.y * 14, d.z * 14, 3, 33);
}

function regionBase(x: number, z: number): number {
  const h = globeHeight(regionDir(x, z, _d));
  const edge = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
  return h + fbm3(x * 0.045, 1.3, z * 0.045, 3, 21) * 10 * smoothstep(0, 26, edge);
}

let coreH: number | null = null;

/** Raw (may be below sea level) height for region coords; flattened pad around the core. */
export function regionHeightRaw(x: number, z: number): number {
  coreH ??= Math.max(1.5, regionBase(0, 0));
  return lerp(coreH, regionBase(x, z), smoothstep(13, 28, Math.hypot(x, z)));
}

export const regionHeight = (x: number, z: number) => Math.max(0, regionHeightRaw(x, z));

/** World position of region coords, `lift` units above the ground. */
export function regionToWorld(x: number, z: number, lift: number, out = new THREE.Vector3()) {
  return regionDir(x, z, out).multiplyScalar(R + regionHeight(x, z) + lift);
}

/** Inverse of regionDir: world point → region coords (unclamped). */
export function worldToRegion(p: THREE.Vector3): { x: number; z: number } {
  _d.copy(p).normalize();
  const cu = _d.dot(U);
  return { x: (R * _d.dot(E)) / cu, z: (R * _d.dot(N)) / cu };
}

const C = {
  deep: new THREE.Color('#0f2a3a'),
  shallow: new THREE.Color('#1f5a6a'),
  shore: new THREE.Color('#b59b74'),
  low: new THREE.Color('#7c4a33'),
  mid: new THREE.Color('#a8744d'),
  floraA: new THREE.Color('#563a78'),
  floraB: new THREE.Color('#2d6e68'),
  high: new THREE.Color('#ddd3c4'),
};
const _c = new THREE.Color();

export function terrainColor(h: number, flora: number, out: THREE.Color) {
  if (h <= 0) return out.copy(C.deep).lerp(C.shallow, smoothstep(-30, 0, h));
  if (h < 2.5) return out.copy(C.shore);
  out.copy(C.low).lerp(C.mid, smoothstep(3, 30, h));
  const f = smoothstep(0.02, 0.2, flora) * (1 - smoothstep(26, 36, h));
  if (f > 0) out.lerp(_c.copy(C.floraA).lerp(C.floraB, smoothstep(-0.2, 0.3, fbm3(flora * 7, 2, 3, 1, 5))), f * 0.85);
  return out.lerp(C.high, smoothstep(34, 46, h));
}

/** Low-poly globe; the part under the landing region is sunk so the detailed patch covers it. */
export function buildGlobe(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, 64);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    let h = globeHeight(d);
    const cu = d.dot(U);
    if (cu > 0.95) {
      const x = (R * d.dot(E)) / cu, z = (R * d.dot(N)) / cu;
      const inner = Math.max(Math.abs(x), Math.abs(z));
      if (inner < HALF + 2) {
        // follow the detailed patch; sink only well inside it so coarse triangles that
        // straddle the border don't open a trench along the patch edge
        terrainColor(regionHeightRaw(x, z), floraAt(d), color);
        h = Math.max(0, regionHeightRaw(x, z)) - (inner < HALF - 60 ? 14 : 1.5);
        col.set([color.r, color.g, color.b], i * 3);
        pos.setXYZ(i, d.x * (R + h), d.y * (R + h), d.z * (R + h));
        continue;
      }
    }
    terrainColor(h, floraAt(d), color);
    col.set([color.r, color.g, color.b], i * 3);
    pos.setXYZ(i, d.x * (R + Math.max(0, h)), d.y * (R + Math.max(0, h)), d.z * (R + Math.max(0, h)));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  );
  mesh.name = 'home-globe';
  return mesh;
}

/** Thin fresnel shell for the atmosphere glow seen from orbit. */
export function buildAtmosphere(radius: number, color: THREE.ColorRepresentation, strength = 1): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color;
      uniform float strength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6) * strength;
        gl_FragColor = vec4(color * f, f);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
}
