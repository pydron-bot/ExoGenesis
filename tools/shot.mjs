/**
 * Headless screenshots: node tools/shot.mjs [--url http://localhost:5176/] [--views surface,planet,system]
 *   [--q high] [--w 1600] [--h 900] [--wait 6] [--out shots] [--gpu]
 * Waits for window.__exo.ready, lets the scene run --wait seconds, then
 * captures each view. Prints console errors. Run with:
 *   node tools/shot.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => {
  if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const url = a.url ?? 'http://localhost:5176/';
const views = String(a.views ?? 'surface,planet,system').split(',');
const out = a.out ?? 'shots';
mkdirSync(out, { recursive: true });
const args = a.gpu
  ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: ['--use-gl=angle', ...args] });
const page = await browser.newPage({ viewport: { width: Number(a.w ?? 1600), height: Number(a.h ?? 900) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(`${url}?ui=${a.ui ?? 0}&view=${views[0]}${a.extra ? '&' + a.extra : ''}`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const gl = await page.evaluate(() => {
  const g = window.__exo.renderer.getContext();
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', gl);
if (a.eval) await page.evaluate(a.eval);
for (const v of views) {
  await page.evaluate((v) => window.__exo.setView(v, true), v);
  await page.waitForTimeout(Number(a.wait ?? 6) * 1000);
  const stats = await page.evaluate(() => document.getElementById('fps').textContent + ' ' + document.getElementById('layer').textContent);
  console.log(v, '|', stats.replace(/\n/g, ' | '));
  if (a.page) {
    await page.screenshot({ path: `${out}/${v}.png` });
  } else {
    const url64 = await page.evaluate(() => window.__exo.capture());
    writeFileSync(`${out}/${v}.png`, Buffer.from(url64.split(',')[1], 'base64'));
  }
}
await browser.close();
