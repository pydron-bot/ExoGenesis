/**
 * The landing probe's descent (src/landing.ts), as a pure function so the
 * editor's cinematic preview can follow it without building the landing.
 */
export const A0 = 2600; // entry altitude (units; ~26 km)
const H0 = 1500; // downrange offset at entry
const APPROACH = Math.PI; // comes in from the -z side, toward the drone bay

/** The probe in region terms at time `t`, touching down at `touchdown` s. */
export function probePath(touchdown: number, t: number) {
  const u = Math.min(1, Math.max(0, t / Math.max(0.1, touchdown)));
  const alt = A0 * Math.pow(1 - u, 3);
  const h = H0 * Math.pow(1 - u, 4);
  return { x: Math.sin(APPROACH) * h, z: Math.cos(APPROACH) * h, alt };
}
