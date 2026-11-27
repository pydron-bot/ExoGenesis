/**
 * Player comfort and control (v0.103.0): Effects and Voices volume sliders; the build menu's number keys and V to
 * place another; the Message log (L) and its screen-reader copy; rebinding a key in Controls; Interface size, Reduce
 * motion and the colour-blind palette in Options.
 *   node tools/access-smoke.mjs [--url http://localhost:5176/]
 */
import { DEV_URL, checker, launch } from './lib/harness.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : DEV_URL;
const { check, done } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ev = (f, a) => page.evaluate(f, a);
await page.goto(`${url}?intro=0&new=1&sw=0`);
await page.evaluate(() => { localStorage.removeItem('exo.keys'); localStorage.removeItem('exo.uiSize'); localStorage.removeItem('exo.reduceMotion'); localStorage.removeItem('exo.colourBlind'); });
await page.reload();
await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 180000 });
await page.waitForTimeout(800);
const closePanels = async () => { for (let i = 0; i < 4 && (await page.$('#options')); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };

// ---------- build menu keys ----------
await page.mouse.click(600, 400); // focus the page
await page.keyboard.press('b');
const first = await ev(() => document.querySelector('#build-menu [data-kind]')?.dataset.kind);
check(await ev(() => document.querySelector('#build-menu [data-kind] kbd')?.textContent === '1'), 'build menu items show their number keys');
await page.keyboard.press('1');
check(await ev(() => __exo.ui.build) === first && !(await ev(() => document.getElementById('build-menu').classList.contains('open'))), `1 picks the first item (${first})`);
await page.keyboard.press('Escape');
check(await ev(() => !__exo.ui.build), 'Esc stops placing');
await page.keyboard.press('v');
check(await ev(() => __exo.ui.build) === first, 'V places another of the last kind');
await page.keyboard.press('Escape');

// ---------- message log ----------
await page.keyboard.press('l');
await page.waitForSelector('#options.loghistory', { timeout: 5000 }).catch(() => {});
const rows = await ev(() => document.querySelectorAll('#options.loghistory .lh-row').length);
check(rows > 0, `L opens the message log (${rows} lines)`);
await page.click('#options.loghistory [data-f="warn"]');
const allWarn = await ev(() => [...document.querySelectorAll('#options.loghistory .lh-row')].every((r) => r.classList.contains('warn') || r.classList.contains('bad')));
check(allWarn, 'the filter shows only warnings and alerts');
await closePanels();
check(await ev(() => document.querySelector('[role="log"][aria-live="polite"]') !== null), 'a polite live region mirrors warnings for screen readers');

// ---------- rebinding ----------
await page.keyboard.press('?');
await page.waitForSelector('#options .kb-set[data-act="build"]');
await page.click('#options .kb-set[data-act="build"]');
await page.keyboard.press('n');
check(await ev(() => document.querySelector('#options .kb-set[data-act="build"]').textContent) === 'N', 'Controls: the build key rebinds to N');
await closePanels();
await page.keyboard.press('n');
check(await ev(() => document.getElementById('build-menu').classList.contains('open')), 'N opens the build menu now');
await page.keyboard.press('Escape');
await page.keyboard.press('b');
check(!(await ev(() => document.getElementById('build-menu').classList.contains('open'))), 'B no longer does');
await page.keyboard.press('?');
await page.waitForSelector('#options .kb-reset');
await page.click('#options .kb-reset');
check(await ev(() => document.querySelector('#options .kb-set[data-act="build"]').textContent) === 'B', 'Reset keys puts B back');
await page.click('#options .kb-set[data-act="stop"]');
await page.keyboard.press('w');
check(await ev(() => document.querySelector('#options .kb-set[data-act="stop"]').textContent) === 'X', 'a camera key can\'t be taken');
await closePanels();

// ---------- options ----------
await page.click('#b-menu');
await page.click('#options [data-id="options"]');
await page.waitForSelector('#options [data-id="effects-volume"]');
check(await ev(() => !!document.querySelector('#options [data-id="voice-volume"] input')), 'Options has Effects volume and Voices volume');
await page.$eval('#options [data-id="effects-volume"] input', (i) => { i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
check(Math.abs(await ev(() => JSON.parse(localStorage.getItem('exo.sound') ?? localStorage.getItem(Object.keys(localStorage).find((k) => /sound|audio/.test(k)) ?? '') ?? '{}').fx ?? -1) - 0.4) < 0.01, 'the effects volume is remembered');
await page.$eval('#options [data-id="uisize"] input', (i) => { i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
check(await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-player').trim()) === '1.5', 'Interface size scales the interface (--ui-player 1.5)');
await page.click('#options [data-id="motion"]');
check(await ev(() => document.documentElement.classList.contains('reduce-motion')), 'Reduce motion turns on');
const cyan0 = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim());
await page.click('#options [data-id="colourblind"]');
const cyan1 = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim());
check(cyan1 === '#56b4e9' && cyan1 !== cyan0, `the colour-blind palette changes the accent (${cyan0} → ${cyan1})`);
await page.click('#options [data-id="colourblind"]');
check(await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim()) === cyan0, 'and off puts the content\'s colour back');
await page.evaluate(() => { localStorage.removeItem('exo.uiSize'); localStorage.removeItem('exo.reduceMotion'); localStorage.removeItem('exo.colourBlind'); });

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();
