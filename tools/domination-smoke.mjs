/**
 * Domination's strategy map in the browser (domination.html, src/domination/main.ts): setup, building, sending an
 * army to take an area, the autosave and CONTINUE, a save file (and loading it from the game's title LOAD), victory.
 *   node tools/domination-smoke.mjs [--url http://localhost:5176/]
 * The rules and the computer players are tested headless: tools/domination-sim.mjs.
 */
import { launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const S = () => page.evaluate(() => JSON.parse(JSON.stringify(__dom.s)));

await page.goto(`${url}domination.html`);
// a clean browser: no autosave, no save files
await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('saves');
  r.onsuccess = () => {
    const st = r.result.transaction('saves', 'readwrite').objectStore('saves');
    const k = st.getAllKeys();
    k.onsuccess = () => { for (const key of k.result) if (String(key).startsWith('file') || key === 'domination') st.delete(key); st.transaction.oncomplete = res; };
  };
}));
await page.reload();
await page.waitForSelector('#options [data-act="start"]', { timeout: 60000 });
check(!(await page.$('#options [data-act="continue"]')), 'a first war: no CONTINUE');
await page.click('#options [data-key="players"] [data-v="2"]');
await page.click('#options [data-key="ai"] [data-v="easy"]');
await page.click('#options [data-act="start"]');
await page.waitForFunction(() => window.__dom?.s);
await page.evaluate(() => __dom.setSpeed(0));
let s = await S();
check(s.players.length === 2 && s.players[1].ai === 'easy' && s.areas['home-1'].owner === 0, 'two players, Easy, you at Touchdown');
check((await page.$$('.dm-node')).length === 40, 'all 40 areas on the map');

// build an army at Touchdown
await page.click('[data-area="home-1"]');
await page.waitForSelector('[data-build="army"]');
const a0 = s.players[0].alloys;
await page.click('[data-build="army"]');
s = await S();
check(s.players[0].alloys === a0 - 100 && s.areas['home-1'].queue[0]?.kind === 'army', 'ARMY is paid for and queued');
await page.evaluate(() => __dom.step(25));
s = await S();
check(s.areas['home-1'].army === 40, `it joins the garrison (${s.areas['home-1'].army})`);

// send it all to the weakest neighbour and take it
const to = await page.evaluate(() => { const st = __dom.s; return __dom.map.byId['home-1'].links.slice().sort((a, b) => st.areas[a].natives - st.areas[b].natives)[0]; });
await page.waitForTimeout(400);
await page.click('[data-send]');
await page.waitForTimeout(300);
check((await page.$$('.dm-node .ring')).length >= 3, 'the places it can go are ringed');
await page.click(`[data-area="${to}"]`);
s = await S();
check(s.moves.some((m) => m.player === 0 && m.to === to), `the army sets off for ${to}`);
await page.evaluate(() => __dom.step(150));
s = await S();
check(s.areas[to].owner === 0, `${to} is taken`);
await page.waitForTimeout(400);
check(/You took/.test(await page.textContent('.dm-side')), 'the events say so');

// a save file through the menu
await page.click('[data-act="menu"]');
await page.click('#options [data-id="saves"]');
await page.fill('#options .sv-name', 'Smoke war');
await page.click('#options [data-act="new"]');
await page.waitForSelector('#options .sv-title:text("Smoke war")', { timeout: 15000 });
check(/Domination/.test(await page.textContent('#options .sv-row')), 'saved as a Domination file');
const savedT = (await S()).t;
await page.keyboard.press('Escape');

// the autosave: reload, CONTINUE
await page.evaluate(() => __dom.step(30));
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(600);
const autoT = (await S()).t;
await page.reload();
await page.waitForSelector('#options [data-act="continue"]', { timeout: 60000 });
await page.click('#options [data-act="continue"]');
s = await S();
check(Math.abs(s.t - autoT) < 2 && s.areas[to].owner === 0, `CONTINUE picks up the autosaved war (${Math.round(s.t)} s)`);

// the game's title screen: DOMINATION, and LOAD of the file comes back here
await page.goto(`${url}?sw=0`);
await page.waitForSelector('#title [data-id="domination"]', { timeout: 180000 });
check(true, 'the title screen has DOMINATION');
await page.click('#title [data-id="load"]');
await page.waitForSelector('#options .sv-row');
await Promise.all([page.waitForURL(/domination\.html/, { timeout: 30000 }), page.click('#options .sv-row:has(.sv-title:text("Smoke war")) [data-act="load"]')]);
await page.waitForFunction(() => window.__dom?.s, null, { timeout: 60000 });
s = await S();
check(Math.abs(s.t - savedT) < 2 && !page.url().includes('load='), `the file loads into the strategy map (${Math.round(s.t)} s)`);

// victory: the last enemy area falls
await page.evaluate(() => { const st = __dom.s; for (const a of Object.values(st.areas)) if (a.owner === 1) { a.owner = -1; a.natives = 0; a.army = 0; a.guns = 0; } __dom.step(1); });
await page.waitForSelector('#options .dm-stats', { timeout: 10000 });
check(/Victory/i.test(await page.textContent('#options')), 'the end screen: Victory, with the stats');

// ---- teams, fog of war, victory by holding 75% (a fresh war: the setup's NEW WAR)
await page.click('#options [data-act="again"]');
await page.waitForSelector('#options [data-act="start"]', { timeout: 10000 });
await page.click('#options [data-key="players"] [data-v="3"]');
check(await page.$eval('#options [data-key="teams"] [data-v="2v2"]', (b) => b.disabled), '2 v 2 needs four players');
await page.click('#options [data-key="players"] [data-v="4"]');
await page.click('#options [data-key="teams"] [data-v="2v2"]');
await page.click('#options [data-key="fog"] [data-v="on"]');
await page.click('#options [data-key="win"] [data-v="control"]');
await page.click('#options [data-act="start"]');
await page.waitForFunction(() => window.__dom?.s?.rules?.fog);
await page.evaluate(() => { __dom.setSpeed(0); __dom.step(600); });
await page.waitForTimeout(500);
s = await S();
check(s.rules.fog && s.rules.win === 'control' && s.rules.side.join('') === '0011', `the rules: ${JSON.stringify(s.rules)}`);
const fogged = await page.$$eval('.dm-node.fog text', (t) => t.map((x) => x.textContent));
check(fogged.length > 10 && fogged.every((x) => x === '?'), `areas out of sight show ? (${fogged.length})`);
const strip = await page.textContent('.dm-players');
check(/team A, ally/.test(strip) && /FOG/.test(strip) && /75% WINS/.test(strip), 'the players: teams, your ally, and the rules');
check(/win at 30/.test(await page.textContent('[data-s="areas"]')), 'the top bar says what wins');
// your side holds 30 areas, the other side the last 10: victory by control, with the chart
await page.evaluate(() => { const st = __dom.s; st.moves = []; Object.values(st.areas).forEach((a, i) => Object.assign(a, { owner: i < 30 ? i % 2 : 2 + (i % 2), visitors: {}, natives: 0, army: 5 })); __dom.step(1); });
await page.waitForSelector('#options .dm-chart', { timeout: 10000 });
const end = await page.textContent('#options');
check(/Victory/i.test(end) && /with your allies by holding 3\d of 40 areas/.test(end) && (await page.$$('#options .dm-chart polyline')).length === 4, 'Victory by holding 75%, with allies, and a line per player in the chart');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall domination page checks passed');
process.exit(failed ? 1 : 0);
