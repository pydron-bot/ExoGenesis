/**
 * Headless balance runs: plays the real sim (src/sim/core.ts) for N game
 * minutes with scripted strategies and prints a timeline, so tuning content/
 * numbers is measured, not guessed.
 *   node tools/balance.mjs [--minutes 20] [--seed 1337] [--strategy all|idle|greedy|balanced|defensive|army|mixed|fortress|combined|people] [--imprint charter|heritage|guardian] [--peaceful] [--policy hours=long,council=directive] [--region touchdown] [--quiet]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const minutes = Number(arg('--minutes', 20));
const seed = Number(arg('--seed', 1337));
const only = arg('--strategy', 'all');
const quiet = process.argv.includes('--quiet');
/** --trace: every 10 s while hostiles are about, print the Core, hostiles and units. */
const trace = process.argv.includes('--trace');
const root = path.resolve(import.meta.dirname, '..');
// the bot and its strategies live in src/sim/balance.ts (the editor's Balance page runs the same code)
const { module: B } = await runnerImport(path.join(root, 'src/sim/balance.ts'));
const policy = Object.fromEntries((arg('--policy', '') || '').split(',').filter(Boolean).map((kv) => kv.split('=')));

function run(name) {
  const r = B.runBalance(name, {
    minutes, seed, region: arg('--region', 'touchdown'), peaceful: process.argv.includes('--peaceful'), policy, imprint: arg('--imprint', 'charter'),
    trace: trace ? (line) => console.log(line) : undefined,
  });
  console.log(`\n=== ${name} (seed ${seed}) — ${r.over ? `LOST (${r.over}) at ${r.at.toFixed(1)} min` : `survived ${minutes} min`}`);
  if (!quiet) {
    console.table(r.rows);
    console.log('first placed (s):', JSON.stringify(r.firsts));
    const shown = r.events.filter((e) => e.level !== 'info' || /destroyed|online/.test(e.text)).slice(0, 60);
    for (const e of shown) console.log(`  ${(e.t / 60).toFixed(1).padStart(5)}m ${e.level.padEnd(4)} ${e.text}`);
  }
  console.log(`  ${r.people}`);
  console.log(`  ${r.end}`);
}

for (const name of only === 'all' ? Object.keys(B.STRATEGIES) : only.split(',')) run(name);
