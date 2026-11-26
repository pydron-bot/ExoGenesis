/**
 * Domination: how the map's fights compare with the same battles fought in full (DESIGN §5.12 phase 5). Plays a grid of
 * matchups headless as battles (computers on both sides, src/sim/dom-battle.ts), then the map's fight for the same
 * numbers (src/sim/domination.ts), and prints both: who won, what was left, how long it took.
 *   node tools/domination-calibrate.mjs [--fresh]   (full battles are cached in tools/.cache/dom-calibrate.json)
 *   --check: exit 1 unless the map picks the same winner as the battle every time and what's left is within
 *            20% of the attacker's starting strength (or 12, for small fights).
 */
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const D = M.domination, B = M.domBattle;
const map = D.domMap(M.content.bodies);
const cacheFile = path.join(root, 'tools/.cache/dom-calibrate.json');
const cache = !process.argv.includes('--fresh') && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

/** [attacker, holder's army, holder's guns, area] */
export const GRID = [
  [150, 30, 20, 'verdance-2'], [100, 50, 20, 'verdance-2'], [80, 60, 0, 'rime-2'], [60, 40, 40, 'home-3'],
  [200, 80, 60, 'dunmore-2'], [120, 100, 30, 'rime-3'], [50, 20, 0, 'ash-2'], [40, 60, 40, 'home-1'],
  [90, 40, 50, 'verdance-4'], [70, 70, 10, 'dunmore-3'],
];

function warFor([att, army, guns, area]) {
  const s = D.newDomination(map, { seed: 21, players: 2, ai: 'normal' });
  s.players[1].ai = undefined;
  s.players[0].ai = undefined;
  Object.assign(s.areas[area], { owner: 1, army, guns, natives: 0, level: 1, queue: [], visitors: { 0: att } });
  // the attacker holds somewhere else too (taking Touchdown from it would put it out of the war at once)
  if (area === 'home-1') Object.assign(s.areas['talus-1'], { owner: 0, natives: 0 });
  return s;
}

function fullBattle(row) {
  const s = warFor(row), b = B.makeBattle(s, row[3]);
  const a = map.byId[row[3]];
  const m2 = M.generateSkirmishMap({ seed: b.seed, players: 2, size: a.size, world: a.body, water: 'some', relief: 'rolling', site: a }, M.content.bodies);
  M.useRegion('skirmish', m2.region);
  const sim = new M.Sim(() => {}, b.seed);
  sim.newSkirmish({ seed: b.seed, alloys: 0, homes: m2.homes, wildlife: false, fog: false, players: b.sides.map((x, i) => ({ name: x.name, color: x.color, side: i, ai: 'normal' })), battle: b.sides.map((x) => ({ core: x.core, turrets: x.turrets, units: x.units })) });
  const st = sim.s;
  let i = 0;
  for (; i < 20 * 600 && !st.over && st.players.filter((p) => !p.out).length > 1; i++) sim.step();
  const r = B.battleOutcome(st, b, true);
  return { attLeft: r.sides[0].army, holdLeft: r.sides[1].core ? r.sides[1].army + r.sides[1].guns : 0, won: r.sides[1].core ? 'holder' : 'attacker', secs: Math.round(i / 10) };
}

function mapFight(row) {
  const s = warFor(row), a = s.areas[row[3]];
  let t = 0;
  while (t < 1200 && (a.visitors[0] ?? 0) > 0 && a.owner === 1) { D.stepDomination(map, s, 1); t++; }
  const won = a.owner === 0 ? 'attacker' : 'holder';
  return { attLeft: won === 'attacker' ? a.army : a.visitors[0] ?? 0, holdLeft: won === 'holder' ? a.army + a.guns : 0, won, secs: t };
}

let bad = 0;
console.log('attacker vs army+guns       full battle                 map fight');
for (const row of GRID) {
  const key = row.join(',');
  cache[key] ??= fullBattle(row);
  const f = cache[key], m = mapFight(row);
  const left = (x) => (x.won === 'attacker' ? `att ${Math.round(x.attLeft)}` : `hold ${Math.round(x.holdLeft)}`).padEnd(9);
  const diff = Math.abs((f.won === 'attacker' ? f.attLeft : -f.holdLeft) - (m.won === 'attacker' ? m.attLeft : -m.holdLeft)) / row[0];
  // (small fights are noisy in full: a dozen strength either way is fine)
  const ok = f.won === m.won && diff * row[0] <= Math.max(0.2 * row[0], 12);
  if (!ok) bad++;
  console.log(`${String(row[0]).padStart(4)} vs ${String(row[1]).padStart(3)}+${String(row[2]).padEnd(3)} ${row[3].padEnd(11)} ${f.won.padEnd(9)} ${left(f)} ${String(f.secs).padStart(4)} s   ${m.won.padEnd(9)} ${left(m)} ${String(m.secs).padStart(4)} s  ${ok ? '' : `✗ (${Math.round(diff * 100)}%)`}`);
}
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
console.log(bad ? `\n${bad} matchup(s) off` : '\nthe map agrees with the battles');
if (process.argv.includes('--check')) process.exit(bad ? 1 : 0);
