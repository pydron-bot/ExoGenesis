/**
 * Which region the game opens in (src/boot.ts planBoot), headless: the address, the campaign's region, a lost
 * expedition falling back home, travel, play tests and skirmishes.
 *   node tools/boot-smoke.mjs
 */
import path from 'node:path';
import { runnerImport } from 'vite';
import { checker } from './lib/harness.mjs';

const { module: B } = await runnerImport(path.resolve(import.meta.dirname, '../src/boot.ts'));
const { check, done } = checker();
const regions = new Set(['touchdown', 'verdance', 'rime']);
const plan = (o) => B.planBoot({ skirmish: false, travelIn: false, playable: new Set(), regions, home: 'touchdown', ...o });

let p = plan({});
check(p.regionId === 'touchdown' && p.savedRegion === 'touchdown', 'no campaign: home');
p = plan({ campaignAt: 'verdance', playable: new Set(['verdance', 'touchdown']) });
check(p.regionId === 'verdance', 'the campaign\'s region when its colony is there');
p = plan({ campaignAt: 'verdance', playable: new Set(['touchdown']) });
check(p.regionId === 'touchdown' && p.savedRegion === 'touchdown', 'a lost expedition: back home');
p = plan({ campaignAt: 'verdance', playable: new Set(['touchdown']), travelIn: true });
check(p.regionId === 'verdance', 'arriving by travel: the new region even with no colony there yet');
p = plan({ campaignAt: 'verdance', playable: new Set(), });
check(p.regionId === 'verdance', 'no colony anywhere: the campaign\'s region (a fresh expedition)');
p = plan({ asked: 'rime', campaignAt: 'verdance', playable: new Set(['verdance']) });
check(p.regionId === 'rime' && p.savedRegion === 'verdance', '?region= wins, the campaign\'s region is remembered');
p = plan({ asked: 'nowhere' });
check(p.regionId === 'touchdown', 'an unknown ?region= is ignored');
p = plan({ previewId: 'draft-1', asked: 'rime' });
check(p.regionId === 'draft-1', 'the editor\'s play test region');
p = plan({ skirmish: true, asked: 'rime', previewId: 'draft-1' });
check(p.regionId === 'skirmish', 'a skirmish plays its own map');
done();
