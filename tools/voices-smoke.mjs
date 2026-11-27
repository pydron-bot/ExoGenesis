/**
 * Colonists as people (headless, the real sim): a one-line backstory each, short remarks on events (throttled), a
 * hero who holds a building under attack, mourning when someone they loved dies (and the memorial says who mourned).
 * Then the colonist card and the Colony panel's voices in the browser.
 *   node tools/voices-smoke.mjs [--headless-only] [--url http://localhost:5176/]
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content, SOL = C.colony.solSeconds;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

function game(n = 6) {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.command({ type: 'debug', setup: { peaceful: true, alloys: 3000, buildings: ['solar', 'solar', 'solar', 'geothermal', 'civic', 'civic', 'hydroponics', 'hydroponics'] } });
  steps(sim, 10);
  if (n) sim.command({ type: 'debug', people: { colonists: n } });
  steps(sim, 20);
  return { sim, log, P: sim.s.people };
}
const remarks = (log) => log.filter((t) => /^[^:]+: “.+”$/.test(t));

// ---------- content ----------
const V = Object.values(C.voices);
const kinds = new Set(V.map((v) => v.on));
check(kinds.size >= 15, `voices for ${kinds.size} kinds of moment (${V.reduce((m, v) => m + v.lines.length, 0)} lines)`);

// ---------- backstories ----------
{
  const g = game();
  const cs = g.P.colonists;
  check(cs.every((c) => c.bio && /line, donor stock from .+\. \S/.test(c.bio)), `every colonist has a backstory ("${cs[0].bio}")`);
  check(new Set(cs.map((c) => c.bio)).size >= cs.length - 1, 'and they differ');
  const copy = structuredClone(g.sim.s);
  for (const c of copy.people.colonists) delete c.bio;
  const s2 = new M.Sim(() => {});
  s2.load(copy);
  check(s2.s.people.colonists.every((c, i) => c.bio === cs[i].bio), 'an older save gets the same backstories back');
  check(g.sim.snapshot().people.roster.every((r) => r.bio), 'the roster carries them');
}

// ---------- remarks, throttled ----------
{
  const g = game();
  g.P.said = {}; // (newcomers just said their first words)
  const before = remarks(g.log).length;
  g.sim.people.say('packBeaten');
  const r1 = remarks(g.log).slice(before);
  check(r1.length === 1 && g.P.colonists.some((c) => r1[0].startsWith(c.name)), `a named colonist remarks on a pack beaten ("${r1[0]}")`);
  for (const e of ['packBeaten', 'lost', 'brownout', 'idle']) g.sim.people.say(e);
  check(remarks(g.log).length === before + 1, 'no second remark within the gap');
  steps(g.sim, 50 * 10);
  g.sim.people.say('packBeaten');
  check(remarks(g.log).length === before + 1, 'the same kind of moment waits longer');
  g.sim.people.say('brownout');
  check(remarks(g.log).length === before + 2, 'another kind can come after the gap');
  const snap = g.sim.snapshot().people;
  check(snap.voices.length >= 2 && snap.roster.some((r) => r.said), 'the Colony panel and the speaker\'s card carry what was said');
  // a long quiet run: remarks stay rare
  const g2 = game();
  const n0 = remarks(g2.log).length;
  steps(g2.sim, SOL * 10);
  const per = remarks(g2.log).length - n0;
  check(per <= 8, `a quiet sol: ${per} remarks (not spam)`);
}

// ---------- mourning ----------
{
  const g = game(4);
  const [a, b] = g.P.colonists;
  a.partner = b.id; b.partner = a.id;
  g.sim.people.kill(a, 'killed by predators');
  check(b.sorrow === 30, `${b.name} mourns ${a.name} (sorrow 30)`);
  check(g.log.some((t) => t.startsWith(b.name + ': “')), `and says so ("${g.log.find((t) => t.startsWith(b.name + ': “'))}")`);
  const m = g.P.memorial.at(-1);
  check(m.by?.startsWith(b.name), `the memorial: ${m.name}, mourned by ${m.by}`);
  steps(g.sim, 20);
  const why = g.sim.snapshot().people.roster.find((r) => r.id === b.id).why;
  check(why.some(([k, v]) => k === 'Mourning' && v < -10), 'mourning weighs on their wellbeing');
  steps(g.sim, SOL * 10 * 2);
  check(!b.sorrow || b.sorrow < 3, 'and fades over a couple of sols');
}

// ---------- a hero ----------
function siege(withPeople) {
  const g = game(withPeople ? 4 : 0);
  const civ = g.sim.s.buildings.find((b) => b.kind === 'civic');
  if (withPeople) for (const c of g.P.colonists) { c.at = civ.id; c.home = civ.id; c.goal = civ.id; }
  g.sim.s.drones = [];
  g.sim.command({ type: 'debug', spawn: { unit: 'brute', x: civ.x + 4, z: civ.z, n: 2 } });
  let hero = null, t = 0;
  const hp = [];
  for (; t < 900; t++) {
    for (const h of g.sim.s.hostiles) if (h.unit === 'brute') { h.target = civ.id; h.chew = true; }
    if (withPeople) for (const c of g.P.colonists) if (c.at === civ.id || c.goal !== civ.id) { c.goal = civ.id; }
    g.sim.step();
    hero ??= g.P.colonists.find((c) => c.hero);
    hp.push(civ.hp);
    if (!g.sim.s.buildings.includes(civ)) break;
  }
  return { g, civ, hero, hp, t };
}
{
  const s0 = siege(false), s1 = siege(true);
  check(!!s1.hero && s1.g.log.some((t) => t === `${s1.hero.name} is holding the Civilian Center`), `below half, ${s1.hero?.name} decides to hold the Civilian Center`);
  check(s1.g.log.some((t) => t.startsWith(`${s1.hero?.name}: “`)), 'with a line of their own');
  const half = C.buildings.civic.hp * 0.5;
  // the size of each blow once the building is below half (the hero holds it for 25 s)
  const blows = (r) => { const i = r.hp.findIndex((h) => h < half); const out = []; for (let k = i + 1; k < Math.min(r.hp.length, i + 200); k++) if (r.hp[k] < r.hp[k - 1] - 0.01) out.push(r.hp[k - 1] - r.hp[k]); return out.sort((a, b) => a - b)[0] ?? 0; };
  const d0 = blows(s0), d1 = blows(s1);
  check(d0 > 0 && Math.abs(d1 / d0 - 0.5) < 0.01, `while they hold it, each blow does half the damage (${d1.toFixed(1)} vs ${d0.toFixed(1)})`);
  const card = s1.g.sim.snapshot().people.roster.find((r) => r.id === s1.hero?.id);
  check(!card || card.hero || card.deeds.length || /Holding/.test(card.doing), 'their card says so');
  // held: the deed is remembered
  const g = game(3);
  const civ = g.sim.s.buildings.find((b) => b.kind === 'civic');
  for (const c of g.P.colonists) { c.at = civ.id; }
  civ.hp = C.buildings.civic.hp * 0.4;
  g.sim.people.struck(civ);
  const h = g.P.colonists.find((c) => c.hero);
  steps(g.sim, 30 * 10);
  check(!!h && h.deeds?.[0]?.startsWith('Held the Civilian Center') && g.log.some((t) => /held the Civilian Center. The colony will remember it/.test(t)), `when it stands, the deed is theirs ("${h?.deeds?.[0]}")`);
  g.sim.people.struck(civ);
  check(g.P.colonists.filter((c) => c.hero).length === 0, 'one hero per building per fight');
}

if (!process.argv.includes('--headless-only')) {
  const { launch } = await import('./lib/harness.mjs');
  const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
  const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
  await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'civic', 'hydroponics'], alloys: 2000, peaceful: true } });
  await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'civic' && b.progress >= 1));
  await cmd({ type: 'debug', people: { colonists: 3 } });
  check(await until(() => __exo.sim.cur.people.roster.length >= 3), 'three colonists');
  // newcomers say their first words: the Colony panel lists what people have said
  check(await until(() => __exo.sim.cur.people.voices.length > 0), 'a newcomer says their first words');
  await page.evaluate(() => __exo.hud.people.toggle(true, 'overview'));
  check(await until(() => /VOICES/.test(document.querySelector('#colony')?.textContent ?? '') && document.querySelectorAll('#colony button.voice').length > 0), 'the Colony panel lists them under Voices');
  await page.evaluate(() => __exo.hud.people.toggle(false));
  const id = await page.evaluate(() => __exo.sim.cur.people.roster[0].id);
  await page.evaluate((id) => { __exo.ui.sel = { kind: 'colonist', id }; __exo.hud.selected(); }, id);
  check(await until(() => /donor stock from/.test(document.querySelector('#card .bio')?.textContent ?? '')), 'the colonist card shows their backstory');
  check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await browser.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
