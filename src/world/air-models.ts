/**
 * Built-in models for the air buildings (v0.36): low-poly and flat-shaded like the roster's.
 * Front is +Z (the Airpad's door side is −Z, where its flyers lift off). Parts the game animates
 * keep their names: the Flak Tower's `head` aims, its `eye` glows.
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

/** Airpad: a raised octagonal landing pad with a glowing ring and edge lamps, a low hangar behind it, a control mast. */
export function buildAirpad(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), amber = glow('#ffc46a', 2.2);
  // the pad, toward the door side (−Z)
  g.add(mesh(cyl(4.6, 0.6, 8), dark, 0, 0.3, -1.4), mesh(cyl(4.2, 0.1, 8), hull2, 0, 0.65, -1.4));
  const ring = mesh(new THREE.TorusGeometry(2.6, 0.12, 4, 24), amber, 0, 0.72, -1.4);
  ring.rotation.x = Math.PI / 2;
  g.add(ring, mesh(box(0.3, 0.06, 2.4), amber, -0.7, 0.72, -1.4), mesh(box(0.3, 0.06, 2.4), amber, 0.7, 0.72, -1.4), mesh(box(1.7, 0.06, 0.3), amber, 0, 0.72, -1.4));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    g.add(mesh(new THREE.OctahedronGeometry(0.18), glow('#5ff3ff', 2.4), Math.cos(a) * 4.35, 0.8, -1.4 + Math.sin(a) * 4.35));
  }
  // hangar at the back (+Z): a half-barrel roof over a box
  g.add(mesh(box(7, 2.6, 3.6), hull, 0, 1.3, 4.4));
  const roof = mesh(cyl(1.8, 7, 10), hull2, 0, 2.6, 4.4);
  roof.rotation.z = Math.PI / 2;
  g.add(roof, mesh(box(5, 0.12, 0.12), glow('#5ff3ff', 2), 0, 2.2, 2.58));
  // control mast with a lit cab and a beacon
  g.add(mesh(box(0.5, 6, 0.5), dark, 4.6, 3, 3.6), mesh(box(1.5, 1, 1.5), hull, 4.6, 6.2, 3.6), mesh(box(1.55, 0.3, 1.55), glow('#bfefff', 1.6), 4.6, 6.3, 3.6));
  g.add(mesh(new THREE.OctahedronGeometry(0.22), glow('#ff6a4d', 3), 4.6, 7.0, 3.6));
  return g;
}

/** Flak Tower: a tall lattice-legged tower with a quad-barrelled mount on top, barrels raised to the sky. */
export function buildFlak(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), dark = metal(DARK);
  g.add(mesh(cyl(2.4, 0.8, 6, 2.8), dark, 0, 0.4, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = mesh(box(0.3, 4.2, 0.3), dark, Math.cos(a) * 1.1, 2.7, Math.sin(a) * 1.1);
    leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
    g.add(leg);
  }
  g.add(mesh(cyl(1.3, 0.5, 8), hull, 0, 4.9, 0));
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 5.6;
  head.add(mesh(box(1.8, 0.9, 1.6), hull));
  for (const x of [-0.55, -0.25, 0.25, 0.55]) {
    const barrel = mesh(cyl(0.09, 2.2, 5), dark, x, 0.75, 0.85);
    barrel.rotation.x = Math.PI / 2 - 0.75; // raised: it shoots up
    head.add(barrel);
  }
  head.add(mesh(box(1.2, 0.14, 0.1), glow('#ff9a4d', 3), 0, 0.2, 0.82, 'eye'));
  g.add(head);
  return g;
}
