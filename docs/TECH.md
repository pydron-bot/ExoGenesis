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
- **Landing look** (v0.80.0, `src/landing.ts`): petals shade panel seams, staggered heat-shield tiles, re-entry
  streaks and a painted band in hinge space (per-petal `aSeed`), and glow with entry heat (`uHeat`) that cools
  after the burn; bells are lathed and glow while burning (`uNozzle`). Plumes are open tubes with a shader
  (soft silhouette, scrolling 3D noise, shock diamonds in the core; `uThrottle` sets brightness and reach).
  The burn adds a ground point light, an additive firelight disc and a scorch disc draped on the terrain
  (`groundDisc` + `decalMaterial`: per-vertex RGBA via its own attribute, since MeshBasicMaterial with
  4-component vertex colours drew nothing here), warms nearby dust, and throws sparks; touchdown adds a
  low shock ring of dust, sparks and ~70 instanced rocks; the dissolve sheds cyan motes into the core.
  Dust puffs are billowy (noise edge, twist, lit top) and soft against the terrain: each pixel looks up the light
  map's ground height and fades over the last 0.6-4 u (no depth pass). The scorch is the region's
  (`RegionView.setScorch`, `src/world/decal.ts`): the landing burns it in and it stays. Stills:
  `node tools/landing-shot.mjs --gpu --bloom`.
- **v0.80.0 look round the landing**: the Command Core (`buildCore`) keeps its footprint, bay and named parts
  (`hatch`, `lintel`, `ring`, `beacon`, `pod`) and merges its new decoration into one mesh per material, with
  `addWear`. Stones (`src/world/pebbles.ts`): instanced, clustered by a coarse noise, ~1200 per 100² u on desktop
  (380 on phones), off water and the pad, hidden on building pads by `relevel`. Sky (`skyDome` in
  `src/world/sky.ts`, driven by `SolarSystem`): the horizon is the background colour (so the fog meets it), a
  deeper zenith, a projected cloud sheet (5-octave value noise) lit from the sun, coverage from `overcast`; stars
  draw first (renderOrder -3) so clouds cover them. Fog of war (`src/world/fog.ts`) continues past the region edge,
  fading back to lit over 1.6 half-widths, and `fogDistance(cam.dist)` lightens unexplored land from 0.1 at 180 u
  to 0.8 at 1200 u: before, zoomed out, the region was a dark square on a lit globe. The near sea fades out over
  its outer band (`uWaterEdge`). Orbit: a day-side haze term in the atmosphere; clouds shaded by thickness.
- **Landing sound** (v0.81.0, `src/audio/landing.ts` `LandingSound`): synthesised with the synth.ts helpers (now
  exported), into the Events channel via `GameAudio.sfxOut()` (null while silent, so it follows the settings).
  Beds steered each frame by `Landing.frame`: entry roar (heat), burn noise + 34-44 Hz rumble (throttle, brighter near
  the ground), air rush (speed), dissolve fizz. One-shots: ignite, touchdown (+ cooling ticks), petal(i), power,
  hatch, drone; `Landing.cue()` plays each once and only within 0.5 s of its moment (a jump ahead stays quiet).
  Measuring it headless: an AudioWorklet meter on the Events bus (a ScriptProcessor runs on the main thread and drops
  audio during slow frames, so one-shots looked missing).
- **Title tour system view** (v0.81.0): a `Stop` with `overview: true` at `system.starPos`, framed at
  `SolarSystem.extent()` × 2.4 and pitch ~0.85; `system.overview` shows the orbit paths faintly though `tour` hides
  them. The second trip always goes there, then ~22% of trips.
- **Tour sights and the star up close** (v0.82.0): `title.ts` stops have a `kind` (`overview`, `sun`, `comet`,
  `belt`, `rings`); each special one has an `aimAt()` look (direction out from the focus, distance, level) that the
  camera follows via `ZoomCamera.aim()` (viewDir's inverse) and `upOverride`/`upW` (the frame's up blended to the
  belt's or a ring's plane, so the horizon is level and never jumps). Bodies from `tourStops()` are passed as plain
  stops (their own `kind` is planet/moon). `SolarSystem.scenic()` lists the star, comets, ringed giants (ring normal
  from the RingGeometry's world matrix) and the belt radius; `beltsOn` draws the belts up close; `chase` (a comet's
  name) draws it in full with `CometLook.boost` ≥ 0.7. The star: `sunNear` (1 within ~6 radii) turns the photosphere
  gold with faculae and red spots, fades the old corona shell, and shows `coronaRays()` (a camera-facing sheet:
  streamers, an inner rim, prominence loops); the lens flare fades out as the sun grows past 0.1-0.2 of the view.
  Stills: `node tools/tour-shot.mjs --gpu [--kinds sun,belt,comet,rings,overview] [--w 390 --h 844]`.
- **Depth and air from space** (v0.82.2): every ShaderMaterial drawn among other geometry must include the
  `logdepthbuf` chunks (the renderer uses a logarithmic depth buffer): the star and corona didn't, so their depth was on
  another scale and bodies behind the star drew over it (comet tails likewise). The atmosphere shell
  (`buildAtmosphere`, now with `inner` = body/shell radius) is worked out per pixel from the view ray's chord through
  the shell (air crossed, the nearest point's sun side), so the 96×48 mesh's facets never show; before, its rim came
  from interpolated normals and rippled. Also: the corona shell used `uNear` undeclared since v0.82.0 and failed to
  compile (watch the console for `VALIDATE_STATUS false` after shader edits).
- **No hitch on first placement** (v0.82.1): Derek's iPhone report showed a 445 ms freeze at a shader compile ~10 s
  into play; placing each building kind compiled 3-5 programs. `RegionView.warmBuildings(kinds)` (boot, once the
  region's models settle) draws one of every kind buried under the pad for 3 frames: finished (both LODs), printed,
  and through its batch. The warm prints' materials are kept (not disposed): three.js deletes a program when no
  material uses it, so each real print finishing freed it and the next placement recompiled. A shrunk construction
  bar stays in the scene for the same reason. The Performance report names what each compile was for.
- **Landing without hitches** (v0.80.1): shader compiles mid-landing were the stutter (JS is ~0.2 ms a frame).
  `Landing` draws everything (frustum culling off scene-wide, the region's detail layer forced on via
  `RegionView.forceDetails`, every drone LOD shown, one invisible particle/rock primed, plumes/decals/sheath at
  zero) for the first 0.4 s of the landing clock (frame-counted warm-ups ran before the first render), and again
  for 0.3 s if a background model arrives late (`rewarm()`); boot waits up to 2.5 s under the loader for the
  region's models. `post.warm` runs sun shafts and the distort pass at zero; `system.warmSky` the sky dome and glow.
  No point lights on the probe: adding/removing one recompiled every lit material (24 programs at the hand-over).
  Check with `node tools/landing-perf.mjs --gpu` (programs compiled mid-landing; exit 1 if any after the warm-up).
  Players' devices: `?perf=record` records from the first frame; reports list the slowest frames with what was on
  screen (`PerfDeps.moment`) and shader compiles over time. Story hints: `StoryHud.opened(what, again)` re-sends
  while a story hint is up (it was once per game, so a second hint at Build never cleared); tapping the bubble
  sends `ui: 'hint'`, which clears it.
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
  ＋ in a column starts a record already in that chapter. A second sideways scrollbar sits above the columns
  (`.board-topscroll`, sticky at the top of `#main`, kept in step with `.board-cols` both ways and sized to its
  `scrollWidth` on every draw and resize; v0.76.1). The sidebar lists story records under their chapters
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
    phones don't (`?glowaa=N` sets the sample count; since 0.76.0 the ⚙ Anti-aliasing option below decides). Phone size, dpr 1, SwiftShader: ~100 ms/frame glow off, ~190 with 4× MSAA, ~80 with
    none (cheaper than off, since the canvas's own MSAA then only draws a quad). Needs a real-phone check before
    defaulting it on there.
  - **Anti-aliasing (v0.76.0)** (`src/world/post.ts`, ⚙ Options → Anti-aliasing, `exo.aa`, `?aa=auto|off|fxaa|smaa|msaa`):
    a cycling row. `auto` is the old behaviour (canvas MSAA with Glow off; with Glow on 4× MSAA on the HDR target on
    desktop, none on phones). FXAA/SMAA are `FXAAPass`/`SMAAPass` after `OutputPass`; MSAA is the canvas's own with
    Glow off, else 4× on the target. Glow off + FXAA/SMAA (or MSAA on a canvas made without it) runs the composer
    with bloom, shafts and shimmer skipped. The canvas's `antialias` is fixed at load (asked for only for auto/msaa),
    so Off with Glow off applies after a restart; the row then reads `OFF · RESTART`. `post.aaInUse` says what is
    actually smoothing. Cost, `tools/aa-bench.mjs phone` (llvmpipe, 682×1162, p50 ms; no GPU browser on hive1):
    glow off: off 43, canvas MSAA 100, FXAA 85, SMAA 88; glow on: off 84, FXAA 94, SMAA 101, MSAA 137. A CPU
    renderer overstates MSAA (phone GPUs resolve on chip), so check a real phone before changing `auto`. Quality:
    SMAA ≈ MSAA on building/drone edges, FXAA visibly softens small detail, MSAA best on thin flora stems.
    `tools/options-smoke.mjs` checks the cycle, that each mode takes effect, and that it's remembered.
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
- **Light, mist and metal (v0.79.0, 2026-11-24):** four Options rows (each `?name=0|1`), all off-able:
  - **Sky reflections** (`src/world/envmap.ts`, `?reflect`): a tiny sky scene (zenith, horizon, ground, sun spot)
    baked by PMREMGenerator into `scene.environment`, re-baked only when its quantised colours or the sun (~3°)
    move, at most every 1.5 s, 128 px faces. Metal (`metal()`, metalness 0.45) had nothing to reflect and drew
    near-black. The ground gets the map at a fifth of the strength (`SkyEnv.own`: its own `envMap` and intensity,
    since `scene.environmentIntensity` is global) so hills keep their shading; the hemisphere fill dims by 45%
    to make up. Fades with `air` toward orbit.
  - **Ambient occlusion** (`n8ao` 2.1.0 in `src/world/post.ts`, `?ao`; types in `src/n8ao.d.ts`): N8AOPass
    replaces the RenderPass. Half-res, Low (desktop) / Performance (phones) quality, radius 0.22 × camera
    distance (2.5..14 u), intensity 4, zero in orbit. Its depth isn't multisampled, so with AO on, auto/MSAA
    anti-aliasing becomes SMAA (`aaPassMode`). `transparencyAware` off (domes and ghosts don't occlude).
    Default on with Glow's rule (desktop, not automated browsers).
  - **Mist and sun haze** (`src/world/atmos.ts`, `?mist`): replaces `fog_fragment` inside the light map's
    patch (so only lit materials; glow strips keep plain fog). Linear fog unchanged; mist adds below a base
    height taken from the region's terrain (25th..75th percentile spread) and only past the camera's focus
    (0.6× to 3× its distance), strongest round sunrise/sunset and in weather; fog toward the sun takes the
    sun's colour. Off without air.
  - **Vehicle wear** (`src/world/wear.ts`, always on, player units in ArmyView): dust low down measured above
    the terrain (the light map's height texture, under the patch's own uniform names: the light patch
    declares `uLmH` & co. in the same shader), a patchy film on upward faces, per-panel and per-vehicle tone.
    Injected before `lights_physical_fragment`, where the normal is known. Glow materials are skipped.
  - **Vehicle kit** (`vehicle_kit` in `blender/build.py`): headlights (`lamp`), tail lights, top seams and
    side accent stripes on rover, tank, artillery, arc, lancer and engineer (~120 tris each; all stay
    under 1,500).
  - Checked by screenshot only (SwiftShader: no GPU numbers; the dev box's headless Chromium can't reach the
    GPU). Debug tip: modules edited while the dev server runs are served as `?t=…`, so a test's
    `import('/src/world/x.ts')` gets a second copy; reach live uniforms through a material instead
    (`renderer.properties.get(mat).uniforms`).
  - **Team trim** (`src/world/trim.ts`): skirmish players' colours go per unit into an instanced `aTeam` (rgb;
    black = none, which is also what a mesh without the attribute reads) on the asset models and their
    turrets; materials named `team` (kit stripes and deck patches, `vehicle_kit(patch=…)`) take it as paint,
    `cyan` glow strips glow in it. The instance colour stays health + hit flash. Built-ins (zoomed out) keep
    the whole-unit tint. In skirmish your own trim shows your colour too.
  - **Smooth terrain is the default** (`look` in main.ts: only a stored `flat` keeps Flat). Its 22 u texture tile
    no longer shows: `antiTile` (`src/world/terrainTex.ts`) blends each map and normal-map lookup with a
    second one rotated ~53° at 0.73× scale, weighted by a value noise (uv × 0.9), and the texture's cracks are
    shallower (−0.16, was −0.35). `look-smoke` starts with `?look=flat` and checks the new default.
  - **Sun shadows** (`src/world/sunshadow.ts`, `?sunshadows`; desktop default, off on phones and automated
    browsers): the sun is a point light (six renders a frame to shadow), so near the ground a DirectionalLight
    along the same sun direction takes the sunlight over (`system.handoff(k)`: the point light keeps 1 − k, sum
    unchanged), k = 1 below camera distance 110, 0 past 170 and toward orbit. PCF soft, 2048² (1024² on
    phones), an ortho box of ±1.25 × camera distance (18..190) round `cam.focus`, stepped in whole texels in the
    light's frame so edges don't crawl; bias −0.0004, normalBias 0.04. `mark()` (once a second) makes lit opaque
    meshes cast and receive (not glow-only, transparent, basic or shader materials). The light map's blob
    shadows fade by k (`lights.realShadows`). Flora's wind sway isn't in the depth pass (shadows don't sway).
  - **Performance report** (`src/perf-report.ts`, menu → Performance report; test `tools/perf-smoke.mjs`):
    *Record* logs rAF deltas, the frame function's own time, draws/triangles, render-scale changes and frame
    times by zoom bucket, until Stop (10 min max). *Benchmark* pauses, pins the render scale (`res.hold`),
    then for "as you have it", each costly effect that's on (`bench` ids in main.ts) switched off alone, and
    all of them off: 40 warm-up frames (shader compiles) and 90 measured, each ended with a 1-pixel
    `readPixels` so the time includes the GPU (vsync would hide it). Switches write their remembered keys:
    `setOff` wraps `Storage.prototype.setItem` to note which, and only those are restored afterwards (other
    saves made meanwhile, like the camera, are left alone). Report = device (unmasked GPU string), game facts,
    settings, sections; Copy (clipboard, execCommand fallback) / Save (.txt download). `?perfframes=W,M,L,S`
    shortens the steps for tests.
    v0.79.1: `renderer.info.autoReset` off while running (it counted only the composer's last pass: "1 draw").
    Each benchmark step has a *running* part after the waited one: un-paused, `S` settle frames then `L`
    (120) frames timed frame to frame, no sync. `SimClient.timing` (static hook) times each worker message on
    the main thread from the first `e.data` read (that's when the browser decodes it). The recording adds
    snapshots/s and their cost, and frame-to-frame minus own work ("outside the frame"). First real report
    (Derek's iPhone, v0.79.0): waited ~12 ms with every effect on and no measurable saving from any of them,
    yet 42 fps in play with the render scale stuck at 1.0–1.25: the cost is outside the GPU work, which is
    what the running part and the message timing are for. Headless Chromium doesn't throttle rAF to the GPU,
    so "running" reads 16.7 ms there whatever the load (meaningful on real devices only).
    Second iPhone report (v0.79.1, scale 1.5): 60 fps running with everything on; waited 16 ms, saved by AO 3.6,
    sun shadows 3.1, sky reflections 2.7, mist ~2; Glow ~0; sim messages 10/s, <0.1 ms. After ~1 min every step
    got slower (a lens flare "costing" 24 ms): thermal throttling, which is also what the first report's 42 fps
    was. v0.79.2: the benchmark ends with "as you have it, again" and flags >10% drift; the ground no longer
    samples the sky reflection map (`GROUND_ENV` 0 → `SkyEnv.own` sets `envMap` null: no lookups), looks the same.
  - Sky reflections default off in automated browsers (like Glow): on SwiftShader they took frames from ~0.7 s
    to ~1.2 s and `skirmish-play-smoke` lost sight of its spawned enemies; screenshot scripts pass `?reflect=1`.
  - `tools/asset-smoke.mjs` had been checking `army.bodies[1]` for the asset model since before v0.14.0 moved
    models to `army.models`; fixed.
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
  - **Night · Stillness (v0.64.0):** glass pads and bells over five chords in C minor (Void Drift's four plus Eb), 18–24 s
    chords, a 70 bpm pulse and calls in the middle of six sections, no choir. Written at level 0.95 it measured ≈ 3.5 dB
    above Void Drift and Vigil (240 s renders through `tools/music-render.mjs`, ffmpeg ebur128); set to 0.7 to match.
  - **Night · Last Star, Night · Silent Hull, Day · Stellar Governance (v0.65.0):** two slow choir-and-bells night
    pieces (E minor, F♯ minor) and a 16-step day piece with strings, a pluck arpeggio, a bassline and six drum tracks.
    180 s renders (ffmpeg ebur128) against Void Drift and Bright Works / Homestead Ridge: Silent Hull and Stellar
    Governance sit within 1 dB at level 0.95 as written; Last Star measured ≈ 2 dB loud and was set to 0.77.
  - **Mix upgrade (v0.66.0):** the hall's input is high-passed at 220 Hz (one `BiquadFilterNode` that every reverb send
    goes through), so low notes no longer smear into a long tail. The bass goes dry to the mood's level, outside the
    hall. Pads go out dry (0.95) plus a slow stereo chorus (0.8: two delays, 18 and 24 ms, drifting ±4 ms at 0.17 and
    0.23 Hz, one per side), both also into the hall; the two sends were set so pads come out about as loud as they
    did straight through. Pad and bass releases are exponential (time constant release / 3, stopped 6 of them later, at
    −52 dB); swells stay linear (an exponential approach climbs fastest at first, which makes a slow swell less
    gradual). The choir's vowel formants are wider (Q 2.6–4.5, not 5–18) and its top is capped at 2.6 kHz (was 5 kHz),
    with makeup 3.3 (was 4.5). Air is a wide band of noise (Q 0.7) around 3.8 kHz, ±1.2 kHz, going dry, at peak
    0.011 (was 0.024 through the pads and hall).
    Levels: every mood in use was rendered 90 s with the same seed on the old and new engine (`--seed`, below) and
    measured (ffmpeg ebur128). Drum- and arpeggio-led moods moved under 0.5 dB; big-room pad moods lost 0.9–2.7 dB
    (the hall's low end and the bass's share of it), and their `level` was scaled by the difference: Stellar
    Governance 0.95 → 1.3, Silent Hull 0.95 → 1.25, Last Star 0.77 → 0.99, Void Drift 0.72 → 0.87, Stillness
    0.7 → 0.8, Homestead Ridge 2.2 → 2.44, Landfall 1.38 → 1.46.
  - **Repeatable renders (v0.66.0):** `tools/music-render.mjs --seed N` swaps in a seeded `Math.random` (mulberry32)
    before the page loads, so a mood plays the same notes every render (two renders differ by at most 1 in 32767):
    two versions of a mood, or of the engine, compare fairly.
  - **Written scores (v0.66.0):** a mood with `score` plays a piece as written instead of drifting. `score` is a list
    of sections (`name`, `layers`, `bars`); `form` names them in playing order ("intro A A B A outro"; empty = as
    written), then round again. A bar is `Steps a bar` steps at the tempo; each bar can set `chord` (pad notes) and
    `bass`, and write `bells` (one token per `bellStep`, default 8ths) and `melody` (per `leadStep`) in the melody
    notation. A bar with no chord keeps the one before sounding, to the end of its section; a new section strikes the
    held chord again with its own layers. `scoreBars()` flattens the form; `playBar()` replaces `playChord()` (the
    queue gets an entry a bar, sharing the held chord's voices, so layers, skip and the editor's display work per
    bar); random bells are off and the bar's written ones are scheduled at its start. Drums, bassline, arpeggio,
    pulse and calls play over it as set (the arpeggio now restarts on a new chord, not on every bar of a held one;
    `drumsIn` counts bars). Every random choice in music.ts goes through `random`, which a score swaps per part
    (`run()`: setup, chord, bell, pulse, drum, arp, call) for its own seeded source (`seed`, default 1), so the
    numbers don't depend on how the timer batches the parts: the smoke test renders the example score twice with
    `Math.random` left alone and gets the same samples (largest difference ≈ 2e-5), where a free mood differs by 0.6.
    With a score, `chords`, `order`, `homePull`, chord lengths, `sections`, bell gaps, `phrases` and `melody` are
    unused, so those are optional now (the engine already had defaults). Content checks: notes in chords, bass,
    bells and melody; layers; every name in the form exists; a bass note without a chord in its bar; at least one
    chord. The editor shows sections and their bars as nested lists and ▶ Listen reports "bar 3 of 20 · A".
    `content/music/score-example.json` (not played in the game) is a template.
  - **Scored pieces and drifting afterwards (v0.67.0):** Stillness, Last Star, Silent Hull (night) and Landfall
    (title) are written scores now. `scoreThen: "drift"` plays the score once, then drifts as a free mood over the
    score's own chords (each once, in the order they first come; a mood's `chords` list wins if it has one), with
    `scoreThenLayers` (empty = pad, choir, bass and bells) and the free settings' defaults (12 s chords, bells every
    3 s or so). The drift draws on `Math.random` (the written part stays seeded), so it differs every time. Landfall
    does this: about 96 s as written, then a soundscape until the title closes. Levels: the full forms rendered and
    measured against Void Drift (−18.9 LUFS): Stillness −19.1 and Last Star −20.4 at 0.95 as written; Silent Hull
    −22.4 at 0.95, set to 1.25 (−20.2); Landfall −22.7 at 1, set to 1.46 (−19.4, as the old one measured).
    Smoke test: the example score with `form: "intro"` and drift plays its 2 bars, then drifts with bells.
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
  - **Visual score editor (v0.74.1, editor):** under ▶ Listen in Rules → Music (`src/editor/score-editor.ts`, hosted by
    `music-panel.ts`). It edits the draft in the mood's own notation and rewrites only the bars it touches, so the
    form below and the file stay in step (a drag edits a snapshot of the section's bars and commits on release, one
    undo step).
    - *Arrangement:* the `form` as a strip of section blocks, widths by bar count, colour per section, the one playing
      lit. Drag to reorder (or drag a section tab onto it), × takes one out, + add appends; an empty form is written
      out in full on the first edit. Double-click plays from there. Shows total bars, length and repeat/drift.
    - *Sections:* tabs; name (renaming updates the form), layer chips (no list = all, dashed; a click writes the
      list out), bars ±, Duplicate, Delete (and out of the form), 🔁 Loop it.
    - *Piano roll* (canvas, C1–C7, 16th columns, zoom): chord blocks run from their bar to the next chord or the
      section's end, with the bass under them (faint when it's the default); bells (with a ring tail) and melody
      notes on top, placed in `bellStep` / `leadStep` tokens. The lane picked (Melody, Bells, Chord, Bass) is
      editable, the rest faint. Rows of the chord sounding are tinted in every octave. Melody: click to write (new
      notes 1–8 steps), drag the right edge to hold, drag to move; a line plays one note at a time, so a note cuts
      short or replaces what it lands on. Chord: click toggles a note in the chord you see there (the bar that
      owns it), drag moves one, Shift+click starts a new chord in that bar from the one held. Bass: click sets it.
      Right-click removes; with a note selected, Delete, arrows (Shift: octave). Every note is auditioned (a plain
      triangle/sine, not the mood's voice). The header names each chord (`chordName`: triads, sevenths, sus, add9,
      slash bass) and opens a bar's popover: chord, bass, bells and melody as text, insert, duplicate, clear, delete.
      Notes are written in flats if the piece has more flats than sharps.
    - *Step sequencer* (any mood): each drum track (drum, level, cells cycling hit → soft → rest, length ±1 and ×2,
      remove) and the bassline (root → octave → fifth → rest); patterns written back in groups of four. A drum is
      heard when its cell is set.
    - *Following:* the engine exposes `played.at` (when the bar sounding started) and `stepAt(t)` (the drum step
      at a time; a log of the last 48 queued). The playhead runs across the roll and scrolls it, the section tab and
      arrangement block follow (off with the follow box, or by picking a tab while playing), and drum cells light on
      their step, each row on its own length. Play from / loop hand the engine a view of the draft with the form
      rotated or cut to one section (`scoreThen` repeat while looping). Space plays and stops.
    - Tests: driven by hand in Playwright (every lane, popover, undo, form edits, loop, write-a-score on a free mood);
      `music-smoke` still passes. (`import-smoke` fails one check, from before: it expects `homePull` filled in, which
      stopped being required in v0.66.0.)
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


### Title tour and softer columns (v0.75.0)

- **Tour** (title icon 🪐, or `?tour=1`): `TitleScreen.tour(on)` toggles `#title.touring`. CSS fades out the
  column, foot and scanlines (the foot gets `visibility: hidden`, because its entry animation holds its opacity),
  keeps only the radial vignette, and centres the planet (no view offset). The camera runs the same trip and dwell
  logic, but the first departure comes after 2.5 s and the stay at home is capped at 12 s. A Screen Wake Lock is
  requested where the browser has one. A `pointerdown` on the root, or any keydown, ends the tour. `pointerdown`
  is used so the click that started the tour can't end it. `hide()` ends the tour too.
- **Steam and exhaust** (`steamCone` in `src/world/region.ts`): the Deep-Core Mine plume and the vent/Geothermal
  steam are open cones with an RGBA vertex-colour alpha. Alpha ramps in over the first 1/6, then falls as
  (1-t)^1.6 to nothing at the wide top. Opacity is 0.2 / 0.18 (it was a flat 0.22 / 0.2). From the high camera
  the flat cones read as solid beams.
- **Heat shimmer** (`DistortShader` in `src/world/post.ts`): amplitude 0.0016 → 0.0009 uv, and the column ends
  at 0.7–1.8× source size instead of 1.2–3.2×. From the top-down phone camera, the tall column showed as a long
  wavy stripe.
- Checked with `tools/lights-shot.mjs` at a phone size (before and after) and a Playwright run of the tour
  (title → Tour → trip to Verdance → tap returns the menu, no page errors). The options, guide and region smokes
  pass.

### Sun shafts only from a visible sun (v0.75.1)

The shaft pass smeared *any* bright pixel toward the sun's screen point, and `main.ts` only checked that the sun
projected in front of the camera. At night the sun under the ground still did that for a downward-looking camera,
so every glowing building (Core, tanks, reactors) threw a long ray up the screen (`look.shafts` was 0.55 at
midnight). The fixes:
- `main.ts`: the strength is multiplied by `lerp(sunInSight(), smoothstep(-0.02, 0.08, sunUp), air)`.
  `sunInSight()` is a ray test from the camera to the sun against `system.occluders(R)`.
- `ShaftShader`: each sample is weighted by `1 / (1 + 10·d²)`, where d is the sample's aspect-corrected distance
  from the sun, so only light near the sun feeds the rays.

Measured with a 390×844 night colony: shafts at 0, 4 and 12 o'clock are 0 (was 0.548 at 0). A low camera swept
round at 7:36 still finds them at 0.70.

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

### Selecting several units (v0.77.0)

`src/input.ts`. Before this, several units could be selected only by Shift-click, double-tap/hold (all of a type on
screen), the ⚔ chip, Ctrl+A or a control group. Both gestures come from the skirmish prototype (`src/skirmish/input.ts`).

- **Box** (desktop): Ctrl/Cmd + left-drag on the surface, checked before Shift-drag (which turns the camera), so a plain
  left-drag still pans. On release, every combat unit whose screen point (`unitScreen`) is inside the box is selected;
  Shift held adds to the selection. A Ctrl-click without a drag goes on as a normal click.
- **Paint** (touch and mouse): a press on empty ground (no drone or unit under it, not placing, zoomed in to where units
  can be picked, at least one combat unit) starts a `HOLD_MS` (420 ms) timer. If the pointer hasn't moved more than
  `TAP_PX` by then, it buzzes and the drag paints: units within `BRUSH_PX` (30 px) of each new stroke segment join the
  selection as they are crossed (Shift at the start adds to the old selection). Moving first pans, as before. As with
  hold on a unit, a move whose event time is before the hold time (delivered late by a slow frame) turns it back into a
  pan. A second finger cancels it, back to the selection before.
- The box and the stroke are drawn on `#sk-overlay` (the skirmish's overlay canvas, otherwise unused in the colony).
- Shown in Controls (`showControls` in `main.ts`), the unit card's Select row and the Field Guide's *Selecting and giving
  orders*.
- **Test:** `tools/select-smoke.mjs`: paint with the mouse and with touch (6 of 6), painting doesn't pan, a quick drag
  pans and keeps the selection, a Ctrl-drag box (6 of 6) doesn't pan, Ctrl+Shift adds. `units-smoke` and `qol-smoke`
  still pass.
- **Fix in the same release: cloud streaks from orbit.** The cloud shells (`buildClouds` in `world/surface.ts`, and
  `cloudShell` in `world/body-surface.ts` for other bodies) turned at a speed that depended on latitude
  (`t · 0.004 · (1 + 0.4 y)`). That difference built up without limit, and `t` is seconds since the page loaded, so after
  half an hour or so the clouds were sheared into thin white streaks along the lines of latitude. Now the shell turns as
  one (`mod(t · 0.004, 2π)`, which also keeps it precise in a long session) plus a bounded sway between latitudes
  (`0.35 · y · sin(t · 0.0023)`). Checked by pinning `uSurfTime` at 0, 4,000, 5,400, 7,200 and 36,000 s.

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

### Comets, lens flare and keeping the screen on (v0.68.0)

- **Comets** (`src/world/comet.ts`, `CometLook`, built by `SolarSystem` for `kind: comet` bodies; replaces the
  old additive cone). A coma sprite at the nucleus (never under ~1.2% of the camera distance, so it stays
  findable), an **ion tail** straight away from the star (blue, narrow, filaments from two octaves of value
  noise scrolling outward) and a **dust tail** (warm, ~3× wider, 0.8× as long) whose spine is a parabola
  bent back against the direction of motion (`orbitPos` 5 s on, minus now). Each tail is a 40-segment ribbon
  rebuilt on the CPU every frame, its sides turned about the spine to face the camera; fades and edges are
  per pixel, additive, no depth writes. Activity `smoothstep(230000, 35000, distance to star)` sets length
  (2.5k–77.5k u) and brightness. Shown in the system view, and faintly from orbit (not from the surface).
- **Lens flare** (`src/world/flare.ts`, `SunFlare`): 11 additive sprites in their own scene with an
  orthographic camera, drawn over the finished frame after `post.render` (so it works with Glow on or off):
  glow, a starburst turning with the sun's screen angle and a thin blue anamorphic streak on the sun; discs,
  hexagons and rings along the sun → centre line, brighter as the sun nears the middle of the view.
  Occlusion is analytic: every planet and moon (and the globe being played, radius R) is a sphere, and the
  sun's disc scaled to the sphere's distance gives a soft edge, so a sunset or a planet's limb sinks it
  smoothly. Fades off the screen's edge, a little weaker for a small far sun (system view), 45% weaker
  under a bright day sky; eases at 12/s. Options → Lens flare (`exo.flare`, `?flare=0|1`).
  `__exo.flare.strength` (0..1) and `__exo.system` are test hooks.
- **Keep screen on** (`main.ts`): the Screen Wake Lock API (`navigator.wakeLock.request('screen')`) while the
  page is visible; re-requested on `visibilitychange` and on a tap (some browsers want a gesture). Options →
  Keep screen on, default on (`exo.awake`, `?awake=0|1`); locked with "Not in this browser" where it's missing.
- Checked with renders of both comets near perihelion from three angles, the sun clear, half behind the
  planet's limb and fully behind it; `tools/options-smoke.mjs` now expects six graphics toggles.

### Living skies (v0.69.0)

All look only: the sim, saves and balance are untouched. Checked by `tools/visuals-smoke.mjs` (flare on and
occluded, comet activity, Milky Way present, held weather and its schedule, dust behind a drone, the new
Options rows, no shader errors) and renders of each effect.

- **Sun** (`src/world/sun.ts`): `starMaterial()` replaces the flat disc: two scales of jittered-cell
  granulation churned by slow noise, spots from an fbm threshold, limb darkening `mix(edge, hot, mu^0.45)`;
  unlit, toneMapped off, peaks ~1.0 so it blooms without flattening to white. `coronaMaterial()`: a back-faced
  shell at 1.3× with drifting fbm streamers, strongest at the disc's edge. The halo sprite fades within
  ~9 star radii so the surface shows up close; the flare's on-sun parts fade once the sun is big on screen.
  `sunDim` dims both under weather.
- **Sun position for shaders:** `sunPosUniform` (`body-surface.ts`, aliased as `sunUniforms.uSunPos`), set in
  `SolarSystem.update`.
- **Atmospheres** (`buildAtmosphere`, `planet.ts`): now lit: rim × (0.12 + 0.88·day + 4·forward-scatter),
  day = smoothstep over N·L, forward scatter = max(−V·L, 0)^5, warmed along the terminator. The home globe's
  shell gets it too. Gas giants get a thin shell (top band paled, strength 0.4) for a soft limb and backlit ring.
- **Rings** (`ringMaterial`): the planet's shadow (fragments whose line to the sun passes within the planet's
  radius, on the night side, soft edge), and seen from the unlit face, transmitted light (thin ringlets bright,
  dense ones dark) plus forward scattering toward the sun.
- **Sky** (`src/world/sky.ts`): `starField()` (custom points: per-star size, tint, twinkle phase; 35% placed
  along the band; twinkle = `surface`; opacity no longer drops 92% on the ground at night, only under a day
  sky or cloud). `milkyWay()`: an inside-out sphere, band about a fixed pole, cloud fbm, dust lanes, rose/teal
  nebula patches, discarded away from the band (most pixels do no noise). `skyGlow()`: additive dome round the
  camera on bodies with air: the sun's halo, and at golden hour (`SolarSystem.golden`, sun within ~±0.2 of the
  horizon) a warm horizon band brightest on the sun's side. The frame loop also warms the sky/fog colour
  (`#c9825e`, 40%) and the sunlight (`#ffb070`, 60%) then. `SolarSystem.skyDay / skyAir / golden / overcast /
  skyUp / pixelRatio` are set by main.ts each frame before `update`.
- **Sun shafts** (`post.ts`, ShaftShader, with Glow on): 40-tap radial smear toward the sun's screen uv of
  luminance above ~0.5–1.3 (linear HDR), decay 0.955, falloff with screen distance; strength from on-screen,
  air and golden hour, cut by overcast. Off (pass disabled) when the sun is far off screen.
- **Heat shimmer and zoom blur** (`post.ts`, DistortShader, with Glow on): up to 8 sources from powered,
  finished buildings of roles core, reactor, generator, geothermal, factory, printer, deepmine within 260 u
  (nearest first), each a rising column of travelling ripples; zoom blur is a 10-tap radial smear,
  `smoothstep(1.2, 5, |d ln dist / dt|) × 0.035`, not during cinematics or the title.
- **Dust** (`src/world/dust.ts`): a 700-puff pool. Movers (region drones, army slots) faster than 1.2 u/s and
  under 4 u lift emit up to 22 puffs/s (fewer when hovering), not over water (raw height < 0.3); puffs grow,
  rise and fade over 1.6 s, coloured from the body's ground, lit by the day. Frozen while paused.
- **Weather** (`src/world/weather.ts`): spells of 240 s of game time, picked by a hash of the spell index
  (first always clear): rain 18% on bodies with seas (Home counts), dust storms ~12% (28% on dry bodies with
  air), none without air; eased in/out over 45 s. Rain/sand are 2400 lines animated in the vertex shader in a
  box round the camera focus (one draw call, no uploads), shown near the ground. Effects: sky tint and
  darkening, fog pulled in (near ×0.3, far ×0.4 at full), sunlight −60%, sky fill −30%, stars, Milky Way, sky
  glow, flare and shafts cut. `?weather=rain|dust|clear` holds one; Options → Weather (`exo.weather`, `?weatheron=0|1`).
- **Options:** Dust and heat haze (`exo.dust`, `?dust`), Zoom blur (`exo.zoomblur`, `?zoomblur`), Weather.
  `tools/options-smoke.mjs` expects nine graphics toggles.
- **iPhone silent switch** (`src/audio/index.ts`): Safari 16.4+ mutes web audio under the ring/silent switch
  unless `navigator.audioSession.type = 'playback'`. `GameAudio.throughSilent` (default on, saved with the
  sound prefs) sets 'playback', or 'ambient' while sound is off or at volume 0 so the player's own music isn't
  stopped; re-applied on every volume or on/off change. The Options row ("Sound with silent switch on") shows
  only where `navigator.audioSession` exists. Same approach as Curbside.

### Easier swarms, lighter effects on phones (v0.69.1)

- **Threats** (`content/rules/threats.json`), after playtests where the swarms stopped being fun: growth per
  wave 1.75 → 1.2, `maxSize` 40 → 28, `waveInterval` 110 → 130 (regions that set their own keep it),
  `nightBoost` 1.3 → 1.15, `bruteEvery` 8 → 10, frontier migrations `frontierSize` 6 → 5, `frontierGrowth` 3 → 2.
  Balance harness, 5 seeds, 20 min on Touchdown: balanced lost 6–13 buildings (one run lost the Core at
  19.4 min), now 0–3 and all survive; army/mixed lost up to 12, now 0–5; greedy (no defence) now falls at
  15–18 min instead of 11–13. At 35 min the balanced script (which stops building once its plan runs
  out) now falls at ~25 min instead of ~20.
- **Phones** (`pointer: coarse`): sun shafts take 16 steps instead of 40 (decay per step scaled to keep the
  same reach), heat shimmer carries at most 3 sources instead of 8 (`HEAT_MAX`, `post.ts`), the dust pool is
  260 puffs instead of 700 with at most 9 puffs/s per mover and 25% smaller puffs (overdraw), and weather
  draws 900 of its 2400 streaks. Everywhere: dust skips its buffer uploads while no puff is alive.

### Weathering: cloud shadows, wet ground, tracks, smoke, ruins and the colour grade (v0.78.0)

All look only: the sim, saves and balance are untouched. Checked by `tools/weathering-smoke.mjs`.

- **Cloud shadows and wet ground** (`src/world/ground.ts`, `Sky`; shader in `lights.ts`'s lit-material patch, so
  `?lights=0` leaves them out). Clouds: three octaves of value noise in region coordinates, worked out **per vertex**
  (`grCloud`, cells `CLOUD_CELL` = 70 u), darkening direct light by up to `uCloudK` (0.4 × air × day, cut 75% under
  overcast). The noise repeats every 64 cells and the drift wraps there, so the offset never grows and the sin-hash
  keeps its precision. The wind turns slowly at ~3 u/s; cover drifts between ~0.1 and ~0.55 and closes to 0.85 in
  rain. The globe round the region gets them too, fading out from 150 to 500 u past the edge. Wet ground: `Sky.wet`
  rises at `rain / 50` per game second and dries at 1/240; upward faces get darker and a fresnel sky sheen; puddles
  (fixed value-noise mask, ~11 u features, flat ground near the ground line only) get much darker with a stronger sky
  reflection and sun glint. The sea's own surface (`userData.noGround`) gets cloud shadows but no wet or marks.
  Options → Cloud shadows (`exo.cloudshadows`, `?cloudshadows=0|1`).
- **Ground marks** (`GroundMarks`): a top-down RGBA8 render target over the region (1024², 512² on phones; same
  mapping as the light map, so the shader reuses `vLmUv`), never cleared. Stamps are instanced quads blended with
  `MaxEquation` (overlaps don't stack to black): ground vehicles (unit `move` = ground, not fauna) press tread pairs
  with cross bars into red, creatures footprints into red, wrecked buildings a ragged scorch into blue. A mover
  stamps a segment from where it last stamped once it has gone `max(0.35, 0.4 w)`; a jump over 12 u (a slot reused)
  starts afresh; nothing over water (raw < 0.3). Fading: a full-region quad with `ReverseSubtractEquation` takes one
  step (1/255) off red every 0.25 game s and off blue every 1 s (an 8-bit target clamps at 0): tracks last ~35 s,
  scorches ~3.5 min. Lit fragments within ~0.6 u of the ground darken by `r × 0.5 + b × 0.8`.
  Options → Tracks and wet ground (`exo.marks`, `?marks=0|1`; also turns wet ground off).
  `__exo.marks.read(renderer)` counts marked texels (tests).
- **Damaged buildings** (`BattleFx.smoulder`, called from main.ts per finished building under 60% health, damage
  `(0.6 − hp/max) / 0.6`): smoke puffs (2.5 + 7·dmg per s, drifting on a fixed breeze, darker as it gets worse),
  flames above dmg 0.5, now and then sparks. Game time: nothing new while paused. Particle counts follow `detail`.
- **Ruins** (`src/world/ruins.ts`, owned by `RegionView`): a building that leaves the snapshot in a tick whose FX
  holds a `DIE_BIG` at its spot (`destroyedAt`) was destroyed, not recycled. A fresh copy of its model (own materials)
  crushes to half height, leans 7–16° and chars over 1.6 s, then sinks out of sight over 1.4 s; meanwhile a heap
  rises: 12–60 dodecahedron chunks (instance colours concrete to char) and 2–6 beams, sized to the footprint (55% for
  a building still under construction). main.ts takes `ruins.fresh` for a dust burst (`BattleFx.collapse`) and the
  scorch, and `smouldering()` for smoke over heaps younger than 45 s. Heaps last 180 game s, then sink over 8;
  at most 16 (oldest first); a new building over one clears it.
- **Colour grade and vignette** (`post.ts`, `GradeShader` after `OutputPass`, before FXAA/SMAA): contrast round 0.5,
  lift toward a tint, gain, saturation, vignette. `gradeFor(sky, ground, oceans)`: lift = the sky colour scaled to
  0.045 at its strongest (airless: a cool `#2c3a5c`), gain = 7% toward the ground's mid colour (largest channel kept
  at 1), saturation 1.08 seas / 1.04 air / 0.9 airless, contrast 1.04 / 1.1 airless. Nights lean the lift toward
  `#0a1430` and drop saturation 12%; golden hour warms the gain. All of it eases off in orbit. With no composer
  (Glow off and plain AA) a CSS radial gradient on `#app::after` (`body.vignette`) draws the vignette alone.
  Options → Colour grade (`exo.grade`, `?grade=0|1`).

### Settings without reloading (v0.70.0)

- **Terrain look in place:** Options → Terrain look no longer reloads. `RegionView.setLook(look)` builds a new
  ground mesh (`buildPatch`), swaps it in, disposes the old one (the smooth look's ground textures are shared and
  kept), adds fog of war to it if it's on, and re-levels every building pad into it (`relevel()`, split out of
  `syncPads`). Lights patch the new material on first draw as before. `Flora.setFlat(flat)` flips the shared
  plant material's `flatShading` and rebuilds each instanced mesh's geometry with or without normals (each
  species keeps a `make(v, smooth)`; a species already drawn with a model keeps its model). `globeLook()` in
  main.ts sets the globe's shading and colour. The look is remembered in `exo.look` (`?look=flat|smooth` still
  wins, and is kept in step in the address).
- **Region choice:** the title's Options region rows only mark where NEW GAME lands (`landIn`), relabelling
  NEW GAME ("Land in …"). NEW GAME in the region already loaded lands as before; in another, it loads
  `?region=<id>&land=1`. `land=1` deletes the autosave (NEW GAME's confirm already warned), skips the title and
  lands. It's taken out of the address at once (`history.replaceState`), so a reload later doesn't wipe the
  new colony. `goRegion` now always names the region: it used to drop `region` for Touchdown, and with no region
  in the address the game opens the saved colony's region, so with a save elsewhere Touchdown couldn't be
  picked.
- The only reloads left are loading a different world (NEW GAME elsewhere, CONTINUE into another region's
  colony) and leaving for the title screen from a game.
- Tests: `tools/look-smoke.mjs` (14 checks: no reload, ground rebuilt smooth and textured, plants shaded with
  normals, one ground mesh, fog carried over, a building pad still level, the ground still picks, back to
  flat, remembered on the next visit). `tools/region-smoke.mjs` now checks that picking a region doesn't
  reload and that NEW GAME lands in Touchdown with a save in another region.

### Factions and the climax

STORY.md §13–17. What Act 2 and the climax need in play: other powers on a region (Kindred's colony, Engram's works,
the Lantern's sentinels), the Lantern's strikes, the Clause's interference and the endings.

- **Factions** (region `factions`: `id`, `name`, `color`, `team` 2–7, `attitude` neutral | hostile | allied, optional
  `flag` that turns it hostile and `allyFlag` that turns it allied, each once): `SimState.factions` (`FactionState`),
  set up by `initFactions` in a new game (or on loading a save from before the region had them). **Outposts** (region
  `outposts`: building `kind`, `x`, `z`, `yaw`, `faction`, optional `story` flag set when it is destroyed) are
  prebuilt, finished, powered buildings of that team (they need no power and run no economy). **Encounters** gain
  `faction`: their units (Accord-pattern: Rovers, Tanks…) are `Unit`s of the faction's team instead of wild hostiles;
  guards hold their spot, a patrol walks to the far end and back (`Unit.patrol`), attackers make for our Core; their
  `doneFlag` is set when the last dies (`Unit.enc`).
- **In the sim** the campaign uses the skirmish's team machinery when `teamsOn` (factions present): the colony's own
  steps (power, drones, factories, research, mining, repair pads, relics, waves, frontier, cryo, people, planet,
  inhabitants, story, encounters, missions, fog, and every command) run inside `withTeam(0)`, so they see only our
  things; turrets, units, shields, hostiles and nests are one fight for everyone. `withTeam` swaps power and fog only
  in a skirmish. `attitude(t)` is how team `t` stands with us; `allied(a, b)`: us and allied factions together, the
  hostile ones together; `enemies(a, b)`: neither neutral and not allied. `foes(t)`: the wildlife (only for us and
  our allies) plus every enemy team's units, drones and buildings. Predators go only for ours and our allies' (`prey`).
  Campaign factions keep no fog (`visibleTo` is true for them). A faction's building destroyed is not our loss: the
  log names whose it was and its `story` flag is set. Without factions every path is the one before (`balance.mjs`,
  all strategies, output byte-identical).
- **Neutral** factions don't fight and nothing of ours picks them. The player's attack order (`{ type: 'attack', ids,
  target }`; in the game, a tap with units selected on a faction's unit or building, `factionAt` in `main.ts`) turns a
  neutral faction hostile and sets `<id>-attacked`; an allied one refuses ("… are on our side"). `setAttitude` logs
  every turn ("Kindred: hostile", "…: allied. They fight beside us.").
- **Drawn** in the faction's colour: the army view's team colours (`factionColors`), building and drone rings and
  glow (`teamColor` in `world/region.ts`), the minimap. Theirs show in sight, their buildings once seen (as in a
  skirmish). The snapshot carries `factions`.
- **Effects**: `attitude` (Faction, Attitude). `strike` (Site, or a random one of our Buildings of a kind, or any of
  ours; Amount default 400, Radius default 10, Delay default 6 s): `StoryState.strikes` until it lands, a log line
  with the alarm; then `Sim.orbitalStrike`: the fullest shield dome over the point soaks what it can (and may
  collapse), the rest hits our buildings, units, drones and any predators within the radius (all of it in the inner
  half, down to 30% at the edge), with explosions (`struck.n` counts landings). `corrupt` (Count, Unit): our combat
  units join the Clause's team 1 (a faction `clause`, hostile, `#c13cff`) and make for the Core; the log says
  "<unit> no longer answers." in the Clause's style. `glitch` (Glitch: `log` with the Text, `screen`, `turret`, `pod`
  with Seconds, default 8) adds 1 to counter `clause`; a turret faces the nearest Civilian Center (or the Core) for two
  seconds, holding fire (`Building.slew`); pods stop growing, without harm (`StoryState.podPause`). `epilogue`
  (Ending: covenant, severance, inheritance, proof, cycle; Pages: title, text with `{first}`; Text: the end screen's
  line): `StoryState.epilogue` with a summary (sol, colonists alive, the remembered, planet health, allies: allied
  factions and camps that trust us), then `Sim.end` (`won`, or `story` for Cycle). An effect's Text is now required by
  a content check (`TEXT_NEEDED`: log, countdown, waypoint, hint, win, fail, boost) rather than the schema, so a glitch
  or an epilogue can do without.
- **Conditions**: `faction` (the Faction has the Attitude), `factionLost` (none of its buildings stand), `partners`
  (Count Partner adults), `majority` (the Stance is the largest group of adults; ties count). An outpost lost is its
  `story` flag (a `flag` condition).
- **On screen** (`src/climax-view.ts`): a warning ring on the ground per strike (a terrain-following strip, pulsing
  faster as it comes), then a white beam from the sky that narrows over a second, a flash, and a scorch that fades
  after 40–60 s; no lights (adding one recompiles every material). A screen glitch tears the view for a second (CSS on
  the canvas and an overlay of bars; `glitch.tears` counts them). Clause log lines (events carry `style: 'clause'` from
  `emit` through the worker) are monospaced and cold, scrambled for a moment before they settle. The epilogue's pages
  show full screen over the darkened world, one at a time (Next, then "The end"), before the end screen, which shows
  the ending's name and the run in numbers. Endings reached are kept per browser (`exo.endings`); the title shows
  "ENDINGS: n OF 5" once there is one.
- **Editor**: the map editor's **Add outpost (O)** (a block with a mast, listed under Outposts); the region's
  `factions` list is edited on the record. Effect summaries and condition text read every new kind (`flow.ts`); Story
  flow counts glitches as changing `clause` and doesn't report `<faction>-attacked` or outposts' flags as missing.
  **Content checks**: unique faction ids and teams (not `clause`), different hostile and allied flags; outposts name a
  faction of the region and aren't a Command Core; a faction's encounter uses Accord units and names a faction of the
  region (a wild encounter still can't use Accord units); attitude effects and faction conditions name a faction some
  region (or the event's region) has; a strike's site exists, not both a site and a building, not a wall; only Accord
  units are corrupted; a log glitch needs its Text; an epilogue needs its Ending, and pages need text; `faction` needs
  an Attitude, `majority` a Stance.
- **Test**: `tools/climax-smoke.mjs` (headless with the sim, `--headless-only`; the browser half against a dev server,
  `--url`): a neutral faction and our units side by side for 10 s untouched; the attack order turns it hostile with
  its flag, both sides fight, an outpost destroyed sets its flag and isn't our loss, `factionLost`; a hostile faction's
  turret and our units fight unbidden; an allied band kills swarmers; flags turn factions; save / load; a strike hits
  only after its delay, an open turret loses 600, one under a charged dome nothing; strike by building kind; corrupt
  turns 2 of 3 rovers, logs in the Clause's style, they fight us; each glitch counts, a turret turns and turns back,
  pods pause; partners and majority (ties); the epilogue ends the game with its ending, pages and summary, Cycle as a
  loss; a region without factions has none. In the browser: the strike's ring and beam, the Clause's monospaced line,
  the screen tear, the epilogue's pages and end screen, the title's count, no page errors.
- Not yet: factions have no economy or AI beyond guarding, patrolling and attacking (no building, no waves); allied
  factions can't be commanded; nothing in content uses any of this yet (the Act 2 regions and the climax missions are
  still to be written).
### Campaign travel

The story plays across many regions and bodies (STORY.md §13). The home colony (Touchdown,
`HOME_REGION` in `src/sim/campaign.ts`) always persists; every other region is an **expedition**.

- **Saves.** Each region's colony is its own IndexedDB record, `region:<id>` (`regionKey` in `src/save.ts`),
  written by the sim worker every 10 s and when the page hides. Beside them is one **campaign record**,
  `campaign`: `{ version: 1, savedAt, current, shared }`, written with every autosave (current = the region
  being played). The old single autosave `auto` is migrated once at startup (`migrateAutosave`): it becomes
  its region's save, that region becomes current, and `auto` is deleted (`tools/region-smoke.mjs` now reads
  `region:touchdown`). An expedition lost deletes its save and sends the campaign home (the end screen's
  button reads "Back to Touchdown"); the home colony lost, or a win, deletes the campaign record.
  NEW GAME (title, `?new=1`, `?land=1`) wipes every region's save and the campaign (`wipeCampaign`; manual Save
  slots stay). The in-game New game starts the campaign over at home (from an expedition it goes home and lands).
  `?scratch=1`, `?preview=1` and skirmish never read or write any of it.
- **Shared vs per region** (`sharedOf` / `applyShared`). Shared, campaign-wide: story flags, counters, events
  fired and answered, cinematics played (`cines`), countdowns that have run out (`expired`), build-menu locks,
  HUD panels opened, events waiting for their region (`away`); every mission (active, done, failed, objective
  marks); research done; `SimState.campaign` (`visited`, `routes`, and `first`, the Firstborn's name, so
  `{first}` works where there are no colonists). Per region (its own save): buildings, units, drones, alloys,
  isotopes, map, fog, clock, people, planet health, inhabitants, the Chronicle, the card inbox, event delays,
  countdowns still running, waypoints, the hint, camera moves, encounters, the cinematic queue, colony boosts,
  dilemma timing, cards' cast, the research under way at this region's lab, `placed`. Loading a region: its
  save if it has one, with the campaign's shared state laid over it when the campaign record is newer than the
  save (you've been elsewhere since); otherwise a fresh game there with the shared state (the worker's `init`
  message carries `shared`). Time in a region doesn't move while you're away: its save just waits.
- **Effects** (`STORY_EFFECTS`): `travel` (Region: sets `SimState.travel`; the snapshot carries it as
  `campaign.travel` and the renderer saves and goes, once no cinematic or title is in the way), `route` (adds
  to `campaign.routes`, logged "New route: <name>"), `unroute`. **Conditions**: `here` and `visited`, with the
  region in the field `place` (a story event's own `region` field already means "only in region", so the
  condition can't reuse that name).
- **Regions in the story.** A story event with a `region` only triggers while that region is played; fired by
  an effect or a mission elsewhere, it goes to `StoryState.away` and fires on arrival there (the same for a
  cinematic with a region: `cine:<id>`). A mission with a region starts once its `after` is done **and** its
  region is being played, visited or on the routes; it then stays under way everywhere (GOALS shows
  "TITLE · REGION" and its objectives greyed), but its objectives and fail conditions are only checked in its
  region.
- **Expeditions.** A region's `expedition` (a list of at most one package, since the schema has no object
  field: `alloys`, `isotopes`, `drones`, `units` [{unit, count}], `people`, `landing`) is applied on a fresh
  game there (`Sim.expedition`). Without `people` the state has `expedition: true`: no cryo bank draw, no cryo
  or people step (so no "cryo bank drained" or "no one left" loss), an empty bank; the HUD hides cryo, food,
  people and mood (`body.expedition`) and the Core's cryo row. `landing` defaults to `none`: it starts deployed
  (`probe` plays the landing cinematic). A region with no `expedition` still plays standalone as before.
- **Launch Gantry** (`content/buildings/launch-gantry.json`, role `launch`, needs research `orbital-launch`:
  economy, after Isotope Cells, 220 ◆ 40 ◇). Built-in model `buildLaunchGantry` in `src/world/region.ts`: a
  lattice tower, service arms and a shuttle on its pad. Its card (LAUNCH) lists the routes on other bodies.
  The Command Core's card (TRAVEL) lists overland routes (same body) and says how many need a gantry; on an
  expedition the Core offers "Return to Touchdown" and every route. Each button asks twice ("Sure? Go to …").
- **Transition** (`travelTo` in `src/main.ts`): the worker saves this region and writes the campaign record
  with the new current region (`{ type: 'travel', to }` → `travelled`; autosave stops first so nothing races
  it); meanwhile the camera pulls out (planet view overland, system view off-world) under a fade with
  "Leaving <region> · <body>", then "<Body> · <Region>", then `?region=<id>&travel=1` (dropping `new`, `land`,
  `intro` and the like). `travel=1` skips the title and is taken out of the address (`history.replaceState`);
  the arrival shows the caption over black and fades in. Each region remembers its own camera
  (`exo.camera.<id>`; Touchdown keeps `exo.camera`). A play test can't travel (logged, request dropped).
- **Title.** CONTINUE goes to the campaign's current region (its save, or a pending expedition with no save
  yet); if that region's colony is gone, home. `?region=<id>` still picks a region; CONTINUE then offers the
  current region's colony as before.
- **Inspector**: a Campaign section (here, visited, routes with ×, Route and Travel per region).
- **Playthroughs** (`src/sim/playthrough.ts`) stay in one sim: `sim.everywhere` makes every region count as
  here (each record's conditions read its own region's story sites, which the bot walks to on this map), and a
  `travel` effect becomes a `travel` beat (the region marked visited). Expedition packages and other maps are
  not played: a limitation.
- Tests: `tools/travel-smoke.mjs` (headless: routes, travel, here / visited, events and missions set
  elsewhere, shared state over a fresh expedition and back, the expedition package and no cryo loss, an older
  save, the playthrough's travel beat; browser, with two temporary regions: a fresh campaign, routes from the
  inspector, the Core's and the gantry's lists, travel and its captions, the package and flags on arrival, the
  saves in IndexedDB, CONTINUE to the current region, home by the Core's card with the colony and clock as they
  were, out again to the expedition's own save). `--headless-only` skips the browser.

### Story engine, round three

Gaps the campaign's writers found (STORY.md Part II). Test: `tools/story-gaps-smoke.mjs` (headless with the
sim, `--headless-only`; the browser half writes a temporary cinematic to content/cinematics and plays it
against a dev server, `--url`, default :5183).

- **The Core lost as a story beat.** Condition `coreLost` (our Command Core has fallen; usable in mission
  `fails`, alone or in an `all` / `any` group, and as a trigger). When the Core is destroyed
  (`destroyBuilding` → `Missions.coreLost()`), every mission under way **in this region** whose fail
  conditions name `coreLost` and hold now fails at once, normally (log, `onFail` event, `failEnds`), and the
  generic "Command Core has fallen" defeat is skipped: the `onFail` event plays the ending (`epilogue`,
  e.g. Cycle). A group that names coreLost but isn't met (`all: [coreLost, flag x]` without x), no such
  mission, or one set in another region: the defeat as before. If the story doesn't end the game, play goes
  on without a Core (checked for a minute: no crash).
- **A lost expedition, retried.** When an expedition is lost (its save deleted, the campaign sent home: the
  worker's autosave), the shared state written goes through `forgetRegion` (`src/sim/campaign.ts`):
  events and cinematics whose `region` is that region leave `fired`, `answered`, `cines` and `away`;
  missions set there that were under way or failed are under way again with no objectives met; missions
  done there stay done; flags, counters and everything else stay as they are (a flag set there stays set:
  write retry-safe flags). (An epilogue ending the game on an expedition, e.g. Cycle at the Lantern, is a
  loss there too, so its region is forgotten the same way.)
- **The home snapshot.** `CampaignInfo.home` (`HomeStats` in `types.ts`, shared with the campaign state),
  refreshed once a second while Touchdown is played (`Sim.recordHome`): `planet` (health), `acceptance`
  (adults' average, null with none), `autonomists` / `partners` / `devoted` (adults), `colonists` (alive),
  `deaths` (not those who left), `sols`, and `groups` (per inhabitant group at home: `regard` the best of its
  camps still there, `low` the lowest among those met, `met`, `trusted`). On an expedition (`s.expedition`:
  no colonists) the people conditions `colonists`, `deaths`, `acceptance`, `distrust`, `autonomists`,
  `devoted`, `partners`, `majority` read it (false with no snapshot yet); `contact`, `trust`, `regard`,
  `regardBelow` for a group with no camp on this region read it anywhere. New condition `homePlanet`
  (home planet health ≥ Count: live at home, the snapshot elsewhere). The `epilogue`'s summary away from
  home is the home colony's (colonists, planet, deaths, sols; allies add the groups that trust us at home).
- **Choices by flag.** A story choice's `ifFlag` (offered only while it is set) and `unlessFlag` (not while
  it is set); `shownChoices(ev, flags)` (`content/defs.ts`) gives the indices offered, into the full list,
  so effects keep `after` = the choice's place in the full list. The card (`contact-card.ts`) shows only
  those (none offered: Continue); the sim refuses a hidden one (the card stays) and answers a card with none
  on offer like a Continue; the playthrough bot picks among those offered. Editor: the card preview marks
  them ("(if keeper-song)"), the summary says so, Story flow counts `ifFlag` as waiting on the flag and
  `unlessFlag` as blocked by it. Check: the same flag for both.
- **Effects.** `mission` (Mission): starts it now unless under way or done (its `after` ignored; a failed one
  starts again); set in another region it is under way there (greyed here), as any. `outpost` (Outcome:
  `destroy` | `disable` | `capture`; which: all of the `faction`'s buildings, those within `radius` (default the
  site's own) of the `site`, and / or the one whose story flag is `story`; at least one of the three):
  destroy is as if we had destroyed them (their flags set, not our loss); disable leaves them standing with
  `Building.off` (turrets skip them, unpowered: no shooting, no working; "… goes dark"); capture makes them
  ours (team 0, our grid; "… ours now"). Works from inside the colony's own view (`withTeam`). Checks: name
  something, a faction some region has, an outpost with that story flag.
- **Small ones.** The Autonomist walkout (`people.ts`) sets flag `walkout` (Story flow counts it as the
  game's). Condition `night`: the sun down at the region's site (`daylight < 0.3`, as the packs' night).
  Playthroughs: `sim.everywhere` counts every region as here for maps and checks, but a mission set in
  another region now starts only once that region is routed or visited, as in the game (so `wrong-address`
  waits for `heights-route`); the old rule is the option `anywhere` (`--anywhere` on `tools/playthrough.mjs`;
  `Sim.everywhereStarts`), whose output matches the run before byte for byte. `tools/chronicle-smoke.mjs` and
  `tools/opening-smoke.mjs` drive the bot with `anywhere: true` (they measure the colony over a long run, not the
  campaign's routes; the chronicle's 55-minute run otherwise ends with one colonist left).
- **Cinematics.** `hour` (0–24): the sky (sun, light, stars) shows that hour of the current sol while it
  plays (main.ts' frame picks the sun's clock from it); the game's own comes back after (`__exo.skyHour()`).
  `music`: a piece from content/music by id, or `day` / `night` / `tension` / `title` (one of those):
  `GameAudio.holdMusic` plays it and the director stands aside until `releaseMusic` at the end (also for
  the landing). Camera key target `body` (field `body`, a body id; X, Z and Lift are where the camera
  stands): it looks from there toward the body's place in the sky (`SolarSystem.bodyPos`), the focus
  Distance (≤ 2000) ahead, pitch and yaw worked out (yaw unwrapped to the key before). The editor's preview
  has no sky, so it shows such a key with its own pitch and yaw. Checks: hour 0–24, music a piece or a use,
  a body key needs its Body.

### The campaign (content)

STORY.md Part II, as built: 27 missions, ~245 story events, 35 cinematics, regions on 13 bodies, played as one
campaign. Test: `tools/campaign-smoke.mjs` (headless, ~15 s).

**The map and the mission chain** (each mission's `after`; one on another region starts once that region is
routed or visited):

| Chapter | Regions (body) | Missions | Opens |
|---|---|---|---|
| Tutorials | `touchdown` (Home) | touchdown → groundwork → first-night → firstborn → beyond-the-ridge | routes to the four Act 1 regions |
| Act 1 | `hearthsmoke`, `choir-field`, `burrow-reach`, `splinter-hollow` (Home) | smoke-on-the-horizon, the-choir, designer-marks, the-hollow (any order; each +1 `act1-trips`) | 3 trips: `heights-route` (Signal Heights); the cellar: the Deep Layer |
| Act 1 | `deep-layer` (optional), `signal-heights` (Home) | deep-layer; wrong-address → signal | `act1-done`, research Orbital Launch |
| first-light | `touchdown`, `sela-relay` (Sela) | build-gantry → first-light | Verdance, Talus, Ash |
| kindred | `verdance-landfall` (Verdance), `dunmore-dustfall` (Dunmore) | landfall → dustfall | `kindred-ally`; Bede's failsafe at home |
| engram | `talus-yard` (Talus), `maren-works` (Maren), `iot-drops` (Io-T), `pip-wreck` (Pip, optional), `rime-prime` (Rime) | yard → the-works → drop-field; yard → pip-wreck; drop-field → prime (Rime routed by `rime-route`: `luck-proved` + `ledger-read`) | `engram-defected` / `-doubled` / `-destroyed` |
| the-proof | `ash-hulls` (Ash), `vess-ledger` (Vess) | hull-field → the-ledger | `ledger-read` |
| the-foundry | `cinder-foundry` (Cinder), `teth-ear` (Teth, optional) | foundry → long-ear | `foundry-found`; `long-ear` |
| the-lantern | `touchdown`, `lantern` (Sela's far side) | clause-wakes → the-lantern | an ending |

**Threads gate the Foundry.** Three threads end in dustfall (Kindred), drop-field (Engram) and the-ledger (the
Proof). At home, the second one done fires one of `foundry-lead-kd` / `-kl` / `-dl` (each needs its two and
neither other lead), which routes Cinder; the third fires nothing more. `foundry` itself only follows
`first-light`.

**The climax.** `clause-wakes` (home) starts after the Foundry; `meridian-speaks` (cine-meridian) waits for
counter `lead` ≥ 6 (STORY.md §14 for its sources; `clause-patience` adds 6 a day after the Foundry, so it
always comes). `trust-decides` then reads the colony: `severance-failsafe` (`failsafe-built` and acceptance
≤ 45) or `severance-vote` (an Autonomist majority) right away → **Severance**; after a 6 s countdown
`trust-devoted` (a Devoted majority: obey → **Inheritance**, refuse → the fight) or `trust-partners` (the fight).
The fight: `hold-the-line` and `strike-1`…`13` (strikes, turned units, two packs, a screen tear) over the
`strike-force` countdown (600 s), the allies at home by flag (Kindred marines land at the Core yard, site
`core-yard` (12, 10); Engram's shields, the Vell's warning, the Choir's turrets); `proof-ready` (the Archivist's
drive) if the Proof looks possible. Losing the cryo bank (< 10) or the Command Core (`coreLost`) after Meridian
speaks fails `clause-wakes` → **Cycle**. Held: `strike-force-lifts` routes and travels to the Lantern. There
`lantern-landing` starts a 1500 s countdown (`lantern-fires`) and the strikes; the Lid opens by the Enclave's code
(`survivors-met`) or by breaking its relic grid; allies by flag (Kindred lancers, the Vell reveal the core, the
Choir quiets the breach battery, Engram turns allied, or purges with us if it doubled down); `proof-weighed`
weighs the Proof once the Lid is open; at the core, `the-core`: destroy (→ `covenant`, or `covenant-sol` with
`long-ear`), seize intact (→ `proof` with `proof-holds`, else `covenant-seized`), give in (→ `inheritance`). The
countdown running out or the landing's Core lost fails `the-lantern` → **Cycle**.

**Endings and their conditions** (each event's effects play its end cinematic, then the `epilogue`):

| Ending | Event(s) | Reached by |
|---|---|---|
| Covenant | `covenant`, `covenant-sol`, `covenant-seized` | the Lantern destroyed (without / with `long-ear`), or seized without `proof-holds` |
| Proof | `proof` | seized with `proof-holds`: home planet ≥ 70 and acceptance ≥ 60 (the home snapshot), `kindred-ally`, `keeper-song`, `choir-fragment`, `ledger-read`, `long-ear`, not `engram-destroyed` |
| Severance | `severance` (from `severance-failsafe` / `-vote`) | the failsafe built and acceptance ≤ 45, or an Autonomist majority, when Trust decides |
| Inheritance | `inheritance` (flag `inheritance`, any region) | obey with a Devoted majority, or give in at the core |
| Cycle | `cycle` (`onFail` of both climax missions) | the colony's Core or cryo bank lost in the fight; the Lantern's countdown or the landing's Core |

`proof` and `covenant-seized` read `proof-holds` as opposites, and the core's three choices set three different
flags, so exactly one ending fires. The Proof needs one gate event because a trigger takes at most 8 conditions
with no nested groups.

**Engine fixes that came with it.** An ending reached anywhere ends the campaign (`campaignOver` in
`src/sim/campaign.ts`: an epilogue, the home colony lost or a win is `ended`, and the worker wipes every region's
save and the campaign record; only an expedition lost without an ending is `expedition-lost`, forgotten and sent
home). So Cycle at the Lantern is an ending, not a retry: its end screen shows the ending and "New game" (which
from an expedition goes home and starts over). `reveal` marks the factions' buildings in the revealed ground as
seen, and a cinematic about to play marks those its camera keys look at (round each key's point, as far as its
distance, at least 40 u: `Sim.seeForCinematic`), so arrival cinematics show Kindred's colony and Engram's works.
A story `pack` while waves are held off (a peaceful play test or playthrough) sends one pack and keeps them held
(`waves.held`); before, it restarted the wave clock for good. `?mission=<id>` (the inspector's mission jump) for a mission on another region routes it and travels there to
play it (before, it stayed greyed at home). The Endings ledger counts each glitch as +1 on
counter `clause` (it reported `clause-found-out`'s threshold as unreachable). Cinematics with `hour` and `music`:
cine-signal and cine-meridian at night (cine-meridian looks up at Sela with a `body` key), cine-ledger,
cine-foundry, cine-marrow and every ending with their own piece.

**The test** (`tools/campaign-smoke.mjs`): first the content's own consistency (Story flow problems, missions
out of the chain, unreachable ledger thresholds, expedition regions nothing routes); then the campaign played
from a fresh Touchdown through every region in order, each region its own Sim, its colony kept as a structured
clone (its save), the shared state carried as the game carries it (`sharedOf` / `applyShared` over the save or a
fresh game, `arrived`, the landing deployed), cards answered by a policy (otherwise the first choice offered),
cinematics done at once. It checks each mission under way on arrival and done, the arrival cinematics, the
handoffs (three trips → Signal Heights; act1-done → act2-open, build-gantry; first-light's three routes; two
threads → one Foundry lead; ledger-read + luck-proved → Rime; foundry → clause-wakes, lead reaching 6), then forks
the campaign back from Cinder (A: no Long Ear) and after Teth (B) and plays each ending by its choices: Covenant
(destroy; seized), Covenant via the Long Ear, Proof (and not with acceptance 50 at home), Severance (the failsafe;
the vote), Inheritance (obey; give in), Cycle (the Core lost at home; the landing's Core lost at the Lantern),
each with its epilogue, its end cinematic and `campaignOver` = `ended`. It prints the endings matrix and every
forced step: tutorial buildings by the play-test setup, first-night and firstborn finished by the inspector, 12
colonists decanted and aged; home waves held off; units teleported to story sites on most expeditions (Ash,
Cinder, Teth and the Lantern are walked by orders), objective buildings set up, the Vell's regard, the Choir
wall's flag, a guard for Dunmore's escort, the Launch Gantry; the colony's stance before Trust decides; the fight
itself is played with real rebuild orders and no forced army or domes; Cycle's Cores destroyed by the inspector.

**Known limitations.**
- **Climax balance** (`tools/climax-balance.mjs`, headless: a Sol ~11 colony from the balance bot's `opening`
  strategy at a human pace, a simple defender that rebuilds and dodges strike rings; `--allies`, `--shield`,
  `--waves`, `--no-defender`, `--lantern`): the fight at home holds in 5 of 5 seeds in every setup, losing about a
  third of the buildings (19 strikes of 350 with 12 s warning, radius 7 on power and 8 elsewhere; 6 units turned). It
  is on the safe side (cryo rarely below 60): strike damage ~400 or radius 9 is the next notch. The Lantern is won
  with its expedition package by the Enclave's code (core in ~80 s; the gunships fly straight in) or by breaking the
  locks (~150–280 s), with or without allies, inside the 1,500 s countdown.
- The playthrough bot (`tools/playthrough.mjs --peaceful --minutes 40`) plays one map: it gets through the
  tutorials, Beyond the Ridge (34–38 min) and The Hollow, starts four Act 1 expeditions it can't finish there,
  and never travels, so nothing from Signal onwards starts (routes need the regions visited).
- No variant events were merged with `ifFlag` / `unlessFlag`: every pair differs in its text or lines (the
  Lid / the door, the comet with or without the Vell, Covenant with or without the Long Ear), which choices by
  flag can't vary.
- The Vell's and the Choir's trust in the Proof are flags from their Act 1 expeditions, not the regard of camps
  at home.

### Story presentation (v0.83.0 on)

The story review of 2026-11-25 found the campaign read as "a bunch of text": payoffs lost in the log, no faces,
key radio gone in seconds. Each release below is one fix.

- **The reply stays on the card (v0.83.0).** Answering a story card with a choice whose `reply` isn't empty no
  longer closes the card: `ContactCard` keeps `reply` (the title, the chosen label as `› label`, the reply) until
  **Continue** (`data-reply`), then closes and shows the next card. A pausing event stays paused until then. The
  reply still goes to the log (`story.ts`). A choice with no reply (the endings' choices) closes at once, as
  before; a cinematic started by the choice (`cl.cine`) drops the card's copy, since the cinematic plays it out.

- **Portraits (v0.84.0).** Every character in content/characters has a `portrait` (an image asset
  `portrait-<id>`, 192 px PNG in public/media/image). The sources are SVGs in `tools/portraits/<id>.svg`, drawn
  flat over a glow in the character's colour; `node tools/portraits.mjs [id…] [--sheet out.png]` renders them (and a
  contact sheet). The story card shows its portrait at 56 px, the radio panel at 38 px. Meridian's is the
  caretaker's glyph gone pale and eclipsed, the Clause's the same glyph torn; `caretaker.svg` is the player's own
  glyph (used from v0.88.0).

- **Story radio that waits (v0.85.0).** Story field `hold` (radio only): the corner panel stays until tapped ("tap
  to close") instead of timing out. A radio event with `pause` comes as a card instead (marked Radio), pauses, and
  counts as a card everywhere a radio message doesn't (the dilemma gap in `story.ts`, the guide's free time in
  main.ts). Pausing: ENGRAM's first words, its answers (cache, luck), Rime's invitation, Kindred allied / wary /
  fired on / the scouts home, the Heights' bearing, the Proof's gate. Held: the landings' briefings, the survey
  notes, ENGRAM's asides. The fight's chatter (strikes, the Lantern) still times out.

- **The camera goes to the find (v0.86.0).** When a story card first shows (`ContactCard.lookAtFind`), if its trigger
  is a story site (`site` or `explored`, alone or in an `all` / `any` group, not negated) on this region
  (`regionDef.sites`, passed down through ColonyHud's `sites`), the camera glides there (`ZoomCamera.glideTo`; a pan
  cancels it). Once per card per page load.

- **The reveal, rationed (v0.87.0).** Content only (STORY.md §19 "Who knows what, when"). Act 1 keeps the
  caretaker's part open: the code wall is redacted (no "YOU HAVE FOUND THE CLAUSE", no "closed from within", its
  second choice asks what it closes: "PERMISSION REQUIRED… YET"); the Deep Layer's log is damaged (no "Directive
  active", no "Run closed"); Firmware Archaeology finds a block marked *reserved*, not a dormant routine; Sefa
  (`the-enclave`) tells what her people saw, not why. Her full account is `enclave-second-track`: at home, 60 s
  after `clause-5` (the Ledger laid beside our logs), with `survivors-met`; sets `clause-named`.

- **The private log (v0.88.0).** Character `caretaker` ("Private log", the player's own glyph), 18 events
  `content/story/log-*.json`: radio with `hold`, first person, on milestones from Sol 1 to Meridian (the first
  colonist, the name, a birth, a death, a high report, the stone, the song, the moon, Marrow, the margin field, the
  hulls, the Ledger, the Director's booth, the Clause overwriting an entry, telling the truth, Meridian's voice).
  Content only.

- **A score to chase (v0.89.0).** `src/sim/grade.ts`: the Biosphere Report's grade (A ≥ 75, B ≥ 60, C ≥ 45,
  D ≥ 30, E); *good* is B or better, the same line `report-lead-*` reads as a high report, so the reports the Director
  praises are the ones that feed the Clause. The report's log line has the grade, "best yet" and the run of good
  reports; the top bar shows the last grade beside planet health. At home only: flag `report-good` (the first good
  report) and counter `report-streak` (good reports running; a bad one resets it), declared as the game's in
  `REPORT_FLAGS` / `REPORT_COUNTERS` for the editor's Story flow and Endings ledger. Events `director-commendation`
  (the first good report) and `director-streak` (five running), paid off in `director-three`: their tapes are on the
  booth's shelf, recorded before any report was sent.

- **Someone along, and the news at home (v0.90.0).** Unit `envoy` (Crew Rover: the first colonist aboard, the
  rover's model at 1.2) is first in every expedition kit but the Lantern's. Unit field `lostFlag`: losing one of
  ours sets that story flag (`destroyUnit` in core.ts; the editor's Story flow and campaign-smoke count it as the
  game's). The Crew Rover's is `crew-hurt`: `crew-hurt` (any region: the medevac pod fired) and `crew-home` (at
  Touchdown). `open-planet` now has the Firstborn ride along. Six home reactions by name (`cast`), 75 s after a
  discovery's mission: `home-vell`, `home-choir`, `home-burrows`, `home-berth`, `home-graded`, `home-tape`.

- **Consequences said aloud (v0.91.0).** Marrow at Dunmore names the hall (`marrow-remembers-honest` /
  `-tidy`, on `kindred-honest` / `kindred-withheld`). On Rime, before the choice, ENGRAM reads its notes: the counter
  `engram` as kind (≥ 3), careful (1–2) or hard (≤ 0) (`engram-notes-*`), then the choices it remembers
  (`genomes-copied`, `luck-told`, `luck-kept`, `scouts-forced`). At home after the Foundry, the colony says which bloc
  would carry a vote tonight (`lean-autonomist` / `-devoted` / `-partners`, once: `lean-told`), and `meridian-speaks`
  now waits for `lean-told`, so the lean always comes before Trust decides.

- **Expeditions end in their own words (v0.92.0).** The 17 `*-done` cards (each expedition mission's `onDone`)
  have their own titles instead of "Expedition Complete", choices **Head home** / **Stay a while**, and a short
  stay reply of the place's own; the "the Command Core can take us home" line is gone (the guide's Goals and
  missions and Expeditions pages say it once). Content only.

- **A pause sends the latest state (v0.92.1).** The sim worker posts a snapshot when the speed goes to 0. Before,
  a command handled between two ticks (a story card answered just as another card paused the game) stayed out of
  the main thread's snapshot until play resumed: the answered card was still in `story.inbox` there.
  `tools/story-smoke.mjs` now waits for the inbox to drop the answered card and accepts the next card in its place.

- **The editor's version (v0.93.0).** The editor's header shows `v<VERSION>` beside its name, and checks for a newer
  release like the title screen does (`newVersionReady('editor.html')` in `src/pwa.ts` now takes the page to compare,
  since the editor's entry script differs from the game's): on load, every 10 minutes and when the tab comes back, it
  offers **↻ Newer version: reload** (the editor's beforeunload guard still protects unsaved edits). Why: the editor
  reads content live from GitHub but runs the code it was loaded with, so an old tab flagged v0.85.0's `hold` as an
  unknown field.

- **Markers behind a planet (v0.93.3).** The system's body markers (the rings round moons and planets) draw without
  depth so they stay findable, which drew them straight through a planet in front. `SolarSystem.inSight` fades a
  marker as its body goes behind any planet or moon between it and the camera (the globe being played at its drawn
  size R), eased over the edge (0.98–1.04 r), the same sphere test as the lens flare's.

### Autopilot (spectator mode)

The computer plays the campaign in the real game while you watch, for testing the story (v0.72.0).

- **Start / stop.** Title → OPTIONS → *Autopilot: the computer plays your campaign*: **Watch the computer play**
  (CONTINUE with the autopilot, or a new campaign when there is nothing to continue; the row says which: it plays
  *your* colony and saves as normal play does), and its settings: how it answers (first, honest, random, last),
  **Assist when stuck**, speed ×1/×2/×3. In the game: the **AUTOPILOT** badge (top right, violet) with ×1/×2/×3,
  ASSIST and **■ Stop**, which hands control back at once; the game menu's **Autopilot** turns it on or off. No URL
  options: the state is in localStorage (`exo.autopilot`: on, policy, assist, assistMinutes, speed). It starts on
  only when it was left on *and* the load carries its game on (a travel arrival, a landing elsewhere or a CONTINUE
  in another region it started: `travel=1`, `land=1`, `title=0`); a plain visit shows the title with it off. Never
  in a skirmish, a play test (`?preview=1`) or a scratch game (`apAllowed` in `main.ts`). Your own commands work
  alongside it; it doesn't ask.
- **The brain** (`src/sim/autopilot.ts`, in the sim worker; `{ type: 'pilot', cfg }` turns it on, the worker
  steps `Autopilot.tick()` before every `sim.step()` inside `withTeam(0)`). It reuses the headless bots:
  `BalanceBot` (`src/sim/balance.ts`: `runBalance`'s per-tick plan, people plan, growth pods and army as a class;
  `prune()` drops the plan steps a colony taken over already has) and the playthrough's `chase` (exported, with
  its command sink and an optional `go(x, z)`: the autopilot picks who walks to a site). `PilotBot` (a subclass)
  adds plan steps placed at a spot the autopilot chose (`[kind, 'at', x, z]`), waits for a step's isotopes instead
  of having the order refused, keeps back a `reserve` for a mission (steps not `exempt` wait; the exempt ones are
  moved up), places through the autopilot's search (`Sim.placeProblemAt`, the build order's own check, and clear of
  our units: a building put down round them boxed them in for good), and leaves the army to the autopilot (`army()`
  is a protected method of `BalanceBot`, a no-op here). At home the plan starts as the **fortress** strategy then
  farms and homes; on an expedition the **mixed** build. A plan step stuck at the front for a minute (an unreachable
  spot) is dropped, or sent to the back when it has waited 3 minutes for alloys. `chase` (unchanged for the
  playthrough): only missions set in the region being played; an `after` objective chases its event's trigger; a
  building that needs research researches first; research that costs isotopes puts a Deep-Core Mine on a seam first.
  Faction units and buildings are read with `Sim.othersInView()` (the colony's view holds only ours).
- **The colony** (`manage`, every 5 s, most urgent first):
  - *Power*: a sol and a half worked through ahead in 5 s steps (`powerNeed`: the sun by the clock, `daylight`;
    steady generation; the batteries as they stand; turrets at a quarter of their draw, factories and repair pads
    at 0.3, depots and printers left out as the sim leaves them; the cryo bank, drones and full growth pods, ×1.05).
    Short in the last night: a battery when the day makes enough, else generation: geothermal on a free vent (a
    relay toward one within 110 u), a Fusion Cell with isotopes coming in, solar. The step goes to the front.
  - *Drones* to one per depot or so; *depots* on every deposit it can reach, nearest first (the spot checked to mine
    *that* deposit; out of the build area, a Relay Tower at the reachable spot nearest it), while fewer than three
    rich deposits are worked, the guns are nearly enough or alloys pile up. The fortress plan's later depots are
    dropped for these.
  - *Home*: a Tech Lab once two depots and most of the guns stand (after 10 minutes or the third pack); Deep Survey
    as soon as it does, then a Deep-Core Mine on the nearest seam (two; one when isotopes are plentiful), urgent when
    a mission's isotopes are short; a farm ahead of the colonists and pods, homes as they fill; Matter Printers on
    steady power (a Fusion Cell for every two, up to three, fuelled from the seams), urgent once every deposit is
    below 300. A wreck is stripped by a Field Engineer. A repair pad once three units stand.
  - *Saving for a mission* (`needs`): what the missions here still need to research and build (the research chain
    from the first project that can start, the buildings not up yet), in alloys and isotopes. While it waits, the
    plan keeps back up to 320 alloys (its own steps, depots, labs, mines, printers and fusion exempt), and no new
    guns unless they are four short, no army, homes or research of its own.
  - *Research* when the lab is idle and no mission's research is waiting (`RESEARCH`: Deep Survey, Refined Drills,
    Hardened Plating, Isotope Cells, Tracking Arrays, Matter Compiler, Deep Cells, Fire Control, Seismic Listening,
    Orbital Launch, Shield Lattice, …), saving up for the next in line. *An expedition* builds a lab once it has
    420 alloys to spare and spends what it brought on Deep Survey → Isotope Cells → Orbital Launch, then the list
    (research is the campaign's: the Gantry's research is often done on an Act 1 expedition), and stays to see a
    project through (6 minutes at most).
  - *Defence* (`defence`): guns wanted at home 3 + ¾ per pack so far (at most 24; an expedition 2 + 0.4 per pack, at
    most 12): turret, siege cannon, point defence, cannon in turn, toward the spawns; past eight guns the army comes
    first until six units stand. A gun beside every outlying building (a far depot, a relay, geothermal; two by a
    Deep-Core Mine, which draws packs, and by the gantry). A Shield Projector by the Core once researched.
  - *Units* at the bay: at home none until the guns stand (they hold the colony), then eight (four or six while a
    fight for an objective is on); on an expedition six, or as many as it may for a fight (tank, lancer, rover, tank,
    artillery … whatever is researched), keeping 120 alloys back at home until eight guns stand.
- **The army** (`army`, every 3 s; combat units only):
  - *Mending*: a unit below 30% goes to the repair pad until it is 85% whole.
  - *Raids*: hostiles (awake, not nests; flyers only with anti-air of our own) within 40 u of our buildings: the group
    nearest the Core (not the middle between two), by the nearest idle units when they are strong enough, by everyone
    when it is at the Core.
  - *Objectives* (`objectiveFight` → `need`): first an *escort*: a faction's encounter whose death is a fail flag of a
    mission here (Dunmore's survey team) is followed every 6 s. Then each objective not met: a `flag` is traced back
    to what sets it, up to four steps: an encounter here with that `doneFlag` (its units, if their faction is
    hostile; not there yet: the flag that brings it), a relic grid (`relic-<grid>-opened`: its nodes), a hostile
    faction's outpost with that `story` flag (an attack order), a story event that sets it (its trigger: flags,
    sites, `after` events). A site with something awake within 26 u (36 u for a relic sentinel) is cleared first;
    asleep, a relic only scans us. A site where the one sent was lost on the way (`SimState.pilot.lost`, in the
    region's save) is walked by everyone. `kills`: the nearest predators. `factionLost`: a hostile faction's
    buildings. Several sites in one `all` objective (the Long Ear's plates) split the force between them. A neutral
    faction's encounter or outpost is never a target (an attack would set `<faction>-attacked`).
  - *A fight*: at home a third of the army (at least two) stays unless the fight is within 60 u. It gathers by the
    rally point (the repair pad, the bay, the Core) until it is 1.3× as strong as what stands there (√(hp × dps)
    summed), or 4 minutes have passed, or it is at its cap; then it moves in (an `attack` order for a building);
    worn below 35% with fewer than three, it pulls back to mend.
  - *Nest raids*: with nothing to fight for and no raid, five fit units go for the nearest standing nest (that side's
    packs stop until it grows back) and see it down.
  - *Walks*: a site with nothing in the way gets one unit (or a drone), posted there while it is asked for (so one
    standing on a plate isn't taken for the next); an idle unit far from the rally point comes back.
- **Travel.** Every 5 s: nothing while a card waits, a cinematic is queued, a pack fights at the colony (up to 2
  minutes), predators are within 45 u of the home Core (up to 6 minutes: we would come back to it falling, as time at
  home stands still while away) or in the first 90 s at home / 30 s on an expedition. If no mission here has moved
  for 5 minutes (twice that while a fight for one is being built up; 8 with the assist, so it steps in first) or none
  is under way here: from home, a mission under way in a region that is routed or visited and reachable (overland on
  this world; off it only with a finished Launch Gantry, which it rebuilds when one is researched and missions wait
  off-world): the story's own before an optional one (a summary starting "Optional."), and an optional one tried
  twice without getting anywhere (`CampaignInfo.pilotTrips`) only when there is nothing else; from an expedition,
  home (the Core's "Return to Touchdown"). It sets `SimState.travel` as a story `travel` effect does, and `main.ts`
  saves and goes through `travelTo` (the veil, the reload with `travel=1`).
- **Assist** (off by default; Options or the badge): an objective here with no progress for `assistMinutes`
  (6; twice that while a fight for it is being built up) is ticked off the inspector's way (`inspect` → objective),
  not clocks (`time`, `timer`); at home with missions waiting off-world and no gantry for as long, a Launch Gantry and
  its research chain are set up (`debug` setup); predators (not nests or relic guards) within 70 u of a Command Core
  below half its strength are sent away and the next pack held 4 min (every 45 s at most, 10 s below a quarter); a
  cryo bank below the safe level (50%: embryos start to die) is brought back to 75% (every 2 minutes at most). Each
  logs "Autopilot assist: …" in the log in violet (`LogStyle` `'assist'`, `.ev.assist`).
- **Readable** (`src/autopilot.ts`, `AutopilotView`). A story card (or a first contact: Approach; a trust story:
  Continue) stays for 2.5 s + 40 ms a character, at most 9 s (÷1.5 at ×2, ÷2 at ×3); conversation pages are read
  the same way; then the chosen button lights violet (`.ap-pick`) for 0.9 s and is pressed (a `pointerdown`, as a
  tap); the caption says "Answering: Title → choice" (`autopilot.answered` keeps them). The choice is
  `pickChoice(policy, offered, labels)` (`src/sim/choices.ts`, shared with the playthrough; `honest` takes a label
  with truth / tell / honest / admit / explain / share… (`HONEST_WORDS`), else the first). Cinematics play in full
  and radio lines close by themselves as for a player (automated browsers still skip cinematics, as before). The
  caption under the badge is the worker's: "Building a Radar", "Going to the ritual loop round the pylon",
  "Researching Deep Survey", "Travelling to Sela", "Working on: <objective>" when it is waiting.
- **The end** (`AutopilotView.ending`, from the renderer's `outcome()`: the game over and no cinematic or travel on
  screen). An ending (an epilogue, the home colony lost, a win): each epilogue page is read for 3 s + 45 ms a
  character (at most 14 s; quicker at ×2 and ×3), its Next (then "The end") lights violet and is pressed; on the end
  screen, after 6 s, the autopilot stops (remembered off) and leaves it there ("The end: COVENANT" in
  `autopilot.answered`). An expedition lost without an ending: after 6 s it presses "Back to Touchdown" and plays on at
  home, still on.
- **The director.** The worker's status (about twice a second, `{ type: 'pilot', status }`) carries places worth
  a look: a strike ring, a fight (hostiles or enemy units within 25 u of ours), the card's site or camp (its
  trigger), the unit or drone walking to a site, the building going up, the Core. The director takes the most
  urgent (strike > fight > card > group > build > Core), holds a shot at least 5 s (a strike or a fight may cut in
  after 1.5 s), follows the same subject as it moves, doesn't hop between nearby points, glides the focus (eased,
  ~0.7 s time constant) and eases the distance (55–115 u by subject) and pitch; on the Core it turns slowly. A drag,
  wheel or camera key (WASD, arrows, Q/E, +/−) makes it stand back for 10 s. Nothing moves while a title,
  cinematic, travel, menu or panel has the screen.
- **Tests.** `tools/autopilot-smoke.mjs` (headless; the browser half against the dev server, `--url`, default
  :5176; `--headless-only`): the playthrough's tutorial missions on the refactored bot finish at the same seconds;
  `pickChoice` per policy; the brain waits for the landing, builds, finishes the first tutorials and says so, does
  nothing when off; travel after the grace, not while a card waits, to the routed region, an expedition home (after
  its lab's project); assist ticks off a stuck objective (logged), not when off; a pack at a falling Core sent away.
  Its own play: 15 minutes at home (no packs) put depots on all four deposits with relays toward the far ones,
  batteries for the nights (cryo full), a lab, Deep Survey and a Deep-Core Mine; the Choir wall's spitters fought for
  their flag; Dunmore's survey team escorted, Kindred never fired on, Dustfall done; the Long Ear's three plates held
  at once; a nest raided by six tanks. Browser: a fresh colony, then title → OPTIONS → ×3 → Watch the computer play;
  the badge and the stored state; a card fired and answered (lit first); buildings without input; the camera
  moving; a caption; Stop (badge gone, nothing more built); the game menu turns it on; a mission jumped to on
  Splinter Hollow: the travel reload keeps it on, it plays there and comes home by itself, still on; Cycle fired:
  the card answered, the epilogue's pages turned (Next lit first) and it stops on the end screen; no page errors.
  `node tools/balance.mjs` is byte-identical (the `BalanceBot` hooks change nothing it uses), and the playthrough's
  tutorial seconds are unchanged (`chase`'s `go` is optional).
- **How far it gets** (`tools/autopilot-campaign.mjs [--minutes 300] [--assist] [--seed n] [--policy first]
  [--trace]`, or `--seeds 1337,1,2 [--jobs 3]` for several in parallel and one table: the brain on the real sim region
  by region with saves and the shared state, each region's sim its own seed, cards answered at once by the policy,
  cinematics at once; it prints the missions done with their times, the ending or how it stopped, the home colony's
  state, every assist and every loss; `--trace` a line a minute with the plan, guns, power, research and deposits,
  and what was spent where). Six seeds (1337, 1–5), 360 minutes at most:

  | | Before | Now |
  |---|---|---|
  | Without assist | no ending: 3–12 of 27 missions, the home Core falls at 47–67 min | **3 of 6 reach an ending** (Inheritance at 87–122 min, 22–24 missions); two lose the home Core early (seed 2 at 23 min, seed 5 at 34), one is stuck at home after Ash with its gantry lost and every deposit spent (15 missions at 360 min) |
  | With assist | one ending (Severance, 87 min); five lose the home colony (cryo) at 57–97 min, 14–22 missions | **6 of 6 reach an ending** (Inheritance ×3 at 85–94 min, Covenant at 112, Cycle ×2 at 119–127), 21–25 missions, 1–69 assists |

  Without the assist the tutorials take 9–11 min, Act 1 ends with Signal at 30–34 min, the Gantry at 39–76 min,
  then Act 2's expeditions go by in a few minutes each (an expedition's package is plenty), the Foundry at 59–95 min
  and the climax at home. The Inheritance endings are Trust deciding: the colony's few adults are Devoted (the
  growth pods often fail or are lost with the homes, so the colony stays small). The Lantern itself (seed 2 with
  the assist) was won with its expedition package: the Lid opened and the army walked in to the core. The assist's work is mostly the
  home colony: predators sent away at the Core and the cryo bank kept up (seed 5: 69 times), a stuck objective
  ticked off (the Radar on the second sol, Orbital Launch before the isotopes come in), a gantry set up again.
- **Not yet.** The home economy is the weak spot: Touchdown's four deposits (5,400 alloys) and two wrecks are spent
  by ~60 minutes of home time, packs grow every two minutes while it is there, and a colony that falls behind on
  guns early (seeds 2 and 5) loses the Core before Act 1 ends. Printers and fusion come late, nest raids need an
  army the economy can rarely afford at home, and the colony rarely grows past a few adults (pods fail when the
  Civilian Center or its power is lost), so the climax is mostly decided by Trust (Inheritance). The policy tuning
  is sensitive: moving guns ahead of the plan or letting cheap steps jump an expensive one made every seed worse.
  It doesn't pick among several expeditions by any order but the missions' (and optional ones last).

### Field Guide (v0.73.0)

New players get lost, so the game carries its own manual: a page on each of its ideas, a first-game look round the
screen, and tips the first time something comes up. And it stays current: **every release updates it**, and the
build fails if it doesn't.

- **Content** (`content/guide/<id>.json`, the `guide` collection in `src/content/defs.ts`, editor: Story → Field
  Guide): `title`; `section` (`GUIDE_SECTIONS`: basics, economy, power, defence, army, people, research, story,
  travel, factions, interface, shown in that order as Basics, Alloys & building, Power & night, Defence, Units &
  fighting, Colonists, Research, Story & choices, Travel & other worlds, Factions, Interface); `order` within the
  section; `summary` (one line: the list and the tip); `text` (paragraphs at blank lines; `**bold**` and lines
  starting `- ` as bullets, nothing else: `renderText` escapes everything first); `points` (a hint target: Show me,
  and Read from a tip, point at it; not `buildItem`); `trigger` with the story's condition fields (optional, `all` /
  `any` groups too; the content check reads them like a story trigger's); `see` (comma-separated page ids, See also;
  each must exist and not be the page itself); `since` (the release that added it, x.y.z) and `updated` (the release
  it last changed meaningfully in; empty = `since`); `tour` (at most 14 `{ target, text }`, only on `orientation`).
  `orientation` is required (the code plays its tour).
- **Hint targets** gained five (`HINT_TARGETS`, `src/story-hud.ts` `TARGETS`, usable by story hints too): `menu`
  (`#b-menu`), `log` (`#log`), `drones` (`#r-drones`), `planet` (`#r-planet`), `isotopes` (`#r-iso`).
- **The panel** (`src/guide.ts` `openGuide`; the `#guide` overlay above the other panels, z 62): from the game menu
  (Field Guide), the title screen (FIELD GUIDE), the Controls panel (a button at the top) and What's new (under each
  release, a link to each page its `guide` field lists; the guide opens over the panel). Sections with headings,
  pages by `order`; a search box (every word in the title, summary, text or section); a page with its section,
  See also links and Back (Esc goes back a page, then closes). NEW / UPDATED badges: a page whose `updated ?? since`
  is newer than the version the guide was last opened at (`exo.guide.seen`; none on a first look, so the first visit
  isn't a wall of badges). In a game, Show me around (the tour) and Show me (`points`): the guide closes and the
  element pulses with the hint bubble for 9 s. From the menu it goes back to the menu, unless it closed to show
  something or tour (then the game carries on); from a tip's Read it holds the game paused while open. `panelOpen()`
  counts it, so Esc, the autopilot and camera keys leave it alone.
- **The orientation** (`GuideTour`): on a player's very first game (no campaign or region save at boot, never toured:
  `exo.guide.toured`, home region, not a skirmish, play test or scratch game, the autopilot off), once the colony is
  deployed, 4 s in and no story card waiting or on screen (Touchdown's briefing comes first), a note offers
  "First time? A two-minute look around." [Show me around] [Skip]. The tour pauses the game (`hold`), and shows each
  step of `orientation.json`'s `tour` with the story hint bubble on its element (`StoryHud.point`: a hint of the
  renderer's own that takes the bubble while set, with Back / Next / Skip buttons; the story's own hint waits
  underneath and comes back after, so Touchdown's Build hint shows once the tour is done). Steps whose element isn't
  on screen yet (the battery, threat and radar chips at landing) are skipped. Enter / → next, ← back, Esc skips.
  At the end the game runs at the speed it had. Replayable from the guide.
- **Tips** (`GuideTips`): the renderer sends the sim the pages to watch (`{ type: 'guide', watch }`: pages with a
  trigger not yet tipped, only while tips are on, the autopilot off and a colony deployed); `Story.step` checks
  their conditions once a second with `conditionMet` (read-only) and lists the pages that held in the story
  snapshot's `tips`. The watch list and hits live on the `Story` object, not in the saved state, and nothing else
  reads them: a headless run never sends the command, so `tools/balance.mjs` output is byte-identical and the
  playthrough / autopilot timings unchanged (checked against v0.72.0). Each tip shows once per player
  (`exo.guide.tipped`, marked when shown): "Field Guide · title · summary" [Read] [×] under the top bar, 12 s.
  One at a time, queued: only while the screen is free (no story card on screen or waiting, cinematic, panel, menu,
  tour, hint of the guide's or the tour offer), 4 s after it last wasn't (`TIP_CALM`: a card closing doesn't throw a
  tip straight up), and at least 45 s of play after the last one (`TIP_GAP`). When several wait, the most urgent
  section goes first (`pickTip`: power, defence, colonists, alloys, units, research, story, travel, factions, then
  basics and interface), then the one waiting longest; a tip still waiting 180 s of play
  after its trigger held is dropped unmarked (`TIP_STALE`: a later game offers it). Options → Interface → Field
  Guide tips (`exo.guide.tips`, on; off by default in the editor's play tests). Automated browsers (smoke tests) get
  neither the offer nor tips unless the test sets `exo.guide.auto` = `on` in localStorage (no URL option).
- **Keeping it current** (`tools/guide-check.mjs`, in `npm run build` after the version check; `npm run
  guide:check`): `Release.guide` in `src/changelog.ts` lists the pages a release added or changed. Rules: every id a
  release lists exists; every page's `since` / `updated` is a release in the changelog, not before 0.73.0, and
  `updated` is not older than `since`; every release from 0.73.0 on has a `guide` field, and a minor or major
  release lists at least one page (a patch may say `guide: []`, but must say it); a page listed in release V has
  `updated ?? since` === V, and every page whose `updated ?? since` is V is listed in V. The launch (0.73.0) is the
  one exception to that last direction: it lists `orientation`, and every page added in it counts as listed. Each
  error says what to add where. **To add or change a page**: write or edit `content/guide/<id>.json` (a new page:
  `"since": "<new version>"`; a meaningful change: `"updated": "<new version>"`), add its id to the new release's
  `guide` list, and run `npm run build`. A typo fix needn't bump `updated`.
- **Tests**: `tools/guide-smoke.mjs` (`--headless` for the first half). Headless: the check's rules on good and bad
  fixtures (missing field, a feature with none, a patch with `[]`, missing page, either direction, versions that
  aren't releases or predate the guide); the shipped changelog passes; `renderText` escapes HTML and does bold,
  bullets and paragraphs; sections in order; search; badges; a tip trigger fires once and the game state with and
  without watching is identical; the opening's tips (below); no faction tip at Touchdown (`faction` conditions are
  false with no factions). Browser (dev server :5176): the guide from the title (sections, search, a page with
  bold and bullets and nothing else, See also and Back, Esc), a fresh first game (no offer over the briefing card;
  the offer; the tour paused, ← back, each step pulsing its element, the game running after, remembered), the menu's
  guide and Esc back to the menu, Controls' button, Show me around from the menu, Esc skipping the tour, a tip
  (alone, Read opens its page with the game held, Show me pulses its element), remembered and not watched again,
  the next not straight after, and a 375 px phone with no horizontal scroll in the list or a page.
- **The opening, measured** (the smoke, Touchdown, the autopilot as a quick player, cards answered at once): 44 of
  the 76 pages have tips; 18 triggers hold in the first 10 minutes of game time (power 29 s, deposits-and-depots
  39 s, batteries 45 s, turrets 74 s, worker-drones 100 s, defence 126 s, vehicle-bay 140 s, abilities 157 s,
  day-and-night 160 s, story-cards 181 s, biomass 280 s, cryo-bank 327 s, planet-health 360 s, wrecks-and-salvage
  413 s, growth-pods 433 s, geothermal 468 s, radar-and-sensors 502 s, nests 534 s). Shown 45 s apart, most urgent
  first: 13 in those 10 minutes (power 33 s, batteries 78, turrets 123, day-and-night 168, defence 213, worker-drones
  258, biomass 303, cryo-bank 348, planet-health 393, growth-pods 438, geothermal 483, radar-and-sensors 528, nests
  573). First in, first out at 60 s (the first version) put the packs page at 393 s, after the first pack (240 s),
  and dropped day-and-night as stale; the packs page's trigger is now sol 1.35 (was 1.6). The rest wait their turn
  or, gone stale (deposits-and-depots, which Groundwork teaches anyway), a later game.
  A human playing slower meets fewer triggers per minute.

### Save files (v0.94.0)

DESIGN §5.12 phase 1 (Domination will use the same files). `src/saves.ts` (the store), `src/saves-panel.ts` (the
panel), wired in `src/main.ts` ("save files").

- **Records.** Each file is two IndexedDB records in the existing `saves` store: `filemeta:<id>` (`SaveMeta`: name, kind,
  place, game time, `savedAt`, size; all the list reads) and `file:<id>` (`SaveBody`). Ids are time + random, base 36.
- **Campaign file:** `records` holds every `region:<id>` autosave on disk, this region's taken fresh from the sim, and a
  `campaign` record pointing here with `sharedOf(state)` (`campaignRecords`). Loading (`restoreCampaign`) stops this
  region's autosave, wipes the campaign (`wipeCampaign`), writes the records back stamped now (so no newer campaign
  record lays old shared state over them), writes the region's camera to its `exo.camera…` key, and goes there like
  campaign travel (`goTravel`: `?region=<id>&travel=1`).
- **Skirmish file:** the sim state and `url`, the address that set the battle up (the map is generated again from it;
  `load`, `title`, `new` and `travel` dropped). Loading goes to that address with `?load=<id>`; on start the skirmish
  reads the file, `sim.load`s it, puts the camera back and drops `load` from the address.
- **Not saved:** play tests (`?preview=1`, `?scratch=1`), the old horde mode (`?mode=skirmish`) and the Daily Planet
  (`?daily=`: one attempt a day). The menu has no Save & load there and Ctrl+S says so.
- **Ctrl+S** (`quickSave`) saves over the file this game was last saved to or loaded from (`exo.file` in
  sessionStorage, per tab, cleared when the kind changes), else a new file named "<Region> · Sol n, hh:mm" or
  "Skirmish on <World> · n min".
- **Panel** (the options overlay, class `saves`): name + SAVE (in a game only); the files newest first with LOAD,
  SAVE HERE (same kind only), RENAME (inline, Enter/blur keeps, Esc drops), EXPORT (`exo-save-<name>.json`,
  `{ exoSave: 1, meta, body }`), DELETE; IMPORT FILE… (checks the shape, gives the file a new id). Overwrite, Delete
  and a Load that would replace something (a campaign in this browser; a battle under way) ask twice on the button.
  Opened from the game menu (campaign and skirmish), the campaign end screen's Load, and the title's **LOAD** (shown
  when there are files: count and latest name).
- **The old single slot** (`slot1`, one region's sim) becomes a file "Saved game (older version)" the first time the
  list is read; it's `partial`: loading it puts back only its region (the rest of the campaign stays).
- Test: `tools/saves-smoke.mjs` (campaign save, rename, export, Ctrl+S over the file, NEW GAME then title LOAD brings
  it back, delete, import and a stray file refused, old slot moved, skirmish saved and loaded into the same map).
  `tools/skirmish-play-smoke.mjs` now expects Save & load in the skirmish menu.

### Domination areas (v0.95.0)

DESIGN §5.12 phase 2. `src/sim/areas.ts` (generation, pure: no DOM), `src/world/areas-view.ts` (the globe overlay),
`SolarSystem.showAreas` (system view), the skirmish's `area` option (`src/skirmish/setup.ts`, the setup screen's Site).

- **Content:** body field `areas` (0–12, editor: Worlds → "Domination areas"). Today 40: Home 7, Verdance 6, Rime 5,
  Dunmore 4, Ash 3, Cinder / Maren / Io-T / Vess / Sela 2, Kora / Teth / Orrin / Pip / Talus 1. Giants and comets
  never have any (orbital stations were in the plan; left for later).
- **Generation** (`bodyAreas`, ~9 ms for all): 160 candidates on a Fibonacci sphere, jittered and turned by a random
  rotation from the body's seed and id; off the site frame's poles (|lat| ≲ 68°); on a sea world only land with
  `bodyHeight` ≥ 10. Farthest-point picking from a random first (Home: Touchdown, lat 0 lon 0, first). Sorted north to
  south, then west to east, for ids `<body>-<n>`. Coordinates are the region site frame (`siteDir`), so an area plays
  as a region sited there.
- **Names:** a direction (North Polar, Northern, North-western, Central, Far Side, Far Southern…) from lat / lon, and a
  landform for the body's surface look (`lookOf`: icy, volcanic, sulfur, dusty, verdant, cratered, smooth) and the
  area's height in the body's own range (top, middle, bottom third). Duplicates take the next landform, then a numeral.
- **Links:** the Gabriel graph of a body's areas on the sphere (no third area nearer their midpoint), so each body's
  areas are connected; nothing between bodies yet (phase 3: launches).
- **Maps:** `MapOptions.site` pins the skirmish generator's site (no random site search) and names the map after the
  area. Small bodies (radius < 1,000) default to small maps. `?skirmish=<seed>&area=<id>` plays one; `size=` still wins.
  `tools/areas-smoke.mjs` generates all 40 for 2 and 4 players: every one fair (bases dry, flat and connected).
- **On the globe** (`AreaGlobe`, in a skirmish on an area or with `?areas=1` anywhere): a spherical Voronoi of the
  areas' globe directions (`globeDirOfSite`: `siteDir` turned back by the region's site turn) over the globe's
  triangles; seas belong to no area. Borders (pale amber), the area being played filled cyan, a label per area ("you
  are here" on yours). Fades as the provinces do, scaled by the body's radius. The provinces are off (`Provinces.off`)
  and the HUD's altitude line counts areas.
- **System view:** each other body gets a `Points` child (fixed 7 px, depth-tested so its far side hides them) at
  `siteDir × (radius × 1.03 + 60)`, shown once the body is 8–30 px across on screen; labels add "n areas" (the
  played body's too).
- **Setup screen:** World lists the six skirmish worlds then every other body with areas; Site lists Anywhere and the
  world's areas (reset when the world changes); the preview generates the area's site.

### Domination: the strategy layer (v0.96.0)

DESIGN §5.12 phase 3. Rules `src/sim/domination.ts` (pure data + functions; the state is the save), computer players
`src/sim/domination-ai.ts`, the page `domination.html` → `src/domination/main.ts` (+ `dom.css`; a third build input
in `vite.config.ts`, precached by the service worker like the game). Title → DOMINATION goes there.

- **State** (`DomState`, version 1): game seconds `t`; players (alloys, `ai` level, `out`, stats); every area
  (`owner` −1 for natives, `army`, `guns`, `natives`, `level` 0–3, `gantry`, a build `queue`, `visitors`: other
  players' armies fighting there); `moves` (armies on the way, `t0`→`t1`, `launch`); an event `log` (80 kept); `over`.
- **Map** (`domMap`): `systemAreas` + each body's planet (`system`: itself or what it orbits).
- **Numbers** (`DOM`): start 400 alloys; your start area level 1, army 30, guns 30, a gantry; natives 10–26 per area
  (seeded). Income per area 1 + level alloys/s (computer: Easy ×0.8, Hard ×1.25). Jobs, one at a time, three queued,
  paid when queued, paused while the area is under attack: army +10 (100, 20 s), guns +10 (80, 15 s, max 80), develop
  (200 × next level, 45 s, max 3), gantry (250, 40 s). Army limit (garrisons, attacks, moves and queued): 80 + 30 per
  area held.
- **Moving** (`domSend`): to a linked area overland (25 s + 35 s per radian), or with a gantry to any area on another
  body by launch (50 s inside one planet's system, 90 s across the system). Nothing stops a move; arriving at your
  own area joins the garrison, anywhere else it becomes a visitor and fights.
- **Fights** *(v0.98.0 replaced this: "Domination: the computer's strategy")* (`fight`, each second): every side (holder: army + guns, guns ×1.25 damage; or the natives; each visitor)
  deals 0.08 × strength, split over its enemies by their strength; under 0.5 left is gone. When the holder has
  nothing and one visitor is left, it takes the area: its army stays, guns 0, level −1, no gantry, queue cleared. An
  empty area falls at once. A player with no areas is out (its moves and visitors vanish); the last one wins.
- **Computer** *(v0.98.0 replaced this)* (every 8 / 5 / 3 s for Easy / Normal / Hard): spends on developing safe areas while income is low,
  guns on borders that face an enemy (to 20, later 40), a gantry when its world is taken (and one per six areas after
  10 min), a gantry wherever an army is stranded on a world with nothing left to take, armies in front areas. Attacks:
  for each place to take, every army that can reach it (launches once its world is taken, its army is 40+, or it's at
  its army limit) joins in if together they beat its defence × a margin (Hard 1.25, Normal 1.4, Easy 1.7; × 0.8 at its
  army limit), sending only what's needed (× 1.3 + 10), biggest first; next to an enemy a third stays home. Armies with
  nothing next door step toward the nearest front (a BFS over its own areas).
- **Balance** *(as of v0.96.0)* (`node tools/domination-sim.mjs`, Normal computers, seeds 1–5): every war ends; 2 players 15–55 min,
  3 players 28–82 min, 4 players 38–66 min (game time at ×1). Hard beats Easy 5 / 5. The start worlds aren't equal
  (Crimson on Verdance wins most three-way wars): phase 5's job, with the pace.
- **Page:** a flat map per world (longitude across, latitude up; links over the date line go out to the edge), redrawn
  4 times a second; the selected area's card (build buttons with the reason when they can't, its queue, ALL / HALF then
  tap a ringed destination); armies on the move (dots along overland links; a list with launches); events (tap one
  with a place to select it). Speeds ❚❚ / ×1 / ×3 / ×10 (Space pauses; the menu and the saves panel pause too).
  Autosave (IndexedDB `domination`) every 15 s, on `pagehide` and when the page is hidden; CONTINUE on its start
  panel. Save files: kind `domination` (body `dom`), from its menu or Ctrl+S (over the file it came from:
  `exo.domfile` in sessionStorage); the game's saves panel opens one at `domination.html?load=<id>`.
- **No fog of war yet**, and no teams: everyone sees every area's numbers, free for all.
- Tests: `tools/domination-sim.mjs` (rules, then computer wars), `tools/domination-smoke.mjs` (the page).

### Domination: battles in full (v0.97.0)

DESIGN §5.12 phase 4. `src/sim/dom-battle.ts` (the record, strength ⇄ units, outcome), the battle mode of
`Sim.newSkirmish` (`setup.battle`, `newBattle` in `src/sim/core.ts`), the computer's `battle` in `src/sim/ai.ts`, and
the hand-over in `src/domination/main.ts` (`fight`, `takeBattle`) and `src/main.ts` (`battle`, `backToMap`).

- **When:** an area with visitors where you're the holder or a visitor and the holder is a player (`cannotCommand`):
  the card's ⚔ FIGHT IT YOURSELF. Natives' fights stay on the map.
- **Hand-over:** the page pauses, writes a `DomBattle` (IndexedDB `dombattle`: area, the war's seed and time, the sides
  with you first) and the autosave, and opens `?skirmish=<war seed>&area=<id>&players=<n>&battle=1`. The game reads the
  record (it must match the area, have no result and the player count) before the sim starts: players from the war
  (names, colours, levels; free for all), no fog, wildlife, packs or alloys. It isn't a save file and Ctrl+S says so.
- **The field** (`newBattle`): the holder's Command Core at its home spot, its turrets in a ring (15 u out, first toward
  the middle, 8 a ring); every side's units in rows of 8 in front of its Core (attackers on their spot), facing the
  middle. No drones. In a battle every building is powered (`stepPower`: the area's own grid). Strength → units
  (`battleUnits`): round(army / 5), 1–40, tank / rover / lancer / tank / rover in turn, each worth army ÷ n; guns → a
  turret per 10, at most 12.
- **Out:** a holder when its Core falls (as in skirmish); an attacker (`PlayerState.coreless`) when it has no units
  left ("Your army is gone").
- **Computer** (`battle`): an attacker orders anything without a target at the holder's Core (or the nearest enemy it
  sees); a holder sends its army at the nearest enemies within 75 u of its Core, else back to a post 24 u in front.
  Abilities as usual (not Easy).
- **Back:** the end screen's **Back to the strategy map** (Rematch, New skirmish and the Chronicle hidden) or the
  menu's (twice: leaving early) writes `battleOutcome` (units: hp share × per-unit worth; turrets: hp share × 10,
  scaled when guns were over 120; Core standing) and opens `domination.html?battle=1`. `takeBattle` applies it when
  the seed and war time match (`applyBattle`: holder's army and guns, or 0 when its Core fell; visitors' armies),
  logs "Battle at …: you 120→85, Crimson 30→0 (Core lost)", deletes the record and opens the war paused on the area.
  The map's own fight resolves what's left (an empty holder falls at once). The war doesn't move during a battle.
- **Fixed on the way:** events from the sim that arrived before the page was ready were replayed through `log()`
  before `cine` was declared (a ReferenceError that stopped loading); `cine` is now declared first. Battles start
  fighting at once, which made it likely.
- **Measured** *(v0.97.0, before the map's fights were refitted in v0.98.0)* (`node tools/domination-battle-sim.mjs`, computers both sides), against the map's own fight for the same
  numbers: 150 attacking 30 + 20 guns: the Core falls with 85 left (the map: 138 left); 40 attacking 60 + 40 guns at
  Touchdown: the attackers are wiped out, 42 and all 40 guns left (the map: 55 and 36). Full battles cost a big
  attacker far more than the map's fight does; worth evening out with phase 5's balancing.
- Tests: `tools/domination-battle-sim.mjs` (headless), `tools/domination-battle-smoke.mjs` (both pages: leaving half
  way, and finishing).

### Domination: the computer's strategy (v0.98.0)

DESIGN §5.12 phase 5: the map's fights fitted to full battles, a new computer brain, fair starts. Measured with
`tools/domination-calibrate.mjs` and `tools/domination-ai-sim.mjs`.

- **Fights** (`fight` in `src/sim/domination.ts`). Battles fought in full (10 matchups, computers both sides) behave like
  an exchange, not the square law the map used: an attacker loses about what the holder is worth, whatever its own
  size (150 into 30 + 20 guns: 84 left in full, 138 on the old map). Now each side has a worth (a visitor its strength;
  a holder `holderWorth`: army × 0.9 + guns + 15 for its Core, 0 when it has nothing; natives their number); every pair
  exchanges `rate` (0.012) × the bigger one's worth × how much of their fire goes at each other, each second; a holder
  bigger than what comes at it loses less (× √ of the odds: small attacks are wasteful, as in full). The holder's Core
  share goes last. `node tools/domination-calibrate.mjs --check`: all 10 matchups pick the same winner as in full, with
  what's left within 20% of the attacker (or 12); a fight takes 30–140 s (in full 37–61 s). Full battles are cached in
  `tools/.cache/dom-calibrate.json` (`--fresh` plays them again).
- **Computer** (`src/sim/domination-ai.ts`, `STYLES` per level; still every 8 / 5 / 3 s):
  1. *Defend* (Normal, Hard): for each area with enemy armies on their way or fighting there, if they'd beat it
     (× 1.15): guns if they'd be ready before the first arrives, and help from areas next door that would get there in
     time (80% of their army). Hard pulls an army that can't be saved to its safest neighbour.
  2. *Spend* (reserve 50, Easy 150): develop safe areas while income is under 1.6 / 2.2 / 2.6 × areas held; border guns
     up to 10 + 0.3 × the enemy army next door; gantries for a stranded army, once its world is taken, one per six
     areas after 10 min, and (alloys over 1,000) wherever an army of 30+ waits; armies in front areas.
  3. *Attack*: for each place it can reach, the armies arriving within 40 s of the first; what it takes is the holder's
     worth plus half of the holder's armies next door. It goes if they beat that × margin (1.7 / 1.35 / 1.2; × 0.85 at
     its army limit) + 5, sending that × 1.5 + 20, biggest first. Score: min(3, have ÷ what it takes) × value ÷ (1 +
     arrival / 150 s); value 1 + 0.3 a level, + 0.3 a player's, + 1 the weakest player's (Normal, Hard), + 2 a player
     down to 2 areas, + 0.3 when its army has gone out. (The cap at 3 stops it churning weak spots for ever: 115 areas
     changed hands in an hour of a stalled 4-player war before.)
  4. *Gather*: armies with nothing to do (spare over 15) go to the strike force, its biggest army (counting armies on
     their way there, so the choice holds) by an enemy or a gantry: overland step by step, or by launch.
  What stays home: enough for what's on its way and 35% of the enemy army next door (less its guns), 10 by an enemy.
- **Fair starts** (`DOM.startBonus`, by player count, start order Touchdown / Verdance / Rime / Dunmore): 2 players 0 /
  50; 3: 0 / 200 / 420; 4: 0 / 200 / 600 / 900 alloys. Very sensitive in two-player wars (Home +250 won 98%).
  (`startWorldNatives`, tougher natives on bigger start worlds, is there but 0: it didn't help.)
- **Measured** (`node tools/domination-ai-sim.mjs --seeds 30 --check`): the new Normal beats the v0.97.0 brain 60 / 60;
  Hard beats Normal 97%, Normal beats Easy 98% (60 games each, both seats). Wins by start, Normals everywhere: 2 players
  50 / 50%; 3: 27 / 47 / 27%; 4: 30 / 20 / 37 / 13%. Every war ends; game minutes at ×1, shortest · median · longest:
  2 players 28 · 54 · 113; 3: 40 · 63 · 118; 4: 60 · 97 · 189. `--only matchups|fairness|pace` runs one part; the
  previous brain for the comparison is whatever is in `tools/.cache/dom-ai-baseline.ts`.
- Tried and dropped: growing bolder as a war drags on (margin down to 0.8× by 3 h) made stalls worse (6 in 90).
- `stepDomination` takes an optional brain per player (tests compare brains).

### Domination: teams, fog of war and victory (v0.99.0)

DESIGN §5.12 phase 6. Rules in `src/sim/domination.ts` (`DomRules` on the state, absent in older saves = free for
all, no fog, wipe out), the computer in `src/sim/domination-ai.ts`, the page in `src/domination/main.ts`.

- **Setup** (start panel): Players 2–4; Teams: Free for all, 2 v 2 (four players: sides 0011), You vs all (three or
  four: 011 / 0111); Computer; Fog of war; Victory: Wipe them out, or Hold 75%. Remembered in `exo.dom-setup`.
- **Teams** (`sideOf`, `allied`): allies never fight (`fight` only exchanges between foes; each side's fire is spread
  over its foes there), can't be a destination (`destinations` leaves allies' areas out), and win together. An area
  falls when all that's left in it is one side's: the biggest army holds it and its allies' armies join it. An army
  that arrives at an area an ally took meanwhile goes home again (or joins the ally if home is gone). Battles fought
  in full carry each side (`BattleSide.side` → the skirmish's `side`), so allies fight together there.
- **Fog** (`visibleTo`, `movesSeenBy`): the numbers in your side's areas, the areas linked to them, and areas where
  your side is fighting; every area of a player that has fallen to its last 3 (having held 6 or more: not at the
  start, when everyone holds one). Owners are always public. Moves you see: your side's, and any to or from an area
  you see. On the page: unseen areas are faded with "?", no guns or level marks; the card says "Out of sight". You're
  still told when an enemy army sets off for one of your areas (once per area every 20 s).
- **The computer under fog** (`fogView`): plans on a copy of the war where unseen areas carry what it last saw
  (`DomPlayer.seen`, kept up each think) or a guess (natives 18; a player's area 30 army + 20 guns), with no queues or
  fights it can know of, and only the moves it can see; areas it can see are the real ones. Orders go to the real war.
  Allies are friends everywhere (no targets, no threats, the weakest player is the weakest enemy).
- **Victory**: wipe out: the last side with a player in. Hold 75%: the first side to hold `controlNeed` (30 of 40)
  areas, checked every second, or the last side left. `over` records the winning `side`, `winner` (you, if you're on
  it) and `how`.
- **End screen**: who won and how ("by holding 31 of 40 areas"), the war's length, a chart of areas held per player
  over time (`DomState.history`, sampled every minute; a dashed line at 30 in a 75% war), and per player: most areas,
  taken, lost, army built, when they were out, their team.
- **Fair starts by setup** (`newDomination`): free for all `startBonus` as before; under fog `fogBonus` (3: 0 / 400 /
  800; 4: 0 / 400 / 1000 / 1500) and natives on start worlds × (1 + 0.1 × (areas − 5)) (`fogWorldNatives`: Home's are
  20% tougher); teams `teamBonus` by sides (0011: 0 / 0 / 50 / 100; with fog 0 / 0 / 250 / 400). Alloys alone didn't
  balance fog: Home won 18 of 30 four-player fog wars even with 2,000 for Dunmore; tougher natives at 0.2 swung it to 3.
- **Measured** (`node tools/domination-ai-sim.mjs --seeds 30`, Normals; winning side counts out of 30):

  | Rules | Ended | Median | Wins by side |
  |---|---|---|---|
  | Fog, 4 players | 30 / 30 | 113 min | 11 / 7 / 9 / 3 |
  | 2 v 2 | 30 / 30 | 66 min | 12 / 18 |
  | 2 v 2 with fog | 30 / 30 | 83 min | 15 / 15 |
  | You vs all, 3 players | 30 / 30 | 24 min | the computers 30 (two against one: a challenge) |
  | Hold 75%, 4 players | 30 / 30 (all by control) | 82 min | 8 / 6 / 11 / 5 |
  | Hold 75% with fog, 3 players | 30 / 30 (all by control) | 72 min | 13 / 7 / 10 |

  Free for all without fog, matchups and pace are as in v0.98.0 (unchanged: those games don't use the new tables).
  `--only rules --variant <text>` runs some of these; `--check` fails if any of them doesn't end.
- Tests: `tools/domination-sim.mjs` (teams, fog, reveal, the computer's guess, victory by control, the history),
  `tools/domination-smoke.mjs` (the setup's new rows, "?" under fog, the player list's teams and rules, the 75%
  victory screen with its chart).

### Download size and the offline cache (v0.100.2)

- **Precache** (`vite.config.ts`, `EDITOR_ONLY`): the editor page, its chunk, and the editor-only `balance-worker` and
  `playthrough-worker` (6 MB) are left out. 277 files / 45.5 MB → 278 / 22.6 MB.
- **Media survives releases** (`src/sw-template.js`): the build writes a per-file sha1 (`HASHES`) for everything outside
  `assets/`. Each cache stores its map under `exo-sw-hashes.json`; a new worker copies files whose hash didn't change from
  the previous cache instead of fetching them. Measured: first install fetches 316 media files, the next release 0.
- **Voices** (`public/media/voice`): 48 kbit/s mono MP3 instead of 128 (21 → 7.8 MB). `tools/voice/lines.mjs` re-encodes
  new lines with ffmpeg (`VOICE_KBPS`); `index.json` lengths are unchanged.
- **Models** (`public/media/model`): meshopt-compressed with quantized attributes (4.6 → 2.0 MB) by
  `tools/compress-models.mjs` (skips files already compressed; run it after adding a model). `src/assets/models.ts` sets
  `MeshoptDecoder` and `dequantize()`s every loaded scene back to float attributes, so `flattenForInstancing`,
  `splitPart` and the editor see the same geometry as before. Gallery screenshots match the uncompressed set.
- **No validation at runtime** (`src/content/index.ts`): production builds call `buildDb(files, { check: false })`, which
  skips per-field and cross-record checks (65–145 ms per thread in Node; `npm run build` already ran `content:check`).
  Dev, the editor and the tools still validate.
- **Version without the changelog** (`src/version.ts`): the game imports `VERSION` from there; `src/changelog.ts` is
  loaded only when What's new opens (its own 75 kB chunk). The content JSON gets a named chunk (`content-*.js`).
- **Native config loading**: `vite.config.ts` → `devtools/content-server.ts` → `src/content/asset-kinds.ts` use
  explicit `.ts` extensions (`allowImportingTsExtensions`) and have no other `src/` imports, so Vite's native config
  loader no longer warns.

### Tests, CI and the release helper (v0.100.3)

- **`npm test`** (`tools/run-tests.mjs`): the headless smokes (campaign, gameplay, inhabit, lead, medbay, roster), the
  headless halves of 19 more (`--headless-only`; guide-smoke's is `--headless`) and `golden-smoke`. About 2.5 min, no
  browser. CI (`.github/workflows/pages.yml`) runs it before `npm run build`, so a failing check stops the deploy.
- **`npm run test:browser`**: also every browser smoke, one at a time (some edit `content/` and restore it), against a
  dev server started on a free port. Smokes read the address from `SMOKE_URL` (default `http://localhost:5176/`; a
  smoke's own `--url` still wins). `pwa` and `editor-web` need a `/ExoGenesis/` preview build and run by name; `perf`
  is manual. `node tools/run-tests.mjs --list` shows the groups.
- **Golden determinism** (`tools/golden-smoke.mjs`, hashes in `tools/golden.json`): a 900-tick siege (85 buildings,
  35 units, 160 predators), the balance bot's first 10 minutes, and a 6-minute 1v1 between computer players on a
  generated map; each end state is hashed (floats to 12 significant digits). A refactor keeps the hashes; a change
  meant to alter behaviour re-records them with `--update` and says why in the commit.
- **`tools/lib/harness.mjs`**: `launch({ gpu })` (SwiftShader WebGL by default), `DEV_URL`, `checker()`. 40 smokes use
  its `launch()`; the ones that load Playwright lazily (so their headless half runs without it) don't.
- **`npm run check`**: content, version and guide checks plus `tsc` (which now covers `tools/*.ts` too:
  `sim-entry.ts`, `flow-entry.ts`). `npm run build` = `check` + `vite build`.
- **`npm run release -- <minor|patch> "Title" --note "..." --guide a,b`** (`tools/release.mjs`): bumps `package.json`
  and the lockfile, adds the changelog entry (notes say TODO if none are given), sets `updated` (or `since` for a new
  page) on the listed guide pages (`--guide auto`: the ones git shows changed), then runs version:check and
  guide:check. `--dry-run` prints it.
- **`tools/import-changes.mjs`**: warns about uncommitted changes under `content/`/`public/media/` and about being behind
  the upstream branch. A content file changed both here and in the export is merged field by field against the version
  the editor started from (`git cat-file -p <orig sha>`); only a field both sides changed to different values is a
  conflict.
- Smokes brought up to date: `lead` and `roster` watch only the hostiles they spawn (regions start with nests now, and
  packs only set out from a spawn whose nest stands), `autopilot`'s playthrough snapshot is 15:31, and `smoke.mjs`
  leaves save files to `saves-smoke`.

### Safety nets: errors, failing saves, New Game (v0.101.0)

- **The sim stops** (`src/sim/worker.ts`): message handling and `tick()` run inside try/catch, plus the worker's own
  `error`/`unhandledrejection`. The first error sets `crashed` (no more ticks, no autosaves: the state may be
  half-updated) and posts `{ type: 'crash', message, stack, tick }`. `SimClient.onCrash` (also on the worker's own
  `onerror`, e.g. a failed script load) → `showSimCrash` (`src/crash.ts`): Reload (`reloadUrl()`: the same address with
  `title=0` and without `new`/`intro`/`story`/… so it resumes the autosave), Copy details (`crashReport()`: version,
  address, browser, message, stack; a textarea if the clipboard is unavailable), Keep watching.
- **Page errors** after `body.loaded` (`watchPageErrors`): a one-time note at the top with Copy details. Resource load
  failures (no error object) and failed fetch/decode/abort rejections are ignored.
- **Autosave failing**: the worker counts failures in a row and posts `saveFailed`; main.ts logs a `bad` line on the
  2nd and every 30th (≈ 5 min) telling the player to save a file and export it.
- **Persistent storage** (`keepSaves()` in `src/save.ts`, at reveal): `navigator.storage.persist()` unless already
  persisted; skipped on Firefox in a tab (it would prompt), asked there only by the installed app.
- **Before new game** (`backupCampaign()` in `src/saves.ts`, `keepBeforeNew()` in main.ts): the title's NEW GAME,
  the game menu's New game (`restartGame`, state asked of the worker before `newGame` so it's the old colony) and the
  autopilot's fresh start write the campaign as a save file (`auto: true`, "Before new game · <date>") before
  `wipeCampaign`; only the newest 3 such files are kept. Test URLs (`?new=1`) don't make one.
- **guide:check**: only the newest release has to list a page when it's a feature release (an older one's pages can
  have changed again since). `npm run release` takes a page it updates off the older release that listed it.
- Test: `tools/recovery-smoke.mjs` (page-error note, Copy details, a malformed `load` throws in the worker → the card,
  ticks stop, Keep watching, NEW GAME files from the title and the menu with the newest-3 limit, Reload resumes).
