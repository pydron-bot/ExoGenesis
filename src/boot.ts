/**
 * Which region the game opens in, worked out from the address and what's saved: a pure function, so it can be
 * tested without a browser (tools/boot-smoke.mjs). main.ts gathers the inputs (IndexedDB, the URL) and acts on it.
 */
export interface BootInputs {
  /** A skirmish (?skirmish=…): its own generated map. */
  skirmish: boolean;
  /** The editor's play test region (?preview=1). */
  previewId?: string;
  /** ?region=<id>, if that region exists. */
  asked?: string | null;
  /** Arriving from campaign travel (?travel=1). */
  travelIn: boolean;
  /** The campaign record's current region (none: no campaign). */
  campaignAt?: string;
  /** Regions with a colony worth resuming (their autosave is playable). */
  playable: ReadonlySet<string>;
  /** Regions that exist. */
  regions: ReadonlySet<string>;
  home: string;
}

export interface BootPlan {
  /** Where the campaign says you are: its current region, or home when that expedition's colony is gone. */
  savedRegion: string;
  /** The region this page plays. */
  regionId: string;
}

export function planBoot(i: BootInputs): BootPlan {
  // the campaign's current region, unless its colony is gone (a lost expedition): then home
  let savedRegion = i.campaignAt ?? i.home;
  if (i.campaignAt && savedRegion !== i.home && !i.travelIn && !i.playable.has(savedRegion) && i.playable.has(i.home)) savedRegion = i.home;
  const regionId = i.skirmish ? 'skirmish'
    : i.previewId ? i.previewId
    : i.asked && i.regions.has(i.asked) ? i.asked
    : i.regions.has(savedRegion) ? savedRegion
    : i.home;
  return { savedRegion, regionId };
}
