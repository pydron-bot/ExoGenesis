/**
 * End-to-end people test through the real UI:
 *   build Hydroponics + a Civilian Center, start a growth pod from the Center's
 *   card (picker: specialty + imprint), get colonists (debug), open the Colony
 *   panel, change a policy, pick someone from the roster, tap a colonist
 *   walking about, check the phone layout, and resume them from the autosave.
 *   node tools/people-smoke.mjs [--url http://localhost:5176/] [--shots dir] [--gpu]
 */
import { mkdirSync } from 'node:fs';
import { launch } from './lib/harness.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const gpu = process.argv.includes('--gpu');
const url = arg('--url', (process.env.SMOKE_URL ?? 'http://localhost:5176/'));
const shots = arg('--shots', null);
if (shots) mkdirSync(shots, { recursive: true });
const browser = await launch({ gpu });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
let page = await ctx.newPage();
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };
watch(page);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const until = (fn, a, timeout = 60000) => page.waitForFunction(fn, a, { timeout, polling: 200 });
const cmd = (c) => page.evaluate((c) => __exo.sim.command(c), c);
const people = () => page.evaluate(() => { const p = __exo.sim.cur.people; return { ...p, walkers: [...p.walkers] }; });
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const tapAt = async (p) => { await page.mouse.click(p.x, p.y); };
const screen = (x, z, lift = 0) => page.evaluate(([x, z, lift]) => __exo.screenOf(x, z, lift), [x, z, lift]);
const spotFor = (kind, cx, cz) => page.evaluate(([kind, cx, cz]) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!__exo.canPlace(kind, x, z)) return { x, z };
  }
  return null;
}, [kind, cx, cz]);

await page.goto(`${url}?intro=0&new=1`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(1500);

// the cryo bank starts as embryos
let p = await people();
check(p.embryos === 120 && p.lineagesLeft === 24, `cryo bank starts with 120 embryos in 24 lineages (${p.embryos}, ${p.lineagesLeft})`);
check((await page.textContent('#r-cryo')).includes('120'), 'resource strip shows the embryo count');

// build: a couple of solars, a farm and a Center (debug alloys, fast forward)
await cmd({ type: 'debug', alloys: 3000 });
for (const [kind, x, z] of [['solar', 18, 0], ['solar', -18, 0], ['battery', 0, 20], ['hydroponics', -20, -16], ['civic', 22, -18]]) {
  const at = await spotFor(kind, x, z);
  await cmd({ type: 'build', kind, ...at });
  await wait(450);
}
await page.evaluate(() => __exo.sim.setSpeed(8));
await until(() => __exo.sim.cur.buildings.filter((b) => b.progress >= 1).length >= 6, null, 120000);
await page.evaluate(() => __exo.sim.setSpeed(1));
const civic = await page.evaluate(() => __exo.sim.cur.buildings.find((b) => b.kind === 'civic'));
check(!!civic && civic.progress >= 1, 'Civilian Center built');

// select the Center and start a growth pod from its card
await page.evaluate(([x, z]) => { __exo.cam.fx = x; __exo.cam.fz = z; }, [civic.x, civic.z]);
await wait(600);
await tapAt(await screen(civic.x, civic.z, 3));
await until(() => document.querySelector('#card.on [data-act="pick"]'));
check(true, 'Center card offers "Grow colonist"');
await page.dispatchEvent('#card [data-act="pick"]', 'pointerdown');
await until(() => document.querySelector('#card .picker'));
await page.dispatchEvent('#card [data-act="spec:medic"]', 'pointerdown');
await page.dispatchEvent('#card [data-act="imp:heritage"]', 'pointerdown');
await shot('picker');
await page.dispatchEvent('#card [data-act="grow"]', 'pointerdown');
await until(() => __exo.sim.cur.people.pods.some((x) => x.running.length));
p = await people();
const pod = p.pods.find((x) => x.running.length).running[0];
check(pod.specialty === 'medic' && pod.curriculum === 'heritage', `pod started as picked (${pod.specialty}, ${pod.curriculum})`);
check(p.embryos === 119, `an embryo left the bank (${p.embryos})`);
await until(() => document.querySelector('#card .pod:not(.empty)'));
check(true, 'card shows the running pod');

// colonists (debug: straight out of the pod) walk about and show up in the strip
await cmd({ type: 'debug', people: { colonists: 6, biomass: 200 } });
await until(() => __exo.sim.cur.people.adults === 6);
await until(() => document.querySelector('#r-people b')?.textContent === '6');
check(true, 'strip shows 6 colonists');
p = await people();
check(p.roster.every((c) => c.name && c.lineage && c.why.length >= 0), 'roster has names and lineages');

// the Colony panel: policies
await page.dispatchEvent('#r-people', 'pointerdown');
await until(() => document.querySelector('#colony.on'));
await shot('colony');
await page.dispatchEvent('#colony [data-pol="council:assembly"]', 'pointerdown');
await until(() => __exo.sim.cur.people.policies.council === 'assembly');
check(true, 'policy changed from the panel');
await until(() => document.querySelector('#colony [data-pol="council:assembly"].on'));
check(true, 'panel shows the new policy');
// roster → select a colonist
await page.dispatchEvent('#colony [data-tab="people"]', 'pointerdown');
await until(() => document.querySelector('#colony .person'));
await shot('roster');
await page.dispatchEvent('#colony .person', 'pointerdown');
await until(() => __exo.ui.sel?.kind === 'colonist');
await until(() => document.querySelector('#card.on .why'));
check(true, 'roster tap selects a colonist and shows their card');
await shot('colonist-card');
await page.dispatchEvent('#colony [data-tab="cryo"]', 'pointerdown');
await wait(300);
await shot('tab-cryo');
check(await page.evaluate(() => document.querySelectorAll('#colony .lines span').length === 24), 'cryo tab lists 24 lineages');
await page.dispatchEvent('#colony [data-tab="memorial"]', 'pointerdown');
await wait(300);
check(await page.evaluate(() => !!document.querySelector('#colony .row')), 'memorial tab renders');
await page.dispatchEvent('#colony [data-close]', 'pointerdown');

// tap a colonist walking about (wait for one to be outdoors, then tap where it's drawn)
await page.evaluate(() => { __exo.ui.sel = null; __exo.hud.selected(); });
let tapped = false;
for (let tries = 0; tries < 40 && !tapped; tries++) {
  const hit = await page.evaluate(() => {
    const w = __exo.sim.cur.people.walkers;
    if (!w.length) return null;
    const id = w[0], x = w[1], z = w[2];
    __exo.cam.fx = x; __exo.cam.fz = z;
    return { id };
  });
  if (!hit) { await page.evaluate(() => __exo.sim.setSpeed(4)); await wait(500); await page.evaluate(() => __exo.sim.setSpeed(1)); continue; }
  await page.evaluate(() => __exo.sim.setSpeed(0));
  await wait(400);
  const s = await page.evaluate((id) => __exo.colonistScreen(id), hit.id);
  if (!s) { await page.evaluate(() => __exo.sim.setSpeed(1)); await wait(300); continue; }
  await tapAt(s);
  await wait(300);
  tapped = await page.evaluate((id) => __exo.ui.sel?.kind === 'colonist' && __exo.ui.sel.id === id, hit.id);
  await page.evaluate(() => __exo.sim.setSpeed(1));
}
check(tapped, 'tapping a colonist on the map selects them');
await shot('walker');

// phone layout
await page.setViewportSize({ width: 390, height: 844 });
await wait(800);
await shot('phone-card');
await page.dispatchEvent('#r-people', 'pointerdown');
await page.dispatchEvent('#colony [data-tab="overview"]', 'pointerdown');
await wait(500);
await shot('phone-colony');
const over = await page.evaluate(() => {
  const r = document.querySelector('#colony').getBoundingClientRect();
  return { left: r.left, right: r.right, w: innerWidth, docW: document.documentElement.scrollWidth };
});
check(over.left >= 0 && over.right <= over.w && over.docW <= over.w, `phone: panel fits the screen (${over.left.toFixed(0)}–${over.right.toFixed(0)} of ${over.w})`);
const strip = await page.evaluate(() => [...document.querySelectorAll('#res .r')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, r: r.right }; }));
check(strip.every((x) => x.r <= 390), 'phone: resource strip fits');
await page.dispatchEvent('#colony [data-close]', 'pointerdown');
await page.setViewportSize({ width: 1280, height: 800 });

// autosave → resume keeps the people
const before = (await people()).roster.map((c) => c.name).sort().join();
await page.evaluate(() => __exo.sim.flush());
await wait(1500);
await page.close();
page = await ctx.newPage();
watch(page);
await page.goto(`${url}?title=0`);
await page.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
await wait(1500);
const after = (await people()).roster.map((c) => c.name).sort().join();
check(after === before && after.length > 0, 'colonists survive autosave + resume');
const pol = await page.evaluate(() => __exo.sim.cur.people.policies.council);
check(pol === 'assembly', 'policies survive resume');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
