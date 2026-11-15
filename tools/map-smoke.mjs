/**
 * Map editor end-to-end: sculpt, undo/redo, add a herd, paint flora, save,
 * and check the game's terrain and grazer count changed. Restores content/.
 *   node tools/map-smoke.mjs [--url http://localhost:5176/]
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const file = path.join(root, 'content/regions/touchdown.json');
const original = await fs.readFile(file);
const readRegion = async () => JSON.parse(await fs.readFile(file, 'utf8'));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const P = { x: 40, z: 40 };

try {
  const game = await ctx.newPage();
  game.on('pageerror', (e) => errors.push(`game: ${e.message}`));
  await game.goto(`${url}?intro=0`);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  const h0 = await game.evaluate(([x, z]) => __exo.height(x, z), [P.x, P.z]);
  const f0 = await game.evaluate(() => __exo.sim.cur.fauna.length / 3);

  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
  ed.on('dialog', (d) => d.accept());
  await ed.goto(`${url}editor.html#regions/touchdown.json`);
  await ed.waitForSelector('.map-wrap canvas');
  await wait(1500);
  const screen = (x, z) => ed.evaluate(([x, z]) => __editor.map.screenOf(x, z), [x, z]);
  const draft = () => ed.evaluate(() => ({ height: !!__editor.cur.draft.height, flora: !!__editor.cur.draft.flora, herds: __editor.cur.draft.herds.length }));
  const stroke = async (x, z, ms) => {
    const s = await screen(x, z);
    await ed.mouse.move(s.x, s.y);
    await ed.mouse.down();
    const t0 = Date.now();
    for (let k = 0; Date.now() - t0 < ms; k++) { await ed.mouse.move(s.x + Math.sin(k) * 4, s.y + Math.cos(k) * 4); await wait(30); }
    await ed.mouse.up();
  };

  // 1. sculpt
  await ed.keyboard.press('1');
  await ed.fill('#brush-strength', '1').catch(() => {});
  await ed.evaluate(() => { const i = document.querySelector('#brush-strength'); i.value = '1'; i.dispatchEvent(new Event('input')); });
  await stroke(P.x, P.z, 2500);
  check((await draft()).height, 'raise stroke wrote a height layer into the draft');
  check(await ed.isEnabled('#save'), 'region marked unsaved');
  const ro = await ed.textContent('.map-readout');
  check(/sculpt \+[1-9]/.test(ro), `readout shows the sculpt (${ro.trim()})`);

  // 2. undo / redo
  await ed.keyboard.press('Control+z');
  check(!(await draft()).height, 'Ctrl+Z removed the sculpt');
  await ed.keyboard.press('Control+Shift+z');
  check((await draft()).height, 'Ctrl+Shift+Z brought it back');

  // 3. add a herd
  await ed.keyboard.press('h');
  const hs = await screen(-30, 60);
  await ed.mouse.click(hs.x, hs.y);
  check((await draft()).herds === 8, 'Add herd + click placed an 8th herd');
  check(await ed.locator('.herd-form').count() === 1 && (await ed.textContent('.herd-form .sub')) === 'Herd 8', 'new herd selected in the side panel');

  // 4. flora paint
  await ed.keyboard.press('5');
  await stroke(-50, -20, 800);
  check((await draft()).flora, 'flora stroke wrote a flora layer');

  // 5. save → valid file
  await ed.keyboard.press('Control+s');
  await wait(1000);
  const reg = await readRegion();
  check(Array.isArray(reg.height) && reg.height.length === 121 && Array.isArray(reg.flora) && reg.herds.length === 8, 'saved file has height + flora grids and 8 herds');
  check(reg.height.filter((r) => r !== '0*121').length < 40, `only touched rows differ (${reg.height.filter((r) => r !== '0*121').length} of 121)`);
  let valid = true;
  try { execFileSync('node', [path.join(root, 'tools/content-check.mjs')], { stdio: 'pipe' }); } catch { valid = false; }
  check(valid, 'content:check passes on the saved region');

  // 6. the game picked it up
  await wait(2000);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  const h1 = await game.evaluate(([x, z]) => __exo.height(x, z), [P.x, P.z]);
  const f1 = await game.evaluate(() => __exo.sim.cur.fauna.length / 3);
  check(h1 > h0 + 1, `game terrain raised at (${P.x}, ${P.z}): ${h0.toFixed(1)} → ${h1.toFixed(1)}`);
  check(f1 === f0 + 20, `game has the new herd's grazers (${f0} → ${f1})`);
} finally {
  await fs.writeFile(file, original);
}
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
