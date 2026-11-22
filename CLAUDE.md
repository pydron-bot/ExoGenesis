# Exo Genesis: working notes for Claude

- Design: `docs/DESIGN.md` (read before building). As built (how each feature works, its tests and
  measurements): `docs/TECH.md`; add to it when a feature lands, don't grow DESIGN.md. Story: `docs/STORY.md`.
  Overview and tools: `README.md`.
- `main` is live: every push deploys to https://deeek.org/ExoGenesis/ (GitHub Pages).
- The web editor commits to GitHub directly, so **`git pull --rebase` before working**.
  Editor exports (`exo-changes-*.json`) go in with `node tools/import-changes.mjs <file> --dry-run`, then `--commit`.
- **Every push that changes the game is a release:** bump `package.json` and add an entry at the top of
  `src/changelog.ts` (minor for features, patch for fixes; notes written for players). `npm run build`
  fails if they disagree (`tools/version-check.mjs`). Players see it under "What's new".
- **Every release also updates the Field Guide** (`content/guide/*.json`, the in-game guide for players): add or
  revise the pages the change touches, set their `updated` to the new version, and list them in the release's
  `guide` field in `src/changelog.ts` (`guide: []` only for a patch that changes nothing a player needs to learn).
  `npm run build` fails otherwise (`tools/guide-check.mjs`).
- Test URLs: `?title=0` skips the title (resume or land), `?intro=0&new=1` starts deployed and fresh,
  `?sw=0` skips the service worker (production builds register one: offline + installable, see README).
  `?story=<id>` fires a story event once deployed, `?mission=<id>` jumps to a mission, `?cinematic=<id>` plays a cinematic. Smoke tests in `tools/*-smoke.mjs` run against the
  dev server on :5176 (don't edit source files while they run: the dev server reloads the page).
