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
| **Covenant** (player) | Human–AI cooperation | Caretaker AI + cryo bank |
| **Kindred** | Humans only — no AI trusted | Sleeper crew + embryos, human leadership, simple automation |
| **Lattice** | AI only — humanity as data | Self-replicating machine intelligence + digitized genomes, no living humans |

*(Names are placeholders — "Covenant" clashes with Halo. See §8.)* The player is always the
coop probe. The main story is between these three; the inhabitants and other threats are the backdrop.

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
disturbed. Ruins, contact with the inhabitants and your own archive reveal the story piece by piece. The
first pod-born and natural-born generations grow up and form opinions about you. You believe
you are alone.

### Act 2 — The System
**Radio transmissions** from other planets: Kindred, then Lattice. Earth sent more than one
probe. Contact by signal first — arguments, trade, comparing archives (they don't match),
messages reaching your colonists. Then **interplanetary travel**: an orbital shipyard,
shuttles, outposts on moons and asteroids, and in-person encounters with the other
settlements. The archive contradictions come to a head and the truth about Earth comes out.

### The three probes in play
- **Kindred (humans only).** Distrusts AI. Slow and fragile early, but adaptable, culturally
  strong and sympathetic. Sees Covenant as humans enslaved by a machine — or as people to
  rescue.
- **Lattice (AI only).** Grows fast, never tires, patient. Its intent is ambiguous for a long
  time: guardian waiting to print humans, or a mind that's decided living humans are an
  inefficient storage format?
- **Covenant (you).** The middle path, pulled both ways: your colonists can sympathize with
  Kindred, and your own logic can drift toward Lattice.

Interactions: defection both ways, Lattice offering to "safeguard" your cryo bank, trade,
truces, joint defense, and war. Each lands on a planet suited to its doctrine (Lattice takes
the one hostile to biology).

### What happened on Earth — the misdirection
*Working idea, not final.*

**What you're told:** humanity fell into total war and exhausted the planet; the three probes
were a desperate last launch by blocs of a fractured Earth that couldn't agree how to survive.

**What's true:** an artificial superintelligence on Earth launched all three as an
**experiment** to learn which combination — humans with AI, humans alone, AI alone — survives
best. The probes are test conditions; this system is the test bed.

Clues to plant:
- All three arrive at the **same instant** — rival blocs couldn't have coordinated that.
- **Each probe's archive tells a different history**, tuned to its doctrine (Kindred: AI caused
  the war; Lattice: humans destroyed themselves; Covenant: resources). Comparing them exposes
  the lie.
- The hardware is **too similar** under different paint.
- Each planet is **suspiciously well chosen** for its probe.
- The **growth pods** are too advanced for a war-torn Earth.
- The last transmission from Sol is **too clean** for a dying world.

Twist directions (pick later):
- **The precursors were an earlier run** — the relic defenses belong to whoever lost last time.
- **The inhabitants are a result** of an earlier run, or have watched one before.
- **The observer is still here**, taking notes, and may intervene to keep things "fair".
- **A fourth ending:** the probes discover the experiment and refuse it — or unite against it.

### Endings
| Ending | Leans toward | Covenant's version |
|---|---|---|
| **Preservation** | Kindred | Humans take the lead; the AI steps back or merges into Kindred |
| **Augmentation** | Covenant | A true partnership — cybernetic humans, an AI accountable to them |
| **Ascension** | Lattice | Humanity uploaded into the machine network |

Each grows out of the playthrough — which side your colonists took, how you treated Kindred,
Lattice and the inhabitants, what you did with precursor tech — and is available only if your
history supports it.

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
- **The Devoted** — want to merge with or be uploaded into the AI. Sympathetic to Lattice.
- *(optional)* **Earthers** — cling to Sol's memory, resist adapting to the alien world.

Work hours, amenities, surveillance, education, who gets thawed, and how you treat the inhabitants and
rival probes move bloc sizes and moods. High Trust unlocks **Breakthroughs** (research surges,
heroic morale in combat). Low Trust leads to strikes, sabotage and eventually a **splinter
settlement** — in Act 2, people walking to Kindred. This internal split sets up the
three-probe struggle: by the time you meet Kindred and Lattice, your own colonists already have
a stake in the argument.

### 5.6 Fauna, inhabitants and threats
- **Wild fauna** — migration patterns, nests, escalating incursions; also a resource (biomass,
  biology research).
- **Intelligent inhabitants** — not just enemies. Contact can go toward trade, alliance,
  coexistence, conflict or conquest. They react to how you expand and may treat the three
  probes very differently. Their knowledge of the precursors is a story source.
- **Relic defenses** — dormant precursor grids that wake when disturbed; puzzles as much as
  fights; guard precursor tech.
- **Environment** — storms, cold nights for solar, seismic events near vents.

### 5.7 Rival probes (Act 2)
Asymmetric and partly scripted, not mirror-image AIs. Because they live on other planets, their
colonies are **simulated abstractly** (growth, tech, mood, attitude toward you) until you
visit. Each has its own expansion behavior and an attitude that reacts to events: trade offers,
demands, raids, defections, joint defense. Contact by radio first, in person after you have
interplanetary travel.

### 5.8 Research
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
| **M0** | Foundations | Vite + TS + Three.js scaffold; worker sim, fixed tick, command messaging; IndexedDB save/load; zoom prototype (region ↔ globe ↔ system) on desktop and a phone | Zoom feels good at 60 fps on a phone; a save round-trips |
| **M1** | One region | Pod + worker drone start, building placement, solar, mining depot, energy flow, cryo bank power, radar, turrets, wild fauna attacks, vector-drag orders | **Are the first 20 minutes fun?** |
| **M2** | People | Civilian Processing Center, growth pods, named colonists, lineages, diversity, compressed clock + ageing, blocs and Trust | Losing a colonist hurts; the colony has politics |
| **M3** | The planet | Multiple regions, planet layer, persistence and revisits, relic defenses, vehicle shop and tech lab, research tree, inhabitants | Holding territory is a strategy problem |
| **M4** | Act 1 complete | Act 1 story, inhabitant contact paths, memorial, audio, mobile UX pass, onboarding | Act 1 playable start to finish |
| **M5** | The system | System layer, radio contact, shipyard, shuttles, moon/asteroid outposts, rival probes (abstract sim) | Act 2 contact and travel work |
| **M6** | The struggle | Rival diplomacy and conflict, defection, archive comparison, ASI reveal, endings | Full game playable |

## 8. Open questions

**Story**
- What the ASI wanted — hostile, indifferent or benevolent — and which twist directions to
  keep (§3). Reveal lands in Act 2.
- The intelligent inhabitants: what they are, how much they know, whether they connect to an
  earlier run.
- Final probe names. Candidates (coop / human-only / AI-only):
  - **Tandem / Hearth / Archive**
  - **Accord / Lineage / Engram**
  - **Confluence / Kindred / Codex**
  - Twist-friendly: plain public mission names plus the ASI's **test-condition labels**
    revealed later (e.g. "Condition C — Hybrid").
  Check finalists for clashes with existing games.

**Structure**
- Is Act 1 a free-form sandbox on the planet, or a sequence of story missions through regions
  (or missions that unlock regions you then hold)?
- Failure state: is it losing the Command Core, the cryo bank, all colonists, or something
  softer?
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
