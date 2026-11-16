/**
 * Side-by-side shots of the built-in models and the Blender set (?models=new):
 * builds the same base in both, then an overview and a close-up of each model.
 *   node tools/model-compare.mjs <outDir> [--url http://localhost:5176/]
 * Writes <outDir>/<builtin|new>-<name>.png.
 */
import { chromium } from 'playwright';
const out = process.argv[2];
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const set of ['builtin', 'new']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  page.on('pageerror', (e) => errors.push(`${set}: ${e.message}`));
  await page.goto(`${url}?intro=0&new=1&look=smooth&fog=0&ui=0${set === 'new' ? '&models=new' : ''}`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  // same layout every time: commands at fixed spots (searching outward for a legal one)
  const placed = await page.evaluate(() => {
    const c = __exo.sim;
    c.command({ type: 'debug', alloys: 5000 });
    const spot = (k, cx, cz) => { for (let r = 0; r < 30; r += 1.5) for (let a = 0; a < 6.28; a += 0.25) { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (!__exo.canPlace(k, x, z)) return { x, z }; } return null; };
    const at = {};
    for (const [k, x, z] of [['solar', 30, -6], ['solar', -32, -8]]) { const p = spot(k, x, z); if (p) c.command({ type: 'build', kind: k, ...p }); }
    for (const [k, x, z, yaw] of [['solar', 22, 4, 0], ['battery', -20, 6, 0], ['turret', 18, -20, 0], ['radar', -2, 26, 0], ['bay', -16, -24, 0]]) {
      const p = spot(k, x, z);
      if (p) { c.command({ type: 'build', kind: k, ...p, yaw }); at[k] = p; }
    }
    // a depot next to the nearest deposit
    const dep = [...c.cur.deposits].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    const dp = dep && spot('depot', dep.x * 0.82, dep.z * 0.82);
    if (dp) { c.command({ type: 'build', kind: 'depot', ...dp }); at.depot = dp; }
    c.command({ type: 'buildLine', kind: 'wall', x1: 4, z1: -34, x2: 26, z2: -34 });
    at.wall = { x: 14, z: -34 };
    c.setSpeed(3);
    return at;
  });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => __exo.sim.cur.buildings.every((b) => b.progress >= 1), null, { timeout: 600000, polling: 500 });
  const bay = await page.evaluate(() => __exo.sim.cur.buildings.find((b) => b.kind === 'bay')?.id);
  if (bay) {
    await page.evaluate((id) => { for (const u of ['rover', 'tank', 'rover']) __exo.sim.command({ type: 'produce', id, unit: u }); }, bay);
    await page.waitForFunction(() => __exo.sim.cur.units.length === 3, null, { timeout: 300000, polling: 500 });
    const b = await page.evaluate(() => __exo.sim.cur.buildings.find((x) => x.kind === 'bay'));
    placed.units = { x: b.x + 2, z: b.z - 14 };
  }
  // a predator near the turret so the head has something to aim at
  await page.evaluate((t) => { __exo.sim.setSpeed(1); if (t) __exo.sim.command({ type: 'debug', spawn: { unit: 'brute', x: t.x + 20, z: t.z - 6 } }); }, placed.turret);
  await page.waitForTimeout(3000);
  // photos in daylight: run on to late morning if needed, then freeze
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await page.waitForFunction(() => __exo.sim.cur.daylight > 0.85, null, { timeout: 600000, polling: 300 });
  await page.evaluate((t) => { if (t) __exo.sim.command({ type: 'debug', spawn: { unit: 'brute', x: t.x + 20, z: t.z - 6 } }); __exo.sim.setSpeed(1); }, placed.turret);
  await page.waitForTimeout(2500);
  await page.evaluate(() => __exo.sim.setSpeed(0)); // freeze for the photos
  const shot = async (name, fx, fz, dist, pitch, yaw) => {
    await page.evaluate(([fx, fz, dist, pitch, yaw]) => { Object.assign(__exo.cam, { fx, fz, yaw }); __exo.cam.targetDist = dist; __exo.cam.targetPitch = pitch; }, [fx, fz, dist, pitch, yaw]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${set}-${name}.png` });
  };
  await shot('overview', 0, -4, 150, 0.85, 0.5);
  for (const [k, p] of Object.entries(placed)) if (p) await shot(k, p.x, p.z, k === 'units' ? 22 : k === 'wall' ? 30 : 26, 0.55, 0.7);
  await page.close();
}
const p = await browser.newPage();
await p.goto(`${url}?new=1&intro=0`);
await p.waitForTimeout(1500);
await browser.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'done, no page errors');
