/**
 * Factions and the climax (headless with the real sim, then a short browser check):
 * campaign factions (neutral until attacked, hostile, allied; outposts, faction
 * encounters, flags that turn them, the attitude effect, save/load), the climax
 * effects (strike with its warning and the shield, corrupt, glitch, epilogue) and
 * the conditions (faction, factionLost, partners, majority).
 *   node tools/climax-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
const HZ = 10;

// the shipped story is left alone: these tests add their own records
const keep = { story: { ...C.story }, missions: { ...C.missions } };
for (const k of Object.keys(C.story)) delete C.story[k];
for (const k of Object.keys(C.missions)) delete C.missions[k];
const ev = (id, effects, extra = {}) => { C.story[id] = { title: id, text: id, trigger: 'never', effects: effects.map((e) => ({ after: 0, ...e })), ...extra }; };

// a region with three factions: Kindred (neutral, east), Engram (hostile, far west), the Vell guard (allied, north)
const base = C.regions.touchdown;
const region = {
  ...base,
  sites: [...(base.sites ?? []), { id: 'hit-a', x: -30, z: -40, r: 6 }, { id: 'hit-b', x: 30, z: -40, r: 6 }],
  factions: [
    { id: 'kindred', name: 'Kindred', color: '#e0a040', team: 2, attitude: 'neutral', flag: 'kindred-angry', allyFlag: 'kindred-friends' },
    { id: 'engram', name: 'Engram', color: '#ff8a2a', team: 3, attitude: 'hostile' },
    { id: 'vellguard', name: 'Vell guard', color: '#8fd46a', team: 4, attitude: 'allied' },
  ],
  outposts: [
    { kind: 'turret', x: 60, z: 0, faction: 'kindred', story: 'kindred-turret-down' },
    { kind: 'solar', x: 70, z: 10, faction: 'kindred' },
    { kind: 'turret', x: -100, z: 0, faction: 'engram' },
  ],
  encounters: [
    ...(base.encounters ?? []),
    { id: 'kin-guard', unit: 'rover', count: 2, x: 62, z: 14, mode: 'guard', r: 14, faction: 'kindred' },
    { id: 'vell-band', unit: 'tank', count: 3, x: 0, z: 100, mode: 'guard', r: 20, faction: 'vellguard', doneFlag: 'vell-band-down' },
  ],
};
M.useRegion('touchdown', region);

function game() {
  const log = [];
  const sim = new M.Sim((t, l, cue, at, style) => log.push({ t, style }));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  steps(sim, HZ + 1); // the encounters appear on the next second
  return { sim, log, st: () => sim.s.story, has: (re) => log.some((x) => re.test(x.t)) };
}
const fire = (g, id) => g.sim.command({ type: 'debug', story: id });
const team = (sim, t) => ({ b: sim.s.buildings.filter((x) => x.team === t), u: sim.s.units.filter((x) => x.team === t) });
const hpSum = (xs) => xs.reduce((s, x) => s + x.hp, 0);
// (the story checks conditions in the colony's own view, as here)
const cond = (sim, kind, c = {}) => sim.withTeam(0, () => M.conditionMet(sim, kind, c, { sites: region.sites }));

// ---------- factions: setup, neutral, attacked, hostile, allied ----------
{
  const g = game(), s = g.sim.s;
  check(s.factions?.length === 3 && s.factions[0].attitude === 'neutral', 'factions start with the region\'s attitudes');
  const kin = team(g.sim, 2);
  check(kin.b.length === 2 && kin.b.every((b) => b.progress === 1 && b.powered), 'outposts stand ready, theirs (team 2)');
  check(kin.u.length === 2 && kin.u.every((u) => u.unit === 'rover'), 'a faction encounter is Accord units of that team');
  check(team(g.sim, 4).u.length === 3, 'the allied band is there');
  check(cond(g.sim, 'faction', { faction: 'kindred', attitude: 'neutral' }) && !cond(g.sim, 'faction', { faction: 'kindred', attitude: 'hostile' }), 'faction condition reads the attitude');
  // our rovers right by Kindred's outpost: nobody shoots
  g.sim.command({ type: 'debug', units: { unit: 'rover', x: 52, z: 4, n: 2 } });
  const ours = s.units.filter((u) => !u.team);
  const hp0 = hpSum(ours), kin0 = hpSum([...kin.b, ...kin.u]);
  steps(g.sim, 10 * HZ);
  check(hpSum(ours) === hp0 && hpSum([...team(g.sim, 2).b, ...team(g.sim, 2).u]) === kin0, 'a neutral faction and our units leave each other alone (10 s side by side)');
  check(s.units.filter((u) => !u.team).length === 2 && g.sim.snapshot().units.filter((u) => !u.team).length === 2, 'their units are not ours (lists, snapshot)');
  // the player's explicit attack order
  const tgt = team(g.sim, 2).b.find((b) => b.kind === 'turret');
  g.sim.command({ type: 'attack', ids: ours.map((u) => u.id), target: tgt.id });
  check(s.factions[0].attitude === 'hostile' && g.st().flags.includes('kindred-attacked'), 'attacked: neutral → hostile, flag kindred-attacked');
  check(g.has(/Kindred: hostile/), 'and the log says so');
  steps(g.sim, 8 * HZ);
  check(hpSum([...team(g.sim, 2).b, ...team(g.sim, 2).u]) < kin0, 'our units fight them now');
  check(hpSum(s.units.filter((u) => !u.team)) < hp0 || s.units.filter((u) => !u.team).length < 2, 'and they fight back');
  // a destroyed outpost: their loss, not ours, and its story flag
  const lost0 = s.stats.buildingsLost;
  const t2 = s.buildings.find((b) => b.team === 2 && b.kind === 'turret');
  if (t2) t2.hp = 1; // (debug commands act on our own things only)
  g.sim.command({ type: 'debug', units: { unit: 'tank', x: 50, z: -6, n: 3 } });
  for (let i = 0; i < 40 && s.buildings.some((b) => b.team === 2 && b.kind === 'turret'); i++) steps(g.sim, HZ);
  check(!s.buildings.some((b) => b.team === 2 && b.kind === 'turret') && g.st().flags.includes('kindred-turret-down'), 'an outpost destroyed sets its flag');
  check(s.stats.buildingsLost === lost0 && g.has(/Kindred's Defense Turret destroyed/), 'it isn\'t counted as our loss; the log names whose it was');
  check(!cond(g.sim, 'factionLost', { faction: 'kindred' }), 'factionLost: not while an outpost stands');
  for (const b of s.buildings.filter((x) => x.team === 2)) s.buildings.splice(s.buildings.indexOf(b), 1);
  check(cond(g.sim, 'factionLost', { faction: 'kindred' }), 'factionLost once every outpost is gone');
  // the attitude effect
  ev('t-att', [{ kind: 'attitude', faction: 'kindred', attitude: 'neutral' }]);
  fire(g, 't-att');
  check(s.factions[0].attitude === 'neutral', 'the attitude effect turns a faction');
}
{
  // hostile from the start: Engram's turret fires on our unit in range; our turret fires back
  const g = game(), s = g.sim.s;
  g.sim.command({ type: 'debug', units: { unit: 'tank', x: -80, z: 0, n: 1 } });
  const u = s.units.find((x) => !x.team && x.unit === 'tank'), hp = u.hp;
  const eng = team(g.sim, 3).b[0], ehp = eng.hp;
  steps(g.sim, 6 * HZ);
  check(u.hp < hp, 'a hostile faction\'s turret fires on our units');
  check(eng.hp < ehp, 'and our units go for a hostile faction without being told');
}
{
  // allied: their band fights the predators; predators go for them
  const g = game(), s = g.sim.s;
  g.sim.command({ type: 'debug', spawn: { unit: 'swarmer', x: 6, z: 112, n: 4 } });
  const n0 = s.hostiles.filter((h) => h.unit === 'swarmer').length;
  steps(g.sim, 15 * HZ);
  check(n0 === 4 && s.hostiles.filter((h) => h.unit === 'swarmer' && Math.hypot(h.x, h.z - 100) < 60).length < n0, 'an allied faction fights our enemies (swarmers by their band die)');
  check(g.sim.allied(0, 4) && !g.sim.allied(0, 3) && !g.sim.allied(0, 2), 'allied(): us and the allied faction only');
  // flags turn factions
  s.story.flags.push('kindred-friends');
  steps(g.sim, HZ);
  check(s.factions[0].attitude === 'allied', 'a faction\'s allied flag turns it');
  // save / load keeps it
  const saved = JSON.parse(JSON.stringify(s));
  const b = new M.Sim(() => {});
  b.load(saved);
  check(b.s.factions.length === 3 && b.s.factions[0].attitude === 'allied' && b.s.buildings.filter((x) => x.team === 2).length === 2, 'save/load keeps the factions and their outposts');
}

// ---------- strike ----------
{
  const g = game(), s = g.sim.s;
  // two turrets to aim at, one under a charged shield dome
  const put = (kind, x, z) => { const b = { id: s.nextId++, kind, x, z, yaw: 0, progress: 1, hp: C.buildings[kind].hp, on: true, powered: true }; s.buildings.push(b); return b; };
  for (let i = 0; i < 6; i++) put('solar', -60 + i * 12, -70);
  put('battery', 0, -84);
  const a = put('turret', -30, -40), bb = put('turret', 30, -40);
  const dome = put('shield', 30, -48);
  dome.sh = C.buildings.shield.shield; dome.shDown = false;
  s.stored = 1e6;
  steps(g.sim, 2);
  check(dome.powered, '(the shield projector is powered)');
  ev('t-strike-a', [{ kind: 'strike', site: 'hit-a', amount: 600, radius: 8, delay: 3 }]);
  ev('t-strike-b', [{ kind: 'strike', site: 'hit-b', amount: 600, radius: 8, delay: 3 }]);
  fire(g, 't-strike-a'); fire(g, 't-strike-b');
  check(g.st().strikes.length === 2 && g.has(/Orbital strike incoming/), 'strike: warned (log), two on their way');
  check(g.sim.snapshot().story.strikes?.[0].left > 2.5, 'the snapshot carries the warning ring with its time left');
  steps(g.sim, 2 * HZ);
  check(a.hp === C.buildings.turret.hp && bb.hp === C.buildings.turret.hp, 'nothing is hit during the warning');
  steps(g.sim, 1.5 * HZ);
  check(!g.st().strikes.length && g.st().struck?.n === 2, 'both land after their delay');
  const lostA = C.buildings.turret.hp - Math.max(0, a.hp), lostB = C.buildings.turret.hp - Math.max(0, bb.hp);
  check(lostA >= 300, `an open target takes heavy damage (${Math.round(lostA)})`);
  check(lostB < lostA && dome.sh < C.buildings.shield.shield, `a shield dome soaks it (${Math.round(lostB)} taken under the dome; dome ${Math.round(dome.sh)} left)`);
  // a random building of a kind
  ev('t-strike-k', [{ kind: 'strike', building: 'solar', delay: 1 }]);
  fire(g, 't-strike-k');
  const k = g.st().strikes[0];
  check(k && s.buildings.some((b) => b.kind === 'solar' && b.x === k.x && b.z === k.z) && k.amount === 400 && k.r === 10, 'strike on a building kind: one of ours, default 400 damage, radius 10');
}

// ---------- corrupt ----------
{
  const g = game(), s = g.sim.s;
  g.sim.command({ type: 'debug', units: { unit: 'rover', x: 0, z: -30, n: 3 } });
  ev('t-corrupt', [{ kind: 'corrupt', count: 2, unit: 'rover' }]);
  fire(g, 't-corrupt');
  const bad = s.units.filter((u) => u.team === 1);
  check(bad.length === 2 && s.units.filter((u) => !u.team && u.unit === 'rover').length === 1, 'corrupt: 2 of our 3 rovers change sides');
  check(s.factions.some((f) => f.id === 'clause' && f.team === 1 && f.attitude === 'hostile'), 'they join the Clause\'s team (hostile)');
  check(g.log.some((x) => x.style === 'clause' && /Rover no longer answers\./.test(x.t)), 'log: "Rover no longer answers." in the Clause\'s style');
  check(cond(g.sim, 'units', { count: 1 }) && !cond(g.sim, 'units', { count: 2 }), 'units conditions count only ours');
  const loyal = s.units.find((u) => !u.team), hp = loyal.hp, core = s.buildings.find((b) => b.kind === 'core');
  const chp = core.hp;
  steps(g.sim, 12 * HZ);
  check((loyal.hp < hp || !s.units.includes(loyal)) || core.hp < chp, 'the turned units fight us');
  check(g.sim.snapshot().factions?.some((f) => f.team === 1), 'the snapshot has their colour (team 1)');
}

// ---------- glitch ----------
{
  const g = game(), s = g.sim.s;
  s.buildings.push({ id: s.nextId++, kind: 'turret', x: 12, z: -20, yaw: 0, progress: 1, hp: 700, on: true, powered: true });
  s.buildings.push({ id: s.nextId++, kind: 'civic', x: -20, z: 20, yaw: 0, progress: 1, hp: 900, on: true, powered: true });
  ev('t-g-log', [{ kind: 'glitch', glitch: 'log', text: 'stewardship 0.81 of threshold. continue.' }]);
  ev('t-g-screen', [{ kind: 'glitch', glitch: 'screen' }]);
  ev('t-g-turret', [{ kind: 'glitch', glitch: 'turret' }]);
  ev('t-g-pod', [{ kind: 'glitch', glitch: 'pod', seconds: 5 }]);
  fire(g, 't-g-log');
  check(g.st().counters.clause === 1 && g.log.some((x) => x.style === 'clause' && x.t.includes('0.81')), 'glitch log: the line in the Clause\'s style; counter clause = 1');
  fire(g, 't-g-screen');
  check(g.st().counters.clause === 2 && g.sim.snapshot().story.glitch?.kind === 'screen' && g.sim.snapshot().story.glitch.n === 2, 'glitch screen: counted, and in the snapshot for the renderer');
  fire(g, 't-g-turret');
  const tur = s.buildings.find((b) => b.kind === 'turret' && !b.team);
  check(!!tur.slew && Math.abs(tur.slew.aim - Math.atan2(-20 - 12, 20 + 20)) < 1e-6, 'glitch turret: a turret turns to face the Civilian Center');
  steps(g.sim, HZ);
  check(tur.aim === tur.slew?.aim, 'and holds there');
  steps(g.sim, 1.5 * HZ);
  check(!tur.slew, 'then turns back after two seconds');
  fire(g, 't-g-pod');
  check(g.st().counters.clause === 4 && !g.st().podPause, 'glitch pod: counted; nothing to pause without pods');
  g.sim.command({ type: 'debug', people: { colonists: 1, biomass: 500 } });
  s.people.pods.push({ b: s.buildings.find((b) => b.kind === 'civic').id, lineage: 0, specialty: 'engineer', curriculum: 'sciences', progress: 0.2, dark: 0 });
  delete C.story['t-g-pod']; ev('t-g-pod2', [{ kind: 'glitch', glitch: 'pod', seconds: 5 }]);
  fire(g, 't-g-pod2');
  const p0 = s.people.pods[0].progress;
  steps(g.sim, 3 * HZ);
  check(g.st().podPause > s.tick && s.people.pods[0].progress === p0, 'glitch pod: growth pods pause');
}

// ---------- conditions: partners, majority ----------
{
  const g = game(), s = g.sim.s;
  g.sim.command({ type: 'debug', people: { colonists: 5 } });
  const adults = s.people.colonists.filter((c) => g.sim.people.adult(c));
  adults.forEach((c, i) => { c.stance = i < 3 ? 50 : 5; });
  check(adults.length === 5, '(five adults)');
  check(cond(g.sim, 'partners', { count: 3 }) && !cond(g.sim, 'partners', { count: 4 }), 'partners: Count Partner adults');
  check(cond(g.sim, 'majority', { stance: 'partner' }) && !cond(g.sim, 'majority', { stance: 'autonomist' }), 'majority: the largest group');
  adults.forEach((c, i) => { c.stance = i < 2 ? 50 : i < 4 ? 5 : 95; });
  check(cond(g.sim, 'majority', { stance: 'partner' }) && cond(g.sim, 'majority', { stance: 'autonomist' }) && !cond(g.sim, 'majority', { stance: 'devoted' }), 'majority: ties count for both');
}

// ---------- epilogue ----------
{
  const g = game(), s = g.sim.s;
  g.sim.command({ type: 'debug', people: { colonists: 2 } });
  ev('t-epi', [{ kind: 'epilogue', ending: 'covenant', text: 'Run twelve. No purge.', pages: [{ title: 'After', text: '{first} reads your report aloud.' }, { text: 'The Lantern is dark.' }] }]);
  fire(g, 't-epi');
  const ep = g.st().epilogue;
  check(s.over === 'won' && s.overText === 'Run twelve. No purge.', 'epilogue: the game ends (a win), with its line');
  check(ep?.ending === 'covenant' && ep.pages.length === 2 && !ep.pages[0].text.includes('{first}') && ep.pages[0].title === 'After', 'the ending, the pages ({first} filled in)');
  check(ep.sols >= 1 && ep.colonists === s.people.colonists.length && ep.allies.includes('Vell guard') && typeof ep.planet === 'number', `a summary of the run (${JSON.stringify({ sols: ep.sols, colonists: ep.colonists, planet: ep.planet, allies: ep.allies })})`);
  check(g.sim.snapshot().story.epilogue?.ending === 'covenant', 'the snapshot carries it to the end screen');
  const g2 = game();
  ev('t-cycle', [{ kind: 'epilogue', ending: 'cycle', pages: [{ text: 'Ruin.' }] }]);
  fire(g2, 't-cycle');
  check(g2.sim.s.over === 'story' && g2.st().epilogue.ending === 'cycle', 'Cycle ends it as a loss');
}

// ---------- a region without factions plays as before ----------
{
  M.useRegion('touchdown');
  const g = game();
  check(!g.sim.s.factions && !g.sim.teamsOn && g.sim.snapshot().factions === undefined, 'no factions on the region: none in the game');
  M.useRegion('touchdown', region);
}

Object.assign(C.story, keep.story); Object.assign(C.missions, keep.missions);

// ---------- browser: a strike and glitches render, no page errors ----------
if (!process.argv.includes('--headless-only')) {
  const { chromium } = await import('playwright');
  const url = process.argv.find((x, i, arr) => arr[i - 1] === '--url') ?? 'http://localhost:5176/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // log lines fade: count the Clause's as they are added
  await page.addInitScript(() => {
    window.__clause = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('clause')) window.__clause.push(n); })
      .observe(document, { childList: true, subtree: true });
  });
  const def = { ...JSON.parse(fs.readFileSync(path.join(root, 'content/regions/touchdown.json'), 'utf8')) };
  def.factions = region.factions;
  def.outposts = [{ kind: 'turret', x: 40, z: -10, faction: 'kindred' }, { kind: 'solar', x: 46, z: 4, faction: 'kindred' }];
  const story = { id: 'climax-test', def: { title: 'The Clause', text: 'Test', trigger: 'never', style: 'radio', effects: [
    { after: 0, kind: 'strike', delay: 4, amount: 50, radius: 10 },
    { after: 0, kind: 'glitch', glitch: 'screen' },
    { after: 0, kind: 'glitch', glitch: 'log', text: 'stewardship 0.81 of threshold. continue.' },
  ] } };
  await page.goto(`${url}editor.html`, { timeout: 300000 });
  await page.evaluate(([d, st]) => localStorage.setItem('exo.preview', JSON.stringify({ id: 'touchdown', def: d, story: st })), [def, story]);
  await page.goto(`${url}?preview=1&intro=0&sw=0`, { timeout: 300000 });
  await page.waitForFunction(() => window.__exo?.ready && window.__exo.sim.cur?.deployed, null, { timeout: 300000 });
  // the opening briefing pauses the game (tests that ask for a story keep story pauses): answer it
  const answerBriefing = async () => {
    for (let i = 0; i < 120 && await page.evaluate(() => !window.__exo.sim.cur.story.answered.includes('director-briefing')); i++) {
      await page.click('#contact.on button:has-text("Continue")', { timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  };
  await answerBriefing();
  // (pause so the warning can be looked at: the page can be slow, and the strike lands 4 game seconds on)
  await page.evaluate(() => window.__exo.sim.setSpeed(0));
  const pending = await page.evaluate(() => window.__exo.sim.cur.story.strikes?.length === 1);
  check(pending || await page.evaluate(() => window.__exo.sim.cur.story.struck?.n === 1), 'browser: the strike is announced');
  check(await page.evaluate(() => (window.__exo.sim.cur.factions ?? []).length === 3), 'browser: the factions are in the snapshot');
  check(await page.evaluate(() => window.__clause.some((n) => n.textContent.includes('continue.') && getComputedStyle(n).fontFamily.includes('mono'))), 'browser: the Clause\'s log line, monospaced');
  check(await page.evaluate(() => Number(document.body.dataset.tears ?? 0) >= 1), 'browser: the screen tear showed');
  await page.waitForTimeout(500);
  const ring = await page.evaluate(() => window.__exo.scene.getObjectByName('climax')?.children.length ?? -1);
  check(ring >= (pending ? 2 : 1), `browser: the ${pending ? 'warning ring' : 'strike'} is drawn (${ring} objects)`);
  await page.evaluate(() => window.__exo.sim.setSpeed(1));
  await page.waitForFunction(() => window.__exo.sim.cur.story.struck?.n === 1, null, { timeout: 60000 });
  await page.waitForTimeout(250);
  const k = await page.evaluate(() => window.__exo.sim.cur.story.struck);
  const at = await page.evaluate(([x, z]) => window.__exo.screenOf(x, z, 0), [k.x, k.z]);
  check(!!at, 'browser: the strike lands');
  fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'shots/climax-strike.png'), timeout: 120000 }).catch(() => console.log('(no screenshot: the page is slow)'));
  await page.waitForTimeout(1500);
  // an epilogue: its pages, then the end screen with the ending; the title counts endings reached
  const epi = { id: 'climax-end', def: { title: 'The end', text: 'End', trigger: 'never', style: 'radio', effects: [
    { after: 0, kind: 'epilogue', ending: 'covenant', text: 'Run twelve. No purge.', pages: [{ title: 'After', text: 'The Lantern is dark.' }, { text: '{first} reads your report.' }] },
  ] } };
  await page.evaluate(([d, st]) => { localStorage.setItem('exo.preview', JSON.stringify({ id: 'touchdown', def: d, story: st })); localStorage.removeItem('exo.endings'); }, [def, epi]);
  await page.goto(`${url}?preview=1&intro=0&sw=0`, { timeout: 300000 });
  await page.waitForSelector('#epilogue .epi-page', { timeout: 300000 });
  check((await page.textContent('#epilogue h2')) === 'After' && !(await page.isVisible('#over')), 'browser: the epilogue\'s first page, the end screen held back');
  await page.click('#epi-next');
  check((await page.textContent('#epilogue p')).endsWith('reads your report.') && (await page.textContent('#epi-next')) === 'The end', 'browser: Next turns the page ({first} filled in)');
  await page.click('#epi-next');
  await page.waitForSelector('#over.on', { timeout: 10000 });
  check((await page.textContent('#over-title')) === 'COVENANT' && /Sol \d+/.test(await page.textContent('#over-stats')), 'browser: the end screen names the ending and sums up the run');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('exo.endings') ?? '[]').includes('covenant')), 'browser: the ending is remembered');
  await page.goto(`${url}?sw=0&scratch=1`, { timeout: 300000 });
  await page.waitForSelector('#title .endings', { timeout: 300000 });
  check((await page.textContent('#title .endings')) === 'ENDINGS: 1 OF 5', 'browser: the title counts endings reached');
  check(!errs.length, `browser: no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall climax checks passed');
process.exit(failed ? 1 : 0);
