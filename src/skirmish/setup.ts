/**
 * A skirmish from the URL (DESIGN §5.11): `?skirmish=<seed>` plus options, so a game can be started, shared and
 * reloaded as a link. The setup screen (title → SKIRMISH) builds the same URL.
 *
 *   players=2..4   size=small|medium|large   world=<body id>   water=none|some|lots   relief=flat|rolling|rugged
 *   alloys=<n>     fog=0                    packs=1            wildlife=0             ai=easy|normal|hard (all)
 *   teams=0011     (each player's side, in order; default: everyone for themselves)
 *   area=<id>      a Domination area (src/sim/areas.ts): its world and site; its map size unless size= says
 */
import type { SkirmishSetup } from '../sim/types';
import { areaLabel, findArea } from '../sim/areas';
import { generateSkirmishMap, type MapOptions, type MapRelief, type MapSize, type MapWater, type SkirmishMap } from './mapgen';

/** Player colours, in order (player 0 is you). */
export const PLAYER_COLORS = ['#4fd1e8', '#e8574f', '#e8b04f', '#a46be8'];
export const PLAYER_NAMES = ['You', 'Crimson', 'Amber', 'Violet'];
/** Worlds a skirmish can be played on (planets and the bigger moons). */
export const SKIRMISH_WORLDS = ['home', 'verdance', 'dunmore', 'rime', 'cinder', 'ash'];

const pick = <T extends string>(v: string | null, ok: readonly T[], d: T): T => (v && (ok as readonly string[]).includes(v) ? (v as T) : d);

export function skirmishFromUrl(p: URLSearchParams, bodies: Record<string, unknown>): { map: SkirmishMap; setup: SkirmishSetup; options: MapOptions } {
  const seed = Math.max(1, Math.floor(Number(p.get('skirmish')) || 0)) || 1 + Math.floor(Math.random() * 99999);
  const players = Math.min(4, Math.max(2, Number(p.get('players')) || 2));
  const worldAsk = p.get('world');
  // ?area=<id>: a Domination area's site on its world (src/sim/areas.ts)
  const area = findArea(p.get('area'), bodies as Record<string, object>);
  const options: MapOptions = {
    seed,
    players,
    size: pick<MapSize>(p.get('size'), ['small', 'medium', 'large'], area?.size ?? 'medium'),
    world: area ? area.body : worldAsk && bodies[worldAsk] ? worldAsk : 'home',
    site: area ? { lat: area.lat, lon: area.lon, name: areaLabel(area, bodies as Record<string, object>) } : undefined,
    water: pick<MapWater>(p.get('water'), ['none', 'some', 'lots'], 'some'),
    relief: pick<MapRelief>(p.get('relief'), ['flat', 'rolling', 'rugged'], 'rolling'),
  };
  const map = generateSkirmishMap(options, bodies);
  const ai = pick(p.get('ai'), ['easy', 'normal', 'hard'] as const, 'normal');
  const teams = (p.get('teams') ?? '').split('').map(Number);
  const setup: SkirmishSetup = {
    seed,
    alloys: Math.min(100000, Math.max(100, Number(p.get('alloys')) || 600)),
    fog: p.get('fog') !== '0',
    packs: p.get('packs') === '1',
    wildlife: p.get('wildlife') !== '0',
    homes: map.homes,
    players: Array.from({ length: players }, (_, i) => ({
      name: PLAYER_NAMES[i], color: PLAYER_COLORS[i], side: Number.isFinite(teams[i]) ? teams[i] : i, ai: i ? ai : undefined,
    })),
  };
  return { map, setup, options };
}
