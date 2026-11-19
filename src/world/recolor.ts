/**
 * Recolourable nature models (blender/build.py "set v10: nature"): a model's
 * materials are colour slots, named `color` / `accent` / `glow` / `claw`
 * (wildlife) or `stem` / `leaf` / `glow` (plants). This bakes a loaded model
 * into one geometry with vertex colours and the `aGlow` channel, in a
 * species' colours, so it draws with the shared flora or wildlife material
 * and instances exactly like the built-in procedural shapes.
 *
 * A material that isn't a slot keeps its own colour (and glows if emissive).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { flattenForInstancing } from '../assets/models';

export interface Slot { color: THREE.Color; glow?: number }
/** Slot colours by material name; `stem` is graded from `stem` (root) to `tip` (top) when `tip` is given. */
export type Slots = Record<string, Slot | undefined> & { tip?: Slot };

export function recolorModel(root: THREE.Object3D, slots: Slots): THREE.BufferGeometry {
  const { geometry, materials } = flattenForInstancing(root);
  const pos = geometry.getAttribute('position');
  const n = pos.count;
  geometry.computeBoundingBox();
  const y0 = Math.max(0, geometry.boundingBox!.min.y), y1 = Math.max(y0 + 1e-3, geometry.boundingBox!.max.y);
  const col = new Float32Array(n * 3), glow = new Float32Array(n);
  const c = new THREE.Color();
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const g of groups) {
    const m = materials[g.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined;
    const name = (m?.name ?? '').toLowerCase();
    const slot = slots[name];
    const lit = slot ? slot.glow ?? (name === 'glow' ? 1 : 0) : m?.emissive && m.emissiveIntensity > 0.5 && m.emissive.getHex() ? 1 : 0;
    for (let i = g.start; i < g.start + g.count; i++) {
      if (name === 'stem' && slot && slots.tip) {
        const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
        c.copy(slot.color).lerp(slots.tip.color, t);
      } else if (slot) c.copy(slot.color);
      else if (lit && m?.emissive) c.copy(m.emissive);
      else c.copy(m?.color ?? c.set('#808080'));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      glow[i] = lit;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  const nrm = geometry.getAttribute('normal');
  if (nrm) out.setAttribute('normal', nrm);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  geometry.dispose();
  const merged = mergeVertices(out, 1e-4);
  merged.computeBoundingSphere();
  return merged;
}
