/**
 * Inhabitants (headless, the real sim): Touchdown's Vell camp, first contact,
 * regard (encroaching, recovering), trust (pack warnings, shared sight),
 * driving them off, leaving at 0, and saves.
 *   node tools/inhabit-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: rules } = await runnerImport(path.join(root, 'src/sim/rules.ts'));
const { module: inh } = await runnerImport(path.join(root, 'src/sim/inhabitants.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const V = C.content.inhabitants.vell;
const SOL = C.content.colony.solSeconds;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

function game() {
  const log = [];
  const sim = new core.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.s.waves.next = 1e9; // no packs unless asked
  return { sim, log, camp: () => sim.s.camps[0] };
}
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };
/** Park the first drone beside the camp so it comes into sight. */
function meet(g) {
  const c = g.camp(), d = g.sim.s.drones[0];
  d.x = c.x + 12; d.z = c.z - 12; d.task = { kind: 'idle' }; d.manual = true;
  steps(g.sim, 10);
}
const building = (sim, kind, x, z) => sim.s.buildings.push({ id: sim.s.nextId++, kind, x, z, progress: 1, hp: C.content.buildings[kind].hp, on: true, powered: true });

// ---------- the camp ----------
const a = game();
const c0 = a.camp();
check(a.sim.s.camps.length === 1 && c0.group === 'vell', 'Touchdown has one Vell camp');
check(c0.natives.length === V.walkers + 1 && c0.natives.filter((p) => p.elder).length === 1, `${V.walkers} walkers and a song-keeper live there`);
check(c0.regard === V.regard && !c0.met && !c0.pending, `regard starts at ${V.regard}, not met yet`);
const before = c0.natives.map((p) => [p.x, p.z]);
steps(a.sim, 600);
const moved = c0.natives.filter((p, i) => Math.hypot(p.x - before[i][0], p.z - before[i][1]) > 1).length;
check(moved >= 3, `they walk about the camp (${moved} of ${c0.natives.length} moved in a minute)`);
const far = Math.max(...c0.natives.map((p) => Math.hypot(p.x - c0.x, p.z - c0.z)));
check(far <= V.roam + 1, `and stay near it (furthest ${far.toFixed(1)} u, roam ${V.roam})`);
check(!a.camp().met, 'no contact while the camp is out of sight');
check(a.sim.snapshot().natives.length === 0, 'people in the fog are not in the snapshot');

// placement: not on the camp itself
const pw = (camps) => ({ buildings: [{ kind: 'solar', x: c0.x + 20, z: c0.z - 20, progress: 1 }], deposits: [], campSites: inh.campSites(camps) });
const why = rules.placeProblem(pw(a.sim.s.camps), C.content.buildings, C.content.colony, 'solar', c0.x + 4, c0.z - 4);
check(/camp/.test(why ?? ''), `can't build on the camp ("${why}")`);

// ---------- first contact ----------
meet(a);
check(a.camp().met && a.camp().pending, 'first contact when the camp comes into sight');
check(a.log.some((t) => t.includes(V.contactTitle)), `the log says "${V.contactTitle}"`);
check(a.sim.snapshot().natives.length > 0, 'people in sight are in the snapshot');
check(a.sim.snapshot().camps[0].pending, 'the snapshot carries the pending choice');
a.sim.command({ type: 'contact', camp: 0, choice: 'approach' });
check(!a.camp().pending && a.camp().choice === 'approach' && a.camp().regard === V.regard + V.approach, `approach: regard ${V.regard} → ${a.camp().regard}`);
a.sim.command({ type: 'contact', camp: 0, choice: 'drive' });
check(!a.camp().gone, 'the choice is made once');

// ---------- encroaching ----------
for (let i = 0; i < 3; i++) building(a.sim, 'solar', c0.x + 20 + i * 8, c0.z - 25);
const r0 = a.camp().regard;
steps(a.sim, SOL * 10 / 4); // a quarter sol
const lost = r0 - a.camp().regard;
const want = V.encroach * 3 / 4;
check(Math.abs(lost - want) < 1, `three buildings on their land: −${lost.toFixed(1)} in a quarter sol (expected ${want.toFixed(1)})`);
check(a.sim.snapshot().camps[0].encroaching === 3, 'the snapshot counts the buildings on their land');
a.sim.command({ type: 'debug', regard: { camp: 0, value: 26 } });
steps(a.sim, SOL * 10 / 8);
check(a.camp().regard < 25 && a.log.some((t) => t === V.uneasyText), 'below 25 they are uneasy (warned)');

// ---------- recovering, trust ----------
a.sim.s.buildings = a.sim.s.buildings.filter((b) => b.kind === 'core');
const r1 = a.camp().regard;
steps(a.sim, SOL * 10 / 4);
check(a.camp().regard > r1, `with their land clear, regard recovers (${r1.toFixed(1)} → ${a.camp().regard.toFixed(1)})`);
a.sim.command({ type: 'debug', regard: { camp: 0, value: V.trustAt - 0.01 } });
steps(a.sim, 20);
check(a.camp().trusted && a.log.some((t) => t.includes(V.trustTitle)), `at ${V.trustAt} they trust us ("${V.trustTitle}")`);
// shared sight: the drone goes home, their land stays in sight
const d = a.sim.s.drones[0]; d.x = 0; d.z = -14;
steps(a.sim, 10);
check(a.sim.visible(c0.x, c0.z) && a.sim.visible(c0.x + V.land * 0.7, c0.z), 'they share sight of their land');
// pack warning without radar
a.log.length = 0;
a.sim.s.waves.next = a.sim.s.tick + 1;
steps(a.sim, 2);
check(a.log.some((t) => /send word: a pack/.test(t)), 'they warn of an incoming pack (no radar)');
check(a.sim.s.packs.at(-1)?.announced, 'and the pack counts as seen');

// ---------- saves ----------
const saved = JSON.parse(JSON.stringify(a.sim.s));
const b = game();
b.sim.load(JSON.parse(JSON.stringify(saved)));
check(b.camp().trusted && b.camp().choice === 'approach' && b.camp().natives.length === c0.natives.length, 'a save keeps the camp, its regard and its people');
const old = JSON.parse(JSON.stringify(saved));
delete old.camps;
b.sim.load(old);
check(b.camp()?.group === 'vell' && !b.camp().met, 'a save from before inhabitants gets the region\'s camp');

// ---------- driving them off ----------
const e = game();
meet(e);
e.sim.command({ type: 'contact', camp: 0, choice: 'drive' });
check(e.camp().gone && e.log.some((t) => t === V.driveText), 'drive them off: they leave');
steps(e.sim, 1200);
check(e.camp().natives.length === 0, 'and walk out of the region');
check(rules.placeProblem(pw(e.sim.s.camps), C.content.buildings, C.content.colony, 'solar', c0.x + 4, c0.z - 4) === null || !/camp/.test(rules.placeProblem(pw(e.sim.s.camps), C.content.buildings, C.content.colony, 'solar', c0.x + 4, c0.z - 4)), 'an empty camp no longer blocks building');

// ---------- keeping away, and regard hitting 0 ----------
const k = game();
meet(k);
k.sim.command({ type: 'contact', camp: 0, choice: 'avoid' });
check(k.camp().regard === V.regard && !k.camp().gone, 'keep away: regard unchanged');
k.sim.command({ type: 'debug', regard: { camp: 0, value: V.regard - 5 } });
steps(k.sim, SOL * 10);
check(Math.abs(k.camp().regard - V.regard) < 0.01, `kept away, it only recovers to ${V.regard} (now ${k.camp().regard.toFixed(1)})`);
check(!k.camp().trusted, 'and they never come to trust us');
building(k.sim, 'solar', c0.x + 20, c0.z - 25);
k.sim.command({ type: 'debug', regard: { camp: 0, value: 0.5 } });
steps(k.sim, SOL * 10 / 2);
check(k.camp().gone && k.log.some((t) => t === V.leaveText), 'at 0 they abandon the camp');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
