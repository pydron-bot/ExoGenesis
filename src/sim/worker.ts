/**
 * The simulation. Runs at a fixed tick in a Web Worker and is the single owner
 * of game state; the main thread only renders snapshots and sends commands.
 */
import { content } from '../content';
import {
  REGION_HALF, TICK_HZ, TICK_MS,
  type FromWorker, type SimState, type Snapshot, type ToWorker,
} from './types';

const RULES = content.colony;
const CORE = content.buildings.core;
const SOLAR = content.buildings.solar;

const ctx = self as unknown as Worker;
const DT = 1 / TICK_HZ;
const DRONE_SPEED = RULES.droneSpeed;
const WALK = 2.2;
const RUN = 7.5;
const FLEE_R = 14;
const CORE_KEEP_OUT = 24;
const LIMIT = REGION_HALF - 6;

let s: SimState;
let speed = 1;

function rnd(): number {
  // mulberry32, state kept in the save so runs are reproducible
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function event(text: string, level: 'info' | 'warn' | 'bad' = 'info') {
  post({ type: 'event', text, level });
}

function newGame(seed: number) {
  s = {
    version: 1, seed, rng: seed, tick: 0, nextId: 2, alloys: RULES.startAlloys, cryo: 100, cryoWarn: 100,
    drone: { x: 0, z: -14, heading: Math.PI, task: { kind: 'idle' } },
    buildings: [{ id: 1, kind: 'core', x: 0, z: 0, progress: 1 }],
    herds: [], fauna: [], phase: 'descent', panic: 0,
  };
  for (let h = 0; h < RULES.herds; h++) s.herds.push(randomHerdSpot());
  for (let i = 0; i < RULES.grazers && s.herds.length; i++) {
    const herd = i % s.herds.length;
    const c = s.herds[herd];
    const x = clamp(c.x + (rnd() - 0.5) * 30, -LIMIT, LIMIT);
    const z = clamp(c.z + (rnd() - 0.5) * 30, -LIMIT, LIMIT);
    s.fauna.push({ x, z, heading: rnd() * Math.PI * 2, tx: x, tz: z, herd });
  }
}

function randomHerdSpot() {
  for (;;) {
    const x = (rnd() * 2 - 1) * (LIMIT - 15);
    const z = (rnd() * 2 - 1) * (LIMIT - 15);
    if (Math.hypot(x, z) > 50) return { x, z };
  }
}

function energy() {
  let gen = 0, draw = RULES.cryoDrawMW + (s.drone.task.kind === 'idle' ? RULES.droneIdleDrawMW : RULES.droneBusyDrawMW);
  for (const b of s.buildings) {
    if (b.progress < 1) continue;
    const p = content.buildings[b.kind].powerMW;
    if (p >= 0) gen += p; else draw -= p;
  }
  return { gen, draw };
}

/** Move (x,z) toward (tx,tz). Returns remaining distance. */
function approach(o: { x: number; z: number; heading: number }, tx: number, tz: number, sp: number, turn: number) {
  const dx = tx - o.x, dz = tz - o.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const want = Math.atan2(dx, dz);
  let dh = want - o.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  o.heading += clamp(dh, -turn * DT, turn * DT);
  const step = Math.min(d, sp * DT);
  o.x += (dx / d) * step;
  o.z += (dz / d) * step;
  return d - step;
}

function stepDrone() {
  const d = s.drone;
  const t = d.task;
  if (t.kind === 'move') {
    if (approach(d, t.x, t.z, DRONE_SPEED, 7) < 0.2) d.task = { kind: 'idle' };
  } else if (t.kind === 'build') {
    const site = s.buildings.find((b) => b.id === t.siteId);
    if (!site) { d.task = { kind: 'idle' }; return; }
    const dist = Math.hypot(site.x - d.x, site.z - d.z);
    if (dist > 5) {
      // stop on the near side of the site
      const k = (dist - 4.5) / dist;
      approach(d, d.x + (site.x - d.x) * k, d.z + (site.z - d.z) * k, DRONE_SPEED, 7);
    } else {
      d.heading += 1.5 * DT; // circle-scan while building
      const secs = content.buildings[site.kind].buildSeconds;
      site.progress = secs > 0 ? Math.min(1, site.progress + DT / secs) : 1;
      if (site.progress >= 1) {
        d.task = { kind: 'idle' };
        event(`${SOLAR.name} online · +${SOLAR.powerMW} MW`);
      }
    }
  }
}

const PANIC_R = 115;

function stepFauna() {
  const d = s.drone;
  const panic = (s.panic ?? 0) > 0;
  if (panic) s.panic!--;
  if (rnd() < 0.004) {
    const h = Math.floor(rnd() * s.herds.length);
    s.herds[h] = randomHerdSpot();
  }
  for (const f of s.fauna) {
    let tx = f.tx, tz = f.tz, sp = WALK;
    const ddx = f.x - d.x, ddz = f.z - d.z;
    const dd = Math.hypot(ddx, ddz);
    const rc0 = Math.hypot(f.x, f.z);
    if (panic && rc0 < PANIC_R && rc0 > 1e-3) {
      // engine noise: bolt away from the landing site
      tx = f.x + (f.x / rc0) * 30;
      tz = f.z + (f.z / rc0) * 30;
      sp = RUN;
    } else if (deployed() && dd < FLEE_R && dd > 1e-3) {
      tx = f.x + (ddx / dd) * 20;
      tz = f.z + (ddz / dd) * 20;
      sp = RUN;
    } else if (Math.hypot(f.tx - f.x, f.tz - f.z) < 1.5 || rnd() < 0.003) {
      const c = s.herds[f.herd];
      f.tx = clamp(c.x + (rnd() - 0.5) * 44, -LIMIT, LIMIT);
      f.tz = clamp(c.z + (rnd() - 0.5) * 44, -LIMIT, LIMIT);
      tx = f.tx; tz = f.tz;
    }
    const rc = Math.hypot(f.x, f.z);
    if (rc < CORE_KEEP_OUT && rc > 1e-3) {
      tx = (f.x / rc) * (CORE_KEEP_OUT + 8);
      tz = (f.z / rc) * (CORE_KEEP_OUT + 8);
    }
    if (Math.hypot(tx - f.x, tz - f.z) > 0.4) approach(f, tx, tz, sp, sp > WALK ? 9 : 2.5);
    f.x = clamp(f.x, -LIMIT, LIMIT);
    f.z = clamp(f.z, -LIMIT, LIMIT);
  }
}

function stepEconomy() {
  const { gen, draw } = energy();
  s.alloys += RULES.alloyTrickle * DT;
  if (gen >= draw) {
    s.cryo = Math.min(100, s.cryo + 0.25 * DT);
    if (s.cryo >= 100) s.cryoWarn = 100;
  } else {
    s.cryo = Math.max(0, s.cryo - (draw - gen) * 0.12 * DT);
    for (const th of [75, 50, 25, 0]) {
      if (s.cryo <= th && s.cryoWarn > th) {
        s.cryoWarn = th;
        event(th === 0 ? 'Cryo bank failure. Embryos lost.' : `Cryo bank integrity ${th}% — power deficit`, th <= 25 ? 'bad' : 'warn');
      }
    }
  }
}

const deployed = () => (s.phase ?? 'deployed') === 'deployed';

function step() {
  s.tick++;
  if (deployed()) stepDrone();
  stepFauna();
  if (deployed()) stepEconomy();
}

function landing(stage: 'burn' | 'touchdown' | 'deploy') {
  if (deployed()) return;
  if (stage === 'burn') {
    s.panic = Math.max(s.panic ?? 0, 16 * TICK_HZ);
  } else if (stage === 'touchdown' && s.phase === 'descent') {
    s.phase = 'landed';
    s.panic = Math.max(s.panic ?? 0, 10 * TICK_HZ);
    event('Touchdown. Cryo bank on reserve power — 2.3 MW deficit.', 'warn');
  } else if (stage === 'deploy') {
    if (s.phase === 'descent') landing('touchdown');
    s.phase = 'deployed';
    event('Worker drone deployed. Build a solar array to stabilize the cryo bank.');
  }
}

function snapshot() {
  const fa = new Float32Array(s.fauna.length * 3);
  s.fauna.forEach((f, i) => { fa[i * 3] = f.x; fa[i * 3 + 1] = f.z; fa[i * 3 + 2] = f.heading; });
  const d = s.drone;
  const t = d.task;
  let tx = d.x, tz = d.z;
  if (t.kind === 'move') { tx = t.x; tz = t.z; }
  else if (t.kind === 'build') {
    const site = s.buildings.find((b) => b.id === t.siteId);
    if (site) { tx = site.x; tz = site.z; }
  }
  const { gen, draw } = energy();
  const snap: Snapshot = {
    type: 'snap', tick: s.tick,
    drone: { x: d.x, z: d.z, heading: d.heading, tx, tz, moving: t.kind !== 'idle', building: t.kind === 'build' },
    deployed: deployed(),
    fauna: fa, buildings: s.buildings.map((b) => ({ ...b })),
    alloys: s.alloys, cryo: s.cryo, gen, draw,
  };
  post(snap, [fa.buffer]);
}

function handle(msg: ToWorker) {
  switch (msg.type) {
    case 'cmd': {
      const c = msg.cmd;
      if (c.type === 'landing') { landing(c.stage); snapshot(); return; }
      if (!deployed()) return;
      const x = clamp(c.x, -LIMIT, LIMIT), z = clamp(c.z, -LIMIT, LIMIT);
      if (c.type === 'move') {
        s.drone.task = { kind: 'move', x, z };
      } else if (c.type === 'build') {
        if (s.alloys < SOLAR.cost) { event(`Not enough alloys (${SOLAR.cost} needed)`, 'warn'); return; }
        if (s.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < (b.kind === 'core' ? CORE.clearance : SOLAR.clearance))) {
          event('Site blocked', 'warn');
          return;
        }
        s.alloys -= SOLAR.cost;
        const id = s.nextId++;
        s.buildings.push({ id, kind: 'solar', x, z, progress: 0 });
        s.drone.task = { kind: 'build', siteId: id };
        event(`${SOLAR.name} queued · drone en route`);
      }
      return;
    }
    case 'speed':
      speed = msg.speed;
      return;
    case 'save':
      post({ type: 'saved', reqId: msg.reqId, state: s });
      return;
    case 'load':
      if (msg.state?.version !== 1) { event('Save is from an incompatible version', 'bad'); return; }
      s = msg.state;
      // a save made mid-landing resumes on the ground
      if (!deployed()) { s.phase = 'deployed'; s.panic = 0; }
      snapshot();
      event('Save restored');
      return;
    case 'new':
      newGame(msg.seed);
      snapshot();
      return;
  }
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => handle(e.data);

newGame(1337);
snapshot();

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  let stepped = false;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (let i = 0; i < speed; i++) { step(); stepped = true; }
  }
  if (stepped) snapshot();
}, TICK_MS / 2);
