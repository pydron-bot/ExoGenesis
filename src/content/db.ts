/**
 * Builds and validates the content database from raw files. Shared by the game
 * loader, the editor and the `content:check` script, so all three agree.
 */
import { ASSET_EXT, COLLECTIONS, locate, type AssetDef, type BuildingDef, type CollectionName, type ColonyRules, type RegionDef, type SoundRules, type ThreatRules, type UnitDef } from './defs';
import { validate, type IdIndex, type Issue } from './schema';

export interface ContentDb {
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  regions: Record<string, RegionDef>;
  assets: Record<string, AssetDef>;
  colony: ColonyRules;
  threats: ThreatRules;
  sound: SoundRules;
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

  const db0 = {
    units: recs.units,
    buildings: recs.buildings,
    regions: recs.regions,
    assets: recs.assets,
    colony: recs.colony.colony,
    threats: recs.threats.threats,
    sound: recs.sound.sound,
  } as unknown as ContentDb;
  issues.push(...crossIssues(db0));
  return { db: db0, issues };
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

/** Rules that span records: model refs must be models, files must match their kind. */
function crossIssues(db: ContentDb): FileIssue[] {
  const out: FileIssue[] = [];
  const modelRef = (coll: 'units' | 'buildings', recs: Record<string, { model?: string }>) => {
    for (const [id, r] of Object.entries(recs)) {
      if (!r || typeof r !== 'object' || !r.model) continue;
      const a = db.assets[r.model];
      if (a && a.kind !== 'model') out.push({ path: `${COLLECTIONS[coll].path}/${id}.json`, field: 'model', msg: `"${r.model}" is ${a.kind === 'image' ? 'an image' : 'audio'}, not a model` });
    }
  };
  modelRef('units', db.units);
  modelRef('buildings', db.buildings);
  // sound files must be audio
  for (const [k, f] of Object.entries(COLLECTIONS.sound.shape)) {
    const id = f.kind === 'ref' && db.sound ? (db.sound as Record<string, unknown>)[k] : undefined;
    const a = typeof id === 'string' ? db.assets[id] : undefined;
    if (a && a.kind !== 'audio') out.push({ path: COLLECTIONS.sound.path, field: k, msg: `"${id}" is ${a.kind === 'image' ? 'an image' : 'a model'}, not audio` });
  }
  // each role's game logic needs its numbers
  const NEEDS: Record<string, string[]> = { core: ['range'], depot: ['range', 'mineRate'], battery: ['storage'], turret: ['fireRange', 'damage', 'cooldown'] };
  for (const [id, b] of Object.entries(db.buildings)) {
    if (!b || typeof b !== 'object') continue;
    for (const f of NEEDS[b.role] ?? []) {
      if ((b as unknown as Record<string, unknown>)[f] === undefined) out.push({ path: `buildings/${id}.json`, field: f, msg: `a ${b.role} needs this` });
    }
    if (b.role === 'core' && id !== 'core') out.push({ path: `buildings/${id}.json`, field: 'role', msg: 'only the Command Core (core.json) can have the core role' });
  }
  if (db.buildings.core && db.buildings.core.role !== 'core') out.push({ path: 'buildings/core.json', field: 'role', msg: 'must be core' });
  if (db.buildings.core?.model) out.push({ path: 'buildings/core.json', field: 'model', msg: 'the Command Core model is fixed (the landing cinematic animates it)' });
  for (const [id, a] of Object.entries(db.assets)) {
    if (!a || typeof a.file !== 'string' || !(a.kind in ASSET_EXT)) continue;
    const ext = a.file.split('.').pop()?.toLowerCase() ?? '';
    if (!ASSET_EXT[a.kind].includes(ext)) out.push({ path: `assets/${id}.json`, field: 'file', msg: `.${ext} isn't a ${a.kind} file (${ASSET_EXT[a.kind].join(', ')})` });
  }
  return out;
}
