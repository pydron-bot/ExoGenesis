/**
 * Asset kinds and their file extensions. Dependency-free on purpose: vite.config.ts
 * (through devtools/content-server.ts) imports it, and Vite loads the config with
 * Node's own TypeScript support, which needs explicit file extensions on imports.
 */
export const ASSET_KINDS = ['model', 'image', 'audio'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
/** Allowed file extensions per kind (lowercase, no dot). */
export const ASSET_EXT: Record<AssetKind, readonly string[]> = {
  model: ['glb'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['ogg', 'mp3', 'wav'],
};
