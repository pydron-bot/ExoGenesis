/**
 * Editor checks and record tools: undo / redo, full content checks next to the
 * fields and on the Problems page, Rename (references follow), Compare, the
 * Text page and "Since last release". Pure helpers headless, then the pages in
 * the dev editor. Writes temporary records under content/story/ and removes them.
 *   node tools/editor-checks-smoke.mjs [--url http://localhost:5176/]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: P } = await runnerImport(path.join(root, 'src/editor/pages.ts'));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- helpers ----------
const recs = [
  { coll: 'story', id: 'a', title: 'A', data: { title: 'A', text: 'Hi', trigger: 'start' } },
  { coll: 'story', id: 'b', title: 'B', data: { title: 'B', text: 'x', trigger: 'after', event: 'a', effects: [{ after: 0, kind: 'event', event: 'a' }] } },
  { coll: 'missions', id: 'm', title: 'M', data: { title: 'M', objectives: [], onDone: 'a' } },
];
const ren = P.renameRefs(recs, 'story', 'a', 'z');
check(ren.length === 2 && ren.find((r) => r.id === 'b').data.event === 'z' && ren.find((r) => r.id === 'b').data.effects[0].event === 'z', 'rename: refs and refs inside lists follow');
check(recs[1].data.event === 'a', 'rename: the inputs are left alone');
const d = { choices: [{ label: 'x' }] };
P.setAt(d, 'choices[0].reply', 'hi');
check(P.getAt(d, 'choices[0].reply') === 'hi', 'set / get a path inside a list');
check(P.textChecks('Hello  there', false).includes('double space'), 'text: double space');
check(P.textChecks('"Open quote', false).includes('unmatched "'), 'text: unmatched quote');
check(P.textChecks('the the end.', false).some((n) => n.startsWith('repeated word')), 'text: repeated word');
check(P.textChecks('It ended. then it began.', false).includes('sentence starts lower-case'), 'text: sentence case');
check(P.textChecks('A tidy sentence.', true).length === 0, 'text: a clean sentence has no notes');
const tx = P.collectText([...recs, { coll: 'regions', id: 'r', title: 'R', data: { name: 'Region', sites: [{ id: 's', label: 'note' }] } }]);
check(tx.some((e) => e.field === 'text' && e.id === 'a') && !tx.some((e) => e.coll === 'regions'), 'text: collects cards, skips editor-only region text');
const ch = P.diffContent({ 'units/x.json': { name: 'X', hp: 100 } }, { 'units/x.json': { name: 'X', hp: 150 }, 'units/y.json': { name: 'Y' } }, (p) => ({ coll: 'units', id: p.slice(6, -5) }));
check(ch.length === 2 && ch[0].fields[0].before === '100' && ch[0].fields[0].after === '150' && ch[1].status === 'added', 'changes: field-level diff, new records');
check(/hit points 100 → 150/.test(P.notesDraft(ch)), 'changes: release note draft');

// ---------- the pages ----------
const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const tmp = ['zz-one', 'zz-two', 'zz-renamed'].map((id) => path.join(root, 'content/story', `${id}.json`));
await fs.writeFile(tmp[0], JSON.stringify({ title: 'Zed One', text: 'Hello  there.', trigger: 'never' }, null, 2) + '\n');
await fs.writeFile(tmp[1], JSON.stringify({ title: 'Zed Two', text: 'Follows.', trigger: 'after', event: 'zz-one' }, null, 2) + '\n');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('dialog', (dl) => void (dl.type() === 'prompt' ? dl.accept('zz-renamed') : dl.accept()));
try {
  // undo / redo
  await page.goto(`${url}editor.html#units/rover.json`);
  await page.waitForSelector('.row[data-key=hp] input');
  const hp = page.locator('.row[data-key=hp] input');
  const was = await hp.inputValue();
  await hp.fill('4242');
  await page.locator('.row[data-key=speed] input').fill('9.5');
  await page.click('#undo');
  check(await page.locator('.row[data-key=speed] input').inputValue() !== '9.5' && await hp.inputValue() === '4242', 'undo: one step back');
  await page.keyboard.press('Control+z');
  check(await hp.inputValue() === was, 'undo: Ctrl+Z back to the saved value');
  await page.keyboard.press('Control+Shift+z');
  check(await hp.inputValue() === '4242', 'redo: Ctrl+Shift+Z');
  await page.click('#revert');

  // cross-record checks show at the field
  await page.goto(`${url}editor.html#story/the-stone.json`);
  await page.waitForSelector('.row[data-key=site] input');
  await page.locator('.row[data-key=site] input').fill('nowhere');
  check(/story site "nowhere"/.test(await page.textContent('.row[data-key=site] .issue')), 'checks: a missing story site shows next to the field');
  await page.click('#revert');

  // problems page
  await page.goto(`${url}editor.html#problems`);
  await page.waitForSelector('#main h1');
  check((await page.textContent('#main')).includes('No problems'), 'problems: none in saved content');

  // compare
  await page.goto(`${url}editor.html#compare/units/rover/tank`);
  await page.waitForSelector('table.cmp tr.diff');
  check(await page.locator('table.cmp tr.diff').count() > 3, 'compare: rover and tank differ in several fields');
  check(/%\)/.test(await page.textContent('table.cmp')), 'compare: numbers show the change');

  // text page
  await page.goto(`${url}editor.html#text`);
  await page.waitForSelector('.tx-row');
  await page.fill('.tx-filter', 'Zed One');
  check((await page.textContent('.tx-list')).includes('double space'), 'text: notes a double space');
  const box = page.locator('.tx-row:has(.tx-label:text-is("Text")) textarea').first();
  await box.fill('Hello there.');
  await page.locator('.tx-filter').click();
  await page.waitForTimeout(400);
  check(JSON.parse(await fs.readFile(tmp[0], 'utf8')).text === 'Hello there.', 'text: an edit saves to the file');

  // rename: the event that follows it is updated
  await page.goto(`${url}editor.html#story/zz-one.json`);
  await page.waitForSelector('button:text("Rename")');
  await page.click('button:text("Rename")');
  await page.waitForFunction(() => location.hash.includes('zz-renamed'));
  const two = JSON.parse(await fs.readFile(tmp[1], 'utf8'));
  check(two.event === 'zz-renamed', 'rename: references follow the new id');
  check(!(await fs.stat(tmp[0]).then(() => true, () => false)), 'rename: the old file is gone');

  // since last release
  await page.goto(`${url}editor.html#changes`);
  await page.waitForSelector('.chg .rv-file, .chg .note', { timeout: 20000 });
  check((await page.textContent('.chg')).includes('Zed Two'), 'since last release: lists a new record');
  check((await page.inputValue('.chg-notes')).includes('New: Zed Two'), 'since last release: drafts notes');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  for (const f of tmp) await fs.rm(f, { force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall editor check-tool checks passed');
process.exit(failed ? 1 : 0);
