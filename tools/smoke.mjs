/**
 * End-to-end colony test through real pointer input:
 *   drag-order the drone, place buildings from the build menu (and get refused
 *   outside the build area), select a building and switch it off and on, fight
 *   a pack with a turret, save/load, lose the Core and start a new game.
 *   node tools/smoke.mjs [--url http://localhost:5176/] [--gpu]
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const gpu = process.argv.includes('--gpu');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const browser = await chromium.launch({ args: ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const cur = () => page.evaluate(() => {
  const c = __exo.sim.cur;
  return { drones: c.drones, buildings: c.buildings, alloys: c.alloys, tick: c.tick, hostiles: c.hostiles, stats: c.stats, over: c.over };
});
const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const screen = (x, z, lift = 0) => page.evaluate(([x, z, lift]) => __exo.screenOf(x, z, lift), [x, z, lift]);
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);

await page.goto(`${url}?intro=0&new=1`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(1500);

// 0. the drone starts selected
check(await page.evaluate(() => __exo.ui.sel?.kind === 'drone'), 'first drone selected after landing');
check(/WORKER DRONE 1/.test(await page.textContent('#card')), 'selection card shows the drone');

// 1. drag an order vector from the drone
let s = await cur();
const d0 = s.drones[0];
const p0 = await page.evaluate((id) => __exo.droneScreen(id), d0.id);
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(p0.x + i * 22, p0.y - i * 14);
await page.mouse.up();
await wait(400);
s = await cur();
check(s.drones[0].manual && s.drones[0].task === 'move', 'drag from the drone issues a move order');
await wait(3000);
s = await cur();
check(Math.hypot(s.drones[0].x - d0.x, s.drones[0].z - d0.z) > 5, `drone moved to (${s.drones[0].x.toFixed(1)}, ${s.drones[0].z.toFixed(1)})`);

// 2. build menu → Solar Array → hover → click
await page.click('#b-build');
const buildable = fs.readdirSync(new URL('../content/buildings/', import.meta.url)).filter((f) => {
  const d = JSON.parse(fs.readFileSync(new URL(`../content/buildings/${f}`, import.meta.url)));
  return d.buildable !== false && d.role !== 'core';
}).length;
check(await page.locator('#build-menu.open [data-kind]').count() === buildable, `build menu lists the ${buildable} buildable buildings`);
await page.dispatchEvent('#build-menu [data-kind="solar"]', 'pointerdown');
check(await page.evaluate(() => __exo.ui.build) === 'solar', 'picking Solar Array enters placement');
const spot = await page.evaluate(() => {
  for (const [x, z] of [[14, -18], [-16, -14], [18, 10], [0, -30], [24, -6]]) if (!__exo.canPlace('solar', x, z)) return { x, z };
  return null;
});
check(!!spot, `found a valid solar spot (${JSON.stringify(spot)})`);
const sp = await screen(spot.x, spot.z);
await page.mouse.move(sp.x + 3, sp.y + 3);
await page.mouse.move(sp.x, sp.y);
await wait(200);
check(await page.evaluate(() => __exo.ui.ghost?.ok === true), 'ghost is green on a valid spot');
await page.mouse.click(sp.x, sp.y);
await wait(500);
s = await cur();
const solar = s.buildings.find((b) => b.kind === 'solar');
check(!!solar && solar.progress < 1, 'clicking places a Solar Array site');
check(await page.evaluate(() => __exo.ui.build) === null, 'placement ends after one building');
await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'solar' && b.progress >= 1), null, 90000);
check(true, 'idle drone built the site on its own');

// 3. refused outside the build area
await page.evaluate(() => __exo.hud.toggleMenu(true));
await page.dispatchEvent('#build-menu [data-kind="solar"]', 'pointerdown');
// a visible ground point that's outside the build area
const farPt = await page.evaluate(() => {
  for (let r = 50; r < 100; r += 5) for (let a = 0; a < 6.28; a += 0.3) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const p = __exo.screenOf(x, z);
    if (p.x < 60 || p.y < 120 || p.x > innerWidth - 60 || p.y > innerHeight - 140) continue;
    if (/outside the build area/.test(__exo.canPlace('solar', x, z) ?? '')) return p;
  }
  return null;
});
check(!!farPt, 'found a visible spot outside the build area');
const far = farPt;
await page.mouse.move(far.x + 2, far.y + 2);
await page.mouse.move(far.x, far.y);
await wait(200);
check(await page.evaluate(() => __exo.ui.ghost?.ok === false), 'ghost turns red outside the build area');
const before = (await cur()).buildings.length;
await page.mouse.click(far.x, far.y);
await wait(400);
check((await cur()).buildings.length === before, 'clicking a red spot builds nothing');
check(/Can't build there/.test(await page.textContent('#log')), 'and says why');
await page.keyboard.press('Escape');

// 4. select the solar array, switch it off and on
const sb = (await cur()).buildings.find((b) => b.kind === 'solar');
const ss = await screen(sb.x, sb.z, 1);
await page.mouse.click(ss.x, ss.y);
await wait(400);
check(/SOLAR ARRAY/.test(await page.textContent('#card')), 'tapping a building shows its card');
// wait for the switch to reach the sim and come back in a snapshot (a fixed wait raced slow software-rendered frames:
// the card still showed it on and the second tap switched it off again)
const isOn = (want) => until(([id, want]) => __exo.sim.cur.buildings.find((b) => b.id === id)?.on === want, [sb.id, want], 10000).then(() => true, () => false);
await page.dispatchEvent('#card [data-act="power"]', 'pointerdown');
check(await isOn(false), 'Switch off turns it off');
// the button does what it says: wait for the card to catch up and offer "Switch on" (on a slow frame it can still
// say "Switch off" for a moment, and pressing that switches it off again, as it should)
await until(() => /Switch on/.test(document.querySelector('#card [data-act="power"]')?.textContent ?? ''), null, 10000).catch(() => {});
await page.dispatchEvent('#card [data-act="power"]', 'pointerdown');
check(await isOn(true), 'Switch on turns it back on');

// 5. turrets fight a pack (spawned on demand)
// (and a radar: without one the bar shows a pack only once it's sighted near a building, and the turrets can kill a
// small pack before that)
await cmd({ type: 'debug', alloys: 700 });
for (const kind of ['turret', 'turret', 'solar', 'solar', 'radar']) {
  const p = await page.evaluate((kind) => {
    for (let r = 14; r < 40; r += 3) for (let a = 0; a < 6.28; a += 0.4) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!__exo.canPlace(kind, x, z)) return { x, z };
    }
    return null;
  }, kind);
  if (p) await cmd({ type: 'build', kind, ...p });
  await wait(400); // let the next snapshot include it before searching again
}
await page.evaluate(() => __exo.sim.setSpeed(3));
await until(() => __exo.sim.cur.buildings.filter((b) => b.kind === 'turret' && b.progress >= 1).length === 2, null, 180000);
await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'radar' && b.progress >= 1), null, 180000);
// watch the resource bar from now on: two turrets can kill a small pack before a check after the kills would see it
await page.evaluate(() => {
  window.__threatSeen = false; window.__threatLog = [];
  const t = setInterval(() => {
    const txt = document.querySelector('#r-threat')?.textContent ?? '';
    if (window.__threatLog.at(-1) !== txt) window.__threatLog.push(txt);
    if (/predators|next pack/.test(txt)) { window.__threatSeen = true; clearInterval(t); }
  }, 100);
});
await cmd({ type: 'debug', wave: true });
await until(() => __exo.sim.cur.hostiles > 0, null, 10000);
check(true, 'a predator pack spawned');
await until(() => __exo.sim.cur.stats.kills > 0, null, 180000);
check(true, `turrets killed predators (${(await cur()).stats.kills})`);
check(await page.evaluate(() => window.__threatSeen), `threat shown in the resource bar${process.env.DBG ? ` (${JSON.stringify(await page.evaluate(() => window.__threatLog))}, packs ${JSON.stringify((await cur()).stats)})` : ''}`);
await page.evaluate(() => __exo.sim.setSpeed(1));

// 6. save files (named saves, load, export, import) are covered by tools/saves-smoke.mjs

// 6b. autosave: leave and come back without ?new=1 → resumes where we were
await page.evaluate(() => __exo.sim.flush());
await wait(800);
const before6b = await cur();
await page.goto(`${url}`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(2400); // the title's menu slides in
check(await page.evaluate(() => !!__exo.title && getComputedStyle(document.getElementById('hud')).display === 'none'), 'a plain visit opens on the title screen, HUD hidden');
check(/Sol \d+/.test(await page.textContent('[data-id=continue] small')), 'title offers CONTINUE with the colony\'s Sol');
await page.click('[data-id=new]');
check(/tap again/.test(await page.textContent('[data-id=new] small')) && await page.evaluate(() => !!__exo.title), 'NEW GAME asks twice when there is a colony');
await page.click('[data-id=continue]');
await until(() => !__exo.title && __exo.cam.dist < 200, null, 10000);
check(true, 'CONTINUE closes the title and dives to the surface');
s = await cur();
check(s.buildings.length === before6b.buildings.length && s.tick >= before6b.tick - 5, `coming back resumes the autosave (${s.buildings.length} buildings, tick ${s.tick}) with no landing cinematic`);
check(await page.evaluate(() => !document.body.classList.contains('cine')), 'resume skips the landing cinematic');
check(/Welcome back/.test(await page.textContent('#log')), 'says welcome back');

// 7. lose the core → game over → new game
await cmd({ type: 'debug', hurt: { id: 1, hp: 99999 } });
await until(() => document.querySelector('#over')?.classList.contains('on'), null, 10000);
check(/COLONY LOST/.test(await page.textContent('#over')), 'losing the Core shows the game-over panel');
await wait(11000); // the worker's autosave tick clears the save once the colony is lost
await page.goto(`${url}?intro=0`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(800);
check((await cur()).buildings.length === 1 && !(await cur()).over, 'after a loss, coming back starts a fresh colony');
await cmd({ type: 'debug', hurt: { id: 1, hp: 99999 } });
await until(() => document.querySelector('#over')?.classList.contains('on'), null, 10000);
await page.click('#over-restart');
await until(() => !document.querySelector('#over')?.classList.contains('on') && __exo.sim.cur.buildings.length === 1 && __exo.sim.cur.deployed, null, 10000);
check(true, 'New game starts over');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
