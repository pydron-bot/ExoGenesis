/**
 * Content collections: what lives under /content and what shape each file has.
 *
 * Add a collection: define its shape here, add it to COLLECTIONS, drop JSON files
 * into content/<dir>/. The editor and the checker pick it up automatically.
 * Only add a field once the game actually reads it, so the editor never shows a
 * knob that does nothing.
 */
import { REGION_HALF } from '../sim/types';
import { bool, choice, grid, int, list, num, ref, str, type Infer, type Shape } from './schema';

export const unitShape = {
  name: str({ label: 'Name' }),
  faction: choice(['accord', 'fauna'], { label: 'Faction', help: 'Accord units are the player\'s; fauna attack them.' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  speed: num({ label: 'Speed', min: 0, max: 60, step: 0.1, unit: 'u/s', help: '1 world unit ≈ 10 m.' }),
  range: num({ label: 'Attack range', min: 0, max: 200, step: 0.1, unit: 'u' }),
  damage: num({ label: 'Damage per hit', min: 0, max: 10000 }),
  cooldown: num({ label: 'Attack cooldown', min: 0.05, max: 30, step: 0.05, unit: 's' }),
  splash: num({ label: 'Splash radius', min: 0, max: 50, step: 0.1, unit: 'u', optional: true, help: 'Units inside take half damage.' }),
  radius: num({ label: 'Body radius', min: 0.1, max: 20, step: 0.1, unit: 'u', help: 'Collision and selection size.' }),
  aggro: num({ label: 'Aggro radius', min: 0, max: 200, unit: 'u', help: 'How far it notices enemies on its own.' }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model from the asset library. Empty = the built-in procedural model.' }),
  modelScale: num({ label: 'Model scale', min: 0.1, max: 10, step: 0.05, default: 1, help: 'Gameplay size, on top of the asset\'s own scale.' }),
} satisfies Shape;
export type UnitDef = Infer<typeof unitShape>;

export const BUILDING_ROLES = ['core', 'solar', 'depot', 'battery', 'turret', 'radar'] as const;
export type BuildingRole = (typeof BUILDING_ROLES)[number];

export const buildingShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  role: choice(BUILDING_ROLES, {
    label: 'Role',
    help: 'What it does. core: the landed pod (build radius = Range). solar: power that follows daylight. depot: mines the nearest deposit within Range. battery: stores power. turret: shoots hostiles within Range. radar: early warning + minimap.',
  }),
  buildable: bool({ label: 'In build menu', default: true }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys' }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  powerMW: num({ label: 'Power', min: -100, max: 100, step: 0.1, unit: 'MW', help: 'Positive generates (solar: at noon), negative draws.' }),
  buildSeconds: num({ label: 'Build time', min: 0, max: 600, step: 0.5, unit: 's' }),
  clearance: num({ label: 'Clearance', min: 0, max: 60, step: 0.5, unit: 'u', help: 'Nothing new may be placed closer than this. Half of it is the building\'s body radius.' }),
  range: num({ label: 'Range', min: 0, max: 400, unit: 'u', optional: true, help: 'core: build radius · depot: how far it reaches for a deposit.' }),
  fireRange: num({ label: 'Firing range', min: 0, max: 400, unit: 'u', optional: true, help: 'Any building with a firing range, damage and cooldown shoots hostiles while powered (turrets; the Core\'s point defense).' }),
  damage: num({ label: 'Damage per shot', min: 0, max: 10000, optional: true }),
  cooldown: num({ label: 'Fire cooldown', min: 0.05, max: 30, step: 0.05, unit: 's', optional: true }),
  mineRate: num({ label: 'Mining rate', min: 0, max: 100, step: 0.05, unit: 'alloys/s', optional: true, help: 'Depots, while powered.' }),
  storage: num({ label: 'Storage', min: 0, max: 100000, unit: 'MJ', optional: true, help: 'Batteries. 1 MJ = 1 MW for 1 s.' }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model from the asset library. Empty = the built-in procedural model. (The Command Core\'s is fixed: the landing cinematic animates it.)' }),
} satisfies Shape;
export type BuildingDef = Infer<typeof buildingShape>;

export const colonyRulesShape = {
  startAlloys: int({ label: 'Starting alloys', min: 0, max: 100000 }),
  alloyTrickle: num({ label: 'Passive alloy income', min: 0, max: 100, step: 0.05, unit: '/s' }),
  droneSpeed: num({ label: 'Worker drone speed', min: 0.5, max: 60, step: 0.5, unit: 'u/s' }),
  droneIdleDrawMW: num({ label: 'Drone draw (idle)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  droneBusyDrawMW: num({ label: 'Drone draw (working)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  droneHp: int({ label: 'Drone hit points', min: 1, max: 10000 }),
  droneCost: int({ label: 'Drone cost', min: 0, max: 10000, unit: 'alloys', help: 'Fabricated at the Command Core.' }),
  droneBuildSeconds: num({ label: 'Drone fabrication time', min: 0, max: 600, unit: 's' }),
  maxDrones: int({ label: 'Max drones', min: 1, max: 20 }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', help: 'Per drone.' }),
  buildRadius: num({ label: 'Build radius', min: 5, max: 240, unit: 'u', help: 'New buildings must be this close to a finished one (or the Core\'s Range).' }),
  cryoDrawMW: num({ label: 'Cryo bank draw', min: 0, max: 100, step: 0.1, unit: 'MW' }),
  cryoLossPerMW: num({ label: 'Cryo loss per MW short', min: 0, max: 10, step: 0.01, unit: '%/s', help: 'How fast integrity falls per MW the bank is short.' }),
  cryoRecover: num({ label: 'Cryo recovery', min: 0, max: 10, step: 0.01, unit: '%/s', help: 'When fully powered.' }),
  nightSolar: num({ label: 'Solar output at night', min: 0, max: 1, step: 0.01, help: 'Fraction of noon output (starlight, moons).' }),
  solSeconds: num({ label: 'Length of a sol', min: 10, max: 7200, unit: 's', help: 'Real seconds per game day.' }),
} satisfies Shape;
export type ColonyRules = Infer<typeof colonyRulesShape>;

export const threatRulesShape = {
  graceSeconds: num({ label: 'Grace period', min: 0, max: 7200, unit: 's', help: 'No attacks before this.' }),
  waveInterval: num({ label: 'Time between packs', min: 10, max: 3600, unit: 's' }),
  waveJitter: num({ label: 'Interval jitter', min: 0, max: 600, unit: 's', help: '± random spread.' }),
  startSize: int({ label: 'First pack size', min: 0, max: 200 }),
  growth: num({ label: 'Growth per pack', min: 0, max: 50, step: 0.5 }),
  maxSize: int({ label: 'Largest pack', min: 0, max: 300 }),
  bruteEvery: int({ label: 'Brute every', min: 0, max: 100, help: 'Every Nth attacker is a Brute (0 = never).' }),
  nightBoost: num({ label: 'Night pack size', min: 0, max: 5, step: 0.05, help: 'Multiplier for packs that arrive at night.' }),
  sightRange: num({ label: 'Sight without radar', min: 0, max: 240, unit: 'u', help: 'Packs show up (and warn) only this close to a building unless a radar is powered.' }),
} satisfies Shape;
export type ThreatRules = Infer<typeof threatRulesShape>;

export const ASSET_KINDS = ['model', 'image', 'audio'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
/** Allowed file extensions per kind (lowercase, no dot). */
export const ASSET_EXT: Record<AssetKind, readonly string[]> = {
  model: ['glb'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['ogg', 'mp3', 'wav'],
};
/** Where an asset's file lives, relative to the site root (public/ in the repo). */
export const mediaUrl = (a: { kind: string; file: string }) => `/media/${a.kind}/${a.file}`;

export const assetShape = {
  name: str({ label: 'Name' }),
  kind: choice(ASSET_KINDS, { label: 'Kind' }),
  file: str({ label: 'File', help: 'In public/media/<kind>/. Use Replace file to change it.' }),
  source: choice(['blender', 'hand-made', 'generated', 'other'], { label: 'Source', default: 'other' }),
  credit: str({ label: 'Credit / licence', optional: true, help: 'Who made it, which tool or site, and its licence.' }),
  notes: str({ label: 'Notes', multiline: true, optional: true }),
  scale: num({ label: 'Import scale', min: 0.0001, max: 1000, step: 0.01, default: 1, help: 'Models: file units → world units (1 u ≈ 10 m). Use Fit to match a built-in.' }),
  yaw: num({ label: 'Import rotation', min: -180, max: 180, step: 5, unit: '°', default: 0, help: 'Models: turn so the front faces +Z (the way units drive).' }),
  lift: num({ label: 'Import lift', min: -50, max: 50, step: 0.05, unit: 'u', default: 0, help: 'Models: raise or sink so it sits on the ground.' }),
} satisfies Shape;
export type AssetDef = Infer<typeof assetShape>;

/** Region paint grids: one sample every REGION_STEP units across the whole region. */
export const REGION_STEP = 2;
export const REGION_CELLS = (REGION_HALF * 2) / REGION_STEP + 1; // 121
/** Height grid values are tenths of a world unit. */
export const HEIGHT_SCALE = 0.1;

export const herdShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  grazers: int({ label: 'Grazers', min: 0, max: 400 }),
  roam: num({ label: 'Roam radius', min: 0, max: 240, unit: 'u', help: 'How far the herd may wander from here. 0 = stays put.' }),
} satisfies Shape;
export type HerdDef = Infer<typeof herdShape>;

export const depositShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  alloys: int({ label: 'Alloys', min: 1, max: 1000000 }),
} satisfies Shape;
export type DepositDef = Infer<typeof depositShape>;

export const spawnShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
} satisfies Shape;
export type SpawnDef = Infer<typeof spawnShape>;

export const regionShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  floraSeed: int({ label: 'Flora seed', min: 1, max: 999999, help: 'Picks the plant species. ?flora=<seed> in the URL overrides it.' }),
  floraDensity: num({ label: 'Flora density', min: 0, max: 3, step: 0.05, default: 1, help: 'Multiplies the number of plants everywhere.' }),
  height: grid(REGION_CELLS, REGION_CELLS, -600, 600, { label: 'Height sculpt', optional: true, help: 'Added to the generated terrain, in tenths of a unit.' }),
  flora: grid(REGION_CELLS, REGION_CELLS, -100, 100, { label: 'Flora paint', optional: true, help: '−100 clears plants, +100 doubles them and makes the ground lush.' }),
  herds: list(herdShape, { label: 'Grazer herds', max: 60 }),
  deposits: list(depositShape, { label: 'Alloy deposits', max: 60 }),
  spawns: list(spawnShape, { label: 'Predator spawns', max: 20 }),
} satisfies Shape;
export type RegionDef = Infer<typeof regionShape>;

export interface Collection {
  /** Folder under /content, or a single file for a singleton. */
  path: string;
  /** One record per file (`many`) or exactly one file (`single`). */
  kind: 'many' | 'single';
  shape: Shape;
  label: string;
  /** Which `shape` field is the record's display name. */
  title?: string;
  group: string;
}

export const COLLECTIONS = {
  units: { path: 'units', kind: 'many', shape: unitShape, label: 'Units', title: 'name', group: 'Game data' },
  buildings: { path: 'buildings', kind: 'many', shape: buildingShape, label: 'Buildings', title: 'name', group: 'Game data' },
  assets: { path: 'assets', kind: 'many', shape: assetShape, label: 'Assets', title: 'name', group: 'Assets' },
  regions: { path: 'regions', kind: 'many', shape: regionShape, label: 'Regions', title: 'name', group: 'Maps' },
  colony: { path: 'rules/colony.json', kind: 'single', shape: colonyRulesShape, label: 'Colony rules', group: 'Rules' },
  threats: { path: 'rules/threats.json', kind: 'single', shape: threatRulesShape, label: 'Threat rules', group: 'Rules' },
} satisfies Record<string, Collection>;

export type CollectionName = keyof typeof COLLECTIONS;

/** Map a content-relative file path to its collection and record id. */
export function locate(path: string): { coll: CollectionName; id: string } | null {
  for (const [name, c] of Object.entries(COLLECTIONS) as [CollectionName, Collection][]) {
    if (c.kind === 'single') {
      if (path === c.path) return { coll: name, id: name };
    } else {
      const m = path.match(/^(.*)\/([a-z0-9][a-z0-9_-]*)\.json$/);
      if (m && m[1] === c.path) return { coll: name, id: m[2] };
    }
  }
  return null;
}

/** File path for a record. */
export function pathOf(coll: CollectionName, id: string): string {
  const c: Collection = COLLECTIONS[coll];
  return c.kind === 'single' ? c.path : `${c.path}/${id}.json`;
}

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
