/**
 * The whole campaign, end to end (TECH.md "The campaign (content)"): headless, with the real sim and the real
 * content on every real region, in the order a player meets them. Each region is its own Sim, as in the game:
 * a region's colony is kept as its save (a structured clone of the state, as IndexedDB keeps it), and the shared
 * campaign state (`sharedOf`) is carried from the region left to the region entered (`applyShared`: over the
 * region's save when it has one, over a fresh game with its expedition package when it hasn't). An expedition lost
 * goes through `forgetRegion`, as the worker does; `campaignOver` says what a game over means.
 *
 * Cards are answered by a policy (event → choice; otherwise the first choice offered), cinematics are done at once.
 * Where the bot can't play a step it is forced, and every forced step is counted and listed at the end:
 *   - the Touchdown tutorials: buildings by the play-test setup (`playSetup`), first-night and firstborn finished
 *     by the inspector; colonists decanted by the inspector and aged to adults; home waves held off;
 *   - units are teleported to story sites on most expeditions (orders on Ash, Cinder, Teth and the Lantern's
 *     approach), buildings an objective wants come from `playSetup`; the Vell's trust (regard) and the Choir's
 *     wall fight (its flag) are set; Dunmore's escort gets a guard of tanks; the Launch Gantry is set up;
 *   - the colony's mood before Trust decides (every adult's stance) picks the branch;
 *   - the Lantern: a strike group is put at the core when the units haven't reached it in time; Cycle's Command
 *     Cores are destroyed by the inspector.
 * Then every ending from the fork its choices lead to: Covenant (destroy, no Long Ear; seized without the Proof),
 * Covenant via the Long Ear, Proof, Severance (the failsafe; the vote), Inheritance (obey; give in at the core),
 * Cycle (the Core lost in the fight at home; the Core lost at the Lantern).
 *   node tools/campaign-smoke.mjs [--verbose]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const verbose = process.argv.includes('--verbose');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const { module: F } = await runnerImport(path.join(root, 'tools/flow-entry.ts'));
const C = M.content;
const HZ = 10;
const t0 = Date.now();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; return ok; };
const forced = [];
const force = (what) => { forced.push(what); if (verbose) console.log(`      (forced: ${what})`); };
const note = (msg) => console.log(`   ${msg}`);

// ---------- the content's own consistency (the editor's Story flow and Endings ledger) ----------
{
  const known = new Set(Object.values(C.regions).flatMap((r) => [...(r.encounters ?? []).map((e) => e.doneFlag), ...(r.outposts ?? []).map((o) => o.story)]).filter(Boolean));
  const flow = F.analyzeFlow(C.missions, C.story, known);
  check(!flow.problems.length, `Story flow: no problems${flow.problems.length ? ` (${flow.problems.map((p) => `${p.at.id}: ${p.msg}`).join('; ')})` : ''}`);
  check(!flow.stray.length, 'Story flow: every mission is in the chain');
  const L = F.buildLedger(C.missions, C.story);
  const bad = L.thresholds.filter((t) => !t.reachable);
  check(!bad.length, `Endings ledger: every threshold reachable${bad.length ? ` (${bad.map((t) => `${t.id} ${t.measure} ${t.op} ${t.value}`).join('; ')})` : ''}`);
  // a mission on another region needs a route to it
  const routed = new Set();
  for (const d of [...Object.values(C.story).map((e) => e.effects), ...Object.values(C.missions).map((m) => m.rewards)]) for (const e of d ?? []) if (e.kind === 'route' || e.kind === 'travel') routed.add(e.region);
  const unrouted = Object.entries(C.missions).filter(([, m]) => m.region && m.region !== M.HOME_REGION && !routed.has(m.region)).map(([id]) => id);
  check(!unrouted.length, `every expedition mission's region is routed by something${unrouted.length ? ` (${unrouted})` : ''}`);
}

// ---------- the campaign harness ----------
/** Region saves (structured clones of the colony state, as IndexedDB keeps them) and the campaign's shared state. */
const saves = {};
let shared;
const seenAll = new Set();
const policy = {};
const log = [];

/** Enter a region as the game does: its save with the shared state over it, or a fresh game there. */
function enter(region, from = { saves, shared }) {
  M.useRegion(region);
  const sim = new M.Sim((t) => log.push(t));
  const save = from.saves[region];
  if (save) {
    const st = structuredClone(save);
    if (from.shared) M.applyShared(st, from.shared, region);
    sim.load(st);
  } else {
    if (from.shared) { M.applyShared(sim.s, from.shared, region); sim.arrived(); }
    sim.command({ type: 'landing', stage: 'deploy' });
  }
  if (region !== M.HOME_REGION) sim.s.waves.next = Math.max(sim.s.waves.next, sim.s.tick + 1e9); // expeditions: no wild packs (the bot doesn't defend)
  else sim.s.waves.next = Number.MAX_SAFE_INTEGER; // home: waves held off (forced; see the header)
  return { sim, region, s: sim.s, st: sim.s.story, seen: [] };
}
/** Leave a region (travel): its save kept, the shared state taken from it. */
function leave(g) {
  delete g.s.travel;
  const over = M.campaignOver(g.s, g.region);
  if (over === 'expedition-lost') { delete saves[g.region]; shared = M.forgetRegion(M.sharedOf(g.s), g.region, C); return; }
  saves[g.region] = structuredClone(g.s);
  shared = M.sharedOf(g.s);
}
const firstShown = (id, flags) => { const ev = C.story[id]; const shown = ev ? M.shownChoices(ev, flags) : [0]; return shown.length ? shown[0] : 0; };
/** Run `secs` (stops early at a game over or, with `untilTravel`, a travel request; or when `until` holds). */
function run(g, secs, { until, every } = {}) {
  for (let i = 0; i < secs * HZ; i++) {
    g.sim.step();
    if (i % HZ === 0) {
      for (const id of [...(g.st.cineQueue ?? [])]) { g.seen.push(`cine:${id}`); seenAll.add(`cine:${id}`); g.sim.command({ type: 'cinematic', id, done: true }); }
      for (const id of [...g.st.inbox]) {
        if (policy[id] === 'hold') continue; // left on screen (a fork point)
        g.seen.push(id); seenAll.add(id);
        g.sim.command({ type: 'story', id, choice: policy[id] ?? firstShown(id, g.st.flags) });
      }
      every?.(i / HZ);
      if (until?.()) return true;
    }
    if (g.s.over) return false;
  }
  return !!until?.();
}
const site = (region, id) => { const p = C.regions[region].sites.find((x) => x.id === id); if (!p) throw new Error(`no site ${id} on ${region}`); return p; };
const ours = (g) => g.s.units.filter((u) => !u.team);
/** Teleport one of our units (or a drone) onto a story site (forced) and give the story a moment. */
function at(g, id, secs = 3) {
  const p = site(g.region, id), u = ours(g)[0] ?? g.s.drones[0];
  u.x = p.x; u.z = p.z;
  if ('unit' in u) { u.gx = p.x; u.gz = p.z; u.order = { kind: 'idle' }; } else u.task = { kind: 'idle' };
  force(`${g.region}: a unit to ${id}`);
  run(g, secs);
}
/** Order our units to a site until `until` holds (the bot plays it). */
function walk(g, id, until, maxS = 400) {
  const p = site(g.region, id);
  return run(g, maxS, { until, every: (t) => { if (t % 15 === 0) g.sim.command({ type: 'order', ids: ours(g).map((u) => u.id), x: p.x, z: p.z }); } });
}
const setup = (g, what, why) => { g.sim.command({ type: 'debug', setup: what }); force(`${g.region}: ${why}`); run(g, 2); };
const has = (g, f) => g.st.flags.includes(f);
const done = (g, m) => g.s.missions.done.includes(m);
const fired = (g, e) => g.st.fired.includes(e);
const active = (g, m) => g.s.missions.active.includes(m);

/** One expedition: travel there, play `play`, assert the mission done, travel on (home by default). */
function expedition(region, mission, play, { to = M.HOME_REGION } = {}) {
  const g = enter(region);
  check(g.s.expedition === true, `${region}: an expedition (${ours(g).length} units, ${g.s.drones.length} drones, ${Math.round(g.s.alloys)} alloys)`);
  run(g, 3);
  check(active(g, mission) || done(g, mission), `${region}: ${mission} under way on arrival`);
  if (C.cinematics[`arrive-${region}`]) check(g.seen.includes(`cine:arrive-${region}`), `${region}: its arrival cinematic`);
  play(g);
  run(g, 8, { until: () => done(g, mission) });
  check(done(g, mission), `${region}: ${mission} done (objectives ${JSON.stringify(g.s.missions.marks[mission] ?? [])})`);
  run(g, 4, { until: () => !!g.s.travel });
  if (to === M.HOME_REGION) check(g.s.travel === M.HOME_REGION || g.st.inbox.length === 0, `${region}: the done card offers home (${g.s.travel ?? 'no travel'})`);
  leave(g);
  return g;
}
/** Home: the colony's own save with the shared state over it. */
function home(secs = 30, until) {
  const g = enter(M.HOME_REGION);
  if (secs) run(g, secs, { until: until && (() => until(g)) });
  return g;
}

// ---------- Touchdown: the tutorials (shortcut) ----------
let H = enter(M.HOME_REGION);
{
  const g = H;
  run(g, 1);
  check(active(g, 'touchdown'), 'Touchdown: the first mission under way');
  setup(g, { buildings: ['solar', 'solar', 'solar'] }, 'tutorial buildings: solar');
  run(g, 3, { until: () => done(g, 'touchdown') });
  check(done(g, 'touchdown'), 'touchdown done (a Solar Array)');
  setup(g, { buildings: ['depot', 'depot', 'battery', 'solar'] }, 'tutorial buildings: depots, battery');
  g.sim.command({ type: 'debug', setup: {} });
  g.s.drones.push({ ...g.s.drones[0], id: g.s.nextId++, x: 4, z: -10, task: { kind: 'idle' } }); force('touchdown: a second drone');
  run(g, 3, { until: () => done(g, 'groundwork') });
  check(done(g, 'groundwork'), 'groundwork done (depots, drones, battery)');
  for (const m of ['first-night', 'firstborn']) {
    run(g, 2, { until: () => active(g, m) });
    check(active(g, m), `${m} under way`);
    g.sim.command({ type: 'inspect', finish: m }); force(`touchdown: ${m} finished by the inspector`);
    run(g, 3);
    check(done(g, m), `${m} done`);
  }
  // a colony to carry the story: colonists, aged to adults (Trust decides reads its adults), and its buildings
  setup(g, { buildings: ['turret', 'turret', 'radar', 'hydroponics', 'hydroponics', 'civic', 'habitat', 'habitat', 'solar', 'solar', 'solar', 'solar', 'solar', 'solar', 'battery', 'battery', 'battery', 'geothermal', 'geothermal'], colonists: 12 }, 'a colony: 12 colonists and buildings');
  for (const c of g.s.people.colonists) c.born = g.sim.secs - 30 * C.colony.solSeconds;
  force('touchdown: the colonists aged to adults');
  run(g, 2, { until: () => active(g, 'beyond-the-ridge') });
  check(active(g, 'beyond-the-ridge'), 'beyond-the-ridge under way');
  at(g, 'east-stone', 4);
  const camp = g.s.camps.findIndex((c) => c.group === 'vell');
  g.sim.command({ type: 'contact', camp, choice: 'approach' });
  g.s.camps[camp].met = true; force('touchdown: met the Vell camp');
  setup(g, { sol: 4 }, 'the clock to Sol 4');
  run(g, 10, { until: () => done(g, 'beyond-the-ridge') });
  check(done(g, 'beyond-the-ridge'), `beyond-the-ridge done (${JSON.stringify(g.s.missions.marks['beyond-the-ridge'])})`);
  const routes = g.s.campaign.routes;
  check(['hearthsmoke', 'choir-field', 'burrow-reach', 'splinter-hollow'].every((r) => routes.includes(r)), `the four Act 1 routes (${routes})`);
  check(g.seen.includes('open-planet'), 'open-planet at home');
  leave(g);
}
note(`Touchdown: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------- Act 1: the open planet ----------
expedition('hearthsmoke', 'smoke-on-the-horizon', (g) => {
  at(g, 'vale-smoke');
  const camp = g.s.camps[0]; const u = ours(g)[0]; u.x = camp.x + 6; u.z = camp.z; run(g, 3);
  at(g, 'keeper-stones');
  g.s.camps.forEach((c, i) => { if (c.pending) g.sim.command({ type: 'contact', camp: i, choice: 'approach' }); g.sim.command({ type: 'debug', regard: { camp: i, value: 95 } }); });
  force('hearthsmoke: the Vell\'s regard to 95 (trust)');
  run(g, 60, { until: () => has(g, 'keeper-song') });
  run(g, 3);
  check(has(g, 'keeper-song') && g.seen.includes('cine:cine-keeper'), 'hearthsmoke: the Keeper\'s Song (keeper-song, cine-keeper)');
});
expedition('choir-field', 'the-choir', (g) => {
  at(g, 'choir-loop');
  at(g, 'code-wall');
  g.st.flags.push('wall-spitters-beaten'); force('choir-field: the wall\'s spitters beaten (flag)');
  setup(g, { buildings: ['sensor'] }, 'a Sensor Array');
  run(g, 5);
  check(has(g, 'choir-fragment'), 'choir-field: choir-fragment');
});
expedition('burrow-reach', 'designer-marks', (g) => {
  at(g, 'furrow-grid'); at(g, 'spitter-pans'); at(g, 'brood-mound');
  check(has(g, 'marks-seen'), 'burrow-reach: marks-seen');
});
{
  const g = home(60, (g) => g.s.campaign.routes.includes('signal-heights'));
  check((g.st.counters['act1-trips'] ?? 0) === 3, `home: three trips counted (${g.st.counters['act1-trips']})`);
  check(g.s.campaign.routes.includes('signal-heights'), 'home: three trips route Signal Heights');
  leave(g);
}
expedition('splinter-hollow', 'the-hollow', (g) => {
  at(g, 'hollow-gate'); at(g, 'splinter-camp'); at(g, 'old-cellar');
  check(g.s.campaign.routes.includes('deep-layer'), 'splinter-hollow: the cellar routes the Deep Layer');
});
expedition('deep-layer', 'deep-layer', (g) => {
  at(g, 'crater-rim'); at(g, 'oldest-layer'); at(g, 'enclave-cut', 8);
  check(has(g, 'survivors-met') || g.seen.includes('the-enclave'), 'deep-layer: the Enclave (survivors-met)');
});
{
  // Signal Heights: wrong-address, then signal (hold the post through the night, with the wild packs on)
  const g = enter('signal-heights');
  g.s.waves.next = g.s.tick + 600;
  run(g, 3);
  check(active(g, 'wrong-address'), 'signal-heights: wrong-address under way');
  at(g, 'carrier-trace');
  setup(g, { buildings: ['radar'] }, 'a Radar');
  at(g, 'carrier-trace', 5);
  check(done(g, 'wrong-address') && has(g, 'wrong-address'), 'signal-heights: wrong-address done');
  run(g, 5, { until: () => active(g, 'signal') });
  check(g.seen.includes('moon-watch') && active(g, 'signal'), 'signal-heights: moon-watch, then signal');
  at(g, 'listening-post');
  setup(g, { buildings: ['relay'] }, 'a Relay');
  const held = run(g, 400, { until: () => done(g, 'signal') });
  check(held && !g.s.over, `signal-heights: the post held through the night (${ours(g).length} units left)`);
  check(has(g, 'act1-done') && g.seen.includes('cine:cine-signal'), 'signal: act1-done, cine-signal');
  run(g, 40, { until: () => !!g.s.travel });
  check(g.s.travel === M.HOME_REGION, 'act1-close: home');
  leave(g);
}
note(`Act 1: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------- Act 2 ----------
{
  const g = home(30, (g) => g.st.fired.includes('act2-open'));
  run(g, 2);
  check(fired(g, 'act2-open') || g.seen.includes('act2-open'), 'home: act2-open on act1-done');
  check(active(g, 'build-gantry'), 'home: build-gantry under way');
  setup(g, { research: ['isotope-cells', 'orbital-launch'], buildings: ['launch-gantry'] }, 'Orbital Launch and a Launch Gantry');
  run(g, 10, { until: () => !!g.s.travel });
  check(done(g, 'build-gantry') && g.s.campaign.routes.includes('sela-relay'), 'build-gantry done: the route to Sela');
  check(g.seen.includes('cine:cine-first-launch') && g.s.travel === 'sela-relay', 'sela-sky: the launch, travel to Sela');
  leave(g);
}
expedition('sela-relay', 'first-light', (g) => {
  at(g, 'relay-mast', 4); at(g, 'far-door', 4);
  check(g.seen.includes('the-door-lid') && !g.seen.includes('the-door'), 'sela-relay: the Lid (survivors-met)');
});
check(['verdance-landfall', 'talus-yard', 'ash-hulls'].every((r) => shared.campaign.routes.includes(r)), 'first-light: Verdance, Talus and Ash routed');
{
  const g = home(40, (g) => g.st.flags.includes('engram-contact'));
  check(g.seen.includes('engram-hello') && has(g, 'engram-contact'), 'home: engram-hello after Sela');
  leave(g);
}
// Kindred
policy['marrow-meeting'] = 0; // honest
expedition('verdance-landfall', 'landfall', (g) => {
  const kin = g.s.buildings.filter((b) => b.team === g.s.factions[0].team);
  check(kin.filter((b) => b.seen).length >= kin.length / 2, `verdance: the arrival cinematic shows Kindred's colony (${kin.filter((b) => b.seen).length} of ${kin.length} buildings seen)`);
  at(g, 'kindred-gate', 5); at(g, 'council-hall', 8);
  check(has(g, 'kindred-honest') && g.seen.includes('cine:cine-marrow'), 'verdance: honest at the hall, cine-marrow');
  check(g.s.factions[0].attitude === 'neutral', 'verdance: no shots fired');
}, { to: 'dunmore-dustfall' });
expedition('dunmore-dustfall', 'dustfall', (g) => {
  check(g.s.factions[0].attitude === 'allied', 'dunmore: Kindred allied for the escort');
  at(g, 'survey-camp', 4);
  run(g, 30);
  at(g, 'old-hull', 1);
  g.sim.command({ type: 'debug', units: { unit: 'tank', x: 60, z: 60, n: 8 } }); force('dunmore: eight tanks guard the escort');
  run(g, 150, { until: () => done(g, 'dustfall') || g.s.missions.failed?.includes('dustfall') });
  check(has(g, 'marrow-manifest') && has(g, 'swarm-beaten'), 'dunmore: the manifest, the swarm beaten');
});
policy['failsafe-offer'] = 0; // accept
{
  const g = home(90, (g) => g.st.flags.includes('failsafe-built'));
  check(has(g, 'kindred-ally'), 'kindred-ally (honest, the team home)');
  check(g.seen.includes('failsafe-offer') && has(g, 'failsafe-built'), 'home: Bede\'s failsafe, accepted');
  leave(g);
}
// Engram
expedition('talus-yard', 'yard', (g) => {
  setup(g, { buildings: ['depot', 'bay'] }, 'a depot and a bay');
  at(g, 'cache-berth', 12);
  check(has(g, 'cache-rerouted'), 'talus: the cache re-routed');
}, { to: 'maren-works' });
policy['engram-offer'] = 1; // refuse politely
expedition('maren-works', 'the-works', (g) => {
  at(g, 'works-gate'); at(g, 'chassis-hall', 6);
  check(g.seen.includes('cine:cine-same-hands') && g.seen.includes('engram-offer'), 'maren: same hands, Engram\'s offer');
}, { to: 'iot-drops' });
expedition('iot-drops', 'drop-field', (g) => {
  setup(g, { buildings: ['sensor'] }, 'a Sensor Array');
  run(g, 90, { until: () => has(g, 'capsule-down') });
  at(g, 'drop-zone', 20);
  check(has(g, 'luck-proved'), `io-t: luck-proved (engram ${g.st.counters.engram})`);
}, { to: 'pip-wreck' });
expedition('pip-wreck', 'pip-wreck', (g) => {
  at(g, 'scout-wreck'); at(g, 'engram-pen', 6);
  check(has(g, 'scouts-freed'), 'pip: the scouts freed by talk');
});
{
  const g = home(40, (g) => g.s.campaign.routes.includes('cinder-foundry'));
  const leads = ['foundry-lead-kd', 'foundry-lead-kl', 'foundry-lead-dl'].filter((x) => fired(g, x));
  check(leads.join() === 'foundry-lead-kd' && g.s.campaign.routes.includes('cinder-foundry'), `home: two threads (Kindred, Engram) route the Foundry (${leads})`);
  leave(g);
}
// the Proof thread
expedition('ash-hulls', 'hull-field', (g) => {
  for (const id of ['row-accord', 'row-kindred', 'row-engram']) check(walk(g, id, () => fired(g, id)), `ash: ${id} reached`);
  check(walk(g, 'newest-hull', () => fired(g, 'newest-hull'), 600), `ash: the newest berth reached (${ours(g).length} units)`);
}, { to: 'vess-ledger' });
expedition('vess-ledger', 'the-ledger', (g) => {
  check(walk(g, 'shaft-head', () => fired(g, 'drill-start')), 'vess: drilling');
  check(walk(g, 'shaft-head', () => has(g, 'drilled'), 400), `vess: drilled through (${ours(g).length} units)`);
  check(walk(g, 'ledger-vault', () => has(g, 'ledger-read'), 300), 'vess: the Ledger read');
  check(g.seen.includes('cine:cine-ledger'), 'vess: cine-ledger');
});
{
  const g = home(60, (g) => g.s.campaign.routes.includes('rime-prime') && g.st.fired.includes('clause-5'));
  check(g.s.campaign.routes.includes('rime-prime'), 'home: ledger-read + luck-proved route Rime');
  check(fired(g, 'clause-5'), `home: clause-5 (lead ${g.st.counters.lead})`);
  check(!['foundry-lead-kl', 'foundry-lead-dl'].some((x) => fired(g, x)), 'home: the third thread fires no second Foundry lead');
  leave(g);
}
policy['engram-choice'] = 2;
expedition('rime-prime', 'prime', (g) => {
  at(g, 'ice-gate'); at(g, 'mind-well', 6);
  check(has(g, 'engram-defected') && g.s.factions[0].attitude === 'allied', `rime: Engram defects (engram ${g.st.counters.engram})`);
}, { to: 'cinder-foundry' });
expedition('cinder-foundry', 'foundry', (g) => {
  check(walk(g, 'launch-rail', () => fired(g, 'the-rail')), 'cinder: the rail');
  check(walk(g, 'print-hall', () => fired(g, 'three-cradles'), 600), 'cinder: the cradles');
  check(walk(g, 'director-booth', () => fired(g, 'director-three'), 600), 'cinder: the booth');
  run(g, 5, { until: () => done(g, 'foundry') });
  check(has(g, 'foundry-found') && g.seen.includes('cine:cine-foundry') && g.s.campaign.routes.includes('teth-ear'), 'cinder: foundry-found, cine-foundry, Teth routed');
}, { to: 'teth-ear' });
note(`Act 2 up to the Foundry: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
/** The campaign as it stands back from Cinder (no Long Ear): fork A. */
const forkA = { saves: structuredClone(saves), shared: structuredClone(shared) };
expedition('teth-ear', 'long-ear', (g) => {
  check(walk(g, 'dish-core', () => fired(g, 'ear-silent')), 'teth: the hub');
  const node = C.regions['teth-ear'].relics.find((r) => r.kind === 'node');
  run(g, 90, { until: () => has(g, 'relic-ear-opened'), every: (t) => { if (t % 10 === 0) g.sim.command({ type: 'order', ids: ours(g).map((u) => u.id), x: node.x, z: node.z }); } });
  const ids = ours(g).map((u) => u.id), grp = [0, 1, 2].map((k) => ids.filter((_, i) => i % 3 === k));
  const plates = ['ear-a', 'ear-b', 'ear-c'].map((p) => site('teth-ear', p));
  run(g, 600, { until: () => has(g, 'long-ear'), every: (t) => { if (t % 15 === 0) grp.forEach((gg, i) => g.sim.command({ type: 'order', ids: gg, x: plates[i].x, z: plates[i].z })); } });
  check(has(g, 'long-ear'), 'teth: the dish tuned (long-ear)');
});
const forkB = { saves: structuredClone(saves), shared: structuredClone(shared) };
note(`Act 2: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------- the climax at home ----------
const endings = {};
/** Home after the Foundry, from a fork, with every adult's stance set (the colony's mood picks the branch). */
function climax(fork, stance, name) {
  const g = enter(M.HOME_REGION, fork);
  for (const c of g.s.people.colonists) c.stance = stance;
  force(`${name}: every adult's stance ${stance}`);
  g.name = name;
  run(g, 120, { until: () => fired(g, 'trust-decides') });
  check(g.seen.includes('meridian-speaks') && g.seen.includes('cine:cine-meridian'), `${name}: Meridian speaks (lead ${g.st.counters.lead}, cine-meridian)`);
  check(active(g, 'clause-wakes'), `${name}: clause-wakes under way`);
  return g;
}
/** The fight at home: ten minutes of strikes and turned units, then the strike force lifts for the Lantern. */
function fight(g, { coreAt } = {}) {
  run(g, 20, { until: () => has(g, 'the-fight') });
  check(has(g, 'the-fight') && g.seen.includes('trust-partners'), `${g.name}: the Partners fight`);
  // no forced army, domes or buildings: the colony as it stands, the allies by flag, and a defender who rebuilds what
  // the strikes take with the build command (alloys and drones, as a player) and keeps the units by the Core
  const b0 = g.s.stats.buildingsLost;
  let rebuilt = 0;
  const sites = g.s.buildings.filter((b) => !b.team && ['solar', 'battery', 'hydroponics'].includes(b.kind)).map((b) => ({ kind: b.kind, x: b.x, z: b.z }));
  const core = g.s.buildings.find((b) => b.kind === 'core' && !b.team);
  run(g, 700, { until: () => !!g.s.travel, every: (t) => {
    if (t % 5 === 0 && !g.s.missions.failed?.includes('clause-wakes')) {
      const have = g.s.buildings.filter((b) => !b.team);
      const p = sites.find((q) => !have.some((b) => b.kind === q.kind && Math.hypot(b.x - q.x, b.z - q.z) < 3));
      if (p && have.filter((b) => b.progress < 1).length < 3 && g.s.alloys >= C.buildings[p.kind].cost) {
        const n = g.s.buildings.length;
        g.sim.command({ type: 'build', kind: p.kind, x: p.x, z: p.z });
        if (g.s.buildings.length > n) rebuilt++;
      }
    }
    if (t % 4 === 0) {
      const far = ours(g).filter((u) => u.target < 0 && u.order.kind === 'idle' && Math.hypot(u.x - core.x, u.z - core.z) > 16);
      if (far.length) g.sim.command({ type: 'order', ids: far.map((u) => u.id), x: core.x, z: core.z - 12 });
    }
    if (coreAt !== undefined && t === coreAt) { const core = g.s.buildings.find((b) => b.kind === 'core' && !b.team); g.sim.command({ type: 'debug', hurt: { id: core.id, hp: 1e9 } }); force(`${g.name}: the Core destroyed by the inspector`); }
  } });
  note(`${g.name}: strikes landed ${g.st.struck?.n ?? 0}, rebuilt ${rebuilt}, buildings lost ${g.s.stats.buildingsLost - b0}, cryo ${Math.round(g.s.cryo)}, colonists ${g.s.people.colonists.length} (lost: ${[...new Set(g.s.people.memorial.map((m) => m.cause))].join('; ')}), planet ${Math.round(g.sim.planet.health())}, acceptance ${Math.round(g.sim.people.acceptance())}`);
  return g;
}
/** An ending reached: its epilogue, the game over, the campaign over (`campaignOver` = the worker wipes the saves). */
function ending(g, ending, label, how) {
  run(g, 30, { until: () => !!g.s.over });
  const ep = g.st.epilogue;
  const ok = check(g.s.over === (ending === 'cycle' ? 'story' : 'won') && ep?.ending === ending && ep.pages.length > 0, `${label}: ${how} → ${ending} (${g.s.over ?? 'not over'}, epilogue ${ep?.ending ?? 'none'}, ${ep?.pages.length ?? 0} pages)`);
  check(M.campaignOver(g.s, g.region) === 'ended', `${label}: the campaign is over (${M.campaignOver(g.s, g.region)}${g.region !== M.HOME_REGION ? ', not "expedition lost"' : ''})`);
  check(g.seen.includes(`cine:end-${ending}`), `${label}: end-${ending} plays`);
  if (g.region === 'lantern' && ending !== 'cycle') check(done(g, 'the-lantern'), `${label}: the-lantern done`);
  if (ok) (endings[label] = `${ending} · ${how} · ${g.region}`);
  return g;
}
/** The strike force lands at the Lantern; the units fight down to the core and the core's card waits (a fork). */
function lantern(home, { edit, name } = {}) {
  const sh = M.sharedOf(home.s);
  edit?.(sh);
  const g = enter('lantern', { saves: {}, shared: sh });
  g.name = name ?? `${home.name} at the Lantern`;
  policy['the-core'] = 'hold';
  run(g, 5);
  check(active(g, 'the-lantern') && g.seen.includes('lantern-landing'), `${g.name}: the-lantern under way, the landing card`);
  check(g.s.campaign.home && g.s.campaign.home.acceptance !== null, `${g.name}: the home snapshot came along (planet ${g.s.campaign.home?.planet}, acceptance ${Math.round(g.s.campaign.home?.acceptance ?? -1)})`);
  run(g, 20, { until: () => has(g, 'lid-open') });
  check(has(g, 'lid-code') && has(g, 'lid-open'), `${g.name}: the Enclave's code opens the Lid`);
  const allies = ['lantern-kindred', 'lantern-vell', 'lantern-choir', 'lantern-engram'];
  run(g, 60, { until: () => allies.every((x) => fired(g, x)) });
  check(allies.every((x) => fired(g, x)), `${g.name}: allies by flag (${allies.filter((x) => fired(g, x)).join(', ')})`);
  const core = site('lantern', 'lantern-core'), near = g.s.buildings.filter((b) => b.team && Math.hypot(b.x - core.x, b.z - core.z) < 40);
  check(near.length > 0 && near.every((b) => b.seen), `${g.name}: the Vell's runners reveal the core (its ${near.length} buildings seen)`);
  check(g.s.factions.find((f) => f.id === 'engram')?.attitude === 'allied', `${g.name}: Engram fights beside us`);
  const reached = walk(g, 'lantern-core', () => g.st.inbox.includes('the-core'), 240);
  if (!reached) {
    const p = site('lantern', 'lantern-core');
    g.sim.command({ type: 'debug', units: { unit: 'tank', x: p.x, z: p.z - 3, n: 6 } }); force(`${g.name}: a strike group put at the core`);
    run(g, 10, { until: () => g.st.inbox.includes('the-core') });
  }
  note(`${g.name}: ${reached ? 'the units reached the core' : 'the core reached by the forced group'} (${ours(g).length} units, countdown ${JSON.stringify(g.st.countdowns?.map((c) => c.id))})`);
  check(g.st.inbox.includes('the-core'), `${g.name}: the core's choice`);
  delete policy['the-core'];
  return { state: structuredClone(g.s), name: g.name };
}
/** A fork of the Lantern at the core's choice. */
function atCore(base, edit) {
  M.useRegion('lantern');
  const sim = new M.Sim((t) => log.push(t));
  const st = structuredClone(base.state);
  edit?.(st);
  sim.load(st);
  return { sim, region: 'lantern', s: sim.s, st: sim.s.story, seen: [], name: base.name };
}

// Fork A: home straight from the Foundry (no Long Ear)
{
  const g = climax(forkA, 70, 'A');
  const f = fight(g);
  check(!g.s.over && done(g, 'clause-wakes') && g.s.travel === 'lantern', `A: the colony held; clause-wakes done; the strike force lifts (${g.s.travel})`);
  check(['fight-kindred', 'fight-engram', 'fight-vell', 'fight-choir', 'strike-13'].every((x) => fired(g, x)), 'A: the allies and the strikes at home fired');
  check(C.story['fight-kindred'].effects.some((e) => e.kind === 'spawn' && e.site === 'core-yard') && site(M.HOME_REGION, 'core-yard'), 'A: Kindred marines land at the Core yard');
  const L = lantern(f);
  check(!fired(atCore(L), 'proof-weighed'), 'A: no Long Ear, so the argument doesn\'t hold');
  ending((() => { const h = atCore(L); h.sim.command({ type: 'story', id: 'the-core', choice: 0 }); return h; })(), 'covenant', 'Covenant', 'destroy the Lantern (no Long Ear)');
  ending((() => { const h = atCore(L); h.sim.command({ type: 'story', id: 'the-core', choice: 1 }); return h; })(), 'covenant', 'Covenant (seized)', 'seize it without the Proof (no Long Ear)');
}
{
  const g = climax(forkA, 70, 'Cycle at home');
  fight(g, { coreAt: 120 });
  check(g.s.missions.failed?.includes('clause-wakes'), 'Cycle at home: clause-wakes failed on coreLost');
  ending(g, 'cycle', 'Cycle', 'the Core lost in the fight at home');
}
{
  const g = climax(forkA, 40, 'Severance');
  run(g, 20, { until: () => !!g.s.over });
  check(g.seen.includes('severance-failsafe') && !g.seen.includes('trust-partners'), 'Severance: the failsafe thrown (failsafe-built, distrust)');
  ending(g, 'severance', 'Severance', 'the failsafe (failsafe-built, acceptance ≤ 45)');
}
{
  const g = climax(forkA, 20, 'Severance (vote)');
  run(g, 20, { until: () => !!g.s.over });
  check(g.seen.includes('severance-vote') || g.seen.includes('severance-failsafe'), 'Severance (vote): the Autonomists lead');
  ending(g, 'severance', 'Severance (vote)', 'an Autonomist majority');
}
{
  policy['trust-devoted'] = 0; // obey
  const g = climax(forkA, 85, 'Inheritance');
  run(g, 20, { until: () => !!g.s.over });
  check(g.seen.includes('trust-devoted'), 'Inheritance: the Devoted kneel');
  ending(g, 'inheritance', 'Inheritance', 'obey (a Devoted majority)');
  delete policy['trust-devoted'];
}
// Fork B: the Long Ear tuned; every Proof condition
{
  const g = climax(forkB, 70, 'B');
  g.s.planet.restored += Math.max(0, 80 - g.sim.planet.health()); force('B: home planet health kept ≥ 70 (restored)');
  const f = fight(g);
  if (f.sim.planet.health() < 72) { f.s.planet.restored += 75 - f.sim.planet.health(); force('B: home planet health topped up after the strikes'); run(f, 2); }
  check(!g.s.over && g.s.travel === 'lantern', 'B: the colony held; the strike force lifts');
  check(fired(g, 'proof-ready'), 'B: the Archivist\'s drive (proof-ready) before the shuttles lift');
  const L = lantern(f);
  ending((() => { const h = atCore(L); h.sim.command({ type: 'story', id: 'the-core', choice: 1 }); return h; })(), 'proof', 'Proof', 'seize it with every Proof condition');
  check(fired(atCore(L), 'proof-weighed'), 'B: the argument holds (proof-weighed at the Lantern)');
  const L50 = lantern(f, { name: 'B (acceptance 50) at the Lantern', edit: (sh) => { sh.campaign.home.acceptance = 50; } });
  force('B: the home snapshot\'s acceptance set to 50');
  const notProof = atCore(L50);
  check(!fired(notProof, 'proof-weighed'), 'B (acceptance 50): the argument doesn\'t hold');
  notProof.sim.command({ type: 'story', id: 'the-core', choice: 1 });
  ending(notProof, 'covenant', 'Covenant (seized, acceptance 50)', 'seize it, the colony not with us');
  check(!notProof.seen.includes('proof'), 'Proof and Covenant (seized) are exclusive');
  const sol = atCore(L); sol.sim.command({ type: 'story', id: 'the-core', choice: 0 });
  ending(sol, 'covenant', 'Covenant via the Long Ear', 'destroy it with long-ear');
  check(sol.seen.includes('covenant-sol') && !sol.seen.includes('covenant'), 'Covenant via the Long Ear: covenant-sol, not covenant');
  const give = atCore(L); give.sim.command({ type: 'story', id: 'the-core', choice: 2 });
  ending(give, 'inheritance', 'Inheritance (give in)', 'give in at the core');
  const lost = atCore(L);
  const core = lost.s.buildings.find((b) => b.kind === 'core' && !b.team);
  lost.sim.command({ type: 'debug', hurt: { id: core.id, hp: 1e9 } }); force('the Lantern: our Core destroyed by the inspector');
  check(lost.s.missions.failed?.includes('the-lantern'), 'Cycle at the Lantern: the-lantern failed on coreLost');
  ending(lost, 'cycle', 'Cycle (the Lantern)', 'the landing\'s Core lost');
}

console.log('\nendings reached:');
for (const [k, v] of Object.entries(endings)) console.log(`  ${k.padEnd(34)} ${v}`);
for (const e of ['covenant', 'proof', 'severance', 'inheritance', 'cycle']) check(Object.values(endings).some((v) => v.startsWith(e)), `ending ${e} reached`);
const unseenMissions = Object.keys(C.missions).filter((m) => !saves.touchdown?.missions?.done.includes(m) && !shared.missions.done.includes(m));
note(`missions not done in the main line: ${unseenMissions.join(', ') || 'none'} (the climax's are done in its forks)`);
console.log(`forced steps (${forced.length}):`);
const counts = {};
for (const f of forced) counts[f] = (counts[f] ?? 0) + 1;
for (const [f, n] of Object.entries(counts)) console.log(`  ${n > 1 ? `${n}× ` : ''}${f}`);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
