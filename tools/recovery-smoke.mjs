/**
 * When things go wrong (src/crash.ts, v0.101.0): the sim worker throwing shows the "simulation stopped" card (Copy
 * details, Keep watching, Reload back to the autosave); a page error shows the small note once; NEW GAME keeps the
 * campaign as a "Before new game" save file first (title and game menu), and only the newest few of those are kept.
 *   node tools/recovery-smoke.mjs [--url http://localhost:5176/]
 */
import { DEV_URL, checker, launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : DEV_URL;
const { check, done } = checker();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(180000);
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => { if (!/smoke-boom/.test(e.message)) errors.push(e.message); });
const ready = () => page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 180000 });
const autos = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').getAll(); g.onsuccess = () => res(g.result.filter((v) => v?.version === 1 && v.name && v.auto)); };
}));
const clearFiles = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => {
    const st = r.result.transaction('saves', 'readwrite').objectStore('saves');
    const k = st.getAllKeys();
    k.onsuccess = () => { for (const key of k.result) if (String(key).startsWith('file')) st.delete(key); res(); };
  };
}));

// ---------- a page error: a note, once ----------
await page.goto(`${url}?intro=0&new=1&sw=0`);
await ready();
await clearFiles();
await page.evaluate(() => { setTimeout(() => { throw new Error('smoke-boom 1'); }); setTimeout(() => { throw new Error('smoke-boom 2'); }, 50); });
await page.waitForTimeout(400);
check(await page.locator('#crash-note').count() === 1, 'a page error shows one note');
await page.click('#crash-note .cr-copy');
const copied = await page.evaluate(() => navigator.clipboard.readText());
check(/smoke-boom 1/.test(copied) && /Exo Genesis v\d/.test(copied), 'Copy details copies the error and version');
await page.click('#crash-note .cr-x');
check(await page.locator('#crash-note').count() === 0, 'the note can be dismissed');

// ---------- the sim stops ----------
// a malformed load makes the sim throw inside the worker
await page.evaluate(() => __exo.sim.worker.postMessage({ type: 'load', state: { version: 2, region: __exo.sim.cur.region ?? 'touchdown', buildings: null } }));
await page.waitForSelector('#crash', { timeout: 10000 }).catch(() => {});
check(await page.locator('#crash .cr-reload').count() === 1, 'the sim throwing shows "the simulation stopped" with Reload');
const t0 = await page.evaluate(() => __exo.sim.cur.tick);
await page.waitForTimeout(1200);
check(await page.evaluate(() => __exo.sim.cur.tick) === t0, 'the sim has stopped ticking');
await page.click('#crash .cr-stay');
check(await page.locator('#crash').count() === 0, 'Keep watching closes the card');

// ---------- NEW GAME keeps the campaign first ----------
await page.goto(`${url}?intro=0&new=1&sw=0`);
await ready();
await page.waitForTimeout(1500);
await page.evaluate(() => __exo.sim.flush());
await page.waitForTimeout(800);
await page.goto(`${url}?sw=0`);
await page.waitForSelector('#title [data-id="new"]', { timeout: 180000 });
await page.waitForTimeout(1500);
await page.click('#title [data-id="new"]');
await page.click('#title [data-id="new"]');
await page.waitForTimeout(1500);
let a = await autos();
check(a.length === 1 && /^Before new game/.test(a[0].name) && a[0].kind === 'campaign', `title NEW GAME keeps a save file first (${a.map((m) => m.name).join(', ')})`);
// the menu's New game, in a game
await page.goto(`${url}?intro=0&new=1&sw=0`);
await ready();
await page.waitForTimeout(1200);
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('#b-menu', { state: 'visible', timeout: 120000 });
  await page.click('#b-menu');
  await page.click('#options [data-id="new"]');
  await page.click('#options [data-id="new"]');
  await page.waitForTimeout(1500);
  for (let j = 0; j < 3 && (await page.$('#options')); j++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
}
a = await autos();
check(a.length === 3, `the game menu's New game keeps one too, and only the newest 3 stay (${a.length})`);

// ---------- Reload from the crash card resumes ----------
await page.evaluate(() => __exo.sim.flush());
await page.waitForTimeout(800);
await page.evaluate(() => __exo.sim.worker.postMessage({ type: 'load', state: { version: 2, region: __exo.sim.cur.region ?? 'touchdown', buildings: null } }));
await page.waitForSelector('#crash .cr-reload', { timeout: 10000 });
await Promise.all([page.waitForURL(/title=0/, { waitUntil: 'commit' }), page.click('#crash .cr-reload', { noWaitAfter: true })]);
await ready();
check(!new URL(page.url()).searchParams.has('new'), 'Reload goes back to the autosave (no new=1)');

check(!errors.length, `no other page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();
