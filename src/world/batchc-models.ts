/**
 * Built-in models for roster batch C (v0.37): the Shield Projector and the Seed Bank. Low-poly and
 * flat-shaded like the roster's; front is +Z. Animated parts keep their names: the projector's
 * `ring` turns while its dome is up, the Seed Bank's `ring` turns while it works, `charge` glows.
 */
import * as THREE from 'three';

const metal = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.45, flatShading: true });
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

/** Shield Projector: a hexagonal plinth, four buttress fins round a tall emitter column, a floating ring and a glowing core on top. */
export function buildShieldProjector(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), cyan = glow('#7fe8ff', 2.4);
  g.add(mesh(cyl(3.6, 0.8, 6, 3.9), dark, 0, 0.4, 0), mesh(cyl(3.0, 0.3, 6), hull2, 0, 0.95, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = mesh(box(0.5, 3.6, 1.8), hull, Math.cos(a) * 1.7, 2.6, Math.sin(a) * 1.7);
    fin.rotation.y = -a;
    fin.rotation.z = Math.cos(a) * 0.18;
    fin.rotation.x = -Math.sin(a) * 0.18;
    g.add(fin);
  }
  g.add(mesh(cyl(0.9, 5.2, 8, 1.1), hull2, 0, 3.4, 0), mesh(cyl(0.95, 0.3, 8), cyan, 0, 4.6, 0, 'charge'));
  const ring = new THREE.Group();
  ring.name = 'ring';
  ring.position.y = 6.4;
  const torus = mesh(new THREE.TorusGeometry(1.9, 0.16, 4, 24), cyan);
  torus.rotation.x = Math.PI / 2;
  ring.add(torus);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    ring.add(mesh(box(0.3, 0.3, 0.9), hull, Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9));
  }
  g.add(ring, mesh(new THREE.OctahedronGeometry(0.75), glow('#bff6ff', 3), 0, 6.4, 0, 'charge'));
  return g;
}

/** Seed Bank: a low vault half sunk in a planted berm, a glass seed dome on top, a ring of sprinkler masts. */
export function buildSeedBank(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), dark = metal(DARK);
  const soil = new THREE.MeshStandardMaterial({ color: '#4a5a32', roughness: 0.95, flatShading: true });
  const green = glow('#9cff7a', 1.6);
  g.add(mesh(cyl(4.2, 1.0, 10, 4.6), soil, 0, 0.5, 0), mesh(cyl(3.2, 1.4, 8), hull, 0, 1.4, 0));
  const dome = mesh(new THREE.SphereGeometry(2.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
    color: '#bfe8d0', roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55, flatShading: true,
  }), 0, 2.1, 0);
  g.add(dome);
  // seed racks glowing under the glass
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.add(mesh(box(0.35, 1.0, 0.35), green, Math.cos(a) * 1.2, 2.6, Math.sin(a) * 1.2, 'charge'));
  }
  g.add(mesh(cyl(0.3, 2.2, 6), dark, 0, 3.2, 0));
  const ring = new THREE.Group();
  ring.name = 'ring';
  ring.position.y = 4.5;
  for (let k = 0; k < 3; k++) {
    const arm = mesh(box(2.6, 0.12, 0.18), hull, 1.3, 0, 0);
    arm.rotation.y = (k / 3) * Math.PI * 2;
    const tip = new THREE.Group();
    tip.rotation.y = (k / 3) * Math.PI * 2;
    tip.add(mesh(new THREE.OctahedronGeometry(0.2), green, 2.6, 0, 0));
    ring.add(arm, tip);
  }
  g.add(ring);
  // sprinkler masts round the berm
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    g.add(mesh(box(0.16, 1.6, 0.16), dark, Math.cos(a) * 3.9, 1.6, Math.sin(a) * 3.9), mesh(box(0.3, 0.2, 0.3), green, Math.cos(a) * 3.9, 2.45, Math.sin(a) * 3.9));
  }
  return g;
}
