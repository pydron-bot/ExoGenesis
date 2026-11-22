/**
 * Builds and validates the content database from raw files. Shared by the game
 * loader, the editor and the `content:check` script, so all three agree.
 */
import { ASSET_EXT, type AssetDef, BEATS, type BiomeDef, type BodyDef, type BuildingDef, COLLECTIONS, type ChapterDef, type CharacterDef, type CinematicDef, type CollectionName, type ColonyRules, type GuideDef, type InhabitantDef, type InterfaceDef, type LoreDef, type MissionDef, MUSIC_LAYERS, type MusicDef, type PeopleRules, REGION_SIZE_STEP, type RegionDef, type ResearchDef, type SoundRules, type StoryDef, TEXT_NEEDED, type ThreatRules, type UnitDef, type VoiceDef, type WildlifeDef, locate, regionCells, seeAlso, VERSION_RE } from './defs';
import { validate, type IdIndex, type Issue } from './schema';
import { parseNotes } from '../audio/notes';
import { parseSteps } from '../audio/drums';

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
  /** The Field Guide (src/guide.ts). */
  guide: Record<string, GuideDef>;
  assets: Record<string, AssetDef>;
  inhabitants: Record<string, InhabitantDef>;
  story: Record<string, StoryDef>;
  missions: Record<string, MissionDef>;
  characters: Record<string, CharacterDef>;
  /** Colonists' remarks and backstories (src/sim/people.ts). */
  voices: Record<string, VoiceDef>;
  colony: ColonyRules;
  threats: ThreatRules;
  people: PeopleRules;
  sound: SoundRules;
  /** Music moods (src/audio/music.ts). */
  music: Record<string, MusicDef>;
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
    guide: recs.guide,
    assets: recs.assets,
    inhabitants: recs.inhabitants,
    story: recs.story,
    missions: recs.missions,
    characters: recs.characters,
    voices: recs.voices,
    colony: recs.colony.colony,
    threats: recs.threats.threats,
    people: recs.people.people,
    sound: recs.sound.sound,
    music: recs.music,
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
  guide: ['orientation'],
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
  // music moods: notes must be note names; shortest ≤ longest
  for (const [id, m] of Object.entries(db.music ?? {})) {
    if (!m || typeof m !== 'object') continue;
    const at = `music/${id}.json`;
    (m.chords ?? []).forEach((c, i) => {
      for (const f of ['notes', 'bass', 'bells'] as const) {
        const { bad } = parseNotes(c?.[f]);
        if (bad.length) out.push({ path: at, field: `chords[${i}].${f}`, msg: `not a note: ${bad.join(', ')} (write e.g. C#4, Eb3)` });
      }
      if (c && !parseNotes(c.notes).notes.length) out.push({ path: at, field: `chords[${i}].notes`, msg: 'needs at least one note' });
    });
    (m.drumTracks ?? []).forEach((d, i) => {
      const { steps, bad } = parseSteps(d?.steps);
      if (bad.length) out.push({ path: at, field: `drumTracks[${i}].steps`, msg: `use x (hit), o (soft hit) and . (rest), not ${[...new Set(bad)].join(' ')}` });
      else if (!steps.length) out.push({ path: at, field: `drumTracks[${i}].steps`, msg: 'needs at least one step' });
      else if (steps.length > 64) out.push({ path: at, field: `drumTracks[${i}].steps`, msg: `${steps.length} steps; at most 64 (4 bars)` });
    });
    (m.melody ?? []).forEach((ph, i) => {
      const bad = (ph?.notes ?? '').split(/\s+/).filter((w) => w && !['-', '.', '|'].includes(w) && parseNotes(w).bad.length);
      if (bad.length) out.push({ path: at, field: `melody[${i}].notes`, msg: `not a note, - or .: ${bad.join(', ')}` });
    });
    (m.sections ?? []).forEach((sec, i) => {
      const bad = (sec?.layers ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w && !(MUSIC_LAYERS as readonly string[]).includes(w));
      if (bad.length) out.push({ path: at, field: `sections[${i}].layers`, msg: `not a layer: ${bad.join(', ')} (use ${MUSIC_LAYERS.join(', ')})` });
    });
    if (m.bassline && /[^xXoO5.\-\s|]/.test(m.bassline)) out.push({ path: at, field: 'bassline', msg: 'use x (root), o (octave up), 5 (fifth) and . (rest)' });
    // a written score: its notes, layers and form
    const names = new Set((m.score ?? []).map((sec) => (sec?.name ?? '').trim().toLowerCase()));
    (m.score ?? []).forEach((sec, i) => {
      const f = `score[${i}]`;
      if (!(sec?.name ?? '').trim()) out.push({ path: at, field: `${f}.name`, msg: 'needs a name (the form plays sections by name)' });
      const badL = (sec?.layers ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w && !(MUSIC_LAYERS as readonly string[]).includes(w));
      if (badL.length) out.push({ path: at, field: `${f}.layers`, msg: `not a layer: ${badL.join(', ')} (use ${MUSIC_LAYERS.join(', ')})` });
      if (!(sec?.bars ?? []).length) out.push({ path: at, field: `${f}.bars`, msg: 'needs at least one bar' });
      (sec?.bars ?? []).forEach((bar, j) => {
        for (const k of ['chord', 'bass'] as const) {
          const { bad } = parseNotes(bar?.[k]);
          if (bad.length) out.push({ path: at, field: `${f}.bars[${j}].${k}`, msg: `not a note: ${bad.join(', ')} (write e.g. C#4, Eb3)` });
        }
        if (bar?.bass && !bar.chord) out.push({ path: at, field: `${f}.bars[${j}].bass`, msg: 'a bass note goes with a chord: this bar has none' });
        for (const k of ['bells', 'melody'] as const) {
          const bad = (bar?.[k] ?? '').split(/\s+/).filter((w) => w && !['-', '.', '|'].includes(w) && parseNotes(w).bad.length);
          if (bad.length) out.push({ path: at, field: `${f}.bars[${j}].${k}`, msg: `not a note, - or .: ${bad.join(', ')}` });
        }
      });
    });
    const badT = (m.scoreThenLayers ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w && !(MUSIC_LAYERS as readonly string[]).includes(w));
    if (badT.length) out.push({ path: at, field: 'scoreThenLayers', msg: `not a layer: ${badT.join(', ')} (use ${MUSIC_LAYERS.join(', ')})` });
    const unknown = (m.form ?? '').split(/[\s,]+/).filter((w) => w && !names.has(w.toLowerCase()));
    if (unknown.length) out.push({ path: at, field: 'form', msg: `no section called ${unknown.map((w) => `"${w}"`).join(', ')}` });
    const scored = (m.score ?? []).some((sec) => (sec?.bars ?? []).some((bar) => bar?.chord?.trim()));
    if (m.score?.length && !scored) out.push({ path: at, field: 'score', msg: 'needs at least one bar with a chord' });
    if (m.use !== 'none' && !m.score?.length && !(m.chords ?? []).length) out.push({ path: at, field: 'chords', msg: 'needs at least one chord (or a written score)' });
    for (const [a, b] of [['chordMin', 'chordMax'], ['bellGapMin', 'bellGapMax']] as const) {
      if (m[a] !== undefined && m[b] !== undefined && m[a] > m[b]) out.push({ path: at, field: b, msg: `shorter than ${a === 'chordMin' ? 'the shortest chord' : 'the shortest gap'}` });
    }
  }
  if (db.sound) {
    if (db.sound.playMin > db.sound.playMax) out.push({ path: 'rules/sound.json', field: 'playMax', msg: 'shorter than the shortest stretch' });
    if (db.sound.restMin > db.sound.restMax) out.push({ path: 'rules/sound.json', field: 'restMax', msg: 'shorter than the shortest quiet spell' });
  }
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
  // research: prerequisites can't loop back; a discovery gate says in words what to do
  for (const [id, r] of Object.entries(db.research ?? {})) {
    if (!r || typeof r !== 'object') continue;
    const P = `research/${id}.json`;
    if (r.flag && !r.flagText) out.push({ path: P, field: 'flagText', msg: 'say what the player must do to set the flag' });
    if (r.also && r.also === r.requires) out.push({ path: P, field: 'also', msg: 'the same as Needs first' });
    const seen = new Set<string>([id]), todo = [r.requires, r.also].filter(Boolean) as string[];
    while (todo.length) {
      const x = todo.pop()!;
      if (x === id) { out.push({ path: P, field: 'requires', msg: 'its prerequisites lead back to itself' }); break; }
      if (seen.has(x)) continue;
      seen.add(x);
      const q = db.research[x];
      if (q) todo.push(...([q.requires, q.also].filter(Boolean) as string[]));
    }
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
    if ((kind === 'here' || kind === 'visited') && !c.place) out.push({ path, field: `${pre}place`, msg: `required when the condition is ${kind}` });
    if ((kind === 'all' || kind === 'any') && !(c.of as unknown[] | undefined)?.length) out.push({ path, field: `${pre}of`, msg: `an ${kind} group needs at least one condition` });
    ((c.of as Record<string, unknown>[] | undefined) ?? []).forEach((x, n) => condIssues(path, `${pre}of[${n}]`, x?.kind as string, x, region));
    if (kind === 'faction' || kind === 'factionLost') {
      if (!c.faction) out.push({ path, field: `${pre}faction`, msg: `required when the condition is ${kind}` });
      else { const miss = factionMissing(c.faction as string, region); if (miss) out.push({ path, field: `${pre}faction`, msg: miss }); }
    }
    if (kind === 'faction' && !c.attitude) out.push({ path, field: `${pre}attitude`, msg: 'required when the condition is faction' });
    if (kind === 'majority' && !c.stance) out.push({ path, field: `${pre}stance`, msg: 'required when the condition is majority' });
  };
  /** A faction id that no region (or not the given one) has. */
  const factionMissing = (id: string, region?: string) => {
    const maps = region ? [db.regions[region]] : Object.values(db.regions);
    return maps.some((r) => r?.factions?.some((f) => f?.id === id)) ? null : `no region${region ? ` "${region}"` : ''} has a faction "${id}"`;
  };
  /** An effect's parameters (beyond what the schema checks). */
  const effectIssues = (path: string, field: string, e: Record<string, unknown> | undefined, region?: string) => {
    if (!e) return;
    const k = e.kind as string;
    if (typeof e.site === 'string' && e.site && ['spawn', 'reveal', 'waypoint', 'clearWaypoint', 'camera', 'strike', 'outpost'].includes(k)) { const miss = siteMissing(e.site, region); if (miss) out.push({ path, field: `${field}.site`, msg: miss }); }
    if ((k === 'spawn' || k === 'reveal' || k === 'waypoint') && !e.site) out.push({ path, field: `${field}.site`, msg: `a ${k} needs a story site` });
    if (k === 'spawn' && !e.unit) out.push({ path, field: `${field}.unit`, msg: 'a spawn needs a unit' });
    if ((k === 'lock' || k === 'unlock') && !e.building && !e.unit) out.push({ path, field: `${field}.building`, msg: `${k}: pick a building or a unit` });
    if (k === 'camera' && !e.site && !e.building) out.push({ path, field: `${field}.site`, msg: 'camera: pick a story site or a building' });
    if ((k === 'travel' || k === 'route' || k === 'unroute') && !e.region) out.push({ path, field: `${field}.region`, msg: `${k}: pick a region` });
    if (k === 'travel' && typeof e.region === 'string' && e.region === region) out.push({ path, field: `${field}.region`, msg: 'travels to the region it is already in' });
    if (k === 'hint' && e.target === 'buildItem' && !e.building) out.push({ path, field: `${field}.building`, msg: 'a build-menu hint needs the building' });
    if (k === 'spawn' && typeof e.unit === 'string' && db.units[e.unit]?.nest) out.push({ path, field: `${field}.unit`, msg: 'nests grow on predator spawns; spawn the creatures instead' });
    if ((TEXT_NEEDED.includes(k) || (k === 'glitch' && (e.glitch ?? 'log') === 'log')) && !e.text) out.push({ path, field: `${field}.text`, msg: k === 'glitch' ? 'a log glitch needs the Text (the line the Clause writes)' : `required when the effect is ${k}` });
    if (k === 'attitude') {
      if (!e.faction) out.push({ path, field: `${field}.faction`, msg: 'an attitude change needs the faction' });
      else { const miss = factionMissing(e.faction as string, region); if (miss) out.push({ path, field: `${field}.faction`, msg: miss }); }
    }
    if (k === 'corrupt' && typeof e.unit === 'string' && db.units[e.unit] && db.units[e.unit].faction !== 'accord') out.push({ path, field: `${field}.unit`, msg: 'only our own (Accord) units can be corrupted' });
    if (k === 'strike' && e.site && e.building) out.push({ path, field: `${field}.building`, msg: 'a strike hits the Site or a Building of a kind, not both' });
    if (k === 'strike' && typeof e.building === 'string' && db.buildings[e.building]?.role === 'wall') out.push({ path, field: `${field}.building`, msg: 'aim it at something worth hitting (not a wall)' });
    if (k === 'epilogue' && !e.ending) out.push({ path, field: `${field}.ending`, msg: 'an epilogue needs its Ending' });
    if (k === 'mission' && !e.mission) out.push({ path, field: `${field}.mission`, msg: 'pick the mission to start' });
    if (k === 'outpost') {
      if (!e.faction && !e.site && !e.story) out.push({ path, field: `${field}.faction`, msg: 'name the outposts: a Faction, a Site, or one outpost\'s story flag' });
      if (typeof e.faction === 'string' && e.faction) { const miss = factionMissing(e.faction, region); if (miss) out.push({ path, field: `${field}.faction`, msg: miss }); }
      if (typeof e.story === 'string' && e.story) {
        const maps = region ? [db.regions[region]] : Object.values(db.regions);
        if (!maps.some((r) => r?.outposts?.some((o) => o?.story === e.story))) out.push({ path, field: `${field}.story`, msg: `no region${region ? ` "${region}"` : ''} has an outpost with the story flag "${e.story}"` });
      }
    }
    ((e.pages as { text?: string }[] | undefined) ?? []).forEach((p, n) => { if (!p?.text?.trim()) out.push({ path, field: `${field}.pages[${n}].text`, msg: 'a page needs some text' }); });
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
    (ev.choices ?? []).forEach((c, n) => {
      if (c?.ifFlag && c.ifFlag === c.unlessFlag) out.push({ path: P, field: `choices[${n}].unlessFlag`, msg: 'the same flag as Only if flag: it would never be offered' });
    });
    if (ev.style === 'radio' && ev.choices?.length) out.push({ path: P, field: 'choices', msg: 'a radio message can\'t have choices (make it a card)' });
    if (ev.style === 'radio' && ev.lines?.length) out.push({ path: P, field: 'lines', msg: 'a radio message is one line (make it a card for a conversation)' });
    // a card about one colonist: effects on "the one", and {who}, need a cast
    (ev.effects ?? []).forEach((e, n) => {
      if (!ev.cast && (e?.one || e?.kind === 'favourLine' || e?.kind === 'rescue')) out.push({ path: P, field: `effects[${n}]`, msg: 'needs the event to be About someone (its cast)' });
      if (e?.kind === 'boost' && !e.stat) out.push({ path: P, field: `effects[${n}].stat`, msg: 'a boost needs what it Changes' });
      if (e?.kind === 'policy' && !/^(hours|rations|oversight|council):\w+$/.test(e.policy ?? '')) out.push({ path: P, field: `effects[${n}].policy`, msg: 'key:value, e.g. hours:short' });
    });
    const words = [ev.title, ev.text, ...(ev.choices ?? []).flatMap((c) => [c.label, c.reply ?? ''])].join(' ');
    if (!ev.cast && /\{who(Line)?\}/.test(words)) out.push({ path: P, field: 'cast', msg: '{who} needs the event to be About someone' });
    if (ev.again && !ev.dilemma) out.push({ path: P, field: 'again', msg: 'only colony dilemmas come again' });
  }
  // the Field Guide: tip triggers like story triggers; See also names real pages; versions are x.y.z; one tour
  for (const [id, g] of Object.entries(db.guide ?? {})) {
    if (!g || typeof g !== 'object') continue;
    const P = `guide/${id}.json`;
    if (g.trigger) condIssues(P, '', g.trigger, g as unknown as Record<string, unknown>);
    for (const x of seeAlso(g)) {
      if (x === id) out.push({ path: P, field: 'see', msg: 'a page can\'t send you to itself' });
      else if (!db.guide[x]) out.push({ path: P, field: 'see', msg: `there is no guide page "${x}" (content/guide/${x}.json)` });
    }
    for (const f of ['since', 'updated'] as const) if (typeof g[f] === 'string' && !VERSION_RE.test(g[f])) out.push({ path: P, field: f, msg: `"${g[f]}" is not a version (write x.y.z, e.g. 0.73.0)` });
    if (g.tour?.length && id !== 'orientation') out.push({ path: P, field: 'tour', msg: 'only the orientation page\'s tour is played' });
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
    if (typeof cd.music === 'string' && cd.music && !db.music?.[cd.music] && !['day', 'night', 'tension', 'title'].includes(cd.music)) out.push({ path: P, field: 'music', msg: `"${cd.music}" is neither a piece in Rules → Music nor day, night, tension or title` });
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
    (r.expedition?.[0]?.units ?? []).forEach((u, k) => { if (u?.unit && db.units[u.unit] && db.units[u.unit].faction !== 'accord') out.push({ path: P, field: `expedition[0].units[${k}].unit`, msg: 'an expedition brings Accord units' }); });
    if (id === 'touchdown' && r.expedition?.length) out.push({ path: P, field: 'expedition', msg: 'Touchdown is the home colony, not an expedition' });
    const n = regionCells(half);
    for (const g of ['height', 'flora', 'ground'] as const) {
      const v = r[g];
      if (Array.isArray(v) && v.length !== n) out.push({ path: P, field: g, msg: `has ${v.length} rows; a ${size} u region needs ${n} (resize it in the map editor)` });
    }
    for (const k of ['herds', 'deposits', 'spawns', 'vents', 'camps', 'sites', 'wrecks', 'seams', 'relics', 'encounters', 'outposts'] as const) {
      (r[k] as { x?: number; z?: number }[] | undefined)?.forEach((m, i) => {
        if (m && (Math.abs(m.x ?? 0) > half || Math.abs(m.z ?? 0) > half)) out.push({ path: P, field: `${k}[${i}]`, msg: `outside the region (it's ${size} u across)` });
      });
    }
    // encounters: hostile units, unique ids
    const encIds = new Set<string>();
    (r.encounters ?? []).forEach((e, i) => {
      if (!e) return;
      const u = db.units[e.unit];
      if (u?.faction === 'accord' && !e.faction) out.push({ path: P, field: `encounters[${i}].unit`, msg: 'an encounter is hostile: pick a fauna or relic unit (or give it a Faction)' });
      if (e.faction && u && u.faction !== 'accord') out.push({ path: P, field: `encounters[${i}].unit`, msg: 'a faction\'s encounter is Accord-pattern units (Rovers, Tanks…): wild ones have no faction' });
      if (e.faction && !(r.factions ?? []).some((f) => f?.id === e.faction)) out.push({ path: P, field: `encounters[${i}].faction`, msg: `this region has no faction "${e.faction}"` });
      if (u?.nest) out.push({ path: P, field: `encounters[${i}].unit`, msg: 'nests grow on predator spawns, not as encounters' });
      if (encIds.has(e.id)) out.push({ path: P, field: `encounters[${i}].id`, msg: `another encounter is "${e.id}"` });
      encIds.add(e.id);
    });
    // factions: unique ids and teams; outposts name one and aren't a Command Core
    const facIds = new Set<string>(), teams = new Set<number>();
    (r.factions ?? []).forEach((f, i) => {
      if (!f) return;
      if (facIds.has(f.id)) out.push({ path: P, field: `factions[${i}].id`, msg: `another faction is "${f.id}"` });
      if (f.id === 'clause') out.push({ path: P, field: `factions[${i}].id`, msg: '"clause" is the Clause\'s own team (corrupted units)' });
      if (teams.has(f.team)) out.push({ path: P, field: `factions[${i}].team`, msg: `another faction is team ${f.team}` });
      if (f.flag && f.flag === f.allyFlag) out.push({ path: P, field: `factions[${i}].allyFlag`, msg: 'the same flag as Hostile when flag' });
      facIds.add(f.id); teams.add(f.team);
    });
    (r.outposts ?? []).forEach((o, i) => {
      if (!o) return;
      if (!facIds.has(o.faction)) out.push({ path: P, field: `outposts[${i}].faction`, msg: `this region has no faction "${o.faction}"` });
      if (db.buildings[o.kind]?.role === 'core') out.push({ path: P, field: `outposts[${i}].kind`, msg: 'the Command Core is ours alone' });
    });
  }
  for (const [id, a] of Object.entries(db.assets)) {
    if (!a || typeof a.file !== 'string' || !(a.kind in ASSET_EXT)) continue;
    const ext = a.file.split('.').pop()?.toLowerCase() ?? '';
    if (!ASSET_EXT[a.kind].includes(ext)) out.push({ path: `assets/${id}.json`, field: 'file', msg: `.${ext} isn't a ${a.kind} file (${ASSET_EXT[a.kind].join(', ')})` });
  }
  return out;
}
