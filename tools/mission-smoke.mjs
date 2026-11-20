/**
 * Missions (content/missions): the Touchdown chain, objectives that stay met,
 * rewards, start/done events, story triggers on a mission, debug jump, saves
 * and the quiet catch-up for older saves (headless, the real sim); then the
 * GOALS panel and the editor's mission form and play test (browser).
 *   node tools/mission-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

function game() {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return { sim, log, m: () => sim.s.missions };
}
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
const build = (sim, kind, x, z) => sim.s.buildings.push({ id: sim.s.nextId++, kind, x, z, progress: 1, hp: C.buildings[kind].hp, on: true, powered: true });

// ---------- the chain ----------
const g = game();
steps(g.sim, 12);
check(g.m().active.join() === 'touchdown' && g.log.includes('Mission: Touchdown'), 'Touchdown starts when the colony deploys');
check(g.sim.snapshot().missions.active[0].marks.join() === 'false', 'the snapshot lists its objectives, none met');
build(g.sim, 'solar', 20, 0);
steps(g.sim, 12);
check(g.m().done.includes('touchdown') && g.log.includes('Mission complete: Touchdown'), 'a finished Solar Array completes Touchdown');
check(g.log.some((t) => t.startsWith('The cryo bank is stable')), 'its reward (a log line) runs');
check(g.m().active.join() === 'groundwork', 'Groundwork follows');
// objectives stay met: build a depot, then lose it
build(g.sim, 'depot', -26, 22);
build(g.sim, 'depot', 26, 22);
steps(g.sim, 12);
g.sim.s.buildings = g.sim.s.buildings.filter((b) => b.kind !== 'depot');
steps(g.sim, 12);
check(g.sim.snapshot().missions.active[0].marks[0] === true, 'an objective stays met (the depot was lost since)');
check(g.log.includes('✓ Build two Mining Depots on alloy deposits'), 'meeting an objective is logged');
const alloys = g.sim.s.alloys;
g.sim.s.drones.push({ ...g.sim.s.drones[0], id: g.sim.s.nextId++ });
build(g.sim, 'battery', 0, 22);
steps(g.sim, 12);
check(g.m().done.includes('groundwork') && g.sim.s.alloys >= alloys + 120, 'Groundwork done in any order; its 120-alloy reward paid');
check(g.sim.s.story.hint?.text.startsWith('Packs come from the edges'), 'its hint points at what comes next');
check(g.m().active.join() === 'first-night', 'First Night follows');

// ---------- events, story triggers, jump ----------
C.story['t-brief'] = { title: 'T-Brief', text: 'b', trigger: 'never' };
C.story['t-done'] = { title: 'T-Done', text: 'd', trigger: 'never' };
C.story['t-after'] = { title: 'T-After', text: 'a', trigger: 'mission', mission: 't-m' };
C.missions['t-m'] = { title: 'Test mission', objectives: [{ text: 'Have 3 drones', kind: 'drones', count: 3 }, { text: 'Set the flag', kind: 'flag', flag: 't-go' }], onStart: 't-brief', onDone: 't-done', rewards: [{ kind: 'flag', flag: 't-rewarded' }], after: 'beyond-the-ridge' };
const j = game();
steps(j.sim, 12);
j.sim.command({ type: 'debug', mission: 't-m' });
check(j.m().active.join() === 't-m', 'jump: only the jumped-to mission is under way');
check(['touchdown', 'groundwork', 'first-night', 'firstborn', 'beyond-the-ridge'].every((x) => j.m().done.includes(x)), 'jump: the missions before it count as done');
check(j.sim.s.story.inbox.includes('t-brief'), 'its start event fires');
j.sim.s.drones.push({ ...j.sim.s.drones[0], id: j.sim.s.nextId++ }, { ...j.sim.s.drones[0], id: j.sim.s.nextId++ });
steps(j.sim, 12);
check(j.sim.snapshot().missions.active[0].marks.join() === 'true,false', 'one objective met, one to go');
j.sim.story.effect({ kind: 'flag', flag: 't-go' });
steps(j.sim, 12);
check(j.m().done.includes('t-m') && j.sim.s.story.flags.includes('t-rewarded'), 'a flag objective completes it; reward effects run');
check(j.sim.s.story.inbox.includes('t-done'), 'its done event fires');
steps(j.sim, 12);
check(j.sim.s.story.fired.includes('t-after'), 'a story event triggered by the mission fires');

// ---------- saves ----------
const saved = JSON.parse(JSON.stringify(g.sim.s));
const l = game();
l.sim.load(JSON.parse(JSON.stringify(saved)));
check(l.m().active.join() === 'first-night' && l.m().done.length === 2, 'a save keeps missions and progress');
const old = JSON.parse(JSON.stringify(saved));
delete old.missions;
l.log.length = 0;
l.sim.load(old);
check(l.m().done.includes('touchdown') && l.m().active.join() === 'groundwork', 'an older save catches up on what still stands (its depot is gone, so Groundwork is under way)');
check(!l.log.some((t) => t.startsWith('Mission')), 'and quietly (nothing logged)');
for (const k of ['t-brief', 't-done', 't-after']) delete C.story[k];
delete C.missions['t-m'];

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? `http://localhost:${process.env.PORT ?? 5176}/`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}?intro=0&new=1&title=0&scratch=1`);
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.missions.active.length, null, { timeout: 300000 });
  await page.waitForTimeout(800);
  check((await page.textContent('#goals-head')) === 'TOUCHDOWN', 'GOALS shows the mission under way');
  check((await page.textContent('#goals-list li.now')).includes('Solar Array'), 'and its objective');
  await page.evaluate(() => __exo.sim.command({ type: 'debug', mission: 'firstborn' }));
  await page.waitForFunction(() => document.getElementById('goals-head').textContent === 'FIRSTBORN', null, { timeout: 20000 });
  check((await page.locator('#goals-list li').count()) === C.missions.firstborn.objectives.length, 'jumping to Firstborn shows its objectives');

  await page.goto(`${url}editor.html#missions/groundwork.json`);
  await page.waitForSelector('#story-sum div');
  const sum = await page.textContent('#story-sum');
  check(/Starts when “touchdown” is complete/.test(sum) && /Followed by: first-night/.test(sum), 'editor: the summary says what it follows and what follows it');
  check(/Reward: add 120 alloys/.test(sum), 'editor: and its rewards');
  // objectives: the condition picks the fields
  const last = page.locator('.row[data-key=objectives] .item-card').last();
  check(await last.locator('[data-item$=".building"]').count() === 1 && await last.locator('[data-item$=".sol"]').count() === 0, 'editor: a "built" objective shows Building, not Sol');
  const [game2] = await Promise.all([ctx.waitForEvent('page'), page.click('.story-panel button.primary')]);
  await game2.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.missions.active.some((m) => m.id === 'groundwork'), null, { timeout: 300000 });
  check(await game2.evaluate(() => __exo.sim.cur.missions.done.includes('touchdown')), 'play test: starts at the mission, the one before it done');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall mission checks passed');
process.exit(failed ? 1 : 0);
