/**
 * The air layer (v0.36), on a coastal region that keeps its sea:
 *  - an Airpad builds Gunships and nothing else; a Vehicle Bay can't build one;
 *  - a Gunship flies straight across the water, and straight over a wall;
 *  - a Skimmerwing pack flies over a wall (without chewing it) to the building behind it;
 *  - a Defense Turret ignores a flyer, a Flak Tower shoots it down (and ignores a Swarmer);
 *  - a Swarmer can't go for a Gunship, a Spitter can.
 *   node tools/air-smoke.mjs [--url http://localhost:5176/] [--shots dir]
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const url = arg('--url') ?? 'http://localhost:5176/';
const shots = arg('--shots');
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const wait = (ms) => page.waitForTimeout(ms);

const td = JSON.parse(readFileSync('content/regions/touchdown.json', 'utf8'));
const coast = { ...td, name: 'Air Test', height: undefined, flora: undefined, ground: undefined, siteLat: -16, siteLon: -12, keepSea: true, herds: [], packs: undefined, graceSeconds: 3000 };
await page.goto(`${url}?sw=0&title=0`);
await page.evaluate((def) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'airtest', def })), coast);
await page.goto(`${url}?preview=1&intro=0&new=1&fog=0&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });
await cmd({ type: 'debug', alloys: 20000 });
await wait(300);

/** First spot (spiral out from `from`, `r0` to `r1` u) where `kind` may go. */
const spot = (kind, avoid = [], r0 = 6, r1 = 60, from = { x: 0, z: 0 }) => page.evaluate(([kind, avoid, r0, r1, from]) => {
  for (let r = r0; r < r1; r += 2) for (let a = 0; a < 6.28; a += 0.12) {
    const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
    if (!__exo.canPlace(kind, x, z)) return { x, z };
  }
  return null;
}, [kind, avoid, r0, r1, from]);
/** Drop finished buildings in (as a save would hold them); `clear` also removes every hostile. */
const add = (list, clear = false) => page.evaluate(async ([list, clear]) => {
  const s = await __exo.sim.save();
  const ids = list.map(([kind, p, yaw]) => {
    const id = s.nextId++;
    s.buildings.push({ id, kind, x: p.x, z: p.z, yaw: yaw ?? 0, progress: 1, hp: 2000, on: true, powered: true });
    return id;
  });
  if (clear) s.hostiles = [];
  __exo.sim.load(s);
  return ids;
}, [list, clear]);
const hostiles = () => page.evaluate(async () => (await __exo.sim.save()).hostiles);
const unit = (id) => page.evaluate((id) => __exo.sim.cur.units.find((u) => u.id === id), id);

// production
const padAt = await spot('airpad');
const bayAt = await spot('bay', [{ ...padAt, r: 16 }]);
// power: two Tidal Generators out on the water (the Core alone can't run a factory)
const tide1 = await spot('tidal', [], 6, 90);
const tide2 = await spot('tidal', [{ ...tide1, r: 10 }], 6, 90);
const [padId, bayId] = await add([['airpad', padAt], ['bay', bayAt], ['tidal', tide1], ['tidal', tide2]]);
const q = (id) => page.evaluate((id) => __exo.sim.cur.buildings.find((b) => b.id === id)?.queue?.length ?? 0, id);
await cmd({ type: 'produce', id: bayId, unit: 'gunship' });
await wait(400);
check((await q(bayId)) === 0, 'a Vehicle Bay refuses to build a Gunship');
await cmd({ type: 'produce', id: padId, unit: 'rover' });
await wait(400);
check((await q(padId)) === 0, 'an Airpad refuses to build a Rover');
await cmd({ type: 'power', id: bayId, on: false });
await cmd({ type: 'produce', id: padId, unit: 'gunship' });
await wait(400);
check((await q(padId)) === 1, 'an Airpad queues a Gunship');
await page.waitForFunction(() => __exo.sim.cur.units.some((u) => u.unit === 'gunship'), null, { timeout: 90000, polling: 500 }).catch(() => {});
const ship = await page.evaluate(() => __exo.sim.cur.units.find((u) => u.unit === 'gunship'));
if (!ship) console.log('pad:', JSON.stringify(await page.evaluate((id) => { const c = __exo.sim.cur; return { b: c.buildings.find((x) => x.id === id), gen: c.gen, draw: c.draw }; }, padId)));
check(!!ship, 'the Gunship takes off');
if (!ship) { await browser.close(); process.exit(1); }

/** Fly a unit from where it is to (x, z): the farthest it strays from the straight line, and the samples over water. */
async function fly(id, x, z, secs) {
  const a = await unit(id);
  await cmd({ type: 'order', ids: [id], x, z });
  let off = 0, wet = 0, end = a;
  for (let t = 0; t < secs * 4; t++) {
    await wait(250);
    const u = await unit(id);
    if (!u) break;
    end = u;
    const lx = x - a.x, lz = z - a.z, L = Math.hypot(lx, lz);
    off = Math.max(off, Math.abs(((u.x - a.x) * lz - (u.z - a.z) * lx) / L));
    if (await page.evaluate(([x, z]) => __exo.heightRaw(x, z) < 0, [u.x, u.z])) wet++;
    if (Math.hypot(u.x - x, u.z - z) < 1.5) break;
  }
  return { off, wet, end, there: Math.hypot(end.x - x, end.z - z) < 2 };
}

// across the water: a line from dry land, over at least 12 u of water, to dry land
const route = await page.evaluate(() => {
  const raw = __exo.heightRaw;
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const dx = Math.sin(a), dz = Math.cos(a);
    let land0 = -1, wetFrom = -1;
    for (let r = 20; r < 105; r++) {
      const wet = raw(dx * r, dz * r) < 0.3;
      if (!wet && wetFrom < 0) land0 = r;
      else if (wet && wetFrom < 0 && land0 > 0) wetFrom = r;
      else if (!wet && wetFrom > 0) { if (r - wetFrom >= 12) return { from: [dx * (wetFrom - 4), dz * (wetFrom - 4)], to: [dx * (r + 4), dz * (r + 4)], wet: r - wetFrom }; break; }
    }
  }
  return null;
});
check(!!route, `found a bay to fly across (${route ? `${route.wet} u of water` : 'none'})`);
if (route) {
  await fly(ship.id, route.from[0], route.from[1], 20);
  const f = await fly(ship.id, route.to[0], route.to[1], 25);
  check(f.there && f.wet > 0 && f.off < 2, `the Gunship flies straight across the water (${f.wet} samples over water, at most ${f.off.toFixed(1)} u off the line, arrived ${f.there})`);
  if (shots) {
    await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 40; __exo.cam.targetPitch = 0.6; }, [f.end.x, f.end.z]);
    await wait(2500);
    await page.screenshot({ path: `${shots}/gunship.png` });
  }
}

// a field away from the Core (out of its gun's reach): a target building, a wall across the way in, flyers beyond it
const T = await spot('solar', [{ ...padAt, r: 22 }, { ...bayAt, r: 22 }], 46, 90);
check(!!T, 'found a field away from the Core');
if (T) {
  const out = Math.atan2(T.x, T.z), ux = Math.sin(out), uz = Math.cos(out); // away from the Core
  const wallC = { x: T.x + ux * 10, z: T.z + uz * 10 };
  const walls = [];
  for (let k = -6; k <= 6; k++) walls.push(['wall', { x: wallC.x + uz * k * 4, z: wallC.z - ux * k * 4 }, out + Math.PI / 2]);
  const [tId, ...wallIds] = await add([['solar', T], ...walls], true);
  const side = (p) => Math.sign((p.x - wallC.x) * ux + (p.z - wallC.z) * uz); // +1 beyond the wall, -1 on the base side
  const far = { x: T.x + ux * 28, z: T.z + uz * 28 };

  // the Gunship flies straight over the wall
  await fly(ship.id, far.x, far.z, 25);
  const over = await fly(ship.id, T.x - ux * 4, T.z - uz * 4, 15);
  check(over.there && over.off < 3, `the Gunship flies straight over the wall (at most ${over.off.toFixed(1)} u off the line)`);

  // a Skimmerwing pack beyond the wall flies over it to the building behind, leaving the wall alone
  await cmd({ type: 'order', ids: [ship.id], x: padAt.x, z: padAt.z });
  await cmd({ type: 'debug', spawn: { unit: 'skimmerwing', x: far.x, z: far.z, n: 4 } });
  await wait(9000);
  const hs = (await hostiles()).filter((h) => h.unit === 'skimmerwing');
  const st = await page.evaluate(([tId, wallIds]) => {
    const bs = __exo.sim.cur.buildings;
    return { t: bs.find((b) => b.id === tId)?.hp, walls: wallIds.map((id) => bs.find((b) => b.id === id)?.hp) };
  }, [tId, wallIds]);
  check(hs.length === 4 && hs.every((h) => side(h) < 0), `a Skimmerwing pack crosses the wall (${hs.filter((h) => side(h) < 0).length} of ${hs.length} on the base side)`);
  check(st.t === undefined || st.t < 150, `…and attacks the building behind it (Solar Array hp ${st.t?.toFixed(0) ?? 'destroyed'} of 150)`);
  check(st.walls.every((hp) => hp === 350), `…without chewing the wall (${st.walls.filter((hp) => hp !== 350).length} segments hurt)`);
  if (shots) {
    await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 38; __exo.cam.targetPitch = 0.55; }, [T.x + ux * 5, T.z + uz * 5]);
    await wait(2000);
    await page.screenshot({ path: `${shots}/skimmerwings.png` });
  }

  // anti-air: a Defense Turret ignores a flyer; a Flak Tower brings it down
  const tur = await spot('turret', [{ ...T, r: 8 }], 6, 30, T);
  const [turId] = await add([['turret', tur]], true);
  const sk = { x: tur.x + 8, z: tur.z + 4 };
  await cmd({ type: 'debug', spawn: { unit: 'skimmerwing', x: sk.x, z: sk.z, n: 1 } });
  let engaged = 0;
  for (let t = 0; t < 12; t++) { await wait(250); if (await page.evaluate((id) => __exo.sim.cur.buildings.find((b) => b.id === id)?.engaged, turId)) engaged++; }
  const sw = (await hostiles()).find((h) => h.unit === 'skimmerwing');
  check(sw && sw.hp === 55 && engaged === 0, `a Defense Turret ignores a Skimmerwing in range (engaged ${engaged} of 12 samples, its hp ${sw?.hp})`);
  const flk = await spot('flak', [{ ...T, r: 8 }, { ...tur, r: 7 }], 6, 30, tur);
  const [flakId] = await add([['flak', flk]]);
  for (let t = 0; t < 30 && (await hostiles()).some((h) => h.unit === 'skimmerwing'); t++) await wait(500);
  check(!(await hostiles()).some((h) => h.unit === 'skimmerwing'), 'a Flak Tower shoots it down');
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: flk.x + 9, z: flk.z, n: 1 } });
  let fe = 0, te = 0;
  for (let t = 0; t < 8; t++) {
    await wait(250);
    const e = await page.evaluate(([a, b]) => { const bs = __exo.sim.cur.buildings; return [bs.find((x) => x.id === a)?.engaged, bs.find((x) => x.id === b)?.engaged]; }, [flakId, turId]);
    if (e[0]) fe++;
    if (e[1]) te++;
  }
  check(fe === 0 && te > 0, `the Flak Tower ignores a Swarmer, the Turret shoots it (flak engaged ${fe}, turret ${te} of 8)`);
}

// a Swarmer can't bite a Gunship, a Spitter can spit at one
// (a fresh Gunship out across the water, away from the base's guns)
if (route) {
  await add([], true);
  await cmd({ type: 'debug', units: { unit: 'gunship', x: route.to[0], z: route.to[1], n: 1 } });
  await wait(400);
  const g = await page.evaluate(() => __exo.sim.cur.units.filter((u) => u.unit === 'gunship').at(-1));
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: g.x + 4, z: g.z, n: 1 } });
  await wait(500);
  const s1 = (await hostiles()).find((h) => h.unit === 'swarmer');
  check(s1 && s1.target !== g.id, `a Swarmer next to a Gunship doesn't go for it (target ${s1?.target}, gunship ${g.id})`);
  await add([], true);
  await cmd({ type: 'debug', spawn: { unit: 'spitter', x: g.x + 12, z: g.z, n: 1 } });
  await wait(500);
  const s2 = (await hostiles()).find((h) => h.unit === 'spitter');
  check(s2 && s2.target === g.id, `a Spitter goes for the Gunship (target ${s2?.target}, gunship ${g.id})`);
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall air checks passed');
process.exit(failed ? 1 : 0);
