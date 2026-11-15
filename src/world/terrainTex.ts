/**
 * Procedural, tileable ground detail textures (albedo + normal map), generated
 * at startup on a canvas so the demo needs no image assets. The albedo is near
 * white and multiplies the terrain's vertex colours, so biome colouring still
 * comes from the height/flora rules; the texture adds grain, pebbles and cracks.
 */
import * as THREE from 'three';

const SIZE = 512;

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise: tiles every `period` lattice cells. */
function pnoise(x: number, y: number, period: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(ix), w(iy), s), b = hash(w(ix + 1), w(iy), s);
  const c = hash(w(ix), w(iy + 1), s), d = hash(w(ix + 1), w(iy + 1), s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function pfbm(u: number, v: number, base: number, oct: number, s: number) {
  let sum = 0, amp = 1, norm = 0, p = base;
  for (let i = 0; i < oct; i++) {
    sum += pnoise(u * p, v * p, p, s + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Tileable Worley-ish distance field for pebbles. */
function cells(u: number, v: number, n: number, s: number) {
  const x = u * n, y = v * n;
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + hash(wx, wy, s), py = cy + hash(wx, wy, s + 1);
    best = Math.min(best, Math.hypot(px - x, py - y));
  }
  return best;
}

export function makeGroundTextures(): { map: THREE.Texture; normalMap: THREE.Texture; mean: number } {
  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const grain = pfbm(u, v, 32, 3, 1);
      const broad = pfbm(u, v, 4, 3, 7);
      const peb = 1 - Math.min(1, cells(u, v, 18, 3) * 2.2); // raised pebble bumps
      const crack = Math.abs(pfbm(u, v, 6, 3, 11) - 0.5) < 0.012 ? -0.35 : 0;
      height[y * SIZE + x] = broad * 0.45 + grain * 0.25 + Math.max(0, peb) ** 2 * 0.5 + crack;
    }
  }
  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];

  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = SIZE;
  const normal = document.createElement('canvas');
  normal.width = normal.height = SIZE;
  const ai = albedo.getContext('2d')!.createImageData(SIZE, SIZE);
  const ni = normal.getContext('2d')!.createImageData(SIZE, SIZE);
  const strength = 3.2;
  let sum = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const h = at(x, y);
      // near-white albedo: darker in cracks and hollows, lighter on pebble tops
      const l = Math.max(0, Math.min(1, 0.78 + h * 0.3));
      sum += l;
      ai.data[i] = l * 255; ai.data[i + 1] = l * 250; ai.data[i + 2] = l * 244; ai.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      ni.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      ni.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      ni.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
    }
  }
  albedo.getContext('2d')!.putImageData(ai, 0, 0);
  normal.getContext('2d')!.putImageData(ni, 0, 0);

  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.generateMipmaps = true;
  }
  // average brightness: what the texture looks like from far away (its smallest mip)
  return { map, normalMap, mean: sum / (SIZE * SIZE) };
}
