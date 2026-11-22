/**
 * Campaign travel (STORY.md §13, TECH.md "Campaign travel"): the story plays across many regions. Each region
 * keeps its own colony save (src/save.ts `regionKey`); what the whole campaign shares is one **shared state**,
 * taken from the region being left and laid over the region being entered.
 *
 * Shared (campaign-wide): story flags, counters, events fired and answered, cinematics played, countdowns that
 * have run out, build-menu locks, HUD panels opened, events waiting for their region (`away`); every mission
 * (under way, done, failed, objectives met); research done; the campaign's visited regions, routes and the
 * Firstborn's name.
 *
 * Per region (the region's own save): buildings, units, drones, alloys, isotopes, the map, fog, the clock,
 * people, planet health, inhabitants, the Chronicle, and the story's local parts: the card inbox, delays,
 * countdowns still running, waypoints, the hint, camera moves, encounters, the cinematic queue, colony boosts,
 * dilemma timing, cards' cast, and the research under way at this region's Tech Lab.
 */
import type { CampaignInfo, MissionState, SimState, StoryState } from './types';

/** The home colony: always yours; every other region is an expedition. */
export const HOME_REGION = 'touchdown';

/** The story fields every region shares. */
export const SHARED_STORY = ['fired', 'answered', 'flags', 'cines', 'counters', 'expired', 'locked', 'opened', 'away'] as const;
type SharedStoryKey = (typeof SHARED_STORY)[number];

export interface SharedState {
  story: Partial<Pick<StoryState, SharedStoryKey>>;
  missions: MissionState;
  /** Research done (research is campaign-wide). */
  research: string[];
  campaign: CampaignInfo;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** A fresh campaign record for a game that starts in `region`. */
export const newCampaign = (region: string): CampaignInfo => ({ visited: [region], routes: [] });

/** What this colony's state holds of the campaign (a copy). */
export function sharedOf(s: SimState): SharedState {
  const st = s.story, story: SharedState['story'] = {};
  if (st) for (const k of SHARED_STORY) if (st[k] !== undefined) (story as Record<string, unknown>)[k] = clone(st[k]);
  const campaign = clone(s.campaign ?? newCampaign(s.region ?? HOME_REGION));
  const first = s.people?.first;
  if (first) campaign.first = { id: first.id, name: first.name };
  return {
    story,
    missions: clone(s.missions ?? { active: [], done: [], marks: {} }),
    research: [...(s.research?.done ?? [])],
    campaign,
  };
}

/** Lay the campaign's shared state over a region's colony state (in place). `region`: the one being entered. */
export function applyShared(s: SimState, sh: SharedState, region: string) {
  const st = (s.story ??= { fired: [], answered: [], flags: [], inbox: [], timers: [] });
  for (const k of SHARED_STORY) {
    const v = sh.story[k];
    if (v !== undefined) (st as unknown as Record<string, unknown>)[k] = clone(v);
    else if (k !== 'fired' && k !== 'answered' && k !== 'flags') delete st[k];
  }
  st.fired ??= []; st.answered ??= []; st.flags ??= [];
  // an event that fired elsewhere while this one waited out its delay doesn't fire again here
  st.timers = (st.timers ?? []).filter((t) => !st.fired.includes(t.id));
  s.missions = clone(sh.missions);
  const R = (s.research ??= { done: [], active: null });
  R.done = [...sh.research];
  if (R.active && R.done.includes(R.active.id)) R.active = null;
  s.campaign = clone(sh.campaign);
  if (!s.campaign.visited.includes(region)) s.campaign.visited.push(region);
}

/**
 * An expedition lost: its save is gone, and so is what happened there, so a retry plays it again. In place on a
 * shared state (the one written as the campaign goes home): events and cinematics set in `region` are forgotten
 * (fired, answered, played, waiting), and missions set there that were under way or failed are under way again with
 * no objectives met. Missions done there stay done; flags and counters stay as they are.
 */
export function forgetRegion(sh: SharedState, region: string, defs: { story: Record<string, { region?: string }>; cinematics: Record<string, { region?: string }>; missions: Record<string, { region?: string }> }) {
  const st = sh.story;
  const evHere = (id: string) => defs.story[id]?.region === region;
  if (st.fired) st.fired = st.fired.filter((id) => !evHere(id));
  if (st.answered) st.answered = st.answered.filter((id) => !evHere(id));
  if (st.cines) st.cines = st.cines.filter((id) => defs.cinematics[id]?.region !== region);
  if (st.away) st.away = st.away.filter((id) => (id.startsWith('cine:') ? defs.cinematics[id.slice(5)]?.region !== region : !evHere(id)));
  const m = sh.missions;
  for (const [id, def] of Object.entries(defs.missions)) {
    if (def.region !== region || m.done.includes(id)) continue;
    if (!m.active.includes(id) && !m.failed?.includes(id)) continue;
    if (m.failed) m.failed = m.failed.filter((x) => x !== id);
    if (!m.active.includes(id)) m.active.push(id);
    m.marks[id] = [];
  }
  return sh;
}
