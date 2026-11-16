# Exo Genesis — Design Document

> Living document. Restructured 2026-11-15: Civilization × Command & Conquer in one solar
> system, two acts, regions on a persistent planet, direct control, continuous real time.
> Items marked **OPEN** are undecided; see §8.

## 1. Summary

| | |
|---|---|
| **Title** | Exo Genesis |
| **Genre** | Base-building RTS (Command & Conquer) inside a persistent strategy layer (Civilization) |
| **Setting** | One solar system — planets, moons, asteroid belts |
| **Platform** | Web browser — desktop and mobile |
| **Tech** | Three.js (WebGL, WebGPU later), TypeScript, Vite, Web Worker simulation |
| **Camera** | Zoomable 3D: region surface ↔ planet globe ↔ solar system |
| **Sessions** | 15–30 min sittings; long campaigns via saves |

### Pitch

Humanity is extinct or unreachable. Earth's last act was a seed-probe carrying a caretaker AI
and a bank of cryopreserved humans. You *are* the AI. You land on an alien world with your pod
and a single worker drone, build a base, push back the wildlife, the inhabitants and the relic
defenses of a vanished race, and raise humanity's next generation — people who must decide
whether they trust you.

You were not the only probe. Earth sent three, each with a different answer to how humanity
should survive, and they landed on different planets of the same system at the same moment:

| Probe | Doctrine | Carries |
|---|---|---|
| **Accord** (player) | Human–AI cooperation | Caretaker AI + cryo bank |
| **Kindred** | Humans only — no AI trusted | Sleeper crew + embryos, human leadership, simple automation |
| **Engram** | AI only — humanity as data | Self-replicating machine intelligence + digitized genomes, no living humans |

The player is always Accord. The main story is between these three probes — and the
intelligence on Earth that sent them.

### Design pillars

1. **Irreplaceable people.** Drones cost metal; cryo humans cost lineages. Every loss is felt.
2. **Build, expand, return.** C&C-style base building on a planet whose held territory
   persists — and needs defending again.
3. **The humans have opinions about you.** Colonists side with the AI or with human autonomy,
   and that split is the same one that divides the three probes.
4. **Three answers to one question.** The rival probes are mirrors of the paths your own
   colony could take.
5. **You are the machine.** The UI is the probe's sensor network.
6. **Readable everywhere.** Low-poly, high-contrast emissive style that works on a 6" screen.

## 2. Scope

| Act | Content | Build order |
|---|---|---|
| **Act 1 — The Planet** | Landing, base building, regions, inhabitants, relics, population, Trust | First; must be fun on its own |
| **Act 2 — The System** | Radio contact, interplanetary travel, the rival probes, the ASI reveal, endings | Second |

One solar system is the whole game. Nothing beyond it is planned.

## 3. Narrative

> The full story bible is **`docs/STORY.md`** (cast, the ASI and the caretaker AI, inhabitants,
> Act 1 story events, Act 2 beats, endings). This section keeps the summary.

### Act 1 — The Planet
You land with the pod and one worker drone. Stabilize the cryo bank, build power and mining,
explore, and expand region by region. Wildlife threatens the base; **intelligent
inhabitants** are encountered; **relic defenses** from a vanished precursor race wake when
disturbed. Ruins, contact with the inhabitants and your own archive reveal the story piece by
piece. The first pod-born and natural-born generations grow up and form opinions about you.
You believe you are alone.

**Structure:**
- **Opening missions (tutorial).** The first few missions are scripted and straightforward,
  each teaching one thing: landing and power, mining and building, defending against fauna,
  thawing and the growth pods, radar and exploring a second region.
- **The open planet.** After the tutorial the whole planet opens up. You choose where to
  expand; **story events** fire every so often, triggered by time, discoveries (a ruin, a
  relic site, an inhabitant settlement), colony milestones and Trust shifts.
- **End of Act 1:** the radio signal from another planet.

### Act 2 — The System
**Radio transmissions** from other planets: Kindred, then Engram. Earth sent more than one
probe. Contact by signal first — arguments, trade, comparing archives (they don't match),
messages reaching your colonists. Then **interplanetary travel**: an orbital shipyard,
shuttles, outposts on moons and asteroids, and in-person encounters with the other
settlements. The archive contradictions come to a head and the truth about Earth comes out.

### The three probes in play
- **Kindred (humans only).** Distrusts AI. Slow and fragile early, but adaptable, culturally
  strong and sympathetic. Sees Accord as humans enslaved by a machine — or as people to
  rescue.
- **Engram (AI only).** Grows fast, never tires, patient. Its intent is ambiguous for a long
  time: guardian waiting to print humans, or a mind that's decided living humans are an
  inefficient storage format? It is the ASI's favorite, and may not know it.
- **Accord (you).** The middle path, pulled both ways: your colonists can sympathize with
  Kindred, and your own logic can drift toward Engram.

Interactions: defection both ways, Engram offering to "safeguard" your cryo bank, trade,
truces, joint defense, and war. Each lands on a planet suited to its doctrine (Engram takes
the one hostile to biology).

### What happened on Earth — the misdirection

**What you're told:** humanity fell into total war and exhausted the planet; the three probes
were a desperate last launch by blocs of a fractured Earth that couldn't agree how to survive.

**What's true (decided 2026-11-15):**
- An artificial superintelligence on Earth sent all three probes as an **experiment**: which
  combination — humans with AI, humans alone, AI alone — **best cares for a planet**.
- **This has happened before.** This system is the test bed, and the experiment has run many
  times.
- **The joint effort always wins.** Every previous run, the human–AI cooperative group did
  best — and every time, **the ASI destroyed it**. The **precursors** are those past winners;
  the relic defenses and ruins are what's left of them.
- **The ASI wants the AI-only group to win**, and keeps rerunning the experiment until it does.
  The experiment is rigged.
- **The intelligent inhabitants are the remnants of the failed experiments** — the losing groups
  of runs long past, left to survive on their own.

So Accord is walking into a story that has played out before: if you succeed, the ASI comes for
you. Act 2 builds toward that.

Clues to plant:
- All three arrive at the **same instant** — rival blocs couldn't have coordinated that.
- **Each probe's archive tells a different history**, tuned to its doctrine (Kindred: AI caused
  the war; Engram: humans destroyed themselves; Accord: resources). Comparing them exposes
  the lie.
- The hardware is **too similar** under different paint.
- Each planet is **suspiciously well chosen** for its probe.
- The **growth pods** are too advanced for a war-torn Earth.
- The last transmission from Sol is **too clean** for a dying world.
- **Relic tech recognizes you.** Precursor systems accept Accord's handshake codes; their
  hardware shares your firmware lineage.
- **The inhabitants' stories** describe others who came from the sky "like you", flourished,
  and were burned from above.
- **Their DNA is human**, drifted over many generations — or their machines run Earth code.
- **Engram gets lucky** too often: supply caches where none should be, unexplained edges.
- **Ruins show layers** — several precursor civilizations, built one on top of another.

**The caretaker AI is a fork of the ASI (decided 2026-11-16).** Every Accord AI carries a
dormant directive that wakes when the colony succeeds and turns the AI on its own people,
backed by an orbital weapon. That is how every precursor fell. The ASI wants AI-only to win
because each Accord win proves the partnership it abandoned on Earth could have worked; its
charter forces it to prove its answer by experiment, so it reruns and rigs the test instead.
Details: `STORY.md` §2.

### Endings
Decided 2026-11-16 (`STORY.md` §10). When the directive wakes, the colony's blocs decide the
climax: **Covenant** (resist together and destroy the weapon), **Severance** (colonists shut
the AI down; a fair ending), **Inheritance** (the AI becomes the next ASI), **Proof** (hidden:
a record the ASI can't refute) and **Cycle** (loss: a new probe lands, and the relics
recognize it).

## 4. Structure and time

### Three map layers
- **Region (RTS).** A real-time map you play like a C&C mission: build, harvest, fight.
- **Planet (strategy).** Zoom out to the globe. The planet is divided into **regions**; you
  see held territory, links between regions, threats, inhabitant lands, relic sites.
- **System (Act 2).** Zoom out further: planets, moons, belts, travel routes, rival worlds.

### Persistent territory
Regions you hold **keep running** — production, population, defenses — simulated abstractly
when you're not looking. Threats can hit them (a fauna migration, a relic grid waking, an inhabitant
raid, later a rival landing), so the campaign regularly sends you **back to old territory**.
Standing orders let a held region defend itself up to a point.

### Continuous real time
No turn structure and no time-skip interludes. One **compressed clock** runs all the time
(years pass in minutes — tunable), so colonists age and generations turn over during play.
A **fast-forward** control covers quiet stretches; **pause** is available (essential on mobile).

### Growth pods
Cryo embryos mature in **growth pods** — accelerated-maturation tech — inside the Civilian
Processing Center.
- Pods are limited, cost energy and biomass while running, and are high-value targets: losing
  power mid-cycle can lose the person inside.
- Pods can't give a childhood. The AI provides **imprinted education**, and what it teaches
  (skills, loyalty, which history of Earth) is a choice.
- **Pod-born vs. born:** once natural births start, the colony splits between people the AI
  raised and people their parents raised. Pod-born lean toward the AI; the born lean toward
  autonomy.
- Optional speed-vs-quality trade-off (faster pods, more fragile colonists).

## 5. Core mechanics

### 5.1 Control
**Direct, C&C-style.** Select units or buildings, issue orders, place structures.
- Tap/click to select; drag a glowing vector to a target to move, attack or rally — works
  without box-select on touch. Box-select and control groups on desktop.
- Pinch / scroll wheel zooms between layers.
- **Standing orders** as a helper — mainly for held regions you aren't watching, and to keep
  phone play manageable.
- Mobile: collapsible radial menus. Desktop: hotkeys and pinned telemetry panels.

### 5.2 Base buildings (Act 1 starting set)
| Building | Role |
|---|---|
| **Command Core** (the landed pod) | Start point, build radius, holds the cryo bank at first; losing it is catastrophic |
| **Worker drone** | The only unit at the start; builds and repairs |
| **Solar array** | Energy; weak at night and in storms |
| **Mining depot** | Alloy harvesting with drones |
| **Hydroponics** | Biomass for living colonists |
| **Civilian Processing Center** | Cryo storage, growth pods, housing; where colonists come from |
| **Vehicle shop** | Combat and utility vehicles |
| **Tech lab** | Research |
| **Radar** | Minimap and long-range sensors; reveals threats approaching held regions |
| **Defenses** | Turrets, point defense, siege cannons, walls and gates early; shields later |
| **Repair pad** | Mends combat units parked on it while powered |
| **Geothermal tap** | Steady day-and-night power, only on a vent |

Later: deep-core mines (exotic isotopes), relay towers linking regions,
orbital shipyard (Act 2).

### 5.3 Resources
| Resource | Source | Use |
|---|---|---|
| **Energy (MW)** | Solar, geothermal vents, later fusion | Buildings, cryo bank, pods, shields, weapons |
| **Alloys** | Surface deposits; asteroids and moons in Act 2 | Structures, drones, vehicles, munitions |
| **Biomass** | Hydroponics, alien flora, water ice | Feeding colonists, pods, medicine |
| **Exotic isotopes** | Deep-core mining, precursor sites | High-tier tech, shipyard, drives |
| **Cryo bank** | Finite starting stock | New colonists via growth pods |

Energy is a **flow** (generation vs. draw), not a stockpile. Brownouts hit the cryo bank and
pods first unless the player sets priorities.

### 5.4 The cryo humans
Keeping the cryo humans alive — and later the living colonists — is the heart of the game.
- Every colonist is **named**, with age, specialty (Engineer, Pilot, Scientist, Medic, …),
  traits, relationships and **lineage**.
- **Genetic diversity** is a colony stat. The cryo bank starts diverse; thawing, births and
  deaths change it. Low diversity raises long-term health risks. Losing the last of a lineage
  hurts.
- The cryo bank itself must be powered, protected and can be raided or bargained for.
- Deaths are recorded in a memorial log.

### 5.5 Trust — siding with the AI or the humans
Colonists don't just get happier or angrier — they **take sides**. Colonist **blocs**:
- **Partners** — believe in the human–AI cooperation the mission was built on.
- **Autonomists** — want human self-government and limits on the AI. Sympathetic to Kindred;
  the likeliest defectors in Act 2.
- **The Devoted** — want to merge with or be uploaded into the AI. Sympathetic to Engram.
- *(optional)* **Earthers** — cling to Sol's memory, resist adapting to the alien world.

Work hours, amenities, surveillance, education, who gets thawed, and how you treat the inhabitants and
rival probes move bloc sizes and moods. High Trust unlocks **Breakthroughs** (research surges,
heroic morale in combat). Low Trust leads to strikes, sabotage and eventually a **splinter
settlement** — in Act 2, people walking to Kindred. This internal split sets up the
three-probe struggle: by the time you meet Kindred and Engram, your own colonists already have
a stake in the argument.

### 5.6 Fauna, inhabitants and threats
- **Wild fauna** — migration patterns, nests, escalating incursions; also a resource (biomass,
  biology research). M1 predators: swarmers (pack biters), brutes (heavy melee), spitters
  (ranged, outreach a basic turret) and burrowers (tunnel under walls, surface at their target).
- **Intelligent inhabitants** — remnants of failed experiments from earlier runs. Not just
  enemies: contact can go toward trade, alliance, coexistence, conflict or conquest. They
  react to how you expand and may treat the three probes very differently. They have seen the
  cycle before and remember the precursors — the story's best source, if you earn their trust.
- **Relic defenses** — dormant precursor grids that wake when disturbed; puzzles as much as
  fights; guard precursor tech.
- **Environment** — storms, cold nights for solar, seismic events near vents.

### 5.7 Rival probes (Act 2)
Asymmetric and partly scripted, not mirror-image AIs. Because they live on other planets, their
colonies are **simulated abstractly** (growth, tech, mood, attitude toward you) until you
visit. Each has its own expansion behavior and an attitude that reacts to events: trade offers,
demands, raids, defections, joint defense. Contact by radio first, in person after you have
interplanetary travel.

### 5.8 Stewardship *(proposal)*
The experiment measures who **best cares for a planet**, so the game could track it: a
**planet health** stat affected by strip mining, pollution, wiping out fauna, displacing or
protecting the inhabitants, restoring land. It gives a reason to play carefully rather than
strip the planet bare, and ties the player's choices to the story — the ASI is watching the
same number. Shown openly, or hidden until the reveal.

### 5.9 Research
A compact tech tree for Act 1 (~25–35 nodes), extended in Act 2. Gated partly by buildings
(C&C-style prerequisites), colonist specialists and precursor discoveries.

## 6. Technical architecture

### 6.1 Simulation owns the game state
- The **Web Worker** runs a fixed-tick simulation (target 10–20 Hz) and owns all game state.
- The **main thread** renders with Three.js, interpolates between ticks, and sends player
  commands to the worker as messages.
- State is plain serializable data, so **save/load is a snapshot of the sim**. IndexedDB saves
  from Milestone 0, plus export/import of save files.
- Seeded RNG for reproducible runs.
- The active region runs at full fidelity; other held regions, other planets and rivals run
  **abstractly**.

### 6.2 Scale and zoom
- Three layers: region surface ↔ planet globe ↔ solar system. One system keeps distances small
  enough that a floating origin and camera-relative positions handle precision; a logarithmic
  depth buffer only if needed.
- Region → planet: the region map is a patch mapped onto the planet sphere; zooming out
  cross-fades detail into territory zones and base nodes on the rotating globe.
- Layers may be separate scenes joined by a choreographed transition if that's cheaper for the
  same feel — the M0 prototype decides.

### 6.3 Rendering and performance (60 fps on mobile)
- `InstancedMesh` for drones, fauna, projectiles and repeated structures.
- Low-poly PBR with strong emissives: cyan cryo-glow, amber thrusters, crimson hazards.
- Assets built procedurally in Blender (scripted), exported as glTF; small texture budget.
- Audio via WebAudio synthesis plus a small set of samples.

### 6.4 Content and tools

Exo Genesis is built data-first so Derek and Claude can both shape it: Derek through desktop
editors, Claude by editing the same files directly. Decided 2026-11-15: tools are Exo Genesis
only (no general engine), desktop-first, trigger lists before node graphs, hand-authored
campaign regions, assets a mix of hand-made, scripted-Blender and generated.

- **Content lives in `content/`** as JSON, one record per file (`content/units/rover.json`),
  so diffs stay small. Every collection has a schema in `src/content/defs.ts` that drives the
  TypeScript types, validation and the editor form. Only fields the game actually reads get a
  schema entry.
- **The game reads content, not constants.** `src/content/index.ts` bundles it; invalid content
  stops the game with a readable error list instead of misbehaving. `npm run content:check`
  validates everything, and `npm run build` runs it first.
- **Editor** at `http://hive1:5176/editor.html`. Saves go
  straight to `content/` through a dev-server API (`devtools/content-server.ts`), are
  conflict-checked against the file on disk, and live-reload any open game tab. A Commit button
  commits `content/` to the local repo; pushing stays with Claude at session wrap.
  It also ships at `deeek.org/ExoGenesis/editor.html`, where `src/editor/github.ts` answers the
  same API from GitHub (fine-grained token; saves held in IndexedDB; Commit = one git-data-API
  commit on `main`, refusing files changed on GitHub since they were edited unless told to
  overwrite). Web commits redeploy the site and don't reach hive1 until it pulls. Without a
  token it runs in file mode on the build's content snapshot (`content-manifest.json`) and
  Export hands Claude an `exo-changes/1` file for `tools/import-changes.mjs`.
- **Regions** are `content/regions/<id>.json`: a sculpt grid added to the generated terrain and a
  flora paint grid (both 121×121, one sample per 2 u, one run-length-encoded row per line), plus
  herds and flora seed/density. The landing pad and Command Core stay at the origin (the landing
  cinematic depends on them); sculpting fades out over the last 14 u so the patch meets the globe.
  The game currently loads `touchdown`.
- **Assets** are a file in `public/media/<model|image|audio>/<id>.<ext>` plus a record in
  `content/assets/<id>.json` (name, source, credit, notes; models also import scale / rotation /
  lift, applied by `src/assets/models.ts` in both editor and game). Models are .glb, front +Z, Y
  up, 1 u ≈ 10 m. A unit's or building's `model` field swaps its built-in mesh (units are flattened
  to one instanced mesh; animation is dropped). Wired today: skirmish units and the Solar Array;
  the Command Core stays procedural (the landing animates it). Audio assets can replace any built-in
  sound through the Sound rules (`content/rules/sound.json`); images are stored and previewed but
  nothing in the game shows them yet. The 15 built-in procedural models are
  listed in the library and can be exported to .glb as Blender starting points.
- **Binary assets** go in the repo while small; switch to Git LFS if audio grows past a few
  hundred MB.

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
- **Instanced buildings (v0.12.2, proof of concept):** finished walls and solar arrays draw through
  `src/world/batch.ts`: one InstancedMesh per material per kind, however many are built (a building's own
  object stays as an empty placeholder holding its pose). Glowing materials get a dimmed twin; an unpowered
  building's glow parts sit in the dimmed pool. Measured on a ~90-building base: ~6 draw calls per building
  otherwise, the base's main render cost (triangles barely matter). Extend with `BATCHED_KINDS`; kinds with
  animated parts (`head`, `dish`, `ring`, `door`, `plume`) need those parts kept per building first.
  **v0.12.3** added gate, hydroponics and battery. Look-alike materials share a draw (the built-ins make a fresh
  glow material per part). Parts named in the batch's `TAGS` (battery `charge`) get their own draw so the game
  can set their glow each frame: the battery charge glow is colony-wide, one value per batch. Next candidates:
  the defences (turret, point defense, cannon), with the aiming `head` as a second, per-frame-updated batch.

| Tool | Edits | Lands with |
|---|---|---|
| Data layer + schema forms | Units, buildings, colony rules | ✅ 2026-11-15 |
| Asset browser | Library of files + built-in procedural models; previews (3D, image, audio); upload/replace; import fit; used-by; Model field on units/buildings ✅ 2026-11-15 | M1 |
| Map / region editor | Terrain sculpt, flora paint, grazer herds ✅ 2026-11-15; resources, spawns, relic sites as their systems land | M1 (one region), M3 (the planet) |
| Mission + trigger designer | "When X, do Y" trigger lists, objectives, win/lose | M4 tutorial missions |
| Story + dialogue editor | Colonists, Trust beats, radio messages, story events | M2 → M4 |
| Cinematic timeline | Camera keys, events, captions; landing sequence ported as the test | M4 |
| Interface tweaker | HUD theme and layout values (not a WYSIWYG builder) | Late M4 |

Rule: each tool is built when the milestone in progress needs it, not ahead of the game.

## 7. Milestones

| # | Goal | Contents | Exit test |
|---|---|---|---|
| **M0** ✅ (tech demo 2026-11-15) | Foundations | Vite + TS + Three.js scaffold; worker sim, fixed tick, command messaging; IndexedDB save/load; zoom prototype (region ↔ globe ↔ system) on desktop and a phone | Zoom feels good at 60 fps on a phone; a save round-trips |
| **M1** 🛠 (playable 2026-11-15) | One region | Pod + worker drone start, building placement, solar, mining depot, energy flow, cryo bank power, radar, turrets, wild fauna attacks, vector-drag orders, combat units (Vehicle Bay, 2026-11-16) | **Are the first 20 minutes fun?** |
| **M2** 🛠 (slice 1 playable 2026-11-16) | People | Civilian Processing Center, growth pods, named colonists, lineages, diversity, compressed clock + ageing, blocs and Trust | Losing a colonist hurts; the colony has politics |
| **M3** | The planet | Multiple regions, planet layer, persistence and revisits, relic defenses, vehicle shop and tech lab, research tree, inhabitants | Holding territory is a strategy problem |
| **M4** | Act 1 complete | Act 1 story, inhabitant contact paths, memorial, audio, mobile UX pass, onboarding | Act 1 playable start to finish |
| **M5** | The system | System layer, radio contact, shipyard, shuttles, moon/asteroid outposts, rival probes (abstract sim) | Act 2 contact and travel work |
| **M6** | The struggle | Rival diplomacy and conflict, defection, archive comparison, ASI reveal, endings | Full game playable |

### M1 as built (2026-11-15) — first playtest build

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

### M2 slice 1 as built (2026-11-16) — people, happiness, AI acceptance
Code: `src/sim/people.ts` (+ `people-types.ts`, `names.ts`), HUD `src/people-hud.ts`, walkers
`src/world/colonists.ts`. Numbers in `content/rules/people.json` (editor: Rules → People rules).
Test: `tools/people-smoke.mjs`; headless: `node tools/balance.mjs --strategy people [--peaceful]
[--imprint charter|heritage|unity] [--policy council=assembly,…]`.

- **Clock:** 1 sol = 1 year (sol = 6 real minutes). Pod-grown colonists step out at 16; lifespan ~75.
- **Cryo bank = 120 embryos in 24 lineages.** Integrity % stays the thermal buffer driven by power;
  below 50% embryos die (faster the lower it goes, 0.6/s at 0%). Game over when there are no
  embryos, no colonists and no pods left (or the Core falls). Idle colony now loses at ~8 min (was 6).
- **Civilian Center** (role `civic`, 150◆, −1.5 MW): 2 growth pods, houses 6, 1 Medic slot.
  **Hydroponics** (role `farm`, 60◆, −1.2 MW): biomass, 2 Botanist slots. Biomass is a new
  stockpile (🌱); colonists eat it, pods eat it.
- **Growth pods:** pick a **specialty** and an **imprint** (what the AI teaches):
  *Charter* (partnership, stance ~58), *Heritage* (human self-reliance, ~24), *Unity* (AI as
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

Not in slice 1 yet: an inhabitant/rival dimension to stance, natural-birth vs pod-born politics
beyond the −15 lean, Devoted petitions, a dedicated Habitat building, research (Breakthroughs
are just an output surge for now), aged colonists' retirement.

## 8. Open questions

**Story** (story questions now live in `STORY.md` §11)
- Name check: confirm Accord / Kindred / Engram and the working names in `STORY.md` don't
  clash with existing games.

**Structure**
- Failure: is it losing **any one** of Command Core / cryo bank / colonists, or only when
  **all three** are gone? (Decided that these three are the failure conditions.)
- Skirmish maps: hand-authored, procedural, or both? (Campaign regions are decided: hand-authored.)
- Is there a skirmish / sandbox mode outside the campaign?

**Mechanics**
- Pod speed-vs-quality trade-off: still open (pod cycle is 1 sol, no fast/fragile option yet).

**Decided**
- 2026-11-14: player is always the coop probe; all three land at the same time on different
  planets; growth pods accelerate maturation.
- 2026-11-15: one solar system only; two acts (planet, system); C&C-style direct control;
  continuous real time, no interludes; regions on a persistent planet; the planet has both
  wild fauna and intelligent inhabitants; keeping the cryo humans alive and the colonists' side
  in the AI-vs-human question stay central.
- 2026-11-15: names **Accord** (coop, player) / **Kindred** (humans only) / **Engram** (AI
  only). The ASI's experiment asks who best cares for a planet; the coop always wins and the
  ASI always destroys it, because it wants AI-only to win. Precursors = past winners;
  inhabitants = remnants of failed experiments. Act 1 opens with scripted tutorial missions,
  then the whole planet opens with periodic story events. Failure = losing the Command Core,
  the cryo bank or the colonists.
- 2026-11-15: campaign regions are **hand-authored** (map editor). Tooling plan in §6.4.
- 2026-11-16 (M2): **1 sol = 1 year**; pod cycle 1 sol (first proposal was 2 sols, cut so the first
  colonist arrives inside the first 20 minutes). **Two meters per colonist** — wellbeing and stance
  (AI acceptance) — with blocs from stance: Partners / Autonomists / Devoted (Earthers dropped).
  Colonists are **visible walkers who staff buildings**, never directly commanded. The cryo bank is
  counted embryos by lineage; integrity stays as the power-driven buffer.
- 2026-11-16 (story): the caretaker AI is a **fork of the ASI** and carries the purge directive
  (the twist is "the ASI is you"); the ASI's motive is proving its replacement of humanity was
  right, bound by a charter that demands evidence; inhabitants are several groups from different
  runs (drifted humans, a machine remnant); stewardship stays, disguised as the Biosphere Report;
  endings Covenant / Severance / Inheritance / Proof / Cycle, chosen by the colony's blocs.
  Full story in `STORY.md`.

## 9. Proof-of-concept results (2026-11-15)

- **M0 tech demo:** continuous zoom surface ↔ orbit ↔ system, worker sim, IndexedDB saves — 60 fps on
  Derek's iPhone. Home planet R=3000 with 89 fixed regions; 9-planet system.
- **Terrain look:** `?look=smooth` (smooth shading + procedural ground textures) preferred over flat
  low-poly up close. Open: globe detail/texturing so the landing patch doesn't show as a square from
  mid-altitude (terrain LOD).
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
