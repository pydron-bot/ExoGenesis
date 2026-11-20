/**
 * One continuous zoom from the landing site out to the whole solar system.
 *
 * Distance is eased in log space. Two blend factors drive everything else:
 *   surf→planet (a): the focus point slides from the ground to the planet centre
 *   planet→system (b): the focus slides on to the star and "up" swings from the
 *                      landing site's normal to the ecliptic pole.
 */
import * as THREE from 'three';
import { smoothstep, lerp } from './world/noise';
import { E, HALF, HOME_RADIUS, R, U, regionHeight, regionToWorld, worldToRegion } from './world/planet';

export const MIN_DIST = 14;
export const MAX_DIST = 1.6e6;

export const VIEWS = {
  surface: { dist: 75, pitch: 0.85 },
  planet: { dist: 9500, pitch: 0.9 },
  system: { dist: 1.05e6, pitch: 0.75 },
} as const;
export type ViewName = keyof typeof VIEWS;
/** The planet view and the surface→planet blend were tuned on Home; smaller bodies scale them down. */
export const bodyScale = () => Math.max(0.08, R / HOME_RADIUS);
/** A view's distance on the body being played. */
export const viewDist = (v: ViewName) => (v === 'planet' ? VIEWS.planet.dist * bodyScale() : VIEWS[v].dist);

const Y = new THREE.Vector3(0, 1, 0);

export class ZoomCamera {
  dist: number = VIEWS.surface.dist;
  targetDist: number = VIEWS.surface.dist;
  yaw = 0.4;
  pitch: number = 0.85;
  targetPitch: number = 0.85;
  fx = 0;
  fz = -8;
  /** surface → planet blend */
  a = 0;
  /** planet → system blend */
  b = 0;
  readonly focus = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Cinematic hooks (landing sequence): look at this point instead, with weight 0..1. */
  readonly focusOverride = new THREE.Vector3();
  overrideW = 0;
  /** Cinematic: honour `pitch` exactly instead of tilting to top-down as we climb. */
  freePitch = false;
  /** Camera shake amplitude in world units; decays on its own. */
  shake = 0;
  /** Where the focus is gliding to (centre on selection, control groups); a pan or jump cancels it. */
  private glide: { x: number; z: number } | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  zoomBy(f: number) {
    this.targetDist = THREE.MathUtils.clamp(this.targetDist * f, MIN_DIST, MAX_DIST);
  }

  setView(v: ViewName, instant = false) {
    this.targetDist = viewDist(v);
    this.targetPitch = VIEWS[v].pitch;
    if (instant) { this.dist = this.targetDist; this.pitch = this.targetPitch; }
  }

  rotate(dyaw: number, dpitch: number) {
    this.yaw += dyaw;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dpitch, 0.3, 1.42);
    this.pitch = this.targetPitch;
  }

  /** Put the ground focus here at once (clamped to the region). */
  lookAtGround(x: number, z: number) {
    this.glide = null;
    this.fx = THREE.MathUtils.clamp(x, -HALF + 10, HALF - 10);
    this.fz = THREE.MathUtils.clamp(z, -HALF + 10, HALF - 10);
  }

  /** Glide the ground focus to here over a moment. */
  glideTo(x: number, z: number) {
    this.glide = { x: THREE.MathUtils.clamp(x, -HALF + 10, HALF - 10), z: THREE.MathUtils.clamp(z, -HALF + 10, HALF - 10) };
  }

  /** Pan the ground focus by a screen-space drag (pixels). */
  pan(dx: number, dy: number, viewportH: number) {
    this.glide = null;
    const k = (this.dist * 1.1) / viewportH;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // in region coords: forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw)
    this.fx += (-dx * cy + dy * sy / Math.max(0.4, Math.sin(this.pitch))) * k;
    this.fz += (dx * sy + dy * cy / Math.max(0.4, Math.sin(this.pitch))) * k;
    this.fx = THREE.MathUtils.clamp(this.fx, -HALF + 10, HALF - 10);
    this.fz = THREE.MathUtils.clamp(this.fz, -HALF + 10, HALF - 10);
  }

  update(dt: number, starPos: THREE.Vector3) {
    const k = 1 - Math.exp(-dt * 6);
    if (this.glide) {
      const g = this.glide, kg = 1 - Math.exp(-dt * 7);
      this.fx += (g.x - this.fx) * kg;
      this.fz += (g.z - this.fz) * kg;
      if (Math.hypot(g.x - this.fx, g.z - this.fz) < 0.05) { this.fx = g.x; this.fz = g.z; this.glide = null; }
    }
    this.dist = Math.exp(lerp(Math.log(this.dist), Math.log(this.targetDist), k));
    if (Math.abs(this.dist - this.targetDist) / this.targetDist < 1e-4) this.dist = this.targetDist;
    this.pitch = lerp(this.pitch, this.targetPitch, k);

    const d = this.dist;
    const bk = bodyScale();
    this.a = smoothstep(150 * Math.min(1, bk * 2), 5000 * bk, d);
    this.b = smoothstep(25000, 320000, d);

    // focus point
    const ground = regionToWorld(this.fx, this.fz, 0);
    // stay anchored over the base while climbing; only drift partway toward the planet centre
    this.focus.copy(ground).lerp(new THREE.Vector3(), this.a * 0.45).lerp(starPos, this.b);
    if (this.overrideW > 0) this.focus.lerp(this.focusOverride, this.overrideW);

    // frame
    const up = new THREE.Vector3().copy(U).lerp(Y, this.b).normalize();
    const ef = new THREE.Vector3().copy(E).addScaledVector(up, -E.dot(up)).normalize();
    const nf = new THREE.Vector3().crossVectors(up, ef);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.fwd.copy(ef).multiplyScalar(sy).addScaledVector(nf, cy);
    this.right.copy(ef).multiplyScalar(cy).addScaledVector(nf, -sy);

    // over the planet, tilt toward looking straight down at the landing site
    let p = this.pitch;
    if (!this.freePitch) {
      p = lerp(this.pitch, Math.max(this.pitch, 1.2), this.a);
      p = lerp(p, Math.max(this.pitch, 0.6), this.b);
    }
    const dir = new THREE.Vector3().copy(up).multiplyScalar(Math.sin(p)).addScaledVector(this.fwd, -Math.cos(p));

    const cam = this.camera;
    cam.position.copy(this.focus).addScaledVector(dir, d);

    // never dip below the terrain near the surface
    if (this.a < 0.9) {
      const loc = worldToRegion(cam.position);
      if (Math.abs(loc.x) < HALF && Math.abs(loc.z) < HALF) {
        const min = R + regionHeight(loc.x, loc.z) + 3;
        if (cam.position.length() < min) cam.position.setLength(min);
      } else if (cam.position.length() < R + 60) {
        cam.position.setLength(R + 60);
      }
    }
    cam.up.copy(up);
    cam.lookAt(this.focus);
    if (this.shake > 0.01) {
      const s = this.shake;
      cam.position.addScaledVector(this.right, (Math.random() - 0.5) * s).addScaledVector(up, (Math.random() - 0.5) * s);
      this.shake *= Math.exp(-dt * 5);
    } else this.shake = 0;
    cam.near = THREE.MathUtils.clamp(d * 0.01, 0.2, 200);
    cam.far = 1.2e7;
    cam.updateProjectionMatrix();
  }

  /** The unit vector from the focus out to the camera for a yaw/pitch/distance (as update() frames it, with freePitch). */
  viewDir(yaw: number, pitch: number, dist: number, out = new THREE.Vector3()) {
    const b = smoothstep(25000, 320000, dist);
    const up = new THREE.Vector3().copy(U).lerp(Y, b).normalize();
    const ef = new THREE.Vector3().copy(E).addScaledVector(up, -E.dot(up)).normalize();
    const nf = new THREE.Vector3().crossVectors(up, ef);
    const fwd = ef.multiplyScalar(Math.sin(yaw)).addScaledVector(nf, Math.cos(yaw));
    return out.copy(up).multiplyScalar(Math.sin(pitch)).addScaledVector(fwd, -Math.cos(pitch));
  }

  /** Altitude above the home planet's surface, in world units. */
  altitude() {
    return Math.max(0, this.camera.position.length() - R);
  }
}
