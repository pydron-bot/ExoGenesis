/**
 * For headless tests: the sim and the content it reads, from one module graph,
 * so a test can add records (story events...) the sim then sees.
 *   const { module: M } = await runnerImport('tools/sim-entry.ts'); M.content, M.Sim
 */
export { Sim, useRegion } from '../src/sim/core';
export { content } from '../src/content';
