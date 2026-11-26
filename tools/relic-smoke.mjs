/**
 * Relic grid (docs/ROSTER.md batch B, STORY.md E2): a grid sleeps until we come close, wakes
 * with half its sentinels standing down, and falls when its nodes are destroyed (or re-tuned by
 * Field Engineers after Relic Studies), opening its cache.
 *   node tools/relic-smoke.mjs [--url http://localhost:5176/]
 */
import { launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await launch();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const errors = [];

async function game() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
  const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
  const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  return { page, cmd, until };
}

// 1. fight through: an army wakes the grid and destroys both nodes
{
  const { page, cmd, until } = await game();
  await cmd({ type: 'debug', setup: { peaceful: true } });
  const cache0 = await page.evaluate(() => __exo.sim.cur.caches[0]);
  check(!!cache0 && !cache0.opened, 'Touchdown has a sealed relic cache');
  const flags = () => page.evaluate(() => __exo.sim.cur.story.flags);
  check(!(await flags()).includes('relic-woke'), 'the grid sleeps at the start');
  await cmd({ type: 'debug', units: { unit: 'lancer', x: 14, z: 64, n: 8 } });
  await cmd({ type: 'debug', units: { unit: 'tank', x: 20, z: 64, n: 4 } });
  check(await until(() => __exo.sim.cur.story.flags.includes('relic-woke'), null, 20000), 'an army close by wakes the grid (flag relic-woke)');
  const ids = await page.evaluate(() => __exo.sim.cur.units.map((u) => u.id));
  const a0 = await page.evaluate(() => __exo.sim.cur.alloys);
  await cmd({ type: 'order', ids, x: 18, z: 96 });
  check(await until(() => __exo.sim.cur.story.flags.includes('relic-opened'), null, 150000), 'destroying the nodes shuts the grid down (flag relic-opened)');
  const c = await page.evaluate(() => ({ cache: __exo.sim.cur.caches[0], alloys: __exo.sim.cur.alloys }));
  check(c.cache.opened && c.alloys >= a0 + 300, `the cache opens and pays out (+${Math.round(c.alloys - a0)} alloys)`);
  await page.close();
}

// 2. talk to it: after Relic Studies, engineers re-tune the nodes once the awake sentinels are down
{
  const { page, cmd, until } = await game();
  await cmd({ type: 'debug', setup: { peaceful: true, research: ['deep-survey', 'relic-studies'] } });
  // lancers outrange sentinels: one squad per awake sentinel, out of reach of the nodes (and the NE nest)
  await cmd({ type: 'debug', units: { unit: 'lancer', x: -26, z: 78, n: 4 } });
  await cmd({ type: 'debug', units: { unit: 'lancer', x: 40, z: 64, n: 4 } });
  check(await until(() => __exo.sim.cur.story.flags.includes('relic-woke'), null, 20000), 'the grid wakes');
  await page.waitForTimeout(25000);
  await cmd({ type: 'debug', units: { unit: 'engineer', x: 10, z: 95, n: 1 } });
  await cmd({ type: 'debug', units: { unit: 'engineer', x: 28, z: 99, n: 1 } });
  const k0 = await page.evaluate(() => __exo.sim.cur.stats.kills);
  check(await until(() => __exo.sim.cur.story.flags.includes('relic-opened'), null, 90000), 'engineers re-tune both nodes and the grid lets go');
  check(await page.evaluate(() => __exo.sim.cur.units.filter((u) => u.unit === 'engineer').length) >= 1, 'an engineer survives');
  const k1 = await page.evaluate(() => __exo.sim.cur.stats.kills);
  check(k1 === k0, `re-tuning isn't a kill (${k1 - k0})`);
  await page.close();
}
check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
