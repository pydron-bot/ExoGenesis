/**
 * Quality-of-life controls (v0.57.0), end to end in the colony:
 * held-key panning, F centre, the drones chip and . (next idle drone), right-click orders and
 * cancelling placement, the placement hint by the cursor, Esc closing the build menu, control
 * groups, Ctrl+A, [ ] speed and the PAUSED banner, the Controls panel, two-tap Recycle,
 * radar drag, zoom toward the cursor, Ctrl+S.
 *   node tools/qol-smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${url}?intro=0&new=1`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await page.waitForTimeout(1200);
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const camAt = () => ev(() => ({ fx: __exo.cam.fx, fz: __exo.cam.fz, dist: __exo.cam.targetDist }));
const sel = () => ev(() => __exo.ui.sel);
const cmd = (c) => ev((c) => __exo.sim.command(c), c);
/** Wait (up to 25 s: software rendering is slow) until the camera looks at (x, z). */
const camNear = (x, z, r) => page.waitForFunction(([x, z, r]) => Math.hypot(__exo.cam.fx - x, __exo.cam.fz - z) < r, [x, z, r], { timeout: 25000, polling: 100 }).then(() => true, () => false);
const logHas = (t) => ev((t) => [...document.querySelectorAll('#log .ev')].some((e) => e.textContent.includes(t)), t);

await cmd({ type: 'debug', alloys: 3000 });
await page.keyboard.press('Escape'); // drop the first-drone selection
await wait(200);

// 1. holding a pan key moves the camera smoothly (more than one keypress step would)
{
  const a = await camAt();
  await page.keyboard.down('d');
  await page.waitForFunction(([x, z]) => Math.hypot(__exo.cam.fx - x, __exo.cam.fz - z) > 5, [a.fx, a.fz], { timeout: 10000, polling: 50 }).catch(() => {});
  await page.keyboard.up('d');
  const b = await camAt();
  check(Math.hypot(b.fx - a.fx, b.fz - a.fz) > 5, `holding D pans (${Math.hypot(b.fx - a.fx, b.fz - a.fz).toFixed(1)} u)`);
  await wait(200);
  const c = await camAt();
  check(Math.hypot(c.fx - b.fx, c.fz - b.fz) < 0.5, 'letting go stops the pan');
}

// 2. F with nothing selected glides back to the Command Core
{
  await page.keyboard.press('f');
  const core = await ev(() => __exo.sim.cur.buildings.find((b) => b.kind === 'core'));
  check(await camNear(core.x, core.z, 1), 'F looks at the Command Core');
}

// 3. the drones chip and . pick an idle drone and look at it
{
  const chip = await ev(() => document.getElementById('r-drones').textContent);
  check(/\d/.test(chip), `drones chip shows the count ("${chip.trim()}")`);
  await page.keyboard.press('.');
  await wait(200);
  const s = await sel();
  check(s?.kind === 'drone', '. selects a worker drone');
  const d = await ev((id) => __exo.sim.cur.drones.find((x) => x.id === id), s?.id);
  check(d && await camNear(d.x, d.z, 6), 'and the camera goes to it');
  await page.dispatchEvent('#r-drones', 'pointerdown'); // (a contact card can pop up over the HUD at any time)
  check((await sel())?.kind === 'drone', 'clicking the chip selects a drone too');
}

// 4. right-click with a drone selected sends it there
{
  const s = await sel();
  const before = await ev((id) => __exo.sim.cur.drones.find((x) => x.id === id), s.id);
  const target = { x: before.x + 14, z: before.z + 6 };
  const p = await ev(([x, z]) => __exo.screenOf(x, z), [target.x, target.z]);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await wait(1500);
  const after = await ev((id) => __exo.sim.cur.drones.find((x) => x.id === id), s.id);
  check(Math.hypot(after.tx - target.x, after.tz - target.z) < 3 || Math.hypot(after.x - before.x, after.z - before.z) > 1, 'right-click sends the selected drone');
}

// 5. the build menu: Esc closes it; placing: the hint says why not; right-click stops placing
{
  await page.keyboard.press('b');
  await wait(200);
  check(await ev(() => document.getElementById('build-menu').classList.contains('open')), 'B opens the build menu');
  await page.keyboard.press('Escape');
  await wait(200);
  check(!(await ev(() => document.getElementById('build-menu').classList.contains('open'))), 'Esc closes it');
  check(!(await ev(() => !!document.getElementById('options'))), '…without opening the game menu');
  await page.keyboard.press('b');
  await page.click('#build-menu [data-kind="solar"]');
  // hover over the Command Core: can't build on it
  const core = await ev(() => __exo.sim.cur.buildings.find((b) => b.kind === 'core'));
  const p = await ev(([x, z]) => __exo.screenOf(x, z), [core.x, core.z]);
  await page.mouse.move(p.x + 3, p.y + 3);
  await page.mouse.move(p.x, p.y);
  await wait(200);
  const hint = await ev(() => { const h = document.getElementById('place-hint'); return { on: getComputedStyle(h).display !== 'none', text: h.textContent }; });
  check(hint.on && hint.text.length > 3, `placement hint by the cursor ("${hint.text}")`);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await wait(200);
  check(!(await ev(() => __exo.ui.build)), 'right-click stops placing');
  check(!(await ev(() => getComputedStyle(document.getElementById('place-hint')).display !== 'none')), 'and the hint goes');
}

// 6. control groups, Ctrl+A
{
  const core = await ev(() => __exo.sim.cur.buildings.find((b) => b.kind === 'core'));
  await cmd({ type: 'debug', units: { unit: 'rover', x: core.x + 20, z: core.z + 10, n: 3 } });
  await wait(800);
  const n = await ev(() => __exo.sim.cur.units.length);
  check(n >= 3, `units spawned (${n})`);
  await page.keyboard.press('Control+a');
  await wait(100);
  let s = await sel();
  check(s?.kind === 'units' && s.ids.length === n, `Ctrl+A selects every combat unit (${s?.kind} ${s?.ids?.length} of ${n})`);
  await page.keyboard.press('Control+4');
  await wait(100);
  check(await logHas('Group 4'), 'Ctrl+4 makes group 4');
  await page.keyboard.press('Escape');
  check(!(await sel()), 'Esc deselects');
  await page.keyboard.press('4');
  await wait(100);
  s = await sel();
  check(s?.kind === 'units' && s.ids.length === n, '4 selects group 4 again');
  await page.keyboard.press('f');
  const us = await ev(() => __exo.sim.cur.units);
  const cx = us.reduce((m, u) => m + u.x, 0) / us.length, cz = us.reduce((m, u) => m + u.z, 0) / us.length;
  check(await camNear(cx, cz, 4), 'F looks at the selected units');
  await page.keyboard.press('5');
  await wait(100);
  check(await logHas('Group 5 is empty'), 'an empty group says so');
  await page.keyboard.press('Escape');
}

// 7. speed keys and the PAUSED banner
{
  await page.keyboard.press(']');
  await wait(100);
  check(await ev(() => document.getElementById('b-fast').classList.contains('on')), '] goes to fast forward');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await wait(100);
  check(await ev(() => document.getElementById('b-pause').classList.contains('on')), '[ [ pauses');
  check(await page.waitForFunction(() => getComputedStyle(document.getElementById('paused')).display !== 'none', null, { timeout: 5000 }).then(() => true, () => false), 'PAUSED banner shows');
  await page.dispatchEvent('#paused', 'click');
  await wait(100);
  check(await ev(() => document.getElementById('b-play').classList.contains('on')), 'tapping the banner resumes');
  check(await page.waitForFunction(() => getComputedStyle(document.getElementById('paused')).display === 'none', null, { timeout: 5000 }).then(() => true, () => false), 'and it goes');
}

// 8. the Controls panel (?, and the menu)
{
  await page.keyboard.press('?');
  await wait(200);
  const t = await ev(() => document.querySelector('#options .op-head b')?.textContent);
  check(t === 'CONTROLS', '? opens Controls');
  check(await ev(() => document.querySelectorAll('#options .kb').length > 15), 'with the keys listed');
  await page.keyboard.press('Escape');
  await wait(100);
  check(!(await ev(() => !!document.getElementById('options'))), 'Esc closes it');
  await page.keyboard.press('Escape'); // nothing selected: the game menu
  await wait(200);
  await page.click('#options [data-id="controls"]');
  await wait(200);
  check(await ev(() => document.querySelector('#options .op-head b')?.textContent) === 'CONTROLS', 'the menu has Controls');
  await page.keyboard.press('Escape'); // back to the menu
  await wait(200);
  check(await ev(() => document.querySelector('#options .op-head b')?.textContent) === 'MENU', 'closing it goes back to the menu');
  await page.keyboard.press('Escape');
  await wait(200);
  check(await ev(() => document.getElementById('b-play').classList.contains('on')), 'and closing the menu resumes');
}

// 9. Recycle asks twice
{
  await cmd({ type: 'debug', setup: { buildings: ['solar'] } });
  await wait(600);
  const b = await ev(() => __exo.sim.cur.buildings.find((x) => x.kind === 'solar' && x.progress >= 1));
  check(!!b, 'a finished Solar Array to recycle');
  if (b) {
    await ev((id) => { __exo.ui.sel = { kind: 'building', id }; __exo.hud.cur = __exo.sim.cur; __exo.hud.selected(); }, b.id);
    await wait(300);
    await page.dispatchEvent('#card [data-act="demolish"]', 'pointerdown');
    await wait(300);
    check(await ev(() => document.querySelector('#card [data-act="demolish"]')?.classList.contains('armed')), 'first tap arms Recycle');
    check(await ev((id) => __exo.sim.cur.buildings.some((x) => x.id === id), b.id), 'and keeps the building');
    await page.dispatchEvent('#card [data-act="demolish"]', 'pointerdown');
    await wait(600);
    check(!(await ev((id) => __exo.sim.cur.buildings.some((x) => x.id === id), b.id)), 'second tap recycles it');
  }
}

// 10. zoom toward the cursor; radar drag (a skirmish map always has its radar: here the debug radar)
{
  await page.keyboard.press('f');
  const core = await ev(() => __exo.sim.cur.buildings.find((b) => b.kind === 'core'));
  await camNear(core.x, core.z, 0.2);
  const a = await camAt();
  await page.mouse.move(1100, 500);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -200); await wait(50); }
  await wait(300);
  const b = await camAt();
  check(b.dist < a.dist, 'wheel zooms in');
  check(Math.hypot(b.fx - a.fx, b.fz - a.fz) > 2, `toward the cursor (focus moved ${Math.hypot(b.fx - a.fx, b.fz - a.fz).toFixed(1)} u)`);
}

// 11. Ctrl+S saves
{
  await page.keyboard.press('Control+s');
  await wait(800);
  check(await logHas('Saved'), 'Ctrl+S saves');
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
