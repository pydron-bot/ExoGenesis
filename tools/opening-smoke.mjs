/**
 * The campaign opening (TECH §6 "Opening pace"): headless, the tutorial bot at a human pace
 * reaches each beat in time (tools/opening.mjs measures the same); then in the browser a
 * fresh colony starts with the opening's alloys, and finishing Touchdown pays out and points
 * at what's next.
 *   node tools/opening-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 *   (PORT=5176 picks the dev server's port when --url isn't given)
 */
import path from 'node:path';
import { launch } from './lib/harness.mjs';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: P } = await runnerImport(path.join(root, 'src/sim/playthrough.ts'));
const { content: C } = (await runnerImport(path.join(root, 'src/content/index.ts'))).module;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- headless: the tutorial at a human pace ----------
const m = {};
const r = P.runPlaythrough({ strategy: 'opening', minutes: 20, seed: 1337, pace: 8, anywhere: true, onTick: (sim, tick) => {
  if (tick % 10) return;
  const s = sim.s, t = sim.secs;
  if (s.stats.kills > 0) m.kill ??= t;
  if (s.people?.colonists.length) m.colonist ??= t;
  for (const id of ['groundwork', 'first-night', 'firstborn']) if (s.missions?.done.includes(id)) m[id] ??= t;
} });
check(C.regions.touchdown.startAlloys === 360 && C.regions.touchdown.graceSeconds === 240, 'Touchdown starts with 360 alloys and the first pack after 4 min');
check(m.groundwork < 90, `Groundwork done in the first 1.5 min (${Math.round(m.groundwork)} s)`);
check(m.kill > 200 && m.kill < 300, `first kill between 3:20 and 5:00 (${Math.round(m.kill)} s)`);
check(m['first-night'] < 330, `First Night done by 5:30 (${Math.round(m['first-night'])} s)`);
check(m.colonist < 540, `first colonist by 9:00 (${Math.round(m.colonist)} s): the first pod is primed (${C.people.firstPodSols} sol)`);
check(!r.over, `the tutorial colony is still standing at 20 min${r.over ? ` (lost: ${r.over} at ${r.at.toFixed(1)})` : ''}`);

// the first pod is quicker, the second isn't
{
  const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
  const sim = new M.Sim(() => {});
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  sim.s.buildings.push({ id: sim.s.nextId++, kind: 'civic', x: 20, z: 0, progress: 1, hp: M.content.buildings.civic.hp, on: true, powered: true });
  sim.s.buildings.push({ id: sim.s.nextId++, kind: 'solar', x: -20, z: 0, progress: 1, hp: 100, on: true, powered: true }, { id: sim.s.nextId++, kind: 'solar', x: -20, z: 12, progress: 1, hp: 100, on: true, powered: true });
  const civic = sim.s.buildings.find((b) => b.kind === 'civic');
  sim.command({ type: 'grow', id: civic.id, specialty: 'engineer', curriculum: 'charter' });
  sim.command({ type: 'grow', id: civic.id, specialty: 'botanist', curriculum: 'charter' });
  const pods = sim.s.people.pods;
  check(pods.length === 2 && pods[0].first === true && !pods[1].first, 'only the colony\'s first pod is primed');
  for (let i = 0; i < 300; i++) sim.step();
  check(pods[0].progress > pods[1].progress * 1.8, `it grows twice as fast (${pods[0].progress.toFixed(2)} vs ${pods[1].progress.toFixed(2)} after 30 s)`);
}

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? `${process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 5176}/`}`;
  const browser = await launch();
  for (const vp of [{ width: 1400, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?intro=0&new=1&title=0&sw=0&scratch=1`);
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.missions.active.length, null, { timeout: 300000 });
    check(await page.evaluate(() => Math.round(__exo.sim.cur.alloys) >= 340), `${vp.name}: a new colony has the opening's alloys`);
    // finish Touchdown: a Solar Array by the Core
    await page.evaluate(() => {
      for (const [x, z] of [[16, 8], [-16, 8], [14, -14], [-14, -14], [20, 0], [0, 20]]) if (!__exo.canPlace || __exo.canPlace('solar', x, z) === null) { __exo.sim.command({ type: 'build', kind: 'solar', x, z }); return; }
    });
    await page.waitForFunction(() => __exo.sim.cur?.missions.active.some((x) => x.id === 'groundwork'), null, { timeout: 120000 });
    await page.waitForSelector('#hint.on', { timeout: 20000 });
    const hint = await page.textContent('#hint');
    check(/Mining Depots/.test(hint), `${vp.name}: Touchdown done, a hint points at the depots ("${hint.trim()}")`);
    const goals = await page.textContent('#goals-list');
    check(/two Mining Depots/.test(goals), `${vp.name}: GOALS lists Groundwork's two depots`);
    check(!errs.length, `${vp.name}: no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall opening checks passed');
process.exit(failed ? 1 : 0);
