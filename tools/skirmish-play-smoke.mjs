/**
 * Skirmish end to end in the browser (DESIGN §5.11 phase 3): title → SKIRMISH → setup (choices, map preview, START)
 * → the game (skirmish HUD, team colours, fog hiding the others, enemies not selectable) → defeat and victory
 * screens → rematch.
 *   node tools/skirmish-play-smoke.mjs [--url http://localhost:5176/] [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const url = arg('--url', (process.env.SMOKE_URL ?? 'http://localhost:5176/')), shots = arg('--shots', null);
if (shots) mkdirSync(shots, { recursive: true });
const browser = await launch();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const errors = [];

async function run(viewport, name, mobile = false) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  const cur = () => page.evaluate(() => __exo.sim.cur);
  // ---- title → setup
  await page.goto(`${url}?sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title [data-id="skirmish"]'), null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  await page.click('#title [data-id="skirmish"]');
  await page.waitForSelector('#options.sk-setup');
  await page.click('#options [data-key="players"] [data-v="3"]');
  await page.click('#options [data-key="world"] [data-v="rime"]');
  await page.click('#options [data-key="relief"] [data-v="rugged"]');
  check(await page.$eval('#options [data-key="water"] [data-v="lots"]', (b) => b.disabled), `${name}: no sea to pick on Rime`);
  check((await page.$$('#options .sk-p')).length === 3, `${name}: three players listed`);
  await page.waitForFunction(() => document.querySelector('#options .sk-wait')?.hidden, null, { timeout: 60000 });
  const lit = await page.evaluate(() => { const c = document.querySelector('#options .sk-prev canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n / (d.length / 4); });
  check(lit > 0.5, `${name}: the map preview is drawn (${Math.round(lit * 100)}% lit)`);
  if (shots) await page.screenshot({ path: `${shots}/${name}-setup.png` });
  await Promise.all([page.waitForURL(/skirmish=/, { timeout: 60000 }), page.click('#options .sk-start')]);
  const q = new URL(page.url()).searchParams;
  check(q.get('players') === '3' && q.get('world') === 'rime' && q.get('relief') === 'rugged', `${name}: START opens the game it set up (${page.url().split('?')[1]})`);
  // ---- in game
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.players, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  let s = await cur();
  check(s.players.length === 3 && s.players[0].name === 'You', `${name}: three players in the game`);
  check(await page.evaluate(() => document.body.classList.contains('rts')), `${name}: skirmish HUD`);
  const hidden = await page.evaluate(() => ['r-cryo', 'r-planet', 'r-food', 'goals'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none'));
  check(hidden, `${name}: no colony counters (cryo, planet, biomass, goals)`);
  check(await page.evaluate(() => document.getElementById('minimap').classList.contains('on')), `${name}: the map shows from the start`);
  check(s.buildings.every((b) => !b.team) && s.drones.every((d) => !d.team), `${name}: the others' bases are hidden in the fog (${s.buildings.length} buildings known)`);
  // others' units: in sight they show (in their colour), out of sight they don't
  const home = s.players[0].home;
  await page.evaluate(([x, z]) => { __exo.sim.command({ type: 'debug', units: { unit: 'rover', x, z, n: 3 } }, 1); __exo.sim.command({ type: 'debug', units: { unit: 'tank', x: 0, z: 0, n: 2 } }, 2); }, [home.x * 0.8, home.z * 0.8]);
  await page.waitForFunction(() => __exo.sim.cur.units.some((u) => u.team === 1), null, { timeout: 20000 });
  s = await cur();
  check(s.units.filter((u) => u.team === 1).length === 3 && !s.units.some((u) => u.team === 2), `${name}: Crimson's rovers in sight show, Amber's tanks out of sight don't`);
  // tapping one of them doesn't select it
  await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; __exo.cam.targetDist = 45; }, [home.x * 0.8, home.z * 0.8]);
  // (the camera eases there: under software rendering that can take a while, so wait until the rover is on screen)
  let foe, p = null;
  for (let t = 0; t < 30 && !p; t++) {
    await page.waitForTimeout(500);
    foe = (await cur()).units.find((u) => u.team === 1);
    p = foe ? await page.evaluate((id) => __exo.unitScreen(id), foe.id) : null;
  }
  if (p) await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  check(!!p && !(await page.evaluate(() => __exo.ui.sel?.kind === 'units')), `${name}: an enemy unit can't be selected`);
  if (shots) await page.screenshot({ path: `${shots}/${name}-enemies.png` });
  // they shoot at us: an "under attack" alert with a place; tapping it (or H) takes the camera there
  const alert = await page.waitForFunction(() => [...document.querySelectorAll('#log .ev.go')].find((e) => /Under attack/.test(e.textContent))?.textContent ?? null, null, { timeout: 30000 }).then((h) => h.jsonValue(), () => null);
  check(!!alert, `${name}: an under-attack alert you can tap (${alert})`);
  if (alert) {
    await page.evaluate(() => { __exo.cam.fx = 0; __exo.cam.fz = 0; });
    await page.keyboard.press('h');
    const moved = await page.evaluate(() => Math.hypot(__exo.cam.fx, __exo.cam.fz));
    check(moved > 20, `${name}: H takes the camera to it (${moved.toFixed(0)} u from the middle)`);
  }
  // ---- menu
  await page.click('#b-menu');
  const items = await page.$$eval('#options .op-act', (bs) => bs.map((b) => b.dataset.id));
  check(['rematch', 'skirmish', 'surrender', 'saves'].every((k) => items.includes(k)), `${name}: skirmish menu (${items.join(', ')})`);
  await page.keyboard.press('Escape');
  // ---- victory: the others surrender
  await page.evaluate(() => { __exo.sim.command({ type: 'surrender' }, 1); __exo.sim.command({ type: 'surrender' }, 2); });
  await page.waitForFunction(() => document.getElementById('over').classList.contains('on'), null, { timeout: 20000 });
  const over = await page.evaluate(() => ({ t: document.getElementById('over-title').textContent, rows: document.querySelectorAll('#over .sk-stats tr').length, b: document.getElementById('over-restart').textContent }));
  check(over.t === 'VICTORY' && over.rows === 4 && over.b === 'Rematch', `${name}: victory screen with everyone's numbers (${over.t}, ${over.rows - 1} rows)`);
  if (shots) await page.screenshot({ path: `${shots}/${name}-victory.png` });
  // ---- rematch, then defeat
  await page.click('#over-restart');
  await page.waitForFunction(() => !__exo.sim.cur.over && __exo.sim.cur.players.every((p) => !p.out), null, { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById('over').classList.contains('on'), null, { timeout: 10000 });
  check(true, `${name}: Rematch starts again (and the end screen goes)`);
  await page.evaluate(() => __exo.sim.command({ type: 'surrender' }));
  const lost = await page.waitForFunction(() => document.getElementById('over').classList.contains('on') && document.getElementById('over-title').textContent === 'DEFEAT', null, { timeout: 20000 }).then(() => true, () => false);
  check(lost, `${name}: surrender ends in defeat`);
  await ctx.close();
}

await run({ width: 1280, height: 800 }, 'desktop');
await run({ width: 390, height: 760 }, 'phone', true);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall skirmish play checks passed');
process.exit(failed ? 1 : 0);
