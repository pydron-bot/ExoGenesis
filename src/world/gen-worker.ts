/**
 * Load-time generation off the main thread: the globe's geometry and the
 * province layout (the two heaviest pure-maths steps at startup). The main
 * thread builds the solar system, flora and landing patch meanwhile, then turns
 * these arrays into meshes.
 */
import { globeArrays, setRegionTerrain } from './planet';
import { provinceData } from './provinces';

export interface GenRequest { look: 'flat' | 'smooth'; region: { height?: string[]; flora?: string[] } }

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const { look, region } = e.data;
  setRegionTerrain(region); // the globe follows the sculpted patch near the landing site
  const t0 = performance.now();
  const globe = globeArrays(look);
  const t1 = performance.now();
  const prov = provinceData(globe);
  const t2 = performance.now();
  const transfer = [globe.position.buffer, globe.color.buffer, globe.normal.buffer, prov.tris.buffer, prov.borders.buffer, prov.fillPos.buffer, prov.fillCol.buffer];
  if (globe.index) transfer.push(globe.index.buffer);
  (self as unknown as Worker).postMessage({ globe, prov, ms: { globe: t1 - t0, provinces: t2 - t1 } }, transfer as Transferable[]);
};
