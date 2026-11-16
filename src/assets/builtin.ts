/**
 * The procedural models already in the game, so the asset browser can show
 * them next to imported files (and export them to .glb as a starting point).
 * Editor only.
 */
import * as THREE from 'three';
import { buildBattery, buildCore, buildCreature, buildDeposit, buildDepot, buildDrone, buildRadar, buildBay, buildScaffold, buildSolar, buildTurret } from '../world/region';
import { ARCHETYPES, Mesher, floraMaterial, mulberry, palette } from '../world/flora';
import { creatureGeo, roverGeo, roverGlow, tankGeo, tankGlow, unitMaterials } from '../skirmish/models';

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
  { id: 'core', name: 'Command Core', group: 'Buildings', where: 'src/world/region.ts buildCore()', usedBy: { coll: 'buildings', id: 'core' }, swappable: false, note: 'Fixed: the landing cinematic animates its parts.', build: buildCore },
  { id: 'solar', name: 'Solar Array', group: 'Buildings', where: 'src/world/region.ts buildSolar()', usedBy: { coll: 'buildings', id: 'solar' }, swappable: true, build: buildSolar },
  { id: 'depot', name: 'Mining Depot', group: 'Buildings', where: 'src/world/region.ts buildDepot()', usedBy: { coll: 'buildings', id: 'depot' }, swappable: true, build: buildDepot },
  { id: 'battery', name: 'Battery Bank', group: 'Buildings', where: 'src/world/region.ts buildBattery()', usedBy: { coll: 'buildings', id: 'battery' }, swappable: true, build: buildBattery },
  { id: 'turret', name: 'Defense Turret', group: 'Buildings', where: 'src/world/region.ts buildTurret()', usedBy: { coll: 'buildings', id: 'turret' }, swappable: true, note: 'An asset model won\'t aim: the built-in turns its "head" part toward targets.', build: buildTurret },
  { id: 'radar', name: 'Radar', group: 'Buildings', where: 'src/world/region.ts buildRadar()', usedBy: { coll: 'buildings', id: 'radar' }, swappable: true, note: 'An asset model won\'t spin: the built-in turns its "dish" part.', build: buildRadar },
  { id: 'bay', name: 'Vehicle Bay', group: 'Buildings', where: 'src/world/region.ts buildBay()', usedBy: { coll: 'buildings', id: 'bay' }, swappable: true, note: 'Units roll out of the door side (−Z).', build: buildBay },
  { id: 'deposit', name: 'Alloy deposit', group: 'Terrain', where: 'src/world/region.ts buildDeposit()', swappable: false, note: 'Placed with the map editor (Deposits).', build: () => buildDeposit(1) },
  { id: 'scaffold', name: 'Construction scaffold', group: 'Buildings', where: 'src/world/region.ts buildScaffold()', swappable: false, note: 'Shown while any building is under construction.', build: buildScaffold },
  { id: 'drone', name: 'Worker drone', group: 'Units', where: 'src/world/region.ts buildDrone()', swappable: false, note: 'Not a content record yet.', build: buildDrone },
  { id: 'rover', name: 'Rover', group: 'Units', where: 'src/skirmish/models.ts roverGeo()', usedBy: { coll: 'units', id: 'rover' }, swappable: true, build: () => unit(roverGeo(), unitMaterials()[0], roverGlow()) },
  { id: 'tank', name: 'Tank', group: 'Units', where: 'src/skirmish/models.ts tankGeo()', usedBy: { coll: 'units', id: 'tank' }, swappable: true, build: () => unit(tankGeo(), unitMaterials()[1], tankGlow()) },
  { id: 'swarmer', name: 'Swarmer', group: 'Fauna', where: 'src/skirmish/models.ts creatureGeo(false)', usedBy: { coll: 'units', id: 'swarmer' }, swappable: true, build: () => unit(creatureGeo(false), unitMaterials()[2]) },
  { id: 'brute', name: 'Brute', group: 'Fauna', where: 'src/skirmish/models.ts creatureGeo(true)', usedBy: { coll: 'units', id: 'brute' }, swappable: true, build: () => unit(creatureGeo(true), unitMaterials()[3]) },
  {
    id: 'grazer', name: 'Grazer', group: 'Fauna', where: 'src/world/region.ts buildCreature()', swappable: false, note: 'Not a content record yet.',
    build: () => new THREE.Mesh(buildCreature(), new THREE.MeshStandardMaterial({ color: '#c78a5a', roughness: 0.8, flatShading: true, emissive: '#3a1a10', emissiveIntensity: 0.4 })),
  },
  ...ARCHETYPES.map((a, i): Builtin => ({
    id: `flora-${a.name}`, name: `Flora: ${a.name}`, group: 'Flora', where: `src/world/flora.ts ARCHETYPES[${i}]`, swappable: false,
    note: 'One random variant; every seed builds its own species from this archetype.', build: () => floraSpecies(i),
  })),
];

export const builtinById = (id: string) => BUILTINS.find((b) => b.id === id);
