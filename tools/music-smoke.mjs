/**
 * Music and the region picker. Title: where autoplay is blocked, no music until a click (the title says
 * so); where it's allowed it starts by itself; either way it keeps queuing chords and notes. Options lists
 * each region with the world it's on and a Music switch; leaving the title (New
 * Game) fades the music out. Play: quiet at first, then a day (or night) stretch,
 * tension when a fight starts; the player's music volume is remembered.
 * Editor: ▶ Listen plays a mood and lights the chord sounding.
 * (Counts what was queued, through window.__exo.audio; it can't judge how it sounds.)
 *   node tools/music-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';
import { answerBriefing, launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
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
  // autoplay blocked (a first visit): nothing until a click, and the title says so; a click anywhere starts it
  {
    const b2 = await launch();
    const p2 = await b2.newPage({ viewport: { width: 1100, height: 750 } });
    await p2.goto(`${url}?sw=0`);
    await p2.waitForFunction(() => window.__exo?.ready && document.querySelector('#title .t-item'), null, { timeout: 120000 });
    // (the title's status line fills in once the page has settled: slow under software rendering)
    await p2.waitForFunction(() => /ANYWHERE FOR SOUND/.test(document.querySelector('#title .t-status')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
    const hint = await p2.textContent('#title .t-status');
    check((await p2.evaluate(() => __exo.audio.stats().music)) === null && /ANYWHERE FOR SOUND/.test(hint), `autoplay blocked: no music, and the title says to click (${hint})`);
    await p2.mouse.click(900, 650);
    await p2.waitForFunction(() => __exo.audio.stats().music, null, { timeout: 5000 }).catch(() => {});
    const m = await p2.evaluate(() => __exo.audio.stats().music);
    check(m?.use === 'title' && (await p2.textContent('#title .t-status')) === '', `a click anywhere starts the title music and clears the hint (${m?.mood})`);
    await b2.close();
  }
  // autoplay allowed (this browser): the title music starts by itself
  await page.waitForFunction(() => __exo.audio.stats().music, null, { timeout: 5000 }).catch(() => {});
  const m0 = (await stats()).music;
  check(!!m0 && m0.use === 'title' && (await stats()).autoplayed, `autoplay allowed: title music starts without a tap (${JSON.stringify(m0)})`);
  await page.click('#title [data-id="options"]');
  check(await page.$('#options .op-row[data-id="music"]') !== null, 'Options has a Music switch');

  const rows = await page.$$eval('#options .op-row[data-id^="region:"]', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small')?.textContent ?? '']));
  check(rows.length > 1 && rows.every(([, b]) => b.length > 0), `every region shows its world (${rows.map(([r, b]) => `${r}: ${b}`).join(', ')})`);
  await page.screenshot({ path: 'shots/music-options.png' });
  await page.click('#options .op-x');

  await page.waitForTimeout(9000);
  const m1 = (await stats()).music;
  // notes keep coming: bells, or (moods without bells, like Landfall) arpeggio or melody
  check(m1 && m1.bells + m1.arps + m1.leads > 0, `notes keep coming (${JSON.stringify(m1)})`);

  await page.click('#title [data-id="new"]');
  await page.click('#title [data-id="new"]').catch(() => {}); // confirm, if a save asked
  await page.waitForFunction(() => !__exo.title?.active, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  check((await stats()).music === null, 'music stops (fades) when the title closes');

  // ---- in play ----
  await answerBriefing(page); // (the opening's briefing pauses the game, and the music with it)
  await page.goto(`${url}?sw=0&intro=0&new=1`);
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await page.click('#b-play');
  await page.waitForFunction(() => __exo.audio.stats().state === 'running', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  let s = await stats();
  check(s.music === null && s.stretch && !s.stretch.play, `quiet at first after landing (${JSON.stringify(s.stretch)})`);
  // skip the wait: the stretch clock runs out now
  await page.evaluate(() => { __exo.audio.stretch.left = 0; });
  await page.waitForFunction(() => !!__exo.audio.stats().music, null, { timeout: 15000, polling: 250 }).catch(() => {});
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
  // the player's music volume (game menu → Options): 0 is remembered
  const musicVol = async (v) => {
    if (!(await page.$('#options [data-id="music-volume"]'))) { await page.click('#b-menu'); await page.click('#options [data-id="options"]'); }
    await page.fill('#options [data-id="music-volume"] input', v);
    // Options and the menu close again (the menu pauses the game)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  };
  await musicVol('0');
  await page.waitForTimeout(600);
  check((await stats()).music === null, 'music volume 0 stops the music (nothing synthesised into silence)');
  // the first fight may be over by now (tension hangs on only so long after the last bite): start another, so
  // what's tested is the volume bringing the music back, not whether the fight lasted
  await page.evaluate(() => __exo.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 10, z: 10, n: 6 } }));
  await musicVol('50');
  await page.waitForFunction(() => !!__exo.audio.stats().music, null, { timeout: 15000, polling: 250 }).catch(() => {});
  // (tension if the new fight is still on, else the calm music: either way the volume brought it back)
  check(!!(await stats()).music?.use, `and it comes back when turned up (${(await stats()).music?.use})`);
  await musicVol('0');
  await page.reload();
  await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await page.click('#b-menu'); await page.click('#options [data-id="options"]');
  check((await stats()).musicVolume === 0 && await page.$eval('#options [data-id="music-volume"] input', (e) => e.value) === '0', 'music volume 0 is remembered');
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

  // ---- a written score plays the same every time ----
  // rendered offline twice (Math.random left as it is): the same samples; a free-running mood differs
  const takes = await page.evaluate(async () => {
    const { AmbientMusic, scoreBars } = await import('/src/audio/music.ts');
    const load = async (id) => (await fetch(`/content/music/${id}.json`)).json();
    const render = async (mood, seconds) => {
      const sr = 22050, off = new OfflineAudioContext(2, seconds * sr, sr);
      let clock = 0;
      const c = new Proxy(off, { get: (t, p) => (p === 'currentTime' ? clock : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
      const real = window.setInterval;
      window.setInterval = () => 0;
      const m = new AmbientMusic(c, off.destination, () => mood, 1, 0.5);
      window.setInterval = real;
      for (clock = 0; clock < seconds - 2; clock += 0.2) m.tick();
      const d = (await off.startRendering()).getChannelData(0);
      return { d, played: m.played, energy: d.reduce((a, v) => a + v * v, 0) };
    };
    const score = await load('score-example'), free = await load('night-void-drift');
    const [a, b] = [await render(score, 20), await render(score, 20)];
    const [f1, f2] = [await render(free, 20), await render(free, 20)];
    const gap = (x, y) => { let e = 0; for (let i = 0; i < x.d.length; i++) e = Math.max(e, Math.abs(x.d[i] - y.d[i])); return e; };
    // set to drift afterwards: the intro's 2 bars (8 s), then a random soundscape over the score's chords
    const drift = await render({ ...score, form: 'intro', scoreThen: 'drift' }, 24);
    return { bars: scoreBars(score)?.length, same: gap(a, b), free: gap(f1, f2), energy: a.energy, played: a.played, drift: drift.played };
  });
  check(takes.bars === 20, `the example score's form flattens to its bars (${takes.bars} of 20: intro A A B A outro)`);
  check(takes.energy > 0 && takes.played.chords >= 5 && takes.played.bells > 0, `a score plays its bars and its written bells (${JSON.stringify(takes.played)})`);
  check(takes.same < 1e-4, `a score renders the same twice (largest difference ${takes.same.toExponential(1)})`);
  check(takes.drift.drift && takes.drift.chords > 2 && takes.drift.bells > 0, `a score set to drift plays through once, then drifts with bells (${JSON.stringify(takes.drift)})`);
  check(takes.free > 1e-3, `a free-running mood still varies (largest difference ${takes.free.toFixed(3)})`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL ', e.message);
  failed++;
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
