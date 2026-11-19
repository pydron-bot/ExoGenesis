/**
 * Title music and the region picker: no music until a tap (browsers forbid it),
 * then the generative title music starts and keeps queuing chords and bells;
 * Options lists each region with the world it's on; leaving the title (New Game)
 * fades the music out.
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
  check(!!m0 && m0.chords >= 1, `music starts after a tap (${JSON.stringify(m0)})`);

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
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL ', e.message);
  failed++;
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
