# Exo Genesis

A browser base-building RTS with a strategy layer — Command & Conquer meets Civilization, in one
solar system. You are the caretaker AI of humanity's last seed-probe: land on an alien world,
keep the cryo bank alive, and raise the next generation.

Built with Three.js + TypeScript + Vite. Design: [docs/DESIGN.md](docs/DESIGN.md). What's built, how it works and what was measured:
[docs/TECH.md](docs/TECH.md). Story: [docs/STORY.md](docs/STORY.md).

## Status — M0 tech demo

- **Continuous zoom** from the landing site → planet globe → whole solar system, no loading.
  The detailed landing region is laid onto the low-poly globe and stays in place as you climb.
- **Simulation in a Web Worker** at a fixed 10 Hz tick; the renderer interpolates snapshots.
  All game state is plain data.
- **Save / Load** to IndexedDB (this browser only).
- **The landing:** Command Core, one worker drone, 160 grazing creatures that scatter from
  the drone, a cryo bank losing power until you build a solar array.
- **Home planet:** radius 3,000 units (~30 km at game scale) carved into 89 fixed land regions —
  the held landing region (Touchdown), four tutorial regions around it, and larger regions across
  the rest of the globe. Borders, fills and labels fade in from orbit.
- **System:** star; 9 planets (Cinder, Ash, Verdance — temperate, Home, Dunmore, Thalassa and
  Halcyon gas giants, Nereid ice giant, Rime — frozen); 12 moons; main asteroid belt and an outer
  icy belt (instanced); two comets on eccentric orbits; orbit paths, markers and labels.

## Domination (`domination.html`, title → DOMINATION)

A long war for the whole solar system on a strategy map of its 40 areas (DESIGN §5.12). Its own page, like the
editor; the war autosaves to IndexedDB (`domination`) and saves to the same named save files as the rest of the game.
Rules and computer players: `src/sim/domination.ts`, `src/sim/domination-ai.ts` (`node tools/domination-sim.mjs`);
the page: `src/domination/main.ts` (`node tools/domination-smoke.mjs`). `?load=<file id>` opens a save file.
The setup has teams, fog of war and a "hold 75%" victory; `node tools/domination-ai-sim.mjs --check` plays computer
wars under every rule and checks they end and are fair.

## Skirmish proof of concept (`?mode=skirmish`, or the ⚔ Skirmish button)

Hundreds of units vs escalating fauna waves, to test mobile RTS performance and touch selection.

- **Sim:** structure-of-arrays units in the worker, Dijkstra flow fields on a 2-unit nav grid
  (water and steep slopes blocked), spatial-hash separation and targeting, splash damage.
  ~3 ms/tick at the 1,500-unit cap on hive1.
- **Render:** one instanced draw per unit type + glow layer, pooled tracers and bursts; ~40 draws total.
- **Selection on touch:** tap a unit · hold or double-tap → every unit of that type on screen ·
  ✎ Paint then swipe over units · control groups 1–4 (hold to save, tap to recall, double-tap to
  recall + centre) · tap ground to attack-move · drag from a selected unit to aim. Desktop also has
  box-select (left-drag) and right-drag pan.
- `?units=` (army size, also the Army button) and `?wave=` (base wave size). `node tools/skirmish-smoke.mjs`.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Order the drone | drag from the drone to a spot | same, or click drone then click ground |
| Pan | drag the ground | drag / WASD / arrows |
| Zoom | pinch | wheel / + − |
| Rotate | two-finger twist / vertical | right-drag (or shift-drag) / Q E |
| Jump | Surface / Planet / System buttons | 1 / 2 / 3 |
| Build solar | Solar, then tap ground | B, then click |
| Pause / speed | ❚❚ ▶ ⏩ | Space · [ ] |
| Select several units | hold empty ground until it buzzes, then paint over them · hold or double-tap a unit: all of its type | Ctrl-drag a box (Shift too: add) · hold the button on the ground, then paint · double-click: all of a type |
| Send the selection | tap the ground | click or right-click the ground |
| Look at the selection | | F / Home (nothing selected: the Core) |
| Next idle drone | | . or the ⛭ chip |
| Control groups | | Ctrl/Shift + 4–9 to save, 4–9 to select (twice: look) · Ctrl+A all units |
| Save | menu → Save | Ctrl+S |
| Latest alert | tap a ◎ log line | H |
| Unit ability | ⚡ button on the unit card | G |
| Every key | menu → Controls | ? |

## Run

```sh
npm install
npm run dev        # http://localhost:5176 (on hive1: systemd user unit exo-dev.service)
npm run build
node tools/select-smoke.mjs  # selecting several units: paint (mouse and touch), Ctrl-drag box, Ctrl+Shift adds, a quick drag still pans
node tools/qol-smoke.mjs   # controls: held-key pan, F, idle drones, right-click, groups, speed keys, PAUSED, Controls, Recycle, zoom to cursor
node tools/smoke.mjs   # colony end-to-end: orders, build menu, placement, power switch, a fight, save/load, game over
node tools/look-smoke.mjs  # Options → Terrain look switches in place (no reload), pads stay level, remembered
node tools/balance.mjs # headless 20-minute runs with scripted strategies (balance numbers)
node tools/opening.mjs # headless: the campaign's first 20 minutes at a human pace (first build, fight, colonist, waiting)
node tools/unit-duel.mjs --check # headless: every combat unit against every other at equal cost, and against a gun line
node tools/roster-smoke.mjs # headless checks for every unit, building and predator mechanic
node tools/shot.mjs    # headless screenshots of each zoom level → shots/
node tools/music-render.mjs <mood> [--seconds 90] [--seed N]  # render a music mood to music-drafts/<mood>.wav (needs the dev server; --seed: the same notes every time)
node tools/music-gen.mjs [--only title] [--dry-run]  # reference tracks from ElevenLabs Music (tools/music-prompts.json; key in ~/.config/elevenlabs/api_key) → music-drafts/
npm run content:check  # validate content/ against src/content/defs.ts
npm run guide:check    # every release updates the Field Guide (content/guide; part of npm run build)
node tools/guide-smoke.mjs   # Field Guide: the check's rules, tips (headless, and the opening's tip count); panel, tour, tips, phone (--headless)
node tools/editor-smoke.mjs  # editor end-to-end (restores content/ afterwards)
node tools/editor-checks-smoke.mjs  # undo, content checks, Problems, Rename, Compare, Text, Since last release
node tools/import-smoke.mjs        # editor: Import a music mood from JSON and Copy JSON (removes its test mood afterwards)
node tools/editor-more-smoke.mjs    # map overlays + copy/paste, Planet, balance runs, play test setup, characters, timeline, interface
node tools/cinematic-smoke.mjs      # cinematics: triggers and effects (headless), the landing, a world cinematic (pause, lines, skip)
node tools/gameplay-smoke.mjs       # story gameplay (headless): spawns, locks, countdowns, counters, groups, fail/win, encounters, inspector
node tools/story-tools-smoke.mjs    # script import, branch graph, endings ledger, To do, playthrough page
node tools/playthrough.mjs          # headless campaign playthroughs: the story's timeline per choice policy, and coverage
node tools/autopilot-smoke.mjs     # autopilot (title Options → Watch the computer play): the live bot, cards, director, Stop, travel, its fights, the ending (--headless-only)
node tools/autopilot-campaign.mjs  # how far the autopilot gets through the campaign, headless (--seeds 1337,1,2 for a table; --assist; --trace)
node tools/map-smoke.mjs     # map editor → game end-to-end (restores the region afterwards)
node tools/asset-smoke.mjs   # asset browser → game end-to-end (restores content/ + public/media/)
node tools/editor-web-smoke.mjs  # deployed editor's GitHub backend vs a mock API (needs a /ExoGenesis/ build on vite preview :4176)
node tools/pwa-smoke.mjs     # installable app: manifest, icons, service worker, offline boot (same /ExoGenesis/ preview)
node tools/make-icons.mjs    # re-render the app icons from public/icons/icon.svg
node tools/compress-models.mjs  # meshopt-compress new models in public/media/model (skips compressed ones)
```

## Installable app (PWA)

On a phone, **Add to Home Screen** (iOS Safari: Share → Add to Home Screen; Android Chrome: ⋮ →
Install app) gives an icon that opens the game full-screen. After the first visit it also plays
offline. Pieces: `public/manifest.webmanifest`, icons in `public/icons/` (from `icon.svg` via
`tools/make-icons.mjs`), the iOS tags in `index.html`, and a service worker built into `dist/sw.js`
by `vite.config.ts` from `src/sw-template.js` (registered by `src/pwa.ts`, production builds only).
It precaches the game (not the editor) under a cache named for the build; pages, content and media
are network-first, so a release shows on the next load; hashed `assets/` are cache-first.
`?sw=0` skips registering it. As an installed app `src/viewport.ts` sets `html.app`: the top HUD gets
12 px more room under the status bar (`--safe-top`), and on iOS the app area takes the full screen
height (`--app-h`, `viewH()`: use it instead of `innerHeight`), which iOS can under-report.

## Versions

`package.json` holds the version and `src/changelog.ts` the release notes players see under
**What's new** (title screen footer, game menu). Every push that changes the game bumps both:
minor for features, patch for fixes. `npm run build` checks they agree (`npm run version:check`).

## Content and the editor

Game numbers and maps live in `content/` as JSON (units, buildings, regions, colony rules), not in code.
Open a region (Maps → Touchdown) to sculpt terrain, paint flora and the ground's colour, generate landforms
(hills, ridges, craters, mesas, dunes…), change its size and place grazer herds. Maps → Worlds holds every planet,
moon, asteroid and comet (radius, terrain, colours, sky, orbit); any but a gas giant can hold regions, and Maps →
Planet map places them on each body. Story → Story board lays missions, events, cinematics, characters, inhabitants
and the story bible out by chapter.
Assets → Library lists every model (files and the built-in procedural ones); drop .glb, image or
audio files onto the editor to add them, then pick a model in a unit's or building's Model field.
Story → Characters, missions and story events write the campaign (story effects can spawn units, lock the build
menu, run countdowns and counters, point tutorial hints at the HUD, place waypoints and win or lose the game);
Script import turns a screenplay into events, Branch graph and Endings ledger show how it all links up, and
Playthrough has the bot play the campaign and report what never fired. Play tests open with a story inspector
(and take story edits live in dev); Cinematics holds the opening landing and
any cinematics you add (camera, captions, lines, sounds, a trigger or a story event to play them); Rules → Interface is the HUD's look. **Checks** (top of the sidebar) lists every
content problem, every player-facing string (Text), what changed since the last release, and To do (open comments,
status, missing pieces and the voice script).
Edit them at **http://hive1:5176/editor.html** (dev server only): saves write straight into
`content/`, open game tabs reload with the new values, and the Commit button commits
`content/` to the local repo. Schemas are in `src/content/defs.ts`; see DESIGN.md §6.4 and, per feature, [docs/TECH.md](docs/TECH.md) §1.

The same editor is live at **https://deeek.org/ExoGenesis/editor.html**. There it asks once per
browser for a fine-grained GitHub token (this repo only, Contents: read and write). Saves stay in
that browser (IndexedDB) until Commit, which makes one commit on `main` and so redeploys the site.
Those commits land on GitHub, not on hive1: **pull before working on hive1** (`git pull --rebase`).

Without a token, pick **Work without GitHub**: the editor starts from the content the site was
built with (`content-manifest.json`), and **Export** downloads every change as one
`exo-changes-*.json`. Apply it on hive1 with

```bash
node tools/import-changes.mjs exo-changes-….json --dry-run   # what it would do
node tools/import-changes.mjs exo-changes-….json --commit    # apply, content check, commit
```

Each change records the file's git blob sha when it was edited; anything changed here since is
a conflict and nothing is written unless `--force`. Paths outside `content/*.json` and
`public/media/<kind>/` are refused. Once the site redeploys with them, the exported edits clear
from the browser by themselves.
