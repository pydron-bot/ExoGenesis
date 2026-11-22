/**
 * The climax fight at home, measured (TECH.md "The campaign (content)", balance): headless, with the real sim and
 * the real content. A realistic colony for that point of the campaign is grown by the balance bot (src/sim/balance.ts,
 * strategy `opening`: a first-timer's people build with turrets, at a human pace, predators off; each seed a fifth of a
 * sol later, so the fight starts at another hour) with a Vehicle Bay
 * and a small army appended to its plan; then the play-test setup adds what the bot can't research (Shield Lattice and,
 * with --shield, one Shield Projector by the Core) and the Launch Gantry. Then the fight: Meridian has spoken,
 * clause-wakes is under way, the-fight is set, every card is answered with its first choice, and a simple defender
 * plays it:
 *   - rebuilds Solar Arrays and Battery Banks the strikes destroy, where they stood, when the alloys allow
 *     (hydroponics too, once the power is back);
 *   - keeps the army near the Core: attacks turned units and predators within 45 u of the colony, otherwise
 *     gathers by the Core; moves units out of a strike's ring;
 *   - no forced domes, units or buildings.
 * It reports, per seed: held or lost (and why), the cryo bank's and the power's minima, the buildings lost by kind,
 * units turned and lost, colonists lost, strikes landed and soaked.
 *   node tools/climax-balance.mjs [--seeds 1,2,3,4,5] [--minutes 60] [--allies all|none|kindred,engram,vell,choir]
 *     [--shield 0|1] [--waves] [--no-defender] [--lantern] [--lantern-build base|none] [--lantern-wait 60] [--verbose]
 * --waves keeps the wild packs coming during the fight (as the game does; the bot's colony grew without them).
 * --lantern also plays the Lantern (the-lantern) with its expedition package and an army bot (see `lantern()`).
 */
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const flag = (k) => process.argv.includes(k);
const seeds = arg('--seeds', '1,2,3,4,5').split(',').map(Number);
const minutes = Number(arg('--minutes', 60));
const alliesArg = arg('--allies', 'all');
const ALLY = { kindred: 'kindred-ally', engram: 'engram-defected', vell: 'keeper-song', choir: 'choir-fragment' };
const allies = alliesArg === 'all' ? Object.keys(ALLY) : alliesArg === 'none' ? [] : alliesArg.split(',');
const shield = Number(arg('--shield', 1));
const verbose = flag('--verbose');
const { module: M } = await runnerImport(path.join(root, 'tools/sim-entry.ts'));
const C = M.content, HZ = 10;
const t0 = Date.now();

/** The army the bot adds to its plan once its people build is done (a first-timer's 8 units). */
const ARMY = [['bay'], ['rover'], ['tank'], ['rover'], ['tank'], ['lancer'], ['tank'], ['rover'], ['tank']];

/** A colony grown by the balance bot, then the play-test setup's extras. Returns the live Sim. */
function colony(seed) {
  let sim;
  const r = M.runBalance('opening', { minutes: minutes + (seed % 5) * 1.2, seed, peaceful: true, pace: 3, hook: (s, tick, plan) => { sim = s; if (tick === 0) plan.push(...ARMY); } });
  const extras = { research: ['deep-survey', 'shield-lattice', 'isotope-cells', 'orbital-launch'], isotopes: 60, buildings: ['launch-gantry'] };
  sim.command({ type: 'debug', setup: extras });
  if (shield) placeNear(sim, 'shield', 0, 0, true);
  for (let i = 0; i < 20 * HZ; i++) sim.step();
  sim.events = r.events; // the sim's log keeps filling this
  return sim;
}
/** Place a building (finished, if `free`: the play-test way) at the nearest valid spot to (x, z). */
function placeNear(sim, kind, x, z, free = false) {
  const p = spot(sim, kind, x, z);
  if (!p) return false;
  if (free) {
    const d = C.buildings[kind];
    sim.s.buildings.push({ id: sim.s.nextId++, kind, x: p.x, z: p.z, yaw: 0, progress: 1, hp: d.hp, on: true, powered: false, sh: d.shield });
    return true;
  }
  const before = sim.s.buildings.length;
  sim.command({ type: 'build', kind, x: p.x, z: p.z });
  return sim.s.buildings.length > before;
}
function spot(sim, kind, px, pz) {
  for (let r = 0; r < 40; r += 1.5) {
    const n = Math.max(1, Math.round(r * 1.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (!M.placeProblem(sim.world, C.buildings, C.colony, kind, x, z)) return { x, z };
    }
  }
  return null;
}
const count = (s) => { const c = {}; for (const b of s.buildings) if (!b.team) c[b.kind] = (c[b.kind] ?? 0) + 1; return c; };

/** The fight: Meridian has spoken, clause-wakes runs, the-fight is set; the defender plays until held or lost. */
function fight(sim, { defender = true } = {}) {
  const s = sim.s, st = s.story;
  if (!flag('--waves')) s.waves.next = Number.MAX_SAFE_INTEGER;
  else s.waves.next = Math.min(s.waves.next, s.tick + 120 * HZ);
  for (const a of allies) if (!st.flags.includes(ALLY[a])) st.flags.push(ALLY[a]);
  // Trust decided for the Partners (the fight's branch): no Severance or Inheritance from this colony's mood
  for (const id of ['meridian-speaks', 'trust-decides', 'trust-partners']) { if (!st.fired.includes(id)) st.fired.push(id); if (!st.answered.includes(id)) st.answered.push(id); }
  st.flags.push('trust-settled');
  sim.missions.begin('clause-wakes');
  st.flags.push('the-fight');
  const e0 = sim.events.length, f0 = sim.secs;
  const m0 = s.people.memorial.length;
  const start = count(s), b0 = s.stats.buildingsLost, u0 = s.stats.unitsLost ?? 0, c0 = s.people.colonists.length;
  const ourUnits = () => s.units.filter((u) => !u.team);
  const units0 = ourUnits().length;
  /** Where the strikes knocked out power: rebuilt there when the alloys allow. */
  const sites = s.buildings.filter((b) => !b.team && ['solar', 'battery', 'hydroponics'].includes(b.kind)).map((b) => ({ kind: b.kind, x: b.x, z: b.z }));
  const core = s.buildings.find((b) => b.kind === 'core' && !b.team);
  const m = { cryoMin: s.cryo, genMin: Infinity, storedMin: Infinity, rebuilt: 0, turned: 0, soaked: 0, strikes: 0, shortSecs: 0 };
  let lastStruck = 0;
  const lost = {};
  for (let i = 0; i < 640 * HZ; i++) {
    sim.step();
    if (s.over || s.missions.done.includes('clause-wakes') || s.missions.failed?.includes('clause-wakes')) break;
    if (i % HZ) continue;
    for (const id of [...st.cineQueue ?? []]) sim.command({ type: 'cinematic', id, done: true });
    for (const id of [...st.inbox]) sim.command({ type: 'story', id, choice: 0 });
    const snap = { gen: sim.power.gen, stored: s.stored };
    m.cryoMin = Math.min(m.cryoMin, s.cryo);
    m.genMin = Math.min(m.genMin, snap.gen);
    if (i > 60 * HZ) m.storedMin = Math.min(m.storedMin, snap.stored);
    if (sim.power.short > 0.01) m.shortSecs++;
    if ((st.struck?.n ?? 0) !== lastStruck) lastStruck = st.struck?.n ?? 0;
    if (!defender) continue;
    // rebuild what the strikes took (power first), once the drones are free for it
    if (i % (5 * HZ) === 0) {
      const have = s.buildings.filter((b) => !b.team);
      for (const kind of ['solar', 'battery', 'hydroponics']) {
        if (kind === 'hydroponics' && sim.power.short > 0) continue;
        const missing = sites.filter((p) => p.kind === kind && !have.some((b) => b.kind === kind && Math.hypot(b.x - p.x, b.z - p.z) < 3));
        const pending = have.filter((b) => b.progress < 1).length;
        if (!missing.length || pending >= 3) continue;
        const p = missing[0];
        if (s.alloys >= C.buildings[kind].cost && placeNear(sim, kind, p.x, p.z)) { m.rebuilt++; break; }
      }
    }
    // the army: out of the rings, at turned units and predators near the colony, otherwise by the Core
    if (i % (2 * HZ) === 0) {
      const mine = ourUnits();
      const rings = st.strikes ?? [];
      const foes = [...s.units.filter((u) => u.team), ...s.hostiles.filter((h) => !h.under)]
        .filter((f) => s.buildings.some((b) => !b.team && Math.hypot(b.x - f.x, b.z - f.z) < 45));
      for (const u of mine) {
        const ring = rings.find((k) => Math.hypot(u.x - k.x, u.z - k.z) < k.r + 2);
        if (ring) {
          const a = Math.atan2(u.z - ring.z, u.x - ring.x) || 1;
          sim.command({ type: 'order', ids: [u.id], x: ring.x + Math.cos(a) * (ring.r + 6), z: ring.z + Math.sin(a) * (ring.r + 6) });
        }
      }
      const free = mine.filter((u) => !rings.some((k) => Math.hypot(u.x - k.x, u.z - k.z) < k.r + 2));
      if (foes.length && free.length) {
        const f = foes.sort((a, b) => Math.hypot(a.x - core.x, a.z - core.z) - Math.hypot(b.x - core.x, b.z - core.z))[0];
        const idle = free.filter((u) => u.target < 0);
        if (idle.length) sim.command({ type: 'order', ids: idle.map((u) => u.id), x: f.x, z: f.z });
      } else {
        const far = free.filter((u) => u.target < 0 && Math.hypot(u.x - core.x, u.z - core.z) > 16);
        if (far.length) sim.command({ type: 'order', ids: far.map((u) => u.id), x: core.x, z: core.z - 12 });
      }
    }
  }
  if (verbose) for (const e of sim.events.slice(e0)) if (/strike|destroyed|answers|shield|Cryo|pack|Contact|lander|Kindred|fight|Choir|Engram|Vell/i.test(e.text)) console.log(`    ${(e.t - f0).toFixed(0).padStart(4)}s ${e.text}`);
  const end = count(s);
  for (const k of Object.keys(start)) if ((end[k] ?? 0) < start[k]) lost[k] = start[k] - (end[k] ?? 0);
  return {
    held: s.missions.done.includes('clause-wakes'), over: s.over ?? (s.missions.failed?.includes('clause-wakes') ? 'failed' : null),
    secs: Math.round((s.tick / HZ) - 0), cryoMin: Math.round(m.cryoMin), genMin: +m.genMin.toFixed(1), storedMin: Math.round(m.storedMin), shortSecs: m.shortSecs,
    strikes: st.struck?.n ?? 0, lostTotal: s.stats.buildingsLost - b0, lost, rebuilt: m.rebuilt,
    units0, unitsEnd: ourUnits().length, unitsLost: (s.stats.unitsLost ?? 0) - u0, turned: s.units.filter((u) => u.team === 1).length,
    colonists: `${c0}→${s.people.colonists.length}${s.people.memorial.length > m0 ? ` (${Object.entries(s.people.memorial.slice(m0).reduce((a, x) => ((a[x.cause] = (a[x.cause] ?? 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`, cryoEnd: Math.round(s.cryo), coreHp: Math.round(s.buildings.find((b) => b.kind === 'core' && !b.team)?.hp ?? 0),
  };
}

/**
 * The Lantern with the expedition package: the strike force lands at the drop zone; a player-like bot plays it.
 *   - build ('base', the default; 'none' builds nothing): three Solar Arrays, a Battery Bank, a Shield Projector over
 *     the Core and two Defense Turrets by the landing, so the Lantern's strikes have more than the Core to hit; then a
 *     Vehicle Bay, and units from it while the alloys last (keeping 100);
 *   - the army holds the landing for `wait` s (--lantern-wait, default 60: the allies come in, the Lantern's raised
 *     units come to it; longer while they're within 50 u of the Core, up to two minutes more), then goes in together:
 *     without the Enclave's code, to the Lid lock with a node standing and the fewest guns covering it, then the next;
 *     once the Lid is open, to the breach and then the core; idle units are sent on every 5 s, so they stop to fight
 *     what's in reach and go on; worn down to 5 units it falls back to gather the bay's reinforcements (twice at most);
 *   - the core's card: destroy it.
 * Reports when the Lid opened and the core was reached, the countdown left, the units left, the landing Core's lowest
 * hp and how it ended.
 */
function lantern(home, { code, build = 'base', wait = 60 }) {
  const sh = M.sharedOf(home.s);
  if (!sh.campaign.routes.includes('lantern')) sh.campaign.routes.push('lantern');
  sh.story.flags = sh.story.flags.filter((f) => f !== 'survivors-met');
  if (code) sh.story.flags.push('survivors-met');
  M.useRegion('lantern');
  const sim = new M.Sim(() => {});
  M.applyShared(sim.s, sh, 'lantern');
  sim.arrived();
  sim.command({ type: 'landing', stage: 'deploy' });
  const s = sim.s, st = s.story, R = C.regions.lantern;
  const site = (id) => R.sites.find((x) => x.id === id);
  const core = () => s.buildings.find((b) => b.kind === 'core' && !b.team);
  const units0 = s.units.filter((u) => !u.team).length;
  const r = { lid: null, reached: null, coreMin: core()?.hp ?? 0, ending: null, built: 0, waves: 0 };
  const plan = build === 'base' ? ['solar', 'solar', 'solar', 'battery', 'shield', 'turret', 'turret', 'bay'] : [];
  const reinforce = ['tank', 'lancer', 'tank', 'rover', 'tank', 'lancer'];
  let made = 0;
  let stage = 'breach', attacking = false;
  for (let i = 0; i < 1600 * HZ && !s.over; i++) {
    sim.step();
    if (i % HZ) continue;
    for (const id of [...st.cineQueue ?? []]) sim.command({ type: 'cinematic', id, done: true });
    for (const id of [...st.inbox]) { if (id === 'the-core') r.reached ??= Math.round(i / HZ); sim.command({ type: 'story', id, choice: 0 }); }
    const c = core();
    r.coreMin = Math.min(r.coreMin, c?.hp ?? 0);
    if (st.flags.includes('lid-open')) r.lid ??= Math.round(i / HZ);
    if (plan.length && i % (3 * HZ) === 0 && c && s.alloys >= C.buildings[plan[0]].cost) {
      const a = r.built * 1.1, d = plan[0] === 'shield' ? 6 : 16;
      if (placeNear(sim, plan[0], c.x + Math.cos(a) * d, c.z + Math.sin(a) * d)) { plan.shift(); r.built++; }
    }
    if (verbose && i % (10 * HZ) === 0 && i < 200 * HZ) {
      const a = s.units.filter((u) => !u.team);
      const foes = [...s.hostiles.filter((h) => !h.dormant), ...s.units.filter((u) => u.team && sim.enemies(0, u.team))].filter((h) => a.some((u) => Math.hypot(u.x - h.x, u.z - h.z) < 40));
      const guns = s.buildings.filter((b) => b.team && sim.enemies(0, b.team) && a.some((u) => Math.hypot(u.x - b.x, u.z - b.z) < 60));
      console.log(`      ${i / HZ}s ${a.length} units · foes near: ${foes.map((h) => `${h.unit}@${h.x.toFixed(0)},${h.z.toFixed(0)}`).join(' ')} · guns in 60: ${guns.map((b) => `${b.kind}@${b.x},${b.z}`).join(' ')}`);
    }
    if (verbose && i % (30 * HZ) === 0) {
      const a = s.units.filter((u) => !u.team), en = s.units.filter((u) => u.team && sim.enemies?.(0, u.team));
      const cx = a.reduce((m, u) => m + u.x, 0) / Math.max(1, a.length), cz = a.reduce((m, u) => m + u.z, 0) / Math.max(1, a.length);
      console.log(`    ${i / HZ}s units ${a.length} @${cx.toFixed(0)},${cz.toFixed(0)} (${[...new Set(a.map((u) => u.order.kind))]}) · their units ${s.units.filter((u) => u.team).map((u) => `${u.unit[0]}${u.team}`).join('')} · relic ${s.hostiles.filter((h) => h.relic && !h.dormant).length} awake · core ${Math.round(c?.hp ?? 0)} · alloys ${Math.round(s.alloys)}`);
    }
    // reinforcements from the bay with what's left (the Lid's cache pays for more)
    const bay = s.buildings.find((b) => b.kind === 'bay' && !b.team && b.progress >= 1);
    if (bay && i % (5 * HZ) === 0 && !(bay.queue?.length) && s.alloys >= C.units[reinforce[made % reinforce.length]].cost + 100) {
      sim.command({ type: 'produce', id: bay.id, unit: reinforce[made % reinforce.length] }); made++;
    }
    if (i % (5 * HZ)) continue;
    // the army: it holds the landing while the allies come in and the Lantern's first units come to it, then goes in
    // together; worn down to 5, it falls back to gather the bay's reinforcements (twice at most), then goes again
    const army = s.units.filter((u) => !u.team), rally = { x: c.x + 6, z: c.z + 16 };
    const near = s.units.some((u) => u.team && sim.enemies(0, u.team) && Math.hypot(u.x - c.x, u.z - c.z) < 50);
    if (!attacking && i >= wait * HZ && (!near || i > (wait + 120) * HZ) && (army.length >= 12 || s.alloys < 200 || i > (wait + 300) * HZ)) { attacking = true; r.waves++; }
    else if (attacking && army.length < 5 && bay && s.alloys >= 220 && r.waves < 3) { attacking = false; sim.command({ type: 'order', ids: army.map((u) => u.id), x: rally.x, z: rally.z }); }
    let to = rally;
    if (attacking && !st.flags.includes('lid-open')) {
      const locks = ['lid-lock-w', 'lid-lock-n', 'lid-lock-e'].map(site).filter((p) => s.hostiles.some((h) => h.relic === 'lid' && h.unit === 'gridnode' && Math.hypot(h.x - p.x, h.z - p.z) < 6));
      const cx = army.reduce((m, u) => m + u.x, 0) / Math.max(1, army.length), cz = army.reduce((m, u) => m + u.z, 0) / Math.max(1, army.length);
      // the lock with the fewest guns covering it (a player looks first), then the nearest
      const guns = (p) => s.buildings.filter((b) => b.team && sim.enemies(0, b.team) && Math.hypot(b.x - p.x, b.z - p.z) < 45).length;
      to = locks.sort((a, b) => guns(a) - guns(b) || Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0] ?? site('breach');
    } else if (attacking) {
      if (stage === 'breach' && army.some((u) => Math.hypot(u.x - site('breach').x, u.z - site('breach').z) < 20)) stage = 'core';
      to = site(stage === 'breach' ? 'breach' : 'lantern-core');
    }
    const idle = army.filter((u) => u.order.kind === 'idle' && u.target < 0 && Math.hypot(u.x - to.x, u.z - to.z) > 8);
    if (idle.length) sim.command({ type: 'order', ids: idle.map((u) => u.id), x: to.x, z: to.z });
  }
  r.ending = st.epilogue?.ending ?? s.over ?? 'none';
  const cd = st.countdowns?.find((x) => x.id === 'lantern-fires');
  r.made = made;
  return { ...r, coreMin: Math.round(r.coreMin), units: `${units0}→${s.units.filter((u) => !u.team).length}`, left: cd ? Math.round((cd.at - s.tick) / HZ) : null, strikes: st.struck?.n ?? 0 };
}

const rows = [];
for (const seed of seeds) {
  const t = Date.now();
  const sim = colony(seed);
  const c = count(sim.s);
  const col = `sol ${(sim.secs / C.colony.solSeconds + 1).toFixed(1)}, ${sim.s.people.colonists.length} colonists, ${c.solar ?? 0} solar, ${c.battery ?? 0} batteries, ${c.geothermal ?? 0} geothermal, ${c.turret ?? 0} turrets, ${c.shield ?? 0} shields, ${c.hydroponics ?? 0} farms, ${c.civic ?? 0} civic, ${sim.s.units.length} units (${sim.s.units.map((u) => u.unit[0]).join('')}), ${Math.round(sim.s.alloys)} alloys`;
  const f = fight(sim, { defender: !flag('--no-defender') });
  rows.push({ seed, ...f });
  console.log(`seed ${seed}: colony ${col}`);
  console.log(`  ${f.held ? 'HELD' : `LOST (${f.over})`} · cryo min ${f.cryoMin} (end ${f.cryoEnd}) · power gen min ${f.genMin} MW, stored min ${f.storedMin}, short ${f.shortSecs} s · strikes ${f.strikes} · buildings lost ${f.lostTotal} ${JSON.stringify(f.lost)} · rebuilt ${f.rebuilt} · units ${f.units0}→${f.unitsEnd} (turned left ${f.turned}, lost ${f.unitsLost}) · colonists ${f.colonists} · core ${f.coreHp} · ${((Date.now() - t) / 1000).toFixed(1)} s`);
  if (flag('--lantern') && f.held) for (const code of [true, false]) {
    const L = lantern(sim, { code, build: arg('--lantern-build', 'base'), wait: Number(arg('--lantern-wait', 60)) });
    console.log(`  Lantern (${code ? "the Enclave's code" : 'break the locks'}): ${L.ending} · Lid open ${L.lid ?? '-'} s · core reached ${L.reached ?? '-'} s · countdown left ${L.left ?? '-'} s · units ${L.units} · landing Core min ${L.coreMin} hp · strikes ${L.strikes} · built ${L.built}, units made ${L.made}, attacks ${L.waves}`);
  }
}
const held = rows.filter((r) => r.held).length;
console.log(`\nallies: ${allies.join(', ') || 'none'} · shield projector: ${shield ? 'one' : 'none'} · waves ${flag('--waves') ? 'on' : 'held'} · defender ${flag('--no-defender') ? 'off' : 'on'}`);
console.log(`held ${held} of ${rows.length} · cryo min ${rows.map((r) => r.cryoMin).join('/')} · buildings lost ${rows.map((r) => r.lostTotal).join('/')} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
