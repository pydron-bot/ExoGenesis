/**
 * The campaign's opening, measured headless (DESIGN §7: "are the first 20 minutes fun?").
 * The story playthrough bot plays Touchdown at a human-ish pace (one build step every
 * `--pace` seconds; it chases each mission's objectives) and this records when the
 * first things happen and how long the player is left waiting with nothing to do.
 *
 *   node tools/opening.mjs [--minutes 20] [--seeds 1337,7,42] [--pace 8] [--strategy opening] [--json]
 *
 * Milestones: first build placed, first building finished, first fight (a predator pack
 * within 40 u of something of ours), first kill, first colonist, first real decision
 * (a story card with choices, or a growth pod's imprint), tutorial missions done.
 * Waiting: a second counts as dead when nothing is being built, no fight is on, no
 * story card or objective landed in the last 15 s, and the bot can't afford its next step
 * (or has none). Stretches over 30 s are listed.
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const root = path.resolve(import.meta.dirname, '..');
const { module: P } = await runnerImport(path.join(root, 'src/sim/playthrough.ts'));
const { content } = (await runnerImport(path.join(root, 'src/content/index.ts'))).module;
const minutes = Number(arg('--minutes', 20)), pace = Number(arg('--pace', 8));
const seeds = arg('--seeds', '1337,7,42').split(',').map(Number);
const json = process.argv.includes('--json');
const mmss = (s) => (s === undefined ? '  —  ' : `${String(Math.floor(s / 60)).padStart(2)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

const costOf = (step) => {
  if (!step) return Infinity;
  const [k] = step;
  if (k === 'fab') return content.colony.droneCost;
  return content.buildings[k]?.cost ?? content.units[k]?.cost ?? 0;
};

const runs = [];
for (const seed of seeds) {
  const m = {}; // milestone → seconds
  let lastBeat = 0, idle = 0, run = 0, early = 0;
  const stretches = [];
  let seenFired = 0, seenMarks = 0;
  const onTick = (sim, tick, plan) => {
    if (tick % 10) return;
    const s = sim.s, t = sim.secs;
    const mine = s.buildings.filter((b) => (b.team ?? 0) === 0);
    if (mine.some((b) => b.kind !== 'core')) m.firstPlaced ??= t;
    if (mine.some((b) => b.kind !== 'core' && b.progress >= 1)) m.firstBuilt ??= t;
    const fighting = s.hostiles.some((h) => h.pack >= 0 && h.nest === undefined && (mine.some((b) => Math.hypot(b.x - h.x, b.z - h.z) < 40) || (s.units ?? []).some((u) => Math.hypot(u.x - h.x, u.z - h.z) < 30)));
    if (fighting && s.waves.n > 0) m.firstFight ??= t;
    if (s.stats.kills > 0) m.firstKill ??= t;
    const ppl = s.people;
    if (ppl?.pods.length) m.firstPod ??= t;
    if (ppl?.colonists.length) m.firstColonist ??= t;
    const st = s.story;
    if (st) {
      if (st.inbox.some((id) => content.story[id]?.choices?.length)) m.firstChoice ??= t;
      if (st.fired.length > seenFired) { seenFired = st.fired.length; lastBeat = t; }
    }
    const mk = s.missions ? s.missions.done.length * 10 + Object.values(s.missions.marks).reduce((a, x) => a + x.length, 0) : 0;
    if (mk > seenMarks) { seenMarks = mk; lastBeat = t; }
    for (const id of ['touchdown', 'groundwork', 'first-night', 'firstborn']) if (s.missions?.done.includes(id)) m[id] ??= t;
    const building = mine.some((b) => b.progress < 1) || s.fab.queued > 0 || mine.some((b) => b.queue?.length);
    const dead = !building && !fighting && t - lastBeat > 15 && s.alloys < costOf(plan[0]);
    if (dead) { idle++; run++; if (t < 600) early++; } else { if (run >= 30) stretches.push([t - run, run]); run = 0; }
  };
  const r = P.runPlaythrough({ strategy: arg('--strategy', 'opening'), minutes, seed, policy: 'first', pace, onTick });
  if (run >= 30) stretches.push([r.at * 60 - run, run]);
  runs.push({ seed, m, idle, early, stretches, over: r.over, at: r.at });
}

if (json) { console.log(JSON.stringify(runs, null, 1)); process.exit(0); }
const KEYS = [['firstPlaced', 'first build placed'], ['firstBuilt', 'first building up'], ['touchdown', 'Touchdown done'], ['groundwork', 'Groundwork done'],
  ['firstFight', 'first fight'], ['firstKill', 'first kill'], ['first-night', 'First Night done'], ['firstPod', 'first pod (imprint)'],
  ['firstColonist', 'first colonist'], ['firstChoice', 'first story choice'], ['firstborn', 'Firstborn done']];
console.log(`opening · ${minutes} min · bot pace ${pace} s/step · seeds ${seeds.join(', ')}`);
console.log(`${''.padEnd(22)}${runs.map((r) => String(r.seed).padStart(8)).join('')}`);
for (const [k, label] of KEYS) console.log(`${label.padEnd(22)}${runs.map((r) => mmss(r.m[k]).padStart(8)).join('')}`);
console.log(`${'dead waiting'.padEnd(22)}${runs.map((r) => mmss(r.idle).padStart(8)).join('')}`);
console.log(`${'  in the first 10 min'.padEnd(22)}${runs.map((r) => mmss(r.early).padStart(8)).join('')}`);
console.log(`${'longest wait'.padEnd(22)}${runs.map((r) => mmss(Math.max(0, ...r.stretches.map((x) => x[1]))).padStart(8)).join('')}`);
console.log(`${'ended'.padEnd(22)}${runs.map((r) => (r.over ? `${r.over}@${r.at.toFixed(0)}m` : 'alive').padStart(8)).join('')}`);
for (const r of runs) if (r.stretches.length) console.log(`  seed ${r.seed} waits: ${r.stretches.map(([a, n]) => `${mmss(a).trim()}+${n}s`).join(', ')}`);
