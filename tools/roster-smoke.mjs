/**
 * Headless checks for the M1 roster additions, on the real sim (no browser):
 * artillery (minimum range, splash), arc caster (chain), field engineer and
 * repair pad (repairs), scout (sight), siege cannon and point defense,
 * gate (snaps onto a wall, replaces segments, open to units, shut to predators),
 * geothermal tap (vents only, steady power), spitter (outranges turrets),
 * burrower (under walls, unseen, surfaces at its target) and the pack mix.
 *   node tools/roster-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: rules } = await runnerImport(path.join(root, 'src/sim/rules.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { module: T } = await runnerImport(path.join(root, 'src/skirmish/types.ts'));
const { content } = C;
const U = content.units, B = content.buildings;
const VENTS = content.regions.touchdown.vents;

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

/** A deployed colony with nothing else going on (no packs for a long while). */
function fresh() {
  const events = [];
  const sim = new core.Sim((text) => events.push(text), 4242);
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  sim.s.fauna.length = 0; // grazers only get in the way
  sim.events = events;
  return sim;
}
function addBuilding(sim, kind, x, z, yaw = 0) {
  const b = { id: sim.s.nextId++, kind, x, z, yaw, progress: 1, hp: B[kind].hp, on: true, powered: false };
  sim.s.buildings.push(b);
  return b;
}
function addUnit(sim, kind, x, z) {
  const u = { id: sim.s.nextId++, unit: kind, slot: sim.freeSlot(), x, z, heading: 0, hp: U[kind].hp, cd: 0, order: { kind: 'idle' }, gx: x, gz: z, target: -1 };
  sim.s.units.push(u);
  return u;
}
function addHostile(sim, kind, x, z) {
  sim.command({ type: 'debug', spawn: { unit: kind, x, z, n: 1 } });
  return sim.s.hostiles[sim.s.hostiles.length - 1];
}
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
/** Plenty of steady power, so nothing browns out in a test. */
const powerUp = (sim) => { addBuilding(sim, 'geothermal', VENTS[0].x, VENTS[0].z); addBuilding(sim, 'geothermal', VENTS[1].x, VENTS[1].z); };

// ---------- roster ----------
{
  const ids = Object.keys(U);
  check(T.ROSTER.length === ids.length && ids.every((id) => T.unitType(id) >= 0), `every unit record has a render type (${ids.length})`);
  check(T.unitType('rover') === 0 && T.unitType('tank') === 1 && T.unitType('swarmer') === 2 && T.unitType('brute') === 3, 'skirmish types keep their numbers');
}

// ---------- artillery ----------
{
  const sim = fresh();
  const art = addUnit(sim, 'artillery', 0, -30);
  addUnit(sim, 'scout', 0, -48); // spotter: artillery outranges its own sight
  const a = addHostile(sim, 'swarmer', 0, -66), b = addHostile(sim, 'swarmer', 1.5, -66);
  // freeze the targets so the test measures the gun, not the chase
  const hold = () => { a.x = 0; a.z = -66; b.x = 1.5; b.z = -66; };
  for (let i = 0; i < 40; i++) { hold(); sim.step(); }
  const hit = (x) => !sim.s.hostiles.includes(x) || x.hp < U.swarmer.hp;
  check(hit(a) && hit(b), `artillery hits at ${36} u, splash catches the neighbour`);
  const sim2 = fresh();
  const art2 = addUnit(sim2, 'artillery', 0, -30);
  const near = addHostile(sim2, 'brute', 0, -36);
  near.x = 0; near.z = -36;
  for (let i = 0; i < 40; i++) { near.x = 0; near.z = -36; near.cd = 9; sim2.step(); }
  check(near.hp === U.brute.hp && art2.target === -1, 'artillery holds fire inside its minimum range');
  void art;
}

// ---------- arc caster ----------
{
  const sim = fresh();
  addUnit(sim, 'arc', 0, -30);
  const pack = [0, 1, 2, 3, 4].map((i) => addHostile(sim, 'brute', -2 + i * 1.4, -38));
  for (const h of pack) h.cd = 99;
  steps(sim, 3);
  const hurt = pack.filter((h) => h.hp < U.brute.hp).length;
  check(hurt >= 4, `one arc discharge hurts ${hurt}/5 clustered hostiles`);
}

// ---------- engineer + repair pad ----------
{
  const sim = fresh();
  const r = addUnit(sim, 'rover', 10, -30);
  r.hp = 40;
  addUnit(sim, 'engineer', 16, -30);
  const before = sim.s.alloys;
  steps(sim, 50);
  check(r.hp > 100 && sim.s.alloys < before, `engineer repairs a rover (40 → ${Math.round(r.hp)} hp) for alloys`);
  const t = addBuilding(sim, 'turret', -14, -20);
  t.hp = 200;
  steps(sim, 120);
  check(t.hp > 300, `engineer repairs a damaged building nearby (200 → ${Math.round(t.hp)})`);

  const sim2 = fresh();
  powerUp(sim2);
  const pad = addBuilding(sim2, 'repairpad', 0, -28);
  const tank = addUnit(sim2, 'tank', 3, -30);
  tank.hp = 100;
  const a0 = sim2.s.alloys;
  steps(sim2, 50);
  check(tank.hp > 150 && pad.powered && Math.abs(sim2.s.alloys - a0 - 0.4 * 5) < 3, `repair pad mends a parked tank (100 → ${Math.round(tank.hp)} hp), free`);
}

// ---------- scout sight ----------
{
  const sim = fresh();
  addUnit(sim, 'scout', -80, 80); // far from the Core's own sight
  steps(sim, 6);
  check(sim.visible(-80, 80 - 52) && !sim.visible(-80, 80 - 70), 'scout sees ~58 u around it');
}

// ---------- cannon, point defense, spitter ----------
{
  const sim = fresh();
  powerUp(sim);
  const tur = addBuilding(sim, 'turret', 0, -24);
  const sp = addHostile(sim, 'spitter', 0, -24 - 29);
  for (let i = 0; i < 60; i++) { sp.x = 0; sp.z = -53; sim.step(); }
  check(!tur.engaged && tur.hp < B.turret.hp && sp.hp === U.spitter.hp, `a spitter at 29 u outranges a Defense Turret (turret ${Math.round(tur.hp)} hp)`);
  const can = addBuilding(sim, 'cannon', 10, -22);
  for (let i = 0; i < 60 && sim.s.hostiles.includes(sp); i++) { sp.x = 0; sp.z = -53; sim.step(); }
  check(!sim.s.hostiles.includes(sp), 'a Siege Cannon kills it');

  const sim2 = fresh();
  powerUp(sim2);
  addBuilding(sim2, 'pointdefense', 0, -24);
  const sw = [0, 1, 2, 3].map((i) => addHostile(sim2, 'swarmer', -3 + i * 2, -38));
  for (let i = 0; i < 60; i++) { for (const [j, h] of sw.entries()) { h.x = -3 + j * 2; h.z = -38; h.cd = 9; } sim2.step(); }
  check(sw.every((h) => !sim2.s.hostiles.includes(h)), 'point defense shreds 4 swarmers in 6 s');
}

// ---------- gate ----------
{
  const sim = fresh();
  powerUp(sim);
  sim.s.alloys = 2000;
  sim.command({ type: 'buildLine', kind: 'wall', x1: -20, z1: -30, x2: 20, z2: -30 });
  for (const b of sim.s.buildings) if (b.kind === 'wall') { b.progress = 1; b.hp = B.wall.hp; }
  const walls0 = sim.s.buildings.filter((b) => b.kind === 'wall').length;
  sim.command({ type: 'build', kind: 'gate', x: 0.7, z: -29, yaw: 0 });
  const gate = sim.s.buildings.find((b) => b.kind === 'gate');
  const walls1 = sim.s.buildings.filter((b) => b.kind === 'wall').length;
  check(!!gate && Math.abs(gate.z + 30) < 0.01 && Math.abs(Math.sin(gate.yaw ?? 0)) > 0.999, 'gate snaps onto the wall line and turns to match');
  check(walls1 === walls0 - 2, `gate replaces the two wall segments under it (${walls0} → ${walls1})`);
  // no gap: the wall's ends overlap the gate's ends
  const ends = sim.s.buildings.filter((b) => b.kind === 'wall').map((b) => Math.abs(b.x - gate.x) - B.wall.clearance / 2).sort((a, b) => a - b);
  check(ends[0] < B.gate.clearance / 2 + 0.15 && ends[1] < B.gate.clearance / 2 + 0.15, `no gap beside the gate (wall ends ${ends[0].toFixed(2)} / ${ends[1].toFixed(2)} u from its centre)`);
  gate.progress = 1; gate.hp = B.gate.hp;
  // a rover drives through the gate
  const r = addUnit(sim, 'rover', gate.x, -40);
  sim.command({ type: 'order', ids: [r.id], x: gate.x, z: -18 });
  steps(sim, 80);
  check(r.z > -22, `a rover drives through the gate (z ${r.z.toFixed(1)})`);
  // a swarmer can't: it has to chew
  addBuilding(sim, 'solar', gate.x, -14);
  const sw = addHostile(sim, 'swarmer', gate.x, -36);
  let crossed = false;
  for (let i = 0; i < 60; i++) { sim.step(); if (sw.z > -29.2) crossed = true; }
  check(!crossed, 'a swarmer can\'t get through the gate');
}

// ---------- geothermal ----------
{
  const sim = fresh();
  sim.s.alloys = 2000;
  const v = VENTS[0];
  addBuilding(sim, 'solar', v.x - 14, v.z - 10); // reach the vent's area
  const w = { buildings: sim.s.buildings, deposits: sim.s.deposits, vents: VENTS };
  check(!!rules.placeProblem(w, B, content.colony, 'geothermal', v.x - 9, v.z + 6), 'geothermal refused away from a vent');
  check(!rules.placeProblem(w, B, content.colony, 'geothermal', v.x + 1, v.z), 'geothermal allowed on a vent');
  sim.command({ type: 'build', kind: 'geothermal', x: v.x + 1, z: v.z });
  const g = sim.s.buildings.find((b) => b.kind === 'geothermal');
  g.progress = 1; g.hp = B.geothermal.hp;
  check(!!rules.placeProblem(w, B, content.colony, 'geothermal', v.x - 1, v.z + 4.5), 'a tapped vent takes no second tap');
  // run to the middle of the night
  sim.s.tick = Math.round(content.colony.solSeconds * 0.5 * 10);
  steps(sim, 2);
  check(sim.power.gen >= B.geothermal.powerMW + B.core.powerMW - 0.01 && sim.power.daylight < 0.1, `geothermal gives ${B.geothermal.powerMW} MW at night`);
}

// ---------- burrower ----------
{
  const sim = fresh();
  sim.s.alloys = 2000;
  sim.command({ type: 'buildLine', kind: 'wall', x1: -30, z1: -40, x2: 30, z2: -40 });
  for (const b of sim.s.buildings) if (b.kind === 'wall') { b.progress = 1; b.hp = B.wall.hp; }
  const tur = addBuilding(sim, 'turret', 0, -26);
  powerUp(sim);
  const bu = addHostile(sim, 'burrower', 0, -70);
  check(bu.under === true, 'burrowers arrive underground');
  sim.step();
  const snap = sim.snapshot();
  const drawn = snap.army[bu.slot * T.STRIDE + T.F.ALIVE] === 1;
  check(!drawn, 'an underground burrower isn\'t drawn');
  let shotWhileUnder = false, surfacedInside = false, wallsHit = false;
  const wallHp = () => sim.s.buildings.filter((b) => b.kind === 'wall').reduce((m, b) => m + b.hp, 0);
  const w0 = wallHp();
  for (let i = 0; i < 300 && sim.s.hostiles.includes(bu); i++) {
    const was = bu.under;
    sim.step();
    if (was && bu.hp < U.burrower.hp) shotWhileUnder = true;
    if (was && !bu.under) surfacedInside = bu.z > -40;
  }
  wallsHit = wallHp() < w0;
  check(surfacedInside && !wallsHit, 'it passes under the wall and surfaces inside');
  check(!shotWhileUnder, 'nothing can shoot it while it\'s underground');
  check(sim.events.some((e) => /surfaced/.test(e)), 'a warning when it surfaces');
  void tur;
}

// ---------- pack mix ----------
{
  const sim = fresh();
  const seen = {};
  sim.s.waves.next = sim.s.tick;
  for (let n = 0; n < 12; n++) {
    sim.s.waves.next = sim.s.tick + 1;
    steps(sim, 1);
    for (const h of sim.s.hostiles) if (h.pack >= 0) seen[h.unit] = Math.max(seen[h.unit] ?? -1, n);
    // clear the pack, not the nests: packs only set out from a spawn whose nest stands
    sim.s.hostiles = sim.s.hostiles.filter((h) => !(h.pack >= 0));
    sim.s.packs.length = 0;
  }
  check(seen.spitter >= 0 && seen.burrower >= 0, `packs bring spitters and burrowers later on (${Object.keys(seen).join(', ')})`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
