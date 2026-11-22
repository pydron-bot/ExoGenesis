/**
 * Story engine, round three (TECH.md): the gaps the campaign's writers found. Headless with the real sim:
 * the Core lost as a story beat (coreLost), a lost expedition's region forgotten for a retry, the home
 * snapshot read on expeditions (people conditions, inhabitants, homePlanet, the epilogue's summary), choices
 * offered by flag, the mission and outpost effects, the walkout flag, night, and the playthrough's routes;
 * the content checks for all of it. Then a short browser check of a cinematic's hour, music and a `body`
 * camera key (a temporary cinematic in content/cinematics, removed after) against a dev server.
 *   node tools/story-gaps-smoke.mjs [--url http://localhost:5183/] [--headless-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5183/';
const headlessOnly = process.argv.includes('--headless-only');
const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
const HZ = 10, SOL = C.colony.solSeconds;

// the shipped story is left alone: these tests add their own records
const keep = { story: { ...C.story }, missions: { ...C.missions }, cinematics: { ...C.cinematics } };
for (const k of Object.keys(C.story)) delete C.story[k];
for (const k of Object.keys(C.missions)) delete C.missions[k];
for (const k of Object.keys(C.cinematics)) if (k !== 'landing') delete C.cinematics[k];
const ev = (id, effects, extra = {}) => { C.story[id] = { title: id, text: id, trigger: 'never', effects: effects.map((e) => ({ after: 0, ...e })), ...extra }; };
const clear = () => { for (const k of Object.keys(C.story)) delete C.story[k]; for (const k of Object.keys(C.missions)) delete C.missions[k]; };

function game(region = 'touchdown', draft) {
  M.useRegion(region, draft);
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return { sim, log, has: (re) => log.some((t) => re.test(t)) };
}
const fire = (g, id) => g.sim.command({ type: 'debug', story: id });
const coreOf = (sim) => sim.s.buildings.find((b) => b.kind === 'core' && !b.team);
const killCore = (sim) => sim.destroyBuilding(coreOf(sim));
const cond = (sim, kind, c = {}, sites = []) => sim.withTeam(0, () => M.conditionMet(sim, kind, c, { region: 'x', sites }));

// ---------- 1. the Core lost as a story beat ----------
{
  clear();
  ev('g-cycle', [{ kind: 'epilogue', ending: 'cycle', pages: [{ title: 'Ruin', text: 'Centuries.' }], text: 'The purge succeeds.' }]);
  C.missions['g-hold'] = { title: 'Hold', objectives: [{ text: 'never', kind: 'never' }], fails: [{ text: 'The Core fell', kind: 'coreLost' }], onFail: 'g-cycle' };
  const g = game();
  steps(g.sim, 12);
  check(g.sim.s.missions.active.includes('g-hold'), 'a mission that fails on coreLost is under way');
  check(!cond(g.sim, 'coreLost'), 'coreLost: false while the Core stands');
  killCore(g.sim);
  check(g.sim.s.missions.failed?.includes('g-hold'), 'the Core falls: the mission fails');
  check(g.sim.s.over === 'story' && g.sim.s.story.epilogue?.ending === 'cycle', `its event plays the Cycle ending (over: ${g.sim.s.over}, ending ${g.sim.s.story.epilogue?.ending})`);
  check(!g.has(/The Command Core has fallen/), 'no generic "Command Core has fallen" defeat');
  check(g.has(/Mission failed: Hold · The Core fell/), 'logged as the mission failing');
}
{
  // in a group, and the group's other half not met: the generic defeat
  clear();
  C.missions['g-group'] = { title: 'Group', objectives: [{ text: 'never', kind: 'never' }], fails: [{ kind: 'all', of: [{ kind: 'coreLost' }, { kind: 'flag', flag: 'lantern-night' }] }] };
  const g = game();
  steps(g.sim, 12);
  killCore(g.sim);
  check(g.sim.s.over === 'core' && !g.sim.s.missions.failed?.includes('g-group'), 'coreLost in an all group whose other part is false: the generic defeat');
  const h = game();
  h.sim.s.story.flags.push('lantern-night');
  steps(h.sim, 12);
  killCore(h.sim);
  check(!h.sim.s.over && h.sim.s.missions.failed?.includes('g-group'), 'the same group met: the mission fails instead (no end: the story decides)');
  // the game goes on without a Core; a coreLost trigger can answer it
  ev('g-after', [{ kind: 'flag', flag: 'core-gone' }], { trigger: 'coreLost' });
  let ok = true;
  try { steps(h.sim, 60 * HZ); } catch (e) { ok = false; console.log(e); }
  check(ok && !h.sim.s.over, 'a minute on without the Core: no crash, no defeat');
  check(h.sim.s.story.flags.includes('core-gone'), 'a story event with trigger coreLost fires');
}
{
  // nothing to catch it: the defeat as before; a mission set in another region doesn't catch it here
  clear();
  const g = game();
  steps(g.sim, 12);
  killCore(g.sim);
  check(g.sim.s.over === 'core', 'no mission: the Core lost is the defeat it was');
  C.missions['g-away'] = { title: 'Away', region: 'hearthsmoke', objectives: [{ text: 'never', kind: 'never' }], fails: [{ kind: 'coreLost' }] };
  const h = game();
  h.sim.command({ type: 'inspect', route: 'hearthsmoke' });
  steps(h.sim, 12);
  check(h.sim.s.missions.active.includes('g-away'), '(a mission in another region is under way)');
  killCore(h.sim);
  check(h.sim.s.over === 'core' && !h.sim.s.missions.failed?.includes('g-away'), 'a mission set in another region doesn\'t catch the Core lost here');
}

// ---------- 2. a lost expedition forgotten for a retry ----------
{
  clear();
  ev('x-vale', [], { region: 'hearthsmoke' });
  ev('x-vale2', [], { region: 'hearthsmoke' });
  ev('x-home', []);
  C.cinematics['x-cine'] = { title: 'c', length: 3, camera: [{ at: 0, target: 'site', lift: 0, dist: 50, pitch: 0.5, yaw: 0 }], trigger: 'never', region: 'hearthsmoke' };
  C.cinematics['x-cine-home'] = { title: 'c', length: 3, camera: [{ at: 0, target: 'site', lift: 0, dist: 50, pitch: 0.5, yaw: 0 }], trigger: 'never' };
  C.missions['x-on'] = { title: 'On', region: 'hearthsmoke', objectives: [{ text: 'a', kind: 'never' }, { text: 'b', kind: 'never' }] };
  C.missions['x-failed'] = { title: 'Failed', region: 'hearthsmoke', objectives: [{ text: 'a', kind: 'never' }] };
  C.missions['x-done'] = { title: 'Done', region: 'hearthsmoke', objectives: [{ text: 'a', kind: 'never' }] };
  C.missions['x-homem'] = { title: 'Home', objectives: [{ text: 'a', kind: 'never' }] };
  const sh = {
    story: { fired: ['x-vale', 'x-home', 'x-vale2'], answered: ['x-vale', 'x-home'], flags: ['vale-flag'], cines: ['x-cine', 'x-cine-home'], away: ['cine:x-cine', 'x-vale2', 'x-home'], counters: { trips: 2 } },
    missions: { active: ['x-on', 'x-homem'], done: ['x-done'], failed: ['x-failed'], marks: { 'x-on': [1], 'x-homem': [0], 'x-done': [0] } },
    research: [], campaign: { visited: ['touchdown', 'hearthsmoke'], routes: ['hearthsmoke'] },
  };
  M.forgetRegion(sh, 'hearthsmoke', C);
  check(sh.story.fired.join() === 'x-home' && sh.story.answered.join() === 'x-home', 'events set in the lost region are forgotten (fired, answered); others stay');
  check(sh.story.cines.join() === 'x-cine-home' && sh.story.away.join() === 'x-home', 'its cinematics played and waiting, its events waiting: forgotten');
  check(sh.missions.active.includes('x-on') && sh.missions.marks['x-on'].length === 0, 'a mission there under way: under way again, no objectives met');
  check(sh.missions.active.includes('x-failed') && !sh.missions.failed.includes('x-failed') && sh.missions.marks['x-failed'].length === 0, 'a mission there that failed: under way again');
  check(sh.missions.done.includes('x-done') && !sh.missions.active.includes('x-done'), 'a mission there already done stays done');
  check(sh.missions.marks['x-homem'].join() === '0' && sh.story.flags.includes('vale-flag') && sh.story.counters.trips === 2, 'missions elsewhere, flags and counters are left as they were');
  for (const k of ['x-cine', 'x-cine-home']) delete C.cinematics[k];
}

// ---------- 3. the home snapshot ----------
let homeShared;
{
  clear();
  const g = game();
  g.sim.command({ type: 'debug', people: { colonists: 6, biomass: 200 } });
  const s = g.sim.s;
  for (const c of s.people.colonists) c.born = -20 * SOL; // adults
  s.people.colonists.forEach((c, i) => { c.stance = i < 4 ? 60 : 10; }); // 4 partners, 2 autonomists
  steps(g.sim, 2 * HZ);
  const h = s.campaign.home;
  check(!!h, 'home: a snapshot is kept while Touchdown is played');
  check(h && h.colonists === s.people.colonists.length && h.partners === 4 && h.autonomists === 2 && h.devoted === 0, `home: colonists and stances (${h?.colonists}, ${h?.partners}/${h?.autonomists}/${h?.devoted})`);
  check(h && Math.abs(h.planet - g.sim.planet.health()) < 0.11 && h.sols === 1 && h.acceptance !== null && Math.abs(h.acceptance - g.sim.people.acceptance()) < 1e-6, `home: planet health ${h?.planet}, sol ${h?.sols}, acceptance ${h?.acceptance?.toFixed(1)}`);
  check(h && Object.keys(h.groups).length === (s.camps ?? []).length ? true : !!h && Object.keys(h.groups).length > 0, `home: inhabitant groups (${Object.keys(h?.groups ?? {}).join(', ')})`);
  check(cond(g.sim, 'homePlanet', { count: 50 }) === g.sim.planet.health() >= 50, 'homePlanet at home reads the planet live');
  homeShared = M.sharedOf(s);
  check(!!homeShared.campaign.home, 'the snapshot goes with the shared campaign state');
  // known numbers for the expedition's checks
  homeShared.campaign.home = { planet: 72, acceptance: 64, autonomists: 2, partners: 5, devoted: 1, colonists: 12, deaths: 3, sols: 9, groups: { vell: { regard: 80, low: 55, met: true, trusted: true }, choir: { regard: 20, low: 20, met: false, trusted: false } } };
}
{
  const trek = { ...C.regions.hearthsmoke, camps: [], expedition: [{ alloys: 500, drones: 1 }] };
  const g = game('hearthsmoke', trek);
  M.applyShared(g.sim.s, homeShared, 'hearthsmoke');
  g.sim.arrived();
  const sim = g.sim;
  check(sim.s.expedition && !sim.s.people?.colonists.length, '(an expedition: no colonists here)');
  const t = (kind, c) => cond(sim, kind, c);
  check(t('colonists', { count: 12 }) && !t('colonists', { count: 13 }) && t('deaths', { count: 3 }), 'away: colonists and deaths read home');
  check(t('acceptance', { count: 60 }) && !t('acceptance', { count: 70 }) && t('distrust', { count: 70 }) && !t('distrust', { count: 60 }), 'away: acceptance / distrust read home');
  check(t('partners', { count: 5 }) && t('autonomists', { count: 2 }) && t('devoted', { count: 1 }) && !t('devoted', { count: 2 }), 'away: partners, autonomists, devoted read home');
  check(t('majority', { stance: 'partner' }) && !t('majority', { stance: 'autonomist' }), 'away: majority reads home');
  check(t('homePlanet', { count: 70 }) && !t('homePlanet', { count: 75 }), 'homePlanet away reads the snapshot (72)');
  check(t('trust', { group: 'vell' }) && t('contact', { group: 'vell' }) && t('regard', { group: 'vell', count: 80 }) && t('regardBelow', { group: 'vell', count: 60 }) && !t('regardBelow', { group: 'vell', count: 50 }), 'a group not on this region: trust, contact, regard, regardBelow read home');
  check(!t('trust', { group: 'choir' }) && !t('contact', { group: 'choir' }), '…and a group not met at home isn\'t');
  // the epilogue's summary, away from home, is the home colony's
  ev('g-end', [{ kind: 'epilogue', ending: 'covenant', pages: [{ text: 'Run twelve.' }] }]);
  fire(g, 'g-end');
  const ep = sim.s.story.epilogue;
  check(ep && ep.colonists === 12 && ep.planet === 72 && ep.deaths === 3 && ep.sols === 9, `the epilogue away sums up the home colony (${ep?.colonists} colonists, planet ${ep?.planet}, ${ep?.deaths} dead, sol ${ep?.sols})`);
  check(ep && ep.allies.includes(C.inhabitants.vell.name), `…with the groups that trust us at home among the allies (${ep?.allies.join(', ')})`);
}
{
  // a group that is on this region reads its camp here, not home
  const g = game('hearthsmoke', { ...C.regions.hearthsmoke, expedition: [{ alloys: 500 }] });
  M.applyShared(g.sim.s, homeShared, 'hearthsmoke');
  const here = (g.sim.s.camps ?? []).find((c) => c.group === 'vell');
  if (here) check(!cond(g.sim, 'trust', { group: 'vell' }) && !here.trusted, 'a group with a camp here reads it here (not trusted yet), not home');
  else check(true, '(hearthsmoke has no Vell camp: skipped)');
}

// ---------- 4. choices by flag ----------
{
  clear();
  C.story['g-pick'] = {
    title: 'Pick', text: '', trigger: 'never',
    choices: [{ label: 'Plain' }, { label: 'Tell her', ifFlag: 'keeper-song' }, { label: 'Say nothing', unlessFlag: 'keeper-song' }],
    effects: [{ after: 1, kind: 'flag', flag: 'took-plain' }, { after: 2, kind: 'flag', flag: 'took-tell' }, { after: 3, kind: 'flag', flag: 'took-quiet' }],
  };
  C.story['g-pick2'] = { ...C.story['g-pick'] };
  check(M.shownChoices(C.story['g-pick'], []).join() === '0,2' && M.shownChoices(C.story['g-pick'], ['keeper-song']).join() === '0,1', 'shownChoices: indices into the full list, by flag');
  const g = game(), st = () => g.sim.s.story;
  fire(g, 'g-pick');
  g.sim.command({ type: 'story', id: 'g-pick', choice: 1 });
  check(st().inbox.includes('g-pick') && !st().flags.includes('took-tell'), 'a choice not on offer can\'t be taken (the card waits)');
  g.sim.command({ type: 'story', id: 'g-pick', choice: 2 });
  check(st().flags.includes('took-quiet') && !st().inbox.includes('g-pick'), 'choice 3 (offered without the flag) runs the effects numbered 3');
  st().flags.push('keeper-song');
  fire(g, 'g-pick2');
  g.sim.command({ type: 'story', id: 'g-pick2', choice: 2 });
  check(st().inbox.includes('g-pick2'), 'with the flag set, "unless" hides it');
  g.sim.command({ type: 'story', id: 'g-pick2', choice: 1 });
  check(st().flags.includes('took-tell'), 'with the flag set, the "if" choice is offered and its effects (2) run');
  // every choice hidden: answered like a Continue
  C.story['g-none'] = { title: 'None', text: '', trigger: 'never', choices: [{ label: 'x', ifFlag: 'nope' }], effects: [{ after: 1, kind: 'flag', flag: 'took-x' }] };
  fire(g, 'g-none');
  g.sim.command({ type: 'story', id: 'g-none', choice: 0 });
  check(!st().inbox.includes('g-none') && !st().flags.includes('took-x') && st().answered.includes('g-none'), 'with no choice on offer the card is a Continue');
}

// ---------- 5. the mission effect ----------
{
  clear();
  ev('g-brief', [{ kind: 'flag', flag: 'briefed' }]);
  C.missions['g-first'] = { title: 'First', objectives: [{ text: 'never', kind: 'never' }] };
  C.missions['g-later'] = { title: 'Later', after: 'g-first', onStart: 'g-brief', objectives: [{ text: 'alloys', kind: 'alloys', count: 1 }] };
  C.missions['g-there'] = { title: 'There', region: 'hearthsmoke', objectives: [{ text: 'alloys', kind: 'alloys', count: 1 }] };
  ev('g-start', [{ kind: 'mission', mission: 'g-later' }, { kind: 'mission', mission: 'g-there' }]);
  const g = game(), m = () => g.sim.s.missions;
  steps(g.sim, 12);
  check(!m().active.includes('g-later'), '(it waits for its after)');
  fire(g, 'g-start');
  check(m().active.includes('g-later') && g.sim.s.story.flags.includes('briefed'), 'the mission effect starts it now, after or not, with its briefing');
  check(m().active.includes('g-there'), 'a mission set elsewhere starts too…');
  steps(g.sim, 12);
  check(m().done.includes('g-later') && !(m().marks['g-there'] ?? []).length, '…its objectives wait for its region (greyed here), the other one is done');
  fire(g, 'g-start'); // again: g-later is done, g-there under way
  check(m().done.includes('g-later') && !m().active.includes('g-later') && m().active.filter((x) => x === 'g-there').length === 1, 'done or under way: the effect does nothing');
}

// ---------- 6. the outpost effect ----------
{
  clear();
  const base = C.regions.touchdown;
  const region = {
    ...base,
    sites: [...(base.sites ?? []), { id: 'east-camp', x: 60, z: 0, r: 15 }],
    factions: [{ id: 'kindred', name: 'Kindred', color: '#e0a040', team: 2, attitude: 'hostile' }, { id: 'engram', name: 'Engram', color: '#ff8a2a', team: 3, attitude: 'neutral' }],
    outposts: [
      { kind: 'turret', x: 60, z: 0, faction: 'kindred', story: 'east-gun' },
      { kind: 'turret', x: 66, z: 6, faction: 'kindred' },
      { kind: 'turret', x: -60, z: 40, faction: 'kindred', story: 'west-gun' },
      { kind: 'solar', x: -90, z: -60, faction: 'engram' },
      { kind: 'turret', x: -96, z: -60, faction: 'engram' },
    ],
  };
  M.useRegion('touchdown', region);
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  steps(sim, HZ + 1);
  const at = (x, z) => sim.s.buildings.find((b) => b.x === x && b.z === z);
  // disable the two at the east camp: our rovers beside them take no fire
  ev('o-off', [{ kind: 'outpost', faction: 'kindred', site: 'east-camp', outcome: 'disable' }]);
  sim.command({ type: 'debug', story: 'o-off' });
  check(at(60, 0)?.off && at(66, 6)?.off && !at(-60, 40)?.off, 'disable by site: the two within its radius, not the far one');
  sim.command({ type: 'debug', units: { unit: 'rover', x: 58, z: 10, n: 2 } });
  const ours = sim.s.units.filter((u) => !u.team && Math.hypot(u.x - 60, u.z) < 20);
  const hp0 = ours.reduce((a, u) => a + u.hp, 0);
  sim.s.units.forEach((u) => { if (!u.team) u.order = { kind: 'hold' }; });
  steps(sim, 8 * HZ);
  const hit = at(60, 0), b0 = at(66, 6);
  check(!!hit && !!b0 && ours.reduce((a, u) => a + u.hp, 0) === hp0, `a disabled turret doesn't shoot (our rovers ${hp0} hp → ${ours.reduce((a, u) => a + u.hp, 0)})`);
  check(!!hit && !hit.powered && !hit.engaged, 'it stays dark (unpowered, not engaged)');
  // destroy by story flag
  ev('o-boom', [{ kind: 'outpost', story: 'west-gun', outcome: 'destroy' }]);
  sim.command({ type: 'debug', story: 'o-boom' });
  check(!at(-60, 40) && sim.s.story.flags.includes('west-gun') && !sim.s.over, 'destroy by an outpost\'s story flag: gone, its flag set, not our loss');
  // capture a faction's outposts, from inside the story's step (the colony's own view)
  ev('o-take', [{ kind: 'outpost', faction: 'engram', outcome: 'capture' }], { trigger: 'flag', flag: 'take-them' });
  sim.s.story.flags.push('take-them');
  steps(sim, HZ + 1);
  const solar = at(-90, -60), gun = at(-96, -60);
  check(!!solar && !!gun && !solar.team && !gun.team, 'capture a faction: its buildings are ours');
  check(sim.s.buildings.filter((b) => b === solar).length === 1 && sim.factionBuildings(3).length === 0, 'listed once, and the faction has none left');
  check(M.conditionMet(sim, 'factionLost', { faction: 'engram' }, { sites: [] }), 'factionLost: true once all were taken');
  check(log.some((t) => /ours now/.test(t)) && log.some((t) => /dark/.test(t)), 'logged: "… ours now", "… goes dark"');
  steps(sim, 5 * HZ);
  check(sim.snapshot().buildings.some((b) => b.x === -96 && b.z === -60 && !b.team), 'the snapshot shows it as ours');
  M.useRegion('touchdown');
}

// ---------- 7. walkout, night ----------
{
  clear();
  const g = game();
  g.sim.command({ type: 'debug', people: { colonists: 6, biomass: 500 } });
  const s = g.sim.s, P = s.people;
  for (const c of P.colonists) { c.born = -20 * SOL; c.stance = 5; c.wb = 5; }
  P.unrest = SOL * 0.5 - 0.2;
  for (let i = 0; i < 40 && !s.story.flags.includes('walkout'); i++) { for (const c of P.colonists) { c.wb = 5; c.stance = 5; } steps(g.sim, 1); }
  check(s.story.flags.includes('walkout') && g.has(/walked out/), 'the Autonomist walkout sets the flag walkout');
  // night: the sim's clock at midnight and at noon
  const at = (hour) => { s.tick = Math.round((((hour - 7 + 24) % 24) / 24) * SOL * HZ) + SOL * HZ; };
  at(0);
  check(cond(g.sim, 'night'), 'night: true at midnight');
  at(12);
  check(!cond(g.sim, 'night'), 'night: false at noon');
}

// ---------- 8. the playthrough's routes ----------
{
  clear();
  C.missions['p-there'] = { title: 'There', region: 'hearthsmoke', objectives: [{ text: 'never', kind: 'never' }] };
  const g = game();
  g.sim.everywhere = true;
  steps(g.sim, 12);
  check(!g.sim.s.missions.active.includes('p-there'), 'everywhere (a playthrough): a mission set elsewhere still waits for a route');
  g.sim.command({ type: 'inspect', route: 'hearthsmoke' });
  steps(g.sim, 10);
  check(g.sim.s.missions.active.includes('p-there'), '…and starts once routed');
  const h = game();
  h.sim.everywhere = true; h.sim.everywhereStarts = true;
  steps(h.sim, 12);
  check(h.sim.s.missions.active.includes('p-there'), 'everywhereStarts (playthrough option anywhere): it starts at once, as before');
}

// ---------- 9. content checks ----------
{
  const { module: D } = await runnerImport(path.join(root, 'src/content/db.ts'));
  const files = {};
  const walk = (dir, sub = '') => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(dir, rel);
      else if (e.name.endsWith('.json')) files[rel] = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
    }
  };
  walk(path.join(root, 'content'));
  const clean = D.buildDb(files).issues.length;
  check(clean === 0, `the shipped content passes (${clean} issues)`);
  files['story/zz-gap-a.json'] = { title: 'a', text: 'a', trigger: 'coreLost', choices: [{ label: 'x', ifFlag: 'f', unlessFlag: 'f' }], effects: [
    { after: 0, kind: 'outpost', outcome: 'destroy' },
    { after: 0, kind: 'outpost', story: 'no-such-outpost', outcome: 'capture' },
    { after: 0, kind: 'outpost', faction: 'nobody', outcome: 'disable' },
    { after: 0, kind: 'outpost', faction: 'kindred' },
    { after: 0, kind: 'mission' },
  ] };
  files['missions/zz-gap-m.json'] = { title: 'm', objectives: [{ text: 'o', kind: 'homePlanet', count: 70 }], fails: [{ kind: 'any', of: [{ kind: 'coreLost' }, { kind: 'night' }] }], rewards: [{ kind: 'mission', mission: 'no-such-mission' }] };
  files['cinematics/zz-gap-c.json'] = { title: 'c', length: 4, hour: 30, music: 'no-such-piece', camera: [{ at: 0, target: 'body', lift: 2, dist: 40, pitch: 0, yaw: 0 }] };
  files['cinematics/zz-gap-d.json'] = { title: 'd', length: 4, trigger: 'never', hour: 21.5, music: 'night-lantern', camera: [{ at: 0, target: 'body', body: 'sela', x: 0, z: 0, lift: 2, dist: 40, pitch: 0, yaw: 0 }] };
  files['cinematics/zz-gap-e.json'] = { title: 'e', length: 4, trigger: 'never', music: 'tension', camera: [{ at: 0, target: 'site', lift: 2, dist: 40, pitch: 0, yaw: 0 }] };
  const iss = D.buildDb(files).issues;
  const has = (p, f, re) => iss.some((i) => i.path === p && (f === null || i.field === f) && (!re || re.test(i.msg)));
  const A = 'story/zz-gap-a.json', MM = 'missions/zz-gap-m.json', CC = 'cinematics/zz-gap-c.json';
  check(has(A, 'choices[0].unlessFlag', /never be offered/), 'check: a choice with the same if and unless flag');
  check(has(A, 'effects[0].faction', /name the outposts/), 'check: an outpost effect that names no outposts');
  check(has(A, 'effects[1].story', /no region has an outpost/), 'check: an outpost story flag no outpost has');
  check(has(A, 'effects[2].faction', /no region has a faction/), 'check: an outpost effect\'s faction must exist');
  check(has(A, 'effects[3].outcome', null), 'check: an outpost effect needs its Outcome');
  check(has(A, 'effects[4].mission', null), 'check: a mission effect needs its Mission');
  check(has(MM, 'rewards[0].mission', null), 'check: a mission effect names a real mission');
  check(!iss.some((i) => i.path === MM && i.field !== 'rewards[0].mission'), 'check: coreLost, night (in a group) and homePlanet are accepted');
  check(has(CC, 'hour', null) && has(CC, 'music', /neither a piece/) && has(CC, 'camera[0].body', null), 'check: a cinematic\'s hour (0–24), music (a piece or a use) and a body key\'s Body');
  const de = iss.filter((i) => i.path === 'cinematics/zz-gap-d.json' || i.path === 'cinematics/zz-gap-e.json');
  if (de.length) console.log(de);
  check(!de.length, 'check: a piece id or a use is fine as music, a body key with its Body is fine');
}

// shipped content back
Object.assign(C.story, keep.story); Object.assign(C.missions, keep.missions); Object.assign(C.cinematics, keep.cinematics);

// ---------- the browser: a cinematic's hour, music and a body key ----------
if (!headlessOnly) {
  const { chromium } = await import('playwright');
  const file = path.join(root, 'content/cinematics/zz-gaps-test.json');
  const cine = {
    title: 'Gaps test', length: 6, trigger: 'never', hour: 22, music: 'night-lantern', letterbox: true,
    camera: [
      { at: 0, target: 'site', x: 0, z: -8, lift: 0, dist: 60, pitch: 0.6, yaw: 0.4 },
      { at: 1, target: 'body', body: 'sela', x: 0, z: -20, lift: 3, dist: 40, pitch: 0, yaw: 0 },
      { at: 5, target: 'body', body: 'sela', x: 0, z: -20, lift: 3, dist: 40, pitch: 0, yaw: 0 },
    ],
    captions: [{ at: 0.5, title: 'Night watch' }],
  };
  fs.writeFileSync(file, JSON.stringify(cine, null, 2));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    await new Promise((r) => setTimeout(r, 1500)); // the dev server picks the file up
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}?intro=0&new=1&sw=0&cinematic=zz-gaps-test`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__exo?.ready && window.__exo.cinematic, null, { timeout: 90000 });
    const gameHour = await page.evaluate(() => window.__exo.sim.cur.secs);
    const during = await page.evaluate(() => ({ hour: window.__exo.skyHour(), held: window.__exo.audio.stats().held, id: window.__exo.cinematic?.id }));
    check(during.id === 'zz-gaps-test' && Math.abs(during.hour - 22) < 0.01, `while it plays the sky is at its hour (${during.hour?.toFixed(2)})`);
    check(during.held === 'night-lantern', `its music is held for it (${during.held})`);
    // (software rendering crawls: the cinematic's clock moves at most 0.1 s a frame)
    await page.waitForFunction(() => (window.__exo.cinematic?.t ?? 0) > 1.6, null, { timeout: 150000 });
    const look = await page.evaluate(() => ({ pitch: window.__exo.cam.pitch, sun: window.__exo.system.sunPos.clone().normalize().dot(window.__exo.cam.camera.up) }));
    check(look.pitch < 0.2, `a body key: the camera looks up toward Sela (pitch ${look.pitch.toFixed(2)})`);
    check(look.sun < 0.1, `the sun is down for the night scene (${look.sun.toFixed(2)})`);
    await page.evaluate(() => window.__exo.cinematic?.skip());
    await page.waitForFunction(() => !window.__exo.cinematic, null, { timeout: 30000 });
    const after = await page.evaluate(() => ({ hour: window.__exo.skyHour(), held: window.__exo.audio.stats().held, secs: window.__exo.sim.cur.secs }));
    const expect = ((after.secs / SOL) * 24 + 7) % 24;
    check(after.held === null, 'after: the music director has it back');
    check(Math.abs(after.hour - expect) < 0.05 && Math.abs(after.hour - 22) > 1, `after: the game's own hour again (${after.hour.toFixed(2)}, game clock ${gameHour.toFixed(0)} s)`);
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    check(false, `browser: ${e.message}`);
  } finally {
    await browser.close();
    fs.rmSync(file, { force: true });
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall story-gaps checks passed');
process.exit(failed ? 1 : 0);
