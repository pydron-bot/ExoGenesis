/**
 * The frontier (headless, the real sim): outlying holdings come under escalating, telegraphed threats (warning →
 * countdown → attack): fauna migrations, relic surges and inhabitant raids; standing orders (Muster, Fortify,
 * Evacuate) let a holding partly look after itself. Then the building card's standing orders in the browser.
 *   node tools/frontier-smoke.mjs [--headless-only] [--url http://localhost:5176/]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content, T = C.threats;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

/** A colony with an outlying holding to the east (two solar arrays and a turret 80 u out). */
function game(o = {}) {
  const log = [];
  const sim = new M.Sim((t, l, cue, at) => log.push({ t, at }));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.command({ type: 'debug', setup: { alloys: 3000, buildings: ['solar', 'solar', 'solar', 'geothermal', 'civic', 'hydroponics'], ...(o.setup ?? {}) } });
  sim.s.waves.next = 1e12; // the ordinary packs stay away: this is about the frontier
  const add = (kind, x, z) => { const b = { id: sim.s.nextId++, kind, x, z, progress: 1, hp: C.buildings[kind].hp, on: true, powered: true }; sim.s.buildings.push(b); return b; };
  const hold = [add('solar', 80, 4), add('solar', 86, -6), ...(o.turret === false ? [] : [add('turret', 78, -12)])];
  steps(sim, 10);
  return { sim, log, hold, add, has: (re) => log.some((x) => re.test(x.t)) };
}
const until = (sim, fn, secs) => { for (let i = 0; i < secs * 10 && !fn(); i++) sim.step(); return fn(); };

// ---------- holdings ----------
{
  const g = game();
  const hs = g.sim.frontier.holdings();
  const east = hs.find((h) => h.sector === 'east');
  check(east?.ids.length === 3, `buildings ${T.holdFrom} u+ from the Core make a holding (${hs.map((h) => `${h.name}: ${h.ids.length}`)})`);
  check(g.sim.frontier.sectorOf(g.sim.s.buildings.find((b) => b.kind === 'civic')) === null, 'buildings near the Core are not a holding');
}

// ---------- a migration: warning → countdown → attack → held ----------
{
  const g = game();
  check(g.sim.s.frontier.next === T.frontierFrom * 10, `nothing until ${T.frontierFrom} s after landing`);
  g.sim.s.frontier.next = g.sim.s.tick + 10;
  for (let i = 0; i < 5 && !g.sim.frontier.s.threat; i++) { g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10); if (g.sim.frontier.s.threat && g.sim.frontier.s.threat.kind !== 'migration') { g.sim.frontier.s.threat = null; } }
  const t = g.sim.frontier.s.threat;
  check(!!t && t.kind === 'migration' && t.sector === 'east', `a migration is announced for the east holding (size ${t?.size})`);
  const warn = g.log.find((x) => /Frontier: a fauna migration is coming for the east holding in 90 s/.test(x.t));
  check(!!warn && warn.at && Math.abs(warn.at.x - 82) < 10, 'warned in the log, with where (the log line jumps the camera)');
  const snap = g.sim.snapshot();
  check(snap.story.countdowns.some((c) => c.id === 'frontier' && /Migration: east holding/.test(c.text) && c.left > 85), 'a countdown under GOALS');
  check(snap.story.marks.some((m) => m.site === 'frontier'), 'a marker on the holding (ground and minimap)');
  check(snap.frontier.threat?.left > 85, 'the snapshot carries the threat and its time left');
  steps(g.sim, 85 * 10);
  check(!g.sim.s.hostiles.some((h) => h.pack >= 0), 'nothing arrives before the countdown runs out');
  until(g.sim, () => t.live, 12);
  const pack = g.sim.s.hostiles.filter((h) => h.pack === t.pack);
  check(pack.length === t.size && pack.every((h) => h.x > 60), `then ${pack.length} predators come in from the east edge`);
  g.sim.command({ type: 'debug', units: { unit: 'tank', x: 70, z: 0, n: 4 } });
  steps(g.sim, 2);
  g.sim.command({ type: 'order', ids: g.sim.units.map((u) => u.id), x: 104, z: -6 }); // out to the edge, after the spitter
  check(until(g.sim, () => !g.sim.frontier.s.threat, 300), 'they are fought off (the turret, and tanks sent out)');
  check(g.has(/Frontier: the east holding (held|is lost)/), 'and the log says how it went');
  check(g.sim.s.frontier.next > g.sim.s.tick + (T.frontierEvery - T.frontierJitter - 5) * 10, `the next comes ${T.frontierEvery} ± ${T.frontierJitter} s later`);
  g.sim.s.frontier.next = g.sim.s.tick;
  steps(g.sim, 20);
  for (let i = 0; i < 30 && g.sim.frontier.s.threat?.kind !== 'migration'; i++) { g.sim.frontier.s.threat = null; g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10); }
  check((g.sim.frontier.s.threat?.size ?? 0) > t.size, `and each one is bigger: the next migration ${t.size} → ${g.sim.frontier.s.threat?.size}`);
}

// ---------- standing orders ----------
{
  const g = game({ turret: false });
  const before = g.log.length;
  g.sim.command({ type: 'standing', sector: 'east', order: 'fortify' });
  check(g.sim.frontier.order('east') === 'hold' && g.has(/Fortify needs research: Garrison Doctrine/), 'Fortify needs Garrison Doctrine');
  g.sim.command({ type: 'debug', setup: { research: ['garrison-doctrine'] } });
  g.sim.command({ type: 'standing', sector: 'east', order: 'fortify' });
  check(g.sim.frontier.order('east') === 'fortify', 'with it, the east holding is set to Fortify');
  void before;
  const b = g.hold[0];
  const h0 = g.sim.buildingHarm(b);
  g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10);
  check(Math.abs(g.sim.buildingHarm(b) / h0 - 0.6) < 1e-9, `Fortify under threat: its buildings take ${Math.round(g.sim.buildingHarm(b) / h0 * 100)}% damage`);
  check(g.sim.frontier.fire(g.add('turret', 90, 10)) === 1.25, 'and its turrets hit 25% harder');
  // muster: idle units go out
  const m = game();
  m.sim.command({ type: 'debug', units: { unit: 'rover', x: 0, z: -20, n: 3 } });
  steps(m.sim, 5);
  m.sim.command({ type: 'standing', sector: 'east', order: 'muster' });
  m.sim.s.frontier.next = m.sim.s.tick; steps(m.sim, 10);
  const moving = m.sim.units.filter((u) => u.order.kind === 'move' && u.order.x > 50).length;
  check(moving === 3 && m.has(/Standing order Muster: 3 units head out/), 'Muster: idle combat units head out when the warning comes');
  // evacuate: the people who work there stay away
  const e = game({ setup: { colonists: 4 } });
  const job = e.add('hydroponics', 90, 20);
  for (const c of e.sim.s.people.colonists) { c.job = job.id; }
  e.sim.command({ type: 'standing', sector: 'east', order: 'evacuate' });
  e.sim.s.frontier.next = e.sim.s.tick; steps(e.sim, 20);
  e.sim.s.tick = Math.floor(e.sim.s.tick / (C.colony.solSeconds * 10)) * C.colony.solSeconds * 10 + C.colony.solSeconds * 10 * 0.45; // midday: work hours
  steps(e.sim, 20);
  const goals = e.sim.s.people.colonists.map((c) => c.goal);
  check(goals.every((gid) => gid !== job.id), 'Evacuate: workers don\'t go to work there while the threat is on');
}

// ---------- a relic surge ----------
{
  const g = game();
  g.sim.frontier.s.n = 2;
  let t = null;
  for (let i = 0; i < 40 && t?.kind !== 'relic'; i++) { g.sim.frontier.s.threat = null; g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10); t = g.sim.frontier.s.threat; }
  check(t?.kind === 'relic' && g.has(/relic surge is coming/), 'Touchdown has relic grids: a relic surge is announced');
  t.at = g.sim.s.tick + 1; steps(g.sim, 10);
  const s = g.sim.s.hostiles.filter((h) => t.ids?.includes(h.id));
  check(s.length === t.size && s.every((h) => !h.dormant && Math.hypot(h.x - t.x, h.z - t.z) < 40), `${s.length} sentinels break the surface by the holding, awake`);
  check(until(g.sim, () => g.hold.some((b) => b.hp < C.buildings[b.kind].hp), 30), 'and open fire on it');
}

// ---------- a raid ----------
{
  const g = game({ turret: false });
  const c = g.sim.s.camps[0];
  c.met = true; c.regard = 18;
  let t = null;
  for (let i = 0; i < 40 && t?.kind !== 'raid'; i++) { g.sim.frontier.s.threat = null; g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10); t = g.sim.frontier.s.threat; }
  check(t?.kind === 'raid' && g.has(/a raid by the Vell is coming for the east holding/), 'a camp with a grudge sends a raid (announced)');
  const a0 = g.sim.s.alloys;
  t.at = g.sim.s.tick + 1; steps(g.sim, 10);
  check(g.sim.s.alloys < a0 - 50 && g.has(/The Vell raided the east holding/), `unguarded, they take our stores (${Math.round(a0 - g.sim.s.alloys)} alloys)`);
  const h = game();
  const c2 = h.sim.s.camps[0];
  c2.met = true; c2.regard = 18;
  t = null;
  for (let i = 0; i < 40 && t?.kind !== 'raid'; i++) { h.sim.frontier.s.threat = null; h.sim.s.frontier.next = h.sim.s.tick; steps(h.sim, 10); t = h.sim.frontier.s.threat; }
  const b0 = h.sim.s.alloys;
  t.at = h.sim.s.tick + 1; steps(h.sim, 10);
  check(h.sim.s.alloys >= b0 - 1 && h.has(/saw our guards .* and turned back/), 'a powered turret there turns them back');
}

// ---------- warnings come sooner ----------
{
  const g = game({ setup: { research: ['seismic-listening'] } });
  g.sim.s.frontier.next = g.sim.s.tick; steps(g.sim, 10);
  const t = g.sim.frontier.s.threat;
  check(Math.round((t.at - g.sim.s.tick) / 10) >= T.frontierWarn + 44, `Seismic Listening: ${Math.round((t.at - g.sim.s.tick) / 10)} s of warning (was ${T.frontierWarn})`);
}

// ---------- peaceful play tests; saves ----------
{
  const g = game({ setup: { peaceful: true } });
  steps(g.sim, 20);
  check(g.sim.s.frontier.next > 1e15, 'a peaceful play test holds the frontier off too');
  const h = game();
  h.sim.command({ type: 'standing', sector: 'east', order: 'muster' });
  h.sim.s.frontier.next = h.sim.s.tick; steps(h.sim, 10);
  const s2 = new M.Sim(() => {});
  s2.load(structuredClone(h.sim.s));
  check(s2.frontier.order('east') === 'muster' && !!s2.frontier.s.threat, 'standing orders and the threat survive a save');
}

if (!process.argv.includes('--headless-only')) {
  const { launch } = await import('./lib/harness.mjs');
  const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
  const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
  await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'relay'], alloys: 3000 } });
  // a relay toward the east, then a solar array out there
  check(await wait(() => __exo.sim.cur.buildings.some((b) => b.kind === 'relay' && b.progress >= 1)), 'a relay stands');
  const spot = await page.evaluate(() => {
    for (let x = 60; x < 100; x += 3) for (let z = -30; z < 30; z += 3) if (!__exo.canPlace('solar', x, z) && Math.hypot(x, z) > 58) return { x, z };
    return null;
  });
  check(!!spot, `room for a building out past ${55} u (${JSON.stringify(spot)})`);
  if (spot) await cmd({ type: 'build', kind: 'solar', ...spot });
  check(await wait(() => (__exo.sim.cur.frontier?.holdings.length ?? 0) > 0, null, 90000), 'it makes a holding');
  await page.evaluate(() => { const h = __exo.sim.cur.frontier.holdings[0]; __exo.ui.sel = { kind: 'building', id: h.ids[0] }; __exo.hud.selected(); });
  check(await wait(() => /STANDING ORDER/.test(document.querySelector('#card')?.textContent ?? '') && document.querySelectorAll('#card [data-act^="standing:"]').length === 4), 'its card shows the standing orders');
  check(await wait(() => /🔒 Fortify/.test(document.querySelector('#card').textContent)), 'Fortify shows locked without Garrison Doctrine');
  await page.evaluate(() => document.querySelector('#card [data-act$=":muster"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  check(await wait(() => __exo.sim.cur.frontier.holdings[0].order === 'muster' && document.querySelector('#card [data-act$=":muster"]').classList.contains('on')), 'pressing Muster sets it');
  check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
