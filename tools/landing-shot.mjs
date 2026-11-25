/**
 * Stills of the landing set piece at chosen moments (for judging its look).
 *   node tools/landing-shot.mjs [--url http://localhost:5176/] [--at 8,10.5,11.8,12.4,14.5,19] [--out shots/landing] [--tag before] [--gpu]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const url = arg('--url', 'http://localhost:5176/');
const at = arg('--at', '8,10.5,11.8,12.4,14.5,19').split(',').map(Number);
const out = arg('--out', 'shots/landing'), tag = arg('--tag', 'shot');
mkdirSync(out, { recursive: true });
const gpu = process.argv.includes('--gpu')
  ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: ['--use-gl=angle', ...gpu] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`${url}?title=0&new=1&sw=0&ui=0${process.argv.includes("--bloom") ? "&bloom=1" : ""}`);
await page.waitForFunction(() => window.__exo?.landing, null, { timeout: 300000 });
for (const t of at) {
  await page.evaluate((t) => window.__exo.landing.seek(t - 0.6), t);
  await page.waitForFunction((t) => window.__exo.landing && window.__exo.landing.t >= t, t, { timeout: 120000 });
  await page.screenshot({ path: `${out}/${tag}-${String(t).replace('.', '_')}.png` });
  console.log('shot', t, await page.evaluate(() => window.__exo.landing.t.toFixed(2)));
}
await browser.close();
