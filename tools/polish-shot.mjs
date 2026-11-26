/**
 * Visual polish shots (glow, ground shadows, printed construction): stages a colony with
 * buildings, a few under construction, vehicles and a pack, and shoots it per mode and hour.
 *   node tools/polish-shot.mjs [--out shots/polish] [--hours 23,12] [--modes "on:&bloom=1,off:&bloom=0&shadows=0"]
 *     [--dist 110] [--cx 0] [--cz 0] [--fight] [--w 1280 --h 720] [--perf]
 * --perf also reports the mean frame time over 3 s per mode (SwiftShader: compare modes, not absolutes).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => {
  if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const out = a.out ?? 'shots/polish';
const hours = String(a.hours ?? '23,12').split(',').map(Number);
const modes = String(a.modes ?? 'on:&bloom=1,off:&bloom=0&shadows=0').split(',').map((m) => m.split(':'));
mkdirSync(out, { recursive: true });
const hp = (k) => JSON.parse(readFileSync(`content/buildings/${k}.json`, 'utf8')).hp ?? 500;
const ring = [
  ['depot', 22, 0], ['bay', 20, 60], ['civic', 22, 120], ['hydroponics', 20, 180], ['geothermal', 22, 225],
  ['radar', 18, 290], ['battery', 14, 320], ['turret', 34, 30], ['turret', 34, 150],
  ['cannon', 36, 270], ['repairpad', 30, 90], ['solar', 30, 200], ['pointdefense', 32, 340],
].map(([kind, r, deg]) => ({ kind, x: +(r * Math.sin(deg * Math.PI / 180)).toFixed(1), z: +(r * Math.cos(deg * Math.PI / 180)).toFixed(1), hp: hp(kind) }));
// under construction, at different stages
const building = [['civic', -30, -30, 0.35], ['bay', 0, -40, 0.65], ['radar', 28, -34, 0.15]];
const browser = await launch();
for (const hour of hours) {
  for (const [name, q] of modes) {
    const page = await browser.newPage({ viewport: { width: Number(a.w ?? 1280), height: Number(a.h ?? 720) } });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
    await page.goto(`${process.env.SMOKE_URL ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/')}?intro=0&new=1&ui=0&fog=0&sw=0&dpr=1${q}`);
    await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
    await page.evaluate(async ([ring, building, hour]) => {
      const s = await __exo.sim.save();
      const secs = ((hour - 7 + 24) % 24) / 24 * 360;
      s.tick = Math.round(secs * 10);
      for (const b of ring) s.buildings.push({ id: s.nextId++, kind: b.kind, x: b.x, z: b.z, yaw: 0, progress: 1, hp: b.hp, on: true, powered: true });
      for (const [kind, x, z, p] of building) s.buildings.push({ id: s.nextId++, kind, x, z, yaw: 0, progress: p, hp: 100, on: true, powered: true });
      s.stored = 1e6;
      __exo.sim.load(s);
    }, [ring, building, hour]);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      __exo.sim.command({ type: 'debug', units: { unit: 'tank', x: 0, z: -20, n: 3 } });
      __exo.sim.command({ type: 'debug', units: { unit: 'rover', x: 10, z: -20, n: 3 } });
    });
    await page.evaluate(([x, z, d]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = d; __exo.cam.targetPitch = 0.95; },
      [Number(a.cx ?? 0), Number(a.cz ?? -10), Number(a.dist ?? 110)]);
    await page.waitForTimeout(Number(a.wait ?? 6) * 1000);
    if (a.perf) {
      const ms = await page.evaluate(() => new Promise((res) => {
        const ts = []; const t0 = performance.now();
        const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else res((ts.at(-1) - ts[0]) / (ts.length - 1)); };
        requestAnimationFrame(f);
      }));
      console.log(`${hour}h ${name}: ${ms.toFixed(1)} ms/frame`);
    }
    await page.screenshot({ path: `${out}/${hour}h-${name}.png` });
    if (a.fight) {
      await page.evaluate(() => {
        __exo.sim.command({ type: 'debug', spawn: { unit: 'brute', x: -10, z: 50, n: 6 } });
        __exo.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 12, z: 48, n: 16 } });
      });
      await page.waitForTimeout(Number(a.fightms ?? 3500));
      await page.screenshot({ path: `${out}/${hour}h-${name}-fight.png` });
    }
    await page.close();
  }
}
await browser.close();
