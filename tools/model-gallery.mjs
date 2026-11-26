/**
 * Model gallery: stages one of every building (finished, powered) and every unit in daylight, frozen,
 * once with the built-in models (?models=builtin) and once with the Blender set (?models=new), and shoots each up close.
 *   node tools/model-gallery.mjs [outDir=shots/gallery] [--only turret,brute] [--sets builtin,new] [--q batch=0]
 * Writes <outDir>/<set>-<kind>.png and <set>-overview.png.
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/gallery';
const sets = opt('sets', 'builtin,new').split(',');
const extra = opt('q', '') ? `&${opt('q', '')}` : '';
const only = opt('only', '') ? opt('only', '').split(',') : null;
mkdirSync(out, { recursive: true });
const read = (d) => Object.fromEntries(readdirSync(`content/${d}`).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`content/${d}/${f}`, 'utf8'))]));
const buildings = Object.entries(read('buildings')).filter(([k, d]) => k !== 'core' && (!only || only.includes(k)));
const units = Object.entries(read('units')).filter(([k]) => !only || only.includes(k));
// buildings on a grid north of the core, units in a row south of it
const lay = buildings.map(([kind, d], i) => ({ kind, hp: d.hp, x: -60 + (i % 5) * 30, z: 40 + Math.floor(i / 5) * 28 }));
const row = units.map(([unit, d], i) => ({ unit, fauna: d.faction === 'fauna', x: -54 + i * 12, z: -40 }));

const browser = await launch();
const errors = [];
for (const set of sets) {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  page.on('pageerror', (e) => errors.push(`${set}: ${e.message}`));
  await page.goto(`${process.env.SMOKE_URL ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/')}?intro=0&new=1&look=smooth&fog=0&ui=0&sw=0&flora=off&models=${set}${extra}`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
  await page.evaluate(async (lay) => {
    const s = await __exo.sim.save();
    s.tick = 120 * 10; // late morning
    for (const b of lay) s.buildings.push({ id: s.nextId++, kind: b.kind, x: b.x, z: b.z, yaw: 0.5, progress: 1, hp: b.hp, on: true, powered: true });
    s.stored = 1e6;
    __exo.sim.load(s);
  }, lay);
  await page.waitForTimeout(1500);
  await page.evaluate((row) => {
    for (const u of row) __exo.sim.command({ type: 'debug', ...(u.fauna ? { spawn: { unit: u.unit, x: u.x, z: u.z, n: 1 } } : { units: { unit: u.unit, x: u.x, z: u.z, n: 1 } }) });
  }, row);
  await page.waitForTimeout(1200);
  await page.evaluate(() => __exo.sim.setSpeed(0));
  await page.waitForTimeout(3000); // models load
  const shot = async (name, fx, fz, dist, pitch) => {
    await page.evaluate(([fx, fz, dist, pitch]) => { Object.assign(__exo.cam, { fx, fz, yaw: 0.7 }); __exo.cam.targetDist = dist; __exo.cam.targetPitch = pitch; }, [fx, fz, dist, pitch]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${out}/${set}-${name}.png` });
  };
  if (!only) await shot('overview', 0, 10, 170, 0.9);
  for (const b of lay) await shot(b.kind, b.x, b.z, 24, 0.55);
  const pos = await page.evaluate(() => __exo.sim.cur.units.map((u) => ({ unit: u.unit ?? u.kind, x: u.x, z: u.z })));
  for (const u of row) {
    const p = pos.find((q) => q.unit === u.unit) ?? u;
    await shot(u.unit, p.x, p.z, 12, 0.5);
  }
  await page.close();
}
await browser.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'done, no page errors');
