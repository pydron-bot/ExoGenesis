/**
 * Colony lights: stages a night colony (injected buildings, vehicles, a pack) and shoots it
 * with lights on and with ?lights=0. node tools/lights-shot.mjs [--out shots/lights] [--hour 23]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => {
  if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const out = a.out ?? 'shots/lights';
const hour = Number(a.hour ?? 23);
const modes = String(a.modes ?? 'on,off').split(',');
mkdirSync(out, { recursive: true });
const hp = (k) => JSON.parse(readFileSync(`content/buildings/${k}.json`, 'utf8')).hp ?? 500;
const ring = [
  ['depot', 22, 0], ['bay', 20, 60], ['civic', 22, 120], ['hydroponics', 20, 180], ['geothermal', 22, 225],
  ['geothermal', 30, 250], ['radar', 18, 290], ['battery', 14, 320], ['turret', 34, 30], ['turret', 34, 150],
  ['cannon', 36, 270], ['repairpad', 30, 90], ['solar', 30, 200], ['pointdefense', 32, 340],
].map(([kind, r, deg], i) => ({ kind, x: +(r * Math.sin(deg * Math.PI / 180)).toFixed(1), z: +(r * Math.cos(deg * Math.PI / 180)).toFixed(1), hp: hp(kind), i }));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const mode of modes) {
  const page = await browser.newPage({ viewport: { width: Number(a.w ?? 1280), height: Number(a.h ?? 720) } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
  await page.goto(`http://localhost:5176/?intro=0&new=1&ui=0&fog=0&sw=0${mode === 'on' ? '&lights=1' : '&lights=0'}`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
  await page.evaluate(async ([ring, hour]) => {
    const s = await __exo.sim.save();
    const secs = ((hour - 7 + 24) % 24) / 24 * 360;
    s.tick = Math.round(secs * 10);
    for (const b of ring) s.buildings.push({ id: s.nextId++, kind: b.kind, x: b.x, z: b.z, yaw: 0, progress: 1, hp: b.hp, on: true, powered: true });
    s.buildings.push({ id: s.nextId++, kind: 'depot', x: -40, z: -20, yaw: 0, progress: 0.4, hp: 100, on: true, powered: true });
    s.stored = 1e6;
    __exo.sim.load(s);
  }, [ring, hour]);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    __exo.sim.command({ type: 'debug', units: { unit: 'tank', x: 0, z: -30, n: 3 } });
    __exo.sim.command({ type: 'debug', units: { unit: 'rover', x: 10, z: -30, n: 3 } });
    __exo.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 0, z: 60, n: 10 } });
    __exo.sim.command({ type: 'debug', wave: true });
  });
  await page.evaluate(([x, z, d]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = d; __exo.cam.targetPitch = 0.95; },
    [Number(a.cx ?? 0), Number(a.cz ?? 0), Number(a.dist ?? 110)]);
  await page.waitForTimeout(Number(a.wait ?? 8) * 1000);
  const info = await page.evaluate(() => ({ hour: __exo.sim.cur.daylight, n: __exo.sim.cur.buildings.filter((b) => b.powered).length, units: __exo.sim.cur.units.length, hostiles: __exo.sim.cur.hostiles }));
  console.log(mode, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${mode}-calm.png` });
  await page.evaluate((fz) => {
    __exo.sim.command({ type: 'debug', spawn: { unit: 'brute', x: -10, z: fz, n: 6 } });
    __exo.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 12, z: fz - 2, n: 16 } });
  }, Number(a.fz ?? 48));
  await page.waitForTimeout(Number(a.fight ?? 2500));
  for (let k = 0; k < Number(a.n ?? 3); k++) {
    await page.screenshot({ path: `${out}/${mode}-${k}.png` });
    await page.waitForTimeout(700);
  }
  await page.close();
}
await browser.close();
