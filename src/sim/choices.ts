/**
 * How a bot answers a story card (the playthrough, src/sim/playthrough.ts, and the autopilot, src/autopilot.ts):
 * plain functions, so the renderer can use them without loading the sim.
 */
/** How the bot answers a card with choices. */
export type ChoicePolicy = 'first' | 'last' | 'random' | 'honest';
export const POLICIES: Record<ChoicePolicy, string> = {
  first: 'always the first choice',
  last: 'always the last choice',
  random: 'a random choice (seeded)',
  honest: 'the honest-sounding choice (truth, tell, honest…), else the first',
};
/** Words that make a choice "honest" for that policy (whole words, any case). */
export const HONEST_WORDS = ['truth', 'true', 'tell', 'honest', 'honestly', 'admit', 'confess', 'explain', 'open', 'share', 'answer'];

/**
 * Which choice a policy takes: `offered` are the indices on offer (`shownChoices`), `labels` the full list's
 * labels, `rnd` a 0..1 random for `random`. Returns an index into the full list.
 */
export function pickChoice(policy: ChoicePolicy, offered: number[], labels: string[], rnd: () => number, words = HONEST_WORDS): number {
  const n = offered.length;
  if (!n) return 0;
  if (policy === 'last') return offered[n - 1];
  if (policy === 'random') return offered[Math.floor(rnd() * n)];
  if (policy === 'honest') {
    const re = new RegExp(`\\b(${words.join('|')})\\b`, 'i');
    const k = offered.find((i) => re.test(labels[i] ?? ''));
    if (k !== undefined) return k;
  }
  return offered[0];
}

