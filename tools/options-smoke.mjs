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
  const live = () => page.evaluate(() => ({ glow: __exo.post.enabled, flare: __exo.flare.enabled, dust: __exo.dust.enabled, weather: __exo.weather.enabled, print: __exo.region.printing, water: __exo.region.waterDetail, grade: __exo.post.grading, clouds: __exo.groundSky.cloudShadows, marks: __exo.marks.enabled }));
  const all = await state();
  const ids = Object.keys(all), regionIds = ids.filter((k) => k.startsWith('region:'));
  check(ids.slice(-16).join() === 'glow,aa,reflect,ao,mist,grade,flare,dust,zoomblur,weather,shadows,clouds,marks,print,water,lights', `${name}: sixteen graphics rows (${ids.slice(-16).join()})`);
  const first = ids.filter((k) => !k.startsWith('ap:'));
  check(first[0] === 'sound' && ids.slice(0, ids.indexOf('sound')).every((k) => k.startsWith('ap:')) && regionIds.length > 1 && all['region:touchdown'] === true, `${name}: from the title, the autopilot rows, then sound and the regions (${regionIds.length} regions, Touchdown picked)`);
  // the graphics toggles flip and are remembered (sound and the region list have their own checks)
  const G = ['glow', 'reflect', 'ao', 'mist', 'grade', 'flare', 'dust', 'zoomblur', 'weather', 'shadows', 'clouds', 'marks', 'print', 'water', 'lights'];
  const pick = (o) => Object.fromEntries(G.map((k) => [k, o[k]]));
  const s0 = pick(all);
  if (shots) await page.screenshot({ path: `${shots}/${name}-options.png` });
  for (const id of Object.keys(s0)) await page.click(`#options [data-id="${id}"]`);
  const s1 = pick(await state());
  check(Object.keys(s0).every((k) => s1[k] === !s0[k]), `${name}: each toggle flips (${JSON.stringify(s0)} → ${JSON.stringify(s1)})`);
  const l1 = await live();
  check(l1.glow === s1.glow && l1.flare === s1.flare && l1.dust === s1.dust && l1.weather === s1.weather && l1.print === s1.print && l1.water === s1.water
    && l1.grade === s1.grade && l1.clouds === s1.clouds && l1.marks === s1.marks, `${name}: the game follows (glow ${l1.glow}, print ${l1.print}, water ${l1.water}, grade ${l1.grade}, clouds ${l1.clouds}, marks ${l1.marks})`);
  await page.keyboard.press('Escape');
  check(!(await page.$('#options')), `${name}: Escape closes it`);
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
  const s2 = pick(await state());
  check(JSON.stringify(s2) === JSON.stringify(s1), `${name}: remembered after a reload`);
  // put them back
  for (const id of Object.keys(s0)) if (s2[id] !== s0[id]) await page.click(`#options [data-id="${id}"]`);
  // anti-aliasing cycles auto → off → fxaa → smaa → msaa → auto, says what is in use, and is remembered
  const aa = () => page.evaluate(() => ({ mode: __exo.post.aa, used: __exo.post.aaInUse, label: document.querySelector('#options [data-id="aa"] .op-state').textContent }));
  const a0 = await aa();
  check(a0.mode === 'auto' && a0.label === `AUTO · ${a0.used.toUpperCase()}`, `${name}: anti-aliasing starts on auto (${a0.label})`);
  const seen = [];
  for (let i = 0; i < 5; i++) { await page.click('#options [data-id="aa"]'); await page.waitForTimeout(150); seen.push(await aa()); }
  check(seen.map((a) => a.mode).join() === 'off,fxaa,smaa,msaa,auto', `${name}: anti-aliasing cycles (${seen.map((a) => a.label).join(' → ')})`);
  check(seen[1].used === 'fxaa' && seen[2].used === 'smaa' && seen[3].used === 'msaa', `${name}: FXAA, SMAA and MSAA each take effect at once`);
  await page.click('#options [data-id="aa"]'); await page.click('#options [data-id="aa"]'); await page.click('#options [data-id="aa"]'); // smaa
  await open();
  check((await page.evaluate(() => [__exo.post.aa, __exo.post.aaInUse].join())) === 'smaa,smaa', `${name}: anti-aliasing remembered after a reload`);
  await page.evaluate(() => localStorage.removeItem('exo.aa'));
  await open();
  await page.click('#title [data-id="options"]');
  await page.waitForSelector('#options .op-row');
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
  check(await page.evaluate(() => document.querySelector('#b-pause').classList.contains('on') && !document.querySelector('#b-play').classList.contains('on')), `${name}: Options from the menu keeps the game paused`);
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
