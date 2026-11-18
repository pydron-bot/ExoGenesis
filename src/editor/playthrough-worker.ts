/**
 * Story playthroughs for the editor: plays src/sim/playthrough.ts on the
 * editor's content (swapped in before the sim's modules load, as the balance
 * worker does), one run per choice policy, then what they covered.
 */
import { content } from '../content';
import { buildDb } from '../content/db';
import type { ChoicePolicy, PlaythroughOptions } from '../sim/playthrough';

export interface PlaythroughJob { files: Record<string, unknown>; policies: ChoicePolicy[]; options: PlaythroughOptions }

self.onmessage = async (e: MessageEvent<PlaythroughJob>) => {
  const { files, policies, options } = e.data;
  try {
    const { db } = buildDb(files);
    const live = content as unknown as Record<string, Record<string, unknown>>;
    for (const [k, v] of Object.entries(db as unknown as Record<string, Record<string, unknown>>)) {
      const tgt = live[k];
      if (!tgt || !v) continue;
      for (const key of Object.keys(tgt)) delete tgt[key];
      Object.assign(tgt, v);
    }
    const P = await import('../sim/playthrough');
    const runs = [];
    for (const policy of policies) {
      postMessage({ type: 'start', name: policy });
      const r = P.runPlaythrough({ ...options, policy });
      runs.push(r);
      postMessage({ type: 'result', result: r });
    }
    postMessage({ type: 'done', coverage: P.coverage(runs) });
  } catch (err) {
    postMessage({ type: 'error', message: (err as Error).message });
  }
};
