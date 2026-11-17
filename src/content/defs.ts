/**
 * Content collections: what lives under /content and what shape each file has.
 *
 * Add a collection: define its shape here, add it to COLLECTIONS, drop JSON files
 * into content/<dir>/. The editor and the checker pick it up automatically.
 * Only add a field once the game actually reads it, so the editor never shows a
 * knob that does nothing.
 */
import { REGION_HALF } from '../sim/types';
import { bool, choice, color, grid, int, list, num, ref, str, type Infer, type NumField, type RefField, type Shape, type StrField } from './schema';

/** Attack looks: tracer + sound. */
export const WEAPONS = ['bolt', 'cannon', 'shell', 'arc', 'pd', 'bite', 'spit'] as const;
export type Weapon = (typeof WEAPONS)[number];

export const unitShape = {
  name: str({ label: 'Name' }),
  faction: choice(['accord', 'fauna'], { label: 'Faction', help: 'Accord units are the player\'s; fauna attack them.' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  speed: num({ label: 'Speed', min: 0, max: 60, step: 0.1, unit: 'u/s', help: '1 world unit ≈ 10 m.' }),
  range: num({ label: 'Attack range', min: 0, max: 200, step: 0.1, unit: 'u' }),
  damage: num({ label: 'Damage per hit', min: 0, max: 10000 }),
  cooldown: num({ label: 'Attack cooldown', min: 0.05, max: 30, step: 0.05, unit: 's' }),
  splash: num({ label: 'Splash radius', min: 0, max: 50, step: 0.1, unit: 'u', optional: true, help: 'Units inside take half damage.' }),
  minRange: num({ label: 'Minimum range', min: 0, max: 200, step: 0.5, unit: 'u', optional: true, help: 'Can\'t fire at anything closer than this (artillery).' }),
  chain: int({ label: 'Chain jumps', min: 0, max: 12, optional: true, help: 'Each hit arcs on to this many more hostiles, each within Chain range of the last, for 70% of the previous hit.' }),
  chainRange: num({ label: 'Chain range', min: 0, max: 40, step: 0.5, unit: 'u', optional: true }),
  weapon: choice(WEAPONS, { label: 'Weapon look', optional: true, help: 'How its attack looks and sounds. Empty = bolt (cannon if it has splash) for vehicles, bite (spit if Attack range > 4) for fauna.' }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', optional: true, help: 'Accord units: repairs damaged units and buildings within Attack range instead of fighting (costs alloys, like a drone\'s repairs).' }),
  burrows: bool({ label: 'Burrows', optional: true, help: 'Fauna: travels underground to its target, through walls and unseen (radar still shows it), then surfaces to attack.' }),
  packEvery: int({ label: 'Joins packs: every', min: 0, max: 100, optional: true, help: 'Fauna: every Nth attacker in a pack is one of these (0 or empty = only if the threat rules name it).' }),
  packFrom: int({ label: 'Joins packs: from pack', min: 0, max: 200, optional: true, help: 'Fauna: first pack (0 = the first) it can join.' }),
  radius: num({ label: 'Body radius', min: 0.1, max: 20, step: 0.1, unit: 'u', help: 'Collision and selection size.' }),
  aggro: num({ label: 'Aggro radius', min: 0, max: 200, unit: 'u', help: 'How far it notices enemies on its own.' }),
  sight: num({ label: 'Sight', min: 0, max: 240, unit: 'u', optional: true, help: 'How far it sees through the fog of war. Empty = its aggro or attack range (whichever is longer) + 8.' }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys', optional: true, help: 'Accord units with a cost can be produced at a Vehicle Bay (factory role).' }),
  buildSeconds: num({ label: 'Production time', min: 0, max: 600, step: 0.5, unit: 's', optional: true }),
  model: ref('assets', { label: 'Model', optional: true, help: 'A model from the asset library. Empty = the built-in procedural model.' }),
  modelScale: num({ label: 'Model scale', min: 0.1, max: 10, step: 0.05, default: 1, help: 'Gameplay size, on top of the asset\'s own scale.' }),
} satisfies Shape;
export type UnitDef = Infer<typeof unitShape>;

export const BUILDING_ROLES = ['core', 'solar', 'depot', 'battery', 'turret', 'radar', 'factory', 'wall', 'gate', 'repair', 'geothermal', 'civic', 'farm'] as const;
export type BuildingRole = (typeof BUILDING_ROLES)[number];

export const buildingShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  role: choice(BUILDING_ROLES, {
    label: 'Role',
    help: 'What it does. core: the landed pod (build radius = Range). solar: power that follows daylight. depot: mines the nearest deposit within Range. battery: stores power. turret: shoots hostiles within Range. radar: early warning + minimap. factory: produces combat units (units with a cost). wall: placed as a line of segments (Clearance = segment length); doesn\'t extend the build area. gate: a wall segment your units drive through (Clearance = its length); dropped onto a wall it replaces the segments under it. repair: heals combat units within Range while powered. geothermal: steady power, only on a vent (within Range of one). civic: houses colonists and runs growth pods (Civilian Processing Center). farm: grows biomass (Hydroponics).',
  }),
  buildable: bool({ label: 'In build menu', default: true }),
  cost: int({ label: 'Cost', min: 0, max: 100000, unit: 'alloys' }),
  hp: int({ label: 'Hit points', min: 1, max: 100000 }),
  powerMW: num({ label: 'Power', min: -100, max: 100, step: 0.1, unit: 'MW', help: 'Positive generates (solar: at noon), negative draws.' }),
  buildSeconds: num({ label: 'Build time', min: 0, max: 600, step: 0.5, unit: 's' }),
  clearance: num({ label: 'Clearance', min: 0, max: 60, step: 0.5, unit: 'u', help: 'Nothing new may be placed closer than this. Half of it is the building\'s body radius.' }),
  range: num({ label: 'Range', min: 0, max: 400, unit: 'u', optional: true, help: 'core: build radius · depot: how far it reaches for a deposit · repair: how far it reaches to units · geothermal: how close to a vent it must be.' }),
  fireRange: num({ label: 'Firing range', min: 0, max: 400, unit: 'u', optional: true, help: 'Any building with a firing range, damage and cooldown shoots hostiles while powered (turrets; the Core\'s point defense).' }),
  damage: num({ label: 'Damage per shot', min: 0, max: 10000, optional: true }),
  cooldown: num({ label: 'Fire cooldown', min: 0.05, max: 30, step: 0.05, unit: 's', optional: true }),
  splash: num({ label: 'Splash radius', min: 0, max: 50, step: 0.1, unit: 'u', optional: true, help: 'Shooters: hostiles this close to the target take half damage.' }),
  minRange: num({ label: 'Minimum range', min: 0, max: 200, step: 0.5, unit: 'u', optional: true, help: 'Shooters: can\'t fire at anything closer than this.' }),
  weapon: choice(WEAPONS, { label: 'Weapon look', optional: true, help: 'How its shots look and sound. Empty = cannon (shell if it has splash).' }),
  repairRate: num({ label: 'Repair rate', min: 0, max: 1000, unit: 'hp/s', optional: true, help: 'Repair pads: hit points per second for each unit in Range, while powered.' }),
  mineRate: num({ label: 'Mining rate', min: 0, max: 100, step: 0.05, unit: 'alloys/s', optional: true, help: 'Depots, while powered.' }),
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
  spit: { label: 'Spitter glob', cat: 'combat' },
  emerge: { label: 'Burrower surfacing', cat: 'combat' },
  repair: { label: 'Repair beam', cat: 'combat' },
  bite: { label: 'Predator bite', cat: 'combat' },
  deathSmall: { label: 'Small death', cat: 'combat' },
  deathBig: { label: 'Big death', cat: 'combat' },
  placed: { label: 'Building placed', cat: 'events' },
  online: { label: 'Building online', cat: 'events' },
  unitReady: { label: 'Unit ready', cat: 'events' },
  droneReady: { label: 'Drone fabricated', cat: 'events' },
  packCleared: { label: 'Pack destroyed', cat: 'events' },
  lost: { label: 'Drone / unit lost', cat: 'events' },
  warning: { label: 'Warning', cat: 'alerts' },
  alarm: { label: 'Alarm', cat: 'alerts' },
  tap: { label: 'UI tap', cat: 'ui' },
  deny: { label: 'UI refused', cat: 'ui' },
  wind: { label: 'Wind (loop)', cat: 'ambient' },
} as const;
export type SoundId = keyof typeof SOUNDS;
export const SOUND_CATS = ['combat', 'events', 'alerts', 'ui', 'ambient'] as const;
export type SoundCat = (typeof SOUND_CATS)[number];

const vol = (label: string, help?: string) => num({ label, min: 0, max: 1, step: 0.05, help });
const soundFile = (id: SoundId) => ref('assets', {
  label: `${SOUNDS[id].label} · file`, optional: true, assetKind: 'audio',
  help: `An audio asset to play instead of the built-in synthesised ${SOUNDS[id].label.toLowerCase()}.${id === 'wind' ? ' Loops; pitch and filter still follow day and night.' : ''}`,
});
export const soundRulesShape = {
  master: vol('Master volume', 'Multiplies everything. Players set their own volume in the ⋯ menu on top of this.'),
  combat: vol('Combat', 'Shots, bites, deaths. Quieter with distance from the camera.'),
  events: vol('Events', 'Placed, online, unit ready, drone fabricated, pack destroyed, losses.'),
  alerts: vol('Alerts', 'Predator warnings and alarms (cryo integrity, buildings destroyed).'),
  ui: vol('Interface', 'Button taps, refused orders.'),
  ambient: vol('Ambient', 'The wind bed.'),
  ...(Object.fromEntries((Object.keys(SOUNDS) as SoundId[]).map((id) => [id, soundFile(id)])) as { [K in SoundId]: ReturnType<typeof soundFile> }),
} satisfies Shape;
export type SoundRules = Infer<typeof soundRulesShape>;

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
} satisfies Shape;
export type AssetDef = Infer<typeof assetShape>;

/**
 * An inhabitant group (STORY.md §5): remnants of earlier runs living in camps a
 * region map places. Neutral; their regard for the colony rises and falls with
 * how you treat them and their land.
 */
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
} satisfies Shape;
export type InhabitantDef = Infer<typeof inhabitantShape>;

/**
 * Conditions: what starts a story event (its trigger) and what completes a
 * mission objective. One evaluator (src/sim/conditions.ts) serves both.
 */
export const CONDITIONS = ['start', 'time', 'built', 'colonists', 'pod', 'firstAge', 'acceptance', 'distrust', 'units', 'drones', 'packs', 'site', 'contact', 'trust', 'flag', 'after', 'mission', 'never'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Read as "… when <help>" / "Fires <help>". */
export const CONDITION_HELP: Record<Condition, string> = {
  start: 'when the colony deploys',
  time: 'when the clock reaches Sol',
  built: 'when Count (default 1) finished buildings of that kind stand',
  colonists: 'when the colony has Count colonists (children too)',
  pod: 'when a growth pod is running (or someone has come out of one)',
  firstAge: 'when the first colonist out of a pod is Count years old (1 sol = 1 year; they come out at the People rules\' age)',
  acceptance: 'when the adults\' average acceptance of the AI reaches Count (0–100)',
  distrust: 'when the adults\' average acceptance of the AI falls to Count or below (0–100)',
  units: 'when the colony has Count combat units',
  drones: 'when the colony has Count worker drones',
  packs: 'when Count predator packs have been destroyed',
  site: 'when a drone or combat unit reaches the Site (a story site on the region map)',
  contact: 'at first contact with a camp of the Group',
  trust: 'when a camp of the Group trusts you',
  flag: 'when the Flag is set (by an event or mission)',
  after: 'when the Event has been answered (its card closed)',
  mission: 'when the Mission is complete',
  never: 'only when another event starts it',
};

export const STORY_EFFECTS = ['log', 'alloys', 'biomass', 'stance', 'wellbeing', 'regard', 'flag', 'unflag', 'event', 'pack'] as const;
export type StoryEffect = (typeof STORY_EFFECTS)[number];
export const EFFECT_HELP: Record<StoryEffect, string> = {
  log: 'a line in the log (Text)',
  alloys: 'add Amount alloys (negative takes)',
  biomass: 'add Amount biomass',
  stance: 'shift every colonist\'s AI acceptance by Amount',
  wellbeing: 'shift every colonist\'s wellbeing by Amount',
  regard: 'change the Group\'s regard by Amount',
  flag: 'set the Flag (other events can wait for it or be blocked by it)',
  unflag: 'clear the Flag',
  event: 'start the Event now, whatever its trigger',
  pack: 'the next predator pack attacks now',
};
const on = (field: string, is: readonly string[], need = true) => ({ field, is, need });

/** A condition's kind field plus its parameters, each shown only for the kinds that use it. */
const conditionFields = <K extends string>(kindKey: K, label: string) => ({
  [kindKey]: choice(CONDITIONS, { label, helps: CONDITION_HELP }),
  sol: num({ label: 'Sol', min: 1, max: 1000, step: 0.05, optional: true, help: 'Sol 1 is the landing day; 2.5 = midday of sol 2.', when: on(kindKey, ['time']) }),
  building: ref('buildings', { label: 'Building', optional: true, when: on(kindKey, ['built']) }),
  count: int({ label: 'Count', min: 0, max: 10000, optional: true, help: 'Empty = 1.', when: on(kindKey, ['built', 'colonists', 'units', 'drones', 'packs', 'firstAge', 'acceptance', 'distrust'], false) }),
  site: str({ label: 'Site', optional: true, help: 'A story site id on the region map.', when: on(kindKey, ['site']) }),
  group: ref('inhabitants', { label: 'Group', optional: true, when: on(kindKey, ['contact', 'trust']) }),
  flag: str({ label: 'Flag', optional: true, when: on(kindKey, ['flag']) }),
  event: ref('story', { label: 'Event', optional: true, when: on(kindKey, ['after']) }),
  mission: ref('missions', { label: 'Mission', optional: true, when: on(kindKey, ['mission']) }),
}) as { [P in K]: ReturnType<typeof choice<Condition, { label: string; helps: typeof CONDITION_HELP }>> } & {
  sol: NumField & { optional: true }; building: RefField & { optional: true }; count: NumField & { optional: true };
  site: StrField & { optional: true }; group: RefField & { optional: true }; flag: StrField & { optional: true };
  event: RefField & { optional: true }; mission: RefField & { optional: true };
};
/** The parameters a condition reads. */
export interface ConditionDef { sol?: number; building?: string; count?: number; site?: string; group?: string; flag?: string; event?: string; mission?: string }

const effectFields = {
  kind: choice(STORY_EFFECTS, { label: 'Effect', helps: EFFECT_HELP }),
  amount: num({ label: 'Amount', min: -10000, max: 10000, optional: true, when: on('kind', ['alloys', 'biomass', 'stance', 'wellbeing', 'regard']) }),
  group: ref('inhabitants', { label: 'Group', optional: true, when: on('kind', ['regard']) }),
  flag: str({ label: 'Flag', optional: true, when: on('kind', ['flag', 'unflag']) }),
  event: ref('story', { label: 'Event', optional: true, when: on('kind', ['event']) }),
  text: str({ label: 'Text', multiline: true, optional: true, when: on('kind', ['log']) }),
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
export const characterShape = {
  name: str({ label: 'Name', help: 'Shown above what they say. {first} = the first colonist out of a pod (their name).' }),
  role: str({ label: 'Role', optional: true, help: 'Under the name, smaller ("Sol Mission Control").' }),
  color: color({ label: 'Colour', default: '#5ff3ff', help: 'Their name, and the edge of their cards.' }),
  portrait: ref('assets', { label: 'Portrait', optional: true, assetKind: 'image', help: 'An image from the asset library (Assets), shown beside their lines.' }),
  description: str({ label: 'Who they are', multiline: true, optional: true, help: 'For writers (the game doesn\'t show it): voice, history, what they want.' }),
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
  ...conditionFields('trigger', 'Trigger'),
  delay: num({ label: 'Delay', min: 0, max: 3600, unit: 's', optional: true, help: 'Wait this long after the trigger before firing.' }),
  region: ref('regions', { label: 'Only in region', optional: true, help: 'Empty = any region.' }),
  unless: str({ label: 'Unless flag', optional: true, help: 'Doesn\'t fire if this flag is set.' }),
  pause: bool({ label: 'Pause the game', optional: true, help: 'Pauses while the card is open (tutorials, big moments).' }),
  choices: list(storyChoiceShape, { label: 'Choices', max: 4, optional: true, help: 'None = a single Continue button.' }),
  effects: list(storyEffectShape, { label: 'Effects', max: 16, optional: true }),
} satisfies Shape;
export type StoryDef = Infer<typeof storyShape>;

export const objectiveShape = {
  text: str({ label: 'Text', help: 'What the GOALS panel says ("Build a Solar Array").' }),
  ...conditionFields('kind', 'Done'),
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
} satisfies Shape;
export type MissionDef = Infer<typeof missionShape>;

/** Region paint grids: one sample every REGION_STEP units across the whole region. */
export const REGION_STEP = 2;
export const REGION_CELLS = (REGION_HALF * 2) / REGION_STEP + 1; // 121
/** Height grid values are tenths of a world unit. */
export const HEIGHT_SCALE = 0.1;

export const herdShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  grazers: int({ label: 'Grazers', min: 0, max: 400 }),
  roam: num({ label: 'Roam radius', min: 0, max: 240, unit: 'u', help: 'How far the herd may wander from here. 0 = stays put.' }),
} satisfies Shape;
export type HerdDef = Infer<typeof herdShape>;

export const depositShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  alloys: int({ label: 'Alloys', min: 1, max: 1000000 }),
} satisfies Shape;
export type DepositDef = Infer<typeof depositShape>;

export const ventShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
} satisfies Shape;
export type VentDef = Infer<typeof ventShape>;

export const spawnShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
} satisfies Shape;
export type SpawnDef = Infer<typeof spawnShape>;

export const siteShape = {
  id: str({ label: 'Id', help: 'Story events name the site by this (a "Reach a site" trigger). Lowercase, no spaces.' }),
  label: str({ label: 'Label', optional: true, help: 'For the editor only.' }),
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  r: num({ label: 'Radius', min: 2, max: 120, step: 0.5, unit: 'u', default: 10, help: 'A drone or combat unit this close has reached it.' }),
} satisfies Shape;
export type SiteDef = Infer<typeof siteShape>;

export const campShape = {
  x: num({ label: 'X', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  z: num({ label: 'Z', min: -REGION_HALF, max: REGION_HALF, step: 0.5, unit: 'u' }),
  group: ref('inhabitants', { label: 'Who lives here', help: 'An inhabitant group (Story → Inhabitants).' }),
  yaw: num({ label: 'Facing', min: -180, max: 180, step: 5, unit: '°', optional: true, help: 'Turns the whole camp.' }),
} satisfies Shape;
export type CampDef = Infer<typeof campShape>;

export const regionShape = {
  name: str({ label: 'Name' }),
  description: str({ label: 'Description', multiline: true, optional: true }),
  floraSeed: int({ label: 'Flora seed', min: 1, max: 999999, help: 'Picks the plant species. ?flora=<seed> in the URL overrides it.' }),
  floraDensity: num({ label: 'Flora density', min: 0, max: 3, step: 0.05, default: 1, help: 'Multiplies the number of plants everywhere.' }),
  siteLat: num({ label: 'Site: degrees north', min: -80, max: 80, step: 1, unit: '°', optional: true, help: 'Where on the planet the region sits, from Touchdown. Moving it changes the generated ground under your sculpting (0, 0 = Touchdown\'s spot).' }),
  siteLon: num({ label: 'Site: degrees east', min: -180, max: 180, step: 1, unit: '°', optional: true, help: 'Degrees east of Touchdown.' }),
  packScale: num({ label: 'Pack size ×', min: 0, max: 5, step: 0.05, optional: true, help: 'Multiplies every predator pack here (and the largest pack). Empty = 1, as the threat rules say.' }),
  graceSeconds: num({ label: 'Grace period', min: 0, max: 7200, unit: 's', optional: true, help: 'No attacks before this. Empty = the threat rules\' grace period.' }),
  waveInterval: num({ label: 'Time between packs', min: 10, max: 3600, unit: 's', optional: true, help: 'Empty = the threat rules\' interval.' }),
  startAlloys: int({ label: 'Starting alloys', min: 0, max: 100000, optional: true, help: 'Empty = the colony rules\' starting alloys.' }),
  height: grid(REGION_CELLS, REGION_CELLS, -600, 600, { label: 'Height sculpt', optional: true, help: 'Added to the generated terrain, in tenths of a unit.' }),
  flora: grid(REGION_CELLS, REGION_CELLS, -100, 100, { label: 'Flora paint', optional: true, help: '−100 clears plants, +100 doubles them and makes the ground lush.' }),
  herds: list(herdShape, { label: 'Grazer herds', max: 60 }),
  deposits: list(depositShape, { label: 'Alloy deposits', max: 60 }),
  spawns: list(spawnShape, { label: 'Predator spawns', max: 20 }),
  vents: list(ventShape, { label: 'Geothermal vents', max: 20, optional: true }),
  camps: list(campShape, { label: 'Inhabitant camps', max: 8, optional: true }),
  sites: list(siteShape, { label: 'Story sites', max: 40, optional: true }),
} satisfies Shape;
export type RegionDef = Infer<typeof regionShape>;
/**
 * The landing cinematic (src/landing.ts): when each beat happens, where the
 * camera is, and the captions. Everything else about the landing (the probe's
 * path, the petals, the dust) follows the beats.
 */
const beat = (label: string, help: string) => num({ label, min: 0, max: 120, step: 0.1, unit: 's', help });
export const cameraKeyShape = {
  at: num({ label: 'At', min: 0, max: 120, step: 0.05, unit: 's' }),
  target: choice(['probe', 'site'], { label: 'Looks at', helps: { probe: 'The probe as it comes down (Lift above it).', site: 'A point on the ground: X, Z and Lift (region units; the Core is at 0, 0).' } }),
  x: num({ label: 'X', min: -120, max: 120, step: 0.5, unit: 'u', optional: true, when: on('target', ['site'], false) }),
  z: num({ label: 'Z', min: -120, max: 120, step: 0.5, unit: 'u', optional: true, when: on('target', ['site'], false) }),
  lift: num({ label: 'Lift', min: -20, max: 200, step: 0.5, unit: 'u', default: 0 }),
  dist: num({ label: 'Distance', min: 5, max: 3000, step: 0.5, unit: 'u', help: 'From what it looks at.' }),
  follow: num({ label: 'Pull back with height', min: 0, max: 5, step: 0.05, optional: true, when: on('target', ['probe'], false), help: 'Extra distance for each unit of the probe\'s altitude (so the chase widens high up).' }),
  pitch: num({ label: 'Pitch', min: -1.5, max: 1.5, step: 0.01, unit: 'rad', help: '0 = level, higher = looking down from above.' }),
  yaw: num({ label: 'Yaw', min: -6.3, max: 6.3, step: 0.01, unit: 'rad', help: 'Round the target; 0 = from the south.' }),
} satisfies Shape;
export type CameraKeyDef = Infer<typeof cameraKeyShape>;
export const captionShape = {
  at: num({ label: 'At', min: 0, max: 120, step: 0.05, unit: 's' }),
  title: str({ label: 'Title' }),
  sub: str({ label: 'Line', optional: true, help: '{alt} = altitude (km), {speed} = speed (m/s), {shield} = heat-shield temperature (°C).' }),
} satisfies Shape;
export const landingShape = {
  burn: beat('Retro burn', 'The thrusters light.'),
  touchdown: beat('Touchdown', 'The probe lands (the dust burst, the drone stage starts).'),
  open: beat('Shell opens', 'The petals start to fold out.'),
  power: beat('Core power', 'The Core\'s lights come up.'),
  dissolve: beat('Reclaim starts', 'The petals start dissolving.'),
  reclaimed: beat('Reclaimed', 'The shell is gone.'),
  hatch: beat('Bay opens', 'The drone bay hatch opens.'),
  drone: beat('Drone out', 'The worker drone appears in the bay.'),
  post: beat('Drone at post', 'The drone reaches its post; the colony deploys.'),
  end: beat('End', 'The cinematic hands over to the normal view.'),
  camera: list(cameraKeyShape, { label: 'Camera keys', max: 60, help: 'The camera passes smoothly through each key in time order. The last should match the normal view (looking at 0, −8 from 75 u, pitch 0.85, yaw 0.4) so the hand-over doesn\'t jump.' }),
  captions: list(captionShape, { label: 'Captions', max: 40, help: 'Each shows from its time until the next.' }),
} satisfies Shape;
export type LandingDef = Infer<typeof landingShape>;
export const BEATS = ['burn', 'touchdown', 'open', 'power', 'dissolve', 'reclaimed', 'hatch', 'drone', 'post', 'end'] as const;

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

export const COLLECTIONS = {
  units: { path: 'units', kind: 'many', shape: unitShape, label: 'Units', title: 'name', group: 'Game data' },
  buildings: { path: 'buildings', kind: 'many', shape: buildingShape, label: 'Buildings', title: 'name', group: 'Game data' },
  assets: { path: 'assets', kind: 'many', shape: assetShape, label: 'Assets', title: 'name', group: 'Assets' },
  regions: { path: 'regions', kind: 'many', shape: regionShape, label: 'Regions', title: 'name', group: 'Maps' },
  missions: { path: 'missions', kind: 'many', shape: missionShape, label: 'Missions', title: 'title', group: 'Story' },
  story: { path: 'story', kind: 'many', shape: storyShape, label: 'Story events', title: 'title', group: 'Story' },
  inhabitants: { path: 'inhabitants', kind: 'many', shape: inhabitantShape, label: 'Inhabitants', title: 'name', group: 'Story' },
  characters: { path: 'characters', kind: 'many', shape: characterShape, label: 'Characters', title: 'name', group: 'Story' },
  colony: { path: 'rules/colony.json', kind: 'single', shape: colonyRulesShape, label: 'Colony rules', group: 'Rules' },
  threats: { path: 'rules/threats.json', kind: 'single', shape: threatRulesShape, label: 'Threat rules', group: 'Rules' },
  people: { path: 'rules/people.json', kind: 'single', shape: peopleRulesShape, label: 'People rules', group: 'Rules' },
  sound: { path: 'rules/sound.json', kind: 'single', shape: soundRulesShape, label: 'Sound', group: 'Rules' },
  landing: { path: 'rules/landing.json', kind: 'single', shape: landingShape, label: 'Landing', group: 'Cinematics' },
  interface: { path: 'rules/interface.json', kind: 'single', shape: interfaceShape, label: 'Interface', group: 'Rules' },
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
