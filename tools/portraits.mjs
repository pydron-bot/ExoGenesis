/**
 * Character portraits: tools/portraits/<id>.svg (the source) → public/media/image/portrait-<id>.png (192 px, what
 * the game loads; content/assets/portrait-<id>.json names it, content/characters/<id>.json uses it). Re-run after
 * editing an SVG:
 *   node tools/portraits.mjs            (all)
 *   node tools/portraits.mjs marrow     (one)
 *   node tools/portraits.mjs --sheet out.png   (also a contact sheet of every portrait)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'tools/portraits');
const sheetAt = process.argv.indexOf('--sheet');
const sheet = sheetAt > 0 ? process.argv[sheetAt + 1] : '';
const only = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--sheet');
const ids = readdirSync(src).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).filter((id) => !only.length || only.includes(id));
const SIZE = 192;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
for (const id of ids) {
  const svg = readFileSync(path.join(src, `${id}.svg`), 'utf8').replace('width="256" height="256"', `width="${SIZE}" height="${SIZE}"`);
  await page.setContent(`<html><body style="margin:0;background:#000">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(root, `public/media/image/portrait-${id}.png`) });
  console.log(`portrait-${id}.png`);
}
if (sheet) {
  await page.setViewportSize({ width: 6 * 140, height: Math.ceil(ids.length / 6) * 160 });
  const cells = ids.map((id) => `<figure style="margin:0;width:140px;text-align:center;color:#ccc;font:12px sans-serif">${readFileSync(path.join(src, `${id}.svg`), 'utf8').replace('width="256" height="256"', 'width="128" height="128"')}<figcaption>${id}</figcaption></figure>`).join('');
  await page.setContent(`<html><body style="margin:0;background:#111;display:flex;flex-wrap:wrap">${cells}</body></html>`);
  await page.screenshot({ path: sheet });
}
await browser.close();
