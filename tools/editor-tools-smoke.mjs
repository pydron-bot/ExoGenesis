/**
 * Editor tools: story flow (and its problem finder), balance table, review
 * (diff before commit), sidebar search, "used by". Pure helpers headless, then
 * the pages in the dev editor.
 *   node tools/editor-tools-smoke.mjs [--url http://localhost:5176/]
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: F } = await runnerImport(path.join(root, 'src/editor/flow.ts'));
const { module: T } = await runnerImport(path.join(root, 'src/editor/tools.ts'));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- flow analysis ----------
const missions = {
  a: { title: 'A', objectives: [] },
  b: { title: 'B', after: 'a', objectives: [{ text: 'x', kind: 'flag', flag: 'lonely' }] },
  c: { title: 'C', after: 'zz', objectives: [] },
  d: { title: 'D', after: 'e', objectives: [] }, e: { title: 'E', after: 'd', objectives: [] },
};
const story = {
  s1: { title: 'S1', text: '', trigger: 'start', effects: [{ after: 0, kind: 'flag', flag: 'go' }] },
  s2: { title: 'S2', text: '', trigger: 'flag', flag: 'go', unless: 'stop' },
  s3: { title: 'S3', text: '', trigger: 'never' },
  s4: { title: 'S4', text: '', trigger: 'after', event: 'gone' },
  s5: { title: 'S5', text: '', trigger: 'mission', mission: 'c' },
};
const fl = F.analyzeFlow(missions, story);
check(fl.chain.join() === 'a,b', `campaign order follows "after" (${fl.chain.join()})`);
check(fl.stray.join() === 'c,d,e', 'missions after a missing one, or in a loop, are stray');
const msgs = fl.problems.map((p) => `${p.at.id}: ${p.msg}`);
check(msgs.some((m) => m.startsWith('b: waits for flag "lonely"')), 'problem: a flag nothing sets');
check(msgs.some((m) => m.startsWith('s3: trigger is "never"')), 'problem: a "never" event nothing starts');
check(msgs.some((m) => m.startsWith('s4: follows event "gone"')), 'problem: following a missing event');
check(msgs.some((m) => m.startsWith('s5: waits on mission "c"')), 'problem: waiting on a mission that never starts');
check(msgs.some((m) => m.startsWith('c: never starts')) && msgs.some((m) => m.startsWith('d: never starts')), 'problem: stray missions');
check(!msgs.some((m) => m.startsWith('s2')), 'a flag that is set is fine');
check(fl.flags.get('stop')?.blocks.length === 1 && fl.flags.get('go')?.setBy[0].id === 's1', 'flag index: set by, blocks');

// ---------- diff, search, used by ----------
const d = T.lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
check(d.map((x) => x.op + x.line).join('|') === ' a|+B|-b| c| d|+e', `line diff (${d.map((x) => x.op + x.line).join('|')})`);
const recs = [
  { coll: 'units', id: 'tank', title: 'Tank', data: { name: 'Tank', description: 'Heavy armour, slow', model: 'exo-tank' } },
  { coll: 'regions', id: 'touchdown', title: 'Touchdown', data: { name: 'Touchdown', camps: [{ x: 0, z: 0, group: 'vell' }] } },
];
check(T.searchContent(recs, 'ARMOUR')[0]?.snippet.includes('Heavy armour'), 'search finds text inside a record, with a snippet');
check(T.searchContent(recs, 'touch')[0]?.id === 'touchdown', 'search finds names');
const used = T.refsTo(recs, 'inhabitants', 'vell');
check(used.length === 1 && /Inhabitant camps 1/.test(used[0].field), 'used by: a ref inside a list is found');
check(T.refsTo(recs, 'assets', 'exo-tank').length === 1, 'used by: a plain ref is found');

// ---------- the pages ----------
const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? 'http://localhost:5176/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${url}editor.html#flow`);
await page.waitForSelector('.fl-mission');
check(await page.locator('.fl-mission').count() >= 5, 'flow: the campaign lists the missions');
check((await page.textContent('.fl-camp')).includes('Touchdown'), 'flow: starting with Touchdown');
await page.click('.fl-mission .fl-link >> nth=1');
await page.waitForSelector('#story-sum div');
check(/missions\/groundwork\.json$/.test(await page.textContent('.path')), 'flow: a link opens the record');

await page.goto(`${url}editor.html#balance`);
await page.waitForSelector('table.bal');
const firstUnit = () => page.locator('table.bal >> nth=0 >> tr >> nth=1 >> td >> nth=0').textContent();
await page.click('table.bal >> nth=0 >> th:has-text("HP")');
const top = await firstUnit();
await page.click('table.bal >> nth=0 >> th:has-text("HP")');
check(top !== (await firstUnit()), `balance: clicking a column sorts, again reverses (${top})`);

await page.goto(`${url}editor.html#inhabitants/vell.json`);
await page.waitForSelector('#aside .used-by');
check((await page.textContent('#aside')).includes('Touchdown'), 'used by: the Vell are used by Touchdown');
await page.click('#main h1');
await page.keyboard.press('/');
await page.keyboard.type('song-keeper');
await page.waitForSelector('#side .search-hit');
check((await page.locator('#side .search-hit').count()) >= 1, 'search: "/" focuses it, typing lists matches');
await page.keyboard.press('Escape');
check((await page.locator('#side .search-hit').count()) === 0, 'search: Esc clears it');

// review: make a change on disk through the editor API, look, put it back
const p = 'units/rover.json';
const orig = await page.evaluate(async (p) => (await (await fetch(`/__content/file?path=${p}`)).json()), p);
const changedText = orig.text.replace(/"hp": (\d+)/, (_, n) => `"hp": ${Number(n) + 1}`);
await page.evaluate(async ([p, t, h]) => fetch('/__content/file', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-exo-editor': '1' }, body: JSON.stringify({ path: p, text: t, baseHash: h }) }), [p, changedText, orig.hash]);
try {
  await page.goto(`${url}editor.html#review`);
  await page.waitForSelector('.rv-file');
  const box = page.locator('.rv-file', { hasText: 'units/rover.json' });
  check(await box.count() === 1, 'review: the changed file is listed');
  check((await box.locator('.del').textContent()).includes('"hp"') && (await box.locator('.add').textContent()).includes('"hp"'), 'review: with its old and new line');
} finally {
  const now = await page.evaluate(async (p) => (await (await fetch(`/__content/file?path=${p}`)).json()), p);
  await page.evaluate(async ([p, t, h]) => fetch('/__content/file', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-exo-editor': '1' }, body: JSON.stringify({ path: p, text: t, baseHash: h }) }), [p, orig.text, now.hash]);
}
check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall editor tool checks passed');
process.exit(failed ? 1 : 0);
