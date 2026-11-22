/**
 * Terrain look switched in place (v0.70.0): Options → Terrain look rebuilds the ground, the plants' shading and
 * the globe without reloading the page; building pads stay level; the choice is remembered for the next visit;
 * fog of war carries over; no shader fails to compile.
 *   node tools/look-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/THREE\.WebGLProgram|Shader Error|Program Info Log/.test(m.text()) || (m.type() === 'error' && !/KHR_parallel_shader_compile/.test(m.text()))) errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

await page.goto(`${url}?title=0&intro=0&new=1&sw=0`, { timeout: 120000 });
await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 180000 });
await page.evaluate(() => { localStorage.removeItem('exo.look'); window.__samePage = true; });
// a building beside the Core, so there's a pad levelled into the ground
await page.evaluate(() => { __exo.sim.command({ type: 'debug', alloys: 2000 }); __exo.sim.command({ type: 'build', kind: 'solar', x: 14, z: 6 }); });
await page.waitForFunction(() => __exo.region.pads?.size > 0, null, { timeout: 30000 }).catch(() => {});
/** The ground mesh's height at a pad's centre against the pad's own height (visual levelling kept). */
const padGap = () => page.evaluate(() => {
  const r = __exo.region, pads = [...(r.pads?.values() ?? [])];
  if (!pads.length) return null;
  const p = pads[0], v = r.patch.userData.verts, pos = r.patch.geometry.getAttribute('position');
  let best = -1, bd = Infinity;
  for (let i = 0; i < v.x.length; i++) { const d = Math.hypot(v.x[i] - p.x, v.z[i] - p.z) + v.drop[i] * 100; if (d < bd) { bd = d; best = i; } }
  const w = { x: pos.getX(best), y: pos.getY(best), z: pos.getZ(best) };
  return { len: Math.hypot(w.x, w.y, w.z), x: p.x, z: p.z };
});
const state = () => page.evaluate(() => {
  const r = __exo.region, p = r.patch;
  const flora = [];
  r.flora?.group.traverse((o) => { if (o.isInstancedMesh) flora.push(o); });
  return {
    same: window.__samePage === true,
    indexed: !!p.geometry.index,
    textured: !!p.material.map,
    flatPatch: !!p.material.flatShading,
    floraFlat: flora.length ? !!flora[0].material.flatShading : null,
    floraNormals: flora.length ? flora.every((m) => !!m.geometry.getAttribute('normal')) : null,
    inScene: p.parent === __exo.scene,
    patches: __exo.scene.children.filter((o) => o.name === 'region-patch').length,
    fog: !!p.material.userData.fog,
    stored: localStorage.getItem('exo.look'),
  };
});
const before = await state();
const padBefore = await padGap();
check(padBefore !== null, 'a building pad is levelled into the ground');
check(!before.indexed && before.flatPatch && before.floraFlat === true, 'starts flat (faceted ground and plants)');

const toggle = async () => {
  await page.click('#b-menu');
  await page.click('[data-id="options"]');
  await page.waitForSelector('#options');
  await page.click('#options [data-id="look"]');
  await page.waitForTimeout(1500);
  const label = await page.evaluate(() => document.querySelector('#options [data-id="look"]').innerText);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  return label;
};
const label = await toggle();
const smooth = await state();
check(smooth.same, 'switching the look doesn\'t reload the page');
check(/SMOOTH/.test(label), `the Options row says SMOOTH (${label.replace(/\s+/g, ' ')})`);
check(smooth.indexed && smooth.textured && !smooth.flatPatch, 'the ground is rebuilt smooth and textured');
check(smooth.floraFlat === false && smooth.floraNormals === true, 'the plants are smooth-shaded (with normals)');
check(smooth.inScene && smooth.patches === 1, 'one ground mesh in the scene (the old one removed)');
check(smooth.fog === before.fog, 'fog of war carries over to the new ground');
check(smooth.stored === 'smooth', 'the choice is remembered');
// raycasts still hit the new ground (placing buildings, orders): the middle of the screen picks a point
const hit = await page.evaluate(() => __exo.region.pick({ x: 0, y: 0 }, __exo.cam.camera));
check(!!hit, `the new ground can be picked (${hit ? `${hit.x.toFixed(1)}, ${hit.z.toFixed(1)}` : 'nothing'})`);
const padSmooth = await padGap();
check(padBefore && padSmooth && Math.abs(padSmooth.len - padBefore.len) < 0.6, `the pad stays level in the new ground (${padBefore?.len.toFixed(2)} → ${padSmooth?.len.toFixed(2)})`);

await page.waitForTimeout(1000);
await toggle();
const flat = await state();
check(flat.same && !flat.indexed && flat.flatPatch && flat.floraFlat === true && flat.stored === 'flat', 'and back to flat, still the same page');

// the next visit opens with the remembered look
await page.evaluate(() => localStorage.setItem('exo.look', 'smooth'));
await page.goto(`${url}?title=0&intro=0&new=1&sw=0`, { timeout: 120000 });
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
check(await page.evaluate(() => !!__exo.region.patch.geometry.index), 'a new visit opens in the remembered look');
await page.evaluate(() => localStorage.removeItem('exo.look'));

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall look checks passed');
process.exit(failed ? 1 : 0);
