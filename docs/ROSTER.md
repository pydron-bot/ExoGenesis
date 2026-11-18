# Exo Genesis — Roster proposal (units, buildings, world objects)

Status: **batches A and B built (2026-11-18, v0.25.0–v0.28.0)**: Lancer, Sensor Mast, Habitat Block, Relay
Tower, Nest, wrecks, Tech Lab + research, isotopes, Deep-Core Mine, Fusion Cell (added: an isotope sink),
relic grids. How each works: `TECH.md` §6. Batch C and the rest of the lists below are still proposals. Each item lists what it is for, the story
hook (if any), and **cost to build**:

- **Data**: content JSON + a Blender model; the sim already supports the behaviour.
- **Small**: a small sim/render change on top of an existing system.
- **System**: needs a new system (research, shields, air units, a new resource).

What exists today: Accord units Rover, Tank, Arc Caster, Artillery, Scout Skimmer, Field
Engineer; fauna Swarmer, Brute, Spitter, Burrower, plus grazer herds; 15 buildings
(`content/buildings/`); inhabitants the Vell and the Choir; region objects deposits, vents,
spawns, camps and sites.

## Where the gaps are

- **Counters.** Arc kills swarms, Tank and Artillery bring splash, but nothing is built to kill
  a single big target. Brutes are only answered by mass.
- **Design's starting set is missing pieces.** DESIGN §5.2 lists a Tech Lab; §5.3 lists exotic
  isotopes and deep-core mines; neither exists. Both are M3 work.
- **The map is mostly terrain.** There are no salvage, nests or ruins to walk to, and nothing
  except deposits to fight over. Scouts have little to find.
- **Stewardship has no levers.** The Biosphere Report story needs something you can *build*
  to restore land, not only things to avoid doing.
- **Relic defenses (M3, E2 Handshake)** have no content yet.

## Accord units

| Unit | Role | Hook | Cost |
|---|---|---|---|
| **Lancer** | Slow-firing rail lance, long single-target damage, no splash. The anti-Brute pick | — | Data (`bolt` weapon, high damage, long cooldown) |
| **Hauler drone** | Visible ore drones shuttling deposit ↔ depot (DESIGN §5.2 "with drones"). Pickable by packs, so mining lines need guarding | Makes the economy readable at a glance | Small |
| **Envoy** | Unarmed. Parks near an inhabitant camp and raises regard over time; replaces "approach" with a unit you have to protect | Vell/Choir trust (E4, E5, E8) | Small |
| **Medevac rover** | Picks up colonists from a destroyed building before they die; drives them home | "Losing a colonist hurts" (M2) | Small–System |
| **Aegis crawler** | Mobile shield bubble that soaks spitter acid and shells | DESIGN "shields later" | System (shields) |

## Buildings

| Building | Role | Hook | Cost |
|---|---|---|---|
| **Habitat Block** | Housing only (+6), cheap, no pods. Lets the colony grow past the Civilian Center | M2 people | Small (housing without pods) |
| **Sensor Mast** | Cheap short-range vision post that pushes back fog; no minimap, no early warning | Covers mining lines and gaps in walls | Data/Small |
| **Tech Lab** | Staffed by scientists; research unlocks (Lancer, Aegis, shields, mast upgrades) | E6 "Too Good" fires when it's built | System (research tree, DESIGN §5.9) |
| **Relay Tower** | Extends build radius; later links regions on the planet layer | M3 region links; E12 "Wrong Address" needs relay tech | Small now, System for region links |
| **Deep-Core Mine** | Mines exotic isotopes, only on an isotope seam; noisy, so it draws packs | M3 resource | System (new resource) |
| **Med Bay** | Treats injured colonists, raises wellbeing near it | M2 wellbeing | Small |
| **Seed Bank / Rewilder** | Spends biomass to restore scarred land around it; raises planet health | Stewardship and the Biosphere Report (STORY §6). The trap: doing well is the danger | Small–System (needs a planet-health number) |
| **Memorial** | Names of the dead (memorial log, DESIGN §5.4); a small wellbeing aura | M4 memorial | Small |
| **Shield Projector** | Base dome; heavy constant power draw | DESIGN "shields later" | System (shields) |

## Fauna

| Creature | Role | Hook | Cost |
|---|---|---|---|
| **Nest** (world object) | Destroyable source of a pack's spawns. Kill it to quiet a region for a while; it regrows | DESIGN §5.6 "nests". Stewardship cost to wiping them out | Small (spawns become objects) |
| **Stalker** | Ambush predator, unseen until close, hunts only at night | First Night tension | Small (reuse burrower's unseen state) |
| **Matriarch** | Slow boss beast that sheds swarmers as it takes damage. Rare, late | Why the Lancer exists | Small |
| **Grazer bull** | Herd defender: neutral until you shoot its herd, then it charges | Stewardship: hunting has a price | Small |
| **Skimmerwing** | Flying pack; ignores walls; only Point Defense and the Arc can hit it | Makes the defense mix matter | System (air layer) |

Designer marks (E9): give the Burrower and Spitter a visible engineered detail on the models
now, so the reveal later has something to point at.

## Relics (precursor tech, M3)

| Object | Role | Hook | Cost |
|---|---|---|---|
| **Relic Sentinel** | Dormant turret that wakes when you build or fight near it, scans you, and partly stands down | E2 Handshake: "firmware lineage 97.3% match" | Small (turret owned by a relic side + a wake trigger) |
| **Grid Node** | Powers nearby sentinels. Destroy or *re-tune* it (puzzle) to shut them off | Relic puzzle-fights | Small |
| **Precursor Cache** | Opened once the grid is down: isotopes, a research unlock, a story log | Deep Layer beat | Small (site + reward) |

## World objects (region map)

| Object | What it does | Hook | Cost |
|---|---|---|---|
| **Earlier-run wreck** | A crashed hull in your own hardware style. Salvage alloys with an Engineer; first visit fires a log | "Hardware too similar", layers of runs | Small (site + salvage) |
| **Precursor ruin** | Layered stone props around sites like `east-stone`; blocks building | E1 The Stone | Data (props) |
| **Isotope seam** | Glowing crystal outcrop; where Deep-Core Mines go | M3 resource | Data (with the mine) |
| **Ice field** | Water ice: a Hydroponics next to one grows more biomass | DESIGN §5.3 "water ice" | Small |
| **Bloom grove** | Alien flora you can harvest for biomass, or leave alone for planet health | Stewardship choice | Small |
| **Tar flats / sinkholes** | Slow ground and burrower holes; shape where you fight | Terrain variety | Small |

## Air layer: release 3 plan (agreed 2026-11-18, not built yet)

Water, hover and air units ship in stages. Stage 1 (v0.34: ground/hover movement, predators path round
water) and stage 2 (v0.35: water units, shore/offshore buildings, Transport Barge) are built: see TECH.md
"Movement types", "Water units and water buildings" and "Performance pass". Stage 3 is air. The player has
decided:
- **Both sides fly:** air units for the colony, and flying fauna. The Skimmerwing above is the first
  flying pack.
- **Anti-air only:** flyers can be hit only by weapons marked as able to hit air (e.g. Point Defense, the
  Arc, a new AA unit or building). Everything else ignores them, so the defence mix matters.

Building on what's there:
- **Movement:** add `air` to the unit `move` choice (`src/content/defs.ts`) and `Move` (`src/sim/path.ts`).
  `offLimits('air', h)` is always false, and air movers never path: steer straight like hover, with no
  `PathGrid` (`moveOf` in `chase`/`goTo`, `unitGrid`, `steer`/`blocked` in `src/sim/core.ts`). Walls and
  buildings don't block them. Skip them in the push-out from building bodies, and in the "never cross a
  wall" check in `stepHostiles`. Flyers separate only from other flyers.
- **Targeting:** new optional `antiAir` bool on units and buildings ("can hit flyers"). Shooters
  (`stepTurrets`, unit targeting in `stepUnits`, `strike`/splash) skip air targets unless `antiAir`.
  Air predators: should they hit ground targets? Probably yes (they dive). Ground predators can't hit
  flyers (bites), unless `antiAir`. `canReach` already returns true for non-ground movers: make sure
  `air` takes that path.
- **Which factory builds flyers:** extend `factoryMakes` (`src/sim/rules.ts`). Options: any factory makes
  air, or a new site/role (an airfield or pad). Decide when building. The Shipyard rule today: shore
  factories make water and hover, land factories make ground and hover.
- **Packs:** flying fauna join via `packEvery`/`packFrom` like the others. They can spawn anywhere (no
  water check like `SEA_REACH`).
- **Drawing:** fly at a height (`src/skirmish/view.ts`, the `lift` by `DEFS[t].move`; add `'air'` to
  `SkUnitDef.move` in `src/skirmish/types.ts`), e.g. 8 to 12 u with a slow bob, banking into turns. Put a
  ground shadow under each flyer: the light-map blob, `colonyLights.addArmy` in `src/world/lights.ts`
  already draws unit shadows. Raise its height so the shadow detaches. Health bars and the selection
  ring sit at the flyer.
- **Picking:** `unitScreen` / `unitAt` in `src/input.ts` use the army's world position (wx, wy, wz), so
  the lift should pick correctly. Check it.
- **Content to add:**
  - **Skimmerwing:** flying fauna pack (ROSTER above).
  - **A colony flyer:** e.g. a gunship or scout drone.
  - **An AA option:** mark Point Defense and the Arc `antiAir`, and maybe a dedicated Flak Tower.
  - Built-in looks go in `src/skirmish/models.ts` (`BUILTIN_UNITS`), with entries in
    `src/assets/builtin.ts`.
- **Tests:** a new `tools/air-smoke.mjs`, after `tools/sea-smoke.mjs` and `tools/hover-smoke.mjs`. Check:
  - flyers cross water and walls in a straight line;
  - a non-AA turret ignores a flyer and an AA one shoots it;
  - a Skimmerwing pack reaches the base over a wall.

  Run the usual suite (units, gameplay, smoke, skirmish, region, sea, hover) and `node tools/sim-bench.mjs`
  before and after.
- **Release:** v0.36.0, with a "What's new" entry (player-facing) and a TECH.md section. Merge to `main` only
  when the user asks.

## Suggested order

1. **Batch A, cheap and fills real gaps (now):** Lancer, Sensor Mast, Habitat Block, Nest,
   Earlier-run wreck. Mostly data plus small sim changes, five Blender models.
2. **Batch B, the M3 core:** Tech Lab + a first research tree, Relic Sentinel / Grid Node /
   Cache, Relay Tower, Deep-Core Mine + isotope seams.
3. **Batch C, new systems:** shields (Aegis, Shield Projector), Skimmerwing + air layer,
   Seed Bank + planet health, Medevac.

Blender models follow the existing set (`blender/`, `content/assets/exo-*.json`); each new item
needs one, and buildings get a light colour like the others.
