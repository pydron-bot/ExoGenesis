/**
 * Editor: Import (Rules → Music) and Copy JSON. Copy JSON copies a mood; Import catches bad JSON, lists
 * problems (an unknown field, a bad note) and offers Import anyway, suggests an id from the name, fills a
 * missing required field with its default, keeps the name, opens the new mood, and ▶ Listen plays it.
 * Writes content/music/zz-import-test.json through the dev server and deletes it at the end.
 *   node tools/import-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';
import fs from 'fs';
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const prompts = [];
page.on('dialog', async (d) => { prompts.push(d.defaultValue()); await d.accept('zz-import-test'); });
try {
  await page.goto(`${url}editor.html#music/night.json`);
  await page.waitForSelector('#save', { timeout: 60000 });
  await page.click('button:text-is("Copy JSON")');
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied.includes('"name": "Night · Long Dark"') && JSON.parse(copied).chords.length === 5, 'Copy JSON copies the mood');
  await page.click('.coll button.mini:text-is("Import")');
  await page.waitForSelector('dialog.imp-dlg[open]');
  check(true, 'Import opens the dialog');
  await page.fill('.imp-text', '{ "name": ');
  await page.click('dialog.imp-dlg button.primary');
  check(/valid JSON/.test(await page.textContent('.imp-msg')), 'bad JSON is caught');
  const m = JSON.parse(copied);
  m.name = 'Night · Imported Test';
  delete m.homePull;
  m.chords[1].notes = 'F3 H9 D4';
  m.wobble = 3;
  await page.fill('.imp-text', JSON.stringify(m, null, 2));
  await page.click('dialog.imp-dlg button.primary');
  const msg = await page.textContent('.imp-msg');
  check(/H9/.test(msg) && /wobble/.test(msg) && !/homePull/.test(msg), `problems listed (${msg.replace(/\s+/g, ' ').slice(0, 140)})`);
  check(await page.textContent('dialog.imp-dlg button.primary') === 'Import anyway', 'offers Import anyway');
  m.chords[1].notes = 'F3 A3 D4';
  delete m.wobble;
  await page.fill('.imp-text', JSON.stringify(m, null, 2));
  await page.click('dialog.imp-dlg button.primary');
  await page.waitForTimeout(1500);
  check(prompts[0] === 'night-imported-test', `id suggested from the name (${prompts[0]})`);
  const p = 'content/music/zz-import-test.json';
  const made = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  check(made && made.name === 'Night · Imported Test' && (made.homePull ?? 0) === 0 && made.chords.length === 5, `created with its own name; the missing (optional) field stays empty or 0 (${made?.name}, homePull ${made?.homePull})`);
  check((await page.evaluate(() => location.hash)).includes('zz-import-test'), 'opens the new mood');
  await page.click('.mp-play');
  await page.waitForTimeout(2500);
  check(/chord \d+ of 5/.test(await page.textContent('.mp-now')), 'and it plays with ▶ Listen');
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) { console.log('FAIL', e.message); failed++; }
finally {
  fs.rmSync('content/music/zz-import-test.json', { force: true });
  await browser.close();
}
process.exit(failed ? 1 : 0);
