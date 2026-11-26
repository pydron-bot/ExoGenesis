/**
 * Skirmish selection smoke test through real pointer input:
 * tap, hold, double-tap, paint, control groups, tap-to-move, drag order, box select.
 *   node tools/skirmish-smoke.mjs [--gpu] [--touch]
 */
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const sel = () => page.evaluate(() => __exo.skirmish.ui.selected.size);
const clearSel = () => page.click('#sk-clear');

const extra = process.argv.includes('--smooth') ? '&look=smooth' : '';
await page.goto(`${process.env.SMOKE_URL ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/')}?mode=skirmish&units=200&wave=10${extra}`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 60000 });
await page.click('#sk-pause'); // freeze the army so screen positions stay put
await page.waitForTimeout(800);

const units = await page.evaluate(() => {
  const out = [];
  for (let s = 0; s < __exo.skirmish.army.slots; s++) { const p = __exo.skirmish.unitScreen(s); if (p) out.push({ s, ...p }); }
  return out;
});
check(units.length > 50, `${units.length} units on screen`);
const cx = 640, cy = 400;
// a unit of a type that's clear of the HUD bars and has no other unit within tap range
const isolated = (type) => units
  .filter((u) => u.type === type && u.y > 130 && u.y < 640 && u.x > 60 && u.x < 1220)
  .map((u) => ({ ...u, gap: Math.min(...units.filter((o) => o.s !== u.s).map((o) => Math.hypot(o.x - u.x, o.y - u.y))) }))
  .sort((a, b) => b.gap - a.gap)[0];
const rover = isolated(0);

// 1. tap a unit
await page.mouse.click(rover.x, rover.y);
check((await sel()) === 1, 'tap selects one unit');

// 2. hold on a unit → all of that type on screen
await clearSel();
await page.mouse.move(rover.x, rover.y);
await page.mouse.down();
await page.waitForTimeout(1000); // hold is 420 ms; software-rendered frames are slow, so leave margin
await page.mouse.up();
const roversOnScreen = units.filter((u) => u.type === 0).length;
const held = await sel();
check(held >= roversOnScreen * 0.9, `hold selects same type on screen (${held} of ${roversOnScreen} rovers)`);
const allRovers = await page.evaluate(() => [...__exo.skirmish.ui.selected.keys()].every((s) => __exo.skirmish.army.type[s] === 0));
check(allRovers, 'hold selection contains only rovers');

// 3. double-tap a tank → all tanks
await clearSel();
const tank = isolated(1);
// software rendering in CI is slow enough that two clicks can land >320 ms apart; retry
let tanks = 0;
for (let attempt = 0; attempt < 4 && tanks <= 5; attempt++) {
  await clearSel();
  await page.waitForTimeout(400);
  await page.mouse.click(tank.x, tank.y);
  await page.mouse.click(tank.x, tank.y);
  tanks = await sel();
}
check(tanks > 5, `double-tap selects all tanks on screen (${tanks})`);

// 4. control group: long-press 1 to assign, clear, tap 1 to recall
const gb = await page.locator('#sk-g1').boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.waitForTimeout(1200); // long-press is 500 ms; margin for slow software rendering
await page.mouse.up();
await clearSel();
check((await sel()) === 0, 'clear empties selection');
await page.waitForTimeout(400);
await page.click('#sk-g1');
check((await sel()) === tanks, `group 1 recalls ${tanks} tanks`);

// 5. paint-select: swipe across the army
await clearSel();
await page.click('#sk-paint');
await page.mouse.move(cx - 260, cy - 30);
await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 260 + i * 26, cy - 30 + Math.sin(i / 3) * 40);
await page.mouse.up();
const painted = await sel();
check(painted > 15 && painted < units.length, `paint swipe selects a band of units (${painted})`);
await page.click('#sk-paint');

// 6. tap ground → move order; units travel
await page.click('#sk-play');
const target = { x: 1100, y: 250 };
const before = await page.evaluate(() => { const s = [...__exo.skirmish.ui.selected.keys()][0]; return { s, x: __exo.skirmish.army.lx[s], z: __exo.skirmish.army.lz[s] }; });
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(3500);
const after = await page.evaluate((s) => ({ x: __exo.skirmish.army.lx[s], z: __exo.skirmish.army.lz[s] }), before.s);
check(Math.hypot(after.x - before.x, after.z - before.z) > 8, `tap ground moves the selection (${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} units travelled)`);

// 7. box select on empty ground (mouse)
await clearSel();
await page.click('#sk-pause');
await page.waitForTimeout(300);
await page.mouse.move(cx - 150, cy - 120);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cx - 150 + i * 30, cy - 120 + i * 24);
await page.mouse.up();
const boxed = await sel();
const boxedSlots = await page.evaluate(() => [...__exo.skirmish.ui.selected.keys()]);
check(boxed > 5, `box-select with the mouse (${boxed})`);

// 8. drag from a selected unit → order vector
// a selected unit near the centre of the screen (away from the HUD bars)
const pickOne = () => page.evaluate(() => {
  let best = null;
  for (const s of __exo.skirmish.ui.selected.keys()) {
    const p = __exo.skirmish.unitScreen(s);
    if (p && p.y > 130 && p.y < 640 && (!best || Math.hypot(p.x - 640, p.y - 400) < Math.hypot(best.x - 640, best.y - 400))) best = p;
  }
  return best;
});
let one = await pickOne();
if (one) {
  // the first move must arrive before the 420 ms hold fires; slow software frames can miss that, so retry
  let dragging = false;
  for (let attempt = 0; attempt < 4 && !dragging; attempt++) {
  if (attempt) { await clearSel(); for (const k of boxedSlots) await page.evaluate((s) => __exo.skirmish.ui.selected.set(s, __exo.skirmish.ui.gens(s)), k); }
  // units move: find it again right before grabbing it (a stale position misses it)
  one = (await pickOne()) ?? one;
  await page.mouse.move(one.x, one.y);
  await page.mouse.down();
  // aim toward the middle of the screen so the vector stays over the region
  const dx = (640 - one.x) || 1, dy = (420 - one.y) || 1, l = Math.hypot(dx, dy);
  for (let i = 1; i <= 10; i++) await page.mouse.move(one.x + (dx / l) * i * 18 + i * 6, one.y + (dy / l) * i * 18);
  dragging = await page.evaluate(() => !!__exo.skirmish.ui.drag);
  await page.mouse.up();
  }
  check(dragging, 'drag from a selected unit aims an order vector');
  check((await sel()) === boxed, 'order drag keeps the selection');
}

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
