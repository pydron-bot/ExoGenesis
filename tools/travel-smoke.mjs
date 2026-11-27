/**
 * Campaign travel (TECH.md "Campaign travel"): the travel / route / unroute effects, the here / visited
 * conditions, story events and missions set in another region, the shared campaign state laid over a region's
 * own save, expedition packages (no colonists, no cryo bank), and the playthrough bot's record of a trip
 * (headless, the real sim); then the game in a browser: a fresh campaign, a route from the story inspector,
 * travel to an expedition (its package, the flags kept, the address cleaned), the Command Core's and the
 * Launch Gantry's route lists, home again with the colony as it was, back out to the expedition's own save,
 * and CONTINUE on the title going to the campaign's current region.
 *   node tools/travel-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 * The browser half writes two temporary regions into content/regions (the dev server reloads) and removes them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { answerBriefing, launch } from './lib/harness.mjs';
import { runnerImport } from 'vite';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
const headlessOnly = process.argv.includes('--headless-only');
const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

// the shipped story is left alone: these tests add their own records
const keep = { story: { ...C.story }, missions: { ...C.missions } };
for (const k of Object.keys(C.story)) delete C.story[k];
for (const k of Object.keys(C.missions)) delete C.missions[k];
const ev = (id, effects, extra = {}) => { C.story[id] = { title: id, text: id, trigger: 'never', effects: effects.map((e) => ({ after: 0, ...e })), ...extra }; };

function game(region = 'touchdown', draft) {
  M.useRegion(region, draft);
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return { sim, log };
}
const fire = (g, id) => g.sim.command({ type: 'debug', story: id });

// ---------- routes and travel ----------
{
  const g = game();
  check(JSON.stringify(g.sim.s.campaign) === JSON.stringify({ visited: ['touchdown'], routes: [] }), 'a new game starts a campaign: Touchdown visited, no routes');
  ev('t-route', [{ kind: 'route', region: 'hearthsmoke' }, { kind: 'route', region: 'choir-field' }]);
  fire(g, 't-route');
  check(g.sim.s.campaign.routes.join() === 'hearthsmoke,choir-field', 'route adds destinations');
  check(g.log.some((t) => t === 'New route: Hearthsmoke Vale'), 'logged "New route: Hearthsmoke Vale"');
  ev('t-unroute', [{ kind: 'unroute', region: 'choir-field' }]);
  fire(g, 't-unroute');
  check(g.sim.s.campaign.routes.join() === 'hearthsmoke', 'unroute takes one off');
  ev('t-stay', [{ kind: 'travel', region: 'touchdown' }]);
  fire(g, 't-stay');
  check(!g.sim.s.travel, 'travel to the region being played does nothing');
  ev('t-go', [{ kind: 'travel', region: 'hearthsmoke' }]);
  fire(g, 't-go');
  steps(g.sim, 1);
  check(g.sim.s.travel === 'hearthsmoke' && g.sim.snapshot().campaign.travel === 'hearthsmoke', 'travel asks to go (the snapshot carries it for the renderer)');
  g.sim.command({ type: 'travelled' });
  check(!g.sim.s.travel, 'a play test can drop the request');
  g.sim.command({ type: 'inspect', route: 'signal-heights' });
  g.sim.command({ type: 'inspect', unroute: 'hearthsmoke' });
  check(g.sim.s.campaign.routes.join() === 'signal-heights', 'the story inspector adds and takes off routes');
  const snap = g.sim.snapshot().campaign;
  check(snap.here === 'touchdown' && snap.home === 'touchdown' && !snap.expedition, 'snapshot: here, home, not an expedition');
}

// ---------- here / visited ----------
{
  const g = game();
  C.story['t-here'] = { title: 'here', text: '', trigger: 'here', place: 'touchdown' };
  C.story['t-there'] = { title: 'there', text: '', trigger: 'here', place: 'hearthsmoke' };
  C.story['t-been'] = { title: 'been', text: '', trigger: 'visited', place: 'hearthsmoke' };
  steps(g.sim, 12);
  check(g.sim.s.story.fired.includes('t-here') && !g.sim.s.story.fired.includes('t-there'), 'here: true in the region being played only');
  check(!g.sim.s.story.fired.includes('t-been'), 'visited: false before going');
  g.sim.s.campaign.visited.push('hearthsmoke');
  steps(g.sim, 10);
  check(g.sim.s.story.fired.includes('t-been'), 'visited: true once the region has been played');
  for (const k of ['t-here', 't-there', 't-been']) delete C.story[k];
}

// ---------- events and missions set elsewhere ----------
let shared;
let home;
{
  const g = (home = game());
  ev('t-vale', [{ kind: 'flag', flag: 'vale-seen' }], { region: 'hearthsmoke', trigger: 'start' });
  ev('t-brief', [{ kind: 'counter', counter: 'trips', amount: 1 }], { region: 'hearthsmoke' });
  C.missions['t-smoke'] = { title: 'Smoke', region: 'hearthsmoke', onStart: 't-brief', objectives: [{ text: 'Reach the stones', kind: 'site', site: 'keeper-stones' }, { text: 'Hold 1 alloy', kind: 'alloys', count: 1 }], rewards: [{ kind: 'flag', flag: 'smoke-done' }] };
  steps(g.sim, 12);
  check(!g.sim.s.story.fired.includes('t-vale'), 'an event with a region doesn\'t trigger while another region is played');
  check(!g.sim.s.missions.active.includes('t-smoke'), 'a mission elsewhere waits until the campaign can get there');
  g.sim.command({ type: 'inspect', route: 'hearthsmoke' });
  steps(g.sim, 10);
  const m = g.sim.s.missions;
  check(m.active.includes('t-smoke'), 'once routed it is under way');
  check(!g.sim.s.story.fired.includes('t-brief') && g.sim.s.story.away?.includes('t-brief'), 'its briefing (set in its region) waits there, not fired here');
  steps(g.sim, 30);
  check((m.marks['t-smoke'] ?? []).length === 0 && m.active.includes('t-smoke'), 'its objectives are not checked here (alloys held, still not met)');
  const goals = g.sim.snapshot().missions.active.find((x) => x.id === 't-smoke');
  check(!!goals, 'the GOALS panel gets it (under way)');
  g.sim.s.story.flags.push('home-flag');
  (g.sim.s.story.counters ??= {}).lead = 4;
  g.sim.s.research.done.push('deep-survey');
  g.sim.s.alloys = 4321;
  shared = M.sharedOf(g.sim.s);
}

// ---------- arriving: the shared state over a fresh expedition ----------
const trek = { ...C.regions.hearthsmoke, expedition: [{ alloys: 777, isotopes: 12, drones: 3, units: [{ unit: 'rover', count: 2 }] }] };
{
  const g = game('hearthsmoke', trek);
  const s = g.sim.s;
  check(s.region === 'hearthsmoke' && s.expedition === true, 'an expedition region starts without colonists');
  check(s.alloys === 777 && s.isotopes === 12 && s.drones.length === 3 && s.units.length === 2, `the expedition package: 777 alloys, 12 isotopes, 3 drones, 2 rovers (${s.alloys}, ${s.isotopes}, ${s.drones.length}, ${s.units.length})`);
  check(g.log.some((t) => /Expedition down in Hearthsmoke Vale/.test(t)), 'deploy says the expedition is down');
  M.applyShared(s, shared, 'hearthsmoke');
  g.sim.arrived();
  check(s.story.flags.includes('home-flag') && s.story.counters.lead === 4, 'flags and counters came along');
  check(s.research.done.includes('deep-survey'), 'research is campaign-wide');
  check(s.alloys === 777 && s.buildings.length === 1, 'the colony itself is local (alloys, buildings)');
  check(s.campaign.visited.join() === 'touchdown,hearthsmoke', 'visited: home and here');
  steps(g.sim, 12);
  check(s.story.fired.includes('t-vale') && s.story.flags.includes('vale-seen'), 'the region\'s own start event fires on arrival');
  check(s.story.fired.includes('t-brief') && s.story.counters.trips === 1 && !s.story.away?.length, 'the waiting briefing fires here');
  // the objectives: alloys held now counts; the site needs a unit there
  const site = C.regions.hearthsmoke.sites.find((x) => x.id === 'keeper-stones');
  s.units[0].x = site.x; s.units[0].z = site.z;
  steps(g.sim, 12);
  check(s.missions.done.includes('t-smoke') && s.story.flags.includes('smoke-done'), 'its objectives are met in its region: done, rewards run');
  // no cryo bank: power isn't drawn for it, and no colony loss for want of embryos
  const draw = g.sim.snapshot().draw;
  steps(g.sim, 600);
  check(!s.over && s.cryo === 100, `no cryo bank drained loss (over: ${s.over}, cryo ${s.cryo})`);
  check(draw < 1.5, `no cryo bank draw on an expedition (${draw.toFixed(2)} MW)`);
  check(g.sim.snapshot().campaign.expedition === true, 'snapshot: expedition');
  // back home: the expedition's story comes home with it
  const back = M.sharedOf(s);
  M.useRegion('touchdown');
  M.applyShared(home.sim.s, back, 'touchdown');
  check(home.sim.s.missions.done.includes('t-smoke') && home.sim.s.story.flags.includes('vale-seen') && home.sim.s.alloys === 4321, 'home again: the missions and flags from away, the home colony\'s own alloys');
}

// ---------- a save from before travel ----------
{
  const g = game();
  const old = JSON.parse(JSON.stringify(g.sim.s));
  delete old.campaign;
  g.sim.load(old);
  check(g.sim.s.campaign?.visited.join() === 'touchdown', 'an older save starts its campaign on load');
}

// ---------- the playthrough bot: travel recorded, regions all "here" ----------
{
  M.useRegion('touchdown');
  ev('t-pt-go', [{ kind: 'route', region: 'hearthsmoke' }, { kind: 'travel', region: 'hearthsmoke' }], { trigger: 'start' });
  C.missions['t-pt'] = { title: 'Away', region: 'hearthsmoke', objectives: [{ text: 'Be there', kind: 'here', place: 'hearthsmoke' }] };
  const r = M.runPlaythrough({ minutes: 1, peaceful: true, seed: 3 });
  check(r.beats.some((b) => b.kind === 'travel' && b.id === 'hearthsmoke'), 'the playthrough records the trip as a beat');
  check(r.missions['t-pt']?.done !== undefined, 'a mission set in another region is reachable in a playthrough');
}
Object.assign(C.story, keep.story);
Object.assign(C.missions, keep.missions);

if (headlessOnly) {
  console.log(failed ? `\n${failed} check(s) failed` : '\nall travel checks passed (headless)');
  process.exit(failed ? 1 : 0);
}

// ---------- browser: the game ----------
const tmp = [path.join(root, 'content/regions/zz-trek.json'), path.join(root, 'content/regions/zz-moon.json')];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ready = () => page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 120000 });
const cur = () => page.evaluate(() => { const s = __exo.sim.cur; return { region: s.campaign?.here, campaign: s.campaign, alloys: s.alloys, drones: s.drones.length, units: s.units.length, kinds: s.buildings.map((b) => b.kind).sort(), flags: s.story.flags, tick: s.tick }; });
const idb = (key) => page.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open('exogenesis', 1);
  r.onsuccess = () => { const g = r.result.transaction('saves').objectStore('saves').get(k); g.onsuccess = () => res(g.result ?? null); };
}), key);
/** Select a building and read its card (the game selects the first drone a moment after arriving: keep at it). */
const cardOf = async (kind, title) => {
  for (let i = 0; i < 20; i++) {
    await page.evaluate((k) => { const b = __exo.sim.cur.buildings.find((x) => x.kind === k); __exo.hud.d.ui.sel = { kind: 'building', id: b.id }; }, kind);
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => document.getElementById('card').innerText);
    if (t.startsWith(title)) return t;
  }
  return '';
};
/** A card button (the inspector panel can lie over the card: press it in the page). */
const press = (act) => page.evaluate((a) => document.querySelector(`#card [data-act="${a}"]`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), act);
/** The inspector redraws twice a second: click its buttons in the page. */
const inspect = async (act) => {
  await page.waitForFunction((a) => document.querySelector(`#inspector [data-act="${a}"]`), act, { timeout: 15000 });
  await page.evaluate((a) => document.querySelector(`#inspector [data-act="${a}"]`).click(), act);
};

fs.writeFileSync(tmp[0], JSON.stringify({ ...C.regions.hearthsmoke, name: 'Smoke Trek Vale', expedition: [{ alloys: 777, drones: 2, units: [{ unit: 'rover', count: 2 }] }] }, null, 1));
fs.writeFileSync(tmp[1], JSON.stringify({ ...C.regions.test_region, name: 'Smoke Moon Relay', body: 'sela', expedition: [{ alloys: 300 }] }, null, 1));
let loads = 0;
page.on('load', () => loads++);
await answerBriefing(page); // (the opening's briefing pauses the game, and travel with it)
// the arrival caption shows for a few seconds from page start (on a slow machine, gone before the game is ready): keep the first one seen
await page.addInitScript(() => { const iv = setInterval(() => { const t = document.getElementById('travel')?.innerText; if (t) { window.__arrive = t; clearInterval(iv); } }, 50); });
try {
  await page.waitForTimeout(5000);
  // a fresh campaign at home with something built
  await page.goto(`${url}?intro=0&new=1&inspect=1`);
  await ready();
  await page.evaluate(() => __exo.sim.command({ type: 'debug', setup: { buildings: ['solar', 'lab', 'launch-gantry'], research: ['orbital-launch'], flags: ['smoke-home'] } }));
  await page.waitForTimeout(800);
  let h = await cur();
  check(h.region === 'touchdown' && h.campaign.visited.join() === 'touchdown' && !h.campaign.routes.length, 'a fresh campaign at Touchdown');
  check(['launch-gantry', 'lab', 'solar'].every((k) => h.kinds.includes(k)), `home has a Solar Array, a Tech Lab and a Launch Gantry (${h.kinds.join(', ')})`);
  // routes from the story inspector
  await inspect('route:zz-trek');
  await inspect('route:zz-moon');
  await page.waitForTimeout(900);
  h = await cur();
  check(h.campaign.routes.join() === 'zz-trek,zz-moon', `the inspector adds routes (${h.campaign.routes.join()})`);
  check(/Smoke Trek Vale/.test(await page.evaluate(() => document.getElementById('inspector').innerText)), 'the inspector lists the campaign');
  // the Core: overland routes; off-world ones need the gantry
  let card = await cardOf('core', 'COMMAND CORE');
  if (!/off this world/.test(card) || /Smoke Moon/.test(card)) console.log('core card:', JSON.stringify(card));
  check(/TRAVEL/.test(card) && /Smoke Trek Vale/.test(card) && !/Smoke Moon Relay/.test(card) && /off this world: from a Launch Gantry/.test(card), 'the Command Core lists the overland route; the off-world one is for the gantry');
  card = await cardOf('launch-gantry', 'LAUNCH GANTRY');
  if (!/Smoke Moon Relay · Sela/.test(card)) console.log('card:', JSON.stringify(card));
  check(/LAUNCH/.test(card) && /Smoke Moon Relay · Sela/.test(card) && !/Smoke Trek Vale/.test(card), 'the Launch Gantry lists the off-world route');
  await page.evaluate(() => { __exo.hud.d.ui.sel = null; });
  await page.evaluate(() => __exo.sim.command({ type: 'debug', alloys: 111 }));
  await page.waitForTimeout(500);
  const before = await cur();
  // travel by the story: the inspector's Travel button
  // every caption the transition shows, as it shows them
  await page.evaluate(() => { window.__caps = []; setInterval(() => { const t = document.getElementById('travel')?.innerText; if (t && !window.__caps.includes(t)) window.__caps.push(t); }, 50); });
  await inspect('travel:zz-trek');
  await page.waitForFunction(() => window.__caps.length >= 2, null, { timeout: 60000 }).catch(async (e) => {
    console.log('travel state:', JSON.stringify(await page.evaluate(() => ({ caps: window.__caps, campaign: __exo.sim.cur.campaign, inbox: __exo.sim.cur.story.inbox, speed: __exo.sim.speed, title: !!__exo.title?.active, url: location.href }))));
    throw e;
  });
  const caption = await page.evaluate(() => window.__caps.join(' | '));
  check(/Leaving Touchdown/i.test(caption) && /Home/i.test(caption), `the transition says where you're leaving (${caption.replace(/\n/g, ' / ')})`);
  await page.waitForURL((u) => u.searchParams.get('region') === 'zz-trek', { timeout: 120000, waitUntil: 'commit' });
  await ready();
  check(!new URL(page.url()).searchParams.has('travel'), 'travel=1 is taken out of the address');
  check(await page.evaluate(() => !document.body.classList.contains('title')), 'no title screen on arrival');
  const arrive = await page.evaluate(() => window.__arrive ?? document.getElementById('travel')?.innerText ?? '');
  check(/Home · Smoke Trek Vale/i.test(arrive), `arrival caption (${arrive.replace(/\n/g, ' / ')})`);
  let t = await cur();
  check(t.region === 'zz-trek' && t.campaign.expedition, 'now playing the expedition');
  check(t.alloys >= 760 && t.alloys <= 800 && t.drones === 2 && t.units === 2, `with its package (${Math.round(t.alloys)} alloys, ${t.drones} drones, ${t.units} units)`);
  check(t.flags.includes('smoke-home') && t.campaign.routes.join() === 'zz-trek,zz-moon' && t.campaign.visited.join() === 'touchdown,zz-trek', 'flags, routes and visited came along');
  check(await page.evaluate(() => document.body.classList.contains('expedition') && getComputedStyle(document.getElementById('r-cryo')).display === 'none' && getComputedStyle(document.getElementById('r-people')).display === 'none'), 'the HUD leaves out the cryo bank and colonists');
  const homeSave = await idb('region:touchdown');
  const camp = await idb('campaign');
  check(homeSave?.sim?.region === 'touchdown' && homeSave.sim.buildings.some((b) => b.kind === 'launch-gantry'), 'the home colony is saved under its region');
  check(camp?.current === 'zz-trek' && camp.shared?.story?.flags?.includes('smoke-home'), 'the campaign record: current region and the shared state');
  // the Core on an expedition: home, and the routes
  card = await cardOf('core', 'COMMAND CORE');
  if (!/Return to Touchdown/.test(card) || !/Smoke Moon Relay/.test(card)) console.log('away card:', JSON.stringify(card));
  check(/Return to Touchdown/.test(card) && /Smoke Moon Relay/.test(card), 'the Core offers "Return to Touchdown" and the routes');
  check(!/Cryo bank/.test(card), 'no cryo bank on the Core\'s card');
  await page.evaluate(() => __exo.sim.command({ type: 'debug', alloys: 500 }));
  await page.waitForTimeout(400);
  const awayAlloys = (await cur()).alloys;
  // CONTINUE on the title goes to the campaign's current region
  await page.evaluate(() => __exo.sim.flush());
  await page.waitForTimeout(1500);
  await page.goto(`${url}?inspect=1`, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes('CONTINUE'), null, { timeout: 120000 });
  const tt = await page.evaluate(() => document.body.innerText);
  check(/CONTINUE[\s\S]*Smoke Trek Vale/.test(tt), 'the title\'s CONTINUE goes to the campaign\'s current region');
  await page.click('[data-id="continue"]');
  await page.waitForFunction(() => window.__exo?.sim.cur?.deployed && !window.__exo.title, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  t = await cur();
  check(t.region === 'zz-trek' && Math.abs(t.alloys - awayAlloys) < 40, 'CONTINUE resumes the expedition');
  // home by the Core's card (asks twice)
  await cardOf('core', 'COMMAND CORE');
  await press('travel:touchdown');
  await page.waitForTimeout(300);
  check(/Sure\? Go to Touchdown/.test(await page.evaluate(() => document.getElementById('card').innerText)), 'the Core asks to confirm');
  await press('travel:touchdown');
  await page.waitForURL((u) => u.searchParams.get('region') === 'touchdown', { timeout: 120000, waitUntil: 'commit' });
  await ready();
  await page.waitForTimeout(600);
  h = await cur();
  check(h.region === 'touchdown' && ['launch-gantry', 'lab', 'solar'].every((k) => h.kinds.includes(k)), 'home again: the colony\'s buildings are still there');
  check(Math.abs(h.alloys - before.alloys) < 40 && h.tick - before.tick < 120, `home's alloys and clock as they were (time didn't pass while away: ${before.tick} → ${h.tick})`);
  check(h.flags.includes('smoke-home') && h.campaign.visited.includes('zz-trek'), 'the campaign remembers the trip');
  // out again: the expedition's own save, not a fresh package
  await inspect('travel:zz-trek');
  await page.waitForURL((u) => u.searchParams.get('region') === 'zz-trek', { timeout: 120000, waitUntil: 'commit' });
  await ready();
  await page.waitForTimeout(600);
  t = await cur();
  check(t.alloys > 1000 && t.units === 2, `back on the expedition: its own save (${Math.round(t.alloys)} alloys)`);
} catch (e) {
  check(false, `browser run stopped: ${e.message.split('\n')[0]}`);
  console.log('page errors:', errors.slice(0, 5));
  console.log('log:', await page.evaluate(() => document.getElementById('log')?.innerText.slice(-600)).catch(() => '?'));
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall travel checks passed');
process.exit(failed ? 1 : 0);
