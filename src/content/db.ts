/**
 * Builds and validates the content database from raw files. Shared by the game
 * loader, the editor and the `content:check` script, so all three agree.
 */
import { ASSET_EXT, COLLECTIONS, locate, type AssetDef, type BuildingDef, type CharacterDef, type InterfaceDef, type CinematicDef, BEATS, type CollectionName, type ColonyRules, type InhabitantDef, type PeopleRules, type RegionDef, type MissionDef, type SoundRules, type StoryDef, type ThreatRules, type UnitDef } from './defs';
import { validate, type IdIndex, type Issue } from './schema';

export interface ContentDb {
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  regions: Record<string, RegionDef>;
  assets: Record<string, AssetDef>;
  inhabitants: Record<string, InhabitantDef>;
  story: Record<string, StoryDef>;
  missions: Record<string, MissionDef>;
  characters: Record<string, CharacterDef>;
  colony: ColonyRules;
  threats: ThreatRules;
  people: PeopleRules;
  sound: SoundRules;
  interface: InterfaceDef;
  cinematics: Record<string, CinematicDef>;
  /** The opening landing (cinematics/landing.json). */
  landing: CinematicDef;
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
    inhabitants: recs.inhabitants,
    story: recs.story,
    missions: recs.missions,
    characters: recs.characters,
    colony: recs.colony.colony,
    threats: recs.threats.threats,
    people: recs.people.people,
    sound: recs.sound.sound,
    interface: recs.interface.interface,
    cinematics: recs.cinematics,
    landing: recs.cinematics.landing,
  } as unknown as ContentDb;
  issues.push(...crossIssues(db0));
  return { db: db0, issues };
}

/** Records the game code refers to by id. Missing ones are reported as issues. */
export const REQUIRED: Partial<Record<CollectionName, string[]>> = {
  units: ['rover', 'tank', 'swarmer', 'brute'],
  buildings: ['core', 'solar'],
  regions: ['touchdown'],
  cinematics: ['landing'],
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
  for (const [id, g] of Object.entries(db.inhabitants ?? {})) {
    if (!g || typeof g !== 'object') continue;
    for (const f of ['centre', 'dwelling', 'walker', 'elder'] as const) {
      const a = g[f] ? db.assets[g[f]!] : undefined;
      if (a && a.kind !== 'model') out.push({ path: `inhabitants/${id}.json`, field: f, msg: `"${g[f]}" isn't a model` });
    }
  }
  // sound files must be audio
  for (const [k, f] of Object.entries(COLLECTIONS.sound.shape)) {
    const id = f.kind === 'ref' && db.sound ? (db.sound as Record<string, unknown>)[k] : undefined;
    const a = typeof id === 'string' ? db.assets[id] : undefined;
    if (a && a.kind !== 'audio') out.push({ path: COLLECTIONS.sound.path, field: k, msg: `"${id}" is ${a.kind === 'image' ? 'an image' : 'a model'}, not audio` });
  }
  // each role's game logic needs its numbers
  const NEEDS: Record<string, string[]> = { civic: ['housing'], farm: ['biomassRate'], core: ['range'], depot: ['range', 'mineRate'], battery: ['storage'], turret: ['fireRange', 'damage', 'cooldown'] };
  for (const [id, b] of Object.entries(db.buildings)) {
    if (!b || typeof b !== 'object') continue;
    for (const f of NEEDS[b.role] ?? []) {
      if ((b as unknown as Record<string, unknown>)[f] === undefined) out.push({ path: `buildings/${id}.json`, field: f, msg: `a ${b.role} needs this` });
    }
    if (b.role === 'core' && id !== 'core') out.push({ path: `buildings/${id}.json`, field: 'role', msg: 'only the Command Core (core.json) can have the core role' });
  }
  // story and missions: site conditions need a site on a region map; nothing waits on itself
  const siteMissing = (site: string, region?: string) => {
    const maps = region ? [db.regions[region]] : Object.values(db.regions);
    return maps.some((r) => r?.sites?.some((x) => x.id === site)) ? null : `no region${region ? ` "${region}"` : ''} has a story site "${site}"`;
  };
  for (const [id, m] of Object.entries(db.missions ?? {})) {
    if (!m || typeof m !== 'object') continue;
    if (m.after === id) out.push({ path: `missions/${id}.json`, field: 'after', msg: 'a mission can\'t follow itself' });
    (m.objectives ?? []).forEach((o, n) => {
      const miss = o?.kind === 'site' && o.site ? siteMissing(o.site, m.region) : null;
      if (miss) out.push({ path: `missions/${id}.json`, field: `objectives[${n}].site`, msg: miss });
    });
  }
  for (const [id, ev] of Object.entries(db.story ?? {})) {
    if (!ev || typeof ev !== 'object') continue;
    const miss = ev.trigger === 'site' && ev.site ? siteMissing(ev.site, ev.region) : null;
    if (miss) out.push({ path: `story/${id}.json`, field: 'site', msg: miss });
    (ev.effects ?? []).forEach((e, n) => {
      if ((e?.after ?? 0) > (ev.choices?.length ?? 0)) out.push({ path: `story/${id}.json`, field: `effects[${n}].after`, msg: `there is no choice ${e.after}` });
    });
    if (ev.trigger === 'after' && ev.event === id) out.push({ path: `story/${id}.json`, field: 'event', msg: 'an event can\'t follow itself' });
    if (ev.style === 'radio' && ev.choices?.length) out.push({ path: `story/${id}.json`, field: 'choices', msg: 'a radio message can\'t have choices (make it a card)' });
    if (ev.style === 'radio' && ev.lines?.length) out.push({ path: `story/${id}.json`, field: 'lines', msg: 'a radio message is one line (make it a card for a conversation)' });
  }
  if (db.buildings.core && db.buildings.core.role !== 'core') out.push({ path: 'buildings/core.json', field: 'role', msg: 'must be core' });
  if (db.buildings.core?.model) out.push({ path: 'buildings/core.json', field: 'model', msg: 'the Command Core model is fixed (the landing cinematic animates it)' });
  // cinematics: the landing is the one landing scene; beats in order; lists in time order; targets exist
  for (const [id, cd] of Object.entries(db.cinematics ?? {})) {
    if (!cd || typeof cd !== 'object') continue;
    const P = `cinematics/${id}.json`, L = cd as unknown as Record<string, unknown>;
    const landing = cd.scene === 'landing';
    if (id === 'landing' && !landing) out.push({ path: P, field: 'scene', msg: 'the opening landing must use the landing scene' });
    if (id !== 'landing' && landing) out.push({ path: P, field: 'scene', msg: 'only the opening landing (landing.json) can use the landing scene' });
    if (landing) BEATS.forEach((b, i) => {
      const prev = BEATS[i - 1];
      if (prev && typeof L[b] === 'number' && typeof L[prev] === 'number' && (L[b] as number) < (L[prev] as number)) out.push({ path: P, field: b, msg: `comes before ${COLLECTIONS.cinematics.shape[prev].label} (${L[prev]} s)` });
      if (typeof L[b] === 'number' && typeof cd.length === 'number' && (L[b] as number) > cd.length) out.push({ path: P, field: b, msg: `after the end (${cd.length} s)` });
    });
    for (const k of ['camera', 'captions', 'lines', 'sounds'] as const) {
      const list = Array.isArray(L[k]) ? (L[k] as { at?: number }[]) : [];
      list.forEach((x, n) => {
        if (n && (x?.at ?? 0) < (list[n - 1]?.at ?? 0)) out.push({ path: P, field: `${k}[${n}].at`, msg: 'out of time order' });
        if (typeof cd.length === 'number' && (x?.at ?? 0) > cd.length) out.push({ path: P, field: `${k}[${n}].at`, msg: `after the end (${cd.length} s)` });
      });
      if (k === 'camera' && !list.length) out.push({ path: P, field: k, msg: 'needs at least one key' });
    }
    (cd.camera ?? []).forEach((k, n) => {
      if (k?.target === 'probe' && !landing) out.push({ path: P, field: `camera[${n}].target`, msg: 'only the landing has a probe to look at' });
      const miss = k?.target === 'storysite' && k.site ? siteMissing(k.site, cd.region) : null;
      if (miss) out.push({ path: P, field: `camera[${n}].site`, msg: miss });
    });
    (cd.sounds ?? []).forEach((x, n) => {
      const a = x?.sound ? db.assets[x.sound] : undefined;
      if (a && a.kind !== 'audio') out.push({ path: P, field: `sounds[${n}].sound`, msg: `"${x.sound}" isn't audio` });
    });
    if (!landing && cd.trigger === 'site' && cd.site) { const miss = siteMissing(cd.site, cd.region); if (miss) out.push({ path: P, field: 'site', msg: miss }); }
  }
  // story effects and mission rewards can't replay the landing
  const cineEffect = (path: string, field: string, e?: { kind?: string; cinematic?: string }) => {
    if (e?.kind === 'cinematic' && e.cinematic && db.cinematics?.[e.cinematic]?.scene === 'landing') out.push({ path, field: `${field}.cinematic`, msg: 'the landing only plays at the start of a game' });
  };
  for (const [id, ev] of Object.entries(db.story ?? {})) (ev?.effects ?? []).forEach((e, n) => cineEffect(`story/${id}.json`, `effects[${n}]`, e));
  for (const [id, m] of Object.entries(db.missions ?? {})) (m?.rewards ?? []).forEach((e, n) => cineEffect(`missions/${id}.json`, `rewards[${n}]`, e));
  for (const [id, ch] of Object.entries(db.characters ?? {})) {
    const a = ch?.portrait ? db.assets[ch.portrait] : undefined;
    if (a && a.kind !== 'image') out.push({ path: `characters/${id}.json`, field: 'portrait', msg: `"${ch.portrait}" isn't an image` });
  }
  for (const [id, a] of Object.entries(db.assets)) {
    if (!a || typeof a.file !== 'string' || !(a.kind in ASSET_EXT)) continue;
    const ext = a.file.split('.').pop()?.toLowerCase() ?? '';
    if (!ASSET_EXT[a.kind].includes(ext)) out.push({ path: `assets/${id}.json`, field: 'file', msg: `.${ext} isn't a ${a.kind} file (${ASSET_EXT[a.kind].join(', ')})` });
  }
  return out;
}
