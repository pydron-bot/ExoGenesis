/**
 * Options panel: opens from OPTIONS on the title screen, every toggle switches its feature, choices
 * survive a reload, and in game the menu (☰ / Esc) pauses, holds Save / Load / Options, and resumes.
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
    await page.goto(`http://localhost:${process.env.PORT ?? 5176}/?sw=0`);
    await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title [data-id="options"]'), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
  };
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
  const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#options .op-row')].map((r) => [r.dataset.id, r.getAttribute('aria-checked') === 'true'])));
  const live = () => page.evaluate(() => ({ glow: __exo.post.enabled, print: __exo.region.printing, water: __exo.region.waterDetail }));
  const all = await state();
  const ids = Object.keys(all), regionIds = ids.filter((k) => k.startsWith('region:'));
  check(ids.slice(-5).join() === 'glow,shadows,print,water,lights', `${name}: five graphics toggles (${ids.slice(-5).join()})`);
  check(ids[0] === 'sound' && regionIds.length > 1 && all['region:touchdown'] === true, `${name}: from the title, sound and the regions first (${regionIds.length} regions, Touchdown picked)`);
  // the graphics toggles flip and are remembered (sound and the region list have their own checks)
  const G = ['glow', 'shadows', 'print', 'water', 'lights'];
  const pick = (o) => Object.fromEntries(G.map((k) => [k, o[k]]));
  const s0 = pick(all);
  if (shots) await page.screenshot({ path: `${shots}/${name}-options.png` });
  for (const id of Object.keys(s0)) await page.click(`#options [data-id="${id}"]`);
  const s1 = pick(await state());
  check(Object.keys(s0).every((k) => s1[k] === !s0[k]), `${name}: each toggle flips (${JSON.stringify(s0)} → ${JSON.stringify(s1)})`);
  const l1 = await live();
  check(l1.glow === s1.glow && l1.print === s1.print && l1.water === s1.water, `${name}: the game follows (glow ${l1.glow}, print ${l1.print}, water ${l1.water})`);
  await page.keyboard.press('Escape');
  check(!(await page.$('#options')), `${name}: Escape closes it`);
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
  const s2 = pick(await state());
  check(JSON.stringify(s2) === JSON.stringify(s1), `${name}: remembered after a reload`);
  // put them back
  for (const id of Object.keys(s0)) if (s2[id] !== s0[id]) await page.click(`#options [data-id="${id}"]`);
  await page.click('#options .op-x');
  await ctx.close();
}

async function menu(viewport, name, mobile = false) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5176}/?sw=0&intro=0&new=1`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  const bar = await page.$$eval('#bar button', (bs) => bs.filter((b) => b.offsetParent).length);
  check(bar <= 8, `${name}: bottom bar has ${bar} buttons (Build, speed, views, Menu)`);
  check(await page.$eval('#tele', (e) => getComputedStyle(e).display === 'none'), `${name}: stats hidden by default`);
  await page.click('#b-menu');
  await page.waitForSelector('#options.menu');
  const items = await page.$$eval('#options .op-act', (bs) => bs.map((b) => b.dataset.id));
  check(['resume', 'save', 'load', 'options', 'new'].every((k) => items.includes(k)), `${name}: menu has ${items.join(', ')}`);
  check(await page.evaluate(() => __exo.sim.speed === 0 || document.querySelector('#b-pause').classList.contains('on')), `${name}: the menu pauses the game`);
  if (shots) await page.screenshot({ path: `${shots}/${name}-menu.png` });
  await page.click('#options [data-id="options"]');
  await page.waitForSelector('#options [data-id="stats"]');
  check(!!(await page.$('#options [data-id="volume"] input')), `${name}: volume sliders in Options`);
  await page.click('#options [data-id="stats"]');
  check(await page.$eval('#tele', (e) => getComputedStyle(e).display !== 'none'), `${name}: Performance stats shows them`);
  await page.click('#options [data-id="stats"]');
  await page.keyboard.press('Escape');
  check(!!(await page.$('#options.menu')), `${name}: closing Options goes back to the menu`);
  await page.keyboard.press('Escape');
  check(!(await page.$('#options')) && await page.evaluate(() => document.querySelector('#b-play').classList.contains('on')), `${name}: Escape closes the menu and the game resumes`);
  // the game starts with the drone selected: the first Escape lets go of it, the next opens the menu
  await page.keyboard.press('Escape');
  check(!(await page.$('#options')), `${name}: Escape with something selected only deselects`);
  await page.keyboard.press('Escape');
  check(!!(await page.$('#options.menu')), `${name}: Escape with nothing selected opens the menu`);
  await page.click('#options [data-id="new"]');
  check(!!(await page.$('#options [data-id="new"].armed')), `${name}: New game asks for a second tap`);
  await ctx.close();
}

await menu({ width: 1280, height: 800 }, 'desktop game');
await menu({ width: 390, height: 760 }, 'phone game', true);
await run({ width: 1280, height: 800 }, 'desktop');
await run({ width: 390, height: 760 }, 'phone', true);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall options checks passed');
process.exit(failed ? 1 : 0);
