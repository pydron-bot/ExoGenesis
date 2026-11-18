/**
 * Procedural skirmish unit meshes (also shown in the editor's asset browser,
 * so this module must not import game content).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { p.deleteAttribute('uv'); return p; }))!;
  g.computeVertexNormals();
  return g;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r: number, h: number, x: number, y: number, z: number) =>
  new THREE.CylinderGeometry(r, r, h, 8).rotateZ(Math.PI / 2).translate(x, y, z);

export function roverGeo() {
  return merge([
    box(1.3, 0.5, 2.0, 0, 0.75, 0), box(1.0, 0.45, 0.9, 0, 1.2, -0.2),
    cyl(0.32, 0.25, -0.75, 0.35, 0.65), cyl(0.32, 0.25, 0.75, 0.35, 0.65),
    cyl(0.32, 0.25, -0.75, 0.35, -0.65), cyl(0.32, 0.25, 0.75, 0.35, -0.65),
    box(0.12, 0.12, 0.9, 0, 1.5, 0.35),
  ]);
}
export function roverGlow() { return merge([box(1.05, 0.1, 0.1, 0, 1.25, 0.27), box(0.1, 0.1, 0.1, 0, 1.5, 0.82)]); }
export function tankGeo() {
  return merge([
    box(2.0, 0.7, 2.8, 0, 0.75, 0), box(0.5, 0.6, 3.0, -1.1, 0.5, 0), box(0.5, 0.6, 3.0, 1.1, 0.5, 0),
    box(1.2, 0.55, 1.3, 0, 1.38, -0.15),
    new THREE.CylinderGeometry(0.14, 0.14, 1.8, 6).rotateX(Math.PI / 2).translate(0, 1.42, 1.3),
  ]);
}
/** Lancer (far-off look): a long low tracked hull, capacitor drums behind, the rail lance far past the nose. */
export function lancerGeo() {
  return merge([
    box(1.6, 0.6, 3.0, 0, 0.85, -0.1), box(0.5, 0.62, 3.2, -1.05, 0.42, 0), box(0.5, 0.62, 3.2, 1.05, 0.42, 0),
    new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8).rotateX(Math.PI / 2).translate(-0.45, 1.35, -1.05),
    new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8).rotateX(Math.PI / 2).translate(0.45, 1.35, -1.05),
    box(0.8, 0.5, 1.0, 0, 1.45, 0.1), box(0.44, 0.3, 3.6, 0, 1.5, 1.9), box(0.5, 0.42, 0.25, 0, 1.5, 3.6),
  ]);
}
export function lancerGlow() { return merge([box(0.1, 0.1, 2.6, 0, 1.68, 1.9), box(1.7, 0.08, 0.08, 0, 1.1, -1.62)]); }
export function tankGlow() { return merge([box(1.25, 0.08, 0.1, 0, 1.4, 0.52), box(2.05, 0.08, 0.08, 0, 1.12, -1.38)]); }
export function creatureGeo(spiky: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.IcosahedronGeometry(0.7, 0);
  body.scale(0.85, 0.6, 1.4).translate(0, 1.0, 0);
  parts.push(body, new THREE.ConeGeometry(0.35, 0.9, 5).rotateX(Math.PI / 2).translate(0, 1.1, 1.2));
  for (const z of [-0.6, 0, 0.6]) for (const x of [-0.45, 0.45]) parts.push(new THREE.CylinderGeometry(0.07, 0.04, 0.9, 4).translate(x, 0.45, z));
  if (spiky) for (const z of [-0.5, 0, 0.5]) parts.push(new THREE.ConeGeometry(0.16, 0.7, 4).translate(0, 1.55, z));
  return merge(parts);
}

/** Body materials per builtin unit, in roster order. */
export const unitMaterials = () => [
  accordMaterial(), accordMaterial(0.5),
  faunaMaterial('#c0563a', '#5a1408'), faunaMaterial('#8a3550', '#3a0a1c'),
];

/** Player vehicles are white (tinted red as they take damage); fauna carry their own colour. */
export function accordMaterial(metalness = 0.4) {
  return new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness, flatShading: true });
}
export function faunaMaterial(color: string, emissive: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, emissive, emissiveIntensity: 0.6 });
}

// ---------- the M1 additions ----------
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);

/** Artillery: tracked, with a long barrel raised high. */
export function artilleryGeo() {
  const barrel = new THREE.CylinderGeometry(0.16, 0.2, 3.4, 6).rotateX(Math.PI / 2 - 0.55).translate(0, 2.2, 0.9);
  return merge([
    box(1.8, 0.6, 2.6, 0, 0.7, 0), box(0.45, 0.55, 2.8, -1.0, 0.45, 0), box(0.45, 0.55, 2.8, 1.0, 0.45, 0),
    box(1.3, 0.8, 1.2, 0, 1.4, -0.4), box(0.5, 0.5, 0.9, 0, 1.5, 0.4), barrel,
    box(0.2, 0.9, 0.2, -0.75, 0.6, -1.45), box(0.2, 0.9, 0.2, 0.75, 0.6, -1.45), // stabiliser legs
  ]);
}
export function artilleryGlow() { return merge([box(1.35, 0.08, 0.1, 0, 1.6, 0.2), box(0.1, 0.1, 0.1, 0, 3.15, 2.35)]); }

/** Arc caster: six-wheeled, a coil mast with an emitter ball. */
export function arcGeo() {
  const parts: THREE.BufferGeometry[] = [box(1.4, 0.55, 2.2, 0, 0.75, 0), box(1.0, 0.4, 1.0, 0, 1.2, -0.4)];
  for (const z of [-0.8, 0, 0.8]) parts.push(cyl(0.3, 0.25, -0.8, 0.35, z), cyl(0.3, 0.25, 0.8, 0.35, z));
  parts.push(new THREE.CylinderGeometry(0.18, 0.28, 1.4, 6).translate(0, 1.7, 0.45));
  for (const y of [1.3, 1.65, 2.0]) parts.push(new THREE.TorusGeometry(0.36, 0.08, 4, 8).rotateX(Math.PI / 2).translate(0, y, 0.45));
  return merge(parts);
}
export function arcGlow() { return merge([ico(0.42).translate(0, 2.55, 0.45), box(1.05, 0.08, 0.1, 0, 1.25, 0.12)]); }

/** Field engineer: a boxy van with a crane arm and a repair head. */
export function engineerGeo() {
  const parts: THREE.BufferGeometry[] = [box(1.4, 0.9, 2.2, 0, 1.0, -0.1), box(1.3, 0.6, 0.8, 0, 0.85, 1.25)];
  for (const z of [-0.75, 0.85]) parts.push(cyl(0.34, 0.25, -0.78, 0.36, z), cyl(0.34, 0.25, 0.78, 0.36, z));
  parts.push(box(0.25, 0.25, 1.8, 0.35, 1.75, 0.2).rotateX(-0.35), box(0.4, 0.4, 0.4, 0.35, 1.95, 1.0));
  return merge(parts);
}
export function engineerGlow() { return merge([box(0.5, 0.12, 0.12, 0.35, 2.2, 1.0), box(1.42, 0.1, 0.1, 0, 1.35, -1.22), box(0.1, 0.4, 0.4, -0.71, 1.05, 0)]); }

/** Scout skimmer: a flat hovering wedge (it floats; no wheels). */
export function scoutGeo() {
  const wedge = new THREE.ConeGeometry(1.0, 2.4, 3).rotateX(Math.PI / 2).scale(1, 0.35, 1).translate(0, 1.0, 0.1);
  return merge([wedge, box(0.5, 0.3, 0.8, 0, 1.25, -0.4), box(1.8, 0.08, 0.5, 0, 0.95, -0.7), box(0.08, 0.5, 0.4, 0, 1.4, -0.85)]);
}
export function scoutGlow() { return merge([box(1.4, 0.06, 0.1, 0, 0.75, -0.6), box(0.3, 0.1, 0.3, 0, 1.42, -0.2)]); }

/** Hover skiff: a broad flat hull on an air skirt, a twin gun on top and fans at the back (it floats; no wheels). */
export function skiffGeo() {
  const hull = new THREE.CylinderGeometry(1.0, 1.15, 0.45, 8).scale(1, 1, 1.5).translate(0, 0.75, 0);
  const skirt = new THREE.CylinderGeometry(1.2, 1.25, 0.25, 8).scale(1, 1, 1.5).translate(0, 0.42, 0);
  const prow = new THREE.ConeGeometry(0.75, 1.1, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.45, 1).translate(0, 0.8, 1.95);
  const fanL = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateX(Math.PI / 2).translate(-0.55, 1.15, -1.55);
  const fanR = fanL.clone().translate(1.1, 0, 0);
  return merge([
    hull, skirt, prow, fanL, fanR, box(0.8, 0.4, 0.9, 0, 1.18, 0.1),
    new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5).rotateX(Math.PI / 2).translate(-0.18, 1.3, 0.95),
    new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5).rotateX(Math.PI / 2).translate(0.18, 1.3, 0.95),
  ]);
}
export function skiffGlow() { return merge([box(1.9, 0.06, 0.08, 0, 0.58, 0.9), box(0.82, 0.08, 0.08, 0, 1.25, 0.56), box(1.6, 0.06, 0.06, 0, 1.15, -1.75)]); }

/** Strider: a wader on four long jointed legs, a small body slung high, a long probing snout. */
export function striderGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const body = ico(0.6); body.scale(0.8, 0.55, 1.3).translate(0, 2.3, 0);
  const snout = cone(0.22, 1.3, 5).rotateX(Math.PI / 2 + 0.35).translate(0, 2.05, 1.25);
  parts.push(body, snout);
  for (const z of [-0.55, 0.55]) for (const x of [-1, 1]) {
    // upper leg out and up to a knee, lower leg down to the ground
    parts.push(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 4).rotateZ(x * 0.9).translate(x * 0.75, 2.6, z));
    parts.push(new THREE.CylinderGeometry(0.06, 0.03, 2.9, 4).rotateZ(-x * 0.18).translate(x * 1.55, 1.6, z));
  }
  return merge(parts);
}

/** Gunboat: a pointed hull riding low in the water, a wheelhouse and a turret on the foredeck. */
export function gunboatGeo() {
  const hull = new THREE.CylinderGeometry(1.0, 0.75, 0.9, 6).scale(1, 1, 2.4).translate(0, 0.45, -0.2);
  const bow = new THREE.ConeGeometry(1.0, 1.6, 6).rotateX(Math.PI / 2).scale(1, 0.9, 1).translate(0, 0.5, 2.4);
  return merge([
    hull, bow, box(1.2, 0.9, 1.4, 0, 1.3, -1.0), box(0.9, 0.3, 0.9, 0, 1.9, -1.1),
    new THREE.CylinderGeometry(0.5, 0.6, 0.45, 8).translate(0, 1.15, 1.0),
    new THREE.CylinderGeometry(0.1, 0.1, 1.6, 5).rotateX(Math.PI / 2).translate(0, 1.25, 1.85),
    new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4).translate(0, 2.6, -1.1),
  ]);
}
export function gunboatGlow() { return merge([box(1.24, 0.12, 0.08, 0, 1.45, -0.3), box(2.0, 0.06, 0.06, 0, 0.95, -2.75), box(0.12, 0.12, 0.12, 0, 3.25, -1.1)]); }

/** Transport Barge: a wide flat hull with a hinged bow ramp, low side walls round the deck and a wheelhouse at the stern. */
export function bargeGeo() {
  return merge([
    box(2.6, 0.7, 4.6, 0, 0.35, 0), box(2.4, 0.5, 0.25, 0, 0.75, 2.2).rotateX(0.35).translate(0, 0.25, 0.25),
    box(0.18, 0.55, 4.0, -1.22, 0.95, -0.1), box(0.18, 0.55, 4.0, 1.22, 0.95, -0.1),
    box(1.6, 1.1, 1.0, 0, 1.25, -2.0), box(1.2, 0.3, 0.8, 0, 1.95, -2.0),
    new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4).translate(0.4, 2.55, -2.1),
  ]);
}
export function bargeGlow() { return merge([box(1.62, 0.12, 0.08, 0, 1.45, -1.48), box(2.64, 0.06, 0.06, 0, 0.72, -2.32), box(0.1, 0.1, 0.1, 0.4, 3.1, -2.1)]); }

/** Lurker: a sea creature mostly under the water: a ridged back, two dorsal fins, a wide jaw breaking the surface. */
export function lurkerGeo() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.85 - Math.abs(i - 1.2) * 0.13;
    parts.push(new THREE.IcosahedronGeometry(r, 0).scale(1.1, 0.55, 1.3).translate(0, 0.15 + Math.sin(i * 1.1) * 0.12, 1.1 - i * 1.15));
  }
  parts.push(cone(0.3, 1.3, 3).scale(0.4, 1, 1.6).translate(0, 0.9, 0.2), cone(0.24, 0.9, 3).scale(0.4, 1, 1.5).translate(0, 0.6, -1.9));
  // the jaw: two wedges, slightly open
  parts.push(cone(0.75, 1.5, 4).rotateX(Math.PI / 2 - 0.15).scale(1, 0.4, 1).translate(0, 0.35, 2.4));
  parts.push(cone(0.65, 1.3, 4).rotateX(Math.PI / 2 + 0.2).scale(1, 0.35, 1).translate(0, 0.0, 2.3));
  return merge(parts);
}

/** Spitter: a hunched creature with a swollen venom sac and a raised neck. */
export function spitterGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const body = ico(0.7); body.scale(0.8, 0.6, 1.1).translate(0, 1.0, -0.1);
  const sac = new THREE.IcosahedronGeometry(0.62, 1); sac.scale(1, 0.95, 1.1).translate(0, 1.35, -0.9);
  const neck = new THREE.CylinderGeometry(0.16, 0.24, 1.0, 5).rotateX(0.7).translate(0, 1.55, 0.65);
  const head = cone(0.3, 0.7, 5).rotateX(Math.PI / 2 + 0.3).translate(0, 1.9, 1.15);
  parts.push(body, sac, neck, head);
  for (const z of [-0.5, 0.4]) for (const x of [-0.45, 0.45]) parts.push(new THREE.CylinderGeometry(0.07, 0.04, 1.0, 4).translate(x, 0.5, z));
  return merge(parts);
}

/** Burrower: a segmented worm with a drill-like head. */
export function burrowerGeo() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.62 - Math.abs(i - 1.5) * 0.08;
    parts.push(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.85, 1.1).translate(0, 0.62 + Math.sin(i * 0.9) * 0.12, -1.6 + i * 0.75));
  }
  parts.push(cone(0.5, 1.2, 6).rotateX(Math.PI / 2).translate(0, 0.7, 2.0));
  for (const a of [0, 2.1, 4.2]) parts.push(cone(0.12, 0.6, 3).rotateX(Math.PI / 2).translate(Math.sin(a) * 0.4, 0.7 + Math.cos(a) * 0.4, 1.7));
  return merge(parts);
}

/** Nest: a low lumpy mound with a ring of spines and dark burrow mouths (far-off look). */
export function nestGeo() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.42, 1).translate(0, 0.6, 0));
  parts.push(new THREE.IcosahedronGeometry(1.8, 0).scale(1, 0.7, 1).translate(0.6, 1.5, -0.4));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(cone(0.3, 2.2, 4).rotateZ(-0.5).rotateY(-a).translate(Math.cos(a) * 2.4, 1.3, Math.sin(a) * 2.4));
  }
  return merge(parts);
}

/** Relic sentinel (far-off look): a pale tapered obelisk on a plinth. */
export function sentinelGeo() {
  const parts = [new THREE.CylinderGeometry(1.9, 1.9, 0.6, 6).translate(0, 0.3, 0)];
  for (let k = 0; k < 7; k++) {
    const r = 1.15 - (k / 6) * 0.55;
    parts.push(new THREE.CylinderGeometry(r, r, 0.78, 4).rotateY((k % 2) * Math.PI / 4 + k * 0.12).translate(0, 0.6 + k * 0.85 + 0.42, 0));
  }
  parts.push(new THREE.ConeGeometry(0.7, 0.5, 4).translate(0, 7.4, 0));
  return merge(parts);
}

/** Relic grid node (far-off look): a squat crystal on a ring of stones. */
export function gridNodeGeo() {
  return merge([new THREE.CylinderGeometry(2.0, 2.2, 0.6, 8).translate(0, 0.3, 0), new THREE.OctahedronGeometry(1.4, 0).scale(1, 1.8, 1).translate(0, 2.8, 0)]);
}

export interface BuiltinUnitLook { geo(): THREE.BufferGeometry; glow?(): THREE.BufferGeometry; material(): THREE.Material }

/**
 * Built-in look per unit id. A unit record with no entry here (one added in the
 * editor) borrows the Rover's or Swarmer's look by faction until it gets a model.
 */
export const BUILTIN_UNITS: Record<string, BuiltinUnitLook> = {
  rover: { geo: roverGeo, glow: roverGlow, material: () => accordMaterial() },
  tank: { geo: tankGeo, glow: tankGlow, material: () => accordMaterial(0.5) },
  artillery: { geo: artilleryGeo, glow: artilleryGlow, material: () => accordMaterial(0.5) },
  arc: { geo: arcGeo, glow: arcGlow, material: () => accordMaterial(0.45) },
  engineer: { geo: engineerGeo, glow: engineerGlow, material: () => accordMaterial(0.35) },
  scout: { geo: scoutGeo, glow: scoutGlow, material: () => accordMaterial(0.6) },
  skiff: { geo: skiffGeo, glow: skiffGlow, material: () => accordMaterial(0.5) },
  strider: { geo: striderGeo, material: () => faunaMaterial('#4f7f86', '#0f3a40') },
  gunboat: { geo: gunboatGeo, glow: gunboatGlow, material: () => accordMaterial(0.5) },
  barge: { geo: bargeGeo, glow: bargeGlow, material: () => accordMaterial(0.4) },
  lurker: { geo: lurkerGeo, material: () => faunaMaterial('#2f5a5e', '#3ad6c8') },
  swarmer: { geo: () => creatureGeo(false), material: () => faunaMaterial('#c0563a', '#5a1408') },
  brute: { geo: () => creatureGeo(true), material: () => faunaMaterial('#8a3550', '#3a0a1c') },
  spitter: { geo: spitterGeo, material: () => faunaMaterial('#6f8a2e', '#2a4008') },
  burrower: { geo: burrowerGeo, material: () => faunaMaterial('#7a5a3a', '#2e1a08') },
  lancer: { geo: lancerGeo, glow: lancerGlow, material: () => accordMaterial(0.55) },
  nest: { geo: nestGeo, material: () => faunaMaterial('#8a5048', '#3a1410') },
  sentinel: { geo: sentinelGeo, material: () => faunaMaterial('#c9c0ae', '#4a3a8a') },
  gridnode: { geo: gridNodeGeo, material: () => faunaMaterial('#b9b0a0', '#5a3cff') },
};
export const builtinUnitLook = (id: string, faction: string): BuiltinUnitLook =>
  BUILTIN_UNITS[id] ?? BUILTIN_UNITS[faction === 'accord' ? 'rover' : 'swarmer'];
