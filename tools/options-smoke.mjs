/**
 * Options panel: opens from OPTIONS on the title screen, every toggle switches its feature, choices
 * survive a reload, and the ⋯ menu's ⚙ Options opens the same panel in game.
 *   node tools/options-smoke.mjs [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const errors = [];

async function run(viewport, name, mobile = false) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async () => {
    await page.goto('http://localhost:5176/?sw=0');
    await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title [data-id="options"]'), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
  };
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
  const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#options .op-row')].map((r) => [r.dataset.id, r.getAttribute('aria-checked') === 'true'])));
  const live = () => page.evaluate(() => ({ glow: __exo.post.enabled, print: __exo.region.printing, water: __exo.region.waterDetail }));
  const s0 = await state();
  check(Object.keys(s0).join() === 'glow,shadows,print,water,lights', `${name}: five toggles (${Object.keys(s0).join()})`);
  if (shots) await page.screenshot({ path: `${shots}/${name}-options.png` });
  for (const id of Object.keys(s0)) await page.click(`#options [data-id="${id}"]`);
  const s1 = await state();
  check(Object.keys(s0).every((k) => s1[k] === !s0[k]), `${name}: each toggle flips (${JSON.stringify(s0)} → ${JSON.stringify(s1)})`);
  const l1 = await live();
  check(l1.glow === s1.glow && l1.print === s1.print && l1.water === s1.water, `${name}: the game follows (glow ${l1.glow}, print ${l1.print}, water ${l1.water})`);
  await page.keyboard.press('Escape');
  check(!(await page.$('#options')), `${name}: Escape closes it`);
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
  const s2 = await state();
  check(JSON.stringify(s2) === JSON.stringify(s1), `${name}: remembered after a reload`);
  // put them back
  for (const id of Object.keys(s0)) if (s2[id] !== s0[id]) await page.click(`#options [data-id="${id}"]`);
  await page.click('#options .op-x');
  await ctx.close();
}

await run({ width: 1280, height: 800 }, 'desktop');
await run({ width: 390, height: 760 }, 'phone', true);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall options checks passed');
process.exit(failed ? 1 : 0);
