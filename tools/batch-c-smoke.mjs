/**
 * Roster batch C (v0.37), on Touchdown with the packs held off:
 *  - shields: a Shield Projector's dome soaks hits from predators outside it (the building under it is
 *    untouched), not from one inside it; drained, it collapses and the next hits go through; an Aegis
 *    Crawler's bubble covers a Rover next to it from a Spitter;
 *  - planet health: mining scars the land and lowers it; a Seed Bank heals the scar (spending biomass)
 *    and rewilds once there's nothing to heal; a Biosphere Report goes out as the sol ends;
 *  - the Medevac: people thrown out of a fallen building lie injured; a Medevac picks them up and brings
 *    them in to a home; with nobody to fetch them they die when their time runs out.
 *   node tools/batch-c-smoke.mjs [--url http://localhost:5176/] [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { answerBriefing, launch } from './lib/harness.mjs';

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
const events = [];
await page.exposeFunction('__note', (t) => events.push(t));

await answerBriefing(page);

await page.goto(`${url}?intro=0&new=1&fog=0&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });
await page.evaluate(() => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__note(n.textContent ?? ''); }).observe(document.getElementById('log'), { childList: true }));
await cmd({ type: 'debug', alloys: 20000, setup: { peaceful: true } });
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
/** Change the save and load it back: `fn` runs in the page on the state (s) with `a`. */
const edit = (fn, a) => page.evaluate(async ([src, a]) => {
  const s = await __exo.sim.save();
  const out = new Function('s', 'a', src)(s, a);
  __exo.sim.load(s);
  return out;
}, [`return (${fn})(s, a)`, a]);
/** Drop finished buildings in; `clear` also removes every hostile. Returns their ids. */
const add = (list, clear = false) => edit((s, [list, clear]) => {
  const ids = list.map(([kind, p, extra]) => {
    const id = s.nextId++;
    s.buildings.push({ id, kind, x: p.x, z: p.z, yaw: 0, progress: 1, hp: 2000, on: true, powered: true, ...(extra ?? {}) });
    return id;
  });
  if (clear) s.hostiles = [];
  return ids;
}, [list, clear]);
const bld = (id) => page.evaluate((id) => __exo.sim.cur.buildings.find((b) => b.id === id), id);
const hostiles = () => page.evaluate(async () => (await __exo.sim.save()).hostiles);

// power for everything below: geothermal taps make steady power (the sim only checks the vent at placement)
const geo = [];
for (let i = 0; i < 4; i++) geo.push(await spot('solar', geo.map((p) => ({ ...p, r: 10 })), 10, 40));
await add(geo.map((p) => ['geothermal', p]));

// ---------- shields ----------
const P = await spot('shield', geo.map((p) => ({ ...p, r: 10 })), 30, 80);
const inside = await spot('turret', [{ ...P, r: 7 }], 9, 16, P);
const [projId, tgtId] = await add([['shield', P, { sh: 1200, shDown: false }], ['solar', inside, { hp: 150 }]], true);
await wait(600);
const p0 = await bld(projId);
check(p0 && p0.powered && !p0.shDown && p0.sh > 1100, `a powered Shield Projector holds its dome (charge ${p0?.sh?.toFixed(0)}, powered ${p0?.powered})`);
// spitters well outside the dome (22 u), within spitting range (30 u) of the Solar Array under it
const ang = Math.atan2(inside.x - P.x, inside.z - P.z);
const out = { x: inside.x + Math.sin(ang) * 26, z: inside.z + Math.cos(ang) * 26 };
await edit((s, [o, t]) => { s.hostiles.push(...[0, 1, 2].map((i) => ({ id: s.nextId++, unit: 'spitter', slot: 300 + i, x: o.x + i, z: o.z, heading: 0, hp: 1e6, target: t, cd: 0, pack: -1, chew: true }))); }, [out, tgtId]);
await wait(5000);
const t1 = await bld(tgtId), p1 = await bld(projId);
check(t1?.hp === 150 && p1.sh < 1200, `the dome soaks spit from outside it (Solar Array hp ${t1?.hp?.toFixed(0)} of 150, dome ${p1.sh.toFixed(0)} of 1200)`);
if (shots) {
  await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 70; __exo.cam.targetPitch = 0.55; }, [P.x, P.z]);
  await wait(2500);
  await page.screenshot({ path: `${shots}/shield-dome.png` });
}
// a predator inside the dome bites straight through
await edit((s, [t]) => { s.hostiles = []; const b = s.buildings.find((x) => x.id === t); s.hostiles.push({ id: s.nextId++, unit: 'swarmer', slot: 310, x: b.x + 3.5, z: b.z, heading: 0, hp: 40, target: t, cd: 0, pack: -1 }); }, [tgtId]);
const sh2 = (await bld(projId)).sh;
await wait(2500);
const t2 = await bld(tgtId), p2 = await bld(projId);
check(t2 && t2.hp < 150 && Math.abs(p2.sh - sh2) < 50, `a Swarmer inside the dome bites through it (Solar Array hp ${t2?.hp?.toFixed(0)}, dome ${sh2.toFixed(0)} → ${p2.sh.toFixed(0)})`);
// drained, it collapses; the next spit goes through
await edit((s, [id, t, o]) => {
  s.hostiles = [];
  const b = s.buildings.find((x) => x.id === id); b.sh = 20;
  const v = s.buildings.find((x) => x.id === t); v.hp = 150;
  s.hostiles.push(...[0, 1, 2].map((i) => ({ id: s.nextId++, unit: 'spitter', slot: 300 + i, x: o.x + i, z: o.z, heading: 0, hp: 1e6, target: t, cd: 0, pack: -1, chew: true })));
}, [projId, tgtId, out]);
await wait(5000);
const t3 = await bld(tgtId), p3 = await bld(projId);
check(p3.shDown && t3 && t3.hp < 150, `a drained dome collapses and the spit gets through (down ${p3.shDown}, Solar Array hp ${t3?.hp?.toFixed(0)})`);
check(events.some((e) => /shield down/.test(e)), 'the collapse is announced');
await edit((s) => { s.hostiles = []; });

// Aegis Crawler: its bubble covers a Rover next to it
const F = await spot('solar', [{ ...P, r: 30 }], 30, 70);
await cmd({ type: 'debug', units: { unit: 'aegis', x: F.x, z: F.z, n: 1 } });
await cmd({ type: 'debug', units: { unit: 'rover', x: F.x + 3, z: F.z, n: 1 } });
await wait(400);
const [ag, rv] = await page.evaluate(() => ['aegis', 'rover'].map((k) => __exo.sim.cur.units.filter((u) => u.unit === k).at(-1)));
check(ag?.shUp && ag.shR === 9, `an Aegis Crawler comes out with its bubble up (${ag?.sh}, radius ${ag?.shR})`);
await edit((s, [rid, x, z]) => {
  const r = s.units.find((u) => u.id === rid); r.unit = 'medevac'; r.hp = 220; // unarmed: it won't shoot the spitter dead
  // four of them: the bubble recharges faster than one spitter can hurt it
  s.hostiles.push(...[0, 1, 2, 3].map((i) => ({ id: s.nextId++, unit: 'spitter', slot: 320 + i, x: x + 22, z: z + i * 1.5, heading: 0, hp: 1e6, target: rid, cd: 0, pack: -1, chew: true })));
}, [rv.id, F.x, F.z]);
await wait(5000);
const [ag2, rv2] = await page.evaluate(([a, r]) => [a, r].map((id) => __exo.sim.cur.units.find((u) => u.id === id)), [ag.id, rv.id]);
check(rv2 && rv2.hp === 1 && ag2.sh < 1, `the bubble soaks the spit aimed at the unit under it (unit hp ${(rv2?.hp * 100).toFixed(0)}%, bubble ${(ag2?.sh * 100).toFixed(0)}%)`);
await edit((s) => { s.hostiles = []; s.units = []; });

// ---------- planet health ----------
const start = await page.evaluate(() => __exo.sim.cur.planet);
check(start && Math.round(start.health) === 70 && start.scars.length === 0, `planet health starts at 70 with no scars (${start?.health})`);
// a depot on the nearest deposit strips it (mining sped up for the test)
const dep = await page.evaluate(() => __exo.sim.cur.deposits.map((d, i) => ({ ...d, i })).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]);
const dAt = await spot('depot', [], 0, 20, dep);
const [depId] = await add([['depot', dAt]]);
await edit((s, id) => { s.buildings.find((b) => b.id === id).mining = -1; }, depId);
await wait(6000);
const pl1 = await page.evaluate(() => __exo.sim.cur.planet);
check(pl1.health < 70 && pl1.scars.length === 1, `mining scars the land and lowers planet health (${pl1.health.toFixed(2)}, ${pl1.scars.length} scar)`);
// a deeper scar to heal, and a Seed Bank next to it with biomass to spend
await edit((s, [id]) => { s.buildings = s.buildings.filter((b) => b.id !== id); s.planet.scars[0].a = 2; }, [depId]);
await cmd({ type: 'debug', people: { biomass: 300 } });
const sbAt = await spot('seedbank', [], 6, 30, dep);
const [sbId] = await add([['seedbank', sbAt]]);
const h0 = await page.evaluate(() => __exo.sim.cur.planet.health);
await wait(6000);
const pl2 = await page.evaluate(() => __exo.sim.cur.planet), sb = await bld(sbId);
check(sb.engaged && pl2.health > h0 && (pl2.scars[0]?.a ?? 0) < 2 && pl2.use > 0, `a Seed Bank heals the scar, spending biomass (health ${h0.toFixed(2)} → ${pl2.health.toFixed(2)}, scar ${pl2.scars[0]?.a.toFixed(2) ?? 'gone'}, ${pl2.use.toFixed(3)} biomass/s)`);
// healed over: it rewilds
await edit((s) => { s.planet.scars = []; });
await wait(4000);
const pl3 = await page.evaluate(() => __exo.sim.cur.planet);
check(pl3.restored > 0 && pl3.health > 70 && (await bld(sbId)).engaged, `with nothing to heal it rewilds (restored ${pl3.restored.toFixed(3)}, health ${pl3.health.toFixed(2)})`);
// the sol ends: the Biosphere Report goes out
await cmd({ type: 'inspect', skip: 400 });
await wait(1500);
const pl4 = await page.evaluate(() => __exo.sim.cur.planet), flags = await page.evaluate(() => __exo.sim.cur.story.flags);
check(pl4.reports.length === 1 && flags.includes('biosphere-report') && events.some((e) => /Biosphere Report sent/.test(e)), `a Biosphere Report goes out as the sol ends (${pl4.reports.join(', ')})`);
check(await page.evaluate(() => /🌍/.test(document.getElementById('r-planet').textContent)), 'the top bar shows planet health');

// ---------- the Medevac ----------
const hAt = await spot('civic', [{ ...P, r: 30 }], 20, 60);
const homeAt = await spot('habitat', [{ ...P, r: 30 }, { ...hAt, r: 14 }], 20, 60);
const [civId, habId] = await add([['civic', hAt], ['habitat', homeAt]]);
await cmd({ type: 'debug', people: { colonists: 3, biomass: 200 } });
await wait(1500);
// everyone indoors at the Civilian Center, then it falls
await edit((s, id) => { for (const c of s.people.colonists) { c.at = id; c.x = s.buildings.find((b) => b.id === id).x; c.z = s.buildings.find((b) => b.id === id).z; c.hp = 40; } }, civId);
await cmd({ type: 'debug', hurt: { id: civId, hp: 99999 } });
await wait(600);
const downs = await page.evaluate(() => __exo.sim.cur.people.roster.filter((c) => /Injured/.test(c.doing)).length);
const walkers = await page.evaluate(() => { const w = __exo.sim.cur.people.walkers; let n = 0; for (let i = 0; i < w.length; i += 6) if (w[i + 5] & 2) n++; return n; });
check(downs === 3 && walkers === 3, `the people inside a fallen building lie injured by the ruins (${downs} injured, ${walkers} drawn lying down)`);
check(events.some((e) => /lying injured/.test(e)), 'the alarm says a Medevac can bring them in');
if (shots) {
  await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 30; __exo.cam.targetPitch = 0.6; }, [hAt.x, hAt.z]);
  await wait(2000);
  await page.screenshot({ path: `${shots}/injured.png` });
}
await cmd({ type: 'debug', units: { unit: 'medevac', x: homeAt.x + 8, z: homeAt.z + 8, n: 1 } });
let brought = 0;
for (let t = 0; t < 60 && brought < 3; t++) {
  await wait(500);
  brought = await page.evaluate((id) => __exo.sim.cur.people.roster.filter((c) => c.atId === id).length, habId);
}
const r2 = await page.evaluate(() => __exo.sim.cur.people.roster.map((c) => c.doing));
if (brought < 3) console.log(JSON.stringify(await page.evaluate(async () => { const s = await __exo.sim.save(); const u = s.units.find((x) => x.unit === 'medevac'); return { u: u && { x: u.x, z: u.z, pax: u.pax, order: u.order, path: u.path, stall: u.stall }, homes: s.buildings.filter((b) => ['core', 'habitat', 'civic'].includes(b.kind)).map((b) => [b.kind, b.x, b.z, b.progress]) }; })));
check(brought === 3, `the Medevac brings all three in to the Habitat Block (${brought}; ${r2.join(' / ')})`);
check(events.some((e) => /brought in/.test(e)), 'it says so');
// nobody comes: they die when their time runs out
await edit((s) => { s.units = []; for (const c of s.people.colonists) { c.at = -1; c.down = 1.5; c.x += 30; } });
await wait(2500);
const left = await page.evaluate(() => __exo.sim.cur.people.roster.length);
check(left === 0, `with no Medevac the injured die when their time runs out (${left} left)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall batch C checks passed');
process.exit(failed ? 1 : 0);
