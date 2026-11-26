/**
 * Save files (src/saves.ts, the saves panel): a campaign saved by name comes back after a NEW GAME; Ctrl+S saves
 * over the file; rename, delete, export and import; the old single slot becomes a file; a skirmish saved mid-battle
 * loads into the same map with its game.
 *   node tools/saves-smoke.mjs [--url http://localhost:5176/]
 */
import { launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const ready = () => page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 180000 });
const idb = (fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const store = r.result.transaction('saves', 'readwrite').objectStore('saves'); res(new Function('store', 'a', src)(store, a)); };
  r.onerror = () => rej(r.error);
}), [fn, arg]);
const keys = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('exogenesis', 1); r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').getAllKeys(); g.onsuccess = () => res(g.result.map(String)); }; }));
const openSaves = async () => {
  for (let i = 0; i < 4 && (await page.$('#options')); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  await page.click('#b-menu');
  await page.waitForSelector('#options [data-id="saves"]');
  await page.click('#options [data-id="saves"]');
  await page.waitForSelector('#options.saves .sv-list:not(:has(.sv-empty:text("Reading")))');
};

// ---------- campaign ----------
await page.goto(`${url}?intro=0&new=1&sw=0`);
await ready();
// clear save files from earlier runs
for (const k of await keys()) if (k.startsWith('file') || k === 'slot1') await idb('store.delete(a)', k);
await page.waitForTimeout(1500);
const tick0 = await page.evaluate(() => __exo.sim.cur.tick);
await openSaves();
await page.fill('#options .sv-name', 'Smoke colony');
await page.click('#options [data-act="new"]');
await page.waitForSelector('#options .sv-row .sv-title:text("Smoke colony")', { timeout: 15000 });
const row = await page.textContent('#options .sv-row');
check(/Campaign/.test(row) && /Touchdown/.test(row) && /Sol \d/.test(row), `the file lists kind, place and time (${row.replace(/\s+/g, ' ').trim().slice(0, 90)})`);
const k1 = await keys();
check(k1.some((k) => k.startsWith('filemeta:')) && k1.some((k) => k.startsWith('file:')), 'saved as a meta and a body record');

// rename
await page.click('#options [data-act="rename"]');
await page.fill('#options .sv-rename', 'Renamed colony');
await page.keyboard.press('Enter');
await page.waitForSelector('#options .sv-title:text("Renamed colony")');
check(true, 'rename');

// export
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#options [data-act="export"]')]);
const exported = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
check(/^exo-save-renamed-colony\.json$/.test(dl.suggestedFilename()) && JSON.parse(exported).exoSave === 1, `export downloads ${dl.suggestedFilename()}`);
await page.keyboard.press('Escape');

// play on, then Ctrl+S saves over the same file
await page.waitForTimeout(2500);
await page.keyboard.press('Control+s');
await page.waitForTimeout(1500);
const metas = await idb(`return new Promise((r) => { const g = store.getAll(); g.onsuccess = () => r(g.result.filter((v) => v && v.version === 1 && v.kind && v.name)); });`);
check(metas.length === 1 && metas[0].name === 'Renamed colony', `Ctrl+S saves over the file it came from (${metas.map((m) => m.name).join(', ')})`);
const savedTick = await page.evaluate(() => __exo.sim.save().then((s) => s.tick));

// NEW GAME wipes the autosaves, then LOAD on the title brings the colony back
await page.goto(`${url}?intro=0&new=1&sw=0`);
await ready();
const freshTick = await page.evaluate(() => __exo.sim.cur.tick);
check(freshTick < tick0 + 30, `a new game starts over (tick ${freshTick})`);
await page.evaluate(() => __exo.sim.flush());
await page.waitForTimeout(1000);
await page.goto(`${url}?sw=0`);
await page.waitForSelector('#title [data-id="load"]', { timeout: 180000 });
check(/1 save file/.test(await page.textContent('#title [data-id="load"]')), 'the title offers LOAD');
await page.click('#title [data-id="load"]');
await page.waitForSelector('#options .sv-row');
// a campaign in this browser: LOAD asks twice
await page.click('#options [data-act="load"]');
check(/REPLACES/.test(await page.textContent('#options [data-act="load"]')), 'loading over a campaign asks first');
await Promise.all([page.waitForURL(/travel=1|region=touchdown/, { timeout: 30000 }), page.click('#options [data-act="load"]')]);
await ready();
const back = await page.evaluate(() => __exo.sim.cur.tick);
check(back >= savedTick - 20 && back > freshTick + 20, `the saved colony is back (tick ${back}, saved near ${savedTick})`);

// delete, import
await openSaves();
await page.click('#options [data-act="delete"]');
await page.click('#options [data-act="delete"]');
await page.waitForSelector('#options .sv-empty:text("No save files")');
check(true, 'delete (asks twice)');
await page.setInputFiles('#options .sv-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
await page.waitForSelector('#options .sv-title:text("Renamed colony")');
check(true, 'import brings a file back');
await page.setInputFiles('#options .sv-file', { name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
await page.waitForSelector('#options .sv-msg.bad');
check(/isn’t an Exo Genesis save/.test(await page.textContent('#options .sv-msg')), 'a stray file is refused with a reason');
await page.keyboard.press('Escape');

// the old single slot becomes a file
const st = await page.evaluate(() => __exo.sim.save());
await idb('store.put(a, "slot1")', { version: 1, savedAt: Date.now() - 60000, sim: st, camera: { dist: 80, yaw: 0, pitch: 0.8, fx: 0, fz: 0 } });
await openSaves();
const t = await page.textContent('#options .sv-list');
check(/older version/.test(t) && !(await keys()).includes('slot1'), 'the old Save slot is listed as a file');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// ---------- skirmish ----------
await page.goto(`${url}?skirmish=4242&players=2&ai=easy&size=small&sw=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
await page.evaluate(() => __exo.sim.command({ type: 'build', kind: 'turret', x: 0, z: 0 }));
await page.waitForTimeout(9000);
const skBefore = await page.evaluate(() => __exo.sim.save().then((s) => ({ tick: s.tick, b: s.buildings.length, seed: s.seed })));
await openSaves();
check(/Skirmish on/.test(await page.inputValue('#options .sv-name')), 'a skirmish suggests its own name');
await page.fill('#options .sv-name', 'Smoke battle');
await page.click('#options [data-act="new"]');
await page.waitForSelector('#options .sv-title:text("Smoke battle")', { timeout: 15000 });
const skRow = await page.textContent('#options .sv-row.hi');
check(/Skirmish/.test(skRow) && /2 players/.test(skRow) && /\d+ min/.test(skRow), `a skirmish file (${skRow.replace(/\s+/g, ' ').trim().slice(0, 80)})`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// a rematch starts over; then load the file
await page.goto(`${url}?skirmish=4242&players=2&ai=easy&size=small&sw=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
await openSaves();
const loadBtn = '#options .sv-row:has(.sv-title:text("Smoke battle")) [data-act="load"]';
await page.click(loadBtn);
check(/ENDS/.test(await page.textContent(loadBtn)), 'loading over a battle under way asks first');
await page.evaluate(() => { window.__old = true; });
await page.click(loadBtn);
await page.waitForFunction(() => !window.__old, null, { timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 180000 });
await page.waitForTimeout(300);
const skAfter = await page.evaluate(() => __exo.sim.save().then((s) => ({ tick: s.tick, b: s.buildings.length, seed: s.seed })));
check(skAfter.seed === skBefore.seed && skAfter.tick >= skBefore.tick && skAfter.b >= skBefore.b, `the skirmish loads with its game (${JSON.stringify(skBefore)} → ${JSON.stringify(skAfter)})`);
check(!new URL(page.url()).searchParams.has('load'), 'the address forgets the load');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall save file checks passed');
process.exit(failed ? 1 : 0);
