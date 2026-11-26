/**
 * Domination battles in the browser: from the strategy map's ⚔ FIGHT IT YOURSELF into the game on the area's own map
 * (units and turrets from the war's numbers), back again two ways: leaving half way (what's left fights on), and
 * finishing it (the end screen's Back to the strategy map; the area changes hands).
 *   node tools/domination-battle-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const S = () => page.evaluate(() => JSON.parse(JSON.stringify(__dom.s)));
const AREA = 'verdance-2';

/** A fresh two-player war, with your army of `mine` fighting Crimson's `theirs` + 10 guns at Verdance's second area. */
async function setUp(mine, theirs) {
  await page.goto(`${url}domination.html?sw=0`);
  await page.waitForSelector('#options [data-act="start"]', { timeout: 60000 });
  await page.click('#options [data-key="players"] [data-v="2"]');
  await page.click('#options [data-act="start"]');
  await page.waitForFunction(() => window.__dom?.s);
  await page.evaluate(([area, mine, theirs]) => {
    __dom.setSpeed(0);
    const a = __dom.s.areas[area];
    Object.assign(a, { owner: 1, army: theirs, guns: 10, natives: 0, queue: [], visitors: { 0: mine } });
    __dom.s.players[1].ai = undefined; // the computer holds still on the map (the test drives it)
  }, [AREA, mine, theirs]);
  await page.click(`[data-area="${AREA}"]`);
  await page.waitForSelector('[data-act="fight"]', { timeout: 5000 });
}
/** Into the battle; returns once the game is running it. */
async function intoBattle() {
  await Promise.all([page.waitForURL(/battle=1/, { timeout: 30000 }), page.click('[data-act="fight"]')]);
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
}

// ---- leave half way
await setUp(60, 40);
const t0 = (await S()).t;
await intoBattle();
let g = await page.evaluate(() => { const c = __exo.sim.cur; return { players: c.players.map((p) => p.name), units: c.units.length, buildings: c.buildings.map((b) => `${b.team ?? 0}:${b.kind}`) }; });
check(g.players.length === 2 && g.players[0] === 'You' && g.players[1] === 'Crimson', `the battle's players: ${g.players}`);
check(g.buildings.filter((b) => b === '1:core').length === 1 && g.buildings.filter((b) => b === '1:turret').length === 1 && !g.buildings.some((b) => b.startsWith('0:')), `Crimson holds with a Core and a turret; you have no base (${g.buildings.join(' ')})`);
check(g.units >= 12, `both armies are on the field (${g.units} units in sight)`);
check(/Domination battle/.test(await page.textContent('#log')), 'the log says what this is');
check(!(await page.evaluate(() => [...document.querySelectorAll('#hud *')].some((e) => e.id === 'over-battle'))), 'no end-screen button yet');
await page.click('#b-menu');
await page.click('#options [data-id="map"]');
// (leaving the 3D page is slow under the software renderer: wait for the new page's content, not its load event)
await Promise.all([page.waitForURL(/domination\.html/, { timeout: 60000, waitUntil: 'domcontentloaded' }), page.click('#options [data-id="map"]')]);
await page.waitForFunction(() => window.__dom?.s, null, { timeout: 60000 });
let s = await S();
check(Math.abs(s.t - t0) < 0.01, 'the war waited (same moment)');
check(s.log.some((e) => /Battle at .*left early/.test(e.text)), 'the events tell the battle\'s outcome');
check(s.areas[AREA].owner === 1 && (s.areas[AREA].visitors[0] ?? 0) > 0, `the fight goes on on the map (you ${Math.round(s.areas[AREA].visitors[0] ?? 0)}, Crimson ${Math.round(s.areas[AREA].army)} + ${Math.round(s.areas[AREA].guns)} guns)`);
check(!page.url().includes('battle='), 'the address forgets the battle');

// ---- fight to the end: Crimson's Core falls
await setUp(80, 20);
await intoBattle();
await page.evaluate(() => { const c = __exo.sim.cur.buildings.find((b) => b.team === 1 && b.kind === 'core'); __exo.sim.command({ type: 'debug', hurt: { id: c.id, hp: 99999 } }, 1); });
await page.waitForSelector('#over-battle', { state: 'visible', timeout: 30000 });
check(await page.evaluate(() => getComputedStyle(document.getElementById('over-restart')).display === 'none'), 'the end screen leads back to the map (no Rematch)');
await Promise.all([page.waitForURL(/domination\.html/, { timeout: 60000, waitUntil: 'domcontentloaded' }), page.click('#over-battle')]);
await page.waitForFunction(() => window.__dom?.s, null, { timeout: 60000 });
await page.evaluate(() => __dom.step(1));
s = await S();
check(s.areas[AREA].owner === 0 && s.areas[AREA].army > 0, `the area is yours, held by what was left (${Math.round(s.areas[AREA].army)})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall battle page checks passed');
process.exit(failed ? 1 : 0);
