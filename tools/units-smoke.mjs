/**
 * End-to-end combat-unit test through real pointer input:
 *   build a Vehicle Bay, queue units from its card (and cancel one), select
 *   units by tap / double-tap / the army counter, order them by tapping the
 *   ground and by dragging, watch them fight a pack, and resume them from the
 *   autosave.
 *   node tools/units-smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const cur = () => page.evaluate(() => {
  const c = __exo.sim.cur;
  return { units: c.units, buildings: c.buildings, alloys: c.alloys, tick: c.tick, hostiles: c.hostiles, stats: c.stats };
});
const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const screen = (x, z, lift = 0) => page.evaluate(([x, z, lift]) => __exo.screenOf(x, z, lift), [x, z, lift]);
const unitAt = (id) => page.evaluate((id) => __exo.unitScreen(id), id);
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const sel = () => page.evaluate(() => (__exo.ui.sel?.kind === 'units' ? [...__exo.ui.sel.ids] : null));
const spotFor = (kind, cx, cz) => page.evaluate(([kind, cx, cz]) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!__exo.canPlace(kind, x, z)) return { x, z };
  }
  return null;
}, [kind, cx, cz]);

await page.goto(`${url}?intro=0&new=1`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(1500);

// 1. build power + a Vehicle Bay
await cmd({ type: 'debug', alloys: 1500 });
for (const [kind, x, z] of [['solar', 20, 0], ['solar', -20, 0], ['bay', 0, -26]]) {
  const p = await spotFor(kind, x, z);
  if (p) await cmd({ type: 'build', kind, ...p });
  await wait(400);
}
await page.evaluate(() => __exo.sim.setSpeed(3));
await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'bay' && b.progress >= 1), null, 240000);
check(true, 'Vehicle Bay built');
await page.evaluate(() => __exo.sim.setSpeed(1));
let s = await cur();
const bay = s.buildings.find((b) => b.kind === 'bay');
await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z - 8; }, [bay.x, bay.z]);
await wait(1200);

// 2. queue from the card
const bp = await screen(bay.x, bay.z, 1);
await page.mouse.click(bp.x, bp.y);
await wait(500);
check(/VEHICLE BAY/.test(await page.textContent('#card')), 'tapping the bay shows its card');
for (const k of ['rover', 'rover', 'tank', 'rover']) {
  await page.dispatchEvent(`#card [data-act="produce:${k}"]`, 'pointerdown');
  await wait(250);
}
s = await cur();
check(s.buildings.find((b) => b.id === bay.id).queue?.length === 4, 'four units queued');
const alloys = s.alloys;
await page.dispatchEvent('#card [data-act="unqueue"]', 'pointerdown');
await wait(400);
s = await cur();
check(s.buildings.find((b) => b.id === bay.id).queue.length === 3 && s.alloys > alloys + 40, 'Cancel last drops one and refunds it');
check(/Producing/.test(await page.textContent('#card')), 'card shows production progress');
await page.evaluate(() => __exo.sim.setSpeed(3));
await until(() => __exo.sim.cur.units.length === 3 && __exo.sim.cur.units.every((u) => u.order === 'idle'), null, 240000);
await page.evaluate(() => __exo.sim.setSpeed(1));
check(true, 'three units produced and parked');
await page.keyboard.press('Escape');
await wait(1500);

// 3. selection
s = await cur();
const rovers = s.units.filter((u) => u.unit === 'rover');
let p = await unitAt(rovers[0].id);
check(!!p, 'rover is on screen');
await page.mouse.click(p.x, p.y);
await wait(500);
let ids = await sel();
check(ids?.length === 1 && ids[0] === rovers[0].id, 'tapping a unit selects it');
check(/ROVER/.test(await page.textContent('#card')), 'card shows the unit');
let both = false;
for (let tries = 0; tries < 4 && !both; tries++) {
  // SwiftShader frames are slow; a double-tap can miss its window, so retry
  await page.keyboard.press('Escape');
  await wait(400);
  p = await unitAt(rovers[0].id);
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await wait(500);
  ids = await sel();
  both = ids?.length === 2 && ids.every((id) => rovers.some((r) => r.id === id));
}
check(both, 'double-tap selects every rover on screen');
await page.dispatchEvent('#r-army', 'pointerdown');
await wait(400);
check((await sel())?.length === 3, 'army counter selects all units');

// 4. orders: tap ground, then drag from a unit
const target = await spotFor('solar', bay.x + 25, bay.z - 10); // any open ground
const gp = await screen(target.x, target.z);
await page.mouse.click(gp.x, gp.y);
await wait(400);
s = await cur();
check(s.units.every((u) => u.order === 'move'), 'tapping ground orders the selection');
await page.evaluate(() => __exo.sim.setSpeed(3));
await until(([x, z]) => __exo.sim.cur.units.every((u) => u.order === 'idle' && Math.hypot(u.x - x, u.z - z) < 10), [target.x, target.z], 60000);
await page.evaluate(() => __exo.sim.setSpeed(1));
check(true, 'units arrived, spread out around the point');
s = await cur();
const t = s.units.find((u) => u.unit === 'tank');
await page.keyboard.press('Escape');
await page.evaluate(() => __exo.sim.setSpeed(0)); // a natural pack arriving mid-drag made this flaky
await wait(1200);
p = await unitAt(t.id);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(p.x - i * 20, p.y + i * 6);
await page.mouse.up();
await wait(400);
s = await cur();
ids = await sel();
check(ids?.length === 1 && ids[0] === t.id && s.units.find((u) => u.id === t.id).order === 'move', `dragging from a unit orders just that unit${process.env.DBG ? ` (sel ${JSON.stringify(ids)} tank ${t.id} at ${JSON.stringify(p)} order ${s.units.find((u) => u.id === t.id)?.order} el ${await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName, [p.x, p.y])})` : ''}`);

// 5. they fight
await page.evaluate(() => __exo.sim.setSpeed(3));
await cmd({ type: 'debug', wave: true });
await until(() => __exo.sim.cur.hostiles > 0, null, 10000);
const k0 = (await cur()).stats.kills;
await page.evaluate(([x, z]) => __exo.sim.command({ type: 'order', ids: __exo.sim.cur.units.map((u) => u.id), x, z }), [0, 0]);
await until(() => __exo.sim.cur.units.some((u) => u.engaged), null, 180000);
check(true, 'units engage predators');
await until((k0) => __exo.sim.cur.stats.kills > k0, k0, 180000);
check(true, 'units (or turrets) killed predators');
await page.evaluate(() => __exo.sim.setSpeed(1));

// 6. resume keeps the army
await page.evaluate(() => __exo.sim.flush());
await wait(800);
const n = (await cur()).units.length;
await page.goto(url);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(1500);
check((await cur()).units.length === n && n > 0, `resume keeps the army (${n} units)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await page.goto(`${url}?new=1&intro=0`); // leave a fresh autosave behind
await wait(1500);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
