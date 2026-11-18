/**
 * Built-in models for the water buildings (v0.35): low-poly and flat-shaded like the
 * roster's. Their origin is where they meet the water (or the quay): piles reach down
 * below y = 0 into the sea. Front is +Z. Parts the game animates keep their names
 * (`charge` glows on a relay).
 */
import * as THREE from 'three';

const metal = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.45, flatShading: true });
const glow = (c: THREE.ColorRepresentation, i = 2.2) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: i, flatShading: true });
const HULL = '#b4bcc3', HULL2 = '#8f989f', DARK = '#363c44', PILE = '#4a4f55';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 8, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);

/** Piles from just under a deck at `top` down into the seabed, on a grid over w × d. */
function piles(g: THREE.Group, w: number, d: number, top: number, nx: number, nz: number, mat: THREE.Material) {
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = nx > 1 ? -w / 2 + (w * i) / (nx - 1) : 0, z = nz > 1 ? -d / 2 + (d * k) / (nz - 1) : 0;
    g.add(mesh(cyl(0.28, top + 6, 6), mat, x, top - (top + 6) / 2, z));
  }
}

/** Shipyard: a deck across the waterline, an open hangar over a slipway running down into the sea, a gantry crane. */
export function buildShipyard(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), pile = metal(PILE), cyan = glow('#5ff3ff', 2);
  g.add(mesh(box(14, 0.6, 13), dark, 0, 0.3, 0));
  piles(g, 13, 12, 0, 4, 4, pile);
  // the slipway: a ramp from the deck down under the water, toward the front
  const ramp = mesh(box(6, 0.3, 9), hull2, 0, -0.6, 6.2);
  ramp.rotation.x = 0.22;
  g.add(ramp);
  // hangar: two walls and an arched roof of ribs over the slip
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.5, 5, 10), hull, sx * 4, 3.1, -0.5));
    g.add(mesh(box(0.12, 0.3, 9.4), cyan, sx * 3.7, 4.6, -0.5));
  }
  for (let k = 0; k < 5; k++) {
    const rib = mesh(new THREE.TorusGeometry(4, 0.22, 4, 10, Math.PI), hull2, 0, 5.4, -5 + k * 2.2);
    g.add(rib);
  }
  g.add(mesh(box(8.4, 0.25, 10.4), hull, 0, 9.3, -0.5));
  // gantry crane at the back corner
  g.add(mesh(box(0.5, 9, 0.5), dark, 5.6, 4.8, -5.4), mesh(box(0.5, 0.5, 8), dark, 5.6, 9.3, -1.6));
  g.add(mesh(box(0.8, 0.8, 0.8), hull, 5.6, 8.6, 1.8), mesh(new THREE.OctahedronGeometry(0.2), glow('#ff6a4d', 3), 5.6, 9.8, -5.4));
  // a boat on the slip
  const boat = mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 6).scale(1, 1, 2.6), hull2, 0, 0.9, 1.2);
  g.add(boat, mesh(box(1.2, 0.7, 1.4), hull, 0, 1.6, 0.6));
  g.add(mesh(box(13.8, 0.1, 0.14), cyan, 0, 0.65, 6.45));
  return g;
}

/** Tidal Generator: a platform on piles over two turbines in ducts, a housing with a glowing band. */
export function buildTidal(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), pile = metal(PILE), cyan = glow('#5ff3ff', 2.2);
  g.add(mesh(box(8, 0.5, 6), dark, 0, 1.0, 0));
  piles(g, 7, 5, 0.8, 2, 2, pile);
  for (const sx of [-1, 1]) {
    // a duct half under the water with the turbine's hub in it
    const duct = mesh(new THREE.TorusGeometry(1.4, 0.32, 6, 12), hull2, sx * 2.1, -0.3, 0);
    duct.rotation.y = Math.PI / 2;
    g.add(duct, mesh(cyl(0.35, 1.6, 6), dark, sx * 2.1, -0.3, 0).rotateZ(Math.PI / 2));
    g.add(mesh(cyl(0.25, 1.4, 6), pile, sx * 2.1, 0.4, 0));
  }
  g.add(mesh(box(3.2, 2.2, 3.4), hull, 0, 2.35, 0), mesh(box(3.3, 0.3, 3.5), cyan, 0, 2.9, 0));
  g.add(mesh(cyl(0.6, 0.6, 8), hull2, 0, 3.75, 0), mesh(new THREE.OctahedronGeometry(0.16), glow('#ff6a4d', 3), 0, 4.3, 0));
  return g;
}

/** Pier: a long deck from the shore out over the water on piles, a light mast at the far end. */
export function buildPier(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal(HULL), hull2 = metal(HULL2), dark = metal(DARK), pile = metal(PILE);
  g.add(mesh(box(3, 0.4, 14), hull2, 0, 0.6, 2));
  piles(g, 2.6, 13, 0.4, 2, 6, pile);
  for (const sx of [-1, 1]) g.add(mesh(box(0.12, 0.8, 14), dark, sx * 1.45, 1.1, 2));
  g.add(mesh(box(4, 0.5, 4), dark, 0, 0.65, 9.5), mesh(cyl(0.18, 6, 6), hull, 0, 3.9, 9.5));
  g.add(mesh(cyl(0.5, 0.25, 8), glow('#5ff3ff', 2.2), 0, 6.2, 9.5, 'charge'), mesh(new THREE.OctahedronGeometry(0.2), glow('#ff6a4d', 3), 0, 7.2, 9.5));
  return g;
}

/** Sea Turret platform: a hexagonal deck on piles; the turret itself goes on top (region.ts). */
export function buildSeaPlatform(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal(DARK), pile = metal(PILE);
  g.add(mesh(cyl(3.4, 0.6, 6), dark, 0, 0.9, 0));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.add(mesh(cyl(0.3, 7, 6), pile, Math.cos(a) * 2.8, -2.6, Math.sin(a) * 2.8));
  }
  g.add(mesh(cyl(3.45, 0.12, 6), glow('#ffd27a', 1.4), 0, 1.25, 0));
  return g;
}
