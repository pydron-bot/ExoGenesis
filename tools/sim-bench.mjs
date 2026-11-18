/**
 * Sim tick cost, headless: a colony of ~85 buildings, 35 combat units and ~150 predators in four
 * packs, then 300 ticks with each step*() timed. Compare before/after a change (it varies ±10%).
 *   node tools/sim-bench.mjs [touchdown | coast | <region id>]
 */
import path from 'node:path';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { content } = C;
const region = process.argv[2] ?? 'touchdown';
let def = content.regions[region];
if (region === 'coast') def = { ...content.regions.touchdown, height: undefined, flora: undefined, ground: undefined, siteLat: -16, siteLon: -12, keepSea: true };
planet.setRegionTerrain(planet.regionTerrain(def, content.bodies));
core.useRegion(region === 'coast' ? 'coast' : region, region === 'coast' ? def : undefined);
const sim = new core.Sim(() => {});
// deploy and fill
sim.command({ type: 'landing', stage: 'deploy' });
sim.s.waves.next = 1e9;
sim.command({ type: 'debug', alloys: 1e6 });
const placeable = ['solar', 'turret', 'battery', 'depot', 'radar', 'bay', 'wall'];
let placed = 0;
for (let r = 16; r < 100 && placed < 90; r += 6) for (let a = 0; a < 6.28 && placed < 90; a += 0.35) {
  const kind = placeable[placed % placeable.length];
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  sim.s.buildings.push({ id: sim.s.nextId++, kind, x, z, yaw: 0, progress: 1, hp: 500, on: true, powered: true });
  placed++;
}
sim.command({ type: 'debug', units: { unit: 'rover', x: 10, z: 10, n: 20 } });
sim.command({ type: 'debug', units: { unit: 'tank', x: -10, z: 10, n: 15 } });
for (const [x, z] of [[100, 100], [-100, 90], [90, -100]]) sim.command({ type: 'debug', spawn: { unit: 'swarmer', x, z, n: 40 } });
sim.command({ type: 'debug', spawn: { unit: 'brute', x: -100, z: -100, n: 15 } });
for (let i = 0; i < 5; i++) sim.step();
// time each subsystem
const acc = {};
const proto = Object.getPrototypeOf(sim);
for (const k of Object.getOwnPropertyNames(proto)) {
  if (!/^step[A-Z]/.test(k) || k === 'step') continue;
  const f = sim[k].bind(sim);
  sim[k] = (...a) => { const t = performance.now(); const v = f(...a); acc[k] = (acc[k] ?? 0) + performance.now() - t; return v; };
}
for (const o of ['people', 'inhabitants', 'story', 'missions']) {
  const obj = sim[o]; if (!obj?.step) continue;
  const f = obj.step.bind(obj);
  obj.step = (...a) => { const t = performance.now(); const v = f(...a); acc[o] = (acc[o] ?? 0) + performance.now() - t; return v; };
}
const N = 300;
const t0 = performance.now();
let snapMs = 0;
for (let i = 0; i < N; i++) { sim.step(); if (i % 1 === 0) { const t = performance.now(); sim.snapshot?.(); snapMs += performance.now() - t; } }
const total = performance.now() - t0;
console.log(region, `buildings ${sim.s.buildings.length}, units ${sim.units.length}, hostiles ${sim.s.hostiles.length}`);
console.log(`total ${(total / N).toFixed(2)} ms/tick (incl. snapshot ${(snapMs / N).toFixed(2)})`);
for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(18)} ${(v / N).toFixed(3)} ms`);
