/**
 * Domination's computer players, measured (DESIGN §5.12 phase 5): computer-vs-computer wars, headless.
 *   node tools/domination-ai-sim.mjs [--seeds 20] [--check]
 * Prints:
 *   - matchups, each played from both seats: the brain against the last one (tools/.cache/dom-ai-baseline.ts, when
 *     there is one), Hard vs Normal, Normal vs Easy;
 *   - fairness: how often each start wins with Normals in every seat (3 and 4 players);
 *   - pace: how long wars take (game minutes at ×1) by player count.
 * --check fails unless Hard beats Normal and Normal beats Easy at least 70% of the time, every start has a fair chance
 * (2 players: 30%+; 3: 15–50%; 4: 10–45%), and every war ends inside 4 hours.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const D = M.domination;
const map = D.domMap(M.content.bodies);
const N = Number(process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1] : 20);
const baselineFile = path.join(root, 'tools/.cache/dom-ai-baseline.ts');
const baseline = fs.existsSync(baselineFile) ? (await runnerImport(baselineFile)).module.domAiThink : null;
const LIMIT = 4 * 3600;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

/** One war: `seats` are levels; `brains` swaps a seat's brain. Returns the winner's seat and the minutes. */
function war(seed, seats, brains) {
  const s = D.newDomination(map, { seed, players: seats.length, ai: 'normal' });
  seats.forEach((lv, i) => { s.players[i].ai = lv; });
  while (!s.over && s.t < LIMIT) D.stepDomination(map, s, 10, brains);
  return { winner: s.over ? s.over.winner : -1, min: s.t / 60 };
}

/** A against B from both seats, `N` seeds each: A's win share. */
function matchup(name, a, b, brainA, brainB) {
  let wins = 0, games = 0, unfinished = 0;
  for (let seed = 1; seed <= N; seed++) for (const flip of [false, true]) {
    const seats = flip ? [b, a] : [a, b];
    const brains = {};
    if (brainA) brains[flip ? 1 : 0] = brainA;
    if (brainB) brains[flip ? 0 : 1] = brainB;
    const r = war(seed, seats, brains);
    games++;
    if (r.winner < 0) unfinished++;
    else if (r.winner === (flip ? 1 : 0)) wins++;
  }
  console.log(`  ${name.padEnd(28)} ${String(Math.round((wins / games) * 100)).padStart(3)}% of ${games}${unfinished ? ` (${unfinished} unfinished)` : ''}`);
  return wins / games;
}

/** --only matchups|fairness|pace: one part (tuning). */
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const part = (k) => !only || only === k;
let hn = 1, ne = 1;
if (part('matchups')) {
console.log('matchups (both seats):');
if (baseline) matchup('normal vs the last brain', 'normal', 'normal', null, baseline);
hn = matchup('hard vs normal', 'hard', 'normal');
ne = matchup('normal vs easy', 'normal', 'easy');
}

const share = { 2: [0.5, 0.5], 3: [0.3, 0.3, 0.3], 4: [0.25, 0.25, 0.25, 0.25] };
if (part('fairness')) console.log('fairness (Normals everywhere: wins by start):');
if (part('fairness')) for (const n of [2, 3, 4]) {
  const wins = Array(n).fill(0);
  for (let seed = 1; seed <= N; seed++) { const r = war(seed, Array(n).fill('normal')); if (r.winner >= 0) wins[r.winner]++; }
  share[n] = wins.map((w) => w / N);
  console.log(`  ${n} players: ${wins.map((w, i) => `${D.DOM_STARTS[i]} ${Math.round((w / N) * 100)}%`).join(' · ')}`);
}

let unfinished = 0;
if (part('pace')) console.log('pace (Normals, game minutes at ×1):');
if (part('pace')) for (const n of [2, 3, 4]) {
  const mins = [];
  for (let seed = 1; seed <= N; seed++) { const r = war(seed, Array(n).fill('normal')); if (r.winner < 0) unfinished++; mins.push(r.min); }
  mins.sort((a, b) => a - b);
  const q = (k) => Math.round(mins[Math.min(mins.length - 1, Math.floor(k * mins.length))]);
  console.log(`  ${n} players: shortest ${q(0)} · median ${q(0.5)} · longest ${q(1)}`);
}

if (process.argv.includes('--check')) {
  check(hn >= 0.7, `Hard beats Normal (${Math.round(hn * 100)}%)`);
  check(ne >= 0.7, `Normal beats Easy (${Math.round(ne * 100)}%)`);
  check(share[2].every((x) => x >= 0.3), `both starts have a fair chance in 2-player wars (${share[2].map((x) => Math.round(x * 100)).join(' / ')}%)`);
  check(share[3].every((x) => x >= 0.15 && x <= 0.5), `every start has a fair chance in 3-player wars (${share[3].map((x) => Math.round(x * 100)).join(' / ')}%)`);
  check(share[4].every((x) => x >= 0.1 && x <= 0.45), `every start has a fair chance in 4-player wars (${share[4].map((x) => Math.round(x * 100)).join(' / ')}%)`);
  check(!unfinished, `every war ends (${unfinished} didn't)`);
  console.log(failed ? `\n${failed} check(s) failed` : '\nall computer player checks passed');
  process.exit(failed ? 1 : 0);
}
