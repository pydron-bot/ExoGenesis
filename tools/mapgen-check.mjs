/**
 * Skirmish map generator check (DESIGN §5.11 phase 2), headless: generates maps across worlds, player counts, sizes,
 * water and relief, and for each one checks in the real sim that
 *   - every base is dry and flat, and every base can reach every other by land;
 *   - every player can build a Solar Array by its Core, a depot on each of its deposits, a Deep-Core Mine on its seam
 *     and a geothermal plant on its vent;
 *   - it's fair: each base's walk to the middle and to its nearest enemy (by land) are within 25% of the others'.
 * Also times generation, and with --sheet <file.png> draws every map (height, water, bases, deposits) on one sheet.
 *   node tools/mapgen-check.mjs [--maps 36] [--sheet shots/maps.png]
 */
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
// one module graph (separate runnerImports would each get their own copy of the region state)
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const { content, planet } = M, core = M, gen = M, rules = M, pathMod = M;
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const N = Number(arg('--maps', 36)), sheet = arg('--sheet', null);

const WORLDS = ['home', 'verdance', 'dunmore', 'rime', 'cinder', 'ash'];
const WATER = ['none', 'some', 'lots'], RELIEF = ['flat', 'rolling', 'rugged'], SIZES = ['small', 'medium', 'large'];
let failed = 0, maps = 0;
const times = [];
const pics = [];
const fail = (msg) => { console.log(`FAIL  ${msg}`); failed++; };

for (let k = 0; k < N; k++) {
  const o = { seed: 1000 + k * 37, players: 2 + (k % 3), size: SIZES[Math.floor(k / 3) % 3], world: WORLDS[k % WORLDS.length], water: WATER[(k + Math.floor(k / 6)) % 3], relief: RELIEF[Math.floor(k / 4) % 3] };
  const tag = `#${k} ${o.world} ${o.players}p ${o.size} water:${o.water} ${o.relief} (seed ${o.seed})`;
  const t0 = performance.now();
  const map = gen.generateSkirmishMap(o, content.bodies);
  const ms = performance.now() - t0;
  times.push(ms);
  maps++;
  const bad = [];
  if (!map.ok) bad.push(...map.report.problems);
  // into the sim as the game will do it
  core.useRegion('skirmish', map.region);
  const sim = new core.Sim(() => {}, o.seed);
  sim.newSkirmish({ seed: o.seed, alloys: 1e6, homes: map.homes, players: map.homes.map((_, i) => ({ name: `P${i}`, color: '#fff' })) });
  const s = sim.s;
  const P = s.players.length;
  for (let t = 0; t < P; t++) {
    const h = s.players[t].home;
    const can = (kind, x, z) => sim.withTeam(t, () => rules.placeProblem(sim.world, content.buildings, content.colony, kind, x, z));
    /** Some spot within r of (x, z) where `kind` can go (what a player would find by trying). */
    const some = (kind, x, z, r) => {
      let why = 'nowhere';
      for (let rr = 0; rr <= r; rr += 1.5) for (let a = 0; a < 6.28; a += 0.3) { why = can(kind, x + Math.cos(a) * rr, z + Math.sin(a) * rr); if (!why) return null; }
      return why;
    };
    const near = (list, r) => list.filter((p) => Math.hypot(p.x - h.x, p.z - h.z) < r);
    const why = some('solar', h.x, h.z, 30);
    if (why) bad.push(`P${t}: no room for a Solar Array (${why})`);
    for (const d of near(s.deposits, 40)) {
      const w = some('depot', d.x, d.z, content.buildings.depot.range - 2);
      if (w) bad.push(`P${t}: can't mine the deposit at (${d.x}, ${d.z}): ${w}`);
    }
    for (const sm of near(s.seams, 50)) { const w = some('deepmine', sm.x, sm.z, 1.5); if (w) bad.push(`P${t}: can't mine the seam at (${sm.x}, ${sm.z}): ${w}`); }
    for (const v of near(map.region.vents, 45)) { const w = some('geothermal', v.x, v.z, 1.5); if (w) bad.push(`P${t}: can't use the vent at (${v.x}, ${v.z}): ${w}`); }
  }
  // fairness: walks by land
  const grid = new pathMod.PathGrid(planet.HALF - 6, 'ground');
  const walk = (a, b) => {
    const p = grid.find(a.x, a.z, b.x, b.z);
    if (!p) return Infinity;
    let d = 0, x = a.x, z = a.z;
    for (let i = 0; i < p.length; i += 2) { d += Math.hypot(p[i] - x, p[i + 1] - z); x = p[i]; z = p[i + 1]; }
    return d;
  };
  const toMid = map.homes.map((h) => walk(h, { x: 0, z: 0 }));
  const toFoe = map.homes.map((h, i) => Math.min(...map.homes.filter((_, j) => j !== i).map((o2) => walk(h, o2))));
  const spread = (a) => Math.max(...a) / Math.min(...a);
  if (spread(toMid) > 1.25) bad.push(`walks to the middle differ: ${toMid.map(Math.round).join(' / ')}`);
  if (spread(toFoe) > 1.25) bad.push(`walks to the nearest enemy differ: ${toFoe.map(Math.round).join(' / ')}`);
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${tag} · ${ms.toFixed(0)} ms · land ${(map.report.landShare * 100).toFixed(0)}% · tries ${map.report.tries} · to middle ${toMid.map(Math.round).join('/')} u`);
  for (const b of bad) console.log(`        ${b}`);
  if (bad.length) failed++;
  if (sheet) pics.push({ tag: `${k}`, map, s });
}
times.sort((a, b) => a - b);
console.log(`\n${maps - failed}/${maps} maps pass · generation median ${times[times.length >> 1].toFixed(0)} ms, worst ${times[times.length - 1].toFixed(0)} ms`);

// ---------- contact sheet ----------
if (sheet) {
  const cell = 200, cols = 6, rows = Math.ceil(pics.length / cols), W = cols * cell, H = rows * cell;
  const px = new Uint8Array(W * H * 3);
  const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; };
  const dot = (cx, cy, rad, c) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) put(cx + x, cy + y, ...c); };
  pics.forEach((p, idx) => {
    core.useRegion('skirmish', p.map.region);
    const half = planet.HALF, ox = (idx % cols) * cell, oy = Math.floor(idx / cols) * cell, sc = (cell - 4) / (half * 2);
    for (let y = 0; y < cell - 4; y++) for (let x = 0; x < cell - 4; x++) {
      const wx = -half + x / sc, wz = -half + y / sc, h = planet.regionHeightRaw(wx, wz);
      const hx = planet.regionHeightRaw(wx + 2, wz) - h, shade = Math.max(0.55, Math.min(1.25, 1 - hx * 0.25));
      let c;
      if (h < 0.3) c = [30, 70, 120];
      else { const t = Math.max(0, Math.min(1, h / 30)); c = [120 + t * 100, 105 + t * 90, 80 + t * 70]; }
      put(ox + 2 + x, oy + 2 + y, ...c.map((v) => Math.min(255, v * shade)));
    }
    const at = (q) => [ox + 2 + Math.round((q.x + half) * sc), oy + 2 + Math.round((q.z + half) * sc)];
    for (const d of p.s.deposits) dot(...at(d), 2, [255, 210, 80]);
    for (const sm of p.s.seams ?? []) dot(...at(sm), 2, [190, 110, 255]);
    for (const v of p.map.region.vents ?? []) dot(...at(v), 2, [255, 90, 40]);
    for (const sp of p.map.region.spawns) dot(...at(sp), 2, [220, 40, 40]);
    p.map.homes.forEach((h) => dot(...at(h), 5, [80, 230, 240]));
  });
  // PNG
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  mkdirSync(path.dirname(sheet), { recursive: true });
  writeFileSync(sheet, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log(`sheet: ${sheet}`);
}
process.exit(failed ? 1 : 0);
