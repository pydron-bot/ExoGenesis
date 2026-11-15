/**
 * Content collections: what lives under /content and what shape each file has.
 *
 * Add a collection: define its shape here, add it to COLLECTIONS, drop JSON files
 * into content/<dir>/. The editor and the checker pick it up automatically.
 * Only add a field once the game actually reads it, so the editor never shows a
 * knob that does nothing.
 */
import { REGION_HALF } from '../sim/types';
import { choice, grid, int, list, num, str, type Infer, type Shape } from './schema';

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
  modelScale: num({ label: 'Model scale', min: 0.1, max: 10, step: 0.05, default: 1 }),
} satisfies Shape;
export type UnitDef = Infer<typeof unitShape>;

export const buildingShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys' }),
  powerMW: num({ label: 'Power generation', min: -100, max: 100, step: 0.1, unit: 'MW', help: 'Negative = draws power.' }),
  buildSeconds: num({ label: 'Build time', min: 0, max: 600, step: 0.5, unit: 's' }),
  clearance: num({ label: 'Clearance', min: 0, max: 60, step: 0.5, unit: 'u', help: 'Nothing new may be placed closer than this.' }),
} satisfies Shape;
export type BuildingDef = Infer<typeof buildingShape>;

export const colonyRulesShape = {
  startAlloys: int({ label: 'Starting alloys', min: 0, max: 100000 }),
  alloyTrickle: num({ label: 'Passive alloy income', min: 0, max: 100, step: 0.05, unit: '/s' }),
  droneSpeed: num({ label: 'Worker drone speed', min: 0.5, max: 60, step: 0.5, unit: 'u/s' }),
  droneIdleDrawMW: num({ label: 'Drone draw (idle)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  droneBusyDrawMW: num({ label: 'Drone draw (working)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  cryoDrawMW: num({ label: 'Cryo bank draw', min: 0, max: 100, step: 0.1, unit: 'MW' }),
  solSeconds: num({ label: 'Length of a sol', min: 10, max: 7200, unit: 's', help: 'Real seconds per game day.' }),
} satisfies Shape;
export type ColonyRules = Infer<typeof colonyRulesShape>;

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

export const regionShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  floraSeed: int({ label: 'Flora seed', min: 1, max: 999999, help: 'Picks the plant species. ?flora=<seed> in the URL overrides it.' }),
  floraDensity: num({ label: 'Flora density', min: 0, max: 3, step: 0.05, default: 1, help: 'Multiplies the number of plants everywhere.' }),
  height: grid(REGION_CELLS, REGION_CELLS, -600, 600, { label: 'Height sculpt', optional: true, help: 'Added to the generated terrain, in tenths of a unit.' }),
  flora: grid(REGION_CELLS, REGION_CELLS, -100, 100, { label: 'Flora paint', optional: true, help: '−100 clears plants, +100 doubles them and makes the ground lush.' }),
  herds: list(herdShape, { label: 'Grazer herds', max: 60 }),
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
  regions: { path: 'regions', kind: 'many', shape: regionShape, label: 'Regions', title: 'name', group: 'Maps' },
  colony: { path: 'rules/colony.json', kind: 'single', shape: colonyRulesShape, label: 'Colony rules', group: 'Rules' },
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
