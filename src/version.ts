/**
 * The running version (package.json, via vite.config.ts's `define`). Kept apart from
 * src/changelog.ts so the game doesn't download every release note just to show its version:
 * the notes load when "What's new" opens.
 */
export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
