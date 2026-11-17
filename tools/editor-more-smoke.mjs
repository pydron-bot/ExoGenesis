/**
 * Editor tools, part 2: map overlays and copy / paste, the Planet page, balance
 * test runs, play test setup, characters and conversations (and radio
 * messages in game), the landing's timeline, and Rules → Interface.
 * Headless checks first (content rules, the camera curve), then the dev
 * editor and game. Writes temporary story events and removes them.
 *   node tools/editor-more-smoke.mjs [--url http://localhost:5176/]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: D } = await runnerImport(path.join(root, 'src/content/db.ts'));
const { module: Cv } = await runnerImport(path.join(root, 'src/world/curve.ts'));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- headless ----------
async function contentFiles() {
  const out = {};
  const walk = async (sub) => {
    for (const e of await fs.readdir(path.join(root, 'content', sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(rel);
      else if (e.name.endsWith('.json')) out[rel] = JSON.parse(await fs.readFile(path.join(root, 'content', rel), 'utf8'));
    }
  };
  await walk('');
  return out;
}
const base = await contentFiles();
check(D.buildDb(base).issues.length === 0, 'content as committed has no problems');
const bad = structuredClone(base);
bad['story/zz.json'] = { title: 'Z', style: 'radio', text: 'x', trigger: 'never', choices: [{ label: 'a' }] };
bad['cinematics/landing.json'].open = 3; // before touchdown
bad['characters/zz.json'] = { name: 'Z', color: '#ffffff', portrait: 'exo-tank' };
const msgs = D.buildDb(bad).issues.map((i) => `${i.path} ${i.field}: ${i.msg}`);
check(msgs.some((m) => m.startsWith('story/zz.json choices: a radio message')), 'a radio message with choices is a problem');
check(msgs.some((m) => m.startsWith('cinematics/landing.json open: comes before')), 'landing beats must stay in order');
check(msgs.some((m) => m.startsWith('characters/zz.json portrait')), 'a portrait must be an image');
const X = [0, 1, 2, 3], Y = [0, 1, 1, 3];
let mono = true;
for (let t = 0; t <= 3; t += 0.05) { const v = Cv.pchip(X, Y, t); if (t >= 1 && t <= 2 && Math.abs(v - 1) > 1e-9) mono = false; }
check(mono && Cv.pchip(X, Y, 0) === 0 && Cv.pchip(X, Y, 3) === 3, 'camera curve passes through keys and never overshoots');

// ---------- the pages ----------
const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? 'http://localhost:5176/';
const tmp = { talk: path.join(root, 'content/story/zz-talk.json'), radio: path.join(root, 'content/story/zz-radio.json') };
await fs.writeFile(tmp.talk, JSON.stringify({ title: 'Zed Talk', character: 'director', text: 'One.', lines: [{ character: 'firstborn', text: 'Two, from {first}.' }, { speaker: 'A voice', text: 'Three.' }], trigger: 'never', choices: [{ label: 'Okay' }] }, null, 2) + '\n');
await fs.writeFile(tmp.radio, JSON.stringify({ title: 'Zed Radio', style: 'radio', character: 'director', text: 'A transmission long enough to stay on the screen for a good while, so the test can see it.', trigger: 'never' }, null, 2) + '\n');
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const game = async (fn) => {
  const [g] = await Promise.all([ctx.waitForEvent('page'), fn()]);
  g.on('pageerror', (e) => errs.push(`game: ${e.message}`));
  return g;
};
try {
  // map overlays, copy and paste
  await page.goto(`${url}editor.html#regions/touchdown.json`);
  await page.waitForSelector('[data-overlay=paths]');
  await page.check('[data-overlay=paths]');
  check(/Spawn 1: \d+ s to the Core/.test(await page.textContent('#pack-paths')), 'map: the pack path overlay times each spawn');
  const pasted = await page.evaluate(() => {
    const m = window.__editor.map, n = m.count('deposits');
    m.area = { x0: -60, z0: -60, x1: 60, z1: 60 };
    const clip = m.copyArea();
    m.pasteArea(0, 0);
    return { copied: clip.markers.deposits?.length ?? 0, now: m.count('deposits') - n, dirty: window.__editor.dirty() };
  });
  check(pasted.copied > 0 && pasted.now === pasted.copied, `map: copy and paste an area brings its markers (${pasted.copied})`);
  await page.evaluate(() => document.activeElement?.blur()); // keys typed into a checkbox aren't the map's
  await page.keyboard.press('Control+z');
  check(await page.evaluate(() => window.__editor.map.count('deposits') === window.__editor.cur.saved.deposits.length), 'map: and undo takes the paste back');
  await page.uncheck('[data-overlay=paths]');
  if (await page.isEnabled('#revert')) await page.click('#revert');

  // planet
  await page.goto(`${url}editor.html#planet`);
  await page.waitForFunction(() => document.querySelector('.planet-readout')?.textContent.startsWith('Hover'), null, { timeout: 30000 });
  check((await page.textContent('.planet-list')).includes('Touchdown'), 'planet: lists the regions');

  // balance test run (one short strategy)
  await page.goto(`${url}editor.html#balance`);
  await page.waitForSelector('.bal-runner');
  await page.evaluate(() => { for (const b of document.querySelectorAll('.bal-picks input')) if (b.checked) b.click(); });
  await page.locator('.bal-picks label:has-text("balanced") input').check();
  await page.fill('.bal-opts input >> nth=0', '3');
  await page.locator('.bal-opts input >> nth=0').dispatchEvent('change');
  await page.click('.bal-runner button.primary');
  await page.waitForSelector('.bal-run', { timeout: 60000 });
  check(/balanced Survived 3 min/.test(await page.textContent('.bal-run-head')), 'balance: a test run plays the strategy and reports');

  // play test setup → the game starts further in
  await page.goto(`${url}editor.html#story/the-stone.json`);
  await page.waitForSelector('details.setup');
  await page.click('details.setup summary');
  await page.check('details.setup .check input >> nth=0');
  await page.fill('details.setup .setup-num >> nth=0', '2');
  await page.click('details.setup .setup-builds button:has-text("Solar Array")');
  const g1 = await game(() => page.click('.story-panel button.primary'));
  await g1.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed && window.__exo.sim.cur.buildings.length > 1, null, { timeout: 300000 });
  const st = await g1.evaluate(() => ({ tick: window.__exo.sim.cur.tick, kinds: window.__exo.sim.cur.buildings.map((b) => b.kind) }));
  check(st.kinds.includes('solar') && st.tick > 1000, `setup: starts on Sol 2 with a Solar Array (${st.kinds.join(', ')})`);
  await g1.close();
  await page.click('details.setup .check input >> nth=0'); // off again for the next tests

  // characters
  await page.goto(`${url}editor.html#characters/director.json`);
  await page.waitForSelector('#char-lines .char-line');
  check((await page.textContent('#char-lines')).includes('Mission Briefing'), 'characters: lists the lines they speak');
  await page.goto(`${url}editor.html#story/zz-talk.json`);
  await page.waitForSelector('#story-card .story-page');
  check(await page.locator('#story-card .story-page').count() === 3, 'story: the preview shows each line of a conversation');

  // in game: the conversation and a radio message
  const g2 = await ctx.newPage();
  g2.on('pageerror', (e) => errs.push(`game: ${e.message}`));
  await g2.goto(`${url}?intro=0&new=1&title=0&scratch=1&story=zz-talk`);
  await g2.waitForSelector('#contact.on .t', { timeout: 300000 });
  check((await g2.textContent('#contact .who')).includes('The Director'), 'game: a character speaks the card');
  await g2.click('#contact button:has-text("Next")');
  await g2.click('#contact button:has-text("Next")');
  check((await g2.textContent('#contact')).includes('Three.') && await g2.isVisible('#contact button:has-text("Okay")'), 'game: Next steps through the lines, the choices come last');
  await g2.evaluate(() => window.__exo.sim.command({ type: 'debug', story: 'zz-radio' }));
  await g2.waitForSelector('#radio.on', { timeout: 5000 });
  check((await g2.textContent('#radio')).includes('Zed Radio') && !(await g2.textContent('#contact')).includes('Zed Radio'), 'game: a radio message shows in its own panel');
  await g2.click('#radio');
  await g2.waitForTimeout(600);
  check(!(await g2.evaluate(() => window.__exo.sim.cur.story.inbox.includes('zz-radio'))), 'game: tapping it closes it');
  await g2.close();

  // landing timeline
  await page.goto(`${url}editor.html#cinematics/landing.json`);
  await page.waitForSelector('svg.tl .tl-key');
  check(await page.locator('svg.tl .tl-key').count() >= 10 && await page.locator('svg.tl .tl-beat').count() === 9, 'timeline: beats and camera keys are drawn');
  const box = await page.locator('svg.tl').boundingBox();
  await page.mouse.click(box.x + 74 + (20 / 28) * (box.width - 88), box.y + 8);
  check((await page.textContent('.tl-info')).startsWith('20.0 s'), 'timeline: clicking the ruler moves the playhead');
  const g3 = await game(() => page.click('.tl-bar button:has-text("From")'));
  await g3.waitForFunction(() => window.__exo?.landing, null, { timeout: 300000 });
  check(await g3.evaluate(() => window.__exo.landing.t >= 19.9), 'timeline: play from the playhead starts the landing there');
  await g3.close();

  // interface
  await page.goto(`${url}editor.html#rules/interface.json`);
  await page.waitForSelector('#ui-mock');
  await page.evaluate(() => { const i = document.querySelector('.row[data-key=accent] input'); i.value = '#9cff7a'; i.dispatchEvent(new Event('input')); });
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#ui-mock .m-brand')).color) === 'rgb(156, 255, 122)', 'interface: the sketch follows the accent colour');
  const g4 = await game(() => page.click('.story-panel button.primary'));
  await g4.waitForFunction(() => window.__exo?.ready, null, { timeout: 300000 });
  check((await g4.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim())) === '#9cff7a', 'interface: the game opens with it');
  await g4.close();
  await page.click('#revert');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  for (const f of Object.values(tmp)) await fs.rm(f, { force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall editor tool (part 2) checks passed');
process.exit(failed ? 1 : 0);
