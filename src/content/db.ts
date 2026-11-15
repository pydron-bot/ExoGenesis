/**
 * Builds and validates the content database from raw files. Shared by the game
 * loader, the editor and the `content:check` script, so all three agree.
 */
import { COLLECTIONS, locate, type BuildingDef, type CollectionName, type ColonyRules, type RegionDef, type UnitDef } from './defs';
import { validate, type IdIndex, type Issue } from './schema';

export interface ContentDb {
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  regions: Record<string, RegionDef>;
  colony: ColonyRules;
}

export interface FileIssue extends Issue {
  path: string;
}

/** `files` maps content-relative paths (e.g. "units/rover.json") to parsed JSON. */
export function buildDb(files: Record<string, unknown>): { db: ContentDb; issues: FileIssue[] } {
  const issues: FileIssue[] = [];
  const recs: Record<string, Record<string, unknown>> = {};
  for (const name of Object.keys(COLLECTIONS)) recs[name] = {};
  const where: { path: string; coll: CollectionName; id: string; data: unknown }[] = [];

  for (const [path, data] of Object.entries(files)) {
    const at = locate(path);
    if (!at) { issues.push({ path, field: '', msg: 'not part of any content collection' }); continue; }
    recs[at.coll][at.id] = data;
    where.push({ path, ...at, data });
  }

  const ids: IdIndex = {};
  for (const [name, r] of Object.entries(recs)) ids[name] = new Set(Object.keys(r));
  for (const w of where) {
    for (const i of validate(COLLECTIONS[w.coll].shape, w.data, ids)) issues.push({ path: w.path, ...i });
  }
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    if (c.kind === 'single' && !(name in recs[name])) issues.push({ path: c.path, field: '', msg: 'file missing' });
  }

  const db = {
    units: recs.units,
    buildings: recs.buildings,
    regions: recs.regions,
    colony: recs.colony.colony,
  } as unknown as ContentDb;
  return { db, issues };
}

/** Records the game code refers to by id. Missing ones are reported as issues. */
export const REQUIRED: Partial<Record<CollectionName, string[]>> = {
  units: ['rover', 'tank', 'swarmer', 'brute'],
  buildings: ['core', 'solar'],
  regions: ['touchdown'],
};

export function requiredIssues(db: ContentDb): FileIssue[] {
  const out: FileIssue[] = [];
  for (const [coll, list] of Object.entries(REQUIRED) as [CollectionName, string[]][]) {
    const have = db[coll] as Record<string, unknown>;
    for (const id of list) {
      if (!have[id]) out.push({ path: `${COLLECTIONS[coll].path}/${id}.json`, field: '', msg: 'the game needs this record' });
    }
  }
  return out;
}
