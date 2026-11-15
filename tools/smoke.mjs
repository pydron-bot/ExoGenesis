/**
 * End-to-end smoke test through real pointer input:
 *   drag an order vector from the drone, tap-to-build a solar array,
 *   save to IndexedDB, reload, load, and check the state came back.
 *   node tools/smoke.mjs [--url http://localhost:5176/] [--gpu]
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
const sim = () => page.evaluate(() => ({ drone: __exo.sim.cur.drone, buildings: __exo.sim.cur.buildings, tick: __exo.sim.cur.tick, alloys: __exo.sim.cur.alloys }));

await page.goto(url);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);

// 1. drag an order vector from the drone to a point up-screen
const d0 = await page.evaluate(() => __exo.droneScreen());
const before = await sim();
await page.mouse.move(d0.x, d0.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(d0.x + i * 22, d0.y - i * 14);
await page.mouse.up();
await page.waitForTimeout(400);
let s = await sim();
check(s.drone.moving && Math.hypot(s.drone.tx - before.drone.x, s.drone.tz - before.drone.z) > 5, `drag order issued → target (${s.drone.tx.toFixed(1)}, ${s.drone.tz.toFixed(1)})`);
await page.waitForTimeout(4000);
s = await sim();
check(Math.hypot(s.drone.x - before.drone.x, s.drone.z - before.drone.z) > 5, `drone moved to (${s.drone.x.toFixed(1)}, ${s.drone.z.toFixed(1)})`);

// 2. tap build, then tap the ground
await page.click('#b-build');
await page.mouse.click(1280 * 0.3, 800 * 0.62);
await page.waitForTimeout(400);
s = await sim();
const site = s.buildings.find((b) => b.kind === 'solar');
check(!!site, `solar site placed${site ? ` at (${site.x.toFixed(1)}, ${site.z.toFixed(1)})` : ''}`);
check(s.drone.building, 'drone tasked to build');

// 3. pan with a drag on empty ground
const camBefore = await page.evaluate(() => ({ fx: __exo.cam.fx, fz: __exo.cam.fz }));
await page.mouse.move(1000, 200);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(1000 - i * 20, 200 + i * 10);
await page.mouse.up();
const camAfter = await page.evaluate(() => ({ fx: __exo.cam.fx, fz: __exo.cam.fz }));
check(Math.hypot(camAfter.fx - camBefore.fx, camAfter.fz - camBefore.fz) > 1, 'drag on ground pans the camera');

// 4. wheel zoom out to the system and back
await page.mouse.move(640, 400);
for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
await page.waitForTimeout(2500);
const layer = await page.textContent('#layer');
check(layer === 'SYSTEM', `wheel zoom reaches system view (layer=${layer})`);
await page.click('[data-view="surface"]');
await page.waitForTimeout(2500);
check((await page.textContent('#layer')) === 'SURFACE', 'Surface button returns to the ground');

// 5. save, reload, load
await page.click('#b-save');
await page.waitForTimeout(500);
const saved = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('saves').objectStore('saves').get('slot1');
    g.onsuccess = () => res({ tick: g.result.sim.tick, buildings: g.result.sim.buildings });
  };
}));
await page.reload();
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await page.waitForTimeout(500);
const fresh = await sim();
await page.click('#b-load');
await page.waitForTimeout(800);
const loaded = await sim();
check(fresh.buildings.length === 1, 'reload starts a fresh game');
check(loaded.buildings.length === saved.buildings.length && loaded.tick >= saved.tick && loaded.tick < saved.tick + 30,
  `load restores the save (tick ${saved.tick} → ${loaded.tick}, ${loaded.buildings.length} buildings)`);

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
