/**
 * Weathering (v0.78.0): cloud shadows and wet ground follow the weather, vehicles leave tracks, damaged buildings
 * smoke, destroyed ones come down and leave rubble on scorched ground (recycled ones don't), the colour grade runs
 * with Glow and the page's vignette stands in without it, and no shader fails to compile.
 *   node tools/weathering-smoke.mjs [--url http://localhost:5176/] [--gpu] [--shots dir]
 */
import { chromium } from 'playwright';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const gpu = process.argv.includes('--gpu');
const url = arg('--url') ?? 'http://localhost:5176/';
const shots = arg('--shots');
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/THREE\.WebGLProgram|Shader Error|Program Info Log/.test(m.text()) || (m.type() === 'error' && !/KHR_parallel_shader_compile/.test(m.text()))) errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const load = async (q = '') => {
  await page.goto(`${url}?title=0&intro=0&new=1&sw=0&fog=0${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
};
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/weathering-${name}.png` }); };

// ---- rain at midday: clouds close in, the ground soaks ----
await load('&bloom=1&weather=rain');
await page.evaluate(async () => {
  const s = await __exo.sim.save();
  s.tick = Math.round((5 / 24) * 360 * 10); // noon
  const add = (kind, x, z) => s.buildings.push({ id: s.nextId++, kind, x, z, yaw: 0, progress: 1, hp: 1e5, on: true, powered: true });
  add('radar', 22, -22); add('battery', -22, -24); add('solar', 30, 10);
  s.stored = 1e6;
  s.alloys = 1e5;
  __exo.sim.load(s);
  __exo.cam.fx = 0; __exo.cam.fz = -15; __exo.cam.targetDist = 70; __exo.cam.targetPitch = 0.85;
});
await wait(1500);
const sky0 = await page.evaluate(() => __exo.groundSky.look);
check(sky0.cover > 0.6, `rain closes the clouds in (cover ${sky0.cover.toFixed(2)})`);
check(sky0.cloudK > 0 && sky0.cloudK < 0.4, `cloud shadows on by day, softer under the overcast (${sky0.cloudK.toFixed(3)})`);
// the ground soaks while it rains (speed it along: the test browser runs few frames)
await page.evaluate(() => { __exo.groundSky.update(30, 1, 1, 1, 0.5, __exo.scene.background); });
const wet = await page.evaluate(() => __exo.groundSky.look.wet);
check(wet > 0.4, `rain wets the ground (${wet.toFixed(2)} after 30 s)`);
await page.evaluate(() => { __exo.groundSky.update(600, 1, 1, 0, 0, __exo.scene.background); });
check(await page.evaluate(() => __exo.groundSky.look.wet) === 0, 'and it dries out once the rain has gone');
await page.evaluate(() => { __exo.groundSky.wet = 1; });
await wait(800);
await shot('wet');

// ---- tracks: tanks driving across ----
const tr0 = await page.evaluate(() => __exo.marks.read(__exo.renderer).tracked);
await page.evaluate(() => {
  __exo.sim.command({ type: 'debug', units: { unit: 'tank', x: -25, z: 0, n: 3 } });
});
await wait(1200);
await page.evaluate(() => {
  const ids = __exo.sim.cur.units.filter((u) => !u.team).map((u) => u.id);
  __exo.sim.command({ type: 'order', ids, x: 25, z: 0 });
});
// (stamps counted as they're drawn; reading the texture back is slow, so only once at the end)
await page.waitForFunction(() => __exo.marks.total > 15, null, { timeout: 120000, polling: 1000 }).catch(() => {});
const tr1 = await page.evaluate(() => __exo.marks.read(__exo.renderer).tracked);
const stamps = await page.evaluate(() => __exo.marks.total);
check(tr1 > tr0 + 200, `driving tanks leave tread marks (${stamps} stamps; ${tr0} → ${tr1} marked texels)`);
await shot('tracks');

// ---- damage: a hurt building smokes ----
const smoke0 = await page.evaluate(() => __exo.army.fx.smoke.mesh.count);
await page.evaluate(() => {
  const s = __exo.sim.cur, b = s.buildings.find((x) => x.kind === 'radar');
  const max = 400; // radar hp from the content would do; the drones may mend it, so hurt it hard
  __exo.sim.command({ type: 'debug', hurt: { id: b.id, hp: b.hp - 40 } });
  // and keep the drones off it
  for (const d of s.drones) __exo.sim.command({ type: 'move', drone: d.id, x: -60, z: 60 });
  void max;
});
await page.waitForFunction(() => __exo.army.fx.smoke.mesh.count > 3, null, { timeout: 60000 }).catch(() => {});
const smoke1 = await page.evaluate(() => __exo.army.fx.smoke.mesh.count);
check(smoke1 > Math.max(3, smoke0), `a badly damaged building smokes (${smoke0} → ${smoke1} puffs)`);

// ---- destroyed vs recycled ----
const before = await page.evaluate(() => ({ ruins: __exo.region.ruins.count, scorched: __exo.marks.read(__exo.renderer).scorched }));
await page.evaluate(() => {
  const s = __exo.sim.cur;
  __exo.sim.command({ type: 'demolish', id: s.buildings.find((x) => x.kind === 'solar').id });
  const b = s.buildings.find((x) => x.kind === 'battery');
  __exo.sim.command({ type: 'debug', hurt: { id: b.id, hp: 1e9 } });
});
await page.waitForFunction(() => !__exo.sim.cur.buildings.some((b) => b.kind === 'solar' || b.kind === 'battery'), null, { timeout: 30000 });
await wait(1500);
const after = await page.evaluate(() => ({ ruins: __exo.region.ruins.count, scorched: __exo.marks.read(__exo.renderer).scorched }));
check(after.ruins === before.ruins + 1, `the destroyed battery comes down as a heap; the recycled array leaves none (${before.ruins} → ${after.ruins})`);
check(after.scorched > before.scorched + 100, `and scorches the ground (${before.scorched} → ${after.scorched} texels)`);
await shot('ruin');
await page.evaluate(() => { __exo.region.ruins.update(400); });
await wait(600);
check(await page.evaluate(() => __exo.region.ruins.count) === before.ruins, 'the heap settles away after a few minutes');

// ---- the colour grade ----
check(await page.evaluate(() => __exo.post.look.grade && __exo.post.gradeInUse), 'with Glow on, the grade pass runs');
check(!(await page.evaluate(() => document.body.classList.contains('vignette'))), 'and the page draws no vignette of its own');
await page.evaluate(() => { __exo.post.grading = false; });
await page.waitForFunction(() => !__exo.post.look.grade, null, { timeout: 20000 }).catch(() => {});
check(!(await page.evaluate(() => __exo.post.look.grade)), 'Colour grade off: the pass is skipped');

// ---- Glow off: the page's vignette stands in; options off leave the effects out ----
await load('&bloom=0&aa=auto&cloudshadows=0&marks=0');
await page.waitForFunction(() => document.body.classList.contains('vignette'), null, { timeout: 20000 }).catch(() => {});
check(await page.evaluate(() => document.body.classList.contains('vignette') && !__exo.post.gradeInUse), 'Glow off: the page draws the vignette instead');
const off = await page.evaluate(() => ({ k: __exo.groundSky.look.cloudK, marks: __exo.marks.enabled }));
check(off.k === 0 && !off.marks, `Cloud shadows and Tracks off leave them out (${JSON.stringify(off)})`);

check(errors.length === 0, `no page or shader errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
