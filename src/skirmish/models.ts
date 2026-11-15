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
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.4, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.5, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: '#c0563a', roughness: 0.8, flatShading: true, emissive: '#5a1408', emissiveIntensity: 0.6 }),
  new THREE.MeshStandardMaterial({ color: '#8a3550', roughness: 0.7, flatShading: true, emissive: '#3a0a1c', emissiveIntensity: 0.6 }),
];
