/**
 * Colony dilemmas (headless, the real sim): story events marked `dilemma` fire from sim conditions (brownout, food,
 * strikes, injuries…), wait their turn (first-dilemma time, the gap, one card at a time), are about a named colonist
 * ({who}), and leave consequences: running boosts (colony modifiers), flags, follow-up events, a promised family line,
 * a policy, a rescue. Some come again.
 *   node tools/dilemma-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content;
const SOL = C.colony.solSeconds, FROM = C.colony.dilemmaFrom ?? 900, GAP = C.colony.dilemmaGap ?? 180;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const steps = (sim, n) => { for (let i = 0; i < n; i++) sim.step(); };

// ---------- the set ----------
const dil = Object.entries(C.story).filter(([, e]) => e.dilemma);
check(dil.length >= 12, `${dil.length} colony dilemmas`);
check(dil.every(([, e]) => (e.choices?.length ?? 0) >= 2 && (e.choices.length <= 3)), 'each offers 2–3 choices');
const lasting = (e) => (e.effects ?? []).some((x) => x.after > 0 && ['boost', 'flag', 'favourLine', 'rescue', 'policy', 'regard'].includes(x.kind));
check(dil.every(([, e]) => lasting(e)), 'each leaves something behind: a boost, a flag, a follow-up, a promise, a policy or regard');
const waits = new Set(Object.values(C.story).flatMap((e) => [e.flag, ...(e.of ?? []).map((x) => x.flag)]).filter(Boolean));
const followed = dil.filter(([, e]) => (e.effects ?? []).some((x) => x.kind === 'flag' && waits.has(x.flag)));
check(followed.length >= 5, `${followed.length} lead to follow-up events (${followed.map(([id]) => id).join(', ')})`);
const kinds = new Set(dil.map(([, e]) => e.trigger === 'all' ? e.of.map((x) => x.kind).join('+') : e.trigger));
check(kinds.size >= 10, `they fire from ${kinds.size} different conditions`);

// ---------- a colony to try them on ----------
function game() {
  const log = [];
  const sim = new M.Sim((t) => log.push(t));
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.command({ type: 'debug', setup: { peaceful: true, alloys: 3000, buildings: ['solar', 'solar', 'solar', 'solar', 'geothermal', 'civic', 'civic', 'hydroponics', 'hydroponics'] } });
  steps(sim, 20);
  sim.command({ type: 'debug', people: { colonists: 6 } });
  steps(sim, 20);
  return { sim, log };
}
/** Answer every card that isn't a dilemma (the tutorial's, first contact…), so dilemmas can come. */
const clear = (sim) => { for (const id of [...sim.s.story.inbox]) if (!C.story[id]?.dilemma) sim.command({ type: 'story', id, choice: 0 }); };
const dilemmasIn = (sim) => sim.s.story.inbox.filter((id) => C.story[id]?.dilemma);

const g = game();
const sim = g.sim;
// conditions for several at once: a brownout and a food shortage
sim.s.cryo = 80;
sim.s.people.biomass = 10;
for (let i = 0; i < 30; i++) { clear(sim); steps(sim, 10); }
check(!dilemmasIn(sim).length, `nothing before the first-dilemma time (${FROM} s)`);
sim.skip(FROM);
let first = null;
for (let i = 0; i < 40 && !first; i++) { clear(sim); sim.s.cryo = 80; sim.s.people.biomass = 10; steps(sim, 10); first = dilemmasIn(sim)[0] ?? null; }
check(!!first, `a dilemma fires once its time comes (${first})`);
for (let i = 0; i < 20; i++) { clear(sim); sim.s.cryo = 80; sim.s.people.biomass = 10; steps(sim, 10); }
check(dilemmasIn(sim).length === 1, 'only one at a time while it waits for an answer');
// answer: if it's the brownout, slow the mines; if lean months, cut rations
const pick = first === 'brownout' ? 1 : 0;
sim.command({ type: 'story', id: first, choice: pick });
const boost = sim.s.story.mods?.[0];
check(!!boost && sim.snapshot().story.boosts.length >= 1, `the choice leaves a boost running ("${boost?.text}": ${boost?.stat} ${boost?.amount})`);
for (let i = 0; i < (GAP - 20); i++) { clear(sim); sim.s.cryo = 80; sim.s.people.biomass = 10; steps(sim, 10); }
check(!dilemmasIn(sim).length, `no new dilemma within the gap (${GAP} s)`);
let second = null;
for (let i = 0; i < 60 && !second; i++) { clear(sim); sim.s.cryo = 80; sim.s.people.biomass = 10; steps(sim, 10); second = dilemmasIn(sim)[0] ?? null; }
check(!!second && second !== first, `after the gap the next one comes (${second})`);
sim.command({ type: 'story', id: second, choice: 0 });
steps(sim, 400 * 10);
check(!(sim.s.story.mods ?? []).some((b) => b.text === boost?.text) && g.log.some((t) => t === `${boost?.text}: over`), 'a timed boost runs out, and the log says so');

// ---------- brownout: the modifier and the follow-up ----------
{
  const h = game();
  h.sim.skip(FROM);
  h.sim.story.fire('brownout');
  h.sim.command({ type: 'story', id: 'brownout', choice: 1 });
  check(Math.abs(h.sim.mod('mining') + 0.4) < 1e-9, `Brownout → Slow the mines: depot mining ${h.sim.mod('mining') * 100}%`);
  h.sim.story.fire('brownout'); // (fired already: nothing)
  const h2 = game();
  h2.sim.story.fire('brownout');
  h2.sim.command({ type: 'story', id: 'brownout', choice: 2 });
  for (let i = 0; i < 80; i++) { clear(h2.sim); steps(h2.sim, 10); }
  check(h2.sim.s.story.fired.includes('the-vote'), 'Put it to the colony → The Vote follows a minute later');
}

// ---------- {who}, a promised line ----------
{
  const h = game();
  h.sim.story.fire('who-wakes');
  const who = h.sim.snapshot().story.who['who-wakes'];
  check(!!who && h.sim.s.people.colonists.some((c) => c.name === who.name), `Who Wakes Next is about ${who?.name} (${who?.line} line)`);
  const c = h.sim.s.people.colonists.find((x) => x.name === who.name);
  h.sim.command({ type: 'story', id: 'who-wakes', choice: 1 });
  check(h.sim.s.people.favour === c.lineage, 'Grant it: their line is promised the next pod');
  const civic = h.sim.s.buildings.find((b) => b.kind === 'civic');
  h.sim.command({ type: 'grow', id: civic.id, specialty: 'botanist', curriculum: 'charter' });
  check(h.sim.s.people.pods.at(-1)?.lineage === c.lineage && h.sim.s.people.favour === undefined, 'the next pod holds a child of that line, once');
  check(h.log.some((t) => t.includes(who.name)), 'the reply names them');
}

// ---------- the injured: a rescue ----------
{
  const h = game();
  const civic = h.sim.s.buildings.find((b) => b.kind === 'civic');
  for (const c of h.sim.s.people.colonists) { c.at = civic.id; c.home = civic.id; c.hp = 100; }
  h.sim.command({ type: 'debug', hurt: { id: civic.id, hp: 1e6 } });
  steps(h.sim, 2);
  const down = h.sim.people.injured();
  check(down.length > 0, `${down.length} lying injured after their home falls`);
  h.sim.story.fire('hurt-on-shift');
  const who = h.sim.s.story.cast['hurt-on-shift'];
  h.sim.command({ type: 'story', id: 'hurt-on-shift', choice: 1 });
  const c = h.sim.people.colonist(who.id);
  check(!!c && c.down === undefined && c.at >= 0, `Let them carry ${who.name} in: indoors, no longer dying`);
}

// ---------- a policy; coming again ----------
{
  const h = game();
  for (const c of h.sim.s.people.colonists) c.stance = 20;
  steps(h.sim, 20);
  h.sim.story.fire('down-tools');
  h.sim.command({ type: 'story', id: 'down-tools', choice: 0 });
  check(h.sim.s.people.policies.hours === 'short', 'Down Tools → Shorter hours sets the work-hours policy');
  h.sim.skip(FROM);
  h.sim.s.people.biomass = 5;
  for (let i = 0; i < 40 && !h.sim.s.story.fired.includes('lean-months'); i++) { clear(h.sim); h.sim.s.people.biomass = 5; for (const id of dilemmasIn(h.sim)) h.sim.command({ type: 'story', id, choice: 0 }); steps(h.sim, 10); }
  check(h.sim.s.story.fired.includes('lean-months'), 'Lean Months fires when the stores run low');
  if (h.sim.s.story.inbox.includes('lean-months')) h.sim.command({ type: 'story', id: 'lean-months', choice: 0 });
  const again = C.story['lean-months'].again;
  steps(h.sim, (again + 5) * 10);
  check(!h.sim.s.story.fired.includes('lean-months') || h.sim.s.story.inbox.includes('lean-months'), `and can come again ${again} s later`);
}

// ---------- saves ----------
{
  const h = game();
  h.sim.story.fire('the-watchers');
  if (!h.sim.s.story.inbox.includes('the-watchers')) h.sim.story.fire('night-shift');
  h.sim.story.effect({ kind: 'boost', stat: 'farm', amount: 0.3, seconds: 300, text: 'Test boost' });
  const copy = structuredClone(h.sim.s);
  const s2 = new M.Sim(() => {});
  s2.load(copy);
  check(Math.abs(s2.mod('farm') - 0.3) < 1e-9 && s2.snapshot().story.boosts.some((b) => b.text === 'Test boost'), 'running boosts survive a save');
}

if (!process.argv.includes('--headless-only')) {
  // ---------- the card in the browser ----------
  const { launch } = await import('./lib/harness.mjs');
  const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
  const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  await page.goto(`${url}?intro=0&new=1&sw=0`);
  await page.waitForFunction(() => window.__exo?.ready && __exo.sim.cur?.deployed, null, { timeout: 120000 });
  await cmd({ type: 'debug', setup: { buildings: ['solar', 'solar', 'solar', 'civic', 'hydroponics'], alloys: 2000, peaceful: true } });
  await until(() => __exo.sim.cur.buildings.some((b) => b.kind === 'civic' && b.progress >= 1));
  await cmd({ type: 'debug', people: { colonists: 4 } });
  await until(() => __exo.sim.cur.people.adults >= 4);
  // answer anything already waiting, then bring on a dilemma about someone
  for (let i = 0; i < 6; i++) await page.evaluate(() => { for (const id of __exo.sim.cur.story.inbox) __exo.sim.command({ type: 'story', id, choice: 0 }); });
  await cmd({ type: 'debug', story: 'lean-months' });
  check(await until(() => /Lean Months/i.test(document.querySelector('#contact.on')?.textContent ?? '')), 'the dilemma shows as a card');
  const card = await page.evaluate(() => ({ text: document.querySelector('#contact').textContent, who: __exo.sim.cur.story.who['lean-months']?.name, kind: document.querySelector('#contact .kind')?.textContent }));
  check(!!card.who && card.text.includes(card.who) && !card.text.includes('{who}'), `it names who it is about (${card.who})`);
  check(card.kind === 'Colony dilemma', 'and is marked as a colony dilemma');
  await page.locator('#contact button[data-s="lean-months:0"]').dispatchEvent('pointerdown');
  check(await until(() => __exo.sim.cur.story.boosts?.some((b) => b.text === 'Short rations')), 'choosing sets the boost running');
  await page.evaluate(() => __exo.hud.people.toggle(true, 'overview'));
  check(await until(() => /IN FORCE/.test(document.querySelector('#colony')?.textContent ?? '') && /Short rations/.test(document.querySelector('#colony').textContent)), 'the Colony panel lists it under In force, with its time left');
  check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
