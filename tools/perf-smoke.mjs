/**
 * Performance report (menu → Performance report, src/perf-report.ts): the benchmark runs through the effects that
 * are on, writes a report, and puts every setting back (remembered ones included); recording while playing writes
 * its section; Copy and Save work.
 *   node tools/perf-smoke.mjs [--url http://localhost:5176/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// sky reflections and sun shadows on (off by default in automated browsers), so the benchmark has them to try
await page.goto(`${url}?intro=0&new=1&sw=0&reflect=1&sunshadows=1&perfframes=3,6`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { localStorage.setItem('exo.mist', 'on'); });
const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('exo') && k !== 'exo.camera').sort().map((k) => [k, localStorage.getItem(k)])));
const settings = () => page.evaluate(() => [...document.querySelectorAll('.pf-pre')].map((p) => p.textContent).join(''));

// the menu → Performance report → Benchmark
await page.click('#b-menu');
await page.waitForSelector('#options.menu');
await page.click('#options [data-id="perf"]');
await page.waitForSelector('#options [data-pf="bench"]');
check(!(await page.$('#options [data-pf="copy"]')), 'no report yet: no Copy button');
await page.click('#options [data-pf="bench"]');
await page.waitForSelector('#perf-badge', { timeout: 60000 }).catch((e) => { console.log('ERRORS', errors); throw e; });
check(await page.evaluate(() => __exo.speed === 0), 'the benchmark pauses the game');
await page.waitForSelector('#options .pf-pre', { timeout: 400000 });
const report = await settings();
if (process.env.SHOW) console.log(report);
check(/BENCHMARK/.test(report) && /as you have it/.test(report), 'the report has the benchmark');
check(/Sun shadows off .*saves/.test(report) && /Sky reflections off .*saves/.test(report) && /all of those off/.test(report), 'each effect that was on is measured by itself, then all off');
check(/Graphics: /.test(report) && /SETTINGS/.test(report) && /Version: /.test(report), 'device, game and settings sections');
check(!(await page.$('#perf-badge')), 'the badge is gone');
const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('exo') && k !== 'exo.camera').sort().map((k) => [k, localStorage.getItem(k)])));
if (before !== after) console.log('BEFORE', before, '\nAFTER ', after);
check(before === after, 'remembered settings are exactly as before (the camera, saved meanwhile, aside)');
check(await page.evaluate(() => __exo.skyEnv.enabled && __exo.post.enabled === false), 'live settings are back (reflections on, glow off as before)');
// copy and save
await page.click('#options [data-pf="copy"]');
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(/EXO GENESIS PERFORMANCE REPORT/.test(clip), 'Copy puts the report on the clipboard');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#options [data-pf="save"]')]);
check(/^exo-performance-.*\.txt$/.test(dl.suggestedFilename()), `Save downloads a .txt (${dl.suggestedFilename()})`);
// closing the report resumes the game
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check(await page.evaluate(() => __exo.speed > 0), 'closing the report un-pauses the game');

// record while playing
await page.click('#b-menu');
await page.waitForSelector('#options.menu');
await page.click('#options [data-id="perf"]');
await page.click('#options [data-pf="record"]');
await page.waitForSelector('#perf-badge');
check(await page.evaluate(() => __exo.speed > 0 && !document.getElementById('options')), 'recording: the menu closes and the game runs');
await page.waitForTimeout(4000);
await page.click('#perf-badge button');
await page.waitForSelector('#options .pf-pre');
const rec = await settings();
check(/RECORDING \(\d+ s, \d+ frames\)/.test(rec) && /By zoom:/.test(rec), 'Stop writes the recording section');
const draws = Number(/Draw calls: avg (\d+)/.exec(rec)?.[1] ?? 0);
check(draws > 20, `draw calls count the whole frame (avg ${draws})`);
check(/as you have it .* (\d{2,}) draws/.test(rec), 'the benchmark counts the whole frame\'s draws too');
check(/BENCHMARK/.test(rec), 'the earlier benchmark is still in the report');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall performance report checks passed');
process.exit(failed ? 1 : 0);
