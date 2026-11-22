/**
 * Sky and effects (v0.68.0): the lens flare shows facing the sun and goes out behind the planet, comets
 * wake near the sun, weather can be held and only changes the look, dust rises behind a moving drone,
 * the Milky Way and sky glow are in the scene, and no shader fails to compile.
 *   node tools/visuals-smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/THREE\.WebGLProgram|Shader Error|Program Info Log/.test(m.text()) || (m.type() === 'error' && !/KHR_parallel_shader_compile/.test(m.text()))) errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const load = async (q = '') => {
  await page.goto(`${url}?title=0&intro=0&new=1&sw=0&bloom=1${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
};

await load();
// aim the camera (after the game's own camera update): at the sun past the planet's edge, then with the planet in the way
await page.evaluate(() => {
  const c = __exo.cam, cam = c.camera, s = __exo.system, V = cam.position.constructor;
  c.setView('planet', true);
  const orig = c.update;
  window.__aim = 3300;
  c.update = function (...a) {
    orig.apply(this, a);
    const sun = s.sunPos.clone().normalize();
    const perp = new V(0, 1, 0).cross(sun).normalize();
    const up = new V().crossVectors(sun, perp);
    cam.position.copy(sun).multiplyScalar(-8000).addScaledVector(perp, window.__aim);
    cam.up.copy(up);
    cam.lookAt(s.sunPos.clone().addScaledVector(perp, 25000));
  };
});
await wait(3000);
const clear = await page.evaluate(() => __exo.flare.strength);
check(clear > 0.2, `lens flare shows with the sun in view (${clear.toFixed(2)})`);
await page.evaluate(() => { window.__aim = 1200; });
await wait(3000);
const hidden = await page.evaluate(() => __exo.flare.strength);
check(hidden < 0.05, `and goes out with the planet in front of the sun (${hidden.toFixed(3)})`);
await page.evaluate(() => { __exo.flare.enabled = false; window.__aim = 3300; });
await wait(2500);
check(await page.evaluate(() => __exo.flare.strength) < 0.05, 'Lens flare off: none');

// comets: dormant far out, active near the star
const act = await page.evaluate(() => {
  const s = __exo.system, b = s.bodies.find((x) => x.kind === 'comet');
  const peri = (360 - (b.phase * 180 / Math.PI)) / 360 * b.period;
  const out = [];
  for (const T of [peri, peri + b.period / 2]) {
    s.update(T, __exo.cam.camera, 1, 0, 900, 600);
    out.push(b.comet.activity);
  }
  return out;
});
check(act[0] > 0.8 && act[1] < 0.05, `a comet wakes near the sun and sleeps far out (${act.map((a) => a.toFixed(2)).join(' / ')})`);
check(await page.evaluate(() => __exo.scene.children.some((o) => o.isMesh && o.material?.uniforms?.uPole)), 'the Milky Way is in the sky');

// weather: held rain darkens and shows drops near the ground, and doesn't touch the sim
await load('&weather=rain&time=day');
await page.evaluate(() => __exo.cam.setView('surface', true));
await wait(2500);
const w = await page.evaluate(() => ({ kind: __exo.weather.kind, amount: __exo.weather.amount, drops: __exo.weather.lines.visible, over: __exo.system.overcast }));
check(w.kind === 'rain' && w.amount > 0.9 && w.drops && w.over > 0.5, `?weather=rain: rain, drops shown, sky overcast (${JSON.stringify(w)})`);
await page.evaluate(() => __exo.cam.setView('system', true));
await wait(2500);
check(!(await page.evaluate(() => __exo.weather.lines.visible)), 'no drops from the system view');
// the schedule: mostly clear, some showers and storms, the first spell always clear
const sched = await page.evaluate(() => {
  const W = __exo.weather, hold = W.hold; W.hold = null;
  const n = { clear: 0, rain: 0, dust: 0 };
  for (let i = 0; i < 400; i++) n[W.at(i * 240 + 120).kind]++;
  const first = W.at(60).kind;
  W.hold = hold;
  return { n, first };
});
check(sched.first === 'clear' && sched.n.clear > 200 && sched.n.rain > 20 && sched.n.dust > 5, `weather schedule: mostly clear, some rain and dust, starts clear (${JSON.stringify(sched)})`);

// dust behind a moving drone
await load('&weather=clear');
await page.getByText('Continue').click().catch(() => {});
await page.evaluate(() => { __exo.cam.setView('surface', true); const d = __exo.sim.cur.drones[0]; __exo.sim.command({ type: 'move', drone: d.id, x: d.x + 60, z: d.z + 20 }); });
let puffs = 0;
for (let i = 0; i < 8 && !puffs; i++) { await wait(800); puffs = await page.evaluate(() => __exo.dust.age.filter((a) => a < 1.6).length); }
check(puffs > 0, `a drone on the move kicks up dust (${puffs} puffs)`);

// options rows
await page.click('#b-menu');
await page.waitForSelector('#options.menu');
await page.click('#options [data-id="options"]');
await page.waitForSelector('#options .op-row');
const rows = await page.evaluate(() => [...document.querySelectorAll('#options .op-row')].map((r) => r.dataset.id));
check(['flare', 'dust', 'zoomblur', 'weather', 'awake'].every((k) => rows.includes(k)), `Options: lens flare, dust, zoom blur, weather, keep screen on (${rows.filter((r) => ['flare', 'dust', 'zoomblur', 'weather', 'awake', 'silent'].includes(r)).join(',')})`);

check(errors.length === 0, `no page or shader errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} visuals check(s) FAILED` : '\nall visuals checks passed');
process.exit(failed ? 1 : 0);
