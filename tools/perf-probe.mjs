/**
 * Per-frame cost breakdown at phone size: wraps region.update, hud.update,
 * renderer.render and reports ms/frame plus draw calls and triangles.
 *   node tools/perf-probe.mjs [query]   e.g.  "fog=0"  "sound=0"
 */
import { chromium } from 'playwright';
const q = process.argv[2] ?? '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.goto(`http://localhost:5176/?intro=0&new=1&${q}`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  const x = window.__exo, acc = {};
  const wrap = (o, k, name) => { const f = o[k].bind(o); o[k] = (...a) => { const t = performance.now(); const v = f(...a); acc[name] = (acc[name] ?? 0) + performance.now() - t; return v; }; };
  wrap(x.region, 'update', 'region.update');
  wrap(x.hud, 'update', 'hud.update');
  wrap(x.renderer, 'render', 'render');
  let frames = 0; const t0 = performance.now();
  await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < 8000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const el = performance.now() - t0;
  const out = { fps: +(frames / el * 1000).toFixed(1), msFrame: +(el / frames).toFixed(1) };
  for (const k in acc) out[k] = +(acc[k] / frames).toFixed(2);
  out.calls = x.renderer.info.render.calls; out.tris = x.renderer.info.render.triangles;
  out.programs = x.renderer.info.programs.length; out.scale = x.res.scale;
  return out;
});
console.log(q || '(default)', JSON.stringify(r));
await browser.close();
