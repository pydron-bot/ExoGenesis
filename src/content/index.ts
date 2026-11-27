/**
 * The game's content, loaded from /content/**.json at build time.
 *
 * Imported by both the main thread and the sim workers. In dev, saving a content
 * file (by hand or from the editor) reloads the game with the new values.
 * Invalid content doesn't crash here: `contentIssues` is non-empty and main.ts
 * shows it instead of starting.
 */
import { buildDb, requiredIssues, type FileIssue } from './db';

const raw = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' });
const files: Record<string, unknown> = {};
for (const [k, v] of Object.entries(raw)) files[k.replace(/^\/content\//, '')] = v;

// production skips validation: the build only succeeds when content:check passes
const built = buildDb(files, { check: !import.meta.env.PROD });
export const content = built.db;
export const contentIssues: FileIssue[] = [...built.issues, ...requiredIssues(built.db)];

/** A region's terrain grids (the run-length strings `regionTerrain` reads). */
export type RegionGrids = Pick<import('./defs').RegionDef, 'height' | 'ground' | 'flora'>;

/**
 * Production builds keep each region's terrain grids out of the bundle (vite.config.ts `regionGrids`): the record has
 * their address (`grids`) instead. Fetch them for the region about to be played (once; a no-op in dev, where they're
 * inline). The sim worker gets them in its init message (`regionGridsOf`).
 */
export async function loadRegionGrids(id: string): Promise<void> {
  const r = content.regions[id] as (import('./defs').RegionDef & { grids?: string }) | undefined;
  if (!r?.grids || r.height) return;
  const g = await fetch(r.grids).then((res) => { if (!res.ok) throw new Error(`terrain for ${id}: ${res.status}`); return res.json() as Promise<RegionGrids>; });
  Object.assign(r, g);
}
/** The grids `loadRegionGrids` put in (for the sim worker's init). Undefined when they're bundled anyway. */
export function regionGridsOf(id: string): RegionGrids | undefined {
  const r = content.regions[id] as (import('./defs').RegionDef & { grids?: string }) | undefined;
  return r?.grids && r.height ? { height: r.height, ground: r.ground, flora: r.flora } : undefined;
}

export type { UnitDef, BuildingDef, ColonyRules, RegionDef, HerdDef, AssetDef } from './defs';

/**
 * Dev: a content edit reloads the game, but stops here so the update isn't
 * broadcast as a full reload to every open page (the editor keeps its state).
 * A page can take the new content itself instead (the game's story inspector
 * swaps story edits in live): `onContentHot` returns true when it did.
 */
// kept on globalThis: each hot update runs a fresh copy of this module
type HotHandler = (next: typeof content) => boolean;
const G = globalThis as { __exoContentHot?: HotHandler };
export function onContentHot(fn: HotHandler) { G.__exoContentHot = fn; }
if (import.meta.hot && typeof document !== 'undefined') {
  import.meta.hot.accept((mod) => {
    const next = (mod as { content?: typeof content } | undefined)?.content;
    if (next && G.__exoContentHot?.(next)) return;
    location.reload();
  });
}
