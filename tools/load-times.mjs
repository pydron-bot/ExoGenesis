/**
 * Measures the loading steps (window.__loadTimes) over a few fresh page loads.
 *   node tools/load-times.mjs [--runs 3] [--url http://localhost:5176/] [--cpu 4]
 * --cpu N throttles the CPU N× via DevTools (rough phone stand-in).
 */
import { chromium } from 'playwright';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const runs = Number(arg('--runs', 3)), url = arg('--url', 'http://localhost:5176/'), cpu = Number(arg('--cpu', 1));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const all = {};
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  if (cpu > 1) { const s = await ctx.newCDPSession(page); await s.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  await page.goto(`${url}?intro=0&new=1`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
  const t = await page.evaluate(() => window.__loadTimes);
  for (let i = 0; i < t.length - 1; i++) (all[t[i][0]] ??= []).push(t[i + 1][1] - t[i][1]);
  (all.TOTAL ??= []).push(t[t.length - 1][1]);
  await ctx.close();
}
const rows = Object.entries(all).map(([k, v]) => ({ step: k, ms: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }));
console.table(rows);
await browser.close();
