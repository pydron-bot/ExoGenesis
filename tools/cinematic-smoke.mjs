/**
 * Cinematics (content/cinematics): triggers and the `cinematic` effect queue
 * one once (headless, the real sim); then in the browser: the landing still
 * plays as before, and a world cinematic plays over a paused game with its
 * camera, captions, lines and fades, skips, and hands the camera back; the
 * editor's preview and timeline tools (fly and capture a key, select on the
 * map, duplicate, nudge, delete, undo, in-place text, line length, zoom).
 *   node tools/cinematic-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { answerBriefing, launch } from './lib/harness.mjs';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
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
const browser = await launch();
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
await answerBriefing(g); // (a story cinematic waits while a card is up)
await g.goto(`${url}?preview=1&intro=0&sw=0`);
// polled from here: the page can reload once (a content edit landing) and slow frames stall in-page polling
for (let i = 0; i < 600 && !(await g.evaluate(() => window.__exo?.cinematic?.id === 'zz-test').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
check(await g.evaluate(() => document.body.classList.contains('cine-world') && document.body.classList.contains('cine-bars')), 'a world cinematic plays, letterboxed');
const tick0 = await g.evaluate(() => window.__exo.sim.cur.tick);
await g.waitForFunction(() => window.__exo.cinematic?.t > 1.5, null, { polling: 500, timeout: 60000 });
check(await g.evaluate(() => window.__exo.sim.cur.tick) - tick0 <= 2, 'the game is paused while it plays');
check((await g.textContent('#cine-title')) === 'SOMEWHERE', 'its caption shows');
check(await g.evaluate(() => document.querySelector('#cine-line').classList.contains('on') && document.querySelector('#cine-line .said').textContent.startsWith('Hello, ') && document.querySelector('#cine-line .who').textContent === 'Someone'), 'its line shows, with the speaker ({first} filled in)');
check(await g.evaluate(() => Number(document.querySelector('#cine-fade').style.opacity) < 0.05), 'faded in from black');
const mid = await g.evaluate(() => window.__exo.cam.targetDist);
check(Math.abs(mid - 40) > 0.5 && mid < 60, `the camera moves through its keys (${mid.toFixed(1)} u)`);
await g.keyboard.press('Escape');
await g.waitForFunction(() => !window.__exo.cinematic, null, { polling: 500, timeout: 10000 });
await g.waitForTimeout(800);
const after = await g.evaluate(() => ({ dist: window.__exo.cam.targetDist, yaw: window.__exo.cam.yaw, tick: window.__exo.sim.cur.tick, q: window.__exo.sim.cur.story.cine }));
check(Math.abs(after.dist - 75) < 0.5 && Math.abs(after.yaw - 0.4) < 1e-3, `skipping hands the camera back where it was (the surface view: ${after.dist.toFixed(1)} u, yaw ${after.yaw.toFixed(2)})`);
check(after.tick > tick0 + 2 && !after.q, 'the game runs again and the sim\'s queue is empty');
await g.close(); // (a game left running takes the CPU the editor's preview needs in software rendering)
// the editor: the preview follows the playhead and plays in place; the side panels fold away
{
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(e.message));
  await ed.goto(`${url}editor.html#cinematics/landing.json`);
  await ed.waitForSelector('.cine-pv canvas', { timeout: 180000 });
  await ed.locator('svg.tl').scrollIntoViewIfNeeded();
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
  await ed.waitForSelector('.cine-pv canvas', { timeout: 180000 });
  check(await ed.evaluate(() => document.body.classList.contains('side-closed') && document.body.classList.contains('aside-closed')), 'panels: remembered after a reload');
  await ed.click('#side', { position: { x: 8, y: 120 } });
  await ed.click('#aside-toggle');
  check(await ed.evaluate(() => !document.body.classList.contains('side-closed') && !document.body.classList.contains('aside-closed')), 'panels: clicking the strip or the edge button opens them');
  await ed.close();
}

// the editor's cinematic tools: fly the preview and capture a key, then delete, duplicate, nudge (nothing is saved)
{
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(e.message));
  await ed.setViewportSize({ width: 1500, height: 1100 });
  await ed.goto(`${url}editor.html#cinematics/landing.json`);
  await ed.waitForSelector('.cine-pv canvas', { timeout: 180000 });
  const draft = () => ed.evaluate(() => JSON.parse(JSON.stringify(window.__editor.cur.draft)));
  const d0 = await draft();
  const box = await ed.locator('svg.tl').boundingBox();
  const tx = (t) => box.x + 74 + (t / Math.max(5, d0.length + 1)) * (box.width - 88);
  const keysAt = (d, t) => d.camera.filter((k) => Math.abs(k.at - t) < 0.06);
  await ed.mouse.click(tx(19), box.y + 8);
  // fly: orbit, pan (right drag), zoom
  const v = await ed.locator('.cine-pv .pv-view').boundingBox();
  const cx = v.x + v.width / 2, cy = v.y + v.height / 2;
  await ed.mouse.move(cx, cy); await ed.mouse.down(); await ed.mouse.move(cx - 90, cy + 25, { steps: 4 }); await ed.mouse.up();
  await ed.mouse.move(cx, cy); await ed.mouse.down({ button: 'right' }); await ed.mouse.move(cx + 40, cy + 20, { steps: 4 }); await ed.mouse.up({ button: 'right' });
  await ed.mouse.wheel(0, -120);
  check(await ed.evaluate(() => window.__editor.preview.isFree) && (await ed.textContent('.cine-pv .pv-nums')).includes('dist'), 'tools: dragging the preview flies a free view and shows its numbers');
  const seen = await ed.evaluate(() => window.__editor.preview.position.toArray());
  await ed.click('.pv-tools button:has-text("Key from view")');
  const d1 = await draft();
  const k = keysAt(d1, 19)[0];
  check(d1.camera.length === d0.camera.length + 1 && k?.target === 'site', `tools: ＋ Key from view adds a site key at the playhead (${JSON.stringify(k)})`);
  const n = d1.camera.findIndex((x) => Math.abs(x.at - 19) < 0.06);
  const near = [d1.camera[n - 1]?.yaw, d1.camera[n + 1]?.yaw].filter((x) => x !== undefined);
  check(Math.abs(k.yaw - near.reduce((a, b) => a + b, 0) / near.length) <= Math.PI + 1e-6, `tools: its yaw is unwrapped next to its neighbours' (${k.yaw} by ${near.join(', ')})`);
  // away and back: the cinematic itself now frames the shot that was seen
  await ed.mouse.click(tx(3), box.y + 8);
  await ed.mouse.click(tx(19), box.y + 8);
  const played = await ed.evaluate(() => window.__editor.preview.position.toArray());
  const err = Math.hypot(...seen.map((x, j) => x - played[j]));
  check(!(await ed.evaluate(() => window.__editor.preview.isFree)) && err < 0.25, `tools: the captured key plays back the shot (camera ${err.toFixed(3)} u from where it was)`);
  check(await ed.locator('svg.tl g.tl-key.sel').count() === 1 && (await ed.textContent('.tl-info')).includes(`selected: key ${n + 1}`), 'tools: the new key is selected');
  // a probe key keeps its target when it takes the view
  // pick it on the map (its numbered dot)
  const dot = await ed.evaluate(() => window.__editor.preview.dots.filter((p) => window.__editor.cur.draft.camera[p.i].target === 'probe' && window.__editor.cur.draft.camera[p.i].at > 5).pop());
  const mb = await ed.locator('.pv-map').boundingBox();
  await ed.mouse.click(mb.x + dot.x, mb.y + dot.y);
  const pi = dot.i;
  check((await ed.textContent('.tl-info')).includes(`selected: key ${pi + 1}`), `tools: clicking key ${pi + 1}'s dot on the map selects it`);
  await ed.mouse.move(cx, cy); await ed.mouse.down(); await ed.mouse.move(cx + 50, cy, { steps: 3 }); await ed.mouse.up();
  await ed.click('.pv-tools button:has-text("Update selected key")');
  const d2 = await draft();
  check(d2.camera[pi].target === 'probe' && d2.camera[pi].yaw !== d1.camera[pi].yaw && d2.camera.length === d1.camera.length, `tools: Update selected key keeps a probe key on the probe (yaw ${d1.camera[pi].yaw} → ${d2.camera[pi].yaw})`);
  if (await ed.evaluate(() => window.__editor.preview.isFree)) await ed.click('.pv-tools button:has-text("Back to the cinematic")');
  // duplicate at the playhead, nudge, delete, undo
  await ed.evaluate((t) => { window.__editor.preview.onPick(t); }, n);
  await ed.mouse.click(tx(9), box.y + 8);
  await ed.keyboard.press('Control+d');
  const d3 = await draft();
  check(d3.camera.length === d2.camera.length + 1 && keysAt(d3, 9).length === 1 && keysAt(d3, 9)[0].target === 'site', 'tools: Ctrl+D copies the selected key to the playhead');
  await ed.keyboard.press('ArrowRight');
  await ed.keyboard.press('ArrowRight');
  await ed.keyboard.press('Shift+ArrowRight');
  const d4 = await draft();
  check(keysAt(d4, 10.2).length === 1 && !keysAt(d4, 9).length && d4.camera.every((x, j) => !j || x.at >= d4.camera[j - 1].at), 'tools: ← / → nudge it (0.1 s, Shift 1 s) and the keys stay in time order');
  await ed.keyboard.press('Delete');
  const d5 = await draft();
  check(d5.camera.length === d2.camera.length && !keysAt(d5, 10.2).length, 'tools: Delete removes it');
  await ed.keyboard.press('Control+z');
  check(keysAt(await draft(), 10.2).length === 1, 'tools: Ctrl+Z brings it back (the edits are in the undo history)');
  // a caption typed in place; a line's length dragged from its right edge
  await ed.keyboard.press('Home');
  await ed.keyboard.press('.');
  await ed.keyboard.press('.');
  await ed.click('.tl-tools button:has-text("Caption")');
  await ed.waitForSelector('input.tl-edit');
  await ed.keyboard.type('IN PLACE');
  await ed.keyboard.press('Enter');
  await ed.click('.tl-tools button:has-text("Line")');
  await ed.waitForSelector('input.tl-edit');
  await ed.keyboard.type('Hello there');
  await ed.keyboard.press('Enter');
  const d6 = await draft();
  check(d6.captions.some((c) => c.at === 0.2 && c.title === 'IN PLACE') && d6.lines?.[0]?.text === 'Hello there', 'tools: ＋ Caption / ＋ Line at the playhead, typed in place');
  // (the timeline redraws as the form below settles: ask until the grip holds still)
  let grip = null;
  for (let n = 0; n < 20 && !grip; n++) { await ed.waitForTimeout(100); grip = await ed.locator('svg.tl rect.tl-grip').first().boundingBox(); }
  await ed.mouse.move(grip.x + 3, grip.y + 9); await ed.mouse.down(); await ed.mouse.move(tx(3.2), grip.y + 9, { steps: 5 }); await ed.mouse.up();
  check((await draft()).lines[0].for === 3, `tools: dragging a line's right edge sets how long it shows (${(await draft()).lines[0].for} s)`);
  // Ctrl+wheel zooms the time axis
  await ed.mouse.move(tx(10), box.y + 120);
  await ed.keyboard.down('Control'); await ed.mouse.wheel(0, -500); await ed.keyboard.up('Control');
  const zw = (await ed.locator('svg.tl').boundingBox()).width;
  check(zw > box.width * 2 && await ed.evaluate(() => document.querySelector('.tl-scroll').scrollLeft > 0), `tools: Ctrl+wheel zooms the timeline (${Math.round(box.width)} → ${Math.round(zw)} px) and it scrolls`);
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
  await ed.waitForTimeout(300);
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
