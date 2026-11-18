/**
 * Cinematics (content/cinematics): triggers and the `cinematic` effect queue
 * one once (headless, the real sim); then in the browser: the landing still
 * plays as before, and a world cinematic plays over a paused game with its
 * camera, captions, lines and fades, skips, and hands the camera back.
 *   node tools/cinematic-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
function game() {
  const sim = new M.Sim(() => {});
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return sim;
}

// ---------- headless: triggers, effects, the queue ----------
const test = {
  title: 'Test', length: 6, camera: [{ at: 0, target: 'building', building: 'core', lift: 0, dist: 40, pitch: 0.6, yaw: 0 }, { at: 6, target: 'site', x: 20, z: 10, lift: 0, dist: 60, pitch: 0.8, yaw: 1 }],
  captions: [{ at: 0.5, title: 'SOMEWHERE' }], lines: [{ at: 1, speaker: 'Someone', text: 'Hello, {first}.' }],
  fadeIn: 1, fadeOut: 1, trigger: 'start',
};
C.cinematics['zz-start'] = test;
C.cinematics['zz-never'] = { ...test, trigger: 'never' };
C.story['zz-plays'] = { title: 'Z', text: 'z', trigger: 'never', effects: [{ after: 0, kind: 'cinematic', cinematic: 'zz-never' }] };
const a = game();
steps(a, 12);
check(a.s.story.cineQueue?.[0] === 'zz-start' && a.s.story.cines.includes('zz-start'), 'a cinematic whose trigger is met is queued');
check(a.snapshot().story.cine?.[0] === 'zz-start', 'the snapshot carries the queue');
check(!a.s.story.cineQueue.includes('zz-never') && !a.s.story.cineQueue.includes('landing'), 'trigger "never" and the landing are not queued');
a.command({ type: 'cinematic', id: 'zz-start', done: true });
steps(a, 30);
check(!a.s.story.cineQueue.length, 'done: off the queue, and it doesn\'t play again');
a.command({ type: 'debug', story: 'zz-plays' });
check(a.s.story.cineQueue[0] === 'zz-never', 'a story event\'s cinematic effect queues it');
const saved = JSON.parse(JSON.stringify(a.s));
const b = game();
b.load(saved);
check(b.s.story.cineQueue[0] === 'zz-never' && b.s.story.cines.includes('zz-start'), 'the queue and what has played are saved');
delete C.cinematics['zz-start']; delete C.cinematics['zz-never']; delete C.story['zz-plays'];

if (process.argv.includes('--headless-only')) {
  console.log(failed ? `\n${failed} check(s) failed` : '\nall cinematic checks passed');
  process.exit(failed ? 1 : 0);
}

// ---------- browser ----------
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

// the landing: a cinematic with its set piece, as before
await page.goto(`${url}?new=1&title=0&sw=0`);
await page.waitForFunction(() => window.__exo?.landing, null, { timeout: 300000 });
await page.waitForFunction(() => window.__exo.landing.t > 6, null, { timeout: 120000 });
check(await page.evaluate(() => document.body.classList.contains('cine') && !document.body.classList.contains('cine-world')), 'landing plays (cine, not a world cinematic)');
check((await page.textContent('#cine-title')).length > 0, `landing caption shows (${await page.textContent('#cine-title')})`);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !window.__exo.landing && window.__exo.sim.cur?.deployed, null, { timeout: 30000 });
check(await page.evaluate(() => !document.body.classList.contains('cine') && Math.abs(window.__exo.cam.targetDist - 75) < 1), 'skipping the landing hands over to the normal view');

// a world cinematic, played from the editor's preview (a scratch game on Touchdown)
const region = await page.evaluate(async () => (await (await fetch('/__content/file?path=regions/touchdown.json')).json()).text);
const def = { ...test, sounds: [] };
await page.evaluate(([r, d]) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'touchdown', def: JSON.parse(r), cinematic: { id: 'zz-test', def: d } })), [region, def]);
const g = await ctx.newPage();
g.on('pageerror', (e) => errors.push(e.message));
await g.goto(`${url}?preview=1&intro=0&sw=0`);
await g.waitForFunction(() => window.__exo?.cinematic?.id === 'zz-test', null, { timeout: 300000 });
check(await g.evaluate(() => document.body.classList.contains('cine-world') && document.body.classList.contains('cine-bars')), 'a world cinematic plays, letterboxed');
const tick0 = await g.evaluate(() => window.__exo.sim.cur.tick);
await g.waitForFunction(() => window.__exo.cinematic?.t > 1.5, null, { timeout: 60000 });
check(await g.evaluate(() => window.__exo.sim.cur.tick) - tick0 <= 2, 'the game is paused while it plays');
check((await g.textContent('#cine-title')) === 'SOMEWHERE', 'its caption shows');
check(await g.evaluate(() => document.querySelector('#cine-line').classList.contains('on') && document.querySelector('#cine-line .said').textContent.startsWith('Hello, ') && document.querySelector('#cine-line .who').textContent === 'Someone'), 'its line shows, with the speaker ({first} filled in)');
check(await g.evaluate(() => Number(document.querySelector('#cine-fade').style.opacity) < 0.05), 'faded in from black');
const mid = await g.evaluate(() => window.__exo.cam.targetDist);
check(Math.abs(mid - 40) > 0.5 && mid < 60, `the camera moves through its keys (${mid.toFixed(1)} u)`);
await g.keyboard.press('Escape');
await g.waitForFunction(() => !window.__exo.cinematic, null, { timeout: 10000 });
await g.waitForTimeout(800);
const after = await g.evaluate(() => ({ dist: window.__exo.cam.targetDist, yaw: window.__exo.cam.yaw, tick: window.__exo.sim.cur.tick, q: window.__exo.sim.cur.story.cine }));
check(Math.abs(after.dist - 75) < 0.5 && Math.abs(after.yaw - 0.4) < 1e-3, `skipping hands the camera back where it was (the surface view: ${after.dist.toFixed(1)} u, yaw ${after.yaw.toFixed(2)})`);
check(after.tick > tick0 + 2 && !after.q, 'the game runs again and the sim\'s queue is empty');
// the editor: the preview follows the playhead and plays in place; the side panels fold away
{
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(e.message));
  await ed.goto(`${url}editor.html#cinematics/landing.json`);
  await ed.waitForSelector('.cine-pv canvas', { timeout: 60000 });
  const box = await ed.locator('svg.tl').boundingBox();
  await ed.mouse.click(box.x + 74 + (20 / 28) * (box.width - 88), box.y + 8);
  check((await ed.textContent('.cine-pv .pv-title')) === 'SHELL RECLAIM', `preview: shows the caption at the playhead (${await ed.textContent('.cine-pv .pv-title')})`);
  await ed.mouse.click(box.x + 74 + (1 / 28) * (box.width - 88), box.y + 8);
  check((await ed.textContent('.cine-pv .pv-sub')).startsWith('ALT '), 'preview: fills the landing\'s {alt}');
  await ed.click('.tl-bar button:has-text("Preview")');
  await ed.waitForTimeout(1500);
  const at = Number((await ed.textContent('.tl-info')).split(' ')[0]);
  await ed.click('.tl-bar button:has-text("Pause")');
  check(at > 1.5 && at < 4, `preview: ▶ Preview plays it in the editor (${at} s)`);
  await ed.keyboard.press('[');
  await ed.keyboard.press(']');
  check(await ed.evaluate(() => document.body.classList.contains('side-closed') && document.body.classList.contains('aside-closed') && document.querySelector('#side').getBoundingClientRect().width < 30), 'panels: [ and ] fold the sidebar and details panel to a strip');
  await ed.reload();
  await ed.waitForSelector('.cine-pv canvas', { timeout: 60000 });
  check(await ed.evaluate(() => document.body.classList.contains('side-closed') && document.body.classList.contains('aside-closed')), 'panels: remembered after a reload');
  await ed.click('#side', { position: { x: 8, y: 120 } });
  await ed.click('#aside-toggle');
  check(await ed.evaluate(() => !document.body.classList.contains('side-closed') && !document.body.classList.contains('aside-closed')), 'panels: clicking the strip or the edge button opens them');
  await ed.close();
}

// the editor: + New gives a cinematic that is valid and plays
const fresh = path.join(root, 'content/cinematics/zz-new.json');
try {
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(e.message));
  ed.on('dialog', (d) => d.accept('zz-new'));
  await ed.goto(`${url}editor.html`);
  await ed.locator('#side .coll', { hasText: 'Cinematics' }).locator('button.mini').click();
  await ed.waitForSelector('svg.tl .tl-key');
  const D = (await runnerImport(path.join(root, 'src/content/db.ts'))).module;
  const rec = JSON.parse(await fs.readFile(fresh, 'utf8'));
  const issues = D.buildDb({ 'cinematics/zz-new.json': rec, 'cinematics/landing.json': JSON.parse(await fs.readFile(path.join(root, 'content/cinematics/landing.json'), 'utf8')), 'buildings/core.json': JSON.parse(await fs.readFile(path.join(root, 'content/buildings/core.json'), 'utf8')) }).issues.filter((i) => i.path === 'cinematics/zz-new.json');
  check(!issues.length && rec.camera.length === 2, `editor: + New makes a cinematic that is ready to play${issues.length ? `: ${issues.map((i) => `${i.field} ${i.msg}`).join('; ')}` : ''}`);
  check(await ed.locator('svg.tl .tl-beat').count() === 0 && await ed.locator('svg.tl text', { hasText: 'Lines' }).count() === 1, 'editor: its timeline has lines and sounds rows, no landing beats');
  const [pg] = await Promise.all([ctx.waitForEvent('page'), ed.click('.tl-bar button:has-text("Play in the game")')]);
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.waitForFunction(() => window.__exo?.cinematic?.id === 'zz-new', null, { timeout: 300000 });
  check(true, 'editor: ▶ Play in the game plays it there');
} finally {
  await fs.rm(fresh, { force: true });
}
check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall cinematic checks passed');
process.exit(failed ? 1 : 0);
