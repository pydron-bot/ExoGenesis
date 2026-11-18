/**
 * Procedural (built-in) models for the roster added in v0.25–v0.28 (docs/ROSTER.md): low-poly,
 * flat-shaded versions of the Blender set v5–v8 with the same size, silhouette and colours.
 * They're drawn when the camera is zoomed out (RegionView's level of detail), while the
 * Blender file loads, and with `?models=builtin`. Front is +Z (the Blender models' −Y).
 * Parts the game animates keep their names (`dish` spins, `charge` / `seal` glow).
 */
import * as THREE from 'three';

const metal = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.45, flatShading: true });
const matte = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05, flatShading: true });
const glow = (c: THREE.ColorRepresentation, i = 2.2) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: i, flatShading: true });

const HULL = '#b4bcc3', HULL2 = '#8f989f', DARK = '#363c44';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 8, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);

/** A strut from a to b (region-local, y up). */
function strut(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, mat: THREE.Material, seg = 4) {
  const va = new THREE.Vector3(a.x, a.y, a.z), vb = new THREE.Vector3(b.x, b.y, b.z);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

/** Sensor Mast: tripod, mast and a camera head (`dish`) ~5 u up. */
export function buildSensor(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal(DARK), hull = metal(HULL), hull2 = metal(HULL2);
  g.add(mesh(cyl(1.3, 0.3, 6), dark, 0, 0.15, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    g.add(strut({ x: Math.cos(a) * 1.15, y: 0.2, z: Math.sin(a) * 1.15 }, { x: 0, y: 4.2, z: 0 }, 0.08, hull2));
  }
  g.add(mesh(cyl(0.16, 4.6, 6), hull, 0, 2.6, 0));
  const head = new THREE.Group();
  head.name = 'dish';
  head.position.y = 5;
  head.add(mesh(box(0.8, 0.5, 0.9), hull, 0, 0.2, 0), mesh(box(0.6, 0.12, 0.08), glow('#5ff3ff', 2), 0, 0.2, 0.48));
  head.add(mesh(new THREE.OctahedronGeometry(0.12), glow('#ff6a4d', 3), 0.3, 1.2, -0.3));
  g.add(head);
  return g;
}

/** Habitat Block: three stacked living modules on a deck, warm window strips, a stair tower. */
export function buildHabitat(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), warm = glow('#ffe2a8', 1.6);
  g.add(mesh(box(9, 0.5, 8), dark, 0, 0.25, 0));
  for (const [z, y, w, h, yaw] of [[1.8, 1.7, 7, 2.4, 0], [-1.6, 1.7, 7, 2.4, 0], [0, 4.0, 6, 2.2, 0.18]] as const) {
    const mod = new THREE.Group();
    mod.position.set(z === 0 ? -0.4 : 0, y, z);
    mod.rotation.y = yaw;
    mod.add(mesh(box(w, h, 3), hull));
    mod.add(mesh(box(w - 1, 0.4, 3.08), warm, 0, 0.25, 0));
    mod.add(mesh(box(0.25, h + 0.1, 3.15), hull2, w / 2, 0, 0), mesh(box(0.25, h + 0.1, 3.15), hull2, -w / 2, 0, 0));
    g.add(mod);
  }
  g.add(mesh(box(1.6, 5.6, 1.6), hull2, 3.9, 2.9, 1.0));
  g.add(mesh(box(1.8, 2.2, 1.4), hull2, -1.5, 1.6, 3.9), mesh(box(1.2, 0.1, 0.1), glow('#ffb547', 2.6), -1.5, 2.35, 4.64));
  g.add(mesh(cyl(0.7, 1.2, 8), hull2, 1.6, 5.7, -0.2));
  return g;
}

/** Relay Tower: a tapering three-legged mast ~17 u tall with antenna panels and a cyan beacon (`charge`). */
export function buildRelay(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal(DARK), hull = metal(HULL), hull2 = metal(HULL2), H = 14;
  g.add(mesh(cyl(2.4, 0.5, 6), dark, 0, 0.25, 0), mesh(cyl(1.4, 1.2, 6, 1.1), hull2, 0, 1.1, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    g.add(strut({ x, y: 1.6, z }, { x: x * 0.35, y: H, z: z * 0.35 }, 0.1, hull));
    const b = a + Math.PI / 3;
    g.add(mesh(box(0.6, 0.4, 0.6), dark, Math.cos(b) * 3.2, 0.2, Math.sin(b) * 3.2));
    g.add(mesh(box(0.9, 1.8, 0.12), hull, Math.cos(a + 0.5) * 0.65, H - 1.4, Math.sin(a + 0.5) * 0.65));
  }
  for (const y of [5, 9]) g.add(mesh(cyl(0.75 - y * 0.03, 0.12, 3), hull2, 0, y, 0));
  g.add(mesh(cyl(0.5, 0.6, 8), dark, 0, H + 0.3, 0), mesh(cyl(0.05, 2.6, 4), dark, 0, H + 1.9, 0));
  g.add(mesh(new THREE.OctahedronGeometry(0.18), glow('#ff6a4d', 3), 0, H + 3.25, 0));
  g.add(mesh(cyl(0.62, 0.25, 8), glow('#5ff3ff', 2.2), 0, H - 2.7, 0, 'charge'), mesh(cyl(0.45, 0.2, 8), glow('#5ff3ff', 2.2), 0, H + 0.7, 0, 'charge'));
  return g;
}

/** Tech Lab: two wings round a glass-domed core with a glowing experiment inside, a spire. */
export function buildLab(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), cyan = glow('#5ff3ff', 2);
  g.add(mesh(box(10, 0.5, 8), dark, 0, 0.25, 0));
  for (const sx of [-1, 1]) {
    g.add(mesh(box(3.6, 2.4, 6.4), hull, sx * 3, 1.7, 0), mesh(box(3.8, 0.25, 6.6), hull2, sx * 3, 3.0, 0));
    g.add(mesh(box(0.08, 0.35, 5.4), cyan, sx * 4.82, 2.0, 0));
  }
  g.add(mesh(cyl(2.4, 3.0, 10), hull2, 0, 2.0, 0));
  const dome = mesh(new THREE.SphereGeometry(2.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a4a5a', roughness: 0.15, metalness: 0.2, flatShading: true }), 0, 3.5, 0);
  dome.scale.y = 0.75;
  g.add(dome, mesh(new THREE.OctahedronGeometry(0.7), cyan, 0, 4.0, 0));
  g.add(mesh(cyl(0.12, 4, 5), dark, 2.6, 5.0, 2.4), mesh(new THREE.OctahedronGeometry(0.14), glow('#ff6a4d', 3), 2.6, 7.4, 2.4));
  g.add(mesh(box(2, 2, 1.4), hull2, 0, 1.3, 4.4), mesh(box(1.3, 0.1, 0.1), cyan, 0, 2.0, 5.14));
  return g;
}

/** Deep-Core Mine: a four-legged derrick over the bore, a pump house, violet canisters. ~12 u tall. */
export function buildDeepMine(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), violet = glow('#9b7bff', 2.4);
  g.add(mesh(cyl(4, 0.5, 8), dark, 0, 0.25, 0), mesh(cyl(1.4, 1.2, 8), hull2, 0, 1.0, 0), mesh(cyl(2, 0.35, 10), hull, 0, 1.75, 0));
  g.add(mesh(cyl(1.5, 0.2, 10), violet, 0, 0.55, 0), mesh(cyl(0.3, 9, 6), dark, 0, 5.8, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(strut({ x: sx * 2.6, y: 0.5, z: sz * 2.6 }, { x: sx * 0.65, y: 11, z: sz * 0.65 }, 0.13, hull));
  for (const y of [3, 6, 9]) {
    const f = 1 - ((y - 0.5) / 10.5) * 0.75;
    const ring = mesh(new THREE.TorusGeometry(2.6 * f * Math.SQRT2, 0.06, 3, 4), hull2, 0, y, 0);
    ring.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    g.add(ring);
  }
  g.add(mesh(box(1.8, 0.6, 1.8), dark, 0, 11.2, 0), mesh(new THREE.OctahedronGeometry(0.18), glow('#ff6a4d', 3), 0, 11.65, 0));
  g.add(mesh(box(2.8, 2.2, 2.2), hull2, 2.6, 1.6, 2.8), mesh(box(1.4, 0.2, 0.1), glow('#ffb547', 2.6), 2.6, 2.1, 3.92));
  g.add(mesh(box(2.6, 0.25, 1), dark, -2.8, 0.7, -2.6));
  for (let k = 0; k < 4; k++) g.add(mesh(cyl(0.27, 1, 6), violet, -3.8 + k * 0.66, 1.35, -2.6));
  return g;
}

/** Fusion Cell: a torus reactor with field coils, a central column, two coolant towers; glow (`charge`). */
export function buildFusion(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), cyan = glow('#5ff3ff', 2.2);
  g.add(mesh(cyl(4.4, 0.6, 10), dark, 0, 0.3, 0));
  const torus = mesh(new THREE.TorusGeometry(2.6, 1.0, 6, 12), hull, 0, 1.8, 0);
  torus.rotation.x = Math.PI / 2;
  g.add(torus);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const coil = mesh(new THREE.TorusGeometry(1.15, 0.14, 3, 8), dark, Math.cos(a) * 2.6, 1.8, Math.sin(a) * 2.6);
    coil.rotation.y = -a;
    g.add(coil);
  }
  g.add(mesh(cyl(1, 2.8, 10), hull2, 0, 2.1, 0), mesh(cyl(1.3, 0.3, 10), dark, 0, 3.6, 0));
  for (const sx of [-1, 1]) g.add(mesh(cyl(0.9, 4.2, 8, 0.7), hull2, sx * 3.6, 2.4, -2.4));
  g.add(mesh(box(1.6, 1.4, 1.2), hull, 0, 1.0, 3.6));
  const ring = mesh(new THREE.TorusGeometry(2.62, 0.12, 3, 16), cyan, 0, 1.8, 0, 'charge');
  ring.rotation.x = Math.PI / 2;
  g.add(ring, mesh(cyl(1.05, 0.3, 10), cyan, 0, 3.3, 0, 'charge'));
  return g;
}

/** Wreck: a lander broken in two: the tilted flared aft, the nose on its side, a leg in the air. ~10 u. */
export function buildWreck(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), burnt = metal('#3a332e');
  const aft = new THREE.Group();
  aft.position.set(0, 0.6, -1.8);
  aft.rotation.set(-0.35, 0, -0.2);
  aft.add(mesh(cyl(2.6, 3.2, 8, 1.8), hull2), mesh(cyl(2.7, 0.35, 8), dark, 0, -1.5, 0), mesh(box(1.2, 1.4, 0.2), burnt, 1.9, 0, 0.6));
  g.add(aft);
  const nose = mesh(cyl(1.8, 3.6, 8, 0.5), hull, 0.6, 0.9, 3.2);
  nose.rotation.set(Math.PI / 2 + 0.25, 0, 0.15);
  g.add(nose, mesh(box(1.6, 1.4, 1.0), burnt, -0.4, 0.3, 0.9));
  g.add(strut({ x: -1.6, y: 0.4, z: -2.4 }, { x: -2.6, y: 3.4, z: -3.5 }, 0.14, dark, 5));
  for (const [x, z, r] of [[3.4, 1, 0.4], [-3, 2.6, 1.3], [2.6, -3.8, 2.2], [-3.6, -0.6, 3]]) {
    const p = mesh(box(1.2, 0.1, 0.8), burnt, x, 0.1, z);
    p.rotation.y = r;
    g.add(p);
  }
  return g;
}

/** Relic Cache: a stepped vault of pale stone with a violet seal band (`seal`, dark once opened). ~5 u. */
export function buildCache(): THREE.Group {
  const g = new THREE.Group();
  const stone = matte('#c9c0ae'), stone2 = matte('#9a9282');
  g.add(mesh(box(5, 0.5, 4.4), stone2, 0, 0.25, 0));
  for (let k = 0; k < 3; k++) {
    const s = 4.2 - k * 0.6;
    const c = mesh(box(s, 0.75, s * 0.85), k % 2 ? stone2 : stone, 0, 0.85 + k * 0.78, 0);
    c.rotation.y = (k % 2) * 0.08;
    g.add(c);
  }
  g.add(mesh(box(2.2, 0.4, 1.8), stone, 0, 3.2, 0), mesh(box(1, 1.4, 0.1), matte('#2c2836'), 0, 1.4, 1.8));
  const seal = new THREE.Group();
  seal.name = 'seal';
  seal.add(mesh(box(4.3, 0.12, 3.7), glow('#a58cff', 2.6), 0, 1.25, 0), mesh(box(0.9, 0.12, 0.12), glow('#a58cff', 2.6), 0, 2.0, 1.86));
  g.add(seal);
  return g;
}

/** Built-in model per building kind from the roster (RegionView's KIND_MODELS). */
export const ROSTER_BUILDINGS: Record<string, () => THREE.Group> = {
  sensor: buildSensor, habitat: buildHabitat, relay: buildRelay, lab: buildLab, deepmine: buildDeepMine, fusion: buildFusion,
};
