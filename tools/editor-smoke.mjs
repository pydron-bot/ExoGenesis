/**
 * Editor end-to-end: edit a unit, save, game reloads (editor doesn't), conflict
 * guard, validation, create + delete, and the game's bad-content screen.
 * Restores content/ exactly as it was at the end.
 *   node tools/editor-smoke.mjs [--url http://localhost:5176/]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const rover = path.join(root, 'content/units/rover.json');
const readRover = async () => JSON.parse(await fs.readFile(rover, 'utf8'));
// Snapshot content/ in memory and put it back exactly afterwards (works whether
// or not the files are committed; never touches git).
async function snapshot(dir, sub = '', out = new Map()) {
  for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
    const rel = path.join(sub, e.name);
    if (e.isDirectory()) await snapshot(dir, rel, out);
    else out.set(rel, await fs.readFile(path.join(dir, rel)));
  }
  return out;
}
const contentDir = path.join(root, 'content');
const before = await snapshot(contentDir);
async function restore() {
  for (const rel of (await snapshot(contentDir)).keys()) if (!before.has(rel)) await fs.unlink(path.join(contentDir, rel));
  for (const [rel, buf] of before) await fs.writeFile(path.join(contentDir, rel), buf);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const game = await ctx.newPage();
  game.on('pageerror', (e) => errors.push(`game: ${e.message}`));
  await game.goto(`${url}?intro=0&new=1`);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await game.evaluate(() => (window.__marker = 1));

  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
  const dialogs = [];
  ed.on('dialog', async (d) => {
    dialogs.push(d.message());
    if (d.type() === 'prompt') await d.accept('testbug');
    else await d.accept();
  });
  await ed.goto(`${url}editor.html#units/rover.json`);
  await ed.waitForSelector('.row[data-key=hp] input');
  await ed.evaluate(() => (window.__marker = 1));
  const hp0 = (await readRover()).hp;
  check((await ed.inputValue('.row[data-key=hp] input')) === String(hp0), `rover form shows hp ${hp0}`);
  check(await ed.locator('#side .item', { hasText: 'Brute' }).count() === 1, 'sidebar lists units');

  // 1. edit + save
  await ed.fill('.row[data-key=hp] input', '75');
  check((await ed.textContent('.row[data-key=hp] .was')) === `was ${hp0}`, 'changed field shows the old value');
  check(await ed.isEnabled('#save'), 'save enabled when dirty');
  await ed.keyboard.press('Control+s');
  await wait(800);
  check((await readRover()).hp === 75, 'Ctrl+S wrote hp 75 to content/units/rover.json');
  check(!(await ed.isEnabled('#save')), 'save disabled after saving');

  // 2. game reloaded, editor did not
  await wait(1500);
  check(await game.evaluate(() => window.__marker === undefined), 'game tab reloaded on content change');
  check(await ed.evaluate(() => window.__marker === 1), 'editor tab kept its state');

  // 3. conflict: change on disk, then edit + save in the editor → asked, overwrite
  const r = await readRover();
  await fs.writeFile(rover, JSON.stringify({ ...r, speed: 9.9 }, null, 2) + '\n');
  await ed.fill('.row[data-key=damage] input', '7');
  await ed.click('#save');
  await wait(800);
  check(dialogs.some((m) => m.includes('changed elsewhere')), 'save after an outside change asks first');
  const after = await readRover();
  check(after.damage === 7 && after.speed === 7.5, 'accepted overwrite wrote the editor version');

  // 4. validation
  await ed.fill('.row[data-key=hp] input', '0');
  check((await ed.textContent('.row[data-key=hp] .issue')) === 'must be ≥ 1', 'out-of-range value flagged inline');
  await ed.click('#revert');
  await wait(200);
  check((await ed.inputValue('.row[data-key=hp] input')) === '75', 'revert restores the saved value');

  // 5. create + delete
  await ed.locator('.coll', { hasText: 'Units' }).locator('button').click();
  await wait(800);
  check(await fs.stat(path.join(root, 'content/units/testbug.json')).then(() => true, () => false), '+ New created content/units/testbug.json');
  check((await ed.textContent('#main h1')) === 'Testbug', 'new unit opened in the form');
  await ed.click('button.danger');
  await wait(800);
  check(await fs.stat(path.join(root, 'content/units/testbug.json')).then(() => false, () => true), 'delete removed the file');

  // 6. git status in the header
  await wait(4500);
  check(/uncommitted/.test(await ed.textContent('#git-status')), `header shows git status ("${await ed.textContent('#git-status')}")`);

  // 7. bad content → the game explains instead of starting
  await fs.writeFile(rover, JSON.stringify({ ...after, hp: 'lots' }, null, 2) + '\n');
  await wait(2500); // the game tab live-reloads into the error screen
  if (!(await game.locator('#content-issues').count())) await game.goto(`${url}?intro=0&new=1`);
  await game.waitForSelector('#content-issues', { timeout: 30000 });
  check((await game.textContent('#content-issues')).includes('units/rover.json · hp: must be a number'), 'game shows a clear content error');
  errors.splice(0, errors.length, ...errors.filter((e) => !e.includes('content: 1 issue')));
} finally {
  await restore();
}
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
