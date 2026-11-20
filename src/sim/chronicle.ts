/**
 * The Chronicle's record (DESIGN §5.10 C): what the campaign already tracks, kept over time so a colony
 * history can be told at the end (src/chronicle.ts draws it). Everyone who ever lived (from the colonists
 * list: who appeared, who is gone and how, from the memorial), the blocs and population sampled every
 * 30 s, and the key moments (story-worthy events as the log reports them, missions, story events, a
 * change of the leading bloc, walkouts). Plain data in `SimState.chronicle`, so it saves with the game.
 * Campaign only; read by diffing once a second, so the people system needs no hooks.
 */
import { content } from '../content';
import { blocOf, type Bloc } from './people-types';
import type { EventCue, SimState } from './types';

export interface ChroniclePerson {
  id: number;
  name: string;
  /** Lineage index (names: src/sim/names.ts lineName). */
  line: number;
  origin: 'pod' | 'born';
  imprint?: string;
  /** Game seconds of virtual birth (age 0), as on the colonist. */
  born: number;
  /** Game seconds they first appeared (out of the pod, or born). */
  from: number;
  parents?: [number, number];
  partner?: number;
  /** How they left the story: died (with the memorial's cause) or left the colony (walked out). */
  end?: { at: number; how: 'died' | 'left'; cause?: string; age?: number };
}
export interface ChronicleEvent { at: number; text: string; kind: 'mission' | 'story' | 'birth' | 'death' | 'people' | 'contact' | 'lead' | 'walkout' | 'milestone' | 'end' }
/** [secs, partners, autonomists, devoted, children, embryos] */
export type ChronicleSample = [number, number, number, number, number, number];
export interface Chronicle {
  people: ChroniclePerson[];
  samples: ChronicleSample[];
  events: ChronicleEvent[];
  /** What was already seen (to tell what's new). */
  seen: { missions: number; fired: number; lead: Bloc | null; departed: number; firstPack?: boolean };
}

const SAMPLE_EVERY = 30;
const MAX_SAMPLES = 480;
const MAX_EVENTS = 600;

export const BLOC_NAMES: Record<Bloc, string> = { partner: 'Partners', autonomist: 'Autonomists', devoted: 'Devoted' };

const fresh = (): Chronicle => ({ people: [], samples: [], events: [], seen: { missions: 0, fired: 0, lead: null, departed: 0 } });

function push(ch: Chronicle, e: ChronicleEvent) {
  ch.events.push(e);
  // over the cap: drop the oldest everyday line (partnerships, comings of age), else the oldest
  if (ch.events.length > MAX_EVENTS) {
    const i = ch.events.findIndex((x) => x.kind === 'people');
    ch.events.splice(i >= 0 ? i : 0, 1);
  }
}

/** A log line from the sim (player 0's), kept if it's part of the colony's story. */
export function chronicleEvent(s: SimState, secs: number, text: string, cue?: EventCue) {
  if (s.players || !s.people || !cue) return;
  const ch = (s.chronicle ??= fresh());
  const kind: ChronicleEvent['kind'] | null =
    cue === 'birth' ? 'birth'
      : cue === 'death' ? 'death'
        : cue === 'friend' ? 'people'
          : cue === 'discovery' ? 'contact'
            : cue === 'research' && /complete/i.test(text) ? 'milestone'
              : cue === 'victory' || cue === 'defeat' ? 'end'
                : cue === 'missionFail' ? 'mission'
                  // packs: only the first; nests, relic grids and Breakthroughs always
                  : cue === 'packCleared' && (!/^Pack from/.test(text) || !ch.seen.firstPack) ? 'milestone'
                    : null;
  if (!kind) return;
  if (cue === 'packCleared' && /^Pack from/.test(text)) { ch.seen.firstPack = true; text = `First pack beaten: ${text.replace(/ \(\d+ so far\)/, '')}`; }
  push(ch, { at: secs, text, kind });
}

/** Once a second in the campaign: who's new, who's gone, the blocs, missions and story beats. */
export function recordChronicle(s: SimState, secs: number) {
  const P = s.people;
  if (s.players || !P) return;
  const ch = (s.chronicle ??= fresh());
  const sol = content.colony.solSeconds, adult = content.people.adultAge;
  const known = new Map(ch.people.map((p) => [p.id, p]));
  const living = new Set<number>();
  for (const c of P.colonists) {
    living.add(c.id);
    let p = known.get(c.id);
    if (!p) {
      p = { id: c.id, name: c.name, line: c.lineage, origin: c.origin, imprint: c.imprint, born: c.born, from: secs, parents: c.parents };
      ch.people.push(p);
    }
    if (c.partner >= 0) p.partner = c.partner;
  }
  for (const p of ch.people) {
    if (p.end || living.has(p.id)) continue;
    const m = [...P.memorial].reverse().find((x) => x.name === p.name);
    p.end = m && m.at >= secs - 5 ? { at: m.at, how: /left to found|walked out/.test(m.cause) ? 'left' : 'died', cause: m.cause, age: m.age } : { at: secs, how: 'left', age: Math.floor((secs - p.born) / sol) };
  }
  // walkouts
  if (P.departed > ch.seen.departed) {
    const n = P.departed - ch.seen.departed;
    push(ch, { at: secs, text: `${n} Autonomist${n > 1 ? 's' : ''} walked out to found a settlement of their own`, kind: 'walkout' });
    ch.seen.departed = P.departed;
  }
  // the leading bloc
  const lead = P.lead ?? null;
  if (lead !== ch.seen.lead) {
    push(ch, { at: secs, text: lead ? `The ${BLOC_NAMES[lead]} lead the colony` : `No bloc leads the colony any more`, kind: 'lead' });
    ch.seen.lead = lead;
  }
  // missions done, story events fired
  const done = s.missions?.done ?? [];
  for (const id of done.slice(ch.seen.missions)) push(ch, { at: secs, text: `Mission complete: ${content.missions[id]?.title ?? id}`, kind: 'mission' });
  ch.seen.missions = done.length;
  const fired = s.story?.fired ?? [];
  for (const id of fired.slice(ch.seen.fired)) { const t = content.story[id]?.title; if (t) push(ch, { at: secs, text: t, kind: 'story' }); }
  ch.seen.fired = fired.length;
  // the blocs and the people, every 30 s
  const last = ch.samples[ch.samples.length - 1];
  if (!last || secs - last[0] >= SAMPLE_EVERY) {
    const n: Record<Bloc, number> = { partner: 0, autonomist: 0, devoted: 0 };
    let kids = 0;
    for (const c of P.colonists) { if ((secs - c.born) / sol < adult) kids++; else n[blocOf(c.stance)]++; }
    ch.samples.push([Math.round(secs), n.partner, n.autonomist, n.devoted, kids, P.bank.reduce((m, x) => m + x, 0)]);
    // long games: keep every other sample
    if (ch.samples.length > MAX_SAMPLES) ch.samples = ch.samples.filter((_, i) => i % 2 === 0 || i === ch.samples.length - 1);
  }
}
