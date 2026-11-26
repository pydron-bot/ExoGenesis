/**
 * Movement types and water (v0.34): on a coastal region that keeps its sea,
 *  - a ground unit ordered across a bay finds its way round it (never in the water),
 *  - a hover unit (Hover Skiff) skims straight across, riding on the water,
 *  - a ground predator walks round the water to reach the base, a hover one (Strider) wades through.
 *   node tools/hover-smoke.mjs [--url http://localhost:5176/] [--shots dir]
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const url = arg('--url') ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const shots = arg('--shots');
if (shots) mkdirSync(shots, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);

// the region smoke's coastal site, keeping its sea
const td = JSON.parse(readFileSync('content/regions/touchdown.json', 'utf8'));
const coast = { ...td, name: 'Hover Test', height: undefined, flora: undefined, ground: undefined, siteLat: -16, siteLon: -12, keepSea: true, herds: [], packs: undefined, graceSeconds: 3000 };
await page.goto(`${url}?sw=0&title=0`);
await page.evaluate((def) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'hovertest', def })), coast);
await page.goto(`${url}?preview=1&intro=0&new=1&fog=0&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });

// a straight line from dry land, across at least 12 u of water, to dry land again
const route = await page.evaluate(() => {
  const raw = __exo.heightRaw, best = [];
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const dx = Math.sin(a), dz = Math.cos(a);
    let land0 = -1, wetFrom = -1, wetTo = -1;
    for (let r = 20; r < 105; r += 1) {
      const wet = raw(dx * r, dz * r) < 0.3;
      if (!wet && wetFrom < 0) land0 = r;
      else if (wet && wetFrom < 0 && land0 > 0) wetFrom = r;
      else if (!wet && wetFrom > 0) { wetTo = r; break; }
    }
    // dry for a few units on the far side, so the goal isn't on a sandbar
    const dry = (r) => raw(dx * r, dz * r) >= 0.6;
    if (wetFrom > 0 && wetTo > 0 && wetTo - wetFrom >= 12 && [3, 6].every((k) => dry(wetTo + k)) && [3, 6, 8].every((k) => dry(wetFrom - k))) {
      best.push({ a, from: [dx * (wetFrom - 6), dz * (wetFrom - 6)], to: [dx * (wetTo + 5), dz * (wetTo + 5)], wet: wetTo - wetFrom });
    }
  }
  best.sort((p, q) => q.wet - p.wet);
  return best[0] ?? null;
});
check(!!route, `found a bay to cross (${route ? `${route.wet} u of water` : 'none'})`);
if (!route) { await browser.close(); process.exit(1); }

/** Follow one unit (or hostile) for `secs`, counting samples in the water. */
async function follow(kind, id, secs) {
  const out = { n: 0, wet: 0, deep: 0, end: null, lift: [] };
  for (let t = 0; t < secs * 4; t++) {
    await page.waitForTimeout(250);
    const p = await page.evaluate(async ([kind, id]) => {
      const list = kind === 'unit' ? __exo.sim.cur.units : (await __exo.sim.save()).hostiles; // the snapshot only counts hostiles
      const u = list.find((v) => v.id === id);
      return u ? { x: u.x, z: u.z, h: __exo.heightRaw(u.x, u.z) } : null;
    }, [kind, id]);
    if (!p) break;
    out.n++;
    if (p.h < 0) { out.wet++; if (process.env.DBG) console.log('wet', t, JSON.stringify(p)); }
    if (p.h < -1) out.deep++;
    out.end = p;
  }
  return out;
}
const newest = (kind) => page.evaluate(async (kind) => { const l = kind === 'unit' ? __exo.sim.cur.units : (await __exo.sim.save()).hostiles; return l[l.length - 1]?.id; }, kind);
const near = (p, q, d) => p && Math.hypot(p.x - q[0], p.z - q[1]) < d;

// ground: a Rover across the bay goes round it
await cmd({ type: 'debug', units: { unit: 'rover', x: route.from[0], z: route.from[1], n: 1 } });
await page.waitForTimeout(400);
const rover = await newest('unit');
await cmd({ type: 'order', ids: [rover], x: route.to[0], z: route.to[1] });
const rv = await follow('unit', rover, 40);
check(rv.deep === 0 && rv.wet <= 2, `a Rover ordered across the bay stays out of the water (${rv.wet} of ${rv.n} samples wet, ${rv.deep} deep)`);
check(near(rv.end, route.to, 6), `…and gets round to the far shore (ends ${rv.end && Math.hypot(rv.end.x - route.to[0], rv.end.z - route.to[1]).toFixed(1)} u away)`);

// hover: a Skiff goes straight across, riding on the water
await cmd({ type: 'debug', units: { unit: 'skiff', x: route.from[0], z: route.from[1], n: 1 } });
await page.waitForTimeout(400);
const skiff = await newest('unit');
await cmd({ type: 'order', ids: [skiff], x: route.to[0], z: route.to[1] });
const half = route.from.map((v, i) => (v + route.to[i]) / 2);
let rode = null;
for (let t = 0; t < 40 && !rode; t++) {
  await page.waitForTimeout(150);
  rode = await page.evaluate(([hx, hz]) => {
    const u = __exo.sim.cur.units.at(-1);
    if (!u || Math.hypot(u.x - hx, u.z - hz) > 4 || __exo.heightRaw(u.x, u.z) > 0) return null;
    const s = __exo.unitScreen(u.id);
    return { x: u.x, z: u.z, h: __exo.heightRaw(u.x, u.z), screen: !!s };
  }, half);
}
check(!!rode, `a Hover Skiff crosses over the water (mid-bay at ${rode ? `${rode.x.toFixed(0)}, ${rode.z.toFixed(0)}, ground ${rode.h.toFixed(1)} u` : 'never'})`);
if (shots && rode) {
  await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 40; __exo.cam.targetPitch = 0.6; }, [rode.x, rode.z]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/skiff-on-water.png` });
}
const sk = await follow('unit', skiff, 12);
check(near(sk.end, route.to, 6), 'the Skiff reaches the far shore');

// fauna: a Swarmer on the far shore walks round the water to the base; a Strider wades straight in
await page.evaluate(() => { for (const u of __exo.sim.cur.units) __exo.sim.command({ type: 'order', ids: [u.id], x: 0, z: 0 }); });
// (out of the way first, or they'd shoot the predators before they get going)
await page.waitForFunction(([x, z]) => __exo.sim.cur.units.every((u) => Math.hypot(u.x - x, u.z - z) > 45), route.to, { timeout: 60000, polling: 250 }).catch(() => {});
await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: route.to[0], z: route.to[1], n: 1 } });
await page.waitForTimeout(400);
const sw = await newest('hostile');
const swf = await follow('hostile', sw, 30);
check(swf.deep === 0 && swf.wet <= 2, `a Swarmer heading for the base keeps out of the water (${swf.wet} of ${swf.n} samples wet)`);
check(!!swf.end && Math.hypot(swf.end.x, swf.end.z) < Math.hypot(...route.to) - 15, `…and gets on toward the base (${swf.end ? Math.hypot(swf.end.x, swf.end.z).toFixed(0) : '?'} u from the Core, started ${Math.hypot(...route.to).toFixed(0)})`);
await cmd({ type: 'debug', spawn: { unit: 'strider', x: route.to[0], z: route.to[1], n: 1 } });
await page.waitForTimeout(400);
const st = await newest('hostile');
const stf = await follow('hostile', st, 8);
check(stf.wet > 0, `a Strider wades through the water (${stf.wet} of ${stf.n} samples wet)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall hover checks passed');
process.exit(failed ? 1 : 0);
