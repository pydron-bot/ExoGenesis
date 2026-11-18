/**
 * Roster batch A/B (docs/ROSTER.md) smoke test: Lancer, Sensor Mast, Habitat Block,
 * Relay Tower. Places them through the play-test setup, then checks what each does.
 *   node tools/roster-a-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);

await page.goto(`${url}?intro=0&new=1&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'geothermal', 'bay', 'habitat', 'sensor', 'relay'], alloys: 2000, peaceful: true } });
await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'relay'));
const b = await page.evaluate(() => __exo.sim.cur.buildings.map((x) => ({ kind: x.kind, x: x.x, z: x.z, progress: x.progress })));
for (const k of ['bay', 'habitat', 'sensor', 'relay']) check(b.some((x) => x.kind === k && x.progress >= 1), `${k} placed and finished`);

// Habitat Block: +6 housing, no pods
const housing = await page.evaluate(() => __exo.sim.cur.people.housing);
check(housing >= 6, `habitat adds housing (colony housing ${housing})`);

// Relay Tower: a spot past the normal build radius but inside its range is allowed
const relay = b.find((x) => x.kind === 'relay');
const spot = await page.evaluate(([rx, rz]) => {
  const len = Math.hypot(rx, rz) || 1, ux = rx / len, uz = rz / len;
  for (let r = 44; r <= 52; r += 1) for (let a = -0.6; a <= 0.6; a += 0.1) {
    const c = Math.cos(a), s = Math.sin(a), dx = ux * c - uz * s, dz = ux * s + uz * c;
    const x = rx + dx * r, z = rz + dz * r;
    // far from every other building (only the relay can make it legal)
    const others = __exo.sim.cur.buildings.filter((q) => q.kind !== 'relay');
    if (others.some((q) => Math.hypot(q.x - x, q.z - z) < 45)) continue;
    const why = __exo.canPlace('sensor', x, z);
    if (!why || !/outside the build area/.test(why)) return { x, z, why };
  }
  return null;
}, [relay.x, relay.z]);
check(!!spot && !spot.why, `relay extends the build area (${spot ? `${spot.x.toFixed(0)}, ${spot.z.toFixed(0)}: ${spot.why ?? 'ok'}` : 'no test spot found'})`);

// Lancer: produce at the bay, then it kills a brute with rail shots
const bay = await page.evaluate(() => __exo.sim.cur.buildings.find((x) => x.kind === 'bay').id);
await cmd({ type: 'produce', id: bay, unit: 'lancer' });
const made = await until(() => __exo.sim.cur.units.some((u) => u.unit === 'lancer'), null, 90000);
check(made, 'bay produces a lancer');
if (made) {
  const u = await page.evaluate(() => __exo.sim.cur.units.find((x) => x.unit === 'lancer'));
  await cmd({ type: 'debug', spawn: { unit: 'brute', x: u.x + 22, z: u.z + 4, n: 1 } });
  const t0 = await page.evaluate(() => __exo.sim.cur.stats.kills);
  const killed = await until((k) => __exo.sim.cur.stats.kills > k, t0, 40000);
  check(killed, 'lancer kills a brute');
}
check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
