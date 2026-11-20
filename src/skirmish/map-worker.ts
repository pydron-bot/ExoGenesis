/**
 * The skirmish setup screen's map preview: generates the map in here (so the page's own terrain state, the title's
 * planet, is left alone) and sends back a small top-down picture plus where the bases and deposits are.
 */
import * as THREE from 'three';
import { content } from '../content';
import { regionColor, regionHeightRaw, HALF } from '../world/planet';
import { generateSkirmishMap, type MapOptions } from './mapgen';

const ctx = self as unknown as Worker;
const N = 160;

ctx.onmessage = (e: MessageEvent<{ id: number; options: MapOptions }>) => {
  const { id, options } = e.data;
  const map = generateSkirmishMap(options, content.bodies as Record<string, unknown>);
  const half = HALF, px = new Uint8ClampedArray(N * N * 4), c = new THREE.Color();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // north up: canvas row 0 is the map's +z edge
    const x = ((i + 0.5) / N * 2 - 1) * half, z = -((j + 0.5) / N * 2 - 1) * half;
    const h = regionHeightRaw(x, z);
    if (h < 0.3) c.setRGB(0.1, 0.25, 0.42);
    else {
      regionColor(x, z, c);
      // light from the north-west so the relief reads
      const s = 1 + (regionHeightRaw(x - 2, z + 2) - h) * -0.08;
      c.multiplyScalar(Math.max(0.6, Math.min(1.35, s)));
    }
    const o = (j * N + i) * 4;
    px[o] = c.r * 255; px[o + 1] = c.g * 255; px[o + 2] = c.b * 255; px[o + 3] = 255;
  }
  ctx.postMessage({
    id, n: N, half, px, homes: map.homes, ok: map.ok,
    deposits: map.region.deposits.map((d) => ({ x: d.x, z: d.z, big: d.alloys >= 5000 })),
    seams: (map.region.seams ?? []).map((v) => ({ x: v.x, z: v.z })),
  }, [px.buffer]);
};
