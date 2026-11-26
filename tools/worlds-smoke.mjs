/**
 * Worlds, region size, map generators and ground paint, and the story board.
 * Nothing is saved: the game plays editor drafts through ?preview=1, and the
 * editor's changes stay unsaved.
 *   node tools/worlds-smoke.mjs [--url http://localhost:5176/]
 */
import { launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await launch();
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

try {
  // ---- the game on another body, at another size ----
  const game = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  game.on('pageerror', (e) => errors.push(`game: ${e.message}`));
  await game.goto(`${url}?sw=0`);
  await game.evaluate(() => localStorage.setItem('exo.preview', JSON.stringify({ id: 'worlds-test', def: {
    name: 'Worlds test', body: 'sela', size: 160, floraSeed: 1, floraDensity: 1, herds: [], deposits: [{ x: 30, z: 20, alloys: 800 }], spawns: [{ x: 60, z: 60 }],
  } })));
  await game.goto(`${url}?preview=1&intro=0&sw=0`);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
  const w = await game.evaluate(() => window.__exo.world());
  check(w.body === 'sela' && w.radius === 600, `plays on the region's body (${w.body}, radius ${w.radius})`);
  check(w.half === 80, `the region is its own size (half-width ${w.half})`);
  await game.waitForFunction(() => window.__exo.sim.cur?.fog?.length, null, { timeout: 30000 });
  const fog = await game.evaluate(() => window.__exo.sim.cur.fog.length);
  check(fog === 40 * 40, `the sim's fog grid follows the size (${fog} cells)`);
  const flora = await game.evaluate(() => window.__exo.region.flora?.count ?? null);
  if (flora !== null) check(flora === 0, `a barren moon grows no plants (${flora})`);
  await game.close();

  // ---- the map editor: generate, paint, resize (unsaved) ----
  const ed = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  ed.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
  ed.on('dialog', (d) => d.accept());
  await ed.goto(`${url}editor.html#regions/touchdown.json`);
  await ed.waitForSelector('.map-wrap canvas');
  const h0 = await ed.evaluate(() => JSON.stringify(__editor.cur.draft.height ?? null));
  await ed.evaluate(() => __editor.map.runGenerate({ kind: 'craters', height: 14, size: 40, seed: 3, mode: 'add', edge: 10 }));
  check(await ed.evaluate((h0) => JSON.stringify(__editor.cur.draft.height ?? null) !== h0, h0), 'Generate (craters) changes the sculpting');
  await ed.evaluate(() => __editor.map.autoPaintArea({ low: 4, high: 28, steep: 1.1, strength: 0.85 }));
  const g = await ed.evaluate(() => __editor.cur.draft.ground);
  check(Array.isArray(g) && g.length === 121 && g.some((r) => /[1-9]\d\d/.test(r)), 'Auto-paint writes a ground paint grid');
  check(await ed.$('#paint-swatches .swatch') !== null, 'the ground paint swatches show');
  await ed.evaluate(() => __editor.map.undoStep());
  await ed.evaluate(() => __editor.map.resizeTo(320));
  await ed.waitForFunction(() => __editor.cur.draft.size === 320 && __editor.map);
  const d = await ed.evaluate(() => ({ h: __editor.cur.draft.height?.length, size: __editor.cur.draft.size }));
  check(d.h === 161, `resize to 320 u pads the sculpting to 161 rows (${d.h})`);
  // ---- Worlds and the planet map ----
  await ed.evaluate(() => { history.replaceState(null, '', '#'); });
  await ed.goto(`${url}editor.html#bodies/halcyon.json`);
  await ed.waitForSelector('.world-pv canvas');
  check(/gas giant/.test(await ed.textContent('.world-pv .wp-info')), 'Worlds: a giant says nothing can land');
  await ed.evaluate(() => localStorage.setItem('exo.planet.body', 'sela'));
  await ed.goto(`${url}editor.html#planet`);
  await ed.waitForSelector('.planet-body');
  check(await ed.$eval('.planet-body', (s) => s.value) === 'sela', 'planet map opens on the body last shown');
  check(!(await ed.$$eval('.planet-body option', (o) => o.map((x) => x.value))).includes('halcyon'), 'giants are left out of the planet map');
  // ---- story board ----
  await ed.goto(`${url}editor.html#board`);
  await ed.waitForSelector('.board-card');
  const cols = await ed.$$eval('.board-col .bh-title', (e) => e.map((x) => x.textContent));
  check(cols[0] === 'Touchdown' && cols.at(-1) === 'No chapter', `a column per chapter in order, then No chapter (${cols.length})`);
  const card = ed.locator('.board-card', { hasText: 'Groundwork' }).first();
  await card.dragTo(ed.locator('.board-col').nth(1));
  check(/Save 1 move/.test(await ed.textContent('.head .actions')), 'dragging a card to another chapter is a pending move');
  await ed.click('.board-kinds .chip:has-text("Missions")');
  check(await ed.locator('.board-card .bc-kind', { hasText: 'Mission' }).count() === 0, 'hiding a kind hides its cards');
  await ed.click('.board-kinds .chip:has-text("Missions")');
  await ed.close();
} catch (e) {
  console.log('FAIL ', e.message); failed++;
}
check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall worlds checks passed');
process.exit(failed ? 1 : 0);
