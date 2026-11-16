/**
 * App icons for the home screen (PWA manifest, iOS, favicon), rendered from
 * public/icons/icon.svg. Run after changing the SVG and commit the PNGs:
 *   node tools/make-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const OUT = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
  ['public/icons/favicon-32.png', 32],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of OUT) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#05080d">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(file, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log(`${file} (${size}×${size})`);
}
await browser.close();
