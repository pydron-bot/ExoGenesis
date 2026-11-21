/**
 * Renders the skirmish: one instanced draw per unit type (plus a glow layer for
 * player units), selection rings, health bars, tracers, impact flashes and
 * explosions — all pooled and allocation-free per frame so hundreds of units
 * stay cheap.
 *
 * Level of detail: asset models (the Blender set, 500–900 triangles a unit)
 * only draw when the camera is close; zoomed out, the built-in meshes (a few
 * dozen triangles) stand in, where a unit is a few pixels anyway. Measured on
 * 350 units at phone size, the models alone doubled the frame's triangles.
 */
import * as THREE from 'three';
import { placeMatrix, regionPoint, sampleRaw } from '../world/heightGrid';
import { WATER_LIFT } from '../world/water';
import { flattenForInstancing, loadModel, splitPart } from '../assets/models';
import { builtinUnitLook } from './models';
import { content } from '../content';
import { DEFS, FX, FX_STRIDE, MAX_UNITS, STRIDE, F, type SkSnapshot } from './types';
import { colonyLights } from '../world/lights';
import { BattleFx } from './fx';

/** Camera distance below which asset models draw (hysteresis: switch back beyond LOD_FAR). */
export const LOD_NEAR = 90, LOD_FAR = 105; // the colony's default view is 75, the skirmish's 150

/** Health bars: camera-facing quads drawn in one instanced call; the fill comes from aHp. */
const barVert = /* glsl */ `
  attribute float aHp;
  attribute float aTeam;
  varying vec2 vUv;
  varying float vHp;
  varying float vTeam;
  void main() {
    vUv = uv; vHp = aHp; vTeam = aTeam;
    float w = length(instanceMatrix[0].xyz);
    vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    c.xy += position.xy * vec2(w, w * 0.16);
    gl_Position = projectionMatrix * c;
  }`;
const barFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vHp;
  varying float vTeam;
  void main() {
    // dark frame, 1 px-ish inset fill
    float inX = step(0.04, vUv.x) * step(vUv.x, 0.96), inY = step(0.2, vUv.y) * step(vUv.y, 0.8);
    float f = (vUv.x - 0.04) / 0.92;
    vec3 col = vTeam > 0.5 ? vec3(1.0, 0.36, 0.29)
      : vHp > 0.6 ? vec3(0.36, 1.0, 0.6) : vHp > 0.3 ? vec3(1.0, 0.71, 0.28) : vec3(1.0, 0.35, 0.29);
    if (inX * inY > 0.5 && f <= vHp) gl_FragColor = vec4(col, 1.0);
    else gl_FragColor = vec4(0.02, 0.03, 0.05, 0.75);
  }`;

/** Flyers cruise this high over the ground (or the water), plus up to 2 u by slot so a flock isn't flat. */
const FLY_HEIGHT = 9;

const C = {
  glow: new THREE.Color('#5ff3ff'), glowSel: new THREE.Color('#ffd27a'), white: new THREE.Color('#e9eef2'), hurt: new THREE.Color('#ff5a4a'),
  hit: new THREE.Color('#fff4e0'),
};
/** How long a unit glows after it's hit (s). */
const HIT_GLOW = 0.14;
/** How fast a turret swings (radians/s). */
const TURRET_SLEW = 6;
interface Turret { mesh: THREE.InstancedMesh; pivot: THREE.Vector3 }
/** Unit types that are creatures (fauna) rather than machines. */
const ORGANIC = DEFS.map((d) => (content.units[d.id]?.faction === 'fauna' ? 1 : 0));

export class ArmyView {
  /** Interpolated per-slot world positions this frame (for screen-space picking). */
  readonly wx = new Float32Array(MAX_UNITS);
  readonly wy = new Float32Array(MAX_UNITS);
  readonly wz = new Float32Array(MAX_UNITS);
  readonly lx = new Float32Array(MAX_UNITS);
  readonly lz = new Float32Array(MAX_UNITS);
  /** Interpolated heading per slot (headlights). */
  readonly hd = new Float32Array(MAX_UNITS);
  readonly visible = new Uint8Array(MAX_UNITS);
  /** Height above the ground per slot this frame: flyers' shadows fall away from them, shots go up to them. */
  readonly lift = new Float32Array(MAX_UNITS);
  /** Flyers' bank angle per slot (eased toward the turn they're in). */
  private bank = new Float32Array(MAX_UNITS);
  private roll = new THREE.Matrix4();
  readonly type = new Uint8Array(MAX_UNITS);
  private counts = new Int32Array(DEFS.length);
  slots = 0;
  private bodies: THREE.InstancedMesh[] = [];
  private glows: (THREE.InstancedMesh | null)[] = [];
  /** Asset model per type once loaded (drawn instead of the built-in when the camera is close). */
  private models: (THREE.InstancedMesh | null)[] = [];
  private near = true;
  private bars: THREE.InstancedMesh;
  private aHp: THREE.InstancedBufferAttribute;
  private aTeam: THREE.InstancedBufferAttribute;
  private rings: THREE.InstancedMesh;
  /** Projectiles, sparks, smoke, shockwaves and scorch marks. */
  readonly fx: BattleFx;
  /** Per slot: seconds of hit glow left. */
  private hit = new Float32Array(MAX_UNITS);
  /** Per slot: 1 if the unit last drawn there was a creature (its death splatters rather than burns). */
  private creature = new Uint8Array(MAX_UNITS);
  /** Turrets (a part drawn apart from the hull, turned toward the target), per type: the built-in's and the model's. */
  private bTur: (Turret | null)[] = [];
  private mTur: (Turret | null)[] = [];
  /** Per slot: the turret's world yaw now (eased toward the aim), and the unit generation it belongs to. */
  private tyaw = new Float32Array(MAX_UNITS);
  private tgen = new Float32Array(MAX_UNITS).fill(-1);
  private tm = new THREE.Matrix4();
  private lastTick = -1;
  private clock = 0;
  private m = new THREE.Matrix4();
  private v1 = new THREE.Vector3();
  private col = new THREE.Color();
  /** Skirmish: each player's colour (index = team); units of players other than 0 are drawn in theirs. */
  private teamCols: THREE.Color[] = [];
  /** How tall the building at (x, z) is (flyers climb over it); set by whoever draws the buildings. */
  roof?: (x: number, z: number) => number;
  private cruise = new Float32Array(MAX_UNITS);
  setTeamColors(colors: string[]) {
    if (this.teamCols.length === colors.length && colors.every((c, i) => '#' + this.teamCols[i].getHexString() === c.toLowerCase())) return;
    this.teamCols = colors.map((c) => new THREE.Color(c));
  }
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    colonyLights?.addArmy(this, (t) => DEFS[t]?.team ?? 1, (t) => (DEFS[t]?.radius ?? 1) * (DEFS[t]?.scale ?? 1));
    // one instanced draw per unit type, plus a glow layer for types that have one (player vehicles)
    for (const d of DEFS) {
      const look = builtinUnitLook(d.id, d.team === 0 ? 'accord' : 'fauna');
      const im = new THREE.InstancedMesh(look.geo(), look.material(), MAX_UNITS);
      im.count = 0;
      im.frustumCulled = false;
      if (d.team === 0) im.setColorAt(0, C.white);
      this.group.add(im);
      this.bodies.push(im);
      this.bTur.push(look.turret ? this.turretMesh(look.turret.geo(), im.material, new THREE.Vector3(...look.turret.pivot), d.team === 0) : null);
      if (look.glow) {
        const g = new THREE.InstancedMesh(look.glow(), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), MAX_UNITS);
        g.count = 0;
        g.frustumCulled = false;
        g.setColorAt(0, C.glow);
        this.group.add(g);
        this.glows.push(g);
      } else this.glows.push(null);
    }
    // asset models draw instead of the built-ins up close (the glow strips belong to the built-ins)
    this.models = DEFS.map(() => null);
    this.mTur = DEFS.map(() => null);
    DEFS.forEach((d, t) => {
      if (!d.model) return;
      loadModel(d.model).then((root) => {
        // a part named "turret" turns on its own (the model's own origin for it is the pivot)
        const tur = splitPart(root, 'turret');
        if (tur) {
          const f = flattenForInstancing(tur.part);
          this.mTur[t] = this.turretMesh(f.geometry, f.materials, tur.pivot, d.team === 0);
        }
        const { geometry, materials } = flattenForInstancing(root);
        const im = new THREE.InstancedMesh(geometry, materials, MAX_UNITS);
        im.count = 0;
        im.frustumCulled = false;
        if (d.team === 0) im.setColorAt(0, C.white);
        this.group.add(im);
        this.models[t] = im;
      }, (e) => console.warn(`unit model ${d.model!.file} failed to load; keeping the built-in`, e));
    });
    const barGeo = new THREE.PlaneGeometry(1, 1);
    this.aHp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_UNITS), 1).setUsage(THREE.DynamicDrawUsage);
    this.aTeam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_UNITS), 1).setUsage(THREE.DynamicDrawUsage);
    barGeo.setAttribute('aHp', this.aHp);
    barGeo.setAttribute('aTeam', this.aTeam);
    this.bars = new THREE.InstancedMesh(barGeo, new THREE.ShaderMaterial({
      vertexShader: barVert, fragmentShader: barFrag, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }), MAX_UNITS);
    this.bars.count = 0;
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 20;
    this.group.add(this.bars);
    const ring = new THREE.RingGeometry(1.5, 1.85, 24).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false }), MAX_UNITS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.group.add(this.rings);

    this.fx = new BattleFx(this.group);
  }

  private turretMesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pivot: THREE.Vector3, player: boolean): Turret {
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_UNITS);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.setColorAt(0, player ? C.white : this.col.setRGB(1, 1, 1));
    this.group.add(mesh);
    return { mesh, pivot };
  }

  /**
   * `camDist`: the camera's orbit distance, for the model level of detail (omitted = always models).
   * Health bars show on damaged units and on selected ones.
   */
  update(prev: SkSnapshot, cur: SkSnapshot, alpha: number, selected: Map<number, number>, dt: number, camDist = 0) {
    const a = prev.units, b = cur.units;
    this.clock += dt;
    const counts = this.counts.fill(0);
    let rings = 0, bars = 0;
    this.near = camDist < (this.near ? LOD_FAR : LOD_NEAR);
    const near = this.near;
    this.slots = cur.slots;
    const prevSlots = prev.slots;
    for (let s = 0; s < cur.slots; s++) {
      const o = s * STRIDE;
      this.visible[s] = 0;
      if (!b[o + F.ALIVE]) { this.cruise[s] = 0; continue; }
      const t = b[o + F.TYPE];
      let x = b[o], z = b[o + 1], h = b[o + 2], turn = 0;
      if (s < prevSlots && a[o + F.ALIVE] && a[o + F.GEN] === b[o + F.GEN]) {
        x = a[o] + (x - a[o]) * alpha;
        z = a[o + 1] + (z - a[o + 1]) * alpha;
        let dh = h - a[o + 2];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        h = a[o + 2] + dh * alpha;
        turn = dh;
      }
      const scale = DEFS[t].scale;
      // hover craft ride on the water (and bob a little), boats sit in it (rocking gently), flyers fly high
      // (bobbing slowly, banking into turns), others stand on the ground
      let lift = 0;
      const mv = DEFS[t].move;
      if (mv) {
        const g = sampleRaw(x, z);
        const sea = Math.max(0, WATER_LIFT - Math.max(0, g));
        if (mv === 'air') {
          // cruise height, or higher over a tall building (climbing to it quickly, easing back down after)
          const cruise = sea + FLY_HEIGHT + (s % 5) * 0.5, want = Math.max(cruise, (this.roof?.(x, z) ?? 0) + 2.5);
          const was = this.cruise[s] > 0 ? this.cruise[s] : want;
          this.cruise[s] = was + (want - was) * Math.min(1, dt * (want > was ? 6 : 1.5));
        }
        lift = mv === 'air' ? this.cruise[s] + 0.35 * Math.sin(this.clock * 1.1 + s * 1.9)
          : mv === 'hover' ? sea + 0.15 + 0.08 * Math.sin(this.clock * 2.3 + s * 1.7) : sea - 0.25 + 0.06 * Math.sin(this.clock * 1.4 + s * 2.1);
      }
      this.lift[s] = lift;
      placeMatrix(x, z, h, lift, scale, this.m);
      if (mv === 'air') {
        // right turns (heading growing) dip the right wing: a negative roll about the nose
        const want = -Math.max(-0.6, Math.min(0.6, turn * 2.2));
        this.bank[s] += (want - this.bank[s]) * Math.min(1, dt * 4);
        this.m.multiply(this.roll.makeRotationZ(this.bank[s]));
      } else this.bank[s] = 0;
      const i = counts[t]++;
      const model = near ? this.models[t] : null;
      const body = model ?? this.bodies[t];
      body.setMatrixAt(i, this.m);
      // the turret: seated on its pivot on the hull, swinging toward the aim at a turret's pace
      const tur = model ? this.mTur[t] : this.bTur[t];
      if (tur) {
        const aim = b[o + F.AIM];
        if (this.tgen[s] !== b[o + F.GEN]) { this.tgen[s] = b[o + F.GEN]; this.tyaw[s] = aim; }
        let d = aim - this.tyaw[s];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.tyaw[s] += Math.max(-TURRET_SLEW * dt, Math.min(TURRET_SLEW * dt, d));
        this.v1.copy(tur.pivot).applyMatrix4(this.m);
        placeMatrix(x, z, this.tyaw[s], lift, scale, this.tm).setPosition(this.v1);
        tur.mesh.setMatrixAt(i, this.tm);
      }
      this.lx[s] = x; this.lz[s] = z; this.hd[s] = h;
      this.wx[s] = this.m.elements[12]; this.wy[s] = this.m.elements[13]; this.wz[s] = this.m.elements[14];
      this.visible[s] = 1;
      this.type[s] = t;
      const hp = b[o + F.HP];
      const owner = b[o + F.TEAM] | 0, tc = owner ? this.teamCols[owner] : undefined;
      // another skirmish player's unit counts as hostile here (red bar, never selected)
      const team = owner ? 1 : DEFS[t].team;
      const sel = team === 0 && selected.get(s) === b[o + F.GEN];
      // a unit that was just hit flashes bright for a moment
      if (this.hit[s] > 0) this.hit[s] = Math.max(0, this.hit[s] - dt);
      const hk = this.hit[s] / HIT_GLOW;
      this.creature[s] = !tc && ORGANIC[t] ? 1 : 0;
      if (tc) {
        body.setColorAt(i, this.flashed(this.col.copy(tc).multiplyScalar(1.5).lerp(C.hurt, Math.max(0, 1 - hp * 1.3) * 0.6), hk));
        const g = model ? null : this.glows[t];
        if (g) { g.setMatrixAt(i, this.m); g.setColorAt(i, tc); }
      } else if (team === 1) {
        body.setColorAt(i, this.flashed(this.col.setRGB(1, 1, 1), hk));
      } else {
        body.setColorAt(i, this.flashed(this.col.copy(C.hurt).lerp(C.white, Math.min(1, hp * 1.3)), hk));
        const g = model ? null : this.glows[t];
        if (g) { g.setMatrixAt(i, this.m); g.setColorAt(i, sel ? C.glowSel : C.glow); }
        if (sel) {
          placeMatrix(x, z, 0, 0.25 + (mv === 'air' ? lift : 0), DEFS[t].radius * 1.1, this.m);
          this.rings.setMatrixAt(rings++, this.m);
        }
      }
      if (tur) tur.mesh.setColorAt(i, this.col); // the hull's colour (set just above), hit flash and all
      if (hp < 0.995 || sel) {
        const r = DEFS[t].radius;
        regionPoint(x, z, r * 1.3 + 1.6 + (mv === 'air' ? lift : 0), this.v1);
        const w = Math.max(1.8, r * 2.2);
        this.m.makeScale(w, w, w).setPosition(this.v1);
        this.bars.setMatrixAt(bars, this.m);
        this.aHp.array[bars] = Math.max(0, Math.min(1, hp));
        this.aTeam.array[bars] = team;
        bars++;
      }
    }
    this.bars.count = bars;
    if (bars) { this.bars.instanceMatrix.needsUpdate = true; this.aHp.needsUpdate = true; this.aTeam.needsUpdate = true; }
    for (let t = 0; t < DEFS.length; t++) {
      const model = this.models[t];
      const useModel = near && !!model;
      const im = useModel ? model! : this.bodies[t];
      im.count = counts[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      const idle = useModel ? this.bodies[t] : model;
      if (idle) idle.count = 0;
      const tOn = useModel ? this.mTur[t] : this.bTur[t], tOff = useModel ? this.bTur[t] : this.mTur[t];
      if (tOn) {
        tOn.mesh.count = counts[t];
        tOn.mesh.instanceMatrix.needsUpdate = true;
        if (tOn.mesh.instanceColor) tOn.mesh.instanceColor.needsUpdate = true;
      }
      if (tOff) tOff.mesh.count = 0;
      const g = this.glows[t];
      if (g) {
        g.count = useModel ? 0 : counts[t];
        g.instanceMatrix.needsUpdate = true;
        if (g.instanceColor) g.instanceColor.needsUpdate = true;
      }
    }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;

    if (cur.tick !== this.lastTick) {
      this.lastTick = cur.tick;
      this.spawnFx(cur.fx);
    }
    this.fx.update(dt);
  }

  private flashed(c: THREE.Color, k: number) {
    return k > 0 ? c.lerp(C.hit, k * 0.7).multiplyScalar(1 + 1.8 * k) : c;
  }

  /** The live unit nearest (x, z) within 1.6 u, or −1. */
  private slotAt(x: number, z: number) {
    let best = -1, bd = 1.6 * 1.6;
    for (let s = 0; s < this.slots; s++) {
      if (!this.visible[s]) continue;
      const dx = this.lx[s] - x, dz = this.lz[s] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Was the unit that just died at (x, z) a creature? (Its slot is no longer drawn, but remembers where it was.) */
  private creatureDied(x: number, z: number) {
    let best = -1, bd = 2.5 * 2.5;
    for (let s = 0; s < this.slots; s++) {
      if (this.visible[s]) continue;
      const dx = this.lx[s] - x, dz = this.lz[s] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    return best >= 0 && this.creature[best] === 1;
  }

  private spawnFx(fx: Float32Array) {
    for (let i = 0; i < fx.length; i += FX_STRIDE) {
      const k = fx[i], x1 = fx[i + 1], z1 = fx[i + 2], x2 = fx[i + 3], z2 = fx[i + 4];
      // flyers at either end: shots go up to them
      const a = this.slotAt(x1, z1), b = k === FX.DIE_SMALL || k === FX.DIE_BIG || k === FX.EMERGE ? -1 : this.slotAt(x2, z2);
      const h1 = a >= 0 && DEFS[this.type[a]].move === 'air' ? this.lift[a] : 0;
      const h2 = b >= 0 && DEFS[this.type[b]].move === 'air' ? this.lift[b] : 0;
      if (b >= 0 && k !== FX.REPAIR) this.hit[b] = HIT_GLOW;
      colonyLights?.fx(k, x1, z1, x2, z2);
      const organic = (k === FX.DIE_SMALL || k === FX.DIE_BIG) && this.creatureDied(x1, z1);
      this.fx.spawn(k, x1, z1, x2, z2, h1, h2, organic);
    }
  }
}
