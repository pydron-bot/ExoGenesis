/**
 * The procedural models already in the game, so the asset browser can show
 * them next to imported files (and export them to .glb as a starting point).
 * Editor only.
 */
import * as THREE from 'three';
import { buildBattery, buildCannon, buildCore, buildDeposit, buildDepot, buildDrone, buildGate, buildGeothermal, buildPrinter, buildPointDefense, buildRadar, buildBay, buildLaunchGantry, buildCivic, buildFarm, buildRepairPad, buildScaffold, buildSolar, buildTurret, buildVent, buildWall } from '../world/building-models';
import { ARCHETYPES, Mesher, floraMaterial, mulberry, palette } from '../world/flora';
import { BODY_PLAN_NAMES, buildCreatureLook, creatureMaterial } from '../world/fauna-models';
import { STANDINS } from '../world/inhabitant-models';
import { BUILTIN_UNITS, creatureGeo, roverGlow, tankGlow, unitMaterials, wholeGeo } from '../world/army/models';

export interface Builtin {
  id: string;
  name: string;
  group: string;
  /** Source file that builds it. */
  where: string;
  /** Content record that uses it while that record has no `model` set. */
  usedBy?: { coll: 'units' | 'buildings'; id: string };
  /** False if the game can't swap it for an asset model (yet). */
  swappable: boolean;
  note?: string;
  build(): THREE.Object3D;
}

const glowMat = () => new THREE.MeshBasicMaterial({ color: '#5ff3ff', toneMapped: false });

function unit(geo: THREE.BufferGeometry, mat: THREE.Material, glow?: THREE.BufferGeometry) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  if (glow) g.add(new THREE.Mesh(glow, glowMat()));
  return g;
}

function floraSpecies(index: number): THREE.Object3D {
  const arch = ARCHETYPES[index];
  const m = new Mesher();
  arch.build(mulberry(1000 + index * 7), palette(mulberry(77 + index * 13)), m);
  return new THREE.Mesh(m.build(true), floraMaterial(false));
}

export const BUILTINS: Builtin[] = [
  { id: 'core', name: 'Command Core', group: 'Buildings', where: 'src/world/building-models.ts buildCore()', usedBy: { coll: 'buildings', id: 'core' }, swappable: false, note: 'Fixed: the landing cinematic animates its parts.', build: buildCore },
  { id: 'solar', name: 'Solar Array', group: 'Buildings', where: 'src/world/building-models.ts buildSolar()', usedBy: { coll: 'buildings', id: 'solar' }, swappable: true, build: buildSolar },
  { id: 'depot', name: 'Mining Depot', group: 'Buildings', where: 'src/world/building-models.ts buildDepot()', usedBy: { coll: 'buildings', id: 'depot' }, swappable: true, build: buildDepot },
  { id: 'battery', name: 'Battery Bank', group: 'Buildings', where: 'src/world/building-models.ts buildBattery()', usedBy: { coll: 'buildings', id: 'battery' }, swappable: true, build: buildBattery },
  { id: 'turret', name: 'Defense Turret', group: 'Buildings', where: 'src/world/building-models.ts buildTurret()', usedBy: { coll: 'buildings', id: 'turret' }, swappable: true, note: 'An asset model won\'t aim: the built-in turns its "head" part toward targets.', build: buildTurret },
  { id: 'radar', name: 'Radar', group: 'Buildings', where: 'src/world/building-models.ts buildRadar()', usedBy: { coll: 'buildings', id: 'radar' }, swappable: true, note: 'An asset model won\'t spin: the built-in turns its "dish" part.', build: buildRadar },
  { id: 'launch-gantry', name: 'Launch Gantry', group: 'Buildings', where: 'src/world/building-models.ts buildLaunchGantry()', usedBy: { coll: 'buildings', id: 'launch-gantry' }, swappable: true, build: buildLaunchGantry },
  { id: 'bay', name: 'Vehicle Bay', group: 'Buildings', where: 'src/world/building-models.ts buildBay()', usedBy: { coll: 'buildings', id: 'bay' }, swappable: true, note: 'Units roll out of the door side (−Z).', build: buildBay },
  { id: 'cannon', name: 'Siege Cannon', group: 'Buildings', where: 'src/world/building-models.ts buildCannon()', usedBy: { coll: 'buildings', id: 'cannon' }, swappable: true, note: 'An asset model won\'t aim: the built-in turns its "head" part.', build: buildCannon },
  { id: 'pointdefense', name: 'Point Defense', group: 'Buildings', where: 'src/world/building-models.ts buildPointDefense()', usedBy: { coll: 'buildings', id: 'pointdefense' }, swappable: true, note: 'An asset model won\'t aim: the built-in turns its "head" part.', build: buildPointDefense },
  { id: 'repairpad', name: 'Repair Pad', group: 'Buildings', where: 'src/world/building-models.ts buildRepairPad()', usedBy: { coll: 'buildings', id: 'repairpad' }, swappable: true, build: buildRepairPad },
  { id: 'wall', name: 'Wall segment', group: 'Buildings', where: 'src/world/building-models.ts buildWall()', usedBy: { coll: 'buildings', id: 'wall' }, swappable: true, note: 'Runs along local Z, one Clearance long.', build: buildWall },
  { id: 'gate', name: 'Gate', group: 'Buildings', where: 'src/world/building-models.ts buildGate()', usedBy: { coll: 'buildings', id: 'gate' }, swappable: true, note: 'Runs along local Z, one Clearance long.', build: buildGate },
  { id: 'geothermal', name: 'Geothermal Tap', group: 'Buildings', where: 'src/world/building-models.ts buildGeothermal()', usedBy: { coll: 'buildings', id: 'geothermal' }, swappable: true, build: buildGeothermal },
  { id: 'printer', name: 'Matter Printer', group: 'Buildings', where: 'src/world/building-models.ts buildPrinter()', usedBy: { coll: 'buildings', id: 'printer' }, swappable: true, build: buildPrinter },
  { id: 'civic', name: 'Civilian Center', group: 'Buildings', where: 'src/world/building-models.ts buildCivic()', usedBy: { coll: 'buildings', id: 'civic' }, swappable: true, note: 'Growth pods are parts named "gpod" (lit while a child grows); drawn instead of exo-civic when zoomed out.', build: buildCivic },
  { id: 'hydroponics', name: 'Hydroponics', group: 'Buildings', where: 'src/world/building-models.ts buildFarm()', usedBy: { coll: 'buildings', id: 'hydroponics' }, swappable: true, build: buildFarm },
  { id: 'vent', name: 'Geothermal vent', group: 'Terrain', where: 'src/world/building-models.ts buildVent()', swappable: false, note: 'Placed with the map editor (Vents).', build: () => buildVent(1) },
  { id: 'deposit', name: 'Alloy deposit', group: 'Terrain', where: 'src/world/building-models.ts buildDeposit()', swappable: false, note: 'Placed with the map editor (Deposits).', build: () => buildDeposit(1) },
  { id: 'scaffold', name: 'Construction scaffold', group: 'Buildings', where: 'src/world/building-models.ts buildScaffold()', swappable: false, note: 'Shown while any building is under construction.', build: buildScaffold },
  { id: 'drone', name: 'Worker drone', group: 'Units', where: 'src/world/building-models.ts buildDrone()', swappable: false, note: 'Not a content record: the game uses the exo-drone asset when there is one (drones and ore haulers), this built-in when zoomed out.', build: buildDrone },
  { id: 'rover', name: 'Rover', group: 'Units', where: 'src/world/army/models.ts roverGeo()', usedBy: { coll: 'units', id: 'rover' }, swappable: true, build: () => unit(wholeGeo(BUILTIN_UNITS.rover), unitMaterials()[0], roverGlow()) },
  { id: 'tank', name: 'Tank', group: 'Units', where: 'src/world/army/models.ts tankGeo()', usedBy: { coll: 'units', id: 'tank' }, swappable: true, build: () => unit(wholeGeo(BUILTIN_UNITS.tank), unitMaterials()[1], tankGlow()) },
  { id: 'swarmer', name: 'Swarmer', group: 'Fauna', where: 'src/world/army/models.ts creatureGeo(false)', usedBy: { coll: 'units', id: 'swarmer' }, swappable: true, build: () => unit(creatureGeo(false), unitMaterials()[2]) },
  { id: 'brute', name: 'Brute', group: 'Fauna', where: 'src/world/army/models.ts creatureGeo(true)', usedBy: { coll: 'units', id: 'brute' }, swappable: true, build: () => unit(creatureGeo(true), unitMaterials()[3]) },
  ...(['artillery', 'arc', 'engineer', 'scout', 'skiff', 'gunboat', 'barge'] as const).map((id): Builtin => ({
    id, name: id[0].toUpperCase() + id.slice(1), group: 'Units', where: `src/world/army/models.ts ${id}Geo()`, usedBy: { coll: 'units', id }, swappable: true,
    build: () => unit(wholeGeo(BUILTIN_UNITS[id]), BUILTIN_UNITS[id].material(), BUILTIN_UNITS[id].glow?.()),
  })),
  ...(['spitter', 'burrower', 'strider', 'lurker'] as const).map((id): Builtin => ({
    id, name: id[0].toUpperCase() + id.slice(1), group: 'Fauna', where: `src/world/army/models.ts ${id}Geo()`, usedBy: { coll: 'units', id }, swappable: true,
    build: () => unit(wholeGeo(BUILTIN_UNITS[id]), BUILTIN_UNITS[id].material()),
  })),
  ...BODY_PLAN_NAMES.map((body): Builtin => ({
    id: `wild-${body}`, name: `Wildlife: ${body}`, group: 'Wildlife', where: 'src/world/fauna-models.ts PLANS', swappable: false,
    note: 'A body plan for Nature → Wildlife species, shown in neutral colours; each species bakes in its own.',
    build: () => new THREE.Mesh(buildCreatureLook({ body, color: '#b89a7a', accent: '#5a4a3a', glow: '#9ff6ff' }), creatureMaterial()),
  })),
  ...([
    ['vell', 'Vell walker'], ['vellkeeper', 'Vell song-keeper'], ['vellhut', 'Vell stilt hut'], ['vellstones', 'Vell fire circle'],
    ['cantor', 'Choir cantor'], ['tender', 'Choir tender'], ['pylon', 'Choir pylon'],
  ] as const).map(([id, name]): Builtin => ({
    id, name, group: 'Inhabitants', where: 'src/world/inhabitant-models.ts STANDINS', swappable: false,
    note: `Low-poly stand-in for exo-${id}: drawn instead when the camera is zoomed out (the asset's Far stand-in field), and while the file loads.`,
    build: STANDINS[id],
  })),
  ...ARCHETYPES.map((a, i): Builtin => ({
    id: `flora-${a.name}`, name: `Flora: ${a.name}`, group: 'Flora', where: `src/world/flora.ts ARCHETYPES[${i}]`, swappable: false,
    note: 'One random variant; every seed builds its own species from this archetype.', build: () => floraSpecies(i),
  })),
];

export const builtinById = (id: string) => BUILTINS.find((b) => b.id === id);

// Roster batches A and B (docs/ROSTER.md, v0.25–v0.28): the built-ins drawn when zoomed out
// (RegionView level of detail; the army's far look for units) and while the Blender files load.
import { ROSTER_BUILDINGS, buildCache, buildWreck } from '../world/roster-models';
BUILTINS.push(
  ...([['sensor', 'Sensor Mast'], ['habitat', 'Habitat Block'], ['relay', 'Relay Tower'], ['lab', 'Tech Lab'], ['deepmine', 'Deep-Core Mine'], ['fusion', 'Fusion Cell']] as const).map(([id, name]): Builtin => ({
    id, name, group: 'Buildings', where: 'src/world/roster-models.ts', usedBy: { coll: 'buildings', id }, swappable: true,
    note: `Drawn instead of exo-${id} when the camera is zoomed out, and while it loads.`, build: ROSTER_BUILDINGS[id],
  })),
  ...([['lancer', 'Lancer', 'Units'], ['nest', 'Nest', 'Fauna'], ['sentinel', 'Relic Sentinel', 'Relics'], ['gridnode', 'Grid Node', 'Relics']] as const).map(([id, name, group]): Builtin => ({
    id, name, group, where: `src/world/army/models.ts BUILTIN_UNITS.${id}`, usedBy: { coll: 'units', id }, swappable: true,
    note: `The far-off look of exo-${id} (the army draws it beyond the zoom threshold).`,
    build: () => unit(wholeGeo(BUILTIN_UNITS[id]), BUILTIN_UNITS[id].material(), BUILTIN_UNITS[id].glow?.()),
  })),
  { id: 'wreck', name: 'Wreck', group: 'World', where: 'src/world/roster-models.ts buildWreck()', swappable: false, note: 'Region wrecks: drawn instead of exo-wreck when zoomed out.', build: buildWreck },
  { id: 'cache', name: 'Relic Cache', group: 'Relics', where: 'src/world/roster-models.ts buildCache()', swappable: false, note: 'Relic caches: drawn instead of exo-cache when zoomed out.', build: buildCache },
);


// Roster batch C (v0.37): built-in looks (zoomed out, and while the Blender files load)
import { buildMedBay, buildMemorial, buildSeedBank, buildShieldProjector } from '../world/batchc-models';
BUILTINS.push(
  ...([['shield', 'Shield Projector', buildShieldProjector], ['seedbank', 'Seed Bank', buildSeedBank]] as const).map(([id, name, build]): Builtin => ({
    id, name, group: 'Buildings', where: 'src/world/batchc-models.ts', usedBy: { coll: 'buildings', id }, swappable: true,
    note: id === 'shield' ? 'Its `ring` turns while the dome is up; `charge` parts glow with the charge.' : 'Its `ring` turns while it restores land; `charge` parts glow.', build,
  })),
  ...([['medbay', 'Med Bay', buildMedBay], ['memorial', 'Memorial', buildMemorial]] as const).map(([id, name, build]): Builtin => ({
    id, name, group: 'Buildings', where: 'src/world/batchc-models.ts', usedBy: { coll: 'buildings', id }, swappable: true,
    note: id === 'medbay' ? 'Its `charge` beacon flashes while stretcher crews are out.' : 'Its `charge` flame flickers.', build,
  })),
  ...([['aegis', 'Aegis Crawler'], ['medevac', 'Medevac']] as const).map(([id, name]): Builtin => ({
    id, name, group: 'Units', where: `src/world/army/models.ts BUILTIN_UNITS.${id}`, usedBy: { coll: 'units', id }, swappable: true,
    build: () => unit(wholeGeo(BUILTIN_UNITS[id]), BUILTIN_UNITS[id].material(), BUILTIN_UNITS[id].glow?.()),
  })),
);

// Water buildings (v0.35): built-ins only so far
import { buildPier, buildShipyard, buildTidal } from '../world/sea-models';
import { buildSeaTurret } from '../world/building-models';
BUILTINS.push(
  ...([['shipyard', 'Shipyard', buildShipyard], ['tidal', 'Tidal Generator', buildTidal], ['pier', 'Pier', buildPier], ['seaturret', 'Sea Turret', buildSeaTurret]] as const).map(([id, name, build]): Builtin => ({
    id, name, group: 'Buildings', where: id === 'seaturret' ? 'src/world/building-models.ts buildSeaTurret()' : 'src/world/sea-models.ts', usedBy: { coll: 'buildings', id }, swappable: true,
    note: 'Built on the water: its origin is the waterline, piles reach down into the sea.', build,
  })),
);

// Air layer (v0.36): built-ins only so far
import { buildAirpad, buildFlak } from '../world/air-models';
BUILTINS.push(
  ...([['airpad', 'Airpad', buildAirpad], ['flak', 'Flak Tower', buildFlak]] as const).map(([id, name, build]): Builtin => ({
    id, name, group: 'Buildings', where: 'src/world/air-models.ts', usedBy: { coll: 'buildings', id }, swappable: true,
    note: id === 'flak' ? 'An asset model won\'t aim: the built-in turns its "head" part.' : 'Flyers lift off the pad on the door side (local −Z).', build,
  })),
  ...([['gunship', 'Gunship', 'Units'], ['skimmerwing', 'Skimmerwing', 'Fauna']] as const).map(([id, name, group]): Builtin => ({
    id, name, group, where: `src/world/army/models.ts ${id}Geo()`, usedBy: { coll: 'units', id }, swappable: true,
    note: 'Flies: drawn 10 u up with a shadow on the ground under it.',
    build: () => unit(wholeGeo(BUILTIN_UNITS[id]), BUILTIN_UNITS[id].material(), BUILTIN_UNITS[id].glow?.()),
  })),
);
