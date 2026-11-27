/**
 * Old saves still load (headless): colonies saved by past versions (tools/fixtures/saves/v*.json, made by playing
 * the balance bot for 8 minutes on that version's code) go through today's Sim.load and play on for two minutes.
 * Catches a field the migrations in Sim.load forgot. Add a fixture when the save shape changes:
 *   see docs/TECH.md "Safety nets" (the script there makes one from any commit).
 *   node tools/saves-compat-smoke.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';
import { checker } from './lib/harness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const { check, done } = checker();
const dir = path.join(root, 'tools/fixtures/saves');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const { version, sim: state } = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const region = state.region ?? 'touchdown';
  M.planet.setRegionTerrain(M.planet.regionTerrain(M.content.regions[region], M.content.bodies));
  M.useRegion(region);
  const sim = new M.Sim(() => {}, 1);
  let err = null;
  try {
    sim.load(structuredClone(state));
    for (let i = 0; i < 1200; i++) sim.step();
    sim.snapshot();
  } catch (e) { err = e; }
  check(!err, `v${version}: loads and plays 2 minutes${err ? ` (${err.message})` : ''}`);
  if (err) continue;
  check(sim.s.buildings.length >= Math.min(1, state.buildings.length) && sim.s.buildings.some((b) => b.kind === 'core'), `v${version}: the colony is there (${sim.s.buildings.length} buildings, was ${state.buildings.length})`);
  check(sim.s.tick > state.tick, `v${version}: time goes on (tick ${state.tick} → ${sim.s.tick})`);
  // and today's save of it loads again
  let again = null;
  try { const s2 = new M.Sim(() => {}, 1); s2.load(JSON.parse(JSON.stringify(sim.s))); s2.step(); } catch (e) { again = e; }
  check(!again, `v${version}: saved again, it loads${again ? ` (${again.message})` : ''}`);
}
done();
