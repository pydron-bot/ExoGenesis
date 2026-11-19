/**
 * Med Bay and Memorial (headless, the real sim):
 *  - people thrown out of a fallen Habitat Block next to a powered Med Bay are stabilised (their clock
 *    stops) and brought in one at a time, fully healed; out of its Range they die as before;
 *  - a Medevac takes its riders to the Med Bay in preference to a nearer-ish home;
 *  - homes in a Med Bay's or Memorial's Range get the comfort (wellbeing reasons); out of Range they don't;
 *  - grief fades faster while a Memorial stands.
 *   node tools/medbay-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const B = C.content.buildings;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const TICK = 20;

function colony(extra = []) {
  const log = [];
  const sim = new core.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  const put = (kind, x, z) => { const b = { id: sim.s.nextId++, kind, x, z, progress: 1, hp: B[kind].hp, on: true, powered: true }; sim.s.buildings.push(b); return b; };
  put('civic', 20, 0);
  for (let i = 0; i < 4; i++) put('solar', -20, -30 + i * 14);
  const out = extra.map(([k, x, z]) => put(k, x, z));
  sim.command({ type: 'debug', people: { colonists: 4, wb: 70, biomass: 500 } });
  for (let i = 0; i < TICK; i++) sim.step();
  return { sim, log, out };
}
const run = (sim, secs) => { for (let i = 0; i < secs * TICK; i++) sim.step(); };
const fell = (sim, b) => {
  for (const c of sim.s.people.colonists) { c.at = b.id; c.x = b.x; c.z = b.z; c.hp = 40; }
  sim.command({ type: 'debug', hurt: { id: b.id, hp: 99999 } });
  sim.step();
};

check(B.medbay?.role === 'medbay' && B.memorial?.role === 'memorial', 'Med Bay and Memorial records exist');

// ---------- stretcher crews ----------
{
  const { sim, log, out: [med, hab] } = colony([['medbay', 0, 30], ['habitat', 0, 50]]);
  fell(sim, hab);
  const down = sim.people.injured().length;
  check(down === 4, `four people lie injured by the fallen Habitat Block (${down})`);
  run(sim, 2);
  const clocks = sim.people.injured().map((c) => c.down);
  check(clocks.every((t) => t > 58.5), `in the Med Bay's Range their clocks stop (${clocks.map((t) => t.toFixed(1)).join(', ')} s)`);
  const roster = sim.people.snapshot().roster.map((c) => c.doing);
  check(roster.some((d) => /stabilised/.test(d)), 'the roster says they are stabilised');
  check(sim.people.snapshot().care.some((c) => c.b === med.id && c.waiting === 4), 'the snapshot shows the stretcher queue');
  run(sim, 40);
  const inside = sim.s.people.colonists.filter((c) => c.at === med.id || c.home >= 0 && c.down === undefined).length;
  check(sim.people.injured().length === 0 && sim.s.people.colonists.length === 4, `all four brought in alive (${sim.s.people.colonists.length} living, ${inside} up)`);
  check(log.filter((t) => /stretcher/.test(t)).length === 4, 'one log line per stretcher');
}
{
  const { sim, out: [, hab] } = colony([['medbay', 0, -60], ['habitat', 0, 60]]);
  fell(sim, hab);
  run(sim, 62);
  check(sim.s.people.colonists.length === 0, 'out of its Range the injured still die when their time runs out');
}
{
  const { sim, out: [med, hab] } = colony([['medbay', 0, 30], ['habitat', 0, 50]]);
  med.on = false;
  fell(sim, hab);
  run(sim, 3);
  check(sim.people.injured().every((c) => c.down < 58.5), 'switched off, it does nothing');
}

// ---------- Medevac prefers the Med Bay ----------
{
  const { sim, log, out: [med, hab] } = colony([['medbay', 60, 40], ['habitat', 60, -40], ['habitat', -40, 60]]);
  med.on = true;
  fell(sim, hab);
  sim.command({ type: 'debug', units: { unit: 'medevac', x: 60, z: -30, n: 1 } });
  let at = [];
  for (let t = 0; t < 60; t++) { run(sim, 1); at = sim.s.people.colonists.map((c) => c.at); if (at.every((a) => a === med.id)) break; }
  check(at.length === 4 && at.every((a) => a === med.id), `the Medevac takes them to the Med Bay (${at.join(',')}, Med Bay ${med.id})`);
  check(sim.s.people.colonists.every((c) => c.hp >= 39), 'fully treated there');
  check(log.some((t) => /brought in to the Med Bay/.test(t)), 'it says so');
}

// ---------- comfort ----------
const reasons = (sim) => sim.people.snapshot().roster.flatMap((c) => c.why.map(([k]) => k));
{
  const { sim } = colony([['medbay', 30, 0], ['memorial', 10, 20]]);
  run(sim, 2);
  const why = reasons(sim);
  check(why.includes('Medical care'), 'homes in a Med Bay\'s Range get medical care');
  check(why.includes('Memorial'), 'homes in a Memorial\'s Range take comfort from it');
}
{
  const { sim } = colony([['medbay', -100, -100], ['memorial', 100, 100]]);
  run(sim, 2);
  const why = reasons(sim);
  check(!why.includes('Memorial'), 'out of Range: no comfort');
}
{
  const a = colony([['memorial', 100, 100]]), b = colony();
  a.sim.s.people.grief = b.sim.s.people.grief = 40;
  run(a.sim, 30); run(b.sim, 30);
  check(a.sim.s.people.grief < b.sim.s.people.grief * 0.9, `grief fades faster with a Memorial (${a.sim.s.people.grief.toFixed(1)} vs ${b.sim.s.people.grief.toFixed(1)})`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall Med Bay / Memorial checks passed');
process.exit(failed ? 1 : 0);
