/**
 * Cached height field for the landing region (1-unit grid) with bilinear
 * sampling, plus allocation-free placement helpers. Used by the skirmish sim
 * (in the worker) and by the renderer for hundreds of units per frame, where
 * evaluating the noise directly would be far too slow.
 */
import * as THREE from 'three';
import { E, HALF, N, R, U, regionHeightRaw } from './planet';

const STEP = 1;
/** Nodes per side, for the region loaded when the grid was first built (rawGrid). */
export let GRID_N = (HALF * 2) / STEP + 1;

let raw: Float32Array | null = null;

/** Raw heights (may be below sea level), row-major [z][x]. Built once, for the region loaded then. */
export function rawGrid(): Float32Array {
  if (!raw) {
    GRID_N = (HALF * 2) / STEP + 1;
    raw = new Float32Array(GRID_N * GRID_N);
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) raw[j * GRID_N + i] = regionHeightRaw(-HALF + i * STEP, -HALF + j * STEP);
    }
  }
  return raw;
}

export function sampleRaw(x: number, z: number): number {
  const g = rawGrid();
  const fx = Math.min(GRID_N - 1.001, Math.max(0, (x + HALF) / STEP));
  const fz = Math.min(GRID_N - 1.001, Math.max(0, (z + HALF) / STEP));
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const a = g[j * GRID_N + i], b = g[j * GRID_N + i + 1];
  const c = g[(j + 1) * GRID_N + i], d = g[(j + 1) * GRID_N + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Ground height (sea level clamped). */
export const sampleHeight = (x: number, z: number) => Math.max(0, sampleRaw(x, z));

/** World position of region coords without allocating. */
export function regionPoint(x: number, z: number, lift: number, out: THREE.Vector3) {
  out.set(U.x * R + E.x * x + N.x * z, U.y * R + E.y * x + N.y * z, U.z * R + E.z * x + N.z * z).normalize();
  return out.multiplyScalar(R + sampleHeight(x, z) + lift);
}

const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Instance matrix for an object standing on the ground at (x,z) facing `heading`. */
export function placeMatrix(x: number, z: number, heading: number, lift: number, scale: number, out: THREE.Matrix4) {
  _up.set(U.x * R + E.x * x + N.x * z, U.y * R + E.y * x + N.y * z, U.z * R + E.z * x + N.z * z).normalize();
  const h = R + sampleHeight(x, z) + lift;
  const s = Math.sin(heading), c = Math.cos(heading);
  _f.set(E.x * s + N.x * c, E.y * s + N.y * c, E.z * s + N.z * c);
  _f.addScaledVector(_up, -_f.dot(_up)).normalize();
  _r.crossVectors(_up, _f);
  return out.set(
    _r.x * scale, _up.x * scale, _f.x * scale, _up.x * h,
    _r.y * scale, _up.y * scale, _f.y * scale, _up.y * h,
    _r.z * scale, _up.z * scale, _f.z * scale, _up.z * h,
    0, 0, 0, 1,
  );
}
