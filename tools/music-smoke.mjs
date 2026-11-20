/**
 * Music and the region picker. Title: no music until a tap (browsers forbid it),
 * then the title mood starts and keeps queuing chords and bells; Options lists
 * each region with the world it's on and a Music switch; leaving the title (New
 * Game) fades the music out. Play: quiet at first, then a day (or night) stretch,
 * tension when a fight starts; the player's music volume is remembered.
 * Editor: ▶ Listen plays a mood and lights the chord sounding.
 * (Counts what was queued, through window.__exo.audio; it can't judge how it sounds.)
 *   node tools/music-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const stats = () => page.evaluate(() => __exo.audio.stats());

try {
  await page.goto(`${url}?sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title .t-item'), null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('exo.sound'));
  await page.waitForTimeout(800);
  check((await stats()).music === null, 'no music before a tap');

  // OPTIONS is a harmless first tap
  await page.click('#title [data-id="options"]');
  await page.waitForFunction(() => __exo.audio.stats().music, null, { timeout: 5000 }).catch(() => {});
  const m0 = (await stats()).music;
  check(!!m0 && m0.use === 'title' && m0.chords >= 1, `title music starts after a tap (${JSON.stringify(m0)})`);
  check(await page.$('#options .op-row[data-id="music"]') !== null, 'Options has a Music switch');

  const rows = await page.$$eval('#options .op-row[data-id^="region:"]', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small')?.textContent ?? '']));
  check(rows.length > 1 && rows.every(([, b]) => b.length > 0), `every region shows its world (${rows.map(([r, b]) => `${r}: ${b}`).join(', ')})`);
  await page.screenshot({ path: 'shots/music-options.png' });
  await page.click('#options .op-x');

  await page.waitForTimeout(9000);
  const m1 = (await stats()).music;
  check(m1 && m1.bells > 0, `bells keep coming (${JSON.stringify(m1)})`);

  await page.click('#title [data-id="new"]');
  await page.click('#title [data-id="new"]').catch(() => {}); // confirm, if a save asked
  await page.waitForFunction(() => !__exo.title?.active, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  check((await stats()).music === null, 'music stops (fades) when the title closes');

  // ---- in play ----
  await page.goto(`${url}?sw=0&intro=0&new=1`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await page.click('#b-play');
  await page.waitForFunction(() => __exo.audio.stats().state === 'running', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  let s = await stats();
  check(s.music === null && s.stretch && !s.stretch.play, `quiet at first after landing (${JSON.stringify(s.stretch)})`);
  // skip the wait: the stretch clock runs out now
  await page.evaluate(() => { __exo.audio.stretch.left = 0; });
  await page.waitForTimeout(800);
  s = await stats();
  const calm = s.music?.use;
  check(calm === 'day' || calm === 'night', `a calm stretch starts: ${calm} (${s.music?.mood})`);
  // a fight in front of the core: tension comes in
  await page.evaluate(() => __exo.sim.command({ type: 'debug', alloys: 3000 }));
  await page.evaluate(() => __exo.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 10, z: 10, n: 6 } }));
  await page.evaluate(() => __exo.sim.command({ type: 'debug', spawn: { unit: 'rover', x: 4, z: 4, n: 3 } }));
  await page.waitForFunction(() => __exo.audio.stats().music?.use === 'tension', null, { timeout: 30000, polling: 250 }).catch(() => {});
  s = await stats();
  check(s.music?.use === 'tension' && s.tense, `a fight brings in tension music (${s.music?.use})`);
  await page.waitForTimeout(4000);
  s = await stats();
  // every tension piece has drums (not all have the pulse)
  check((s.music?.hits ?? 0) > 0, `tension has its drums (${s.music?.mood}: ${s.music?.hits} hits)`);
  // the player's music volume: 0 is remembered
  await page.evaluate(() => { const el = document.getElementById('music-vol'); el.value = '0'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600);
  check((await stats()).music === null, 'music volume 0 stops the music (nothing synthesised into silence)');
  await page.evaluate(() => { const el = document.getElementById('music-vol'); el.value = '50'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600);
  check((await stats()).music?.use === 'tension', `and it comes back when turned up (${(await stats()).music?.use})`);
  await page.evaluate(() => { const el = document.getElementById('music-vol'); el.value = '0'; el.dispatchEvent(new Event('input')); });
  await page.reload();
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  check((await stats()).musicVolume === 0 && await page.$eval('#music-vol', (e) => e.value) === '0', 'music volume 0 is remembered');
  await page.evaluate(() => localStorage.removeItem('exo.sound'));

  // ---- editor ▶ Listen ----
  await page.goto(`${url}editor.html#music/night.json`);
  await page.waitForSelector('.music-panel .mp-play', { timeout: 30000 });
  await page.click('.music-panel .mp-play');
  await page.waitForSelector('.mp-chip.on', { timeout: 8000 }).catch(() => {});
  check(await page.$('.mp-chip.on') !== null, 'editor: ▶ Listen plays and lights the chord sounding');
  await page.click('.music-panel .mp-skip');
  await page.waitForTimeout(600);
  const txt = await page.$eval('.mp-now', (e) => e.textContent);
  check(/chord \d+ of 5/.test(txt), `editor: ⏭ moves on (${txt})`);
  await page.click('.music-panel .mp-play');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL ', e.message);
  failed++;
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
