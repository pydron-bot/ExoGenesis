/**
 * Story gameplay (headless, the real sim): the effects and conditions that let
 * story records drive the game: spawn, lock/unlock, research, reveal,
 * waypoints, camera, hints, countdowns, counters, win/fail, mission fail
 * conditions, condition groups (all / any / not), HUD `opened` and `placed`,
 * map encounters (guards, patrols, flag-gated), and the story inspector's
 * commands.
 *   node tools/gameplay-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

// the shipped content is left alone: these tests add their own records (and take the shipped ones out)
const keep = { story: { ...C.story }, missions: { ...C.missions } };
for (const k of Object.keys(C.story)) delete C.story[k];
for (const k of Object.keys(C.missions)) delete C.missions[k];

function game() {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9;
  return { sim, log, st: () => sim.s.story, snap: () => sim.snapshot() };
}
const fire = (g, id) => { g.sim.command({ type: 'debug', story: id }); };
const ev = (id, effects, extra = {}) => { C.story[id] = { title: id, text: id, trigger: 'never', effects: effects.map((e) => ({ after: 0, ...e })), ...extra }; };

// ---------- effects ----------
{
  const g = game();
  ev('t-res', [{ kind: 'alloys', amount: 50 }, { kind: 'isotopes', amount: 30 }, { kind: 'research', research: 'deep-survey' }]);
  const al = g.sim.s.alloys;
  fire(g, 't-res');
  check(g.sim.s.alloys === al + 50 && g.sim.s.isotopes === 30, 'alloys and isotopes effects');
  check(g.sim.s.research.done.includes('deep-survey') && g.st().flags.includes('research-deep-survey'), 'research effect: done, free, sets research-<id>');

  ev('t-lock', [{ kind: 'lock', building: 'turret' }, { kind: 'lock', unit: 'rover' }]);
  fire(g, 't-lock');
  g.sim.s.alloys = 5000;
  const n0 = g.sim.s.buildings.length;
  g.sim.command({ type: 'build', kind: 'turret', x: 0, z: -24 });
  check(g.sim.s.buildings.length === n0 && g.log.some((t) => t.includes("isn't available yet")), 'a locked building can\'t be placed');
  check(g.snap().story.locked.includes('turret') && g.snap().story.locked.includes('rover'), 'the snapshot lists what is locked (the HUD hides it)');
  ev('t-unlock', [{ kind: 'unlock', building: 'turret' }]);
  fire(g, 't-unlock');
  g.sim.command({ type: 'build', kind: 'turret', x: 0, z: -24 });
  check(g.sim.s.buildings.length === n0 + 1, 'unlocked: it can be placed again');
  check(g.st().placed.includes('turret'), 'placing records the kind (placed conditions)');

  ev('t-cnt', [{ kind: 'counter', counter: 'honesty', amount: 2 }, { kind: 'counter', counter: 'honesty', amount: 3 }, { kind: 'setCounter', counter: 'fear', amount: -4 }]);
  fire(g, 't-cnt');
  check(g.st().counters.honesty === 5 && g.st().counters.fear === -4, 'counter effects add; setCounter sets');

  ev('t-way', [{ kind: 'waypoint', site: 'east-stone', text: 'Look here' }, { kind: 'camera', site: 'east-stone' }, { kind: 'hint', target: 'buildItem', building: 'solar', text: 'Build this' }]);
  fire(g, 't-way');
  const sn = g.snap().story;
  check(sn.marks.length === 1 && sn.marks[0].x === 90 && sn.marks[0].text === 'Look here', 'waypoint on the story site');
  check(sn.look && sn.look.x === 90 && sn.look.n === 1, 'camera move asked for');
  check(sn.hint && sn.hint.target === 'buildItem' && sn.hint.building === 'solar' && sn.hint.text === 'Build this', 'hint in the snapshot');
  ev('t-clear', [{ kind: 'clearWaypoint' }, { kind: 'unhint' }]);
  fire(g, 't-clear');
  check(!g.snap().story.marks.length && !g.snap().story.hint, 'clearWaypoint and unhint');

  check(!g.sim.explored(90, 30), 'the stone starts in the fog');
  ev('t-rev', [{ kind: 'reveal', site: 'east-stone', amount: 20 }]);
  fire(g, 't-rev');
  check(g.sim.explored(90, 30) && g.sim.explored(105, 30) && !g.sim.explored(120, 30), 'reveal clears the fog round the site (radius 20)');
}

// ---------- spawns: attack, guard, accord ----------
{
  const g = game();
  ev('t-spawn', [{ kind: 'spawn', unit: 'swarmer', count: 4, site: 'east-stone' }]);
  fire(g, 't-spawn');
  const hs = g.sim.s.hostiles.filter((h) => h.unit === 'swarmer');
  check(hs.length === 4 && g.sim.s.packs.length === 1, 'spawn: 4 swarmers as a pack');
  steps(g.sim, 100);
  const closer = g.sim.s.hostiles.filter((h) => h.unit === 'swarmer').every((h) => Math.hypot(h.x, h.z) < Math.hypot(90, 30) - 5);
  check(closer, 'the pack heads for the colony');

  const g2 = game();
  ev('t-guard', [{ kind: 'spawn', unit: 'brute', count: 2, site: 'east-stone', guard: true }]);
  fire(g2, 't-guard');
  steps(g2.sim, 300);
  const gs = g2.sim.s.hostiles.filter((h) => h.unit === 'brute');
  check(gs.length === 2 && gs.every((h) => h.guard && Math.hypot(h.x - 90, h.z - 30) < 15), 'guards stay round their site');
  // a drone wanders near: they go for it
  const d = g2.sim.s.drones[0];
  d.x = 84; d.z = 30; d.task = { kind: 'idle' }; d.manual = true;
  steps(g2.sim, 5);
  check(gs.some((h) => h.target === d.id), 'a guard goes for what comes near');

  const g3 = game();
  ev('t-ally', [{ kind: 'spawn', unit: 'rover', count: 3, site: 'east-stone' }]);
  fire(g3, 't-ally');
  check(g3.sim.s.units.filter((u) => u.unit === 'rover').length === 3, 'Accord units join the colony');
}

// ---------- countdowns, conditions, groups ----------
{
  const g = game();
  ev('t-cd', [{ kind: 'countdown', timer: 'dawn', amount: 5, text: 'Hold until dawn' }]);
  C.story['t-after-cd'] = { title: 'dawn', text: 'dawn', trigger: 'timer', timer: 'dawn' };
  C.story['t-group'] = { title: 'grp', text: 'grp', trigger: 'all', of: [{ kind: 'counter', counter: 'trust', count: 3 }, { kind: 'flag', flag: 'night', not: true }] };
  C.story['t-any'] = { title: 'any', text: 'any', trigger: 'any', of: [{ kind: 'alloys', count: 99999 }, { kind: 'researched', research: 'isotope-cells' }] };
  fire(g, 't-cd');
  check(g.snap().story.countdowns[0]?.text === 'Hold until dawn' && Math.abs(g.snap().story.countdowns[0].left - 5) < 0.2, 'countdown shows its text and time left');
  steps(g.sim, 40);
  check(!g.st().fired.includes('t-after-cd'), 'the timer condition waits');
  steps(g.sim, 20);
  check(g.st().expired.includes('dawn') && g.st().fired.includes('t-after-cd'), 'when it runs out, timer conditions are met');
  g.sim.command({ type: 'inspect', counter: { id: 'trust', value: 3 }, flag: 'night' });
  steps(g.sim, 10);
  check(!g.st().fired.includes('t-group'), 'all-group: blocked while "not flag night" is false');
  g.sim.command({ type: 'inspect', unflag: 'night' });
  steps(g.sim, 10);
  check(g.st().fired.includes('t-group'), 'all-group fires once both hold');
  check(!g.st().fired.includes('t-any'), 'any-group waits');
  g.sim.s.research.done.push('isotope-cells');
  steps(g.sim, 10);
  check(g.st().fired.includes('t-any'), 'any-group fires on one of its conditions');

  C.story['t-open'] = { title: 'o', text: 'o', trigger: 'opened', panel: 'select', building: 'solar' };
  C.story['t-place'] = { title: 'p', text: 'p', trigger: 'placed', building: 'solar' };
  g.sim.command({ type: 'ui', what: 'select' });
  steps(g.sim, 10);
  check(!g.st().fired.includes('t-open'), 'opened: select of a kind needs that kind');
  g.sim.command({ type: 'ui', what: 'select:solar' });
  g.sim.s.alloys = 999;
  g.sim.command({ type: 'build', kind: 'solar', x: 0, z: -20 });
  steps(g.sim, 10);
  check(g.st().fired.includes('t-open') && g.st().fired.includes('t-place'), 'opened and placed conditions');

  C.story['t-kills'] = { title: 'k', text: 'k', trigger: 'kills', count: 1 };
  g.sim.s.stats.kills = 1;
  steps(g.sim, 10);
  check(g.st().fired.includes('t-kills'), 'kills condition');
}

// ---------- missions: fail conditions, win / fail effects ----------
{
  C.missions['m-a'] = { title: 'Hold', objectives: [{ text: 'Reach 5 trust', kind: 'counter', counter: 'trust', count: 5 }],
    fails: [{ text: 'The Core was hit', kind: 'lost', count: 1 }], onFail: 't-onfail', rewards: [{ kind: 'alloys', amount: 10 }] };
  C.missions['m-b'] = { title: 'After', after: 'm-a', objectives: [{ text: 'x', kind: 'never' }] };
  ev('t-onfail', [{ kind: 'flag', flag: 'm-a-failed' }]);
  const g = game();
  steps(g.sim, 10);
  check(g.sim.s.missions.active.includes('m-a'), 'the mission starts');
  g.sim.s.stats.buildingsLost = 1;
  steps(g.sim, 10);
  check(g.sim.s.missions.failed.includes('m-a') && !g.sim.s.missions.active.includes('m-a'), 'a fail condition fails it');
  check(g.log.some((t) => t.startsWith('Mission failed: Hold')) && g.st().fired.includes('t-onfail'), 'logs it and fires its fail event');
  steps(g.sim, 20);
  check(!g.sim.s.missions.active.includes('m-b') && !g.sim.s.over, 'the mission after it doesn\'t start; the game goes on');
  C.story['t-failed'] = { title: 'f', text: 'f', trigger: 'failed', mission: 'm-a' };
  steps(g.sim, 10);
  check(g.st().fired.includes('t-failed'), 'failed condition');
  check(g.snap().missions.failed.includes('m-a'), 'the snapshot lists failed missions');

  C.missions['m-a'].failEnds = true;
  const g2 = game();
  steps(g2.sim, 10);
  g2.sim.s.stats.buildingsLost = 1;
  steps(g2.sim, 10);
  check(g2.sim.s.over === 'story' && g2.sim.s.overText === 'The Core was hit', 'failEnds: the game is lost with the fail text');
  delete C.missions['m-a']; delete C.missions['m-b'];

  const g3 = game();
  ev('t-win', [{ kind: 'win', text: 'The signal is answered.' }]);
  fire(g3, 't-win');
  check(g3.sim.s.over === 'won' && g3.snap().overText === 'The signal is answered.', 'win effect ends the game as a win');
  const g4 = game();
  ev('t-lose', [{ kind: 'fail', text: 'They walked away.' }]);
  fire(g4, 't-lose');
  check(g4.sim.s.over === 'story' && g4.sim.s.overText === 'They walked away.', 'fail effect ends the game as a loss');
}

// ---------- the inspector's commands ----------
{
  C.missions['m-i'] = { title: 'Inspect', objectives: [{ text: 'a', kind: 'never' }, { text: 'b', kind: 'never' }], rewards: [{ kind: 'alloys', amount: 77 }] };
  const g = game();
  steps(g.sim, 10);
  g.sim.command({ type: 'inspect', objective: { mission: 'm-i', index: 0 } });
  check(g.snap().missions.active.find((m) => m.id === 'm-i').marks[0] === true, 'inspector: tick an objective');
  const al = g.sim.s.alloys;
  g.sim.command({ type: 'inspect', finish: 'm-i' });
  check(g.sim.s.missions.done.includes('m-i') && g.sim.s.alloys >= al + 77, 'inspector: finish a mission (rewards run)');
  const t0 = g.sim.s.tick;
  g.sim.command({ type: 'inspect', skip: 60 });
  check(g.sim.s.tick === t0 + 600, 'inspector: skip a minute');
  ev('t-cd2', [{ kind: 'countdown', timer: 'x', amount: 500 }]);
  fire(g, 't-cd2');
  g.sim.command({ type: 'inspect', expire: 'x' });
  check(g.st().expired.includes('x') && !g.st().countdowns.length, 'inspector: run a countdown out');
  delete C.missions['m-i'];
}

// ---------- tutorial hints clear themselves ----------
{
  const g = game();
  ev('t-h1', [{ kind: 'hint', target: 'build', text: 'Tap Build' }]);
  fire(g, 't-h1');
  g.sim.command({ type: 'ui', what: 'people' });
  check(!!g.st().hint, 'a Build hint stays while the player does something else');
  g.sim.command({ type: 'ui', what: 'build' });
  check(!g.st().hint, 'opening the Build menu clears it');
  ev('t-h2', [{ kind: 'hint', target: 'buildItem', building: 'solar', text: 'Pick the Solar Array' }]);
  fire(g, 't-h2');
  g.sim.s.alloys = 999;
  g.sim.command({ type: 'build', kind: 'solar', x: 0, z: -20 });
  check(!g.st().hint, 'placing the pointed-at building clears a build-menu hint');
  ev('t-h3', [{ kind: 'hint', target: 'alloys', text: 'Alloys' }]);
  fire(g, 't-h3');
  g.sim.command({ type: 'ui', what: 'build' });
  check(!!g.st().hint, 'a hint on a read-only part of the HUD stays until an unhint');
}

// ---------- map encounters ----------
{
  const T = C.regions.touchdown;
  const was = T.encounters;
  T.encounters = [
    { id: 'ridge-guards', unit: 'brute', count: 2, x: 70, z: -60, mode: 'guard', r: 12, doneFlag: 'ridge-clear' },
    { id: 'patrol', unit: 'swarmer', count: 3, x: -60, z: 60, mode: 'patrol', r: 10, x2: -20, z2: 60 },
    { id: 'late', unit: 'swarmer', count: 4, x: 80, z: 80, mode: 'attack', flag: 'call-them' },
  ];
  const g = game();
  steps(g.sim, 12);
  const enc = (id) => g.sim.s.hostiles.filter((h) => h.enc === id);
  check(enc('ridge-guards').length === 2 && enc('patrol').length === 3 && !enc('late').length, 'encounters there from the start appear; a flagged one waits');
  const p0 = enc('patrol').map((h) => h.x);
  steps(g.sim, 150);
  check(enc('patrol').some((h, i) => Math.abs(h.x - p0[i]) > 8), 'the patrol walks its route');
  check(enc('ridge-guards').every((h) => Math.hypot(h.x - 70, h.z + 60) < 14), 'guards hold their spot');
  g.sim.command({ type: 'inspect', flag: 'call-them' });
  steps(g.sim, 12);
  check(enc('late').length === 4 && g.log.some((t) => t.includes('sighted')), 'the flagged encounter appears when its flag is set, and is announced');
  for (const h of enc('ridge-guards')) h.hp = -1;
  // let the sim notice them dead (units / turrets kill through killHostile; do the same here)
  for (const h of [...enc('ridge-guards')]) g.sim['killHostile'](h);
  check(g.st().flags.includes('ridge-clear'), 'beating an encounter sets its flag');
  const saved = structuredClone(g.sim.s);
  const g2 = game();
  g2.sim.load(saved);
  steps(g2.sim, 12);
  check(g2.sim.s.hostiles.filter((h) => h.enc === 'ridge-guards').length === 0, 'a beaten encounter doesn\'t come back after a load');
  T.encounters = was;
  if (was === undefined) delete T.encounters;
}

// ---------- save round trip ----------
{
  const g = game();
  ev('t-save', [{ kind: 'counter', counter: 'c', amount: 1 }, { kind: 'lock', building: 'radar' }, { kind: 'countdown', timer: 'z', amount: 100 }, { kind: 'waypoint', site: 'east-stone' }]);
  fire(g, 't-save');
  const saved = structuredClone(g.sim.s);
  const g2 = game();
  g2.sim.load(saved);
  const s2 = g2.snap().story;
  check(s2.counters.c === 1 && s2.locked.includes('radar') && s2.countdowns.length === 1 && s2.marks.length === 1, 'counters, locks, countdowns and waypoints survive a save');
}

Object.assign(C.story, keep.story);
Object.assign(C.missions, keep.missions);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
