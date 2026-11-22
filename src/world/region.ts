/**
 * The landing region: a detailed terrain patch laid onto the home globe, plus
 * everything the sim puts on it (Command Core, drone, buildings, fauna).
 */
import * as THREE from 'three';
import { buildAirpad, buildFlak } from './air-models';
import { ShieldDomes, type ShieldLook } from './shields';
import { buildMedBay, buildMemorial, buildSeedBank, buildShieldProjector } from './batchc-models';
import { BATCHED_KINDS, BuildingBatch } from './batch';
import type { Building, Snapshot } from '../sim/types';
import { lerp, smoothstep } from './noise';
import { makeGroundTextures } from './terrainTex';
import { Flora, type FloraBiome } from './flora';
import { buildCreatureLook, creatureMaterial } from './fauna-models';
import { recolorModel } from './recolor';
import type { WildlifeDef } from '../content/defs';
import { hash01 } from '../content/nature';
import { addFog } from './fog';
import { Printed } from './print';
import { buildWater, seabedColor, setWaterDetail } from './water';
import { buildPier, buildSeaPlatform, buildShipyard, buildTidal } from './sea-models';

import { ROSTER_BUILDINGS, buildCache, buildWreck } from './roster-models';
import {
  E, HALF, N, PAD_FALL, R, U, regionFlora, regionDir, regionHeight, regionHeightRaw, regionToWorld, setGroundPads, terrainColor, applyGroundPaint, worldToRegion, seabed, padded,
  type GroundPad,
} from './planet';

const STEP = 2;
const CYAN = new THREE.Color('#5ff3ff');
const AMBER = new THREE.Color('#ffb547');

const metal = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.45, flatShading: true, ...extra });
const glow = (c: THREE.ColorRepresentation, i = 2.2) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: i, flatShading: true });

export type Look = 'flat' | 'smooth';

const ROCK = new THREE.Color('#6a5a50');

function buildPatch(look: Look): THREE.Mesh {
  const step = look === 'smooth' ? 1.5 : STEP;
  const n = Math.round((HALF * 2) / step);
  const cols = n + 3; // +1 skirt ring on each side
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  /** Per vertex: region x, z and skirt drop, so building pads can re-level it later. */
  const vx: number[] = [], vz: number[] = [], vdrop: number[] = [];
  const v = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color();
  for (let j = -1; j <= n + 1; j++) {
    for (let i = -1; i <= n + 1; i++) {
      const skirt = i < 0 || j < 0 || i > n || j > n;
      const x = -HALF + Math.min(n, Math.max(0, i)) * step;
      const z = -HALF + Math.min(n, Math.max(0, j)) * step;
      const raw = regionHeightRaw(x, z);
      regionDir(x, z, d);
      v.copy(d).multiplyScalar(R + seabed(raw) - (skirt ? 10 : 0));
      pos.push(v.x, v.y, v.z);
      vx.push(x); vz.push(z); vdrop.push(skirt ? 10 : 0);
      // under the sea: the shore's colour, darker with depth (the water on top tints it)
      if (raw < 0) seabedColor(raw, terrainColor(1, regionFlora(x, z), c), c);
      else terrainColor(raw, regionFlora(x, z), c);
      applyGroundPaint(x, z, c);
      col.push(c.r, c.g, c.b);
      uv.push(x / 22, z / 22); // one texture tile per 22 units (~220 m)
    }
  }
  for (let j = 0; j < cols - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, cc = a + cols, dd = cc + 1;
      idx.push(a, b, cc, b, dd, cc);
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  let mat: THREE.Material;
  if (look === 'smooth') {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    // steep ground shows bare rock
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const up = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      up.fromBufferAttribute(p, i).normalize();
      nn.fromBufferAttribute(nrm, i);
      const w = smoothstep(0.06, 0.2, 1 - nn.dot(up));
      if (w <= 0) continue;
      c.setRGB(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i)).lerp(ROCK, w * 0.8);
      colAttr.setXYZ(i, c.r, c.g, c.b);
    }
    const tex = groundTextures();
    mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95,
    });
  } else {
    geo = geo.toNonIndexed();
    // toNonIndexed walks the index in order: vertex k came from index[k]
    const ix = [...idx];
    const [x0, z0, d0] = [vx, vz, vdrop].map((a) => [...a]);
    vx.length = vz.length = vdrop.length = 0;
    for (const k of ix) { vx.push(x0[k]); vz.push(z0[k]); vdrop.push(d0[k]); }
    geo.computeVertexNormals();
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
  }
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat);
  m.name = 'region-patch';
  m.userData.verts = { x: Float32Array.from(vx), z: Float32Array.from(vz), drop: Float32Array.from(vdrop) };
  return m;
}

let _tex: ReturnType<typeof makeGroundTextures> | null = null;
export const groundTextures = () => (_tex ??= makeGroundTextures());

/** Ribbon draped over the terrain from a to b (used for order vectors). */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private segs = 32;
  private geo = new THREE.BufferGeometry();
  constructor(color: THREE.Color, width: number) {
    const n = (this.segs + 1) * 2;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const idx: number[] = [];
    for (let i = 0; i < this.segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.width = width;
  }
  width: number;
  set(ax: number, az: number, bx: number, bz: number) {
    const p = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const sx = (-dz / len) * this.width, sz = (dx / len) * this.width;
    const v = new THREE.Vector3();
    for (let i = 0; i <= this.segs; i++) {
      const t = i / this.segs;
      const x = ax + dx * t, z = az + dz * t;
      const w = i === this.segs ? 0.1 : 1; // arrow-ish taper
      regionToWorld(x + sx * w, z + sz * w, 0.5, v); p.setXYZ(i * 2, v.x, v.y, v.z);
      regionToWorld(x - sx * w, z - sz * w, 0.5, v); p.setXYZ(i * 2 + 1, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
  }
}

export function orient(obj: THREE.Object3D, x: number, z: number, heading: number, lift: number) {
  regionToWorld(x, z, lift, obj.position);
  const up = regionDir(x, z);
  const fwd = new THREE.Vector3().copy(E).multiplyScalar(Math.sin(heading)).addScaledVector(N, Math.cos(heading));
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
}

export function buildCore(): THREE.Group {
  const g = new THREE.Group();
  const hull = metal('#9aa4ad');
  const dark = metal('#3a4048');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.5, 1.6, 8), dark);
  base.position.y = 0.8;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.2, 7, 8), hull);
  body.position.y = 5;
  body.rotation.y = Math.PI / 8; // a flat face toward -z for the drone hatch
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4, 8), hull);
  cap.position.y = 10.5;
  cap.rotation.y = Math.PI / 8;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.35, 6, 24), glow(CYAN, 3));
  ring.name = 'ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 4;
  const ring2 = new THREE.Mesh(ring.geometry, glow(CYAN, 3));
  ring2.name = 'ring';
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 6.4;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 5), dark);
  mast.position.y = 14.5;
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), glow(AMBER, 4));
  tip.position.y = 17;
  tip.name = 'beacon';
  g.add(base, body, cap, ring, ring2, mast, tip);
  // drone hatch on the -z face: dark bay with a lit lintel, door hinged at the bottom (folds out into a ramp)
  const apo = (y: number) => (5.2 - (y - 1.5) / 7) * Math.cos(Math.PI / 8);
  const bay = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.85, 0.1), new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 1, flatShading: true }));
  bay.position.set(0, 2.62, -apo(2.62) - 0.02);
  bay.rotation.x = 0.142;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), glow(AMBER, 2.5));
  lintel.position.set(0, 3.42, -apo(3.42) - 0.08);
  lintel.name = 'lintel';
  const hatch = new THREE.Group();
  hatch.name = 'hatch';
  hatch.position.set(0, 1.68, -apo(1.68) - 0.1);
  hatch.rotation.x = 0.142;
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.45, 1.95, 0.16), metal('#b4bcc4'));
  door.position.set(0, 0.975, -0.08);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.05), glow(CYAN, 2));
  stripe.position.set(0, 1.45, -0.18);
  hatch.add(door, stripe);
  g.add(bay, lintel, hatch);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), dark);
    leg.position.set(Math.cos(a) * 7, 2.2, Math.sin(a) * 7);
    leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.4, 6), dark);
    foot.position.set(Math.cos(a) * 8.4, 0.2, Math.sin(a) * 8.4);
    g.add(leg, foot);
  }
  // cryo pods ringing the base
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 3, 8), glow('#7ff7ff', 1.4));
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
  const plume = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 8, 1, true), new THREE.MeshBasicMaterial({
    color: '#dfe8ee', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  }));
  plume.rotation.x = Math.PI;
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
  const steam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 8, 8, 1, true), new THREE.MeshBasicMaterial({
    color: '#e8eff4', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide,
  }));
  steam.rotation.x = Math.PI;
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

/** Camera distance below which asset models draw instead of the built-ins (hysteresis: built-ins again beyond LOD_FAR); as the army's (src/skirmish/view.ts). */
const LOD_NEAR = 90, LOD_FAR = 105;

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

function glowSprite(color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(0.25, color);
  gr.addColorStop(0.32, 'rgba(95,243,255,0.35)');
  gr.addColorStop(1, 'rgba(95,243,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  }));
}

/** Terrain-following circle (rebuilt when its centre/radius change). */
class GroundRing {
  readonly line: THREE.LineLoop;
  private key = '';
  constructor(color: THREE.ColorRepresentation, opacity: number) {
    this.line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }));
    this.line.frustumCulled = false;
    this.line.visible = false;
  }
  set(x: number, z: number, r: number) {
    this.line.visible = true;
    const key = `${x.toFixed(1)},${z.toFixed(1)},${r.toFixed(1)}`;
    if (key === this.key) return;
    this.key = key;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const px = Math.max(-HALF, Math.min(HALF, x + Math.cos(a) * r)), pz = Math.max(-HALF, Math.min(HALF, z + Math.sin(a) * r));
      pts.push(regionToWorld(px, pz, 0.6));
    }
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
  hide() { this.line.visible = false; }
}

export interface BuildingLook { role: string; name: string; hp: number; clearance: number; fireRange?: number; range?: number; storage?: number; site?: string; shield?: number; shieldRadius?: number }
export interface RegionRules { defs: Record<string, BuildingLook>; buildRadius: number }

export type Selection = { kind: 'drone' | 'building' | 'colonist'; id: number } | { kind: 'units'; ids: number[] } | null;
export interface RegionUi {
  sel: Selection;
  drag: { x: number; z: number } | null;
  /** Where an order being dragged starts when it's for combat units (their centre). */
  dragFrom?: { x: number; z: number } | null;
  /** Flash a destination marker here until `until` (performance.now ms). */
  mark?: { x: number; z: number; until: number } | null;
  /** Building kind being placed, and where the ghost is. */
  build: string | null;
  ghost: { x: number; z: number; ok: boolean } | null;
  /** Placement rotation (region heading). */
  yaw?: number;
  /** Line placement (walls): where the line starts, and the segments it would place. */
  line?: { x: number; z: number } | null;
  ghostLine?: { pts: { x: number; z: number; ok: boolean }[]; yaw: number } | null;
}

interface BEntry { kind: string; done: boolean; obj: THREE.Group; powered: boolean; emissive: [THREE.MeshStandardMaterial, number][]; bar: THREE.Group; print?: Printed }

/** Every part called `name` in a model (an asset and its zoomed-out built-in both have one). */
function parts(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
}

/** A model with a zoomed-out built-in beside it: one of the two shows (RegionView.lodNear). */
interface Lod { near: THREE.Object3D; far: THREE.Object3D }

export class RegionView {
  patch: THREE.Mesh;
  readonly details = new THREE.Group();
  /** Shield domes (projectors) and bubbles (Aegis units). */
  private shields = new ShieldDomes((o, x, z) => orient(o, x, z, 0, 0));
  private lastShieldT = 0;
  /** The first drone's model (the landing cinematic flies it out of the Core). */
  readonly drone: THREE.Group;
  readonly droneWorld = new THREE.Vector3();
  /** While true, the landing cinematic owns the first drone's transform. */
  droneHeld = false;
  readonly flora: Flora | null;
  readonly core: THREE.Group;
  /** Interpolated drone positions this frame (for picking and HUD). */
  readonly drones = new Map<number, { obj: THREE.Group; x: number; z: number; world: THREE.Vector3; team?: number; lift?: number }>();
  /** This frame's buildings (for roofAt) and each kind's model extents: half width, half depth, height. */
  private roofSrc: Building[] = [];
  private kindBox = new Map<string, [number, number, number]>();
  private lastUpdT = -1;
  /** How high the top of a building at (x, z) stands above the ground (0: open ground), `pad` wider all round. */
  roofAt(x: number, z: number, pad = 1): number {
    let top = 0;
    for (const b of this.roofSrc) {
      const dx = x - b.x, dz = z - b.z;
      const reach = (this.rules.defs[b.kind]?.clearance ?? 8) + 12;
      if (dx * dx + dz * dz > reach * reach) continue;
      const [hx, hz, h] = this.boxOf(b.kind);
      const yaw = b.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
      if (Math.abs(dx * c - dz * sn) > hx + pad || Math.abs(dx * sn + dz * c) > hz + pad) continue;
      top = Math.max(top, h * Math.min(1, Math.max(0.15, b.progress)));
    }
    return top;
  }
  private boxOf(kind: string): [number, number, number] {
    let k = this.kindBox.get(kind);
    if (!k) {
      const g = this.modelFor(kind);
      this.dropLod(g);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      k = box.isEmpty() ? [4, 4, 4] : [Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z), box.max.y];
      this.kindBox.set(kind, k);
    }
    return k;
  }
  /** Skirmish: a ring in its owner's colour under every building and drone (key 'b<id>' / 'd<id>'). */
  private teamRings = new Map<string, THREE.Mesh>();
  private teamRingGeo: THREE.BufferGeometry | null = null;
  private teamRingMats = new Map<string, THREE.MeshBasicMaterial>();
  private ringsSeen = new Set<string>();
  /** A team ring at (x, z), radius r, in `color`; call `endTeamRings` once a frame to drop the ones not placed. */
  private teamRing(key: string, x: number, z: number, r: number, color: string) {
    this.ringsSeen.add(key);
    let m = this.teamRings.get(key);
    if (!m) {
      this.teamRingGeo ??= new THREE.RingGeometry(0.84, 1, 48).rotateX(-Math.PI / 2);
      let mat = this.teamRingMats.get(color);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
        this.teamRingMats.set(color, mat);
      }
      m = new THREE.Mesh(this.teamRingGeo, mat);
      m.renderOrder = 2;
      this.teamRings.set(key, m);
      this.details.add(m);
    }
    orient(m, x, z, 0, 0.35);
    m.scale.setScalar(r);
  }
  private endTeamRings() {
    for (const [k, m] of this.teamRings) if (!this.ringsSeen.has(k)) { this.details.remove(m); this.teamRings.delete(k); }
    this.ringsSeen.clear();
  }
  /** Wildlife: one instanced mesh per species on the map (index into the sorted species ids), all in `wildGroup`. */
  private wildGroup = new THREE.Group();
  private wildMat = creatureMaterial();
  private wild = new Map<number, THREE.InstancedMesh>();
  private wildIds: string[] = [];
  private wildDefs: Record<string, WildlifeDef> = {};
  /** Loaded wildlife models (asset id → scene), and each species' geometry built from them or the built-in. */
  private wildModels: Record<string, THREE.Object3D> = {};
  private wildGeos = new Map<number, THREE.BufferGeometry>();
  /** Per creature: how far a burrower has sunk (0..1), eased. */
  private wildSink = new Float32Array(0);
  private wildLastT = 0;
  private buildings = new Map<number, BEntry>();
  /** Instanced finished buildings, per kind in BATCHED_KINDS. */
  private batches = new Map<string, BuildingBatch>();
  private partM = new THREE.Matrix4();
  private deposits: THREE.Group[] = [];
  private wrecks: THREE.Group[] = [];
  /** Zoomed in: asset models draw (else their built-ins). */
  private lodNear = true;
  private lods = new Set<Lod>();
  private seams: THREE.Group[] = [];
  private caches: THREE.Group[] = [];
  private cacheModel: THREE.Object3D | null = null;
  private wreckModel: THREE.Object3D | null = null;
  private vents: THREE.Group[] = [];
  private haulers = new Map<number, THREE.Group>();
  /** The worker drone's asset model (exo-drone), or null for the built-in. Drones and haulers are shells whose contents swap. */
  private droneModel: THREE.Object3D | null = null;
  /** Game-time seconds this frame (see update). */
  private gameT = 0;
  private orderRibbon = new Ribbon(CYAN, 0.45);
  private targetRibbon = new Ribbon(CYAN, 0.18);
  private selRing: THREE.Mesh;
  private targetRing: THREE.Mesh;
  private rangeRing = new GroundRing(CYAN, 0.7);
  private reachRing = new GroundRing(AMBER, 0.6);
  private areaRings: GroundRing[] = [];
  private ghosts = new Map<string, THREE.Group>();
  private printOn = true;
  /** Printed construction (src/world/print.ts) or the plain scaffold box (Options; `?print=0`). */
  get printing() { return this.printOn; }
  set printing(v: boolean) {
    if (v === this.printOn) return;
    this.printOn = v;
    // buildings under construction rebuild in the new style on the next update
    for (const [id, e] of this.buildings) if (!e.done) { this.dropBuilding(id, e); this.buildings.delete(id); }
  }
  private ghostOk = new THREE.MeshBasicMaterial({ color: '#5bff9a', transparent: true, opacity: 0.4, depthWrite: false });
  private ghostBad = new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.4, depthWrite: false });
  private border: THREE.LineLoop;
  private marker: THREE.Sprite;
  private raycaster = new THREE.Raycaster();
  private models: Record<string, THREE.Object3D> = {};
  private firstDrone = -1;
  private coreAlive = true;
  /** Ground pads under buildings, by building id (height fixed when first seen). */
  private pads = new Map<number, GroundPad>();
  private padKey = '';
  private lineGhosts: THREE.Group[] = [];
  private fog = false;
  /** The sea at ground level (water.ts), or null on a dry body. */
  readonly water: THREE.Mesh | null;
  private waterOn = true;
  /** Detailed water (ripple layers, lapping foam) or the simple one (phones). */
  get waterDetail() { return this.waterOn; }
  set waterDetail(v: boolean) {
    if (v === this.waterOn) return;
    this.waterOn = v;
    if (this.water) setWaterDetail(this.water.material as THREE.Material, v);
  }

  constructor(scene: THREE.Scene, look: Look = 'flat', floraSeed: number | null = 1, floraDensity = 1, private rules: RegionRules = { defs: {}, buildRadius: 30 },
    nature: { biome?: FloraBiome; wildlife?: Record<string, WildlifeDef> } = {}) {
    this.patch = buildPatch(look);
    scene.add(this.patch);
    scene.add(this.details);
    this.water = buildWater(this.waterOn);
    if (this.water) this.details.add(this.water);

    this.core = buildCore();
    orient(this.core, 0, 0, 0, 0);
    this.details.add(this.core);

    this.drone = this.droneShell();
    this.details.add(this.drone);

    this.flora = floraSeed === null ? null : new Flora({ seed: floraSeed, flat: look === 'flat', density: floraDensity, biome: nature.biome });
    if (this.flora) this.details.add(this.flora.group);

    this.wildDefs = nature.wildlife ?? {};
    this.wildIds = Object.keys(this.wildDefs).sort();
    this.wildGroup.name = 'wildlife';
    this.details.add(this.wildGroup);

    const ringGeo = new THREE.RingGeometry(1.8, 2.2, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.details.add(this.selRing, this.targetRing, this.orderRibbon.mesh, this.targetRibbon.mesh, this.rangeRing.line, this.reachRing.line);
    (this.targetRibbon.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;

    // region border: the territory outline seen from orbit
    const pts: THREE.Vector3[] = [];
    const side = (x0: number, z0: number, x1: number, z1: number) => {
      for (let i = 0; i < 60; i++) { const t = i / 60; pts.push(regionToWorld(lerp(x0, x1, t), lerp(z0, z1, t), 0.8)); }
    };
    const h = HALF - 0.5;
    side(-h, -h, h, -h); side(h, -h, h, h); side(h, h, -h, h); side(-h, h, -h, -h);
    this.border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4, fog: false, depthWrite: false }));
    scene.add(this.border);

    this.marker = glowSprite('rgba(200,255,255,1)');
    this.marker.position.copy(U).multiplyScalar(R + regionHeight(0, 0) + 4);
    this.marker.renderOrder = 10;
    scene.add(this.marker);
  }

  /** Region border, orbit marker and core beacon — everything that isn't sim-driven. */
  updateOverlay(dist: number, t: number) {
    // fade detail out as we leave the surface
    this.details.visible = dist < 1800;
    const borderMat = this.border.material as THREE.LineBasicMaterial;
    borderMat.opacity = lerp(0.25, 0.9, smoothstep(150, 1500, dist)) * (1 - smoothstep(12000, 40000, dist));
    this.border.visible = borderMat.opacity > 0.01;
    const mk = smoothstep(400, 2500, dist) * (1 - smoothstep(60000, 200000, dist));
    this.marker.visible = mk > 0.01;
    (this.marker.material as THREE.SpriteMaterial).opacity = mk;
    this.marker.scale.setScalar(dist * 0.035);
    const beacon = this.core.getObjectByName('beacon') as THREE.Mesh;
    (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 + Math.max(0, Math.sin(t * 4)) * 4;
  }

  /** Skirmish mode: keep terrain + core, hide the colony's drones, grazers and overlays. */
  hideLandingEntities() {
    for (const o of [this.drone, this.wildGroup, this.selRing, this.targetRing, this.orderRibbon.mesh, this.targetRibbon.mesh]) o.visible = false;
    if (this.flora) this.flora.group.visible = false;
    this.details.remove(this.drone, this.wildGroup, this.selRing, this.targetRing);
  }

  /** Ground point under a screen position (NDC), or null. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): { x: number; z: number } | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects(this.water ? [this.water, this.patch] : [this.patch], false)[0];
    if (!hit) return null;
    const p = worldToRegion(hit.point);
    if (Math.abs(p.x) > HALF - 6 || Math.abs(p.z) > HALF - 6) return null;
    return p;
  }

  /** Building under a ground point (by footprint), or null. */
  buildingAt(x: number, z: number, list: Building[]): number | null {
    let best: number | null = null, bd = Infinity;
    for (const b of list) {
      const d = this.rules.defs[b.kind];
      const r = (d?.clearance ?? 8) / 2 + 1.5;
      const dist = Math.hypot(b.x - x, b.z - z);
      if (dist < r && dist < bd) { bd = dist; best = b.id; }
    }
    return best;
  }

  /**
   * Switch the terrain look in place (Options → Terrain look): a new ground mesh, the flora's shading. The
   * building pads are levelled into the new mesh, and fog of war carries over (lights patch it on first draw).
   */
  setLook(look: Look) {
    const old = this.patch, parent = old.parent;
    const next = buildPatch(look);
    parent?.add(next);
    parent?.remove(old);
    old.geometry.dispose();
    // the smooth look's ground textures are shared: only the material goes
    (old.material as THREE.Material).dispose();
    this.patch = next;
    if (this.fog) addFog(next.material as THREE.Material);
    this.relevel([...this.pads.values()]);
    this.flora?.setFlat(look === 'flat');
  }

  /** Fog of war: the ground, flora, grazers and deposits darken where the colony can't see. */
  enableFog() {
    this.fog = true;
    addFog(this.patch.material as THREE.Material);
    if (this.water) addFog(this.water.material as THREE.Material);
    addFog(this.wildMat);
    this.flora?.group.traverse((o) => { if (o instanceof THREE.Mesh) addFog(o.material as THREE.Material); });
    for (const g of this.deposits) this.fogObj(g);
    for (const g of this.seams) this.fogObj(g);
    for (const g of this.vents) this.fogObj(g);
  }

  private fogObj(g: THREE.Object3D) {
    g.traverse((o) => { if (o instanceof THREE.Mesh) addFog(o.material as THREE.Material); });
  }

  /** Test hook: region heading a building (or a named part of it) faces. */
  facing(id: number, part?: string): number | null {
    const e = this.buildings.get(id);
    const o = e && (part ? e.obj.getObjectByName(part) : e.obj);
    if (!o) return null;
    o.updateMatrixWorld(true);
    const a = worldToRegion(new THREE.Vector3(0, 0, 0).applyMatrix4(o.matrixWorld));
    const b = worldToRegion(new THREE.Vector3(0, 0, 5).applyMatrix4(o.matrixWorld));
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Use an asset model for a building kind instead of the built-in (null = built-in). */
  setBuildingModel(kind: string, obj: THREE.Object3D | null) {
    if (obj) this.models[kind] = obj; else delete this.models[kind];
    const g = this.ghosts.get(kind);
    if (g) { this.details.remove(g); this.ghosts.delete(kind); }
    for (const [id, e] of this.buildings) if (e.kind === kind && e.done) { this.dropBuilding(id, e); this.buildings.delete(id); }
    const batch = this.batches.get(kind);
    if (batch) { this.details.remove(batch.group); batch.dispose(); this.batches.delete(kind); }
  }

  /** The instanced batch for a kind, made on first use (null if the kind isn't batched). */
  private batchFor(kind: string): BuildingBatch | null {
    if (!BATCHED_KINDS.has(kind)) return null;
    let b = this.batches.get(kind);
    if (!b) {
      b = new BuildingBatch(this.modelFor(kind));
      this.batches.set(kind, b);
      this.details.add(b.group);
    }
    return b;
  }

  /** Test hook: draw calls and instance counts of the building batches. */
  batchStats(): Record<string, { count: number; drawCalls: number }> {
    return Object.fromEntries([...this.batches].map(([k, b]) => [k, { count: b.count, drawCalls: b.drawCalls }]));
  }

  private dropBuilding(id: number, e: BEntry) {
    this.dropLod(e.obj);
    e.print?.dispose();
    this.details.remove(e.obj, e.bar);
    this.batches.get(e.kind)?.remove(id);
  }

  private modelFor(kind: string): THREE.Group {
    const m = this.models[kind];
    const builtin = () => buildForKind(kind, this.rules.defs[kind]?.role ?? 'solar');
    if (!m) return builtin();
    // the asset up close, the built-in when zoomed out (batched kinds draw through their batch: asset only)
    const g = new THREE.Group();
    const near = m.clone(true);
    g.add(near);
    if (!BATCHED_KINDS.has(kind)) this.lodPair(g, near, builtin());
    return g;
  }

  /** Put `far` beside `near` in `g` and remember the pair for the level-of-detail switch. */
  private lodPair(g: THREE.Group, near: THREE.Object3D, far: THREE.Object3D) {
    far.name = far.name || 'lod-far';
    g.add(far);
    const l: Lod = { near, far };
    near.visible = this.lodNear; far.visible = !this.lodNear;
    g.userData.lod = l;
    this.lods.add(l);
  }

  /** Swap every model pair at the zoom thresholds (with hysteresis). */
  private updateLod(dist: number) {
    const near = dist < (this.lodNear ? LOD_FAR : LOD_NEAR);
    if (near === this.lodNear) return;
    this.lodNear = near;
    for (const l of this.lods) { l.near.visible = near; l.far.visible = !near; }
  }

  /** Forget a removed object's model pair. */
  private dropLod(obj: THREE.Object3D) {
    const l = obj.userData.lod as Lod | undefined;
    if (l) this.lods.delete(l);
  }

  private ghostFor(kind: string): THREE.Group {
    let g = this.ghosts.get(kind);
    if (!g) {
      g = this.modelFor(kind);
      const l = g.userData.lod as Lod | undefined;
      if (l) { this.lods.delete(l); l.near.visible = true; g.remove(l.far); }
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.material = this.ghostOk; });
      this.ghosts.set(kind, g);
      this.details.add(g);
    }
    return g;
  }

  /**
   * `t` is wall-clock seconds (UI pulses: selection, placement, beacon keep going while paused);
   * `gameT` advances with the game speed and stops when paused (drones, haulers, dishes, doors).
   */
  update(prev: Snapshot, cur: Snapshot, alpha: number, t: number, ui: RegionUi, dist: number, camera: THREE.Camera, gameT = t) {
    this.gameT = gameT;
    this.roofSrc = cur.buildings;
    const dt = this.lastUpdT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastUpdT));
    this.lastUpdT = t;
    this.updateOverlay(dist, t);
    this.updateLod(dist);

    // drones (interpolated)
    const seen = new Set<number>();
    for (const b of cur.drones) {
      seen.add(b.id);
      const a = prev.drones.find((d) => d.id === b.id) ?? b;
      let e = this.drones.get(b.id);
      if (!e) {
        if (this.firstDrone < 0) this.firstDrone = b.id;
        const obj = b.id === this.firstDrone ? this.drone : this.droneShell();
        if (obj !== this.drone) this.details.add(obj);
        e = { obj, x: b.x, z: b.z, world: new THREE.Vector3() };
        this.drones.set(b.id, e);
      }
      e.team = b.team ?? 0;
      const x = lerp(a.x, b.x, alpha), z = lerp(a.z, b.z, alpha);
      let dh = b.heading - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const bob = Math.sin(gameT * 3 + b.id) * 0.15;
      const held = this.droneHeld && b.id === this.firstDrone;
      // fly over buildings, not through them (rising ahead of a roof, settling back after it)
      const want = Math.max(2.4, this.roofAt(x, z, 1.2) + 1.1);
      e.lift = e.lift === undefined ? want : e.lift + (want - e.lift) * Math.min(1, dt * (want > e.lift ? 8 : 2.5));
      if (!held) orient(e.obj, x, z, a.heading + dh * alpha, e.lift + bob);
      e.x = x; e.z = z;
      e.world.copy(e.obj.position);
      const pc = cur.players?.[b.team ?? 0]?.color;
      if (pc) this.teamRing(`d${b.id}`, x, z, 2.2, pc);
      if (b.id === this.firstDrone) this.droneWorld.copy(e.obj.position);
    }
    for (const [id, e] of this.drones) {
      if (seen.has(id)) continue;
      if (e.obj === this.drone) this.drone.visible = false; else this.details.remove(e.obj);
      this.drones.delete(id);
    }

    // selection, orders
    const sel = ui.sel;
    const selDrone = sel?.kind === 'drone' ? this.drones.get(sel.id) : undefined;
    const selDroneSnap = sel?.kind === 'drone' ? cur.drones.find((d) => d.id === sel.id) : undefined;
    const selB = sel?.kind === 'building' ? cur.buildings.find((b) => b.id === sel.id) : undefined;
    this.selRing.visible = !!selDrone || !!selB;
    if (selDrone) {
      orient(this.selRing, selDrone.x, selDrone.z, 0, 0.3);
      this.selRing.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    } else if (selB) {
      orient(this.selRing, selB.x, selB.z, 0, 0.3);
      this.selRing.scale.setScalar(((this.rules.defs[selB.kind]?.clearance ?? 8) / 2 + 1) / 2 * (1 + Math.sin(t * 5) * 0.03));
    }
    if (selDrone && selDroneSnap?.moving && !ui.drag) {
      const b = selDroneSnap;
      this.targetRing.visible = true;
      orient(this.targetRing, b.tx, b.tz, t, 0.35);
      this.targetRing.scale.setScalar(b.working ? 2.6 : 0.8 + (t % 1) * 0.6);
      this.targetRibbon.mesh.visible = Math.hypot(b.tx - selDrone.x, b.tz - selDrone.z) > 3;
      this.targetRibbon.set(selDrone.x, selDrone.z, b.tx, b.tz);
    } else if (ui.mark && performance.now() < ui.mark.until && !ui.drag) {
      // combat-unit order: a shrinking marker where they're headed
      const k = (ui.mark.until - performance.now()) / 900;
      this.targetRing.visible = true;
      orient(this.targetRing, ui.mark.x, ui.mark.z, t, 0.35);
      this.targetRing.scale.setScalar(0.6 + k * 1.6);
      this.targetRibbon.mesh.visible = false;
    } else {
      this.targetRing.visible = false;
      this.targetRibbon.mesh.visible = false;
    }
    const from = selDrone ?? ui.dragFrom;
    this.orderRibbon.mesh.visible = !!ui.drag && !!from;
    if (ui.drag && from) this.orderRibbon.set(from.x, from.z, ui.drag.x, ui.drag.z);

    // placement ghost and range rings
    const line = ui.build ? ui.ghostLine : null;
    for (const [k, g] of this.ghosts) g.visible = ui.build === k && !!ui.ghost && !line;
    this.syncLineGhosts(ui.build, line ?? null);
    this.rangeRing.hide();
    this.reachRing.hide();
    if (ui.build && ui.ghost && !line) {
      const g = this.ghostFor(ui.build);
      g.visible = true;
      orient(g, ui.ghost.x, ui.ghost.z, ui.yaw ?? 0, 0);
      const mat = ui.ghost.ok ? this.ghostOk : this.ghostBad;
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.material = mat; });
      const d = this.rules.defs[ui.build];
      if (d?.fireRange) this.rangeRing.set(ui.ghost.x, ui.ghost.z, d.fireRange);
      if ((d?.role === 'depot' || d?.role === 'relay') && d.range) this.reachRing.set(ui.ghost.x, ui.ghost.z, d.range);
    } else if (selB) {
      const d = this.rules.defs[selB.kind];
      if (d?.fireRange) this.rangeRing.set(selB.x, selB.z, d.fireRange);
      if (d?.role === 'depot' && d.range) this.reachRing.set(selB.x, selB.z, d.range);
      if ((d?.role === 'core' || d?.role === 'relay') && d.range) this.reachRing.set(selB.x, selB.z, d.range);
    }
    this.syncAreaRings(ui.build ? cur.buildings : []);

    this.syncBuildings(cur, t, ui, camera);
    this.syncShields(prev, cur, alpha, t);
    this.syncDeposits(cur);
    this.syncWrecks(cur);
    this.syncSeams(cur);
    this.syncCaches(cur);
    this.animateVents(cur.buildings);

    this.syncWildlife(prev, cur, alpha);
  }

  /**
   * Wildlife: x, z, heading, species×4+state per creature (sim/core.ts snapshot). Each species
   * draws as one instanced mesh; walkers bob, hoppers hop, flyers glide and flap, burrowers sink.
   */
  private syncWildlife(prev: Snapshot, cur: Snapshot, alpha: number) {
    const pa = prev.fauna, pb = cur.fauna;
    const n = Math.min(pb.length, pa.length) / 4;
    const t = this.gameT;
    const dt = Math.min(0.2, Math.max(0, t - this.wildLastT));
    this.wildLastT = t;
    if (this.wildSink.length !== n) this.wildSink = new Float32Array(n);
    // how many of each species, so each mesh holds enough
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) { const k = Math.floor(pb[i * 4 + 3] / 4); counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [k, c] of counts) {
      let mesh = this.wild.get(k);
      if (mesh && mesh.instanceMatrix.count >= c) continue;
      const geo = this.wildGeo(k);
      if (mesh) { this.wildGroup.remove(mesh); mesh.dispose(); }
      mesh = new THREE.InstancedMesh(geo, this.wildMat, Math.max(16, Math.ceil(c * 1.25)));
      mesh.name = `wild-${this.wildIds[k] ?? k}`;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.wildGroup.add(mesh);
      this.wild.set(k, mesh);
    }
    for (const mesh of this.wild.values()) mesh.count = 0;
    const m = this.wildM, pos = this.wildP, up = this.wildU, fwd = this.wildF, right = this.wildR, q = this.wildQ, sc = this.wildS, tint = this.wildC;
    for (let i = 0; i < n; i++) {
      const aux = pb[i * 4 + 3];
      const k = Math.floor(aux / 4), st = aux - k * 4;
      const mesh = this.wild.get(k)!;
      const def = this.wildDefs[this.wildIds[k]];
      const ax = pa[i * 4], az = pa[i * 4 + 1], bx = pb[i * 4], bz = pb[i * 4 + 1];
      const fx = lerp(ax, bx, alpha), fz = lerp(az, bz, alpha);
      let fh = pb[i * 4 + 2] - pa[i * 4 + 2];
      fh = Math.atan2(Math.sin(fh), Math.cos(fh));
      const heading = pa[i * 4 + 2] + fh * alpha;
      const h1 = hash01(i, 7), h2 = hash01(i, 13);
      const size = def ? def.size + ((def.sizeMax ?? def.size) - def.size) * h1 : 1 + (i % 5) * 0.12;
      const moving = Math.hypot(bx - ax, bz - az) > 0.01;
      const ph = h2 * 20;
      let lift = 0, sx = 1;
      const plan = def?.body ?? 'hexapod';
      if (def?.behavior === 'flyer') {
        lift = (def.height ?? 10) * (0.85 + h1 * 0.3) + Math.sin(t * 0.8 + ph) * 0.8;
        sx = 1 + Math.sin(t * (st === 1 ? 11 : 5) + ph) * 0.28;
      } else if (plan === 'hopper') {
        if (moving) lift = Math.abs(Math.sin(t * 7 + ph)) * 0.55 * size;
      } else if (moving && plan !== 'serpent' && plan !== 'ray') {
        lift = Math.abs(Math.sin(t * (st === 1 ? 14 : 7) / Math.sqrt(size) + ph)) * 0.05 * size;
      }
      // burrowers ease down out of sight and back up
      const want = st === 2 ? 1 : 0;
      this.wildSink[i] += (want - this.wildSink[i]) * Math.min(1, dt * 3);
      lift -= this.wildSink[i] * size * 1.1;
      regionToWorld(fx, fz, lift, pos);
      regionDir(fx, fz, up);
      fwd.copy(E).multiplyScalar(Math.sin(heading)).addScaledVector(N, Math.cos(heading));
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      right.crossVectors(up, fwd);
      q.setFromRotationMatrix(m.makeBasis(right, up, fwd));
      sc.set(size * sx, size, size);
      m.compose(pos, q, sc);
      const j = mesh.count++;
      mesh.setMatrixAt(j, m);
      const l = 0.9 + h2 * 0.2;
      mesh.setColorAt(j, tint.setRGB(l, l, l));
    }
    for (const mesh of this.wild.values()) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  /** A species' geometry: its model in its colours once loaded, else its built-in body plan. */
  private wildGeo(k: number): THREE.BufferGeometry {
    let g = this.wildGeos.get(k);
    if (g) return g;
    const def = this.wildDefs[this.wildIds[k]] ?? { body: 'hexapod', color: '#c78a5a', accent: '#6a3a24' } as WildlifeDef;
    const model = def.model ? this.wildModels[def.model] : undefined;
    if (model) {
      try {
        g = recolorModel(model, {
          color: { color: new THREE.Color(def.color) }, accent: { color: new THREE.Color(def.accent) },
          glow: { color: new THREE.Color(def.glow || def.accent), glow: def.glow ? 1 : 0 },
        });
      } catch (e) { console.warn(`wildlife model ${def.model} failed`, e); }
    }
    g ??= buildCreatureLook(def);
    this.wildGeos.set(k, g);
    return g;
  }

  /** Models for wildlife and plants arrived (asset id → loaded scene): species that use them switch over. */
  setNatureModels(models: Record<string, THREE.Object3D>) {
    Object.assign(this.wildModels, models);
    for (const [k, mesh] of this.wild) {
      const def = this.wildDefs[this.wildIds[k]];
      if (!def?.model || !models[def.model]) continue;
      const old = this.wildGeos.get(k);
      this.wildGeos.delete(k);
      mesh.geometry = this.wildGeo(k);
      old?.dispose();
    }
    this.flora?.setModels(models);
  }

  private wildM = new THREE.Matrix4();
  private wildP = new THREE.Vector3();
  private wildU = new THREE.Vector3();
  private wildF = new THREE.Vector3();
  private wildR = new THREE.Vector3();
  private wildQ = new THREE.Quaternion();
  private wildS = new THREE.Vector3();
  private wildC = new THREE.Color();

  /** Shield domes over powered projectors, bubbles round Aegis units (interpolated). */
  private syncShields(prev: Snapshot, cur: Snapshot, alpha: number, t: number) {
    if (!this.shields.group.parent) this.details.add(this.shields.group);
    const list: ShieldLook[] = [];
    for (const b of cur.buildings) {
      const d = this.rules.defs[b.kind];
      if (!d?.shield || !d.shieldRadius || b.progress < 1) continue;
      list.push({ id: `b${b.id}`, x: b.x, z: b.z, r: d.shieldRadius, charge: (b.sh ?? 0) / d.shield, up: b.powered && !b.shDown && (b.sh ?? 0) > 0 });
    }
    for (const u of cur.units) {
      if (!u.shR) continue;
      const a = prev.units.find((x) => x.id === u.id) ?? u;
      list.push({ id: `u${u.id}`, x: lerp(a.x, u.x, alpha), z: lerp(a.z, u.z, alpha), r: u.shR, charge: u.sh ?? 0, up: !!u.shUp });
    }
    const dt = Math.min(0.1, Math.max(0, t - this.lastShieldT));
    this.lastShieldT = t;
    this.shields.sync(list, this.gameT, dt);
  }

  /** Wall line preview: one ghost segment per point, green or red. */
  private syncLineGhosts(kind: string | null, line: NonNullable<RegionUi['ghostLine']> | null) {
    const n = kind && line ? line.pts.length : 0;
    while (this.lineGhosts.length < n) {
      const g = this.modelFor(kind!);
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.material = this.ghostOk; });
      this.details.add(g);
      this.lineGhosts.push(g);
    }
    this.lineGhosts.forEach((g, i) => {
      g.visible = i < n;
      if (i >= n) return;
      const p = line!.pts[i];
      orient(g, p.x, p.z, line!.yaw, 0);
      const mat = p.ok ? this.ghostOk : this.ghostBad;
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.material = mat; });
    });
  }

  /**
   * Level the ground under buildings (visual only). Pads are added/removed as
   * buildings come and go; only the patch vertices near a changed pad move.
   */
  private syncPads(list: Building[]) {
    // offshore buildings stand on piles: no pad (it would raise an island under them)
    const ids = list.filter((b) => b.kind !== 'core' && this.rules.defs[b.kind]?.site !== 'water').map((b) => b.id);
    const key = ids.join(',');
    if (key === this.padKey) return;
    this.padKey = key;
    const changed: GroundPad[] = [];
    const keep = new Set(ids);
    for (const [id, p] of this.pads) if (!keep.has(id)) { changed.push(p); this.pads.delete(id); }
    for (const b of list) {
      if (b.kind === 'core' || this.pads.has(b.id) || this.rules.defs[b.kind]?.site === 'water') continue;
      const r = (this.rules.defs[b.kind]?.clearance ?? 8) / 2 + 0.5;
      let h = 0, n = 0;
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) {
        h += Math.max(0, regionHeightRaw(b.x + dx, b.z + dz)); n++;
      }
      const p = { x: b.x, z: b.z, r, h: Math.max(0.4, h / n) };
      this.pads.set(b.id, p);
      changed.push(p);
    }
    setGroundPads([...this.pads.values()]);
    this.relevel(changed);
  }

  /** Move the patch vertices near these pads to the padded ground (and fix their normals). */
  private relevel(changed: GroundPad[]) {
    if (!changed.length) return;
    const verts = this.patch.userData.verts as { x: Float32Array; z: Float32Array; drop: Float32Array } | undefined;
    if (!verts) return;
    const pos = this.patch.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let lo = Infinity, hi = -1;
    for (let i = 0; i < pos.count; i++) {
      const x = verts.x[i], z = verts.z[i];
      if (!changed.some((p) => Math.abs(x - p.x) < p.r + PAD_FALL + 1 && Math.abs(z - p.z) < p.r + PAD_FALL + 1)) continue;
      const raw = regionHeightRaw(x, z);
      regionDir(x, z, v).multiplyScalar(R + (raw < 0 ? padded(x, z, seabed(raw)) : regionHeight(x, z)) - verts.drop[i]);
      pos.setXYZ(i, v.x, v.y, v.z);
      lo = Math.min(lo, i); hi = Math.max(hi, i);
    }
    if (hi < 0) return;
    const geo = this.patch.geometry;
    if (geo.index) { pos.needsUpdate = true; geo.computeVertexNormals(); return; } // smooth look: shared corners, all of it
    // flat look (a triangle per three vertices): only the triangles that moved get new normals, and only that
    // stretch is uploaded (placing a building used to redo all ~90k vertices: a hitch on phones)
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const t0 = lo - (lo % 3), t1 = hi - (hi % 3) + 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = t0; t < t1; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
      c.sub(b); a.sub(b); c.cross(a).normalize();
      nrm.setXYZ(t, c.x, c.y, c.z); nrm.setXYZ(t + 1, c.x, c.y, c.z); nrm.setXYZ(t + 2, c.x, c.y, c.z);
    }
    for (const att of [pos, nrm]) { att.clearUpdateRanges(); att.addUpdateRange(t0 * 3, (t1 - t0) * 3); att.needsUpdate = true; }
  }

  /** While placing: faint rings showing where building is allowed. */
  private syncAreaRings(list: Building[]) {
    const want: [number, number, number][] = [];
    for (const b of list) {
      const d = this.rules.defs[b.kind];
      if (!d) continue;
      if (d.role === 'core') want.push([b.x, b.z, d.range ?? this.rules.buildRadius]);
      else if (d.role === 'relay' && b.progress >= 1) want.push([b.x, b.z, Math.max(d.range ?? 0, this.rules.buildRadius + d.clearance / 2)]);
      else if (b.progress >= 1) want.push([b.x, b.z, this.rules.buildRadius + d.clearance / 2]);
    }
    while (this.areaRings.length < want.length) {
      const r = new GroundRing('#9fd8ff', 0.22);
      this.details.add(r.line);
      this.areaRings.push(r);
    }
    this.areaRings.forEach((r, i) => (want[i] ? r.set(...want[i]) : r.hide()));
  }

  private syncBuildings(cur: Snapshot, t: number, ui: RegionUi, camera: THREE.Camera) {
    this.syncPads(cur.buildings);
    const seen = new Set<number>();
    let coreSeen = false;
    const charge = cur.storageMax > 0 ? cur.stored / cur.storageMax : 0;
    for (const b of cur.buildings) {
      const d = this.rules.defs[b.kind];
      // the campaign's Core is the landed probe (this.core, at the origin); a skirmish's Cores are buildings like any other
      if (b.kind === 'core' && !cur.players) { coreSeen = true; this.hpBar(b, d, ui, camera, null); continue; }
      seen.add(b.id);
      const done = b.progress >= 1;
      const pc = cur.players?.[b.team ?? 0]?.color;
      if (pc) this.teamRing(`b${b.id}`, b.x, b.z, (d?.clearance ?? 8) / 2 + 1, pc);
      let e = this.buildings.get(b.id);
      if (!e || e.done !== done) {
        if (e) this.dropBuilding(b.id, e);
        else this.flora?.clear(b.x, b.z, (d?.clearance ?? 8) / 2 + 2);
        // batched kinds: an empty placeholder (it keeps the pose for facing()); the batch draws the model
        const batch = done ? this.batchFor(b.kind) : null;
        // under construction: the real model, printed from the ground up (src/world/print.ts); ?print=0: the old scaffold
        const print = !done && this.printOn ? new Printed(this.modelFor(b.kind)) : undefined;
        if (print) print.root.userData.lod = print.root.children[0].userData.lod;
        const obj = batch ? new THREE.Group() : done ? this.modelFor(b.kind) : print ? print.root : buildScaffold();
        if (batch?.partName) {
          // the moving part keeps a stand-in so aiming and facing() work as before; the batch draws it
          const stand = new THREE.Object3D();
          stand.name = batch.partName;
          batch.partRest.decompose(stand.position, stand.quaternion, stand.scale);
          obj.add(stand);
        }
        if (!done && !print) {
          // scale the construction frame to the footprint
          const k = (d?.clearance ?? 8) / 9;
          obj.scale.set(k, 1, k * 1.6);
        }
        orient(obj, b.x, b.z, b.yaw ?? 0, 0);
        this.details.add(obj);
        if (batch) { obj.updateMatrix(); batch.set(b.id, obj.matrix); }
        const emissive: [THREE.MeshStandardMaterial, number][] = [];
        if (done) obj.traverse((o) => {
          const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (mm && 'emissiveIntensity' in mm) {
            // own copy so dimming one building doesn't dim the others
            const c = mm.clone();
            (o as THREE.Mesh).material = c;
            // another skirmish player's building: its glow in their colour
            // (only real lights: a model's body can carry a faint emissive, and tinting that paints the whole building)
            if (pc && b.team && c.emissiveIntensity > 0 && Math.max(c.emissive.r, c.emissive.g, c.emissive.b) > 0.3) c.emissive.set(pc);
            emissive.push([c, c.emissiveIntensity]);
          }
        });
        e = { kind: b.kind, done, obj, powered: true, emissive, bar: makeBar(), print };
        this.details.add(e.bar);
        this.buildings.set(b.id, e);
      }
      if (!done && e.print) e.print.set(b.progress, t);
      else if (!done) {
        const fill = e.obj.getObjectByName('fill') as THREE.Mesh;
        fill.scale.y = Math.max(0.02, b.progress);
        fill.position.y = 1.5 * Math.max(0.02, b.progress);
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 6) * 0.05;
      } else {
        // unpowered or switched off: lights go dark
        const lit = b.powered;
        if (lit !== e.powered) {
          e.powered = lit;
          for (const [mm, base] of e.emissive) mm.emissiveIntensity = lit ? base : base * 0.08;
          this.batches.get(b.kind)?.setPowered(b.id, lit);
        }
        const role = d?.role;
        if (role === 'turret' && b.aim !== undefined) {
          const head = e.obj.getObjectByName('head');
          if (head) {
            // a child's rotation.y of θ faces heading (yaw − θ), so aim → θ = yaw − aim
            let dh = (b.yaw ?? 0) - b.aim - head.rotation.y;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            head.rotation.y += dh * 0.25;
          }
        }
        if (role === 'radar' && lit) {
          const dish = e.obj.getObjectByName('dish');
          if (dish) dish.rotation.y = this.gameT * 1.2;
        }
        const batch = this.batches.get(b.kind);
        if (batch?.partName) {
          const part = e.obj.getObjectByName(batch.partName);
          if (part) {
            part.updateMatrix();
            batch.setPart(b.id, this.partM.multiplyMatrices(e.obj.matrix, part.matrix));
          }
        }
        if (role === 'battery') {
          this.batches.get(b.kind)?.setTagGlow('charge', 0.3 + charge * 3, 0.1);
          e.obj.traverse((o) => {
            if (o.name === 'charge') ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 0.3 + charge * 3 : 0.1;
          });
        }
        if (role === 'depot') this.hauler(b, cur, this.gameT);
        if (role === 'repair') {
          for (const ring of parts(e.obj, 'ring')) ring.rotation.z = lit && b.engaged ? this.gameT * 2.5 : ring.rotation.z;
        }
        if (role === 'shield' || role === 'seedbank') {
          // the projector's ring turns while its dome is up; the Seed Bank's while it works
          const on = lit && (role === 'shield' ? !b.shDown : !!b.engaged);
          for (const ring of parts(e.obj, 'ring')) if (on) ring.rotation.y = this.gameT * (role === 'shield' ? 0.9 : 0.6);
          const k = role === 'shield' && d?.shield ? 0.3 + ((b.sh ?? 0) / d.shield) * 2.4 : on ? 1.8 : 0.2;
          // (a part with two materials comes out of the glTF as a group of meshes)
          for (const c of parts(e.obj, 'charge')) c.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (m && 'emissiveIntensity' in m) m.emissiveIntensity = lit ? k : 0.1;
          });
        }
        if (role === 'medbay' || role === 'memorial') {
          // the Med Bay's beacon flashes while its crews are out; the Memorial's flame flickers
          const busy = role === 'medbay' && !!cur.people?.care?.some((c) => c.b === b.id && c.waiting > 0);
          const k = role === 'memorial' ? 2 + Math.sin(this.gameT * 9 + b.id) * 0.5 + Math.sin(this.gameT * 23) * 0.3
            : busy ? (Math.sin(this.gameT * 8) > 0 ? 3 : 0.4) : 1.2;
          for (const c of parts(e.obj, 'charge')) c.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (m && 'emissiveIntensity' in m) m.emissiveIntensity = lit || role === 'memorial' ? k : 0.1;
          });
          if (role === 'memorial') for (const c of parts(e.obj, 'charge')) c.scale.y = 1 + Math.sin(this.gameT * 7 + b.id) * 0.12;
        }
        if (role === 'geothermal') {
          for (const plume of parts(e.obj, 'plume')) { plume.visible = lit; plume.scale.set(1 + Math.sin(this.gameT * 1.7 + b.id) * 0.12, 1 + Math.sin(this.gameT * 1.1) * 0.15, 1); }
        }
        if (role === 'civic') {
          // growth pods glow while a child grows inside (pulsing red when it's failing)
          const pods = cur.people?.pods.find((p) => p.b === b.id)?.running ?? [];
          const lod = e.obj.userData.lod as Lod | undefined;
          // count pods per model: the asset and its zoomed-out built-in each have their own
          for (const root of lod ? [lod.near, lod.far] : [e.obj]) {
          let i = 0;
          root.traverse((o) => {
            if (!o.name.startsWith('gpod')) return; // built-in: 'gpod'; Blender: gpod_a, gpod_b
            const p = pods[i++];
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
            m.emissive.set(p && p.dark > 0 ? '#ff5a4a' : '#7ff7ff');
            m.emissiveIntensity = !p ? 0.15 : p.dark > 0 ? 0.6 + Math.max(0, Math.sin(this.gameT * 8)) * 2 : 1 + p.progress * 1.5 + Math.sin(this.gameT * 2 + i) * 0.3;
          });
          }
        }
        if (role === 'factory') {
          for (const door of parts(e.obj, 'door') as THREE.Mesh[]) (door.material as THREE.MeshStandardMaterial).emissiveIntensity = !lit ? 0.1 : b.queue?.length ? 1.2 + Math.max(0, Math.sin(this.gameT * 5)) * 2 : 0.5;
        }
      }
      this.hpBar(b, d, ui, camera, e.bar);
    }
    for (const [id, e] of this.buildings) {
      if (seen.has(id)) continue;
      this.dropBuilding(id, e);
      this.buildings.delete(id);
      const h = this.haulers.get(id);
      if (h) { this.details.remove(h); this.haulers.delete(id); }
    }
    this.endTeamRings();
    if (this.coreAlive !== coreSeen) {
      this.coreAlive = coreSeen;
      this.core.visible = coreSeen;
    }
  }

  private coreBar: THREE.Group | null = null;
  private hpBar(b: Building, d: BuildingLook | undefined, ui: RegionUi, camera: THREE.Camera, bar: THREE.Group | null) {
    if (!bar) {
      this.coreBar ??= makeBar();
      if (!this.coreBar.parent) this.details.add(this.coreBar);
      bar = this.coreBar;
    }
    const max = d?.hp ?? 1;
    const frac = Math.max(0, Math.min(1, b.hp / max));
    const sel = ui.sel?.kind === 'building' && ui.sel.id === b.id;
    bar.visible = b.progress >= 1 && (frac < 0.995 || sel);
    if (!bar.visible) return;
    const lift = b.kind === 'core' ? 20 : 9;
    regionToWorld(b.x, b.z, lift, bar.position);
    bar.quaternion.copy(camera.quaternion);
    const w = Math.max(4, (d?.clearance ?? 8) * 0.8);
    bar.scale.set(w, w, 1);
    const fill = bar.children[1] as THREE.Mesh;
    fill.scale.x = Math.max(0.001, frac);
    fill.position.x = -(1 - frac) / 2;
    (fill.material as THREE.MeshBasicMaterial).color.set(frac > 0.6 ? '#5bff9a' : frac > 0.3 ? '#ffb547' : '#ff5a4a');
  }

  /** Cosmetic ore hauler shuttling between a working depot and its deposit. */
  private hauler(b: Building, cur: Snapshot, t: number) {
    let h = this.haulers.get(b.id);
    const dep = b.mining !== undefined && b.mining >= 0 ? cur.deposits[b.mining] : undefined;
    const active = b.powered && dep && dep.alloys > 0;
    if (!active) { if (h) h.visible = false; return; }
    if (!h) {
      h = this.droneShell(true);
      h.scale.setScalar(0.7);
      this.haulers.set(b.id, h);
      this.details.add(h);
    }
    h.visible = true;
    const cyc = (t * 0.12 + b.id * 0.37) % 1;
    const k = smoothstep(0, 0.45, cyc) * (1 - smoothstep(0.55, 1, cyc));
    const x = lerp(b.x, dep!.x, k), z = lerp(b.z, dep!.z, k);
    const toward = cyc < 0.5;
    orient(h, x, z, Math.atan2((dep!.x - b.x) * (toward ? 1 : -1), (dep!.z - b.z) * (toward ? 1 : -1)), 4 + Math.sin(k * Math.PI) * 2);
  }

  /** Isotope seams: crystals that shrink as they're mined (a mine sits on top). */
  private syncSeams(cur: Snapshot) {
    (cur.seams ?? []).forEach((v, i) => {
      let g = this.seams[i];
      if (!g) {
        g = buildSeam(i + 1);
        if (this.fog) this.fogObj(g);
        orient(g, v.x, v.z, i * 1.3, 0);
        this.flora?.clear(v.x, v.z, 6);
        this.details.add(g);
        this.seams[i] = g;
      }
      const f = v.max > 0 ? v.isotopes / v.max : 0;
      g.visible = f > 0;
      const k = 0.4 + 0.6 * Math.sqrt(f);
      g.scale.set(k, k, k);
    });
  }

  /** The relic caches' model (an asset; a part named `seal` glows while it's shut). */
  setCacheModel(obj: THREE.Object3D | null) {
    this.cacheModel = obj;
    for (const g of this.caches) { this.dropLod(g); this.details.remove(g); }
    this.caches = [];
  }

  /** Relic caches: shown once sighted; the seal goes dark when the grid falls. */
  private syncCaches(cur: Snapshot) {
    (cur.caches ?? []).forEach((c, i) => {
      let g = this.caches[i];
      if (!g) {
        g = new THREE.Group();
        if (this.cacheModel) { const near = this.cacheModel.clone(true); g.add(near); this.lodPair(g, near, buildCache()); }
        else g.add(buildCache());
        if (this.fog) this.fogObj(g);
        orient(g, c.x, c.z, i * 1.1, 0);
        this.flora?.clear(c.x, c.z, 5);
        this.details.add(g);
        this.caches[i] = g;
      }
      g.visible = !!c.found;
      g.traverse((o) => { if (o.name.startsWith('seal')) o.visible = !c.opened; });
    });
  }

  /** The wrecks' model (an asset), replacing the built-in stand-in. */
  /** Use an asset model for worker drones and ore haulers (null = built-in); swaps the ones already flying. */
  setDroneModel(obj: THREE.Object3D | null) {
    this.droneModel = obj;
    for (const e of this.drones.values()) this.fillDrone(e.obj);
    if (![...this.drones.values()].some((e) => e.obj === this.drone)) this.fillDrone(this.drone);
    for (const h of this.haulers.values()) this.fillDrone(h, true);
  }

  private droneShell(hauler = false): THREE.Group {
    const g = new THREE.Group();
    this.fillDrone(g, hauler);
    return g;
  }

  /** (Re)fill a drone shell: the asset up close and the built-in far off, or the built-in; haulers glow amber. */
  private fillDrone(g: THREE.Group, hauler = false) {
    this.dropLod(g);
    delete g.userData.lod;
    g.clear();
    if (this.droneModel) { const near = this.droneModel.clone(true); g.add(near); this.lodPair(g, near, buildDrone()); }
    else g.add(buildDrone());
    if (hauler) g.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mm?.emissive && mm.emissiveIntensity > 1) { const c = mm.clone(); c.emissive.set(AMBER); (o as THREE.Mesh).material = c; }
    });
  }

  setWreckModel(obj: THREE.Object3D | null) {
    this.wreckModel = obj;
    for (const g of this.wrecks) { this.dropLod(g); this.details.remove(g); }
    this.wrecks = [];
  }

  /** Wrecks show once sighted; a stripped one sinks lower and darker. */
  private syncWrecks(cur: Snapshot) {
    (cur.wrecks ?? []).forEach((w, i) => {
      let g = this.wrecks[i];
      if (!g) {
        g = new THREE.Group();
        if (this.wreckModel) { const near = this.wreckModel.clone(true); g.add(near); this.lodPair(g, near, buildWreck()); }
        else g.add(buildWreck());
        if (this.fog) this.fogObj(g);
        orient(g, w.x, w.z, w.yaw, 0);
        this.flora?.clear(w.x, w.z, 7);
        this.details.add(g);
        this.wrecks[i] = g;
      }
      g.visible = !!w.found;
      const f = w.max > 0 ? w.alloys / w.max : 0;
      for (const c of g.children) c.position.y = -1.2 * (1 - f);
    });
  }

  /** Geothermal vents from the region map (static). */
  setVents(list: { x: number; z: number }[]) {
    for (const g of this.vents) this.details.remove(g);
    this.vents = list.map((v, i) => {
      const g = buildVent(i + 1);
      if (this.fog) this.fogObj(g);
      orient(g, v.x, v.z, i * 2.1, 0);
      this.flora?.clear(v.x, v.z, 6);
      g.userData = { x: v.x, z: v.z };
      this.details.add(g);
      return g;
    });
  }

  /** Vents drift their steam; a tapped vent hides under its building. */
  private animateVents(list: Building[]) {
    this.vents.forEach((g, i) => {
      const tapped = list.some((b) => this.rules.defs[b.kind]?.role === 'geothermal' && Math.hypot(b.x - g.userData.x, b.z - g.userData.z) < 6);
      g.visible = !tapped;
      const steam = g.getObjectByName('steam');
      if (steam) steam.scale.set(1 + Math.sin(this.gameT * 1.3 + i) * 0.15, 1 + Math.sin(this.gameT * 0.9 + i * 2) * 0.2, 1);
    });
  }

  private syncDeposits(cur: Snapshot) {
    cur.deposits.forEach((d, i) => {
      let g = this.deposits[i];
      if (!g) {
        g = buildDeposit(i + 1);
        if (this.fog) this.fogObj(g);
        orient(g, d.x, d.z, i * 1.7, 0);
        this.flora?.clear(d.x, d.z, 7);
        this.details.add(g);
        this.deposits[i] = g;
      }
      const f = d.max > 0 ? d.alloys / d.max : 0;
      g.visible = f > 0;
      const s = 0.35 + 0.65 * Math.sqrt(f);
      g.scale.set(s, s, s);
    });
  }
}

function makeBar(): THREE.Group {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color: '#05080d', transparent: true, opacity: 0.7, depthTest: false, fog: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.08), new THREE.MeshBasicMaterial({ color: '#5bff9a', depthTest: false, fog: false, toneMapped: false }));
  fill.position.z = 0.001;
  bg.renderOrder = 20; fill.renderOrder = 21;
  g.add(bg, fill);
  g.visible = false;
  return g;
}
