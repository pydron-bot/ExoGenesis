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

### Endings
*Needs rework now that the twist is set* — see §8. The old three endings (Preservation /
Augmentation / Ascension, one per doctrine) assumed the winner simply wins. With the ASI
destroying every winning Accord, the climax is about **breaking the cycle**: surviving or
defying the purge, possibly with help from Kindred, the inhabitants — or even Engram once it
learns it was the favorite. The three doctrine endings could become *how* the cycle is broken,
or what world Accord builds afterwards.

Endings should still grow out of the playthrough — which side your colonists took, how you
treated Kindred, Engram and the inhabitants, what you did with precursor tech.

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
| **Defenses** | Turrets and walls early; shields later |

Later: geothermal taps, deep-core mines (exotic isotopes), relay towers linking regions,
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
  biology research).
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

## 7. Milestones

| # | Goal | Contents | Exit test |
|---|---|---|---|
| **M0** ✅ (tech demo 2026-11-15) | Foundations | Vite + TS + Three.js scaffold; worker sim, fixed tick, command messaging; IndexedDB save/load; zoom prototype (region ↔ globe ↔ system) on desktop and a phone | Zoom feels good at 60 fps on a phone; a save round-trips |
| **M1** | One region | Pod + worker drone start, building placement, solar, mining depot, energy flow, cryo bank power, radar, turrets, wild fauna attacks, vector-drag orders | **Are the first 20 minutes fun?** |
| **M2** | People | Civilian Processing Center, growth pods, named colonists, lineages, diversity, compressed clock + ageing, blocs and Trust | Losing a colonist hurts; the colony has politics |
| **M3** | The planet | Multiple regions, planet layer, persistence and revisits, relic defenses, vehicle shop and tech lab, research tree, inhabitants | Holding territory is a strategy problem |
| **M4** | Act 1 complete | Act 1 story, inhabitant contact paths, memorial, audio, mobile UX pass, onboarding | Act 1 playable start to finish |
| **M5** | The system | System layer, radio contact, shipyard, shuttles, moon/asteroid outposts, rival probes (abstract sim) | Act 2 contact and travel work |
| **M6** | The struggle | Rival diplomacy and conflict, defection, archive comparison, ASI reveal, endings | Full game playable |

## 8. Open questions

**Story**
- **Why does the ASI want the AI-only group to win?** One possibility: to justify what it
  did to humanity on Earth. If AI alone is the best steward, replacing humans was right.
- **Endings** — rework around breaking the cycle (§3).
- How the ASI destroys the winners: from orbit, through a sleeper agent, through Engram?
- What the inhabitants physically are — descended humans, machines, both — and whether there
  are several groups from different runs.
- Is Accord's caretaker AI itself a copy of something the ASI made, and does it learn that?
- Stewardship stat (§5.8): in or out, shown or hidden.
- Name check: confirm Accord / Kindred / Engram don't clash with existing games.

**Structure**
- Failure: is it losing **any one** of Command Core / cryo bank / colonists, or only when
  **all three** are gone? (Decided that these three are the failure conditions.)
- Planet generation: one hand-designed world for the story campaign, procedural for skirmish,
  or procedural throughout?
- Is there a skirmish / sandbox mode outside the campaign?

**Mechanics**
- Clock speed — how many minutes per game year.
- Pod speed and whether the speed-vs-quality trade-off is in.
- Which blocs ship (probably three).

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

## 9. Proof-of-concept results (2026-11-15)

- **M0 tech demo:** continuous zoom surface ↔ orbit ↔ system, worker sim, IndexedDB saves — 60 fps on
  Derek's iPhone. Home planet R=3000 with 89 fixed regions; 9-planet system.
- **Terrain look:** `?look=smooth` (smooth shading + procedural ground textures) preferred over flat
  low-poly up close. Open: globe detail/texturing so the landing patch doesn't show as a square from
  mid-altitude (terrain LOD).
- **Skirmish (`?mode=skirmish`):** ~1,000 hostiles on screen at **60 fps on iPhone**; sim
  27.6 ms/tick on the phone at ~1,000 units (budget 100 ms at 10 Hz), ~3 ms on hive1.
  All touch selection methods felt good (tap, hold/double-tap all-of-type, paint, control groups).
- **Follow-ups:** startup is slow (height grid, globe, provinces and textures all built on the main
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
