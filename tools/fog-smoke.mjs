/**
 * Fog of war end to end: the start (lit round the Core, dark far away),
 * predators in the fog hidden but on radar, a drone exploring, the explored map
 * surviving a resume, unexplored ground drawn darker, and ?fog=0.
 *   node tools/fog-smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const ready = () => page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
/** Fog cell value at a region point (0 never seen, 1 seen, 2 in sight). */
const fogAt = (x, z) => page.evaluate(([x, z]) => {
  const n = Math.sqrt(__exo.sim.cur.fog.length), c = 240 / n;
  return __exo.sim.cur.fog[Math.floor((z + 120) / c) * n + Math.floor((x + 120) / c)];
}, [x, z]);
const explored = () => page.evaluate(() => __exo.sim.cur.fog.reduce((m, v) => m + (v > 0 ? 1 : 0), 0));
/** Mean brightness of the rendered frame in a small box round a region point. */
const brightness = (x, z) => page.evaluate(([x, z]) => {
  const p = __exo.screenOf(x, z);
  const src = __exo.renderer.domElement;
  __exo.renderer.render(__exo.scene, __exo.cam.camera);
  const cv = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  const g = cv.getContext('2d');
  g.drawImage(src, 0, 0);
  const k = src.width / innerWidth;
  const d = g.getImageData(Math.round(p.x * k) - 6, Math.round(p.y * k) - 6, 12, 12).data;
  let t = 0;
  for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2];
  return t / (d.length / 4) / 3;
}, [x, z]);

await page.goto(`${url}?intro=0&new=1`);
await ready();
await wait(2500);

// 1. the start
check(await fogAt(0, -20) === 2, 'ground next to the Core is in sight');
check(await fogAt(100, 100) === 0, 'the far corner is unexplored');
const n0 = await explored();

// 2. a predator in the fog is hidden, but shows on radar
await cmd({ type: 'debug', spawn: { unit: 'brute', x: 100, z: -100 } });
await wait(800);
const hidden = await page.evaluate(() => {
  const c = __exo.sim.cur;
  let drawn = 0;
  for (let s = 0; s < c.armySlots; s++) if (c.army[s * 7 + 6] && c.army[s * 7 + 3] >= 2) drawn++;
  return { drawn, total: c.hostiles, blips: c.blips.length / 2 };
});
check(hidden.total >= 1 && hidden.drawn === 0, `predator in the fog isn't drawn (${hidden.drawn} of ${hidden.total})`);
check(hidden.blips === 0, 'no radar, no blips');
await cmd({ type: 'debug', alloys: 2000 });
const spot = (kind, cx, cz) => page.evaluate(([kind, cx, cz]) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!__exo.canPlace(kind, x, z)) return { x, z };
  }
  return null;
}, [kind, cx, cz]);
await cmd({ type: 'build', kind: 'solar', ...(await spot('solar', 22, 2)) });
await wait(400);
await cmd({ type: 'build', kind: 'solar', ...(await spot('solar', -22, 2)) });
await wait(400);
await cmd({ type: 'build', kind: 'radar', ...(await spot('radar', 0, 28)) });
await page.evaluate(() => __exo.sim.setSpeed(3));
await page.waitForFunction(() => __exo.sim.cur.radar, null, { timeout: 300000, polling: 300 });
await page.evaluate(() => __exo.sim.setSpeed(1));
await wait(500);
const blips = await page.evaluate(() => __exo.sim.cur.blips.length / 2);
check(blips >= 1, `powered radar shows it as a blip (${blips})`);

// 3. the drone explores
const d = await page.evaluate(() => __exo.sim.cur.drones[0].id);
await cmd({ type: 'move', drone: d, x: -90, z: 90 });
await page.evaluate(() => __exo.sim.setSpeed(3));
await page.waitForFunction(() => { const dr = __exo.sim.cur.drones[0]; return Math.hypot(dr.x + 90, dr.z - 90) < 4; }, null, { timeout: 120000, polling: 300 });
await page.evaluate(() => __exo.sim.setSpeed(1));
await wait(600);
check(await fogAt(-90, 90) === 2, 'the drone sees where it is');
const n1 = await explored();
check(n1 > n0 + 50, `exploring grows the map (${n0} → ${n1} cells)`);

// 4. darker where unexplored (rendered)
await page.evaluate(() => { __exo.cam.fx = 0; __exo.cam.fz = 0; __exo.cam.targetDist = 300; __exo.cam.targetPitch = 1.2; });
await wait(4000);
const lit = await brightness(0, -30), dark = await brightness(90, -90);
check(dark < lit * 0.5, `unexplored ground is drawn darker (lit ${lit.toFixed(0)}, unexplored ${dark.toFixed(0)})`);

// 5. resume keeps the explored map
await page.evaluate(() => __exo.sim.flush());
await wait(800);
await page.goto(url);
await ready();
await wait(1500);
check(await fogAt(-90, 90) >= 1, 'resume remembers explored ground');

// 6. ?fog=0
await page.goto(`${url}?intro=0&new=1&fog=0`);
await ready();
await page.evaluate(() => { __exo.cam.targetDist = 300; __exo.cam.targetPitch = 1.2; });
await wait(4000);
const off = await brightness(90, -90);
check(off > dark * 2, `?fog=0 draws the far ground lit (${off.toFixed(0)})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await page.goto(`${url}?new=1&intro=0`);
await wait(1500);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
