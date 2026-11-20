/**
 * The research tree: headless (the real sim) checks the tree's shape, every kind of gate (earlier research, a
 * building, a specialist, a discovery) and that projects change the sim; then the browser opens the tree from the
 * Tech Lab at phone size and starts a project from it.
 *   node tools/tree-smoke.mjs [--headless-only] [--url http://localhost:5186/]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const { module: mods } = await runnerImport(path.join(root, 'src/sim/mods.ts'));
const { module: D } = await runnerImport(path.join(root, 'src/content/defs.ts'));
const C = M.content;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

// ---------- the tree ----------
const ids = Object.keys(C.research);
check(ids.length >= 28, `${ids.length} research projects (DESIGN §5.9 plans 25–35)`);
const by = Object.fromEntries(D.RESEARCH_BRANCHES.map((b) => [b, ids.filter((id) => (C.research[id].branch ?? 'economy') === b).length]));
check(D.RESEARCH_BRANCHES.every((b) => by[b] >= 5), `four branches, at least five each (${JSON.stringify(by)})`);
const dead = ids.filter((id) => !(C.research[id].effects?.length) && ![...Object.values(C.buildings), ...Object.values(C.units)].some((x) => x.research === id) && id !== 'relic-studies');
check(!dead.length, `every project does something: unlocks a building or unit, or has effects${dead.length ? ` (dead: ${dead})` : ''}`);
const gates = { building: 0, specialist: 0, flag: 0, requires: 0 };
for (const r of Object.values(C.research)) for (const k of Object.keys(gates)) if (r[k]) gates[k]++;
check(Object.values(gates).every((n) => n >= 3), `gated by research, buildings, specialists and discoveries (${JSON.stringify(gates)})`);
const used = new Set(Object.values(C.research).flatMap((r) => (r.effects ?? []).map((e) => e.stat)));
check([...used].every((s) => !mods.modText(s, 1).startsWith(s)), `every effect has words for the tree (${used.size} kinds)`);

// ---------- gates ----------
function game(setup) {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.command({ type: 'debug', setup: { peaceful: true, alloys: 5000, isotopes: 500, ...setup } });
  steps(sim, 20);
  return { sim, log };
}
const g = game({ buildings: ['solar', 'solar', 'solar', 'solar', 'lab'] });
const start = (id) => { g.sim.command({ type: 'research', id }); return g.sim.s.research.active?.id === id; };
check(!start('hardened-plating') && g.log.some((t) => /Hardened Plating needs a finished Defense Turret/.test(t)), 'Hardened Plating waits for a Defense Turret');
g.sim.command({ type: 'debug', setup: { buildings: ['turret'] } });
steps(g.sim, 5);
check(start('hardened-plating'), 'with a turret standing it starts');
g.sim.command({ type: 'unresearch' });
g.sim.command({ type: 'debug', setup: { research: ['hardened-plating'] } });
check(!start('fire-control') && g.log.some((t) => /Fire Control needs a Security officer/.test(t)), 'Fire Control waits for a Security officer');
g.sim.command({ type: 'debug', setup: { buildings: ['civic'] } });
steps(g.sim, 5);
g.sim.command({ type: 'debug', people: { colonists: 5 } }); // one of each specialty
steps(g.sim, 20);
check(start('fire-control'), 'with a Security officer in the colony it starts');
g.sim.command({ type: 'unresearch' });
check(!start('hull-forensics') && g.log.some((t) => /Sight a wreck/.test(t)), 'Hull Forensics waits for a wreck to be sighted');
g.sim.story.s.flags.push('wreck-found');
check(start('hull-forensics'), 'once a wreck is found it starts');
g.sim.command({ type: 'unresearch' });
check(!start('firmware-archaeology'), 'Firmware Archaeology waits on two earlier projects');

// research runs and finishes, with its flag; research speed counts
const a0 = g.sim.s.alloys;
check(start('tracking-arrays') && g.sim.s.alloys === a0 - C.research['tracking-arrays'].cost, 'Tracking Arrays starts (paid up front)');
let t = 0;
while (g.sim.s.research.active && t < 2000) { g.sim.step(); t++; }
check(g.sim.s.research.done.includes('tracking-arrays') && g.sim.story.has('research-tracking-arrays'), `Tracking Arrays done in ${(t / 10).toFixed(1)} s, flag set`);
g.sim.command({ type: 'debug', setup: { research: ['stratigraphy', 'firmware-archaeology'] } });
check(Math.abs(g.sim.mod('researchSpeed') - 0.25) < 1e-9, 'Stratigraphy + Firmware Archaeology: research +25%');

// ---------- effects in the sim ----------
function measure(research, fn, secs = 10) {
  const h = game({ buildings: ['solar', 'solar', 'solar', 'solar', 'geothermal', 'depot', 'battery'], research });
  return fn(h.sim, secs);
}
const mined = (sim, secs) => { const m0 = sim.s.stats.mined; steps(sim, secs * 10); return sim.s.stats.mined - m0; };
const m0 = measure([], mined), m1 = measure(['refined-drills'], mined);
check(m0 > 0 && Math.abs(m1 / m0 - 1.2) < 0.02, `Refined Drills: depot mining ×${(m1 / m0).toFixed(3)} (expected 1.2)`);
const cap = (sim) => { steps(sim, 2); return sim.power.storageMax; };
const c0 = measure([], cap), c1 = measure(['deep-cells'], cap);
check(Math.abs(c1 / c0 - 1.5) < 0.01, `Deep-Cycle Cells: battery ${c0} → ${c1} MJ`);
const drones = measure(['swarm-logic'], (sim) => sim.maxDrones());
check(drones === C.colony.maxDrones + 2, `Swarm Logic: ${drones} drones allowed (was ${C.colony.maxDrones})`);
const units = measure(['logistics-grid'], (sim) => sim.unitCap());
check(units === C.colony.maxUnits + 4, `Logistics Grid: ${units} combat units allowed`);
// a blow on a building: armour
function blow(research) {
  const h = game({ buildings: ['solar'], research });
  const b = h.sim.s.buildings.find((x) => x.kind === 'solar');
  h.sim.command({ type: 'debug', spawn: { unit: 'brute', x: b.x + 3, z: b.z, n: 1 } });
  const hp0 = b.hp;
  h.sim.s.drones = [];
  for (let i = 0; i < 600 && b.hp === hp0; i++) { for (const x of h.sim.s.hostiles) if (x.unit === 'brute') { x.target = b.id; x.chew = true; } h.sim.step(); }
  return hp0 - b.hp;
}
const b0 = blow([]), b1 = blow(['hardened-plating']), b2 = blow(['hardened-plating', 'handshake-codes', 'precursor-alloys']);
check(b0 > 0 && Math.abs(b1 / b0 - 0.85) < 0.01 && Math.abs(b2 / b0 - 0.75) < 0.01, `armour: a Brute's blow ${b0} → ${b1.toFixed(1)} (Hardened Plating) → ${b2.toFixed(1)} (+ Precursor Alloys)`);
// people: food eaten, wellbeing
const people = (research) => {
  const h = game({ buildings: ['solar', 'solar', 'civic', 'hydroponics'], research, colonists: 4 });
  steps(h.sim, 30);
  return { eaten: h.sim.people.snapshot().food.eaten, why: h.sim.people.snapshot().roster[0]?.why ?? [] };
};
const p0 = people([]), p1 = people(['nutrition', 'commons-design']);
check(Math.abs(p1.eaten / p0.eaten - 0.85) < 0.02, `Nutrition Science: food eaten ×${(p1.eaten / p0.eaten).toFixed(3)}`);
check(p1.why.some(([k, v]) => k === 'Colony projects' && v === 3), 'Commons Design: +3 wellbeing, shown as a reason');
// planet: scars
const scar = (research) => { const h = game({ buildings: ['solar', 'solar', 'solar', 'depot'], research }); steps(h.sim, 300); return h.sim.planet.snapshot().start - h.sim.planet.health(); };
const s0 = scar([]), s1 = scar(['low-scar']);
check(s0 > 0 && Math.abs(s1 / s0 - 0.6) < 0.05, `Low-Scar Extraction: mining scars ×${(s1 / s0).toFixed(2)}`);
// seismic listening: the pack is heard before it sets out
{
  const h = game({ buildings: ['solar', 'solar', 'solar', 'radar'], research: ['seismic-listening'] });
  h.sim.s.waves.next = h.sim.s.tick + 600;
  steps(h.sim, 200);
  check(h.log.some((t) => /Seismic listening: a pack is gathering/.test(t)), 'Seismic Listening: the radar hears the next pack gather');
}
// snapshot carries the totals
check(measure(['refined-drills', 'low-scar'], (sim) => sim.snapshot().mods.mining) === 0.2, 'the snapshot carries the modifiers');

// ---------- save / load ----------
{
  const h = game({ research: ['refined-drills'] });
  const copy = structuredClone(h.sim.s);
  const sim2 = new M.Sim(() => {});
  sim2.load(copy);
  check(sim2.mod('mining') === 0.2, 'modifiers come back with a save');
}

if (process.argv.includes('--headless-only')) { console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0); }

// ---------- the tree in the browser (phone size) ----------
const { chromium } = await import('playwright');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5186/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
await page.goto(`${url}?intro=0&new=1&sw=0`);
await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'solar', 'lab', 'depot'], alloys: 3000, peaceful: true } });
check(await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'lab')), 'a Tech Lab stands');
await page.evaluate(() => { __exo.ui.sel = { kind: 'building', id: __exo.sim.cur.buildings.find((b) => b.kind === 'lab').id }; __exo.hud.selected(); });
check(await until(() => /Research tree/.test(document.querySelector('#card')?.textContent ?? '')), 'the Tech Lab card offers the research tree');
await page.locator('#card button[data-act="tree"]').dispatchEvent('pointerdown');
check(await until(() => document.querySelector('#research.on .node')), 'the tree opens');
const layout = await page.evaluate(() => {
  const r = document.querySelector('#research').getBoundingClientRect();
  return { w: r.width, left: r.left, right: innerWidth - r.right, scroll: document.querySelector('#research').scrollWidth <= document.querySelector('#research').clientWidth + 1, nodes: document.querySelectorAll('#research .node').length, tabs: document.querySelectorAll('#research .tabs [data-tab]').length };
});
check(layout.w > 340 && layout.left < 12 && layout.right < 12 && layout.scroll, `it fills a phone's width with no sideways scroll (${Math.round(layout.w)} px)`);
check(layout.tabs === 4 && layout.nodes >= 5, `four branch tabs, ${layout.nodes} projects in this one`);
const locked = await page.evaluate(() => document.querySelector('#research .node.locked .need .no')?.textContent ?? '');
check(/✗/.test(locked), `a locked project says what it waits on ("${locked.trim()}")`);
await page.locator('#research button[data-r="refined-drills"]').dispatchEvent('pointerdown');
check(await until(() => __exo.sim.cur.research.active?.id === 'refined-drills'), 'Research on a node starts it');
check(await until(() => document.querySelector('#research .node.now') !== null), 'the node shows it under way');
await page.locator('#research [data-tab="relic"]').dispatchEvent('pointerdown');
check(await until(() => /Hull Forensics/.test(document.querySelector('#research').textContent)), 'the Precursor tab lists the relic projects');
await page.screenshot({ path: path.join((await import('node:os')).tmpdir(), 'tree-phone.png') }).catch(() => {});
await page.locator('#research [data-close]').dispatchEvent('pointerdown');
check(await until(() => !document.querySelector('#research.on')), 'and it closes');
check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
