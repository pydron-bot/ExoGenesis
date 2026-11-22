/**
 * Simulation data contract. Everything in SimState is plain data so it can be
 * structured-cloned to/from the worker and written straight into IndexedDB.
 */

import type { PeopleCommand, PeopleSnap, PeopleState } from './people-types';

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
/**
 * Half-width of the region being played, in world units (~1 unit = 10 m). Each
 * region picks its own size (content `size`, 240 u when it has none);
 * `setRegionHalf` (called by world/planet.ts `setRegionTerrain`) sets it, in
 * every thread, before anything sizes a grid from it. A live binding: read it
 * where it's used, don't copy it into a module-level constant.
 */
export let REGION_HALF = 120;
/** The size a region has when it doesn't say (and the skirmish's). */
export const DEFAULT_REGION_SIZE = 240;
/** Fog of war grid: FOG_N² cells of FOG_CELL units, row-major by z then x. */
export const FOG_CELL = 4;
export let FOG_N = Math.ceil((REGION_HALF * 2) / FOG_CELL);
export function setRegionHalf(half: number) {
  REGION_HALF = half;
  FOG_N = Math.ceil((half * 2) / FOG_CELL);
}
/** Hostile render slots (shared buffer layout with the skirmish renderer). */
export const MAX_HOSTILES = 400;

// Balance numbers (costs, power, build times, sol length...) live in /content;
// see src/content/defs.ts.

/** A building; `kind` is its content id (content/buildings/<kind>.json). */
export interface Building {
  id: number;
  /** Skirmish: the local player has seen it (an enemy building stays on its map from then on, as last seen). */
  seen?: boolean;
  /** Owner (skirmish player index); unset = player 0, the local player (the campaign never sets it). */
  team?: number;
  /** Wardens' cooldown (Autonomist-led colonies: the people inside fight back). */
  mcd?: number;
  /** Reactor out of fuel (warned once until it has some again). */
  starved?: boolean;
  kind: string;
  x: number;
  z: number;
  /** Facing (radians, region heading: 0 = +z). Walls run along it; a bay's door faces the opposite way. */
  yaw?: number;
  /** 0..1 construction progress; 1 = online. */
  progress: number;
  hp: number;
  /** Player's power switch. */
  on: boolean;
  /** Got power this tick (computed). */
  powered: boolean;
  /** Turret: seconds until it can fire; aim yaw. */
  cd?: number;
  aim?: number;
  /** Shooter has a target in range (draws full power; otherwise standby). */
  engaged?: boolean;
  /** Depot: deposit index being mined (-1 none). */
  mining?: number;
  /** Factory: unit ids (content/units) waiting to be produced; the first is in progress. */
  queue?: string[];
  /** Factory: 0..1 progress on queue[0]. */
  prod?: number;
  /** Shield projector: charge (hp the dome can still soak), and whether it's collapsed (back up at 30%). */
  sh?: number;
  shDown?: boolean;
  /** A faction outpost: the story flag set when it is destroyed. */
  flag?: string;
  /** A faction outpost the story disabled (the outpost effect): it stands, but doesn't shoot or work. */
  off?: boolean;
  /** A turret the Clause has turned (a glitch): faces `aim` until tick `until`, holding fire. */
  slew?: { until: number; aim: number; was?: number };
}

export type DroneTask =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'build'; siteId: number }
  | { kind: 'repair'; id: number };

export interface Drone {
  id: number;
  /** Owner (see Building.team). */
  team?: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  task: DroneTask;
  /** Player gave this order: don't auto-assign until it's done. */
  manual?: boolean;
}

export interface Creature {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  herd: number;
  /** Wildlife species (content/wildlife id). Old saves lack it: the herd's is filled in on load. */
  sp?: string;
  /** 0 calm, 1 running, 2 hidden (a burrower underground). */
  st?: number;
  /** Ticks left to pause (skittish), or to stay hidden (burrowers). */
  wait?: number;
  /** A flyer's angle round its herd's centre. */
  ang?: number;
}

export interface Hostile {
  id: number;
  /** Unit content id (swarmer, brute...). */
  unit: string;
  /** Render slot. */
  slot: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  /** Entity id it's after (building or drone), -1 none. */
  target: number;
  cd: number;
  pack: number;
  /** Stuck against something (a wall) and chewing through it: keep this target till it's gone. */
  chew?: boolean;
  /** Burrower travelling underground: unseen (radar still shows it), untargetable, passes under walls. */
  under?: boolean;
  best?: number;
  stall?: number;
  /** Waypoints round water toward `goal` (ground fauna); re-planned at `repath`, last planned at `planned`. */
  path?: number[];
  goal?: [number, number];
  repath?: number;
  planned?: number;
  /** A nest (unit `nest`): never moves; `spawn` is its predator spawn index. */
  nest?: number;
  /** Hit points at the last tick (nests release guards when hurt). */
  lastHp?: number;
  /** A relic: its grid id. */
  relic?: string;
  /** Relic not active: inert and untargetable (asleep, stood down or powered off). */
  dormant?: boolean;
  /** A Field Engineer's re-tuning of a grid node, 0..1. */
  tune?: number;
  /**
   * A guard (story spawn or map encounter): it stays within `r` of its post and
   * only goes after what comes near; with a `route` it walks it (x, z pairs), leg by leg.
   */
  guard?: { x: number; z: number; r: number; route?: number[]; leg?: number };
  /** The map encounter it belongs to (region `encounters` id). */
  enc?: string;
}

/** A predator spawn's nest: the hostile id while it stands, or when it regrows. */
export interface NestState { spawn: number; id: number; regrow: number }

/** Relic grids (woke, open) and their caches. */
export interface RelicState {
  grids: Record<string, { woke: boolean; open: boolean }>;
  caches: { x: number; z: number; grid: string; alloys: number; isotopes: number; opened: boolean; found?: boolean }[];
}

/** A wreck from an earlier run (region `wrecks`): salvage left, and whether we've seen it. */
export interface Wreck { x: number; z: number; yaw: number; alloys: number; max: number; found?: boolean }

/**
 * A player combat unit (Rover, Tank...). Orders: `move` walks there ignoring
 * enemies except to shoot what's in range on the way; `idle` guards `gx/gz`,
 * chasing hostiles within aggro of it, then walks back.
 */
export interface Unit {
  id: number;
  /** Owner (see Building.team). */
  team?: number;
  /** Unit content id (rover, tank). */
  unit: string;
  /** Render slot (shared pool with hostiles). */
  slot: number;
  x: number;
  z: number;
  heading: number;
  hp: number;
  cd: number;
  order: { kind: 'idle' } | { kind: 'move'; x: number; z: number };
  /** Guard post: where it returns to after a chase. */
  gx: number;
  gz: number;
  /** Hostile id it's shooting at (-1 none). */
  target: number;
  /** Where its gun points (world yaw, as `heading`) while it has a target; unset = along the hull. Drawn only (turrets). */
  aim?: number;
  /** Repairers: id of the unit or building being repaired (-1 none). */
  fix?: number;
  /** Waypoints being followed (flat x, z pairs) toward `goal`; re-planned every few seconds. */
  path?: number[];
  goal?: [number, number];
  repath?: number;
  /** Stuck detection: closest it has got to the goal, and ticks since it last improved. */
  best?: number;
  stall?: number;
  /** Heading for this transport's id to board it. */
  ride?: number;
  /** A transport: the units aboard (off the map: no slot, not in the unit list). */
  cargo?: Unit[];
  /** A transport ordered to land its cargo: where (on land) they're going, and the water nearest it (wx, wz). */
  drop?: { x: number; z: number; wx: number; wz: number };
  /** A medevac: colonist ids aboard. */
  pax?: number[];
  /** A shield unit (Aegis): charge, and whether its bubble has dropped (back up at 30%). */
  sh?: number;
  shDown?: boolean;
  /** Its ability (UnitDef.ability): seconds of cooldown left, and of the effect left. */
  ab?: number;
  abT?: number;
  /** An instant ability (pulse, mend) armed by a command, to go off in the next fight step. */
  abFire?: boolean;
  /** A faction's patrol: the far end (x, z); it walks between its post and here while it has nothing to fight. */
  patrol?: [number, number];
  /** The map encounter it belongs to (a campaign faction's; region `encounters` id). */
  enc?: string;
}

/** A campaign faction on the region (region `factions`; team 1 is the Clause's corrupted units). */
export interface FactionState {
  id: string; name: string; color: string; team: number;
  attitude: 'neutral' | 'hostile' | 'allied';
  /** Flags that have already turned it (its hostile / allied flag acts once). */
  done?: string[];
}

/** One of the inhabitants at a camp (walker, or the elder who keeps to the centre). */
export interface Native {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  /** Seconds to stand before picking a new spot. */
  wait: number;
  elder?: boolean;
  /** Gone to fight for the colony (asked-for hunters) until this tick; `cd`: seconds to their next blow. */
  hunt?: number;
  cd?: number;
}

export type ContactChoice = 'approach' | 'avoid' | 'drive';

/** An inhabitant camp (region map `camps`, group = content/inhabitants/<id>.json). */
export interface Camp {
  group: string;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
  /** 0..100: what they think of the colony. They leave at 0. */
  regard: number;
  /** First contact happened (the camp came into sight). */
  met: boolean;
  /** First contact is waiting for the player's choice. */
  pending: boolean;
  choice?: ContactChoice;
  /** Regard reached the group's trustAt: they warn of packs and share sight of their land. */
  trusted: boolean;
  /** The trust story has played (it plays once). */
  sang?: boolean;
  /** The "uneasy" warning was given (cleared once regard recovers). */
  uneasy?: boolean;
  /** They left (driven off, or regard hit 0). The camp stands empty. */
  gone: boolean;
  natives: Native[];
  /** Ready to trade again / to be asked a favour again at this tick. */
  tradeAt?: number;
  helpAt?: number;
  /** Their lookouts watch for us until this tick. */
  watchUntil?: number;
  /** Seconds to their next blow at a predator on their land (trusted camps that defend it). */
  dcd?: number;
}

/** Story events (content/story): what has fired, been answered, flags, cards waiting. */
export interface StoryState {
  fired: string[];
  answered: string[];
  flags: string[];
  /** Cards waiting to be shown/answered, oldest first. */
  inbox: string[];
  /** Triggered events waiting out their delay. */
  timers: { id: string; at: number }[];
  /** Cinematics that have played (by their own trigger). */
  cines?: string[];
  /** Cinematics waiting to play, oldest first (the renderer plays them, then says so). */
  cineQueue?: string[];
  /** Named counters (counter effects; counter conditions). */
  counters?: Record<string, number>;
  /** Countdowns running: name, the tick it runs out, what the HUD shows. */
  countdowns?: { id: string; at: number; text: string }[];
  /** Countdowns that have run out. */
  expired?: string[];
  /** Building and unit ids taken out of the build menus (lock / unlock effects). */
  locked?: string[];
  /** Waypoints: story sites marked on the ground and the minimap. */
  marks?: { site: string; x: number; z: number; text: string }[];
  /** The tutorial hint showing (HUD target, text); `n` counts hints so the HUD notices a new one. */
  hint?: { target: string; building?: string; text: string; n: number } | null;
  /** The last camera move asked for (`n` counts them). */
  look?: { x: number; z: number; n: number };
  /** Parts of the HUD the player has opened (`opened` conditions), e.g. 'build', 'select:solar'. */
  opened?: string[];
  /** Building kinds the player has placed (`placed` conditions). */
  placed?: string[];
  /** Map encounters that have appeared. */
  encounters?: string[];
  /** Colony modifiers running (story boosts: dilemma choices, inhabitants' gifts); until = tick, −1 for good. */
  mods?: import('./mods').ModBoost[];
  /** The tick the last colony dilemma fired (they wait their turn). */
  lastDilemma?: number;
  /** Who each fired card is about (its `cast`): {who} in its text. */
  cast?: Record<string, { id: number; name: string; line: string }>;
  /** Dilemmas that can come again, and the tick they re-arm. */
  again?: { id: string; at: number }[];
  /** Orbital strikes on their way: where, the tick they hit, damage and radius. */
  strikes?: { x: number; z: number; at: number; amount: number; r: number }[];
  /** The last strike that landed (`n` counts them, so the renderer draws each once). */
  struck?: { x: number; z: number; r: number; n: number };
  /** The last presentation glitch; `n` counts glitches, `tears` the screen tears (the renderer plays each once). */
  glitch?: { kind: string; n: number; tears?: number };
  /** Growth pods paused by the Clause until this tick. */
  podPause?: number;
  /** The game ended with an epilogue: its ending, pages and a summary of the run. */
  epilogue?: Epilogue;
  /** Events (and `cine:<id>` cinematics) started while their region wasn't being played: they fire there (campaign travel). */
  away?: string[];
}

/** An epilogue (the epilogue effect): pages to show, then the end screen with the ending and the run in numbers. */
export interface Epilogue {
  ending: string;
  pages: { title?: string; text: string }[];
  sols: number; colonists: number; planet: number | null; allies: string[]; deaths: number;
}

/**
 * Campaign travel (STORY.md §13, src/sim/campaign.ts): where the campaign has been and where it can go. Shared by
 * every region, with the story, missions and research (`SharedState`).
 */
export interface CampaignInfo {
  /** Regions played at least once (the one being played included). */
  visited: string[];
  /** Regions the player can travel to (`route` effects). */
  routes: string[];
  /** The first pod-born colonist (the Firstborn), for {first} away from home. */
  first?: { id: number; name: string };
  /** The home colony as it last stood (refreshed while Touchdown is played): what expeditions read for its people. */
  home?: HomeStats;
  /** The autopilot's trips to each region that ended with its missions there still under way (src/sim/autopilot.ts). */
  pilotTrips?: Record<string, number>;
}

/** A snapshot of the home colony for the rest of the campaign (`CampaignInfo.home`, TECH.md "Story engine, round three"). */
export interface HomeStats {
  /** Planet health 0..100. */
  planet: number;
  /** Adults' average acceptance of the AI (null with no adults). */
  acceptance: number | null;
  /** Adults by stance. */
  autonomists: number;
  partners: number;
  devoted: number;
  /** Colonists alive (children too), and the dead (not those who left). */
  colonists: number;
  deaths: number;
  /** Sols played at home (sol 1 = the landing day). */
  sols: number;
  /** Inhabitant groups at home: their best regard (camps still there), the lowest among those met, met, trusted. */
  groups: Record<string, { regard: number; low: number; met: boolean; trusted: boolean }>;
}

/** Missions (content/missions): which are under way, done, and which objectives are met. */
export interface MissionState {
  active: string[];
  done: string[];
  /** Per mission: indexes of its objectives already met (they stay met). */
  marks: Record<string, number[]>;
  /** Missions that failed (their fail conditions were met while under way). */
  failed?: string[];
}

export interface MissionSnap { id: string; marks: boolean[] }

/** The story as the HUD (and the story inspector) sees it. */
export interface StorySnap {
  inbox: string[];
  flags: string[];
  /** The first pod-born colonist's name, for {first} in story text. */
  first?: string;
  cine?: string[];
  counters: Record<string, number>;
  /** Countdowns running: seconds left. */
  countdowns: { id: string; left: number; text: string }[];
  locked: string[];
  marks: { site: string; x: number; z: number; text: string }[];
  hint: { target: string; building?: string; text: string; n: number } | null;
  look?: { x: number; z: number; n: number };
  /** Who each card waiting is about (event id → name, line), for {who} and {whoLine}. */
  who?: Record<string, { name: string; line: string }>;
  /** Colony modifiers running from the story: what, how much, seconds left (−1 = for good). */
  boosts?: { text: string; stat: string; amount: number; left: number }[];
  /** For the inspector: events fired and answered, delays waiting, countdowns run out. */
  fired: string[];
  answered: string[];
  timers: { id: string; left: number }[];
  expired: string[];
  /** Orbital strikes on their way (seconds left), the last that landed, the last glitch, the epilogue. */
  strikes?: { x: number; z: number; left: number; r: number }[];
  struck?: { x: number; z: number; r: number; n: number };
  glitch?: { kind: string; n: number; tears?: number };
  epilogue?: Epilogue;
}

export interface Deposit { x: number; z: number; alloys: number; max: number }

/** An isotope seam (region `seams`): what's left to mine. */
export interface Seam { x: number; z: number; isotopes: number; max: number }

/** Research done, and the one under way at the Tech Lab. */
export interface ResearchState { done: string[]; active: { id: string; progress: number } | null }

/** Planet health (src/sim/planet.ts): scars (healable, by place), lasting harm, what's been restored, reports sent. */
export interface PlanetState {
  scars: { x: number; z: number; a: number }[];
  harm: number;
  restored: number;
  /** Planet health in each Biosphere Report sent so far (one per sol). */
  reports: number[];
  /** The sol the last report covered (reports go out as each sol ends). */
  sol?: number;
}

export interface PlanetSnap {
  health: number;
  start: number;
  restored: number;
  harm: number;
  /** Biomass per second the seed banks are spending. */
  use: number;
  scars: { x: number; z: number; a: number }[];
  reports: number[];
}

export interface Pack { id: number; size: number; announced: boolean; alive: number; from: string }

import type { Chronicle } from './chronicle';
/** A log line's look: the Clause's cold monospace, the autopilot's assists. */
export type LogStyle = 'clause' | 'assist';
export interface SimState {
  /** Region id (content/regions/<id>.json); older saves are Touchdown. */
  region?: string;
  version: 2;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  alloys: number;
  /** Cryo bank integrity, 0..100. */
  cryo: number;
  cryoWarn: number;
  /** Battery charge, MJ. */
  stored: number;
  drones: Drone[];
  buildings: Building[];
  herds: { x: number; z: number; sp?: string }[];
  fauna: Creature[];
  deposits: Deposit[];
  hostiles: Hostile[];
  /** Player combat units (absent in saves from before units existed). */
  units?: Unit[];
  /** Nests at the predator spawns (absent in older saves: grown on load). */
  nests?: NestState[];
  /** Wrecks to salvage (absent in older saves: set up from the region on load). */
  wrecks?: Wreck[];
  /** Exotic isotopes in store (absent in older saves). */
  isotopes?: number;
  /** The autopilot's notes on this region (src/sim/autopilot.ts): sites where the one it sent was lost on the way. */
  pilot?: { lost: Record<string, number> };
  /** Isotope seams (absent in older saves: set up from the region on load). */
  seams?: Seam[];
  /** Research (absent in older saves). */
  research?: ResearchState;
  /** Relic grids (absent in older saves: set up from the region on load). */
  relics?: RelicState;
  /** Planet health (absent in older saves: starts fresh). */
  planet?: PlanetState;
  /** Fog of war: cells ever seen, one '0'/'1' per cell (absent in older saves). */
  explored?: string;
  packs: Pack[];
  /** Next pack index and the tick it arrives; attackers spawned so far. */
  /** `held`: the schedule a story pack interrupted while waves were held off (peaceful), put back after it. */
  waves: { n: number; next: number; spawned: number; warned?: number; held?: number };
  /** Drone fabrication at the Core. */
  fab: { queued: number; progress: number; free?: boolean };
  /** Landing sequence: 'descent' until touchdown, 'landed' until the drone is out, then 'deployed'. */
  phase: 'descent' | 'landed' | 'deployed';
  /** Ticks of engine-noise panic left: grazers near the core bolt. */
  panic: number;
  /** Missions (absent in older saves: caught up quietly on load). */
  missions?: MissionState;
  /** Story events (absent in older saves: starts fresh). */
  story?: StoryState;
  /** Inhabitant camps (absent in saves from before inhabitants existed: set up from the region on load). */
  camps?: Camp[];
  /** The frontier: threats to outlying holdings and their standing orders (absent in older saves: starts fresh). */
  frontier?: import('./frontier').FrontierState;
  /** Colonists, embryos, pods, food, Trust (absent in saves from before people existed). */
  people?: PeopleState;
  /** The Chronicle's record (campaign; src/sim/chronicle.ts). */
  chronicle?: Chronicle;
  /** Set when the game ends: lost ('core', 'cryo', 'people', 'story': a fail effect or mission), or won (a win effect). */
  over: null | 'core' | 'cryo' | 'people' | 'story' | 'won';
  /** The end screen's text for 'story' and 'won'. */
  overText?: string;
  stats: SimStats;
  /**
   * Skirmish: every player, index = team (absent in the campaign). Player 0 is the local player and keeps its
   * economy in the top-level fields (alloys, isotopes, stored, research, fab, stats); the others keep theirs in `econ`.
   */
  players?: PlayerState[];
  /** Skirmish rules (absent in the campaign). */
  skirmish?: { fog: boolean; packs: boolean; unitCap?: number };
  /** Campaign factions on this region, and the Clause's team once it turns units (absent: none). */
  factions?: FactionState[];
  /** Campaign travel: visited regions and routes (absent in a skirmish; older saves start one). */
  campaign?: CampaignInfo;
  /** An expedition without colonists: no cryo bank, people or pods here (a region's `expedition`). */
  expedition?: boolean;
  /** A `travel` effect asked to go to this region (the renderer saves and goes). */
  travel?: string;
}

/** How a skirmish starts (Sim.newSkirmish). */
export interface SkirmishSetup {
  seed: number;
  players: { name: string; color: string; side?: number; ai?: PlayerState['ai'] }[];
  /** Starting alloys, each. */
  alloys: number;
  wildlife?: boolean;
  packs?: boolean;
  /** Fog of war (default on). */
  fog?: boolean;
  /** Start spots (default: `skirmishHomes`), and the map's deposits (default: the region's). */
  homes?: { x: number; z: number }[];
  deposits?: { x: number; z: number; alloys: number; max: number }[];
}

export type SimStats = { kills: number; buildingsLost: number; dronesLost: number; packsBeaten: number; mined: number; unitsLost?: number; nestsDestroyed?: number; salvaged?: number; isotopesMined?: number; researched?: number; relicsDown?: number; unitsBuilt?: number; enemyKills?: number; printed?: number };

/** A computer player's memory: waves sent, the raid under way (unit ids, whose base, when, how big), its rally point. */
export interface AiBrain {
  wave: number; attack: number[]; target: number; launched: number; size: number; rally: { x: number; z: number } | null;
  /** The raid's stage: forming up at `stage`, or pushing in. */
  phase?: 'gather' | 'push';
  stage?: { x: number; z: number };
  /** A raiding party (unit ids); the scout (unit id; -2 once done). */
  raid?: number[];
  scout?: number;
  /** Enemy buildings seen (by id), and the strongest army seen of each player lately. */
  known?: Record<number, { kind: string; x: number; z: number; team: number; hp: number }>;
  armies?: Record<number, { st: number; at: number }>;
}

/** One player's own economy (skirmish players other than 0). */
export interface Econ {
  alloys: number;
  isotopes: number;
  stored: number;
  research: ResearchState;
  fab: SimState['fab'];
  stats: SimStats;
}

export interface PlayerState {
  name: string;
  /** Players on the same side are allies (free-for-all: everyone on their own side). */
  side: number;
  /** Team colour (CSS hex). */
  color: string;
  /** A computer player, and how hard it plays; unset = a human. */
  ai?: 'easy' | 'normal' | 'hard';
  /** Lost its Command Core: out of the game. */
  out?: boolean;
  /** Where it started (its Command Core). */
  home: { x: number; z: number };
  /** A computer player's memory (src/sim/ai.ts). */
  brain?: AiBrain;
  econ?: Econ;
}

export type LandingStage = 'burn' | 'touchdown' | 'deploy';

export type Command =
  | { type: 'move'; drone: number; x: number; z: number }
  | { type: 'build'; kind: string; x: number; z: number; yaw?: number }
  /** A line of segments (walls) from (x1, z1) to (x2, z2). */
  | { type: 'buildLine'; kind: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'repair'; id: number }
  | { type: 'power'; id: number; on: boolean }
  | { type: 'demolish'; id: number }
  | { type: 'fab' }
  /** Factory: queue a unit, or drop the last queued one. */
  | { type: 'produce'; id: number; unit: string }
  | { type: 'research'; id: string }
  | { type: 'unresearch' }
  | { type: 'unqueue'; id: number }
  /** Combat units: move (spread out around the point), or stop and guard where they stand. */
  | { type: 'order'; ids: number[]; x: number; z: number }
  /** Ground units go aboard a transport (it comes in to meet them); `unload` lands a transport's cargo at the nearest shore. */
  | { type: 'board'; ids: number[]; transport: number }
  | { type: 'unload'; ids: number[] }
  | { type: 'stop'; ids: number[] }
  /** Combat units: go for one target (a campaign faction's unit or building; a neutral one turns hostile). */
  | { type: 'attack'; ids: number[]; target: number }
  /** Combat units: use their ability (UnitDef.ability), each that has one ready. */
  | { type: 'ability'; ids: number[] }
  /** Skirmish: give up (your side loses you; the game goes on for the others). */
  | { type: 'surrender' }
  | { type: 'landing'; stage: LandingStage }
  /** A story card answered: the choice's index (0 for Continue). */
  | { type: 'story'; id: string; choice: number }
  /** The player opened a part of the HUD (tutorial `opened` conditions): 'build', 'people', 'select:solar'… */
  | { type: 'ui'; what: string }
  /** The story inspector (play tests): set or clear a flag, change a counter, finish an objective or mission, jump the clock, end a countdown. */
  | { type: 'inspect'; flag?: string; unflag?: string; counter?: { id: string; value: number }; objective?: { mission: string; index: number }; finish?: string; fail?: string; skip?: number; expire?: string; unlock?: string; route?: string; unroute?: string }
  /** Campaign travel: forget a travel request (a play test can't travel). */
  | { type: 'travelled' }
  /** First contact with an inhabitant camp: the player's answer. */
  | { type: 'contact'; camp: number; choice: ContactChoice }
  /** A holding's standing order (the frontier). */
  | { type: 'standing'; sector: string; order: import('./frontier').StandingOrder }
  /** Neighbours: a trade (`n` = which), or a favour from a camp that trusts us. */
  | { type: 'neighbour'; camp: number; act: 'trade' | 'guide' | 'watch' | 'hunters'; n?: number }
  | PeopleCommand
  /** Playtesting / tests: spawn the next pack now, add alloys, damage a building, or drop in hostiles or combat units. */
  | { type: 'cinematic'; id: string; done: true }
  | { type: 'debug'; setup?: PlaySetup; mission?: string; story?: string; cinematic?: string; regard?: { camp: number; value: number }; wave?: boolean; alloys?: number; hurt?: { id: number; hp: number }; spawn?: { unit: string; x: number; z: number; n?: number }; units?: { unit: string; x: number; z: number; n?: number }; people?: { colonists?: number; biomass?: number; stance?: number; wb?: number } };

/**
 * The editor's play test setup ("simulate to here"): jump the clock, put
 * finished buildings round the Core, add colonists, alloys and story flags,
 * optionally hold off the predators. Applied once, as the colony deploys.
 */
export interface PlaySetup { sol?: number; alloys?: number; isotopes?: number; colonists?: number; buildings?: string[]; flags?: string[]; research?: string[]; peaceful?: boolean }

export type ToWorker =
  /** First message: the region to play (`def` = an unsaved editor draft for a play test). */
  | { type: 'init'; region: string; def?: import('../content/defs').RegionDef; story?: { id: string; def: import('../content/defs').StoryDef }; mission?: { id: string; def: import('../content/defs').MissionDef }; cinematic?: { id: string; def: import('../content/defs').CinematicDef }; skirmish?: SkirmishSetup; shared?: import('./campaign').SharedState }
  | { type: 'cmd'; cmd: Command; team?: number }
  | { type: 'speed'; speed: number }
  | { type: 'save'; reqId: number }
  | { type: 'load'; state: SimState }
  | { type: 'new'; seed: number }
  /** Story content edited while playing (dev: the story inspector's live reload): these collections replace the worker's. */
  | { type: 'content'; patch: Record<string, Record<string, unknown>> }
  /** Autosave to IndexedDB every few seconds while on; `flush` saves right now. */
  | { type: 'autosave'; on: boolean }
  | { type: 'flush' }
  /** Campaign travel: save this region and make `to` the campaign's current region; answered with 'travelled'. */
  | { type: 'travel'; to: string }
  /** The autopilot on or off, and how it plays (src/sim/autopilot.ts). */
  | { type: 'pilot'; cfg: import('./autopilot').PilotConfig };

export interface DroneSnap {
  id: number; x: number; z: number; heading: number; tx: number; tz: number;
  moving: boolean; working: boolean; hp: number; task: DroneTask['kind']; manual: boolean;
  /** Owner (skirmish; unset = you). */
  team?: number;
}

export interface UnitSnap {
  id: number; unit: string; slot: number; x: number; z: number; hp: number;
  /** Owner (skirmish; unset = you). */
  team?: number;
  order: Unit['order']['kind']; tx: number; tz: number; engaged: boolean;
  /** A transport: how many are aboard. */
  cargo?: number;
  /** On its way to board a transport. */
  boarding?: boolean;
  /** A medevac: colonists aboard. */
  pax?: number;
  /** A shield unit: charge 0..1, bubble radius, and whether the bubble is up. */
  sh?: number;
  shR?: number;
  shUp?: boolean;
  /** Its ability: seconds until ready (0 = ready), and seconds the effect has left (absent when none). */
  abCd?: number;
  abOn?: number;
}

export interface CampSnap {
  group: string; x: number; z: number; yaw: number; regard: number;
  met: boolean; pending: boolean; choice: ContactChoice | null; trusted: boolean; gone: boolean;
  /** Colony buildings standing on their land (loud ones count three times). */
  encroaching: number;
  /** Seconds until they will trade again / do us another favour; lookouts' seconds left; hunters out fighting for us. */
  tradeIn: number;
  helpIn: number;
  watch: number;
  hunting: number;
  /** Can we trade with them (they trust us, or we speak their language)? */
  canTrade: boolean;
}

export interface Snapshot {
  type: 'snap';
  tick: number;
  /** Skirmish players (absent in the campaign). */
  /** Combat units you may have (absent: the colony rules' maxUnits). */
  unitCap?: number;
  /** Worker drones allowed (campaign; absent: the colony rules' maxDrones). */
  droneCap?: number;
  /** Colony modifiers in force (research and story boosts summed; campaign only). */
  mods?: Partial<Record<string, number>>;
  players?: { name: string; color: string; side: number; ai?: PlayerState['ai']; out: boolean; home: { x: number; z: number }; stats: SimStats }[];
  /** Game seconds since landing. */
  secs: number;
  /** False until the landing sequence has put the drone on the ground. */
  deployed: boolean;
  drones: DroneSnap[];
  /** x, z, heading, species index × 4 + state (0 calm, 1 running, 2 hidden) per creature; species index into nature.ts wildlifeIds(). */
  fauna: Float32Array;
  buildings: Building[];
  deposits: Deposit[];
  /** Wrecks (all of them; the renderer hides unexplored ones under the fog). */
  wrecks: Wreck[];
  seams: Seam[];
  isotopes: number;
  /** Relic caches (shown once sighted). */
  caches: RelicState['caches'];
  research: ResearchState;
  /** Nests standing / regrowing, by spawn. */
  nests: { x: number; z: number; alive: boolean }[];
  /** Hostiles in the skirmish renderer's layout (see skirmish/types STRIDE / F). Only ones in sight. */
  army: Float32Array;
  /** Fog of war, FOG_N² cells: 0 never seen, 1 seen before, 2 in sight now. */
  fog: Uint8Array;
  /** Radar blips: x, z of every hostile on the map (empty without a powered radar). */
  blips: Float32Array;
  armySlots: number;
  /** Effects this tick (skirmish FX layout). */
  fx: Float32Array;
  hostiles: number;
  /** Missions under way (with their objectives met so far), done and failed. */
  missions: { active: MissionSnap[]; done: string[]; failed: string[] };
  /** Story cards waiting (ids, oldest first) and flags set. */
  /** `first`: the first pod-born colonist's name, for {first} in story text. */
  story: StorySnap;
  /** Campaign travel (absent in a skirmish): the region being played, home, visited, routes, a travel asked for. */
  campaign?: { here: string; home: string; visited: string[]; routes: string[]; travel?: string; expedition: boolean };
  /** Inhabitant camps (structures show once explored). */
  camps: CampSnap[];
  /** Inhabitants in sight: x, z, heading, camp index, elder (1/0) per person. */
  natives: Float32Array;
  /** Player combat units (they're also in `army`, at `slot`). */
  units: UnitSnap[];
  alloys: number;
  cryo: number;
  /** MW generated / wanted / actually short for the cryo bank. */
  gen: number;
  draw: number;
  short: number;
  stored: number;
  storageMax: number;
  daylight: number;
  /** A powered radar exists. */
  radar: boolean;
  /** Seconds to the next pack (only with radar). */
  nextPack: number | null;
  /** Packs on the map: centre, members alive, seen (radar or sight). */
  packs: { x: number; z: number; alive: number; seen: boolean }[];
  fab: { queued: number; progress: number };
  people: PeopleSnap;
  planet: PlanetSnap;
  /** Outlying holdings, their standing orders, and the threat announced or under way (campaign only). */
  frontier?: ReturnType<import('./frontier').Frontier['snapshot']>;
  over: SimState['over'];
  overText?: string;
  stats: SimState['stats'];
  /** Campaign factions (absent when there are none): colour by team for the renderer. */
  factions?: FactionState[];
}

/**
 * What an event sounds like (src/audio). Sent alongside the event text so the
 * client doesn't have to match on wording; events without one stay silent.
 */
export type EventCue = 'placed' | 'online' | 'unitReady' | 'droneReady' | 'packCleared' | 'lost' | 'deny' | 'warning' | 'alarm'
  | 'birth' | 'death' | 'research' | 'confirm' | 'recycle' | 'mission' | 'objective' | 'missionDone' | 'victory'
  | 'discovery' | 'friend' | 'exhausted' | 'message' | 'missionFail' | 'defeat';

export type FromWorker =
  | Snapshot
  | { type: 'saved'; reqId: number; state: SimState }
  | { type: 'travelled'; to: string; ok: boolean }
  /** `at`: where it happened (the minimap pings it; the log line jumps the camera there). */
  | { type: 'event'; text: string; level: 'info' | 'warn' | 'bad'; cue?: EventCue; at?: { x: number; z: number }; style?: LogStyle }
  /** The autopilot: what it is doing and where to look (src/sim/autopilot.ts). */
  | { type: 'pilot'; status: import('./autopilot').PilotStatus };
