/**
 * Computer players, headless (DESIGN §5.11 phase 4): plays skirmishes on generated maps and reports how each
 * computer player's game went: a minute-by-minute timeline (alloys, buildings, drones, army, waves, power) and who
 * won when.
 *   node tools/ai-sim.mjs [--match normal,idle] [--seeds 3] [--minutes 30] [--players 2] [--world home] [--trace]
 *   --match a,b[,c,d]: each player's level (easy | normal | hard), or idle (a player who does nothing)
 *   --check: run the standard checks (each level beats an idle player; hard beats easy) and exit 1 on a failure
 */
import path from 'node:path';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
/**
 * --match entries may be old:<level>: that player runs the AI from a git revision (--baseline, default HEAD), so a
 * change to src/sim/ai.ts can be measured head to head against the last version.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const argv0 = process.argv;
let baseline = null;
if (argv0.some((a) => a.includes('old:'))) {
  const rev = argv0.includes('--baseline') ? argv0[argv0.indexOf('--baseline') + 1] : 'HEAD';
  const src = execSync(`git show ${rev}:src/sim/ai.ts`, { cwd: root }).toString()
    .replaceAll("from '../content'", "from '../../src/content'").replaceAll("from './rules'", "from '../../src/sim/rules'").replaceAll("from './types'", "from '../../src/sim/types'").replaceAll("from '../content/defs'", "from '../../src/content/defs'");
  mkdirSync(path.join(root, 'tools/.cache'), { recursive: true });
  writeFileSync(path.join(root, 'tools/.cache/ai-baseline.ts'), src);
  baseline = (await runnerImport(path.join(root, 'tools/.cache/ai-baseline.ts'))).module;
}
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const trace = process.argv.includes('--trace');

function game({ match, seed, minutes, world = 'home', size = 'medium', water = 'some', relief = 'rolling', quiet = false }) {
  const n = match.length;
  const map = M.generateSkirmishMap({ seed, players: n, size, world, water, relief }, M.content.bodies);
  M.useRegion('skirmish', map.region);
  const events = [];
  const sim = new M.Sim((t, l) => events.push(t), seed);
  sim.newSkirmish({
    seed, alloys: 600, homes: map.homes, wildlife: false,
    players: match.map((lv, i) => ({ name: `P${i}:${lv}`, color: '#fff', ai: lv === 'idle' ? undefined : lv.replace('old:', '') })),
  });
  match.forEach((lv, i) => { if (lv.startsWith('old:')) sim.thinkers[i] = baseline.think; });
  const s = sim.s, T = minutes * 600;
  const line = (t) => {
    const P = s.players[t], e = t ? P.econ : null;
    const own = (o) => (o.team ?? 0) === t;
    const kinds = {};
    for (const b of s.buildings) if (own(b)) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    const alloys = Math.round(t ? e.alloys : s.alloys), army = s.units.filter(own).length;
    return `${P.name.padEnd(10)} ${P.out ? 'OUT' : `◆${String(alloys).padStart(5)} army ${String(army).padStart(2)} drones ${s.drones.filter(own).length} wave ${P.brain?.wave ?? '-'}${P.brain ? ` ${P.brain.attack.length ? P.brain.phase : 'home'} raid ${P.brain.raid?.length ?? 0} knows ${Object.keys(P.brain.known ?? {}).length}` : ''} · ${Object.entries(kinds).map(([k, v]) => `${k}${v > 1 ? '×' + v : ''}`).join(' ')}`}`;
  };
  for (let i = 1; i <= T && !s.over; i++) {
    sim.step();
    if (!quiet && trace && i % 600 === 0) { console.log(`  ${i / 600} min`); for (let t = 0; t < n; t++) console.log(`    ${line(t)}`); }
    // with nobody human: end when one side is left (the sim ends it for player 0's side)
    if (s.players.filter((p) => !p.out).length <= 1) break;
  }
  const alive = s.players.map((p, i) => [p, i]).filter(([p]) => !p.out);
  const winner = alive.length === 1 ? alive[0][1] : -1;
  const mins = (s.tick / 600).toFixed(1);
  const stats = s.players.map((p, i) => { const st = i ? p.econ.stats : s.stats; return `${p.name}: built ${st.unitsBuilt ?? 0}, kills ${st.enemyKills ?? 0}, lost ${st.unitsLost ?? 0}, mined ${Math.round(st.mined)}`; });
  return { winner, mins, stats, lines: match.map((_, t) => line(t)), events };
}

if (process.argv.includes('--check')) {
  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
  for (const lv of ['easy', 'normal', 'hard']) {
    for (const seed of [11, 12]) {
      const r = game({ match: ['idle', lv], seed, minutes: 25, quiet: true });
      check(r.winner === 1, `${lv} beats a player who does nothing (seed ${seed}: ${r.winner === 1 ? `won at ${r.mins} min` : `no result in ${r.mins} min`})`);
      if (r.winner !== 1) for (const l of r.lines) console.log(`        ${l}`);
    }
  }
  let hardWins = 0;
  for (const seed of [21, 22, 23]) {
    const r = game({ match: ['easy', 'hard'], seed, minutes: 40, quiet: true });
    if (r.winner === 1) hardWins++;
    console.log(`      easy vs hard, seed ${seed}: ${r.winner < 0 ? 'no result' : `P${r.winner} won`} at ${r.mins} min`);
  }
  check(hardWins >= 2, `hard beats easy (${hardWins}/3)`);
  const ffa = game({ match: ['normal', 'normal', 'normal', 'normal'], seed: 31, minutes: 60, quiet: true, size: 'large' });
  check(ffa.winner >= 0, `a four-way free-for-all of normals ends (${ffa.winner >= 0 ? `P${ffa.winner} at ${ffa.mins} min` : `still going at ${ffa.mins} min`})`);
  for (const l of ffa.stats) console.log(`        ${l}`);
  console.log(failed ? `\n${failed} failed` : '\nall AI checks passed');
  process.exit(failed ? 1 : 0);
}

const match = arg('--match', 'idle,normal').split(',');
const seeds = Number(arg('--seeds', 3)), minutes = Number(arg('--minutes', 30));
for (let k = 0; k < seeds; k++) {
  const seed = 100 + k;
  console.log(`=== ${match.join(' vs ')} · seed ${seed}`);
  const r = game({ match, seed, minutes, world: arg('--world', 'home') });
  console.log(`  ${r.winner < 0 ? 'no winner' : `P${r.winner} (${match[r.winner]}) won`} at ${r.mins} min`);
  for (const l of r.lines) console.log(`    ${l}`);
  for (const l of r.stats) console.log(`    ${l}`);
}
