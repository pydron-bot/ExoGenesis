/**
 * Story events (content/story): triggers, cards, choices, effects, flags,
 * chains, saves (headless, the real sim); then the editor's story form, card
 * preview and play test, and the game's story card (browser, dev server).
 *   node tools/story-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
const SOL = C.colony.solSeconds;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

function game() {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return { sim, log, st: () => sim.s.story };
}
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

// ---------- the shipped events ----------
const a = game();
steps(a.sim, 15);
check(!a.st().fired.includes('director-briefing'), 'the briefing waits out its 2 s delay');
steps(a.sim, 15);
check(a.st().inbox[0] === 'director-briefing' && a.log.includes('Mission Briefing'), 'the briefing fires at deploy and waits in the inbox');
check(a.st().flags.includes('briefed'), 'its "when it fires" effect sets a flag');
check(a.sim.snapshot().story.inbox[0] === 'director-briefing', 'the snapshot carries the inbox');
a.sim.command({ type: 'story', id: 'director-briefing', choice: 0 });
check(!a.st().inbox.length && a.st().answered.includes('director-briefing'), 'Continue answers it');
a.sim.command({ type: 'story', id: 'director-briefing', choice: 0 });
steps(a.sim, 20);
check(a.st().fired.filter((x) => x === 'director-briefing').length === 1, 'an event fires once');

// site trigger: a drone at the carved stone
const d = a.sim.s.drones[0];
d.x = 88; d.z = 30; d.task = { kind: 'idle' }; d.manual = true;
steps(a.sim, 12);
check(a.st().inbox.includes('the-stone'), 'reaching the east-stone site fires The Stone');
a.sim.command({ type: 'story', id: 'the-stone', choice: 0 });
check(a.st().flags.includes('stone-found') && a.st().flags.includes('stone-scanned'), 'choice 1 sets its flag (and the always-flag)');
check(a.log.some((t) => t.startsWith('Second scan')), 'the choice\'s reply is logged');

// time trigger
steps(a.sim, Math.round(SOL * 0.5 * 10) + 20);
check(a.st().fired.includes('first-night'), 'First Night fires at Sol 1.5');

// colonists trigger + delay, stance effect
const q = game();
q.sim.command({ type: 'debug', people: { colonists: 1, stance: 50, wb: 50, biomass: 300 } });
steps(q.sim, 140 * 10);
check(!q.st().fired.includes('first-question'), 'First Question waits out its delay');
steps(q.sim, 20 * 10);
check(q.st().inbox.includes('first-question'), 'then fires');
const before = q.sim.s.people.colonists.map((c) => c.stance);
q.sim.command({ type: 'story', id: 'first-question', choice: 0 });
const after = q.sim.s.people.colonists.map((c) => c.stance);
check(after.every((v, i) => Math.abs(v - (before[i] + 4)) < 1), `"Tell the truth" shifts stance +4 (${before[0].toFixed(1)} → ${after[0].toFixed(1)})`);

// ---------- chains, flags, unless, effects (test events) ----------
C.story['t-a'] = { title: 'T-A', text: 'a', trigger: 'never', choices: [{ label: 'One' }, { label: 'Two' }], effects: [
  { after: 1, kind: 'alloys', amount: 100 }, { after: 2, kind: 'flag', flag: 't-two' }, { after: 2, kind: 'event', event: 't-c' } ] };
C.story['t-b'] = { title: 'T-B', text: 'b', trigger: 'after', event: 't-a' };
C.story['t-c'] = { title: 'T-C', text: 'c', trigger: 'never', effects: [{ after: 0, kind: 'pack' }, { after: 0, kind: 'regard', group: 'vell', amount: -10 }] };
C.story['t-d'] = { title: 'T-D', text: 'd', trigger: 'flag', flag: 't-two', unless: 't-block' };
C.story['t-e'] = { title: 'T-E', text: 'e', trigger: 'flag', flag: 't-two', unless: 'briefed' };
const t = game();
steps(t.sim, 40);
t.sim.command({ type: 'debug', story: 't-a' });
check(t.st().inbox.includes('t-a'), 'a "never" event fires only when started (debug / an event effect)');
const al = t.sim.s.alloys, reg = t.sim.s.camps[0].regard;
t.sim.command({ type: 'story', id: 't-a', choice: 1 });
check(t.sim.s.alloys === al && t.st().flags.includes('t-two'), 'choice 2 runs only its own effects');
check(t.st().inbox.includes('t-c') && t.sim.s.waves.next === t.sim.s.tick && t.sim.s.camps[0].regard === reg - 10, 'an event effect starts another (pack now, regard −10)');
steps(t.sim, 12);
check(t.st().fired.includes('t-b'), '"after" fires once the event is answered');
check(t.st().fired.includes('t-d') && !t.st().fired.includes('t-e'), 'a flag trigger fires; "unless" blocks one');

// ---------- saves ----------
const saved = JSON.parse(JSON.stringify(t.sim.s));
const l = game();
l.sim.load(saved);
check(l.st().flags.includes('t-two') && l.st().fired.includes('t-a') && l.st().inbox.length === t.st().inbox.length, 'a save keeps fired events, flags and the inbox');
const old = JSON.parse(JSON.stringify(saved)); delete old.story;
l.sim.load(old);
check(Array.isArray(l.st().fired) && l.st().fired.length === 0, 'an older save starts the story fresh');
for (const k of ['t-a', 't-b', 't-c', 't-d', 't-e']) delete C.story[k];

// ---------- browser: editor + game ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? 'http://localhost:5176/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}editor.html#story/the-stone.json`);
  await page.waitForSelector('#story-card .t');
  check((await page.textContent('#story-card .t')) === 'The Stone', 'editor: the story form shows a card preview');
  check(await page.isVisible('.row[data-key=site]') && !(await page.isVisible('.row[data-key=sol]')), 'editor: only the trigger\'s own fields show');
  await page.selectOption('.row[data-key=trigger] select', 'time');
  check(await page.isVisible('.row[data-key=sol]') && !(await page.isVisible('.row[data-key=site]')), 'editor: changing the trigger swaps the fields');
  check(/required when trigger is time/.test(await page.textContent('.row[data-key=sol] .issue')), 'editor: a needed field is flagged');
  await page.selectOption('.row[data-key=trigger] select', 'site');
  const cards = () => page.locator('.row[data-key=choices] .item-card').count();
  const n0 = await cards();
  await page.click('.row[data-key=choices] .list-ctl > button');
  check(await cards() === n0 + 1, 'editor: + Add choice adds a card');
  await page.fill('.row[data-key=choices] .item-card >> nth=-1 >> input[type=text] >> nth=0', 'Take a sample');
  check((await page.locator('#story-card button').allTextContents()).includes('Take a sample'), 'editor: the preview follows the edit');
  await page.click('.row[data-key=effects] .list-ctl > button');
  const eff = page.locator('.row[data-key=effects] .item-card').last();
  const kindSel = eff.locator('[data-item$=".kind"] select');
  await kindSel.selectOption('alloys');
  check(await page.locator('.row[data-key=effects] .item-card').last().locator('[data-item$=".amount"]').count() === 1, 'editor: an effect shows only its own fields (alloys → Amount)');
  check(/add .* alloys/.test(await page.textContent('#story-sum')), 'editor: the summary describes the new effect');
  // play test the edited (unsaved) event
  const [game2] = await Promise.all([ctx.waitForEvent('page'), page.click('.story-panel button.primary')]);
  await game2.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 300000 });
  await game2.waitForSelector('#contact.on .t', { timeout: 60000 });
  check((await game2.textContent('#contact .t')) === 'The Stone', 'play test: the event fires straight away');
  check((await game2.locator('#contact button').allTextContents()).includes('Take a sample'), 'play test: with the unsaved edits');
  await game2.click('#contact button:has-text("Take a sample")');
  await game2.waitForTimeout(800);
  check(!(await game2.isVisible('#contact.on')), 'game: answering closes the card');
  check(!(await game2.evaluate(() => window.__exo.sim.cur.story.inbox.includes('the-stone'))), 'game: and the sim takes it out of the inbox');
  // a pausing event pauses
  await game2.goto(`${url}?intro=0&new=1&title=0&scratch=1&story=director-briefing`);
  await game2.waitForSelector('#contact.on .t', { timeout: 300000 });
  check(await game2.evaluate(() => document.getElementById('b-pause').classList.contains('on')), 'game: a pausing event pauses the game');
  await game2.click('#contact button:has-text("Continue")');
  await game2.waitForTimeout(500);
  check(await game2.evaluate(() => document.getElementById('b-play').classList.contains('on')), 'game: and play resumes when it closes');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall story checks passed');
process.exit(failed ? 1 : 0);
