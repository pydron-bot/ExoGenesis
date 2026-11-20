/**
 * Data contract for the people system (src/sim/people.ts): colonists, the cryo
 * bank's embryos, growth pods, food, mood and Trust. Plain data, like SimState.
 *
 * Two meters per colonist:
 *   - wellbeing (0..100): how their life is going (food, housing, safety, work,
 *     grief, whether colony policy suits their politics);
 *   - stance (0..100): how far they accept the AI. Blocs come from it:
 *     Autonomists < 35 ≤ Partners ≤ 75 < Devoted.
 */
import type { Specialty } from '../content/defs';
import type { Trait } from './names';

export type Bloc = 'autonomist' | 'partner' | 'devoted';
export const BLOCS: Bloc[] = ['partner', 'autonomist', 'devoted'];
export const AUTONOMIST_BELOW = 35;
export const DEVOTED_ABOVE = 75;
export const blocOf = (stance: number): Bloc => (stance < AUTONOMIST_BELOW ? 'autonomist' : stance > DEVOTED_ABOVE ? 'devoted' : 'partner');

/** What the AI imprints in a growth pod: skills, loyalty, and which history of Earth they learn. */
export const CURRICULA = {
  charter: { name: 'Charter', stance: 58, help: 'The Accord charter: humans and the AI as partners. An honest, careful history of Earth.' },
  heritage: { name: 'Heritage', stance: 24, help: 'Human history, art and self-reliance. Skilled and proud; wary of the AI.' },
  unity: { name: 'Guardian', stance: 88, help: 'The AI as guardian and future. Tireless workers who see little need for families.' },
} as const;
export type Curriculum = keyof typeof CURRICULA;

export const POLICIES = {
  hours: {
    name: 'Work hours',
    options: { short: 'Short (08–16)', standard: 'Standard (07–18)', long: 'Long (06–21)' },
    help: 'Longer shifts: more output, less happiness. The Devoted mind least.',
  },
  rations: {
    name: 'Rations',
    options: { lean: 'Lean', normal: 'Normal', generous: 'Generous' },
    help: 'Lean saves a quarter of the food; generous costs 40% more and makes people happier.',
  },
  oversight: {
    name: 'Oversight',
    options: { light: 'Light', standard: 'Standard', total: 'Total' },
    help: 'How closely the AI watches the colony. Total stops sabotage, and Autonomists hate it. Light is the reverse.',
  },
  council: {
    name: 'Council',
    options: { directive: 'AI directive', joint: 'Joint council', assembly: 'Human assembly' },
    help: 'Who decides. Each bloc wants its own answer, and the choice pulls opinion of the AI up or down.',
  },
} as const;
export type PolicyKey = keyof typeof POLICIES;
export type Policies = { [K in PolicyKey]: keyof (typeof POLICIES)[K]['options'] };

export interface Colonist {
  id: number;
  name: string;
  /** Index into the lineage list. */
  lineage: number;
  /** Game seconds at which they were (virtually) age 0; age = (secs − born) / sol. */
  born: number;
  /** Null for children (they pick one at adulthood). */
  specialty: Specialty | null;
  traits: Trait[];
  origin: 'pod' | 'born';
  imprint?: Curriculum;
  /** Wellbeing 0..100 (happiness). */
  wb: number;
  /** Stance 0..100 (acceptance of the AI). */
  stance: number;
  hp: number;
  /** Building they live in / work at (-1 none). */
  home: number;
  job: number;
  /** Inside this building (-1 = outdoors, visible). */
  at: number;
  /** Building they're heading for (-1 none) and their walking path. */
  goal: number;
  path?: number[];
  x: number;
  z: number;
  heading: number;
  /** Partner's colonist id (-1 none). */
  partner: number;
  /** Lying injured by the ruins of their building: seconds until they die, unless a medevac comes. */
  down?: number;
  /** Aboard this medevac (unit id); `at` is AT_RIDE meanwhile. */
  ride?: number;
  /** Not working: too unhappy. */
  strike?: boolean;
  /** Parents' ids (born colonists). */
  parents?: [number, number];
  /** One line about who they are (made when they arrive; older saves get one on load). */
  bio?: string;
  /** What they did that the colony remembers ("Held the Mining Depot, Sol 6"). */
  deeds?: string[];
  /** Their own grief for someone they loved (wellbeing points, fading). */
  sorrow?: number;
  /** Holding a building under attack (its id) until this game second. */
  hero?: { b: number; until: number };
}

/** `Colonist.at` while aboard a medevac (-1 is outdoors, a building id is indoors). */
export const AT_RIDE = -2;

export interface Pod {
  /** Civic building id. */
  b: number;
  lineage: number;
  specialty: Specialty;
  curriculum: Curriculum;
  /** 0..1 */
  progress: number;
  /** Seconds without power or biomass. */
  dark: number;
}

export interface Memorial {
  name: string;
  lineage: number;
  age: number;
  /** How they were lost ('predators', 'starvation', 'old age', 'pod failure', 'left'...). */
  cause: string;
  /** Who mourned them (names). */
  by?: string;
  /** Game seconds. */
  at: number;
}

export interface PeopleState {
  /** Embryos left per lineage. */
  bank: number[];
  /** Fractional embryo loss carried between ticks. */
  lossAcc: number;
  biomass: number;
  colonists: Colonist[];
  pods: Pod[];
  policies: Policies;
  memorial: Memorial[];
  /** Colony-wide grief (wellbeing points, decays) and fear (attack near people, decays). */
  grief: number;
  fear: number;
  /** Seconds the colony has been out of food. */
  hungry: number;
  /** Breakthrough meter (0..1 fills while Trust is high), and seconds of surge left. */
  breakthrough: number;
  surge: number;
  /** Seconds the colony has been on the brink of a walkout. */
  unrest: number;
  /** The bloc leading the colony (its boost is on), if any. */
  lead?: Bloc | null;
  /** Lineages already announced as gone. */
  gone: number[];
  /** The first colonist out of a pod (story cards call them {first}); kept after they die. */
  first?: { id: number; name: string };
  /** What colonists have said lately (newest last), and when the last remark was (game seconds, per kind too). */
  voices?: { id: number; name: string; text: string; at: number; on: string }[];
  said?: Record<string, number>;
  /** Buildings a hero held lately (building id → game second): one hero per building per fight. */
  heroCd?: Record<number, number>;
  /** A line promised the next growth pod (a story choice); used once. */
  favour?: number;
  /** Totals for the end screen. */
  grown: number;
  births: number;
  departed: number;
}

export interface ColonistSnap {
  id: number; name: string; lineage: string; age: number; specialty: Specialty | null; traits: Trait[];
  origin: 'pod' | 'born'; imprint?: Curriculum; wb: number; stance: number; bloc: Bloc; hp: number;
  home: string | null; job: string | null; doing: string; strike: boolean; partner: string | null;
  /** Where they are (a building's centre when indoors). */
  x: number; z: number; outdoors: boolean;
  /** Building ids: job, and where they are (-1 outdoors). */
  jobId: number; atId: number;
  /** Why their wellbeing is what it is (biggest effects first). */
  why: [string, number][];
  bio?: string;
  deeds: string[];
  /** The last thing they said (if lately), and whether they're mourning someone, or holding a building now. */
  said?: string;
  mourning: boolean;
  hero: boolean;
}

export interface PeopleSnap {
  embryos: number;
  /** Lineages with anyone left (embryos or colonists) / the starting number. */
  lineagesLeft: number;
  lineages: number;
  /** Genetic diversity 0..100. */
  diversity: number;
  biomass: number;
  biomassMax: number;
  /** Biomass per second: produced, eaten (colonists + pods). */
  food: { made: number; eaten: number };
  adults: number;
  children: number;
  housing: number;
  /** Average wellbeing and stance of adults (0..100), and bloc head-counts. */
  wellbeing: number;
  stance: number;
  blocs: Record<Bloc, number>;
  /** The leading bloc, whose boost is on. */
  lead: Bloc | null;
  striking: number;
  policies: Policies;
  breakthrough: number;
  surge: number;
  /** Growth pods per civic building. */
  pods: { b: number; slots: number; running: { specialty: Specialty; curriculum: Curriculum; lineage: string; progress: number; dark: number }[] }[];
  roster: ColonistSnap[];
  /** What colonists have said lately, newest first: name, words, game seconds. */
  voices: { id: number; name: string; text: string; at: number }[];
  memorial: (Omit<Memorial, 'lineage'> & { lineage: string })[];
  /** Embryos per lineage name (for the cryo bank view). */
  bank: { name: string; embryos: number; living: number }[];
  /** Outdoor colonists to draw: id, x, z, heading, bloc (0 partner, 1 autonomist, 2 devoted), flags (1 child, 2 lying injured). */
  walkers: Float32Array;
  /** Each powered Med Bay with injured people in its Range: how far along the next stretcher is (0..1) and how many wait. */
  care: { b: number; progress: number; waiting: number }[];
  stats: { grown: number; births: number; deaths: number; departed: number };
}

export type PeopleCommand =
  /** Start a growth pod at a civic building (lineage: -1 = the rarest surviving line). */
  | { type: 'grow'; id: number; specialty: Specialty; curriculum: Curriculum; lineage?: number }
  /** Stop the newest pod at a building (the embryo goes back to the bank if it's still early). */
  | { type: 'unpod'; id: number }
  | { type: 'policy'; key: PolicyKey; value: string };
