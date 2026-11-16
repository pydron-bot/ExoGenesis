# Exo Genesis

A browser base-building RTS with a strategy layer — Command & Conquer meets Civilization, in one
solar system. You are the caretaker AI of humanity's last seed-probe: land on an alien world,
keep the cryo bank alive, and raise the next generation.

Built with Three.js + TypeScript + Vite. Design: [docs/DESIGN.md](docs/DESIGN.md).

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
| Rotate | two-finger twist / vertical | right-drag / Q E |
| Jump | Surface / Planet / System buttons | 1 / 2 / 3 |
| Build solar | Solar, then tap ground | B, then click |
| Pause | ❚❚ | Space |

## Run

```sh
npm install
npm run dev        # http://localhost:5176 (on hive1: systemd user unit exo-dev.service)
npm run build
node tools/smoke.mjs   # colony end-to-end: orders, build menu, placement, power switch, a fight, save/load, game over
node tools/balance.mjs # headless 20-minute runs with scripted strategies (balance numbers)
node tools/shot.mjs    # headless screenshots of each zoom level → shots/
npm run content:check  # validate content/ against src/content/defs.ts
node tools/editor-smoke.mjs  # editor end-to-end (restores content/ afterwards)
node tools/map-smoke.mjs     # map editor → game end-to-end (restores the region afterwards)
node tools/asset-smoke.mjs   # asset browser → game end-to-end (restores content/ + public/media/)
node tools/editor-web-smoke.mjs  # deployed editor's GitHub backend vs a mock API (needs a /ExoGenesis/ build on vite preview :4176)
```

## Content and the editor

Game numbers and maps live in `content/` as JSON (units, buildings, regions, colony rules), not in code.
Open a region (Maps → Touchdown) to sculpt terrain, paint flora and place grazer herds.
Assets → Library lists every model (files and the built-in procedural ones); drop .glb, image or
audio files onto the editor to add them, then pick a model in a unit's or building's Model field.
Edit them at **http://hive1:5176/editor.html** (dev server only): saves write straight into
`content/`, open game tabs reload with the new values, and the Commit button commits
`content/` to the local repo. Schemas are in `src/content/defs.ts`; see DESIGN.md §6.4.

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
