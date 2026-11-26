/**
 * Phone-size HUD screenshots (iPhone-like viewport, touch): start, build menu,
 * Vehicle Bay card, army selected, radar offline. For checking the phone layout.
 *   node tools/phone-shot.mjs <outDir> [width=390]
 */
import { launch } from './lib/harness.mjs';
const out = process.argv[2];
const w = Number(process.argv[3] ?? 390);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: w, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto((process.env.SMOKE_URL ?? 'http://localhost:5176/') + '?intro=0&new=1&look=smooth');
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/p1-start-${w}.png` });
await page.tap('#b-build'); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/p2-menu-${w}.png` });
await page.tap('#b-build'); 
await page.evaluate(() => { __exo.sim.command({ type: 'debug', alloys: 900 });
  for (const [k,x,z] of [['solar',22,0],['battery',-20,4],['radar',0,24],['bay',2,-28],['turret',-18,-18]]) { for (let r=0;r<30;r+=2){let d=false; for(let a=0;a<6.28;a+=0.3){const X=x+Math.cos(a)*r,Z=z+Math.sin(a)*r; if(!__exo.canPlace(k,X,Z)){__exo.sim.command({type:'build',kind:k,x:X,z:Z}); d=true; break;}} if(d)break;} } });
await page.waitForTimeout(500);
await page.evaluate(() => __exo.sim.setSpeed(3));
await page.waitForFunction(() => __exo.sim.cur.buildings.filter((b) => b.progress >= 1).length >= 6, null, { timeout: 300000 });
const bay = await page.evaluate(() => __exo.sim.cur.buildings.find((b) => b.kind === 'bay'));
await page.evaluate((id) => { __exo.sim.command({ type: 'produce', id, unit: 'rover' }); __exo.sim.command({ type: 'produce', id, unit: 'tank' }); __exo.sim.command({ type: 'produce', id, unit: 'rover' }); }, bay.id);
await page.waitForTimeout(3000);
await page.evaluate(() => __exo.sim.setSpeed(1));
await page.evaluate((id) => { __exo.ui.sel = { kind: 'building', id }; __exo.hud.selected(); }, bay.id);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/p3-bay-${w}.png` });
await page.evaluate(() => __exo.sim.setSpeed(3));
await page.waitForFunction(() => __exo.sim.cur.units.length >= 2, null, { timeout: 300000 });
await page.evaluate(() => __exo.sim.setSpeed(1));
await page.tap('#r-army'); await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/p4-units-${w}.png` });
// radar off
const radar = await page.evaluate(() => __exo.sim.cur.buildings.find((b) => b.kind === 'radar')?.id);
if (radar !== undefined) await page.evaluate((id) => __exo.sim.command({ type: 'power', id, on: false }), radar);
await page.waitForTimeout(5500);
await page.screenshot({ path: `${out}/p5-radaroff-${w}.png` });
console.log('bar height', await page.evaluate(() => document.getElementById('bar').offsetHeight), 'errors', errs);
await page.goto((process.env.SMOKE_URL ?? 'http://localhost:5176/') + '?new=1&intro=0'); await page.waitForTimeout(1500);
await browser.close();
