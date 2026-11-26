/**
 * The Field Guide (TECH.md "Field Guide").
 * Headless: tools/guide-check.mjs's rules on good and bad changelog fixtures, the real changelog and guide pass,
 * page text renders escaped (only **bold** and "- " bullets), search, badges, and a tip trigger the sim watches
 * fires once and changes nothing in the game.
 * Browser (dev server on :5176, `npx vite --port 5176`): the guide opens from the title, the game menu and
 * Controls; search; a page with bold and bullets, See also and Back; the first-game offer on a fresh profile, the
 * tour stepping through with the game paused and resuming after; a tip, Read opening its page, once per player;
 * no horizontal scroll at phone width.
 *   node tools/guide-smoke.mjs [--headless] [--shots dir]
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runnerImport } from 'vite';
import { guideProblems } from './guide-check.mjs';

const root = path.resolve(import.meta.dirname, '..');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

// ---------- guide-check rules ----------
{
  const rel = (version, guide, title = version) => ({ version, title, ...(guide !== undefined ? { guide } : {}) });
  const base = () => [rel('0.74.0', ['power']), rel('0.73.0', ['orientation']), rel('0.72.0')];
  const pages = () => ({ orientation: { since: '0.73.0' }, power: { since: '0.73.0', updated: '0.74.0' }, night: { since: '0.73.0' } });
  const has = (probs, re) => probs.some((p) => re.test(p));
  check(guideProblems(base(), pages()).length === 0, 'check: a good changelog and guide pass (the launch lists only orientation)');
  let log = base(); delete log[0].guide;
  let p = guideProblems(log, pages());
  check(has(p, /0\.74\.0.*no guide field: add guide:/), `check: a release with no guide field fails, saying what to add (${p[0]})`);
  log = base(); log[0].guide = [];
  p = guideProblems(log, pages());
  check(has(p, /feature release.*lists no Field Guide pages/), 'check: a minor release with guide: [] fails');
  log = [rel('0.75.0', ['power']), rel('0.74.0', []), ...base().slice(1)];
  { const pg2 = pages(); pg2.power.updated = '0.75.0'; check(guideProblems(log, pg2).length === 0, 'check: an older feature release may list none once its page changed again'); }
  log = [rel('0.73.1', []), ...base().slice(1)];
  const pg = pages(); delete pg.power.updated;
  check(guideProblems(log, pg).length === 0, 'check: a patch may say guide: []');
  log = [rel('0.73.1'), ...base().slice(1)];
  check(has(guideProblems(log, pg), /0\.73\.1.*no guide field/), 'check: a patch must still say guide: []');
  log = base(); log[0].guide = ['power', 'nope'];
  check(has(guideProblems(log, pages()), /lists guide page "nope".*no content\/guide\/nope\.json/), 'check: a listed page that does not exist fails');
  log = base(); log[0].guide = ['power', 'night'];
  check(has(guideProblems(log, pages()), /lists "night", but content\/guide\/night\.json says it last changed in 0\.73\.0: set "updated": "0\.74\.0"/), 'check: a listed page whose version is not the release fails');
  const p2 = pages(); p2.night.updated = '0.74.0';
  check(has(guideProblems(base(), p2), /night\.json says it changed in 0\.74\.0.*doesn't list it: add 'night'/), 'check: a page changed in a release but not listed there fails');
  const p3 = pages(); p3.night.updated = '0.75.0';
  check(has(guideProblems(base(), p3), /"updated" is 0\.75\.0, which is not a release/), 'check: a page version that is not a release fails');
  const p4 = pages(); p4.night.since = '0.60.0';
  check(has(guideProblems([...base(), rel('0.60.0')], p4), /before the Field Guide existed/), 'check: a page older than the guide fails');
  const p5 = pages(); p5.night.since = '0.74.0'; p5.night.updated = '0.73.0';
  check(has(guideProblems(base(), p5), /older than "since"/), 'check: updated older than since fails');
  const real = spawnSync(process.execPath, [path.join(root, 'tools/guide-check.mjs')], { encoding: 'utf8' });
  check(real.status === 0, `check: the shipped changelog and guide pass (${(real.stdout || real.stderr).trim().split('\n')[0]})`);
}

// ---------- the page renderer, search and badges ----------
const { module: G } = await runnerImport(path.join(root, 'src/guide.ts'));
{
  const html = G.renderText('A <script>alert("x")</script> & **bold** word\nsame para\n\n- one **b**\n- two <i>\n\nlast');
  check(!html.includes('<script>') && html.includes('&lt;script&gt;') && html.includes('&amp;') && html.includes('&lt;i&gt;'), 'render: HTML in the text is escaped');
  check(html.includes('<b>bold</b>') && html.includes('<ul><li>one <b>b</b></li><li>two &lt;i&gt;</li></ul>'), 'render: **bold** and "- " bullets');
  check(html.startsWith('<p>A ') && html.includes('word same para</p>') && html.endsWith('<p>last</p>'), 'render: paragraphs at blank lines');
  const all = G.guidePages();
  check(all.length >= 3 && all[0][0] === 'orientation' || all.some(([id]) => id === 'orientation'), `pages: ${all.length}, orientation among them`);
  const secs = all.map(([, g]) => g.section), order = ['basics', 'economy', 'power', 'defence', 'army', 'people', 'research', 'story', 'travel', 'factions', 'interface'];
  check(secs.every((s, i) => !i || order.indexOf(s) >= order.indexOf(secs[i - 1])), 'pages: in section order');
  const word = all.find(([id]) => id !== 'orientation')?.[1].title.split(/\s+/).find((w) => w.length > 4) ?? 'power';
  const hits = G.searchGuide(word.toLowerCase());
  check(hits.length >= 1 && hits.length <= all.length, `search: "${word}" finds ${hits.length}`);
  check(G.searchGuide('zzqx nothing').length === 0, 'search: nonsense finds nothing');
  check(G.badge({ since: '0.73.0' }, null) === null && G.badge({ since: '0.74.0' }, '0.73.0') === 'new' && G.badge({ since: '0.73.0', updated: '0.74.0' }, '0.73.0') === 'updated' && G.badge({ since: '0.73.0' }, '0.73.0') === null, 'badges: NEW, UPDATED, none (and none on a first look)');
}

// ---------- a tip trigger, in the sim ----------
{
  const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
  const C = M.content;
  C.guide['t-tip'] = { title: 'T', section: 'basics', order: 1, summary: 's', text: 't', since: '0.73.0', trigger: 'alloys', count: 1e6 };
  const game = (watch) => {
    const sim = new M.Sim(() => {});
    sim.newGame(7);
    sim.command({ type: 'landing', stage: 'deploy' });
    if (watch) sim.command({ type: 'guide', watch: ['t-tip', 'orientation'] });
    return sim;
  };
  const a = game(true), b = game(false);
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  check(!a.snapshot().story.tips, 'tip: not before its trigger holds');
  a.s.alloys = b.s.alloys = 1e6;
  for (let i = 0; i < 30; i++) { a.step(); b.step(); }
  check(JSON.stringify(a.snapshot().story.tips) === '["t-tip"]', `tip: fires when it holds (${JSON.stringify(a.snapshot().story.tips)}; a page with no trigger never does)`);
  for (let i = 0; i < 600; i++) { a.step(); b.step(); }
  a.command({ type: 'guide', watch: ['t-tip'] });
  for (let i = 0; i < 30; i++) { a.step(); b.step(); }
  check(a.snapshot().story.tips.length === 1, 'tip: fires once (watching it again does not repeat it)');
  check(JSON.stringify(a.s) === JSON.stringify(b.s), 'tip: watching changes nothing in the game state');
  delete C.guide['t-tip'];

  // the opening: which tips the first 10 minutes bring, played by the autopilot (a quick player) at Touchdown,
  // and when they would show, one at a time and spaced (src/guide.ts tipSchedule)
  M.useRegion('touchdown');
  const sim = new M.Sim(() => {});
  sim.newGame(11);
  const ap = new M.Autopilot(sim, () => {});
  ap.configure({ on: true });
  sim.command({ type: 'landing', stage: 'deploy' });
  const watch = Object.entries(C.guide).filter(([, g]) => g.trigger).map(([id]) => id);
  sim.command({ type: 'guide', watch });
  const hits = [];
  for (let t = 0; t < 600; t++) {
    for (let i = 0; i < 10; i++) { ap.tick(); sim.step(); }
    for (const id of [...sim.s.story.inbox]) sim.command({ type: 'story', id, choice: 0 });
    for (const id of [...(sim.s.story.cineQueue ?? [])]) sim.command({ type: 'cinematic', id, done: true });
    for (const id of sim.snapshot().story.tips ?? []) if (!hits.some((h) => h.id === id)) hits.push({ id, t: Math.round(sim.secs) });
  }
  const shown = G.tipSchedule(hits).filter((x) => x.t < 600);
  console.log(`      opening: ${watch.length} pages have tips; ${hits.length} triggers hold in the first 10 min (${hits.map((h) => `${h.id}@${h.t}s`).join(', ')})`);
  console.log(`      shown spaced ${G.TIP_GAP} s apart: ${shown.length} in the first 10 min (${shown.map((h) => `${h.id}@${h.t}s`).join(', ')})`);
  const gaps = shown.slice(1).map((x, i) => x.t - shown[i].t);
  check(shown.length <= 600 / G.TIP_GAP + 1 && gaps.every((g) => g >= G.TIP_GAP), `opening: at most one tip every ${G.TIP_GAP} s (${shown.length} in 10 min)`);
  check(!hits.some((h) => h.id === 'other-colonies') && (!C.guide['other-colonies'] || !M.conditionMet(sim, C.guide['other-colonies'].trigger, C.guide['other-colonies'], { region: 'touchdown', sites: [] })), 'opening: no faction tips at Touchdown (no factions there)');
}

if (process.argv.includes('--headless')) { console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0); }

// ---------- in the browser ----------
const { chromium } = await import('playwright');
const URL0 = `${process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 5176}/`}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const ctxFor = async (opt = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opt });
  // automated browsers get the offer and tips only when they ask (main.ts guideAuto)
  await ctx.addInitScript(() => { try { localStorage.setItem('exo.guide.auto', 'on'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
};
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
/** Wait for the tour's bubble to move on from `text` (or close): frames are slow under SwiftShader. */
const moved = (page, text) => page.waitForFunction((t) => !document.querySelector('#hint.on.act') || (document.querySelector('#hint').firstChild?.textContent ?? '') !== t, text, { timeout: 8000 }).catch(() => {});
const answerCards = async (page) => {
  for (let i = 0; i < 6; i++) {
    const b = await page.$('#contact.on button');
    if (!b) return;
    await b.click().catch(() => {});
    await page.waitForTimeout(400);
  }
};

// the shipped pages: one with bold and bullets to look at; a tip whose trigger the test can bring about
const pages = Object.fromEntries(readdirSync(path.join(root, 'content/guide')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(path.join(root, 'content/guide', f), 'utf8'))]));
const rich = Object.entries(pages).find(([, g]) => /\*\*.+\*\*/.test(g.text) && /^- /m.test(g.text))?.[0];
const tipPage = Object.entries(pages).filter(([, g]) => g.trigger === 'time' && g.sol).sort((x, y) => x[1].sol - y[1].sol)[0]?.[0]
  ?? Object.entries(pages).find(([, g]) => g.trigger === 'alloys')?.[0];

try {
  // ---- the title screen
  {
    const { ctx, page } = await ctxFor();
    await page.goto(`${URL0}?sw=0`);
    await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title [data-id="guide"]'), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    await page.click('#title [data-id="guide"]');
    await page.waitForSelector('#guide .gd-row');
    const secs = await page.$$eval('#guide .gd-sec', (e) => e.map((x) => x.textContent));
    check(secs.length >= 2 && secs[0].toLowerCase() === 'basics', `title: FIELD GUIDE opens the guide (${secs.join(', ')})`);
    check(!(await page.$('#guide .gd-tour')), 'title: no Show me around without a colony on screen');
    const word = (await page.$eval(`#guide [data-page="${rich ?? 'orientation'}"] b`, (e) => e.textContent)).split(/\s+/).find((w) => w.length > 3) ?? 'power';
    await page.fill('#guide .gd-q', word);
    const found = await page.$$eval('#guide .gd-row', (e) => e.map((x) => x.dataset.page));
    check(found.length >= 1 && found.includes(rich ?? 'orientation'), `title: search "${word}" finds ${found.join(', ')}`);
    await page.fill('#guide .gd-q', '');
    if (rich) {
      await page.click(`#guide [data-page="${rich}"]`);
      await page.waitForSelector('#guide .gd-page');
      const t = await page.$eval('#guide .gd-text', (e) => ({ b: e.querySelectorAll('b').length, li: e.querySelectorAll('ul li').length, scripts: e.querySelectorAll('script, img, iframe').length }));
      check(t.b > 0 && t.li > 0 && !t.scripts, `page "${rich}": bold (${t.b}) and bullets (${t.li}), nothing else`);
      const see = await page.$$eval('#guide .gd-see [data-page]', (e) => e.map((x) => x.dataset.page));
      if (see.length) {
        await page.click(`#guide .gd-see [data-page="${see[0]}"]`);
        const at = await page.$eval('#guide .gd-page', (e) => e.dataset.id);
        check(at === see[0], `See also opens ${see[0]}`);
        await page.click('#guide .gd-back');
        check(await page.$eval('#guide .gd-page', (e) => e.dataset.id) === rich, 'Back returns to the page before');
      }
      await shot(page, 'guide-page');
      await page.click('#guide .gd-back');
      check(!!(await page.$('#guide .gd-row')) && !(await page.$('#guide .gd-page')), 'Back from the first page: the list');
    }
    await page.keyboard.press('Escape');
    check(!(await page.$('#guide')) && !!(await page.$('#title')), 'Escape closes it, back on the title');
    await ctx.close();
  }

  // ---- a first game: the offer, the tour, a tip
  {
    const { ctx, page } = await ctxFor();
    await page.goto(`${URL0}?sw=0&intro=0&new=1`);
    await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });
    // the briefing card first (the offer waits for it)
    await page.waitForSelector('#contact.on', { timeout: 30000 }).catch(() => {});
    check(!(await page.$('#gd-offer:not(.hold)')), 'first game: no offer over a story card');
    await answerCards(page);
    await page.waitForSelector('#gd-offer:not(.hold)', { timeout: 30000 }).catch(() => {});
    check(!!(await page.$('#gd-offer:not(.hold)')), 'first game: "First time? A two-minute look around." offered');
    await shot(page, 'guide-offer');
    await page.click('#gd-offer .gd-yes');
    await page.waitForSelector('#hint.on.act');
    check(await page.evaluate(() => __exo.speed === 0), 'tour: the game is paused');
    const steps = [];
    for (let i = 0; i < 20 && (await page.$('#hint.on.act')); i++) {
      steps.push(await page.evaluate(() => ({ text: document.querySelector('#hint').firstChild?.textContent ?? '', hinted: document.querySelector('.hinted')?.id ?? '' })));
      if (i === 1) {
        await page.keyboard.press('ArrowLeft');
        await moved(page, steps[1].text);
        const back = await page.evaluate(() => document.querySelector('#hint').firstChild?.textContent ?? '');
        check(back === steps[0].text, 'tour: ← goes back a step');
        await page.keyboard.press('ArrowRight');
        await moved(page, steps[0].text);
        await shot(page, 'guide-tour');
      }
      await page.keyboard.press(i % 2 ? 'Enter' : 'ArrowRight');
      await moved(page, steps[steps.length - 1].text);
    }
    const want = pages.orientation.tour.length;
    check(steps.length >= Math.min(8, want) && steps.every((s) => s.hinted), `tour: ${steps.length} of ${want} steps, each pulsing its HUD element (${steps.map((s) => s.hinted).join(' ')})`);
    check(!(await page.$('#hint.act')) && await page.evaluate(() => __exo.speed === 1), 'tour: over, the game runs again');
    check(await page.evaluate(() => !!localStorage.getItem('exo.guide.toured')), 'tour: remembered (exo.guide.toured)');
    // the menu: the guide in game, with Show me around; Esc back to the menu
    await page.click('#b-menu');
    await page.waitForSelector('#options.menu');
    await page.click('#options [data-id="guide"]');
    await page.waitForSelector('#guide .gd-tour');
    check(true, 'menu: Field Guide opens, with Show me around');
    await page.keyboard.press('Escape');
    check(!(await page.$('#guide')) && !!(await page.$('#options.menu')), 'menu: Escape closes the guide, back to the menu');
    await page.click('#options [data-id="controls"]');
    await page.click('#options .op-guide');
    check(!!(await page.$('#guide')), 'Controls: the Field Guide button opens it');
    await page.keyboard.press('Escape');
    check(!(await page.$('#guide')) && !!(await page.$('#options.info')), 'Controls: Escape closes the guide, Controls stays');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(!(await page.$('#options')) && await page.evaluate(() => __exo.speed === 1), 'menu closed, the game runs');
    // Show me around replays the tour from the menu's guide
    await page.click('#b-menu');
    await page.click('#options [data-id="guide"]');
    await page.click('#guide .gd-tour');
    await page.waitForSelector('#hint.on.act');
    check(await page.evaluate(() => __exo.speed === 0 && !document.querySelector('#options')), 'Show me around: the tour again, paused, the menu gone');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#hint.act'), null, { timeout: 8000 }).catch(() => {});
    check(!(await page.$('#hint.act')) && await page.evaluate(() => __exo.speed === 1), 'tour: Esc skips it, the game runs');
    // a tip
    if (tipPage) {
      const g0 = pages[tipPage];
      if (g0.trigger === 'time') await page.evaluate((s) => __exo.sim.command({ type: 'inspect', skip: Math.max(0, (s - 1) * 360 - __exo.sim.cur.secs + 5) }), g0.sol);
      else await page.evaluate(() => __exo.sim.command({ type: 'debug', alloys: 100000 }));
      // whichever tip comes first (others may have held too: they queue, one at a time)
      let shown = null, alone = false;
      for (let i = 0; i < 80 && !shown; i++) {
        await answerCards(page);
        // seen, checked and Read in one go (a card coming up would hide it; slow frames make a click slow)
        [shown, alone] = await page.evaluate(() => {
          const t = document.querySelector('#gd-tip.on');
          if (!t) return [null, false];
          const one = document.querySelectorAll('#gd-tip.on, #contact.on, #gd-offer').length === 1;
          t.querySelector('.gd-read').click();
          return [t.dataset.page, one];
        });
        if (!shown) await page.waitForTimeout(500);
      }
      check(!!shown, `tip: "${shown ? pages[shown].title : '?'}" offered when its trigger holds`);
      const tipPage2 = shown ?? tipPage, g = pages[tipPage2];
      check(alone, 'tip: one at a time, never over a story card');
      await page.waitForSelector('#guide .gd-page');
      check(await page.$eval('#guide .gd-page', (e) => e.dataset.id) === tipPage2 && await page.evaluate(() => __exo.speed === 0), 'tip: Read opens its page, the game held');
      const showBtn = await page.$('#guide .gd-show:not(.gd-tour2)');
      if (g.points && !showBtn) {
        // its element isn't on screen yet (the threat counter before a Radar): no Show me pointing at nothing
        const hidden = await page.evaluate((t) => { const el = document.querySelector('.hinted'); return !el; }, g.points);
        check(hidden, `Show me: not offered while ${g.points} isn't on screen (${tipPage2})`);
        for (let i = 0; i < 3 && (await page.$('#guide')); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
        // and one whose element is on screen (power → ⚡), from the menu's guide
        await page.waitForTimeout(500);
        await page.click('#b-menu');
        await page.click('#options [data-id="guide"]');
        await page.click('#guide [data-page="power"]');
        await page.click('#guide .gd-show:not(.gd-tour2)');
        await page.waitForSelector('#hint.on.act');
        const dbg = await page.evaluate(() => ({ guide: !!document.querySelector('#guide'), menu: !!document.querySelector('#options'), speed: __exo.speed, hinted: document.querySelector('.hinted')?.id ?? null }));
        check(!dbg.guide && !dbg.menu && dbg.speed === 1 && !!dbg.hinted, `Show me: the guide closes, the HUD element pulses, the game runs (power → energy: ${JSON.stringify(dbg)})`);
        await page.click('#hint .acts button');
      } else if (g.points) {
        await page.click('#guide .gd-show');
        await page.waitForSelector('#hint.on.act');
        const dbg = await page.evaluate(() => ({ guide: !!document.querySelector('#guide'), speed: __exo.speed, hinted: document.querySelector('.hinted')?.id ?? null }));
        check(!dbg.guide && dbg.speed === 1 && !!dbg.hinted, `Show me: the guide closes, the HUD element pulses, the game runs (${tipPage2} → ${g.points}: ${JSON.stringify(dbg)})`);
        await page.click('#hint .acts button');
      } else {
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => __exo.speed === 1), 'tip: closing the guide lets the game go');
      }
      check(await page.evaluate((id) => JSON.parse(localStorage.getItem('exo.guide.tipped') ?? '[]').includes(id), tipPage2), 'tip: remembered (exo.guide.tipped)');
      // the next one waits its turn (TIP_GAP s of play)
      await page.waitForTimeout(3000);
      check(!(await page.$('#gd-tip.on')), 'tip: the next one does not follow straight away');
      // once per player: a new game doesn't offer it again
      await page.goto(`${URL0}?sw=0&intro=0&new=1`);
      await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 300000 });
      const watched = await page.evaluate(() => __exo.guideTips.watch());
      check(!watched.includes(tipPage2) && !(await page.$('#gd-offer')), 'once per player: not watched again, and no second offer');
    } else console.log('SKIP  no guide page with a time or alloys trigger to test a tip with');
    await ctx.close();
  }

  // ---- phone width
  {
    const { ctx, page } = await ctxFor({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${URL0}?sw=0`);
    await page.waitForFunction(() => window.__exo?.ready && document.querySelector('#title [data-id="guide"]'), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    await page.tap('#title [data-id="guide"]');
    await page.waitForSelector('#guide .gd-row');
    const wide = () => page.evaluate(() => {
      const b = document.querySelector('#guide .gd-body'), p = document.querySelector('#guide .gd-panel').getBoundingClientRect();
      return { page: document.documentElement.scrollWidth > innerWidth, body: b.scrollWidth > b.clientWidth + 1, panel: p.left < 0 || p.right > innerWidth };
    });
    let w = await wide();
    check(!w.page && !w.body && !w.panel, `phone: the list fits (${JSON.stringify(w)})`);
    await page.tap(`#guide [data-page="${rich ?? 'orientation'}"]`);
    w = await wide();
    check(!w.page && !w.body && !w.panel, `phone: a page fits (${JSON.stringify(w)})`);
    await shot(page, 'guide-phone');
    await ctx.close();
  }
} finally {
  await browser.close();
}
check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
