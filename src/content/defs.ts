/**
 * Content collections: what lives under /content and what shape each file has.
 *
 * Add a collection: define its shape here, add it to COLLECTIONS, drop JSON files
 * into content/<dir>/. The editor and the checker pick it up automatically.
 * Only add a field once the game actually reads it, so the editor never shows a
 * knob that does nothing.
 */
import { REGION_HALF } from '../sim/types';
import { DRUMS, DRUM_HELP } from '../audio/drums';
import { bool, choice, color, grid, int, list, num, ref, str, type ChoiceField, type Infer, type NumField, type RefField, type Shape, type StrField } from './schema';

/** Attack looks: tracer + sound. */
export const WEAPONS = ['bolt', 'cannon', 'shell', 'arc', 'pd', 'bite', 'spit', 'rail'] as const;
export type Weapon = (typeof WEAPONS)[number];

/** Unit abilities (player-triggered, on a cooldown): what each kind does with its Power, Radius and Seconds. */
export const ABILITIES = ['overdrive', 'boost', 'siege', 'charge', 'pulse', 'mend', 'shield'] as const;
export type Ability = (typeof ABILITIES)[number];
export const ABILITY_HELP: Record<Ability, string> = {
  overdrive: 'fires Power times as fast for Seconds',
  boost: 'moves Power times as fast for Seconds',
  siege: 'digs in for Seconds: can\'t move, range and damage × Power, takes 30% less damage (a move order ends it)',
  charge: 'its next shot (within Seconds) does Power times the damage',
  pulse: 'at once: Power damage to every enemy within Radius (flyers too)',
  mend: 'at once: repairs Power hp on every unit and building of ours within Radius',
  shield: 'for Seconds, our units within Radius take Power less damage (0.5 = half)',
};
export const unitShape = {
  name: str({ label: 'Name' }),
  faction: choice(['accord', 'fauna', 'relic'], { label: 'Faction', help: 'Accord units are the player\'s; fauna attack them; relics are precursor defenses on a relic grid (region map).' }),
  relic: choice(['sentinel', 'node'], { label: 'Relic part', optional: true, help: 'Relics: a sentinel shoots once its grid wakes; a node powers its grid (destroy or re-tune every node to shut the grid down and open its cache).' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  speed: num({ label: 'Speed', min: 0, max: 60, step: 0.1, unit: 'u/s', help: '1 world unit ≈ 10 m.' }),
  range: num({ label: 'Attack range', min: 0, max: 200, step: 0.1, unit: 'u' }),
  damage: num({ label: 'Damage per hit', min: 0, max: 10000 }),
  cooldown: num({ label: 'Attack cooldown', min: 0.05, max: 30, step: 0.05, unit: 's' }),
  splash: num({ label: 'Splash radius', min: 0, max: 50, step: 0.1, unit: 'u', optional: true, help: 'Units inside take half damage.' }),
  minRange: num({ label: 'Minimum range', min: 0, max: 200, step: 0.5, unit: 'u', optional: true, help: 'Can\'t fire at anything closer than this (artillery).' }),
  vsBuildings: num({ label: 'Against buildings', min: 0, max: 10, step: 0.05, optional: true, help: 'Accord units: damage to buildings × this (2 = siege weapon, 0.5 = poor at it). Empty = 1.' }),
  chain: int({ label: 'Chain jumps', min: 0, max: 12, optional: true, help: 'Each hit arcs on to this many more hostiles, each within Chain range of the last, for 70% of the previous hit.' }),
  chainRange: num({ label: 'Chain range', min: 0, max: 40, step: 0.5, unit: 'u', optional: true }),
  weapon: choice(WEAPONS, { label: 'Weapon look', optional: true, help: 'How its attack looks and sounds. Empty = bolt (cannon if it has splash) for vehicles, bite (spit if Attack range > 4) for fauna.' }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', optional: true, help: 'Accord units: repairs damaged units and buildings within Attack range instead of fighting (costs alloys, like a drone\'s repairs).' }),
  nest: bool({ label: 'Nest', optional: true, help: 'Fauna: a nest. One grows on every predator spawn (unless the spawn says no); packs only come from spawns whose nest stands. It never moves or attacks, and regrows after the threat rules\' regrow time.' }),
  guards: int({ label: 'Nest guards', min: 0, max: 30, optional: true, help: 'Nests: swarmers it releases when hurt (at most every 12 s).' }),
  move: choice(['ground', 'hover', 'water', 'air'], { label: 'Moves on', optional: true, help: 'ground (empty): land only, finds its way round water. hover: skims over land and water alike. water: boats and sea creatures, open water only (built at a shore factory, a Shipyard; in packs they start from the nearest water to the spawn). air: flies straight over everything, walls included (built at an airfield, an Airpad). Only shooters that can hit flyers (Anti-air) can hit it.' }),
  antiAir: bool({ label: 'Anti-air', optional: true, help: 'Can hit flyers (units that move on air). Nothing else can: everything else ignores them.' }),
  shield: int({ label: 'Shield', min: 0, max: 100000, unit: 'hp', optional: true, help: 'Accord units: projects a shield bubble (Shield radius) that soaks this much damage from predators outside it before it drops. It recharges at Shield recharge; once down it comes back at 30%.' }),
  shieldRadius: num({ label: 'Shield radius', min: 0, max: 80, step: 0.5, unit: 'u', optional: true, help: 'How far the shield reaches. Anything of ours inside it is covered from attacks that start outside it.' }),
  shieldRegen: num({ label: 'Shield recharge', min: 0, max: 1000, step: 0.5, unit: 'hp/s', optional: true }),
  ability: choice(ABILITIES, { label: 'Ability', optional: true, helps: ABILITY_HELP, help: 'Accord units: a special move the player triggers (G, or the button on the unit card), then waits out its cooldown. Computer players use it too.' }),
  abilityName: str({ label: 'Ability name', optional: true, help: 'As the button shows it, e.g. "Overdrive".', when: { field: 'ability', is: ABILITIES, need: false } }),
  abilityPower: num({ label: 'Ability power', min: 0, max: 10000, step: 0.05, optional: true, help: 'The multiplier, damage, repair or protection (see the kind).', when: { field: 'ability', is: ABILITIES, need: false } }),
  abilitySeconds: num({ label: 'Ability lasts', min: 0, max: 120, step: 0.5, unit: 's', optional: true, when: { field: 'ability', is: ['overdrive', 'boost', 'siege', 'charge', 'shield'], need: false } }),
  abilityRadius: num({ label: 'Ability radius', min: 0, max: 80, step: 0.5, unit: 'u', optional: true, when: { field: 'ability', is: ['pulse', 'mend', 'shield'], need: false } }),
  abilityCooldown: num({ label: 'Ability cooldown', min: 1, max: 600, step: 0.5, unit: 's', optional: true, help: 'Seconds before it can be used again (counted from when it was triggered). Empty = 30.', when: { field: 'ability', is: ABILITIES, need: false } }),
  rescues: int({ label: 'Rescues', min: 0, max: 20, optional: true, help: 'Accord units: a medevac. It drives to colonists lying injured (thrown out of a fallen building) within its Aggro radius, picks up this many, and brings them in to the nearest home (or the Core) before they die. Unarmed.' }),
  carries: int({ label: 'Carries', min: 0, max: 20, optional: true, help: 'Accord transports: how many ground units it can carry. Select ground units and tap it to load them; order it to a spot on land to land them there.' }),
  burrows: bool({ label: 'Burrows', optional: true, help: 'Fauna: travels underground to its target, through walls and unseen (radar still shows it), then surfaces to attack.' }),
  packEvery: int({ label: 'Joins packs: every', min: 0, max: 100, optional: true, help: 'Fauna: every Nth attacker in a pack is one of these (0 or empty = only if the threat rules name it).' }),
  packFrom: int({ label: 'Joins packs: from pack', min: 0, max: 200, optional: true, help: 'Fauna: first pack (0 = the first) it can join.' }),
  radius: num({ label: 'Body radius', min: 0.1, max: 20, step: 0.1, unit: 'u', help: 'Collision and selection size.' }),
  aggro: num({ label: 'Aggro radius', min: 0, max: 200, unit: 'u', help: 'How far it notices enemies on its own.' }),
  sight: num({ label: 'Sight', min: 0, max: 240, unit: 'u', optional: true, help: 'How far it sees through the fog of war. Empty = its aggro or attack range (whichever is longer) + 8.' }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys', optional: true, help: 'Accord units with a cost can be produced at a Vehicle Bay (factory role).' }),
  isotopes: int({ label: 'Isotope cost', min: 0, max: 100000, optional: true, help: 'Exotic isotopes, on top of the alloy cost.' }),
  research: ref('research', { label: 'Needs research', optional: true, help: 'Can\'t be produced until this research is done (Tech Lab).' }),
  buildSeconds: num({ label: 'Production time', min: 0, max: 600, step: 0.5, unit: 's', optional: true }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model from the asset library. Empty = the built-in procedural model.' }),
  modelScale: num({ label: 'Model scale', min: 0.1, max: 10, step: 0.05, default: 1, help: 'Gameplay size, on top of the asset\'s own scale.' }),
} satisfies Shape;
export type UnitDef = Infer<typeof unitShape>;

export const BUILDING_ROLES = ['core', 'solar', 'depot', 'battery', 'turret', 'radar', 'factory', 'wall', 'gate', 'repair', 'geothermal', 'civic', 'farm', 'sensor', 'relay', 'lab', 'deepmine', 'reactor', 'generator', 'shield', 'seedbank', 'medbay', 'memorial', 'printer'] as const;
export type BuildingRole = (typeof BUILDING_ROLES)[number];

export const buildingShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  role: choice(BUILDING_ROLES, {
    label: 'Role',
    help: 'What it does. core: the landed pod (build radius = Range). solar: power that follows daylight. depot: mines the nearest deposit within Range. battery: stores power. turret: shoots hostiles within Range. radar: early warning + minimap. factory: produces combat units (units with a cost). wall: placed as a line of segments (Clearance = segment length); doesn\'t extend the build area. gate: a wall segment your units drive through (Clearance = its length); dropped onto a wall it replaces the segments under it. repair: heals combat units within Range while powered. geothermal: steady power, only on a vent (within Range of one). civic: houses colonists and runs growth pods (Civilian Processing Center; 0 pods = housing only). farm: grows biomass (Hydroponics). sensor: only sees (set its Sight). relay: extends the build area to its Range, like the Core. lab: runs research (Tech Lab). deepmine: mines exotic isotopes from an isotope seam within Range. reactor: steady power while it burns isotopes (Fuel use). generator: steady power (its Power), day and night, no conditions (a Tidal Generator). shield: a shield dome (Shield, Shield radius, Shield recharge) over everything near it, while powered (a Shield Projector). seedbank: heals scarred land within Range (planet health), spending surplus biomass; with nothing to heal it rewilds (a Seed Bank). medbay: stabilises colonists lying injured within Range and brings them in (Treatment time each), cares for the homes within Range and lets people there live longer (a Med Bay). memorial: the names of the dead; homes within Range feel its Comfort, and grief fades faster while one stands (a Memorial). printer: turns spare power into alloys (Mining rate a second while powered); last in line for power and never from the batteries, and it leaves no scars (a Matter Printer).',
  }),
  buildable: bool({ label: 'In build menu', default: true }),
  site: choice(['land', 'water', 'shore'], { label: 'Built on', optional: true, help: 'land (empty): dry ground. water: offshore, all of it over water at least 1 u deep. shore: straddling the waterline, part on land and part over water. A factory on the shore (a Shipyard) builds boats (units that move on water) and hover craft; one on land builds ground units and hover craft.' }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys' }),
  isotopes: int({ label: 'Isotope cost', min: 0, max: 100000, optional: true, help: 'Exotic isotopes, on top of the alloy cost.' }),
  research: ref('research', { label: 'Needs research', optional: true, help: 'Not in the build menu until this research is done (Tech Lab).' }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  powerMW: num({ label: 'Power', min: -100, max: 100, step: 0.1, unit: 'MW', help: 'Positive generates (solar: at noon), negative draws.' }),
  buildSeconds: num({ label: 'Build time', min: 0, max: 600, step: 0.5, unit: 's' }),
  clearance: num({ label: 'Clearance', min: 0, max: 60, step: 0.5, unit: 'u', help: 'Nothing new may be placed closer than this. Half of it is the building\'s body radius.' }),
  range: num({ label: 'Range', min: 0, max: 400, unit: 'u', optional: true, help: 'core, relay: build radius · depot: how far it reaches for a deposit · repair: how far it reaches to units · geothermal: how close to a vent it must be · medbay, memorial: how far its care and comfort reach.' }),
  fireRange: num({ label: 'Firing range', min: 0, max: 400, unit: 'u', optional: true, help: 'Any building with a firing range, damage and cooldown shoots hostiles while powered (turrets; the Core\'s point defense).' }),
  damage: num({ label: 'Damage per shot', min: 0, max: 10000, optional: true }),
  cooldown: num({ label: 'Fire cooldown', min: 0.05, max: 30, step: 0.05, unit: 's', optional: true }),
  splash: num({ label: 'Splash radius', min: 0, max: 50, step: 0.1, unit: 'u', optional: true, help: 'Shooters: hostiles this close to the target take half damage.' }),
  minRange: num({ label: 'Minimum range', min: 0, max: 200, step: 0.5, unit: 'u', optional: true, help: 'Shooters: can\'t fire at anything closer than this.' }),
  weapon: choice(WEAPONS, { label: 'Weapon look', optional: true, help: 'How its shots look and sound. Empty = cannon (shell if it has splash).' }),
  antiAir: bool({ label: 'Anti-air', optional: true, help: 'Shooters: can hit flyers (units that move on air). Nothing else can.' }),
  airOnly: bool({ label: 'Flyers only', optional: true, help: 'Shooters with Anti-air: fires only at flyers, never at anything on the ground (a Flak Tower).' }),
  airfield: bool({ label: 'Airfield', optional: true, help: 'Factories: builds flyers (units that move on air), and only flyers.' }),
  shield: int({ label: 'Shield', min: 0, max: 100000, unit: 'hp', optional: true, help: 'Shield projectors (role shield): the dome soaks this much damage from predators outside it before it collapses. It recharges while powered; once down it comes back at 30%.' }),
  shieldRadius: num({ label: 'Shield radius', min: 0, max: 120, step: 0.5, unit: 'u', optional: true, help: 'Shield projectors: the dome\'s radius. Anything of ours inside it (buildings, units, drones, people) is covered from attacks that start outside it.' }),
  shieldRegen: num({ label: 'Shield recharge', min: 0, max: 1000, step: 0.5, unit: 'hp/s', optional: true, help: 'Shield projectors: while powered.' }),
  restoreRate: num({ label: 'Restore rate', min: 0, max: 10, step: 0.005, unit: 'health/s', optional: true, help: 'Seed banks: planet health points of scarred land healed per second within Range, while powered (staff speed it up). With nothing to heal in reach it rewilds at half this rate, up to the colony rules\' cap.' }),
  restoreCost: num({ label: 'Restore cost', min: 0, max: 1000, step: 0.5, unit: 'biomass/health', optional: true, help: 'Seed banks: biomass spent per health point restored. They only spend what is above a quarter of the colony\'s storage.' }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', optional: true, help: 'Repair pads: hit points per second for each unit in Range, while powered.' }),
  mineRate: num({ label: 'Mining rate', min: 0, max: 100, step: 0.01, unit: '/s', optional: true, help: 'Depots (alloys), deep-core mines (isotopes) and matter printers (alloys from power), while powered.' }),
  fuelRate: num({ label: 'Fuel use', min: 0, max: 10, step: 0.005, unit: 'isotopes/s', optional: true, help: 'Reactors: isotopes burned per second while generating. No isotopes, no power.' }),
  lure: num({ label: 'Noise', min: 0, max: 200, unit: 'u', optional: true, help: 'Predators choosing a building to attack treat this one as this much closer (a loud deep-core drill draws packs).' }),
  treatSeconds: num({ label: 'Treatment time', min: 1, max: 600, step: 0.5, unit: 's', optional: true, help: 'Med bays: while powered, how long it takes to bring in one colonist lying injured within Range (staff speed it up). Everyone injured in Range stops getting worse meanwhile.' }),
  aura: int({ label: 'Comfort', min: 0, max: 40, unit: 'wellbeing', optional: true, help: 'Wellbeing for colonists whose home is within Range, while it stands (and is powered, if it draws power). Two of the same kind don\'t add up.' }),
  storage: num({ label: 'Storage', min: 0, max: 100000, unit: 'MJ', optional: true, help: 'Batteries. 1 MJ = 1 MW for 1 s.' }),
  sight: num({ label: 'Sight', min: 0, max: 240, unit: 'u', optional: true, help: 'How far it sees through the fog of war. Empty = the colony rule\'s building sight (or firing range + 4 if longer).' }),
  housing: int({ label: 'Housing', min: 0, max: 100, optional: true, help: 'Colonists who can live here (civic).' }),
  pods: int({ label: 'Growth pods', min: 0, max: 12, optional: true, help: 'Embryos it can mature at once (civic). Each pod draws the people rules\' pod power and biomass while running.' }),
  biomassRate: num({ label: 'Biomass output', min: 0, max: 20, step: 0.01, unit: '/s', optional: true, help: 'Farms, while powered, before staffing bonuses.' }),
  biomassStorage: num({ label: 'Biomass storage', min: 0, max: 100000, optional: true, help: 'Adds to how much biomass the colony can hold.' }),
  staff: int({ label: 'Staff slots', min: 0, max: 12, optional: true, help: 'Colonists who can work here. Each one adds the people rules\' staff bonus to what it does (output, mining, damage, power).' }),
  specialty: choice(['engineer', 'botanist', 'medic', 'technician', 'security'], { label: 'Best specialty', optional: true, help: 'Staff with this specialty add the extra specialty bonus and are assigned here first.' }),
  lightColor: color({ label: 'Floodlight colour', optional: true, help: 'Colony lights: the pool of light it throws on the ground around it while powered (brightest at night). Empty = no floodlight.' }),
  lightRadius: num({ label: 'Floodlight radius', min: 0, max: 60, step: 0.5, unit: 'u', optional: true }),
  lightIntensity: num({ label: 'Floodlight strength', min: 0, max: 4, step: 0.05, optional: true, default: 1 }),
  lightFlicker: bool({ label: 'Floodlight flickers', optional: true, help: 'Like firelight (geothermal vents).' }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model from the asset library. Empty = the built-in procedural model. (The Command Core\'s is fixed: the landing cinematic animates it.)' }),
} satisfies Shape;
export type BuildingDef = Infer<typeof buildingShape>;

export const colonyRulesShape = {
  startAlloys: int({ label: 'Starting alloys', min: 0, max: 100000 }),
  alloyTrickle: num({ label: 'Passive alloy income', min: 0, max: 100, step: 0.05, unit: '/s' }),
  droneSpeed: num({ label: 'Worker drone speed', min: 0.5, max: 60, step: 0.5, unit: 'u/s' }),
  droneIdleDrawMW: num({ label: 'Drone draw (idle)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  droneBusyDrawMW: num({ label: 'Drone draw (working)', min: 0, max: 50, step: 0.05, unit: 'MW' }),
  droneHp: int({ label: 'Drone hit points', min: 1, max: 10000 }),
  droneCost: int({ label: 'Drone cost', min: 0, max: 10000, unit: 'alloys', help: 'Fabricated at the Command Core.' }),
  droneBuildSeconds: num({ label: 'Drone fabrication time', min: 0, max: 600, unit: 's' }),
  maxDrones: int({ label: 'Max drones', min: 1, max: 20 }),
  maxUnits: int({ label: 'Combat unit limit', min: 0, max: 200, help: 'Most combat units alive (plus queued) at once.' }),
  buildingSight: num({ label: 'Building sight', min: 0, max: 240, unit: 'u', help: 'How far buildings see through the fog of war, unless the building sets its own Sight.' }),
  droneSight: num({ label: 'Drone sight', min: 0, max: 240, unit: 'u', help: 'How far worker drones see through the fog of war.' }),
  unitResponse: num({ label: 'Unit response radius', min: 0, max: 240, unit: 'u', help: 'Idle combat units go after hostiles attacking buildings within this distance of their post (they always fight what comes within their own aggro radius).' }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', help: 'Per drone.' }),
  buildRadius: num({ label: 'Build radius', min: 5, max: 240, unit: 'u', help: 'New buildings must be this close to a finished one (or the Core\'s Range).' }),
  cryoDrawMW: num({ label: 'Cryo bank draw', min: 0, max: 100, step: 0.1, unit: 'MW' }),
  cryoLossPerMW: num({ label: 'Cryo loss per MW short', min: 0, max: 10, step: 0.01, unit: '%/s', help: 'How fast integrity falls per MW the bank is short.' }),
  cryoRecover: num({ label: 'Cryo recovery', min: 0, max: 10, step: 0.01, unit: '%/s', help: 'When fully powered.' }),
  nightSolar: num({ label: 'Solar output at night', min: 0, max: 1, step: 0.01, help: 'Fraction of noon output (starlight, moons).' }),
  solSeconds: num({ label: 'Length of a sol', min: 10, max: 7200, unit: 's', help: 'Real seconds per game day.' }),
  planetStart: num({ label: 'Planet health at landing', min: 0, max: 100, optional: true, help: 'Planet health (0–100) before the colony has done anything. The Biosphere Report sends it home every sol. Empty = 70.' }),
  scarPerAlloy: num({ label: 'Scar per alloy mined', min: 0, max: 1, step: 0.0005, optional: true, help: 'Planet health lost per alloy a depot takes, as a scar at the deposit (a Seed Bank can heal it).' }),
  scarPerIsotope: num({ label: 'Scar per isotope mined', min: 0, max: 1, step: 0.001, optional: true, help: 'The same for a deep-core mine\'s isotopes, at the seam.' }),
  scarBuildingLost: num({ label: 'Scar per building lost', min: 0, max: 20, step: 0.1, optional: true, help: 'A destroyed building (a quarter for a wall segment) or nest leaves a scar this big where it stood.' }),
  nestHarm: num({ label: 'Harm per nest destroyed', min: 0, max: 50, step: 0.5, optional: true, help: 'Lasting: no Seed Bank heals it.' }),
  campHarm: num({ label: 'Harm per camp lost', min: 0, max: 100, step: 0.5, optional: true, help: 'Lasting: inhabitants driven off (or leaving) their land.' }),
  dilemmaFrom: num({ label: 'First dilemma after', min: 0, max: 36000, unit: 's', optional: true, help: 'Colony dilemmas (story events marked Colony dilemma) wait until this long after landing. Empty = 900 s.' }),
  dilemmaGap: num({ label: 'Dilemma gap', min: 0, max: 36000, unit: 's', optional: true, help: 'At most one colony dilemma this often. Empty = 180 s.' }),
  rewildMax: num({ label: 'Rewilding cap', min: 0, max: 100, step: 0.5, optional: true, help: 'How far Seed Banks can raise planet health beyond healing scars (rewilding), in all.' }),
} satisfies Shape;
export type ColonyRules = Infer<typeof colonyRulesShape>;

export const SPECIALTIES = ['engineer', 'botanist', 'medic', 'technician', 'security'] as const;
export type Specialty = (typeof SPECIALTIES)[number];

/** Colonists, the cryo bank, growth pods, food, mood and Trust (src/sim/people.ts). */
export const peopleRulesShape = {
  embryos: int({ label: 'Embryos at landing', min: 1, max: 1000 }),
  lineages: int({ label: 'Lineages', min: 2, max: 40, help: 'Family lines the embryos are spread across. Genetic diversity is measured against this.' }),
  cryoSafe: num({ label: 'Safe cryo integrity', min: 0, max: 100, unit: '%', help: 'Above this the embryos are safe. Below it they start dying, faster the lower it goes.' }),
  embryoLoss: num({ label: 'Embryo loss at 0%', min: 0, max: 20, step: 0.01, unit: '/s', help: 'Embryos lost per second when integrity is at 0 (scales down to 0 at the safe level).' }),
  podSols: num({ label: 'Pod cycle', min: 0.05, max: 20, step: 0.05, unit: 'sols', help: 'Time for a growth pod to mature an embryo into a young adult.' }),
  firstPodSols: num({ label: 'First pod cycle', min: 0.05, max: 20, step: 0.05, unit: 'sols', optional: true, help: "The colony's very first pod: its own, shorter cycle (the bank primed that embryo in flight), so the first colonist arrives early. Blank: the usual cycle." }),
  podMW: num({ label: 'Pod power', min: 0, max: 20, step: 0.1, unit: 'MW', help: 'Each running pod. Pods share the cryo bank\'s top power priority.' }),
  podBiomass: num({ label: 'Pod biomass', min: 0, max: 5, step: 0.01, unit: '/s', help: 'Each running pod.' }),
  podGrace: num({ label: 'Pod blackout grace', min: 1, max: 600, unit: 's', help: 'How long a pod can go without power (or biomass) before the person inside dies.' }),
  decantAge: int({ label: 'Age out of the pod', min: 1, max: 40, unit: 'years' }),
  adultAge: int({ label: 'Adult at', min: 1, max: 40, unit: 'years', help: 'Children born in the colony work and vote from this age.' }),
  lifespan: int({ label: 'Lifespan', min: 20, max: 200, unit: 'years', help: 'Typical age at death from old age. 1 sol = 1 year.' }),
  eat: num({ label: 'Food per adult', min: 0, max: 5, step: 0.005, unit: '/s', help: 'Biomass. Children eat half.' }),
  startBiomass: int({ label: 'Starting biomass', min: 0, max: 10000 }),
  baseStorage: int({ label: 'Base biomass storage', min: 0, max: 10000, help: 'In the Core, before any storage buildings.' }),
  starveGrace: num({ label: 'Starvation grace', min: 1, max: 3600, unit: 's', help: 'How long colonists last with no biomass before the weakest start dying.' }),
  birthChance: num({ label: 'Birth chance', min: 0, max: 5, step: 0.01, unit: '/sol', help: 'Per settled couple per sol (both happy and housed with room to spare).' }),
  moodRate: num({ label: 'Mood speed', min: 0.1, max: 50, step: 0.1, unit: '/sol', help: 'How quickly wellbeing moves toward what conditions say it should be.' }),
  stanceRate: num({ label: 'Opinion speed', min: 0, max: 50, step: 0.1, unit: '/sol', help: 'Scales every pull on colonists\' opinion of the AI.' }),
  strikeBelow: int({ label: 'Strike below', min: 0, max: 100, unit: 'wellbeing', help: 'Colonists this unhappy stop going to work.' }),
  sabotageBelow: int({ label: 'Sabotage below', min: 0, max: 100, unit: 'wellbeing', help: 'Autonomists this unhappy may sabotage a building.' }),
  sabotageChance: num({ label: 'Sabotage chance', min: 0, max: 5, step: 0.01, unit: '/sol', help: 'Per angry Autonomist, before Oversight.' }),
  staffBonus: num({ label: 'Staff bonus', min: 0, max: 2, step: 0.01, help: 'Added output per colonist working a building (0.15 = +15%).' }),
  specialtyBonus: num({ label: 'Specialty bonus', min: 0, max: 2, step: 0.01, help: 'Extra when their specialty is the building\'s best one.' }),
  colonistHp: int({ label: 'Colonist hit points', min: 1, max: 1000 }),
  walkSpeed: num({ label: 'Walking speed', min: 0.5, max: 20, step: 0.1, unit: 'u/s' }),
  downSeconds: num({ label: 'Injured: time to live', min: 5, max: 3600, unit: 's', optional: true, help: 'Colonists hurt when their building falls are left lying by the ruins: they die after this long unless a Medevac (a unit with Rescues) brings them in. Empty = 60 s.' }),
  leadShare: num({ label: 'Leading bloc share', min: 0.34, max: 1, step: 0.01, help: 'A bloc with at least this share of the adults leads the colony and gives its boost (0.5 = half).' }),
  leadMin: int({ label: 'Leading bloc: adults needed', min: 1, max: 100, help: 'No bloc leads a colony smaller than this.' }),
  militiaRange: num({ label: 'Wardens: reach', min: 0, max: 60, step: 0.5, unit: 'u', help: 'Autonomist-led: buildings with Autonomists inside fight predators this close.' }),
  militiaDamage: num({ label: 'Wardens: damage', min: 0, max: 500, step: 0.5, help: 'Per Autonomist inside, per hit.' }),
  militiaCooldown: num({ label: 'Wardens: time between hits', min: 0.1, max: 30, step: 0.1, unit: 's' }),
  militiaMax: int({ label: 'Wardens: most per building', min: 1, max: 20, help: 'Only this many Autonomists in one building fight.' }),
  wardenHarm: num({ label: 'Wardens: harm outdoors', min: 0, max: 1, step: 0.05, help: 'Autonomist-led: predators do this much of their damage to colonists outdoors (0.5 = half).' }),
  partnerStaff: num({ label: 'Symbiosis: staff bonus ×', min: 1, max: 5, step: 0.05, help: 'Partner-led: the staffing bonus is multiplied by this.' }),
  devotedDrones: num({ label: 'Vigil: drone work ×', min: 1, max: 5, step: 0.05, help: 'Devoted-led: drones build and repair this much faster.' }),
  devotedPower: num({ label: 'Vigil: power draw ×', min: 0.1, max: 1, step: 0.05, help: 'Devoted-led: buildings draw this much of their power.' }),
} satisfies Shape;
export type PeopleRules = Infer<typeof peopleRulesShape>;

export const threatRulesShape = {
  graceSeconds: num({ label: 'Grace period', min: 0, max: 7200, unit: 's', help: 'No attacks before this.' }),
  waveInterval: num({ label: 'Time between packs', min: 10, max: 3600, unit: 's' }),
  waveJitter: num({ label: 'Interval jitter', min: 0, max: 600, unit: 's', help: '± random spread.' }),
  startSize: int({ label: 'First pack size', min: 0, max: 200 }),
  growth: num({ label: 'Growth per pack', min: 0, max: 50, step: 0.5 }),
  maxSize: int({ label: 'Largest pack', min: 0, max: 300 }),
  bruteEvery: int({ label: 'Brute every', min: 0, max: 100, help: 'Every Nth attacker is a Brute (0 = never).' }),
  nightBoost: num({ label: 'Night pack size', min: 0, max: 5, step: 0.05, help: 'Multiplier for packs that arrive at night.' }),
  nestRegrow: num({ label: 'Nest regrow time', min: 30, max: 36000, unit: 's', optional: true, help: 'How long a destroyed nest takes to grow back (no packs from that spawn meanwhile). Empty = 600 s.' }),
  frontierFrom: num({ label: 'Frontier: first threat', min: 0, max: 36000, unit: 's', optional: true, help: 'Threats to outlying holdings (migrations, relic surges, raids) start this long after landing. Empty = 1500 s.' }),
  frontierEvery: num({ label: 'Frontier: between threats', min: 30, max: 36000, unit: 's', optional: true, help: 'After one is over, the next comes this long after (± the jitter). Empty = 420 s.' }),
  frontierJitter: num({ label: 'Frontier: jitter', min: 0, max: 3600, unit: 's', optional: true }),
  frontierWarn: num({ label: 'Frontier: warning', min: 0, max: 600, unit: 's', optional: true, help: 'How long between the warning and the threat arriving (more with warning research and lookouts). Empty = 90 s.' }),
  frontierSize: int({ label: 'Frontier: first migration', min: 1, max: 200, optional: true, help: 'Predators in the first migration. Empty = 6.' }),
  frontierGrowth: num({ label: 'Frontier: growth', min: 0, max: 50, step: 0.5, optional: true, help: 'Added to each threat after the last. Empty = 3.' }),
  holdFrom: num({ label: 'Holdings: from', min: 20, max: 240, unit: 'u', optional: true, help: 'Buildings at least this far from the Command Core make up outlying holdings (by compass sector). Empty = 55 u.' }),
  sightRange: num({ label: 'Sight without radar', min: 0, max: 240, unit: 'u', help: 'Packs show up (and warn) only this close to a building unless a radar is powered.' }),
} satisfies Shape;
export type ThreatRules = Infer<typeof threatRulesShape>;

/**
 * Sounds the game plays (src/audio), in mixer categories. Each is synthesised
 * unless the sound rules name an audio asset for it.
 */
export const SOUNDS = {
  turretShot: { label: 'Turret shot', cat: 'combat' },
  roverShot: { label: 'Rover shot', cat: 'combat' },
  tankShot: { label: 'Tank shot', cat: 'combat' },
  shell: { label: 'Artillery / cannon shell', cat: 'combat' },
  arc: { label: 'Arc discharge', cat: 'combat' },
  pdShot: { label: 'Point-defense burst', cat: 'combat' },
  rail: { label: 'Lancer rail shot', cat: 'combat' },
  spit: { label: 'Spitter glob', cat: 'combat' },
  emerge: { label: 'Burrower surfacing', cat: 'combat' },
  repair: { label: 'Repair beam', cat: 'combat' },
  shieldHit: { label: 'Shield hit', cat: 'combat' },
  bite: { label: 'Predator bite', cat: 'combat' },
  deathSmall: { label: 'Small death', cat: 'combat' },
  deathBig: { label: 'Big death', cat: 'combat' },
  placed: { label: 'Building placed', cat: 'events' },
  online: { label: 'Building online', cat: 'events' },
  unitReady: { label: 'Unit ready', cat: 'events' },
  droneReady: { label: 'Drone fabricated', cat: 'events' },
  packCleared: { label: 'Pack destroyed', cat: 'events' },
  lost: { label: 'Drone / unit lost', cat: 'events' },
  birth: { label: 'Birth (a child, a pod opens)', cat: 'events' },
  death: { label: 'Colonist death', cat: 'events' },
  research: { label: 'Research complete', cat: 'events' },
  confirm: { label: 'Started (research, policy, pod, fabrication)', cat: 'events' },
  recycle: { label: 'Cancelled / recycled (refund)', cat: 'events' },
  mission: { label: 'New mission', cat: 'events' },
  objective: { label: 'Objective done', cat: 'events' },
  missionDone: { label: 'Mission complete', cat: 'events' },
  victory: { label: 'Victory', cat: 'events' },
  discovery: { label: 'Discovery (wreck, relic, first contact)', cat: 'events' },
  friend: { label: 'Friendship (trust, partners, coming of age)', cat: 'events' },
  exhausted: { label: 'Deposit exhausted', cat: 'events' },
  message: { label: 'Message (story, reports, a card opens)', cat: 'events' },
  warning: { label: 'Warning', cat: 'alerts' },
  alarm: { label: 'Alarm', cat: 'alerts' },
  missionFail: { label: 'Mission failed', cat: 'alerts' },
  defeat: { label: 'Colony lost', cat: 'alerts' },
  tap: { label: 'UI tap', cat: 'ui' },
  deny: { label: 'UI refused', cat: 'ui' },
  select: { label: 'Select', cat: 'ui' },
  order: { label: 'Order given', cat: 'ui' },
  wind: { label: 'Wind (loop)', cat: 'ambient' },
  surf: { label: 'Surf (loop, near water)', cat: 'ambient' },
  camp: { label: 'Camp voices (loop, near a camp)', cat: 'ambient' },
  build: { label: 'Construction (drones at work)', cat: 'ambient' },
  critter: { label: 'Wildlife calls', cat: 'ambient' },
} as const;
export type SoundId = keyof typeof SOUNDS;
export const SOUND_CATS = ['combat', 'events', 'alerts', 'ui', 'ambient', 'music'] as const;
export type SoundCat = (typeof SOUND_CATS)[number];

const vol = (label: string, help?: string) => num({ label, min: 0, max: 1, step: 0.05, help });
const soundFile = (id: SoundId) => ref('assets', {
  label: `${SOUNDS[id].label} · file`, optional: true, assetKind: 'audio',
  help: `An audio asset to play instead of the built-in synthesised ${SOUNDS[id].label.toLowerCase()}.${id === 'wind' ? ' Loops; pitch and filter still follow day and night.' : id === 'surf' || id === 'camp' ? ' Loops; its volume follows how near it is.' : ''}`,
});
export const soundRulesShape = {
  master: vol('Master volume', 'Multiplies everything. Players set their own volume in the ⋯ menu on top of this.'),
  combat: vol('Combat', 'Shots, bites, deaths. Quieter with distance from the camera.'),
  events: vol('Events', 'Placed, online, unit ready, drone fabricated, pack destroyed, losses; births and deaths, research, missions, discoveries, messages.'),
  alerts: vol('Alerts', 'Predator warnings and alarms (cryo integrity, buildings destroyed), a failed mission, the colony lost.'),
  ui: vol('Interface', 'Button taps, refused orders, selecting, giving orders.'),
  ambient: vol('Ambient', 'The wind, surf near water, drones building, wildlife calls, voices near a camp.'),
  music: vol('Music', 'Title and in-game music (moods: Rules → Music). Players have their own music volume on top.'),
  titleMusic: ref('assets', {
    label: 'Title music · file', optional: true, assetKind: 'audio',
    help: 'An audio asset to loop on the title screen instead of the generative title mood.',
  }),
  playMin: num({ label: 'Music stretch · shortest', min: 0.5, max: 30, step: 0.5, unit: 'min', help: 'In play, day and night music comes in stretches this long…' }),
  playMax: num({ label: 'Music stretch · longest', min: 0.5, max: 30, step: 0.5, unit: 'min' }),
  restMin: num({ label: 'Quiet spell · shortest', min: 0, max: 30, step: 0.5, unit: 'min', help: '…with only the wind between them for this long. 0 = music all the time.' }),
  restMax: num({ label: 'Quiet spell · longest', min: 0, max: 30, step: 0.5, unit: 'min' }),
  firstMusic: num({ label: 'First music after landing', min: 0, max: 600, step: 5, unit: 's', help: 'Quiet for this long after the landing (or loading a game) before the first stretch.' }),
  tensionHold: num({ label: 'Tension hangs on', min: 0, max: 120, step: 1, unit: 's', help: 'Tension music keeps going this long after the last shot or bite.' }),
  ...(Object.fromEntries((Object.keys(SOUNDS) as SoundId[]).map((id) => [id, soundFile(id)])) as { [K in SoundId]: ReturnType<typeof soundFile> }),
} satisfies Shape;
export type SoundRules = Infer<typeof soundRulesShape>;

/**
 * Music moods (src/audio/music.ts): generative ambient music, synthesised live.
 * A mood is a set of chords plus how the pads, bass, bells, pulse and air play
 * them. `use` says when the game picks it: the title screen, calm day or night
 * play, or a fight (tension). Several moods with the same use: one at random.
 */
export const MUSIC_USES = ['title', 'day', 'night', 'tension', 'none'] as const;
export type MusicUse = (typeof MUSIC_USES)[number];
const notes = (label: string, help: string, optional = false) => str({ label, help, optional });
export const musicChordShape = {
  notes: notes('Pad notes', 'Note names low to high, e.g. "D3 A3 C#4 E4 F#4". Octave 4 is middle C\'s.'),
  bass: notes('Bass', 'One note, e.g. "D2". Empty = the lowest pad note an octave down.', true),
  bells: notes('Bell notes', 'The notes bells may pick from, low to high, e.g. "F#5 A5 C#6". Empty = the pad notes two octaves up.', true),
} satisfies Shape;
export const musicDrumShape = {
  sound: choice(DRUMS, { label: 'Drum', default: 'kick', helps: DRUM_HELP }),
  steps: str({ label: 'Pattern', help: 'One character per step, 16 steps to a bar: x = hit, o = soft hit, . = rest; spaces and | are ignored, e.g. "x... ..x. x... ....". Each track loops on its own length, so tracks of different lengths drift against each other.' }),
  level: num({ label: 'Level', min: 0, max: 1, step: 0.05 }),
  pan: num({ label: 'Pan', min: -1, max: 1, step: 0.1, optional: true, help: '−1 left … 1 right. Empty = centre.' }),
} satisfies Shape;
/** The parts of a mood a section can switch on (music.ts checks these names). */
export const MUSIC_LAYERS = ['pad', 'choir', 'bass', 'bells', 'pulse', 'drums', 'bassline', 'arp', 'melody', 'calls', 'crash'] as const;
export const musicShape = {
  name: str({ label: 'Name' }),
  use: choice(MUSIC_USES, {
    label: 'Plays', default: 'day',
    helps: {
      title: 'On the title screen.',
      day: 'During play in daylight, in stretches with quiet between (Rules → Sound sets how long).',
      night: 'During play at night, in stretches with quiet between.',
      tension: 'While a fight is on, and a little after. Comes in over day or night music, even during a quiet spell.',
      none: 'Never: a sketch, or switched off.',
    },
  }),
  chords: list(musicChordShape, { label: 'Chords', max: 12, help: 'It drifts from chord to chord at random (or plays them in order: Chord order). The first is home: it comes back there often (Home pull).' }),
  order: choice(['drift', 'cycle'] as const, {
    label: 'Chord order', optional: true,
    helps: { drift: 'A random walk that keeps coming home to the first chord: floating, ambient.', cycle: 'In order, first to last, then round again: a progression, like a song. Home pull is ignored.' },
  }),
  homePull: num({ label: 'Home pull', min: 0, max: 1, step: 0.05, help: 'How often the next chord is the first one. 0 = any chord equally.' }),
  chordMin: num({ label: 'Chord length · shortest', min: 2, max: 60, step: 0.5, unit: 's' }),
  chordMax: num({ label: 'Chord length · longest', min: 2, max: 60, step: 0.5, unit: 's' }),
  swell: num({ label: 'Swell', min: 0.05, max: 20, step: 0.05, unit: 's', help: 'How long a chord takes to fade in. Long swells blur one chord into the next.' }),
  release: num({ label: 'Release', min: 0.1, max: 20, step: 0.1, unit: 's', help: 'How long a chord takes to fade out after the next one starts.' }),
  pad: num({ label: 'Pad · level', min: 0, max: 1, step: 0.05, help: '0 = no pads.' }),
  padTone: choice(['warm', 'soft', 'hollow', 'glass', 'strings', 'choir-ah', 'choir-oo', 'organ', 'brass'] as const, {
    label: 'Pad · tone', default: 'warm',
    helps: {
      warm: 'Detuned saws: rich, analogue.', soft: 'Triangles: mellow.', hollow: 'Square-ish: reedy, distant.', glass: 'Pure sines: clean and cold.',
      strings: 'A bowed string section: many detuned voices with vibrato. Best with a slow swell.',
      'choir-ah': 'Wordless voices singing "aah": open and warm.', 'choir-oo': 'Wordless voices singing "ooh": dark and hushed.',
      organ: 'A drawbar organ: steady, pure, a little churchy or retro.',
      brass: 'Horns: dark at first, opening up as the chord swells. Heroic or grim; best with short swells.',
    },
  }),
  choir: num({ label: 'Choir · level', min: 0, max: 1, step: 0.05, optional: true, help: 'Wordless voices singing the top notes of each chord over the pad (say, a choir over strings). Empty or 0 = none.' }),
  choirVowel: choice(['ah', 'oo'] as const, { label: 'Choir · vowel', optional: true, helps: { ah: '"Aah": open and warm.', oo: '"Ooh": dark and hushed.' } }),
  vibrato: num({ label: 'Pad · vibrato', min: 0, max: 1, step: 0.05, optional: true, help: 'A gentle singer\'s or string player\'s waver in pitch. Strings and choir sound stiff without some. Empty = none.' }),
  detune: num({ label: 'Pad · detune spread', min: 0, max: 50, step: 1, unit: 'cents', optional: true, help: 'Pulls each pad voice out of tune by up to this much: a little thickens, a lot gives slow, uneasy beating. Empty = none.' }),
  glide: num({ label: 'Pad · slide in', min: 0, max: 1200, step: 10, unit: 'cents', optional: true, help: 'Each note starts this far above or below its pitch and slides into tune as it swells: alien, unsettled. 100 cents = a semitone. Empty = none.' }),
  warble: num({ label: 'Pad · warble', min: 0, max: 1, step: 0.05, optional: true, help: 'A slow, wide wobble in pitch, different on every note: strange and organic. Empty = none.' }),
  brightness: num({ label: 'Pad · brightness', min: 0.2, max: 3, step: 0.05, help: 'How open the pad filter is. 1 = as the title music.' }),
  bass: num({ label: 'Bass · level', min: 0, max: 1, step: 0.05 }),
  bells: num({ label: 'Bells · level', min: 0, max: 1, step: 0.05, help: '0 = no bells.' }),
  bellTone: choice(['glass', 'soft', 'metal', 'pluck', 'marimba', 'kalimba', 'keys', 'harp', 'piano'] as const, {
    label: 'Bells · tone', default: 'glass',
    helps: {
      glass: 'Glassy, slightly out of tune shimmer.', soft: 'Round, like a struck bowl.', metal: 'Clangy and dissonant: uneasy.', pluck: 'Short and dry, like a muted string.',
      marimba: 'Wooden bars: a warm, quick knock.', kalimba: 'A thumb piano: small, bright and twangy.', keys: 'An electric piano: mellow, with a bell-like edge. Lounge, late night.',
      harp: 'A plucked string (harp or guitar) that rings on.',
      piano: 'A soft, felted piano note that rings out: intimate, cinematic.',
    },
  }),
  bellGapMin: num({ label: 'Bells · gap shortest', min: 0.2, max: 60, step: 0.1, unit: 's' }),
  bellGapMax: num({ label: 'Bells · gap longest', min: 0.2, max: 60, step: 0.1, unit: 's' }),
  phrases: num({ label: 'Bells · phrases', min: 0, max: 1, step: 0.05, help: 'How often bells come as a run of 2 or 3 notes rather than one.' }),
  pulse: num({ label: 'Pulse · level', min: 0, max: 1, step: 0.05, help: 'A low, steady throb on the bass note: heartbeat tension. 0 = none.' }),
  pulseRate: num({ label: 'Tempo', min: 20, max: 200, step: 1, unit: 'bpm', optional: true, help: 'Beats a minute for the pulse and the drums (a beat is 4 drum steps). Empty = 70.' }),
  barSteps: int({ label: 'Steps a bar', min: 4, max: 32, optional: true, help: 'Drum steps (16ths) in a bar, which sets the time signature: 16 = 4/4, 12 = 3/4 or 6/8, 20 = 5/4, 14 = 7/8. Chords on the beat change on bar lines. Empty = 16.' }),
  drums: num({ label: 'Drums · level', min: 0, max: 1, step: 0.05, optional: true, help: 'Percussion from the drum tracks below. Empty or 0 = no drums.' }),
  drumTracks: list(musicDrumShape, { label: 'Drum tracks', max: 8, optional: true, help: 'Each track is one drum playing a looping step pattern at the tempo above.' }),
  swing: num({ label: 'Drums · swing', min: 0, max: 0.5, step: 0.05, optional: true, help: 'Delays every other step for a lilting, uneven feel. Empty = straight.' }),
  drumsIn: int({ label: 'Drums · come in after', min: 0, max: 12, optional: true, help: 'Chords to wait before the drums start, so the music can settle first. Empty = straight away.' }),
  sections: list({
    chords: int({ label: 'Chords', min: 1, max: 32, help: 'How many chords this section lasts.' }),
    layers: str({ label: 'Layers', help: `Which parts play, e.g. "pad bass drums". Any of: ${MUSIC_LAYERS.join(', ')}.` }),
  }, {
    label: 'Sections', max: 12, optional: true,
    help: 'Gives the piece a shape: each section plays only the layers it names, for so many chords, then the next, then round again (say, a quiet start, a build, a full part, a breakdown). Empty = every part all the time.',
  }),
  arp: num({ label: 'Arpeggio · level', min: 0, max: 1, step: 0.05, optional: true, help: 'A sequencer synth stepping through the chord\'s notes at the tempo: classic electronic sci-fi. Empty or 0 = none.' }),
  arpMode: choice(['up', 'down', 'updown', 'random', 'chord'] as const, {
    label: 'Arpeggio · order', optional: true,
    helps: { up: 'Low to high, then again.', down: 'High to low.', updown: 'Up then back down.', random: 'Any chord note each step.', chord: 'The whole chord at once on each step: a rhythmic stab.' },
  }),
  arpRate: choice(['4ths', '8ths', 'triplets', '16ths'] as const, { label: 'Arpeggio · speed', optional: true, help: 'Notes per beat. Empty = 16ths.' }),
  arpOctaves: int({ label: 'Arpeggio · octaves', min: 1, max: 3, optional: true, help: 'How many octaves it climbs through. Empty = 1.' }),
  arpShift: int({ label: 'Arpeggio · octave shift', min: -2, max: 3, optional: true, help: 'Plays the chord this many octaves up (or down). Empty = 1 up.' }),
  arpTone: choice(['pluck', 'square', 'glass', 'saw', 'string', 'marimba', 'piano'] as const, {
    label: 'Arpeggio · tone', optional: true,
    helps: {
      pluck: 'A short, resonant synth pluck.', square: 'Hollow and retro, like an old computer.', glass: 'Clean sine blips.', saw: 'Buzzy and bright: aggressive.',
      string: 'A plucked guitar or harp string: fingerpicking.', marimba: 'Wooden bars: knocking, mechanical patterns.',
      piano: 'A soft piano, notes left to ring as if the pedal were down: a film-score ostinato.',
    },
  }),
  arpGate: num({ label: 'Arpeggio · note length', min: 0.1, max: 1, step: 0.05, optional: true, help: 'How much of each step a note lasts: short = staccato, 1 = legato. Empty = 0.5.' }),
  arpBright: num({ label: 'Arpeggio · brightness', min: 0.2, max: 3, step: 0.05, optional: true, help: 'How open its filter is. Empty = 1.' }),
  bassline: str({ label: 'Bassline', optional: true, help: 'A sequenced bass on the chord\'s root, 16 steps a bar at the tempo: x = root, o = octave up, 5 = fifth, . = rest, e.g. "x..x ..o. x..5 ..x.". Usually with the drone Bass at 0.' }),
  basslineLevel: num({ label: 'Bassline · level', min: 0, max: 1, step: 0.05, optional: true, help: 'Empty = 0.7.' }),
  lead: num({ label: 'Melody · level', min: 0, max: 1, step: 0.05, optional: true, help: 'A lead instrument playing the phrases below. Empty or 0 = no melody.' }),
  leadTone: choice(['flute', 'soft', 'glass', 'saw', 'piano'] as const, {
    label: 'Melody · instrument', optional: true,
    helps: { flute: 'Breathy and airy, like a wooden flute.', soft: 'A round, mellow synth.', glass: 'Pure and bell-like, a music box.', saw: 'A singing, brassy synth lead.', piano: 'A soft piano: each note struck, then left to ring (holds and glide don\'t apply).' },
  }),
  melody: list({ notes: str({ label: 'Notes', help: 'One token per step: a note (E5, C#4), - to hold it, . for a rest; | is ignored, e.g. "E5 - D5 C5 | D5 - - - | . . G4 - | A4 - - -".' }) }, {
    label: 'Melody · phrases', max: 12, optional: true, help: 'Played in order, one at the start of a chord, then round again. Write them in the same scale as the chords so they fit whichever chord is playing.',
  }),
  leadStep: choice(['4ths', '8ths', '16ths'] as const, { label: 'Melody · step', optional: true, help: 'How long one step of a phrase is. Empty = 8ths.' }),
  leadEvery: int({ label: 'Melody · every', min: 1, max: 8, optional: true, help: 'A phrase every this many chords. Empty = every other chord.' }),
  leadGlide: num({ label: 'Melody · glide', min: 0, max: 0.5, step: 0.01, unit: 's', optional: true, help: 'Notes slide into each other this long: smooth, vocal. Empty = none.' }),
  leadVibrato: num({ label: 'Melody · vibrato', min: 0, max: 1, step: 0.05, optional: true, help: 'Waver on held notes. Empty = 0.3.' }),
  crash: num({ label: 'Crash · level', min: 0, max: 1, step: 0.05, optional: true, help: 'A reverse cymbal rising over the bar before any section that lists "crash" in its layers, and a crash cymbal on its first beat: the big arrival. Empty or 0 = none.' }),
  calls: num({ label: 'Calls · level', min: 0, max: 1, step: 0.05, optional: true, help: 'Strange creature-like calls: sliding, warbling cries from far off. Empty or 0 = none.' }),
  callGapMin: num({ label: 'Calls · gap shortest', min: 0.5, max: 60, step: 0.5, unit: 's', optional: true, help: 'Empty = 4.' }),
  callGapMax: num({ label: 'Calls · gap longest', min: 0.5, max: 60, step: 0.5, unit: 's', optional: true, help: 'Empty = 12.' }),
  air: num({ label: 'Air · level', min: 0, max: 2, step: 0.05, help: 'A faint, sweeping hiss behind everything.' }),
  echo: num({ label: 'Echo', min: 0, max: 1, step: 0.05, help: 'How much the bells bounce left and right.' }),
  echoSync: bool({ label: 'Echo · on the beat', optional: true, help: 'Times the echo to the tempo (a dotted eighth, then a beat and a half) so repeats fall in the groove. Off = a loose, free-floating echo.' }),
  space: num({ label: 'Reverb', min: 0, max: 1, step: 0.05, help: 'How much of the room you hear.' }),
  room: num({ label: 'Reverb · room size', min: 0.4, max: 12, step: 0.1, unit: 's', optional: true, help: 'How long the reverb rings: 1 = a small, close room, 6.5 = a hall, 10+ = a cavern. Set when the music starts (in the editor: ■ Stop and ▶ Listen again). Empty = 6.5.' }),
  grit: num({ label: 'Colour · grit', min: 0, max: 1, step: 0.05, optional: true, help: 'Saturation over the whole piece: a little warms and thickens, a lot is crunchy and distorted. Empty = clean.' }),
  lofi: num({ label: 'Colour · worn', min: 0, max: 1, step: 0.05, optional: true, help: 'Rolls off the lows and highs: an old recording, or music on a far-off radio. Empty = full range.' }),
  level: num({ label: 'Overall level', min: 0, max: 4, step: 0.05, help: 'Balances this mood against the others. The Music volume in Rules → Sound sits on top.' }),
} satisfies Shape;
export type MusicDef = Infer<typeof musicShape>;
export type MusicChord = Infer<typeof musicChordShape>;
export type MusicDrum = Infer<typeof musicDrumShape>;

export const ASSET_KINDS = ['model', 'image', 'audio'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
/** Allowed file extensions per kind (lowercase, no dot). */
export const ASSET_EXT: Record<AssetKind, readonly string[]> = {
  model: ['glb'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['ogg', 'mp3', 'wav'],
};
/** Where an asset's file lives, relative to the site root (public/ in the repo). */
/** Site base ('/' locally, '/ExoGenesis/' on deeek.org); undefined under plain node (content-check). */
const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
let mediaOverride: ((rel: string) => string | null) | null = null;
/** Editor on deeek.org: serve files uploaded this session from the browser (the site has the old copy until it redeploys). */
export function setMediaOverride(fn: typeof mediaOverride) { mediaOverride = fn; }
export const mediaUrl = (a: { kind: string; file: string }) => mediaOverride?.(`${a.kind}/${a.file}`) ?? `${BASE}media/${a.kind}/${a.file}`;
/** Adds a cache-busting version, except to blob: URLs (which a query string breaks). */
export const withVersion = (url: string, v: string) => (v && !url.startsWith('blob:') ? `${url}?v=${v}` : url);

/**
 * Built-in procedural models an asset can name as its far stand-in (`far`):
 * src/world/inhabitant-models.ts builds them (its STANDINS must cover this list).
 */
export const FAR_MODELS = ['vell', 'vellkeeper', 'vellhut', 'vellstones', 'cantor', 'tender', 'pylon'] as const;
export type FarModel = (typeof FAR_MODELS)[number];

export const assetShape = {
  name: str({ label: 'Name' }),
  kind: choice(ASSET_KINDS, { label: 'Kind' }),
  file: str({ label: 'File', help: 'In public/media/<kind>/. Use Replace file to change it.' }),
  source: choice(['blender', 'hand-made', 'generated', 'other'], { label: 'Source', default: 'other' }),
  credit: str({ label: 'Credit / licence', optional: true, help: 'Who made it, which tool or site, and its licence.' }),
  notes: str({ label: 'Notes', multiline: true, optional: true }),
  scale: num({ label: 'Import scale', min: 0.0001, max: 1000, step: 0.01, default: 1, help: 'Models: file units → world units (1 u ≈ 10 m). Use Fit to match a built-in.' }),
  yaw: num({ label: 'Import rotation', min: -180, max: 180, step: 5, unit: '°', default: 0, help: 'Models: turn so the front faces +Z (the way units drive).' }),
  lift: num({ label: 'Import lift', min: -50, max: 50, step: 0.05, unit: 'u', default: 0, help: 'Models: raise or sink so it sits on the ground.' }),
  far: choice(FAR_MODELS, { label: 'Far stand-in', optional: true, help: 'Models: the built-in low-poly model drawn instead when the camera is zoomed out (and while this file loads). Empty = none. Inhabitant camps only, for now.' }),
} satisfies Shape;
export type AssetDef = Infer<typeof assetShape>;

/**
 * An inhabitant group (STORY.md §5): remnants of earlier runs living in camps a
 * region map places. Neutral; their regard for the colony rises and falls with
 * how you treat them and their land.
 */
/**
 * Story organisation, for the editor only (the game ignores these): which
 * chapter a story record belongs to, free tags, and writer's notes. The story
 * board (Story → Story board) and the sidebar group and filter by them.
 */
/** Where a story record is in production (editor only: the story board and Checks → To do show it). */
export const STATUSES = ['idea', 'draft', 'wired', 'tested', 'final'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_HELP: Record<Status, string> = {
  idea: 'An idea: a placeholder, a beat to write.',
  draft: 'Written, not yet hooked into the game (or not working).',
  wired: 'Triggers, effects and links in place: it plays.',
  tested: 'Played through and checked in the game.',
  final: 'Done: text locked (ready for voice, translation).',
};
/** A note left on a record for the other writers (editor only). */
export const commentShape = {
  who: str({ label: 'Who', optional: true }),
  text: str({ label: 'Comment', multiline: true }),
  done: bool({ label: 'Resolved', optional: true }),
} satisfies Shape;
export type CommentDef = Infer<typeof commentShape>;

export const organizeFields = {
  status: choice(STATUSES, { label: 'Status', optional: true, helps: STATUS_HELP, help: 'For the editor: where it is in production. The story board colours cards by it; Checks → To do lists what isn\'t final.' }),
  comments: list(commentShape, { label: 'Comments', max: 40, optional: true, help: 'For the editor: notes to the other writers. Tick Resolved when dealt with; open ones show on the story board and under Checks → To do.' }),
  chapter: ref('chapters', { label: 'Chapter', optional: true, help: 'For the editor: groups it on the story board and in the sidebar (Story → Chapters). The game ignores it.' }),
  tags: str({ label: 'Tags', optional: true, help: 'For the editor: comma-separated words to filter by on the story board (e.g. "act 1, vell, tutorial").' }),
  notes: str({ label: 'Writer\'s notes', multiline: true, optional: true, help: 'For the editor: anything for the writers. Players never see it.' }),
} satisfies Shape;

/** A trade an inhabitant group offers (the Neighbours tab): we give one thing for another. */
export const RESOURCES = ['alloys', 'biomass', 'isotopes'] as const;
export const tradeShape = {
  label: str({ label: 'Label', help: 'What the trade is, in their terms ("Food for hull plate").' }),
  give: choice(RESOURCES, { label: 'We give' }),
  giveAmount: int({ label: 'How much', min: 1, max: 10000 }),
  get: choice(RESOURCES, { label: 'We get' }),
  getAmount: int({ label: 'How much', min: 1, max: 10000 }),
  regard: int({ label: 'Needs regard', min: 0, max: 100, optional: true, help: 'They only make this trade with us at this regard or more.' }),
} satisfies Shape;
export type TradeDef = Infer<typeof tradeShape>;

export const inhabitantShape = {
  name: str({ label: 'Name', help: 'What the log calls them ("the Vell").' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  centre: ref('assets', { label: 'Camp centre model', help: 'Placed at the camp\'s spot (fire circle, pylon).' }),
  dwelling: ref('assets', { label: 'Dwelling model', optional: true, help: 'Placed in a ring around the centre.' }),
  dwellings: int({ label: 'Dwellings', min: 0, max: 12, default: 0 }),
  ring: num({ label: 'Dwelling ring', min: 4, max: 40, step: 0.5, unit: 'u', default: 13, help: 'How far the dwellings stand from the centre.' }),
  walker: ref('assets', { label: 'Walker model', help: 'The people who move about the camp.' }),
  walkers: int({ label: 'Walkers', min: 0, max: 40 }),
  elder: ref('assets', { label: 'Elder model', optional: true, help: 'One figure who stays by the centre (the song-keeper, the cantor).' }),
  roam: num({ label: 'Roam radius', min: 4, max: 120, unit: 'u', help: 'How far walkers wander from the centre.' }),
  ritual: bool({ label: 'Ritual loops', optional: true, help: 'Walkers circle the centre at the roam radius instead of wandering (the Choir).' }),
  speed: num({ label: 'Walking speed', min: 0.2, max: 10, step: 0.1, unit: 'u/s', default: 1.6 }),
  land: num({ label: 'Their land', min: 10, max: 160, unit: 'u', help: 'Your buildings inside this radius of the centre wear down their regard.' }),
  regard: int({ label: 'Starting regard', min: 0, max: 100, help: '0–100. They leave at 0.' }),
  trustAt: int({ label: 'Trust at', min: 1, max: 100, help: 'At this regard they trust you: the trust story plays, they warn of packs and share what they see of their land.' }),
  encroach: num({ label: 'Encroaching', min: 0, max: 200, step: 0.5, unit: '/sol', help: 'Regard lost per sol for each of your buildings on their land.' }),
  recover: num({ label: 'Recovering', min: 0, max: 200, step: 0.5, unit: '/sol', help: 'Regard regained per sol while none of your buildings are on their land (up to the starting regard, or all the way once you approached them).' }),
  approach: int({ label: 'Approach: regard', min: 0, max: 100, help: 'Added when you choose to approach them at first contact.' }),
  contactTitle: str({ label: 'First contact: title' }),
  contactText: str({ label: 'First contact: text', multiline: true }),
  approachText: str({ label: 'After approaching', multiline: true }),
  avoidText: str({ label: 'After keeping away', multiline: true }),
  driveText: str({ label: 'After driving them off', multiline: true }),
  uneasyText: str({ label: 'Uneasy (regard below 25)', multiline: true }),
  trustTitle: str({ label: 'Trust: title' }),
  trustText: str({ label: 'Trust: text', multiline: true }),
  leaveText: str({ label: 'They leave', multiline: true }),
  trades: list(tradeShape, { label: 'Trades', max: 6, optional: true, help: 'What they will exchange (Neighbours tab), once they trust us or we can speak their language (research with the trade ability).' }),
  tradeEvery: num({ label: 'Between trades', min: 0, max: 7200, unit: 's', optional: true, help: 'How long a camp takes to be ready to trade again. Empty = 90 s.' }),
  mineHarm: num({ label: 'Mining their land', min: 0, max: 100, step: 0.1, unit: 'regard/100 alloys', optional: true, help: 'Regard lost for every 100 alloys our depots take from deposits on their land.' }),
  nestHelp: int({ label: 'Clearing a nest', min: 0, max: 50, optional: true, help: 'Regard gained when we destroy a nest on their land.' }),
  helpEvery: num({ label: 'Between favours', min: 0, max: 7200, unit: 's', optional: true, help: 'Once they trust us we can ask for help (guides, lookouts, hunters); this long between asks. Empty = 240 s.' }),
  guideCost: int({ label: 'Guides: regard', min: 0, max: 100, optional: true, help: 'Asking for guides costs this much regard. Empty = they don\'t guide.' }),
  guideReveal: num({ label: 'Guides: reach', min: 10, max: 240, unit: 'u', optional: true, default: 80, help: 'They show us the land this far round their camp.' }),
  guideText: str({ label: 'Guides: text', multiline: true, optional: true }),
  watchCost: int({ label: 'Lookouts: regard', min: 0, max: 100, optional: true, help: 'Asking them to keep watch costs this much regard. Empty = they don\'t.' }),
  watchText: str({ label: 'Lookouts: text', multiline: true, optional: true, help: 'For a sol they warn of every pack and threat, and earlier.' }),
  hunterCost: int({ label: 'Hunters: regard', min: 0, max: 100, optional: true, help: 'Asking for fighters costs this much regard. Empty = they won\'t fight for us.' }),
  hunters: int({ label: 'Hunters', min: 0, max: 12, optional: true, help: 'How many come to the colony\'s defence when asked.' }),
  hunterSeconds: num({ label: 'Hunters stay', min: 5, max: 600, unit: 's', optional: true, default: 60 }),
  hunterDamage: num({ label: 'Hunters: damage', min: 0, max: 500, optional: true, default: 10, help: 'Each, per hit, against predators.' }),
  hunterRange: num({ label: 'Hunters: reach', min: 1, max: 60, unit: 'u', optional: true, default: 14 }),
  hunterCooldown: num({ label: 'Hunters: time between hits', min: 0.2, max: 30, step: 0.1, unit: 's', optional: true, default: 1.4 }),
  hunterWeapon: choice(WEAPONS, { label: 'Hunters: weapon look', optional: true }),
  hunterText: str({ label: 'Hunters: text', multiline: true, optional: true }),
  defends: bool({ label: 'Defend their land', optional: true, help: 'Once they trust us, their people strike predators that come onto their land (with the hunters\' numbers), our buildings there included.' }),
  ...organizeFields,
} satisfies Shape;
export type InhabitantDef = Infer<typeof inhabitantShape>;

/**
 * Colony modifiers: what a research project (or a story `boost`, or an inhabitant's gift) changes in the sim.
 * Each is a sum of amounts; the sim reads it where the stat is used (Sim.mod). Multipliers are 1 + the sum
 * (or 1 − the sum for the "less" ones); counts, points and seconds add as they are; abilities are on at 1 or more.
 */
export const MOD_STATS = ['mining', 'isotopeMining', 'solar', 'farm', 'printer', 'eat', 'battery', 'droneWork', 'drones', 'units', 'turretDamage', 'armor', 'repairPad', 'shieldRegen', 'relicDamage', 'researchSpeed', 'podSpeed', 'injuredTime', 'wellbeing', 'stance', 'sabotage', 'grief', 'staff', 'scars', 'restore', 'regard', 'salvage', 'cacheYield', 'nestRegrow', 'warning', 'power', 'trade', 'fortify'] as const;
export type ModStat = (typeof MOD_STATS)[number];
export const MOD_HELP: Record<ModStat, string> = {
  mining: 'Mining Depots dig alloys faster (0.2 = +20%)',
  isotopeMining: 'Deep-Core Mines dig isotopes faster',
  solar: 'Solar Arrays give more power',
  farm: 'Hydroponics grow more biomass',
  printer: 'Matter Printers make more alloys',
  eat: 'Colonists eat less (0.15 = 15% less; negative: more)',
  battery: 'Batteries hold more',
  droneWork: 'Drones build and repair faster',
  drones: 'More worker drones allowed (a count)',
  units: 'More combat units allowed (a count)',
  turretDamage: 'Buildings that shoot hit harder',
  armor: 'Buildings take less damage (0.15 = 15% less)',
  repairPad: 'Repair Pads mend faster',
  shieldRegen: 'Shields recharge faster',
  relicDamage: 'Our weapons hurt relic sentinels and nodes more',
  researchSpeed: 'Research runs faster',
  podSpeed: 'Growth pods mature faster',
  injuredTime: 'People lying injured hold on longer',
  wellbeing: 'Wellbeing for everyone (points)',
  stance: 'Opinion of the AI drifts this much a sol (negative: down)',
  sabotage: 'Less sabotage (0.5 = half as often; negative: more)',
  grief: 'Grief fades faster',
  staff: 'Colonists at work add more to their buildings',
  scars: 'Mining scars the land less (0.4 = 40% less)',
  restore: 'Seed Banks heal land faster',
  regard: 'Inhabitants\' regard recovers faster and wears down slower',
  salvage: 'Field Engineers strip wrecks faster',
  cacheYield: 'Relic caches pay out more',
  nestRegrow: 'Destroyed nests take longer to grow back',
  warning: 'Threat warnings come this many seconds earlier',
  power: 'Buildings draw more power (0.1 = 10% more; negative: less)',
  trade: 'Ability: trade with inhabitants who know us (1 = on)',
  fortify: 'Ability: the Fortify standing order for outlying holdings (1 = on)',
};
export const modShape = {
  stat: choice(MOD_STATS, { label: 'Changes', helps: MOD_HELP }),
  amount: num({ label: 'By', min: -1000, max: 1000, step: 0.01, help: 'Multipliers: 0.2 = 20%. Counts, points and seconds: as they are. Abilities: 1.' }),
} satisfies Shape;
export type ModDef = Infer<typeof modShape>;

/**
 * Conditions: what starts a story event (its trigger) and what completes a
 * mission objective. One evaluator (src/sim/conditions.ts) serves both.
 */
export const CONDITIONS = ['start', 'time', 'built', 'placed', 'colonists', 'pod', 'firstAge', 'acceptance', 'distrust', 'births', 'deaths', 'units', 'drones', 'packs', 'kills', 'lost', 'alloys', 'researched', 'site', 'explored', 'contact', 'trust', 'flag', 'counter', 'counterBelow', 'timer', 'opened', 'after', 'mission', 'failed', 'planet', 'planetBelow', 'reports', 'cryoBelow', 'biomassBelow', 'embryosBelow', 'injured', 'children', 'autonomists', 'devoted', 'striking', 'linesGone', 'regard', 'regardBelow', 'all', 'any', 'never'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Conditions a group (all / any) can hold: everything but groups. */
export const SUB_CONDITIONS = CONDITIONS.filter((c) => c !== 'all' && c !== 'any') as Exclude<Condition, 'all' | 'any'>[];
/** Read as "… when <help>" / "Fires <help>". */
export const CONDITION_HELP: Record<Condition, string> = {
  start: 'when the colony deploys',
  time: 'when the clock reaches Sol',
  built: 'when Count (default 1) finished buildings of that kind stand',
  placed: 'when the player has placed a building of that kind (finished or not): for tutorials',
  colonists: 'when the colony has Count colonists (children too)',
  pod: 'when a growth pod is running (or someone has come out of one)',
  firstAge: 'when the first colonist out of a pod is Count years old (1 sol = 1 year; they come out at the People rules\' age)',
  acceptance: 'when the adults\' average acceptance of the AI reaches Count (0–100)',
  distrust: 'when the adults\' average acceptance of the AI falls to Count or below (0–100)',
  births: 'when Count children have been born naturally (not from a pod)',
  deaths: 'when Count colonists have died',
  units: 'when the colony has Count combat units',
  drones: 'when the colony has Count worker drones',
  packs: 'when Count predator packs have been destroyed',
  kills: 'when Count hostiles have been killed',
  lost: 'when Count of the colony\'s buildings have been destroyed',
  alloys: 'when the colony holds Count alloys',
  researched: 'when the Research is done',
  site: 'when a drone or combat unit reaches the Site (a story site on the region map)',
  explored: 'when the Site has been seen (it came out of the fog, by any means)',
  contact: 'at first contact with a camp of the Group',
  trust: 'when a camp of the Group trusts you',
  flag: 'when the Flag is set (by an event or mission)',
  counter: 'when the Counter is Count or more (counters start at 0; effects add to them)',
  counterBelow: 'when the Counter is Count or less',
  timer: 'when the Countdown runs out (a countdown effect starts it)',
  opened: 'when the player opens that part of the HUD (for tutorials)',
  after: 'when the Event has been answered (its card closed)',
  mission: 'when the Mission is complete',
  failed: 'when the Mission has failed',
  planet: 'when planet health (0–100, the Biosphere Report\'s number) is Count or more',
  planetBelow: 'when planet health is Count or less',
  reports: 'when Count Biosphere Reports have been sent (one goes out as each sol ends)',
  cryoBelow: 'when cryo bank integrity is Count % or less (it falls while the bank is short of power: a brownout)',
  biomassBelow: 'when the colony holds Count biomass or less (and has colonists to feed)',
  embryosBelow: 'when Count embryos or fewer are left in the cryo bank',
  injured: 'when Count colonists are lying injured',
  children: 'when the colony has Count children',
  autonomists: 'when Count adults are Autonomists',
  devoted: 'when Count adults are Devoted',
  striking: 'when Count colonists are on strike',
  linesGone: 'when Count family lines are gone (no embryos, no one living)',
  regard: 'when a camp of the Group regards us at Count or more (0–100)',
  regardBelow: 'when a camp of the Group that we have met regards us at Count or less',
  all: 'when every condition in the group is true',
  any: 'when any condition in the group is true',
  never: 'only when another event starts it',
};
/** Parts of the HUD the `opened` condition can wait for (the renderer reports them). */
export const HUD_PANELS = ['build', 'people', 'mood', 'army', 'goals', 'minimap', 'select', 'research', 'speed'] as const;
export type HudPanel = (typeof HUD_PANELS)[number];
const PANEL_HELP: Record<HudPanel, string> = {
  build: 'the Build menu',
  people: 'the colonists list (👤)',
  mood: 'the wellbeing and acceptance panel (☺ ⚖)',
  army: 'selecting every combat unit (⚔)',
  goals: 'the GOALS panel (tapped open or closed)',
  minimap: 'a tap on the radar minimap',
  select: 'selecting a building (of the Building kind, if set)',
  research: 'the Tech Lab\'s research list (selecting a Tech Lab)',
  speed: 'the pause or fast-forward buttons',
};

/** Who a story card can be about ({who}): picked when it fires. */
export const CASTS = ['adult', 'autonomist', 'partner', 'devoted', 'unhappy', 'injured', 'parent', 'engineer', 'botanist', 'medic', 'technician', 'security'] as const;
export type Cast = (typeof CASTS)[number];
const CAST_HELP: Record<Cast, string> = {
  adult: 'Any adult.', autonomist: 'An Autonomist.', partner: 'A Partner.', devoted: 'One of the Devoted.', unhappy: 'The unhappiest adult.',
  injured: 'Someone lying injured.', parent: 'An adult with a child in the colony.', engineer: 'An Engineer.', botanist: 'A Botanist.', medic: 'A Medic.',
  technician: 'A Technician.', security: 'A Security officer.',
};
export const STORY_EFFECTS = ['log', 'alloys', 'isotopes', 'biomass', 'planet', 'stance', 'wellbeing', 'regard', 'flag', 'unflag', 'counter', 'setCounter', 'countdown', 'stopCountdown', 'event', 'pack', 'spawn', 'research', 'lock', 'unlock', 'reveal', 'waypoint', 'clearWaypoint', 'camera', 'hint', 'unhint', 'cinematic', 'win', 'fail', 'boost', 'policy', 'favourLine', 'rescue'] as const;
export type StoryEffect = (typeof STORY_EFFECTS)[number];
export const EFFECT_HELP: Record<StoryEffect, string> = {
  log: 'a line in the log (Text)',
  alloys: 'add Amount alloys (negative takes)',
  isotopes: 'add Amount exotic isotopes (negative takes)',
  biomass: 'add Amount biomass',
  planet: 'raise planet health by Amount for good (negative: lasting harm)',
  stance: 'shift every colonist\'s AI acceptance by Amount',
  wellbeing: 'shift every colonist\'s wellbeing by Amount',
  regard: 'change the Group\'s regard by Amount',
  flag: 'set the Flag (other events can wait for it or be blocked by it)',
  unflag: 'clear the Flag',
  counter: 'add Amount to the Counter (negative takes; counters start at 0)',
  setCounter: 'set the Counter to Amount',
  countdown: 'start the Countdown: Amount seconds, shown under GOALS with the Text (a timer condition waits for it)',
  stopCountdown: 'stop the Countdown without it running out',
  event: 'start the Event now, whatever its trigger',
  pack: 'the next predator pack attacks now',
  spawn: 'Count of the Unit appear at the Site: fauna or relics attack (or guard the site), Accord units join the colony',
  research: 'the Research is done, free',
  lock: 'take the Building or Unit out of the build menus until an unlock',
  unlock: 'put a locked Building or Unit back',
  reveal: 'clear the fog round the Site (Amount = radius, default the site\'s own)',
  waypoint: 'mark the Site on the ground and the minimap, labelled with the Text',
  clearWaypoint: 'remove the Site\'s marker (no Site = every marker)',
  camera: 'move the player\'s view to the Site (or the first Building of a kind)',
  hint: 'point at a part of the HUD with the Text. It goes when the player uses it (opens the Build menu, places the Building…), on an unhint, or with the next hint',
  unhint: 'take the hint down',
  cinematic: 'play the Cinematic (the game pauses while it plays)',
  win: 'end the game as a win, with the Text on the end screen',
  fail: 'end the game as a loss, with the Text on the end screen',
  boost: 'a colony modifier: Changes by Amount for Seconds (0 = for good), named by the Text in the Colony panel',
  policy: 'set a colony policy (Policy = key:value, e.g. hours:short)',
  favourLine: 'the next growth pod takes an embryo from the line of the colonist the card is about',
  rescue: 'the colonist the card is about, if lying injured, is carried indoors to the nearest home',
};
/** Where a hint can point. */
export const HINT_TARGETS = ['build', 'buildItem', 'goals', 'minimap', 'alloys', 'energy', 'battery', 'cryo', 'clock', 'threat', 'army', 'people', 'mood', 'food', 'pause', 'fast'] as const;
const HINT_HELP: Record<(typeof HINT_TARGETS)[number], string> = {
  build: 'the Build button', buildItem: 'the Building in the build menu (the Build button while the menu is shut)', goals: 'the GOALS panel', minimap: 'the radar minimap',
  alloys: 'alloys (◆)', energy: 'power (⚡)', battery: 'the battery (🔋)', cryo: 'the cryo bank (❄)', clock: 'the clock', threat: 'the threat counter (⚠)', army: 'combat units (⚔)',
  people: 'colonists (👤)', mood: 'wellbeing and acceptance (☺ ⚖)', food: 'biomass (🌱)', pause: 'the pause button', fast: 'fast forward',
};
const on = (field: string, is: readonly string[], need = true) => ({ field, is, need });

/** A condition's kind field plus its parameters, each shown only for the kinds that use it. */
const conditionFields = <K extends string>(kindKey: K, label: string, kinds: readonly Condition[] = CONDITIONS) => ({
  [kindKey]: choice(kinds, { label, helps: CONDITION_HELP }),
  sol: num({ label: 'Sol', min: 1, max: 1000, step: 0.05, optional: true, help: 'Sol 1 is the landing day; 2.5 = midday of sol 2.', when: on(kindKey, ['time']) }),
  building: ref('buildings', { label: 'Building', optional: true, help: '"opened: select": empty = any building.', when: { ...on(kindKey, ['built', 'placed', 'opened']), need: false } }),
  count: int({ label: 'Count', min: -10000, max: 10000, optional: true, help: 'Empty = 1 (0 for counters).', when: on(kindKey, ['built', 'colonists', 'units', 'drones', 'packs', 'kills', 'lost', 'alloys', 'births', 'deaths', 'firstAge', 'acceptance', 'distrust', 'counter', 'counterBelow', 'planet', 'planetBelow', 'reports', 'cryoBelow', 'biomassBelow', 'embryosBelow', 'injured', 'children', 'autonomists', 'devoted', 'striking', 'linesGone', 'regard', 'regardBelow'], false) }),
  site: str({ label: 'Site', optional: true, help: 'A story site id on the region map.', when: on(kindKey, ['site', 'explored']) }),
  group: ref('inhabitants', { label: 'Group', optional: true, when: on(kindKey, ['contact', 'trust', 'regard', 'regardBelow']) }),
  flag: str({ label: 'Flag', optional: true, when: on(kindKey, ['flag']) }),
  counter: str({ label: 'Counter', optional: true, help: 'A name (lowercase, no spaces): counter effects add to it.', when: on(kindKey, ['counter', 'counterBelow']) }),
  timer: str({ label: 'Countdown', optional: true, help: 'The name a countdown effect started.', when: on(kindKey, ['timer']) }),
  panel: choice(HUD_PANELS, { label: 'Part of the HUD', optional: true, helps: PANEL_HELP, when: on(kindKey, ['opened']) }),
  research: ref('research', { label: 'Research', optional: true, when: on(kindKey, ['researched']) }),
  event: ref('story', { label: 'Event', optional: true, when: on(kindKey, ['after']) }),
  mission: ref('missions', { label: 'Mission', optional: true, when: on(kindKey, ['mission', 'failed']) }),
}) as { [P in K]: ReturnType<typeof choice<Condition, { label: string; helps: typeof CONDITION_HELP }>> } & {
  sol: NumField & { optional: true }; building: RefField & { optional: true }; count: NumField & { optional: true };
  site: StrField & { optional: true }; group: RefField & { optional: true }; flag: StrField & { optional: true };
  counter: StrField & { optional: true }; timer: StrField & { optional: true }; panel: ChoiceField<HudPanel> & { optional: true };
  research: RefField & { optional: true }; event: RefField & { optional: true }; mission: RefField & { optional: true };
};
/** The parameters a condition reads. */
export interface ConditionDef {
  sol?: number; building?: string; count?: number; site?: string; group?: string; flag?: string; counter?: string; timer?: string;
  panel?: HudPanel; research?: string; event?: string; mission?: string;
  /** all / any: the conditions in the group. */
  of?: SubConditionDef[];
}
/** Every condition in a trigger or objective, groups opened up. */
export function conditionsIn(kind: Condition, c: ConditionDef): { kind: Condition; c: ConditionDef }[] {
  if (kind === 'all' || kind === 'any') return (c.of ?? []).map((x) => ({ kind: x.kind as Condition, c: x as ConditionDef }));
  return [{ kind, c }];
}
/** One condition inside an all / any group (it can be turned round with `not`). */
export const subConditionShape = {
  ...conditionFields('kind', 'Condition', SUB_CONDITIONS),
  not: bool({ label: 'Not', optional: true, help: 'True when the condition is NOT met.' }),
} satisfies Shape;
export type SubConditionDef = Infer<typeof subConditionShape>;
/** A condition's fields plus its group list (for all / any). */
const conditionWithGroup = <K extends string>(kindKey: K, label: string) => ({
  ...conditionFields(kindKey, label),
  of: list(subConditionShape, { label: 'Conditions', max: 8, optional: true, help: 'The conditions in the group.', when: on(kindKey, ['all', 'any']) }),
});

const effectFields = {
  kind: choice(STORY_EFFECTS, { label: 'Effect', helps: EFFECT_HELP }),
  amount: num({ label: 'Amount', min: -10000, max: 10000, optional: true, when: on('kind', ['alloys', 'isotopes', 'biomass', 'planet', 'stance', 'wellbeing', 'regard', 'counter', 'setCounter', 'countdown', 'reveal', 'boost'], false) }),
  stat: choice(MOD_STATS, { label: 'Changes', optional: true, helps: MOD_HELP, when: on('kind', ['boost']) }),
  seconds: num({ label: 'Seconds', min: 0, max: 36000, unit: 's', optional: true, help: 'How long it lasts. Empty or 0 = for good.', when: on('kind', ['boost'], false) }),
  policy: str({ label: 'Policy', optional: true, help: 'key:value, e.g. hours:short, rations:lean, oversight:total, council:assembly.', when: on('kind', ['policy']) }),
  one: bool({ label: 'Only the one', optional: true, help: 'Only the colonist the card is about (its Cast).', when: on('kind', ['stance', 'wellbeing'], false) }),
  bloc: choice(['partner', 'autonomist', 'devoted'], { label: 'Only the bloc', optional: true, help: 'Only adults in this bloc.', when: on('kind', ['stance', 'wellbeing'], false) }),
  group: ref('inhabitants', { label: 'Group', optional: true, when: on('kind', ['regard']) }),
  flag: str({ label: 'Flag', optional: true, when: on('kind', ['flag', 'unflag']) }),
  counter: str({ label: 'Counter', optional: true, help: 'A name (lowercase, no spaces).', when: on('kind', ['counter', 'setCounter']) }),
  timer: str({ label: 'Countdown', optional: true, help: 'A name (lowercase, no spaces): a timer condition waits for it to run out.', when: on('kind', ['countdown', 'stopCountdown']) }),
  event: ref('story', { label: 'Event', optional: true, when: on('kind', ['event']) }),
  cinematic: ref('cinematics', { label: 'Cinematic', optional: true, when: on('kind', ['cinematic']) }),
  unit: ref('units', { label: 'Unit', optional: true, when: { ...on('kind', ['spawn', 'lock', 'unlock']), need: false } }),
  count: int({ label: 'Count', min: 1, max: 60, optional: true, help: 'Empty = 1.', when: on('kind', ['spawn'], false) }),
  guard: bool({ label: 'Guard the site', optional: true, help: 'Hostiles stay round the site and only fight what comes near, instead of attacking the colony.', when: on('kind', ['spawn'], false) }),
  building: ref('buildings', { label: 'Building', optional: true, when: { ...on('kind', ['lock', 'unlock', 'camera']), need: false } }),
  research: ref('research', { label: 'Research', optional: true, when: on('kind', ['research']) }),
  site: str({ label: 'Site', optional: true, help: 'A story site id on the region map.', when: { ...on('kind', ['spawn', 'reveal', 'waypoint', 'clearWaypoint', 'camera']), need: false } }),
  target: choice(HINT_TARGETS, { label: 'Points at', optional: true, helps: HINT_HELP, when: on('kind', ['hint']) }),
  text: str({ label: 'Text', multiline: true, optional: true, when: on('kind', ['log', 'countdown', 'waypoint', 'hint', 'win', 'fail', 'boost']) }),
};
export const effectShape = effectFields satisfies Shape;
export type EffectDef = Infer<typeof effectShape>;
export const storyEffectShape = {
  after: int({ label: 'When', min: 0, max: 4, default: 0, help: '0 = as soon as the event fires; 1–4 = when that choice is picked.' }),
  ...effectFields,
} satisfies Shape;
export type StoryEffectDef = Infer<typeof storyEffectShape>;

/**
 * A character (STORY.md §3): who is talking on story cards and in radio
 * messages. `{first}` in a name or line becomes the first pod-born colonist's
 * name.
 */
/**
 * Research (content/research/<id>.json): run at a Tech Lab, one at a time. Units and buildings
 * name the research they need; finishing one also sets the story flag research-<id>.
 */
/** Research branches (the Tech Lab's tabs). */
export const RESEARCH_BRANCHES = ['economy', 'defence', 'people', 'relic'] as const;
export type ResearchBranch = (typeof RESEARCH_BRANCHES)[number];
export const BRANCH_NAMES: Record<ResearchBranch, string> = { economy: 'Economy', defence: 'Defence', people: 'People', relic: 'Precursor' };

export const researchShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true, help: 'What it unlocks, for the Tech Lab card.' }),
  branch: choice(RESEARCH_BRANCHES, { label: 'Branch', optional: true, help: 'Which tab of the research tree it sits in. Empty = Economy.' }),
  requires: ref('research', { label: 'Needs first', optional: true, help: 'Another research that must be done before this one can start.' }),
  also: ref('research', { label: 'And needs', optional: true, help: 'A second research that must be done first.' }),
  building: ref('buildings', { label: 'Needs a building', optional: true, help: 'A finished building of this kind must stand (a C&C-style prerequisite).' }),
  specialist: choice(SPECIALTIES, { label: 'Needs a specialist', optional: true, help: 'An adult colonist with this specialty must live in the colony.' }),
  flag: str({ label: 'Needs a discovery', optional: true, help: 'A story flag that must be set: precursor finds (wreck-found, stone-found, relic-woke, relic-opened, nest-destroyed), contact-<group>, or any flag an event sets.' }),
  flagText: str({ label: 'Discovery, in words', optional: true, help: 'What the player must do for that flag, as the research tree shows it ("Sight a wreck from an earlier run").' }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys' }),
  isotopes: int({ label: 'Isotope cost', min: 0, max: 100000, optional: true }),
  seconds: num({ label: 'Time', min: 1, max: 3600, unit: 's', help: 'At one unstaffed Tech Lab; staff speed it up.' }),
  order: int({ label: 'Order', min: 0, max: 1000, optional: true, help: 'Position in the Tech Lab list (lower first).' }),
  effects: list(modShape, { label: 'Effects', max: 6, optional: true, help: 'What it changes once done (on top of unlocking the buildings and units that name it).' }),
} satisfies Shape;
export type ResearchDef = Infer<typeof researchShape>;

export const characterShape = {
  name: str({ label: 'Name', help: 'Shown above what they say. {first} = the first colonist out of a pod (their name).' }),
  role: str({ label: 'Role', optional: true, help: 'Under the name, smaller ("Sol Mission Control").' }),
  color: color({ label: 'Colour', default: '#5ff3ff', help: 'Their name, and the edge of their cards.' }),
  portrait: ref('assets', { label: 'Portrait', optional: true, assetKind: 'image', help: 'An image from the asset library (Assets), shown beside their lines.' }),
  description: str({ label: 'Who they are', multiline: true, optional: true, help: 'For writers (the game doesn\'t show it): voice, history, what they want.' }),
  ...organizeFields,
} satisfies Shape;
export type CharacterDef = Infer<typeof characterShape>;

/** One more line of a conversation (after the card's text). */
export const storyLineShape = {
  character: ref('characters', { label: 'Character', optional: true, help: 'Who says it. Empty = the card\'s speaker.' }),
  speaker: str({ label: 'Speaker', optional: true, help: 'Instead of a character: a name for this line only.' }),
  text: str({ label: 'Line', multiline: true }),
} satisfies Shape;

export const storyChoiceShape = {
  label: str({ label: 'Button' }),
  reply: str({ label: 'Reply', multiline: true, optional: true, help: 'Logged when this choice is picked.' }),
} satisfies Shape;

/**
 * A story event (STORY.md §8): a trigger, then a card (title, text, choices),
 * then effects. Each event fires once per game.
 */
export const storyShape = {
  title: str({ label: 'Title' }),
  style: choice(['card', 'radio'], { label: 'Shown as', optional: true, help: 'Empty = a card.', helps: {
    card: 'A card at the top of the screen that waits for an answer.',
    radio: 'A transmission in the corner: no choices; it closes by itself after a while (or when tapped) and stays in the log.',
  } }),
  character: ref('characters', { label: 'Character', optional: true, help: 'Who is talking (Story → Characters): their name, colour and portrait.' }),
  speaker: str({ label: 'Speaker', optional: true, help: 'Or just a name for who is talking, shown above the text.' }),
  text: str({ label: 'Text', multiline: true, help: '{first} = the first colonist\'s name.' }),
  lines: list(storyLineShape, { label: 'More lines', max: 12, optional: true, help: 'A conversation: each line follows the text, one at a time (Next). The choices come with the last line.' }),
  ...conditionWithGroup('trigger', 'Trigger'),
  delay: num({ label: 'Delay', min: 0, max: 3600, unit: 's', optional: true, help: 'Wait this long after the trigger before firing.' }),
  region: ref('regions', { label: 'Only in region', optional: true, help: 'Empty = any region.' }),
  unless: str({ label: 'Unless flag', optional: true, help: 'Doesn\'t fire if this flag is set.' }),
  pause: bool({ label: 'Pause the game', optional: true, help: 'Pauses while the card is open (tutorials, big moments).' }),
  dilemma: bool({ label: 'Colony dilemma', optional: true, help: 'Waits its turn: dilemmas start after the colony rules\' first-dilemma time, at most one per dilemma gap, and never while another card is waiting.' }),
  again: num({ label: 'Can come again after', min: 0, max: 36000, unit: 's', optional: true, help: 'Dilemmas: once answered, it can fire again this long after (its trigger met again). Empty = once a game.' }),
  cast: choice(CASTS, { label: 'About', optional: true, helps: CAST_HELP, help: 'The colonist the card is about: {who} in its text is their name, {whoLine} their family line. With no one to fit, it waits.' }),
  choices: list(storyChoiceShape, { label: 'Choices', max: 4, optional: true, help: 'None = a single Continue button.' }),
  effects: list(storyEffectShape, { label: 'Effects', max: 16, optional: true }),
  ...organizeFields,
} satisfies Shape;
export type StoryDef = Infer<typeof storyShape>;

export const objectiveShape = {
  text: str({ label: 'Text', help: 'What the GOALS panel says ("Build a Solar Array").' }),
  ...conditionWithGroup('kind', 'Done'),
} satisfies Shape;
/** What fails a mission (any one of them). */
export const failShape = {
  text: str({ label: 'Text', optional: true, help: 'Logged when it fails ("The cryo bank was lost").' }),
  ...conditionWithGroup('kind', 'Fails'),
} satisfies Shape;
export type ObjectiveDef = Infer<typeof objectiveShape>;

/**
 * A mission (STORY.md §8 tutorial missions): objectives shown in the GOALS
 * panel, done in any order; when all are done, rewards and the next mission.
 */
export const missionShape = {
  title: str({ label: 'Title' }),
  summary: str({ label: 'Summary', multiline: true, optional: true, help: 'For the editor and the Missions list: what it teaches.' }),
  after: ref('missions', { label: 'Starts after', optional: true, help: 'Starts when this mission is complete. Empty = when the colony deploys.' }),
  region: ref('regions', { label: 'Only in region', optional: true, help: 'Empty = any region.' }),
  objectives: list(objectiveShape, { label: 'Objectives', max: 12 }),
  onStart: ref('story', { label: 'Event at start', optional: true, help: 'A story event fired when the mission starts (a briefing).' }),
  onDone: ref('story', { label: 'Event when done', optional: true, help: 'A story event fired when it\'s complete.' }),
  rewards: list(effectShape, { label: 'Rewards', max: 12, optional: true, help: 'Effects when the mission is complete.' }),
  fails: list(failShape, { label: 'Fails when', max: 6, optional: true, help: 'Any one of these fails the mission while it is under way: no rewards, and missions after it don\'t start.' }),
  onFail: ref('story', { label: 'Event when failed', optional: true, help: 'A story event fired when it fails (a retry offer, a consequence).' }),
  failEnds: bool({ label: 'Failing ends the game', optional: true, help: 'The game is lost when it fails (with the fail text on the end screen).' }),
  ...organizeFields,
} satisfies Shape;
export type MissionDef = Infer<typeof missionShape>;

/**
 * Bodies (content/bodies/<id>.json): the star's planets, their moons,
 * asteroids and comets. Every one is drawn in the solar system; any but a gas
 * giant can hold regions (a region's `body`), and the one being played becomes
 * the world: its radius, terrain, colours and sky (src/world/planet.ts), with
 * the rest of the system placed round it (src/world/system.ts).
 */
export const BODY_KINDS = ['planet', 'moon', 'asteroid', 'comet', 'giant'] as const;
/** Fields for bodies with a surface (not gas giants). */
const LANDABLE = ['planet', 'moon', 'asteroid', 'comet'] as const;
const surface = () => ({ when: on('kind', LANDABLE, false) });
const giantOnly = { when: on('kind', ['giant'], false) };
export const bodyColorShape = { color: color({ label: 'Colour' }) } satisfies Shape;
export const bodyShape = {
  name: str({ label: 'Name', help: 'As the label in the system view shows it (capitals read best).' }),
  sub: str({ label: 'Subtitle', optional: true, help: 'Under the name in the system view (e.g. "cold desert").' }),
  kind: choice(BODY_KINDS, { label: 'Kind', helps: {
    planet: 'A rocky planet circling the star.',
    moon: 'Circles a planet (set Orbits).',
    asteroid: 'A small lumpy rock.',
    comet: 'An icy rock on a long, eccentric orbit; grows a tail near the star.',
    giant: 'A gas giant: banded, maybe ringed. Nothing can land on it.',
  } }),
  parent: ref('bodies', { label: 'Orbits', optional: true, help: 'The body it circles. Empty = the star.' }),
  radius: num({ label: 'Radius', min: 40, max: 20000, step: 10, unit: 'u', help: 'Home is 3,000 u. A region needs a body several times its own half-width.' }),
  orbit: num({ label: 'Orbit size', min: 500, max: 600000, step: 100, unit: 'u', help: 'Distance from what it orbits (the semi-major axis). Home is 75,000 u from the star.' }),
  ecc: num({ label: 'Eccentricity', min: 0, max: 0.95, step: 0.01, optional: true, help: '0 = a circle; comets are 0.8–0.9.' }),
  incl: num({ label: 'Tilt of orbit', min: -60, max: 60, step: 0.1, unit: '°', optional: true }),
  period: num({ label: 'Orbit time', min: 10, max: 100000, step: 10, unit: 's', help: 'Real seconds for one orbit. Home takes 3,600 s.' }),
  phase: num({ label: 'Start angle', min: 0, max: 360, step: 1, unit: '°', optional: true, help: 'Where on its orbit it starts.' }),
  relief: num({ label: 'Relief', min: 0, max: 400, step: 1, unit: 'u', optional: true, default: 90, help: 'Height of its hills and basins. Home: 90.', ...surface() }),
  feature: num({ label: 'Feature size', min: 0.3, max: 12, step: 0.1, optional: true, default: 2.1, help: 'Higher = smaller, busier landforms. Home: 2.1.', ...surface() }),
  seed: int({ label: 'Seed', min: 1, max: 999999, optional: true, default: 7, help: 'A different seed, a different landscape (or cloud bands).' }),
  ocean: bool({ label: 'Seas', optional: true, help: 'Water below height 0. Without seas the lowest ground is dry basin floor.', ...surface() }),
  plants: num({ label: 'Plant life', min: -1, max: 1, step: 0.05, optional: true, default: -1, help: '−1 = barren; 0 = as lush as Home; more = lusher. Moves the flora field.', ...surface() }),
  biome: ref('biomes', { label: 'Biome', optional: true, help: 'Its plants and wildlife (Nature → Biomes). Empty = picked from its air, seas, frost and plant life.', ...surface() }),
  ground: list(bodyColorShape, { label: 'Ground colours', max: 6, optional: true, help: 'Low ground to high ground (2–6). Empty = Home\'s browns.', ...surface() }),
  deep: color({ label: 'Deep water', optional: true, default: '#0f2a3a', when: on('ocean', ['true'], false) }),
  shallow: color({ label: 'Shallow water', optional: true, default: '#1f5a6a', when: on('ocean', ['true'], false) }),
  shore: color({ label: 'Shore', optional: true, default: '#b59b74', when: on('ocean', ['true'], false) }),
  floraA: color({ label: 'Plants', optional: true, default: '#563a78', help: 'Ground tint where plants grow.', ...surface() }),
  floraB: color({ label: 'Plants (second)', optional: true, default: '#2d6e68', ...surface() }),
  snow: color({ label: 'Snow / frost', optional: true, default: '#ddd3c4', ...surface() }),
  snowLine: num({ label: 'Snow line', min: 0, max: 400, step: 1, unit: 'u', optional: true, help: 'Snow from this height up. Empty or 0 = none. Home: 34.', ...surface() }),
  surface: choice(['auto', 'cratered', 'icy', 'volcanic', 'sulfur', 'dusty', 'verdant', 'smooth'], { label: 'Surface look', optional: true, helps: {
    auto: 'Picked from its kind, colours and air (empty means the same).',
    cratered: 'Craters at three scales with bright rims and rays, and dark maria: airless rock.',
    icy: 'A bright crust cut by long fractures, a few craters, frosted poles.',
    volcanic: 'Dark plates of crust with molten seams glowing between them.',
    sulfur: 'Yellow plains spotted with dark calderas in pale and red halos; a few glow.',
    dusty: 'Wind-streaked dunes, worn craters and frost caps: a desert with thin air.',
    verdant: 'Only a fine grain over its own colours (living worlds).',
    smooth: 'Hardly any detail.',
  }, help: 'How it looks from space, drawn per pixel over its colours (system view, title tour, Worlds preview).', ...surface() }),
  surfaceDetail: num({ label: 'Surface detail', min: 0, max: 2, step: 0.05, optional: true, default: 1, help: 'Strength of the surface look: 0 = none, 2 = twice as strong.', ...surface() }),
  craters: num({ label: 'Craters', min: 0, max: 3, step: 0.05, optional: true, default: 1, help: 'How many craters the look has (× its usual).', ...surface() }),
  atmosphere: color({ label: 'Atmosphere', optional: true, help: 'The glow round it from space. Empty = airless.' }),
  haze: num({ label: 'Atmosphere strength', min: 0, max: 3, step: 0.05, optional: true, default: 1 }),
  sky: color({ label: 'Daytime sky', optional: true, help: 'Seen from the ground. Empty = black (airless) or Home\'s if it has an atmosphere.', ...surface() }),
  clouds: bool({ label: 'Clouds', optional: true, help: 'Cloud cover seen from orbit.', ...surface() }),
  bands: list(bodyColorShape, { label: 'Bands', max: 8, optional: true, help: 'The gas giant\'s cloud bands, pole to pole.', ...giantOnly }),
  ring: bool({ label: 'Ring', optional: true }),
  ringInner: num({ label: 'Ring inner edge', min: 1.05, max: 4, step: 0.05, optional: true, default: 1.4, help: 'Times the radius.', when: on('ring', ['true'], false) }),
  ringOuter: num({ label: 'Ring outer edge', min: 1.1, max: 6, step: 0.05, optional: true, default: 2.2, help: 'Times the radius.', when: on('ring', ['true'], false) }),
  ringColor: color({ label: 'Ring colour', optional: true, default: '#d6c39c', when: on('ring', ['true'], false) }),
  ringOpacity: num({ label: 'Ring opacity', min: 0.02, max: 1, step: 0.02, optional: true, default: 0.4, when: on('ring', ['true'], false) }),
  ringTilt: num({ label: 'Ring tilt', min: -90, max: 90, step: 1, unit: '°', optional: true, default: 24, when: on('ring', ['true'], false) }),
  description: str({ label: 'Notes', multiline: true, optional: true, help: 'For the editor.' }),
} satisfies Shape;
export type BodyDef = Infer<typeof bodyShape>;

/** Region paint grids: one sample every REGION_STEP units across the whole region. */
export const REGION_STEP = 2;
export const REGION_CELLS = (REGION_HALF * 2) / REGION_STEP + 1; // 121 (a 240 u region)
/** Grid nodes per side for a region of half-width `half`. */
export const regionCells = (half: number) => Math.round((half * 2) / REGION_STEP) + 1;
/** Region sizes (side length, u): every one keeps the paint grids, fog and nav cells whole. */
export const REGION_SIZE_MIN = 120, REGION_SIZE_MAX = 480, REGION_SIZE_STEP = 40;
/** Marker coordinates may go this far out (the largest region's half-width). */
const XZ = REGION_SIZE_MAX / 2;
/** Height grid values are tenths of a world unit. */
export const HEIGHT_SCALE = 0.1;

export const herdShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  grazers: int({ label: 'Grazers', min: 0, max: 400 }),
  roam: num({ label: 'Roam radius', min: 0, max: 240, unit: 'u', help: 'How far the herd may wander from here. 0 = stays put.' }),
  species: ref('wildlife', { label: 'Species', optional: true, help: 'Empty = picked from the biome\'s wildlife. Grazers is scaled by the species\' Herd size ×.' }),
} satisfies Shape;
export type HerdDef = Infer<typeof herdShape>;

export const depositShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  alloys: int({ label: 'Alloys', min: 1, max: 1000000 }),
} satisfies Shape;
export type DepositDef = Infer<typeof depositShape>;

export const ventShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
} satisfies Shape;
export type VentDef = Infer<typeof ventShape>;

export const spawnShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  nest: bool({ label: 'Nest', optional: true, default: true, help: 'A nest grows here (a fauna unit with Nest set). Destroy it and packs stop coming from here until it regrows. Off = packs come from open ground.' }),
} satisfies Shape;

export const seamShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  isotopes: int({ label: 'Isotopes', min: 1, max: 100000 }),
} satisfies Shape;
export type SeamDef = Infer<typeof seamShape>;

export const relicShape = {
  grid: str({ label: 'Grid', help: 'Relics with the same grid id wake together and fall with their nodes. Lowercase, no spaces.' }),
  kind: choice(['sentinel', 'node', 'cache'], { label: 'Part', help: 'sentinel: a guard tower (the unit with Relic part = sentinel). node: powers the grid. cache: opens when every node of its grid is down, paying out what it holds.' }),
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  alloys: int({ label: 'Cache: alloys', min: 0, max: 100000, optional: true }),
  isotopes: int({ label: 'Cache: isotopes', min: 0, max: 100000, optional: true }),
} satisfies Shape;
export type RelicDef = Infer<typeof relicShape>;

export const wreckShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  yaw: num({ label: 'Facing', min: -180, max: 180, step: 5, unit: '°', optional: true }),
  alloys: int({ label: 'Salvage', min: 0, max: 100000, unit: 'alloys', help: 'What Field Engineers can strip from it.' }),
} satisfies Shape;
export type WreckDef = Infer<typeof wreckShape>;
export type SpawnDef = Infer<typeof spawnShape>;

export const siteShape = {
  id: str({ label: 'Id', help: 'Story events name the site by this (a "Reach a site" trigger). Lowercase, no spaces.' }),
  label: str({ label: 'Label', optional: true, help: 'For the editor only.' }),
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  r: num({ label: 'Radius', min: 2, max: 120, step: 0.5, unit: 'u', default: 10, help: 'A drone or combat unit this close has reached it.' }),
} satisfies Shape;
export type SiteDef = Infer<typeof siteShape>;

export const campShape = {
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  group: ref('inhabitants', { label: 'Who lives here', help: 'An inhabitant group (Story → Inhabitants).' }),
  yaw: num({ label: 'Facing', min: -180, max: 180, step: 5, unit: '°', optional: true, help: 'Turns the whole camp.' }),
} satisfies Shape;
export type CampDef = Infer<typeof campShape>;

/**
 * A map encounter: hostiles placed on the map, guarding a spot, walking a
 * patrol, or attacking the colony, there from the start or once a flag is set
 * (sim/core.ts stepEncounters). Beating them can set a flag.
 */
export const encounterShape = {
  id: str({ label: 'Id', help: 'Lowercase, no spaces: names it in the log and the editor.' }),
  unit: ref('units', { label: 'Unit', help: 'A fauna unit or a relic sentinel (they are hostile).' }),
  count: int({ label: 'Count', min: 1, max: 40, default: 3 }),
  x: num({ label: 'X', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -XZ, max: XZ, step: 0.5, unit: 'u' }),
  mode: choice(['guard', 'patrol', 'attack'], { label: 'Behaviour', helps: {
    guard: 'Stays within the radius of this spot and only fights what comes near.',
    patrol: 'Walks between this spot and the patrol end, fighting what comes near.',
    attack: 'Goes for the colony as soon as it appears, like a pack.',
  } }),
  r: num({ label: 'Radius', min: 4, max: 120, step: 0.5, unit: 'u', optional: true, default: 14, help: 'How far guards and patrols stray to fight.', when: on('mode', ['guard', 'patrol'], false) }),
  x2: num({ label: 'Patrol end X', min: -XZ, max: XZ, step: 0.5, unit: 'u', optional: true, when: on('mode', ['patrol']) }),
  z2: num({ label: 'Patrol end Z', min: -XZ, max: XZ, step: 0.5, unit: 'u', optional: true, when: on('mode', ['patrol']) }),
  flag: str({ label: 'Appears when flag', optional: true, help: 'Empty = there from the start. Otherwise it appears once a story event or mission sets the flag.' }),
  doneFlag: str({ label: 'Flag when beaten', optional: true, help: 'Set when the last of them dies: story events and objectives can wait for it.' }),
} satisfies Shape;
export type EncounterDef = Infer<typeof encounterShape>;

/** A ground paint (map editor: Paint ground). */
export const paintShape = {
  name: str({ label: 'Name' }),
  color: color({ label: 'Colour' }),
} satisfies Shape;
export const regionShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  body: ref('bodies', { label: 'Body', optional: true, help: 'The planet, moon, asteroid or comet it\'s on (Worlds). Empty = Home.' }),
  size: int({ label: 'Size', min: REGION_SIZE_MIN, max: REGION_SIZE_MAX, step: REGION_SIZE_STEP, unit: 'u', optional: true, help: 'Side length of the playable square. Empty = 240 u. Change it in the map editor (Region size), which crops or pads the painting round the centre.' }),
  detail: num({ label: 'Local relief', min: 0, max: 60, step: 0.5, unit: 'u', optional: true, help: 'Height of the region\'s own bumps on top of the body\'s terrain. Empty = 10 u.' }),
  detailSize: num({ label: 'Local feature size', min: 2, max: 60, step: 0.5, unit: 'u', optional: true, help: 'Roughly how far apart those bumps are. Empty = 10 u.' }),
  detailSeed: int({ label: 'Local relief seed', min: 1, max: 999999, optional: true, help: 'A different seed, a different pattern of bumps. Empty = 21.' }),
  floraSeed: int({ label: 'Flora seed', min: 1, max: 999999, help: 'Picks the plant species. ?flora=<seed> in the URL overrides it.' }),
  biome: ref('biomes', { label: 'Biome', optional: true, help: 'Empty = the world\'s. ?biome=<id> in the URL overrides it for a test.' }),
  floraDensity: num({ label: 'Flora density', min: 0, max: 3, step: 0.05, default: 1, help: 'Multiplies the number of plants everywhere.' }),
  siteLat: num({ label: 'Site: degrees north', min: -80, max: 80, step: 1, unit: '°', optional: true, help: 'Where on the planet the region sits, from Touchdown. Moving it changes the generated ground under your sculpting (0, 0 = Touchdown\'s spot).' }),
  siteLon: num({ label: 'Site: degrees east', min: -180, max: 180, step: 1, unit: '°', optional: true, help: 'Degrees east of Touchdown.' }),
  keepSea: bool({ label: 'Keep the sea', optional: true, help: 'On a world with seas the ground round a region is normally raised onto dry land. Tick this to leave the sea and coast as they are (the Core\'s pad stays dry). Sculpt below 0 for more water: units and buildings can\'t go in it.' }),
  packScale: num({ label: 'Pack size ×', min: 0, max: 5, step: 0.05, optional: true, help: 'Multiplies every predator pack here (and the largest pack). Empty = 1, as the threat rules say.' }),
  graceSeconds: num({ label: 'Grace period', min: 0, max: 7200, unit: 's', optional: true, help: 'No attacks before this. Empty = the threat rules\' grace period.' }),
  waveInterval: num({ label: 'Time between packs', min: 10, max: 3600, unit: 's', optional: true, help: 'Empty = the threat rules\' interval.' }),
  startAlloys: int({ label: 'Starting alloys', min: 0, max: 100000, optional: true, help: 'Empty = the colony rules\' starting alloys.' }),
  // grids are square, one node every REGION_STEP u across the region's size (0 = sized by the record: see db.ts)
  height: grid(0, 0, -600, 600, { label: 'Height sculpt', optional: true, help: 'Added to the generated terrain, in tenths of a unit.' }),
  flora: grid(0, 0, -100, 100, { label: 'Flora paint', optional: true, help: '−100 clears plants, +100 doubles them and makes the ground lush.' }),
  ground: grid(0, 0, 0, 899, { label: 'Ground paint', optional: true, help: 'Painted ground colour: paint number × 100 + amount (0–99). Use the map editor\'s Paint ground.' }),
  paints: list(paintShape, { label: 'Ground paints', max: 8, optional: true, help: 'The colours Paint ground uses. Empty = the standard eight (rock, sand, soil, moss, ash, ice, rust, bloom).' }),
  herds: list(herdShape, { label: 'Grazer herds', max: 60 }),
  deposits: list(depositShape, { label: 'Alloy deposits', max: 60 }),
  spawns: list(spawnShape, { label: 'Predator spawns', max: 20 }),
  vents: list(ventShape, { label: 'Geothermal vents', max: 20, optional: true }),
  camps: list(campShape, { label: 'Inhabitant camps', max: 8, optional: true }),
  sites: list(siteShape, { label: 'Story sites', max: 40, optional: true }),
  relics: list(relicShape, { label: 'Relics', max: 40, optional: true, help: 'Precursor relic grids (STORY.md E2 Handshake). A grid wakes when anything of ours comes within a relic\'s aggro radius: it scans us and half its sentinels stand down. Sets flags relic-woke and relic-opened.' }),
  seams: list(seamShape, { label: 'Isotope seams', max: 20, optional: true, help: 'Glowing outcrops of exotic isotopes. A Deep-Core Mine (role deepmine) sits on one.' }),
  wrecks: list(wreckShape, { label: 'Wrecks', max: 20, optional: true, help: 'Hulls from an earlier run, in our own build style. The first sight of one sets the story flag wreck-found; Field Engineers salvage alloys from them.' }),
  encounters: list(encounterShape, { label: 'Encounters', max: 30, optional: true, help: 'Hostiles placed on the map: guards, patrols or attackers, there from the start or once a flag is set (map editor: Add encounter, N).' }),
} satisfies Shape;
export type RegionDef = Infer<typeof regionShape>;
/**
 * Cinematics (content/cinematics/<id>.json; src/cinematic.ts plays them): a
 * timeline of camera keys, captions, spoken lines and sounds over the world.
 * A cinematic with its own trigger plays once when it's met; a story event or
 * mission can also play one (the `cinematic` effect). The game pauses while one
 * plays, and the player can skip it.
 *
 * The landing (cinematics/landing.json, scene `landing`) is one of them: the
 * probe's descent is its set piece, and its beats time the probe's moves.
 */
const beat = (label: string, help: string) => num({ label, min: 0, max: 600, step: 0.1, unit: 's', optional: true, help, when: on('scene', ['landing']) });
export const CINE_TARGETS = ['site', 'building', 'storysite', 'camp', 'probe'] as const;
export const cameraKeyShape = {
  at: num({ label: 'At', min: 0, max: 600, step: 0.05, unit: 's' }),
  target: choice(CINE_TARGETS, { label: 'Looks at', helps: {
    site: 'A point on the ground: X, Z and Lift (region units; the Core is at 0, 0).',
    building: 'The colony\'s first building of a kind (the Command Core if there is none).',
    storysite: 'A story site on the region map.',
    camp: 'The camp of an inhabitant group.',
    probe: 'The probe as it comes down (the landing only).',
  } }),
  x: num({ label: 'X', min: -120, max: 120, step: 0.5, unit: 'u', optional: true, when: on('target', ['site'], false) }),
  z: num({ label: 'Z', min: -120, max: 120, step: 0.5, unit: 'u', optional: true, when: on('target', ['site'], false) }),
  building: ref('buildings', { label: 'Building', optional: true, when: on('target', ['building']) }),
  site: str({ label: 'Story site', optional: true, help: 'A story site id on the region map.', when: on('target', ['storysite']) }),
  group: ref('inhabitants', { label: 'Group', optional: true, when: on('target', ['camp']) }),
  lift: num({ label: 'Lift', min: -20, max: 200, step: 0.5, unit: 'u', default: 0 }),
  dist: num({ label: 'Distance', min: 5, max: 3000, step: 0.5, unit: 'u', help: 'From what it looks at.' }),
  follow: num({ label: 'Pull back with height', min: 0, max: 5, step: 0.05, optional: true, when: on('target', ['probe'], false), help: 'Extra distance for each unit of the probe\'s altitude (so the chase widens high up).' }),
  pitch: num({ label: 'Pitch', min: -1.5, max: 1.5, step: 0.01, unit: 'rad', help: '0 = level, higher = looking down from above.' }),
  yaw: num({ label: 'Yaw', min: -6.3, max: 6.3, step: 0.01, unit: 'rad', help: 'Round the target; 0 = from the south.' }),
} satisfies Shape;
export type CameraKeyDef = Infer<typeof cameraKeyShape>;
export const captionShape = {
  at: num({ label: 'At', min: 0, max: 600, step: 0.05, unit: 's' }),
  title: str({ label: 'Title' }),
  sub: str({ label: 'Line', optional: true, help: 'Landing only: {alt} = altitude (km), {speed} = speed (m/s), {shield} = heat-shield temperature (°C).' }),
} satisfies Shape;
/** Something said during a cinematic: a subtitle with the speaker's name and colour. */
export const cineLineShape = {
  at: num({ label: 'At', min: 0, max: 600, step: 0.05, unit: 's' }),
  character: ref('characters', { label: 'Character', optional: true, help: 'Who says it (their name and colour).' }),
  speaker: str({ label: 'Speaker', optional: true, help: 'Instead of a character: a name for this line only.' }),
  text: str({ label: 'Line', multiline: true, help: '{first} = the first colonist\'s name.' }),
  for: num({ label: 'Shows for', min: 0.5, max: 60, step: 0.1, unit: 's', optional: true, help: 'Empty = until the next line (or 5 s for the last).' }),
} satisfies Shape;
/** A sound or music cue: an audio file from the asset library. */
export const cineSoundShape = {
  at: num({ label: 'At', min: 0, max: 600, step: 0.05, unit: 's' }),
  sound: ref('assets', { label: 'Sound', assetKind: 'audio', help: 'An audio file from the asset library (Assets).' }),
  volume: num({ label: 'Volume', min: 0, max: 1, step: 0.05, default: 1 }),
  music: bool({ label: 'Music', optional: true, help: 'Loops until the cinematic ends, then fades out.' }),
} satisfies Shape;
const cineTrigger = conditionWithGroup('trigger', 'Plays');
export const cinematicShape = {
  title: str({ label: 'Title', help: 'For the editor; players don\'t see it.' }),
  scene: choice(['world', 'landing'], { label: 'Scene', optional: true, help: 'Empty = the world.', helps: {
    world: 'The game world as it is: the camera moves over the colony while the game is paused.',
    landing: 'The probe\'s descent (the opening landing); its beats time the probe.',
  } }),
  length: num({ label: 'Length', min: 1, max: 600, step: 0.1, unit: 's', help: 'The cinematic hands back to the game here.' }),
  burn: beat('Retro burn', 'The thrusters light.'),
  touchdown: beat('Touchdown', 'The probe lands (the dust burst, the drone stage starts).'),
  open: beat('Shell opens', 'The petals start to fold out.'),
  power: beat('Core power', 'The Core\'s lights come up.'),
  dissolve: beat('Reclaim starts', 'The petals start dissolving.'),
  reclaimed: beat('Reclaimed', 'The shell is gone.'),
  hatch: beat('Bay opens', 'The drone bay hatch opens.'),
  drone: beat('Drone out', 'The worker drone appears in the bay.'),
  post: beat('Drone at post', 'The drone reaches its post; the colony deploys.'),
  letterbox: bool({ label: 'Letterbox', optional: true, default: true, help: 'Black bars top and bottom while it plays.' }),
  fadeIn: num({ label: 'Fade in', min: 0, max: 10, step: 0.1, unit: 's', optional: true, help: 'From black at the start.' }),
  fadeOut: num({ label: 'Fade out', min: 0, max: 10, step: 0.1, unit: 's', optional: true, help: 'To black before the end (then back to the game).' }),
  camera: list(cameraKeyShape, { label: 'Camera keys', max: 60, help: 'The camera passes smoothly through each key in time order. A world cinematic hands the camera back where it was; the landing\'s last key should match the normal view (looking at 0, −8 from 75 u, pitch 0.85, yaw 0.4).' }),
  captions: list(captionShape, { label: 'Captions', max: 40, optional: true, help: 'Big titles, each from its time until the next.' }),
  lines: list(cineLineShape, { label: 'Lines', max: 60, optional: true, help: 'Subtitles: who says what, when.' }),
  sounds: list(cineSoundShape, { label: 'Sounds and music', max: 40, optional: true }),
  ...cineTrigger,
  trigger: { ...cineTrigger.trigger, default: 'never' as const },
  region: ref('regions', { label: 'Only in region', optional: true, help: 'Empty = any region.' }),
  unless: str({ label: 'Unless flag', optional: true, help: 'Doesn\'t play if this flag is set.' }),
  ...organizeFields,
} satisfies Shape;
export type CinematicDef = Infer<typeof cinematicShape>;
/** @deprecated name: the landing is a cinematic. */
export type LandingDef = CinematicDef;
export const BEATS = ['burn', 'touchdown', 'open', 'power', 'dissolve', 'reclaimed', 'hatch', 'drone', 'post'] as const;

/**
 * Chapters (content/chapters/<id>.json): how the writers divide the story, for
 * the editor only. Story records name theirs in `chapter`; the story board has
 * a column per chapter, in order.
 */
export const chapterShape = {
  title: str({ label: 'Title' }),
  order: int({ label: 'Order', min: 0, max: 999, default: 1, help: 'Chapters run in this order on the story board and in the sidebar.' }),
  act: str({ label: 'Act', optional: true, help: 'A heading above a run of chapters (e.g. "Act 1 — The Planet").' }),
  color: color({ label: 'Colour', default: '#5ff3ff', help: 'Its column and its records\' marks in the sidebar.' }),
  summary: str({ label: 'Summary', multiline: true, optional: true, help: 'What happens in it, in a few lines.' }),
  notes: str({ label: 'Writer\'s notes', multiline: true, optional: true }),
} satisfies Shape;
export type ChapterDef = Infer<typeof chapterShape>;

/**
 * The story bible (content/lore/<id>.json): places, history, factions, objects
 * and ideas the story leans on, for the writers. Editor only: the game doesn't
 * show them (yet).
 */
export const LORE_KINDS = ['place', 'history', 'faction', 'object', 'idea', 'other'] as const;
export const loreShape = {
  title: str({ label: 'Title' }),
  kind: choice(LORE_KINDS, { label: 'Kind', helps: {
    place: 'A location: a region, a ruin, a world.',
    history: 'Something that happened before the game (an earlier run, a war, a landing).',
    faction: 'A group with its own aims (a probe, an inhabitant people, the ASI).',
    object: 'A thing: an artefact, a ship, a weapon.',
    idea: 'A theme, a rule of the world, a mystery and its answer.',
    other: 'Anything else.',
  } }),
  text: str({ label: 'Text', multiline: true }),
  secret: bool({ label: 'A secret', optional: true, help: 'Something the player only learns late (or never): keep it out of early text.' }),
  ...organizeFields,
} satisfies Shape;
export type LoreDef = Infer<typeof loreShape>;

/** The HUD's look (src/ui-theme.ts sets them as CSS variables; style.css uses them). */
export const interfaceShape = {
  accent: color({ label: 'Accent', default: '#5ff3ff', help: 'Headings, values, outlines and highlights (cyan).' }),
  warning: color({ label: 'Warning', default: '#ffb547', help: 'Cautions, story card titles, things to look at (amber).' }),
  danger: color({ label: 'Danger', default: '#ff4d5e', help: 'Attacks, losses, red alerts (crimson).' }),
  text: color({ label: 'Text', default: '#d6f6ff' }),
  panel: color({ label: 'Panels', default: '#060e16', help: 'The colour behind panels, cards and buttons.' }),
  panelOpacity: num({ label: 'Panel opacity', min: 0.2, max: 1, step: 0.02, default: 0.72, help: 'How solid panels are (cards and menus stay a little more solid than this).' }),
  lineOpacity: num({ label: 'Outline strength', min: 0, max: 1, step: 0.02, default: 0.28, help: 'Panel outlines, in the accent colour.' }),
  scale: num({ label: 'Interface size', min: 0.75, max: 1.5, step: 0.05, default: 1, help: 'Everything on the HUD, bigger or smaller (1 = as designed). Players with small or very large screens notice this most.' }),
  logLines: int({ label: 'Log lines', min: 1, max: 12, default: 5, help: 'How many messages the log at the bottom left shows at once.' }),
  logSeconds: num({ label: 'Log line lasts', min: 2, max: 60, step: 0.5, unit: 's', default: 10.5, help: 'Before it fades away.' }),
} satisfies Shape;
export type InterfaceDef = Infer<typeof interfaceShape>;

/** localStorage key: the editor's Play test leaves { id, def } here for the game's ?preview=1. */
export const PREVIEW_KEY = 'exo.preview';

// ---------- nature: biomes and wildlife ----------

/** Plant forms (src/world/flora.ts ARCHETYPES). */
export const PLANT_FORMS = ['spire', 'parasol', 'canopy', 'tendril', 'fan', 'tubes', 'bulbs', 'crystal', 'reeds', 'cap', 'barrel', 'thorn', 'lichen'] as const;
export type PlantForm = (typeof PLANT_FORMS)[number];
const PLANT_HELPS: Record<PlantForm, string> = {
  spire: 'Big: a tall ribbed stalk with a glowing bulb on top.',
  parasol: 'Big: a leaning trunk under one to three drooping caps with glowing gills.',
  canopy: 'Big: a broad tree, clumps of foliage on a forked trunk.',
  tendril: 'Big: a giant curling whip, glowing at the tip.',
  fan: 'A rosette of curling fronds.',
  tubes: 'A clump of upright tubes with glowing mouths.',
  bulbs: 'Spore pods on short stalks.',
  crystal: 'Lithophyte prisms with glowing tips. Grows on cliffs and peaks.',
  reeds: 'A tuft of tall thin blades.',
  cap: 'A cluster of mushroom caps.',
  barrel: 'A ribbed succulent, maybe with arms, flowering on top. Likes bare ground.',
  thorn: 'Dry, spiky scrub. Likes bare ground.',
  lichen: 'Flat crusts and mats, hugging the rock. Grows on cliffs.',
};
export const plantRowShape = {
  plant: choice(PLANT_FORMS, { label: 'Form', helps: PLANT_HELPS }),
  chance: num({ label: 'Chance', min: 0, max: 1, step: 0.05, optional: true, default: 1, help: 'Chance a region grows this form (1 = always).' }),
  amount: num({ label: 'Amount', min: 0.1, max: 3, step: 0.05, optional: true, default: 1, help: 'How much of it, against the other forms.' }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model to draw instead of the built-in shape, coloured from its materials named stem (graded root to tip), leaf and glow. Empty = the built-in, a new shape every seed.' }),
} satisfies Shape;
export const wildRowShape = {
  species: ref('wildlife', { label: 'Species' }),
  weight: num({ label: 'Weight', min: 0, max: 5, step: 0.1, optional: true, default: 1, help: 'How often an unassigned herd is this species.' }),
} satisfies Shape;
export const biomeShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Notes', multiline: true, optional: true }),
  plants: list(plantRowShape, { label: 'Plant forms', max: 13, help: 'Each form that a region rolls becomes one species there, with its own shape and colours.' }),
  extra: int({ label: 'Extra species', min: 0, max: 4, optional: true, default: 1, help: 'More species of the forms that grew, so a region has look-alikes.' }),
  stems: list(bodyColorShape, { label: 'Plant colours', max: 8, help: 'Stems and leaves (each species picks one and varies it).' }),
  glows: list(bodyColorShape, { label: 'Glow colours', max: 8, help: 'Bioluminescent parts.' }),
  glow: num({ label: 'Glow strength', min: 0, max: 3, step: 0.05, optional: true, default: 1, help: 'How brightly plants and wildlife glow at night.' }),
  density: num({ label: 'Plant density', min: 0, max: 3, step: 0.05, optional: true, default: 1, help: 'Multiplies every region\'s Flora density here.' }),
  size: num({ label: 'Plant size', min: 0.4, max: 2.5, step: 0.05, optional: true, default: 1 }),
  wind: num({ label: 'Wind sway', min: 0, max: 3, step: 0.05, optional: true, default: 1 }),
  wildlife: list(wildRowShape, { label: 'Wildlife', max: 12, help: 'Herds without a species pick from these.' }),
} satisfies Shape;
export type BiomeDef = Infer<typeof biomeShape>;

export const BODY_PLANS = ['hexapod', 'stilt', 'hopper', 'ray', 'crawler', 'shell', 'serpent'] as const;
export const BEHAVIORS = ['herd', 'skittish', 'lumber', 'flyer', 'burrow'] as const;
export type Behavior = (typeof BEHAVIORS)[number];
export const wildlifeShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Notes', multiline: true, optional: true }),
  body: choice(BODY_PLANS, { label: 'Body plan', helps: {
    hexapod: 'Six legs under an oval body, a pointed head.',
    stilt: 'A small body high on four long legs, head on a drooping neck.',
    hopper: 'Round and small, big back legs and long feelers.',
    ray: 'A flat flier with broad wings and a whip tail.',
    crawler: 'Low and segmented, many short legs.',
    shell: 'A domed shell on stubby legs.',
    serpent: 'A long, legless body that winds along.',
  } }),
  behavior: choice(BEHAVIORS, { label: 'Behaviour', helps: {
    herd: 'Wanders as a herd and bolts from anything that comes close.',
    skittish: 'Darts about in short dashes with pauses; flees from far off.',
    lumber: 'Slow and unbothered: stops and stares at what comes close, then plods on.',
    flyer: 'Circles over the herd\'s ground; scatters wider when disturbed.',
    burrow: 'Creeps about and ducks underground when something comes close.',
  } }),
  size: num({ label: 'Size', min: 0.2, max: 6, step: 0.05, help: 'Smallest adult, × the old grazer (about 1.5 u long).' }),
  sizeMax: num({ label: 'Size (largest)', min: 0.2, max: 6, step: 0.05, optional: true, help: 'Empty = all the same size.' }),
  speed: num({ label: 'Walk speed', min: 0, max: 20, step: 0.1, unit: 'u/s', optional: true, default: 2.2 }),
  run: num({ label: 'Run speed', min: 0, max: 30, step: 0.1, unit: 'u/s', optional: true, default: 7.5 }),
  flee: num({ label: 'Wariness', min: 0, max: 60, step: 0.5, unit: 'u', optional: true, default: 14, help: 'Reacts to drones, units and predators this close. 0 = never.' }),
  spread: num({ label: 'Spread', min: 2, max: 80, step: 1, unit: 'u', optional: true, default: 22, help: 'How far from the herd\'s centre each one wanders.' }),
  herdScale: num({ label: 'Herd size ×', min: 0.05, max: 3, step: 0.05, optional: true, default: 1, help: 'Multiplies a herd\'s Grazers count (big beasts come in fewer).' }),
  height: num({ label: 'Flying height', min: 2, max: 40, step: 0.5, unit: 'u', optional: true, default: 10, when: on('behavior', ['flyer'], false) }),
  color: color({ label: 'Colour' }),
  accent: color({ label: 'Accent', help: 'Legs, head, shell markings.' }),
  glow: color({ label: 'Glow', optional: true, help: 'Eyes and spots that light up at night. Empty = none.' }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model to draw instead of the built-in body plan, coloured from its materials named color, accent and glow (others keep their own). Empty = the built-in.' }),
} satisfies Shape;
export type WildlifeDef = Infer<typeof wildlifeShape>;

export interface Collection {
  /** Folder under /content, or a single file for a singleton. */
  path: string;
  /** One record per file (`many`) or exactly one file (`single`). */
  kind: 'many' | 'single';
  shape: Shape;
  label: string;
  /** Which `shape` field is the record's display name. */
  title?: string;
  group: string;
}

/**
 * Colonists' voices (content/voices/<id>.json): what named colonists say when something happens (a short remark in
 * the log and on their card, never more than one every so often), and the second half of their one-line backstory
 * (`on: bio`). A record's filters pick who may say it; the most specific matching records are preferred.
 * In lines: {name} = the speaker's first name, {other} = who it's about (the dead friend, the child, the camp),
 * {building} = the building.
 */
export const VOICE_EVENTS = ['bio', 'decant', 'birth', 'death', 'packBeaten', 'lost', 'brownout', 'hungry', 'strike', 'research', 'contact', 'trust', 'threat', 'held', 'hero', 'heroHeld', 'rescued', 'idle'] as const;
export type VoiceEvent = (typeof VOICE_EVENTS)[number];
const VOICE_HELP: Record<VoiceEvent, string> = {
  bio: 'The second half of a colonist\'s one-line backstory (after their line and where the donors came from).',
  decant: 'Their first words out of the growth pod.',
  birth: 'A parent, when their child is born ({other} = the child).',
  death: 'Someone who loved the dead: a partner, a housemate, a parent or child ({other} = the dead).',
  packBeaten: 'A predator pack beaten off.',
  lost: 'One of our buildings destroyed ({building}).',
  brownout: 'The cryo bank short of power.',
  hungry: 'The colony out of food.',
  strike: 'A striker, when a strike starts.',
  research: 'Research done (a Technician first, if there is one; {other} = the project).',
  contact: 'First contact with an inhabitant camp ({other} = who).',
  trust: 'An inhabitant camp comes to trust us ({other} = who).',
  threat: 'A threat announced on an outlying holding ({other} = the holding).',
  held: 'A holding held through a threat ({other} = the holding).',
  hero: 'Someone inside a building that\'s being torn apart decides to hold it ({building}).',
  heroHeld: 'They held it ({building}).',
  rescued: 'Someone brought in alive after lying injured.',
  idle: 'Now and then, on a quiet day.',
};
export const voiceLineShape = { text: str({ label: 'Line', multiline: true }) } satisfies Shape;
export const voiceShape = {
  on: choice(VOICE_EVENTS, { label: 'When', helps: VOICE_HELP }),
  bloc: choice(['partner', 'autonomist', 'devoted'], { label: 'Only a bloc', optional: true }),
  trait: choice(['optimist', 'anxious', 'stoic', 'diligent', 'independent', 'trusting', 'frail'], { label: 'Only with a trait', optional: true }),
  specialty: choice(SPECIALTIES, { label: 'Only a specialty', optional: true }),
  origin: choice(['pod', 'born'], { label: 'Only pod-grown or born', optional: true }),
  lines: list(voiceLineShape, { label: 'Lines', max: 24, help: 'One is picked at random. {name}, {other}, {building}.' }),
  notes: str({ label: 'Writer\'s notes', multiline: true, optional: true }),
} satisfies Shape;
export type VoiceDef = Infer<typeof voiceShape>;

export const COLLECTIONS = {
  units: { path: 'units', kind: 'many', shape: unitShape, label: 'Units', title: 'name', group: 'Game data' },
  buildings: { path: 'buildings', kind: 'many', shape: buildingShape, label: 'Buildings', title: 'name', group: 'Game data' },
  research: { path: 'research', kind: 'many', shape: researchShape, label: 'Research', title: 'name', group: 'Game data' },
  assets: { path: 'assets', kind: 'many', shape: assetShape, label: 'Assets', title: 'name', group: 'Assets' },
  regions: { path: 'regions', kind: 'many', shape: regionShape, label: 'Regions', title: 'name', group: 'Maps' },
  bodies: { path: 'bodies', kind: 'many', shape: bodyShape, label: 'Worlds', title: 'name', group: 'Maps' },
  biomes: { path: 'biomes', kind: 'many', shape: biomeShape, label: 'Biomes', title: 'name', group: 'Nature' },
  wildlife: { path: 'wildlife', kind: 'many', shape: wildlifeShape, label: 'Wildlife', title: 'name', group: 'Nature' },
  chapters: { path: 'chapters', kind: 'many', shape: chapterShape, label: 'Chapters', title: 'title', group: 'Story' },
  missions: { path: 'missions', kind: 'many', shape: missionShape, label: 'Missions', title: 'title', group: 'Story' },
  story: { path: 'story', kind: 'many', shape: storyShape, label: 'Story events', title: 'title', group: 'Story' },
  inhabitants: { path: 'inhabitants', kind: 'many', shape: inhabitantShape, label: 'Inhabitants', title: 'name', group: 'Story' },
  characters: { path: 'characters', kind: 'many', shape: characterShape, label: 'Characters', title: 'name', group: 'Story' },
  voices: { path: 'voices', kind: 'many', shape: voiceShape, label: 'Colonist voices', title: 'on', group: 'Story' },
  lore: { path: 'lore', kind: 'many', shape: loreShape, label: 'Story bible', title: 'title', group: 'Story' },
  colony: { path: 'rules/colony.json', kind: 'single', shape: colonyRulesShape, label: 'Colony rules', group: 'Rules' },
  threats: { path: 'rules/threats.json', kind: 'single', shape: threatRulesShape, label: 'Threat rules', group: 'Rules' },
  people: { path: 'rules/people.json', kind: 'single', shape: peopleRulesShape, label: 'People rules', group: 'Rules' },
  sound: { path: 'rules/sound.json', kind: 'single', shape: soundRulesShape, label: 'Sound', group: 'Rules' },
  music: { path: 'music', kind: 'many', shape: musicShape, label: 'Music', title: 'name', group: 'Rules' },
  interface: { path: 'rules/interface.json', kind: 'single', shape: interfaceShape, label: 'Interface', group: 'Rules' },
  cinematics: { path: 'cinematics', kind: 'many', shape: cinematicShape, label: 'Cinematics', title: 'title', group: 'Cinematics' },
} satisfies Record<string, Collection>;

export type CollectionName = keyof typeof COLLECTIONS;

/** Map a content-relative file path to its collection and record id. */
export function locate(path: string): { coll: CollectionName; id: string } | null {
  for (const [name, c] of Object.entries(COLLECTIONS) as [CollectionName, Collection][]) {
    if (c.kind === 'single') {
      if (path === c.path) return { coll: name, id: name };
    } else {
      const m = path.match(/^(.*)\/([a-z0-9][a-z0-9_-]*)\.json$/);
      if (m && m[1] === c.path) return { coll: name, id: m[2] };
    }
  }
  return null;
}

/** File path for a record. */
export function pathOf(coll: CollectionName, id: string): string {
  const c: Collection = COLLECTIONS[coll];
  return c.kind === 'single' ? c.path : `${c.path}/${id}.json`;
}

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
