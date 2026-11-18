/**
 * Story playthroughs, headless: the balance bot plays while every story card
 * is answered by a policy, and the story's timeline is printed (missions,
 * events, choices, flags, counters), then what all the runs covered between
 * them (events never fired, choices never taken, missions never finished).
 * The editor's Story → Playthrough page runs the same code (src/sim/playthrough.ts).
 *   node tools/playthrough.mjs [--minutes 30] [--seed 1337] [--strategy people] [--policies first,last,random] [--region touchdown] [--peaceful] [--quiet]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const root = path.resolve(import.meta.dirname, '..');
const { module: P } = await runnerImport(path.join(root, 'src/sim/playthrough.ts'));
const minutes = Number(arg('--minutes', 30)), seed = Number(arg('--seed', 1337));
const quiet = process.argv.includes('--quiet');
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(3)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ICON = { mission: '▶', objective: '✓', done: '■', failed: '✕', event: '•', choice: '?', flag: '+', unflag: '−', counter: '#', countdown: '⏱', cinematic: '🎬', end: '!' };

const runs = [];
for (const policy of arg('--policies', 'first,last,random').split(',')) {
  const r = P.runPlaythrough({ strategy: arg('--strategy', 'people'), minutes, seed, region: arg('--region', 'touchdown'), peaceful: process.argv.includes('--peaceful'), policy });
  runs.push(r);
  console.log(`\n=== ${r.name} (seed ${seed}) — ${r.over ? `ended (${r.over}) at ${r.at.toFixed(1)} min${r.overText ? `: ${r.overText}` : ''}` : `played ${minutes} min`}`);
  if (!quiet) for (const b of r.beats) console.log(`  ${mmss(b.t)} ${ICON[b.kind] ?? ' '} ${b.kind.padEnd(9)} ${b.text}`);
  console.log(`  final: ${r.final.colonists} colonists · stance ${r.final.stance?.toFixed(0) ?? '—'} · counters ${JSON.stringify(r.final.counters)} · ${r.final.flags.length} flags`);
}
const cov = P.coverage(runs);
console.log(`\n=== coverage over ${runs.length} runs`);
console.log(`  events never fired: ${cov.neverFired.join(', ') || 'none'}`);
for (const [id, left] of Object.entries(cov.untaken)) console.log(`  choices never taken in ${id}: ${left.map((x) => `“${x}”`).join(', ')}`);
console.log(`  missions never started: ${cov.missionsNeverStarted.join(', ') || 'none'}`);
console.log(`  missions started but never done: ${cov.missionsNeverDone.join(', ') || 'none'}`);
for (const [id, s] of Object.entries(cov.spread)) console.log(`  ${id.padEnd(20)} done at ${mmss(s.min)}${s.max !== s.min ? ` – ${mmss(s.max)}` : ''} (${s.runs}/${runs.length} runs)`);
