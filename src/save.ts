/** Tiny IndexedDB key/value store for save games. */
const DB = 'exogenesis';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function putSave(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function getSave<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const v = await new Promise<T | undefined>((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
  db.close();
  return v;
}

export async function delSave(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function saveKeys(): Promise<string[]> {
  const db = await open();
  const v = await new Promise<string[]>((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).getAllKeys();
    r.onsuccess = () => res((r.result as IDBValidKey[]).map(String));
    r.onerror = () => rej(r.error);
  });
  db.close();
  return v;
}

/**
 * The old single autosave (before campaign travel). Read once at startup and moved to its region's key
 * (`migrateAutosave`); nothing writes it any more.
 */
export const AUTOSAVE = 'auto';
export interface AutoSave { version: 2; savedAt: number; sim: import('./sim/types').SimState }

/** Each region's colony, autosaved by the sim worker while it's played (campaign travel: TECH.md "Campaign travel"). */
export const regionKey = (region: string) => `region:${region}`;
/** The campaign: which region is being played, and the state every region shares (src/sim/campaign.ts). */
export const CAMPAIGN = 'campaign';
export interface CampaignSave { version: 1; savedAt: number; current: string; shared?: import('./sim/campaign').SharedState }

/** A save worth resuming: this version, deployed, not over. */
export const playable = (a: AutoSave | undefined): a is AutoSave => a?.version === 2 && !!a.sim && !a.sim.over && a.sim.phase === 'deployed';

/** An autosave from before campaign travel becomes its region's save, and that region the campaign's current one. */
export async function migrateAutosave(): Promise<void> {
  const a = await getSave<AutoSave>(AUTOSAVE);
  if (!a) return;
  if (playable(a)) {
    const region = a.sim.region ?? 'touchdown';
    const there = await getSave<AutoSave>(regionKey(region));
    if (!there || there.savedAt < a.savedAt) await putSave(regionKey(region), a);
    if (!(await getSave<CampaignSave>(CAMPAIGN))) await putSave(CAMPAIGN, { version: 1, savedAt: a.savedAt, current: region } satisfies CampaignSave);
  }
  await delSave(AUTOSAVE);
}

/** NEW GAME: every region's save and the campaign go (`keep`: keys to leave alone). Manual Save slots stay. */
export async function wipeCampaign(keep: string[] = []): Promise<void> {
  for (const k of await saveKeys()) if ((k === AUTOSAVE || k === CAMPAIGN || k.startsWith('region:')) && !keep.includes(k)) await delSave(k);
}

/**
 * Ask the browser to keep the game's saves (IndexedDB) instead of clearing them when space runs low or the site
 * hasn't been visited for a while (Safari clears after 7 days of no use unless the app is installed). Chrome and
 * Safari decide without asking; Firefox would show a prompt, so there only an installed app asks.
 */
export async function keepSaves(): Promise<boolean> {
  try {
    const st = navigator.storage;
    if (!st?.persist || (await st.persisted())) return true;
    const firefox = /firefox/i.test(navigator.userAgent);
    const installed = matchMedia('(display-mode: standalone)').matches;
    if (firefox && !installed) return false;
    return await st.persist();
  } catch { return false; }
}
