/**
 * Daily Planet (src/daily.ts, TECH §6 "Daily Planet"): headless, the day's rules follow from the date alone, a fortnight
 * of them make fair maps, the score and the shared timeline; then in the browser (desktop and phone) the title's DAILY
 * PLANET, the scored try, the score card with Share on the end screen, practice after that, and the title's look back.
 *   node tools/daily-smoke.mjs [--url http://localhost:5176/] [--headless-only]   (or PORT=5176)
 */
import path from 'node:path';
import { launch } from './lib/harness.mjs';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const { module: D } = await runnerImport(path.join(root, 'src/daily.ts'));
const { module: S } = await runnerImport(path.join(root, 'src/skirmish/setup.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const ocean = (w) => !!C.bodies[w]?.ocean;

// ---------- the day's rules ----------
const a = D.dailyRules('2026-11-20', ocean), b = D.dailyRules('2026-11-20', ocean), c = D.dailyRules('2026-11-21', ocean);
check(JSON.stringify(a) === JSON.stringify(b), 'the same date gives the same planet');
check(JSON.stringify(a) !== JSON.stringify(c), 'the next day gives another');
check(a.day === 1 && c.day === 2, `numbered from the first day (#${a.day}, #${c.day})`);
check(D.dailyRules('2026-11-21').ai === 'hard' && D.dailyRules('2026-11-23').ai === 'normal', 'weekends are Hard, weekdays Normal');
check(D.dailyDate(new Date(Date.UTC(2026, 10, 20, 23, 59))) === '2026-11-20' && D.dailyDate(new Date(Date.UTC(2026, 10, 21, 0, 0))) === '2026-11-21', 'the day turns at midnight UTC');
const link = D.dailyLink(a, '/x/');
check(/skirmish=\d+/.test(link) && link.includes('daily=2026-11-20') && link.includes('packs=1') && !link.includes('practice'), 'the link is a skirmish link marked daily (predator packs on)');
check(D.dailyLink(a, '/x/', true).includes('practice=1'), 'a practice link says so');

// a fortnight of planets: each generates a fair map with every base reachable
const worlds = new Set();
let ok = 0;
for (let k = 0; k < 14; k++) {
  const date = new Date(Date.UTC(2026, 10, 20 + k)).toISOString().slice(0, 10);
  const d = D.dailyRules(date, ocean);
  worlds.add(d.world);
  const q = new URL(D.dailyLink(d, 'http://x/')).searchParams;
  const { map, setup } = S.skirmishFromUrl(q, C.bodies);
  const again = S.skirmishFromUrl(q, C.bodies);
  if (map.ok && setup.players.length === d.players && JSON.stringify(again.map.homes) === JSON.stringify(map.homes) && setup.packs) ok++;
  else console.log('      ', date, JSON.stringify(d), JSON.stringify(map.report ?? {}));
}
check(ok === 14, `14 days of planets generate (the same twice over) with ${[...worlds].join(', ')} (${ok}/14)`);

// ---------- score ----------
const st = (o = {}) => ({ kills: 0, buildingsLost: 0, dronesLost: 0, packsBeaten: 0, mined: 3000, unitsLost: 4, enemyKills: 30, ...o });
const win20 = D.dailyScore(true, 1200, st()).score, win30 = D.dailyScore(true, 1800, st()).score, lose30 = D.dailyScore(false, 1800, st()).score, lose10 = D.dailyScore(false, 600, st()).score;
check(win20 > win30 && win30 > lose30 && lose30 > lose10, `winning beats losing, sooner beats later, holding out longer beats falling early (${win20} > ${win30} > ${lose30} > ${lose10})`);
check(D.dailyScore(true, 1200, st({ unitsLost: 20, buildingsLost: 5 })).score < win20, 'losses cost points');
check(D.dailyScore(false, 30, st({ unitsLost: 500, mined: 0, enemyKills: 0 })).score === 0, 'never below zero');

// ---------- the timeline ----------
const snap = (secs, s) => ({ secs, players: [{ stats: { unitsLost: 0, buildingsLost: 0, enemyKills: 0, mined: 0, ...s } }] });
const t = new D.DailyTracker();
t.sample(snap(0, {})); t.sample(snap(130, { enemyKills: 2 })); t.sample(snap(250, { unitsLost: 8, enemyKills: 5 })); t.sample(snap(370, { unitsLost: 8, enemyKills: 5 }));
const line = t.line(true);
check(line === '🟩🟨🟥🟩🏆', `one square per 2 minutes: quiet, a fight, heavy losses, quiet, then the trophy (${line})`);
const long = new D.DailyTracker();
for (let s = 0; s <= 3600; s += 60) long.sample(snap(s, { enemyKills: s > 1800 ? s : 0 }));
check([...long.line(false)].length <= 16, `a long game folds to at most 15 squares (${long.line(false)})`);
const text = D.shareText(a, { won: true, secs: 1330, score: 1834, parts: [], line }, 'Verdance', 'https://deeek.org/ExoGenesis/');
check(text.startsWith('Exo Genesis · Daily Planet #1') && text.includes('Victory at 22:10 · 1,834 pts') && !/\d+,\s*\d+/.test(text.split('\n')[1]), 'the share text: day, world, rivals, the line, how and when it ended, the score, the link; no map details');

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? `${process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 5176}/`}`;
  const browser = await launch();
  for (const vp of [{ width: 1400, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?sw=0`);
    await page.waitForSelector('#title .t-item[data-id="daily"]', { timeout: 300000 });
    const sub = await page.textContent('#title .t-item[data-id="daily"] small');
    check(/one try a day/.test(sub), `${vp.name}: the title offers today's DAILY PLANET ("${sub}")`);
    await page.click('#title .t-item[data-id="daily"]');
    await page.waitForURL(/daily=/, { timeout: 30000 });
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 300000 });
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    check(await page.evaluate((d) => !!JSON.parse(localStorage.getItem('exo-daily') ?? '{}')[d], today), `${vp.name}: starting it takes today's scored try`);
    check(/Daily Planet #\d+ .* your scored try/.test(await page.textContent('#log')), `${vp.name}: the log says it's the scored try`);
    // play a little, then give up
    await page.evaluate(() => __exo.sim.command({ type: 'debug', alloys: 200 }));
    await page.waitForTimeout(1500);
    await page.evaluate(() => __exo.sim.command({ type: 'surrender' }));
    await page.waitForSelector('#over-daily .dl-score', { timeout: 30000 });
    const card = await page.textContent('#over-daily');
    if (process.argv.includes('--shots')) await page.screenshot({ path: path.join(root, `scratch/daily-over-${vp.name}.png`) });
    check(/DAILY PLANET #\d+/.test(card) && /pts/.test(card) && /💀/.test(card), `${vp.name}: the end screen shows the score card and the line`);
    const share = page.locator('#over-daily .dl-share');
    const box = await share.boundingBox();
    check(box && box.height >= 36, `${vp.name}: Share is touch-sized (${box ? Math.round(box.height) : 0} px)`);
    if (vp.touch) await page.evaluate(() => { navigator.share = undefined; }); // (headless: no share sheet; it copies)
    await share.click();
    await page.waitForFunction(() => /Copied|Shared/.test(document.querySelector('#over-daily .dl-said')?.textContent ?? ''), null, { timeout: 10000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(clip.startsWith('Exo Genesis · Daily Planet #') && /💀/.test(clip) && /pts/.test(clip), `${vp.name}: Share copies the result (${clip.split('\n')[2]})`);
    const stored = await page.evaluate((d) => JSON.parse(localStorage.getItem('exo-daily'))[d], today);
    check(stored?.result && stored.result.won === false && typeof stored.result.score === 'number', `${vp.name}: the result is kept (${stored?.result?.score} pts)`);
    // the same link again is practice
    await page.reload();
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.players, null, { timeout: 300000 });
    check(/practice \(not scored\)/.test(await page.textContent('#log')), `${vp.name}: playing it again is practice`);
    // the title looks back on today
    await page.goto(`${url}?sw=0`);
    await page.waitForSelector('#title .t-item[data-id="daily"]', { timeout: 300000 });
    const sub2 = await page.textContent('#title .t-item[data-id="daily"] small');
    check(/Today: fell · [\d,]+ pts · share/.test(sub2), `${vp.name}: the title shows today's result ("${sub2}")`);
    await page.click('#title .t-item[data-id="daily"]');
    await page.waitForSelector('#dl-card .dl-share', { timeout: 10000 });
    check(await page.locator('#dl-card .dl-practice').count() === 1, `${vp.name}: with Share and a practice button`);
    check(!errs.length, `${vp.name}: no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
    if (process.argv.includes('--shots')) await page.screenshot({ path: path.join(root, `scratch/daily-${vp.name}.png`) });
    await ctx.close();
  }
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall daily checks passed');
process.exit(failed ? 1 : 0);
