/**
 * Water units and water buildings (v0.35), on a coastal region that keeps its sea:
 *  - placement: a Shipyard and a Pier only on the waterline, a Tidal Generator and a Sea Turret
 *    only out on the water, a Vehicle Bay not in the water;
 *  - a Tidal Generator makes power; a Shipyard builds Gunboats (a Vehicle Bay can't), which
 *    launch on the water and stay on it;
 *  - a Lurker stays in the sea; a Swarmer doesn't pick a Sea Turret it can't reach.
 *   node tools/sea-smoke.mjs [--url http://localhost:5176/] [--shots dir]
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
const wait = (ms) => page.waitForTimeout(ms);

const td = JSON.parse(readFileSync('content/regions/touchdown.json', 'utf8'));
const coast = { ...td, name: 'Sea Test', height: undefined, flora: undefined, ground: undefined, siteLat: -16, siteLon: -12, keepSea: true, herds: [], graceSeconds: 3000 };
await page.goto(`${url}?sw=0&title=0`);
await page.evaluate((def) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'seatest', def })), coast);
await page.goto(`${url}?preview=1&intro=0&new=1&fog=0&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });
await cmd({ type: 'debug', alloys: 20000 });
await wait(300);

/** First spot (spiral out from the Core) where `kind` may go, with the reason elsewhere tallied. */
const spot = (kind, avoid = [], offshore = 0) => page.evaluate(([kind, avoid, offshore]) => {
  const why = {};
  for (let r = 6; r < 60; r += 2) for (let a = 0; a < 6.28; a += 0.12) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
    // `offshore`: no dry ground within this many units
    if (offshore && [...Array(24).keys()].some((k) => __exo.heightRaw(x + Math.cos(k / 3.82) * offshore, z + Math.sin(k / 3.82) * offshore) >= 0.3)) continue;
    const p = __exo.canPlace(kind, x, z);
    if (!p) return { x, z, h: __exo.heightRaw(x, z) };
    why[p] = (why[p] ?? 0) + 1;
  }
  return { why };
}, [kind, avoid, offshore]);
/** Drop a finished building in (as a save would hold it). */
const add = (kind, p) => page.evaluate(async ([kind, p]) => {
  const s = await __exo.sim.save();
  const id = s.nextId++;
  s.buildings.push({ id, kind, x: p.x, z: p.z, yaw: 0, progress: 1, hp: 2000, on: true, powered: true });
  __exo.sim.load(s);
  return id;
}, [kind, p]);

// placement
const yard = await spot('shipyard');
check(yard.x !== undefined, `a Shipyard fits on the waterline (${yard.x !== undefined ? `${yard.x.toFixed(0)}, ${yard.z.toFixed(0)}` : JSON.stringify(yard.why)})`);
const offshoreWhy = await page.evaluate(() => __exo.canPlace('shipyard', 0, 0));
check(/shore|water/.test(offshoreWhy ?? ''), `…but not inland (${offshoreWhy})`);
const tidal = await spot('tidal', [{ ...yard, r: 14 }]);
check(tidal.x !== undefined && tidal.h < -1, `a Tidal Generator goes out on the water (${tidal.x !== undefined ? `ground ${tidal.h.toFixed(1)} u` : JSON.stringify(tidal.why)})`);
const seaT = await spot('seaturret', [{ ...yard, r: 14 }, { ...tidal, r: 10 }], 11); // out of a bite's reach from the shore
check(seaT.x !== undefined && seaT.h < -1, 'a Sea Turret goes out on the water');
const pier = await spot('pier', [{ ...yard, r: 14 }]);
check(pier.x !== undefined, 'a Pier fits on the waterline');
check(/water/.test(await page.evaluate(([x, z]) => __exo.canPlace('bay', x, z), [tidal.x, tidal.z]) ?? ''), 'a Vehicle Bay can\'t go in the water');
check(/water/.test(await page.evaluate(() => __exo.canPlace('tidal', 0, 0)) ?? ''), 'a Tidal Generator can\'t go on land');
if (yard.x === undefined || tidal.x === undefined || seaT.x === undefined) { await browser.close(); process.exit(1); }

const yardId = await add('shipyard', yard);
const tidalId = await add('tidal', tidal);
const turretId = await add('seaturret', seaT);
const bay = await spot('bay', [{ ...yard, r: 16 }]);
const bayId = await add('bay', bay);
await wait(1500);
const st = await page.evaluate((id) => __exo.sim.cur.buildings.find((b) => b.id === id), tidalId);
check(st?.powered === true, 'the Tidal Generator is online');
const genNight = await page.evaluate(async (id) => { const s = await __exo.sim.save(); return s.buildings.some((b) => b.id === id); }, tidalId);
check(genNight, 'it stays in the save');

// production
const q = async (id) => page.evaluate((id) => __exo.sim.cur.buildings.find((b) => b.id === id)?.queue?.length ?? 0, id);
await cmd({ type: 'produce', id: bayId, unit: 'gunboat' });
await wait(400);
check((await q(bayId)) === 0, 'a Vehicle Bay refuses to build a Gunboat');
await cmd({ type: 'produce', id: yardId, unit: 'rover' });
await wait(400);
check((await q(yardId)) === 0, 'a Shipyard refuses to build a Rover');
// (the Bay and the Sea Turret off, so the Shipyard has the power, and the turret doesn't shoot the predators below)
await cmd({ type: 'power', id: bayId, on: false });
await cmd({ type: 'power', id: turretId, on: false });
await cmd({ type: 'produce', id: yardId, unit: 'gunboat' });
await wait(400);
check((await q(yardId)) === 1, 'a Shipyard queues a Gunboat');
await page.waitForFunction(() => __exo.sim.cur.units.some((u) => u.unit === 'gunboat'), null, { timeout: 90000, polling: 500 }).catch(() => {});
const boat = await page.evaluate(() => __exo.sim.cur.units.find((u) => u.unit === 'gunboat'));
if (!boat) console.log('yard:', JSON.stringify(await page.evaluate((id) => { const c = __exo.sim.cur; const b = c.buildings.find((x) => x.id === id); return { b, gen: c.gen, draw: c.draw, units: c.units.length }; }, yardId)));
check(!!boat, 'the Gunboat is launched');
if (boat) {
  let dry = 0, n = 0;
  for (let t = 0; t < 24; t++) {
    await wait(250);
    const h = await page.evaluate((id) => { const u = __exo.sim.cur.units.find((v) => v.id === id); return u ? __exo.heightRaw(u.x, u.z) : null; }, boat.id);
    if (h === null) break;
    n++; if (h > 0) dry++;
  }
  check(n > 10 && dry === 0, `…on the water, and it stays there (${dry} of ${n} samples over dry ground)`);
  // ordered inland, it goes only as far as the water lets it
  await cmd({ type: 'order', ids: [boat.id], x: 0, z: 0 });
  await wait(9000);
  const end = await page.evaluate((id) => { const u = __exo.sim.cur.units.find((v) => v.id === id); return u ? { x: u.x, z: u.z, h: __exo.heightRaw(u.x, u.z) } : null; }, boat.id);
  check(end && end.h < 0, `ordered inland it stops at the water's edge (ground ${end?.h.toFixed(1)} u)`);
  if (shots && end) {
    await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 55; __exo.cam.targetPitch = 0.7; }, [(yard.x + end.x) / 2, (yard.z + end.z) / 2]);
    await wait(3000);
    await page.screenshot({ path: `${shots}/sea-base.png` });
  }
}

// transport: a Barge loads three Rovers on the near shore, carries them across the water and lands them on the far side
await cmd({ type: 'produce', id: yardId, unit: 'barge' });
await page.waitForFunction(() => __exo.sim.cur.units.some((u) => u.unit === 'barge'), null, { timeout: 90000, polling: 500 }).catch(() => {});
const barge = await page.evaluate(() => __exo.sim.cur.units.find((u) => u.unit === 'barge'));
check(!!barge, 'a Shipyard builds a Transport Barge');
if (barge) {
  const shore = await page.evaluate(([x, z]) => {
    for (let r = 4; r < 40; r += 1) for (let a = 0; a < 6.28; a += 0.2) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (__exo.heightRaw(px, pz) > 1 && !__exo.canPlace('solar', px, pz)?.includes('water')) return { x: px, z: pz };
    }
    return null;
  }, [barge.x, barge.z]);
  await cmd({ type: 'debug', units: { unit: 'rover', x: shore.x, z: shore.z, n: 3 } });
  await wait(400);
  const rovers = await page.evaluate(() => __exo.sim.cur.units.filter((u) => u.unit === 'rover').map((u) => u.id));
  await cmd({ type: 'board', ids: rovers, transport: barge.id });
  await page.waitForFunction((id) => __exo.sim.cur.units.find((u) => u.id === id)?.cargo === 3, barge.id, { timeout: 60000, polling: 250 }).catch(() => {});
  const loaded = await page.evaluate((id) => ({ cargo: __exo.sim.cur.units.find((u) => u.id === id)?.cargo, rovers: __exo.sim.cur.units.filter((u) => u.unit === 'rover').length }), barge.id);
  check(loaded.cargo === 3 && loaded.rovers === 0, `three Rovers go aboard (${loaded.cargo} aboard, ${loaded.rovers} still ashore)`);
  // somewhere dry across the water: from where the barge is now, the far end of the longest run of water in some direction
  const at = await page.evaluate((id) => __exo.sim.cur.units.find((u) => u.id === id), barge.id);
  const far = await page.evaluate(([x, z]) => {
    const raw = __exo.heightRaw;
    let best = null;
    for (let a = 0; a < 6.28; a += 0.1) {
      const dx = Math.sin(a), dz = Math.cos(a);
      // one unbroken stretch of water deep enough to sail (not shallows, a sandbar and a lagoon), then dry land
      let wet = 0;
      for (let r = 2; r < 90; r++) {
        const h = raw(x + dx * r, z + dz * r);
        if (h < -0.6) { wet++; continue; }
        if (wet < r - 2 - 20) break;
        if (h < 0.3) continue; // the beach
        if (wet > 15 && h > 0.6 && [3, 6].every((k) => raw(x + dx * (r + k), z + dz * (r + k)) > 0.6)) {
          if (!best || wet > best.wet) best = { x: x + dx * (r + 4), z: z + dz * (r + 4), wet };
          break;
        }
      }
    }
    return best;
  }, [at.x, at.z]);
  if (!far && process.env.DBG) console.log(await page.evaluate(([x, z]) => {
    const out = [];
    for (let a = 0; a < 6.28; a += 0.5) out.push(a.toFixed(1) + ':' + [...Array(30).keys()].map((k) => { const h = __exo.heightRaw(x + Math.sin(a) * (2 + k * 3), z + Math.cos(a) * (2 + k * 3)); return h < -0.6 ? '~' : h < 0.3 ? '.' : '#'; }).join(''));
    return `barge ${x.toFixed(0)},${z.toFixed(0)}\n` + out.join('\n');
  }, [at.x, at.z]));
  check(!!far, `found a far shore (${far ? `${far.wet} u of water away` : 'none'})`);
  if (far) {
    await cmd({ type: 'order', ids: [barge.id], x: far.x, z: far.z });
    await page.waitForFunction(() => __exo.sim.cur.units.filter((u) => u.unit === 'rover').length === 3, null, { timeout: 90000, polling: 500 }).catch(() => {});
    // ashore, they drive on to the drop point
    await page.waitForFunction(() => __exo.sim.cur.units.filter((u) => u.unit === 'rover').every((u) => u.order === 'idle'), null, { timeout: 30000, polling: 500 }).catch(() => {});
    const start = await page.evaluate((id) => __exo.sim.cur.units.find((u) => u.id === id), barge.id);
    const landed = await page.evaluate(([x, z]) => __exo.sim.cur.units.filter((u) => u.unit === 'rover').map((u) => ({ d: Math.hypot(u.x - x, u.z - z), h: __exo.heightRaw(u.x, u.z) })), [far.x, far.z]);
    const sailed = Math.hypot(start.x - at.x, start.z - at.z);
    // (the drop point can be past shallows the barge can't cross: then they land on the nearest beach it reaches)
    check(sailed > 15 && landed.length === 3 && landed.every((r) => r.h > 0 && r.d < 20), `…carries them across the water and lands them on dry ground near the drop point (${JSON.stringify(landed.map((r) => `${r.d.toFixed(0)} u, ground ${r.h.toFixed(1)}`))} u from it; barge sailed ${sailed.toFixed(0)} u)`);
    if (shots) {
      await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 40; __exo.cam.targetPitch = 0.65; }, [far.x, far.z]);
      await wait(2500);
      await page.screenshot({ path: `${shots}/barge-landed.png` });
    }
  }
}

// fauna: a Lurker stays in the sea; a Swarmer won't go for the unreachable Sea Turret
await cmd({ type: 'debug', spawn: { unit: 'lurker', x: seaT.x, z: seaT.z, n: 1 } });
await wait(400);
const lurker = await page.evaluate(async () => (await __exo.sim.save()).hostiles.at(-1)?.id);
let ldry = 0, ln = 0;
for (let t = 0; t < 20; t++) {
  await wait(250);
  const h = await page.evaluate(async (id) => { const u = (await __exo.sim.save()).hostiles.find((v) => v.id === id); return u ? __exo.heightRaw(u.x, u.z) : null; }, lurker);
  if (h === null) break;
  ln++; if (h > 0) ldry++;
}
check(ln > 5 && ldry === 0, `a Lurker stays in the sea (${ldry} of ${ln} samples over dry ground)`);
const land = await page.evaluate(([x, z]) => {
  // dry ground nearer the Sea Turret than anything else of ours
  for (let r = 10; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (__exo.heightRaw(px, pz) > 1.5) return { x: px, z: pz };
  }
  return null;
}, [seaT.x, seaT.z]);
if (land) {
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: land.x, z: land.z, n: 1 } });
  await wait(2500);
  const tg = await page.evaluate(async () => (await __exo.sim.save()).hostiles.filter((h) => h.unit === 'swarmer').at(-1)?.target);
  check(tg !== undefined && tg !== turretId, `a Swarmer by the shore doesn't go for the Sea Turret it can't reach (target ${tg}, turret ${turretId})`);
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall sea checks passed');
process.exit(failed ? 1 : 0);
