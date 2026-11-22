/**
 * Regions: a region moved elsewhere on the planet gets different ground, its
 * difficulty overrides reach the sim, the editor's Play test (?preview=1)
 * plays an unsaved draft, and a save from one region won't load in another.
 *   node tools/region-smoke.mjs [--url http://localhost:5176/]
 * Headless half (no browser): the sim's useRegion on the real content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- headless: the sim ----------
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { content } = C;
const td = content.regions.touchdown;

check(core.useRegion('no-such-region') === 'touchdown', 'unknown region falls back to Touchdown');
let sim = new core.Sim(() => {});
check(sim.s.region === 'touchdown', 'new game records its region');
// (this import of planet.ts is its own copy, so it is pointed at each region by hand)
const probe = () => [planet.regionHeightRaw(80, 60), planet.regionHeightRaw(-90, 30), planet.regionFlora(40, -70)];
planet.setRegionTerrain(td);
const h0 = probe();

const moved = { ...td, name: 'Far Side', siteLat: 25, siteLon: 70, packScale: 0.5, graceSeconds: 30, waveInterval: 40, startAlloys: 777 };
check(core.useRegion('farside', moved) === 'farside', 'a draft region is used as given');
sim = new core.Sim(() => {});
sim.command({ type: 'landing', stage: 'deploy' });
planet.setRegionTerrain(moved);
const h1 = probe();
check(h0.some((h, i) => Math.abs(h - h1[i]) > 1), `moving the site changes the ground (${h0.map((h) => h.toFixed(1))} → ${h1.map((h) => h.toFixed(1))})`);
check(sim.s.region === 'farside' && sim.s.alloys === 777, 'region starting alloys apply');
check(sim.s.waves.next === 30 * 10, 'region grace period applies');
for (let i = 0; i < 31 * 10; i++) sim.step();
const first = sim.s.packs[0];
const full = Math.round(content.threats.startSize);
check(first && first.size <= Math.ceil(full * 0.5 * content.threats.nightBoost), `region pack scale applies (first pack ${first?.size}, rules say ${full})`);
check(sim.s.waves.next - sim.s.tick <= (40 + content.threats.waveJitter) * 10, 'region pack interval applies');

// on a body with seas the ground round a region is lifted dry, unless it keeps its sea
const wet = () => { let w = 0; for (let x = -110; x <= 110; x += 10) for (let z = -110; z <= 110; z += 10) if (planet.regionHeightRaw(x, z) < 0.3) w++; return w; };
const coast = { ...td, height: undefined, flora: undefined, ground: undefined, siteLat: -16, siteLon: -12 };
planet.setRegionTerrain(planet.regionTerrain(coast, content.bodies));
const dryN = wet();
planet.setRegionTerrain(planet.regionTerrain({ ...coast, keepSea: true }, content.bodies));
const wetN = wet();
check(dryN === 0 && wetN > 50, `a coastal region is lifted dry (${dryN} wet samples) unless it keeps its sea (${wetN})`);
check(planet.regionHeightRaw(0, 0) >= 1.5, 'the Core\'s pad stays dry in a region that keeps its sea');

planet.setRegionTerrain(td);
const back = probe();
check(back.every((h, i) => Math.abs(h - h0[i]) < 1e-6), 'back at Touchdown the ground is as before');

// ---------- browser: the game ----------
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ready = () => page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur, null, { timeout: 120000 });

// a known autosave in Touchdown, to check the play test leaves it alone
await page.goto(`${url}?intro=0&new=1`);
await ready();
await page.evaluate(() => __exo.sim.flush());
await page.waitForTimeout(1500);
const autoBefore = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').get('auto'); g.onsuccess = () => res(g.result?.sim ? { region: g.result.sim.region, seed: g.result.sim.seed } : null); };
}));
check(autoBefore?.region === 'touchdown', 'Touchdown autosave written with its region');
const tdWet = await page.evaluate(() => {
  const w = __exo.region.water;
  if (!w) return 0;
  const d = w.geometry.getAttribute('aDepth'), xz = w.geometry.getAttribute('aXZ');
  let n = 0;
  for (let i = 0; i < d.count; i++) if (d.getX(i) < 0 && Math.abs(xz.getX(i)) < 115 && Math.abs(xz.getY(i)) < 115) n++;
  return n;
});
check(tdWet === 0, `Touchdown (lifted dry) has no water inside the region (${tdWet} wet vertices)`);

// the editor's Play test: draft in localStorage, ?preview=1
await page.evaluate((def) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'farside', def })), moved);
await page.goto(`${url}?preview=1&intro=0`);
await ready();
const pv = await page.evaluate(() => ({ alloys: __exo.sim.cur.alloys, label: [...document.querySelectorAll('#labels *')].map((e) => e.textContent).join('|') }));
check(pv.alloys >= 700, `preview plays the draft (alloys ${pv.alloys})`);
check(/FAR SIDE/.test(pv.label), 'the globe labels the region with its name');
const saved = await page.evaluate(() => __exo.sim.save());
check(saved.region === 'farside', 'preview game state carries the draft region');
await page.waitForTimeout(11000); // past an autosave interval
const autoAfter = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').get('auto'); g.onsuccess = () => res(g.result?.sim ? { region: g.result.sim.region, seed: g.result.sim.seed } : null); };
}));
check(autoAfter?.region === 'touchdown' && autoAfter.seed === autoBefore.seed, 'play test leaves the real autosave alone');

// a coastal region that keeps its sea gets water: the seabed sinks under it and picking hits the water
await page.evaluate((def) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'coast', def })), { ...coast, keepSea: true });
await page.goto(`${url}?preview=1&intro=0&new=1`);
await ready();
const wt = await page.evaluate(async () => {
  const w = __exo.region.water;
  if (!w) return null;
  const d = w.geometry.getAttribute('aDepth');
  let wet = 0;
  for (let i = 0; i < d.count; i++) if (d.getX(i) < 0) wet++;
  return { tris: w.geometry.index.count / 3, wet, detail: __exo.region.waterDetail };
});
check(wt && wt.tris > 1000 && wt.wet > 500, `a coastal region keeping its sea has water (${JSON.stringify(wt)})`);
check(wt?.detail === true, 'detailed water by default on desktop');

// a Touchdown save refuses to load in another region
const tdState = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').get('auto'); g.onsuccess = () => res(g.result.sim); };
}));
const logBefore = await page.textContent('#log').catch(() => '');
await page.evaluate((st) => __exo.sim.load(st), tdState);
await page.waitForTimeout(800);
const logAfter = await page.evaluate(() => document.body.innerText);
check(/another region/.test(logAfter) && !/another region/.test(logBefore ?? ''), 'a save from another region is refused');

// title, with a second region in content (a temporary file; the dev server reloads)
const tmp = path.join(root, 'content/regions/zz-smoke.json');
await page.goto('about:blank');
fs.writeFileSync(tmp, JSON.stringify({ ...moved, name: 'Smoke Test Basin' }, null, 1));
try {
  await page.waitForTimeout(2500);
  await page.goto(`${url}?region=zz-smoke`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes('OPTIONS'), null, { timeout: 120000 });
  const t = await page.evaluate(() => document.body.innerText);
  check(/Your colony in Touchdown/i.test(t), 'title offers CONTINUE into the other region\'s colony');
  check(/Land in Smoke Test Basin/i.test(t), 'NEW GAME names the region it lands in');
  check(!/\bREGION\b|\bSOUND\b/.test(t.replace(/ANYWHERE FOR SOUND/g, '')), 'region and sound are not on the title screen itself (the tap-for-sound hint aside)');
  await page.getByText('OPTIONS', { exact: true }).click();
  await page.waitForSelector('#options');
  const op = await page.evaluate(() => document.getElementById('options').innerText);
  check(/Region/i.test(op) && /Sound/.test(op) && /Smoke Test Basin\s*(\S+\s*)?HERE/i.test(op), 'Options lists the regions (this one HERE) and the sound');
  // picking a region only marks it (no reload); NEW GAME then loads it and lands there
  await page.evaluate(() => { window.__samePage = true; });
  await page.click('#options [data-id="region:touchdown"]');
  await page.waitForTimeout(800);
  const op2 = await page.evaluate(() => document.getElementById('options').innerText);
  check(await page.evaluate(() => window.__samePage === true) && new URL(page.url()).searchParams.get('region') === 'zz-smoke', 'picking a region in Options doesn\'t reload the page');
  check(/Touchdown\s*(\S+\s*)?HERE/i.test(op2) && !/Smoke Test Basin\s*(\S+\s*)?HERE/i.test(op2), 'Options marks the region picked');
  await page.keyboard.press('Escape');
  const t2 = await page.evaluate(() => document.body.innerText);
  check(/Land in Touchdown/i.test(t2), 'NEW GAME now names the picked region');
  // the colony saved in Touchdown: NEW GAME asks first, then starts fresh there (it used to reopen the save's region)
  await page.click('[data-id="new"]');
  await page.click('[data-id="new"]');
  await page.waitForURL((u) => u.searchParams.get('region') === 'touchdown', { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('cine') && window.__exo?.sim, null, { timeout: 120000 });
  check(!new URL(page.url()).searchParams.has('land'), 'NEW GAME lands in the picked region (Touchdown), and the address forgets the fresh start');
  check(await page.evaluate(() => !document.body.classList.contains('title')), 'it lands straight away, no title screen');
} finally {
  fs.rmSync(tmp, { force: true });
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall region checks passed');
process.exit(failed ? 1 : 0);
