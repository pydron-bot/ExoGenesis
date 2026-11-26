/**
 * Named save files (TECH.md "Save files"): as many as the player likes, each a whole game you can go back to.
 *
 * - **Campaign:** every region's colony (`region:<id>`) and the campaign record, so loading one puts the whole
 *   campaign back, wherever you were.
 * - **Skirmish:** the sim and the setup's address (the map is generated again from it).
 * - **Domination:** the whole war's state (it's small: the strategy layer is summary numbers).
 *
 * Each file is two IndexedDB records: `filemeta:<id>` (small: what the list shows) and `file:<id>` (the game).
 * The old single Save slot (`slot1`) becomes a file the first time the list is read.
 */
import { CAMPAIGN, delSave, getSave, putSave, regionKey, saveKeys, wipeCampaign, type AutoSave, type CampaignSave } from './save';
import { sharedOf } from './sim/campaign';
import type { SimState } from './sim/types';

export type SaveKind = 'campaign' | 'skirmish' | 'domination';
export interface CameraPose { dist: number; yaw: number; pitch: number; fx: number; fz: number }

/** What the list shows. */
export interface SaveMeta {
  version: 1;
  id: string;
  name: string;
  kind: SaveKind;
  savedAt: number;
  /** Where: "Touchdown · Home" or "Skirmish · Verdance, 3 players". */
  place: string;
  /** Game time: "Sol 3, 14:22" (or "12 min" in a skirmish). */
  when: string;
  /** Rough size in bytes (shown in the list). */
  size?: number;
  /** Made by the game, not the player (the copy kept before New Game): only the newest few are kept. */
  auto?: boolean;
}

export interface SaveBody {
  version: 1;
  /** The region played when saved (campaign: where loading takes you). */
  region: string;
  camera?: CameraPose;
  /** Campaign: the IndexedDB records it puts back (`region:<id>`, `campaign`). */
  records?: Record<string, unknown>;
  /** Campaign from the old single slot: only its region's record, laid over the campaign rather than replacing it. */
  partial?: boolean;
  /** Skirmish: the game and the address that set it up (`?skirmish=…`). */
  sim?: SimState;
  url?: string;
  /** Domination: the whole war (src/sim/domination.ts), played on domination.html. */
  dom?: import('./sim/domination').DomState;
}

/** An exported save (one .json file). */
export interface SaveExport { exoSave: 1; meta: SaveMeta; body: SaveBody }

const META = 'filemeta:';
const BODY = 'file:';
export const LEGACY_SLOT = 'slot1';

const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };

/** Every save file, newest first. */
export async function listSaves(): Promise<SaveMeta[]> {
  await migrateSlot().catch((e) => console.warn('old save slot not moved', e));
  const keys = (await saveKeys()).filter((k) => k.startsWith(META));
  const metas = await Promise.all(keys.map((k) => getSave<SaveMeta>(k)));
  return metas.filter((m): m is SaveMeta => m?.version === 1 && !!m.id).sort((a, b) => b.savedAt - a.savedAt);
}

export const readSave = (id: string) => getSave<SaveBody>(BODY + id);

/** Write a save: a new file (no `id`) or over an existing one. Returns its meta. */
export async function writeSave(meta: Omit<SaveMeta, 'version' | 'id' | 'savedAt' | 'size'> & { id?: string; savedAt?: number }, body: SaveBody): Promise<SaveMeta> {
  const m: SaveMeta = { version: 1, id: meta.id ?? newId(), name: meta.name.trim() || 'Untitled', kind: meta.kind, savedAt: meta.savedAt ?? Date.now(), place: meta.place, when: meta.when, size: sizeOf(body), ...(meta.auto ? { auto: true } : {}) };
  // the game first: a meta never points at nothing
  await putSave(BODY + m.id, body);
  await putSave(META + m.id, m);
  return m;
}

export async function renameSave(id: string, name: string): Promise<void> {
  const m = await getSave<SaveMeta>(META + id);
  if (m) await putSave(META + id, { ...m, name: name.trim() || m.name });
}

export async function deleteSave(id: string): Promise<void> {
  await delSave(META + id);
  await delSave(BODY + id);
}

/**
 * The campaign as it stands, for a save file: every region's save on disk, with this region's taken from `here`
 * (fresh from the sim), and the campaign record pointing at this region.
 */
export async function campaignRecords(region: string, here: SimState): Promise<Record<string, unknown>> {
  const records: Record<string, unknown> = {};
  for (const k of await saveKeys()) if (k.startsWith('region:') && k !== regionKey(region)) records[k] = await getSave(k);
  const savedAt = Date.now();
  records[regionKey(region)] = { version: 2, savedAt, sim: here } satisfies AutoSave;
  records[CAMPAIGN] = { version: 1, savedAt, current: region, shared: sharedOf(here) } satisfies CampaignSave;
  return records;
}

/**
 * Put a campaign file's records back. A whole campaign replaces the one in this browser (every region's autosave);
 * the old single slot only puts its region back (the rest of the campaign stays). Returns the region to go to.
 */
export async function restoreCampaign(body: SaveBody): Promise<string> {
  const recs = body.records ?? {};
  if (!body.partial) await wipeCampaign();
  // stamped now, so the autosaves read as current (a newer campaign record would lay its shared state over them)
  const now = Date.now();
  for (const [k, v] of Object.entries(recs)) {
    if (k === CAMPAIGN || !k.startsWith('region:')) continue;
    await putSave(k, { ...(v as AutoSave), savedAt: now + 1 });
  }
  const camp = recs[CAMPAIGN] as CampaignSave | undefined;
  const here = recs[regionKey(body.region)] as AutoSave | undefined;
  const shared = camp?.shared ?? (here?.sim ? sharedOf(here.sim) : undefined);
  await putSave(CAMPAIGN, { version: 1, savedAt: now, current: body.region, shared } satisfies CampaignSave);
  return body.region;
}

/** Copies the game keeps before New Game (the newest ones; older go). */
const AUTO_KEEP = 3;

/**
 * Before New Game wipes the campaign: keep it as a save file ("Before new game · <date>"), so starting over by
 * mistake can be undone from Save & load. `here`: the region being played and its state fresh from the sim (else the
 * autosaves on disk). Nothing to keep (no colony anywhere): null.
 */
export async function backupCampaign(info: { place: string; when: string }, here?: { region: string; sim: SimState }): Promise<SaveMeta | null> {
  let records: Record<string, unknown>;
  let region: string;
  if (here) {
    records = await campaignRecords(here.region, here.sim);
    region = here.region;
  } else {
    records = {};
    for (const k of await saveKeys()) if (k.startsWith('region:') || k === CAMPAIGN) records[k] = await getSave(k);
    const camp = records[CAMPAIGN] as CampaignSave | undefined;
    region = camp?.current ?? Object.keys(records).find((k) => k.startsWith('region:'))?.slice('region:'.length) ?? '';
  }
  if (!Object.keys(records).some((k) => k.startsWith('region:')) || !region) return null;
  const date = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const meta = await writeSave({ name: `Before new game · ${date}`, kind: 'campaign', place: info.place, when: info.when, auto: true }, { version: 1, region, records });
  // only the newest few
  const autos = (await listSaves()).filter((m) => m.auto);
  for (const old of autos.slice(AUTO_KEEP)) await deleteSave(old.id);
  return meta;
}

/** The old single Save (before save files): one region's sim, now a file of its own. */
async function migrateSlot() {
  const old = await getSave<{ version: 1; savedAt: number; sim: SimState; camera?: CameraPose }>(LEGACY_SLOT);
  if (!old) return;
  if (old.sim) {
    const region = old.sim.region ?? 'touchdown';
    await writeSave(
      { name: 'Saved game (older version)', kind: 'campaign', savedAt: old.savedAt, place: region, when: '' },
      { version: 1, region, camera: old.camera, partial: true, records: { [regionKey(region)]: { version: 2, savedAt: old.savedAt, sim: old.sim } satisfies AutoSave } },
    );
  }
  await delSave(LEGACY_SLOT);
}

/** A save as one .json file to keep or move to another browser. */
export async function exportSave(id: string): Promise<{ name: string; text: string } | null> {
  const meta = await getSave<SaveMeta>(META + id), body = await readSave(id);
  if (!meta || !body) return null;
  const file = (meta.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'save').toLowerCase();
  return { name: `exo-save-${file}.json`, text: JSON.stringify({ exoSave: 1, meta, body } satisfies SaveExport) };
}

/** Read an exported file back in as a new save (its own id; the name kept). Throws with a reason players can read. */
export async function importSave(text: string): Promise<SaveMeta> {
  let f: SaveExport;
  try { f = JSON.parse(text); } catch { throw new Error('That file isn’t a save (it couldn’t be read)'); }
  if (f?.exoSave !== 1 || !f.meta || !f.body) throw new Error('That file isn’t an Exo Genesis save');
  if (f.meta.kind !== 'campaign' && f.meta.kind !== 'skirmish' && f.meta.kind !== 'domination') throw new Error('That save is from a newer version of the game');
  if (f.meta.kind === 'skirmish' && (!f.body.sim || !f.body.url)) throw new Error('That save is incomplete');
  if (f.meta.kind === 'campaign' && !f.body.records) throw new Error('That save is incomplete');
  if (f.meta.kind === 'domination' && f.body.dom?.version !== 1) throw new Error('That save is incomplete');
  const { id: _id, version: _v, size: _s, ...rest } = f.meta;
  return writeSave(rest, f.body);
}
