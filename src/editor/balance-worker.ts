/**
 * Balance runs for the editor: plays src/sim/balance.ts on the editor's content.
 * One worker per run: the content is swapped in before the sim's modules load,
 * since some of them read rules once, at import.
 */
import { content } from '../content';
import { buildDb } from '../content/db';
import type { BalanceOptions } from '../sim/balance';

export interface BalanceJob { files: Record<string, unknown>; strategies: string[]; options: BalanceOptions }

self.onmessage = async (e: MessageEvent<BalanceJob>) => {
  const { files, strategies, options } = e.data;
  try {
    const { db } = buildDb(files);
    const live = content as unknown as Record<string, Record<string, unknown>>;
    for (const [k, v] of Object.entries(db as unknown as Record<string, Record<string, unknown>>)) {
      const tgt = live[k];
      if (!tgt || !v) continue;
      for (const key of Object.keys(tgt)) delete tgt[key];
      Object.assign(tgt, v);
    }
    const B = await import('../sim/balance');
    for (const name of strategies) {
      postMessage({ type: 'start', name });
      const r = B.runBalance(name, options);
      // the notable events only (as the command-line tool prints them)
      r.events = r.events.filter((x) => x.level !== 'info' || /destroyed|online/.test(x.text)).slice(0, 80);
      postMessage({ type: 'result', result: r });
    }
    postMessage({ type: 'done' });
  } catch (err) {
    postMessage({ type: 'error', message: (err as Error).message });
  }
};
