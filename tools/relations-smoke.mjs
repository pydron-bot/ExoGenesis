/**
 * Inhabitant relations beyond first contact (headless, the real sim, Touchdown's Vell camp): trade (once they trust
 * us or we speak their language), favours from a camp that trusts us (guides, lookouts, hunters who fight beside us),
 * a trusted camp defending its land, and what wears regard down or builds it (mining their deposits, loud buildings,
 * clearing a nest, a grievance). Then the Neighbours tab in the browser.
 *   node tools/relations-smoke.mjs [--headless-only] [--url http://localhost:5176/]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content, V = C.inhabitants.vell, SOL = C.colony.solSeconds;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

function game(setup = {}) {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.command({ type: 'debug', setup: { peaceful: true, alloys: 3000, isotopes: 200, buildings: ['solar', 'solar', 'civic', 'hydroponics'], ...setup } });
  sim.s.people.biomass = 300;
  steps(sim, 10);
  return { sim, log, camp: () => sim.s.camps[0] };
}
/** First contact: a drone beside the camp, then approach. */
function meet(g) {
  const c = g.camp(), d = g.sim.s.drones[0];
  d.x = c.x + 12; d.z = c.z - 12; d.task = { kind: 'idle' }; d.manual = true;
  steps(g.sim, 10);
  g.sim.command({ type: 'contact', camp: 0, choice: 'approach' });
  d.x = 0; d.z = -14; // and home again
}
const trust = (g) => { g.sim.command({ type: 'debug', regard: { camp: 0, value: 90 } }); steps(g.sim, 20); };
const ask = (g, act, n) => g.sim.command({ type: 'neighbour', camp: 0, act, n });

check(V.trades?.length >= 2 && V.hunters > 0 && V.defends, `the Vell trade (${V.trades.length} offers), guide, keep watch, send ${V.hunters} hunters and defend their land`);
check(C.inhabitants.choir.trades?.length >= 2, 'so does the Choir, in its own way');

// ---------- trade ----------
{
  const g = game();
  meet(g);
  const r0 = g.camp().regard;
  ask(g, 'trade', 0);
  check(g.log.some((t) => /Can't trade with the Vell: they don't trust us yet/.test(t)), 'no trade before trust or a shared language');
  g.sim.command({ type: 'debug', setup: { research: ['translation-matrix'] } });
  check(g.sim.snapshot().camps[0].canTrade, 'Translation Matrix: we can trade with them');
  g.sim.s.people.biomass = 40;
  const t = V.trades[0], a0 = g.sim.s.alloys, b0 = g.sim.s.people.biomass;
  ask(g, 'trade', 0);
  check(Math.round(a0 - g.sim.s.alloys) === t.giveAmount && Math.round(g.sim.s.people.biomass - b0) === t.getAmount, `"${t.label}": −${t.giveAmount} alloys, +${t.getAmount} biomass`);
  check(g.camp().regard > r0, `fair dealing builds a little regard (${r0.toFixed(1)} → ${g.camp().regard.toFixed(1)})`);
  const a1 = g.sim.s.alloys;
  ask(g, 'trade', 0);
  check(g.sim.s.alloys === a1 && g.log.some((x) => /not ready to trade again/.test(x)), 'they need time before the next trade');
  ask(g, 'trade', 2);
  check(g.log.some((x) => /want regard 65/.test(x)), 'better trades want more regard');
}

// ---------- favours ----------
{
  const g = game();
  meet(g);
  ask(g, 'guide');
  check(g.log.some((t) => /won't do us favours until they trust us/.test(t)), 'no favours before trust');
  trust(g);
  check(g.camp().trusted, 'they trust us');
  const far = { x: g.camp().x - 20, z: g.camp().z - 70 };
  const seen0 = g.sim.explored(far.x, far.z);
  const r0 = g.camp().regard;
  ask(g, 'guide');
  check(!seen0 && g.sim.explored(far.x, far.z), 'Guides: their land comes out of the fog');
  check(Math.abs(r0 - V.guideCost - g.camp().regard) < 0.5, `a favour costs regard (−${V.guideCost})`);
  ask(g, 'watch');
  check(g.log.some((t) => /helped us lately/.test(t)), 'one favour at a time');
  g.camp().helpAt = 0;
  ask(g, 'watch');
  check(g.sim.mod('warning') === 30 && g.sim.snapshot().camps[0].watch > SOL - 2, 'Lookouts: threat warnings 30 s sooner, for a sol');
  // hunters: brutes at a building away from the camp and the Core's guns
  g.camp().helpAt = 0;
  const b = { id: g.sim.s.nextId++, kind: 'solar', x: 70, z: -70, progress: 1, hp: C.buildings.solar.hp, on: true, powered: true };
  g.sim.s.buildings.push(b);
  g.sim.command({ type: 'debug', spawn: { unit: 'brute', x: 74, z: -74, n: 2 } });
  const brutes = () => g.sim.s.hostiles.filter((h) => h.unit === 'brute');
  const hp0 = brutes().reduce((m, h) => m + h.hp, 0);
  ask(g, 'hunters');
  check(g.sim.snapshot().camps[0].hunting === V.hunters, `${V.hunters} hunters set out`);
  steps(g.sim, 600);
  const hp1 = brutes().reduce((m, h) => m + h.hp, 0);
  check(hp1 < hp0 - 100, `they fight at our building: the brutes ${hp0} → ${hp1.toFixed(0)} hp in a minute (${2 - brutes().length} killed)`);
  steps(g.sim, (V.hunterSeconds + 30) * 10);
  check(g.sim.snapshot().camps[0].hunting === 0, 'and go home when their time is up');
}

// ---------- joint defence ----------
{
  const g = game();
  meet(g);
  const c = g.camp();
  g.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: c.x + 20, z: c.z - 10, n: 3 } });
  const sw = () => g.sim.s.hostiles.filter((h) => h.unit === 'swarmer' && Math.hypot(h.x - c.x, h.z - c.z) < V.land + 30);
  for (const h of sw()) h.target = -1;
  const n0 = sw().reduce((m, h) => m + h.hp, 0);
  steps(g.sim, 30);
  const n1 = sw().reduce((m, h) => m + h.hp, 0);
  check(n1 >= n0 - 1, 'before they trust us, they leave predators to us');
  trust(g);
  g.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: c.x + 15, z: c.z - 10, n: 3 } });
  steps(g.sim, 150);
  check(g.sim.s.stats.kills >= 1, `once they trust us they defend their land (${g.sim.s.stats.kills} predators killed there)`);
}

// ---------- what wears regard down, and what builds it ----------
{
  const g = game();
  meet(g);
  const c = g.camp();
  const dep = g.sim.s.deposits.findIndex((d) => Math.hypot(d.x - c.x, d.z - c.z) < V.land);
  check(dep >= 0, 'a deposit lies on their land');
  const d = g.sim.s.deposits[dep];
  g.sim.s.buildings.push({ id: g.sim.s.nextId++, kind: 'depot', x: d.x + 8, z: d.z - 8, progress: 1, hp: 400, on: true, powered: true, mining: dep });
  g.sim.s.buildings.push({ id: g.sim.s.nextId++, kind: 'solar', x: 30, z: 30, progress: 1, hp: 200, on: true, powered: true }, { id: g.sim.s.nextId++, kind: 'solar', x: 36, z: 30, progress: 1, hp: 200, on: true, powered: true });
  g.sim.command({ type: 'debug', regard: { camp: 0, value: 60 } });
  const mined0 = g.sim.s.stats.mined;
  steps(g.sim, SOL * 10 / 4);
  const lost = 60 - c.regard, mined = g.sim.s.stats.mined - mined0;
  const want = V.encroach / 4 + V.mineHarm * mined / 100;
  check(mined > 50 && Math.abs(lost - want) < 1.5, `mining their deposit: −${lost.toFixed(1)} in a quarter sol (${mined.toFixed(0)} alloys; encroaching alone would be −${(V.encroach / 4).toFixed(1)})`);
  g.sim.s.buildings.push({ id: g.sim.s.nextId++, kind: 'deepmine', x: c.x + 30, z: c.z - 25, progress: 1, hp: 500, on: false, powered: false });
  check(g.sim.snapshot().camps[0].encroaching === 4, 'a loud Deep-Core Mine on their land counts three times');
  const r1 = c.regard;
  g.sim.inhabitants.nestCleared(c.x + 10, c.z + 10);
  check(Math.abs(c.regard - r1 - V.nestHelp) < 0.01 && g.log.some((t) => /clear the nest/.test(t)), `clearing a nest near them: +${V.nestHelp}`);
  // a grievance once regard is low (a dilemma: it waits for the dilemma time)
  g.sim.command({ type: 'debug', regard: { camp: 0, value: 18 } });
  g.sim.skip(C.colony.dilemmaFrom ?? 900);
  for (let i = 0; i < 30 && !g.sim.s.story.fired.includes('vell-grievance'); i++) {
    for (const id of [...g.sim.s.story.inbox]) if (id !== 'vell-grievance') g.sim.command({ type: 'story', id, choice: 0 });
    c.regard = 18; steps(g.sim, 10);
  }
  check(g.sim.s.story.inbox.includes('vell-grievance'), 'at low regard the Vell come with a grievance');
  g.sim.command({ type: 'story', id: 'vell-grievance', choice: 0 });
  check(c.regard > 30, `paying them for the land mends it (${c.regard.toFixed(0)})`);
}

// ---------- saves ----------
{
  const g = game();
  meet(g); trust(g);
  ask(g, 'hunters');
  const copy = structuredClone(g.sim.s);
  const s2 = new M.Sim(() => {});
  s2.load(copy);
  check(s2.snapshot().camps[0].hunting === V.hunters && s2.snapshot().camps[0].helpIn > 0, 'hunters out and the favour cooldown survive a save');
}

if (!process.argv.includes('--headless-only')) {
  const { chromium } = await import('playwright');
  const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
  const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
  await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'civic', 'hydroponics'], alloys: 2000, peaceful: true, research: ['translation-matrix'] } });
  const camp = await page.evaluate(() => __exo.sim.cur.camps[0]);
  const drone = await page.evaluate(() => __exo.sim.cur.drones[0].id);
  await cmd({ type: 'move', drone, x: camp.x + 12, z: camp.z - 12 });
  check(await until(() => __exo.sim.cur.camps[0].pending, null, 90000), 'the drone reaches the Vell (first contact)');
  await cmd({ type: 'contact', camp: 0, choice: 'approach' });
  await page.evaluate(() => { for (const id of __exo.sim.cur.story.inbox) __exo.sim.command({ type: 'story', id, choice: 0 }); });
  await page.waitForTimeout(600); // (the HUD's snapshot catches up with first contact)
  await page.evaluate(() => __exo.hud.people.toggle(true, 'neighbours'));
  check(await until(() => document.querySelectorAll('#colony [data-trade]').length >= 2), 'the Neighbours tab lists their trades');
  check(await until(() => /ASK A FAVOUR/.test(document.querySelector('#colony').textContent) && /Once they trust us/.test(document.querySelector('#colony').textContent)), 'and says what favours trust would bring');
  const a0 = await page.evaluate(() => __exo.sim.cur.alloys);
  // (the panel redraws a few times a second: press whichever button is there now, until the trade has gone through)
  const press = (sel) => `(() => { if (!document.querySelector('#colony.on')) __exo.hud.people.toggle(true, 'neighbours'); document.querySelector('${sel}')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); })()`;
  check(await until((a) => { eval(a[1]); return __exo.sim.cur.alloys < a[0] - 50; }, [a0, press('#colony [data-trade="0:0"]')]), 'a trade button makes the trade');
  await cmd({ type: 'debug', regard: { camp: 0, value: 90 } });
  check(await until(() => document.querySelectorAll('#colony [data-ask]').length === 3), 'once they trust us: Guides, Lookouts, Hunters');
  check(await until((js) => { if (!__exo.sim.cur.camps[0].hunting) eval(js); return __exo.sim.cur.camps[0].hunting > 0 && /\d hunters/.test(document.querySelector('#colony').textContent); }, press('#colony [data-ask="0:hunters"]')), 'asking for hunters sends them, and the tab says so');
  check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
