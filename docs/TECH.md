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
  - **Options** (`src/options.ts`): one panel, opened from OPTIONS on the title screen and ⚙ Options in the ⋯ menu
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
