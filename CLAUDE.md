# Exo Genesis: working notes for Claude

- Design: `docs/DESIGN.md` (read before building). Overview and tools: `README.md`.
- `main` is live: every push deploys to https://deeek.org/ExoGenesis/ (GitHub Pages).
- The web editor commits to GitHub directly, so **`git pull --rebase` before working**.
  Editor exports (`exo-changes-*.json`) go in with `node tools/import-changes.mjs <file> --dry-run`, then `--commit`.
- **Every push that changes the game is a release:** bump `package.json` and add an entry at the top of
  `src/changelog.ts` (minor for features, patch for fixes; notes written for players). `npm run build`
  fails if they disagree (`tools/version-check.mjs`). Players see it under "What's new".
- Test URLs: `?title=0` skips the title (resume or land), `?intro=0&new=1` starts deployed and fresh,
  `?sw=0` skips the service worker (production builds register one: offline + installable, see README).
  Smoke tests in `tools/*-smoke.mjs` run against the dev server on :5176.
