/**
 * Domination's strategy layer (DESIGN §5.12 phase 3, TECH.md "Domination: the strategy layer"): who holds which
 * area, the empire's income, building up areas, armies on the move (overland between linked areas, by launch between
 * worlds) and fights resolved from summary numbers. Plain data and pure functions, so it runs anywhere (the page,
 * tests) and the whole state is the save.
 *
 * Time is in game seconds; `stepDomination` advances it (the page calls it every frame with the speed applied).
 */
import { systemAreas, type Area } from './areas';
import { domAiThink } from './domination-ai';

export type DomLevel = 'easy' | 'normal' | 'hard';
export type DomJobKind = 'army' | 'guns' | 'develop' | 'gantry';

export interface DomJob { kind: DomJobKind; left: number; total: number }

export interface DomArea {
  id: string;
  /** Player index, or -1 for no one (natives hold it). */
  owner: number;
  /** The owner's army strength here. */
  army: number;
  /** The owner's fixed defences (guns count for a quarter more in a fight). */
  guns: number;
  /** Who holds an unclaimed area: wildlife and old defences, gone once it's taken. */
  natives: number;
  /** Development 0–3: income and what the area is worth. */
  level: number;
  /** A Launch Gantry: armies can launch from here to any other world. */
  gantry: boolean;
  /** Building, one job at a time (paid when queued). */
  queue: DomJob[];
  /** Other players' armies fighting here, by player. */
  visitors: Record<number, number>;
}

export interface DomMove { id: number; player: number; from: string; to: string; strength: number; t0: number; t1: number; launch: boolean }

export interface DomPlayer {
  name: string;
  color: string;
  ai?: DomLevel;
  alloys: number;
  out: boolean;
  outAt?: number;
  /** Next think time (computer players). */
  think?: number;
  stats: { taken: number; lost: number; built: number; peak: number };
}

export interface DomEvent { t: number; text: string; kind: 'info' | 'good' | 'bad'; area?: string }

export interface DomState {
  version: 1;
  seed: number;
  t: number;
  players: DomPlayer[];
  /** Every area, in `systemAreas` order. */
  areas: Record<string, DomArea>;
  moves: DomMove[];
  nextMove: number;
  log: DomEvent[];
  over?: { winner: number; t: number };
}

/** The numbers (all in one place for balancing). */
export const DOM = {
  startAlloys: 400,
  /**
   * Extra starting alloys by player count and start (`DOM_STARTS` order), making up for a smaller world to grow into: tuned so each
   * start wins about as often with Normal computers everywhere (tools/domination-ai-sim.mjs --only fairness).
   */
  startBonus: { 2: [0, 50], 3: [0, 200, 420], 4: [0, 200, 600, 900] } as Record<number, number[]>,
  /** Natives on a start world are this much tougher per area that world has over 5 (Home's 7 are worth more to win). */
  startWorldNatives: 0,
  start: { army: 30, guns: 30, level: 1 },
  /** Alloys a second per area: base + per level. */
  income: { base: 1, perLevel: 1 },
  aiIncome: { easy: 0.8, normal: 1, hard: 1.25 } as Record<DomLevel, number>,
  jobs: {
    army: { cost: 100, time: 20, gives: 10 },
    guns: { cost: 80, time: 15, gives: 10, max: 80 },
    gantry: { cost: 250, time: 40 },
  },
  /** Develop to level n+1: cost × (n+1), time. */
  develop: { cost: 200, time: 45, max: 3 },
  queueMax: 3,
  /** Most army a player can have (everywhere, on the move and queued): base + per area held. */
  armyCap: { base: 80, perArea: 30 },
  /** Natives on an unclaimed area: min + up to `spread` more. */
  natives: { min: 10, spread: 16 },
  /**
   * Fights are an exchange, fitted to the same battles fought in full (tools/domination-calibrate.mjs): an attacker
   * loses about what the holder is worth (army × 0.9 + guns + 15 for its Command Core) to wipe it out, whatever its own
   * size; the losses each second are `rate` × the bigger side's worth (so a fight takes about as long as in full).
   */
  rate: 0.012,
  worth: { army: 0.9, guns: 1, core: 15 },
  /** Travel: overland base + per radian of the way; launches within one planet's system, or across the system. */
  travel: { overland: 25, perRadian: 35, launchNear: 50, launchFar: 90 },
  /** The game's event list keeps this many. */
  logMax: 80,
};

export const DOM_COLORS = ['#4fd1e8', '#e8574f', '#e8b04f', '#a46be8'];
export const DOM_NAMES = ['You', 'Crimson', 'Amber', 'Violet'];
/** Where each player starts (player 0 at Touchdown). */
export const DOM_STARTS = ['home-1', 'verdance-1', 'rime-1', 'dunmore-1'];

const rng = (seed: number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** The map a state is played on: the areas, and what's needed to work out travel. */
export interface DomMap {
  list: Area[];
  byId: Record<string, Area>;
  /** The planet a body belongs to (itself, or what it orbits): launches inside one are quicker. */
  system: Record<string, string>;
}

type BodiesLike = Record<string, { parent?: string; kind?: string; areas?: number; [k: string]: unknown }>;

export function domMap(bodies: BodiesLike): DomMap {
  const list = systemAreas(bodies as never);
  const byId: Record<string, Area> = {};
  for (const a of list) byId[a.id] = a;
  const system: Record<string, string> = {};
  for (const id of Object.keys(bodies)) {
    let b = id;
    for (let i = 0; i < 4 && bodies[b]?.parent && bodies[bodies[b].parent!]; i++) b = bodies[b].parent!;
    system[id] = b;
  }
  return { list, byId, system };
}

export interface DomSetup { seed: number; players: number; ai: DomLevel }

export function newDomination(map: DomMap, o: DomSetup): DomState {
  const rnd = rng(o.seed * 104729 + 7);
  const n = Math.min(4, Math.max(2, o.players));
  const players: DomPlayer[] = Array.from({ length: n }, (_, i) => ({
    name: DOM_NAMES[i], color: DOM_COLORS[i], ai: i ? o.ai : undefined, alloys: DOM.startAlloys, out: false,
    think: i ? 3 + i : undefined, stats: { taken: 0, lost: 0, built: 0, peak: 1 },
  }));
  const areas: Record<string, DomArea> = {};
  for (const a of map.list) {
    areas[a.id] = { id: a.id, owner: -1, army: 0, guns: 0, natives: Math.round(DOM.natives.min + rnd() * DOM.natives.spread), level: 0, gantry: false, queue: [], visitors: {} };
  }
  // the start worlds' natives: tougher on the bigger ones (more there to take without a fight)
  for (const id of DOM_STARTS.slice(0, n)) {
    const body = map.byId[id]?.body, size = map.list.filter((x) => x.body === body).length;
    for (const x of map.list) if (x.body === body) areas[x.id].natives = Math.round(areas[x.id].natives * Math.max(0.6, 1 + DOM.startWorldNatives * (size - 5)));
  }
  for (let i = 0; i < n; i++) {
    const a = areas[DOM_STARTS[i]] ?? Object.values(areas).find((x) => x.owner < 0)!;
    Object.assign(a, { owner: i, army: DOM.start.army, guns: DOM.start.guns, level: DOM.start.level, natives: 0, gantry: true });
  }
  // a start on a smaller world gets alloys to make up for it
  players.forEach((pl, i) => { pl.alloys += DOM.startBonus[n]?.[i] ?? 0; });
  return { version: 1, seed: o.seed, t: 0, players, areas, moves: [], nextMove: 1, log: [{ t: 0, text: 'The war for the system begins', kind: 'info' }] };
}

// ---------- reading the state ----------
export const ownedBy = (s: DomState, p: number) => Object.values(s.areas).filter((a) => a.owner === p);
export const incomeOf = (s: DomState, p: number) => {
  const pl = s.players[p];
  const k = pl?.ai ? DOM.aiIncome[pl.ai] : 1;
  return ownedBy(s, p).reduce((m, a) => m + DOM.income.base + a.level * DOM.income.perLevel, 0) * k;
};
/** A player's army everywhere: garrisons, attacking, on the move and queued. */
export function armyOf(s: DomState, p: number) {
  let n = 0;
  for (const a of Object.values(s.areas)) {
    if (a.owner === p) n += a.army + a.queue.filter((j) => j.kind === 'army').length * DOM.jobs.army.gives;
    n += a.visitors[p] ?? 0;
  }
  for (const m of s.moves) if (m.player === p) n += m.strength;
  return n;
}
export const armyCap = (s: DomState, p: number) => DOM.armyCap.base + DOM.armyCap.perArea * ownedBy(s, p).length;
export function jobCost(a: DomArea, kind: DomJobKind): { cost: number; time: number } {
  if (kind === 'develop') { const next = a.level + 1 + a.queue.filter((j) => j.kind === 'develop').length; return { cost: DOM.develop.cost * next, time: DOM.develop.time }; }
  return { cost: DOM.jobs[kind].cost, time: DOM.jobs[kind].time };
}
/** Why `p` can't queue `kind` in `a` now, or null. */
export function cannotBuild(s: DomState, p: number, a: DomArea, kind: DomJobKind): string | null {
  if (s.over) return 'The war is over';
  if (a.owner !== p) return 'Not your area';
  if (Object.values(a.visitors).some((v) => v > 0)) return 'Under attack';
  if (a.queue.length >= DOM.queueMax) return 'Queue full';
  if (kind === 'develop' && a.level + a.queue.filter((j) => j.kind === 'develop').length >= DOM.develop.max) return 'Fully developed';
  if (kind === 'gantry' && (a.gantry || a.queue.some((j) => j.kind === 'gantry'))) return 'Has a gantry';
  if (kind === 'guns' && a.guns + a.queue.filter((j) => j.kind === 'guns').length * DOM.jobs.guns.gives >= DOM.jobs.guns.max) return 'Defences full';
  if (kind === 'army' && armyOf(s, p) + DOM.jobs.army.gives > armyCap(s, p)) return 'Army at its limit (hold more areas)';
  if (s.players[p].alloys < jobCost(a, kind).cost) return 'Not enough alloys';
  return null;
}

/** Where an army in `from` can go: linked areas on its world, and with a gantry every area on another world. */
export function destinations(map: DomMap, s: DomState, from: string): { to: string; launch: boolean }[] {
  const a = map.byId[from], here = s.areas[from];
  if (!a || !here) return [];
  const out = a.links.map((to) => ({ to, launch: false }));
  if (here.gantry) for (const b of map.list) if (b.body !== a.body) out.push({ to: b.id, launch: true });
  return out;
}

const angle = (a: Area, b: Area) => {
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180, dl = ((b.lon - a.lon) * Math.PI) / 180;
  return Math.acos(Math.min(1, Math.max(-1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl))));
};
export function travelTime(map: DomMap, from: string, to: string, launch: boolean) {
  const a = map.byId[from], b = map.byId[to];
  if (!launch) return Math.round(DOM.travel.overland + DOM.travel.perRadian * angle(a, b));
  return map.system[a.body] === map.system[b.body] ? DOM.travel.launchNear : DOM.travel.launchFar;
}

// ---------- orders ----------
const say = (s: DomState, text: string, kind: DomEvent['kind'] = 'info', area?: string) => {
  s.log.push({ t: s.t, text, kind, area });
  if (s.log.length > DOM.logMax) s.log.splice(0, s.log.length - DOM.logMax);
};

/** Queue a job (paid now). Returns why not, or null. */
export function domBuild(s: DomState, p: number, areaId: string, kind: DomJobKind): string | null {
  const a = s.areas[areaId];
  if (!a) return 'No such area';
  const no = cannotBuild(s, p, a, kind);
  if (no) return no;
  const { cost, time } = jobCost(a, kind);
  s.players[p].alloys -= cost;
  a.queue.push({ kind, left: time, total: time });
  return null;
}

/** Send `amount` of the army in `from` to `to`. Returns why not, or null. */
export function domSend(map: DomMap, s: DomState, p: number, from: string, to: string, amount: number): string | null {
  const a = s.areas[from];
  if (s.over) return 'The war is over';
  if (!a || a.owner !== p) return 'Not your area';
  const way = destinations(map, s, from).find((d) => d.to === to);
  if (!way) return 'Can\'t reach it from here';
  const n = Math.min(a.army, Math.floor(amount));
  if (n < 1) return 'No army here';
  a.army -= n;
  const t = travelTime(map, from, to, way.launch);
  s.moves.push({ id: s.nextMove++, player: p, from, to, strength: n, t0: s.t, t1: s.t + t, launch: way.launch });
  return null;
}

// ---------- the clock ----------
/** Advance the war by `dt` game seconds (in steps of at most 1 s). */
/** A computer player's brain (tests can give a player another one: tools/domination-sim.mjs compares them). */
export type DomBrain = (map: DomMap, s: DomState, p: number) => void;

export function stepDomination(map: DomMap, s: DomState, dt: number, brains?: Record<number, DomBrain>) {
  while (dt > 1e-6 && !s.over) {
    const h = Math.min(1, dt);
    tick(map, s, h, brains);
    dt -= h;
  }
}

function tick(map: DomMap, s: DomState, h: number, brains?: Record<number, DomBrain>) {
  s.t += h;
  // income and building
  s.players.forEach((pl, p) => { if (!pl.out) pl.alloys += incomeOf(s, p) * h; });
  for (const a of Object.values(s.areas)) {
    const job = a.queue[0];
    if (!job || a.owner < 0) continue;
    if (Object.values(a.visitors).some((v) => v > 0)) continue; // nothing gets built under fire
    job.left -= h;
    if (job.left > 0) continue;
    a.queue.shift();
    const pl = s.players[a.owner];
    if (job.kind === 'army') { a.army += DOM.jobs.army.gives; pl.stats.built += DOM.jobs.army.gives; }
    else if (job.kind === 'guns') a.guns = Math.min(DOM.jobs.guns.max, a.guns + DOM.jobs.guns.gives);
    else if (job.kind === 'develop') a.level = Math.min(DOM.develop.max, a.level + 1);
    else if (job.kind === 'gantry') { a.gantry = true; if (!pl.ai) say(s, `Launch Gantry ready: ${map.byId[a.id].name}`, 'good', a.id); }
  }
  // arrivals
  for (let i = s.moves.length - 1; i >= 0; i--) {
    const m = s.moves[i];
    if (m.t1 > s.t) continue;
    s.moves.splice(i, 1);
    const a = s.areas[m.to];
    if (s.players[m.player].out) continue;
    if (a.owner === m.player) a.army += m.strength;
    else {
      a.visitors[m.player] = (a.visitors[m.player] ?? 0) + m.strength;
      if (a.owner === 0 && m.player !== 0) say(s, `${s.players[m.player].name} attacks ${map.byId[a.id].name}`, 'bad', a.id);
    }
  }
  // fights
  for (const a of Object.values(s.areas)) if (Object.values(a.visitors).some((v) => v > 0)) fight(map, s, a, h);
  // who's out, who's won
  s.players.forEach((pl, p) => {
    pl.stats.peak = Math.max(pl.stats.peak, ownedBy(s, p).length);
    if (pl.out || ownedBy(s, p).length) return;
    pl.out = true;
    pl.outAt = s.t;
    s.moves = s.moves.filter((m) => m.player !== p);
    for (const a of Object.values(s.areas)) delete a.visitors[p];
    say(s, p === 0 ? 'Your last area has fallen' : `${pl.name} is wiped out`, p === 0 ? 'bad' : 'good');
  });
  const alive = s.players.map((pl, i) => (pl.out ? -1 : i)).filter((i) => i >= 0);
  if (alive.length <= 1) { s.over = { winner: alive[0] ?? -1, t: s.t }; say(s, alive[0] === 0 ? 'Victory: the system is yours' : `${s.players[alive[0]]?.name ?? 'No one'} has taken the system`, alive[0] === 0 ? 'good' : 'bad'); return; }
  // computer players
  s.players.forEach((pl, p) => {
    if (!pl.ai || pl.out || (pl.think ?? 0) > s.t) return;
    pl.think = s.t + (pl.ai === 'hard' ? 3 : pl.ai === 'normal' ? 5 : 8);
    (brains?.[p] ?? domAiThink)(map, s, p);
  });
}

/** What wiping out an area's holder costs an attacker, in strength (natives: their number). */
export function holderWorth(a: DomArea) {
  if (a.owner < 0) return a.natives;
  const n = a.army * DOM.worth.army + a.guns * DOM.worth.guns;
  return n > 0 ? n + DOM.worth.core : 0;
}

/**
 * One second of fighting in an area. Every pair of sides (the holder; each visiting army) exchanges losses: `rate` ×
 * the bigger one's worth (each side's worth: a visitor its strength, the holder `holderWorth`), split by how much of
 * each side's fire goes at the other. Each loses that much worth: the holder its army and guns in proportion. When
 * only one side is left it holds the area.
 */
function fight(map: DomMap, s: DomState, a: DomArea, h: number) {
  const sides: { p: number; worth: number }[] = [];
  const hw = holderWorth(a);
  if (hw > 0) sides.push({ p: a.owner, worth: hw });
  for (const [k, v] of Object.entries(a.visitors)) if (v > 0) sides.push({ p: Number(k), worth: v });
  if (sides.length >= 2) {
    const total = sides.reduce((m, x) => m + x.worth, 0);
    const lost = sides.map(() => 0);
    for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) {
      const wi = sides[i].worth, wj = sides[j].worth;
      const share = (wj / (total - wi) + wi / (total - wj)) / 2;
      const e = DOM.rate * h * Math.max(wi, wj) * share;
      // a holder bigger than what comes at it loses less (√ of the odds): small attacks are wasteful, as in full
      const shelter = (k: number, o: number) => (sides[k].p === a.owner && a.owner >= 0 ? Math.min(1, Math.sqrt(sides[o].worth / sides[k].worth)) : 1);
      lost[i] += e * shelter(i, j); lost[j] += e * shelter(j, i);
    }
    sides.forEach((x, j) => {
      const left = Math.max(0, x.worth - lost[j]);
      if (x.p === a.owner && a.owner >= 0) {
        // the Core's share goes last: army and guns keep what's left above it
        const k = Math.max(0, left - DOM.worth.core) / Math.max(1e-9, x.worth - DOM.worth.core);
        a.army = a.army * k < 0.5 ? 0 : a.army * k;
        a.guns = a.guns * k < 0.5 ? 0 : a.guns * k;
      } else if (x.p === a.owner) a.natives = left < 0.5 ? 0 : left;
      else a.visitors[x.p] = left < 0.5 ? 0 : left;
    });
  }
  // the outcome
  for (const [k, v] of Object.entries(a.visitors)) if (!(v > 0)) delete a.visitors[Number(k) as number];
  const holding = a.owner >= 0 ? a.army + a.guns > 0 : a.natives > 0;
  const left = Object.entries(a.visitors);
  if (holding || left.length !== 1) return;
  const [k, v] = left[0], p = Number(k), was = a.owner;
  const name = map.byId[a.id].name;
  if (was >= 0) { s.players[was].stats.lost++; if (was === 0) say(s, `${s.players[p].name} took ${name}`, 'bad', a.id); }
  s.players[p].stats.taken++;
  if (p === 0) say(s, was >= 0 ? `You took ${name} from ${s.players[was].name}` : `You took ${name}`, 'good', a.id);
  Object.assign(a, { owner: p, army: Math.round(v), guns: 0, natives: 0, level: Math.max(0, a.level - 1), gantry: false, queue: [], visitors: {} });
}
