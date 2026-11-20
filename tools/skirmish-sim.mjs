/**
 * Skirmish sim, headless (DESIGN §5.11 phase 1): players with their own bases and economies on one map, fighting
 * until one side is left. Checks economies stay apart, commands only touch their own player's things, drones build
 * and depots mine per player, units and turrets fight across players, a fallen Core takes its player out, and the
 * last one standing wins; plus a save/load round trip and a four-player free-for-all.
 *   node tools/skirmish-sim.mjs [--seed 7]
 */
import path from 'node:path';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { module: C } = await runnerImport(path.join(root, 'src/content/index.ts'));
const { content } = C;
const seed = Number(process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : 7);

planet.setRegionTerrain(planet.regionTerrain(content.regions.touchdown, content.bodies));
core.useRegion('touchdown');

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const team = (o) => o.team ?? 0;
const events = [];

/** Deposits: two by each home, toward the middle. */
function setup(n, extra = {}) {
  const homes = core.skirmishHomes(n, 114);
  const deposits = homes.flatMap((h) => {
    const a = Math.atan2(-h.x, -h.z);
    return [-0.6, 0.6].map((o) => ({ x: h.x + Math.sin(a + o) * 26, z: h.z + Math.cos(a + o) * 26, alloys: 3000, max: 3000 }));
  });
  const names = ['You', 'Crimson', 'Amber', 'Violet'], colors = ['#4fd1e8', '#e8574f', '#e8b04f', '#a46be8'];
  const sim = new core.Sim((text, level) => events.push({ t: sim?.s?.tick ?? 0, text, level }), seed);
  sim.newSkirmish({ seed, alloys: 1200, homes, deposits, players: names.slice(0, n).map((name, i) => ({ name, color: colors[i], ai: i ? 'normal' : undefined })), ...extra });
  return sim;
}
const alloysOf = (sim, t) => (t ? sim.s.players[t].econ.alloys : sim.s.alloys);
const run = (sim, secs, until) => { for (let i = 0; i < secs * 10 && !(until && until()); i++) sim.step(); };
/** First spot near (x, z) the player may build `kind` on. */
function spot(sim, t, kind, x, z) {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.4) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const n = sim.s.buildings.length;
    sim.command({ type: 'build', kind, x: px, z: pz }, t);
    if (sim.s.buildings.length > n) return sim.s.buildings[sim.s.buildings.length - 1];
  }
  return null;
}

// ---------- 1. setup ----------
let sim = setup(2);
let s = sim.s;
check(s.players.length === 2 && s.buildings.filter((b) => b.kind === 'core').length === 2, 'two players, two Command Cores');
check(s.buildings.some((b) => b.kind === 'core' && team(b) === 1) && s.drones.filter((d) => team(d) === 1).length === 1, "player 1's Core and drone are its own");
const [h0, h1] = s.players.map((p) => p.home);
check(Math.hypot(h0.x - h1.x, h0.z - h1.z) > 120, `homes far apart (${Math.round(Math.hypot(h0.x - h1.x, h0.z - h1.z))} u)`);
check(alloysOf(sim, 0) === 1200 && alloysOf(sim, 1) === 1200, 'each starts with 1200 alloys');

// ---------- 2. economies and commands stay apart ----------
const solar1 = spot(sim, 1, 'solar', h1.x + 14, h1.z);
check(!!solar1 && team(solar1) === 1, 'player 1 places a Solar Array, and it is theirs');
check(alloysOf(sim, 1) === 1200 - content.buildings.solar.cost && alloysOf(sim, 0) === 1200, `only player 1 paid (${alloysOf(sim, 0)} / ${alloysOf(sim, 1)})`);
const n0 = s.buildings.length;
sim.command({ type: 'build', kind: 'solar', x: h1.x - 14, z: h1.z }, 0);
check(s.buildings.length === n0, "player 0 can't build in player 1's base (outside its build area)");
const solar0 = spot(sim, 0, 'solar', h0.x + 14, h0.z);
check(!!solar0 && team(solar0) === 0, 'player 0 places its own');
run(sim, 90, () => solar0.progress >= 1 && solar1.progress >= 1);
check(solar0.progress >= 1 && solar1.progress >= 1, "each player's drone builds its own (" + `${solar0.progress.toFixed(2)} / ${solar1.progress.toFixed(2)})`);
check(events.filter((e) => /Solar Array online/.test(e.text)).length === 1, 'player 0 hears only of its own Solar Array');
const d0 = s.drones.find((d) => team(d) === 0), d1 = s.drones.find((d) => team(d) === 1);
const d1at = { x: d1.x, z: d1.z };
sim.command({ type: 'move', drone: d1.id, x: 0, z: 0 }, 0);
run(sim, 2);
check(Math.hypot(d1.x - d1at.x, d1.z - d1at.z) < 1 && d0.task.kind === 'move', "a move order from player 0 only moves player 0's drone");

// depots mine for their owner
const dep = (h) => s.deposits.reduce((b, d) => (Math.hypot(d.x - h.x, d.z - h.z) < Math.hypot(b.x - h.x, b.z - h.z) ? d : b));
const solarB = [spot(sim, 0, 'solar', h0.x - 14, h0.z), spot(sim, 1, 'solar', h1.x - 14, h1.z)];
const depots = [0, 1].map((t) => { const h = s.players[t].home, d = dep(h); return spot(sim, t, 'depot', (h.x + d.x) / 2, (h.z + d.z) / 2); });
check(depots.every((d, t) => d && team(d) === t), 'each player places a depot by its deposits');
run(sim, 120, () => depots.every((d) => d.progress >= 1) && solarB.every((b) => b?.progress >= 1));
const a0 = alloysOf(sim, 0), a1 = alloysOf(sim, 1), m0 = s.stats.mined, m1 = s.players[1].econ.stats.mined;
run(sim, 60);
check(alloysOf(sim, 0) > a0 + 20 && alloysOf(sim, 1) > a1 + 20, `both mine into their own store (+${Math.round(alloysOf(sim, 0) - a0)} / +${Math.round(alloysOf(sim, 1) - a1)})`);
check(s.stats.mined > m0 && s.players[1].econ.stats.mined > m1, 'mined stats are kept per player');

// ---------- 3. a battle ----------
const turret1 = spot(sim, 1, 'turret', h1.x + Math.sign(-h1.x) * 16, h1.z + Math.sign(-h1.z) * 16);
check(!!turret1 && team(turret1) === 1, 'player 1 builds a Defense Turret');
run(sim, 90, () => turret1.progress >= 1);
sim.command({ type: 'debug', units: { unit: 'rover', x: h1.x + Math.sign(-h1.x) * 24, z: h1.z + Math.sign(-h1.z) * 24, n: 4 } }, 1);
sim.command({ type: 'debug', units: { unit: 'tank', x: h0.x + Math.sign(-h0.x) * 24, z: h0.z + Math.sign(-h0.z) * 24, n: 16 } }, 0);
const army0 = s.units.filter((u) => team(u) === 0).map((u) => u.id), army1 = s.units.filter((u) => team(u) === 1).map((u) => u.id);
check(army0.length === 16 && army1.length === 4, `armies are their players' (${army0.length} / ${army1.length})`);
sim.command({ type: 'order', ids: army1, x: h0.x, z: h0.z }, 0);
check(s.units.filter((u) => army1.includes(u.id)).every((u) => u.order.kind === 'idle'), "player 0 can't order player 1's units");
const core1 = s.buildings.find((b) => b.kind === 'core' && team(b) === 1);
sim.command({ type: 'order', ids: army0, x: core1.x, z: core1.z }, 0);
const t0 = s.tick;
let shotAt = false;
run(sim, 400, () => { if (turret1.engaged) shotAt = true; return !!s.over; });
const secs = ((s.tick - t0) / 10).toFixed(0);
check(shotAt, "player 1's turret fired on player 0's tanks");
check(s.players[1].econ.stats.unitsLost > 0 || !s.units.some((u) => army1.includes(u.id)), `player 1's rovers were fought (${s.players[1].econ.stats.unitsLost ?? 0} lost)`);
check(s.players[1].out === true, `player 1's Core fell (after ${secs} s)`);
check(!s.buildings.some((b) => team(b) === 1) && !s.units.some((u) => team(u) === 1) && !s.drones.some((d) => team(d) === 1), 'everything of player 1 is gone with it');
check(s.over === 'won' && /Victory/.test(s.overText ?? ''), `player 0 wins (${s.over}: ${s.overText})`);
check(events.some((e) => /Crimson has been defeated/.test(e.text)), 'player 0 hears of the defeat');
check(!events.some((e) => /Defense Turret online/.test(e.text)), "player 1's own news (its turret coming online) stays quiet");

// ---------- 4. save / load ----------
sim = setup(2);
s = sim.s;
spot(sim, 1, 'solar', s.players[1].home.x + 14, s.players[1].home.z);
run(sim, 30);
const snapAlloys = [alloysOf(sim, 0), alloysOf(sim, 1)];
const saved = JSON.parse(JSON.stringify(s));
const sim2 = new core.Sim(() => {}, 1);
sim2.load(saved);
check(sim2.s.players?.length === 2 && alloysOf(sim2, 1) === snapAlloys[1] && sim2.s.buildings.filter((b) => team(b) === 1).length === 2, 'a skirmish save loads with its players, economies and owners');
run(sim2, 30);
check(sim2.s.buildings.some((b) => team(b) === 1 && b.kind === 'solar' && b.progress > 0.3), "player 1's drone carries on building after the load");

// ---------- 5. four-player free-for-all ----------
sim = setup(4);
s = sim.s;
check(s.players.length === 4 && new Set(s.players.map((p) => p.side)).size === 4, 'four players, each on their own side');
for (let t = 0; t < 4; t++) {
  const h = s.players[t].home;
  sim.command({ type: 'debug', units: { unit: t % 2 ? 'tank' : 'rover', x: h.x * 0.5, z: h.z * 0.5, n: 6 } }, t);
  sim.command({ type: 'order', ids: s.units.filter((u) => team(u) === t).map((u) => u.id), x: 0, z: 0 }, t);
}
run(sim, 120);
const lost = [0, 1, 2, 3].map((t) => (t ? s.players[t].econ.stats.unitsLost : s.stats.unitsLost) ?? 0);
check(lost.filter((n) => n > 0).length >= 3, `armies meeting in the middle fight each other (lost ${lost.join(' / ')})`);
// allies don't shoot each other
sim = setup(4, { players: ['You', 'Ally', 'Foe A', 'Foe B'].map((name, i) => ({ name, color: '#fff', side: i < 2 ? 0 : 1 })) });
s = sim.s;
for (const t of [0, 1]) sim.command({ type: 'debug', units: { unit: 'tank', x: 0, z: t * 6 - 3, n: 4 } }, t);
run(sim, 30);
check(s.units.length === 8 && s.units.every((u) => u.hp === content.units.tank.hp), 'allies side by side hold their fire');
check(!s.over, 'a game with two sides left goes on');

console.log(failed ? `\n${failed} failed` : '\nall skirmish sim checks passed');
process.exit(failed ? 1 : 0);
