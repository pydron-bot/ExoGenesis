/**
 * Unit match-ups, headless: every Accord ground combat unit against every other, the same alloys a side,
 * on a skirmish map (no fog, no wildlife), with abilities used the way the computer players use them;
 * then each against a small gun line (three Defense Turrets and a Siege Cannon). Prints a matrix of
 * who's left (the winner's remaining value: alloys × hp left, as a share of what it brought) and each
 * unit's record, so no unit should beat everything.
 *   node tools/unit-duel.mjs [--budget 700] [--no-abilities] [--seed 7] [--check]
 */
import path from 'node:path';
import { runnerImport } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const { module: core } = await runnerImport(path.join(root, 'src/sim/core.ts'));
const { module: planet } = await runnerImport(path.join(root, 'src/world/planet.ts'));
const { content } = (await runnerImport(path.join(root, 'src/content/index.ts'))).module;
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const budget = Number(arg('--budget', 700)), seed = Number(arg('--seed', 7));
const abilities = !process.argv.includes('--no-abilities');

planet.setRegionTerrain(planet.regionTerrain(content.regions.touchdown, content.bodies));
core.useRegion('touchdown');

const U = content.units;
const roster = Object.keys(U).filter((k) => U[k].faction === 'accord' && U[k].cost && U[k].damage > 0 && (U[k].move ?? 'ground') !== 'water' && U[k].move !== 'air' && !U[k].research).sort((a, b) => U[a].cost - U[b].cost);

function arena() {
  const homes = core.skirmishHomes(2, 114);
  const sim = new core.Sim(() => {}, seed);
  sim.newSkirmish({ seed, alloys: 0, homes, deposits: [], fog: false, players: [{ name: 'A', color: '#4fd1e8' }, { name: 'B', color: '#e8574f' }] });
  const [h0, h1] = homes;
  const dx = h1.x - h0.x, dz = h1.z - h0.z, k = 1 / Math.hypot(dx, dz);
  const at = (t) => ({ x: h0.x + dx * k * t, z: h0.z + dz * k * t });
  return { sim, a: at(45), b: at(85) };
}
const value = (sim, team) => sim.units.filter((u) => (u.team ?? 0) === team).reduce((m, u) => m + U[u.unit].cost * Math.max(0, u.hp) / U[u.unit].hp, 0);
/** Abilities the way the computer players fire them (a simpler copy of src/sim/ai.ts abilities()). */
function useAbilities(sim, team) {
  const ids = [];
  const mine = sim.units.filter((u) => (u.team ?? 0) === team);
  for (const u of mine) {
    const d = U[u.unit];
    if (!d.ability || (u.ab ?? 0) > 0) continue;
    const r = d.abilityRadius ?? 0;
    const foesNear = sim.units.filter((o) => (o.team ?? 0) !== team && Math.hypot(o.x - u.x, o.z - u.z) <= r).length + sim.s.buildings.filter((b) => (b.team ?? 0) !== team && Math.hypot(b.x - u.x, b.z - u.z) <= r).length;
    const go = d.ability === 'overdrive' || d.ability === 'charge' ? u.target >= 0
      : d.ability === 'siege' ? u.target >= 0
      : d.ability === 'pulse' ? foesNear >= 2
      : d.ability === 'shield' ? u.target >= 0
      : d.ability === 'mend' ? mine.some((o) => o !== u && o.hp < U[o.unit].hp * 0.6 && Math.hypot(o.x - u.x, o.z - u.z) <= r)
      : false;
    if (go) ids.push(u.id);
  }
  if (ids.length) sim.command({ type: 'ability', ids }, team);
}
function fight(sim, a, b, secs = 120) {
  for (let i = 0; i < secs * 10; i++) {
    if (i % 10 === 0) {
      for (const t of [0, 1]) {
        const mine = sim.units.filter((u) => (u.team ?? 0) === t && u.order.kind === 'idle' && u.target < 0);
        const to = t ? a : b;
        // sieged units wait; others advance on the enemy's side
        if (mine.length && i % 50 === 0) sim.command({ type: 'order', ids: mine.filter((u) => !(U[u.unit].ability === 'siege' && (u.abT ?? 0) > 0)).map((u) => u.id), x: to.x, z: to.z }, t);
        // in range of something: hold and shoot (a player would; idle units still chase what comes close)
        const engaged = sim.units.filter((u) => (u.team ?? 0) === t && u.order.kind === 'move' && u.target >= 0);
        if (engaged.length) sim.command({ type: 'stop', ids: engaged.map((u) => u.id) }, t);
        if (abilities) useAbilities(sim, t);
      }
    }
    sim.step();
    const va = sim.units.some((u) => (u.team ?? 0) === 0), vb = sim.units.some((u) => (u.team ?? 0) === 1) || sim.s.buildings.some((b) => b.team === 1 && b.kind !== 'core' && def(b).fireRange);
    if (!va || !vb) break;
  }
}
const def = (b) => content.buildings[b.kind];
function spawn(sim, team, unit, at) {
  const n = Math.max(1, Math.floor(budget / U[unit].cost));
  sim.command({ type: 'debug', units: { unit, x: at.x, z: at.z, n } }, team);
  return n * U[unit].cost;
}

// ---------- unit vs unit ----------
const res = {}; // res[a][b] = share left: + a won, − b won
for (const a of roster) {
  res[a] = {};
  for (const b of roster) {
    if (a === b) { res[a][b] = 0; continue; }
    const { sim, a: pa, b: pb } = arena();
    const ca = spawn(sim, 0, a, pa), cb = spawn(sim, 1, b, pb);
    fight(sim, pa, pb);
    res[a][b] = value(sim, 0) / ca - value(sim, 1) / cb;
  }
}
// ---------- unit vs a gun line ----------
const vsGuns = {};
for (const a of roster) {
  const { sim, a: pa, b: pb } = arena();
  const ca = spawn(sim, 0, a, pa);
  for (const [kind, ox, oz] of [['turret', -8, 0], ['turret', 0, 0], ['turret', 8, 0], ['cannon', 0, 10], ['geothermal', 0, 20]]) {
    const d = content.buildings[kind];
    sim.s.buildings.push({ id: sim.s.nextId++, kind, x: pb.x + ox, z: pb.z + oz, progress: 1, hp: d.hp, on: true, powered: true, team: 1 });
  }
  const guns = () => sim.s.buildings.filter((b) => b.team === 1 && b.kind !== 'core' && def(b).fireRange);
  const gv = () => guns().reduce((m, b) => m + def(b).cost * b.hp / def(b).hp, 0);
  const g0 = gv();
  fight(sim, pa, pb, 150);
  vsGuns[a] = { left: value(sim, 0) / ca, guns: gv() / g0, n: guns().length };
}

const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}`.padStart(5);
console.log(`unit duels · ${budget} alloys a side · abilities ${abilities ? 'on' : 'off'} · row vs column: + row won (share of its value left), − column won`);
console.log(`${''.padEnd(10)}${roster.map((b) => b.slice(0, 7).padStart(8)).join('')}   W-L`);
const record = {};
for (const a of roster) {
  const w = roster.filter((b) => b !== a && res[a][b] - res[b][a] > 0).length, l = roster.filter((b) => b !== a && res[a][b] - res[b][a] < 0).length;
  record[a] = { w, l };
  console.log(`${a.padEnd(10)}${roster.map((b) => (a === b ? '     ·' : pct((res[a][b] - res[b][a]) / 2)).padStart(8)).join('')}   ${w}-${l}`);
}
console.log(`\nvs 3 turrets + a siege cannon (${3 * content.buildings.turret.cost + content.buildings.cannon.cost} alloys):`);
for (const a of roster) console.log(`  ${a.padEnd(10)} ${vsGuns[a].n === 0 ? 'broke the line' : `${vsGuns[a].n} guns left (${Math.round(vsGuns[a].guns * 100)}% of their value)`} · ${Math.round(vsGuns[a].left * 100)}% of the army left`);
if (process.argv.includes('--check')) {
  const top = roster.filter((a) => record[a].l === 0);
  console.log(top.length ? `\nFAIL  ${top.join(', ')} beat every other unit` : '\nPASS  no unit beats every other');
  const breakers = roster.filter((a) => vsGuns[a].n === 0);
  console.log(breakers.length && breakers.length < roster.length ? `PASS  some units break the gun line (${breakers.join(', ')}), not all` : `FAIL  gun line broken by ${breakers.length} of ${roster.length}`);
  process.exit(top.length || !breakers.length || breakers.length === roster.length ? 1 : 0);
}
