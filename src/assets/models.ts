/**
 * Loading model assets (content/assets/*.json → public/media/model/*.glb).
 *
 * The asset record's import fix-ups (scale, yaw, lift) are applied here, so a
 * model looks the same in the editor's viewer and in the game. Shared by both;
 * must not import game content.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mediaUrl, withVersion, type AssetDef } from '../content/defs';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/** The raw glTF scene for a URL (cached; callers get clones). */
function loadScene(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => g.scene);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Drop cached copies (editor: after a file is replaced). */
export function forgetModel(url?: string) {
  if (url) cache.delete(url); else cache.clear();
}

/** Wrap a scene in the asset's import transform: scale, then turn, then lift. */
export function applyImport(inner: THREE.Object3D, a: Pick<AssetDef, 'scale' | 'yaw' | 'lift'>): THREE.Group {
  const g = new THREE.Group();
  inner.scale.setScalar(a.scale);
  inner.rotation.y = THREE.MathUtils.degToRad(a.yaw);
  inner.position.y = a.lift;
  g.add(inner);
  return g;
}

/** A ready-to-place copy of a model asset (cache-busted by `version`, e.g. the file hash). */
export async function loadModel(a: AssetDef, version = ''): Promise<THREE.Group> {
  const url = withVersion(mediaUrl(a), version);
  const scene = await loadScene(url);
  return applyImport(scene.clone(true), a);
}

/**
 * One geometry (with material groups) + a material list, for InstancedMesh.
 * Bakes every mesh's transform; keeps position, normal and uv only, so any
 * glTF merges. Skinned/morph animation is dropped.
 */
export function flattenForInstancing(root: THREE.Object3D): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const n = g.getAttribute('position').count;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const keep = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) keep.setAttribute(k, g.getAttribute(k));
    // carry multi-material groups over; otherwise the whole mesh is one group
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const idx = materials.length;
      materials.push(mats[gr.materialIndex ?? 0] ?? mats[0]);
      const sub = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const attr = keep.getAttribute(k) as THREE.BufferAttribute;
        sub.setAttribute(k, new THREE.BufferAttribute(attr.array.slice(gr.start * attr.itemSize, (gr.start + gr.count) * attr.itemSize), attr.itemSize));
      }
      sub.userData.mat = idx;
      parts.push(sub);
    }
  });
  if (!parts.length) throw new Error('model has no meshes');
  const geometry = mergeGeometries(parts, true)!;
  // mergeGeometries numbers groups by part order, which matches `materials`
  return { geometry, materials };
}

/**
 * Take the part named `name` (e.g. a tank's `turret`) out of a model, for drawing separately: returns it
 * wrapped so its geometry sits around its own origin (the pivot it turns on), with the model's scale and
 * turn kept, and the pivot's position in the model. Null if the model has no such part. The rest of
 * `root` no longer contains it.
 */
export function splitPart(root: THREE.Object3D, name: string): { part: THREE.Object3D; pivot: THREE.Vector3 } | null {
  root.updateMatrixWorld(true);
  const node = root.getObjectByName(name);
  if (!node || node === root) return null;
  const pivot = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  node.matrixWorld.decompose(pivot, q, s);
  node.removeFromParent();
  node.position.set(0, 0, 0);
  node.quaternion.copy(q);
  node.scale.copy(s);
  const part = new THREE.Group();
  part.add(node);
  return { part, pivot };
}

/** Triangles, vertices, meshes, materials and size of a model, for the asset browser. */
export function modelStats(root: THREE.Object3D) {
  let tris = 0, verts = 0, meshes = 0;
  const mats = new Set<THREE.Material>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const count = g.index ? g.index.count : g.getAttribute('position').count;
    tris += count / 3;
    verts += g.getAttribute('position').count;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return { tris: Math.round(tris), verts, meshes, materials: mats.size, size, box };
}
