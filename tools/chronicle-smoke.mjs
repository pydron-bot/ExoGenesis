/**
 * The Chronicle (src/sim/chronicle.ts records, src/chronicle.ts tells; TECH §6 "The Chronicle"): headless, a long
 * peaceful colony is recorded (everyone who lived, parents, the blocs every 30 s, key moments, a death with its cause,
 * a walkout), survives a save, and lays out as a family tree by generation; then in the browser (desktop and phone)
 * that colony loaded into the game: the menu's Chronicle page, Save image (a PNG), and the end screen's button.
 *   node tools/chronicle-smoke.mjs [--url http://localhost:5196/] [--headless-only] [--minutes 55]   (or PORT=5196)
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const { module: P } = await runnerImport(path.join(root, 'src/sim/playthrough.ts'));
const { module: CH } = await runnerImport(path.join(root, 'src/chronicle.ts'));
const { content: C } = (await runnerImport(path.join(root, 'src/content/index.ts'))).module;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const SOL = C.colony.solSeconds;

// ---------- headless: a colony that lives long enough to have children ----------
let sim;
P.runPlaythrough({ strategy: 'opening', minutes: Number(arg('--minutes', 55)), seed: 1337, pace: 2, peaceful: true, onTick: (x) => { sim = x; } });
const s = sim.s, ch = s.chronicle;
check(!!ch, 'the campaign keeps a chronicle');
const living = s.people.colonists;
check(living.every((c) => ch.people.some((p) => p.id === c.id && p.name === c.name)), `everyone living is in it (${living.length} living, ${ch.people.length} ever)`);
const kids = ch.people.filter((p) => p.origin === 'born');
check(kids.length > 0 && kids.every((k) => k.parents?.every((id) => ch.people.some((p) => p.id === id))), `children born in the colony, with both parents recorded (${kids.length})`);
check(ch.samples.length > 50 && ch.samples.every((x, i) => !i || x[0] > ch.samples[i - 1][0]), `the blocs sampled through the game (${ch.samples.length} samples)`);
const kinds = new Set(ch.events.map((e) => e.kind));
check(['mission', 'story', 'birth'].every((k) => kinds.has(k)), `key moments: ${[...kinds].join(', ')}`);
// a death and a walkout, as the people system does them
const victim = living[0];
sim.people.kill(victim, 'killed in the smoke test');
for (let i = 0; i < 20; i++) sim.step();
const vp = ch.people.find((p) => p.id === victim.id);
check(vp.end?.how === 'died' && vp.end.cause === 'killed in the smoke test', `a death is kept with its cause (${vp.name}: ${vp.end?.cause})`);
check(ch.events.some((e) => e.kind === 'death' && e.text.startsWith(victim.name)), 'and is a key moment');
const leaver = s.people.colonists[s.people.colonists.length - 1];
s.people.colonists.splice(s.people.colonists.indexOf(leaver), 1);
s.people.departed++;
for (let i = 0; i < 20; i++) sim.step();
check(ch.people.find((p) => p.id === leaver.id)?.end?.how === 'left' && ch.events.some((e) => e.kind === 'walkout'), 'someone who walks out is kept as walked out, and the walkout is a moment');
// save / load
const saved = JSON.parse(JSON.stringify(s));
check(saved.chronicle.people.length === ch.people.length && saved.chronicle.events.length === ch.events.length, 'it saves with the game');
// the model and the tree
const model = CH.chronicleModel(saved, { region: 'Touchdown', solSeconds: SOL, lineages: C.people.lineages });
check(model.totals.lived === ch.people.length && model.totals.died >= 1 && model.totals.left >= 1 && model.totals.generations >= 2, `the model: ${model.totals.lived} lived, ${model.totals.born} born, ${model.totals.died} died, ${model.totals.left} walked out, ${model.totals.generations} generations, ${model.totals.linesLeft}/${model.totals.lines} lines`);
const tree = CH.treeLayout(model.people);
const at = new Map(tree.nodes.map((n) => [n.p.id, n]));
check(tree.nodes.length === model.people.length && tree.links.length === kids.reduce((m, k) => m + (k.parents?.length ?? 0), 0), `the tree: a node each, a line to each parent (${tree.links.length})`);
check(kids.every((k) => k.parents.every((id) => at.get(id).y < at.get(k.id).y)), 'children sit below their parents');
check(model.memorial.some((m) => m.cause === 'killed in the smoke test') && !model.memorial.some((m) => /left to found/.test(m.cause) || /^Unnamed/.test(m.name)), `the memorial lists the dead by name, not those who left (pod losses as one line: ${model.podLosses})`);

// ---------- browser ----------
if (!process.argv.includes('--headless-only')) {
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? `http://localhost:${process.env.PORT ?? 5196}/`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const vp of [{ width: 1400, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone', touch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, acceptDownloads: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?intro=0&new=1&title=0&sw=0&scratch=1`);
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.missions, null, { timeout: 300000 });
    await page.evaluate((st) => __exo.sim.load(st), saved);
    await page.waitForFunction((n) => (__exo.sim.cur?.people?.adults ?? 0) + (__exo.sim.cur?.people?.children ?? 0) >= n, living.length - 2, { timeout: 30000 });
    await page.click('#b-menu');
    await page.click('#options .op-row[data-id="chronicle"]');
    await page.waitForSelector('#chronicle .ch-tree', { timeout: 20000 });
    const nodes = await page.locator('#chronicle .ch-node').count();
    check(nodes === model.people.length, `${vp.name}: the menu's Chronicle draws the family tree (${nodes} people)`);
    const text = await page.textContent('#chronicle');
    check(/How the blocs shifted/i.test(text) && /Key moments/i.test(text) && /Memorial/i.test(text) && /killed in the smoke test/.test(text) && /SOL 1/.test(text), `${vp.name}: with the blocs, key moments by sol and the memorial`);
    const painted = await page.evaluate(() => {
      const cv = document.querySelector('#chronicle .ch-blocs'), g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) n++;
      return n / (cv.width * cv.height);
    });
    check(painted > 0.2, `${vp.name}: the bloc chart is drawn (${Math.round(painted * 100)}% painted)`);
    const wide = await page.evaluate(() => document.querySelector('#chronicle .ch-page').scrollWidth <= document.querySelector('#chronicle').clientWidth + 1);
    check(wide, `${vp.name}: the page fits the screen's width (the tree scrolls on its own)`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#chronicle .ch-img')]);
    const file = await dl.path();
    const { readFileSync } = await import('node:fs');
    const png = readFileSync(file);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    check(dl.suggestedFilename().startsWith('exo-chronicle-sol-') && png.slice(1, 4).toString() === 'PNG' && w === 1200 && h > 900, `${vp.name}: Save image gives a ${w}×${h} PNG (${dl.suggestedFilename()})`);
    if (process.argv.includes('--shots')) { await page.screenshot({ path: path.join(root, `scratch/chronicle-${vp.name}.png`) }); if (!vp.touch) { const { copyFileSync } = await import('node:fs'); copyFileSync(file, path.join(root, 'scratch/chronicle-export.png')); } }
    await page.click('#chronicle .ch-x');
    check(await page.locator('#chronicle').count() === 0, `${vp.name}: × closes it`);
    // the end of the run opens it
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const core = __exo.sim.cur.buildings.find((b) => b.kind === 'core'); __exo.sim.command({ type: 'debug', hurt: { id: core.id, hp: 1e6 } }); });
    await page.waitForSelector('#over.on', { timeout: 20000 });
    check(await page.isVisible('#over-chronicle'), `${vp.name}: the end screen offers the Chronicle`);
    await page.click('#over-chronicle');
    await page.waitForSelector('#chronicle .ch-page', { timeout: 20000 });
    check(/The colony fell/.test(await page.textContent('#chronicle .ch-sub')), `${vp.name}: and it tells how the colony fell`);
    await page.click('#chronicle .ch-x');
    check(await page.isVisible('#over-restart'), `${vp.name}: closing it goes back to the end screen`);
    check(!errs.length, `${vp.name}: no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall chronicle checks passed');
process.exit(failed ? 1 : 0);
