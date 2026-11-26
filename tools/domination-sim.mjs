/**
 * Domination's strategy layer, headless (src/sim/domination.ts): the rules, then computer-vs-computer wars.
 *   node tools/domination-sim.mjs [--trace] [--seeds 1,2,3]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const root = path.resolve(import.meta.dirname, '..');
const { module: D } = await runnerImport(path.join(root, 'src/sim/domination.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const map = D.domMap(C.content.bodies);
const trace = process.argv.includes('--trace');
const seeds = process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1].split(',').map(Number) : [1, 2, 3];

// ---- rules
{
  const s = D.newDomination(map, { seed: 1, players: 2, ai: 'normal' });
  s.players[1].ai = undefined; // nobody thinks: the test gives the orders
  check(Object.keys(s.areas).length === 40 && s.areas['home-1'].owner === 0 && s.areas['verdance-1'].owner === 1, 'two players start at Touchdown and on Verdance');
  check(Object.values(s.areas).filter((a) => a.owner < 0).every((a) => a.natives >= 10), 'every other area is held by natives');
  const a0 = s.players[0].alloys;
  D.stepDomination(map, s, 10);
  check(Math.abs(s.players[0].alloys - a0 - 20) < 0.01, `income: an area at level 1 makes 2 alloys a second (${(s.players[0].alloys - a0).toFixed(1)} in 10 s)`);
  check(D.domBuild(s, 0, 'home-1', 'army') === null && s.areas['home-1'].queue.length === 1, 'an army is queued and paid for');
  check(D.domBuild(s, 0, 'verdance-1', 'army') === 'Not your area', 'not in someone else\'s area');
  D.stepDomination(map, s, 21);
  check(s.areas['home-1'].army === 40, `it joins the garrison when done (${s.areas['home-1'].army})`);
  // send everything at a neighbour: travel, fight the natives, take it
  const to = map.byId['home-1'].links[0];
  const nat = s.areas[to].natives;
  check(D.domSend(map, s, 0, 'home-1', to, 40) === null && s.areas['home-1'].army === 0 && s.moves.length === 1, 'an army sets off');
  check(D.domSend(map, s, 0, 'home-1', 'rime-1', 1) !== null, 'no launch without an army');
  const eta = s.moves[0].t1 - s.t;
  D.stepDomination(map, s, eta + 40);
  check(s.areas[to].owner === 0 && s.areas[to].army > 0 && s.areas[to].army < 40, `it beats ${nat} natives and holds ${to} with ${s.areas[to].army}`);
  check(s.players[0].stats.taken === 1, 'counted as taken');
  // an undefended area falls at once; the last one lost puts a player out and ends the war
  s.areas['verdance-1'].army = 0; s.areas['verdance-1'].guns = 0;
  s.moves.push({ id: 99, player: 0, from: 'home-1', to: 'verdance-1', strength: 5, t0: s.t, t1: s.t + 1, launch: true });
  D.stepDomination(map, s, 2);
  check(s.areas['verdance-1'].owner === 0 && s.players[1].out && s.over?.winner === 0, 'an empty area falls; Crimson is out; you win');
  check(JSON.parse(JSON.stringify(s)).areas['home-1'].id === 'home-1', 'the state is plain data (it is the save)');
}

// ---- computer-vs-computer wars
const run = (seed, players, ai, limit = 4 * 3600) => {
  const s = D.newDomination(map, { seed, players, ai });
  s.players[0].ai = ai;
  let lastTrace = 0;
  while (!s.over && s.t < limit) {
    D.stepDomination(map, s, 10);
    if (trace && s.t - lastTrace >= 600) {
      lastTrace = s.t;
      console.log(`  ${Math.round(s.t / 60)} min: ${s.players.map((pl, p) => `${pl.name} ${D.ownedBy(s, p).length}a ${Math.round(pl.alloys)}◆ ${Math.round(D.ownedBy(s, p).reduce((m, a) => m + a.army, 0) + s.moves.filter((m) => m.player === p).reduce((m, x) => m + x.strength, 0))}⚔`).join(' · ')}`);
    }
  }
  return s;
};
for (const players of [2, 3, 4]) for (const seed of seeds) {
  const t0 = performance.now();
  const s = run(seed, players, 'normal');
  const ms = performance.now() - t0;
  const held = Object.values(s.areas).filter((a) => a.owner >= 0).length;
  console.log(`  ${players}p seed ${seed}: ${s.over ? `${s.players[s.over.winner]?.name} won at ${Math.round(s.over.t / 60)} min` : `no winner after ${Math.round(s.t / 60)} min`} · ${held}/40 held · ${ms.toFixed(0)} ms`);
  check(!!s.over && s.t > 10 * 60, `${players} computer players, seed ${seed}: a war that ends, and not too fast`);
}
{
  let hardWins = 0;
  for (const seed of seeds) {
    const s = D.newDomination(map, { seed, players: 2, ai: 'easy' });
    s.players[0].ai = 'hard';
    while (!s.over && s.t < 4 * 3600) D.stepDomination(map, s, 10);
    if (s.over?.winner === 0) hardWins++;
  }
  check(hardWins === seeds.length, `Hard beats Easy (${hardWins}/${seeds.length})`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall domination checks passed');
process.exit(failed ? 1 : 0);
