/**
 * Bakes the planet's surface maps (surface.ts) after startup, off the main
 * thread, so the extra detail from orbit costs nothing at load time.
 */
import { setRegionTerrain } from './planet';
import { bakeSurface } from './surface';

self.onmessage = (e: MessageEvent<{ region: { height?: string[]; flora?: string[] } }>) => {
  setRegionTerrain(e.data.region); // the map follows the sculpted landing patch
  const t0 = performance.now();
  const m = bakeSurface();
  (self as unknown as Worker).postMessage({ ...m, ms: performance.now() - t0 }, [m.color.buffer, m.height.buffer]);
};
