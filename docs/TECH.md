# Exo Genesis — As Built

> What's in the game, how each part works and how it's tested, feature by feature. `DESIGN.md` says
> what the game should be; this file records what was built and measured. Moved out of `DESIGN.md`
> (§6.4, §7, §9) on 2026-11-17; newer entries go at the end of their section.

- [1. Content and the editor](#1-content-and-the-editor)
- [2. Models, rendering and lights](#2-models-rendering-and-lights)
- [3. M1 — one region](#3-m1--one-region)
- [4. M2 — people](#4-m2--people)
- [5. Proof of concept and performance](#5-proof-of-concept-and-performance)

## 1. Content and the editor

How content is stored and edited in general (one JSON record per file, schemas in
`src/content/defs.ts`, the editor's two backends) is in `DESIGN.md` §6.4. Per feature:

- **Regions** are `content/regions/<id>.json`: a sculpt grid added to the generated terrain and a
  flora paint grid (both 121×121, one sample per 2 u, one run-length-encoded row per line), plus
  herds and flora seed/density. The landing pad and Command Core stay at the origin (the landing
  cinematic depends on them); sculpting fades out over the last 14 u so the patch meets the globe.
  Since v0.15.0 any region is playable: `?region=<id>` (the title's REGION choice when there is
  more than one) picks it, otherwise the autosave's region does, so CONTINUE goes back to the
  colony; saves record `region` and refuse to load in another one. A region's `siteLat`/`siteLon`
  (degrees from Touchdown) place it on the planet: the region frame and camera never move, the
  generated ground turns under them (`setRegionSite` in `src/world/planet.ts`). Optional
  `packScale`, `graceSeconds`, `waveInterval`, `startAlloys` override the rules per region. The
  editor's **▶ Play this region** puts the draft in localStorage (`exo.preview`) and opens
  `?preview=1&intro=0`, which plays it without reading or writing the autosave (`?scratch=1` does
  only the latter). The sim worker gets its region in an `init` message before its first game.
  Test: `tools/region-smoke.mjs`; headless: `node tools/balance.mjs --region <id>`.
- **Story events** (v0.18.0) are `content/story/<id>.json` (editor: Story → Story events): a
  **trigger** (start, time = Sol N, built = first finished building of a kind, colonists ≥ N,
  packs beaten ≥ N, site = a drone or unit reaches a region's **story site**, contact / trust with an
  inhabitant group, flag set, after = another event answered, never = only started by an effect),
  optional delay, region and "unless flag"; a **card** (title, speaker, text, up to 4 choices with a
  logged reply, or Continue; `pause` pauses the game while it's open); and **effects**, each run when
  the event fires or after one choice (log, alloys, biomass, stance, wellbeing, regard, flag, unflag,
  start another event, next pack now). Each event fires once per game. `src/sim/story.ts` checks
  triggers once a second; fired, answered, flags, the card inbox and delays are saved. Story sites
  are a region list (`sites`: id, x, z, radius), placed with the map editor's Add site (S).
  The editor form shows only the fields the chosen trigger or effect uses (a field's `when` in the
  schema), edits lists (choices, effects) in place, previews the card as the game draws it, sums up
  what the event does (and which events follow it or start it), and **▶ Play test this event**
  opens a scratch game on its region that fires it straight away, unsaved edits included
  (`exo.preview` carries `story`; `?story=<id>` does the same for a saved event). Automated tests
  (Playwright) ignore story pauses unless they asked for a story. Content checks: a site trigger needs
  that site on a map; an effect can't follow a missing choice. Test: `tools/story-smoke.mjs`
  (`--headless-only` skips the browser half); `tools/sim-entry.ts` gives headless tests the sim
  and its content from one module graph, so they can add records.
- **Missions** (v0.19.0) are `content/missions/<id>.json` (editor: Story → Missions): a title,
  the mission it follows (`after`; none = starts when the colony deploys), an optional region,
  **objectives** (text for the GOALS panel plus a condition), story events to fire at the start and
  when done, and **rewards** (the same effects as story events). Objectives can be met in any order
  and stay met. Story triggers and objectives share one set of **conditions** (`CONDITIONS` in
  `src/content/defs.ts`, evaluated by `src/sim/conditions.ts`): start, time, built (Count of a
  building), colonists, pod, units, drones, packs, site, contact, trust, flag, after (an event
  answered), mission (one done), never. `src/sim/missions.ts` checks once a second (a finished
  mission starts the next in the same check); saves keep missions, and an older save catches up
  quietly. The GOALS panel shows the missions under way; the old hard-coded goals are now the
  Touchdown chain: Touchdown → Groundwork → First Night → Firstborn → Beyond the Ridge (STORY.md §8).
  The editor sums a mission up (what it follows, each objective, rewards, what follows it, events
  waiting on it); **▶ Play test this mission** opens a scratch game with the missions before it done
  (`?mission=<id>` for a saved one). Test: `tools/mission-smoke.mjs`.
- **Editor tools** (v0.19.0): **Story flow** (Story group; `src/editor/flow.ts`): the campaign in
  order with each mission's objectives, rewards and events; every story event by trigger with what
  its choices lead to; a flag index (set by / cleared by / waited on / blocks); and problems (a flag
  nothing sets, a "never" event nothing starts, following a missing event, missions that never
  start). **Balance table** (Game data): units and buildings in sortable columns, with damage per
  second and value per 100 alloys. **Search** (top of the sidebar, `/`): names, ids and any text.
  **Used by** (right panel): every record that refers to the open one. **Review** (click the
  uncommitted-changes count): each changed file's diff against the last commit, before Commit
  (`GET /__content/orig` on both backends). Test: `tools/editor-tools-smoke.mjs`.
- **Editor tools, part 2** (v0.20.0). Record forms: **undo / redo** (Ctrl+Z / Ctrl+Shift+Z; typing in
  one field within a second is one step; the map keeps its own undo), **Rename** (new id: writes the new
  file, points every `ref` at it, deletes the old one; refuses the ids in `REQUIRED`; warns that saves
  remember ids), **Compare** (two records of a collection side by side, `#compare/<coll>/<a>/<b>`).
  Every field shows the same problems `content:check` would (the editor runs `buildDb` with the draft in,
  so rules that span records show at the field), and **Checks → Problems** lists them all. **Checks →
  Text** (`src/editor/pages.ts`): every player-facing string, editable in place with the browser's
  British spell check, style notes (double spaces, unmatched quotes, repeated words…) and a names index.
  **Checks → Since last release**: field-by-field changes since the newest commit that changed
  `package.json` (`GET /__content/release` on both backends; file mode compares with the deployed build),
  with a first draft of release notes. **Map**: overlays (build area and unbuildable ground with the
  placement rule's tests, distance rings, the way packs walk in: the sim's steering replayed from each
  spawn, timed), **Select area** (A) + Ctrl+C / Ctrl+V copies sculpt, flora and markers between regions
  (`exo.map.clip`; optionally the ground's absolute shape, feathered). **Maps → Planet**
  (`src/editor/planet.ts`): all regions on an equirectangular map in Touchdown's frame, drag to set
  `siteLat`/`siteLon`, overlaps flagged (`planet.ts` now exports `bodyHeight`, `siteLift`, `siteDir`).
  **Balance → Test runs**: the balance bot moved to `src/sim/balance.ts` (strategies in
  `src/sim/strategies.ts`; `tools/balance.mjs` output unchanged) and runs in a worker
  (`balance-worker.ts`) on the editor's saved content, with curves and the change from the previous run.
  Browser and Node runs of the same seed differ slightly (their maths functions round differently in
  the last bit; each is deterministic). **Play test setup** (`src/editor/playsetup.ts`, `PlaySetup` in
  `sim/types.ts`, `Sim.playSetup`): story and mission play tests can start at Sol N with finished
  buildings, colonists, alloys, flags, no predators. Test: `tools/editor-checks-smoke.mjs`,
  `tools/editor-more-smoke.mjs`.
- **Characters and conversations** (v0.20.0): `content/characters/<id>.json` (Story → Characters: name,
  role, colour, image portrait, writer's notes). Story events gain `character` (instead of free-text
  `speaker`), `lines` (more lines, one page each, Next; the choices come last) and `style: radio` (a
  transmission in its own corner panel that closes itself and is logged; no choices or lines). `{first}`
  in story text and character names is the first pod-born colonist's given name (`PeopleState.first`,
  set at their decant; older saves catch up). New conditions: `firstAge` (the first colonist is Count
  years old), `acceptance` / `distrust` (adults' average AI acceptance ≥ / ≤ Count). The Director and the
  Firstborn are the first two characters.
- **Landing timeline** (v0.20.0): `content/rules/landing.json` (Cinematics → Landing): ten beats (burn,
  touchdown, open, power, dissolve, reclaimed, hatch, drone, post, end), camera keys (look at the probe or
  a ground point; distance, pitch, yaw; `follow` widens the chase with altitude) interpolated per channel
  with a monotone cubic (`src/world/curve.ts`), and captions with `{alt}`, `{speed}`, `{shield}`. The keys
  were fitted to the old hand-written camera (within ~2% distance and 0.7°). The editor's timeline
  (`src/editor/timeline.ts`) drags beats, keys and captions (things on a beat move with it), plots the
  curves, and plays the game's landing from any moment (`?cine=<s>`; the preview carries the draft).
  Since v0.22.0 the landing is `content/cinematics/landing.json`, one of the cinematics below (`end` became
  `length`; nine beats).
- **Cinematics** (v0.22.0): `content/cinematics/<id>.json` (Cinematics → any; `cinematicShape` in
  `src/content/defs.ts`): a length, camera keys, captions, **lines** (who says what and for how long: a
  character or a speaker name, `{first}` filled in), **sounds** (audio assets; `music` loops and fades out at
  the end), letterbox and fades. Camera keys look at a point, a building kind (the first finished one, else the
  Core), a story site, an inhabitant camp, or (landing only) the probe. `src/cinematic.ts` plays one: the clock,
  camera (the same PCHIP channels), captions, lines, cues and fades; the landing's probe is a **set piece**
  (`src/landing.ts`, `scene: landing`) it drives. A world cinematic pauses the game, blocks taps on the world,
  hides the HUD and hands the camera back where it was; Skip / Esc ends it. **Triggers:** each has a trigger
  (the shared conditions, default `never`), region and "unless flag", checked once a second by `src/sim/story.ts`;
  it plays once (`StoryState.cines`). The `cinematic` effect (story events, choices, mission rewards) plays one
  whatever its trigger. The sim keeps the queue (`StoryState.cineQueue`, in the snapshot as `story.cine`); the
  renderer plays the first and sends `{ type: 'cinematic', done }`. Sounds go straight to the master
  (`GameAudio.clip`). Content checks: only `landing.json` uses the landing scene and it must; beats in order;
  lists in time order and inside the length; the probe only in the landing; story sites exist; sounds are
  audio; nothing replays the landing. The editor's timeline has rows for lines and sounds; ▶ Play opens a
  scratch colony on the cinematic's region (with the play test setup) and plays it (`?cinematic=<id>` for a
  saved one; automated tests skip cinematics they didn't ask for). Test: `tools/cinematic-smoke.mjs`.
- **Cinematic preview** (v0.23.0): `src/editor/cine-preview.ts`, above the timeline. It runs the game's
  `Cinematic` and `ZoomCamera` over the region's real terrain (a 2 u world-space patch from `regionToWorld`,
  `terrainColor`) on a plain globe, with the Command Core, camps (amber spires), story sites (cyan rings) and,
  for the landing, a stand-in probe on the same path (`src/world/probe-path.ts`, shared with `src/landing.ts`).
  It shows the moment at the playhead; ▶ Preview (or Space) plays it in real time, moving the playhead. Not in
  it: the colony (building keys look at the Core), flora, fog, time-of-day lighting, sound.
- **Collapsible side panels** (v0.23.0): the sidebar and the details panel fold to an 18 px strip (edge
  button, a click on the strip, or `[` / `]` except in the map editor, where those size the brush);
  remembered per browser (`exo.editor.panels`). Test: `tools/cinematic-smoke.mjs`.
- **Worlds** (v0.24.0): the solar system is content: `content/bodies/<id>.json` (Maps → Worlds; `bodyShape` in
  `src/content/defs.ts`): kind (planet, moon, asteroid, comet, giant), what it orbits, radius, orbit (size,
  eccentricity, tilt, period, start angle), and for bodies with a surface the terrain (relief, feature size, seed,
  seas, plant life, ground colours low to high, water, plant and snow colours, snow line), atmosphere (colour,
  strength), daytime sky and clouds; giants have bands and a ring. The 20 old hard-coded bodies were moved over
  with the same orbits and phases (the old seeded random sequence replayed), plus Home (`home.json`, required) and
  an asteroid, Talus. **Any body but a giant can hold regions** (a region's `body`, empty = Home), and playing one
  makes that body the world: `world/planet.ts` takes the body's radius and terrain (`setRegionTerrain` gets a
  `RegionTerrain` with the body resolved by `regionTerrain(def, content.bodies)`; every thread calls it), `R` and
  `HALF` became live `let` bindings, `world/system.ts` builds every body from content and puts the one being played
  at the origin (positions are worked out round the star, then shifted), and `main.ts` takes the body's atmosphere,
  sky and clouds. A body without seas lifts its relief above 0 and clamps the lowest ground to a dry floor (0.6 u),
  so nothing reads as water to the sim; a barren body (plant life −1) grows no flora except where flora is painted
  on. The camera's planet view and its surface→planet blend scale with the radius (`bodyScale` in `src/camera.ts`).
  Home renders as before (checked against the previous build: the surface within run-to-run noise; only the
  background star scatter and the belts' rock layout changed, since they now draw their own random sequences).
  Content checks: orbits can't loop, moons need a parent, nothing lands on a giant, a body's radius must be at least
  1.5× the size of the regions on it. The Worlds form shows the body turning (the system view's own mesh) and a
  top-down orbit map with its moons in an inset (`src/editor/world-preview.ts`).
- **Region size** (v0.24.0): a region's `size` (120–480 u in steps of 40; empty = 240) sets the playable square.
  `REGION_HALF` and `FOG_N` in `src/sim/types.ts` are live bindings set by `setRegionHalf` (from `setRegionTerrain`);
  the sim's edge limits are functions (`limit()`, `EDGE()`), and the fog texture, light map uniforms and height grid
  size themselves when created, after the region is loaded. Region grids are square at the region's size
  (`regionCells`; schema grids with `cols: 0` take their size from the record and the content check compares).
  The map editor's **World and size** resizes a region: sculpt, flora and ground paint are cropped or padded round
  the centre and markers outside move in to the new edge.
- **Ground paint and generators** (v0.24.0): a region's `ground` grid (paint × 100 + amount) tints the generated
  ground colour with one of its `paints` (up to 8; the standard eight when it lists none) wherever the game colours
  the ground (`applyGroundPaint` / `regionColor` in `world/planet.ts`: the landing patch, the globe under the
  region, the minimap). Map editor: **Paint ground** (G; Shift or E erases), fill or clear the selected area,
  **Auto-paint by shape** (rock on slopes, sand low, ice high), and the region's own paint list. **Generate**
  (`src/editor/terrain-gen.ts`) writes a procedural shape into the sculpting over the selected area or the whole
  region: rolling hills, ridges, craters, mesas, dunes, a basin, a plateau or a canyon, with height, feature size,
  seed, add or replace, and a feathered edge; **Smooth area** and a **Roughen** brush (7). The region's own
  generated bumps are fields too (`detail`, `detailSize`, `detailSeed`; Touchdown's values are the defaults).
  **Maps → Planet map** picks the body, draws each region at its size, and ＋ New region starts one where you click.
- **Interface** (v0.20.0): `content/rules/interface.json` (Rules → Interface): accent, warning, danger,
  text and panel colours, panel and outline opacity, interface size (CSS `zoom` on the HUD's children)
  and the log's length and timing. `src/ui-theme.ts` sets them as CSS variables; `style.css` derives
  every tint with `color-mix`, so the defaults render pixel-identical to before. The editor shows a
  sketch of the HUD and opens the game with the draft.
- **Assets** are a file in `public/media/<model|image|audio>/<id>.<ext>` plus a record in
  `content/assets/<id>.json` (name, source, credit, notes; models also import scale / rotation /
  lift, applied by `src/assets/models.ts` in both editor and game). Models are .glb, front +Z, Y
  up, 1 u ≈ 10 m. A unit's or building's `model` field swaps its built-in mesh (units are flattened
  to one instanced mesh; animation is dropped). Wired today: skirmish units and the Solar Array;
  the Command Core stays procedural (the landing animates it). Audio assets can replace any built-in
  sound through the Sound rules (`content/rules/sound.json`); images show as character
  portraits (Story → Characters). The 15 built-in procedural models are
  listed in the library and can be exported to .glb as Blender starting points.

- **Sidebar groups** (v0.21.0): each group (Checks, Game data, Assets, Maps, Story, Rules, Cinematics) has a
  heading bar that stays at the top while its group scrolls past and collapses the group on a click. Collapsed
  groups are remembered per browser (`exo.editor.collapsed`); a collapsed group holding the open record shows a
  dot. Test: `tools/editor-tools-smoke.mjs`.

## 2. Models, rendering and lights

- **Blender set v1 (2026-11-16, overnight):** `blender/build.py` (headless: `blender -b --factory-startup -P
  blender/build.py -- [--only turret,…]`) builds `public/media/model/exo-<id>.glb` for solar, depot, battery,
  turret, radar, bay, wall, rover and tank (276–1,544 tris, 19–91 KB each), with records
  `content/assets/exo-<id>.json` (scale 1, built to size). Animated parts are separate nodes with the names the
  game uses (`head`, `dish`, `door`, `charge`), so aiming, spinning and glow dimming keep working. **Not assigned
  in content yet**: `?models=new` previews the whole set in-game; adopting one = set the Model field in the
  editor. `node tools/model-compare.mjs <dir>` shoots built-in vs Blender pairs (same base, camera, daylight).
- **Blender set v2 (2026-11-16):** the rest of the swappable roster, same script and conventions: cannon and
  point defense (`head` aims), repair pad (`ring`, tipped flat so rotation.z spins it in place), gate (`field`,
  see-through), geothermal (`plume`, see-through steam), artillery, arc, engineer, scout, and the fauna swarmer,
  brute, spitter and burrower (own skin colours; fauna get no instance tint). 380–1,600 tris, 26–92 KB each.
  Still **not assigned**; `?models=new` now previews every unit with an `exo-<id>` record, not just rover and tank.
- **Blender set v3 (2026-11-16):** the M2 people buildings. **Civilian Center** (3,056 tris, 172 KB): domed
  habitat, airlock at the front, growth pods at the back as `gpod_a` / `gpod_b`, each with its own material (the
  game now matches any part whose name starts with `gpod`). **Hydroponics** (2,008 tris, 115 KB): glass tunnels,
  crop beds, magenta grow lights; batched like the built-in. Every building and unit now has a Blender model except
  the Command Core (procedural on purpose: the landing animates it). Assigned in v0.13.0 (next).
- **Blender set v4 (2026-11-17): inhabitants** (`STORY.md` §5), not in the game yet, in the editor's model
  library: the Vell (drifted humans) **walker** (884 tris), **song-keeper** (1,312), **stilt hut** (1,244) and **fire
  circle** with story-stones (1,336); the Choir **cantor** (tripod of organ pipes, 1,744), **tender** (treaded repair
  machine, 640; treads so it never reads as a predator) and **pylon** (dead tower, glow band as `charge`, 616). The Vell
  stand a head taller than a colonist. Built with Blender 4.0 (Ubuntu package + python3-numpy for the glTF exporter).
- **Inhabitant stand-ins and LOD (2026-11-18):** `src/world/inhabitant-models.ts` builds a low-poly, flat-shaded
  stand-in for each v4 model, with the Blender model's size, silhouette and colours (one mesh per material):
  walker 140 tris, song-keeper 200, stilt hut 188, fire circle 177, cantor 182, tender 140, pylon 234 (its glow
  band and glyphs stay one mesh named `charge`, so the pulse works on it). In the editor's library (group
  Inhabitants; export to .glb). Asset records get an optional **Far stand-in** (`far`, models only): the built-in
  drawn instead when the colony camera is zoomed out, set on the seven `exo-*` inhabitant records.
  `src/world/inhabitants.ts` uses the skirmish's thresholds (`LOD_NEAR` 90 / `LOD_FAR` 105, hysteresis: stand-ins
  beyond 105, models again under 90; the colony's default view is 75). People keep a second InstancedMesh per crowd;
  camp structures swap visibility. While a model loads, or if it fails to, the stand-in is drawn, so a camp is never
  invisible. `__exo.natives.stats()` reports `far` (parts and people drawn as stand-ins) and `near`.
- **Blender models assigned (v0.13.0):** every unit and every building except the Command Core now has its
  `exo-<id>` model set in content.
  `node tools/model-gallery.mjs [dir] [--only …] [--q …]` stages one of everything in daylight and shoots built-in
  vs Blender close-ups (faster than `model-compare.mjs`, and it covers the whole roster). The only fix-up:
  `exo-solar` is imported at yaw 180° so its panels tilt toward the usual camera, like the built-in's.
  `?models=builtin` shows the procedural models again (game and skirmish); `?models=new` still forces the set.
  Assigned unit models drop the built-ins' extra glow strip. `?batch=0` turns building batching off, to compare.
- **Instanced buildings (v0.12.2, proof of concept):** finished walls and solar arrays draw through
  `src/world/batch.ts`: one InstancedMesh per material per kind, however many are built (a building's own
  object stays as an empty placeholder holding its pose). Glowing materials get a dimmed twin; an unpowered
  building's glow parts sit in the dimmed pool. Measured on a ~90-building base: ~6 draw calls per building
  otherwise, the base's main render cost (triangles barely matter). Extend with `BATCHED_KINDS`; kinds with
  animated parts (`head`, `dish`, `ring`, `door`, `plume`) need those parts kept per building first.
  **v0.12.3** added gate, hydroponics and battery. Look-alike materials share a draw (the built-ins make a fresh
  glow material per part). Parts named in the batch's `TAGS` (battery `charge`) get their own draw so the game
  can set their glow each frame: the battery charge glow is colony-wide, one value per batch.
  **v0.13.0** added the defences (turret, point defense, cannon) and the radar. A batch may have one moving part
  (`MOVING_PARTS`: the first of `head`, `dish` a model has), drawn as a second batch whose instances are re-placed
  each frame (building matrix × part matrix). The building's placeholder keeps an empty stand-in with the part's
  name and rest pose, so the aiming code and `facing()` work unchanged. A moving part must be a direct child of
  the model's root for its spin to match the per-building path. On a 21-building test base (3 each of 7 kinds),
  218 → 168 draw calls; the saving grows with every defence built. Test: `tools/batch-smoke.mjs`. Not batched yet:
  depot (hauler), bay (`door`), repair pad (`ring`), geothermal (`plume`), civic (`gpod`).
- **Colony lights (v0.12.4 prototype → v0.13.0 on by default):** `src/world/lights.ts`. Every light source
  (floodlights, the Core and its beacon, construction lights, drone and vehicle headlights, muzzle flashes,
  explosions) is a soft additive blob in a 256² top-down HDR light map of the region, redrawn each frame; every
  lit material samples it (patched on first draw). Where in the map and how high above the ground is worked out
  per vertex (the ground height comes from a vertex texture read), so the fragment does one texture read; light
  is softly capped so a parked army's headlights don't white out. Desktop also hands 2 real point lights to the
  biggest explosions; phones get none. Floodlights are building fields (`lightColor`, `lightRadius`,
  `lightIntensity`, `lightFlicker`; editor: Buildings). Nights get darker while lights are on.
  Cost, phone-sized SwiftShader, dpr 1, daytime base: ~100 ms/frame off; prototype +40% for the light map and +60%
  more for its 4 point lights; now +15% (no point lights). The ⋯ menu's **✦ Lights** turns them off (remembered);
  `?lights=0` leaves them out entirely; `?lreal=N` sets the point-light count. Needs a real-phone check.
- **Skirmish day / night (v0.13.0):** a ☀ Day / ☾ Night button (key N) holds the skirmish at noon or midnight;
  switching runs the sun forward through a ~2.5 s dusk or dawn. Remembered; `?time=day|night` overrides. At night
  the colony lights carry the battle (headlights, gunfire, explosions).

## 3. M1 — one region

First playtest build (2026-11-15).

- **Loop:** land → solar to stop the cryo bank draining (it fails in ~6 min on Core power alone) → Mining
  Depot on a deposit → first night at ~2.75 min (sol = 6 min; solar falls to 8%) → predator packs from
  ~5 min, every ~110 s, growing, bigger at night → turrets, repairs, radar, more drones. Goals panel
  (8 goals, ending "alive until Sol 4" ≈ 18 min). Loss: Core destroyed or cryo bank at 0%.
- **Buildings are data with a role** (`content/buildings/*.json`): core (build radius, weak point
  defense), solar (follows the sun), depot (mines nearest deposit in Range), battery (storage), turret
  (anything with fireRange/damage/cooldown shoots), radar (warnings, next-pack timer, minimap). New
  variants are new records. Placement: inside the Core's range or `buildRadius` of a finished building;
  not in water, too steep, overlapping, or on a deposit; depots need a deposit in reach.
- **Power priority** (most protected first): shooters → cryo bank + drones → radar → depots. Batteries
  cover all but depots, so mining pauses at night without surplus generation. Shooters draw 15% on
  standby. Brownouts drain cryo integrity (`cryoLossPerMW`).
- **Drones:** build queue (idle drones take unfinished sites, then repair damaged buildings; repairs cost
  alloys), back off from predators unless ordered, Core fabricates more (and a free one if all die).
- **Threats** (`content/rules/threats.json`): grace, interval ± jitter, size growth, brute share, night
  boost, sight range without radar. Packs use the swarmer/brute unit records and the region's spawn
  points (map editor), target the nearest building or a drone in aggro range, slide around water.
- **Balance harness:** `node tools/balance.mjs` plays the real sim headless with scripted strategies.
  With the current numbers (5 seeds): idle loses the cryo bank at 6 min; economy-only falls at ~10–12;
  all-turrets browns out the cryo bank at ~8–10; balanced survives 20 min on 4/5 seeds (one fell at 18).
- **Debug:** `?debug=1` → F8 summons the next pack, F9 +500 alloys.
- **Playtest (Derek, 2026-11-16, two nights):** pressure is right; power priority at night feels right;
  performance good; wanted combat units. Next: work through the "not in M1 yet" list.
- **Combat units (2026-11-16):** a **Vehicle Bay** (role `factory`) produces any Accord unit record
  that has a `cost` (Rover 50◆/12 s, Tank 110◆/24 s), one at a time while powered (power rank with the
  radar; 15% standby when the queue is empty). Alloys are paid at queue time; Cancel last refunds in
  full. Cap `maxUnits` (12) counts queued units. Units roll out of the door (−Z) and park.
  - **Behaviour:** they always shoot the nearest hostile in weapon range, even on the move. Idle units
    guard a post: they chase anything that comes within their aggro, plus anything attacking a building
    within `unitResponse` (45 u) of the post, on a leash, then walk back. Predators go for units in aggro
    like they do drones. A Tank's splash does half damage around the target.
  - **Movement:** A* on a 2 u grid (`src/sim/path.ts`): water and building bodies blocked, string-pulled
    into waypoints, re-planned every ~2 s; a unit that stops getting closer re-plans, then gives up and
    guards where it is. Units sent together spread out around the point (sunflower pattern).
  - **Controls:** tap a unit to select (shift adds/removes), double-tap or hold to select all of that type on
    screen, ⚔ counter in the top bar selects the whole army (tap again to centre on it), tap ground or drag
    from a unit to order, X or Stop = guard here.
  - **Numbers:** the Rover and Tank stats were the skirmish PoC's (60 / 170 hp), and a 4-pack killed a Rover
    in ~1.5 s. Raised to 150 / 450 hp (also affects the skirmish). Balance harness (5 seeds): `army`
    (economy + bay + units, one turret) survives 3/5; `mixed` 2/5; `balanced` (turrets) still 5/5. Units
    are viable but not stronger than turrets. `tools/balance.mjs --trace` prints the Core, hostiles and units
    every 10 s.
  - Tests: `tools/units-smoke.mjs` (18 checks).
- **Phone HUD pass (2026-11-16, from Derek's iPhone screenshots):** the top bar wrapped into 4 rows and items
  appeared/vanished (radar browning out toggled the minimap and pack timer; battery/threat/army pills popped
  in and reflowed the rest). Now: phones get one two-row strip with fixed-width slots; empty values dim
  ("—") instead of disappearing; the HUD rides through radar brownouts of under 4 s and shows a dimmed
  "RADAR OFFLINE" minimap beyond that; build menu = 3-column grid above the bar; bar on one row (Surf / Planet
  / Sys); goal = one truncated line; card tips hidden. Commands while paused now update the screen at once.
  `node tools/phone-shot.mjs <dir> [width]` screenshots the phone layout.
- **Walls, rotation, flat ground (2026-11-16, overnight):**
  - **Walls** (`content/buildings/wall.json`, role `wall`, 6◆ per 4 u segment, 350 hp, no power): placed as a
    line — click/tap the start, then the end (touch: tap the end again to confirm); the next line chains on
    from the end until ✓ Done / Esc. Each segment must be inside the build area, and walls don't extend it
    (no creeping a wall across the map). Up to 30 segments per line.
  - **Predators vs walls:** walls collide as thick line segments, and a predator can never end a tick on the
    other side of a wall line. Walls count 14 u farther away when predators pick a target, so they head for
    real buildings; one that stops making progress for 1.5 s chews through whatever blocks it and keeps at it
    till it falls. Measured: 8 swarmers break a segment in ~12 s, then pour through the gap. They don't path
    around walls yet (they chew). Units path around walls (A* grid) — leave a gap as a gate.
  - **Rotation:** R (desktop) or ⟳ Rotate (placement bar, which also has ✓ Done) turns the ghost 45°. Buildings
    store `yaw`; the Vehicle Bay's units come out of its door side. Bodies are still circles, so rotation is
    visual except for the bay door (and walls, which run along their line).
  - **Flat ground:** each building levels a pad under itself (mean height of its footprint, blending back over
    3 u). Visual only: `regionHeight` (rendering, `regionToWorld`) includes pads; the sim reads
    `regionHeightRaw`, unchanged. The patch mesh re-levels just the vertices near a changed pad.
  - **Fixed:** turret heads aimed mirrored (a child's rotation.y of θ faces heading yaw − θ, not θ).
  - `debug` command can now `spawn` a pack at a point (tests). `tools/build-smoke.mjs` (18 checks).
- **Fog of war (2026-11-16, overnight):** the sim keeps a 60×60 grid of 4 u cells: in sight now / explored
  (saved as `SimState.explored`). Sight: buildings `sight` or the colony's `buildingSight` (26 u, or firing
  range + 4 if longer; Core 52, Radar 60), drones `droneSight` (16), units `sight` or max(aggro, range) + 8;
  sites under construction see just past their footprint. Predators and their effects are only sent to the
  renderer when in sight; a powered radar sends every predator as a minimap blip (`blips`). The minimap draws
  the fog (unexplored black, explored dim). Rendering: `src/world/fog.ts` adds a shader step to the ground,
  flora, grazers, deposits and the globe (inside the region only) that darkens by an eased fog texture:
  unexplored 10% brightness, explored 42%. It works out region coords from the world position, so it
  stacks on the flora's own shader. Fog stays off during the landing cinematic and fades in after; `?fog=0`
  turns it off. `tools/fog-smoke.mjs` (11 checks).
- **Sound (2026-11-16):** `src/audio/` — one Web Audio context, everything synthesised (no files), mixed as
  combat / events / alerts / UI / ambient → master → limiter.
  - **What plays:** turret, rover and tank shots (tank heavier), predator bites, small and big deaths (from the
    snapshot `fx`, once per sim tick); building placed, building online, unit ready, drone fabricated, pack
    destroyed, drone/unit/wall lost, refused orders (not enough alloys, can't build there); a two-tone **warning**
    for "Contact!", radar pack warnings and no drones left; a klaxon **alarm** for cryo integrity drops, a
    building destroyed and game over; a soft tick on HUD buttons; and a wind bed (lower and a touch more
    whistly at night, gusting, fades out as the camera climbs). Sim events carry a small `cue` id next to their
    text (`EventCue` in `src/sim/types.ts`), so nothing matches on wording. Turrets got their own FX kind
    (`TURRET_SHOT`, drawn like a tank shot).
  - **Taming it:** per kind, only the shot nearest the camera focus plays each tick (a crowd is a little louder,
    up to 1.5×); every sound has a minimum gap (turret 0.11 s, alarm 3 s…); at most 12 voices (7 combat; alerts
    always get through); ±5% pitch variation (not on alerts). World sounds fade with distance from the camera
    focus and with zoom, are cut to 35% off screen, pan by screen x, are skipped below 4%, and stop in orbit.
    Only the wind plays during the landing cinematic; skirmish mode is silent.
  - **Controls:** ♪ Sound toggle + volume slider in the bar (behind ⋯ on phones), remembered in localStorage
    (`exo.sound`); `?sound=0` turns it off completely (no AudioContext at all).
  - **Content:** `content/rules/sound.json` (editor: Rules → Sound): master and per-category volumes, and per
    sound an optional audio asset from the library that replaces the synthesised one (wind loops).
  - **iOS:** the context is created and resumed inside the first tap (pointerdown/touchend/click/keydown listeners
    stay attached, since iOS suspends it again after calls or backgrounding). iOS mutes Web Audio entirely while
    the ringer switch is on silent — if there's no sound on the phone, check the switch first.
  - Tests: `tools/sound-smoke.mjs` (counts what started via `__exo.audio.stats()`; it can't judge how it sounds —
    the recipes in `src/audio/synth.ts` are first guesses for Derek to tune by ear).
- **More units and buildings (2026-11-16, v0.10.0):** from Derek's playtest ("challenging but engaging"), a
  wider roster. All numbers are content (`content/units`, `content/buildings`); the editor shows the new fields.
  - **Roster is data now:** any unit record is drawn (`src/skirmish/types.ts` ROSTER: the skirmish's four keep
    types 0–3, the rest follow by id; `src/skirmish/models.ts` BUILTIN_UNITS has a procedural look per id, and a
    record without one borrows the Rover's or Swarmer's). New unit fields: `minRange`, `chain`/`chainRange`,
    `weapon` (bolt · cannon · shell · arc · pd · bite · spit: tracer + sound), `repairRate`, `burrows`, and for
    fauna `packEvery`/`packFrom` (every Nth attacker of a pack, from pack N). Buildings gained `splash`,
    `minRange`, `weapon`, `repairRate` and the roles `gate`, `repair`, `geothermal`.
  - **Units** (Vehicle Bay, sorted by cost): **Scout Skimmer** (35◆, speed 13, sight 58, barely armed),
    **Field Engineer** (80◆, unarmed, repairs units first then buildings within reach, at a drone's alloy rate),
    **Arc Caster** (95◆, 10 u, each hit jumps to 4 more within 6 u at 70% per jump), **Artillery** (140◆,
    10–46 u, splash 6, fragile; like everything it only fires at what the colony can see, so it needs a spotter).
  - **Buildings:** **Point Defense** (80◆, 18 u, 60 dmg/s: the close-in specialist), **Siege Cannon** (160◆,
    8–44 u, splash 5: outranges spitters), **Repair Pad** (100◆, heals units within 9 u, free, power rank with
    the radar, standby when idle), **Gate** (30◆: dropped near a wall it snaps onto the line, centres between two
    segments and replaces them, no gap; predators treat it as wall, units path through it), **Geothermal Tap**
    (130◆, +7 MW day and night, only within 5 u of an untapped vent). Vents are a region list (`vents`), placed
    in the map editor (V); Touchdown has three, each outside the starting build area.
  - **Fauna:** **Spitter** (every 5th attacker from pack 4: 30 u spit, 70 hp, sits just outside a turret's 28 u)
    and **Burrower** (every 7th from pack 7: underground it is undrawn and untargetable, ignores walls, water and
    units, heads for the nearest non-wall building, surfaces 3 u out with a warning; radar still shows it).
  - **Balance** (`tools/balance.mjs`, 5 seeds, 20 min): the new fauna make the old builds a bit harder
    (`balanced` 5/5 → 4/5, `army` 2/5 → 0/5, `mixed` 1/5 → 1/5). New strategies: `fortress` (balanced economy
    with point defense, cannons and geothermal) survives 4/5; `combined` (arc casters, artillery, an engineer, a
    repair pad) 0/5 but lasts longer than `mixed` (mean 17.2 vs 14.5 min). Units are still weaker than
    turrets in the bot's hands. Point Defense was first tuned like a turret and was strictly worse; now 60 dmg/s.
  - `debug` command can drop in combat units (`units: { unit, x, z, n }`). Tests: `tools/roster-smoke.mjs`
    (headless, 27 checks: every mechanic above on the real sim).
- **Not in M1 yet:** nothing left on the list; next is a full M1 playtest with the wider roster.

## 4. M2 — people

Slice 1 (2026-11-16): people, happiness, AI acceptance.
Code: `src/sim/people.ts` (+ `people-types.ts`, `names.ts`), HUD `src/people-hud.ts`, walkers
`src/world/colonists.ts`. Numbers in `content/rules/people.json` (editor: Rules → People rules).
Test: `tools/people-smoke.mjs`; headless: `node tools/balance.mjs --strategy people [--peaceful]
[--imprint charter|heritage|guardian] [--policy council=assembly,…]`.

- **Clock:** 1 sol = 1 year (sol = 6 real minutes). Pod-grown colonists step out at 16; lifespan ~75.
- **Cryo bank = 120 embryos in 24 lineages.** Integrity % stays the thermal buffer driven by power;
  below 50% embryos die (faster the lower it goes, 0.6/s at 0%). Game over when there are no
  embryos, no colonists and no pods left (or the Core falls). Idle colony now loses at ~8 min (was 6).
- **Civilian Center** (role `civic`, 150◆, −1.5 MW): 2 growth pods, houses 6, 1 Medic slot.
  **Hydroponics** (role `farm`, 60◆, −1.2 MW): biomass, 2 Botanist slots. Biomass is a new
  stockpile (🌱); colonists eat it, pods eat it.
- **Growth pods:** pick a **specialty** and an **imprint** (what the AI teaches):
  *Charter* (partnership, stance ~58), *Heritage* (human self-reliance, ~24), *Guardian* (id `unity` in code and saves; AI as
  guardian, ~88). The pod takes the rarest surviving lineage (keeps diversity up). 1 sol, 1.5 MW
  + biomass the whole time; 60 s without power or biomass kills the child (×1.5 with a Medic at
  work). Pods share the cryo bank's power priority. Stoppable only before 25%.
- **Colonists walk.** Auto-housed, auto-staffed (specialists to matching buildings first), walk to
  work during shift hours and home after; on alert (predators near any building) everyone shelters
  in the nearest building and runs (6.6 u/s). Outdoors they can be killed; a destroyed building
  hurts the people inside. Figures are coloured by bloc. Tap one for their card.
- **Staffing bonus:** each worker present adds +15% (+10% more if specialty matches; Diligent ×1.5;
  Devoted ×1.1) to the building's output: farm biomass, depot mining, solar MW, turret damage, bay
  speed. Output follows the shift.
- **Two meters per colonist.** *Wellbeing* (0–100) eases toward a target built from food,
  rations, home (powered?), work hours, grief, fear, partner, medical care, injuries, traits, and
  **whether the council/oversight policies suit their bloc**. *Stance* (AI acceptance, 0–100)
  drifts with policy, misery (blamed on the AI), traits, housemates (social pull) and shocks
  (preventable deaths −, packs beaten +). Contentment settles people toward partnership, not
  devotion. Blocs: **Autonomists** < 35 ≤ **Partners** ≤ 75 < **Devoted**.
- **Policies** (Colony panel): Work hours, Rations, Oversight, Council. Each bloc likes different
  answers, so there's no setting that pleases everyone.
- **Consequences:** wellbeing < 25 → strike (stops working). Angry Autonomists sabotage buildings
  (Oversight Light ×1.5, Standard catches half, Total stops it but Autonomists hate it).
  Autonomist majority + misery for half a sol → a third of them **walk out** to found their own
  settlement (seed for Act 2 defections). 60%+ Partners and wellbeing 65+ for a sol →
  **Breakthrough**: +25% output for half a sol. Devoted work harder and have few children.
- **Families:** housemates of different lineages pair up; settled, happy couples with room have
  children (born colonists lean toward autonomy, −15 from their parents). Couples move to a Center
  with room. Children come of age at 16 and take the specialty with the most open jobs.
- **Genetic diversity** (effective lineages / 24): below 60% new people may be *Frail*. A lineage
  with no embryos and no one living is announced as gone. Memorial log keeps every loss.
- **HUD:** strip shows ❄ embryos, 🌱 biomass (+/min), 👤 colonists (+pods), ☺ wellbeing ⚖ AI
  acceptance; tapping 👤/☺ opens the Colony panel (Colony · People · Cryo bank · Memorial). New
  goals: Hydroponics, Center + pod, first colonist.

Headless results (90 min, no predators, bot keeps pods busy): Charter colonies stay Partner-led
(stance ~62–74) and grow to ~40; Heritage colonies are Autonomist and, once food got short,
spiralled through strikes (farms unstaffed) into starvation, sabotage and a walkout. With
predators on, the people bot lost its Core at ~12 min because it spent on the colony instead of
turrets: the people economy competes with defense — tune after a playtest.

**Leading blocs (v0.16.0).** A bloc with `leadShare` (50%) of the adults, in a colony of at
least `leadMin` (4), leads it and turns on a boost (People rules, editor-tunable):
**Wardens** (Autonomists; the human path's natural defence): buildings with Autonomists inside
strike predators within 12 u (5 damage each, up to 3 a building, every 1.5 s, no power needed),
and colonists outdoors take half harm. **Symbiosis** (Partners): staffing bonus ×1.5. **Vigil**
(Devoted): drones build/repair ×1.3, buildings draw ×0.85. The log announces a change of lead;
the Colony panel shows each boost. Test: `tools/lead-smoke.mjs` (headless). The imprint picks
the lean, so committing to one imprint is what earns a boost.

**Inhabitants slice 1 (v0.17.0).** `src/sim/inhabitants.ts`, `src/world/inhabitants.ts`,
`src/contact-card.ts`. A group is a record in `content/inhabitants/` (editor: Story → Inhabitants),
with its models, numbers and story text: **the Vell** (stilt huts round a fire circle, walkers and a
song-keeper) and **the Choir** (a pylon whose `charge` band pulses, tenders walking a ritual loop, a
cantor). Region maps place `camps` (editor: Add camp, C). Touchdown has one Vell camp at (−96, 84),
past the 2,500-alloy deposit, so the rich deposit means building on their land.
- Neutral: predators ignore them, they never fight, and nothing can be built on the camp itself.
- **Regard** 0–100 (Vell start at 35). Each colony building within their land (50 u) costs
  `encroach`/sol; with none there it recovers `recover`/sol, up to where it started.
- **First contact** (E4) when the camp comes into sight: a card (the game doesn't pause) offers
  *Approach* (+20, and regard may then rise to 100), *Keep away* (no change; regard never rises past
  where it started, so no trust) or *Drive them off* (they leave). "Later" defers it; the Neighbours tab
  can still answer.
- **Trust** at `trustAt` (70): the trust story plays once (E5 "The Keeper's Song"); after that they warn
  of each pack when there's no radar and share sight of their land. Below 25 they're uneasy and trust
  is lost (it can be earned back).
- At 0 they abandon the camp and walk out; the empty camp stays.
- Test: `tools/inhabit-smoke.mjs` (headless).
- Next: Biosphere Report / stewardship counting displaced inhabitants; the colonists' view of them
  (stance); trade or help; the Choir placed in a second region; E8 for the Choir as its own beat.

Not in slice 1 yet: an inhabitant/rival dimension to stance, natural-birth vs pod-born politics
beyond the −15 lean, Devoted petitions, a dedicated Habitat building, research (Breakthroughs
are just an output surge for now), aged colonists' retirement.

## 5. Proof of concept and performance

First results 2026-11-15; later measurements added below them.

- **M0 tech demo:** continuous zoom surface ↔ orbit ↔ system, worker sim, IndexedDB saves — 60 fps on
  Derek's iPhone. Home planet R=3000 with 89 fixed regions; 9-planet system.
- **Terrain look:** `?look=smooth` (smooth shading + procedural ground textures) preferred over flat
  low-poly up close. Open: globe detail/texturing so the landing patch doesn't show as a square from
  mid-altitude (terrain LOD). Still true on the phone (2026-11-17).
- **Phone check (2026-11-17):** startup is quick, and frame rate with colony lights and flora on is
  fine.
- **Skirmish (`?mode=skirmish`):** ~1,000 hostiles on screen at **60 fps on iPhone**; sim
  27.6 ms/tick on the phone at ~1,000 units (budget 100 ms at 10 Hz), ~3 ms on hive1.
  All touch selection methods felt good (tap, hold/double-tap all-of-type, paint, control groups).
- **Startup (2026-11-16, overnight):** 1650 → ~980 ms to the first frame on hive1 (dev server, 3-run mean,
  `node tools/load-times.mjs [--cpu 4]`). The sim worker now starts first (its ~300 ms boot overlaps everything);
  a generation worker (`src/world/gen-worker.ts`) builds the globe and provinces while the main thread builds the
  solar system, flora and patch; the globe welds the icosphere's repeated corners first and works out terrain
  once per corner (253k → 42k vertices, indexed for both looks: 390/630 → ~190 ms), and province borders key
  edges by vertex pair (225 → ~85 ms). What's left is mostly browser work (module loading in dev, GPU uploads,
  shader compiles), which needs measuring on the phone; flora placement could also move to the worker.
- **Follow-ups (earlier):** startup is slow (height grid, globe, provinces and textures all built on the main
  thread at load — move to the worker / cache / build lazily); "Command Core destroyed" event repeats
  every 5 s after the core falls; no game-over/restart flow in skirmish.
- **Flora + landing (2026-11-15):** procedural alien flora (`src/world/flora.ts`): six archetypes
  (spire, parasol, fan, tube clump, spore bulbs, crystal) randomised per seed into ~8 species, scattered
  by the ground's flora field / altitude / slope, instanced (~3,200 plants, ~400k tris), wind sway and
  night bioluminescence; `?flora=<seed>` rerolls, `?flora=off` disables; buildings clear plants. Visual only
  for now — deterministic so the sim can later read it as biomass. Opening cinematic (`src/landing.ts`,
  ~27 s, Skip/Esc, `?intro=0`): entry from ~26 km with plasma wake → full-throttle retro burn with dust →
  touchdown → six shell petals fold out → petals dissolve into the core → drone bay opens and the drone
  flies to its post. Sim has a landing phase (drone and economy wait for deploy; grazers bolt from the
  engine noise). Needs a real-phone check for fps with flora on.
- **Title screen (2026-11-16):** `src/title.ts`. The wordmark assembles over the live planet (slow orbit
  drift, landscape shifts the planet right of the menu, portrait pulls back and lifts it), tagline types
  out, menu slides in: CONTINUE (Sol/time of the autosave; dives to the surface), NEW GAME (two taps when a
  colony exists; plays the landing), SKIRMISH, SOUND, EDITOR, deeek.org link. HUD, labels, province overlay
  and fog are hidden behind it; the remembered camera isn't overwritten by the title's orbit. Skipped by
  `?title=0` (resume or land as before), `?intro=0`, `?new=1`, `?view=…` and skirmish, so tools are unchanged.
- **Planet detail + versions (2026-11-16, v0.9.0):** `src/world/surface.ts`. A 2048×1024 equirect surface
  map (colour + flora, height + baked slopes) from the same `surfaceAt` as the globe geometry, baked in
  `surface-worker.ts` after the first frame (~2 s on hive1, nothing waits on it) and faded in. The globe
  shader adds it per pixel from ~250 u altitude up: relief from the slopes, smooth glinting oceans with
  depth, fine grain, bioluminescent flora specks on the night side; a cloud shell (R×1.022) fades in above
  ~400 u. `?surface=0` turns it off. Planet view costs ~2× the old globe in SwiftShader (130 vs 65 ms at
  390 px); the ground view is unchanged. Versions: `package.json` + `src/changelog.ts` (What's new on the
  title and ⋯), checked by `tools/version-check.mjs` in `npm run build`.
