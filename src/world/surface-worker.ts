/**
 * Bakes the planet's surface maps (surface.ts) after startup, off the main
 * thread, so the extra detail from orbit costs nothing at load time.
 */
import { setRegionTerrain, type RegionTerrain } from './planet';
import { bakeSurface } from './surface';

self.onmessage = (e: MessageEvent<{ region: RegionTerrain }>) => {
  setRegionTerrain(e.data.region); // the map follows the sculpted landing patch
  const t0 = performance.now();
  const m = bakeSurface();
  (self as unknown as Worker).postMessage({ ...m, ms: performance.now() - t0 }, [m.color.buffer, m.height.buffer]);
};
