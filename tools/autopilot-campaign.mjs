/**
 * How far the autopilot gets through the campaign (TECH.md "Autopilot"), headless: its brain
 * (src/sim/autopilot.ts) plays the real sim on every region it travels to, each region its own Sim and save, the
 * shared state carried as the game carries it (`sharedOf` / `applyShared`, `forgetRegion` for a lost expedition).
 * Cards are answered at once with the policy's choice and cinematics are done at once (the renderer reads and
 * plays them in the game), so it runs faster than a watcher would see it. Prints each trip, a line every 5 minutes
 * (unless --quiet), then a summary: missions done with their times, the ending (or how it stopped), the home
 * colony's state, every assist used and every loss.
 *   node tools/autopilot-campaign.mjs [--minutes 300] [--assist] [--seed 1337] [--policy first] [--quiet] [--json]
 *   node tools/autopilot-campaign.mjs --seeds 1,2,3 [--assist] …   (several seeds, in parallel, one table)
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const assist = process.argv.includes('--assist');
const quiet = process.argv.includes('--quiet');
const trace = process.argv.includes('--trace');
const asJson = process.argv.includes('--json');
const fmt = (secs) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

if (arg('--seeds')) {
  // several seeds: each its own process (in parallel, a few at a time), then one table
  const seeds = arg('--seeds').split(',').map(Number);
  const pass = process.argv.slice(2).filter((a, i, all) => a !== '--seeds' && all[i - 1] !== '--seeds' && a !== '--quiet' && a !== '--json');
  const jobs = Number(arg('--jobs', 3));
  const results = [];
  let next = 0;
  const one = (seed) => new Promise((res) => {
    const p = spawn(process.execPath, [import.meta.filename, ...pass, '--seed', String(seed), '--json', '--quiet'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { const line = out.trim().split('\n').pop(); try { results.push(JSON.parse(line)); } catch { results.push({ seed, error: out.slice(-400) }); } res(); });
  });
  await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, async () => { while (next < seeds.length) await one(seeds[next++]); }));
  results.sort((a, b) => a.seed - b.seed);
  console.log(`autopilot campaign, ${assist ? 'with' : 'without'} assist`);
  for (const r of results) {
    if (r.error) { console.log(`seed ${r.seed}: error ${r.error}`); continue; }
    console.log(`seed ${String(r.seed).padEnd(5)} ${String(r.missions.length).padStart(2)}/${r.of} missions · ${r.ending ? `ENDING ${r.ending}` : `stopped: ${r.stop}`} at ${fmt(r.secs)} · home: ${r.home} · assists ${r.assists.length}`);
  }
  for (const r of results) if (!r.error) {
    console.log(`\nseed ${r.seed}: ${r.missions.map((m) => `${m.id} ${fmt(m.t)}`).join(', ')}`);
    for (const n of [...r.assists, ...r.losses]) console.log(`  ${n}`);
  }
  process.exit(0);
}

const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const seed = Number(arg('--seed', 1337));
const policy = arg('--policy', 'first');
const MAX = Number(arg('--minutes', 300)) * 60;
const log = (...a) => { if (!quiet) console.log(...a); };
const saves = {};
let shared, region = M.HOME_REGION, total = 0;
const assists = [], losses = [], missions = [];
let ending = null, stop = 'time', homeState = '—';
const mm = () => fmt(total);
const pick = (() => { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) | 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; })();
const homeOf = (s) => {
  const core = s.buildings.find((b) => b.kind === 'core' && !b.team);
  const n = (k) => s.buildings.filter((b) => b.kind === k && !b.team).length;
  return `core ${core ? Math.round(core.hp) : 'lost'}, cryo ${Math.round(s.cryo)}, ${s.people?.colonists.length ?? 0} colonists, ${s.buildings.filter((b) => !b.team).length} buildings (${n('turret') + n('pointdefense') + n('cannon')} guns), ${Math.round(s.alloys)} alloys, sol ${Math.floor(s.tick / 10 / M.content.colony.solSeconds) + 1}`;
};
const t0 = Date.now();
const doneSeen = new Set();
// each region's sim its own seed (the same region on the same seed plays the same way)
const seedOf = (r) => seed + [...r].reduce((a, c) => a + c.charCodeAt(0), 0) * (r === M.HOME_REGION ? 0 : 1);
while (total < MAX) {
  M.useRegion(region);
  const sim = new M.Sim((t) => { if (/fallen|is lost|failed|drained/i.test(t)) losses.push(`${mm()} ${region}: ${t}`); }, seedOf(region));
  if (saves[region]) { const st = structuredClone(saves[region]); if (shared) M.applyShared(st, shared, region); sim.load(st); }
  else { if (shared) { M.applyShared(sim.s, shared, region); sim.arrived(); } sim.command({ type: 'landing', stage: 'deploy' }); }
  const ap = new M.Autopilot(sim, (t) => { if (/assist/i.test(t)) assists.push(`${mm()} ${region}: ${t}`); });
  ap.configure({ on: true, assist, assistMinutes: 6 });
  log(`${mm().padStart(7)} → ${region} (under way: ${sim.s.missions.active.join(', ') || 'nothing'})`);
  while (total < MAX && !sim.s.over && !sim.s.travel) {
    ap.tick(); sim.step();
    if (sim.s.tick % 10) continue;
    total++;
    const st = sim.s.story;
    for (const id of [...(st.cineQueue ?? [])]) sim.command({ type: 'cinematic', id, done: true });
    for (const id of [...st.inbox]) { const ev = M.content.story[id], sh = ev ? M.shownChoices(ev, st.flags) : []; sim.command({ type: 'story', id, choice: sh.length ? M.pickChoice(policy, sh, ev.choices.map((c) => c.label), pick) : 0 }); }
    for (const id of sim.s.missions.done) if (!doneSeen.has(id)) { doneSeen.add(id); missions.push({ id, t: total, region }); log(`${mm().padStart(7)}   ✓ ${id}`); }
    if (region === M.HOME_REGION && total % 30 === 0) homeState = homeOf(sim.s);
    if (trace && total % 60 === 0) {
      const b = sim.s.buildings.filter((x) => !x.team), n = (k) => b.filter((x) => x.kind === k).length;
      log(`${mm().padStart(7)}   · ${ap.status().doing} | fight ${ap.fight ? ap.fight.f.why : "-"} | plan ${(ap.bot?.plan ?? []).slice(0, 5).map((p) => p.slice(0, 2).join(':')).join(' ')} | ${b.length} bld, guns ${n('turret')}/${n('pointdefense')}/${n('cannon')}, dep ${n('depot')}, bat ${n('battery')}, sol ${n('solar')}, geo ${n('geothermal')}, units ${(sim.s.units ?? []).filter((u) => !u.team).length}, ${Math.round(sim.s.alloys)}◆ ${Math.round(sim.s.isotopes ?? 0)}◇, pack#${sim.s.waves.n}, hostiles ${sim.s.hostiles.length}, cryo ${Math.round(sim.s.cryo)}, core ${Math.round(b.find((x) => x.kind === 'core')?.hp ?? 0)}, stored ${Math.round(sim.s.stored)}, lab ${b.filter((x) => x.kind === "lab").map((x) => `${x.progress.toFixed(1)}${x.powered ? "P" : "-"}`).join("+")} res ${sim.s.research?.active ? sim.s.research.active.id + ":" + sim.s.research.active.progress.toFixed(2) : "-"}, mined ${Math.round(sim.s.stats.mined)}, lost ${sim.s.stats.buildingsLost}, deps ${sim.s.deposits.map((d) => Math.round(d.alloys)).join("/")}`);
    }
    if (process.env.AP_UNITS && region === M.HOME_REGION && total % 30 === 0) {
      log(`${mm().padStart(7)}   units: ${(sim.s.units ?? []).filter((u) => !u.team).map((u) => `${u.unit[0]}${u.id}@${Math.round(u.x)},${Math.round(u.z)} ${Math.round(u.hp)}hp ${u.order.kind}${u.target >= 0 ? '!' : ''}`).join(' ')} | awake: ${sim.s.hostiles.filter((h) => h.nest === undefined && !h.dormant).map((h) => `${h.unit}@${Math.round(h.x)},${Math.round(h.z)}`).join(' ')}`);
    }
    if (total % 300 === 0) {
      const m = sim.s.missions;
      log(`${mm().padStart(7)}   ${ap.status().doing || '—'} · ${m.active.map((id) => `${id} ${(m.marks[id] ?? []).length}/${M.content.missions[id]?.objectives.length}`).join(', ')} · ${sim.s.buildings.filter((b) => !b.team).length} buildings, ${(sim.s.units ?? []).filter((u) => !u.team).length} units, ${Math.round(sim.s.alloys)} alloys, ${Math.round(sim.s.isotopes ?? 0)} isotopes, cryo ${Math.round(sim.s.cryo)}, ${sim.s.hostiles.length} hostiles`);
    }
  }
  if (region === M.HOME_REGION) homeState = homeOf(sim.s);
  if (trace) log(`   spent in ${region}: ${Object.entries(ap.spent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
  if (sim.s.over) {
    log(`${mm().padStart(7)}   ${region}: game over (${sim.s.over})`);
    if (sim.s.story?.epilogue) { ending = sim.s.story.epilogue.ending; stop = 'ending'; break; }
    if (region === M.HOME_REGION || M.campaignOver(sim.s, region) === 'ended') { stop = `${region} lost (${sim.s.over})`; break; }
    losses.push(`${mm()} ${region}: expedition lost (${sim.s.over})`);
    delete saves[region]; shared = M.forgetRegion(M.sharedOf(sim.s), region, M.content); region = M.HOME_REGION;
    continue;
  }
  if (!sim.s.travel) break;
  const to = sim.s.travel;
  delete sim.s.travel;
  saves[region] = structuredClone(sim.s); shared = M.sharedOf(sim.s); region = to;
}
if (!ending && saves[M.HOME_REGION] && region !== M.HOME_REGION) homeState = homeOf(saves[M.HOME_REGION]);
const of = Object.keys(M.content.missions).length;
if (asJson) {
  console.log(JSON.stringify({ seed, assist, missions, of, ending, stop, secs: total, home: homeState, assists, losses, wall: Math.round((Date.now() - t0) / 1000) }));
} else {
  console.log(`\nseed ${seed}, ${assist ? 'with' : 'without'} assist: ${missions.length} of ${of} missions · ${ending ? `ENDING ${ending}` : `stopped: ${stop}`} at ${mm()}`);
  console.log(`missions: ${missions.map((m) => `${m.id} ${fmt(m.t)}`).join(', ')}`);
  console.log(`home: ${homeState}`);
  for (const n of [...assists, ...losses]) console.log(n);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
