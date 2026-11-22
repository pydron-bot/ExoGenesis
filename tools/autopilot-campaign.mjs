/**
 * How far the autopilot gets through the campaign (TECH.md "Autopilot"), headless: its brain
 * (src/sim/autopilot.ts) plays the real sim on every region it travels to, each region its own Sim and save, the
 * shared state carried as the game carries it (`sharedOf` / `applyShared`, `forgetRegion` for a lost expedition).
 * Cards are answered at once with the first choice offered and cinematics are done at once (the renderer reads and
 * plays them in the game), so it runs faster than a watcher would see it. Prints each trip, a line every 5 minutes,
 * the missions done and the assists.
 *   node tools/autopilot-campaign.mjs [--minutes 240] [--assist]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const assist = process.argv.includes('--assist');
const MAX = Number(arg('--minutes', 240)) * 60;
const saves = {};
let shared, region = M.HOME_REGION, total = 0;
const notes = [];
let done = [];
const mm = () => `${(total / 60).toFixed(1)}m`;
const t0 = Date.now();
while (total < MAX) {
  M.useRegion(region);
  const sim = new M.Sim((t) => { if (/assist|fallen|is lost|failed/i.test(t)) notes.push(`${mm()} ${region}: ${t}`); });
  if (saves[region]) { const st = structuredClone(saves[region]); if (shared) M.applyShared(st, shared, region); sim.load(st); }
  else { if (shared) { M.applyShared(sim.s, shared, region); sim.arrived(); } sim.command({ type: 'landing', stage: 'deploy' }); }
  const ap = new M.Autopilot(sim, (t) => notes.push(`${mm()} ${region}: ${t}`));
  ap.configure({ on: true, assist, assistMinutes: 6 });
  console.log(`${mm().padStart(7)} → ${region} (under way: ${sim.s.missions.active.join(', ') || 'nothing'})`);
  while (total < MAX && !sim.s.over && !sim.s.travel) {
    ap.tick(); sim.step();
    if (sim.s.tick % 10) continue;
    total++;
    const st = sim.s.story;
    for (const id of [...(st.cineQueue ?? [])]) sim.command({ type: 'cinematic', id, done: true });
    for (const id of [...st.inbox]) { const ev = M.content.story[id], sh = ev ? M.shownChoices(ev, st.flags) : []; sim.command({ type: 'story', id, choice: sh.length ? sh[0] : 0 }); }
    if (total % 300 === 0) {
      const m = sim.s.missions;
      console.log(`${mm().padStart(7)}   ${ap.status().doing || '—'} · ${m.active.map((id) => `${id} ${(m.marks[id] ?? []).length}/${M.content.missions[id]?.objectives.length}`).join(', ')} · ${sim.s.buildings.filter((b) => !b.team).length} buildings, ${(sim.s.units ?? []).filter((u) => !u.team).length} units, ${Math.round(sim.s.alloys)} alloys, ${sim.s.hostiles.length} hostiles`);
    }
  }
  done = [...sim.s.missions.done];
  if (sim.s.over) {
    console.log(`${mm().padStart(7)}   ${region}: game over (${sim.s.over})`);
    if (region === M.HOME_REGION || M.campaignOver(sim.s, region) === 'ended') break;
    delete saves[region]; shared = M.forgetRegion(M.sharedOf(sim.s), region, M.content); region = M.HOME_REGION;
    continue;
  }
  if (!sim.s.travel) break;
  const to = sim.s.travel;
  delete sim.s.travel;
  saves[region] = structuredClone(sim.s); shared = M.sharedOf(sim.s); region = to;
}
console.log(`\nmissions done (${done.length} of ${Object.keys(M.content.missions).length}): ${done.join(', ')}`);
console.log(notes.join('\n'));
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
