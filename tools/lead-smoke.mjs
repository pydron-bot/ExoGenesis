/**
 * Leading blocs (headless, the real sim): when one bloc holds enough of the
 * adults it leads and its boost comes on. Wardens (Autonomists) fight from the
 * buildings and take less harm outdoors; Accord (Partners) staff better; Unity
 * (Devoted) drones work faster and buildings draw less power.
 *   node tools/lead-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const P = C.content.people;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

/** A deployed colony with a Civilian Center and `n` adults at `stance`. */
function colony(stance, n = 6) {
  const log = [];
  const sim = new core.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9; // no packs unless asked
  sim.s.buildings.push({ id: sim.s.nextId++, kind: 'civic', x: 20, z: 0, progress: 1, hp: C.content.buildings.civic.hp, on: true, powered: true });
  sim.s.buildings.push({ id: sim.s.nextId++, kind: 'solar', x: -20, z: 0, progress: 1, hp: C.content.buildings.solar.hp, on: true, powered: true });
  sim.command({ type: 'debug', people: { colonists: n, stance, wb: 70, biomass: 500 } });
  for (let i = 0; i < 20; i++) sim.step();
  return { sim, log };
}

// who leads
const auto = colony(15);
check(auto.sim.people.lead() === 'autonomist', 'Autonomist majority leads');
check(auto.log.some((t) => /Wardens/.test(t)), 'the log announces the Wardens boost');
check(auto.sim.people.harm() === P.wardenHarm, `Wardens take ${P.wardenHarm}× harm outdoors`);
check(colony(55).sim.people.lead() === 'partner', 'Partner majority leads');
const dev = colony(92);
check(dev.sim.people.lead() === 'devoted', 'Devoted majority leads');
check(colony(15, P.leadMin - 1).sim.people.lead() === null, `no bloc leads with fewer than ${P.leadMin} adults`);
check(colony(55).sim.people.harm() === 1, 'others take full harm outdoors');

// Wardens: a lone swarmer by the Civilian Center, no turrets anywhere
function brawl(stance) {
  const { sim } = colony(stance);
  const civic = sim.s.buildings.find((b) => b.kind === 'civic');
  // everyone home (alert sends them indoors anyway)
  for (const c of sim.s.people.colonists) { c.at = civic.id; c.x = civic.x; c.z = civic.z; }
  sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: civic.x + 9, z: civic.z + 2, n: 1 } });
  const h = sim.s.hostiles[0];
  const hp0 = h.hp;
  for (let i = 0; i < 40; i++) sim.step();
  const now = sim.s.hostiles.find((x) => x.id === h.id);
  return { hp0, hp: now ? now.hp : 0, inside: sim.people.wardens(civic) };
}
const w = brawl(15), p = brawl(55);
check(w.inside > 0 && w.inside <= P.militiaMax, `Autonomists inside fight (${w.inside} wardens)`);
check(w.hp < w.hp0, `Wardens hurt a predator next to their building (${w.hp0} → ${w.hp.toFixed(0)})`);
check(p.hp >= p.hp0 - 1e-6 || p.hp > w.hp, `a Partner-led building doesn't fight back (${p.hp0} → ${p.hp.toFixed(0)})`);

// Unity: drones and power
check(dev.sim.people.droneWork() === P.devotedDrones && dev.sim.people.powerDraw() === P.devotedPower, 'Unity: faster drones, lower draw');
const drawOf = (s) => { for (let i = 0; i < 10; i++) s.sim.step(); return s.sim.power.draw; };
const pa = colony(55);
check(drawOf(dev) < drawOf(pa), `Unity colony draws less power (${dev.sim.power.draw.toFixed(2)} vs ${pa.sim.power.draw.toFixed(2)} MW)`);

// Accord: staffing
const staff = (s) => Math.max(...s.sim.s.buildings.map((b) => s.sim.people.mult(b)));
const acc = colony(55), un = colony(92);
for (let i = 0; i < 600; i++) { acc.sim.step(); un.sim.step(); }
check(acc.sim.people.lead() === 'partner', 'still Partner-led after a minute');
console.log(`      best staffed building: Accord ×${staff(acc).toFixed(2)}, Unity ×${staff(un).toFixed(2)}`);

// losing the lead
const lose = colony(15);
for (const c of lose.sim.s.people.colonists) c.stance = 55;
for (let i = 0; i < 20; i++) lose.sim.step();
check(lose.sim.people.lead() === 'partner' && lose.log.some((t) => /Accord/.test(t)), 'the lead changes hands when opinion moves');

console.log(failed ? `\n${failed} check(s) failed` : '\nall lead checks passed');
process.exit(failed ? 1 : 0);
