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

const built = buildDb(files);
export const content = built.db;
export const contentIssues: FileIssue[] = [...built.issues, ...requiredIssues(built.db)];

export type { UnitDef, BuildingDef, ColonyRules, RegionDef, HerdDef, AssetDef } from './defs';

// Dev: a content edit reloads the game, but stops here so the update isn't
// broadcast as a full reload to every open page (the editor keeps its state).
if (import.meta.hot && typeof document !== 'undefined') import.meta.hot.accept(() => location.reload());
