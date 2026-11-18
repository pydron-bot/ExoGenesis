/**
 * Skirmish simulation (proof of concept): hundreds of units with flow-field
 * pathfinding, separation, target acquisition and combat, against escalating
 * waves of fauna heading for the Command Core. Runs at a fixed tick in a Web
 * Worker; state is structure-of-arrays so it stays fast at 1000+ units.
 */
import { HALF, regionTerrain, setRegionTerrain } from '../world/planet';
import { content } from '../content';
import { GRID_N, rawGrid } from '../world/heightGrid';
import {
  DEFS, FX, FX_STRIDE, MAX_UNITS, SK_TICK_HZ, SK_TICK_MS, STRIDE, UT,
  type SkFromWorker, type SkSnapshot, type SkToWorker,
} from './types';

const ctx = self as unknown as Worker;
setRegionTerrain(regionTerrain(content.regions.touchdown, content.bodies));
const DT = 1 / SK_TICK_HZ;

// ---------- navigation grid ----------
const CELL = 2;
const G = (HALF * 2) / CELL; // 120 x 120
const CORE_R = 10;
const blocked = new Uint8Array(G * G);
const cellOf = (x: number, z: number) => {
  const i = Math.min(G - 1, Math.max(0, Math.floor((x + HALF) / CELL)));
  const j = Math.min(G - 1, Math.max(0, Math.floor((z + HALF) / CELL)));
  return j * G + i;
};
const cellX = (c: number) => -HALF + (c % G) * CELL + CELL / 2;
const cellZ = (c: number) => -HALF + Math.floor(c / G) * CELL + CELL / 2;

function buildNav() {
  const g = rawGrid();
  const h = (x: number, z: number) => g[Math.round(z + HALF) * GRID_N + Math.round(x + HALF)];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
      const hs = [h(x0, z0), h(x0 + CELL, z0), h(x0, z0 + CELL), h(x0 + CELL, z0 + CELL)];
      const lo = Math.min(...hs), hi = Math.max(...hs);
      const c = j * G + i;
      const water = (hs[0] + hs[1] + hs[2] + hs[3]) / 4 <= 0.4;
      const steep = hi - lo > 3.2;
      const edge = i < 2 || j < 2 || i >= G - 2 || j >= G - 2;
      const core = Math.hypot(cellX(c), cellZ(c)) < CORE_R - 1;
      blocked[c] = water || steep || edge || core ? 1 : 0;
    }
  }
}

/** Dijkstra flow field toward a set of goal cells; dir = unit vector per cell. */
class FlowField {
  // Float64: with Float32, stored costs round up past the float64 costs in the heap,
  // so equal-cost paths keep "improving" and re-expanding (heap blew up to millions)
  dist = new Float64Array(G * G);
  dir = new Float32Array(G * G * 2);
  refs = 0;
  constructor(readonly key: number, goals: number[]) {
    const dist = this.dist;
    dist.fill(Infinity);
    // binary heap of [cost, cell]
    const heapC: number[] = [], heapV: number[] = [];
    const push = (c: number, v: number) => {
      heapC.push(c); heapV.push(v);
      let i = heapC.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapC[p] <= heapC[i]) break;
        [heapC[p], heapC[i]] = [heapC[i], heapC[p]];
        [heapV[p], heapV[i]] = [heapV[i], heapV[p]];
        i = p;
      }
    };
    const pop = () => {
      const c = heapC[0], v = heapV[0];
      const lc = heapC.pop()!, lv = heapV.pop()!;
      if (heapC.length) {
        heapC[0] = lc; heapV[0] = lv;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heapC.length && heapC[l] < heapC[m]) m = l;
          if (r < heapC.length && heapC[r] < heapC[m]) m = r;
          if (m === i) break;
          [heapC[m], heapC[i]] = [heapC[i], heapC[m]];
          [heapV[m], heapV[i]] = [heapV[i], heapV[m]];
          i = m;
        }
      }
      return [c, v];
    };
    for (const g of goals) { dist[g] = 0; push(0, g); }
    while (heapC.length) {
      const [c, v] = pop();
      if (c > dist[v]) continue;
      const i = v % G, j = (v - i) / G;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const n = nj * G + ni;
        if (blocked[n]) continue;
        // no corner cutting
        if (di && dj && (blocked[j * G + ni] || blocked[nj * G + i])) continue;
        const nc = c + (di && dj ? 1.4142 : 1);
        if (nc < dist[n]) { dist[n] = nc; push(nc, n); }
      }
    }
    // directions: toward the lowest neighbour (blocked cells point out to open ground)
    for (let v = 0; v < G * G; v++) {
      const i = v % G, j = (v - i) / G;
      let best = dist[v], bx = 0, bz = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const d = dist[nj * G + ni] + (di && dj ? 0.0001 : 0);
        if (d < best) { best = d; bx = di; bz = dj; }
      }
      const l = Math.hypot(bx, bz) || 1;
      this.dir[v * 2] = bx / l;
      this.dir[v * 2 + 1] = bz / l;
    }
  }
}

let enemyField: FlowField;
const orderFields = new Map<number, FlowField>();
function orderField(goal: number) {
  let f = orderFields.get(goal);
  if (!f) {
    // goal + its open neighbourhood so crowds have somewhere to stand
    const goals: number[] = [];
    const gi = goal % G, gj = (goal - gi) / G;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const n = (gj + dj) * G + gi + di;
      if (n >= 0 && n < G * G && !blocked[n]) goals.push(n);
    }
    f = new FlowField(goal, goals.length ? goals : [goal]);
    orderFields.set(goal, f);
  }
  return f;
}

// ---------- units (structure of arrays) ----------
const ux = new Float32Array(MAX_UNITS), uz = new Float32Array(MAX_UNITS);
const vx = new Float32Array(MAX_UNITS), vz = new Float32Array(MAX_UNITS);
const head = new Float32Array(MAX_UNITS);
const utype = new Uint8Array(MAX_UNITS);
const hp = new Float32Array(MAX_UNITS);
const cd = new Float32Array(MAX_UNITS);
const gen = new Uint16Array(MAX_UNITS);
const alive = new Uint8Array(MAX_UNITS);
const target = new Int32Array(MAX_UNITS).fill(-1);
const order = new Int32Array(MAX_UNITS).fill(-1); // flow field goal cell, -1 = none
const orderX = new Float32Array(MAX_UNITS), orderZ = new Float32Array(MAX_UNITS);
const orderN = new Float32Array(MAX_UNITS); // group size, for arrival radius
const free: number[] = [];
let slots = 0;

// spatial hash
const HC = 6;
const HG = Math.ceil((HALF * 2) / HC);
const hHead = new Int32Array(HG * HG);
const hNext = new Int32Array(MAX_UNITS);
const hcell = (x: number, z: number) =>
  Math.min(HG - 1, Math.max(0, Math.floor((z + HALF) / HC))) * HG + Math.min(HG - 1, Math.max(0, Math.floor((x + HALF) / HC)));

function rebuildHash() {
  hHead.fill(-1);
  for (let i = 0; i < slots; i++) {
    if (!alive[i]) continue;
    const c = hcell(ux[i], uz[i]);
    hNext[i] = hHead[c];
    hHead[c] = i;
  }
}

function forNear(x: number, z: number, r: number, fn: (j: number) => void) {
  const i0 = Math.max(0, Math.floor((x - r + HALF) / HC)), i1 = Math.min(HG - 1, Math.floor((x + r + HALF) / HC));
  const j0 = Math.max(0, Math.floor((z - r + HALF) / HC)), j1 = Math.min(HG - 1, Math.floor((z + r + HALF) / HC));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    for (let k = hHead[j * HG + i]; k !== -1; k = hNext[k]) fn(k);
  }
}

// ---------- state ----------
let rng = 1234567;
const rnd = () => {
  let t = (rng = (rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let tick = 0, speed = 1;
let coreHp = 1000, wave = 0, nextWave = 8, kills = 0, lost = 0, waveSize = 60, simMs = 0;
const fx: number[] = [];

function spawn(type: number, x: number, z: number) {
  const s = free.length ? free.pop()! : slots < MAX_UNITS ? slots++ : -1;
  if (s < 0) return -1;
  const d = DEFS[type];
  ux[s] = x; uz[s] = z; vx[s] = vz[s] = 0;
  head[s] = rnd() * Math.PI * 2;
  utype[s] = type; hp[s] = d.hp; cd[s] = rnd() * d.cooldown;
  gen[s] = (gen[s] + 1) & 0xffff; alive[s] = 1;
  target[s] = -1; order[s] = -1;
  return s;
}

function kill(s: number) {
  alive[s] = 0;
  fx.push(utype[s] === UT.Brute || utype[s] === UT.Tank ? FX.DIE_BIG : FX.DIE_SMALL, ux[s], uz[s], 0, 0);
  if (DEFS[utype[s]].team === 1) kills++; else lost++;
  free.push(s);
}

function openNear(x: number, z: number) {
  for (let r = 0; r < 30; r += 2) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!blocked[cellOf(px, pz)]) return [px, pz];
    }
  }
  return null;
}

function reset(units: number, ws: number) {
  alive.fill(0); free.length = 0; slots = 0; orderFields.clear();
  coreHp = 1000; wave = 0; nextWave = 8; kills = 0; lost = 0; waveSize = ws; tick = 0;
  // army in rings around the core, ~70% rovers / 30% tanks
  let placed = 0, ring = 0;
  while (placed < units && ring < 40) {
    const r = CORE_R + 4 + ring * 3.2;
    const n = Math.floor((2 * Math.PI * r) / 3.2);
    for (let k = 0; k < n && placed < units; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.37;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (blocked[cellOf(x, z)]) continue;
      const s = spawn(placed % 10 < 7 ? UT.Rover : UT.Tank, x, z);
      if (s >= 0) head[s] = Math.atan2(x, z);
      placed++;
    }
    ring++;
  }
  event(`Skirmish: ${placed} units deployed. First wave in ${nextWave}s.`);
}

function spawnWave(count: number) {
  wave++;
  // pick an open spot on a random edge
  for (let tries = 0; tries < 40; tries++) {
    const side = Math.floor(rnd() * 4), t = (rnd() * 2 - 1) * (HALF - 20);
    const e = HALF - 10;
    const [x, z] = side === 0 ? [t, -e] : side === 1 ? [e, t] : side === 2 ? [t, e] : [-e, t];
    if (enemyField.dist[cellOf(x, z)] === Infinity) continue;
    let n = 0;
    for (let k = 0; k < count * 3 && n < count; k++) {
      const px = x + (rnd() - 0.5) * 30, pz = z + (rnd() - 0.5) * 30;
      if (blocked[cellOf(px, pz)] || enemyField.dist[cellOf(px, pz)] === Infinity) continue;
      if (spawn(n % 8 === 7 ? UT.Brute : UT.Swarmer, px, pz) < 0) break;
      n++;
    }
    event(`Wave ${wave}: ${n} hostiles from the ${['south', 'east', 'north', 'west'][side]}`, 'warn');
    return;
  }
}

function event(text: string, level: 'info' | 'warn' | 'bad' = 'info') {
  ctx.postMessage({ type: 'event', text, level } satisfies SkFromWorker);
}

// ---------- step ----------
function acquire(s: number, range: number, team: number) {
  let best = -1, bd = range * range;
  const x = ux[s], z = uz[s];
  forNear(x, z, range, (j) => {
    if (DEFS[utype[j]].team === team) return;
    const dx = ux[j] - x, dz = uz[j] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = j; }
  });
  return best;
}

function damage(j: number, amount: number) {
  if (!alive[j]) return;
  hp[j] -= amount;
  if (hp[j] <= 0) kill(j);
}

function step() {
  tick++;
  rebuildHash();
  const phase = tick % 3;

  for (let s = 0; s < slots; s++) {
    if (!alive[s]) continue;
    const d = DEFS[utype[s]];
    const x = ux[s], z = uz[s];
    let wx = 0, wz = 0; // desired velocity
    cd[s] -= DT;

    // targeting (staggered)
    if (s % 3 === phase || (target[s] >= 0 && !alive[target[s]])) {
      target[s] = acquire(s, d.team === 0 ? (order[s] >= 0 ? d.range : d.aggro) : d.aggro, d.team);
    }
    const t = target[s];
    let engaged = false;
    if (t >= 0 && alive[t]) {
      const dx = ux[t] - x, dz = uz[t] - z, dist = Math.hypot(dx, dz);
      const reach = d.range + DEFS[utype[t]].radius + d.radius * 0.5;
      if (dist <= reach) {
        engaged = true;
        head[s] = Math.atan2(dx, dz);
        if (cd[s] <= 0) {
          cd[s] = d.cooldown * (0.85 + rnd() * 0.3);
          if (d.splash) {
            forNear(ux[t], uz[t], d.splash, (j) => {
              if (DEFS[utype[j]].team !== d.team && Math.hypot(ux[j] - ux[t], uz[j] - uz[t]) <= d.splash!) damage(j, j === t ? d.dmg : d.dmg * 0.5);
            });
          } else damage(t, d.dmg);
          fx.push(utype[s] === UT.Rover ? FX.ROVER_SHOT : utype[s] === UT.Tank ? FX.TANK_SHOT : FX.BITE, x, z, ux[t], uz[t]);
        }
      } else if (d.team === 1 || order[s] < 0) {
        // chase: enemies always, idle player units within aggro
        wx = (dx / dist) * d.speed; wz = (dz / dist) * d.speed;
      }
    }

    if (!engaged && wx === 0 && wz === 0) {
      if (d.team === 0 && order[s] >= 0) {
        const odx = orderX[s] - x, odz = orderZ[s] - z;
        if (Math.hypot(odx, odz) < 2.5 + Math.sqrt(orderN[s]) * 1.3) {
          order[s] = -1;
        } else {
          const f = orderFields.get(order[s]);
          if (f) { const c = cellOf(x, z); wx = f.dir[c * 2] * d.speed; wz = f.dir[c * 2 + 1] * d.speed; }
          else order[s] = -1;
        }
      } else if (d.team === 1) {
        if (Math.hypot(x, z) < CORE_R + 2) {
          engaged = true;
          head[s] = Math.atan2(-x, -z);
          if (cd[s] <= 0) {
            cd[s] = d.cooldown;
            coreHp = Math.max(0, coreHp - d.dmg * 0.5);
            fx.push(FX.CORE_HIT, x, z, 0, 0);
          }
        } else {
          const c = cellOf(x, z);
          wx = enemyField.dir[c * 2] * d.speed; wz = enemyField.dir[c * 2 + 1] * d.speed;
        }
      }
    }

    // separation
    let sx = 0, sz = 0;
    forNear(x, z, 3, (j) => {
      if (j === s) return;
      const dx = x - ux[j], dz = z - uz[j];
      const min = d.radius + DEFS[utype[j]].radius;
      const dd = dx * dx + dz * dz;
      if (dd < min * min && dd > 1e-6) {
        const dist = Math.sqrt(dd);
        const push = (min - dist) / min;
        sx += (dx / dist) * push; sz += (dz / dist) * push;
      }
    });
    // smooth acceleration
    vx[s] += (wx - vx[s]) * 0.5;
    vz[s] += (wz - vz[s]) * 0.5;
    let nx = x + (vx[s] + sx * 6) * DT, nz = z + (vz[s] + sz * 6) * DT;
    if (blocked[cellOf(nx, nz)] && !blocked[cellOf(x, z)]) {
      // slide along walls
      if (!blocked[cellOf(nx, z)]) nz = z;
      else if (!blocked[cellOf(x, nz)]) nx = x;
      else { nx = x; nz = z; }
    }
    ux[s] = nx; uz[s] = nz;
    if (!engaged) {
      const sp = Math.hypot(vx[s], vz[s]);
      if (sp > 0.5) {
        let dh = Math.atan2(vx[s], vz[s]) - head[s];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        head[s] += dh * 0.35;
      }
    }
  }

  // waves
  nextWave -= DT;
  if (nextWave <= 0) {
    spawnWave(Math.round(waveSize * (1 + wave * 0.25)));
    nextWave = 28;
  }
  // drop unused order fields
  if (tick % 20 === 0) {
    const used = new Set<number>();
    for (let s = 0; s < slots; s++) if (alive[s] && order[s] >= 0) used.add(order[s]);
    for (const k of orderFields.keys()) if (!used.has(k)) orderFields.delete(k);
  }
  if (coreHp <= 0 && tick % 50 === 0) event('Command Core destroyed', 'bad');
}

function snapshot() {
  const buf = new Float32Array(slots * STRIDE);
  let players = 0, enemies = 0;
  for (let s = 0; s < slots; s++) {
    const o = s * STRIDE;
    buf[o] = ux[s]; buf[o + 1] = uz[s]; buf[o + 2] = head[s];
    buf[o + 3] = utype[s]; buf[o + 4] = Math.max(0, hp[s] / DEFS[utype[s]].hp);
    buf[o + 5] = gen[s]; buf[o + 6] = alive[s];
    if (alive[s]) { if (DEFS[utype[s]].team === 0) players++; else enemies++; }
  }
  const fxa = new Float32Array(fx);
  fx.length = 0;
  const snap: SkSnapshot = {
    type: 'snap', tick, slots, units: buf, fx: fxa, coreHp, wave, nextWave, kills, lost, players, enemies, simMs,
  };
  ctx.postMessage(snap, [buf.buffer, fxa.buffer]);
}

ctx.onmessage = (e: MessageEvent<SkToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'move': {
      const goal = cellOf(m.x, m.z);
      const ok = !blocked[goal] ? goal : (() => { const p = openNear(m.x, m.z); return p ? cellOf(p[0], p[1]) : -1; })();
      if (ok < 0) return;
      orderField(ok);
      const gx = cellX(ok), gz = cellZ(ok);
      for (const s of m.slots) {
        if (s < 0 || s >= slots || !alive[s] || DEFS[utype[s]].team !== 0) continue;
        order[s] = ok; orderX[s] = gx; orderZ[s] = gz; orderN[s] = m.slots.length; target[s] = -1;
      }
      return;
    }
    case 'stop':
      for (const s of m.slots) if (s >= 0 && s < slots) { order[s] = -1; vx[s] = vz[s] = 0; }
      return;
    case 'wave':
      spawnWave(m.count);
      return;
    case 'speed':
      speed = m.speed;
      return;
    case 'reset':
      reset(m.units, m.waveSize);
      snapshot();
      return;
  }
};

const tNav = performance.now();
buildNav();
{
  const goals: number[] = [];
  for (let c = 0; c < G * G; c++) {
    const r = Math.hypot(cellX(c), cellZ(c));
    if (!blocked[c] && r >= CORE_R - 1 && r < CORE_R + 3) goals.push(c);
  }
  enemyField = new FlowField(-1, goals);
  console.log(`[sk] nav + flow field ready in ${(performance.now() - tNav).toFixed(0)} ms`);
}
void FX_STRIDE;

let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  let stepped = false;
  while (acc >= SK_TICK_MS) {
    acc -= SK_TICK_MS;
    for (let i = 0; i < speed; i++) {
      const t0 = performance.now();
      step();
      simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
      stepped = true;
    }
  }
  if (stepped) snapshot();
}, SK_TICK_MS / 2);
