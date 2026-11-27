/**
 * Domination areas (src/sim/areas.ts, DESIGN §5.12 phase 2).
 * Headless: 40 areas from content, the same every run; ids, names and links sound on every body; every area's map
 * generates fair (dry, flat bases that reach each other) for 2 and 4 players.
 * Browser: a skirmish on an area labels it on the globe ("you are here"), the system view counts each world's areas,
 * and the skirmish setup's Site row makes the area link.
 *   node tools/areas-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

const root = path.resolve(import.meta.dirname, '..');
const { module: A } = await runnerImport(path.join(root, 'src/sim/areas.ts'));
const { module: G } = await runnerImport(path.join(root, 'src/skirmish/mapgen.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const bodies = C.content.bodies;
const areas = A.systemAreas(bodies);
const want = Object.values(bodies).reduce((n, b) => n + (b.kind === 'giant' || b.kind === 'comet' ? 0 : b.areas ?? 0), 0);
check(areas.length === 40 && areas.length === want, `40 areas, as the bodies ask (${areas.length})`);
check(JSON.stringify(A.systemAreas(bodies)) === JSON.stringify(areas), 'the same areas every time');
check(new Set(areas.map((a) => a.id)).size === areas.length, 'ids unique');
check(areas.find((a) => a.id === 'home-1')?.name === 'Touchdown' && areas[0] && A.findArea('home-1', bodies)?.lat === 0, 'Home\'s first area is Touchdown');
const byBody = Object.groupBy(areas, (a) => a.body);
let namesOk = true, linksOk = true, connected = true;
for (const [b, list] of Object.entries(byBody)) {
  if (new Set(list.map((a) => a.name)).size !== list.length) namesOk = false;
  for (const a of list) for (const l of a.links) { const o = list.find((x) => x.id === l); if (!o || !o.links.includes(a.id)) linksOk = false; }
  const seen = new Set([list[0].id]), todo = [list[0]];
  while (todo.length) for (const l of todo.pop().links) if (!seen.has(l)) { seen.add(l); todo.push(list.find((x) => x.id === l)); }
  if (seen.size !== list.length) { connected = false; console.log('  not connected:', b); }
}
check(namesOk, 'names unique on each body');
check(linksOk, 'links go both ways and stay on the body');
check(connected, 'every body\'s areas are connected overland');
// seas: every area on a world with seas starts on land
const { module: P } = await runnerImport(path.join(root, 'src/world/planet.ts'));
// (Touchdown is the campaign's own site: the game lifts the ground round it, as it always has)
const wet = areas.filter((a) => a.id !== 'home-1' && bodies[a.body].ocean && P.bodyHeight(P.siteDir(a.lat, a.lon), P.bodyTerrain(a.body, bodies[a.body])) < 5);
check(!wet.length, `areas on sea worlds are on land${wet.length ? `: ${wet.map((a) => a.id)}` : ''}`);
const bad = [];
for (const a of areas) for (const players of [2, 4]) {
  const m = G.generateSkirmishMap({ seed: 3, players, size: a.size, world: a.body, water: 'some', relief: 'rolling', site: a }, bodies);
  if (!m.ok) bad.push(`${a.id}×${players}: ${m.report.problems.join(', ')}`);
}
check(!bad.length, `every area's map is fair for 2 and 4 players${bad.length ? `: ${bad.slice(0, 4).join(' / ')}` : ''}`);

if (!process.argv.includes('--headless-only')) {
  const { launch } = await import('./lib/harness.mjs');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?skirmish=7&area=verdance-3&players=2&sw=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
  const st = await page.evaluate(() => window.__exo.sim.save().then((s) => s.region));
  check(st === 'skirmish', 'the area plays as a skirmish');
  const labels = await page.evaluate(() => [...document.querySelectorAll('.label.area')].map((e) => [e.dataset.area, e.textContent, e.classList.contains('here')]));
  check(labels.length === 6 && labels.some(([id, t, h]) => id === 'verdance-3' && h && /you are here/.test(t)), `the globe labels Verdance's 6 areas, this one "you are here" (${labels.length})`);
  check(await page.evaluate(() => [...document.querySelectorAll('.label.province')].every((e) => e.style.opacity === '0' || e.style.opacity === '')), 'the provinces stay hidden');
  await page.evaluate(() => window.__exo.cam.setView('system'));
  await page.waitForTimeout(4000);
  const sys = await page.evaluate(() => document.getElementById('labels').innerText);
  check(/5 areas/.test(sys) && /1 area\b/.test(sys) && /6 areas/.test(sys), 'the system view counts each world\'s areas');
  // setup screen: World → Rime, Site → its second area, START goes to the area link
  await page.goto(`${url}?sw=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#title [data-id="skirmish"]'), null, { timeout: 180000 });
  await page.click('#title [data-id="skirmish"]');
  await page.click('#options [data-key="world"] button[data-v="rime"]');
  const sites = await page.$$eval('#options .sk-areas button', (bs) => bs.map((b) => b.dataset.v));
  check(sites.length === 6 && sites[0] === '' && sites[2] === 'rime-2', `Site lists Anywhere and Rime's 5 areas (${sites.join(',')})`);
  await page.click('#options .sk-areas button[data-v="rime-2"]');
  const moon = await page.$('#options [data-key="world"] button[data-v="vess"]');
  check(!!moon, 'moons with areas are worlds too');
  await Promise.all([page.waitForURL(/skirmish=/, { timeout: 60000 }), page.click('#options .sk-start')]);
  check(new URL(page.url()).searchParams.get('area') === 'rime-2' && new URL(page.url()).searchParams.get('world') === 'rime', 'START plays the area');
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall area checks passed');
process.exit(failed ? 1 : 0);
