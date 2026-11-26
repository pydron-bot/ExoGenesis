/**
 * Skirmish frame cost at phone size: 200 vehicles vs a 150-hostile wave, at night,
 * then ms/frame split into army.update / render, plus draw calls and triangles.
 *   node tools/skirmish-perf.mjs [query ...]   e.g.  "" "models=builtin" "lights=0"
 * SwiftShader is a CPU renderer, so absolute numbers mean little; compare variants.
 */
import { launch } from './lib/harness.mjs';
const queries = process.argv.length > 2 ? process.argv.slice(2) : [''];
const browser = await launch();
for (const q of queries) {
  const page = await browser.newPage({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${process.env.SMOKE_URL ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/')}?mode=skirmish&units=200&wave=150&time=night&${q}`);
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.skirmish?.ready, null, { timeout: 120000 });
  await page.evaluate(() => __exo.skirmish.send({ type: 'wave', count: 150 }));
  await page.waitForTimeout(6000); // models load, night falls, the wave closes in
  const r = await page.evaluate(async () => {
    const x = window.__exo, acc = {};
    const wrap = (o, k, name) => { const f = o[k].bind(o); o[k] = (...a) => { const t = performance.now(); const v = f(...a); acc[name] = (acc[name] ?? 0) + performance.now() - t; return v; }; };
    wrap(x.skirmish.army, 'update', 'army');
    wrap(x.renderer, 'render', 'render');
    let frames = 0, calls = 0, tris = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { frames++; calls += x.renderer.info.render.calls; tris += x.renderer.info.render.triangles; if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const el = performance.now() - t0;
    const out = { msFrame: +(el / frames).toFixed(1) };
    for (const k in acc) out[k] = +(acc[k] / frames).toFixed(2);
    out.calls = Math.round(calls / frames); out.ktris = Math.round(tris / frames / 1000);
    return out;
  });
  console.log((q || '(default)').padEnd(28), JSON.stringify(r), errors.length ? `errors: ${errors.join(' | ')}` : '');
  await page.close();
}
await browser.close();
