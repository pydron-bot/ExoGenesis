/**
 * Roster batch A/B (docs/ROSTER.md) smoke test: Lancer, Sensor Mast, Habitat Block,
 * Relay Tower, nests, wrecks. Places them through the play-test setup, then checks what each does.
 *   node tools/roster-a-smoke.mjs [--url http://localhost:5176/]
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


// Level of detail: zoomed out, the asset models give way to their procedural built-ins
const lodAt = (d) => page.evaluate(async (d) => {
  const c = __exo.cam; c.dist = c.targetDist = d;
  // frames can be slow in software rendering: wait (up to 15 s) for the switch, then a frame more
  for (let i = 0; i < 150 && __exo.region.lodNear !== d < 90; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  const r = __exo.region, pairs = [...r.lods];
  return { near: r.lodNear, pairs: pairs.length, shown: pairs.filter((l) => l.near.visible && !l.far.visible).length, far: pairs.filter((l) => l.far.visible && !l.near.visible).length };
}, d);
const zoomedOut = await lodAt(160);
check(!zoomedOut.near && zoomedOut.pairs >= 4 && zoomedOut.far === zoomedOut.pairs, `zoomed out: built-ins drawn (${zoomedOut.far}/${zoomedOut.pairs} pairs)`);
const zoomedIn = await lodAt(60);
check(zoomedIn.near && zoomedIn.shown === zoomedIn.pairs, `zoomed in: asset models drawn (${zoomedIn.shown}/${zoomedIn.pairs})`);

// Nests: one per spawn; killing one stops packs from that side until it regrows
const nests0 = await page.evaluate(() => __exo.sim.cur.nests);
check(nests0.length >= 2 && nests0.every((n) => n.alive), `a nest on every spawn (${nests0.length})`);
const nn = nests0[0];
await cmd({ type: 'debug', units: { unit: 'lancer', x: nn.x * 0.8, z: nn.z * 0.8, n: 6 } });
await cmd({ type: 'debug', units: { unit: 'arc', x: nn.x * 0.84, z: nn.z * 0.84, n: 4 } });
const ids = await page.evaluate(() => __exo.sim.cur.units.map((u) => u.id));
await cmd({ type: 'order', ids, x: nn.x * 0.88, z: nn.z * 0.88 });
const guards = await until(() => __exo.sim.cur.packs.length > 0, null, 60000);
check(guards, 'a hurt nest lets out its guards');
const dead = await until(() => !__exo.sim.cur.nests[0].alive, null, 120000);
check(dead, 'units destroy the nest');
if (dead) {
  const before = await page.evaluate(() => __exo.sim.cur.packs.length);
  await cmd({ type: 'debug', wave: true });
  await until((n) => __exo.sim.cur.packs.length > n, before, 10000);
  const from = await page.evaluate(([x, z]) => { const p = __exo.sim.cur.packs.at(-1); return p ? Math.hypot(p.x - x, p.z - z) : -1; }, [nn.x, nn.z]);
  check(from > 40, `the next pack comes from another spawn (${from.toFixed(0)} u from the dead nest)`);
}

// Wrecks: sighted when in view, then salvaged by an engineer
const w0 = await page.evaluate(() => __exo.sim.cur.wrecks[0]);
if (w0) {
  await cmd({ type: 'debug', units: { unit: 'engineer', x: w0.x + 6, z: w0.z, n: 1 } });
  const seen = await until(() => __exo.sim.cur.wrecks[0].found && __exo.sim.cur.story.flags.includes('wreck-found'), null, 20000);
  check(seen, 'wreck sighted (flag wreck-found)');
  const a0 = await page.evaluate(() => __exo.sim.cur.wrecks[0].alloys);
  const stripped = await until((a) => __exo.sim.cur.wrecks[0].alloys < a - 10, a0, 30000);
  check(stripped, 'engineer salvages the wreck');
} else check(false, 'region has a wreck');
check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
