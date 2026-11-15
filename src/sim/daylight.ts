/**
 * The planet's day: one rotation per sol. Shared by the sim (solar output) and
 * the renderer (where the sun is), so what you see is what the panels get.
 */

/** Local time at the landing site when the game starts. */
export const START_HOUR = 7;
/** Peak sun elevation (sine) at the landing site's latitude. */
export const SUN_MAX = 0.86;

/** Hours since midnight (0..24) at sim time `secs`. */
export const hourAt = (secs: number, sol: number) => (((secs / sol) * 24 + START_HOUR) % 24 + 24) % 24;

/** Sine of the sun's elevation: SUN_MAX at noon, 0 at 06:00 and 18:00, −SUN_MAX at midnight. */
export const sunElevation = (secs: number, sol: number) => SUN_MAX * Math.sin(((hourAt(secs, sol) - 6) / 24) * Math.PI * 2);

/** 0 (night) .. 1 (full day), with a short twilight. */
export function daylight(secs: number, sol: number) {
  const e = sunElevation(secs, sol);
  const t = Math.min(1, Math.max(0, (e + 0.06) / 0.4));
  return t * t * (3 - 2 * t);
}

/**
 * Sun direction angle in the world's xz-plane for the renderer: the angle θ such
 * that (cos θ, 0, sin θ) gives the elevation above at the landing site's up
 * vector (ux, uz components).
 */
export function sunAngle(secs: number, sol: number, ux: number, uz: number) {
  const noon = Math.atan2(uz, ux);
  return noon + ((hourAt(secs, sol) - 12) / 24) * Math.PI * 2;
}
