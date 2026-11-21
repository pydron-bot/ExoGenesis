# Exo Genesis — As Built

> What's in the game, how each part works and how it's tested, feature by feature. `DESIGN.md` says
> what the game should be; this file records what was built and measured. Moved out of `DESIGN.md`
> (§6.4, §7, §9) on 2026-11-17; newer entries go at the end of their section.

- [1. Content and the editor](#1-content-and-the-editor)
- [2. Models, rendering and lights](#2-models-rendering-and-lights)
- [3. M1 — one region](#3-m1--one-region)
- [4. M2 — people](#4-m2--people)
- [5. Proof of concept and performance](#5-proof-of-concept-and-performance)
- [6. Roster additions](#6-roster-additions)

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
- **Worlds** (v0.27.0): the solar system is content: `content/bodies/<id>.json` (Maps → Worlds; `bodyShape` in
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
- **Region size** (v0.27.0): a region's `size` (120–480 u in steps of 40; empty = 240) sets the playable square.
  `REGION_HALF` and `FOG_N` in `src/sim/types.ts` are live bindings set by `setRegionHalf` (from `setRegionTerrain`);
  the sim's edge limits are functions (`limit()`, `EDGE()`), and the fog texture, light map uniforms and height grid
  size themselves when created, after the region is loaded. Region grids are square at the region's size
  (`regionCells`; schema grids with `cols: 0` take their size from the record and the content check compares).
  The map editor's **World and size** resizes a region: sculpt, flora and ground paint are cropped or padded round
  the centre and markers outside move in to the new edge.
- **Coastal regions** (v0.30.0): on a body with seas the ground within ~15° of the region being played is lifted
  40 u onto dry land (`siteLift` in `src/world/planet.ts`). A region's `keepSea` turns that off (`setRegionTerrain`
  sets `lifted`, which `globeHeight` reads), so the body's own seas and coast show in the region; the Core's pad
  (`padHeight`, at least 1.5 u) stays dry. Below 0.3 u the sim treats ground as water (no building, units path round
  it), flora skips ground below 2.5 u. Map editor: Place on the body → Keep the sea; the Planet map leaves out the
  lift round such regions. Test: `tools/region-smoke.mjs` (a coastal site is dry with the lift, about a third water
  without).
- **Ground paint and generators** (v0.27.0): a region's `ground` grid (paint × 100 + amount) tints the generated
  ground colour with one of its `paints` (up to 8; the standard eight when it lists none) wherever the game colours
  the ground (`applyGroundPaint` / `regionColor` in `world/planet.ts`: the landing patch, the globe under the
  region, the minimap). Map editor: **Paint ground** (G; Shift or E erases), fill or clear the selected area,
  **Auto-paint by shape** (rock on slopes, sand low, ice high), and the region's own paint list. **Generate**
  (`src/editor/terrain-gen.ts`) writes a procedural shape into the sculpting over the selected area or the whole
  region: rolling hills, ridges, craters, mesas, dunes, a basin, a plateau or a canyon, with height, feature size,
  seed, add or replace, and a feathered edge; **Smooth area** and a **Roughen** brush (7). The region's own
  generated bumps are fields too (`detail`, `detailSize`, `detailSeed`; Touchdown's values are the defaults).
  **Maps → Planet map** picks the body, draws each region at its size, and ＋ New region starts one where you click.
- **Story organisation** (v0.27.0): **Chapters** (`content/chapters/<id>.json`: title, order, act, colour, summary,
  notes) and the **Story bible** (`content/lore/<id>.json`: places, history, factions, objects and ideas, with a
  "secret" mark) are editor-only collections; missions, story events, cinematics, characters, inhabitant groups and
  bible entries gain editor-only `chapter`, `tags` (comma-separated) and `notes` fields (`organizeFields` in
  `src/content/defs.ts`; the game ignores all of it). **Story → Story board** (`src/editor/board.ts`): a column per
  chapter in order (act headings above), then "No chapter"; each card shows its kind, a one-line summary (the same
  summaries as the forms), tags and problems; missions run in campaign order. Filter by kind, tag (click a tag on a
  card), character (records they speak in) or text; drag a card to another column and Save writes the chapters;
  ＋ in a column starts a record already in that chapter. The sidebar lists story records under their chapters
  once any have one. Seeded with Act 1's four chapters, Act 2 and the endings, and eight bible entries from
  STORY.md.
- **Cinematic editing tools** (v0.27.0): fly the preview (drag orbits, Shift / right drag pans the focus over the
  ground, wheel = distance, Alt+wheel = focus height; the numbers show while free) and **＋ Key from view**
  adds a `site` key at the playhead (x, z, lift, dist to 0.1, pitch, yaw to 0.001 rad; a key already within
  0.05 s takes the view instead). **Update selected key** points a key at the view; a building / story site /
  camp / probe key keeps its target and takes distance (less the probe's `follow` pull-back), pitch, yaw and
  the focus height as lift. The free view sets `ZoomCamera` exactly as `Cinematic.direct` does for a site key
  (focus `regionToWorld(x, z, lift)`, override weight 1, free pitch), so a captured key plays back the same
  shot (within the rounding: ~0.02–0.05 u in the smoke test). Yaw 0 looks from the south (−N); the captured
  yaw is the turn nearest the neighbouring keys' mean, kept inside ±6.3, so the PCHIP doesn't spin the long
  way. Beside the preview, a **map** from above (`cine-preview.ts`, a second silent `Cinematic` on its own
  camera, 160 samples): camera path, focus path, numbered keys (click to select), the camera and its field
  of view at the playhead. Overlays: thirds / title-safe guides (remembered, `exo.editor.pvguides`) and the
  key and time in a corner. **Timeline** (`timeline.ts`): click selects (its form card lights up; Enter or a
  double-click on a key or sound jumps to its fields), Delete / Backspace removes, Ctrl/Cmd+D copies to the
  playhead, ← / → nudge 0.1 s (Shift 1 s), Esc lets go; Home / End, `,` / `.` move the playhead; drag the
  ruler to scrub; ＋ Camera key / Caption / Line / Sound add at the playhead (a caption or line opens for
  typing in place, a sound shows its field); a double-click on a caption or line edits its text in place;
  drag a line's right edge for `for`; Ctrl+wheel zooms the time axis (it scrolls sideways, row labels stay).
  Every edit is one `rerender()` (form, undo history; lists re-sorted by `at`); the selection, zoom and free
  view live at module level because each edit rebuilds the form, and the preview is kept across those
  rebuilds. Test: `tools/cinematic-smoke.mjs`.
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
- **Story gameplay** (v0.31.0): story events and missions can now drive the game, not just talk about it.
  **Effects** (`STORY_EFFECTS`, run by `Story.effect` in `src/sim/story.ts`) add: `isotopes`; `counter` / `setCounter`
  (named numbers in `StoryState.counters`, start at 0); `countdown` / `stopCountdown` (a named timer with HUD text,
  `StoryState.countdowns`, ends into `expired`); `spawn` (Count of a Unit at a story site: Accord units join the colony,
  anything else is a pack, or with Guard the site a guard that only fights what comes near; `Sim.spawnAt`); `research`
  (done, free; sets `research-<id>`); `lock` / `unlock` (a building or unit out of the build menus: `StoryState.locked`;
  `build`, `buildLine` and `produce` refuse it and the HUD hides it); `reveal` (fog cleared round a site, `Sim.reveal`);
  `waypoint` / `clearWaypoint` (a marker over a site and on the minimap, `StoryState.marks`); `camera` (the player's
  view to a site or building; `look.n` counts requests so a resumed game doesn't jump); `hint` / `unhint` (see
  Tutorials below); `win` / `fail` (`Sim.end`: `over` = `'won'` or `'story'` with `overText` on the end screen).
  **Conditions** (`CONDITIONS`, `src/sim/conditions.ts`) add `placed`, `births`, `deaths`, `kills`, `lost` (buildings),
  `alloys`, `researched`, `explored` (a site came out of the fog, `Sim.explored`), `counter` (≥ Count), `counterBelow`
  (≤ Count), `timer` (a countdown ran out), `opened` (HUD, see Tutorials), `failed` (a mission), and groups: `all` /
  `any` hold up to 8 conditions in `of`, each with `not` (one level; `conditionsIn` in `defs.ts` opens a group up for
  the tools). `count` may be negative (counters). **Missions** gain `fails` (conditions checked while under way, before
  objectives; any one fails it: logged, no rewards, `onFail` fires, missions after it don't start; `failEnds` loses the
  game with the fail's text; `MissionState.failed`). The new state is all in `StoryState` / `MissionState`, so it saves;
  the play test setup's clock jump moves countdowns too. Content checks: `built` / `placed` need a building, `opened`
  a panel, groups at least one condition, site conditions and site effects a site on a map, `spawn` a unit and a site
  (not a nest), `lock` / `unlock` a building or unit, `camera` a site or building, a build-menu hint its building,
  `failEnds` some fail conditions. The editor's summaries (`condText`, `effectShort` in `src/editor/flow.ts`) read
  every kind; Story flow lists counters and countdowns beside flags (set by / waited on by; a counter nothing changes
  or a countdown nothing starts is a problem) and no longer reports flags the game sets itself (`research-*`,
  `wreck-found`, `relic-woke`, `relic-opened`, `nest-destroyed`, encounters' "beaten" flags). Test:
  `tools/gameplay-smoke.mjs` (headless).
- **Tutorials** (v0.31.0): the `hint` effect points at part of the HUD (`HINT_TARGETS`: the Build button, one
  building in the build menu, GOALS, the minimap, any resource readout, pause, fast forward) with a bubble of text
  (`src/story-hud.ts`: an amber outline that pulses on the element, the bubble below or above it). A hint on
  something the player can use clears itself when they use it (`HINT_DONE` in `story.ts`; a build-menu hint when they
  place that building); others stay until `unhint` or the next hint. The renderer reports what the player opens
  (`{ type: 'ui', what }`: `build`, `people`, `mood`, `army`, `goals`, `minimap`, `speed`, `select`, `select:<kind>`,
  `research` for a Tech Lab) once per game, for `opened` conditions; `placed` waits for the player to place a kind
  (finished or not). With `lock` / `unlock` a tutorial can offer only what its lesson needs. Waypoints draw as amber
  diamonds over the site (pinned to the screen edge when off screen) and rings on the minimap; countdowns show under
  GOALS (red under 30 s).
- **Story inspector** (v0.31.0): `src/inspector.ts`, in play tests (`?preview=1`) and with `?inspect=1`; ` (backquote)
  or 🔍 Story shows it (remembered, `exo.inspector`). Lists the missions under way with their objectives (tick one:
  `inspect.objective`), Finish (rewards run) and Fail; missions not started (Start = `debug.mission`); events waiting
  in the inbox, waiting out a delay, not fired yet (filter, Fire) and fired; flags (set, clear), counters (edit),
  countdowns (Run out), locks (unlock), the hint and waypoints; and +1 min / +10 min / +1 sol (`Sim.skip`: the clock
  moves, nothing in between is played), Pack now, +500 alloys. The sim takes these as `{ type: 'inspect' }` commands.
  **Live story edits** (dev): `src/content/index.ts` hands a content hot update to `onContentHot` (kept on
  `globalThis`, since every update runs a fresh copy of the module); with the inspector on, `main.ts` compares each
  collection, and if only story ones changed (`LIVE_COLLECTIONS`: story, missions, characters, cinematics, chapters,
  lore) swaps them in place in the page and in the worker (`{ type: 'content', patch }`) instead of reloading, so a
  play test keeps going with the new text, triggers and effects. Anything else still reloads.
- **Playthroughs** (v0.31.0): `src/sim/playthrough.ts` plays the campaign headless: the balance bot
  (`runBalance`, which now takes a `hook` called every tick with the sim and its build plan) plays a strategy, and
  every second the hook answers the cards in the inbox by a policy (first, last or random choice, or fixed answers
  per event), marks cinematics played, chases the objectives under way (`chase`: puts what `built` / `placed` ask for
  at the front of the plan, fabricates drones, produces a unit, builds farms and a Civilian Center for people goals,
  starts research along its `requires` chain, sends a unit or drone to sites and camps, "opens" HUD panels) and
  records beats: missions started, objectives met, missions done or failed, events fired, choices, flags, counters,
  countdowns, cinematics, the end. `coverage(runs)` lists events no run fired, choices nobody took, missions never
  started or never finished, and when each mission was done. Editor: **Story → Playthrough** (`src/editor/playthrough.ts`,
  in a worker on the saved content like the balance runs: bot, minutes, seed, region, no predators, policies) shows
  each run's missions as bars on a time axis with events and choices as ticks, the timeline (filter by kind), the run
  before for comparison, and coverage in the side panel. Command line: `node tools/playthrough.mjs`.
- **Writing tools** (v0.31.0): **Story → Script import** (`src/editor/script.ts`; `parseScript` / `parseCineLines`
  are pure): scenes written as a screenplay (`# Title {id}`, `when: <condition> <values>` or `after previous`,
  `delay:`, `pause`, `radio`, `chapter:`, `unless:`, `tags:`, `NAME: line` with characters found by id, name or
  first name, narration carrying on the line before, `> choice`, `= reply`, `+ effect args` indented under a choice
  or not) become story events: the first starts as `never`, each later one follows the one before; `+ event next`
  looks ahead. The page shows what it will create with the content checks run on the drafts, then writes the files.
  Lines for a cinematic (`[time] NAME: text`, times optional: each follows the last by reading time) are added to a
  chosen cinematic. The script is kept per browser (`exo.editor.script`). **Story → Branch graph**
  (`src/editor/graph.ts`, `buildGraph` pure): missions, events and cinematics as boxes, flags, counters and countdowns
  as tags, edges for every link (a mission follows one, an event waits on a mission or an answered event, an effect
  fires an event or sets a flag a trigger waits for, choices labelled), in columns by longest path; drag boxes (kept,
  `exo.editor.graph`), pan, zoom, click to see what leads in and out, double-click to open; Tidy up forgets moves.
  **Story → Endings ledger** (`src/editor/ledger.ts`, `buildLedger` pure): every choice and reward that moves stance,
  wellbeing, regard or a counter, or sets a flag, in a table; the range each can reach if every event fires (a card's
  choices are either-or; `setCounter` values count); and every threshold a trigger or objective waits for
  (counter ≥ / ≤, acceptance), flagged when the story can't reach it.
- **Map encounters** (v0.31.0): a region's `encounters` (`encounterShape`): Count of a hostile unit at a spot that
  guard it (stay within the radius, fight what comes near), patrol to a second point and back, or attack the colony
  like a pack; there from the start or once a flag is set ("Appears when flag", announced in the log); `doneFlag` is
  set when the last of them dies. `Sim.stepEncounters` (once a second; `StoryState.encounters` remembers which have
  appeared, so they don't come back after a load); guards are hostiles with `guard` (`chooseTarget` only looks near
  the post; `stepGuard` walks back or along the route). Map editor: **Add encounter (N)**: red spikes, the guard ring,
  the dashed patrol line and its end. Content checks: hostile units only, no nests, unique ids, inside the region.
  Test: `tools/gameplay-smoke.mjs`.
- **Production tracking** (v0.31.0): story records (missions, events, cinematics, characters, inhabitants, bible) gain
  editor-only `status` (idea, draft, wired, tested, final) and `comments` (who, text, resolved; signed with the name
  last used in this browser, `exo.editor.who`). The story board shows a status badge and open comments on each card,
  filters by status ("not final", "open comments"), and counts by status in the side panel. **Checks → To do**
  (`src/editor/todo.ts`, `collectTodo` pure): open comments; records not final, by status; missing pieces (characters
  without a portrait, cards with no speaker, cinematics with no sound, cinematic lines nobody says, units and
  buildings on their built-in stand-in model, story records in no chapter); and the voice script: every spoken line by
  who says it, with word counts, to copy or download as text. Comments and the new id fields stay out of Checks → Text.
  Test: `tools/story-tools-smoke.mjs`.

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

- **Blender set v5 (2026-11-18): roster batch A** (`docs/ROSTER.md`): Lancer (1,372 tris), Sensor Mast (752; head is
  `dish`), Habitat Block (1,204), Relay Tower (944; beacon bands are `charge`). Same script and conventions.

- **Blender set v9 (2026-11-18, v0.36.1): water and air**, assigned in content. Buildings: Shipyard (2,316 tris),
  Tidal Generator (1,160), Pier (1,428; beacon band `charge`), Sea Turret (1,804; the Defense Turret's gun as `head`),
  Airpad (1,708), Flak Tower (1,104; quad mount as `head`). Units: Hover Skiff (634), Strider (428), Gunboat (576),
  Transport Barge (528), Lurker (828), Gunship (1,040), Skimmerwing (340; membrane is double-sided). Water buildings
  follow `sea-models.ts`: origin at the water, piles go below z = 0. Boats keep their waterline near z 0.25 (they are
  drawn 0.25 u down). Built with Blender 5.2 (`~/.local/bin/blender`). `join()` now bakes each part's rotation and scale
  before joining, so a rotated or scaled first part no longer leaves its transform on the joined node. Flyers sit 9 u
  up, out of `model-gallery.mjs`'s frame: check them in the editor or in `air-smoke.mjs --shots`.
- **Worker drone model (v0.36.2):** `exo-drone` (1,020 tris; origin at the body's centre). Drones aren't a content
  record, so it's picked up by id like `exo-wreck`/`exo-cache`: `main.ts` loads it and calls `region.setDroneModel`.
  Each drone (and each ore hauler) is an empty shell group that `fillDrone` fills with the asset (built-in as the far
  LOD) or the built-in, so `region.drone` keeps its identity for the landing; haulers get their bright glow turned
  amber either way. `?models=builtin` keeps the built-in. The **Arc** model went from 1,600 to 1,408 tris (8-sided
  wheels and coil rings).
- **Blender set v10 (2026-11-19, v0.37.0): roster batch C**, assigned in content. Shield Projector (1,204 tris;
  floating ring `ring` turns while the dome is up, collar and crystal core are `charge`), Seed Bank (1,122; sprinkler
  rotor `ring`, seed racks `charge`), Aegis Crawler (1,056), Medevac (1,232). A `charge` part with two materials comes
  out of the glTF as a group of meshes, so the glow code walks each `charge` node's meshes.
- **Blender set v11 (2026-11-19, v0.38.0):** Med Bay (788 tris; beacon `charge` flashes while its stretcher crews
  are out, a red cross on the roof for the top-down view) and Memorial (1,356; flame `charge` flickers and sways). Built-in
  twins `buildMedBay`, `buildMemorial` in `src/world/batchc-models.ts`.

- **Glow, ground shadows, printed construction (v0.32.0):**
  - **Glow** (`src/world/post.ts`): with glow on, the scene renders into a HalfFloat target, then `UnrealBloomPass`
    (run at half the canvas size) and `OutputPass` (tone mapping + sRGB). With glow off the renderer draws straight to
    the screen as before. The threshold follows the light: 1.0 by day (only flashes, explosions and the core's glow
    bloom; sunlit ground never does), 0.72 at night (glow strips, pods, light pools, gunfire, the flora's tips), 0.85
    in orbit. Default: on for desktop, off on phones (`pointer: coarse`) and in automated browsers (it halves
    SwiftShader frame rates, and tests like the turret-aim check count frames). Desktop multisamples the target 4×;
    phones don't (`?glowaa=N`). Phone size, dpr 1, SwiftShader: ~100 ms/frame glow off, ~190 with 4× MSAA, ~80 with
    none (cheaper than off, since the canvas's own MSAA then only draws a quad). Needs a real-phone check before
    defaulting it on there.
  - **Ground shadows** (`src/world/lights.ts`): drawn into the light map's alpha channel (the blob pass now blends
    ONE/ONE on all four channels and clears alpha to 0). Buildings get a contact patch plus a sun shadow pushed
    away from the sun, `h / tan(elevation)` long (capped at 4h), fading out as the sun sets. Drones and units get
    one blob that does both. Building radius = clearance / 2 × 0.85, height ≈ 1.2 × radius (max 9; walls and gates 3),
    scaled by build progress. Unit radius = body radius × model scale (`addArmy`'s third argument). In the lit
    shaders the alpha darkens direct light (and sky light by 55%) only within ~2.4 u of the ground
    (`vLmS`), so roofs over their own shadow stay lit. Shadows don't depend on the Lights toggle: the pass runs when
    either is on. Cost: within noise in the perf probe. `?shadows=0|1`.
  - **Printed construction** (`src/world/print.ts`): a building under construction is its real model (`modelFor`,
    LOD pair included) with per-building material copies: solid below the print line, discarding above it, with
    a 0.45 u emissive band at the line and back faces drawn as a glowing cyan cross-section (DoubleSide). A
    wireframe twin of every mesh shows the unbuilt part, with scanlines. 18 sparks run along the footprint's
    edge at the line. The line is measured along the building's own up from its base, from 4% to 100% of the model's
    height. See-through parts (gate field, plumes) wait for the finished model. The construction work light is now
    cyan and dimmer (0.35). `?print=0` (or the option) brings back the scaffold box. `region.printing` switches it
    at runtime (buildings under construction rebuild).
  - **Options** (`src/options.ts`): one panel, opened from OPTIONS on the title screen and Options in the game menu
    (it replaces nothing; ✦ Lights stays). Toggles: glow (`exo.glow`), shadows (`exo.shadows`), printed construction
    (`exo.print`), colony lights (`exo.lights`), each remembered in localStorage. A URL param locks its row ("Set in
    URL"). Test: `tools/options-smoke.mjs` (title → options → every toggle flips and the game follows → remembered
    after a reload, desktop and phone).
  - Shots: `node tools/polish-shot.mjs [--hours 23,12] [--modes "on:&bloom=1,off:&bloom=0&shadows=0"] [--fight] [--perf]`
    stages a colony with buildings under construction, vehicles and a pack.
- **Water (v0.33.0):** `src/world/water.ts`. Seas used to be the ground painted blue at sea level. Now, on a body
  with seas, a water surface sits 0.2 u above sea level (so ground the sim calls wet, raw < 0.3, reads wet) over the
  region on the patch's 2 u grid, plus a coarse 10 u frame out to 520 u past the edge (cells lined up on the region's
  edge, foam halved there since the globe under it is coarse). Dry cells (all corners > 0.8 u) are left out; no
  water anywhere in reach means no mesh. It lives in the region's `details` group, so it goes with them from orbit,
  where the globe's own ocean shading (surface.ts) takes over. Underwater ground sinks below it (`seabed`: 0.6 × depth,
  capped at −7 u) in the patch, the pads' re-levelling and the globe, and the patch colours it as the body's shore,
  darker with depth. The sim still reads the raw heights.
  - Each vertex carries its depth (`aDepth`, from `surfaceAt`), so with no depth pass the shader shades shallow to
    deep (the body's Shallow ×1.35 and Deep colours), lets the seabed show near the shore (alpha 0.36 → 0.95 over
    3.2 u), draws a wet line where water meets ground and lapping foam bands that run in toward the beach (within
    1.4 u of depth), tilts the normal by scrolling layers of a baked 256² tileable ripple map (rgb normals, alpha a
    foam breakup noise), calmer on the beach and fading with distance so far water doesn't shimmer, and mirrors the
    sky colour (main.ts passes the day/night background) by fresnel. Sun glints come from roughness 0.14 on the
    ripples. It is a patched MeshStandardMaterial, so the sun, colony lights, ground shadows, fog and fog of war
    apply. Clock: game time (skirmish: real time). Picking hits the water before the seabed.
  - **Detailed** (desktop default): three ripple layers and lapping foam. **Simple** (phones, `pointer: coarse`): one
    ripple layer and a still wet line. Options → Detailed water (remembered, `exo.water`); `?water=0|1`.
    Cost (phone size, dpr 1, SwiftShader, looking over the sea): ~257 ms/frame with the water hidden, ~203 simple,
    ~247 detailed: within noise, no measurable cost. Tests: `tools/region-smoke.mjs` (no water inside dry Touchdown;
    a coastal region keeping its sea gets it, detailed by default), `tools/options-smoke.mjs` (the toggle).
  - Test site: Touchdown moved to `siteLat: -16, siteLon: -12` with `keepSea: true` (as in `tools/region-smoke.mjs`),
    played through the editor preview.
- **Movement types: ground and hover (v0.34.0):** a unit's **Moves on** field (`move`: ground when empty, or hover).
  Stage 1 of water, hover and air (plan: 2 = water units and shore/offshore buildings, 3 = air units and anti-air).
  - Pathing (`src/sim/path.ts`): `PathGrid(limit, move, height?)`. Ground grids block water (raw < `WET` 0.3);
    hover grids block only building bodies. The sim keeps one grid for colonists (every building blocks), one per
    movement type for combat units (gates don't block), and one terrain-only grid for fauna, built on first use.
    `steer` takes the move too: hover movers don't sidestep water.
  - Predators used to steer straight at their target and slide along shores, so a bay between them and the base
    could stall them. Ground fauna now follow a path round water (`chase`): re-planned every 40 to 50 ticks, or
    when the target has moved more than 3 u (at most every 10 ticks). Walls still don't count for them: they walk
    up to walls and chew through them as before. Hover fauna go straight. Hostiles carry `path`, `goal`,
    `repath`, `planned`. A target unreachable by land (a building on an island) still strands ground fauna on the
    shore. Stage 2 should retarget.
  - Drawing (`src/skirmish/view.ts`): hover units ride on the water (`WATER_LIFT` over sea level) plus 0.15 u,
    bobbing 0.08 u.
  - The editor's "way packs walk in" overlay plans the same path on the live terrain (a fresh grid per call).
  - Content: the **Scout Skimmer** hovers. New **Hover Skiff** (accord, 75 alloys, 190 hp, speed 9, range 16, 7
    damage every 0.35 s): built-in look `skiffGeo` (hull on an air skirt, twin gun, rear fans). New **Strider**
    (fauna, hover: wades through water; 90 hp, speed 6, bite 11): joins every 9th pack slot from pack 8, built-in
    look `striderGeo` (four long legs).
  - Skirmish is unchanged: its flow fields still treat water as blocked for every unit.
  - Water foam (`water.ts`) is now scaled per vertex by how steeply the bed shelves (slope 0.025 to 0.105 u/u),
    so wide shallow flats stay clear instead of turning white. A per-pixel version showed the triangles.
  - Test: `tools/hover-smoke.mjs` (coastal site keeping its sea: a Rover ordered across a bay goes round and never
    gets wet, a Skiff crosses mid-bay over the water, a Swarmer walks round the water toward the base, a Strider
    wades).
- **Water units and water buildings (v0.35.0):** stage 2 of water, hover and air.
  - **Moves on: water** (`src/sim/path.ts`): open water only, ground below `SHALLOW` (−0.6 u), so boats keep off
    the beach. Between −0.6 and 0.3 u only hover craft go. `offLimits(move, h)` is the one rule `steer` and the
    grids share.
  - **Built on** (building `site`, `src/sim/rules.ts`): `land` (default: no sample under 0.6 u, the usual
    steepness rule), `water` (every sample at least 1 u deep, `OFFSHORE_DEPTH`), `shore` (some sample over
    0.6 u and some under −0.4 u, none over 6 u). The ghost gives the reason: "must be built out on the water",
    "must touch the shore", "must reach the water". The build area works as before (water buildings extend it).
  - **Factories** (`factoryMakes`): a shore factory builds water and hover units, a land one ground and hover. The
    sim refuses the rest, and the factory card lists only what it builds. A boat is launched at the nearest open
    water to the door (within 30 u) and moors 6 u further out. The automated playthrough only queues ground
    units at the Bay.
  - **Pads:** offshore buildings get none (a pad would raise an island under them). A shore building's pad levels a
    quay that reaches out over the water: `padded(x, z, h)` (planet.ts) now applies pads to any base, and the
    patch passes it the seabed.
  - **Reach** (the island fix): fauna grids are terrain-only per movement type. `PathGrid.reaches` labels their
    connected open areas (flood fill, built once) and checks whether the predator's area touches a ring round the
    target at body + attack range + 1.5 u. `chooseTarget` skips what a predator can't reach (ground fauna and
    islands or offshore buildings, sea creatures and anything inland). Hover, burrowing and rooted fauna aren't
    limited. With nothing in reach, it makes for the nearest building anyway and waits as close as it can (a
    Lurker off the coast), so it isn't idle.
  - **Packs:** a water fauna joins a pack only if there's open water within 40 u of its spawn (`SEA_REACH`), and
    starts at the nearest open water. Otherwise the slot goes to the next extra, or a swarmer. Touchdown, lifted
    dry, never gets one.
  - **Drawing:** boats sit 0.25 u down in the water, rocking 0.06 u (`src/skirmish/view.ts`).
  - **Content:**
    - **Shipyard:** factory, shore, 150 alloys, clearance 15, staff 1 engineer.
    - **Tidal Generator:** new role `generator` (steady power, no conditions), water, +4 MW, 110 alloys.
    - **Sea Turret:** turret, water, the Defense Turret's gun with range 30, no staff (colonists can't walk out).
    - **Pier:** relay, shore, range 40, 60 alloys.
    - **Gunboat:** accord, water, 420 hp, speed 6.5, range 24, 26 damage, splash 2.5, 100 alloys.
    - **Lurker:** fauna, water, 160 hp, bite 18, every 6th pack slot from pack 3.
    - Built-in looks: `src/world/sea-models.ts` (piles reach below the waterline), `buildSeaTurret` (region.ts),
      `gunboatGeo` and `lurkerGeo` (skirmish/models.ts). Blender models: set v9 (§2).
  - **Transport** (unit `carries`: how many ground units fit; the **Transport Barge**: water, unarmed, carries 4,
    80 alloys):
    - Board: command `board` (ground units, a transport). Input sends it when ground units are selected and a
      transport is tapped. Riders get `ride` and drive to the nearest land to it. The transport comes in to the
      water nearest them (in its own sea). Within hull + 7 u (`BOARD_REACH`, across the shallows) a rider goes
      into its `cargo`: off the map, slot −1.
    - Land: an `order` to a spot on dry land (or the card's Unload, the nearest shore) sets `drop`. The
      transport sails to the water in its own sea nearest that spot (`openNear(…, from)`: same open area, never
      a lagoon past a sandbar). Then everyone goes ashore within 16 u (`LAND_REACH`), on ground connected to the
      drop point when there is some, and drives on to the spot.
    - Sunk with cargo: all lost, counted in units lost. The army limit counts those aboard (`armySize`). Unarmed
      units never chase. The card shows Carrying n / max and the Load tip.
  - **Test:** `tools/sea-smoke.mjs`. It checks:
    - each building fits only where it should;
    - the Tidal Generator comes online;
    - the Bay refuses a Gunboat and the Shipyard a Rover;
    - the Gunboat launches and stays on the water, and stops at the water's edge when ordered inland;
    - a Lurker stays in the sea;
    - a Swarmer by the shore doesn't pick a Sea Turret 11 u out;
    - three Rovers board a barge, cross the water and are put ashore.
- **Air units and anti-air (v0.36.0):** stage 3 of water, hover and air (plan: `docs/ROSTER.md` "Air layer").
  - **Moves on: air** (`src/sim/path.ts`): `offLimits('air', h)` is always false and `straight(m)` (hover or air)
    means "never paths". Flyers have no `PathGrid`: `goTo` gives a unit a one-point path to the goal and `chase`
    steers a predator straight at it. Nothing on the ground blocks them: they skip the push-out from building bodies
    and walls, the "never cross a wall" check and the chew-through-what's-in-the-way logic. Flyers jostle only flyers
    (units and hostiles alike). `canReach` is always true for them.
  - **Anti-air** (unit and building `antiAir`; building `airOnly`): `canHit(h, antiAir, airOnly)` in `core.ts` is the
    one rule. Turrets, combat units (also when answering raids) and autonomist wardens (never anti-air) use it. In
    `strike`, splash stays at the target's level (a burst in the air catches flyers, one on the ground doesn't) and a
    chain jumps to flyers only from an anti-air weapon. Anti-air: the Command Core's gun, Point Defense, the Arc
    Caster, the new Flak Tower (flyers only). Fauna: `canBite` lets a predator go for a colony flyer only if it flies
    itself or is `antiAir` (the Spitter). Flying predators ignore walls when picking a building (they go over them).
  - **Factories** (`factoryMakes`, `src/sim/rules.ts`): a factory with `airfield` (the Airpad) builds flyers and only
    flyers; no other factory builds them. Flyers lift off at the door like vehicles.
  - **Packs:** flying fauna join through `packEvery`/`packFrom` like the others, with no water check.
  - **Drawing** (`src/skirmish/view.ts`): flyers cruise `FLY_HEIGHT` (9 u) over the ground or the water, plus 0–2 u
    by slot so a flock isn't flat, bobbing 0.35 u, banking up to 0.6 rad into turns (eased; a roll about the nose).
    Health bars and the selection ring sit at the flyer. `ArmyView.lift` is the height per slot: tracers and impact
    flashes go up to a flyer (`airAt`, a flyer within 1.5 u of the effect's end), and `ColonyLights.airShadow` puts
    a detached shadow down-sun (straight under it at night, fainter). Picking uses the lifted world position, so a
    flyer is tapped where it's drawn.
  - **Content:**
    - **Skimmerwing:** fauna, air, 55 hp, speed 9, bite 8 every 0.7 s; every 7th pack slot from pack 6.
    - **Gunship:** accord, air, 240 hp, speed 11, range 16, 12 damage every 0.5 s, not anti-air; 130 alloys, 22 s.
    - **Airpad:** factory, `airfield`, 140 alloys, clearance 13, staff 1 engineer.
    - **Flak Tower:** turret, `antiAir` + `airOnly`, range 32, 20 damage every 0.9 s, splash 3.5, 90 alloys.
    - Built-in looks: `gunshipGeo`, `skimmerwingGeo` (`src/skirmish/models.ts`), `buildAirpad`, `buildFlak`
      (`src/world/air-models.ts`; the Flak Tower's `head` aims). Blender models: set v9 (§2).
  - Skirmish is unchanged: its flow fields don't know about flyers.
  - **Test:** `tools/air-smoke.mjs` (coastal site keeping its sea). It checks:
    - the Airpad builds a Gunship and refuses a Rover, the Vehicle Bay refuses a Gunship;
    - the Gunship flies straight across the water and straight over a wall;
    - a Skimmerwing pack crosses a wall without touching it and attacks the building behind;
    - a Defense Turret ignores a Skimmerwing, a Flak Tower shoots it down, and ignores a Swarmer;
    - a Swarmer doesn't go for a Gunship, a Spitter does.
  - `node tools/sim-bench.mjs`: unchanged within its noise (3.1 to 3.6 ms/tick before, 3.3 to 3.5 after).
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
  - **More sounds (v0.51.0):** every situation the game reports now has its own sound (34 sounds, was 25):
    - *Events* (`EventCue` in `src/sim/types.ts`, recipes in `src/audio/synth.ts`): **birth** (a child, a pod
      opens), **death** (a colonist, a line gone), **research** (complete), **confirm** (research, a policy, a
      pod, drone fabrication started; boarding; save restored), **recycle** (cancel or recycle with a refund,
      research cancelled, pod stopped), **mission** (a new one: radio squelch and a rising fifth), **objective**,
      **missionDone**, **victory** (a brassy fanfare), **discovery** (a wreck, first contact with a camp),
      **friend** (trust, partners, coming of age, a strike over, a camp's approach), **exhausted** (a deposit or
      seam), **message** (story lines and replies, the Biosphere Report, the touchdown notes, a story or contact
      card opening); alerts **missionFail** and **defeat** (slow low tolls). Earlier these shared the nine old
      cues: a child's birth played "unit ready", a colonist's death the drone-lost blip, a new mission the
      predator warning, the colony won "pack destroyed". Only the editor's play-test lines stay silent.
    - *Interface:* **select** (anything selected, not deselecting: `select` handler in main.ts) and **order**
      (units sent, a drone moved, boarding, X to stop).
    - *Place* (`GameAudio.beds()`, every frame from `placeSounds()` in main.ts; all placed with `spatial`):
      **surf**, a loop of low-passed noise under waves that swell and break every 5–9 s, as loud as there's
      water round the camera focus (19 height samples twice a second, `regionHeightRaw < 0.3`;
      `sqrt(wet fraction) × 1.5`, so a lake's edge is heard and a shore is full) and as close as the camera is;
      **camp**, low wordless voices on an open fifth through "oo" formants, from the nearest camp the colony has
      met; **build**, a ratchet, clank or weld fizz now and then (2.5 a second at most per site, 0.12 s apart) at
      each site a drone is `working` on; **critter**, every 3–9 s a trill, warble or pair of hoots from the
      loudest of a few calm animals tried (`fauna` state 0). Surf and camp take an audio file (looped) in Rules
      → Sound like the wind; all four sit in the Ambient category and fade in orbit, over cinematics and on the
      title.
    - The Core being hit only exists in the Skirmish prototype, which is silent; there's no separate attack
      order (units given a destination pick their own targets), so one **order** sound covers it.
    - Tests: `tools/sound-smoke.mjs` adds drones heard building, confirm on fabrication, select and order by
      clicking a drone and the ground, a wildlife call, and surf on a Port of Hope shore that fades in orbit.
  - **Title music without a click (v0.51.0):** browsers hold sound back until a tap or key. At load
    `tryAutoplay()` makes a context; where the browser allows autoplay (`getAutoplayPolicy`, or a context that's
    running within 0.3 s) it's kept and the title music starts at once; otherwise it's closed and the first tap
    makes one as before (iOS wants that inside the gesture). While sound is locked the title's status line says
    "♪ CLICK (TAP) ANYWHERE FOR SOUND". Before, only Options was a click that didn't leave the title, so the
    title music seemed to need it. `music-smoke` checks both: blocked (hint, then a click starts it) and allowed.
- **Music (2026-11-19, v0.42.0):** generative ambient, synthesised live like
  the rest of the sound; it never loops, so there's no seam. `src/audio/music.ts` (`AmbientMusic`) plays a
  **mood**: pad chords (per-note oscillators under a slowly breathing low-pass; long swells and releases so chords
  cross-fade) random-walk through the mood's chords (`homePull`: how often it goes back to the first), each held
  `chordMin`–`chordMax` s; a sine bass with its octave on the root; FM bells picking from the chord's bell notes,
  singly or in 2–3 note phrases, with rests, through a dark ping-pong echo (0.63 / 0.95 s); an optional heartbeat
  pulse on the bass (tension); a faint swept band of noise (11 s of noise at a drifting speed, so it never
  audibly repeats); all into a 6.5 s synthetic hall (`hall()`). A 200 ms timer queues notes 1.2 s ahead on the
  audio clock. The mood is read through a getter at every chord/bell/beat, and bus levels are re-read each tick,
  so edits are heard live; blank or half-typed numbers fall back to defaults (`fin()`).
  - **Moods are content:** `content/music/*.json` (editor: Rules → **Music**). Chords are note names
    ("D3 A3 C#4", `src/audio/notes.ts`; content checks flag anything that isn't a note). Tones: pads warm / soft /
    hollow / glass, bells glass / soft / metal / pluck. `use`: title, day, night, tension or none (several with the
    same use: one at random). Shipped: **Title · Drift** (D Lydian), **Day · Long Light** (A major, soft pads and
    bells), **Night · Long Dark** (C Dorian, glass pads, sparse, more echo and air), **Tension · Contact** (E
    Phrygian, hollow pads, metal bells, 72 bpm pulse, 8–12 s chords). The editor's **▶ Listen** (`src/editor/
    music-panel.ts`) plays the draft with its own AudioContext, lights the chord sounding, ⏭ moves on now.
  - **Percussion (v0.44.0):** `src/audio/drums.ts` synthesises eight drums (kick, thud, tom, snare, rim, hat,
    shaker, clank). A mood's **Drum tracks** (up to 8) each give a drum, a step pattern ("x... o..." — x hit,
    o soft hit, . rest; spaces and | ignored; 16 steps a bar, at most 64), a level and a pan; each track loops on
    its own length, so a 12-step track drifts against a 16-step bar. They run at the mood's **Tempo** (the
    pulse's `pulseRate`; a beat is 4 steps), start on the pulse's beat, with optional **swing** (every other step
    late) and **come in after** N chords; ±6 ms and ±10% velocity of human variation. Drums go mostly dry with
    a little of the hall. Content checks flag bad pattern characters. **Tension · Contact** uses six tracks
    (kick, a thud every two bars, toms, a backbeat clank, shaker eighths, a 12-step hat), pulse down to 0.5,
    overall level 0.8. Measured offline: its drums alone about −32 LUFS, about 5 dB under the rest of the mood;
    the whole mood about −26.
  - **More moods (v0.45.0):** two more each for day, night and tension, all with some drums: **Day · Survey**
    (F major, 92 bpm, soft pads, plucked bells in runs, shaker/rim/kick with swing, drums after 2 chords), **Day ·
    Wide Sky** (E Lydian, glass pads, soft bells, far-off toms and a thud), **Night · Deep Watch** (D minor,
    hollow dark pads, low soft bells, a thud every 32 steps at 50 bpm), **Night · Starfield** (A♭ major, glass
    pads, glass bell phrases with lots of echo, a faint swung hat/rim tick), **Tension · Siege** (C Phrygian, 96
    bpm, short warm chords, kick/snare/hat, tom fills, clank), **Tension · Stalker** (dissonant chords over a held
    B, 60 bpm heartbeat, clock-tick rim, a 20-step thud, metal bells). Levels set so every day and night piece
    measures about −27 LUFS offline and tension about −26. The director now avoids picking the same mood twice
    in a row for a use (`lastMood`).
  - **Styles (v0.46.0):** new mood parts, all optional (the earlier moods are unchanged in content):
    - *Pads:* tones **strings** (six detuned saws, high-passed) and **choir-ah / choir-oo** (three saws through
      parallel vowel band-passes, `VOWELS`); **vibrato** (≈5 Hz, up to 22 cents), **detune spread** (random cents
      per voice), **slide in** (`glide`: notes start up to N cents off and slide into tune over the swell),
      **warble** (slow, wide pitch wobble, up to 80 cents); and a **choir** layer singing a chord's top three notes
      over any pad (`choir`, `choirVowel`).
    - *Sequencer:* an **arpeggio** through the chord's notes (`arpMode` up/down/updown/random/chord, `arpRate`
      4ths–16ths, `arpOctaves`, `arpShift`, `arpTone` pluck/square/glass/saw with a resonant filter envelope,
      `arpGate`, `arpBright`; accents on the beat) and a **bassline** pattern on the chord's root (`x` root, `o`
      octave, `5` fifth, 16 steps a bar, through the drum bus).
    - *Melody:* a **lead** (`leadTone` flute with breath noise / soft / glass music box / saw) playing written
      **phrases** (`melody`: one token per step, a note, `-` hold, `.` rest; `parsePhrase`) in order, one at the
      start of every `leadEvery`-th chord from the second, with `leadStep`, `leadGlide` and delayed `leadVibrato`.
    - *Calls:* creature-like cries (three sine partials sliding into or away from a bell note by 2–9
      semitones, or trilling; sometimes repeated) every `callGapMin`–`callGapMax` s, through the bell echo.
    - Moods with an arpeggio, bassline, melody or drums change chord on **bar lines** (chord lengths rounded to
      whole bars at the tempo), and their beat now starts with the first chord.
    - Content checks cover phrase tokens and bassline characters. The editor's ▶ Listen counts arp steps,
      phrases and calls.
    - Pieces: **Day · Relay** and **Tension · Grid Fault** (sequencer), **Day · Homestead** and **Night ·
      Lantern** (melodic), **Title · Accord** (strings and choir; the title now picks one of two) and **Night ·
      Vigil** (choir), **Night · Other Voices** and **Tension · Hive** (alien). Levels matched offline: day and
      night −27 LUFS, tension −26, title −25.
  - **Variety (v0.47.0):** everything had been a pad piece in the same big hall with chords wandering at random, so
    every mood sounded like the same piece in different colours. New mood parts, all optional (earlier moods
    unchanged, except that the arpeggio now restarts its pattern on each chord and melody phrases are picked by
    chord position, `floor((chord − 2) / leadEvery)`, so a tune written to a progression stays lined up with it):
    - *Form:* **Chord order** `cycle` plays the chords first to last (a progression, like a song) instead of the
      random walk. **Sections** (`sections`: chords + layer names from `MUSIC_LAYERS`: pad, choir, bass, bells,
      pulse, drums, bassline, arp, melody, calls) give a piece a shape: each section plays only the layers it
      names, then the next, round again. A queued chord carries its section's layer set; every part checks
      `on(layer, t)` against the chord sounding then. Content checks flag unknown layer names. ▶ Listen shows
      the section.
    - *Time:* **Steps a bar** (`barSteps`, 4–32; 12 = 3/4 or 6/8, 20 = 5/4, 14 = 7/8) sets the bar length that
      chords on the beat round to.
    - *Space and colour:* **Room size** (`room`, 0.4–12 s; the hall's length, read when the music starts),
      **Echo on the beat** (`echoSync`: both taps a dotted eighth at the tempo), **Grit** (a tanh waveshaper on
      the whole mood, unity gain for quiet signals, drive 1–10) and **Worn** (`lofi`: high-pass up to 380 Hz,
      low-pass down to 1.7 kHz: an old radio). Chain: level → grit → wear → out.
    - *Instruments:* pads **organ** (drawbar sines) and **brass** (saws whose filter opens over the swell);
      bells **marimba**, **kalimba**, **keys** (electric piano: FM plus a tine partial) and **harp**; arpeggio
      **string** and **marimba**. Mallets and tines are the FM bell plus extra decaying sine partials
      (`strike()`). Harp and string are Karplus–Strong plucks (`pluckBuffer()`: one period of softened noise
      through an averaging loop, rendered once per note at 24 kHz and cached per context, tuned exactly with
      playbackRate). Drums **taiko**, **hand** (x a slap, o an open tone: hits get the step's mark), **clap**,
      **block** and **zap**.
    - Pieces, each built to be unlike the rest: **Day · Prospector** (frontier folk: fingerpicked guitar in 6/8,
      hand drum, a tin-whistle tune over an eight-chord D major progression; no pads, small room), **Day ·
      Fabricator** (machine minimalism in 5/4: marimba patterns, kalimba, organ, wood block, a 15-step clank
      drifting against the bar), **Night · Transmission** (a late-night jazz broadcast from home: electric piano
      over a ii–V–I–vi in F, brushed swung drums, worn and gritty, static), **Tension · Warpath** (taiko war
      drums in 6/8, brass, a string ostinato, choir; builds and breaks) and **Tension · Interference** (glitchy
      7/8 electronics: random square arpeggio, zaps, clap, heavy grit). Levels matched offline: each mood
      rendered 90 s in an OfflineAudioContext (ticking the scheduler every 0.2 s through `suspend()`) at master
      0.8 × music 0.6, BS.1770 K-weighted and gated: day and night ≈ −26.5 to −27 LUFS, tension ≈ −26 to −27, as
      the existing moods measure the same way. Plucks, mallets and the worn filter carry far less energy than
      pads, so these need overall levels above 2 (the field now goes to 4).
  - **Night · Outer Dark (v0.48.0):** strings and an "oo" choir over a six-chord cycle in 5/4 at
    75 bpm, 16 s chords, five sections (bells; arp and calls; choir, drums and pulse; flute melody; a coda). Its
    phrases are written one chord ahead (phrase k fits chord k + 1), matching how the first phrase plays on the
    second chord. Measured −27.0 LUFS at level 0.95, as written.
  - **Engine fixes (v0.48.0):** noise tails loop their 1 s of noise (`hiss()` in synth.ts and drums.ts started up
    to 0.8 s in, so a tail over 0.2 s could run off the end with a click). Halls (15–70 ms to build, by size) and the
    11 s of air (10 ms) are made once per context and reused (`HALLS` by size to 0.1 s, `AIRS`), so a mood change
    doesn't drop frames as a fight starts. Pad pitch movement goes only to the note's oscillators (the warble used
    to wobble the vibrato LFO too). **⏭ fix:** the next chord is often already queued (LOOKAHEAD); skip used to
    cancel *its* fade-in, leaving its gain at the default 1, so it burst in ~24 dB loud (offline: 0.32 peak after a
    skip against 0.21 before; now 0.21), while the chord sounding never faded. Each queued chord now keeps its
    gains: skip silences and drops the queued ones (and takes back their chord count, so a cycle and its sections
    don't jump), and fades the sounding one from where its swell got to (`cancelAndHoldAtTime`; Firefox lacks it).
    Music volume 0 stops the music (`musicFor` wants none) instead of synthesising into silence; turning it up
    starts a piece again. Panned drum tracks keep one panner each (a timer per hit could disconnect a panner while
    the audio clock was stopped in a hidden tab, losing hits on return); `play()` lets go of its panner; pad
    voices let go of their per-oscillator gains. `music-smoke` checks that volume 0 stops and turning up restarts.
  - **Import and Copy JSON (v0.49.0, editor):** Rules → Music has **Import** beside + New: a dialog takes one
    mood as JSON, pasted or from a .json file (`importRecord` in `src/editor/main.ts`). It drops `$schema`, gives
    missing required fields their `blank()` defaults (and says which), then runs `contentIssues()` on it as if
    saved at the suggested id, so it gets the same checks as a saved file (schema, note names, drum patterns,
    section layers). Problems are listed; Import again on the same text brings it in anyway, to fix in the form.
    The id is offered from the name ("Night · Outer Dark" → night-outer-dark) and `newRecord(…, { exact })`
    keeps the name (no "copy"). **Copy JSON** in a mood's actions copies the draft as `serialize()` writes it
    (clipboard, or a selected-textarea fallback). Both are on for the collections in `IMPORTABLE` (music only so
    far). Tests: `tools/import-smoke.mjs` (10 checks).
  - **Director** (`GameAudio.musicFor`, every frame): the title mood on the title screen; nothing in cinematics
    and the landing (the stretch clock waits); in play, quiet for `firstMusic` s (45), then day or night music
    (daylight < 0.3 night, > 0.5 day) in stretches of `playMin`–`playMax` min (3–6) with `restMin`–`restMax` min
    (2–5) of only wind between (`restMax` 0 = always on). **Tension:** combat FX (shots, bites, deaths; not repair
    beams) on 3 separate ticks within 8 s, from anywhere on the map, brings in the tension mood, even in a quiet
    spell; it holds `tensionHold` s (25) after the last. Cross-fades: 2.5 s into tension, 8 s out, 6 s otherwise.
    The title can loop an audio file instead (`titleMusic` in the sound rules).
  - **Levels:** the **Music** mixer category (`music` in `content/rules/sound.json`, 0.6), then the player's own
    music volume (♫ slider next to Sound in the bar, behind ⋯ on phones; **Music** switch in Options on the title
    and in ⚙ Options; remembered in `exo.sound` as `music`), then master. Each mood's `level` balances them;
    measured offline at the game's default levels (before the player's volume): title −25 LUFS, day ≈ −27, night
    −27, tension −27, peaks under 0.2, so they sit under the UI and effects.
  - **Lost effects fix:** the sim sends 10 snapshots a second; when two arrived in one frame (slow frames, ×3
    speed) the first one's `fx` were dropped, so shots, deaths and their sounds went missing (headless tests saw
    110 of 770 ticks and heard 0–1 of 7 deaths). `SimClient` now carries an unseen snapshot's `fx` into the next
    (`seenTick`, set by main.ts each frame; newest 600 kept). Now 7 of 7.
  - The title's Options region list shows each region's world (the region's `body`, Home if empty) under its
    name, Home's regions first.
  - Tests: `tools/music-smoke.mjs` (14 checks: silent before a tap, title chords and bells, Options' Music switch
    and region worlds, stops when the title closes; quiet after landing, a calm stretch, tension in a fight with
    its pulse, music volume remembered; the editor's ▶ Listen and ⏭). The moods are first passes to tune by ear.
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
- **Title tour (2026-11-18, v0.24.0):** after 25 s over home the title camera flies to a random planet or
  big moon (`SolarSystem.tourStops()`: no comets, radius ≥ 600), stays 15–25 s, moves on, and goes home
  ~30% of the time (25 s there). A trip is a log-space distance arc (out, pan near the top, in) over 5–9 s;
  the arrival yaw is picked with `ZoomCamera.viewDir` so the sun sits ~57° off the view axis (a lit disc
  with a terminator). `SolarSystem.tour` (0..1) lights from the real star, keeps the stars bright and hides
  markers/orbit lines while away. Leaving the title while away snaps back to orbit over home. The wordmark
  also shrinks to fit its column (`fitMark`, v0.23.1): SF Mono on iPad clipped the last S. Test: set
  `__exo.title.dwell = 0` to start a trip now.
- **Planet detail + versions (2026-11-16, v0.9.0):** `src/world/surface.ts`. A 2048×1024 equirect surface
  map (colour + flora, height + baked slopes) from the same `surfaceAt` as the globe geometry, baked in
  `surface-worker.ts` after the first frame (~2 s on hive1, nothing waits on it) and faded in. The globe
  shader adds it per pixel from ~250 u altitude up: relief from the slopes, smooth glinting oceans with
  depth, fine grain, bioluminescent flora specks on the night side; a cloud shell (R×1.022) fades in above
  ~400 u. `?surface=0` turns it off. Planet view costs ~2× the old globe in SwiftShader (130 vs 65 ms at
  390 px); the ground view is unchanged. Versions: `package.json` + `src/changelog.ts` (What's new on the
  title and ⋯), checked by `tools/version-check.mjs` in `npm run build`.
- **Performance pass (2026-11-18, v0.35.0):**
  - Measured, phone size in SwiftShader: the main thread is idle ~92% of each frame, waiting on the GPU. JS per
    frame is under 1 ms (region and HUD updates); submitting the draws is ~5 ms. Turning one feature off at a time
    (lights, shadows, fog of war, simple water, flora) moved the frame time by less than run-to-run noise
    (±20%; lights off was the clearest saving). No visual cuts without a real phone to measure on.
  - **Sim tick** (`node tools/sim-bench.mjs`): 7.9 → ~3.4 ms on hive1. With ticks at 10 Hz and three per 100 ms at
    ×3, a phone ~4× slower was close to falling behind in big fights.
    - `src/sim/spatial.ts` `Buckets`: uniform grid buckets, arrays reused.
    - Predator separation and push-out of buildings and walls, and wall-crossing checks: only nearby hostiles
      (6 u cells) and buildings. Buildings are bucketed by body plus `BODY_MARGIN`, rebuilt when the set changes.
    - Grazers flee only nearby drones, units and predators (`FLEE_R` cells) and keep out of nearby buildings.
    - Units' push-out uses the building buckets. Idle units answering attacks share one list per tick
      (`raiders()`) instead of each scanning every hostile and looking its target up in the building list.
    - Candidates are sorted by index, so pushes apply in the same order a full scan would.
  - **Building pads, flat look:** placing a building re-levels the patch under it. It used to recompute normals for
    all ~90k vertices and re-upload both attributes (a hitch). Now only the moved triangles get face normals, and
    only that range is uploaded (`addUpdateRange`). The smooth look (indexed) still recomputes all.
  - **Units and water:** separation could push a ground unit into the water (or a boat ashore). A push that would
    put a unit off its movement type's ground is undone.
  - **Flaky tests fixed:**
    - `tools/smoke.mjs` "Switch on": the test pressed while the card still said "Switch off" after a slow
      frame. It now waits for the card.
    - "Threat shown in the resource bar": the turrets could kill the pack before the check. A watcher now
      records the bar from the wave on.
    - `tools/skirmish-smoke.mjs` order drag: it now finds the moving unit again before each attempt.
## 6. Roster additions

From `docs/ROSTER.md` (batches A and B, 2026-11-18). Smoke test: `tools/roster-a-smoke.mjs`.

- **Lancer (v0.25.0):** a unit record only, plus a new weapon look `rail` (`FX.RAIL` = 13: a thin white
  full-length tracer and an impact flash; its own synthesised sound, `rail` in the sound rules). 100 damage
  every 2.8 s at 30 u: three hits kill a Brute.
- **Sensor Mast (v0.25.0):** new building role `sensor`, which does nothing but see (its Sight, 55 u). Power
  rank with the radar.
- **Habitat Block (v0.25.0):** a `civic` building with `pods: 0`, housing 6. The card says "housing only".
- **Relay Tower (v0.25.0):** new role `relay`: once finished, new buildings may go anywhere within its Range
  (55 u), like the Core's; `placeProblem` and the placement area rings both know it. Region links come later.
- **Nests (v0.26.0):** a fauna unit with `nest` (content `units/nest.json`: 1,600 hp, speed 0, no attack) grows on
  every predator spawn whose `nest` isn't off (`SimState.nests`: spawn index, hostile id, regrow tick). Nests
  are hostiles with `nest` = their spawn: they skip targeting and movement, never get pushed (whoever bumps
  takes the whole push), have no pack, and draw only in sight like any hostile. `stepWaves` picks a spawn
  among those with a standing nest (or none set); with none open the pack waits 30 s and tries again. A
  killed nest regrows after `threats.nestRegrow` (600 s) with a warning; the kill sets story flag
  `nest-destroyed` and counts `stats.nestsDestroyed`. Hurt (hp dropped since last tick) and off cooldown
  (12 s), it lets out `guards` swarmers as an announced pack. Built-in far-LOD look `nestGeo`.
- **Wrecks (v0.26.0):** region list `wrecks` (x, z, facing, salvage alloys; Touchdown has two). They show once
  sighted (fog), which sets flag `wreck-found` (story card *Familiar Hull*, `story/familiar-hull.json`). A Field
  Engineer with nothing to mend strips any wreck within reach + 4 u at 4 alloys/s (repair beam, counts
  `stats.salvaged`); a stripped hull sinks. Model `exo-wreck` for all of them, built-in stand-in until it loads.
  Minimap: grey marks for found wrecks with salvage left. Blender set v6: nest (900 tris), wreck (860).
- **Research (v0.27.0):** new collection `content/research/<id>.json` (name, description, requires, cost,
  isotopes, seconds, order); the editor lists it under Game data. Units and buildings name the research they
  need (`research`); the sim refuses them until it's done, the build menu shows them locked (🔒) and the Vehicle
  Bay hides them. One project at a time (`SimState.research`: done ids, active id + progress), paid up front,
  refunded in full if cancelled, run at the best powered finished Tech Lab (role `lab`; `people.mult` so staff
  speed it up). Finishing sets story flag `research-<id>`. Play test setup takes `research` and `isotopes`.
  Tech Lab card: the list (done / % / cost / "after X") and a button per available project.
- **Isotopes (v0.27.0):** a second resource (`SimState.isotopes`, top bar ◇, dim until there's any or a mine
  or reactor stands). Region list `seams` (x, z, isotopes): violet crystals (`buildSeam`, shrink as mined),
  minimap dots; nothing else may be built on one (`SEAM_RADIUS` 4 + body). Deep-Core Mine (role `deepmine`,
  needs Deep Survey): on a free seam within its Range, mines `mineRate` isotopes/s while powered (battery ok).
  Building and unit records can cost `isotopes`. New building field `lure`: predators choosing a building
  treat it as that much closer (the mine has 30). Touchdown's two seams are outside the starting build area.
- **Fusion Cell (v0.27.0):** role `reactor` (needs Isotope Cells): `powerMW` while it burns `fuelRate`
  isotopes/s; none in store → no power and one warning until it has 20 ticks' worth again.
- **Too Good (E6, v0.27.0):** story card 20 s after a Tech Lab is built (`story/too-good.json`).
- Blender set v7: Tech Lab (1,164 tris), Deep-Core Mine (1,268), Fusion Cell (1,788; glow parts `charge`).
  Test: `tools/research-smoke.mjs` (lab → survey → relay → mine → isotopes → fusion).
- **Relic grids (v0.28.0, STORY.md E2):** region list `relics` (grid id, part sentinel / node / cache, x, z,
  cache alloys / isotopes). Sentinels and nodes are hostiles of a new faction `relic` (unit field `relic` names
  the part: `units/sentinel.json`, `units/gridnode.json`) with `relic` = grid and `dormant` (inert, untargetable)
  until the grid wakes: anything of ours (unit, drone, building) within a relic's aggro radius. Waking logs the
  97.3% firmware match, sets `relic-woke` (card *Handshake*), and every other sentinel (by id) stays dormant;
  the rest shoot (arc look, 26 u) and the nodes become targetable. A grid with no nodes left powers off (all
  members dormant), its caches open and pay out, flag `relic-opened` (card *Deep Layer*), `stats.relicsDown`.
  With research Relic Studies a Field Engineer with nothing to mend re-tunes a node in reach over 20 s (no kill).
  Any speed-0 hostile is immovable in separation (nests and relics). Caches render from `exo-cache` once
  sighted; their `seal` part goes dark when opened; minimap marks unopened found caches. Touchdown's grid
  `ridge` is at about (15, 95): 2 nodes, 4 sentinels, 1 cache (400 alloys, 60 isotopes).
  Blender set v8: sentinel (712 tris), grid node (612), cache (256). Test: `tools/relic-smoke.mjs`.
- **Zoomed-out built-ins (v0.28.1):** every roster model has a procedural, flat-shaded twin with its size,
  silhouette and colours: buildings, wreck and cache in `src/world/roster-models.ts` (sensor, habitat, relay,
  lab, deep mine, fusion; KIND_MODELS), units in `src/skirmish/models.ts` (lancer, nest, sentinel, grid node). All
  listed in the editor's library. `RegionView` now has a level of detail like the army's (`LOD_NEAR` 90 /
  `LOD_FAR` 105 on `cam.dist`, hysteresis): any non-batched building with an asset model, and every wreck and
  cache, holds the asset and its built-in side by side (`lodPair`, the set `lods`) and shows one. Batched kinds
  (walls, solar, defences, radar, …) stay asset-only. Animated parts (`ring`, `plume`, `door`, civic `gpod`) are
  driven on both halves; placement ghosts drop the far half. Checked in `tools/roster-a-smoke.mjs`. Inhabitants
  get the same treatment on the `claude/gallant-hawking-3lse24` branch via an asset `far` field.

### Roster batch C (v0.37.0)

The rest of batch C from `docs/ROSTER.md`: shields, planet health with the Seed Bank, and the Medevac.
Test: `tools/batch-c-smoke.mjs`.

- **Shields** (research **Shield Lattice**: needs Deep Survey, 120◆ 20◇, 60 s):
  - Fields `shield` (charge, hp), `shieldRadius`, `shieldRegen` on buildings (role `shield`) and on units. Charge
    lives on the Building / Unit (`sh`, `shDown`). `stepShields` (after the units, before the predators) recharges
    them: a projector while powered (staff speed it up), a unit always. A collapsed shield comes back at
    `SHIELD_BACK` (30%). A new projector starts empty. The shields that are up go on a list for the tick (`domes`).
  - `soak(h, tx, tz, dmg, fx)` is the one rule, used where a predator's blow lands (`stepHostiles`). Of the shields
    up over the target with the attacker outside them, the one with the most charge takes the hit. Overflow goes
    through, and at 0 it collapses ("shield down", warning). An attacker inside the dome hits normally. Covered:
    buildings, units, drones and colonists alike. The tracer stops at the dome's edge, plus `FX.SHIELD` (14) there:
    a cyan flash, a light-map flash and its own synthesised sound (`shieldHit`).
  - Power: projectors rank with the shooters (most protected) and draw their full power all the time.
  - **Shield Projector:** 180◆ 30◇, 600 hp, −5 MW, dome 1,200 charge, 22 u, 15/s, staff 1 technician.
    **Aegis Crawler:** 140◆ 10◇, 260 hp, speed 4.2, unarmed, bubble 400, 9 u, 10/s (Vehicle Bay).
  - Drawing: `src/world/shields.ts` (`ShieldDomes`): a sphere per shield that is up, centred on the ground (the
    terrain hides the lower half). The shader adds a rim glow and a slowly drifting lattice, with the log-depth
    chunks (the renderer uses a logarithmic depth buffer). It dims with the charge and flashes when the charge
    drops between frames. `RegionView.syncShields` feeds it projectors from the snapshot's buildings and Aegis
    units (interpolated) from `UnitSnap` (`sh` 0..1, `shR`, `shUp`). Cards: dome or bubble charge, recharge, status
    ("Dome down · recharging 12% (up at 30%)").
- **Planet health** (`src/sim/planet.ts`, `SimState.planet`, `Snapshot.planet`): `health = start − scars − harm +
  restored`, 0..100. Colony rules: `planetStart` 70, `scarPerAlloy` 0.004, `scarPerIsotope` 0.02, `scarBuildingLost`
  1, `nestHarm` 3, `campHarm` 12, `rewildMax` 20.
  - **Scars** are places with a size in health points, merged within 6 u: a depot's mining scars its deposit,
    a deep-core mine its seam, a destroyed building its spot (a wall segment a quarter), a destroyed nest its site.
  - **Harm** is lasting: a nest destroyed (plus its scar), a camp gone (driven off or leaving, `Inhabitants.leave`).
  - **Seed Bank** (role `seedbank`, 110◆, −1.5 MW, range 34, `restoreRate` 0.03 health/s, `restoreCost` 3
    biomass per point, staff 1 botanist): while powered it heals the worst scar in its Range. With none in reach
    it rewilds at half the rate, adding to `restored` up to `rewildMax` across the whole colony. It only spends
    biomass above a quarter of storage, so it never starves anyone. What it spends shows in the food readout.
    Power rank with the farms. Its `ring` turns while it works.
  - **Biosphere Report:** as each sol ends (`p.sol` < the current sol) planet health is sent home: a log line with
    the change since the last one, `reports` (one number per sol), and the story flag `biosphere-report` the first
    time.
  - Story hooks: conditions `planet` (health ≥ Count), `planetBelow` (≤), `reports` (Count sent); effect `planet`
    (raise by Amount for good, negative = lasting harm). The playthrough bot builds a Seed Bank for a `planet`
    condition.
  - HUD: 🌍 in the top bar (amber below 45, red below 25; the tooltip has the last report and how many places are
    scarred), the Seed Bank card (scars in reach, health to heal), and planet health on the end screen. The ground:
    each scar is a dark patch in the light map's shadow layer (`ColonyLights.update({ scars })`), bigger and darker
    the deeper it is. Like every light-map shadow it only takes away direct sunlight, so it shows by day.
- **The injured and the Medevac:**
  - When a building falls (not when it's recycled), the people inside who survive the 60% hit are left **lying
    injured** by the ruins (`Colonist.down`, seconds left: people rules `downSeconds`, 60). They don't walk, decide
    or heal, and predators can still get them. At 0 they die ("died of their injuries before help came"). The
    alarm says a Medevac can bring them in. In the walkers they're flagged (flags 1 child, 2 injured), drawn lying
    flat and pulsing red. The roster says "Injured: needs a Medevac (N s)".
  - **Medevac** (unit field `rescues`: how many it carries; content `units/medevac.json`: 70◆, 220 hp, speed 8.5,
    aggro 90, carries 4, unarmed). `stepMedevac` picks up anyone injured within 2.5 u of its hull, wherever it's
    going (`People.board`: `at` = `AT_RIDE` (−2), `ride` = the unit, the clock stops). Idle, it drives to the nearest
    injured person within its aggro while it has room. Then it takes everyone aboard to the nearest finished home
    (any building with housing) or the Core, and `People.admit` puts them indoors there: hp at least half, +4
    acceptance (the AI came for them). Move orders come first. Riders follow it about (`carry`). Lost with people
    aboard, it spills them back on the ground injured (at most half the time, at least 15 s). A rider whose medevac
    has gone (an old save) is put back down the same way.
  - `People.outdoors()` (what predators can reach, the alert, the walkers) now means `at === −1`: riders are
    neither indoors nor out.
- Built-ins: `buildShieldProjector`, `buildSeedBank` (`src/world/batchc-models.ts`, in `KIND_MODELS`), `aegisGeo`,
  `medevacGeo` (`src/skirmish/models.ts`). All are listed in the editor's library. Blender models: set v10 (§2).
- **Test:** `tools/batch-c-smoke.mjs` (Touchdown, packs held off). It checks:
  - a powered projector holds its dome; spit from outside leaves the Solar Array under it untouched;
  - a Swarmer inside the dome bites through it; a drained dome collapses (announced) and spit gets through;
  - an Aegis bubble soaks spit aimed at the unit under it;
  - planet health starts at 70; mining scars the deposit and lowers it;
  - a Seed Bank heals the scar (spending biomass), then rewilds past 70;
  - a Biosphere Report goes out as the sol ends (flag set); the top bar shows 🌍;
  - the three people in a fallen Civilian Center lie injured (and are drawn so); a Medevac brings all three in
    to the Habitat Block; with no Medevac the injured die when their time runs out.

### Med Bay and Memorial (v0.38.0)

From `docs/ROSTER.md` (buildings: Med Bay, Memorial). Code: `People.care` in `src/sim/people.ts`, the Medevac's choice of
destination in `stepMedevac` (`src/sim/core.ts`), cards in `src/colony-hud.ts`. Test: `tools/medbay-smoke.mjs` (headless).

- **New building fields:** `aura` (Comfort: wellbeing for colonists whose home is within Range, while the building
  stands and is powered; the best of each kind counts, two of a kind don't add up) and `treatSeconds` (Med Bays).
- **Med Bay** (role `medbay`, 100◆, 380 hp, −1 MW, range 36, treatment 8 s, comfort 6, staff 2 medics). Once a second
  (`care`), each powered Med Bay **stabilises** everyone lying injured within its Range (their clock stops: the
  `stable` set, checked in `step`) and moves its stretcher on by 1 s × its staffing multiplier; at `treatSeconds` the
  worst off is brought in (indoors there, full hit points, +3 acceptance, a log line). Two Med Bays over the same
  person don't double up. Homes in its Range get *Medical care* (+6, the same reason as a medic in the house) and their
  people's yearly chance of dying of old age is halved (`MEDBAY_AGEING`); growth pods in its Range get the medic's
  ×1.5 grace. A **Medevac** with riders now takes them to the nearest finished home, Core or powered Med Bay, counting a
  Med Bay's distance at 0.6× (so it prefers one that isn't much further); admitted at a Med Bay they're fully healed.
  Power rank with the homes. Snapshot: `people.care` (Med Bay id, stretcher progress, how many wait); the roster says
  "Injured: stabilised, a Med Bay crew is coming".
- **Memorial** (role `memorial`, 60◆, 600 hp, no power, range 44, comfort 4). Homes in its Range get *Memorial* (+4).
  While any stands, grief fades 1.75× faster (`MEMORIAL_GRIEF`). Its card lists the dead (latest eight from the
  memorial log: name, age, cause; the Colony panel has the rest).
- Test checks: four people from a fallen Habitat Block are stabilised in Range and all brought in alive, one log line
  each; out of Range they die as before; switched off it does nothing; a Medevac takes its riders to the Med Bay over a
  nearer home, fully treated; comfort reasons in and out of Range; grief fades faster with a Memorial.


### Act 1 regions on Home (v0.39.0)

Seven new regions in `content/regions/`, laid out as starting points to tailor in the map editor. Each `description` says
which STORY.md beat it is for, what its story sites are and which hooks would suit it; no story events or missions point
at them yet. Generated once by a script (not kept in the repo, so it can't overwrite hand edits) from the map editor's own
generators (`src/editor/terrain-gen.ts`) plus rings, bowls and cones; markers were snapped to dry ground gentle enough to
build on. Flora is stored in steps of 10 and paint amounts in tenths, and the small bumps come from each region's Local
relief (`detail`, `detailSize`, `detailSeed`) rather than the sculpt, which keeps the grids small (about 95 KB gzipped
for all seven; all content is bundled).

| Region | Site | Size | Beat | Story sites | Notes |
|---|---|---|---|---|---|
| `ridgeback` The Ridgeback | −10°, −10° | 280 | Beyond the Ridge, E1/E2 | `ridge-ruin`, `north-pass`, `south-pass`, `ridge-view` | A spine of rock east of the Core with two passes; relic grid `spine` on the crest; richest deposit and both seams beyond it; 2 Brutes guard the north pass |
| `hearthsmoke` Hearthsmoke Vale | 10°, −20° | 280 | E4, E5 | `vale-smoke`, `keeper-stones`, `burned-field` | Two Vell camps (village NW, song-keeper NE by a stone circle), a stream bed, a burnt crater field with a hull (sky-fire); packs ×0.75; a 2,400 deposit on Vell land |
| `choir-field` The Choir Field | 20°, 40° | 240 | E8 | `choir-loop`, `dead-mast`, `code-wall` | A levelled ash-and-rust plain (sculpt pulls the ground 65% toward its mean) ringed by mesas; the Choir's camp in the north inside a worn ritual loop; relic grid `litany`; 3 rich seams; Spitters at the code wall |
| `burrow-reach` Burrow Reach | 40°, 10° | 280 | E9 | `furrow-grid`, `spitter-pans`, `brood-mound` | A perfect sine furrow grid (designer marks), terraces in the east, burrow pits, acid pans; 4 nests, packs ×1.3; Burrowers guard the furrows, Spitters patrol the pans, Brutes the mound |
| `splinter-hollow` Splinter Hollow | 0°, 50° | 240 | E11 (and Act 2 Kindred) | `splinter-camp`, `hollow-gate`, `old-cellar` | A basin inside a ring of hills with one gap east; one spawn, outside it; packs ×0.6, 15 min grace; an old hull over a cellar (Survivors hint) |
| `deep-layer` The Deep Layer | −40°, −50° | 320 | Deep Layer (optional), Survivors | `oldest-layer`, `enclave-cut`, `crater-rim` | A crater NE of the Core with terraces (the layers), relic grids `outer-ring` (rim) and `deep-ring` (floor, cache 800◆ 250◇), 3 rich seams; a cut through the NE rim; 10 Swarmers appear on the floor once a grid wakes (`relic-woke`); packs ×1.5, 900 starting alloys |
| `signal-heights` Signal Heights | 50°, 20° | 240 | E12, E13 | `carrier-trace`, `listening-post` | A snowbound plateau above the snow line with a pinnacle (NW) and a hull at the old listening post (SE); 4 Skimmerwings guard the crags (bring anti-air) |

Checks: the content check; `node tools/balance.mjs --region <id> --strategy balanced` for 25 minutes on each. The bot
loses Touchdown at 19.7 min with that strategy; the new regions range from Burrow Reach (17.5) to Splinter Hollow
(survives), as their threat levels intend. Every region loads in the game with no page errors.

### Surface detail on the other bodies (v0.40.0)

`src/world/body-surface.ts`, used by `buildBodyObject` (`src/world/system.ts`): the system view, the title screen's tour
and the editor's Worlds preview. The body being played is unchanged (its globe has the baked maps, `surface.ts`).

- **Rocky bodies** keep their vertex-coloured icosahedron; `addRockyDetail` patches its `MeshStandardMaterial`
  (`onBeforeCompile`, program key `exo-rocky-body`). Everything is a function of the object-space direction
  (`vBodyDir`), so it turns with the body and never stretches at the poles. Layers, each with a colour change and a
  height (`bH`) that tilts the normal by a screen-space bump (`dFdx`/`dFdy` of the height in world units, scaled by
  the radius):
  - **craters** at three scales (cell noise at 6, 17 and 48 cells across the sphere): bowls, rims that wobble, central
    peaks in the big ones, bright rays; fewer in maria;
  - **maria** (broad dark lowlands), **ice fractures** (cell edges on warped coordinates, two scales, broken up so they
    read as long lineae), **lava** (crust plates with glowing seams, emissive, only some of them flowing),
    **sulfur calderas** (dark vents in pale or red halos, a few glowing), **dune streaks** along warped latitudes,
    **polar frost** with a ragged edge, mid-scale **mottling**, rough ground and a fine **grain**.
  - Every layer fades out once its features are under a pixel (`bFade`: `fwidth` of the scaled direction), which also
    skips its work, so a distant moon costs little and nothing shimmers.
- **Looks** (body field `surface`): cratered, icy, volcanic, sulfur, dusty, verdant, smooth, or `auto` (empty), which
  picks one from the record (`autoLook`): comets icy; seas verdant; hot orange colours volcanic; yellow sulfur; bright
  blue-grey icy; air without seas dusty; otherwise cratered. Today that gives Ash, the Dunmore moons, Maren, Orrin,
  Pip, Sela and Talus cratered; Cinder volcanic; Io-T sulfur; Kora, Teth, Vess, Rime and both comets icy; Dunmore
  dusty; Home and Verdance verdant. `surfaceDetail` (0–2) scales the whole look, `craters` (0–3) the crater count.
- **Gas giants** (`giantMaterial`, key `exo-giant`): a smooth 96×64 sphere; bands from the record's palette (up to 8)
  looked up per pixel from a latitude pushed about by turbulence, with long waves along the band edges, streaks along
  the latitudes, a great storm oval with a dark collar and swirls (red or white on warm giants, a dark spot on ice
  giants: a palette where every colour is at least as blue as it is red), scattered small white ovals and darker poles.
  It drifts slowly with `bodyUniforms.uBodyTime` (set in `SolarSystem.update`).
- **Rings** (`ringMaterial`, key `exo-ring`): a 512×1 canvas of ringlets (summed sines) and three gaps from the seed,
  looked up by the radius in the ring plane; soft inner and outer edges.
- **Clouds**: a body with `clouds` that isn't the one being played (Verdance; Home when playing elsewhere) gets a lit,
  drifting cloud shell (`cloudShell`).
- Checked with full-disk and close-up renders of all 22 bodies (no shader errors), the title tour and the system view.

### Title screen: Region and Sound in Options (v0.40.1)

The title's REGION and SOUND choices moved into Options (`openOptions` takes extra rows from the title: `Toggle` gained
`section`, a heading where it changes, and `state`, the text in place of ON / OFF). Sound is a toggle; each region is a
row (HERE on the current one) that reloads into it (`goRegion`). The in-game ⋯ Options stays graphics only. Tests:
`tools/region-smoke.mjs` (pick a region in Options), `tools/options-smoke.mjs` (sound and regions first, graphics last).


### Biomes and wildlife (v0.41.0)

Two content collections, editable under **Nature** in the editor, with a 3D preview (`src/editor/nature-preview.ts`:
one plant of each form in the biome's colours and its wildlife walking round, or a species at its smallest and largest
beside a grazer; Night shows the glow; Another roll rebuilds the plants from a new seed).

- **Biomes** (`content/biomes/*.json`, `biomeShape`): plant forms (each row a form with a Chance that a region grows
  it and an Amount against the others), Extra species (look-alike repeats), stem and glow colour lists, glow, density,
  size and wind multipliers, and a weighted wildlife list. Shipped: verdant (Home), lush (Verdance), arid (Dunmore),
  frozen (Rime), volcanic (Cinder), barren (Ash and the airless moons).
- **Which biome** (`src/content/nature.ts biomeId`): `?biome=<id>` (test override; the sim plays the region with it),
  else the region's `biome`, else the body's, else `autoBiome` from the body record (no air → barren; volcanic/sulfur
  look or "molten" → volcanic; icy look, "frozen" or a low snow line → frozen; no seas or dusty → arid; plants > 0.05
  → lush; otherwise verdant). Plant life (−1 barren) still gates how much grows, so most bodies grow nothing unless
  their Plant life is raised or flora is painted.
- **Flora** (`src/world/flora.ts`): 13 forms (`ARCHETYPES`): spire, parasol, canopy, tendril (big); fan, tubes, bulbs,
  crystal, reeds, cap, barrel, thorn, lichen (small; crystal and lichen are `cliff` forms that grow on steep ground).
  A region's species are the biome's rows that pass their Chance plus Extra repeats (at most 12, so at most 24
  instanced draws as before: 2 variants each). Ground cover is normalised by species count per size class (`share`:
  Home's old mix was 3 big, 5 small), so a biome with more forms isn't denser. Palettes come from the biome's colours
  (`palette(r, biome)`), jittered per species. Glow and wind scale the shared `floraUniforms`.
- **Wildlife** (`content/wildlife/*.json`, `wildlifeShape`): body plan (`src/world/fauna-models.ts`: hexapod, stilt,
  hopper, ray, crawler, shell, serpent; 60–330 tris, colours and an `aGlow` channel baked into the vertices),
  behaviour, size range, walk/run speed, wariness (flee radius), spread, herd size ×, flying height, colours.
  23 species shipped, four or five per biome.
- **Herds** (region `herds[]`, new optional `species`): empty picks from the biome's wildlife, weighted and stable per
  region (`herdSpecies`: hashed from the region's flora seed and herd index; herd 0 always gets the biome's first
  species). The count is Grazers × the species' Herd size × (`herdCount`), so big beasts come in fewer.
- **Sim** (`stepGrazers` in `src/sim/core.ts`): `Creature` gained `sp`, `st` (0 calm, 1 running, 2 hidden), `wait`,
  `ang`. Behaviours: **herd** (as the old grazers), **skittish** (dash at 60% run speed, pause 0.8–3.8 s, flee from
  far), **lumber** (turns to stare at a threat instead of fleeing; still bolts from the landing), **flyer** (circles
  the herd centre, wider and faster when disturbed, ignores buildings), **burrow** (hides 3–7 s after the last threat,
  doesn't move while hidden). Old saves: creatures without `sp` take their herd's species on load.
- **Snapshot**: `fauna` is now 4 floats per creature: x, z, heading, species index × 4 + state, the index into
  `wildlifeIds()` (sorted ids, the same in worker and page).
- **Render** (`RegionView.syncWildlife`): one `InstancedMesh` per species present (grown as needed), one shared
  material (`creatureMaterial`: flat vertex colours, glow from `floraUniforms.uGlow`, fog-of-war patched as before).
  Per instance on the CPU, no per-frame allocation: size from a hash of the index, walkers bob, hoppers hop, flyers
  glide at their height and flap (x scale), burrowers ease down out of sight. Typical cost: 2–4 draws for wildlife
  (was 1) and fewer creatures than before (big species' herds are scaled down).
- Asset browser: the old Grazer built-in is replaced by **Wildlife: <body plan>** entries; Flora lists all 13 forms.
- Checked with close-up renders of Touchdown as verdant, arid, frozen, volcanic and lush (`?biome=`), the editor
  previews, `npm run build` and `tools/map-smoke.mjs` (now reads 4 floats per creature).

### Blender nature models (v0.43.0)

`blender/build.py` "set v10: nature" builds the seven wildlife body plans (`exo-wild-<plan>`, 260–760 tris) and the
seven new plant forms (`exo-flora-<form>`, 87–572 tris) as recolourable models: their materials are colour slots, not
colours. Wildlife: `color`, `accent`, `glow` (`claw` keeps its dark colour). Plants: `stem` (graded from the species'
base colour at the root to its tip colour at the top), `leaf`, `glow`.

- `src/world/recolor.ts recolorModel(root, slots)`: flattens the model (`flattenForInstancing`) and bakes it into one
  geometry with vertex colours and `aGlow` in a species' colours, so it draws with the shared flora / wildlife material
  and instances exactly like the procedural shapes (draw calls unchanged). A material that isn't a slot keeps its own
  colour and glows if emissive.
- Content: wildlife and biome plant rows gained an optional **Model** (asset ref). All 23 species and every biome row
  for the seven new forms name their model; empty = the built-in shape (the older six forms stay procedural).
- Game (`main.ts`): loads only the models the region's biome and herds use (`?models=builtin` skips them), then
  `RegionView.setNatureModels` swaps each species' geometry when its model arrives (`Flora.setModels` widens the
  per-instance cull spheres by the radius ratio). The built-ins draw until then.
- Editor: the Nature preview loads the models too, so a species or biome shows as the game draws it.
- Checked: in-game renders of Touchdown as verdant and arid, editor previews of a shell, ray, serpent and the lush biome.

### Unit movement round buildings (v0.49.1)

`tools/path-bench.mjs` (headless, ~20 s): a packed base (rings round the core, as tight as placement allows), a
base on a grid with 3 / 5 / 8 u lanes, and a walled yard with one gate; groups of every ground / hover combat unit
ordered across, into the middle, onto a building and through the gate (12, 20 or 30 at a time). A unit passes if it
ends within 4 u of its spot, or of the nearest point its path can reach when the spot is walled off. Exit 1 on any
failure.

- **Found:** 31 of 576 units gave up 15–45 u short going into the packed base. `goTo`'s stall check measured
  straight-line distance to the goal, so a detour round the base (farther first) read as stuck: 9 s without getting
  closer and it gave up. Scouts also took twice as long as needed, circling waypoints (turn radius 13 / 6 = 2.2 u
  is wider than the 1.5 u "reached it" radius).
- **Fixes (`src/sim/core.ts`):**
  - Progress is the length left along the path (to the next waypoint plus the rest), still re-planned every `STALL`
    ticks without progress and dropped after three times that.
  - A waypoint counts as passed within 1.5 u, or within 4 u once the unit is past it along the next leg.
  - When the path ends short of the goal (walled off, or inside a building), the unit stops on reaching its end.
  - `steer(…, brake)`: units (not fauna) slow to as little as 25% into a sharp turn.
  - `order`: a formation spot inside a building (or off-limits ground) moves to the nearest open ground at least
    0.8 × `SPREAD` from spots already handed out, so a group sent onto a building spreads round it.
- **After:** 976 / 976 (with the 30-unit and onto-a-building cases added); travel times unchanged except Scouts into
  the packed base, 28.4 → 14.0 s. `tools/units-smoke.mjs` passes.

### Game menu and a slimmer HUD (v0.50.0)

- **Bottom bar:** Build · ❚❚ ▶ ⏩ · Surface / Planet / System · ☰ Menu (8 buttons; was ~20 plus two sliders, with a ⋯
  overflow on phones). Save, Load, New game, Look, Lights, Options, Skirmish, the version and Sound are gone from it.
- **Game menu** (`openMenu` in `src/options.ts`, `openGameMenu` in `main.ts`): ☰ Menu, or Esc when nothing is selected,
  nothing is being placed and no panel is open (a capture-phase listener, so the input's own Esc still deselects
  first). Pauses while open and puts the speed back on close. Resume · Save · Load · Options · What's new · Skirmish ·
  Title screen · New game (two taps: the button turns amber and says what will be lost). Options and What's new come
  back to the menu when closed. It shares the options overlay (`#options.menu`), so only one panel is ever up.
- **Options rows** can be `Slider`s (`kind: 'slider'`, 0–100): Volume and Music volume. New rows: Interface →
  Performance stats (`exo-stats`, or `?stats`), Graphics → Terrain look (reloads; flushes the autosave first).
- **Top:** `#brand` is hidden in game; `#tele` (view, altitude, fps, draws) only with `body.stats`, and the minimap moves
  up into its place on desktop; `.r.dim` resource chips (nothing to show yet) are hidden, except the colonists chip,
  which opens the Colony panel.
- Tests: `tools/options-smoke.mjs` checks the menu (bar size, pauses, Options round trip, Esc behaviour, two-tap New
  game) on desktop and phone; `smoke.mjs`, `sound-smoke.mjs` and `music-smoke.mjs` go through the menu now.
  Headless desktop screenshots can catch the panel mid-fade (swiftshader holds the CSS animation for ~2 s).

### Skirmish phase 1: players in the sim (v0.50.1)

DESIGN §5.11. `src/sim/core.ts` runs any number of players on one map; the campaign is the one-player case and is
unchanged (`tools/balance.mjs`, all nine strategies, output byte-identical before and after).

- **Ownership:** `team` on `Building`, `Drone`, `Unit` (unset = player 0). `SimState.players` (absent in the campaign):
  name, side (same side = allies), colour, `ai`, `out`, `home`, and for players ≥ 1 an `econ` (alloys, isotopes,
  battery, research, drone fabrication, stats). Player 0 keeps its economy in the top-level fields, so the HUD,
  saves and the campaign read it as before. `SimState.skirmish`: `{ fog, packs }`.
- **`withTeam(t, fn)`:** runs `fn` as player `t` sees the world: the lists hold only `t`'s buildings, drones and
  units; its econ is swapped into the top-level fields; `power`, `vis` and `exp` are its own. On the way out the
  lists merge back (what `fn` added becomes `t`'s, what it removed is gone) and the econ swaps back. Placement sees
  other players' buildings through `PlaceWorld.others` (spacing only: they don't extend your build area).
- **Tick (skirmish):** each live player's economy in its own view (power, drones, fabrication, factories, research,
  mining, repair pads), then one shared fight (turrets, units, shields, fauna, nests, packs if on), eliminations, fog
  per player every 5 ticks. No cryo bank, people, planet, inhabitants, story, missions or encounters.
- **Combat:** shooters pick from `foes(team)`: fauna plus every unit, drone and building of a player on another side
  (the campaign's `foes(0)` is `s.hostiles` itself). Anything that moves comes before a building unless the building
  is 10 u closer (`BUILDING_LAST`). `strike` splashes and chains over the shooter's foes; `kill` dispatches by kind.
  Visibility is per shooter (`visibleTo`). Idle units also answer enemy units among their own buildings (`raiders`).
  Field Engineers mend only their own side. Turret ties still go to the later target (as before: a `<` here changed
  three balance runs).
- **Commands:** `command(c, team)` runs in that player's view, so a player can only spend its own alloys and order
  its own drones and units. Events from other players' views are dropped (`emit` passes only player 0's); enemy
  buildings destroyed are reported to player 0.
- **Defeat:** a Command Core destroyed queues its player (`falling`); at the end of the tick it's out and everything
  of theirs goes. One side left: `end('won')` if player 0 is on it, otherwise `over = 'core'` with "Defeat: … won".
- **Setup:** `newSkirmish({ seed, players, alloys, wildlife?, packs?, fog?, homes?, deposits? })`; `skirmishHomes(n,
  limit)` spreads start spots round a ring at 62% of the way out, each moved to dry flat ground. Story locks are
  cleared. Saves keep player 0's fog (`explored`); other players' fog is worked out again on load.
- **Test:** `tools/skirmish-sim.mjs` (headless, 30 checks): separate economies and stats, commands limited to their
  owner, per-player building and mining, turrets and units fighting across players, a Core falling takes its player
  out and the last one wins, save/load, a four-player free-for-all, and allies holding fire. Sim cost (sim-bench):
  3.2 → ~3.3 ms/tick, within its ±10% noise.

### Skirmish phase 2: generated maps (v0.52.0)

DESIGN §5.11. `src/skirmish/mapgen.ts` `generateSkirmishMap(options, content.bodies)` → a region record (never saved
to content), the start spots, and a report. ~90 ms median, 150 ms worst on hive1.

- **Options:** seed, players (2–4), size (small / medium / large = 240 / 320 / 400 u, +40 for 3–4 players), world
  (`SKIRMISH_WORLDS`: Home, Verdance, Dunmore, Rime, Cinder, Ash), water (none / some / lots: only Home and Verdance
  have seas; `none` lets the usual site lift raise the map onto dry land, otherwise `keepSea` and the site is picked
  from 18 random ones for a land share near 75% / 50%), relief (flat / rolling / rugged: local relief 4 / 9 / 18 u).
- **Layout:** bases evenly round a ring at 60% of the half-size, turned by a random angle. Round each base, turned to
  face the middle, the same layout (`LAYOUT`): two 3,000 deposits at 27 u, a 2,500 one at 62 u, a 600 isotope seam at
  40 u, a geothermal vent at 34 u. Between each pair of neighbours a 5,000 contested deposit, a predator spawn out by
  the edge and a herd partway; a 1,200 seam by the middle. 90-second grace for packs if they're on.
- **Sculpt** (the region's height grid, target − generated): each base flat to 34 u at its own mean height (≥ 2 u),
  easing out to 62 u; a small pad under every deposit, seam and vent outside a base (at the base's height when it's
  near one, so it doesn't pull the base's rim); land roads raised from every base to the middle. Checked after: each
  base dry (≥ 0.8 u) and flat (≤ 3 u over 28 u), every base reaching base 1 by land (`PathGrid.reaches`). Up to four
  tries, raising and widening the roads each time.
- **In the game:** `?skirmish=<seed>` plus options (`src/skirmish/setup.ts` lists them: players, size, world, water,
  relief, alloys, fog, packs, wildlife, ai, teams). The page generates the map, plays it as region `skirmish` (no
  autosave, no title or landing, the camera on your Core), and hands the record and a `SkirmishSetup` to the sim
  worker (`init.skirmish` → `newSkirmish`; a restart starts it again). Snapshots carry `players` and each unit's and
  drone's `team`. Skirmish Cores are drawn as buildings where they stand (`buildForRole('core')`); the campaign's
  stays the landed probe at the origin.
- **Test:** `tools/mapgen-check.mjs [--maps N] [--sheet file.png]`, headless (one module graph via
  `tools/sim-entry.ts`: separate `runnerImport`s each get their own region state): every world × 2–4 players × size ×
  water × relief; per map, the generator's checks, then in the sim each player can place a Solar Array by its Core, a
  depot on each of its deposits, a Deep-Core Mine on its seam and a geothermal plant on its vent, and walks by land to
  the middle and to the nearest enemy are within 25% of each other. 54 / 54 pass. `--sheet` draws them all.
- Not yet (phase 3): enemy buildings and units in team colours and hidden in fog, the HUD's campaign counters.
- Found on the way: `tools/build-smoke.mjs` fails its wall-line steps on v0.49.0 too (the opening story card sits
  over the taps); `tools/region-smoke.mjs` expected no world name between a region and HERE in Options (fixed).

### Skirmish phase 3: setup, colours, fog and the end screen (v0.53.0)

DESIGN §5.11. A skirmish is now reached from the title (SKIRMISH) and played with its own HUD. The computer players
don't play yet (phase 4): they sit at their Cores.

- **Setup** (`src/skirmish/setup-screen.ts`, title SKIRMISH or the game menu's Skirmish): players 2–4, teams (free for
  all, you vs all, 2 v 2 with four), computer difficulty, world, size, sea (only worlds with seas offer any), ground,
  map seed (🎲 rerolls), starting alloys (400 / 600 / 1,500), fog, wildlife, predator packs. A live preview generates
  the map in its own worker (`src/skirmish/map-worker.ts`: the title's planet keeps its terrain state) and draws the
  ground, sea, deposits, seams and each player's base in their colour. START builds the `?skirmish=` link
  (`skirmishLink`) and goes there. Choices are remembered (`exo-skirmish-setup`), the seed is new each time.
- **What you can know** (sim `snapshot`): other players' units and drones only while in sight; their buildings once
  seen (`Building.seen`, then shown as they are). Radar blips stay fauna only.
- **Colours:** players are `PLAYER_COLORS` (cyan you, crimson, amber, violet). Units: the army buffer has an owner
  (`F.TEAM`, `STRIDE` 8); another player's are drawn in their colour (body and glow strips), get red bars and can't be
  selected. Buildings and drones: a ring in the owner's colour under each (`RegionView.teamRing`), and other players'
  buildings glow in their colour. Minimap: everything in its owner's colour, Cores outlined white.
- **Can't command theirs:** the input only offers your own units, buildings and drones (`buildings()` / `units()` filter
  on `team`, drones carry `team` in `RegionView.drones`); placement sees theirs only as too-close (`PlaceWorld.others`).
  The sim refuses anything else anyway (`command(c, team)`).
- **HUD** (`body.rts`): no cryo, biomass, planet health, colonists or goals; the clock is game time; the map shows from
  the start (no radar needed). Game menu: Resume, Options, Rematch, New skirmish, Surrender, What's new, Title screen
  (no Save / Load: skirmishes aren't saved).
- **End:** VICTORY / DEFEAT with each player's units built, kills of other players' things, units and buildings lost
  and alloys mined (`players[].stats` in the snapshot). Rematch restarts the same map and players; New skirmish opens
  the setup. You're out when your Core falls or you surrender (`{ type: 'surrender' }`); your game ends then even if
  computer players go on fighting each other.
- `SimClient.command(cmd, team)` acts as another player (tests now, the AI later).
- **Test:** `tools/skirmish-play-smoke.mjs` (desktop and phone): title → setup (choices, preview, START) → the game
  (skirmish HUD, map, fog hiding the others' bases and out-of-sight units, theirs in sight shown, not selectable) →
  skirmish menu → victory screen → Rematch → surrender → defeat.

### Skirmish phase 4: computer players (v0.54.0)

DESIGN §5.11. `src/sim/ai.ts`, run by the sim for every player with `ai` set, in that player's own view
(`withTeam`) every `period` ticks (staggered by team). It plays only through ordinary commands, sees only through
its own fog, and knows where every player started (as most RTS computers do). Its memory (`PlayerState.brain`: waves
sent, the raid under way, its rally point) is in the save.

- **Building** (one site per drone at a time; `spot` searches rings round a centre from a preferred direction and
  keeps a 3 u lane round every building): the first Solar Array; depots on its two home deposits; solar (or the
  geothermal vent) whenever daytime generation is under the full load × 1.1 + 1; a Vehicle Bay; turrets toward the
  middle; the geothermal vent; batteries until they carry 60% of the load through half a sol on what the night
  makes; depots on any deposit it can reach; Relay Towers toward the nearest free deposit on its side of the map; a
  Tech Lab; a second bay; more guns (cannons late); a Deep-Core Mine on a seam; a Fusion Cell once it has isotopes.
  Drones topped up to its level's count; research Deep Survey → Isotope Cells → Shield Lattice.
- **Army:** factories kept busy (two queued each) while alloys stay above a reserve; early rovers and tanks, later
  tanks, lancers, rovers, artillery and arc (more arc if the enemy flies), a deterministic rotation through the mix.
  New units gather at a rally point 30 u in front of the base. Anything hostile among its buildings brings everyone
  not on a raid home (and a raid that's barely left turns back for a big attack). When the group reaches the wave
  size (bigger each wave) and the first-attack time has passed, it all leaves for the nearest enemy's Core;
  reinforcements join in fours; a wave down to a third falls back to the rally point.
- **Levels** (`LEVELS`): Easy thinks every 5 s, 2 drones, 1 turret, no tech, first wave at 9 min (6 units, +1 a wave);
  Normal every 2.5 s, 3 drones, 2 turrets, tech, 2 relays, first wave at 6.5 min (10, +2); Hard every 1.2 s,
  4 drones, 3 relays, first wave at 5.5 min (12, +3) and +0.5 alloys a second.
- **Skirmish rules changed with it:** no cryo-bank draw on power (it was taking 4 MW from every player); each player
  may have 40 combat units (`unitCap`, shown on the bay card); a computer player 0 (tests) doesn't end the game when
  it's knocked out.
- **Test:** `tools/ai-sim.mjs` plays games headless on generated maps (`--match normal,idle`, `--trace` for a
  minute-by-minute timeline per player). `--check`: each level beats a player who does nothing (Easy ~9.5 min, Normal
  ~7.5, Hard ~9: its first wave waits until it's bigger), Hard beats Easy (3 / 3, 28–32 min), and a four-way
  free-for-all of Normals ends (40 min on seed 100: the winner had 9 depots, a Deep-Core Mine and a Fusion Cell).
  In the browser a Hard computer built its base, expanded through a relay and took out an idle player's Core at 7.5 min.

### Matter Printer and alerts (v0.55.0)

- **Matter Printer** (`content/buildings/printer.json`, role `printer`, campaign and skirmish): 160 alloys + 20
  isotopes, needs Isotope Cells, draws 8 MW and makes `mineRate` 0.4 alloys/s while powered (staff multiply it as for
  depots; `stats.printed`). It's last in line for power (rank 4, after depots) and live power only, never the
  battery, so it runs on surplus: geothermal, fusion, or solar on a good afternoon. A depot makes 1.2/s for 2 MW, so
  deposits stay ten times better per MW; the printer is the late-game floor when they run dry, and makes no scars
  (planet health). Card: "Printing · +0.4 alloys/s" or "Waiting for spare power". Model `buildPrinter()` (in the
  asset library as built-in `printer`). Computer players build one after 15 min, two once the deposits their depots
  reach hold under 2,500; their power planning counts its draw. With printers the four-way Normal free-for-all
  ended at 45 min (57 before); campaign balance outcomes unchanged.
- **Alerts** (`Sim.underAttack`): when an enemy player's shot or a predator's bite hits one of your buildings, units
  or drones: "Under attack: <what>, <compass> of the Core" (or "at the Core"), at most every 20 s for the same place
  (6 s for a place 60 u away). Events can carry a place now (`EventSink(text, level, cue, at)`, the worker's `event`
  message has `at`): alerts, your buildings destroyed, other players' buildings destroyed, predator contact. Such a
  log line is tappable (◎) and takes the camera there; the minimap pings it (a ring that grows and fades over 4 s,
  red for trouble, cyan for news); **H** goes to the latest alert.
- Tests: `tools/skirmish-sim.mjs` checks the printer (waits with no spare power, never touches the battery, 0.4/s on
  spare power); `tools/skirmish-play-smoke.mjs` checks a tappable alert and H. `tools/balance.mjs` shows at most 60
  events per run, so the new alerts push some old lines out of its listing; compare outcomes (`===`, `end:`, tables).

### Smarter computer players (v0.56.0)

AI only (`src/sim/ai.ts`): no unit or building numbers changed.

- **Memory** (`AiBrain.known`, `armies`): enemy buildings it has seen (forgotten once it sees the spot empty) and the
  strongest army it has seen of each player lately. It scouts with its fastest unit at the start, and again whenever
  what it knows is over 2.5 min old; a scout that finds no army at the base records that too.
- **Strength:** a force is √(total dps × total hp) (Lanchester-style). The defence of a target is the guns it knows
  within 70 u plus that player's army: as seen, grown a third every 100 s since; never seen, assumed as strong as its
  own. It sets off when its army is at least ¾ of the wave size and ours ≥ theirs × nerve (Easy 1.6, Normal 1.3, Hard
  1.15), or when it's 1.6× the wave size or at the unit cap.
- **Gather, then push:** the wave forms up at a staging point short of the target, beyond its known guns' reach, and
  goes in when 80% are there (or after 75 s). Artillery takes a siege line just inside its own range of the nearest
  known gun (artillery 46 u outranges turrets 28 u and cannons 44 u); the rest push on to the Core; reinforcements
  join in fours. A wave down to a third falls back.
- **Raids** (Normal, Hard, after 4 min): three or four of its fastest units after the nearest known enemy depot,
  deep-core mine or printer that no known gun covers, only while at least six others stay home.
- **Defence:** answers a raid with about 1.5× its strength from the nearest free units; a bigger attack also recalls
  a wave that's still forming up or only just left.
- **Production** answers what it has seen: more artillery the more guns it knows, more lancers against heavy units
  (400+ hp), arcs against flyers, rovers while it has few fast units.
- Hard's first wave is 10 (was 12).
- **Measured** (`tools/ai-sim.mjs --match new,old:<level>` plays the last release's AI, from git, against the new one;
  `Sim.thinkers` is the test hook): new vs old, three seeds each way: Easy 6–0, Normal 6–0, Hard 3–2 with a draw (4–2
  with a first wave of 12). `--check` passes: each level beats a player who does nothing (~10 min: it scouts and
  forms up first), Hard beats Easy 3 / 3 (23–34 min), and the four-way Normal free-for-all ends at 34 min (45 before).

### Smoother controls (v0.57.0)

Quality of life in the colony (and the skirmish built on it; the old `?mode=skirmish` battlefield keeps its own input).

- **Keys** (`src/input.ts` `key`): camera keys go by `e.code` (layout-proof) into a held set; `Input.update(dt, active)`
  runs each frame from `main.ts` and pans 700 px/s (1,500 with Shift) and turns 1.8 rad/s, so a held key is smooth
  instead of riding the OS key repeat. `active` is false under the title, cinematics, the menu and panels (the set
  clears; window blur clears it too). `F`/`Home` centre, `.` next idle drone, `[` `]` speed (0 / 1 / 3), `?`
  Controls (`H` stays the latest alert), `Ctrl+S` save (`Ctrl+A` all combat units). Digits 4–9 are control groups (1–3 stay the views): Ctrl or
  Shift + digit saves the selected units, the digit recalls (dead ones dropped), twice within 400 ms glides there.
  Typing in an input, textarea, select or contenteditable is never a shortcut.
- **Camera** (`src/camera.ts`): `glideTo(x, z)` eases the focus there (a pan cancels it); `lookAtGround` jumps.
  Wheel zoom toward the cursor (option, desktop): the ground point under the pointer stays put
  (focus = g + (focus − g) · k for the zoom factor k), only near the ground (`cam.a < 0.15`). Edge scrolling (option,
  off): the mouse within 10 px of the canvas edge pans.
- **Mouse:** a right-click without a drag stops placing, or sends the selected drone or units (`rightTap`); a right-drag
  still turns the camera.
- **HUD:** `#r-drones` (desktop) counts your worker drones and the idle ones; a click (or `.`) cycles idle drones, all
  of them when none are idle. `#paused` shows only when the player paused (`userPaused`: button, Space, `[`, or the
  background pause), not for story cards or the menu; tapping it resumes. `#place-hint` follows the mouse while placing
  with `placeProblem`'s reason. The radar map takes a drag (pointer capture). Recycle arms on the first tap
  (`recycleArmed`, 4 s, the button shows the refund) instead of `confirm()`. Esc closes the build menu first.
- **Options → Interface:** Pause in the background (`exo.bgpause`, on: `visibilitychange` hidden pauses a deployed,
  running game; coming back logs it; never under webdriver), Zoom to the cursor (`exo.zoomcursor`, on), Edge scrolling
  (`exo.edgescroll`, off). The last two are desktop only. `?bgpause=`, `?zoomcursor=`, `?edgescroll=` override.
- **Controls panel** (`openInfo` in `src/options.ts`): every key and gesture; touch devices list touch first. From
  `?` or the menu's Controls (closing it goes back to the menu).
- **Fix:** the selection card read the HUD's snapshot, which is refreshed by the frame loop and can be a frame behind
  the sim; selecting units made that very frame dropped the selection. `select` now hands the HUD `sim.cur` first.
- **Test:** `tools/qol-smoke.mjs` (desktop): each of the above end to end.

### Research tree (v0.58.0)

DESIGN §5.9's compact Act 1 tree: 4 projects became 32, in four branches, gated C&C-style and by the colony's people and
finds. Code: `src/sim/mods.ts` (pure, shared by sim and HUD), `Sim.mod` in `src/sim/core.ts`, `src/research-hud.ts`.
Test: `tools/tree-smoke.mjs` (`--headless-only`; the browser half wants a dev server, default `:5176`).

- **Content** (`researchShape`): `branch` (economy, defence, people, relic = the tree's tabs), `requires` and a second
  prerequisite `also`, `building` (a finished one must stand), `specialist` (an adult colonist with that specialty),
  `flag` + `flagText` (a discovery: `wreck-found`, `stone-found`, `relic-woke`, `relic-opened`, `nest-destroyed`,
  `inhabitants-met`, or any story flag) and `effects`, a list of **modifiers** (`modShape`: `stat` from `MOD_STATS`,
  `amount`). Content checks: prerequisites can't loop, a flag gate needs its words. Inhabitants now set `contact-<group>`,
  `trust-<group>` and `inhabitants-met`; the editor's Story flow knows those (and `relic-*`) as the game's own flags.
- **Modifiers** (`MOD_STATS`, words in `modText`): a sum over finished research plus running story boosts
  (`StoryState.mods`, used by later features). `Sim.mod(stat)` memoises the sum once per tick (or when research or the
  boosts change). Read where each stat is used: depot / deep mine / printer output, solar, battery capacity, power draw,
  drone work (`Sim.droneWork`), drone and unit caps (`maxDrones`, `unitCap`; snapshot `droneCap`, `unitCap`), turret
  damage, damage buildings take (`buildingHarm`), repair pads, shield recharge, damage to relics (`strike`), research
  speed, cache payouts, salvage, nest regrowth (`nestRegrowSecs`); in `people.ts` biomass grown, food eaten, pod speed,
  how long the injured last, wellbeing (reason "Colony projects"), stance drift, sabotage, grief fading, staff bonus; in
  `planet.ts` mining scars and Seed Bank healing; in `inhabitants.ts` regard recovery and encroachment. `warning`:
  a powered radar with Seismic Listening announces the next pack that many seconds before it sets out (`waves.warned`).
  `trade` and `fortify` are abilities for the later features. The snapshot carries the totals (`mods`).
- **Gates** (`researchNeeds` / `researchBlocked`): the sim refuses a project with its first unmet need ("Fire Control
  needs a Security officer in the colony"); the tree shows every need ticked or not, from the same function.
- **The tree:** 10 economy (Refined Drills, Tracking Arrays, Swarm Logic, Vertical Farms, Low-Scar Extraction, Seam
  Harmonics, Deep-Cycle Cells, Matter Compiler + Deep Survey, Isotope Cells), 7 defence (Hardened Plating, Fire Control,
  Field Repair, Seismic Listening, Lattice Tuning, Logistics Grid + Shield Lattice), 7 people (Colony Medicine,
  Accelerated Pods, Nutrition Science, Open Ledger, Rites of Remembrance, Commons Design, Translation Matrix), 8
  precursor (Hull Forensics, Ruin Stratigraphy, Fauna Genomics, Handshake Codes, Cache Keys, Precursor Alloys, Firmware
  Archaeology + Relic Studies). Three finish with a story card: Layers (Stratigraphy), Designer Marks (Fauna Genomics,
  STORY.md E9), Lineage Report (Firmware Archaeology). The four old projects keep their numbers. Skirmish computer
  players still research only their three; nothing they use has a new gate.
- **HUD** (`ResearchHud`): the Tech Lab card shows the project under way and "N of 32 done · M ready", plus **Research
  tree**. The tree is one scrolling column (`#research`, full width under 640 px): branch tabs with done counts (● on the
  one under way), then each project indented under the one it follows, with its effects in green, its needs (✓ / ✗),
  cost and time, description, and Research (or Cancel) when it can start. It opens on the branch with something to do.
- **Measured** (headless, `tools/tree-smoke.mjs`): Refined Drills mines ×1.200; Deep-Cycle Cells 600 → 900 MJ; a
  Brute's blow on a Solar Array 24 → 20.4 (Hardened Plating) → 18.0 (+ Precursor Alloys); Nutrition Science food ×0.85;
  Low-Scar scars ×0.60; Tracking Arrays takes 35 s at an unstaffed lab. Also: each gate refuses then allows, modifiers
  survive a save, and at 390 × 780 the tree fills the width with no sideways scroll and starts a project from a node.

### Colony dilemmas (v0.58.0)

Small choices that come out of what the colony is going through, each leaving something behind. They are ordinary
story events (`content/story/`, the story HUD) with a few additions. Code: `src/sim/story.ts`, `src/sim/conditions.ts`,
`People.castFor` / `carryIn` in `src/sim/people.ts`. Test: `tools/dilemma-smoke.mjs` (`--headless-only`; the browser
half wants a dev server, default `:5176`).

- **Story fields:** `dilemma` (waits its turn), `again` (seconds after its answer that a dilemma can fire again, its
  trigger met again; `StoryState.again` re-arms it by taking it off `fired`), and `cast` (`CASTS`: adult, a bloc, the
  unhappiest, someone injured, a parent, a specialty): who the card is about, picked when it fires
  (`StoryState.cast`); `{who}` and `{whoLine}` in its title, text, choices and replies are their name and family line
  (the sim fills log lines, the card fills from `StorySnap.who`). With no one to fit, the event waits.
- **Throttle** (`Story.dilemmaOk`): none before the colony rules' `dilemmaFrom` (900 s after landing), none within
  `dilemmaGap` (200 s) of the last one being answered, none while another card waits (radio aside) or a dilemma waits out
  a delay, and at most one per check. The card carries a small "Colony dilemma" tag.
- **New conditions:** `cryoBelow` (a brownout draws the bank's buffer down), `biomassBelow`, `embryosBelow`, `injured`,
  `children`, `autonomists`, `devoted`, `striking`, `linesGone`, `regard` / `regardBelow` (a group's camp).
- **New effects:** `boost` (a colony modifier from the research system, `stat` × `amount`, for `seconds` or for good,
  named by its text; `StoryState.mods`, shown in the Colony panel under **In force** with its time left, logged
  "…: over" when it ends), `policy` (`hours:short`…), `favourLine` (the next growth pod takes the cast's line, once:
  `PeopleState.favour`), `rescue` (the cast, lying injured, is carried in to the nearest home). `stance` and
  `wellbeing` gain `one` (just the cast) and `bloc` (just that bloc's adults). Content checks: `one`, `favourLine`,
  `rescue` and `{who}` need a cast; a boost needs its stat; a policy is `key:value`; only dilemmas come again.
- **The dilemmas** (13, chapter Firstborn, tag "dilemma"): Brownout (dim the homes / slow the mines / put it to the
  colony → The Vote), Lean Months (rations), Who Wakes Next (a promised family line → Kin), The Watchers (surveillance
  logs), What the Children Learn (education → The Children's Question), A Quarrel (a dispute), Hurt (someone injured:
  stay in / carry them / talk them through), The Vell Ask (food → A Debt Repaid: a guide's find), The Cantor's Request
  (power for the Choir's tower → The Tower Speaks: earlier warnings for good), Down Tools (strikers), The Last Name (a
  line gone), The Petition (Devoted on the sensor net → Two Voices), Night Shift (an armed watch). Six follow-ups.
- **Measured:** a 60-minute headless playthrough (people bot, no predators, random answers) met Who Wakes Next at
  21:55, A Quarrel 27:55, Brownout 35:39 (The Vote a minute later), What the Children Learn 44:08 and its follow-up
  50:09: one every 6–8 minutes once the colony has people. The test also checks the gap, one card at a time, boosts
  running out, a promised line reaching the next pod, a rescue, a policy change, coming again, saves, and (browser) the
  card naming its colonist and the Colony panel listing the boost.

### Inhabitant relations (v0.58.0)

Past first contact, the Vell and the Choir are neighbours to deal with: trade, favours, fighting beside us, and
grudges. Data-driven in `content/inhabitants/` (`inhabitantShape`); code in `src/sim/inhabitants.ts`
(`tradeProblem`, `ask`, `hunt`, `fight`, `mined`, `nestCleared`), `Sim.nativeStrike` in `src/sim/core.ts`, the
Neighbours tab in `src/people-hud.ts`. Test: `tools/relations-smoke.mjs` (`--headless-only`; browser half on `:5176`).

- **Trade** (`trades`: label, give / giveAmount, get / getAmount, minimum regard; `tradeEvery`): once they trust us,
  or once we can speak their language (the `trade` ability: Translation Matrix). Each trade adds 1 regard; the camp
  then needs `tradeEvery` before the next (`Camp.tradeAt`). The Vell: alloy tools for dried stores (40), food for
  scavenged hull plate (50), medicine for glow-stone isotopes (65). The Choir: power cells for isotope dust,
  isotopes for circuitry.
- **Favours** (a trusted camp; each costs regard; `helpEvery` between asks, `Camp.helpAt`): **guides** reveal their
  land (`guideReveal`); **lookouts** (`Camp.watchUntil`, a sol) warn of every pack like a trusted camp and add a story
  boost `warning` +30 s (so frontier threats come sooner too); **hunters** (`hunters`, `hunterSeconds`,
  `hunterDamage`, `hunterRange`, `hunterCooldown`, `hunterWeapon`): that many of the camp's walkers set out
  (`Native.hunt` = until), go to the predator nearest our buildings (or stand by the Core) and strike it
  (`Sim.nativeStrike`: never relics, nests, burrowers underground or flyers), then walk home. Predators still ignore
  them, so they can't be lost.
- **Joint defence** (`defends`): a trusted camp strikes predators on its land (double hunter damage, its cooldown,
  `Camp.dcd`), our buildings there included.
- **Consequences:** depots mining a deposit on their land cost `mineHarm` regard per 100 alloys on top of encroaching;
  a loud building (one with `lure`, the Deep-Core Mine) counts three times; destroying a nest within their land + 20 u
  earns `nestHelp`. At regard 22 or less a dilemma comes, Grievance (the Vell) or Broken Loop (the Choir): pay for the
  land (−100 alloys, −40 biomass, +18 regard) or not (−6, flag `<group>-grievance`, which later threats read).
  Earlier dilemmas (The Vell Ask, The Cantor's Request, What the Children Learn) move regard too.
- **Neighbours tab:** regard, what wears it down, who is with us now (lookouts, hunters), each trade as a button
  (give → get, why not yet), and the favours with their regard cost once they trust us (before that, what trust brings).
  Snapshot `CampSnap`: `tradeIn`, `helpIn`, `watch`, `hunting`, `canTrade`.
- **Measured** (headless): two Brutes at a lone Solar Array far from the Core lost 600 hp to four Vell hunters inside
  a minute (both killed); a trusted Vell camp killed the swarmers that came onto its land; a depot on the Vell's deposit
  cost 3.1 regard a quarter sol (108 alloys) against 1.5 for encroaching alone.

### The frontier: threats to held territory (v0.58.0)

DESIGN §4 "Persistent territory" within the region being played (the campaign plays one region at a time; there is no
second held region to go back to yet): the colony's outlying **holdings** come under escalating, telegraphed threats,
so the player has to go back out to them, and **standing orders** let a holding partly look after itself. Code:
`src/sim/frontier.ts` (`Frontier`, owned by the Sim, checked once a second, campaign only), `Sim.surge`,
`buildingHarm` and turret damage in `src/sim/core.ts`, Evacuate in `People.decide`, the building card in
`src/colony-hud.ts`. Numbers: threat rules `frontierFrom` (1,500 s), `frontierEvery` (420 s) ± `frontierJitter` (90),
`frontierWarn` (90 s), `frontierSize` (6), `frontierGrowth` (3), `holdFrom` (55 u). Test: `tools/frontier-smoke.mjs`
(`--headless-only`; browser half on `:5176`).

- **Holdings:** every finished building (walls, gates and the Core aside) at least `holdFrom` from the Core, grouped by
  compass sector ("the east holding"). Snapshot `frontier.holdings` (sector, centre, building ids, standing order).
- **The director** (`SimState.frontier`: `n`, `next`, `threat`, `orders`): once `next` comes and a holding exists, it
  picks the holding furthest from our combat units (a little at random) and a threat:
  - **migration**: `frontierSize + frontierGrowth × n` predators (× the region's pack scale; a Brute in five, a Spitter
    in six) from the region's edge beyond the holding;
  - **relic surge** (regions with relic grids, from the second threat): 1–4 awake sentinels (`relic: 'surge'`, no grid)
    break the surface 16 u or more from the holding, on free ground;
  - **raid** (a camp we've met with regard under 30 or a grievance flag): not a fight. If combat units are within 35 u or
    a powered turret within 40 u they turn back (−3 regard); if not they take 60 + 20n alloys and 40 biomass and
    wreck 35% of a building there (+4 regard: the grudge partly settled).
  Each is **telegraphed**: a log line with where (it jumps the camera), a countdown under GOALS (story countdown
  `frontier`) and a marker on the holding (story mark `frontier`, ground and minimap), `frontierWarn` + the `warning`
  modifier ahead (Seismic Listening +45, Firmware Archaeology +30, the Vell's lookouts +30 for a sol, the Choir's sweeps
  +30). Over when the migration's pack or the surge's sentinels are gone ("the east holding held", +1 stance, or "is
  lost"); the next comes `frontierEvery` ± jitter later, bigger. Peaceful play tests hold the frontier off.
- **Standing orders** (`{ type: 'standing', sector, order }`, on the card of any building in a holding, with the threat
  on it if there is one): **Hold** (nothing extra), **Muster** (idle combat units are ordered out to it when the warning
  comes), **Fortify** (needs the `fortify` ability, research **Garrison Doctrine**: while a threat is on it, its
  buildings take 60% damage and its turrets do 125%), **Evacuate** (while a threat is on it, nobody goes to work there
  and the people who live there go to the Core).
- **Measured** (headless): the first migration (6) arrives 90 s after its warning from the east edge; with Seismic
  Listening the warning is 135 s; Fortify takes a holding's damage to 60%; Muster sends 3 idle rovers out; an
  unguarded holding loses 80 alloys to a Vell raid, a powered turret turns the raid back; a surge's sentinels open fire
  on the holding. The balance bots still lose Touchdown before 25 min with predators on, so the frontier (from 25 min)
  doesn't change those runs.

### Colonists as people (v0.58.0)

Named colonists get a backstory, a voice, their own grief, and moments where one of them matters. Content:
`content/voices/<id>.json` (new collection, editor: Story → Colonist voices; `voiceShape`): `on` (a moment from
`VOICE_EVENTS`), optional filters (`bloc`, `trait`, `specialty`, `origin`) and `lines` (`{name}`, `{other}`,
`{building}`). Code: the voices section of `src/sim/people.ts` (`say`, `bio`, `struck`, `heroGuard`, `moments`),
hooks in `core.ts`, `inhabitants.ts`, `frontier.ts`; the colonist card and Colony panel in `src/people-hud.ts`.
Test: `tools/voices-smoke.mjs` (`--headless-only`; browser half on `:5176`).

- **Backstory** (`Colonist.bio`): "Okafor line, donor stock from the Niger delta." (`LINEAGE_FROM` in `names.ts`) or
  "Born in the colony to Ada and Kofi.", then a line from the `bio` voices that fit their trait or origin, picked by
  their id (no random draw, so an older save loading gets the same story). On the colonist card under the name.
- **Remarks** (`People.say(on, who?, vars, force)`): an adult (the one it concerns, or anyone) says a line that fits
  them (the most specific matching records 60% of the time, else any that match). Logged as `Name: “…”`, kept in
  `PeopleState.voices` (last 30), on the speaker's card for a sol, and the last five in the Colony panel under
  **Voices** (tap to find them). Throttled: one every 45 s and each kind every 150 s (`VOICE_GAP`,
  `VOICE_KIND_GAP`), except a death, a birth and a hero. Moments: first words out of the pod, a birth (a parent), a
  death (who loved them), a pack beaten, a building lost, a brownout, hunger, a strike starting, research done (a
  Technician first), first contact, trust, a frontier threat and a holding held, a hero, someone rescued, and on a
  quiet day (after 5 quiet minutes, about one in 150 s). 35 records, 93 lines.
- **Mourning:** when someone dies, the people who loved them grieve on their own (`Colonist.sorrow`: a partner 30, a
  parent or child 20, a housemate 12; reason "Mourning", fading over a couple of sols); the closest says something, and
  the memorial records who mourned them (`Memorial.by`, "Mourned by …" in the Memorial tab).
- **A hero** (`People.struck`, called when a predator's blow lands on a building): a building torn below half with
  adults inside gets one of them to hold it (a Security officer first, then Autonomists, the stoic, the happiest):
  logged, a line of their own, the building takes half damage for 25 s (`heroGuard`, in `buildingHarm`), their card
  says "Holding the …". If it stands, the deed is theirs ("Held the Civilian Center when it was under attack, Sol 6",
  shown with ★ on their card), +10 wellbeing for them and +3 for everyone; if it falls, "Stayed in the … until it
  fell". One hero per building per fight (180 s).
- **Measured** (headless): every colonist has a different backstory; one remark, then nothing within the gap; a quiet
  sol gives 0–2 remarks; a partner's death: sorrow 30, a line, "mourned by" three names; a Brute's blow on a held
  Civilian Center 48 → 24.
### Opening pace: the first 20 minutes (v0.59.0)

DESIGN §7's M1 exit test. Measured headless with `tools/opening.mjs`: the story playthrough bot (strategy `opening`, a
first-timer's build with a turret by each depot) plays Touchdown at a human pace (`pace`: one build step every 8 s,
`BalanceOptions.pace`), chasing each mission's objectives, and records when things first happen. A second is **dead
waiting** when nothing is being built, no fight is on, no card or objective landed in the last 15 s and the bot can't
afford its next step.

- **What was wrong:** 200 starting alloys went on a solar, a battery and the second drone, and the depot came at ~2:45,
  just as the first night stopped it (depots run on live power only), so alloys crawled in at the Core's 0.4/s until
  ~5:30. Two waits of 91 s and 104 s before the first pack at 5:10. The tutorial colony never got its first colonist:
  the pod takes a sol (6 min) and most runs fell to the third or fourth pack at 10–17 min.
- **Changes** (content only, plus one rule):
  - Touchdown region: `startAlloys` 360 (was 200 from the colony rules), `graceSeconds` 240 (300), `packScale` 0.8,
    `waveInterval` 130 (110). Other regions and the skirmish keep the global numbers.
  - Missions: Touchdown pays 50 alloys; Groundwork asks for **two** depots and pays 120 (60); First Night pays 150 (80).
    Each finished tutorial mission puts up a hint (a `hint` reward) saying what comes next: depots on the deposits,
    a turret by each depot, then Hydroponics and a Civilian Center.
  - People rules `firstPodSols` 0.5: the colony's first pod (`Pod.first`, only while no one has been grown, born or
    lost) matures in half a sol. Later pods take the full sol.
- **Before → after** (5 seeds, pace 8 s):

  | | before | after |
  |---|---|---|
  | first building up | 0:09 | 0:09 |
  | Groundwork done | 2:43 | 0:57 |
  | first fight / first kill | 5:10 / 5:25 | 4:05 / 4:08 |
  | First Night done | 7:36 (3 of 5) | 4:10 |
  | first pod (imprint choice) | 9:35–10:05 (2 of 5) | 4:35 |
  | first colonist (Firstborn done) | never | 7:47 |
  | first story choice | 5:23–9:07 (2 of 5) | 8:05 |
  | longest wait | 1:44–1:50 | 1:06–1:46 |
  | waiting in the first 10 min | 3:16–5:21 (most runs dead by 10–11 min) | ~4:05 (all alive) |
  | standing at 20 min | 0 of 5 (fell at 10–17 min) | 5 of 5 |

  The waits left are the first night (~3:15–5:45, when depots stop) and, after the tutorial, alloys for the bot's
  next step while a human would be exploring for Beyond the Ridge.
- **Balance harness** (`tools/balance.mjs`, Touchdown, 20 min): with seeds 1337 / 7 / 42, `balanced` and `mixed`
  survive 3 / 3, `opening` 2 / 3, `people` falls at 17–20 min (was 16).
- **Test:** `tools/opening-smoke.mjs` (headless: the tutorial beats in time, only the first pod primed; browser,
  desktop and phone: the opening alloys, Touchdown's payout and hint, Groundwork's goals). `mission-smoke` follows the
  new Groundwork. Smoke tools touched here take `PORT` (or `--url`).

### Units that feel different: abilities and counters (v0.59.0)

Every armed Accord unit has one ability the player triggers, on a cooldown; computer players use theirs too.

- **Data** (`content/units/*.json`, schema `unitShape`): `ability` (a kind), `abilityName`, `abilityPower`,
  `abilitySeconds`, `abilityRadius`, `abilityCooldown` (empty = 30 s), plus `vsBuildings` (damage to buildings ×).
  Kinds (`ABILITIES` in `src/content/defs.ts`): **overdrive** (fire rate × power), **boost** (speed × power), **siege**
  (dug in: can't move, range and damage × power, takes 70% damage; a move order ends it), **charge** (the next shot ×
  power), **pulse** (power damage to every enemy within the radius, flyers too), **mend** (power hp to everything of
  ours within the radius), **shield** (our units within the radius take power less damage).

  | Unit | Ability | Numbers |
  |---|---|---|
  | Rover | Overdrive | 2× fire rate, 4 s, every 20 s |
  | Scout Skimmer | Afterburner | 1.8× speed, 6 s, every 25 s |
  | Tank | Dig in | siege 1.35× (range 22 → 29.7, past a turret's 28), 12 s, every 30 s |
  | Arc Caster | Discharge | 60 damage within 9 u, every 20 s |
  | Artillery | Barrage | 3× fire rate, 6 s, every 40 s; 2× damage to buildings |
  | Lancer | Overcharge | next slug 3× (330), within 10 s, every 20 s |
  | Field Engineer | Patch up | +120 hp within 10 u, every 30 s |
  | Aegis Crawler | Hardlight | half damage within 10 u, 6 s, every 35 s |
  | Hover Skiff / Medevac | Skim / Sirens | 1.6× speed, 5–6 s |
  | Gunship | Strafe | 2× fire rate, 5 s |
  | Gunboat | Anchor | siege 1.3×, 10 s |

- **Sim** (`src/sim/core.ts`): `Unit.ab` (cooldown left), `abT` (effect left), `abFire` (an instant kind armed).
  Command `{ type: 'ability', ids }` uses each listed unit's ability if ready ("Not ready yet" if none was).
  `armour()` scales every hit on a unit (`strike`, splash, chains and predator bites): siege and shield auras
  (`auras`, rebuilt each tick). Commands run inside the player's own view (`withTeam`), so **pulse and mend only arm
  there and go off in the shared fight** (`fireAbility` at the top of `stepUnits`): first written to strike directly,
  a Discharge killed other players' units from inside one player's view and left the lists wrong (it was why Hard
  started losing to Easy, 0 / 3). The snapshot carries `abCd` and `abOn` per unit.
- **Computer players** (`abilities()` in `src/sim/ai.ts`, Normal and Hard): guns in a fight use overdrive and charge;
  tanks dig in out on the attack, against a building; a discharge with three or more in reach or a flyer; a shield
  in a fight or with hurt friends near; repairs when a friend is under 60%; a speed boost on a drive over 50 u.
- **Controls:** the unit card has a wide ⚡ button per kind of selected unit (ready, "· 4 s" while on, "· 12 s" while
  cooling down) and an Ability row; **G** uses the ability of everything selected; the Controls panel lists it.
- **Counters** (`tools/unit-duel.mjs`: each ground combat unit against each other at 700 alloys a side on a
  skirmish map, no fog, abilities used as the computer players use them, units holding to shoot once in range; then
  each against three Defense Turrets and a Siege Cannon). Before, with or without abilities, the **Tank beat every
  other unit** (6–0). Changes: Tank 110 → 120 alloys; Lancer 220 → 250 hp, 100 → 110 damage. After (W–L): Tank 5–1
  and Lancer 5–1 (Lancer beats Tank, Rover beats Lancer, Tank beats Rover), Rover 4–2, Arc 4–2, Artillery 2–4 (but
  takes the gun line with 84% left, the best of any), Skiff 1–5, Scout 0–6 (it scouts). The gun line holds against
  Scouts, Skiffs and Arc Casters; Rovers (with Overdrive), Tanks, Lancers and Artillery break it.
- **AI vs AI** (`tools/ai-sim.mjs`): `--check` passes (each level beats an idle player; Hard beats Easy 3 / 3 at
  22–32 min; the four-way Normal free-for-all ends at 38.7 min; its limit is now 80 min, as one ordering ran 69).
  New AI against the last release's (`--match old:normal,normal` and swapped, 3 seeds each): 4–1 with a draw. New
  options: `--no-abilities`, `--seed`, `--size`.
- **Test:** `tools/ability-smoke.mjs` (headless: each kind measured on the real sim, the cooldown, a Discharge killing
  another player's Scouts cleanly, a computer player using Overdrive; browser, desktop and phone: a button per kind,
  touch-sized, it fires only that kind, counts down, and G). `tools/unit-duel.mjs --check`.
- Known: `tools/roster-smoke.mjs` "packs bring spitters and burrowers" fails before this change too (the test clears
  every hostile, nests included, so later packs have no open spawn).

### Daily Planet (v0.59.0)

DESIGN §5.10 A. `src/daily.ts`, wired in `main.ts` (`daily`, `finishDaily`, `dailyChoice`). No server.

- **Today's planet** (`dailyRules(date)`): everything follows from the UTC date (FNV hash of `exo-daily:<date>`): the
  skirmish seed, the world (one of `SKIRMISH_WORLDS`), one or two computer rivals, map size, sea (only worlds with
  one), ground, starting alloys (400 / 600 / 800); predator packs on; rivals Normal on weekdays and Hard at weekends.
  Numbered from #1 on 2026-11-20; a new one at midnight UTC. It plays as an ordinary skirmish link with
  `daily=<date>` (`dailyLink`), so the generator, the computer players and the end screen are the skirmish's own;
  the seeded sim makes it the same planet for everyone (14 days checked: each map generates, twice over the same).
- **One scored try:** opening today's link claims the day in `localStorage` (`exo-daily`: date → `{ started,
  result }`, last 60 days). A reload, a Rematch, an old date or `practice=1` is practice (the log says which). A try
  left unfinished stays unscored.
- **Score** (`dailyScore`): a win 1,000 plus speed (2,400 s − time) / 4; a loss the time held / 3 (to 40 min); +5 a kill
  of a rival's unit, drone or building; + alloys mined / 20; −8 a unit lost, −20 a building lost; never below 0.
- **The shared line** (`DailyTracker`, fed every frame): one square per 2 minutes of play, 🟩 quiet, 🟨 a fight (any
  loss or kill), 🟥 heavy (two buildings or six units lost), folded to at most 15 squares, then 🏆 or 💀. Share text:
  `Exo Genesis · Daily Planet #N`, the world, rivals and level, the line, "Victory at mm:ss · N pts", the game's link:
  nothing about the map. Share uses the Web Share sheet on touch devices and the clipboard elsewhere (a hidden
  textarea copy as the last resort).
- **Where:** title → **DAILY PLANET** ("#N · world · rivals · one scored try a day"; once played "Today: victory /
  fell · N pts · tap to share", which opens the card with Share, the streak and a practice button). The end screen
  adds the score card (score, line, how it was made, Share, days in a row) under the skirmish table.
- **Test:** `tools/daily-smoke.mjs` (headless: same date same planet, next day another, numbering, weekends, the UTC
  day boundary, links, a fortnight of maps, score order, the timeline and folding, the share text; browser, desktop
  and phone: the title entry, claiming the try, surrender → the card and Share copying the text, the result kept, a
  reload is practice, the title's look back).

### The Chronicle (v0.59.0)

DESIGN §5.10 C. A colony history from what the campaign already tracks. The skirmish end screen already has its
battle summary (each player's units built, kills, losses, buildings lost and alloys mined), so the Chronicle is
campaign only.

- **Record** (`src/sim/chronicle.ts`, `SimState.chronicle`, saved with the game): once a second (`recordChronicle`,
  from `Sim.step` while deployed) it diffs the colonists: anyone new is added (name, lineage, pod or born, imprint,
  parents, when they appeared, partner); anyone gone gets an end, *died* with the memorial's cause and age, or *walked
  out* (a walkout's memorial line, or no line at all). Every 30 s a sample of Partners / Autonomists / Devoted
  (adults, by stance), children and embryos (480 kept; a long game keeps every other). Key moments: player 0's log
  lines by cue (`chronicleEvent` in `Sim.emit`: births and pods, deaths and lines gone, partners and comings of age,
  contact and discoveries, research done, the first pack beaten, nests, relic grids, Breakthroughs, the end), plus
  missions done, story events fired, a change of leading bloc and walkouts, found by diffing. 600 moments kept
  (everyday ones dropped first). No hooks in the people system, and no random numbers: balance runs are unchanged.
  A save from before this starts its record when loaded (everyone living then counts from that moment).
- **Page** (`src/chronicle.ts`: `chronicleModel` from a `sim.save()` copy, `openChronicle`): title and outcome; the
  numbers (lived, grown, born, living, died, walked out, lines left of 24, generations, embryos); **how the blocs
  shifted** (stacked areas on a canvas, sol ticks); the **family tree** (`treeLayout`: a row per generation, pod-grown
  first in the order they came out with partners side by side, children under their parents, a curve to each parent;
  borders cyan living, red died, amber walked out; an SVG that scrolls sideways on its own); **key moments** grouped by
  sol with the time of day; the **memorial** (named dead, with cause and when; unnamed pod losses as one line), lines
  that ended and walkouts. Game menu → **Chronicle** at any time (the game stays paused), and **Read the Chronicle**,
  the first button on a campaign's end screen. Esc or × closes it (back to the end screen). It doesn't open by itself:
  over the end screen it hid New game and Load (`smoke.mjs` caught it).
- **Save image** (`chronicleCanvas`, `saveChronicleImage`): the same on one 1200 px wide canvas (the tree scaled to
  fit, the last 18 key moments, 14 names) as `exo-chronicle-sol-N.png`; on a touch device that can share files, the
  share sheet, otherwise a download.
- **Test:** `tools/chronicle-smoke.mjs` (headless: a 55-minute peaceful colony recorded, children with both parents,
  samples, moments, a death with its cause, a walkout, a save, the model's totals, the tree's rows and links, the
  memorial; browser, desktop and phone: that colony loaded, the menu's page with tree, chart, moments and memorial,
  fitting the screen, Save image as a 1200 px PNG, ×, and after a fallen Core the end screen's button).

### Battle effects and combat sound (v0.60.0)

**Visuals** (`src/skirmish/fx.ts`, `BattleFx`, owned by `ArmyView` in `src/skirmish/view.ts`, so it serves
the campaign and skirmish alike). The sim's FX events (`skirmish/types` `FX`) used to draw a full-length
box tracer and a solid additive sphere. Now each event spawns layered effects from pooled, instanced
ring buffers (the oldest effect is overwritten when a pool fills; nothing is allocated per frame):

- **Projectiles** (500): bolt, cannon, PD (a 3-round burst), spit (a lob) and shell (a high arc that
  takes exactly `SHELL_FLIGHT` = 0.5 s, so the synthesised boom lands with it) fly from muzzle to target
  and land with their own impact. Direct fire is capped at 0.12–0.15 s of flight, so a shot still
  lands about when the sim applies its damage. Shells trail smoke; the shell's impact light is sent
  to `colonyLights.fx(FX.SHELL, x, z, x, z)` on landing (x1 = x2 means "impact only").
- **Beams** (400): rails (white core + wide glow + drifting motes), arcs (4 jittered segments with
  a fork), bite slashes, repair beams (with motes travelling along them).
- **Glows** (2200 sprites, additive): muzzle flashes, impact flashes, fireballs and sparks (with gravity
  and drag). **Smoke** (900 sprites, normal blending): smoke, dust, debris chunks.
- **Shockwave rings** (120) on the ground, and **scorch marks** (160) that darken the ground
  (multiply blend: works by day and night) for 7–14 s.
- Deaths look up the slot that was just at that spot (`ArmyView.creatureDied`): fauna splatter
  (green ichor, stain), machines burn (fireball, sparks, debris, smoke, scorch). Units flash bright
  for 0.14 s when hit (`ArmyView.hit`, matched to the FX target point within 1.6 u).

Sprites are camera-facing quads built in the vertex shader. The renderer uses a **logarithmic depth
buffer**, so every custom shader here includes `<common>`, `<logdepthbuf_pars_*>` and
`<logdepthbuf_*>` (without them they draw nothing). `BattleFx.detail` (0..1) scales particle counts.

Checking it: `__exo.army.fx.spawn(kind, x1, z1, x2, z2, h1, h2, organic)` fires any effect in the
running campaign; with software GL, wrap `fx.update` to scale dt down to see short-lived sparks.

**Sound** (`src/audio/synth.ts`, `src/audio/index.ts`). Combat recipes are layered: a click (the
leading edge), a body whose pitch says the calibre (often through `drive()` soft-clip saturation for
weight), and a tail (`crackle()` debris, rumble). The shell recipe carries its own launch, whistle and
landing boom 0.5 s later. In the mixer, world sounds get a distance factor `far` from the spatial
gain: a low-pass from 16 kHz down to ~1.1 kHz and a larger send to a shared **echo** (a convolver on a
generated 1.4 s stereo impulse with four early slaps, low-passed, into the Combat category). Combat
voice caps rose to 10 (14 overall) since tails are longer.

### Turrets that turn (v0.60.1)

Units used to be one rigid mesh, and the sim turns a hull toward its target only while standing still
(and fires without waiting for the turn), so a tank driving past a fight shot out of its side.

- **Sim:** a unit's `aim` (world yaw to its target, unset without one) goes out in the army snapshot as
  `F.AIM` (STRIDE is now 9; the hull's heading when there's no target, and for hostiles and the old
  skirmish worker). It is drawn only: firing rules are unchanged.
- **Models:** a model part named `turret` is drawn as its own instanced mesh (`splitPart()` in
  `src/assets/models.ts`), pivoting on that object's origin. In `blender/build.py` that's
  `join(parts, "turret", pivot=...)` beside the body. Built-ins give `turret: { geo, pivot }` in
  `BUILTIN_UNITS` (`wholeGeo()` seats it for the editor's previews). Tank, Gunboat, Skiff and Rover
  have one (v0.61.0).
- **View:** `ArmyView` keeps each slot's turret yaw and swings it toward `F.AIM` at `TURRET_SLEW`
  (6 rad/s), placed at the pivot transformed by the hull's matrix; it takes the hull's colour (hit flash
  included). A shot starts `muzzle` u toward its target (per built-in look: the gun's end; it faces
  the target, by turret or by turning the hull), passed to `BattleFx.spawn` as `reach`.

**Fixed guns (v0.61.0).** A unit with `fixedGun` (Lancer, Artillery) fires only when its target is within
`FIXED_GUN_ARC` (0.3 rad) of its heading: standing still it turns to face first (8 rad/s, as before);
driving, it fires only at what's ahead, except that within `FIXED_GUN_HALT` (8 u) of its move's end, with
a target in range, it arrives there and fights (needed: a crowd sent to one spot never quite arrives, and
the AI's siege lines stalled; the four-way normal free-for-all in `tools/ai-sim.mjs --check` ran past 80 min
without it, ends at 49.9 min with it, 38.7 min with free guns). Measured (3 v 3 Brutes, headless): standing, no change (Lancers
5.5 s → 5.6 s to clear; Artillery 16.9 s both); ordered to drive past the pack, Lancers 8.4 s → 13.6 s
and Artillery 10.4 s → 24.1 s, with no extra losses.
