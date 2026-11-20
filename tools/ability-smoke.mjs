/**
 * Unit abilities (UnitDef.ability, TECH §6 "Units that feel different"): headless, each kind on the real sim
 * (overdrive, boost, siege, charge, pulse, mend, shield), cooldowns, a skirmish discharge killing another
 * player's units, computer players using theirs; then in the browser (desktop and phone) the unit card's
 * ⚡ button and the G key.
 *   node tools/ability-smoke.mjs [--url http://localhost:5176/] [--headless-only]   (or PORT=5176)
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { content } = (await runnerImport(path.join(root, 'src/content/index.ts'))).module;
const U = content.units;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

planet.setRegionTerrain(planet.regionTerrain(content.regions.touchdown, content.bodies));
core.useRegion('touchdown');

// every Accord combat unit with a cost has an ability
const armed = Object.keys(U).filter((k) => U[k].faction === 'accord' && U[k].cost && U[k].damage > 0);
check(armed.every((k) => U[k].ability && U[k].abilityName), `every armed Accord unit has a named ability (${armed.map((k) => `${k}: ${U[k].abilityName}`).join(', ')})`);

/** Two players on Touchdown, no fog; `a` units for player 0 at A, `b` for player 1 at B (12 u east). */
function duel(a, na, b, nb, gap = 12) {
  const events = [];
  const homes = core.skirmishHomes(2, 114);
  const sim = new core.Sim((t) => events.push(t), 7);
  sim.newSkirmish({ seed: 7, alloys: 0, homes, deposits: [], fog: false, players: [{ name: 'A', color: '#4fd1e8' }, { name: 'B', color: '#e8574f' }] });
  const [h0, h1] = homes, dx = h1.x - h0.x, dz = h1.z - h0.z, k = 1 / Math.hypot(dx, dz);
  const A = { x: h0.x + dx * k * 55, z: h0.z + dz * k * 55 }, B = { x: A.x + dx * k * gap, z: A.z + dz * k * gap };
  if (a) sim.command({ type: 'debug', units: { unit: a, x: A.x, z: A.z, n: na } }, 0);
  if (b) sim.command({ type: 'debug', units: { unit: b, x: B.x, z: B.z, n: nb } }, 1);
  const mine = (t) => sim.units.filter((u) => (u.team ?? 0) === t);
  return { sim, events, A, B, mine, run: (s) => { for (let i = 0; i < s * 10; i++) sim.step(); } };
}
const hpOf = (us) => us.reduce((m, u) => m + Math.max(0, u.hp), 0);

// overdrive: a Rover fires twice as often
{
  const shots = (use) => {
    const g = duel('rover', 1, 'tank', 1);
    const tank = g.mine(1)[0];
    tank.hp = 1e6;
    if (use) g.sim.command({ type: 'ability', ids: g.mine(0).map((u) => u.id) }, 0);
    const before = tank.hp;
    g.run(4);
    return before - tank.hp;
  };
  const off = shots(false), on = shots(true);
  check(on > off * 1.6, `Overdrive: a Rover deals ${Math.round(on)} in 4 s with it, ${Math.round(off)} without`);
}
// cooldown: a second use is refused until it's back
{
  const g = duel('rover', 1, null, 0);
  const r = g.mine(0)[0];
  g.sim.command({ type: 'ability', ids: [r.id] }, 0);
  const cd = r.ab;
  g.sim.command({ type: 'ability', ids: [r.id] }, 0);
  check(cd === U.rover.abilityCooldown && g.events.includes('Not ready yet'), `cooldown: ${cd} s, and a second use says "Not ready yet"`);
  g.run(U.rover.abilityCooldown + 0.5);
  check(!r.ab && g.sim.snapshot().units.find((u) => u.id === r.id).abCd === 0, 'it comes back after the cooldown (the snapshot shows it ready)');
}
// boost: a Scout covers more ground
{
  const dist = (use) => {
    const g = duel('scout', 1, null, 0);
    const s = g.mine(0)[0], x0 = s.x, z0 = s.z;
    g.sim.command({ type: 'order', ids: [s.id], x: x0 - 80 * Math.sign(x0 || 1), z: z0 }, 0);
    if (use) g.sim.command({ type: 'ability', ids: [s.id] }, 0);
    g.run(3);
    return Math.hypot(s.x - x0, s.z - z0);
  };
  const off = dist(false), on = dist(true);
  check(on > off * 1.4, `Afterburner: a Scout goes ${on.toFixed(0)} u in 3 s with it, ${off.toFixed(0)} without`);
}
// siege: a Tank dug in reaches past its range, holds still, takes less, and a move order ends it
{
  const g = duel('tank', 1, null, 0);
  const t = g.mine(0)[0];
  const far = U.tank.range * 1.2;
  g.sim.command({ type: 'debug', units: { unit: 'lancer', x: t.x + far, z: t.z, n: 1 } }, 1);
  const foe = g.mine(1)[0];
  foe.hp = 1e6;
  g.sim.command({ type: 'stop', ids: [foe.id] }, 1);
  g.sim.command({ type: 'ability', ids: [t.id] }, 0);
  const x0 = t.x, z0 = t.z;
  t.hp = 1e6;
  g.run(3);
  const took = 1e6 - t.hp;
  check(t.abT > 0 && Math.hypot(t.x - x0, t.z - z0) < 0.01 && foe.hp < 1e6, `Dig in: the Tank holds still and hits a Lancer ${far.toFixed(0)} u off (past its ${U.tank.range} u)`);
  // the same Lancer on a Tank that isn't dug in
  const g2 = duel('tank', 1, null, 0), t2 = g2.mine(0)[0];
  g2.sim.command({ type: 'debug', units: { unit: 'lancer', x: t2.x + far, z: t2.z, n: 1 } }, 1);
  g2.sim.command({ type: 'stop', ids: g2.mine(1).map((u) => u.id) }, 1);
  g2.sim.command({ type: 'stop', ids: [t2.id] }, 0);
  t2.hp = 1e6; g2.mine(1)[0].hp = 1e6;
  g2.run(3);
  const took2 = 1e6 - t2.hp;
  check(took > 0 && Math.abs(took / took2 - 0.7) < 0.05, `it takes 70% of the damage (${Math.round(took)} vs ${Math.round(took2)})`);
  g.sim.command({ type: 'order', ids: [t.id], x: t.x + 5, z: t.z }, 0);
  check(!t.abT, 'a move order ends it');
}
// charge: the next Lancer slug does triple damage, once
{
  const g = duel('lancer', 1, 'tank', 1, 20);
  const foe = g.mine(1)[0];
  foe.hp = 1e6;
  g.sim.command({ type: 'stop', ids: [foe.id] }, 1);
  g.sim.command({ type: 'ability', ids: g.mine(0).map((u) => u.id) }, 0);
  g.run(0.5);
  const first = 1e6 - foe.hp;
  check(Math.abs(first - U.lancer.damage * U.lancer.abilityPower) < 1, `Overcharge: the next slug does ${first} (${U.lancer.abilityPower}× ${U.lancer.damage})`);
  g.run(U.lancer.cooldown);
  check(Math.abs(1e6 - foe.hp - first - U.lancer.damage) < 1, 'and the one after is back to normal');
}
// pulse: a Discharge hits everything close, and kills another player's units cleanly (skirmish)
{
  const g = duel('arc', 1, 'scout', 4, 5);
  for (const u of g.mine(1)) u.hp = U.arc.abilityPower - 1;
  g.sim.command({ type: 'stop', ids: g.mine(1).map((u) => u.id) }, 1);
  g.sim.command({ type: 'ability', ids: g.mine(0).map((u) => u.id) }, 0);
  g.run(0.2);
  check(g.mine(1).length === 0 && g.sim.s.players[1].econ.stats.unitsLost === 4, `Discharge: all four Scouts within ${U.arc.abilityRadius} u gone, counted as lost by their player`);
  g.run(2);
  check(g.sim.units.length === 1, 'no ghosts left behind (only the Arc Caster on the map)');
}
// mend: a Field Engineer patches up everything near it at once
{
  const g = duel('engineer', 1, null, 0);
  g.sim.command({ type: 'debug', units: { unit: 'tank', x: g.A.x + 3, z: g.A.z, n: 2 } }, 0);
  const tanks = g.mine(0).filter((u) => u.unit === 'tank');
  for (const t of tanks) t.hp = 100;
  g.sim.command({ type: 'ability', ids: g.mine(0).filter((u) => u.unit === 'engineer').map((u) => u.id) }, 0);
  g.run(0.2);
  check(tanks.every((t) => t.hp >= 100 + U.engineer.abilityPower), `Patch up: both Tanks get +${U.engineer.abilityPower} hp at once`);
}
// shield: an Aegis's Hardlight halves the damage its neighbours take
{
  const taken = (use) => {
    const g = duel('aegis', 1, 'rover', 4, 10);
    g.sim.command({ type: 'debug', units: { unit: 'tank', x: g.A.x + 2, z: g.A.z, n: 1 } }, 0);
    const tank = g.mine(0).find((u) => u.unit === 'tank');
    tank.hp = 1e6;
    const aegis = g.mine(0).find((u) => u.unit === 'aegis');
    aegis.hp = 1e6;
    g.sim.command({ type: 'stop', ids: g.mine(0).map((u) => u.id) }, 0);
    if (use) g.sim.command({ type: 'ability', ids: [aegis.id] }, 0);
    g.run(3);
    return 1e6 - tank.hp;
  };
  const off = taken(false), on = taken(true);
  check(on > 0 && on < off * 0.65, `Hardlight: the Tank beside it takes ${Math.round(on)} in 3 s with it, ${Math.round(off)} without`);
}
// computer players use theirs
{
  const homes = core.skirmishHomes(2, 114);
  const sim = new core.Sim(() => {}, 9);
  sim.newSkirmish({ seed: 9, alloys: 0, homes, deposits: [], fog: false, players: [{ name: 'A', color: '#fff' }, { name: 'B', color: '#f00', ai: 'normal' }] });
  const [h0, h1] = homes, dx = h1.x - h0.x, dz = h1.z - h0.z, k = 1 / Math.hypot(dx, dz);
  const B = { x: h1.x - dx * k * 20, z: h1.z - dz * k * 20 };
  sim.command({ type: 'debug', units: { unit: 'rover', x: B.x, z: B.z, n: 3 } }, 1);
  sim.command({ type: 'debug', units: { unit: 'tank', x: B.x + dx * k * -14, z: B.z + dz * k * -14, n: 2 } }, 0);
  for (const u of sim.units) u.hp *= 20;
  let used = false;
  for (let i = 0; i < 200 && !used; i++) { sim.step(); used = sim.units.some((u) => u.team === 1 && (u.ab ?? 0) > 0); }
  check(used, 'a computer player\'s Rovers use Overdrive in a fight');
}

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? `http://localhost:${process.env.PORT ?? 5176}/`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const vp of [{ width: 1400, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?intro=0&new=1&title=0&sw=0&scratch=1`);
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.missions, null, { timeout: 300000 });
    await page.evaluate(() => { __exo.sim.command({ type: 'debug', units: { unit: 'rover', x: 10, z: -24, n: 2 } }); __exo.sim.command({ type: 'debug', units: { unit: 'tank', x: 16, z: -24, n: 1 } }); });
    await page.waitForFunction(() => __exo.sim.cur.units.length >= 3, null, { timeout: 20000 });
    const select = (kind) => page.evaluate((kind) => { __exo.ui.sel = { kind: 'units', ids: __exo.sim.cur.units.filter((u) => !kind || u.unit === kind).map((u) => u.id) }; __exo.hud.cur = __exo.sim.cur; __exo.hud.selected(); }, kind);
    await select(null);
    await page.waitForSelector('#card .grp.abil button[data-unit="rover"]', { timeout: 10000 });
    const btns = await page.$$eval('#card .grp.abil button', (b) => b.map((x) => x.textContent));
    check(btns.some((t) => /Overdrive ×2/.test(t)) && btns.some((t) => /Dig in/.test(t)), `${vp.name}: a mixed selection shows a button per kind (${btns.join(' | ')})`);
    const box = await page.locator('#card .grp.abil button[data-unit="rover"]').boundingBox();
    check(box && box.height >= 36, `${vp.name}: the button is touch-sized (${box ? Math.round(box.height) : 0} px tall)`);
    if (vp.touch) await page.locator('#card .grp.abil button[data-unit="rover"]').tap();
    else await page.locator('#card .grp.abil button[data-unit="rover"]').click();
    await page.waitForFunction(() => __exo.sim.cur.units.filter((u) => u.unit === 'rover').every((u) => u.abCd > 0), null, { timeout: 10000 });
    check(true, `${vp.name}: ⚡ Overdrive fires both Rovers (cooling down), not the Tank`);
    check(await page.evaluate(() => __exo.sim.cur.units.find((u) => u.unit === 'tank').abCd === 0), `${vp.name}: the Tank's Dig in is still ready`);
    await page.waitForFunction(() => /Overdrive · \d+ s/.test(document.querySelector('#card .grp.abil button[data-unit="rover"]')?.textContent ?? ''), null, { timeout: 10000 });
    check(true, `${vp.name}: the button counts down`);
    if (!vp.touch) {
      await select('tank');
      await page.keyboard.press('g');
      await page.waitForFunction(() => __exo.sim.cur.units.find((u) => u.unit === 'tank').abOn > 0, null, { timeout: 10000 });
      check(true, 'desktop: G digs the selected Tank in');
    }
    check(!errs.length, `${vp.name}: no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall ability checks passed');
process.exit(failed ? 1 : 0);
