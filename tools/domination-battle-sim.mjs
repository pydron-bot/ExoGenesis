/**
 * Domination battles in full, headless (src/sim/dom-battle.ts, the battle mode of Sim.newSkirmish): the war's numbers
 * become units and turrets on the area's map, the stronger side wins, and what's left goes back into the war.
 *   node tools/domination-battle-sim.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const D = M.domination, B = M.domBattle;
const map = D.domMap(M.content.bodies);

const u = B.battleUnits(120);
check(u.units.reduce((m, x) => m + x.n, 0) === 24 && Math.abs(u.per - 5) < 1e-9, `120 strength is 24 units of 5 (${JSON.stringify(u.units)})`);
check(B.battleUnits(1000).units.reduce((m, x) => m + x.n, 0) === 40 && B.battleUnits(1000).per === 25, 'a big army: 40 units, each worth more');
check(B.battleUnits(0).units.length === 0, 'no army, no units');

/** A war where Crimson's army is fighting your area `area` (or you are fighting theirs). */
function war({ area, mine, theirs, guns, attack }) {
  const s = D.newDomination(map, { seed: 11, players: 2, ai: 'normal' });
  const a = s.areas[area];
  Object.assign(a, { owner: attack ? 1 : 0, army: attack ? theirs : mine, guns, natives: 0, level: 1 });
  a.visitors = { [attack ? 0 : 1]: attack ? mine : theirs };
  return s;
}
/** Play the battle out headless with computers on every side; returns the sim state. */
function play(b, minutes = 12) {
  const map2 = M.generateSkirmishMap({ seed: b.seed, players: b.sides.length, size: map.byId[b.area].size, world: map.byId[b.area].body, water: 'some', relief: 'rolling', site: map.byId[b.area] }, M.content.bodies);
  M.useRegion('skirmish', map2.region);
  const sim = new M.Sim(() => {}, b.seed);
  sim.newSkirmish({ seed: b.seed, alloys: 0, homes: map2.homes, wildlife: false, fog: false, players: b.sides.map((x, i) => ({ name: x.name, color: x.color, side: i, ai: 'normal' })), battle: b.sides.map((x) => ({ core: x.core, turrets: x.turrets, units: x.units })) });
  const s = sim.s;
  for (let i = 0; i < minutes * 600 && !s.over && s.players.filter((p) => !p.out).length > 1; i++) sim.step();
  return s;
}

// you attack Crimson's area with three times its strength
{
  const s = war({ area: 'verdance-2', mine: 150, theirs: 30, guns: 20, attack: true });
  check(B.cannotCommand(s, 'verdance-2') === null, 'you can fight your attack yourself');
  const b = B.makeBattle(s, 'verdance-2');
  check(b.sides.length === 2 && b.sides[0].player === 0 && !b.sides[0].core && b.sides[1].core && b.sides[1].turrets === 2, 'you first (attacking), Crimson holds with a Core and 2 turrets');
  const st = play(b);
  check(st.skirmish.battle && st.players[1].out && !st.players[0].out, 'the battle: Crimson\'s Core falls');
  const r = B.battleOutcome(st, b, true);
  check(r.sides[0].army > 10 && r.sides[0].army < 150 && !r.sides[1].core && r.sides[1].army === 0, `what's left: you ${r.sides[0].army}, Crimson nothing`);
  B.applyBattle(s, b, r);
  D.stepDomination(map, s, 1);
  check(s.areas['verdance-2'].owner === 0 && Math.abs(s.areas['verdance-2'].army - Math.round(r.sides[0].army)) <= 1, 'back in the war: the area is yours, held by what was left');
}
// Crimson attacks your well-defended area with too little
{
  const s = war({ area: 'home-1', mine: 60, theirs: 40, guns: 40, attack: false });
  const b = B.makeBattle(s, 'home-1');
  check(b.sides[0].core && b.sides[0].turrets === 4 && !b.sides[1].core, 'you hold Touchdown with 4 turrets; Crimson attacks');
  const st = play(b);
  check(st.players[1].out && st.players[1].coreless && !st.players[0].out, 'Crimson\'s army is gone; your Core stands');
  const r = B.battleOutcome(st, b, true);
  B.applyBattle(s, b, r);
  check(r.sides[0].core && s.areas['home-1'].owner === 0 && !s.areas['home-1'].visitors[1] && s.areas['home-1'].guns > 0 && s.areas['home-1'].guns <= 40, `you hold it: army ${r.sides[0].army}, guns ${r.sides[0].guns}`);
}
// natives: not a battle you can fight yourself
{
  const s = D.newDomination(map, { seed: 3, players: 2, ai: 'normal' });
  s.areas['home-2'].visitors = { 0: 20 };
  check(/natives/.test(B.cannotCommand(s, 'home-2') ?? ''), 'fights with natives stay on the map');
  check(B.cannotCommand(s, 'home-3') !== null, 'no battle, nothing to fight');
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall battle checks passed');
process.exit(failed ? 1 : 0);
