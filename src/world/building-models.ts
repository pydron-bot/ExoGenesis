/**
 * The built-in building models (procedural meshes): the Command Core, drones and every building kind, by kind or
 * role. Asset models (content/assets) replace them up close; these stay as the far LOD and the fallback.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addWear } from './wear';
import { buildAirpad, buildFlak } from './air-models';
import { buildMedBay, buildMemorial, buildSeedBank, buildShieldProjector } from './batchc-models';
import { buildPier, buildSeaPlatform, buildShipyard, buildTidal } from './sea-models';

import { ROSTER_BUILDINGS } from './roster-models';

export const CYAN = new THREE.Color('#5ff3ff');
export const AMBER = new THREE.Color('#ffb547');

export const metal = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.45, flatShading: true, ...extra });
export const glow = (c: THREE.ColorRepresentation, i = 2.2) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: i, flatShading: true });

/**
 * A wisp of steam or exhaust: an open cone, narrow end down at the source, that thins out as it rises.
 * Its alpha fades from `opacity` near the source to nothing at the wide top, so from the usual
 * high camera it reads as a haze over the stack rather than a solid beam of light.
 */
function steamCone(radius: number, height: number, color: string, opacity: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, height, 8, 4, true);
  const pos = geo.attributes.position;
  const rgba = new Float32Array(pos.count * 4);
  const c = new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    const t = 0.5 - pos.getY(i) / height; // 0 at the apex (the source, once flipped), 1 at the wide top
    const a = Math.min(1, t * 6) * (1 - t) ** 1.6;
    rgba.set([c.r, c.g, c.b, a], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.rotation.x = Math.PI;
  return m;
}


/**
 * The Command Core (v0.80.0 look): an octagonal hab on a plinth, with corner ribs, lit windows, radiator fins,
 * an orange band, a sensor deck with a dish and a lattice mast, two glow rings in dark housings, braced legs,
 * and six cryo pods in clamps. The drone bay (`hatch`, `lintel`), `ring`s, `beacon` and `pod`s keep their names
 * and places (the landing and the editor's preview drive them); the rest is merged into one mesh per material.
 */
export function buildCore(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal('#a7b0b8');
  const dark = metal('#3a4048');
  const trim = metal('#c9692a', { roughness: 0.6, metalness: 0.2 });
  const chrome = metal('#d4dade', { roughness: 0.3, metalness: 0.85 });
  // warm lit windows (a glow material: black base, amber light)
  const WINDOW = new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color('#ffd28a'), emissiveIntensity: 1.6, flatShading: true });
  addWear([hull, dark, trim]);
  const decor = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot?: THREE.Euler | THREE.Quaternion, scale = one) => {
    const qq = rot instanceof THREE.Quaternion ? rot : q.setFromEuler(rot ?? e.set(0, 0, 0));
    geo.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), qq, scale));
    if (!decor.has(mat)) decor.set(mat, []);
    decor.get(mat)!.push(geo);
  };
  const oct = Math.PI / 8;
  // plinth, its lip and a hazard band round the foot
  add(new THREE.CylinderGeometry(6.5, 7.5, 1.6, 8), dark, 0, 0.8, 0);
  add(new THREE.CylinderGeometry(6.75, 6.75, 0.25, 8), hull, 0, 1.68, 0);
  add(new THREE.CylinderGeometry(7.42, 7.52, 0.28, 8), trim, 0, 0.32, 0);
  // the hab: an octagon narrowing upward, a flat face toward -z for the drone hatch
  const body = new THREE.CylinderGeometry(4.2, 5.2, 7, 8);
  add(body, hull, 0, 5, 0, e.set(0, oct, 0));
  const rAt = (y: number) => 5.2 - (y - 1.5) / 7; // corner radius at height y
  const apoAt = (y: number) => rAt(y) * Math.cos(oct);
  for (let i = 0; i < 8; i++) {
    // corner ribs, leaning with the walls
    const t = (i / 8) * Math.PI * 2 + oct;
    const dir = new THREE.Vector3(-Math.sin(t), 7, -Math.cos(t)).normalize();
    add(new THREE.BoxGeometry(0.32, 7.15, 0.32), dark, Math.sin(t) * (rAt(5) + 0.06), 5, Math.cos(t) * (rAt(5) + 0.06), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  }
  const tilt = Math.atan2(1, 7);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2; // face centres; a = π is the drone bay
    if (Math.abs(a - Math.PI) < 0.1) continue;
    const face = (y: number, out = 0.04) => [Math.sin(a) * (apoAt(y) + out), y, Math.cos(a) * (apoAt(y) + out)] as const;
    const rot = () => new THREE.Euler(-tilt, a, 0, 'YXZ');
    // a row of lit windows between the rings
    for (const dx of [-0.65, 0.65]) {
      const [x, y, z] = face(5.2, 0.06);
      add(new THREE.BoxGeometry(0.75, 0.42, 0.08), WINDOW, x + Math.cos(a) * dx, y, z - Math.sin(a) * dx, rot());
    }
    // a service panel low down
    const [px, py, pz] = face(2.6, 0.05);
    add(new THREE.BoxGeometry(1.3, 0.9, 0.1), dark, px, py, pz, rot());
    // radiator fins on the two sides
    if (Math.abs(Math.sin(a)) > 0.99) {
      for (let k = 0; k < 4; k++) {
        const [fx, fy, fz] = face(5.2 + (k - 1.5) * 0.7, 0.75);
        add(new THREE.BoxGeometry(0.08, 0.5, 1.6), dark, fx, fy, fz, new THREE.Euler(0, a, 0));
      }
    }
  }
  // band and top collar
  add(new THREE.CylinderGeometry(rAt(8.05) + 0.06, rAt(7.75) + 0.06, 0.3, 8), trim, 0, 7.9, 0, e.set(0, oct, 0));
  add(new THREE.CylinderGeometry(4.4, 4.5, 0.4, 8), dark, 0, 8.6, 0, e.set(0, oct, 0));
  // glow rings sit in dark housings
  for (const y of [4, 6.4]) for (const dy of [-0.42, 0.42]) {
    add(new THREE.TorusGeometry(rAt(y + dy) * 0.96 + 0.1, 0.16, 6, 32), dark, 0, y + dy, 0, e.set(Math.PI / 2, 0, 0));
  }
  // sensor deck: a frustum cap, a deck, a dome, a dish, a lattice mast
  add(new THREE.CylinderGeometry(1.5, 4.2, 3.4, 8), hull, 0, 10.5, 0, e.set(0, oct, 0));
  add(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 8), dark, 0, 12.3, 0, e.set(0, oct, 0));
  add(new THREE.SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), chrome, 0, 12.45, 0);
  const dish = new THREE.SphereGeometry(1.1, 14, 6, 0, Math.PI * 2, 0, 0.85);
  add(dish, hull, 2.4, 11.5, 1.6, new THREE.Euler(-0.9, 0.6, 0.5));
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4), dark, 2.4, 11.5, 1.6, new THREE.Euler(-0.9, 0.6, 0.5));
  add(new THREE.CylinderGeometry(0.15, 0.15, 5, 5), dark, 0, 14.5, 0);
  for (const y of [14, 15.6]) add(new THREE.BoxGeometry(1.4 - (y - 14) * 0.4, 0.08, 0.08), dark, 0, y, 0);
  // braced legs with pistons, on footpads
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    // a strut from the footpad up into the hull, and a piston alongside it
    const strut = (r0: number, y0: number, r1: number, y1: number, geo: THREE.BufferGeometry, mat: THREE.Material, side = 0) => {
      const d = new THREE.Vector3(Math.cos(a) * (r1 - r0), y1 - y0, Math.sin(a) * (r1 - r0));
      const len = d.length();
      geo.scale(1, len, 1);
      const tx = -Math.sin(a) * side, tz = Math.cos(a) * side;
      add(geo, mat, Math.cos(a) * (r0 + r1) / 2 + tx, (y0 + y1) / 2, Math.sin(a) * (r0 + r1) / 2 + tz,
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    };
    strut(8.4, 0.3, 5.3, 4.6, new THREE.BoxGeometry(0.75, 1, 0.75), dark);
    for (const sd of [-0.62, 0.62]) strut(8.0, 0.4, 5.6, 3.4, new THREE.CylinderGeometry(0.13, 0.13, 1, 6), chrome, sd);
    add(new THREE.CylinderGeometry(1.2, 1.4, 0.4, 6), dark, Math.cos(a) * 8.4, 0.2, Math.sin(a) * 8.4);
    add(new THREE.CylinderGeometry(1.45, 1.5, 0.12, 6), trim, Math.cos(a) * 8.4, 0.03, Math.sin(a) * 8.4);
  }
  // cryo pods ringing the base, each held in two clamps
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (const s of [-0.75, 0.75]) {
      add(new THREE.TorusGeometry(0.78, 0.13, 6, 14), dark, Math.cos(a) * (5.6 + s), 2.4, Math.sin(a) * (5.6 + s), new THREE.Euler(0, Math.PI / 2 - a, 0));
    }
    add(new THREE.BoxGeometry(0.5, 0.9, 2.6), dark, Math.cos(a) * 5.6, 1.6, Math.sin(a) * 5.6, new THREE.Euler(0, Math.PI / 2 - a, 0));
  }
  for (const [mat, geos] of decor) {
    const merged = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)), false);
    for (const x of geos) x.dispose();
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.3, 6, 32), glow(CYAN, 2.2));
  ring.name = 'ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 4;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(rAt(6.4) * 0.96 + 0.1, 0.3, 6, 32), glow(CYAN, 2.2));
  ring2.name = 'ring';
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 6.4;
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), glow(AMBER, 4));
  tip.position.y = 17;
  tip.name = 'beacon';
  g.add(ring, ring2, tip);
  // drone hatch on the -z face: dark bay with a lit lintel, door hinged at the bottom (folds out into a ramp)
  const apo = (y: number) => (5.2 - (y - 1.5) / 7) * Math.cos(Math.PI / 8);
  const bay = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.85, 0.1), new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 1, flatShading: true }));
  bay.position.set(0, 2.62, -apo(2.62) - 0.02);
  bay.rotation.x = 0.142;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), glow(AMBER, 2.5));
  lintel.position.set(0, 3.42, -apo(3.42) - 0.08);
  lintel.name = 'lintel';
  // a frame round the bay
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.75, 2.3, 0.08), dark);
  frame.position.set(0, 2.62, -apo(2.62) + 0.01);
  frame.rotation.x = 0.142;
  const hatch = new THREE.Group();
  hatch.name = 'hatch';
  hatch.position.set(0, 1.68, -apo(1.68) - 0.1);
  hatch.rotation.x = 0.142;
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.45, 1.95, 0.16), metal('#b4bcc4'));
  door.position.set(0, 0.975, -0.08);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.05), glow(CYAN, 2));
  stripe.position.set(0, 1.45, -0.18);
  hatch.add(door, stripe);
  g.add(frame, bay, lintel, hatch);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 3, 8), glow('#7ff7ff', 1.0));
    pod.name = 'pod';
    pod.position.set(Math.cos(a) * 5.6, 2.4, Math.sin(a) * 5.6);
    pod.rotation.z = Math.PI / 2;
    pod.rotation.y = -a;
    g.add(pod);
  }
  return g;
}

export function buildDrone(): THREE.Group {
  const g = new THREE.Group();
  const shell = metal('#d7dde2');
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.0), shell);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.1), glow(CYAN, 3));
  visor.position.set(0, 0.05, 1.02);
  g.add(body, visor);
  for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9]]) {
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), glow(CYAN, 0.8));
    rotor.position.set(x, 0.25, z);
    g.add(rotor);
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.0), metal('#5d656d'));
  arm.position.set(0, -0.4, 0.8);
  g.add(arm);
  return g;
}

export function buildSolar(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), metal('#5d656d'));
  post.position.y = 1;
  g.add(post);
  const panelMat = new THREE.MeshStandardMaterial({ color: '#1a2f5c', roughness: 0.25, metalness: 0.7, emissive: '#0c2a55', emissiveIntensity: 0.6, flatShading: true });
  for (const x of [-2.1, 2.1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 3.2), panelMat);
    panel.position.set(x, 2.2, 0);
    panel.rotation.x = -0.35;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.1), glow(CYAN, 1.5));
    edge.position.set(x, 2.2 + Math.sin(0.35) * 1.6, -Math.cos(0.35) * 1.6);
    edge.rotation.x = -0.35;
    g.add(panel, edge);
  }
  return g;
}

export function buildScaffold(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(8.4, 3, 3.6)),
    new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, fog: false }),
  );
  frame.position.y = 1.5;
  frame.name = 'frame';
  const fill = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3, 3.6), new THREE.MeshBasicMaterial({
    color: AMBER, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  fill.position.y = 1.5;
  fill.name = 'fill';
  g.add(frame, fill);
  return g;
}

export function buildDepot(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#4a4f55'), hull = metal('#a3927a');
  const slab = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 6), dark);
  slab.position.y = 0.3;
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.1, 3.2, 6), hull);
  hopper.position.set(-1.6, 2.2, 0.6);
  const shed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3.4), hull);
  shed.position.set(1.7, 1.9, -0.6);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.5, 0.4), dark);
  mast.position.set(1.7, 4.5, -0.6);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 5), dark);
  boom.position.set(1.7, 6.6, 1.4);
  const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), glow(AMBER, 3));
  lamp.position.set(1.7, 7.0, -0.6);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.15, 0.1), glow(AMBER, 2));
  strip.position.set(1.7, 2.6, 1.15);
  g.add(slab, hopper, shed, mast, boom, lamp, strip);
  return g;
}

export function buildBattery(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), shell = metal('#c7ced4');
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 3.6), dark);
  base.position.y = 0.25;
  g.add(base);
  for (const x of [-1.5, 0, 1.5]) {
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 10), shell);
    cell.position.set(x, 1.8, 0);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.3, 10), glow(CYAN, 2));
    band.position.set(x, 2.2, 0);
    band.name = 'charge';
    g.add(cell, band);
  }
  return g;
}

export function buildTurret(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#9aa4ad');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.2, 8), dark);
  base.position.y = 0.6;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.6, 8), hull);
  neck.position.y = 2;
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 3.1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 2.4), hull);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.1), glow('#ff6a4d', 3));
  eye.position.set(0, 0.2, 1.22);
  eye.name = 'eye';
  head.add(body, eye);
  for (const x of [-0.5, 0.5]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 6), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, -0.1, 2.2);
    head.add(barrel);
  }
  g.add(base, neck, head);
  return g;
}

export function buildRadar(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#c7ced4');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), dark);
    leg.position.set(Math.cos(a) * 1.4, 3, Math.sin(a) * 1.4);
    leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
    g.add(leg);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.8, 8), dark);
  hub.position.y = 6.2;
  const dish = new THREE.Group();
  dish.name = 'dish';
  dish.position.y = 7;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, 0.9), hull);
  bowl.rotation.x = -Math.PI / 2 - 0.5;
  bowl.material = metal('#c7ced4', { side: THREE.DoubleSide });
  const feed = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), glow(CYAN, 3));
  feed.position.set(0, 0.6, 1.6);
  dish.add(bowl, feed);
  g.add(hub, dish);
  return g;
}

/** Vehicle Bay: a hangar whose door faces −Z, where finished units roll out. */
export function buildBay(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#aab3bb');
  const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 9), dark);
  slab.position.y = 0.25;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 8, 14, 1, false, -Math.PI / 2, Math.PI), hull);
  roof.rotation.x = -Math.PI / 2; // half-pipe arching up, running front to back
  roof.position.y = 0.5;
  const back = new THREE.Mesh(new THREE.CircleGeometry(3.6, 14, 0, Math.PI), hull);
  back.position.set(0, 0.5, 4);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.8), glow('#ffb547', 1.6));
  door.position.set(0, 1.9, -4.02);
  door.rotation.y = Math.PI;
  door.name = 'door';
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.35, 0.4), dark);
  frame.position.set(0, 3.45, -4.05);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 2.4), dark);
  ramp.position.set(0, 0.3, -5.2);
  ramp.rotation.x = -0.12;
  for (const x of [-4.4, 4.4]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 6), dark);
    vent.position.set(x, 1.2, 0);
    g.add(vent);
  }
  g.add(slab, roof, back, door, frame, ramp);
  return g;
}

/** Wall segment: runs along local Z, one clearance (4 u) long, with a post at one end. */
export function buildWall(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#8f989f');
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 4.1), hull);
  slab.position.y = 1.1;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 4.1), dark);
  cap.position.y = 2.35;
  const post = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.9, 0.7), dark);
  post.position.set(0, 1.45, 2);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 3.4), glow('#5ff3ff', 1.2));
  strip.position.y = 1.7;
  g.add(slab, cap, post, strip);
  return g;
}

/** Siege Cannon: a heavy armoured base with one long barrel on a turning head. */
export function buildCannon(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#33383f'), hull = metal('#8c959d');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 1.4, 8), dark);
  base.position.y = 0.7;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.9, 10), hull);
  ring.position.y = 1.85;
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 3;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 3.2), hull);
  body.position.z = -0.3;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 5.2, 8), dark);
  barrel.rotation.x = Math.PI / 2 - 0.22;
  barrel.position.set(0, 0.6, 2.6);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 8), dark);
  brake.rotation.x = Math.PI / 2 - 0.22;
  brake.position.set(0, 1.18, 5.1);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.1), glow('#ff9a3d', 3));
  eye.position.set(0, 0.35, 1.32);
  eye.name = 'eye';
  head.add(body, barrel, brake, eye);
  g.add(base, ring, head);
  return g;
}

/** Point Defense: a low mount with a fast-turning twin gun pod. */
export function buildPointDefense(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#b4bcc3');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 1, 6), dark);
  base.position.y = 0.5;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.4, 6), hull);
  post.position.y = 1.7;
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 2.6;
  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), hull);
  pod.scale.set(1, 0.8, 1.1);
  head.add(pod);
  for (const x of [-0.35, 0.35]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 5), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, 0, 1.4);
    head.add(barrel);
  }
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.1), glow('#fff07a', 3));
  eye.position.set(0, 0.35, 0.92);
  eye.name = 'eye';
  head.add(eye);
  g.add(base, post, head);
  return g;
}

/** Repair Pad: a flat landing pad with corner masts and a slow-turning glow ring. */
export function buildRepairPad(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#9aa4ad');
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.4, 8), dark);
  pad.position.y = 0.2;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.12, 8), hull);
  deck.position.y = 0.46;
  g.add(pad, deck);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), dark);
    mast.position.set(Math.cos(a) * 4.1, 1.6, Math.sin(a) * 4.1);
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), glow('#5bff9a', 2.5));
    lamp.position.set(Math.cos(a) * 4.1, 3.35, Math.sin(a) * 4.1);
    g.add(mast, lamp);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.12, 4, 24), glow('#5bff9a', 1.6));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.62;
  ring.name = 'ring';
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.5), glow('#5bff9a', 1.2));
  cross.position.y = 0.55;
  const cross2 = cross.clone();
  cross2.rotation.y = Math.PI / 2;
  g.add(ring, cross, cross2);
  return g;
}

/** Gate: two heavy posts and a lit bar between them, running along local Z (Clearance long). */
export function buildGate(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#8f989f');
  for (const z of [-3.6, 3.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(2, 3.4, 1.2), dark);
    post.position.set(0, 1.7, z);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), glow(AMBER, 2.5));
    cap.position.set(0, 3.7, z);
    g.add(post, cap);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 6.2), hull);
  bar.position.y = 2.9;
  const field = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.4), new THREE.MeshStandardMaterial({
    color: '#000000', emissive: AMBER, emissiveIntensity: 0.9, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
  }));
  field.rotation.y = Math.PI / 2;
  field.position.y = 1.4;
  field.name = 'field';
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 6.2), dark);
  sill.position.y = 0.08;
  g.add(bar, field, sill);
  return g;
}

/** Geothermal Tap: a squat wellhead over the vent, pipes and a steam plume. */
export function buildGeothermal(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#a3927a');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.8, 8), dark);
  base.position.y = 0.4;
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 3, 8), hull);
  well.position.y = 2.3;
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3, 8), dark);
  stack.position.set(0, 5.2, 0);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.3, 8), glow('#ff7a3d', 2.4));
  band.position.y = 2.9;
  g.add(base, well, stack, band);
  for (const a of [0.4, 2.5, 4.4]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.6, 6), dark);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(Math.cos(a) * 2.4, 1.2, Math.sin(a) * 2.4);
    pipe.rotation.y = -a;
    g.add(pipe);
  }
  const plume = steamCone(1.4, 5, '#dfe8ee', 0.2);
  plume.position.y = 9.2;
  plume.name = 'plume';
  g.add(plume);
  return g;
}

/** Matter Printer: a squat drum on a hex plinth, a glowing print bed and a gantry ring turning over it. */
export function buildPrinter(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#353b44'), hull = metal('#8f9aa3');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.9, 6), dark);
  base.position.y = 0.45;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 2.6, 12), hull);
  drum.position.y = 2.2;
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 12), glow('#7cf0c8', 2.6));
  bed.position.y = 3.6;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), glow('#c8fff0', 3));
  core.position.y = 4.8;
  g.add(base, drum, bed, core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.18, 6, 24), dark);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 5.6;
  for (const a of [0, 2.09, 4.19]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.35), dark);
    post.position.set(Math.cos(a) * 2.7, 4.4, Math.sin(a) * 2.7);
    g.add(post);
  }
  g.add(ring);
  for (const a of [0.5, 2.6, 4.7]) {
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 8), metal('#b07a3a'));
    coil.position.set(Math.cos(a) * 3.6, 1.4, Math.sin(a) * 3.6);
    g.add(coil);
  }
  return g;
}

/** Geothermal vent: a scorched patch with glowing cracks, a rim of rocks and a column of steam. */
export function buildVent(seed: number): THREE.Group {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: '#3d332d', roughness: 0.95, flatShading: true });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(4.6, 10), new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 1, flatShading: true }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.08;
  g.add(scorch);
  const hot = glow('#ff6a2a', 3.2);
  let r = seed * 7919 + 13;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5, d = 3.4 + rnd() * 1.4;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + rnd() * 0.8, 0), rock);
    stone.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
    stone.scale.y = 0.6;
    g.add(stone);
  }
  for (const [x, z, l, yaw, w] of [[0, 0, 6, 0.3, 0.6], [1.2, 1.4, 3.2, 1.5, 0.4], [-1.4, -1.1, 2.8, -0.9, 0.4], [-0.6, 1.6, 2, 2.4, 0.3]]) {
    const crack = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, l), hot);
    crack.position.set(x, 0.14, z);
    crack.rotation.y = yaw;
    g.add(crack);
  }
  const steam = steamCone(1.6, 8, '#e8eff4', 0.18);
  steam.position.y = 4.2;
  steam.name = 'steam';
  g.add(steam);
  return g;
}

/** Isotope seam: a ring of tall violet-cyan crystals round a glowing crack in the rock. */
export function buildSeam(seed: number): THREE.Group {
  const g = new THREE.Group();
  const crystal = new THREE.MeshStandardMaterial({ color: '#8f7bff', roughness: 0.2, metalness: 0.3, emissive: '#5a3cff', emissiveIntensity: 1.1, flatShading: true });
  const pale = new THREE.MeshStandardMaterial({ color: '#bff6ff', roughness: 0.15, metalness: 0.2, emissive: '#3fd8ff', emissiveIntensity: 0.9, flatShading: true });
  const rock = new THREE.MeshStandardMaterial({ color: '#2e2a34', roughness: 0.95, flatShading: true });
  let r = seed * 7121 + 19;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const base = new THREE.Mesh(new THREE.CircleGeometry(4.2, 9), rock);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.06;
  const crack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 5), glow('#7a5cff', 2.6));
  crack.position.y = 0.1;
  crack.rotation.y = rnd() * 3;
  g.add(base, crack);
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2, d = 0.6 + rnd() * 3.0, h = 1.4 + rnd() * 3.8;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 + rnd() * 0.35, 0), i % 3 ? crystal : pale);
    c.scale.set(1, h, 1);
    c.position.set(Math.cos(a) * d, h * 0.45, Math.sin(a) * d);
    c.rotation.set((rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.7);
    g.add(c);
  }
  return g;
}

/** Alloy deposit: a cluster of metallic crystals. */
export function buildDeposit(seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#c98b3c', roughness: 0.35, metalness: 0.8, emissive: '#5a2e08', emissiveIntensity: 0.5, flatShading: true });
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 3.6;
    const h = 1.2 + rnd() * 2.6;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.5 + rnd() * 0.6, h, 5), mat);
    c.position.set(Math.cos(a) * d, h / 2 - 0.2, Math.sin(a) * d);
    c.rotation.set((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6);
    g.add(c);
  }
  return g;
}

/** Civilian Center: a domed habitat with two growth pods (named 'gpod', lit while running) and a lit window band. */
export function buildCivic(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal('#c9cfd4'), dark = metal('#454b52');
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 0.8, 10), dark);
  plinth.position.y = 0.4;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.6, 2.6, 10), hull);
  wall.position.y = 2.1;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hull);
  dome.position.y = 3.4;
  dome.scale.y = 0.62;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(5.62, 5.62, 0.35, 10, 1, true), glow('#ffe2a8', 1.6));
  band.position.y = 2.5;
  band.name = 'windows';
  const skylight = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 8), glow('#ffe2a8', 1.2));
  skylight.position.y = 6.75;
  g.add(plinth, wall, dome, band, skylight);
  // growth pods: glass capsules on the south side, cyan while a child grows inside
  for (const x of [-1.9, 1.9]) {
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), dark);
    cradle.position.set(x, 0.8, -6.1);
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.5, 3, 10), glow('#7ff7ff', 0.25));
    pod.position.set(x, 2.2, -6.1);
    pod.name = 'gpod';
    g.add(cradle, pod);
  }
  return g;
}

/** Hydroponics: three greenhouse tunnels, green-lit inside. */
export function buildFarm(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#4a4f55');
  const slab = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.4, 7.4), dark);
  slab.position.y = 0.2;
  g.add(slab);
  const glass = new THREE.MeshStandardMaterial({ color: '#bfefff', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35, flatShading: true });
  for (const x of [-2.7, 0, 2.7]) {
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 6.6, 10, 1, false, 0, Math.PI), glass);
    tunnel.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    tunnel.position.set(x, 0.4, 0);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 6.2), glow('#5bff7a', 0.9));
    bed.position.set(x, 0.7, 0);
    bed.name = 'crop';
    g.add(tunnel, bed);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 8), metal('#8fa0a8'));
  tank.position.set(3.6, 1.6, -3.2);
  g.add(tank);
  return g;
}

/** Launch Gantry: a lattice tower beside a shuttle standing on its pad, arms reaching across (campaign travel). */
export function buildLaunchGantry(): THREE.Group {
  const g = new THREE.Group();
  const dark = metal('#3a4048'), hull = metal('#d6dbe0'), rust = metal('#b8743a');
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 0.6, 12), dark);
  pad.position.y = 0.3;
  const flame = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 10), glow('#ffb547', 0.8));
  flame.position.set(1.4, 0.64, 0);
  g.add(pad, flame);
  // the tower: four posts and cross bracing, a lattice
  const H = 17, W = 2.2, tx = -3.4;
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, H, 0.28), rust);
    post.position.set(tx + (px * W) / 2, H / 2 + 0.6, (pz * W) / 2);
    g.add(post);
  }
  const brace = new THREE.BoxGeometry(0.14, Math.hypot(W, 2.4), 0.14);
  for (let i = 0; i < 7; i++) {
    const y = 0.6 + 1.2 + i * 2.4, tilt = Math.atan2(W, 2.4) * (i % 2 ? 1 : -1);
    for (const side of [-1, 1]) {
      const a = new THREE.Mesh(brace, rust);
      a.position.set(tx + (side * W) / 2, y, 0);
      a.rotation.x = tilt;
      const b = new THREE.Mesh(brace, rust);
      b.position.set(tx, y, (side * W) / 2);
      b.rotation.z = tilt;
      g.add(a, b);
    }
    const ring = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.16, W + 0.3), dark);
    ring.position.set(tx, y + 1.2, 0);
    g.add(ring);
  }
  // service arms across to the shuttle
  for (const y of [7, 12.5]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.7), dark);
    arm.position.set(tx + 2.6, y, 0);
    g.add(arm);
  }
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), glow('#ff5a4a', 3));
  beacon.position.set(tx, H + 1, 0);
  g.add(beacon);
  // the shuttle, nose up
  const ship = new THREE.Group();
  ship.name = 'shuttle';
  ship.position.set(1.4, 0.6, 0);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 9, 12), hull);
  body.position.y = 5.2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3, 12), hull);
  nose.position.y = 11.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.5, 12), glow(CYAN, 1.4));
  band.position.y = 8.6;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 0.9, 10), dark);
  bell.position.y = 0.45;
  ship.add(body, nose, band, bell);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 1.6), hull);
    fin.position.set(Math.cos(a) * 1.45, 1.9, Math.sin(a) * 1.45);
    fin.rotation.y = -a;
    ship.add(fin);
  }
  g.add(ship);
  return g;
}

/** Built-in models for particular building kinds (variants that share a role but not a look). */
const KIND_MODELS: Record<string, () => THREE.Group> = {
  cannon: buildCannon, pointdefense: buildPointDefense, ...ROSTER_BUILDINGS,
  shipyard: buildShipyard, tidal: buildTidal, pier: buildPier, seaturret: buildSeaTurret,
  airpad: buildAirpad, flak: buildFlak,
  shield: buildShieldProjector, seedbank: buildSeedBank, medbay: buildMedBay, memorial: buildMemorial,
};

/** Sea Turret: the Defense Turret on a platform over the water (its `head` still aims). */
export function buildSeaTurret(): THREE.Group {
  const g = buildSeaPlatform();
  const t = buildTurret();
  t.position.y = 1.2;
  g.add(t);
  return g;
}


/** Built-in model for a building kind: its own if it has one, else its role's. */
export function buildForKind(kind: string, role: string): THREE.Group {
  return KIND_MODELS[kind]?.() ?? buildForRole(role);
}

/** Built-in model for a building kind's role. */
export function buildForRole(role: string): THREE.Group {
  switch (role) {
    case 'core': return buildCore();
    case 'printer': return buildPrinter();
    case 'gate': return buildGate();
    case 'repair': return buildRepairPad();
    case 'geothermal': return buildGeothermal();
    case 'solar': return buildSolar();
    case 'depot': return buildDepot();
    case 'battery': return buildBattery();
    case 'turret': return buildTurret();
    case 'radar': return buildRadar();
    case 'factory': return buildBay();
    case 'wall': return buildWall();
    case 'civic': return buildCivic();
    case 'farm': return buildFarm();
    case 'launch': return buildLaunchGantry();
    default: return buildSolar();
  }
}
