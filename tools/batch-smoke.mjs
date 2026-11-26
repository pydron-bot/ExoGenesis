/**
 * Instanced buildings smoke test: stages a base of every batched kind, checks that the
 * batches hold them, that defence heads still turn toward a pack, that unpowered
 * buildings stay batched, and reports draw calls. node tools/batch-smoke.mjs [--out shots/batch]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'shots/batch';
mkdirSync(out, { recursive: true });
const hp = (k) => JSON.parse(readFileSync(`content/buildings/${k}.json`, 'utf8')).hp ?? 500;
const kinds = ['turret', 'pointdefense', 'cannon', 'radar', 'wall', 'solar', 'battery'];
const ring = [];
kinds.forEach((kind, k) => { for (let i = 0; i < 3; i++) { const a = (k * 3 + i) / (kinds.length * 3) * Math.PI * 2; ring.push({ kind, x: +(32 * Math.sin(a)).toFixed(1), z: +(32 * Math.cos(a)).toFixed(1), hp: hp(kind) }); } });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

await page.goto((process.env.SMOKE_URL ?? 'http://localhost:5176/') + '?intro=0&new=1&ui=0&fog=0&sw=0');
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
await page.evaluate(async (ring) => {
  const s = await __exo.sim.save();
  s.tick = 300 * 10; // mid-afternoon
  for (const b of ring) s.buildings.push({ id: s.nextId++, kind: b.kind, x: b.x, z: b.z, yaw: 0, progress: 1, hp: b.hp, on: true, powered: true });
  s.stored = 1e6;
  __exo.sim.load(s);
}, ring);
await page.evaluate(() => { __exo.cam.fx = 0; __exo.cam.fz = 0; __exo.cam.targetDist = 95; __exo.cam.targetPitch = 0.9; });
await page.waitForTimeout(2500);

const stats = await page.evaluate(() => __exo.region.batchStats());
for (const k of kinds) check(stats[k]?.count === 3, `${k}: 3 in its batch (${stats[k]?.count ?? 0}), ${stats[k]?.drawCalls ?? '?'} draws`);
const ids = await page.evaluate(() => __exo.sim.cur.buildings.filter((b) => ['turret', 'pointdefense', 'cannon'].includes(b.kind)).map((b) => b.id));
await page.screenshot({ path: `${out}/calm.png` });
const calls = await page.evaluate(() => __exo.renderer.info.render.calls);
console.log('draw calls (whole frame):', calls);

// a pack walks in: every defence that has a target should point its head at it
await page.evaluate(() => __exo.sim.command({ type: 'debug', spawn: { unit: 'brute', x: 0, z: 50, n: 6 } }));
await page.waitForTimeout(3000);
const aims = await page.evaluate((ids) => ids.map((id) => {
  const b = __exo.sim.cur.buildings.find((x) => x.id === id);
  return b ? { aim: b.aim, face: __exo.region.facing(id, 'head') } : null;
}), ids);
const aiming = aims.filter((a) => a && a.aim !== undefined);
const onTarget = aiming.filter((a) => Math.abs(Math.atan2(Math.sin(a.face - a.aim), Math.cos(a.face - a.aim))) < 0.35).length;
check(aiming.length >= 3 && onTarget >= aiming.length - 1, `defence heads point at their targets (${onTarget}/${aiming.length} aiming)`);
await page.screenshot({ path: `${out}/fight.png` });

// the batch draws the head where the stand-in points: compare a head instance's forward with facing()
const match = await page.evaluate((id) => {
  const r = __exo.region, b = r.batches.get('turret');
  const sub = b.sub, i = sub.slot.get(id);
  const m = sub.mats[i].clone();
  const e = r.buildings.get(id), head = e.obj.getObjectByName('head');
  head.updateMatrix();
  const want = e.obj.matrix.clone().multiply(head.matrix);
  return want.elements.every((v, k) => Math.abs(v - m.elements[k]) < 1e-3);
}, ids[0]);
check(match, 'turret head instance follows its aim');

// power off: still batched (dimmed pool)
await page.evaluate(async () => {
  const s = await __exo.sim.save();
  s.stored = 0;
  for (const b of s.buildings) if (b.kind === 'solar') b.on = false;
  __exo.sim.load(s);
});
await page.waitForTimeout(1500);
const stats2 = await page.evaluate(() => __exo.region.batchStats());
check(stats2.turret?.count === 3, 'turrets stay batched through a power change');
check(!errors.length, `no page errors ${errors.slice(0, 2).join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
