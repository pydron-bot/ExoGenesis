/**
 * Isotopes and research (docs/ROSTER.md batch B): Tech Lab → Deep Survey → Deep-Core Mine on a
 * seam → isotopes → Fusion Cell burning them. Also the Too Good story card.
 *   node tools/research-smoke.mjs [--url http://localhost:5176/]
 */
import { launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const cur = (f) => page.evaluate(f);
const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);

await page.goto(`${url}?intro=0&new=1&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'solar', 'geothermal', 'battery', 'lab'], alloys: 3000, peaceful: true } });
await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'lab'));
check(await cur(() => __exo.sim.cur.seams.length >= 1), 'region has isotope seams');

// the mine is locked until Deep Survey is done
const seam = await cur(() => __exo.sim.cur.seams[0]);
const n0 = await cur(() => __exo.sim.cur.buildings.length);
await cmd({ type: 'build', kind: 'deepmine', x: seam.x, z: seam.z });
await page.waitForTimeout(500);
check(await cur(() => __exo.sim.cur.buildings.length) === n0, 'Deep-Core Mine refused before research');

await cmd({ type: 'research', id: 'deep-survey' });
check(await until(() => __exo.sim.cur.research.active?.id === 'deep-survey', null, 5000), 'Deep Survey started at the Tech Lab');
check(await until(() => __exo.sim.cur.research.done.includes('deep-survey'), null, 90000), 'Deep Survey completes');
check(await until(() => __exo.sim.cur.story.inbox.includes('too-good') || __exo.sim.cur.story.flags.includes('pods-too-good'), null, 30000), 'Too Good card after the lab is built');

// a Relay Tower toward the seam brings it inside the build area; then the mine goes on it
const relaySpot = await page.evaluate(([sx, sz]) => {
  const L = Math.hypot(sx, sz);
  for (let d = 40; d > 20; d -= 2) for (let a = -0.5; a <= 0.5; a += 0.1) {
    const c = Math.cos(a), s = Math.sin(a), ux = sx / L, uz = sz / L;
    const x = (ux * c - uz * s) * d, z = (ux * s + uz * c) * d;
    if (!__exo.canPlace('relay', x, z)) return { x, z };
  }
  return null;
}, [seam.x, seam.z]);
check(!!relaySpot, 'a spot for a Relay Tower toward the seam');
if (relaySpot) await cmd({ type: 'build', kind: 'relay', ...relaySpot });
check(await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'relay' && b.progress >= 1), null, 90000), 'drones finish the Relay Tower');
check(await cur(() => !__exo.canPlace('deepmine', __exo.sim.cur.seams[0].x, __exo.sim.cur.seams[0].z)), 'the seam is now buildable');
await cmd({ type: 'debug', setup: { buildings: ['deepmine'] } });
check(await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'deepmine' && b.progress >= 1)), 'Deep-Core Mine placed on a seam');
check(await until(() => __exo.sim.cur.isotopes > 0.5, null, 30000), 'isotopes are mined');

// Fusion Cell: unlocked by Isotope Cells, burns isotopes for power, dark without them
await cmd({ type: 'debug', setup: { research: ['isotope-cells'], isotopes: 60, buildings: ['fusion'] } });
check(await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'fusion' && b.progress >= 1 && b.powered)), 'Fusion Cell powered while it has isotopes');
const gen = await cur(() => __exo.sim.cur.gen);
check(gen >= 16, `Fusion Cell adds its power (gen ${gen.toFixed(1)} MW)`);
check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
