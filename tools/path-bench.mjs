/**
 * Unit movement around buildings, headless: builds a packed base (and a walled yard with one gate),
 * orders groups of each ground unit type across it, and reports how many got where they were sent,
 * how many gave up short (stuck), and how long they took.
 *   node tools/path-bench.mjs [--seed 1] [--verbose]
 * Exit code 1 if any unit gave up short or never arrived.
 */
import path from 'node:path';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { content } = C;
const verbose = process.argv.includes('--verbose');

planet.setRegionTerrain(planet.regionTerrain(content.regions.touchdown, content.bodies));
core.useRegion('touchdown');

function fresh() {
  const sim = new core.Sim(() => {});
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  sim.command({ type: 'debug', alloys: 1e7 });
  for (const n of sim.s.nests ?? []) n.alive = 0;
  sim.s.hostiles.length = 0;
  return sim;
}
function finish(sim) { for (const b of sim.s.buildings) { b.progress = 1; b.hp = content.buildings[b.kind].hp; } }
function place(sim, kind, x, z, yaw) {
  const n = sim.s.buildings.length;
  sim.command({ type: 'build', kind, x, z, yaw });
  finish(sim);
  return sim.s.buildings.length > n;
}
/** Pack buildings in rings round the core, as tight as placement allows. */
function packedBase(sim, rings = 70) {
  const kinds = ['solar', 'battery', 'turret', 'habitat', 'depot', 'radar', 'lab', 'hydroponics', 'bay'];
  let k = 0;
  for (let r = 14; r < rings; r += 3) for (let a = 0; a < Math.PI * 2; a += 0.12) {
    if (place(sim, kinds[k % kinds.length], Math.cos(a) * r, Math.sin(a) * r)) k++;
  }
  return k;
}
/** Buildings on a grid with lanes of mixed width between them (3, 5 and 8 u). */
function laneBase(sim) {
  const kinds = ['solar', 'battery', 'habitat', 'depot', 'lab', 'hydroponics', 'turret', 'radar'];
  const lanes = [3, 5, 8, 3, 5];
  let k = 0, z = -70;
  for (let row = 0; z < 70; row++) {
    let x = -70;
    const cl = 10, gz = lanes[row % lanes.length];
    for (let col = 0; x < 70; col++) {
      if (Math.hypot(x, z) > 14 && place(sim, kinds[k % kinds.length], x, z)) k++;
      x += cl + lanes[(col + row) % lanes.length];
    }
    z += cl + gz;
  }
  return k;
}
/** A square of wall round (cx, cz) with half-size h and a gate in the middle of the south side. */
function walledYard(sim, cx, cz, h) {
  const c = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = c[i], [x2, z2] = c[(i + 1) % 4];
    sim.command({ type: 'buildLine', kind: 'wall', x1, z1, x2, z2 });
    finish(sim);
  }
  sim.command({ type: 'build', kind: 'gate', x: cx, z: cz - h, yaw: Math.PI / 2 });
  finish(sim);
}

function spawn(sim, unit, x, z, n) {
  const before = new Set(sim.units.map((u) => u.id));
  sim.command({ type: 'debug', units: { unit, x, z, n } });
  return sim.units.filter((u) => !before.has(u.id)).map((u) => u.id);
}

/** Order the ids to (x, z), run up to `secs`, and score them. */
function run(sim, ids, x, z, secs) {
  sim.command({ type: 'order', ids, x, z });
  const want = new Map(sim.units.filter((u) => ids.includes(u.id)).map((u) => [u.id, [u.order.x, u.order.z]]));
  // where each can actually get: the end of its path (sent somewhere walled off, the nearest it can reach)
  const blds = sim.s.buildings.filter((b) => content.buildings[b.kind].role !== 'gate').map((b) => ({ x: b.x, z: b.z, r: content.buildings[b.kind].clearance / 2 }));
  const reach = new Map();
  for (const u of sim.units) if (want.has(u.id)) {
    const g = sim.unitGrid(content.units[u.unit].move ?? 'ground');
    g.setBodies(blds, 1.4);
    const [wx, wz] = want.get(u.id), p = g.find(u.x, u.z, wx, wz);
    reach.set(u.id, p?.length ? [p[p.length - 2], p[p.length - 1]] : [wx, wz]);
  }
  const done = new Map();
  const T = secs * 10;
  for (let t = 0; t < T && done.size < ids.length; t++) {
    sim.step();
    for (const u of sim.units) if (want.has(u.id) && !done.has(u.id) && u.order.kind === 'idle') done.set(u.id, t);
  }
  let ok = 0, short = 0, never = 0, ticks = 0;
  const bad = [];
  for (const id of ids) {
    const u = sim.units.find((q) => q.id === id), [wx, wz] = want.get(id);
    // sent into a building: count as there if it's within the building's reach of the spot
    const [rx, rz] = reach.get(id);
    const d = Math.min(Math.hypot(u.x - wx, u.z - wz), Math.hypot(u.x - rx, u.z - rz));
    if (!done.has(id)) { never++; bad.push(`${u.unit}#${id} still going ${d.toFixed(1)}u out`); continue; }
    if (d > 4) { short++; bad.push(`${u.unit}#${id} gave up ${d.toFixed(1)}u short at (${u.x.toFixed(0)},${u.z.toFixed(0)})`); continue; }
    ok++; ticks += done.get(id);
  }
  return { ok, short, never, avg: ok ? ticks / ok / 10 : 0, bad };
}

const TYPES = Object.entries(content.units)
  .filter(([, u]) => u.faction === 'accord' && u.speed > 0 && (u.move ?? 'ground') !== 'water' && u.move !== 'air' && !u.rescues && !u.repairRate)
  .map(([id]) => id).sort();

const scenarios = [
  {
    name: 'across a packed base',
    setup: (sim) => packedBase(sim),
    from: [-90, -90], to: [90, 90], n: 12, secs: 120,
  },
  {
    name: 'into the middle of a packed base',
    setup: (sim) => packedBase(sim),
    from: [-90, 90], to: [0, 0], n: 12, secs: 120,
  },
  {
    name: 'through a base with lanes',
    setup: (sim) => laneBase(sim),
    from: [-95, -95], to: [95, 95], n: 12, secs: 120,
  },
  {
    name: 'into a base with lanes',
    setup: (sim) => laneBase(sim),
    from: [-95, 95], to: [20, -20], n: 12, secs: 120,
  },
  {
    name: 'a big group into a base with lanes',
    setup: (sim) => laneBase(sim),
    from: [-95, 95], to: [20, -20], n: 30, secs: 150,
  },
  {
    name: 'onto a building (spots inside it)',
    setup: (sim) => laneBase(sim),
    from: [-95, 95], to: null, n: 20, secs: 120,
  },
  {
    name: 'out of a walled yard by its gate',
    setup: (sim) => { packedBase(sim, 30); walledYard(sim, 60, 60, 22); },
    from: [60, 66], to: [60, 110], n: 12, secs: 120,
  },
  {
    name: 'into a walled yard by its gate',
    setup: (sim) => { packedBase(sim, 30); walledYard(sim, 60, 60, 22); },
    from: [60, 110], to: [60, 66], n: 12, secs: 120,
  },
];

let total = 0, failed = 0;
for (const sc of scenarios) {
  for (const unit of TYPES) {
    const sim = fresh();
    const nb = sc.setup(sim);
    const ids = spawn(sim, unit, sc.from[0], sc.from[1], sc.n);
    if (!ids.length) { console.log(`SKIP  ${sc.name} · ${unit}: couldn't spawn`); continue; }
    const lab = sim.s.buildings.find((b) => b.kind === 'lab' && Math.hypot(b.x, b.z) > 30);
    const [tx, tz] = sc.to ?? [lab.x, lab.z];
    const r = run(sim, ids, tx, tz, sc.secs);
    total += ids.length; failed += r.short + r.never;
    const tag = r.short + r.never ? 'FAIL' : 'PASS';
    console.log(`${tag}  ${sc.name} · ${unit.padEnd(9)} ${r.ok}/${ids.length} arrived, ${r.short} gave up short, ${r.never} still going · avg ${r.avg.toFixed(1)} s${nb ? ` · ${sim.s.buildings.length} buildings` : ''}`);
    if (verbose) for (const b of r.bad) console.log('      ' + b);
  }
}
console.log(`\n${total - failed}/${total} units got there (${failed} stuck or short)`);
process.exit(failed ? 1 : 0);
