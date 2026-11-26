/**
 * Anti-aliasing cost: ms/frame for each ⚙ Options → Anti-aliasing mode (?aa=, src/world/post.ts),
 * Glow on and off, render scale pinned, vsync off. Saves a screenshot of each when given a folder.
 *   node tools/aa-bench.mjs [phone|desktop] [outdir]
 * CPU renderer (llvmpipe): only the ratios between variants mean anything, and MSAA is overstated
 * (phone GPUs resolve it on chip). Measure on a real phone before changing what `auto` picks.
 */
import { chromium } from 'playwright';
const form = process.argv[2] ?? 'phone', out = process.argv[3];
const VARIANTS = [
  ['glow off, AA off', 'bloom=0&aa=off'],
  ['glow off, MSAA (canvas)', 'bloom=0&aa=msaa'],
  ['glow off, FXAA', 'bloom=0&aa=fxaa'],
  ['glow off, SMAA', 'bloom=0&aa=smaa'],
  ['glow on, AA off', 'bloom=1&aa=off'],
  ['glow on, FXAA', 'bloom=1&aa=fxaa'],
  ['glow on, SMAA', 'bloom=1&aa=smaa'],
  ['glow on, MSAA 4x', 'bloom=1&aa=msaa'],
];
const vp = form === 'phone'
  ? { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, dpr: 1.75 }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, dpr: 1 };
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const rows = [];
for (const [name, q] of VARIANTS) {
  const { dpr, ...opts } = vp;
  const page = await browser.newPage(opts);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${process.env.SMOKE_URL ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/')}?intro=0&new=1&dpr=${dpr}&${q}`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(), ts = [];
    let last = t0, frames = 0;
    await new Promise((res) => { const f = () => { const n = performance.now(); ts.push(n - last); last = n; frames++; if (n - t0 < 8000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    ts.sort((a, b) => a - b);
    const x = window.__exo;
    return { ms: +((performance.now() - t0) / frames).toFixed(1), p50: +ts[ts.length >> 1].toFixed(1), frames, used: x.post.aaInUse, px: `${x.renderer.domElement.width}x${x.renderer.domElement.height}` };
  });
  if (out) await page.screenshot({ path: `${out}/${form}-${q.replace(/[&=]/g, '_')}.png` });
  rows.push({ name, ...r });
  console.log(name.padEnd(24), JSON.stringify(r));
  await page.close();
}
const base = rows[0].p50;
console.log(`\nvs ${rows[0].name} (p50):`);
for (const r of rows) console.log(' ', r.name.padEnd(24), `${r.p50} ms`, `${r.p50 - base >= 0 ? '+' : ''}${(r.p50 - base).toFixed(1)} ms`, `(${((r.p50 / base - 1) * 100).toFixed(0)}%)`);
await browser.close();
