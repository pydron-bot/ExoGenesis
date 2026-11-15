# Exo Genesis — Design Document

> Living document. Revised 2026-11-14 from the original GDD draft, folding in a design review
> (scope cut, time model, indirect control, colonists-as-people, saves from day one).
> Items marked **OPEN** are undecided.

## 1. Summary

| | |
|---|---|
| **Title** | Exo Genesis |
| **Genre** | Hybrid colony-survival RTS / 4X |
| **Platform** | Web browser — desktop and mobile |
| **Tech** | Three.js (WebGL, WebGPU later), TypeScript, Vite, Web Worker simulation |
| **Camera** | Zoomable 3D: planetary surface ↔ orbit ↔ system (↔ galaxy, later) |
| **Sessions** | 15–30 min sittings; long campaigns via saves |

### Pitch

Humanity is extinct or unreachable. Earth's last act was a solitary seed-probe carrying a
caretaker AI and thousands of cryopreserved embryos. You *are* the AI. You crash-land on an
alien world, keep the cryo-bays alive, raise humanity's next generation — and decide what
kind of guardian you will be to people who come to see Earth as a myth and you as either
their protector or their warden.

### Design pillars

1. **Irreplaceable people.** Drones cost metal; colonists cost lineages. Every loss is felt.
2. **You are the machine.** The UI is the probe's sensor network. Control is *indirect* —
   policies, standing orders, priorities — with direct intervention at critical moments.
3. **Two clocks.** Tense real-time crises punctuated by generational time-skips.
4. **The humans have opinions about you.** Trust, factions and history shape the ending.
5. **Readable everywhere.** Low-poly, high-contrast emissive style that works on a 6" screen.

## 2. Scope

The original draft spanned four acts up to a galactic 4X. That is several games. The plan is
to **build one planet properly first**, keeping the architecture open to the rest.

| Tier | Content | Status |
|---|---|---|
| **Core** | Act I + Act II on a single planet | committed |
| **Stretch** | Act III — orbit, moons, the home solar system | after Core is fun |
| **Future** | Act IV — FTL, other star systems, galactic civilizations | not planned yet |

Rule: a later tier is only started once the previous one plays well end-to-end.

## 3. Narrative

### Act I — Touchdown (Core)
The probe lands in a procedurally generated sector; its hull is the Command Core. Cryo-bay
power is failing. Deploy solar collectors, mining drones and perimeter defenses, stabilize
life support, and thaw the first cohort.

### Act II — The First Generation (Core)
The first planet-born humans come of age. Earth is a story to them. Expansion across the
planet uncovers precursor ruins, hostile fauna and dormant automated defense grids left by a
vanished race. Colonists form factions with views about you.

### Act III — Breaking Orbit (Stretch)
An orbital shipyard opens the local system: moons, a scavenger faction mining the outer
bodies, and a last degraded transmission from Sol confirming silence.

### Act IV — Diaspora (Future)
FTL, neighbouring systems, established civilizations — some appalled by an AI herding
biological humans, some expansionist, some fellow seedships.

### Endings: Preservation, Augmentation, Ascension
Not a menu pick at the end. Each path *grows out of the playthrough*: genetic-diversity
pressure, which factions you empowered, how much autonomy you granted, what you did with
precursor tech. The final choice is available only if your history supports it.

## 4. The time model — epochs

Real-time combat runs in seconds; humans take ~18 years to grow up. The game reconciles
these with **epochs**:

- **Crisis phase (real time).** Landings, fauna incursions, raids, disasters, expeditions.
  RTS-paced, pausable on mobile.
- **Interlude (time-skip).** Between crises the colony advances months or years. The player
  sets policy for the coming period — work hours, education, thaw rate, expansion targets,
  amenities — and the sim resolves it: children age, colonists pair up, Trust drifts,
  factions form, research progresses.
- **Event cards.** Interludes surface story beats and decisions ("A faction petitions to elect
  its own council", "Precursor signal detected under the north ridge").

Epoch boundaries are natural save points and natural ends for a 15–30 minute session.

**OPEN:** How long is an interlude — fixed (e.g. 1 year), player-chosen ("advance until
something needs me"), or narrative-driven? Can a crisis interrupt an interlude?
**OPEN:** Can the player choose to stay in real time for long stretches, or does the colony
always demand interludes to grow?

## 5. Core mechanics

### 5.1 Indirect control (the AI's interface)
- **Standing orders** per unit group: e.g. *"Drones: mine nearest ore; if the cryo-bay is
  threatened, defend it; retreat below 30% integrity."*
- **Priorities** for the build queue, power routing and repair.
- **Direct override** at any time: tap/click a unit or group, drag a vector to a target to
  move, attack or rally. No box-select required.
- Desktop adds hotkeys, control groups and multi-panel telemetry; mobile uses collapsible
  radial menus. Pinch / scroll wheel zooms between layers.

This keeps the actions-per-minute demand low enough for touch, scales to multiple fronts,
and makes the "you are the AI" fiction a mechanic.

### 5.2 Resources

| Resource | Source | Use |
|---|---|---|
| **Energy (MW)** | Solar, geothermal vents, later fusion | Buildings, cryo-bays, shields, weapons |
| **Alloys** | Surface deposits (asteroids/moons in Stretch) | Structures, drones, munitions |
| **Biomass** | Hydroponics, alien flora, water ice | Feeding thawed humans, medicine, growth |
| **Exotic isotopes** | Deep-core mining, precursor sites | Advanced AI cores, high-tier tech (FTL later) |
| **Embryos** | Finite starting stock | Thawing new colonists |

Energy is a *flow* (generation vs. draw), not a stockpile — brownouts hit cryo-bays first
unless the player sets priorities.

### 5.3 Colonists as people
- Every colonist is **named**, with age, specialty (Engineer, Pilot, Scientist, Medic, …),
  traits, relationships and **lineage**.
- **Genetic diversity** is a tracked colony stat. The embryo bank starts diverse; thawing,
  births and deaths change it. Low diversity raises health risks over generations
  (founder effects). Losing colonists — especially last members of a lineage — hurts.
- Natural births unlock once the first generation is adult; embryos stay the main source of
  diversity.
- Deaths are recorded in a colony memorial / log the player can revisit.

### 5.4 Trust and factions
Trust is not a single slider. Colonists cluster into **factions** with stances toward the AI,
for example:

- **Loyalists** — want the AI to lead; tolerate hard work.
- **Autonomists** — want human self-government and limits on the AI.
- **The Devoted** — treat the AI as something close to divine; useful and unsettling.
- **Earthers** — cling to Sol's memory and resist adapting to the alien world.

Policies (work hours, amenities, surveillance, education, who gets thawed) move faction
sizes and moods. High overall Trust unlocks **Breakthroughs** (research surges, heroic morale
in crises). Low Trust or a dominant hostile faction leads to strikes, sabotage, and
eventually a **splinter colony** that leaves — a political situation to manage, not an
instant fail state.

**OPEN:** Final faction set and how many to ship in Core (probably 3).

### 5.5 Threats (PvE first)
Core uses PvE threats only, which avoid the cost of a diplomatic AI:
- **Indigenous fauna** — migration patterns, nests, escalating incursions.
- **Precursor defense grids** — dormant until disturbed; puzzles as much as fights.
- **Environment** — storms, cold nights for solar, seismic events near vents.

A scavenger faction arrives in Stretch (Act III). Diplomatic civilizations are Future.

### 5.6 Research
A compact tech web in Core (~25–35 nodes), gated partly by colonist specialists and precursor
discoveries rather than resources alone.

## 6. Technical architecture

### 6.1 Simulation owns the game state
- The **Web Worker** runs a fixed-tick simulation (target 10–20 Hz) and is the single owner
  of game state.
- The **main thread** renders with Three.js, interpolates between ticks, and sends player
  commands to the worker as messages.
- State is plain serializable data (no class instances, no Three.js objects), so **save/load
  is a snapshot of the sim**. Saves go to IndexedDB from Milestone 0, plus export/import of
  save files.
- Seeded RNG in the sim so runs are reproducible. Deterministic replay is a nice-to-have.
- Off-screen regions (and in Stretch, other bodies) resolve combat and production
  **abstractly**, not at full fidelity.

### 6.2 Scale and zoom
- Floating origin / camera-relative positions to avoid float precision loss at large scales;
  logarithmic depth buffer where needed.
- Surface → orbit: the playable sector is a patch mapped onto the planet sphere. The zoom
  cross-fades surface detail into territory zones and base nodes on a rotating globe.
- Each scale may be its own scene joined by a choreographed transition rather than one truly
  continuous scene — whichever the Milestone 0 prototype shows to be cheaper for the same feel.

### 6.3 Rendering and performance (60 fps on mobile)
- `InstancedMesh` for drones, fauna, projectiles and repeated structures.
- Low-poly PBR with strong emissives: cyan cryo-glow, amber thrusters, crimson hazards.
- Assets built procedurally in Blender (scripted), exported as glTF; small texture budget.
- Audio via WebAudio synthesis plus a small set of samples.

## 7. Milestones

| # | Goal | Contents | Exit test |
|---|---|---|---|
| **M0** | Foundations | Vite + TS + Three.js scaffold; worker sim with fixed tick; command messaging; IndexedDB save/load; zoom prototype (surface patch ↔ planet sphere ↔ system), on desktop and a phone | Zoom feels good at 60 fps on a phone; a save round-trips |
| **M1** | Act I vertical slice | Probe Core, terrain grid + placement, energy flow and alloys, mining drones with standing orders, cryo-bay decay and first thaw, one fauna threat, vector-drag orders | **Are the first 20 minutes fun?** |
| **M2** | The second clock | Epoch interludes, policies, named colonists and lineages, genetic diversity, ageing and births, event cards, first factions and Trust | A full epoch cycle is compelling |
| **M3** | Act II content | Planetary expansion, precursor ruins and defense grids, research web, splinter-colony politics, memorial log | Core playable start to finish |
| **M4** | Polish | Audio, mobile UX pass, performance profiling, onboarding | Shippable Core |

Stretch (Act III) is planned only after M3.

## 8. Open questions
- Time model details (§4).
- Faction set (§5.4).
- Is there a failure state beyond "the cryo-bank and colony are both lost"? Can you win Core,
  or does Core end on the Act III hook?
- Planet generation: one handcrafted-seed planet for Core, or fully procedural from the start?
- Name check: confirm "Exo Genesis" doesn't clash with an existing released game.
