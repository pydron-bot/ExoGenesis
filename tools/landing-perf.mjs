/**
 * Stutter check for the landing: shader programs compiled while it plays (each one is a hitch on a phone; a
 * headless run can't time the GPU, but it can count these), and the landing's own JS time per frame.
 *   node tools/landing-perf.mjs [--url http://localhost:5176/] [--extra "bloom=1"] [--gpu]
 * Exit 1 if any program compiles after the warm-up (the first 0.5 s) or before the hand-over.
 */
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const url = arg('--url', (process.env.SMOKE_URL ?? 'http://localhost:5176/'));
const extra = arg('--extra', 'bloom=1');
const gpu = process.argv.includes('--gpu')
  ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: ['--use-gl=angle', ...gpu] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?title=0&new=1&sw=0&ui=0&${extra}`);
await page.waitForFunction(() => window.__exo?.landing, null, { timeout: 300000 });
const r = await page.evaluate(() => new Promise((res) => {
  const R = window.__exo.renderer, P = window.__exo.landing.piece;
  const seen = new Set(R.info.programs.map((p) => p.id));
  const ev = [], js = [];
  const orig = P.frame.bind(P);
  P.frame = (t, dt, day) => { const a = performance.now(); orig(t, dt, day); js.push([performance.now() - a, t]); };
  let endFrames = 0;
  const step = () => {
    const L = window.__exo.landing;
    for (const p of R.info.programs) if (!seen.has(p.id)) { seen.add(p.id); ev.push([L ? L.t : -1, p.name || p.cacheKey.split(',')[0]]); }
    if (!L && ++endFrames > 3) return res({ ev, js });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
const late = r.ev.filter(([t]) => t > 0.5);
const atEnd = r.ev.filter(([t]) => t < 0);
const js = r.js.map((x) => x[0]).sort((a, b) => a - b);
console.log(`programs compiled: ${r.ev.length - late.length - atEnd.length} in the warm-up, ${late.length} mid-landing, ${atEnd.length} at the hand-over`);
for (const [t, n] of [...late, ...atEnd]) console.log(`  t=${t < 0 ? 'end' : t.toFixed(2)}  ${n}`);
console.log(`landing JS per frame: median ${js[js.length >> 1].toFixed(2)} ms, max ${js[js.length - 1].toFixed(2)} ms`);
for (const [ms, t] of r.js) if (ms > 4) console.log(`  ${ms.toFixed(1)} ms @ t=${t.toFixed(2)}`);
await browser.close();
process.exit(late.length ? 1 : 0);
