#!/usr/bin/env node
/**
 * Golden determinism test: seeded sims run a fixed number of ticks and the resulting state is hashed. A refactor that
 * isn't meant to change behaviour (splitting src/sim/core.ts, moving helpers) must keep every hash. A change that is
 * meant to change behaviour (balance, content, new mechanics) updates them:
 *
 *   node tools/golden-smoke.mjs             # check against tools/golden.json
 *   node tools/golden-smoke.mjs --update    # record new hashes (say why in the commit)
 *
 * Scenarios: a fortified colony against four predator packs (units, turrets, separation, targeting), the balance
 * bot's opening on touchdown (economy, building, people, story), and a 1v1 between computer players on a generated map.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const FILE = path.join(root, 'tools/golden.json');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));

const hash = (v) => createHash('sha1').update(JSON.stringify(v, (_, x) => (typeof x === 'number' && !Number.isInteger(x) ? Number(x.toPrecision(12)) : x))).digest('hex').slice(0, 16);

function regionTerrain(id) {
  M.planet.setRegionTerrain(M.planet.regionTerrain(M.content.regions[id], M.content.bodies));
  M.useRegion(id);
}

const SCENARIOS = {
  /** 85 buildings, 35 units, 160 predators: the combat paths. */
  siege() {
    regionTerrain('touchdown');
    const sim = new M.Sim(() => {}, 1337);
    sim.command({ type: 'landing', stage: 'deploy' });
    sim.s.waves.next = 1e9;
    sim.command({ type: 'debug', alloys: 1e6 });
    const kinds = ['solar', 'turret', 'battery', 'depot', 'radar', 'bay', 'wall'];
    let placed = 0;
    for (let r = 16; r < 100 && placed < 85; r += 6) for (let a = 0; a < 6.28 && placed < 85; a += 0.35) {
      sim.s.buildings.push({ id: sim.s.nextId++, kind: kinds[placed % kinds.length], x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: 0, progress: 1, hp: 500, on: true, powered: true });
      placed++;
    }
    sim.command({ type: 'debug', units: { unit: 'rover', x: 10, z: 10, n: 20 } });
    sim.command({ type: 'debug', units: { unit: 'tank', x: -10, z: 10, n: 15 } });
    for (const [x, z] of [[100, 100], [-100, 90], [90, -100]]) sim.command({ type: 'debug', spawn: { unit: 'swarmer', x, z, n: 40 } });
    sim.command({ type: 'debug', spawn: { unit: 'brute', x: -100, z: -100, n: 15 } });
    for (let i = 0; i < 900; i++) sim.step();
    return sim.s;
  },
  /** The balance bot's first 10 minutes. */
  opening() {
    const r = M.runBalance('balanced', { minutes: 10, seed: 1337 });
    return { rows: r.rows, firsts: r.firsts, stats: r.stats, events: r.events, over: r.over };
  },
  /** Two computer players, 6 minutes. */
  skirmish() {
    const map = M.generateSkirmishMap({ seed: 21, players: 2, size: 'small', world: 'home', water: 'some', relief: 'rolling' }, M.content.bodies);
    M.useRegion('skirmish', map.region);
    const sim = new M.Sim(() => {}, 21);
    sim.newSkirmish({ seed: 21, alloys: 600, homes: map.homes, wildlife: true, players: [{ name: 'A', color: '#fff', ai: 'normal' }, { name: 'B', color: '#f00', ai: 'hard' }] });
    for (let i = 0; i < 6 * 600 && !sim.s.over; i++) sim.step();
    return sim.s;
  },
};

const update = process.argv.includes('--update');
let want = {};
try { want = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* first run */ }
const got = {};
let failed = 0;
for (const [name, run] of Object.entries(SCENARIOS)) {
  const t = performance.now();
  got[name] = hash(run());
  const ms = Math.round(performance.now() - t);
  if (update) console.log(`${name.padEnd(9)} ${got[name]}  (${ms} ms)`);
  else if (want[name] === got[name]) console.log(`PASS  ${name}: same state as recorded (${ms} ms)`);
  else { failed++; console.log(`FAIL  ${name}: state changed (${want[name] ?? 'none recorded'} → ${got[name]}). If that's intended: --update`); }
}
if (update) { writeFileSync(FILE, JSON.stringify(got, null, 2) + '\n'); console.log(`wrote ${path.relative(root, FILE)}`); }
process.exit(failed ? 1 : 0);
