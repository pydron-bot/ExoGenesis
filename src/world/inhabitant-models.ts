/**
 * Procedural stand-ins for the Blender v4 inhabitant models (blender/build.py,
 * set v4): low-poly versions drawn when the colony camera is zoomed out (an
 * asset's `far` field), and while the Blender file is still loading. Same
 * silhouette, size and main colours as the Blender model; 140–234 triangles each.
 *
 * Front is +Z, Y up, 1 u ≈ 10 m. Coordinates below are written the way
 * blender/build.py writes them (x right, y back, z up; front −Y) and turned
 * into three's by `B`, so the two files can be read side by side.
 *
 * Each model is one mesh per material (few draw calls when a camp has several);
 * the pylon's glow band stays its own mesh named `charge`, which the game pulses.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FarModel } from '../content/defs';

/** Blender (x, y, z), front −Y, → three (x, y up, front +Z). */
const B = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const UP = new THREE.Vector3(0, 1, 0);

const solid = (color: string, metalness = 0, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });
const glow = (c: string, i: number) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: i, flatShading: true });

/** Collects parts per material and turns them into one mesh each. */
class Kit {
  private parts = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();

  constructor(private mats: Record<string, THREE.Material>) {}

  add(name: string, geo: THREE.BufferGeometry, at?: THREE.Vector3, rotY = 0, scale?: THREE.Vector3) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const m = new THREE.Matrix4().compose(
      at ?? new THREE.Vector3(),
      new THREE.Quaternion().setFromAxisAngle(UP, rotY),
      scale ?? new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = { mat: this.mats[name], geos: [] }));
    p.geos.push(g);
  }

  /** A cylinder (or cone, r2 at the top) standing on `base`, `h` tall. */
  cyl(name: string, r: number, h: number, base: THREE.Vector3, sides = 6, r2 = r, open = false, theta = 0) {
    const g = new THREE.CylinderGeometry(r2, r, h, sides, 1, open, theta);
    this.add(name, g, base.clone().add(new THREE.Vector3(0, h / 2, 0)));
  }

  /** A rod from a to b (radius r at a, r2 at b), open-ended. */
  strut(name: string, a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 4, r2 = r) {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r2, r, d.length(), sides, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
    this.add(name, g, a.clone().add(b).multiplyScalar(0.5));
  }

  box(name: string, w: number, h: number, d: number, at: THREE.Vector3, rotY = 0) {
    this.add(name, new THREE.BoxGeometry(w, h, d), at, rotY);
  }

  /** A low-poly lump: an octahedron scaled to (sx, sy, sz). */
  lump(name: string, at: THREE.Vector3, sx: number, sy: number, sz: number, rotY = 0) {
    this.add(name, new THREE.OctahedronGeometry(1), at, rotY, new THREE.Vector3(sx, sy, sz));
  }

  build(id: string, separate: string[] = []): THREE.Group {
    const root = new THREE.Group();
    root.name = id;
    for (const [name, p] of this.parts) {
      const geo = mergeGeometries(p.geos)!;
      p.geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, p.mat);
      mesh.name = separate.includes(name) ? name : `${id}-${name}`;
      root.add(mesh);
    }
    return root;
  }
}

// ---------------------------------------------------------------- the Vell (drifted humans)

function vellMats() {
  return {
    hide: solid('#8a6a4a'), cloth: solid('#4c4466', 0, 0.9), sash: solid('#a8553a'), skin: solid('#9c7a66', 0, 0.7),
    bone: solid('#d8ccb0', 0, 0.6), wood: solid('#5e4430', 0, 0.8), stone: solid('#6f6a62', 0, 0.9), dark: solid('#2a2420', 0, 0.9),
    ember: glow('#ffb547', 2.6), star: glow('#8fd8ff', 1.8),
  };
}

/** A Vell standing: wrapped shins, a long cloak, a hood with the long face in it. `h` scales the height. */
function vellBody(k: Kit, h: number, cloak: 'hide' | 'cloth') {
  for (const sx of [-1, 1]) k.box('sash', 0.2, 0.95 * h, 0.2, B(sx * 0.2, 0, 0.47 * h));
  k.cyl(cloak, 0.62, 1.9 * h, B(0, 0.08, 0.8 * h), 8, 0.32);       // long cloak
  k.cyl(cloak, 0.32, 0.5 * h, B(0, 0.04, 2.7 * h), 6, 0.2, true);  // shoulders
  k.cyl('cloth', 0.36, 0.75, B(0, 0.06, 3.25 * h), 6, 0.1);        // hood
  k.lump('skin', B(0, -0.12, 3.5 * h), 0.22, 0.3, 0.16);           // long face
  k.box('dark', 0.26, 0.07, 0.06, B(0, -0.24, 3.6 * h));          // dark eyes
}

function buildVell(): THREE.Group {
  const k = new Kit(vellMats());
  vellBody(k, 1, 'hide');
  k.strut('cloth', B(0.36, 0, 3.0), B(0.6, -0.55, 2.5), 0.09, 3, 0.07);  // arm to the staff
  k.strut('wood', B(0.62, -0.6, 0), B(0.62, -0.6, 4.6), 0.07, 3);        // staff
  k.lump('ember', B(0.62, -0.6, 4.75), 0.18, 0.2, 0.18);
  k.lump('hide', B(0, 0.5, 2.6), 0.35, 0.42, 0.22);                      // bundle on the back
  return k.build('vell');
}

function buildVellKeeper(): THREE.Group {
  const k = new Kit(vellMats());
  vellBody(k, 0.95, 'cloth');
  k.cyl('hide', 0.7, 0.35, B(0, 0.05, 2.83), 6, 0.4);                    // shawl
  k.strut('cloth', B(0.36, 0, 2.85), B(0.62, -0.3, 2.35), 0.09, 3, 0.07);
  k.strut('wood', B(0.66, -0.35, 0), B(0.7, -0.4, 3.9), 0.07, 3);        // crooked pole
  k.strut('wood', B(0.7, -0.4, 3.9), B(0.25, -0.55, 4.6), 0.06, 3);
  const hub = B(0, -0.6, 4.55);
  k.cyl('bone', 0.45, 0.07, hub.clone().setY(hub.y - 0.035), 8, 0.45, true);  // hoop
  for (let i = 0; i < 5; i++) {                                          // glowing chimes
    const a = (i / 5) * Math.PI * 2;
    const ln = 0.35 + 0.15 * (i % 3);
    k.cyl('star', 0.04, ln, hub.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, -0.15 - ln, Math.sin(a) * 0.45)), 3, 0.04, true);
  }
  return k.build('vellkeeper');
}

/** Round platform on stilts, hide wall and cone roof, a ladder at the front, an ember lantern. About 8 u across. */
function buildVellHut(): THREE.Group {
  const k = new Kit(vellMats());
  const H = 2.2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 2.6, y = Math.sin(a) * 2.6;
    k.strut('wood', B(x * 1.08, y * 1.08, 0), B(x, y, H + 0.1), 0.18, 4);
  }
  k.cyl('wood', 3.0, 0.3, B(0, 0, H), 8);                                 // floor
  k.cyl('hide', 2.55, 1.5, B(0, 0, H + 0.3), 8, 2.45, true);             // wall
  k.cyl('hide', 3.45, 3.0, B(0, 0, H + 1.65), 8, 0);                     // roof cone (out to the poles' ends)
  k.cyl('bone', 0.35, 0.6, B(0, 0, H + 4.5), 5, 0.18);                   // smoke hole cap
  k.box('dark', 0.9, 1.25, 0.2, B(0, -2.45, H + 0.95));                 // door
  for (const sx of [-1, 1]) k.strut('wood', B(sx * 0.4, -3.9, 0), B(sx * 0.4, -2.85, H + 0.3), 0.07, 3);  // ladder
  for (const t of [0.35, 0.7]) k.box('wood', 0.8, 0.09, 0.09, B(0, -3.9 + 1.05 * t, (H + 0.3) * t));
  k.lump('ember', B(1.2, -3.3, H + 1.2), 0.22, 0.25, 0.22);               // lantern
  return k.build('vellhut');
}

/** Ring of stones round the embers, three story-stones behind with glowing star marks, sitting logs. About 9 u across. */
function buildVellStones(): THREE.Group {
  const k = new Kit(vellMats());
  k.cyl('stone', 1.55, 0.35, B(0, 0, 0), 9, 1.15, true);                 // the stone ring
  k.add('dark', new THREE.CircleGeometry(1.1, 9).rotateX(-Math.PI / 2), B(0, 0, 0.1));
  k.cyl('ember', 0.8, 0.3, B(0, 0, 0.05), 6, 0.15);                     // embers
  for (const a of [0.3, 0.3 + Math.PI / 2]) {                            // sticks over the fire
    const c = Math.cos(a) * 0.7, s = Math.sin(a) * 0.7;
    k.strut('wood', B(c, s, 0.1), B(-c * 0.2, -s * 0.2, 0.7), 0.05, 3);
    k.strut('wood', B(-c, -s, 0.1), B(c * 0.2, s * 0.2, 0.7), 0.05, 3);
  }
  ([[Math.PI / 2 + 0.6, 3.4], [Math.PI / 2, 4.2], [Math.PI / 2 - 0.6, 3.0]] as const).forEach(([a, hgt]) => {
    const x = Math.cos(a) * 3.6, y = Math.sin(a) * 3.6, yaw = a + Math.PI / 2;
    k.box('stone', 1.2, hgt, 0.5, B(x, y, hgt / 2), yaw);
    k.lump('stone', B(x, y, hgt), 0.6, 0.25, 0.27, yaw);
    // star marks: a glowing stroke on the face toward the fire
    const face = B(x - Math.cos(a) * 0.26, y - Math.sin(a) * 0.26, hgt * 0.55);
    k.add('star', new THREE.PlaneGeometry(0.12, hgt * 0.5).rotateZ(0.4), face, yaw + Math.PI);
    k.add('star', new THREE.PlaneGeometry(0.2, 0.2).rotateZ(Math.PI / 4).translate(0.3, hgt * 0.22, 0), face, yaw + Math.PI);
  });
  for (let i = 0; i < 3; i++) {                                          // sitting logs, in front
    const a = -Math.PI / 2 + (i - 1) * 0.9;
    const c = B(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.22), t = B(-Math.sin(a) * 0.7, Math.cos(a) * 0.7, 0);
    k.strut('wood', c.clone().sub(t), c.clone().add(t), 0.22, 5);
  }
  return k.build('vellstones');
}

// ---------------------------------------------------------------- the Choir (machines)

function choirMats() {
  return {
    rust: solid('#7a5440', 0.55, 0.75), verd: solid('#4f8a7a', 0.5, 0.6), iron: solid('#3a3836', 0.7, 0.55),
    pale: solid('#a9a39a', 0.6, 0.6), glow: glow('#9dffc8', 2.2), dim: glow('#4fbf8a', 0.8),
  };
}

/** A tall rusted tripod carrying organ pipes, one dim eye at the front. About 8 u tall. */
function buildCantor(): THREE.Group {
  const k = new Kit(choirMats());
  const hip = B(0, 0, 4.4);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const knee = B(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 2.9), foot = B(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0);
    k.strut('rust', hip, knee, 0.16, 4, 0.12);
    k.strut('rust', knee, foot, 0.12, 4, 0.08);
  }
  k.cyl('iron', 0.75, 0.6, B(0, 0, 4.25), 6);                            // hip drum
  k.cyl('verd', 0.6, 0.5, B(0, 0, 4.8), 6, 0.7);
  const pipes = [[0, 0.15, 2.6], [0.38, 0.1, 2.1], [-0.38, 0.1, 2.3], [0.2, 0.42, 1.7], [-0.2, 0.42, 1.9], [0.55, 0.38, 1.3], [-0.55, 0.38, 1.1]];
  pipes.forEach(([x, y, ln], j) => k.cyl(j % 3 === 1 ? 'verd' : j % 3 === 2 ? 'pale' : 'rust', 0.15, ln, B(x, y, 5.3), 4, 0.15, true, Math.PI / 4));
  k.strut('iron', B(0, -0.4, 5.1), B(0, -1.0, 5.6), 0.1, 3);             // neck
  k.add('pale', new THREE.RingGeometry(0.26, 0.48, 8, 1), B(0, -1.12, 5.7));  // the eye's ring, facing front
  k.lump('dim', B(0, -1.08, 5.7), 0.26, 0.26, 0.12);
  return k.build('cantor');
}

/** A small machine on two treads with one arm and a welding glow. About 2.5 u long. */
function buildTender(): THREE.Group {
  const k = new Kit(choirMats());
  k.box('rust', 1.4, 0.7, 2.2, B(0, 0, 0.9));
  k.box('verd', 1.1, 0.35, 1.4, B(0, 0.15, 1.38));
  k.box('iron', 0.9, 0.5, 0.5, B(0, -1.2, 0.95));                        // head
  for (const sx of [-1, 1]) {
    k.lump('glow', B(sx * 0.25, -1.47, 1.05), 0.1, 0.1, 0.08);
    k.box('iron', 0.42, 0.55, 2.3, B(sx * 0.88, 0, 0.3));                // treads
    k.box('pale', 0.06, 0.32, 1.9, B(sx * 1.1, 0, 0.3));                 // their wheels
  }
  const sh = B(0.35, -0.9, 1.4), el = B(0.45, -1.7, 1.9), tip = B(0.4, -2.3, 1.1);
  k.strut('pale', sh, el, 0.09, 3);
  k.strut('pale', el, tip, 0.07, 3, 0.04);
  k.lump('glow', tip, 0.12, 0.12, 0.12);
  k.cyl('iron', 0.18, 0.5, B(-0.35, 0.6, 1.5), 5);                       // tank
  return k.build('tender');
}

/** A dead ribbed tower, its top broken off, a glow band (`charge`) round its middle. About 13 u tall. */
function buildPylon(): THREE.Group {
  const k = new Kit({ ...choirMats(), charge: glow('#9dffc8', 2.2) });
  const hex = Math.PI / 2; // three's first cylinder vertex is on +Z; Blender's is on +X
  k.cyl('iron', 3.0, 0.6, B(0, 0, 0), 6, 3.0, false, hex);
  k.cyl('rust', 2.2, 0.8, B(0, 0, 0.6), 6, 1.9, false, hex);
  k.cyl('rust', 1.7, 9.5, B(0, 0, 1.4), 6, 0.9, false, hex);
  for (let i = 0; i < 6; i++) {                                          // ribs
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    k.strut(i % 2 ? 'verd' : 'pale', B(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 1.2), B(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 10.6), 0.16, 3);
  }
  k.cyl('iron', 1.85, 0.25, B(0, 0, 1.9), 6, 1.85, true, hex);           // collars
  k.cyl('iron', 1.15, 0.25, B(0, 0, 8.9), 6, 1.15, true, hex);
  k.strut('rust', B(0.3, 0.1, 10.8), B(0.6, -0.2, 12.6), 0.35, 4, 0.02); // broken crown
  k.strut('iron', B(-0.4, 0.2, 10.8), B(-0.5, 0.3, 11.9), 0.3, 4, 0.02);
  k.strut('pale', B(0, -0.3, 10.9), B(0.4, -1.2, 13.4), 0.06, 3);        // bent antenna
  // the glow band and three glyph panels
  k.cyl('charge', 1.55, 0.35, B(0, 0, 5.03), 6, 1.55, true, hex);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    k.box('charge', 0.5, 1.2, 0.06, B(Math.cos(a) * 1.42, Math.sin(a) * 1.42, 7.0), a + Math.PI / 2);
  }
  for (let i = 0; i < 4; i++) {                                          // rubble
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.lump('rust', B(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0.05), 0.55, 0.3, 0.4, a);
  }
  return k.build('pylon', ['charge']);
}

/** The stand-ins, by built-in id (`far` on an asset record names one). */
export const STANDINS: Record<FarModel, () => THREE.Group> = {
  vell: buildVell,
  vellkeeper: buildVellKeeper,
  vellhut: buildVellHut,
  vellstones: buildVellStones,
  cantor: buildCantor,
  tender: buildTender,
  pylon: buildPylon,
};
