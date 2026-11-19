/**
 * Ambient wildlife models (content/wildlife `body`): one low-poly geometry per
 * body plan and species colours, baked as vertex colours with an `aGlow`
 * channel (eyes, spots) that lights up at night like the flora. All species
 * share one material, so each species on the map is one instanced draw.
 *
 * Scale 1 is the old grazer: about 1.5 u long. Origin on the ground, head
 * toward +z.
 */
import * as THREE from 'three';
import { Mesher, floraUniforms } from './flora';

type V = THREE.Vector3;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface CreatureLook { body: string; color: string; accent: string; glow?: string }

/** Ellipsoid (low-poly icosahedron scaled per axis). */
function ellipsoid(m: Mesher, c: V, rx: number, ry: number, rz: number, col: THREE.Color, g = 0, detail = 0) {
  const geo = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  geo.scale(rx, ry, rz);
  const p = geo.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i).add(c); b.fromBufferAttribute(p, i + 1).add(c); d.fromBufferAttribute(p, i + 2).add(c);
    m.tri(a, b, d, col, col, col, g, g, g);
  }
  geo.dispose();
}
const limb = (m: Mesher, pts: V[], r: number, col: THREE.Color) => m.tube(pts, 3, (t) => r * (1 - t * 0.4), () => col, undefined, true);
/** Two glowing eyes either side of a head at `c` facing +z. */
function eyes(m: Mesher, c: V, spread: number, r: number, glow: THREE.Color, dark: THREE.Color, lit: number) {
  for (const s of [-1, 1]) ellipsoid(m, v3(c.x + s * spread, c.y, c.z), r, r, r, lit ? glow : dark, lit);
}

const PLANS: Record<string, (m: Mesher, c: THREE.Color, a: THREE.Color, g: THREE.Color, lit: number) => void> = {
  hexapod(m, c, a, g, lit) {
    ellipsoid(m, v3(0, 1, 0), 0.56, 0.42, 0.98, c);
    ellipsoid(m, v3(0, 1.32, -0.1), 0.3, 0.12, 0.6, a); // a ridge down the back
    ellipsoid(m, v3(0, 1.12, 1.15), 0.3, 0.26, 0.45, a);
    eyes(m, v3(0, 1.22, 1.45), 0.16, 0.07, g, a, lit);
    for (const z of [-0.6, 0, 0.6]) for (const x of [-1, 1]) limb(m, [v3(x * 0.4, 0.95, z), v3(x * 0.62, 0.55, z + 0.05), v3(x * 0.55, 0, z + 0.1)], 0.07, a);
  },
  stilt(m, c, a, g, lit) {
    ellipsoid(m, v3(0, 1.75, 0), 0.42, 0.34, 0.62, c);
    for (const z of [-0.35, 0.35]) for (const x of [-1, 1]) limb(m, [v3(x * 0.25, 1.65, z), v3(x * 0.55, 1.1, z * 1.4), v3(x * 0.5, 0, z * 1.7)], 0.07, a);
    m.tube([v3(0, 1.85, 0.5), v3(0, 2.0, 0.85), v3(0, 1.7, 1.15)], 4, (t) => 0.12 * (1 - t * 0.4), () => c, undefined, true);
    ellipsoid(m, v3(0, 1.62, 1.3), 0.16, 0.14, 0.3, a);
    eyes(m, v3(0, 1.68, 1.42), 0.1, 0.05, g, a, lit);
  },
  hopper(m, c, a, g, lit) {
    ellipsoid(m, v3(0, 0.5, 0), 0.38, 0.36, 0.45, c, 0, 1);
    for (const x of [-1, 1]) {
      limb(m, [v3(x * 0.3, 0.45, -0.15), v3(x * 0.4, 0.55, -0.5), v3(x * 0.38, 0, -0.3)], 0.09, a); // big folded hind leg
      limb(m, [v3(x * 0.15, 0.35, 0.3), v3(x * 0.18, 0, 0.38)], 0.04, a);
      m.tube([v3(x * 0.1, 0.8, 0.3), v3(x * 0.3, 1.25, 0.55), v3(x * 0.42, 1.45, 0.9)], 3, () => 0.025, () => a, (t) => (t > 0.9 ? 1 : 0), false);
    }
    if (lit) for (const x of [-1, 1]) ellipsoid(m, v3(x * 0.42, 1.45, 0.92), 0.05, 0.05, 0.05, g, lit);
    eyes(m, v3(0, 0.62, 0.4), 0.15, 0.07, g, a, lit);
  },
  ray(m, c, a, g, lit) {
    ellipsoid(m, v3(0, 0, 0.1), 0.24, 0.12, 0.62, c);
    for (const x of [-1, 1]) {
      const root = v3(x * 0.15, 0.02, 0.5), tip = v3(x * 1.45, 0.12, -0.35), back = v3(x * 0.15, 0, -0.45), mid = v3(x * 0.7, 0.07, 0.2);
      m.tri(root, tip, back, c, a, c);
      m.tri(root, mid, tip, c, c, a);
      if (lit) ellipsoid(m, v3(x * 0.75, 0.08, -0.08), 0.1, 0.03, 0.1, g, lit);
    }
    m.tube([v3(0, 0, -0.45), v3(0, 0.05, -1.1), v3(0, 0.15, -1.7)], 3, (t) => 0.06 * (1 - t), () => a, undefined, false);
    eyes(m, v3(0, 0.08, 0.66), 0.1, 0.05, g, a, lit);
  },
  crawler(m, c, a, g, lit) {
    for (const [z, s] of [[-0.55, 0.85], [0, 1], [0.5, 0.9]] as const) ellipsoid(m, v3(0, 0.3, z), 0.36 * s, 0.24 * s, 0.34 * s, c);
    if (lit) for (const z of [-0.55, 0, 0.5]) ellipsoid(m, v3(0, 0.52, z), 0.08, 0.04, 0.12, g, lit * 0.8);
    ellipsoid(m, v3(0, 0.28, 0.85), 0.22, 0.16, 0.2, a);
    for (const x of [-1, 1]) {
      limb(m, [v3(x * 0.1, 0.25, 0.98), v3(x * 0.18, 0.2, 1.2)], 0.03, a); // mandibles
      for (const z of [-0.5, 0, 0.45]) limb(m, [v3(x * 0.25, 0.28, z), v3(x * 0.55, 0.32, z + 0.1), v3(x * 0.6, 0, z + 0.15)], 0.04, a);
    }
    eyes(m, v3(0, 0.36, 1.0), 0.1, 0.04, g, a, lit);
  },
  shell(m, c, a, g, lit) {
    ellipsoid(m, v3(0, 0.45, 0), 0.95, 0.68, 1.15, c, 0, 1);
    for (let i = 0; i < 5; i++) { // plates
      const ang = (i / 5) * Math.PI * 2;
      ellipsoid(m, v3(Math.cos(ang) * 0.45, 1.0, Math.sin(ang) * 0.5), 0.28, 0.12, 0.3, a);
    }
    if (lit) for (let i = 0; i < 5; i++) {
      const ang = ((i + 0.5) / 5) * Math.PI * 2;
      ellipsoid(m, v3(Math.cos(ang) * 0.62, 0.9, Math.sin(ang) * 0.7), 0.07, 0.05, 0.07, g, lit * 0.8);
    }
    ellipsoid(m, v3(0, 0.45, 1.2), 0.3, 0.25, 0.35, a);
    eyes(m, v3(0, 0.55, 1.45), 0.14, 0.06, g, a, lit);
    for (const z of [-0.6, 0.6]) for (const x of [-1, 1]) limb(m, [v3(x * 0.7, 0.3, z), v3(x * 0.85, 0, z * 1.05)], 0.14, a);
  },
  serpent(m, c, a, g, lit) {
    const path: V[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      path.push(v3(Math.sin(t * Math.PI * 2.2) * 0.3 * (1 - t * 0.3), 0.18, 1.0 - t * 2.6));
    }
    m.tube(path, 5, (t) => 0.2 * (1 - t * 0.8), (t) => (Math.floor(t * 8) % 2 ? a : c), () => 0, false);
    ellipsoid(m, v3(path[0].x, 0.22, 1.12), 0.2, 0.15, 0.3, c);
    eyes(m, v3(path[0].x, 0.3, 1.28), 0.1, 0.045, g, a, lit);
  },
};
export const BODY_PLAN_NAMES = Object.keys(PLANS);

/** Geometry for one species (its body plan in its colours). Unknown plans draw as a hexapod. */
export function buildCreatureLook(look: CreatureLook): THREE.BufferGeometry {
  const m = new Mesher();
  const g = new THREE.Color(look.glow || look.accent);
  (PLANS[look.body] ?? PLANS.hexapod)(m, new THREE.Color(look.color), new THREE.Color(look.accent), g, look.glow ? 1 : 0);
  return m.build(false);
}

/** The shared wildlife material: flat-shaded vertex colours, glowing parts brighten at night. */
export function creatureMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = floraUniforms.uGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGlow;
        varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGlow;
        varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * (0.12 + vGlow * (0.6 + uGlow));`);
  };
  mat.customProgramCacheKey = () => 'creature-v1';
  return mat;
}
