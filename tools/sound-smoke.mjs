/**
 * Sound end to end: no AudioContext until a user gesture, then it runs; the wind
 * bed starts; building, turret and predator activity play the expected sounds;
 * HUD taps tick; the on/off toggle survives a reload; ?sound=0 plays nothing;
 * nothing but wind during the landing cinematic.
 * (Counts what was started, through window.__exo.audio; it can't judge how it sounds.)
 *   node tools/sound-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
// count AudioContexts the page creates
await ctx.addInitScript(() => {
  window.__acs = 0;
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__acs++; } };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const stats = () => page.evaluate(() => __exo.audio.stats());
const ready = () => page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
const spot = (kind, cx, cz) => page.evaluate(([kind, cx, cz]) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!__exo.canPlace(kind, x, z)) return { x, z };
  }
  return null;
}, [kind, cx, cz]);
/** A harmless click (▶ play, already on) as the user gesture. */
const gesture = () => page.click('#b-play');

try {
  await page.goto(`${url}?intro=0&new=1`);
  await ready();
  await page.evaluate(() => localStorage.removeItem('exo.sound'));
  await wait(1000);

  // 1. locked until a gesture
  let s = await stats();
  check(s.state === 'locked' && await page.evaluate(() => window.__acs) === 0, `no AudioContext before a gesture (${s.state})`);
  await gesture();
  await page.waitForFunction(() => __exo.audio.stats().state === 'running', null, { timeout: 5000 }).catch(() => {});
  s = await stats();
  check(s.state === 'running', `context runs after a click (${s.state})`);
  // the wind starts on the next frame; headless frames can be slow
  await page.waitForFunction(() => __exo.audio.stats().wind, null, { timeout: 5000, polling: 100 }).catch(() => {});
  check((await stats()).wind, 'wind bed started');

  // 2. HUD tap
  await page.click('#b-play');
  await wait(100);
  check(((await stats()).counts.tap ?? 0) >= 1, 'a HUD button ticks');

  // 3. building: placed, then online
  await cmd({ type: 'debug', alloys: 2000 });
  const t = await spot('turret', 0, 14);
  await cmd({ type: 'build', kind: 'turret', ...t });
  await wait(600);
  check(((await stats()).counts.placed ?? 0) >= 1, 'placing a building plays "placed"');
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await page.waitForFunction((t) => __exo.sim.cur.buildings.some((b) => b.kind === 'turret' && b.progress >= 1 && Math.abs(b.x - t.x) < 0.1), t, { timeout: 120000, polling: 200 });
  await page.evaluate(() => __exo.sim.setSpeed(1));
  await wait(600);
  check(((await stats()).counts.online ?? 0) >= 1, 'a finished building plays "online"');
  // centre the camera on the turret so the fight is close and on screen
  await page.evaluate((t) => { __exo.cam.fx = t.x; __exo.cam.fz = t.z; }, t);

  // 4. a fight in view: predators bite the turret, it shoots, they die
  const before = (await stats()).counts;
  await cmd({ type: 'debug', spawn: { unit: 'brute', x: t.x + 6, z: t.z + 6, n: 2 } });
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: t.x - 8, z: t.z + 8, n: 5 } });
  await page.waitForFunction(() => __exo.sim.cur.hostiles > 0, null, { timeout: 10000, polling: 100 });
  await page.waitForFunction(() => __exo.sim.cur.hostiles === 0, null, { timeout: 60000, polling: 250 }).catch(() => {});
  await wait(1200);
  s = await stats();
  const got = (k) => (s.counts[k] ?? 0) - (before[k] ?? 0);
  check(got('turretShot') >= 3, `turret shots heard (${got('turretShot')})`);
  check(got('bite') >= 1, `predator bites heard (${got('bite')})`);
  check(got('deathSmall') >= 1, `small deaths heard (${got('deathSmall')})`);
  const shots = await page.evaluate(() => __exo.sim.cur.stats.kills);
  check(got('turretShot') < 60 && s.voices <= 12, `rate-limited: ${got('turretShot')} turret sounds for ${shots} kills, ${s.voices} voices now, ${s.dropped} dropped`);

  // a real pack from the edge: "Contact!" warns when it nears the base
  await cmd({ type: 'debug', wave: true });
  await page.evaluate(() => __exo.sim.setSpeed(3));
  await page.waitForFunction(() => (__exo.audio.stats().counts.warning ?? 0) >= 1, null, { timeout: 90000, polling: 250 }).catch(() => {});
  check(((await stats()).counts.warning ?? 0) >= 1, '"Contact!" plays the warning');
  await page.waitForFunction(() => __exo.sim.cur.hostiles === 0, null, { timeout: 90000, polling: 250 }).catch(() => {});
  await page.evaluate(() => __exo.sim.setSpeed(1));

  // 5. far away and zoomed out: world sounds skipped
  await page.evaluate(() => __exo.setView('planet'));
  await wait(300);
  const c0 = (await stats()).counts.turretShot ?? 0;
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: t.x + 6, z: t.z - 6, n: 3 } });
  await page.waitForFunction(() => __exo.sim.cur.hostiles > 0, null, { timeout: 10000, polling: 100 });
  await page.waitForFunction(() => __exo.sim.cur.hostiles === 0, null, { timeout: 60000, polling: 250 }).catch(() => {});
  check(((await stats()).counts.turretShot ?? 0) === c0, 'no fight sounds from orbit');
  await page.evaluate(() => __exo.setView('surface'));

  // 6. toggle persists across a reload (Sound lives in the game menu's Options)
  const options = async () => { await page.click('#b-menu'); await page.click('#options [data-id="options"]'); await page.waitForSelector('#options [data-id="sound"]'); };
  const closeAll = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(200); };
  await options();
  await page.click('#options [data-id="sound"]');
  s = await stats();
  check(!s.on && s.muted, 'toggle mutes');
  await page.goto(`${url}?intro=0&new=1`);
  await ready();
  s = await stats();
  await options();
  check(!s.on && (await page.textContent('#options [data-id="sound"] .op-state')) === 'OFF', 'muted after a reload');
  await closeAll();
  await gesture();
  await cmd({ type: 'debug', alloys: 500 });
  await cmd({ type: 'build', kind: 'solar', ...(await spot('solar', 20, 0)) });
  await wait(800);
  check(Object.keys((await stats()).counts).length === 0, 'muted plays nothing');
  await options();
  await page.click('#options [data-id="sound"]');
  await wait(300);
  check((await stats()).on && (await page.evaluate(() => JSON.parse(localStorage.getItem('exo.sound')).on)), 'toggle back on, remembered');
  await page.fill('#options [data-id="volume"] input', '40');
  check(Math.abs((await stats()).volume - 0.4) < 0.01, 'volume slider sets the volume');
  await page.fill('#options [data-id="volume"] input', '80');
  await closeAll();

  // 7. ?sound=0
  await page.goto(`${url}?intro=0&new=1&sound=0`);
  await ready();
  await gesture();
  await cmd({ type: 'debug', alloys: 500 });
  await cmd({ type: 'build', kind: 'solar', ...(await spot('solar', 20, 0)) });
  await cmd({ type: 'debug', spawn: { unit: 'swarmer', x: 0, z: 14, n: 3 } });
  await wait(4000);
  s = await stats();
  check(s.state === 'disabled' && Object.keys(s.counts).length === 0 && await page.evaluate(() => window.__acs) === 0, `?sound=0: no context, nothing played (${s.state})`);

  // 8. landing cinematic: only wind
  await page.goto(`${url}?new=1`);
  await ready();
  await page.mouse.click(500, 350); // the bar is hidden during the cinematic
  await wait(2500);
  s = await stats();
  check(s.quiet && s.state === 'running' && Object.keys(s.counts).filter((k) => k !== 'tap').length === 0, `landing: quiet, nothing but wind (${JSON.stringify(s.counts)}, wind ${s.wind})`);

  // 9. the editor's Sound rules form: volumes plus audio-only file pickers
  await page.goto(`${url}editor.html#rules/sound.json`);
  await page.waitForSelector('.row[data-key=master] input', { timeout: 30000 });
  const opts = await page.$$eval('.row[data-key=turretShot] select option', (o) => o.map((x) => x.value));
  check(opts.length >= 1 && !opts.some((v) => v.startsWith('exo-')), `editor: Sound form loads, file pickers offer no models (${opts.length} options)`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log(`FAIL  ${e.message}`);
  failed++;
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all sound checks passed');
process.exit(failed ? 1 : 0);
