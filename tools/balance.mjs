/**
 * Headless balance runs: plays the real sim (src/sim/core.ts) for N game
 * minutes with scripted strategies and prints a timeline, so tuning content/
 * numbers is measured, not guessed.
 *   node tools/balance.mjs [--minutes 20] [--seed 1337] [--strategy all|idle|greedy|balanced|defensive] [--quiet]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const minutes = Number(arg('--minutes', 20));
const seed = Number(arg('--seed', 1337));
const only = arg('--strategy', 'all');
const quiet = process.argv.includes('--quiet');
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: rules } = await runnerImport(path.join(root, 'src/sim/rules.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { content } = C;
const DEFS = content.buildings, RULES = content.colony;
const TICK_HZ = 10;

/** Valid spot for `kind` nearest to (px, pz), searching outward. */
function spot(s, kind, px, pz) {
  for (let r = 0; r < 70; r += 2) {
    const n = Math.max(1, Math.round(r * 1.2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (!rules.placeProblem(s, DEFS, RULES, kind, x, z)) return { x, z };
    }
  }
  return null;
}
const count = (s, kind) => s.buildings.filter((b) => b.kind === kind).length;
const spawns = content.regions.touchdown.spawns;

const STRATEGIES = {
  idle: () => [],
  // economy only, no defense
  greedy: () => [['solar'], ['solar'], ['depot', 'near'], ['solar'], ['depot', 'near'], ['battery'], ['solar'], ['depot', 'near'], ['solar'], ['battery'], ['fab']],
  balanced: () => [['solar'], ['solar'], ['depot', 'near'], ['turret', 'guard'], ['battery'], ['solar'], ['turret', 'spawn'], ['radar'], ['depot', 'near'], ['turret', 'guard'], ['solar'], ['battery'], ['fab'], ['turret', 'spawn'], ['solar'], ['turret', 'spawn'], ['battery'], ['solar'], ['turret', 'spawn'], ['turret', 'guard']],
  defensive: () => [['solar'], ['turret', 'spawn'], ['solar'], ['turret', 'spawn'], ['depot', 'near'], ['turret', 'guard'], ['battery'], ['turret', 'spawn'], ['solar'], ['radar'], ['battery'], ['turret', 'spawn'], ['solar'], ['turret', 'spawn']],
};

function run(name) {
  const events = [];
  const sim = new core.Sim((text, level) => events.push({ t: sim.secs, text, level }), seed);
  sim.command({ type: 'landing', stage: 'deploy' });
  const plan = STRATEGIES[name]();
  let spawnIdx = 0;
  const rows = [];
  const firsts = {};
  for (let tick = 0; tick < minutes * 60 * TICK_HZ; tick++) {
    const s = sim.s;
    if (s.over) break;
    // the bot: every second, try the next item in its plan
    if (tick % TICK_HZ === 0 && plan.length) {
      const [kind, where] = plan[0];
      if (kind === 'fab') {
        if (s.alloys >= RULES.droneCost) { sim.command({ type: 'fab' }); plan.shift(); }
      } else if (s.alloys >= DEFS[kind].cost) {
        let target = { x: 0, z: -10 };
        if (where === 'near') {
          // nearest deposit with alloys that no depot covers yet
          const free = s.deposits.map((d, i) => ({ d, i })).filter(({ d, i }) => d.alloys > 0 && !s.buildings.some((b) => b.kind === 'depot' && b.mining === i))
            .sort((a, b) => Math.hypot(a.d.x, a.d.z) - Math.hypot(b.d.x, b.d.z));
          if (free.length) target = { x: free[0].d.x * 0.75, z: free[0].d.z * 0.75 };
        } else if (where === 'guard') {
          // next to the newest depot, on the side facing the nearest spawn
          const dep = [...s.buildings].reverse().find((b) => b.kind === 'depot');
          if (dep) {
            const sp = [...spawns].sort((a, b) => Math.hypot(a.x - dep.x, a.z - dep.z) - Math.hypot(b.x - dep.x, b.z - dep.z))[0];
            const k = 10 / Math.hypot(sp.x - dep.x, sp.z - dep.z);
            target = { x: dep.x + (sp.x - dep.x) * k, z: dep.z + (sp.z - dep.z) * k };
          }
        } else if (where === 'spawn') {
          const sp = spawns[spawnIdx++ % spawns.length];
          const k = 34 / Math.hypot(sp.x, sp.z);
          target = { x: sp.x * k, z: sp.z * k };
        }
        const p = spot(s, kind, target.x, target.z);
        if (p) { sim.command({ type: 'build', kind, ...p }); plan.shift(); firsts[kind] ??= Math.round(sim.secs); }
      }
    }
    sim.step();
    if (tick % (60 * TICK_HZ) === 0) {
      const snap = sim.snapshot();
      rows.push({
        min: tick / 600, alloys: Math.floor(s.alloys), cryo: s.cryo.toFixed(0), gen: snap.gen.toFixed(1), draw: snap.draw.toFixed(1),
        stored: Math.round(s.stored), day: snap.daylight.toFixed(2), built: s.buildings.filter((b) => b.progress >= 1).length - 1,
        hostiles: s.hostiles.length, kills: s.stats.kills, lost: s.stats.buildingsLost, packs: s.waves.n,
      });
    }
  }
  const s = sim.s;
  console.log(`\n=== ${name} (seed ${seed}) — ${s.over ? `LOST (${s.over}) at ${(sim.secs / 60).toFixed(1)} min` : `survived ${minutes} min`}`);
  if (!quiet) {
    console.table(rows);
    console.log('first placed (s):', JSON.stringify(firsts));
    const shown = events.filter((e) => e.level !== 'info' || /destroyed|online/.test(e.text)).slice(0, 60);
    for (const e of shown) console.log(`  ${(e.t / 60).toFixed(1).padStart(5)}m ${e.level.padEnd(4)} ${e.text}`);
  }
  console.log(`  end: alloys ${Math.floor(s.alloys)} · cryo ${s.cryo.toFixed(0)}% · kills ${s.stats.kills} · buildings lost ${s.stats.buildingsLost} · drones lost ${s.stats.dronesLost} · packs ${s.waves.n} (beaten ${s.stats.packsBeaten}) · mined ${Math.round(s.stats.mined)}`);
  return s;
}

for (const name of only === 'all' ? Object.keys(STRATEGIES) : only.split(',')) run(name);
