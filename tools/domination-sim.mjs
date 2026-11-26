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
  D.stepDomination(map, s, eta + 150);
  check(s.areas[to].owner === 0 && s.areas[to].army > 0 && s.areas[to].army < 40, `it beats ${nat} natives and holds ${to} with ${s.areas[to].army}`);
  check(s.players[0].stats.taken === 1, 'counted as taken');
  // an undefended area falls at once; the last one lost puts a player out and ends the war
  s.areas['verdance-1'].army = 0; s.areas['verdance-1'].guns = 0;
  s.moves.push({ id: 99, player: 0, from: 'home-1', to: 'verdance-1', strength: 5, t0: s.t, t1: s.t + 1, launch: true });
  D.stepDomination(map, s, 2);
  check(s.areas['verdance-1'].owner === 0 && s.players[1].out && s.over?.winner === 0, 'an empty area falls; Crimson is out; you win');
  check(JSON.parse(JSON.stringify(s)).areas['home-1'].id === 'home-1', 'the state is plain data (it is the save)');
}

// ---- teams, fog of war, victory by control
{
  const s = D.newDomination(map, { seed: 4, players: 4, ai: 'normal', rules: { side: [0, 0, 1, 1], fog: true, win: 'control' } });
  for (const pl of s.players) pl.ai = undefined;
  check(D.allied(s, 0, 1) && !D.allied(s, 0, 2) && D.sideOf(s, 3) === 1, '2 v 2: you and Crimson against Amber and Violet');
  // an ally's area is never a destination
  Object.assign(s.areas['home-2'], { owner: 1, natives: 0, army: 5 });
  check(!D.destinations(map, s, 'home-1').some((d) => d.to === 'home-2'), 'you can\'t send an army into an ally\'s area');
  // allies attacking together don't hurt each other; the bigger one takes it, the other joins it
  Object.assign(s.areas['rime-2'], { owner: 2, army: 10, guns: 0, natives: 0, visitors: { 0: 40, 1: 30 } });
  D.stepDomination(map, s, 90);
  check(s.areas['rime-2'].owner === 0 && s.areas['rime-2'].army > 40 && !Object.keys(s.areas['rime-2'].visitors).length, `you and Crimson take Rime's area together; you hold it with both armies (${Math.round(s.areas['rime-2'].army)})`);
  // fog: your areas, their neighbours and your fights; who holds what is public
  const seen = D.visibleTo(map, s, 0);
  check(seen.has('home-1') && map.byId['home-1'].links.every((l) => seen.has(l)) && !seen.has('dunmore-2'), 'under fog you see your side\'s areas and the areas next to them, not Dunmore');
  check(seen.has('home-2'), 'you see your ally\'s areas');
  // a player down to its last few areas is revealed
  for (const a of Object.values(s.areas)) if (a.owner === 3) a.owner = -1;
  Object.assign(s.areas['dunmore-2'], { owner: 3, army: 20, natives: 0 });
  check(!D.visibleTo(map, s, 0).has('dunmore-2'), 'a player with one area from the start isn\'t revealed');
  s.players[3].stats.peak = 8;
  check(D.visibleTo(map, s, 0).has('dunmore-2'), 'a player fallen to its last areas is revealed to everyone');
  // the computer plans on what it saw, not on what's there
  s.players[2].ai = 'normal';
  const { fogView } = (await runnerImport(path.join(root, 'src/sim/domination-ai.ts'))).module;
  const hidden = Object.values(s.areas).find((a) => a.owner < 0 && !D.visibleTo(map, s, 2).has(a.id));
  hidden.natives = 99;
  const view = fogView(map, s, 2);
  check(hidden && view.areas[hidden.id].natives === 18 && s.players[2].seen && !s.players[2].seen[hidden.id], `a computer under fog plans on a guess where it has never seen (${hidden?.id}: 99 there, it thinks 18)`);
  // 75%: a side holding 30 of 40 wins at once, though everyone is still in
  const ids = Object.keys(s.areas);
  ids.slice(0, 30).forEach((id, i) => Object.assign(s.areas[id], { owner: i % 2, visitors: {}, natives: 0, army: 5 }));
  ids.slice(30).forEach((id, i) => Object.assign(s.areas[id], { owner: 2 + (i % 2), visitors: {}, natives: 0, army: 5 }));
  s.moves = [];
  D.stepDomination(map, s, 1);
  check(s.over?.how === 'control' && s.over.side === 0 && s.over.winner === 0, `holding ${D.controlNeed(s)} areas wins by control, for your side`);
  check(s.history.length >= 2 && s.history[0].held.length === 4, 'areas held are sampled for the end screen');
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
