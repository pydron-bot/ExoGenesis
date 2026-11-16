/**
 * End-to-end placement test: rotating a building before placing it (R), the
 * Vehicle Bay's door following its rotation, wall lines by mouse and by touch
 * (and chaining), walls holding predators until chewed through, ground levelled
 * under buildings, and turret heads facing their target.
 *   node tools/build-smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

async function open(opts) {
  const page = await browser.newPage(opts);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${url}?intro=0&new=1`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  return page;
}
const helpers = (page) => ({
  wait: (ms) => page.waitForTimeout(ms),
  cur: () => page.evaluate(() => ({ buildings: __exo.sim.cur.buildings, units: __exo.sim.cur.units, alloys: __exo.sim.cur.alloys })),
  screen: (x, z) => page.evaluate(([x, z]) => __exo.screenOf(x, z), [x, z]),
  cmd: (c) => page.evaluate((c) => __exo.sim.command(c), c),
  until: (fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 200 }),
  spot: (kind, cx, cz) => page.evaluate(([kind, cx, cz]) => {
    for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!__exo.canPlace(kind, x, z)) return { x, z };
    }
    return null;
  }, [kind, cx, cz]),
});

// ---------- desktop ----------
{
  const page = await open({ viewport: { width: 1280, height: 800 } });
  const { wait, cur, screen, cmd, until, spot } = helpers(page);
  await cmd({ type: 'debug', alloys: 2000 });
  await cmd({ type: 'build', kind: 'solar', x: 22, z: 2 });
  await cmd({ type: 'build', kind: 'solar', x: -22, z: 2 });
  await wait(500);

  // 1. rotate the Vehicle Bay before placing it
  await page.keyboard.press('Escape');
  await page.click('#b-build');
  await page.click('#build-menu [data-kind="bay"]');
  const p = await spot('bay', 0, -28);
  const sp = await screen(p.x, p.z);
  await page.mouse.move(sp.x + 2, sp.y + 2);
  await page.mouse.move(sp.x, sp.y);
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await wait(300);
  const yaw = await page.evaluate(() => __exo.ui.yaw);
  check(Math.abs(yaw - Math.PI / 2) < 1e-6, 'R twice turns the ghost 90°');
  check(await page.isVisible('#place-bar'), 'placement bar is showing');
  await page.mouse.click(sp.x, sp.y);
  await wait(500);
  let bay = (await cur()).buildings.find((b) => b.kind === 'bay');
  check(!!bay && Math.abs(bay.yaw - Math.PI / 2) < 1e-6, 'placed bay keeps the rotation');

  // 2. a wall line by mouse: click start, click end
  await page.click('#b-build');
  await page.click('#build-menu [data-kind="wall"]');
  check(!(await page.isVisible('#pl-rotate')), 'no rotate button for walls (the line sets the direction)');
  const a = { x: -24, z: 20 }, b = { x: 4, z: 26 };
  const sa = await screen(a.x, a.z), sb = await screen(b.x, b.z);
  await page.mouse.click(sa.x, sa.y);
  await page.mouse.move(sb.x - 3, sb.y);
  await page.mouse.move(sb.x, sb.y);
  await wait(300);
  const preview = await page.evaluate(() => __exo.ui.ghostLine?.pts.length ?? 0);
  check(preview >= 6, `preview shows the line (${preview} segments)`);
  const n0 = (await cur()).buildings.filter((x) => x.kind === 'wall').length;
  await page.mouse.click(sb.x, sb.y);
  await wait(500);
  let walls = (await cur()).buildings.filter((x) => x.kind === 'wall');
  check(walls.length - n0 >= 6, `clicking the end builds the line (${walls.length - n0} segments)`);
  const wantYaw = Math.atan2(b.x - a.x, b.z - a.z);
  check(walls.every((w) => angle(w.yaw, wantYaw) < 1e-3), 'segments run along the line');
  check(!!(await page.evaluate(() => __exo.ui.line)), 'next line chains on from the end');
  await page.click('#pl-done');
  check(await page.evaluate(() => __exo.ui.build === null && !document.body.classList.contains('placing')), 'Done stops placing');

  // 3. finish everything, then check pads, the bay door and a turret's aim
  await cmd({ type: 'build', kind: 'turret', ...(await spot('turret', 26, -22)) });
  await wait(400);
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await until(() => __exo.sim.cur.buildings.every((b) => b.progress >= 1), null, 300000);
  await page.evaluate(() => __exo.sim.setSpeed(1));
  await wait(800);
  bay = (await cur()).buildings.find((b) => b.kind === 'bay');
  const flat = await page.evaluate(([x, z]) => {
    const hs = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].map(([dx, dz]) => __exo.height(x + dx, z + dz));
    return Math.max(...hs) - Math.min(...hs);
  }, [bay.x, bay.z]);
  check(flat < 0.01, `ground under the bay is level (spread ${flat.toFixed(3)} u)`);
  const facing = await page.evaluate((id) => __exo.region.facing(id), bay.id);
  check(angle(facing, Math.PI / 2) < 0.02, 'bay model faces its yaw');
  await cmd({ type: 'produce', id: bay.id, unit: 'rover' });
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await until(() => __exo.sim.cur.units.length > 0, null, 120000);
  await page.evaluate(() => __exo.sim.setSpeed(0));
  const u = (await cur()).units[0];
  const dir = Math.atan2(u.x - bay.x, u.z - bay.z);
  check(angle(dir, Math.PI / 2 + Math.PI) < 0.6, `rover rolled out of the door side (${dir.toFixed(2)} rad from the bay)`);
  await page.evaluate(() => __exo.sim.setSpeed(1));

  // turret aim: a predator due east of the turret → head faces east (π/2); mirrored would be −π/2
  const tur = (await cur()).buildings.find((b) => b.kind === 'turret');
  await page.evaluate(() => __exo.sim.setSpeed(1));
  await cmd({ type: 'debug', spawn: { unit: 'brute', x: tur.x + 22, z: tur.z } });
  await wait(3000);
  const aim = await page.evaluate((id) => {
    const b = __exo.sim.cur.buildings.find((x) => x.id === id);
    return { want: b.aim, got: __exo.region.facing(id, 'head') };
  }, tur.id);
  // the head eases toward its aim (slow frames under SwiftShader), so: much nearer the aim than its mirror image
  check(aim.got !== null && Math.abs(aim.want - Math.PI / 2) < 0.4 && angle(aim.got, aim.want) < 0.5 && angle(aim.got, -aim.want) > 2, `turret head faces a target to the east (want ${aim.want?.toFixed(2)}, got ${aim.got?.toFixed(2)})`);
  await page.close();
}

// ---------- touch: wall by taps ----------
{
  const page = await open({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const { wait, cur, screen, cmd } = helpers(page);
  await cmd({ type: 'debug', alloys: 1000 });
  await page.tap('#b-build');
  await page.tap('#build-menu [data-kind="wall"]');
  await wait(300);
  const a = { x: -14, z: -22 }, b = { x: 10, z: -22 };
  const sa = await screen(a.x, a.z), sb = await screen(b.x, b.z);
  await page.touchscreen.tap(sa.x, sa.y);
  await wait(300);
  await page.touchscreen.tap(sb.x, sb.y);
  await wait(300);
  const n = await page.evaluate(() => __exo.ui.ghostLine?.pts.length ?? 0);
  check(n >= 5 && (await cur()).buildings.length === 1, `touch: second tap previews the line (${n} segments), nothing built yet`);
  await page.touchscreen.tap(sb.x, sb.y);
  await wait(500);
  const walls = (await cur()).buildings.filter((x) => x.kind === 'wall').length;
  check(walls >= 5, `touch: tapping the end again builds it (${walls})`);
  await page.tap('#pl-done');
  await page.close();
}

// ---------- predators vs a wall ----------
{
  const page = await open({ viewport: { width: 800, height: 600 } });
  const { cmd, wait } = helpers(page);
  await cmd({ type: 'debug', alloys: 1000 });
  await cmd({ type: 'buildLine', kind: 'wall', x1: -30, z1: -26, x2: 30, z2: -26 });
  await wait(400);
  const n = await page.evaluate(() => __exo.sim.cur.buildings.filter((b) => b.kind === 'wall').length);
  check(n >= 12, `buildLine placed ${n} segments`);
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await page.waitForFunction(() => __exo.sim.cur.buildings.every((b) => b.progress >= 1), null, { timeout: 300000, polling: 300 });
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: -4, z: -55, n: 8 } });
  // until the first segment falls, nobody gets north of the wall
  const r = await page.evaluate(async () => {
    let leaked = 0;
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const c = __exo.sim.cur;
      const walls = c.buildings.filter((b) => b.kind === 'wall').length;
      if (walls < 15) return { leaked, broke: true };
      for (let s = 0; s < c.armySlots; s++) {
        const o = s * 7;
        if (c.army[o + 6] && c.army[o + 3] >= 2 && c.army[o + 1] > -24) leaked++;
      }
    }
    return { leaked, broke: false };
  });
  check(r.broke && r.leaked === 0, `wall holds the pack until they chew a segment down (leaked ${r.leaked}, broke ${r.broke})`);
  await page.close();
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
const page = await browser.newPage();
await page.goto(`${url}?new=1&intro=0`);
await page.waitForTimeout(1500);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
