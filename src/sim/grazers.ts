/**
 * Grazers: the ambient herds that wander their home ground and scatter when predators or fighting come near
 * (panic). Split out of ./core.ts; called once a tick by Sim.step.
 */
import { TICK_HZ } from './types';
import { clamp } from '../util/math';
import { CORE_KEEP_OUT, DT, PANIC_R, REGION, type Sim, bodyR, limit, wildMove } from './core';

function herdSpot(sim: Sim, h: number) {
  const s = sim.s;
  const home = REGION.herds[h] ?? { x: s.herds[h].x, z: s.herds[h].z, roam: 60 };
  if (home.roam <= 0) return { x: home.x, z: home.z };
  for (let tries = 0; tries < 20; tries++) {
    const a = sim.rnd() * Math.PI * 2, r = Math.sqrt(sim.rnd()) * home.roam;
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    if (Math.abs(x) < limit() - 15 && Math.abs(z) < limit() - 15 && Math.hypot(x, z) > 50) return { x, z };
  }
  return { x: home.x, z: home.z };
}

export function stepGrazers(sim: Sim) {
  const s = sim.s;
  const panic = s.panic > 0;
  if (panic) s.panic--;
  if (s.herds.length && sim.rnd() < 0.004) {
    const h = Math.floor(sim.rnd() * s.herds.length);
    s.herds[h] = { ...herdSpot(sim, h), sp: s.herds[h].sp };
  }
  const scary = [...s.drones, ...sim.units, ...s.hostiles.filter((h) => !h.under)];
  // what's near each creature, in list order (as a check against everything would go)
  const sb = sim.scaryBuckets, found = sim.found;
  sb.clear();
  scary.forEach((o, i) => sb.add(i, o.x, o.z));
  const blds = sim.buildingBuckets(), seen = sim.seen;
  for (const f of s.fauna) {
    const w = wildMove(f.sp);
    const beh = w.behavior;
    const c = s.herds[f.herd] ?? { x: f.x, z: f.z };
    if (f.wait) f.wait--;
    // the nearest threat: the landing's engine noise, or something within the species' wariness
    let thx = 0, thz = 0, threat = false;
    const rc0 = Math.hypot(f.x, f.z);
    if (panic && rc0 < PANIC_R && rc0 > 1e-3) { thx = f.x / rc0; thz = f.z / rc0; threat = true; }
    else if (sim.deployed && w.flee > 0) {
      sb.near(f.x, f.z, w.flee, found);
      found.sort((p, q) => p - q);
      for (const k of found) {
        const o = scary[k];
        const dx = f.x - o.x, dz = f.z - o.z, dd = Math.hypot(dx, dz);
        if (dd < w.flee && dd > 1e-3) { thx = dx / dd; thz = dz / dd; threat = true; break; }
      }
    }
    let tx = f.tx, tz = f.tz, sp = w.speed, turn = 2.5;
    const hidden = f.st === 2;
    f.st = 0;
    const newTarget = (r: number) => {
      f.tx = clamp(c.x + (sim.rnd() - 0.5) * 2 * r, -limit(), limit());
      f.tz = clamp(c.z + (sim.rnd() - 0.5) * 2 * r, -limit(), limit());
      tx = f.tx; tz = f.tz;
    };
    if (beh === 'flyer') {
      // circle the herd's ground; wider and faster when disturbed. Flyers pass over buildings.
      const rad = w.spread * (threat ? 1.6 : 0.6) + (f.herd % 3) * 3;
      sp = threat ? w.run : w.speed;
      f.ang = ((f.ang ?? 0) + (sp / Math.max(4, rad)) * DT) % (Math.PI * 2);
      tx = clamp(c.x + Math.cos(f.ang) * rad, -limit(), limit());
      tz = clamp(c.z + Math.sin(f.ang) * rad, -limit(), limit());
      if (threat) f.st = 1;
      sim.approach(f, tx, tz, sp, 1.6);
      continue;
    }
    if (beh === 'burrow') {
      // duck underground and wait it out
      if (threat) { f.st = 2; f.wait = Math.round((3 + sim.rnd() * 4) * TICK_HZ); continue; }
      if (hidden && f.wait) { f.st = 2; continue; }
    }
    if (threat && beh === 'lumber' && !panic) {
      // stand and stare
      const want = Math.atan2(-thx, -thz);
      let dh = want - f.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      f.heading += clamp(dh, -1.2 * DT, 1.2 * DT);
      continue;
    }
    let fled = false;
    if (threat) {
      tx = f.x + thx * 20; tz = f.z + thz * 20; sp = w.run; fled = true; f.st = 1; f.wait = 0;
      turn = 9;
    } else if (beh === 'skittish') {
      // dash, pause, dash
      if (f.wait) continue;
      if (Math.hypot(f.tx - f.x, f.tz - f.z) < 1) {
        f.wait = Math.round((0.8 + sim.rnd() * 3) * TICK_HZ);
        const a = sim.rnd() * Math.PI * 2, r = 3 + sim.rnd() * 8;
        let nx = f.x + Math.cos(a) * r, nz = f.z + Math.sin(a) * r;
        // drift back toward the herd's centre when strayed
        if (Math.hypot(nx - c.x, nz - c.z) > w.spread) { nx = (nx + c.x) / 2; nz = (nz + c.z) / 2; }
        f.tx = clamp(nx, -limit(), limit()); f.tz = clamp(nz, -limit(), limit());
        continue;
      }
      sp = w.run * 0.6; turn = 12;
    }
    if (!fled && beh !== 'skittish' && (Math.hypot(f.tx - f.x, f.tz - f.z) < 1.5 || sim.rnd() < 0.003)) newTarget(w.spread);
    // keep out of the base
    seen.clear();
    blds.near(f.x, f.z, CORE_KEEP_OUT, found, seen);
    found.sort((p, q) => p - q);
    for (const k of found) {
      const b = s.buildings[k];
      const r = b.kind === 'core' ? CORE_KEEP_OUT : bodyR(b) + 4;
      const dx = f.x - b.x, dz = f.z - b.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) { tx = b.x + (dx / d) * (r + 8); tz = b.z + (dz / d) * (r + 8); }
    }
    if (Math.hypot(tx - f.x, tz - f.z) > 0.4) sim.approach(f, tx, tz, sp, sp > w.speed * 1.5 ? Math.max(turn, 9) : turn);
    f.x = clamp(f.x, -limit(), limit());
    f.z = clamp(f.z, -limit(), limit());
  }
}
