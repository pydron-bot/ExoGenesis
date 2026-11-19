/**
 * Builds and validates the content database from raw files. Shared by the game
 * loader, the editor and the `content:check` script, so all three agree.
 */
import { ASSET_EXT, type AssetDef, BEATS, type BiomeDef, type BodyDef, type BuildingDef, COLLECTIONS, type ChapterDef, type CharacterDef, type CinematicDef, type CollectionName, type ColonyRules, type InhabitantDef, type InterfaceDef, type LoreDef, type MissionDef, type PeopleRules, REGION_SIZE_STEP, type RegionDef, type ResearchDef, type SoundRules, type StoryDef, type ThreatRules, type UnitDef, type WildlifeDef, locate, regionCells } from './defs';
import { validate, type IdIndex, type Issue } from './schema';

export interface ContentDb {
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  research: Record<string, ResearchDef>;
  regions: Record<string, RegionDef>;
  bodies: Record<string, BodyDef>;
  biomes: Record<string, BiomeDef>;
  wildlife: Record<string, WildlifeDef>;
  /** Editor only (the game ignores them). */
  chapters: Record<string, ChapterDef>;
  lore: Record<string, LoreDef>;
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
    research: recs.research,
    regions: recs.regions,
    bodies: recs.bodies,
    biomes: recs.biomes,
    wildlife: recs.wildlife,
    chapters: recs.chapters,
    lore: recs.lore,
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
  bodies: ['home'],
  biomes: ['verdant'],
  wildlife: ['grazer'],
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
  const NEEDS: Record<string, string[]> = { civic: ['housing'], farm: ['biomassRate'], core: ['range'], depot: ['range', 'mineRate'], deepmine: ['range', 'mineRate'], reactor: ['fuelRate'], battery: ['storage'], turret: ['fireRange', 'damage', 'cooldown'] };
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
  /** A condition (and the conditions in its group): its site exists, built / placed name a building. */
  const condIssues = (path: string, field: string, kind: string | undefined, c: Record<string, unknown> | undefined, region?: string) => {
    if (!c) return;
    const pre = field ? `${field}.` : '';
    if ((kind === 'site' || kind === 'explored') && typeof c.site === 'string') { const miss = siteMissing(c.site, region); if (miss) out.push({ path, field: `${pre}site`, msg: miss }); }
    if ((kind === 'built' || kind === 'placed') && !c.building) out.push({ path, field: `${pre}building`, msg: `required when the condition is ${kind}` });
    if (kind === 'opened' && !c.panel) out.push({ path, field: `${pre}panel`, msg: 'required when the condition is opened' });
    if ((kind === 'all' || kind === 'any') && !(c.of as unknown[] | undefined)?.length) out.push({ path, field: `${pre}of`, msg: `an ${kind} group needs at least one condition` });
    ((c.of as Record<string, unknown>[] | undefined) ?? []).forEach((x, n) => condIssues(path, `${pre}of[${n}]`, x?.kind as string, x, region));
  };
  /** An effect's parameters (beyond what the schema checks). */
  const effectIssues = (path: string, field: string, e: Record<string, unknown> | undefined, region?: string) => {
    if (!e) return;
    const k = e.kind as string;
    if (typeof e.site === 'string' && e.site && ['spawn', 'reveal', 'waypoint', 'clearWaypoint', 'camera'].includes(k)) { const miss = siteMissing(e.site, region); if (miss) out.push({ path, field: `${field}.site`, msg: miss }); }
    if ((k === 'spawn' || k === 'reveal' || k === 'waypoint') && !e.site) out.push({ path, field: `${field}.site`, msg: `a ${k} needs a story site` });
    if (k === 'spawn' && !e.unit) out.push({ path, field: `${field}.unit`, msg: 'a spawn needs a unit' });
    if ((k === 'lock' || k === 'unlock') && !e.building && !e.unit) out.push({ path, field: `${field}.building`, msg: `${k}: pick a building or a unit` });
    if (k === 'camera' && !e.site && !e.building) out.push({ path, field: `${field}.site`, msg: 'camera: pick a story site or a building' });
    if (k === 'hint' && e.target === 'buildItem' && !e.building) out.push({ path, field: `${field}.building`, msg: 'a build-menu hint needs the building' });
    if (k === 'spawn' && typeof e.unit === 'string' && db.units[e.unit]?.nest) out.push({ path, field: `${field}.unit`, msg: 'nests grow on predator spawns; spawn the creatures instead' });
  };
  for (const [id, m] of Object.entries(db.missions ?? {})) {
    if (!m || typeof m !== 'object') continue;
    const P = `missions/${id}.json`;
    if (m.after === id) out.push({ path: P, field: 'after', msg: 'a mission can\'t follow itself' });
    (m.objectives ?? []).forEach((o, n) => condIssues(P, `objectives[${n}]`, o?.kind, o as unknown as Record<string, unknown>, m.region));
    (m.fails ?? []).forEach((o, n) => condIssues(P, `fails[${n}]`, o?.kind, o as unknown as Record<string, unknown>, m.region));
    (m.rewards ?? []).forEach((e, n) => effectIssues(P, `rewards[${n}]`, e as unknown as Record<string, unknown>, m.region));
    if (m.failEnds && !m.fails?.length) out.push({ path: P, field: 'failEnds', msg: 'it has no fail conditions, so it can\'t fail' });
  }
  for (const [id, ev] of Object.entries(db.story ?? {})) {
    if (!ev || typeof ev !== 'object') continue;
    const P = `story/${id}.json`;
    condIssues(P, '', ev.trigger, ev as unknown as Record<string, unknown>, ev.region);
    (ev.effects ?? []).forEach((e, n) => {
      if ((e?.after ?? 0) > (ev.choices?.length ?? 0)) out.push({ path: P, field: `effects[${n}].after`, msg: `there is no choice ${e.after}` });
      effectIssues(P, `effects[${n}]`, e as unknown as Record<string, unknown>, ev.region);
    });
    if (ev.trigger === 'after' && ev.event === id) out.push({ path: P, field: 'event', msg: 'an event can\'t follow itself' });
    if (ev.style === 'radio' && ev.choices?.length) out.push({ path: P, field: 'choices', msg: 'a radio message can\'t have choices (make it a card)' });
    if (ev.style === 'radio' && ev.lines?.length) out.push({ path: P, field: 'lines', msg: 'a radio message is one line (make it a card for a conversation)' });
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
  // worlds: orbits make a tree under the star; Home is a rocky planet
  for (const [id, b] of Object.entries(db.bodies ?? {})) {
    if (!b || typeof b !== 'object') continue;
    const P = `bodies/${id}.json`;
    const seen = new Set([id]);
    for (let p = b.parent; p; p = db.bodies[p]?.parent) {
      if (seen.has(p)) { out.push({ path: P, field: 'parent', msg: 'orbits round in a circle (it ends up orbiting itself)' }); break; }
      seen.add(p);
    }
    if (b.kind === 'moon' && !b.parent) out.push({ path: P, field: 'parent', msg: 'a moon needs something to orbit' });
    if (id === 'home' && b.kind === 'giant') out.push({ path: P, field: 'kind', msg: 'Home must have a surface' });
    if (b.ring && (b.ringOuter ?? 2.2) <= (b.ringInner ?? 1.4)) out.push({ path: P, field: 'ringOuter', msg: 'must be bigger than the inner edge' });
  }
  // wildlife: the largest size isn't below the smallest
  for (const [id, w] of Object.entries(db.wildlife ?? {})) {
    if (w && typeof w === 'object' && w.sizeMax !== undefined && w.sizeMax < w.size) out.push({ path: `wildlife/${id}.json`, field: 'sizeMax', msg: 'smaller than Size' });
  }
  // regions: on a body with a surface, big enough to hold them; grids match the size; markers inside
  for (const [id, r] of Object.entries(db.regions ?? {})) {
    if (!r || typeof r !== 'object') continue;
    const P = `regions/${id}.json`;
    const size = r.size ?? 240, half = size / 2;
    if (size % REGION_SIZE_STEP) out.push({ path: P, field: 'size', msg: `must be a multiple of ${REGION_SIZE_STEP} u` });
    const b = r.body ? db.bodies?.[r.body] : db.bodies?.home;
    if (b?.kind === 'giant') out.push({ path: P, field: 'body', msg: `${b.name} is a gas giant: nothing can land on it` });
    if (b && typeof b.radius === 'number' && b.radius < half * 3) out.push({ path: P, field: 'size', msg: `too big for ${b.name} (radius ${b.radius} u): at most ${Math.floor((b.radius / 3) * 2 / REGION_SIZE_STEP) * REGION_SIZE_STEP} u there` });
    const n = regionCells(half);
    for (const g of ['height', 'flora', 'ground'] as const) {
      const v = r[g];
      if (Array.isArray(v) && v.length !== n) out.push({ path: P, field: g, msg: `has ${v.length} rows; a ${size} u region needs ${n} (resize it in the map editor)` });
    }
    for (const k of ['herds', 'deposits', 'spawns', 'vents', 'camps', 'sites', 'wrecks', 'seams', 'relics', 'encounters'] as const) {
      (r[k] as { x?: number; z?: number }[] | undefined)?.forEach((m, i) => {
        if (m && (Math.abs(m.x ?? 0) > half || Math.abs(m.z ?? 0) > half)) out.push({ path: P, field: `${k}[${i}]`, msg: `outside the region (it's ${size} u across)` });
      });
    }
    // encounters: hostile units, unique ids
    const encIds = new Set<string>();
    (r.encounters ?? []).forEach((e, i) => {
      if (!e) return;
      const u = db.units[e.unit];
      if (u?.faction === 'accord') out.push({ path: P, field: `encounters[${i}].unit`, msg: 'an encounter is hostile: pick a fauna or relic unit' });
      if (u?.nest) out.push({ path: P, field: `encounters[${i}].unit`, msg: 'nests grow on predator spawns, not as encounters' });
      if (encIds.has(e.id)) out.push({ path: P, field: `encounters[${i}].id`, msg: `another encounter is "${e.id}"` });
      encIds.add(e.id);
    });
  }
  for (const [id, a] of Object.entries(db.assets)) {
    if (!a || typeof a.file !== 'string' || !(a.kind in ASSET_EXT)) continue;
    const ext = a.file.split('.').pop()?.toLowerCase() ?? '';
    if (!ASSET_EXT[a.kind].includes(ext)) out.push({ path: `assets/${id}.json`, field: 'file', msg: `.${ext} isn't a ${a.kind} file (${ASSET_EXT[a.kind].join(', ')})` });
  }
  return out;
}
