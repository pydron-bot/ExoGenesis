/**
 * The landing region: a detailed terrain patch laid onto the home globe, plus
 * everything the sim puts on it (Command Core, drone, buildings, fauna).
 */
import * as THREE from 'three';
import type { Building, Snapshot } from '../sim/types';
import { lerp, smoothstep } from './noise';
import { makeGroundTextures } from './terrainTex';
import { Flora } from './flora';
import {
  E, HALF, N, R, U, regionFlora, regionDir, regionHeight, regionHeightRaw, regionToWorld, terrainColor, worldToRegion,
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
  const v = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color();
  for (let j = -1; j <= n + 1; j++) {
    for (let i = -1; i <= n + 1; i++) {
      const skirt = i < 0 || j < 0 || i > n || j > n;
      const x = -HALF + Math.min(n, Math.max(0, i)) * step;
      const z = -HALF + Math.min(n, Math.max(0, j)) * step;
      const raw = regionHeightRaw(x, z);
      regionDir(x, z, d);
      v.copy(d).multiplyScalar(R + Math.max(0, raw) - (skirt ? 10 : 0));
      pos.push(v.x, v.y, v.z);
      terrainColor(raw, regionFlora(x, z), c);
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
    geo.computeVertexNormals();
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
  }
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat);
  m.name = 'region-patch';
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

export function buildCreature(): THREE.BufferGeometry {
  // low-poly six-legged grazer, merged into one geometry for instancing
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.IcosahedronGeometry(0.7, 0);
  body.scale(0.8, 0.6, 1.4);
  body.translate(0, 1.0, 0);
  const head = new THREE.ConeGeometry(0.35, 0.9, 5);
  head.rotateX(Math.PI / 2);
  head.translate(0, 1.15, 1.2);
  parts.push(body, head);
  for (const z of [-0.6, 0, 0.6]) for (const x of [-0.45, 0.45]) {
    const leg = new THREE.CylinderGeometry(0.06, 0.04, 0.9, 4);
    leg.translate(x, 0.45, z);
    parts.push(leg);
  }
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
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

export class RegionView {
  readonly patch: THREE.Mesh;
  readonly details = new THREE.Group();
  readonly drone: THREE.Group;
  readonly droneWorld = new THREE.Vector3();
  droneLocal = { x: 0, z: 0 };
  /** While true, the landing cinematic owns the drone's transform. */
  droneHeld = false;
  readonly flora: Flora | null;
  readonly core: THREE.Group;
  private faunaMesh: THREE.InstancedMesh;
  private buildings = new Map<number, { kind: 'solar'; done: boolean; obj: THREE.Group }>();
  private orderRibbon = new Ribbon(CYAN, 0.45);
  private targetRibbon = new Ribbon(CYAN, 0.18);
  private selRing: THREE.Mesh;
  private targetRing: THREE.Mesh;
  private ghost: THREE.Group;
  private border: THREE.LineLoop;
  private marker: THREE.Sprite;
  private raycaster = new THREE.Raycaster();

  constructor(scene: THREE.Scene, look: Look = 'flat', floraSeed: number | null = 1, floraDensity = 1) {
    this.patch = buildPatch(look);
    scene.add(this.patch);
    scene.add(this.details);

    this.core = buildCore();
    orient(this.core, 0, 0, 0, 0);
    this.details.add(this.core);

    this.drone = buildDrone();
    this.details.add(this.drone);

    this.flora = floraSeed === null ? null : new Flora({ seed: floraSeed, flat: look === 'flat', density: floraDensity });
    if (this.flora) this.details.add(this.flora.group);

    this.faunaMesh = new THREE.InstancedMesh(buildCreature(), new THREE.MeshStandardMaterial({
      color: '#c78a5a', roughness: 0.8, flatShading: true, emissive: '#3a1a10', emissiveIntensity: 0.4,
    }), 256);
    this.faunaMesh.count = 0;
    this.faunaMesh.frustumCulled = false;
    this.details.add(this.faunaMesh);

    const ringGeo = new THREE.RingGeometry(1.8, 2.2, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.details.add(this.selRing, this.targetRing, this.orderRibbon.mesh, this.targetRibbon.mesh);
    (this.targetRibbon.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;

    this.ghost = this.makeGhost();
    this.ghost.visible = false;
    this.details.add(this.ghost);

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

  /** Skirmish mode: keep terrain + core, hide the landing demo's drone and grazers. */
  hideLandingEntities() {
    for (const o of [this.drone, this.faunaMesh, this.selRing, this.targetRing, this.ghost, this.orderRibbon.mesh, this.targetRibbon.mesh]) o.visible = false;
    if (this.flora) this.flora.group.visible = false;
    this.details.remove(this.drone, this.faunaMesh, this.selRing, this.targetRing, this.ghost);
  }

  /** Ground point under a screen position (NDC), or null. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): { x: number; z: number } | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(this.patch, false)[0];
    if (!hit) return null;
    const p = worldToRegion(hit.point);
    if (Math.abs(p.x) > HALF - 6 || Math.abs(p.z) > HALF - 6) return null;
    return p;
  }

  update(prev: Snapshot, cur: Snapshot, alpha: number, t: number, ui: {
    selected: boolean; drag: { x: number; z: number } | null; ghost: { x: number; z: number } | null;
  }, dist: number, surface: number) {
    void surface;
    this.updateOverlay(dist, t);

    // drone (interpolated)
    const a = prev.drone, b = cur.drone;
    const x = lerp(a.x, b.x, alpha), z = lerp(a.z, b.z, alpha);
    let dh = b.heading - a.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const bob = Math.sin(t * 3) * 0.15;
    if (!this.droneHeld) orient(this.drone, x, z, a.heading + dh * alpha, 2.4 + bob);
    this.droneWorld.copy(this.drone.position);
    this.droneLocal = { x, z };

    orient(this.selRing, x, z, 0, 0.3);
    this.selRing.visible = ui.selected;
    this.selRing.scale.setScalar(1 + Math.sin(t * 5) * 0.06);

    if (b.moving && !ui.drag) {
      this.targetRing.visible = true;
      orient(this.targetRing, b.tx, b.tz, t, 0.35);
      this.targetRing.scale.setScalar(b.building ? 2.6 : 0.8 + (t % 1) * 0.6);
      this.targetRibbon.mesh.visible = Math.hypot(b.tx - x, b.tz - z) > 3;
      this.targetRibbon.set(x, z, b.tx, b.tz);
    } else {
      this.targetRing.visible = false;
      this.targetRibbon.mesh.visible = false;
    }
    this.orderRibbon.mesh.visible = !!ui.drag;
    if (ui.drag) this.orderRibbon.set(x, z, ui.drag.x, ui.drag.z);

    this.ghost.visible = !!ui.ghost;
    if (ui.ghost) orient(this.ghost, ui.ghost.x, ui.ghost.z, 0, 0);

    this.syncBuildings(cur.buildings, t);

    // fauna
    const pa = prev.fauna, pb = cur.fauna;
    const n = pb.length / 3;
    this.faunaMesh.count = n;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const fx = lerp(pa[i * 3], pb[i * 3], alpha), fz = lerp(pa[i * 3 + 1], pb[i * 3 + 1], alpha);
      let fh = pb[i * 3 + 2] - pa[i * 3 + 2];
      fh = Math.atan2(Math.sin(fh), Math.cos(fh));
      orient(tmp, fx, fz, pa[i * 3 + 2] + fh * alpha, 0);
      q.copy(tmp.quaternion);
      m.compose(tmp.position, q, s.setScalar(1 + (i % 5) * 0.12));
      this.faunaMesh.setMatrixAt(i, m);
    }
    this.faunaMesh.instanceMatrix.needsUpdate = true;
  }

  private models: { solar?: THREE.Object3D } = {};

  /** Swap a building's built-in model for an asset model (null = back to built-in). */
  setBuildingModel(kind: 'solar', obj: THREE.Object3D | null) {
    if (obj) this.models[kind] = obj; else delete this.models[kind];
    const vis = this.ghost.visible;
    this.details.remove(this.ghost);
    this.ghost = this.makeGhost();
    this.ghost.visible = vis;
    this.details.add(this.ghost);
    for (const e of this.buildings.values()) {
      if (e.kind !== kind || !e.done) continue;
      const next = this.solarModel();
      next.position.copy(e.obj.position);
      next.quaternion.copy(e.obj.quaternion);
      this.details.remove(e.obj);
      this.details.add(next);
      e.obj = next;
    }
  }

  private solarModel(): THREE.Group {
    const m = this.models.solar;
    if (!m) return buildSolar();
    const g = new THREE.Group();
    g.add(m.clone(true));
    return g;
  }

  private makeGhost(): THREE.Group {
    const g = this.solarModel();
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, depthWrite: false });
    });
    return g;
  }

  private syncBuildings(list: Building[], t: number) {
    const seen = new Set<number>();
    for (const b of list) {
      if (b.kind !== 'solar') continue;
      seen.add(b.id);
      const done = b.progress >= 1;
      let entry = this.buildings.get(b.id);
      if (!entry || entry.done !== done) {
        if (entry) this.details.remove(entry.obj);
        else this.flora?.clear(b.x, b.z, 6.5);
        const obj = done ? this.solarModel() : buildScaffold();
        orient(obj, b.x, b.z, 0, 0);
        this.details.add(obj);
        entry = { kind: 'solar', done, obj };
        this.buildings.set(b.id, entry);
      }
      if (!done) {
        const fill = entry.obj.getObjectByName('fill') as THREE.Mesh;
        fill.scale.y = Math.max(0.02, b.progress);
        fill.position.y = 1.5 * Math.max(0.02, b.progress);
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 6) * 0.05;
      }
    }
    for (const [id, e] of this.buildings) {
      if (!seen.has(id)) { this.details.remove(e.obj); this.buildings.delete(id); }
    }
  }
}
