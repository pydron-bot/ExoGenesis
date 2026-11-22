/**
 * Autopilot (spectator mode, TECH.md "Autopilot"): the computer plays the campaign while you watch.
 *
 * Headless (the real sim and content): the balance bot as a class still plays the playthrough as before
 * (tutorial missions done at the same seconds as before the refactor); `pickChoice` per policy; the live brain
 * (`Autopilot`, src/sim/autopilot.ts) on a fresh Touchdown builds, chases the tutorials and says what it does,
 * does nothing while off or before the colony deploys; travel: with no mission here and one under way in a routed
 * region it sets `travel` (home → overland; an expedition → home), not while a card waits; assist ticks off a stuck
 * objective (logged) and sends away a pack at a falling Core; off: neither.
 *
 * Browser (a dev server, default http://localhost:5176/; `--url`): a fresh colony, then the title's Options →
 * "Watch the computer play" (CONTINUE with the autopilot): the AUTOPILOT badge, buildings going up with no input, a
 * story card answered by the bot (the chosen button lit first), the camera moving on its own, ×3 from the badge,
 * Stop hands control back (nothing more built), the game menu turns it on again; a travel round trip (a mission on
 * an Act 1 region jumped to): the reload keeps it on, it plays there and comes home on its own, still on. No page
 * errors.
 *   node tools/autopilot-smoke.mjs [--headless-only] [--url http://localhost:5176/]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
const HZ = 10;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; return ok; };

// ---------- headless ----------
{
  // the playthrough on the refactored bot: the tutorials finish when they did before (tools/playthrough.mjs)
  const r = M.runPlaythrough({ minutes: 17, peaceful: true, policy: 'first' });
  const done = Object.fromEntries(Object.entries(r.missions).filter(([, m]) => m.done !== undefined).map(([id, m]) => [id, m.done]));
  check(done.touchdown === 9 && done.groundwork === 150 && done['first-night'] === 958 && done.firstborn === 958, `playthrough as before: touchdown 0:09, groundwork 2:30, first-night and firstborn 15:58 (${JSON.stringify(done)})`);
}
{
  const r = () => 0.99;
  check(M.pickChoice('first', [1, 2], ['a', 'b', 'c'], r) === 1, 'pickChoice first: the first offered');
  check(M.pickChoice('last', [0, 2], ['a', 'b', 'c'], r) === 2, 'pickChoice last');
  check(M.pickChoice('random', [0, 1, 2], ['a', 'b', 'c'], r) === 2, 'pickChoice random');
  check(M.pickChoice('honest', [0, 1, 2], ['Lie to them', 'Tell them the truth', 'Say nothing'], r) === 1, 'pickChoice honest: "Tell them the truth"');
  check(M.pickChoice('honest', [0, 2], ['Lie', 'Tell', 'Run'], r) === 0, 'pickChoice honest: none honest → the first offered');
}
/** A fresh Touchdown with the autopilot (on unless said). */
function game(region = 'touchdown', cfg = { on: true }) {
  M.useRegion(region);
  const said = [];
  const sim = new M.Sim(() => {});
  const ap = new M.Autopilot(sim, (t) => said.push(t));
  ap.configure(cfg);
  return { sim, ap, said, s: sim.s, run: (secs) => { for (let i = 0; i < secs * HZ; i++) { ap.tick(); sim.step(); } } };
}
{
  const g = game();
  g.run(20);
  check(g.s.buildings.length === 1, 'before the colony deploys the autopilot does nothing');
  g.sim.command({ type: 'landing', stage: 'deploy' });
  g.s.waves.next = 1e12;
  const statuses = new Set();
  for (let i = 0; i < 60; i++) {
    g.run(5);
    for (const id of [...g.s.story.inbox]) g.sim.command({ type: 'story', id, choice: 0 }); // (the renderer reads the cards)
    for (const id of [...(g.s.story.cineQueue ?? [])]) g.sim.command({ type: 'cinematic', id, done: true });
    statuses.add(g.ap.status().doing);
  }
  const kinds = g.s.buildings.map((b) => b.kind);
  check(kinds.length >= 8 && kinds.includes('depot') && kinds.includes('solar'), `5 min: it builds (${kinds.join(', ')})`);
  check(g.s.missions.done.includes('touchdown') && g.s.missions.done.includes('groundwork'), `the first tutorials done (${g.s.missions.done})`);
  check([...statuses].some((t) => /^Building an? /.test(t)), `it says what it does (${[...statuses].slice(0, 5).join(' · ')})`);
  const st = g.ap.status();
  check(!!st.core && (!!st.build || true), 'its status has the Core to look at');
  check(!g.s.travel, 'no travel while the tutorials are under way here');
}
{
  // off: nothing
  const g = game('touchdown', { on: false });
  g.sim.command({ type: 'landing', stage: 'deploy' });
  g.run(60);
  check(g.s.buildings.length === 1, 'off: it builds nothing');
}
{
  // travel: home, a mission under way on a routed Act 1 region and none here → it goes (overland), after its grace
  const g = game();
  g.sim.command({ type: 'landing', stage: 'deploy' });
  g.s.waves.next = 1e12;
  g.sim.command({ type: 'debug', mission: 'the-hollow' }); // routes splinter-hollow (and asks to travel: undone)
  delete g.s.travel;
  for (const id of [...g.s.missions.active]) if (id !== 'the-hollow') g.sim.command({ type: 'inspect', finish: id });
  g.s.story.inbox.length = 0;
  g.run(60);
  check(!g.s.travel, 'travel waits for the grace after arrival (90 s at home)');
  g.s.story.inbox.push(Object.keys(C.story)[0]);
  g.run(40);
  check(!g.s.travel, 'not while a card waits');
  g.s.story.inbox.length = 0;
  g.run(10);
  check(g.s.travel === 'splinter-hollow', `then it travels to the mission's region (${g.s.travel})`);
  check(/^Travelling to /.test(g.ap.status().doing), `and says so (${g.ap.status().doing})`);
}
{
  // an expedition with nothing left to do here goes home
  const g = game('choir-field');
  g.sim.command({ type: 'landing', stage: 'deploy' });
  g.s.waves.next = 1e12;
  g.s.missions.active = [];
  for (let i = 0; i < 12 && !g.s.travel; i++) {
    g.run(5);
    for (const id of [...(g.s.story.cineQueue ?? [])]) g.sim.command({ type: 'cinematic', id, done: true });
    for (const id of [...g.s.story.inbox]) g.sim.command({ type: 'story', id, choice: 0 });
  }
  check(g.s.travel === M.HOME_REGION, `an expedition with its missions done goes home (${g.s.travel})`);
}
{
  // assist: an objective here with no progress is ticked off after the limit, logged; off: not
  for (const assist of [true, false]) {
    const g = game('touchdown', { on: true, assist, assistMinutes: 0.5 });
    g.sim.command({ type: 'landing', stage: 'deploy' });
    g.s.waves.next = 1e12;
    // first-night waits for a pack beaten, and none comes (waves held off)
    g.sim.command({ type: 'debug', mission: 'first-night' });
    delete g.s.travel;
    const marks = () => g.s.missions.marks['first-night']?.length ?? 0;
    const before = marks();
    for (let i = 0; i < 24; i++) { g.s.story.inbox.length = 0; g.run(10); }
    if (assist) check(marks() > before && g.said.some((t) => t.startsWith('Autopilot assist: ')), `assist: a stuck objective ticked off (${before} → ${marks()}; "${g.said[0]}")`);
    else check(!g.said.length, 'no assist when it is off');
  }
  // a pack at a falling Core
  const g = game('touchdown', { on: true, assist: true });
  g.sim.command({ type: 'landing', stage: 'deploy' });
  g.run(1);
  const core = g.s.buildings.find((b) => b.kind === 'core');
  g.sim.command({ type: 'debug', spawn: { unit: Object.keys(C.units).find((k) => C.units[k].faction !== 'accord' && !C.units[k].relic && k !== 'nest') ?? 'swarmer', x: core.x + 12, z: core.z, n: 4 } });
  core.hp = C.buildings.core.hp * 0.2;
  const n0 = g.s.hostiles.length;
  g.run(3);
  check(n0 > 0 && g.s.hostiles.length < n0 && g.said.some((t) => /sent away/.test(t)), `assist: a pack at a falling Core sent away (${n0} → ${g.s.hostiles.length})`);
}

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const { chromium } = await import('playwright');
  const url = arg('--url', 'http://localhost:5176/');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed && !window.__exo.title, null, { timeout: 120000 });
  const kinds = () => page.evaluate(() => __exo.sim.cur.buildings.map((b) => b.kind));
  const ap = () => page.evaluate(() => ({ on: __exo.autopilot?.on, badge: getComputedStyle(document.getElementById('autopilot')).display !== 'none', cap: document.querySelector('#autopilot .ap-cap')?.textContent ?? '', region: __exo.sim.cur?.campaign?.here, stored: JSON.parse(localStorage.getItem('exo.autopilot') ?? '{}') }));
  try {
    // a fresh colony (autosaved), then the title: Options → Watch the computer play
    await page.goto(`${url}?intro=0&new=1&sw=0`);
    await ready();
    await page.evaluate(() => __exo.sim.flush());
    await page.waitForTimeout(1500);
    await page.goto(`${url}?sw=0`);
    await page.waitForFunction(() => window.__exo?.title && document.body.innerText.includes('OPTIONS'), null, { timeout: 120000 });
    check(!(await ap()).badge, 'the title: no badge');
    await page.getByText('OPTIONS', { exact: true }).click();
    await page.waitForSelector('#options [data-id="ap:watch"]');
    check(true, 'Options has "Watch the computer play"');
    await page.click('#options [data-id="ap:speed:3"]');
    await page.click('#options [data-id="ap:watch"]');
    await ready();
    let a = await ap();
    check(a.on && a.badge && a.stored.on === true && a.stored.speed === 3, `the AUTOPILOT badge shows, on and remembered (${JSON.stringify(a.stored)})`);
    const k0 = (await kinds()).length;
    const cam0 = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz, __exo.cam.targetDist]);
    // a card answered: the tutorial's briefings come one after another
    // a card with choices fired now; the bot reads it, lights its choice, then presses it
    const ask = Object.entries(C.story).find(([, e]) => (e.choices?.length ?? 0) >= 2 && (!e.region || e.region === 'touchdown') && e.style !== 'radio' && !e.lines?.length && !e.choices.some((c) => c.ifFlag))[0];
    const n0 = await page.evaluate(() => __exo.autopilot.answered.length);
    await page.evaluate((id) => __exo.sim.command({ type: 'debug', story: id }), ask);
    const lit = await page.waitForFunction(() => document.querySelector('#contact .ap-pick'), null, { timeout: 120000 }).then(() => true, () => false);
    const answered = await page.waitForFunction((n) => __exo.autopilot.answered.length > n && !(__exo.sim.cur.story.inbox.length && document.querySelector('#contact .ap-pick')), n0, { timeout: 60000 }).then(() => true, () => false);
    await page.waitForFunction((id) => !__exo.sim.cur.story.inbox.includes(id), ask, { timeout: 120000 }).catch(() => {});
    const said = await page.evaluate(() => __exo.autopilot.answered.slice(-3));
    const inbox = await page.evaluate(() => __exo.sim.cur.story.inbox.join(','));
    check(lit && answered && (await page.evaluate((id) => !__exo.sim.cur.story.inbox.includes(id), ask)), `story cards answered by the bot, the choice lit first (${ask}: lit ${lit}, ${said.join(' · ')}; waiting: ${inbox || 'none'})`);
    await page.waitForFunction((n) => __exo.sim.cur.buildings.length > n, k0, { timeout: 120000 }).catch(() => {});
    const k1 = (await kinds()).length;
    check(k1 > k0, `buildings go up without input (${k0} → ${k1})`);
    const cam1 = await page.evaluate(() => [__exo.cam.fx, __exo.cam.fz, __exo.cam.targetDist]);
    check(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1]) > 2 || Math.abs(cam1[2] - cam0[2]) > 5, `the camera moves on its own (${cam0.map((x) => x.toFixed(0))} → ${cam1.map((x) => x.toFixed(0))})`);
    a = await ap();
    check(a.cap.length > 0, `a caption says what it is doing ("${a.cap}")`);
    // Stop: control back at once
    await page.click('#autopilot .ap-stop');
    a = await ap();
    check(!a.on && !a.badge && a.stored.on === false, 'Stop: the badge goes, off and remembered off');
    const k2 = (await kinds()).length;
    await page.waitForTimeout(12000);
    check((await kinds()).length === k2, 'nothing more is built after Stop');
    // the game menu turns it on again
    await page.click('#b-menu');
    await page.click('#options [data-id="autopilot"]');
    await page.waitForTimeout(500);
    a = await ap();
    check(a.on && a.badge, 'the game menu turns it on again');
    // a travel round trip: a mission on an Act 1 region, jumped to (the game travels there to play it)
    await page.evaluate(() => __exo.sim.command({ type: 'debug', mission: 'the-hollow' }));
    await page.waitForFunction(() => location.search.includes('region=splinter-hollow') && window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 120000, polling: 500 }).catch(() => {});
    await ready();
    a = await ap();
    check(a.region === 'splinter-hollow' && a.on && a.badge, `travelled to Splinter Hollow with the autopilot still on (${a.region}, ${a.on})`);
    // it plays the region (cards, the mission), then comes home by itself
    await page.waitForFunction(() => location.search.includes('region=touchdown') && window.__exo?.ready && window.__exo.sim.cur?.deployed && window.__exo.sim.cur.campaign?.here === 'touchdown', null, { timeout: 300000, polling: 1000 }).catch(() => {});
    await ready();
    a = await ap();
    check(a.region === 'touchdown' && a.on && a.badge, `home again on its own, still on (${a.region}, ${a.on})`);
  } catch (e) {
    check(false, `browser: ${e.message.split('\n')[0]}`);
  }
  check(!errors.length, `no page errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
