/**
 * Selecting several units at once, through real pointer input (src/input.ts):
 *   - paint: hold empty ground until it buzzes, then drag over units (mouse, and touch on a phone-sized page)
 *   - a quick drag on the ground still pans and leaves the selection alone
 *   - Ctrl + drag draws a box (desktop); Ctrl + Shift adds to the selection
 *   node tools/select-smoke.mjs [--url http://localhost:5176/] [--only mouse|touch]
 */
import { answerBriefing, launch } from './lib/harness.mjs';
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const browser = await launch();
let failed = 0; const check = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`); if (!ok) failed++; };
for (const touch of [false, true].filter((t) => !only || only === (t ? 'touch' : 'mouse'))) {
  const ctx = await browser.newContext(touch ? { viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const wait = (ms) => page.waitForTimeout(ms);
  await answerBriefing(page); // (the opening's briefing would cover the ground with its card)
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await wait(1500);
  await page.evaluate(() => __exo.sim.command({ type: 'debug', units: { unit: 'rover', x: 30, z: 30, n: 6 } }));
  await page.waitForFunction(() => __exo.sim.cur.units.length >= 6, null, { timeout: 30000 });
  await page.evaluate(() => { __exo.sim.setSpeed(0); __exo.cam.fx = 30; __exo.cam.fz = 30; });
  await wait(1500);
  const pts = await page.evaluate(() => __exo.sim.cur.units.map((u) => ({ id: u.id, ...__exo.unitScreen(u.id) })).filter((p) => p.x != null));
  const sel = () => page.evaluate(() => (__exo.ui.sel?.kind === 'units' ? [...__exo.ui.sel.ids] : []));
  console.log(touch ? 'touch' : 'mouse', 'units on screen', pts.length);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const camBefore = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
  const cdp = await ctx.newCDPSession(page);
  const tp = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  // paint: hold on empty ground left of the group, then sweep through them
  const sx = x0 - 60, sy = (y0 + y1) / 2;
  if (touch) { await tp('touchStart', sx, sy); await wait(650); for (let i = 0; i <= 20; i++) { await tp('touchMove', sx + (x1 - sx + 40) * i / 20, y0 + (y1 - y0) * i / 20); await wait(20); } }
  else { await page.mouse.move(sx, sy); await page.mouse.down(); await wait(650); for (let i = 0; i <= 20; i++) { await page.mouse.move(sx + (x1 - sx + 40) * i / 20, y0 + (y1 - y0) * i / 20); await wait(20); } }
  const mid = await sel();
  if (touch) await tp('touchEnd'); else await page.mouse.up();
  await wait(300);
  const s1 = await sel();
  const camAfter = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
  check(s1.length >= Math.min(4, pts.length) && mid.length === s1.length, `${touch ? 'touch' : 'mouse'} paint selected ${s1.length} of ${pts.length}`);
  check(Math.hypot(camAfter[0] - camBefore[0], camAfter[1] - camBefore[1]) < 0.5, 'painting does not pan the camera');
  // a quick drag still pans and leaves the selection alone
  // (under software rendering a slow frame can hold the moves back past the hold time, and the drag becomes a
  // paint: try again, with the selection put back, up to three times)
  let panned = false, kept = false;
  for (let k = 0; k < 3 && !(panned && kept); k++) {
    const c0 = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
    // a flick: two long moves (each event is a round trip to the browser, so many small ones could add up past the hold time)
    if (touch) { await tp('touchStart', sx, sy + 150); await tp('touchMove', sx + 40, sy + 150); await tp('touchMove', sx + 80, sy + 150); await tp('touchEnd'); }
    else { await page.mouse.move(sx, sy + 150); await page.mouse.down(); await page.mouse.move(sx + 80, sy + 150, { steps: 2 }); await page.mouse.up(); }
    await wait(200);
    const camPan = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
    panned = Math.hypot(camPan[0] - c0[0], camPan[1] - c0[1]) > 0.5;
    kept = (await sel()).length === s1.length;
    if (!(panned && kept)) await page.evaluate((ids) => { __exo.ui.sel = { kind: 'units', ids }; }, s1);
  }
  check(panned && kept, 'a quick drag still pans and keeps the selection');
  if (!touch) {
    await page.keyboard.press('Escape'); await wait(200);
    const pts2 = await page.evaluate(() => __exo.sim.cur.units.map((u) => ({ id: u.id, ...__exo.unitScreen(u.id) })).filter((p) => p.x != null));
    const xs2 = pts2.map((p) => p.x), ys2 = pts2.map((p) => p.y);
    const camB = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
    await page.keyboard.down('Control');
    await page.mouse.move(Math.min(...xs2) - 15, Math.min(...ys2) - 15); await page.mouse.down();
    await page.mouse.move(Math.max(...xs2) + 15, Math.max(...ys2) + 15, { steps: 8 });
    await page.mouse.up(); await page.keyboard.up('Control'); await wait(200);
    const s2 = await sel();
    const camA = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz]);
    check(s2.length === pts2.length && pts2.length > 0, `Ctrl-drag box selected ${s2.length} of ${pts2.length}`);
    check(Math.hypot(camA[0] - camB[0], camA[1] - camB[1]) < 0.5, 'the box does not pan');
    // a small box with Shift adds
    const one = pts2[0];
    await page.keyboard.press('Escape'); await wait(100);
    await page.mouse.click(one.x, one.y); await wait(400);
    const other = pts2.find((p) => Math.hypot(p.x - one.x, p.y - one.y) > 25) ?? pts2[1];
    await page.keyboard.down('Control'); await page.keyboard.down('Shift');
    await page.mouse.move(other.x - 8, other.y - 8); await page.mouse.down(); await page.mouse.move(other.x + 8, other.y + 8, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await wait(200);
    const s3 = await sel();
    check(s3.includes(one.id) && s3.includes(other.id), `Ctrl+Shift box adds (${s3.length} selected)`);
  }
  check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
